# Marketplace API Integration

ชุดไฟล์นี้เตรียม backend สำหรับเชื่อม Shopee Open Platform, Lazada Open Platform และ TikTok Shop Partner Center โดยไม่เก็บ secret ไว้ใน frontend หรือ Git

## สิ่งที่มีให้แล้ว

- OAuth authorization และ callback ต่อแพลตฟอร์ม
- เข้ารหัส access/refresh token ด้วย AES-256-GCM ก่อนเก็บใน SQLite
- refresh access token เมื่อใกล้หมดอายุ
- request signing สำหรับ Shopee, Lazada และ TikTok Shop
- ดึง order แล้วแปลงเข้าสู่ `importRows()` เดิม
- webhook endpoints พร้อมตรวจ HMAC signature และป้องกัน event ซ้ำ
- ตาราง `marketplace_connections` และ `marketplace_webhook_events`
- environment template ที่ `.env.marketplaces.example`

## ไฟล์หลัก

```text
backend/src/marketplaces/
├─ config.js       ค่า endpoint และ credentials
├─ crypto.js       signing และ token encryption
├─ http.js         HTTP client พร้อม timeout/error handling
├─ tokenStore.js   จัดเก็บ token ต่อร้าน
├─ shopee.js       Shopee OAuth/API client
├─ lazada.js       Lazada OAuth/API client
├─ tiktok.js       TikTok Shop OAuth/API client
├─ mappers.js      แปลง order เป็นรูปแบบ import ของระบบ
├─ service.js      authorization, refresh และ order sync
├─ webhooks.js     webhook signature verification
└─ routes.js       REST endpoints

frontend/src/lib/marketplaceApi.js
                   frontend client สำหรับ status, authorize, sync และ disconnect
```

ไฟล์สำหรับทดสอบและส่งต่อทีม:

```text
.env.marketplaces.example
docs/marketplace-api.openapi.yaml
docs/marketplace-api.postman_collection.json
```

## การตั้งค่า

1. คัดลอก `.env.marketplaces.example` ไปเป็น `.env` ของ backend
2. สร้างค่า encryption key:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

3. สมัครและสร้างแอปใน Partner Center ของแต่ละแพลตฟอร์ม
4. ขอสิทธิ์อย่างน้อยสำหรับ:
   - shop/seller authorization
   - read orders
   - read order details/items
   - logistics/tracking
   - order status webhooks
5. ตั้ง callback URL และ webhook URL ตามหัวข้อถัดไป

## Callback URLs

```text
Shopee:  https://YOUR_API/api/integrations/shopee/callback
Lazada:  https://YOUR_API/api/integrations/lazada/callback
TikTok:  https://YOUR_API/api/integrations/tiktok/callback
```

## Webhook URLs

```text
Shopee:  POST https://YOUR_API/api/integrations/shopee/webhook
Lazada:  POST https://YOUR_API/api/integrations/lazada/webhook
TikTok:  POST https://YOUR_API/api/integrations/tiktok/webhook
```

Marketplace dashboard ต้องตั้ง secret/signature algorithm ให้ตรงกับค่าที่อนุมัติให้แอป หากแพลตฟอร์มส่ง signature header ชื่ออื่น ให้เพิ่มชื่อ header ใน `webhooks.js`

## API ของระบบเรา

### ตรวจสถานะ

```http
GET /api/integrations/status
```

### ขอ URL สำหรับเชื่อมร้าน

```http
GET /api/integrations/shopee/authorize
GET /api/integrations/lazada/authorize
GET /api/integrations/tiktok/authorize
```

เปิด `authorization_url` ที่ได้ใน browser แล้วล็อกอินด้วยบัญชี seller

### ดึงออเดอร์

```http
POST /api/integrations/shopee/sync
Content-Type: application/json

{
  "shop_id": "SHOP_ID",
  "from": "2026-06-17T00:00:00Z",
  "to": "2026-06-18T23:59:59Z",
  "deduplication_action": "ignore"
}
```

เปลี่ยน `shopee` เป็น `lazada` หรือ `tiktok` ได้

### ยกเลิกการเชื่อมร้าน

```http
DELETE /api/integrations/{channel}/connections/{shopId}
```

## ข้อควรระวัง

- Marketplace secret และ token ต้องอยู่ backend เท่านั้น
- Production callback/webhook ต้องเป็น HTTPS
- ห้ามใช้ `INTEGRATION_TOKEN_ENCRYPTION_KEY` คนละค่าหลังมี token อยู่แล้ว เพราะจะถอดรหัส token เดิมไม่ได้
- API path และ response fields อาจต่างตาม app type, region และ API version จึงกำหนด override ได้ผ่าน environment
- OAuth state ถูกเก็บใน SQLite เพื่อรองรับการ restart ระหว่าง authorization
- Backend ปัจจุบันใช้ SQLite จึงเหมาะกับ single instance; production แบบ serverless หรือหลาย instance ควรย้าย connection/state/event storage ไปฐานข้อมูล shared
- เว็บ production ปัจจุบันที่ใช้ Firebase โดยตรงจะยังไม่เรียก backend integration นี้ ต้อง deploy backend ที่มี HTTPS และกำหนด `VITE_DATA_MODE=api`/`VITE_API_BASE` หรือเพิ่ม proxy จาก Firebase mode มายัง backend ก่อนเปิด sync ในหน้าเว็บ

## เอกสารทางการ

- Shopee Open Platform Developer Guide: https://open.shopee.com/developer-guide
- Lazada Open Platform API Reference: https://open.lazada.com/apps/doc/api
- Lazada Seller Authorization: https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777
- TikTok Shop Partner Center API Overview: https://partner.tiktokshop.com/docv2/page/tts-api-concepts-overview
