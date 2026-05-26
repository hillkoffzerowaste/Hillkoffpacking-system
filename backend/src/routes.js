import express from "express";
import multer from "multer";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { db, nowIso } from "./db.js";
import { importRows } from "./importService.js";
import { parseImportFile } from "./importParser.js";
import {
  createScanEvent,
  findOrderByLookup,
  findPackerByBarcode,
  getOrderDetail,
  listPackers,
  listProviders,
  setOrderPackingStarted
} from "./repositories.js";

fs.mkdirSync(config.uploadsDir, { recursive: true });

const upload = multer({ dest: config.uploadsDir });
export const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "hillkoff-packing-backend" });
});

router.get("/reference/packers", (_req, res) => {
  res.json({ packers: listPackers() });
});

router.get("/reference/shipping-providers", (_req, res) => {
  res.json({ shipping_providers: listProviders() });
});

router.post("/imports/orders", upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ code: "FILE_REQUIRED", message: "Please upload an import file." });
    return;
  }

  const channel = req.body.channel;
  const deduplicationAction = req.body.deduplication_action === "overwrite" ? "overwrite" : "ignore";
  const rows = await parseImportFile(req.file);
  const result = importRows({
    rows,
    channel,
    deduplicationAction,
    fileName: req.file.originalname
  });

  res.json(result);
}));

router.post("/imports/orders/json", (req, res) => {
  const { rows = [], channel, deduplication_action: action = "ignore", file_name: fileName = "api-json" } = req.body;
  const result = importRows({
    rows,
    channel,
    deduplicationAction: action === "overwrite" ? "overwrite" : "ignore",
    fileName
  });
  res.json(result);
});

router.get("/orders/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    res.json({ orders: [] });
    return;
  }
  res.json({ orders: findOrderByLookup(q) });
});

router.get("/orders/ready", (_req, res) => {
  const orders = db.prepare(`
    select o.*, sp.display_name as shipping_provider
    from orders o
    left join shipping_providers sp on sp.id = o.shipping_provider_id
    where o.status in ('Ready to Pack', 'Packing In Progress', 'Verified', 'Packed')
    order by o.ready_to_pack_at desc
    limit 100
  `).all();
  res.json({ orders });
});

router.get("/orders/:id", (req, res) => {
  const order = getOrderDetail(req.params.id);
  if (!order) {
    res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found." });
    return;
  }
  res.json(order);
});

router.post("/packing/session", (req, res) => {
  const packer = findPackerByBarcode(String(req.body.packer_barcode || "").trim());
  if (!packer) {
    res.status(404).json({ code: "PACKER_NOT_FOUND", message: "Packer barcode not found." });
    return;
  }

  createScanEvent({
    packerId: packer.id,
    scanType: "packer",
    scannedValue: req.body.packer_barcode,
    result: "success",
    message: "Packer identified"
  });

  res.json({ packer_id: packer.id, display_name: packer.display_name });
});

router.post("/packing/orders/lookup", (req, res) => {
  const lookupValue = String(req.body.lookup_value || "").trim();
  const packerId = req.body.packer_id || null;
  const matches = findOrderByLookup(lookupValue);
  const order = matches[0];

  if (!order) {
    createScanEvent({
      packerId,
      scanType: "order_lookup",
      scannedValue: lookupValue,
      result: "error",
      message: "Order not found"
    });
    res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found." });
    return;
  }

  setOrderPackingStarted(order.id, packerId);
  createScanEvent({
    orderId: order.id,
    packerId,
    scanType: "order_lookup",
    scannedValue: lookupValue,
    result: "success",
    message: "Order loaded"
  });

  res.json(getOrderDetail(order.id));
});

router.post("/packing/orders/:id/scan-item", (req, res) => {
  const order = getOrderDetail(req.params.id);
  const scannedSku = String(req.body.scanned_sku || "").trim();
  const packerId = req.body.packer_id || null;

  if (!order) {
    res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found." });
    return;
  }

  const item = order.items.find((candidate) => candidate.sku === scannedSku);
  if (!item) {
    createScanEvent({
      orderId: order.id,
      packerId,
      scanType: "item_verify",
      scannedValue: scannedSku,
      result: "error",
      message: "SKU does not match this order"
    });
    res.status(400).json({ result: "error", code: "SKU_NOT_IN_ORDER", message: "SKU does not match this order." });
    return;
  }

  if (item.quantity_scanned >= item.quantity_required) {
    createScanEvent({
      orderId: order.id,
      orderItemId: item.id,
      packerId,
      scanType: "item_verify",
      scannedValue: scannedSku,
      result: "error",
      message: "Quantity already completed"
    });
    res.status(400).json({ result: "error", code: "QUANTITY_ALREADY_COMPLETE", message: "Quantity already completed." });
    return;
  }

  const nextQty = item.quantity_scanned + 1;
  const itemStatus = nextQty >= item.quantity_required ? "verified" : "partial";
  const now = nowIso();

  db.prepare(`
    update order_items
    set quantity_scanned = @nextQty,
        status = @itemStatus,
        updated_at = @now
    where id = @id
  `).run({ id: item.id, nextQty, itemStatus, now });

  const remaining = db.prepare(`
    select count(*) as count
    from order_items
    where order_id = ? and status != 'verified'
  `).get(order.id).count;

  const orderStatus = remaining === 0 ? "Packed" : "Packing In Progress";
  db.prepare(`
    update orders
    set status = @status,
        packed_by = coalesce(packed_by, @packerId),
        packed_at = case when @status = 'Packed' then @now else packed_at end,
        updated_at = @now
    where id = @orderId
  `).run({ status: orderStatus, packerId, now, orderId: order.id });

  createScanEvent({
    orderId: order.id,
    orderItemId: item.id,
    packerId,
    scanType: "item_verify",
    scannedValue: scannedSku,
    result: "success",
    message: `${nextQty}/${item.quantity_required}`
  });

  res.json({
    result: "success",
    sku: scannedSku,
    quantity_scanned: nextQty,
    quantity_required: item.quantity_required,
    item_status: itemStatus,
    order_status: orderStatus,
    order: getOrderDetail(order.id)
  });
});

router.post("/dispatch/final-scan", (req, res) => {
  const lookupValue = String(req.body.tracking_or_order_id || "").trim();
  const packerId = req.body.packer_id || null;
  const order = findOrderByLookup(lookupValue)[0];

  if (!order) {
    createScanEvent({
      packerId,
      scanType: "final_dispatch",
      scannedValue: lookupValue,
      result: "error",
      message: "Order not found"
    });
    res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found." });
    return;
  }

  if (!["Packed", "Verified", "Shipped / Handed Over"].includes(order.status)) {
    createScanEvent({
      orderId: order.id,
      packerId,
      scanType: "final_dispatch",
      scannedValue: lookupValue,
      result: "error",
      message: "Order must be packed before dispatch"
    });
    res.status(400).json({ code: "ORDER_NOT_PACKED", message: "Order must be packed before dispatch." });
    return;
  }

  const now = nowIso();
  db.prepare(`
    update orders
    set status = 'Shipped / Handed Over',
        shipped_at = coalesce(shipped_at, @now),
        updated_at = @now
    where id = @orderId
  `).run({ orderId: order.id, now });

  createScanEvent({
    orderId: order.id,
    packerId,
    scanType: "final_dispatch",
    scannedValue: lookupValue,
    result: "success",
    message: order.shipping_provider || "No shipping provider"
  });

  res.json({
    order_id: order.id,
    status: "Shipped / Handed Over",
    shipping_provider: {
      display_name: order.shipping_provider || "ไม่ระบุขนส่ง"
    },
    shipped_at: now
  });
});

router.post("/demo/reset", (_req, res) => {
  db.prepare("delete from scan_events").run();
  db.prepare("delete from order_items").run();
  db.prepare("delete from orders").run();
  db.prepare("delete from import_batches").run();

  const rows = [
    {
      "หมายเลขคำสั่งซื้อ": "SHP-1001",
      "หมายเลขติดตามพัสดุ": "SPX-TRACK-1001",
      "เลขอ้างอิง SKU": "COF-DRIP-001",
      "จำนวน": "2",
      "ชื่อผู้รับ": "คุณเอ",
      "ขนส่ง": "SPX"
    },
    {
      orderNumber: "LAZ-2001",
      trackingCode: "LEX-TRACK-2001",
      sellerSku: "COF-BEAN-250G",
      quantity: "1",
      customerName: "คุณบี",
      shippingProvider: "LEX TH"
    },
    {
      "เลขที่ใบสั่งจอง": "RSV-3001",
      "รหัสสินค้า": "COF-GIFT-SET",
      "จำนวน": "1",
      "ชื่อลูกค้า": "คุณซี",
      "ขนส่ง": "รถโรงงาน"
    }
  ];

  const shopee = importRows({ rows: [rows[0]], channel: "shopee", deduplicationAction: "overwrite", fileName: "demo-shopee.csv" });
  const lazada = importRows({ rows: [rows[1]], channel: "lazada", deduplicationAction: "overwrite", fileName: "demo-lazada.csv" });
  const reservation = importRows({ rows: [rows[2]], channel: "reservation", deduplicationAction: "overwrite", fileName: "demo-reservation.csv" });

  res.json({ ok: true, batches: [shopee, lazada, reservation], demo_scans: ["EMP001", "SPX-TRACK-1001", "COF-DRIP-001", "COF-DRIP-001"] });
});

router.get("/scan-events", (_req, res) => {
  const events = db.prepare(`
    select se.*, o.order_key, o.tracking_id, p.display_name as packer_name
    from scan_events se
    left join orders o on o.id = se.order_id
    left join packers p on p.id = se.packer_id
    order by se.created_at desc
    limit 100
  `).all();
  res.json({ events });
});

router.use((err, _req, res, _next) => {
  res.status(400).json({
    code: "REQUEST_FAILED",
    message: err.message || "Request failed."
  });
});

