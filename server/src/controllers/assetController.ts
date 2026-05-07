import { status, type Context } from "elysia";
import { prisma } from "../db";
import { errors, response, type decoratedContext, type upsertAssetSchema } from "../types";

const upsertAsset = async ({
  body,
  userId
}: decoratedContext<Context<{ body: upsertAssetSchema }>>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));

    const asset = await prisma.asset.upsert({
      where: { id: body.id },
      create: {
        id: body.id,
        name: body.name,
        symbol: body.symbol,
        iconUrl: body.iconUrl,
        decimals: body.decimals ?? 9
      },
      update: {
        name: body.name,
        symbol: body.symbol,
        iconUrl: body.iconUrl,
        decimals: body.decimals ?? 9
      }
    });

    return status(200, response(true, asset, null));
  } catch {
    return status(500, response(false, null, errors.serverError500));
  }
};

export const assetControllers = {
  upsertAsset
};
