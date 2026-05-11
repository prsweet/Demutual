# Demutual Frontend API Integration Guide

This guide is intended for the frontend AI/development team to quickly understand the backend architecture, API endpoints, data structures, and how to interface with the Demutual backend.

## 1. Overview & Base URL

The API is served by a backend application (Elysia.js/Bun).
- **Base API URL:** Configured via the `VITE_API_URL` environment variable (defaults to `http://localhost:3000`).
- **Data format:** JSON. Ensure you send `Content-Type: application/json` where applicable.

## 2. Global Response Structure

All endpoints return a standardized wrapper object:

```typescript
type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  error: string | null; // e.g., "UNAUTHORIZED", "INVALID_REQUEST", etc.
};
```

**⚠️ Important Note on `GET /buckets`:**
The `GET /buckets` endpoint returns a paginated structure nested inside the standard response's `data` field. The correct way to read the array of buckets is:

```typescript
// For GET /buckets
const res = await fetch("/buckets");
const json = await res.json();

if (json.success) {
  // json.data is a pagination object: { data: [...], total: number, limit: number, offset: number }
  const bucketsArray = json.data.data;
  const totalCount = json.data.total;
}
```
Other endpoints (like `GET /buckets/:id` or `GET /assets`) generally return their primary payload directly in `json.data` without the pagination wrapper.

## 3. Authentication

Authentication uses Wallet Signatures (SIWS-style) resulting in a JWT.
Protected routes require the `Authorization` header.

```http
Authorization: Bearer <your_jwt_token_here>
```

### Auth Flow
1. **Get Nonce:** `GET /auth/nonce?address=<wallet_public_key>`
   - Returns `{ nonce, message }`
2. **Sign Message:** The user signs the `message` with their wallet.
3. **Login:** `POST /auth/wallet-login`
   - Body: `{ address: "...", details: { nonce, message }, signature: "...", username: "Optional" }`
   - Returns: `{ token: "..." }` (Save this JWT).

## 4. API Endpoints Reference

### User Data
- **`GET /users/me`**: Current user details and counts. Requires Auth.
- **`GET /users/me/deposits`**: User's deposit history with bucket summaries. Requires Auth.

### Assets & Catalog
- **`GET /assets/catalog`**: Public curated token list (stablecoins, LSTs, tokens, NFTs). No Auth required.
- **`GET /assets`**: List all manually registered assets. Requires Auth.
- **`POST /assets`**: Upsert a custom asset by mint address. Requires Auth.

### Buckets (Marketplace & Creator)
- **`GET /buckets`**: List published buckets.
  - Query params: `?creatorId=...&status=DRAFT` for fetching specific creator drafts.
  - **Returns:** `{ data: { data: Bucket[], total, limit, offset } }`
- **`GET /buckets/:id`**: Get bucket details and its listings.
- **`GET /buckets/:id/my-position`**: Get user's deposit/withdrawal balance in this bucket. Requires Auth.
- **`POST /buckets`**: Create a new draft bucket. Requires Auth.
- **`POST /buckets/:id/creator/assets`**: Set the asset allocations for a draft bucket. Must equal 100%. Creator only.
- **`POST /buckets/:id/creator/publish`**: Publish a draft bucket. Creator only.
- **`POST /buckets/:id/creator/versions`**: Fork a new draft version from an existing bucket. Creator only.

### Investment & Withdraw Flows

There are two primary modes depending on the server network environment (`devnet` vs `mainnet`).

#### Devnet Mode (Direct Treasury Transfer)
- **`POST /buckets/:id/invest`**: Books a deposit. The user must first execute an on-chain transfer of SOL to the protocol's devnet treasury. Send the `transactionSignature` to this endpoint for the backend to verify the transfer and record TVL.

#### Mainnet Mode (Jupiter Swap Integration)
In mainnet mode, users do not send SOL to a protocol treasury. Instead, they buy the basket assets directly using Jupiter, and the tokens land in their own wallet.
- **`POST /buckets/:id/invest/jupiter-plan`**: Provide `solAmount`. Returns base64-encoded Jupiter buy swap transactions + optional fee transfers.
- **`POST /buckets/:id/invest/jupiter-complete`**: Provide the signatures of the confirmed Jupiter swaps. Records the TVL.
- **`POST /buckets/:id/sell/jupiter-plan`**: Returns base64 Jupiter ExactOut sell swap transactions to convert assets back to SOL.
- **`POST /buckets/:id/sell/jupiter-complete`**: Provide signatures to record the withdrawal.

#### Ledger-only Withdraw (Any network)
- **`POST /buckets/:id/withdraw`**: Ledger-only withdrawal (updates Demutual DB TVL). It does not execute an on-chain payout.

### Devnet Helpers
- **`GET /devnet/airdrop?address=<wallet>&amount=1`**: Devnet-only SOL faucet for testing.

## 5. Typical Data Types

**Bucket Object:**
```typescript
type Bucket = {
  id: string;
  name: string;
  tvl: number;
  type: "PUBLISHED" | "DRAFT";
  version: number;
  creatorId: string;
  estimated_apy: number;
  // Included relations:
  listing?: Listing[];
  creator?: { id: string, username: string, walletAddress: string };
  _count?: { deposits: number, listing: number };
}
```

**Listing Object:**
```typescript
type Listing = {
  id: string;
  bucketId: string;
  assetId: string;
  percentage: number; // e.g. 50.5 for 50.5%
  asset?: Asset;
}
```

**Asset Object:**
```typescript
type Asset = {
  id: string; // The Solana Mint Address
  name: string;
  symbol: string;
  iconUrl: string;
  decimals: number;
}
```


have to check it later

curl -X POST
  http://localhost:3000/assets/sync-catalog \
    -H "Authorization: Bearer <your_jwt>"

  Response will tell you how many came from Jupiter vs
   fallback.