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
import { CreatorVerificationStatus } from "../components/CreatorVerificationStatus";
import { useAuth } from "../context/AuthContext";
import { useServerConfig } from "../context/ServerConfigContext";
import {
  fetchBucketById,
  fetchMyAttempts,
  fetchMyDeposits,
  fetchMyPosition,
  postAttemptAbandon,
  postJupiterAttemptResume,
  postJupiterInvestComplete,
  postJupiterInvestExecute,
  postJupiterInvestPlan,
  postJupiterLegOrdersBatch,
  postJupiterSellAttemptResume,
  postJupiterSellComplete,
  postJupiterSellPlan,
  postTreasuryInvest,
  type AttemptOrderLeg,
  type BasketAttemptRow,
  type BasketLegResult
} from "../lib/api";
import type { ApiBucket, DepositRow, JupiterPlanLeg } from "../lib/types";
import {
  b64ToUint8Array,
  describeFee,
  getConnectedAddress,
  getConnectedProvider,
  signAllVersionedTransactionsToBase64,
  signFeeTransfer,
  solToLamports,
  walletSendSolTransfer
} from "../lib/solanaWallet";
import {
  getJupiterSubmitRpcUrl,
  getSolanaRpcUrl,
  resolveTreasuryPubkey,
  rpcDisplayHost,
  setTreasuryInStorage
} from "../lib/env";
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
import {
  AlertCircle,
  ArrowLeft,
  CodeXml,
  Coins,
  Loader2,
  ShieldAlert,
  ShieldCheck
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { researchMarkdownComponents } from "../components/ResearchDocEditor";

const DRAFT_LS = "demutual_draft_bucket_id";

function errHint(code: string): string {
  const m: Record<string, string> = {
    JUPITER_NOT_AVAILABLE_ON_DEVNET:
      "Jupiter runs on mainnet only — switch server to mainnet or use devnet treasury invest.",
    INVEST_TX_VERIFICATION_FAILED:
      "Transfer did not match treasury / amount / wallet — check devnet RPC and treasury address.",
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

/** Sell-time: wallet doesn't actually hold the basket tokens, usually because the user moved them
 * outside Demutual. Maps a few common Solana insufficient-funds error fingerprints to friendlier copy. */
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
  const [sellSol, setSellSol] = useState("0.01");
  const [jupiterBuyPlan, setJupiterBuyPlan] = useState<Awaited<ReturnType<typeof postJupiterInvestPlan>> | null>(null);
  const [jupiterSellPlan, setJupiterSellPlan] = useState<Awaited<ReturnType<typeof postJupiterSellPlan>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [planDialog, setPlanDialog] = useState<null | { kind: "buy" | "sell" }>(null);

  const [myDeposits, setMyDeposits] = useState<DepositRow[]>([]);
  const [myDepositsErr, setMyDepositsErr] = useState<string | null>(null);

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

  /** USD pricing for SOL + every listing mint — display only. */
  const listingMints = (bucket?.listing ?? [])
    .map((l) => l.assetId)
    .filter((m): m is string => typeof m === "string" && m.length > 0);
  const priceMints = Array.from(new Set([SOL_MINT, ...listingMints]));
  const { prices: priceMap, asOf: priceAsOf } = usePrices(priceMints);
  const solUsd = priceMap[SOL_MINT]?.price ?? null;
  const asOfLine = formatAsOf(priceAsOf);

  const { tokens: tokenInfoMap } = useTokenInfo(listingMints);

  /** Tier-aware slippage recommendation derived from what's in the basket. */
  const slippageRecommendation = useMemo(() => {
    const listings = (bucket?.listing ?? []).map((l) => ({
      assetId: l.assetId,
      symbol: (l.asset as { symbol?: string } | undefined)?.symbol ?? null
    }));
    return recommendSlippageForBasket(listings, tokenInfoMap);
  }, [bucket, tokenInfoMap]);

  const [slippageBps, setSlippageBps] = useState<number>(slippageRecommendation.bps);
  const [slippageInput, setSlippageInput] = useState<string>(bpsToPercentString(slippageRecommendation.bps));
  const [slippageEdited, setSlippageEdited] = useState<boolean>(false);
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

  const loadPosition = useCallback(async () => {
    if (!user || !id) return;
    setPositionErr(null);
    try {
      const p = await fetchMyPosition(id);
      setPosition(p);
    } catch (e) {
      setPositionErr(e instanceof Error ? e.message : "Failed");
      setPosition(null);
    }
  }, [user, id]);

  useEffect(() => {
    void loadPosition();
  }, [loadPosition]);

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

  const loadResumableAttempts = useCallback(async () => {
    if (!user || !id) return;
    try {
      const [pending, partial] = await Promise.all([
        fetchMyAttempts({ bucketId: id, status: "PENDING", limit: 10 }),
        fetchMyAttempts({ bucketId: id, status: "PARTIAL", limit: 10 })
      ]);
      const merged = [...partial.data, ...pending.data];
      merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setResumableAttempts(merged);
    } catch (e) {
      console.warn("[loadResumableAttempts]", e);
    }
  }, [user, id]);

  useEffect(() => {
    void loadResumableAttempts();
  }, [loadResumableAttempts]);

  useEffect(() => {
    const t = resolveTreasuryPubkey(config?.investTreasuryPubkey ?? null);
    if (t) setTreasuryInput(t);
  }, [config?.investTreasuryPubkey]);

  const layoutUser = user ? { name: user.username, walletAddress: user.walletAddress } : undefined;
  const published = bucket?.type === "PUBLISHED";
  const walletAddr = getConnectedAddress();
  const walletMatches = !user?.walletAddress || !walletAddr || user.walletAddress === walletAddr;
  const treasuryPk = treasuryInput.trim() || resolveTreasuryPubkey(config?.investTreasuryPubkey ?? null);

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
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
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

  /** Sign + submit a batch of buy legs in parallel via Jupiter /execute, then attempt-complete. */
  const runBuyLegs = async (params: {
    attemptId: string;
    legs: AttemptOrderLeg[];
    feeTransferSignature?: string;
  }): Promise<{ attemptStatus: "PENDING" | "PARTIAL" | "COMPLETE" | "ABANDONED"; legs: BasketLegResult[] }> => {
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
    setPartialResult(null);

    try {
      const swaps = plan.legs.filter(
        (l): l is JupiterPlanLeg & { outputMint: string; inputLamports: number } =>
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
      const slip = plan.slippageBps ?? slippageBps;

      setBusy(`Building ${swaps.length} fresh swap orders…`);
      const batch = await postJupiterLegOrdersBatch(bucket.id, {
        legs: swaps.map((s) => ({ outputMint: s.outputMint, lamports: s.inputLamports })),
        slippageBps: slip,
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
      setPlanDialog(null);
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

  const runSellLegs = async (params: {
    attemptId: string;
    legs: { legId: string; symbol?: string | null; swapTransactionBase64: string; requestId?: string }[];
    feeTransferSignature?: string;
  }): Promise<{ attemptStatus: "PENDING" | "PARTIAL" | "COMPLETE" | "ABANDONED"; legs: BasketLegResult[] }> => {
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
    const execResults = await Promise.allSettled(
      params.legs.map((leg, i) =>
        leg.requestId
          ? postJupiterInvestExecute(bucket.id, {
              signedTransaction: signedB64[i]!,
              requestId: leg.requestId
            })
          : Promise.reject(new Error("MISSING_REQUEST_ID"))
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
    const completed = await postJupiterSellComplete(bucket.id, {
      attemptId: params.attemptId,
      legs: legResults,
      ...(params.feeTransferSignature ? { feeTransferSignature: params.feeTransferSignature } : {})
    });

    return { attemptStatus: completed.attemptStatus, legs: legResults };
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
    setJupiterSellPlan(null);
    try {
      const plan = await postJupiterSellPlan(bucket.id, { solAmount: amount, slippageBps });
      setJupiterSellPlan(plan);
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
    const plan = jupiterSellPlan;
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
      return;
    }
    const attemptId = (plan as unknown as { attemptId?: string }).attemptId ?? "";
    if (!attemptId) {
      setError("Plan is missing attemptId — rebuild the sell plan.");
      return;
    }

    setError(null);
    setPartialResult(null);
    try {
      let feeTransferSignature: string | undefined;
      if (plan.feeTransfer && plan.feeTransfer.splits.length > 0) {
        const jupRpc = getJupiterSubmitRpcUrl();
        const connection = new Connection(jupRpc, "confirmed");
        setBusy(`Fee: ${describeFee(plan.feeTransfer)} — sign in wallet…`);
        feeTransferSignature = await signFeeTransfer(provider, connection, walletAddr, plan.feeTransfer);
      }

      const { attemptStatus, legs: legResults } = await runSellLegs({
        attemptId,
        legs: swaps,
        ...(feeTransferSignature ? { feeTransferSignature } : {})
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
      setJupiterSellPlan(null);
      setPlanDialog(null);
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
      const { attemptStatus, legs: legResults } = await runSellLegs({ attemptId, legs: swaps });
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

  // --- Derived display values used by the render below ---
  const tvlSol = bucket ? Number(bucket.tvl) : 0;
  const tvlUsd = solToUsd(tvlSol, solUsd);
  const minSwapSol = bucket?.limits ? lamportsToSol(bucket.limits.minSwapLamports) : 0;
  const minSwapUsd = solToUsd(minSwapSol, solUsd);

  // Slippage UI guards
  const slippageRecommended = slippageBps === slippageRecommendation.bps;
  const slippageTooLow = slippageBps < 10;
  const slippageHigh = slippageBps > 500;

  /** Slippage selector block — used in both buy and sell columns. */
  const slippageBlock = (
    <div className="rounded-[10px] border border-black/8 bg-white/70 px-3 py-2.5 mt-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold text-[#374151] uppercase tracking-wider">Max slippage</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.05"
            min={0.05}
            max={50}
            value={slippageInput}
            onChange={(e) => handleSlippageChange(e.target.value)}
            className="w-[68px] px-2 py-1 rounded-[6px] border border-black/10 bg-white text-[12px] font-medium tabular-nums text-right"
            aria-label="Max slippage percent"
          />
          <span className="text-[11px] text-[#6b7280] font-semibold">%</span>
        </div>
      </div>
      <p className="text-[11px] text-[#6b7280] leading-snug mb-2">
        Crypto prices move every few seconds — including while your trade is processing.{" "}
        <span className="text-[#374151] font-semibold">Too low</span> → trade cancelled.{" "}
        <span className="text-[#374151] font-semibold">Too high</span> → you may pay a bit more.
      </p>
      <div className="flex flex-wrap gap-1 mb-1">
        {SLIPPAGE_PRESETS.map((p) => {
          const active = slippageBps === p.bps;
          return (
            <button
              key={p.tier}
              type="button"
              onClick={() => applySlippagePreset(p.bps)}
              className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold transition-colors ${
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
            className="px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-semibold hover:bg-emerald-100"
          >
            Use rec {bpsToPercentString(slippageRecommendation.bps)}%
          </button>
        )}
      </div>
      <p className="text-[10px] text-[#9ca3af] leading-snug">
        Recommended {bpsToPercentString(slippageRecommendation.bps)}% — {slippageRecommendation.reason}
      </p>
      {slippageTooLow && (
        <p className="text-[10px] text-red-600 mt-1">
          {bpsToPercentString(slippageBps)}% is very tight — your trade is likely to get cancelled. Try ≥ 0.10%.
        </p>
      )}
      {!slippageTooLow && slippageHigh && (
        <p className="text-[10px] text-amber-700 mt-1">
          {bpsToPercentString(slippageBps)}% is unusually wide — fill may be noticeably worse.
        </p>
      )}
    </div>
  );

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
          Back to trending
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
          const panelShadow =
            "shadow-[inset_0_0px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.08),0_10px_20px_-8px_rgba(0,0,0,0.05),0_3px_6px_-2px_rgba(0,0,0,0.04)]";

          const listing = bucket.listing ?? [];
          const plan = planDialog?.kind === "sell" ? jupiterSellPlan : jupiterBuyPlan;

          // Buy-side derived values for the panel
          const buySol = parseFloat(jupiterSol);
          const buyUsd = Number.isFinite(buySol) ? solToUsd(buySol, solUsd) : null;
          const buyBelowMin =
            Number.isFinite(buySol) && buySol > 0 && minSwapSol > 0 && buySol < minSwapSol;

          // Sell-side derived values for the panel
          const sellParsed = parseFloat(sellSol);
          const sellUsd = Number.isFinite(sellParsed) ? solToUsd(sellParsed, solUsd) : null;
          const sellAvailable = position?.availableToWithdraw ?? 0;
          const sellAvailableUsd = solToUsd(sellAvailable, solUsd);
          const sellOverMax = Number.isFinite(sellParsed) && sellParsed > sellAvailable + 1e-9;
          const sellBelowMin =
            Number.isFinite(sellParsed) && sellParsed > 0 && minSwapSol > 0 && sellParsed < minSwapSol;
          const sellNonPositive = !Number.isFinite(sellParsed) || sellParsed <= 0;

          return (
            <>
              {/* Header bar */}
              <div className="rounded-[1.25rem] px-5 py-4 mb-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="min-w-[220px]">
                    <div className="flex items-center gap-2 px-2 py-2 bg-[#f8f9f7] rounded-lg shadow-[inset_0_2px_1px_rgba(255,255,255,0.8),inset_0_0_0_1px_rgba(255,255,255,0.5),0_0_0_1px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.04)]">
                      <div className="bg-[#4ade80] p-1.5 rounded-[8px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(74,222,128,0.3)] shrink-0">
                        <CodeXml className="w-4 h-4 text-white stroke-[2.5]" />
                      </div>
                      <h1 className="text-[18px] font-semibold text-[#1a1c1e] tracking-tight truncate">
                        {bucket.name}
                      </h1>
                    </div>
                    <p className="text-[11px] text-[#9ca3af] font-mono mt-1 break-all">
                      {bucket.type} · id {bucket.id.slice(0, 8)}…
                    </p>
                  </div>

                  <div className="flex-1 flex items-center pl-8">
                    <div className="flex items-center gap-12 flex-wrap">
                      <div className="flex flex-col">
                        <div className="text-[12px] font-normal text-[#9ca3af] uppercase tracking-tight mb-0.5">
                          Min basket size
                        </div>
                        <div className="text-[15px] font-semibold text-[#1a1c1e] tabular-nums">
                          {minSwapSol > 0 ? formatUsd(minSwapUsd) : "—"}
                        </div>
                        <div className="text-[10px] text-[#9ca3af] font-mono">
                          {minSwapSol > 0 ? `${minSwapSol.toFixed(4)} SOL` : ""}
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <div className="text-[12px] font-normal text-[#9ca3af] uppercase tracking-tight mb-0.5">
                          Estimated APY
                        </div>
                        <div className="text-[15px] font-semibold text-[#1a1c1e] tabular-nums">
                          {String(bucket.estimated_apy)}%
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <div className="text-[12px] font-normal text-[#9ca3af] uppercase tracking-tight mb-0.5">
                          TVL
                        </div>
                        <div className="text-[15px] font-semibold text-[#1a1c1e] tabular-nums">
                          {formatUsd(tvlUsd)}
                        </div>
                        <div className="text-[10px] text-[#9ca3af] font-mono">
                          {tvlSol.toFixed(6)} SOL
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <div className="text-[12px] font-normal text-[#9ca3af] uppercase tracking-tight mb-0.5">
                          Creator
                        </div>
                        <div className="text-[15px] font-semibold text-[#1a1c1e]">
                          {bucket.creator?.username || "Unknown"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {asOfLine && solUsd !== null && (
                  <p className="text-[10px] text-[#9ca3af] mt-2 pl-1">
                    USD figures {asOfLine} — actual fills depend on slippage at execution.
                  </p>
                )}
              </div>

              {/* Creator-side notice (only renders when viewing your own bucket and unverified) */}
              {user?.id === bucket.creatorId && (
                <div className="mb-4">
                  <CreatorVerificationStatus variant="banner" />
                </div>
              )}

              {/* Resumable attempts (PENDING/PARTIAL for this bucket) */}
              {user && resumableAttempts.length > 0 && (
                <div className="mb-4 rounded-[1.25rem] border border-amber-300/60 bg-amber-50/60 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[14px] font-semibold text-amber-900">
                      Pending basket{resumableAttempts.length === 1 ? "" : "s"} to finish
                    </h3>
                    <span className="text-[11px] font-mono text-amber-800/70">
                      {resumableAttempts.length} attempt{resumableAttempts.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="text-[12px] text-amber-900/80 mb-3 leading-snug">
                    Some legs didn't land (slippage, expiry, or you skipped them). Resume re-quotes only the missing legs — successful legs already count toward your position.
                  </p>
                  <ul className="space-y-3">
                    {resumableAttempts.map((a) => {
                      const successLegs = a.legs.filter((l) => l.status === "SUCCESS");
                      const missingLegs = a.legs.filter((l) => l.status === "PENDING" || l.status === "FAILED");
                      const isBuy = a.direction === "BUY";
                      return (
                        <li key={a.id} className="rounded-xl border border-amber-200 bg-white/80 px-3 py-2.5">
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
                                Missing:{" "}
                                {missingLegs.map((l) => l.symbol ?? l.mint.slice(0, 4)).join(", ")}.
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

              {/* Last partial-fill summary */}
              {partialResult && (
                <div className="mb-4 rounded-[1.25rem] border border-blue-300/70 bg-blue-50/70 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[14px] font-semibold text-blue-900">
                      {partialResult.direction === "BUY" ? "Buy" : "Sell"} partially filled
                    </h3>
                    <span className="text-[11px] font-mono text-blue-800/70">
                      {partialResult.successCount} ok · {partialResult.failedCount} failed
                    </span>
                  </div>
                  <p className="text-[12px] text-blue-900/80 mb-3 leading-snug">
                    Only the legs that landed on-chain counted toward your position. Resume the missing legs now, or skip — they'll stay in "Pending baskets" above.
                  </p>
                  <ul className="space-y-1 mb-3">
                    {partialResult.legs.map((l) => (
                      <li key={l.legId} className="flex items-start justify-between text-[12px]">
                        <span className="text-blue-900 font-medium">{l.symbol ?? l.legId.slice(0, 6)}</span>
                        <span
                          className={l.status === "SUCCESS" ? "text-emerald-700 font-mono" : "text-red-700 font-mono"}
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

              {/* Main 3-column section */}
              <div className="flex gap-4 w-full" style={{ minHeight: "60vh" }}>
                {/* Left chart area (50%) */}
                <div className="w-1/2">
                  <div className={["h-full rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")}>
                    <div className="h-full rounded-[1rem] border border-black/8 bg-[#f4f4f4] shadow-[inset_0_2px_4px_rgba(0,0,0,0.04)] flex flex-col items-center justify-center gap-2">
                      <p className="text-[14px] font-semibold text-[#6b7280] tracking-tight">Chart coming soon</p>
                      {position && (
                        <div className="text-[12px] text-[#9ca3af]">
                          Your position: <span className="font-semibold text-[#374151]">
                            {formatUsd(solToUsd(position.availableToWithdraw, solUsd))}
                          </span>{" "}
                          ({position.availableToWithdraw.toFixed(6)} SOL)
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Middle column (20%) */}
                <div className="w-[24%] min-w-[280px] flex flex-col gap-4">
                  {/* Allocation panel */}
                  <div className={["rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")} style={{ minHeight: "260px" }}>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-[14px] font-semibold text-[#374151] tracking-tight">Allocations</h2>
                      <span className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">
                        {listing.length} asset{listing.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="space-y-3 overflow-auto pr-1" style={{ maxHeight: "320px" }}>
                      {listing.length === 0 ? (
                        <p className="text-[13px] text-[#6b7280]">No assets yet.</p>
                      ) : (
                        listing.map((l) => {
                          const asset = l.asset as { symbol?: string; name?: string; iconUrl?: string } | undefined;
                          const info = tokenInfoMap[l.assetId] ?? null;
                          const rawSymbol = info?.symbol ?? asset?.symbol ?? l.assetId.slice(0, 6);
                          const symbol = displayTokenSymbol(l.assetId, rawSymbol) ?? rawSymbol;
                          const rawName = info?.name ?? asset?.name ?? null;
                          const name = displayTokenName(l.assetId, rawName);
                          const iconUrl = info?.iconUrl || asset?.iconUrl || "";
                          const pctNum = typeof l.percentage === "number" ? l.percentage : parseFloat(String(l.percentage));
                          const pct = Number.isFinite(pctNum) ? pctNum : 0;
                          const allocSol = (tvlSol * pct) / 100;
                          const allocUsd = solToUsd(allocSol, solUsd);
                          const isSol = l.assetId === SOL_MINT;
                          const verified = isSol || info?.isVerified;
                          const sus = !isSol && info?.isSus;
                          return (
                            <div key={l.id} className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-[10px] bg-white border border-black/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] flex items-center justify-center overflow-hidden shrink-0">
                                {iconUrl ? (
                                  <img
                                    src={iconUrl}
                                    alt={symbol}
                                    className="w-5 h-5"
                                    loading="lazy"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.opacity = "0.3";
                                    }}
                                  />
                                ) : (
                                  <Coins className="w-4 h-4 text-[#9ca3af]" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1 min-w-0">
                                    <span className="text-[13px] font-semibold text-[#1a1c1e] truncate">{symbol}</span>
                                    {verified && (
                                      <span
                                        title={info?.organicScoreLabel ? `Jupiter-verified · trust score: ${info.organicScoreLabel}.` : "Jupiter-verified token."}
                                        className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-semibold border border-emerald-200 shrink-0"
                                      >
                                        <ShieldCheck className="w-2.5 h-2.5" />
                                      </span>
                                    )}
                                    {sus && (
                                      <span
                                        title="Not on Jupiter's verified list and has on-chain risk signals. Treat with caution."
                                        className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-red-50 text-red-700 text-[9px] font-semibold border border-red-200 shrink-0"
                                      >
                                        <ShieldAlert className="w-2.5 h-2.5" />
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[12px] font-semibold text-[#6b7280] tabular-nums shrink-0">
                                    {pct.toFixed(0)}%
                                  </span>
                                </div>
                                {name && name !== symbol && (
                                  <div className="text-[10px] text-[#9ca3af] truncate">{name}</div>
                                )}
                                <div className="mt-1 h-2 rounded-full bg-black/5 shadow-[inset_0_1px_1px_rgba(0,0,0,0.06)] overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-[#1a1c1e]/20"
                                    style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                                  />
                                </div>
                                {allocUsd !== null && (
                                  <div className="text-[10px] text-[#9ca3af] mt-0.5 tabular-nums">
                                    {formatUsd(allocUsd)} of TVL
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Buy / Sell panel */}
                  <div className={["rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")}>
                    <h2 className="text-[14px] font-semibold text-[#374151] tracking-tight mb-3">Buy / Sell</h2>

                    {!user ? (
                      <p className="text-[13px] text-[#6b7280]">Connect your wallet to invest.</p>
                    ) : !published ? (
                      <p className="text-[13px] text-[#6b7280]">
                        {user?.id === bucket.creatorId
                          ? "Publish the bucket to enable trading."
                          : "This bucket isn't published yet."}
                      </p>
                    ) : !config?.jupiterEnabled ? (
                      <p className="text-[13px] text-[#6b7280]">Jupiter is not enabled on this server.</p>
                    ) : (
                      <div className="space-y-4">
                        {/* Buy */}
                        <div>
                          <div className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">
                            Buy (mainnet)
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="any"
                              min={minSwapSol || 0}
                              value={jupiterSol}
                              onChange={(e) => {
                                setJupiterSol(e.target.value);
                                setJupiterBuyPlan(null);
                              }}
                              className="flex-1 px-3 py-2 rounded-[10px] border border-black/10 bg-white text-[13px] tabular-nums"
                              placeholder="SOL"
                            />
                            <button
                              type="button"
                              disabled={Boolean(busy) || buyBelowMin || !Number.isFinite(buySol) || buySol <= 0}
                              onClick={() => void buildJupiterBuyPlan()}
                              className="px-3 py-2 rounded-[10px] bg-[#1a1c1e] text-white text-[13px] font-semibold disabled:opacity-50"
                            >
                              Build
                            </button>
                          </div>
                          <p className="text-[11px] text-[#6b7280] mt-1">
                            ≈ <span className="font-semibold text-[#1a1c1e]">{formatUsd(buyUsd)}</span>{" "}
                            {asOfLine && solUsd !== null && (
                              <span className="text-[#9ca3af]">· {asOfLine}</span>
                            )}
                          </p>
                          {minSwapSol > 0 && (
                            <p className={`text-[11px] ${buyBelowMin ? "text-red-600" : "text-[#9ca3af]"} mt-0.5`}>
                              Min: {formatUsd(minSwapUsd)} ({minSwapSol.toFixed(4)} SOL)
                              {buyBelowMin && " — raise the amount"}
                            </p>
                          )}
                        </div>

                        <div className="h-px w-[calc(100%+40px)] -ml-5 bg-black/5 shadow-[0_1.5px_0_white]" />

                        {/* Sell */}
                        <div>
                          <div className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">
                            Sell
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="any"
                              min={minSwapSol || 0}
                              max={sellAvailable}
                              value={sellSol}
                              onChange={(e) => {
                                setSellSol(e.target.value);
                                setJupiterSellPlan(null);
                              }}
                              className="flex-1 px-3 py-2 rounded-[10px] border border-black/10 bg-white text-[13px] tabular-nums"
                              placeholder="SOL out"
                            />
                            <button
                              type="button"
                              onClick={() => setSellSol(String(sellAvailable))}
                              disabled={sellAvailable <= 0}
                              className="px-2 py-2 rounded-[10px] border border-black/10 bg-white text-[11px] font-semibold text-[#374151] disabled:opacity-50"
                            >
                              Max
                            </button>
                            <button
                              type="button"
                              disabled={
                                Boolean(busy) || sellOverMax || sellNonPositive || sellBelowMin
                              }
                              onClick={() => void buildJupiterSellPlan()}
                              className="px-3 py-2 rounded-[10px] bg-[#374151] text-white text-[13px] font-semibold disabled:opacity-50"
                            >
                              Build
                            </button>
                          </div>
                          <p className="text-[11px] text-[#6b7280] mt-1">
                            ≈ <span className="font-semibold text-[#1a1c1e]">{formatUsd(sellUsd)}</span>{" "}
                            {asOfLine && solUsd !== null && (
                              <span className="text-[#9ca3af]">· {asOfLine}</span>
                            )}
                          </p>
                          <p className="text-[11px] text-[#9ca3af] mt-0.5">
                            Available: <span className="text-[#374151] font-semibold">{formatUsd(sellAvailableUsd)}</span>{" "}
                            ({sellAvailable.toFixed(4)} SOL)
                          </p>
                          {minSwapSol > 0 && sellBelowMin && (
                            <p className="text-[11px] text-red-600 mt-0.5">
                              Min: {formatUsd(minSwapUsd)} ({minSwapSol.toFixed(4)} SOL)
                            </p>
                          )}
                          {sellOverMax && (
                            <p className="text-[11px] text-red-600 mt-0.5">
                              Exceeds your available position.
                            </p>
                          )}
                        </div>

                        {slippageBlock}

                        <p className="text-[10px] text-[#9ca3af]">
                          Submit on {rpcDisplayHost(getJupiterSubmitRpcUrl())}.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right column (research docs) */}
                <div className="flex-1 min-w-[320px]">
                  <div className={["h-full rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")}>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-[14px] font-semibold text-[#374151] tracking-tight">Research</h2>
                      <span className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">
                        {published ? "Published" : "Draft"}
                      </span>
                    </div>
                    <div className="overflow-auto pr-1" style={{ maxHeight: "55vh" }}>
                      {published && bucket.researchDoc?.trim() ? (
                        <div className="rounded-[1rem] border border-black/6 bg-white/70 px-5 py-4">
                          <ReactMarkdown components={researchMarkdownComponents}>
                            {bucket.researchDoc.trim()}
                          </ReactMarkdown>
                          <p className="text-[10px] text-[#9ca3af] mt-4 pt-3 border-t border-black/5">
                            Written by the creator before publishing. Locked once published — investors read exactly what was in front of earlier buyers.
                          </p>
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

              {/* Bottom: my history table */}
              <div className={["mt-4 rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")}>
                <div className="flex items-center justify-between gap-4 mb-3">
                  <h2 className="text-[14px] font-semibold text-[#374151] tracking-tight">My history</h2>
                  <span className="text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wider">
                    {user ? "Latest" : "Connect wallet"}
                  </span>
                </div>

                {!user ? (
                  <div className="text-[13px] text-[#6b7280]">Connect wallet to see your buy/sell history.</div>
                ) : positionErr ? (
                  <div className="text-[13px] text-[#6b7280]">Could not load position: {positionErr}</div>
                ) : myDepositsErr ? (
                  <div className="text-[13px] text-[#6b7280]">Could not load history: {myDepositsErr}</div>
                ) : myDeposits.length === 0 ? (
                  <div className="text-[13px] text-[#6b7280]">No activity yet.</div>
                ) : (
                  <div className="rounded-[1rem] border border-black/8 bg-white/70 overflow-hidden">
                    <div className="grid grid-cols-[120px_1fr_160px] gap-0 text-[12px] font-semibold uppercase tracking-wider text-[#9ca3af] border-b border-black/8">
                      <div className="px-4 py-3">Type</div>
                      <div className="px-4 py-3">When</div>
                      <div className="px-4 py-3 text-right">Amount</div>
                    </div>
                    <div className="max-h-[260px] overflow-auto">
                      {myDeposits.slice(0, 24).map((d) => {
                        const sol = Number(d.amount);
                        const usd = solToUsd(sol, solUsd);
                        return (
                          <div
                            key={d.id}
                            className="grid grid-cols-[120px_1fr_160px] text-[13px] border-b border-black/6 last:border-b-0"
                          >
                            <div className="px-4 py-3 font-semibold text-[#1a1c1e]">Buy</div>
                            <div className="px-4 py-3 text-[#6b7280] font-medium">
                              {new Date(d.createdAt).toLocaleString()}
                            </div>
                            <div className="px-4 py-3 text-right text-[#1a1c1e] font-semibold tabular-nums">
                              {formatUsd(usd)}
                              <span className="text-[#9ca3af] font-mono ml-2">{sol.toFixed(4)} SOL</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Devnet treasury invest (only on devnet) */}
              {user && published && config?.treasuryInvestEnabled && (
                <div className={["mt-4 rounded-[1.25rem] bg-[#f8f9f7] p-5", panelShadow].join(" ")}>
                  <h2 className="text-[14px] font-semibold text-[#374151] tracking-tight mb-2">
                    Devnet treasury invest
                  </h2>
                  <p className="text-[12px] text-[#6b7280] mb-3">
                    Gross SOL sent to treasury; server verifies on RPC ({getSolanaRpcUrl()}). Use a devnet wallet.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#374151] mb-1">Treasury (base58)</label>
                      <input
                        value={treasuryInput}
                        onChange={(e) => setTreasuryInput(e.target.value)}
                        placeholder="Treasury pubkey"
                        className="px-3 py-2 rounded-[10px] border border-black/10 bg-white text-[12px] font-mono w-[300px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#374151] mb-1">Amount (SOL)</label>
                      <input
                        type="number"
                        step="any"
                        value={investSol}
                        onChange={(e) => setInvestSol(e.target.value)}
                        className="px-3 py-2 rounded-[10px] border border-black/10 bg-white text-[12px] tabular-nums w-[140px]"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void onTreasuryInvest()}
                      className="px-4 py-2 rounded-[10px] bg-[#1a1c1e] text-white text-[13px] font-semibold disabled:opacity-50"
                    >
                      Sign & invest
                    </button>
                  </div>
                </div>
              )}

              {/* Plan dialog */}
              {planDialog && plan && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                  <button
                    type="button"
                    className="absolute inset-0 bg-black/30"
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
                          Review legs, fees, and slippage — then confirm to sign in your wallet.
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
                        <h4 className="text-[14px] font-semibold text-[#374151] tracking-tight">Legs</h4>
                        <span className="text-[12px] font-semibold uppercase tracking-wider text-[#9ca3af]">
                          {planDialog.kind === "buy" ? "Jupiter buy" : "Jupiter sell"}
                        </span>
                      </div>
                      <div className="space-y-2 mb-4">
                        {plan.legs.map((leg, i) => {
                          const mint =
                            (leg as unknown as { outputMint?: string }).outputMint ||
                            (leg as unknown as { inputMint?: string }).inputMint ||
                            "";
                          const row = listing.find((r) => r.assetId === mint);
                          const asset = row?.asset as { decimals?: number; symbol?: string } | undefined;
                          const info = mint ? tokenInfoMap[mint] : null;
                          const decimals = info?.decimals ?? (typeof asset?.decimals === "number" ? asset.decimals : 6);
                          const tokenPriceUsd = mint ? priceMap[mint]?.price ?? null : null;
                          const sym = displayTokenSymbol(mint, info?.symbol ?? asset?.symbol ?? leg.symbol ?? null) ?? leg.symbol ?? "?";
                          if (leg.kind === "swap") {
                            const raw =
                              planDialog.kind === "sell"
                                ? (leg as unknown as { estInputAmount?: string }).estInputAmount
                                : (leg as unknown as { expectedOutAmount?: string }).expectedOutAmount;
                            const n = Number(raw ?? "0");
                            const tokenAmt = Number.isFinite(n) && decimals > 0 ? n / Math.pow(10, decimals) : null;
                            const usd = tokenAmt !== null && tokenPriceUsd !== null ? tokenAmt * tokenPriceUsd : null;
                            return (
                              <div key={i} className="flex items-baseline justify-between text-[13px]">
                                <span className="text-[#374151] font-semibold">
                                  {planDialog.kind === "sell" ? `Sell ${sym}` : `Buy ${sym}`}
                                </span>
                                <span className="text-right">
                                  {usd !== null && (
                                    <span className="text-[#1a1c1e] font-semibold">{formatUsd(usd)}</span>
                                  )}
                                  <span className="font-mono text-[#9ca3af] ml-2">~{formatBaseUnits(raw, decimals, 4)}</span>
                                </span>
                              </div>
                            );
                          }
                          const sol = ((leg as unknown as { inputLamports?: number }).inputLamports ?? 0) / 1e9;
                          const usd = solToUsd(sol, solUsd);
                          return (
                            <div key={i} className="flex items-baseline justify-between text-[13px]">
                              <span className="text-[#374151] font-semibold">Keep {sym}</span>
                              <span className="text-right">
                                {usd !== null && (
                                  <span className="text-[#1a1c1e] font-semibold">{formatUsd(usd)}</span>
                                )}
                                <span className="font-mono text-[#9ca3af] ml-2">{sol.toFixed(4)} SOL</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="h-px w-[calc(100%+40px)] -ml-5 my-4 bg-black/5 shadow-[0_1.5px_0_white]" />

                      <div className="flex items-baseline justify-between text-[12px] text-[#6b7280] mb-1 font-semibold">
                        <span>Max slippage</span>
                        <span className="text-[#1a1c1e] tabular-nums">
                          {(((plan.slippageBps ?? slippageBps) as number) / 100).toFixed(2)}%
                        </span>
                      </div>
                      {plan.feeTransfer && (
                        <div className="flex items-baseline justify-between text-[12px] text-[#6b7280] mb-1">
                          <span>Platform / creator fee</span>
                          <span className="text-[#1a1c1e] tabular-nums">
                            {formatUsd(solToUsd((plan.feeTransfer.totalLamports ?? 0) / 1e9, solUsd))}
                            <span className="font-mono text-[#9ca3af] ml-2">
                              {((plan.feeTransfer.totalLamports ?? 0) / 1e9).toFixed(6)} SOL
                            </span>
                          </span>
                        </div>
                      )}
                      {!plan.feeTransfer && plan.feeTransferSkippedReason && (
                        <div className="mt-2 mb-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200/70 rounded-lg p-2 leading-snug">
                          {plan.feeTransferSkippedReason}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-4">
                      {planDialog.kind === "buy" ? (
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void executeJupiterBuyPlan()}
                          className="flex-1 px-4 py-2 rounded-[10px] bg-[#1a1c1e] text-white text-[13px] font-semibold disabled:opacity-50"
                        >
                          Confirm &amp; Execute
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void executeJupiterSellPlan()}
                          className="flex-1 px-4 py-2 rounded-[10px] bg-[#374151] text-white text-[13px] font-semibold disabled:opacity-50"
                        >
                          Confirm &amp; Execute
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

        {!published && user?.id === bucket?.creatorId && (
          <p className="mt-6 text-[13px] text-[#6b7280]">
            Draft bucket —{" "}
            <button
              type="button"
              className="underline font-semibold"
              onClick={() => navigate(`/buckets/${encodeURIComponent(bucket!.id)}/research`)}
            >
              continue to research &amp; publish
            </button>
            . Draft id:{" "}
            <code className="text-[12px]">
              {typeof localStorage !== "undefined" ? localStorage.getItem(DRAFT_LS) : ""}
            </code>
          </p>
        )}
      </div>

      <ConnectWalletModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} />
    </Layout>
  );
}
