import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { ErrorBanner, Field } from "../components/ui";

const DEMO = [
  ["admin@current.test", "Admin"],
  ["mike@current.test", "Coach"],
  ["parent@current.test", "Parent"],
  ["swimmer@current.test", "Swimmer"],
];
const DEMO_PASSWORD = "Current123!";

export function AuthShell({ children, title, subtitle }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-light via-canvas to-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-2 h-12 w-12" />
          <h1 className="text-4xl font-bold tracking-tight text-primary">Current</h1>
          <p className="text-sm text-muted">Swim lesson management</p>
        </div>
        <div className="card p-6 shadow-lg">
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="mb-4 text-sm text-muted">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/schedule");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit} className="mt-4 space-y-3">
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorBanner error={error} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      </form>
      <p className="mt-4 text-center text-sm">
        New family? <Link className="font-medium text-primary underline" to="/register">Create an account</Link>
      </p>
      <div className="mt-5 rounded-lg border border-dashed border-line-strong bg-canvas p-3 text-xs text-muted">
        <div className="mb-2 font-semibold text-ink">Demo accounts (password {DEMO_PASSWORD})</div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {DEMO.map(([demoEmail, label]) => (
            <button
              key={demoEmail}
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                setEmail(demoEmail);
                setPassword(DEMO_PASSWORD);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}
