import { useMemo, useState } from "react";
import { Activity, Download, Search, ShieldCheck } from "lucide-react";
import {
  getListAuditLogsQueryKey,
  useListAuditLogs,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

function escapeCsv(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function Audit() {
  const [search, setSearch] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const queryParams = {
    limit: 250,
    equipmentId: equipmentId.trim() ? Number(equipmentId) : undefined,
  };
  const { data: logs, isLoading, isError } = useListAuditLogs(queryParams, {
    query: { queryKey: getListAuditLogsQueryKey(queryParams) },
  });

  const filteredLogs = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return logs ?? [];
    return (logs ?? []).filter((log) =>
      [log.username, log.entity, log.action, log.details, log.result]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [logs, search]);

  const downloadCsv = () => {
    const header = ["Fecha", "Usuario", "Entidad", "Acción", "Equipo", "Resultado", "Detalles"];
    const rows = filteredLogs.map((log) => [
      new Date(log.timestamp).toISOString(),
      log.username ?? "Sistema",
      log.entity,
      log.action,
      log.equipmentId ?? "",
      log.result ?? "Pending",
      log.details,
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            <ShieldCheck className="h-8 w-8 text-primary" />
            Registro de auditoría
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Historial de cambios y operaciones ejecutadas en la red.
          </p>
        </div>
        <Button variant="outline" onClick={downloadCsv} disabled={!filteredLogs.length} className="gap-2">
          <Download className="h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      <Card className="bg-card/50">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar usuario, acción o detalle..." />
          </div>
          <Input
            className="md:w-48"
            type="number"
            min="1"
            value={equipmentId}
            onChange={(event) => setEquipmentId(event.target.value)}
            placeholder="ID del equipo"
          />
        </CardContent>
      </Card>

      <Card className="bg-card/50">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/40">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Actividad registrada
            <Badge variant="outline">{filteredLogs.length}</Badge>
          </CardTitle>
          <span className="text-xs text-muted-foreground">Últimos 250 registros</span>
        </CardHeader>
        <CardContent className="p-0">
          {isError ? (
            <div className="p-10 text-center text-sm text-destructive">No se pudo cargar la auditoría.</div>
          ) : isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No hay registros para este filtro.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Operación</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {new Date(log.timestamp).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}
                    </TableCell>
                    <TableCell className="font-medium">{log.username ?? "Sistema"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{log.action}</div>
                      <div className="text-xs text-muted-foreground">{log.entity}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.equipmentId ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          log.result === "Success"
                            ? "border-emerald-500/30 text-emerald-400"
                            : log.result === "Fail"
                              ? "border-red-500/30 text-red-400"
                              : "border-yellow-500/30 text-yellow-400"
                        }
                      >
                        {log.result ?? "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                      <div className="truncate">{log.details}</div>
                      {log.commandSent && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-primary">Ver comando</summary>
                          <pre className="mt-1 max-w-full overflow-auto rounded bg-background/70 p-2 text-[11px] text-foreground">{log.commandSent}</pre>
                        </details>
                      )}
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