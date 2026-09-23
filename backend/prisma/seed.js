// Demo data for development and the class demo. Wipes and rebuilds everything.
// Run with: npm run db:seed   (or npm run db:reset to also re-run migrations)
//
// Every account's password is: Current123!

require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const { prisma } = require("../src/db");
const { toDate, todayISO, addDays, weekday, datesForWeekday } = require("../src/lib/dates");
const { rateForStage } = require("../src/lib/billing");

const PASSWORD = "Current123!";

// Stage names follow the common learn-to-swim progression.
const STAGES = [
  { id: 1, name: "Water Acclimation", color: "#fde047", description: "Comfort in the water, entering and exiting safely, blowing bubbles." },
  { id: 2, name: "Water Movement", color: "#86efac", description: "Floating, gliding and kicking with support. Beginning independent movement." },
  { id: 3, name: "Water Stamina", color: "#7dd3fc", description: "Swimming short distances unassisted, treading water, changing direction." },
  { id: 4, name: "Stroke Introduction", color: "#c4b5fd", description: "Front and back crawl basics, rhythmic breathing, longer distances." },
  { id: 5, name: "Stroke Development", color: "#f9a8d4", description: "Refining freestyle and backstroke, introducing breaststroke and butterfly." },
];

// Base rates from January, then a Stage 3 increase effective September 1 to
// show that invoices use the rate in effect on the enrollment date.
const PRICES = [
  [1, 4500, "2026-01-01"],
  [2, 5500, "2026-01-01"],
  [3, 6500, "2026-01-01"],
  [4, 7500, "2026-01-01"],
  [5, 9000, "2026-01-01"],
  [3, 7000, "2026-09-01"],
];

// Fall term runs from the Monday of this week through mid-December.
function termDates() {
  const today = todayISO();
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  return { start: monday, end: addDays(monday, 7 * 14 - 1) };
}

async function main() {
  console.log("Clearing existing data...");
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Payment","Invoice","Enrollment","LessonSession","Lesson","TemplateSlot","ScheduleTemplate",
     "StagePrice","ParentSwimmer","Swimmer","Stage","User" RESTART IDENTITY CASCADE`,
  );

  await prisma.stage.createMany({ data: STAGES });

  const hash = await bcrypt.hash(PASSWORD, 10);
  const mkUser = (email, name, role, phone) =>
    prisma.user.create({ data: { email, name, role, phone: phone || null, passwordHash: hash } });

  const admin = await mkUser("admin@current.test", "Alex Admin", "ADMIN", "718-555-0100");
  const mike = await mkUser("mike@current.test", "Mike Johnson", "COACH", "718-555-0111");
  const sarah = await mkUser("sarah@current.test", "Sarah Lee", "COACH", "718-555-0112");
  const david = await mkUser("david@current.test", "David Chen", "COACH", "718-555-0113");
  const jamie = await mkUser("parent@current.test", "Jamie Rivera", "PARENT", "718-555-0120");
  const pat = await mkUser("pat@current.test", "Pat Okafor", "PARENT", "718-555-0121");
  const sam = await mkUser("swimmer@current.test", "Sam Patel", "SWIMMER", "718-555-0130");

  for (const [stageId, priceCents, effectiveFrom] of PRICES) {
    await prisma.stagePrice.create({ data: { stageId, priceCents, effectiveFrom: toDate(effectiveFrom), createdById: admin.id } });
  }

  const kid = (firstName, lastName, dob, stageId, parentId) =>
    prisma.swimmer.create({
      data: { firstName, lastName, dateOfBirth: toDate(dob), stageId, parents: { create: { parentId } } },
    });
  const riley = await kid("Riley", "Rivera", "2019-04-12", 2, jamie.id);
  const casey = await kid("Casey", "Rivera", "2016-08-30", 4, jamie.id);
  const ava = await kid("Ava", "Okafor", "2020-01-22", 1, pat.id);
  const noah = await kid("Noah", "Okafor", "2017-11-05", 3, pat.id);
  const samProfile = await prisma.swimmer.create({
    data: { firstName: "Sam", lastName: "Patel", dateOfBirth: toDate("2011-06-14"), stageId: 5, userId: sam.id },
  });

  // Day numbers: 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat
  const slot = (name, stageId, coachId, dayOfWeek, startTime, endTime, capacity, location = "Main Pool") => ({
    name, stageId, coachId, dayOfWeek, startTime, endTime, capacity, location,
  });
  const template = await prisma.scheduleTemplate.create({
    data: {
      name: "Fall Weekly Program",
      description: "Standard weekday and Saturday lesson lineup.",
      slots: {
        create: [
          slot("Tiny Tots", 1, mike.id, 1, "15:30", "16:00", 6, "Teaching Pool"),
          slot("Floaters", 2, sarah.id, 1, "16:00", "16:45", 6, "Teaching Pool"),
          slot("Stroke Builders", 3, mike.id, 2, "16:00", "16:45", 5),
          slot("Stroke Refiners", 4, david.id, 2, "17:00", "17:45", 5),
          slot("Pre-Competitive", 5, david.id, 3, "17:00", "18:00", 8),
          slot("Floaters (Thu)", 2, mike.id, 4, "16:00", "16:45", 6, "Teaching Pool"),
          slot("Tiny Tots (Sat)", 1, sarah.id, 6, "09:00", "09:30", 6, "Teaching Pool"),
          slot("Floaters (Sat)", 2, mike.id, 6, "09:30", "10:15", 6, "Teaching Pool"),
          slot("Stroke Builders (Sat)", 3, sarah.id, 6, "10:15", "11:00", 5),
        ],
      },
    },
    include: { slots: true },
  });

  const term = termDates();
  const lessons = {};
  for (const s of template.slots) {
    const lesson = await prisma.lesson.create({
      data: {
        name: s.name, stageId: s.stageId, coachId: s.coachId, dayOfWeek: s.dayOfWeek,
        startTime: s.startTime, endTime: s.endTime, capacity: s.capacity, location: s.location,
        startDate: toDate(term.start), endDate: toDate(term.end), templateId: template.id,
      },
    });
    const dates = datesForWeekday(term.start, term.end, s.dayOfWeek);
    await prisma.lessonSession.createMany({ data: dates.map((d) => ({ lessonId: lesson.id, date: toDate(d) })) });
    lessons[s.name] = lesson;
  }

  // Enroll through the same billing rules the API uses.
  const today = todayISO();
  async function enroll(swimmer, lesson, billedToId) {
    const sessions = await prisma.lessonSession.count({
      where: { lessonId: lesson.id, cancelled: false, date: { gte: toDate(today) } },
    });
    const rate = await rateForStage(prisma, lesson.stageId, today);
    return prisma.enrollment.create({
      data: {
        lessonId: lesson.id,
        swimmerId: swimmer.id,
        enrolledById: billedToId,
        invoice: {
          create: {
            billedToId, stageId: lesson.stageId, sessionCount: sessions, ratePerSessionCents: rate,
            amountCents: sessions * rate, dueDate: toDate(addDays(today, 7)),
          },
        },
      },
      include: { invoice: true },
    });
  }

  const e1 = await enroll(riley, lessons["Floaters"], jamie.id);
  await enroll(casey, lessons["Stroke Refiners"], jamie.id);
  const e3 = await enroll(ava, lessons["Tiny Tots (Sat)"], pat.id);
  await enroll(noah, lessons["Stroke Builders"], pat.id);
  const e5 = await enroll(samProfile, lessons["Pre-Competitive"], sam.id);

  // Fill Stroke Builders (cap 5) so the demo shows a full class.
  const families = [
    ["Mia", "Chen", "Grace Chen"],
    ["Leo", "Garcia", "Maria Garcia"],
    ["Zoe", "Kim", "Daniel Kim"],
    ["Eli", "Brooks", "Tanya Brooks"],
  ];
  for (const [first, last, parentName] of families) {
    const parent = await mkUser(`${last.toLowerCase()}@current.test`, parentName, "PARENT");
    const child = await kid(first, last, "2016-03-01", 3, parent.id);
    await enroll(child, lessons["Stroke Builders"], parent.id);
  }

  // A few payments: one paid in full at the desk, one partial, one paid online.
  await prisma.payment.create({ data: { invoiceId: e1.invoice.id, method: "CASH", amountCents: e1.invoice.amountCents, recordedById: admin.id } });
  await prisma.invoice.update({ where: { id: e1.invoice.id }, data: { status: "PAID" } });
  await prisma.payment.create({ data: { invoiceId: e3.invoice.id, method: "CHECK", amountCents: 20000, reference: "Check #1042", recordedById: admin.id } });
  await prisma.payment.create({ data: { invoiceId: e5.invoice.id, method: "CARD", amountCents: e5.invoice.amountCents, reference: "sim_seed_4242", recordedById: sam.id } });
  await prisma.invoice.update({ where: { id: e5.invoice.id }, data: { status: "PAID" } });

  console.log(`Seeded ${Object.keys(lessons).length} lessons for ${term.start} to ${term.end}.`);
  console.log(`All demo accounts use the password ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
