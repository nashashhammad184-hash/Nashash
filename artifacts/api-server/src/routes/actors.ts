import { Router, type IRouter } from "express";
import { db, actorsTable } from "@workspace/db";
import { ListActorsResponse } from "@workspace/api-zod";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/actors", async (req, res): Promise<void> => {
  const typeFilter = req.query["type"] as string | undefined;
  const actors = typeFilter
    ? await db.select().from(actorsTable).where(eq(actorsTable.type, typeFilter))
    : await db.select().from(actorsTable).orderBy(actorsTable.id);
  res.json(ListActorsResponse.parse(actors));
});

export default router;
