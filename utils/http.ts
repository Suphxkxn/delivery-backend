import { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// error handler ตัวสุดท้ายของ app (Express 5 ส่ง error จาก async มาให้เอง)
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "BAD_JSON", message: "JSON ไม่ถูกต้อง" } });
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
}

// rate limit ในหน่วยความจำ ต่อ IP
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    h.n++;
    if (h.n > max) {
      return res
        .status(429)
        .json({ error: { code: "TOO_MANY_REQUESTS", message: "ลองบ่อยเกินไป กรุณารอสักครู่" } });
    }
    next();
  };
}

// วันที่ปัจจุบันตามเวลา Asia/Bangkok รูปแบบ YYYY-MM-DD
export function todayBkk(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// อ่านวันที่จาก query/body ไม่ระบุ = วันนี้, ผิดรูปแบบ = 400
export function parseDate(v: unknown): string {
  if (v === undefined || v === null || v === "") return todayBkk();
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) {
    throw new AppError(400, "BAD_DATE", "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD");
  }
  return s;
}

export function parsePage(query: any, defLimit = 20, maxLimit = 500) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(query.limit ?? defLimit), 10) || defLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function minToTime(min: number): string {
  const t = Math.round(min * 60);
  const h = Math.floor(t / 3600) % 24;
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
}

export function timeToMin(t: string): number {
  const [h = 0, m = 0, s = 0] = t.split(":").map(Number);
  return h * 60 + m + s / 60;
}
