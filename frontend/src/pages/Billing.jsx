import { useState } from "react";
import Modal from "../components/Modal";
import PaymentModal from "../components/PaymentModal";
import { EmptyState, ErrorBanner, PageHeader, Spinner, StatTile, StatusPill } from "../components/ui";
import { useToast } from "../components/Toast";
import { useApi } from "../lib/useApi";
import { dateTime, money, shortDate, todayISO } from "../lib/format";

/** Family billing: invoices billed to me, pay online, view receipts. */
export default function Billing() {
  const toast = useToast();
  const invoices = useApi("/invoices");
  const [paying, setPaying] = useState(null);
  const [viewing, setViewing] = useState(null);
  const list = invoices.data || [];
  const open = list.filter((i) => i.status === "UNPAID");
  const today = todayISO();

  return (
    <>
      <PageHeader title="Billing" subtitle="Each enrollment creates one invoice: sessions remaining times the stage's price per session." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Balance due" value={money(open.reduce((s, i) => s + i.balanceCents, 0))} sub={`${open.length} unpaid invoice(s)`} />
        <StatTile label="Paid" value={money(list.reduce((s, i) => s + Math.max(i.paidCents, 0), 0))} />
        <StatTile label="Overdue" value={open.filter((i) => i.dueDate < today).length} />
      </div>
      <ErrorBanner error={invoices.error} />
      {invoices.loading && !invoices.data ? <Spinner /> : list.length === 0 ? (
        <EmptyState title="No invoices yet">Enrolling in a class creates an invoice.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>For</th>
                <th>Sessions</th>
                <th className="text-right">Amount</th>
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
                    <td className="font-mono text-xs">{inv.number}</td>
                    <td>
                      <div className="font-medium">{inv.enrollment?.swimmer?.name}</div>
                      <div className="text-xs text-muted">{inv.enrollment?.lesson?.name}</div>
                    </td>
                    <td className="text-sm tabular-nums">{inv.sessionCount} × {money(inv.ratePerSessionCents)}</td>
                    <td className="text-right tabular-nums">{money(inv.amountCents)}</td>
                    <td className="text-right font-semibold tabular-nums">{money(inv.balanceCents)}</td>
                    <td><StatusPill status={overdue ? "OVERDUE" : inv.status} label={overdue ? "overdue" : undefined} /></td>
                    <td className="text-sm whitespace-nowrap">{shortDate(inv.dueDate)}</td>
                    <td className="text-right whitespace-nowrap">
                      {inv.status === "UNPAID" && inv.balanceCents > 0 ? (
                        <button className="btn-primary btn-sm" onClick={() => setPaying(inv)}>Pay now</button>
                      ) : (
                        <button className="btn-ghost btn-sm" onClick={() => setViewing(inv)}>Details</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {paying && (
        <PaymentModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onPaid={(res) => {
            setPaying(null);
            toast(`Payment received. Reference ${res.payment.reference}.`);
            invoices.reload();
          }}
        />
      )}
      {viewing && <InvoiceDetail invoice={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

export function InvoiceDetail({ invoice: inv, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Invoice ${inv.number}`}>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted">Swimmer</dt><dd>{inv.enrollment?.swimmer?.name}</dd>
        <dt className="text-muted">Class</dt><dd>{inv.enrollment?.lesson?.name}</dd>
        {inv.billedTo && (<><dt className="text-muted">Billed to</dt><dd>{inv.billedTo.name}</dd></>)}
        <dt className="text-muted">Issued</dt><dd>{dateTime(inv.issuedAt)}</dd>
        <dt className="text-muted">Calculation</dt><dd>{inv.sessionCount} sessions × {money(inv.ratePerSessionCents)} = {money(inv.amountCents)}</dd>
        <dt className="text-muted">Status</dt><dd><StatusPill status={inv.status} /></dd>
        {inv.note && (<><dt className="text-muted">Note</dt><dd>{inv.note}</dd></>)}
      </dl>
      <h3 className="mt-5 mb-2 font-semibold">Payments</h3>
      {inv.payments.length === 0 ? <p className="text-sm text-muted">None.</p> : (
        <ul className="space-y-1.5 text-sm">
          {inv.payments.map((p) => (
            <li key={p.id} className="flex justify-between gap-3 rounded-lg border border-line px-3 py-2">
              <span>
                {p.kind === "REFUND" ? "Refund" : "Payment"} · {p.method.toLowerCase()}
                <span className="block text-xs text-muted">{dateTime(p.receivedAt)}{p.reference ? ` · ${p.reference}` : ""}</span>
              </span>
              <strong className={p.kind === "REFUND" ? "text-red-700" : ""}>{p.kind === "REFUND" ? "-" : ""}{money(p.amountCents)}</strong>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
