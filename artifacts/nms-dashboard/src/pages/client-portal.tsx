import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Gauge,
  Headphones,
  LogOut,
  MapPin,
  MessageSquare,
  Network,
  RefreshCw,
  Send,
  ShieldCheck,
  Ticket,
  Wifi,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const TOKEN_KEY = "isp-cockpit-portal-token";

type Equipment = {
  id: number;
  model: string;
  ip: string;
  equipmentRole: string;
  lastSeenStatus: string;
};

type Invoice = {
  id: number;
  number: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  status: string;
};

type Payment = {
  id: number;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  receiptNumber: string;
  paidAt: string;
};

type TicketRow = {
  id: number;
  subject: string;
  description: string;
  category: string;
  status: string;
  priority: string;
  closedByClient: boolean;
  createdAt: string;
  updatedAt: string;
};

type PortalSession = {
  client: {
    name: string;
    planLimit: string;
    status: string;
    paymentStatus: string;
    monthlyFee: string | null;
    dueDate: string | null;
    network: { coreRouter: Equipment | null; accessPoint: Equipment | null };
  };
  invoices: Invoice[];
  payments: Payment[];
  tickets: TicketRow[];
};

type Notice = { id: number; title: string; message: string; startsAt: string; endsAt: string | null };

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

function money(value: string | number | null | undefined, currency = "USD") {
  return `${currency} ${Number(value ?? 0).toFixed(2)}`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    open: "Abierto",
    in_progress: "En atención",
    resolved: "Resuelto",
    closed: "Cerrado",
    PAID: "Pagada",
    PARTIAL: "Parcial",
    OPEN: "Pendiente",
  };
  return labels[status] ?? status;
}

async function portalApi<T>(token: string, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}/api/portal${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-portal-token": token,
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "No se pudo completar la operación");
  return body as T;
}

function PortalLogin({ initialToken, onLogin }: { initialToken: string; onLogin: (token: string) => void }) {
  const [token, setToken] = useState(initialToken);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await portalApi<PortalSession>(token.trim(), "/session");
      onLogin(token.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Token inválido o expirado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-xl bg-primary/15 p-3 text-primary"><Wifi className="h-6 w-6" /></div>
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">ISP Cockpit</p><h1 className="text-2xl font-bold">Portal del cliente</h1></div>
        </div>
        <Card className="border-primary/20 bg-card/80 shadow-xl">
          <CardHeader><CardTitle>Accede a tus servicios</CardTitle><p className="text-sm text-muted-foreground">Introduce el token que te entregó tu proveedor.</p></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div><Label htmlFor="portal-token">Token de acceso</Label><Input id="portal-token" required minLength={32} value={token} onChange={event => setToken(event.target.value)} placeholder="Pega aquí tu token" className="mt-2 font-mono" /></div>
              {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>No se pudo iniciar sesión</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
              <Button type="submit" className="w-full" disabled={loading}>{loading ? "Validando..." : "Entrar al portal"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-5 text-center text-xs text-muted-foreground">El token identifica únicamente tu cuenta de servicio.</p>
      </div>
    </main>
  );
}

export default function ClientPortal() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token") ?? "";
  const [token, setToken] = useState(() => urlToken || window.localStorage.getItem(TOKEN_KEY) || "");
  const [session, setSession] = useState<PortalSession | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  const [section, setSection] = useState<"overview" | "payments" | "tickets">("overview");
  const { toast } = useToast();

  const load = async (activeToken: string) => {
    setLoading(true);
    setError("");
    try {
      const [nextSession, nextNotices] = await Promise.all([
        portalApi<PortalSession>(activeToken, "/session"),
        portalApi<Notice[]>(activeToken, "/notices"),
      ]);
      setSession(nextSession);
      setNotices(nextNotices);
      window.localStorage.setItem(TOKEN_KEY, activeToken);
    } catch (reason) {
      window.localStorage.removeItem(TOKEN_KEY);
      setToken("");
      setSession(null);
      setError(reason instanceof Error ? reason.message : "Token inválido o expirado");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) void load(token);
  }, []);

  if (!token || (!session && !loading)) {
    return <PortalLogin initialToken={urlToken || token} onLogin={nextToken => { setToken(nextToken); void load(nextToken); }} />;
  }

  if (loading || !session) {
    return <main className="flex min-h-screen items-center justify-center bg-background"><div className="flex items-center gap-3 text-muted-foreground"><RefreshCw className="h-5 w-5 animate-spin text-primary" />Cargando tu portal...</div></main>;
  }

  const balance = session.invoices.reduce((sum, invoice) => sum + Number(invoice.balanceDue), 0);
  const overdue = session.client.dueDate ? new Date(session.client.dueDate) < new Date() && balance > 0 : false;
  const logout = () => {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setSession(null);
  };

  const createRequest = async (path: string, body: Record<string, string>, success: string) => {
    try {
      await portalApi(token, path, { method: "POST", body: JSON.stringify(body) });
      await load(token);
      toast({ title: "Solicitud enviada", description: success });
    } catch (reason) {
      toast({ title: "No se pudo enviar", description: reason instanceof Error ? reason.message : "Intenta de nuevo", variant: "destructive" });
    }
  };

  const downloadReceipt = async (payment: Payment) => {
    try {
      const response = await fetch(`${BASE}/api/portal/payments/${payment.id}/receipt`, { headers: { "x-portal-token": token } });
      if (!response.ok) throw new Error("No se pudo descargar el recibo");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${payment.receiptNumber}.html`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      toast({ title: "No se pudo descargar", description: reason instanceof Error ? reason.message : "Intenta de nuevo", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70 bg-card/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-6">
          <div className="flex items-center gap-3"><div className="rounded-lg bg-primary/15 p-2 text-primary"><Wifi className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">ISP Cockpit</p><p className="font-semibold">{session.client.name}</p></div></div>
          <Button variant="ghost" size="sm" onClick={logout}><LogOut className="mr-2 h-4 w-4" />Salir</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 md:py-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">Resumen de tu servicio</p><h1 className="text-3xl font-bold tracking-tight">Hola, {session.client.name}</h1></div><Button variant="outline" size="sm" onClick={() => void load(token)}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button></div>
        {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        {notices.length > 0 && <div className="space-y-2">{notices.map(notice => <Alert key={notice.id} className="border-yellow-500/30 bg-yellow-500/5"><AlertCircle className="h-4 w-4 text-yellow-400" /><AlertTitle>{notice.title}</AlertTitle><AlertDescription>{notice.message}</AlertDescription></Alert>)}</div>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={Gauge} label="Plan contratado" value={session.client.planLimit} detail={session.client.status} />
          <Metric icon={CircleDollarSign} label="Saldo pendiente" value={money(balance, "USD")} detail={balance > 0 ? "Revisa tus facturas" : "Sin saldo pendiente"} tone={balance > 0 ? "warning" : "success"} />
          <Metric icon={FileText} label="Próximo vencimiento" value={date(session.client.dueDate)} detail={overdue ? "Vencido" : "Estado de cuenta"} tone={overdue ? "danger" : undefined} />
          <Metric icon={Network} label="Punto de acceso" value={session.client.network.accessPoint?.model ?? "No asociado"} detail={session.client.network.accessPoint?.lastSeenStatus ?? "—"} />
        </div>
        <nav className="flex gap-1 overflow-x-auto border-b border-border/70">
          {([["overview", "Resumen"], ["payments", "Pagos y recibos"], ["tickets", "Soporte"] ] as const).map(([key, label]) => <button key={key} onClick={() => setSection(key)} className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${section === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
        </nav>
        {section === "overview" && <Overview session={session} onRequest={createRequest} />}
        {section === "payments" && <Payments session={session} onReceipt={downloadReceipt} />}
        {section === "tickets" && <Support session={session} onRequest={createRequest} />}
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof Gauge; label: string; value: string; detail: string; tone?: "success" | "warning" | "danger" }) {
  return <Card className="bg-card/60"><CardContent className="p-4"><div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Icon className="h-4 w-4 text-primary" />{label}</div><p className={`mt-3 truncate text-xl font-bold ${tone === "success" ? "text-emerald-400" : tone === "warning" ? "text-yellow-400" : tone === "danger" ? "text-red-400" : ""}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

function Overview({ session, onRequest }: { session: PortalSession; onRequest: (path: string, body: Record<string, string>, success: string) => Promise<void> }) {
  const [plan, setPlan] = useState("");
  const [planReason, setPlanReason] = useState("");
  const [requestType, setRequestType] = useState<"relocation" | "reconnection">("relocation");
  const [details, setDetails] = useState("");
  return <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-emerald-400" />Estado de tu conexión</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><Info label="Velocidad contratada" value={session.client.planLimit} /><Info label="Cuota mensual" value={money(session.client.monthlyFee)} /><Info label="Router central" value={session.client.network.coreRouter?.model ?? "—"} /><Info label="IP del servicio" value={session.client.network.coreRouter?.ip ?? "—"} /></div>
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4"><div className="flex items-center gap-2 text-sm font-medium"><MapPin className="h-4 w-4 text-primary" />Equipo de distribución</div><p className="mt-2 text-sm">{session.client.network.accessPoint?.model ?? "Todavía no hay un AP o enlace asociado."}</p><p className="mt-1 text-xs text-muted-foreground">{session.client.network.accessPoint?.ip ?? "Puedes solicitar una revisión desde soporte."}</p></div>
    </CardContent></Card>
    <div className="space-y-6">
      <Card><CardHeader><CardTitle className="text-base">Solicitar cambio de plan</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={event => { event.preventDefault(); void onRequest("/plan-change", { requestedPlan: plan, reason: planReason }, "Revisaremos la disponibilidad y te responderemos en un ticket."); setPlan(""); setPlanReason(""); }}><div><Label htmlFor="requested-plan">Plan solicitado</Label><Input id="requested-plan" required value={plan} onChange={event => setPlan(event.target.value)} placeholder="Ej. 100 Mbps" className="mt-1" /></div><div><Label htmlFor="plan-reason">Comentario</Label><Textarea id="plan-reason" value={planReason} onChange={event => setPlanReason(event.target.value)} placeholder="Cuéntanos qué necesitas" className="mt-1" /></div><Button type="submit" size="sm">Solicitar cambio<Send className="ml-2 h-4 w-4" /></Button></form></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Otra solicitud</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={event => { event.preventDefault(); void onRequest("/service-request", { type: requestType, details }, "Tu solicitud quedó registrada para el equipo de soporte."); setDetails(""); }}><div><Label>Tipo</Label><select value={requestType} onChange={event => setRequestType(event.target.value as typeof requestType)} className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="relocation">Solicitar traslado</option><option value="reconnection">Solicitar reconexión</option></select></div><div><Label htmlFor="request-details">Detalle</Label><Textarea id="request-details" required value={details} onChange={event => setDetails(event.target.value)} placeholder="Indica dirección, fecha o contexto" className="mt-1" /></div><Button type="submit" variant="outline" size="sm">Enviar solicitud<Send className="ml-2 h-4 w-4" /></Button></form></CardContent></Card>
    </div>
  </div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}

function Payments({ session, onReceipt }: { session: PortalSession; onReceipt: (payment: Payment) => void }) {
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();
  const submitProof = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const token = window.localStorage.getItem(TOKEN_KEY) ?? "";
      await portalApi(token, "/payment-proof", { method: "POST", body: JSON.stringify({ reference, amount, notes }) });
      setReference(""); setAmount(""); setNotes("");
      toast({ title: "Comprobante registrado", description: "Soporte revisará la referencia y actualizará tu cuenta." });
    } catch (reason) {
      toast({ title: "No se pudo registrar", description: reason instanceof Error ? reason.message : "Intenta de nuevo", variant: "destructive" });
    }
  };
  return <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4 text-primary" />Facturas y pagos</CardTitle></CardHeader><CardContent className="p-0">{session.invoices.length === 0 && session.payments.length === 0 ? <Empty text="Todavía no hay movimientos registrados." /> : <div className="divide-y divide-border/50">
      {session.invoices.map(invoice => <div key={`invoice-${invoice.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{invoice.number}</p><p className="text-xs text-muted-foreground">Vence {date(invoice.dueDate)} · {statusLabel(invoice.status)}</p></div><div className="text-right"><p className={Number(invoice.balanceDue) > 0 ? "font-semibold text-yellow-400" : "font-semibold text-emerald-400"}>{money(invoice.balanceDue)} pendiente</p><p className="text-xs text-muted-foreground">Total {money(invoice.total)}</p></div></div>)}
      {session.payments.map(payment => <div key={`payment-${payment.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">Recibo {payment.receiptNumber}</p><p className="text-xs text-muted-foreground">{date(payment.paidAt)} · {payment.method} {payment.reference ? `· ${payment.reference}` : ""}</p></div><div className="flex items-center gap-3"><span className="font-semibold text-emerald-400">{money(payment.amount, payment.currency)}</span><Button variant="outline" size="sm" onClick={() => onReceipt(payment)}>Descargar</Button></div></div>)}
    </div>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Registrar comprobante</CardTitle><p className="text-sm text-muted-foreground">El equipo de facturación lo revisará antes de aplicarlo.</p></CardHeader><CardContent><form onSubmit={submitProof} className="space-y-3"><div><Label htmlFor="payment-reference">Referencia</Label><Input id="payment-reference" required value={reference} onChange={event => setReference(event.target.value)} className="mt-1" /></div><div><Label htmlFor="payment-amount">Importe</Label><Input id="payment-amount" required type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className="mt-1" /></div><div><Label htmlFor="payment-notes">Notas</Label><Textarea id="payment-notes" value={notes} onChange={event => setNotes(event.target.value)} className="mt-1" /></div><Button type="submit">Enviar comprobante<Send className="ml-2 h-4 w-4" /></Button></form></CardContent></Card>
  </div>;
}

function Support({ session, onRequest }: { session: PortalSession; onRequest: (path: string, body: Record<string, string>, success: string) => Promise<void> }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const { toast } = useToast();
  const createTicket = async (event: FormEvent) => {
    event.preventDefault();
    await onRequest("/tickets", { subject, description }, "Puedes seguir el estado desde esta misma pantalla.");
    setSubject(""); setDescription("");
  };
  const closeTicket = async (ticketId: number) => {
    try {
      const token = window.localStorage.getItem(TOKEN_KEY) ?? "";
      await portalApi(token, `/tickets/${ticketId}/close`, { method: "POST" });
      toast({ title: "Ticket cerrado", description: "Gracias por confirmar la atención." });
      window.location.reload();
    } catch (reason) {
      toast({ title: "No se pudo cerrar", description: reason instanceof Error ? reason.message : "Intenta de nuevo", variant: "destructive" });
    }
  };
  return <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4 text-primary" />Nuevo ticket</CardTitle></CardHeader><CardContent><form onSubmit={createTicket} className="space-y-3"><div><Label htmlFor="ticket-subject">Asunto</Label><Input id="ticket-subject" required value={subject} onChange={event => setSubject(event.target.value)} className="mt-1" /></div><div><Label htmlFor="ticket-description">Describe el problema</Label><Textarea id="ticket-description" required value={description} onChange={event => setDescription(event.target.value)} className="mt-1 min-h-32" /></div><Button type="submit">Crear ticket<Ticket className="ml-2 h-4 w-4" /></Button></form></CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Headphones className="h-4 w-4 text-primary" />Mis tickets</CardTitle></CardHeader><CardContent className="space-y-3">{session.tickets.length === 0 ? <Empty text="No tienes tickets abiertos." /> : session.tickets.map(ticket => <div key={ticket.id} className="rounded-lg border border-border/60 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">#{ticket.id} {ticket.subject}</p><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{ticket.description}</p></div><Badge variant="outline">{statusLabel(ticket.status)}</Badge></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{date(ticket.updatedAt)} · Prioridad {ticket.priority}</span>{ticket.status !== "closed" && ticket.status !== "open" && !ticket.closedByClient && <Button size="sm" variant="outline" onClick={() => void closeTicket(ticket.id)}><CheckCircle2 className="mr-2 h-4 w-4" />Confirmar cierre</Button>}{ticket.closedByClient && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" />Cerrado por ti</span>}</div></div>)}</CardContent></Card>
  </div>;
}

function Empty({ text }: { text: string }) {
  return <div className="flex flex-col items-center justify-center gap-2 px-5 py-14 text-center text-sm text-muted-foreground"><XCircle className="h-8 w-8 opacity-30" />{text}</div>;
}