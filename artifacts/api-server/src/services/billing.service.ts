import { db, clientsTable, equipmentTable, auditLogsTable } from "@workspace/db";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { Server as SocketServer } from "socket.io";

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

export async function runBillingCheck(): Promise<{ suspended: number; markedPending: number }> {
  const now = new Date();
  let suspended = 0;
  let markedPending = 0;

  try {
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

      const isPastDue = due <= now;
      const isNearDue = !isPastDue && (due.getTime() - now.getTime()) < 3 * 24 * 60 * 60 * 1000;

      if (isPastDue && client.paymentStatus !== "SUSPENDED") {
        await db
          .update(clientsTable)
          .set({ paymentStatus: "SUSPENDED", status: "SUSPENDED" })
          .where(eq(clientsTable.id, client.id));

        await suspendClientOnMikroTik(client.equipmentId, client.mac, client.name);
        await db.insert(auditLogsTable).values({
          entity: "Client",
          action: "AUTO_SUSPEND",
          commandSent: `/ip/firewall/address-list add address=${client.ip ?? client.mac} list=Clientes_Cortados`,
          result: "Success",
          details: `Cliente ${client.name} suspendido automáticamente por vencimiento (fecha límite: ${due.toLocaleDateString("es")})`,
          equipmentId: client.equipmentId,
        });

        if (io) {
          io.emit("billing:suspended", { clientId: client.id, name: client.name, dueDate: due });
        }
        logger.info({ clientId: client.id, name: client.name }, "Client auto-suspended for non-payment");
        suspended++;
      } else if (isNearDue && client.paymentStatus === "PAID") {
        await db
          .update(clientsTable)
          .set({ paymentStatus: "PENDING" })
          .where(eq(clientsTable.id, client.id));

        if (io) {
          io.emit("billing:nearDue", { clientId: client.id, name: client.name, dueDate: due });
        }
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

  await reactivateClientOnMikroTik(client.equipmentId, client.mac, client.name, client.planLimit ?? "10M/10M");

  await db.insert(auditLogsTable).values({
    entity: "Client",
    action: "PAYMENT_REGISTERED",
    result: "Success",
    details: `Pago registrado: ${client.name} | Q${monthlyFee} | Próximo vencimiento: ${nextDue.toLocaleDateString("es")}`,
    equipmentId: client.equipmentId,
  });

  if (io) {
    io.emit("billing:paid", { clientId: client.id, name: client.name, nextDue });
  }
  return true;
}

async function suspendClientOnMikroTik(equipmentId: number, mac: string, clientName: string): Promise<void> {
  try {
    const [equip] = await db
      .select({ ip: equipmentTable.ip, username: equipmentTable.username, password: equipmentTable.password })
      .from(equipmentTable)
      .where(eq(equipmentTable.id, equipmentId));

    if (!equip) return;

    const auth = Buffer.from(`${equip.username}:${equip.password}`).toString("base64");
    const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };
    const baseUrl = `http://${equip.ip}/rest`;

    const queuesResp = await fetch(`${baseUrl}/queue/simple`, { headers });
    if (!queuesResp.ok) return;

    const queues = await queuesResp.json() as Array<{ ".id": string; target: string; "max-limit": string }>;
    const queue = queues.find(q => q.target?.includes(mac));
    if (queue) {
      await fetch(`${baseUrl}/queue/simple/${queue[".id"]}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ "max-limit": "64k/64k", comment: `SUSPENDIDO-${clientName}` }),
      });
    }
  } catch (err) {
    logger.warn({ err, mac }, "Could not apply suspension on MikroTik");
  }
}

async function reactivateClientOnMikroTik(
  equipmentId: number,
  mac: string,
  clientName: string,
  planLimit: string
): Promise<void> {
  try {
    const [equip] = await db
      .select({ ip: equipmentTable.ip, username: equipmentTable.username, password: equipmentTable.password })
      .from(equipmentTable)
      .where(eq(equipmentTable.id, equipmentId));

    if (!equip) return;

    const auth = Buffer.from(`${equip.username}:${equip.password}`).toString("base64");
    const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };
    const baseUrl = `http://${equip.ip}/rest`;

    const queuesResp = await fetch(`${baseUrl}/queue/simple`, { headers });
    if (!queuesResp.ok) return;

    const queues = await queuesResp.json() as Array<{ ".id": string; target: string }>;
    const queue = queues.find(q => q.target?.includes(mac));
    if (queue) {
      await fetch(`${baseUrl}/queue/simple/${queue[".id"]}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ "max-limit": planLimit, comment: clientName }),
      });
    }
  } catch (err) {
    logger.warn({ err, mac }, "Could not reactivate client on MikroTik");
  }
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
      if (c.dueDate && new Date(c.dueDate) <= todayEnd) {
        overdueToday.push(c);
      }
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
