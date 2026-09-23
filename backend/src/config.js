require("dotenv").config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  // "Today" for billing and schedules is computed in the school's time zone.
  timezone: process.env.TZ_SCHOOL || "America/New_York",
  // Days after issue an invoice is due when the class has already started.
  invoiceDueDays: Number(process.env.INVOICE_DUE_DAYS || 7),
};
