// Calendar dates travel through the API as "YYYY-MM-DD" strings and are stored
// in @db.Date columns. Prisma returns those as JS Dates at UTC midnight, so all
// date math here is done in UTC to avoid off-by-one-day bugs.

const config = require("../config");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function todayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toDate(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function toISO(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function weekday(iso) {
  return toDate(iso).getUTCDay();
}

function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

/** Every date between start and end (inclusive) that falls on dayOfWeek. */
function datesForWeekday(startIso, endIso, dayOfWeek) {
  const out = [];
  let d = addDays(startIso, (dayOfWeek - weekday(startIso) + 7) % 7);
  while (d <= endIso) {
    out.push(d);
    d = addDays(d, 7);
  }
  return out;
}

/** Minutes the school's time zone is ahead of UTC at a given instant (New York: -240 or -300). */
function tzOffsetMinutes(instant) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant)) {
    parts[p.type] = p.value;
  }
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUTC - instant.getTime()) / 60000);
}

/**
 * The exact instant a calendar day starts at the school (midnight in New York),
 * for filtering timestamps such as Invoice.issuedAt and Payment.receivedAt.
 * toDate() gives UTC midnight, which is 8 PM the evening before in New York,
 * so it is only right for @db.Date columns. (Bug B7.)
 */
function startOfDay(iso) {
  const utcMidnight = toDate(iso).getTime();
  let instant = new Date(utcMidnight - tzOffsetMinutes(new Date(utcMidnight)) * 60000);
  // Re-check in case a daylight saving change falls between the two instants.
  const offset = tzOffsetMinutes(instant);
  instant = new Date(utcMidnight - offset * 60000);
  return instant;
}

/** { gte, lt } covering whole school days from..to, for timestamp columns. */
function dayRange(fromIso, toIso) {
  return {
    gte: fromIso ? startOfDay(fromIso) : undefined,
    lt: toIso ? startOfDay(addDays(toIso, 1)) : undefined,
  };
}

/** Monday of the week containing iso (the schedule grid starts on Monday). */
function mondayOf(iso) {
  return addDays(iso, -((weekday(iso) + 6) % 7));
}

function fmtTime12(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

module.exports = {
  ISO_DATE,
  TIME,
  DAY_NAMES,
  todayISO,
  toDate,
  toISO,
  weekday,
  addDays,
  datesForWeekday,
  startOfDay,
  dayRange,
  mondayOf,
  fmtTime12,
};
