import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  dbPath: process.env.DB_PATH || path.resolve(__dirname, "../data/packing.db"),
  uploadsDir: process.env.UPLOADS_DIR || path.resolve(__dirname, "../uploads")
};

