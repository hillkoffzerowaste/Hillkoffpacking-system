function value(row, names) {
  for (const name of names) {
    const item = row[name];
    if (item !== undefined && item !== null && String(item).trim() !== "") return String(item).trim();
  }
  return "";
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

export async function parseImportFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    return parseCsv(await file.text());
  }

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    throw new Error("Firebase import currently supports CSV. Please save the spreadsheet as CSV and import again.");
  }

  throw new Error("Firebase import supports CSV files.");
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
