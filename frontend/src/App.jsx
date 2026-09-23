import { Navigate, Route, Routes } from "react-router";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Schedule from "./pages/Schedule";
import Family from "./pages/Family";
import Billing from "./pages/Billing";
import Templates from "./pages/admin/Templates";
import Invoices from "./pages/admin/Invoices";
import Reports from "./pages/admin/Reports";
import Pricing from "./pages/admin/Pricing";
import Users from "./pages/admin/Users";

/** Page-level guard. The API enforces the same rules; this just keeps people off pages they can't use. */
function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <Navigate to="/schedule" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Starting Current" />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const admin = (el) => <RequireRole roles={["ADMIN"]}>{el}</RequireRole>;
  const family = (el) => <RequireRole roles={["PARENT", "SWIMMER"]}>{el}</RequireRole>;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/family" element={family(<Family />)} />
        <Route path="/billing" element={family(<Billing />)} />
        <Route path="/admin/templates" element={admin(<Templates />)} />
        <Route path="/admin/invoices" element={admin(<Invoices />)} />
        <Route path="/admin/reports" element={admin(<Reports />)} />
        <Route path="/admin/pricing" element={admin(<Pricing />)} />
        <Route path="/admin/users" element={admin(<Users />)} />
      </Route>
      <Route path="*" element={<Navigate to="/schedule" replace />} />
    </Routes>
  );
}
