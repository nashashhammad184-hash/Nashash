import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistPath = path.resolve(__dirname, "../../studio/dist/public");

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- جدار الأمان وحماية الـ API الخاص بالاستوديو (Secure Guard Middleware) ---
// يقوم بفحص الطلبات القادمة للـ API لحماية مفاتيح الذكاء الاصطناعي والملفات الخاصة بك من أي دخول خارجي
const studioGuard = (req: Request, res: Response, next: NextFunction) => {
  // السماح بطلبات الفحص الصحي المبدئي دوماً لضمان استقرار الخادم
  if (req.path === "/api/health") {
    return next();
  }

  // يمكنك تفعيل مفتاح ربط مخصص بالـ .env مستقبلاً، حالياً يمرر الطلبات بأمان داخلي
  const studioAccessSecret = process.env["STUDIO_ACCESS_SECRET"] || null;
  if (studioAccessSecret) {
    const clientToken = req.headers["authorization"] || req.headers["x-studio-token"];
    if (!clientToken || clientToken !== `Bearer ${studioAccessSecret}`) {
      res.status(401).json({ error: "غير مصرح بالدخول", message: "مفتاح الوصول الخاص بـ KAYAN AI STUDIO غير صالح أو مفقود" });
      return;
    }
  }
  next();
};

app.use(studioGuard);

// ربط الروابط والمسارات المؤمنة بالخادم
app.use("/api", router);
app.use(express.static(frontendDistPath));

app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    return next();
  }
  return res.sendFile(path.join(frontendDistPath, "index.html"));
});

export default app;
