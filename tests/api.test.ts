// ทดสอบ API กับ server ที่รันอยู่: BASE=http://localhost:3999 npx ts-node tests/api.test.ts
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://localhost:3000";
let token = "";
let passed = 0;

async function call(method: string, path: string, body?: unknown, auth = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ไม่ใช่ JSON */ }
  return { status: res.status, json };
}

async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log("  ✔", name);
  } catch (e: any) {
    console.log("  ✘", name, "\n     ", e.message.split("\n").slice(0, 4).join("\n      "));
    process.exitCode = 1;
  }
}

async function main() {
  console.log("Auth");
  await t("ไม่มี token -> 401", async () => assert.equal((await call("GET", "/customers", undefined, false)).status, 401));
  await t("token ปลอม -> 401", async () => {
    token = "abc.def.ghi";
    assert.equal((await call("GET", "/customers")).status, 401);
    token = "";
  });
  await t("login ผิด -> 401", async () =>
    assert.equal((await call("POST", "/auth/login", { username: "owner", password: "x" }, false)).status, 401));
  await t("login ถูก -> 200 + token", async () => {
    const r = await call("POST", "/auth/login", { username: "owner", password: "owner1234" }, false);
    assert.equal(r.status, 200);
    token = r.json.data.accessToken;
    assert.ok(token);
  });
  await t("/auth/me", async () => assert.equal((await call("GET", "/auth/me")).json.data.user.username, "owner"));

  console.log("Settings");
  await t("GET settings", async () => {
    const r = await call("GET", "/api/v1/settings");
    assert.equal(r.status, 200);
    assert.equal(r.json.data.boxPrice, 65);
  });
  await t("PUT settings ผิด (deadline <= depart) -> 400", async () =>
    assert.equal((await call("PUT", "/settings", { departTime: "13:00", deadlineTime: "12:00" })).status, 400));
  await t("PUT settings ถูก -> 200", async () => {
    const r = await call("PUT", "/settings", { serviceTimeMin: 3 });
    assert.equal(r.status, 200);
  });
  const settings = (await call("GET", "/settings")).json.data;

  console.log("Customers");
  const phone = "08" + String(Date.now()).slice(-8);
  let cid = 0;
  await t("POST ลูกค้า -> 201", async () => {
    const r = await call("POST", "/customers", {
      first_name: "ทดสอบ", last_name: "ระบบ", phone_number: phone, latitude: 16.25, longitude: 103.26,
    });
    assert.equal(r.status, 201);
    cid = r.json.last_idx;
  });
  await t("POST เบอร์ซ้ำ -> 409", async () =>
    assert.equal(
      (await call("POST", "/customers", { first_name: "a", last_name: "b", phone_number: phone, latitude: 16.25, longitude: 103.26 })).status,
      409,
    ));
  await t("GET /customers/search?keyword=ทดสอบ", async () => {
    const r = await call("GET", "/customers/search?keyword=" + encodeURIComponent("ทดสอบ"));
    assert.ok(r.json.length >= 1);
  });
  await t("search SQL injection -> ไม่พบ ไม่ error", async () => {
    const r = await call("GET", "/customers/search?keyword=" + encodeURIComponent("' OR 1=1 --"));
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 0);
  });
  await t("nearby 1 กม. เรียงใกล้->ไกล", async () => {
    const r = await call("GET", `/customers/nearby?lat=${settings.depotLat}&lng=${settings.depotLng}&radius=1`);
    assert.equal(r.status, 200);
    const d = r.json.map((c: any) => c.distance_km);
    assert.ok(d.every((x: number) => x <= 1));
    assert.deepEqual(d, [...d].sort((a: number, b: number) => a - b));
  });
  await t("nearby ไม่ส่ง lat -> 400", async () => assert.equal((await call("GET", "/customers/nearby")).status, 400));
  await t("PUT ลูกค้า", async () =>
    assert.equal(
      (await call("PUT", `/customers/${cid}`, { first_name: "ทดสอบ2", last_name: "ระบบ", phone_number: phone, latitude: 16.25, longitude: 103.26 })).status,
      200,
    ));
  await t("GET ลูกค้า id ไม่มี -> 404", async () => assert.equal((await call("GET", "/customers/99999999")).status, 404));

  console.log("Orders");
  const DATE = "2031-01-15"; // วันทดสอบ (ไม่ชนข้อมูลจริง)
  await call("DELETE", `/orders/simulated?date=${DATE}`);
  let oid = 0;
  await t("POST order กล่อง 0 -> 400", async () =>
    assert.equal((await call("POST", "/orders", { customerId: cid, boxCount: 0, deliveryDate: DATE })).status, 400));
  await t("POST order กล่อง 4 -> 400", async () =>
    assert.equal((await call("POST", "/orders", { customerId: cid, boxCount: 4, deliveryDate: DATE })).status, 400));
  await t("POST order ลูกค้าไม่มี -> 404", async () =>
    assert.equal((await call("POST", "/orders", { customerId: 99999999, boxCount: 1, deliveryDate: DATE })).status, 404));
  await t("POST order -> 201 + snapshot", async () => {
    const r = await call("POST", "/orders", { customerId: cid, boxCount: 2, deliveryDate: DATE });
    assert.equal(r.status, 201);
    oid = r.json.data.order_id;
    assert.equal(r.json.data.unit_price, 65);
    assert.match(r.json.data.order_no, /^310115-\d{3}$/);
  });
  await t("PATCH order กล่อง -> 200", async () => {
    const r = await call("PATCH", `/orders/${oid}`, { boxCount: 3 });
    assert.equal(r.json.data.box_count, 3);
  });
  await t("simulate 19 / 31 -> 400", async () => {
    assert.equal((await call("POST", "/orders/simulate", { count: 19, deliveryDate: DATE })).status, 400);
    assert.equal((await call("POST", "/orders/simulate", { count: 31, deliveryDate: DATE })).status, 400);
  });
  await t("simulate 25 -> 201", async () => {
    const r = await call("POST", "/orders/simulate", { count: 25, mode: "append", deliveryDate: DATE });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.summary.count, 25);
    assert.ok(r.json.data.every((o: any) => o.box_count >= 1 && o.box_count <= 3));
  });
  await t("GET orders มี summary + ไม่ล็อก", async () => {
    const r = await call("GET", `/orders?date=${DATE}`);
    assert.equal(r.json.meta.total, 26);
    assert.equal(r.json.meta.locked, false);
  });
  await t("orders/nearby 2 กม. เฉพาะวันที่ระบุ", async () => {
    const r = await call("GET", `/orders/nearby?lat=${settings.depotLat}&lng=${settings.depotLng}&radiusKm=2&date=${DATE}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.data.every((o: any) => o.distance_m <= 2000 && String(o.delivery_date) === DATE));
    const other = await call("GET", `/orders/nearby?lat=${settings.depotLat}&lng=${settings.depotLng}&radiusKm=2&date=2031-01-16`);
    assert.equal(other.json.data.length, 0);
  });

  console.log("Dispatch");
  let plans: any[] = [];
  await t("คำนวณแผน -> 201 มี 3 แผน", async () => {
    const t0 = Date.now();
    const r = await call("POST", "/dispatch-plans", { deliveryDate: DATE });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    plans = r.json.data;
    assert.equal(plans.length, 3);
    assert.ok(Date.now() - t0 < 10000, "ช้าเกิน 10 วินาที");
    for (const p of plans) {
      assert.equal(p.orderCount, 26);
      assert.ok(p.isOnTime);
      assert.ok(Math.abs(p.profit - (p.revenue - p.foodCost - p.deliveryCost)) < 0.01);
    }
    const cost = plans.find((p) => p.objective === "MIN_COST");
    assert.ok(plans.every((p) => cost.deliveryCost <= p.deliveryCost + 0.01), "MIN_COST ต้องค่าไรเดอร์ต่ำสุด");
  });
  await t("รายละเอียดแผน: ทุกออเดอร์พอดี 1 ครั้ง, ≤3 จุด/รอบ, ผลรวมตรง", async () => {
    const r = await call("GET", `/dispatch-plans/${plans[0].planId}`);
    const d = r.json.data;
    const ids = d.routes.flatMap((x: any) => x.stops.map((s: any) => s.orderId));
    assert.equal(new Set(ids).size, 26);
    assert.equal(ids.length, 26);
    assert.ok(d.routes.every((x: any) => x.stops.length <= 3 && x.finishTime <= "12:30:00"));
    const fee = d.routes.reduce((s: number, x: any) => s + x.riderFee, 0);
    assert.ok(Math.abs(fee - d.deliveryCost) < 0.01);
    assert.equal(d.routes.reduce((s: number, x: any) => s + x.totalBoxes, 0), d.totalBoxes);
  });
  await t("คำนวณใหม่ (recalculate) -> 201 variant 2", async () => {
    const r = await call("POST", "/dispatch-plans", { deliveryDate: DATE, recalculate: true });
    assert.equal(r.status, 201);
    assert.equal(r.json.data[0].variantNo, 2);
    plans = r.json.data;
  });
  await t("แก้ออเดอร์ขณะมีแผนร่าง -> แผนร่างหาย", async () => {
    await call("PATCH", `/orders/${oid}`, { boxCount: 1 });
    const r = await call("GET", `/dispatch-plans?date=${DATE}&status=DRAFT`);
    assert.equal(r.json.data.length, 0);
    const c = await call("POST", "/dispatch-plans", { deliveryDate: DATE });
    plans = c.json.data;
    assert.equal(c.status, 201);
  });
  let planId = 0;
  let codes: string[] = [];
  await t("ยืนยันแผน -> ได้เลขใบงานทุก route", async () => {
    planId = plans.find((p) => p.objective === "MIN_COST").planId;
    const r = await call("POST", `/dispatch-plans/${planId}/confirm`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    codes = r.json.data.routes.map((x: any) => x.jobCode);
    assert.ok(codes.every((c) => /^[A-HJ-NP-Z2-9]{6}$/.test(c)));
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(r.json.data.status, "CONFIRMED");
  });
  await t("ยืนยันซ้ำ -> 409", async () =>
    assert.equal((await call("POST", `/dispatch-plans/${planId}/confirm`)).status, 409));
  await t("หลังยืนยัน แก้/ลบ/simulate/ล้าง/คำนวณ -> 409", async () => {
    assert.equal((await call("PATCH", `/orders/${oid}`, { boxCount: 2 })).json.error.code, "ORDER_LOCKED");
    assert.equal((await call("DELETE", `/orders/${oid}`)).status, 409);
    assert.equal((await call("POST", "/orders/simulate", { count: 20, deliveryDate: DATE })).status, 409);
    assert.equal((await call("DELETE", `/orders/simulated?date=${DATE}`)).status, 409);
    assert.equal((await call("POST", "/dispatch-plans", { deliveryDate: DATE })).status, 409);
  });
  await t("ตั้งชื่อไรเดอร์", async () => {
    const d = (await call("GET", `/dispatch-plans/${planId}`)).json.data;
    const r = await call("PATCH", `/dispatch-plans/${planId}/routes/${d.routes[0].routeId}`, {
      riderName: "สมศักดิ์", riderPhone: "0812345678",
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.routes[0].riderName, "สมศักดิ์");
  });
  await t("dashboard", async () => {
    const r = await call("GET", `/dashboard/summary?date=${DATE}`);
    assert.equal(r.json.data.planStatus, "CONFIRMED");
    assert.equal(r.json.data.orders, 26);
  });

  console.log("Jobs (public)");
  await t("ใบงานถูกต้อง -> 200 เฉพาะจุดของ route", async () => {
    // วันทดสอบอยู่อนาคต จึงไม่หมดอายุ
    const r = await call("GET", `/public/jobs/${codes[0]}`, undefined, false);
    assert.equal(r.status, 200);
    assert.ok(r.json.stops.length >= 1 && r.json.stops.length <= 3);
    assert.equal(r.json.stops.reduce((s: number, x: any) => s + x.boxCount, 0), r.json.totalBoxes);
    assert.equal(r.json.departTime, "11:30");
  });
  await t("ใบงานตัวพิมพ์เล็กก็เปิดได้", async () =>
    assert.equal((await call("GET", `/public/jobs/${codes[0]!.toLowerCase()}`, undefined, false)).status, 200));
  await t("เลขไม่มี -> 404", async () =>
    assert.equal((await call("GET", "/public/jobs/ZZZZZZ", undefined, false)).status, 404));

  await t("ยกเลิกแผน -> ใบงานใช้ไม่ได้ + ปลดล็อก", async () => {
    const r = await call("POST", `/dispatch-plans/${planId}/cancel`);
    assert.equal(r.status, 200);
    assert.equal((await call("GET", `/public/jobs/${codes[0]}`, undefined, false)).status, 404);
    assert.equal((await call("PATCH", `/orders/${oid}`, { boxCount: 2 })).status, 200);
    assert.equal((await call("POST", `/dispatch-plans/${planId}/cancel`)).status, 409);
  });
  await t("ยืนยันแผนใหม่หลังยกเลิกได้ (ไม่ชน UNIQUE)", async () => {
    const c = await call("POST", "/dispatch-plans", { deliveryDate: DATE });
    const r = await call("POST", `/dispatch-plans/${c.json.data[0].planId}/confirm`);
    assert.equal(r.status, 200);
    await call("POST", `/dispatch-plans/${c.json.data[0].planId}/cancel`);
  });

  console.log("Cleanup");
  await t("ล้างออเดอร์จำลอง + ลบออเดอร์/ลูกค้าทดสอบ", async () => {
    const r = await call("DELETE", `/orders/simulated?date=${DATE}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.deletedCount, 25);
  });
  await t("ลบ order กับ ลูกค้าที่มีออเดอร์ได้/ไม่ได้ตามกฎ", async () => {
    assert.equal((await call("DELETE", `/customers/${cid}`)).status, 409); // ยังมีออเดอร์
    assert.equal((await call("DELETE", `/orders/${oid}`)).status, 204);
    assert.equal((await call("DELETE", `/customers/${cid}`)).status, 200);
  });
  await t("ออเดอร์ไกลเกินส่งทัน -> 422 INFEASIBLE", async () => {
    const far = await call("POST", "/customers", {
      first_name: "ไกล", last_name: "มาก", phone_number: "07" + String(Date.now()).slice(-8), latitude: 17.5, longitude: 104.5,
    });
    const fid = far.json.last_idx;
    const o = await call("POST", "/orders", { customerId: fid, boxCount: 1, deliveryDate: "2031-01-16" });
    const r = await call("POST", "/dispatch-plans", { deliveryDate: "2031-01-16" });
    assert.equal(r.status, 422);
    assert.equal(r.json.error.code, "INFEASIBLE");
    await call("DELETE", `/orders/${o.json.data.order_id}`);
    await call("DELETE", `/customers/${fid}`);
  });

  console.log(`\nผ่าน ${passed} รายการ${process.exitCode ? " (มีที่ไม่ผ่าน)" : " ทั้งหมด"}`);
}

main();
