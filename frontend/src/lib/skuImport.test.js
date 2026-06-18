import assert from "node:assert/strict";
import test from "node:test";
import { mapSkuImportRows, normalizeBarcode } from "./skuImport.js";

test("fills down a merged SKU cell for the following barcode row", () => {
  const records = mapSkuImportRows([
    {
      "รหัสสินค้า": "IG-HK-0044",
      "ชื่อสินค้า": "ชาไทยหอมมั๊ก 500 กรัม",
      "หน่วยนับ": "10KG",
      "บาร์โค้ด": "5620"
    },
    {
      "รหัสสินค้า": "",
      "ชื่อสินค้า": "ชาไทยหอมมั๊ก 500 กรัม",
      "หน่วยนับ": "Pcs",
      "บาร์โค้ด": "8857109099860"
    }
  ]);

  assert.deepEqual(records[1], {
    barcode: "8857109099860",
    sku: "IG-HK-0044",
    product_name: "ชาไทยหอมมั๊ก 500 กรัม"
  });
});

test("normalizes numeric Excel barcodes without adding decimals", () => {
  assert.equal(normalizeBarcode(8857109099860), "8857109099860");
  assert.equal(normalizeBarcode("8857109099860.0"), "8857109099860");
  assert.equal(normalizeBarcode(" 8857109099860 "), "8857109099860");
});
