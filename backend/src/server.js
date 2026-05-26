import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { router } from "./routes.js";
import { seedReferenceData } from "./seed.js";

migrate();
seedReferenceData();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/api", router);

app.listen(config.port, () => {
  console.log(`Hillkoff packing backend listening on http://localhost:${config.port}`);
});

