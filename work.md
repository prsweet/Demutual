
  Schema (prisma/schema.prisma)
  - User.feeReceiverVerified Boolean
  @default(false)
  - User.feeReceiverVerifiedAt DateTime?

  Run once when Neon is awake:
  cd server && bunx --bun prisma db push

  New endpoint: POST
  /users/me/verify-fee-receiver
  - Calls Solana RPC
  getAccountInfo(walletAddress).
  - If found → flips feeReceiverVerified =
  true, sets timestamp, returns { verified:
  true, foundOnChain: true }.
  - If not → returns { foundOnChain: false,
  message: "send any small amount of SOL and
  try again" }.

  Fee gating in jupiterInvestController.ts —
  full refactor:
  - Loads creator.feeReceiverVerified along
  with the wallet address.
  - Builds candidate splits per recipient:
  platform always candidate; creator only when
   verified.
  - Runs rent-safety check per recipient —
  drops only the unsafe one, keeps the safe
  one.
  - Builds a one-or-many split fee transfer
  from whatever survived.
  - The skip reasons are joined into a single
  human-readable string the FE can display.
  - completeJupiterInvest mirrors the same
  gate so the expected-transfer math doesn't
  ask for a creator transfer that was never
  going to be sent.

  Result: platform fee always pays (assuming
  our wallet stays on-chain, which it does).
  Creator fee pays only when the creator has
  explicitly verified. If the creator's wallet
   is on-chain but they haven't clicked Check,
   platform still earns, creator earns $0 —
  exactly what you wanted.

  Frontend

  New component: CreatorVerificationStatus —
  three variants:
  - panel (CreateBucketPage) — full explainer
  card with the wallet address shown, Check
  Now button, success/error states inline.
  - banner (MyBucketsPage) — thin amber strip
  at top with the same Check Now button.
  - pill (Sidebar) — compact always-visible
  status under the user info. Amber "verify
  for fees" before; green "wallet verified"
  after.

  The component hides itself when verified
  (except the green pill, which stays as a
  positive indicator).

  Where it lives:
  - Sidebar pill — always visible regardless
  of which page the user is on.
  - CreateBucketPage panel — directly under
  "Signed in as…" so it's the first thing they
   see.
  - MyBucketsPage banner — top of the list.

  After successful verification the component
  calls refreshUser(), so all three locations
  update simultaneously without a page reload.

  What a creator sees

  1. Sign in → sidebar shows amber 🛡 verify
  for fees pill.
  2. Navigate anywhere → pill stays visible.
  3. Visit Create Bucket → full panel: "Verify
   your fee-receiver wallet — investor buys
  split a small fee between the platform and
  you. We pay your share only after you've
  confirmed your wallet exists on Solana. If
  your wallet is brand new, send any small
  amount of SOL to it first."
  4. Click Check now:
    - Wallet on-chain → green success message,
   panel/banner disappear, sidebar pill turns
  green.
    - Wallet not on-chain → inline error
  explaining what to do.
  5. Going forward: every investor buy
  includes the creator's fee share in the fee
  transfer (subject to rent-safety per the
  existing check).

  What an investor sees

  Nothing different — the verification state
  is intentionally invisible to them. Buys
  still work whether the creator is verified
  or not; the only difference is which fee
  transfers are included in the bundled tx,
  which is server-side detail.

  Direction.md

  Already updated earlier with the rationale.
  The new flow matches the doc: passive notice
   → active "Check now" → creator's own work
  to send themselves some SOL. No auto-fund,
  no platform PDA, no spoon-feeding.

  Want me to also add a small "Earnings to
  date: $X.XX" stat on the verified state, or
  save that for a later polish pass?