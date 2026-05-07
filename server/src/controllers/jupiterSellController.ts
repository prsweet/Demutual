import { status, type Context } from "elysia";
import {
  creatorFeeBps,
  isDevnet,
  platformFeeActive,
  platformFeeBps,
  platformFeeWallet
} from "../config";
import { prisma } from "../db";
import { grossLamportsFromSol, verifyInvestFeeBundle } from "../investTxVerify";
import { toJsonSafe } from "../jsonSafe";
import { jupiterGetQuote, jupiterPostSwap, WSOL_MINT } from "../services/jupiterSwap";
import {
  errors,
  type jupiterSellCompleteSchema,
  type jupiterSellPlanSchema,
  response,
  type decoratedContext
} from "../types";

type SellLeg =
  | {
      kind: "swap";
      inputMint: string;
      symbol: string;
      percentage: number;
      /** Lamports of SOL this leg should produce (ExactOut target). */
      outputLamports: number;
      /** Estimated input amount in the asset's base units, from Jupiter. */
      estInputAmount: string;
      swapTransactionBase64: string;
    }
  | {
      kind: "noop";
      inputMint: string;
      symbol: string;
      percentage: number;
      outputLamports: number;
      reason: string;
    };

/**
 * Builds one Jupiter `ExactOut` swap per listing (asset → SOL) sized so that the sum
 * of leg outputs equals the requested `solAmount`. Investor signs each tx; SOL lands
 * in their wallet. Withdrawal is recorded only after `complete`.
 */
const buildJupiterSellPlan = async ({
  params,
  userId,
  body
}: decoratedContext<Context<{ params: { id: string }; body: jupiterSellPlanSchema }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));
    if (isDevnet()) {
      return status(400, response(false, null, errors.jupiterDevnetUnsupported400));
    }

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
        listing: { include: { asset: true } },
        creator: { select: { walletAddress: true } }
      }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.type !== "PUBLISHED") {
      return status(400, response(false, null, errors.bucketNotPublished400));
    }

    const [depAgg, witAgg] = await Promise.all([
      prisma.deposit.aggregate({
        where: { userId, bucketId: params.id },
        _sum: { amount: true }
      }),
      prisma.withdrawal.aggregate({
        where: { userId, bucketId: params.id },
        _sum: { amount: true }
      })
    ]);
    const available =
      Number(depAgg._sum.amount ?? 0) - Number(witAgg._sum.amount ?? 0);
    if (gross > available + 1e-9) {
      return status(400, response(false, null, errors.withdrawInsufficient400));
    }

    const listings = [...bucket.listing].sort((a, b) =>
      (a.asset?.symbol ?? "").localeCompare(b.asset?.symbol ?? "")
    );
    if (listings.length === 0) {
      return status(400, response(false, null, errors.bucketNoAssets400));
    }

    const slippageBps = body.slippageBps ?? 80;
    const legs: SellLeg[] = [];
    let allocated = 0;
    const n = listings.length;

    for (let i = 0; i < n; i++) {
      const row = listings[i]!;
      const pct = Number(row.percentage);
      const outLamports =
        i === n - 1 ? total - allocated : Math.floor((total * pct) / 100);
      allocated += outLamports;

      if (outLamports <= 0) continue;

      const inMint = row.assetId;
      const symbol = row.asset?.symbol ?? "?";

      if (inMint === WSOL_MINT) {
        legs.push({
          kind: "noop",
          inputMint: inMint,
          symbol,
          percentage: pct,
          outputLamports: outLamports,
          reason: "Source is SOL; user already holds it — no Jupiter swap needed."
        });
        continue;
      }

      try {
        const quote = (await jupiterGetQuote({
          inputMint: inMint,
          outputMint: WSOL_MINT,
          amountLamports: outLamports,
          slippageBps,
          swapMode: "ExactOut"
        })) as { inAmount?: string };
        const { swapTransaction } = await jupiterPostSwap({
          quoteResponse: quote,
          userPublicKey: user.walletAddress
        });
        legs.push({
          kind: "swap",
          inputMint: inMint,
          symbol,
          percentage: pct,
          outputLamports: outLamports,
          estInputAmount: String(quote.inAmount ?? "?"),
          swapTransactionBase64: swapTransaction
        });
      } catch (e) {
        console.error("[buildJupiterSellPlan leg]", inMint, e);
        return status(400, response(false, null, errors.jupiterSellPlan400));
      }
    }

    const swapCount = legs.filter((l) => l.kind === "swap").length;
    if (swapCount === 0) {
      return status(400, response(false, null, errors.jupiterSellNothingToSwap400));
    }

    const platBps = platformFeeBps();
    const platWallet = platformFeeWallet();
    const creatorBps = creatorFeeBps();
    const creatorWallet = bucket.creator?.walletAddress?.trim() || null;
    const platLamports = platformFeeActive() ? Math.floor((total * platBps) / 10000) : 0;
    const creatorLamports =
      creatorBps > 0 && creatorWallet ? Math.floor((total * creatorBps) / 10000) : 0;

    return status(
      200,
      response(
        true,
        toJsonSafe({
          bucketId: bucket.id,
          outputMint: WSOL_MINT,
          targetSol: gross,
          userWallet: user.walletAddress,
          slippageBps,
          legs,
          feeTransfer:
            platLamports + creatorLamports > 0
              ? {
                  totalLamports: platLamports + creatorLamports,
                  splits: [
                    ...(platLamports > 0 && platWallet
                      ? [
                          {
                            recipient: "platform" as const,
                            toPubkey: platWallet,
                            lamports: platLamports,
                            bps: platBps
                          }
                        ]
                      : []),
                    ...(creatorLamports > 0 && creatorWallet
                      ? [
                          {
                            recipient: "creator" as const,
                            toPubkey: creatorWallet,
                            lamports: creatorLamports,
                            bps: creatorBps
                          }
                        ]
                      : [])
                  ],
                  reason:
                    "Investor-signed SOL transfer with platform + creator splits in ONE tx. Send AFTER the swap legs land SOL in your wallet, then pass its signature to /sell/jupiter-complete."
                }
              : null,
          note:
            "ExactOut quotes: each swap pulls the asset from your wallet and lands SOL. Sign and send each leg, then send the feeTransfer (if present), then call /sell/jupiter-complete with both."
        }),
        null
      )
    );
  } catch (e) {
    console.error("[buildJupiterSellPlan]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const completeJupiterSell = async ({
  params,
  userId,
  body
}: decoratedContext<Context<{ params: { id: string }; body: jupiterSellCompleteSchema }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));
    if (isDevnet()) {
      return status(400, response(false, null, errors.jupiterDevnetUnsupported400));
    }

    const gross = Number(body.solAmount);
    if (!Number.isFinite(gross) || gross <= 0) {
      return status(400, response(false, null, errors.typeBox400));
    }

    const sigs = body.transactionSignatures.map((s) => s.trim()).filter(Boolean);
    if (sigs.length === 0) {
      return status(400, response(false, null, errors.typeBox400));
    }
    const feeSig = body.feeTransferSignature?.trim();

    const dup = await prisma.withdrawal.findUnique({
      where: { transactionSignature: sigs[0] },
      select: { id: true }
    });
    if (dup) {
      return status(409, response(false, null, errors.sellTxDuplicate409));
    }

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id },
      select: { id: true, tvl: true, type: true }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.type !== "PUBLISHED") {
      return status(400, response(false, null, errors.withdrawBucketNotPublished400));
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true }
    });
    if (!user) return status(401, response(false, null, errors.unauthorized401));

    const [depAgg, witAgg] = await Promise.all([
      prisma.deposit.aggregate({
        where: { userId, bucketId: params.id },
        _sum: { amount: true }
      }),
      prisma.withdrawal.aggregate({
        where: { userId, bucketId: params.id },
        _sum: { amount: true }
      })
    ]);
    const available =
      Number(depAgg._sum.amount ?? 0) - Number(witAgg._sum.amount ?? 0);
    if (gross > available + 1e-9) {
      return status(400, response(false, null, errors.withdrawInsufficient400));
    }

    const platBps = platformFeeBps();
    const platWallet = platformFeeWallet();
    const creatorBps = creatorFeeBps();
    const bucketCreator = await prisma.bucket.findUnique({
      where: { id: params.id },
      select: { creator: { select: { walletAddress: true } } }
    });
    const creatorWallet = bucketCreator?.creator?.walletAddress?.trim() || null;
    const grossLamports = Number(grossLamportsFromSol(gross));
    const expectedPlat = platformFeeActive() ? Math.floor((grossLamports * platBps) / 10000) : 0;
    const expectedCreator =
      creatorBps > 0 && creatorWallet ? Math.floor((grossLamports * creatorBps) / 10000) : 0;
    const expectedTransfers: { to: string; lamports: bigint }[] = [];
    if (expectedPlat > 0 && platWallet)
      expectedTransfers.push({ to: platWallet, lamports: BigInt(expectedPlat) });
    if (expectedCreator > 0 && creatorWallet)
      expectedTransfers.push({ to: creatorWallet, lamports: BigInt(expectedCreator) });

    if (expectedTransfers.length > 0) {
      if (!feeSig) {
        return status(400, response(false, null, errors.feeTransferRequired400));
      }
      const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
      if (!rpcUrl) {
        return status(503, response(false, null, errors.investNotConfigured503));
      }
      try {
        await verifyInvestFeeBundle({
          rpcUrl,
          signature: feeSig,
          expectedFrom: user.walletAddress,
          expectedTransfers
        });
      } catch (e) {
        console.error("[completeJupiterSell fee verify]", e);
        return status(400, response(false, null, errors.feeTransferVerify400));
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.create({
        data: {
          bucketId: bucket.id,
          userId,
          amount: gross,
          transactionSignature: sigs[0]!,
          jupiterLegSignatures: sigs as unknown as object
        }
      });
      const newTvl = Math.max(0, Number(bucket.tvl) - gross);
      const b = await tx.bucket.update({
        where: { id: bucket.id },
        data: { tvl: newTvl }
      });
      return { withdrawal, bucket: b };
    });

    return status(
      201,
      response(
        true,
        toJsonSafe({
          message: "Jupiter basket sell recorded",
          withdrawal: result.withdrawal,
          bucket: result.bucket,
          transactionSignatures: sigs,
          feeTransferSignature: feeSig ?? null
        }),
        null
      )
    );
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
    if (code === "P2002") {
      return status(409, response(false, null, errors.sellTxDuplicate409));
    }
    console.error("[completeJupiterSell]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const jupiterSellControllers = {
  buildJupiterSellPlan,
  completeJupiterSell
};
