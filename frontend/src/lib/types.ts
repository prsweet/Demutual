/** Mirrors server `response()` shape from FRONTEND_API_GUIDE.md */
export type ApiResponse<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: string };

export type MeUser = {
  id: string;
  username: string;
  walletAddress: string;
  createdAt: string;
  counts?: { buckets: number; deposits: number; withdrawals: number };
};

export type ApiBucket = {
  id: string;
  name: string;
  tvl: string | number;
  type: "PUBLISHED" | "DRAFT";
  version: number;
  creatorId: string;
  estimated_apy: string | number;
  apy?: string | number | null;
  metaData?: { description?: string } | null;
  researchDoc?: string | null;
  listing?: { id: string; assetId: string; percentage: string | number; asset?: unknown }[];
  creator?: { id: string; username: string; walletAddress: string };
  _count?: { deposits: number; listing: number };
};

export type BucketsPage = {
  data: ApiBucket[];
  total: number;
  limit: number;
  offset: number;
};

/** Mirrors server `CatalogAsset` from tokenCatalog.ts — returned by GET /assets/catalog */
export type CatalogCategory = "stablecoin" | "yield" | "token" | "nft";

export type CatalogAsset = {
  id: string;
  name: string;
  symbol: string;
  iconUrl: string;
  decimals: number;
  category: CatalogCategory;
};

export const CATALOG_CATEGORY_ORDER: CatalogCategory[] = ["stablecoin", "yield", "token", "nft"];

export const CATALOG_CATEGORY_LABEL: Record<CatalogCategory, string> = {
  stablecoin: "Stablecoins & cash-like",
  yield: "Yield & liquid staking (LSTs)",
  token: "Tokens & DeFi",
  nft: "NFT & collectible SPL (0-supply / project coins)"
};

export type BucketAssetWeight = { assetId: string; percentage: number };

/** From GET / → data.config (publicServiceInfo) */
export type ServerPublicConfig = {
  network: "mainnet" | "devnet";
  investTreasuryPubkey: string | null;
  treasurySolInvestConfigured?: boolean;
  treasuryInvestEnabled: boolean;
  solanaRpcConfigured: boolean;
  jupiterApiHost: string;
  jupiterEnabled: boolean;
  platformFeeBps: number;
  platformFeeWalletPubkey: string | null;
  creatorFeeBps: number;
};

export type RootApiPayload = {
  service: string;
  health: string;
  routes: unknown;
  config: ServerPublicConfig;
};

export type JupiterPlanLeg = {
  kind: string;
  symbol?: string;
  swapTransactionBase64?: string;
  requestId?: string;
  inputLamports?: number;
  expectedOutAmount?: string;
  minimumOutAmount?: string;
  outputMint?: string;
  percentage?: number;
  inputMint?: string;
  estInputAmount?: string;
  outputLamports?: number;
  reason?: string;
};

export type FeeSplit = {
  recipient: "platform" | "creator";
  toPubkey: string;
  lamports: number;
  bps: number;
};

export type FeeTransferPlan = {
  totalLamports: number;
  splits: FeeSplit[];
  reason?: string;
};

export type JupiterInvestPlan = {
  legs: JupiterPlanLeg[];
  feeTransfer: FeeTransferPlan | null;
  feeTransferSkippedReason?: string | null;
  slippageBps?: number;
  grossSol?: number;
  userWallet?: string;
  investorRequirements?: null | {
    rentPerAtaLamports: number;
    missingAtas: { mint: string; ata: string }[];
    estimatedRentLamports: number;
  };
  note?: string;
};

export type DepositRow = {
  id: string;
  bucketId: string;
  userId: string;
  amount: string | number;
  feeCreator?: string | number;
  feePlatform?: string | number;
  transactionSignature?: string | null;
  createdAt: string;
  bucket?: { id: string; name: string; type: string; tvl: string | number; version: number };
};

export type DepositsPage = {
  data: DepositRow[];
  total: number;
  limit: number;
  offset: number;
};

export type MyPosition = {
  bucketId: string;
  bucketName: string;
  bucketType: string;
  totalDeposited: number;
  totalWithdrawn: number;
  availableToWithdraw: number;
};

