const express = require("express");
const { prisma } = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { conflict } = require("../lib/http");
const { currentRates } = require("../lib/billing");
const { todayISO, toDate, toISO } = require("../lib/dates");
const { z, isoDate, stageId } = require("../lib/schemas");

const router = express.Router();

// Public: the sign-up form and schedule legend need stage names and colors.
router.get("/stages", async (_req, res) => {
  const [stages, rates] = await Promise.all([
    prisma.stage.findMany({ orderBy: { id: "asc" } }),
    currentRates(prisma, todayISO()),
  ]);
  res.json(stages.map((s) => ({ ...s, pricePerSessionCents: rates.get(s.id) ?? null })));
});

// Full price history per stage, newest first.
router.get("/pricing", authenticate, requireRole("ADMIN"), async (_req, res) => {
  const today = todayISO();
  const stages = await prisma.stage.findMany({
    orderBy: { id: "asc" },
    include: {
      prices: { orderBy: { effectiveFrom: "desc" }, include: { createdBy: { select: { name: true } } } },
    },
  });
  res.json(
    stages.map((s) => {
      const history = s.prices.map((p) => ({
        id: p.id,
        priceCents: p.priceCents,
        effectiveFrom: toISO(p.effectiveFrom),
        setBy: p.createdBy ? p.createdBy.name : null,
        createdAt: p.createdAt,
      }));
      const current = history.find((p) => p.effectiveFrom <= today) || null;
      const upcoming = history.filter((p) => p.effectiveFrom > today).reverse();
      return { id: s.id, name: s.name, color: s.color, current, upcoming, history };
    }),
  );
});

// Add a new rate. Existing invoices keep the rate they were issued at.
router.post("/pricing", authenticate, requireRole("ADMIN"), async (req, res) => {
  const body = z
    .object({ stageId, priceCents: z.coerce.number().int().min(0).max(100000), effectiveFrom: isoDate })
    .parse(req.body);
  const dup = await prisma.stagePrice.findUnique({
    where: { stageId_effectiveFrom: { stageId: body.stageId, effectiveFrom: toDate(body.effectiveFrom) } },
  });
  if (dup) throw conflict(`Stage ${body.stageId} already has a price starting ${body.effectiveFrom}.`, "DUPLICATE");
  const price = await prisma.stagePrice.create({
    data: {
      stageId: body.stageId,
      priceCents: body.priceCents,
      effectiveFrom: toDate(body.effectiveFrom),
      createdById: req.user.id,
    },
  });
  res.status(201).json({ ...price, effectiveFrom: toISO(price.effectiveFrom) });
});

module.exports = router;
