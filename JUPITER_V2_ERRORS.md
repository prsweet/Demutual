# Jupiter V2 API Error Reference

This document provides a comprehensive breakdown of the error codes, categories, and behaviors returned by Jupiter's latest V2 Swap API (specifically the Meta-Aggregator `/execute` pipeline). 

These are the exact errors you must handle when building a robust, production-grade integration as promoted in the *Not Your Regular Bounty* track.

## 1. Meta-Aggregator Execution Errors (`/swap/v2/execute`)

When you submit a signed transaction to Jupiter's `/execute` endpoint, the execution engine (which handles both on-chain AMM routing and off-chain RFQ market makers) will return specific integer error codes. 

### A. Aggregator Errors (Metis / On-Chain)
These errors occur when Jupiter's on-chain routing engine attempts to land the transaction but fails.

| Code | Meaning | Retryable? | Reason & Recommended Action |
| :--- | :--- | :---: | :--- |
| **-1000** | Failed landing attempt | ✅ Yes | Jupiter tried to land the transaction but network congestion or AMM state changes prevented it. **Action:** Re-quote with `/order` (potentially adjusting slippage/priority fees) and try again. |
| **-1001** | Unknown error | ✅ Yes | An unhandled exception occurred in the Jupiter landing pipeline. **Action:** Retry the execution with an exponential backoff. |
| **-1002** | Invalid transaction | ❌ No | The base64 transaction sent to `/execute` is structurally invalid or corrupted. **Action:** Check your transaction serialization and deserialization logic in the backend/frontend. |
| **-1003** | Transaction not fully signed | ❌ No | The transaction is missing a required signature (e.g., the user's wallet signature). **Action:** Ensure the `VersionedTransaction` is properly signed by the `taker` before sending it to the backend. |
| **-1004** | Invalid block height | ✅ Yes | The transaction's `recentBlockhash` has expired before it could be landed. **Action:** The quote is stale. You must generate a brand new `/order` and have the user sign again. |

### B. RFQ Errors (JupiterZ / Market Makers)
These errors occur when the winning quote was provided by an off-chain market maker, and the execution failed during the final signature or landing phase.

| Code | Meaning | Retryable? | Reason & Recommended Action |
| :--- | :--- | :---: | :--- |
| **-2000** | Failed landing | ✅ Yes | The market maker signed the transaction, but it failed to land on-chain. **Action:** Re-quote and retry. |
| **-2001** | Unknown error | ✅ Yes | An unhandled exception occurred within the JupiterZ RFQ engine. **Action:** Retry with exponential backoff. |
| **-2002** | Invalid payload | ❌ No | The payload sent to the RFQ engine was malformed. **Action:** Verify the exact JSON shape sent to `/execute` (`signedTransaction` and `requestId`). |
| **-2003** | Quote expired | ✅ Yes | The user took too long to sign the transaction. RFQ quotes have very short TTLs (Time-To-Live). **Action:** Generate a new `/order` and prompt the user to sign faster. |
| **-2004** | Swap rejected | ✅ Yes | The market maker actively rejected the swap (e.g., due to sudden extreme market volatility). **Action:** Re-quote. Jupiter's routing engine will likely route away from that specific market maker on the next attempt. |

### C. General Execution Errors

| Code | Meaning | Retryable? | Reason & Recommended Action |
| :--- | :--- | :---: | :--- |
| **-1** | Missing/expired cached order | ✅ Yes | The `requestId` provided is either invalid or the order has expired from Jupiter's cache (~2 minutes). **Action:** Generate a new `/order`. |
| **-2** | Invalid signed transaction | ❌ No | The signature attached to the transaction is mathematically invalid. **Action:** Fix the wallet signing implementation. |
| **-3** | Invalid message bytes | ❌ No | The underlying message bytes of the transaction were altered after the quote was generated. **Action:** Do not attempt to modify Jupiter V2 Meta-Aggregator transactions. |

---

## 2. Infrastructure & Routing Errors

These errors happen during the initial `GET /swap/v2/order` phase, before the user even signs a transaction.

| HTTP Status | Error / Code | Retryable? | Reason & Recommended Action |
| :--- | :--- | :---: | :--- |
| **429** | `RATE_LIMITED` | ✅ Yes | You have exceeded the RPS limit for your tier (e.g., 50 req/10s on the free tier). **Action:** Implement an exponential backoff with jitter: `delay = min(baseDelay * 2^attempt + random(0, jitter), maxDelay)`. |
| **400** | `TOKEN_NOT_TRADABLE` | ❌ No | *(Note: In V1 this is a 400, in V2 it currently manifests as an opaque 500).* The input or output mint address is invalid, frozen, or has absolutely zero liquidity. **Action:** Verify the mint addresses against the Jupiter Tokens API. |
| **200** | `Insufficient funds` | ❌ No | Returned inside the JSON `error` field of `/order`. The wallet address provided in the `taker` parameter does not hold enough of the `inputMint` to satisfy the requested `amountLamports`. **Action:** Use `/quote` instead of `/order` if you only want to preview the swap, or prompt the user to fund their wallet. |

---

## 3. Solana Program Errors (Positive Integers)

If an error code is a **positive integer** (e.g., `6001`), the transaction actually reached the Solana blockchain, but the Jupiter smart contract rejected it during execution.

| Code | Meaning | Retryable? | Reason & Recommended Action |
| :--- | :--- | :---: | :--- |
| **6000** | Invalid slippage | ❌ No | The slippage calculation failed on-chain. |
| **6001** | Slippage tolerance exceeded | ✅ Yes | The price of the assets changed unfavorably between the time the quote was generated and the time the transaction landed on-chain. The smart contract blocked the trade to protect the user from losing money. **Action:** Generate a new `/order`. If this happens frequently, increase the `slippageBps` parameter. |

---

## Implementation Best Practice

To handle these gracefully, your backend should map all errors into a unified pattern that tells the frontend whether it should automatically retry the API call, fetch a new quote, or show a fatal error to the user. 

```typescript
// Example Logic
const code = error?.code ?? error?.status ?? 'UNKNOWN';

// Rate limit
if (code === 429) return { retryable: true, action: "BACKOFF_AND_RETRY" };

// Execute routing errors (Negative codes)
if (typeof code === 'number' && code < 0) {
  const retryable = [-1, -1000, -1001, -1004, -2000, -2001, -2003, -2004].includes(code);
  return { retryable, action: retryable ? "FETCH_NEW_QUOTE" : "FATAL_ERROR" };
}

// On-chain contract errors (Positive codes)
if (typeof code === 'number' && code > 0) {
  // Slippage means we need a new quote
  if (code === 6001) return { retryable: true, action: "FETCH_NEW_QUOTE_WITH_HIGHER_SLIPPAGE" };
  return { retryable: false, action: "FATAL_ERROR" };
}
```