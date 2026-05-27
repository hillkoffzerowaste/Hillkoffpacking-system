# Order Packing System

ระบบจัดการออเดอร์และการแพ็คสินค้า สำหรับนำเข้าออเดอร์จากหลายช่องทาง ตรวจข้อมูลซ้ำ ตรวจสอบสินค้าระหว่างแพ็ค และคัดแยกตามขนส่งก่อนส่งออก

## Scope

ระบบแบ่งเป็น 3 เฟสหลัก

1. Data Ingestion & Deduplication
2. Packing Verification Process
3. Final Sorting & Dispatch

## Key Features

- Import ออเดอร์จาก Shopee, Lazada, TikTok และใบสั่งจองทั่วไป
- รองรับไฟล์ Excel, CSV, XPS และ API integration
- แปลงข้อมูลแต่ละช่องทางเข้าสู่ Centralized Schema
- ตรวจข้อมูลซ้ำด้วย Tracking ID หรือ Order ID
- Packing Station Dashboard สำหรับพนักงานแพ็ค
- ตรวจ SKU และจำนวนด้วย Barcode / QR Code scan
- แจ้งเตือนเมื่อสแกนสินค้าผิด
- Final scan เพื่อยืนยันว่าพร้อมส่ง
- แสดง Shipping Provider สำหรับคัดแยกกล่อง

## Documentation

- [Workflow Specification](docs/workflow-spec.md)
- [Database Schema](docs/database-schema.md)
- [API Specification](docs/api-spec.md)
- [User Flow](docs/user-flow.md)
- [GitHub Issues Backlog](docs/github-issues.md)

## Full Web Application

This repository now includes a runnable web app for the full workflow:

- Backend: Express + SQLite
- Frontend: React + Vite
- Import parsing: CSV and XLS/XLSX
- Demo data reset endpoint
- Multi-screen operations UI

### Run Locally

```powershell
npm install
npm run dev
```

Open:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:4000/api/health
```

GitHub Pages:

```text
https://hillkoffzerowaste.github.io/Hillkoffpacking-system/
```

On GitHub Pages, the app runs in browser local mode because GitHub Pages cannot run the Express/SQLite backend. Manual order entry, packing scan, dispatch scan, audit log, packers, and shipping providers are stored in the browser's `localStorage`.

Demo scan values:

```text
Packer barcode: EMP001
Order tracking: SPX-TRACK-1001
SKU scan: COF-DRIP-001
Final scan: SPX-TRACK-1001
```

Sample import files are available in `imports/`.

### Application Screens

- Dashboard: real-time operation metrics and shipping queue
- New Order: manual order entry with multiple SKU lines
- Import: marketplace/reservation file import and import history
- Packing: packer identification, order lookup, and SKU scan validation
- Dispatch: final scan with large shipping route display
- Orders: searchable order control center and item detail
- Audit: scan event log for troubleshooting
- Settings: packer and shipping provider setup

Manual order workflow:

```text
New Order -> enter order/tracking/customer -> add SKU and quantity -> Create Ready Order
Packing -> identify packer -> scan tracking -> scan each SKU by quantity
Dispatch -> scan tracking again -> route is displayed
```

Current app screen:

![Full App Dashboard](docs/full-app-dashboard-screenshot.png)

## Suggested Repository Structure

```text
order-packing-system/
├─ docs/
├─ backend/
│  ├─ src/
│  └─ tests/
├─ frontend/
│  ├─ src/
│  └─ tests/
├─ imports/
└─ README.md
```

## Main Status Flow

```text
Imported
-> Deduplicated
-> Ready to Pack
-> Packing In Progress
-> Verified
-> Packed
-> Shipped / Handed Over
```

## Recommended First Milestone

Phase 1 should be implemented first because the packing workflow depends on clean, unique, normalized order data.

Initial tasks:

- Design centralized order schema
- Implement import field mapping per channel
- Implement deduplication logic
- Store order items and shipping provider
- Mark imported orders as Ready to Pack
