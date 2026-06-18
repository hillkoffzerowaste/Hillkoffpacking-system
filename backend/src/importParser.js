import fs from "node:fs/promises";
import { parse } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";
import JSZip from "jszip";

function decodeXml(valueText) {
  return String(valueText || "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function textFromXml(xml) {
  return [...String(xml || "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function xmlAttribute(tag, name) {
  const match = String(tag || "").match(new RegExp(`${name}="([^"]*)"`, "i"));
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

function parseRelationships(xml) {
  return [...String(xml || "").matchAll(/<Relationship\b[^>]*>/gi)].reduce((map, match) => {
    const tag = match[0];
    const id = xmlAttribute(tag, "Id");
    if (id) map[id] = { target: xmlAttribute(tag, "Target"), type: xmlAttribute(tag, "Type") };
    return map;
  }, {});
}

function parseSharedStrings(xml) {
  return [...String(xml || "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)]
    .map((match) => textFromXml(match[1]));
}

function excelColumnIndex(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function excelRowIndex(ref) {
  const number = String(ref || "").match(/\d+/)?.[0] || "1";
  return Math.max(0, Number.parseInt(number, 10) - 1);
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi;
  for (const match of String(xml || "").matchAll(cellPattern)) {
    const attrs = match[1] || match[3] || "";
    const body = match[2] || "";
    const ref = xmlAttribute(attrs, "r");
    const type = xmlAttribute(attrs, "t");
    const rawValue = body.match(/<v>([\s\S]*?)<\/v>/i)?.[1] ?? "";
    let cellValue = "";

    if (type === "s") cellValue = sharedStrings[Number.parseInt(rawValue, 10)] ?? "";
    else if (type === "inlineStr") cellValue = textFromXml(body);
    else cellValue = decodeXml(rawValue);

    if (!rows[excelRowIndex(ref)]) rows[excelRowIndex(ref)] = [];
    rows[excelRowIndex(ref)][excelColumnIndex(ref)] = cellValue;
  }
  return rows.map((row) => row || []);
}

async function parseXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  const workbookRelsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
  if (!workbookXml || !workbookRelsXml) throw new Error("Excel file could not be read.");

  const relationships = parseRelationships(workbookRelsXml);
  const sharedStringsRel = Object.values(relationships).find((relationship) => relationship.type.includes("/sharedStrings"));
  const sharedStringsPath = sharedStringsRel
    ? normalizeZipPath("xl/workbook.xml", sharedStringsRel.target)
    : "xl/sharedStrings.xml";
  const sharedStringsXml = await zip.file(sharedStringsPath)?.async("text");
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
  const sheetTags = [...String(workbookXml).matchAll(/<sheet\b[^>]*>/gi)].map((match) => match[0]);
  const worksheetRelationships = Object.values(relationships)
    .filter((relationship) => relationship.type.includes("/worksheet"));
  const sheetCandidates = sheetTags.length
    ? sheetTags.map((tag) => {
      const relationshipId = xmlAttribute(tag, "r:id") || xmlAttribute(tag, "id");
      return relationships[relationshipId];
    })
    : worksheetRelationships;
  const sheets = [];

  for (const relationship of sheetCandidates) {
    if (!relationship?.target) continue;
    const worksheetPath = normalizeZipPath("xl/workbook.xml", relationship.target);
    const worksheetXml = await zip.file(worksheetPath)?.async("text");
    if (worksheetXml) sheets.push(parseWorksheetRows(worksheetXml, sharedStrings));
  }

  if (!sheets.length) throw new Error("Excel worksheet could not be found.");
  return sheets;
}

function normalizedHeader(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9ก-๙]+/g, "");
}

function headerScore(row) {
  const joined = (row || []).map(normalizedHeader).join(" ");
  const groups = [
    ["orderid", "ordernumber", "ordersn", "หมายเลขคำสั่งซื้อ", "เลขที่ใบสั่งจอง"],
    ["tracking", "trackingcode", "trackingnumber", "หมายเลขติดตามพัสดุ"],
    ["sku", "sellersku", "รหัสสินค้า"],
    ["quantity", "qty", "จำนวน"],
    ["barcode", "บาร์โค้ด"]
  ];
  return groups.filter((patterns) => patterns.some((pattern) => joined.includes(normalizedHeader(pattern)))).length;
}

function rowsToRecords(rows) {
  const normalizedRows = rows
    .filter((row) => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));
  const detectedHeaderIndex = normalizedRows.findIndex((row) => headerScore(row) >= 2);
  const headerIndex = detectedHeaderIndex >= 0 ? detectedHeaderIndex : 0;
  const headers = normalizedRows[headerIndex] || [];
  return cleanRecords(normalizedRows.slice(headerIndex + 1).map((row) => {
    return headers.reduce((record, header, index) => {
      if (header) record[header] = row[index] || "";
      return record;
    }, {});
  }).filter((record) => Object.values(record).some((item) => item !== "")));
}

function selectBestWorksheet(sheets) {
  const candidates = (sheets || []).map((rows) => {
    const records = rowsToRecords(rows);
    const score = headerScore(Object.keys(records[0] || {})) * 100000 + records.length;
    return { records, score };
  }).filter((candidate) => candidate.records.length);
  return candidates.sort((left, right) => right.score - left.score)[0]?.records || [];
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

export async function parseImportFile(file) {
  const buffer = await fs.readFile(file.path);
  const lowerName = file.originalname.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    return cleanRecords(parse(buffer, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true
    }));
  }

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    let records;
    try {
      records = selectBestWorksheet(await parseXlsx(buffer));
    } catch (_error) {
      const workbook = await readXlsxFile(buffer);
      const sheets = Array.isArray(workbook) && workbook[0]?.data
        ? workbook.map((sheet) => sheet.data)
        : [workbook];
      records = selectBestWorksheet(sheets);
    }
    if (!records.length) {
      throw new Error("Excel file contains column headers but no order data rows. Please export the orders again.");
    }
    return records;
  }

  if (lowerName.endsWith(".xps")) {
    throw new Error("XPS import requires an OCR/extraction adapter. Upload CSV/XLSX for this MVP.");
  }

  throw new Error("Unsupported file type. Please upload CSV, XLSX, XLS, or XPS.");
}
