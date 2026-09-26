import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { startMonitoring, setSocketServer } from "./services/monitoring.service";
import { startBillingCron, setBillingSocketServer } from "./services/billing.service";
import { startBackupCron } from "./services/backup.service";
import { setNetworkMonitoringSocket, startNetworkMonitoring } from "./services/network-monitoring.service";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

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

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Client connected via WebSocket");
  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Client disconnected from WebSocket");
  });
});

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  startMonitoring();
  startNetworkMonitoring();
  startBillingCron();
  startBackupCron();
});
