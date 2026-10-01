import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { startMonitoring, setSocketServer } from "./services/monitoring.service";
import { startBillingCron, setBillingSocketServer } from "./services/billing.service";
import { startBackupCron } from "./services/backup.service";
import { setNetworkMonitoringSocket, startNetworkMonitoring } from "./services/network-monitoring.service";
import { setTaskQueueSocket, startTaskQueue } from "./services/task-queue.service";
import { bootstrapInitialAdmin } from "./services/auth.service";
import { sequelize } from "./db";

const rawPort = process.env["PORT"] ?? "5000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  path: "/ws/socket.io",
});

setSocketServer(io);
setBillingSocketServer(io);
setNetworkMonitoringSocket(io);
setTaskQueueSocket(io);

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Client connected via WebSocket");
  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Client disconnected from WebSocket");
  });
});

async function startServer() {
  await sequelize.authenticate();
  await bootstrapInitialAdmin();

  httpServer.listen(port, () => {
    logger.info({ port }, "Server listening");
    startMonitoring();
    startNetworkMonitoring();
    startTaskQueue();
    startBillingCron();
    startBackupCron();
  });
}

void startServer().catch((err) => {
  logger.error({ err }, "Server startup failed");
  process.exit(1);
});
