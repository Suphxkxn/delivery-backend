import { conn } from "../dbconnect";

type Db = Pick<typeof conn, "query">;

// วันนั้นมีแผนที่ยืนยันแล้วหรือไม่ (ถ้ามี = ออเดอร์ถูกล็อก)
export async function isDateLocked(date: string, db: Db = conn): Promise<boolean> {
  const [rows] = await db.query(
    "SELECT 1 FROM dispatch_plans WHERE delivery_date = ? AND status = 'CONFIRMED' LIMIT 1",
    [date],
  );
  return (rows as any[]).length > 0;
}

// ลบแผนร่างของวัน (routes/stops ถูกลบตาม CASCADE) ใช้เมื่อออเดอร์เปลี่ยน
export async function dropDrafts(date: string, db: Db = conn): Promise<void> {
  await db.query("DELETE FROM dispatch_plans WHERE delivery_date = ? AND status = 'DRAFT'", [date]);
}

// ลบแผนร่าง + แผนที่ยกเลิกของวัน ก่อนลบออเดอร์ (stops อ้างออเดอร์แบบ RESTRICT)
export async function dropStalePlans(date: string, db: Db = conn): Promise<void> {
  await db.query("DELETE FROM dispatch_plans WHERE delivery_date = ? AND status IN ('DRAFT','CANCELLED')", [date]);
}
