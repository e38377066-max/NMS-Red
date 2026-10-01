import type { FieldWorkOrder } from "@workspace/api-client-react";

export const terminalOrder = (order: FieldWorkOrder) =>
  ["completed", "cancelled", "canceled", "closed"].includes(order.status.toLowerCase());

export const orderStatus = (status: string) => ({
  pending: "Pendiente",
  scheduled: "Programada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
  canceled: "Cancelada",
}[status.toLowerCase()] ?? status.replaceAll("_", " "));

export const orderType = (type: string) => ({
  installation: "Instalación",
  repair: "Reparación",
  maintenance: "Mantenimiento",
  relocation: "Reubicación",
  alignment: "Alineación",
}[type.toLowerCase()] ?? type.replaceAll("_", " "));

export function visitWindow(start?: string | null, end?: string | null) {
  if (!start) return "Horario por confirmar";
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return "Horario por confirmar";
  const day = new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short" }).format(date);
  const time = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(date);
  const until = end ? new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(new Date(end)) : null;
  return `${day} · ${time}${until ? `–${until}` : ""}`;
}

export const visitAddress = (order: FieldWorkOrder) =>
  order.address || order.clientInstallationAddress || "Dirección no especificada";
