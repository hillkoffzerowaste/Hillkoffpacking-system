# System Workflow Specification

ระบบจัดการออเดอร์และการแพ็คสินค้า ครอบคลุมการนำเข้าข้อมูล การตัดข้อมูลซ้ำ การตรวจแพ็คสินค้า และการคัดแยกเพื่อจัดส่ง

## Phase 1: Data Ingestion & Deduplication

### Multi-Format Order Import

พนักงานอัปโหลดไฟล์ หรือระบบดึงข้อมูลผ่าน API จาก 4 ช่องทางเข้าสู่ระบบกลาง

Supported sources:

- Shopee
- Lazada
- TikTok
- ใบสั่งจองทั่วไป

Supported ingestion methods:

- Excel
- CSV
- XPS
- API

### Field Mapping Logic

ระบบต้องแปลงหัวตารางของแต่ละช่องทางเข้าสู่ Centralized Schema เดียวกัน

| Channel | Order Key | Tracking | SKU | Quantity |
|---|---|---|---|---|
| Shopee | หมายเลขคำสั่งซื้อ | หมายเลขติดตามพัสดุ | เลขอ้างอิง SKU | จำนวน |
| Lazada | orderItemId หรือ orderNumber | trackingCode | sellerSku | อิงตามจำนวนบรรทัดของ Item Id |
| TikTok | Order ID | Tracking ID | Seller SKU | Quantity |
| Reservation | เลขที่ใบสั่งจอง | Auto-generate หรือใช้เลขใบสั่งจองแทน | รหัสสินค้า | จำนวน |

### Deduplication Logic

เมื่อมีการนำเข้าออเดอร์ ระบบต้องตรวจสอบข้อมูลซ้ำเสมอด้วยเงื่อนไขต่อไปนี้

- Tracking ID / Tracking Code
- Order ID / Order Number

หากพบข้อมูลเดิมในระบบ ต้องรองรับ action อย่างน้อย 2 แบบ

| Action | Behavior |
|---|---|
| Ignore | ข้ามออเดอร์ใหม่ และคงข้อมูลเดิมไว้ |
| Overwrite | เขียนทับข้อมูลเดิมด้วยข้อมูลนำเข้าล่าสุด |

ระบบต้องคงเหลือเพียง 1 unique record ต่อออเดอร์ เพื่อป้องกันการแพ็คซ้ำ

### Phase 1 Output

เมื่อนำเข้าและคัดกรองสำเร็จ ระบบต้อง

- สร้างหรืออัปเดต order record
- สร้าง order item records
- กำหนดสถานะเป็น Ready to Pack
- จัดกลุ่มตาม Shipping Provider
- บันทึก import timestamp และ deduplication action

## Phase 2: Packing Verification Process

### Packer Identification

ก่อนเริ่มงาน พนักงานต้องระบุตัวตนด้วยวิธีใดวิธีหนึ่ง

- สแกนบาร์โค้ดประจำตัวพนักงาน
- เลือกชื่อพนักงานจากระบบ

ระบบต้องบันทึกค่า Packed_By ลงในออเดอร์ที่กำลังแพ็ค

### Order Retrieval

Packing Station Dashboard ต้องเปิดช่องค้นหาโดย focus พร้อมรับ input จาก scanner หรือ keyboard

Supported retrieval methods:

| Method | Input | Result |
|---|---|---|
| Scan | Tracking ID หรือ Order ID จากใบปะหน้าขนส่ง | ดึงออเดอร์ขึ้นมาแสดงทันที |
| Manual Key | ชื่อลูกค้า หรือเลขที่ใบสั่งจอง | ค้นหาและเลือกออเดอร์ที่ตรงกัน |

### Item Verification via Scan

หน้าจอต้องแสดง SKU และจำนวนที่ต้องแพ็ค

พนักงานสแกน QR Code หรือ Barcode ที่ตัวสินค้าทีละชิ้น ระบบต้องตรวจสอบแบบ real time

| Case | System Behavior |
|---|---|
| SKU ถูกต้อง | เพิ่มจำนวนสะสม เช่น 1/2 |
| SKU ผิด | เล่นเสียงเตือน แสดงข้อความสีแดง และไม่ให้ผ่าน |
| จำนวนครบ | เปลี่ยนรายการเป็น Verified |
| ทุก SKU ครบ | เปลี่ยนสถานะออเดอร์เป็น Packed หรือ Verified |

หลังตรวจครบ พนักงานบรรจุสินค้าและปิดกล่องหรือซองให้เรียบร้อย

## Phase 3: Final Sorting & Dispatch

### Double-Scan Confirmation

หลังปิดผนึกกล่องแล้ว พนักงานต้องสแกน Shipping Label อีกครั้ง เพื่อยืนยันว่าออเดอร์ถูกแพ็คครบ 100% และพร้อมส่งออก

### Sorting & Routing Logic

เมื่อสแกนสำเร็จ ระบบต้องอ่าน Shipping Provider Name จากออเดอร์ และแสดงผลด้วยตัวอักษรขนาดใหญ่หรือเสียงพูด

Examples:

| Order Type | Display |
|---|---|
| Shopee / Lazada / TikTok | J&T Express, SPX, LEX TH |
| Reservation | ขนส่งทั่วไป / รถโรงงาน |

ระบบต้องอัปเดตสถานะเป็น Shipped / Handed Over พร้อม timestamp

### Physical Placement

พนักงานนำกล่องไปวางในโซน ตะกร้า หรือพาเลทของขนส่งแต่ละเจ้า เพื่อรอให้รถขนส่งเข้ามารับสินค้า

