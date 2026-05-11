/**
 * Jupiter Swap API — builds unsigned VersionedTransactions for the investor to sign.
 * @see https://dev.jup.ag/docs/swap-api/get-quote
 *
 * Quotes target mainnet-style mints; use mainnet RPC in production. Devnet + mainnet Jupiter
 * routes are often incompatible — expect quote failures when mixing.
 */

const DEFAULT_HOST = "https://api.jup.ag";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

function jupiterHost(): string {
  return (process.env.JUPITER_API_HOST ?? DEFAULT_HOST).replace(/\/+$/, "");
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
  const u = new URL(`${jupiterHost()}/swap/v1/quote`);
  u.searchParams.set("inputMint", params.inputMint);
  u.searchParams.set("outputMint", params.outputMint);
  u.searchParams.set("amount", String(params.amountLamports));
  u.searchParams.set("slippageBps", String(params.slippageBps));
  if (params.swapMode) u.searchParams.set("swapMode", params.swapMode);

  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.JUPITER_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;

  const res = await fetch(u.toString(), { headers });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`JUPITER_QUOTE_HTTP_${res.status}: ${t.slice(0, 400)}`);
  }
  return (await res.json()) as JupiterQuoteResponse;
}

export async function jupiterPostSwap(params: {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
}): Promise<{ swapTransaction: string }> {
  const u = `${jupiterHost()}/swap/v1/swap`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  const key = process.env.JUPITER_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;

  const body = {
    quoteResponse: params.quoteResponse,
    userPublicKey: params.userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto"
  };

  const res = await fetch(u, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`JUPITER_SWAP_HTTP_${res.status}: ${t.slice(0, 400)}`);
  }
  const j = (await res.json()) as { swapTransaction?: string };
  if (!j.swapTransaction || typeof j.swapTransaction !== "string") {
    throw new Error("JUPITER_SWAP_NO_TX");
  }
  return { swapTransaction: j.swapTransaction };
}

/**
 * V2 `/swap/v2/order` returns an opaque 500 `{"error":"Something unexpected occurred"}`
 * for invalid or untradable mints. V1 `/swap/v1/quote` returns a clean 400 with
 * `{"errorCode":"TOKEN_NOT_TRADABLE", ...}` for the same input. Probe V1 to recover
 * the real error so callers and logs get something actionable.
 *
 * Returns null if V1 succeeds (V2 failure was transient) or fails opaquely (no
 * structured error to surface) — caller should then fall back to the raw V2 text.
 */
async function probeV1Diagnosis(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
  swapMode?: "ExactIn" | "ExactOut";
}): Promise<string | null> {
  try {
    const u = new URL(`${jupiterHost()}/swap/v1/quote`);
    u.searchParams.set("inputMint", params.inputMint);
    u.searchParams.set("outputMint", params.outputMint);
    u.searchParams.set("amount", String(params.amountLamports));
    u.searchParams.set("slippageBps", String(params.slippageBps));
    if (params.swapMode) u.searchParams.set("swapMode", params.swapMode);

    const headers: Record<string, string> = { Accept: "application/json" };
    const key = process.env.JUPITER_API_KEY?.trim();
    if (key) headers["x-api-key"] = key;

    const res = await fetch(u.toString(), { headers });
    if (res.ok) return null;
    const raw = await res.text().catch(() => "");
    let body: { error?: string; errorCode?: string } | null = null;
    try {
      body = raw ? (JSON.parse(raw) as { error?: string; errorCode?: string }) : null;
    } catch {
      body = null;
    }
    if (body?.errorCode) {
      return body.error ? `${body.errorCode}: ${body.error}` : body.errorCode;
    }
    if (body?.error) return body.error;
    return null;
  } catch {
    return null;
  }
}

export async function jupiterOrder(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
  swapMode?: "ExactIn" | "ExactOut";
  taker: string;
}): Promise<{ transaction: string; requestId: string; outAmount: string; otherAmountThreshold?: string }> {
  const u = new URL(`${jupiterHost()}/swap/v2/order`);
  u.searchParams.set("inputMint", params.inputMint);
  u.searchParams.set("outputMint", params.outputMint);
  u.searchParams.set("amount", String(params.amountLamports));
  u.searchParams.set("slippageBps", String(params.slippageBps));
  if (params.swapMode) u.searchParams.set("swapMode", params.swapMode);
  u.searchParams.set("taker", params.taker);
  // ExactOut quotes have historically had the highest rate of "winning quote has no
  // transaction" responses — the JupiterZ / RFQ router accepts the quote but can't
  // build the swap. Setting `payer` forces the routing pool to Metis-only (per Jupiter
  // gasless docs), which reliably returns a signable transaction. The taker still pays;
  // we just lock the router selection.
  if (params.swapMode === "ExactOut") {
    u.searchParams.set("payer", params.taker);
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.JUPITER_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;

  const res = await fetch(u.toString(), { headers });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 500) {
      const diag = await probeV1Diagnosis({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amountLamports: params.amountLamports,
        slippageBps: params.slippageBps,
        swapMode: params.swapMode
      });
      if (diag) {
        throw new Error(`JUPITER_ORDER_${diag.slice(0, 300)}`);
      }
    }
    throw new Error(`JUPITER_ORDER_HTTP_${res.status}: ${t.slice(0, 400)}`);
  }
  // Jupiter v2 /order can return 200 OK with no `transaction` field — typically when the
  // router built a quote but the taker's wallet doesn't actually hold the input asset
  // ("Insufficient funds" on ExactOut), or when JupiterZ/RFQ accepted the quote but
  // can't commit a swap. Distinguish the two so the FE shows the right friendly message.
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
  const u = `${jupiterHost()}/swap/v2/execute`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  const key = process.env.JUPITER_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;

  const res = await fetch(u, {
    method: "POST",
    headers,
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
