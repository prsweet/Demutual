/**
 * Jupiter Tokens v2 wrapper.
 *
 * Spec: GET https://api.jup.ag/tokens/v2/search?query=<mints csv, max 100>
 * Returns array of token objects. We surface `isVerified`, `audit.isSus`, `organicScore`
 * so the UI can show educational badges (esp. for new-to-crypto users).
 *
 * Cached in memory with a longer TTL than prices — verification status doesn't change
 * minute to minute, but it can be updated by Jupiter, so we don't pin it forever.
 */

const TOKEN_INFO_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TOKENS_HOST = "https://api.jup.ag";

/** Cached at module load — avoids process.env read + .trim() on every token info fetch. */
const JUPITER_API_KEY = process.env.JUPITER_API_KEY?.trim() || null;

export type TokenInfo = {
  mint: string;
  name: string | null;
  symbol: string | null;
  iconUrl: string | null;
  decimals: number | null;
  isVerified: boolean;
  /** Derived: not verified AND has at least one risk signal (mint/freeze still on, or extreme concentration). */
  isSus: boolean;
  /** Raw 0–100 number from Jupiter, when available. */
  organicScore: number | null;
  /** Human-readable bucket: "high" / "medium" / "low" (Jupiter's own labelling). */
  organicScoreLabel: string | null;
  tags: string[];
};

type CacheEntry = TokenInfo & { asOf: number };

const cache = new Map<string, CacheEntry>();

function readBool(v: unknown): boolean {
  return v === true;
}

function readNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/**
 * Defensive parse — Jupiter's token v2 shape has evolved across versions, so we only
 * pull the fields we use and fall back to null when missing.
 *
 * `isSus` is derived (Jupiter does not return a boolean): we flag tokens that aren't
 * verified AND still have risky on-chain state — mint authority enabled (supply can grow),
 * freeze authority enabled (accounts can be frozen), or extreme top-holder concentration.
 */
const TOP_HOLDERS_SUS_THRESHOLD_PCT = 60;

function parseTokenRow(row: unknown): Omit<TokenInfo, "mint"> | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const audit = (r.audit as Record<string, unknown> | undefined) ?? {};
  const tags = Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t) => typeof t === "string") as string[] : [];
  const isVerified = readBool(r.isVerified) || tags.includes("verified") || tags.includes("strict");

  const mintAuthorityDisabled = readBool(audit.mintAuthorityDisabled);
  const freezeAuthorityDisabled = readBool(audit.freezeAuthorityDisabled);
  const topHolders = readNumber(audit.topHoldersPercentage) ?? 0;
  const riskSignals =
    !mintAuthorityDisabled ||
    !freezeAuthorityDisabled ||
    topHolders > TOP_HOLDERS_SUS_THRESHOLD_PCT;
  const isSus = !isVerified && riskSignals;

  return {
    name: readString(r.name),
    symbol: readString(r.symbol),
    iconUrl: readString(r.icon),
    decimals: readNumber(r.decimals),
    isVerified,
    isSus,
    organicScore: readNumber(r.organicScore),
    organicScoreLabel: readString(r.organicScoreLabel),
    tags
  };
}

export type TokenInfoResult = {
  tokens: Record<string, TokenInfo | null>;
  asOf: number;
  staleMints: string[];
};

export async function getTokenInfo(rawMints: string[]): Promise<TokenInfoResult> {
  const mints = Array.from(
    new Set(rawMints.map((m) => m.trim()).filter((m) => m.length > 0))
  );
  if (mints.length === 0) return { tokens: {}, asOf: Date.now(), staleMints: [] };

  const now = Date.now();
  const need: string[] = [];
  for (const mint of mints) {
    const cached = cache.get(mint);
    if (!cached || now - cached.asOf > TOKEN_INFO_TTL_MS) need.push(mint);
  }

  if (need.length > 0) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (JUPITER_API_KEY) headers["x-api-key"] = JUPITER_API_KEY;

    const chunkCount = Math.ceil(need.length / 100);
    const results = await Promise.allSettled(
      Array.from({ length: chunkCount }, async (_, i) => {
        const chunk = need.slice(i * 100, i * 100 + 100);
        const u = new URL(`${TOKENS_HOST}/tokens/v2/search`);
        u.searchParams.set("query", chunk.join(","));
        const res = await fetch(u.toString(), { headers });
        if (!res.ok) {
          for (const m of chunk) {
            if (!cache.has(m)) {
              cache.set(m, {
                mint: m, name: null, symbol: null, iconUrl: null, decimals: null,
                isVerified: false, isSus: false, organicScore: null, organicScoreLabel: null,
                tags: [], asOf: now
              });
            }
          }
          return;
        }
        const body = (await res.json()) as unknown;
        const rows = Array.isArray(body) ? body : [];
        const byMint = new Map<string, Omit<TokenInfo, "mint">>();
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          const r = row as Record<string, unknown>;
          const id = readString(r.id) ?? readString(r.address) ?? readString(r.mint);
          if (!id) continue;
          const parsed = parseTokenRow(row);
          if (parsed) byMint.set(id, parsed);
        }
        for (const m of chunk) {
          const parsed = byMint.get(m);
          cache.set(m, {
            mint: m,
            asOf: now,
            ...(parsed ?? {
              name: null, symbol: null, iconUrl: null, decimals: null,
              isVerified: false, isSus: false, organicScore: null, organicScoreLabel: null,
              tags: []
            })
          });
        }
      })
    );
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn("[tokenInfoService] chunk failed", r.reason);
      }
    }
  }

  const tokens: Record<string, TokenInfo | null> = {};
  const staleMints: string[] = [];
  let oldestAsOf = now;
  for (const mint of mints) {
    const c = cache.get(mint);
    if (!c) {
      tokens[mint] = null;
      staleMints.push(mint);
      continue;
    }
    const { asOf, ...info } = c;
    tokens[mint] = info;
    if (asOf < oldestAsOf) oldestAsOf = asOf;
    if (now - asOf > TOKEN_INFO_TTL_MS) staleMints.push(mint);
  }
  return { tokens, asOf: oldestAsOf, staleMints };
}
