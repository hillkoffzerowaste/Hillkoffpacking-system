# Full Web App Notes

เว็บแอพตัวเต็มแบ่งหน้าจอออกตามงานจริงของคลังสินค้า เพื่อให้แต่ละทีมเปิดหน้าที่เกี่ยวข้องได้โดยตรง

## Screens

| Screen | Purpose |
|---|---|
| Dashboard | ดูคิวงาน สถานะรวม และจำนวนต่อขนส่ง |
| New Order | กรอกออเดอร์เอง เพิ่ม SKU/จำนวน และสร้างเป็น Ready to Pack |
| Import | อัปโหลด CSV/XLSX และตรวจผล deduplication |
| Packing | สแกนพนักงาน สแกนใบปะหน้า และสแกน SKU |
| Dispatch | สแกนรอบสุดท้ายและแสดงโซนขนส่ง |
| Orders | ค้นหาออเดอร์ ดูรายการสินค้า และตรวจสถานะ |
| Audit | ตรวจ scan events ทั้ง success/error |
| Settings | เพิ่ม packer และ shipping provider |

## Production Start Flow

1. เปิดเว็บแอพและล็อกอินด้วยบัญชีที่ตั้งค่าไว้
2. ตรวจหน้า Dashboard ให้เริ่มต้นเป็น 0 เมื่อยังไม่มีออเดอร์จริง
3. ตั้งค่าพนักงานแพ็คและขนส่งในหน้า Settings ถ้ายังไม่มี
4. ไปหน้า Import แล้วนำเข้าไฟล์ออเดอร์จริงจาก marketplace
5. ใช้หน้า Packing, Dispatch, Orders, Audit และ Reports ตาม flow งานจริง

## Backend Endpoints Added For Full App

- `GET /api/dashboard/summary`
- `POST /api/orders`
- `GET /api/orders`
- `GET /api/imports/batches`
- `POST /api/packers`
- `POST /api/shipping-providers`
- `GET /api/scan-events`
