// Stripe webhook: Stripe calls this when a checkout finishes, so a payment is
// recorded even if the family closes the tab before returning to Current.
// Needs the raw request body to verify Stripe's signature (see app.js).
//
// Local testing: install the Stripe CLI and run
//   stripe listen --forward-to localhost:3000/api/stripe/webhook
// then put the whsec_... secret it prints into STRIPE_WEBHOOK_SECRET.

const express = require("express");
const config = require("../config");
const { badRequest, conflict } = require("../lib/http");
const { getStripe, recordCheckoutSession } = require("../lib/stripe");

const router = express.Router();

router.post("/stripe/webhook", async (req, res) => {
  if (!config.stripeWebhookSecret) {
    throw conflict("STRIPE_WEBHOOK_SECRET is not set in backend/.env.", "STRIPE_NOT_CONFIGURED");
  }
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers["stripe-signature"], config.stripeWebhookSecret);
  } catch (e) {
    throw badRequest(`Webhook signature check failed: ${e.message}`, "BAD_SIGNATURE");
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object;
    if (session.payment_status === "paid" && session.metadata && session.metadata.invoiceId) {
      await recordCheckoutSession(session);
    }
  }
  res.json({ received: true });
});

module.exports = router;
