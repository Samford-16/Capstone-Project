const jwt = require("jsonwebtoken");
const config = require("../config");
const { prisma } = require("../db");
const { HttpError, forbidden } = require("../lib/http");

function createToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

// Verifies the Bearer token, then reloads the user so a deactivated account
// or a changed role takes effect immediately instead of when the token expires.
async function authenticate(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new HttpError(401, "Sign in required.", "UNAUTHENTICATED");

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, "Session expired. Please sign in again.", "UNAUTHENTICATED");
  }

  const user = await prisma.user.findUnique({
    where: { id: Number(payload.sub) },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user || !user.active) {
    throw new HttpError(401, "This account is no longer active.", "UNAUTHENTICATED");
  }

  req.user = user;
  next();
}

/** Allow only the listed roles, e.g. requireRole("ADMIN", "COACH"). */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

module.exports = { createToken, authenticate, requireRole };
