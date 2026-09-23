import { useState } from "react";
import { ErrorBanner, PageHeader, Spinner, StageTag } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { money, shortDate, todayISO } from "../../lib/format";

/**
 * Price per session for each stage, with history. A new price applies to
 * enrollments on or after its effective date; issued invoices never change.
 */
export default function Pricing() {
  const pricing = useApi("/pricing");
  return (
    <>
      <PageHeader title="Stage Pricing" subtitle="Set a new price per session with a start date. Invoices already issued keep the price they were created with." />
      <ErrorBanner error={pricing.error} />
      {pricing.loading && !pricing.data ? <Spinner /> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(pricing.data || []).map((stage) => <StagePriceCard key={stage.id} stage={stage} onSaved={pricing.reload} />)}
        </div>
      )}
    </>
  );
}

function StagePriceCard({ stage, onSaved }) {
  const toast = useToast();
  const [price, setPrice] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/pricing", { stageId: stage.id, priceCents: Math.round(Number(price) * 100), effectiveFrom });
      toast(`Stage ${stage.id} will be ${money(Math.round(Number(price) * 100))} per session from ${shortDate(effectiveFrom)}.`);
      setPrice("");
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-center justify-between gap-2">
        <StageTag stage={stage} />
        <span className="text-sm text-muted">{stage.name}</span>
      </div>
      <div className="mt-3">
        <div className="text-3xl font-bold tabular-nums">{stage.current ? money(stage.current.priceCents) : "Not set"}</div>
        <div className="text-xs text-muted">per session{stage.current ? ` since ${shortDate(stage.current.effectiveFrom)}` : ""}</div>
      </div>
      {stage.upcoming.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          {stage.upcoming.map((u) => <div key={u.id}>Changes to {money(u.priceCents)} on {shortDate(u.effectiveFrom)}</div>)}
        </div>
      )}
      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <label className="w-24">
          <span className="label">New price</span>
          <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </label>
        <label className="flex-1">
          <span className="label">Starting</span>
          <input className="input" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </label>
        <button className="btn-primary">Set</button>
        <div className="w-full"><ErrorBanner error={error} /></div>
      </form>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted">History ({stage.history.length})</summary>
        <ul className="mt-2 space-y-1 text-xs">
          {stage.history.map((h) => (
            <li key={h.id} className="flex justify-between">
              <span>{shortDate(h.effectiveFrom)}</span>
              <span className="tabular-nums">{money(h.priceCents)}{h.setBy ? ` · ${h.setBy}` : ""}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
