import { status, type Context } from "elysia";
import { TOKEN_CATALOG } from "../constants/tokenCatalog";
import { prisma } from "../db";
import { toJsonSafe } from "../jsonSafe";
import { errors, response, type decoratedContext, type upsertAssetSchema } from "../types";

/** Public: tokens users can add to buckets without pasting mint addresses. */
const listCatalog = async () => {
  return status(200, response(true, TOKEN_CATALOG, null));
};

const listAssets = async ({ userId }: decoratedContext<Context>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));
    const assets = await prisma.asset.findMany({
      orderBy: { symbol: "asc" }
    });
    return status(200, response(true, toJsonSafe(assets), null));
  } catch (e) {
    console.error("[listAssets]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

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

    return status(200, response(true, toJsonSafe(asset), null));
  } catch (e) {
    console.error("[upsertAsset]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const assetControllers = {
  listCatalog,
  listAssets,
  upsertAsset
};
