const CHANNELS = new Set(["shopee", "lazada", "tiktok", "reservation"]);

function value(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") {
      return String(row[name]).trim();
    }
  }
  return "";
}

function quantityValue(raw, fallback = 1) {
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

export function assertChannel(channel) {
  if (!CHANNELS.has(channel)) {
    const supported = Array.from(CHANNELS).join(", ");
    throw new Error(`Unsupported channel "${channel}". Supported channels: ${supported}`);
  }
}

export function mapImportRow(row, channel) {
  assertChannel(channel);

  if (channel === "shopee") {
    const orderKey = value(row, ["หมายเลขคำสั่งซื้อ", "Order ID", "order_id"]);
    const trackingId = value(row, ["*หมายเลขติดตามพัสดุ", "หมายเลขติดตามพัสดุ", "Tracking Number", "tracking_id"]) || orderKey;
    return {
      channel,
      orderKey,
      trackingId,
      orderItemId: "",
      customerName: value(row, ["ชื่อผู้รับ", "ชื่อลูกค้า", "Customer Name"]),
      shippingProviderCode: providerCode(value(row, ["ขนส่ง", "Shipping Provider", "Logistics Channel"]), channel),
      shippingOption: value(row, ["ตัวเลือกการจัดส่ง", "วิธีการจัดส่ง", "Shipping Option", "Delivery Option"]),
      sku: value(row, ["เลขอ้างอิง Parent SKU", "Parent SKU", "เลขอ้างอิง SKU", "เลขอ้างอิง SKU (SKU Reference No.)", "SKU Reference No.", "sku"]),
      productName: value(row, ["ชื่อสินค้า", "Product Name"]),
      quantityRequired: quantityValue(value(row, ["จำนวน", "Quantity", "qty"]))
    };
  }

  if (channel === "lazada") {
    const orderItemId = value(row, ["orderItemId", "Order Item Id", "order_item_id"]);
    const orderKey = value(row, ["orderNumber", "Order Number", "order_id"]) || orderItemId;
    return {
      channel,
      orderKey,
      trackingId: value(row, ["trackingCode", "Tracking Code", "tracking_id"]) || orderKey,
      orderItemId,
      customerName: value(row, ["customerName", "Customer Name", "ชื่อลูกค้า"]),
      shippingProviderCode: providerCode(value(row, ["shippingProvider", "Shipment Provider", "ขนส่ง"]), channel),
      shippingOption: value(row, ["deliveryType", "shipmentTypeName", "shippingProviderType", "Delivery Option", "Shipping Option"]),
      sku: value(row, ["sellerSku", "Seller SKU", "sku"]),
      productName: value(row, ["itemName", "Product Name", "ชื่อสินค้า"]),
      quantityRequired: quantityValue(value(row, ["quantity", "Quantity", "จำนวน"]), 1)
    };
  }

  if (channel === "tiktok") {
    const orderKey = value(row, ["Order ID", "order_id"]);
    return {
      channel,
      orderKey,
      trackingId: value(row, ["Tracking ID", "tracking_id"]) || orderKey,
      orderItemId: "",
      customerName: value(row, ["Recipient", "Customer Name", "ชื่อลูกค้า"]),
      shippingProviderCode: providerCode(value(row, ["Shipping Provider Name", "Shipping Provider", "Delivery Option", "ขนส่ง"]), channel),
      shippingOption: value(row, ["Delivery Option", "Fulfillment Type", "Shipping Type"]),
      sku: value(row, ["Seller SKU", "sku"]),
      productName: value(row, ["Product Name", "ชื่อสินค้า"]),
      quantityRequired: quantityValue(value(row, ["Quantity", "จำนวน"]))
    };
  }

  const orderKey = value(row, ["เลขที่ใบสั่งจอง", "reservation_no", "Order ID", "order_id"]);
  return {
    channel,
    orderKey,
    trackingId: value(row, ["Tracking", "tracking_id", "หมายเลขติดตามพัสดุ"]) || orderKey,
    orderItemId: "",
    customerName: value(row, ["ชื่อลูกค้า", "Customer Name", "customer_name"]),
    shippingProviderCode: providerCode(value(row, ["ขนส่ง", "Shipping Provider"]), channel),
    shippingOption: value(row, ["ตัวเลือกการจัดส่ง", "วิธีการจัดส่ง", "Delivery Option", "Shipping Option"]),
    sku: value(row, ["รหัสสินค้า", "SKU", "sku"]),
    productName: value(row, ["ชื่อสินค้า", "Product Name"]),
    quantityRequired: quantityValue(value(row, ["จำนวน", "Quantity", "qty"]))
  };
}

export function validateMappedOrder(mapped, rowNumber) {
  const errors = [];
  if (!mapped.orderKey) errors.push("missing order key");
  if (!mapped.trackingId) errors.push("missing tracking id");
  if (!mapped.sku) errors.push("missing sku");
  if (!mapped.quantityRequired) errors.push("missing quantity");

  if (errors.length) {
    throw new Error(`Row ${rowNumber}: ${errors.join(", ")}`);
  }
}

