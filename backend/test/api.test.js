// End-to-end API tests against a real PostgreSQL database.
// Each block maps to a commitment in the backend proposal.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { reseed, login, api, prisma, upcomingRange, todayISO, addDays } = require("./helpers");

let admin, coachMike, parent, otherParent, swimmer;

before(async () => {
  reseed();
  [admin, coachMike, parent, otherParent, swimmer] = await Promise.all([
    login("admin@current.test"),
    login("mike@current.test"),
    login("parent@current.test"),
    login("pat@current.test"),
    login("swimmer@current.test"),
  ]);
});
after(() => prisma.$disconnect());

async function newLesson(overrides = {}) {
  const { startDate, endDate, todayDow } = upcomingRange(4);
  const res = await api(admin).post("/lessons").send({
    name: `Test ${Math.random().toString(36).slice(2, 7)}`,
    stageId: 2,
    coachId: null,
    dayOfWeek: todayDow,
    startTime: "12:00",
    endTime: "12:30",
    capacity: 3,
    startDate,
    endDate,
    ...overrides,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function newChild(token, firstName = "Kid") {
  const res = await api(token).post("/swimmers").send({ firstName, lastName: "Test", dateOfBirth: "2018-05-05" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

describe("Authentication", () => {
  it("rejects a wrong password", async () => {
    const res = await api().post("/auth/login").send({ email: "admin@current.test", password: "nope" });
    assert.equal(res.status, 401);
  });

  it("requires a token on protected routes", async () => {
    assert.equal((await api().get("/lessons")).status, 401);
    assert.equal((await api("garbage").get("/lessons")).status, 401);
  });

  it("lets a parent register with children", async () => {
    const res = await api().post("/auth/register").send({
      accountType: "PARENT",
      name: "New Parent",
      email: "newparent@current.test",
      password: "Password1!",
      swimmers: [{ firstName: "A", lastName: "Kid", dateOfBirth: "2018-01-01" }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.user.role, "PARENT");
    assert.equal(res.body.user.swimmers.length, 1);
    assert.ok(res.body.token);
  });

  it("does not allow signing up as an admin or coach", async () => {
    for (const accountType of ["ADMIN", "COACH"]) {
      const res = await api().post("/auth/register").send({ accountType, name: "X", email: `x-${accountType}@t.test`, password: "Password1!" });
      assert.equal(res.status, 400);
    }
  });

  it("blocks a deactivated account immediately, even with a valid token", async () => {
    const reg = await api().post("/auth/register").send({ accountType: "SWIMMER", name: "Temp Swimmer", email: "temp@current.test", password: "Password1!" });
    const users = await api(admin).get("/users?search=temp@current.test");
    await api(admin).patch(`/users/${users.body[0].id}`).send({ active: false });
    assert.equal((await api(reg.body.token).get("/auth/me")).status, 401);
  });
});

describe("Role-based access", () => {
  it("shows coaches only their own lessons", async () => {
    const res = await api(coachMike).get("/lessons");
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0);
    assert.ok(res.body.every((l) => l.coach && l.coach.name === "Mike Johnson"));
  });

  it("gives the roster to admins and the lesson's coach, not to parents", async () => {
    const lessons = (await api(admin).get("/lessons")).body;
    const mikes = lessons.find((l) => l.coach?.name === "Mike Johnson");
    const notMikes = lessons.find((l) => l.coach && l.coach.name !== "Mike Johnson");
    assert.ok(Array.isArray((await api(coachMike).get(`/lessons/${mikes.id}`)).body.roster));
    assert.equal((await api(coachMike).get(`/lessons/${notMikes.id}`)).status, 403);
    assert.equal((await api(parent).get(`/lessons/${mikes.id}`)).body.roster, undefined);
  });

  it("keeps coaches out of billing and admin tools", async () => {
    assert.equal((await api(coachMike).get("/invoices")).status, 403);
    assert.equal((await api(coachMike).get("/users")).status, 403);
    assert.equal((await api(coachMike).post("/lessons").send({})).status, 403);
    assert.equal((await api(parent).get("/reports/summary")).status, 403);
  });

  it("stops a parent from enrolling someone else's child", async () => {
    const lesson = await newLesson();
    const otherKid = await newChild(otherParent, "Other");
    const res = await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: otherKid.id });
    assert.equal(res.status, 403);
  });

  it("only shows families their own invoices", async () => {
    const mine = (await api(parent).get("/invoices")).body;
    const me = (await api(parent).get("/auth/me")).body.user;
    assert.ok(mine.length > 0);
    assert.ok(mine.every((i) => i.billedTo.id === me.id));
    const someoneElses = (await api(admin).get("/invoices")).body.find((i) => i.billedTo.id !== me.id);
    assert.equal((await api(parent).get(`/invoices/${someoneElses.id}`)).status, 403);
  });
});

describe("Enrollment caps", () => {
  it("never over-enrolls, even with many simultaneous requests", async () => {
    const lesson = await newLesson({ capacity: 3 });
    const kids = [];
    for (let i = 0; i < 8; i++) kids.push(await newChild(otherParent, `Racer${i}`));

    const results = await Promise.all(
      kids.map((k) => api(otherParent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: k.id })),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const full = results.filter((r) => r.status === 409 && r.body.code === "LESSON_FULL").length;
    assert.equal(ok, 3, "exactly capacity should succeed");
    assert.equal(full, 5, "the rest should be told the lesson is full");

    const active = await prisma.enrollment.count({ where: { lessonId: lesson.id, status: "ACTIVE" } });
    const invoices = await prisma.invoice.count({ where: { enrollment: { lessonId: lesson.id } } });
    assert.equal(active, 3);
    assert.equal(invoices, 3, "every enrollment has exactly one invoice");

    const detail = (await api(parent).get(`/lessons/${lesson.id}`)).body;
    assert.equal(detail.isFull, true);
    assert.equal(detail.spotsLeft, 0);
  });

  it("rejects enrolling the same swimmer twice", async () => {
    const lesson = await newLesson();
    const kid = await newChild(parent, "Twice");
    assert.equal((await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: kid.id })).status, 201);
    const again = await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: kid.id });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "ALREADY_ENROLLED");
  });

  it("frees the spot and voids the unpaid invoice when an enrollment is cancelled", async () => {
    const lesson = await newLesson({ capacity: 1 });
    const a = await newChild(parent, "First");
    const b = await newChild(parent, "Second");
    const first = await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: a.id });
    assert.equal((await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: b.id })).status, 409);

    const cancel = await api(parent).post(`/enrollments/${first.body.id}/cancel`);
    assert.equal(cancel.body.invoiceAction, "voided");
    const inv = await prisma.invoice.findUnique({ where: { id: first.body.invoice.id } });
    assert.equal(inv.status, "VOID");
    assert.equal((await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: b.id })).status, 201);
  });

  it("will not lower capacity below the number enrolled", async () => {
    const lesson = await newLesson({ capacity: 2 });
    const kid = await newChild(parent, "Cap");
    const kid2 = await newChild(parent, "Cap2");
    await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: kid.id });
    await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: kid2.id });
    const res = await api(admin).patch(`/lessons/${lesson.id}`).send({ capacity: 1 });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "CAPACITY_TOO_LOW");
  });
});

describe("Bookkeeping", () => {
  it("bills remaining sessions at the rate effective on the enrollment date", async () => {
    const lesson = await newLesson({ stageId: 4 });
    const kid = await newChild(parent, "Rate");
    const res = await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: kid.id });
    const inv = res.body.invoice;
    assert.equal(inv.sessionCount, 4);
    assert.equal(inv.ratePerSessionCents, 7500);
    assert.equal(inv.amountCents, 4 * 7500);
    assert.equal(inv.status, "UNPAID");
  });

  it("uses a new price only from its effective date, and never rewrites old invoices", async () => {
    const lesson = await newLesson({ stageId: 1, capacity: 5 });
    const early = await newChild(parent, "Early");
    const before = await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: early.id });
    assert.equal(before.body.invoice.ratePerSessionCents, 4500);

    // A future price does not apply yet.
    const tomorrow = addDays(todayISO(), 1);
    assert.equal((await api(admin).post("/pricing").send({ stageId: 1, priceCents: 9900, effectiveFrom: tomorrow })).status, 201);
    const mid = await newChild(parent, "Mid");
    const midRes = await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: mid.id });
    assert.equal(midRes.body.invoice.ratePerSessionCents, 4500);

    // A price effective today applies to new enrollments only.
    assert.equal((await api(admin).post("/pricing").send({ stageId: 1, priceCents: 5000, effectiveFrom: todayISO() })).status, 201);
    const late = await newChild(parent, "Late");
    const after = await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: late.id });
    assert.equal(after.body.invoice.ratePerSessionCents, 5000);

    const original = await prisma.invoice.findUnique({ where: { id: before.body.invoice.id } });
    assert.equal(original.ratePerSessionCents, 4500, "earlier invoice keeps its rate");
  });

  it("takes online card payments with validation", async () => {
    const lesson = await newLesson();
    const kid = await newChild(parent, "Payer");
    const inv = (await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: kid.id })).body.invoice;

    const card = { name: "Jamie Rivera", number: "4242 4242 4242 4241", exp: "12/30", cvc: "123" };
    const bad = await api(parent).post(`/invoices/${inv.id}/payments`).send({ card });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "CARD_INVALID");

    const declined = await api(parent).post(`/invoices/${inv.id}/payments`).send({ card: { ...card, number: "4000 0000 0000 0002" } });
    assert.equal(declined.body.code, "CARD_DECLINED");

    const good = await api(parent).post(`/invoices/${inv.id}/payments`).send({ card: { ...card, number: "4242 4242 4242 4242" } });
    assert.equal(good.status, 201, JSON.stringify(good.body));
    assert.equal(good.body.invoice.status, "PAID");
    assert.equal(good.body.invoice.balanceCents, 0);
    assert.match(good.body.payment.reference, /4242$/);
    assert.equal((await api(parent).post(`/invoices/${inv.id}/payments`).send({ card })).status, 409);
  });

  it("records partial desk payments, refunds, and blocks voiding paid invoices", async () => {
    const lesson = await newLesson();
    const kid = await newChild(parent, "Desk");
    const inv = (await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: kid.id })).body.invoice;

    const part = await api(admin).post(`/invoices/${inv.id}/payments`).send({ amountCents: 1000, method: "CASH" });
    assert.equal(part.body.invoice.status, "UNPAID");
    assert.equal(part.body.invoice.balanceCents, inv.amountCents - 1000);

    const over = await api(admin).post(`/invoices/${inv.id}/payments`).send({ amountCents: inv.amountCents, method: "CASH" });
    assert.equal(over.status, 400);

    assert.equal((await api(admin).post(`/invoices/${inv.id}/void`)).status, 409);

    const rest = await api(admin).post(`/invoices/${inv.id}/payments`).send({ amountCents: inv.amountCents - 1000, method: "CHECK", reference: "#55" });
    assert.equal(rest.body.invoice.status, "PAID");

    const refund = await api(admin).post(`/invoices/${inv.id}/refund`).send({ reason: "Moved away" });
    assert.equal(refund.body.status, "REFUNDED");
    assert.equal(refund.body.paidCents, 0);
    assert.equal((await api(parent).post(`/invoices/${inv.id}/refund`)).status, 403);
  });

  it("cancelling a lesson voids unpaid invoices and flags paid ones for refund", async () => {
    const lesson = await newLesson({ capacity: 5 });
    const a = await newChild(parent, "Unpaid");
    const b = await newChild(parent, "Paid");
    const invA = (await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: a.id })).body.invoice;
    const invB = (await api(parent).post("/enrollments").send({ lessonId: lesson.id, swimmerId: b.id })).body.invoice;
    await api(admin).post(`/invoices/${invB.id}/payments`).send({ amountCents: invB.amountCents, method: "CASH" });

    const res = await api(admin).post(`/lessons/${lesson.id}/cancel`);
    assert.deepEqual(res.body, { cancelledEnrollments: 2, voidedInvoices: 1, invoicesNeedingRefund: 1 });
    assert.equal((await prisma.invoice.findUnique({ where: { id: invA.id } })).status, "VOID");
    assert.equal((await prisma.invoice.findUnique({ where: { id: invB.id } })).status, "PAID");
    assert.equal((await api(admin).delete(`/lessons/${lesson.id}`)).status, 409, "history blocks hard delete");
  });

  it("summarizes finances by stage and by month, and the totals agree", async () => {
    const byStage = (await api(admin).get("/reports/summary?groupBy=stage")).body;
    const byMonth = (await api(admin).get("/reports/summary?groupBy=month")).body;
    assert.equal(byStage.rows.length, 5);
    for (const k of ["invoicedCents", "collectedCents", "refundedCents", "outstandingCents"]) {
      assert.equal(byStage.totals[k], byMonth.totals[k], `${k} should match across groupings`);
    }
    const dbInvoiced = await prisma.invoice.aggregate({ where: { status: { not: "VOID" } }, _sum: { amountCents: true } });
    assert.equal(byStage.totals.invoicedCents, dbInvoiced._sum.amountCents);
  });
});

describe("Scheduling", () => {
  it("applies a template to a date range, one session per matching weekday", async () => {
    const coaches = (await api(admin).get("/coaches")).body;
    const sarah = coaches.find((c) => c.name === "Sarah Lee");
    const tpl = await api(admin).post("/templates").send({
      name: "Winter test",
      slots: [
        { name: "Winter A", stageId: 1, coachId: sarah.id, dayOfWeek: 0, startTime: "08:00", endTime: "08:30", capacity: 4 },
        { name: "Winter B", stageId: 2, coachId: sarah.id, dayOfWeek: 0, startTime: "08:30", endTime: "09:15", capacity: 4 },
      ],
    });
    assert.equal(tpl.status, 201, JSON.stringify(tpl.body));
    const res = await api(admin).post(`/templates/${tpl.body.id}/apply`).send({ startDate: "2027-01-03", endDate: "2027-01-31" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.createdLessons, 2);
    const sessions = await prisma.lessonSession.count({ where: { lessonId: res.body.lessonIds[0] } });
    assert.equal(sessions, 5, "five Sundays in January 2027");
  });

  it("refuses to double-book a coach, and applies nothing if any slot clashes", async () => {
    const coaches = (await api(admin).get("/coaches")).body;
    const mike = coaches.find((c) => c.name === "Mike Johnson");
    const lessonsBefore = await prisma.lesson.count();
    // Seed has Mike teaching Monday 15:30-16:00.
    const tpl = await api(admin).post("/templates").send({
      name: "Clash",
      slots: [
        { stageId: 1, coachId: null, dayOfWeek: 5, startTime: "10:00", endTime: "10:30", capacity: 4 },
        { stageId: 1, coachId: mike.id, dayOfWeek: 1, startTime: "15:45", endTime: "16:15", capacity: 4 },
      ],
    });
    const { startDate, endDate } = upcomingRange(3);
    const res = await api(admin).post(`/templates/${tpl.body.id}/apply`).send({ startDate, endDate });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "COACH_CONFLICT");
    assert.equal(await prisma.lesson.count(), lessonsBefore, "all-or-nothing");
  });

  it("filters the schedule by stage, day, coach and availability", async () => {
    const stage3 = (await api(parent).get("/lessons?stageId=3")).body;
    assert.ok(stage3.length > 0 && stage3.every((l) => l.stage.id === 3));
    const saturday = (await api(parent).get("/lessons?dayOfWeek=6")).body;
    assert.ok(saturday.length > 0 && saturday.every((l) => l.dayOfWeek === 6));
    const open = (await api(parent).get("/lessons?availability=open")).body;
    assert.ok(open.every((l) => !l.isFull));
    const full = (await api(parent).get("/lessons?availability=full")).body;
    assert.ok(full.some((l) => l.name === "Stroke Builders"));
    const mine = (await api(parent).get("/lessons?enrolled=true")).body;
    assert.ok(mine.length > 0 && mine.every((l) => l.myEnrollments.length > 0));
  });

  it("returns dated sessions for the daily view", async () => {
    const today = todayISO();
    const res = await api(parent).get(`/sessions?from=${today}&to=${addDays(today, 6)}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.length >= 9, "every seeded lesson meets once a week");
    assert.ok(res.body.every((s) => s.date >= today && s.lesson && typeof s.lesson.spotsLeft === "number"));
  });

  it("only lets staff change a swimmer's stage", async () => {
    const me = (await api(parent).get("/auth/me")).body.user;
    const kidId = me.swimmers[0].id;
    assert.equal((await api(parent).patch(`/swimmers/${kidId}`).send({ stageId: 5 })).status, 403);
    assert.equal((await api(parent).patch(`/swimmers/${kidId}`).send({ firstName: "Renamed" })).status, 200);
    assert.equal((await api(admin).patch(`/swimmers/${kidId}`).send({ stageId: 3 })).body.stageId, 3);
  });
});
