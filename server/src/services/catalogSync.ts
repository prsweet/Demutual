/**
 * Bootstrap the token catalog from Jupiter Tokens v2. One source of truth — no static
 * fallbacks, no per-mint overrides. We pull the full verified set, store it in memory
 * (so /assets/catalog is a constant-time map read), and upsert into the `Asset` table
 * so existing bucket listings keep their metadata across server restarts.
 *
 * Run on first /assets/catalog request (lazy bootstrap) and via POST /assets/sync-catalog
 * (manual refresh). Idempotent — re-running just upserts the latest snapshot.
 */

import type { CatalogAsset, CatalogCategory } from "../constants/tokenCatalog";
import { setCatalogTokens } from "../constants/tokenCatalog";
import { prisma } from "../db";

const JUPITER_VERIFIED_URL = "https://api.jup.ag/tokens/v2/tag?query=verified";

export type CatalogSyncResult = {
  fetched: number;
  inMemory: number;
  upsertedToDb: number;
  errors: { id: string; reason: string }[];
};

type RawTokenRow = {
  id?: unknown;
  name?: unknown;
  symbol?: unknown;
  icon?: unknown;
  decimals?: unknown;
  tags?: unknown;
  isVerified?: unknown;
  audit?: unknown;
  organicScore?: unknown;
  organicScoreLabel?: unknown;
  mcap?: unknown;
  fdv?: unknown;
  usdPrice?: unknown;
};

function readString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
function readNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function readBool(v: unknown): boolean {
  return v === true;
}

function deriveCategory(tags: string[]): CatalogCategory {
  if (tags.includes("lst")) return "yield";
  if (tags.includes("stable")) return "stablecoin";
  return "token";
}

const TOP_HOLDERS_SUS_THRESHOLD_PCT = 60;

function parseRow(raw: RawTokenRow): {
  asset: CatalogAsset;
  isVerified: boolean;
  isSus: boolean;
  organicScore: number | null;
  organicScoreLabel: string | null;
  tags: string[];
} | null {
  const id = readString(raw.id);
  if (!id) return null;
  const symbol = readString(raw.symbol) ?? id.slice(0, 6);
  const name = readString(raw.name) ?? symbol;
  const iconUrl = readString(raw.icon) ?? "";
  const decimals = readNumber(raw.decimals) ?? 9;
  const tags = Array.isArray(raw.tags)
    ? (raw.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const isVerified = readBool(raw.isVerified) || tags.includes("verified") || tags.includes("strict");
  const audit = (raw.audit as Record<string, unknown> | undefined) ?? {};
  const mintAuthOff = readBool(audit.mintAuthorityDisabled);
  const freezeAuthOff = readBool(audit.freezeAuthorityDisabled);
  const topHolders = readNumber(audit.topHoldersPercentage) ?? 0;
  const isSus =
    !isVerified &&
    (!mintAuthOff || !freezeAuthOff || topHolders > TOP_HOLDERS_SUS_THRESHOLD_PCT);

  const mcap = readNumber(raw.mcap) ?? readNumber(raw.fdv) ?? undefined;
  const usdPrice = readNumber(raw.usdPrice) ?? undefined;

  return {
    asset: {
      id,
      name,
      symbol,
      iconUrl,
      decimals,
      category: deriveCategory(tags),
      ...(mcap !== undefined ? { mcap } : {}),
      ...(usdPrice !== undefined ? { usdPrice } : {})
    },
    isVerified,
    isSus,
    organicScore: readNumber(raw.organicScore),
    organicScoreLabel: readString(raw.organicScoreLabel),
    tags
  };
}

/** Idempotency / coalescence: concurrent first-callers share a single in-flight bootstrap. */
let inflight: Promise<CatalogSyncResult> | null = null;

export async function bootstrapCatalogFromJupiter(): Promise<CatalogSyncResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = process.env.JUPITER_API_KEY?.trim();
    if (key) headers["x-api-key"] = key;

    const result: CatalogSyncResult = {
      fetched: 0,
      inMemory: 0,
      upsertedToDb: 0,
      errors: []
    };

    type Parsed = NonNullable<ReturnType<typeof parseRow>>;
    let parsed: Parsed[] = [];
    try {
      const res = await fetch(JUPITER_VERIFIED_URL, { headers });
      if (!res.ok) {
        throw new Error(`JUPITER_TAG_HTTP_${res.status}`);
      }
      const body = (await res.json()) as unknown;
      const rows = Array.isArray(body) ? (body as RawTokenRow[]) : [];
      result.fetched = rows.length;
      parsed = rows
        .map((r) => parseRow(r))
        .filter((p): p is Parsed => p !== null);
    } catch (e) {
      console.warn("[catalogSync] Jupiter fetch failed", e);
      result.errors.push({ id: "JUPITER_TAG", reason: e instanceof Error ? e.message : String(e) });
      // Fall through — we may still have in-memory data from a previous successful boot.
      return result;
    }

    setCatalogTokens(parsed.map((p) => p.asset));
    result.inMemory = parsed.length;

    // Persist to DB so existing bucket listings keep working across restarts even if Jupiter is down.
    // Skip silently on DB errors — in-memory is still usable.
    const now = new Date();
    for (const p of parsed) {
      try {
        await prisma.asset.upsert({
          where: { id: p.asset.id },
          create: {
            id: p.asset.id,
            name: p.asset.name,
            symbol: p.asset.symbol,
            iconUrl: p.asset.iconUrl,
            decimals: p.asset.decimals,
            category: p.asset.category,
            inCatalog: true,
            isVerified: p.isVerified,
            isSus: p.isSus,
            organicScore: p.organicScore,
            organicScoreLabel: p.organicScoreLabel,
            tags: p.tags as unknown as object,
            lastSyncedAt: now
          },
          update: {
            name: p.asset.name,
            symbol: p.asset.symbol,
            iconUrl: p.asset.iconUrl,
            decimals: p.asset.decimals,
            category: p.asset.category,
            inCatalog: true,
            isVerified: p.isVerified,
            isSus: p.isSus,
            organicScore: p.organicScore,
            organicScoreLabel: p.organicScoreLabel,
            tags: p.tags as unknown as object,
            lastSyncedAt: now
          }
        });
        result.upsertedToDb += 1;
      } catch (e) {
        result.errors.push({
          id: p.asset.id,
          reason: e instanceof Error ? e.message : String(e)
        });
      }
    }

    return result;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Lazy bootstrap — runs the sync once, or returns immediately if the catalog is already populated. */
export async function ensureCatalogReady(): Promise<void> {
  const { isCatalogBootstrapped } = await import("../constants/tokenCatalog");
  if (isCatalogBootstrapped()) return;
  await bootstrapCatalogFromJupiter();
}
