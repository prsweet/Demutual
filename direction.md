# **Demutual: Decentralized Mutual Funds on Solana**
## **Concept Clarification**
We're building:

- Buckets = Mutual fund portfolios (e.g., "Solana DeFi Index", "Liquid Staking Basket")
- Assets = Individual tokens in the bucket (e.g., JitoSOL, mSOL, ORCA)
- Creators = Anyone can create a bucket (like creating a mutual fund)
- Investors = Anyone can invest in buckets
- Fee = 0.1% to creators + platform (decentralized version of traditional mutual funds)


**Traditional mutual funds:** Managed by private firms, high fees (1-2%), opaque decisions

**Your version:** User-created buckets, low fee (0.1%), transparent on-chain

“Colosseum Copilot surfaces many Solana ‘index/basket/vault’ hackathon
  projects; Demutual narrows on creator-issued, versioned mutual-fund-style
  portfolios with wallet auth, draft-to-publish fundraising, and transparent
  allocation history.”


# **Technology reaches mainstream adoption when infrastructure becomes abstracted behind familiar user experiences** ~beautiful

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



  Good UX question. Here's how I'd think about it for new-to-crypto
  creators, ranked by how much friction it removes vs. effort to ship.

  My recommendation: auto-fund on first publish

  When a creator clicks "Publish Bucket" for the first time, the platform
  wallet sends them ~0.001 SOL so their account exists. They never see the
  issue.

  • Cost: ~$0.0002 per creator (negligible).
  • One line of UX while publishing: "Activating your earnings address
    (one-time, on us)…"
  • Mitigations to keep it cheap:
    • Auto-fund once per wallet address (not per bucket).
    • Skip auto-fund if getAccountInfo already returns non-null.
    • Cap at, say, 0.001 SOL per address per 24h.

  This is what most Solana apps do for normal users (Phantom, Magic Eden,
  Jupiter all eat tiny rent costs to onboard people).

  What to tell them (in copy)

  If you want zero magic and just clear UI, this works too:

  │ Heads up: Solana charges a one-time ~0.0009 SOL "activation" fee for
    any new wallet to start receiving payments. Either send 0.001 SOL to
    your wallet from any exchange, or [click here] and we'll cover it for
    you.

  That single sentence converts a confusing failure into a 1-click
  solution.

  Other options, ranked

  1. Auto-fund on publish (recommended; least friction, cheap, no
     engineering)
  2. Pre-flight check + nudge — when a creator hits "Publish", check
     their on-chain account; if missing, show "We need to activate your
     wallet (free)" with a single button that does the auto-fund.
     Slightly more visible than #1 but still painless.
  3. Vault-and-claim — fees pool in a platform PDA; creator claims via
     "Withdraw Earnings" once balance > rent-exempt min. Best long-term;
     needs an Anchor program. Not worth doing for a hackathon, definitely
      worth doing post-launch.
  4. Block until they fund — show "Add 0.001 SOL to your wallet" and
     refuse to publish. Don't do this for new-to-crypto users — it'll
     kill conversion.

  What I'd ship for the hackathon

  • Now (5 min): keep the current safe behavior (skip fee transfer when
    unsafe — already implemented), and add a creator-side banner on the
    bucket dashboard:

  │ "Your wallet needs to be activated on Solana to start receiving fees.
    We'll cover this — click Activate."
  • Click "Activate" → backend calls a tiny "activate" endpoint that
    signs a 0.001 SOL transfer from the platform wallet to the creator's
    address. Done.
  • This also means: investors keep getting clean swaps, creators get
    paid the moment they activate, and you don't punish anyone who
    hasn't.

  If you want, I can wire up that "Activate my earnings address" button
  next.


  1. The Jupiter V2 Bug
    You discovered a bug in Jupiter's brand new V2 API.
  
    When you use the old V1 API (/swap/v1/quote) and pass it a fake or invalid
    token address, it cleanly replies with a 400 Bad Request and says
    {"error":"The token ... is not
    tradable","errorCode":"TOKEN_NOT_TRADABLE"}.
  
    But when you use the new V2 Meta-Aggregator (/swap/v2/order) and pass it
    an invalid token, the Jupiter server internally crashes. It spits out a
    500 Internal Server Error with {"error":"Something unexpected occurred"}
    instead of telling you what actually went wrong.


Some tokens Jupiter Tokens v2 returns the same
  broken github URL that we already had — Jupiter's
  icon field isn't a CDN, it's just whatever the token
   submitter registered. ETH was a clear example in my
   live test. So the runtime overlay was strictly an
  improvement but couldn't cover every case. With
  DB-backed plus the curated override file, you can
  now fix any remaining icon without a code change to
  the catalog seed — just one entry in
  CURATED_TOKEN_OVERRIDES.
