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
import { parseImportFile, recordsToCsv } from "./lib/importParser";
import {
  createFirebaseOrder,
  createFirebasePacker,
  createFirebaseProvider,
  dispatchFirebaseOrder,
  firebaseSummary,
  identifyFirebasePacker,
  importFirebaseFile,
  listFirebaseBatches,
  listFirebaseOrders,
  listFirebasePackers,
  listFirebaseProviders,
  listFirebaseReadyOrders,
  listFirebaseScanEvents,
  lookupFirebaseOrder,
  resetFirebaseDemo,
  scanFirebaseSku,
  getFirebaseOrder
} from "./lib/firebaseAdapter";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";
const LOCAL_STORE_KEY = "hillkoff-packing-local-db-v1";
const DATA_MODE = import.meta.env.VITE_DATA_MODE || "api";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "new-order", label: "New Order", icon: Plus },
  { id: "import", label: "Import", icon: Upload },
  { id: "packing", label: "Packing", icon: PackageCheck },
  { id: "dispatch", label: "Dispatch", icon: Send },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "audit", label: "Audit", icon: FileClock },
  { id: "settings", label: "Settings", icon: Settings }
];

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
  if (path.includes("/scan-item") && method === "POST") return scanFirebaseSku(path.split("/")[3], body.scanned_sku, body.packer_id);
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
  if (saved) return JSON.parse(saved);

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
    const active = db.orders.filter((order) => ["Ready to Pack", "Packing In Progress", "Verified", "Packed"].includes(order.status));
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
        .filter((order) => ["Ready to Pack", "Packing In Progress", "Verified", "Packed"].includes(order.status))
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
    const item = order.items.find((candidate) => candidate.sku.toUpperCase() === scannedSku.toUpperCase());
    if (!item) {
      addLocalEvent(db, { order_id: order.id, packer_id: body.packer_id, scan_type: "item_verify", scanned_value: scannedSku, result: "error", message: "SKU does not match this order" });
      writeLocalDb(db);
      throw new Error("SKU does not match this order.");
    }
    if (item.quantity_scanned >= item.quantity_required) {
      addLocalEvent(db, { order_id: order.id, order_item_id: item.id, packer_id: body.packer_id, scan_type: "item_verify", scanned_value: scannedSku, result: "error", message: "Quantity already completed" });
      writeLocalDb(db);
      throw new Error("Quantity already completed.");
    }
    item.quantity_scanned += 1;
    item.status = item.quantity_scanned >= item.quantity_required ? "verified" : "partial";
    item.updated_at = nowIso();
    order.status = order.items.every((candidate) => candidate.status === "verified") ? "Packed" : "Packing In Progress";
    order.packed_by = order.packed_by || body.packer_id || null;
    order.packed_at = order.status === "Packed" ? nowIso() : order.packed_at;
    order.updated_at = nowIso();
    addLocalEvent(db, { order_id: order.id, order_item_id: item.id, packer_id: body.packer_id, scan_type: "item_verify", scanned_value: scannedSku, result: "success", message: `${item.quantity_scanned}/${item.quantity_required}` });
    writeLocalDb(db);
    return {
      result: "success",
      sku: item.sku,
      quantity_scanned: item.quantity_scanned,
      quantity_required: item.quantity_required,
      item_status: item.status,
      order_status: order.status,
      order: orderDetail(db, order.id)
    };
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

function StatusBadge({ status }) {
  const key = String(status || "").toLowerCase().replaceAll(" ", "-").replaceAll("/", "");
  return <span className={`badge ${key}`}>{status || "-"}</span>;
}

function PageTitle({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="pageTitle">
      <div>
        <div className="titleLine">
          <Icon size={24} />
          <h2>{title}</h2>
        </div>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Alert({ type = "success", children }) {
  const Icon = type === "error" ? AlertTriangle : CheckCircle2;
  return <div className={`notice ${type}`}><Icon size={18} />{children}</div>;
}

function ScannerField({
  label,
  value,
  onChange,
  inputRef,
  placeholder,
  disabled,
  onSubmit,
  buttonLabel = "Scan"
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

function CameraScanner({ title, onResult, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let controls;
    let active = true;
    const reader = new BrowserMultiFormatReader();

    async function start() {
      try {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (!active || !result) return;
          active = false;
          onResult(result.getText());
          controls?.stop();
          onClose();
        });
      } catch (err) {
        setError(err.message || "Cannot open camera.");
      }
    }

    start();
    return () => {
      active = false;
      controls?.stop();
    };
  }, [onClose, onResult]);

  return (
    <div className="cameraOverlay">
      <div className="cameraModal">
        <div className="cameraHeader">
          <div>
            <strong>{title}</strong>
            <span>Point the camera at a barcode or QR code.</span>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </div>
        <div className="cameraFrame">
          <video ref={videoRef} muted playsInline />
          <div className="scanGuide" />
        </div>
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
        action={<button className="primary" disabled={busy} onClick={onDemoReset}><Archive size={18} />Load Demo</button>}
      />

      <div className="metricsGrid">
        <Metric label="Ready to Pack" value={summary?.totals?.ready} />
        <Metric label="In Progress" value={summary?.totals?.in_progress} tone="warn" />
        <Metric label="Packed Today" value={summary?.totals?.packed_today} tone="ok" />
        <Metric label="Shipped Today" value={summary?.totals?.shipped_today} tone="ok" />
        <Metric label="Scan Errors Today" value={summary?.totals?.error_scans_today} tone="danger" />
      </div>

      <div className="contentGrid two">
        <section className="panel">
          <div className="panelHeader"><Truck size={20} /><h3>Shipping Queue</h3></div>
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
          <div className="panelHeader"><Boxes size={20} /><h3>Latest Work Queue</h3></div>
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
  const [channel, setChannel] = useState("shopee");
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
    setConvertError("");
    setResult(null);
    setError("");
  }

  function selectChannel(nextChannel) {
    setChannel(nextChannel);
    setConvertedFile(null);
    setConvertedRows([]);
    setConvertError("");
    setResult(null);
  }

  async function convertSelectedFile() {
    if (!file) {
      setConvertError("Please choose a document before converting.");
      return;
    }

    setConverting(true);
    setConvertError("");
    setError("");
    try {
      const rows = await parseImportFile(file, channel);
      const csv = recordsToCsv(rows);
      const csvName = file.name.replace(/\.[^.]+$/, "") || "orders";
      const nextFile = new File([csv], `${csvName}.csv`, { type: "text/csv;charset=utf-8" });
      setConvertedFile(nextFile);
      setConvertedRows(rows);
    } catch (err) {
      setConvertedFile(null);
      setConvertedRows([]);
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
      form.append("channel", channel);
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
          <div className="panelHeader"><Upload size={20} /><h3>New Import</h3></div>
          <form className="formGrid" onSubmit={submit}>
            <label>Channel
              <select value={channel} onChange={(event) => selectChannel(event.target.value)}>
                <option value="shopee">Shopee</option>
                <option value="lazada">Lazada</option>
                <option value="tiktok">TikTok</option>
                <option value="reservation">ใบสั่งจองทั่วไป</option>
              </select>
            </label>
            <label>Deduplication
              <select value={dedupe} onChange={(event) => setDedupe(event.target.value)}>
                <option value="ignore">Ignore duplicate</option>
                <option value="overwrite">Overwrite duplicate</option>
              </select>
            </label>
            <label className="wide">Import File
              <input type="file" accept=".csv,.xlsx,.xls,.xps,.oxps" onChange={(event) => selectFile(event.target.files?.[0] || null)} />
            </label>
            <div className="wide converterBox">
              <div>
                <strong>Convert document to CSV</strong>
                <span>{convertedFile ? `${convertedFile.name} ready (${convertedRows.length} rows)` : "Excel/XPS will be converted to CSV before import."}</span>
              </div>
              <button type="button" className="secondary" disabled={busy || converting || !file} onClick={convertSelectedFile}>
                <FileClock size={18} />{converting ? "Converting..." : "Convert"}
              </button>
            </div>
            {convertError && <div className="wide"><Alert type="error">{convertError}</Alert></div>}
            {convertedRows.length > 0 && (
              <div className="wide csvPreview">
                <DataTable
                  columns={previewColumns}
                  rows={convertedRows.slice(0, 5).map((row) => previewColumns.map((column) => row[column] || ""))}
                  empty="No converted rows"
                />
              </div>
            )}
            <button className="primary" disabled={busy}><Upload size={18} />{convertedFile ? "Import CSV" : "Import"}</button>
          </form>
          {error && <Alert type="error">{error}</Alert>}
          {result && (
            <div className="resultGrid">
              <Metric label="Rows" value={result.total_rows} />
              <Metric label="Created" value={result.created_count} tone="ok" />
              <Metric label="Ignored" value={result.ignored_count} />
              <Metric label="Overwritten" value={result.overwritten_count} tone="warn" />
              <Metric label="Errors" value={result.error_count} tone="danger" />
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panelHeader"><FileClock size={20} /><h3>Import History</h3></div>
          <DataTable
            columns={["File", "Channel", "Rows", "Created", "Ignored", "Overwritten", "Status"]}
            rows={batches.map((batch) => [
              batch.file_name,
              batch.channel,
              batch.total_rows,
              batch.created_count,
              batch.ignored_count,
              batch.overwritten_count,
              batch.status
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
            <span><Barcode size={18} />Barcode scan shortcuts</span>
            <button type="button" className="scanModeButton" onClick={() => orderInputRef.current?.focus()}>Scan Order</button>
            <button type="button" className="scanModeButton camera" onClick={() => setCameraTarget({ title: "Camera Scan Order", apply: (value) => setForm((current) => ({ ...current, order_key: value })) })}><Camera size={18} />Camera Order</button>
            <button type="button" className="scanModeButton" onClick={() => document.querySelectorAll(".formGrid input")[1]?.focus()}>Scan Label</button>
            <button type="button" className="scanModeButton camera" onClick={() => setCameraTarget({ title: "Camera Scan Shipping Label", apply: (value) => setForm((current) => ({ ...current, tracking_id: value })) })}><Camera size={18} />Camera Label</button>
            <button type="button" className="scanModeButton" onClick={() => document.querySelector(".manualItemRow input")?.focus()}>Scan SKU</button>
            <button type="button" className="scanModeButton camera" onClick={() => setCameraTarget({ title: "Camera Scan SKU", apply: (value) => updateItem(0, { sku: value }) })}><Camera size={18} />Camera SKU</button>
          </div>
          <div className="formGrid">
            <label>Channel
              <select value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
                <option value="reservation">Reservation</option>
                <option value="shopee">Shopee</option>
                <option value="lazada">Lazada</option>
                <option value="tiktok">TikTok</option>
              </select>
            </label>
            <label>Shipping Provider
              <select value={form.shipping_provider_code} onChange={(event) => setForm({ ...form, shipping_provider_code: event.target.value })}>
                {providers.map((provider) => <option key={provider.id} value={provider.code}>{provider.display_name}</option>)}
              </select>
            </label>
            <label>Order ID / เลขที่ใบสั่งจอง
              <input ref={orderInputRef} value={form.order_key} onChange={(event) => setForm({ ...form, order_key: event.target.value })} placeholder="เช่น RSV-5001" />
            </label>
            <label>Tracking ID
              <input value={form.tracking_id} onChange={(event) => setForm({ ...form, tracking_id: event.target.value })} placeholder="เว้นว่างได้ ระบบใช้เลขออเดอร์แทน" />
            </label>
            <label className="wide">Customer Name
              <input value={form.customer_name} onChange={(event) => setForm({ ...form, customer_name: event.target.value })} placeholder="ชื่อลูกค้า" />
            </label>
          </div>

          <div className="itemEntryHeader">
            <h3>Items</h3>
            <div className="inlineButtonGroup">
              <button type="button" className="secondary" onClick={() => document.querySelector(".manualItemRow input")?.focus()}><Barcode size={18} />Scan SKU</button>
              <button type="button" className="secondary" onClick={addItem}><Plus size={18} />Add SKU</button>
            </div>
          </div>

          <div className="manualItems">
            {form.items.map((item, index) => (
              <div className="manualItemRow" key={index}>
                <label>SKU / Barcode
                  <input value={item.sku} onChange={(event) => updateItem(index, { sku: event.target.value })} placeholder="ยิงหรือพิมพ์ SKU" />
                </label>
                <label>Product Name
                  <input value={item.product_name} onChange={(event) => updateItem(index, { product_name: event.target.value })} placeholder="ชื่อสินค้า" />
                </label>
                <label>Qty
                  <input type="number" min="1" value={item.quantity_required} onChange={(event) => updateItem(index, { quantity_required: event.target.value })} />
                </label>
                <button type="button" className="iconButton cameraIcon" onClick={() => setCameraTarget({ title: "Camera Scan SKU", apply: (value) => updateItem(index, { sku: value }) })} aria-label="Camera Scan SKU"><Camera size={18} /></button>
                <button type="button" className="iconButton" onClick={() => removeItem(index)} aria-label="Remove SKU"><Trash2 size={18} /></button>
              </div>
            ))}
          </div>

          <div className="formActions">
            <button className="primary"><Plus size={18} />Create Ready Order</button>
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
            onResult={(value) => cameraTarget.apply(value)}
            onClose={() => setCameraTarget(null)}
          />
        )}
      </section>
    </div>
  );
}

function PackingPage({ onRefresh, readyOrders, initialLookup }) {
  const [packers, setPackers] = useState([]);
  const [packer, setPacker] = useState(null);
  const [packerBarcode, setPackerBarcode] = useState("EMP001");
  const [lookup, setLookup] = useState("");
  const [sku, setSku] = useState("");
  const [order, setOrder] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cameraTarget, setCameraTarget] = useState(null);
  const packerRef = useRef(null);
  const lookupRef = useRef(null);
  const skuRef = useRef(null);

  useEffect(() => {
    api("/reference/packers").then((data) => setPackers(data.packers)).catch(() => setPackers([]));
  }, []);

  useEffect(() => {
    if (packer) lookupRef.current?.focus();
  }, [packer]);

  useEffect(() => {
    if (initialLookup) setLookup(initialLookup);
  }, [initialLookup]);

  async function identifyPacker(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await api("/packing/session", { method: "POST", body: JSON.stringify({ packer_barcode: packerBarcode }) });
      setPacker(data);
      setMessage(`พร้อมทำงาน: ${data.display_name}`);
    } catch (err) {
      setError(err.message);
      playErrorSound();
    }
  }

  async function loadOrder(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const data = await api("/packing/orders/lookup", {
        method: "POST",
        body: JSON.stringify({ lookup_value: lookup, packer_id: packer?.packer_id })
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

  async function scanSku(event) {
    event.preventDefault();
    if (!order || !sku) return;
    setError("");
    setMessage("");
    try {
      const data = await api(`/packing/orders/${order.id}/scan-item`, {
        method: "POST",
        body: JSON.stringify({ scanned_sku: sku, packer_id: packer?.packer_id })
      });
      setOrder(data.order);
      setMessage(`${data.sku}: ${data.quantity_scanned}/${data.quantity_required}`);
      setSku("");
      await onRefresh();
    } catch (err) {
      setError(err.message);
      setSku("");
      playErrorSound();
    }
  }

  const progress = useMemo(() => {
    if (!order?.items?.length) return 0;
    const required = order.items.reduce((sum, item) => sum + item.quantity_required, 0);
    const scanned = order.items.reduce((sum, item) => sum + item.quantity_scanned, 0);
    return Math.round((scanned / required) * 100);
  }, [order]);

  return (
    <div className="pageStack">
      <PageTitle icon={PackageCheck} title="Packing Station" subtitle="สแกนใบปะหน้า ดึงออเดอร์ และตรวจ SKU ทีละชิ้น" />
      <div className="contentGrid stationGrid">
        <section className="panel stationPanel">
          <div className="panelHeader"><Users size={20} /><h3>Packer Identification</h3></div>
          <div className="scanHelperBar">
            <span><Barcode size={18} />Scan workflow</span>
            <button type="button" className="scanModeButton" onClick={() => packerRef.current?.focus()}>Scan Packer</button>
            <button type="button" className="scanModeButton camera" onClick={() => setCameraTarget({ title: "Camera Scan Packer", apply: setPackerBarcode })}><Camera size={18} />Camera Packer</button>
            <button type="button" className="scanModeButton" disabled={!packer} onClick={() => lookupRef.current?.focus()}>Scan Label</button>
            <button type="button" className="scanModeButton camera" disabled={!packer} onClick={() => setCameraTarget({ title: "Camera Scan Shipping Label", apply: setLookup })}><Camera size={18} />Camera Label</button>
            <button type="button" className="scanModeButton" disabled={!order} onClick={() => skuRef.current?.focus()}>Scan SKU</button>
            <button type="button" className="scanModeButton camera" disabled={!order} onClick={() => setCameraTarget({ title: "Camera Scan SKU", apply: setSku })}><Camera size={18} />Camera SKU</button>
          </div>
          <form className="inlineForm" onSubmit={identifyPacker}>
            <label>Packer Barcode
              <input ref={packerRef} value={packerBarcode} onChange={(event) => setPackerBarcode(event.target.value)} list="packer-list" />
              <datalist id="packer-list">
                {packers.map((item) => <option key={item.id} value={item.barcode}>{item.display_name}</option>)}
              </datalist>
            </label>
            <button className="primary"><Barcode size={18} />Identify</button>
          </form>

          <div className="divider" />

          <form className="inlineForm" onSubmit={loadOrder}>
            <label>Order / Tracking / Customer
              <input ref={lookupRef} value={lookup} onChange={(event) => setLookup(event.target.value)} disabled={!packer} placeholder="เช่น SPX-TRACK-1001" />
            </label>
            <button className="primary" disabled={!packer}><Search size={18} />Load</button>
          </form>

          {order && (
            <div className="packingWorkspace">
              <div className="orderHero">
                <div><span>Order</span><strong>{order.order_key}</strong></div>
                <div><span>Tracking</span><strong>{order.tracking_id}</strong></div>
                <div><span>Progress</span><strong>{progress}%</strong></div>
              </div>
              <form className="scanForm" onSubmit={scanSku}>
                <label>Scan SKU
                  <input ref={skuRef} value={sku} onChange={(event) => setSku(event.target.value)} placeholder="ยิง barcode สินค้า" />
                </label>
                <button className="primary"><Barcode size={18} />Scan</button>
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
            </div>
          )}

          {message && <Alert>{message}</Alert>}
          {error && <Alert type="error">{error}</Alert>}
          {cameraTarget && (
            <CameraScanner
              title={cameraTarget.title}
              onResult={(value) => cameraTarget.apply(value)}
              onClose={() => setCameraTarget(null)}
            />
          )}
        </section>

        <section className="panel sideQueue">
          <div className="panelHeader"><ClipboardList size={20} /><h3>Ready Queue</h3></div>
          <div className="queueList">
            {readyOrders.slice(0, 12).map((item) => (
              <button className="queueItem" key={item.id} onClick={() => setLookup(item.tracking_id)}>
                <strong>{item.tracking_id}</strong>
                <span>{item.shipping_provider || "ไม่ระบุขนส่ง"}</span>
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
          <span><Barcode size={18} />Ready for barcode scanner</span>
          <button type="button" className="scanModeButton" onClick={() => inputRef.current?.focus()}>Scan Final Label</button>
          <button type="button" className="scanModeButton camera" onClick={() => setCameraOpen(true)}><Camera size={18} />Camera Final Label</button>
        </div>
        <form className="dispatchForm" onSubmit={dispatch}>
          <label>Final Shipping Label Scan
            <input ref={inputRef} value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="สแกน Tracking ID หรือ Order ID" />
          </label>
          <button className="primary"><Send size={20} />Confirm Dispatch</button>
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
            title="Camera Scan Final Label"
            onResult={setLookup}
            onClose={() => setCameraOpen(false)}
          />
        )}
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
          <label>Search
            <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="tracking, order, customer" />
          </label>
          <label>Status
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">All</option>
              <option value="Ready to Pack">Ready to Pack</option>
              <option value="Packing In Progress">Packing In Progress</option>
              <option value="Packed">Packed</option>
              <option value="Shipped / Handed Over">Shipped / Handed Over</option>
            </select>
          </label>
          <label>Channel
            <select value={filters.channel} onChange={(event) => setFilters({ ...filters, channel: event.target.value })}>
              <option value="">All</option>
              <option value="shopee">Shopee</option>
              <option value="lazada">Lazada</option>
              <option value="tiktok">TikTok</option>
              <option value="reservation">Reservation</option>
            </select>
          </label>
          <button className="primary"><Search size={18} />Search</button>
          <button type="button" className="secondary" onClick={() => Promise.all([loadOrders(), onRefresh()])}><RefreshCw size={18} />Refresh</button>
        </form>
      </section>

      <div className="contentGrid ordersGrid">
        <section className="panel">
          <DataTable
            columns={["Tracking", "Order", "Channel", "Customer", "Provider", "Status", "Updated"]}
            rows={orders.map((order) => [
              <button className="linkButton" onClick={() => openOrder(order.id)}>{order.tracking_id}</button>,
              order.order_key,
              order.channel,
              order.customer_name || "-",
              order.shipping_provider || "-",
              <StatusBadge status={order.status} />,
              formatDate(order.updated_at)
            ])}
            empty="ไม่พบออเดอร์"
          />
        </section>

        <section className="panel detailPanel">
          <div className="panelHeader"><Boxes size={20} /><h3>Order Detail</h3></div>
          {!selected && <EmptyState label="เลือก tracking เพื่อดูรายละเอียด" />}
          {selected && (
            <div className="detailStack">
              <div className="detailHead">
                <strong>{selected.order_key}</strong>
                <StatusBadge status={selected.status} />
              </div>
              <dl>
                <div><dt>Tracking</dt><dd>{selected.tracking_id}</dd></div>
                <div><dt>Customer</dt><dd>{selected.customer_name || "-"}</dd></div>
                <div><dt>Shipping</dt><dd>{selected.shipping_provider || "-"}</dd></div>
                <div><dt>Packed By</dt><dd>{selected.packed_by_name || "-"}</dd></div>
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
      <PageTitle icon={FileClock} title="Scan Audit" subtitle="ประวัติการสแกนทั้งหมด ใช้ไล่ปัญหา SKU ผิดหรือออเดอร์ไม่พบ" action={<button className="secondary" onClick={loadEvents}><RefreshCw size={18} />Refresh</button>} />
      <section className="panel">
        <DataTable
          columns={["Time", "Type", "Value", "Result", "Message", "Order", "Packer"]}
          rows={events.map((event) => [
            formatDate(event.created_at),
            event.scan_type,
            event.scanned_value,
            <span className={`resultPill ${event.result}`}>{event.result}</span>,
            event.message || "-",
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
          <div className="panelHeader"><UserRoundPlus size={20} /><h3>Packers</h3></div>
          <form className="formGrid" onSubmit={addPacker}>
            <input placeholder="Employee Code" value={packerForm.employee_code} onChange={(event) => setPackerForm({ ...packerForm, employee_code: event.target.value })} />
            <input placeholder="Barcode" value={packerForm.barcode} onChange={(event) => setPackerForm({ ...packerForm, barcode: event.target.value })} />
            <input className="wideInput" placeholder="Display Name" value={packerForm.display_name} onChange={(event) => setPackerForm({ ...packerForm, display_name: event.target.value })} />
            <button className="primary"><UserRoundPlus size={18} />Add Packer</button>
          </form>
          <DataTable columns={["Code", "Barcode", "Name"]} rows={packers.map((item) => [item.employee_code, item.barcode, item.display_name])} empty="ยังไม่มี packer" />
        </section>

        <section className="panel">
          <div className="panelHeader"><Truck size={20} /><h3>Shipping Providers</h3></div>
          <form className="formGrid" onSubmit={addProvider}>
            <input placeholder="Code" value={providerForm.code} onChange={(event) => setProviderForm({ ...providerForm, code: event.target.value })} />
            <input placeholder="Name" value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} />
            <input className="wideInput" placeholder="Display Name" value={providerForm.display_name} onChange={(event) => setProviderForm({ ...providerForm, display_name: event.target.value })} />
            <button className="primary"><Truck size={18} />Add Provider</button>
          </form>
          <DataTable columns={["Code", "Name", "Display"]} rows={providers.map((item) => [item.code, item.name, item.display_name])} empty="ยังไม่มีขนส่ง" />
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
  return <div className="emptyState"><Boxes size={28} />{label}</div>;
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

  const page = {
    dashboard: <DashboardPage summary={summary} readyOrders={readyOrders} onDemoReset={resetDemo} busy={busy} />,
    "new-order": <NewOrderPage onRefresh={refresh} onGoPacking={(trackingId) => {
      setPackingLookup(trackingId);
      setActivePage("packing");
    }} />,
    import: <ImportPage onRefresh={refresh} />,
    packing: <PackingPage readyOrders={readyOrders} onRefresh={refresh} initialLookup={packingLookup} />,
    dispatch: <DispatchPage onRefresh={refresh} />,
    orders: <OrdersPage onRefresh={refresh} />,
    audit: <AuditPage />,
    settings: <SettingsPage onRefresh={refresh} />
  }[activePage];

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brandBlock">
          <span>Hillkoff</span>
          <h1>Packing System</h1>
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
          <button className="secondary" onClick={refresh}><RefreshCw size={18} />Refresh</button>
        </header>
        {apiError && <Alert type="error">Backend: {apiError}</Alert>}
        {page}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
