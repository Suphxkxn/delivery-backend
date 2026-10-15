-- =====================================================================
-- ระบบจัดเส้นทางส่งข้าวกล่อง: schema + ข้อมูลตั้งต้น (MySQL 8)
-- ใช้กับฐานข้อมูลใหม่/ว่าง: รันไฟล์นี้ทั้งไฟล์ได้เลย (รันซ้ำได้ ไม่ทำข้อมูลซ้ำ)
-- login: owner / owner1234
-- ถ้ามีตาราง orders แบบเก่า (คอลัมน์ is_simulated) ให้ใช้ `npm run db:setup`
-- แทน หรือรัน DROP TABLE orders; ก่อน
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  latitude DECIMAL(9,6) NOT NULL,
  longitude DECIMAL(9,6) NOT NULL,
  UNIQUE KEY uq_customers_phone (phone_number),
  KEY idx_customers_lat_lng (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  role ENUM('OWNER') NOT NULL DEFAULT 'OWNER',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shop_settings (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dispatch_plans (
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
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME NULL,
  confirmed_date DATE AS (IF(status = 'CONFIRMED', delivery_date, NULL)) STORED,
  UNIQUE KEY uq_plans_one_confirmed_per_day (confirmed_date),
  KEY idx_plans_date_status (delivery_date, status),
  CONSTRAINT fk_plans_user FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dispatch_routes (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dispatch_stops (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- ข้อมูลตั้งต้น
-- ---------------------------------------------------------------------
INSERT IGNORE INTO users (username, password_hash, display_name, role)
VALUES ('owner', 'scrypt$4a1df036e605427e6d6b1f33626f8598$a65bd8902ee7bc7eec83cc2f813b9cb4788f95b5650f251c15e1ee26348d3f2b8947d973cbd37bb7ec031e393f8233deed9bb8fd21e8e481429dfa55aa896ea9', 'เจ้าของร้าน', 'OWNER');

-- พิกัดร้านเป็นค่าสมมติ (มมส. ขามเรียง) แก้ได้ที่ PUT /settings
INSERT IGNORE INTO shop_settings (setting_id, shop_name, depot_lat, depot_lng)
VALUES (1, 'ข้าวกล่องเดลิเวอรี', 16.2467, 103.2554);

-- ลูกค้าตัวอย่าง 60 คน ในรัศมี 0.3-3 กม. จากร้าน (เบอร์ซ้ำจะถูกข้าม)
INSERT IGNORE INTO customers (first_name, last_name, phone_number, latitude, longitude) VALUES
('สมชาย','แสงทอง','0891000000',16.246700,103.258207),
('สมหญิง','ทองดี','0891007919',16.251736,103.249673),
('มานพ','ดีเลิศ','0891015838',16.234530,103.256513),
('วิชัย','ใจมานะ','0891023757',16.260174,103.266160),
('ใจดี','บุญมา','0891031676',16.242913,103.233103),
('สุดา','สุขใจ','0891039595',16.232477,103.278690),
('ประยุทธ','มั่นคง','0891047514',16.253467,103.253505),
('กมล','ศรีสุข','0891055433',16.236256,103.249751),
('นภา','พรหมมา','0891063352',16.252371,103.271572),
('อรทัย','รักษา','0891071271',16.254823,103.234902),
('สมชาย','แสงทอง','0891079190',16.223105,103.266902),
('สมหญิง','ทองดี','0891087109',16.252957,103.257444),
('มานพ','ดีเลิศ','0891095028',16.241024,103.245200),
('วิชัย','ใจมานะ','0891102947',16.243248,103.271758),
('ใจดี','บุญมา','0891110866',16.263748,103.242914),
('สุดา','สุขใจ','0891118785',16.221310,103.251975),
('ประยุทธ','มั่นคง','0891126704',16.250637,103.260265),
('กมล','ศรีสุข','0891134623',16.247148,103.244088),
('นภา','พรหมมา','0891142542',16.235675,103.266941),
('อรทัย','รักษา','0891150461',16.267070,103.254417),
('สมชาย','แสงทอง','0891158380',16.227387,103.238616),
('สมหญิง','ทองดี','0891166299',16.247455,103.261242),
('มานพ','ดีเลิศ','0891174218',16.252651,103.246490),
('วิชัย','ใจมานะ','0891182137',16.231889,103.258872),
('ใจดี','บุญมา','0891190056',16.264004,103.265726),
('สุดา','สุขใจ','0891197975',16.239189,103.230887),
('ประยุทธ','มั่นคง','0891205894',16.244515,103.260327),
('กมล','ศรีสุข','0891213813',16.255898,103.251389),
('นภา','พรหมมา','0891221732',16.232837,103.250208),
('อรทัย','รักษา','0891229651',16.255771,103.273372),
('สมชาย','แสงทอง','0891237570',16.252879,103.230970),
('สมหญิง','ทองดี','0891245489',16.242696,103.258083),
('มานพ','ดีเลิศ','0891253408',16.256085,103.257079),
('วิชัย','ใจมานะ','0891261327',16.237953,103.243639),
('ใจดี','บุญมา','0891269246',16.245130,103.275169),
('สุดา','สุขใจ','0891277165',16.264172,103.238559),
('ประยุทธ','มั่นคง','0891285084',16.242388,103.255423),
('กมล','ศรีสุข','0891293003',16.253421,103.261748),
('นภา','พรหมมา','0891300922',16.245421,103.241052),
('อรทัย','รักษา','0891308841',16.235461,103.270830),
('สมชาย','แสงทอง','0891316760',16.269678,103.251042),
('สมหญิง','ทองดี','0891324679',16.243430,103.253258),
('มานพ','ดีเลิศ','0891332598',16.248981,103.264063),
('วิชัย','ใจมานะ','0891340517',16.252809,103.242995),
('ใจดี','บุญมา','0891348436',16.229687,103.261973),
('สุดา','สุขใจ','0891356355',16.267918,103.264392),
('ประยุทธ','มั่นคง','0891364274',16.245238,103.252187),
('กมล','ศรีสุข','0891372193',16.244293,103.263537),
('นภา','พรหมมา','0891380112',16.257859,103.248585),
('อรทัย','รักษา','0891388031',16.229397,103.251534),
('สมชาย','แสงทอง','0891395950',16.259709,103.274467),
('สมหญิง','ทองดี','0891403869',16.247066,103.252336),
('มานพ','ดีเลิศ','0891411788',16.240818,103.260617),
('วิชัย','ใจมานะ','0891419707',16.259178,103.255871),
('ใจดี','บุญมา','0891427626',16.234413,103.242793),
('สุดา','สุขใจ','0891435545',16.247829,103.278294),
('ประยุทธ','มั่นคง','0891443464',16.263746,103.233901),
('กมล','ศรีสุข','0891451383',16.239494,103.256449),
('นภา','พรหมมา','0891459302',16.256616,103.262508),
('อรทัย','รักษา','0891467221',16.242929,103.238349);

-- (ไม่บังคับ) ออเดอร์จำลอง 25 รายการของวันนี้ (เวลาไทย) ไว้ทดสอบคำนวณเส้นทางทันที
-- ถ้าไม่ต้องการ ลบส่วนนี้ทิ้ง หรือเรียก POST /orders/simulate เอง
SET @d = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR));
SET @n = (SELECT COUNT(*) FROM orders WHERE delivery_date = @d);
INSERT INTO orders (order_no, customer_id, delivery_date, box_count, unit_price, unit_cost, delivery_lat, delivery_lng, source)
SELECT CONCAT(DATE_FORMAT(@d, '%y%m%d'), '-', LPAD(@n + (@r := @r + 1), 3, '0')),
       c.customer_id, @d, 1 + FLOOR(RAND() * 3), 65, 40, c.latitude, c.longitude, 'SIMULATED'
FROM (SELECT * FROM customers ORDER BY RAND() LIMIT 25) c, (SELECT @r := 0) v
WHERE @n = 0;
