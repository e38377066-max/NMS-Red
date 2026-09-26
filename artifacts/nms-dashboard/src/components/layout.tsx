import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useWebSocket } from "@/hooks/use-websocket";
import { 
  LayoutDashboard, 
  Server, 
  Router as RouterIcon, 
  Users, 
  Activity, 
  GitCompare,
  BotMessageSquare, 
  ShieldCheck,
  LogOut,
  Network,
  Wifi,
  Archive,
  DollarSign,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAuth, getCurrentUser } from "@/lib/auth";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [, navigate] = useLocation();
  const { isConnected } = useWebSocket();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentUser = getCurrentUser();

  const navigation = [
    { name: "General", items: [{ name: "Dashboard", href: "/", icon: LayoutDashboard }] },
    { 
      name: "Red", 
      items: [
        { name: "Monitoreo", href: "/monitoring", icon: Activity },
        { name: "Reconciliación", href: "/reconciliation", icon: GitCompare },
        { name: "Topología", href: "/topology", icon: Network },
        { name: "Nodos", href: "/nodes", icon: Server },
        { name: "Equipos", href: "/equipment", icon: RouterIcon },
        { name: "Clientes", href: "/clients", icon: Users },
        { name: "Facturación", href: "/billing", icon: DollarSign },
      ]
    },
    {
      name: "Operaciones de red",
      items: [
        { name: "IA Diagnóstico", href: "/ai", icon: BotMessageSquare },
        { name: "Respaldos", href: "/backups", icon: Archive },
      ]
    },
    { 
      name: "Seguridad y auditoría",
      items: [
        { name: "Seguridad", href: "/security", icon: ShieldCheck },
        { name: "Audit Log", href: "/audit", icon: Activity },
      ] 
    },
    { 
      name: "Admin", 
      items: [
        { name: "Usuarios", href: "/users", icon: ShieldCheck },
      ] 
    }
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30">
      {mobileMenuOpen && (
        <button
          aria-label="Cerrar menú"
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-border bg-card transition-transform duration-200 md:static md:translate-x-0",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className="h-14 border-b border-border flex items-center px-4 gap-2 text-primary font-bold tracking-widest uppercase">
          <Wifi className="w-5 h-5" />
          <span>ISP Cockpit</span>
          <button
            aria-label="Cerrar menú"
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5 scrollbar-thin">
          {navigation.map((section) => (
            <div key={section.name}>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
                {section.name}
              </h4>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-2 py-2 rounded-md text-sm transition-colors",
                        isActive 
                          ? "bg-primary/10 text-primary font-medium" 
                          : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                      )}
                    >
                      <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-border">
          <button
            type="button"
            onClick={() => {
              clearAuth();
              navigate("/login");
            }}
            className="flex items-center gap-3 px-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card/50 backdrop-blur flex items-center justify-between px-4 md:px-6 z-10 sticky top-0">
          <div className="flex items-center gap-4">
            <button
              aria-label="Abrir menú"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground md:hidden"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-red-500")} />
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
                {isConnected ? "System Live" : "Disconnected"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-muted-foreground">
             <div className="flex items-center gap-2 text-sm">
                 <span className="font-medium text-foreground">{currentUser?.username ?? "Invitado"}</span>
                 <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/20 text-primary font-bold">{currentUser?.role === "admin" ? "ADMIN" : "OPERADOR"}</span>
             </div>
          </div>
        </header>
        
        <main className="flex-1 overflow-auto p-4 md:p-6 scrollbar-thin">
          <div className="max-w-7xl mx-auto h-full animate-in fade-in duration-300">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
