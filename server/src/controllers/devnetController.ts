import { status, type Context } from "elysia";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { isDevnet } from "../config";
import { errors, response } from "../types";

/**
 * Tiny devnet helper for demos: hit Solana's public devnet faucet so the
 * connected wallet can pay for `/buckets/:id/invest` SOL transfers without
 * leaving the app. No-op outside devnet.
 */
const requestDevnetAirdrop = async ({ query }: Context) => {
  if (!isDevnet()) {
    return status(400, response(false, null, "DEVNET_FAUCET_DISABLED"));
  }
  const address = (query as { address?: string })?.address?.trim();
  const amountRaw = (query as { amount?: string })?.amount?.trim();
  if (!address) return status(400, response(false, null, errors.typeBox400));

  let pk: PublicKey;
  try {
    pk = new PublicKey(address);
  } catch {
    return status(400, response(false, null, errors.typeBox400));
  }

  const sol = Math.min(Math.max(Number(amountRaw) || 1, 0.01), 2);
  const lamports = Math.floor(sol * LAMPORTS_PER_SOL);

  const rpc = process.env.SOLANA_RPC_URL?.trim() || "https://api.devnet.solana.com";
  const conn = new Connection(rpc, "confirmed");
  try {
    const sig = await conn.requestAirdrop(pk, lamports);
    return status(200, response(true, { signature: sig, sol, address: pk.toBase58() }, null));
  } catch (e) {
    console.error("[devnetAirdrop]", e);
    return status(429, response(false, null, "DEVNET_FAUCET_RATE_LIMITED"));
  }
};

export const devnetControllers = { requestDevnetAirdrop };
