import { status, type Context } from "elysia";
import { INVEST_PROTOCOL_FEE_RATE } from "../constants/fees";
import { prisma } from "../db";
import { grossLamportsFromSol } from "../investTxVerify";
import { toJsonSafe } from "../jsonSafe";
import { jupiterGetQuote, jupiterPostSwap, WSOL_MINT } from "../services/jupiterSwap";
import {
  errors,
  type jupiterInvestCompleteSchema,
  type jupiterInvestPlanSchema,
  response,
  type decoratedContext
} from "../types";

type PlanLeg =
  | {
      kind: "swap";
      outputMint: string;
      symbol: string;
      percentage: number;
      inputLamports: number;
      swapTransactionBase64: string;
    }
  | {
      kind: "noop";
      outputMint: string;
      symbol: string;
      percentage: number;
      inputLamports: number;
      reason: string;
    };

/**
 * Returns one unsigned swap transaction per listing (SOL → asset), sized by bucket weights.
 * Investor must sign & send each tx on the same cluster Jupiter targeted (usually mainnet).
 */
const buildJupiterPlan = async ({
  params,
  userId,
  body
}: decoratedContext<Context<{ params: { id: string }; body: jupiterInvestPlanSchema }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true }
    });
    if (!user) return status(401, response(false, null, errors.unauthorized401));

    const gross = Number(body.solAmount);
    if (!Number.isFinite(gross) || gross <= 0) {
      return status(400, response(false, null, errors.typeBox400));
    }

    let totalLamports: bigint;
    try {
      totalLamports = grossLamportsFromSol(gross);
    } catch {
      return status(400, response(false, null, errors.typeBox400));
    }
    const total = Number(totalLamports);

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id },
      include: {
        listing: { include: { asset: true } }
      }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.type !== "PUBLISHED") {
      return status(400, response(false, null, errors.bucketNotPublished400));
    }

    const listings = [...bucket.listing].sort((a, b) =>
      (a.asset?.symbol ?? "").localeCompare(b.asset?.symbol ?? "")
    );
    if (listings.length === 0) {
      return status(400, response(false, null, errors.bucketNoAssets400));
    }

    const slippageBps = body.slippageBps ?? 80;
    const legs: PlanLeg[] = [];
    let allocated = 0;
    const n = listings.length;

    for (let i = 0; i < n; i++) {
      const row = listings[i]!;
      const pct = Number(row.percentage);
      const lamports = i === n - 1 ? total - allocated : Math.floor((total * pct) / 100);
      allocated += lamports;

      if (lamports <= 0) continue;

      const outMint = row.assetId;
      const symbol = row.asset?.symbol ?? "?";

      if (outMint === WSOL_MINT) {
        legs.push({
          kind: "noop",
          outputMint: outMint,
          symbol,
          percentage: pct,
          inputLamports: lamports,
          reason: "Target is SOL; no Jupiter swap needed."
        });
        continue;
      }

      try {
        const quote = await jupiterGetQuote({
          inputMint: WSOL_MINT,
          outputMint: outMint,
          amountLamports: lamports,
          slippageBps
        });
        const { swapTransaction } = await jupiterPostSwap({
          quoteResponse: quote,
          userPublicKey: user.walletAddress
        });
        legs.push({
          kind: "swap",
          outputMint: outMint,
          symbol,
          percentage: pct,
          inputLamports: lamports,
          swapTransactionBase64: swapTransaction
        });
      } catch (e) {
        console.error("[buildJupiterPlan leg]", outMint, e);
        return status(400, response(false, null, errors.jupiterPlan400));
      }
    }

    const swapCount = legs.filter((l) => l.kind === "swap").length;
    if (swapCount === 0) {
      return status(400, response(false, null, errors.jupiterNothingToSwap400));
    }

    return status(
      200,
      response(
        true,
        toJsonSafe({
          bucketId: bucket.id,
          inputMint: WSOL_MINT,
          grossSol: gross,
          userWallet: user.walletAddress,
          slippageBps,
          legs,
          note:
            "Sign and send each swap leg in order with the same wallet. Jupiter routes target mainnet liquidity; devnet RPC in your wallet will not match these transactions."
        }),
        null
      )
    );
  } catch (e) {
    console.error("[buildJupiterPlan]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

/** Book TVL after successful on-chain swaps (MVP: does not re-parse swap amounts from chain). */
const completeJupiterInvest = async ({
  params,
  userId,
  body
}: decoratedContext<Context<{ params: { id: string }; body: jupiterInvestCompleteSchema }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const gross = Number(body.solAmount);
    if (!Number.isFinite(gross) || gross <= 0) {
      return status(400, response(false, null, errors.typeBox400));
    }

    const sigs = body.transactionSignatures.map((s) => s.trim()).filter(Boolean);
    if (sigs.length === 0) {
      return status(400, response(false, null, errors.typeBox400));
    }

    const dup = await prisma.deposit.findUnique({
      where: { transactionSignature: sigs[0] },
      select: { id: true }
    });
    if (dup) {
      return status(409, response(false, null, errors.investTxDuplicate409));
    }

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id },
      select: { id: true, tvl: true, type: true }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.type !== "PUBLISHED") {
      return status(400, response(false, null, errors.bucketNotPublished400));
    }

    const feeTotal = gross * INVEST_PROTOCOL_FEE_RATE;
    const feeCreator = feeTotal / 2;
    const feePlatform = feeTotal - feeCreator;
    const net = gross - feeTotal;

    const result = await prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.create({
        data: {
          bucketId: bucket.id,
          userId,
          amount: net,
          feeCreator,
          feePlatform,
          transactionSignature: sigs[0]!,
          jupiterLegSignatures: sigs as unknown as object
        }
      });
      const bucketUpdate = await tx.bucket.update({
        where: { id: bucket.id },
        data: { tvl: Number(bucket.tvl) + net }
      });
      return { deposit, bucketUpdate };
    });

    return status(
      201,
      response(
        true,
        toJsonSafe({
          message: "Jupiter basket invest recorded",
          deposit: result.deposit,
          bucket: result.bucketUpdate,
          transactionSignatures: sigs,
          breakdown: {
            grossAmount: gross,
            protocolFeeRate: INVEST_PROTOCOL_FEE_RATE,
            feeTotal,
            feeCreator,
            feePlatform,
            netToPool: net
          }
        }),
        null
      )
    );
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
    if (code === "P2002") {
      return status(409, response(false, null, errors.investTxDuplicate409));
    }
    console.error("[completeJupiterInvest]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const jupiterInvestControllers = {
  buildJupiterPlan,
  completeJupiterInvest
};
