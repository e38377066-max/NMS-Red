import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BriefcaseBusiness, ClipboardList, Package, Plus, RefreshCw, ShieldAlert, Ticket, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getAuthToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Report = {
  clients: { total: number; byStatus: Record<string, number>; byPaymentStatus: Record<string, number> };
  payments: { count: number; total: number };
  tickets: { total: number; byStatus: Record<string, number>; byPriority: Record<string, number> };
  workOrders: { total: number; byStatus: Record<string, number> };
  incidents: { total: number; bySeverity: Record<string, number> };
};

type TicketRow = { id: number; subject: string; description: string; status: string; priority: string; category: string; createdAt: string; updatedAt: string };
type InventoryRow = { id: number; name: string; category: string; status: string; serialNumber: string | null; macAddress: string | null; supplier: string | null };
type WorkOrder = { id: number; type: string; status: string; address: string | null; scheduledAt: string | null; notes: string | null };
type Incident = { id: number; type: string; severity: string; message: string; status: string; createdAt: string };
type Plan = { id: number; name: string; downloadLimit: string; uploadLimit: string; monthlyFee: string; active: boolean };

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "", ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "No se pudo completar la operación");
  return body as T;
}

function Count({ label, value, tone = "text-foreground" }: { label: string; value: number | string; tone?: string }) {
  return <div className="rounded-lg border border-border/50 bg-background/30 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p></div>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = ["resolved", "closed", "completed", "confirmed", "active", "in_stock"].includes(status)
    ? "border-emerald-500/30 text-emerald-400" : ["critical", "overdue", "failed"].includes(status)
      ? "border-red-500/30 text-red-400" : "border-amber-500/30 text-amber-400";
  return <Badge variant="outline" className={tone}>{status.replaceAll("_", " ")}</Badge>;
}

export default function Operations() {
  const { toast } = useToast();
  const [report, setReport] = useState<Report | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticketForm, setTicketForm] = useState({ subject: "", description: "", priority: "normal", category: "support" });
  const [inventoryForm, setInventoryForm] = useState({ name: "", category: "router", status: "in_stock", serialNumber: "", macAddress: "" });
  const [workForm, setWorkForm] = useState({ type: "installation", address: "", scheduledAt: "", notes: "" });
  const [planForm, setPlanForm] = useState({ name: "", downloadLimit: "", uploadLimit: "", monthlyFee: "" });

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextReport, nextTickets, nextInventory, nextOrders, nextIncidents, nextPlans] = await Promise.all([
        api<Report>("/reports/operations"),
        api<TicketRow[]>("/tickets"),
        api<InventoryRow[]>("/inventory"),
        api<WorkOrder[]>("/work-orders"),
        api<Incident[]>("/incidents"),
        api<Plan[]>("/plans"),
      ]);
      setReport(nextReport); setTickets(nextTickets); setInventory(nextInventory);
      setWorkOrders(nextOrders); setIncidents(nextIncidents); setPlans(nextPlans);
    } catch (error) {
      toast({ title: "No se pudo cargar operaciones", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  const create = async (path: string, body: unknown, reset: () => void) => {
    try { await api(path, { method: "POST", body: JSON.stringify(body) }); reset(); await refresh(); toast({ title: "Guardado", description: "El registro quedó persistido." }); }
    catch (error) { toast({ title: "No se pudo guardar", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" }); }
  };

  const openIncidents = useMemo(() => incidents.filter(item => item.status === "open"), [incidents]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary"><BriefcaseBusiness className="h-4 w-4" /> Operación ISP</div>
          <h1 className="text-3xl font-bold tracking-tight">Centro de operaciones</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gestión persistente de clientes, soporte, campo, inventario, cobros y alertas. La conexión física a la red se configura aparte.</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Count label="Clientes" value={report?.clients.total ?? 0} />
        <Count label="Cobros del período" value={`$ ${(report?.payments.total ?? 0).toFixed(2)}`} tone="text-emerald-400" />
        <Count label="Tickets" value={report?.tickets.total ?? 0} tone="text-sky-400" />
        <Count label="Órdenes de campo" value={report?.workOrders.total ?? 0} tone="text-violet-400" />
        <Count label="Incidentes abiertos" value={openIncidents.length} tone={openIncidents.length ? "text-red-400" : "text-emerald-400"} />
      </div>

      <Tabs defaultValue="tickets" className="space-y-4">
        <TabsList className="grid h-auto grid-cols-2 gap-1 md:grid-cols-5">
          <TabsTrigger value="tickets"><Ticket className="mr-2 h-4 w-4" />Tickets</TabsTrigger>
          <TabsTrigger value="field"><ClipboardList className="mr-2 h-4 w-4" />Campo</TabsTrigger>
          <TabsTrigger value="inventory"><Package className="mr-2 h-4 w-4" />Inventario</TabsTrigger>
          <TabsTrigger value="billing"><WalletCards className="mr-2 h-4 w-4" />Planes</TabsTrigger>
          <TabsTrigger value="incidents"><ShieldAlert className="mr-2 h-4 w-4" />Alertas</TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Card><CardHeader><CardTitle className="text-base">Nuevo ticket</CardTitle></CardHeader><CardContent className="space-y-3">
            <div><Label>Asunto</Label><Input value={ticketForm.subject} onChange={e => setTicketForm({ ...ticketForm, subject: e.target.value })} /></div>
            <div><Label>Descripción</Label><Textarea value={ticketForm.description} onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Prioridad</Label><Select value={ticketForm.priority} onValueChange={priority => setTicketForm({ ...ticketForm, priority })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Baja</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="critical">Crítica</SelectItem></SelectContent></Select></div>
              <div><Label>Categoría</Label><Input value={ticketForm.category} onChange={e => setTicketForm({ ...ticketForm, category: e.target.value })} /></div>
            </div>
            <Button className="w-full" onClick={() => void create("/tickets", ticketForm, () => setTicketForm({ subject: "", description: "", priority: "normal", category: "support" }))}><Plus className="mr-2 h-4 w-4" />Crear ticket</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Mesa de ayuda <Badge variant="outline" className="ml-2">{tickets.length}</Badge></CardTitle></CardHeader><CardContent className="space-y-2">
            {tickets.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No hay tickets registrados.</p> : tickets.map(ticket => <div key={ticket.id} className="rounded-lg border border-border/50 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">#{ticket.id} {ticket.subject}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ticket.description}</p></div><StatusBadge status={ticket.status} /></div><div className="mt-3 flex gap-2"><Badge variant="outline">{ticket.priority}</Badge><Badge variant="outline">{ticket.category}</Badge><span className="ml-auto text-xs text-muted-foreground">{new Date(ticket.updatedAt).toLocaleString("es")}</span></div></div>)}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="field" className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Card><CardHeader><CardTitle className="text-base">Orden de instalación o visita</CardTitle></CardHeader><CardContent className="space-y-3">
            <div><Label>Tipo</Label><Select value={workForm.type} onValueChange={type => setWorkForm({ ...workForm, type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="installation">Instalación</SelectItem><SelectItem value="visit">Visita técnica</SelectItem><SelectItem value="relocation">Reubicación</SelectItem><SelectItem value="repair">Reparación</SelectItem></SelectContent></Select></div>
            <div><Label>Dirección</Label><Input value={workForm.address} onChange={e => setWorkForm({ ...workForm, address: e.target.value })} /></div>
            <div><Label>Fecha programada</Label><Input type="datetime-local" value={workForm.scheduledAt} onChange={e => setWorkForm({ ...workForm, scheduledAt: e.target.value })} /></div>
            <div><Label>Notas</Label><Textarea value={workForm.notes} onChange={e => setWorkForm({ ...workForm, notes: e.target.value })} /></div>
            <Button className="w-full" onClick={() => void create("/work-orders", workForm, () => setWorkForm({ type: "installation", address: "", scheduledAt: "", notes: "" }))}><Plus className="mr-2 h-4 w-4" />Crear orden</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Agenda de campo</CardTitle></CardHeader><CardContent className="space-y-2">{workOrders.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No hay órdenes.</p> : workOrders.map(order => <div key={order.id} className="rounded-lg border border-border/50 p-3"><div className="flex justify-between"><p className="font-medium">#{order.id} {order.type}</p><StatusBadge status={order.status} /></div><p className="mt-1 text-sm text-muted-foreground">{order.address ?? "Sin dirección"}</p><p className="mt-2 text-xs text-muted-foreground">{order.scheduledAt ? new Date(order.scheduledAt).toLocaleString("es") : "Sin fecha programada"}</p></div>)}</CardContent></Card>
        </TabsContent>

        <TabsContent value="inventory" className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Card><CardHeader><CardTitle className="text-base">Registrar activo</CardTitle></CardHeader><CardContent className="space-y-3">
            <div><Label>Nombre</Label><Input value={inventoryForm.name} onChange={e => setInventoryForm({ ...inventoryForm, name: e.target.value })} placeholder="Router, radio, fuente..." /></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Categoría</Label><Input value={inventoryForm.category} onChange={e => setInventoryForm({ ...inventoryForm, category: e.target.value })} /></div><div><Label>Estado</Label><Select value={inventoryForm.status} onValueChange={status => setInventoryForm({ ...inventoryForm, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in_stock">En almacén</SelectItem><SelectItem value="installed">Instalado</SelectItem><SelectItem value="faulty">Averiado</SelectItem><SelectItem value="retired">Retirado</SelectItem></SelectContent></Select></div></div>
            <div><Label>Número de serie</Label><Input value={inventoryForm.serialNumber} onChange={e => setInventoryForm({ ...inventoryForm, serialNumber: e.target.value })} /></div><div><Label>MAC</Label><Input value={inventoryForm.macAddress} onChange={e => setInventoryForm({ ...inventoryForm, macAddress: e.target.value })} /></div>
            <Button className="w-full" onClick={() => void create("/inventory", inventoryForm, () => setInventoryForm({ name: "", category: "router", status: "in_stock", serialNumber: "", macAddress: "" }))}><Plus className="mr-2 h-4 w-4" />Guardar activo</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Inventario <Badge variant="outline" className="ml-2">{inventory.length}</Badge></CardTitle></CardHeader><CardContent className="space-y-2">{inventory.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No hay activos.</p> : inventory.map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3"><div><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.category} · {item.serialNumber ?? item.macAddress ?? "Sin identificador"}</p></div><StatusBadge status={item.status} /></div>)}</CardContent></Card>
        </TabsContent>

        <TabsContent value="billing" className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Card><CardHeader><CardTitle className="text-base">Nuevo plan</CardTitle></CardHeader><CardContent className="space-y-3">
            <div><Label>Nombre</Label><Input value={planForm.name} onChange={e => setPlanForm({ ...planForm, name: e.target.value })} /></div><div className="grid grid-cols-2 gap-3"><div><Label>Descarga</Label><Input value={planForm.downloadLimit} onChange={e => setPlanForm({ ...planForm, downloadLimit: e.target.value })} placeholder="50M" /></div><div><Label>Subida</Label><Input value={planForm.uploadLimit} onChange={e => setPlanForm({ ...planForm, uploadLimit: e.target.value })} placeholder="10M" /></div></div><div><Label>Cuota mensual</Label><Input type="number" min="0" step="0.01" value={planForm.monthlyFee} onChange={e => setPlanForm({ ...planForm, monthlyFee: e.target.value })} /></div>
            <Button className="w-full" onClick={() => void create("/plans", planForm, () => setPlanForm({ name: "", downloadLimit: "", uploadLimit: "", monthlyFee: "" }))}><Plus className="mr-2 h-4 w-4" />Crear plan</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Catálogo de planes</CardTitle></CardHeader><CardContent className="space-y-2">{plans.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No hay planes configurados.</p> : plans.map(plan => <div key={plan.id} className="flex items-center justify-between rounded-lg border border-border/50 p-3"><div><p className="font-medium">{plan.name}</p><p className="text-xs text-muted-foreground">{plan.downloadLimit} ↓ · {plan.uploadLimit} ↑ · $ {Number(plan.monthlyFee).toFixed(2)}/mes</p></div><StatusBadge status={plan.active ? "active" : "inactive"} /></div>)}</CardContent></Card>
        </TabsContent>

        <TabsContent value="incidents"><Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-400" />Alertas deduplicadas</CardTitle></CardHeader><CardContent className="space-y-2">{incidents.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No hay incidentes abiertos.</p> : incidents.map(incident => <div key={incident.id} className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 md:flex-row md:items-center"><div className="flex-1"><div className="flex items-center gap-2"><p className="font-medium">{incident.type}</p><StatusBadge status={incident.severity} /></div><p className="mt-1 text-sm text-muted-foreground">{incident.message}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(incident.createdAt).toLocaleString("es")}</p></div>{incident.status === "open" && <Button size="sm" variant="outline" onClick={async () => { try { await api(`/incidents/${incident.id}`, { method: "PATCH", body: JSON.stringify({ status: "acknowledged" }) }); await refresh(); } catch (error) { toast({ title: "No se pudo confirmar", description: error instanceof Error ? error.message : "Error", variant: "destructive" }); } }}>Confirmar</Button>}</div>)}</CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}