import JSZip from "jszip";

function normalizeKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9ก-๙]+/g, "");
}

function value(row, names) {
  for (const name of names) {
    const item = row[name];
    if (item !== undefined && item !== null && String(item).trim() !== "") return String(item).trim();
  }

  const entries = Object.entries(row || {});
  for (const name of names) {
    const wanted = normalizeKey(name);
    if (wanted.length < 4) continue;
    const found = entries.find(([key, item]) => {
      if (item === undefined || item === null || String(item).trim() === "") return false;
      const candidate = normalizeKey(key);
      return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
    });
    if (found) return String(found[1]).trim();
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

function channelScoreFromHeaders(headers, fileName = "") {
  const joined = [...headers, fileName].map(normalizeKey).join(" ");
  const includesAny = (patterns) => patterns.some((pattern) => joined.includes(normalizeKey(pattern)));
  return {
    lazada: [
      includesAny(["orderItemId"]),
      includesAny(["orderNumber"]),
      includesAny(["trackingCode"]),
      includesAny(["sellerSku"]),
      includesAny(["lazada"])
    ].filter(Boolean).length,
    shopee: [
      includesAny(["หมายเลขคำสั่งซื้อ", "Order SN"]),
      includesAny(["หมายเลขติดตามพัสดุ", "Tracking Number"]),
      includesAny(["เลขอ้างอิง SKU", "SKU Reference No."]),
      includesAny(["ชื่อผู้ใช้", "Shopee"])
    ].filter(Boolean).length,
    tiktok: [
      includesAny(["Order ID"]),
      includesAny(["Tracking ID"]),
      includesAny(["Seller SKU"]),
      includesAny(["SKU ID"]),
      includesAny(["TikTok"])
    ].filter(Boolean).length,
    reservation: [
      includesAny(["เลขที่ใบสั่งจอง", "reservation_no"]),
      includesAny(["รหัสสินค้า"]),
      includesAny(["ใบสั่งจอง"])
    ].filter(Boolean).length
  };
}

function cleanRecords(records) {
  return (records || []).filter((record) => {
    const text = Object.values(record || {}).join(" ").toLowerCase();
    const instructionHits = [
      "platform unique order id",
      "current order status",
      "seller sku input",
      "platform product name",
      "sku sold quantity",
      "tracking number"
    ].filter((hint) => text.includes(hint)).length;
    return instructionHits < 2;
  });
}

export function detectImportChannel(records, fileName = "") {
  const headerSet = new Set();
  for (const record of records || []) {
    Object.keys(record || {}).forEach((key) => headerSet.add(key));
    if (headerSet.size >= 80) break;
  }

  const scores = channelScoreFromHeaders([...headerSet], fileName);
  const [bestChannel, bestScore] = Object.entries(scores)
    .sort((left, right) => right[1] - left[1])[0] || ["reservation", 0];

  if (bestScore <= 0) return "reservation";
  return bestChannel;
}

function looksLikeHeader(line, channel) {
  const lower = line.toLowerCase();
  const channelHints = {
    shopee: ["หมายเลข", "sku", "จำนวน", "tracking"],
    lazada: ["ordernumber", "orderitemid", "sellersku", "trackingcode"],
    tiktok: ["order id", "seller sku", "quantity", "tracking id"],
    reservation: ["ใบสั่งจอง", "รหัสสินค้า", "จำนวน", "customer"]
  };
  const hintCount = (channelHints[channel] || [])
    .filter((hint) => lower.includes(hint.toLowerCase()))
    .length;
  return hintCount >= 2 || (hintCount === 1 && splitColumns(line).length >= 3);
}

function splitColumns(line) {
  return String(line || "")
    .split(/\t| {2,}|\s\|\s|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function guessShippingProvider(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("j&t") || lower.includes("jnt")) return "J&T Express";
  if (lower.includes("spx") || lower.includes("shopee express")) return "SPX";
  if (lower.includes("lex") || lower.includes("lazada")) return "LEX TH";
  if (lower.includes("flash")) return "Flash Express";
  if (lower.includes("kerry")) return "Kerry Express";
  if (lower.includes("ไปรษณีย์") || lower.includes("ems")) return "Thailand Post";
  return "";
}

function xpsFallbackRow(text, channel) {
  const compactText = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  const normalizedText = compactText.replace(/\s+/g, " ");
  const tracking = firstMatch(compactText, [
    /(?:tracking[ \t]*(?:id|code|number|no\.?)|เลข(?:พัสดุ|ติดตาม)[^A-Z0-9\n]*)[:： \t-]*([A-Z0-9][A-Z0-9-]{7,})/i,
    /\b(TH\d{8,}|[A-Z]{2}\d{9}[A-Z]{2}|[A-Z0-9]{10,})\b/i
  ]);
  const order = firstMatch(compactText, [
    /(?:order[ \t]*(?:id|number|no\.?)|หมายเลขคำสั่งซื้อ|เลขที่ใบสั่งจอง)[^A-Z0-9\n]*[:： \t-]*([A-Z0-9][A-Z0-9-]{4,})/i,
    /\b((?:OD|ORDER|SO|PO)[-A-Z0-9]{5,})\b/i
  ]);
  const sku = firstMatch(compactText, [
    /(?:seller[ \t]*sku|sku[ \t]*(?:reference[ \t]*no\.?)?|รหัสสินค้า)[^A-Z0-9\n]*[:： \t-]*([A-Z0-9][A-Z0-9._/-]{1,})/i,
    /\bSKU[-_:/ \t]*([A-Z0-9][A-Z0-9._/-]{1,})\b/i
  ]);
  const productName = firstMatch(compactText, [
    /(?:product\s*name|item\s*name|สินค้า)[^:\n]*[:：]\s*([^\n]+)/i
  ]);
  const quantityValue = firstMatch(compactText, [
    /(?:quantity|qty|จำนวน)[^\d\n]{0,16}(\d{1,4})/i,
    /(?:x|×)\s*(\d{1,4})\b/i
  ]) || "1";
  const customerName = firstMatch(compactText, [
    /(?:recipient|customer(?:\s*name)?|ship\s*to|ผู้รับ|ชื่อลูกค้า)[^:\n]*[:：]\s*([^\n]+)/i
  ]);
  const shippingProvider = guessShippingProvider(normalizedText);
  const rawText = compactText.slice(0, 1800);

  if (channel === "lazada") {
    return {
      orderNumber: order || tracking,
      trackingCode: tracking || order,
      sellerSku: sku,
      itemName: productName,
      quantity: quantityValue,
      customerName,
      shippingProvider,
      "Raw Text": rawText
    };
  }

  if (channel === "tiktok") {
    return {
      "Order ID": order || tracking,
      "Tracking ID": tracking || order,
      "Seller SKU": sku,
      "Product Name": productName,
      Quantity: quantityValue,
      Recipient: customerName,
      "Shipping Provider": shippingProvider,
      "Raw Text": rawText
    };
  }

  if (channel === "reservation") {
    return {
      reservation_no: order || tracking,
      tracking_id: tracking || order,
      SKU: sku,
      "Product Name": productName,
      Quantity: quantityValue,
      "Customer Name": customerName,
      "Shipping Provider": shippingProvider,
      "Raw Text": rawText
    };
  }

  return {
    "Order ID": order || tracking,
    "Tracking Number": tracking || order,
    "SKU Reference No.": sku,
    "Product Name": productName,
    Quantity: quantityValue,
    "Customer Name": customerName,
    "Shipping Provider": shippingProvider,
    "Raw Text": rawText
  };
}

function xpsTextToRows(text, channel) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headerIndex = lines.findIndex((line) => looksLikeHeader(line, channel));
  if (headerIndex < 0) {
    return [xpsFallbackRow(text, channel)];
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
    return [xpsFallbackRow(text, channel)];
  }

  return rows;
}

async function parseXps(file, channel) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const pageFiles = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .filter((entry) => /\.(fpage|xml)$/i.test(entry.name))
    .filter((entry) => !/\[(content_types)\]|\.rels|metadata|resources/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

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

  const headers = rows[0]?.map((header, index) => {
    const cleanHeader = String(header || "").trim();
    return index === 0 ? cleanHeader.replace(/^\uFEFF/, "") : cleanHeader;
  }) || [];
  return cleanRecords(rows.slice(1)
    .map((row) => headers.reduce((record, header, index) => {
      if (header) record[header] = String(row[index] || "").trim();
      return record;
    }, {}))
    .filter((record) => Object.values(record).some(Boolean)));
}

function csvValue(valueText) {
  const valueString = String(valueText ?? "");
  if (/[",\r\n]/.test(valueString)) {
    return `"${valueString.replaceAll("\"", "\"\"")}"`;
  }
  return valueString;
}

export function recordsToCsv(records) {
  const headers = [...records.reduce((set, record) => {
    Object.keys(record || {}).forEach((key) => set.add(key));
    return set;
  }, new Set())];

  if (!headers.length) {
    throw new Error("No columns were found for CSV conversion.");
  }

  const lines = [
    headers.map(csvValue).join(","),
    ...records.map((record) => headers.map((header) => csvValue(record?.[header] || "")).join(","))
  ];
  return `\uFEFF${lines.join("\r\n")}`;
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

  return cleanRecords(records);
}

function xmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function normalizeZipPath(basePath, targetPath) {
  if (!targetPath) return "";
  if (targetPath.startsWith("/")) return targetPath.slice(1);
  const baseParts = basePath.split("/");
  baseParts.pop();
  for (const part of targetPath.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}

function excelColumnIndex(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function excelRowIndex(ref) {
  const row = Number.parseInt(String(ref || "").match(/\d+/)?.[0] || "1", 10);
  return Number.isFinite(row) && row > 0 ? row - 1 : 0;
}

function textFromXml(fragment) {
  return [...String(fragment || "").matchAll(/<[^:>]*:?t(?:\s[^>]*)?>([\s\S]*?)<\/[^:>]*:?t>/gi)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function parseRelationships(xml) {
  return [...String(xml || "").matchAll(/<Relationship\b[^>]*>/gi)].reduce((map, match) => {
    const tag = match[0];
    const id = xmlAttribute(tag, "Id");
    if (id) {
      map[id] = {
        target: xmlAttribute(tag, "Target"),
        type: xmlAttribute(tag, "Type")
      };
    }
    return map;
  }, {});
}

function parseSharedStrings(xml) {
  return [...String(xml || "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)]
    .map((match) => textFromXml(match[1]));
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi;
  for (const match of String(xml || "").matchAll(cellPattern)) {
    const attrs = match[1] || match[3] || "";
    const body = match[2] || "";
    const ref = xmlAttribute(attrs, "r");
    const type = xmlAttribute(attrs, "t");
    const rowIndex = excelRowIndex(ref);
    const columnIndex = excelColumnIndex(ref);
    const rawValue = body.match(/<v>([\s\S]*?)<\/v>/i)?.[1] ?? "";
    let cellValue = "";

    if (type === "s") {
      cellValue = sharedStrings[Number.parseInt(rawValue, 10)] ?? "";
    } else if (type === "inlineStr") {
      cellValue = textFromXml(body);
    } else {
      cellValue = decodeXml(rawValue);
    }

    if (!rows[rowIndex]) rows[rowIndex] = [];
    rows[rowIndex][columnIndex] = cellValue;
  }
  return rows.map((row) => row || []);
}

async function parseExcel(file, channel) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const workbookPath = "xl/workbook.xml";
  const workbookXml = await zip.file(workbookPath)?.async("text");
  const workbookRelsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");

  if (!workbookXml || !workbookRelsXml) {
    throw new Error("Excel file could not be read. Please save it again as .xlsx and try importing again.");
  }

  const firstSheetTag = String(workbookXml).match(/<sheet\b[^>]*>/i)?.[0] || "";
  const firstSheetRelId = xmlAttribute(firstSheetTag, "r:id") || xmlAttribute(firstSheetTag, "id");
  const relationships = parseRelationships(workbookRelsXml);
  const firstSheetRel = relationships[firstSheetRelId] || Object.values(relationships)
    .find((relationship) => relationship.type.includes("/worksheet"));
  const worksheetPath = normalizeZipPath("xl/workbook.xml", firstSheetRel?.target || "worksheets/sheet1.xml");
  const worksheetXml = await zip.file(worksheetPath)?.async("text");

  if (!worksheetXml) {
    throw new Error("Excel worksheet could not be found. Please keep the order data in the first sheet and try again.");
  }

  const sharedStringsRel = Object.values(relationships).find((relationship) => relationship.type.includes("/sharedStrings"));
  const sharedStringsPath = sharedStringsRel
    ? normalizeZipPath("xl/workbook.xml", sharedStringsRel.target)
    : "xl/sharedStrings.xml";
  const sharedStringsXml = await zip.file(sharedStringsPath)?.async("text");
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
  const rows = parseWorksheetRows(worksheetXml, sharedStrings);

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

export async function parseImportFileAuto(file) {
  const rows = await parseImportFile(file, "shopee");
  const channel = detectImportChannel(rows, file.name);
  return { rows, channel };
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
      shipping_option: value(row, ["ตัวเลือกการจัดส่ง", "วิธีการจัดส่ง", "Shipping Option", "Delivery Option"]),
      items: [{
        sku: value(row, ["เลขอ้างอิง Parent SKU", "Parent SKU", "เลขอ้างอิง SKU", "เลขอ้างอิง SKU (SKU Reference No.)", "SKU Reference No.", "sku"]),
        product_name: value(row, ["ชื่อสินค้า", "Product Name"]),
        quantity_required: quantity(value(row, ["จำนวน", "Quantity", "qty"]))
      }]
    };
  }

  if (channel === "lazada") {
    const orderItemId = value(row, ["orderItemId", "Order Item Id", "order_item_id"]);
    const orderKey = value(row, ["orderNumber", "Order Number", "order_id"]) || orderItemId;
    return {
      channel,
      order_key: orderKey,
      order_item_id: orderItemId,
      tracking_id: value(row, ["trackingCode", "Tracking Code", "tracking_id"]) || orderKey,
      customer_name: value(row, ["customerName", "Customer Name", "ชื่อลูกค้า"]),
      shipping_provider_code: providerCode(value(row, ["shippingProvider", "Shipment Provider", "ขนส่ง"]), channel),
      shipping_option: value(row, ["deliveryType", "shipmentTypeName", "shippingProviderType", "Delivery Option", "Shipping Option"]),
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
      customer_name: value(row, ["Recipient", "Recipient Name", "Buyer Username", "Customer Name", "ชื่อลูกค้า"]),
      shipping_provider_code: providerCode(value(row, ["Shipping Provider Name", "Shipping Provider", "Delivery Option", "ขนส่ง"]), channel),
      shipping_option: value(row, ["Delivery Option", "Fulfillment Type", "Shipping Type"]),
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
    shipping_option: value(row, ["ตัวเลือกการจัดส่ง", "วิธีการจัดส่ง", "Delivery Option", "Shipping Option"]),
    items: [{
      sku: value(row, ["รหัสสินค้า", "SKU", "sku"]),
      product_name: value(row, ["ชื่อสินค้า", "Product Name"]),
      quantity_required: quantity(value(row, ["จำนวน", "Quantity", "qty"]))
    }]
  };
}
