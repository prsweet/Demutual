# Demutual — Frontier Hackathon Analysis

_Last updated: 2026-05-11_

Working analysis of Demutual (decentralized mutual funds on Solana) against what the Frontier hackathon will actually score. Lists what's built, what's at risk, and the highest-ROI skills to apply before submission.

---

## 1. What's built

### Backend (Bun + Elysia + Prisma/Postgres)
- Wallet auth: SIWS-style nonce + signature → JWT (`authController`, `Nonce` model with 5-minute expiry).
- Core schema: `User`, `Bucket` (versioned, draft → published), `Listing` (asset + percentage), `Asset` (curated catalog flag).
- Deposit / Withdrawal ledger with Jupiter leg signatures persisted as JSON.
- **Partial-fill safety:** `BasketAttempt` + `BasketAttemptLeg` track per-leg outcomes so partial baskets don't lie about TVL. Resume only re-quotes PENDING/FAILED legs.
- Devnet mode: direct SOL treasury transfer.
- Mainnet mode: Jupiter Swap (V2 `/order` + V2 `/execute`, with V1 quote/swap also wired in `services/jupiterSwap.ts`).
- ATA rent pre-flight (`services/ataRent.ts`): warns the investor of missing token accounts before they sign anything.
- Fee splits: platform + creator, both safe-skipped when recipient wallets are unfunded and the split is below rent-exempt minimum.

### Frontend (Bun + React 19 + Tailwind 4 + shadcn)
- 6 pages: home, Dashboard, MyBuckets, CreateBucket, BucketDetail (1,173 lines — by far the heaviest), Portfolio.
- Components: BucketGrid, BucketCard, BucketAssetPicker, ConnectWalletModal, Layout, Sidebar, Topbar.
- shadcn primitives in `components/ui/`: only 6 (button, card, input, label, select, textarea).

### Thesis (`direction.md`)
> "Technology reaches mainstream adoption when infrastructure becomes abstracted behind familiar user experiences."

Positioned as the user-friendly index/mutual-fund layer over Solana DeFi. Differentiates from generic vault/yield projects on Colosseum by leaning into creator-issued, versioned baskets with transparent allocation history.

---

## 2. Hackathon strengths

1. **Real product, real problem.** Index/basket framing reads differently than generic "vault" or "yield" submissions.
2. **Jupiter V2 bug write-up in `direction.md` is great narrative material** — you found and worked around an aggregator bug. Use it in the deck.
3. **`BasketAttempt` partial-fill ledger** is unusually thoughtful. Any judge who opens the code will notice.
4. **Auto-fund-on-publish UX thinking** matches the thesis exactly. Cheap to ship, big perception win.
5. **Mainnet/devnet split already real**, with ATA rent pre-flight and rent-safe fee skipping. Production-grade plumbing.

---

## 3. Gaps and risks to fix before submission

| # | Issue | Why it matters | Fix |
|---|---|---|---|
| 1 | No `brand.md`; 6 shadcn primitives only | The pitch is UX-led. Generic UI kills the thesis on stage. | `/brand-design` |
| 2 | `BucketDetailPage.tsx` is 1,173 lines | Hard to polish, easy to break in a demo. | `/simplify` |
| 3 | No pitch deck, no demo video, no submission package | Frontier scoring leans heavily on these. | `/create-pitch-deck`, `/marketing-video`, `/submit-to-hackathon` |
| 4 | Security surface (treasury transfer, Jupiter signing, JWT, nonce reuse) is unaudited | One missed check can sink judges' trust. | `/cso` daily mode |
| 5 | `llms-full.txt` (720KB) and `.DS_Store` in working tree | Visible in any public repo link. | `git clean` before push |
| 6 | Schema typo: `Withdrawal` model is `@@map("Withdawal")` | Cosmetic but visible | One-line fix + migration |
| 7 | No tests beyond `config.test.ts` | Reduced credibility for a "production-ready" claim | Add a handful of integration tests for invest + sell happy paths |
| 8 | Jupiter V2 `/swap/v2/order` returns opaque 500s for untradable tokens | Users see "Something unexpected occurred" instead of `TOKEN_NOT_TRADABLE` | **Fixed in this pass** — see §5 |

---

## 4. Recommended skill sequence

**High ROI (do these)**
1. `/brand-design` — no brand.md exists. Single biggest UX lift available. Picks palette + typography + tone, writes shadcn CSS vars (light + dark), writes `brand.md`.
2. `/design-taste` — anti-AI-slop direction review on BucketDetail, CreateBucket, Portfolio. Themes like *gallery editorial* or *stark minimal* fit the mutual-fund framing better than typical degen DeFi.
3. `/frontend-design-guidelines` + `/page-load-animations` — polish layer.
4. `/number-formatting` — TVL, %, APY, token amounts are everywhere. Inconsistent formatting screams "hackathon project."
5. `/cso` (daily mode) — security pass on Jupiter signing, treasury transfer, JWT, nonce expiry, ATA rent check.
6. `/submit-to-hackathon` — submission package.
7. `/create-pitch-deck` — demo-day slides. Use the Jupiter V2 bug story.
8. `/marketing-video` + `/video-craft` — 60–90s demo video.

**Medium ROI**
- `/review-and-iterate` — production-readiness pass on the Jupiter controllers.
- `/simplify` — target `BucketDetailPage.tsx`. 1,173 lines is a demo-risk.
- `/colosseum-copilot` — already referenced in `direction.md`. Needs a Colosseum Copilot token.
- `/competitive-landscape` — map Symmetry, Investin, Drift Vaults, etc., for the "why us" slide.
- `/deploy-to-mainnet` — checklist run before submission.
- `/roast-my-product` then `/product-review` — roast first, then balanced scoring.

**Out of phase**
- `solana-dev`, `build-defi-protocol`, `debug-program`, `defillama-research`, `launch-token`, `build-mobile`, `scaffold-project`, `validate-idea`.

### Suggested order

```
1. /brand-design                    → lock visual identity
2. /design-taste                    → direction for BucketDetail + Portfolio
3. /simplify (BucketDetailPage)     → de-risk demo crashes
4. /cso daily                       → fix anything 8/10+ confidence
5. /frontend-design-guidelines      → polish layer
6. /page-load-animations            → entrance choreography
7. /number-formatting               → consistent numbers
8. /competitive-landscape           → positioning data
9. /colosseum-copilot               → differentiation evidence
10. /create-pitch-deck              → slides
11. /marketing-video + /video-craft → demo video
12. /submit-to-hackathon            → final package
```

---

## 5. Jupiter V2 fix (shipped this pass)

### Bug recap (from `direction.md`)

> When you use the old V1 API (`/swap/v1/quote`) and pass it a fake or invalid token address, it cleanly replies with a 400 Bad Request and says `{"error":"The token ... is not tradable","errorCode":"TOKEN_NOT_TRADABLE"}`.
>
> But when you use the new V2 Meta-Aggregator (`/swap/v2/order`) and pass it an invalid token, the Jupiter server internally crashes. It spits out a 500 Internal Server Error with `{"error":"Something unexpected occurred"}` instead of telling you what actually went wrong.

The official `integrating-jupiter` skill (jup-ag/agent-skills) confirms this is **undocumented behavior** — its error table covers 4xx, 429, and execute-stage negative codes but does not list the V2 `/order` 500 case for untradable mints.

### What was changed

In `server/src/services/jupiterSwap.ts`:
- When `jupiterOrder()` (V2) returns HTTP 500, we now probe `/swap/v1/quote` with the same `(inputMint, outputMint, amount, slippageBps, swapMode)` pair.
- If V1 returns a structured error (e.g. `TOKEN_NOT_TRADABLE`), we throw `JUPITER_ORDER_TOKEN_NOT_TRADABLE: …` so the caller — and the existing console.error logs in `jupiterInvestController` / `jupiterSellController` — get something actionable.
- We only fall back on 500 (the documented bug), not on 4xx. 4xx already gives actionable messages and a fallback would double rate-limit pressure (free tier is 50 req / 10s; the codebase already has a 600ms inter-leg delay).
- If V1 also fails opaquely or itself errors, the original V2 error is surfaced unchanged — we never lose information.
- No new env vars. No change to call sites. Both `jupiterInvestController` and `jupiterSellController` benefit automatically because they both call `jupiterOrder()`.

### Why this is the right move

- Investors and creators get actionable feedback when a basket contains a deprecated or non-tradable mint (the most common cause of V2 500s right now).
- The catalog (`tokenCatalog.ts`) can grow without silent failures: a mint going untradable surfaces as `TOKEN_NOT_TRADABLE` instead of a generic crash.
- It's a small, contained change — no migration, no client changes.

### What's still worth doing later

- Cache the V1 diagnosis for ~60s per `(inputMint, outputMint)` pair so a basket with one bad mint doesn't fire N V1 probes during a multi-leg plan.
- Promote `TOKEN_NOT_TRADABLE` to a typed error so the API layer can return a clean 422 instead of a generic 400.
- Add a `/assets/probe` endpoint that runs the V1 check at bucket-publish time, so creators can't publish a basket with an untradable mint in the first place.
- Optionally surface `audit.isSus` / `organicScore` from Jupiter's `/tokens/v2/search` at catalog ingestion (per the integrating-jupiter skill, this is the recommended UX pattern).

---

## 6. Quick wins (under 30 minutes each)

- [ ] `git rm --cached llms-full.txt .DS_Store` and add both to `.gitignore`.
- [ ] Fix the `Withdrawal` schema `@@map("Withdawal")` typo (rename + migration).
- [ ] Add an `/activate` button on the creator dashboard that calls a tiny platform-funded 0.001 SOL transfer (matches the auto-fund-on-publish recommendation in `direction.md`).
- [ ] Pin the Jupiter API rate-limit delay constant in one place (`600ms` is hardcoded in 3 spots in `jupiterInvestController.ts`).

---

## 7. Open questions

- Is the submission target devnet or mainnet at demo time? (Affects which flow you rehearse.)
- Do you want the creator-side `/activate` UX shipped before the deck, or post-submission?
- Do you have a Colosseum Copilot token? If yes, `/colosseum-copilot` is worth running this week.
