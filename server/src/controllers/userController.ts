import { Connection, PublicKey } from "@solana/web3.js";
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

import { type paginationQuerySchema } from "../types";

const getMyDeposits = async ({
  userId,
  query
}: { userId?: string; query?: paginationQuerySchema }) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;

    const [total, deposits] = await Promise.all([
      prisma.deposit.count({ where: { userId } }),
      prisma.deposit.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
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
      })
    ]);

    return status(200, response(true, toJsonSafe({ data: deposits, total, limit, offset }), null));
  } catch (e) {
    console.error("[getMyDeposits]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

/**
 * Creator-side fee-receiver verification. Calls Solana RPC to confirm the user's wallet
 * exists on-chain; if it does, flip `feeReceiverVerified = true` and record the timestamp.
 * Until verified, investor-paid creator-fee transfers skip this user (platform fee still pays).
 */
const verifyFeeReceiver = async ({ userId }: decoratedContext<Context>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));
    const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
    if (!rpcUrl) {
      return status(503, response(false, null, errors.investNotConfigured503));
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true, feeReceiverVerified: true, feeReceiverVerifiedAt: true }
    });
    if (!user) return status(401, response(false, null, errors.unauthorized401));

    let foundOnChain = false;
    try {
      const conn = new Connection(rpcUrl, "confirmed");
      const info = await conn.getAccountInfo(new PublicKey(user.walletAddress), "confirmed");
      foundOnChain = Boolean(info);
    } catch (e) {
      console.warn("[verifyFeeReceiver rpc]", e);
      foundOnChain = false;
    }

    if (!foundOnChain) {
      return status(
        200,
        response(
          true,
          toJsonSafe({
            walletAddress: user.walletAddress,
            foundOnChain: false,
            verified: user.feeReceiverVerified,
            verifiedAt: user.feeReceiverVerifiedAt,
            message:
              "Your wallet hasn't been used on Solana yet. Send any small amount of SOL to this wallet (from an exchange or another wallet) and click Check again."
          }),
          null
        )
      );
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { feeReceiverVerified: true, feeReceiverVerifiedAt: new Date() },
      select: { walletAddress: true, feeReceiverVerified: true, feeReceiverVerifiedAt: true }
    });
    return status(
      200,
      response(
        true,
        toJsonSafe({
          walletAddress: updated.walletAddress,
          foundOnChain: true,
          verified: updated.feeReceiverVerified,
          verifiedAt: updated.feeReceiverVerifiedAt
        }),
        null
      )
    );
  } catch (e) {
    console.error("[verifyFeeReceiver]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const userControllers = {
  getMe,
  getMyDeposits,
  verifyFeeReceiver
};
