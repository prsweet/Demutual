# Server Performance Work — Pending Items

Items that need further work but were not edited. Each section explains the problem, why it matters, and exactly what to do.

---

## 1. Sequential Jupiter API calls with hardcoded 600ms sleeps

### Where
- `jupiterInvestController.ts` — `buildJupiterPlan` (line ~188), `buildJupiterLegOrdersBatch` (line ~806), `resumeJupiterAttempt` (line ~905)
- `jupiterSellController.ts` — `buildJupiterSellPlan` (line ~217), `resumeJupiterSellAttempt` (line ~561)

### The problem
Every plan-build and resume function calls `jupiterOrder()` in a sequential loop with `await new Promise(resolve => setTimeout(resolve, 600))` between each leg. For a 5-asset bucket that's **3+ seconds** of pure sleeping, on top of the actual API roundtrip (~200-400ms each). A 10-asset bucket wastes 6+ seconds just sleeping.

### Why 600ms was added
Jupiter's free-tier API key has a rate limit (roughly 1-2 requests/second on `/swap/v2/order`). The 600ms sleep was a safety blanket to avoid getting 429'd. But it's a blunt instrument — it always waits the full 600ms even when Jupiter would accept faster.

### What to do (free tier key)

Since you're on the free tier, you can't blast requests in parallel. But you can still be much smarter:

**Option A — Adaptive backoff (simplest, recommended)**

Replace the fixed 600ms sleep with a "start fast, slow down only on 429" approach:

```typescript
// Instead of:
await new Promise(resolve => setTimeout(resolve, 600));

// Do:
let backoffMs = 0; // start with no delay
const MAX_BACKOFF = 2000;

for (let i = 0; i < legs.length; i++) {
  if (backoffMs > 0) await new Promise(r => setTimeout(r, backoffMs));
  
  try {
    const order = await jupiterOrder({ ... });
    // Success — reduce backoff (but don't go below 0)
    backoffMs = Math.max(0, backoffMs - 100);
    legs.push(order);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("429") || msg.includes("RATE")) {
      // Hit rate limit — increase backoff and retry this leg
      backoffMs = Math.min(MAX_BACKOFF, (backoffMs || 200) * 2);
      i--; // retry same leg
      continue;
    }
    throw e; // real error, not rate limit
  }
}
```

**Why this is better:** On good days (Jupiter not under load), all 5 legs fire with zero delay — total time drops from 3s to ~1-2s of pure API time. On bad days, it backs off automatically and retries instead of failing.

**Option B — Token bucket rate limiter (more robust)**

Create a shared rate limiter module that all Jupiter calls go through:

```typescript
// services/rateLimiter.ts
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  
  constructor(
    private maxTokens: number = 2,    // max burst
    private refillRate: number = 1.5  // tokens per second (free tier ~1-2 req/s)
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      const elapsed = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
      this.lastRefill = now;
      
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      
      const waitMs = Math.ceil((1 - this.tokens) / this.refillRate * 1000);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

export const jupiterRateLimiter = new TokenBucket();
```

Then wrap every `jupiterOrder()` call:

```typescript
await jupiterRateLimiter.acquire();
const order = await jupiterOrder({ ... });
// No manual sleep needed
```

**Why this is better:** Multiple concurrent users share the same rate budget. Without this, two users building plans simultaneously both sleep 600ms but might still 429 because they overlap. A shared bucket prevents that.

---

## 2. Catalog sync — 1000+ individual DB upserts

### Where
`catalogSync.ts:149-190` — the `for (const p of parsed)` loop doing individual `prisma.asset.upsert()` for every token in Jupiter's verified list.

### The problem
Jupiter's verified token list has 1000+ tokens. Each `prisma.asset.upsert()` is an individual SQL query sent to Neon (hosted Postgres over the network). At ~5-15ms per query (Neon latency), that's **5-15 seconds** minimum for the full sync. This blocks the first `/assets/catalog` request after server boot.

### What to do — raw SQL bulk upsert

Replace the loop with a single raw SQL `INSERT ... ON CONFLICT` statement. Prisma's `$executeRawUnsafe` lets you build this:

```typescript
// Instead of 1000 individual upserts, build one bulk statement.
// Chunk into batches of 100 to stay under Postgres parameter limits.

const CHUNK_SIZE = 100;
for (let i = 0; i < parsed.length; i += CHUNK_SIZE) {
  const chunk = parsed.slice(i, i + CHUNK_SIZE);
  
  // Build parameterized VALUES list
  const values: unknown[] = [];
  const placeholders: string[] = [];
  
  chunk.forEach((p, idx) => {
    const base = idx * 12; // 12 columns
    placeholders.push(
      `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}::jsonb, $${base+11}, $${base+12})`
    );
    values.push(
      p.asset.id,
      p.asset.name,
      p.asset.symbol,
      p.asset.iconUrl,
      p.asset.decimals,
      p.asset.category,
      true,           // inCatalog
      p.isVerified,
      p.isSus,
      JSON.stringify(p.tags),  // tags as jsonb
      p.organicScore,
      now              // lastSyncedAt
    );
  });
  
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Asset" (
      "id", "name", "symbol", "iconUrl", "decimals", "category",
      "inCatalog", "isVerified", "isSus", "tags", "organicScore", "lastSyncedAt"
    )
    VALUES ${placeholders.join(", ")}
    ON CONFLICT ("id") DO UPDATE SET
      "name" = EXCLUDED."name",
      "symbol" = EXCLUDED."symbol",
      "iconUrl" = EXCLUDED."iconUrl",
      "decimals" = EXCLUDED."decimals",
      "category" = EXCLUDED."category",
      "inCatalog" = EXCLUDED."inCatalog",
      "isVerified" = EXCLUDED."isVerified",
      "isSus" = EXCLUDED."isSus",
      "tags" = EXCLUDED."tags",
      "organicScore" = EXCLUDED."organicScore",
      "lastSyncedAt" = EXCLUDED."lastSyncedAt"
  `, ...values);
  
  result.upsertedToDb += chunk.length;
}
```

**Impact:** Goes from 1000+ queries (~5-15s) to ~10 queries (~50-150ms). First catalog load becomes near-instant.

**Important:** Keep the existing `try/catch` per-error tracking logic but at the chunk level instead. If a chunk fails, log which chunk and continue with the next one.

---

## 3. Missing database indexes

### Where
`prisma/schema.prisma`

### The problem
Several models are queried on hot paths (every invest, sell, position check) but have no composite indexes. As data grows, these become full table scans.

### What to add

Add these indexes to `schema.prisma`:

```prisma
model Nonce {
  // ... existing fields ...
  @@index([walletAddress, used, expiresAt])  // login nonce lookup
}

model Deposit {
  // ... existing fields ...
  @@index([userId, bucketId])  // position aggregates (used on every invest/sell/withdraw)
}

model Withdrawal {
  // ... existing fields ...
  @@index([userId, bucketId])  // position aggregates (used on every sell solvency check)
}

model Listing {
  // ... existing fields ...
  @@index([bucketId])  // bucket detail includes listings
}

model Bucket {
  // ... existing fields ...
  @@index([type])  // marketplace listing filters by PUBLISHED
}
```

### How to apply

```bash
# Generate the migration
bunx prisma migrate dev --name add-performance-indexes

# Or if using push (no migration history):
bunx prisma db push
```

### Why this matters
- The `Deposit` and `Withdrawal` aggregate queries (`_sum: { amount: true }`) run on **every** position check, invest-complete, and sell-complete. Without an index on `(userId, bucketId)`, Postgres scans the full table.
- The `Nonce` table is queried on every login attempt with `findFirst` filtering on `walletAddress + value + used + expiresAt`. Without an index, this is a table scan that gets slower as expired nonces accumulate (since they're never cleaned up).
- `Listing` is included via `include: { listing: ... }` on almost every bucket query. The FK `bucketId` has no index, so Prisma's join scans the full `Listing` table.

**Effort: 5 minutes. Impact: prevents degradation as data grows.**

---

## 4. Solana Connection singleton

### Where
- `investTxVerify.ts:44` — `new Connection(rpcUrl, "confirmed")` on every tx verification
- `ataRent.ts:25,59` — `new Connection(...)` on every ATA/rent check
- `userController.ts:99` — `new Connection(...)` on every fee-receiver verify
- `devnetController.ts:30` — `new Connection(...)` on every airdrop

### What is an RPC URL?
Your Solana RPC URL (set via `SOLANA_RPC_URL` env var) is the HTTP endpoint your server talks to for on-chain data — reading accounts, verifying transactions, checking balances. Think of it like your Postgres `DATABASE_URL` but for the Solana blockchain. It's usually something like:
- `https://api.devnet.solana.com` (free devnet)
- `https://mainnet.helius-rpc.com/?api-key=xxx` (paid mainnet provider like Helius, Triton, QuickNode)

### The problem
Every function that touches Solana creates `new Connection(rpcUrl, "confirmed")`. The `Connection` object itself is cheap to create, but the underlying `fetch` calls don't benefit from HTTP keep-alive / connection pooling when you throw away the `Connection` after each use.

In a multi-leg invest flow, this means:
1. `estimateMissingAtaRentLamports` creates Connection #1
2. `checkFeeRecipientsRentSafe` creates Connection #2  
3. `verifyInvestFeeBundle` creates Connection #3

Each one opens a fresh TCP+TLS handshake to the RPC provider (~50-100ms overhead per connection on first request).

### What to do

Create a lazy singleton in a shared module:

```typescript
// services/solanaConnection.ts
import { Connection } from "@solana/web3.js";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL?.trim() || "";

let _connection: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (!SOLANA_RPC_URL) throw new Error("SOLANA_RPC_URL not configured");
  if (!_connection) {
    _connection = new Connection(SOLANA_RPC_URL, "confirmed");
  }
  return _connection;
}
```

Then replace all `new Connection(rpcUrl, "confirmed")` calls with `getSolanaConnection()`. You'd also stop passing `rpcUrl` as a parameter to functions like `estimateMissingAtaRentLamports` — they'd just call `getSolanaConnection()` internally.

### How easy?
Very easy — ~15 minutes. Create one new file, then find-and-replace in 4 files. The `Connection` object is stateless and safe to share across concurrent requests.

---

## 6. Middleware re-fetches bucket before controller

### Where
- `middlewares/auth.ts:29-36` — `requireBucketCreator` guard
- `bucketControllers.ts` — `addBucketAssets`, `publishBucket`, `forkBucketVersion` (all three re-fetch the bucket after the middleware already did)

### The problem
The `requireBucketCreator` middleware does:
```typescript
const bucket = await prisma.bucket.findUnique({ where: { id: params.id } });
```
Then **throws the result away**. The controller that runs after it does the **exact same query** again to get the bucket. That's 2 DB roundtrips where 1 would suffice.

### Why this happens
Elysia's `beforeHandle` guards don't have a built-in way to pass data to the handler. The guard checks ownership, but the handler doesn't know the guard already has the bucket object.

### What to do — stash on context via Elysia's `store`

Elysia lets you attach data to the request context using `derive` or `store`. The idea is: the middleware fetches the bucket, checks ownership, and then "stashes" it on the context so the controller can read it directly without a second query.

```typescript
// middlewares/auth.ts
const requireBucketCreator = async ({ params, userId, store }: any) => {
  if (!userId) return status(401, response(false, null, errors.unauthorized401));
  const bucket = await prisma.bucket.findUnique({ where: { id: params.id } });
  if (!bucket) return status(404, response(false, null, errors.bucketNotFound404));
  if (bucket.creatorId !== userId) {
    return status(403, response(false, null, errors.bucketCreator403));
  }
  // Stash the bucket so the controller doesn't have to re-fetch it.
  store.bucket = bucket;
};
```

Then in the controller:
```typescript
const addBucketAssets = async ({ params, userId, body, store }: ...) => {
  // Use the bucket the middleware already fetched:
  const bucket = store.bucket;
  // No need for: const bucket = await prisma.bucket.findUnique(...)
  // ...
};
```

### Why this matters
Every creator-protected route (`/creator/assets`, `/creator/publish`, `/creator/versions`) currently makes 2 identical `findUnique` calls — one in the guard, one in the handler. With stashing, it drops to 1. That's one fewer DB roundtrip per request on these endpoints.

### Caveats
- You may need to tell Elysia about the `store` shape in its type system (depends on Elysia version). In Elysia v1.x, you can use `.state()` to declare the store shape on the app instance.
- If you need the bucket with different `include` relations in the controller vs. the guard, you can either include everything in the guard's query, or just stash the basic fields and selectively re-fetch only the relations. Still faster than 2 full queries.
