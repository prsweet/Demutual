/** Human-readable route map for GET / and docs. */
export const API_ROUTE_MANIFEST = {
  auth: {
    "GET /auth/nonce": "SIWS-style nonce for wallet login",
    "POST /auth/wallet-login": "Verify signature, return JWT"
  },
  users: {
    "GET /users/me": "Current user + counts (auth)",
    "GET /users/me/deposits": "Deposit history with bucket summary (auth)",
    "GET /users/me/attempts?status=&bucketId=": "Resumable basket attempts (PARTIAL/PENDING) for the caller (auth)"
  },
  attempts: {
    "POST /attempts/:attemptId/abandon": "User opts out of resuming a partial basket attempt (auth)"
  },
  assets: {
    "GET /assets/catalog": "Public curated token list + categories",
    "GET /assets": "List registered assets (auth)",
    "POST /assets": "Upsert custom asset (auth)"
  },
  buckets: {
    "GET /buckets": "List buckets; ?creatorId=&status= for creator drafts",
    "GET /buckets/:id": "Bucket detail + listings",
    "GET /buckets/:id/my-position": "Your deposit/withdraw balance in bucket (auth)",
    "POST /buckets": "Create draft (auth)",
    "POST /buckets/:id/invest": "Devnet-only: book deposit after SOL→treasury tx verified (auth)",
    "POST /buckets/:id/invest/jupiter-plan": "Build Jupiter buy swap txs + optional fee transfer (mainnet only, auth)",
    "POST /buckets/:id/invest/jupiter-leg-orders-batch": "Create BasketAttempt + fresh orders for all legs in one round-trip (auth)",
    "POST /buckets/:id/invest/jupiter-attempts/:attemptId/resume": "Re-quote orders for PENDING/FAILED legs of a partial buy attempt (auth)",
    "POST /buckets/:id/invest/jupiter-execute": "Submit a signed Jupiter Meta-Aggregator order tx (auth)",
    "POST /buckets/:id/invest/jupiter-complete": "Per-leg outcome record; only successful legs credit TVL (mainnet only, auth)",
    "POST /buckets/:id/sell/jupiter-plan": "Build Jupiter ExactOut sell swap txs + optional fee transfer; creates a SELL attempt (mainnet only, auth)",
    "POST /buckets/:id/sell/jupiter-attempts/:attemptId/resume": "Re-quote ExactOut for PENDING/FAILED legs of a partial sell attempt (auth)",
    "POST /buckets/:id/sell/jupiter-complete": "Per-leg outcome record; only successful legs reduce TVL (mainnet only, auth)",
    "POST /buckets/:id/withdraw": "Ledger-only withdrawal — no on-chain payout (mainnet+devnet, auth)",
    "POST /buckets/:id/creator/assets": "Set draft listings (creator)",
    "POST /buckets/:id/creator/publish": "Publish draft (creator)",
    "POST /buckets/:id/creator/versions": "Fork new draft version (creator)",
    "POST /buckets/:id/invest (alt)": "Treasury path requires INVEST_TREASURY_PUBKEY + SOLANA_RPC_URL"
  },
  devnet: {
    "GET /devnet/airdrop?address=&amount=": "Devnet-only SOL faucet for demo wallets (DEMUTUAL_NETWORK=devnet)"
  }
} as const;
