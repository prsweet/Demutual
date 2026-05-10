import { status, type Context } from "elysia";
import { prisma } from "../db";
import { toJsonSafe } from "../jsonSafe";
import {
  errors,
  type myAttemptsQuerySchema,
  response,
  type decoratedContext
} from "../types";

/** GET /users/me/attempts — list the caller's basket attempts (newest first).
 * Default returns *resumable* ones (PENDING + PARTIAL) so the FE can render a banner.
 */
const listMyAttempts = async ({
  userId,
  query
}: { userId?: string; query?: myAttemptsQuerySchema }) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;
    const statusFilter = query?.status
      ? [query.status]
      : (["PENDING", "PARTIAL"] as const);

    const where = {
      userId,
      ...(query?.bucketId ? { bucketId: query.bucketId } : {}),
      status: { in: statusFilter as ("PENDING" | "PARTIAL" | "COMPLETE" | "ABANDONED")[] }
    } as const;

    const [total, attempts] = await Promise.all([
      prisma.basketAttempt.count({ where }),
      prisma.basketAttempt.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          legs: { orderBy: { legIndex: "asc" } },
          bucket: { select: { id: true, name: true, type: true, version: true } }
        }
      })
    ]);

    return status(
      200,
      response(true, toJsonSafe({ data: attempts, total, limit, offset }), null)
    );
  } catch (e) {
    console.error("[listMyAttempts]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

/** POST /attempts/:attemptId/abandon — user has decided to give up on the missing legs.
 * The successful legs already credit/debit normally; further resume is blocked.
 */
const abandonAttempt = async ({
  params,
  userId
}: decoratedContext<Context<{ params: { attemptId: string } }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const existing = await prisma.basketAttempt.findUnique({
      where: { id: params.attemptId }
    });
    if (!existing || existing.userId !== userId) {
      return status(404, response(false, null, errors.attemptNotFound404));
    }
    if (existing.status === "COMPLETE" || existing.status === "ABANDONED") {
      return status(400, response(false, null, errors.attemptNotResumable400));
    }

    const updated = await prisma.basketAttempt.update({
      where: { id: existing.id },
      data: { status: "ABANDONED", abandonedAt: new Date() },
      include: { legs: { orderBy: { legIndex: "asc" } } }
    });

    return status(200, response(true, toJsonSafe({ attempt: updated }), null));
  } catch (e) {
    console.error("[abandonAttempt]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const basketAttemptControllers = {
  listMyAttempts,
  abandonAttempt
};
