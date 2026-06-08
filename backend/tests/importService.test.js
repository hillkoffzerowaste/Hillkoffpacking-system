import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { before, beforeEach, after } from "node:test";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "packing-import-test-")), "packing.db");

const { db, migrate } = await import("../src/db.js");
const { importRows } = await import("../src/importService.js");

before(() => {
  migrate();
});

beforeEach(() => {
  db.prepare("delete from scan_events").run();
  db.prepare("delete from product_barcodes").run();
  db.prepare("delete from order_items").run();
  db.prepare("delete from orders").run();
  db.prepare("delete from import_batches").run();
});

after(() => {
  db.close();
});

test("imports one order with multiple SKU rows from the same file", () => {
  const stats = importRows({
    channel: "shopee",
    deduplicationAction: "ignore",
    fileName: "same-order.csv",
    rows: [
      {
        "Order ID": "SHP-1001",
        "Tracking Number": "SPX-TRACK-1001",
        "SKU Reference No.": "SKU-A",
        Quantity: "1",
        "Customer Name": "Customer A"
      },
      {
        "Order ID": "SHP-1001",
        "Tracking Number": "SPX-TRACK-1001",
        "SKU Reference No.": "SKU-B",
        Quantity: "2",
        "Customer Name": "Customer A"
      },
      {
        "Order ID": "SHP-1001",
        "Tracking Number": "SPX-TRACK-1001",
        "SKU Reference No.": "SKU-A",
        Quantity: "3",
        "Customer Name": "Customer A"
      }
    ]
  });

  assert.equal(stats.created_count, 1);
  assert.equal(stats.ignored_count, 0);
  assert.equal(db.prepare("select count(*) as count from orders").get().count, 1);

  const items = db.prepare("select sku, quantity_required from order_items order by sku").all();
  assert.deepEqual(items, [
    { sku: "SKU-A", quantity_required: 4 },
    { sku: "SKU-B", quantity_required: 2 }
  ]);
});

test("groups SKU rows by order even when later rows omit tracking", () => {
  const stats = importRows({
    channel: "shopee",
    deduplicationAction: "ignore",
    fileName: "same-order-missing-tracking.csv",
    rows: [
      {
        "Order ID": "SHP-1002",
        "Tracking Number": "SPX-TRACK-1002",
        "SKU Reference No.": "SKU-A",
        Quantity: "1"
      },
      {
        "Order ID": "SHP-1002",
        "Tracking Number": "",
        "SKU Reference No.": "SKU-B",
        Quantity: "2"
      }
    ]
  });

  assert.equal(stats.created_count, 1);
  assert.equal(stats.ignored_count, 0);
  const order = db.prepare("select order_key, tracking_id from orders").get();
  assert.deepEqual(order, { order_key: "SHP-1002", tracking_id: "SPX-TRACK-1002" });

  const items = db.prepare("select sku, quantity_required from order_items order by sku").all();
  assert.deepEqual(items, [
    { sku: "SKU-A", quantity_required: 1 },
    { sku: "SKU-B", quantity_required: 2 }
  ]);
});

test("ignores the whole imported order when it already exists from a previous file", () => {
  importRows({
    channel: "shopee",
    deduplicationAction: "ignore",
    fileName: "first.csv",
    rows: [
      { "Order ID": "SHP-2001", "Tracking Number": "SPX-TRACK-2001", "SKU Reference No.": "SKU-A", Quantity: "1" }
    ]
  });

  const stats = importRows({
    channel: "shopee",
    deduplicationAction: "ignore",
    fileName: "second.csv",
    rows: [
      { "Order ID": "SHP-2001", "Tracking Number": "SPX-TRACK-2001", "SKU Reference No.": "SKU-B", Quantity: "1" },
      { "Order ID": "SHP-2001", "Tracking Number": "SPX-TRACK-2001", "SKU Reference No.": "SKU-C", Quantity: "1" }
    ]
  });

  assert.equal(stats.created_count, 0);
  assert.equal(stats.ignored_count, 1);
  assert.equal(db.prepare("select count(*) as count from orders").get().count, 1);
  assert.equal(db.prepare("select count(*) as count from order_items").get().count, 1);
});
