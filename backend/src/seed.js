import { nanoid } from "nanoid";
import { db, nowIso } from "./db.js";

export function seedReferenceData() {
  const now = nowIso();
  const providers = [
    ["JNT", "J&T Express", "J&T Express"],
    ["SPX", "SPX Express", "SPX"],
    ["LEX", "LEX TH", "LEX TH"],
    ["GENERAL", "ขนส่งทั่วไป / รถโรงงาน", "ขนส่งทั่วไป / รถโรงงาน"]
  ];

  const insertProvider = db.prepare(`
    insert or ignore into shipping_providers
      (id, code, name, display_name, active, created_at, updated_at)
    values
      (@id, @code, @name, @displayName, 1, @now, @now)
  `);

  for (const [code, name, displayName] of providers) {
    insertProvider.run({ id: nanoid(), code, name, displayName, now });
  }

  const packers = [
    ["EMP001", "EMP001", "Packer 1"],
    ["EMP002", "EMP002", "Packer 2"]
  ];

  const insertPacker = db.prepare(`
    insert or ignore into packers
      (id, employee_code, barcode, display_name, active, created_at, updated_at)
    values
      (@id, @employeeCode, @barcode, @displayName, 1, @now, @now)
  `);

  for (const [employeeCode, barcode, displayName] of packers) {
    insertPacker.run({ id: nanoid(), employeeCode, barcode, displayName, now });
  }
}

