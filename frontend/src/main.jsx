import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Archive,
  Barcode,
  Boxes,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileClock,
  LayoutDashboard,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Truck,
  Trash2,
  Upload,
  UserRoundPlus,
  Users
} from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { parseImportFileAuto, recordsToCsv } from "./lib/importParser";
import {
  createFirebaseOrder,
  createFirebasePacker,
  createFirebaseProvider,
  confirmFirebasePackingScan,
  dispatchFirebaseOrder,
  firebaseSummary,
  identifyFirebasePacker,
  importFirebaseFile,
  listFirebaseSalesDispatchScans,
  listFirebaseBatches,
  listFirebaseOrders,
  listFirebasePackers,
  listFirebaseProviders,
  listFirebaseReadyOrders,
  listFirebaseScanEvents,
  lookupFirebaseOrder,
  resetFirebaseDemo,
  recordFirebaseSalesDispatchScan,
  scanFirebaseSku,
  getFirebaseOrder
} from "./lib/firebaseAdapter";
import "./styles.css";

const IS_NATIVE_WEBVIEW = Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.getPlatform?.() === "android");
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";
const LOCAL_STORE_KEY = "hillkoff-packing-local-db-v1";
const DATA_MODE = import.meta.env.VITE_DATA_MODE || (IS_NATIVE_WEBVIEW ? "local" : "api");

const CAMERA_SCAN_FORMATS = {
  product: [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF
  ],
  mixed: [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX
  ]
};

const CAMERA_SCAN_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
    frameRate: { ideal: 30, min: 15 },
    focusMode: { ideal: "continuous" }
  }
};

const CAMERA_SCAN_FALLBACK_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 24 }
  }
};

function createScannerReader(profile = "mixed") {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, CAMERA_SCAN_FORMATS[profile] || CAMERA_SCAN_FORMATS.mixed);
  if (profile === "product") hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: profile === "product" ? 70 : 100,
    delayBetweenScanSuccess: 250,
    tryPlayVideoTimeout: 7000
  });
}

async function optimizeCameraTrack(controls) {
  try {
    const capabilities = controls?.streamVideoCapabilitiesGet?.(() => true) || {};
    const constraints = { advanced: [] };

    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
      constraints.advanced.push({ focusMode: "continuous" });
    }

    if (capabilities.zoom) {
      const min = Number(capabilities.zoom.min || 1);
      const max = Number(capabilities.zoom.max || min);
      const targetZoom = Math.min(max, Math.max(min, 1.6));
      constraints.advanced.push({ zoom: targetZoom });
    }

    if (constraints.advanced.length) {
      await controls.streamVideoConstraintsApply?.(constraints, () => true);
    }
  } catch (error) {
    console.warn("Camera optimization skipped.", error);
  }
}

function registerServiceWorker() {
  if (IS_NATIVE_WEBVIEW || !("serviceWorker" in navigator) || import.meta.env.DEV) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
      console.warn("Service worker registration failed.", error);
    });
  });
}

const NAV_ITEMS = [
  { id: "dashboard", label: "ภาพรวมงาน", icon: LayoutDashboard },
  { id: "import", label: "1. นำเข้าออเดอร์", icon: Upload },
  { id: "new-order", label: "2. เพิ่มออเดอร์เอง", icon: Plus },
  { id: "packing", label: "3. แพ็คสินค้า", icon: PackageCheck },
  { id: "dispatch", label: "4. ส่งมอบขนส่ง", icon: Send },
  { id: "sales", label: "ฝ่ายขาย", icon: Archive },
  { id: "orders", label: "รายการออเดอร์", icon: ClipboardList },
  { id: "audit", label: "ประวัติสแกน", icon: FileClock },
  { id: "settings", label: "ตั้งค่า", icon: Settings }
];

const TITLE_LABELS = {
  "Operations Dashboard": "ภาพรวมงานวันนี้",
  "Import Orders": "1. นำเข้าออเดอร์",
  "New Order Entry": "2. เพิ่มออเดอร์เอง",
  "Packing Station": "3. แพ็คสินค้า",
  "Final Sorting & Dispatch": "4. ส่งมอบขนส่ง",
  "Sales Dispatch Sheet": "ฝ่ายขาย",
  "Order Control Center": "รายการออเดอร์",
  "Scan Audit": "ประวัติการสแกน",
  Settings: "ตั้งค่า"
};

const SUBTITLE_LABELS = {
  "Operations Dashboard": "ดูจำนวนออเดอร์ที่รอแพ็ค กำลังแพ็ค แพ็คเสร็จ และส่งมอบขนส่งแล้ว",
  "Import Orders": "แปลงไฟล์เป็น CSV ตรวจข้อมูล แล้วนำเข้าเป็นออเดอร์พร้อมแพ็ค",
  "New Order Entry": "ใช้สำหรับใบสั่งจองหรือออเดอร์ที่ไม่มีไฟล์นำเข้า กรอกแล้วส่งต่อไปหน้าแพ็ค",
  "Packing Station": "สแกนใบปะหน้าเพื่อดึงออเดอร์ แล้วสแกน SKU ทีละชิ้นให้ครบจำนวน",
  "Final Sorting & Dispatch": "สแกนกล่องที่ปิดแล้ว ระบบจะแสดงโซนขนส่งและเปลี่ยนสถานะเป็นส่งมอบแล้ว",
  "Sales Dispatch Sheet": "สแกนใบปะหน้าด้วยมือถือเพื่อเก็บรายการพร้อมจัดส่งประจำวัน แยกตามแพลตฟอร์ม และส่งออกเป็นไฟล์สำหรับ Excel",
  "Order Control Center": "ค้นหา ตรวจสถานะ และเปิดดูรายละเอียดออเดอร์ทั้งหมด",
  "Scan Audit": "ดูย้อนหลังว่าใครสแกนอะไร ผ่านหรือไม่ผ่าน ใช้ตรวจปัญหาได้",
  Settings: "จัดการพนักงานแพ็คและรายชื่อขนส่งที่ใช้ในระบบ"
};

const STATUS_LABELS = {
  "Ready to Pack": "รอแพ็ค",
  "Packing In Progress": "กำลังแพ็ค",
  "Scan Completed": "สแกนเสร็จ รอยืนยัน",
  Packed: "แพ็คเสร็จ",
  Verified: "ตรวจครบแล้ว",
  "Shipped / Handed Over": "ส่งมอบขนส่งแล้ว",
  pending: "รอสแกน",
  partial: "สแกนบางส่วน",
  verified: "ครบแล้ว",
  completed: "สำเร็จ",
  completed_with_errors: "สำเร็จบางส่วน"
};

const CHANNEL_LABELS = {
  shopee: "Shopee",
  lazada: "Lazada",
  tiktok: "TikTok",
  reservation: "ใบสั่งจอง/ออเดอร์ทั่วไป",
  mixed: "หลายช่องทาง"
};

const SCAN_TYPE_LABELS = {
  packer: "ระบุคนแพ็ค",
  order_lookup: "ค้นหาออเดอร์",
  item_verify: "ตรวจสินค้า",
  final_dispatch: "ยืนยันส่งออก",
  sales_ready_scan: "ฝ่ายขายบันทึกพร้อมส่ง"
};

const RESULT_LABELS = {
  success: "ผ่าน",
  error: "ไม่ผ่าน"
};

function hasBrokenThai(text) {
  return /เธ|เน|โ|ยท/.test(String(text || ""));
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || "-";
}

function channelLabel(channel) {
  return CHANNEL_LABELS[channel] || channel || "-";
}

function translateMessage(message) {
  const text = String(message || "");
  const exact = {
    "Order not found.": "ไม่พบออเดอร์",
    "Packer barcode not found.": "ไม่พบรหัสพนักงานแพ็ค",
    "SKU does not match this order.": "SKU ไม่ตรงกับออเดอร์นี้",
    "Quantity already completed.": "จำนวนสินค้ารายการนี้สแกนครบแล้ว",
    "Order must be packed before dispatch.": "ต้องแพ็คสินค้าให้ครบก่อนส่งมอบขนส่ง",
    "Order scan is not complete.": "ยังสแกนสินค้าไม่ครบ",
    "Scan quantity must be at least 1.": "จำนวนที่สแกนต้องอย่างน้อย 1",
    "Scan quantity exceeds remaining quantity.": "จำนวนที่ใส่มากกว่าจำนวนสินค้าที่ยังเหลือในออเดอร์",
    "Barcode is not linked to a SKU yet.": "บาร์โค้ดนี้ยังไม่ได้ผูกกับ SKU และออเดอร์นี้มีสินค้าหลายรายการ",
    "Barcode is linked to a SKU that is not in this order.": "บาร์โค้ดนี้ผูกกับ SKU ที่ไม่มีในออเดอร์นี้",
    "At least one valid SKU item is required.": "ต้องมีสินค้าอย่างน้อย 1 รายการ",
    "Order key and tracking id are required.": "กรุณากรอกเลขออเดอร์และเลขพัสดุ",
    "Order or tracking already exists.": "ออเดอร์หรือเลขพัสดุนี้มีอยู่แล้ว"
  };
  return exact[text] || text
    .replace("Row", "แถวที่")
    .replace("missing order, tracking, or sku", "ขาดเลขออเดอร์ เลขพัสดุ หรือ SKU");
}

async function api(path, options = {}) {
  if (DATA_MODE === "firebase") {
    return firebaseApi(path, options);
  }

  if (DATA_MODE === "local") {
    return localApi(path, options);
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      ...options
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.code || "Request failed");
    return data;
  } catch (error) {
    if (window.location.hostname.endsWith("github.io") || error instanceof TypeError) {
      return localApi(path, options);
    }
    throw error;
  }
}

async function firebaseApi(path, options = {}) {
  const method = options.method || "GET";
  const body = options.body && !(options.body instanceof FormData) ? JSON.parse(options.body) : {};

  if (path === "/health") return { ok: true, service: "hillkoff-packing-firebase" };
  if (path === "/reference/packers") return { packers: await listFirebasePackers() };
  if (path === "/reference/shipping-providers") return { shipping_providers: await listFirebaseProviders() };
  if (path === "/dashboard/summary") return firebaseSummary();
  if (path === "/orders/ready") return { orders: await listFirebaseReadyOrders() };
  if (path === "/imports/batches") return { batches: await listFirebaseBatches() };
  if (path === "/scan-events") return { events: await listFirebaseScanEvents() };
  if (path.startsWith("/sales/dispatch-scans") && method === "GET") {
    const params = new URLSearchParams(path.split("?")[1] || "");
    return {
      scans: await listFirebaseSalesDispatchScans({
        date: params.get("date") || "",
        month: params.get("month") || ""
      })
    };
  }
  if (path === "/sales/dispatch-scans" && method === "POST") {
    return { scan: await recordFirebaseSalesDispatchScan(body.tracking_or_order_id) };
  }
  if (path === "/demo/reset" && method === "POST") return resetFirebaseDemo();
  if (path === "/imports/orders" && method === "POST" && options.body instanceof FormData) {
    return importFirebaseFile({
      file: options.body.get("file"),
      channel: options.body.get("channel"),
      deduplicationAction: options.body.get("deduplication_action") || "ignore"
    });
  }
  if (path === "/orders" && method === "POST") return createFirebaseOrder(body);
  if (path.startsWith("/orders?")) {
    const params = new URLSearchParams(path.split("?")[1]);
    return {
      orders: await listFirebaseOrders({
        q: params.get("q") || "",
        status: params.get("status") || "",
        channel: params.get("channel") || ""
      })
    };
  }
  if (path.startsWith("/orders/") && method === "GET") {
    const detail = await getFirebaseOrder(path.split("/")[2]);
    if (!detail) throw new Error("Order not found.");
    return detail;
  }
  if (path === "/packing/session" && method === "POST") return identifyFirebasePacker(body.packer_barcode);
  if (path === "/packing/orders/lookup" && method === "POST") return lookupFirebaseOrder(body.lookup_value, body.packer_id);
  if (path.includes("/scan-item") && method === "POST") return scanFirebaseSku(path.split("/")[3], body.scanned_sku, body.packer_id, body.quantity);
  if (path.includes("/confirm-scan") && method === "POST") return confirmFirebasePackingScan(path.split("/")[3], body.packer_id);
  if (path === "/dispatch/final-scan" && method === "POST") return dispatchFirebaseOrder(body.tracking_or_order_id);
  if (path === "/packers" && method === "POST") return { packers: await createFirebasePacker(body) };
  if (path === "/shipping-providers" && method === "POST") return { shipping_providers: await createFirebaseProvider(body) };
  throw new Error("Firebase mode does not support this action yet.");
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function readLocalDb() {
  const saved = localStorage.getItem(LOCAL_STORE_KEY);
  if (saved) {
    const db = JSON.parse(saved);
    db.salesScans ||= [];
    db.productBarcodes ||= [];
    return db;
  }

  const createdAt = nowIso();
  const db = {
    providers: [
      { id: uid(), code: "JNT", name: "J&T Express", display_name: "J&T Express", active: 1 },
      { id: uid(), code: "LEX", name: "LEX TH", display_name: "LEX TH", active: 1 },
      { id: uid(), code: "SPX", name: "SPX Express", display_name: "SPX", active: 1 },
      { id: uid(), code: "GENERAL", name: "ขนส่งทั่วไป / รถโรงงาน", display_name: "ขนส่งทั่วไป / รถโรงงาน", active: 1 }
    ],
    packers: [
      { id: uid(), employee_code: "EMP001", barcode: "EMP001", display_name: "Packer 1", active: 1 },
      { id: uid(), employee_code: "EMP002", barcode: "EMP002", display_name: "Packer 2", active: 1 }
    ],
    orders: [],
    batches: [],
    events: [],
    productBarcodes: [],
    salesScans: [],
    created_at: createdAt
  };
  writeLocalDb(db);
  return db;
}

function writeLocalDb(db) {
  localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(db));
}

function providerByCode(db, code) {
  return db.providers.find((provider) => provider.code === code) || db.providers.find((provider) => provider.code === "GENERAL");
}

function decorateOrder(db, order) {
  const provider = db.providers.find((item) => item.id === order.shipping_provider_id);
  const packer = db.packers.find((item) => item.id === order.packed_by);
  return {
    ...order,
    shipping_provider: provider?.display_name || "ไม่ระบุขนส่ง",
    packed_by_name: packer?.display_name || null
  };
}

function orderDetail(db, id) {
  const order = db.orders.find((item) => item.id === id);
  if (!order) return null;
  return decorateOrder(db, order);
}

function findLocalOrders(db, lookup) {
  const term = String(lookup || "").trim().toLowerCase();
  return db.orders
    .filter((order) => {
      return order.tracking_id.toLowerCase() === term
        || order.order_key.toLowerCase() === term
        || String(order.customer_name || "").toLowerCase().includes(term);
    })
    .map((order) => decorateOrder(db, order));
}

function addLocalEvent(db, event) {
  db.events.unshift({
    id: uid(),
    order_id: event.order_id || null,
    order_item_id: event.order_item_id || null,
    packer_id: event.packer_id || null,
    scan_type: event.scan_type,
    scanned_value: event.scanned_value,
    result: event.result,
    message: event.message || null,
    created_at: nowIso()
  });
}

function sameSku(left, right) {
  return String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase();
}

function rememberLocalProductBarcode(db, barcode, item) {
  const normalizedBarcode = String(barcode || "").trim();
  if (!normalizedBarcode || sameSku(normalizedBarcode, item.sku)) return false;

  const now = nowIso();
  const existing = db.productBarcodes.find((mapping) => mapping.barcode === normalizedBarcode);
  if (existing) {
    existing.product_name = item.product_name || existing.product_name || null;
    existing.updated_at = now;
    existing.last_seen_at = now;
    existing.scan_count = Number(existing.scan_count || 0) + 1;
    return true;
  }

  db.productBarcodes.push({
    barcode: normalizedBarcode,
    sku: item.sku,
    product_name: item.product_name || null,
    created_at: now,
    updated_at: now,
    last_seen_at: now,
    scan_count: 1
  });
  return true;
}

function resolveLocalScannedOrderItem(db, order, scannedSku) {
  const directItem = order.items.find((candidate) => sameSku(candidate.sku, scannedSku));
  if (directItem) return { item: directItem, mappedBarcode: false };

  const barcode = String(scannedSku || "").trim();
  if (!barcode) {
    return { error: "Scanned SKU is required." };
  }

  const savedMapping = db.productBarcodes.find((mapping) => mapping.barcode === barcode);
  if (savedMapping) {
    const mappedItem = order.items.find((candidate) => sameSku(candidate.sku, savedMapping.sku));
    if (mappedItem) {
      rememberLocalProductBarcode(db, barcode, mappedItem);
      return { item: mappedItem, mappedBarcode: true };
    }
    return { error: "Barcode is linked to a SKU that is not in this order." };
  }

  const remainingItems = order.items.filter((candidate) => candidate.quantity_scanned < candidate.quantity_required);
  const candidates = remainingItems.length ? remainingItems : order.items;
  if (candidates.length === 1) {
    rememberLocalProductBarcode(db, barcode, candidates[0]);
    return { item: candidates[0], mappedBarcode: true, newMapping: true };
  }

  return { error: "Barcode is not linked to a SKU yet." };
}

function resetLocalDemo() {
  localStorage.removeItem(LOCAL_STORE_KEY);
  const db = readLocalDb();
  const rows = [
    { channel: "shopee", order_key: "SHP-1001", tracking_id: "SPX-TRACK-1001", customer_name: "คุณเอ", shipping_provider_code: "SPX", items: [{ sku: "COF-DRIP-001", product_name: "Drip Coffee", quantity_required: 2 }] },
    { channel: "lazada", order_key: "LAZ-2001", tracking_id: "LEX-TRACK-2001", customer_name: "คุณบี", shipping_provider_code: "LEX", items: [{ sku: "COF-BEAN-250G", product_name: "Coffee Beans 250g", quantity_required: 1 }] },
    { channel: "reservation", order_key: "RSV-3001", tracking_id: "RSV-3001", customer_name: "คุณซี", shipping_provider_code: "GENERAL", items: [{ sku: "COF-GIFT-SET", product_name: "Gift Set", quantity_required: 1 }] }
  ];

  for (const row of rows) {
    createLocalOrder(db, row);
  }

  db.batches.unshift({
    id: uid(),
    source: "local-demo",
    channel: "mixed",
    file_name: "local-demo",
    total_rows: rows.length,
    created_count: rows.length,
    ignored_count: 0,
    overwritten_count: 0,
    error_count: 0,
    status: "completed",
    created_at: nowIso(),
    completed_at: nowIso()
  });
  writeLocalDb(db);
  return { ok: true, batches: db.batches.slice(0, 1), demo_scans: ["EMP001", "SPX-TRACK-1001", "COF-DRIP-001", "COF-DRIP-001"] };
}

function createLocalOrder(db, payload) {
  const orderKey = String(payload.order_key || "").trim();
  const trackingId = String(payload.tracking_id || orderKey).trim();
  if (!orderKey || !trackingId) throw new Error("Order key and tracking id are required.");
  if (db.orders.some((order) => order.tracking_id === trackingId || (order.channel === payload.channel && order.order_key === orderKey))) {
    throw new Error("Order or tracking already exists.");
  }

  const provider = providerByCode(db, String(payload.shipping_provider_code || "GENERAL").toUpperCase());
  const createdAt = nowIso();
  const order = {
    id: uid(),
    channel: payload.channel || "reservation",
    order_key: orderKey,
    order_item_id: null,
    tracking_id: trackingId,
    customer_name: payload.customer_name || null,
    shipping_provider_id: provider?.id || null,
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
    items: (payload.items || []).filter((item) => item.sku).map((item) => ({
      id: uid(),
      sku: String(item.sku).trim(),
      product_name: item.product_name || null,
      quantity_required: Number(item.quantity_required || 1),
      quantity_scanned: 0,
      status: "pending",
      created_at: createdAt,
      updated_at: createdAt
    }))
  };

  if (order.items.length === 0) throw new Error("At least one valid SKU item is required.");
  db.orders.unshift(order);
  return decorateOrder(db, order);
}

async function localApi(path, options = {}) {
  const db = readLocalDb();
  const method = options.method || "GET";
  const body = options.body && !(options.body instanceof FormData) ? JSON.parse(options.body) : {};

  if (path === "/health") return { ok: true, service: "hillkoff-packing-local" };
  if (path === "/reference/packers") return { packers: db.packers };
  if (path === "/reference/shipping-providers") return { shipping_providers: db.providers };
  if (path === "/demo/reset" && method === "POST") return resetLocalDemo();

  if (path === "/dashboard/summary") {
    const today = nowIso().slice(0, 10);
    const active = db.orders.filter((order) => ["Ready to Pack", "Packing In Progress", "Scan Completed", "Verified", "Packed"].includes(order.status));
    const byProvider = Object.values(active.reduce((acc, order) => {
      const provider = decorateOrder(db, order).shipping_provider;
      acc[provider] = acc[provider] || { shipping_provider: provider, count: 0 };
      acc[provider].count += 1;
      return acc;
    }, {}));
    return {
      totals: {
        ready: db.orders.filter((order) => order.status === "Ready to Pack").length,
        in_progress: db.orders.filter((order) => order.status === "Packing In Progress").length,
        packed_today: db.orders.filter((order) => String(order.packed_at || "").startsWith(today)).length,
        shipped_today: db.orders.filter((order) => String(order.shipped_at || "").startsWith(today)).length,
        error_scans_today: db.events.filter((event) => event.result === "error" && event.created_at.startsWith(today)).length
      },
      by_status: Object.values(db.orders.reduce((acc, order) => {
        acc[order.status] = acc[order.status] || { status: order.status, count: 0 };
        acc[order.status].count += 1;
        return acc;
      }, {})),
      by_provider: byProvider
    };
  }

  if (path === "/orders/ready") {
    return {
      orders: db.orders
        .filter((order) => ["Ready to Pack", "Packing In Progress", "Scan Completed", "Verified", "Packed"].includes(order.status))
        .map((order) => decorateOrder(db, order))
    };
  }

  if (path.startsWith("/orders?")) {
    const params = new URLSearchParams(path.split("?")[1]);
    const q = String(params.get("q") || "").toLowerCase();
    const status = params.get("status") || "";
    const channel = params.get("channel") || "";
    return {
      orders: db.orders
        .filter((order) => !status || order.status === status)
        .filter((order) => !channel || order.channel === channel)
        .filter((order) => !q || order.tracking_id.toLowerCase().includes(q) || order.order_key.toLowerCase().includes(q) || String(order.customer_name || "").toLowerCase().includes(q))
        .map((order) => decorateOrder(db, order))
    };
  }

  if (path === "/orders" && method === "POST") {
    const created = createLocalOrder(db, body);
    writeLocalDb(db);
    return orderDetail(db, created.id);
  }

  if (path.startsWith("/orders/") && method === "GET") {
    const id = path.split("/")[2];
    const detail = orderDetail(db, id);
    if (!detail) throw new Error("Order not found.");
    return detail;
  }

  if (path === "/imports/batches") return { batches: db.batches };
  if (path === "/scan-events") {
    return {
      events: db.events.map((event) => {
        const order = db.orders.find((item) => item.id === event.order_id);
        const packer = db.packers.find((item) => item.id === event.packer_id);
        return { ...event, order_key: order?.order_key, tracking_id: order?.tracking_id, packer_name: packer?.display_name };
      })
    };
  }

  if (path.startsWith("/sales/dispatch-scans") && method === "GET") {
    const params = new URLSearchParams(path.split("?")[1] || "");
    const dateKey = params.get("date") || "";
    const monthKey = params.get("month") || "";
    return {
      scans: db.salesScans
        .filter((scan) => (monthKey ? String(scan.date_key || "").startsWith(monthKey) : scan.date_key === (dateKey || todayKey())))
        .sort((left, right) => String(right.scanned_at || "").localeCompare(String(left.scanned_at || "")))
    };
  }

  if (path === "/sales/dispatch-scans" && method === "POST") {
    const order = findLocalOrders(db, body.tracking_or_order_id)[0];
    if (!order) {
      addLocalEvent(db, { scan_type: "sales_ready_scan", scanned_value: body.tracking_or_order_id, result: "error", message: "Order not found" });
      writeLocalDb(db);
      throw new Error("Order not found.");
    }
    const dateKey = todayKey();
    const id = `${dateKey}_${order.id}`;
    const existing = db.salesScans.find((scan) => scan.id === id);
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
      scanned_value: body.tracking_or_order_id,
      scan_count: existing ? Number(existing.scan_count || 1) + 1 : 1,
      scanned_at: scannedAt,
      created_at: existing?.created_at || scannedAt,
      updated_at: scannedAt
    };
    if (existing) Object.assign(existing, record);
    else db.salesScans.unshift(record);
    addLocalEvent(db, { order_id: order.id, scan_type: "sales_ready_scan", scanned_value: body.tracking_or_order_id, result: "success", message: order.channel || "reservation" });
    writeLocalDb(db);
    return { scan: record };
  }

  if (path === "/packing/session" && method === "POST") {
    const packer = db.packers.find((item) => item.barcode === body.packer_barcode);
    if (!packer) throw new Error("Packer barcode not found.");
    addLocalEvent(db, { packer_id: packer.id, scan_type: "packer", scanned_value: body.packer_barcode, result: "success", message: "Packer identified" });
    writeLocalDb(db);
    return { packer_id: packer.id, display_name: packer.display_name };
  }

  if (path === "/packing/orders/lookup" && method === "POST") {
    const order = findLocalOrders(db, body.lookup_value)[0];
    if (!order) {
      addLocalEvent(db, { packer_id: body.packer_id, scan_type: "order_lookup", scanned_value: body.lookup_value, result: "error", message: "Order not found" });
      writeLocalDb(db);
      throw new Error("Order not found.");
    }
    const rawOrder = db.orders.find((item) => item.id === order.id);
    rawOrder.status = rawOrder.status === "Ready to Pack" ? "Packing In Progress" : rawOrder.status;
    rawOrder.packed_by = rawOrder.packed_by || body.packer_id || null;
    rawOrder.packing_started_at = rawOrder.packing_started_at || nowIso();
    rawOrder.updated_at = nowIso();
    addLocalEvent(db, { order_id: rawOrder.id, packer_id: body.packer_id, scan_type: "order_lookup", scanned_value: body.lookup_value, result: "success", message: "Order loaded" });
    writeLocalDb(db);
    return orderDetail(db, rawOrder.id);
  }

  if (path.includes("/scan-item") && method === "POST") {
    const orderId = path.split("/")[3];
    const order = db.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("Order not found.");
    const scannedSku = String(body.scanned_sku || "").trim();
    const scanQuantity = Number(body.quantity || 1);
    if (!Number.isInteger(scanQuantity) || scanQuantity < 1) {
      throw new Error("Scan quantity must be at least 1.");
    }
    const resolved = resolveLocalScannedOrderItem(db, order, scannedSku);
    if (resolved.error) {
      addLocalEvent(db, { order_id: order.id, packer_id: body.packer_id, scan_type: "item_verify", scanned_value: scannedSku, result: "error", message: resolved.error });
      writeLocalDb(db);
      throw new Error(resolved.error);
    }
    const item = resolved.item;
    if (item.quantity_scanned >= item.quantity_required) {
      addLocalEvent(db, { order_id: order.id, order_item_id: item.id, packer_id: body.packer_id, scan_type: "item_verify", scanned_value: scannedSku, result: "error", message: "Quantity already completed" });
      writeLocalDb(db);
      throw new Error("Quantity already completed.");
    }
    if (scanQuantity > item.quantity_required - item.quantity_scanned) {
      addLocalEvent(db, { order_id: order.id, order_item_id: item.id, packer_id: body.packer_id, scan_type: "item_verify", scanned_value: scannedSku, result: "error", message: "Scan quantity exceeds remaining quantity" });
      writeLocalDb(db);
      throw new Error("Scan quantity exceeds remaining quantity.");
    }
    item.quantity_scanned += scanQuantity;
    item.status = item.quantity_scanned >= item.quantity_required ? "verified" : "partial";
    item.updated_at = nowIso();
    order.status = order.items.every((candidate) => candidate.status === "verified") ? "Scan Completed" : "Packing In Progress";
    order.packed_by = order.packed_by || body.packer_id || null;
    order.updated_at = nowIso();
    addLocalEvent(db, { order_id: order.id, order_item_id: item.id, packer_id: body.packer_id, scan_type: "item_verify", scanned_value: scannedSku, result: "success", message: `+${scanQuantity} => ${item.quantity_scanned}/${item.quantity_required}` });
    writeLocalDb(db);
    return {
      result: "success",
      sku: item.sku,
      scanned_sku: scannedSku,
      product_name: item.product_name,
      mapped_barcode: !!resolved.mappedBarcode,
      new_barcode_mapping: !!resolved.newMapping,
      quantity_added: scanQuantity,
      quantity_scanned: item.quantity_scanned,
      quantity_required: item.quantity_required,
      item_status: item.status,
      order_status: order.status,
      order: orderDetail(db, order.id)
    };
  }

  if (path.includes("/confirm-scan") && method === "POST") {
    const orderId = path.split("/")[3];
    const order = db.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("Order not found.");
    if (order.items.some((item) => item.quantity_scanned < item.quantity_required)) {
      throw new Error("Order scan is not complete.");
    }
    order.status = "Packed";
    order.packed_by = order.packed_by || body.packer_id || null;
    order.packed_at = order.packed_at || nowIso();
    order.updated_at = nowIso();
    addLocalEvent(db, { order_id: order.id, packer_id: body.packer_id, scan_type: "packing_confirm", scanned_value: order.tracking_id, result: "success", message: "Packing scan confirmed" });
    writeLocalDb(db);
    return { result: "success", order_status: order.status, order: orderDetail(db, order.id) };
  }

  if (path === "/dispatch/final-scan" && method === "POST") {
    const order = findLocalOrders(db, body.tracking_or_order_id)[0];
    if (!order) throw new Error("Order not found.");
    const rawOrder = db.orders.find((item) => item.id === order.id);
    if (!["Packed", "Verified", "Shipped / Handed Over"].includes(rawOrder.status)) throw new Error("Order must be packed before dispatch.");
    rawOrder.status = "Shipped / Handed Over";
    rawOrder.shipped_at = rawOrder.shipped_at || nowIso();
    rawOrder.updated_at = nowIso();
    const provider = decorateOrder(db, rawOrder).shipping_provider;
    addLocalEvent(db, { order_id: rawOrder.id, scan_type: "final_dispatch", scanned_value: body.tracking_or_order_id, result: "success", message: provider });
    writeLocalDb(db);
    return { order_id: rawOrder.id, status: rawOrder.status, shipping_provider: { display_name: provider }, shipped_at: rawOrder.shipped_at };
  }

  if (path === "/packers" && method === "POST") {
    db.packers.push({ id: uid(), employee_code: body.employee_code, barcode: body.barcode || body.employee_code, display_name: body.display_name, active: 1 });
    writeLocalDb(db);
    return { packers: db.packers };
  }

  if (path === "/shipping-providers" && method === "POST") {
    db.providers.push({ id: uid(), code: String(body.code).toUpperCase(), name: body.name, display_name: body.display_name || body.name, active: 1 });
    writeLocalDb(db);
    return { shipping_providers: db.providers };
  }

  throw new Error("Local mode does not support this action yet.");
}

function playErrorSound() {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 220;
  gain.gain.value = 0.08;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function todayKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(value = todayKey()) {
  return String(value || todayKey()).slice(0, 7);
}

function shiftDateKey(value, days) {
  const [year, month, day] = String(value || todayKey()).split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function daysInMonth(monthValue) {
  const safeMonth = /^\d{4}-\d{2}$/.test(String(monthValue || "")) ? monthValue : monthKey();
  const [year, month] = String(safeMonth).split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportRecordsAsExcel(records, fileName) {
  if (!records.length) return;
  const headers = Object.keys(records[0]);
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
  const table = [
    "<table><thead><tr>",
    headers.map((header) => `<th>${escapeHtml(header)}</th>`).join(""),
    "</tr></thead><tbody>",
    records.map((record) => `<tr>${headers.map((header) => `<td>${escapeHtml(record[header])}</td>`).join("")}</tr>`).join(""),
    "</tbody></table>"
  ].join("");
  const html = `\uFEFF<html><head><meta charset="utf-8" /></head><body>${table}</body></html>`;
  downloadBlob(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }), fileName);
}

function StatusBadge({ status }) {
  const key = String(status || "").toLowerCase().replaceAll(" ", "-").replaceAll("/", "");
  return <span className={`badge ${key}`}>{statusLabel(status)}</span>;
}

function PageTitle({ icon: Icon, title, subtitle, action }) {
  const displayTitle = TITLE_LABELS[title] || title;
  const displaySubtitle = SUBTITLE_LABELS[title] || (hasBrokenThai(subtitle) ? "" : subtitle);
  return (
    <div className="pageTitle">
      <div>
        <div className="titleLine">
          <Icon size={24} />
          <h2>{displayTitle}</h2>
        </div>
        <p>{displaySubtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Alert({ type = "success", children }) {
  const Icon = type === "error" ? AlertTriangle : CheckCircle2;
  return <div className={`notice ${type}`}><Icon size={18} />{typeof children === "string" ? translateMessage(children) : children}</div>;
}

function ScannerField({
  label,
  value,
  onChange,
  inputRef,
  placeholder,
  disabled,
  onSubmit,
  buttonLabel = "สแกน"
}) {
  function focusScanner() {
    inputRef?.current?.focus();
    inputRef?.current?.select?.();
  }

  return (
    <div className="scannerField">
      <label>{label}
        <input
          ref={inputRef}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && onSubmit) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      </label>
      <button type="button" className="scanModeButton" disabled={disabled} onClick={focusScanner}>
        <Barcode size={18} />
        {buttonLabel}
      </button>
    </div>
  );
}

function CameraScanner({ title, profile = "mixed", onResult, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const controlsRef = useRef(null);

  useEffect(() => {
    let controls;
    let active = true;
    const reader = createScannerReader(profile);

    async function start() {
      try {
        const handleResult = (result) => {
          if (!active || !result) return;
          active = false;
          onResult(result.getText());
          controls?.stop();
          onClose();
        };
        try {
          controls = await reader.decodeFromConstraints(CAMERA_SCAN_CONSTRAINTS, videoRef.current, handleResult);
        } catch (constraintError) {
          console.warn("High resolution camera constraints failed, retrying with fallback.", constraintError);
          controls = await reader.decodeFromConstraints(CAMERA_SCAN_FALLBACK_CONSTRAINTS, videoRef.current, handleResult);
        }
        controlsRef.current = controls;
        setTorchAvailable(typeof controls.switchTorch === "function");
        await optimizeCameraTrack(controls);
      } catch (err) {
        setError(err.message || "Cannot open camera.");
      }
    }

    start();
    return () => {
      active = false;
      controls?.stop();
      controlsRef.current = null;
    };
  }, [onClose, onResult, profile]);

  async function toggleTorch() {
    if (!controlsRef.current?.switchTorch) return;
    try {
      const next = !torchOn;
      await controlsRef.current.switchTorch(next);
      setTorchOn(next);
    } catch (err) {
      setError(err.message || "Cannot toggle torch on this camera.");
    }
  }

  return (
    <div className="cameraOverlay">
      <div className="cameraModal">
        <div className="cameraHeader">
          <div>
            <strong>{title}</strong>
            <span>{profile === "product" ? "Center the product barcode in the yellow box. The camera will prefer close focus and mild zoom." : "Point the camera at a barcode or QR Code."}</span>
          </div>
          <div className="cameraActions">
            {torchAvailable && (
              <button type="button" className="secondary" onClick={toggleTorch}>
                {torchOn ? "Light off" : "Light on"}
              </button>
            )}
            <button type="button" className="secondary" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="cameraFrame">
          <video ref={videoRef} muted playsInline />
          <div className={`scanGuide ${profile === "product" ? "product" : ""}`} />
        </div>
        {profile === "product" && (
          <div className="cameraTip">
            Hold about 10-20 cm away. If it is slow, turn on the light or fill the guide with the barcode.
          </div>
        )}
        {error && <Alert type="error">{error}</Alert>}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className={`metric ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
    </div>
  );
}

function DashboardPage({ summary, readyOrders, onDemoReset, busy }) {
  return (
    <div className="pageStack">
      <PageTitle
        icon={LayoutDashboard}
        title="Operations Dashboard"
        subtitle="ภาพรวมงานนำเข้า แพ็ค และจัดส่งแบบ real time"
        action={<button className="primary" disabled={busy} onClick={onDemoReset}><Archive size={18} />โหลดข้อมูลตัวอย่าง</button>}
      />

      <div className="metricsGrid">
        <Metric label="รอแพ็ค" value={summary?.totals?.ready} />
        <Metric label="กำลังแพ็ค" value={summary?.totals?.in_progress} tone="warn" />
        <Metric label="แพ็คเสร็จวันนี้" value={summary?.totals?.packed_today} tone="ok" />
        <Metric label="ส่งออกวันนี้" value={summary?.totals?.shipped_today} tone="ok" />
        <Metric label="สแกนผิดวันนี้" value={summary?.totals?.error_scans_today} tone="danger" />
      </div>

      <div className="contentGrid two">
        <section className="panel">
          <div className="panelHeader"><Truck size={20} /><h3>คิวแยกตามขนส่ง</h3></div>
          <div className="routeList">
            {(summary?.by_provider || []).map((row) => (
              <div className="routeRow" key={row.shipping_provider}>
                <span>{row.shipping_provider}</span>
                <strong>{row.count}</strong>
              </div>
            ))}
            {(!summary?.by_provider || summary.by_provider.length === 0) && <EmptyState label="ยังไม่มีคิวขนส่ง" />}
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader"><Boxes size={20} /><h3>ออเดอร์ที่รอทำงาน</h3></div>
          <div className="compactOrders">
            {readyOrders.slice(0, 8).map((order) => (
              <div className="compactOrder" key={order.id}>
                <div>
                  <strong>{order.tracking_id}</strong>
                  <span>{order.customer_name || order.order_key}</span>
                </div>
                <StatusBadge status={order.status} />
              </div>
            ))}
            {readyOrders.length === 0 && <EmptyState label="ยังไม่มีออเดอร์พร้อมทำงาน" />}
          </div>
        </section>
      </div>
    </div>
  );
}

function ImportPage({ onRefresh }) {
  const [detectedChannel, setDetectedChannel] = useState("");
  const [dedupe, setDedupe] = useState("ignore");
  const [file, setFile] = useState(null);
  const [convertedFile, setConvertedFile] = useState(null);
  const [convertedRows, setConvertedRows] = useState([]);
  const [convertError, setConvertError] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const [batches, setBatches] = useState([]);
  const previewColumns = useMemo(() => {
    const columns = [...convertedRows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())];
    return columns.slice(0, 8);
  }, [convertedRows]);

  async function loadBatches() {
    const data = await api("/imports/batches");
    setBatches(data.batches);
  }

  useEffect(() => {
    loadBatches().catch(() => setBatches([]));
  }, []);

  function selectFile(nextFile) {
    setFile(nextFile);
    setConvertedFile(null);
    setConvertedRows([]);
    setDetectedChannel("");
    setConvertError("");
    setResult(null);
    setError("");
  }

  async function convertSelectedFile() {
    if (!file) {
      setConvertError("กรุณาเลือกไฟล์ก่อนแปลง");
      return;
    }

    setConverting(true);
    setConvertError("");
    setError("");
    try {
      const parsed = await parseImportFileAuto(file);
      const rows = parsed.rows;
      const csv = recordsToCsv(rows);
      const csvName = file.name.replace(/\.[^.]+$/, "") || "orders";
      const nextFile = new File([csv], `${csvName}.csv`, { type: "text/csv;charset=utf-8" });
      setConvertedFile(nextFile);
      setConvertedRows(rows);
      setDetectedChannel(parsed.channel);
    } catch (err) {
      setConvertedFile(null);
      setConvertedRows([]);
      setDetectedChannel("");
      setConvertError(err.message);
    } finally {
      setConverting(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const importFile = convertedFile || file;
    if (!importFile) {
      setError("กรุณาเลือกไฟล์ CSV หรือ XLSX ก่อนนำเข้า");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", importFile);
      form.append("channel", detectedChannel || "auto");
      form.append("deduplication_action", dedupe);
      const data = await api("/imports/orders", { method: "POST", body: form });
      setResult(data);
      await Promise.all([loadBatches(), onRefresh()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pageStack">
      <PageTitle icon={Upload} title="Import Orders" subtitle="นำเข้าไฟล์จาก marketplace และใบสั่งจอง พร้อมตรวจออเดอร์ซ้ำ" />
      <div className="contentGrid two">
        <section className="panel">
          <div className="panelHeader"><Upload size={20} /><h3>เลือกไฟล์และแปลงข้อมูล</h3></div>
          <form className="formGrid" onSubmit={submit}>
            <div className="fieldNote">
              <strong>ตรวจช่องทางอัตโนมัติ</strong>
              <span>{detectedChannel ? `ระบบตรวจพบ: ${channelLabel(detectedChannel)}` : "ระบบจะอ่านหัวตารางแล้วเลือก Shopee, Lazada หรือ TikTok ให้เอง"}</span>
            </div>
            <label>เมื่อเจอออเดอร์ซ้ำ
              <select value={dedupe} onChange={(event) => setDedupe(event.target.value)}>
                <option value="ignore">ข้ามรายการซ้ำ</option>
                <option value="overwrite">เขียนทับรายการเดิม</option>
              </select>
            </label>
            <label className="wide">ไฟล์ออเดอร์
              <input type="file" accept=".csv,.xlsx,.xls,.xps,.oxps" onChange={(event) => selectFile(event.target.files?.[0] || null)} />
            </label>
            <div className="wide converterBox">
              <div>
                <strong>แปลงไฟล์เป็น CSV ก่อนนำเข้า</strong>
                <span>{convertedFile ? `${convertedFile.name} พร้อมนำเข้า (${convertedRows.length} แถว)` : "ระบบจะแปลง Excel/XPS เป็น CSV แล้วแสดงตัวอย่างก่อนนำเข้า"}</span>
              </div>
              <button type="button" className="secondary" disabled={busy || converting || !file} onClick={convertSelectedFile}>
                <FileClock size={18} />{converting ? "กำลังแปลง..." : "แปลงไฟล์"}
              </button>
            </div>
            {convertError && <div className="wide"><Alert type="error">{convertError}</Alert></div>}
            {convertedRows.length > 0 && (
              <div className="wide csvPreview">
                <DataTable
                  columns={previewColumns}
                  rows={convertedRows.slice(0, 5).map((row) => previewColumns.map((column) => row[column] || ""))}
                  empty="ยังไม่มีข้อมูลที่แปลงแล้ว"
                />
              </div>
            )}
            <button className="primary" disabled={busy}><Upload size={18} />{convertedFile ? "นำเข้า CSV" : "นำเข้า"}</button>
          </form>
          {error && <Alert type="error">{error}</Alert>}
          {result && (
            <div className="resultGrid">
              <Metric label="จำนวนแถว" value={result.total_rows} />
              <Metric label="สร้างใหม่" value={result.created_count} tone="ok" />
              <Metric label="ข้ามซ้ำ" value={result.ignored_count} />
              <Metric label="เขียนทับ" value={result.overwritten_count} tone="warn" />
              <Metric label="ผิดพลาด" value={result.error_count} tone="danger" />
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panelHeader"><FileClock size={20} /><h3>ประวัติการนำเข้า</h3></div>
          <DataTable
            columns={["ไฟล์", "ช่องทาง", "แถว", "สร้างใหม่", "ข้ามซ้ำ", "เขียนทับ", "สถานะ"]}
            rows={batches.map((batch) => [
              batch.file_name,
              channelLabel(batch.channel),
              batch.total_rows,
              batch.created_count,
              batch.ignored_count,
              batch.overwritten_count,
              statusLabel(batch.status)
            ])}
            empty="ยังไม่มีประวัติการนำเข้า"
          />
        </section>
      </div>
    </div>
  );
}

function NewOrderPage({ onRefresh, onGoPacking }) {
  const emptyItem = { sku: "", product_name: "", quantity_required: 1 };
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({
    channel: "reservation",
    order_key: "",
    tracking_id: "",
    customer_name: "",
    shipping_provider_code: "GENERAL",
    items: [{ ...emptyItem }]
  });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  const [cameraTarget, setCameraTarget] = useState(null);
  const orderInputRef = useRef(null);
  const trackingInputRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    api("/reference/shipping-providers")
      .then((data) => setProviders(data.shipping_providers))
      .catch(() => setProviders([]));
    orderInputRef.current?.focus();
  }, []);

  function updateItem(index, patch) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    }));
  }

  function addItem() {
    setForm((current) => ({ ...current, items: [...current.items, { ...emptyItem }] }));
  }

  function removeItem(index) {
    setForm((current) => ({
      ...current,
      items: current.items.length === 1 ? current.items : current.items.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setCreated(null);
    try {
      const payload = {
        ...form,
        tracking_id: form.tracking_id || form.order_key,
        items: form.items.map((item) => ({
          ...item,
          quantity_required: Number(item.quantity_required || 1)
        }))
      };
      const data = await api("/orders", { method: "POST", body: JSON.stringify(payload) });
      setCreated(data);
      setForm({
        channel: "reservation",
        order_key: "",
        tracking_id: "",
        customer_name: "",
        shipping_provider_code: "GENERAL",
        items: [{ ...emptyItem }]
      });
      await onRefresh();
      setTimeout(() => orderInputRef.current?.focus(), 0);
    } catch (err) {
      setError(err.message);
      playErrorSound();
    }
  }

  return (
    <div className="pageStack">
      <PageTitle icon={Plus} title="New Order Entry" subtitle="กรอกออเดอร์เองได้ทันที แล้วนำ tracking ไปสแกนแพ็คต่อ" />
      <section className="panel">
        <form className="manualOrderForm" onSubmit={submit}>
          <div className="scanHelperBar">
            <span><Barcode size={18} />ปุ่มลัดสำหรับสแกน</span>
            <button type="button" className="scanModeButton" onClick={() => orderInputRef.current?.focus()}>สแกนเลขออเดอร์</button>
            <button type="button" className="scanModeButton camera" onClick={() => setCameraTarget({ title: "ใช้กล้องสแกนออเดอร์", apply: (value) => setForm((current) => ({ ...current, order_key: value })) })}><Camera size={18} />ใช้กล้องสแกนออเดอร์</button>
            <button type="button" className="scanModeButton" onClick={() => document.querySelectorAll(".formGrid input")[1]?.focus()}>สแกนใบปะหน้า</button>
            <button type="button" className="scanModeButton camera" onClick={() => setCameraTarget({ title: "ใช้กล้องสแกนใบปะหน้า", apply: (value) => setForm((current) => ({ ...current, tracking_id: value })) })}><Camera size={18} />ใช้กล้องสแกนใบปะหน้า</button>
            <button type="button" className="scanModeButton" onClick={() => document.querySelector(".manualItemRow input")?.focus()}>สแกน SKU</button>
            <button type="button" className="scanModeButton camera" onClick={() => setCameraTarget({ title: "ใช้กล้องสแกน SKU", profile: "product", apply: (value) => updateItem(0, { sku: value }) })}><Camera size={18} />ใช้กล้องสแกน SKU</button>
          </div>
          <div className="formGrid">
            <label>ช่องทางออเดอร์
              <select value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
                <option value="reservation">ใบสั่งจอง/ออเดอร์ทั่วไป</option>
                <option value="shopee">Shopee</option>
                <option value="lazada">Lazada</option>
                <option value="tiktok">TikTok</option>
              </select>
            </label>
            <label>ขนส่ง
              <select value={form.shipping_provider_code} onChange={(event) => setForm({ ...form, shipping_provider_code: event.target.value })}>
                {providers.map((provider) => <option key={provider.id} value={provider.code}>{provider.display_name}</option>)}
              </select>
            </label>
            <label>Order ID / เลขที่ใบสั่งจอง
              <input ref={orderInputRef} value={form.order_key} onChange={(event) => setForm({ ...form, order_key: event.target.value })} placeholder="เช่น RSV-5001" />
            </label>
            <label>เลขพัสดุ / Tracking
              <input value={form.tracking_id} onChange={(event) => setForm({ ...form, tracking_id: event.target.value })} placeholder="เว้นว่างได้ ระบบใช้เลขออเดอร์แทน" />
            </label>
            <label className="wide">ชื่อลูกค้า
              <input value={form.customer_name} onChange={(event) => setForm({ ...form, customer_name: event.target.value })} placeholder="ชื่อลูกค้า" />
            </label>
          </div>

          <div className="itemEntryHeader">
            <h3>รายการสินค้า</h3>
            <div className="inlineButtonGroup">
              <button type="button" className="secondary" onClick={() => document.querySelector(".manualItemRow input")?.focus()}><Barcode size={18} />สแกน SKU</button>
              <button type="button" className="secondary" onClick={addItem}><Plus size={18} />เพิ่มสินค้า</button>
            </div>
          </div>

          <div className="manualItems">
            {form.items.map((item, index) => (
              <div className="manualItemRow" key={index}>
                <label>SKU / บาร์โค้ดสินค้า
                  <input value={item.sku} onChange={(event) => updateItem(index, { sku: event.target.value })} placeholder="ยิงหรือพิมพ์ SKU" />
                </label>
                <label>ชื่อสินค้า
                  <input value={item.product_name} onChange={(event) => updateItem(index, { product_name: event.target.value })} placeholder="ชื่อสินค้า" />
                </label>
                <label>จำนวน
                  <input type="number" min="1" value={item.quantity_required} onChange={(event) => updateItem(index, { quantity_required: event.target.value })} />
                </label>
                <button type="button" className="iconButton cameraIcon" onClick={() => setCameraTarget({ title: "ใช้กล้องสแกน SKU", profile: "product", apply: (value) => updateItem(index, { sku: value }) })} aria-label="ใช้กล้องสแกน SKU"><Camera size={18} /></button>
                <button type="button" className="iconButton" onClick={() => removeItem(index)} aria-label="Remove SKU"><Trash2 size={18} /></button>
              </div>
            ))}
          </div>

          <div className="formActions">
            <button className="primary"><Plus size={18} />บันทึกออเดอร์พร้อมแพ็ค</button>
          </div>
        </form>
        {error && <Alert type="error">{error}</Alert>}
        {created && (
          <Alert>
            สร้างออเดอร์ {created.order_key} แล้ว สแกนด้วย {created.tracking_id}
            <button className="inlineAction" onClick={() => onGoPacking(created.tracking_id)}>ไปหน้า Packing</button>
          </Alert>
        )}
        {cameraTarget && (
          <CameraScanner
            title={cameraTarget.title}
            profile={cameraTarget.profile}
            onResult={(value) => cameraTarget.apply(value)}
            onClose={() => setCameraTarget(null)}
          />
        )}
      </section>
    </div>
  );
}

function PackingPage({ onRefresh, readyOrders, initialLookup }) {
  const [lookup, setLookup] = useState("");
  const [sku, setSku] = useState("");
  const [scanQuantity, setScanQuantity] = useState(1);
  const [order, setOrder] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cameraTarget, setCameraTarget] = useState(null);
  const lookupRef = useRef(null);
  const skuRef = useRef(null);

  useEffect(() => {
    lookupRef.current?.focus();
  }, []);

  useEffect(() => {
    if (initialLookup) setLookup(initialLookup);
  }, [initialLookup]);

  async function loadOrder(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const data = await api("/packing/orders/lookup", {
        method: "POST",
        body: JSON.stringify({ lookup_value: lookup, packer_id: null })
      });
      setOrder(data);
      setMessage(`โหลดออเดอร์ ${data.order_key} แล้ว`);
      setSku("");
      await onRefresh();
      setTimeout(() => skuRef.current?.focus(), 0);
    } catch (err) {
      setError(err.message);
      playErrorSound();
    }
  }

  async function submitSku(scannedValue = sku) {
    const nextSku = String(scannedValue || "").trim();
    if (!order || !nextSku) return;
    setError("");
    setMessage("");
    try {
      const data = await api(`/packing/orders/${order.id}/scan-item`, {
        method: "POST",
        body: JSON.stringify({ scanned_sku: nextSku, quantity: scanQuantity, packer_id: null })
      });
      setOrder(data.order);
      setMessage(`Scanned ${data.sku}: +${data.quantity_added || scanQuantity} => ${data.quantity_scanned}/${data.quantity_required}${data.new_barcode_mapping ? " (barcode linked)" : ""}`);
      setSku("");
      setScanQuantity(1);
      await onRefresh();
      setTimeout(() => skuRef.current?.focus(), 0);
    } catch (err) {
      setError(err.message);
      setSku("");
      playErrorSound();
      setTimeout(() => skuRef.current?.focus(), 0);
    }
  }

  async function scanSku(event) {
    event.preventDefault();
    await submitSku();
  }

  async function confirmScanComplete() {
    if (!order) return;
    setError("");
    setMessage("");
    try {
      const data = await api(`/packing/orders/${order.id}/confirm-scan`, {
        method: "POST",
        body: JSON.stringify({ packer_id: null })
      });
      setOrder(data.order);
      setMessage(`ยืนยันสแกนเสร็จแล้ว: ${data.order.order_key}`);
      await onRefresh();
    } catch (err) {
      setError(err.message);
      playErrorSound();
    }
  }

  const progress = useMemo(() => {
    if (!order?.items?.length) return 0;
    const required = order.items.reduce((sum, item) => sum + item.quantity_required, 0);
    const scanned = order.items.reduce((sum, item) => sum + item.quantity_scanned, 0);
    return Math.round((scanned / required) * 100);
  }, [order]);

  const scanComplete = order?.items?.length && order.items.every((item) => item.quantity_scanned >= item.quantity_required);
  const waitingConfirm = order?.status === "Scan Completed";

  return (
    <div className="pageStack">
      <PageTitle icon={PackageCheck} title="Packing Station" subtitle="สแกนใบปะหน้า ดึงออเดอร์ และตรวจ SKU ทีละชิ้น" />
      <div className="contentGrid stationGrid">
        <section className="panel stationPanel">
          <div className="panelHeader"><PackageCheck size={20} /><h3>สแกนใบปะหน้าและแพ็คสินค้า</h3></div>
          <div className="scanHelperBar">
            <span><Barcode size={18} />ลำดับงานแพ็ค</span>
            <button type="button" className="scanModeButton" onClick={() => lookupRef.current?.focus()}>1. สแกนใบปะหน้า</button>
            <button type="button" className="scanModeButton camera" onClick={() => setCameraTarget({ title: "ใช้กล้องสแกนใบปะหน้า", apply: setLookup })}><Camera size={18} />กล้องใบปะหน้า</button>
            <button type="button" className="scanModeButton" disabled={!order} onClick={() => skuRef.current?.focus()}>2. สแกน SKU</button>
            <button type="button" className="scanModeButton camera" disabled={!order} onClick={() => setCameraTarget({ title: "ใช้กล้องสแกน SKU", profile: "product", apply: submitSku })}><Camera size={18} />กล้อง SKU</button>
          </div>

          <form className="inlineForm" onSubmit={loadOrder}>
            <label>ค้นหาออเดอร์ / เลขพัสดุ / ลูกค้า
              <input ref={lookupRef} value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="เช่น SPX-TRACK-1001" />
            </label>
            <button className="primary"><Search size={18} />โหลดออเดอร์</button>
          </form>

          {order && (
            <div className="packingWorkspace">
              <div className="orderHero">
                <div><span>ออเดอร์</span><strong>{order.order_key}</strong></div>
                <div><span>เลขพัสดุ</span><strong>{order.tracking_id}</strong></div>
                <div><span>ความคืบหน้า</span><strong>{progress}%</strong></div>
                <div><span>สถานะ</span><StatusBadge status={order.status} /></div>
              </div>
              <form className="scanForm" onSubmit={scanSku}>
                <label>สแกน SKU สินค้า
                  <input ref={skuRef} value={sku} onChange={(event) => setSku(event.target.value)} placeholder="ยิง barcode สินค้า" />
                </label>
                <label className="quantityField">จำนวน
                  <input type="number" min="1" step="1" value={scanQuantity} onChange={(event) => setScanQuantity(event.target.value)} />
                </label>
                <button className="primary"><Barcode size={18} />สแกน</button>
                <button type="button" className="scanModeButton camera" onClick={() => setCameraTarget({ title: "ใช้กล้องสแกน SKU", profile: "product", apply: submitSku })}><Camera size={18} />แสกนกล้อง SKU</button>
              </form>
              <div className="itemList">
                {order.items.map((item) => (
                  <div className={`itemRow ${item.status}`} key={item.id}>
                    <div>
                      <strong>{item.sku}</strong>
                      <span>{item.product_name || "ไม่มีชื่อสินค้า"}</span>
                    </div>
                    <b>{item.quantity_scanned}/{item.quantity_required}</b>
                    {item.status === "verified" && <CheckCircle2 size={24} />}
                  </div>
                ))}
              </div>
              {scanComplete && (
                <div className="confirmScanBar">
                  <div>
                    <strong>{waitingConfirm ? "สแกนเสร็จแล้ว" : "สแกนครบแล้ว"}</strong>
                    <span>{waitingConfirm ? "รอกดยืนยันเพื่อเปลี่ยนเป็นแพ็คเสร็จ" : statusLabel(order.status)}</span>
                  </div>
                  <button type="button" className="primary" disabled={!waitingConfirm} onClick={confirmScanComplete}>
                    <CheckCircle2 size={18} />ยืนยันสแกนเสร็จ
                  </button>
                </div>
              )}
            </div>
          )}

          {message && <Alert>{message}</Alert>}
          {error && <Alert type="error">{error}</Alert>}
          {cameraTarget && (
            <CameraScanner
              title={cameraTarget.title}
              profile={cameraTarget.profile}
              onResult={(value) => cameraTarget.apply(value)}
              onClose={() => setCameraTarget(null)}
            />
          )}
        </section>

        <section className="panel sideQueue">
          <div className="panelHeader"><ClipboardList size={20} /><h3>คิวรอแพ็ค</h3></div>
          <div className="queueList">
            {readyOrders.slice(0, 12).map((item) => (
              <button className="queueItem" key={item.id} onClick={() => setLookup(item.tracking_id)}>
                <strong>{item.tracking_id}</strong>
                <span>{item.shipping_provider || "ไม่ระบุขนส่ง"}</span>
                <StatusBadge status={item.status} />
              </button>
            ))}
            {readyOrders.length === 0 && <EmptyState label="ไม่มีคิวรอแพ็ค" />}
          </div>
        </section>
      </div>
    </div>
  );
}

function DispatchPage({ onRefresh }) {
  const [lookup, setLookup] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function dispatch(event) {
    event.preventDefault();
    setError("");
    setResult(null);
    try {
      const data = await api("/dispatch/final-scan", {
        method: "POST",
        body: JSON.stringify({ tracking_or_order_id: lookup })
      });
      setResult(data);
      setLookup("");
      await onRefresh();
    } catch (err) {
      setError(err.message);
      playErrorSound();
    }
  }

  return (
    <div className="pageStack">
      <PageTitle icon={Send} title="Final Sorting & Dispatch" subtitle="สแกนกล่องที่ปิดแล้วเพื่อยืนยันพร้อมส่ง และแสดงโซนขนส่ง" />
      <section className="dispatchStage">
        <div className="scanHelperBar dark">
          <span><Barcode size={18} />พร้อมรับเครื่องสแกนบาร์โค้ด</span>
          <button type="button" className="scanModeButton" onClick={() => inputRef.current?.focus()}>สแกนใบปะหน้ารอบสุดท้าย</button>
          <button type="button" className="scanModeButton camera" onClick={() => setCameraOpen(true)}><Camera size={18} />ใช้กล้องสแกน</button>
        </div>
        <form className="dispatchForm" onSubmit={dispatch}>
          <label>สแกนใบปะหน้าขนส่ง
            <input ref={inputRef} value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="สแกน Tracking ID หรือ Order ID" />
          </label>
          <button className="primary"><Send size={20} />ยืนยันส่งมอบ</button>
        </form>
        {result && (
          <div className="routeDisplay">
            <span>วางที่โซน</span>
            <strong>{result.shipping_provider.display_name}</strong>
            <small>{result.status} · {formatDate(result.shipped_at)}</small>
          </div>
        )}
        {error && <Alert type="error">{error}</Alert>}
        {cameraOpen && (
          <CameraScanner
            title="ใช้กล้องสแกนใบปะหน้า"
            onResult={setLookup}
            onClose={() => setCameraOpen(false)}
          />
        )}
      </section>
    </div>
  );
}

function DailyDispatchChart({ days, max }) {
  return (
    <div className="dailyDispatchChart" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(20px, 1fr))` }}>
      {days.map((day) => (
        <div className="dayBar" key={day.date}>
          <span>{day.label}</span>
          <div className="dayBarTrack" title={`${day.date}: ${day.count}`}>
            <div className="dayBarFill" style={{ height: day.count ? `${Math.max(4, (day.count / max) * 100)}%` : 0 }} />
          </div>
          <strong>{day.count}</strong>
        </div>
      ))}
    </div>
  );
}

function DispatchChannelChart({ items, total }) {
  return (
    <div className="channelChart">
      {items.map((item) => (
        <div className="channelBarRow" key={item.channel}>
          <div className="channelBarMeta">
            <span>{channelLabel(item.channel)}</span>
            <strong>{item.count}</strong>
          </div>
          <div className="channelBarTrack">
            <div className="channelBarFill" style={{ width: `${Math.max(4, (item.count / Math.max(total, 1)) * 100)}%` }} />
          </div>
        </div>
      ))}
      {!items.length && <p className="emptyHint">ยังไม่มีข้อมูลในเดือนนี้</p>}
    </div>
  );
}

function SalesDispatchPage() {
  const [lookup, setLookup] = useState("");
  const [date, setDate] = useState(todayKey());
  const [month, setMonth] = useState(monthKey());
  const [scans, setScans] = useState([]);
  const [monthScans, setMonthScans] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef(null);

  async function loadScans(nextDate = date) {
    const data = await api(`/sales/dispatch-scans?date=${encodeURIComponent(nextDate)}`);
    setScans(data.scans || []);
  }

  async function loadMonthScans(nextMonth = month) {
    const data = await api(`/sales/dispatch-scans?month=${encodeURIComponent(nextMonth)}`);
    setMonthScans(data.scans || []);
  }

  useEffect(() => {
    Promise.all([loadScans(), loadMonthScans()]).catch((err) => setError(err.message));
  }, []);

  const channelSummary = useMemo(() => {
    return Object.values(scans.reduce((acc, scan) => {
      const channel = scan.channel || "reservation";
      acc[channel] ||= { channel, count: 0 };
      acc[channel].count += 1;
      return acc;
    }, {})).sort((left, right) => channelLabel(left.channel).localeCompare(channelLabel(right.channel)));
  }, [scans]);

  const monthChannelSummary = useMemo(() => {
    return Object.values(monthScans.reduce((acc, scan) => {
      const channel = scan.channel || "reservation";
      acc[channel] ||= { channel, count: 0 };
      acc[channel].count += 1;
      return acc;
    }, {})).sort((left, right) => right.count - left.count);
  }, [monthScans]);

  const monthDailySummary = useMemo(() => {
    const counts = monthScans.reduce((acc, scan) => {
      const key = scan.date_key || "";
      if (!key.startsWith(month)) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Array.from({ length: daysInMonth(month) }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      const key = `${month}-${day}`;
      return { date: key, label: String(index + 1), count: counts[key] || 0 };
    });
  }, [month, monthScans]);

  const todayScanCount = useMemo(() => monthScans.filter((scan) => scan.date_key === todayKey()).length, [monthScans]);
  const activeMonthDays = useMemo(() => new Set(monthScans.map((scan) => scan.date_key).filter(Boolean)).size, [monthScans]);
  const monthAverage = activeMonthDays ? Math.round(monthScans.length / activeMonthDays) : 0;
  const selectedDuplicateCount = useMemo(() => scans.filter((scan) => Number(scan.scan_count || 1) > 1).length, [scans]);
  const maxDailyScans = Math.max(1, ...monthDailySummary.map((item) => item.count));

  const exportRows = useMemo(() => scans.map((scan) => ({
    "วันที่": scan.date_key,
    "เวลาสแกน": formatDate(scan.scanned_at),
    "แพลตฟอร์ม": channelLabel(scan.channel),
    "เลขพัสดุ": scan.tracking_id,
    "เลขออเดอร์": scan.order_key,
    "ลูกค้า": scan.customer_name || "",
    "ขนส่ง": scan.shipping_provider || "",
    "สถานะ": statusLabel(scan.status),
    "จำนวนครั้งที่สแกน": scan.scan_count || 1
  })), [scans]);

  const monthExportRows = useMemo(() => monthScans.map((scan) => ({
    "วันที่": scan.date_key,
    "เวลาสแกน": formatDate(scan.scanned_at),
    "แพลตฟอร์ม": channelLabel(scan.channel),
    "เลขพัสดุ": scan.tracking_id,
    "เลขออเดอร์": scan.order_key,
    "ลูกค้า": scan.customer_name || "",
    "ขนส่ง": scan.shipping_provider || "",
    "สถานะ": statusLabel(scan.status),
    "จำนวนครั้งที่สแกน": scan.scan_count || 1
  })), [monthScans]);

  async function scanSalesDispatch(event) {
    event.preventDefault();
    const value = lookup.trim();
    if (!value) return;
    setError("");
    setMessage("");
    try {
      const data = await api("/sales/dispatch-scans", {
        method: "POST",
        body: JSON.stringify({ tracking_or_order_id: value })
      });
      setMessage(`บันทึกแล้ว: ${channelLabel(data.scan.channel)} / ${data.scan.tracking_id}`);
      setLookup("");
      const currentDate = todayKey();
      const currentMonth = monthKey(currentDate);
      await Promise.all([loadScans(currentDate), loadMonthScans(currentMonth)]);
      setDate(currentDate);
      setMonth(currentMonth);
      inputRef.current?.focus();
    } catch (err) {
      setError(err.message);
      playErrorSound();
    }
  }

  async function changeDate(nextDate) {
    setDate(nextDate);
    const nextMonth = monthKey(nextDate);
    if (nextMonth !== month) setMonth(nextMonth);
    setError("");
    await Promise.all([
      loadScans(nextDate),
      nextMonth !== month ? loadMonthScans(nextMonth) : Promise.resolve()
    ]);
  }

  async function changeMonth(nextMonth) {
    if (!nextMonth) return;
    setMonth(nextMonth);
    setError("");
    await loadMonthScans(nextMonth);
  }

  function exportCsv() {
    if (!exportRows.length) return;
    const csv = recordsToCsv(exportRows);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `sales-dispatch-${date}.csv`);
  }

  function exportExcel() {
    exportRecordsAsExcel(exportRows, `sales-dispatch-${date}.xls`);
  }

  function exportMonthCsv() {
    if (!monthExportRows.length) return;
    const csv = recordsToCsv(monthExportRows);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `sales-dispatch-${month}.csv`);
  }

  function exportMonthExcel() {
    exportRecordsAsExcel(monthExportRows, `sales-dispatch-${month}.xls`);
  }

  return (
    <div className="pageStack">
      <PageTitle
        icon={Archive}
        title="Sales Dispatch Sheet"
        subtitle="สแกนใบปะหน้าสำหรับฝ่ายขาย แล้วส่งออกเป็นรายงานประจำวัน"
        action={<button className="secondary" onClick={() => Promise.all([loadScans(), loadMonthScans()])}><RefreshCw size={18} />รีเฟรช</button>}
      />

      <section className="salesScannerPanel">
        <div className="scanHelperBar dark">
          <span><Barcode size={18} />สแกนใบปะหน้าด้วยเครื่องสแกนหรือกล้องมือถือ</span>
          <button type="button" className="scanModeButton" onClick={() => inputRef.current?.focus()}>สแกนใบปะหน้า</button>
          <button type="button" className="scanModeButton camera" onClick={() => setCameraOpen(true)}><Camera size={18} />ใช้กล้องมือถือ</button>
        </div>
        <form className="dispatchForm" onSubmit={scanSalesDispatch}>
          <label>Tracking ID หรือ Order ID
            <input ref={inputRef} value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="ยิงบาร์โค้ดใบปะหน้าหรือพิมพ์เลข" />
          </label>
          <button className="primary"><Archive size={20} />บันทึกฝ่ายขาย</button>
        </form>
        {message && <Alert>{message}</Alert>}
        {error && <Alert type="error">{error}</Alert>}
        {cameraOpen && (
          <CameraScanner
            title="ใช้กล้องสแกนใบปะหน้า"
            onResult={setLookup}
            onClose={() => setCameraOpen(false)}
          />
        )}
      </section>

      <div className="salesSummaryGrid">
        <Metric label="วันที่เลือก" value={scans.length} />
        <Metric label="วันนี้" value={todayScanCount} tone="ok" />
        <Metric label="รวมเดือนที่เลือก" value={monthScans.length} />
        <Metric label="เฉลี่ยต่อวันที่มีสแกน" value={monthAverage} />
        <Metric label="สแกนซ้ำวันที่เลือก" value={selectedDuplicateCount} tone={selectedDuplicateCount ? "warn" : "ok"} />
        {channelSummary.map((item) => (
          <Metric key={item.channel} label={channelLabel(item.channel)} value={item.count} tone="ok" />
        ))}
      </div>

      <section className="panel">
        <div className="panelHeader">
          <LayoutDashboard size={20} />
          <h3>วิเคราะห์รายวันและรายเดือน</h3>
        </div>
        <div className="salesToolbar">
          <label>เดือน
            <input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} />
          </label>
          <div className="toolbarActions">
            <button className="secondary" disabled={!monthExportRows.length} onClick={exportMonthCsv}><FileClock size={18} />ส่งออก CSV รายเดือน</button>
            <button className="primary" disabled={!monthExportRows.length} onClick={exportMonthExcel}><Archive size={18} />ส่งออก Excel รายเดือน</button>
          </div>
        </div>
        <div className="salesInsightsGrid">
          <div className="chartPanel wide">
            <div className="chartHeader">
              <span>ยอดสแกนแต่ละวัน</span>
              <strong>{month}</strong>
            </div>
            <DailyDispatchChart days={monthDailySummary} max={maxDailyScans} />
          </div>
          <div className="chartPanel">
            <div className="chartHeader">
              <span>สัดส่วนแพลตฟอร์ม</span>
              <strong>{monthScans.length}</strong>
            </div>
            <DispatchChannelChart items={monthChannelSummary} total={monthScans.length} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <FileClock size={20} />
          <h3>รายการพร้อมจัดส่งของฝ่ายขาย</h3>
        </div>
        <div className="salesToolbar">
          <label>วันที่
            <input type="date" value={date} onChange={(event) => changeDate(event.target.value)} />
          </label>
          <div className="toolbarActions">
            <button className="secondary" onClick={() => changeDate(shiftDateKey(date, -1))}>วันก่อนหน้า</button>
            <button className="secondary" onClick={() => changeDate(todayKey())}>วันนี้</button>
            <button className="secondary" onClick={() => changeDate(shiftDateKey(date, 1))}>วันถัดไป</button>
            <button className="secondary" disabled={!exportRows.length} onClick={exportCsv}><FileClock size={18} />ส่งออก CSV</button>
            <button className="primary" disabled={!exportRows.length} onClick={exportExcel}><Archive size={18} />ส่งออก Excel</button>
          </div>
        </div>
        <DataTable
          columns={["เวลา", "แพลตฟอร์ม", "เลขพัสดุ", "เลขออเดอร์", "ลูกค้า", "ขนส่ง", "สถานะ", "สแกนซ้ำ"]}
          rows={scans.map((scan) => [
            formatDate(scan.scanned_at),
            channelLabel(scan.channel),
            scan.tracking_id,
            scan.order_key,
            scan.customer_name || "-",
            scan.shipping_provider || "-",
            <StatusBadge status={scan.status} />,
            scan.scan_count || 1
          ])}
          empty="ยังไม่มีรายการที่ฝ่ายขายสแกนในวันที่เลือก"
        />
      </section>
    </div>
  );
}

function OrdersPage({ onRefresh }) {
  const [orders, setOrders] = useState([]);
  const [filters, setFilters] = useState({ q: "", status: "", channel: "" });
  const [selected, setSelected] = useState(null);

  async function loadOrders(nextFilters = filters) {
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const data = await api(`/orders?${params.toString()}`);
    setOrders(data.orders);
  }

  useEffect(() => {
    loadOrders().catch(() => setOrders([]));
  }, []);

  async function applyFilters(event) {
    event.preventDefault();
    await loadOrders();
  }

  async function openOrder(id) {
    const data = await api(`/orders/${id}`);
    setSelected(data);
  }

  return (
    <div className="pageStack">
      <PageTitle icon={ClipboardList} title="Order Control Center" subtitle="ค้นหา ตรวจสถานะ และเปิดรายละเอียดออเดอร์" />
      <section className="panel">
        <form className="filterBar" onSubmit={applyFilters}>
          <label>ค้นหา
            <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="เลขพัสดุ, เลขออเดอร์, ชื่อลูกค้า" />
          </label>
          <label>สถานะ
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">ทั้งหมด</option>
              <option value="Ready to Pack">รอแพ็ค</option>
              <option value="Packing In Progress">กำลังแพ็ค</option>
              <option value="Scan Completed">สแกนเสร็จ รอยืนยัน</option>
              <option value="Packed">แพ็คเสร็จ</option>
              <option value="Shipped / Handed Over">ส่งมอบขนส่งแล้ว</option>
            </select>
          </label>
          <label>ช่องทาง
            <select value={filters.channel} onChange={(event) => setFilters({ ...filters, channel: event.target.value })}>
              <option value="">ทั้งหมด</option>
              <option value="shopee">Shopee</option>
              <option value="lazada">Lazada</option>
              <option value="tiktok">TikTok</option>
              <option value="reservation">ใบสั่งจอง/ออเดอร์ทั่วไป</option>
            </select>
          </label>
          <button className="primary"><Search size={18} />ค้นหา</button>
          <button type="button" className="secondary" onClick={() => Promise.all([loadOrders(), onRefresh()])}><RefreshCw size={18} />รีเฟรช</button>
        </form>
      </section>

      <div className="contentGrid ordersGrid">
        <section className="panel">
          <DataTable
            columns={["เลขพัสดุ", "ออเดอร์", "ช่องทาง", "ลูกค้า", "ขนส่ง", "สถานะ", "อัปเดต"]}
            rows={orders.map((order) => [
              <button className="linkButton" onClick={() => openOrder(order.id)}>{order.tracking_id}</button>,
              order.order_key,
              channelLabel(order.channel),
              order.customer_name || "-",
              order.shipping_provider || "-",
              <StatusBadge status={order.status} />,
              formatDate(order.updated_at)
            ])}
            empty="ไม่พบออเดอร์"
          />
        </section>

        <section className="panel detailPanel">
          <div className="panelHeader"><Boxes size={20} /><h3>รายละเอียดออเดอร์</h3></div>
          {!selected && <EmptyState label="เลือก tracking เพื่อดูรายละเอียด" />}
          {selected && (
            <div className="detailStack">
              <div className="detailHead">
                <strong>{selected.order_key}</strong>
                <StatusBadge status={selected.status} />
              </div>
              <dl>
                <div><dt>เลขพัสดุ</dt><dd>{selected.tracking_id}</dd></div>
                <div><dt>ลูกค้า</dt><dd>{selected.customer_name || "-"}</dd></div>
                <div><dt>ขนส่ง</dt><dd>{selected.shipping_provider || "-"}</dd></div>
                <div><dt>แพ็คโดย</dt><dd>{selected.packed_by_name || "-"}</dd></div>
              </dl>
              <div className="itemList tight">
                {selected.items.map((item) => (
                  <div className={`itemRow ${item.status}`} key={item.id}>
                    <div><strong>{item.sku}</strong><span>{item.product_name || "ไม่มีชื่อสินค้า"}</span></div>
                    <b>{item.quantity_scanned}/{item.quantity_required}</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function AuditPage() {
  const [events, setEvents] = useState([]);

  async function loadEvents() {
    const data = await api("/scan-events");
    setEvents(data.events);
  }

  useEffect(() => {
    loadEvents().catch(() => setEvents([]));
  }, []);

  return (
    <div className="pageStack">
      <PageTitle icon={FileClock} title="Scan Audit" subtitle="ประวัติการสแกนทั้งหมด ใช้ไล่ปัญหา SKU ผิดหรือออเดอร์ไม่พบ" action={<button className="secondary" onClick={loadEvents}><RefreshCw size={18} />รีเฟรช</button>} />
      <section className="panel">
        <DataTable
          columns={["เวลา", "ประเภท", "ค่าที่สแกน", "ผล", "ข้อความ", "ออเดอร์", "คนแพ็ค"]}
          rows={events.map((event) => [
            formatDate(event.created_at),
            SCAN_TYPE_LABELS[event.scan_type] || event.scan_type,
            event.scanned_value,
            <span className={`resultPill ${event.result}`}>{RESULT_LABELS[event.result] || event.result}</span>,
            translateMessage(event.message || "-"),
            event.tracking_id || event.order_key || "-",
            event.packer_name || "-"
          ])}
          empty="ยังไม่มี scan event"
        />
      </section>
    </div>
  );
}

function SettingsPage({ onRefresh }) {
  const [packers, setPackers] = useState([]);
  const [providers, setProviders] = useState([]);
  const [packerForm, setPackerForm] = useState({ employee_code: "", barcode: "", display_name: "" });
  const [providerForm, setProviderForm] = useState({ code: "", name: "", display_name: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadSettings() {
    const [packerData, providerData] = await Promise.all([
      api("/reference/packers"),
      api("/reference/shipping-providers")
    ]);
    setPackers(packerData.packers);
    setProviders(providerData.shipping_providers);
  }

  useEffect(() => {
    loadSettings().catch(() => {});
  }, []);

  async function addPacker(event) {
    event.preventDefault();
    setError("");
    try {
      await api("/packers", { method: "POST", body: JSON.stringify(packerForm) });
      setPackerForm({ employee_code: "", barcode: "", display_name: "" });
      setMessage("เพิ่มพนักงานแพ็คแล้ว");
      await Promise.all([loadSettings(), onRefresh()]);
    } catch (err) {
      setError(err.message);
    }
  }

  async function addProvider(event) {
    event.preventDefault();
    setError("");
    try {
      await api("/shipping-providers", { method: "POST", body: JSON.stringify(providerForm) });
      setProviderForm({ code: "", name: "", display_name: "" });
      setMessage("เพิ่มขนส่งแล้ว");
      await Promise.all([loadSettings(), onRefresh()]);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="pageStack">
      <PageTitle icon={Settings} title="Settings" subtitle="จัดการข้อมูลตั้งต้นสำหรับ packing station และ routing" />
      <div className="contentGrid two">
        <section className="panel">
          <div className="panelHeader"><UserRoundPlus size={20} /><h3>พนักงานแพ็ค</h3></div>
          <form className="formGrid" onSubmit={addPacker}>
            <input placeholder="รหัสพนักงาน" value={packerForm.employee_code} onChange={(event) => setPackerForm({ ...packerForm, employee_code: event.target.value })} />
            <input placeholder="Barcode" value={packerForm.barcode} onChange={(event) => setPackerForm({ ...packerForm, barcode: event.target.value })} />
            <input className="wideInput" placeholder="ชื่อที่แสดง" value={packerForm.display_name} onChange={(event) => setPackerForm({ ...packerForm, display_name: event.target.value })} />
            <button className="primary"><UserRoundPlus size={18} />เพิ่มพนักงาน</button>
          </form>
          <DataTable columns={["รหัส", "บาร์โค้ด", "ชื่อ"]} rows={packers.map((item) => [item.employee_code, item.barcode, item.display_name])} empty="ยังไม่มีพนักงานแพ็ค" />
        </section>

        <section className="panel">
          <div className="panelHeader"><Truck size={20} /><h3>รายชื่อขนส่ง</h3></div>
          <form className="formGrid" onSubmit={addProvider}>
            <input placeholder="รหัสขนส่ง เช่น SPX" value={providerForm.code} onChange={(event) => setProviderForm({ ...providerForm, code: event.target.value })} />
            <input placeholder="ชื่อขนส่ง" value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} />
            <input className="wideInput" placeholder="ชื่อที่แสดง" value={providerForm.display_name} onChange={(event) => setProviderForm({ ...providerForm, display_name: event.target.value })} />
            <button className="primary"><Truck size={18} />เพิ่มขนส่ง</button>
          </form>
          <DataTable columns={["รหัส", "ชื่อ", "ชื่อที่แสดง"]} rows={providers.map((item) => [item.code, item.name, item.display_name])} empty="ยังไม่มีขนส่ง" />
        </section>
      </div>
      {message && <Alert>{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}
    </div>
  );
}

function DataTable({ columns, rows, empty }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyState label={empty} />}
    </div>
  );
}

function EmptyState({ label }) {
  return <div className="emptyState"><Boxes size={28} />{hasBrokenThai(label) ? "ยังไม่มีข้อมูล" : label}</div>;
}

function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [summary, setSummary] = useState(null);
  const [readyOrders, setReadyOrders] = useState([]);
  const [apiError, setApiError] = useState("");
  const [busy, setBusy] = useState(false);
  const [packingLookup, setPackingLookup] = useState("");

  async function refresh() {
    try {
      const [summaryData, readyData] = await Promise.all([
        api("/dashboard/summary"),
        api("/orders/ready")
      ]);
      setSummary(summaryData);
      setReadyOrders(readyData.orders);
      setApiError("");
    } catch (err) {
      setApiError(err.message);
    }
  }

  async function resetDemo() {
    setBusy(true);
    try {
      await api("/demo/reset", { method: "POST", body: JSON.stringify({}) });
      await refresh();
      setActivePage("dashboard");
    } catch (err) {
      setApiError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function reloadAppVersion() {
    window.location.reload();
  }

  const page = {
    dashboard: <DashboardPage summary={summary} readyOrders={readyOrders} onDemoReset={resetDemo} busy={busy} />,
    "new-order": <NewOrderPage onRefresh={refresh} onGoPacking={(trackingId) => {
      setPackingLookup(trackingId);
      setActivePage("packing");
    }} />,
    import: <ImportPage onRefresh={refresh} />,
    packing: <PackingPage readyOrders={readyOrders} onRefresh={refresh} initialLookup={packingLookup} />,
    dispatch: <DispatchPage onRefresh={refresh} />,
    sales: <SalesDispatchPage />,
    orders: <OrdersPage onRefresh={refresh} />,
    audit: <AuditPage />,
    settings: <SettingsPage onRefresh={refresh} />
  }[activePage];

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brandBlock">
          <span>Hillkoff</span>
          <h1>ระบบแพ็คสินค้า</h1>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={activePage === item.id ? "active" : ""} onClick={() => setActivePage(item.id)}>
                <Icon size={19} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <strong>{NAV_ITEMS.find((item) => item.id === activePage)?.label}</strong>
            <span>{new Date().toLocaleDateString("th-TH", { weekday: "long", year: "numeric", month: "short", day: "numeric" })}</span>
          </div>
          <div className="topbarActions">
            {IS_NATIVE_WEBVIEW && (
              <button className="secondary" onClick={reloadAppVersion}><RefreshCw size={18} />อัปเดตหน้าเว็บ</button>
            )}
            <button className="secondary" onClick={refresh}><RefreshCw size={18} />รีเฟรช</button>
          </div>
        </header>
        {apiError && <Alert type="error">Backend: {apiError}</Alert>}
        {page}
      </main>
    </div>
  );
}

registerServiceWorker();
createRoot(document.getElementById("root")).render(<App />);
