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
  fetchMyDeposits,
  postJupiterInvestComplete,
  postJupiterInvestExecute,
  postJupiterLegOrder,
  postJupiterLegOrdersBatch,
  postJupiterInvestPlan,
  postJupiterSellComplete,
  postJupiterSellPlan,
  postTreasuryInvest
} from "../lib/api";
import type { ApiBucket, DepositRow, JupiterInvestPlan, JupiterPlanLeg } from "../lib/types";
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
import { ArrowLeft, Loader2, AlertCircle, CodeXml, Coins } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { researchMarkdownComponents } from "../components/ResearchDocEditor";

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
  const [jupiterSellPlan, setJupiterSellPlan] = useState<Awaited<ReturnType<typeof postJupiterSellPlan>> | null>(null);
  const [activePlan, setActivePlan] = useState<null | { kind: "buy" | "sell"; plan: JupiterInvestPlan }>(null);
  const [sellSol, setSellSol] = useState("0.01");
  const [busy, setBusy] = useState<string | null>(null);
  const [planDialog, setPlanDialog] = useState<null | { kind: "buy" | "sell" }>(null);

  const [myDeposits, setMyDeposits] = useState<DepositRow[]>([]);
  const [myDepositsErr, setMyDepositsErr] = useState<string | null>(null);

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
    if (!user || !id) return;
    let cancelled = false;
    setMyDepositsErr(null);
    void (async () => {
      try {
        const page = await fetchMyDeposits({ limit: 50, offset: 0 });
        if (cancelled) return;
        const rows = (page.data ?? []).filter((d) => d.bucketId === id);
        rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setMyDeposits(rows);
      } catch (e) {
        if (cancelled) return;
        setMyDeposits([]);
        setMyDepositsErr(e instanceof Error ? e.message : "Failed to load deposits");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, id]);

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
      setActivePlan({ kind: "buy", plan });
      setPlanDialog({ kind: "buy" });
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
      for (const [i, leg] of batch.legs.entries()) {
        const tx = leg.swapTransactionBase64?.trim?.() ?? "";
        if (tx.length < 32) {
          throw new Error(`JUPITER_BAD_TX_BASE64_LEG_${i + 1}`);
        }
      }
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
      setActivePlan(null);
      await load();
      await loadPosition();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfRentError(msg) || errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  const buildJupiterSellPlan = async () => {
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
      setJupiterSellPlan(plan);
      setActivePlan({ kind: "sell", plan });
      setPlanDialog({ kind: "sell" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfRentError(msg) || errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  const executeJupiterSellPlan = async () => {
    if (!jupiterSellPlan || !bucket || !published || !user) return;
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

    const plan = jupiterSellPlan;
    const swaps = plan.legs.filter(
      (l): l is JupiterPlanLeg & { swapTransactionBase64: string } =>
        l.kind === "swap" &&
        typeof l.swapTransactionBase64 === "string" &&
        l.swapTransactionBase64.length > 0
    );
    if (swaps.length === 0) {
      setError("No sell legs returned.");
      return;
    }

    setBusy(`Sign ${swaps.length} sells in wallet…`);
    setError(null);
    try {
      const jupRpc = getJupiterSubmitRpcUrl();
      const connection = new Connection(jupRpc, "confirmed");

      // Optional fee transfer (sell flow currently doesn't have one but supports it).
      let feeTransferSignature: string | undefined;
      if (plan.feeTransfer && plan.feeTransfer.splits.length > 0) {
        setBusy(`Fee: ${describeFee(plan.feeTransfer)} — sign in wallet…`);
        feeTransferSignature = await signFeeTransfer(provider, connection, walletAddr, plan.feeTransfer);
      }

      // Single wallet popup signs ALL sell legs at once.
      const vtxs = swaps.map((leg) => VersionedTransaction.deserialize(b64ToUint8Array(leg.swapTransactionBase64)));
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
      setJupiterSellPlan(null);
      setActivePlan(null);
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
      sidebarCollapsed
    >
      <div className="w-full h-full p-6 tracking-tight">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#6b7280] hover:text-[#1a1c1e] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {configLoading && <p className="text-[13px] text-[#9ca3af] mb-3">Loading server config…</p>}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-[12px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 text-[13px] font-medium text-red-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-[#6b7280] mb-4">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading bucket…
          </div>
        )}

        {bucket && !loading && (() => {
          const cardShadow =
            "shadow-[inset_0_0px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.1),0_12px_24px_-4px_rgba(0,0,0,0.05),0_4px_8px_-2px_rgba(0,0,0,0.04)]";
          const panelShadow =
            "shadow-[inset_0_0px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.08),0_10px_20px_-8px_rgba(0,0,0,0.05),0_3px_6px_-2px_rgba(0,0,0,0.04)]";

          const listing = bucket.listing ?? [];
          const plan = planDialog?.kind === "sell" ? jupiterSellPlan : jupiterBuyPlan;

          return (
            <>
              {/* Header bar */}
              <div className={["rounded-[1.25rem]  px-5 py-4 mb-4"].join(" ")}>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="min-w-[220px]">
                    <div className="flex items-center gap-2 px-2 py-2 bg-[#f8f9f7] rounded-lg shadow-[inset_0_2px_1px_rgba(255,255,255,0.8),inset_0_0_0_1px_rgba(255,255,255,0.5),0_0_0_1px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.04)]">
                      <div className="bg-[#4ade80] p-1.5 rounded-[8px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(74,222,128,0.3)] shrink-0">
                        <CodeXml className="w-4 h-4 text-white stroke-[2.5]" />
                      </div>
                      <h1 className="text-[18px] font-semibold text-[#1a1c1e] tracking-tight truncate ">{bucket.name}</h1>
                    </div>
                  </div>

                  <div className="flex-1 flex items-center pl-8">
                    <div className="flex items-center gap-12">
                      {[
                        { label: "Minimum Price", value: "0.1 SOL", sub: "Minimum Price" },
                        { label: "Estimated APY", value: `${String(bucket.estimated_apy)}%`, sub: "Estimated APY" },
                        { label: "TVL", value: String(bucket.tvl), sub: "TVL" },
                        { label: "Creator", value: bucket.creator?.username || "Unknown", sub: "Creator" }
                      ].map((s) => (
                        <div key={s.label} className="flex flex-col">
                          <div className="text-[12px] font-normal text-[#9ca3af] uppercase tracking-tight mb-0.5">{s.sub}</div>
                          <div className="text-[15px] font-semibold text-[#1a1c1e] tabular-nums">{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Main 3-column section */}
              <div className="flex gap-4 w-full" style={{ height: "60vh" }}>
                {/* Left chart area (50%) */}
                <div className="w-1/2">
                  <div className={["h-full rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")}>
                    <div className="h-full rounded-[1rem] border border-black/8 bg-[#f4f4f4] shadow-[inset_0_2px_4px_rgba(0,0,0,0.04)] flex items-center justify-center">
                      <p className="text-[14px] font-semibold text-[#6b7280] tracking-tight">Chart coming soon</p>
                    </div>
                  </div>
                </div>

                {/* Middle column (20%) */}
                <div className="w-[20%] min-w-[260px] flex flex-col gap-4">
                  {/* Allocation panel */}
                  <div className={["rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")} style={{ height: "50%" }}>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-[14px] font-semibold text-[#374151] tracking-tight">Allocations</h2>
                      <span className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">{listing.length} assets</span>
                    </div>
                    <div className="space-y-3 overflow-auto pr-1" style={{ maxHeight: "calc(100% - 28px)" }}>
                      {listing.length === 0 ? (
                        <p className="text-[13px] text-[#6b7280]">No assets yet.</p>
                      ) : (
                        listing.map((l) => {
                          const asset = l.asset as { symbol?: string; iconUrl?: string } | undefined;
                          const pctNum = typeof l.percentage === "number" ? l.percentage : parseFloat(String(l.percentage));
                          const pct = Number.isFinite(pctNum) ? pctNum : 0;
                          return (
                            <div key={l.id} className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-[10px] bg-white border border-black/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] flex items-center justify-center overflow-hidden">
                                {asset?.iconUrl ? (
                                  <img src={asset.iconUrl} alt={asset?.symbol ?? "asset"} className="w-5 h-5" />
                                ) : (
                                  <Coins className="w-4 h-4 text-[#9ca3af]" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[13px] font-semibold text-[#1a1c1e] truncate">{asset?.symbol ?? l.assetId.slice(0, 6)}</span>
                                  <span className="text-[12px] font-semibold text-[#6b7280] tabular-nums">{pct.toFixed(0)}%</span>
                                </div>
                                <div className="mt-1 h-2 rounded-full bg-black/5 shadow-[inset_0_1px_1px_rgba(0,0,0,0.06)] overflow-hidden">
                                  <div className="h-full rounded-full bg-[#1a1c1e]/20" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Buy / Sell panel */}
                  <div className={["rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")} style={{ height: "50%" }}>
                    <h2 className="text-[14px] font-semibold text-[#374151] tracking-tight mb-3">Buy / Sell</h2>

                    {published && config?.jupiterEnabled ? (
                      <div className="space-y-4">
                        <div>
                          <div className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">Jupiter Basket Buy (Mainnet)</div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="any"
                              value={jupiterSol}
                              onChange={(e) => {
                                setJupiterSol(e.target.value);
                                setJupiterBuyPlan(null);
                                if (activePlan?.kind === "buy") setActivePlan(null);
                              }}
                              className="flex-1 px-3 py-2 rounded-[10px] border border-black/10 bg-white text-[13px] tabular-nums"
                            />
                            {!jupiterBuyPlan ? (
                              <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => void buildJupiterBuyPlan()}
                                className="px-3 py-2 rounded-[10px] bg-[#1a1c1e] text-white text-[13px] font-semibold disabled:opacity-50"
                              >
                                Build
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => setPlanDialog({ kind: "buy" })}
                                className="px-3 py-2 rounded-[10px] bg-[#1a1c1e] text-white text-[13px] font-semibold disabled:opacity-50"
                              >
                                Plan
                              </button>
                            )}
                          </div>
                          {jupiterBuyPlan && (
                            <button
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() => {
                                setJupiterBuyPlan(null);
                                if (activePlan?.kind === "buy") setActivePlan(null);
                              }}
                              className="mt-2 text-[12px] font-semibold text-[#6b7280] hover:text-[#1a1c1e] underline"
                            >
                              Cancel plan
                            </button>
                          )}
                        </div>

                        <div className="h-px w-[calc(100%+40px)] -ml-5 my-4 bg-black/5 shadow-[0_1.5px_0_white]" />

                        <div>
                          <div className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">Jupiter Basket Sell</div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="any"
                              value={sellSol}
                              onChange={(e) => {
                                setSellSol(e.target.value);
                                setJupiterSellPlan(null);
                                if (activePlan?.kind === "sell") setActivePlan(null);
                              }}
                              className="flex-1 px-3 py-2 rounded-[10px] border border-black/10 bg-white text-[13px] tabular-nums"
                            />
                            {!jupiterSellPlan ? (
                              <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => void buildJupiterSellPlan()}
                                className="px-3 py-2 rounded-[10px] bg-[#374151] text-white text-[13px] font-semibold disabled:opacity-50"
                              >
                                Build
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => setPlanDialog({ kind: "sell" })}
                                className="px-3 py-2 rounded-[10px] bg-[#374151] text-white text-[13px] font-semibold disabled:opacity-50"
                              >
                                Plan
                              </button>
                            )}
                          </div>
                          {jupiterSellPlan && (
                            <button
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() => {
                                setJupiterSellPlan(null);
                                if (activePlan?.kind === "sell") setActivePlan(null);
                              }}
                              className="mt-2 text-[12px] font-semibold text-[#6b7280] hover:text-[#1a1c1e] underline"
                            >
                              Cancel plan
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[13px] text-[#6b7280]">
                        {published ? "Jupiter is not enabled on this server." : "Publish the bucket to enable trading."}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right column (research docs) */}
                <div className="flex-1 min-w-[320px]">
                  <div className={["h-full rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")}>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-[14px] font-semibold text-[#374151] tracking-tight">Research Docs</h2>
                      <span className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">{published ? "Published" : "Draft"}</span>
                    </div>
                    <div className="h-[calc(100%-28px)] overflow-auto pr-1">
                      {published && bucket.researchDoc?.trim() ? (
                        <div className="rounded-[1rem] border border-black/6 bg-white/70 px-5 py-4">
                          <ReactMarkdown components={researchMarkdownComponents}>{bucket.researchDoc.trim()}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="rounded-[1rem] border border-black/6 bg-white/50 px-5 py-4 text-[13px] text-[#6b7280]">
                          Research document not available yet.
                          {!published && user?.id === bucket.creatorId ? (
                            <>
                              {" "}
                              <button
                                type="button"
                                className="underline font-semibold text-[#1a1c1e]"
                                onClick={() => navigate(`/buckets/${encodeURIComponent(bucket.id)}/research`)}
                              >
                                Write research &amp; publish
                              </button>
                              .
                            </>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom section: History (buy/sell activity) */}
              <div className={["mt-4 rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")}>
                <div className="flex items-center justify-between gap-4 mb-3">
                  <h2 className="text-[14px] font-semibold text-[#374151] tracking-tight">My history</h2>
                  <span className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">
                    {user ? "Latest" : "Connect wallet"}
                  </span>
                </div>

                {!user ? (
                  <div className="text-[13px] text-[#6b7280]">Connect wallet to see your buy/sell history.</div>
                ) : myDepositsErr ? (
                  <div className="text-[13px] text-[#6b7280]">Could not load history: {myDepositsErr}</div>
                ) : myDeposits.length === 0 ? (
                  <div className="text-[13px] text-[#6b7280]">No activity yet.</div>
                ) : (
                  <div className="rounded-[1rem] border border-black/8 bg-white/70 overflow-hidden">
                    <div className="grid grid-cols-[160px_1fr_140px] gap-0 text-[12px] font-semibold uppercase tracking-wider text-[#9ca3af] border-b border-black/8">
                      <div className="px-4 py-3">Type</div>
                      <div className="px-4 py-3">When</div>
                      <div className="px-4 py-3 text-right">Amount</div>
                    </div>
                    <div className="max-h-[220px] overflow-auto">
                      {myDeposits.slice(0, 12).map((d) => (
                        <div key={d.id} className="grid grid-cols-[160px_1fr_140px] text-[13px] border-b border-black/6 last:border-b-0">
                          <div className="px-4 py-3 font-semibold text-[#1a1c1e]">Buy</div>
                          <div className="px-4 py-3 text-[#6b7280] font-medium">
                            {new Date(d.createdAt).toLocaleString()}
                          </div>
                          <div className="px-4 py-3 text-right text-[#1a1c1e] font-semibold tabular-nums">
                            {String(d.amount)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Plan dialog */}
              {planDialog && plan && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                  <button
                    type="button"
                    className="absolute inset-0 bg-black/20"
                    onClick={() => setPlanDialog(null)}
                    aria-label="Close plan dialog"
                  />
                  <div
                    className={[
                      "relative w-full max-w-2xl rounded-[1.25rem] bg-[#f8f9f7] p-6",
                      "shadow-[inset_0_2px_1px_rgba(255,255,255,0.85),0_24px_48px_-12px_rgba(0,0,0,0.25),0_0_0_1px_rgba(0,0,0,0.08)]"
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h3 className="text-[16px] font-semibold text-[#1a1c1e] tracking-tight">
                          {planDialog.kind === "buy" ? "Buy plan preview" : "Sell plan preview"}
                        </h3>
                        <p className="text-[13px] text-[#6b7280] mt-1">
                          Review legs and confirm execution.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPlanDialog(null)}
                        className="px-3 py-2 rounded-[10px] bg-white border border-black/10 text-[13px] font-semibold text-[#374151] shadow-sm"
                      >
                        Close
                      </button>
                    </div>

                    <div className="rounded-[1.25rem] border border-black/8 bg-[#f8f9f7] p-5 shadow-[inset_0_2px_8px_rgba(0,0,0,0.06),inset_0_0_0_1px_rgba(255,255,255,0.9)]">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-[14px] font-semibold text-[#374151] tracking-tight">Plan preview</h4>
                        <span className="text-[12px] font-semibold uppercase tracking-wider text-[#9ca3af]">
                          {planDialog.kind === "buy" ? "Jupiter buy" : "Jupiter sell"}
                        </span>
                      </div>
                      <div className="space-y-3 mb-4">
                        {plan.legs.map((leg, i) => (
                          <div key={i} className="text-[13px] flex justify-between">
                            <span className="text-[#374151] font-semibold">
                              {leg.kind === "swap"
                                ? planDialog.kind === "sell"
                                  ? `Sell ${leg.symbol}`
                                  : `Buy ${leg.symbol}`
                                : `Keep ${leg.symbol}`}
                            </span>
                            <span className="text-[#1a1c1e] font-semibold tabular-nums">
                              {leg.kind === "swap"
                                ? (() => {
                                    const mint = (leg as unknown as { outputMint?: string }).outputMint || "";
                                    const row = listing.find((r) => r.assetId === mint);
                                    const asset = row?.asset as { decimals?: number } | undefined;
                                    const decimals = typeof asset?.decimals === "number" ? asset.decimals : 6;
                                    const out = (leg as unknown as { expectedOutAmount?: string }).expectedOutAmount;
                                    return out ? `~${formatBaseUnits(out, decimals, 4)}` : "—";
                                  })()
                                : `${(((leg as unknown as { inputLamports?: number }).inputLamports ?? 0) / 1e9).toFixed(4)} SOL`}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="h-px w-[calc(100%+40px)] -ml-5 my-4 bg-black/5 shadow-[0_1.5px_0_white]" />
                      <div className="flex justify-between text-[12px] text-[#6b7280] mb-1 font-semibold">
                        <span>Max Slippage:</span>
                        <span className="text-[#1a1c1e] tabular-nums">{(((plan.slippageBps ?? 0) as number) / 100).toFixed(2)}%</span>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4">
                      {planDialog.kind === "buy" ? (
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void executeJupiterBuyPlan()}
                          className="flex-1 px-4 py-2 rounded-[10px] bg-[#1a1c1e] text-white text-[13px] font-semibold disabled:opacity-50"
                        >
                          Confirm & Execute
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void executeJupiterSellPlan()}
                          className="flex-1 px-4 py-2 rounded-[10px] bg-[#374151] text-white text-[13px] font-semibold disabled:opacity-50"
                        >
                          Confirm & Execute
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => setPlanDialog(null)}
                        className="px-4 py-2 rounded-[10px] bg-white border border-black/10 text-[#374151] text-[13px] font-semibold shadow-sm disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}

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
