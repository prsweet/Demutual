import { status, type Context } from "elysia";
import { isDevnet } from "../config";
import { TOKEN_CATALOG_BY_ID } from "../constants/tokenCatalog";
import { INVEST_PROTOCOL_FEE_RATE } from "../constants/fees";
import { prisma } from "../db";
import { grossLamportsFromSol, verifyInvestTransfer } from "../investTxVerify";
import { toJsonSafe } from "../jsonSafe";
import {
  addBucketAssetsSchema,
  createBucketSchema,
  errors,
  investInBucketSchema,
  listBucketsQuerySchema,
  response,
  type decoratedContext,
  type publishBucketSchema,
  type withdrawBucketSchema
} from "../types";

const getAllBuckets = async ({
  query: rawQuery
}: { query?: listBucketsQuerySchema }) => {
  try {
    const query = rawQuery ?? {};
    const where: {
      name?: string;
      creatorId?: string;
      type?: "PUBLISHED" | "DRAFT";
    } = {};
    if (query.name) where.name = query.name;
    if (query.creatorId) {
      where.creatorId = query.creatorId;
      if (query.status) where.type = query.status;
    } else {
      where.type = "PUBLISHED";
    }

    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const [total, buckets] = await Promise.all([
      prisma.bucket.count({ where }),
      prisma.bucket.findMany({
        where,
        orderBy: [{ name: "asc" }, { version: "asc" }],
        take: limit,
        skip: offset,
        include: {
          listing: { include: { asset: true } },
          creator: { select: { id: true, username: true, walletAddress: true } },
          _count: { select: { deposits: true, listing: true } }
        }
      })
    ]);
    return status(200, response(true, toJsonSafe({ data: buckets, total, limit, offset }), null));
  } catch (e) {
    console.error("[getAllBuckets]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const createBucket = async ({
  body,
  userId
}: decoratedContext<Context<{ body: createBucketSchema }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const existing = await prisma.bucket.findFirst({
      where: { creatorId: userId, name: body.name }
    });
    if (existing) {
      return status(409, response(false, null, errors.bucketConflict409));
    }

    const createdBucket = await prisma.bucket.create({
      data: {
        name: body.name,
        creatorId: userId,
        version: 1,
        tvl: 0,
        estimated_apy: body.estimatedApy,
        apy: null,
        type: "DRAFT",
        metaData: body.metaData
      },
      include: {
        listing: { include: { asset: true } },
        creator: { select: { id: true, username: true, walletAddress: true } }
      }
    });
    return status(201, response(true, toJsonSafe(createdBucket), null));
  } catch (e) {
    console.error("[createBucket]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const getBucketById = async ({
  params
}: decoratedContext<Context<{ params: { id: string } }>>) => {
  try {
    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id },
      include: {
        listing: { include: { asset: true } },
        creator: { select: { id: true, username: true, walletAddress: true } },
        _count: { select: { deposits: true, listing: true } }
      }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    return status(200, response(true, toJsonSafe(bucket), null));
  } catch (e) {
    console.error("[getBucketById]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const investInBucket = async ({
  params,
  userId,
  body
}: decoratedContext<
  Context<{ params: { id: string }; body: investInBucketSchema }>
>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));
    if (!isDevnet()) {
      return status(400, response(false, null, errors.treasuryInvestDevnetOnly400));
    }

    const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
    const treasuryPk = process.env.INVEST_TREASURY_PUBKEY?.trim();
    if (!rpcUrl || !treasuryPk) {
      return status(503, response(false, null, errors.investNotConfigured503));
    }

    const gross = Number(body.amount);
    if (!Number.isFinite(gross) || gross <= 0) {
      return status(400, response(false, null, errors.typeBox400));
    }

    let expectedLamports: bigint;
    try {
      expectedLamports = grossLamportsFromSol(gross);
    } catch {
      return status(400, response(false, null, errors.typeBox400));
    }

    const sig = body.transactionSignature.trim();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true }
    });
    if (!user) return status(401, response(false, null, errors.unauthorized401));

    const dup = await prisma.deposit.findUnique({
      where: { transactionSignature: sig },
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

    try {
      await verifyInvestTransfer({
        rpcUrl,
        signature: sig,
        expectedFrom: user.walletAddress,
        expectedTo: treasuryPk,
        expectedLamports
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.error("[investInBucket verify]", m);
      if (m === "INVEST_TX_NOT_FOUND") {
        return status(400, response(false, null, errors.investTxNotFound400));
      }
      return status(400, response(false, null, errors.investTxVerify400));
    }

    const feeTotal = gross * INVEST_PROTOCOL_FEE_RATE;
    const feeCreator = feeTotal / 2;
    const feePlatform = feeTotal - feeCreator;
    const net = gross - feeTotal;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const deposit = await tx.deposit.create({
          data: {
            bucketId: bucket.id,
            userId,
            amount: net,
            feeCreator,
            feePlatform,
            transactionSignature: sig
          }
        });
        const bucketUpdate = await tx.bucket.update({
          where: { id: bucket.id },
          data: { tvl: Number(bucket.tvl) + net }
        });
        return { deposit, bucketUpdate, gross, feeTotal, feeCreator, feePlatform, net };
      });

      const resultMessage = {
        message: "Investment successful",
        transactionSignature: sig,
        deposit: result.deposit,
        bucket: result.bucketUpdate,
        breakdown: {
          grossAmount: result.gross,
          protocolFeeRate: INVEST_PROTOCOL_FEE_RATE,
          feeTotal: result.feeTotal,
          feeCreator: result.feeCreator,
          feePlatform: result.feePlatform,
          netToPool: result.net
        }
      };
      return status(201, response(true, toJsonSafe(resultMessage), null));
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return status(409, response(false, null, errors.investTxDuplicate409));
      }
      throw e;
    }
  } catch (e) {
    console.error("[investInBucket]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const addBucketAssets = async ({
  params,
  userId,
  body
}: decoratedContext<
  Context<{ params: { id: string }; body: addBucketAssetsSchema }>
>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.creatorId !== userId) {
      return status(403, response(false, null, errors.bucketCreator403));
    }
    if (bucket.type !== "DRAFT") {
      return status(400, response(false, null, errors.bucketNotDraft400));
    }

    const total = body.assets.reduce((s, a) => s + a.percentage, 0);
    if (Math.abs(total - 100) > 0.0001) {
      return status(400, response(false, null, errors.listingPercentages400));
    }

    const assetIds = [...new Set(body.assets.map((a) => a.assetId))];
    if (assetIds.length !== body.assets.length) {
      return status(400, response(false, null, errors.typeBox400));
    }

    for (const id of assetIds) {
      const exists = await prisma.asset.findUnique({ where: { id }, select: { id: true } });
      if (exists) continue;
      if (!TOKEN_CATALOG_BY_ID.has(id)) {
        return status(400, response(false, null, errors.unknownAsset400));
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const id of assetIds) {
        const existing = await tx.asset.findUnique({ where: { id } });
        if (existing) continue;
        const meta = TOKEN_CATALOG_BY_ID.get(id)!;
        await tx.asset.create({
          data: {
            id: meta.id,
            name: meta.name,
            symbol: meta.symbol,
            iconUrl: meta.iconUrl,
            decimals: meta.decimals
          }
        });
      }

      await tx.listing.deleteMany({ where: { bucketId: params.id } });
      await tx.listing.createMany({
        data: body.assets.map((a) => ({
          bucketId: params.id,
          assetId: a.assetId,
          percentage: a.percentage
        }))
      });
    });

    const updated = await prisma.bucket.findUnique({
      where: { id: params.id },
      include: {
        listing: { include: { asset: true } },
        creator: { select: { id: true, username: true, walletAddress: true } }
      }
    });

    if (!updated) {
      return status(500, response(false, null, errors.serverError500));
    }

    return status(200, response(true, toJsonSafe(updated), null));
  } catch (e) {
    console.error("[addBucketAssets]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const publishBucket = async ({
  params,
  userId,
  body
}: decoratedContext<Context<{ params: { id: string }; body: publishBucketSchema }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id },
      include: { _count: { select: { listing: true } } }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.creatorId !== userId) {
      return status(403, response(false, null, errors.bucketCreator403));
    }
    if (bucket.type !== "DRAFT") {
      return status(400, response(false, null, errors.bucketAlreadyPublished400));
    }
    if (bucket._count.listing === 0) {
      return status(400, response(false, null, errors.bucketNoAssets400));
    }

    const doc = body.researchDoc.trim();
    if (doc.length < 100) {
      return status(400, response(false, null, errors.researchDocTooShort400));
    }

    const published = await prisma.bucket.update({
      where: { id: params.id },
      data: { type: "PUBLISHED", researchDoc: doc },
      include: {
        listing: { include: { asset: true } },
        creator: { select: { id: true, username: true, walletAddress: true } },
        _count: { select: { deposits: true, listing: true } }
      }
    });

    return status(200, response(true, toJsonSafe(published), null));
  } catch (e) {
    console.error("[publishBucket]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const getMyBucketPosition = async ({
  params,
  userId
}: decoratedContext<Context<{ params: { id: string } }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id },
      select: { id: true, type: true, name: true }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));

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

    const deposited = Number(depAgg._sum.amount ?? 0);
    const withdrawn = Number(witAgg._sum.amount ?? 0);
    const available = Math.max(0, deposited - withdrawn);

    return status(
      200,
      response(
        true,
        toJsonSafe({
          bucketId: bucket.id,
          bucketName: bucket.name,
          bucketType: bucket.type,
          totalDeposited: deposited,
          totalWithdrawn: withdrawn,
          availableToWithdraw: available
        }),
        null
      )
    );
  } catch (e) {
    console.error("[getMyBucketPosition]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const withdrawFromBucket = async ({
  params,
  userId,
  body
}: decoratedContext<Context<{ params: { id: string }; body: withdrawBucketSchema }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const amt = Number(body.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return status(400, response(false, null, errors.typeBox400));
    }

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id },
      select: { id: true, tvl: true, type: true }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.type !== "PUBLISHED") {
      return status(400, response(false, null, errors.withdrawBucketNotPublished400));
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

    const deposited = Number(depAgg._sum.amount ?? 0);
    const withdrawn = Number(witAgg._sum.amount ?? 0);
    const available = Math.max(0, deposited - withdrawn);

    if (amt > available) {
      return status(400, response(false, null, errors.withdrawInsufficient400));
    }

    const result = await prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.create({
        data: {
          bucketId: bucket.id,
          userId,
          amount: amt
        }
      });
      const currentTvl = Number(bucket.tvl);
      const newTvl = Math.max(0, currentTvl - amt);
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
          message:
            "Withdrawal recorded in Demutual ledger (off-chain accounting). Wire real token/SOL payouts via your custody or program.",
          ...result
        }),
        null
      )
    );
  } catch (e) {
    console.error("[withdrawFromBucket]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const forkBucketVersion = async ({
  params,
  userId
}: decoratedContext<Context<{ params: { id: string } }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const source = await prisma.bucket.findUnique({
      where: { id: params.id },
      include: { listing: true }
    });
    if (!source) return status(404, response(false, null, errors.bucketNotFound404));
    if (source.creatorId !== userId) {
      return status(403, response(false, null, errors.bucketCreator403));
    }

    const agg = await prisma.bucket.aggregate({
      where: { creatorId: source.creatorId, name: source.name },
      _max: { version: true }
    });
    const nextVersion = (agg._max.version ?? 0) + 1;

    const newBucket = await prisma.$transaction(async (tx) => {
      const b = await tx.bucket.create({
        data: {
          name: source.name,
          creatorId: source.creatorId,
          version: nextVersion,
          tvl: 0,
          apy: null,
          estimated_apy: source.estimated_apy,
          type: "DRAFT",
          metaData: source.metaData === null ? undefined : source.metaData
        }
      });
      if (source.listing.length > 0) {
        await tx.listing.createMany({
          data: source.listing.map((l) => ({
            bucketId: b.id,
            assetId: l.assetId,
            percentage: l.percentage
          }))
        });
      }
      return tx.bucket.findUniqueOrThrow({
        where: { id: b.id },
        include: {
          listing: { include: { asset: true } },
          creator: { select: { id: true, username: true, walletAddress: true } }
        }
      });
    });

    return status(201, response(true, toJsonSafe(newBucket), null));
  } catch (e) {
    console.error("[forkBucketVersion]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const bucketControllers = {
  getAllBuckets,
  createBucket,
  getBucketById,
  getMyBucketPosition,
  investInBucket,
  withdrawFromBucket,
  addBucketAssets,
  publishBucket,
  forkBucketVersion
};
