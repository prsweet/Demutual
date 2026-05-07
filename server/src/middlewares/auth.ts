import Elysia, { status, type Context } from "elysia";
import { verify, type JwtPayload } from "jsonwebtoken";
import { errors, response } from "../types";
import { prisma } from "../db";

export type decoratedContext<T extends Context = Context> = T & {
  userId?: string
}

const requireAuth = async (ctx: decoratedContext) => {
  try {
    const token = ctx.headers.authorization?.split(' ')[1] as string;
    const decoded = verify(token, process.env.JWT_SECRET!) as JwtPayload;
    ctx.userId = decoded.userId;
  } catch (e) {
    return status(401, response(false, null, errors.unauthorized401));
  }
}

const requireBucketCreator = async ({ userId }: decoratedContext) => {
  const creator = await prisma.bucket.findFirst({ where: { creatorId: userId } });
  if (!creator) return status(403, response(false, null, errors.bucketCreator403));
}

export const authMiddlewares = {
  requireAuth,
  requireBucketCreator
}