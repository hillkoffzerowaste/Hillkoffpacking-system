import cors from "cors";
import express from "express";
import { migrate } from "./db.js";
import { router } from "./routes.js";
import { seedReferenceData } from "./seed.js";

migrate();
seedReferenceData();

export const app = express();

app.use(cors());
app.use(express.json({
  limit: "5mb",
  verify: (req, _res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  }
}));
app.use("/api", router);
