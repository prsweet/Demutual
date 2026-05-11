import bs58 from "bs58";
import { Buffer } from "buffer";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction
} from "@solana/web3.js";
import type { FeeTransferPlan } from "./types";

export type WalletKind = "phantom" | "backpack";

const KIND_KEY = "demutual_wallet_kind";
const BACKPACK_CONNECT_MS = 60_000;

export interface InjectedSolanaWallet {
  isPhantom?: boolean;
  isBackpack?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<unknown>;
  disconnect?: () => Promise<void>;
  publicKey?: { toBytes(): Uint8Array; toBase58?: () => string; toString: () => string };
  signMessage(message: Uint8Array, second?: unknown): Promise<Uint8Array | { signature: Uint8Array } | string>;
  signTransaction?(transaction: Transaction): Promise<Transaction>;
  signTransaction?(transaction: VersionedTransaction): Promise<VersionedTransaction>;
  signAllTransactions?(transactions: VersionedTransaction[]): Promise<VersionedTransaction[]>;
  signAndSendTransaction?(transaction: Transaction, connection: Connection): Promise<{ signature: string }>;
  sendTransaction?(
    transaction: Transaction,
    connection: Connection,
    opts?: { preflightCommitment?: string }
  ): Promise<string>;
}

declare global {
  interface Window {
    solana?: InjectedSolanaWallet;
    backpack?: InjectedSolanaWallet & { solana?: InjectedSolanaWallet };
  }
}

export function getWalletKind(): WalletKind | null {
  const v = localStorage.getItem(KIND_KEY);
  return v === "phantom" || v === "backpack" ? v : null;
}

export function setWalletKind(k: WalletKind): void {
  localStorage.setItem(KIND_KEY, k);
}

export function clearWalletKind(): void {
  localStorage.removeItem(KIND_KEY);
}

export function shortenAddress(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

export function assertValidSolanaAddress(address: string): string {
  return new PublicKey(address).toBase58();
}

export function getPhantom(): InjectedSolanaWallet | null {
  const s = typeof window !== "undefined" ? window.solana : undefined;
  if (s?.isPhantom) return s;
  return null;
}

export function getBackpackProvider(): InjectedSolanaWallet | null {
  const raw = typeof window !== "undefined" ? window.backpack : undefined;
  if (!raw || typeof raw !== "object") return null;
  const top = raw as InjectedSolanaWallet & { solana?: InjectedSolanaWallet };
  if (typeof top.connect === "function") return top;
  if (top.solana && typeof top.solana.connect === "function") return top.solana;
  return null;
}

function pubkeyToAddress(pk: NonNullable<InjectedSolanaWallet["publicKey"]>): string {
  if (typeof pk.toBase58 === "function") return pk.toBase58();
  const s = pk.toString();
  if (s) return s;
  return bs58.encode(pk.toBytes());
}

export function normalizeSignature(sig: Uint8Array | { signature: Uint8Array } | string): string {
  if (typeof sig === "string") return sig;
  if (sig instanceof Uint8Array) return bs58.encode(sig);
  return bs58.encode(sig.signature);
}

async function runBackpackConnect(b: InjectedSolanaWallet): Promise<void> {
  let connectRejected: Error | null = null;
  const connectP = Promise.resolve()
    .then(() => b.connect())
    .catch((e: unknown) => {
      connectRejected = e instanceof Error ? e : new Error(String(e));
    });

  const start = Date.now();
  while (Date.now() - start < BACKPACK_CONNECT_MS) {
    if (b.publicKey) {
      void connectP;
      return;
    }
    if (connectRejected) throw connectRejected;
    await new Promise((r) => setTimeout(r, 300));
  }
  await connectP.catch(() => {});
  if (connectRejected) throw connectRejected;
  throw new Error(
    "Backpack did not connect in time. Unlock Backpack and approve this site, then try again."
  );
}

export async function connectPhantomWallet(): Promise<string> {
  const phantom = getPhantom();
  if (!phantom) throw new Error("Phantom not found. Install from phantom.app.");
  await phantom.connect();
  if (!phantom.publicKey) throw new Error("Phantom connected but no public key.");
  const addr = assertValidSolanaAddress(pubkeyToAddress(phantom.publicKey));
  setWalletKind("phantom");
  return addr;
}

export async function connectBackpackWallet(): Promise<string> {
  const b = getBackpackProvider();
  if (!b) throw new Error("Backpack not found. Install the Backpack extension.");
  await runBackpackConnect(b);
  if (!b.publicKey) throw new Error("Backpack connected but no public key.");
  const addr = assertValidSolanaAddress(pubkeyToAddress(b.publicKey));
  setWalletKind("backpack");
  return addr;
}

/** Sign login message — returns base58 signature string for API */
export async function signLoginMessage(provider: InjectedSolanaWallet, message: string): Promise<string> {
  const encoded = new TextEncoder().encode(message);
  const raw = await provider.signMessage(encoded);
  return normalizeSignature(raw as Uint8Array | { signature: Uint8Array } | string);
}

export async function signUtf8MessageWithWallet(message: string): Promise<string> {
  const p = getConnectedProvider();
  if (!p) throw new Error("Connect a wallet first.");
  return signLoginMessage(p, message);
}

export function getConnectedProvider(): InjectedSolanaWallet | null {
  const kind = getWalletKind();
  if (kind === "phantom") {
    const p = getPhantom();
    if (p?.publicKey) return p;
  }
  if (kind === "backpack") {
    const b = getBackpackProvider();
    if (b?.publicKey) return b;
  }
  return null;
}

export function getConnectedAddress(): string | null {
  const p = getConnectedProvider();
  if (!p?.publicKey) return null;
  try {
    return assertValidSolanaAddress(pubkeyToAddress(p.publicKey));
  } catch {
    return null;
  }
}

export async function disconnectActiveWallet(): Promise<void> {
  const kind = getWalletKind();
  if (kind === "phantom") {
    const p = getPhantom();
    if (p?.disconnect) await p.disconnect();
  }
  if (kind === "backpack") {
    const b = getBackpackProvider();
    if (b?.disconnect) await b.disconnect();
  }
  clearWalletKind();
}

/** Legacy name */
export async function signUtf8MessageWithPhantom(message: string): Promise<string> {
  const p = getPhantom();
  if (!p?.signMessage) throw new Error("Phantom cannot sign messages.");
  return signLoginMessage(p, message);
}

export async function disconnectPhantom(): Promise<void> {
  await disconnectActiveWallet();
}

export function b64ToUint8Array(b64: string): Uint8Array {
  // Jupiter may return base64url (no padding, -/_ alphabet). Normalize to standard base64 for atob().
  const raw = b64.trim();
  const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function walletSendSolTransfer(
  provider: InjectedSolanaWallet,
  connection: Connection,
  tx: Transaction
): Promise<string> {
  const p = provider as InjectedSolanaWallet & {
    signAndSendTransaction?(t: Transaction, c: Connection): Promise<{ signature: string }>;
    sendTransaction?(t: Transaction, c: Connection, o?: { preflightCommitment?: string }): Promise<string>;
    signTransaction?(t: Transaction): Promise<Transaction>;
  };
  // Backpack's sendTransaction/signAndSendTransaction may route via xnftdata rpc-proxy
  // which can fail with CORS/403 in some environments. Prefer signing locally and
  // sending via our own Connection RPC.
  const isBackpack = Boolean((provider as InjectedSolanaWallet).isBackpack);
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
  if (!isBackpack && typeof p.signAndSendTransaction === "function") {
    const out = await p.signAndSendTransaction(tx, connection);
    return out.signature;
  }
  if (!isBackpack && typeof p.sendTransaction === "function") {
    return await p.sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
  }
  throw new Error("WALLET_NO_TRANSACTION_SUPPORT");
}

export async function signAndSendVersioned(
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

export async function signVersionedTransactionToBase64(
  provider: InjectedSolanaWallet,
  vtx: VersionedTransaction
): Promise<string> {
  const signer = provider as InjectedSolanaWallet & {
    signTransaction?(tx: VersionedTransaction): Promise<VersionedTransaction>;
  };
  if (typeof signer.signTransaction !== "function") {
    throw new Error("WALLET_NO_SIGN_VERSIONED");
  }
  const signed = await signer.signTransaction(vtx);
  return Buffer.from(signed.serialize()).toString("base64");
}

/**
 * Send many already-signed (base64) versioned transactions in parallel and poll
 * for confirmation. Throws on the first transaction failure.
 */
export async function sendAndConfirmSignedB64Parallel(
  connection: Connection,
  signedB64Txs: string[],
  opts?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<string[]> {
  if (signedB64Txs.length === 0) return [];
  const sigs = await Promise.all(
    signedB64Txs.map((b64) =>
      connection.sendRawTransaction(b64ToUint8Array(b64), {
        maxRetries: 3,
        preflightCommitment: "confirmed"
      })
    )
  );

  const timeout = opts?.timeoutMs ?? 60_000;
  const interval = opts?.pollIntervalMs ?? 1500;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const statuses = await connection.getSignatureStatuses(sigs);
    const value = statuses.value;
    const failedIdx = value.findIndex((s) => s?.err);
    if (failedIdx >= 0) {
      throw new Error(
        `TX_FAILED:${sigs[failedIdx]}: ${JSON.stringify(value[failedIdx]?.err)}`
      );
    }
    const allConfirmed = value.every(
      (s) => s !== null && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")
    );
    if (allConfirmed) return sigs;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("TX_CONFIRMATION_TIMEOUT");
}

/**
 * Sign multiple versioned transactions in a single wallet popup.
 * Falls back to sequential `signTransaction` calls if the wallet doesn't expose `signAllTransactions`.
 */
export async function signAllVersionedTransactionsToBase64(
  provider: InjectedSolanaWallet,
  vtxs: VersionedTransaction[]
): Promise<string[]> {
  const signer = provider as InjectedSolanaWallet & {
    signAllTransactions?(txs: VersionedTransaction[]): Promise<VersionedTransaction[]>;
    signTransaction?(tx: VersionedTransaction): Promise<VersionedTransaction>;
  };
  if (vtxs.length === 0) return [];

  if (typeof signer.signAllTransactions === "function") {
    const signed = await signer.signAllTransactions(vtxs);
    return signed.map((s) => Buffer.from(s.serialize()).toString("base64"));
  }

  if (typeof signer.signTransaction !== "function") {
    throw new Error("WALLET_NO_SIGN_VERSIONED");
  }
  const out: string[] = [];
  for (const vtx of vtxs) {
    const signed = await signer.signTransaction(vtx);
    out.push(Buffer.from(signed.serialize()).toString("base64"));
  }
  return out;
}

export async function signFeeTransfer(
  provider: InjectedSolanaWallet,
  connection: Connection,
  fromAddress: string,
  fee: FeeTransferPlan
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
  return walletSendSolTransfer(provider, connection, tx);
}

export function solToLamports(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
  const lamports = Math.round(amount * LAMPORTS_PER_SOL);
  if (lamports <= 0) throw new Error("INVALID_AMOUNT");
  return lamports;
}

export function describeFee(fee: FeeTransferPlan): string {
  return fee.splits
    .map((s) => `${(s.lamports / 1e9).toFixed(6)} SOL → ${s.recipient} ${s.toPubkey.slice(0, 6)}…`)
    .join(" + ");
}
