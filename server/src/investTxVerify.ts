import { Connection, LAMPORTS_PER_SOL, type ParsedTransactionWithMeta } from "@solana/web3.js";

export function grossLamportsFromSol(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVEST_AMOUNT_INVALID");
  }
  const lamports = Math.round(amount * LAMPORTS_PER_SOL);
  if (lamports <= 0) throw new Error("INVEST_AMOUNT_TOO_SMALL");
  return BigInt(lamports);
}

type SystemTransfer = { from: string; to: string; lamports: bigint };

function allSystemTransfers(parsed: ParsedTransactionWithMeta): SystemTransfer[] {
  const out: SystemTransfer[] = [];
  const ixs = parsed.transaction.message.instructions;
  for (const ix of ixs) {
    if ("parsed" in ix && ix.program === "system" && ix.parsed && typeof ix.parsed === "object") {
      const p = ix.parsed as {
        type?: string;
        info?: { source?: string; destination?: string; lamports?: number | bigint };
      };
      if (p.type === "transfer" && p.info?.source && p.info?.destination && p.info.lamports != null) {
        out.push({
          from: p.info.source,
          to: p.info.destination,
          lamports: BigInt(p.info.lamports as bigint | number)
        });
      }
    }
  }
  return out;
}

function firstSystemTransfer(parsed: ParsedTransactionWithMeta): SystemTransfer | null {
  const all = allSystemTransfers(parsed);
  return all[0] ?? null;
}

async function fetchParsedTx(
  rpcUrl: string,
  signature: string
): Promise<ParsedTransactionWithMeta> {
  const connection = new Connection(rpcUrl, "confirmed");
  let parsed: ParsedTransactionWithMeta | null = null;
  for (let i = 0; i < 8; i++) {
    parsed = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    if (parsed) break;
    await sleep(350 * (i + 1));
  }
  if (!parsed) throw new Error("INVEST_TX_NOT_FOUND");
  if (parsed.meta?.err) throw new Error("INVEST_TX_FAILED");
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Confirms a devnet/mainnet SOL transfer from the investor to the protocol treasury
 * matches the claimed gross amount (before DB fee split).
 */
export async function verifyInvestTransfer(opts: {
  rpcUrl: string;
  signature: string;
  expectedFrom: string;
  expectedTo: string;
  expectedLamports: bigint;
}): Promise<void> {
  const parsed = await fetchParsedTx(opts.rpcUrl, opts.signature);
  const transfer = firstSystemTransfer(parsed);
  if (!transfer) throw new Error("INVEST_TX_NO_TRANSFER");
  if (transfer.from !== opts.expectedFrom) throw new Error("INVEST_TX_SENDER_MISMATCH");
  if (transfer.to !== opts.expectedTo) throw new Error("INVEST_TX_RECIPIENT_MISMATCH");
  if (transfer.lamports !== opts.expectedLamports) throw new Error("INVEST_TX_AMOUNT_MISMATCH");
}

/**
 * Verifies a single tx contains every expected (to, lamports) System.transfer from `expectedFrom`.
 * Used for the dual-fee bundle (platform + creator) in one investor-signed transaction.
 */
export async function verifyInvestFeeBundle(opts: {
  rpcUrl: string;
  signature: string;
  expectedFrom: string;
  expectedTransfers: { to: string; lamports: bigint }[];
}): Promise<void> {
  if (opts.expectedTransfers.length === 0) return;
  const parsed = await fetchParsedTx(opts.rpcUrl, opts.signature);
  const all = allSystemTransfers(parsed);
  if (all.length === 0) throw new Error("INVEST_TX_NO_TRANSFER");
  for (const t of all) {
    if (t.from !== opts.expectedFrom) throw new Error("INVEST_TX_SENDER_MISMATCH");
  }
  const remaining = [...all];
  for (const want of opts.expectedTransfers) {
    const idx = remaining.findIndex((t) => t.to === want.to && t.lamports === want.lamports);
    if (idx === -1) throw new Error("INVEST_TX_AMOUNT_MISMATCH");
    remaining.splice(idx, 1);
  }
}
