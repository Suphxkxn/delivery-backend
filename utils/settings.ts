import { conn } from "../dbconnect";
import { AppError } from "./http";

export interface Settings {
  shopName: string;
  depotLat: number;
  depotLng: number;
  boxPrice: number;
  boxCost: number;
  riderBaseFee: number;
  riderRatePerKmBox: number;
  riderSpeedKmh: number;
  serviceTimeMin: number;
  maxOrdersRider: number;
  departTime: string;
  deadlineTime: string;
  serviceRadiusKm: number;
  roadFactor: number;
}

export async function getSettings(): Promise<Settings> {
  const [rows] = await conn.query("SELECT * FROM shop_settings WHERE setting_id = 1");
  const r = (rows as any[])[0];
  if (!r) throw new AppError(422, "NO_SETTINGS", "ยังไม่ได้ตั้งค่าร้าน (รัน npm run db:setup)");
  return {
    shopName: r.shop_name,
    depotLat: Number(r.depot_lat),
    depotLng: Number(r.depot_lng),
    boxPrice: Number(r.box_price),
    boxCost: Number(r.box_cost),
    riderBaseFee: Number(r.rider_base_fee),
    riderRatePerKmBox: Number(r.rider_rate_per_km_box),
    riderSpeedKmh: Number(r.rider_speed_kmh),
    serviceTimeMin: Number(r.service_time_min),
    maxOrdersRider: Number(r.max_orders_rider),
    departTime: String(r.depart_time).slice(0, 8),
    deadlineTime: String(r.deadline_time).slice(0, 8),
    serviceRadiusKm: Number(r.service_radius_km),
    roadFactor: Number(r.road_factor),
  };
}
