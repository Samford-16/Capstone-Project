// Who can see or act on which swimmers. Every route that touches a swimmer,
// enrollment or invoice goes through these checks.

const { forbidden, notFound } = require("./http");

/** Swimmer ids the user may see, or null meaning "all". */
async function visibleSwimmerIds(tx, user) {
  if (user.role === "ADMIN") return null;
  if (user.role === "PARENT") {
    const links = await tx.parentSwimmer.findMany({ where: { parentId: user.id }, select: { swimmerId: true } });
    return links.map((l) => l.swimmerId);
  }
  if (user.role === "SWIMMER") {
    const s = await tx.swimmer.findUnique({ where: { userId: user.id }, select: { id: true } });
    return s ? [s.id] : [];
  }
  if (user.role === "COACH") {
    const rows = await tx.enrollment.findMany({
      where: { lesson: { coachId: user.id } },
      select: { swimmerId: true },
      distinct: ["swimmerId"],
    });
    return rows.map((r) => r.swimmerId);
  }
  return [];
}

/** Can this user enroll / cancel / edit this swimmer? (Coaches cannot.) */
async function assertCanManageSwimmer(tx, user, swimmerId) {
  const swimmer = await tx.swimmer.findUnique({
    where: { id: swimmerId },
    include: { parents: { select: { parentId: true } } },
  });
  if (!swimmer) throw notFound("Swimmer");
  if (user.role === "ADMIN") return swimmer;
  if (user.role === "PARENT" && swimmer.parents.some((p) => p.parentId === user.id)) return swimmer;
  if (user.role === "SWIMMER" && swimmer.userId === user.id) return swimmer;
  throw forbidden("You can only manage your own swimmers.");
}

/**
 * Who gets billed when a swimmer enrolls. A parent or swimmer enrolling is
 * billed themselves. When an admin enrolls someone, bill the swimmer's own
 * account if they have one, otherwise their first linked parent.
 */
function billingAccountFor(actor, swimmer) {
  if (actor.role === "PARENT" || actor.role === "SWIMMER") return actor.id;
  if (swimmer.userId) return swimmer.userId;
  if (swimmer.parents && swimmer.parents.length) return swimmer.parents[0].parentId;
  return actor.id;
}

module.exports = { visibleSwimmerIds, assertCanManageSwimmer, billingAccountFor };
