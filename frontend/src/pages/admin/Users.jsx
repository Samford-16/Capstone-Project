import { useState } from "react";
import Modal from "../../components/Modal";
import { ErrorBanner, Field, PageHeader, Spinner, StatusPill } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { api, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useAuth } from "../../lib/auth";
import { ROLE_LABEL, shortDate } from "../../lib/format";

/** Admin user management. Accounts are deactivated, never deleted, to keep billing history. */
export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const users = useApi(`/users${qs({ role, search })}`);
  const [creating, setCreating] = useState(false);

  async function update(u, patch, msg) {
    try {
      await api.patch(`/users/${u.id}`, patch);
      toast(msg);
    } catch (err) {
      toast(err.message, "error");
    }
    users.reload();
  }

  const counts = (users.data || []).reduce((c, u) => ({ ...c, [u.role]: (c[u.role] || 0) + 1 }), {});

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Create staff accounts, change roles, and deactivate accounts. Families sign up on their own."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>+ New account</button>}
      />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label>
          <span className="label">Role</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}{counts[v] && !role ? ` (${counts[v]})` : ""}</option>)}
          </select>
        </label>
        <label className="min-w-[200px] flex-1">
          <span className="label">Search</span>
          <input className="input" placeholder="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      <ErrorBanner error={users.error} />
      {users.loading && !users.data ? <Spinner /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Joined</th><th /></tr>
            </thead>
            <tbody>
              {(users.data || []).map((u) => {
                const isMe = u.id === me.id;
                const lockedRole = isMe || u.role === "SWIMMER";
                return (
                  <tr key={u.id} className={u.active ? "" : "opacity-60"}>
                    <td className="font-medium">{u.name}{isMe && <span className="ml-1 text-xs text-muted">(you)</span>}</td>
                    <td className="text-sm">{u.email}</td>
                    <td className="text-sm">{u.phone || "-"}</td>
                    <td>
                      {lockedRole ? ROLE_LABEL[u.role] : (
                        <select className="input py-1 text-xs" aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => update(u, { role: e.target.value }, `${u.name} is now ${ROLE_LABEL[e.target.value]}.`)}>
                          {["ADMIN", "COACH", "PARENT"].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      )}
                    </td>
                    <td><StatusPill status={u.active ? "ACTIVE" : "CANCELLED"} label={u.active ? "active" : "deactivated"} /></td>
                    <td className="text-sm whitespace-nowrap">{shortDate(u.createdAt.slice(0, 10))}</td>
                    <td className="text-right">
                      {!isMe && (
                        <button className="btn-ghost btn-sm" onClick={() => update(u, { active: !u.active }, u.active ? `${u.name} deactivated.` : `${u.name} reactivated.`)}>
                          {u.active ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onCreated={(u) => {
            setCreating(false);
            toast(`${u.name} can now sign in.`);
            users.reload();
          }}
        />
      )}
    </>
  );
}

function CreateUser({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "COACH", phone: "" });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    try {
      onCreated(await api.post("/users", { ...form, phone: form.phone || null }));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal open onClose={onClose} title="New account" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="user-form">Create</button></>}>
      <form id="user-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input className="input" value={form.name} onChange={set("name")} required /></Field>
        <Field label="Role">
          <select className="input" value={form.role} onChange={set("role")}>
            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Email"><input className="input" type="email" value={form.email} onChange={set("email")} required /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={set("phone")} /></Field>
        <div className="sm:col-span-2">
          <Field label="Temporary password" hint="At least 8 characters. Share it with them directly.">
            <input className="input" type="text" minLength={8} value={form.password} onChange={set("password")} required />
          </Field>
        </div>
        <div className="sm:col-span-2"><ErrorBanner error={error} /></div>
      </form>
    </Modal>
  );
}
