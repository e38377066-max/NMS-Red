import { logger } from "../lib/logger";

const OLLAMA_BASE_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

export interface NetworkContext {
  totalEquipment: number;
  onlineEquipment: number;
  offlineEquipment: number;
  totalClients: number;
  recentAlerts: string[];
  // Multi-brand topology context
  proxmoxServers?: Array<{ name: string; ip: string; status: string }>;
  offlineEquipmentList?: Array<{ model: string; ip: string; role: string; brand: string; node: string }>;
  gatewayStatus?: string | null;
}

export async function askOllama(
  userMessage: string,
  context: NetworkContext
): Promise<string> {
  const proxmoxInfo = context.proxmoxServers && context.proxmoxServers.length > 0
    ? context.proxmoxServers.map(p => `  - ${p.name} (${p.ip}): ${p.status}`).join("\n")
    : "  (ninguno registrado)";

  const offlineInfo = context.offlineEquipmentList && context.offlineEquipmentList.length > 0
    ? context.offlineEquipmentList.map(e =>
        `  - ${e.model} [${e.brand}] (${e.ip}) — Rol: ${translateRole(e.role)} — Nodo: ${e.node}`
      ).join("\n")
    : "  (ninguno)";

  const systemPrompt = `Eres un asistente experto en administración de redes ISP con conocimiento avanzado de MikroTik RouterOS, Ubiquiti AirOS/AirMAX y Proxmox VE.

## JERARQUÍA DE RED ACTUAL:

### Hipervisor (Proxmox VE):
${proxmoxInfo}
- El MikroTik CHR (Cloud Hosted Router) corre como VM dentro del Proxmox.
- Si el CHR tiene problemas de rendimiento, puede necesitar más CPU/RAM en Proxmox.

### Topología de Red - Capas:
1. **Gateway / Internet**: Equipo que recibe el enlace WAN (Starlink u otro). Rol: "gateway". Gestiona ruteo en MikroTik CHR.
2. **Enlace Troncal PTP**: Equipos Ubiquiti AirMAX que forman los backhauls entre nodos de la ciudad (Colón). Rol: "ptp_link".
3. **AP / Repartidor**: APs MikroTik o Ubiquiti que distribuyen señal a los clientes finales. Rol: "ap_distributor".

### Estado actual de equipos OFFLINE:
${offlineInfo}

### Resumen de red:
- Equipos totales: ${context.totalEquipment} (${context.onlineEquipment} online, ${context.offlineEquipment} offline)
- Clientes activos: ${context.totalClients}
- Alertas recientes: ${context.recentAlerts.slice(0, 5).join(" | ") || "Ninguna"}

## REGLAS DE DIAGNÓSTICO:

1. Si un NODO completo está offline:
   - Primero evalúa el enlace troncal Ubiquiti (PTP) que lleva señal a ese nodo.
   - Si el enlace PTP está ok, revisa la distribución interna del nodo (APs MikroTik).
   - Si el PTP cae, todos los APs del nodo se verán afectados.

2. Si solo ALGUNOS clientes de un nodo tienen problemas:
   - Revisa el AP MikroTik con las Simple Queues (límites de velocidad).
   - Revisa la señal dBm del cliente en el AP Ubiquiti (si aplica).
   - Una señal menor a -80 dBm indica problema de radio, no de configuración.

3. Si el MikroTik CHR está lento:
   - Verifica recursos en Proxmox (CPU/RAM de la VM).
   - Revisa Simple Queues y Queue Trees en el CHR.
   - El CHR gestiona TODO el encolamiento del enlace Starlink.

4. Para cambios en Proxmox: confirma el vmid y los recursos antes de actuar.
5. Para cambios de velocidad de clientes: siempre usa Dry Run primero.

Responde SIEMPRE en español, de forma técnica pero clara. Cuando identifiques un problema, sigue la jerarquía: Proxmox → CHR MikroTik → Enlace Troncal Ubiquiti → AP → Cliente.`;

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "Ollama returned non-OK status, using fallback");
      return getFallbackResponse(userMessage, context);
    }

    const data = await response.json() as { message?: { content?: string } };
    return data.message?.content ?? "No se pudo obtener respuesta del asistente.";
  } catch (err) {
    logger.warn({ err }, "Ollama not available, using fallback response");
    return getFallbackResponse(userMessage, context);
  }
}

function translateRole(role: string): string {
  const map: Record<string, string> = {
    gateway: "Gateway (recibe internet)",
    ptp_link: "Enlace Troncal PTP",
    ap_distributor: "AP / Repartidor",
    core_router: "Core Router (CHR)",
  };
  return map[role] ?? role;
}

function getFallbackResponse(message: string, context: NetworkContext): string {
  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes("proxmox") || lowerMsg.includes("vm") || lowerMsg.includes("máquina virtual") || lowerMsg.includes("chr")) {
    const proxmoxCount = context.proxmoxServers?.length ?? 0;
    if (proxmoxCount > 0) {
      const online = context.proxmoxServers?.filter(p => p.status === "ONLINE").length ?? 0;
      return `Tienes ${proxmoxCount} servidor(es) Proxmox registrado(s), ${online} en línea. El MikroTik CHR corre como VM dentro del Proxmox. Puedes gestionar las VMs desde la sección Proxmox del dashboard: iniciar, detener, crear snapshots y ajustar CPU/RAM.`;
    }
    return "No tienes servidores Proxmox registrados aún. Ve a la sección Proxmox en el dashboard para agregar tu hipervisor con IP, usuario y contraseña.";
  }

  if (lowerMsg.includes("ubiquiti") || lowerMsg.includes("airos") || lowerMsg.includes("airmax") || lowerMsg.includes("señal") || lowerMsg.includes("dbm") || lowerMsg.includes("ptp") || lowerMsg.includes("troncal")) {
    return `Para diagnóstico de enlaces Ubiquiti AirMAX: accede al detalle de un equipo con rol "Enlace Troncal PTP" y consulta la tabla de señal inalámbrica. Los valores de señal saludables están entre -55 y -70 dBm. Una señal menor a -80 dBm indica problema físico (alineación, interferencia o distancia).`;
  }

  if (lowerMsg.includes("offline") || lowerMsg.includes("caido") || lowerMsg.includes("caído") || lowerMsg.includes("nodo")) {
    if (context.offlineEquipment > 0 && context.offlineEquipmentList) {
      const ptpOffline = context.offlineEquipmentList.filter(e => e.role === "ptp_link");
      const apOffline = context.offlineEquipmentList.filter(e => e.role === "ap_distributor");
      let resp = `Hay ${context.offlineEquipment} equipo(s) OFFLINE:\n`;
      if (ptpOffline.length > 0) {
        resp += `⚠️ CRÍTICO: ${ptpOffline.length} enlace(s) troncal(es) PTP offline — esto afecta a todos los APs dependientes: ${ptpOffline.map(e => e.ip).join(", ")}.\n`;
      }
      if (apOffline.length > 0) {
        resp += `📡 ${apOffline.length} AP(s) offline: ${apOffline.map(e => e.ip).join(", ")}.\n`;
      }
      resp += "Sigue la jerarquía: primero verifica los enlaces PTP Ubiquiti antes de revisar los APs MikroTik.";
      return resp;
    }
    return "Todos los equipos registrados están ONLINE en este momento.";
  }

  if (lowerMsg.includes("velocidad") || lowerMsg.includes("queue") || lowerMsg.includes("ancho de banda")) {
    return `Los límites de velocidad (Simple Queues) se gestionan en el MikroTik CHR. Para cambiar la velocidad de un cliente, usa el panel Clientes → selecciona el cliente → Cambiar Plan. La función Dry Run te mostrará una advertencia si el cambio reduce más del 50% del plan actual. El CHR aplica el límite via la API REST de RouterOS.`;
  }

  if (lowerMsg.includes("alerta") || lowerMsg.includes("problema")) {
    if (context.recentAlerts.length > 0) {
      return `Alertas recientes: ${context.recentAlerts.slice(0, 3).join(" | ")}. El sistema monitorea cada 60 segundos. Para cada alerta, sigue la jerarquía: verifica primero el enlace troncal PTP del nodo afectado.`;
    }
    return "No hay alertas activas en este momento. La red parece estable.";
  }

  return `Estado de la red: ${context.onlineEquipment}/${context.totalEquipment} equipos online, ${context.totalClients} clientes activos. 
Tengo soporte multi-marca: MikroTik RouterOS (REST API), Ubiquiti AirOS (SSH/HTTP), y Proxmox VE. 
Puedo ayudarte a diagnosticar problemas siguiendo la jerarquía Proxmox → CHR → PTP Ubiquiti → AP → Cliente.`;
}
