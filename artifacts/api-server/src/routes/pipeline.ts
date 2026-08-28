import { Router } from "express";

const router = Router();

router.get("/status", async (req, res, next) => {
  try {
    res.status(200).json({ status: "active", pipeline: "production" });
    return;
  } catch (error) {
    next(error);
    return;
  }
});

export default router;
