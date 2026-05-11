import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Layout } from "../components/Layout";
import { ConnectWalletModal } from "../components/ConnectWalletModal";
import { CreatorVerificationStatus } from "../components/CreatorVerificationStatus";
import { useAuth } from "../context/AuthContext";
import { fetchCreatorBuckets } from "../lib/api";
import type { ApiBucket } from "../lib/types";
import { AlertCircle, Loader2, Plus } from "lucide-react";

const DRAFT_LS = "demutual_draft_bucket_id";

export function MyBucketsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [drafts, setDrafts] = useState<ApiBucket[]>([]);
  const [published, setPublished] = useState<ApiBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const layoutUser = user ? { name: user.username, walletAddress: user.walletAddress } : undefined;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [dPage, pPage] = await Promise.all([
        fetchCreatorBuckets(user.id, { status: "DRAFT", limit: 50, offset: 0 }),
        fetchCreatorBuckets(user.id, { status: "PUBLISHED", limit: 50, offset: 0 })
      ]);
      setDrafts(dPage.data);
      setPublished(pPage.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load buckets");
      setDrafts([]);
      setPublished([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const rememberDraft = (id: string) => {
    localStorage.setItem(DRAFT_LS, id);
  };

  if (!user) {
    return (
      <Layout
        title="My buckets"
        onConnectWallet={() => setIsWalletOpen(true)}
        onDisconnect={() => void logout()}
        user={layoutUser}
      >
        <div className="max-w-2xl mx-auto p-8">
          <p className="text-[15px] text-[#6b7280] font-medium mb-4">Connect to list buckets you created.</p>
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
      title="My buckets"
      onConnectWallet={() => setIsWalletOpen(true)}
      onDisconnect={() => void logout()}
      user={layoutUser}
    >
      <div className="max-w-3xl mx-auto w-full p-8 pb-16 tracking-tight space-y-8">
        <CreatorVerificationStatus variant="banner" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-[14px] text-[#6b7280]">
            Drafts and published baskets for <span className="font-semibold text-[#374151]">{user.username}</span>.
          </p>
          <button
            type="button"
            onClick={() => navigate("/create-bucket")}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[#1a1c1e] text-white text-[14px] font-semibold"
          >
            <Plus className="w-4 h-4" />
            New bucket
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-[12px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 text-[13px] font-medium text-red-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <p className="text-[14px] text-[#6b7280] flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <section
              className="rounded-2xl p-6 bg-[#f8f9f7] shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.08)]"
            >
              <h2 className="text-[16px] font-semibold text-[#1a1c1e] mb-4">Drafts</h2>
              {drafts.length === 0 ? (
                <p className="text-[14px] text-[#6b7280]">No drafts. Create one from the button above.</p>
              ) : (
                <ul className="space-y-2">
                  {drafts.map((b) => (
                    <li
                      key={b.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-black/8 bg-white px-4 py-3"
                    >
                      <div>
                        <p className="text-[15px] font-semibold text-[#1a1c1e]">{b.name}</p>
                        <p className="text-[11px] font-mono text-[#9ca3af]">{b.id}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/buckets/${encodeURIComponent(b.id)}/research`}
                          className="text-[13px] font-semibold text-[#1a1c1e] hover:underline"
                        >
                          Continue research
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            rememberDraft(b.id);
                            navigate("/create-bucket");
                          }}
                          className="text-[13px] font-semibold text-[#6b7280] hover:text-[#1a1c1e] underline"
                        >
                          Set as active draft
                        </button>
                        <Link
                          to={`/buckets/${encodeURIComponent(b.id)}`}
                          className="text-[13px] font-semibold text-[#374151] hover:underline"
                        >
                          Open
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              className="rounded-2xl p-6 bg-[#f8f9f7] shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.08)]"
            >
              <h2 className="text-[16px] font-semibold text-[#1a1c1e] mb-4">Published</h2>
              {published.length === 0 ? (
                <p className="text-[14px] text-[#6b7280]">Nothing published yet.</p>
              ) : (
                <ul className="space-y-2">
                  {published.map((b) => (
                    <li
                      key={b.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-black/8 bg-white px-4 py-3"
                    >
                      <div>
                        <p className="text-[15px] font-semibold text-[#1a1c1e]">{b.name}</p>
                        <p className="text-[12px] text-[#6b7280]">TVL {String(b.tvl)} · APY {String(b.estimated_apy)}%</p>
                      </div>
                      <Link
                        to={`/buckets/${encodeURIComponent(b.id)}`}
                        className="text-[13px] font-semibold text-[#1a1c1e] hover:underline"
                      >
                        View / invest
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <ConnectWalletModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} />
    </Layout>
  );
}
