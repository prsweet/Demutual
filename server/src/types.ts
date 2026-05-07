import { t, type Context, type Static } from "elysia";

export type decoratedContext<T extends Context> = T & {
  userId?: string
}

export const walletAuthSchema = t.Object({
  address: t.String({ minLength: 32, maxLength: 64 }),
  details: t.Object({ nonce: t.String({ minLength: 1 }), message: t.String({ minLength: 1 }) }),
  signature: t.String({ minLength: 1 }),
  /** Required when this wallet has no `User` row yet. */
  username: t.Optional(t.String({ minLength: 1, maxLength: 48 }))
});

export type walletAuthSchema = Static<typeof walletAuthSchema>;

export const nonceCreateSchema = t.Object({
  address: t.String()
});

export type nonceCreateSchema = Static<typeof nonceCreateSchema>;

export const createBucketSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  estimatedApy: t.Number({ minimum: 0 }),
  metaData: t.Optional(t.Any())
});

export type createBucketSchema = Static<typeof createBucketSchema>;

export const investInBucketSchema = t.Object({
  /** Gross SOL sent on-chain to `INVEST_TREASURY_PUBKEY` (before protocol fee split in DB). */
  amount: t.Number({ exclusiveMinimum: 0 }),
  /** Base58 transaction signature from the wallet after signing the SOL transfer. */
  transactionSignature: t.String({ minLength: 32, maxLength: 128 })
});

export type investInBucketSchema = Static<typeof investInBucketSchema>;

/** Build unsigned Jupiter swaps from bucket weights (SOL → each asset). */
export const jupiterInvestPlanSchema = t.Object({
  solAmount: t.Number({ exclusiveMinimum: 0 }),
  slippageBps: t.Optional(t.Number({ minimum: 1, maximum: 5000 }))
});

export type jupiterInvestPlanSchema = Static<typeof jupiterInvestPlanSchema>;

/** After the investor signs & sends each swap tx, record the round-trip. */
export const jupiterInvestCompleteSchema = t.Object({
  solAmount: t.Number({ exclusiveMinimum: 0 }),
  transactionSignatures: t.Array(t.String({ minLength: 32, maxLength: 128 }), { minItems: 1 })
});

export type jupiterInvestCompleteSchema = Static<typeof jupiterInvestCompleteSchema>;

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
  creatorId: t.Optional(t.String()),
  /** Without creatorId, only PUBLISHED buckets are returned (marketplace). With creatorId, includes drafts unless status is set. */
  status: t.Optional(t.Union([t.Literal("PUBLISHED"), t.Literal("DRAFT")]))
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
  notFound404: "ROUTE_NOT_FOUND",
  walletLoginUsernameRequired400: "WALLET_LOGIN_USERNAME_REQUIRED",
  walletLoginMessageNonce400: "WALLET_LOGIN_MESSAGE_MUST_CONTAIN_NONCE",
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
  bucketAlreadyPublished400: "BUCKET_ALREADY_PUBLISHED",
  bucketNoAssets400: "BUCKET_NEEDS_ASSETS_BEFORE_PUBLISH",
  unknownAsset400: "UNKNOWN_ASSET_ID_USE_CATALOG_OR_REGISTER",
  investNotConfigured503: "INVEST_CHAIN_NOT_CONFIGURED",
  investTxNotFound400: "INVEST_TX_NOT_FOUND",
  investTxVerify400: "INVEST_TX_VERIFICATION_FAILED",
  investTxDuplicate409: "INVEST_TX_ALREADY_RECORDED",
  jupiterPlan400: "JUPITER_PLAN_FAILED",
  jupiterNothingToSwap400: "JUPITER_NOTHING_TO_SWAP"
}