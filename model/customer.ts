// แถวจากตาราง customers (ชื่อคอลัมน์ตาม DB)
export interface CustomerRow {
  customer_id: number;
  first_name: string;
  last_name: string;
  phone_number: string;
  latitude: number | string;
  longitude: number | string;
}

// รูปแบบที่ API ตอบ
export interface Customer {
  customerId: number;
  firstName: string;
  lastName: string;
  phone: string;
  latitude: number;
  longitude: number;
}

export interface CustomerWithDistance extends Customer {
  distanceM: number;
}
