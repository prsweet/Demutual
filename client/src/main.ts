import "./polyfills";
import bs58 from "bs58";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction
} from "@solana/web3.js";

const API = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
/** Must match server `SOLANA_RPC_URL` (devnet for demos). */
const SOLANA_RPC = (import.meta.env.VITE_SOLANA_RPC_URL ?? "https://api.devnet.solana.com").replace(/\/+$/, "");
/** Submit & confirm Jupiter swaps here — mainnet by default (Jupiter quotes target mainnet pools). */
const SOLANA_JUPITER_RPC = (
  import.meta.env.VITE_SOLANA_JUPITER_RPC_URL ?? "https://api.mainnet-beta.solana.com"
).replace(/\/+$/, "");
/** Devnet treasury that receives gross SOL; must match server `INVEST_TREASURY_PUBKEY`. */
const INVEST_TREASURY = String(import.meta.env.VITE_INVEST_TREASURY_PUBKEY ?? "").trim();

const TREASURY_LS_KEY = "demutual_invest_treasury";

function defaultInvestTreasuryField(): string {
  return (localStorage.getItem(TREASURY_LS_KEY) ?? INVEST_TREASURY).trim();
}

/**
 * Treasury pubkey resolution (single source of truth → fallback chain):
 *  1. Server `/` → `config.investTreasuryPubkey` (authoritative; matches server verifier).
 *  2. Manual paste box (legacy dev fallback when no server is reachable).
 *  3. localStorage cache of last paste.
 *  4. Vite build-time env `VITE_INVEST_TREASURY_PUBKEY`.
 */
function serverTreasury(): string {
  return state.serverInfo?.investTreasuryPubkey?.trim() ?? "";
}

function treasuryForInvest(): string {
  const fromServer = serverTreasury();
  if (fromServer) return fromServer;
  const el = document.getElementById("invest-treasury") as HTMLInputElement | null;
  const fromInput = el?.value?.trim() ?? "";
  if (fromInput) {
    localStorage.setItem(TREASURY_LS_KEY, fromInput);
    return fromInput;
  }
  const ls = localStorage.getItem(TREASURY_LS_KEY)?.trim() ?? "";
  if (ls) return ls;
  return INVEST_TREASURY;
}

function hasTreasuryConfigured(): boolean {
  return Boolean(serverTreasury() || defaultInvestTreasuryField());
}

const BACKPACK_CONNECT_MS = 60_000;

type ApiOk<T> = { success: true; data: T; error: null };
type ApiErr = { success: false; data: null; error: string };
type ApiRes<T> = ApiOk<T> | ApiErr;

type WalletKind = "phantom" | "backpack";

/** Minimal shape shared by Phantom + Backpack injected providers (see @solana/wallet-adapter-backpack). */
interface InjectedSolanaWallet {
  isPhantom?: boolean;
  isBackpack?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<unknown>;
  publicKey?: { toBytes(): Uint8Array; toBase58?: () => string; toString: () => string };
  signMessage(message: Uint8Array, second?: unknown): Promise<Uint8Array | { signature: Uint8Array } | string>;
  signTransaction?(transaction: Transaction): Promise<Transaction>;
  signAndSendTransaction?(transaction: Transaction, connection: Connection): Promise<{ signature: string }>;
  sendTransaction?(transaction: Transaction, connection: Connection, opts?: { preflightCommitment?: string }): Promise<string>;
}

declare global {
  interface Window {
    solana?: InjectedSolanaWallet;
    backpack?: InjectedSolanaWallet;
  }
}

function pubkeyToAddress(pk: NonNullable<InjectedSolanaWallet["publicKey"]>): string {
  if (typeof pk.toBase58 === "function") return pk.toBase58();
  const s = pk.toString();
  if (s) return s;
  return bs58.encode(pk.toBytes());
}

function normalizeSignature(sig: Uint8Array | { signature: Uint8Array } | string): string {
  if (typeof sig === "string") return sig;
  if (sig instanceof Uint8Array) return bs58.encode(sig);
  return bs58.encode(sig.signature);
}

/**
 * Resolve Backpack’s Solana provider (`ProviderSolanaInjection` on `window.backpack`).
 * Some builds nest under `.solana`; Phantom must not be mistaken for Backpack.
 */
function getBackpackProvider(): InjectedSolanaWallet | null {
  const raw = window.backpack as unknown;
  if (!raw || typeof raw !== "object") return null;
  const top = raw as InjectedSolanaWallet & { solana?: InjectedSolanaWallet };
  if (typeof top.connect === "function") return top;
  if (top.solana && typeof top.solana.connect === "function") return top.solana;
  return null;
}

function solToLamports(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
  const lamports = Math.round(amount * LAMPORTS_PER_SOL);
  if (lamports <= 0) throw new Error("INVALID_AMOUNT");
  return lamports;
}

/**
 * Backpack often sets `publicKey` after approval while `connect()`'s promise never settles.
 * Poll for `publicKey`, keep `connect()` running in parallel, and refresh the UI so hints show.
 */
async function runBackpackConnect(b: InjectedSolanaWallet): Promise<void> {
  let connectRejected: Error | null = null;
  const connectP = Promise.resolve()
    .then(() => b.connect())
    .catch((e: unknown) => {
      connectRejected = e instanceof Error ? e : new Error(String(e));
    });

  state.err =
    "Waiting for Backpack… Open the extensions puzzle icon → Backpack, unlock if needed, choose Solana, and approve this site.";
  render();

  const start = Date.now();
  let nextLog = 5000;

  while (Date.now() - start < BACKPACK_CONNECT_MS) {
    if (b.publicKey) {
      void connectP;
      state.err = "";
      return;
    }
    if (connectRejected) {
      throw connectRejected;
    }

    const elapsed = Date.now() - start;
    if (elapsed >= nextLog) {
      nextLog += 8000;
      log(
        `Backpack: still waiting (${Math.round(elapsed / 1000)}s) — if no popup appeared, click the Backpack icon in the toolbar and look for “Connect” or site permissions for ${window.location.origin}.`
      );
      render();
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  await connectP.catch(() => {});
  if (connectRejected) throw connectRejected;
  throw new Error(
    "Backpack did not connect in time. In Backpack: Settings → Trusted apps (or similar) and allow this origin, then try again."
  );
}

type CatalogCategory = "stablecoin" | "yield" | "token" | "nft";
type CatalogRow = {
  id: string;
  name: string;
  symbol: string;
  iconUrl: string;
  decimals: number;
  category: CatalogCategory;
};

const CATALOG_SECTION_ORDER: CatalogCategory[] = ["stablecoin", "yield", "token", "nft"];
const CATALOG_SECTION_LABEL: Record<CatalogCategory, string> = {
  stablecoin: "Stablecoins & cash-like",
  yield: "Yield & liquid staking (LSTs)",
  token: "Tokens & DeFi",
  nft: "NFT & collectible SPL"
};

function catalogTableRows(rows: CatalogRow[]): string {
  return rows
    .map(
      (c) => `<tr data-catalog-mint="${escapeAttr(c.id)}">
              <td><input type="checkbox" class="catalog-chk" aria-label="Include ${escapeAttr(c.symbol)}" /></td>
              <td><strong>${escapeHtml(c.symbol)}</strong> · ${escapeHtml(c.name)}</td>
              <td><input type="number" class="catalog-pct" step="0.01" min="0" max="100" placeholder="0" /></td>
            </tr>`
    )
    .join("");
}

function catalogPickerHtml(): string {
  if (state.catalog.length === 0) {
    return `<p class="err">Catalog not loaded. Refresh the page or check the API is running.</p>`;
  }
  const sections = CATALOG_SECTION_ORDER.map((cat) => {
    const rows = state.catalog.filter((r) => r.category === cat);
    if (rows.length === 0) return "";
    return `<section class="catalog-section" data-catalog-section="${cat}">
        <h3 class="catalog-section-title">${escapeHtml(CATALOG_SECTION_LABEL[cat])}</h3>
        <table class="catalog-table">
          <thead><tr><th></th><th>Asset</th><th>%</th></tr></thead>
          <tbody>${catalogTableRows(rows)}</tbody>
        </table>
      </section>`;
  }).join("");
  return `${sections}
        <p class="catalog-sum" id="catalog-sum-line">Selected weights should sum to <strong>100%</strong>.</p>`;
}

type ServerInfo = {
  network?: "mainnet" | "devnet";
  jupiterEnabled?: boolean;
  treasurySolInvestConfigured?: boolean;
  treasuryInvestEnabled?: boolean;
  solanaRpcConfigured?: boolean;
  jupiterApiHost?: string;
  investTreasuryPubkey?: string | null;
  platformFeeBps?: number;
  platformFeeWalletPubkey?: string | null;
  creatorFeeBps?: number;
};

const state = {
  tab: "marketplace" as "marketplace" | "creator" | "portfolio",
  walletKind: (localStorage.getItem("demutual_wallet_kind") as WalletKind | null) ?? null,
  jwt: localStorage.getItem("demutual_jwt"),
  address: "" as string,
  username: localStorage.getItem("demutual_username") ?? "",
  buckets: [] as Record<string, unknown>[],
  bucketDetail: null as Record<string, unknown> | null,
  assets: [] as Record<string, unknown>[],
  catalog: [] as CatalogRow[],
  draftBucketId: localStorage.getItem("demutual_draft_bucket_id") ?? "",
  lastInvestAmount: localStorage.getItem("demutual_invest_amt") ?? "0.01",
  myDeposits: [] as Record<string, unknown>[],
  myPosition: null as Record<string, unknown> | null,
  serverInfo: null as ServerInfo | null,
  log: "",
  err: ""
};

function getConnectedProvider(): InjectedSolanaWallet | null {
  if (state.walletKind === "phantom") {
    const p = window.solana;
    if (p?.isPhantom && p.publicKey) return p;
  }
  if (state.walletKind === "backpack") {
    const b = getBackpackProvider();
    if (b?.publicKey) return b;
  }
  return null;
}

/** Phantom / Backpack should prompt the user to approve the SOL transfer. */
async function walletSendSolTransfer(
  provider: InjectedSolanaWallet,
  connection: Connection,
  tx: Transaction
): Promise<string> {
  const p = provider as InjectedSolanaWallet & {
    signAndSendTransaction?(t: Transaction, c: Connection): Promise<{ signature: string }>;
    sendTransaction?(t: Transaction, c: Connection, o?: { preflightCommitment?: string }): Promise<string>;
    signTransaction?(t: Transaction): Promise<Transaction>;
  };
  if (typeof p.signAndSendTransaction === "function") {
    const out = await p.signAndSendTransaction(tx, connection);
    return out.signature;
  }
  if (typeof p.sendTransaction === "function") {
    return await p.sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
  }
  if (typeof p.signTransaction === "function") {
    const signed = await p.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
    const latest = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      { blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, signature: sig },
      "confirmed"
    );
    return sig;
  }
  throw new Error("WALLET_NO_TRANSACTION_SUPPORT");
}

function b64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signAndSendVersioned(
  provider: InjectedSolanaWallet,
  connection: Connection,
  vtx: VersionedTransaction
): Promise<string> {
  const signer = provider as InjectedSolanaWallet & {
    signTransaction?(tx: VersionedTransaction): Promise<VersionedTransaction>;
  };
  if (typeof signer.signTransaction !== "function") {
    throw new Error("WALLET_NO_SIGN_VERSIONED");
  }
  const signed = await signer.signTransaction(vtx);
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    maxRetries: 3,
    preflightCommitment: "confirmed"
  });
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed"
  );
  return sig;
}

function log(line: string, data?: unknown) {
  const suffix = data !== undefined ? ` ${JSON.stringify(data, null, 2)}` : "";
  state.log = `${new Date().toISOString().slice(11, 19)} ${line}${suffix}\n${state.log}`.slice(0, 8000);
}

const API_ERROR_HINT: Record<string, string> = {
  WALLET_LOGIN_USERNAME_REQUIRED:
    "This wallet is new in Demutual — type a display name in the username field, then click Sign & login again.",
  WALLET_LOGIN_MESSAGE_MUST_CONTAIN_NONCE:
    "Login message did not match the nonce (try again from step 1).",
  INVALID_REQUEST:
    "The server rejected the request format. If this is your first login, add a username. Otherwise refresh the page and reconnect your wallet.",
  INVALID_OR_EXPIRED_NONCE: "Nonce expired or already used — refresh the page and connect again.",
  UNAUTHORIZED: "Session expired — log in again.",
  UNKNOWN_ASSET_ID_USE_CATALOG_OR_REGISTER:
    "One of the mints is not in the catalog and not registered — pick from the list or use Advanced to register a custom asset.",
  BUCKET_CREATOR_REQUIRED: "You can only edit buckets you created — check the draft bucket id matches your account.",
  INVEST_CHAIN_NOT_CONFIGURED:
    "Server missing SOLANA_RPC_URL or INVEST_TREASURY_PUBKEY — add them to server .env and restart.",
  INVEST_TX_NOT_FOUND:
    "Chain could not see the transaction yet — wait a few seconds and try again, or check devnet explorer.",
  INVEST_TX_VERIFICATION_FAILED:
    "Transfer did not match: use the same wallet you logged in with, exact SOL amount, treasury address from env, and Devnet if RPC is Devnet.",
  INVEST_TX_ALREADY_RECORDED: "This transaction was already used to record a deposit.",
  JUPITER_PLAN_FAILED:
    "Jupiter could not build a route (wrong cluster, illiquid pair, or network error). Use mainnet wallet + SOLANA_JUPITER_RPC mainnet.",
  JUPITER_NOTHING_TO_SWAP: "Bucket is 100% SOL — nothing for Jupiter to swap.",
  JUPITER_NOT_AVAILABLE_ON_DEVNET:
    "This server is in devnet mode — Jupiter buy/sell is mainnet only. Use the SOL→treasury invest and the ledger withdraw on devnet, or set DEMUTUAL_NETWORK=mainnet on the server.",
  JUPITER_SELL_PLAN_FAILED:
    "Jupiter could not build a sell route — bucket assets may have low liquidity for the requested amount, or the slippage is too tight.",
  JUPITER_SELL_NOTHING_TO_SWAP: "Bucket is 100% SOL — nothing for Jupiter to sell.",
  SELL_TX_ALREADY_RECORDED: "These sell signatures were already used to record a withdrawal.",
  WITHDRAW_EXCEEDS_POSITION: "That amount is more than your net deposited in this bucket.",
  WITHDRAW_BUCKET_NOT_PUBLISHED: "Withdrawals are only allowed on published buckets.",
  TREASURY_INVEST_DEVNET_ONLY:
    "SOL→treasury invest is disabled on mainnet. Use the Jupiter basket below — the investor wallet swaps directly and tokens land in your wallet.",
  FEE_TRANSFER_SIGNATURE_REQUIRED:
    "The server expects a platform fee transfer signature. Re-run the buy/sell — the wallet will prompt for the fee transfer.",
  FEE_TRANSFER_VERIFICATION_FAILED:
    "Platform fee transfer did not match: same wallet must sign, exact lamports, recipient must equal PLATFORM_FEE_WALLET_PUBKEY.",
  DEVNET_FAUCET_DISABLED: "Server is not in devnet mode — set DEMUTUAL_NETWORK=devnet to enable the faucet.",
  DEVNET_FAUCET_RATE_LIMITED: "Devnet faucet rate-limited — wait a minute and try again."
};

function hintForApiError(code: string): string {
  return API_ERROR_HINT[code] ?? code;
}

async function api<T>(path: string, init?: RequestInit): Promise<ApiRes<T>> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (state.jwt) headers.set("Authorization", `Bearer ${state.jwt}`);
  const r = await fetch(`${API}${path}`, { ...init, headers });
  const j = (await r.json()) as ApiRes<T>;
  if (!j.success) log(`HTTP ${r.status}`, j);
  return j;
}

function setJwt(token: string | null) {
  state.jwt = token;
  if (token) localStorage.setItem("demutual_jwt", token);
  else localStorage.removeItem("demutual_jwt");
}

async function connectWallet(kind: WalletKind) {
  state.err = "";
  state.walletKind = kind;
  localStorage.setItem("demutual_wallet_kind", kind);
  log(kind === "backpack" ? "Backpack: opening connect…" : "Phantom: opening connect…");
  render();
  try {
    if (kind === "phantom") {
      const p = window.solana;
      if (!p?.isPhantom) {
        state.err =
          "Phantom not detected. Install the extension and use a normal browser tab (not Backpack’s in-app browser unless Phantom is available there).";
        render();
        return;
      }
      await p.connect();
      if (!p.publicKey) {
        state.err = "Phantom did not expose a public key.";
        render();
        return;
      }
      state.address = pubkeyToAddress(p.publicKey);
    } else {
      const b = getBackpackProvider();
      if (!b) {
        const hasKey = typeof window.backpack !== "undefined";
        state.err = hasKey
          ? "Backpack is present but does not look like a Solana provider (no connect()). Update the Backpack extension or use Phantom."
          : "Backpack not found on window.backpack. Install https://backpack.app, use Chrome/Brave with the extension enabled for this site, then hard-refresh. If Phantom took over Solana, try Backpack first or another profile.";
        log("Backpack provider missing", { hasWindowBackpack: hasKey });
        render();
        return;
      }
      await runBackpackConnect(b);
      if (!b.publicKey) {
        state.err =
          "Backpack did not expose a Solana public key. Unlock the wallet, select a Solana account, and try again.";
        render();
        return;
      }
      state.address = pubkeyToAddress(b.publicKey);
    }
    log(`Connected (${kind})`, state.address);
  } catch (e) {
    state.err = e instanceof Error ? e.message : "Wallet connection failed.";
  }
  render();
}

async function loginWithWallet() {
  state.err = "";
  if (!state.address || !state.walletKind) {
    state.err = "Connect Phantom or Backpack first.";
    render();
    return;
  }
  const nonceRes = await api<{ nonce: string; message: string; expiresAt: string }>(
    `/auth/nonce?address=${encodeURIComponent(state.address)}`
  );
  if (!nonceRes.success) {
    state.err = hintForApiError(nonceRes.error);
    render();
    return;
  }
  const { nonce, message } = nonceRes.data;
  const encoded = new TextEncoder().encode(message);
  let sig58: string;
  try {
    if (state.walletKind === "phantom") {
      const p = window.solana;
      if (!p?.isPhantom) throw new Error("Phantom disconnected.");
      const out = await p.signMessage(encoded, "utf8");
      const raw = out instanceof Uint8Array ? out : (out as { signature: Uint8Array }).signature;
      sig58 = normalizeSignature(raw);
    } else {
      const b = getBackpackProvider();
      if (!b?.publicKey) throw new Error("Backpack disconnected. Connect again.");
      const { PublicKey } = await import("@solana/web3.js");
      const userPk = new PublicKey(state.address);
      let out: unknown;
      const tries: Array<() => Promise<unknown>> = [
        () => b.signMessage(encoded, userPk),
        () => b.signMessage(encoded, b.publicKey!),
        () => b.signMessage(encoded)
      ];
      let lastErr: unknown;
      for (const run of tries) {
        try {
          out = await run();
          lastErr = undefined;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr !== undefined && out === undefined) {
        throw lastErr instanceof Error ? lastErr : new Error("Backpack signMessage failed.");
      }
      if (out instanceof Uint8Array || typeof out === "string") {
        sig58 = normalizeSignature(out);
      } else if (out && typeof out === "object" && "signature" in out) {
        sig58 = normalizeSignature(out as { signature: Uint8Array });
      } else {
        throw new Error("Backpack returned an unexpected signature shape.");
      }
    }
  } catch (e) {
    state.err = e instanceof Error ? e.message : "Signing failed.";
    render();
    return;
  }

  const body: Record<string, unknown> = {
    address: state.address,
    details: { nonce, message },
    signature: sig58
  };
  if (state.username.trim()) {
    body.username = state.username.trim();
    localStorage.setItem("demutual_username", state.username.trim());
  }

  const loginRes = await api<{ token: string }>("/auth/wallet-login", {
    method: "POST",
    body: JSON.stringify(body)
  });
  if (!loginRes.success) {
    state.err = hintForApiError(loginRes.error);
    render();
    return;
  }
  setJwt(loginRes.data.token);
  log("Logged in");
  await refreshCatalog();
  await refreshAssets();
  await refreshBuckets();
  render();
}

function logout() {
  setJwt(null);
  state.buckets = [];
  state.assets = [];
  state.bucketDetail = null;
  state.myDeposits = [];
  state.myPosition = null;
  state.address = "";
  state.walletKind = null;
  localStorage.removeItem("demutual_wallet_kind");
  log("Logged out");
  render();
}

/** Decode JWT payload for `userId` (UI only; server still verifies). */
function userIdFromJwt(): string {
  if (!state.jwt) return "";
  try {
    const part = state.jwt.split(".")[1];
    if (!part) return "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { userId?: string };
    return json.userId ?? "";
  } catch {
    return "";
  }
}

async function loadServerInfo() {
  try {
    const r = await fetch(`${API}/`);
    const j = (await r.json()) as ApiRes<{ config?: ServerInfo }>;
    if (j.success && j.data?.config) {
      state.serverInfo = j.data.config;
    }
  } catch (e) {
    log("Server info fetch failed", e instanceof Error ? e.message : String(e));
  }
}

function isMainnetServer(): boolean {
  return state.serverInfo?.network === "mainnet";
}

async function refreshBuckets() {
  let path = "/buckets";
  if (state.tab === "creator" && state.jwt) {
    const uid = userIdFromJwt();
    if (uid) path = `/buckets?creatorId=${encodeURIComponent(uid)}`;
  }
  const res = await api<Record<string, unknown>[]>(path);
  if (res.success) {
    state.buckets = res.data;
    log(`Listed buckets (${path})`, res.data.length);
  }
}

async function refreshMyDeposits() {
  if (!state.jwt) return;
  const res = await api<Record<string, unknown>[]>("/users/me/deposits");
  if (res.success) {
    state.myDeposits = res.data;
    log("My deposits loaded", res.data.length);
  }
}

async function loadMyPosition() {
  const id = String((document.getElementById("pos-bucket-id") as HTMLInputElement)?.value ?? "").trim();
  if (!id) {
    state.err = "Enter a bucket id for position.";
    render();
    return;
  }
  const res = await api<Record<string, unknown>>(`/buckets/${encodeURIComponent(id)}/my-position`);
  if (res.success) {
    state.myPosition = res.data;
    state.err = "";
    log("Position loaded", id);
  } else state.err = hintForApiError(res.error);
  render();
}

async function withdrawSubmit(e: Event) {
  e.preventDefault();
  const id = String((document.getElementById("withdraw-bucket-id") as HTMLInputElement)?.value ?? "").trim();
  const amount = Number((document.getElementById("withdraw-amount") as HTMLInputElement)?.value ?? 0);
  if (!id || !amount) {
    state.err = "Withdraw needs bucket id and amount.";
    render();
    return;
  }
  const res = await api<unknown>(`/buckets/${encodeURIComponent(id)}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ amount })
  });
  if (res.success) {
    state.err = "";
    log("Withdraw recorded", res.data);
    await refreshMyDeposits();
    await refreshBuckets();
    const posId = (document.getElementById("pos-bucket-id") as HTMLInputElement)?.value?.trim();
    if (posId === id) await loadMyPosition();
  } else state.err = hintForApiError(res.error);
  render();
}

async function refreshAssets() {
  const res = await api<Record<string, unknown>[]>("/assets");
  if (res.success) {
    state.assets = res.data;
    log("Assets loaded", res.data.length);
  }
}

/** Public — no JWT. Curated tokens users can add to a bucket. */
async function refreshCatalog() {
  try {
    const r = await fetch(`${API}/assets/catalog`);
    const j = (await r.json()) as ApiRes<CatalogRow[]>;
    if (j.success && Array.isArray(j.data)) {
      const cats: CatalogCategory[] = ["stablecoin", "yield", "token", "nft"];
      state.catalog = j.data.map((raw) => {
        const r = raw as Record<string, unknown>;
        const c = r.category;
        const category = (typeof c === "string" && (cats as string[]).includes(c) ? c : "token") as CatalogCategory;
        return {
          id: String(r.id ?? ""),
          name: String(r.name ?? ""),
          symbol: String(r.symbol ?? ""),
          iconUrl: String(r.iconUrl ?? ""),
          decimals: Number(r.decimals ?? 9),
          category
        };
      });
      log("Catalog loaded", state.catalog.length);
    }
  } catch {
    log("Catalog fetch failed", {});
  }
}

async function loadBucketDetail(id: string) {
  const res = await api<Record<string, unknown>>(`/buckets/${encodeURIComponent(id)}`);
  if (res.success) {
    state.bucketDetail = res.data;
    log("Bucket detail", id);
  }
  render();
}

async function registerAsset(e: Event) {
  e.preventDefault();
  const fd = new FormData(e.target as HTMLFormElement);
  const body = {
    id: String(fd.get("id") ?? "").trim(),
    name: String(fd.get("name") ?? "").trim(),
    symbol: String(fd.get("symbol") ?? "").trim(),
    iconUrl: String(fd.get("iconUrl") ?? "").trim(),
    decimals: Number(fd.get("decimals") ?? 9)
  };
  const res = await api<unknown>("/assets", { method: "POST", body: JSON.stringify(body) });
  if (res.success) {
    log("Asset upserted", body.id);
    await refreshAssets();
  } else state.err = res.error;
  render();
}

async function createBucket(e: Event) {
  e.preventDefault();
  const fd = new FormData(e.target as HTMLFormElement);
  const body = {
    name: String(fd.get("name") ?? "").trim(),
    estimatedApy: Number(fd.get("apy") ?? 0)
  };
  const res = await api<Record<string, unknown>>("/buckets", { method: "POST", body: JSON.stringify(body) });
  if (res.success) {
    const id = String(res.data.id);
    state.draftBucketId = id;
    localStorage.setItem("demutual_draft_bucket_id", id);
    log("Draft bucket created", id);
    await refreshBuckets();
  } else state.err = res.error;
  render();
}

function collectListingsFromCatalogUi(): { assetId: string; percentage: number }[] | null {
  const rows = document.querySelectorAll("[data-catalog-mint]");
  const assets: { assetId: string; percentage: number }[] = [];
  rows.forEach((row) => {
    const mint = (row as HTMLElement).dataset.catalogMint;
    if (!mint) return;
    const chk = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    const pctInp = row.querySelector('input.catalog-pct') as HTMLInputElement | null;
    if (!chk?.checked || !pctInp) return;
    const p = Number(pctInp.value);
    if (!Number.isFinite(p) || p <= 0) return;
    assets.push({ assetId: mint, percentage: p });
  });
  if (assets.length === 0) {
    state.err = "Select at least one token and enter a % weight for each.";
    return null;
  }
  const total = assets.reduce((s, a) => s + a.percentage, 0);
  if (Math.abs(total - 100) > 0.0001) {
    state.err = `Weights must sum to 100% (currently ${total.toFixed(2)}%).`;
    return null;
  }
  return assets;
}

async function saveListingsFromCatalog() {
  const id = state.draftBucketId.trim();
  if (!id) {
    state.err = "Create a draft bucket first (or paste its id above).";
    render();
    return;
  }
  const assets = collectListingsFromCatalogUi();
  if (!assets) {
    render();
    return;
  }
  const res = await api<unknown>(`/buckets/${encodeURIComponent(id)}/creator/assets`, {
    method: "POST",
    body: JSON.stringify({ assets })
  });
  if (res.success) {
    state.err = "";
    log("Listings saved (replaces previous)", id);
    await refreshBuckets();
    await loadBucketDetail(id);
  } else state.err = hintForApiError(res.error);
  render();
}

async function saveListingsJson(e: Event) {
  e.preventDefault();
  const id = state.draftBucketId.trim();
  if (!id) {
    state.err = "Set draft bucket id (from create bucket).";
    render();
    return;
  }
  const raw = String((document.getElementById("listings-json") as HTMLTextAreaElement)?.value ?? "");
  let assets: { assetId: string; percentage: number }[];
  try {
    assets = JSON.parse(raw) as { assetId: string; percentage: number }[];
  } catch {
    state.err = "Listings must be valid JSON array: [{\"assetId\":\"...\",\"percentage\":50}, ...]";
    render();
    return;
  }
  const res = await api<unknown>(`/buckets/${encodeURIComponent(id)}/creator/assets`, {
    method: "POST",
    body: JSON.stringify({ assets })
  });
  if (res.success) {
    log("Listings saved (replaces previous)", id);
    await refreshBuckets();
    await loadBucketDetail(id);
  } else state.err = hintForApiError(res.error);
  render();
}

async function publishDraft() {
  const id = state.draftBucketId.trim();
  if (!id) {
    state.err = "No draft bucket id.";
    render();
    return;
  }
  const res = await api<unknown>(`/buckets/${encodeURIComponent(id)}/creator/publish`, {
    method: "POST"
  });
  if (res.success) {
    log("Published", id);
    await refreshBuckets();
    await loadBucketDetail(id);
  } else state.err = res.error;
  render();
}

async function invest(e: Event) {
  e.preventDefault();
  const id = String((document.getElementById("invest-bucket-id") as HTMLInputElement)?.value ?? "").trim();
  const amount = Number((document.getElementById("invest-amount") as HTMLInputElement)?.value ?? 0);
  if (!id || !amount) {
    state.err = "Bucket id and amount required.";
    render();
    return;
  }
  const treasuryPk = treasuryForInvest();
  if (!treasuryPk) {
    state.err =
      "Paste the protocol treasury address below (same base58 as INVEST_TREASURY_PUBKEY in server/.env), or set VITE_INVEST_TREASURY_PUBKEY and restart Vite.";
    render();
    return;
  }
  try {
    new PublicKey(treasuryPk);
  } catch {
    state.err = "Treasury address is not a valid Solana public key (check for typos).";
    render();
    return;
  }
  const provider = getConnectedProvider();
  if (!provider || !state.address) {
    state.err = "Connect your wallet first (same account you used to log in).";
    render();
    return;
  }

  let lamports: number;
  try {
    lamports = solToLamports(amount);
  } catch {
    state.err = "Enter a valid SOL amount (small decimals OK).";
    render();
    return;
  }

  state.err = "Check your wallet — approve the SOL transfer to the protocol treasury.";
  render();

  try {
    const connection = new Connection(SOLANA_RPC, "confirmed");
    const from = new PublicKey(state.address);
    const to = new PublicKey(treasuryPk);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports
      })
    );
    tx.feePayer = from;
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;

    const transactionSignature = await walletSendSolTransfer(provider, connection, tx);
    log("Invest tx signed / sent", transactionSignature);

    const res = await api<unknown>(`/buckets/${encodeURIComponent(id)}/invest`, {
      method: "POST",
      body: JSON.stringify({ amount, transactionSignature })
    });
    if (res.success) {
      state.err = "";
      log("Invest OK (booked after on-chain transfer)", res.data);
      await refreshBuckets();
      await loadBucketDetail(id);
    } else state.err = hintForApiError(res.error);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "WALLET_NO_TRANSACTION_SUPPORT") {
      state.err = "This wallet build does not expose signTransaction / sendTransaction — try Phantom or a current Backpack build.";
    } else {
      state.err = msg;
      log("Invest failed", msg);
    }
  }
  render();
}

type JupiterPlanLeg = {
  kind: string;
  symbol?: string;
  swapTransactionBase64?: string;
};

type FeeSplit = {
  recipient: "platform" | "creator";
  toPubkey: string;
  lamports: number;
  bps: number;
};
type FeeTransfer = { totalLamports: number; splits: FeeSplit[]; reason?: string };

async function signFeeTransfer(
  provider: InjectedSolanaWallet,
  connection: Connection,
  fromAddress: string,
  fee: FeeTransfer
): Promise<string> {
  const from = new PublicKey(fromAddress);
  const tx = new Transaction();
  for (const split of fee.splits) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: new PublicKey(split.toPubkey),
        lamports: split.lamports
      })
    );
  }
  tx.feePayer = from;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  return await walletSendSolTransfer(provider, connection, tx);
}

function describeFee(fee: FeeTransfer): string {
  return fee.splits
    .map((s) => `${(s.lamports / 1e9).toFixed(6)} SOL → ${s.recipient} ${s.toPubkey.slice(0, 6)}…`)
    .join(" + ");
}

async function devnetAirdrop() {
  if (!state.address) {
    state.err = "Connect a wallet first.";
    render();
    return;
  }
  state.err = "Requesting 1 devnet SOL…";
  render();
  try {
    const r = await fetch(
      `${API}/devnet/airdrop?address=${encodeURIComponent(state.address)}&amount=1`
    );
    const j = (await r.json()) as ApiRes<{ signature: string }>;
    if (j.success) {
      state.err = "";
      log("Devnet airdrop", j.data);
    } else {
      state.err = hintForApiError(j.error);
    }
  } catch (e) {
    state.err = e instanceof Error ? e.message : String(e);
  }
  render();
}

async function jupiterBasketSell() {
  const id = String((document.getElementById("sell-bucket-id") as HTMLInputElement)?.value ?? "").trim();
  const amount = Number((document.getElementById("sell-amount") as HTMLInputElement)?.value ?? 0);
  state.err = "";
  if (!id || !amount) {
    state.err = "Set bucket id and SOL target above first.";
    render();
    return;
  }
  const provider = getConnectedProvider();
  if (!provider || !state.address) {
    state.err = "Connect your wallet (same address you used to log in).";
    render();
    return;
  }

  state.err = "Requesting Jupiter sell plan from API…";
  render();

  try {
    const planRes = await api<{
      legs: JupiterPlanLeg[];
      feeTransfer: FeeTransfer | null;
    }>(
      `/buckets/${encodeURIComponent(id)}/sell/jupiter-plan`,
      {
        method: "POST",
        body: JSON.stringify({ solAmount: amount, slippageBps: 80 })
      }
    );

    if (!planRes.success) {
      state.err = hintForApiError(planRes.error);
      render();
      return;
    }

    const swaps = planRes.data.legs.filter(
      (l): l is JupiterPlanLeg & { swapTransactionBase64: string } =>
        l.kind === "swap" && typeof l.swapTransactionBase64 === "string" && l.swapTransactionBase64.length > 0
    );

    if (swaps.length === 0) {
      state.err = "No sell swap legs returned — bucket may be 100% SOL.";
      render();
      return;
    }

    const connection = new Connection(SOLANA_JUPITER_RPC, "confirmed");
    const sigs: string[] = [];

    for (let i = 0; i < swaps.length; i++) {
      const leg = swaps[i]!;
      state.err = `Approve sell ${i + 1}/${swaps.length} (${leg.symbol ?? "token"} → SOL) in your wallet…`;
      render();
      const vtx = VersionedTransaction.deserialize(b64ToUint8Array(leg.swapTransactionBase64));
      const sig = await signAndSendVersioned(provider, connection, vtx);
      sigs.push(sig);
      log(`Jupiter sell leg ${i + 1} confirmed`, sig);
    }

    let feeTransferSignature: string | undefined;
    if (planRes.data.feeTransfer && planRes.data.feeTransfer.splits.length > 0) {
      const fee = planRes.data.feeTransfer;
      state.err = `Approve fee transfer: ${describeFee(fee)}`;
      render();
      feeTransferSignature = await signFeeTransfer(provider, connection, state.address, fee);
      log("Fee transfer (sell) confirmed", feeTransferSignature);
    }

    state.err = "Recording withdrawal…";
    render();

    const done = await api<unknown>(
      `/buckets/${encodeURIComponent(id)}/sell/jupiter-complete`,
      {
        method: "POST",
        body: JSON.stringify({
          solAmount: amount,
          transactionSignatures: sigs,
          ...(feeTransferSignature ? { feeTransferSignature } : {})
        })
      }
    );

    if (done.success) {
      state.err = "";
      log("Jupiter basket sell recorded", done.data);
      await refreshMyDeposits();
      await refreshBuckets();
      const posId = (document.getElementById("pos-bucket-id") as HTMLInputElement)?.value?.trim();
      if (posId === id) await loadMyPosition();
    } else state.err = hintForApiError(done.error);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "WALLET_NO_SIGN_VERSIONED") {
      state.err = "Wallet cannot sign versioned transactions — try Phantom desktop.";
    } else {
      state.err = msg;
      log("Jupiter sell failed", msg);
    }
  }
  render();
}

async function jupiterBasketInvest() {
  const id = String((document.getElementById("invest-bucket-id") as HTMLInputElement)?.value ?? "").trim();
  const amount = Number((document.getElementById("invest-amount") as HTMLInputElement)?.value ?? 0);
  state.err = "";
  if (!id || !amount) {
    state.err = "Set bucket id and SOL amount above first.";
    render();
    return;
  }
  const provider = getConnectedProvider();
  if (!provider || !state.address) {
    state.err = "Connect your wallet (same address you used to log in).";
    render();
    return;
  }

  state.err = "Requesting Jupiter plan from API…";
  render();

  try {
    const planRes = await api<{
      legs: JupiterPlanLeg[];
      feeTransfer: FeeTransfer | null;
    }>(`/buckets/${encodeURIComponent(id)}/invest/jupiter-plan`, {
      method: "POST",
      body: JSON.stringify({ solAmount: amount, slippageBps: 80 })
    });

    if (!planRes.success) {
      state.err = hintForApiError(planRes.error);
      render();
      return;
    }

    const swaps = planRes.data.legs.filter(
      (l): l is JupiterPlanLeg & { swapTransactionBase64: string } =>
        l.kind === "swap" && typeof l.swapTransactionBase64 === "string" && l.swapTransactionBase64.length > 0
    );

    if (swaps.length === 0) {
      state.err = "No swap legs returned — check bucket listings.";
      render();
      return;
    }

    const connection = new Connection(SOLANA_JUPITER_RPC, "confirmed");
    const sigs: string[] = [];

    let feeTransferSignature: string | undefined;
    if (planRes.data.feeTransfer && planRes.data.feeTransfer.splits.length > 0) {
      const fee = planRes.data.feeTransfer;
      state.err = `Approve fee transfer: ${describeFee(fee)}`;
      render();
      feeTransferSignature = await signFeeTransfer(provider, connection, state.address, fee);
      log("Fee transfer confirmed", feeTransferSignature);
    }

    for (let i = 0; i < swaps.length; i++) {
      const leg = swaps[i]!;
      state.err = `Approve swap ${i + 1}/${swaps.length} (${leg.symbol ?? "token"}) in your wallet…`;
      render();
      const vtx = VersionedTransaction.deserialize(b64ToUint8Array(leg.swapTransactionBase64));
      const sig = await signAndSendVersioned(provider, connection, vtx);
      sigs.push(sig);
      log(`Jupiter leg ${i + 1} confirmed`, sig);
    }

    state.err = "Recording deposit…";
    render();

    const done = await api<unknown>(`/buckets/${encodeURIComponent(id)}/invest/jupiter-complete`, {
      method: "POST",
      body: JSON.stringify({
        solAmount: amount,
        transactionSignatures: sigs,
        ...(feeTransferSignature ? { feeTransferSignature } : {})
      })
    });

    if (done.success) {
      state.err = "";
      log("Jupiter basket invest recorded", done.data);
      await refreshBuckets();
      await loadBucketDetail(id);
    } else state.err = hintForApiError(done.error);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "WALLET_NO_SIGN_VERSIONED") {
      state.err = "Wallet cannot sign versioned transactions — try Phantom desktop.";
    } else {
      state.err = msg;
      log("Jupiter basket failed", msg);
    }
  }
  render();
}

function render() {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <header>
      <div>
        <h1>Demutual review UI</h1>
        <div class="badge">API: ${API}</div>
        <div class="badge">Server network: <strong>${escapeHtml(state.serverInfo?.network ?? "unknown")}</strong>${
          state.serverInfo?.jupiterEnabled === false ? " · Jupiter disabled" : ""
        }</div>
        <div class="badge">Solana RPC: ${escapeHtml(SOLANA_RPC)}</div>
        <div class="badge">Jupiter submit RPC: ${escapeHtml(SOLANA_JUPITER_RPC)}</div>
        ${
          (state.serverInfo?.platformFeeBps ?? 0) > 0 || (state.serverInfo?.creatorFeeBps ?? 0) > 0
            ? `<div class="badge">Fees: <strong>${((state.serverInfo!.platformFeeBps ?? 0) / 100).toFixed(2)}%</strong> platform + <strong>${((state.serverInfo!.creatorFeeBps ?? 0) / 100).toFixed(2)}%</strong> creator</div>`
            : ""
        }
        ${
          state.serverInfo?.network === "devnet"
            ? `<div class="badge">${
                hasTreasuryConfigured()
                  ? "Treasury: configured (devnet only)"
                  : "Treasury: missing — set INVEST_TREASURY_PUBKEY on the server"
              }</div>`
            : ""
        }
      </div>
      <div class="row">
        ${
          state.jwt
            ? `<span class="badge">Signed in</span><button class="ghost" type="button" id="btn-logout">Log out</button>`
            : ""
        }
        <button class="primary" type="button" id="btn-connect-phantom">1a. Phantom</button>
        <button class="primary" type="button" id="btn-connect-backpack">1b. Backpack</button>
        <input placeholder="Display name (required on first login)" value="${escapeAttr(state.username)}" id="inp-username" style="max-width:220px;margin:0" />
        <button class="ghost" type="button" id="btn-login" ${state.address ? "" : "disabled"}>2. Sign & login</button>
      </div>
      ${
        state.address
          ? `<div class="badge">Wallet: ${escapeHtml(state.address)}${state.walletKind ? ` · ${escapeHtml(state.walletKind)}` : ""}</div>
          <div class="badge hint">Invest uses real SOL transfers on the RPC above. In Phantom: Settings → Developer Mode → Testnet / Devnet, or switch network to <strong>Devnet</strong> when using the default RPC.</div>`
          : ""
      }
      ${state.err ? `<div class="err">${escapeHtml(state.err)}</div>` : ""}
    </header>

    <div class="tabs">
      <button type="button" class="${state.tab === "marketplace" ? "active" : ""}" data-tab="marketplace">Marketplace</button>
      <button type="button" class="${state.tab === "creator" ? "active" : ""}" data-tab="creator">Creator</button>
      <button type="button" class="${state.tab === "portfolio" ? "active" : ""}" data-tab="portfolio">Portfolio</button>
      <button class="ghost" type="button" id="btn-refresh-buckets">Refresh buckets</button>
    </div>

    ${
      state.tab === "portfolio"
        ? `
      <div class="grid2">
        <div class="panel">
          <h2>My deposits</h2>
          <p class="badge">GET /users/me/deposits</p>
          <button class="ghost" type="button" id="btn-refresh-portfolio" ${state.jwt ? "" : "disabled"}>Refresh</button>
          <ul class="list" style="max-height:280px;overflow:auto">
            ${state.myDeposits
              .map(
                (d) =>
                  `<li><strong>${escapeHtml(String((d.bucket as Record<string, unknown>)?.name ?? "?"))}</strong> · net ${escapeHtml(String(d.amount))} · ${escapeHtml(String(d.createdAt ?? "")).slice(0, 19)}</li>`
              )
              .join("") || `<li class="badge">No deposits yet.</li>`}
          </ul>
        </div>
        <div class="panel">
          <h2>Position &amp; withdraw (ledger)</h2>
          <p class="badge">GET /buckets/:id/my-position · POST /buckets/:id/withdraw — updates TVL in-app; on-chain payout is separate.</p>
          <label>Bucket id</label>
          <input id="pos-bucket-id" class="mono" value="${escapeAttr(state.draftBucketId)}" />
          <button class="ghost" type="button" id="btn-load-position" ${state.jwt ? "" : "disabled"}>Load my position</button>
          <pre class="log">${escapeHtml(JSON.stringify(state.myPosition, null, 2))}</pre>
          <form id="form-withdraw">
            <label>Withdraw — bucket id</label>
            <input id="withdraw-bucket-id" class="mono" value="${escapeAttr(state.draftBucketId)}" />
            <label>Amount (same units as booked deposits)</label>
            <input id="withdraw-amount" type="number" step="any" min="0.000000001" value="1" />
            <button class="primary" type="submit" ${state.jwt ? "" : "disabled"}>Record withdrawal (ledger)</button>
          </form>
        </div>
        <div class="panel">
          <h2>Sell basket via Jupiter (mainnet)</h2>
          <p class="badge hint">ExactOut quotes: each leg pulls the asset from <strong>your</strong> wallet and lands SOL. Use mainnet Phantom + funded wallet. Requires a Jupiter-bought position.</p>
          <label>Bucket id</label>
          <input id="sell-bucket-id" class="mono" value="${escapeAttr(state.draftBucketId)}" />
          <label>SOL target (total SOL you want to receive)</label>
          <input id="sell-amount" type="number" step="any" min="0.000000001" value="0.01" />
          <button class="primary" type="button" id="btn-jupiter-sell" ${
            state.jwt && state.address && isMainnetServer() ? "" : "disabled"
          }>Build sell plan, sign each swap, record withdrawal</button>
          <p class="badge">API: POST /buckets/:id/sell/jupiter-plan → sign N txs on ${escapeHtml(SOLANA_JUPITER_RPC)} → POST /buckets/:id/sell/jupiter-complete</p>
          ${
            !isMainnetServer()
              ? `<p class="err">Server is in <strong>${escapeHtml(state.serverInfo?.network ?? "unknown")}</strong> mode — Jupiter sell is mainnet only.</p>`
              : ""
          }
        </div>
        ${
          state.serverInfo?.network === "devnet"
            ? `<div class="panel">
                <h2>Devnet helpers</h2>
                <p class="badge">GET /devnet/airdrop?address=&amp;amount= — public Solana devnet faucet (rate-limited).</p>
                <button class="ghost" type="button" id="btn-devnet-airdrop" ${state.address ? "" : "disabled"}>Airdrop 1 devnet SOL to my wallet</button>
              </div>`
            : ""
        }
      </div>`
        : state.tab === "marketplace"
        ? `
      <div class="grid2">
        <div class="panel">
          <h2>Published buckets</h2>
          <p class="badge">GET /buckets (no creatorId → PUBLISHED only)</p>
          <ul class="list" id="bucket-list">
            ${state.buckets
              .map(
                (b) =>
                  `<li data-bid="${escapeAttr(String(b.id))}">${escapeHtml(String(b.name))} · TVL ${escapeHtml(String(b.tvl))} · ${escapeHtml(String(b.type))}</li>`
              )
              .join("")}
          </ul>
        </div>
        <div class="panel">
          <h2>Detail & invest</h2>
          <button class="ghost" type="button" id="btn-load-detail">Load selected / draft id</button>
          <pre class="log">${escapeHtml(JSON.stringify(state.bucketDetail, null, 2))}</pre>
          ${
            state.serverInfo?.treasuryInvestEnabled
              ? `<form id="form-invest">
            ${
              serverTreasury()
                ? `<label>Protocol treasury (devnet demo)</label>
                   <div class="badge mono" style="user-select:all">${escapeHtml(serverTreasury())}</div>
                   <p class="badge">Devnet-only path. Investor wallet signs the SOL transfer; server verifies the recipient.</p>`
                : `<label>Protocol treasury (base58) — server did not advertise one</label>
                   <input id="invest-treasury" class="mono" placeholder="Must match server INVEST_TREASURY_PUBKEY" value="${escapeAttr(defaultInvestTreasuryField())}" autocomplete="off" />
                   <p class="badge">Server is not exposing a treasury — set INVEST_TREASURY_PUBKEY on the server and reload, or paste it once here. Saved in this browser.</p>`
            }
            <label>Bucket id</label>
            <input id="invest-bucket-id" value="${escapeAttr(state.draftBucketId)}" />
            <label>Amount (gross SOL sent on-chain; fee split applied when booking TVL)</label>
            <input id="invest-amount" type="number" step="any" min="0.000000001" value="${escapeAttr(state.lastInvestAmount)}" />
            <button class="primary" type="submit" ${state.jwt && state.address ? "" : "disabled"}>Sign transfer & invest (devnet)</button>
          </form>
          <p class="badge">Flow: wallet prompts for SOL transfer to treasury → server verifies tx on RPC → deposit recorded. Mainnet flows use Jupiter (below).</p>
          <hr style="border-color:var(--border);margin:1.25rem 0" />`
              : `<p class="badge">Mainnet mode: SOL→treasury invest disabled. Mainnet uses Jupiter — investor wallet swaps directly, tokens land in your wallet, no protocol custody.</p>
              <input id="invest-bucket-id" value="${escapeAttr(state.draftBucketId)}" hidden />
              <input id="invest-amount" type="hidden" value="${escapeAttr(state.lastInvestAmount)}" />`
          }
          <h3>Jupiter basket (real allocation)</h3>
          <p class="badge hint">Server calls Jupiter’s quote/swap API per listing, splits your SOL by bucket weights, returns unsigned transactions. You sign each swap — tokens land in <strong>your</strong> wallet. ${
            (state.serverInfo?.platformFeeBps ?? 0) > 0
              ? `A platform fee of <strong>${(state.serverInfo!.platformFeeBps! / 100).toFixed(2)}%</strong> is signed as a separate SOL transfer.`
              : ""
          } Use <strong>mainnet</strong> Phantom + funded wallet; devnet RPC will not confirm these swaps.</p>
          ${
            !state.serverInfo?.treasuryInvestEnabled
              ? `<label>Bucket id</label>
                 <input id="invest-bucket-id-mainnet" class="mono" value="${escapeAttr(state.draftBucketId)}" oninput="document.getElementById('invest-bucket-id').value=this.value" />
                 <label>SOL amount (split across listings)</label>
                 <input id="invest-amount-mainnet" type="number" step="any" min="0.000000001" value="${escapeAttr(state.lastInvestAmount)}" oninput="document.getElementById('invest-amount').value=this.value" />`
              : ""
          }
          <button class="primary" type="button" id="btn-jupiter-basket" ${state.jwt && state.address && isMainnetServer() ? "" : "disabled"}>Build plan, sign each swap, record TVL</button>
          <p class="badge">API: POST /buckets/:id/invest/jupiter-plan → sign N txs on ${escapeHtml(SOLANA_JUPITER_RPC)} → POST /buckets/:id/invest/jupiter-complete</p>
          ${
            !isMainnetServer()
              ? `<p class="err">Server is in <strong>${escapeHtml(state.serverInfo?.network ?? "unknown")}</strong> mode — Jupiter buy is mainnet only.</p>`
              : ""
          }
        </div>
      </div>`
        : state.tab === "creator"
        ? `
      <div class="panel">
        <h2>Create draft bucket</h2>
        <form id="form-bucket">
          <label>Name</label>
          <input name="name" required placeholder="My basket" />
          <label>Estimated APY</label>
          <input name="apy" type="number" step="any" value="0.12" />
          <button class="primary" type="submit" ${state.jwt ? "" : "disabled"}>POST /buckets</button>
        </form>
        <label>Draft bucket id (for listings / publish)</label>
        <input id="inp-draft-id" value="${escapeAttr(state.draftBucketId)}" />
      </div>
      <div class="panel" id="catalog-picker">
        <h2>What this bucket can hold</h2>
        <p class="badge">Pick tokens and set target weights (must total <strong>100%</strong>). Mint addresses come from the server catalog — no paste required.</p>
        ${catalogPickerHtml()}
        <button class="primary" type="button" id="btn-save-listings" ${state.jwt ? "" : "disabled"}>Save listings</button>
        <button class="ghost" type="button" id="btn-publish" ${state.jwt ? "" : "disabled"}>Publish draft</button>
        <details class="advanced">
          <summary>Advanced: register a custom mint</summary>
          <form id="form-asset" style="margin-top:0.75rem">
            <label>Mint address</label>
            <input name="id" required placeholder="So111..." />
            <label>Name</label>
            <input name="name" required />
            <label>Symbol</label>
            <input name="symbol" required />
            <label>Icon URL</label>
            <input name="iconUrl" required />
            <label>Decimals</label>
            <input name="decimals" type="number" value="9" />
            <button class="ghost" type="submit" ${state.jwt ? "" : "disabled"}>Register asset</button>
          </form>
          <p class="badge">Registered in-app (${state.assets.length})</p>
          <ul class="list">
            ${state.assets.map((a) => `<li>${escapeHtml(String(a.symbol))} — <code>${escapeHtml(String(a.id))}</code></li>`).join("")}
          </ul>
          <p class="badge">Raw JSON listings (optional)</p>
          <form id="form-listings-json">
            <textarea id="listings-json" name="raw" rows="4" style="width:100%;max-width:none;font-family:monospace;font-size:12px;background:#0a0d12;color:#e8ecf4;border:1px solid #2a3344;border-radius:8px;padding:8px" placeholder='[{"assetId":"...","percentage":50}]'></textarea>
            <button class="ghost" type="submit" ${state.jwt ? "" : "disabled"}>Save from JSON</button>
          </form>
        </details>
      </div>`
        : ""
    }

    <div class="panel">
      <h2>Response log</h2>
      <pre class="log">${escapeHtml(state.log || "…")}</pre>
    </div>
  `;

  document.getElementById("btn-connect-phantom")?.addEventListener("click", () => void connectWallet("phantom"));
  document.getElementById("btn-connect-backpack")?.addEventListener("click", () => void connectWallet("backpack"));
  document.getElementById("btn-login")?.addEventListener("click", () => void loginWithWallet());
  document.getElementById("btn-logout")?.addEventListener("click", logout);
  document.getElementById("inp-username")?.addEventListener("input", (e) => {
    state.username = (e.target as HTMLInputElement).value;
  });
  document.getElementById("btn-refresh-buckets")?.addEventListener("click", () => void refreshBuckets().then(render));
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      state.tab = (el as HTMLElement).dataset.tab as "marketplace" | "creator" | "portfolio";
      const after = () => void refreshBuckets().then(render);
      if (state.tab === "creator") {
        void refreshCatalog().then(after);
      } else if (state.tab === "portfolio") {
        void refreshMyDeposits().then(after);
      } else {
        after();
      }
    });
  });
  document.getElementById("bucket-list")?.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest("[data-bid]");
    if (t) {
      const id = t.getAttribute("data-bid")!;
      state.draftBucketId = id;
      localStorage.setItem("demutual_draft_bucket_id", id);
      void loadBucketDetail(id);
    }
  });
  document.getElementById("btn-load-detail")?.addEventListener("click", () => {
    const id = (document.getElementById("invest-bucket-id") as HTMLInputElement)?.value?.trim();
    if (id) void loadBucketDetail(id);
  });
  document.getElementById("inp-draft-id")?.addEventListener("input", (e) => {
    state.draftBucketId = (e.target as HTMLInputElement).value;
    localStorage.setItem("demutual_draft_bucket_id", state.draftBucketId);
  });
  document.getElementById("form-asset")?.addEventListener("submit", (ev) => void registerAsset(ev));
  document.getElementById("form-bucket")?.addEventListener("submit", (ev) => void createBucket(ev));
  document.getElementById("form-invest")?.addEventListener("submit", (ev) => void invest(ev));
  document.getElementById("invest-amount")?.addEventListener("input", (e) => {
    state.lastInvestAmount = (e.target as HTMLInputElement).value;
    localStorage.setItem("demutual_invest_amt", state.lastInvestAmount);
  });
  document.getElementById("btn-jupiter-basket")?.addEventListener("click", () => void jupiterBasketInvest());
  document.getElementById("invest-treasury")?.addEventListener("change", (e) => {
    const v = (e.target as HTMLInputElement).value.trim();
    if (v) localStorage.setItem(TREASURY_LS_KEY, v);
  });
  document.getElementById("btn-save-listings")?.addEventListener("click", () => void saveListingsFromCatalog());
  document.getElementById("form-listings-json")?.addEventListener("submit", (ev) => void saveListingsJson(ev));
  const sumLine = document.getElementById("catalog-sum-line");
  const picker = document.getElementById("catalog-picker");
  picker?.addEventListener("input", () => {
    if (!sumLine) return;
    let total = 0;
    picker.querySelectorAll("[data-catalog-mint]").forEach((row) => {
      const chk = row.querySelector(".catalog-chk") as HTMLInputElement | null;
      const pct = row.querySelector(".catalog-pct") as HTMLInputElement | null;
      if (chk?.checked && pct?.value) {
        const n = Number(pct.value);
        if (Number.isFinite(n)) total += n;
      }
    });
    const ok = Math.abs(total - 100) < 0.0001;
    sumLine.className = `catalog-sum ${total > 0 ? (ok ? "ok" : "bad") : ""}`;
    sumLine.innerHTML =
      total > 0
        ? `Current total: <strong>${total.toFixed(2)}%</strong>${ok ? " — ready to save." : " — need exactly 100%."}`
        : `Selected weights should sum to <strong>100%</strong>.`;
  });
  document.getElementById("btn-publish")?.addEventListener("click", () => void publishDraft());
  document.getElementById("btn-refresh-portfolio")?.addEventListener("click", () => void refreshMyDeposits().then(render));
  document.getElementById("btn-load-position")?.addEventListener("click", () => void loadMyPosition());
  document.getElementById("form-withdraw")?.addEventListener("submit", (ev) => void withdrawSubmit(ev));
  document.getElementById("btn-jupiter-sell")?.addEventListener("click", () => void jupiterBasketSell());
  document.getElementById("btn-devnet-airdrop")?.addEventListener("click", () => void devnetAirdrop());
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

render();
void loadServerInfo().then(() =>
  void refreshCatalog().then(() => void refreshBuckets().then(render))
);
