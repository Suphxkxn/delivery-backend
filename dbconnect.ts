import { createPool } from 'mysql2/promise';

export const conn = createPool({
    connectionLimit: 10,
    host: 'mysql-delivery-web-delivery.h.aivencloud.com',
    port: 26145,
    user: 'avnadmin',
    password: 'AVNS_0oYuHvOJuPKTipG_WLf',
    database: 'delivery',
});

