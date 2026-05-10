import React, { useMemo } from "react";
import type { CatalogAsset, CatalogCategory } from "../lib/types";
import { CATALOG_CATEGORY_LABEL, CATALOG_CATEGORY_ORDER } from "../lib/types";
import { Coins, Plus } from "lucide-react";

export type AssetRowSelection = Record<string, { enabled: boolean; pct: string }>;

type Props = {
  catalog: CatalogAsset[];
  customAssets: CatalogAsset[];
  selection: AssetRowSelection;
  onSelectionChange: (next: AssetRowSelection) => void;
  sumPct: number;
  sumOk: boolean;
};

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
                    <img
                      src={a.iconUrl}
                      alt=""
                      className="w-7 h-7 rounded-lg shrink-0 bg-black/5 object-contain"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = "0.3";
                      }}
                    />
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

export function BucketAssetPicker({
  catalog,
  customAssets,
  selection,
  onSelectionChange,
  sumPct,
  sumOk
}: Props) {
  const grouped = useMemo(() => groupCatalog(catalog), [catalog]);

  const patch = (id: string, partial: Partial<{ enabled: boolean; pct: string }>) => {
    const prev = selection[id] ?? { enabled: false, pct: "" };
    onSelectionChange({
      ...selection,
      [id]: { ...prev, ...partial }
    });
  };

  return (
    <div className="space-y-6 tracking-tight">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-[10px] bg-[#4ade80]/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
          <Coins className="w-5 h-5 text-[#15803d]" />
        </div>
        <div>
          <h2 className="text-[17px] font-semibold text-[#1a1c1e]">Allocations</h2>
          <p className="text-[14px] text-[#6b7280] mt-0.5">
            Pick tokens from the curated catalog (same as the API) or register a mint, then set weights. Selected weights must sum to{" "}
            <span className="font-semibold text-[#374151]">100%</span>.
          </p>
        </div>
      </div>

      {CATALOG_CATEGORY_ORDER.map((cat) => {
        const rows = grouped[cat];
        if (rows.length === 0) return null;
        return (
          <div key={cat}>
            <h3 className="text-[13px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">
              {CATALOG_CATEGORY_LABEL[cat]}
            </h3>
            <AssetTable rows={rows} selection={selection} onPatch={patch} />
          </div>
        );
      })}

      {customAssets.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-2 flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" />
            Your registered tokens
          </h3>
          <AssetTable rows={customAssets} selection={selection} onPatch={patch} />
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
