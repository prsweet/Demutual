import React, { useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { postVerifyFeeReceiver } from "../lib/api";
import { useAuth } from "../context/AuthContext";

type Variant = "panel" | "banner" | "pill";

type Props = {
  /** Visual style. `panel` = full block (CreateBucket); `banner` = thin top bar (MyBuckets); `pill` = compact sidebar status. */
  variant?: Variant;
  /** Optional className passthrough. */
  className?: string;
};

/**
 * Single source of truth for the "is your fee-receiver wallet on-chain?" UX. Used in:
 *  - CreateBucketPage (panel) — first place a creator encounters the requirement.
 *  - MyBucketsPage (banner) — passive reminder if they haven't verified.
 *  - Sidebar (pill) — always-visible status badge under user info.
 *
 * Hides itself entirely when the user is already verified OR when no user is signed in.
 */
export function CreatorVerificationStatus({ variant = "panel", className = "" }: Props) {
  const { user, refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  if (user.feeReceiverVerified && variant !== "pill") return null;

  const handleCheck = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await postVerifyFeeReceiver();
      if (result.verified && result.foundOnChain) {
        setMessage("Wallet verified — you'll receive your fee share on every investor buy from now on.");
        await refreshUser();
      } else {
        setError(
          result.message ??
            "Your wallet hasn't been used on Solana yet. Send any small amount of SOL to it and try again."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  if (variant === "pill") {
    if (user.feeReceiverVerified) {
      return (
        <div
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold ${className}`}
          title="Your fee-receiver wallet is verified on-chain."
        >
          <ShieldCheck className="w-3 h-3" /> wallet verified
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={handleCheck}
        disabled={busy}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold hover:bg-amber-100 disabled:opacity-60 ${className}`}
        title="Click to verify your fee-receiver wallet is on-chain."
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldAlert className="w-3 h-3" />}
        verify for fees
      </button>
    );
  }

  if (variant === "banner") {
    return (
      <div
        className={`rounded-[10px] border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900 leading-snug flex items-center justify-between gap-3 ${className}`}
      >
        <span>
          <span className="font-semibold">Verify your fee-receiver wallet</span> to start earning the creator share on
          investor buys. Send any small amount of SOL to your wallet first if it's brand new.
        </span>
        <button
          type="button"
          onClick={handleCheck}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-amber-900 text-amber-50 text-[12px] font-semibold hover:bg-amber-950 disabled:opacity-60"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          Check now
        </button>
      </div>
    );
  }

  // Default: full panel
  return (
    <div
      className={`rounded-[12px] border border-amber-200/70 bg-amber-50/60 p-4 space-y-2 ${className}`}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-amber-900">
            Verify your fee-receiver wallet
          </div>
          <p className="text-[12px] text-amber-900/90 leading-snug mt-1">
            Investor buys split a small fee between the platform and you (the bucket creator).
            We pay your share only after you've confirmed your wallet exists on Solana. If your
            wallet is brand new, send any small amount of SOL to it first (from an exchange or
            another wallet), then click below.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleCheck}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-amber-900 text-amber-50 text-[13px] font-semibold hover:bg-amber-950 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          Check now
        </button>
        <span className="text-[11px] text-amber-900/70 font-mono break-all">{user.walletAddress}</span>
      </div>
      {message && (
        <p className="text-[12px] text-emerald-800 bg-emerald-50/70 border border-emerald-200 rounded-[8px] px-2.5 py-1.5">
          {message}
        </p>
      )}
      {error && (
        <p className="text-[12px] text-red-700 bg-red-50/70 border border-red-200 rounded-[8px] px-2.5 py-1.5">
          {error}
        </p>
      )}
    </div>
  );
}
