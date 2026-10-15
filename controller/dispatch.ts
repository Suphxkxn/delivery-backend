import crypto from "crypto";
import express from "express";
import { conn } from "../dbconnect";
import { InfeasibleError, Objective, PlanParams, planRoutes } from "../engine/planner";
import { AppError, minToTime, parseDate, timeToMin } from "../utils/http";
import { dropDrafts, isDateLocked } from "../utils/plans";
import { getSettings } from "../utils/settings";

export const router = express.Router();

const OBJECTIVES: Objective[] = ["MIN_COST", "MIN_DISTANCE", "MIN_LATEST_ARRIVAL"];
const COLORS = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4",
  "#f032e6", "#9a6324", "#008080", "#800000", "#808000", "#000075",
];
// ไม่มี 0 O 1 I ให้อ่านง่าย
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newJobCode(): string {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

function planSummary(r: any) {
  return {
    planId: r.plan_id,
    deliveryDate: r.delivery_date,
    status: r.status,
    objective: r.objective,
    variantNo: r.variant_no,
    orderCount: r.order_count,
    totalBoxes: r.total_boxes,
    riderCount: r.rider_count,
    totalDistanceM: r.total_distance_m,
    latestArrival: String(r.latest_arrival).slice(0, 8),
    revenue: r.revenue,
    foodCost: r.food_cost,
    deliveryCost: r.delivery_cost,
    profit: r.profit,
    isOnTime: !!r.is_on_time,
    computeMs: r.compute_ms,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
  };
}

async function getPlanRow(id: unknown, db: Pick<typeof conn, "query"> = conn, forUpdate = false) {
  const [rows] = await db.query(`SELECT * FROM dispatch_plans WHERE plan_id = ?${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  const p = (rows as any[])[0];
  if (!p) throw new AppError(404, "NOT_FOUND", "ไม่พบแผน");
  return p;
}

async function planDetail(id: unknown) {
  const p = await getPlanRow(id);
  const [routes] = await conn.query("SELECT * FROM dispatch_routes WHERE plan_id = ? ORDER BY route_no", [id]);
  const [stops] = await conn.query(
    `SELECT s.*, o.order_no, o.box_count, o.delivery_lat, o.delivery_lng,
            c.first_name, c.last_name, c.phone_number
     FROM dispatch_stops s
     JOIN dispatch_routes r ON r.route_id = s.route_id
     JOIN orders o ON o.order_id = s.order_id
     JOIN customers c ON c.customer_id = o.customer_id
     WHERE r.plan_id = ? ORDER BY s.route_id, s.stop_seq`,
    [id],
  );
  const snap = p.params_snapshot;
  return {
    ...planSummary(p),
    depot: { lat: snap.depotLat, lng: snap.depotLng },
    params: snap,
    routes: (routes as any[]).map((r) => ({
      routeId: r.route_id,
      routeNo: r.route_no,
      colorHex: r.color_hex,
      jobCode: r.job_code,
      riderName: r.rider_name,
      riderPhone: r.rider_phone,
      stopCount: r.stop_count,
      totalBoxes: r.total_boxes,
      distanceM: r.distance_m,
      durationMin: r.duration_min,
      finishTime: String(r.finish_time).slice(0, 8),
      riderFee: r.rider_fee,
      stops: (stops as any[])
        .filter((s) => s.route_id === r.route_id)
        .map((s) => ({
          seq: s.stop_seq,
          orderId: s.order_id,
          orderNo: s.order_no,
          customerName: `${s.first_name} ${s.last_name}`,
          phone: s.phone_number,
          lat: s.delivery_lat,
          lng: s.delivery_lng,
          boxCount: s.box_count,
          legDistanceM: s.leg_distance_m,
          cumulativeDistM: s.cumulative_dist_m,
          eta: String(s.eta_time).slice(0, 8),
        })),
    })),
  };
}

// คำนวณแผน: คืน 3 แผน (ต้นทุนต่ำสุด / ระยะสั้นสุด / ถึงเร็วสุด)
router.post("/", async (req, res) => {
  const date = parseDate(req.body?.deliveryDate);
  let objectives: Objective[] = OBJECTIVES;
  if (req.body?.objectives !== undefined) {
    const o = req.body.objectives;
    if (!Array.isArray(o) || o.length === 0 || !o.every((x: any) => OBJECTIVES.includes(x))) {
      throw new AppError(400, "VALIDATION", `objectives ต้องเป็นอาร์เรย์ของ ${OBJECTIVES.join(", ")}`);
    }
    objectives = [...new Set<Objective>(o)];
  }
  const recalculate = req.body?.recalculate === true;

  if (await isDateLocked(date)) {
    throw new AppError(409, "PLAN_CONFIRMED", "วันนี้ยืนยันแผนแล้ว ต้องยกเลิกแผนก่อนจึงจะคำนวณใหม่ได้");
  }
  const st = await getSettings();
  const [oRows] = await conn.query(
    `SELECT order_id, order_no, box_count, delivery_lat, delivery_lng FROM orders
     WHERE delivery_date = ? AND status = 'PENDING' ORDER BY order_id`,
    [date],
  );
  const orders = oRows as any[];
  if (orders.length === 0) throw new AppError(422, "NO_ORDERS", "ยังไม่มีออเดอร์ของวันนี้");

  const params: PlanParams = {
    depotLat: st.depotLat,
    depotLng: st.depotLng,
    speedKmh: st.riderSpeedKmh,
    serviceMin: st.serviceTimeMin,
    baseFee: st.riderBaseFee,
    ratePerKmBox: st.riderRatePerKmBox,
    departMin: timeToMin(st.departTime),
    deadlineMin: timeToMin(st.deadlineTime),
    maxOrders: st.maxOrdersRider,
    roadFactor: st.roadFactor,
    boxPrice: st.boxPrice,
    boxCost: st.boxCost,
  };

  // แผนร่างเดิม: ใช้ห้ามได้ซ้ำตอนคำนวณใหม่ และหา variant ถัดไป
  const [drafts] = await conn.query(
    "SELECT plan_id, objective, variant_no FROM dispatch_plans WHERE delivery_date = ? AND status = 'DRAFT'",
    [date],
  );
  const exclude = new Map<string, Set<string>>();
  let variant = 1;
  if (recalculate && (drafts as any[]).length) {
    variant = Math.max(...(drafts as any[]).map((d) => d.variant_no)) + 1;
    const [ss] = await conn.query(
      `SELECT r.plan_id, r.route_id, s.order_id FROM dispatch_routes r
       JOIN dispatch_stops s ON s.route_id = r.route_id
       WHERE r.plan_id IN (?) ORDER BY r.route_id, s.stop_seq`,
      [(drafts as any[]).map((d) => d.plan_id)],
    );
    for (const d of drafts as any[]) {
      const byRoute = new Map<number, number[]>();
      for (const s of (ss as any[]).filter((x) => x.plan_id === d.plan_id)) {
        byRoute.set(s.route_id, [...(byRoute.get(s.route_id) ?? []), s.order_id]);
      }
      const sig = [...byRoute.values()].map((r) => r.join(",")).sort().join("|");
      exclude.set(d.objective, (exclude.get(d.objective) ?? new Set()).add(sig));
    }
  }

  const planOrders = orders.map((o) => ({
    id: o.order_id as number,
    lat: Number(o.delivery_lat),
    lng: Number(o.delivery_lng),
    boxes: o.box_count as number,
  }));
  const results = objectives.map((obj) => {
    const t0 = Date.now();
    try {
      const r = planRoutes(planOrders, params, obj, {
        seed: recalculate ? variant * 7919 + 1 : 1,
        exclude: exclude.get(obj) ?? new Set(),
      });
      return { obj, r, ms: Date.now() - t0 };
    } catch (e) {
      if (e instanceof InfeasibleError) {
        const no = orders.find((o) => o.order_id === e.orderId)?.order_no ?? `#${e.orderId}`;
        throw new AppError(422, "INFEASIBLE", `ออเดอร์ ${no} อยู่ไกลเกินกว่าจะส่งทันเวลา ${st.deadlineTime.slice(0, 5)}`);
      }
      throw e;
    }
  });

  const c = await conn.getConnection();
  const planIds: number[] = [];
  try {
    await c.beginTransaction();
    await dropDrafts(date, c);
    for (const { obj, r, ms } of results) {
      const [ins] = await c.query(
        `INSERT INTO dispatch_plans (delivery_date, status, objective, variant_no, algorithm, params_snapshot,
           order_count, total_boxes, rider_count, total_distance_m, latest_arrival,
           revenue, food_cost, delivery_cost, profit, is_on_time, compute_ms, created_by)
         VALUES (?, 'DRAFT', ?, ?, 'LOCAL_SEARCH', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          date, obj, variant, JSON.stringify(params),
          orders.length, r.totalBoxes, r.routes.length, r.totalDistanceM, minToTime(r.latestArrivalMin),
          r.revenue, r.foodCost, r.deliveryCost, r.profit, r.onTime ? 1 : 0, ms, req.user!.id,
        ],
      );
      const planId = (ins as any).insertId as number;
      planIds.push(planId);

      await c.query(
        `INSERT INTO dispatch_routes (plan_id, route_no, color_hex, stop_count, total_boxes, distance_m,
           duration_min, finish_time, rider_fee) VALUES ?`,
        [
          r.routes.map((rt, i) => [
            planId, i + 1, COLORS[i % COLORS.length], rt.stops.length, rt.totalBoxes, rt.distanceM,
            Math.round(rt.durationMin * 10) / 10, minToTime(rt.finishMin), rt.fee,
          ]),
        ],
      );
      const [rr] = await c.query("SELECT route_id, route_no FROM dispatch_routes WHERE plan_id = ?", [planId]);
      const routeId = new Map((rr as any[]).map((x) => [x.route_no as number, x.route_id as number]));
      const stopRows = r.routes.flatMap((rt, i) =>
        rt.stops.map((s) => [routeId.get(i + 1), s.orderId, s.seq, s.legM, s.cumM, minToTime(s.etaMin)]),
      );
      await c.query(
        `INSERT INTO dispatch_stops (route_id, order_id, stop_seq, leg_distance_m, cumulative_dist_m, eta_time)
         VALUES ?`,
        [stopRows],
      );
    }
    await c.commit();
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    c.release();
  }

  const [rows] = await conn.query("SELECT * FROM dispatch_plans WHERE plan_id IN (?) ORDER BY plan_id", [planIds]);
  res.status(201).json({ data: (rows as any[]).map(planSummary) });
});

router.get("/", async (req, res) => {
  const date = parseDate(req.query.date);
  const where = ["delivery_date = ?"];
  const params: unknown[] = [date];
  if (req.query.status !== undefined) {
    if (!["DRAFT", "CONFIRMED", "CANCELLED"].includes(String(req.query.status)))
      throw new AppError(400, "VALIDATION", "status ต้องเป็น DRAFT, CONFIRMED หรือ CANCELLED");
    where.push("status = ?");
    params.push(req.query.status);
  }
  const [rows] = await conn.query(
    `SELECT * FROM dispatch_plans WHERE ${where.join(" AND ")} ORDER BY plan_id`,
    params,
  );
  res.json({ data: (rows as any[]).map(planSummary) });
});

router.get("/:id", async (req, res) => {
  res.json({ data: await planDetail(req.params.id) });
});

// ยืนยันแผน -> ออกเลขใบงาน
router.post("/:id/confirm", async (req, res) => {
  const c = await conn.getConnection();
  let planId: number;
  try {
    await c.beginTransaction();
    const plan = await getPlanRow(req.params.id, c, true);
    planId = plan.plan_id;
    if (plan.status !== "DRAFT") throw new AppError(409, "BAD_STATUS", "ยืนยันได้เฉพาะแผนร่าง");

    // ออเดอร์ของวันนั้นต้องตรงกับตอนคำนวณ
    const [cur] = await c.query(
      "SELECT order_id FROM orders WHERE delivery_date = ? AND status = 'PENDING' ORDER BY order_id",
      [plan.delivery_date],
    );
    const [inPlan] = await c.query(
      `SELECT s.order_id FROM dispatch_stops s JOIN dispatch_routes r ON r.route_id = s.route_id
       WHERE r.plan_id = ? ORDER BY s.order_id`,
      [planId],
    );
    const a = (cur as any[]).map((x) => x.order_id).join(",");
    const b = (inPlan as any[]).map((x) => x.order_id).join(",");
    if (a !== b) throw new AppError(409, "PLAN_STALE", "ออเดอร์เปลี่ยนไปหลังคำนวณ กรุณาคำนวณใหม่");

    try {
      await c.query("UPDATE dispatch_plans SET status = 'CONFIRMED', confirmed_at = NOW() WHERE plan_id = ?", [planId]);
    } catch (e: any) {
      if (e.code === "ER_DUP_ENTRY") throw new AppError(409, "ALREADY_CONFIRMED", "วันนี้มีแผนที่ยืนยันแล้ว");
      throw e;
    }

    const [routes] = await c.query("SELECT route_id FROM dispatch_routes WHERE plan_id = ?", [planId]);
    for (const r of routes as any[]) {
      for (let attempt = 0; ; attempt++) {
        try {
          await c.query("UPDATE dispatch_routes SET job_code = ? WHERE route_id = ?", [newJobCode(), r.route_id]);
          break;
        } catch (e: any) {
          if (e.code !== "ER_DUP_ENTRY" || attempt >= 5) throw e;
        }
      }
    }
    await c.query("UPDATE orders SET status = 'DISPATCHED' WHERE delivery_date = ? AND status = 'PENDING'", [
      plan.delivery_date,
    ]);
    await c.query("DELETE FROM dispatch_plans WHERE delivery_date = ? AND status = 'DRAFT'", [plan.delivery_date]);
    await c.commit();
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  res.json({ data: await planDetail(planId) });
});

// ยกเลิกแผนที่ยืนยัน -> ใบงานใช้ไม่ได้ ปลดล็อกออเดอร์
router.post("/:id/cancel", async (req, res) => {
  const c = await conn.getConnection();
  let planId: number;
  try {
    await c.beginTransaction();
    const plan = await getPlanRow(req.params.id, c, true);
    planId = plan.plan_id;
    if (plan.status !== "CONFIRMED") throw new AppError(409, "BAD_STATUS", "ยกเลิกได้เฉพาะแผนที่ยืนยันแล้ว");
    await c.query("UPDATE dispatch_plans SET status = 'CANCELLED' WHERE plan_id = ?", [planId]);
    await c.query("UPDATE dispatch_routes SET job_code = NULL WHERE plan_id = ?", [planId]);
    await c.query(
      `UPDATE orders SET status = 'PENDING' WHERE order_id IN
         (SELECT s.order_id FROM dispatch_stops s JOIN dispatch_routes r ON r.route_id = s.route_id WHERE r.plan_id = ?)`,
      [planId],
    );
    await c.commit();
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  res.json({ data: await planDetail(planId) });
});

// ใส่ชื่อ/เบอร์ไรเดอร์ (ไม่บังคับ)
router.patch("/:id/routes/:routeId", async (req, res) => {
  const name = req.body?.riderName;
  const phone = req.body?.riderPhone;
  if (name !== undefined && name !== null && (typeof name !== "string" || name.length > 100))
    throw new AppError(400, "VALIDATION", "riderName ต้องเป็นข้อความไม่เกิน 100 ตัว");
  if (phone !== undefined && phone !== null && !/^0\d{8,9}$/.test(String(phone)))
    throw new AppError(400, "VALIDATION", "riderPhone ต้องเป็นเบอร์โทร 9-10 หลักขึ้นต้นด้วย 0");

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined) { sets.push("rider_name = ?"); vals.push(name ? name.trim() : null); }
  if (phone !== undefined) { sets.push("rider_phone = ?"); vals.push(phone || null); }
  if (!sets.length) throw new AppError(400, "VALIDATION", "ต้องส่ง riderName หรือ riderPhone");

  const [r] = await conn.query(
    `UPDATE dispatch_routes SET ${sets.join(", ")} WHERE route_id = ? AND plan_id = ?`,
    [...vals, req.params.routeId, req.params.id],
  );
  if ((r as any).affectedRows === 0) {
    // affectedRows = 0 อาจเป็นค่าเดิม ตรวจว่ามี route จริงไหม
    const [ex] = await conn.query("SELECT 1 FROM dispatch_routes WHERE route_id = ? AND plan_id = ?", [
      req.params.routeId, req.params.id,
    ]);
    if ((ex as any[]).length === 0) throw new AppError(404, "NOT_FOUND", "ไม่พบใบงาน");
  }
  res.json({ data: await planDetail(req.params.id) });
});
