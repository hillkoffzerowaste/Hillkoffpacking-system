import JSZip from "jszip";
import readXlsxFile from "read-excel-file/browser";

function value(row, names) {
  for (const name of names) {
    const item = row[name];
    if (item !== undefined && item !== null && String(item).trim() !== "") return String(item).trim();
  }
  return "";
}

function decodeXml(valueText) {
  return String(valueText || "")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function normalizeHeader(text) {
  return String(text || "").trim();
}

function looksLikeHeader(line, channel) {
  const lower = line.toLowerCase();
  const channelHints = {
    shopee: ["หมายเลข", "sku", "จำนวน", "tracking"],
    lazada: ["ordernumber", "orderitemid", "sellersku", "trackingcode"],
    tiktok: ["order id", "seller sku", "quantity", "tracking id"],
    reservation: ["ใบสั่งจอง", "รหัสสินค้า", "จำนวน", "customer"]
  };
  return (channelHints[channel] || []).some((hint) => lower.includes(hint.toLowerCase()));
}

function splitColumns(line) {
  return String(line || "")
    .split(/\t| {2,}|\s\|\s|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function xpsTextToRows(text, channel) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headerIndex = lines.findIndex((line) => looksLikeHeader(line, channel));
  if (headerIndex < 0) {
    throw new Error("XPS text was extracted, but no table header was found. Please export CSV or use New Order.");
  }

  const headers = splitColumns(lines[headerIndex]).map(normalizeHeader);
  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const columns = splitColumns(line);
    if (columns.length < Math.min(3, headers.length)) continue;
    rows.push(headers.reduce((record, header, index) => {
      if (header) record[header] = columns[index] || "";
      return record;
    }, {}));
  }

  if (!rows.length) {
    throw new Error("XPS table header was found, but no data rows could be parsed. Please export CSV or use New Order.");
  }

  return rows;
}

async function parseXps(file, channel) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const pageFiles = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .filter((entry) => /\.(fpage|xml)$/i.test(entry.name))
    .filter((entry) => !/\[(content_types)\]|\.rels|metadata|resources/i.test(entry.name));

  const chunks = [];
  for (const entry of pageFiles) {
    const xml = await entry.async("text");
    const glyphMatches = [...xml.matchAll(/UnicodeString="([^"]*)"/g)];
    const textMatches = [...xml.matchAll(/<[^:>]*:?Text[^>]*>([^<]*)<\/[^>]+>/g)];
    const pageText = [
      ...glyphMatches.map((match) => decodeXml(match[1])),
      ...textMatches.map((match) => decodeXml(match[1]))
    ].filter(Boolean).join("\n");
    if (pageText) chunks.push(pageText);
  }

  if (!chunks.length) {
    throw new Error("No readable text found in this XPS. If it is scanned/image-based, OCR is required.");
  }

  return xpsTextToRows(chunks.join("\n"), channel);
}

function quantity(raw, fallback = 1) {
  const parsed = Number.parseInt(String(raw || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function providerCode(raw, channel) {
  const normalized = String(raw || "").toLowerCase();
  if (normalized.includes("j&t") || normalized.includes("jnt")) return "JNT";
  if (normalized.includes("spx") || normalized.includes("shopee express")) return "SPX";
  if (normalized.includes("lex") || normalized.includes("lazada")) return "LEX";
  if (channel === "reservation") return "GENERAL";
  return channel === "lazada" ? "LEX" : channel === "shopee" ? "SPX" : "JNT";
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      current.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }

  const headers = rows[0]?.map((header) => String(header || "").trim()) || [];
  return rows.slice(1)
    .map((row) => headers.reduce((record, header, index) => {
      if (header) record[header] = String(row[index] || "").trim();
      return record;
    }, {}))
    .filter((record) => Object.values(record).some(Boolean));
}

function spreadsheetRowsToRecords(rows, channel, sourceName) {
  if (!Array.isArray(rows)) {
    throw new Error(`${sourceName} could not be parsed. Please check that the first sheet has a header row and order data.`);
  }

  const normalizedRows = rows
    .filter((row) => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));

  const detectedHeaderIndex = normalizedRows.findIndex((row) => looksLikeHeader(row.join(" "), channel));
  const headerIndex = detectedHeaderIndex >= 0 ? detectedHeaderIndex : 0;
  const headers = normalizedRows[headerIndex] || [];
  const records = normalizedRows.slice(headerIndex + 1)
    .map((row) => headers.reduce((record, header, index) => {
      if (header) record[header] = row[index] || "";
      return record;
    }, {}))
    .filter((record) => Object.values(record).some(Boolean));

  if (!headers.some(Boolean) || !records.length) {
    throw new Error(`${sourceName} could not be parsed. Please check that the first sheet has a header row and order data.`);
  }

  return records;
}

async function parseExcel(file, channel) {
  const sheets = await readXlsxFile(file, { sheets: [1] });
  const rows = Array.isArray(sheets) && sheets[0]?.data ? sheets[0].data : sheets;
  return spreadsheetRowsToRecords(rows, channel, "Excel file");
}

export async function parseImportFile(file, channel) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    return parseCsv(await file.text());
  }

  if (lowerName.endsWith(".xlsx")) {
    return parseExcel(file, channel);
  }

  if (lowerName.endsWith(".xls")) {
    throw new Error("Old .xls files are not supported yet. Please save as .xlsx or CSV and import again.");
  }

  if (lowerName.endsWith(".xps") || lowerName.endsWith(".oxps")) {
    return parseXps(file, channel);
  }

  throw new Error("Firebase import supports CSV, XLSX, and text-based XPS files.");
}

export function mapImportRow(row, channel) {
  if (channel === "shopee") {
    const orderKey = value(row, ["หมายเลขคำสั่งซื้อ", "Order ID", "order_id"]);
    return {
      channel,
      order_key: orderKey,
      tracking_id: value(row, ["*หมายเลขติดตามพัสดุ", "หมายเลขติดตามพัสดุ", "Tracking Number", "tracking_id"]) || orderKey,
      customer_name: value(row, ["ชื่อผู้รับ", "ชื่อลูกค้า", "Customer Name"]),
      shipping_provider_code: providerCode(value(row, ["ขนส่ง", "Shipping Provider", "Logistics Channel"]), channel),
      items: [{
        sku: value(row, ["เลขอ้างอิง SKU", "SKU Reference No.", "sku"]),
        product_name: value(row, ["ชื่อสินค้า", "Product Name"]),
        quantity_required: quantity(value(row, ["จำนวน", "Quantity", "qty"]))
      }]
    };
  }

  if (channel === "lazada") {
    const orderItemId = value(row, ["orderItemId", "Order Item Id", "order_item_id"]);
    const orderKey = orderItemId || value(row, ["orderNumber", "Order Number", "order_id"]);
    return {
      channel,
      order_key: orderKey,
      tracking_id: value(row, ["trackingCode", "Tracking Code", "tracking_id"]) || orderKey,
      customer_name: value(row, ["customerName", "Customer Name", "ชื่อลูกค้า"]),
      shipping_provider_code: providerCode(value(row, ["shippingProvider", "Shipment Provider", "ขนส่ง"]), channel),
      items: [{
        sku: value(row, ["sellerSku", "Seller SKU", "sku"]),
        product_name: value(row, ["itemName", "Product Name", "ชื่อสินค้า"]),
        quantity_required: quantity(value(row, ["quantity", "Quantity", "จำนวน"]), 1)
      }]
    };
  }

  if (channel === "tiktok") {
    const orderKey = value(row, ["Order ID", "order_id"]);
    return {
      channel,
      order_key: orderKey,
      tracking_id: value(row, ["Tracking ID", "tracking_id"]) || orderKey,
      customer_name: value(row, ["Recipient", "Customer Name", "ชื่อลูกค้า"]),
      shipping_provider_code: providerCode(value(row, ["Shipping Provider", "Delivery Option", "ขนส่ง"]), channel),
      items: [{
        sku: value(row, ["Seller SKU", "sku"]),
        product_name: value(row, ["Product Name", "ชื่อสินค้า"]),
        quantity_required: quantity(value(row, ["Quantity", "จำนวน"]))
      }]
    };
  }

  const orderKey = value(row, ["เลขที่ใบสั่งจอง", "reservation_no", "Order ID", "order_id"]);
  return {
    channel,
    order_key: orderKey,
    tracking_id: value(row, ["Tracking", "tracking_id", "หมายเลขติดตามพัสดุ"]) || orderKey,
    customer_name: value(row, ["ชื่อลูกค้า", "Customer Name", "customer_name"]),
    shipping_provider_code: providerCode(value(row, ["ขนส่ง", "Shipping Provider"]), channel),
    items: [{
      sku: value(row, ["รหัสสินค้า", "SKU", "sku"]),
      product_name: value(row, ["ชื่อสินค้า", "Product Name"]),
      quantity_required: quantity(value(row, ["จำนวน", "Quantity", "qty"]))
    }]
  };
}
