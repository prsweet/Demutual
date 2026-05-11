/**
 * Display overrides for tokens where the on-chain SPL name is technically accurate but
 * confusing to mainstream users. WSOL is the canonical example: the SPL mint is literally
 * "Wrapped SOL", but every wallet / DEX UI presents it as "Solana" because Jupiter wraps
 * and unwraps native SOL automatically during swaps — users never hold WSOL as a balance.
 *
 * Source-of-truth fields (mint, decimals, swaps) keep using the real value. This only
 * affects what the user reads.
 */

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

const OVERRIDES: Record<string, { name: string; symbol: string }> = {
  [WSOL_MINT]: { name: "Solana", symbol: "SOL" }
};

export function displayTokenName(mint: string, fallback: string | null | undefined): string | null {
  return OVERRIDES[mint]?.name ?? fallback ?? null;
}

export function displayTokenSymbol(mint: string, fallback: string | null | undefined): string | null {
  return OVERRIDES[mint]?.symbol ?? fallback ?? null;
}
