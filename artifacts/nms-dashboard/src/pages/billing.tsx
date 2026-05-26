import { useGetBillingSummary, getGetBillingSummaryQueryKey, useRunSuspendOverdue } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, CheckCircle2, AlertCircle, XCircle, Scissors, TrendingUp, Users } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Billing() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: summary, isLoading } = useGetBillingSummary({ query: { queryKey: getGetBillingSummaryQueryKey() } });
  const suspendOverdue = useRunSuspendOverdue();

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
        <Button
          variant="destructive"
          onClick={handleSuspend}
          disabled={suspendOverdue.isPending}
          className="gap-2"
        >
          <Scissors className="w-4 h-4" />
          {suspendOverdue.isPending ? "Ejecutando..." : "Corte Manual Ahora"}
        </Button>
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
    </div>
  );
}
