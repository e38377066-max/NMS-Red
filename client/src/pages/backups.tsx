import { useListBackups, getListBackupsQueryKey, useRunBackupNow } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Archive, Download, Play, Database, FileCode, HardDrive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  mikrotik_backup: { label: "MikroTik .backup", icon: HardDrive, color: "text-sky-400 border-sky-500/30" },
  mikrotik_script: { label: "MikroTik .rsc", icon: FileCode, color: "text-violet-400 border-violet-500/30" },
  postgres: { label: "PostgreSQL", icon: Database, color: "text-emerald-400 border-emerald-500/30" },
};

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function Backups() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: backups, isLoading } = useListBackups({}, { query: { queryKey: getListBackupsQueryKey({}) } });
  const runBackup = useRunBackupNow();

  const handleRunNow = () => {
    runBackup.mutate(undefined, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListBackupsQueryKey({}) });
        toast({ title: "Respaldo completado", description: data.message });
      },
      onError: () => toast({ title: "Error al ejecutar respaldo", variant: "destructive" }),
    });
  };

  const handleDownload = (id: number, name: string) => {
    const link = document.createElement("a");
    link.href = `/api/backups/${id}/download`;
    link.download = name;
    link.click();
  };

  const grouped = {
    mikrotik_backup: backups?.filter(b => b.type === "mikrotik_backup") ?? [],
    mikrotik_script: backups?.filter(b => b.type === "mikrotik_script") ?? [],
    postgres: backups?.filter(b => b.type === "postgres") ?? [],
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Archive className="w-8 h-8 text-primary" />
          Respaldos Automáticos
        </h1>
        <Button onClick={handleRunNow} disabled={runBackup.isPending} className="gap-2">
          <Play className="w-4 h-4" />
          {runBackup.isPending ? "Ejecutando..." : "Ejecutar Respaldo Ahora"}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {Object.entries(TYPE_META).map(([type, meta]) => {
          const Icon = meta.icon;
          const list = grouped[type as keyof typeof grouped];
          return (
            <Card key={type} className="bg-card/50 border-border/50">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${meta.color.split(" ")[0]}`} />
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{meta.label}</span>
                </div>
                <div className="text-2xl font-bold text-foreground">{list.length}</div>
                <div className="text-xs text-muted-foreground mt-1">archivos disponibles</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-base flex items-center gap-2">
            <Archive className="w-4 h-4 text-primary" />
            Todos los Respaldos
            <span className="text-xs text-muted-foreground ml-auto">{backups?.length ?? 0} archivos</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !backups?.length ? (
            <div className="py-12 text-center text-muted-foreground">
              <Archive className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
              <p className="text-sm">Sin respaldos disponibles.</p>
              <p className="text-xs mt-1 text-muted-foreground/60">Los respaldos automáticos se ejecutan cada noche a las 2:00 AM.</p>
              <Button onClick={handleRunNow} disabled={runBackup.isPending} className="mt-4" size="sm">
                <Play className="w-3 h-3 mr-2" /> Crear Primer Respaldo
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Tamaño</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Descargar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...backups].reverse().map(backup => {
                  const meta = TYPE_META[backup.type] ?? { label: backup.type, icon: Archive, color: "text-muted-foreground border-border" };
                  const Icon = meta.icon;
                  return (
                    <TableRow key={backup.id} className="hover:bg-card/30">
                      <TableCell>
                        <Badge variant="outline" className={`${meta.color} gap-1 text-[10px]`}>
                          <Icon className="w-3 h-3" />
                          {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{backup.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{backup.equipmentModel ?? "Sistema"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{formatBytes(backup.sizeBytes)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(backup.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownload(backup.id, backup.name)}
                          title="Descargar"
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
