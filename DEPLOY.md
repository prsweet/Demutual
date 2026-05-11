# Deploy Guide — Demutual

Backend on Railway, frontend on Vercel, domain `demutual.in`.

---

## 1. Pre-deploy: required manual changes

### Backend (`server/package.json`)

Add a `start` script and a `postinstall` so Railway can boot and Prisma client gets generated at build time:

```json
"scripts": {
  "dev": "bun src/index.ts",
  "start": "bun src/index.ts",
  "postinstall": "bunx --bun prisma generate",
  "db:push": "bunx --bun prisma db push"
}
```

### Frontend

No code changes required. `frontend/build.ts` already outputs to `dist/`, and `BUN_PUBLIC_*` env vars are inlined at build time.

You will add one new file later (`frontend/vercel.json`) for SPA routing — see step 4.

---

## 2. Database (do this first)

Pick one:

- **Railway Postgres** — simplest, same dashboard: in Railway project → New → Database → PostgreSQL. Copy the `DATABASE_URL`.
- **Neon / Supabase** — free tier, better for serverless. Create project, copy the pooled connection string.

Then from your local machine, push the schema once against the prod DB:

```fish
cd server
DATABASE_URL="<prod-url>" bun run db:push
```

---

## 3. Backend on Railway

1. Push your repo to GitHub.
2. Railway → **New Project** → **Deploy from GitHub repo**.
3. **Root directory**: `server`
4. Railway auto-detects Bun via Nixpacks. If not, set:
   - Build command: `bun install`
   - Start command: `bun src/index.ts`
5. **Variables** tab — add:

   ```
   DATABASE_URL=<from step 2>
   JWT_SECRET=<random 32+ chars>
   CORS_ORIGINS=https://demutual.in,https://www.demutual.in
   DEMUTUAL_NETWORK=mainnet
   SOLANA_RPC_URL=<Helius/QuickNode mainnet URL>
   JUPITER_API_HOST=https://quote-api.jup.ag
   PLATFORM_FEE_BPS=<your bps>
   PLATFORM_FEE_WALLET_PUBKEY=<your wallet>
   CREATOR_FEE_BPS=<your bps>
   ```

   Do **not** set `PORT` — Railway injects it; your `serverPort()` already reads it.

6. Deploy. Check `https://<railway-url>/health` returns `{ success: true, data: { ok: true, ... } }`.

---

## 4. Frontend on Vercel

1. Vercel → **Add New** → **Project** → import the same GitHub repo.
2. **Root directory**: `frontend`
3. **Framework preset**: Other
4. **Install command**: `bun install`
5. **Build command**: `bun run build`
6. **Output directory**: `dist`
7. **Environment variables** (Production):

   ```
   BUN_PUBLIC_API_URL=https://api.demutual.in
   BUN_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
   BUN_PUBLIC_SOLANA_JUPITER_RPC_URL=<mainnet RPC>
   ```

8. **SPA routing fix** — react-router needs a catch-all. Create `frontend/vercel.json`:

   ```json
   {
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```

   Without this, refreshing a deep route like `/buckets/abc` returns 404.

9. Deploy.

---

## 5. Domain: `demutual.in`

Open the DNS panel at your registrar (GoDaddy / Namecheap / etc.).

### Frontend → root domain

In Vercel project → **Settings** → **Domains** → add `demutual.in` and `www.demutual.in`. Vercel shows the exact records to add at your registrar:

- **A record** `@` → `76.76.21.21`
- **CNAME** `www` → `cname.vercel-dns.com`

### Backend → `api.demutual.in`

In Railway → your service → **Settings** → **Networking** → **Custom Domain** → add `api.demutual.in`. Railway gives you a CNAME target like `<project>.up.railway.app`.

At your registrar:

- **CNAME** `api` → `<project>.up.railway.app`

Wait 5–30 min for DNS propagation and SSL provisioning (both Vercel and Railway issue Let's Encrypt certs automatically).

---

## 6. Wire them together (critical)

After domains are live:

1. In Railway, update `CORS_ORIGINS` to include the final domains:

   ```
   CORS_ORIGINS=https://demutual.in,https://www.demutual.in
   ```

2. In Vercel, confirm `BUN_PUBLIC_API_URL=https://api.demutual.in` — then **redeploy the frontend**. Env vars are baked in at build time, so changing them requires a fresh build.

---

## 7. Smoke test

- `https://api.demutual.in/health` → 200
- `https://demutual.in` loads
- Hard-refresh on a deep route works (e.g. `/buckets/<id>`)
- Wallet login completes
- No CORS errors in browser console

---

## Gotchas

- **Prisma + Bun + Railway**: `server/prisma/schema.prisma` uses `generator client { provider = "prisma-client" output = "../generated/prisma" }`. The `postinstall` hook is what makes this work on Railway — without it the deploy will fail at first request.
- **CORS_ORIGINS is exact-match strings** in prod (per `server/src/config.ts`) — no regex. Add the Vercel preview URL too if you want PR previews to talk to the API.
- **Public RPC will rate-limit you** — get a Helius / QuickNode / Triton key before launch, especially for Jupiter mainnet swaps.
- **Devnet vs mainnet** — `publicServiceInfo()` returns different shapes based on `DEMUTUAL_NETWORK`. Pick one and stick with it for the deployed environment.
- **Env var changes on Vercel require a redeploy** — `BUN_PUBLIC_*` vars are inlined into the JS bundle at build time, not read at runtime.
