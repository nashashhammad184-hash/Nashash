import "./loadEnv";
import express from "express";
import cors from "cors";
import compression from "compression";
import path from "node:path";
import fs from "node:fs";
import { rateLimiterShield } from "./lib/securityMiddleware";
import router from "./routes/index";
import { startProductionWorker } from "./lib/productionEngine";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(compression());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use("/api", rateLimiterShield, router);

const STORAGE_ROOT = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}
app.use("/uploads", express.static(STORAGE_ROOT));

const studioPublicPath = path.resolve(process.cwd(), "artifacts/studio/dist/public");
const sandboxPublicPath = path.resolve(process.cwd(), "artifacts/mockup-sandbox/dist/public");

if (fs.existsSync(sandboxPublicPath)) {
  app.use("/mockup-assets", express.static(path.join(sandboxPublicPath, "assets")));
  app.use("/mockup", express.static(sandboxPublicPath));
}
if (fs.existsSync(studioPublicPath)) {
  app.use("/assets", express.static(path.join(studioPublicPath, "assets")));
  app.use(express.static(studioPublicPath));
}

app.get("/*splat", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "API Route not found" });
  }
  if (req.path.startsWith("/mockup") && fs.existsSync(path.join(sandboxPublicPath, "index.html"))) {
    return res.sendFile(path.join(sandboxPublicPath, "index.html"));
  }
  const studioIndex = path.join(studioPublicPath, "index.html");
  if (fs.existsSync(studioIndex)) {
    return res.sendFile(studioIndex);
  }
  res.status(200).send("Kayan AI Studio is online.");
});

app.listen(port, () => {
  console.log(`🎬 Cinematic Production Server running with CORS enabled on port ${port}`);
  startProductionWorker();
});
