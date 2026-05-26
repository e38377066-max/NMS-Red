import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useWebSocket } from "@/hooks/use-websocket";
import { 
  LayoutDashboard, 
  Server, 
  Router as RouterIcon, 
  Users, 
  Activity, 
  BotMessageSquare, 
  ShieldCheck,
  LogOut,
  Settings,
  Wifi
} from "lucide-react";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isConnected } = useWebSocket();

  const navigation = [
    { name: "Overview", items: [{ name: "Dashboard", href: "/", icon: LayoutDashboard }] },
    { 
      name: "Network", 
      items: [
        { name: "Nodes", href: "/nodes", icon: Server },
        { name: "Equipment", href: "/equipment", icon: RouterIcon },
        { name: "Clients", href: "/clients", icon: Users },
      ]
    },
    { 
      name: "Operations", 
      items: [
        { name: "AI Diagnostics", href: "/ai", icon: BotMessageSquare },
        { name: "Audit Log", href: "/audit", icon: Activity },
      ] 
    },
    { 
      name: "Admin", 
      items: [
        { name: "Users", href: "/users", icon: ShieldCheck },
      ] 
    }
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col z-20">
        <div className="h-14 border-b border-border flex items-center px-4 gap-2 text-primary font-bold tracking-widest uppercase">
          <Wifi className="w-5 h-5" />
          <span>ISP Cockpit</span>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6 scrollbar-thin">
          {navigation.map((section) => (
            <div key={section.name}>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
                {section.name}
              </h4>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
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
          <Link href="/login" className="flex items-center gap-3 px-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <LogOut className="w-4 h-4" />
            Sign out
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card/50 backdrop-blur flex items-center justify-between px-6 z-10 sticky top-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-red-500")} />
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
                {isConnected ? "System Live" : "Disconnected"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-muted-foreground">
             <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-foreground">admin</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/20 text-primary font-bold">ROOT</span>
             </div>
          </div>
        </header>
        
        <main className="flex-1 overflow-auto p-6 scrollbar-thin">
          <div className="max-w-7xl mx-auto h-full animate-in fade-in duration-300">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
