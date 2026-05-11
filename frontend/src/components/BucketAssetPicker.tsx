import React, { useDeferredValue, useMemo, useState } from "react";
import type { CatalogAsset, CatalogCategory } from "../lib/types";
import { CATALOG_CATEGORY_LABEL, CATALOG_CATEGORY_ORDER } from "../lib/types";
import { ChevronDown, ChevronRight, Coins, Filter, Plus, Search, X } from "lucide-react";

/**
 * Curated "relatable" mints — the recognizable tokens the previous hand-built catalog
 * surfaced. We use them as the default top-of-category view so new users see names they
 * trust (SOL / USDC / JitoSOL / JUP / BONK) instead of whatever tokens currently happen
 * to have the largest market cap on Jupiter. The full Jupiter verified set is still
 * reachable via search.
 */
const FEATURED_MINTS: Record<CatalogCategory, string[]> = {
  stablecoin: [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
    "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD
    "9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u", // FDUSD
    "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA" // USDS
  ],
  yield: [
    "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // JitoSOL
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
    "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4", // JLP
    "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm", // INF
    "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1" // bSOL
  ],
  token: [
    "So11111111111111111111111111111111111111112", // SOL
    "JUPyiwrYJFskUPiHa7hkeR8UctBXDFt9VM2ZXdHUwqD", // JUP
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
    "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", // JTO
    "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" // WIF
  ],
  nft: []
};

export type AssetRowSelection = Record<string, { enabled: boolean; pct: string }>;

type Props = {
  catalog: CatalogAsset[];
  customAssets: CatalogAsset[];
  selection: AssetRowSelection;
  onSelectionChange: (next: AssetRowSelection) => void;
  sumPct: number;
  sumOk: boolean;
};

/** Per-category default cap. Search bar reveals everything beyond this. */
const DEFAULT_TOP_N: Record<CatalogCategory, number> = {
  stablecoin: 5,
  yield: 5,
  token: 5,
  nft: 5
};

/** Cap rows rendered during a search so 4k tokens never end up as 4k DOM nodes. */
const SEARCH_RESULT_CAP_PER_CATEGORY = 30;

function rankByMcap(a: CatalogAsset, b: CatalogAsset): number {
  const ma = typeof a.mcap === "number" && Number.isFinite(a.mcap) ? a.mcap : -1;
  const mb = typeof b.mcap === "number" && Number.isFinite(b.mcap) ? b.mcap : -1;
  if (ma !== mb) return mb - ma;
  return a.symbol.localeCompare(b.symbol);
}

/**
 * Order rows so featured (curated relatable) mints lead, in their explicit order, then
 * the rest fall back to mcap ranking. Featured mints are the recognizable defaults; this
 * keeps SOL/USDC/JitoSOL/JUP/BONK at the top of their categories even when a no-name token
 * has a temporarily inflated market cap.
 */
function orderByFeaturedThenMcap(rows: CatalogAsset[], category: CatalogCategory): CatalogAsset[] {
  const featuredOrder = new Map<string, number>();
  FEATURED_MINTS[category].forEach((mint, i) => featuredOrder.set(mint, i));
  const featured: CatalogAsset[] = [];
  const rest: CatalogAsset[] = [];
  for (const a of rows) {
    if (featuredOrder.has(a.id)) featured.push(a);
    else rest.push(a);
  }
  featured.sort((a, b) => (featuredOrder.get(a.id)! - featuredOrder.get(b.id)!));
  rest.sort(rankByMcap);
  return [...featured, ...rest];
}

function groupCatalog(assets: CatalogAsset[]): Record<CatalogCategory, CatalogAsset[]> {
  const m: Record<CatalogCategory, CatalogAsset[]> = {
    stablecoin: [],
    yield: [],
    token: [],
    nft: []
  };
  for (const a of assets) {
    const c = m[a.category] ? a.category : "token";
    m[c].push(a);
  }
  for (const c of CATALOG_CATEGORY_ORDER) {
    m[c] = orderByFeaturedThenMcap(m[c], c);
  }
  return m;
}

function AssetTable({
  rows,
  selection,
  onPatch
}: {
  rows: CatalogAsset[];
  selection: AssetRowSelection;
  onPatch: (id: string, patch: Partial<{ enabled: boolean; pct: string }>) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-[12px] border border-black/8 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
      <table className="w-full text-left text-[14px]">
        <thead>
          <tr className="border-b border-black/6 text-[12px] font-semibold uppercase tracking-wider text-[#9ca3af]">
            <th className="px-3 py-2 w-10" />
            <th className="px-3 py-2">Token</th>
            <th className="px-3 py-2 w-28 text-right">Weight %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const row = selection[a.id] ?? { enabled: false, pct: "" };
            return (
              <tr key={a.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.02]">
                <td className="px-3 py-2 align-middle">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => onPatch(a.id, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-black/20 accent-[#1a1c1e]"
                    aria-label={`Include ${a.symbol}`}
                  />
                </td>
                <td className="px-3 py-2 align-middle">
                  <div className="flex items-center gap-2 min-w-0">
                    {a.iconUrl ? (
                      <img
                        src={a.iconUrl}
                        alt=""
                        className="w-7 h-7 rounded-lg shrink-0 bg-black/5 object-contain"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.opacity = "0.3";
                        }}
                      />
                    ) : (
                      <div
                        aria-hidden
                        className="w-7 h-7 rounded-lg shrink-0 bg-black/5 flex items-center justify-center text-[10px] font-semibold text-[#9ca3af]"
                      >
                        {a.symbol.slice(0, 3).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-[#1a1c1e] truncate">{a.symbol}</div>
                      <div className="text-[12px] text-[#6b7280] truncate">{a.name}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 align-middle text-right">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="0"
                    disabled={!row.enabled}
                    value={row.pct}
                    onChange={(e) => onPatch(a.id, { pct: e.target.value })}
                    className="w-full max-w-[88px] ml-auto px-2 py-1.5 rounded-[8px] border border-black/10 text-[14px] font-medium tabular-nums text-right disabled:opacity-40 bg-[#f8f9f7]"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** All four categories start expanded — the per-category Top-N cap keeps each list short. */
const DEFAULT_COLLAPSED: Record<CatalogCategory, boolean> = {
  stablecoin: false,
  yield: false,
  token: false,
  nft: false
};

export function BucketAssetPicker({
  catalog,
  customAssets,
  selection,
  onSelectionChange,
  sumPct,
  sumOk
}: Props) {
  const [query, setQuery] = useState("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<CatalogCategory, boolean>>(DEFAULT_COLLAPSED);

  // useDeferredValue lets the input update at full responsiveness while the (expensive)
  // filter over 4k tokens trails behind without blocking the keystroke.
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  /** Filter pass: search across symbol / name / mint, optionally restrict to selected rows. */
  const matches = (a: CatalogAsset): boolean => {
    if (showSelectedOnly && !selection[a.id]?.enabled) return false;
    if (!isSearching) return true;
    return (
      a.symbol.toLowerCase().includes(normalizedQuery) ||
      a.name.toLowerCase().includes(normalizedQuery) ||
      a.id.toLowerCase().includes(normalizedQuery)
    );
  };

  const groupedAll = useMemo(() => groupCatalog(catalog), [catalog]);
  const grouped = useMemo(() => {
    const out: Record<CatalogCategory, CatalogAsset[]> = {
      stablecoin: [],
      yield: [],
      token: [],
      nft: []
    };
    for (const cat of CATALOG_CATEGORY_ORDER) {
      out[cat] = groupedAll[cat].filter(matches);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedAll, normalizedQuery, showSelectedOnly, selection]);

  const filteredCustom = useMemo(
    () => customAssets.filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customAssets, normalizedQuery, showSelectedOnly, selection]
  );

  const totalSelected = Object.values(selection).filter((r) => r.enabled).length;
  const totalShown =
    CATALOG_CATEGORY_ORDER.reduce((s, c) => s + grouped[c].length, 0) + filteredCustom.length;

  const patch = (id: string, partial: Partial<{ enabled: boolean; pct: string }>) => {
    const prev = selection[id] ?? { enabled: false, pct: "" };
    onSelectionChange({
      ...selection,
      [id]: { ...prev, ...partial }
    });
  };

  const isCategoryOpen = (cat: CatalogCategory): boolean => {
    // When the user is searching or filtering to selected, force everything open so matches are visible.
    if (isSearching || showSelectedOnly) return true;
    return !collapsed[cat];
  };

  const toggleCategory = (cat: CatalogCategory) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="space-y-5 tracking-tight">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-[10px] bg-[#4ade80]/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
          <Coins className="w-5 h-5 text-[#15803d]" />
        </div>
        <div>
          <h2 className="text-[17px] font-semibold text-[#1a1c1e]">Allocations</h2>
          <p className="text-[14px] text-[#6b7280] mt-0.5">
            Pick tokens from Jupiter's verified set or register a custom mint, then set weights. Selected weights must sum to{" "}
            <span className="font-semibold text-[#374151]">100%</span>.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af] pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by symbol, name, or mint…"
            className="w-full pl-9 pr-9 py-2 rounded-[10px] border border-black/10 bg-white text-[14px] focus:outline-none focus:border-black/30"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[#9ca3af] hover:text-[#374151]"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowSelectedOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border text-[13px] font-semibold transition-colors ${
            showSelectedOnly
              ? "bg-[#1a1c1e] text-white border-[#1a1c1e]"
              : "bg-white text-[#374151] border-black/10 hover:bg-black/[0.03]"
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          {showSelectedOnly ? `Selected (${totalSelected})` : `Show selected (${totalSelected})`}
        </button>
      </div>

      {totalShown === 0 && (
        <div className="rounded-[12px] border border-dashed border-black/10 bg-white/60 px-4 py-6 text-center text-[13px] text-[#6b7280]">
          {showSelectedOnly && totalSelected === 0
            ? "You haven't selected any tokens yet."
            : isSearching
              ? `No tokens match "${query}".`
              : "No tokens to show."}
        </div>
      )}

      {CATALOG_CATEGORY_ORDER.map((cat) => {
        const rows = grouped[cat];
        if (rows.length === 0) return null;
        const open = isCategoryOpen(cat);
        const selectedInCat = rows.filter((a) => selection[a.id]?.enabled).length;
        // The Top-N cap is the only way to browse — search reveals the rest. "Show selected"
        // bypasses the cap because by definition the user already picked those rows.
        const cap = DEFAULT_TOP_N[cat];
        let visibleRows: CatalogAsset[];
        let footerNote: string | null = null;
        if (isSearching) {
          visibleRows = rows.slice(0, SEARCH_RESULT_CAP_PER_CATEGORY);
          if (rows.length > SEARCH_RESULT_CAP_PER_CATEGORY) {
            footerNote = `Showing first ${SEARCH_RESULT_CAP_PER_CATEGORY} of ${rows.length} matches — refine your search to narrow further.`;
          }
        } else if (showSelectedOnly) {
          visibleRows = rows;
        } else {
          visibleRows = rows.slice(0, cap);
        }
        // Selected rows below the cap stay visible so the cap never hides an active choice.
        const selectedBelowCap =
          isSearching || showSelectedOnly
            ? []
            : rows.slice(cap).filter((a) => selection[a.id]?.enabled);
        const finalRows = [...visibleRows, ...selectedBelowCap];
        return (
          <div key={cat}>
            <button
              type="button"
              onClick={() => toggleCategory(cat)}
              className="w-full flex items-center justify-between gap-2 py-2 px-1 -ml-1 rounded-[6px] hover:bg-black/[0.03] transition-colors"
              aria-expanded={open}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#374151] uppercase tracking-wider">
                {open ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[#9ca3af]" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-[#9ca3af]" />
                )}
                {CATALOG_CATEGORY_LABEL[cat]}
              </span>
              <span className="text-[12px] font-medium text-[#9ca3af] tabular-nums">
                {selectedInCat > 0 && (
                  <span className="text-emerald-700 mr-2">{selectedInCat} selected</span>
                )}
                {isSearching
                  ? `${rows.length} match${rows.length === 1 ? "" : "es"}`
                  : showSelectedOnly
                    ? `${rows.length} selected`
                    : `top ${Math.min(cap, rows.length)} of ${rows.length}`}
              </span>
            </button>
            {open && (
              <div className="mt-2 space-y-2">
                <AssetTable rows={finalRows} selection={selection} onPatch={patch} />
                {footerNote && (
                  <p className="text-[12px] text-[#9ca3af] px-1">{footerNote}</p>
                )}
                {!isSearching && !showSelectedOnly && rows.length > cap && (
                  <p className="text-[12px] text-[#9ca3af] px-1">
                    {rows.length - cap} more in this category — use search above to find a specific token.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {filteredCustom.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-2 flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" />
            Your registered tokens
          </h3>
          <AssetTable rows={filteredCustom} selection={selection} onPatch={patch} />
        </div>
      )}

      <div
        className={`flex items-center justify-between rounded-[12px] px-4 py-3 text-[14px] font-semibold border ${
          sumOk
            ? "bg-emerald-50/80 border-emerald-200/80 text-emerald-900"
            : "bg-amber-50/80 border-amber-200/80 text-amber-950"
        }`}
      >
        <span>Total allocation</span>
        <span className="tabular-nums">
          {sumPct.toFixed(2)}% {sumOk ? "· ready" : "· need 100%"}
        </span>
      </div>
    </div>
  );
}
