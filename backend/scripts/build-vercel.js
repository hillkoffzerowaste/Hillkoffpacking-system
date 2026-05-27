import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendDir, "..");
const frontendDist = path.join(repoRoot, "frontend", "dist");
const backendDist = path.join(backendDir, "dist");

function run(command, cwd) {
  execSync(command, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      VERCEL: process.env.VERCEL || "1",
      VITE_BASE_PATH: process.env.VITE_BASE_PATH || "/",
      VITE_DATA_MODE: process.env.VITE_DATA_MODE || "local"
    }
  });
}

run("npm install", repoRoot);
run("npm run build -w frontend", repoRoot);

fs.rmSync(backendDist, { recursive: true, force: true });
fs.cpSync(frontendDist, backendDist, { recursive: true });

console.log(`Copied frontend build to ${backendDist}`);

