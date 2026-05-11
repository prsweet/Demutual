/** Human-readable route map for GET / and docs. */
export const API_ROUTE_MANIFEST = {
  auth: {
    "GET /auth/nonce": "SIWS-style nonce for wallet login",
    "POST /auth/wallet-login": "Verify signature, return JWT"
  },
  users: {
    "GET /users/me": "Current user + counts (auth)",
    "GET /users/me/deposits": "Deposit history with bucket summary (auth)"
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
    "POST /buckets/:id/invest/jupiter-complete": "Verify optional fee tx, record TVL after Jupiter buys (mainnet only, auth)",
    "POST /buckets/:id/sell/jupiter-plan": "Build Jupiter ExactOut sell swap txs + optional fee transfer (mainnet only, auth)",
    "POST /buckets/:id/sell/jupiter-complete": "Verify optional fee tx, record withdrawal after Jupiter sells (mainnet only, auth)",
    "POST /buckets/:id/withdraw": "Ledger-only withdrawal — no on-chain payout (mainnet+devnet, auth)",
    "POST /buckets/:id/creator/assets": "Set draft listings (creator)",
    "POST /buckets/:id/creator/publish": "Publish draft with researchDoc markdown — trimmed length ≥100 (creator)",
    "POST /buckets/:id/creator/versions": "Fork new draft version (creator)",
    "POST /buckets/:id/invest (alt)": "Treasury path requires INVEST_TREASURY_PUBKEY + SOLANA_RPC_URL"
  },
  devnet: {
    "GET /devnet/airdrop?address=&amount=": "Devnet-only SOL faucet for demo wallets (DEMUTUAL_NETWORK=devnet)"
  }
} as const;
