import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { parseImportFile } from "../src/importParser.js";

function inlineCell(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

test("parses order data from a later worksheet", async () => {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
    <sheet name="Cover" sheetId="1" r:id="rId1"/>
    <sheet name="Orders" sheetId="2" r:id="rId2"/>
  </sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<Relationships>
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  </Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData>
    <row r="1">${inlineCell("A1", "Export instructions")}</row>
    <row r="2">${inlineCell("A2", "Orders are on the next sheet")}</row>
  </sheetData></worksheet>`);
  zip.file("xl/worksheets/sheet2.xml", `<worksheet><sheetData>
    <row r="1">${inlineCell("A1", "Order ID")}${inlineCell("B1", "Tracking Number")}${inlineCell("C1", "Seller SKU")}${inlineCell("D1", "Quantity")}</row>
    <row r="2">${inlineCell("A2", "ORDER-1")}${inlineCell("B2", "TRACK-1")}${inlineCell("C2", "SKU-1")}${inlineCell("D2", "2")}</row>
  </sheetData></worksheet>`);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hillkoff-xlsx-"));
  const filePath = path.join(tempDir, "orders.xlsx");
  try {
    await fs.writeFile(filePath, await zip.generateAsync({ type: "nodebuffer" }));
    const records = await parseImportFile({ path: filePath, originalname: "orders.xlsx" });
    assert.equal(records.length, 1);
    assert.equal(records[0]["Order ID"], "ORDER-1");
    assert.equal(records[0]["Seller SKU"], "SKU-1");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
