const express = require("express");
const { prisma } = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { badRequest, conflict, forbidden, notFound, idParam } = require("../lib/http");
const { visibleSwimmerIds } = require("../lib/access");
const {
  validateSchedule,
  assertNoCoachConflict,
  createLessonWithSessions,
  decorateLessons,
  LESSON_INCLUDE,
} = require("../lib/lessons");
const { todayISO, toDate, toISO, addDays, mondayOf } = require("../lib/dates");
const { creditCancelledSession, reverseSessionCredits } = require("../lib/billing");
const { z, isoDate, time, id, stageId, dayOfWeek, lessonFields } = require("../lib/schemas");

const router = express.Router();
router.use(["/lessons", "/sessions"], authenticate);

async function familySwimmerIds(user) {
  return user.role === "PARENT" || user.role === "SWIMMER" ? visibleSwimmerIds(prisma, user) : [];
}

async function assertCoachExists(coachId) {
  if (!coachId) return;
  const coach = await prisma.user.findUnique({ where: { id: coachId } });
  if (!coach || coach.role !== "COACH" || !coach.active) throw badRequest("coachId must be an active coach.");
}

/**
 * List lessons. Coaches only ever see their own (per the proposal: "coaches
 * see only their assigned schedule"). Everyone else sees the full schedule.
 * By default, lessons that already ended are hidden.
 */
router.get("/lessons", async (req, res) => {
  const q = z
    .object({
      stageId: stageId.optional(),
      coachId: id.optional(),
      dayOfWeek: dayOfWeek.optional(),
      status: z.enum(["ACTIVE", "CANCELLED", "ALL"]).default("ACTIVE"),
      availability: z.enum(["open", "full"]).optional(),
      enrolled: z.enum(["true", "false"]).optional(),
      includePast: z.enum(["true", "false"]).optional(),
      // Any date in the week to show (G3). Only lessons that actually meet that week are returned.
      weekOf: isoDate.optional(),
      sort: z.enum(["time", "stage", "coach", "spots"]).default("time"),
    })
    .parse(req.query);

  const today = todayISO();
  const weekStart = q.weekOf ? mondayOf(q.weekOf) : null;
  const weekEnd = weekStart ? addDays(weekStart, 6) : null;
  const where = {
    stageId: q.stageId,
    dayOfWeek: q.dayOfWeek,
    coachId: req.user.role === "COACH" ? req.user.id : q.coachId,
    status: q.status === "ALL" ? undefined : q.status,
    ...(weekStart
      ? { startDate: { lte: toDate(weekEnd) }, endDate: { gte: toDate(weekStart) } }
      : { endDate: q.includePast === "true" ? undefined : { gte: toDate(today) } }),
  };
  const lessons = await prisma.lesson.findMany({
    where,
    include: LESSON_INCLUDE,
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });

  // A lesson overlapping the week may still not meet in it (it starts on Friday
  // but meets Mondays), so keep only those whose meeting day falls inside its dates.
  const meetsThisWeek = (l) => {
    const date = addDays(weekStart, (l.dayOfWeek + 6) % 7);
    return date >= toISO(l.startDate) && date <= toISO(l.endDate);
  };
  const inWeek = weekStart ? lessons.filter(meetsThisWeek) : lessons;

  const mySwimmerIds = await familySwimmerIds(req.user);
  let rows = await decorateLessons(prisma, inWeek, { mySwimmerIds });
  if (weekStart) {
    for (const l of rows) l.weekDate = addDays(weekStart, (l.dayOfWeek + 6) % 7);
  }

  if (q.availability === "open") rows = rows.filter((l) => !l.isFull);
  if (q.availability === "full") rows = rows.filter((l) => l.isFull);
  if (q.enrolled) {
    const want = q.enrolled === "true";
    rows = rows.filter((l) =>
      req.user.role === "PARENT" || req.user.role === "SWIMMER"
        ? l.myEnrollments.length > 0 === want
        : l.enrolledCount > 0 === want,
    );
  }

  const sorters = {
    time: (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    stage: (a, b) => a.stage.id - b.stage.id || sorters.time(a, b),
    coach: (a, b) => (a.coach?.name || "~").localeCompare(b.coach?.name || "~") || sorters.time(a, b),
    spots: (a, b) => b.spotsLeft - a.spotsLeft || sorters.time(a, b),
  };
  rows.sort(sorters[q.sort]);
  res.json(rows);
});

/** One lesson with its sessions. Admins and the lesson's coach also get the roster. */
router.get("/lessons/:id", async (req, res) => {
  const lessonId = idParam(req.params.id);
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { ...LESSON_INCLUDE, sessions: { orderBy: { date: "asc" } } },
  });
  if (!lesson) throw notFound("Lesson");
  if (req.user.role === "COACH" && lesson.coachId !== req.user.id) throw forbidden("This is not one of your lessons.");

  const [decorated] = await decorateLessons(prisma, [lesson], { mySwimmerIds: await familySwimmerIds(req.user) });
  const result = {
    ...decorated,
    sessions: lesson.sessions.map((s) => ({ id: s.id, date: toISO(s.date), cancelled: s.cancelled })),
  };

  if (req.user.role === "ADMIN" || req.user.role === "COACH") {
    const enrollments = await prisma.enrollment.findMany({
      where: { lessonId, status: "ACTIVE" },
      include: {
        swimmer: {
          include: { parents: { include: { parent: { select: { name: true, phone: true, email: true } } } } },
        },
        invoice: { select: { status: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    result.roster = enrollments.map((e) => ({
      enrollmentId: e.id,
      enrolledAt: e.createdAt,
      swimmer: {
        id: e.swimmer.id,
        name: `${e.swimmer.firstName} ${e.swimmer.lastName}`,
        dateOfBirth: toISO(e.swimmer.dateOfBirth),
        stageId: e.swimmer.stageId,
      },
      contacts: e.swimmer.parents.map((p) => p.parent),
      // Coaches do not need to see who has paid.
      invoiceStatus: req.user.role === "ADMIN" ? e.invoice?.status ?? null : undefined,
    }));
  }
  res.json(result);
});

router.post("/lessons", requireRole("ADMIN"), async (req, res) => {
  const body = z.object({ ...lessonFields, startDate: isoDate, endDate: isoDate }).parse(req.body);
  validateSchedule(body);
  await assertCoachExists(body.coachId);
  const lesson = await prisma.$transaction(async (tx) => {
    await assertNoCoachConflict(tx, body);
    return createLessonWithSessions(tx, body);
  });
  const full = await prisma.lesson.findUnique({ where: { id: lesson.id }, include: LESSON_INCLUDE });
  const [decorated] = await decorateLessons(prisma, [full]);
  res.status(201).json(decorated);
});

// Stage, day and dates are fixed once a lesson exists because invoices were
// priced from them. To change those, cancel the lesson and create a new one.
router.patch("/lessons/:id", requireRole("ADMIN"), async (req, res) => {
  const lessonId = idParam(req.params.id);
  const body = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      coachId: id.optional().nullable(),
      capacity: lessonFields.capacity.optional(),
      location: lessonFields.location,
      startTime: time.optional(),
      endTime: time.optional(),
    })
    .parse(req.body);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Lesson" WHERE id = ${lessonId} FOR UPDATE`;
    const lesson = await tx.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw notFound("Lesson");
    if (lesson.status !== "ACTIVE") throw conflict("Cancelled lessons cannot be edited.", "LESSON_CANCELLED");

    const next = {
      coachId: body.coachId === undefined ? lesson.coachId : body.coachId,
      startTime: body.startTime ?? lesson.startTime,
      endTime: body.endTime ?? lesson.endTime,
      dayOfWeek: lesson.dayOfWeek,
      startDate: toISO(lesson.startDate),
      endDate: toISO(lesson.endDate),
    };
    if (next.startTime >= next.endTime) throw badRequest("End time must be after start time.");
    if (body.coachId) await assertCoachExists(body.coachId);
    await assertNoCoachConflict(tx, next, lessonId);

    if (body.capacity !== undefined) {
      const enrolled = await tx.enrollment.count({ where: { lessonId, status: "ACTIVE" } });
      if (body.capacity < enrolled) {
        throw conflict(`${enrolled} swimmers are already enrolled, so capacity cannot go below ${enrolled}.`, "CAPACITY_TOO_LOW");
      }
    }
    return tx.lesson.update({ where: { id: lessonId }, data: body, include: LESSON_INCLUDE });
  });
  const [decorated] = await decorateLessons(prisma, [updated]);
  res.json(decorated);
});

/**
 * Cancel a lesson: cancels its enrollments and voids unpaid invoices.
 * Invoices with money on them are left for an admin to refund.
 */
router.post("/lessons/:id/cancel", requireRole("ADMIN"), async (req, res) => {
  const lessonId = idParam(req.params.id);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Lesson" WHERE id = ${lessonId} FOR UPDATE`;
    const lesson = await tx.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw notFound("Lesson");
    if (lesson.status === "CANCELLED") throw conflict("This lesson is already cancelled.", "LESSON_CANCELLED");

    const enrollments = await tx.enrollment.findMany({
      where: { lessonId, status: "ACTIVE" },
      include: { invoice: { include: { payments: true } } },
    });
    let voided = 0;
    let needsRefund = 0;
    for (const e of enrollments) {
      await tx.enrollment.update({ where: { id: e.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      if (!e.invoice || e.invoice.status === "VOID") continue;
      if (e.invoice.payments.length === 0) {
        await tx.invoice.update({
          where: { id: e.invoice.id },
          data: { status: "VOID", voidedAt: new Date(), note: "Lesson cancelled" },
        });
        voided++;
      } else {
        needsRefund++;
      }
    }
    await tx.lesson.update({ where: { id: lessonId }, data: { status: "CANCELLED" } });
    return { cancelledEnrollments: enrollments.length, voidedInvoices: voided, invoicesNeedingRefund: needsRefund };
  });
  res.json(result);
});

// Hard delete is only for mistakes: a lesson nobody ever enrolled in.
router.delete("/lessons/:id", requireRole("ADMIN"), async (req, res) => {
  const lessonId = idParam(req.params.id);
  const everEnrolled = await prisma.enrollment.count({ where: { lessonId } });
  if (everEnrolled) throw conflict("This lesson has enrollment history. Cancel it instead.", "HAS_HISTORY");
  await prisma.lesson.delete({ where: { id: lessonId } });
  res.status(204).end();
});

/** Dated sessions in a range, for the daily view. Same visibility as /lessons. */
router.get("/sessions", async (req, res) => {
  const q = z
    .object({ from: isoDate, to: isoDate.optional(), stageId: stageId.optional(), coachId: id.optional() })
    .parse(req.query);
  const to = q.to || q.from;
  if (to < q.from) throw badRequest("'to' must be on or after 'from'.");
  const sessions = await prisma.lessonSession.findMany({
    where: {
      date: { gte: toDate(q.from), lte: toDate(to) },
      lesson: {
        status: "ACTIVE",
        stageId: q.stageId,
        coachId: req.user.role === "COACH" ? req.user.id : q.coachId,
      },
    },
    include: { lesson: { include: LESSON_INCLUDE } },
    orderBy: [{ date: "asc" }, { lesson: { startTime: "asc" } }],
  });
  const lessons = [...new Map(sessions.map((s) => [s.lesson.id, s.lesson])).values()];
  const decorated = new Map(
    (await decorateLessons(prisma, lessons, { mySwimmerIds: await familySwimmerIds(req.user) })).map((l) => [l.id, l]),
  );
  res.json(
    sessions.map((s) => ({ id: s.id, date: toISO(s.date), cancelled: s.cancelled, lesson: decorated.get(s.lessonId) })),
  );
});

/**
 * Cancel or restore a single meeting (pool closed, holiday).
 * G4: cancelling credits every enrolled family that was billed for that date,
 * so their invoice owes one session less (or the school owes them money if it
 * was already paid). Restoring the date reverses those credits.
 */
router.patch("/sessions/:id", requireRole("ADMIN"), async (req, res) => {
  const sessionId = idParam(req.params.id);
  const body = z.object({ cancelled: z.boolean() }).parse(req.body);

  const result = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.lessonSession.findUnique({ where: { id: sessionId } });
      if (!existing) throw notFound("Session");
      // Same lock as enrolling, so a family can't enroll halfway through the crediting.
      await tx.$queryRaw`SELECT id FROM "Lesson" WHERE id = ${existing.lessonId} FOR UPDATE`;
      const s = await tx.lessonSession.update({ where: { id: sessionId }, data: { cancelled: body.cancelled } });
      if (body.cancelled === existing.cancelled) return { s, credits: { credited: 0, reversed: 0, amountCents: 0 } };
      const credits = body.cancelled
        ? await creditCancelledSession(tx, s, req.user.id)
        : await reverseSessionCredits(tx, s, req.user.id);
      return { s, credits };
    },
    { timeout: 20000 },
  );
  const { s, credits } = result;
  res.json({
    id: s.id,
    date: toISO(s.date),
    cancelled: s.cancelled,
    lessonId: s.lessonId,
    creditsIssued: credits.credited || 0,
    creditsReversed: credits.reversed || 0,
    creditAmountCents: credits.amountCents,
  });
});

module.exports = router;
