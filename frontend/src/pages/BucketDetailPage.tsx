import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction
} from "@solana/web3.js";
import { Layout } from "../components/Layout";
import { ConnectWalletModal } from "../components/ConnectWalletModal";
import { useAuth } from "../context/AuthContext";
import { useServerConfig } from "../context/ServerConfigContext";
import {
  fetchBucketById,
  fetchMyPosition,
  postJupiterInvestComplete,
  postJupiterInvestExecute,
  postJupiterLegOrder,
  postJupiterLegOrdersBatch,
  postJupiterInvestPlan,
  postJupiterSellComplete,
  postJupiterSellPlan,
  postTreasuryInvest
} from "../lib/api";
import type { ApiBucket, JupiterPlanLeg } from "../lib/types";
import {
  b64ToUint8Array,
  describeFee,
  getConnectedAddress,
  getConnectedProvider,
  sendAndConfirmSignedB64Parallel,
  signAndSendVersioned,
  signAllVersionedTransactionsToBase64,
  signVersionedTransactionToBase64,
  signFeeTransfer,
  solToLamports,
  walletSendSolTransfer
} from "../lib/solanaWallet";
import { getJupiterSubmitRpcUrl, getSolanaRpcUrl, resolveTreasuryPubkey, setTreasuryInStorage } from "../lib/env";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";

const DRAFT_LS = "demutual_draft_bucket_id";

function errHint(code: string): string {
  const m: Record<string, string> = {
    JUPITER_NOT_AVAILABLE_ON_DEVNET: "Jupiter runs on mainnet only — switch server to mainnet or use devnet treasury invest.",
    INVEST_TX_VERIFICATION_FAILED: "Transfer did not match treasury / amount / wallet — check devnet RPC and treasury address.",
    BUCKET_NOT_OPEN_FOR_INVESTMENT: "Bucket must be published to invest.",
    UNAUTHORIZED: "Sign in again.",
    WALLET_NO_SIGN_VERSIONED: "Wallet cannot sign versioned txs — try Phantom.",
    WALLET_NO_TRANSACTION_SUPPORT: "Wallet cannot send SOL transfers — try Phantom or Backpack."
  };
  return m[code] ?? code;
}

function hintIfRentError(message: string): string | null {
  if (!message) return null;
  if (message.includes("InsufficientFundsForRent") || message.includes("insufficient funds for rent")) {
    return [
      "Insufficient SOL for rent to create token accounts (ATAs).",
      "Add a bit more SOL to your wallet (rent is paid on-chain), or use a larger swap amount / fewer legs, or pre-create the needed token accounts by receiving those tokens once."
    ].join(" ");
  }
  return null;
}

function formatBaseUnits(amount: string | number | undefined, decimals: number, fractionDigits = 4): string {
  if (amount === undefined || amount === null) return "0";
  const s = typeof amount === "number" ? String(Math.trunc(amount)) : String(amount);
  const neg = s.startsWith("-");
  const raw = neg ? s.slice(1) : s;
  if (!/^\d+$/.test(raw)) return "0";
  const d = Math.max(0, Math.floor(decimals));
  const padded = raw.padStart(d + 1, "0");
  const intPart = padded.slice(0, padded.length - d);
  const fracFull = d === 0 ? "" : padded.slice(padded.length - d);
  const fracTrimmed = fracFull.slice(0, Math.max(0, fractionDigits)).replace(/0+$/, "");
  const out = fracTrimmed ? `${intPart}.${fracTrimmed}` : intPart;
  return neg ? `-${out}` : out;
}

export function BucketDetailPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { config, loading: configLoading } = useServerConfig();

  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [bucket, setBucket] = useState<ApiBucket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [position, setPosition] = useState<Awaited<ReturnType<typeof fetchMyPosition>> | null>(null);
  const [positionErr, setPositionErr] = useState<string | null>(null);

  const [treasuryInput, setTreasuryInput] = useState("");
  const [investSol, setInvestSol] = useState("0.01");
  const [jupiterSol, setJupiterSol] = useState("0.01");
  const [jupiterBuyPlan, setJupiterBuyPlan] = useState<Awaited<ReturnType<typeof postJupiterInvestPlan>> | null>(null);
  const [sellSol, setSellSol] = useState("0.01");
  const [busy, setBusy] = useState<string | null>(null);

  const id = routeId?.trim() ?? "";

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const b = await fetchBucketById(id);
      setBucket(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setBucket(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = resolveTreasuryPubkey(config?.investTreasuryPubkey ?? null);
    if (t) setTreasuryInput(t);
  }, [config?.investTreasuryPubkey]);

  const layoutUser = user ? { name: user.username, walletAddress: user.walletAddress } : undefined;
  const published = bucket?.type === "PUBLISHED";
  const walletAddr = getConnectedAddress();
  const walletMatches = !user?.walletAddress || !walletAddr || user.walletAddress === walletAddr;

  const treasuryPk = treasuryInput.trim() || resolveTreasuryPubkey(config?.investTreasuryPubkey ?? null);

  const loadPosition = async () => {
    if (!user || !id) return;
    setPositionErr(null);
    try {
      const p = await fetchMyPosition(id);
      setPosition(p);
    } catch (e) {
      setPositionErr(e instanceof Error ? e.message : "Failed");
      setPosition(null);
    }
  };

  const onTreasuryInvest = async () => {
    if (!bucket || !published || !user) {
      setIsWalletOpen(true);
      return;
    }
    const provider = getConnectedProvider();
    if (!provider || !walletAddr) {
      setError("Connect Phantom or Backpack and approve the site.");
      return;
    }
    if (!walletMatches) {
      setError("Connected wallet must match your logged-in address.");
      return;
    }
    const amount = parseFloat(investSol);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid SOL amount.");
      return;
    }
    const pkTreasury = treasuryPk.trim();
    if (!pkTreasury) {
      setError("Set protocol treasury (from server or paste below).");
      return;
    }
    try {
      new PublicKey(pkTreasury);
    } catch {
      setError("Treasury is not a valid Solana address.");
      return;
    }

    setBusy("Sign SOL transfer in wallet…");
    setError(null);
    try {
      const rpc = getSolanaRpcUrl();
      const connection = new Connection(rpc, "confirmed");
      const from = new PublicKey(walletAddr);
      const to = new PublicKey(pkTreasury);
      const lamports = solToLamports(amount);
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports })
      );
      tx.feePayer = from;
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      const transactionSignature = await walletSendSolTransfer(provider, connection, tx);
      setBusy("Recording deposit…");
      await postTreasuryInvest(bucket.id, { amount, transactionSignature });
      setTreasuryInStorage(pkTreasury);
      await load();
      await loadPosition();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfRentError(msg) || errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  const buildJupiterBuyPlan = async () => {
    if (!bucket || !published || !user) {
      setIsWalletOpen(true);
      return;
    }
    const provider = getConnectedProvider();
    if (!provider || !walletAddr) {
      setError("Connect wallet first.");
      return;
    }
    if (!walletMatches) {
      setError("Connected wallet must match login.");
      return;
    }
    const amount = parseFloat(jupiterSol);
    if (!Number.isFinite(amount) || amount <= 0) return;

    setBusy("Building Jupiter plan…");
    setError(null);
    setJupiterBuyPlan(null);
    try {
      const plan = await postJupiterInvestPlan(bucket.id, { solAmount: amount, slippageBps: 80 });
      setJupiterBuyPlan(plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfRentError(msg) || errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  const executeJupiterBuyPlan = async () => {
    if (!jupiterBuyPlan || !bucket || !user) return;
    const provider = getConnectedProvider();
    if (!provider || !walletAddr) return;

    const plan = jupiterBuyPlan;
    const amount = parseFloat(jupiterSol);
    
    setBusy("Initializing execution…");
    setError(null);
    
    try {
      const swaps = plan.legs.filter(
        (l): l is JupiterPlanLeg & {
          outputMint: string;
          inputLamports: number;
        } =>
          l.kind === "swap" &&
          typeof l.outputMint === "string" &&
          l.outputMint.length > 0 &&
          typeof l.inputLamports === "number" &&
          l.inputLamports > 0
      );
      if (swaps.length === 0) {
        setError("No swap legs — check bucket assets.");
        setBusy(null);
        return;
      }
      const jupRpc = getJupiterSubmitRpcUrl();
      const connection = new Connection(jupRpc, "confirmed");
      let feeTransferSignature: string | undefined;
      if (plan.feeTransfer && plan.feeTransfer.splits.length > 0) {
        setBusy(`Fee: ${describeFee(plan.feeTransfer)} — sign in wallet…`);
        feeTransferSignature = await signFeeTransfer(provider, connection, walletAddr, plan.feeTransfer);
      }
      const slippageBps = plan.slippageBps ?? 80;

      // Build fresh Jupiter orders for ALL legs in one server round-trip (server keeps the
      // 600ms gap between Jupiter `/order` calls so the rate-limit pressure is unchanged).
      setBusy(`Building ${swaps.length} fresh swap orders…`);
      const batch = await postJupiterLegOrdersBatch(bucket.id, {
        legs: swaps.map((s) => ({ outputMint: s.outputMint, lamports: s.inputLamports })),
        slippageBps
      });

      // Single wallet popup signs ALL legs at once via signAllTransactions.
      setBusy(`Sign ${batch.legs.length} swaps in wallet…`);
      const vtxs = batch.legs.map((b) =>
        VersionedTransaction.deserialize(b64ToUint8Array(b.swapTransactionBase64))
      );
      const signedB64 = await signAllVersionedTransactionsToBase64(provider, vtxs);

      // Send all to Jupiter `/execute` in parallel (it has its own dedicated rate-limit bucket).
      setBusy(`Executing ${batch.legs.length} swaps via Jupiter…`);
      const execResults = await Promise.all(
        batch.legs.map((leg, i) =>
          postJupiterInvestExecute(bucket.id, {
            signedTransaction: signedB64[i]!,
            requestId: leg.requestId
          })
        )
      );

      const failed = execResults
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.status !== "Success");
      if (failed.length > 0) {
        const f = failed[0]!;
        const symbol = swaps[f.i]?.symbol ?? `leg ${f.i + 1}`;
        throw new Error(
          f.r.error
            ? `${symbol}: ${f.r.error}`
            : `${symbol}: JUPITER_EXECUTE_FAILED_${f.r.code}`
        );
      }
      const sigs: string[] = execResults.map((r) => r.signature);

      setBusy("Recording TVL…");
      await postJupiterInvestComplete(bucket.id, {
        solAmount: amount,
        transactionSignatures: sigs,
        ...(feeTransferSignature ? { feeTransferSignature } : {})
      });
      setJupiterBuyPlan(null);
      await load();
      await loadPosition();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfRentError(msg) || errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  const runJupiterSell = async () => {
    if (!bucket || !published || !user) {
      setIsWalletOpen(true);
      return;
    }
    const provider = getConnectedProvider();
    if (!provider || !walletAddr) {
      setError("Connect wallet first.");
      return;
    }
    if (!walletMatches) {
      setError("Connected wallet must match login.");
      return;
    }
    const amount = parseFloat(sellSol);
    if (!Number.isFinite(amount) || amount <= 0) return;

    setBusy("Building sell plan…");
    setError(null);
    try {
      const plan = await postJupiterSellPlan(bucket.id, { solAmount: amount, slippageBps: 80 });
      const swaps = plan.legs.filter(
        (l): l is JupiterPlanLeg & { swapTransactionBase64: string } =>
          l.kind === "swap" &&
          typeof l.swapTransactionBase64 === "string" &&
          l.swapTransactionBase64.length > 0
      );
      if (swaps.length === 0) {
        setError("No sell legs returned.");
        setBusy(null);
        return;
      }
      const jupRpc = getJupiterSubmitRpcUrl();
      const connection = new Connection(jupRpc, "confirmed");

      // Optional fee transfer (sell flow currently doesn't have one but supports it).
      let feeTransferSignature: string | undefined;
      if (plan.feeTransfer && plan.feeTransfer.splits.length > 0) {
        setBusy(`Fee: ${describeFee(plan.feeTransfer)} — sign in wallet…`);
        feeTransferSignature = await signFeeTransfer(provider, connection, walletAddr, plan.feeTransfer);
      }

      // Single wallet popup signs ALL sell legs at once.
      setBusy(`Sign ${swaps.length} sells in wallet…`);
      const vtxs = swaps.map((leg) =>
        VersionedTransaction.deserialize(b64ToUint8Array(leg.swapTransactionBase64))
      );
      const signedB64 = await signAllVersionedTransactionsToBase64(provider, vtxs);

      // Send and confirm all in parallel via the configured RPC.
      setBusy(`Submitting ${swaps.length} sells to Solana…`);
      const sigs = await sendAndConfirmSignedB64Parallel(connection, signedB64);

      setBusy("Recording withdrawal…");
      await postJupiterSellComplete(bucket.id, {
        solAmount: amount,
        transactionSignatures: sigs,
        ...(feeTransferSignature ? { feeTransferSignature } : {})
      });
      await load();
      await loadPosition();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfRentError(msg) || errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  if (!id) {
    return (
      <Layout
        title="Bucket"
        onConnectWallet={() => setIsWalletOpen(true)}
        onDisconnect={() => void logout()}
        user={layoutUser}
      >
        <p className="p-8 text-[#6b7280]">Missing bucket id.</p>
      </Layout>
    );
  }

  return (
    <Layout
      title={bucket?.name ?? "Bucket"}
      onConnectWallet={() => setIsWalletOpen(true)}
      onDisconnect={() => void logout()}
      user={layoutUser}
    >
      <div className="max-w-3xl mx-auto w-full p-8 pb-16 tracking-tight">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#6b7280] hover:text-[#1a1c1e] mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to trending
        </button>

        {config && (
          <div className="mb-6 flex flex-wrap gap-2 text-[12px] font-medium text-[#6b7280]">
            <span className="px-2 py-1 rounded-lg bg-black/5">Network: {config.network}</span>
            {config.treasuryInvestEnabled && (
              <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-800">Treasury invest (devnet)</span>
            )}
            {config.jupiterEnabled && (
              <span className="px-2 py-1 rounded-lg bg-violet-500/10 text-violet-800">Jupiter (mainnet)</span>
            )}
          </div>
        )}
        {configLoading && <p className="text-[13px] text-[#9ca3af] mb-4">Loading server config…</p>}

        {loading && (
          <div className="flex items-center gap-2 text-[#6b7280]">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading bucket…
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-[12px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 text-[13px] font-medium text-red-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {bucket && !loading && (
          <div
            className="bg-[#f8f9f7] rounded-3xl p-8 shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.08),0_12px_24px_-4px_rgba(0,0,0,0.05)]"
          >
            <h1 className="text-[24px] font-semibold text-[#1a1c1e] mb-1">{bucket.name}</h1>
            <p className="text-[13px] text-[#6b7280] font-mono mb-4 break-all">id: {bucket.id}</p>
            <p className="text-[15px] text-[#374151] mb-2">
              {bucket.type} · TVL {String(bucket.tvl)} · Est. APY {String(bucket.estimated_apy)}%
            </p>

            <div className="h-px w-full bg-black/5 shadow-[0_1px_0_white] my-6" />

            <h2 className="text-[15px] font-semibold text-[#374151] mb-3">Allocations</h2>
            <ul className="space-y-2 text-[14px] text-[#6b7280]">
              {(bucket.listing ?? []).map((l) => (
                <li key={l.id} className="flex justify-between gap-4">
                  <span>{(l.asset as { symbol?: string } | undefined)?.symbol ?? l.assetId.slice(0, 8)}…</span>
                  <span className="font-medium text-[#1a1c1e]">{String(l.percentage)}%</span>
                </li>
              ))}
            </ul>

            {user && published && (
              <>
                <div className="h-px w-full bg-black/5 shadow-[0_1px_0_white] my-6" />
                <h2 className="text-[15px] font-semibold text-[#374151] mb-3">My position</h2>
                {!walletMatches && (
                  <p className="text-[13px] text-amber-800 mb-2">
                    Wallet mismatch: log in with the connected wallet address or reconnect.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void loadPosition()}
                  className="mb-3 px-4 py-2 rounded-[10px] bg-white border border-black/10 text-[14px] font-semibold text-[#374151] shadow-sm"
                >
                  Refresh position
                </button>
                {positionErr && <p className="text-[13px] text-red-700 mb-2">{positionErr}</p>}
                {position && (
                  <pre className="text-[12px] bg-white/80 rounded-lg p-3 border border-black/5 overflow-x-auto">
                    {JSON.stringify(position, null, 2)}
                  </pre>
                )}
              </>
            )}

            {user && published && config?.treasuryInvestEnabled && (
              <>
                <div className="h-px w-full bg-black/5 shadow-[0_1px_0_white] my-6" />
                <h2 className="text-[15px] font-semibold text-[#374151] mb-2">Devnet treasury invest</h2>
                <p className="text-[13px] text-[#6b7280] mb-4">
                  Gross SOL sent to treasury; server verifies on RPC ({getSolanaRpcUrl()}). Use devnet wallet.
                </p>
                <label className="block text-[13px] font-semibold text-[#374151] mb-1">Treasury (base58)</label>
                <input
                  value={treasuryInput}
                  onChange={(e) => {
                    setTreasuryInput(e.target.value);
                    if (e.target.value.trim()) setTreasuryInStorage(e.target.value.trim());
                  }}
                  className="w-full mb-3 px-3 py-2 rounded-[10px] border border-black/10 bg-white font-mono text-[12px]"
                  placeholder="Matches server INVEST_TREASURY_PUBKEY"
                />
                <label className="block text-[13px] font-semibold text-[#374151] mb-1">SOL amount (gross)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={investSol}
                  onChange={(e) => setInvestSol(e.target.value)}
                  className="w-full max-w-[200px] mb-4 px-3 py-2 rounded-[10px] border border-black/10 bg-white tabular-nums"
                />
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void onTreasuryInvest()}
                  className="px-5 py-2.5 rounded-[10px] bg-[#1a1c1e] text-white text-[14px] font-semibold disabled:opacity-50"
                >
                  Sign & invest
                </button>
              </>
            )}

            {user && published && config?.jupiterEnabled && (
              <>
                <div className="h-px w-full bg-black/5 shadow-[0_1px_0_white] my-6" />
                <h2 className="text-[15px] font-semibold text-[#374151] mb-2">Jupiter basket buy (mainnet)</h2>
                <p className="text-[13px] text-[#6b7280] mb-4">
                  Submit txs on {getJupiterSubmitRpcUrl()}. Fee transfer may be required first.
                </p>
                <input
                  type="number"
                  step="any"
                  value={jupiterSol}
                  onChange={(e) => {
                    setJupiterSol(e.target.value);
                    setJupiterBuyPlan(null); // Reset plan if input changes
                  }}
                  className="w-full max-w-[200px] mb-3 px-3 py-2 rounded-[10px] border border-black/10 bg-white"
                />
                
                {!jupiterBuyPlan ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void buildJupiterBuyPlan()}
                    className="px-5 py-2.5 rounded-[10px] bg-[#1a1c1e] text-white text-[14px] font-semibold disabled:opacity-50"
                  >
                    Build Plan & Preview
                  </button>
                ) : (
                  <div className="mt-4 p-4 rounded-xl border border-blue-200 bg-blue-50/50">
                    <h3 className="text-[14px] font-semibold text-blue-900 mb-3">Plan Preview</h3>
                    
                    <div className="space-y-3 mb-4">
                      {jupiterBuyPlan.legs.map((leg, i) => (
                        <div key={i} className="text-[13px] flex justify-between">
                          <span className="text-blue-800 font-medium">
                            {leg.kind === "swap" ? `Swap for ${leg.symbol}` : `Keep ${leg.symbol}`}
                          </span>
                          <span className="text-blue-900">
                            {leg.kind === "swap"
                              ? (() => {
                                  const mint = leg.outputMint || "";
                                  const row = (bucket?.listing ?? []).find((r) => r.assetId === mint);
                                  const asset = row?.asset as { decimals?: number } | undefined;
                                  const decimals = typeof asset?.decimals === "number" ? asset.decimals : mint ? 6 : 6;
                                  return `~${formatBaseUnits(leg.expectedOutAmount, decimals, 4)}`;
                                })()
                              : `${((leg.inputLamports ?? 0) / 10**9).toFixed(4)} SOL`}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="h-px w-full bg-blue-200/50 my-3" />
                    
                    <div className="flex justify-between text-[12px] text-blue-800 mb-1">
                      <span>Max Slippage:</span>
                      <span>{(((jupiterBuyPlan.slippageBps ?? 0) as number) / 100).toFixed(2)}%</span>
                    </div>
                    
                    {jupiterBuyPlan.feeTransfer && (
                      <div className="flex justify-between text-[12px] text-blue-800 mb-4">
                        <span>Platform/Creator Fee:</span>
                        <span>
                          {(() => {
                            const lamports = jupiterBuyPlan.feeTransfer?.totalLamports ?? 0;
                            const sol = lamports / 1e9;
                            if (lamports > 0 && sol < 0.0001) return `${lamports} lamports (${sol.toFixed(9)} SOL)`;
                            return `${sol.toFixed(4)} SOL`;
                          })()}
                        </span>
                      </div>
                    )}

                    {!jupiterBuyPlan.feeTransfer && jupiterBuyPlan.feeTransferSkippedReason && (
                      <div className="mt-1 mb-3 text-[12px] text-amber-800 bg-amber-50/70 border border-amber-200/70 rounded-lg p-2 leading-snug">
                        Fee transfer skipped: {jupiterBuyPlan.feeTransferSkippedReason}
                      </div>
                    )}

                    {(() => {
                      const swapLamports = jupiterBuyPlan.legs
                        .filter((l) => l.kind === "swap")
                        .reduce((acc, l) => acc + (l.inputLamports ?? 0), 0);
                      const rentLamports = jupiterBuyPlan.investorRequirements?.estimatedRentLamports ?? 0;
                      const feeLamports = jupiterBuyPlan.feeTransfer?.totalLamports ?? 0;
                      const networkFeeLamports = 5000 * jupiterBuyPlan.legs.length; // rough per-tx network fee
                      const totalLamports = swapLamports + rentLamports + feeLamports + networkFeeLamports;
                      const rentShare = swapLamports > 0 ? rentLamports / swapLamports : 0;
                      const inefficient = rentShare > 0.3 && rentLamports > 0;
                      const fmtSol = (lamports: number) => (lamports / 1e9).toFixed(6);
                      return (
                        <div className="mt-3 rounded-lg border border-blue-300/70 bg-white/60 p-3">
                          <div className="text-[12px] font-semibold text-blue-900 mb-2">
                            Expected wallet debit
                          </div>
                          <div className="flex justify-between text-[12px] text-blue-800 mb-1">
                            <span>Swap input (basket allocation)</span>
                            <span className="font-mono">{fmtSol(swapLamports)} SOL</span>
                          </div>
                          {rentLamports > 0 && (
                            <div className="flex justify-between text-[12px] text-blue-800 mb-1">
                              <span>
                                One-time token-account rent
                                <span className="text-blue-900/60">
                                  {" "}
                                  ({jupiterBuyPlan.investorRequirements?.missingAtas.length ?? 0} new account
                                  {(jupiterBuyPlan.investorRequirements?.missingAtas.length ?? 0) === 1 ? "" : "s"})
                                </span>
                              </span>
                              <span className="font-mono">{fmtSol(rentLamports)} SOL</span>
                            </div>
                          )}
                          {feeLamports > 0 && (
                            <div className="flex justify-between text-[12px] text-blue-800 mb-1">
                              <span>Platform/creator fee</span>
                              <span className="font-mono">{fmtSol(feeLamports)} SOL</span>
                            </div>
                          )}
                          <div className="flex justify-between text-[12px] text-blue-800 mb-2">
                            <span>Estimated network fees</span>
                            <span className="font-mono">~{fmtSol(networkFeeLamports)} SOL</span>
                          </div>
                          <div className="h-px w-full bg-blue-200/70 mb-2" />
                          <div className="flex justify-between text-[13px] font-semibold text-blue-900">
                            <span>Total expected debit</span>
                            <span className="font-mono">~{fmtSol(totalLamports)} SOL</span>
                          </div>
                          {rentLamports > 0 && (
                            <div className="mt-2 text-[11px] text-blue-900/70 leading-snug">
                              Token-account rent is locked in your new token accounts and is{" "}
                              <span className="font-medium">recoverable</span> if you ever close them.
                              It is paid only the first time you receive each token in this wallet.
                            </div>
                          )}
                          {inefficient && (
                            <div className="mt-2 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-2 leading-snug">
                              Heads up: at this size, one-time rent is{" "}
                              <span className="font-mono">{(rentShare * 100).toFixed(0)}%</span> of your swap input.
                              You'll get more token per SOL by using a larger amount, or by reusing this wallet for future
                              buys (the rent is one-time per token).
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void executeJupiterBuyPlan()}
                        className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-semibold disabled:opacity-50"
                      >
                        Confirm & Execute Swaps
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => setJupiterBuyPlan(null)}
                        className="px-4 py-2 rounded-lg bg-white border border-blue-200 text-blue-800 text-[13px] font-semibold disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div className="h-px w-full bg-black/5 shadow-[0_1px_0_white] my-6" />
                <h2 className="text-[15px] font-semibold text-[#374151] mb-2">Jupiter basket sell</h2>
                <p className="text-[13px] text-[#6b7280] mb-4">Target SOL out; assets come from your wallet.</p>
                <input
                  type="number"
                  step="any"
                  value={sellSol}
                  onChange={(e) => setSellSol(e.target.value)}
                  className="w-full max-w-[200px] mb-3 px-3 py-2 rounded-[10px] border border-black/10 bg-white"
                />
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void runJupiterSell()}
                  className="px-5 py-2.5 rounded-[10px] bg-[#374151] text-white text-[14px] font-semibold disabled:opacity-50"
                >
                  Sell via Jupiter
                </button>
              </>
            )}

            {!published && user?.id === bucket.creatorId && (
              <p className="mt-6 text-[14px] text-[#6b7280]">
                Draft bucket —{" "}
                <button type="button" className="underline font-semibold" onClick={() => navigate("/create-bucket")}>
                  continue in create flow
                </button>
                . Draft id saved:{" "}
                <code className="text-[12px]">{typeof localStorage !== "undefined" ? localStorage.getItem(DRAFT_LS) : ""}</code>
              </p>
            )}
          </div>
        )}

        {busy && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-4 py-3 rounded-[12px] bg-[#1a1c1e] text-white text-[13px] font-medium shadow-lg flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {busy}
          </div>
        )}
      </div>

      <ConnectWalletModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} />
    </Layout>
  );
}
