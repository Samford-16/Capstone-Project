// Schedule templates: a reusable weekly pattern of lesson slots that an admin
// applies to a date range (for example "Fall Weekdays" applied to a term).

const express = require("express");
const { prisma } = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { badRequest, notFound, idParam } = require("../lib/http");
const { validateSchedule, assertNoCoachConflict, createLessonWithSessions } = require("../lib/lessons");
const { z, isoDate, lessonFields } = require("../lib/schemas");

const router = express.Router();
router.use("/templates", authenticate, requireRole("ADMIN"));

const slotSchema = z.object(lessonFields);
const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  slots: z.array(slotSchema).min(1, "add at least one slot").max(100),
});

const INCLUDE = {
  slots: {
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    include: { stage: { select: { id: true, name: true, color: true } }, coach: { select: { id: true, name: true } } },
  },
  _count: { select: { lessons: true } },
};

function serialize(t) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    timesApplied: t._count ? t._count.lessons : undefined,
    slots: t.slots.map((s) => ({
      id: s.id,
      name: s.name,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      location: s.location,
      stageId: s.stageId,
      stage: s.stage,
      coachId: s.coachId,
      coach: s.coach,
    })),
  };
}

function checkSlots(slots) {
  slots.forEach((s, i) => {
    if (s.startTime >= s.endTime) throw badRequest(`Slot ${i + 1}: end time must be after start time.`);
  });
}

function slotData(s) {
  return {
    name: s.name || null,
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
    capacity: s.capacity,
    location: s.location || null,
    stageId: s.stageId,
    coachId: s.coachId || null,
  };
}

router.get("/templates", async (_req, res) => {
  const templates = await prisma.scheduleTemplate.findMany({ include: INCLUDE, orderBy: { name: "asc" } });
  res.json(templates.map(serialize));
});

router.get("/templates/:id", async (req, res) => {
  const t = await prisma.scheduleTemplate.findUnique({ where: { id: idParam(req.params.id) }, include: INCLUDE });
  if (!t) throw notFound("Template");
  res.json(serialize(t));
});

router.post("/templates", async (req, res) => {
  const body = templateSchema.parse(req.body);
  checkSlots(body.slots);
  const t = await prisma.scheduleTemplate.create({
    data: { name: body.name, description: body.description || null, slots: { create: body.slots.map(slotData) } },
    include: INCLUDE,
  });
  res.status(201).json(serialize(t));
});

// Editing a template never changes lessons already created from it.
router.put("/templates/:id", async (req, res) => {
  const templateId = idParam(req.params.id);
  const body = templateSchema.parse(req.body);
  checkSlots(body.slots);
  const t = await prisma.$transaction(async (tx) => {
    const existing = await tx.scheduleTemplate.findUnique({ where: { id: templateId } });
    if (!existing) throw notFound("Template");
    await tx.templateSlot.deleteMany({ where: { templateId } });
    return tx.scheduleTemplate.update({
      where: { id: templateId },
      data: { name: body.name, description: body.description || null, slots: { create: body.slots.map(slotData) } },
      include: INCLUDE,
    });
  });
  res.json(serialize(t));
});

router.delete("/templates/:id", async (req, res) => {
  await prisma.scheduleTemplate.delete({ where: { id: idParam(req.params.id) } });
  res.status(204).end();
});

/**
 * Apply a template to a date range. Creates one lesson per slot with a
 * session on every matching weekday. All-or-nothing: if any slot has a coach
 * conflict or no class days in range, nothing is created.
 */
router.post("/templates/:id/apply", async (req, res) => {
  const templateId = idParam(req.params.id);
  const body = z.object({ startDate: isoDate, endDate: isoDate }).parse(req.body);
  if (body.startDate > body.endDate) throw badRequest("End date must be on or after start date.");

  const template = await prisma.scheduleTemplate.findUnique({ where: { id: templateId }, include: { slots: true } });
  if (!template) throw notFound("Template");

  const created = await prisma.$transaction(
    async (tx) => {
      const lessons = [];
      for (const slot of template.slots) {
        const data = { ...slotData(slot), templateId, startDate: body.startDate, endDate: body.endDate };
        validateSchedule(data);
        await assertNoCoachConflict(tx, data);
        lessons.push(await createLessonWithSessions(tx, data));
      }
      return lessons;
    },
    { timeout: 20000 },
  );
  res.status(201).json({ createdLessons: created.length, lessonIds: created.map((l) => l.id) });
});

module.exports = router;
