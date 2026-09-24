import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nodesRouter from "./nodes";
import equipmentRouter from "./equipment";
import clientsRouter from "./clients";
import usersRouter from "./users";
import auditLogsRouter from "./auditLogs";
import monitoringRouter from "./monitoring";
import aiRouter from "./ai";
import proxmoxRouter from "./proxmox";
import billingRouter from "./billing";
import backupsRouter from "./backups";
import metricsRouter from "./metrics";
import dhcpRouter from "./dhcp";
import deviceConfigRouter from "./device-config";
import securityRouter from "./security";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nodesRouter);
router.use(equipmentRouter);
router.use(clientsRouter);
router.use(billingRouter);
router.use(backupsRouter);
router.use(metricsRouter);
router.use(dhcpRouter);
router.use(deviceConfigRouter);
router.use(securityRouter);
router.use(usersRouter);
router.use(auditLogsRouter);
router.use(monitoringRouter);
router.use(aiRouter);
router.use(proxmoxRouter);

export default router;
