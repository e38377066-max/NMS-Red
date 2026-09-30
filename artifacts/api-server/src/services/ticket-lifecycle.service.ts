import { and, eq } from "drizzle-orm";
import {
  auditLogsTable,
  db,
  supportNotificationsTable,
  ticketSlaPoliciesTable,
  ticketStatusHistoryTable,
  ticketsTable,
} from "@workspace/db";

export const ticketPriorities = ["low", "normal", "high", "critical"] as const;
export type TicketPriority = typeof ticketPriorities[number];
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketSlaState = "pending" | "met" | "breached";

export const defaultTicketSlaPolicies: Array<{
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
}> = [
  { priority: "critical", firstResponseMinutes: 15, resolutionMinutes: 120 },
  { priority: "high", firstResponseMinutes: 60, resolutionMinutes: 480 },
  { priority: "normal", firstResponseMinutes: 240, resolutionMinutes: 1440 },
  { priority: "low", firstResponseMinutes: 480, resolutionMinutes: 4320 },
];

export type TicketActor = {
  type: "user" | "client" | "system";
  userId?: number | null;
  clientId?: number | null;
  name?: string | null;
  sourceIp?: string | null;
  device?: string | null;
};

export async function getTicketSlaPolicy(priority: string) {
  const normalized = ticketPriorities.includes(priority as TicketPriority)
    ? priority as TicketPriority
    : "normal";
  const defaults = defaultTicketSlaPolicies.find(policy => policy.priority === normalized)!;
  await db.insert(ticketSlaPoliciesTable).values(defaultTicketSlaPolicies).onConflictDoNothing();
  const [policy] = await db.select().from(ticketSlaPoliciesTable)
    .where(eq(ticketSlaPoliciesTable.priority, normalized));
  return policy ?? defaults;
}

export async function listTicketSlaPolicies() {
  await db.insert(ticketSlaPoliciesTable).values(defaultTicketSlaPolicies).onConflictDoNothing();
  return db.select().from(ticketSlaPoliciesTable);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function slaState(completedAt: Date | null, dueAt: Date, now: Date): TicketSlaState {
  if (completedAt) return completedAt.getTime() <= dueAt.getTime() ? "met" : "breached";
  return now.getTime() > dueAt.getTime() ? "breached" : "pending";
}

export function ticketSlaFields(
  ticket: typeof ticketsTable.$inferSelect,
  policy: Pick<typeof ticketSlaPoliciesTable.$inferSelect, "firstResponseMinutes" | "resolutionMinutes">,
  now = new Date(),
) {
  const firstResponseDueAt = ticket.firstResponseDueAt ?? addMinutes(ticket.createdAt, policy.firstResponseMinutes);
  const resolutionDueAt = ticket.resolutionDueAt ?? addMinutes(ticket.createdAt, policy.resolutionMinutes);
  return {
    firstResponseDueAt: firstResponseDueAt.toISOString(),
    resolutionDueAt: resolutionDueAt.toISOString(),
    firstResponseSla: slaState(ticket.firstResponseAt, firstResponseDueAt, now),
    resolutionSla: slaState(ticket.resolvedAt, resolutionDueAt, now),
  };
}

const allowedTransitions: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress"],
  in_progress: ["open", "resolved"],
  resolved: ["in_progress", "closed"],
  closed: ["open"],
};

function notificationInsert(
  ticketId: number,
  title: string,
  message: string,
  recipient: { userId?: number | null; clientId?: number | null },
) {
  return {
    ticketId,
    title,
    message,
    userId: recipient.userId ?? null,
    clientId: recipient.clientId ?? null,
  };
}

export async function recordTicketCreated(
  ticket: typeof ticketsTable.$inferSelect,
  actor: TicketActor,
): Promise<void> {
  const state = { status: ticket.status, priority: ticket.priority, assignedToUserId: ticket.assignedToUserId };
  await db.transaction(async (tx) => {
    await tx.insert(ticketStatusHistoryTable).values({
      ticketId: ticket.id,
      fromStatus: null,
      toStatus: ticket.status,
      actorType: actor.type,
      actorUserId: actor.userId ?? null,
      actorClientId: actor.clientId ?? null,
      actorName: actor.name ?? null,
      reason: "Ticket creado",
    });
    await tx.insert(auditLogsTable).values({
      userId: actor.userId ?? null,
      username: actor.name ?? (actor.type === "client" ? `portal-cliente-${actor.clientId}` : "sistema"),
      clientId: ticket.clientId,
      equipmentId: ticket.equipmentId,
      entity: "Ticket",
      action: "CREATE",
      commandSent: "INSERT ticket",
      result: "Success",
      details: `Ticket #${ticket.id} creado: ${ticket.subject}`,
      sourceIp: actor.sourceIp ?? null,
      device: actor.device ?? null,
      beforeState: null,
      afterState: JSON.stringify(state),
      reason: "Ticket creado",
    });
    const notifications = [];
    if (ticket.clientId !== null) {
      notifications.push(notificationInsert(
        ticket.id,
        `Ticket #${ticket.id} recibido`,
        `Tu solicitud «${ticket.subject}» quedó registrada.`,
        { clientId: ticket.clientId },
      ));
    }
    if (ticket.assignedToUserId !== null) {
      notifications.push(notificationInsert(
        ticket.id,
        `Ticket #${ticket.id} asignado`,
        `Se te asignó «${ticket.subject}».`,
        { userId: ticket.assignedToUserId },
      ));
    }
    if (notifications.length) await tx.insert(supportNotificationsTable).values(notifications);
  });
}

export async function createSupportTicket(
  values: typeof ticketsTable.$inferInsert,
  actor: TicketActor,
): Promise<typeof ticketsTable.$inferSelect> {
  const priority = values.priority ?? "normal";
  const policy = await getTicketSlaPolicy(priority);
  const createdAt = values.createdAt ?? new Date();
  const [ticket] = await db.insert(ticketsTable).values({
    ...values,
    priority,
    createdAt,
    firstResponseDueAt: values.firstResponseDueAt
      ?? addMinutes(createdAt, policy.firstResponseMinutes),
    resolutionDueAt: values.resolutionDueAt
      ?? addMinutes(createdAt, policy.resolutionMinutes),
  }).returning();
  await recordTicketCreated(ticket, actor);
  return ticket;
}

export async function transitionTicket(input: {
  ticketId: number;
  toStatus: TicketStatus;
  actor: TicketActor;
  reason?: string | null;
  allowReopen?: boolean;
  closeByClient?: boolean;
  command?: string;
}): Promise<
  | { kind: "updated"; ticket: typeof ticketsTable.$inferSelect }
  | { kind: "no_change"; ticket: typeof ticketsTable.$inferSelect }
  | { kind: "not_found" }
  | { kind: "invalid_transition"; currentStatus: string }
> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(ticketsTable).where(eq(ticketsTable.id, input.ticketId));
    if (!before) return { kind: "not_found" };
    if (before.status === input.toStatus) return { kind: "no_change", ticket: before };
    if (input.actor.type === "client" && before.clientId !== input.actor.clientId) {
      return { kind: "not_found" };
    }
    const allowed = (allowedTransitions[before.status as TicketStatus] ?? []).includes(input.toStatus);
    if (!allowed || (before.status === "closed" && !input.allowReopen)) {
      return { kind: "invalid_transition", currentStatus: before.status };
    }
    if (before.status === "closed" && input.toStatus === "open" && input.actor.type === "client" && !before.clientReopenEnabled) {
      return { kind: "invalid_transition", currentStatus: before.status };
    }
    if (input.toStatus === "closed" && before.status !== "resolved") {
      return { kind: "invalid_transition", currentStatus: before.status };
    }

    const now = new Date();
    const reopening = before.status === "closed" && input.toStatus === "open";
    const transitionConditions = [
      eq(ticketsTable.id, before.id),
      eq(ticketsTable.status, before.status),
    ];
    if (reopening && input.actor.type === "client") {
      transitionConditions.push(eq(ticketsTable.clientReopenEnabled, true));
      transitionConditions.push(eq(ticketsTable.clientId, input.actor.clientId!));
    }
    const [ticket] = await tx.update(ticketsTable).set({
      status: input.toStatus,
      firstResponseAt: input.toStatus === "in_progress" ? before.firstResponseAt ?? now : before.firstResponseAt,
      resolvedAt: input.toStatus === "resolved"
        ? now
        : input.toStatus === "open" || input.toStatus === "in_progress"
          ? null
          : before.resolvedAt,
      closedAt: input.toStatus === "closed" ? now : reopening ? null : before.closedAt,
      closedByClient: input.toStatus === "closed" ? input.closeByClient === true : reopening ? false : before.closedByClient,
      clientReopenEnabled: reopening ? false : before.clientReopenEnabled,
      updatedAt: now,
    }).where(and(...transitionConditions)).returning();
    if (!ticket) return { kind: "invalid_transition", currentStatus: before.status };

    const beforeState = {
      status: before.status,
      firstResponseAt: before.firstResponseAt?.toISOString() ?? null,
      resolvedAt: before.resolvedAt?.toISOString() ?? null,
      closedAt: before.closedAt?.toISOString() ?? null,
      closedByClient: before.closedByClient,
      clientReopenEnabled: before.clientReopenEnabled,
    };
    const afterState = {
      status: ticket.status,
      firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
      closedByClient: ticket.closedByClient,
      clientReopenEnabled: ticket.clientReopenEnabled,
    };
    const actorName = input.actor.name
      ?? (input.actor.type === "client" ? `Cliente ${input.actor.clientId ?? ""}`.trim() : null);
    await tx.insert(ticketStatusHistoryTable).values({
      ticketId: ticket.id,
      fromStatus: before.status,
      toStatus: ticket.status,
      actorType: input.actor.type,
      actorUserId: input.actor.userId ?? null,
      actorClientId: input.actor.clientId ?? null,
      actorName,
      reason: input.reason ?? null,
    });
    await tx.insert(auditLogsTable).values({
      userId: input.actor.userId ?? null,
      username: actorName ?? "sistema",
      clientId: ticket.clientId,
      equipmentId: ticket.equipmentId,
      entity: "Ticket",
      action: input.toStatus === "open" && reopening ? "REOPEN" : "STATUS_CHANGE",
      commandSent: input.command ?? "Ticket status transition",
      result: "Success",
      details: `Ticket #${ticket.id}: ${before.status} → ${ticket.status}`,
      sourceIp: input.actor.sourceIp ?? null,
      device: input.actor.device ?? null,
      beforeState: JSON.stringify(beforeState),
      afterState: JSON.stringify(afterState),
      reason: input.reason ?? null,
      confirmation: input.closeByClient
        ? "Cierre confirmado desde el portal"
        : reopening && input.actor.type === "client"
          ? "El permiso de reapertura de un solo uso fue consumido"
          : null,
    });

    const notifications = [];
    if (ticket.clientId !== null && input.actor.clientId !== ticket.clientId) {
      notifications.push(notificationInsert(
        ticket.id,
        `Actualización del ticket #${ticket.id}`,
        `El estado de «${ticket.subject}» cambió a ${ticket.status}.`,
        { clientId: ticket.clientId },
      ));
    }
    if (ticket.assignedToUserId !== null && input.actor.userId !== ticket.assignedToUserId) {
      notifications.push(notificationInsert(
        ticket.id,
        `Actualización del ticket #${ticket.id}`,
        `El estado de «${ticket.subject}» cambió a ${ticket.status}.`,
        { userId: ticket.assignedToUserId },
      ));
    }
    if (notifications.length) await tx.insert(supportNotificationsTable).values(notifications);
    return { kind: "updated", ticket };
  });
}

export async function notifyTicketAssignment(input: {
  ticket: typeof ticketsTable.$inferSelect;
  actor: TicketActor;
}): Promise<void> {
  const { ticket, actor } = input;
  const assignedToUserId = ticket.assignedToUserId;
  const notifications = [];
  if (assignedToUserId !== null && assignedToUserId !== actor.userId) {
    notifications.push(notificationInsert(
      ticket.id,
      `Ticket #${ticket.id} asignado`,
      `Se te asignó «${ticket.subject}».`,
      { userId: assignedToUserId },
    ));
  }
  if (ticket.clientId !== null) {
    notifications.push(notificationInsert(
      ticket.id,
      `Responsable actualizado para el ticket #${ticket.id}`,
      "El equipo de soporte actualizó el responsable de tu solicitud.",
      { clientId: ticket.clientId },
    ));
  }
  if (notifications.length) await db.insert(supportNotificationsTable).values(notifications);
}

export async function notifyTicketComment(input: {
  ticket: typeof ticketsTable.$inferSelect;
  actor: TicketActor;
  internal: boolean;
}): Promise<void> {
  const { ticket, actor, internal } = input;
  const notifications = [];
  if (!internal && ticket.clientId !== null && actor.clientId !== ticket.clientId) {
    notifications.push(notificationInsert(
      ticket.id,
      `Nuevo comentario en el ticket #${ticket.id}`,
      `Hay una actualización en «${ticket.subject}».`,
      { clientId: ticket.clientId },
    ));
  }
  if (ticket.assignedToUserId !== null && actor.userId !== ticket.assignedToUserId) {
    notifications.push(notificationInsert(
      ticket.id,
      `Nuevo comentario en el ticket #${ticket.id}`,
      `Se añadió un comentario a «${ticket.subject}».`,
      { userId: ticket.assignedToUserId },
    ));
  }
  if (notifications.length) await db.insert(supportNotificationsTable).values(notifications);
}