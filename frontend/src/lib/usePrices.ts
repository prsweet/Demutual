import { useEffect, useRef, useState } from "react";
import { fetchPrices, type PricesPayload } from "./api";

const POLL_MS = 30_000;
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Polls Jupiter Price v3 (via our cached backend) for the given mints. Returns the latest
 * prices plus an `asOf` timestamp so the UI can render an honest "as of HH:MM:SS" footnote.
 * Prices are display-only — never use them for safety-sensitive math.
 */
export function usePrices(mints: string[]): {
  prices: PricesPayload["prices"];
  asOf: number | null;
  loading: boolean;
  error: string | null;
} {
  const key = mints.slice().sort().join(",");
  const [prices, setPrices] = useState<PricesPayload["prices"]>({});
  const [asOf, setAsOf] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!key) {
      setPrices({});
      setAsOf(null);
      return () => {
        cancelledRef.current = true;
      };
    }

    const tick = async () => {
      setLoading(true);
      try {
        const payload = await fetchPrices(key.split(","));
        if (cancelledRef.current) return;
        setPrices(payload.prices);
        setAsOf(payload.asOf);
        setError(null);
      } catch (e) {
        if (cancelledRef.current) return;
        setError(e instanceof Error ? e.message : "PRICES_FAILED");
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

  return { prices, asOf, loading, error };
}
