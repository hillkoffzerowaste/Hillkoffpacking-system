import assert from "node:assert/strict";
import test from "node:test";
import { mapImportRow, validateMappedOrder } from "../src/importMapping.js";

test("maps Shopee rows into centralized fields", () => {
  const mapped = mapImportRow({
    "หมายเลขคำสั่งซื้อ": "SHP-1001",
    "หมายเลขติดตามพัสดุ": "SPX-TRACK-1001",
    "เลขอ้างอิง SKU": "COF-DRIP-001",
    "จำนวน": "2",
    "ชื่อผู้รับ": "คุณเอ",
    "ขนส่ง": "SPX"
  }, "shopee");

  assert.equal(mapped.orderKey, "SHP-1001");
  assert.equal(mapped.trackingId, "SPX-TRACK-1001");
  assert.equal(mapped.sku, "COF-DRIP-001");
  assert.equal(mapped.quantityRequired, 2);
  assert.equal(mapped.shippingProviderCode, "SPX");
});

test("maps Lazada quantity with item id key", () => {
  const mapped = mapImportRow({
    orderNumber: "LAZ-2001",
    orderItemId: "LAZ-ITEM-2001",
    trackingCode: "LEX-TRACK-2001",
    sellerSku: "COF-BEAN-250G",
    quantity: "1"
  }, "lazada");

  assert.equal(mapped.orderKey, "LAZ-ITEM-2001");
  assert.equal(mapped.orderItemId, "LAZ-ITEM-2001");
  assert.equal(mapped.shippingProviderCode, "LEX");
});

test("reservation orders fallback tracking to reservation number", () => {
  const mapped = mapImportRow({
    "เลขที่ใบสั่งจอง": "RSV-4001",
    "รหัสสินค้า": "COF-GIFT-SET",
    "จำนวน": "1"
  }, "reservation");

  assert.equal(mapped.orderKey, "RSV-4001");
  assert.equal(mapped.trackingId, "RSV-4001");
  assert.equal(mapped.shippingProviderCode, "GENERAL");
});

test("validation rejects missing sku", () => {
  const mapped = mapImportRow({
    "Order ID": "TT-3001",
    "Tracking ID": "JNT-TRACK-3001",
    Quantity: "1"
  }, "tiktok");

  assert.throws(() => validateMappedOrder(mapped, 2), /missing sku/);
});

