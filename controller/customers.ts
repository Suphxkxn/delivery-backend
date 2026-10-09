import express from "express";
import { conn } from "../dbconnect";
import { Customer, CustomerWithDistance } from "../model/customer";
import { distanceKmSql, parseLatLng } from "../utils/geo";

export const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const [rows] = await conn.query(
      "SELECT * FROM customers ORDER BY customer_id",
    );
    res.json(rows as Customer[]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/search", async (req, res) => {
  try {
    const keyword = String(req.query.keyword ?? "").trim();
    const fname = String(req.query.fname ?? "").trim();
    const lname = String(req.query.lname ?? "").trim();

    if (!keyword && !fname && !lname) {
      return res
        .status(400)
        .json({ error: "ส่ง keyword หรือ fname / lname อย่างน้อย 1 ค่า" });
    }

    const conditions: string[] = [];
    const params: string[] = [];
    if (keyword) {
      conditions.push("(first_name LIKE ? OR last_name LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (fname) {
      conditions.push("first_name LIKE ?");
      params.push(`%${fname}%`);
    }
    if (lname) {
      conditions.push("last_name LIKE ?");
      params.push(`%${lname}%`);
    }

    const sql = `SELECT * FROM customers WHERE ${conditions.join(" AND ")} ORDER BY first_name, last_name`;
    const [rows] = await conn.query(sql, params);
    res.json(rows as Customer[]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/nearby", async (req, res) => {
  try {
    const point = parseLatLng(req.query.lat, req.query.lng);
    if (!point) {
      return res.status(400).json({
        error: "ต้องส่ง lat และ lng เป็นตัวเลข เช่น ?lat=16.2467&lng=103.2554",
      });
    }
    const radius =
      req.query.radius === undefined ? 1 : Number(req.query.radius);
    if (isNaN(radius) || radius <= 0) {
      return res.status(400).json({ error: "radius ต้องเป็นตัวเลขมากกว่า 0" });
    }
    const sql = `
      SELECT * FROM (
        SELECT *, ROUND(${distanceKmSql("latitude", "longitude")}, 3) AS distance_km
        FROM customers
      ) AS t
      WHERE distance_km <= ?
      ORDER BY distance_km`;
    const [rows] = await conn.query(sql, [
      point.lat,
      point.lat,
      point.lng,
      radius,
    ]);
    res.json(rows as CustomerWithDistance[]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [rows] = await conn.query(
      "SELECT * FROM customers WHERE customer_id = ?",
      [req.params.id],
    );
    const customers = rows as Customer[];
    if (customers.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(customers[0]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const customer: Customer = req.body;

    const sql =
      "INSERT INTO `customers`(`first_name`, `last_name`, `phone_number`, `latitude`, `longitude`) VALUES (?,?,?,?,?)";
    const [result] = await conn.query(sql, [
      customer.first_name.trim(),
      customer.last_name.trim(),
      customer.phone_number,
      customer.latitude,
      customer.longitude,
    ]);
    const insertResult = result as any;
    res.status(201).json({
      affected_row: insertResult.affectedRows,
      last_idx: insertResult.insertId,
    });
  } catch (error: any) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "เบอร์โทรนี้มีลูกค้าใช้แล้ว" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const customer: Customer = req.body;

    const sql =
      "UPDATE `customers` SET `first_name`=?, `last_name`=?, `phone_number`=?, `latitude`=?, `longitude`=? WHERE `customer_id`=?";
    const [result] = await conn.query(sql, [
      customer.first_name.trim(),
      customer.last_name.trim(),
      customer.phone_number,
      customer.latitude,
      customer.longitude,
      id,
    ]);
    const updateResult = result as any;
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error: any) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "เบอร์โทรนี้มีลูกค้าใช้แล้ว" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    let customer_id = req.params.id;
    const [result] = await conn.query(
      "DELETE FROM customers WHERE customer_id = ?",
      [customer_id],
    );
    const deleteResult = result as any;
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error: any) {
    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res
        .status(409)
        .json({ error: "ลูกค้ามีรายการสั่งซื้ออยู่ ต้องลบออเดอร์ก่อน" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});