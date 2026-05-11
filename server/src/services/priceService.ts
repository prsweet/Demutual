/**
 * Jupiter Price API v3 wrapper with in-memory cache.
 * Spec: GET https://api.jup.ag/price/v3?ids=<comma-separated mints, max 50>
 * Returns per-mint `{ usdPrice, blockId, decimals, priceChange24h }` (shape per Jupiter docs).
 *
 * Cache hides Jupiter rate limits from chatty FE polling; TTL is short so quotes stay
 * fresh enough for a UX-only display. Never use these prices for safety-critical math —
 * they are display-only, with an `asOf` timestamp surfaced to the user.
 */

const PRICE_TTL_MS = 30_000;
const PRICE_HOST = "https://api.jup.ag";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

type CacheEntry = {
  price: number | null;
  /** Jupiter price v3 doesn't always return a confidence field; null when absent. */
  confidence: string | null;
  /** Percent change over 24h from Jupiter (e.g. 1.39 = +1.39%). Null if Jupiter doesn't return it. */
  priceChange24h: number | null;
  asOf: number;
};

const cache = new Map<string, CacheEntry>();

export type PriceResult = {
  prices: Record<
    string,
    { price: number | null; confidence: string | null; priceChange24h: number | null }
  >;
  /** Oldest cache asOf among requested mints — drives the "as of" footnote. */
  asOf: number;
  /** Mints we could not refresh (returned cached or null). */
  staleMints: string[];
};

export async function getPrices(rawMints: string[]): Promise<PriceResult> {
  const mints = Array.from(
    new Set(rawMints.map((m) => m.trim()).filter((m) => m.length > 0))
  );
  if (mints.length === 0) {
    return { prices: {}, asOf: Date.now(), staleMints: [] };
  }

  const now = Date.now();
  const need: string[] = [];
  for (const mint of mints) {
    const cached = cache.get(mint);
    if (!cached || now - cached.asOf > PRICE_TTL_MS) need.push(mint);
  }

  if (need.length > 0) {
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = process.env.JUPITER_API_KEY?.trim();
    if (key) headers["x-api-key"] = key;

    for (let i = 0; i < need.length; i += 50) {
      const chunk = need.slice(i, i + 50);
      try {
        const u = new URL(`${PRICE_HOST}/price/v3`);
        u.searchParams.set("ids", chunk.join(","));
        const res = await fetch(u.toString(), { headers });
        if (!res.ok) {
          for (const m of chunk) {
            if (!cache.has(m)) {
              cache.set(m, { price: null, confidence: null, priceChange24h: null, asOf: now });
            }
          }
          continue;
        }
        const body = (await res.json()) as Record<
          string,
          { usdPrice?: number; confidenceLevel?: string; priceChange24h?: number } | undefined
        >;
        for (const m of chunk) {
          const row = body?.[m];
          const price =
            row && typeof row.usdPrice === "number" && Number.isFinite(row.usdPrice)
              ? row.usdPrice
              : null;
          const pc =
            row && typeof row.priceChange24h === "number" && Number.isFinite(row.priceChange24h)
              ? row.priceChange24h
              : null;
          cache.set(m, {
            price,
            confidence: row?.confidenceLevel ?? null,
            priceChange24h: pc,
            asOf: now
          });
        }
      } catch (e) {
        console.warn("[priceService chunk]", e);
        for (const m of chunk) {
          if (!cache.has(m)) {
            cache.set(m, { price: null, confidence: null, priceChange24h: null, asOf: now });
          }
        }
      }
    }
  }

  const prices: PriceResult["prices"] = {};
  const staleMints: string[] = [];
  let oldestAsOf = now;
  for (const mint of mints) {
    const c = cache.get(mint);
    if (!c) {
      prices[mint] = { price: null, confidence: null, priceChange24h: null };
      staleMints.push(mint);
      continue;
    }
    prices[mint] = {
      price: c.price,
      confidence: c.confidence,
      priceChange24h: c.priceChange24h
    };
    if (c.asOf < oldestAsOf) oldestAsOf = c.asOf;
    if (now - c.asOf > PRICE_TTL_MS) staleMints.push(mint);
  }

  return { prices, asOf: oldestAsOf, staleMints };
}
