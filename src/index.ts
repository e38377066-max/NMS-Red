import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { startMonitoring, setSocketServer } from "./services/monitoring.service";
import { startBillingCron, setBillingSocketServer } from "./services/billing.service";
import { isAllowedCorsOrigin } from "./lib/cors-origins";
import { startBackupCron } from "./services/backup.service";
import { setNetworkMonitoringSocket, startNetworkMonitoring } from "./services/network-monitoring.service";
import { setTaskQueueSocket, startTaskQueue } from "./services/task-queue.service";
import { bootstrapInitialAdmin, extractUserFromRequest } from "./services/auth.service";
import { sequelize } from "./db";

const rawPort = process.env["PORT"] ?? "5000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedCorsOrigin(origin)),
    methods: ["GET", "POST"],
  },
  allowRequest: (request, callback) => callback(null, isAllowedCorsOrigin(request.headers.origin)),
  path: "/ws/socket.io",
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== "string" || token.length === 0) {
    next(new Error("Authentication required"));
    return;
  }

  try {
    const user = await extractUserFromRequest(`Bearer ${token}`);
    if (!user) {
      next(new Error("Authentication required"));
      return;
    }
    socket.data.authUser = user;
    next();
  } catch {
    next(new Error("Authentication required"));
  }
});

setSocketServer(io);
setBillingSocketServer(io);
setNetworkMonitoringSocket(io);
setTaskQueueSocket(io);

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Client connected via WebSocket");
  const sessionToken = socket.handshake.auth.token as string;
  const sessionCheck = setInterval(() => {
    void extractUserFromRequest(`Bearer ${sessionToken}`)
      .then((user) => {
        if (!user) socket.disconnect(true);
      })
      .catch(() => socket.disconnect(true));
  }, 60_000);
  sessionCheck.unref?.();

  socket.on("disconnect", () => {
    clearInterval(sessionCheck);
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
