import { status, type Context } from "elysia";
import { prisma } from "../db";
import { createBucketSchema, errors, response, type decoratedContext } from "../types";

const getAllBuckets = async ({}: decoratedContext<Context>) => {
  try {
    const buckets = await prisma.bucket.findMany({
      include: {
        listing: { include: { asset: true } },
        creator: { select: { username: true } }
      }
    });
    return status(200, response(true, buckets, null));
  } catch (e) {
    return status(500, response(false, null, errors.serverError500));
  }
}

const createBucket = async ({ body, userId }: decoratedContext<Context<{ body: createBucketSchema }>>) => {
  if (!userId) return status(401, response(false, null, errors.unauthorized401));
  const bucketExist = await prisma.bucket.findFirst({ where: { name: body.name } });
  if (bucketExist) return status(409, response(false, null, errors.bucketConflict409));
  const createdBucket = await prisma.bucket.create({
    data: {
      name: body.name,
      creatorId: userId,
      tvl: 0,
      estimated_apy: body.estimatedApy,
      apy: null,
    }
  });
  return status(201, response(true, createdBucket, null));
}

const getBucketById = async ({ params }: Context) => {
  
}

export const bucketControllers = {
  getAllBuckets,
  createBucket,
  getBucketById
}