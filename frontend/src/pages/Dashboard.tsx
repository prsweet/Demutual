import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { BucketGrid } from "../components/BucketGrid";
import { ConnectWalletModal } from "../components/ConnectWalletModal";
import type { BucketCardProps } from "../components/BucketCard";
import { useAuth } from "../context/AuthContext";
import { fetchPublishedBuckets } from "../lib/api";
import type { ApiBucket } from "../lib/types";
import { lamportsToSol, solToUsd } from "../lib/money";
import { SOL_MINT, usePrices } from "../lib/usePrices";
import { 
  Coins, 
  TrendingUp, 
  Wallet, 
  PieChart, 
  Gem, 
  Activity, 
  Landmark, 
  Bitcoin, 
  Rocket, 
  Blocks
} from "lucide-react";

const ICONS: React.ElementType[] = [Coins, TrendingUp, Wallet, PieChart, Gem, Activity, Landmark, Bitcoin, Rocket, Blocks];

function formatApy(apy: string | number): string {
  const n = typeof apy === "string" ? parseFloat(apy) : apy;
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function toCardProps(b: ApiBucket, index: number, solUsd: number | null): BucketCardProps {
  const meta = b.metaData && typeof b.metaData === "object" ? (b.metaData as { description?: string }) : null;
  const desc = meta?.description?.trim() || "A diverse basket of assets on Solana.";
  const assetsCount = b.listing?.length ?? 0;

  const Icon = ICONS[index % ICONS.length] ?? Coins;

  const minSwapLamports = b.limits?.minSwapLamports ?? 0;
  const minBasketSol = minSwapLamports > 0 ? lamportsToSol(minSwapLamports) : undefined;
  const minBasketUsd =
    minBasketSol !== undefined ? solToUsd(minBasketSol, solUsd) : null;

  return {
    id: b.id,
    title: b.name,
    description: desc,
    apy: formatApy(b.estimated_apy),
    creatorName: b.creator?.username,
    assetsCount,
    icon: <Icon className="w-5 h-5 text-white stroke-[2.5]" />,
    ...(minBasketSol !== undefined ? { minBasketSol } : {}),
    minBasketUsd
  };
}

export function Dashboard() {
  const { user, logout } = useAuth();
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  /** Raw bucket rows from the API — we re-derive card props whenever SOL price updates. */
  const [rawBuckets, setRawBuckets] = useState<ApiBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // One usePrices call for the whole grid — every card reads the same solUsd value.
  const { prices } = usePrices([SOL_MINT]);
  const solUsd = prices[SOL_MINT]?.price ?? null;

  const buckets: BucketCardProps[] = useMemo(
    () => rawBuckets.map((b, i) => toCardProps(b, i, solUsd)),
    [rawBuckets, solUsd]
  );

  const loadBuckets = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const page = await fetchPublishedBuckets({ limit: 50, offset: 0 });
      setRawBuckets(page.data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load buckets");
      setRawBuckets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBuckets();
  }, [loadBuckets]);

  const layoutUser = user ? { name: user.username, walletAddress: user.walletAddress } : undefined;

  return (
    <Layout
      onConnectWallet={() => setIsWalletOpen(true)}
      onDisconnect={() => void logout()}
      user={layoutUser}
    >
      <div className="max-w-full mx-auto w-full min-h-full">
        {loadError && (
          <div className="mx-8 mt-6 rounded-[12px] border border-amber-200/90 bg-amber-50/90 px-4 py-3 text-[14px] font-medium text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
            {loadError}
            <button
              type="button"
              onClick={() => void loadBuckets()}
              className="ml-3 underline font-semibold text-amber-950"
            >
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-[220px] rounded-2xl bg-[#f8f9f7] animate-pulse
                shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.05)]"
              />
            ))}
          </div>
        ) : (
          <BucketGrid
            buckets={buckets}
            emptyLabel="No published buckets yet. Create one and publish it from the creator flow."
          />
        )}
      </div>

      <ConnectWalletModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} />
    </Layout>
  );
}
