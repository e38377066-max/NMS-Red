import { useGetNetworkTopology } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Network, Server, Wifi, Globe, ArrowUpDown, Radio, Eye } from "lucide-react";

type EquipmentRole = "gateway" | "core_router" | "ptp_link" | "ap_distributor" | string;

const ROLE_META: Record<string, { label: string; color: string; icon: React.ElementType; borderColor: string }> = {
  gateway: {
    label: "Gateway (Internet)",
    color: "text-cyan-400",
    icon: Globe,
    borderColor: "border-cyan-500/40 bg-cyan-500/5",
  },
  core_router: {
    label: "Router central MikroTik",
    color: "text-violet-400",
    icon: Server,
    borderColor: "border-violet-500/40 bg-violet-500/5",
  },
  ptp_link: {
    label: "Enlace Troncal PTP",
    color: "text-amber-400",
    icon: ArrowUpDown,
    borderColor: "border-amber-500/40 bg-amber-500/5",
  },
  ap_distributor: {
    label: "AP / Repartidor",
    color: "text-emerald-400",
    icon: Radio,
    borderColor: "border-emerald-500/40 bg-emerald-500/5",
  },
};

const BRAND_META: Record<string, { label: string; color: string }> = {
  mikrotik_routeros: { label: "MikroTik", color: "text-sky-400" },
  ubiquiti_airos: { label: "Ubiquiti", color: "text-orange-400" },
};

function StatusDot({ status }: { status: string }) {
  if (status === "ONLINE") return <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />;
  if (status === "OFFLINE") return <span className="inline-block w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40" />;
}

function RoleBadge({ role }: { role: EquipmentRole }) {
  const meta = ROLE_META[role] ?? { label: role, color: "text-muted-foreground", icon: Wifi, borderColor: "border-border" };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${meta.borderColor} ${meta.color}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function EquipmentCard({ eq }: { eq: {
  id: number; ip: string; model: string; lastSeenStatus: string;
  connectionType: string; equipmentRole: string; clientCount?: number | null;
} }) {
  const brand = BRAND_META[eq.connectionType] ?? { label: eq.connectionType, color: "text-muted-foreground" };
  return (
    <div className="flex items-center justify-between p-2 rounded-md bg-background/40 border border-border/30 hover:border-border/60 transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot status={eq.lastSeenStatus} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-foreground">{eq.ip}</span>
            <RoleBadge role={eq.equipmentRole} />
            <span className={`text-[10px] font-medium ${brand.color}`}>{brand.label}</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">{eq.model}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {eq.clientCount != null && eq.clientCount > 0 && (
          <span className="text-xs font-mono bg-muted/50 px-2 py-0.5 rounded">{eq.clientCount} cli</span>
        )}
        <Link href={`/equipment/${eq.id}`}>
          <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7">
            <Eye className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function Topology() {
  const { data: topology, isLoading } = useGetNetworkTopology();

  // Sort equipment within nodes by role priority
  const ROLE_ORDER: Record<string, number> = { gateway: 0, core_router: 1, ptp_link: 2, ap_distributor: 3 };
  const sortedNodes = topology?.nodes?.map(node => ({
    ...node,
    equipment: [...(node.equipment ?? [])].sort(
      (a, b) => (ROLE_ORDER[a.equipmentRole ?? ""] ?? 9) - (ROLE_ORDER[b.equipmentRole ?? ""] ?? 9)
    ),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Network className="w-8 h-8 text-primary" />
          Topología de Red
        </h1>
        <div className="flex gap-3 flex-wrap">
          {Object.entries(ROLE_META).map(([key, meta]) => {
            const Icon = meta.icon;
            return (
              <span key={key} className={`inline-flex items-center gap-1.5 text-xs border px-2 py-1 rounded ${meta.borderColor} ${meta.color}`}>
                <Icon className="w-3 h-3" />
                {meta.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Network Nodes Layer */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <Network className="w-3.5 h-3.5" /> Capa de Red — Nodos de Distribución
        </h2>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        ) : sortedNodes?.length === 0 ? (
          <Card className="bg-card/50 border-border/50">
            <CardContent className="py-12 text-center space-y-2">
              <Network className="w-12 h-12 mx-auto text-muted-foreground/40" />
              <p className="text-muted-foreground">No hay nodos registrados.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sortedNodes?.map((node) => {
              const onlineCount = node.equipment.filter(e => e.lastSeenStatus === "ONLINE").length;
              const totalCount = node.equipment.length;
              const hasGateway = node.equipment.some(e => e.equipmentRole === "gateway" || e.equipmentRole === "core_router");
              const hasCriticalOffline = node.equipment.some(e => e.lastSeenStatus === "OFFLINE" && (e.equipmentRole === "ptp_link" || e.equipmentRole === "gateway"));

              return (
                <Card key={node.id} className={`bg-card/50 border-border/50 ${hasCriticalOffline ? "border-red-900/40 bg-red-950/5" : ""}`}>
                  <CardHeader className="pb-3 border-b border-border/40">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {hasCriticalOffline && <span className="text-red-500 text-xs">⚠</span>}
                          {node.name}
                          {hasGateway && (
                            <Badge variant="outline" className="text-[9px] border-cyan-500/30 text-cyan-400">CORE</Badge>
                          )}
                        </CardTitle>
                        <div className="text-xs text-muted-foreground mt-0.5">{node.location}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold font-mono ${onlineCount === totalCount && totalCount > 0 ? "text-emerald-400" : onlineCount === 0 ? "text-red-400" : "text-yellow-400"}`}>
                          {onlineCount}/{totalCount}
                        </div>
                        <div className="text-[10px] text-muted-foreground">online</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3 space-y-1.5">
                    {node.equipment.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">Sin equipos registrados</p>
                    ) : (
                      node.equipment.map((eq) => (
                        <EquipmentCard key={eq.id} eq={eq} />
                      ))
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <Card className="bg-card/30 border-border/30">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Jerarquía de administración:</span>
            <span className="flex items-center gap-1"><Globe className="w-3 h-3 text-cyan-400" /> Internet → </span>
            <span className="flex items-center gap-1"><Server className="w-3 h-3 text-violet-400" /> Router central MikroTik → </span>
            <span className="flex items-center gap-1"><ArrowUpDown className="w-3 h-3 text-amber-400" /> Enlaces → </span>
            <span className="flex items-center gap-1"><Radio className="w-3 h-3 text-emerald-400" /> LiteAP / SXT → </span>
            <span>Cliente final</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
