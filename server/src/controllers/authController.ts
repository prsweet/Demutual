import { status, type Context } from "elysia";
import { errors, response, walletAuthSchema } from "../types";
import { prisma } from "../db";
import { sign } from "jsonwebtoken";
import { address, getBase58Codec, getPublicKeyFromAddress, getUtf8Codec, isSignatureBytes, verifySignature } from "@solana/kit";

const walletLogin = async ({ body, set }: Context<{ body: walletAuthSchema }>) => {
  const nonceRecorded = await prisma.nonce.findFirst({
    where: {
      wallet_address: body.address,
      value: body.details.nonce,
      used: false,
      expires_at: { gte: new Date() }
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
    where: { wallet_address: body.address }
  });
  if (!logingUser) {
    set.status = 201;
    logingUser = await prisma.user.create({
      data: { wallet_address: body.address }
    });
  }

  const token = sign({ userId: logingUser.id, }, process.env.JWT_SECRET!);
  return response(true, { token }, null);
}

export const authControllers = {
  walletLogin
}
