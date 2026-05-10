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

  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.JUPITER_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;

  const res = await fetch(u.toString(), { headers });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`JUPITER_ORDER_HTTP_${res.status}: ${t.slice(0, 400)}`);
  }
  return (await res.json()) as { transaction: string; requestId: string; outAmount: string; otherAmountThreshold?: string };
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
