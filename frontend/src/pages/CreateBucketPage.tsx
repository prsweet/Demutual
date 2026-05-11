import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { ConnectWalletModal } from "../components/ConnectWalletModal";
import { BucketAssetPicker, type AssetRowSelection } from "../components/BucketAssetPicker";
import { CreatorVerificationStatus } from "../components/CreatorVerificationStatus";
import { ArrowLeft, Save, Loader2, AlertCircle, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import {
  createBucketApi,
  fetchCatalog,
  publishBucketApi,
  setBucketAssetsApi,
  upsertAssetApi
} from "../lib/api";
import type { BucketAssetWeight, CatalogAsset } from "../lib/types";
import { PublicKey } from "@solana/web3.js";

const DRAFT_LS = "demutual_draft_bucket_id";

function collectAllocations(sel: AssetRowSelection): { assets: BucketAssetWeight[] } | { error: string } {
  const assets: BucketAssetWeight[] = [];
  for (const [assetId, row] of Object.entries(sel)) {
    if (!row.enabled) continue;
    const p = parseFloat(row.pct);
    if (!Number.isFinite(p) || p <= 0) return { error: "Each selected token needs a positive weight %." };
    assets.push({ assetId, percentage: p });
  }
  if (assets.length === 0) {
    return { error: "Select at least one token from the catalog or register a custom mint, then set weights." };
  }
  const total = assets.reduce((s, a) => s + a.percentage, 0);
  if (Math.abs(total - 100) > 0.0001) {
    return { error: `Weights must sum to 100% (currently ${total.toFixed(2)}%).` };
  }
  return { assets };
}

const ERR_HINT: Record<string, string> = {
  LISTING_PERCENTAGES_MUST_SUM_TO_100: "Allocations must total exactly 100%.",
  UNKNOWN_ASSET_ID_USE_CATALOG_OR_REGISTER: "Register custom mints under “Add custom token” first, or pick from the catalog.",
  BUCKET_CREATOR_REQUIRED: "You can only edit buckets you created.",
  BUCKET_NOT_IN_DRAFT: "This bucket is no longer a draft.",
  BUCKET_ALREADY_EXISTS: "You already have a bucket with this name. Pick another name."
};

export function CreateBucketPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [estimatedApy, setEstimatedApy] = useState("5");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<CatalogAsset[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [customAssets, setCustomAssets] = useState<CatalogAsset[]>([]);
  const [selection, setSelection] = useState<AssetRowSelection>({});

  const [customMint, setCustomMint] = useState("");
  const [customName, setCustomName] = useState("");
  const [customSymbol, setCustomSymbol] = useState("");
  const [customIcon, setCustomIcon] = useState("");
  const [customDecimals, setCustomDecimals] = useState("9");
  const [registering, setRegistering] = useState(false);

  const [publishAfterSave, setPublishAfterSave] = useState(false);

  const layoutUser = user ? { name: user.username, walletAddress: user.walletAddress } : undefined;

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const rows = await fetchCatalog();
      setCatalog(rows);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "Failed to load catalog");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const { sumPct, sumOk } = useMemo(() => {
    let t = 0;
    for (const [, row] of Object.entries(selection)) {
      if (!row.enabled) continue;
      const p = parseFloat(row.pct);
      if (Number.isFinite(p) && p > 0) t += p;
    }
    return { sumPct: t, sumOk: Math.abs(t - 100) <= 0.0001 };
  }, [selection]);

  const onRegisterCustom = async () => {
    if (!user) {
      setIsWalletOpen(true);
      return;
    }
    const id = customMint.trim();
    if (!id) {
      setError("Enter a Solana mint address.");
      return;
    }
    try {
      new PublicKey(id);
    } catch {
      setError("Mint address is not a valid Solana public key.");
      return;
    }
    const nameT = customName.trim();
    const sym = customSymbol.trim();
    if (!nameT || !sym) {
      setError("Name and symbol are required for a custom token.");
      return;
    }
    const dec = parseInt(customDecimals, 10);
    if (!Number.isFinite(dec) || dec < 0 || dec > 18) {
      setError("Decimals must be between 0 and 18.");
      return;
    }
    if (catalog.some((c) => c.id === id)) {
      setError("This mint is already in the catalog — enable it in the table above.");
      return;
    }
    const iconUrl =
      customIcon.trim() ||
      `https://static.jup.ag/tokens/${encodeURIComponent(id)}/icon.png`;
    setRegistering(true);
    setError(null);
    try {
      await upsertAssetApi({ id, name: nameT, symbol: sym, iconUrl, decimals: dec });
      const row: CatalogAsset = {
        id,
        name: nameT,
        symbol: sym,
        iconUrl,
        decimals: dec,
        category: "token"
      };
      setCustomAssets((prev) => {
        if (prev.some((a) => a.id === id)) return prev;
        return [...prev, row];
      });
      setSelection((s) => ({
        ...s,
        [id]: s[id] ?? { enabled: false, pct: "" }
      }));
      setCustomMint("");
      setCustomName("");
      setCustomSymbol("");
      setCustomIcon("");
      setCustomDecimals("9");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not register asset");
    } finally {
      setRegistering(false);
    }
  };

  const onSubmit = async () => {
    if (!user) {
      setIsWalletOpen(true);
      return;
    }
    const apy = parseFloat(estimatedApy);
    if (!name.trim() || !Number.isFinite(apy) || apy < 0) return;

    const collected = collectAllocations(selection);
    if ("error" in collected) {
      setError(collected.error);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const bucket = await createBucketApi({
        name: name.trim(),
        estimatedApy: apy,
        metaData: description.trim() ? { description: description.trim() } : undefined
      });
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(DRAFT_LS, bucket.id);
      }
      await setBucketAssetsApi(bucket.id, collected.assets);
      if (publishAfterSave) {
        await publishBucketApi(bucket.id);
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem(DRAFT_LS);
        }
      }
      navigate("/", { replace: true });
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      setError(ERR_HINT[code] ?? code);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout
      title="Create bucket"
      onConnectWallet={() => setIsWalletOpen(true)}
      onDisconnect={() => void logout()}
      user={layoutUser}
    >
      <div className="max-w-3xl mx-auto w-full p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-16">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#6b7280] hover:text-[#1a1c1e] transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div
          className="bg-[#f8f9f7] rounded-3xl p-8 shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.1),0_12px_24px_-4px_rgba(0,0,0,0.05),0_4px_8px_-2px_rgba(0,0,0,0.04)] space-y-10"
        >
          <div>
            <h1 className="text-[24px] font-semibold text-[#1a1c1e] tracking-tight mb-2">Create bucket</h1>
            <p className="text-[15px] text-[#6b7280] tracking-tight">
              Same flow as the reference client: create a draft, attach catalog or custom mints with weights summing to{" "}
              <span className="font-semibold text-[#374151]">100%</span>, then optionally publish to the marketplace.
            </p>
            {!user && (
              <p className="text-[14px] text-[#6b7280] mt-3 font-medium">Connect your wallet to register assets and save.</p>
            )}
            {user && <p className="text-[14px] text-[#6b7280] mt-3">Signed in as {user.username}</p>}
          </div>

          {user && <CreatorVerificationStatus variant="panel" />}

          {error && (
            <div className="flex items-start gap-2 rounded-[12px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 text-[13px] font-medium text-red-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label className="block text-[14px] font-semibold text-[#374151] mb-2 tracking-tight">Bucket name</label>
              <input
                type="text"
                placeholder="e.g. DeFi bluechips"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-black/10 rounded-[12px] text-[15px] font-medium text-[#1a1c1e] focus:outline-none focus:ring-2 focus:ring-black/5 shadow-sm placeholder:text-gray-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-[14px] font-semibold text-[#374151] mb-2 tracking-tight">Description</label>
              <textarea
                rows={3}
                placeholder="Strategy, risk, and who this basket is for…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-black/10 rounded-[12px] text-[15px] font-medium text-[#1a1c1e] focus:outline-none focus:ring-2 focus:ring-black/5 shadow-sm placeholder:text-gray-400 transition-all resize-none"
              />
            </div>

            <div>
              <label className="block text-[14px] font-semibold text-[#374151] mb-2 tracking-tight">
                Estimated APY (%)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={estimatedApy}
                onChange={(e) => setEstimatedApy(e.target.value)}
                className="w-full max-w-[200px] px-4 py-3 bg-white border border-black/10 rounded-[12px] text-[15px] font-medium text-[#1a1c1e] focus:outline-none focus:ring-2 focus:ring-black/5 shadow-sm tabular-nums"
              />
            </div>
          </div>

          <div className="h-px w-[calc(100%+64px)] -mx-8 bg-black/5 shadow-[0_1.5px_0_white]" />

          {catalogLoading && (
            <p className="text-[14px] text-[#6b7280] font-medium">Loading token catalog…</p>
          )}
          {catalogError && (
            <div className="rounded-[12px] border border-amber-200/90 bg-amber-50/90 px-4 py-3 text-[14px] text-amber-950">
              {catalogError}{" "}
              <button type="button" className="underline font-semibold" onClick={() => void loadCatalog()}>
                Retry
              </button>
            </div>
          )}
          {!catalogLoading && !catalogError && catalog.length > 0 && (
            <BucketAssetPicker
              catalog={catalog}
              customAssets={customAssets}
              selection={selection}
              onSelectionChange={setSelection}
              sumPct={sumPct}
              sumOk={sumOk}
            />
          )}

          <div
            className="rounded-2xl p-5 bg-white border border-black/8 shadow-[inset_0_2px_1px_rgba(255,255,255,0.9),0_2px_8px_rgba(0,0,0,0.04)] space-y-4"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#6b7280]" />
              <h2 className="text-[16px] font-semibold text-[#1a1c1e]">Add custom token</h2>
            </div>
            <p className="text-[13px] text-[#6b7280]">
              Mints not in the catalog must be registered via <span className="font-mono text-[12px]">POST /assets</span> before they can be weighted (same as the client “Advanced” path).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                placeholder="Mint address (base58)"
                value={customMint}
                onChange={(e) => setCustomMint(e.target.value)}
                className="px-3 py-2.5 rounded-[10px] border border-black/10 text-[14px] font-mono bg-[#f8f9f7] sm:col-span-2"
              />
              <input
                placeholder="Name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="px-3 py-2.5 rounded-[10px] border border-black/10 text-[14px] bg-[#f8f9f7]"
              />
              <input
                placeholder="Symbol"
                value={customSymbol}
                onChange={(e) => setCustomSymbol(e.target.value)}
                className="px-3 py-2.5 rounded-[10px] border border-black/10 text-[14px] bg-[#f8f9f7]"
              />
              <input
                placeholder="Icon URL (optional)"
                value={customIcon}
                onChange={(e) => setCustomIcon(e.target.value)}
                className="px-3 py-2.5 rounded-[10px] border border-black/10 text-[14px] bg-[#f8f9f7] sm:col-span-2"
              />
              <input
                placeholder="Decimals"
                value={customDecimals}
                onChange={(e) => setCustomDecimals(e.target.value)}
                className="px-3 py-2.5 rounded-[10px] border border-black/10 text-[14px] tabular-nums bg-[#f8f9f7] max-w-[120px]"
              />
            </div>
            <button
              type="button"
              disabled={registering}
              onClick={() => void onRegisterCustom()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[14px] font-semibold bg-[#1a1c1e] text-white hover:bg-[#374151] disabled:opacity-50 transition-all"
            >
              {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Register &amp; add to list
            </button>
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={publishAfterSave}
              onChange={(e) => setPublishAfterSave(e.target.checked)}
              className="h-4 w-4 rounded border-black/20 accent-[#1a1c1e]"
            />
            <span className="text-[14px] font-medium text-[#374151]">
              Publish to marketplace immediately (otherwise stays draft until you publish via API)
            </span>
          </label>

          <div className="pt-2 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="px-5 py-3 rounded-[12px] text-[15px] font-semibold text-[#374151] bg-white border border-black/10 shadow-sm hover:bg-black/2 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!name.trim() || submitting || catalogLoading || Boolean(catalogError)}
              onClick={() => void onSubmit()}
              className="flex items-center gap-2 px-6 py-3 bg-[#1a1c1e] text-white rounded-[12px] text-[15px] font-semibold shadow-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#374151] transition-all"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {publishAfterSave ? "Create, save allocations & publish" : "Create draft & save allocations"}
            </button>
          </div>
        </div>
      </div>

      <ConnectWalletModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} />
    </Layout>
  );
}
