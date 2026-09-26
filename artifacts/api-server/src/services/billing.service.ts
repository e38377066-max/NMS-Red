import { db, clientsTable, equipmentTable, auditLogsTable, billingSettingsTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { enqueueTask } from "./task-queue.service";
import type { Server as SocketServer } from "socket.io";

const SUSPENSION_LIST = "Clientes_Cortados";
export const DEFAULT_BILLING_SETTINGS = {
  id: 1,
  reminderDaysBefore: 3,
  graceDays: 0,
  autoSuspend: true,
  reminderEnabled: true,
  currency: "USD",
  updatedByUserId: null,
};

export type ProrationReason = "activation" | "relocation" | "plan_change";

export type ProrationInput = {
  currentMonthlyFee?: number;
  newMonthlyFee: number;
  effectiveDate: Date;
  reason: ProrationReason;
};

export function calculateProration(input: ProrationInput) {
  const year = input.effectiveDate.getUTCFullYear();
  const month = input.effectiveDate.getUTCMonth();
  const day = input.effectiveDate.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const billableDays = daysInMonth - day + 1;
  const currentMonthlyFee = Math.max(0, input.currentMonthlyFee ?? 0);
  const newMonthlyFee = Math.max(0, input.newMonthlyFee);
  const baseAmount = Math.round((newMonthlyFee * billableDays / daysInMonth) * 100) / 100;
  const currentAmount = input.reason === "plan_change"
    ? Math.round((currentMonthlyFee * billableDays / daysInMonth) * 100) / 100
    : 0;
  const netAmount = Math.round((baseAmount - currentAmount) * 100) / 100;
  const charge = Math.max(0, netAmount);
  const credit = Math.max(0, -netAmount);
  const discount = input.reason === "plan_change" ? Math.min(baseAmount, currentAmount) : 0;
  const total = Math.max(0, Math.round((baseAmount - discount) * 100) / 100);
  const periodEnd = new Date(Date.UTC(year, month, daysInMonth, 23, 59, 59, 999));

  return {
    reason: input.reason,
    effectiveDate: input.effectiveDate,
    periodEnd,
    daysInMonth,
    billableDays,
    currentMonthlyFee: Number(currentMonthlyFee.toFixed(2)),
    newMonthlyFee: Number(newMonthlyFee.toFixed(2)),
    baseAmount,
    discount,
    charge,
    credit,
    total,
  };
}

let io: SocketServer | null = null;
let billingInterval: ReturnType<typeof setInterval> | null = null;

export function setBillingSocketServer(socketServer: SocketServer): void {
  io = socketServer;
}

export function startBillingCron(): void {
  if (billingInterval) return;
  logger.info("Starting billing cron service (nightly check every 6h)");
  void runBillingCheck();
  billingInterval = setInterval(() => { void runBillingCheck(); }, 6 * 60 * 60 * 1000);
}

export function stopBillingCron(): void {
  if (billingInterval) {
    clearInterval(billingInterval);
    billingInterval = null;
  }
}

export async function getBillingSettings() {
  const [settings] = await db.select().from(billingSettingsTable).where(eq(billingSettingsTable.id, 1));
  return settings ?? DEFAULT_BILLING_SETTINGS;
}

export async function runBillingCheck(): Promise<{ suspended: number; markedPending: number }> {
  const now = new Date();
  let suspended = 0;
  let markedPending = 0;

  try {
    const settings = await getBillingSettings();
    const allClients = await db
      .select({
        id: clientsTable.id,
        name: clientsTable.name,
        mac: clientsTable.mac,
        ip: clientsTable.ip,
        paymentStatus: clientsTable.paymentStatus,
        dueDate: clientsTable.dueDate,
        monthlyFee: clientsTable.monthlyFee,
        equipmentId: clientsTable.equipmentId,
      })
      .from(clientsTable)
      .where(isNotNull(clientsTable.dueDate));

    for (const client of allClients) {
      if (!client.dueDate) continue;
      const due = new Date(client.dueDate);

      const suspensionDate = new Date(due.getTime() + settings.graceDays * 24 * 60 * 60 * 1000);
      const isPastDue = suspensionDate <= now;
      const isNearDue = !isPastDue && settings.reminderEnabled &&
        (due.getTime() - now.getTime()) <= settings.reminderDaysBefore * 24 * 60 * 60 * 1000;

      if (isPastDue && settings.autoSuspend && client.paymentStatus !== "SUSPENDED") {
        await db
          .update(clientsTable)
          .set({ paymentStatus: "SUSPENDED", status: "SUSPENDED" })
          .where(eq(clientsTable.id, client.id));

        const equipment = await getEquipmentConn(client.equipmentId);
        if (equipment) {
          await enqueueTask(
            "billing_suspend",
            `Suspender cliente ${client.name} por vencimiento`,
            {
              ip: equipment.ip,
              username: equipment.username,
              password: equipment.password,
              mac: client.mac,
              clientIp: client.ip ?? "",
              clientName: client.name,
            },
            client.equipmentId,
            equipment.model,
            3,
            null,
          );
        }
        await db.insert(auditLogsTable).values({
          entity: "Client",
          action: "AUTO_SUSPEND",
          commandSent: `/ip/firewall/address-list add address=${client.ip ?? client.mac} list=${SUSPENSION_LIST}`,
          result: "Success",
          details: `Cliente ${client.name} suspendido automáticamente (vencimiento: ${due.toLocaleDateString("es")}, gracia: ${settings.graceDays} días)`,
          equipmentId: client.equipmentId,
        });

        if (io) io.emit("billing:suspended", { clientId: client.id, name: client.name, dueDate: due });
        logger.info({ clientId: client.id, name: client.name }, "Client auto-suspended for non-payment");
        suspended++;
      } else if (isNearDue && client.paymentStatus === "PAID") {
        await db
          .update(clientsTable)
          .set({ paymentStatus: "PENDING" })
          .where(eq(clientsTable.id, client.id));

        if (io) io.emit("billing:nearDue", { clientId: client.id, name: client.name, dueDate: due });
        markedPending++;
      }
    }

    logger.info({ suspended, markedPending }, "Billing check completed");
  } catch (err) {
    logger.error({ err }, "Billing check failed");
  }

  return { suspended, markedPending };
}

export async function registerPayment(
  clientId: number,
  monthlyFee: number,
  daysUntilNextDue = 30
): Promise<boolean> {
  const nextDue = new Date();
  nextDue.setDate(nextDue.getDate() + daysUntilNextDue);

  const [client] = await db
    .update(clientsTable)
    .set({
      paymentStatus: "PAID",
      status: "ACTIVE",
      monthlyFee: String(monthlyFee),
      dueDate: nextDue,
      lastPaymentDate: new Date(),
    })
    .where(eq(clientsTable.id, clientId))
    .returning();

  if (!client) return false;

  await queueClientReactivation(client.id);

  await db.insert(auditLogsTable).values({
    entity: "Client",
    action: "PAYMENT_REGISTERED",
    result: "Success",
    details: `Pago registrado y reactivación encolada: ${client.name} | Q${monthlyFee} | Próximo vencimiento: ${nextDue.toLocaleDateString("es")}`,
    equipmentId: client.equipmentId,
  });

  if (io) io.emit("billing:paid", { clientId: client.id, name: client.name, nextDue });
  return true;
}

export async function queueClientReactivation(clientId: number): Promise<boolean> {
  const [client] = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      mac: clientsTable.mac,
      ip: clientsTable.ip,
      planLimit: clientsTable.planLimit,
      equipmentId: clientsTable.equipmentId,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client) return false;

  const equipment = await getEquipmentConn(client.equipmentId);
  if (!equipment) return false;

  await enqueueTask(
    "billing_reactivate",
    `Reactivar cliente ${client.name} tras registrar pago`,
    {
      ip: equipment.ip,
      username: equipment.username,
      password: equipment.password,
      mac: client.mac,
      clientIp: client.ip ?? "",
      clientName: client.name,
      planLimit: client.planLimit ?? "10M/10M",
    },
    client.equipmentId,
    equipment.model,
    3,
    null,
  );
  return true;
}

async function getEquipmentConn(equipmentId: number) {
  const [equip] = await db
    .select({
      model: equipmentTable.model,
      ip: equipmentTable.ip,
      username: equipmentTable.username,
      password: equipmentTable.password,
      equipmentRole: equipmentTable.equipmentRole,
      connectionType: equipmentTable.connectionType,
    })
    .from(equipmentTable)
    .where(eq(equipmentTable.id, equipmentId));
  if (!equip || equip.equipmentRole !== "core_router" || equip.connectionType !== "mikrotik_routeros") return null;
  return equip;
}

export async function getBillingSummary() {
  const clients = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      mac: clientsTable.mac,
      ip: clientsTable.ip,
      equipmentId: clientsTable.equipmentId,
      equipmentModel: equipmentTable.model,
      planLimit: clientsTable.planLimit,
      status: clientsTable.status,
      paymentStatus: clientsTable.paymentStatus,
      monthlyFee: clientsTable.monthlyFee,
      dueDate: clientsTable.dueDate,
      lastPaymentDate: clientsTable.lastPaymentDate,
      lastSeenDbm: clientsTable.lastSeenDbm,
      createdAt: clientsTable.createdAt,
    })
    .from(clientsTable)
    .leftJoin(equipmentTable, eq(equipmentTable.id, clientsTable.equipmentId));

  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  let paidCount = 0;
  let pendingCount = 0;
  let suspendedCount = 0;
  let totalMonthlyIncome = 0;
  let pendingIncome = 0;
  const overdueToday: typeof clients = [];

  for (const c of clients) {
    const fee = parseFloat(c.monthlyFee ?? "0");
    if (c.paymentStatus === "PAID") {
      paidCount++;
      totalMonthlyIncome += fee;
    } else if (c.paymentStatus === "PENDING") {
      pendingCount++;
      pendingIncome += fee;
      if (c.dueDate && new Date(c.dueDate) <= todayEnd) overdueToday.push(c);
    } else if (c.paymentStatus === "SUSPENDED") {
      suspendedCount++;
    }
  }

  return {
    totalClients: clients.length,
    paidCount,
    pendingCount,
    suspendedCount,
    totalMonthlyIncome,
    pendingIncome,
    overdueToday: overdueToday.map(c => ({
      ...c,
      equipmentModel: c.equipmentModel ?? null,
      dueDate: c.dueDate?.toISOString() ?? null,
      lastPaymentDate: c.lastPaymentDate?.toISOString() ?? null,
      monthlyFee: c.monthlyFee ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}
