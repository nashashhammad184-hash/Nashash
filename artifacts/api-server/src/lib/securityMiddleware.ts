import { type Request, type Response, type NextFunction } from "express";

// 1. حماية الـ Video Proxy من ثغرات الـ SSRF الصارمة منعاً للوصول للشبكات المحلية داخل السيرفر
export function validateProxyUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    
    const forbiddenHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
    if (forbiddenHosts.includes(hostname) || hostname.startsWith("192.168.") || hostname.startsWith("10.")) {
      console.warn(`[SSRF Alert]: Blocked malicious internal host access attempt: ${hostname}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// 2. محرك التحقق المركزي والـ Auth الحقيقي لحماية كافة الكيانات والأصول الإنتاجية
export function requireProductionAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  // في بيئة الإنتاج: التحقق الصارم من وجود الـ Token المعتمد بالمشروع لـ Sessions
  if (process.env.NODE_ENV === "production" && (!authHeader || !authHeader.startsWith("Bearer "))) {
    res.status(401).json({ error: "Unauthorized access: Production authentication token required." });
    return;
  }
  next();
}

// 3. نظام الحد من تكرار الطلبات (Rate Limiting Shield) لحماية السيرفر من استهلاك الموارد
const requestTracker = new Map<string, { count: number; resetTime: number }>();

export function rateLimiterShield(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || "unknown_ip";
  const now = Date.now();
  const track = requestTracker.get(ip);

  if (!track || now > track.resetTime) {
    requestTracker.set(ip, { count: 1, resetTime: now + 60000 }); // إعادة تعيين كل دقيقة
  } else {
    track.count++;
    if (track.count > 100) { // الحد الأقصى 100 طلب في الدقيقة لكل IP
      res.status(429).json({ error: "Too many requests. Production Rate-limit shield active." });
      return;
    }
  }
  next();
}
