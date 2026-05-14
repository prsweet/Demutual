import { Connection, PublicKey } from "@solana/web3.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export async function getAssociatedTokenAddress(params: { owner: string; mint: string }): Promise<string> {
  const owner = new PublicKey(params.owner);
  const mint = new PublicKey(params.mint);
  const [ata] = await PublicKey.findProgramAddress(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata.toBase58();
}

export async function estimateMissingAtaRentLamports(params: {
  rpcUrl: string;
  owner: string;
  mints: string[];
}): Promise<{
  rentPerAtaLamports: number;
  missingAtas: { mint: string; ata: string }[];
  estimatedRentLamports: number;
}> {
  const connection = new Connection(params.rpcUrl, "confirmed");
  const uniqueMints = [...new Set(params.mints.map((m) => m.trim()).filter(Boolean))];

  // Derive all ATA addresses locally (deterministic PDAs) in parallel.
  const ataEntries = await Promise.all(
    uniqueMints.map(async (mint) => ({
      mint,
      ata: await getAssociatedTokenAddress({ owner: params.owner, mint })
    }))
  );

  // Batch-fetch all ATA accounts in a single RPC call instead of N sequential ones.
  const ataPubkeys = ataEntries.map((e) => new PublicKey(e.ata));
  const [rentPerAtaLamports, accountInfos] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(165, "confirmed"),
    connection.getMultipleAccountsInfo(ataPubkeys, "confirmed")
  ]);

  const missingAtas: { mint: string; ata: string }[] = [];
  for (let i = 0; i < ataEntries.length; i++) {
    const entry = ataEntries[i]!;
    if (!accountInfos[i]) {
      missingAtas.push({ mint: entry.mint, ata: entry.ata });
    }
  }

  return {
    rentPerAtaLamports,
    missingAtas,
    estimatedRentLamports: missingAtas.length * rentPerAtaLamports
  };
}

/**
 * Solana refuses to *create* a system account holding less than rent-exempt minimum.
 * If a fee recipient does not exist yet AND the split is below that minimum, the
 * SystemProgram::transfer simulates with InsufficientFundsForRent — wallets like
 * Phantom/Backpack will then show "not enough SOL".
 *
 * Returns each unsafe recipient with the reason so callers can skip / warn.
 */
export async function checkFeeRecipientsRentSafe(params: {
  rpcUrl: string;
  recipients: { toPubkey: string; lamports: number }[];
}): Promise<{
  systemAccountRentExemptLamports: number;
  unsafe: { toPubkey: string; lamports: number; reason: "RECIPIENT_MISSING_AND_BELOW_RENT_MIN" }[];
}> {
  const connection = new Connection(params.rpcUrl, "confirmed");
  const systemAccountRentExemptLamports = await connection.getMinimumBalanceForRentExemption(
    0,
    "confirmed"
  );

  const unsafe: { toPubkey: string; lamports: number; reason: "RECIPIENT_MISSING_AND_BELOW_RENT_MIN" }[] =
    [];

  for (const r of params.recipients) {
    if (!r.toPubkey || r.lamports <= 0) continue;
    if (r.lamports >= systemAccountRentExemptLamports) continue;

    let exists = false;
    try {
      const info = await connection.getAccountInfo(new PublicKey(r.toPubkey), "confirmed");
      exists = Boolean(info);
    } catch {
      exists = false;
    }
    if (!exists) {
      unsafe.push({
        toPubkey: r.toPubkey,
        lamports: r.lamports,
        reason: "RECIPIENT_MISSING_AND_BELOW_RENT_MIN"
      });
    }
  }

  return { systemAccountRentExemptLamports, unsafe };
}

