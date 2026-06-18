export function normalizeBarcode(value) {
  if (value === undefined || value === null) return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value).trim();
  }

  const text = String(value).trim().replace(/\s+/g, "");
  if (/^\d+\.0+$/.test(text)) return text.replace(/\.0+$/, "");
  return text;
}

export function readLooseField(row, names) {
  const normalize = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9ก-๙]+/g, "");
  const entries = Object.entries(row || {});
  for (const name of names) {
    const wanted = normalize(name);
    const found = entries.find(([key, value]) => {
      if (value === undefined || value === null || String(value).trim() === "") return false;
      const candidate = normalize(key);
      return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
    });
    if (found) return String(found[1]).trim();
  }
  return "";
}

export function mapSkuImportRows(rows) {
  let previousSku = "";
  let previousProductName = "";

  return (rows || []).map((row) => {
    const rowSku = readLooseField(row, ["sku", "seller sku", "product sku", "รหัสสินค้า", "SKU"]);
    const rowProductName = readLooseField(row, ["product_name", "product name", "name", "ชื่อสินค้า"]);
    const barcode = normalizeBarcode(readLooseField(row, [
      "barcode",
      "bar code",
      "product barcode",
      "บาร์โค้ด",
      "รหัสบาร์โค้ด"
    ]));

    const carriedSku = !rowSku && rowProductName && rowProductName === previousProductName
      ? previousSku
      : "";

    if (rowSku) previousSku = rowSku;
    if (rowProductName) previousProductName = rowProductName;

    return {
      barcode,
      sku: rowSku || carriedSku,
      product_name: rowProductName || previousProductName
    };
  }).filter((row) => row.barcode && row.sku);
}
