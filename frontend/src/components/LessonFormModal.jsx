import { useState } from "react";
import Modal from "./Modal";
import { ErrorBanner, Field } from "./ui";
import { api } from "../lib/api";
import { DAYS, addDays, todayISO } from "../lib/format";

/** Admin: create a lesson, or edit an existing one's name/coach/capacity/location/times. */
export default function LessonFormModal({ open, onClose, lesson, coaches, stages, onSaved }) {
  const editing = Boolean(lesson);
  const [form, setForm] = useState(() =>
    lesson
      ? {
          name: lesson.name,
          coachId: lesson.coach?.id ?? "",
          capacity: lesson.capacity,
          location: lesson.location || "",
          startTime: lesson.startTime,
          endTime: lesson.endTime,
        }
      : {
          name: "",
          stageId: 1,
          coachId: "",
          dayOfWeek: 1,
          startTime: "16:00",
          endTime: "16:45",
          capacity: 6,
          location: "Main Pool",
          startDate: todayISO(),
          endDate: addDays(todayISO(), 7 * 12),
        },
  );
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      ...form,
      coachId: form.coachId ? Number(form.coachId) : null,
      capacity: Number(form.capacity),
      ...(editing ? {} : { stageId: Number(form.stageId), dayOfWeek: Number(form.dayOfWeek), name: form.name || null }),
    };
    try {
      const saved = editing ? await api.patch(`/lessons/${lesson.id}`, body) : await api.post("/lessons", body);
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit lesson" : "New lesson"}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" form="lesson-form" disabled={saving}>
            {saving ? "Saving..." : editing ? "Save changes" : "Create lesson"}
          </button>
        </>
      }
    >
      <form id="lesson-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name" hint={editing ? null : "Optional. Defaults to stage, day and time."}>
            <input className="input" value={form.name} onChange={set("name")} required={editing} />
          </Field>
        </div>
        {!editing && (
          <>
            <Field label="Stage">
              <select className="input" value={form.stageId} onChange={set("stageId")}>
                {stages.map((s) => <option key={s.id} value={s.id}>Stage {s.id}: {s.name}</option>)}
              </select>
            </Field>
            <Field label="Day">
              <select className="input" value={form.dayOfWeek} onChange={set("dayOfWeek")}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="Coach">
          <select className="input" value={form.coachId} onChange={set("coachId")}>
            <option value="">Unassigned</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Capacity">
          <input className="input" type="number" min="1" max="100" value={form.capacity} onChange={set("capacity")} required />
        </Field>
        <Field label="Start time">
          <input className="input" type="time" value={form.startTime} onChange={set("startTime")} required />
        </Field>
        <Field label="End time">
          <input className="input" type="time" value={form.endTime} onChange={set("endTime")} required />
        </Field>
        {!editing && (
          <>
            <Field label="First date">
              <input className="input" type="date" value={form.startDate} onChange={set("startDate")} required />
            </Field>
            <Field label="Last date">
              <input className="input" type="date" value={form.endDate} onChange={set("endDate")} required />
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <Field label="Location">
            <input className="input" value={form.location} onChange={set("location")} />
          </Field>
        </div>
        {editing && (
          <p className="text-xs text-muted sm:col-span-2">
            Stage, day and dates can't change after a lesson is created because invoices were priced from them. Cancel it and create a new one instead.
          </p>
        )}
        <div className="sm:col-span-2"><ErrorBanner error={error} /></div>
      </form>
    </Modal>
  );
}
