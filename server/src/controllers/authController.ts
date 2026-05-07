import { status, type Context } from "elysia";
import { errors, nonceCreateSchema, response, walletAuthSchema, type decoratedContext } from "../types";
import { prisma } from "../db";
import { sign } from "jsonwebtoken";
import { address, getBase58Codec, getPublicKeyFromAddress, getUtf8Codec, isSignatureBytes, verifySignature } from "@solana/kit";

const walletLogin = async ({ body, set }: decoratedContext<Context<{ body: walletAuthSchema }>>) => {
  const nonceRecorded = await prisma.nonce.findFirst({
    where: {
      walletAddress: body.address,
      value: body.details.nonce,
      used: false,
      expiresAt: { gte: new Date() },
    }
  });
  if (!nonceRecorded) return status(402, response(false, null, errors.nonce402));
  
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
  
  let logingUser = await prisma.user.findFirst({
    where: { walletAddress: body.address }
  });
  if (!logingUser) {
    const username = body.username?.trim();
    if (!username) {
      return status(400, response(false, null, errors.typeBox400));
    }
    set.status = 201;
    logingUser = await prisma.user.create({
      data: { walletAddress: body.address, username }
    });
  }

  const token = sign({ userId: logingUser.id }, process.env.JWT_SECRET!);
  return response(true, { token }, null);
};

const getNonce = async ({ query }: decoratedContext<Context<{ query: nonceCreateSchema }>>) => {
  const nonce = await prisma.nonce.create({
    data: {
      walletAddress: query.address,
      value: crypto.randomUUID(),
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    }
  });
  const nonceResponse = {
    nonce: nonce.value,
    message: `Login to Demutual: ${nonce.value}`,
    expiresAt: nonce.expiresAt
  }
  return status(200, response(true, nonceResponse, null));
}

export const authControllers = {
  walletLogin,
  getNonce
}
