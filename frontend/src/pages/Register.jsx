import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { ErrorBanner, Field } from "../components/ui";
import { AuthShell } from "./Login";

const blankSwimmer = () => ({ firstName: "", lastName: "", dateOfBirth: "", stageId: "" });

// Families sign up here. Coaches and admins are created by an admin.
export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { data: stages } = useApi("/stages");
  const [accountType, setAccountType] = useState("PARENT");
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", dateOfBirth: "", stageId: "" });
  const [swimmers, setSwimmers] = useState([blankSwimmer()]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setSwimmer = (i, k) => (e) => setSwimmers((list) => list.map((s, j) => (j === i ? { ...s, [k]: e.target.value } : s)));
  const clean = (s) => ({ ...s, dateOfBirth: s.dateOfBirth || null, stageId: s.stageId ? Number(s.stageId) : null });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const base = { accountType, name: form.name, email: form.email, password: form.password, phone: form.phone || null };
      await register(
        accountType === "PARENT"
          ? { ...base, swimmers: swimmers.filter((s) => s.firstName.trim()).map(clean) }
          : { ...base, dateOfBirth: form.dateOfBirth || null, stageId: form.stageId ? Number(form.stageId) : null },
      );
      navigate("/schedule");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const stageOptions = (
    <>
      <option value="">Not sure yet</option>
      {(stages || []).map((s) => <option key={s.id} value={s.id}>Stage {s.id}: {s.name}</option>)}
    </>
  );

  return (
    <AuthShell title="Create a family account" subtitle="Coaches and staff accounts are set up by an administrator.">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
          {[["PARENT", "I'm a parent", "Enroll my children"], ["SWIMMER", "I'm the swimmer", "Enroll myself"]].map(([v, label, sub]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={accountType === v}
              onClick={() => setAccountType(v)}
              className={`rounded-lg border p-3 text-left text-sm ${accountType === v ? "border-primary bg-primary-light" : "border-line-strong bg-white"}`}
            >
              <div className="font-semibold">{label}</div>
              <div className="text-xs text-muted">{sub}</div>
            </button>
          ))}
        </div>
        <Field label="Full name"><input className="input" value={form.name} onChange={set("name")} autoComplete="name" required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={set("email")} autoComplete="email" required /></Field>
          <Field label="Phone"><input className="input" type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" /></Field>
        </div>
        <Field label="Password" hint="At least 8 characters.">
          <input className="input" type="password" minLength={8} value={form.password} onChange={set("password")} autoComplete="new-password" required />
        </Field>

        {accountType === "SWIMMER" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date of birth"><input className="input" type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
            <Field label="Current stage"><select className="input" value={form.stageId} onChange={set("stageId")}>{stageOptions}</select></Field>
          </div>
        ) : (
          <fieldset className="space-y-3">
            <legend className="label">Swimmers</legend>
            {swimmers.map((s, i) => (
              <div key={i} className="rounded-lg border border-line bg-canvas p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="input" placeholder="First name" aria-label="First name" value={s.firstName} onChange={setSwimmer(i, "firstName")} />
                  <input className="input" placeholder="Last name" aria-label="Last name" value={s.lastName} onChange={setSwimmer(i, "lastName")} required={Boolean(s.firstName)} />
                  <input className="input" type="date" aria-label="Date of birth" value={s.dateOfBirth} onChange={setSwimmer(i, "dateOfBirth")} />
                  <select className="input" aria-label="Stage" value={s.stageId} onChange={setSwimmer(i, "stageId")}>{stageOptions}</select>
                </div>
                {swimmers.length > 1 && (
                  <button type="button" className="mt-2 text-xs text-red-700" onClick={() => setSwimmers((l) => l.filter((_, j) => j !== i))}>Remove</button>
                )}
              </div>
            ))}
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSwimmers((l) => [...l, blankSwimmer()])}>+ Add another swimmer</button>
          </fieldset>
        )}
        <ErrorBanner error={error} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating account..." : "Create account"}</button>
      </form>
      <p className="mt-4 text-center text-sm">Already have an account? <Link className="font-medium text-primary underline" to="/login">Sign in</Link></p>
    </AuthShell>
  );
}
