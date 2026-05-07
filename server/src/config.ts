/** Runtime configuration (no secrets). */

export type DemutualNetwork = "mainnet" | "devnet";

export function demutualNetwork(): DemutualNetwork {
  const n = process.env.DEMUTUAL_NETWORK?.trim().toLowerCase();
  return n === "devnet" ? "devnet" : "mainnet";
}

export function isDevnet(): boolean {
  return demutualNetwork() === "devnet";
}

export function serverPort(): number {
  const p = Number(process.env.PORT);
  return Number.isFinite(p) && p > 0 && p < 65536 ? p : 3000;
}

/** CORS: comma-separated exact origins, or default localhost regexes. */
export function corsOrigins(): (string | RegExp)[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [
    /^https?:\/\/localhost(?::\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
    /^https?:\/\/\[::1\](?::\d+)?$/
  ];
}

function bpsFromEnv(name: string): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1500);
}

/** Basis points of the gross SOL amount routed as protocol fee on Jupiter swaps. 0 disables. */
export function platformFeeBps(): number {
  return bpsFromEnv("PLATFORM_FEE_BPS");
}

/** Basis points routed to the bucket creator on each Jupiter swap. 0 disables. */
export function creatorFeeBps(): number {
  return bpsFromEnv("CREATOR_FEE_BPS");
}

/** Public wallet that receives the protocol fee transfer signed by the investor. Never has its private key on this server. */
export function platformFeeWallet(): string | null {
  return process.env.PLATFORM_FEE_WALLET_PUBKEY?.trim() || null;
}

export function platformFeeActive(): boolean {
  return platformFeeBps() > 0 && platformFeeWallet() !== null;
}

export function creatorFeeActive(): boolean {
  return creatorFeeBps() > 0;
}

export function anyFeeActive(): boolean {
  return platformFeeActive() || creatorFeeActive();
}

export function publicServiceInfo() {
  const network = demutualNetwork();
  const treasury = process.env.INVEST_TREASURY_PUBKEY?.trim() || null;
  return {
    network,
    /** Devnet-only destination for SOL→treasury demo invests; the matching private key is NOT on this server. */
    investTreasuryPubkey: network === "devnet" ? treasury : null,
    treasurySolInvestConfigured: network === "devnet" && Boolean(process.env.SOLANA_RPC_URL?.trim() && treasury),
    treasuryInvestEnabled: network === "devnet",
    solanaRpcConfigured: Boolean(process.env.SOLANA_RPC_URL?.trim()),
    jupiterApiHost: process.env.JUPITER_API_HOST?.trim() || "https://quote-api.jup.ag",
    /** True when this server can build Jupiter buy/sell plans (mainnet only). */
    jupiterEnabled: network === "mainnet",
    /** Platform fee surfaced so the client knows whether to ask the wallet to sign a fee transfer. */
    platformFeeBps: platformFeeBps(),
    platformFeeWalletPubkey: platformFeeActive() ? platformFeeWallet() : null,
    creatorFeeBps: creatorFeeBps()
  };
}
