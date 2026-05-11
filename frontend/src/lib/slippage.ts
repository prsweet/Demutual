/**
 * Tier-aware slippage recommender for basket swaps.
 *
 * Slippage is the max % difference between the price the user saw and the price the swap
 * settles at. Set it too low and the wallet rejects the swap because the route's actual
 * output drops below the floor by the time it executes. Set it too high and the user
 * eats a worse fill. The right floor depends on what's in the basket — stable-to-stable
 * is tight, memecoin-to-SOL is wide.
 */

import type { TokenInfo } from "./api";

export type RiskTier = "stable" | "lst" | "token" | "meme";

/** Well-known memecoin mints on Solana. Jupiter doesn't have a "meme" tag, so we curate. */
const MEME_MINTS: ReadonlySet<string> = new Set([
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", // WIF
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", // POPCAT
  "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", // MEW
  "WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk", // WEN
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN" // TRUMP
]);

const TIER_RANK: Record<RiskTier, number> = {
  stable: 0,
  lst: 1,
  token: 2,
  meme: 3
};

const TIER_LABEL: Record<RiskTier, string> = {
  stable: "Stable",
  lst: "LST",
  token: "Standard",
  meme: "Memecoin"
};

/** Recommended slippage in bps for each tier. Conservative end of common DEX defaults. */
const RECOMMENDED_BPS: Record<RiskTier, number> = {
  stable: 30,
  lst: 50,
  token: 100,
  meme: 250
};

export function classifyTier(mint: string, tags: string[] | null | undefined): RiskTier {
  if (MEME_MINTS.has(mint)) return "meme";
  const t = tags ?? [];
  if (t.includes("stable")) return "stable";
  if (t.includes("lst")) return "lst";
  return "token";
}

export type SlippageRecommendation = {
  tier: RiskTier;
  bps: number;
  /** Symbols that drove the recommendation (the ones in the highest tier). */
  reasonSymbols: string[];
  /** One-line reason, ready to render. */
  reason: string;
};

/**
 * Look at every listing in the basket, classify by tier, take the max tier, and
 * recommend the slippage for that tier. The returned `reason` is a short string
 * ready to drop into the UI ("Contains BONK, a volatile token", etc.).
 */
export function recommendSlippageForBasket(
  listings: { assetId: string; symbol: string | null }[],
  tokenInfo: Record<string, TokenInfo | null>
): SlippageRecommendation {
  let maxTier: RiskTier = "stable";
  let reasonSymbols: string[] = [];

  for (const l of listings) {
    const tags = tokenInfo[l.assetId]?.tags ?? null;
    const tier = classifyTier(l.assetId, tags);
    const sym = l.symbol ?? l.assetId.slice(0, 4);
    if (TIER_RANK[tier] > TIER_RANK[maxTier]) {
      maxTier = tier;
      reasonSymbols = [sym];
    } else if (tier === maxTier) {
      reasonSymbols.push(sym);
    }
  }

  const symbolList = reasonSymbols.slice(0, 3).join(", ");
  const more = reasonSymbols.length > 3 ? ` and ${reasonSymbols.length - 3} more` : "";

  let reason: string;
  switch (maxTier) {
    case "stable":
      reason = "All stablecoins, so prices barely move. A tight allowance is fine.";
      break;
    case "lst":
      reason = `These are Solana-staking tokens (${symbolList}${more}) — their prices follow SOL closely, so small movements only.`;
      break;
    case "meme":
      reason = `Includes ${symbolList}${more} — memecoins can swing 5–20% in minutes, so we leave room for the trade to complete.`;
      break;
    default:
      reason = `Mix of regular tokens (${symbolList}${more}). Prices move at a normal pace.`;
  }

  return {
    tier: maxTier,
    bps: RECOMMENDED_BPS[maxTier],
    reasonSymbols,
    reason
  };
}

export const SLIPPAGE_PRESETS: { label: string; tier: RiskTier; bps: number }[] = [
  { label: TIER_LABEL.stable, tier: "stable", bps: RECOMMENDED_BPS.stable },
  { label: TIER_LABEL.token, tier: "token", bps: RECOMMENDED_BPS.token },
  { label: TIER_LABEL.meme, tier: "meme", bps: RECOMMENDED_BPS.meme }
];

export function bpsToPercentString(bps: number): string {
  return (bps / 100).toFixed(2);
}

export function percentStringToBps(percent: string): number | null {
  const n = parseFloat(percent);
  if (!Number.isFinite(n) || n < 0) return null;
  // Cap at 50% — anything beyond that is a misclick.
  const clamped = Math.min(n, 50);
  return Math.round(clamped * 100);
}
