import express from "express";
import { conn } from "../dbconnect";
import { OrderDetail } from "../model/order";
import { distanceKmSql, parseLatLng } from "../utils/geo";

export const router = express.Router();

const ORDER_DETAIL_SQL = `
  SELECT o.order_id, o.customer_id, o.box_count, o.is_simulated, o.created_at,
         c.first_name, c.last_name, c.phone_number, c.latitude, c.longitude
  FROM orders o
  JOIN customers c ON c.customer_id = o.customer_id`;

function isValidBoxCount(value: unknown): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 3;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

router.get("/", async (req, res) => {
  try {
    let sql = ORDER_DETAIL_SQL;
    const params: unknown[] = [];
    if (req.query.simulated === "1" || req.query.simulated === "0") {
      sql += " WHERE o.is_simulated = ?";
      params.push(Number(req.query.simulated));
    }
    sql += " ORDER BY o.order_id";
    const [rows] = await conn.query(sql, params);
    res.json(rows as OrderDetail[]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});


router.post("/simulate", async (req, res) => {
  try {
    const count = req.body?.count === undefined ? randomInt(20, 30) : Number(req.body.count);
    if (!Number.isInteger(count) || count < 20 || count > 30) {
      return res.status(400).json({ error: "count ต้องเป็นจำนวนเต็ม 20-30" });
    }

    const [customerRows] = await conn.query(
      "SELECT customer_id FROM customers ORDER BY RAND() LIMIT ?",
      [count],
    );
    const customers = customerRows as { customer_id: number }[];
    if (customers.length < count) {
      return res.status(400).json({
        error: `มีลูกค้าแค่ ${customers.length} คน จำลอง ${count} ออเดอร์ไม่ได้ (เพิ่มลูกค้าก่อน)`,
      });
    }

    const values = customers.map((c) => [c.customer_id, randomInt(1, 3), 1]);

    const [result] = await conn.query(
      "INSERT INTO orders (customer_id, box_count, is_simulated) VALUES ?",
      [values],
    );
    const insertResult = result as any;

    const [rows] = await conn.query(
      `${ORDER_DETAIL_SQL}
       WHERE o.order_id >= ? AND o.is_simulated = 1 AND o.customer_id IN (?)
       ORDER BY o.order_id`,
      [insertResult.insertId, customers.map((c) => c.customer_id)],
    );
    const orders = rows as OrderDetail[];

    res.status(201).json({
      affected_row: insertResult.affectedRows,
      total_boxes: orders.reduce((sum, o) => sum + o.box_count, 0),
      orders,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});


router.delete("/simulate", async (req, res) => {
  try {
    const [result] = await conn.query("DELETE FROM orders WHERE is_simulated = 1");
    const deleteResult = result as any;
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/nearby", async (req, res) => {
  try {
    const point = parseLatLng(req.query.lat, req.query.lng);
    if (!point) {
      return res.status(400).json({ error: "ต้องส่ง lat และ lng เป็นตัวเลข เช่น ?lat=16.2467&lng=103.2554" });
    }
    const radius = req.query.radius === undefined ? 2 : Number(req.query.radius);
    if (isNaN(radius) || radius <= 0) {
      return res.status(400).json({ error: "radius ต้องเป็นตัวเลขมากกว่า 0" });
    }

    const sql = `
      SELECT * FROM (
        SELECT o.order_id, o.customer_id, o.box_count, o.is_simulated, o.created_at,
               c.first_name, c.last_name, c.phone_number, c.latitude, c.longitude,
               ROUND(${distanceKmSql("c.latitude", "c.longitude")}, 3) AS distance_km
        FROM orders o
        JOIN customers c ON c.customer_id = o.customer_id
      ) AS t
      WHERE distance_km <= ?
      ORDER BY distance_km`;
    const [rows] = await conn.query(sql, [point.lat, point.lat, point.lng, radius]);
    const orders = rows as OrderDetail[];
    res.json({
      count: orders.length,
      total_boxes: orders.reduce((sum, o) => sum + o.box_count, 0),
      orders,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [rows] = await conn.query(`${ORDER_DETAIL_SQL} WHERE o.order_id = ?`, [req.params.id]);
    const orders = rows as OrderDetail[];
    if (orders.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(orders[0]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});


router.post("/", async (req, res) => {
  try {
    const customerId = Number(req.body?.customer_id);
    const boxCount = req.body?.box_count;
    if (!Number.isInteger(customerId) || customerId < 1) {
      return res.status(400).json({ error: "customer_id ต้องเป็นจำนวนเต็ม" });
    }
    if (!isValidBoxCount(boxCount)) {
      return res.status(400).json({ error: "box_count ต้องเป็นจำนวนเต็ม 1-3" });
    }

    const [result] = await conn.query(
      "INSERT INTO orders (customer_id, box_count) VALUES (?, ?)",
      [customerId, Number(boxCount)],
    );
    const insertResult = result as any;
    res.status(201).json({
      affected_row: insertResult.affectedRows,
      last_idx: insertResult.insertId,
    });
  } catch (error: any) {
    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const boxCount = req.body?.box_count;
    if (!isValidBoxCount(boxCount)) {
      return res.status(400).json({ error: "box_count ต้องเป็นจำนวนเต็ม 1-3" });
    }
    const [result] = await conn.query("UPDATE orders SET box_count = ? WHERE order_id = ?", [
      Number(boxCount),
      req.params.id,
    ]);
    const updateResult = result as any;
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});


router.delete("/:id", async (req, res) => {
  try {
    const [result] = await conn.query("DELETE FROM orders WHERE order_id = ?", [req.params.id]);
    const deleteResult = result as any;
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
