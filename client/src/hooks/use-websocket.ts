import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "@/lib/api-config";
import { getAuthToken, getCurrentUser, subscribeAuthChanges } from "@/lib/auth";
import { getListEquipmentQueryKey, getListAlertsQueryKey, getGetMonitoringSummaryQueryKey } from "@workspace/api-client-react";
import type { NetworkMonitoringSnapshot } from "@/types/monitoring";

let socket: Socket | null = null;
let socketToken: string | null = null;
let socketUserId: number | null = null;

function synchronizeSocketAuthentication(): void {
  const token = getAuthToken();
  const userId = token ? getCurrentUser()?.id ?? null : null;
  if (!socket) {
    socket = io(API_BASE_URL ?? undefined, {
      path: "/ws/socket.io",
      transports: ["websocket", "polling"],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      autoConnect: false,
      auth: token ? { token } : {},
    });
    socketToken = token;
    socketUserId = userId;
    if (token) socket.connect();
    return;
  }

  if (token === socketToken && userId === socketUserId) return;
  socketToken = token;
  socketUserId = userId;
  socket.auth = token ? { token } : {};
  socket.disconnect();
  if (token) socket.connect();
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [telemetry, setTelemetry] = useState<NetworkMonitoringSnapshot | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    synchronizeSocketAuthentication();
    const activeSocket = socket;
    if (!activeSocket) return;
    const unsubscribeAuthChanges = subscribeAuthChanges(synchronizeSocketAuthentication);

    const onConnect = () => {
      setIsConnected(true);
      queryClient.invalidateQueries({ queryKey: ["network-monitoring-overview"] });
    };
    const onDisconnect = () => setIsConnected(false);

    const onEquipmentStatus = () => {
      queryClient.invalidateQueries({ queryKey: getListEquipmentQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMonitoringSummaryQueryKey() });
    };

    const onNewAlert = () => {
      queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMonitoringSummaryQueryKey() });
    };

    const onRecovered = () => {
      queryClient.invalidateQueries({ queryKey: getListEquipmentQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMonitoringSummaryQueryKey() });
    };
    const onTelemetry = (snapshot: NetworkMonitoringSnapshot) => setTelemetry(snapshot);

    activeSocket.on("connect", onConnect);
    activeSocket.on("disconnect", onDisconnect);
    activeSocket.on("equipment:status", onEquipmentStatus);
    activeSocket.on("alert:new", onNewAlert);
    activeSocket.on("equipment:recovered", onRecovered);
    activeSocket.on("monitoring:telemetry", onTelemetry);

    if (activeSocket.connected) setIsConnected(true);

    return () => {
      activeSocket.off("connect", onConnect);
      activeSocket.off("disconnect", onDisconnect);
      activeSocket.off("equipment:status", onEquipmentStatus);
      activeSocket.off("alert:new", onNewAlert);
      activeSocket.off("equipment:recovered", onRecovered);
      activeSocket.off("monitoring:telemetry", onTelemetry);
      unsubscribeAuthChanges();
    };
  }, [queryClient]);

  return { isConnected, telemetry };
}
