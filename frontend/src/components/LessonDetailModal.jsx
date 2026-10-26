import { useState } from "react";
import { Link } from "react-router";
import Modal from "./Modal";
import LessonFormModal from "./LessonFormModal";
import { CapacityBar, CoachTag, ErrorBanner, Spinner, StageTag, StatusPill } from "./ui";
import { useToast } from "./Toast";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth, useRole } from "../lib/auth";
import { DAYS, ageFrom, money, shortDate, timeRange, todayISO } from "../lib/format";

/**
 * Everything about one lesson, adapted to the viewer:
 * families can enroll (the button disappears when the class is full),
 * coaches see their roster, admins also edit, cancel and see payment status.
 */
export default function LessonDetailModal({ lessonId, onClose, onChanged, coaches, stages }) {
  const { user, refresh } = useAuth();
  const { isAdmin, isFamily, isSwimmer } = useRole();
  const toast = useToast();
  const { data: lesson, error, loading, reload } = useApi(lessonId ? `/lessons/${lessonId}` : null);
  const [swimmerId, setSwimmerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [showSessions, setShowSessions] = useState(false);

  const mySwimmers = user.swimmers || [];
  const enrolledIds = new Set((lesson?.myEnrollments || []).map((e) => e.swimmerId));
  const eligible = mySwimmers.filter((s) => !enrolledIds.has(s.id));
  const selectedId = swimmerId || (isSwimmer ? mySwimmers[0]?.id : eligible[0]?.id) || "";

  async function run(fn, success) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (success) toast(typeof success === "function" ? success(res) : success);
      await reload();
      onChanged?.();
      return res;
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  const enroll = () =>
    run(
      () => api.post("/enrollments", { lessonId, swimmerId: Number(selectedId) }),
      (res) => `${res.swimmer.name} is enrolled. Invoice ${res.invoice.number} for ${money(res.invoice.amountCents)} was created.`,
    ).then(() => refresh());

  const cancelEnrollment = (enrollmentId, name) => {
    if (!confirm(`Cancel ${name}'s enrollment in this lesson?`)) return;
    run(() => api.post(`/enrollments/${enrollmentId}/cancel`), (res) => res.message);
  };

  const cancelLesson = () => {
    if (!confirm("Cancel this lesson? All enrollments will be cancelled and unpaid invoices voided.")) return;
    run(
      () => api.post(`/lessons/${lessonId}/cancel`),
      (r) => `Lesson cancelled. ${r.cancelledEnrollments} enrollment(s) cancelled, ${r.voidedInvoices} invoice(s) voided${r.invoicesNeedingRefund ? `, ${r.invoicesNeedingRefund} paid invoice(s) need a refund` : ""}.`,
    ).then(() => onClose());
  };

  const deleteLesson = () => {
    if (!confirm("Delete this lesson permanently?")) return;
    run(() => api.del(`/lessons/${lessonId}`), "Lesson deleted.").then(() => onClose());
  };

  // G1: staff place swimmers in a stage after assessing them. The server allows
  // admins (any swimmer) and the lesson's coach (swimmers in their lessons).
  const changeStage = (r, value) => {
    const stageId = value ? Number(value) : null;
    if (stageId === r.swimmer.stageId) return;
    run(
      () => api.patch(`/swimmers/${r.swimmer.id}`, { stageId }),
      (s) => (s.stageId ? `${s.name} is now Stage ${s.stageId}.` : `${s.name} has no stage set.`),
    );
  };
  const stageOptions = stages?.length ? stages : [1, 2, 3, 4, 5].map((id) => ({ id, name: `Stage ${id}` }));

  const toggleSession = (s) =>
    run(() => api.patch(`/sessions/${s.id}`, { cancelled: !s.cancelled }), s.cancelled ? "Session restored." : "Session cancelled.");

  const today = todayISO();

  return (
    <Modal open={Boolean(lessonId)} onClose={onClose} title={lesson?.name || "Lesson"} wide>
      {loading && !lesson && <Spinner />}
      <ErrorBanner error={error} />
      {lesson && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StageTag stage={lesson.stage} />
            <CoachTag coach={lesson.coach} />
            {lesson.status === "CANCELLED" && <StatusPill status="CANCELLED" />}
          </div>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted">When</dt>
            <dd>{DAYS[lesson.dayOfWeek]}s, {timeRange(lesson.startTime, lesson.endTime)}</dd>
            <dt className="text-muted">Dates</dt>
            <dd>
              {lesson.sessions.length
                ? `${shortDate(lesson.sessions[0].date)} to ${shortDate(lesson.sessions[lesson.sessions.length - 1].date)}`
                : `${shortDate(lesson.startDate)} to ${shortDate(lesson.endDate)}`}
              {" · "}{lesson.remainingSessions} session(s) left
            </dd>
            {lesson.location && (<><dt className="text-muted">Where</dt><dd>{lesson.location}</dd></>)}
            <dt className="text-muted">Stage</dt>
            <dd>{lesson.stage.name}</dd>
            {lesson.pricePerSessionCents !== null && (
              <>
                <dt className="text-muted">Price</dt>
                <dd>
                  {money(lesson.pricePerSessionCents)} per session
                  {isFamily && lesson.remainingSessions > 0 && (
                    <span className="text-muted"> · {money(lesson.pricePerSessionCents * lesson.remainingSessions)} if you enroll today</span>
                  )}
                </dd>
              </>
            )}
          </dl>

          <CapacityBar enrolled={lesson.enrolledCount} capacity={lesson.capacity} />

          {isFamily && lesson.status === "ACTIVE" && (
            <section className="rounded-xl border border-line bg-canvas p-4">
              {lesson.myEnrollments.length > 0 && (
                <ul className="mb-3 space-y-1.5">
                  {lesson.myEnrollments.map((e) => {
                    const s = mySwimmers.find((x) => x.id === e.swimmerId);
                    const name = s ? `${s.firstName} ${s.lastName}` : "Swimmer";
                    return (
                      <li key={e.enrollmentId} className="flex items-center justify-between gap-2 text-sm">
                        <span><span className="font-medium">{name}</span> is enrolled</span>
                        <button className="btn-ghost btn-sm text-red-700" disabled={busy} onClick={() => cancelEnrollment(e.enrollmentId, name)}>
                          Cancel enrollment
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {lesson.isFull ? (
                <p className="text-sm font-medium text-red-700">This class is full.</p>
              ) : mySwimmers.length === 0 ? (
                <p className="text-sm">
                  <Link className="font-medium text-primary underline" to="/family">Add a swimmer</Link> to your family first.
                </p>
              ) : eligible.length === 0 ? null : lesson.remainingSessions === 0 ? (
                <p className="text-sm text-muted">No sessions left to join.</p>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  {!isSwimmer && (
                    <label className="min-w-[180px] flex-1">
                      <span className="label">Swimmer</span>
                      <select className="input" value={selectedId} onChange={(e) => setSwimmerId(e.target.value)}>
                        {eligible.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.firstName} {s.lastName}{s.stageId ? ` (Stage ${s.stageId})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button className="btn-primary" disabled={busy || !selectedId} onClick={enroll}>
                    {busy ? "Enrolling..." : `Enroll${isSwimmer ? " me" : ""} · ${money(lesson.pricePerSessionCents * lesson.remainingSessions)}`}
                  </button>
                  {(() => {
                    const s = mySwimmers.find((x) => x.id === Number(selectedId));
                    return s?.stageId && s.stageId !== lesson.stage.id ? (
                      <p className="w-full text-xs text-amber-700">
                        {s.firstName} is placed in Stage {s.stageId}. This is a Stage {lesson.stage.id} class.
                      </p>
                    ) : null;
                  })()}
                </div>
              )}
            </section>
          )}

          <ErrorBanner error={actionError} />

          {lesson.roster && (
            <section>
              <h3 className="mb-2 font-semibold">Roster ({lesson.roster.length})</h3>
              {lesson.roster.length === 0 ? (
                <p className="text-sm text-muted">No swimmers enrolled yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Swimmer</th>
                        <th>Age</th>
                        <th>Stage placement</th>
                        <th>Contact</th>
                        {isAdmin && <th>Invoice</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {lesson.roster.map((r) => (
                        <tr key={r.enrollmentId}>
                          <td className="font-medium">{r.swimmer.name}</td>
                          <td>{ageFrom(r.swimmer.dateOfBirth) ?? "-"}</td>
                          <td>
                            <label className="sr-only" htmlFor={`stage-${r.enrollmentId}`}>Stage placement for {r.swimmer.name}</label>
                            <select
                              id={`stage-${r.enrollmentId}`}
                              className={`input py-1 text-xs ${r.swimmer.stageId && r.swimmer.stageId !== lesson.stage.id ? "border-amber-500" : ""}`}
                              value={r.swimmer.stageId ?? ""}
                              disabled={busy}
                              onChange={(e) => changeStage(r, e.target.value)}
                              title={r.swimmer.stageId && r.swimmer.stageId !== lesson.stage.id ? "Placed in a different stage than this class" : undefined}
                            >
                              <option value="">Not set</option>
                              {stageOptions.map((st) => <option key={st.id} value={st.id}>Stage {st.id}</option>)}
                            </select>
                          </td>
                          <td className="text-xs">
                            {r.contacts.length ? r.contacts.map((c) => <div key={c.email}>{c.name} · {c.phone || c.email}</div>) : "Own account"}
                          </td>
                          {isAdmin && <td>{r.invoiceStatus && <StatusPill status={r.invoiceStatus} />}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section>
            <button className="text-sm font-medium text-primary" onClick={() => setShowSessions((s) => !s)}>
              {showSessions ? "Hide" : "Show"} all {lesson.sessions.length} dates
            </button>
            {showSessions && (
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {lesson.sessions.map((s) => (
                  <li key={s.id} className={`flex items-center justify-between rounded-lg border border-line px-3 py-1.5 text-sm ${s.date < today ? "text-muted" : ""}`}>
                    <span className={s.cancelled ? "line-through" : ""}>{shortDate(s.date)}</span>
                    {s.cancelled && <span className="text-xs text-red-700">Cancelled</span>}
                    {isAdmin && s.date >= today && lesson.status === "ACTIVE" && (
                      <button className="btn-ghost btn-sm" disabled={busy} onClick={() => toggleSession(s)}>
                        {s.cancelled ? "Restore" : "Cancel"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isAdmin && lesson.status === "ACTIVE" && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <button className="btn-primary" onClick={() => setEditing(true)}>Edit lesson</button>
              <button className="btn-secondary text-red-700" disabled={busy} onClick={cancelLesson}>Cancel lesson</button>
              {lesson.enrolledCount === 0 && (
                <button className="btn-ghost text-red-700" disabled={busy} onClick={deleteLesson}>Delete</button>
              )}
            </div>
          )}
        </div>
      )}
      {editing && lesson && (
        <LessonFormModal
          open
          lesson={lesson}
          coaches={coaches || []}
          stages={stages || []}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast("Lesson updated.");
            reload();
            onChanged?.();
          }}
        />
      )}
    </Modal>
  );
}
