# Maintenance Flow Map

ไฟล์นี้คือแผนที่สำหรับแก้ระบบครั้งถัดไป อ่านไฟล์นี้ก่อน แล้วค่อยเปิดไฟล์จริงเฉพาะจุดที่เกี่ยวข้อง

## Runtime Modes

ระบบมี 3 โหมดข้อมูลที่ใช้ API shape เดียวกัน

| Mode | ใช้เมื่อ | Entry point |
|---|---|---|
| `api` | รัน local backend Express + SQLite | `frontend/src/main.jsx` -> `api()` -> `backend/src/routes.js` |
| `firebase` | Deploy แบบใช้ Firestore | `frontend/src/main.jsx` -> `firebaseApi()` -> `frontend/src/lib/firebaseAdapter.js` |
| `local` | GitHub Pages หรือ backend ติดต่อไม่ได้ | `frontend/src/main.jsx` -> `localApi()` ในไฟล์เดียวกัน |

ถ้าแก้ business rule เช่น scan SKU, order status, dispatch validation ต้องตรวจให้ behavior ตรงกันทั้ง 3 โหมด

## Main User Flow

1. Import หรือสร้าง order
   - Frontend screen: `ImportPage`, `NewOrderPage` ใน `frontend/src/main.jsx`
   - Backend import: `backend/src/importParser.js`, `backend/src/importMapping.js`, `backend/src/importService.js`
   - Frontend import parser สำหรับ browser/Firebase: `frontend/src/lib/importParser.js`
2. Packing
   - Screen: `PackingPage` ใน `frontend/src/main.jsx`
   - Camera scanner: `CameraScanner` ใน `frontend/src/main.jsx`
   - Backend endpoints:
     - `POST /api/packing/orders/lookup`
     - `POST /api/packing/orders/:id/scan-item`
     - `POST /api/packing/orders/:id/confirm-scan`
   - Backend barcode mapping: `resolveScannedOrderItem()` และ `rememberProductBarcode()` ใน `backend/src/routes.js`
   - Firebase barcode mapping: `resolveFirebaseScannedOrderItem()` ใน `frontend/src/lib/firebaseAdapter.js`
   - Local barcode mapping: `resolveLocalScannedOrderItem()` ใน `frontend/src/main.jsx`
3. Dispatch
   - Screen: `DispatchPage` ใน `frontend/src/main.jsx`
   - Endpoint: `POST /api/dispatch/final-scan`
4. Sales dispatch sheet
   - Screen: `SalesDispatchPage` ใน `frontend/src/main.jsx`
   - Backend routes: `/api/sales/dispatch-scans`
5. Audit / troubleshooting
   - Screen: `AuditPage` ใน `frontend/src/main.jsx`
   - Table: `scan_events`
   - Endpoint: `GET /api/scan-events`

## Barcode / SKU Scan Rules

สินค้าอาจสแกนได้ 2 แบบ

| Scan value | Expected behavior |
|---|---|
| ตรงกับ SKU ใน order | เพิ่ม `quantity_scanned` ของ SKU นั้น |
| เป็น product barcode ที่เคยผูกกับ SKU | ใช้ SKU ที่ผูกไว้ |
| เป็น product barcode ใหม่ และ order เหลือ SKU เดียวที่ยังไม่ครบ | ผูก barcode ใหม่กับ SKU นั้น แล้วเพิ่มจำนวน |
| เป็น product barcode ใหม่ และ order ยังมีหลาย SKU | ไม่เดา, แจ้ง `BARCODE_NOT_MAPPED` |
| ค่าว่าง | ไม่ผ่าน, แจ้ง `SCANNED_SKU_REQUIRED` |
| สแกนเกินจำนวน | ไม่ผ่าน, แจ้ง `QUANTITY_EXCEEDS_REMAINING` |

เหตุผล: ไม่ให้ระบบเดาสินค้าผิดในออเดอร์หลาย SKU แต่ยังช่วยลดงานเมื่อเป็นออเดอร์สินค้าเดียว

## Camera Scanner Notes

`CameraScanner` ใช้ `@zxing/browser`

| Profile | ใช้กับ | Optimization |
|---|---|---|
| `mixed` | ใบปะหน้า, dispatch, QR/barcode รวม | รองรับ 1D + QR + Data Matrix |
| `product` | SKU / barcode สินค้า | จำกัด format เป็น 1D barcode, เปิด `TRY_HARDER`, ขอความละเอียดสูง, กล้องหลัง, continuous focus, zoom เล็กน้อย, torch ถ้าเครื่องรองรับ |

ถ้า SKU ยังสแกนช้าในหน้างาน ให้ตรวจตามลำดับนี้

1. คุณภาพ/ขนาด barcode บนสินค้า: barcode ควรกว้างพอและมี quiet zone ซ้ายขวา
2. แสงสะท้อนบนซองหรือถุง: ลองเปิด torch หรือขยับมุม
3. ระยะกล้อง: ใช้ประมาณ 10-20 ซม. และให้เส้น barcode เต็มกรอบแนวนอน
4. Format barcode: ถ้าใช้ format ที่ไม่ได้อยู่ใน `CAMERA_SCAN_FORMATS.product` ให้เพิ่มที่ `frontend/src/main.jsx`
5. ถ้า browser ของมือถือไม่รองรับ zoom/focus/torch จะ fallback เหลือ camera constraints ปกติ แต่ยังสแกนได้

## Tests To Run

```powershell
npm test
npm run build -w frontend
```

Relevant tests:

| File | Covers |
|---|---|
| `backend/tests/importMapping.test.js` | mapping import columns by channel |
| `backend/tests/scanItem.test.js` | SKU scan validation and product barcode mapping |

## Known Production Risks

1. ข้อความไทยบางส่วนใน `frontend/src/main.jsx`, `frontend/src/lib/firebaseAdapter.js`, docs เก่าบางไฟล์มี mojibake จาก encoding เดิม ควรแยกงานแก้ i18n/ข้อความ UI หลังระบบ scan ผ่านแล้ว
2. `frontend/src/main.jsx` เป็นไฟล์ใหญ่รวมหลาย screen ถ้าจะพัฒนาต่อ ควรค่อย ๆ แยก component ตาม screen หลัง deploy รอบแรกนิ่งแล้ว
3. Camera feature บางอย่างขึ้นกับ browser/device เช่น torch, zoom, focus mode จึงต้องทดสอบบนมือถือจริงก่อนใช้งานเต็มรูปแบบ

## Safe Change Checklist

ก่อน push ทุกครั้ง

1. อ่าน flow ในไฟล์นี้
2. แก้ทั้ง `api`, `firebase`, `local` ถ้าเป็น business rule
3. เพิ่มหรือแก้ test ที่เกี่ยวกับ rule
4. รัน `npm test`
5. รัน `npm run build -w frontend`
6. เปิดหน้า app และทดสอบ flow หลักอย่างน้อย import/create order -> packing scan -> confirm -> dispatch
