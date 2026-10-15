import express from "express";
import { conn } from "../dbconnect";
import { OrderDetail } from "../model/order";
import { distanceKmSql, parseLatLng } from "../utils/geo";
import { AppError, parseDate, parsePage } from "../utils/http";
import { dropDrafts, dropStalePlans, isDateLocked } from "../utils/plans";
import { getSettings } from "../utils/settings";

export const router = express.Router();

const ORDER_DETAIL_SQL = `
  SELECT o.order_id, o.order_no, o.customer_id, o.delivery_date, o.box_count,
         o.unit_price, o.unit_cost, o.delivery_lat, o.delivery_lng,
         o.source, o.status, o.created_at,
         c.first_name, c.last_name, c.phone_number
  FROM orders o
  JOIN customers c ON c.customer_id = o.customer_id`;

function checkBoxCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 3) {
    throw new AppError(400, "VALIDATION", "boxCount ต้องเป็นจำนวนเต็ม 1-3");
  }
  return n;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function assertNotLocked(date: string) {
  if (await isDateLocked(date)) {
    throw new AppError(409, "ORDER_LOCKED", "วันนี้ยืนยันแผนแล้ว ต้องยกเลิกแผนก่อนจึงจะแก้ออเดอร์ได้");
  }
}

// เลขออเดอร์ YYMMDD-NNN ต่อจากเลขสูงสุดของวันนั้น
async function nextOrderNos(date: string, count: number): Promise<string[]> {
  const prefix = date.slice(2).replace(/-/g, "");
  const [rows] = await conn.query(
    "SELECT MAX(CAST(SUBSTRING(order_no, 8) AS UNSIGNED)) AS m FROM orders WHERE order_no LIKE ?",
    [`${prefix}-%`],
  );
  const start = Number((rows as any[])[0]?.m ?? 0);
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(start + i + 1).padStart(3, "0")}`);
}

async function findOrder(id: unknown): Promise<OrderDetail> {
  const [rows] = await conn.query(`${ORDER_DETAIL_SQL} WHERE o.order_id = ?`, [id]);
  const o = (rows as OrderDetail[])[0];
  if (!o) throw new AppError(404, "NOT_FOUND", "Order not found");
  return o;
}

router.get("/", async (req, res) => {
  const date = parseDate(req.query.date);
  const { page, limit, offset } = parsePage(req.query, 100, 500);
  const where = ["o.delivery_date = ?"];
  const params: unknown[] = [date];
  if (req.query.source !== undefined) {
    if (req.query.source !== "MANUAL" && req.query.source !== "SIMULATED")
      throw new AppError(400, "VALIDATION", "source ต้องเป็น MANUAL หรือ SIMULATED");
    where.push("o.source = ?");
    params.push(req.query.source);
  }
  if (req.query.status !== undefined) {
    if (req.query.status !== "PENDING" && req.query.status !== "DISPATCHED")
      throw new AppError(400, "VALIDATION", "status ต้องเป็น PENDING หรือ DISPATCHED");
    where.push("o.status = ?");
    params.push(req.query.status);
  }
  const q = String(req.query.q ?? "").trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    where.push("(c.first_name LIKE ? OR c.last_name LIKE ? OR o.order_no LIKE ?)");
    params.push(like, like, like);
  }
  const w = where.join(" AND ");
  const [rows] = await conn.query(`${ORDER_DETAIL_SQL} WHERE ${w} ORDER BY o.order_id LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset,
  ]);
  const [sum] = await conn.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(o.box_count),0) AS boxes,
            COALESCE(SUM(o.box_count * o.unit_price),0) AS revenue,
            COALESCE(SUM(o.box_count * o.unit_cost),0) AS foodCost
     FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE ${w}`,
    params,
  );
  const s = (sum as any[])[0];
  res.json({
    data: rows,
    meta: {
      page,
      limit,
      total: s.total,
      totalBoxes: Number(s.boxes),
      revenue: Number(s.revenue),
      foodCost: Number(s.foodCost),
      locked: await isDateLocked(date),
    },
  });
});

// จำลองออเดอร์ 20-30 รายการ
router.post("/simulate", async (req, res) => {
  const count = req.body?.count === undefined ? randomInt(20, 30) : Number(req.body.count);
  if (!Number.isInteger(count) || count < 20 || count > 30) {
    throw new AppError(400, "VALIDATION", "count ต้องเป็นจำนวนเต็ม 20-30");
  }
  const mode = req.body?.mode ?? "append";
  if (mode !== "append" && mode !== "replace") {
    throw new AppError(400, "VALIDATION", "mode ต้องเป็น append หรือ replace");
  }
  const date = parseDate(req.body?.deliveryDate);
  await assertNotLocked(date);
  const st = await getSettings();

  const c = await conn.getConnection();
  try {
    await c.beginTransaction();
    if (mode === "replace") {
      await dropStalePlans(date, c);
      await c.query(
        "DELETE FROM orders WHERE delivery_date = ? AND source = 'SIMULATED' AND status = 'PENDING'",
        [date],
      );
    }
    await dropDrafts(date, c);

    // สุ่มลูกค้าในรัศมีให้บริการ ที่ยังไม่มีออเดอร์ของวันนั้น
    const [cust] = await c.query(
      `SELECT * FROM (
         SELECT c.customer_id, c.latitude, c.longitude,
                ${distanceKmSql("c.latitude", "c.longitude")} AS d
         FROM customers c
         WHERE c.customer_id NOT IN (SELECT customer_id FROM orders WHERE delivery_date = ?)
       ) t WHERE d <= ? ORDER BY RAND() LIMIT ?`,
      [st.depotLat, st.depotLat, st.depotLng, date, st.serviceRadiusKm, count],
    );
    const customers = cust as { customer_id: number; latitude: number; longitude: number }[];
    if (customers.length < count) {
      await c.rollback();
      throw new AppError(
        422,
        "NOT_ENOUGH_CUSTOMERS",
        `มีลูกค้าที่ใช้จำลองได้แค่ ${customers.length} คน (ต้องการ ${count}) กรุณาเพิ่มลูกค้าก่อน`,
      );
    }
    const nos = await nextOrderNos(date, count);
    const values = customers.map((cu, i) => [
      nos[i],
      cu.customer_id,
      date,
      randomInt(1, 3),
      st.boxPrice,
      st.boxCost,
      cu.latitude,
      cu.longitude,
      "SIMULATED",
    ]);
    await c.query(
      `INSERT INTO orders (order_no, customer_id, delivery_date, box_count, unit_price, unit_cost,
                           delivery_lat, delivery_lng, source) VALUES ?`,
      [values],
    );
    await c.commit();
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    c.release();
  }

  const [rows] = await conn.query(
    `${ORDER_DETAIL_SQL} WHERE o.delivery_date = ? AND o.source = 'SIMULATED' ORDER BY o.order_id`,
    [date],
  );
  const orders = rows as OrderDetail[];
  res.status(201).json({
    data: orders,
    summary: { count: orders.length, totalBoxes: orders.reduce((s, o) => s + o.box_count, 0) },
  });
});

// ล้างเฉพาะออเดอร์จำลอง (ไม่แตะออเดอร์จริง)
async function clearSimulated(req: express.Request, res: express.Response) {
  const date = parseDate(req.query.date);
  await assertNotLocked(date);
  await dropStalePlans(date);
  const [result] = await conn.query(
    "DELETE FROM orders WHERE delivery_date = ? AND source = 'SIMULATED' AND status = 'PENDING'",
    [date],
  );
  await dropDrafts(date);
  res.status(200).json({ deletedCount: (result as any).affectedRows });
}
router.delete("/simulated", clearSimulated);
router.delete("/simulate", clearSimulated);

router.get("/nearby", async (req, res) => {
  const point = parseLatLng(req.query.lat, req.query.lng);
  if (!point) {
    throw new AppError(400, "VALIDATION", "ต้องส่ง lat และ lng เป็นตัวเลข เช่น ?lat=16.2467&lng=103.2554");
  }
  const radius = req.query.radiusKm ?? req.query.radius;
  const radiusKm = radius === undefined ? 2 : Number(radius);
  if (isNaN(radiusKm) || radiusKm <= 0) {
    throw new AppError(400, "VALIDATION", "radiusKm ต้องเป็นตัวเลขมากกว่า 0");
  }
  const date = parseDate(req.query.date);
  const sql = `
    SELECT * FROM (
      SELECT o.order_id, o.order_no, o.customer_id, o.delivery_date, o.box_count, o.source, o.status,
             o.delivery_lat, o.delivery_lng, c.first_name, c.last_name, c.phone_number,
             ROUND(${distanceKmSql("o.delivery_lat", "o.delivery_lng")} * 1000) AS distance_m
      FROM orders o JOIN customers c ON c.customer_id = o.customer_id
      WHERE o.delivery_date = ?
    ) AS t
    WHERE distance_m <= ?
    ORDER BY distance_m`;
  const [rows] = await conn.query(sql, [point.lat, point.lat, point.lng, date, radiusKm * 1000]);
  res.json({ data: rows });
});

router.get("/:id", async (req, res) => {
  res.json({ data: await findOrder(req.params.id) });
});

router.post("/", async (req, res) => {
  const customerId = Number(req.body?.customerId ?? req.body?.customer_id);
  if (!Number.isInteger(customerId) || customerId < 1) {
    throw new AppError(400, "VALIDATION", "customerId ต้องเป็นจำนวนเต็ม");
  }
  const boxCount = checkBoxCount(req.body?.boxCount ?? req.body?.box_count);
  const date = parseDate(req.body?.deliveryDate);
  await assertNotLocked(date);

  const [cu] = await conn.query("SELECT latitude, longitude FROM customers WHERE customer_id = ?", [customerId]);
  const customer = (cu as any[])[0];
  if (!customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
  const st = await getSettings();

  // เลขออเดอร์อาจชนกันถ้ากดพร้อมกัน จึง retry
  let insertId = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const [no] = await nextOrderNos(date, 1);
    try {
      const [result] = await conn.query(
        `INSERT INTO orders (order_no, customer_id, delivery_date, box_count, unit_price, unit_cost,
                             delivery_lat, delivery_lng, source)
         VALUES (?,?,?,?,?,?,?,?, 'MANUAL')`,
        [no, customerId, date, boxCount, st.boxPrice, st.boxCost, customer.latitude, customer.longitude],
      );
      insertId = (result as any).insertId;
      break;
    } catch (e: any) {
      if (e.code !== "ER_DUP_ENTRY" || attempt === 4) throw e;
    }
  }
  await dropDrafts(date);
  res.status(201).json({ data: await findOrder(insertId) });
});

router.patch("/:id", async (req, res) => {
  const boxCount = checkBoxCount(req.body?.boxCount ?? req.body?.box_count);
  const order = await findOrder(req.params.id);
  const date = String(order.delivery_date);
  await assertNotLocked(date);
  await conn.query("UPDATE orders SET box_count = ? WHERE order_id = ?", [boxCount, order.order_id]);
  await dropDrafts(date);
  res.json({ data: await findOrder(order.order_id) });
});

router.delete("/:id", async (req, res) => {
  const order = await findOrder(req.params.id);
  const date = String(order.delivery_date);
  await assertNotLocked(date);
  await dropStalePlans(date);
  await conn.query("DELETE FROM orders WHERE order_id = ?", [order.order_id]);
  res.status(204).end();
});
