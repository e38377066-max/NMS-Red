import { useEffect, useState } from "react";
import { useGetBillingSummary, getGetBillingSummaryQueryKey, useRunSuspendOverdue } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, CheckCircle2, AlertCircle, XCircle, Scissors, TrendingUp, Users, FileText, WalletCards, Plus, RefreshCw, Download, FileCheck2, Settings2, Calculator, History, FileSpreadsheet } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
}

type Invoice = {
  id: number;
  number: string;
  clientId: number;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  status: string;
};

type PaymentProof = {
  id: number;
  clientId: number;
  clientName: string;
  invoiceId: number | null;
  invoiceNumber: string | null;
  amount: string;
  currency: string;
  method: string;
  reference: string;
  notes: string | null;
  originalName: string | null;
  mimeType: string | null;
  status: string;
  submittedAt: string;
};

type BillingSettings = {
  reminderDaysBefore: number;
  graceDays: number;
  autoSuspend: boolean;
  reminderEnabled: boolean;
  currency: string;
};

type ArrearsReport = {
  asOf: string;
  total: number;
  buckets: Record<string, number>;
  clients: { clientId: number; clientName: string; balance: number; invoices: number; oldestDueDate: string | null }[];
};

type DebtHistory = {
  client: { id: number; name: string };
  currentBalance: number;
  events: { type: "invoice" | "payment"; date: string; invoiceNumber: string | null; amount: string; balanceDue: string | null; status: string; method: string | null }[];
};

type ProrationPreview = {
  clientId: number;
  clientName: string;
  reason: string;
  effectiveDate: string;
  periodEnd: string;
  daysInMonth: number;
  billableDays: number;
  currentMonthlyFee: number;
  newMonthlyFee: number;
  baseAmount: number;
  discount: number;
  charge: number;
  credit: number;
  total: number;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function billingApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "No se pudo completar la operación");
  }
  return response.json() as Promise<T>;
}

export default function Billing() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: summary, isLoading } = useGetBillingSummary({ query: { queryKey: getGetBillingSummaryQueryKey() } });
  const suspendOverdue = useRunSuspendOverdue();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [clientId, setClientId] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [discount, setDiscount] = useState("0");
  const [surcharge, setSurcharge] = useState("0");
  const [periodStart, setPeriodStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [savingPayment, setSavingPayment] = useState(false);
  const [countedTotal, setCountedTotal] = useState("");
  const [closingCash, setClosingCash] = useState(false);
  const [pendingProofs, setPendingProofs] = useState<PaymentProof[]>([]);
  const [loadingProofs, setLoadingProofs] = useState(true);
  const [reviewingProof, setReviewingProof] = useState<number | null>(null);
  const [settings, setSettings] = useState<BillingSettings>({ reminderDaysBefore: 3, graceDays: 0, autoSuspend: true, reminderEnabled: true, currency: "USD" });
  const [savingSettings, setSavingSettings] = useState(false);
  const [arrearsDate, setArrearsDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [arrears, setArrears] = useState<ArrearsReport | null>(null);
  const [loadingArrears, setLoadingArrears] = useState(true);
  const [debtClientId, setDebtClientId] = useState("");
  const [debtHistory, setDebtHistory] = useState<DebtHistory | null>(null);
  const [loadingDebt, setLoadingDebt] = useState(false);
  const [exportFrom, setExportFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [exportTo, setExportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [prorationClientId, setProrationClientId] = useState("");
  const [prorationReason, setProrationReason] = useState("activation");
  const [prorationCurrentFee, setProrationCurrentFee] = useState("");
  const [prorationNewFee, setProrationNewFee] = useState("");
  const [prorationDate, setProrationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [prorationPreview, setProrationPreview] = useState<ProrationPreview | null>(null);
  const [loadingProration, setLoadingProration] = useState(false);
  const [savingProration, setSavingProration] = useState(false);

  const loadInvoices = async () => {
    setLoadingInvoices(true);
    try {
      setInvoices(await billingApi<Invoice[]>("/billing/invoices"));
    } catch (error) {
      toast({ title: "No se pudieron cargar las facturas", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally {
      setLoadingInvoices(false);
    }
  };

  const loadPendingProofs = async () => {
    setLoadingProofs(true);
    try {
      setPendingProofs(await billingApi<PaymentProof[]>("/billing/payment-proofs?status=PENDING"));
    } catch (error) {
      toast({ title: "No se pudieron cargar los comprobantes", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally {
      setLoadingProofs(false);
    }
  };

  const loadSettings = async () => {
    try {
      setSettings(await billingApi<BillingSettings>("/billing/settings"));
    } catch (error) {
      toast({ title: "No se pudo cargar la configuración", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    }
  };

  const loadArrears = async (date = arrearsDate) => {
    setLoadingArrears(true);
    try {
      setArrears(await billingApi<ArrearsReport>(`/billing/reports/arrears?asOf=${encodeURIComponent(date)}`));
    } catch (error) {
      toast({ title: "No se pudo cargar la morosidad", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally {
      setLoadingArrears(false);
    }
  };

  useEffect(() => {
    void loadInvoices();
    void loadPendingProofs();
    void loadSettings();
    void loadArrears();
  }, []);

  const handleSuspend = () => {
    if (!confirm("¿Ejecutar corte manual de todos los clientes vencidos?")) return;
    suspendOverdue.mutate(undefined, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetBillingSummaryQueryKey() });
        toast({ title: "Corte ejecutado", description: data.message });
      },
      onError: () => toast({ title: "Error al ejecutar corte", variant: "destructive" }),
    });
  };

  const createInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingInvoice(true);
    try {
      await billingApi("/billing/invoices", {
        method: "POST",
        body: JSON.stringify({ clientId: Number(clientId), subtotal: Number(subtotal), discount: Number(discount), surcharge: Number(surcharge), periodStart, periodEnd, dueDate }),
      });
      setShowInvoiceForm(false);
      setClientId(""); setSubtotal(""); setDiscount("0"); setSurcharge("0");
      await loadInvoices();
      toast({ title: "Factura creada", description: "La factura quedó abierta con su saldo pendiente." });
    } catch (error) {
      toast({ title: "No se pudo crear la factura", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally { setSavingInvoice(false); }
  };

  const registerInvoicePayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!paymentInvoice) return;
    setSavingPayment(true);
    try {
      await billingApi(`/billing/invoices/${paymentInvoice.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(paymentAmount), method: paymentMethod }),
      });
      setPaymentInvoice(null); setPaymentAmount("");
      await loadInvoices();
      queryClient.invalidateQueries({ queryKey: getGetBillingSummaryQueryKey() });
      toast({ title: "Pago aplicado", description: "El saldo de la factura fue actualizado." });
    } catch (error) {
      toast({ title: "No se pudo aplicar el pago", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally { setSavingPayment(false); }
  };

  const closeCash = async () => {
    setClosingCash(true);
    try {
      const report = await billingApi<{ total: number }>("/billing/reports/daily");
      await billingApi("/billing/cash-closures", {
        method: "POST",
        body: JSON.stringify({ countedTotal: Number(countedTotal), openingBalance: 0 }),
      });
      setCountedTotal("");
      toast({ title: "Caja cerrada", description: `Ingresos esperados del día: Q ${report.total.toFixed(2)}` });
    } catch (error) {
      toast({ title: "No se pudo cerrar la caja", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally { setClosingCash(false); }
  };

  const downloadProof = async (proof: PaymentProof) => {
    try {
      const response = await fetch(`${BASE}/api/billing/payment-proofs/${proof.id}/download`, {
        credentials: "include",
        headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
      });
      if (!response.ok) throw new Error("No se pudo descargar el comprobante");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = proof.originalName ?? `comprobante-${proof.id}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: "No se pudo descargar", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    }
  };

  const reviewProof = async (proof: PaymentProof, status: "APPROVED" | "REJECTED") => {
    const reason = status === "REJECTED"
      ? window.prompt("Indica el motivo del rechazo:")
      : "";
    if (status === "REJECTED" && !reason?.trim()) return;
    if (status === "APPROVED" && !window.confirm(`¿Aprobar el comprobante de ${proof.clientName} por ${proof.currency} ${proof.amount}?`)) return;
    setReviewingProof(proof.id);
    try {
      await billingApi(`/billing/payment-proofs/${proof.id}/review`, {
        method: "POST",
        body: JSON.stringify({ status, reason: reason?.trim() ?? "" }),
      });
      await Promise.all([loadPendingProofs(), loadInvoices()]);
      queryClient.invalidateQueries({ queryKey: getGetBillingSummaryQueryKey() });
      toast({ title: status === "APPROVED" ? "Comprobante aprobado" : "Comprobante rechazado", description: status === "APPROVED" ? "El pago fue aplicado a la factura." : "El motivo quedó registrado." });
    } catch (error) {
      toast({ title: "No se pudo revisar el comprobante", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally {
      setReviewingProof(null);
    }
  };

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingSettings(true);
    try {
      await billingApi("/billing/settings", { method: "PATCH", body: JSON.stringify(settings) });
      toast({ title: "Configuración guardada", description: "Las reglas se aplicarán en la próxima revisión de facturación." });
    } catch (error) {
      toast({ title: "No se pudo guardar la configuración", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  };

  const loadDebtHistory = async () => {
    const id = Number(debtClientId);
    if (!Number.isInteger(id) || id <= 0) {
      toast({ title: "Cliente inválido", description: "Indica un ID de cliente válido.", variant: "destructive" });
      return;
    }
    setLoadingDebt(true);
    try {
      setDebtHistory(await billingApi<DebtHistory>(`/billing/clients/${id}/debt-history`));
    } catch (error) {
      setDebtHistory(null);
      toast({ title: "No se pudo cargar el historial", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally {
      setLoadingDebt(false);
    }
  };

  const downloadAccountingExport = async () => {
    try {
      const response = await fetch(`${BASE}/api/billing/reports/accounting-export?from=${encodeURIComponent(exportFrom)}&to=${encodeURIComponent(`${exportTo}T23:59:59`)}`, {
        credentials: "include",
        headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo generar la exportación");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `facturacion-${exportFrom}-${exportTo}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exportación generada", description: "El archivo CSV se descargó correctamente." });
    } catch (error) {
      toast({ title: "No se pudo exportar", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    }
  };

  const prorationPayload = () => ({
    clientId: Number(prorationClientId),
    reason: prorationReason,
    newMonthlyFee: Number(prorationNewFee),
    ...(prorationCurrentFee ? { currentMonthlyFee: Number(prorationCurrentFee) } : {}),
    effectiveDate: prorationDate,
  });

  const previewProration = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoadingProration(true);
    try {
      setProrationPreview(await billingApi<ProrationPreview>("/billing/proration/preview", { method: "POST", body: JSON.stringify(prorationPayload()) }));
    } catch (error) {
      setProrationPreview(null);
      toast({ title: "No se pudo calcular el prorrateo", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally {
      setLoadingProration(false);
    }
  };

  const createProrationInvoice = async () => {
    setSavingProration(true);
    try {
      await billingApi("/billing/proration/invoices", { method: "POST", body: JSON.stringify(prorationPayload()) });
      await loadInvoices();
      setProrationPreview(null);
      toast({ title: "Factura prorrateada creada", description: "El saldo quedó registrado para el período proporcional." });
    } catch (error) {
      toast({ title: "No se pudo crear la factura prorrateada", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
    } finally {
      setSavingProration(false);
    }
  };

  const cards = [
    {
      icon: Users, label: "Total clientes", value: summary?.totalClients ?? 0,
      sub: "", color: "text-primary",
    },
    {
      icon: CheckCircle2, label: "Al día", value: summary?.paidCount ?? 0,
      sub: `Q ${(summary?.totalMonthlyIncome ?? 0).toFixed(2)}/mes`, color: "text-emerald-400",
    },
    {
      icon: AlertCircle, label: "Pendientes", value: summary?.pendingCount ?? 0,
      sub: `Q ${(summary?.pendingIncome ?? 0).toFixed(2)} por cobrar`, color: "text-yellow-400",
    },
    {
      icon: XCircle, label: "Suspendidos", value: summary?.suspendedCount ?? 0,
      sub: "Sin servicio", color: "text-red-400",
    },
    {
      icon: TrendingUp, label: "Ingreso mensual total", value: `Q ${(summary?.totalMonthlyIncome ?? 0).toFixed(2)}`,
      sub: "sólo clientes al día", color: "text-cyan-400",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <DollarSign className="w-8 h-8 text-primary" />
          Facturación
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadInvoices()} disabled={loadingInvoices} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loadingInvoices ? "animate-spin" : ""}`} />Actualizar
          </Button>
          <Button variant="outline" onClick={() => setShowInvoiceForm(value => !value)} className="gap-2">
            <Plus className="w-4 h-4" />Nueva factura
          </Button>
          <Button variant="destructive" onClick={handleSuspend} disabled={suspendOverdue.isPending} className="gap-2">
            <Scissors className="w-4 h-4" />
            {suspendOverdue.isPending ? "Ejecutando..." : "Corte Manual Ahora"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map(({ icon: Icon, label, value, sub, color }) => (
          <Card key={label} className="bg-card/50 border-border/50">
            <CardContent className="pt-4 pb-3">
              {isLoading ? <Skeleton className="h-10 w-full" /> : (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
                  </div>
                  <div className={`text-2xl font-bold ${color}`}>{value}</div>
                  {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3 border-b border-border/40"><CardTitle className="text-base flex items-center gap-2"><Settings2 className="w-4 h-4 text-primary" />Reglas de facturación</CardTitle></CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={saveSettings} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Días de aviso antes del vencimiento</Label><Input type="number" min="0" max="90" value={settings.reminderDaysBefore} onChange={event => setSettings({ ...settings, reminderDaysBefore: Number(event.target.value) })} /></div>
                <div><Label>Días de gracia antes del corte</Label><Input type="number" min="0" max="90" value={settings.graceDays} onChange={event => setSettings({ ...settings, graceDays: Number(event.target.value) })} /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.reminderEnabled} onChange={event => setSettings({ ...settings, reminderEnabled: event.target.checked })} />Activar avisos de vencimiento</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.autoSuspend} onChange={event => setSettings({ ...settings, autoSuspend: event.target.checked })} />Suspender automáticamente</label>
              </div>
              <div className="flex items-center gap-3"><Label className="shrink-0">Moneda</Label><Input className="max-w-28" maxLength={8} value={settings.currency} onChange={event => setSettings({ ...settings, currency: event.target.value.toUpperCase() })} /><Button type="submit" disabled={savingSettings}>{savingSettings ? "Guardando..." : "Guardar reglas"}</Button></div>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3 border-b border-border/40"><CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4 text-cyan-400" />Prorratear un cambio</CardTitle></CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={previewProration} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Cliente ID</Label><Input required type="number" min="1" value={prorationClientId} onChange={event => setProrationClientId(event.target.value)} /></div>
                <div><Label>Motivo</Label><select value={prorationReason} onChange={event => setProrationReason(event.target.value)} className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="activation">Alta</option><option value="relocation">Traslado</option><option value="plan_change">Cambio de plan</option></select></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Cuota actual (solo cambio)</Label><Input type="number" min="0" step="0.01" value={prorationCurrentFee} onChange={event => setProrationCurrentFee(event.target.value)} placeholder="Se toma del cliente" /></div>
                <div><Label>Nueva cuota mensual</Label><Input required type="number" min="0.01" step="0.01" value={prorationNewFee} onChange={event => setProrationNewFee(event.target.value)} /></div>
              </div>
              <div><Label>Fecha efectiva</Label><Input required type="date" value={prorationDate} onChange={event => setProrationDate(event.target.value)} /></div>
              <Button type="submit" disabled={loadingProration}>{loadingProration ? "Calculando..." : "Calcular prorrateo"}</Button>
            </form>
            {prorationPreview && <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm"><div className="flex justify-between"><span>{prorationPreview.clientName} · {prorationPreview.billableDays}/{prorationPreview.daysInMonth} días</span><strong>Q {prorationPreview.total.toFixed(2)}</strong></div><p className="mt-1 text-xs text-muted-foreground">Base Q {prorationPreview.baseAmount.toFixed(2)} · descuento/crédito Q {prorationPreview.discount.toFixed(2)} · período hasta {fmtDate(prorationPreview.periodEnd)}</p>{prorationPreview.credit > 0 ? <p className="mt-2 text-xs text-yellow-300">El cambio genera un crédito de Q {prorationPreview.credit.toFixed(2)}; no se creará una factura cobrable.</p> : <Button className="mt-3" size="sm" onClick={() => void createProrationInvoice()} disabled={savingProration}>{savingProration ? "Creando..." : "Crear factura prorrateada"}</Button>}</div>}
          </CardContent>
        </Card>
      </div>

      {/* Overdue today */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-400" />
            Vencen Hoy / Vencidos
            <Badge variant="outline" className="border-yellow-500/30 text-yellow-400 ml-2">
              {summary?.overdueToday?.length ?? 0}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : !summary?.overdueToday?.length ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500/30" />
              Sin clientes vencidos hoy. ¡Todo al día!
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>MAC / IP</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Cuota</TableHead>
                  <TableHead>Venció</TableHead>
                  <TableHead>Estado cobro</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.overdueToday.map(client => (
                  <TableRow key={client.id} className="bg-yellow-950/10">
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{client.mac}</div>
                      <div className="font-mono text-xs text-muted-foreground">{client.ip ?? "—"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{client.planLimit}</TableCell>
                    <TableCell className="font-mono text-sm text-emerald-400">
                      {client.monthlyFee ? `Q ${parseFloat(client.monthlyFee).toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-red-400 text-sm">{fmtDate(client.dueDate)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-yellow-500/30 text-yellow-400 text-[10px]">
                        {client.paymentStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/clients/${client.id}`}>
                        <Button size="sm" className="bg-emerald-700 hover:bg-emerald-600 text-white h-7 text-xs">
                          Registrar Pago
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showInvoiceForm && (
        <Card className="border-primary/30 bg-card/60">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4 text-primary" />Crear factura</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={createInvoice} className="grid gap-3 md:grid-cols-4">
              <div><Label>Cliente ID</Label><Input required type="number" min="1" value={clientId} onChange={event => setClientId(event.target.value)} placeholder="Ej. 12" /></div>
              <div><Label>Subtotal</Label><Input required type="number" min="0.01" step="0.01" value={subtotal} onChange={event => setSubtotal(event.target.value)} placeholder="0.00" /></div>
              <div><Label>Descuento</Label><Input type="number" min="0" step="0.01" value={discount} onChange={event => setDiscount(event.target.value)} /></div>
              <div><Label>Recargo</Label><Input type="number" min="0" step="0.01" value={surcharge} onChange={event => setSurcharge(event.target.value)} /></div>
              <div><Label>Inicio del período</Label><Input required type="date" value={periodStart} onChange={event => setPeriodStart(event.target.value)} /></div>
              <div><Label>Fin del período</Label><Input required type="date" value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} /></div>
              <div><Label>Vencimiento</Label><Input required type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></div>
              <div className="flex items-end"><Button type="submit" disabled={savingInvoice} className="w-full">{savingInvoice ? "Guardando..." : "Crear factura"}</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4 text-cyan-400" />Facturas y saldos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingInvoices ? <div className="p-5 text-sm text-muted-foreground">Cargando facturas...</div> : !invoices.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Todavía no hay facturas emitidas.</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Número</TableHead><TableHead>Cliente</TableHead><TableHead>Período</TableHead><TableHead>Total</TableHead><TableHead>Saldo</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader>
              <TableBody>{invoices.map(invoice => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono text-xs">{invoice.number}</TableCell>
                  <TableCell><div className="font-medium">{invoice.clientName}</div><div className="text-xs text-muted-foreground">Vence {fmtDate(invoice.dueDate)}</div></TableCell>
                  <TableCell className="text-xs">{fmtDate(invoice.periodStart)} — {fmtDate(invoice.periodEnd)}</TableCell>
                  <TableCell>Q {Number(invoice.total).toFixed(2)}</TableCell>
                  <TableCell className={Number(invoice.balanceDue) > 0 ? "text-yellow-400" : "text-emerald-400"}>Q {Number(invoice.balanceDue).toFixed(2)}</TableCell>
                  <TableCell><Badge variant="outline">{invoice.status}</Badge></TableCell>
                  <TableCell className="text-right">{Number(invoice.balanceDue) > 0 && <Button size="sm" className="gap-1" onClick={() => { setPaymentInvoice(invoice); setPaymentAmount(invoice.balanceDue); }}><WalletCards className="w-3 h-3" />Aplicar pago</Button>}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3 border-b border-border/40">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <CardTitle className="text-base flex items-center gap-2"><AlertCircle className="w-4 h-4 text-yellow-400" />Reporte de morosidad</CardTitle>
            <div className="flex items-center gap-2"><Input type="date" value={arrearsDate} onChange={event => setArrearsDate(event.target.value)} className="h-8 w-auto" /><Button size="sm" variant="outline" onClick={() => void loadArrears()} disabled={loadingArrears}><RefreshCw className={`mr-2 h-3 w-3 ${loadingArrears ? "animate-spin" : ""}`} />Actualizar</Button></div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {loadingArrears ? <div className="text-sm text-muted-foreground">Calculando saldos...</div> : arrears && <><div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5"><div className="rounded border border-border/50 p-3"><p className="text-xs text-muted-foreground">Total vencido</p><p className="mt-1 text-lg font-bold text-yellow-400">Q {arrears.total.toFixed(2)}</p></div>{Object.entries(arrears.buckets).map(([bucket, value]) => <div key={bucket} className="rounded border border-border/50 p-3"><p className="text-xs text-muted-foreground">{bucket === "current" ? "Actual" : bucket.replace("days", "Días ")}</p><p className="mt-1 font-semibold">Q {value.toFixed(2)}</p></div>)}</div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Facturas</TableHead><TableHead>Saldo</TableHead><TableHead>Factura más antigua</TableHead></TableRow></TableHeader><TableBody>{arrears.clients.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No hay deuda pendiente.</TableCell></TableRow> : arrears.clients.map(client => <TableRow key={client.clientId}><TableCell>{client.clientName}</TableCell><TableCell>{client.invoices}</TableCell><TableCell className="text-yellow-400">Q {client.balance.toFixed(2)}</TableCell><TableCell>{fmtDate(client.oldestDueDate)}</TableCell></TableRow>)}</TableBody></Table></div></>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3 border-border/40"><CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4 text-violet-400" />Historial de deuda por cliente</CardTitle></CardHeader>
          <CardContent>
            <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void loadDebtHistory(); }}><Input required type="number" min="1" value={debtClientId} onChange={event => setDebtClientId(event.target.value)} placeholder="ID del cliente" /><Button type="submit" disabled={loadingDebt}>{loadingDebt ? "Cargando..." : "Consultar"}</Button></form>
            {debtHistory && <div className="mt-4"><div className="mb-3 flex justify-between text-sm"><span>{debtHistory.client.name}</span><strong className={debtHistory.currentBalance > 0 ? "text-yellow-400" : "text-emerald-400"}>Saldo Q {debtHistory.currentBalance.toFixed(2)}</strong></div><div className="max-h-56 overflow-auto rounded border border-border/50"><Table><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Tipo</TableHead><TableHead>Factura</TableHead><TableHead>Importe</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader><TableBody>{debtHistory.events.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sin movimientos.</TableCell></TableRow> : debtHistory.events.map((event, index) => <TableRow key={`${event.type}-${event.date}-${index}`}><TableCell className="text-xs">{fmtDate(event.date)}</TableCell><TableCell>{event.type === "invoice" ? "Factura" : "Pago"}</TableCell><TableCell className="font-mono text-xs">{event.invoiceNumber ?? "—"}</TableCell><TableCell className={event.type === "payment" ? "text-emerald-400" : ""}>Q {Number(event.amount).toFixed(2)}</TableCell><TableCell>{event.status}</TableCell></TableRow>)}</TableBody></Table></div></div>}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3 border-border/40"><CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-emerald-400" />Exportación contable</CardTitle></CardHeader>
          <CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Descarga pagos, facturas, métodos y estados en CSV.</p><div><Label>Desde</Label><Input type="date" value={exportFrom} onChange={event => setExportFrom(event.target.value)} /></div><div><Label>Hasta</Label><Input type="date" value={exportTo} onChange={event => setExportTo(event.target.value)} /></div><Button className="w-full" onClick={() => void downloadAccountingExport()}><Download className="mr-2 h-4 w-4" />Descargar CSV</Button></CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-base flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-yellow-400" />Comprobantes pendientes
            <Badge variant="outline" className="border-yellow-500/30 text-yellow-400">{pendingProofs.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingProofs ? <div className="p-5 text-sm text-muted-foreground">Cargando comprobantes...</div> : !pendingProofs.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No hay comprobantes pendientes de revisión.</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Factura</TableHead><TableHead>Importe</TableHead><TableHead>Referencia</TableHead><TableHead>Enviado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
              <TableBody>{pendingProofs.map(proof => (
                <TableRow key={proof.id}>
                  <TableCell><div className="font-medium">{proof.clientName}</div><div className="text-xs text-muted-foreground">{proof.method} · {proof.originalName ?? "archivo"}</div></TableCell>
                  <TableCell className="font-mono text-xs">{proof.invoiceNumber ?? "Automática"}</TableCell>
                  <TableCell className="font-semibold">{proof.currency} {Number(proof.amount).toFixed(2)}</TableCell>
                  <TableCell className="max-w-40 truncate text-xs">{proof.reference}</TableCell>
                  <TableCell className="text-xs">{fmtDate(proof.submittedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" title="Descargar comprobante" onClick={() => void downloadProof(proof)}><Download className="w-3 h-3" /></Button>
                      <Button size="sm" variant="outline" className="border-red-500/40 text-red-400 hover:bg-red-500/10" disabled={reviewingProof === proof.id} onClick={() => void reviewProof(proof, "REJECTED")}>Rechazar</Button>
                      <Button size="sm" disabled={reviewingProof === proof.id} onClick={() => void reviewProof(proof, "APPROVED")}>{reviewingProof === proof.id ? "..." : "Aprobar"}</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><WalletCards className="w-4 h-4 text-emerald-400" />Cierre diario de caja</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="max-w-xs flex-1"><Label>Total contado</Label><Input type="number" min="0" step="0.01" value={countedTotal} onChange={event => setCountedTotal(event.target.value)} placeholder="0.00" /></div>
          <Button onClick={() => void closeCash()} disabled={closingCash || !countedTotal}>{closingCash ? "Cerrando..." : "Cerrar caja de hoy"}</Button>
        </CardContent>
      </Card>

      {paymentInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-md border-primary/30">
            <CardHeader><CardTitle className="text-base">Aplicar pago a {paymentInvoice.number}</CardTitle></CardHeader>
            <CardContent><form onSubmit={registerInvoicePayment} className="space-y-4">
              <div><Label>Importe (saldo: Q {Number(paymentInvoice.balanceDue).toFixed(2)})</Label><Input required type="number" min="0.01" max={paymentInvoice.balanceDue} step="0.01" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} /></div>
              <div><Label>Método</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="mobile">Pago móvil</option><option value="other">Otro</option></select></div>
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setPaymentInvoice(null)}>Cancelar</Button><Button type="submit" disabled={savingPayment}>{savingPayment ? "Aplicando..." : "Aplicar pago"}</Button></div>
            </form></CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
