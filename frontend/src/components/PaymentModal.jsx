import { useState } from "react";
import Modal from "./Modal";
import { ErrorBanner, Field } from "./ui";
import { api } from "../lib/api";
import { money } from "../lib/format";

/**
 * Simulated card checkout (Current Pay). The server validates the card
 * (Luhn check, expiry) and keeps only the last four digits.
 */
export default function PaymentModal({ invoice, onClose, onPaid }) {
  const [card, setCard] = useState({ name: "", number: "", exp: "", cvc: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onNumber = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 16);
    setCard((c) => ({ ...c, number: digits.replace(/(.{4})/g, "$1 ").trim() }));
  };
  const onExp = (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 4);
    setCard((c) => ({ ...c, exp: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d }));
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/invoices/${invoice.id}/payments`, { card });
      onPaid(res);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Pay ${invoice.number}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" form="pay-form" disabled={busy}>{busy ? "Processing..." : `Pay ${money(invoice.balanceCents)}`}</button>
        </>
      }
    >
      <div className="mb-4 flex items-center justify-between rounded-lg bg-canvas px-4 py-3 text-sm">
        <span>{invoice.enrollment?.lesson?.name} · {invoice.enrollment?.swimmer?.name}</span>
        <strong>{money(invoice.balanceCents)}</strong>
      </div>
      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Demo checkout. No real payment is processed. Use test card 4242 4242 4242 4242 with any future expiry and CVC.
      </p>
      <form id="pay-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name on card"><input className="input" autoComplete="cc-name" value={card.name} onChange={(e) => setCard((c) => ({ ...c, name: e.target.value }))} required /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Card number"><input className="input tabular-nums" inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" value={card.number} onChange={onNumber} required /></Field>
        </div>
        <Field label="Expiry (MM/YY)"><input className="input" inputMode="numeric" autoComplete="cc-exp" placeholder="12/29" value={card.exp} onChange={onExp} required /></Field>
        <Field label="CVC"><input className="input" inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={card.cvc} onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value.replace(/\D/g, "") }))} required /></Field>
        <div className="sm:col-span-2"><ErrorBanner error={error} /></div>
      </form>
    </Modal>
  );
}
