import express from "express";
import { conn } from "../dbconnect";
import { AppError, timeToMin } from "../utils/http";
import { getSettings } from "../utils/settings";

export const router = express.Router();

router.get("/", async (req, res) => {
  res.json({ data: await getSettings() });
});

const NUMBERS: [string, string, number, number][] = [
  // [ชื่อใน body, ชื่อคอลัมน์, min, max]
  ["boxPrice", "box_price", 0, 100000],
  ["boxCost", "box_cost", 0, 100000],
  ["riderBaseFee", "rider_base_fee", 0, 100000],
  ["riderRatePerKmBox", "rider_rate_per_km_box", 0, 100000],
  ["riderSpeedKmh", "rider_speed_kmh", 1, 200],
  ["serviceTimeMin", "service_time_min", 0, 60],
  ["maxOrdersRider", "max_orders_rider", 1, 3],
  ["serviceRadiusKm", "service_radius_km", 0.1, 100],
  ["roadFactor", "road_factor", 1, 3],
];

router.put("/", async (req, res) => {
  const b = req.body ?? {};
  const cur = await getSettings();
  const merged: any = { ...cur, ...b }; // ส่งมาแค่บางค่าก็ได้
  const errors: string[] = [];

  const shopName = String(merged.shopName ?? "").trim();
  if (!shopName || shopName.length > 150) errors.push("shopName ต้องมี 1-150 ตัวอักษร");
  const lat = Number(merged.depotLat);
  const lng = Number(merged.depotLng);
  if (!(lat >= -90 && lat <= 90)) errors.push("depotLat ต้องอยู่ระหว่าง -90 ถึง 90");
  if (!(lng >= -180 && lng <= 180)) errors.push("depotLng ต้องอยู่ระหว่าง -180 ถึง 180");

  const sets: [string, unknown][] = [
    ["shop_name", shopName],
    ["depot_lat", lat],
    ["depot_lng", lng],
  ];
  for (const [key, col, min, max] of NUMBERS) {
    const v = Number(merged[key]);
    if (!Number.isFinite(v) || v < min || v > max || (min === 0 ? false : v < min)) {
      errors.push(`${key} ต้องเป็นตัวเลข ${min}-${max}`);
    }
    if (key === "maxOrdersRider" && !Number.isInteger(v)) errors.push("maxOrdersRider ต้องเป็นจำนวนเต็ม");
    sets.push([col, v]);
  }
  for (const [key, col] of [
    ["departTime", "depart_time"],
    ["deadlineTime", "deadline_time"],
  ] as const) {
    const v = String(merged[key]);
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(v)) errors.push(`${key} ต้องเป็นเวลา HH:MM`);
    sets.push([col, v.length === 5 ? v + ":00" : v]);
  }
  if (!errors.length && timeToMin(String(merged.deadlineTime)) <= timeToMin(String(merged.departTime))) {
    errors.push("deadlineTime ต้องมากกว่า departTime");
  }
  if (errors.length) throw new AppError(400, "VALIDATION", errors.join("; "));

  await conn.query(
    `UPDATE shop_settings SET ${sets.map(([c]) => `${c} = ?`).join(", ")}, updated_by = ? WHERE setting_id = 1`,
    [...sets.map(([, v]) => v), req.user!.id],
  );
  res.json({ data: await getSettings() });
});
