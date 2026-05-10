/** Solana RPC for devnet treasury invest + airdrop client-side confirmation */
export function getSolanaRpcUrl(): string {
  const v =
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.BUN_PUBLIC_SOLANA_RPC_URL;
  return (v || "https://api.devnet.solana.com").replace(/\/$/, "");
}

/** Submit Jupiter swaps here — must match cluster Jupiter quotes (usually mainnet-beta) */
export function getJupiterSubmitRpcUrl(): string {
  const v =
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.BUN_PUBLIC_SOLANA_JUPITER_RPC_URL;
  return (v || "https://api.mainnet-beta.solana.com").replace(/\/$/, "");
}

const TREASURY_LS = "demutual_invest_treasury";

export function getTreasuryOverrideFromEnv(): string {
  const v =
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.BUN_PUBLIC_INVEST_TREASURY_PUBKEY;
  return (v || "").trim();
}

export function getTreasuryFromStorage(): string {
  if (typeof localStorage === "undefined") return "";
  return (localStorage.getItem(TREASURY_LS) || "").trim();
}

export function setTreasuryInStorage(pubkey: string): void {
  localStorage.setItem(TREASURY_LS, pubkey.trim());
}

export function resolveTreasuryPubkey(serverTreasury: string | null | undefined): string {
  const fromServer = (serverTreasury || "").trim();
  if (fromServer) return fromServer;
  const fromInput = getTreasuryFromStorage();
  if (fromInput) return fromInput;
  return getTreasuryOverrideFromEnv();
}
