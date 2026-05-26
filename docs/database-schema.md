# Database Schema

เอกสารนี้เป็น schema ตั้งต้นสำหรับระบบจัดการออเดอร์และการแพ็คสินค้า

## Entity Overview

```text
orders
├─ order_items
├─ scan_events
└─ import_batches

packers
shipping_providers
```

## orders

เก็บข้อมูลออเดอร์ระดับหัวบิล

| Field | Type | Required | Description |
|---|---|---|---|
| id | uuid | yes | Primary key |
| channel | varchar | yes | shopee, lazada, tiktok, reservation |
| order_id | varchar | yes | หมายเลขคำสั่งซื้อจาก marketplace หรือใบสั่งจอง |
| order_item_id | varchar | no | ใช้กับ Lazada หรือ channel ที่มี item id |
| tracking_id | varchar | yes | Tracking ID / Tracking Code |
| customer_name | varchar | no | ชื่อลูกค้า |
| shipping_provider_id | uuid | no | Reference to shipping_providers |
| status | varchar | yes | Current order status |
| packed_by | uuid | no | Reference to packers |
| imported_at | datetime | yes | เวลานำเข้า |
| ready_to_pack_at | datetime | no | เวลาพร้อมแพ็ค |
| packing_started_at | datetime | no | เวลาเริ่มแพ็ค |
| packed_at | datetime | no | เวลาแพ็คเสร็จ |
| shipped_at | datetime | no | เวลาส่งออก |
| source_file_name | varchar | no | ชื่อไฟล์ที่นำเข้า |
| deduplication_action | varchar | no | created, ignored, overwritten |
| created_at | datetime | yes | Created timestamp |
| updated_at | datetime | yes | Updated timestamp |

Recommended unique indexes:

```sql
unique(tracking_id)
unique(channel, order_id)
```

## order_items

เก็บรายการสินค้าในออเดอร์

| Field | Type | Required | Description |
|---|---|---|---|
| id | uuid | yes | Primary key |
| order_id | uuid | yes | Reference to orders.id |
| sku | varchar | yes | SKU ที่ต้องแพ็ค |
| product_name | varchar | no | ชื่อสินค้า |
| quantity_required | integer | yes | จำนวนที่ต้องแพ็ค |
| quantity_scanned | integer | yes | จำนวนที่สแกนแล้ว |
| status | varchar | yes | pending, partial, verified |
| created_at | datetime | yes | Created timestamp |
| updated_at | datetime | yes | Updated timestamp |

Recommended unique index:

```sql
unique(order_id, sku)
```

## scan_events

เก็บประวัติการสแกนทุกครั้ง เพื่อ audit และแก้ปัญหาหน้างาน

| Field | Type | Required | Description |
|---|---|---|---|
| id | uuid | yes | Primary key |
| order_id | uuid | no | Reference to orders.id |
| order_item_id | uuid | no | Reference to order_items.id |
| packer_id | uuid | no | Reference to packers.id |
| scan_type | varchar | yes | packer, order_lookup, item_verify, final_dispatch |
| scanned_value | varchar | yes | ค่าที่ scanner อ่านได้ |
| result | varchar | yes | success, error |
| message | varchar | no | รายละเอียด error หรือ validation |
| created_at | datetime | yes | Scan timestamp |

## import_batches

เก็บประวัติการ import แต่ละครั้ง

| Field | Type | Required | Description |
|---|---|---|---|
| id | uuid | yes | Primary key |
| source | varchar | yes | file, api |
| channel | varchar | yes | shopee, lazada, tiktok, reservation |
| file_name | varchar | no | ชื่อไฟล์ |
| total_rows | integer | yes | จำนวน rows ที่อ่านได้ |
| created_count | integer | yes | จำนวนออเดอร์ใหม่ |
| ignored_count | integer | yes | จำนวนที่ข้าม |
| overwritten_count | integer | yes | จำนวนที่เขียนทับ |
| error_count | integer | yes | จำนวน error |
| status | varchar | yes | processing, completed, failed |
| created_at | datetime | yes | Created timestamp |
| completed_at | datetime | no | Completed timestamp |

## packers

| Field | Type | Required | Description |
|---|---|---|---|
| id | uuid | yes | Primary key |
| employee_code | varchar | yes | รหัสพนักงาน |
| barcode | varchar | yes | Barcode สำหรับสแกนเข้า station |
| display_name | varchar | yes | ชื่อแสดงผล |
| active | boolean | yes | สถานะใช้งาน |
| created_at | datetime | yes | Created timestamp |
| updated_at | datetime | yes | Updated timestamp |

## shipping_providers

| Field | Type | Required | Description |
|---|---|---|---|
| id | uuid | yes | Primary key |
| code | varchar | yes | Provider code |
| name | varchar | yes | ชื่อขนส่ง เช่น J&T Express, SPX, LEX TH |
| display_name | varchar | yes | ข้อความที่แสดงหน้าจอ Sorting |
| active | boolean | yes | สถานะใช้งาน |
| created_at | datetime | yes | Created timestamp |
| updated_at | datetime | yes | Updated timestamp |

## Status Values

```text
Imported
Deduplicated
Ready to Pack
Packing In Progress
Verified
Packed
Shipped / Handed Over
Cancelled
```

