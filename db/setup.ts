// สร้าง/ปรับตารางตาม ERD แล้วใส่ข้อมูลตั้งต้น  รัน: npm run db:setup (รันซ้ำได้)
import { conn } from "../dbconnect";

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column],
  );
  return (rows as any[]).length > 0;
}

async function indexExists(table: string, index: string): Promise<boolean> {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1",
    [table, index],
  );
  return (rows as any[]).length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [table],
  );
  return (rows as any[]).length > 0;
}

async function addColumn(table: string, column: string, ddl: string) {
  if (!(await columnExists(table, column))) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
    console.log(`  + ${table}.${column}`);
  }
}

async function main() {
  console.log("สร้างตาราง...");

  await conn.query(`CREATE TABLE IF NOT EXISTS users (
    user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    role ENUM('OWNER') NOT NULL DEFAULT 'OWNER',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS shop_settings (
    setting_id TINYINT UNSIGNED PRIMARY KEY,
    shop_name VARCHAR(150) NOT NULL,
    depot_lat DECIMAL(9,6) NOT NULL,
    depot_lng DECIMAL(9,6) NOT NULL,
    box_price DECIMAL(8,2) NOT NULL DEFAULT 65.00,
    box_cost DECIMAL(8,2) NOT NULL DEFAULT 40.00,
    rider_base_fee DECIMAL(8,2) NOT NULL DEFAULT 15.00,
    rider_rate_per_km_box DECIMAL(8,2) NOT NULL DEFAULT 2.00,
    rider_speed_kmh DECIMAL(5,2) NOT NULL DEFAULT 30.00,
    service_time_min DECIMAL(4,1) NOT NULL DEFAULT 3.0,
    max_orders_rider TINYINT UNSIGNED NOT NULL DEFAULT 3,
    depart_time TIME NOT NULL DEFAULT '11:30:00',
    deadline_time TIME NOT NULL DEFAULT '12:30:00',
    service_radius_km DECIMAL(4,1) NOT NULL DEFAULT 3.0,
    road_factor DECIMAL(4,2) NOT NULL DEFAULT 1.30,
    updated_by INT UNSIGNED NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_settings_one CHECK (setting_id = 1),
    CONSTRAINT chk_settings_time CHECK (deadline_time > depart_time),
    CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // customers เป็นของเดิม: ไม่ลบข้อมูล แค่เติม index
  if (!(await indexExists("customers", "uq_customers_phone"))) {
    try {
      await conn.query("ALTER TABLE customers ADD UNIQUE KEY uq_customers_phone (phone_number)");
    } catch (e: any) {
      console.warn("  ! เพิ่ม UNIQUE เบอร์โทรไม่ได้ (อาจมีเบอร์ซ้ำในข้อมูลเดิม):", e.code);
    }
  }
  if (!(await indexExists("customers", "idx_customers_lat_lng"))) {
    await conn.query("ALTER TABLE customers ADD KEY idx_customers_lat_lng (latitude, longitude)");
  }

  // orders: ถ้ามีของเดิม (order_id, customer_id, box_count, is_simulated, created_at) ให้ปรับเพิ่มคอลัมน์
  if (!(await tableExists("orders"))) {
    await conn.query(`CREATE TABLE orders (
      order_id INT AUTO_INCREMENT PRIMARY KEY,
      order_no VARCHAR(20) NOT NULL,
      customer_id INT NOT NULL,
      delivery_date DATE NOT NULL,
      box_count TINYINT UNSIGNED NOT NULL,
      unit_price DECIMAL(8,2) NOT NULL,
      unit_cost DECIMAL(8,2) NOT NULL,
      delivery_lat DECIMAL(9,6) NOT NULL,
      delivery_lng DECIMAL(9,6) NOT NULL,
      source ENUM('MANUAL','SIMULATED') NOT NULL DEFAULT 'MANUAL',
      status ENUM('PENDING','DISPATCHED') NOT NULL DEFAULT 'PENDING',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_orders_order_no (order_no),
      KEY idx_orders_date_status (delivery_date, status),
      KEY idx_orders_date_source (delivery_date, source),
      CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT,
      CONSTRAINT chk_orders_boxes CHECK (box_count BETWEEN 1 AND 3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } else {
    await addColumn("orders", "order_no", "VARCHAR(20) NULL");
    await addColumn("orders", "delivery_date", "DATE NULL");
    await addColumn("orders", "unit_price", "DECIMAL(8,2) NULL");
    await addColumn("orders", "unit_cost", "DECIMAL(8,2) NULL");
    await addColumn("orders", "delivery_lat", "DECIMAL(9,6) NULL");
    await addColumn("orders", "delivery_lng", "DECIMAL(9,6) NULL");
    await addColumn("orders", "source", "ENUM('MANUAL','SIMULATED') NOT NULL DEFAULT 'MANUAL'");
    await addColumn("orders", "status", "ENUM('PENDING','DISPATCHED') NOT NULL DEFAULT 'PENDING'");
    await addColumn("orders", "updated_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    if (await columnExists("orders", "is_simulated")) {
      await conn.query("UPDATE orders SET source = IF(is_simulated = 1, 'SIMULATED', 'MANUAL')");
      await conn.query("ALTER TABLE orders DROP COLUMN is_simulated");
    }
    // เติมข้อมูลเดิมให้ครบ (snapshot ราคา/พิกัด)
    await conn.query(
      `UPDATE orders o JOIN customers c ON c.customer_id = o.customer_id
       SET o.delivery_date = COALESCE(o.delivery_date, DATE(o.created_at)),
           o.unit_price = COALESCE(o.unit_price, 65), o.unit_cost = COALESCE(o.unit_cost, 40),
           o.delivery_lat = COALESCE(o.delivery_lat, c.latitude),
           o.delivery_lng = COALESCE(o.delivery_lng, c.longitude)`,
    );
    await conn.query(
      `UPDATE orders SET order_no = CONCAT(DATE_FORMAT(delivery_date, '%y%m%d'), '-', LPAD(order_id, 3, '0'))
       WHERE order_no IS NULL`,
    );
    await conn.query(`ALTER TABLE orders
      MODIFY order_no VARCHAR(20) NOT NULL, MODIFY delivery_date DATE NOT NULL,
      MODIFY unit_price DECIMAL(8,2) NOT NULL, MODIFY unit_cost DECIMAL(8,2) NOT NULL,
      MODIFY delivery_lat DECIMAL(9,6) NOT NULL, MODIFY delivery_lng DECIMAL(9,6) NOT NULL`);
    if (!(await indexExists("orders", "uq_orders_order_no")))
      await conn.query("ALTER TABLE orders ADD UNIQUE KEY uq_orders_order_no (order_no)");
    if (!(await indexExists("orders", "idx_orders_date_status")))
      await conn.query("ALTER TABLE orders ADD KEY idx_orders_date_status (delivery_date, status)");
    if (!(await indexExists("orders", "idx_orders_date_source")))
      await conn.query("ALTER TABLE orders ADD KEY idx_orders_date_source (delivery_date, source)");
  }

  await conn.query(`CREATE TABLE IF NOT EXISTS dispatch_plans (
    plan_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    delivery_date DATE NOT NULL,
    status ENUM('DRAFT','CONFIRMED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    objective ENUM('MIN_COST','MIN_DISTANCE','MIN_LATEST_ARRIVAL') NOT NULL,
    variant_no SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    algorithm VARCHAR(30) NOT NULL,
    params_snapshot JSON NOT NULL,
    order_count SMALLINT UNSIGNED NOT NULL,
    total_boxes SMALLINT UNSIGNED NOT NULL,
    rider_count SMALLINT UNSIGNED NOT NULL,
    total_distance_m INT UNSIGNED NOT NULL,
    latest_arrival TIME NOT NULL,
    revenue DECIMAL(10,2) NOT NULL,
    food_cost DECIMAL(10,2) NOT NULL,
    delivery_cost DECIMAL(10,2) NOT NULL,
    profit DECIMAL(10,2) NOT NULL,
    is_on_time TINYINT(1) NOT NULL,
    compute_ms INT UNSIGNED NULL,
    created_by INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_at DATETIME NULL,
    confirmed_date DATE AS (IF(status = 'CONFIRMED', delivery_date, NULL)) STORED,
    UNIQUE KEY uq_plans_one_confirmed_per_day (confirmed_date),
    KEY idx_plans_date_status (delivery_date, status),
    CONSTRAINT fk_plans_user FOREIGN KEY (created_by) REFERENCES users(user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query("ALTER TABLE dispatch_plans MODIFY created_by INT UNSIGNED NULL");

  await conn.query(`CREATE TABLE IF NOT EXISTS dispatch_routes (
    route_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plan_id INT UNSIGNED NOT NULL,
    route_no TINYINT UNSIGNED NOT NULL,
    color_hex CHAR(7) NOT NULL,
    job_code CHAR(6) NULL,
    rider_name VARCHAR(100) NULL,
    rider_phone VARCHAR(20) NULL,
    stop_count TINYINT UNSIGNED NOT NULL,
    total_boxes TINYINT UNSIGNED NOT NULL,
    distance_m INT UNSIGNED NOT NULL,
    duration_min DECIMAL(5,1) NOT NULL,
    finish_time TIME NOT NULL,
    rider_fee DECIMAL(8,2) NOT NULL,
    UNIQUE KEY uq_routes_plan_no (plan_id, route_no),
    UNIQUE KEY uq_routes_job_code (job_code),
    CONSTRAINT fk_routes_plan FOREIGN KEY (plan_id) REFERENCES dispatch_plans(plan_id) ON DELETE CASCADE,
    CONSTRAINT chk_routes_stops CHECK (stop_count BETWEEN 1 AND 3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS dispatch_stops (
    stop_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    route_id INT UNSIGNED NOT NULL,
    order_id INT NOT NULL,
    stop_seq TINYINT UNSIGNED NOT NULL,
    leg_distance_m INT UNSIGNED NOT NULL,
    cumulative_dist_m INT UNSIGNED NOT NULL,
    eta_time TIME NOT NULL,
    UNIQUE KEY uq_stops_route_seq (route_id, stop_seq),
    UNIQUE KEY uq_stops_route_order (route_id, order_id),
    KEY idx_stops_order (order_id),
    CONSTRAINT fk_stops_route FOREIGN KEY (route_id) REFERENCES dispatch_routes(route_id) ON DELETE CASCADE,
    CONSTRAINT fk_stops_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE RESTRICT,
    CONSTRAINT chk_stops_seq CHECK (stop_seq BETWEEN 1 AND 3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log("ข้อมูลตั้งต้น...");
  // พิกัดร้านเป็นค่าสมมติ (บริเวณ มมส. ขามเรียง) แก้ได้ที่ PUT /settings
  await conn.query(
    `INSERT IGNORE INTO shop_settings (setting_id, shop_name, depot_lat, depot_lng)
     VALUES (1, 'ข้าวกล่องเดลิเวอรี', 16.2467, 103.2554)`,
  );

  // ลูกค้าตัวอย่างรอบร้าน 50 คน (deterministic) ถ้ายังมีน้อยกว่า 30 คน
  const [cnt] = await conn.query("SELECT COUNT(*) AS n FROM customers");
  if ((cnt as any[])[0].n < 30) {
    const first = ["สมชาย", "สมหญิง", "มานพ", "วิชัย", "ใจดี", "สุดา", "ประยุทธ", "กมล", "นภา", "อรทัย"];
    const last = ["ใจมานะ", "แสงทอง", "ศรีสุข", "บุญมา", "ทองดี", "พรหมมา", "สุขใจ", "ดีเลิศ", "รักษา", "มั่นคง"];
    const rows: any[] = [];
    for (let i = 0; i < 50; i++) {
      const ang = (i * 137.508 * Math.PI) / 180;
      const km = 0.3 + ((i * 53) % 270) / 100;
      rows.push([
        first[i % 10],
        last[(i * 3 + 1) % 10],
        `089${String(1000000 + i * 7919).slice(0, 7)}`,
        (16.2467 + (km * Math.sin(ang)) / 111.32).toFixed(6),
        (103.2554 + (km * Math.cos(ang)) / (111.32 * Math.cos((16.2467 * Math.PI) / 180))).toFixed(6),
      ]);
    }
    await conn.query(
      "INSERT IGNORE INTO customers (first_name, last_name, phone_number, latitude, longitude) VALUES ?",
      [rows],
    );
  }

  for (const t of ["users", "shop_settings", "customers", "orders", "dispatch_plans", "dispatch_routes", "dispatch_stops"]) {
    const [r] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    console.log(`  ${t}: ${(r as any[])[0].n} แถว`);
  }
  await conn.end();
  console.log("เสร็จสิ้น");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
