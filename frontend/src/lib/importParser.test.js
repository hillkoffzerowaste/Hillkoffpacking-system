import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { parseImportFileAuto } from "./importParser.js";

function inlineCell(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

async function workbookWithCoverSheet() {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="Instructions" sheetId="1" r:id="rId1"/>
        <sheet name="Orders" sheetId="2" r:id="rId2"/>
      </sheets>
    </workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships>
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
    </Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet><sheetData>
      <row r="1">${inlineCell("A1", "Marketplace export instructions")}</row>
      <row r="2">${inlineCell("A2", "Do not edit this sheet")}</row>
    </sheetData></worksheet>`);
  zip.file("xl/worksheets/sheet2.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet><sheetData>
      <row r="1">
        ${inlineCell("A1", "Order ID")}
        ${inlineCell("B1", "Tracking Number")}
        ${inlineCell("C1", "SKU Reference No.")}
        ${inlineCell("D1", "Quantity")}
      </row>
      <row r="2">
        ${inlineCell("A2", "SHP-1001")}
        ${inlineCell("B2", "SPX-1001")}
        ${inlineCell("C2", "SKU-001")}
        ${inlineCell("D2", "2")}
      </row>
    </sheetData></worksheet>`);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return {
    name: "orders-with-cover.xlsx",
    arrayBuffer: async () => bytes.buffer
  };
}

test("selects the worksheet containing order data instead of the first sheet", async () => {
  const parsed = await parseImportFileAuto(await workbookWithCoverSheet());

  assert.equal(parsed.channel, "shopee");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]["Order ID"], "SHP-1001");
  assert.equal(parsed.rows[0]["SKU Reference No."], "SKU-001");
});

test("reports an exported workbook that contains headers but no orders", async () => {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
    <sheet name="Orders" sheetId="1" r:id="rId1"/>
  </sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<Relationships>
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  </Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData><row r="1">
    ${inlineCell("A1", "Order ID")}
    ${inlineCell("B1", "Tracking Number")}
    ${inlineCell("C1", "SKU Reference No.")}
    ${inlineCell("D1", "Quantity")}
  </row></sheetData></worksheet>`);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const file = { name: "empty-orders.xlsx", arrayBuffer: async () => bytes.buffer };

  await assert.rejects(() => parseImportFileAuto(file), /ไม่มีรายการออเดอร์/);
});
