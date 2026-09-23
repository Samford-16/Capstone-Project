import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "../lib/auth";
import { ROLE_LABEL } from "../lib/format";

// Navigation changes with the signed-in role (role-based UI).
const NAV = {
  ADMIN: [
    ["/schedule", "Schedule"],
    ["/admin/templates", "Templates"],
    ["/admin/invoices", "Invoices"],
    ["/admin/reports", "Reports"],
    ["/admin/pricing", "Pricing"],
    ["/admin/users", "Users"],
  ],
  COACH: [["/schedule", "My Schedule"]],
  PARENT: [
    ["/schedule", "Schedule"],
    ["/family", "My Family"],
    ["/billing", "Billing"],
  ],
  SWIMMER: [
    ["/schedule", "Schedule"],
    ["/family", "My Lessons"],
    ["/billing", "Billing"],
  ],
};

export default function Layout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV[user.role] || [];

  const linkClass = ({ isActive }) =>
    `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? "bg-primary-light text-primary-dark" : "text-slate-600 hover:bg-slate-100 hover:text-ink"
    }`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <NavLink to="/schedule" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="text-xl font-bold tracking-tight text-primary">Current</span>
          </NavLink>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {items.map(([to, label]) => (
              <NavLink key={to} to={to} className={linkClass}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-3 md:flex">
            <span className="text-right text-sm leading-tight">
              <span className="block font-medium">{user.name}</span>
              <span className="text-xs text-muted">{ROLE_LABEL[user.role]}</span>
            </span>
            <button className="btn-secondary btn-sm" onClick={logout}>
              Sign out
            </button>
          </div>
          <button
            className="btn-ghost ml-auto px-2 md:hidden"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ☰
          </button>
        </div>
        {menuOpen && (
          <nav className="border-t border-line px-4 py-2 md:hidden" onClick={() => setMenuOpen(false)}>
            {items.map(([to, label]) => (
              <NavLink key={to} to={to} className={linkClass}>
                {label}
              </NavLink>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
              <span className="text-sm">
                {user.name} · <span className="text-muted">{ROLE_LABEL[user.role]}</span>
              </span>
              <button className="btn-secondary btn-sm" onClick={logout}>
                Sign out
              </button>
            </div>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
