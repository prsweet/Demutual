/**
 * Jupiter Swap API — builds unsigned VersionedTransactions for the investor to sign.
 * @see https://dev.jup.ag/docs/swap-api/get-quote
 *
 * Quotes target mainnet-style mints; use mainnet RPC in production. Devnet + mainnet Jupiter
 * routes are often incompatible — expect quote failures when mixing.
 */

const DEFAULT_HOST = "https://api.jup.ag";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Cached at module load — avoids process.env read + .trim() on every API call. */
const JUPITER_HOST = (process.env.JUPITER_API_HOST ?? DEFAULT_HOST).replace(/\/+$/, "");
const JUPITER_API_KEY = process.env.JUPITER_API_KEY?.trim() || null;

function jupiterHeaders(contentType?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (contentType) h["Content-Type"] = contentType;
  if (JUPITER_API_KEY) h["x-api-key"] = JUPITER_API_KEY;
  return h;
}

/** Exponential backoff retry with jitter. Retries on transient HTTP errors and 429s. */
async function retryFetch<T>(
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; baseDelayMs?: number }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 400;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isRateLimit = msg.includes("429") || msg.includes("RATE");
      const isTransient =
        isRateLimit ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("JUPITER_QUOTE_HTTP_5") ||
        msg.includes("JUPITER_ORDER_HTTP_5") ||
        msg.includes("JUPITER_SWAP_HTTP_5");

      if (!isTransient || attempt === maxRetries) throw e;

      // Exponential backoff with ±25% jitter
      const delayMs = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs * 0.5;
      await new Promise((r) => setTimeout(r, Math.floor(delayMs)));
    }
  }
  // Unreachable, but satisfies TS
  throw new Error("JUPITER_RETRY_EXHAUSTED");
}

export type JupiterQuoteResponse = Record<string, unknown>;

export async function jupiterGetQuote(params: {
  inputMint: string;
  outputMint: string;
  /** Lamports/base-units. For ExactIn this is input amount; for ExactOut this is required output amount. */
  amountLamports: number;
  slippageBps: number;
  swapMode?: "ExactIn" | "ExactOut";
}): Promise<JupiterQuoteResponse> {
  return retryFetch(async () => {
    const u = new URL(`${JUPITER_HOST}/swap/v1/quote`);
    u.searchParams.set("inputMint", params.inputMint);
    u.searchParams.set("outputMint", params.outputMint);
    u.searchParams.set("amount", String(params.amountLamports));
    u.searchParams.set("slippageBps", String(params.slippageBps));
    if (params.swapMode) u.searchParams.set("swapMode", params.swapMode);

    const res = await fetch(u.toString(), { headers: jupiterHeaders() });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`JUPITER_QUOTE_HTTP_${res.status}: ${t.slice(0, 400)}`);
    }
    return (await res.json()) as JupiterQuoteResponse;
  });
}

export async function jupiterPostSwap(params: {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
}): Promise<{ swapTransaction: string }> {
  return retryFetch(async () => {
    const u = `${JUPITER_HOST}/swap/v1/swap`;

    const body = {
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto"
    };

    const res = await fetch(u, {
      method: "POST",
      headers: jupiterHeaders("application/json"),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`JUPITER_SWAP_HTTP_${res.status}: ${t.slice(0, 400)}`);
    }
    const j = (await res.json()) as { swapTransaction?: string };
    if (!j.swapTransaction || typeof j.swapTransaction !== "string") {
      throw new Error("JUPITER_SWAP_NO_TX");
    }
    return { swapTransaction: j.swapTransaction };
  });
}

export async function jupiterOrder(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
  swapMode?: "ExactIn" | "ExactOut";
  taker: string;
  previewMode?: boolean;
}): Promise<{ transaction: string; requestId: string; outAmount: string; otherAmountThreshold?: string }> {
  const u = new URL(`${JUPITER_HOST}/swap/v2/order`);
  u.searchParams.set("inputMint", params.inputMint);
  u.searchParams.set("outputMint", params.outputMint);
  u.searchParams.set("amount", String(params.amountLamports));
  u.searchParams.set("slippageBps", String(params.slippageBps));
  if (params.swapMode) u.searchParams.set("swapMode", params.swapMode);
  u.searchParams.set("taker", params.taker);
  
  if (params.swapMode === "ExactOut") {
    u.searchParams.set("payer", params.taker);
  }

const res = await fetch(u.toString(), { headers: jupiterHeaders() });
   if (!res.ok) {
     const t = await res.text().catch(() => "");
     throw new Error(`JUPITER_ORDER_HTTP_${res.status}: ${t.slice(0, 400)}`);
   }
  const data = (await res.json()) as {
    transaction?: unknown;
    requestId?: unknown;
    outAmount?: unknown;
    otherAmountThreshold?: unknown;
    error?: unknown;
    router?: unknown;
  };
  const tx = typeof data.transaction === "string" ? data.transaction : "";
  const reqId = typeof data.requestId === "string" ? data.requestId : "";
  
  if (!tx || !reqId) {
    // If previewMode is true, we don't care if Jupiter couldn't build the transaction
    // due to insufficient funds; we just want the outAmount.
    if (params.previewMode) {
      return {
        transaction: "",
        requestId: "",
        outAmount: typeof data.outAmount === "string" ? data.outAmount : "0",
        ...(typeof data.otherAmountThreshold === "string" ? { otherAmountThreshold: data.otherAmountThreshold } : {})
      };
    }

    const jupErr = typeof data.error === "string" ? data.error : "";
    const lower = jupErr.toLowerCase();
    if (lower.includes("insufficient")) {
      throw new Error(
        `JUPITER_TAKER_INSUFFICIENT_FUNDS: ${params.inputMint.slice(0, 6)}… (taker wallet doesn't hold enough input asset for this ${params.swapMode ?? "ExactIn"} quote)`
      );
    }
    throw new Error(
      `JUPITER_ORDER_NO_TX: swapMode=${params.swapMode ?? "ExactIn"} router=${typeof data.router === "string" ? data.router : "?"}${jupErr ? ` · jupiter: ${jupErr}` : ""}`
    );
  }
  return {
    transaction: tx,
    requestId: reqId,
    outAmount: typeof data.outAmount === "string" ? data.outAmount : "0",
    ...(typeof data.otherAmountThreshold === "string" ? { otherAmountThreshold: data.otherAmountThreshold } : {})
  };
}

export async function jupiterExecute(params: {
  signedTransaction: string;
  requestId: string;
  lastValidBlockHeight?: number;
}): Promise<{
  status: "Success" | "Failed";
  signature: string;
  code: number;
  inputAmountResult: string;
  outputAmountResult: string;
  error?: string;
}> {
  const u = `${JUPITER_HOST}/swap/v2/execute`;

  const res = await fetch(u, {
    method: "POST",
    headers: jupiterHeaders("application/json"),
    body: JSON.stringify({
      signedTransaction: params.signedTransaction,
      requestId: params.requestId,
      ...(typeof params.lastValidBlockHeight === "number"
        ? { lastValidBlockHeight: params.lastValidBlockHeight }
        : {})
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`JUPITER_EXECUTE_HTTP_${res.status}: ${t.slice(0, 400)}`);
  }
  return (await res.json()) as {
    status: "Success" | "Failed";
    signature: string;
    code: number;
    inputAmountResult: string;
    outputAmountResult: string;
    error?: string;
  };
}
