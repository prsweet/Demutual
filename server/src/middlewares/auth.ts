import { Elysia, status, type Context } from "elysia";
import { verify, type JwtPayload } from "jsonwebtoken";
import { errors, response } from "../types";
import { prisma } from "../db";

export const authPlugin = new Elysia({ name: "auth" }).derive(
  { as: "global" },
  ({ headers }) => {
    let userId: string | undefined = undefined;
    try {
      const token = headers.authorization?.split(" ")[1];
      if (token) {
        const decoded = verify(token, process.env.JWT_SECRET!) as JwtPayload;
        userId = decoded.userId as string;
      }
    } catch {
      // ignore
    }
    return { userId };
  }
);

const requireAuth = ({ userId }: any) => {
  if (!userId) {
    return status(401, response(false, null, errors.unauthorized401));
  }
};

const requireBucketCreator = async ({ params, userId }: any) => {
  if (!userId) return status(401, response(false, null, errors.unauthorized401));
  const bucket = await prisma.bucket.findUnique({ where: { id: params.id } });
  if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
  if (bucket.creatorId !== userId) {
    return status(403, response(false, null, errors.bucketCreator403));
  }
};

export const authMiddlewares = {
  requireAuth,
  requireBucketCreator
};