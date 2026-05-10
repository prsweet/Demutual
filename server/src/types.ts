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

/** Execute a signed Jupiter Meta-Aggregator order transaction. */
export const jupiterExecuteSchema = t.Object({
  signedTransaction: t.String({ minLength: 8 }),
  requestId: t.String({ minLength: 1 }),
  lastValidBlockHeight: t.Optional(t.Number({ minimum: 0 }))
});

export type jupiterExecuteSchema = Static<typeof jupiterExecuteSchema>;

/** Build a *fresh* Jupiter order for a single leg right before the user signs (avoids blockhash expiry). */
export const jupiterLegOrderSchema = t.Object({
  outputMint: t.String({ minLength: 32, maxLength: 64 }),
  lamports: t.Number({ exclusiveMinimum: 0 }),
  slippageBps: t.Optional(t.Number({ minimum: 1, maximum: 5000 }))
});

export type jupiterLegOrderSchema = Static<typeof jupiterLegOrderSchema>;

/** Build fresh Jupiter orders for many legs in one request — keeps Jupiter `/order` rate-limit pressure server-side.
 * Also CREATES a BasketAttempt + per-leg rows so that partial fills can be recorded and resumed.
 */
export const jupiterLegOrderBatchSchema = t.Object({
  legs: t.Array(
    t.Object({
      outputMint: t.String({ minLength: 32, maxLength: 64 }),
      lamports: t.Number({ exclusiveMinimum: 0 })
    }),
    { minItems: 1, maxItems: 10 }
  ),
  slippageBps: t.Optional(t.Number({ minimum: 1, maximum: 5000 })),
  /** Total intended SOL for this attempt (gross). Used to credit the Deposit row sized to actual successes. */
  intendedSol: t.Number({ exclusiveMinimum: 0 })
});

export type jupiterLegOrderBatchSchema = Static<typeof jupiterLegOrderBatchSchema>;

/** Per-leg result schema used by *attempt-complete and *attempt-resume-complete.
 * `legId` MUST come back unchanged from `attempt-start` / `attempt-resume`.
 */
export const basketLegResultSchema = t.Object({
  legId: t.String({ minLength: 1 }),
  status: t.Union([t.Literal("SUCCESS"), t.Literal("FAILED")]),
  signature: t.Optional(t.String({ minLength: 32, maxLength: 128 })),
  error: t.Optional(t.String({ maxLength: 1024 }))
});

export type basketLegResultSchema = Static<typeof basketLegResultSchema>;

/** Replaces the old `jupiterInvestCompleteSchema`: per-leg results scoped to a BasketAttempt. */
export const jupiterInvestCompleteSchema = t.Object({
  attemptId: t.String({ minLength: 1 }),
  /** Required iff the plan returned a `feeTransfer` and PLATFORM_FEE_WALLET_PUBKEY is configured.
   * On RESUME calls it is ignored (the attempt already has feeTransferSignature persisted).
   */
  feeTransferSignature: t.Optional(t.String({ minLength: 32, maxLength: 128 })),
  legs: t.Array(basketLegResultSchema, { minItems: 1, maxItems: 20 })
});

export type jupiterInvestCompleteSchema = Static<typeof jupiterInvestCompleteSchema>;

/** Resume the still-pending or failed legs of an existing PARTIAL/PENDING attempt. */
export const jupiterAttemptResumeSchema = t.Object({
  slippageBps: t.Optional(t.Number({ minimum: 1, maximum: 5000 }))
});

export type jupiterAttemptResumeSchema = Static<typeof jupiterAttemptResumeSchema>;

/** Pagination + status filter for GET /users/me/attempts. */
export const myAttemptsQuerySchema = t.Object({
  status: t.Optional(
    t.Union([
      t.Literal("PENDING"),
      t.Literal("PARTIAL"),
      t.Literal("COMPLETE"),
      t.Literal("ABANDONED")
    ])
  ),
  bucketId: t.Optional(t.String({ minLength: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Numeric({ minimum: 0 }))
});

export type myAttemptsQuerySchema = Static<typeof myAttemptsQuerySchema>;

/** Sell side mirrors the buy: per-listing ExactOut quotes (asset → SOL) sized by withdrawal amount. */
export const jupiterSellPlanSchema = t.Object({
  solAmount: t.Number({ exclusiveMinimum: 0 }),
  slippageBps: t.Optional(t.Number({ minimum: 1, maximum: 5000 }))
});

export type jupiterSellPlanSchema = Static<typeof jupiterSellPlanSchema>;

/** Sell-side attempt-complete: per-leg results referencing the BasketAttempt created on plan build. */
export const jupiterSellCompleteSchema = t.Object({
  attemptId: t.String({ minLength: 1 }),
  feeTransferSignature: t.Optional(t.String({ minLength: 32, maxLength: 128 })),
  legs: t.Array(basketLegResultSchema, { minItems: 1, maxItems: 20 })
});

export type jupiterSellCompleteSchema = Static<typeof jupiterSellCompleteSchema>;

export const withdrawBucketSchema = t.Object({
  amount: t.Number({ exclusiveMinimum: 0 })
});

export type withdrawBucketSchema = Static<typeof withdrawBucketSchema>;

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

export const idParamSchema = t.Object({
  id: t.String()
});

export type idParamSchema = Static<typeof idParamSchema>;

export const paginationQuerySchema = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Numeric({ minimum: 0 }))
});

export type paginationQuerySchema = Static<typeof paginationQuerySchema>;

export const listBucketsQuerySchema = t.Object({
  name: t.Optional(t.String()),
  creatorId: t.Optional(t.String()),
  /** Without creatorId, only PUBLISHED buckets are returned (marketplace). With creatorId, includes drafts unless status is set. */
  status: t.Optional(t.Union([t.Literal("PUBLISHED"), t.Literal("DRAFT")])),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Numeric({ minimum: 0 }))
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
  jupiterNothingToSwap400: "JUPITER_NOTHING_TO_SWAP",
  jupiterDevnetUnsupported400: "JUPITER_NOT_AVAILABLE_ON_DEVNET",
  jupiterSellPlan400: "JUPITER_SELL_PLAN_FAILED",
  jupiterSellNothingToSwap400: "JUPITER_SELL_NOTHING_TO_SWAP",
  sellTxDuplicate409: "SELL_TX_ALREADY_RECORDED",
  treasuryInvestDevnetOnly400: "TREASURY_INVEST_DEVNET_ONLY",
  feeTransferRequired400: "FEE_TRANSFER_SIGNATURE_REQUIRED",
  feeTransferVerify400: "FEE_TRANSFER_VERIFICATION_FAILED",
  creatorWalletMissing400: "CREATOR_WALLET_MISSING",
  withdrawInsufficient400: "WITHDRAW_EXCEEDS_POSITION",
  withdrawBucketNotPublished400: "WITHDRAW_BUCKET_NOT_PUBLISHED",
  attemptNotFound404: "ATTEMPT_NOT_FOUND",
  attemptNotResumable400: "ATTEMPT_NOT_RESUMABLE",
  attemptNoLegsToResume400: "ATTEMPT_NO_LEGS_TO_RESUME",
  attemptLegMismatch400: "ATTEMPT_LEG_MISMATCH"
}