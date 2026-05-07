/**
 * Execution routing for “buy this asset on behalf of the investor after they sign”.
 * Jupiter covers most SPL swaps; extend with LST / NFT / lending builders later.
 */

export type ExecutionProvider = "jupiter-swap" | "lst-protocol" | "nft-marketplace" | "manual";

export type AssetExecutionProfile = {
  /** Mint this profile applies to (SPL mint address). */
  mint: string;
  provider: ExecutionProvider;
  /** Optional notes for operators (e.g. “use Sanctum API”, “Tensor v1”). */
  notes?: string;
};

/** Default: anything not listed falls back to Jupiter for fungible swaps from SOL. */
export const EXECUTION_OVERRIDES: AssetExecutionProfile[] = [
  {
    mint: "So11111111111111111111111111111111111111112",
    provider: "manual",
    notes: "Native SOL / wSOL — no swap leg when bucket is all SOL."
  }
];

export function executionProviderForMint(mint: string): ExecutionProvider {
  const hit = EXECUTION_OVERRIDES.find((p) => p.mint === mint);
  if (hit) return hit.provider;
  return "jupiter-swap";
}
