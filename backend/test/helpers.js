// Test setup. Tests WIPE the database in TEST_DATABASE_URL and reseed it,
// so never point it at a database you care about.

const { execFileSync } = require("child_process");
const path = require("path");

require("dotenv").config({ quiet: true, path: path.join(__dirname, "..", ".env") });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL in backend/.env (a separate database; tests wipe it).");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

function reseed() {
  execFileSync(process.execPath, [path.join(__dirname, "..", "prisma", "seed.js")], {
    env: process.env,
    stdio: "ignore",
  });
}

const request = require("supertest");
const app = require("../src/app");
// Tests never call the real Stripe. stripe.test.js swaps in a fake client.
require("../src/lib/stripe").setStripeForTests(null);
const { prisma } = require("../src/db");
const { todayISO, addDays, weekday } = require("../src/lib/dates");

const PASSWORD = "Current123!";

async function login(email) {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

/** Tiny wrapper: api(token).get("/lessons") etc. */
function api(token) {
  const wrap = (method) => (url) => {
    const r = request(app)[method](`/api${url}`);
    return token ? r.set("Authorization", `Bearer ${token}`) : r;
  };
  return { get: wrap("get"), post: wrap("post"), patch: wrap("patch"), put: wrap("put"), delete: wrap("delete") };
}

/** A date range that starts today and covers `weeks` weeks. */
function upcomingRange(weeks = 4) {
  const start = todayISO();
  return { startDate: start, endDate: addDays(start, weeks * 7 - 1), todayDow: weekday(start) };
}

module.exports = { reseed, login, api, prisma, upcomingRange, todayISO, addDays };
