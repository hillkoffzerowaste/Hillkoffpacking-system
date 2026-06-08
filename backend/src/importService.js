import { nanoid } from "nanoid";
import { db, nowIso } from "./db.js";
import { findProviderByCode } from "./repositories.js";
import { mapImportRow, validateMappedOrder } from "./importMapping.js";

function findDuplicate(mapped) {
  return db.prepare(`
    select * from orders
    where tracking_id = @trackingId
       or (channel = @channel and order_key = @orderKey)
    limit 1
  `).get(mapped);
}

function upsertItem(orderId, mapped) {
  const now = nowIso();
  const existing = db.prepare("select * from order_items where order_id = ? and sku = ?").get(orderId, mapped.sku);
  if (existing) {
    db.prepare(`
      update order_items
      set product_name = @productName,
          quantity_required = quantity_required + @quantityRequired,
          status = case when quantity_scanned >= quantity_required + @quantityRequired then 'verified' else status end,
          updated_at = @now
      where id = @id
    `).run({ id: existing.id, productName: mapped.productName, quantityRequired: mapped.quantityRequired, now });
    return;
  }

  db.prepare(`
    insert into order_items
      (id, order_id, sku, product_name, quantity_required, quantity_scanned, status, created_at, updated_at)
    values
      (@id, @orderId, @sku, @productName, @quantityRequired, 0, 'pending', @now, @now)
  `).run({
    id: nanoid(),
    orderId,
    sku: mapped.sku,
    productName: mapped.productName || null,
    quantityRequired: mapped.quantityRequired,
    now
  });
}

function upsertItems(orderId, mapped) {
  for (const item of mapped.items || [mapped]) {
    upsertItem(orderId, { ...mapped, ...item });
  }
}

function aggregateMappedOrders(mappedRows) {
  const groups = new Map();
  for (const mapped of mappedRows) {
    const key = `${mapped.channel}\u001f${mapped.orderKey || mapped.trackingId}`;
    const existing = groups.get(key);
    const item = {
      sku: mapped.sku,
      productName: mapped.productName,
      quantityRequired: mapped.quantityRequired
    };

    if (!existing) {
      groups.set(key, {
        ...mapped,
        items: [item]
      });
      continue;
    }

    existing.customerName ||= mapped.customerName;
    existing.shippingProviderCode ||= mapped.shippingProviderCode;
    if (mapped.trackingId && mapped.trackingId !== mapped.orderKey) existing.trackingId = mapped.trackingId;
    const existingItem = existing.items.find((candidate) => candidate.sku === item.sku);
    if (existingItem) {
      existingItem.productName = item.productName || existingItem.productName;
      existingItem.quantityRequired += item.quantityRequired;
    } else {
      existing.items.push(item);
    }
  }
  return [...groups.values()];
}

function createOrder(mapped, batchId, sourceFileName) {
  const now = nowIso();
  const provider = findProviderByCode(mapped.shippingProviderCode);
  const id = nanoid();
  db.prepare(`
    insert into orders
      (id, channel, order_key, order_item_id, tracking_id, customer_name, shipping_provider_id, status,
       imported_at, ready_to_pack_at, source_file_name, import_batch_id, deduplication_action, created_at, updated_at)
    values
      (@id, @channel, @orderKey, @orderItemId, @trackingId, @customerName, @shippingProviderId, 'Ready to Pack',
       @now, @now, @sourceFileName, @batchId, 'created', @now, @now)
  `).run({
    id,
    channel: mapped.channel,
    orderKey: mapped.orderKey,
    orderItemId: mapped.orderItemId || null,
    trackingId: mapped.trackingId,
    customerName: mapped.customerName || null,
    shippingProviderId: provider?.id || null,
    sourceFileName,
    batchId,
    now
  });
  upsertItems(id, mapped);
  return id;
}

function overwriteOrder(existing, mapped, batchId, sourceFileName) {
  const now = nowIso();
  const provider = findProviderByCode(mapped.shippingProviderCode);
  db.prepare(`
    update orders
    set channel = @channel,
        order_key = @orderKey,
        order_item_id = @orderItemId,
        tracking_id = @trackingId,
        customer_name = @customerName,
        shipping_provider_id = @shippingProviderId,
        status = 'Ready to Pack',
        imported_at = @now,
        ready_to_pack_at = @now,
        packing_started_at = null,
        packed_at = null,
        shipped_at = null,
        source_file_name = @sourceFileName,
        import_batch_id = @batchId,
        deduplication_action = 'overwritten',
        updated_at = @now
    where id = @id
  `).run({
    id: existing.id,
    channel: mapped.channel,
    orderKey: mapped.orderKey,
    orderItemId: mapped.orderItemId || null,
    trackingId: mapped.trackingId,
    customerName: mapped.customerName || null,
    shippingProviderId: provider?.id || null,
    sourceFileName,
    batchId,
    now
  });
  db.prepare("delete from order_items where order_id = ?").run(existing.id);
  upsertItems(existing.id, mapped);
  return existing.id;
}

export function importRows({ rows, channel, deduplicationAction, fileName }) {
  const now = nowIso();
  const batchId = nanoid();
  const stats = {
    batch_id: batchId,
    status: "completed",
    total_rows: rows.length,
    created_count: 0,
    ignored_count: 0,
    overwritten_count: 0,
    error_count: 0,
    errors: []
  };

  db.prepare(`
    insert into import_batches
      (id, source, channel, file_name, total_rows, status, created_at)
    values
      (@id, 'file', @channel, @fileName, @totalRows, 'processing', @now)
  `).run({ id: batchId, channel, fileName, totalRows: rows.length, now });

  const transaction = db.transaction(() => {
    const mappedOrders = aggregateMappedOrders(rows.map((row, index) => {
      try {
        const mapped = mapImportRow(row, channel);
        validateMappedOrder(mapped, index + 2);
        return mapped;
      } catch (error) {
        stats.error_count += 1;
        stats.errors.push(error.message);
        return null;
      }
    }).filter(Boolean));

    mappedOrders.forEach((mapped) => {
      try {
        const duplicate = findDuplicate(mapped);

        if (!duplicate) {
          createOrder(mapped, batchId, fileName);
          stats.created_count += 1;
          return;
        }

        if (deduplicationAction === "overwrite") {
          overwriteOrder(duplicate, mapped, batchId, fileName);
          stats.overwritten_count += 1;
          return;
        }

        db.prepare("update orders set deduplication_action = 'ignored', updated_at = ? where id = ?").run(nowIso(), duplicate.id);
        stats.ignored_count += 1;
      } catch (error) {
        stats.error_count += 1;
        stats.errors.push(error.message);
      }
    });

    db.prepare(`
      update import_batches
      set created_count = @created,
          ignored_count = @ignored,
          overwritten_count = @overwritten,
          error_count = @errors,
          status = @status,
          completed_at = @completedAt
      where id = @batchId
    `).run({
      batchId,
      created: stats.created_count,
      ignored: stats.ignored_count,
      overwritten: stats.overwritten_count,
      errors: stats.error_count,
      status: stats.error_count ? "completed_with_errors" : "completed",
      completedAt: nowIso()
    });
  });

  transaction();
  stats.status = stats.error_count ? "completed_with_errors" : "completed";
  return stats;
}

