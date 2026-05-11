import { status, type Context } from "elysia";
import {
  CATALOG_CATEGORY_ORDER,
  type CatalogAsset,
  type CatalogCategory,
  getCatalogTokens
} from "../constants/tokenCatalog";
import { prisma } from "../db";
import { toJsonSafe } from "../jsonSafe";
import { bootstrapCatalogFromJupiter, ensureCatalogReady } from "../services/catalogSync";
import { errors, response, type decoratedContext, type upsertAssetSchema } from "../types";

function categoryOrderIndex(category: string): number {
  const i = CATALOG_CATEGORY_ORDER.indexOf(category as CatalogCategory);
  return i === -1 ? CATALOG_CATEGORY_ORDER.length : i;
}

function sortCatalog(rows: CatalogAsset[]): CatalogAsset[] {
  return rows.slice().sort((a, b) => {
    const ca = categoryOrderIndex(a.category);
    const cb = categoryOrderIndex(b.category);
    if (ca !== cb) return ca - cb;
    return (a.symbol ?? "").localeCompare(b.symbol ?? "");
  });
}

/**
 * Public catalog endpoint — backed by Jupiter Tokens v2 (verified set), stored in
 * memory + DB. On first request after boot we trigger a Jupiter pull; subsequent
 * requests serve straight from the in-memory map.
 */
const listCatalog = async () => {
  try {
    await ensureCatalogReady();
    const rows = getCatalogTokens();
    if (rows.length > 0) {
      return status(200, response(true, sortCatalog(rows), null));
    }
    // Jupiter was unreachable on first boot AND nothing in memory — fall back to DB rows.
    const dbRows = await prisma.asset.findMany({ where: { inCatalog: true } });
    const projected: CatalogAsset[] = dbRows.map((r) => ({
      id: r.id,
      name: r.name,
      symbol: r.symbol,
      iconUrl: r.iconUrl,
      decimals: r.decimals,
      category: (r.category as CatalogCategory) ?? "token"
    }));
    return status(200, response(true, sortCatalog(projected), null));
  } catch (e) {
    console.warn("[listCatalog]", e);
    return status(500, response(false, null, errors.serverError500));
  }
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

/** Admin-triggered re-sync from Jupiter Tokens v2. Authenticated users only for now. */
const resyncCatalog = async ({ userId }: decoratedContext<Context>) => {
  try {
    if (!userId) return status(401, response(false, null, errors.unauthorized401));
    const result = await bootstrapCatalogFromJupiter();
    return status(200, response(true, toJsonSafe(result), null));
  } catch (e) {
    console.error("[resyncCatalog]", e);
    return status(500, response(false, null, errors.serverError500));
  }
};

export const assetControllers = {
  listCatalog,
  listAssets,
  upsertAsset,
  resyncCatalog
};
