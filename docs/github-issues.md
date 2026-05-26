# GitHub Issues Backlog

รายการ issue ตั้งต้นสำหรับเปิดงานใน GitHub Project

## Milestone: Phase 1 - Data Ingestion & Deduplication

### [Phase 1] Design Centralized Order Schema

Define shared order, order item, shipping provider, import batch, and scan event schema.

Acceptance criteria:

- Orders support all 4 channels
- Tracking ID and Order ID are indexed for deduplication
- Order items support required and scanned quantities
- Status values are documented

### [Phase 1] Implement Shopee Import Mapping

Map Shopee source fields into centralized order schema.

Acceptance criteria:

- `หมายเลขคำสั่งซื้อ` maps to `order_id`
- `หมายเลขติดตามพัสดุ` maps to `tracking_id`
- `เลขอ้างอิง SKU` maps to `sku`
- `จำนวน` maps to `quantity_required`

### [Phase 1] Implement Lazada Import Mapping

Map Lazada source fields into centralized order schema.

Acceptance criteria:

- `orderItemId` or `orderNumber` maps to order key
- `trackingCode` maps to `tracking_id`
- `sellerSku` maps to `sku`
- Quantity can be calculated from item rows

### [Phase 1] Implement TikTok Import Mapping

Map TikTok source fields into centralized order schema.

Acceptance criteria:

- `Order ID` maps to `order_id`
- `Tracking ID` maps to `tracking_id`
- `Seller SKU` maps to `sku`
- `Quantity` maps to `quantity_required`

### [Phase 1] Implement Reservation Order Import

Import general reservation orders.

Acceptance criteria:

- `เลขที่ใบสั่งจอง` maps to `order_id`
- Missing tracking creates fallback tracking value
- `รหัสสินค้า` maps to `sku`
- `จำนวน` maps to `quantity_required`

### [Phase 1] Add Deduplication Logic

Prevent duplicate packing records.

Acceptance criteria:

- Existing `tracking_id` is detected
- Existing `order_id` is detected
- Ignore mode keeps existing order
- Overwrite mode replaces existing order data
- Import summary counts created, ignored, overwritten, and failed rows

## Milestone: Phase 2 - Packing Verification

### [Phase 2] Build Packing Station Dashboard

Create the main screen for packers.

Acceptance criteria:

- Requires packer identification before work
- Search input is focused by default
- Supports scanner and keyboard input
- Shows order items and scan progress

### [Phase 2] Add Packer Identification

Record who packed each order.

Acceptance criteria:

- Supports employee barcode scan
- Supports manual packer selection
- Saves `packed_by` to active order

### [Phase 2] Add SKU Scan Validation

Validate item barcode / QR code while packing.

Acceptance criteria:

- Correct SKU increments scanned quantity
- Incorrect SKU shows red blocking error
- Incorrect SKU plays error sound
- Completed item changes to Verified
- Completed order cannot be over-scanned without warning

## Milestone: Phase 3 - Final Sorting & Dispatch

### [Phase 3] Build Final Shipping Scan

Confirm sealed packages before dispatch.

Acceptance criteria:

- Scans tracking ID or order ID
- Rejects orders not yet packed
- Updates status to Shipped / Handed Over
- Saves shipped timestamp

### [Phase 3] Add Shipping Provider Routing Display

Show where the package should be placed.

Acceptance criteria:

- Displays provider name in large text
- Supports J&T Express, SPX, LEX TH, and general transport
- Records final scan event

