export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// The schedule grid starts the week on Monday.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function money(cents) {
  if (cents === null || cents === undefined) return "-";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function time12(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function timeRange(a, b) {
  return `${time12(a)} to ${time12(b)}`;
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** "2026-09-23" -> "Wed, Sep 23" (parsed at noon so time zones never shift the day). */
export function shortDate(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function longDate(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function dateTime(ts) {
  return ts ? new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday of the week containing iso. The schedule grid starts on Monday. */
export function mondayOf(iso) {
  const dow = new Date(`${iso}T12:00:00`).getDay();
  return addDays(iso, -((dow + 6) % 7));
}

/** "Oct 26 to Nov 1, 2026" for the week starting on a Monday. */
export function weekLabel(mondayIso) {
  const end = addDays(mondayIso, 6);
  const fmt = (iso, opts) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", opts);
  return `${fmt(mondayIso, { month: "short", day: "numeric" })} to ${fmt(end, { month: "short", day: "numeric", year: "numeric" })}`;
}

export function ageFrom(dobIso) {
  if (!dobIso) return null;
  const dob = new Date(`${dobIso}T12:00:00`);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  if (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate())) age--;
  return age;
}

export const ROLE_LABEL = { ADMIN: "Admin", COACH: "Coach", PARENT: "Parent", SWIMMER: "Swimmer" };
