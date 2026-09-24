import { useState } from "react";
import { useRoute } from "wouter";
import {
  useGetClient, getGetClientQueryKey,
  useGetClientMetrics, getGetClientMetricsQueryKey,
  useRegisterClientPayment, getListClientsQueryKey,
  useChangeClientSpeed,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import {
  ArrowLeft, DollarSign, CheckCircle2, AlertCircle, XCircle,
  Calendar, Zap, Signal, TrendingUp, User, Network, Trash2,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useToast } from "@/hooks/use-toast";

type DhcpLease = {
  id: string;
  address: string;
  macAddress: string;
  hostName: string | null;
  comment: string | null;
  status: string;
  dynamic: boolean;
  blocked: boolean;
  dhcpServer: string;
  expiresAfter: string | null;
};

function PaymentBadge({ status }: { status: string }) {
  if (status === "PAID") return <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 gap-1"><CheckCircle2 className="w-3 h-3" /> Al día</Badge>;
  if (status === "PENDING") return <Badge variant="outline" className="border-yellow-500/30 text-yellow-400 gap-1"><AlertCircle className="w-3 h-3" /> Pendiente</Badge>;
  return <Badge variant="outline" className="border-red-500/30 text-red-400 gap-1"><XCircle className="w-3 h-3" /> Suspendido</Badge>;
}

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ClientDetail() {
  const [, params] = useRoute("/clients/:id");
  const id = Number(params?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: client, isLoading } = useGetClient(id, { query: { queryKey: getGetClientQueryKey(id) } });
  const { data: metrics } = useGetClientMetrics(id, { hours: 24 }, { query: { queryKey: getGetClientMetricsQueryKey(id, { hours: 24 }) } });

  const registerPayment = useRegisterClientPayment();
  const changeSpeed = useChangeClientSpeed();

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [dhcpOpen, setDhcpOpen] = useState(false);
  const [fee, setFee] = useState("");
  const [days, setDays] = useState("30");
  const [newPlan, setNewPlan] = useState("");
  const [fixedIp, setFixedIp] = useState("");
  const [dhcpServer, setDhcpServer] = useState("");

  // DHCP leases for the client's equipment
  const dhcpQuery = useQuery<DhcpLease[]>({
    queryKey: ["dhcp-leases", client?.equipmentId],
    queryFn: async () => {
      if (!client?.equipmentId) return [];
      const res = await fetch(`${BASE}/api/equipment/${client.equipmentId}/dhcp-leases`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!client?.equipmentId,
    staleTime: 30_000,
  });

  const createLease = useMutation({
    mutationFn: async ({ fixedIp, dhcpServer }: { fixedIp: string; dhcpServer: string }) => {
      const res = await fetch(`${BASE}/api/clients/${id}/dhcp-lease`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixedIp, dhcpServer: dhcpServer || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message ?? "Error");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: ["dhcp-leases", client?.equipmentId] });
      toast({ title: "Lease estático creado", description: data.message });
      setDhcpOpen(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteLease = useMutation({
    mutationFn: async (leaseId: string) => {
      const res = await fetch(`${BASE}/api/equipment/${client?.equipmentId}/dhcp-leases/${leaseId}`, { method: "DELETE" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dhcp-leases", client?.equipmentId] });
      toast({ title: "Lease eliminado" });
    },
  });

  const makeStatic = useMutation({
    mutationFn: async ({ leaseId, clientId }: { leaseId: string; clientId: number }) => {
      const res = await fetch(`${BASE}/api/equipment/${client?.equipmentId}/dhcp-leases/${leaseId}/make-static`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dhcp-leases", client?.equipmentId] });
      queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
      toast({
        title: data.message,
        description: data.queueConfigured === false
          ? `La cola no se pudo sincronizar: ${data.queueMessage ?? "revisa el RouterOS"}`
          : data.queueConfigured
            ? `Cola de velocidad sincronizada para ${data.clientName ?? client?.name}.`
            : undefined,
        variant: data.queueConfigured === false ? "destructive" : "default",
      });
    },
  });

  const submitPayment = () => {
    registerPayment.mutate(
      { id, data: { monthlyFee: parseFloat(fee), daysUntilNextDue: parseInt(days, 10) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          toast({ title: "Pago registrado", description: "Estado actualizado a pagado." });
          setPaymentOpen(false);
        },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  };

  const submitSpeed = (confirmed = false) => {
    changeSpeed.mutate(
      { id, data: { newLimit: newPlan, userId: 1, dryRun: !confirmed } },
      {
        onSuccess: (data) => {
          if (data.requiresConfirmation) {
            if (confirm(`⚠ ${data.warning ?? ""}\n¿Confirmar cambio?`)) submitSpeed(true);
          } else {
            queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
            toast({ title: data.success ? "Velocidad actualizada" : "Error", description: data.message, variant: data.success ? "default" : "destructive" });
            setSpeedOpen(false);
          }
        },
      }
    );
  };

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );

  if (!client) return (
    <div className="text-center py-12 text-muted-foreground">
      Cliente no encontrado.
      <Link href="/clients"><Button variant="link">Volver a clientes</Button></Link>
    </div>
  );

  const chartData = (metrics ?? []).map(m => ({
    time: fmtTime(m.recordedAt),
    "Señal dBm": m.signalDbm,
    "CCQ %": m.ccq,
  }));

  const isOverdue = client.dueDate && new Date(client.dueDate) < new Date();

  // Find this client's lease in the list
  const clientLease = dhcpQuery.data?.find(l => l.macAddress.toLowerCase() === client.mac.toLowerCase());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/clients">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <User className="w-6 h-6 text-primary" />
            {client.name}
            <PaymentBadge status={client.paymentStatus} />
          </h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{client.mac}</span>
            {client.ip && <><span>·</span><span className="font-mono">{client.ip}</span></>}
            <span>·</span>
            <span>Plan: <span className="font-mono text-foreground">{client.planLimit}</span></span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={() => { setFee(client.monthlyFee ?? ""); setDays("30"); setPaymentOpen(true); }}>
            <DollarSign className="w-4 h-4 mr-2 text-emerald-400" /> Registrar Pago
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setNewPlan(client.planLimit); setSpeedOpen(true); }}>
            <Zap className="w-4 h-4 mr-2 text-yellow-400" /> Cambiar Velocidad
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setFixedIp(client.ip ?? ""); setDhcpServer(""); setDhcpOpen(true); }}>
            <Network className="w-4 h-4 mr-2 text-sky-400" /> Lease DHCP Estático
          </Button>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            icon: DollarSign, label: "Cuota mensual",
            value: client.monthlyFee ? `Q ${parseFloat(client.monthlyFee).toFixed(2)}` : "No configurada",
            color: "text-emerald-400",
          },
          {
            icon: Calendar, label: "Vencimiento",
            value: fmt(client.dueDate),
            color: isOverdue ? "text-red-400" : "text-muted-foreground",
          },
          {
            icon: CheckCircle2, label: "Último pago",
            value: fmt(client.lastPaymentDate),
            color: "text-muted-foreground",
          },
          {
            icon: Signal, label: "Señal actual",
            value: client.lastSeenDbm ? `${client.lastSeenDbm} dBm` : "—",
            color: "text-sky-400",
          },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label} className="bg-card/50 border-border/50">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${color}`} />
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
              </div>
              <div className={`text-sm font-medium ${color}`}>{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isOverdue && (
        <div className="flex items-center gap-3 p-4 rounded-md bg-red-950/20 border border-red-900/30 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Este cliente tiene su fecha de vencimiento vencida. El corte automático se aplica a las 00:00.
          <Button size="sm" className="ml-auto bg-emerald-700 hover:bg-emerald-600 text-white" onClick={() => setPaymentOpen(true)}>
            Registrar Pago Ahora
          </Button>
        </div>
      )}

      {/* DHCP Lease card */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-base flex items-center gap-2">
            <Network className="w-4 h-4 text-sky-400" />
            IP Fija (DHCP Lease)
            {clientLease && (
              <Badge variant="outline" className={clientLease.dynamic ? "border-yellow-500/30 text-yellow-400 text-[10px]" : "border-emerald-500/30 text-emerald-400 text-[10px]"}>
                {clientLease.dynamic ? "Dinámica" : "Estática"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {dhcpQuery.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : !clientLease ? (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                No se encontró lease DHCP para <span className="font-mono text-foreground">{client.mac}</span> en este equipo.
              </div>
              <Button size="sm" variant="outline" onClick={() => { setFixedIp(client.ip ?? ""); setDhcpOpen(true); }}>
                <Network className="w-3 h-3 mr-2" /> Crear Lease Estático
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">IP asignada:</span>
                  <span className="font-mono text-sky-400 font-medium">{clientLease.address}</span>
                  {clientLease.expiresAfter && !clientLease.dynamic === false && (
                    <span className="text-xs text-muted-foreground">expira en {clientLease.expiresAfter}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Servidor DHCP: <span className="font-mono">{clientLease.dhcpServer || "—"}</span></span>
                  <span>·</span>
                  <span>Estado: <span className="text-foreground">{clientLease.status}</span></span>
                </div>
              </div>
              <div className="flex gap-2">
                {clientLease.dynamic && (
                   <Button size="sm" variant="outline" className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" onClick={() => makeStatic.mutate({ leaseId: clientLease.id, clientId: id })}>
                    Convertir a Estático
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => {
                  if (confirm(`¿Eliminar lease de ${clientLease.address}?`)) deleteLease.mutate(clientLease.id);
                }}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metrics chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Historial de Señal — Últimas 24 horas
            <span className="text-xs text-muted-foreground ml-auto">{(metrics ?? []).length} puntos</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground/50 text-sm">
              <TrendingUp className="w-8 h-8 mb-2" />
              Sin datos históricos aún. Se recolectan cada 5 minutos.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#6b7280" }} />
                <YAxis yAxisId="dbm" domain={[-100, -40]} tick={{ fontSize: 10, fill: "#6b7280" }} label={{ value: "dBm", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "#6b7280" } }} />
                <YAxis yAxisId="ccq" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "#6b7280" }} label={{ value: "%", angle: 90, position: "insideRight", style: { fontSize: 10, fill: "#6b7280" } }} />
                <Tooltip contentStyle={{ backgroundColor: "#1c1c2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="dbm" type="monotone" dataKey="Señal dBm" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls />
                <Line yAxisId="ccq" type="monotone" dataKey="CCQ %" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* DHCP all leases */}
      {(dhcpQuery.data?.length ?? 0) > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="w-4 h-4 text-muted-foreground" />
              Todos los Leases DHCP del Equipo
              <span className="text-xs text-muted-foreground ml-auto">{dhcpQuery.data?.length} total</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP</TableHead>
                  <TableHead>MAC</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dhcpQuery.data?.map(lease => {
                  const isThisClient = lease.macAddress.toLowerCase() === client.mac.toLowerCase();
                  return (
                    <TableRow key={lease.id} className={isThisClient ? "bg-sky-950/20" : ""}>
                      <TableCell className="font-mono text-sm">{lease.address}</TableCell>
                      <TableCell className="font-mono text-xs">{lease.macAddress}</TableCell>
                      <TableCell className="text-sm">{lease.hostName ?? lease.comment ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={lease.dynamic ? "border-yellow-500/30 text-yellow-400 text-[10px]" : "border-emerald-500/30 text-emerald-400 text-[10px]"}>
                          {lease.dynamic ? "Dinámica" : "Estática"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{lease.status}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {lease.dynamic && (
                             <Button variant="ghost" size="sm" className="text-xs text-sky-400 h-7" onClick={() => makeStatic.mutate({ leaseId: lease.id, clientId: id })}>
                              → Estático
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 h-7 w-7" onClick={() => {
                            if (confirm(`¿Eliminar lease ${lease.address}?`)) deleteLease.mutate(lease.id);
                          }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Payment dialog */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-400" /> Registrar Pago — {client.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Monto (Q)</Label>
              <Input type="number" placeholder="150.00" value={fee} onChange={e => setFee(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>Días hasta próximo vencimiento</Label>
              <Input type="number" value={days} onChange={e => setDays(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Nuevo vencimiento: {(() => { const d = new Date(); d.setDate(d.getDate() + parseInt(days || "30", 10)); return d.toLocaleDateString("es", { day: "2-digit", month: "long", year: "numeric" }); })()}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancelar</Button>
            <Button onClick={submitPayment} disabled={!fee || registerPayment.isPending} className="bg-emerald-600 hover:bg-emerald-700">
              {registerPayment.isPending ? "Guardando..." : "Confirmar Pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Speed dialog */}
      <Dialog open={speedOpen} onOpenChange={setSpeedOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" /> Cambiar Velocidad — {client.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nuevo plan (ej. 10M/10M)</Label>
              <Input value={newPlan} onChange={e => setNewPlan(e.target.value)} placeholder="10M/10M" className="font-mono" />
              <p className="text-xs text-muted-foreground">Plan actual: <span className="font-mono">{client.planLimit}</span></p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpeedOpen(false)}>Cancelar</Button>
            <Button onClick={() => submitSpeed(false)} disabled={!newPlan || changeSpeed.isPending}>
              {changeSpeed.isPending ? "Aplicando..." : "Cambiar Velocidad"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DHCP lease dialog */}
      <Dialog open={dhcpOpen} onOpenChange={setDhcpOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="w-5 h-5 text-sky-400" /> Crear Lease DHCP Estático
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1 p-3 rounded-md bg-muted/20 border border-border/40 text-xs text-muted-foreground">
              <div>MAC del cliente: <span className="font-mono text-foreground">{client.mac}</span></div>
            </div>
            <div className="space-y-1.5">
              <Label>IP fija a asignar</Label>
              <Input
                placeholder="10.0.1.100"
                value={fixedIp}
                onChange={e => setFixedIp(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">La MAC del cliente quedará amarrada siempre a esta IP.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Nombre del servidor DHCP <span className="text-muted-foreground">(opcional)</span></Label>
              <Input
                placeholder="dhcp1"
                value={dhcpServer}
                onChange={e => setDhcpServer(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDhcpOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => createLease.mutate({ fixedIp, dhcpServer })}
              disabled={!fixedIp || createLease.isPending}
              className="bg-sky-700 hover:bg-sky-600"
            >
              {createLease.isPending ? "Creando..." : "Crear Lease Estático"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
