import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchServerPublicConfig } from "../lib/api";
import type { ServerPublicConfig } from "../lib/types";

type Ctx = {
  config: ServerPublicConfig | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const ServerConfigContext = createContext<Ctx | null>(null);

export function ServerConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ServerPublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await fetchServerPublicConfig();
      setConfig(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load server config");
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ config, loading, error, refresh }), [config, loading, error, refresh]);

  return <ServerConfigContext.Provider value={value}>{children}</ServerConfigContext.Provider>;
}

export function useServerConfig(): Ctx {
  const ctx = useContext(ServerConfigContext);
  if (!ctx) throw new Error("useServerConfig requires ServerConfigProvider");
  return ctx;
}
