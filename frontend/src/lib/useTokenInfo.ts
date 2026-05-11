import { useEffect, useRef, useState } from "react";
import { fetchTokenInfo, type TokenInfoPayload } from "./api";

const POLL_MS = 10 * 60 * 1000; // 10 min — verification doesn't change minute-to-minute

/**
 * Token metadata from Jupiter Tokens v2 — `isVerified`, `isSus`, `organicScore`, etc.
 * Used to render educational badges on bucket listings so new-to-crypto users can tell
 * a verified asset (e.g. BONK / JitoSOL) from a token Jupiter has flagged as suspicious.
 */
export function useTokenInfo(mints: string[]): {
  tokens: TokenInfoPayload["tokens"];
  asOf: number | null;
  loading: boolean;
  error: string | null;
} {
  const key = mints.slice().sort().join(",");
  const [tokens, setTokens] = useState<TokenInfoPayload["tokens"]>({});
  const [asOf, setAsOf] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!key) {
      setTokens({});
      setAsOf(null);
      return () => {
        cancelledRef.current = true;
      };
    }

    const tick = async () => {
      setLoading(true);
      try {
        const payload = await fetchTokenInfo(key.split(","));
        if (cancelledRef.current) return;
        setTokens(payload.tokens);
        setAsOf(payload.asOf);
        setError(null);
      } catch (e) {
        if (cancelledRef.current) return;
        setError(e instanceof Error ? e.message : "TOKEN_INFO_FAILED");
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [key]);

  return { tokens, asOf, loading, error };
}
