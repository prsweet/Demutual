import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { Layout } from "../components/Layout";
import { ConnectWalletModal } from "../components/ConnectWalletModal";
import { ResearchDocEditor, RESEARCH_DOC_TEMPLATE } from "../components/ResearchDocEditor";
import { useAuth } from "../context/AuthContext";
import { fetchBucketById, publishBucketApi } from "../lib/api";

const ERR_HINT: Record<string, string> = {
  RESEARCH_DOC_TOO_SHORT: "Research document must be at least 100 characters (after trimming).",
  BUCKET_ALREADY_PUBLISHED: "This bucket is already published.",
  BUCKET_NOT_IN_DRAFT: "This bucket is no longer a draft.",
  BUCKET_CREATOR_REQUIRED: "Only the bucket creator can publish.",
  BUCKET_NEEDS_ASSETS_BEFORE_PUBLISH: "Add assets and allocations before publishing.",
  UNAUTHORIZED: "Sign in to publish."
};

export function BucketResearchPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [markdown, setMarkdown] = useState(RESEARCH_DOC_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  /** ready | need_wallet | not_creator */
  const [access, setAccess] = useState<"pending" | "need_wallet" | "not_creator" | "ready">("pending");

  const layoutUser = user ? { name: user.username, walletAddress: user.walletAddress } : undefined;

  const load = useCallback(async () => {
    if (!id) {
      setLoadError("Missing bucket id.");
      setLoading(false);
      setAccess("pending");
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const bucket = await fetchBucketById(id);
      if (bucket.type === "PUBLISHED") {
        navigate(`/buckets/${encodeURIComponent(id)}`, { replace: true });
        return;
      }
      if (!user) {
        setAccess("need_wallet");
        setLoading(false);
        return;
      }
      if (bucket.creatorId !== user.id) {
        setAccess("not_creator");
        setLoading(false);
        return;
      }
      setAccess("ready");
      if (bucket.researchDoc?.trim()) {
        setMarkdown(bucket.researchDoc);
      } else {
        setMarkdown(RESEARCH_DOC_TEMPLATE);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load bucket.");
      setAccess("pending");
    } finally {
      setLoading(false);
    }
  }, [id, user, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPublish = async () => {
    if (!id || !user) {
      setIsWalletOpen(true);
      return;
    }
    const doc = markdown.trim();
    if (doc.length < 100) {
      setPublishError("Research document must be at least 100 characters.");
      return;
    }
    setPublishing(true);
    setPublishError(null);
    try {
      await publishBucketApi(id, { researchDoc: markdown });
      navigate(`/buckets/${encodeURIComponent(id)}`, { replace: true });
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      setPublishError(ERR_HINT[code] ?? code);
    } finally {
      setPublishing(false);
    }
  };

  const canPublish = markdown.trim().length >= 100;

  return (
    <Layout
      title="Research document"
      onConnectWallet={() => setIsWalletOpen(true)}
      onDisconnect={() => void logout()}
      user={layoutUser}
    >
      <ConnectWalletModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} />

      <div className="max-w-3xl mx-auto w-full p-8 pb-16">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#6b7280] hover:text-[#1a1c1e] transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {loading ? (
          <div className="flex items-center gap-2 text-[15px] font-medium text-[#6b7280] py-12">
            <Loader2 className="w-5 h-5 animate-spin shrink-0" />
            Loading bucket…
          </div>
        ) : loadError ? (
          <div className="flex items-start gap-2 rounded-[12px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 text-[13px] font-medium text-red-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </div>
        ) : access === "need_wallet" ? (
          <div className="rounded-[1.25rem] p-8 bg-[#f8f9f7] shadow-[inset_0_3px_1px_rgba(255,255,255,1),0_0_0_1px_rgba(0,0,0,0.06)] space-y-4">
            <p className="text-[15px] font-medium text-[#6b7280]">
              Connect your wallet to write the research document and publish this bucket.
            </p>
            <button
              type="button"
              onClick={() => setIsWalletOpen(true)}
              className="px-5 py-2.5 rounded-[10px] bg-[#1a1c1e] text-white text-[14px] font-semibold"
            >
              Connect wallet
            </button>
          </div>
        ) : access === "not_creator" ? (
          <div className="flex items-start gap-2 rounded-[12px] border border-amber-200/90 bg-amber-50/90 px-4 py-3 text-[14px] font-medium text-amber-950">
            Only the bucket creator can add the research document.{" "}
            <button type="button" className="underline font-semibold" onClick={() => navigate("/my-buckets")}>
              My buckets
            </button>
          </div>
        ) : access === "ready" && id ? (
          <>
            {publishError ? (
              <div className="flex items-start gap-2 rounded-[12px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 text-[13px] font-medium text-red-800 mb-6">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{publishError}</span>
              </div>
            ) : null}

            <div className="rounded-[1.25rem] p-8 bg-[#f8f9f7] shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.08),0_12px_24px_-4px_rgba(0,0,0,0.05)] mb-8">
              <h1 className="text-[22px] font-semibold text-[#1a1c1e] tracking-tight mb-2">Research document</h1>
              <p className="text-[15px] text-[#6b7280] tracking-tight mb-6">
                Explain your thesis, risks, and strategy. Investors see this when the bucket is published.
              </p>

              <ResearchDocEditor value={markdown} onChange={setMarkdown} />

              <div className="flex flex-wrap items-center gap-3 mt-8 pt-6 border-t border-black/6">
                <button
                  type="button"
                  disabled={publishing || !canPublish}
                  onClick={() => void onPublish()}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-[#1a1c1e] text-white rounded-[12px] text-[15px] font-semibold shadow-md disabled:opacity-45 disabled:cursor-not-allowed hover:bg-[#374151] transition-all"
                >
                  {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Publish bucket
                </button>
                {!canPublish ? (
                  <span className="text-[13px] font-medium text-[#9ca3af]">Complete at least 100 characters to publish.</span>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Layout>
  );
}
