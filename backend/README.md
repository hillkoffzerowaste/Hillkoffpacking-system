# Backend

Backend service for order import, deduplication, packing verification, and dispatch confirmation.

Recommended modules:

- imports
- orders
- packing
- dispatch
- packers
- shipping-providers

## Run

```powershell
npm run dev -w backend
```

The API runs on `http://localhost:4000/api`.

## Marketplace APIs

Shopee, Lazada และ TikTok Shop integration scaffolding อยู่ใน
`src/marketplaces/` และใช้ environment template ที่
`../.env.marketplaces.example`

คู่มือฉบับเต็ม: `../docs/marketplace-api-integration.md`

## Demo Reset

```powershell
Invoke-RestMethod -Method Post http://localhost:4000/api/demo/reset
```
