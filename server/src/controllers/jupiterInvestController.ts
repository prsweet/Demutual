import { status, type Context } from "elysia";
import {
  anyFeeActive,
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
import { checkFeeRecipientsRentSafe, estimateMissingAtaRentLamports } from "../services/ataRent";
import { jupiterExecute, jupiterOrder, WSOL_MINT } from "../services/jupiterSwap";
import {
  errors,
  type jupiterAttemptResumeSchema,
  type jupiterExecuteSchema,
  type jupiterInvestCompleteSchema,
  type jupiterInvestPlanSchema,
  type jupiterLegOrderBatchSchema,
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

    const minSwap = minSwapLamportsForBucket(listings);
    if (swapLamports < minSwap) {
      return status(400, response(false, null, errors.amountBelowMin400));
    }

    const slippageBps = body.slippageBps ?? 80;
    const legs: PlanLeg[] = [];
    let allocated = 0;
    const n = listings.length;

    const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || "";
    // WSOL is handled transparently by Jupiter's wrap-and-unwrap; the user does not need
    // a persistent WSOL ATA, so it must not appear in the rent pre-check.
    const ataPrecheckMints = Array.from(
      new Set(listings.map((l) => l.assetId).filter((m) => m && m !== WSOL_MINT))
    );
    const ataRent =
      rpcUrl && user.walletAddress && ataPrecheckMints.length > 0
        ? await estimateMissingAtaRentLamports({
            rpcUrl,
            owner: user.walletAddress,
            mints: ataPrecheckMints
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

/** Per-leg complete: only successful legs credit the user's Deposit and bucket TVL.
 * Idempotent for resume — running this multiple times for the same attempt updates the
 * single Deposit row by the delta of newly-successful legs (and bumps TVL by the delta).
 */
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

    const feeSig = body.feeTransferSignature?.trim();
    const attempt = await prisma.basketAttempt.findUnique({
      where: { id: body.attemptId },
      include: { legs: true }
    });
    if (!attempt || attempt.userId !== userId || attempt.bucketId !== params.id) {
      return status(404, response(false, null, errors.attemptNotFound404));
    }
    if (attempt.direction !== "BUY") {
      return status(400, response(false, null, errors.attemptNotResumable400));
    }
    if (attempt.status === "COMPLETE" || attempt.status === "ABANDONED") {
      return status(400, response(false, null, errors.attemptNotResumable400));
    }

    // Validate every reported legId belongs to this attempt.
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
    const intendedSwapLamports = Number(grossLamportsFromSol(Number(attempt.intendedSol)));
    const expectedPlat = platformFeeActive()
      ? Math.floor((intendedSwapLamports * platBps) / 10000)
      : 0;
    const expectedCreator =
      creatorBps > 0 && creatorWallet
        ? Math.floor((intendedSwapLamports * creatorBps) / 10000)
        : 0;
    const expectedTransfers: { to: string; lamports: bigint }[] = [];
    if (expectedPlat > 0 && platWallet)
      expectedTransfers.push({ to: platWallet, lamports: BigInt(expectedPlat) });
    if (expectedCreator > 0 && creatorWallet)
      expectedTransfers.push({ to: creatorWallet, lamports: BigInt(expectedCreator) });

    // Fee verification only runs once — on the first complete call (when feeTransferSignature
    // hasn't been persisted yet). Resume calls skip this entirely.
    const isFirstComplete = !attempt.feeTransferSignature;
    let feeTransferSkipped = false;
    if (isFirstComplete && expectedTransfers.length > 0) {
      const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
      if (!rpcUrl) {
        return status(503, response(false, null, errors.investNotConfigured503));
      }
      const safety = await checkFeeRecipientsRentSafe({
        rpcUrl,
        recipients: expectedTransfers.map((t) => ({
          toPubkey: t.to,
          lamports: Number(t.lamports)
        }))
      }).catch(() => null);
      feeTransferSkipped = !!(safety && safety.unsafe.length > 0);

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

    // Compute the delta (newly-successful) lamports vs what's already credited in
    // existing SUCCESS legs — so resume only adds the missing exposure.
    const previouslySuccessLamports = attempt.legs
      .filter((l) => l.status === "SUCCESS")
      .reduce((acc, l) => acc + Number(l.lamports), 0);

    const reportedSuccessLegIds = new Set(
      body.legs.filter((r) => r.status === "SUCCESS").map((r) => r.legId)
    );

    const newSuccessLamports = body.legs
      .filter((r) => r.status === "SUCCESS")
      .map((r) => legById.get(r.legId)!)
      .filter((l) => l.status !== "SUCCESS") // don't double-count if already booked
      .reduce((acc, l) => acc + Number(l.lamports), 0);

    const totalSuccessLamports = previouslySuccessLamports + newSuccessLamports;

    // Detect duplicate signatures up front (P2002 also catches this, but a clearer 409 wins).
    const newSigs = body.legs
      .filter((r) => r.status === "SUCCESS" && r.signature)
      .map((r) => r.signature!.trim());
    if (newSigs.length > 0) {
      const dup = await prisma.basketAttemptLeg.findFirst({
        where: { transactionSignature: { in: newSigs }, attemptId: { not: attempt.id } },
        select: { id: true }
      });
      if (dup) {
        return status(409, response(false, null, errors.investTxDuplicate409));
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1) Update each leg row with the reported outcome.
      for (const r of body.legs) {
        const leg = legById.get(r.legId)!;
        if (leg.status === "SUCCESS") continue; // never overwrite a confirmed leg
        await tx.basketAttemptLeg.update({
          where: { id: r.legId },
          data: {
            status: r.status,
            ...(r.signature ? { transactionSignature: r.signature.trim() } : {}),
            ...(r.error ? { lastError: r.error.slice(0, 1024) } : {})
          }
        });
      }

      // 2) Persist feeTransferSignature on the attempt (first call only).
      if (isFirstComplete && feeSig) {
        await tx.basketAttempt.update({
          where: { id: attempt.id },
          data: { feeTransferSignature: feeSig }
        });
      }

      // 3) Decide overall attempt status from the *latest* leg statuses.
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

      // 4) Upsert the Deposit row for this attempt (one Deposit per attempt; amount is
      //    sum of SUCCESS-leg lamports as SOL). On resume we update amount + add to TVL.
      let deposit;
      const depositSol = totalSuccessLamports / 1e9;
      const platformFeeShareSol =
        intendedSwapLamports > 0
          ? (expectedPlat * (totalSuccessLamports / intendedSwapLamports)) / 1e9
          : 0;
      const creatorFeeShareSol =
        intendedSwapLamports > 0
          ? (expectedCreator * (totalSuccessLamports / intendedSwapLamports)) / 1e9
          : 0;

      const firstSuccessSig =
        body.legs.find((r) => r.status === "SUCCESS")?.signature?.trim() ?? null;

      // Try to find an existing Deposit row for this attempt (we tag by signature of the
      // very first successful leg — Deposit.transactionSignature is unique).
      const allKnownSigs = refreshed
        .filter((l) => l.transactionSignature)
        .map((l) => l.transactionSignature!) as string[];
      const existingDeposit = allKnownSigs.length
        ? await tx.deposit.findFirst({
            where: { userId, bucketId: bucket.id, transactionSignature: { in: allKnownSigs } }
          })
        : null;

      const oldAmount = existingDeposit ? Number(existingDeposit.amount) : 0;

      if (depositSol > 0) {
        if (existingDeposit) {
          deposit = await tx.deposit.update({
            where: { id: existingDeposit.id },
            data: {
              amount: depositSol,
              feeCreator: creatorFeeShareSol,
              feePlatform: platformFeeShareSol,
              jupiterLegSignatures: allKnownSigs as unknown as object
            }
          });
        } else if (firstSuccessSig) {
          deposit = await tx.deposit.create({
            data: {
              bucketId: bucket.id,
              userId,
              amount: depositSol,
              feeCreator: creatorFeeShareSol,
              feePlatform: platformFeeShareSol,
              transactionSignature: firstSuccessSig,
              jupiterLegSignatures: allKnownSigs as unknown as object
            }
          });
        }
      }

      // 5) Update bucket TVL by the delta only (positive on first credit, additive on resume).
      const tvlDelta = depositSol - oldAmount;
      let bucketUpdate = bucket;
      if (tvlDelta !== 0) {
        bucketUpdate = await tx.bucket.update({
          where: { id: bucket.id },
          data: { tvl: Number(bucket.tvl) + tvlDelta }
        });
      }

      return {
        deposit,
        bucket: bucketUpdate,
        attemptStatus: newStatus,
        totalSuccessLamports,
        depositSol,
        feeTransferSkipped,
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
              ? "Jupiter basket invest fully recorded"
              : "Jupiter basket invest partially recorded — resume any time to fill the rest",
          attemptId: attempt.id,
          attemptStatus: result.attemptStatus,
          deposit: result.deposit,
          bucket: result.bucket,
          successLegIds: result.successLegIds,
          failedLegIds: result.failedLegIds,
          pendingLegIds: result.pendingLegIds,
          reportedSuccessLegIds: Array.from(reportedSuccessLegIds),
          feeTransferSignature: feeSig ?? attempt.feeTransferSignature ?? null,
          feeTransferSkipped: result.feeTransferSkipped,
          breakdown: {
            intendedSol: Number(attempt.intendedSol),
            actuallyInvestedSol: result.depositSol,
            platformFeeBps: platBps,
            creatorFeeBps: creatorBps,
            platformFeeSol: expectedPlat / 1e9,
            creatorFeeSol: expectedCreator / 1e9,
            note:
              result.attemptStatus !== "COMPLETE"
                ? "Fees were charged on the originally-intended SOL amount; only the successfully swapped legs counted toward your basket position. Resume the attempt to fill the rest at no extra fee."
                : "All legs settled."
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

/** Build fresh Jupiter orders for multiple legs in one request AND create a `BasketAttempt`
 * with one `BasketAttemptLeg` per swap (status PENDING). Returns `attemptId` + per-leg `legId`s
 * so the frontend can persist partial-fill outcomes to the right leg.
 */
const buildJupiterLegOrdersBatch = async ({
  params,
  userId,
  body
}: decoratedContext<Context<{ params: { id: string }; body: jupiterLegOrderBatchSchema }>>) => {
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
      include: { listing: { include: { asset: true } } }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.type !== "PUBLISHED") {
      return status(400, response(false, null, errors.bucketNotPublished400));
    }

    const slippageBps = body.slippageBps ?? 80;
    const intendedSol = Number(body.intendedSol);
    if (!Number.isFinite(intendedSol) || intendedSol <= 0) {
      return status(400, response(false, null, errors.typeBox400));
    }

    const minSwap = minSwapLamportsForBucket(bucket.listing);
    const intendedLamports = Math.floor(intendedSol * 1e9);
    if (intendedLamports < minSwap) {
      return status(400, response(false, null, errors.amountBelowMin400));
    }

    type LegOut = {
      legId: string;
      outputMint: string;
      symbol: string | null;
      inputLamports: number;
      slippageBps: number;
      swapTransactionBase64: string;
      requestId: string;
      expectedOutAmount: string;
      minimumOutAmount: string;
    };

    // Validate inputs first so we don't half-create an attempt.
    type Validated = { outMint: string; lamports: number; symbol: string | null };
    const validated: Validated[] = [];
    for (const leg of body.legs) {
      const outMint = leg.outputMint.trim();
      const lamports = Math.floor(Number(leg.lamports));
      if (!outMint || !Number.isFinite(lamports) || lamports <= 0) {
        return status(400, response(false, null, errors.typeBox400));
      }
      if (outMint === WSOL_MINT) {
        return status(400, response(false, null, errors.jupiterPlan400));
      }
      const listingRow = bucket.listing.find((l) => l.assetId === outMint);
      if (!listingRow) {
        return status(400, response(false, null, errors.jupiterPlan400));
      }
      validated.push({
        outMint,
        lamports,
        symbol: listingRow.asset?.symbol ?? null
      });
    }

    const attempt = await prisma.basketAttempt.create({
      data: {
        bucketId: bucket.id,
        userId,
        direction: "BUY",
        intendedSol,
        slippageBps,
        status: "PENDING",
        legs: {
          create: validated.map((v, i) => ({
            mint: v.outMint,
            symbol: v.symbol,
            lamports: v.lamports,
            legIndex: i,
            status: "PENDING"
          }))
        }
      },
      include: { legs: { orderBy: { legIndex: "asc" } } }
    });

    const out: LegOut[] = [];
    for (let i = 0; i < attempt.legs.length; i++) {
      const legRow = attempt.legs[i]!;
      try {
        const order = await jupiterOrder({
          inputMint: WSOL_MINT,
          outputMint: legRow.mint,
          amountLamports: Number(legRow.lamports),
          slippageBps,
          taker: user.walletAddress
        });
        out.push({
          legId: legRow.id,
          outputMint: legRow.mint,
          symbol: legRow.symbol,
          inputLamports: Number(legRow.lamports),
          slippageBps,
          swapTransactionBase64: order.transaction,
          requestId: order.requestId,
          expectedOutAmount: order.outAmount,
          minimumOutAmount: order.otherAmountThreshold || "0"
        });
      } catch (e) {
        console.error("[buildJupiterLegOrdersBatch leg]", legRow.mint, e);
        // Mark the attempt as ABANDONED so it doesn't clutter the user's pending list,
        // and surface the error to the frontend.
        await prisma.basketAttempt.update({
          where: { id: attempt.id },
          data: { status: "ABANDONED", abandonedAt: new Date() }
        });
        return status(400, response(false, null, errors.jupiterPlan400));
      }

      if (i < attempt.legs.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }

    return status(
      200,
      response(true, toJsonSafe({ attemptId: attempt.id, legs: out, slippageBps }), null)
    );
  } catch (e) {
    console.error("[buildJupiterLegOrdersBatch]", e);
    return status(400, response(false, null, errors.jupiterPlan400));
  }
};

/** Resume a PARTIAL/PENDING buy attempt: re-fetch fresh Jupiter orders for legs still in
 * PENDING or FAILED status. Already-SUCCESS legs are not re-quoted.
 */
const resumeJupiterAttempt = async ({
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
    if (!attempt || attempt.userId !== userId) {
      return status(404, response(false, null, errors.attemptNotFound404));
    }
    if (attempt.bucketId !== params.id) {
      return status(404, response(false, null, errors.attemptNotFound404));
    }
    if (attempt.direction !== "BUY") {
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

    type LegOut = {
      legId: string;
      outputMint: string;
      symbol: string | null;
      inputLamports: number;
      slippageBps: number;
      swapTransactionBase64: string;
      requestId: string;
      expectedOutAmount: string;
      minimumOutAmount: string;
    };
    const out: LegOut[] = [];
    for (let i = 0; i < toResume.length; i++) {
      const legRow = toResume[i]!;
      try {
        const order = await jupiterOrder({
          inputMint: WSOL_MINT,
          outputMint: legRow.mint,
          amountLamports: Number(legRow.lamports),
          slippageBps,
          taker: user.walletAddress
        });
        out.push({
          legId: legRow.id,
          outputMint: legRow.mint,
          symbol: legRow.symbol,
          inputLamports: Number(legRow.lamports),
          slippageBps,
          swapTransactionBase64: order.transaction,
          requestId: order.requestId,
          expectedOutAmount: order.outAmount,
          minimumOutAmount: order.otherAmountThreshold || "0"
        });
      } catch (e) {
        console.error("[resumeJupiterAttempt leg]", legRow.mint, e);
        return status(400, response(false, null, errors.jupiterPlan400));
      }
      if (i < toResume.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }

    return status(
      200,
      response(
        true,
        toJsonSafe({
          attemptId: attempt.id,
          slippageBps,
          legs: out,
          // Resume never re-charges fees; original feeTransferSignature persists if any.
          feeTransferAlreadyPaid: !!attempt.feeTransferSignature
        }),
        null
      )
    );
  } catch (e) {
    console.error("[resumeJupiterAttempt]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const jupiterInvestControllers = {
  buildJupiterPlan,
  buildJupiterLegOrder,
  buildJupiterLegOrdersBatch,
  resumeJupiterAttempt,
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
