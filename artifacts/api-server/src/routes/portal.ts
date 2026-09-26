import { Router, type IRouter, type Request } from "express";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, clientsTable, portalAccessTable, ticketsTable, paymentsTable } from "@workspace/db";

const router: IRouter = Router();

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function id(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getPortalClient(req: Request): Promise<number | null> {
  const token = req.header("x-portal-token");
  if (!token || token.length < 32) return null;
  const [access] = await db.select({ clientId: portalAccessTable.clientId })
    .from(portalAccessTable)
    .where(and(
      eq(portalAccessTable.tokenHash, hash(token)),
      or(isNull(portalAccessTable.expiresAt), gt(portalAccessTable.expiresAt, new Date())),
    ));
  if (!access) {
    return null;
  }
  await db.update(portalAccessTable).set({ lastUsedAt: new Date() })
    .where(eq(portalAccessTable.clientId, access.clientId));
  return access.clientId;
}

router.get("/session", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  const [client] = await db.select({
    id: clientsTable.id, name: clientsTable.name, planLimit: clientsTable.planLimit,
    status: clientsTable.status, paymentStatus: clientsTable.paymentStatus,
    monthlyFee: clientsTable.monthlyFee, dueDate: clientsTable.dueDate,
  }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
  const payments = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.clientId, clientId)).orderBy(paymentsTable.paidAt);
  const tickets = await db.select().from(ticketsTable)
    .where(eq(ticketsTable.clientId, clientId)).orderBy(ticketsTable.updatedAt);
  res.json({
    client: { ...client, dueDate: client.dueDate?.toISOString() ?? null },
    payments: payments.map(payment => ({ ...payment, paidAt: payment.paidAt.toISOString(), createdAt: payment.createdAt.toISOString() })),
    tickets: tickets.map(ticket => ({
      ...ticket,
      firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    })),
  });
});

router.post("/tickets", async (req, res): Promise<void> => {
  const clientId = await getPortalClient(req);
  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  if (!clientId) { res.status(401).json({ error: "Token de portal inválido o expirado" }); return; }
  if (!subject || !description || subject.length > 200 || description.length > 4000) {
    res.status(400).json({ error: "Asunto y descripción son obligatorios" });
    return;
  }
  const [ticket] = await db.insert(ticketsTable).values({
    clientId, subject, description, category: "client_report",
    priority: "normal", status: "open",
  }).returning();
  res.status(201).json({ id: ticket.id, status: ticket.status, createdAt: ticket.createdAt.toISOString() });
});

export default router;