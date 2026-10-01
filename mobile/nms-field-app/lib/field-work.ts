import type { FieldWorkOrder } from '@workspace/api-client-react';

export const terminalWorkOrderStatuses = new Set([
  'completed',
  'closed',
  'cancelled',
  'canceled',
]);

export function isTerminalWorkOrder(order: FieldWorkOrder) {
  return terminalWorkOrderStatuses.has(order.status.toLowerCase());
}

export function workOrderTypeLabel(type: string) {
  const labels: Record<string, string> = {
    installation: 'Instalación',
    visit: 'Visita técnica',
    relocation: 'Reubicación',
    repair: 'Reparación',
    maintenance: 'Mantenimiento',
  };
  return labels[type.toLowerCase()] ?? type.replaceAll('_', ' ');
}

export function workOrderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: 'Pendiente',
    scheduled: 'Programada',
    assigned: 'Asignada',
    in_progress: 'En curso',
    completed: 'Completada',
    closed: 'Cerrada',
    cancelled: 'Cancelada',
    canceled: 'Cancelada',
  };
  return labels[status.toLowerCase()] ?? status.replaceAll('_', ' ');
}

export function formatOrderDate(value?: string | null) {
  if (!value) return 'Sin fecha asignada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function formatOrderTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatOrderSchedule(order: FieldWorkOrder) {
  if (!order.scheduledAt) return 'Horario pendiente';
  const start = formatOrderTime(order.scheduledAt);
  return order.scheduledEndAt
    ? `${start} – ${formatOrderTime(order.scheduledEndAt)}`
    : start;
}

export function orderVisitAddress(order: FieldWorkOrder) {
  return order.address?.trim()
    || order.clientInstallationAddress?.trim()
    || 'Dirección sin registrar';
}

export function parseOptionalMeasurement(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}