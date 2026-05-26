import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, Socket } from "socket.io-client";
import { getListEquipmentQueryKey, getListAlertsQueryKey, getGetMonitoringSummaryQueryKey } from "@workspace/api-client-react";

let socket: Socket | null = null;

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) {
      socket = io({
        path: "/ws/socket.io",
        transports: ["websocket", "polling"],
        reconnectionDelay: 3000,
        reconnectionAttempts: 10,
      });
    }

    const onConnect = () => setIsConnected(true);
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

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("equipment:status", onEquipmentStatus);
    socket.on("alert:new", onNewAlert);
    socket.on("equipment:recovered", onRecovered);

    if (socket.connected) setIsConnected(true);

    return () => {
      socket?.off("connect", onConnect);
      socket?.off("disconnect", onDisconnect);
      socket?.off("equipment:status", onEquipmentStatus);
      socket?.off("alert:new", onNewAlert);
      socket?.off("equipment:recovered", onRecovered);
    };
  }, [queryClient]);

  return { isConnected };
}
