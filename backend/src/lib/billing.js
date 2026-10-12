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

function statusFor(invoice, payments) {
  if (invoice.status === "VOID") return "VOID";
  const paid = netPaid(payments);
  const refunded = payments.some((p) => p.kind === "REFUND");
  if (paid >= invoice.amountCents) return "PAID";
  if (paid <= 0 && refunded) return "REFUNDED";
  return "UNPAID";
}

/** Recalculate and save an invoice's status from its payments. */
async function refreshInvoiceStatus(tx, invoiceId) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
  const status = statusFor(invoice, invoice.payments);
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
  return {
    id: inv.id,
    number: invoiceNumber(inv.id),
    status: inv.status,
    amountCents: inv.amountCents,
    paidCents: paid,
    // A void or refunded invoice is settled: nothing is owed on it.
    balanceCents: inv.status === "VOID" || inv.status === "REFUNDED" ? 0 : Math.max(inv.amountCents - paid, 0),
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
  billedTo: { select: { id: true, name: true, email: true } },
  enrollment: {
    include: {
      swimmer: { select: { id: true, firstName: true, lastName: true } },
      lesson: { select: { id: true, name: true } },
    },
  },
};

module.exports = {
  rateForStage,
  currentRates,
  netPaid,
  statusFor,
  refreshInvoiceStatus,
  invoiceNumber,
  serializeInvoice,
  INVOICE_INCLUDE,
};
