import { useMemo, useState } from "react";
import WeekGrid from "../components/WeekGrid";
import LessonCard from "../components/LessonCard";
import LessonDetailModal from "../components/LessonDetailModal";
import LessonFormModal from "../components/LessonFormModal";
import { CapacityBar, CoachTag, EmptyState, ErrorBanner, PageHeader, Spinner, StageLegend, StageTag, StatTile } from "../components/ui";
import { useToast } from "../components/Toast";
import { useApi } from "../lib/useApi";
import { qs } from "../lib/api";
import { useAuth, useRole } from "../lib/auth";
import { DAYS, WEEK_ORDER, addDays, longDate, money, timeRange, todayISO } from "../lib/format";

const VIEW_KEY = "current.scheduleView";
function savedView() {
  try {
    return localStorage.getItem(VIEW_KEY) || "week";
  } catch {
    return "week";
  }
}

export default function Schedule() {
  const { user } = useAuth();
  const { isAdmin, isCoach, isFamily } = useRole();
  const toast = useToast();

  const [view, setViewState] = useState(savedView);
  const setView = (v) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const [filters, setFilters] = useState({ stageId: "", coachId: "", dayOfWeek: "", availability: "", enrolled: "", sort: "time" });
  const [day, setDay] = useState(todayISO());
  const [openLessonId, setOpenLessonId] = useState(null);
  const [creating, setCreating] = useState(false);

  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const clearFilters = () => setFilters((f) => ({ stageId: "", coachId: "", dayOfWeek: "", availability: "", enrolled: "", sort: f.sort }));
  const activeFilterCount = ["stageId", "coachId", "dayOfWeek", "availability", "enrolled"].filter((k) => filters[k]).length;

  const lessons = useApi(`/lessons${qs(filters)}`);
  const sessions = useApi(
    view === "day" ? `/sessions${qs({ from: day, to: day, stageId: filters.stageId, coachId: filters.coachId })}` : null,
  );
  const { data: stages } = useApi("/stages");
  const { data: coaches } = useApi(isCoach ? null : "/coaches");
  const overview = useApi(isAdmin ? "/reports/overview" : null);
  const unpaid = useApi(isFamily ? "/invoices?status=UNPAID" : null);

  const reloadAll = () => {
    lessons.reload();
    if (view === "day") sessions.reload();
    if (isAdmin) overview.reload();
    if (isFamily) unpaid.reload();
  };

  // Day view applies the same availability/enrollment filters on the client.
  const daySessions = useMemo(() => {
    if (!sessions.data) return [];
    return sessions.data.filter(({ lesson: l }) => {
      if (filters.availability === "open" && l.isFull) return false;
      if (filters.availability === "full" && !l.isFull) return false;
      if (filters.enrolled) {
        const has = isFamily ? l.myEnrollments.length > 0 : l.enrolledCount > 0;
        if (has !== (filters.enrolled === "true")) return false;
      }
      return true;
    });
  }, [sessions.data, filters, isFamily]);

  const rows = lessons.data || [];

  return (
    <>
      <PageHeader
        title={isCoach ? "My Schedule" : "Lesson Schedule"}
        subtitle={
          isCoach
            ? "The lessons you're assigned to teach. Open one to see its roster."
            : isFamily
              ? "Find a class for your stage and schedule, then enroll."
              : "Every active lesson. Click one to see its roster, edit it, or cancel it."
        }
        actions={isAdmin && <button className="btn-primary" onClick={() => setCreating(true)}>+ New lesson</button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isAdmin && overview.data && (
          <>
            <StatTile label="Active lessons" value={overview.data.activeLessons} />
            <StatTile label="Seats filled" value={`${Math.round(overview.data.fillRate * 100)}%`} sub={`${overview.data.activeEnrollments} of ${overview.data.totalSeats}`} />
            <StatTile label="Outstanding" value={money(overview.data.outstandingCents)} sub={`${overview.data.overdueInvoices} overdue`} />
            <StatTile label="Collected this month" value={money(overview.data.collectedThisMonthCents)} />
          </>
        )}
        {isCoach && lessons.data && (
          <>
            <StatTile label="My lessons" value={rows.length} />
            <StatTile label="Swimmers" value={rows.reduce((s, l) => s + l.enrolledCount, 0)} />
            <StatTile label="Classes per week" value={rows.length} />
            <StatTile label="Open seats" value={rows.reduce((s, l) => s + l.spotsLeft, 0)} />
          </>
        )}
        {isFamily && lessons.data && (
          <>
            <StatTile label="Enrolled classes" value={rows.reduce((s, l) => s + l.myEnrollments.length, 0)} />
            <StatTile label="Balance due" value={money((unpaid.data || []).reduce((s, i) => s + i.balanceCents, 0))} sub={`${(unpaid.data || []).length} unpaid invoice(s)`} />
            <StatTile label="Classes with openings" value={rows.filter((l) => !l.isFull).length} />
            <StatTile label={isFamily && user.role === "PARENT" ? "Swimmers" : "My stage"} value={user.role === "PARENT" ? user.swimmers.length : user.swimmers[0]?.stageId ? `Stage ${user.swimmers[0].stageId}` : "-"} />
          </>
        )}
      </div>

      {/* Filter + view toolbar */}
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-[120px] flex-1 sm:flex-none">
          <span className="label">Stage</span>
          <select className="input" value={filters.stageId} onChange={setFilter("stageId")}>
            <option value="">All stages</option>
            {(stages || []).map((s) => <option key={s.id} value={s.id}>Stage {s.id}</option>)}
          </select>
        </label>
        {!isCoach && (
          <label className="min-w-[140px] flex-1 sm:flex-none">
            <span className="label">Coach</span>
            <select className="input" value={filters.coachId} onChange={setFilter("coachId")}>
              <option value="">All coaches</option>
              {(coaches || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {view !== "day" && (
          <label className="min-w-[120px] flex-1 sm:flex-none">
            <span className="label">Day</span>
            <select className="input" value={filters.dayOfWeek} onChange={setFilter("dayOfWeek")}>
              <option value="">All days</option>
              {WEEK_ORDER.map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
            </select>
          </label>
        )}
        <label className="min-w-[120px] flex-1 sm:flex-none">
          <span className="label">Availability</span>
          <select className="input" value={filters.availability} onChange={setFilter("availability")}>
            <option value="">Any</option>
            <option value="open">Has openings</option>
            <option value="full">Full</option>
          </select>
        </label>
        <label className="min-w-[140px] flex-1 sm:flex-none">
          <span className="label">Enrollment</span>
          <select className="input" value={filters.enrolled} onChange={setFilter("enrolled")}>
            <option value="">Any</option>
            <option value="true">{isFamily ? "My swimmers enrolled" : "Has swimmers"}</option>
            <option value="false">{isFamily ? "Not enrolled" : "Empty"}</option>
          </select>
        </label>
        {view === "list" && (
          <label className="min-w-[120px] flex-1 sm:flex-none">
            <span className="label">Sort by</span>
            <select className="input" value={filters.sort} onChange={setFilter("sort")}>
              <option value="time">Day and time</option>
              <option value="stage">Stage</option>
              {!isCoach && <option value="coach">Coach</option>}
              <option value="spots">Most openings</option>
            </select>
          </label>
        )}
        {activeFilterCount > 0 && (
          <button className="btn-ghost btn-sm mb-1" onClick={clearFilters}>Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}</button>
        )}
        <div className="ml-auto flex overflow-hidden rounded-lg border border-line-strong" role="tablist" aria-label="View">
          {[["week", "Week"], ["day", "Day"], ["list", "List"]].map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`px-3.5 py-2 text-sm font-medium ${view === v ? "bg-primary text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3"><StageLegend stages={stages} /></div>
      <ErrorBanner error={lessons.error || sessions.error} />

      {view === "week" && (lessons.loading && !lessons.data ? <Spinner /> : (
        <WeekGrid items={rows} onSelect={(l) => setOpenLessonId(l.id)} emptyText={activeFilterCount ? "No lessons match these filters." : "No lessons scheduled yet."} />
      ))}

      {view === "list" && (lessons.loading && !lessons.data ? <Spinner /> : rows.length === 0 ? (
        <EmptyState title="No lessons match">Try clearing some filters.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((l) => <LessonCard key={l.id} lesson={l} mySwimmers={user.swimmers} onOpen={() => setOpenLessonId(l.id)} />)}
        </div>
      ))}

      {view === "day" && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button className="btn-secondary btn-sm" onClick={() => setDay((d) => addDays(d, -1))} aria-label="Previous day">←</button>
            <input className="input w-auto" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
            <button className="btn-secondary btn-sm" onClick={() => setDay((d) => addDays(d, 1))} aria-label="Next day">→</button>
            {day !== todayISO() && <button className="btn-ghost btn-sm" onClick={() => setDay(todayISO())}>Today</button>}
            <span className="ml-1 font-semibold">{longDate(day)}</span>
          </div>
          {sessions.loading && !sessions.data ? <Spinner /> : daySessions.length === 0 ? (
            <EmptyState title="No classes this day" />
          ) : (
            <ul className="space-y-2">
              {daySessions.map(({ id, cancelled, lesson: l }) => (
                <li key={id}>
                  <button
                    onClick={() => setOpenLessonId(l.id)}
                    className={`card flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-3 text-left hover:shadow-md ${cancelled ? "opacity-60" : ""}`}
                    style={{ borderLeft: `6px solid ${l.stage.color}` }}
                  >
                    <div className="w-36 shrink-0 text-sm font-semibold tabular-nums">{timeRange(l.startTime, l.endTime)}</div>
                    <div className="min-w-[160px] flex-1">
                      <div className={`font-medium ${cancelled ? "line-through" : ""}`}>{l.name}</div>
                      <div className="text-xs text-muted">{l.location}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StageTag stage={l.stage} />
                      <CoachTag coach={l.coach} />
                    </div>
                    <div className="w-full sm:w-44">
                      {cancelled ? <span className="text-sm font-medium text-red-700">Cancelled</span> : <CapacityBar enrolled={l.enrolledCount} capacity={l.capacity} />}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {openLessonId && (
        <LessonDetailModal
          lessonId={openLessonId}
          onClose={() => setOpenLessonId(null)}
          onChanged={reloadAll}
          coaches={coaches}
          stages={stages}
        />
      )}
      {creating && (
        <LessonFormModal
          open
          coaches={coaches || []}
          stages={stages || []}
          onClose={() => setCreating(false)}
          onSaved={(l) => {
            setCreating(false);
            toast(`Created "${l.name}" with ${l.remainingSessions} upcoming session(s).`);
            reloadAll();
          }}
        />
      )}
    </>
  );
}
