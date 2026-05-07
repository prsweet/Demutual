import { status, type Context } from "elysia";
import { prisma } from "../db";
import {
  addBucketAssetsSchema,
  createBucketSchema,
  errors,
  investInBucketSchema,
  listBucketsQuerySchema,
  response,
  type decoratedContext
} from "../types";

const getAllBuckets = async ({
  query
}: decoratedContext<Context<{ query: listBucketsQuerySchema }>>) => {
  try {
    const where: { name?: string; creatorId?: string } = {};
    if (query.name) where.name = query.name;
    if (query.creatorId) where.creatorId = query.creatorId;

    const buckets = await prisma.bucket.findMany({
      where,
      orderBy: [{ name: "asc" }, { version: "asc" }],
      include: {
        listing: { include: { asset: true } },
        creator: { select: { id: true, username: true, walletAddress: true } }
      }
    });
    return status(200, response(true, buckets, null));
  } catch {
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
    return status(201, response(true, createdBucket, null));
  } catch {
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
        creator: { select: { id: true, username: true, walletAddress: true } }
      }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    return status(200, response(true, bucket, null));
  } catch {
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

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return status(400, response(false, null, errors.typeBox400));
    }

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id },
      select: { id: true, tvl: true, type: true }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.type !== "PUBLISHED") {
      return status(400, response(false, null, errors.bucketNotPublished400));
    }

    const result = await prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.create({
        data: {
          bucketId: bucket.id,
          userId,
          amount
        }
      });
      const bucketUpdate = await tx.bucket.update({
        where: { id: bucket.id },
        data: { tvl: Number(bucket.tvl) + amount }
      });
      return { deposit, bucketUpdate };
    });

    return status(
      201,
      response(
        true,
        {
          message: "Investment successful",
          deposit: result.deposit,
          bucket: result.bucketUpdate
        },
        null
      )
    );
  } catch {
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

    const found = await prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true }
    });
    if (found.length !== assetIds.length) {
      return status(400, response(false, null, errors.typeBox400));
    }

    await prisma.$transaction(async (tx) => {
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

    return status(200, response(true, updated, null));
  } catch {
    return status(500, response(false, null, errors.serverError500));
  }
};

const publishBucket = async ({
  params,
  userId
}: decoratedContext<Context<{ params: { id: string } }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const bucket = await prisma.bucket.findUnique({
      where: { id: params.id }
    });
    if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
    if (bucket.type !== "DRAFT") {
      return status(400, response(false, null, errors.bucketAlreadyPublished400));
    }

    const published = await prisma.bucket.update({
      where: { id: params.id },
      data: { type: "PUBLISHED" },
      include: {
        listing: { include: { asset: true } },
        creator: { select: { id: true, username: true, walletAddress: true } }
      }
    });

    return status(200, response(true, published, null));
  } catch {
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

    return status(201, response(true, newBucket, null));
  } catch {
    return status(500, response(false, null, errors.serverError500));
  }
};

export const bucketControllers = {
  getAllBuckets,
  createBucket,
  getBucketById,
  investInBucket,
  addBucketAssets,
  publishBucket,
  forkBucketVersion
};
