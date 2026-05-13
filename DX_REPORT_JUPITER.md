# Demutual: Jupiter Developer Experience (DX) Report

**Project:** Demutual (Decentralized Mutual Funds on Solana)
**Track:** Not Your Regular Bounty (Jupiter)

## 1. Project Context & Use Case
Demutual abstracts DeFi complexity by allowing mainstream users to invest in curated "buckets" (multi-token baskets) in a single click. When a user deposits SOL into a bucket (e.g., 40% JitoSOL, 40% USDC, 20% BONK), the backend instantly calculates the splits and routes multiple parallel swaps. 

Because we route highly fragmented, multi-token liquidity, we are extreme power-users of the Jupiter API. Our integration migrated from the legacy V1 API to the cutting-edge **V2 Meta-Aggregator** during this hackathon.

---

## 2. API Performance: Critical Bugs & Edge Cases Found

During our deep integration testing, we encountered two significant edge cases in the new V2 infrastructure that degrade the developer experience. Here is our direct feedback for the engineering team:

### Feedback A: The 500 Internal Server Error Bug on `/swap/v2/order`
**The Issue:** When you pass an invalid, deprecated, or non-existent token mint address to the new V2 `/order` endpoint, Jupiter internally crashes.
*   **V1 Behavior:** `GET /swap/v1/quote` correctly returns a `400 Bad Request` with `{ "error": "The token is not tradable", "errorCode": "TOKEN_NOT_TRADABLE" }`. This made debugging instant.
*   **V2 Behavior:** `GET /swap/v2/order` completely swallows the validation error and returns an opaque `500 Internal Server Error: {"error":"Something unexpected occurred"}`. 
**The Request:** V2 must inherit the exact validation error schemas from V1. When debugging our token catalog, a 500 error gives us absolutely zero indication that the mint address is the problem.

### Feedback B: Token Metadata (V2 Tokens API)
**The Issue:** When fetching verified token data from `https://api.jup.ag/tokens/v2/tag?query=verified`, dozens of top-tier tokens (SOL, USDC, JitoSOL) return `icon` URLs pointing to `raw.githubusercontent.com/solana-labs/token-list/...`. 
**The Request:** Because the Solana Foundation archived that repository, those images `404` in production environments. Jupiter should actively proxy, cache, or automatically update the icon URLs for the top 100 most-traded tokens to point to a stable CDN, rather than relying on legacy, dead GitHub links submitted years ago. We had to build a custom fallback mechanism using CoinGecko's API just to get working SVG/PNG links.

---

## 3. Documentation & Onboarding

### The Good: `llms.txt` is a Game Changer
We utilized an AI coding agent to assist with our backend migration. The inclusion of `https://dev.jup.ag/docs/llms.txt` is a masterclass in modern developer onboarding. By feeding this index directly into our agent, it instantly understood the architectural dichotomy between the **Meta-Aggregator** (`/order` & `/execute`) and the **Router** (`/build` & `/submit`). The agent successfully drafted our migration plan in under 5 minutes without us manually reading a single page.

### Feedback C: Lack of Explicit Rate Limit Documentation
**The Issue:** Demutual executes multi-token basket swaps (e.g., buying 5 tokens simultaneously). Firing concurrent `/order` requests immediately triggers a `429 Too Many Requests` block on the public tier.
**The Request:** The official documentation explicitly mentions that `/execute` has a dedicated rate limit bucket, but it fails to define the exact RPS or burst limits for the `/order` endpoint on the free tier. Developers are forced to trial-and-error arbitrary sleep loops (e.g., `setTimeout(resolve, 600)`) to bypass the Web Application Firewall (WAF). A simple table mapping "Tier -> `/order` Burst Limits" is required.

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

### Feedback D: Clarification on Wallet “Failed Simulation” Errors
**The Issue:** When a user is routed through JupiterZ (RFQ), the transaction sent to their wallet is missing the market maker’s final signature. Consequently, wallets like Backpack throw a highly alarming, bright red warning: *“Transaction failed simulation. No balance changes detected.”* 
**The Request:**
1. The documentation needs a massive, bold callout on the `/order` page explicitly explaining that RFQ routes will cause local wallet simulations to fail, but that execution via `/execute` is still safe.
2. **Explicit RFQ Flag (`isRfqRoute: boolean`):** We desperately need an `isRfqRoute: boolean` flag returned in the `/order` JSON payload. If we have this flag, we can dynamically render a warning in our own frontend UI *before* the wallet pops up, assuring the user that the red error is expected and safe to bypass.

### Feature Request: Bundled Basket Endpoint (`/v2/basket`)
Currently, building a mutual fund app requires $N$ API calls for $N$ tokens. Jupiter should introduce an endpoint where a developer submits an input mint and an array of output mints + weights. Jupiter's engine could optimize the routing collectively and return an array of optimized transactions, drastically reducing API overhead and eliminating 429 errors for portfolio management protocols.