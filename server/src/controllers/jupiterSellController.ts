import { status, type Context } from "elysia";
import {
  creatorFeeBps,
  isDevnet,
  minSwapLamportsForBucket,
  platformFeeActive,
  platformFeeBps,
  platformFeeWallet
} from "../config";
import { prisma } from "../db";
import { grossLamportsFromSol, verifyInvestFeeBundle } from "../investTxVerify";
import { toJsonSafe } from "../jsonSafe";
import { jupiterGetQuote, jupiterOrder, jupiterPostSwap, jupiterQuote, WSOL_MINT } from "../services/jupiterSwap";
import {
  errors,
  type jupiterAttemptResumeSchema,
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
      requestId?: string;
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

    const minSwap = minSwapLamportsForBucket(listings);
    if (total < minSwap) {
      return status(400, response(false, null, errors.amountBelowMin400));
    }

    const slippageBps = body.slippageBps ?? 80;

    // Pre-allocate the per-listing SOL targets so we can create the BasketAttempt + legs
    // (with `legId`) BEFORE quoting Jupiter. This way the FE can persist per-leg outcomes.
    type Slot = {
      inMint: string;
      symbol: string;
      percentage: number;
      outLamports: number;
    };
    const slots: Slot[] = [];
    let allocated = 0;
    const n = listings.length;
    for (let i = 0; i < n; i++) {
      const row = listings[i]!;
      const pct = Number(row.percentage);
      const outLamports =
        i === n - 1 ? total - allocated : Math.floor((total * pct) / 100);
      allocated += outLamports;
      if (outLamports <= 0) continue;
      slots.push({
        inMint: row.assetId,
        symbol: row.asset?.symbol ?? "?",
        percentage: pct,
        outLamports
      });
    }

    const swapSlots = slots.filter((s) => s.inMint !== WSOL_MINT);
    if (swapSlots.length === 0) {
      return status(400, response(false, null, errors.jupiterSellNothingToSwap400));
    }

    const attempt = await prisma.basketAttempt.create({
      data: {
        bucketId: bucket.id,
        userId,
        direction: "SELL",
        intendedSol: gross,
        slippageBps,
        status: "PENDING",
        legs: {
          create: swapSlots.map((s, i) => ({
            mint: s.inMint,
            symbol: s.symbol,
            lamports: s.outLamports,
            legIndex: i,
            status: "PENDING"
          }))
        }
      },
      include: { legs: { orderBy: { legIndex: "asc" } } }
    });

    type SellLegOut =
      | (SellLeg & { kind: "swap"; legId: string; requestId?: string })
      | (SellLeg & { kind: "noop" });

    const legs: SellLegOut[] = [];
    // Emit any noop (WSOL) legs first for UI continuity (they don't get attempt rows).
    for (const s of slots) {
      if (s.inMint === WSOL_MINT) {
        legs.push({
          kind: "noop",
          inputMint: s.inMint,
          symbol: s.symbol,
          percentage: s.percentage,
          outputLamports: s.outLamports,
          reason: "Source is SOL; user already holds it — no Jupiter swap needed."
        });
      }
    }

    for (let i = 0; i < attempt.legs.length; i++) {
      const legRow = attempt.legs[i]!;
      const slot = swapSlots.find((s) => s.inMint === legRow.mint)!;
      try {
        let expectedOut = "0";
        let transactionBase64 = "";
        let reqId = "";
        
        try {
          const order = await jupiterOrder({
            inputMint: legRow.mint,
            outputMint: WSOL_MINT,
            amountLamports: Number(legRow.lamports),
            slippageBps,
            swapMode: "ExactOut",
            taker: user.walletAddress,
            previewMode: true
          });
          expectedOut = order.otherAmountThreshold || "?"; // For ExactOut, otherAmountThreshold is max inAmount
          transactionBase64 = order.transaction;
          reqId = order.requestId;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.startsWith("JUPITER_TAKER_INSUFFICIENT_FUNDS")) {
            // Should not happen anymore with previewMode, but handle just in case
            expectedOut = "?";
          } else {
            throw e;
          }
        }

        legs.push({
          kind: "swap",
          legId: legRow.id,
          inputMint: legRow.mint,
          symbol: slot.symbol,
          percentage: slot.percentage,
          outputLamports: Number(legRow.lamports),
          estInputAmount: expectedOut,
          swapTransactionBase64: transactionBase64,
          requestId: reqId
        });
        if (i < attempt.legs.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      } catch (e) {
        console.error("[buildJupiterSellPlan leg]", legRow.mint, e);
        await prisma.basketAttempt.update({
          where: { id: attempt.id },
          data: { status: "ABANDONED", abandonedAt: new Date() }
        });
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("JUPITER_TAKER_INSUFFICIENT_FUNDS")) {
          return status(400, response(false, null, errors.walletMissingBasketAssets400));
        }
        return status(400, response(false, null, errors.jupiterSellPlan400));
      }
    }

    return status(
      200,
      response(
        true,
        toJsonSafe({
          bucketId: bucket.id,
          attemptId: attempt.id,
          outputMint: WSOL_MINT,
          targetSol: gross,
          userWallet: user.walletAddress,
          slippageBps,
          legs,
          feeTransfer: null,
          note:
            "ExactOut quotes: each swap pulls the asset from your wallet and lands SOL. Sign and send each leg, then call /sell/jupiter-complete with attemptId + per-leg results."
        }),
        null
      )
    );
  } catch (e) {
    console.error("[buildJupiterSellPlan]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

/** Per-leg sell complete: only successful legs reduce the user's basket position and
 * the bucket TVL. Idempotent for resume — running this multiple times on the same attempt
 * updates the single Withdrawal row by the delta of newly-successful legs.
 */
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

    const attempt = await prisma.basketAttempt.findUnique({
      where: { id: body.attemptId },
      include: { legs: true }
    });
    if (!attempt || attempt.userId !== userId || attempt.bucketId !== params.id) {
      return status(404, response(false, null, errors.attemptNotFound404));
    }
    if (attempt.direction !== "SELL") {
      return status(400, response(false, null, errors.attemptNotResumable400));
    }
    if (attempt.status === "COMPLETE" || attempt.status === "ABANDONED") {
      return status(400, response(false, null, errors.attemptNotResumable400));
    }

    const legById = new Map(attempt.legs.map((l) => [l.id, l] as const));
    for (const r of body.legs) {
      if (!legById.has(r.legId)) {
        return status(400, response(false, null, errors.attemptLegMismatch400));
      }
    }

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id },
      select: { id: true, tvl: true, type: true }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.type !== "PUBLISHED") {
      return status(400, response(false, null, errors.withdrawBucketNotPublished400));
    }

    // Solvency check: existing successful legs + newly-reported successful legs must not
    // exceed remaining position in this bucket.
    const previouslySuccessLamports = attempt.legs
      .filter((l) => l.status === "SUCCESS")
      .reduce((acc, l) => acc + Number(l.lamports), 0);
    const newSuccessLamports = body.legs
      .filter((r) => r.status === "SUCCESS")
      .map((r) => legById.get(r.legId)!)
      .filter((l) => l.status !== "SUCCESS")
      .reduce((acc, l) => acc + Number(l.lamports), 0);
    const totalSuccessSol = (previouslySuccessLamports + newSuccessLamports) / 1e9;

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
    const previouslyBookedFromThisAttempt = await prisma.withdrawal.aggregate({
      where: {
        userId,
        bucketId: params.id,
        transactionSignature: {
          in: attempt.legs
            .filter((l) => l.transactionSignature)
            .map((l) => l.transactionSignature!)
        }
      },
      _sum: { amount: true }
    });
    const alreadyBooked = Number(previouslyBookedFromThisAttempt._sum.amount ?? 0);
    const available =
      Number(depAgg._sum.amount ?? 0) -
      Number(witAgg._sum.amount ?? 0) +
      alreadyBooked; // already-booked-from-this-attempt is being replaced, not double-counted
    if (totalSuccessSol > available + 1e-9) {
      return status(400, response(false, null, errors.withdrawInsufficient400));
    }

    const newSigs = body.legs
      .filter((r) => r.status === "SUCCESS" && r.signature)
      .map((r) => r.signature!.trim());
    if (newSigs.length > 0) {
      const dup = await prisma.basketAttemptLeg.findFirst({
        where: { transactionSignature: { in: newSigs }, attemptId: { not: attempt.id } },
        select: { id: true }
      });
      if (dup) {
        return status(409, response(false, null, errors.sellTxDuplicate409));
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      for (const r of body.legs) {
        const leg = legById.get(r.legId)!;
        if (leg.status === "SUCCESS") continue;
        await tx.basketAttemptLeg.update({
          where: { id: r.legId },
          data: {
            status: r.status,
            ...(r.signature ? { transactionSignature: r.signature.trim() } : {}),
            ...(r.error ? { lastError: r.error.slice(0, 1024) } : {})
          }
        });
      }

      const refreshed = await tx.basketAttemptLeg.findMany({
        where: { attemptId: attempt.id }
      });
      const allSuccess = refreshed.every((l) => l.status === "SUCCESS");
      const anyPending = refreshed.some((l) => l.status === "PENDING");
      const anyFailed = refreshed.some((l) => l.status === "FAILED");
      const newStatus = allSuccess
        ? "COMPLETE"
        : anyPending || anyFailed
        ? "PARTIAL"
        : "PARTIAL";
      await tx.basketAttempt.update({
        where: { id: attempt.id },
        data: { status: newStatus }
      });

      // Upsert single Withdrawal for this attempt.
      const totalSuccessLamports =
        previouslySuccessLamports + newSuccessLamports; // recompute from in-memory; refreshed already reflects it
      const totalSol = totalSuccessLamports / 1e9;
      const allKnownSigs = refreshed
        .filter((l) => l.transactionSignature)
        .map((l) => l.transactionSignature!) as string[];
      const existingWithdrawal = allKnownSigs.length
        ? await tx.withdrawal.findFirst({
            where: { userId, bucketId: bucket.id, transactionSignature: { in: allKnownSigs } }
          })
        : null;

      const oldAmount = existingWithdrawal ? Number(existingWithdrawal.amount) : 0;
      const firstSuccessSig =
        body.legs.find((r) => r.status === "SUCCESS")?.signature?.trim() ?? null;

      let withdrawal = existingWithdrawal;
      if (totalSol > 0) {
        if (existingWithdrawal) {
          withdrawal = await tx.withdrawal.update({
            where: { id: existingWithdrawal.id },
            data: {
              amount: totalSol,
              jupiterLegSignatures: allKnownSigs as unknown as object
            }
          });
        } else if (firstSuccessSig) {
          withdrawal = await tx.withdrawal.create({
            data: {
              bucketId: bucket.id,
              userId,
              amount: totalSol,
              transactionSignature: firstSuccessSig,
              jupiterLegSignatures: allKnownSigs as unknown as object
            }
          });
        }
      }

      const tvlDelta = totalSol - oldAmount;
      let bucketUpdate = bucket;
      if (tvlDelta !== 0) {
        const newTvl = Math.max(0, Number(bucket.tvl) - tvlDelta);
        bucketUpdate = await tx.bucket.update({
          where: { id: bucket.id },
          data: { tvl: newTvl }
        });
      }

      return {
        withdrawal,
        bucket: bucketUpdate,
        attemptStatus: newStatus,
        totalSol,
        successLegIds: refreshed.filter((l) => l.status === "SUCCESS").map((l) => l.id),
        failedLegIds: refreshed.filter((l) => l.status === "FAILED").map((l) => l.id),
        pendingLegIds: refreshed.filter((l) => l.status === "PENDING").map((l) => l.id)
      };
    });

    return status(
      result.attemptStatus === "COMPLETE" ? 201 : 200,
      response(
        true,
        toJsonSafe({
          message:
            result.attemptStatus === "COMPLETE"
              ? "Jupiter basket sell fully recorded"
              : "Jupiter basket sell partially recorded — resume any time to sell the rest",
          attemptId: attempt.id,
          attemptStatus: result.attemptStatus,
          withdrawal: result.withdrawal,
          bucket: result.bucket,
          successLegIds: result.successLegIds,
          failedLegIds: result.failedLegIds,
          pendingLegIds: result.pendingLegIds,
          feeTransferSignature: null,
          breakdown: {
            intendedSol: Number(attempt.intendedSol),
            actuallyWithdrawnSol: result.totalSol,
            note:
              result.attemptStatus !== "COMPLETE"
                ? "Some legs didn't fill (slippage / expiry). Resume the attempt to sell the rest."
                : "All legs settled."
          }
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

/** Resume a PARTIAL/PENDING sell attempt: re-quote ExactOut for legs still PENDING/FAILED. */
const resumeJupiterSellAttempt = async ({
  params,
  userId,
  body
}: decoratedContext<
  Context<{ params: { id: string; attemptId: string }; body: jupiterAttemptResumeSchema }>
>) => {
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

    const attempt = await prisma.basketAttempt.findUnique({
      where: { id: params.attemptId },
      include: { legs: { orderBy: { legIndex: "asc" } } }
    });
    if (!attempt || attempt.userId !== userId || attempt.bucketId !== params.id) {
      return status(404, response(false, null, errors.attemptNotFound404));
    }
    if (attempt.direction !== "SELL") {
      return status(400, response(false, null, errors.attemptNotResumable400));
    }
    if (attempt.status === "COMPLETE" || attempt.status === "ABANDONED") {
      return status(400, response(false, null, errors.attemptNotResumable400));
    }

    const slippageBps = body.slippageBps ?? attempt.slippageBps ?? 80;
    const toResume = attempt.legs.filter(
      (l) => l.status === "PENDING" || l.status === "FAILED"
    );
    if (toResume.length === 0) {
      return status(400, response(false, null, errors.attemptNoLegsToResume400));
    }

    type SellLegOut = {
      legId: string;
      inputMint: string;
      symbol: string | null;
      outputLamports: number;
      estInputAmount: string;
      swapTransactionBase64: string;
      requestId?: string;
    };
    const legs: SellLegOut[] = [];
    for (let i = 0; i < toResume.length; i++) {
      const legRow = toResume[i]!;
      try {
        const order = await jupiterOrder({
          inputMint: legRow.mint,
          outputMint: WSOL_MINT,
          amountLamports: Number(legRow.lamports),
          slippageBps,
          swapMode: "ExactOut",
          taker: user.walletAddress
        });
        legs.push({
          legId: legRow.id,
          inputMint: legRow.mint,
          symbol: legRow.symbol,
          outputLamports: Number(legRow.lamports),
          estInputAmount: order.otherAmountThreshold || "?",
          swapTransactionBase64: order.transaction,
          requestId: order.requestId
        });
        if (i < toResume.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      } catch (e) {
        console.error("[resumeJupiterSellAttempt leg]", legRow.mint, e);
        return status(400, response(false, null, errors.jupiterSellPlan400));
      }
    }

    return status(
      200,
      response(
        true,
        toJsonSafe({
          attemptId: attempt.id,
          slippageBps,
          legs
        }),
        null
      )
    );
  } catch (e) {
    console.error("[resumeJupiterSellAttempt]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const jupiterSellControllers = {
  buildJupiterSellPlan,
  completeJupiterSell,
  resumeJupiterSellAttempt
};
