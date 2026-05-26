import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nodesRouter from "./nodes";
import equipmentRouter from "./equipment";
import clientsRouter from "./clients";
import usersRouter from "./users";
import auditLogsRouter from "./auditLogs";
import monitoringRouter from "./monitoring";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nodesRouter);
router.use(equipmentRouter);
router.use(clientsRouter);
router.use(usersRouter);
router.use(auditLogsRouter);
router.use(monitoringRouter);
router.use(aiRouter);

export default router;
