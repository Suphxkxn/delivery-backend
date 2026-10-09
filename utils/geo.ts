// สูตร Haversine เขียนเป็น SQL: ระยะทาง (กม.) จากพิกัดในตารางถึงจุด (?, ?)
// ใช้ได้ทั้ง MySQL, MariaDB และ TiDB (TiDB ไม่มี ST_Distance_Sphere)
//
// latCol / lngCol = ชื่อคอลัมน์ละติจูด/ลองจิจูดในตาราง
// เวลาใช้ต้องส่งพารามิเตอร์ 3 ตัวตามลำดับ: [lat, lat, lng]
export function distanceKmSql(latCol: string, lngCol: string): string {
  return `(6371 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(${latCol} - ?) / 2), 2) +
      COS(RADIANS(?)) * COS(RADIANS(${latCol})) *
      POWER(SIN(RADIANS(${lngCol} - ?) / 2), 2)
  )))`;
}

// ตรวจ lat / lng ที่ส่งมาทาง query string
// คืน null ถ้าผิด เพื่อให้ controller ตอบ 400
export function parseLatLng(latRaw: unknown, lngRaw: unknown) {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (latRaw === undefined || lngRaw === undefined || isNaN(lat) || isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
