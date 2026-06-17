import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate() {
  db.exec(`
    create table if not exists shipping_providers (
      id text primary key,
      code text not null unique,
      name text not null,
      display_name text not null,
      active integer not null default 1,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists packers (
      id text primary key,
      employee_code text not null unique,
      barcode text not null unique,
      display_name text not null,
      active integer not null default 1,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists import_batches (
      id text primary key,
      source text not null,
      channel text not null,
      file_name text,
      total_rows integer not null default 0,
      created_count integer not null default 0,
      updated_count integer not null default 0,
      ignored_count integer not null default 0,
      overwritten_count integer not null default 0,
      error_count integer not null default 0,
      status text not null,
      created_at text not null,
      completed_at text
    );

    create table if not exists orders (
      id text primary key,
      channel text not null,
      order_key text not null,
      order_item_id text,
      tracking_id text not null,
      customer_name text,
      shipping_provider_id text,
      shipping_option text,
      status text not null,
      packed_by text,
      imported_at text not null,
      ready_to_pack_at text,
      packing_started_at text,
      packed_at text,
      shipped_at text,
      source_file_name text,
      import_batch_id text,
      deduplication_action text,
      created_at text not null,
      updated_at text not null,
      foreign key (shipping_provider_id) references shipping_providers(id),
      foreign key (packed_by) references packers(id),
      foreign key (import_batch_id) references import_batches(id)
    );

    create unique index if not exists idx_orders_tracking_id on orders(tracking_id);
    create unique index if not exists idx_orders_channel_order_key on orders(channel, order_key);
    create index if not exists idx_orders_status on orders(status);

    create table if not exists order_items (
      id text primary key,
      order_id text not null,
      sku text not null,
      product_name text,
      quantity_required integer not null,
      quantity_scanned integer not null default 0,
      status text not null,
      created_at text not null,
      updated_at text not null,
      foreign key (order_id) references orders(id) on delete cascade
    );

    create unique index if not exists idx_order_items_order_sku on order_items(order_id, sku);

    create table if not exists product_barcodes (
      barcode text primary key,
      sku text not null,
      product_name text,
      created_at text not null,
      updated_at text not null,
      last_seen_at text,
      scan_count integer not null default 0
    );

    create index if not exists idx_product_barcodes_sku on product_barcodes(sku);

    create table if not exists scan_events (
      id text primary key,
      order_id text,
      order_item_id text,
      packer_id text,
      scan_type text not null,
      scanned_value text not null,
      result text not null,
      message text,
      created_at text not null,
      foreign key (order_id) references orders(id),
      foreign key (order_item_id) references order_items(id),
      foreign key (packer_id) references packers(id)
    );

    create index if not exists idx_scan_events_created_at on scan_events(created_at);
  `);

  const orderColumns = db.prepare("pragma table_info(orders)").all().map((column) => column.name);
  if (!orderColumns.includes("shipping_option")) {
    db.prepare("alter table orders add column shipping_option text").run();
  }

  const batchColumns = db.prepare("pragma table_info(import_batches)").all().map((column) => column.name);
  if (!batchColumns.includes("updated_count")) {
    db.prepare("alter table import_batches add column updated_count integer not null default 0").run();
  }
}

export function nowIso() {
  return new Date().toISOString();
}

