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

test("maps shipping options from marketplace exports", () => {
  const shopee = mapImportRow({
    "Order ID": "SHP-5001",
    "Tracking Number": "SPX-TRACK-5001",
    "SKU Reference No.": "SKU-A",
    Quantity: "1",
    "Shipping Option": "Standard Delivery Bulky"
  }, "shopee");

  const lazada = mapImportRow({
    orderNumber: "LAZ-5001",
    trackingCode: "LEX-TRACK-5001",
    sellerSku: "SKU-B",
    quantity: "1",
    deliveryType: "STANDARD"
  }, "lazada");

  const tiktok = mapImportRow({
    "Order ID": "TT-5001",
    "Tracking ID": "JNT-TRACK-5001",
    "Seller SKU": "SKU-C",
    Quantity: "1",
    "Delivery Option": "การจัดส่งแบบมาตรฐาน"
  }, "tiktok");

  assert.equal(shopee.shippingOption, "Standard Delivery Bulky");
  assert.equal(lazada.shippingOption, "STANDARD");
  assert.equal(tiktok.shippingOption, "การจัดส่งแบบมาตรฐาน");
});

test("maps Shopee parent SKU before SKU reference", () => {
  const mapped = mapImportRow({
    "หมายเลขคำสั่งซื้อ": "SHP-1002",
    "*หมายเลขติดตามพัสดุ": "SPX-TRACK-1002",
    "เลขอ้างอิง Parent SKU": "RB-HK-0347",
    "เลขอ้างอิง SKU": "LONG-VARIANT-SKU-001",
    "จำนวน": "1"
  }, "shopee");

  assert.equal(mapped.sku, "RB-HK-0347");
});

test("maps Shopee full SKU reference column name", () => {
  const mapped = mapImportRow({
    "หมายเลขคำสั่งซื้อ": "SHP-1003",
    "*หมายเลขติดตามพัสดุ": "SPX-TRACK-1003",
    "เลขอ้างอิง SKU (SKU Reference No.)": "SY-MN-0018",
    "จำนวน": "2"
  }, "shopee");

  assert.equal(mapped.sku, "SY-MN-0018");
});

test("maps Lazada quantity with item id key", () => {
  const mapped = mapImportRow({
    orderNumber: "LAZ-2001",
    orderItemId: "LAZ-ITEM-2001",
    trackingCode: "LEX-TRACK-2001",
    sellerSku: "COF-BEAN-250G",
    quantity: "1"
  }, "lazada");

  assert.equal(mapped.orderKey, "LAZ-2001");
  assert.equal(mapped.orderItemId, "LAZ-ITEM-2001");
  assert.equal(mapped.shippingProviderCode, "LEX");
});

test("maps TikTok OrderSKUList export columns", () => {
  const mapped = mapImportRow({
    "Order ID": "584162405861197723",
    "Tracking ID": "797447740320",
    "Seller SKU": "RB-RT-0090",
    "Product Name": "Ratika Coffee Maxx Blend",
    Quantity: "1",
    Recipient: "คุณเอ",
    "Shipping Provider Name": "J&T Express"
  }, "tiktok");

  assert.equal(mapped.orderKey, "584162405861197723");
  assert.equal(mapped.trackingId, "797447740320");
  assert.equal(mapped.sku, "RB-RT-0090");
  assert.equal(mapped.shippingProviderCode, "JNT");
});

test("maps Lazada ready-to-ship export columns", () => {
  const mapped = mapImportRow({
    orderItemId: "1096926859852566",
    orderNumber: "1096926859752566",
    trackingCode: "LEXPU0687681782",
    sellerSku: "RB-RT-0104",
    itemName: "Ratika Robusta French Roast",
    customerName: "คุณบี",
    shippingProvider: "LEX TH"
  }, "lazada");

  assert.equal(mapped.orderKey, "1096926859752566");
  assert.equal(mapped.orderItemId, "1096926859852566");
  assert.equal(mapped.trackingId, "LEXPU0687681782");
  assert.equal(mapped.sku, "RB-RT-0104");
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

test("throws for unsupported channels", () => {
  assert.throws(() => mapImportRow({}, "unknown"), /Unsupported channel/);
});
