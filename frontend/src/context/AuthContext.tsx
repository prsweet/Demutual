import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { MeUser } from "../lib/types";
import { disconnectActiveWallet } from "../lib/wallet";
import { fetchMe, getStoredJwt, setStoredJwt } from "../lib/api";

type AuthContextValue = {
  user: MeUser | null;
  loading: boolean;
  token: string | null;
  setSession: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredJwt());
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const t = getStoredJwt();
    if (!t) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const me = await fetchMe();
      setUser(me);
    } catch {
      setStoredJwt(null);
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const setSession = useCallback(async (newToken: string) => {
    setStoredJwt(newToken);
    setToken(newToken);
    setLoading(true);
    try {
      const me = await fetchMe();
      setUser(me);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setStoredJwt(null);
    setToken(null);
    setUser(null);
    try {
      await disconnectActiveWallet();
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, token, setSession, logout, refreshUser }),
    [user, loading, token, setSession, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
