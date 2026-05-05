import { createContext, useContext, useEffect, useState, ReactNode } from "react";

const USERS: Record<string, string> = {
  "admin1@gmail.com": "admin1",
  "admin2@gmail.com": "admin2",
  "admin3@gmail.com": "admin3",
  "admin4@gmail.com": "admin4",
  "admin5@gmail.com": "admin5",
};

interface AuthCtx {
  user: string | null;
  login: (email: string, password: string) => { ok: boolean; error?: string };
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  login: () => ({ ok: false }),
  logout: () => {},
});

const KEY = "suraksha_agent";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem(KEY);
    if (stored) setUser(stored);
  }, []);

  const login = (email: string, password: string) => {
    const e = email.trim().toLowerCase();
    if (USERS[e] && USERS[e] === password) {
      sessionStorage.setItem(KEY, e);
      setUser(e);
      return { ok: true };
    }
    return { ok: false, error: "Invalid credentials" };
  };

  const logout = () => {
    sessionStorage.removeItem(KEY);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
};

export const useAuth = () => useContext(Ctx);
