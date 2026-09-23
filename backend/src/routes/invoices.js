const express = require("express");
const { prisma } = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { badRequest, conflict, forbidden, notFound, idParam } = require("../lib/http");
const { netPaid, refreshInvoiceStatus, serializeInvoice, INVOICE_INCLUDE } = require("../lib/billing");
const { chargeCard } = require("../lib/cards");
const { toDate, addDays } = require("../lib/dates");
const { z, isoDate, stageId } = require("../lib/schemas");

const router = express.Router();
router.use("/invoices", authenticate);

async function loadInvoice(tx, invoiceId, user) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: INVOICE_INCLUDE });
  if (!invoice) throw notFound("Invoice");
  if (user.role !== "ADMIN" && invoice.billedToId !== user.id) throw forbidden("This invoice is not yours.");
  return invoice;
}

// Admins see every invoice. Families see invoices billed to them. Coaches see none.
router.get("/invoices", async (req, res) => {
  if (req.user.role === "COACH") throw forbidden();
  const q = z
    .object({
      status: z.enum(["UNPAID", "PAID", "VOID", "REFUNDED"]).optional(),
      stageId: stageId.optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
    })
    .parse(req.query);
  const invoices = await prisma.invoice.findMany({
    where: {
      billedToId: req.user.role === "ADMIN" ? undefined : req.user.id,
      status: q.status,
      stageId: q.stageId,
      issuedAt: q.from || q.to ? { gte: q.from ? toDate(q.from) : undefined, lt: q.to ? toDate(addDays(q.to, 1)) : undefined } : undefined,
    },
    include: INVOICE_INCLUDE,
    orderBy: { issuedAt: "desc" },
  });
  res.json(invoices.map(serializeInvoice));
});

router.get("/invoices/:id", async (req, res) => {
  res.json(serializeInvoice(await loadInvoice(prisma, idParam(req.params.id), req.user)));
});

/**
 * Record a payment.
 * - Admin: records money received at the desk (cash, check or card), any amount up to the balance.
 * - Family: pays the full balance online with a card (simulated checkout).
 */
router.post("/invoices/:id/payments", async (req, res) => {
  const invoiceId = idParam(req.params.id);
  if (req.user.role === "COACH") throw forbidden();

  const payment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const invoice = await loadInvoice(tx, invoiceId, req.user);
    if (invoice.status === "VOID") throw conflict("This invoice was voided.", "INVOICE_VOID");
    const balance = invoice.amountCents - netPaid(invoice.payments);
    if (balance <= 0) throw conflict("This invoice is already paid.", "ALREADY_PAID");

    if (req.user.role === "ADMIN") {
      const body = z
        .object({
          amountCents: z.coerce.number().int().positive(),
          method: z.enum(["CASH", "CHECK", "CARD"]),
          reference: z.string().trim().max(100).optional().nullable(),
        })
        .parse(req.body);
      if (body.amountCents > balance) throw badRequest(`Amount is more than the balance of $${(balance / 100).toFixed(2)}.`);
      return tx.payment.create({
        data: { invoiceId, kind: "PAYMENT", method: body.method, amountCents: body.amountCents, reference: body.reference || null, recordedById: req.user.id },
      });
    }

    const body = z
      .object({ card: z.object({ name: z.string(), number: z.string(), exp: z.string(), cvc: z.string() }) })
      .parse(req.body);
    const reference = chargeCard(body.card);
    return tx.payment.create({
      data: { invoiceId, kind: "PAYMENT", method: "CARD", amountCents: balance, reference, recordedById: req.user.id },
    });
  });

  await refreshInvoiceStatus(prisma, invoiceId);
  const invoice = await loadInvoice(prisma, invoiceId, req.user);
  res.status(201).json({ payment, invoice: serializeInvoice(invoice) });
});

// Admin: give money back, up to what was paid.
router.post("/invoices/:id/refund", requireRole("ADMIN"), async (req, res) => {
  const invoiceId = idParam(req.params.id);
  const body = z
    .object({
      amountCents: z.coerce.number().int().positive().optional(),
      method: z.enum(["CASH", "CHECK", "CARD"]).optional(),
      reason: z.string().trim().max(200).optional(),
    })
    .parse(req.body || {});

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const invoice = await loadInvoice(tx, invoiceId, req.user);
    const paid = netPaid(invoice.payments);
    if (paid <= 0) throw conflict("Nothing has been paid on this invoice.", "NOTHING_TO_REFUND");
    const amount = body.amountCents ?? paid;
    if (amount > paid) throw badRequest(`Refund is more than the $${(paid / 100).toFixed(2)} paid.`);
    const lastPayment = [...invoice.payments].reverse().find((p) => p.kind === "PAYMENT");
    await tx.payment.create({
      data: {
        invoiceId,
        kind: "REFUND",
        method: body.method || lastPayment.method,
        amountCents: amount,
        reference: body.reason || null,
        recordedById: req.user.id,
      },
    });
  });

  await refreshInvoiceStatus(prisma, invoiceId);
  res.json(serializeInvoice(await loadInvoice(prisma, invoiceId, req.user)));
});

// Admin: void an invoice that has no money on it (billing mistake, waived fee).
router.post("/invoices/:id/void", requireRole("ADMIN"), async (req, res) => {
  const invoiceId = idParam(req.params.id);
  const body = z.object({ reason: z.string().trim().max(200).optional() }).parse(req.body || {});
  const invoice = await loadInvoice(prisma, invoiceId, req.user);
  if (invoice.status === "VOID") throw conflict("This invoice is already void.", "INVOICE_VOID");
  if (invoice.payments.length > 0) throw conflict("This invoice has payments. Refund it instead.", "HAS_PAYMENTS");
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "VOID", voidedAt: new Date(), note: body.reason || "Voided by admin" },
  });
  res.json(serializeInvoice(await loadInvoice(prisma, invoiceId, req.user)));
});

module.exports = router;
