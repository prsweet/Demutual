import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Layout } from "../components/Layout";
import { ConnectWalletModal } from "../components/ConnectWalletModal";
import { useAuth } from "../context/AuthContext";
import { useServerConfig } from "../context/ServerConfigContext";
import { fetchMyDeposits, postLedgerWithdraw, requestDevnetAirdrop } from "../lib/api";
import type { DepositRow } from "../lib/types";
import { AlertCircle, ExternalLink, Loader2, RefreshCw } from "lucide-react";

function formatAmount(a: string | number): string {
  const n = typeof a === "string" ? parseFloat(a) : a;
  if (!Number.isFinite(n)) return String(a);
  return n.toLocaleString(undefined, { maximumFractionDigits: 9 });
}

export function PortfolioPage() {
  const { user, logout } = useAuth();
  const { config } = useServerConfig();
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [withdrawBucketId, setWithdrawBucketId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState<string | null>(null);

  const [airdropBusy, setAirdropBusy] = useState(false);
  const [airdropMsg, setAirdropMsg] = useState<string | null>(null);

  const layoutUser = user ? { name: user.username, walletAddress: user.walletAddress } : undefined;
  const isDevnet = config?.network === "devnet";

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchMyDeposits({ limit: 100, offset: 0 });
      setDeposits(page.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deposits");
      setDeposits([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const onWithdraw = async () => {
    if (!user) {
      setIsWalletOpen(true);
      return;
    }
    const id = withdrawBucketId.trim();
    const amt = parseFloat(withdrawAmount);
    if (!id || !Number.isFinite(amt) || amt <= 0) {
      setWithdrawMsg("Enter bucket id and a positive amount.");
      return;
    }
    setWithdrawBusy(true);
    setWithdrawMsg(null);
    try {
      await postLedgerWithdraw(id, amt);
      setWithdrawMsg("Withdrawal recorded.");
      setWithdrawAmount("");
      await load();
    } catch (e) {
      setWithdrawMsg(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setWithdrawBusy(false);
    }
  };

  const onAirdrop = async () => {
    if (!user?.walletAddress) {
      setIsWalletOpen(true);
      return;
    }
    setAirdropBusy(true);
    setAirdropMsg(null);
    try {
      const { signature } = await requestDevnetAirdrop(user.walletAddress, 1);
      setAirdropMsg(`Airdrop sent. Sig: ${signature.slice(0, 12)}…`);
    } catch (e) {
      setAirdropMsg(e instanceof Error ? e.message : "Airdrop failed");
    } finally {
      setAirdropBusy(false);
    }
  };

  if (!user) {
    return (
      <Layout
        title="Portfolio"
        onConnectWallet={() => setIsWalletOpen(true)}
        onDisconnect={() => void logout()}
        user={layoutUser}
      >
        <div className="max-w-2xl mx-auto p-8">
          <p className="text-[15px] text-[#6b7280] font-medium mb-4">Sign in to see deposits and ledger withdrawals.</p>
          <button
            type="button"
            onClick={() => setIsWalletOpen(true)}
            className="px-5 py-2.5 rounded-[10px] bg-[#1a1c1e] text-white text-[14px] font-semibold"
          >
            Connect wallet
          </button>
        </div>
        <ConnectWalletModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} />
      </Layout>
    );
  }

  return (
    <Layout
      title="Portfolio"
      onConnectWallet={() => setIsWalletOpen(true)}
      onDisconnect={() => void logout()}
      user={layoutUser}
    >
      <div className="max-w-4xl mx-auto w-full p-8 pb-16 tracking-tight space-y-8">
        {error && (
          <div className="flex items-start gap-2 rounded-[12px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 text-[13px] font-medium text-red-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isDevnet && (
          <div
            className="rounded-2xl p-6 bg-[#f8f9f7] shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.08)]"
          >
            <h2 className="text-[16px] font-semibold text-[#1a1c1e] mb-2">Devnet SOL</h2>
            <p className="text-[13px] text-[#6b7280] mb-4">
              Request test SOL for <span className="font-mono text-[12px]">{user.walletAddress.slice(0, 8)}…</span> via the
              server faucet.
            </p>
            <button
              type="button"
              disabled={airdropBusy}
              onClick={() => void onAirdrop()}
              className="px-4 py-2 rounded-[10px] bg-[#1a1c1e] text-white text-[14px] font-semibold disabled:opacity-50 inline-flex items-center gap-2"
            >
              {airdropBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Request airdrop (1 SOL)
            </button>
            {airdropMsg && <p className="text-[13px] text-[#374151] mt-3 font-medium">{airdropMsg}</p>}
          </div>
        )}

        <div
          className="rounded-2xl p-6 bg-[#f8f9f7] shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.08)]"
        >
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-[16px] font-semibold text-[#1a1c1e]">My deposits</h2>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[10px] border border-black/10 bg-white text-[13px] font-semibold text-[#374151] disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
          {loading && deposits.length === 0 ? (
            <p className="text-[14px] text-[#6b7280] flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </p>
          ) : deposits.length === 0 ? (
            <p className="text-[14px] text-[#6b7280]">No deposits yet. Invest from a bucket detail page.</p>
          ) : (
            <div className="overflow-x-auto rounded-[12px] border border-black/8 bg-white">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[#6b7280] border-b border-black/8">
                    <th className="p-3 font-semibold">Bucket</th>
                    <th className="p-3 font-semibold">Amount</th>
                    <th className="p-3 font-semibold">When</th>
                    <th className="p-3 font-semibold w-10" />
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((d) => (
                    <tr key={d.id} className="border-b border-black/5 last:border-0">
                      <td className="p-3 font-medium text-[#1a1c1e]">
                        {d.bucket?.name ?? d.bucketId}
                        <div className="text-[11px] font-mono text-[#9ca3af] truncate max-w-[200px]">{d.bucketId}</div>
                      </td>
                      <td className="p-3 tabular-nums">{formatAmount(d.amount)}</td>
                      <td className="p-3 text-[#6b7280]">{new Date(d.createdAt).toLocaleString()}</td>
                      <td className="p-3">
                        <Link
                          to={`/buckets/${encodeURIComponent(d.bucketId)}`}
                          className="inline-flex text-[#1a1c1e] hover:text-[#ab9ff2]"
                          aria-label="Open bucket"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div
          className="rounded-2xl p-6 bg-[#f8f9f7] shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.08)]"
        >
          <h2 className="text-[16px] font-semibold text-[#1a1c1e] mb-2">Ledger withdraw</h2>
          <p className="text-[13px] text-[#6b7280] mb-4">
            Withdraw from your tracked position (same as client Portfolio). Use the bucket id from your deposit or from the
            marketplace.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className="block text-[12px] font-semibold text-[#374151] mb-1">Bucket id</label>
              <input
                value={withdrawBucketId}
                onChange={(e) => setWithdrawBucketId(e.target.value)}
                className="w-full px-3 py-2 rounded-[10px] border border-black/10 bg-white font-mono text-[12px]"
                placeholder="cuid…"
              />
            </div>
            <div className="w-full sm:w-40">
              <label className="block text-[12px] font-semibold text-[#374151] mb-1">Amount</label>
              <input
                type="number"
                step="any"
                min="0"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-[10px] border border-black/10 bg-white tabular-nums"
              />
            </div>
            <button
              type="button"
              disabled={withdrawBusy}
              onClick={() => void onWithdraw()}
              className="px-5 py-2.5 rounded-[10px] bg-[#374151] text-white text-[14px] font-semibold disabled:opacity-50 shrink-0"
            >
              {withdrawBusy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null} Withdraw
            </button>
          </div>
          {withdrawMsg && <p className="text-[13px] mt-3 font-medium text-[#374151]">{withdrawMsg}</p>}
        </div>
      </div>

      <ConnectWalletModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} />
    </Layout>
  );
}
