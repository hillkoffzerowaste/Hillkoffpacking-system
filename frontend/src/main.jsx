import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Barcode,
  Box,
  CheckCircle2,
  ClipboardList,
  PackageCheck,
  RotateCcw,
  Search,
  Send,
  Upload
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.code || "Request failed");
  }
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

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ImportPanel({ onRefresh }) {
  const [channel, setChannel] = useState("shopee");
  const [dedupe, setDedupe] = useState("ignore");
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!file) {
      setError("กรุณาเลือกไฟล์ CSV/XLSX ก่อน");
      return;
    }

    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("channel", channel);
      form.append("deduplication_action", dedupe);
      const data = await api("/imports/orders", { method: "POST", body: form });
      setResult(data);
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    setBusy(true);
    setError("");
    try {
      const data = await api("/demo/reset", { method: "POST", body: JSON.stringify({}) });
      setResult({
        status: "demo_loaded",
        created_count: data.batches.reduce((sum, batch) => sum + batch.created_count, 0),
        ignored_count: 0,
        overwritten_count: data.batches.reduce((sum, batch) => sum + batch.overwritten_count, 0),
        error_count: 0,
        total_rows: 3
      });
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panelHeader">
        <Upload size={20} />
        <h2>นำเข้าออเดอร์</h2>
      </div>

      <form className="formGrid" onSubmit={submit}>
        <label>
          Channel
          <select value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="shopee">Shopee</option>
            <option value="lazada">Lazada</option>
            <option value="tiktok">TikTok</option>
            <option value="reservation">ใบสั่งจองทั่วไป</option>
          </select>
        </label>
        <label>
          Deduplication
          <select value={dedupe} onChange={(event) => setDedupe(event.target.value)}>
            <option value="ignore">Ignore duplicate</option>
            <option value="overwrite">Overwrite duplicate</option>
          </select>
        </label>
        <label className="wide">
          Import File
          <input type="file" accept=".csv,.xlsx,.xls,.xps" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <button className="primary" disabled={busy}>
          <Upload size={18} />
          Import
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={resetDemo}>
          <RotateCcw size={18} />
          Load Demo
        </button>
      </form>

      {error && <div className="alert error"><AlertTriangle size={18} />{error}</div>}
      {result && (
        <div className="statRow">
          <Stat label="Rows" value={result.total_rows} />
          <Stat label="Created" value={result.created_count} />
          <Stat label="Ignored" value={result.ignored_count} />
          <Stat label="Overwritten" value={result.overwritten_count} />
          <Stat label="Errors" value={result.error_count} />
        </div>
      )}
    </section>
  );
}

function PackingPanel({ orders, onRefresh }) {
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
      const data = await api("/packing/session", {
        method: "POST",
        body: JSON.stringify({ packer_barcode: packerBarcode })
      });
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
    if (!order) return;
    setError("");
    setMessage("");
    try {
      const data = await api(`/packing/orders/${order.id}/scan-item`, {
        method: "POST",
        body: JSON.stringify({ scanned_sku: sku, packer_id: packer?.packer_id })
      });
      setOrder(data.order);
      setSku("");
      setMessage(`${data.sku}: ${data.quantity_scanned}/${data.quantity_required}`);
      await onRefresh();
    } catch (err) {
      setError(err.message);
      playErrorSound();
      setSku("");
    }
  }

  const progress = useMemo(() => {
    if (!order?.items?.length) return 0;
    const required = order.items.reduce((sum, item) => sum + item.quantity_required, 0);
    const scanned = order.items.reduce((sum, item) => sum + item.quantity_scanned, 0);
    return Math.round((scanned / required) * 100);
  }, [order]);

  return (
    <section className="panel">
      <div className="panelHeader">
        <PackageCheck size={20} />
        <h2>Packing Station</h2>
      </div>

      <form className="inlineForm" onSubmit={identifyPacker}>
        <label>
          Packer
          <input value={packerBarcode} onChange={(event) => setPackerBarcode(event.target.value)} list="packers" />
          <datalist id="packers">
            {packers.map((item) => <option key={item.id} value={item.barcode}>{item.display_name}</option>)}
          </datalist>
        </label>
        <button className="primary"><Barcode size={18} />Identify</button>
      </form>

      <form className="inlineForm" onSubmit={loadOrder}>
        <label>
          Order / Tracking / Customer
          <input ref={lookupRef} value={lookup} onChange={(event) => setLookup(event.target.value)} disabled={!packer} placeholder="เช่น SPX-TRACK-1001" />
        </label>
        <button className="primary" disabled={!packer}><Search size={18} />Load</button>
      </form>

      {order && (
        <div className="workArea">
          <div className="orderBanner">
            <div>
              <span>{order.channel}</span>
              <strong>{order.order_key}</strong>
            </div>
            <div>
              <span>Tracking</span>
              <strong>{order.tracking_id}</strong>
            </div>
            <div>
              <span>Progress</span>
              <strong>{progress}%</strong>
            </div>
          </div>

          <form className="scanForm" onSubmit={scanSku}>
            <label>
              Scan SKU
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
                {item.status === "verified" && <CheckCircle2 size={22} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {message && <div className="alert success"><CheckCircle2 size={18} />{message}</div>}
      {error && <div className="alert error sticky"><AlertTriangle size={18} />{error}</div>}

      {!order && orders.length > 0 && (
        <div className="quickList">
          {orders.slice(0, 5).map((item) => (
            <button key={item.id} type="button" onClick={() => setLookup(item.tracking_id)}>
              {item.tracking_id}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function DispatchPanel({ onRefresh }) {
  const [lookup, setLookup] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

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
    <section className="panel dispatchPanel">
      <div className="panelHeader">
        <Send size={20} />
        <h2>Final Sorting</h2>
      </div>

      <form className="scanForm" onSubmit={dispatch}>
        <label>
          Final Scan
          <input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="สแกนใบปะหน้าอีกครั้ง" />
        </label>
        <button className="primary"><Send size={18} />Ship</button>
      </form>

      {result && (
        <div className="routeDisplay">
          <span>ส่งไปที่</span>
          <strong>{result.shipping_provider.display_name}</strong>
          <small>{result.status}</small>
        </div>
      )}

      {error && <div className="alert error"><AlertTriangle size={18} />{error}</div>}
    </section>
  );
}

function OrdersPanel({ orders }) {
  const groups = orders.reduce((acc, order) => {
    const provider = order.shipping_provider || "ไม่ระบุขนส่ง";
    acc[provider] = acc[provider] || [];
    acc[provider].push(order);
    return acc;
  }, {});

  return (
    <section className="panel fullWidth">
      <div className="panelHeader">
        <ClipboardList size={20} />
        <h2>Ready Orders by Shipping Provider</h2>
      </div>
      <div className="providerGrid">
        {Object.entries(groups).map(([provider, providerOrders]) => (
          <div className="providerColumn" key={provider}>
            <h3>{provider}</h3>
            {providerOrders.map((order) => (
              <div className="miniOrder" key={order.id}>
                <span>{order.status}</span>
                <strong>{order.tracking_id}</strong>
                <small>{order.customer_name || order.order_key}</small>
              </div>
            ))}
          </div>
        ))}
        {orders.length === 0 && <div className="empty"><Box size={28} />ยังไม่มีออเดอร์พร้อมแพ็ค</div>}
      </div>
    </section>
  );
}

function App() {
  const [orders, setOrders] = useState([]);
  const [apiError, setApiError] = useState("");

  async function refresh() {
    try {
      const data = await api("/orders/ready");
      setOrders(data.orders);
      setApiError("");
    } catch (err) {
      setApiError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <main>
      <header className="topbar">
        <div>
          <span>Hillkoff</span>
          <h1>Packing System</h1>
        </div>
        <button className="secondary" onClick={refresh}><RotateCcw size={18} />Refresh</button>
      </header>

      {apiError && <div className="alert error"><AlertTriangle size={18} />Backend: {apiError}</div>}

      <div className="dashboard">
        <ImportPanel onRefresh={refresh} />
        <PackingPanel orders={orders} onRefresh={refresh} />
        <DispatchPanel onRefresh={refresh} />
        <OrdersPanel orders={orders} />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);

