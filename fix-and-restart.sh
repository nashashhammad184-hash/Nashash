#!/bin/bash
set -e

echo "1️⃣ تحديث ملف routes/projects.ts..."
cat << 'ROUTE_EOF' > artifacts/api-server/src/routes/projects.ts
import { Router } from "express";
import { db, projectsTable, projectActorsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

router.get(["/projects", "/api/projects", "/"], async (req, res) => {
  try {
    const isArchived = req.query["archived"];
    const q = isArchived !== undefined
      ? db.select().from(projectsTable).where(eq(projectsTable.isArchived, isArchived === "true")).orderBy(desc(projectsTable.createdAt))
      : db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
    const list = await q;
    res.json(list.map(p => ({
      ...p,
      createdAt: p.createdAt ? p.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: p.updatedAt ? p.updatedAt.toISOString() : (p.createdAt ? p.createdAt.toISOString() : new Date().toISOString())
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post(["/projects", "/api/projects", "/"], async (req, res) => {
  try {
    const { title, worldId, synopsis, projectType, style } = req.body || {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Title required" });
    }
    const [p] = await db.insert(projectsTable).values({
      title: title.trim(),
      worldId: worldId || "drama",
      synopsis: synopsis ? String(synopsis).trim() : null,
      projectType: projectType || "film",
      style: style || "drama",
      status: "development",
      isArchived: false
    }).returning();
    
    res.status(201).json({
      ...p,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.createdAt.toISOString()
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/projects/:id", async (req, res) => {
  try {
    const [p] = await db.select().from(projectsTable).where(eq(projectsTable.id, Number(req.params.id)));
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json({ ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt ? p.updatedAt.toISOString() : p.createdAt.toISOString() });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.patch("/projects/:id", async (req, res) => {
  try {
    const [p] = await db.update(projectsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(projectsTable.id, Number(req.params.id))).returning();
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json({ ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt ? p.updatedAt.toISOString() : p.createdAt.toISOString() });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
ROUTE_EOF

echo "2️⃣ إعادة بناء الـ Backend والـ Frontend..."
npm run build || pnpm run build || true

echo "3️⃣ إعادة تشغيل عملية السيرفر بالكامل..."
if command -v pm2 &> /dev/null; then
  pm2 restart all || pm2 start npm --name "kayan-server" -- start
else
  # إيقاف أي عملية قديمة تعمل على بورت 3000
  fuser -k 3000/tcp 2>/dev/null || kill -9 $(lsof -t -i:3000 2>/dev/null) 2>/dev/null || true
  sleep 1
  nohup npm start > server.log 2>&1 &
fi

sleep 3

echo "4️⃣ اختبار الرابط الآن للتأكد:"
curl -i -X POST http://127.0.0.1:3000/api/projects -H "Content-Type: application/json" -d '{"title":"مشروع تجريبي ناجح","synopsis":"تم الحل","worldId":"drama"}'

