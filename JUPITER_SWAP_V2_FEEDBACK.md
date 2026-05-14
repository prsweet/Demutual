# Jupiter Swap V2: Error Handling & Developer Feedback

This document serves as both an internal engineering reference for handling Jupiter V2 Meta-Aggregator errors and a direct piece of developer feedback to the Jupiter team regarding edge cases, bugs, and API inconsistencies we discovered during our integration.

---

## 1. Official V2 Execution Error Codes (`/swap/v2/execute`)

When submitting a signed transaction to Jupiter's `/execute` endpoint, the API returns the following negative integer codes. These are explicitly defined in the official Jupiter documentation.

### A. Aggregator Errors (On-Chain Routing)
*These occur when Jupiter's on-chain routing engine attempts to land the transaction but fails.*

| Code | Meaning | Retryable | Internal Implementation Strategy |
| :--- | :--- | :---: | :--- |
| **-1000** | Failed landing attempt | ✅ Yes | **Action:** Catch, trigger exponential backoff, and silently re-quote (`/order`) before prompting the user to sign again. |
| **-1001** | Unknown error | ✅ Yes | **Action:** Standard network retry block. |
| **-1002** | Invalid transaction | ❌ No | **Action:** Fatal backend error. Usually indicates our transaction deserialization logic has broken. |
| **-1003** | Transaction not fully signed | ❌ No | **Action:** Reject the transaction in the frontend. Ensure the user's wallet successfully returned a signature block. |
| **-1004** | Invalid block height | ✅ Yes | **Action:** The quote is stale. Force the UI to fetch a new `/order` instantly. |

### B. RFQ Errors (JupiterZ Market Makers)
*These occur when the winning quote was provided by an off-chain market maker, and the execution failed during the final signature phase.*

| Code | Meaning | Retryable | Internal Implementation Strategy |
| :--- | :--- | :---: | :--- |
| **-2000** | Failed landing | ✅ Yes | **Action:** Re-quote. Often caused by market maker latency. |
| **-2001** | Unknown error | ✅ Yes | **Action:** Standard network retry block. |
| **-2002** | Invalid payload | ❌ No | **Action:** Fatal error. Indicates our request JSON to `/execute` is malformed. |
| **-2003** | Quote expired | ✅ Yes | **Action:** User took too long to click "Approve" in their wallet. Display a UI warning: *"Quote expired. Please sign faster."* and fetch a new `/order`. |
| **-2004** | Swap rejected | ✅ Yes | **Action:** Market maker pulled their quote due to sudden volatility. Re-quote immediately; Jupiter's engine will automatically route away from them. |

### C. General Execution Errors

| Code | Meaning | Retryable | Internal Implementation Strategy |
| :--- | :--- | :---: | :--- |
| **-1** | Missing/expired cached order | ✅ Yes | **Action:** `requestId` is stale. Re-quote. |
| **-2** | Invalid signed transaction | ❌ No | **Action:** Wallet integration error. |
| **-3** | Invalid message bytes | ❌ No | **Action:** Someone attempted to modify the Base64 bytes of a Jupiter `/order`. This is strictly forbidden in V2. |

---

## 2. Direct Feedback for the Jupiter Team

During our V2 integration, we discovered several areas where the Developer Experience (DX) breaks down. We strongly request the Jupiter team address these issues to help developers build faster, more resilient applications.

### Feedback A: The 500 Internal Server Error Bug on `/swap/v2/order`
**The Issue:** When you pass an invalid, deprecated, or non-existent token mint address to the new V2 `/order` endpoint, Jupiter internally crashes.
* **V1 Behavior:** `GET /swap/v1/quote` correctly returns a `400 Bad Request` with `{ "error": "The token is not tradable", "errorCode": "TOKEN_NOT_TRADABLE" }`.
* **V2 Behavior:** `GET /swap/v2/order` completely swallows the validation error and returns an opaque `500 Internal Server Error: {"error":"Something unexpected occurred"}`.
**The Request:** V2 must inherit the exact validation error schemas from V1. When debugging our token catalog, a 500 error gives us absolutely zero indication that the mint address is the problem. 

### Feedback B: Clarification on Wallet "Failed Simulation" Errors
**The Issue:** When a user is routed through JupiterZ (RFQ), the transaction sent to their wallet is missing the market maker's final signature. Consequently, wallets like Backpack throw a highly alarming, bright red warning: *"Transaction failed simulation. No balance changes detected."*
**The Request:** 
1. The documentation needs a massive, bold callout on the `/order` page explicitly explaining that RFQ routes will cause local wallet simulations to fail, but that execution via `/execute` is still safe.
2. We desperately need an `isRfqRoute: boolean` flag returned in the `/order` JSON payload. If we have this flag, we can dynamically render a warning in our own frontend UI *before* the wallet pops up, assuring the user that the red error is expected and safe to bypass.

### Feedback C: Lack of Explicit Rate Limit Documentation
**The Issue:** Demutual executes multi-token basket swaps (e.g., buying 5 tokens simultaneously). Firing concurrent `/order` requests immediately triggers a `429 Too Many Requests` block on the public tier.
**The Request:** The official documentation explicitly mentions that `/execute` has a dedicated rate limit bucket, but it fails to define the exact RPS or burst limits for the `/order` endpoint on the free tier. Developers are forced to trial-and-error arbitrary sleep loops (e.g., `setTimeout(resolve, 600)`) to bypass the Web Application Firewall (WAF). A simple table mapping "Tier -> `/order` Burst Limits" is required.

### Feedback D: Token Metadata (V2 Tokens API)
**The Issue:** When fetching verified token data from `https://api.jup.ag/tokens/v2/tag?query=verified`, dozens of top-tier tokens (SOL, USDC, JitoSOL) return `icon` URLs pointing to `raw.githubusercontent.com/solana-labs/token-list/...`.
**The Request:** Because the Solana Foundation archived that repository, those images `404` in production environments. Jupiter should actively proxy, cache, or automatically update the icon URLs for the top 100 most-traded tokens to point to a stable CDN, rather than relying on legacy, dead GitHub links submitted years ago.