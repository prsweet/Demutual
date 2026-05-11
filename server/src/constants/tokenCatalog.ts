/**
 * Token catalog — Jupiter Tokens v2 (verified set) is the single source of truth.
 *
 * On server boot (or first /assets/catalog request) we fetch the entire Jupiter verified
 * token list, parse it into `CatalogAsset` rows, store in-memory in `catalogStore`, and
 * upsert to the `Asset` table for persistence. Buckets reference assets by mint, so the
 * DB rows survive restarts even if Jupiter is briefly unreachable.
 *
 * No hand-curated arrays, no GitHub fallback URLs, no per-mint overrides. If Jupiter
 * needs a correction, fix it upstream — that's where the rest of the ecosystem reads it.
 */

export type CatalogCategory = "stablecoin" | "yield" | "token" | "nft";

export type CatalogAsset = {
  id: string;
  name: string;
  symbol: string;
  iconUrl: string;
  decimals: number;
  category: CatalogCategory;
  /** Jupiter market cap (USD). Used to rank the per-category default view. Missing for unranked tokens. */
  mcap?: number;
  /** Jupiter USD spot. Display-only; never use for safety math. */
  usdPrice?: number;
};

/** Display order for UI sections */
export const CATALOG_CATEGORY_ORDER: CatalogCategory[] = ["stablecoin", "yield", "token", "nft"];

export const CATALOG_CATEGORY_LABEL: Record<CatalogCategory, string> = {
  stablecoin: "Stablecoins & cash-like",
  yield: "Yield & liquid staking (LSTs)",
  token: "Tokens & DeFi",
  nft: "NFT & collectible SPL (0-supply / project coins)"
};

/** In-memory catalog populated by `bootstrapCatalogFromJupiter()`. Keyed by mint. */
const catalogStore = new Map<string, CatalogAsset>();
let bootstrapped = false;

export function setCatalogTokens(rows: CatalogAsset[]): void {
  catalogStore.clear();
  for (const r of rows) catalogStore.set(r.id, r);
  bootstrapped = rows.length > 0;
}

export function getCatalogToken(mint: string): CatalogAsset | null {
  return catalogStore.get(mint) ?? null;
}

export function getCatalogTokens(): CatalogAsset[] {
  return Array.from(catalogStore.values());
}

export function catalogSize(): number {
  return catalogStore.size;
}

export function isCatalogBootstrapped(): boolean {
  return bootstrapped;
}
