# **Demutual: Decentralized Mutual Funds on Solana**
## **Concept Clarification**
We're building:

- Buckets = Mutual fund portfolios (e.g., "Solana DeFi Index", "Liquid Staking Basket")
- Assets = Individual tokens in the bucket (e.g., JitoSOL, mSOL, ORCA)
- Creators = Anyone can create a bucket (like creating a mutual fund)
- Investors = Anyone can invest in buckets
- Fee = 0.4% to creators + 0.1% to platform (decentralized version of traditional mutual funds)


**Traditional mutual funds:** Managed by private firms, high fees (1-2%), opaque decisions

**Our version:** User-created buckets, low fee (0.1%), transparent on-chain

“Colosseum Copilot surfaces many Solana ‘index/basket/vault’ hackathon
  projects; Demutual narrows on creator-issued, versi oned mutual-fund-style
  portfolios with wallet auth, draft-to-publish fundraising, and transparent
  allocation history.”


## **Technology reaches mainstream adoption when infrastructure becomes abstracted behind familiar user experiences** ~beautiful

**Our Thinking** -> The next phase of Web3 adoption is not more primitives — it’s better financial interfaces

# “people enter the Solana ecosystem knowingly or unknowingly” ~Kushal Goyal aka @prsweet

  Most mainstream users do not care about:
  
  * RPCs,
  * validator economics,
  * SPL standards,
  * DeFi composability.
  
  They care about:
  
  * “where do I put money?”
  * “is it understandable?”
  * “is it diversified?”
  * “does it feel safer than buying random coins?” -> for a an investor new to web3

  Most of the Solana ecosystem is optimized for:
  
  * traders,
  * developers,
  * degens,
  * yield farmers,
  * MEV/searchers,
  * power users.
  
  New users entering crypto see:
  
  * wallets,
  * bridges,
  * swaps,
  * staking,
  * LPs,
  * perps,
  * liquidation risk,
  * dozens of tokens.
  
  That’s overwhelming.



  ## Creator wallet activation — decision

  **Investor side** = hand-held UX (newcomer-friendly, education-first,
  USD-denominated, plain-language slippage explainers, etc.).

  **Creator side** = lighter touch. Demutual deliberately positions itself
  to attract serious creators — people who can credibly run a basket and
  whose track record can be evaluated by investors. We do **not** want to
  optimize the creator flow for someone who has never used a Solana wallet
  before. That's a fairness/quality bar, not just a UX preference.

  Consequence: we do **not** auto-fund creator wallets, do not run an
  "Activate my earnings address" button, and do not pool fees in a platform
  PDA on the creator's behalf. All of those would lower the bar to
  effectively zero and invite spam buckets.

  What we ship instead:

  - Investor-side fee transfer auto-skips when a creator's collection
    wallet would receive less than the rent-exempt minimum and doesn't
    exist on-chain yet. The swap still completes, just without a fee
    transfer for that buy. Already implemented.
  - Creator-side passive notice on the bucket page: a single line telling
    them their wallet needs to exist on-chain to receive fees, with a one-
    sentence "how" (send any small amount to it from an exchange or another
    wallet). No button, no spoon-feeding — they figure it out.

  This is consistent with the broader product thesis: the platform abstracts
  blockchain primitives away for **investors** (who are mainstream / new to
  crypto), but assumes **creators** are competent enough to operate a wallet
  — the same way a fund manager is expected to have a bank account before
  running a fund.