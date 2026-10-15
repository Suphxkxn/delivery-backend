import express from "express";
import cors from "cors";
import { router as index } from "./controller/index";
import { router as settings } from "./controller/settings";
import { router as customers } from "./controller/customers";
import { router as order } from "./controller/order";
import { router as dispatch } from "./controller/dispatch";
import { router as jobs } from "./controller/jobs";
import { router as dashboard } from "./controller/dashboard";
import { errorHandler } from "./utils/http";

export const app = express();
// อยู่หลัง proxy ของ Render: ใช้ IP จริงของผู้ใช้ (X-Forwarded-For) สำหรับ rate limit
app.set("trust proxy", 1);

app.use(
  cors({
    origin: "*", // อนุญาตทุก origin (frontend deploy แล้ว URL เปลี่ยนบ่อย) ใช้ Bearer token ไม่ใช่ cookie จึงไม่เสี่ยง CSRF
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.text());
app.use(express.json());

app.use("/", index);

// เรียกได้ทั้ง /customers และ /api/v1/customers
for (const base of ["", "/api/v1"]) {
  app.use(`${base}/public`, jobs); // ใบงานไรเดอร์
  app.use(`${base}/settings`, settings);
  app.use(`${base}/customers`, customers);
  app.use(`${base}/order`, order);
  app.use(`${base}/orders`, order);
  app.use(`${base}/dispatch-plans`, dispatch);
  app.use(`${base}/dashboard`, dashboard);
}

app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "ไม่พบ endpoint นี้" } });
});
app.use(errorHandler);
