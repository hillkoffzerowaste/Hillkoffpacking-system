import fs from "node:fs/promises";
import { parse } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";

export async function parseImportFile(file) {
  const buffer = await fs.readFile(file.path);
  const lowerName = file.originalname.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    return parse(buffer, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true
    });
  }

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    const rows = await readXlsxFile(buffer);
    const headers = rows[0]?.map((header) => String(header || "").trim()) || [];
    return rows.slice(1).map((row) => {
      return headers.reduce((record, header, index) => {
        if (header) record[header] = row[index] === null || row[index] === undefined ? "" : String(row[index]).trim();
        return record;
      }, {});
    }).filter((record) => Object.values(record).some((item) => item !== ""));
  }

  if (lowerName.endsWith(".xps")) {
    throw new Error("XPS import requires an OCR/extraction adapter. Upload CSV/XLSX for this MVP.");
  }

  throw new Error("Unsupported file type. Please upload CSV, XLSX, XLS, or XPS.");
}
