import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { useListEquipment } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Difference = {
  id: string;
  kind: string;
  severity: "warning" | "error" | "critical";
  clientId: number | null;
  clientName: string | null;
  mac: string;
  ip: string | null;
  routerIp: string | null;
  routerQueueId: string | null;
  routerRateLimit: string | null;
  expectedRateLimit?: string | null;
  expectedAddressList?: string | null;
  actualAddressLists?: string[];
  message: string;
};

type Report = {
  equipment: { id: number; model: string; ip: string; checkedAt: string };
  routerReachable: boolean;
  totals: { clients: number; routerLeases: number; routerQueues: number; routerAddressLists: number; differences: number; critical: number };
  differences: Difference[];
};

import { apiFetch } from "@/lib/api-fetch";

async function apiRequest(path: string, init?: RequestInit) {
  const response = await apiFetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export default function Reconciliation() {
  const { data: equipment } = useListEquipment();
  const routers = useMemo(
    () => (equipment ?? []).filter(item => item.connectionType === "mikrotik_routeros" && item.equipmentRole === "core_router"),
    [equipment],
  );
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadReport() {
    if (!selectedEquipmentId) return;
    setLoading(true);
    try {
      const next = await apiRequest(`/api/reconciliation/equipment/${selectedEquipmentId}`) as Report;
      setReport(next);
      setSelected([]);
    } catch (error) {
      setReport(null);
      toast.error(error instanceof Error ? error.message : "No se pudo reconciliar el router");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
  }, [selectedEquipmentId]);

  async function applySelected() {
    if (!selectedEquipmentId || selected.length === 0) return;
    setLoading(true);
    try {
      const result = await apiRequest(`/api/reconciliation/equipment/${selectedEquipmentId}/apply`, {
        method: "POST",
        body: JSON.stringify({ confirm: true, differenceIds: selected }),
      }) as { applied: string[]; skipped: Array<{ id: string; reason: string }>; verification: Report };
      toast[result.skipped.length === 0 ? "success" : "warning"](
        `${result.applied.length} diferencias aplicadas; ${result.skipped.length} requieren revisión`,
      );
      setReport(result.verification);
      setSelected([]);
      await loadReport();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron aplicar las diferencias");
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string, checked: boolean) {
    setSelected(current => checked ? [...current, id] : current.filter(item => item !== id));
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Integridad operativa</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Reconciliación CRM–router</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Compara el estado persistido con los leases reales del MikroTik. Las diferencias críticas nunca se corrigen automáticamente.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Router central</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Select value={selectedEquipmentId} onValueChange={setSelectedEquipmentId}>
            <SelectTrigger className="sm:max-w-md"><SelectValue placeholder="Selecciona un router MikroTik" /></SelectTrigger>
            <SelectContent>
              {routers.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.model} · {item.ip}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void loadReport()} disabled={!selectedEquipmentId || loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </Button>
        </CardContent>
      </Card>

      {!report && (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          Selecciona un router para consultar su estado real.
        </CardContent></Card>
      )}

      {report && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Metric label="Clientes CRM" value={report.totals.clients} />
            <Metric label="Leases del router" value={report.totals.routerLeases} />
            <Metric label="Diferencias" value={report.totals.differences} />
            <Metric label="Críticas" value={report.totals.critical} danger />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">{report.equipment.model} · {report.equipment.ip}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Consulta: {new Date(report.equipment.checkedAt).toLocaleString("es")}</p>
              </div>
              <Button onClick={() => void applySelected()} disabled={selected.length === 0 || loading}>
                Aplicar seleccionadas ({selected.length})
              </Button>
            </CardHeader>
            <CardContent>
              {report.differences.length === 0 ? (
                <div className="flex items-center gap-2 py-8 text-sm text-emerald-400"><CheckCircle2 className="h-5 w-5" /> No hay diferencias detectadas.</div>
              ) : (
                <div className="space-y-3">
                  {report.differences.map(item => (
                    <div key={item.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                      <Checkbox
                        checked={selected.includes(item.id)}
                        onCheckedChange={checked => toggle(item.id, checked === true)}
                       disabled={["duplicate", "router_only", "orphan_queue", "orphan_address_list"].includes(item.kind)}
                        aria-label={`Seleccionar ${item.id}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={item.severity === "critical" ? "destructive" : "outline"}>{item.kind}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">{item.mac || "sin MAC"}</span>
                        </div>
                        <p className="mt-1 text-sm">{item.message}</p>
                         {(item.routerIp || item.routerRateLimit || item.expectedRateLimit || item.expectedAddressList) && (
                          <p className="mt-1 text-xs text-muted-foreground">
                             Router: {item.routerIp ?? "—"} · {item.routerRateLimit ?? "sin límite"}
                             {item.expectedRateLimit ? ` · CRM: ${item.expectedRateLimit}` : ""}
                             {item.expectedAddressList ? ` · Esperada: ${item.expectedAddressList}` : ""}
                          </p>
                        )}
                      </div>
                      {item.severity === "critical" ? <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-2xl font-semibold ${danger && value > 0 ? "text-red-400" : ""}`}>{value}</p></CardContent></Card>;
}