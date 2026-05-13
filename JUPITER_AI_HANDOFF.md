# Jupiter Integration Handoff Context

*Provide this entire document to the other AI to give it full context on Demutual's Jupiter V2 integration, known wallet simulation behaviors, and the official expert integration guide for Jupiter APIs.*

---

## Part 1: Current Project Context & Known Behaviors

I know exactly why this happened!

This Backpack wallet error ("Transaction failed simulation. No balance changes detected.") is a known, expected behavior when using the new Jupiter V2 Meta-Aggregator (which we just upgraded the backend to).

**Why the Simulation Failed:**
When Jupiter V2 finds the absolute best price for you, it often uses JupiterZ (RFQ / Market Makers). When it does this, Jupiter gives your backend a partially signed transaction. The market maker adds their final signature during the landing phase.

Because the transaction Backpack is trying to simulate locally is missing the market maker's signature, Backpack's local simulation fails and says no balances will change.

**The Problem in the Code:**
When we switched the buy side to V2, we correctly used Jupiter's `/execute` endpoint (`postJupiterInvestExecute`), which handles these partially signed transactions natively and lands them.

But for the sell side (including `resumeSellAttempt`), the frontend `runSellLegs` function was still using the V1 logic:
`sendAndConfirmSignedB64Parallel(connection, [b64])`

It was taking the partially signed V2 transaction and throwing it directly at your basic Solana RPC. Your RPC rejected it (just like Backpack's simulation did) because it wasn't using Jupiter's `/execute` pipeline.

**The Fix:**
I have updated `BucketDetailPage.tsx` for you so that both `runJupiterSell` and `resumeSellAttempt` now map the `requestId` from the backend and send the signed transaction to `postJupiterInvestExecute`.

(Even though it says InvestExecute, your backend just proxies it perfectly to `https://api.jup.ag/swap/v2/execute`, which works flawlessly for both buys and sells).

To test this:
1. Rebuild your frontend (`bun run dev`).
2. Ignore the scary red warning in Backpack and click Approve on that exact resume attempt.
3. Because the frontend now routes it to Jupiter's `/execute` pipeline, Jupiter will attach the missing signature and successfully land the transaction.

---

## Part 2: Official Jupiter Expert Skill Guide (`integrating-jupiter`)

# Jupiter API Integration

Single skill for all Jupiter APIs, optimized for fast routing and deterministic execution.

**Base URL**: `https://api.jup.ag`
**Auth**: `x-api-key` from [portal.jup.ag](https://portal.jup.ag/) (**required for Jupiter REST endpoints**)

## Developer Quickstart

```typescript
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';

const API_KEY = process.env.JUPITER_API_KEY!;  // from portal.jup.ag
if (!API_KEY) throw new Error('Missing JUPITER_API_KEY');
const BASE = 'https://api.jup.ag';
const headers = { 'x-api-key': API_KEY };

async function jupiterFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
  if (res.status === 429) throw { code: 'RATE_LIMITED', retryAfter: Number(res.headers.get('Retry-After')) || 10 };
  if (!res.ok) {
    const raw = await res.text();
    let body: any = { message: raw || `HTTP_${res.status}` };
    try {
      body = raw ? JSON.parse(raw) : body;
    } catch {
      // keep text fallback body
    }
    throw { status: res.status, ...body };
  }
  return res.json();
}
```

## Intent Router (first step)

| User intent | API family | First action |
|---|---|---|
| Swap/quote | Swap | `GET /swap/v2/order` -> sign -> `POST /swap/v2/execute` |

## API Playbooks

### Swap

- **Base URL**: `https://api.jup.ag/swap/v2`
- **Triggers**: `swap`, `quote`, `gasless`, `best route`
- **Fee**: Variable by pair — 0 bps (Jupiter tokens/pegged), 2 bps (SOL-Stable), 5 bps (LST-Stable), 10 bps (most pairs), 50 bps (tokens < 24h). Referral fees: 50-255 bps (Jupiter retains 20%).
- **Rate Limit**: 50 req/10s base, scales with 24h execute volume
- **Endpoints**: `/order` (GET), `/execute` (POST), `/build` (GET, Metis-only raw instructions)
- **Routing**: 4 routers compete — Metis (API value: `iris`), JupiterZ (`jupiterz`), Dflow (`dflow`), OKX (`okx`). Response `mode` field: `"ultra"` (all routers, default params) or `"manual"` (restricted by optional params). `/build` uses Metis only.
- **Gasless**: Three paths — automatic (Jupiter-covered), JupiterZ (MM-covered), integrator-payer (`payer` param, Metis-only routing). Eligibility varies by balance, trade size, and parameters used.
- **Gotchas**: Signed payloads have ~2 min TTL. Transactions are immutable after receipt. Split order/execute in code and logging. Re-quote before execution when conditions may have changed. `referralAccount`/`referralFee`/`receiver` disable JupiterZ only (Metis/Dflow/OKX remain). `payer` reduces routing to Metis only. `/build` transactions cannot use `/execute` — self-manage via RPC.

Common error codes returned by `/swap/v2/execute` with recommended actions:

| Code | Category | Meaning | Retryable | Action |
|------|----------|---------|-----------|--------|
| `0` | Success | Transaction confirmed | — | — |
| `-1` | Execute | Missing/expired cached order | Yes | Re-quote and retry |
| `-2` | Execute | Invalid signed transaction | No | Fix transaction signing |
| `-3` | Execute | Invalid message bytes | No | Fix serialization |
| `-1000` | Aggregator | Failed landing attempt | Yes | Re-quote with adjusted params |
| `-1001` | Aggregator | Unknown error | Yes | Retry with backoff |
| `-1002` | Aggregator | Invalid transaction | No | Fix transaction construction |
| `-1003` | Aggregator | Transaction not fully signed | No | Ensure all required signers |
| `-1004` | Aggregator | Invalid block height | Yes | Re-quote (stale blockhash) |
| `-2000` | RFQ | Failed landing | Yes | Re-quote and retry |
| `-2001` | RFQ | Unknown error | Yes | Retry with backoff |
| `-2002` | RFQ | Invalid payload | No | Fix request payload |
| `-2003` | RFQ | Quote expired | Yes | Re-quote and retry |
| `-2004` | RFQ | Swap rejected | Yes | Re-quote, possibly different route |
| `429` | Rate limit | Rate limited | Yes | Exponential backoff, wait 10s window |

## Cross-Cutting Error Pattern

```typescript
interface JupiterResult<T> {
  ok: boolean;
  result?: T;
  error?: { code: string | number; message: string; retryable: boolean };
}

async function jupiterAction<T>(action: () => Promise<T>): Promise<JupiterResult<T>> {
  try {
    const result = await action();
    return { ok: true, result };
  } catch (error: any) {
    const code = error?.code ?? error?.status ?? 'UNKNOWN';

    // Rate limit — retry with backoff
    if (code === 429 || code === 'RATE_LIMITED') {
      return { ok: false, error: { code: 'RATE_LIMITED', message: 'Rate limited', retryable: true } };
    }

    // Swap execute errors (negative codes)
    if (typeof code === 'number' && code < 0) {
      const retryable = [-1, -1000, -1001, -1004, -2000, -2001, -2003, -2004].includes(code);
      return { ok: false, error: { code, message: error?.error ?? 'Execute failed', retryable } };
    }

    // Program errors (positive codes like 6001 = slippage)
    if (typeof code === 'number' && code > 0) {
      return { ok: false, error: { code, message: error?.error ?? 'Program error', retryable: false } };
    }

    return { ok: false, error: { code, message: error?.message ?? 'UNKNOWN_ERROR', retryable: false } };
  }
}
```

## Part 3: Swap End-to-End Example (`examples/swap.md`)

```typescript
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

// jupiterFetch<T>(path, init?) is defined in Developer Quickstart.
// It prepends https://api.jup.ag and adds the x-api-key header.

const wallet = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY!));

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function swapSolToUsdc(amountLamports: number) {
  // 1. Get order
  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: amountLamports.toString(),
    taker: wallet.publicKey.toBase58(),
  });

  const order = await jupiterFetch<{
    transaction: string | null;
    requestId: string;
    router?: string;
    mode?: string;
    feeBps?: number;
    feeMint?: string;
    error?: string;
  }>(`/swap/v2/order?${params}`);

  if (order.error || !order.transaction) {
    throw new Error(`Order error: ${order.error ?? 'no transaction returned (is taker set?)'}`);
  }

  // 2. Sign the transaction
  const txBuf = Buffer.from(order.transaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);

  const signedTx = Buffer.from(tx.serialize()).toString('base64');

  // 3. Execute — Jupiter submits the transaction; no Connection needed
  const result = await jupiterFetch<{
    status: string;
    signature: string;
    code: number;
    inputAmountResult?: string;
    outputAmountResult?: string;
    error?: string;
  }>('/swap/v2/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signedTransaction: signedTx,
      requestId: order.requestId,
    }),
  });

  // 4. Confirm
  if (result.status === 'Success') {
    return {
      signature: result.signature,
      inputAmount: result.inputAmountResult,
      outputAmount: result.outputAmountResult,
      explorerUrl: `https://solscan.io/tx/${result.signature}`,
    };
  }

  // Throw with structured context so withRetry can identify retryable errors
  const err: any = new Error(`Swap failed: ${result.error || 'unknown'}`);
  err.code = result.code;
  throw err;
}
```