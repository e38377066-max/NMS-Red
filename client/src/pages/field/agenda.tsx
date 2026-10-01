import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useCreateSupportTicket, useListMyFieldWorkOrders, type FieldWorkOrder } from "@workspace/api-client-react";
import { Activity, AlertCircle, ArrowRight, CalendarDays, Check, ChevronRight, Clock3, MapPin, Plus, RefreshCw, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { orderStatus, orderType, terminalOrder, visitAddress, visitWindow } from "@/lib/field-work";

type Filter = "active" | "history";

const statusTone = (status: string) => status.toLowerCase() === "in_progress"
  ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
  : status.toLowerCase() === "completed"
    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
    : "border-amber-300/25 bg-amber-300/10 text-amber-200";

export default function FieldAgenda() {
  const query = useListMyFieldWorkOrders();
  const ticketMutation = useCreateSupportTicket();
  const user = getCurrentUser();
  const [filter, setFilter] = useState<Filter>("active");
  const [dialog, setDialog] = useState(false);
  const [client, setClient] = useState("");
  const [device, setDevice] = useState("");
  const [details, setDetails] = useState("");
  const [formError, setFormError] = useState("");
  const [sentId, setSentId] = useState<number | null>(null);
  const orders = query.data ?? [];
  const active = useMemo(() => orders.filter(o => !terminalOrder(o)).sort((a,b) => Date.parse(a.scheduledAt ?? a.createdAt) - Date.parse(b.scheduledAt ?? b.createdAt)), [orders]);
  const history = useMemo(() => orders.filter(terminalOrder).sort((a,b) => Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt)), [orders]);
  const visible = filter === "active" ? active : history;

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!client.trim()) { setFormError("Indica el cliente o la dirección del servicio."); return; }
    setFormError("");
    try {
      const ticket = await ticketMutation.mutateAsync({ data: {
        subject: `Solicitud de alineación: ${client.trim()}`.slice(0, 200),
        description: [`Solicitud desde la agenda de campo por ${user?.username ?? "un técnico"}.`, `Cliente o dirección: ${client.trim()}`, device.trim() ? `Equipo, MAC o IP: ${device.trim()}` : "", details.trim() ? `Contexto: ${details.trim()}` : "", "No es una orden de trabajo. Supervisión debe revisar y asignar una orden antes de consultar o contactar radios."].filter(Boolean).join("\n\n").slice(0, 4000),
        category: "alignment_request",
        priority: "normal",
      } });
      setSentId(ticket.id);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo enviar. Comprueba la conexión e inténtalo de nuevo.");
    }
  };
  const closeDialog = () => { setDialog(false); setSentId(null); setClient(""); setDevice(""); setDetails(""); setFormError(""); };

  return <main className="min-h-[100dvh] bg-background text-foreground">
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-5 sm:px-7 sm:pt-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[.18em] text-primary"><Activity className="h-4 w-4"/> IMPERIO AP <span className="text-muted-foreground">/ CAMPO</span></p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Agenda de hoy</h1>
          <p className="mt-1 text-sm text-muted-foreground">Solo visitas asignadas a tu cuenta.</p>
        </div>
        <Link href="/field/account" aria-label="Mi cuenta" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-primary"><UserRound className="h-5 w-5"/></Link>
      </header>
      <section className="mb-6 grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[.07] p-4 sm:p-5">
        <div><div className="text-xs font-semibold uppercase tracking-wider text-primary">Tu ruta asignada</div><div className="mt-1 text-2xl font-semibold">{active.length}<span className="ml-2 text-sm font-normal text-muted-foreground">{active.length === 1 ? "visita pendiente" : "visitas pendientes"}</span></div></div>
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><CalendarDays className="h-6 w-6"/></div>
      </section>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Filtrar agenda">
          {(["active","history"] as Filter[]).map(tab => <button key={tab} role="tab" aria-selected={filter===tab} onClick={()=>setFilter(tab)} className={`min-h-10 rounded-lg px-4 text-sm font-medium transition-colors ${filter===tab?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}>{tab==="active"?`Activas · ${active.length}`:`Historial · ${history.length}`}</button>)}
        </div>
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Actualizar agenda" onClick={()=>query.refetch()} disabled={query.isFetching}><RefreshCw className={`h-4 w-4 ${query.isFetching?"animate-spin":""}`}/></Button>
      </div>
      {query.isLoading ? <div className="space-y-3" aria-label="Cargando agenda">{[1,2,3].map(n=><div key={n} className="h-32 animate-pulse rounded-2xl border border-border bg-card"/> )}</div>
      : query.isError ? <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><AlertCircle className="mb-3 h-5 w-5 text-destructive"/><h2 className="font-semibold">No se pudo cargar la agenda</h2><p className="mt-1 text-sm text-muted-foreground">Revisa la conexión. Esta lista muestra únicamente órdenes asignadas por supervisión.</p><Button className="mt-4 min-h-11" variant="outline" onClick={()=>query.refetch()}>Reintentar</Button></div>
      : visible.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-card/50 px-5 py-10 text-center"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><CalendarDays className="h-6 w-6"/></div><h2 className="font-semibold">{filter==="active"?"No tienes visitas asignadas":"Aún no hay visitas en el historial"}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{filter==="active"?"Cuando supervisión te asigne una orden, aparecerá aquí. Puedes solicitar una alineación para revisión, sin contactar radios.":"Las órdenes completadas aparecerán aquí."}</p></div>
      : <div className="space-y-3">{visible.map(order=><OrderRow key={order.id} order={order}/>)}</div>}
      <section className="mt-8 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Activity className="h-5 w-5"/></div>
          <div className="flex-1"><h2 className="font-semibold">¿Necesitas una alineación?</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Pide a supervisión que revise el caso. Esta solicitud no es una orden.</p>
            <Button className="mt-3 min-h-11 w-full sm:w-auto" variant="outline" onClick={()=>setDialog(true)}><Plus className="mr-2 h-4 w-4"/>Solicitar revisión</Button>
          </div>
        </div>
        <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">No se contacta ni se consulta ningún radio hasta que supervisión asigne una orden de trabajo.</p>
      </section>
    </div>
    {dialog && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)closeDialog();}}>
      <section role="dialog" aria-modal="true" aria-labelledby="request-title" className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-bold tracking-widest text-primary">SOLICITUD A SUPERVISIÓN</p><h2 id="request-title" className="mt-2 text-xl font-semibold">{sentId?"Solicitud recibida":"Revisión de alineación"}</h2></div><Button variant="ghost" size="icon" aria-label="Cerrar" onClick={closeDialog}><X className="h-5 w-5"/></Button></div>
        {sentId ? <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-4"><Check className="mb-2 h-5 w-5 text-emerald-300"/><p className="font-medium">Solicitud #{sentId} enviada</p><p className="mt-1 text-sm text-muted-foreground">Un supervisor debe revisarla y asignar una orden antes de realizar cualquier lectura de radio.</p><Button className="mt-4 min-h-11" onClick={closeDialog}>Listo</Button></div> : <form onSubmit={submitRequest} className="space-y-4">
          <p className="text-sm leading-5 text-muted-foreground">Esto abre un ticket de revisión; no activa una alineación ni contacta equipos.</p>
          <div className="space-y-2"><Label htmlFor="request-client">Cliente o dirección *</Label><Input id="request-client" value={client} onChange={e=>setClient(e.target.value)} maxLength={180} required placeholder="Nombre del cliente o dirección" className="min-h-12"/></div>
          <div className="space-y-2"><Label htmlFor="request-device">Equipo, MAC o IP (opcional)</Label><Input id="request-device" value={device} onChange={e=>setDevice(e.target.value)} maxLength={180} className="min-h-12"/></div>
          <div className="space-y-2"><Label htmlFor="request-context">Contexto (opcional)</Label><Textarea id="request-context" value={details} onChange={e=>setDetails(e.target.value)} maxLength={2500} rows={3}/></div>
          {formError&&<p role="alert" className="text-sm text-destructive">{formError}</p>}
          <Button className="min-h-12 w-full" disabled={ticketMutation.isPending}>{ticketMutation.isPending?"Enviando…":"Enviar a supervisión"}<ArrowRight className="ml-2 h-4 w-4"/></Button>
        </form>}
      </section>
    </div>}
  </main>;
}

function OrderRow({order}:{order:FieldWorkOrder}) {
  return <Link href={`/field/orders/${order.id}`} className="group block rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 sm:p-5">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-primary">{orderType(order.type)} <span className="text-muted-foreground">· #{order.id}</span></p><h2 className="mt-1 text-lg font-semibold leading-tight">{order.clientName||"Cliente asignado"}</h2></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(order.status)}`}>{orderStatus(order.status)}</span></div>
    <div className="mt-4 grid gap-2.5 text-sm text-muted-foreground sm:grid-cols-2"><div className="flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary"/><span>{visitWindow(order.scheduledAt,order.scheduledEndAt)}</span></div><div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary"/><span>{visitAddress(order)}</span></div></div>
    <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>Ver orden asignada</span><ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1 group-hover:text-primary"/></div>
  </Link>;
}