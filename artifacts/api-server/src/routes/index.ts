import { Router, type IRouter } from "express";
import healthRouter from "./health";
import actorsRouter from "./actors";
import worldsRouter from "./worlds";
import projectsRouter from "./projects";
import scriptsRouter from "./scripts";
import shotsRouter from "./shots";
import tasksRouter from "./tasks";
import clipsRouter from "./clips";
import studioRouter from "./studio";
import videoRouter from "./video";
import episodesRouter from "./episodes";
import audioRouter from "./audio";

const router: IRouter = Router();

router.use(healthRouter);
router.use(actorsRouter);
router.use(worldsRouter);
router.use(projectsRouter);
router.use(scriptsRouter);
router.use(shotsRouter);
router.use(tasksRouter);
router.use(clipsRouter);
router.use(studioRouter);
router.use(videoRouter);
router.use(episodesRouter);
router.use(audioRouter);

export default router;
