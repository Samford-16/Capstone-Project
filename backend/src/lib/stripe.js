// Stripe Checkout (test mode).
//
// Families are sent to Stripe's hosted payment page, so card numbers never
// touch this server. When they come back (or when Stripe calls our webhook),
// we look the checkout session up and record the payment exactly once, using
// the PaymentIntent id (pi_...) as the payment reference.

const Stripe = require("stripe");
const config = require("../config");
const { prisma } = require("../db");
const { HttpError, badRequest, conflict } = require("./http");
const { refreshInvoiceStatus } = require("./billing");

let client = null;
// undefined = use the key from .env; null = act as if Stripe is not set up;
// an object = a fake Stripe client (used by the automated tests).
let override;

function setStripeForTests(fake) {
  override = fake;
}

function stripeEnabled() {
  if (override !== undefined) return Boolean(override);
  return Boolean(config.stripeSecretKey);
}

function getStripe() {
  if (override !== undefined) {
    if (!override) throw notConfigured();
    return override;
  }
  if (!config.stripeSecretKey) throw notConfigured();
  if (!client) client = new Stripe(config.stripeSecretKey);
  return client;
}

function notConfigured() {
  return conflict("Online card payments through Stripe aren't set up. Add STRIPE_SECRET_KEY to backend/.env.", "STRIPE_NOT_CONFIGURED");
}

/** Run a Stripe API call and turn Stripe's errors into a clean 502 for the client. */
async function callStripe(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `Stripe: ${e.message}`, "STRIPE_ERROR");
  }
}

function paymentIntentId(session) {
  const pi = session.payment_intent;
  return typeof pi === "string" ? pi : pi && pi.id;
}

/**
 * Record the payment for a completed checkout session. Safe to call more than
 * once for the same session (return page and webhook both call it): the
 * PaymentIntent id is checked under a row lock before inserting.
 */
async function recordCheckoutSession(session) {
  if (session.payment_status !== "paid") {
    throw conflict("This checkout hasn't been paid yet.", "NOT_PAID");
  }
  const invoiceId = Number(session.metadata && session.metadata.invoiceId);
  const pi = paymentIntentId(session);
  if (!invoiceId || !pi) throw badRequest("This checkout is missing its invoice details.");

  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    if (locked.length === 0) throw badRequest("The invoice for this checkout no longer exists.");
    const existing = await tx.payment.findFirst({ where: { reference: pi } });
    if (existing) return { payment: existing, duplicate: true };
    // Money was taken by Stripe, so it is always recorded, even if the invoice
    // was paid another way in the meantime. An admin can refund the extra.
    const payment = await tx.payment.create({
      data: {
        invoiceId,
        kind: "PAYMENT",
        method: "CARD",
        amountCents: session.amount_total,
        reference: pi,
        recordedById: Number(session.metadata.userId) || null,
      },
    });
    return { payment, duplicate: false };
  });

  await refreshInvoiceStatus(prisma, invoiceId);
  return { invoiceId, ...result };
}

module.exports = { getStripe, stripeEnabled, setStripeForTests, callStripe, recordCheckoutSession };
