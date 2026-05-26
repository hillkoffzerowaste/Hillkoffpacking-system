# API Specification

API spec ตั้งต้นสำหรับ backend ระบบจัดการออเดอร์และการแพ็คสินค้า

## Conventions

- Request / response ใช้ JSON ยกเว้น file upload
- Timezone ควรจัดเก็บเป็น UTC และแสดงผลตาม timezone ของคลังสินค้า
- Error response ควรมี `code`, `message`, และ `details`

## Import APIs

### POST /api/imports/orders

อัปโหลดไฟล์ออเดอร์เข้าสู่ระบบ

Request:

```text
multipart/form-data
file: Excel / CSV / XPS
channel: shopee | lazada | tiktok | reservation
deduplication_action: ignore | overwrite
```

Response:

```json
{
  "batch_id": "uuid",
  "status": "completed",
  "total_rows": 100,
  "created_count": 80,
  "ignored_count": 15,
  "overwritten_count": 5,
  "error_count": 0
}
```

### POST /api/imports/orders/api-sync

ดึงออเดอร์จาก API ภายนอก

Request:

```json
{
  "channel": "shopee",
  "deduplication_action": "ignore",
  "from": "2026-05-01T00:00:00Z",
  "to": "2026-05-27T23:59:59Z"
}
```

## Order APIs

### GET /api/orders/search

ค้นหาออเดอร์จาก Packing Station

Query parameters:

```text
q=tracking_id | order_id | customer_name | reservation_number
status=Ready to Pack
```

Response:

```json
{
  "orders": [
    {
      "id": "uuid",
      "channel": "shopee",
      "order_id": "2500012345",
      "tracking_id": "TH123456789",
      "customer_name": "Customer Name",
      "shipping_provider": "J&T Express",
      "status": "Ready to Pack"
    }
  ]
}
```

### GET /api/orders/{id}

ดึงรายละเอียดออเดอร์และรายการสินค้า

Response:

```json
{
  "id": "uuid",
  "order_id": "2500012345",
  "tracking_id": "TH123456789",
  "status": "Packing In Progress",
  "items": [
    {
      "id": "uuid",
      "sku": "SKU-001",
      "product_name": "Product A",
      "quantity_required": 2,
      "quantity_scanned": 1,
      "status": "partial"
    }
  ]
}
```

## Packing APIs

### POST /api/packing/session

เริ่ม session ของพนักงานแพ็ค

Request:

```json
{
  "packer_barcode": "EMP001"
}
```

Response:

```json
{
  "packer_id": "uuid",
  "display_name": "Somchai"
}
```

### POST /api/packing/orders/lookup

ดึงออเดอร์จากการสแกนใบปะหน้า

Request:

```json
{
  "lookup_value": "TH123456789",
  "packer_id": "uuid"
}
```

Response:

```json
{
  "order_id": "uuid",
  "status": "Packing In Progress",
  "items": []
}
```

### POST /api/packing/orders/{id}/scan-item

ตรวจ SKU จากการสแกนสินค้า

Request:

```json
{
  "packer_id": "uuid",
  "scanned_sku": "SKU-001"
}
```

Success response:

```json
{
  "result": "success",
  "sku": "SKU-001",
  "quantity_scanned": 2,
  "quantity_required": 2,
  "item_status": "verified",
  "order_status": "Verified"
}
```

Error response:

```json
{
  "result": "error",
  "code": "SKU_NOT_IN_ORDER",
  "message": "SKU does not match this order"
}
```

## Dispatch APIs

### POST /api/dispatch/final-scan

สแกนใบปะหน้ารอบสุดท้ายเพื่อส่งออก

Request:

```json
{
  "tracking_or_order_id": "TH123456789",
  "packer_id": "uuid"
}
```

Response:

```json
{
  "order_id": "uuid",
  "status": "Shipped / Handed Over",
  "shipping_provider": {
    "code": "JNT",
    "display_name": "J&T Express"
  },
  "shipped_at": "2026-05-27T10:30:00Z"
}
```

