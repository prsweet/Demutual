/**
 * USD + SOL display formatters. These are *display only* — actual transactions are SOL.
 * Every USD figure should be paired with `formatAsOf(asOf)` so the user knows it's a quote.
 */

const USD_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const USD_FMT_SMALL = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4
});

export function formatUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "—";
  if (Math.abs(usd) > 0 && Math.abs(usd) < 0.01) return USD_FMT_SMALL.format(usd);
  return USD_FMT.format(usd);
}

export function solToUsd(sol: number, solUsdPrice: number | null | undefined): number | null {
  if (!Number.isFinite(sol)) return null;
  if (!solUsdPrice || !Number.isFinite(solUsdPrice) || solUsdPrice <= 0) return null;
  return sol * solUsdPrice;
}

export function usdToSol(usd: number, solUsdPrice: number | null | undefined): number | null {
  if (!Number.isFinite(usd)) return null;
  if (!solUsdPrice || !Number.isFinite(solUsdPrice) || solUsdPrice <= 0) return null;
  return usd / solUsdPrice;
}

export function formatSol(sol: number | null | undefined, fractionDigits = 6): string {
  if (sol === null || sol === undefined || !Number.isFinite(sol)) return "—";
  return `${sol.toFixed(fractionDigits)} SOL`;
}

/** "as of 14:23:07" — local time, 24h. Use under any USD figure. */
export function formatAsOf(asOfMs: number | null | undefined): string {
  if (!asOfMs || !Number.isFinite(asOfMs)) return "";
  const d = new Date(asOfMs);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `as of ${hh}:${mm}:${ss}`;
}

export function lamportsToSol(lamports: number | string): number {
  const n = typeof lamports === "string" ? Number(lamports) : lamports;
  if (!Number.isFinite(n)) return 0;
  return n / 1e9;
}
