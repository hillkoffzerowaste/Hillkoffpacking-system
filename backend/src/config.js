import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  dbPath: process.env.DB_PATH || (
    process.env.VERCEL
      ? path.resolve(process.env.TEMP || "/tmp", "hillkoff-packing.db")
      : path.resolve(__dirname, "../data/packing.db")
  ),
  uploadsDir: process.env.UPLOADS_DIR || (
    process.env.VERCEL
      ? path.resolve(process.env.TEMP || "/tmp", "hillkoff-uploads")
      : path.resolve(__dirname, "../uploads")
  ),
  publicApiUrl: process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 4000}/api`,
  integrationTokenKey: process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || ""
};

