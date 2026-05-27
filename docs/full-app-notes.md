# Full Web App Notes

เว็บแอพตัวเต็มแบ่งหน้าจอออกตามงานจริงของคลังสินค้า เพื่อให้แต่ละทีมเปิดหน้าที่เกี่ยวข้องได้โดยตรง

## Screens

| Screen | Purpose |
|---|---|
| Dashboard | ดูคิวงาน สถานะรวม และจำนวนต่อขนส่ง |
| Import | อัปโหลด CSV/XLSX และตรวจผล deduplication |
| Packing | สแกนพนักงาน สแกนใบปะหน้า และสแกน SKU |
| Dispatch | สแกนรอบสุดท้ายและแสดงโซนขนส่ง |
| Orders | ค้นหาออเดอร์ ดูรายการสินค้า และตรวจสถานะ |
| Audit | ตรวจ scan events ทั้ง success/error |
| Settings | เพิ่ม packer และ shipping provider |

## Demo Flow

1. เปิด `http://localhost:5173`
2. กด `Load Demo` ที่ Dashboard
3. ไปหน้า Packing
4. ใช้ packer barcode `EMP001`
5. โหลดออเดอร์ด้วย `SPX-TRACK-1001`
6. สแกน SKU `COF-DRIP-001` จำนวน 2 ครั้ง
7. ไปหน้า Dispatch
8. สแกน `SPX-TRACK-1001`
9. ระบบแสดง route เป็น `SPX` และเปลี่ยนสถานะเป็น `Shipped / Handed Over`

## Backend Endpoints Added For Full App

- `GET /api/dashboard/summary`
- `GET /api/orders`
- `GET /api/imports/batches`
- `POST /api/packers`
- `POST /api/shipping-providers`
- `GET /api/scan-events`

