// Financial summaries for admins, by stage or by month.
//
// Invoiced and outstanding are based on when an invoice was issued.
// Collected and refunded are based on when the money actually moved.
// That is the difference between billing (accrual) and cash receipts.

const express = require("express");
const { prisma } = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { badRequest } = require("../lib/http");
const { netPaid } = require("../lib/billing");
const { toDate, addDays, todayISO } = require("../lib/dates");
const { z, isoDate } = require("../lib/schemas");
const config = require("../config");

const router = express.Router();
router.use("/reports", authenticate, requireRole("ADMIN"));

function monthKey(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit" }).format(date);
}

router.get("/reports/summary", async (req, res) => {
  const today = todayISO();
  const q = z
    .object({
      from: isoDate.default(`${today.slice(0, 4)}-01-01`),
      to: isoDate.default(today),
      groupBy: z.enum(["stage", "month"]).default("stage"),
    })
    .parse(req.query);
  if (q.to < q.from) throw badRequest("'to' must be on or after 'from'.");
  const range = { gte: toDate(q.from), lt: toDate(addDays(q.to, 1)) };

  const [stages, invoices, payments] = await Promise.all([
    prisma.stage.findMany({ orderBy: { id: "asc" } }),
    prisma.invoice.findMany({ where: { issuedAt: range }, include: { payments: true } }),
    prisma.payment.findMany({ where: { receivedAt: range }, include: { invoice: { select: { stageId: true } } } }),
  ]);

  const rows = new Map();
  const row = (key, label) => {
    if (!rows.has(key)) {
      rows.set(key, { key, label, invoiceCount: 0, invoicedCents: 0, voidedCents: 0, collectedCents: 0, refundedCents: 0, outstandingCents: 0 });
    }
    return rows.get(key);
  };
  if (q.groupBy === "stage") stages.forEach((s) => row(String(s.id), `Stage ${s.id}: ${s.name}`));

  for (const inv of invoices) {
    const key = q.groupBy === "stage" ? String(inv.stageId) : monthKey(inv.issuedAt);
    const r = row(key, key);
    if (inv.status === "VOID") {
      r.voidedCents += inv.amountCents;
      continue;
    }
    r.invoiceCount += 1;
    r.invoicedCents += inv.amountCents;
    r.outstandingCents += Math.max(inv.amountCents - netPaid(inv.payments), 0);
  }
  for (const p of payments) {
    const key = q.groupBy === "stage" ? String(p.invoice.stageId) : monthKey(p.receivedAt);
    const r = row(key, key);
    if (p.kind === "REFUND") r.refundedCents += p.amountCents;
    else r.collectedCents += p.amountCents;
  }

  const list = [...rows.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const totals = list.reduce(
    (t, r) => {
      for (const k of ["invoiceCount", "invoicedCents", "voidedCents", "collectedCents", "refundedCents", "outstandingCents"]) t[k] += r[k];
      return t;
    },
    { invoiceCount: 0, invoicedCents: 0, voidedCents: 0, collectedCents: 0, refundedCents: 0, outstandingCents: 0 },
  );
  totals.netCollectedCents = totals.collectedCents - totals.refundedCents;
  res.json({ from: q.from, to: q.to, groupBy: q.groupBy, rows: list, totals });
});

// Headline numbers for the admin dashboard.
router.get("/reports/overview", async (_req, res) => {
  const today = todayISO();
  const [lessons, activeEnrollments, openInvoices, monthPayments] = await Promise.all([
    prisma.lesson.findMany({ where: { status: "ACTIVE", endDate: { gte: toDate(today) } }, select: { id: true, capacity: true } }),
    prisma.enrollment.count({ where: { status: "ACTIVE", lesson: { status: "ACTIVE", endDate: { gte: toDate(today) } } } }),
    prisma.invoice.findMany({ where: { status: "UNPAID" }, include: { payments: true } }),
    prisma.payment.findMany({ where: { receivedAt: { gte: toDate(`${today.slice(0, 7)}-01`) } } }),
  ]);
  const seats = lessons.reduce((s, l) => s + l.capacity, 0);
  res.json({
    activeLessons: lessons.length,
    activeEnrollments,
    totalSeats: seats,
    fillRate: seats ? activeEnrollments / seats : 0,
    outstandingCents: openInvoices.reduce((s, i) => s + i.amountCents - netPaid(i.payments), 0),
    overdueInvoices: openInvoices.filter((i) => i.dueDate < toDate(today)).length,
    collectedThisMonthCents: monthPayments.reduce((s, p) => s + (p.kind === "REFUND" ? -p.amountCents : p.amountCents), 0),
  });
});

module.exports = router;
