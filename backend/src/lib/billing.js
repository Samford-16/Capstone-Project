// Bookkeeping rules. See docs/decisions.md for why these are the rules.
//
// - Each stage has a price per session with an effective date (StagePrice).
// - Enrolling creates one invoice: remaining sessions x the rate effective
//   on the enrollment date. The rate is copied onto the invoice so a later
//   price change never rewrites an invoice that was already issued.
// - Invoices are never deleted. Unpaid ones are voided; paid ones are refunded.

const { toDate, toISO } = require("./dates");
const { conflict } = require("./http");

/** The price per session for a stage on a given date, or throws 409. */
async function rateForStage(tx, stageId, onIso) {
  const price = await tx.stagePrice.findFirst({
    where: { stageId, effectiveFrom: { lte: toDate(onIso) } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!price) {
    throw conflict(`No price is set for Stage ${stageId} on ${onIso}. An admin needs to set one.`, "NO_PRICE");
  }
  return price.priceCents;
}

/** Current price per stage as a Map(stageId -> cents), for listing lessons. */
async function currentRates(tx, onIso) {
  const rows = await tx.stagePrice.findMany({
    where: { effectiveFrom: { lte: toDate(onIso) } },
    orderBy: [{ stageId: "asc" }, { effectiveFrom: "desc" }],
  });
  const map = new Map();
  for (const r of rows) if (!map.has(r.stageId)) map.set(r.stageId, r.priceCents);
  return map;
}

/** Net money received on an invoice (payments minus refunds). */
function netPaid(payments) {
  return payments.reduce((sum, p) => sum + (p.kind === "REFUND" ? -p.amountCents : p.amountCents), 0);
}

/** Credits still in force (not reversed) for cancelled sessions. */
function liveCredits(credits) {
  return (credits || []).reduce((sum, c) => sum + (c.reversedAt ? 0 : c.amountCents), 0);
}

/** What the invoice actually asks for: the billed amount minus session credits (G4). */
function amountDue(invoice) {
  return Math.max(invoice.amountCents - liveCredits(invoice.credits), 0);
}

/**
 * An invoice's status from its payments.
 * A refund on a cancelled enrollment settles the invoice (REFUNDED, nothing
 * owed), even when only part of the money went back, for example when the
 * school keeps payment for sessions already attended. Without that rule a
 * partial refund would put the invoice back to UNPAID with a balance owed.
 */
function statusFor(invoice, payments, enrollmentStatus) {
  if (invoice.status === "VOID") return "VOID";
  const paid = netPaid(payments);
  const refunded = payments.some((p) => p.kind === "REFUND");
  if (refunded && enrollmentStatus === "CANCELLED") return "REFUNDED";
  if (paid >= amountDue(invoice)) return "PAID";
  if (paid <= 0 && refunded) return "REFUNDED";
  return "UNPAID";
}

/** Recalculate and save an invoice's status from its payments. */
async function refreshInvoiceStatus(tx, invoiceId) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { payments: true, credits: true, enrollment: { select: { status: true } } },
  });
  const status = statusFor(invoice, invoice.payments, invoice.enrollment?.status);
  if (status !== invoice.status) {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  }
  return status;
}

function invoiceNumber(id) {
  return `INV-${String(id).padStart(5, "0")}`;
}

function serializeInvoice(inv) {
  const payments = inv.payments || [];
  const paid = netPaid(payments);
  const enrollment = inv.enrollment;
  const settled = inv.status === "VOID" || inv.status === "REFUNDED";
  const due = amountDue(inv);
  return {
    id: inv.id,
    number: invoiceNumber(inv.id),
    status: inv.status,
    amountCents: inv.amountCents,
    creditsCents: liveCredits(inv.credits),
    amountDueCents: due,
    paidCents: paid,
    // A void or refunded invoice is settled: nothing is owed on it.
    balanceCents: settled ? 0 : Math.max(due - paid, 0),
    // Paid more than is now due because sessions were cancelled: the school
    // owes this back to the family (an admin refunds it).
    creditOwedCents: settled ? 0 : Math.max(paid - due, 0),
    credits: (inv.credits || []).map((c) => ({
      id: c.id,
      amountCents: c.amountCents,
      reason: c.reason,
      sessionDate: c.session ? toISO(c.session.date) : undefined,
      createdAt: c.createdAt,
      reversedAt: c.reversedAt,
    })),
    sessionCount: inv.sessionCount,
    ratePerSessionCents: inv.ratePerSessionCents,
    stageId: inv.stageId,
    issuedAt: inv.issuedAt,
    dueDate: toISO(inv.dueDate),
    voidedAt: inv.voidedAt,
    note: inv.note,
    billedTo: inv.billedTo ? { id: inv.billedTo.id, name: inv.billedTo.name, email: inv.billedTo.email } : undefined,
    enrollment: enrollment
      ? {
          id: enrollment.id,
          status: enrollment.status,
          swimmer: enrollment.swimmer
            ? { id: enrollment.swimmer.id, name: `${enrollment.swimmer.firstName} ${enrollment.swimmer.lastName}` }
            : undefined,
          lesson: enrollment.lesson ? { id: enrollment.lesson.id, name: enrollment.lesson.name } : undefined,
        }
      : undefined,
    payments: payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      method: p.method,
      amountCents: p.amountCents,
      reference: p.reference,
      receivedAt: p.receivedAt,
    })),
  };
}

const INVOICE_INCLUDE = {
  payments: { orderBy: { receivedAt: "asc" } },
  credits: { orderBy: { createdAt: "asc" }, include: { session: { select: { date: true } } } },
  billedTo: { select: { id: true, name: true, email: true } },
  enrollment: {
    include: {
      swimmer: { select: { id: true, firstName: true, lastName: true } },
      lesson: { select: { id: true, name: true } },
    },
  },
};

/** Record which sessions an invoice billed, one line each at the invoice rate. */
async function addInvoiceLines(tx, invoiceId, sessionIds, rate) {
  await tx.invoiceLine.createMany({
    data: sessionIds.map((sessionId) => ({ invoiceId, sessionId, amountCents: rate })),
  });
}

/**
 * G4: a session was cancelled. Credit every active enrollment whose invoice
 * billed that session, unless it already has a live credit for it.
 * Run inside a transaction that holds the lesson row lock.
 */
async function creditCancelledSession(tx, session, userId) {
  const lines = await tx.invoiceLine.findMany({
    where: {
      sessionId: session.id,
      invoice: { status: { notIn: ["VOID", "REFUNDED"] }, enrollment: { status: "ACTIVE" } },
    },
    select: { invoiceId: true, amountCents: true },
  });
  let credited = 0;
  let amount = 0;
  for (const line of lines) {
    if (line.amountCents === 0) continue;
    const live = await tx.invoiceCredit.findFirst({
      where: { invoiceId: line.invoiceId, sessionId: session.id, reversedAt: null },
    });
    if (live) continue;
    await tx.invoiceCredit.create({
      data: {
        invoiceId: line.invoiceId,
        sessionId: session.id,
        amountCents: line.amountCents,
        reason: `Session on ${toISO(session.date)} cancelled`,
        createdById: userId,
      },
    });
    await refreshInvoiceStatus(tx, line.invoiceId);
    credited += 1;
    amount += line.amountCents;
  }
  return { credited, amountCents: amount };
}

/** G4: a cancelled session was restored. Reverse its live credits (never deleted). */
async function reverseSessionCredits(tx, session, userId) {
  const live = await tx.invoiceCredit.findMany({ where: { sessionId: session.id, reversedAt: null } });
  for (const c of live) {
    await tx.invoiceCredit.update({ where: { id: c.id }, data: { reversedAt: new Date(), reversedById: userId } });
    await refreshInvoiceStatus(tx, c.invoiceId);
  }
  return { reversed: live.length, amountCents: live.reduce((s, c) => s + c.amountCents, 0) };
}

module.exports = {
  rateForStage,
  currentRates,
  netPaid,
  liveCredits,
  amountDue,
  addInvoiceLines,
  creditCancelledSession,
  reverseSessionCredits,
  statusFor,
  refreshInvoiceStatus,
  invoiceNumber,
  serializeInvoice,
  INVOICE_INCLUDE,
};
