import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";
import express from "express";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "packing-scan-test-")), "packing.db");
process.env.UPLOADS_DIR = path.join(mkdtempSync(path.join(tmpdir(), "packing-upload-test-")), "uploads");

const { db, migrate, nowIso } = await import("../src/db.js");
const { router } = await import("../src/routes.js");

let baseUrl;
let server;

before(async () => {
  migrate();
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(() => {
  db.prepare("delete from scan_events").run();
  db.prepare("delete from product_barcodes").run();
  db.prepare("delete from order_items").run();
  db.prepare("delete from orders").run();
});

after(() => {
  server?.close();
  db.close();
});

function createOrder({ id = "order-1", items, readyAt, status = "Ready to Pack" }) {
  const now = nowIso();
  const readyToPackAt = readyAt || now;
  db.prepare(`
    insert into orders
      (id, channel, order_key, tracking_id, status, imported_at, ready_to_pack_at, created_at, updated_at)
    values
      (@id, 'reservation', @id, @id, @status, @readyToPackAt, @readyToPackAt, @readyToPackAt, @now)
  `).run({ id, status, readyToPackAt, now });

  for (const item of items) {
    db.prepare(`
      insert into order_items
        (id, order_id, sku, product_name, quantity_required, quantity_scanned, status, created_at, updated_at)
      values
        (@id, @orderId, @sku, @productName, @quantityRequired, 0, 'pending', @now, @now)
    `).run({
      id: `${id}-${item.sku}`,
      orderId: id,
      sku: item.sku,
      productName: item.product_name || null,
      quantityRequired: item.quantity_required || 1,
      now
    });
  }
}

async function getSummary() {
  const response = await fetch(`${baseUrl}/dashboard/summary`);
  return response.json();
}

async function scanItem(orderId, body) {
  const response = await fetch(`${baseUrl}/packing/orders/${orderId}/scan-item`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

test("rejects empty SKU scans before single-item barcode fallback", async () => {
  createOrder({ items: [{ sku: "SKU-1", quantity_required: 1 }] });

  const { response, payload } = await scanItem("order-1", { scanned_sku: "" });

  assert.equal(response.status, 400);
  assert.equal(payload.code, "SCANNED_SKU_REQUIRED");
  assert.equal(db.prepare("select count(*) as count from order_items where quantity_scanned > 0").get().count, 0);
});

test("offers conflict suggestion for unmapped product barcode when one SKU remains", async () => {
  createOrder({ items: [{ sku: "SKU-1", quantity_required: 2 }] });

  const { response, payload } = await scanItem("order-1", { scanned_sku: "BAR-001" });

  assert.equal(response.status, 400);
  assert.equal(payload.code, "SKU_CONFLICT");
  assert.ok(payload.conflict);
  assert.equal(payload.conflict.candidate.sku, "SKU-1");
  assert.equal(db.prepare("select count(*) as count from product_barcodes").get().count, 0);
});

test("does not guess an unmapped product barcode when multiple SKUs remain", async () => {
  createOrder({
    items: [
      { sku: "SKU-1", quantity_required: 1 },
      { sku: "SKU-2", quantity_required: 1 }
    ]
  });

  const { response, payload } = await scanItem("order-1", { scanned_sku: "BAR-UNKNOWN" });

  assert.equal(response.status, 400);
  assert.equal(payload.code, "BARCODE_NOT_MAPPED");
  assert.equal(db.prepare("select count(*) as count from product_barcodes").get().count, 0);
});

test("dashboard reports active orders delayed longer than one day", async () => {
  const oldReadyAt = new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString();
  createOrder({ id: "late-order", readyAt: oldReadyAt, items: [{ sku: "SKU-1", quantity_required: 1 }] });
  createOrder({ id: "shipped-late-order", readyAt: oldReadyAt, status: "Shipped / Handed Over", items: [{ sku: "SKU-2", quantity_required: 1 }] });

  const summary = await getSummary();

  assert.equal(summary.totals.overdue, 1);
  assert.equal(summary.overdue_orders.length, 1);
  assert.equal(summary.overdue_orders[0].order_key, "late-order");
});
