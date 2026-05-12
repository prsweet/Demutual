# Demutual 🪙
**Decentralized Mutual Funds on Solana**

> *Technology reaches mainstream adoption when infrastructure becomes abstracted behind familiar user experiences.*

Demutual is a decentralized wealth management protocol that abstracts away the complexities of DeFi. It empowers creators to launch versioned, mutual-fund-style portfolios ("buckets") and enables mainstream investors to gain diversified exposure to Solana assets in a single, seamless transaction.

---

## 🛑 The Problem

Most mainstream users entering the Solana ecosystem knowingly or unknowingly do not care about RPCs, validator economics, SPL standards, or DeFi composability. They ask simple questions:
* *"Where do I put my money?"*
* *"Is it diversified?"*
* *"Does it feel safer than buying random coins?"*

The current Solana ecosystem is highly optimized for degens, yield farmers, and MEV searchers. New users are overwhelmed by bridges, LP positions, liquidation risks, and hundreds of fragmented tokens. 

## 💡 The Solution

Demutual brings the traditional **Mutual Fund** experience on-chain, but with the transparency and speed of Solana.

1. **Creators** build "Buckets" (e.g., "Solana Blue Chip Index", "Liquid Staking Basket") by assigning percentage weights to curated, verified assets.
2. **Investors** deposit native SOL into the bucket in a single click. 
3. **The Engine** automatically calculates the mathematical splits, applies a transparent 0.1% management fee, and utilizes Jupiter's V2 Meta-Aggregator to execute multiple parallel swaps, dropping the actual basket tokens directly into the user's non-custodial wallet.

---

## 🛠️ Core Features

* **Draft-to-Publish Workflow:** Creators can design and iterate on their portfolio allocations before publishing them to the global marketplace.
* **Non-Custodial Architecture:** Demutual never holds user funds on Mainnet. The platform acts strictly as an execution layer. Tokens land directly in the investor's wallet.
* **Pre-Transaction Transparency:** Before a wallet popup ever appears, Demutual displays a comprehensive "Plan Preview" calculating exact output tokens, maximum slippage, network fees, and platform fees.
* **Partial-Fill Resumability (Option B):** Multi-leg transactions are rarely atomic. If a user buys a 5-token basket and 1 leg fails due to sudden slippage, Demutual records a `PARTIAL` fill. The user can safely resume and re-quote *only* the missing leg later from a clean UI banner, without being double-charged fees.
* **Curated Asset Catalog:** Integrates dynamic token data from CoinGecko and Jupiter Tokens V2 API, displaying only high-quality, verified SPL assets with working icons and metadata.

---

## 🏗️ Technical Architecture

Demutual is built on a modern, high-performance TypeScript stack.

### Frontend
* **Framework:** React + Vite
* **Styling:** Tailwind CSS + Lucide Icons
* **Wallet Connection:** `@solana/web3.js` supporting Phantom and Backpack.
* **UX:** Custom state-machine handling for complex multi-transaction bundling and signing.

### Backend
* **Framework:** Elysia.js + Bun (Ultra-fast, edge-ready API)
* **Database:** PostgreSQL (Neon) via Prisma ORM
* **Models:** Relational tracking of `Buckets`, `Deposits`, and deep `BasketAttempts` to track individual Jupiter swap legs for resumability.

### Liquidity Engine (Jupiter V2)
Demutual is an extreme power-user of the **Jupiter V2 Meta-Aggregator**.
* We utilize `GET /swap/v2/order` to fetch optimized, partially-signed RFQ (JupiterZ) transactions.
* We route signed payloads through `POST /swap/v2/execute` to leverage Jupiter's proprietary landing pipeline, MEV protection, and priority fee management.
* We implemented strict rate-limit queuing to safely execute concurrent multi-token bucket swaps on public API tiers.

---

## 🚀 Running Locally

### Prerequisites
* [Bun](https://bun.sh/) installed locally.
* A PostgreSQL database (e.g., local Docker or Neon).
* A Solana Wallet (Phantom/Backpack) set to Mainnet.

### Backend Setup
1. `cd server`
2. `bun install`
3. Copy `.env.example` to `.env` and fill in your `DATABASE_URL` and `JWT_SECRET`.
4. Push the schema: `bunx prisma db push && bunx prisma generate`
5. Start the server: `bun run src/index.ts`

### Frontend Setup
1. `cd frontend`
2. `bun install`
3. Start the dev server: `bun run dev`
4. Open `http://localhost:5173` in your browser.

---

## 🏆 Hackathon Tracks Targeted

* **Jupiter Track (Not Your Regular Bounty):** Deep integration with the brand new V2 Meta-Aggregator, highlighting advanced usage of the `/order` and `/execute` pipelines to handle complex, multi-leg basket swaps. We also submitted a comprehensive Developer Experience (DX) report detailing our migration from V1, API bugs found, and architectural feedback.

*Built with ❤️ for the Solana Ecosystem.*