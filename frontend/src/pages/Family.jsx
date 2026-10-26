import { useState } from "react";
import { Link } from "react-router";
import Modal from "../components/Modal";
import { CoachTag, EmptyState, ErrorBanner, Field, PageHeader, Spinner, StageTag, StatusPill } from "../components/ui";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth, useRole } from "../lib/auth";
import { DAYS, ageFrom, money, shortDate, timeRange } from "../lib/format";

/** Parents: their swimmers and enrollments. Swimmers: their own lessons. */
export default function Family() {
  const { refresh } = useAuth();
  const { isParent } = useRole();
  const toast = useToast();
  const swimmers = useApi("/swimmers");
  const enrollments = useApi("/enrollments");
  const { data: stages } = useApi("/stages");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  async function cancel(e) {
    if (!confirm(`Cancel ${e.swimmer.name}'s enrollment in ${e.lesson.name}?`)) return;
    try {
      const res = await api.post(`/enrollments/${e.id}/cancel`);
      toast(res.message);
      enrollments.reload();
      swimmers.reload();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  const stageById = (id) => stages?.find((s) => s.id === id);

  return (
    <>
      <PageHeader
        title={isParent ? "My Family" : "My Lessons"}
        subtitle={isParent ? "Your swimmers and the classes they're in." : "The classes you're enrolled in."}
        actions={isParent && <button className="btn-primary" onClick={() => setAdding(true)}>+ Add swimmer</button>}
      />

      {isParent && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Swimmers</h2>
          {swimmers.loading && !swimmers.data ? <Spinner /> : (swimmers.data || []).length === 0 ? (
            <EmptyState title="No swimmers yet">Add your child to start enrolling.</EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {swimmers.data.map((s) => (
                <div key={s.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{s.name}</div>
                      <div className="text-xs text-muted">{s.dateOfBirth ? `Age ${ageFrom(s.dateOfBirth)}` : "Birthday not set"}</div>
                    </div>
                    {s.stageId ? <StageTag stage={stageById(s.stageId) || s.stageId} /> : <span className="text-xs text-muted">Stage not set</span>}
                  </div>
                  <div className="mt-2 text-sm text-muted">
                    {s.activeEnrollments.length ? `In ${s.activeEnrollments.map((e) => e.lessonName).join(", ")}` : "Not enrolled in any classes"}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    {s.stageId ? (
                      <Link to="/schedule" className="text-sm font-medium text-primary">
                        Find a Stage {s.stageId} class →
                      </Link>
                    ) : <span />}
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(s)}>Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">Stage placement is set by your coach after an assessment.</p>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Enrollments</h2>
        <ErrorBanner error={enrollments.error} />
        {enrollments.loading && !enrollments.data ? <Spinner /> : (enrollments.data || []).length === 0 ? (
          <EmptyState title="Not enrolled in any classes">
            <Link className="font-medium text-primary underline" to="/schedule">Browse the schedule</Link>
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {isParent && <th>Swimmer</th>}
                  <th>Class</th>
                  <th>When</th>
                  <th>Coach</th>
                  <th>Invoice</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {enrollments.data.map((e) => (
                  <tr key={e.id}>
                    {isParent && <td className="font-medium">{e.swimmer.name}</td>}
                    <td>
                      <div className="flex items-center gap-2"><StageTag stage={e.lesson.stage} size="xs" /> {e.lesson.name}</div>
                    </td>
                    <td className="text-sm">
                      {DAYS[e.lesson.dayOfWeek]}s, {timeRange(e.lesson.startTime, e.lesson.endTime)}
                      <div className="text-xs text-muted">through {shortDate(e.lesson.endDate)}</div>
                    </td>
                    <td><CoachTag coach={e.lesson.coach} /></td>
                    <td>{e.invoice && <span className="flex items-center gap-2"><StatusPill status={e.invoice.status} /> <span className="text-xs">{money(e.invoice.amountCents)}</span></span>}</td>
                    <td className="text-right">
                      <button className="btn-ghost btn-sm text-red-700" onClick={() => cancel(e)}>Cancel</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <EditSwimmerModal
          swimmer={editing}
          onClose={() => setEditing(null)}
          onSaved={async (s) => {
            setEditing(null);
            toast(`${s.name} was updated.`);
            swimmers.reload();
            enrollments.reload();
            await refresh();
          }}
        />
      )}
      {adding && (
        <AddSwimmerModal
          stages={stages || []}
          onClose={() => setAdding(false)}
          onSaved={async (s) => {
            setAdding(false);
            toast(`${s.name} was added.`);
            swimmers.reload();
            await refresh();
          }}
        />
      )}
    </>
  );
}

function AddSwimmerModal({ stages, onClose, onSaved }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", dateOfBirth: "", stageId: "" });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    try {
      onSaved(await api.post("/swimmers", { ...form, dateOfBirth: form.dateOfBirth || null, stageId: form.stageId ? Number(form.stageId) : null }));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add a swimmer" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="add-swimmer">Add swimmer</button></>}>
      <form id="add-swimmer" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="First name"><input className="input" value={form.firstName} onChange={set("firstName")} required /></Field>
        <Field label="Last name"><input className="input" value={form.lastName} onChange={set("lastName")} required /></Field>
        <Field label="Date of birth"><input className="input" type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
        <Field label="Stage (if known)">
          <select className="input" value={form.stageId} onChange={set("stageId")}>
            <option value="">Not sure yet</option>
            {stages.map((s) => <option key={s.id} value={s.id}>Stage {s.id}: {s.name}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2"><ErrorBanner error={error} /></div>
      </form>
    </Modal>
  );
}

/**
 * G2: parents fix a child's name or birthday. Stage is not editable here
 * because placement is the coach's assessment (the server enforces this too).
 */
function EditSwimmerModal({ swimmer, onClose, onSaved }) {
  const [form, setForm] = useState({
    firstName: swimmer.firstName,
    lastName: swimmer.lastName,
    dateOfBirth: swimmer.dateOfBirth || "",
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.patch(`/swimmers/${swimmer.id}`, { ...form, dateOfBirth: form.dateOfBirth || null }));
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
      title={`Edit ${swimmer.name}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="edit-swimmer" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button></>}
    >
      <form id="edit-swimmer" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="First name"><input className="input" value={form.firstName} onChange={set("firstName")} required /></Field>
        <Field label="Last name"><input className="input" value={form.lastName} onChange={set("lastName")} required /></Field>
        <Field label="Date of birth"><input className="input" type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
        <p className="self-end pb-2 text-xs text-muted">Stage placement is changed by your coach.</p>
        <div className="sm:col-span-2"><ErrorBanner error={error} /></div>
      </form>
    </Modal>
  );
}
