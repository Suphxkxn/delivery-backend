export interface Order {
  order_id: number;
  order_no: string;
  customer_id: number;
  delivery_date: string;
  box_count: number;
  unit_price: number;
  unit_cost: number;
  delivery_lat: number;
  delivery_lng: number;
  source: "MANUAL" | "SIMULATED";
  status: "PENDING" | "DISPATCHED";
  created_at: string;
}

export interface OrderDetail extends Order {
  first_name: string;
  last_name: string;
  phone_number: string;
}
