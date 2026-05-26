import { Switch, Route, Router as WouterRouter } from "wouter";
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } }
});

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <Layout><Dashboard /></Layout>
      </Route>
      <Route path="/nodes">
        <Layout><Nodes /></Layout>
      </Route>
      <Route path="/equipment">
        <Layout><Equipment /></Layout>
      </Route>
      <Route path="/equipment/:id">
        <Layout><EquipmentDetail /></Layout>
      </Route>
      <Route path="/clients">
        <Layout><Clients /></Layout>
      </Route>
      <Route path="/clients/:id">
        <Layout><ClientDetail /></Layout>
      </Route>
      <Route path="/audit">
        <Layout><Audit /></Layout>
      </Route>
      <Route path="/ai">
        <Layout><Ai /></Layout>
      </Route>
      <Route path="/users">
        <Layout><Users /></Layout>
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
