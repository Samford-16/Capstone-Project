// Small shared building blocks used across pages.

export function StageTag({ stage, size = "sm" }) {
  if (!stage) return null;
  const id = stage.id ?? stage;
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold whitespace-nowrap text-ink ${pad}`}
      style={{ background: stage.color || `var(--color-stage-${id})` }}
      title={stage.name ? `Stage ${id}: ${stage.name}` : `Stage ${id}`}
    >
      Stage {id}
    </span>
  );
}

export function CoachTag({ coach, size = "sm" }) {
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  if (!coach) {
    return <span className={`inline-flex rounded-full border border-dashed border-line-strong text-muted ${pad}`}>No coach</span>;
  }
  const initials = coach.name.split(" ").map((p) => p[0]).join("").slice(0, 2);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 font-medium whitespace-nowrap text-slate-700 ${pad}`}>
      <span className="grid h-4 w-4 place-items-center rounded-full bg-slate-700 text-[8px] font-bold text-white">{initials}</span>
      {coach.name.split(" ")[0]}
    </span>
  );
}

export function CapacityBar({ enrolled, capacity, compact = false }) {
  const pct = capacity ? Math.min(100, Math.round((enrolled / capacity) * 100)) : 0;
  const full = enrolled >= capacity;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-semibold tabular-nums">
        {enrolled}/{capacity}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={enrolled} aria-valuemax={capacity}>
        <div className={`h-full rounded-full ${full ? "bg-red-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      {!compact && <OpenPill full={full} spotsLeft={capacity - enrolled} />}
    </div>
  );
}

export function OpenPill({ full, spotsLeft }) {
  return full ? (
    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 uppercase">Full</span>
  ) : (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
      {spotsLeft} open
    </span>
  );
}

const STATUS_STYLES = {
  UNPAID: "bg-amber-50 text-amber-800",
  PAID: "bg-emerald-50 text-emerald-700",
  VOID: "bg-slate-100 text-slate-500",
  REFUNDED: "bg-slate-100 text-slate-600",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-slate-100 text-slate-500",
  OVERDUE: "bg-red-50 text-red-700",
};

export function StatusPill({ status, label }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${STATUS_STYLES[status] || "bg-slate-100"}`}>
      {label || status.toLowerCase()}
    </span>
  );
}

export function StatTile({ label, value, sub }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="card px-6 py-12 text-center">
      <h3 className="font-semibold">{title}</h3>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error.message || String(error)}
    </p>
  );
}

export function Spinner({ label = "Loading" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      {label}...
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function StageLegend({ stages }) {
  if (!stages) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {stages.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
          {s.id}: {s.name}
        </span>
      ))}
    </div>
  );
}
