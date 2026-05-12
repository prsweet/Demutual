/**
 * Birdeye TradingView widget embed.
 * No API key needed — Birdeye renders the full chart server-side and we just
 * iframe it. `address` is the SPL mint; the rest is presentation around the
 * iframe so the user knows which asset they're looking at.
 */
export function BirdeyeChart({
  mint,
  symbol,
  iconUrl,
  weightPct
}: {
  mint: string;
  symbol: string;
  iconUrl?: string | null;
  weightPct?: number | null;
}) {
  const bg = "ffffff";
  const src =
    `https://birdeye.so/tv-widget/${encodeURIComponent(mint)}` +
    `?chain=solana&viewMode=pair&chartInterval=15&chartType=CANDLE` +
    `&chartTimezone=UTC&chartLeftToolbar=show&theme=light&background=${bg}`;

  return (
    <div className="h-full flex flex-col">
      {/* Header — token identity */}
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-[10px] bg-white border border-black/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] flex items-center justify-center overflow-hidden shrink-0">
          {iconUrl ? (
            <img
              src={iconUrl}
              alt={symbol}
              className="w-6 h-6"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0.3";
              }}
            />
          ) : (
            <span className="text-[10px] font-mono text-[#9ca3af]">{symbol.slice(0, 3)}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[#1a1c1e] truncate">{symbol}</div>
          <div className="text-[11px] text-[#9ca3af]">
            Top weight {typeof weightPct === "number" ? `· ${weightPct.toFixed(0)}%` : ""}
          </div>
        </div>
      </div>

      {/* Birdeye tv-widget iframe */}
      <div className="flex-1 rounded-[1rem] overflow-hidden border border-black/8 bg-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.04)]">
        <iframe
          key={mint}
          src={src}
          title={`${symbol} price chart`}
          className="w-full h-full border-none block"
          loading="lazy"
          allow="clipboard-write"
        />
      </div>
    </div>
  );
}
