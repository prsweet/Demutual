# Demutual: Jupiter Developer Experience (DX) Report

**Project:** Demutual (Decentralized Mutual Funds on Solana)
**Track:** Not Your Regular Bounty (Jupiter)

## 1. Project Context & Use Case
Demutual abstracts DeFi complexity by allowing mainstream users to invest in curated "buckets" (multi-token baskets) in a single click. When a user deposits SOL into a bucket (e.g., 40% JitoSOL, 40% USDC, 20% BONK), the backend instantly calculates the splits and routes multiple parallel swaps. 

Because we route highly fragmented, multi-token liquidity, we are extreme power-users of the Jupiter API. Our integration migrated from the legacy V1 API to the cutting-edge **V2 Meta-Aggregator** during this hackathon.

---

## 2. API Performance: Critical Bugs & Edge Cases Found

During our deep integration testing, we encountered two significant edge cases in the new V2 infrastructure that degrade the developer experience:

### A. V2 `/order` endpoint swallows validation errors (500 vs 400)
When building our token catalog, we accidentally included an invalid/deprecated mint address for Drift Staked SOL (dSOL). 
*   **V1 Behavior:** When querying the legacy `/swap/v1/quote`, Jupiter correctly and gracefully handled the bad mint, returning a `400 Bad Request` with a highly descriptive error: `{"error":"The token [Mint] is not tradable","errorCode":"TOKEN_NOT_TRADABLE"}`. This made debugging instant.
*   **V2 Behavior (Bug):** When we migrated to the V2 Meta-Aggregator and hit `/swap/v2/order` with the exact same bad mint, the Jupiter server internally crashed. It returned a `500 Internal Server Error` with a completely opaque message: `{"error":"Something unexpected occurred"}`. 
*   **Impact:** Developers migrating to V2 lose critical validation debugging data. V2 should inherit the exact validation error schemas from V1.

### B. Tokens API V2 returns deprecated/broken CDN links
When attempting to dynamically fetch verified token metadata to render our marketplace UI, we utilized `https://api.jup.ag/tokens/v2/tag?query=verified`.
*   **The Issue:** Many blue-chip tokens (including SOL, USDC, and JitoSOL) returned `icon` URLs pointing to `raw.githubusercontent.com/solana-labs/token-list/...`. Because the Solana Foundation deprecated and archived that repository, those images 404 in production web apps.
*   **The Reality:** The `icon` field isn't a guaranteed, Jupiter-hosted CDN link; it simply reflects whatever the token submitter registered.
*   **The Fix Required:** Jupiter should ideally proxy and cache these images on a Jupiter-owned CDN (e.g., `static.jup.ag`), or at the very least, run a dead-link crawler to update the metadata for top-100 verified tokens. We had to build a custom fallback mechanism using CoinGecko's API just to get working SVG/PNG links.

---

## 3. Documentation & Onboarding

### The Good: `llms.txt` is a Game Changer
We utilized an AI coding agent to assist with our backend migration. The inclusion of `https://dev.jup.ag/docs/llms.txt` is a masterclass in modern developer onboarding. By feeding this index directly into our agent, it instantly understood the architectural dichotomy between the **Meta-Aggregator** (`/order` & `/execute`) and the **Router** (`/build` & `/submit`). The agent successfully drafted our migration plan in under 5 minutes without us manually reading a single page.

### The Missing: Rate Limit Clarity for Complex Arbitrage
Demutual executes multi-leg basket swaps. If a basket has 5 tokens, we must fetch 5 quotes simultaneously.
*   On the free public API tier, firing 5 concurrent `/order` requests via `Promise.all` immediately triggers a `429 Too Many Requests` block (`{"code":429,"message":"[API Gateway] Too many requests"}`).
*   **Documentation Gap:** The docs do not clearly explicitly state the burst/concurrency limits for the free tier. We had to trial-and-error a `600ms` sequential delay between `/order` requests to bypass the WAF. A clear table detailing exact RPS/Burst limits per tier would save developers hours of debugging.

---

## 4. Architectural Feedback: Why we chose Meta-Aggregator

Our initial goal was to use the **Router (`/v2/build`)** path. We wanted to take the raw swap instructions from Jupiter, append our own `SystemProgram.transfer` (for Demutual's 0.1% platform fee), and bundle everything into a single `VersionedTransaction` for the user to sign once.

**Why we abandoned it:** Solana's strict 1,232-byte transaction limit makes this impossible for multi-token basket protocols. A single Jupiter route is highly optimized but instruction-heavy. It is physically impossible to pack 4-5 Jupiter swaps + a fee transfer into one transaction. 

**The Pivot:** We embraced the **Meta-Aggregator (`/v2/order` & `/v2/execute`)**.
Since we were forced to have users sign multiple transactions anyway, the Meta-Aggregator became the undisputed best choice. 
1.  It gave our users access to **JupiterZ (RFQ)** liquidity, frequently beating on-chain routing by 5-15bps. 
2.  The `/execute` pipeline natively handled the partially-signed RFQ transactions (where market makers add signatures during execution).
3.  We built an "Option B" partial-fill architecture using `Promise.allSettled` on the `/execute` endpoint. If 1 leg out of 5 fails (due to slippage), our backend tracks it and allows the user to resume and re-quote *only* the missing leg later.

---

## 5. Strategic Improvements & Feature Requests

1.  **Bundled Basket Endpoint:** Currently, building a mutual fund app requires N API calls for N tokens. Jupiter should introduce a `/v2/basket` endpoint where a developer submits an input mint and an array of output mints + weights. Jupiter's engine could optimize the routing collectively and return an array of optimized transactions, drastically reducing API overhead for portfolio management protocols.
2.  **Explicit RFQ Flag:** In the `/order` response, provide a boolean `isRfqRoute: true`. Since RFQ routes cannot be simulated locally by wallets (like Backpack) without throwing a "Transaction failed simulation" error, knowing this flag in advance would allow developers to show a clean warning UI to the user: *"This route uses off-chain liquidity. Your wallet simulation may fail, but execution is safe."*