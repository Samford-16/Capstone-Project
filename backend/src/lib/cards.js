// Simulated card checkout. Card details are validated and then thrown away:
// only the last four digits are kept, as the payment reference. Swapping this
// for Stripe later means replacing chargeCard() and nothing else.

const { badRequest } = require("./http");

function luhn(num) {
  let sum = 0;
  let double = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function validateCard({ name, number, exp, cvc }, now = new Date()) {
  const digits = String(number || "").replace(/\s|-/g, "");
  if (!name || !String(name).trim()) throw badRequest("Cardholder name is required.", "CARD_INVALID");
  if (!/^\d{13,19}$/.test(digits)) throw badRequest("Card number must be 13 to 19 digits.", "CARD_INVALID");
  if (!luhn(digits)) throw badRequest("Card number is not valid.", "CARD_INVALID");
  const m = /^(\d{2})\/(\d{2})$/.exec(String(exp || ""));
  if (!m) throw badRequest("Expiry must be MM/YY.", "CARD_INVALID");
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) throw badRequest("Expiry month must be 01 to 12.", "CARD_INVALID");
  if (new Date(Date.UTC(year, month, 1)) <= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) {
    throw badRequest("This card has expired.", "CARD_INVALID");
  }
  if (!/^\d{3,4}$/.test(String(cvc || ""))) throw badRequest("CVC must be 3 or 4 digits.", "CARD_INVALID");
  return digits;
}

/** Pretend to charge the card. Returns a payment reference. */
function chargeCard(card) {
  const digits = validateCard(card);
  // 4000 0000 0000 0002 is the standard "card declined" test number.
  if (digits === "4000000000000002") throw badRequest("The card was declined.", "CARD_DECLINED");
  return `sim_${Date.now().toString(36)}_${digits.slice(-4)}`;
}

module.exports = { luhn, validateCard, chargeCard };
