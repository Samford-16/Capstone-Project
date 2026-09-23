import { useState } from "react";
import Modal from "../../components/Modal";
import WeekGrid from "../../components/WeekGrid";
import { EmptyState, ErrorBanner, Field, PageHeader, Spinner, StageTag, CoachTag } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { DAYS, WEEK_ORDER, addDays, timeRange, todayISO } from "../../lib/format";

/**
 * Schedule templates: build a weekly pattern of lesson slots once, then apply
 * it to any date range to create all of those lessons at once.
 */
export default function Templates() {
  const toast = useToast();
  const templates = useApi("/templates");
  const { data: stages } = useApi("/stages");
  const { data: coaches } = useApi("/coaches");
  const [editing, setEditing] = useState(null); // template object, or {} for new
  const [applying, setApplying] = useState(null);
  const [previewId, setPreviewId] = useState(null);

  async function remove(t) {
    if (!confirm(`Delete template "${t.name}"? Lessons already created from it are kept.`)) return;
    await api.del(`/templates/${t.id}`);
    toast("Template deleted.");
    templates.reload();
  }

  const decorate = (slots) =>
    slots.map((s, i) => ({
      ...s,
      id: s.id ?? i,
      stage: stages?.find((st) => st.id === Number(s.stageId)),
      coach: coaches?.find((c) => c.id === Number(s.coachId)) || null,
    }));

  return (
    <>
      <PageHeader
        title="Schedule Templates"
        subtitle="A template is a weekly pattern of lesson slots. Apply it to a date range to create every lesson in one step."
        actions={<button className="btn-primary" onClick={() => setEditing({})}>+ New template</button>}
      />
      <ErrorBanner error={templates.error} />
      {templates.loading && !templates.data ? <Spinner /> : (templates.data || []).length === 0 ? (
        <EmptyState title="No templates yet">Create one to fill a whole term at once.</EmptyState>
      ) : (
        <div className="space-y-4">
          {templates.data.map((t) => (
            <div key={t.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{t.name}</h3>
                  {t.description && <p className="text-sm text-muted">{t.description}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {t.slots.length} slot(s) · {t.slots.reduce((s, x) => s + x.capacity, 0)} seats per week · {t.timesApplied} lesson(s) created so far
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary btn-sm" onClick={() => setApplying(t)}>Apply to dates</button>
                  <button className="btn-secondary btn-sm" onClick={() => setPreviewId(previewId === t.id ? null : t.id)}>
                    {previewId === t.id ? "Hide week" : "Show week"}
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => setEditing(t)}>Edit</button>
                  <button className="btn-ghost btn-sm text-red-700" onClick={() => remove(t)}>Delete</button>
                </div>
              </div>
              {previewId === t.id ? (
                <div className="mt-4"><WeekGrid items={decorate(t.slots)} /></div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {t.slots.map((s) => (
                    <span key={s.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 py-1 text-xs">
                      <StageTag stage={s.stage} size="xs" />
                      <span className="font-medium">{DAYS[s.dayOfWeek].slice(0, 3)} {timeRange(s.startTime, s.endTime)}</span>
                      <CoachTag coach={s.coach} size="xs" />
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditor
          template={editing}
          stages={stages || []}
          coaches={coaches || []}
          decorate={decorate}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast("Template saved.");
            templates.reload();
          }}
        />
      )}
      {applying && (
        <ApplyModal
          template={applying}
          onClose={() => setApplying(null)}
          onApplied={(res) => {
            setApplying(null);
            toast(`Created ${res.createdLessons} lesson(s). They're on the schedule now.`);
            templates.reload();
          }}
        />
      )}
    </>
  );
}

const blankSlot = () => ({ name: "", dayOfWeek: 1, startTime: "16:00", endTime: "16:45", stageId: 1, coachId: "", capacity: 6, location: "Main Pool" });

function TemplateEditor({ template, stages, coaches, decorate, onClose, onSaved }) {
  const [name, setName] = useState(template.name || "");
  const [description, setDescription] = useState(template.description || "");
  const [slots, setSlots] = useState(
    template.slots ? template.slots.map((s) => ({ ...s, coachId: s.coachId ?? "", name: s.name ?? "", location: s.location ?? "" })) : [blankSlot()],
  );
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const setSlot = (i, k) => (e) => setSlots((list) => list.map((s, j) => (j === i ? { ...s, [k]: e.target.value } : s)));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name,
      description: description || null,
      slots: slots.map((s) => ({
        name: s.name || null,
        dayOfWeek: Number(s.dayOfWeek),
        startTime: s.startTime,
        endTime: s.endTime,
        stageId: Number(s.stageId),
        coachId: s.coachId ? Number(s.coachId) : null,
        capacity: Number(s.capacity),
        location: s.location || null,
      })),
    };
    try {
      if (template.id) await api.put(`/templates/${template.id}`, body);
      else await api.post("/templates", body);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={template.id ? `Edit "${template.name}"` : "New template"}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" form="tpl-form" disabled={saving}>{saving ? "Saving..." : "Save template"}</button>
        </>
      }
    >
      <form id="tpl-form" onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fall Weekly Program" required /></Field>
          <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">Slots</span>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSlots((l) => [...l, { ...(l[l.length - 1] || blankSlot()), id: undefined }])}>+ Add slot</button>
          </div>
          <div className="space-y-2">
            {slots.map((s, i) => (
              <div key={i} className="rounded-lg border border-line bg-canvas p-2.5">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <input className="input col-span-2" placeholder="Class name (optional)" aria-label="Class name" value={s.name} onChange={setSlot(i, "name")} />
                  <select className="input" aria-label="Day" value={s.dayOfWeek} onChange={setSlot(i, "dayOfWeek")}>
                    {WEEK_ORDER.map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
                  </select>
                  <select className="input" aria-label="Stage" value={s.stageId} onChange={setSlot(i, "stageId")}>
                    {stages.map((st) => <option key={st.id} value={st.id}>Stage {st.id}</option>)}
                  </select>
                  <input className="input" type="time" aria-label="Start" value={s.startTime} onChange={setSlot(i, "startTime")} required />
                  <input className="input" type="time" aria-label="End" value={s.endTime} onChange={setSlot(i, "endTime")} required />
                  <select className="input" aria-label="Coach" value={s.coachId} onChange={setSlot(i, "coachId")}>
                    <option value="">No coach</option>
                    {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div className="flex items-center gap-1">
                    <input className="input" type="number" min="1" aria-label="Capacity" title="Capacity" value={s.capacity} onChange={setSlot(i, "capacity")} required />
                    <span className="text-xs text-muted">seats</span>
                    <button type="button" className="btn-ghost ml-auto px-2 text-red-700" aria-label="Remove slot" onClick={() => setSlots((l) => l.filter((_, j) => j !== i))} disabled={slots.length === 1}>✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Preview</span>
          <WeekGrid items={decorate(slots.filter((s) => s.startTime < s.endTime))} />
        </div>
        <ErrorBanner error={error} />
      </form>
    </Modal>
  );
}

function ApplyModal({ template, onClose, onApplied }) {
  const [startDate, setStart] = useState(todayISO());
  const [endDate, setEnd] = useState(addDays(todayISO(), 7 * 12 - 1));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Count how many sessions this will create, so the admin sees it first.
  const sessionCount = (() => {
    if (!startDate || !endDate || endDate < startDate) return 0;
    let n = 0;
    for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
      const dow = new Date(`${d}T12:00:00`).getDay();
      n += template.slots.filter((s) => s.dayOfWeek === dow).length;
    }
    return n;
  })();

  async function apply(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onApplied(await api.post(`/templates/${template.id}/apply`, { startDate, endDate }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Apply "${template.name}"`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" form="apply-form" disabled={busy || sessionCount === 0}>{busy ? "Creating..." : `Create ${template.slots.length} lessons`}</button>
        </>
      }
    >
      <form id="apply-form" onSubmit={apply} className="space-y-3">
        <p className="text-sm text-muted">Each slot becomes a lesson that meets every week between these dates.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First date"><input className="input" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} required /></Field>
          <Field label="Last date"><input className="input" type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} required /></Field>
        </div>
        <p className="rounded-lg bg-primary-light px-3 py-2 text-sm text-primary-dark">
          This creates {template.slots.length} lessons with {sessionCount} sessions in total. If any coach would be double-booked, nothing is created.
        </p>
        <ErrorBanner error={error} />
      </form>
    </Modal>
  );
}
