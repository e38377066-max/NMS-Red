import { useGetMonitoringSummary, useListAlerts, useListAuditLogs, getGetMonitoringSummaryQueryKey, getListAlertsQueryKey, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Activity, Router, Server, Users, AlertTriangle, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetMonitoringSummary({
    query: { queryKey: getGetMonitoringSummaryQueryKey() }
  });

  const { data: alerts, isLoading: isLoadingAlerts } = useListAlerts({
    query: { queryKey: getListAlertsQueryKey() }
  });

  const { data: audits, isLoading: isLoadingAudit } = useListAuditLogs(
    { limit: 10 },
    { query: { queryKey: getListAuditLogsQueryKey({ limit: 10 }) } }
  );

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
        <Activity className="w-8 h-8 text-primary" />
        Network Overview
      </h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Nodes</CardTitle>
            <Server className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-3xl font-bold font-mono">{summary?.totalNodes || 0}</div>
            )}
          </CardContent>
        </Card>
        
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Equipment</CardTitle>
            <Router className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-32" /> : (
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold font-mono">{summary?.totalEquipment || 0}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  <span className="text-emerald-500">{summary?.onlineEquipment || 0} on</span> / <span className="text-red-500">{summary?.offlineEquipment || 0} off</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Clients</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-32" /> : (
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold font-mono">{summary?.activeClients || 0}</div>
                <div className="text-xs text-muted-foreground font-mono">/ {summary?.totalClients || 0} total</div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Recent Audits</CardTitle>
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-3xl font-bold font-mono">{summary?.recentAuditCount || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live Alerts */}
        <Card className="border-red-900/30 bg-red-950/5">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Live Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b-border/50">
                  <TableHead>Time</TableHead>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingAlerts ? (
                  <TableRow><TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                ) : alerts?.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No active alerts.</TableCell></TableRow>
                ) : (
                  alerts?.map(alert => (
                    <TableRow key={alert.id} className="border-b-border/50 hover:bg-card/50">
                      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {format(new Date(alert.timestamp), "HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{alert.equipmentIp}</div>
                        <div className="text-xs text-muted-foreground">{alert.nodeName || alert.equipmentModel}</div>
                      </TableCell>
                      <TableCell className="text-sm text-red-400 font-medium">
                        {alert.message}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent Audit Logs */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b-border/50">
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingAudit ? (
                  <TableRow><TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                ) : audits?.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No recent activity.</TableCell></TableRow>
                ) : (
                  audits?.map(log => (
                    <TableRow key={log.id} className="border-b-border/50 hover:bg-card/50">
                      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {format(new Date(log.timestamp), "HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm capitalize">{log.action} {log.entity}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{log.details}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          log.result === "Success" ? "border-emerald-500/30 text-emerald-500" :
                          log.result === "Fail" ? "border-red-500/30 text-red-500" :
                          "border-yellow-500/30 text-yellow-500"
                        }>
                          {log.result}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
