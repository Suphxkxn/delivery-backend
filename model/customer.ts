export interface Customer {
    customer_id:  number;
    first_name:   string;
    last_name:    string;
    phone_number: string;
    latitude:     string;
    longitude:    string;
}

export interface CustomerWithDistance extends Customer {
  distance_km: number;
}