import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Archive,
  Barcode,
  Boxes,
  CheckCircle2,
  ClipboardList,
  FileClock,
  LayoutDashboard,
  PackageCheck,
  RefreshCw,
  Search,
  Send,
  Settings,
  Truck,
  Upload,
  UserRoundPlus,
  Users
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "import", label: "Import", icon: Upload },
  { id: "packing", label: "Packing", icon: PackageCheck },
  { id: "dispatch", label: "Dispatch", icon: Send },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "audit", label: "Audit", icon: FileClock },
  { id: "settings", label: "Settings", icon: Settings }
];

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.code || "Request failed");
  return data;
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
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState([]);

  async function loadBatches() {
    const data = await api("/imports/batches");
    setBatches(data.batches);
  }

  useEffect(() => {
    loadBatches().catch(() => setBatches([]));
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!file) {
      setError("กรุณาเลือกไฟล์ CSV หรือ XLSX ก่อนนำเข้า");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
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
              <select value={channel} onChange={(event) => setChannel(event.target.value)}>
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
              <input type="file" accept=".csv,.xlsx,.xls,.xps" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            </label>
            <button className="primary" disabled={busy}><Upload size={18} />Import</button>
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

function PackingPage({ onRefresh, readyOrders }) {
  const [packers, setPackers] = useState([]);
  const [packer, setPacker] = useState(null);
  const [packerBarcode, setPackerBarcode] = useState("EMP001");
  const [lookup, setLookup] = useState("");
  const [sku, setSku] = useState("");
  const [order, setOrder] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lookupRef = useRef(null);
  const skuRef = useRef(null);

  useEffect(() => {
    api("/reference/packers").then((data) => setPackers(data.packers)).catch(() => setPackers([]));
  }, []);

  useEffect(() => {
    if (packer) lookupRef.current?.focus();
  }, [packer]);

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
          <form className="inlineForm" onSubmit={identifyPacker}>
            <label>Packer Barcode
              <input value={packerBarcode} onChange={(event) => setPackerBarcode(event.target.value)} list="packer-list" />
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
    import: <ImportPage onRefresh={refresh} />,
    packing: <PackingPage readyOrders={readyOrders} onRefresh={refresh} />,
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
