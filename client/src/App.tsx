import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Nodes from "@/pages/nodes";
import Equipment from "@/pages/equipment";
import EquipmentDetail from "@/pages/equipment-detail";
import Clients from "@/pages/clients";
import ClientDetail from "@/pages/client-detail";
import Audit from "@/pages/audit";
import Ai from "@/pages/ai";
import Users from "@/pages/users";
import Login from "@/pages/login";
import Topology from "@/pages/topology";
import Billing from "@/pages/billing";
import Backups from "@/pages/backups";
import Security from "@/pages/security";
import Monitoring from "@/pages/monitoring";
import Reconciliation from "@/pages/reconciliation";
import Operations from "@/pages/operations";
import ClientPortal from "@/pages/client-portal";
import { getCurrentUser, restoreAuth } from "@/lib/auth";
import { API_CONFIGURATION_ERROR } from "@/lib/api-config";
import FieldAgenda from "@/pages/field/agenda";
import FieldOrderDetail from "@/pages/field/order-detail";
import FieldAlignment from "@/pages/field/alignment";
import FieldAccount from "@/pages/field/account";

function Protected({ children }: { children: React.ReactNode }) {
  return getCurrentUser() ? <>{children}</> : <Redirect to="/login" />;
}

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void restoreAuth().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Restaurando sesión…
      </div>
    );
  }
  return <>{children}</>;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } }
});

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/portal" component={ClientPortal} />
      <Route path="/field">
        <Protected><FieldAgenda /></Protected>
      </Route>
      <Route path="/field/orders/:id/alignment">
        <Protected><FieldAlignment /></Protected>
      </Route>
      <Route path="/field/orders/:id">
        <Protected><FieldOrderDetail /></Protected>
      </Route>
      <Route path="/field/account">
        <Protected><FieldAccount /></Protected>
      </Route>
      <Route path="/">
        <Protected><Layout><Dashboard /></Layout></Protected>
      </Route>
      <Route path="/topology">
        <Protected><Layout><Topology /></Layout></Protected>
      </Route>
      <Route path="/monitoring">
        <Protected><Layout><Monitoring /></Layout></Protected>
      </Route>
      <Route path="/reconciliation">
        <Protected><Layout><Reconciliation /></Layout></Protected>
      </Route>
      <Route path="/nodes">
        <Protected><Layout><Nodes /></Layout></Protected>
      </Route>
      <Route path="/equipment">
        <Protected><Layout><Equipment /></Layout></Protected>
      </Route>
      <Route path="/equipment/:id">
        <Protected><Layout><EquipmentDetail /></Layout></Protected>
      </Route>
      <Route path="/clients">
        <Protected><Layout><Clients /></Layout></Protected>
      </Route>
      <Route path="/clients/:id">
        <Protected><Layout><ClientDetail /></Layout></Protected>
      </Route>
      <Route path="/billing">
        <Protected><Layout><Billing /></Layout></Protected>
      </Route>
      <Route path="/operations">
        <Protected><Layout><Operations /></Layout></Protected>
      </Route>
      <Route path="/backups">
        <Protected><Layout><Backups /></Layout></Protected>
      </Route>
      <Route path="/security">
        <Protected><Layout><Security /></Layout></Protected>
      </Route>
      <Route path="/audit">
        <Protected><Layout><Audit /></Layout></Protected>
      </Route>
      <Route path="/ai">
        <Protected><Layout><Ai /></Layout></Protected>
      </Route>
      <Route path="/users">
        <Protected><Layout><Users /></Layout></Protected>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  if (API_CONFIGURATION_ERROR) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
        <div className="max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
          <h1 className="text-lg font-semibold">Configura la conexión de la app</h1>
          <p className="mt-2 text-sm text-muted-foreground">{API_CONFIGURATION_ERROR}</p>
          {Capacitor.isNativePlatform() && (
            <p className="mt-3 text-sm text-muted-foreground">
              Define la variable antes de ejecutar <code>pnpm cap:sync</code> y vuelve a compilar el paquete.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthBootstrap>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthBootstrap>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
