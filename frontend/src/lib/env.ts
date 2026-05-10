/** Solana RPC for devnet treasury invest + airdrop client-side confirmation */
export function getSolanaRpcUrl(): string {
  const fromLs = getRpcOverrideFromStorage(SOLANA_RPC_LS);
  if (fromLs) return fromLs;
  const v =
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.BUN_PUBLIC_SOLANA_RPC_URL;
  return (v || "https://api.devnet.solana.com").replace(/\/$/, "");
}

/** Submit Jupiter swaps here — must match cluster Jupiter quotes (usually mainnet-beta) */
export function getJupiterSubmitRpcUrl(): string {
  const fromLs = getRpcOverrideFromStorage(JUPITER_RPC_LS);
  if (fromLs) return fromLs;
  const v =
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.BUN_PUBLIC_SOLANA_JUPITER_RPC_URL;
  // Use a browser-friendly public RPC as a fallback (some providers/ISPs block api.mainnet-beta with 403s).
  return (v || "https://rpc.ankr.com/solana").replace(/\/$/, "");
}

const SOLANA_RPC_LS = "demutual_solana_rpc_url";
const JUPITER_RPC_LS = "demutual_jupiter_rpc_url";

function getRpcOverrideFromStorage(key: string): string {
  if (typeof localStorage === "undefined") return "";
  const raw = (localStorage.getItem(key) || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function setJupiterSubmitRpcUrlOverride(url: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(JUPITER_RPC_LS, url.trim());
}

export function clearJupiterSubmitRpcUrlOverride(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(JUPITER_RPC_LS);
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
