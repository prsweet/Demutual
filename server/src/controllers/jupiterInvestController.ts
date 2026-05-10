import { status, type Context } from "elysia";
import {
  anyFeeActive,
  creatorFeeBps,
  isDevnet,
  platformFeeActive,
  platformFeeBps,
  platformFeeWallet
} from "../config";
import { prisma } from "../db";
import { grossLamportsFromSol, verifyInvestFeeBundle } from "../investTxVerify";
import { toJsonSafe } from "../jsonSafe";
import { checkFeeRecipientsRentSafe, estimateMissingAtaRentLamports } from "../services/ataRent";
import { jupiterExecute, jupiterOrder, WSOL_MINT } from "../services/jupiterSwap";
import {
  errors,
  type jupiterExecuteSchema,
  type jupiterInvestCompleteSchema,
  type jupiterInvestPlanSchema,
  type jupiterLegOrderSchema,
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
      expectedOutAmount: string;
      minimumOutAmount: string;
      swapTransactionBase64: string;
      requestId?: string;
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
    if (isDevnet()) {
      return status(400, response(false, null, errors.jupiterDevnetUnsupported400));
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true }
    });
    if (!user) return status(401, response(false, null, errors.unauthorized401));

    const netSwapSol = Number(body.solAmount);
    if (!Number.isFinite(netSwapSol) || netSwapSol <= 0) {
      return status(400, response(false, null, errors.typeBox400));
    }

    let netSwapLamportsBig: bigint;
    try {
      netSwapLamportsBig = grossLamportsFromSol(netSwapSol);
    } catch {
      return status(400, response(false, null, errors.typeBox400));
    }
    const swapLamports = Number(netSwapLamportsBig);

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

    const platBps = platformFeeBps();
    const platWallet = platformFeeWallet();
    const creatorBps = creatorFeeBps();
    const creatorWallet = bucket.creator?.walletAddress?.trim() || null;

    const platLamports = platformFeeActive() ? Math.floor((swapLamports * platBps) / 10000) : 0;
    const creatorLamports =
      creatorBps > 0 && creatorWallet ? Math.floor((swapLamports * creatorBps) / 10000) : 0;
    const grossLamports = swapLamports + platLamports + creatorLamports;
    const gross = grossLamports / 1e9;

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

    const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || "";
    const ataRent =
      rpcUrl && user.walletAddress
        ? await estimateMissingAtaRentLamports({
            rpcUrl,
            owner: user.walletAddress,
            mints: [WSOL_MINT, ...listings.map((l) => l.assetId)]
          }).catch((e) => {
            console.warn("[ataRent] check failed", e);
            return null;
          })
        : null;

    for (let i = 0; i < n; i++) {
      const row = listings[i]!;
      const pct = Number(row.percentage);
      const lamports = i === n - 1 ? swapLamports - allocated : Math.floor((swapLamports * pct) / 100);
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
        const order = await jupiterOrder({
          inputMint: WSOL_MINT,
          outputMint: outMint,
          amountLamports: lamports,
          slippageBps,
          taker: user.walletAddress
        });
        legs.push({
          kind: "swap",
          outputMint: outMint,
          symbol,
          percentage: pct,
          inputLamports: lamports,
          expectedOutAmount: order.outAmount,
          minimumOutAmount: order.otherAmountThreshold || "0",
          swapTransactionBase64: order.transaction,
          requestId: order.requestId
        });

        // Delay to avoid Jupiter 429 rate limit on free tier
        await new Promise((resolve) => setTimeout(resolve, 600));
      } catch (e) {
        console.error("[buildJupiterPlan leg]", outMint, e);
        return status(400, response(false, null, errors.jupiterPlan400));
      }
    }

    const swapCount = legs.filter((l) => l.kind === "swap").length;
    if (swapCount === 0) {
      return status(400, response(false, null, errors.jupiterNothingToSwap400));
    }

    const splitsRaw: { recipient: "platform" | "creator"; toPubkey: string; lamports: number; bps: number }[] = [
      ...(platLamports > 0 && platWallet
        ? [{ recipient: "platform" as const, toPubkey: platWallet, lamports: platLamports, bps: platBps }]
        : []),
      ...(creatorLamports > 0 && creatorWallet
        ? [{ recipient: "creator" as const, toPubkey: creatorWallet, lamports: creatorLamports, bps: creatorBps }]
        : [])
    ];

    let feeTransferSkippedReason: string | null = null;
    let safeFeeTransfer: {
      totalLamports: number;
      splits: typeof splitsRaw;
      reason: string;
    } | null = null;

    if (splitsRaw.length > 0) {
      const safetyCheck = rpcUrl
        ? await checkFeeRecipientsRentSafe({ rpcUrl, recipients: splitsRaw }).catch((e) => {
            console.warn("[feeRecipientCheck] failed", e);
            return null;
          })
        : null;

      if (safetyCheck && safetyCheck.unsafe.length > 0) {
        feeTransferSkippedReason =
          `Skipped fee transfer: ${safetyCheck.unsafe.length} recipient(s) ` +
          `do not exist on-chain and the split (${safetyCheck.unsafe
            .map((u) => `${u.lamports} lamports`)
            .join(", ")}) is below the system rent-exempt minimum ` +
          `(${safetyCheck.systemAccountRentExemptLamports} lamports). ` +
          `Fund those recipient wallets with at least the rent-exempt minimum or raise PLATFORM_FEE_BPS / CREATOR_FEE_BPS so each split exceeds it.`;
      } else {
        safeFeeTransfer = {
          totalLamports: platLamports + creatorLamports,
          splits: splitsRaw,
          reason:
            "Investor-signed SOL transfer with both fee splits in ONE tx. Send BEFORE the swap legs and pass its signature to /invest/jupiter-complete."
        };
      }
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
          feeTransfer: safeFeeTransfer,
          feeTransferSkippedReason,
          investorRequirements: ataRent
            ? {
                rentPerAtaLamports: ataRent.rentPerAtaLamports,
                missingAtas: ataRent.missingAtas,
                estimatedRentLamports: ataRent.estimatedRentLamports
              }
            : null,
          note:
            "Investor requirements: keep extra SOL for network fees AND rent to create token accounts (ATAs) for tokens you don’t already hold—otherwise swaps may fail simulation with InsufficientFundsForRent. Sign feeTransfer (if present) first, then sign and send each swap leg with the same wallet. Devnet RPC will not match Jupiter mainnet routes."
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
    if (isDevnet()) {
      return status(400, response(false, null, errors.jupiterDevnetUnsupported400));
    }

    const netSwapSol = Number(body.solAmount);
    if (!Number.isFinite(netSwapSol) || netSwapSol <= 0) {
      return status(400, response(false, null, errors.typeBox400));
    }

    const sigs = body.transactionSignatures.map((s) => s.trim()).filter(Boolean);
    if (sigs.length === 0) {
      return status(400, response(false, null, errors.typeBox400));
    }
    const feeSig = body.feeTransferSignature?.trim();

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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true }
    });
    if (!user) return status(401, response(false, null, errors.unauthorized401));

    const bucketCreator = await prisma.bucket.findUnique({
      where: { id: params.id },
      select: { creator: { select: { walletAddress: true } } }
    });
    const creatorWallet = bucketCreator?.creator?.walletAddress?.trim() || null;

    const platBps = platformFeeBps();
    const platWallet = platformFeeWallet();
    const creatorBps = creatorFeeBps();
    const swapLamports = Number(grossLamportsFromSol(netSwapSol));
    const expectedPlat = platformFeeActive() ? Math.floor((swapLamports * platBps) / 10000) : 0;
    const expectedCreator =
      creatorBps > 0 && creatorWallet ? Math.floor((swapLamports * creatorBps) / 10000) : 0;
    const expectedTransfers: { to: string; lamports: bigint }[] = [];
    if (expectedPlat > 0 && platWallet)
      expectedTransfers.push({ to: platWallet, lamports: BigInt(expectedPlat) });
    if (expectedCreator > 0 && creatorWallet)
      expectedTransfers.push({ to: creatorWallet, lamports: BigInt(expectedCreator) });

    if (expectedTransfers.length > 0) {
      const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
      if (!rpcUrl) {
        return status(503, response(false, null, errors.investNotConfigured503));
      }

      // Mirror buildJupiterPlan: if any recipient would fail rent simulation, the plan
      // skipped feeTransfer entirely — so don't require a feeSig here either.
      const safety = await checkFeeRecipientsRentSafe({
        rpcUrl,
        recipients: expectedTransfers.map((t) => ({ toPubkey: t.to, lamports: Number(t.lamports) }))
      }).catch(() => null);
      const feeTransferSkipped = !!(safety && safety.unsafe.length > 0);

      if (!feeTransferSkipped) {
        if (!feeSig) {
          return status(400, response(false, null, errors.feeTransferRequired400));
        }
        try {
          await verifyInvestFeeBundle({
            rpcUrl,
            signature: feeSig,
            expectedFrom: user.walletAddress,
            expectedTransfers
          });
        } catch (e) {
          console.error("[completeJupiterInvest fee verify]", e);
          return status(400, response(false, null, errors.feeTransferVerify400));
        }
      }
    }

    const feePlatformSol = expectedPlat / 1e9;
    const feeCreatorSol = expectedCreator / 1e9;
    const net = netSwapSol;
    const totalGross = netSwapSol + feePlatformSol + feeCreatorSol;

    const result = await prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.create({
        data: {
          bucketId: bucket.id,
          userId,
          amount: net,
          feeCreator: feeCreatorSol,
          feePlatform: feePlatformSol,
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
          feeTransferSignature: feeSig ?? null,
          breakdown: {
            grossAmount: totalGross,
            platformFeeBps: platBps,
            creatorFeeBps: creatorBps,
            platformFeeSol: feePlatformSol,
            creatorFeeSol: feeCreatorSol,
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

/** Build a fresh Jupiter order for a single leg right before signing. Avoids blockhash expiry on multi-leg flows. */
const buildJupiterLegOrder = async ({
  params,
  userId,
  body
}: decoratedContext<Context<{ params: { id: string }; body: jupiterLegOrderSchema }>>) => {
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

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id },
      include: { listing: true }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.type !== "PUBLISHED") {
      return status(400, response(false, null, errors.bucketNotPublished400));
    }

    const outMint = body.outputMint.trim();
    const lamports = Math.floor(Number(body.lamports));
    if (!outMint || !Number.isFinite(lamports) || lamports <= 0) {
      return status(400, response(false, null, errors.typeBox400));
    }
    if (outMint === WSOL_MINT) {
      return status(400, response(false, null, errors.jupiterPlan400));
    }
    const inListings = bucket.listing.some((l) => l.assetId === outMint);
    if (!inListings) {
      return status(400, response(false, null, errors.jupiterPlan400));
    }

    const slippageBps = body.slippageBps ?? 80;
    const order = await jupiterOrder({
      inputMint: WSOL_MINT,
      outputMint: outMint,
      amountLamports: lamports,
      slippageBps,
      taker: user.walletAddress
    });

    return status(
      200,
      response(
        true,
        toJsonSafe({
          outputMint: outMint,
          inputLamports: lamports,
          slippageBps,
          swapTransactionBase64: order.transaction,
          requestId: order.requestId,
          expectedOutAmount: order.outAmount,
          minimumOutAmount: order.otherAmountThreshold || "0"
        }),
        null
      )
    );
  } catch (e) {
    console.error("[buildJupiterLegOrder]", e);
    return status(400, response(false, null, errors.jupiterPlan400));
  }
};

export const jupiterInvestControllers = {
  buildJupiterPlan,
  buildJupiterLegOrder,
  executeJupiterOrder: async ({
    userId,
    body
  }: decoratedContext<Context<{ params: { id: string }; body: jupiterExecuteSchema }>>) => {
    try {
      if (!userId) return status(401, response(false, null, errors.unauthorized401));
      if (isDevnet()) {
        return status(400, response(false, null, errors.jupiterDevnetUnsupported400));
      }

      const signedTransaction = body.signedTransaction.trim();
      const requestId = body.requestId.trim();
      if (!signedTransaction || !requestId) {
        return status(400, response(false, null, errors.typeBox400));
      }

      const result = await jupiterExecute({
        signedTransaction,
        requestId,
        ...(typeof body.lastValidBlockHeight === "number"
          ? { lastValidBlockHeight: body.lastValidBlockHeight }
          : {})
      });

      return status(200, response(true, toJsonSafe(result), null));
    } catch (e) {
      console.error("[executeJupiterOrder]", e);
      return status(400, response(false, null, errors.jupiterPlan400));
    }
  },
  completeJupiterInvest
};
