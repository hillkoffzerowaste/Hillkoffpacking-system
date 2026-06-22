import cors from "cors";
import express from "express";
import { migrate } from "./db.js";
import { router } from "./routes.js";
import { seedReferenceData } from "./seed.js";

migrate();
seedReferenceData();

export const app = express();
const frontendUrl = process.env.MARKETPLACE_FRONTEND_URL
  || "https://hillkoffzerowaste.github.io/Hillkoffpacking-system/?page=marketplace";

app.use(cors());
app.use(express.json({
  limit: "5mb",
  verify: (req, _res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  }
}));
app.get("/", (_req, res) => {
  res.redirect(302, frontendUrl);
});
app.get("/api", (_req, res) => {
  res.json({
    ok: true,
    service: "hillkoff-packing-backend",
    frontend_url: frontendUrl
  });
});
app.use("/api", router);
