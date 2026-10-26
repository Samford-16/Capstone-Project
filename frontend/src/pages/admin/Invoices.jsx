import { useState } from "react";
import Modal from "../../components/Modal";
import { EmptyState, ErrorBanner, Field, PageHeader, Spinner, StatusPill } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { InvoiceDetail } from "../Billing";
import { api, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { money, shortDate, todayISO } from "../../lib/format";

/** Admin bookkeeping: every invoice, record desk payments, refund, void. */
export default function Invoices() {
  const toast = useToast();
  const [filters, setFilters] = useState({ status: "", stageId: "" });
  const [search, setSearch] = useState("");
  const [needsRefund, setNeedsRefund] = useState(false);
  const invoices = useApi(`/invoices${qs(filters)}`);
  const [recording, setRecording] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [refunding, setRefunding] = useState(null);
  const today = todayISO();

  const list = (invoices.data || []).filter((i) => {
    if (needsRefund && !needsRefundReview(i)) return false;
    if (!search) return true;
    const hay = `${i.number} ${i.billedTo?.name} ${i.enrollment?.swimmer?.name} ${i.enrollment?.lesson?.name}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  async function act(fn, msg) {
    try {
      await fn();
      toast(msg);
      invoices.reload();
    } catch (err) {
      toast(err.message, "error");
    }
  }
  const voidInv = (inv) => {
    const reason = prompt(`Void ${inv.number}? Reason (optional):`);
    if (reason === null) return;
    act(() => api.post(`/invoices/${inv.id}/void`, { reason: reason || undefined }), `${inv.number} voided.`);
  };

  return (
    <>
      <PageHeader title="Invoices" subtitle="Every invoice in the system. Record payments taken at the desk, refund, or void." />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label>
          <span className="label">Status</span>
          <select className="input" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PAID">Paid</option>
            <option value="REFUNDED">Refunded</option>
            <option value="VOID">Void</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={needsRefund} onChange={(e) => setNeedsRefund(e.target.checked)} />
          Needs refund review only
        </label>
        <label>
          <span className="label">Stage</span>
          <select className="input" value={filters.stageId} onChange={(e) => setFilters((f) => ({ ...f, stageId: e.target.value }))}>
            <option value="">All</option>
            {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>Stage {s}</option>)}
          </select>
        </label>
        <label className="min-w-[200px] flex-1">
          <span className="label">Search</span>
          <input className="input" placeholder="Invoice #, family, swimmer, class" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      <ErrorBanner error={invoices.error} />
      {invoices.loading && !invoices.data ? <Spinner /> : list.length === 0 ? <EmptyState title="No invoices match" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Billed to</th>
                <th>For</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th>Due</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((inv) => {
                const overdue = inv.status === "UNPAID" && inv.dueDate < today;
                return (
                  <tr key={inv.id}>
                    <td><button className="font-mono text-xs text-primary underline" onClick={() => setViewing(inv)}>{inv.number}</button></td>
                    <td className="text-sm">{inv.billedTo?.name}</td>
                    <td className="text-sm">
                      {inv.enrollment?.swimmer?.name}
                      <div className="text-xs text-muted">{inv.enrollment?.lesson?.name}</div>
                    </td>
                    <td className="text-right tabular-nums">{money(inv.amountCents)}</td>
                    <td className="text-right tabular-nums">{money(inv.paidCents)}</td>
                    <td className="text-right font-semibold tabular-nums">{money(inv.balanceCents)}</td>
                    <td>
                      <StatusPill status={overdue ? "OVERDUE" : inv.status} label={overdue ? "overdue" : undefined} />
                      {needsRefundReview(inv) && (
                        <div className="mt-1"><StatusPill status="OVERDUE" label="needs refund review" /></div>
                      )}
                    </td>
                    <td className="text-sm whitespace-nowrap">{shortDate(inv.dueDate)}</td>
                    <td className="text-right whitespace-nowrap">
                      {inv.status === "UNPAID" && <button className="btn-primary btn-sm" onClick={() => setRecording(inv)}>Record payment</button>}
                      {inv.paidCents > 0 && inv.status !== "REFUNDED" && <button className="btn-ghost btn-sm" onClick={() => setRefunding(inv)}>Refund</button>}
                      {inv.status === "UNPAID" && inv.payments.length === 0 && <button className="btn-ghost btn-sm text-red-700" onClick={() => voidInv(inv)}>Void</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {recording && (
        <RecordPayment
          invoice={recording}
          onClose={() => setRecording(null)}
          onDone={() => {
            setRecording(null);
            toast("Payment recorded.");
            invoices.reload();
          }}
        />
      )}
      {viewing && <InvoiceDetail invoice={viewing} onClose={() => setViewing(null)} />}
      {refunding && (
        <RefundModal
          invoice={refunding}
          onClose={() => setRefunding(null)}
          onDone={(updated, cancelled) => {
            setRefunding(null);
            toast(`${updated.number}: refunded ${money(refunding.paidCents - updated.paidCents)}${cancelled ? ` and ${refunding.enrollment?.swimmer?.name || "the swimmer"}'s enrollment was cancelled` : ""}.`);
            invoices.reload();
          }}
        />
      )}
    </>
  );
}

/** Paid money on a cancelled enrollment that has not been refunded yet. */
function needsRefundReview(inv) {
  return inv.enrollment?.status === "CANCELLED" && inv.paidCents > 0 && inv.status !== "REFUNDED";
}

/**
 * Refund any amount up to what was paid. A partial refund is for keeping
 * payment for sessions already attended. Refunds are only for cancelled
 * enrollments (G5): refunding a swimmer who is still enrolled also cancels
 * the enrollment and frees the seat, and the admin has to confirm that.
 */
function RefundModal({ invoice, onClose, onDone }) {
  const [amount, setAmount] = useState((invoice.paidCents / 100).toFixed(2));
  const [method, setMethod] = useState("CASH");
  const [reason, setReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const active = invoice.enrollment?.status === "ACTIVE";
  const paidByStripe = invoice.payments.some((p) => p.kind === "PAYMENT" && p.reference?.startsWith("pi_"));
  const cents = Math.round(Number(amount) * 100) || 0;
  const kept = invoice.paidCents - cents;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.post(`/invoices/${invoice.id}/refund`, {
        amountCents: cents,
        method: paidByStripe ? undefined : method,
        reason: reason || undefined,
        cancelEnrollment: active ? confirmCancel : undefined,
      });
      onDone(updated, active);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Refund ${invoice.number}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="refund-form" disabled={saving || (active && !confirmCancel)}>{saving ? "Refunding..." : `Refund ${money(cents)}`}</button></>}
    >
      <form id="refund-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <p className="text-sm text-muted sm:col-span-2">
          {invoice.enrollment?.swimmer?.name}, {invoice.enrollment?.lesson?.name}. Paid: {money(invoice.paidCents)}.
          {" "}Refund all of it, or part of it to keep payment for sessions already attended.
        </p>
        <Field label="Refund amount ($)">
          <input className="input" type="number" step="0.01" min="0.01" max={invoice.paidCents / 100} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        {paidByStripe ? (
          <p className="self-end pb-2 text-xs text-muted">Paid online, so the refund goes back to the same card through Stripe.</p>
        ) : (
          <Field label="Refunded by">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Cash</option>
              <option value="CHECK">Check</option>
              <option value="CARD">Card (at desk)</option>
            </select>
          </Field>
        )}
        <div className="sm:col-span-2"><Field label="Reason (optional)"><input className="input" placeholder="Moved away, attended 2 classes" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        {kept > 0 && cents > 0 && (
          <p className="text-sm sm:col-span-2">The school keeps {money(kept)}. The invoice will be marked refunded with nothing owed.</p>
        )}
        {active && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5" checked={confirmCancel} onChange={(e) => setConfirmCancel(e.target.checked)} />
            <span>{invoice.enrollment?.swimmer?.name || "This swimmer"} is still enrolled. Refunding also cancels the enrollment and frees the seat.</span>
          </label>
        )}
        <div className="sm:col-span-2"><ErrorBanner error={error} /></div>
      </form>
    </Modal>
  );
}

function RecordPayment({ invoice, onClose, onDone }) {
  const [amount, setAmount] = useState((invoice.balanceCents / 100).toFixed(2));
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    try {
      await api.post(`/invoices/${invoice.id}/payments`, { amountCents: Math.round(Number(amount) * 100), method, reference: reference || null });
      onDone();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Record payment on ${invoice.number}`} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="rec-form">Record</button></>}>
      <form id="rec-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <p className="text-sm text-muted sm:col-span-2">Balance: {money(invoice.balanceCents)}. Partial payments are fine.</p>
        <Field label="Amount ($)"><input className="input" type="number" step="0.01" min="0.01" max={invoice.balanceCents / 100} value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
        <Field label="Method">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="CHECK">Check</option>
            <option value="CARD">Card (at desk)</option>
          </select>
        </Field>
        <div className="sm:col-span-2"><Field label="Reference"><input className="input" placeholder="Check #, receipt #" value={reference} onChange={(e) => setReference(e.target.value)} /></Field></div>
        <div className="sm:col-span-2"><ErrorBanner error={error} /></div>
      </form>
    </Modal>
  );
}
