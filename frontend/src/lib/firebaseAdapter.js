import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
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

export async function listFirebaseOrders({ status, channel, q } = {}) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const filters = [];
  if (status) filters.push(where("status", "==", status));
  if (channel) filters.push(where("channel", "==", channel));

  const snapshot = await getDocs(query(
    collection(db, "orders"),
    ...filters,
    orderBy("updated_at", "desc"),
    limit(300)
  ));
  let orders = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

  if (q) {
    const term = q.toLowerCase();
    orders = orders.filter((order) => {
      return String(order.tracking_id || "").toLowerCase().includes(term)
        || String(order.order_key || "").toLowerCase().includes(term)
        || String(order.customer_name || "").toLowerCase().includes(term);
    });
  }

  return decorateFirebaseOrders(orders);
}

export async function listFirebaseReadyOrders() {
  const orders = await listFirebaseOrders();
  return orders.filter((order) => ["Ready to Pack", "Packing In Progress", "Verified", "Packed"].includes(order.status));
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
    order_item_id: null,
    tracking_id: trackingId,
    customer_name: payload.customer_name || null,
    shipping_provider_id: provider?.id || "GENERAL",
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
  await setDoc(ref, record);
  return decorateFirebaseOrder(record);
}

export async function lookupFirebaseOrder(value, packerId) {
  await ensureFirebaseReady();
  const orders = await listFirebaseOrders();
  const term = String(value || "").trim().toLowerCase();
  const order = orders.find((candidate) => {
    return String(candidate.tracking_id || "").toLowerCase() === term
      || String(candidate.order_key || "").toLowerCase() === term
      || String(candidate.customer_name || "").toLowerCase().includes(term);
  });

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

  const item = order.items.find((candidate) => candidate.sku.toUpperCase() === String(scannedSku || "").trim().toUpperCase());
  if (!item) {
    await addFirebaseScanEvent({ order_id: order.id, packer_id: packerId || null, scan_type: "item_verify", scanned_value: scannedSku, result: "error", message: "SKU does not match this order" });
    throw new Error("SKU does not match this order.");
  }

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
    status: packed ? "Packed" : "Packing In Progress",
    packed_by: order.packed_by || packerId || null,
    packed_at: packed ? nowIso() : order.packed_at || null
  });
  const nextItem = items.find((candidate) => candidate.id === item.id);
  await addFirebaseScanEvent({ order_id: order.id, order_item_id: item.id, packer_id: packerId || null, scan_type: "item_verify", scanned_value: scannedSku, result: "success", message: `+${scanQuantity} => ${nextItem.quantity_scanned}/${nextItem.quantity_required}` });

  return {
    result: "success",
    sku: nextItem.sku,
    scanned_sku: scannedSku,
    product_name: nextItem.product_name,
    quantity_added: scanQuantity,
    quantity_scanned: nextItem.quantity_scanned,
    quantity_required: nextItem.quantity_required,
    item_status: nextItem.status,
    order_status: packed ? "Packed" : "Packing In Progress",
    order: await getFirebaseOrder(order.id)
  };
}

export async function dispatchFirebaseOrder(value) {
  const order = await lookupOnly(value);
  if (!order) throw new Error("Order not found.");
  if (!["Packed", "Verified", "Shipped / Handed Over"].includes(order.status)) throw new Error("Order must be packed before dispatch.");

  const shippedAt = order.shipped_at || nowIso();
  await updateFirebaseOrder(order.id, {
    status: "Shipped / Handed Over",
    shipped_at: shippedAt
  });
  const refreshed = await getFirebaseOrder(order.id);
  await addFirebaseScanEvent({ order_id: order.id, scan_type: "final_dispatch", scanned_value: value, result: "success", message: refreshed.shipping_provider });
  return {
    order_id: order.id,
    status: "Shipped / Handed Over",
    shipping_provider: { display_name: refreshed.shipping_provider },
    shipped_at: shippedAt
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

export async function listFirebaseScanEvents() {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const snapshot = await getDocs(query(collection(db, "scan_events"), orderBy("created_at", "desc"), limit(100)));
  const events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const [orders, packers] = await Promise.all([listFirebaseOrders(), listFirebasePackers()]);
  return events.map((event) => {
    const order = orders.find((item) => item.id === event.order_id);
    const packer = packers.find((item) => item.id === event.packer_id);
    return { ...event, order_key: order?.order_key, tracking_id: order?.tracking_id, packer_name: packer?.display_name };
  });
}

export async function listFirebaseSalesDispatchScans({ date } = {}) {
  await ensureFirebaseReady();
  const db = requireFirestore();
  const dateKey = date || localDateKey();
  const snapshot = await getDocs(query(
    collection(db, "sales_dispatch_scans"),
    where("date_key", "==", dateKey),
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

  for (let index = 0; index < rows.length; index += 1) {
    try {
      const mapped = mapImportRow(rows[index], detectedChannel);
      if (!mapped.order_key || !mapped.tracking_id || !mapped.items[0]?.sku) {
        throw new Error(`Row ${index + 2}: missing order, tracking, or sku`);
      }

      const existing = await lookupOnly(mapped.tracking_id) || await lookupOnly(mapped.order_key);
      if (existing && deduplicationAction !== "overwrite") {
        stats.ignored_count += 1;
        continue;
      }

      if (existing && deduplicationAction === "overwrite") {
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
          ready_to_pack_at: nowIso()
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
  const active = orders.filter((order) => ["Ready to Pack", "Packing In Progress", "Verified", "Packed"].includes(order.status));
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
  await updateDoc(doc(db, "orders", id), { ...patch, updated_at: nowIso() });
}

async function addFirebaseScanEvent(event) {
  const db = requireFirestore();
  await addDoc(collection(db, "scan_events"), { ...event, created_at: nowIso() });
}

async function lookupOnly(value) {
  const orders = await listFirebaseOrders();
  const term = String(value || "").trim().toLowerCase();
  return orders.find((candidate) => {
    return String(candidate.tracking_id || "").toLowerCase() === term
      || String(candidate.order_key || "").toLowerCase() === term
      || String(candidate.customer_name || "").toLowerCase().includes(term);
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
