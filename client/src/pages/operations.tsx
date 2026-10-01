import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BriefcaseBusiness, CalendarClock, ClipboardList, Package, Plus, RefreshCw, ShieldAlert, Ticket, Trash2, WalletCards } from "lucide-react";
import { Bell, Clock3, Download, FileText, History, MessageSquare, Paperclip, Search, Send, Shield, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  downloadSupportTicketAttachment,
  getGetClientQueryKey,
  getGetSupportTicketQueryKey,
  getListClientsQueryKey,
  getListSupportTicketAttachmentsQueryKey,
  getListSupportTicketHistoryQueryKey,
  getListSupportTicketsQueryKey,
  getListTicketSlaPoliciesQueryKey,
  getListUserNotificationsQueryKey,
  useAddSupportTicketComment,
  useCreateSupportTicket,
  useGetSupportTicket,
  useListSupportTicketAttachments,
  useListSupportTicketHistory,
  useListSupportTickets,
  useListTicketSlaPolicies,
  useListUserNotifications,
  useMarkUserNotificationRead,
  useUpdateSupportTicket,
  useUpdateTicketClientReopenPermission,
  useUpdateTicketSlaPolicy,
  useUploadSupportTicketAttachment,
  type Client,
  type FieldWorkOrder,
  type Technician,
  type TechnicianAvailability,
  type SupportNotification,
  type SupportTicket,
  type SupportTicketAttachment,
  type SupportTicketSlaPolicy,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api-fetch";

type Report = {
  clients: { total: number; byStatus: Record<string, number>; byPaymentStatus: Record<string, number> };
  payments: { count: number; total: number };
  tickets: { total: number; byStatus: Record<string, number>; byPriority: Record<string, number> };
  workOrders: { total: number; byStatus: Record<string, number> };
  incidents: { total: number; bySeverity: Record<string, number> };
};

type TicketRow = { id: number; clientId: number | null; clientReopenEnabled: boolean; subject: string; description: string; status: string; priority: string; category: string; createdAt: string; updatedAt: string };
type InventoryRow = { id: number; name: string; category: string; status: string; serialNumber: string | null; macAddress: string | null; supplier: string | null };
type Incident = { id: number; type: string; severity: string; message: string; status: string; createdAt: string };
type Plan = { id: number; name: string; downloadLimit: string; uploadLimit: string; monthlyFee: string; active: boolean };
type WorkOrderEdit = {
  assignedToUserId: string;
  scheduledAt: string;
  scheduledEndAt: string;
  signalDbm: string;
  ccq: string;
  installedEquipment: string;
  installedSerialNumber: string;
};
type AvailabilityForm = { technicianUserId: string; startsAt: string; endsAt: string; notes: string };

function supportTicketCategoryLabel(category: string) {
  return category === "alignment_request" ? "Solicitud de alineación" : category;
}

function supportTicketClientLabel(ticket: { category: string; clientId?: number | null }) {
  if (ticket.clientId != null) return `Cliente #${ticket.clientId}`;
  return ticket.category === "alignment_request" ? "Solicitud desde campo" : "Sin cliente vinculado";
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
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

const supportDate = (value?: string | null) => value
  ? new Date(value).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
  : "Sin fecha";

const dateTimeInputValue = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const dateTimeToIso = (value: string) => value ? new Date(value).toISOString() : null;
const optionalNumber = (value: string) => value.trim() ? Number(value) : null;
const isOptionalNumberInRange = (value: string, min: number, max: number) => {
  if (!value.trim()) return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
};
const terminalWorkOrderStatuses = new Set(["completed", "closed", "cancelled", "canceled"]);

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result ?? "");
    const split = result.indexOf(",");
    split < 0 ? reject(new Error("No se pudo leer el archivo")) : resolve(result.slice(split + 1));
  };
  reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
  reader.readAsDataURL(file);
});

function SlaPill({ value, dueAt }: { value: string; dueAt?: string | null }) {
  const overdue = value === "breached" || Boolean(dueAt && new Date(dueAt) < new Date());
  return <Badge variant="outline" className={overdue ? "border-red-500/40 bg-red-500/10 text-red-300" : value === "met" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}>{overdue ? "SLA vencido" : value === "met" ? "SLA cumplido" : "SLA en curso"}</Badge>;
}

export default function Operations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [clients, setClients] = useState<Client[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [workOrders, setWorkOrders] = useState<FieldWorkOrder[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [availability, setAvailability] = useState<TechnicianAvailability[]>([]);
  const [orderEdits, setOrderEdits] = useState<Record<number, WorkOrderEdit>>({});
  const [historyQuery, setHistoryQuery] = useState("");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticketForm, setTicketForm] = useState({ subject: "", description: "", priority: "normal", category: "support" });
  const [inventoryForm, setInventoryForm] = useState({ name: "", category: "router", status: "in_stock", serialNumber: "", macAddress: "" });
  const [workForm, setWorkForm] = useState({ clientId: "", type: "installation", address: "", assignedToUserId: "", scheduledAt: "", scheduledEndAt: "", signalDbm: "", ccq: "", installedEquipment: "", installedSerialNumber: "", notes: "" });
  const [availabilityForm, setAvailabilityForm] = useState<AvailabilityForm>({ technicianUserId: "", startsAt: "", endsAt: "", notes: "" });
  const [planForm, setPlanForm] = useState({ name: "", downloadLimit: "", uploadLimit: "", monthlyFee: "" });

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextReport, nextClients, nextTickets, nextInventory, nextOrders, nextTechnicians, nextAvailability, nextIncidents, nextPlans] = await Promise.all([
        api<Report>("/reports/operations"),
        api<Client[]>("/clients"),
        api<TicketRow[]>("/tickets"),
        api<InventoryRow[]>("/inventory"),
        api<FieldWorkOrder[]>("/work-orders"),
        api<Technician[]>("/users/technicians"),
        api<TechnicianAvailability[]>("/technicians/availability"),
        api<Incident[]>("/incidents"),
        api<Plan[]>("/plans"),
      ]);
      setClients(nextClients); setReport(nextReport); setTickets(nextTickets); setInventory(nextInventory);
      setWorkOrders(nextOrders); setTechnicians(nextTechnicians); setAvailability(nextAvailability);
      setIncidents(nextIncidents); setPlans(nextPlans);
    } catch (error) {
      toast({ title: "No se pudo cargar operaciones", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  const create = async (path: string, body: unknown, reset: () => void) => {
    try { await api(path, { method: "POST", body: JSON.stringify(body) }); reset(); await refresh(); toast({ title: "Guardado", description: "El registro quedó persistido." }); }
    catch (error) { toast({ title: "No se pudo guardar", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" }); }
  };

  const defaultOrderEdit = (order: FieldWorkOrder): WorkOrderEdit => ({
    assignedToUserId: order.assignedToUserId?.toString() ?? "",
    scheduledAt: dateTimeInputValue(order.scheduledAt),
    scheduledEndAt: dateTimeInputValue(order.scheduledEndAt),
    signalDbm: order.signalDbm === null ? "" : String(order.signalDbm),
    ccq: order.ccq === null ? "" : String(order.ccq),
    installedEquipment: order.installedEquipment ?? "",
    installedSerialNumber: order.installedSerialNumber ?? "",
  });
  const orderEditFor = (order: FieldWorkOrder) => orderEdits[order.id] ?? defaultOrderEdit(order);
  const changeOrderEdit = (order: FieldWorkOrder, changes: Partial<WorkOrderEdit>) => {
    const initial = defaultOrderEdit(order);
    setOrderEdits(current => ({ ...current, [order.id]: { ...(current[order.id] ?? initial), ...changes } }));
  };
  const saveOrderEdit = async (order: FieldWorkOrder) => {
    const edit = orderEditFor(order);
    try {
      await api<FieldWorkOrder>(`/work-orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          assignedToUserId: edit.assignedToUserId ? Number(edit.assignedToUserId) : null,
          scheduledAt: dateTimeToIso(edit.scheduledAt),
          scheduledEndAt: dateTimeToIso(edit.scheduledEndAt),
          signalDbm: optionalNumber(edit.signalDbm),
          ccq: optionalNumber(edit.ccq),
          installedEquipment: edit.installedEquipment.trim() || null,
          installedSerialNumber: edit.installedSerialNumber.trim() || null,
        }),
      });
      setOrderEdits(current => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      await refresh();
      toast({ title: "Orden actualizada", description: `La orden #${order.id} quedó actualizada.` });
    } catch (error) {
      toast({ title: "No se pudo actualizar la agenda", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    }
  };
  const completeWorkOrder = async (order: FieldWorkOrder) => {
    const isRelocation = order.type.toLowerCase() === "relocation";
    if (isRelocation) {
      const client = clients.find(item => item.id === order.clientId);
      const confirmed = window.confirm(
        `Completar esta reubicación actualizará la dirección administrativa del cliente.\n\n`
        + `Cliente: ${client?.name ?? `#${order.clientId ?? "sin asignar"}`}\n`
        + `Dirección actual: ${client?.installationAddress?.trim() || "Sin registrar"}\n`
        + `Nueva dirección: ${order.address?.trim() || "Sin registrar"}\n\n`
        + "No cambiará el AP/SXT, la IP, la MAC ni la configuración de red.",
      );
      if (!confirmed) return;
    }
    const edit = orderEditFor(order);
    const body: Record<string, unknown> = {
      status: "completed",
      signalDbm: optionalNumber(edit.signalDbm),
      ccq: optionalNumber(edit.ccq),
      installedEquipment: edit.installedEquipment.trim() || null,
      installedSerialNumber: edit.installedSerialNumber.trim() || null,
    };
    if (edit.assignedToUserId !== (order.assignedToUserId?.toString() ?? "")) {
      body.assignedToUserId = edit.assignedToUserId ? Number(edit.assignedToUserId) : null;
    }
    if (edit.scheduledAt !== dateTimeInputValue(order.scheduledAt)) body.scheduledAt = dateTimeToIso(edit.scheduledAt);
    if (edit.scheduledEndAt !== dateTimeInputValue(order.scheduledEndAt)) body.scheduledEndAt = dateTimeToIso(edit.scheduledEndAt);
    try {
      await api<FieldWorkOrder>(`/work-orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (isRelocation && order.clientId !== null) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(order.clientId) }),
        ]);
      }
      setOrderEdits(current => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      await refresh();
      toast({
        title: isRelocation ? "Reubicación completada" : "Visita completada",
        description: isRelocation
          ? `La dirección del cliente se actualizó con la orden #${order.id}; la configuración de red no cambió.`
          : `La orden #${order.id} quedó registrada en el historial.`,
      });
    } catch (error) {
      toast({ title: isRelocation ? "No se pudo completar la reubicación" : "No se pudo completar la visita", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    }
  };
  const removeAvailability = async (block: TechnicianAvailability) => {
    try {
      await api<void>(`/technicians/availability/${block.id}`, { method: "DELETE" });
      await refresh();
      toast({ title: "Disponibilidad eliminada", description: "El bloque quedó eliminado." });
    } catch (error) {
      toast({ title: "No se pudo eliminar", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    }
  };

  const setTicketReopenPermission = async (ticket: TicketRow) => {
    try {
      const result = await api<{ ticketId: number; enabled: boolean }>(`/tickets/${ticket.id}/client-reopen`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !ticket.clientReopenEnabled }),
      });
      setTickets(current => current.map(item => item.id === result.ticketId
        ? { ...item, clientReopenEnabled: result.enabled }
        : item));
      toast({
        title: result.enabled ? "Reapertura habilitada" : "Permiso revocado",
        description: result.enabled
          ? `El cliente puede reabrir el ticket #${ticket.id} una vez.`
          : `El cliente ya no puede reabrir el ticket #${ticket.id}.`,
      });
    } catch (error) {
      toast({ title: "No se pudo cambiar el permiso", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    }
  };

  const openIncidents = useMemo(() => incidents.filter(item => item.status === "open"), [incidents]);
  const activeWorkOrders = useMemo(
    () => workOrders.filter(order => !terminalWorkOrderStatuses.has(order.status.toLowerCase())),
    [workOrders],
  );
  const visitHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return workOrders
      .filter(order => terminalWorkOrderStatuses.has(order.status.toLowerCase()))
      .filter(order => {
        if (!query) return true;
        const assignedPerson = technicians.find(person => person.id === order.assignedToUserId)?.username ?? "";
        const clientName = clients.find(client => client.id === order.clientId)?.name ?? "";
        const searchable = [
          order.clientId === null ? "" : `cliente ${order.clientId}`,
          clientName,
          order.type,
          order.status,
          order.address ?? "",
          order.notes ?? "",
          order.installedEquipment ?? "",
          order.installedSerialNumber ?? "",
          assignedPerson,
        ].join(" ").toLowerCase();
        return searchable.includes(query);
      })
      .sort((a, b) => Date.parse(b.completedAt ?? b.scheduledAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.scheduledAt ?? a.createdAt));
  }, [workOrders, technicians, clients, historyQuery]);
  const invalidWorkSchedule = Boolean(workForm.scheduledAt) !== Boolean(workForm.scheduledEndAt)
    || Boolean(workForm.scheduledAt && workForm.scheduledEndAt && new Date(workForm.scheduledEndAt) <= new Date(workForm.scheduledAt));
  const invalidWorkMetrics = !isOptionalNumberInRange(workForm.signalDbm, -120, 0)
    || !isOptionalNumberInRange(workForm.ccq, 0, 100);
  const isRelocationForm = workForm.type.toLowerCase() === "relocation";
  const selectedWorkClient = clients.find(client => String(client.id) === workForm.clientId);
  const invalidWorkRelocation = isRelocationForm && (!workForm.clientId || !workForm.address.trim());
  const invalidAvailabilityRange = !availabilityForm.technicianUserId
    || !availabilityForm.startsAt
    || !availabilityForm.endsAt
    || new Date(availabilityForm.endsAt) <= new Date(availabilityForm.startsAt);

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

        <TabsContent value="tickets"><SupportDesk /></TabsContent>

        <TabsContent value="field" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Nueva orden de campo</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={workForm.type} onValueChange={type => setWorkForm({ ...workForm, type })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="installation">Instalación</SelectItem>
                      <SelectItem value="visit">Visita técnica</SelectItem>
                      <SelectItem value="relocation">Reubicación</SelectItem>
                      <SelectItem value="repair">Reparación</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cliente {isRelocationForm ? "(obligatorio)" : "(opcional)"}</Label>
                  <Select value={workForm.clientId || "none"} onValueChange={clientId => setWorkForm({ ...workForm, clientId: clientId === "none" ? "" : clientId })}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar cliente" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" disabled={isRelocationForm}>{isRelocationForm ? "Seleccionar cliente" : "Sin cliente"}</SelectItem>
                      {clients.map(client => <SelectItem key={client.id} value={String(client.id)}>{client.name} · #{client.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Responsable</Label>
                  <Select value={workForm.assignedToUserId || "unassigned"} onValueChange={value => setWorkForm({ ...workForm, assignedToUserId: value === "unassigned" ? "" : value })}>
                    <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Sin asignar</SelectItem>
                      {technicians.map(person => <SelectItem key={person.id} value={String(person.id)}>{person.username} · {person.role}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{isRelocationForm ? "Nueva dirección de instalación" : "Dirección"}</Label>
                  <Input
                    value={workForm.address}
                    onChange={e => setWorkForm({ ...workForm, address: e.target.value })}
                    placeholder={isRelocationForm ? "Dirección de destino" : undefined}
                  />
                  {isRelocationForm && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedWorkClient
                        ? `Dirección actual: ${selectedWorkClient.installationAddress?.trim() || "Sin registrar"}. Se actualizará al completar esta orden; la configuración de red no cambiará.`
                        : "Selecciona el cliente y registra la dirección nueva. La dirección se actualizará al completar la orden."}
                    </p>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>Inicio</Label><Input type="datetime-local" value={workForm.scheduledAt} onChange={e => setWorkForm({ ...workForm, scheduledAt: e.target.value })} /></div>
                  <div><Label>Fin</Label><Input type="datetime-local" value={workForm.scheduledEndAt} onChange={e => setWorkForm({ ...workForm, scheduledEndAt: e.target.value })} /></div>
                </div>
                {invalidWorkSchedule && <p className="text-xs text-amber-400">Indica inicio y fin, y asegúrate de que el fin sea posterior.</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>Señal del enlace (dBm)</Label><Input type="number" min="-120" max="0" step="0.1" value={workForm.signalDbm} onChange={e => setWorkForm({ ...workForm, signalDbm: e.target.value })} placeholder="-65" /></div>
                  <div><Label>CCQ (%)</Label><Input type="number" min="0" max="100" step="0.1" value={workForm.ccq} onChange={e => setWorkForm({ ...workForm, ccq: e.target.value })} placeholder="95" /></div>
                  <div><Label>Equipo instalado</Label><Input maxLength={200} value={workForm.installedEquipment} onChange={e => setWorkForm({ ...workForm, installedEquipment: e.target.value })} placeholder="Modelo o tipo de equipo" /></div>
                  <div><Label>Número de serie</Label><Input maxLength={128} value={workForm.installedSerialNumber} onChange={e => setWorkForm({ ...workForm, installedSerialNumber: e.target.value })} /></div>
                </div>
                {invalidWorkMetrics && <p className="text-xs text-amber-400">La señal debe estar entre -120 y 0 dBm; CCQ entre 0 y 100 %.</p>}
                {invalidWorkRelocation && <p className="text-xs text-amber-400">Para crear una reubicación, selecciona un cliente y registra la nueva dirección.</p>}
                <div><Label>Notas</Label><Textarea value={workForm.notes} onChange={e => setWorkForm({ ...workForm, notes: e.target.value })} /></div>
                <Button
                  className="w-full"
                  disabled={invalidWorkSchedule || invalidWorkMetrics || invalidWorkRelocation}
                  onClick={() => void create("/work-orders", {
                    clientId: workForm.clientId ? Number(workForm.clientId) : null,
                    type: workForm.type,
                    address: workForm.address.trim() || null,
                    assignedToUserId: workForm.assignedToUserId ? Number(workForm.assignedToUserId) : null,
                    scheduledAt: dateTimeToIso(workForm.scheduledAt),
                    scheduledEndAt: dateTimeToIso(workForm.scheduledEndAt),
                    signalDbm: optionalNumber(workForm.signalDbm),
                    ccq: optionalNumber(workForm.ccq),
                    installedEquipment: workForm.installedEquipment.trim() || null,
                    installedSerialNumber: workForm.installedSerialNumber.trim() || null,
                    notes: workForm.notes.trim() || null,
                  }, () => setWorkForm({ clientId: "", type: "installation", address: "", assignedToUserId: "", scheduledAt: "", scheduledEndAt: "", signalDbm: "", ccq: "", installedEquipment: "", installedSerialNumber: "", notes: "" }))}
                >
                  <Plus className="mr-2 h-4 w-4" />Crear orden
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-primary" />Añadir disponibilidad</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Personal asignable</Label>
                  <Select value={availabilityForm.technicianUserId || "choose-technician"} onValueChange={technicianUserId => setAvailabilityForm({ ...availabilityForm, technicianUserId })}>
                    <SelectTrigger><SelectValue placeholder="Selecciona una cuenta" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="choose-technician" disabled>Selecciona una cuenta</SelectItem>
                      {technicians.map(person => <SelectItem key={person.id} value={String(person.id)}>{person.username} · {person.role}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {technicians.length === 0 && <p className="mt-1 text-xs text-muted-foreground">No hay cuentas asignables.</p>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>Disponible desde</Label><Input type="datetime-local" value={availabilityForm.startsAt} onChange={e => setAvailabilityForm({ ...availabilityForm, startsAt: e.target.value })} /></div>
                  <div><Label>Disponible hasta</Label><Input type="datetime-local" value={availabilityForm.endsAt} onChange={e => setAvailabilityForm({ ...availabilityForm, endsAt: e.target.value })} /></div>
                </div>
                {availabilityForm.startsAt && availabilityForm.endsAt && new Date(availabilityForm.endsAt) <= new Date(availabilityForm.startsAt) && <p className="text-xs text-amber-400">La hora de fin debe ser posterior a la de inicio.</p>}
                <div><Label>Notas</Label><Textarea value={availabilityForm.notes} onChange={e => setAvailabilityForm({ ...availabilityForm, notes: e.target.value })} placeholder="Zona, turno o detalle opcional" /></div>
                <Button
                  className="w-full"
                  disabled={invalidAvailabilityRange}
                  onClick={() => void create("/technicians/availability", {
                    technicianUserId: Number(availabilityForm.technicianUserId),
                    startsAt: dateTimeToIso(availabilityForm.startsAt),
                    endsAt: dateTimeToIso(availabilityForm.endsAt),
                    notes: availabilityForm.notes.trim() || null,
                  }, () => setAvailabilityForm({ technicianUserId: "", startsAt: "", endsAt: "", notes: "" }))}
                >
                  <Plus className="mr-2 h-4 w-4" />Guardar bloque
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Agenda de campo <Badge variant="outline" className="ml-2">{activeWorkOrders.length}</Badge></CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {activeWorkOrders.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No hay órdenes activas.</p> : activeWorkOrders.map(order => {
                  const edit = orderEditFor(order);
                  const assignedPerson = technicians.find(person => person.id === order.assignedToUserId);
                  const client = clients.find(item => item.id === order.clientId);
                  const invalidEditSchedule = Boolean(edit.scheduledAt) !== Boolean(edit.scheduledEndAt)
                    || Boolean(edit.scheduledAt && edit.scheduledEndAt && new Date(edit.scheduledEndAt) <= new Date(edit.scheduledAt));
                  const invalidEditMetrics = !isOptionalNumberInRange(edit.signalDbm, -120, 0)
                    || !isOptionalNumberInRange(edit.ccq, 0, 100);
                  return (
                    <div key={order.id} className="space-y-3 rounded-lg border border-border/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">#{order.id} · {order.type.replaceAll("_", " ")}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {order.type.toLowerCase() === "relocation" ? `Nueva dirección: ${order.address ?? "Sin registrar"}` : order.address ?? "Sin dirección"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{client ? `${client.name} · Cliente #${client.id}` : order.clientId ? `Cliente #${order.clientId}` : "Sin cliente"}</p>
                          {order.type.toLowerCase() === "relocation" && (
                            <p className="mt-1 text-xs text-muted-foreground">Dirección actual: {client?.installationAddress?.trim() || "Sin registrar"}</p>
                          )}
                        </div>
                        <StatusBadge status={order.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {order.scheduledAt && order.scheduledEndAt
                          ? `${supportDate(order.scheduledAt)} – ${supportDate(order.scheduledEndAt)}`
                          : order.scheduledAt ? `${supportDate(order.scheduledAt)} · sin fin` : "Sin horario programado"}
                        {" · "}{assignedPerson?.username ?? "Sin asignar"}
                      </p>
                      {(order.signalDbm !== null || order.ccq !== null) && <p className="text-xs text-muted-foreground">Señal: {order.signalDbm === null ? "—" : `${order.signalDbm} dBm`} · CCQ: {order.ccq === null ? "—" : `${order.ccq}%`}</p>}
                      {(order.installedEquipment || order.installedSerialNumber) && <p className="text-xs text-muted-foreground">Equipo: {order.installedEquipment ?? "—"} · Serie: {order.installedSerialNumber ?? "—"}</p>}
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Select value={edit.assignedToUserId || "unassigned"} onValueChange={value => changeOrderEdit(order, { assignedToUserId: value === "unassigned" ? "" : value })}>
                          <SelectTrigger aria-label="Responsable"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Sin asignar</SelectItem>
                            {technicians.map(person => <SelectItem key={person.id} value={String(person.id)}>{person.username}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input aria-label="Inicio programado" type="datetime-local" value={edit.scheduledAt} onChange={e => changeOrderEdit(order, { scheduledAt: e.target.value })} />
                        <Input aria-label="Fin programado" type="datetime-local" value={edit.scheduledEndAt} onChange={e => changeOrderEdit(order, { scheduledEndAt: e.target.value })} />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input aria-label="Señal del enlace en dBm" type="number" min="-120" max="0" step="0.1" value={edit.signalDbm} onChange={e => changeOrderEdit(order, { signalDbm: e.target.value })} placeholder="Señal (dBm)" />
                        <Input aria-label="CCQ en porcentaje" type="number" min="0" max="100" step="0.1" value={edit.ccq} onChange={e => changeOrderEdit(order, { ccq: e.target.value })} placeholder="CCQ (%)" />
                        <Input aria-label="Equipo instalado" maxLength={200} value={edit.installedEquipment} onChange={e => changeOrderEdit(order, { installedEquipment: e.target.value })} placeholder="Equipo instalado" />
                        <Input aria-label="Número de serie instalado" maxLength={128} value={edit.installedSerialNumber} onChange={e => changeOrderEdit(order, { installedSerialNumber: e.target.value })} placeholder="Número de serie" />
                      </div>
                      {invalidEditSchedule && <p className="text-xs text-amber-400">El horario requiere inicio y fin válidos.</p>}
                      {invalidEditMetrics && <p className="text-xs text-amber-400">Señal: -120 a 0 dBm; CCQ: 0 a 100 %.</p>}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={invalidEditSchedule || invalidEditMetrics} onClick={() => void saveOrderEdit(order)}>Guardar cambios</Button>
                        <Button size="sm" disabled={invalidEditSchedule || invalidEditMetrics} onClick={() => void completeWorkOrder(order)}>
                          {order.type.toLowerCase() === "relocation" ? "Completar reubicación" : "Completar visita"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Bloques de disponibilidad <Badge variant="outline" className="ml-2">{availability.length}</Badge></CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {availability.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No hay bloques registrados.</p> : availability.map(block => {
                  const person = technicians.find(item => item.id === block.technicianUserId);
                  return (
                    <div key={block.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/50 p-3">
                      <div>
                        <p className="font-medium">{person?.username ?? `Usuario #${block.technicianUserId}`}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{supportDate(block.startsAt)} – {supportDate(block.endsAt)}</p>
                        {block.notes && <p className="mt-1 text-sm text-muted-foreground">{block.notes}</p>}
                      </div>
                      <Button size="sm" variant="ghost" aria-label={`Eliminar disponibilidad de ${person?.username ?? "usuario"}`} onClick={() => void removeAvailability(block)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
          <Card className="mt-6">
            <CardHeader><CardTitle className="text-base">Historial de visitas <Badge variant="outline" className="ml-2">{visitHistory.length}</Badge></CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input
                aria-label="Buscar en el historial de visitas"
                value={historyQuery}
                onChange={event => setHistoryQuery(event.target.value)}
                placeholder="Buscar por cliente, dirección, equipo, serie o técnico"
              />
              {visitHistory.length === 0
                ? <p className="py-8 text-center text-sm text-muted-foreground">{historyQuery ? "No hay visitas que coincidan con la búsqueda." : "Las órdenes finalizadas aparecerán aquí."}</p>
                : <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                  {visitHistory.map(order => {
                    const client = clients.find(item => item.id === order.clientId);
                    const assignedPerson = technicians.find(person => person.id === order.assignedToUserId);
                    const visitDate = order.completedAt ?? order.scheduledAt ?? order.createdAt;
                    return (
                      <div key={order.id} className="space-y-2 rounded-lg border border-border/50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">#{order.id} · {order.type.replaceAll("_", " ")}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{client ? `${client.name} · Cliente #${client.id}` : order.clientId ? `Cliente #${order.clientId}` : "Sin cliente"} · {assignedPerson?.username ?? "Sin asignar"}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{supportDate(visitDate)} · {order.address ?? "Sin dirección"}</p>
                          </div>
                          <StatusBadge status={order.status} />
                        </div>
                        {order.notes && <p className="text-sm text-muted-foreground">{order.notes}</p>}
                        {(order.signalDbm !== null || order.ccq !== null) && <p className="text-xs text-muted-foreground">Señal: {order.signalDbm === null ? "—" : `${order.signalDbm} dBm`} · CCQ: {order.ccq === null ? "—" : `${order.ccq}%`}</p>}
                        {(order.installedEquipment || order.installedSerialNumber) && <p className="text-xs text-muted-foreground">Equipo: {order.installedEquipment ?? "—"} · Serie: {order.installedSerialNumber ?? "—"}</p>}
                      </div>
                    );
                  })}
                </div>}
            </CardContent>
          </Card>
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

function SupportDesk() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [assignmentId, setAssignmentId] = useState("");
  const [filters, setFilters] = useState({ status: "all", priority: "all", assignee: "", sla: "all", q: "" });
  const [comment, setComment] = useState("");
  const [internal, setInternal] = useState(false);
  const [newTicket, setNewTicket] = useState({ subject: "", description: "", category: "support", priority: "normal" });
  const [showNew, setShowNew] = useState(false);
  const [showPolicies, setShowPolicies] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [visibleToClient, setVisibleToClient] = useState(false);
  const [busy, setBusy] = useState(false);

  const params = {
    ...(filters.status !== "all" ? { status: filters.status } : {}),
    ...(filters.priority !== "all" ? { priority: filters.priority as "low" | "normal" | "high" | "critical" } : {}),
    ...(filters.assignee ? { assignedToUserId: filters.assignee } : {}),
    ...(filters.sla !== "all" ? { sla: filters.sla as "overdue" | "first_response" | "resolution" } : {}),
    ...(filters.q ? { q: filters.q } : {}),
  };
  const ticketsQuery = useListSupportTickets(params, { query: { queryKey: getListSupportTicketsQueryKey(params), staleTime: 15_000, refetchInterval: 30_000 } });
  const notificationsQuery = useListUserNotifications({ query: { queryKey: getListUserNotificationsQueryKey(), staleTime: 10_000, refetchInterval: 30_000 } });
  const policiesQuery = useListTicketSlaPolicies({ query: { queryKey: getListTicketSlaPoliciesQueryKey(), enabled: showPolicies } });
  const detailQuery = useGetSupportTicket(selectedId ?? 0, { query: { queryKey: getGetSupportTicketQueryKey(selectedId ?? 0), enabled: selectedId !== null } });
  const historyQuery = useListSupportTicketHistory(selectedId ?? 0, { query: { queryKey: getListSupportTicketHistoryQueryKey(selectedId ?? 0), enabled: selectedId !== null } });
  const attachmentsQuery = useListSupportTicketAttachments(selectedId ?? 0, { query: { queryKey: getListSupportTicketAttachmentsQueryKey(selectedId ?? 0), enabled: selectedId !== null } });
  const createMutation = useCreateSupportTicket();
  const updateMutation = useUpdateSupportTicket();
  const commentMutation = useAddSupportTicketComment();
  const uploadMutation = useUploadSupportTicketAttachment();
  const reopenMutation = useUpdateTicketClientReopenPermission();
  const readMutation = useMarkUserNotificationRead();
  const policyMutation = useUpdateTicketSlaPolicy();
  const tickets = ticketsQuery.data ?? [];
  const selected = detailQuery.data;
  const notifications = notificationsQuery.data ?? [];

  useEffect(() => {
    setAssignmentId(selected?.assignedToUserId ? String(selected.assignedToUserId) : "");
  }, [selected?.id, selected?.assignedToUserId]);

  const invalidateTicket = () => {
    void queryClient.invalidateQueries({ queryKey: getListSupportTicketsQueryKey(params) });
    if (selectedId !== null) {
      void queryClient.invalidateQueries({ queryKey: getGetSupportTicketQueryKey(selectedId) });
      void queryClient.invalidateQueries({ queryKey: getListSupportTicketHistoryQueryKey(selectedId) });
      void queryClient.invalidateQueries({ queryKey: getListSupportTicketAttachmentsQueryKey(selectedId) });
    }
  };
  const fail = (title: string, error: unknown) => toast({ title, description: error instanceof Error ? error.message : "Intenta de nuevo.", variant: "destructive" });
  const transition = (status: "open" | "in_progress" | "resolved" | "closed") => {
    if (!selected || updateMutation.isPending) return;
    updateMutation.mutate({ id: selected.id, data: { status, reason: `Transición operativa a ${status.replace("_", " ")}` } }, {
      onSuccess: () => { invalidateTicket(); toast({ title: "Estado actualizado", description: `Ticket #${selected.id} ahora está ${status.replace("_", " ")}.` }); },
      onError: error => fail("No se pudo cambiar el estado", error),
    });
  };
  const saveAssignee = () => {
    if (!selected || updateMutation.isPending) return;
    const value = assignmentId.trim();
    const assignedToUserId = value ? Number(value) : null;
    if (value && (!Number.isInteger(assignedToUserId) || assignedToUserId! < 1)) {
      toast({ title: "Responsable inválido", description: "Usa el ID numérico de una cuenta existente.", variant: "destructive" });
      return;
    }
    updateMutation.mutate({ id: selected.id, data: { assignedToUserId } }, {
      onSuccess: () => {
        invalidateTicket();
        toast({ title: assignedToUserId ? "Ticket asignado" : "Ticket sin responsable" });
      },
      onError: error => fail("No se pudo asignar el ticket", error),
    });
  };
  const addComment = () => {
    if (!selected || !comment.trim()) return;
    commentMutation.mutate({ id: selected.id, data: { body: comment.trim(), internal } }, {
      onSuccess: () => { setComment(""); invalidateTicket(); toast({ title: internal ? "Nota interna añadida" : "Respuesta publicada" }); },
      onError: error => fail("No se pudo añadir el comentario", error),
    });
  };
  const create = () => {
    if (!newTicket.subject.trim() || !newTicket.description.trim()) return;
    createMutation.mutate({ data: { ...newTicket, priority: newTicket.priority as "low" | "normal" | "high" | "critical" } }, {
      onSuccess: ticket => { setShowNew(false); setNewTicket({ subject: "", description: "", category: "support", priority: "normal" }); setSelectedId(ticket.id); void queryClient.invalidateQueries({ queryKey: getListSupportTicketsQueryKey(params) }); toast({ title: "Ticket creado", description: `Ticket #${ticket.id} listo para seguimiento.` }); },
      onError: error => fail("No se pudo crear el ticket", error),
    });
  };
  const upload = async () => {
    if (!selected || !file) return;
    if (file.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
      toast({ title: "Archivo no admitido", description: "Usa JPEG, PNG, WebP o PDF de hasta 2 MB.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const dataBase64 = await fileToBase64(file);
      uploadMutation.mutate({ id: selected.id, data: { fileName: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp" | "application/pdf", dataBase64, visibleToClient } }, {
        onSuccess: () => { setFile(null); setVisibleToClient(false); invalidateTicket(); toast({ title: "Evidencia guardada", description: visibleToClient ? "El cliente podrá verla en su portal." : "La evidencia queda privada para el equipo." }); },
        onError: error => fail("No se pudo cargar la evidencia", error),
      });
    } catch (error) { fail("No se pudo leer el archivo", error); } finally { setBusy(false); }
  };
  const download = async (attachment: SupportTicketAttachment) => {
    if (selectedId === null) return;
    try {
      const blob = await downloadSupportTicketAttachment(selectedId, attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = attachment.fileName; link.click(); URL.revokeObjectURL(url);
    } catch (error) { fail("No se pudo descargar la evidencia", error); }
  };
  const markRead = (notification: SupportNotification) => {
    if (notification.readAt) return;
    readMutation.mutate({ id: notification.id }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListUserNotificationsQueryKey() }), onError: error => fail("No se pudo actualizar la notificación", error) });
  };
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-border/60 bg-card/50 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Cola visible</p><p className="mt-2 text-2xl font-semibold">{tickets.length}</p><p className="mt-1 text-xs text-muted-foreground">con los filtros actuales</p></div>
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-300">Atención SLA</p><p className="mt-2 text-2xl font-semibold text-red-200">{tickets.filter(ticket => ticket.firstResponseSla === "breached" || ticket.resolutionSla === "breached").length}</p><p className="mt-1 text-xs text-red-200/70">requieren seguimiento</p></div>
      <div className="rounded-xl border border-border/60 bg-card/50 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Notificaciones</p><p className="mt-2 text-2xl font-semibold">{notifications.filter(item => !item.readAt).length}</p><p className="mt-1 text-xs text-muted-foreground">sin leer</p></div>
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(460px,1.1fr)]">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/50 bg-muted/10 pb-4">
          <div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">Cola de soporte</CardTitle><p className="mt-1 text-xs text-muted-foreground">Prioriza por vencimiento, impacto y responsable.</p></div><Button size="sm" onClick={() => setShowNew(value => !value)} data-testid="button-new-support-ticket"><Plus className="mr-2 h-4 w-4" />Nuevo</Button></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="relative sm:col-span-2"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input data-testid="input-ticket-search" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} placeholder="Buscar asunto o descripción..." className="pl-9" /></div>
            <Select value={filters.status} onValueChange={status => setFilters({ ...filters, status })}><SelectTrigger data-testid="select-ticket-status"><SelectValue placeholder="Estado" /></SelectTrigger><SelectContent><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="open">Abierto</SelectItem><SelectItem value="in_progress">En atención</SelectItem><SelectItem value="resolved">Resuelto</SelectItem><SelectItem value="closed">Cerrado</SelectItem></SelectContent></Select>
            <Select value={filters.priority} onValueChange={priority => setFilters({ ...filters, priority })}><SelectTrigger data-testid="select-ticket-priority"><SelectValue placeholder="Prioridad" /></SelectTrigger><SelectContent><SelectItem value="all">Todas las prioridades</SelectItem><SelectItem value="critical">Crítica</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="low">Baja</SelectItem></SelectContent></Select>
             <div className="flex gap-2 sm:col-span-2">
               <Input data-testid="input-ticket-assignee" value={filters.assignee === "unassigned" ? "" : filters.assignee} disabled={filters.assignee === "unassigned"} onChange={event => setFilters({ ...filters, assignee: event.target.value.replace(/\D/g, "") })} placeholder="ID de responsable" />
               <Button type="button" size="sm" variant={filters.assignee === "unassigned" ? "default" : "outline"} onClick={() => setFilters({ ...filters, assignee: filters.assignee === "unassigned" ? "" : "unassigned" })}>{filters.assignee === "unassigned" ? "Sin asignar: activo" : "Sin asignar"}</Button>
             </div>
            <Select value={filters.sla} onValueChange={sla => setFilters({ ...filters, sla })}><SelectTrigger data-testid="select-ticket-sla"><SelectValue placeholder="SLA" /></SelectTrigger><SelectContent><SelectItem value="all">Todos los SLA</SelectItem><SelectItem value="overdue">Vencidos</SelectItem><SelectItem value="first_response">Primera respuesta</SelectItem><SelectItem value="resolution">Resolución</SelectItem></SelectContent></Select>
          </div>
        </CardHeader>
        <CardContent className="max-h-[720px] space-y-2 overflow-y-auto p-3">
          {ticketsQuery.isLoading ? <div className="space-y-2">{[1, 2, 3, 4].map(item => <div key={item} className="h-24 animate-pulse rounded-lg bg-muted/30" />)}</div> : ticketsQuery.isError ? <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-200">No se pudo cargar la cola. <Button variant="outline" size="sm" className="ml-2" onClick={() => void ticketsQuery.refetch()}>Reintentar</Button></div> : tickets.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground"><Ticket className="mx-auto mb-3 h-8 w-8 opacity-40" />No hay tickets con estos filtros.</div> : tickets.map(ticket => <button key={ticket.id} data-testid={`button-ticket-${ticket.id}`} onClick={() => setSelectedId(ticket.id)} className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/20 ${selectedId === ticket.id ? "border-primary/60 bg-primary/[0.06]" : "border-border/50"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">#{ticket.id} {ticket.subject}</p><p className="mt-1 truncate text-xs text-muted-foreground">{supportTicketCategoryLabel(ticket.category)} · {supportTicketClientLabel(ticket)}</p></div><StatusBadge status={ticket.status} /></div><div className="mt-3 flex flex-wrap items-center gap-2"><Badge variant="outline" className={ticket.priority === "critical" ? "border-red-500/40 text-red-300" : ""}>{ticket.priority}</Badge><SlaPill value={ticket.firstResponseSla} dueAt={ticket.firstResponseDueAt} /><span className="ml-auto text-[11px] text-muted-foreground">{supportDate(ticket.updatedAt)}</span></div></button>)}
        </CardContent>
      </Card>
      <div className="space-y-4">
        {showNew && <Card><CardHeader><CardTitle className="text-base">Abrir ticket operativo</CardTitle></CardHeader><CardContent className="space-y-3"><Input data-testid="input-new-ticket-subject" value={newTicket.subject} onChange={event => setNewTicket({ ...newTicket, subject: event.target.value })} placeholder="Asunto" /><Textarea data-testid="input-new-ticket-description" value={newTicket.description} onChange={event => setNewTicket({ ...newTicket, description: event.target.value })} placeholder="Describe el incidente o solicitud" /><div className="grid grid-cols-2 gap-2"><Input value={newTicket.category} onChange={event => setNewTicket({ ...newTicket, category: event.target.value })} placeholder="Categoría" /><Select value={newTicket.priority} onValueChange={priority => setNewTicket({ ...newTicket, priority })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Baja</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="critical">Crítica</SelectItem></SelectContent></Select></div><Button onClick={create} disabled={createMutation.isPending} data-testid="button-create-ticket">{createMutation.isPending ? "Creando..." : "Crear ticket"}</Button></CardContent></Card>}
        {!selected && !showNew && <Card className="border-dashed"><CardContent className="flex min-h-[300px] flex-col items-center justify-center text-center"><Ticket className="mb-3 h-9 w-9 text-primary/60" /><p className="font-medium">Selecciona un ticket</p><p className="mt-1 max-w-xs text-sm text-muted-foreground">Aquí verás contexto, SLA, historial, evidencia y notas de soporte.</p></CardContent></Card>}
        {selected && <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-48 flex-1"><Label htmlFor="ticket-assignment">Responsable actual: {selected.assignedToUserId ?? "Sin asignar"}</Label><Input id="ticket-assignment" data-testid="input-ticket-assignment" type="number" min="1" step="1" value={assignmentId} onChange={event => setAssignmentId(event.target.value)} placeholder="ID de usuario" className="mt-1" /></div>
          <Button size="sm" onClick={saveAssignee} disabled={updateMutation.isPending}>{updateMutation.isPending ? "Guardando..." : assignmentId ? "Asignar" : "Quitar responsable"}</Button>
        </CardContent></Card>}
        {selected && <TicketDetail ticket={selected} history={historyQuery.data ?? []} attachments={attachmentsQuery.data ?? []} historyLoading={historyQuery.isLoading} attachmentsLoading={attachmentsQuery.isLoading} comment={comment} setComment={setComment} internal={internal} setInternal={setInternal} onComment={addComment} commentPending={commentMutation.isPending} onTransition={transition} onUpload={upload} file={file} setFile={setFile} visibleToClient={visibleToClient} setVisibleToClient={setVisibleToClient} busy={busy || uploadMutation.isPending} onDownload={download} onReopen={() => reopenMutation.mutate({ id: selected.id, data: { enabled: !selected.clientReopenEnabled } }, { onSuccess: () => { invalidateTicket(); toast({ title: "Permiso actualizado" }); }, onError: error => fail("No se pudo cambiar el permiso", error) })} />
        }
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4 text-primary" />Actividad para operadores</CardTitle><p className="mt-1 text-xs text-muted-foreground">Actualizaciones de tickets asignados a tu usuario.</p></div><Button variant="ghost" size="sm" onClick={() => void notificationsQuery.refetch()}><RefreshCw className="h-4 w-4" /></Button></CardHeader><CardContent className="space-y-2">{notificationsQuery.isLoading ? <div className="h-20 animate-pulse rounded-lg bg-muted/30" /> : notifications.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No hay notificaciones.</p> : notifications.slice(0, 5).map(notification => <button key={notification.id} data-testid={`button-notification-${notification.id}`} onClick={() => markRead(notification)} className={`w-full rounded-lg border p-3 text-left ${notification.readAt ? "border-border/40 opacity-70" : "border-primary/30 bg-primary/[0.04]"}`}><div className="flex items-start gap-3"><div className={`mt-1 h-2 w-2 rounded-full ${notification.readAt ? "bg-muted-foreground/40" : "bg-primary"}`} /><div className="min-w-0"><p className="text-sm font-medium">{notification.title}</p><p className="mt-1 text-xs text-muted-foreground">{notification.message}</p><p className="mt-2 text-[11px] text-muted-foreground">{supportDate(notification.createdAt)}{notification.readAt ? " · Leída" : " · Marcar como leída"}</p></div></div></button>)}</CardContent></Card>
      <SlaPolicies policies={policiesQuery.data ?? []} open={showPolicies} onToggle={() => setShowPolicies(value => !value)} onSave={(priority, data) => policyMutation.mutate({ priority, data }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListTicketSlaPoliciesQueryKey() }); toast({ title: "Objetivos SLA guardados" }); }, onError: error => fail("No se pudo guardar el SLA", error) })} pending={policyMutation.isPending} />
    </div>
  </div>;
}

function TicketDetail({ ticket, history, attachments, historyLoading, attachmentsLoading, comment, setComment, internal, setInternal, onComment, commentPending, onTransition, onUpload, file, setFile, visibleToClient, setVisibleToClient, busy, onDownload, onReopen }: {
  ticket: SupportTicket & { comments: Array<{ id: number; body: string; internal: boolean; createdAt: string }> };
  history: Array<{ id: number; fromStatus?: string | null; toStatus: string; actorType: string; actorName?: string | null; reason?: string | null; createdAt: string }>;
  attachments: SupportTicketAttachment[];
  historyLoading: boolean;
  attachmentsLoading: boolean;
  comment: string;
  setComment: (value: string) => void;
  internal: boolean;
  setInternal: (value: boolean) => void;
  onComment: () => void;
  commentPending: boolean;
  onTransition: (status: "open" | "in_progress" | "resolved" | "closed") => void;
  onUpload: () => void;
  file: File | null;
  setFile: (file: File | null) => void;
  visibleToClient: boolean;
  setVisibleToClient: (value: boolean) => void;
  busy: boolean;
  onDownload: (attachment: SupportTicketAttachment) => void;
  onReopen: () => void;
}) {
  return <Card className="overflow-hidden"><CardHeader className="border-b border-border/50 bg-muted/10"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">Ticket #{ticket.id} · {supportTicketCategoryLabel(ticket.category)}</p><CardTitle className="mt-1 text-xl">{ticket.subject}</CardTitle><p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">{ticket.description}</p></div><div className="flex flex-wrap gap-2"><StatusBadge status={ticket.status} /><Badge variant="outline">{ticket.priority}</Badge></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-lg border border-border/50 bg-background/20 p-3"><p className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Primera respuesta</p><p className="mt-2 text-sm font-medium">{supportDate(ticket.firstResponseDueAt)}</p><SlaPill value={ticket.firstResponseSla} dueAt={ticket.firstResponseDueAt} /></div><div className="rounded-lg border border-border/50 bg-background/20 p-3"><p className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Resolución</p><p className="mt-2 text-sm font-medium">{supportDate(ticket.resolutionDueAt)}</p><SlaPill value={ticket.resolutionSla} dueAt={ticket.resolutionDueAt} /></div></div></CardHeader><CardContent className="space-y-5 p-4">
    <div className="flex flex-wrap gap-2">
      {ticket.status === "open" && <Button size="sm" variant="outline" onClick={() => onTransition("in_progress")}>Tomar en atención</Button>}
      {ticket.status === "in_progress" && <>
        <Button size="sm" variant="outline" onClick={() => onTransition("open")}>Devolver a abierto</Button>
        <Button size="sm" variant="outline" onClick={() => onTransition("resolved")}>Marcar resuelto</Button>
      </>}
      {ticket.status === "resolved" && <>
        <Button size="sm" variant="outline" onClick={() => onTransition("in_progress")}>Reabrir atención</Button>
        <Button size="sm" variant="outline" onClick={() => onTransition("closed")}>Cerrar</Button>
      </>}
      {ticket.status === "closed" && ticket.clientId !== null && <Button size="sm" variant="ghost" onClick={onReopen}><UserRound className="mr-2 h-4 w-4" />{ticket.clientReopenEnabled ? "Revocar reapertura" : "Permitir reapertura"}</Button>}
    </div>
    <div><div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4 text-primary" />Conversación y notas</h3><span className="text-xs text-muted-foreground">{ticket.comments.length} entradas</span></div><div className="max-h-64 space-y-2 overflow-y-auto pr-1">{ticket.comments.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Sin comentarios todavía.</p> : ticket.comments.map(item => <div key={item.id} className={`rounded-lg border p-3 ${item.internal ? "border-amber-500/25 bg-amber-500/[0.05]" : "border-border/50"}`}><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.internal ? "Nota interna" : "Visible para cliente"}</span><span className="text-[11px] text-muted-foreground">{supportDate(item.createdAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm">{item.body}</p></div>)}</div><div className="mt-3 space-y-2"><Textarea data-testid="textarea-ticket-comment" value={comment} onChange={event => setComment(event.target.value)} placeholder={internal ? "Añade contexto para el equipo..." : "Escribe una respuesta para el cliente..."} /><div className="flex flex-wrap items-center justify-between gap-2"><label className="flex items-center gap-2 text-xs text-muted-foreground"><input data-testid="checkbox-internal-comment" type="checkbox" checked={internal} onChange={event => setInternal(event.target.checked)} />Nota interna</label><Button size="sm" onClick={onComment} disabled={!comment.trim() || commentPending}><Send className="mr-2 h-4 w-4" />{commentPending ? "Publicando..." : "Añadir comentario"}</Button></div></div></div>
    <div><div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="h-4 w-4 text-primary" />Evidencia privada</h3><span className="text-xs text-muted-foreground">Máximo 2 MB</span></div><div className="space-y-2">{attachmentsLoading ? <div className="h-12 animate-pulse rounded-lg bg-muted/30" /> : attachments.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No hay archivos adjuntos.</p> : attachments.map(fileItem => <div key={fileItem.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3"><div className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="truncate text-sm">{fileItem.fileName}</p><p className="text-[11px] text-muted-foreground">{Math.ceil(fileItem.sizeBytes / 1024)} KB · {fileItem.visibleToClient ? "Visible al cliente" : "Solo equipo"} · {supportDate(fileItem.createdAt)}</p></div></div><Button size="sm" variant="ghost" onClick={() => onDownload(fileItem)}><Download className="h-4 w-4" /></Button></div>)}</div><div className="mt-3 flex flex-wrap items-center gap-2"><Input key={file?.name ?? "empty"} data-testid="input-ticket-attachment" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} className="max-w-xs" /><label className="flex items-center gap-2 text-xs text-muted-foreground"><input data-testid="checkbox-attachment-visible" type="checkbox" checked={visibleToClient} onChange={event => setVisibleToClient(event.target.checked)} />Visible al cliente</label><Button size="sm" variant="outline" onClick={onUpload} disabled={!file || busy}>Cargar</Button></div></div>
    <details className="group rounded-lg border border-border/50"><summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-semibold"><History className="h-4 w-4 text-primary" />Historial de estados <span className="ml-auto text-xs font-normal text-muted-foreground">{historyLoading ? "Cargando..." : `${history.length} cambios`}</span></summary><div className="space-y-3 border-t border-border/50 p-3">{history.length === 0 ? <p className="text-xs text-muted-foreground">Sin cambios registrados.</p> : history.map(event => <div key={event.id} className="relative border-l border-primary/30 pl-4 text-xs"><div className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-primary" /><p className="font-medium">{event.fromStatus ?? "Nuevo"} → {event.toStatus}</p><p className="mt-1 text-muted-foreground">{event.actorName ?? event.actorType} · {supportDate(event.createdAt)}</p>{event.reason && <p className="mt-1 text-muted-foreground">{event.reason}</p>}</div>)}</div></details>
  </CardContent></Card>;
}

function SlaPolicies({ policies, open, onToggle, onSave, pending }: { policies: SupportTicketSlaPolicy[]; open: boolean; onToggle: () => void; onSave: (priority: "low" | "normal" | "high" | "critical", data: { firstResponseMinutes: number; resolutionMinutes: number }) => void; pending: boolean }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="text-base">Objetivos SLA</CardTitle><p className="mt-1 text-xs text-muted-foreground">Minutos corridos aplicados a tickets nuevos.</p></div><Button variant="outline" size="sm" onClick={onToggle}>{open ? "Ocultar" : "Editar objetivos"}</Button></CardHeader>{open && <CardContent className="space-y-2">{policies.length === 0 ? <p className="text-sm text-muted-foreground">No hay políticas disponibles.</p> : policies.map(policy => <PolicyRow key={policy.priority} policy={policy} onSave={onSave} pending={pending} />)}</CardContent>}</Card>;
}

function PolicyRow({ policy, onSave, pending }: { policy: SupportTicketSlaPolicy; onSave: (priority: "low" | "normal" | "high" | "critical", data: { firstResponseMinutes: number; resolutionMinutes: number }) => void; pending: boolean }) {
  const [first, setFirst] = useState(String(policy.firstResponseMinutes));
  const [resolution, setResolution] = useState(String(policy.resolutionMinutes));
  return <div className="grid grid-cols-[0.8fr_1fr_1fr_auto] items-end gap-2 rounded-lg border border-border/50 p-3"><div><p className="text-sm font-medium capitalize">{policy.priority}</p><p className="text-[10px] text-muted-foreground">minutos</p></div><div><Label className="text-[10px]">Primera respuesta</Label><Input value={first} onChange={event => setFirst(event.target.value)} type="number" min="1" /></div><div><Label className="text-[10px]">Resolución</Label><Input value={resolution} onChange={event => setResolution(event.target.value)} type="number" min="1" /></div><Button size="sm" variant="outline" disabled={pending} onClick={() => onSave(policy.priority, { firstResponseMinutes: Number(first), resolutionMinutes: Number(resolution) })}>Guardar</Button></div>;
}