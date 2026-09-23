const express = require("express");
const bcrypt = require("bcryptjs");
const { prisma } = require("../db");
const { createToken, authenticate } = require("../middleware/auth");
const { HttpError, conflict } = require("../lib/http");
const { toDate, toISO } = require("../lib/dates");
const { z, email, password, name, isoDate, stageId, swimmerInput } = require("../lib/schemas");

const router = express.Router();

// Public sign-up is only for families. Coaches and admins are created by an admin.
const registerSchema = z.discriminatedUnion("accountType", [
  z.object({
    accountType: z.literal("PARENT"),
    name,
    email,
    password,
    phone: z.string().trim().max(30).optional().nullable(),
    swimmers: z.array(swimmerInput).max(10).default([]),
  }),
  z.object({
    accountType: z.literal("SWIMMER"),
    name,
    email,
    password,
    phone: z.string().trim().max(30).optional().nullable(),
    dateOfBirth: isoDate.optional().nullable(),
    stageId: stageId.optional().nullable(),
  }),
]);

function splitName(full) {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || "-" };
}

async function profileFor(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      swimmerProfile: { select: { id: true, firstName: true, lastName: true, stageId: true, dateOfBirth: true } },
      children: {
        select: { swimmer: { select: { id: true, firstName: true, lastName: true, stageId: true, dateOfBirth: true } } },
      },
    },
  });
  const swimmers = user.role === "SWIMMER" && user.swimmerProfile
    ? [user.swimmerProfile]
    : user.children.map((c) => c.swimmer);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    swimmers: swimmers.map((s) => ({ ...s, dateOfBirth: toISO(s.dateOfBirth) })),
  };
}

router.post("/auth/register", async (req, res) => {
  const body = registerSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw conflict("An account with that email already exists.", "EMAIL_TAKEN");

  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: body.name, email: body.email, passwordHash, role: body.accountType, phone: body.phone || null },
    });
    if (body.accountType === "SWIMMER") {
      await tx.swimmer.create({
        data: {
          ...splitName(body.name),
          dateOfBirth: body.dateOfBirth ? toDate(body.dateOfBirth) : null,
          stageId: body.stageId || null,
          userId: created.id,
        },
      });
    } else {
      for (const s of body.swimmers) {
        await tx.swimmer.create({
          data: {
            firstName: s.firstName,
            lastName: s.lastName,
            dateOfBirth: s.dateOfBirth ? toDate(s.dateOfBirth) : null,
            stageId: s.stageId || null,
            parents: { create: { parentId: created.id } },
          },
        });
      }
    }
    return created;
  });

  res.status(201).json({ token: createToken(user), user: await profileFor(user.id) });
});

router.post("/auth/login", async (req, res) => {
  const body = z.object({ email, password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const ok = user && user.active && (await bcrypt.compare(body.password, user.passwordHash));
  if (!ok) throw new HttpError(401, "Invalid email or password.", "BAD_CREDENTIALS");
  res.json({ token: createToken(user), user: await profileFor(user.id) });
});

router.get("/auth/me", authenticate, async (req, res) => {
  res.json({ user: await profileFor(req.user.id) });
});

module.exports = router;
module.exports.splitName = splitName;
