const { toDate, toISO, todayISO, datesForWeekday, DAY_NAMES, fmtTime12 } = require("./dates");
const { conflict, badRequest } = require("./http");
const { currentRates } = require("./billing");

function defaultLessonName(stageId, dayOfWeek, startTime) {
  return `Stage ${stageId} · ${DAY_NAMES[dayOfWeek].slice(0, 3)} ${fmtTime12(startTime)}`;
}

/** Throw 400 unless start < end and the range has at least one class day. */
function validateSchedule({ dayOfWeek, startTime, endTime, startDate, endDate }) {
  if (startTime >= endTime) throw badRequest("End time must be after start time.");
  if (startDate > endDate) throw badRequest("End date must be on or after start date.");
  if (datesForWeekday(startDate, endDate, dayOfWeek).length === 0) {
    throw badRequest(`There is no ${DAY_NAMES[dayOfWeek]} between ${startDate} and ${endDate}.`);
  }
}

/**
 * A coach cannot teach two active lessons that overlap in both date range
 * and time on the same weekday.
 */
async function assertNoCoachConflict(tx, { coachId, dayOfWeek, startTime, endTime, startDate, endDate }, excludeId) {
  if (!coachId) return;
  const clash = await tx.lesson.findFirst({
    where: {
      coachId,
      dayOfWeek,
      status: "ACTIVE",
      id: excludeId ? { not: excludeId } : undefined,
      startTime: { lt: endTime },
      endTime: { gt: startTime },
      startDate: { lte: toDate(endDate) },
      endDate: { gte: toDate(startDate) },
    },
    include: { coach: { select: { name: true } } },
  });
  if (clash) {
    throw conflict(
      `${clash.coach.name} already teaches "${clash.name}" at that time (${DAY_NAMES[dayOfWeek]} ${fmtTime12(clash.startTime)}-${fmtTime12(clash.endTime)}).`,
      "COACH_CONFLICT",
    );
  }
}

/** Create a lesson and one LessonSession per class day. */
async function createLessonWithSessions(tx, data) {
  const lesson = await tx.lesson.create({
    data: {
      ...data,
      name: data.name || defaultLessonName(data.stageId, data.dayOfWeek, data.startTime),
      startDate: toDate(data.startDate),
      endDate: toDate(data.endDate),
    },
  });
  const dates = datesForWeekday(data.startDate, data.endDate, data.dayOfWeek);
  await tx.lessonSession.createMany({ data: dates.map((d) => ({ lessonId: lesson.id, date: toDate(d) })) });
  return lesson;
}

const LESSON_INCLUDE = {
  stage: { select: { id: true, name: true, color: true } },
  coach: { select: { id: true, name: true } },
};

/**
 * Attach live numbers to lessons: enrolled count, spots left, current price,
 * sessions remaining, and (for families) which of their swimmers are in it.
 */
async function decorateLessons(tx, lessons, { mySwimmerIds } = {}) {
  if (lessons.length === 0) return [];
  const ids = lessons.map((l) => l.id);
  const today = todayISO();

  const [counts, remaining, rates, mine] = await Promise.all([
    tx.enrollment.groupBy({ by: ["lessonId"], where: { lessonId: { in: ids }, status: "ACTIVE" }, _count: true }),
    tx.lessonSession.groupBy({
      by: ["lessonId"],
      where: { lessonId: { in: ids }, cancelled: false, date: { gte: toDate(today) } },
      _count: true,
    }),
    currentRates(tx, today),
    mySwimmerIds && mySwimmerIds.length
      ? tx.enrollment.findMany({
          where: { lessonId: { in: ids }, swimmerId: { in: mySwimmerIds }, status: "ACTIVE" },
          select: { id: true, lessonId: true, swimmerId: true },
        })
      : [],
  ]);

  const countBy = new Map(counts.map((c) => [c.lessonId, c._count]));
  const remainingBy = new Map(remaining.map((c) => [c.lessonId, c._count]));

  return lessons.map((l) => {
    const enrolledCount = countBy.get(l.id) || 0;
    return {
      id: l.id,
      name: l.name,
      stage: l.stage,
      coach: l.coach,
      dayOfWeek: l.dayOfWeek,
      startTime: l.startTime,
      endTime: l.endTime,
      location: l.location,
      startDate: toISO(l.startDate),
      endDate: toISO(l.endDate),
      status: l.status,
      templateId: l.templateId,
      capacity: l.capacity,
      enrolledCount,
      spotsLeft: Math.max(l.capacity - enrolledCount, 0),
      isFull: enrolledCount >= l.capacity,
      remainingSessions: remainingBy.get(l.id) || 0,
      pricePerSessionCents: rates.get(l.stageId) ?? null,
      myEnrollments: mine
        .filter((e) => e.lessonId === l.id)
        .map((e) => ({ enrollmentId: e.id, swimmerId: e.swimmerId })),
    };
  });
}

module.exports = {
  defaultLessonName,
  validateSchedule,
  assertNoCoachConflict,
  createLessonWithSessions,
  decorateLessons,
  LESSON_INCLUDE,
};
