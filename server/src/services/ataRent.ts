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
  const rentPerAtaLamports = await connection.getMinimumBalanceForRentExemption(165, "confirmed");

  const uniqueMints = [...new Set(params.mints.map((m) => m.trim()).filter(Boolean))];
  const missingAtas: { mint: string; ata: string }[] = [];

  for (const mint of uniqueMints) {
    const ata = await getAssociatedTokenAddress({ owner: params.owner, mint });
    const info = await connection.getAccountInfo(new PublicKey(ata), "confirmed");
    if (!info) missingAtas.push({ mint, ata });
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

