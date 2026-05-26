# User Flow

เอกสารนี้สรุป flow การทำงานของผู้ใช้แต่ละบทบาท

## Roles

| Role | Responsibility |
|---|---|
| Admin / Import Staff | นำเข้าไฟล์ ตรวจผล import และจัดการข้อมูลซ้ำ |
| Packer | แพ็คสินค้าและสแกนตรวจ SKU |
| Dispatch Staff | สแกนยืนยันรอบสุดท้ายและคัดแยกขนส่ง |

## Flow 1: Import Orders

1. User เปิดหน้า Import Orders
2. เลือก channel เช่น Shopee, Lazada, TikTok หรือ Reservation
3. เลือกไฟล์ Excel, CSV หรือ XPS
4. เลือก deduplication action: Ignore หรือ Overwrite
5. กด Import
6. ระบบอ่านไฟล์และ map fields เข้าสู่ Centralized Schema
7. ระบบตรวจ Tracking ID หรือ Order ID ซ้ำ
8. ระบบแสดง import summary
9. ออเดอร์ที่พร้อมใช้งานถูกตั้งสถานะเป็น Ready to Pack

## Flow 2: Packing Station

1. Packer เปิด Packing Station Dashboard
2. ระบบขอให้ระบุตัวตน
3. Packer สแกนบาร์โค้ดพนักงาน หรือเลือกชื่อจากรายการ
4. ระบบ focus ช่องค้นหาออเดอร์
5. Packer สแกนใบปะหน้าขนส่ง หรือค้นหาด้วยชื่อ / เลขใบสั่งจอง
6. ระบบแสดงข้อมูลออเดอร์และรายการสินค้า
7. Packer สแกน barcode หรือ QR code ของสินค้าแต่ละชิ้น
8. ระบบตรวจ SKU และนับจำนวนสะสม
9. หาก SKU ผิด ระบบแสดงข้อความ error สีแดงและเล่นเสียงเตือน
10. เมื่อสินค้าครบทุก SKU ระบบแสดงสถานะ Verified
11. Packer บรรจุสินค้าและปิดกล่อง

## Flow 3: Final Sorting & Dispatch

1. Dispatch Staff นำกล่องที่ปิดแล้วมาที่จุด Final Scan
2. สแกนใบปะหน้าขนส่งอีกครั้ง
3. ระบบตรวจว่าออเดอร์อยู่ในสถานะ Packed หรือ Verified
4. ระบบแสดงชื่อ Shipping Provider ขนาดใหญ่
5. ระบบอัปเดตสถานะเป็น Shipped / Handed Over
6. ระบบบันทึก shipped timestamp
7. Staff นำกล่องไปวางในโซนขนส่งที่ถูกต้อง

## Error States

| Scenario | Expected Behavior |
|---|---|
| Import file missing required column | Reject row and show error summary |
| Duplicate order with Ignore mode | Keep old record and count as ignored |
| Duplicate order with Overwrite mode | Replace order data and count as overwritten |
| Scan unknown tracking | Show order not found |
| Scan SKU not in order | Show red error and play error sound |
| Scan item after quantity complete | Show quantity already completed |
| Final scan before packed | Reject and ask user to complete packing first |

