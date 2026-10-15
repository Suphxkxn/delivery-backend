import express from "express";
import { conn } from "../dbconnect";
import { Customer, CustomerRow, CustomerWithDistance } from "../model/customer";
import { distanceKmSql, parseLatLng } from "../utils/geo";
import { AppError, parsePage } from "../utils/http";

export const router = express.Router();

// แปลงแถวจาก DB (snake_case) เป็นรูปแบบที่ API ตอบ (camelCase)
function toCustomer(r: CustomerRow): Customer {
  return {
    customerId: r.customer_id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone_number,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
  };
}

// ตรวจ body ของ POST/PUT คืนค่าที่ทำความสะอาดแล้ว
function parseCustomerBody(body: any) {
  const errors: string[] = [];
  const firstName = String(body?.firstName ?? "").trim();
  const lastName = String(body?.lastName ?? "").trim();
  const phone = String(body?.phone ?? "").trim();
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);

  if (!firstName || firstName.length > 100) errors.push("firstName ต้องมี 1-100 ตัวอักษร");
  if (!lastName || lastName.length > 100) errors.push("lastName ต้องมี 1-100 ตัวอักษร");
  if (!/^0\d{8,9}$/.test(phone)) errors.push("phone ต้องเป็นเบอร์โทร 9-10 หลักขึ้นต้นด้วย 0");
  if (body?.latitude === undefined || !(latitude >= -90 && latitude <= 90)) {
    errors.push("latitude ต้องเป็นตัวเลขระหว่าง -90 ถึง 90");
  }
  if (body?.longitude === undefined || !(longitude >= -180 && longitude <= 180)) {
    errors.push("longitude ต้องเป็นตัวเลขระหว่าง -180 ถึง 180");
  }
  if (errors.length) throw new AppError(400, "VALIDATION", errors.join("; "));
  return { firstName, lastName, phone, latitude, longitude };
}

async function findCustomer(id: unknown): Promise<Customer> {
  const [rows] = await conn.query("SELECT * FROM customers WHERE customer_id = ?", [id]);
  const r = (rows as CustomerRow[])[0];
  if (!r) throw new AppError(404, "NOT_FOUND", "ไม่พบลูกค้า");
  return toCustomer(r);
}

const SORTS: Record<string, string> = {
  id: "customer_id",
  name: "first_name, last_name",
};

// แสดงทั้งหมด + ค้นหาบางส่วนของชื่อหรือนามสกุล + แบ่งหน้า
router.get("/", async (req, res) => {
  const { page, limit, offset } = parsePage(req.query, 20, 500);
  const sortKey = String(req.query.sort ?? "id");
  const orderBy = SORTS[sortKey];
  if (!orderBy) throw new AppError(400, "VALIDATION", "sort ต้องเป็น id หรือ name");

  const q = String(req.query.q ?? "").trim();
  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    // escape \ % _ กันผู้ใช้ใส่ wildcard เอง
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    where.push("(first_name LIKE ? OR last_name LIKE ?)");
    params.push(like, like);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await conn.query(`SELECT * FROM customers ${w} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset,
  ]);
  const [cnt] = await conn.query(`SELECT COUNT(*) AS total FROM customers ${w}`, params);
  res.json({
    data: (rows as CustomerRow[]).map(toCustomer),
    meta: { page, limit, total: (cnt as any[])[0].total },
  });
});

// ลูกค้าในรัศมี (ค่าเริ่มต้น 1 กม.) เรียงใกล้ -> ไกล
router.get("/nearby", async (req, res) => {
  const point = parseLatLng(req.query.lat, req.query.lng);
  if (!point) {
    throw new AppError(400, "VALIDATION", "ต้องส่ง lat และ lng เป็นตัวเลข เช่น ?lat=16.2467&lng=103.2554");
  }
  const raw = req.query.radiusKm ?? req.query.radius;
  const radiusKm = raw === undefined ? 1 : Number(raw);
  if (isNaN(radiusKm) || radiusKm <= 0) {
    throw new AppError(400, "VALIDATION", "radiusKm ต้องเป็นตัวเลขมากกว่า 0");
  }
  const sql = `
    SELECT * FROM (
      SELECT *, ROUND(${distanceKmSql("latitude", "longitude")} * 1000) AS distance_m
      FROM customers
    ) AS t
    WHERE distance_m <= ?
    ORDER BY distance_m`;
  const [rows] = await conn.query(sql, [point.lat, point.lat, point.lng, radiusKm * 1000]);
  const data: CustomerWithDistance[] = (rows as any[]).map((r) => ({
    ...toCustomer(r),
    distanceM: Number(r.distance_m),
  }));
  res.json({ data });
});

router.get("/:id", async (req, res) => {
  res.json({ data: await findCustomer(req.params.id) });
});

router.post("/", async (req, res) => {
  const c = parseCustomerBody(req.body);
  let insertId: number;
  try {
    const [result] = await conn.query(
      "INSERT INTO customers (first_name, last_name, phone_number, latitude, longitude) VALUES (?,?,?,?,?)",
      [c.firstName, c.lastName, c.phone, c.latitude, c.longitude],
    );
    insertId = (result as any).insertId;
  } catch (e: any) {
    if (e.code === "ER_DUP_ENTRY") throw new AppError(409, "PHONE_EXISTS", "เบอร์โทรนี้มีลูกค้าใช้แล้ว");
    throw e;
  }
  res.status(201).json({ data: await findCustomer(insertId) });
});

router.put("/:id", async (req, res) => {
  const c = parseCustomerBody(req.body);
  await findCustomer(req.params.id); // 404 ถ้าไม่มี (affectedRows = 0 อาจแปลว่าค่าไม่เปลี่ยน จึงเช็กก่อน)
  try {
    await conn.query(
      "UPDATE customers SET first_name = ?, last_name = ?, phone_number = ?, latitude = ?, longitude = ? WHERE customer_id = ?",
      [c.firstName, c.lastName, c.phone, c.latitude, c.longitude, req.params.id],
    );
  } catch (e: any) {
    if (e.code === "ER_DUP_ENTRY") throw new AppError(409, "PHONE_EXISTS", "เบอร์โทรนี้มีลูกค้าใช้แล้ว");
    throw e;
  }
  res.json({ data: await findCustomer(req.params.id) });
});

router.delete("/:id", async (req, res) => {
  await findCustomer(req.params.id);
  try {
    await conn.query("DELETE FROM customers WHERE customer_id = ?", [req.params.id]);
  } catch (e: any) {
    if (e.code === "ER_ROW_IS_REFERENCED_2") {
      throw new AppError(409, "CUSTOMER_HAS_ORDERS", "ลูกค้ามีรายการสั่งซื้ออยู่ ต้องลบออเดอร์ก่อน");
    }
    throw e;
  }
  res.status(204).end();
});
