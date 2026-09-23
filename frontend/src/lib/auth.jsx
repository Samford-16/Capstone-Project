import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const { user } = await api.get("/auth/me");
    setUser(user);
    return user;
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    refresh()
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout, refresh]);

  const login = useCallback(async (email, password) => {
    const res = await api.post("/auth/login", { email, password });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (payload) => {
    const res = await api.post("/auth/register", payload);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, register, refresh }),
    [user, loading, login, logout, register, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Role helpers so pages read clearly: const { isAdmin, isFamily } = useRole(); */
export function useRole() {
  const { user } = useAuth();
  const role = user?.role;
  return {
    role,
    isAdmin: role === "ADMIN",
    isCoach: role === "COACH",
    isParent: role === "PARENT",
    isSwimmer: role === "SWIMMER",
    isFamily: role === "PARENT" || role === "SWIMMER",
    isStaff: role === "ADMIN" || role === "COACH",
  };
}
