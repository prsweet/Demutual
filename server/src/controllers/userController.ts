import { status, type Context } from "elysia";
import { prisma } from "../db";
import { toJsonSafe } from "../jsonSafe";
import { errors, response, type decoratedContext } from "../types";

const getMe = async ({ userId }: decoratedContext<Context>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: { buckets: true, deposits: true, withdrawals: true }
        }
      }
    });
    if (!user) return status(401, response(false, null, errors.unauthorized401));

    const { _count, ...rest } = user;
    return status(
      200,
      response(
        true,
        toJsonSafe({
          ...rest,
          counts: _count
        }),
        null
      )
    );
  } catch (e) {
    console.error("[getMe]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const getMyDeposits = async ({ userId }: decoratedContext<Context>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const deposits = await prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        bucket: {
          select: {
            id: true,
            name: true,
            type: true,
            tvl: true,
            version: true
          }
        }
      }
    });

    return status(200, response(true, toJsonSafe(deposits), null));
  } catch (e) {
    console.error("[getMyDeposits]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const userControllers = {
  getMe,
  getMyDeposits
};
