const express = require("express");
const { prisma } = require("../db");
const config = require("../config");
const { authenticate, requireRole } = require("../middleware/auth");
const { conflict, notFound, idParam } = require("../lib/http");
const { visibleSwimmerIds, assertCanManageSwimmer, billingAccountFor } = require("../lib/access");
const { rateForStage, serializeInvoice, INVOICE_INCLUDE } = require("../lib/billing");
const { todayISO, toDate, toISO, addDays } = require("../lib/dates");
const { z, id } = require("../lib/schemas");

const router = express.Router();
router.use("/enrollments", authenticate);

function serialize(e) {
  return {
    id: e.id,
    status: e.status,
    createdAt: e.createdAt,
    cancelledAt: e.cancelledAt,
    swimmer: { id: e.swimmer.id, name: `${e.swimmer.firstName} ${e.swimmer.lastName}` },
    lesson: {
      id: e.lesson.id,
      name: e.lesson.name,
      dayOfWeek: e.lesson.dayOfWeek,
      startTime: e.lesson.startTime,
      endTime: e.lesson.endTime,
      startDate: toISO(e.lesson.startDate),
      endDate: toISO(e.lesson.endDate),
      status: e.lesson.status,
      stage: e.lesson.stage,
      coach: e.lesson.coach,
    },
    invoice: e.invoice ? { id: e.invoice.id, status: e.invoice.status, amountCents: e.invoice.amountCents } : null,
  };
}

const INCLUDE = {
  swimmer: { select: { id: true, firstName: true, lastName: true } },
  lesson: {
    include: { stage: { select: { id: true, name: true, color: true } }, coach: { select: { id: true, name: true } } },
  },
  invoice: { select: { id: true, status: true, amountCents: true } },
};

router.get("/enrollments", async (req, res) => {
  const q = z.object({ status: z.enum(["ACTIVE", "CANCELLED", "ALL"]).default("ACTIVE"), lessonId: id.optional() }).parse(req.query);
  const where = { status: q.status === "ALL" ? undefined : q.status, lessonId: q.lessonId };
  if (req.user.role === "COACH") where.lesson = { coachId: req.user.id };
  else {
    const ids = await visibleSwimmerIds(prisma, req.user);
    if (ids !== null) where.swimmerId = { in: ids };
  }
  const rows = await prisma.enrollment.findMany({
    where,
    include: INCLUDE,
    orderBy: [{ lesson: { dayOfWeek: "asc" } }, { lesson: { startTime: "asc" } }],
  });
  res.json(rows.map(serialize));
});

/**
 * Enroll a swimmer in a lesson.
 *
 * Capacity is enforced inside one database transaction that first locks the
 * lesson row (SELECT ... FOR UPDATE). Two families racing for the last spot
 * are serialized: the second request waits, then sees the lesson is full.
 * The invoice is created in the same transaction, so an enrollment can never
 * exist without its invoice.
 */
router.post("/enrollments", requireRole("ADMIN", "PARENT", "SWIMMER"), async (req, res) => {
  const body = z.object({ lessonId: id, swimmerId: id }).parse(req.body);
  const swimmer = await assertCanManageSwimmer(prisma, req.user, body.swimmerId);
  const today = todayISO();

  const enrollment = await prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw`SELECT id FROM "Lesson" WHERE id = ${body.lessonId} FOR UPDATE`;
      if (locked.length === 0) throw notFound("Lesson");
      const lesson = await tx.lesson.findUnique({ where: { id: body.lessonId } });

      if (lesson.status !== "ACTIVE") throw conflict("This lesson has been cancelled.", "LESSON_CANCELLED");
      if (toISO(lesson.endDate) < today) throw conflict("This lesson has already ended.", "LESSON_ENDED");

      const duplicate = await tx.enrollment.findFirst({
        where: { lessonId: lesson.id, swimmerId: swimmer.id, status: "ACTIVE" },
      });
      if (duplicate) throw conflict(`${swimmer.firstName} is already enrolled in this lesson.`, "ALREADY_ENROLLED");

      const enrolled = await tx.enrollment.count({ where: { lessonId: lesson.id, status: "ACTIVE" } });
      if (enrolled >= lesson.capacity) throw conflict("This lesson is full.", "LESSON_FULL");

      const sessions = await tx.lessonSession.findMany({
        where: { lessonId: lesson.id, cancelled: false, date: { gte: toDate(today) } },
        orderBy: { date: "asc" },
        select: { date: true },
      });
      if (sessions.length === 0) throw conflict("There are no sessions left in this lesson.", "NO_SESSIONS_LEFT");

      const rate = await rateForStage(tx, lesson.stageId, today);
      const firstClass = toISO(sessions[0].date);
      const dueDate = firstClass > today ? firstClass : addDays(today, config.invoiceDueDays);

      return tx.enrollment.create({
        data: {
          lessonId: lesson.id,
          swimmerId: swimmer.id,
          enrolledById: req.user.id,
          invoice: {
            create: {
              billedToId: billingAccountFor(req.user, swimmer),
              stageId: lesson.stageId,
              sessionCount: sessions.length,
              ratePerSessionCents: rate,
              amountCents: sessions.length * rate,
              dueDate: toDate(dueDate),
            },
          },
        },
        include: { ...INCLUDE, invoice: { include: INVOICE_INCLUDE } },
      });
    },
    { timeout: 15000 },
  );

  res.status(201).json({ ...serialize(enrollment), invoice: serializeInvoice(enrollment.invoice) });
});

/**
 * Cancel an enrollment. An unpaid invoice with no payments is voided.
 * If money was paid, the invoice stays and an admin decides on a refund.
 */
router.post("/enrollments/:id/cancel", async (req, res) => {
  const enrollmentId = idParam(req.params.id);
  const existing = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!existing) throw notFound("Enrollment");
  await assertCanManageSwimmer(prisma, req.user, existing.swimmerId);

  const result = await prisma.$transaction(async (tx) => {
    const e = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { invoice: { include: { payments: true } } },
    });
    if (e.status === "CANCELLED") throw conflict("This enrollment is already cancelled.", "ALREADY_CANCELLED");
    await tx.enrollment.update({ where: { id: e.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });

    let invoiceAction = "none";
    if (e.invoice && e.invoice.status === "UNPAID" && e.invoice.payments.length === 0) {
      await tx.invoice.update({
        where: { id: e.invoice.id },
        data: { status: "VOID", voidedAt: new Date(), note: "Enrollment cancelled" },
      });
      invoiceAction = "voided";
    } else if (e.invoice && e.invoice.payments.length > 0) {
      invoiceAction = "refund_review";
    }
    return { invoiceAction };
  });

  res.json({
    id: enrollmentId,
    status: "CANCELLED",
    invoiceAction: result.invoiceAction,
    message:
      result.invoiceAction === "voided"
        ? "Enrollment cancelled and the unpaid invoice was voided."
        : result.invoiceAction === "refund_review"
          ? "Enrollment cancelled. A payment was already made, so an admin will review a refund."
          : "Enrollment cancelled.",
  });
});

module.exports = router;
