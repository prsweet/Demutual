import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  fetchMyAttempts,
  fetchMyPosition,
  postAttemptAbandon,
  postJupiterAttemptResume,
  postJupiterInvestComplete,
  postJupiterInvestExecute,
  postJupiterLegOrder,
  postJupiterLegOrdersBatch,
  postJupiterInvestPlan,
  postJupiterSellAttemptResume,
  postJupiterSellComplete,
  postJupiterSellPlan,
  postTreasuryInvest,
  type AttemptOrderLeg,
  type BasketAttemptRow,
  type BasketLegResult
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
import { getJupiterSubmitRpcUrl, getSolanaRpcUrl, resolveTreasuryPubkey, rpcDisplayHost, setTreasuryInStorage } from "../lib/env";
import { formatAsOf, formatSol, formatUsd, lamportsToSol, solToUsd } from "../lib/money";
import {
  bpsToPercentString,
  percentStringToBps,
  recommendSlippageForBasket,
  SLIPPAGE_PRESETS
} from "../lib/slippage";
import { displayTokenName, displayTokenSymbol } from "../lib/tokenLabels";
import { SOL_MINT, usePrices } from "../lib/usePrices";
import { useTokenInfo } from "../lib/useTokenInfo";
import { ArrowLeft, Loader2, AlertCircle, ShieldCheck, ShieldAlert, FileText, ChevronDown, ChevronUp } from "lucide-react";
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
    WALLET_NO_TRANSACTION_SUPPORT: "Wallet cannot send SOL transfers — try Phantom or Backpack.",
    AMOUNT_BELOW_BUCKET_MINIMUM:
      "Amount is below this bucket's minimum. Each asset in the basket needs to receive at least the minimum trade size, so smaller baskets and lower allocations require a higher total amount.",
    WITHDRAW_EXCEEDS_POSITION: "You're trying to sell more than your current position in this bucket."
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

/**
 * Sell-time wallet check. If Jupiter execute fails with insufficient-funds on the input
 * token, the user likely sold the underlying assets outside Demutual — our ledger still
 * shows position because we don't track wallet balances directly.
 */
function hintIfMissingBasketAssets(message: string): string | null {
  if (!message) return null;
  const m = message.toLowerCase();
  const hits =
    m.includes("insufficient funds") ||
    m.includes("custom program error: 0x1") ||
    m.includes("insufficient lamports") ||
    m.includes("transfer: insufficient");
  if (!hits) return null;
  return [
    "Your wallet doesn't hold enough of the basket assets to complete this sell.",
    "This usually means you've sold or moved one of the underlying tokens outside Demutual.",
    "We can only group-sell tokens you still hold — top those tokens back up and try again, or sell a smaller amount."
  ].join(" ");
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

  /** Resumable basket attempts (PENDING / PARTIAL) for THIS bucket. */
  const [resumableAttempts, setResumableAttempts] = useState<BasketAttemptRow[]>([]);
  /** Last partial-fill summary surfaced from the most recent buy/sell run. */
  const [partialResult, setPartialResult] = useState<{
    direction: "BUY" | "SELL";
    attemptId: string;
    successCount: number;
    failedCount: number;
    pendingCount: number;
    legs: { legId: string; symbol?: string | null; status: string; lastError?: string | null }[];
  } | null>(null);

  const id = routeId?.trim() ?? "";

  /** USD pricing for SOL + every listing mint — display only, refreshes every ~30s. */
  const listingMints = (bucket?.listing ?? [])
    .map((l) => l.assetId)
    .filter((m): m is string => typeof m === "string" && m.length > 0);
  const priceMints = Array.from(new Set([SOL_MINT, ...listingMints]));
  const { prices: priceMap, asOf: priceAsOf } = usePrices(priceMints);
  const solUsd = priceMap[SOL_MINT]?.price ?? null;
  const asOfLine = formatAsOf(priceAsOf);

  /** Verification + sus flags from Jupiter Tokens v2 for educational badges in the allocations list. */
  const { tokens: tokenInfoMap } = useTokenInfo(listingMints);

  /** Tier-aware slippage recommendation derived from what's in the basket. */
  const slippageRecommendation = useMemo(() => {
    const listings = (bucket?.listing ?? []).map((l) => ({
      assetId: l.assetId,
      symbol: (l.asset as { symbol?: string } | undefined)?.symbol ?? null
    }));
    return recommendSlippageForBasket(listings, tokenInfoMap);
  }, [bucket, tokenInfoMap]);

  /**
   * User-chosen slippage in bps. Defaults to the recommendation, re-syncs to the
   * recommendation whenever the basket's tier changes (e.g. the bucket loads, or the
   * tier shifts because token info finished loading). User edits override.
   */
  const [slippageBps, setSlippageBps] = useState<number>(slippageRecommendation.bps);
  const [slippageInput, setSlippageInput] = useState<string>(bpsToPercentString(slippageRecommendation.bps));
  const [slippageEdited, setSlippageEdited] = useState<boolean>(false);

  /** Research doc collapse state — default open so investors can read it before they invest. */
  const [researchOpen, setResearchOpen] = useState(true);
  useEffect(() => {
    if (slippageEdited) return;
    setSlippageBps(slippageRecommendation.bps);
    setSlippageInput(bpsToPercentString(slippageRecommendation.bps));
  }, [slippageRecommendation.bps, slippageEdited]);

  const applySlippagePreset = (bps: number) => {
    setSlippageBps(bps);
    setSlippageInput(bpsToPercentString(bps));
    setSlippageEdited(bps !== slippageRecommendation.bps);
  };
  const handleSlippageChange = (raw: string) => {
    setSlippageInput(raw);
    setSlippageEdited(true);
    const parsed = percentStringToBps(raw);
    if (parsed !== null) setSlippageBps(parsed);
  };
  const slippageRecommended = slippageBps === slippageRecommendation.bps;
  const slippageTooLow = slippageBps < 10; // < 0.10% almost always fails
  const slippageHigh = slippageBps > 500; // > 5% is unusual outside meme dumps

  const slippageBlock = (
    <div className="mb-4 rounded-[12px] border border-black/8 bg-white/70 p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <div className="text-[13px] font-semibold text-[#1a1c1e]">Max slippage</div>
          <div className="text-[11px] text-[#6b7280] leading-snug">
            Crypto prices move every few seconds — including while your trade is processing.{" "}
            <span className="text-[#374151] font-semibold">Too low</span> → trade cancelled.{" "}
            <span className="text-[#374151] font-semibold">Too high</span> → you may pay a bit more.
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="number"
            step="0.05"
            min={0.05}
            max={50}
            value={slippageInput}
            onChange={(e) => handleSlippageChange(e.target.value)}
            className="w-[80px] px-2 py-1.5 rounded-[8px] border border-black/10 bg-white text-[13px] font-medium tabular-nums text-right"
            aria-label="Max slippage percent"
          />
          <span className="text-[12px] text-[#6b7280] font-semibold">%</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {SLIPPAGE_PRESETS.map((p) => {
          const active = slippageBps === p.bps;
          return (
            <button
              key={p.tier}
              type="button"
              onClick={() => applySlippagePreset(p.bps)}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${
                active
                  ? "bg-[#1a1c1e] text-white border-[#1a1c1e]"
                  : "bg-white text-[#374151] border-black/10 hover:bg-black/[0.03]"
              }`}
            >
              {p.label} {bpsToPercentString(p.bps)}%
            </button>
          );
        })}
        {!slippageRecommended && (
          <button
            type="button"
            onClick={() => applySlippagePreset(slippageRecommendation.bps)}
            className="px-2.5 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 text-[11px] font-semibold hover:bg-emerald-100"
          >
            Use recommended {bpsToPercentString(slippageRecommendation.bps)}%
          </button>
        )}
      </div>
      <div className="text-[11px] leading-snug">
        <span className="text-[#374151] font-semibold">Recommended {bpsToPercentString(slippageRecommendation.bps)}%</span>
        <span className="text-[#6b7280]"> — {slippageRecommendation.reason}</span>
      </div>
      {slippageTooLow && (
        <p className="text-[11px] text-red-600 mt-1">
          {bpsToPercentString(slippageBps)}% is very tight — your trade is likely to get cancelled before it can complete. Try at least 0.10%.
        </p>
      )}
      {!slippageTooLow && slippageHigh && (
        <p className="text-[11px] text-amber-700 mt-1">
          {bpsToPercentString(slippageBps)}% is unusually wide — the trade will likely go through, but you may pay noticeably more than expected.
        </p>
      )}
    </div>
  );

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

  const loadResumableAttempts = useCallback(async () => {
    if (!user || !id) return;
    try {
      const [pending, partial] = await Promise.all([
        fetchMyAttempts({ bucketId: id, status: "PENDING", limit: 10 }),
        fetchMyAttempts({ bucketId: id, status: "PARTIAL", limit: 10 })
      ]);
      const combined = [...partial.data, ...pending.data].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setResumableAttempts(combined);
    } catch (e) {
      console.warn("[loadResumableAttempts]", e);
      setResumableAttempts([]);
    }
  }, [user, id]);

  useEffect(() => {
    void loadResumableAttempts();
  }, [loadResumableAttempts]);

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
      const plan = await postJupiterInvestPlan(bucket.id, { solAmount: amount, slippageBps });
      setJupiterBuyPlan(plan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfRentError(msg) || errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  /** Executes a freshly-signed batch of Jupiter buy legs, then reports per-leg outcomes
   * to the server. Used both for the initial buy and for "Resume" of a partial attempt.
   */
  const runBuyLegs = async (params: {
    attemptId: string;
    legs: AttemptOrderLeg[];
    feeTransferSignature?: string;
  }): Promise<{
    attemptStatus: "PENDING" | "PARTIAL" | "COMPLETE" | "ABANDONED";
    legs: BasketLegResult[];
  }> => {
    const provider = getConnectedProvider();
    if (!provider || !walletAddr || !bucket) {
      throw new Error("Wallet disconnected — connect and retry.");
    }

    setBusy(`Sign ${params.legs.length} swap${params.legs.length === 1 ? "" : "s"} in wallet…`);
    const vtxs = params.legs.map((b) =>
      VersionedTransaction.deserialize(b64ToUint8Array(b.swapTransactionBase64))
    );
    const signedB64 = await signAllVersionedTransactionsToBase64(provider, vtxs);

    setBusy(`Executing ${params.legs.length} swap${params.legs.length === 1 ? "" : "s"} via Jupiter…`);
    const execResults = await Promise.allSettled(
      params.legs.map((leg, i) =>
        postJupiterInvestExecute(bucket.id, {
          signedTransaction: signedB64[i]!,
          requestId: leg.requestId
        })
      )
    );

    const legResults: BasketLegResult[] = params.legs.map((leg, i) => {
      const r = execResults[i]!;
      if (r.status === "fulfilled") {
        if (r.value.status === "Success" && r.value.signature) {
          return { legId: leg.legId, status: "SUCCESS", signature: r.value.signature };
        }
        return {
          legId: leg.legId,
          status: "FAILED",
          error: r.value.error || `JUPITER_EXECUTE_FAILED_${r.value.code}`
        };
      }
      return {
        legId: leg.legId,
        status: "FAILED",
        error: r.reason instanceof Error ? r.reason.message : String(r.reason)
      };
    });

    setBusy("Recording on-chain results…");
    const completed = await postJupiterInvestComplete(bucket.id, {
      attemptId: params.attemptId,
      legs: legResults,
      ...(params.feeTransferSignature ? { feeTransferSignature: params.feeTransferSignature } : {})
    });

    return { attemptStatus: completed.attemptStatus, legs: legResults };
  };

  const executeJupiterBuyPlan = async () => {
    if (!jupiterBuyPlan || !bucket || !user) return;
    const provider = getConnectedProvider();
    if (!provider || !walletAddr) return;

    const plan = jupiterBuyPlan;
    const amount = parseFloat(jupiterSol);

    setBusy("Initializing execution…");
    setError(null);
    setPartialResult(null);

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

      // Server creates a BasketAttempt + per-leg rows here.
      setBusy(`Building ${swaps.length} fresh swap orders…`);
      const batch = await postJupiterLegOrdersBatch(bucket.id, {
        legs: swaps.map((s) => ({ outputMint: s.outputMint, lamports: s.inputLamports })),
        slippageBps,
        intendedSol: amount
      });

      const { attemptStatus, legs: legResults } = await runBuyLegs({
        attemptId: batch.attemptId,
        legs: batch.legs,
        ...(feeTransferSignature ? { feeTransferSignature } : {})
      });

      if (attemptStatus !== "COMPLETE") {
        setPartialResult({
          direction: "BUY",
          attemptId: batch.attemptId,
          successCount: legResults.filter((l) => l.status === "SUCCESS").length,
          failedCount: legResults.filter((l) => l.status === "FAILED").length,
          pendingCount: 0,
          legs: legResults.map((r) => {
            const order = batch.legs.find((l) => l.legId === r.legId);
            return {
              legId: r.legId,
              symbol: order?.symbol ?? null,
              status: r.status,
              lastError: r.error ?? null
            };
          })
        });
      }
      setJupiterBuyPlan(null);
      await load();
      await loadPosition();
      await loadResumableAttempts();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfRentError(msg) || errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  /** Resume the missing legs of a buy-direction attempt. */
  const resumeBuyAttempt = async (attemptId: string) => {
    if (!bucket || !user) return;
    setBusy("Re-quoting missing legs…");
    setError(null);
    setPartialResult(null);
    try {
      const resume = await postJupiterAttemptResume(bucket.id, attemptId);
      if (resume.legs.length === 0) {
        setError("Nothing to resume — all legs already settled.");
        setBusy(null);
        return;
      }
      const { attemptStatus, legs: legResults } = await runBuyLegs({
        attemptId,
        legs: resume.legs
        // resume never re-charges fees
      });
      if (attemptStatus !== "COMPLETE") {
        setPartialResult({
          direction: "BUY",
          attemptId,
          successCount: legResults.filter((l) => l.status === "SUCCESS").length,
          failedCount: legResults.filter((l) => l.status === "FAILED").length,
          pendingCount: 0,
          legs: legResults.map((r) => {
            const order = resume.legs.find((l) => l.legId === r.legId);
            return {
              legId: r.legId,
              symbol: order?.symbol ?? null,
              status: r.status,
              lastError: r.error ?? null
            };
          })
        });
      }
      await load();
      await loadPosition();
      await loadResumableAttempts();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfRentError(msg) || errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  const abandonAttemptHandler = async (attemptId: string) => {
    setBusy("Abandoning…");
    setError(null);
    try {
      await postAttemptAbandon(attemptId);
      setPartialResult(null);
      await loadResumableAttempts();
      await loadPosition();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  /** Sign + submit + confirm a batch of sell legs in parallel, then report per-leg outcomes. */
  const runSellLegs = async (params: {
    attemptId: string;
    legs: { legId: string; symbol?: string | null; swapTransactionBase64: string; requestId?: string }[];
    feeTransferSignature?: string;
  }): Promise<{
    attemptStatus: "PENDING" | "PARTIAL" | "COMPLETE" | "ABANDONED";
    legs: BasketLegResult[];
  }> => {
    const provider = getConnectedProvider();
    if (!provider || !walletAddr || !bucket) {
      throw new Error("Wallet disconnected — connect and retry.");
    }

    setBusy(`Sign ${params.legs.length} sell${params.legs.length === 1 ? "" : "s"} in wallet…`);
    const vtxs = params.legs.map((leg) =>
      VersionedTransaction.deserialize(b64ToUint8Array(leg.swapTransactionBase64))
    );
    const signedB64 = await signAllVersionedTransactionsToBase64(provider, vtxs);

    setBusy(`Executing ${params.legs.length} sell${params.legs.length === 1 ? "" : "s"} via Jupiter…`);
    const settled = await Promise.allSettled(
      params.legs.map((leg, i) =>
        postJupiterInvestExecute(bucket.id, {
          signedTransaction: signedB64[i]!,
          requestId: leg.requestId ?? ""
        })
      )
    );

    const legResults: BasketLegResult[] = params.legs.map((leg, i) => {
      const r = settled[i]!;
      if (r.status === "fulfilled") {
        if (r.value.status === "Success" && r.value.signature) {
          return { legId: leg.legId, status: "SUCCESS", signature: r.value.signature };
        }
        return {
          legId: leg.legId,
          status: "FAILED",
          error: r.value.error || `JUPITER_EXECUTE_FAILED_${r.value.code}`
        };
      }
      return {
        legId: leg.legId,
        status: "FAILED",
        error: r.reason instanceof Error ? r.reason.message : String(r.reason)
      };
    });

    setBusy("Recording withdrawal…");
    const completed = await postJupiterSellComplete(bucket.id, {
      attemptId: params.attemptId,
      legs: legResults,
      ...(params.feeTransferSignature ? { feeTransferSignature: params.feeTransferSignature } : {})
    });

    return { attemptStatus: completed.attemptStatus, legs: legResults };
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
    setPartialResult(null);
    try {
      const plan = await postJupiterSellPlan(bucket.id, { solAmount: amount, slippageBps });
      const swaps = plan.legs
        .filter(
          (l): l is JupiterPlanLeg & { swapTransactionBase64: string; legId: string } =>
            l.kind === "swap" &&
            typeof l.swapTransactionBase64 === "string" &&
            l.swapTransactionBase64.length > 0 &&
            typeof l.legId === "string" &&
            l.legId.length > 0
        )
        .map((l) => ({
          legId: l.legId,
          symbol: l.symbol ?? null,
          swapTransactionBase64: l.swapTransactionBase64,
          requestId: l.requestId
        }));
      if (swaps.length === 0) {
        setError("No sell legs returned.");
        setBusy(null);
        return;
      }

      let feeTransferSignature: string | undefined;
      if (plan.feeTransfer && plan.feeTransfer.splits.length > 0) {
        const jupRpc = getJupiterSubmitRpcUrl();
        const connection = new Connection(jupRpc, "confirmed");
        setBusy(`Fee: ${describeFee(plan.feeTransfer)} — sign in wallet…`);
        feeTransferSignature = await signFeeTransfer(provider, connection, walletAddr, plan.feeTransfer);
      }

      const { attemptStatus, legs: legResults } = await runSellLegs({
        attemptId: plan.attemptId,
        legs: swaps,
        ...(feeTransferSignature ? { feeTransferSignature } : {})
      });

      if (attemptStatus !== "COMPLETE") {
        setPartialResult({
          direction: "SELL",
          attemptId: plan.attemptId,
          successCount: legResults.filter((l) => l.status === "SUCCESS").length,
          failedCount: legResults.filter((l) => l.status === "FAILED").length,
          pendingCount: 0,
          legs: legResults.map((r) => {
            const order = swaps.find((l) => l.legId === r.legId);
            return {
              legId: r.legId,
              symbol: order?.symbol ?? null,
              status: r.status,
              lastError: r.error ?? null
            };
          })
        });
      }
      await load();
      await loadPosition();
      await loadResumableAttempts();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfMissingBasketAssets(msg) || hintIfRentError(msg) || errHint(msg) || msg);
    } finally {
      setBusy(null);
    }
  };

  /** Resume the missing legs of a sell-direction attempt. */
  const resumeSellAttempt = async (attemptId: string) => {
    if (!bucket || !user) return;
    setBusy("Re-quoting missing sell legs…");
    setError(null);
    setPartialResult(null);
    try {
      const resume = await postJupiterSellAttemptResume(bucket.id, attemptId);
      if (resume.legs.length === 0) {
        setError("Nothing to resume — all sell legs already settled.");
        setBusy(null);
        return;
      }
      const swaps = resume.legs.map((l) => ({
        legId: l.legId,
        symbol: l.symbol ?? null,
        swapTransactionBase64: l.swapTransactionBase64,
        requestId: l.requestId
      }));
      const { attemptStatus, legs: legResults } = await runSellLegs({
        attemptId,
        legs: swaps
      });
      if (attemptStatus !== "COMPLETE") {
        setPartialResult({
          direction: "SELL",
          attemptId,
          successCount: legResults.filter((l) => l.status === "SUCCESS").length,
          failedCount: legResults.filter((l) => l.status === "FAILED").length,
          pendingCount: 0,
          legs: legResults.map((r) => {
            const order = swaps.find((l) => l.legId === r.legId);
            return {
              legId: r.legId,
              symbol: order?.symbol ?? null,
              status: r.status,
              lastError: r.error ?? null
            };
          })
        });
      }
      await load();
      await loadPosition();
      await loadResumableAttempts();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(hintIfMissingBasketAssets(msg) || hintIfRentError(msg) || errHint(msg) || msg);
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
            {(() => {
              const tvlSol = Number(bucket.tvl);
              const tvlUsd = solToUsd(tvlSol, solUsd);
              return (
                <div className="mb-2">
                  <p className="text-[15px] text-[#374151]">
                    {bucket.type} · TVL{" "}
                    <span className="font-semibold text-[#1a1c1e]">{formatUsd(tvlUsd)}</span>
                    <span className="text-[#6b7280]">
                      {" "}
                      ({tvlSol.toFixed(6)} SOL)
                    </span>{" "}
                    · Est. APY {String(bucket.estimated_apy)}%
                  </p>
                  {tvlUsd !== null && asOfLine && (
                    <p className="text-[11px] text-[#9ca3af] mt-0.5">
                      USD figures {asOfLine} — actual fills depend on slippage at execution.
                    </p>
                  )}
                </div>
              );
            })()}

            <div className="h-px w-full bg-black/5 shadow-[0_1px_0_white] my-6" />

            {user && resumableAttempts.length > 0 && (
              <div className="mb-6 rounded-2xl border border-amber-300/60 bg-amber-50/60 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[14px] font-semibold text-amber-900">
                    Pending basket{resumableAttempts.length === 1 ? "" : "s"} to finish
                  </h3>
                  <span className="text-[11px] font-mono text-amber-800/70">
                    {resumableAttempts.length} attempt{resumableAttempts.length === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="text-[12px] text-amber-900/80 mb-3 leading-snug">
                  These attempts have one or more legs that didn't land (slippage, expiry, or you skipped them).
                  Resuming re-quotes only the missing legs — successful legs already counted toward your position.
                </p>
                <ul className="space-y-3">
                  {resumableAttempts.map((a) => {
                    const successLegs = a.legs.filter((l) => l.status === "SUCCESS");
                    const missingLegs = a.legs.filter(
                      (l) => l.status === "PENDING" || l.status === "FAILED"
                    );
                    const isBuy = a.direction === "BUY";
                    return (
                      <li
                        key={a.id}
                        className="rounded-xl border border-amber-200 bg-white/80 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[12px] font-semibold text-amber-900">
                            {isBuy ? "Buy" : "Sell"} · intended {Number(a.intendedSol).toFixed(6)} SOL ·{" "}
                            <span className="font-mono">{a.status}</span>
                          </div>
                          <div className="text-[11px] text-amber-800/70">
                            {new Date(a.updatedAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-[11px] text-amber-900/80 mb-2 leading-snug">
                          {successLegs.length} of {a.legs.length} legs settled.
                          {missingLegs.length > 0 && (
                            <>
                              {" "}
                              Missing: {missingLegs
                                .map((l) => l.symbol ?? l.mint.slice(0, 4))
                                .join(", ")}
                              .
                            </>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void (isBuy ? resumeBuyAttempt(a.id) : resumeSellAttempt(a.id))
                            }
                            className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[12px] font-semibold disabled:opacity-50"
                          >
                            Resume {missingLegs.length} leg{missingLegs.length === 1 ? "" : "s"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => void abandonAttemptHandler(a.id)}
                            className="px-3 py-1.5 rounded-lg bg-white border border-amber-200 text-amber-900 text-[12px] font-semibold disabled:opacity-50"
                          >
                            Don't resume
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {partialResult && (
              <div className="mb-6 rounded-2xl border border-blue-300/70 bg-blue-50/70 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[14px] font-semibold text-blue-900">
                    {partialResult.direction === "BUY" ? "Buy" : "Sell"} partially filled
                  </h3>
                  <span className="text-[11px] font-mono text-blue-800/70">
                    {partialResult.successCount} ok · {partialResult.failedCount} failed
                  </span>
                </div>
                <p className="text-[12px] text-blue-900/80 mb-3 leading-snug">
                  Only the legs that landed on-chain were credited to your position. You can resume
                  the missing legs now (re-signs only the missing ones), or skip — they'll stay in
                  your "Pending baskets" so you can resume any time.
                </p>
                <ul className="space-y-1 mb-3">
                  {partialResult.legs.map((l) => (
                    <li key={l.legId} className="flex items-start justify-between text-[12px]">
                      <span className="text-blue-900 font-medium">{l.symbol ?? l.legId.slice(0, 6)}</span>
                      <span
                        className={
                          l.status === "SUCCESS"
                            ? "text-emerald-700 font-mono"
                            : "text-red-700 font-mono"
                        }
                      >
                        {l.status}
                        {l.lastError ? ` — ${l.lastError.slice(0, 60)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void (partialResult.direction === "BUY"
                        ? resumeBuyAttempt(partialResult.attemptId)
                        : resumeSellAttempt(partialResult.attemptId))
                    }
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-semibold disabled:opacity-50"
                  >
                    Resume now
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => setPartialResult(null)}
                    className="px-3 py-1.5 rounded-lg bg-white border border-blue-200 text-blue-900 text-[12px] font-semibold disabled:opacity-50"
                  >
                    Resume later
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void abandonAttemptHandler(partialResult.attemptId)}
                    className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-700 text-[12px] font-semibold disabled:opacity-50"
                  >
                    Don't resume
                  </button>
                </div>
              </div>
            )}

            {bucket.researchDoc && bucket.researchDoc.trim().length > 0 && (
              <div className="mb-6 rounded-[14px] border border-black/8 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <button
                  type="button"
                  onClick={() => setResearchOpen((v) => !v)}
                  aria-expanded={researchOpen}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-black/[0.02] transition-colors rounded-t-[14px]"
                >
                  <span className="flex items-center gap-2 text-[14px] font-semibold text-[#1a1c1e]">
                    <FileText className="w-4 h-4 text-[#6b7280]" />
                    Creator's research document
                  </span>
                  <span className="flex items-center gap-2 text-[12px] font-medium text-[#9ca3af]">
                    {researchOpen ? "Hide" : "Show"}
                    {researchOpen ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </span>
                </button>
                {researchOpen && (
                  <div className="px-5 pb-5 pt-1 border-t border-black/5 text-[#374151] text-[14px] leading-relaxed">
                    <ReactMarkdown components={researchMarkdownComponents}>
                      {bucket.researchDoc}
                    </ReactMarkdown>
                    <p className="text-[11px] text-[#9ca3af] mt-4 pt-3 border-t border-black/5">
                      Written by the bucket creator before publishing. Locked once published — investors can trust they're reading exactly what was in front of earlier buyers.
                    </p>
                  </div>
                )}
              </div>
            )}

            <h2 className="text-[15px] font-semibold text-[#374151] mb-3">Allocations</h2>
            <ul className="space-y-2 text-[14px] text-[#6b7280]">
              {(bucket.listing ?? []).map((l) => {
                const asset = (l.asset as { symbol?: string; name?: string } | undefined);
                const info = tokenInfoMap[l.assetId] ?? null;
                const rawSymbol = info?.symbol ?? asset?.symbol ?? l.assetId.slice(0, 8) + "…";
                const rawName = info?.name ?? asset?.name ?? null;
                const symbol = displayTokenSymbol(l.assetId, rawSymbol) ?? rawSymbol;
                const name = displayTokenName(l.assetId, rawName);
                const pct = Number(l.percentage);
                const tvlSol = Number(bucket.tvl);
                const allocationSol = Number.isFinite(pct) && Number.isFinite(tvlSol) ? (tvlSol * pct) / 100 : null;
                const allocationUsd = allocationSol !== null ? solToUsd(allocationSol, solUsd) : null;
                const isSol = l.assetId === SOL_MINT;
                // SOL is universally trusted; show verified for it even when token-info hasn't loaded.
                const verified = isSol || info?.isVerified;
                const sus = !isSol && info?.isSus;
                return (
                  <li key={l.id} className="flex items-start justify-between gap-4 py-1.5 border-b border-black/5 last:border-b-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-[#1a1c1e]">{symbol}</span>
                      {name && name !== symbol && (
                        <span className="text-[12px] text-[#9ca3af] truncate">{name}</span>
                      )}
                      {verified && (
                        <span
                          title={
                            info?.organicScoreLabel
                              ? `Jupiter-verified token — community trust score: ${info.organicScoreLabel}.`
                              : "Jupiter-verified token — confirmed real, not a scam."
                          }
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold border border-emerald-200"
                        >
                          <ShieldCheck className="w-3 h-3" /> verified
                        </span>
                      )}
                      {sus && (
                        <span
                          title="Not on Jupiter's verified list and has on-chain risk signals (mint or freeze authority still enabled, or extreme holder concentration). Treat with caution."
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 text-[11px] font-semibold border border-red-200"
                        >
                          <ShieldAlert className="w-3 h-3" /> caution
                        </span>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[14px] font-semibold text-[#1a1c1e]">{pct}%</div>
                      {allocationUsd !== null && (
                        <div className="text-[11px] text-[#9ca3af] font-mono">
                          {formatUsd(allocationUsd)} of TVL
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {asOfLine && solUsd !== null && (
              <p className="text-[11px] text-[#9ca3af] mt-2">
                Allocation USD values reflect current bucket TVL × weight, {asOfLine}. Verified/caution badges from Jupiter Tokens v2.
              </p>
            )}

            {user?.id === bucket.creatorId && (
              <div className="mt-6 rounded-[10px] border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900 leading-snug">
                <span className="font-semibold">Creator note:</span> investor fees pay out to your connected wallet. Make sure that wallet has been used on Solana before — if it's brand new, send any small amount of SOL to it from an exchange or another wallet so it exists on-chain. Otherwise individual fee transfers are skipped (your buyers still get their tokens).
              </div>
            )}

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
                {position && (() => {
                  const depUsd = solToUsd(position.totalDeposited, solUsd);
                  const wdUsd = solToUsd(position.totalWithdrawn, solUsd);
                  const availUsd = solToUsd(position.availableToWithdraw, solUsd);
                  const Row = ({ label, sol, usd }: { label: string; sol: number; usd: number | null }) => (
                    <div className="flex items-baseline justify-between py-1.5 border-b border-black/5 last:border-b-0">
                      <span className="text-[13px] text-[#6b7280]">{label}</span>
                      <span className="text-right">
                        <span className="text-[14px] font-semibold text-[#1a1c1e]">{formatUsd(usd)}</span>
                        <span className="text-[12px] text-[#9ca3af] ml-2 font-mono">{formatSol(sol)}</span>
                      </span>
                    </div>
                  );
                  return (
                    <div className="bg-white/80 rounded-lg p-3 border border-black/5">
                      <Row label="Total deposited" sol={position.totalDeposited} usd={depUsd} />
                      <Row label="Total withdrawn" sol={position.totalWithdrawn} usd={wdUsd} />
                      <Row label="Available to withdraw" sol={position.availableToWithdraw} usd={availUsd} />
                      {asOfLine && solUsd !== null && (
                        <p className="text-[11px] text-[#9ca3af] mt-2">USD figures {asOfLine}.</p>
                      )}
                    </div>
                  );
                })()}
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
                  Submit txs on {rpcDisplayHost(getJupiterSubmitRpcUrl())}. Fee transfer may be required first.
                </p>
                {(() => {
                  const buySol = parseFloat(jupiterSol);
                  const buyUsd = Number.isFinite(buySol) ? solToUsd(buySol, solUsd) : null;
                  const minSwapSol = bucket.limits ? lamportsToSol(bucket.limits.minSwapLamports) : 0;
                  const minSwapUsd = solToUsd(minSwapSol, solUsd);
                  const belowMin = Number.isFinite(buySol) && buySol > 0 && minSwapSol > 0 && buySol < minSwapSol;
                  return (
                    <>
                      <label className="block text-[12px] text-[#6b7280] mb-1">Amount to invest (SOL)</label>
                      <input
                        type="number"
                        step="any"
                        min={minSwapSol || 0}
                        value={jupiterSol}
                        onChange={(e) => {
                          setJupiterSol(e.target.value);
                          setJupiterBuyPlan(null);
                        }}
                        className="w-full max-w-[200px] px-3 py-2 rounded-[10px] border border-black/10 bg-white"
                      />
                      <p className="text-[12px] text-[#6b7280] mt-1 mb-1">
                        <span className="font-semibold text-[#1a1c1e]">{formatUsd(buyUsd)}</span>
                        {asOfLine && solUsd !== null && (
                          <span className="text-[11px] text-[#9ca3af]"> {asOfLine}</span>
                        )}
                      </p>
                      {minSwapSol > 0 && (
                        <p className={`text-[12px] mb-3 ${belowMin ? "text-red-600" : "text-[#6b7280]"}`}>
                          Minimum for this basket: <span className="font-semibold">{formatUsd(minSwapUsd)}</span>{" "}
                          <span className="text-[#9ca3af]">({minSwapSol.toFixed(6)} SOL)</span>
                          {belowMin && " — increase the amount above to continue."}
                        </p>
                      )}
                    </>
                  );
                })()}
                
                {!jupiterBuyPlan ? (
                  <>
                    {slippageBlock}
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void buildJupiterBuyPlan()}
                      className="px-5 py-2.5 rounded-[10px] bg-[#1a1c1e] text-white text-[14px] font-semibold disabled:opacity-50"
                    >
                      Build Plan & Preview
                    </button>
                  </>
                ) : (
                  <div className="mt-4 p-4 rounded-xl border border-blue-200 bg-blue-50/50">
                    <h3 className="text-[14px] font-semibold text-blue-900 mb-3">Plan Preview</h3>
                    
                    <div className="space-y-3 mb-4">
                      {jupiterBuyPlan.legs.map((leg, i) => {
                        const mint = leg.outputMint || "";
                        const row = (bucket?.listing ?? []).find((r) => r.assetId === mint);
                        const asset = row?.asset as { decimals?: number; symbol?: string } | undefined;
                        const info = mint ? tokenInfoMap[mint] : null;
                        const decimals =
                          info?.decimals ?? (typeof asset?.decimals === "number" ? asset.decimals : 6);
                        const tokenPriceUsd = mint ? priceMap[mint]?.price ?? null : null;
                        if (leg.kind === "swap") {
                          const tokenAmount = (() => {
                            const raw = leg.expectedOutAmount ?? "0";
                            const n = Number(raw);
                            if (!Number.isFinite(n) || decimals <= 0) return null;
                            return n / Math.pow(10, decimals);
                          })();
                          const usd = tokenAmount !== null && tokenPriceUsd !== null ? tokenAmount * tokenPriceUsd : null;
                          return (
                            <div key={i} className="text-[13px] flex items-baseline justify-between">
                              <span className="text-blue-800 font-medium">Swap for {leg.symbol}</span>
                              <span className="text-right">
                                {usd !== null && (
                                  <span className="text-blue-900 font-semibold">{formatUsd(usd)}</span>
                                )}
                                <span className="text-blue-900/60 font-mono ml-2">
                                  ~{formatBaseUnits(leg.expectedOutAmount, decimals, 4)}
                                </span>
                              </span>
                            </div>
                          );
                        }
                        const solAmt = (leg.inputLamports ?? 0) / 1e9;
                        const usd = solToUsd(solAmt, solUsd);
                        return (
                          <div key={i} className="text-[13px] flex items-baseline justify-between">
                            <span className="text-blue-800 font-medium">Keep {leg.symbol}</span>
                            <span className="text-right">
                              {usd !== null && (
                                <span className="text-blue-900 font-semibold">{formatUsd(usd)}</span>
                              )}
                              <span className="text-blue-900/60 font-mono ml-2">{solAmt.toFixed(4)} SOL</span>
                            </span>
                          </div>
                        );
                      })}
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
                      const usdFor = (lamports: number) => solToUsd(lamports / 1e9, solUsd);
                      const Row = ({ label, lamports, prefix = "" }: { label: React.ReactNode; lamports: number; prefix?: string }) => (
                        <div className="flex justify-between items-baseline text-[12px] text-blue-800 mb-1">
                          <span>{label}</span>
                          <span className="text-right">
                            <span className="font-semibold text-blue-900">
                              {prefix}{formatUsd(usdFor(lamports))}
                            </span>
                            <span className="font-mono text-blue-900/60 ml-2">
                              {prefix}{fmtSol(lamports)} SOL
                            </span>
                          </span>
                        </div>
                      );
                      return (
                        <div className="mt-3 rounded-lg border border-blue-300/70 bg-white/60 p-3">
                          <div className="text-[12px] font-semibold text-blue-900 mb-2">
                            Expected wallet debit
                          </div>
                          <Row label="Swap input (basket allocation)" lamports={swapLamports} />
                          {rentLamports > 0 && (
                            <Row
                              label={
                                <>
                                  One-time token-account rent
                                  <span className="text-blue-900/60">
                                    {" "}
                                    ({jupiterBuyPlan.investorRequirements?.missingAtas.length ?? 0} new account
                                    {(jupiterBuyPlan.investorRequirements?.missingAtas.length ?? 0) === 1 ? "" : "s"})
                                  </span>
                                </>
                              }
                              lamports={rentLamports}
                            />
                          )}
                          {feeLamports > 0 && (
                            <Row label="Platform/creator fee" lamports={feeLamports} />
                          )}
                          <Row label="Estimated network fees" lamports={networkFeeLamports} prefix="~" />
                          <div className="h-px w-full bg-blue-200/70 my-2" />
                          <div className="flex justify-between items-baseline text-[13px] font-semibold text-blue-900">
                            <span>Total expected debit</span>
                            <span className="text-right">
                              <span>~{formatUsd(usdFor(totalLamports))}</span>
                              <span className="font-mono text-blue-900/60 ml-2">
                                ~{fmtSol(totalLamports)} SOL
                              </span>
                            </span>
                          </div>
                          {asOfLine && solUsd !== null && (
                            <p className="text-[11px] text-blue-900/60 mt-1">USD figures {asOfLine}.</p>
                          )}
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
                {(() => {
                  const max = position?.availableToWithdraw ?? 0;
                  const maxUsd = solToUsd(max, solUsd);
                  const parsed = parseFloat(sellSol);
                  const overMax = Number.isFinite(parsed) && parsed > max + 1e-9;
                  const nonPositive = !Number.isFinite(parsed) || parsed <= 0;
                  const sellUsd = Number.isFinite(parsed) ? solToUsd(parsed, solUsd) : null;
                  const minSwapSol = bucket.limits ? lamportsToSol(bucket.limits.minSwapLamports) : 0;
                  const minSwapUsd = solToUsd(minSwapSol, solUsd);
                  const belowMin =
                    Number.isFinite(parsed) && parsed > 0 && minSwapSol > 0 && parsed < minSwapSol;
                  return (
                    <>
                      <label className="block text-[12px] text-[#6b7280] mb-1">Amount to sell (SOL out)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="any"
                          min={minSwapSol || 0}
                          max={max}
                          value={sellSol}
                          onChange={(e) => setSellSol(e.target.value)}
                          className="w-full max-w-[200px] px-3 py-2 rounded-[10px] border border-black/10 bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setSellSol(String(max))}
                          disabled={max <= 0}
                          className="px-3 py-2 rounded-[10px] border border-black/10 bg-white text-[12px] font-semibold text-[#374151] disabled:opacity-50"
                        >
                          Max
                        </button>
                      </div>
                      <p className="text-[12px] text-[#6b7280] mt-1 mb-1">
                        <span className="font-semibold text-[#1a1c1e]">{formatUsd(sellUsd)}</span>
                        {asOfLine && solUsd !== null && (
                          <span className="text-[11px] text-[#9ca3af]"> {asOfLine}</span>
                        )}
                      </p>
                      <p className="text-[12px] text-[#6b7280] mb-1">
                        Available: <span className="font-semibold text-[#1a1c1e]">{formatUsd(maxUsd)}</span>{" "}
                        <span className="text-[#9ca3af]">({max.toFixed(6)} SOL)</span>
                      </p>
                      {minSwapSol > 0 && (
                        <p className={`text-[12px] mb-1 ${belowMin ? "text-red-600" : "text-[#6b7280]"}`}>
                          Minimum: <span className="font-semibold">{formatUsd(minSwapUsd)}</span>{" "}
                          <span className="text-[#9ca3af]">({minSwapSol.toFixed(6)} SOL)</span>
                          {belowMin && " — increase the amount above to continue."}
                        </p>
                      )}
                      {overMax && (
                        <p className="text-[12px] text-red-600 mb-1">
                          Exceeds your available position ({formatUsd(maxUsd)}).
                        </p>
                      )}
                      <div className="mt-3">{slippageBlock}</div>
                      <button
                        type="button"
                        disabled={Boolean(busy) || overMax || nonPositive || belowMin}
                        onClick={() => void runJupiterSell()}
                        className="px-5 py-2.5 rounded-[10px] bg-[#374151] text-white text-[14px] font-semibold disabled:opacity-50"
                      >
                        Sell via Jupiter
                      </button>
                    </>
                  );
                })()}
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
