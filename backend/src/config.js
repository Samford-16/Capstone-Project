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

// Stripe is optional. Without a key, families pay through the built-in simulated checkout.
// Only test-mode keys are accepted: this is a class project and must never take real money.
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
if (stripeSecretKey && !stripeSecretKey.startsWith("sk_test_")) {
  throw new Error("STRIPE_SECRET_KEY must be a test-mode key (starts with sk_test_). Live keys are not allowed.");
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
  stripeSecretKey,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  // Where Stripe sends families back after checkout (the React app).
  appUrl: (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, ""),
};
