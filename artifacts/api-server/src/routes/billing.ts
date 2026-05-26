import { Router, type IRouter } from "express";
import { RegisterClientPaymentParams, RegisterClientPaymentBody } from "@workspace/api-zod";
import { registerPayment, getBillingSummary, runBillingCheck } from "../services/billing.service";

const router: IRouter = Router();

router.post("/clients/:id/payment", async (req, res): Promise<void> => {
  const params = RegisterClientPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = RegisterClientPaymentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const daysUntilNextDue = body.data.daysUntilNextDue ?? 30;
  const ok = await registerPayment(params.data.id, body.data.monthlyFee, daysUntilNextDue);
  if (!ok) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json({ success: true, message: `Pago registrado. Próximo vencimiento en ${daysUntilNextDue} días.` });
});

router.get("/billing/summary", async (_req, res): Promise<void> => {
  const summary = await getBillingSummary();
  res.json(summary);
});

router.post("/billing/suspend-overdue", async (_req, res): Promise<void> => {
  const result = await runBillingCheck();
  res.json({
    success: true,
    message: `Corte ejecutado: ${result.suspended} suspendidos, ${result.markedPending} marcados como pendientes.`,
  });
});

export default router;
