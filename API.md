# API สำหรับ Frontend

Base URL: `http://localhost:3000` (ทุก path ใช้ได้ทั้ง `/xxx` และ `/api/v1/xxx`)
Login: `owner` / `owner1234`  ·  วันที่ใช้ `YYYY-MM-DD` (ไม่ส่ง = วันนี้เวลาไทย)

ทุก route ยกเว้น `/auth/login`, `/public/*`, `/health` ต้องมี header `Authorization: Bearer <accessToken>`

**รูปแบบ error ทุก endpoint** `{ "error": { "code", "message" } }`
**รูปแบบสำเร็จ** `{ "data": ..., "meta": ... }` (ยกเว้น `DELETE` ที่ตอบ 204 ไม่มี body และ `/public/jobs` ที่ตอบ object ตรง ๆ)
**ชื่อ field** camelCase ทั้ง body ที่ส่งและผลที่ตอบ ยกเว้นรายการออเดอร์ (`/orders`) ที่ field ตอบกลับยังเป็น snake_case (`order_id`, `box_count`, `first_name`) ดูหัวข้อ Orders

## Auth
| Method | Path | Body | ตอบ |
|---|---|---|---|
| POST | /auth/login | `{username,password}` | `{data:{accessToken,expiresIn,user}}` · 400/401/429 (5 ครั้ง/นาที) |
| GET | /auth/me | – | `{data:{user}}` |

## Settings
| GET /settings | → `{data:{shopName,depotLat,depotLng,boxPrice,boxCost,riderBaseFee,riderRatePerKmBox,riderSpeedKmh,serviceTimeMin,maxOrdersRider,departTime,deadlineTime,serviceRadiusKm,roadFactor}}` |
|---|---|
| PUT /settings | ส่งบางค่าหรือทั้งชุดก็ได้ → 200 / 400 |

## Customers
ลูกค้า: `{customerId, firstName, lastName, phone, latitude, longitude}`

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | /customers?q=&page=1&limit=20&sort=id | `q` ค้นบางส่วนของชื่อ **หรือ** นามสกุล · `sort` = `id` หรือ `name` · limit ≤ 500 · ตอบ `{data[], meta:{page,limit,total}}` |
| GET | /customers/nearby?lat=&lng=&radiusKm=1 | เรียงใกล้→ไกล ตอบ `{data[{...,distanceM}]}` · 400 ถ้าไม่ส่ง lat/lng |
| GET | /customers/:id | `{data}` · 404 `NOT_FOUND` |
| POST | /customers | body `{firstName,lastName,phone,latitude,longitude}` → 201 `{data}` · 400 `VALIDATION` · 409 `PHONE_EXISTS` |
| PUT | /customers/:id | body เหมือน POST → 200 `{data}` · 404 · 409 |
| DELETE | /customers/:id | 204 · 404 · 409 `CUSTOMER_HAS_ORDERS` |

กฎ validate: ชื่อ/นามสกุล 1–100 ตัว, `phone` ต้องเป็น `^0\d{8,9}$`, latitude ±90, longitude ±180

## Orders (`/orders` หรือ `/order`)
หมายเหตุ: ออเดอร์ที่ตอบกลับมี field แบบ snake_case (`order_id`, `order_no`, `box_count`, `delivery_date`, `first_name`, `phone_number` ฯลฯ) ส่วน body ตอนสร้าง/แก้ใช้ camelCase (`customerId`, `boxCount`, `deliveryDate`)
| Method | Path | หมายเหตุ |
|---|---|---|
| GET | /orders?date=&source=&status=&q=&page=&limit= | `{data[],meta:{page,limit,total,totalBoxes,revenue,foodCost,locked}}` |
| GET | /orders/nearby?lat=&lng=&radiusKm=2&date= | `{data[]}` มี `distance_m` |
| GET | /orders/:id | `{data}` |
| POST | /orders | `{customerId,boxCount(1-3),deliveryDate?}` → 201 |
| PATCH | /orders/:id | `{boxCount}` |
| DELETE | /orders/:id | 204 |
| POST | /orders/simulate | `{count:20-30, mode:'append'\|'replace', deliveryDate?}` → 201 `{data[],summary}` · 422 ลูกค้าไม่พอ |
| DELETE | /orders/simulated?date= | ลบเฉพาะออเดอร์จำลอง → `{deletedCount}` |

วันที่มีแผน CONFIRMED แล้ว: POST/PATCH/DELETE/simulate/ล้าง → **409 `ORDER_LOCKED`** (ต้องยกเลิกแผนก่อน)
แก้ออเดอร์ขณะมีแผนร่าง → แผนร่างของวันนั้นถูกลบ (ให้ UI แจ้งว่าต้องคำนวณใหม่)

## Dispatch Plans (`/dispatch-plans`)
| Method | Path | หมายเหตุ |
|---|---|---|
| POST | / | `{deliveryDate?, objectives?, recalculate?}` → 201 `{data: planSummary[]}` มี 3 แผน (`MIN_COST`, `MIN_DISTANCE`, `MIN_LATEST_ARRIVAL`) · 409 ยืนยันแล้ว · 422 `NO_ORDERS` / `INFEASIBLE` |
| GET | /?date=&status= | รายการแผน |
| GET | /:id | รายละเอียด: `depot`, `routes[{routeId,routeNo,colorHex,jobCode,riderName,riderPhone,totalBoxes,distanceM,durationMin,finishTime,riderFee,stops[{seq,orderNo,customerName,phone,lat,lng,boxCount,legDistanceM,eta}]}]` |
| POST | /:id/confirm | ออก `jobCode` ทุก route · 409 `PLAN_STALE` / `BAD_STATUS` / `ALREADY_CONFIRMED` |
| POST | /:id/cancel | เฉพาะแผน CONFIRMED · ใบงานใช้ไม่ได้ ปลดล็อกออเดอร์ |
| PATCH | /:id/routes/:routeId | `{riderName?,riderPhone?}` |

planSummary: `planId, deliveryDate, status, objective, variantNo, orderCount, totalBoxes, riderCount, totalDistanceM, latestArrival, revenue, foodCost, deliveryCost, profit, isOnTime, computeMs`
"คำนวณใหม่" = ส่ง `recalculate:true` (ได้แผนที่ต่างจากร่างเดิม)

## Rider (public ไม่ต้อง login)
`GET /public/jobs/:jobCode` (30 ครั้ง/นาที/IP, ไม่แยกตัวพิมพ์)
→ `{jobCode,date,departTime,totalBoxes,riderName,depot:{lat,lng},stops:[{seq,customerName,phone,lat,lng,boxCount,eta}]}`
404 ไม่พบ/ถูกยกเลิก · 410 หมดอายุ (พ้นวันส่ง) · 429

ลิงก์นำทางสร้างฝั่ง frontend:
`https://www.google.com/maps/dir/?api=1&origin=<depot>&destination=<จุดสุดท้าย>&waypoints=<จุดอื่น | คั่น>&travelmode=driving`

## Dashboard
`GET /dashboard/summary?date=` → `{data:{date,orders,boxes,revenue,planStatus:'NONE'|'DRAFT'|'CONFIRMED',latestPlan}}`

## Health
`GET /health` → 200 `{status:'ok'}` / 503

## รัน
```
npm install
npm run db:setup   # สร้าง/migrate ตาราง + ข้อมูลตั้งต้น (รันซ้ำได้)
npm run dev        # http://localhost:3000
npm test           # ทดสอบ engine (ไม่ใช้ DB)
BASE=http://localhost:3000 npm run test:api   # ทดสอบ API ทั้งชุด (ต้องเปิด server + DB, ใช้วันที่ 2031-01-15/16 แล้วล้างเอง)
```
ตัวแปรสภาพแวดล้อมดู `.env.example`
