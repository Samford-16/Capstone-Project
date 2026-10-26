const express = require("express");
const { prisma } = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { badRequest, conflict, forbidden, notFound, idParam } = require("../lib/http");
const { netPaid, refreshInvoiceStatus, serializeInvoice, invoiceNumber, INVOICE_INCLUDE } = require("../lib/billing");
const { getStripe, stripeEnabled, callStripe, recordCheckoutSession } = require("../lib/stripe");
const config = require("../config");
const { chargeCard } = require("../lib/cards");
const { dayRange } = require("../lib/dates");
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
      issuedAt: q.from || q.to ? dayRange(q.from, q.to) : undefined,
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

    if (stripeEnabled()) {
      throw conflict("Online payments go through Stripe checkout.", "USE_CHECKOUT");
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

/**
 * Family: start a Stripe Checkout for the invoice balance. Returns the URL of
 * Stripe's hosted payment page; the browser goes there, then comes back to
 * /billing with the session id so the payment can be confirmed.
 */
router.post("/invoices/:id/checkout", async (req, res) => {
  const invoiceId = idParam(req.params.id);
  if (req.user.role !== "PARENT" && req.user.role !== "SWIMMER") {
    throw forbidden("Only families pay online. Use Record payment for money taken at the desk.");
  }
  const invoice = await loadInvoice(prisma, invoiceId, req.user);
  if (invoice.status === "VOID") throw conflict("This invoice was voided.", "INVOICE_VOID");
  const balance = invoice.amountCents - netPaid(invoice.payments);
  if (balance <= 0 || invoice.status !== "UNPAID") throw conflict("This invoice is already paid.", "ALREADY_PAID");

  const stripe = getStripe();
  const swimmer = invoice.enrollment?.swimmer;
  const lesson = invoice.enrollment?.lesson;
  const session = await callStripe(() =>
    stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: req.user.email,
      client_reference_id: String(invoice.id),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: balance,
            product_data: {
              name: `${invoiceNumber(invoice.id)} · ${lesson ? lesson.name : "Swim lessons"}`,
              description: `${swimmer ? `${swimmer.firstName} ${swimmer.lastName}, ` : ""}${invoice.sessionCount} sessions at $${(invoice.ratePerSessionCents / 100).toFixed(2)}`,
            },
          },
        },
      ],
      metadata: { invoiceId: String(invoice.id), userId: String(req.user.id) },
      payment_intent_data: { metadata: { invoiceId: String(invoice.id) } },
      success_url: `${config.appUrl}/billing?checkout=success&invoice=${invoice.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appUrl}/billing?checkout=cancelled`,
    }),
  );
  res.status(201).json({ url: session.url, sessionId: session.id });
});

/** Family returns from Stripe: look the session up with Stripe and record the payment once. */
router.post("/invoices/:id/checkout/confirm", async (req, res) => {
  const invoiceId = idParam(req.params.id);
  const { sessionId } = z.object({ sessionId: z.string().startsWith("cs_") }).parse(req.body);
  await loadInvoice(prisma, invoiceId, req.user);
  const session = await callStripe(() => getStripe().checkout.sessions.retrieve(sessionId));
  if (Number(session.metadata && session.metadata.invoiceId) !== invoiceId) {
    throw badRequest("That checkout belongs to a different invoice.");
  }
  const result = await recordCheckoutSession(session);
  res.json({
    duplicate: result.duplicate,
    payment: result.payment,
    invoice: serializeInvoice(await loadInvoice(prisma, invoiceId, req.user)),
  });
});

/**
 * Admin: give money back, up to what was paid. Any amount (a partial refund is fine).
 *
 * Refunds are for enrollments that are cancelled (G5). Refunding a swimmer who
 * stays in the class would leave them enrolled with nothing paid, so an active
 * enrollment must be cancelled in the same step: pass cancelEnrollment: true,
 * which also frees the seat. After any refund on a cancelled enrollment the
 * invoice is REFUNDED and nothing more is owed on it.
 */
router.post("/invoices/:id/refund", requireRole("ADMIN"), async (req, res) => {
  const invoiceId = idParam(req.params.id);
  const body = z
    .object({
      amountCents: z.coerce.number().int().positive().optional(),
      method: z.enum(["CASH", "CHECK", "CARD"]).optional(),
      reason: z.string().trim().max(200).optional(),
      cancelEnrollment: z.boolean().optional(),
    })
    .parse(req.body || {});

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const invoice = await loadInvoice(tx, invoiceId, req.user);
    const paid = netPaid(invoice.payments);
    if (paid <= 0) throw conflict("Nothing has been paid on this invoice.", "NOTHING_TO_REFUND");
    const amount = body.amountCents ?? paid;
    if (amount > paid) throw badRequest(`Refund is more than the $${(paid / 100).toFixed(2)} paid.`);

    if (invoice.enrollment && invoice.enrollment.status === "ACTIVE") {
      if (!body.cancelEnrollment) {
        throw conflict(
          "This swimmer is still enrolled. Refunding also cancels the enrollment, so confirm that to continue.",
          "ENROLLMENT_ACTIVE",
        );
      }
      await tx.enrollment.update({
        where: { id: invoice.enrollment.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }
    const lastPayment = [...invoice.payments].reverse().find((p) => p.kind === "PAYMENT");
    let method = body.method || lastPayment.method;
    let reference = body.reason || null;

    // Money paid through Stripe goes back through Stripe, to the same card.
    const stripePayment = [...invoice.payments]
      .reverse()
      .find((p) => p.kind === "PAYMENT" && p.method === "CARD" && p.reference && p.reference.startsWith("pi_"));
    if (stripePayment) {
      if (amount > stripePayment.amountCents) {
        throw badRequest(`Stripe refunds go back to one card payment at a time. The most you can refund here is $${(stripePayment.amountCents / 100).toFixed(2)}.`);
      }
      const refund = await callStripe(() =>
        getStripe().refunds.create({ payment_intent: stripePayment.reference, amount, metadata: { invoiceId: String(invoiceId) } }),
      );
      method = "CARD";
      reference = body.reason ? `${refund.id} · ${body.reason}` : refund.id;
    }

    await tx.payment.create({
      data: { invoiceId, kind: "REFUND", method, amountCents: amount, reference, recordedById: req.user.id },
    });
  }, { timeout: 20000 });

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
