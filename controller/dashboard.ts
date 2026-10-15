import express from "express";
import { conn } from "../dbconnect";
import { parseDate } from "../utils/http";

export const router = express.Router();

router.get("/summary", async (req, res) => {
  const date = parseDate(req.query.date);
  const [s] = await conn.query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(box_count),0) AS boxes,
            COALESCE(SUM(box_count * unit_price),0) AS revenue
     FROM orders WHERE delivery_date = ?`,
    [date],
  );
  const [plans] = await conn.query(
    `SELECT plan_id, status, objective, profit, delivery_cost, rider_count, latest_arrival, is_on_time
     FROM dispatch_plans WHERE delivery_date = ? AND status IN ('DRAFT','CONFIRMED')
     ORDER BY (status = 'CONFIRMED') DESC, plan_id DESC`,
    [date],
  );
  const latest = (plans as any[])[0];
  const row = (s as any[])[0];
  res.json({
    data: {
      date,
      orders: row.orders,
      boxes: Number(row.boxes),
      revenue: Number(row.revenue),
      planStatus: latest ? latest.status : "NONE",
      latestPlan: latest
        ? {
            planId: latest.plan_id,
            objective: latest.objective,
            profit: latest.profit,
            deliveryCost: latest.delivery_cost,
            riderCount: latest.rider_count,
            latestArrival: String(latest.latest_arrival).slice(0, 8),
            isOnTime: !!latest.is_on_time,
          }
        : null,
    },
  });
});
