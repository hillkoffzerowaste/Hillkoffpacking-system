import {
  addDoc,
  collection,
  doc,
  endAt,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAt,
  updateDoc,
  where
} from "firebase/firestore";
import { ensureFirebaseAuth, getFirebaseServices } from "./firebase";
import { mapImportRow, parseImportFileAuto } from "./importParser";

const DEFAULT_PROVIDERS = [
  { id: "JNT", code: "JNT", name: "J&T Express", display_name: "J&T Express", active: 1 },
  { id: "LEX", code: "LEX", name: "LEX TH", display_name: "LEX TH", active: 1 },
  { id: "SPX", code: "SPX", name: "SPX Express", display_name: "SPX", active: 1 },
  { id: "GENERAL", code: "GENERAL", name: "ขนส่งทั่วไป / รถโรงงาน", display_name: "ขนส่งทั่วไป / รถโรงงาน", active: 1 }
];

const DEFAULT_PACKERS = [
  { id: "EMP001", employee_code: "EMP001", barcode: "EMP001", display_name: "Packer 1", active: 1 },
  { id: "EMP002", employee_code: "EMP002", barcode: "EMP002", display_name: "Packer 2", active: 1 }
];

let readyPromise;
let productBarcodeCache;
let productBarcodeCacheUnavailable = false;

function nowIso() {
  return new Date().toISOString();
}

function localDateKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoDateKey(value) {
  return String(value || "").slice(0, 10) || null;
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function requireFirestore() {
  const services = getFirebaseServices();
  if (!services.enabled) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE_* env values first.");
  }
  return services.db;
}

async function all(collectionName) {
  const db = requireFirestore();
  const snapshot = await getDocs(collection(db, collectionName));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function periodMatchesIso(value, { date, month } = {}) {
  const key = String(value || "").slice(0, 10);
  if (!key) return false;
  if (date) return key === date;
  if (month) return key.startsWith(month);
  return true;
}

function orderMatchesPeriod(order, filters = {}) {
  if (!filters.date && !filters.month) return true;
  return [
    order.shipped_date_key,
    order.packed_date_key,
    order.ready_to_pack_date_key,
    order.imported_date_key,
    order.created_date_key,
    order.updated_date_key,
    order.shipped_at,
    order.packed_at,
    order.updated_at,
    order.imported_at,
    order.created_at
  ].some((value) => periodMatchesIso(value, filters));
}

function periodBounds({ date, month } = {}) {
  if (date) return { start: date, end: date };
  if (month) return { start: `${month}-01`, end: `${month}-31` };
  return null;
}

function mergeUniqueById(rows) {
  return Array.from(new Map(rows.filter(Boolean).map((row) => [row.id, row])).values());
}

function orderDatePatchFromFields(record = {}) {
  const patch = {};
  const fieldMap = {
    created_at: "created_date_key",
    imported_at: "imported_date_key",
    ready_to_pack_at: "ready_to_pack_date_key",
    packing_started_at: "packing_started_date_key",
    packed_at: "packed_date_key",
    shipped_at: "shipped_date_key",
    updated_at: "updated_date_key"
  };
  for (const [source, target] of Object.entries(fieldMap)) {
    if (record[source]) patch[target] = isoDateKey(record[source]);
  }
  return patch;
}

function eventDatePatch(record = {}) {
  const createdAt = record.created_at || nowIso();
  return { created_at: createdAt, event_date_key: isoDateKey(createdAt) };
}

function aggregateImportOrders(mappedRows) {
  const groups = new Map();
  for (const mapped of mappedRows) {
    const key = `${mapped.channel}\u001f${mapped.order_key || mapped.tracking_id}`;
    const existing = groups.get(key);
    const nextItems = mapped.items || [];

    if (!existing) {
      groups.set(key, {
        ...mapped,
        items: nextItems.map((item) => ({ ...item }))
      });
      continue;
    }

    existing.customer_name ||= mapped.customer_name;
    existing.shipping_provider_code ||= mapped.shipping_provider_code;
    existing.shipping_option ||= mapped.shipping_option;
    if (mapped.tracking_id && mapped.tracking_id !== mapped.order_key) existing.tracking_id = mapped.tracking_id;
    for (const item of nextItems) {
      const existingItem = existing.items.find((candidate) => sameSku(candidate.sku, item.sku));
      if (existingItem) {
        existingItem.product_name = item.product_name || existingItem.product_name || null;
        existingItem.quantity_required = Number(existingItem.quantity_required || 0) + Number(item.quantity_required || 1);
      } else {
        existing.items.push({ ...item });
      }
    }
  }
  return [...groups.values()];
}

function reconcileImportedOrderItems(order, mapped) {
  let changed = false;
  const items = [...(order.items || [])];
  for (const item of mapped.items || []) {
    const existing = items.find((candidate) => sameSku(candidate.sku, item.sku));
    const required = Number(item.quantity_required || 1);
    if (!existing) {
      changed = true;
      items.push({
        id: uid(),
        sku: item.sku,
        product_name: item.product_name || null,
        quantity_required: required,
        quantity_scanned: 0,
        status: "pending",
        created_at: nowIso(),
        updated_at: nowIso()
      });
      continue;
    }

    if (Number(existing.quantity_required || 0) < required || (item.product_name && item.product_name !== existing.product_name)) {
      changed = true;
      existing.product_name = item.product_name || existing.product_name || null;
      existing.quantity_required = Math.max(Number(existing.quantity_required || 0), required);
      existing.status = Number(existing.quantity_scanned || 0) >= existing.quantity_required ? "verified" : existing.status;
      existing.updated_at = nowIso();
    }
  }
  return changed ? items : null;
}

function sameSku(left, right) {
  return String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase();
}

function productBarcodeDocId(barcode) {
  return encodeURIComponent(String(barcode || "").trim());
}

async function getProductBarcodeCache() {
  await ensureFirebaseReady();
  if (productBarcodeCache) return productBarcodeCache;
  productBarcodeCache = new Map();
  let mappings = [];
  try {
    mappings = await all("product_barcodes");
  } catch (error) {
    productBarcodeCacheUnavailable = true;
    console.warn("Product barcode mapping is unavailable.", error);
    return productBarcodeCache;
  }
  for (const mapping of mappings) {
    if (mapping.barcode && mapping.sku) productBarcodeCache.set(mapping.barcode, mapping);
  }
  return productBarcodeCache;
}

async function rememberFirebaseProductBarcode(barcode, item) {
  const normalizedBarcode = String(barcode || "").trim();
  if (!normalizedBarcode || sameSku(normalizedBarcode, item.sku)) return false;

  const cache = await getProductBarcodeCache();
  const now = nowIso();
  const existing = cache.get(normalizedBarcode);
  const record = {
    barcode: normalizedBarcode,
    sku: existing?.sku || item.sku,
    product_name: item.product_name || existing?.product_name || null,
    created_at: existing?.created_at || now,
    updated_at: now,
    last_seen_at: now,
    scan_count: Number(existing?.scan_count || 0) + 1
  };
  const db = requireFirestore();
  if (!productBarcodeCacheUnavailable) {
    try {
      await setDoc(doc(db, "product_barcodes", productBarcodeDocId(normalizedBarcode)), record, { merge: true });
    } catch (error) {
      productBarcodeCacheUnavailable = true;
      console.warn("Product barcode mapping could not be saved.", error);
    }
  }
  cache.set(normalizedBarcode, record);
  return true;
}

async function upsertFirebaseProductBarcode(payload) {
  await ensureFirebaseReady();
  const normalizedBarcode = String(payload.barcode || "").trim();
  const sku = String(payload.sku || "").trim();
  if (!normalizedBarcode || !sku) throw new Error("Barcode and SKU are required.");
  const cache = await getProductBarcodeCache();
  const existing = cache.get(normalizedBarcode);
  if (existing?.sku && !sameSku(existing.sku, sku) && !payload.allow_overwrite) {
    const error = new Error("Barcode already linked to another SKU.");
    error.code = "product_barcode_conflict";
    error.conflict = {
      barcode: normalizedBarcode,
      existing_sku: existing.sku,
      existing_product_name: existing.product_name || null,
      suggested_sku: sku,
      suggested_product_name: payload.product_name || null
    };
    throw error;
  }
  const now = nowIso();
  const record = {
    barcode: normalizedBarcode,
    sku,
    product_name: payload.product_name || existing?.product_name || null,
    created_at: existing?.created_at || now,
    updated_at: now,
    last_seen_at: now,
    scan_count: Number(existing?.scan_count || 0) + Number(payload.scan_count || 0)
  };
  const db = requireFirestore();
  await setDoc(doc(db, "product_barcodes", productBarcodeDocId(normalizedBarcode)), record, { merge: true });
  cache.set(normalizedBarcode, record);
  return record;
}

function skuConflictError({ barcode, savedMapping, candidate }) {
  const error = new Error("Barcode SKU conflict.");
  error.code = "sku_conflict";
  error.conflict = {
    barcode,
    existing_sku: savedMapping.sku,
    existing_product_name: savedMapping.product_name || null,
    suggested_sku: candidate.sku,
    suggested_product_name: candidate.product_name || null
  };
  return error;
}

async function resolveFirebaseScannedOrderItem(order, scannedSku) {
  const directItem = order.items.find((candidate) => sameSku(candidate.sku, scannedSku));
  if (directItem) return { item: directItem, mappedBarcode: false };

  const barcode = String(scannedSku || "").trim();
  if (!barcode) {
    return { error: "Scanned SKU is required." };
  }

  const cache = await getProductBarcodeCache();
  const savedMapping = cache.get(barcode);
  if (savedMapping) {
    const mappedItem = order.items.find((candidate) => sameSku(candidate.sku, savedMapping.sku));
    if (mappedItem) {
      await rememberFirebaseProductBarcode(barcode, mappedItem);
      return { item: mappedItem, mappedBarcode: true };
    }
    const remainingItems = order.items.filter((candidate) => candidate.quantity_scanned < candidate.quantity_required);
    const candidates = remainingItems.length ? remainingItems : order.items;
    if (candidates.length === 1) {
      return { conflict: { barcode, savedMapping, candidate: candidates[0] } };
    }
    return { error: "Barcode is linked to a SKU that is not in this order." };
  }

  const remainingItems = order.items.filter((candidate) => candidate.quantity_scanned < candidate.quantity_required);
  const candidates = remainingItems.length ? remainingItems : order.items;
  if (candidates.length === 1) {
    await rememberFirebaseProductBarcode(barcode, candidates[0]);
    return { item: candidates[0], mappedBarcode: true, newMapping: true };
  }

  return { error: "Barcode is not linked to a SKU yet." };
}

async function ensureSeedData() {
  const db = requireFirestore();
  await ensureFirebaseAuth();

  for (const provider of DEFAULT_PROVIDERS) {
    await setDoc(doc(db, "shipping_providers", provider.id), provider, { merge: true });
  }

  for (const packer of DEFAULT_PACKERS) {
    await setDoc(doc(db, "packers", packer.id), packer, { merge: true });
  }
}

export async function ensureFirebaseReady() {
  readyPromise ||= ensureSeedData();
  await readyPromise;
}

export async function listFirebaseProviders() {
  await ensureFirebaseReady();
  return all("shipping_providers");
}

export async function listFirebasePackers() {
  await ensureFirebaseReady();
  return all("packers");
}

export async function listFirebaseProductBarcodes() {
  await ensureFirebaseReady();
  const mappings = await all("product_barcodes");
  return mappings.sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
}

export async function importFirebaseProductBarcodes(records = []) {
  await ensureFirebaseReady();
  let imported = 0;
  let skipped = 0;
  let conflicted = 0;
  const items = [];
  const conflicts = [];
  for (const record of records) {
    try {
      const saved = await upsertFirebaseProductBarcode(record);
      items.push(saved);
      imported += 1;
    } catch (error) {
      if (error.code === "product_barcode_conflict") {
        conflicted += 1;
        conflicts.push(error.conflict);
        continue;
      }
      skipped += 1;
    }
  }
  return { imported, skipped, conflicted, conflicts, product_barcodes: await listFirebaseProductBarcodes(), imported_items: items };
}

export async function resolveFirebaseProductBarcodeConflict(payload) {
  return upsertFirebaseProductBarcode({ ...payload, allow_overwrite: true });
}

export async function recordFirebaseSkuConflictResolution(payload = {}) {
  await ensureFirebaseReady();
  await addFirebaseScanEvent({
    order_id: payload.order_id || null,
    packer_id: payload.packer_id || null,
    scan_type: "sku_conflict_resolution",
    scanned_value: payload.barcode || payload.scanned_value || "",
    result: "success",
    message: `kept=${payload.kept_sku || ""}; suggested=${payload.suggested_sku || ""}; action=${payload.action || "keep_existing"}`
  });
  return { ok: true };
}

export async function createFirebasePacker(payload) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const id = payload.employee_code || uid();
  const record = {
    id,
    employee_code: payload.employee_code,
    barcode: payload.barcode || payload.employee_code,
    display_name: payload.display_name,
    active: 1,
    created_at: nowIso(),
    updated_at: nowIso()
  };
  await setDoc(doc(db, "packers", id), record);
  return listFirebasePackers();
}

export async function createFirebaseProvider(payload) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const code = String(payload.code || "").toUpperCase();
  const record = {
    id: code,
    code,
    name: payload.name,
    display_name: payload.display_name || payload.name,
    active: 1,
    created_at: nowIso(),
    updated_at: nowIso()
  };
  await setDoc(doc(db, "shipping_providers", code), record);
  return listFirebaseProviders();
}

export async function listFirebaseOrders({ status, channel, q, date, month } = {}) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const baseFilters = [];
  if (status && !(date || month)) baseFilters.push(where("status", "==", status));
  if (channel && !(date || month)) baseFilters.push(where("channel", "==", channel));

  let orders = [];
  const bounds = periodBounds({ date, month });
  if (bounds) {
    const dateFields = ["shipped_date_key", "packed_date_key", "ready_to_pack_date_key", "imported_date_key", "created_date_key", "updated_date_key"];
    const snapshots = await Promise.all(dateFields.map((field) => getDocs(query(
      collection(db, "orders"),
      where(field, ">=", bounds.start),
      where(field, "<=", bounds.end),
      orderBy(field, "desc"),
      limit(2000)
    )).catch((error) => {
      console.warn(`Order date query skipped for ${field}.`, error);
      return { docs: [] };
    })));
    orders = mergeUniqueById(snapshots.flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))));

    const fallbackSnapshot = await getDocs(query(collection(db, "orders"), orderBy("updated_at", "desc"), limit(1000)));
    orders = mergeUniqueById([...orders, ...fallbackSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))]);
  } else {
    const snapshot = await getDocs(query(
      collection(db, "orders"),
      ...baseFilters,
      orderBy("updated_at", "desc"),
      limit(300)
    ));
    orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }

  if (date || month) {
    orders = orders.filter((order) => orderMatchesPeriod(order, { date, month }));
  }

  if (status && (date || month)) {
    orders = orders.filter((order) => order.status === status);
  }

  if (channel && (date || month)) {
    orders = orders.filter((order) => order.channel === channel);
  }

  if (q) {
    const term = q.toLowerCase();
    orders = orders.filter((order) => {
      return String(order.tracking_id || "").toLowerCase().includes(term)
        || String(order.order_key || "").toLowerCase().includes(term)
        || String(order.customer_name || "").toLowerCase().includes(term)
        || String(order.shipping_option || "").toLowerCase().includes(term);
    });
  }

  orders = orders.sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
  return decorateFirebaseOrders(orders);
}

export async function listFirebaseReadyOrders() {
  const orders = await listFirebaseOrders();
  return orders.filter((order) => ["Ready to Pack", "Packing In Progress", "Scan Completed", "Verified", "Packed"].includes(order.status));
}

export async function getFirebaseOrder(id) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const snapshot = await getDoc(doc(db, "orders", id));
  if (!snapshot.exists()) return null;
  return decorateFirebaseOrder({ id: snapshot.id, ...snapshot.data() });
}

export async function createFirebaseOrder(payload) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const orders = await listFirebaseOrders();
  const orderKey = String(payload.order_key || "").trim();
  const trackingId = String(payload.tracking_id || orderKey).trim();

  if (!orderKey || !trackingId) throw new Error("Order key and tracking id are required.");
  if (orders.some((order) => order.tracking_id === trackingId || (order.channel === payload.channel && order.order_key === orderKey))) {
    throw new Error("Order or tracking already exists.");
  }

  const items = (payload.items || [])
    .filter((item) => item.sku)
    .map((item) => ({
      id: uid(),
      sku: String(item.sku).trim(),
      product_name: item.product_name || null,
      quantity_required: Number(item.quantity_required || 1),
      quantity_scanned: 0,
      status: "pending",
      created_at: nowIso(),
      updated_at: nowIso()
    }));

  if (items.length === 0) throw new Error("At least one valid SKU item is required.");

  const provider = await providerByCode(payload.shipping_provider_code || "GENERAL");
  const createdAt = nowIso();
  const ref = doc(collection(db, "orders"));
  const record = {
    id: ref.id,
    channel: payload.channel || "reservation",
    order_key: orderKey,
    order_item_id: payload.order_item_id || null,
    tracking_id: trackingId,
    customer_name: payload.customer_name || null,
    shipping_provider_id: provider?.id || "GENERAL",
    shipping_option: payload.shipping_option || null,
    status: "Ready to Pack",
    packed_by: null,
    imported_at: createdAt,
    ready_to_pack_at: createdAt,
    packing_started_at: null,
    packed_at: null,
    shipped_at: null,
    source_file_name: "manual-entry",
    deduplication_action: "created",
    created_at: createdAt,
    updated_at: createdAt,
    items
  };
  const savedRecord = { ...record, ...orderDatePatchFromFields(record) };
  await setDoc(ref, savedRecord);
  return decorateFirebaseOrder(savedRecord);
}

export async function lookupFirebaseOrder(value, packerId) {
  await ensureFirebaseReady();
  const order = await lookupOnly(value);

  if (!order) {
    await addFirebaseScanEvent({ packer_id: packerId || null, scan_type: "order_lookup", scanned_value: value, result: "error", message: "Order not found" });
    throw new Error("Order not found.");
  }

  const patch = {
    status: order.status === "Ready to Pack" ? "Packing In Progress" : order.status,
    packed_by: order.packed_by || packerId || null,
    packing_started_at: order.packing_started_at || nowIso()
  };
  await updateFirebaseOrder(order.id, patch);
  await addFirebaseScanEvent({ order_id: order.id, packer_id: packerId || null, scan_type: "order_lookup", scanned_value: value, result: "success", message: "Order loaded" });
  return getFirebaseOrder(order.id);
}

export async function scanFirebaseSku(orderId, scannedSku, packerId, quantity = 1) {
  const order = await getFirebaseOrder(orderId);
  if (!order) throw new Error("Order not found.");
  const scanQuantity = Number(quantity || 1);
  if (!Number.isInteger(scanQuantity) || scanQuantity < 1) {
    throw new Error("Scan quantity must be at least 1.");
  }

  const resolved = await resolveFirebaseScannedOrderItem(order, scannedSku);
  if (resolved.conflict) {
    await addFirebaseScanEvent({ order_id: order.id, packer_id: packerId || null, scan_type: "item_verify", scanned_value: scannedSku, result: "error", message: "Barcode SKU conflict." });
    throw skuConflictError(resolved.conflict);
  }
  if (resolved.error) {
    await addFirebaseScanEvent({ order_id: order.id, packer_id: packerId || null, scan_type: "item_verify", scanned_value: scannedSku, result: "error", message: resolved.error });
    throw new Error(resolved.error);
  }
  const item = resolved.item;

  if (item.quantity_scanned >= item.quantity_required) {
    await addFirebaseScanEvent({ order_id: order.id, order_item_id: item.id, packer_id: packerId || null, scan_type: "item_verify", scanned_value: scannedSku, result: "error", message: "Quantity already completed" });
    throw new Error("Quantity already completed.");
  }

  if (scanQuantity > item.quantity_required - item.quantity_scanned) {
    await addFirebaseScanEvent({ order_id: order.id, order_item_id: item.id, packer_id: packerId || null, scan_type: "item_verify", scanned_value: scannedSku, result: "error", message: "Scan quantity exceeds remaining quantity" });
    throw new Error("Scan quantity exceeds remaining quantity.");
  }

  const items = order.items.map((candidate) => {
    if (candidate.id !== item.id) return candidate;
    const nextQty = candidate.quantity_scanned + scanQuantity;
    return {
      ...candidate,
      quantity_scanned: nextQty,
      status: nextQty >= candidate.quantity_required ? "verified" : "partial",
      updated_at: nowIso()
    };
  });
  const packed = items.every((candidate) => candidate.status === "verified");
  await updateFirebaseOrder(order.id, {
    items,
    status: packed ? "Scan Completed" : "Packing In Progress",
    packed_by: order.packed_by || packerId || null
  });
  const nextItem = items.find((candidate) => candidate.id === item.id);
  await addFirebaseScanEvent({ order_id: order.id, order_item_id: item.id, packer_id: packerId || null, scan_type: "item_verify", scanned_value: scannedSku, result: "success", message: `+${scanQuantity} => ${nextItem.quantity_scanned}/${nextItem.quantity_required}` });

  return {
    result: "success",
    sku: nextItem.sku,
    scanned_sku: scannedSku,
    product_name: nextItem.product_name,
    mapped_barcode: !!resolved.mappedBarcode,
    new_barcode_mapping: !!resolved.newMapping,
    quantity_added: scanQuantity,
    quantity_scanned: nextItem.quantity_scanned,
    quantity_required: nextItem.quantity_required,
    item_status: nextItem.status,
    order_status: packed ? "Scan Completed" : "Packing In Progress",
    order: {
      ...order,
      items,
      status: packed ? "Scan Completed" : "Packing In Progress",
      packed_by: order.packed_by || packerId || null
    }
  };
}

export async function confirmFirebasePackingScan(orderId, packerId) {
  const order = await getFirebaseOrder(orderId);
  if (!order) throw new Error("Order not found.");
  if ((order.items || []).some((item) => item.quantity_scanned < item.quantity_required)) {
    throw new Error("Order scan is not complete.");
  }

  const packedAt = order.packed_at || nowIso();
  await updateFirebaseOrder(order.id, {
    status: "Packed",
    packed_by: order.packed_by || packerId || null,
    packed_at: packedAt
  });
  await addFirebaseScanEvent({ order_id: order.id, packer_id: packerId || null, scan_type: "packing_confirm", scanned_value: order.tracking_id, result: "success", message: "Packing scan confirmed" });

  return {
    result: "success",
    order_status: "Packed",
    order: {
      ...order,
      status: "Packed",
      packed_by: order.packed_by || packerId || null,
      packed_at: packedAt
    }
  };
}

export async function dispatchFirebaseOrder(value) {
  const order = await lookupOnly(value);
  if (!order) throw new Error("Order not found.");
  if (!["Packed", "Verified", "Shipped / Handed Over"].includes(order.status)) throw new Error("Order must be packed before dispatch.");

  const duplicate = order.status === "Shipped / Handed Over" || !!order.shipped_at;
  const shippedAt = order.shipped_at || nowIso();
  if (!duplicate) {
    await updateFirebaseOrder(order.id, {
      status: "Shipped / Handed Over",
      shipped_at: shippedAt
    });
  }
  const refreshed = await getFirebaseOrder(order.id);
  await addFirebaseScanEvent({
    order_id: order.id,
    scan_type: "final_dispatch",
    scanned_value: value,
    result: duplicate ? "duplicate" : "success",
    message: duplicate ? "Already shipped / handed over" : refreshed.shipping_provider
  });
  return {
    order_id: order.id,
    status: "Shipped / Handed Over",
    shipping_provider: { display_name: refreshed.shipping_provider },
    shipping_option: refreshed.shipping_option || null,
    shipped_at: shippedAt,
    duplicate
  };
}

export async function identifyFirebasePacker(barcode) {
  await ensureFirebaseReady();
  const packers = await listFirebasePackers();
  const packer = packers.find((item) => item.barcode === barcode);
  if (!packer) throw new Error("Packer barcode not found.");
  await addFirebaseScanEvent({ packer_id: packer.id, scan_type: "packer", scanned_value: barcode, result: "success", message: "Packer identified" });
  return { packer_id: packer.id, display_name: packer.display_name };
}

export async function listFirebaseScanEvents({ date, month } = {}) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const bounds = periodBounds({ date, month });
  let events = [];
  if (bounds) {
    const snapshot = await getDocs(query(
      collection(db, "scan_events"),
      where("event_date_key", ">=", bounds.start),
      where("event_date_key", "<=", bounds.end),
      orderBy("event_date_key", "desc"),
      limit(2000)
    )).catch((error) => {
      console.warn("Scan event date query skipped.", error);
      return { docs: [] };
    });
    events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

    const fallbackSnapshot = await getDocs(query(collection(db, "scan_events"), orderBy("created_at", "desc"), limit(1000)));
    events = mergeUniqueById([...events, ...fallbackSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))]);
  } else {
    const snapshot = await getDocs(query(collection(db, "scan_events"), orderBy("created_at", "desc"), limit(100)));
    events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }
  events = events
    .filter((event) => periodMatchesIso(event.event_date_key || event.created_at, { date, month }))
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
  const [listedOrders, packers] = await Promise.all([listFirebaseOrders(), listFirebasePackers()]);
  const missingOrderIds = [...new Set(events
    .map((event) => event.order_id)
    .filter((id) => id && !listedOrders.some((order) => order.id === id)))];
  const fetchedOrders = await Promise.all(missingOrderIds.map(async (id) => {
    const snapshot = await getDoc(doc(db, "orders", id)).catch(() => null);
    return snapshot?.exists?.() ? { id: snapshot.id, ...snapshot.data() } : null;
  }));
  const orders = mergeUniqueById([...listedOrders, ...fetchedOrders]);
  return events.map((event) => {
    const order = orders.find((item) => item.id === event.order_id);
    const packer = packers.find((item) => item.id === event.packer_id);
    return { ...event, order_key: order?.order_key, tracking_id: order?.tracking_id, packer_name: packer?.display_name };
  });
}

export async function listFirebaseSalesDispatchScans({ date, month } = {}) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const scansCollection = collection(db, "sales_dispatch_scans");
  const snapshot = month
    ? await getDocs(query(
      scansCollection,
      where("date_key", ">=", `${month}-01`),
      where("date_key", "<=", `${month}-31`),
      limit(1000)
    ))
    : await getDocs(query(
      scansCollection,
      where("date_key", "==", date || localDateKey()),
      limit(500)
    ));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((left, right) => String(right.scanned_at || "").localeCompare(String(left.scanned_at || "")));
}

export async function recordFirebaseSalesDispatchScan(value) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const order = await lookupOnly(value);
  if (!order) {
    await addFirebaseScanEvent({ scan_type: "sales_ready_scan", scanned_value: value, result: "error", message: "Order not found" });
    throw new Error("Order not found.");
  }

  const dateKey = localDateKey();
  const id = `${dateKey}_${order.id}`;
  const existing = await getDoc(doc(db, "sales_dispatch_scans", id));
  const scannedAt = nowIso();
  const record = {
    id,
    date_key: dateKey,
    order_id: order.id,
    order_key: order.order_key,
    tracking_id: order.tracking_id,
    channel: order.channel || "reservation",
    customer_name: order.customer_name || null,
    shipping_provider: order.shipping_provider || "ไม่ระบุขนส่ง",
    shipping_option: order.shipping_option || null,
    status: order.status,
    scanned_value: value,
    scan_count: existing.exists() ? Number(existing.data().scan_count || 1) + 1 : 1,
    scanned_at: scannedAt,
    created_at: existing.exists() ? existing.data().created_at || scannedAt : scannedAt,
    updated_at: scannedAt
  };
  await setDoc(doc(db, "sales_dispatch_scans", id), record, { merge: true });
  await addFirebaseScanEvent({ order_id: order.id, scan_type: "sales_ready_scan", scanned_value: value, result: "success", message: order.channel || "reservation" });
  return record;
}

export async function listFirebaseBatches() {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const snapshot = await getDocs(query(collection(db, "import_batches"), orderBy("created_at", "desc"), limit(100)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function resetFirebaseDemo() {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const rows = [
    { channel: "shopee", order_key: `SHP-${Date.now()}`, tracking_id: `SPX-${Date.now()}`, customer_name: "Demo Customer A", shipping_provider_code: "SPX", items: [{ sku: "COF-DRIP-001", product_name: "Drip Coffee", quantity_required: 2 }] },
    { channel: "lazada", order_key: `LAZ-${Date.now()}`, tracking_id: `LEX-${Date.now()}`, customer_name: "Demo Customer B", shipping_provider_code: "LEX", items: [{ sku: "COF-BEAN-250G", product_name: "Coffee Beans 250g", quantity_required: 1 }] }
  ];
  for (const row of rows) await createFirebaseOrder(row);
  const batch = { source: "firebase-demo", channel: "mixed", file_name: "firebase-demo", total_rows: rows.length, created_count: rows.length, ignored_count: 0, overwritten_count: 0, error_count: 0, status: "completed", created_at: nowIso(), completed_at: nowIso() };
  await addDoc(collection(db, "import_batches"), batch);
  return { ok: true, batches: [batch], demo_scans: ["EMP001", rows[0].tracking_id, "COF-DRIP-001", "COF-DRIP-001"] };
}

export async function importFirebaseFile({ file, channel, deduplicationAction }) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const parsed = await parseImportFileAuto(file);
  const rows = parsed.rows;
  const detectedChannel = channel && channel !== "auto" ? channel : parsed.channel;
  const stats = {
    batch_id: uid(),
    status: "completed",
    channel: detectedChannel,
    detected_channel: parsed.channel,
    total_rows: rows.length,
    created_count: 0,
    ignored_count: 0,
    overwritten_count: 0,
    error_count: 0,
    errors: []
  };

  const mappedRows = [];
  for (let index = 0; index < rows.length; index += 1) {
    try {
      const mapped = mapImportRow(rows[index], detectedChannel);
      if (!mapped.order_key || !mapped.tracking_id || !mapped.items[0]?.sku) {
        throw new Error(`Row ${index + 2}: missing order, tracking, or sku`);
      }
      mappedRows.push(mapped);
    } catch (error) {
      stats.error_count += 1;
      stats.errors.push(error.message);
    }
  }

  for (const mapped of aggregateImportOrders(mappedRows)) {
    try {
      const existing = await lookupOnly(mapped.tracking_id) || await lookupOnly(mapped.order_key);
      if (existing && deduplicationAction !== "overwrite") {
        const reconciledItems = reconcileImportedOrderItems(existing, mapped);
        if (reconciledItems || (!existing.shipping_option && mapped.shipping_option)) {
          await updateFirebaseOrder(existing.id, {
            ...(reconciledItems ? { items: reconciledItems } : {}),
            shipping_option: existing.shipping_option || mapped.shipping_option || null,
            deduplication_action: "ignored"
          });
        }
        stats.ignored_count += 1;
        continue;
      }

      if (existing && deduplicationAction === "overwrite") {
        const readyAt = nowIso();
        await updateFirebaseOrder(existing.id, {
          ...mapped,
          items: mapped.items.map((item) => ({
            id: uid(),
            sku: item.sku,
            product_name: item.product_name || null,
            quantity_required: Number(item.quantity_required || 1),
            quantity_scanned: 0,
            status: "pending",
            created_at: nowIso(),
            updated_at: nowIso()
          })),
          status: "Ready to Pack",
          source_file_name: file.name,
          deduplication_action: "overwritten",
          ready_to_pack_at: readyAt
        });
        stats.overwritten_count += 1;
      } else {
        await createFirebaseOrder({
          ...mapped,
          source_file_name: file.name
        });
        stats.created_count += 1;
      }
    } catch (error) {
      stats.error_count += 1;
      stats.errors.push(error.message);
    }
  }

  stats.status = stats.error_count ? "completed_with_errors" : "completed";
  const batch = {
    ...stats,
    id: stats.batch_id,
    source: "file",
    channel: detectedChannel,
    detected_channel: parsed.channel,
    file_name: file.name,
    deduplication_action: deduplicationAction,
    created_at: nowIso(),
    completed_at: nowIso()
  };
  await setDoc(doc(db, "import_batches", stats.batch_id), batch);
  return stats;
}

export async function firebaseSummary() {
  const [orders, events] = await Promise.all([listFirebaseOrders(), listFirebaseScanEvents()]);
  const today = nowIso().slice(0, 10);
  const active = orders.filter((order) => ["Ready to Pack", "Packing In Progress", "Scan Completed", "Verified", "Packed"].includes(order.status));
  return {
    totals: {
      ready: orders.filter((order) => order.status === "Ready to Pack").length,
      in_progress: orders.filter((order) => order.status === "Packing In Progress").length,
      packed_today: orders.filter((order) => String(order.packed_at || "").startsWith(today)).length,
      shipped_today: orders.filter((order) => String(order.shipped_at || "").startsWith(today)).length,
      error_scans_today: events.filter((event) => event.result === "error" && String(event.created_at || "").startsWith(today)).length
    },
    by_status: Object.values(orders.reduce((acc, order) => {
      acc[order.status] = acc[order.status] || { status: order.status, count: 0 };
      acc[order.status].count += 1;
      return acc;
    }, {})),
    by_provider: Object.values(active.reduce((acc, order) => {
      acc[order.shipping_provider] = acc[order.shipping_provider] || { shipping_provider: order.shipping_provider, count: 0 };
      acc[order.shipping_provider].count += 1;
      return acc;
    }, {}))
  };
}

async function updateFirebaseOrder(id, patch) {
  const db = requireFirestore();
  const updatedAt = nowIso();
  const nextPatch = { ...patch, updated_at: updatedAt };
  await updateDoc(doc(db, "orders", id), { ...nextPatch, ...orderDatePatchFromFields(nextPatch) });
}

async function addFirebaseScanEvent(event) {
  const db = requireFirestore();
  await addDoc(collection(db, "scan_events"), { ...event, ...eventDatePatch(event) });
}

async function lookupOnly(value) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const rawTerm = String(value || "").trim();
  if (!rawTerm) return null;

  for (const field of ["tracking_id", "order_key"]) {
    const snapshot = await getDocs(query(collection(db, "orders"), where(field, "==", rawTerm), limit(1)));
    if (!snapshot.empty) {
      const item = snapshot.docs[0];
      return decorateFirebaseOrder({ id: item.id, ...item.data() });
    }
  }

  const customerExact = await getDocs(query(collection(db, "orders"), where("customer_name", "==", rawTerm), limit(1)));
  if (!customerExact.empty) {
    const item = customerExact.docs[0];
    return decorateFirebaseOrder({ id: item.id, ...item.data() });
  }

  const customerPrefix = await getDocs(query(
    collection(db, "orders"),
    orderBy("customer_name"),
    startAt(rawTerm),
    endAt(`${rawTerm}\uf8ff`),
    limit(10)
  )).catch(() => ({ docs: [] }));
  if (!customerPrefix.empty) {
    const item = customerPrefix.docs[0];
    return decorateFirebaseOrder({ id: item.id, ...item.data() });
  }

  const orders = await listFirebaseOrders();
  const term = rawTerm.toLowerCase();
  return orders.find((candidate) => {
    return String(candidate.tracking_id || "").toLowerCase() === term
      || String(candidate.order_key || "").toLowerCase() === term
      || String(candidate.customer_name || "").toLowerCase().includes(term)
      || String(candidate.shipping_option || "").toLowerCase().includes(term);
  });
}

async function providerByCode(code) {
  const providers = await listFirebaseProviders();
  return providers.find((provider) => provider.code === String(code || "").toUpperCase()) || providers.find((provider) => provider.code === "GENERAL");
}

async function decorateFirebaseOrder(order) {
  const [providers, packers] = await Promise.all([listFirebaseProviders(), listFirebasePackers()]);
  const provider = providers.find((item) => item.id === order.shipping_provider_id || item.code === order.shipping_provider_id);
  const packer = packers.find((item) => item.id === order.packed_by);
  return {
    ...order,
    shipping_provider: provider?.display_name || "ไม่ระบุขนส่ง",
    packed_by_name: packer?.display_name || null
  };
}

async function decorateFirebaseOrders(orders) {
  return Promise.all(orders.map((order) => decorateFirebaseOrder(order)));
}
