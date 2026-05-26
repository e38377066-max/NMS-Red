import { logger } from "../lib/logger";

const OLLAMA_BASE_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

export interface NetworkContext {
  totalEquipment: number;
  onlineEquipment: number;
  offlineEquipment: number;
  totalClients: number;
  recentAlerts: string[];
}

export async function askOllama(
  userMessage: string,
  context: NetworkContext
): Promise<string> {
  const systemPrompt = `Eres un asistente experto en redes MikroTik para un ISP. 
Tienes acceso al estado actual de la red:
- Equipos totales: ${context.totalEquipment}
- Equipos ONLINE: ${context.onlineEquipment}
- Equipos OFFLINE: ${context.offlineEquipment}  
- Clientes totales: ${context.totalClients}
- Alertas recientes: ${context.recentAlerts.join("; ") || "Ninguna"}

Responde en español, de forma concisa y técnica. Si detectas problemas en el estado de la red, mencionalos proactivamente.`;

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

function getFallbackResponse(message: string, context: NetworkContext): string {
  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes("offline") || lowerMsg.includes("caido") || lowerMsg.includes("caído")) {
    if (context.offlineEquipment > 0) {
      return `Actualmente hay ${context.offlineEquipment} equipo(s) OFFLINE de ${context.totalEquipment} totales. Revisa la conectividad física y la configuración IP de esos equipos.`;
    }
    return "Todos los equipos registrados están ONLINE en este momento.";
  }

  if (lowerMsg.includes("cliente") || lowerMsg.includes("velocidad")) {
    return `Tienes ${context.totalClients} clientes registrados. Para cambiar velocidad, usa el panel de clientes y la función de cambio de plan (con validación Dry Run habilitada).`;
  }

  if (lowerMsg.includes("alerta") || lowerMsg.includes("problema")) {
    if (context.recentAlerts.length > 0) {
      return `Alertas recientes: ${context.recentAlerts.slice(0, 3).join(" | ")}. Se recomienda revisar esos equipos.`;
    }
    return "No hay alertas activas en este momento. La red parece estable.";
  }

  return `Estado de la red: ${context.onlineEquipment}/${context.totalEquipment} equipos online, ${context.totalClients} clientes activos. Puedo ayudarte a diagnosticar problemas, revisar configuraciones MikroTik, o gestionar clientes.`;
}
