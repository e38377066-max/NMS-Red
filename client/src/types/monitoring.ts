export type LiveClientStatus = "CONNECTED" | "DISCONNECTED" | "UNKNOWN";

export interface NetworkMonitoringClient {
  id: number;
  name: string;
  ip: string | null;
  mac: string;
  equipmentId: number;
  equipmentName: string;
  status: LiveClientStatus;
  rxMbps: number | null;
  txMbps: number | null;
  signalDbm: number | null;
  noiseDbm: number | null;
  snrDb: number | null;
  ccq: number | null;
  source: "routeros-queue" | "wireless-station" | null;
  disconnectionCause: "client_or_access" | "infrastructure_equipment" | null;
}

export interface NetworkMonitoringEquipment {
  id: number;
  nodeName: string;
  model: string;
  ip: string;
  role: string;
  connectionType: string;
  status: "ONLINE" | "OFFLINE" | "UNKNOWN";
  lastCheckedAt: string | null;
  rxMbps: number | null;
  txMbps: number | null;
  signalDbm: number | null;
  noiseDbm: number | null;
  snrDb: number | null;
  ccq: number | null;
  clientCount: number;
  qualitySource: "wireless-stations" | null;
}

export interface NetworkMonitoringIncident {
  id: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
  cause: "infrastructure_equipment" | "client_or_access";
  equipmentId: number;
  clientId: number | null;
  recordedAt: string;
}

export interface NetworkMonitoringSnapshot {
  generatedAt: string;
  totals: {
    rxMbps: number | null;
    txMbps: number | null;
    totalClients: number;
    connectedClients: number;
    disconnectedClients: number;
    unknownClients: number;
    onlineEquipment: number;
    offlineEquipment: number;
    equipmentWithoutTraffic: number;
  };
  quality: {
    signalDbm: number | null;
    noiseDbm: number | null;
    snrDb: number | null;
    ccq: number | null;
    samples: number;
  };
  equipment: NetworkMonitoringEquipment[];
  clients: NetworkMonitoringClient[];
  incidents: NetworkMonitoringIncident[];
}