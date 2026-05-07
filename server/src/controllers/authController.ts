import { status, type Context } from "elysia";
import { prisma } from "../db";
import { toJsonSafe } from "../jsonSafe";
import { errors, nonceCreateSchema, response, walletAuthSchema, type decoratedContext } from "../types";
import { sign } from "jsonwebtoken";
import { address, getBase58Codec, getPublicKeyFromAddress, getUtf8Codec, isSignatureBytes, verifySignature } from "@solana/kit";

const walletLogin = async ({ body, set }: decoratedContext<Context<{ body: walletAuthSchema }>>) => {
  try {
    const nonceRecorded = await prisma.nonce.findFirst({
      where: {
        walletAddress: body.address,
        value: body.details.nonce,
        used: false,
        expiresAt: { gte: new Date() }
      }
    });
    if (!nonceRecorded) return status(402, response(false, null, errors.nonce402));

    if (!body.details.message.includes(body.details.nonce)) {
      return status(400, response(false, null, errors.walletLoginMessageNonce400));
    }

    const pubkey = await getPublicKeyFromAddress(address(body.address));
    const signatureBytes = getBase58Codec().encode(body.signature);
    const messageBytes = getUtf8Codec().encode(body.details.message);
    if (!isSignatureBytes(signatureBytes)) return status(400, response(false, null, errors.typeBox400));

    const signatureAuthorized = await verifySignature(pubkey, signatureBytes, messageBytes);
    if (!signatureAuthorized) return status(402, response(false, null, errors.nonce402));
    await prisma.nonce.update({
      where: { id: nonceRecorded.id },
      data: { used: true }
    });

    let loginUser = await prisma.user.findFirst({
      where: { walletAddress: body.address }
    });
    if (!loginUser) {
      const username = body.username?.trim();
      if (!username) {
        return status(400, response(false, null, errors.walletLoginUsernameRequired400));
      }
      set.status = 201;
      loginUser = await prisma.user.create({
        data: { walletAddress: body.address, username }
      });
    }

    const secret = process.env.JWT_SECRET!;
    const token = sign({ userId: loginUser.id }, secret);
    return response(true, { token }, null);
  } catch (e) {
    console.error("[walletLogin]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

const getNonce = async ({ query: rawQuery }: decoratedContext<Context<{ query: nonceCreateSchema }>>) => {
  try {
    const query = rawQuery ?? {};
    const address = typeof query.address === "string" ? query.address.trim() : "";
    if (!address) {
      return status(400, response(false, null, errors.typeBox400));
    }
    const nonce = await prisma.nonce.create({
      data: {
        walletAddress: address,
        value: crypto.randomUUID(),
        used: false,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      }
    });
    const nonceResponse = {
      nonce: nonce.value,
      message: `Login to Demutual: ${nonce.value}`,
      expiresAt: nonce.expiresAt
    };
    return status(200, response(true, toJsonSafe(nonceResponse), null));
  } catch (e) {
    console.error("[getNonce]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const authControllers = {
  walletLogin,
  getNonce
}
