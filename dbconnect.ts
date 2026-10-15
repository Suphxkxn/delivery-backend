import { createPool } from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

// ca.pem อยู่นอกโฟลเดอร์ backend (รันจาก ts หรือจาก dist ก็หาเจอ)
const caPath = [
    process.env.DB_CA_PATH,
    path.join(__dirname, '..', 'ca.pem'),
    path.join(__dirname, '..', '..', 'ca.pem'),
].find((p) => p && fs.existsSync(p));

// บน Render ไม่มีไฟล์ ca.pem: วางเนื้อหา certificate ทั้งก้อนในตัวแปร DB_CA_CERT แทน
const ca = process.env.DB_CA_CERT
    ? process.env.DB_CA_CERT.replace(/\\n/g, "\n")
    : caPath
      ? fs.readFileSync(caPath)
      : undefined;

export const conn = createPool({
    connectionLimit: 10,
    host: process.env.DB_HOST ?? 'mysql-delivery-web-delivery.h.aivencloud.com',
    port: Number(process.env.DB_PORT ?? 26145),
    user: process.env.DB_USER ?? 'avnadmin',
    password: process.env.DB_PASSWORD ?? 'AVNS_0oYuHvOJuPKTipG_WLf',
    database: process.env.DB_NAME ?? 'delivery',
    ...(ca ? { ssl: { ca } } : {}),
    dateStrings: true,
    decimalNumbers: true,
});

