import express from "express";
import { conn } from "../dbconnect";
import { AppError, rateLimit, todayBkk } from "../utils/http";

// ใบงานไรเดอร์ (public ไม่ต้อง login ใช้เลขใบงานเป็นสิทธิ์)
export const router = express.Router();

router.get("/jobs/:jobCode", rateLimit(30, 60_000), async (req, res) => {
  const code = String(req.params.jobCode).toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new AppError(404, "NOT_FOUND", "ไม่พบใบงาน");

  const [rows] = await conn.query(
    `SELECT r.route_id, r.job_code, r.total_boxes, r.rider_name, p.delivery_date, p.params_snapshot
     FROM dispatch_routes r JOIN dispatch_plans p ON p.plan_id = r.plan_id
     WHERE r.job_code = ? AND p.status = 'CONFIRMED'`,
    [code],
  );
  const r = (rows as any[])[0];
  if (!r) throw new AppError(404, "NOT_FOUND", "ไม่พบใบงาน");
  if (String(r.delivery_date) < todayBkk()) throw new AppError(410, "EXPIRED", "ใบงานหมดอายุ");

  const [stops] = await conn.query(
    `SELECT s.stop_seq, s.eta_time, o.box_count, o.delivery_lat, o.delivery_lng,
            c.first_name, c.last_name, c.phone_number
     FROM dispatch_stops s
     JOIN orders o ON o.order_id = s.order_id
     JOIN customers c ON c.customer_id = o.customer_id
     WHERE s.route_id = ? ORDER BY s.stop_seq`,
    [r.route_id],
  );
  const snap = r.params_snapshot;
  const dm = Number(snap.departMin);
  res.json({
    jobCode: r.job_code,
    date: r.delivery_date,
    departTime: `${String(Math.floor(dm / 60)).padStart(2, "0")}:${String(Math.round(dm % 60)).padStart(2, "0")}`,
    totalBoxes: r.total_boxes,
    riderName: r.rider_name,
    depot: { lat: snap.depotLat, lng: snap.depotLng },
    stops: (stops as any[]).map((s) => ({
      seq: s.stop_seq,
      customerName: `${s.first_name} ${s.last_name}`,
      phone: s.phone_number,
      lat: s.delivery_lat,
      lng: s.delivery_lng,
      boxCount: s.box_count,
      eta: String(s.eta_time).slice(0, 5),
    })),
  });
});
