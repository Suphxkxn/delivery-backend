export interface Order {
  order_id: number;
  customer_id: number;
  box_count: number;
  is_simulated: number;
  created_at: string;
}

export interface OrderDetail extends Order {
  first_name: string;
  last_name: string;
  phone_number: string;
  latitude: number;
  longitude: number;
  distance_km?: number; 
}
