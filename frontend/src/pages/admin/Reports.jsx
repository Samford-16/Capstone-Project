import { useState } from "react";
import { ErrorBanner, PageHeader, Spinner, StatTile } from "../../components/ui";
import { qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { money, todayISO } from "../../lib/format";

const COLUMNS = [
  ["invoiceCount", "Invoices", (v) => v],
  ["invoicedCents", "Invoiced", money],
  ["collectedCents", "Collected", money],
  ["refundedCents", "Refunded", money],
  ["outstandingCents", "Outstanding", money],
  ["voidedCents", "Voided", money],
];

/** Financial summaries by stage or by month for any date range. */
export default function Reports() {
  const today = todayISO();
  const [params, setParams] = useState({ from: `${today.slice(0, 4)}-01-01`, to: today, groupBy: "stage" });
  const report = useApi(`/reports/summary${qs(params)}`);
  const set = (k) => (e) => setParams((p) => ({ ...p, [k]: e.target.value }));
  const t = report.data?.totals;
  const maxInvoiced = Math.max(1, ...(report.data?.rows || []).map((r) => r.invoicedCents));

  return (
    <>
      <PageHeader title="Financial Reports" subtitle="Invoiced and outstanding are counted by invoice date. Collected and refunded are counted by the date money moved." />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label><span className="label">From</span><input className="input" type="date" value={params.from} onChange={set("from")} /></label>
        <label><span className="label">To</span><input className="input" type="date" value={params.to} onChange={set("to")} /></label>
        <div className="flex overflow-hidden rounded-lg border border-line-strong" role="tablist" aria-label="Group by">
          {[["stage", "By stage"], ["month", "By month"]].map(([v, label]) => (
            <button key={v} role="tab" aria-selected={params.groupBy === v} onClick={() => setParams((p) => ({ ...p, groupBy: v }))}
              className={`px-3.5 py-2 text-sm font-medium ${params.groupBy === v ? "bg-primary text-white" : "bg-white text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <ErrorBanner error={report.error} />
      {report.loading && !report.data ? <Spinner /> : t && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Invoiced" value={money(t.invoicedCents)} sub={`${t.invoiceCount} invoice(s)`} />
            <StatTile label="Net collected" value={money(t.netCollectedCents)} sub={`${money(t.refundedCents)} refunded`} />
            <StatTile label="Outstanding" value={money(t.outstandingCents)} />
            <StatTile label="Collection rate" value={t.invoicedCents ? `${Math.round(((t.invoicedCents - t.outstandingCents) / t.invoicedCents) * 100)}%` : "-"} sub="of invoiced amount" />
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{params.groupBy === "stage" ? "Stage" : "Month"}</th>
                  {COLUMNS.map(([k, label]) => <th key={k} className="text-right">{label}</th>)}
                  <th className="w-40">Paid vs. owed</th>
                </tr>
              </thead>
              <tbody>
                {report.data.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="font-medium whitespace-nowrap">{r.label}</td>
                    {COLUMNS.map(([k, , fmt]) => <td key={k} className="text-right tabular-nums">{fmt(r[k])}</td>)}
                    <td>
                      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" style={{ width: `${(r.invoicedCents / maxInvoiced) * 100}%` }} title={`${money(r.invoicedCents - r.outstandingCents)} paid, ${money(r.outstandingCents)} owed`}>
                        <div className="bg-emerald-500" style={{ width: `${r.invoicedCents ? ((r.invoicedCents - r.outstandingCents) / r.invoicedCents) * 100 : 0}%` }} />
                        <div className="bg-amber-400" style={{ width: `${r.invoicedCents ? (r.outstandingCents / r.invoicedCents) * 100 : 0}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="bg-canvas font-semibold">
                  <td>Total</td>
                  {COLUMNS.map(([k, , fmt]) => <td key={k} className="text-right tabular-nums">{fmt(t[k])}</td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 flex gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Paid</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Still owed</span>
          </p>
        </>
      )}
    </>
  );
}
