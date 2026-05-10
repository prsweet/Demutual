import axios, { type AxiosInstance } from "axios";
import type {
  ApiResponse,
  ApiBucket,
  BucketsPage,
  MeUser,
  CatalogAsset,
  BucketAssetWeight,
  RootApiPayload,
  ServerPublicConfig,
  JupiterInvestPlan,
  DepositsPage,
  MyPosition
} from "./types";

const JWT_KEY = "demutual_jwt";

export function getApiBaseUrl(): string {
  const fromMeta =
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.BUN_PUBLIC_API_URL;
  return (fromMeta || "http://localhost:3000").replace(/\/$/, "");
}

export const api: AxiosInstance = axios.create({
  baseURL: getApiBaseUrl(),
  headers: { "Content-Type": "application/json" },
  validateStatus: () => true
});

api.interceptors.request.use((config) => {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem(JWT_KEY) : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function getStoredJwt(): string | null {
  return localStorage.getItem(JWT_KEY);
}

export function setStoredJwt(token: string | null): void {
  if (token) localStorage.setItem(JWT_KEY, token);
  else localStorage.removeItem(JWT_KEY);
}

export async function fetchNonce(address: string): Promise<{ nonce: string; message: string; expiresAt: string }> {
  const res = await api.get<ApiResponse<{ nonce: string; message: string; expiresAt: string }>>("/auth/nonce", {
    params: { address }
  });
  const body = res.data;
  if (!body.success || !body.data) throw new Error(body.error || "NONCE_FAILED");
  return body.data;
}

export async function walletLogin(body: {
  address: string;
  details: { nonce: string; message: string };
  signature: string;
  username?: string;
}): Promise<string> {
  const res = await api.post<ApiResponse<{ token: string }>>("/auth/wallet-login", body);
  const out = res.data;
  if (!out.success || !out.data?.token) throw new Error(out.error || "LOGIN_FAILED");
  return out.data.token;
}

export async function fetchMe(): Promise<MeUser> {
  const res = await api.get<ApiResponse<MeUser>>("/users/me");
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "ME_FAILED");
  return out.data;
}

export async function fetchPublishedBuckets(params?: { limit?: number; offset?: number }): Promise<BucketsPage> {
  const res = await api.get<ApiResponse<BucketsPage>>("/buckets", { params });
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "BUCKETS_FAILED");
  return out.data;
}

export async function createBucketApi(payload: {
  name: string;
  estimatedApy: number;
  metaData?: { description?: string };
}): Promise<ApiBucket> {
  const res = await api.post<ApiResponse<ApiBucket>>("/buckets", payload);
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "CREATE_BUCKET_FAILED");
  return out.data;
}

/** Public — no auth */
export async function fetchCatalog(): Promise<CatalogAsset[]> {
  const res = await api.get<ApiResponse<CatalogAsset[]>>("/assets/catalog");
  const out = res.data;
  if (!out.success || !Array.isArray(out.data)) throw new Error(out.error || "CATALOG_FAILED");
  return out.data;
}

export async function upsertAssetApi(body: {
  id: string;
  name: string;
  symbol: string;
  iconUrl: string;
  decimals?: number;
}): Promise<unknown> {
  const res = await api.post<ApiResponse<unknown>>("/assets", body);
  const out = res.data;
  if (!out.success) throw new Error(out.error || "ASSET_UPSERT_FAILED");
  return out.data;
}

export async function setBucketAssetsApi(bucketId: string, assets: BucketAssetWeight[]): Promise<ApiBucket> {
  const res = await api.post<ApiResponse<ApiBucket>>(`/buckets/${encodeURIComponent(bucketId)}/creator/assets`, {
    assets
  });
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "BUCKET_ASSETS_FAILED");
  return out.data;
}

export async function publishBucketApi(bucketId: string): Promise<ApiBucket> {
  const res = await api.post<ApiResponse<ApiBucket>>(
    `/buckets/${encodeURIComponent(bucketId)}/creator/publish`,
    {}
  );
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "PUBLISH_FAILED");
  return out.data;
}

export async function fetchServerPublicConfig(): Promise<ServerPublicConfig> {
  const res = await api.get<ApiResponse<RootApiPayload>>("/");
  const out = res.data;
  if (!out.success || !out.data?.config) throw new Error(out.error || "SERVER_INFO_FAILED");
  return out.data.config;
}

export async function fetchBucketById(id: string): Promise<ApiBucket> {
  const res = await api.get<ApiResponse<ApiBucket>>(`/buckets/${encodeURIComponent(id)}`);
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "BUCKET_NOT_FOUND");
  return out.data;
}

export async function fetchCreatorBuckets(
  creatorId: string,
  params?: { status?: "PUBLISHED" | "DRAFT"; limit?: number; offset?: number }
): Promise<BucketsPage> {
  const res = await api.get<ApiResponse<BucketsPage>>("/buckets", {
    params: { creatorId, ...params }
  });
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "BUCKETS_FAILED");
  return out.data;
}

export async function fetchMyDeposits(params?: { limit?: number; offset?: number }): Promise<DepositsPage> {
  const res = await api.get<ApiResponse<DepositsPage>>("/users/me/deposits", { params });
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "DEPOSITS_FAILED");
  return out.data;
}

export async function fetchMyPosition(bucketId: string): Promise<MyPosition> {
  const res = await api.get<ApiResponse<MyPosition>>(`/buckets/${encodeURIComponent(bucketId)}/my-position`);
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "POSITION_FAILED");
  return out.data;
}

export async function postLedgerWithdraw(bucketId: string, amount: number): Promise<unknown> {
  const res = await api.post<ApiResponse<unknown>>(`/buckets/${encodeURIComponent(bucketId)}/withdraw`, {
    amount
  });
  const out = res.data;
  if (!out.success) throw new Error(out.error || "WITHDRAW_FAILED");
  return out.data;
}

export async function postTreasuryInvest(
  bucketId: string,
  body: { amount: number; transactionSignature: string }
): Promise<unknown> {
  const res = await api.post<ApiResponse<unknown>>(`/buckets/${encodeURIComponent(bucketId)}/invest`, body);
  const out = res.data;
  if (!out.success) throw new Error(out.error || "INVEST_FAILED");
  return out.data;
}

export async function postJupiterInvestPlan(
  bucketId: string,
  body: { solAmount: number; slippageBps?: number }
): Promise<JupiterInvestPlan> {
  const res = await api.post<ApiResponse<JupiterInvestPlan>>(
    `/buckets/${encodeURIComponent(bucketId)}/invest/jupiter-plan`,
    body
  );
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "JUPITER_PLAN_FAILED");
  return out.data;
}

export async function postJupiterInvestComplete(
  bucketId: string,
  body: {
    solAmount: number;
    transactionSignatures: string[];
    feeTransferSignature?: string;
  }
): Promise<unknown> {
  const res = await api.post<ApiResponse<unknown>>(
    `/buckets/${encodeURIComponent(bucketId)}/invest/jupiter-complete`,
    body
  );
  const out = res.data;
  if (!out.success) throw new Error(out.error || "JUPITER_COMPLETE_FAILED");
  return out.data;
}

export async function postJupiterLegOrder(
  bucketId: string,
  body: { outputMint: string; lamports: number; slippageBps?: number }
): Promise<{
  outputMint: string;
  inputLamports: number;
  slippageBps: number;
  swapTransactionBase64: string;
  requestId: string;
  expectedOutAmount: string;
  minimumOutAmount: string;
}> {
  const res = await api.post<
    ApiResponse<{
      outputMint: string;
      inputLamports: number;
      slippageBps: number;
      swapTransactionBase64: string;
      requestId: string;
      expectedOutAmount: string;
      minimumOutAmount: string;
    }>
  >(`/buckets/${encodeURIComponent(bucketId)}/invest/jupiter-leg-order`, body);
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "JUPITER_LEG_ORDER_FAILED");
  return out.data;
}

export async function postJupiterInvestExecute(
  bucketId: string,
  body: { signedTransaction: string; requestId: string; lastValidBlockHeight?: number }
): Promise<{
  status: "Success" | "Failed";
  signature: string;
  code: number;
  inputAmountResult: string;
  outputAmountResult: string;
  error?: string;
}> {
  const res = await api.post<
    ApiResponse<{
      status: "Success" | "Failed";
      signature: string;
      code: number;
      inputAmountResult: string;
      outputAmountResult: string;
      error?: string;
    }>
  >(`/buckets/${encodeURIComponent(bucketId)}/invest/jupiter-execute`, body);
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "JUPITER_EXECUTE_FAILED");
  return out.data;
}

export async function postJupiterSellPlan(
  bucketId: string,
  body: { solAmount: number; slippageBps?: number }
): Promise<JupiterInvestPlan> {
  const res = await api.post<ApiResponse<JupiterInvestPlan>>(
    `/buckets/${encodeURIComponent(bucketId)}/sell/jupiter-plan`,
    body
  );
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "JUPITER_SELL_PLAN_FAILED");
  return out.data;
}

export async function postJupiterSellComplete(
  bucketId: string,
  body: {
    solAmount: number;
    transactionSignatures: string[];
    feeTransferSignature?: string;
  }
): Promise<unknown> {
  const res = await api.post<ApiResponse<unknown>>(
    `/buckets/${encodeURIComponent(bucketId)}/sell/jupiter-complete`,
    body
  );
  const out = res.data;
  if (!out.success) throw new Error(out.error || "JUPITER_SELL_COMPLETE_FAILED");
  return out.data;
}

export async function requestDevnetAirdrop(address: string, amount = 1): Promise<{ signature: string }> {
  const res = await api.get<ApiResponse<{ signature: string }>>("/devnet/airdrop", {
    params: { address, amount }
  });
  const out = res.data;
  if (!out.success || !out.data) throw new Error(out.error || "AIRDROP_FAILED");
  return out.data;
}
