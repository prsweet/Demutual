# Demutual — Idea Context

## Project
Decentralized mutual funds on Solana. Creators publish weighted baskets of SPL tokens ("Buckets"). Investors buy whole baskets via Jupiter swaps. Fees: 0.4% creator + 0.1% platform. Two-sided UX — investor side hand-held (USD-denominated, plain-language slippage), creator side lighter touch (no auto-wallet activation; quality bar).

## Validation (2026-05-12)

```yaml
demand_signals:
  - "Sanctum LST aggregation rising TVL — validates SOL-denominated basket demand"
  - "Jupiter rolling out 'Spot Trade' multi-asset flows — biggest aggregator moving into curator-basket territory"
  - "TradFi normalizing tokenized funds (BlackRock BUIDL, Franklin Templeton FOBXX) — narrative tailwind"
  - "Symmetry Protocol exists on Solana with moderate TVL — proves the curator-basket niche is buildable but not solved"
  - "Recurring 'where's the Solana index fund' threads on CT — perennial unmet desire, not a one-off"

risks:
  - category: market
    description: "Symmetry already occupies the curator-basket niche on Solana. Differentiation must be sharp."
    severity: high
  - category: market
    description: "Jupiter could absorb this category as a feature — distribution moat would evaporate if they ship a first-party basket UX."
    severity: high
  - category: regulatory
    description: "Curated portfolios with fees look fund-like to US regulators. Mitigated by no custodial pooling (Demutual is non-custodial) but creator-side legal exposure is unclear in some jurisdictions."
    severity: medium
  - category: technical
    description: "Position drift: ledger 'availableToWithdraw' can diverge from actual on-chain SPL balances if user moves tokens outside the app. Already a known follow-up; not yet shipped."
    severity: medium
  - category: distribution
    description: "Two-sided marketplace cold-start. Investors need credible curators; curators need an audience. Same dynamic as YouTube launching with zero channels."
    severity: high
  - category: team
    description: "Hackathon stage. Track record is the credibility currency for fund-like products — needs proof points fast."
    severity: medium

go_no_go: "go"

confidence: 0.7

next_steps:
  - "Ship the position-drift fix (read on-chain SPL balances, return min(ledger, on-chain) for availableToWithdraw) — current behavior fails with friendly message but blocks sells silently"
  - "Recruit 5-10 named curator creators with existing audiences (KOLs, ex-quant traders, sector analysts) BEFORE general launch — solves cold-start"
  - "Pick a wedge: 'Liquid Staking Index', 'Solana DeFi Bluechip', 'Memecoin index' — one canonical bucket per category, not 50 weak ones"
  - "Differentiate from Symmetry on: (a) UX (USD-first, plain-language slippage), (b) creator economics (0.4% is generous — Symmetry is lower), (c) research docs locked-on-publish (transparency moat)"
  - "Monitor Jupiter's roadmap — if they announce baskets, pivot to creator-tools-on-top-of-Jupiter (be the curator infra, not the swap layer)"
  - "Integration-first: already correct — using Jupiter for routing. No custom AMM or vault contract. Maintain that posture; resist temptation to build a custom program just for the appearance of depth"
  - "Get the hackathon submission live; the partial-fill resumability + research-locked-on-publish + plain-language UX are demo-strong differentiators"

scorecard:
  founder_fit: 2/3
  mvp_speed: 3/3       # MVP already exists end-to-end
  distribution: 1/3     # No clear distribution channel yet
  market_pull: 2/3      # Real but contested
  revenue: 2/3          # 0.1% platform fee scales with volume; needs ramp
  total: 10/15          # Go threshold ≥ 8

competition_level: moderate
technical_feasibility: straightforward  # already built; only follow-ups remain
time_to_mvp: shipped
```

## Differentiation Angle (recommended)
**"The transparent curator marketplace"** — Demutual's research-document-locked-on-publish is the unique wedge. Symmetry doesn't have it. Jupiter, even if they ship baskets, won't have it because they're a routing layer, not a curator marketplace. The thesis: investors want to understand WHY a basket is composed the way it is, written before any returns existed. Bind creators to their pre-investment thesis on-chain.
