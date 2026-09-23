const express = require("express");
const bcrypt = require("bcryptjs");
const { prisma } = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { badRequest, conflict, notFound, idParam } = require("../lib/http");
const { z, email, password, name } = require("../lib/schemas");
const { splitName } = require("./auth");

const router = express.Router();
const ROLES = ["ADMIN", "COACH", "PARENT", "SWIMMER"];

const USER_SELECT = { id: true, name: true, email: true, role: true, phone: true, active: true, createdAt: true };

// Coach list for schedule filters and pickers. Any signed-in user.
router.get("/coaches", authenticate, async (_req, res) => {
  const coaches = await prisma.user.findMany({
    where: { role: "COACH", active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  res.json(coaches);
});

router.get("/users", authenticate, requireRole("ADMIN"), async (req, res) => {
  const q = z
    .object({ role: z.enum(ROLES).optional(), search: z.string().trim().optional(), active: z.enum(["true", "false"]).optional() })
    .parse(req.query);
  const users = await prisma.user.findMany({
    where: {
      role: q.role,
      active: q.active ? q.active === "true" : undefined,
      OR: q.search
        ? [{ name: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }]
        : undefined,
    },
    select: USER_SELECT,
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  res.json(users);
});

router.post("/users", authenticate, requireRole("ADMIN"), async (req, res) => {
  const body = z
    .object({ name, email, password, role: z.enum(ROLES), phone: z.string().trim().max(30).optional().nullable() })
    .parse(req.body);
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw conflict("An account with that email already exists.", "EMAIL_TAKEN");
  }
  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: body.name, email: body.email, role: body.role, phone: body.phone || null, passwordHash },
      select: USER_SELECT,
    });
    if (body.role === "SWIMMER") {
      await tx.swimmer.create({ data: { ...splitName(body.name), userId: created.id } });
    }
    return created;
  });
  res.status(201).json(user);
});

// Accounts are deactivated rather than deleted so billing history stays intact.
router.patch("/users/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  const userId = idParam(req.params.id);
  const body = z
    .object({
      name: name.optional(),
      phone: z.string().trim().max(30).optional().nullable(),
      role: z.enum(ROLES).optional(),
      active: z.boolean().optional(),
      password: password.optional(),
    })
    .parse(req.body);

  const existing = await prisma.user.findUnique({ where: { id: userId }, include: { swimmerProfile: true } });
  if (!existing) throw notFound("User");
  if (userId === req.user.id && (body.role && body.role !== "ADMIN" || body.active === false)) {
    throw badRequest("You cannot remove your own admin access.", "SELF_LOCKOUT");
  }
  if (body.role && body.role !== existing.role && (existing.role === "SWIMMER" || body.role === "SWIMMER")) {
    throw badRequest("Swimmer accounts cannot be converted to or from other roles. Create a new account instead.");
  }
  if (body.role && existing.role === "COACH" && body.role !== "COACH") {
    const teaching = await prisma.lesson.count({ where: { coachId: userId, status: "ACTIVE" } });
    if (teaching) throw conflict(`Reassign this coach's ${teaching} active lesson(s) first.`, "COACH_HAS_LESSONS");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      name: body.name,
      phone: body.phone,
      role: body.role,
      active: body.active,
      passwordHash: body.password ? await bcrypt.hash(body.password, 10) : undefined,
    },
    select: USER_SELECT,
  });
  res.json(updated);
});

module.exports = router;
