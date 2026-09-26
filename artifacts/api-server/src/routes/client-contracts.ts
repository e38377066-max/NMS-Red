import express, { Router, type IRouter } from "express";
import path from "node:path";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  auditLogsTable,
  clientContractsTable,
  clientsTable,
  db,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import {
  downloadPrivateObject,
  uploadPrivateObject,
} from "../services/object-storage.service";

const router: IRouter = Router();
const MAX_CONTRACT_BYTES = 10 * 1024 * 1024;
const PDF_MIME_TYPES = new Set(["application/pdf", "application/octet-stream"]);

function asId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function serializeContract(row: typeof clientContractsTable.$inferSelect) {
  return {
    ...row,
    uploadedAt: row.uploadedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

function safeOriginalName(value: string | undefined): string | null {
  if (!value) return null;
  const name = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name || name.length > 255 || !name.toLowerCase().endsWith(".pdf")) return null;
  return name;
}

function writeAudit(
  req: express.Request,
  user: { id?: number; username?: string } | undefined,
  action: string,
  details: string,
  clientId: number,
  beforeState?: unknown,
  afterState?: unknown,
): Promise<unknown> {
  return db.insert(auditLogsTable).values({
    userId: user?.id ?? null,
    username: user?.username ?? "sistema",
    clientId,
    entity: "ClientContract",
    action,
    result: "Success",
    details,
    sourceIp: req.ip,
    device: req.get("user-agent")?.slice(0, 512) ?? null,
    beforeState: beforeState === undefined ? null : JSON.stringify(beforeState),
    afterState: afterState === undefined ? null : JSON.stringify(afterState),
  });
}

function rejectLargeRequest(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_CONTRACT_BYTES) {
    res.status(413).json({ error: "El contrato supera el límite de 10 MB" });
    return;
  }
  next();
}

router.get("/clients/:id/contracts", async (req, res): Promise<void> => {
  const clientId = asId(req.params.id);
  if (!clientId) {
    res.status(400).json({ error: "Cliente inválido" });
    return;
  }
  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: "Cliente no encontrado" });
    return;
  }
  const rows = await db.select().from(clientContractsTable)
    .where(eq(clientContractsTable.clientId, clientId))
    .orderBy(desc(clientContractsTable.version));
  res.json(rows.map(serializeContract));
});

router.post(
  "/clients/:id/contracts",
  requireRole("admin", "operator"),
  rejectLargeRequest,
  express.raw({ type: ["application/pdf", "application/octet-stream"], limit: MAX_CONTRACT_BYTES }),
  async (req, res): Promise<void> => {
    const clientId = asId(req.params.id);
    if (!clientId) {
      res.status(400).json({ error: "Cliente inválido" });
      return;
    }
    const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Cliente no encontrado" });
      return;
    }

    const originalName = safeOriginalName(req.get("x-original-file-name"));
    const contentType = (req.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const file = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!originalName || !PDF_MIME_TYPES.has(contentType) || file.length === 0 || file.length > MAX_CONTRACT_BYTES) {
      res.status(400).json({
        error: "Debes cargar un PDF válido de hasta 10 MB e indicar su nombre original",
      });
      return;
    }
    if (file.subarray(0, 5).toString("utf8") !== "%PDF-") {
      res.status(400).json({ error: "El archivo no parece ser un PDF válido" });
      return;
    }

    const [versionRow] = await db.select({
      maxVersion: sql<number>`coalesce(max(${clientContractsTable.version}), 0)`,
    }).from(clientContractsTable).where(eq(clientContractsTable.clientId, clientId));
    const version = Number(versionRow?.maxVersion ?? 0) + 1;
    const sha256 = createHash("sha256").update(file).digest("hex");
    const storagePath = await uploadPrivateObject(file, "application/pdf", ".pdf", `contracts/${clientId}`);
    const [contract] = await db.insert(clientContractsTable).values({
      clientId,
      version,
      status: "PENDING",
      isCurrent: false,
      originalName,
      mimeType: "application/pdf",
      sizeBytes: file.length,
      sha256,
      storagePath,
      uploadedByUserId: res.locals.user?.id ?? null,
    }).returning();

    await writeAudit(
      req,
      res.locals.user,
      "UPLOAD",
      `Contrato v${version} cargado para cliente ${clientId}`,
      clientId,
      undefined,
      { contractId: contract.id, version, originalName, sizeBytes: file.length, sha256 },
    );
    res.status(201).json(serializeContract(contract));
  },
);

router.patch(
  "/clients/:id/contracts/:contractId/review",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const clientId = asId(req.params.id);
    const contractId = asId(req.params.contractId);
    const status = typeof req.body?.status === "string" ? req.body.status.trim().toUpperCase() : "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!clientId || !contractId || !["APPROVED", "REJECTED"].includes(status)) {
      res.status(400).json({ error: "Cliente, contrato y estado de revisión son obligatorios" });
      return;
    }
    if (status === "REJECTED" && !reason) {
      res.status(400).json({ error: "El rechazo requiere un motivo" });
      return;
    }
    const [existing] = await db.select().from(clientContractsTable).where(and(
      eq(clientContractsTable.id, contractId),
      eq(clientContractsTable.clientId, clientId),
    ));
    if (!existing) {
      res.status(404).json({ error: "Contrato no encontrado" });
      return;
    }
    if (existing.status !== "PENDING") {
      res.status(409).json({ error: "Solo se pueden revisar contratos pendientes" });
      return;
    }

    const contract = await db.transaction(async (tx) => {
      if (status === "APPROVED") {
        await tx.update(clientContractsTable)
          .set({ isCurrent: false })
          .where(and(
            eq(clientContractsTable.clientId, clientId),
            eq(clientContractsTable.status, "APPROVED"),
          ));
      }
      const [updated] = await tx.update(clientContractsTable)
        .set({
          status,
          isCurrent: status === "APPROVED",
          reviewedByUserId: res.locals.user?.id ?? null,
          reviewReason: reason || null,
          reviewedAt: new Date(),
        })
        .where(and(
          eq(clientContractsTable.id, contractId),
          eq(clientContractsTable.status, "PENDING"),
        ))
        .returning();
      return updated;
    });

    if (!contract) {
      res.status(409).json({ error: "El contrato ya fue revisado por otro usuario" });
      return;
    }
    await writeAudit(
      req,
      res.locals.user,
      status === "APPROVED" ? "APPROVE" : "REJECT",
      `Contrato v${contract.version} ${status === "APPROVED" ? "aprobado" : "rechazado"} para cliente ${clientId}`,
      clientId,
      { status: existing.status, isCurrent: existing.isCurrent },
      { status: contract.status, isCurrent: contract.isCurrent, reason: contract.reviewReason },
    );
    res.json(serializeContract(contract));
  },
);

router.get("/clients/:id/contracts/:contractId/download", async (req, res): Promise<void> => {
  const clientId = asId(req.params.id);
  const contractId = asId(req.params.contractId);
  if (!clientId || !contractId) {
    res.status(400).json({ error: "Cliente o contrato inválido" });
    return;
  }
  const [contract] = await db.select().from(clientContractsTable).where(and(
    eq(clientContractsTable.id, contractId),
    eq(clientContractsTable.clientId, clientId),
  ));
  if (!contract) {
    res.status(404).json({ error: "Contrato no encontrado" });
    return;
  }
  try {
    const objectResponse = await downloadPrivateObject(contract.storagePath);
    const data = Buffer.from(await objectResponse.arrayBuffer());
    res.setHeader("Content-Type", contract.mimeType);
    res.setHeader("Content-Length", data.byteLength);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(contract.originalName)}`);
    res.end(data);
  } catch {
    res.status(404).json({ error: "Contrato no encontrado en el almacenamiento configurado" });
  }
});

export default router;