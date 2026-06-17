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

function sameSku(left, right) {
  return String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase();
}

const ACTIVE_ORDER_STATUSES = ["Ready to Pack", "Packing In Progress", "Scan Completed", "Verified", "Packed"];
const OVERDUE_MS = 24 * 60 * 60 * 1000;

function resolveScannedOrderItem(order, scannedSku) {
  const directItem = order.items.find((candidate) => sameSku(candidate.sku, scannedSku));
  if (directItem) return { item: directItem, mappedBarcode: false };

  const barcode = String(scannedSku || "").trim();
  if (!barcode) {
    return { error: "SCANNED_SKU_REQUIRED", message: "Scanned SKU is required." };
  }

  const savedMapping = db.prepare("select * from product_barcodes where barcode = ?").get(barcode);
  if (savedMapping) {
    const mappedItem = order.items.find((candidate) => sameSku(candidate.sku, savedMapping.sku));
    if (mappedItem) {
      return { item: mappedItem, mappedBarcode: true };
    }
    return { error: "SKU_NOT_IN_ORDER", message: "Barcode is linked to a SKU that is not in this order." };
  }

  return { error: "BARCODE_NOT_MAPPED", message: "Barcode is not linked to a SKU yet." };
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

router.get("/dashboard/summary", (_req, res) => {
  const overdueCutoff = new Date(Date.now() - OVERDUE_MS).toISOString();
  const statusRows = db.prepare(`
    select status, count(*) as count
    from orders
    group by status
    order by status
  `).all();

  const providerRows = db.prepare(`
    select coalesce(sp.display_name, 'Unassigned') as shipping_provider, count(*) as count
    from orders o
    left join shipping_providers sp on sp.id = o.shipping_provider_id
    where o.status in ('Ready to Pack', 'Packing In Progress', 'Scan Completed', 'Verified', 'Packed')
    group by coalesce(sp.display_name, 'Unassigned')
    order by count desc
  `).all();

  const today = new Date().toISOString().slice(0, 10);
  const packedToday = db.prepare("select count(*) as count from orders where packed_at like ?").get(`${today}%`).count;
  const shippedToday = db.prepare("select count(*) as count from orders where shipped_at like ?").get(`${today}%`).count;
  const errorScansToday = db.prepare("select count(*) as count from scan_events where result = 'error' and created_at like ?").get(`${today}%`).count;
  const readyCount = db.prepare("select count(*) as count from orders where status = 'Ready to Pack'").get().count;
  const inProgressCount = db.prepare("select count(*) as count from orders where status = 'Packing In Progress'").get().count;
  const overdueOrders = db.prepare(`
    select o.*, sp.display_name as shipping_provider
    from orders o
    left join shipping_providers sp on sp.id = o.shipping_provider_id
    where o.status in ('Ready to Pack', 'Packing In Progress', 'Scan Completed', 'Verified', 'Packed')
      and coalesce(o.ready_to_pack_at, o.imported_at, o.created_at) < @overdueCutoff
    order by coalesce(o.ready_to_pack_at, o.imported_at, o.created_at) asc
  `).all({ overdueCutoff }).map((order) => ({
    ...order,
    overdue_since: order.ready_to_pack_at || order.imported_at || order.created_at,
    overdue_hours: Math.floor((Date.now() - Date.parse(order.ready_to_pack_at || order.imported_at || order.created_at)) / (60 * 60 * 1000))
  }));

  res.json({
    totals: {
      ready: readyCount,
      in_progress: inProgressCount,
      packed_today: packedToday,
      shipped_today: shippedToday,
      error_scans_today: errorScansToday,
      overdue: overdueOrders.length
    },
    by_status: statusRows,
    by_provider: providerRows,
    overdue_orders: overdueOrders
  });
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

router.get("/orders", (req, res) => {
  const status = String(req.query.status || "").trim();
  const channel = String(req.query.channel || "").trim();
  const q = String(req.query.q || "").trim();
  const params = {};
  const where = [];

  if (status) {
    where.push("o.status = @status");
    params.status = status;
  }

  if (channel) {
    where.push("o.channel = @channel");
    params.channel = channel;
  }

  if (q) {
    where.push("(o.tracking_id like @q or o.order_key like @q or o.customer_name like @q or o.shipping_option like @q)");
    params.q = `%${q}%`;
  }

  const sql = `
    select o.*, sp.display_name as shipping_provider, p.display_name as packed_by_name
    from orders o
    left join shipping_providers sp on sp.id = o.shipping_provider_id
    left join packers p on p.id = o.packed_by
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by o.updated_at desc
    limit 300
  `;

  res.json({ orders: db.prepare(sql).all(params) });
});

router.get("/orders/ready", (_req, res) => {
  const orders = db.prepare(`
    select o.*, sp.display_name as shipping_provider
    from orders o
    left join shipping_providers sp on sp.id = o.shipping_provider_id
    where o.status in ('Ready to Pack', 'Packing In Progress', 'Scan Completed', 'Verified', 'Packed')
    order by o.ready_to_pack_at desc
    limit 100
  `).all();
  res.json({ orders });
});

router.post("/orders", (req, res) => {
  const channel = String(req.body.channel || "reservation").trim();
  const orderKey = String(req.body.order_key || "").trim();
  const trackingId = String(req.body.tracking_id || orderKey).trim();
  const customerName = String(req.body.customer_name || "").trim();
  const shippingProviderCode = String(req.body.shipping_provider_code || "GENERAL").trim().toUpperCase();
  const shippingOption = String(req.body.shipping_option || "").trim();
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  if (!orderKey || !trackingId) {
    res.status(400).json({ code: "ORDER_FIELDS_REQUIRED", message: "Order key and tracking id are required." });
    return;
  }

  const validItems = items
    .map((item) => ({
      sku: String(item.sku || "").trim(),
      productName: String(item.product_name || "").trim(),
      quantityRequired: Number.parseInt(String(item.quantity_required || "1"), 10)
    }))
    .filter((item) => item.sku && Number.isFinite(item.quantityRequired) && item.quantityRequired > 0);

  if (validItems.length === 0) {
    res.status(400).json({ code: "ORDER_ITEMS_REQUIRED", message: "At least one valid SKU item is required." });
    return;
  }

  const duplicate = db.prepare(`
    select id
    from orders
    where tracking_id = @trackingId
       or (channel = @channel and order_key = @orderKey)
    limit 1
  `).get({ trackingId, channel, orderKey });

  if (duplicate) {
    res.status(409).json({ code: "DUPLICATE_ORDER", message: "Order or tracking already exists." });
    return;
  }

  const provider = db.prepare("select * from shipping_providers where code = ? and active = 1").get(shippingProviderCode)
    || db.prepare("select * from shipping_providers where code = 'GENERAL' and active = 1").get();

  const now = nowIso();
  const orderId = nanoid();
  const transaction = db.transaction(() => {
    db.prepare(`
      insert into orders
        (id, channel, order_key, tracking_id, customer_name, shipping_provider_id, shipping_option, status,
         imported_at, ready_to_pack_at, source_file_name, deduplication_action, created_at, updated_at)
      values
        (@id, @channel, @orderKey, @trackingId, @customerName, @shippingProviderId, @shippingOption, 'Ready to Pack',
         @now, @now, 'manual-entry', 'created', @now, @now)
    `).run({
      id: orderId,
      channel,
      orderKey,
      trackingId,
      customerName: customerName || null,
      shippingProviderId: provider?.id || null,
      shippingOption: shippingOption || null,
      now
    });

    const insertItem = db.prepare(`
      insert into order_items
        (id, order_id, sku, product_name, quantity_required, quantity_scanned, status, created_at, updated_at)
      values
        (@id, @orderId, @sku, @productName, @quantityRequired, 0, 'pending', @now, @now)
    `);

    for (const item of validItems) {
      insertItem.run({
        id: nanoid(),
        orderId,
        sku: item.sku,
        productName: item.productName || null,
        quantityRequired: item.quantityRequired,
        now
      });
    }
  });

  transaction();
  res.status(201).json(getOrderDetail(orderId));
});

router.get("/imports/batches", (_req, res) => {
  const batches = db.prepare(`
    select *
    from import_batches
    order by created_at desc
    limit 100
  `).all();
  res.json({ batches });
});

router.delete("/imports/batches", (_req, res) => {
  const result = db.prepare("delete from import_batches").run();
  res.json({ deleted: result.changes });
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

router.post("/packers", (req, res) => {
  const employeeCode = String(req.body.employee_code || "").trim();
  const barcode = String(req.body.barcode || employeeCode).trim();
  const displayName = String(req.body.display_name || "").trim();

  if (!employeeCode || !barcode || !displayName) {
    res.status(400).json({ code: "PACKER_FIELDS_REQUIRED", message: "Employee code, barcode, and display name are required." });
    return;
  }

  const now = nowIso();
  db.prepare(`
    insert into packers
      (id, employee_code, barcode, display_name, active, created_at, updated_at)
    values
      (@id, @employeeCode, @barcode, @displayName, 1, @now, @now)
  `).run({ id: nanoid(), employeeCode, barcode, displayName, now });

  res.status(201).json({ packers: listPackers() });
});

router.post("/shipping-providers", (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const name = String(req.body.name || "").trim();
  const displayName = String(req.body.display_name || name).trim();

  if (!code || !name || !displayName) {
    res.status(400).json({ code: "PROVIDER_FIELDS_REQUIRED", message: "Code, name, and display name are required." });
    return;
  }

  const now = nowIso();
  db.prepare(`
    insert into shipping_providers
      (id, code, name, display_name, active, created_at, updated_at)
    values
      (@id, @code, @name, @displayName, 1, @now, @now)
  `).run({ id: nanoid(), code, name, displayName, now });

  res.status(201).json({ shipping_providers: listProviders() });
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
  const scanQuantity = Number(req.body.quantity || 1);
  const packerId = req.body.packer_id || null;

  if (!order) {
    res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found." });
    return;
  }

  if (!Number.isInteger(scanQuantity) || scanQuantity < 1) {
    res.status(400).json({ result: "error", code: "INVALID_QUANTITY", message: "Scan quantity must be at least 1." });
    return;
  }

  const resolved = resolveScannedOrderItem(order, scannedSku);
  if (resolved.error) {
    createScanEvent({
      orderId: order.id,
      packerId,
      scanType: "item_verify",
      scannedValue: scannedSku,
      result: "error",
      message: resolved.message
    });
    res.status(400).json({ result: "error", code: resolved.error, message: resolved.message });
    return;
  }
  const item = resolved.item;

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

  if (scanQuantity > item.quantity_required - item.quantity_scanned) {
    createScanEvent({
      orderId: order.id,
      orderItemId: item.id,
      packerId,
      scanType: "item_verify",
      scannedValue: scannedSku,
      result: "error",
      message: "Scan quantity exceeds remaining quantity"
    });
    res.status(400).json({ result: "error", code: "QUANTITY_EXCEEDS_REMAINING", message: "Scan quantity exceeds remaining quantity." });
    return;
  }

  const nextQty = item.quantity_scanned + scanQuantity;
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

  const orderStatus = remaining === 0 ? "Scan Completed" : "Packing In Progress";
  db.prepare(`
    update orders
    set status = @status,
        packed_by = coalesce(packed_by, @packerId),
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
    message: `+${scanQuantity} => ${nextQty}/${item.quantity_required}`
  });

  res.json({
    result: "success",
    sku: item.sku,
    scanned_sku: scannedSku,
    product_name: item.product_name,
    mapped_barcode: !!resolved.mappedBarcode,
    new_barcode_mapping: !!resolved.newMapping,
    quantity_added: scanQuantity,
    quantity_scanned: nextQty,
    quantity_required: item.quantity_required,
    item_status: itemStatus,
    order_status: orderStatus,
    order: getOrderDetail(order.id)
  });
});

router.post("/packing/orders/:id/confirm-scan", (req, res) => {
  const order = getOrderDetail(req.params.id);
  const packerId = req.body.packer_id || null;

  if (!order) {
    res.status(404).json({ code: "ORDER_NOT_FOUND", message: "Order not found." });
    return;
  }

  const incomplete = order.items.some((item) => item.quantity_scanned < item.quantity_required);
  if (incomplete) {
    res.status(400).json({ code: "ORDER_SCAN_INCOMPLETE", message: "Order scan is not complete." });
    return;
  }

  const now = nowIso();
  db.prepare(`
    update orders
    set status = 'Packed',
        packed_by = coalesce(packed_by, @packerId),
        packed_at = coalesce(packed_at, @now),
        updated_at = @now
    where id = @orderId
  `).run({ orderId: order.id, packerId, now });

  createScanEvent({
    orderId: order.id,
    packerId,
    scanType: "packing_confirm",
    scannedValue: order.tracking_id,
    result: "success",
    message: "Packing scan confirmed"
  });

  res.json({
    result: "success",
    order_status: "Packed",
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
    shipping_option: order.shipping_option || null,
    shipped_at: now
  });
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
