import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { getCurrentUser } from "@/lib/auth";

function Protected({ children }: { children: React.ReactNode }) {
  return getCurrentUser() ? <>{children}</> : <Redirect to="/login" />;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } }
});

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <Protected><Layout><Dashboard /></Layout></Protected>
      </Route>
      <Route path="/topology">
        <Protected><Layout><Topology /></Layout></Protected>
      </Route>
      <Route path="/monitoring">
        <Protected><Layout><Monitoring /></Layout></Protected>
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
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
