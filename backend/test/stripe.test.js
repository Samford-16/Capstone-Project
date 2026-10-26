// Stripe Checkout tests. Stripe's servers are replaced by a small fake that
// behaves like the parts of the Stripe API we use, so these run offline and
// never touch a real Stripe account.

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { reseed, login, api, prisma, upcomingRange } = require("./helpers");
const app = require("../src/app");
const { setStripeForTests } = require("../src/lib/stripe");

// ---- fake Stripe ----
const sessions = new Map();
const refunds = [];
let counter = 0;
const fakeStripe = {
  checkout: {
    sessions: {
      create: async (params) => {
        const id = `cs_test_${++counter}`;
        const session = {
          id,
          url: `https://checkout.stripe.test/${id}`,
          amount_total: params.line_items[0].price_data.unit_amount,
          metadata: params.metadata,
          payment_status: "unpaid",
          payment_intent: null,
          _params: params,
        };
        sessions.set(id, session);
        return session;
      },
      retrieve: async (id) => {
        const s = sessions.get(id);
        if (!s) throw new Error(`No such checkout.session: '${id}'`);
        return s;
      },
    },
  },
  refunds: {
    create: async (params) => {
      refunds.push(params);
      return { id: `re_test_${++counter}` };
    },
  },
  webhooks: {
    constructEvent: (body, signature) => {
      if (signature !== "valid-signature") throw new Error("No signatures found matching the expected signature");
      return JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : body);
    },
  },
};
/** Simulate the family finishing payment on Stripe's page. */
function completePayment(sessionId) {
  const s = sessions.get(sessionId);
  s.payment_status = "paid";
  s.payment_intent = `pi_test_${sessionId}`;
  return s;
}

let admin, parent, otherParent;

before(async () => {
  reseed();
  [admin, parent, otherParent] = await Promise.all([
    login("admin@current.test"),
    login("parent@current.test"),
    login("pat@current.test"),
  ]);
});
after(() => {
  setStripeForTests(null);
  return prisma.$disconnect();
});

/** A fresh unpaid invoice billed to Jamie (parent@current.test). */
async function newInvoice() {
  const { startDate, endDate, todayDow } = upcomingRange(4);
  const lesson = await api(admin).post("/lessons").send({
    stageId: 2, dayOfWeek: todayDow, startTime: "13:00", endTime: "13:30", capacity: 5, startDate, endDate,
  });
  const kid = await api(parent).post("/swimmers").send({ firstName: "Stripe", lastName: `Kid${++counter}` });
  const res = await api(parent).post("/enrollments").send({ lessonId: lesson.body.id, swimmerId: kid.body.id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.invoice;
}

describe("Stripe Checkout", () => {
  it("reports that Stripe isn't set up when there's no key", async () => {
    setStripeForTests(null);
    const inv = await newInvoice();
    const res = await api(parent).post(`/invoices/${inv.id}/checkout`);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "STRIPE_NOT_CONFIGURED");
    setStripeForTests(fakeStripe);
  });

  it("creates a checkout for the invoice balance and returns Stripe's URL", async () => {
    setStripeForTests(fakeStripe);
    const inv = await newInvoice();
    const res = await api(parent).post(`/invoices/${inv.id}/checkout`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.url, /^https:\/\/checkout\.stripe\.test\//);
    const params = sessions.get(res.body.sessionId)._params;
    assert.equal(params.mode, "payment");
    assert.equal(params.line_items[0].price_data.unit_amount, inv.amountCents);
    assert.equal(params.line_items[0].price_data.currency, "usd");
    assert.equal(params.metadata.invoiceId, String(inv.id));
    assert.match(params.success_url, new RegExp(`invoice=${inv.id}&session_id=\\{CHECKOUT_SESSION_ID\\}`));
  });

  it("only lets the invoice's own family start a checkout", async () => {
    const inv = await newInvoice();
    assert.equal((await api(otherParent).post(`/invoices/${inv.id}/checkout`)).status, 403);
    assert.equal((await api(admin).post(`/invoices/${inv.id}/checkout`)).status, 403);
  });

  it("records the payment once after Stripe confirms it, even if confirmed twice", async () => {
    const inv = await newInvoice();
    const { sessionId } = (await api(parent).post(`/invoices/${inv.id}/checkout`)).body;

    const early = await api(parent).post(`/invoices/${inv.id}/checkout/confirm`).send({ sessionId });
    assert.equal(early.status, 409);
    assert.equal(early.body.code, "NOT_PAID");

    completePayment(sessionId);
    const first = await api(parent).post(`/invoices/${inv.id}/checkout/confirm`).send({ sessionId });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.duplicate, false);
    assert.equal(first.body.invoice.status, "PAID");
    assert.equal(first.body.invoice.balanceCents, 0);
    assert.equal(first.body.payment.reference, `pi_test_${sessionId}`);

    const again = await api(parent).post(`/invoices/${inv.id}/checkout/confirm`).send({ sessionId });
    assert.equal(again.body.duplicate, true);
    assert.equal(await prisma.payment.count({ where: { invoiceId: inv.id } }), 1, "no double payment");

    assert.equal((await api(parent).post(`/invoices/${inv.id}/checkout`)).body.code, "ALREADY_PAID");
  });

  it("rejects a checkout session that belongs to a different invoice", async () => {
    const a = await newInvoice();
    const b = await newInvoice();
    const { sessionId } = (await api(parent).post(`/invoices/${a.id}/checkout`)).body;
    completePayment(sessionId);
    const res = await api(parent).post(`/invoices/${b.id}/checkout/confirm`).send({ sessionId });
    assert.equal(res.status, 400);
  });

  it("turns off the simulated card form while Stripe is on", async () => {
    const inv = await newInvoice();
    const res = await api(parent)
      .post(`/invoices/${inv.id}/payments`)
      .send({ card: { name: "J", number: "4242424242424242", exp: "12/30", cvc: "123" } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "USE_CHECKOUT");
  });

  it("records payments sent by the Stripe webhook, and rejects bad signatures", async () => {
    const inv = await newInvoice();
    const { sessionId } = (await api(parent).post(`/invoices/${inv.id}/checkout`)).body;
    const session = completePayment(sessionId);
    const event = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });

    const bad = await request(app).post("/api/stripe/webhook").set("Content-Type", "application/json").set("stripe-signature", "forged").send(event);
    assert.equal(bad.status, 400);
    assert.equal(await prisma.payment.count({ where: { invoiceId: inv.id } }), 0);

    const good = await request(app).post("/api/stripe/webhook").set("Content-Type", "application/json").set("stripe-signature", "valid-signature").send(event);
    assert.equal(good.status, 200, JSON.stringify(good.body));
    assert.equal((await prisma.invoice.findUnique({ where: { id: inv.id } })).status, "PAID");

    // The family returning to the page afterwards must not record it again.
    const confirm = await api(parent).post(`/invoices/${inv.id}/checkout/confirm`).send({ sessionId });
    assert.equal(confirm.body.duplicate, true);
    assert.equal(await prisma.payment.count({ where: { invoiceId: inv.id } }), 1);
  });

  it("sends refunds of Stripe payments back through Stripe", async () => {
    const inv = await newInvoice();
    const { sessionId } = (await api(parent).post(`/invoices/${inv.id}/checkout`)).body;
    completePayment(sessionId);
    await api(parent).post(`/invoices/${inv.id}/checkout/confirm`).send({ sessionId });

    const before = refunds.length;
    const res = await api(admin).post(`/invoices/${inv.id}/refund`).send({ reason: "Moved away", cancelEnrollment: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "REFUNDED");
    assert.equal(refunds.length, before + 1);
    assert.deepEqual(
      { payment_intent: refunds.at(-1).payment_intent, amount: refunds.at(-1).amount },
      { payment_intent: `pi_test_${sessionId}`, amount: inv.amountCents },
    );
    const refund = res.body.payments.find((p) => p.kind === "REFUND");
    assert.match(refund.reference, /^re_test_\d+ · Moved away$/);
  });
});
