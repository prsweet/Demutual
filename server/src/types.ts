import { t, type Context, type Static } from "elysia";

export type decoratedContext<T extends Context> = T & {
  userId?: string
}

export const walletAuthSchema = t.Object({
  address: t.String(),
  details: t.Object({ nonce: t.String(), message: t.String() }),
  signature: t.String(),
  username: t.Optional(t.String())
});

export type walletAuthSchema = Static<typeof walletAuthSchema>;

export const nonceCreateSchema = t.Object({
  address: t.String()
});

export type nonceCreateSchema = Static<typeof nonceCreateSchema>;

export const createBucketSchema = t.Object({
  name: t.String(),
  estimatedApy: t.Number(),
  metaData: t.Optional(t.Any())
});

export type createBucketSchema = Static<typeof createBucketSchema>;

export const investInBucketSchema = t.Object({
  amount: t.Number({ exclusiveMinimum: 0 })
});

export type investInBucketSchema = Static<typeof investInBucketSchema>;

export const addBucketAssetsSchema = t.Object({
  assets: t.Array(
    t.Object({
      assetId: t.String(),
      percentage: t.Number({ minimum: 0, maximum: 100 })
    }),
    { minItems: 1 }
  )
});

export type addBucketAssetsSchema = Static<typeof addBucketAssetsSchema>;

export const listBucketsQuerySchema = t.Object({
  name: t.Optional(t.String()),
  creatorId: t.Optional(t.String())
});

export type listBucketsQuerySchema = Static<typeof listBucketsQuerySchema>;

export const upsertAssetSchema = t.Object({
  id: t.String(),
  name: t.String(),
  symbol: t.String(),
  iconUrl: t.String(),
  decimals: t.Optional(t.Number({ minimum: 0, maximum: 18 }))
});

export type upsertAssetSchema = Static<typeof upsertAssetSchema>;

type responseType = {
  success: true,
  data: object,
  error: null
} | {
  success: false,
  data: null,
  error: string
};

type overLoadResponse = {
  (success: true, data: object, error: null): responseType
  (success: false, data: null, error: string): responseType
}

export const response: overLoadResponse = (success: boolean, data: object | null, error: string | null) => {
  return { success, data, error } as responseType;
}

export const errors = {
  typeBox400: "INVALID_REQUEST",
  nonce402: "INVALID_OR_EXPIRED_NONCE",
  emailConflict409: "EMAIL_ALREADY_EXISTS",
  bucketConflict409: "BUCKET_ALREADY_EXISTS",
  unauthorized401: "UNAUTHORIZED",
  serverError500: "INTERNAL_SERVER_ERROR",
  bucketCreator403: "BUCKET_CREATOR_REQUIRED",
  bucketNotFound404: "BUCKET_NOT_FOUND",
  bucketNotPublished400: "BUCKET_NOT_OPEN_FOR_INVESTMENT",
  listingPercentages400: "LISTING_PERCENTAGES_MUST_SUM_TO_100",
  bucketNotDraft400: "BUCKET_NOT_IN_DRAFT",
  bucketAlreadyPublished400: "BUCKET_ALREADY_PUBLISHED"
}