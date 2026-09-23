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
  fmtTime12,
};
