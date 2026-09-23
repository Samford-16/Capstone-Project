const express = require("express");
const { prisma } = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { forbidden, notFound, badRequest, idParam } = require("../lib/http");
const { visibleSwimmerIds, assertCanManageSwimmer } = require("../lib/access");
const { toDate, toISO } = require("../lib/dates");
const { z, swimmerInput, id, name, isoDate, stageId } = require("../lib/schemas");

const router = express.Router();

function serialize(s) {
  return {
    id: s.id,
    firstName: s.firstName,
    lastName: s.lastName,
    name: `${s.firstName} ${s.lastName}`,
    dateOfBirth: toISO(s.dateOfBirth),
    stageId: s.stageId,
    hasOwnAccount: Boolean(s.userId),
    parents: (s.parents || []).map((p) => ({ id: p.parent.id, name: p.parent.name, email: p.parent.email, phone: p.parent.phone })),
    activeEnrollments: (s.enrollments || []).map((e) => ({ id: e.id, lessonId: e.lessonId, lessonName: e.lesson.name })),
  };
}

const INCLUDE = {
  parents: { include: { parent: { select: { id: true, name: true, email: true, phone: true } } } },
  enrollments: { where: { status: "ACTIVE" }, include: { lesson: { select: { name: true } } } },
};

router.get("/swimmers", authenticate, async (req, res) => {
  const ids = await visibleSwimmerIds(prisma, req.user);
  const swimmers = await prisma.swimmer.findMany({
    where: ids === null ? {} : { id: { in: ids } },
    include: INCLUDE,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  res.json(swimmers.map(serialize));
});

// Parents add their own children. Admins can add a swimmer to any parent.
router.post("/swimmers", authenticate, requireRole("ADMIN", "PARENT"), async (req, res) => {
  const body = swimmerInput.extend({ parentId: id.optional() }).parse(req.body);
  let parentId = req.user.id;
  if (req.user.role === "ADMIN") {
    if (!body.parentId) throw badRequest("parentId is required when an admin adds a swimmer.");
    const parent = await prisma.user.findUnique({ where: { id: body.parentId } });
    if (!parent || parent.role !== "PARENT") throw badRequest("parentId must be a parent account.");
    parentId = parent.id;
  }
  const swimmer = await prisma.swimmer.create({
    data: {
      firstName: body.firstName,
      lastName: body.lastName,
      dateOfBirth: body.dateOfBirth ? toDate(body.dateOfBirth) : null,
      stageId: body.stageId || null,
      parents: { create: { parentId } },
    },
    include: INCLUDE,
  });
  res.status(201).json(serialize(swimmer));
});

// Families edit names and birthdays. Only staff move a swimmer to a new stage,
// because stage placement is an instructor's assessment.
router.patch("/swimmers/:id", authenticate, async (req, res) => {
  const swimmerId = idParam(req.params.id);
  const body = z
    .object({
      firstName: name.optional(),
      lastName: name.optional(),
      dateOfBirth: isoDate.optional().nullable(),
      stageId: stageId.optional().nullable(),
    })
    .parse(req.body);

  if (req.user.role === "COACH") {
    const ids = await visibleSwimmerIds(prisma, req.user);
    if (!ids.includes(swimmerId)) throw forbidden("You can only assess swimmers in your lessons.");
    if (Object.keys(body).some((k) => k !== "stageId")) throw forbidden("Coaches can only change a swimmer's stage.");
  } else {
    await assertCanManageSwimmer(prisma, req.user, swimmerId);
    if (req.user.role !== "ADMIN" && body.stageId !== undefined) {
      throw forbidden("Only staff can change a swimmer's stage.");
    }
  }

  const swimmer = await prisma.swimmer.update({
    where: { id: swimmerId },
    data: {
      firstName: body.firstName,
      lastName: body.lastName,
      dateOfBirth: body.dateOfBirth === undefined ? undefined : body.dateOfBirth ? toDate(body.dateOfBirth) : null,
      stageId: body.stageId,
    },
    include: INCLUDE,
  }).catch((e) => {
    if (e.code === "P2025") throw notFound("Swimmer");
    throw e;
  });
  res.json(serialize(swimmer));
});

module.exports = router;
