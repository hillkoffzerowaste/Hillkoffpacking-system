import fs from "node:fs/promises";
import { parse } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";
import JSZip from "jszip";

function decodeXml(valueText) {
  return String(valueText || "")
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

  const firstSheetTag = String(workbookXml).match(/<sheet\b[^>]*>/i)?.[0] || "";
  const firstSheetRelId = xmlAttribute(firstSheetTag, "r:id") || xmlAttribute(firstSheetTag, "id");
  const relationships = parseRelationships(workbookRelsXml);
  const firstSheetRel = relationships[firstSheetRelId] || Object.values(relationships)
    .find((relationship) => relationship.type.includes("/worksheet"));
  const worksheetPath = normalizeZipPath("xl/workbook.xml", firstSheetRel?.target || "worksheets/sheet1.xml");
  const worksheetXml = await zip.file(worksheetPath)?.async("text");
  if (!worksheetXml) throw new Error("Excel worksheet could not be found.");

  const sharedStringsRel = Object.values(relationships).find((relationship) => relationship.type.includes("/sharedStrings"));
  const sharedStringsPath = sharedStringsRel
    ? normalizeZipPath("xl/workbook.xml", sharedStringsRel.target)
    : "xl/sharedStrings.xml";
  const sharedStringsXml = await zip.file(sharedStringsPath)?.async("text");
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
  return parseWorksheetRows(worksheetXml, sharedStrings);
}

function rowsToRecords(rows) {
  const normalizedRows = rows
    .filter((row) => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));
  const headers = normalizedRows[0] || [];
  return cleanRecords(normalizedRows.slice(1).map((row) => {
    return headers.reduce((record, header, index) => {
      if (header) record[header] = row[index] || "";
      return record;
    }, {});
  }).filter((record) => Object.values(record).some((item) => item !== "")));
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
    try {
      return rowsToRecords(await parseXlsx(buffer));
    } catch (_error) {
      const rows = await readXlsxFile(buffer);
      return rowsToRecords(rows);
    }
  }

  if (lowerName.endsWith(".xps")) {
    throw new Error("XPS import requires an OCR/extraction adapter. Upload CSV/XLSX for this MVP.");
  }

  throw new Error("Unsupported file type. Please upload CSV, XLSX, XLS, or XPS.");
}
