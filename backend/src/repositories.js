import { nanoid } from "nanoid";
import { db, nowIso } from "./db.js";

export function findProviderByCode(code) {
  return db.prepare("select * from shipping_providers where code = ? and active = 1").get(code);
}

export function listProviders() {
  return db.prepare("select * from shipping_providers where active = 1 order by display_name").all();
}

export function listPackers() {
  return db.prepare("select * from packers where active = 1 order by display_name").all();
}

export function findPackerByBarcode(barcode) {
  return db.prepare("select * from packers where barcode = ? and active = 1").get(barcode);
}

export function findOrderByLookup(lookup) {
  const term = `%${lookup}%`;
  return db.prepare(`
    select o.*, sp.display_name as shipping_provider
    from orders o
    left join shipping_providers sp on sp.id = o.shipping_provider_id
    where o.tracking_id = @lookup
       or o.order_key = @lookup
       or o.customer_name like @term
       or o.shipping_option like @term
    order by o.updated_at desc
    limit 20
  `).all({ lookup, term });
}

export function getOrderDetail(id) {
  const order = db.prepare(`
    select o.*, sp.display_name as shipping_provider, p.display_name as packed_by_name
    from orders o
    left join shipping_providers sp on sp.id = o.shipping_provider_id
    left join packers p on p.id = o.packed_by
    where o.id = ?
  `).get(id);

  if (!order) return null;

  const items = db.prepare("select * from order_items where order_id = ? order by sku").all(id);
  return { ...order, items };
}

export function createScanEvent({ orderId, orderItemId, packerId, scanType, scannedValue, result, message }) {
  db.prepare(`
    insert into scan_events
      (id, order_id, order_item_id, packer_id, scan_type, scanned_value, result, message, created_at)
    values
      (@id, @orderId, @orderItemId, @packerId, @scanType, @scannedValue, @result, @message, @createdAt)
  `).run({
    id: nanoid(),
    orderId: orderId || null,
    orderItemId: orderItemId || null,
    packerId: packerId || null,
    scanType,
    scannedValue,
    result,
    message: message || null,
    createdAt: nowIso()
  });
}

export function setOrderPackingStarted(orderId, packerId) {
  const now = nowIso();
  db.prepare(`
    update orders
    set status = case when status = 'Ready to Pack' then 'Packing In Progress' else status end,
        packed_by = coalesce(packed_by, @packerId),
        packing_started_at = coalesce(packing_started_at, @now),
        updated_at = @now
    where id = @orderId
  `).run({ orderId, packerId, now });
}

