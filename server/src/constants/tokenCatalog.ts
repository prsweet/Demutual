/**
 * Curated Solana mainnet SPL assets for bucket listings. Mint strings are from the
 * community token list / protocol docs; server upserts into `Asset` on first use.
 */
export type CatalogCategory = "stablecoin" | "yield" | "token" | "nft";

export type CatalogAsset = {
  id: string;
  name: string;
  symbol: string;
  iconUrl: string;
  decimals: number;
  category: CatalogCategory;
};

const gh = (mint: string, file: string = "logo.png") =>
  `https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/${mint}/${file}`;

/** Display order for UI sections */
export const CATALOG_CATEGORY_ORDER: CatalogCategory[] = ["stablecoin", "yield", "token", "nft"];

export const CATALOG_CATEGORY_LABEL: Record<CatalogCategory, string> = {
  stablecoin: "Stablecoins & cash-like",
  yield: "Yield & liquid staking (LSTs)",
  token: "Tokens & DeFi",
  nft: "NFT & collectible SPL (0-supply / project coins)"
};

const STABLE: CatalogAsset[] = [
  {
    id: "So11111111111111111111111111111111111111112",
    name: "Wrapped SOL",
    symbol: "SOL",
    iconUrl: gh("So11111111111111111111111111111111111111112"),
    decimals: 9,
    category: "stablecoin"
  },
  {
    id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    name: "USD Coin",
    symbol: "USDC",
    iconUrl: gh("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    decimals: 6,
    category: "stablecoin"
  },
  {
    id: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    name: "USDT",
    symbol: "USDT",
    iconUrl: gh("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "logo.svg"),
    decimals: 6,
    category: "stablecoin"
  },
  {
    id: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    name: "PayPal USD",
    symbol: "PYUSD",
    iconUrl: gh("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"),
    decimals: 6,
    category: "stablecoin"
  },
  {
    id: "9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u",
    name: "First Digital USD",
    symbol: "FDUSD",
    iconUrl: gh("9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u"),
    decimals: 6,
    category: "stablecoin"
  },
  {
    id: "6AJcP7wuGwmQ9m98Vs8SXYj85wBXqCJVs9j64MYuPdW8",
    name: "Euro Coin",
    symbol: "EURC",
    iconUrl: gh("6AJcP7wuGwmQ9m98Vs8SXYj85wBXqCJVs9j64MYuPdW8"),
    decimals: 6,
    category: "stablecoin"
  },
  {
    id: "EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCWNWqxWN4t6w",
    name: "DAI (Portal)",
    symbol: "DAI",
    iconUrl: gh("EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCWNWqxWN4t6w"),
    decimals: 8,
    category: "stablecoin"
  },
  {
    id: "7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT",
    name: "UXD Stablecoin",
    symbol: "UXD",
    iconUrl: gh("7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT"),
    decimals: 6,
    category: "stablecoin"
  },
  {
    id: "USDH1SM1ojwWUga67PGrgWRuTiPWS1ZREbxEjaaXnbh",
    name: "USDH",
    symbol: "USDH",
    iconUrl: gh("USDH1SM1ojwWUga67PGrgWRuTiPWS1ZREbxEjaaXnbh"),
    decimals: 6,
    category: "stablecoin"
  },
  {
    id: "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",
    name: "USDS (Sky)",
    symbol: "USDS",
    iconUrl: "https://assets.coingecko.com/coins/images/39926/thumb/usds.webp?1726666683",
    decimals: 6,
    category: "stablecoin"
  }
];

const YIELD: CatalogAsset[] = [
  {
    id: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    name: "Marinade staked SOL",
    symbol: "mSOL",
    iconUrl: gh("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"),
    decimals: 9,
    category: "yield"
  },
  {
    id: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    name: "Jito Staked SOL",
    symbol: "JitoSOL",
    iconUrl: gh("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"),
    decimals: 9,
    category: "yield"
  },
  {
    id: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6hoj8NM15M",
    name: "BlazeStake Staked SOL",
    symbol: "bSOL",
    iconUrl: gh("bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6hoj8NM15M"),
    decimals: 9,
    category: "yield"
  },
  {
    id: "Dso1bDeDjCQxFWDZi6dL6Ap3pJGFMBSBbhi5gAcRmYc",
    name: "Drift Staked SOL",
    symbol: "dSOL",
    iconUrl: "https://assets.coingecko.com/coins/images/28046/thumb/JitoSOL-200.png?1696527060",
    decimals: 9,
    category: "yield"
  },
  {
    id: "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj",
    name: "Lido Staked SOL (Portal)",
    symbol: "stSOL",
    iconUrl: gh("7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj"),
    decimals: 9,
    category: "yield"
  },
  {
    id: "27G8MtK7FvTc739iBy7sw7WTXWDJTzkmPLD8SrCsQffD",
    name: "Jupiter Perps LP",
    symbol: "JLP",
    iconUrl: "https://assets.coingecko.com/coins/images/18369/thumb/logo_-_2021-09-15T100934.765.png?1696517862",
    decimals: 6,
    category: "yield"
  },
  {
    id: "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm",
    name: "Infinity (LST index)",
    symbol: "INF",
    iconUrl: "https://assets.coingecko.com/coins/images/18468/thumb/infSOL.png?1710325032",
    decimals: 9,
    category: "yield"
  }
];

const TOKEN: CatalogAsset[] = [
  {
    id: "JUPyiwrYJFskUPiHa7hkeR8UctBXDFt9VM2ZXdHUwqD",
    name: "Jupiter",
    symbol: "JUP",
    iconUrl: "https://static.jup.ag/jup/icon.png",
    decimals: 6,
    category: "token"
  },
  {
    id: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    name: "Bonk",
    symbol: "BONK",
    iconUrl: "https://assets.coingecko.com/coins/images/28600/thumb/bonk.jpg?1696527587",
    decimals: 5,
    category: "token"
  },
  {
    id: "EKpQGSJtjMFqKZ9KQanYq7k6kU5n7E2S8vYxGwxpump",
    name: "dogwifhat",
    symbol: "WIF",
    iconUrl: "https://bafkreibk3covs5ltyqxa272uodhculbr6kea6xv2xc7pqdjoi3hcbfiqq.ipfs.nftstorage.link",
    decimals: 6,
    category: "token"
  },
  {
    id: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    name: "Popcat",
    symbol: "POPCAT",
    iconUrl: "https://assets.coingecko.com/coins/images/33760/thumb/image.jpg?1702964227",
    decimals: 9,
    category: "token"
  },
  {
    id: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5",
    name: "cat in a dogs world",
    symbol: "MEW",
    iconUrl: "https://assets.coingecko.com/coins/images/36440/thumb/MEW.png?1711442286",
    decimals: 5,
    category: "token"
  },
  {
    id: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    name: "Raydium",
    symbol: "RAY",
    iconUrl: gh("4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"),
    decimals: 6,
    category: "token"
  },
  {
    id: "orcaEKTdK7kA7qut0SbfysGqcLzuUWZPWEze6NFiN",
    name: "Orca",
    symbol: "ORCA",
    iconUrl: gh("orcaEKTdK7kA7qut0SbfysGqcLzuUWZPWEze6NFiN"),
    decimals: 6,
    category: "token"
  },
  {
    id: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX6eX9YbB9P",
    name: "Pyth Network",
    symbol: "PYTH",
    iconUrl: gh("HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX6eX9YbB9P"),
    decimals: 6,
    category: "token"
  },
  {
    id: "jtojtomef8uuDBsF4N3mv9Sk2XNsnr2uzenyBvp2YUv",
    name: "Jito",
    symbol: "JTO",
    iconUrl: gh("jtojtomef8uuDBsF4N3mv9Sk2XNsnr2uzenyBvp2YUv"),
    decimals: 9,
    category: "token"
  },
  {
    id: "TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnefJ8r",
    name: "Tensor",
    symbol: "TNSR",
    iconUrl: gh("TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnefJ8r"),
    decimals: 9,
    category: "token"
  },
  {
    id: "rndrizKT3Ah1JUYdscM1tKhZ7TKxRuy2Y1FpNHSv9Xv",
    name: "Render Token",
    symbol: "RENDER",
    iconUrl: gh("rndrizKT3Ah1JUYdscM1tKhZ7TKxRuy2Y1FpNHSv9Xv"),
    decimals: 8,
    category: "token"
  },
  {
    id: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",
    name: "Helium Network Token",
    symbol: "HNT",
    iconUrl: gh("hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux"),
    decimals: 8,
    category: "token"
  },
  {
    id: "7i5KKsX2weiTkry7jAw4G4y1m82GHw6ZEMPvAQNhtMhr",
    name: "STEPN GMT",
    symbol: "GMT",
    iconUrl: gh("7i5KKsX2weiTkry7jAw4G4y1m82GHw6ZEMPvAQNhtMhr"),
    decimals: 9,
    category: "token"
  },
  {
    id: "AFbX8oGjGpmVFywbVouvhQSRmiW2aR1mohfahi4Y2AdB",
    name: "GST",
    symbol: "GST",
    iconUrl: gh("AFbX8oGjGpmVFywbVouvhQSRmiW2aR1mohfahi4Y2AdB"),
    decimals: 9,
    category: "token"
  },
  {
    id: "SRMuApVNdxXokk5GT7XDkT9UvNPaMMN39pMhfZzV7DD",
    name: "Serum",
    symbol: "SRM",
    iconUrl: gh("SRMuApVNdxXokk5GT7XDkT9UvNPaMMN39pMhfZzV7DD"),
    decimals: 6,
    category: "token"
  },
  {
    id: "StepAscQoEioFxxWGdh2sUbFJikNrT86N9Ro89jb3D",
    name: "Step",
    symbol: "STEP",
    iconUrl: gh("StepAscQoEioFxxWGdh2sUbFJikNrT86N9Ro89jb3D"),
    decimals: 9,
    category: "token"
  },
  {
    id: "MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac",
    name: "Mango",
    symbol: "MNGO",
    iconUrl: gh("MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac"),
    decimals: 6,
    category: "token"
  },
  {
    id: "kinXdEcpDQeHPEuQnqmUgtYykqKGVFq6CeVX5iAHJq6",
    name: "Kin",
    symbol: "KIN",
    iconUrl: gh("kinXdEcpDQeHPEuQnqmUgtYykqKGVFq6CeVX5iAHJq6"),
    decimals: 5,
    category: "token"
  },
  {
    id: "ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUkIKweXUhW",
    name: "Star Atlas",
    symbol: "ATLAS",
    iconUrl: gh("ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUkIKweXUhW"),
    decimals: 8,
    category: "token"
  },
  {
    id: "poLisWXnNRwC6oBu1vHiuKQzFjGL4XDSu4g9qjz9qVk",
    name: "Star Atlas POLIS",
    symbol: "POLIS",
    iconUrl: gh("poLisWXnNRwC6oBu1vHiuKQzFjGL4XDSu4g9qjz9qVk"),
    decimals: 8,
    category: "token"
  },
  {
    id: "WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk",
    name: "Wen",
    symbol: "WEN",
    iconUrl: "https://assets.coingecko.com/coins/images/34856/thumb/wen-logo-new.jpg?1741334229",
    decimals: 5,
    category: "token"
  },
  {
    id: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
    name: "TRUMP",
    symbol: "TRUMP",
    iconUrl: "https://assets.coingecko.com/coins/images/53746/thumb/trump.png?1737171561",
    decimals: 6,
    category: "token"
  },
  {
    id: "METvsvVRapdj9cFLzq4DsB5MK9LLMQmvcN9mMcps9Fk",
    name: "Metaplex",
    symbol: "MPLX",
    iconUrl: gh("METvsvVRapdj9cFLzq4DsB5MK9LLMQmvcN9mMcps9Fk"),
    decimals: 6,
    category: "token"
  },
  {
    id: "CWE8jPTUYhdCTvY3eeq3S57Er1QpjSH9eyb2R6s9M5Cw",
    name: "Chainlink (Portal)",
    symbol: "LINK",
    iconUrl: gh("CWE8jPTUYhdCTvY3eeq3S57Er1QpjSH9eyb2R6s9M5Cw"),
    decimals: 8,
    category: "token"
  }
];

/** SPL mints tagged NFT / collectible in legacy lists; still valid mints for registry. */
const NFT: CatalogAsset[] = [
  {
    id: "FaiPGacTM7YBmacumbg4ZnDx7sKsGcG3LkcVoqfddEA7",
    name: "theBULL (NFT project coin)",
    symbol: "BULL",
    iconUrl: gh("FaiPGacTM7YBmacumbg4ZnDx7sKsGcG3LkcVoqfddEA7"),
    decimals: 0,
    category: "nft"
  },
  {
    id: "45HfvXJHY9msY2i4EmUpume1mSMLUvdaWsJRbctAobQM",
    name: "Monster Inu (metaverse / NFT)",
    symbol: "INU",
    iconUrl: gh("45HfvXJHY9msY2i4EmUpume1mSMLUvdaWsJRbctAobQM"),
    decimals: 0,
    category: "nft"
  },
  {
    id: "2WnVfjtW9QttRwqxn3RPnHBFHMR3cyA5Ca3zug41Q9Xb",
    name: "Golden Techie Hannibal (social)",
    symbol: "HNI",
    iconUrl: gh("2WnVfjtW9QttRwqxn3RPnHBFHMR3cyA5Ca3zug41Q9Xb"),
    decimals: 0,
    category: "nft"
  },
  {
    id: "NGK3iHqqQkyRZUj4uhJDQqEyKKcZ7mdawWpqwMffM3s",
    name: "Yaku",
    symbol: "YAKU",
    iconUrl: "https://static.jup.ag/tokens/NGK3iHqqQkyRZUj4uhJDQqEyKKcZ7mdawWpqwMffM3s/icon.png",
    decimals: 0,
    category: "nft"
  },
  {
    id: "AMp8Jo18ZjK2tuQGfjKAkkWnVP4NWX5sav4NJH6pXF2D",
    name: "AstraPad",
    symbol: "ASTRA",
    iconUrl: gh("AMp8Jo18ZjK2tuQGfjKAkkWnVP4NWX5sav4NJH6pXF2D"),
    decimals: 9,
    category: "nft"
  },
  {
    id: "X71v8NH6dbLwPsn4TR1Tx38K4uWgGZ78mC599XSPJox",
    name: "NSPACE Supporter",
    symbol: "SNS",
    iconUrl: gh("X71v8NH6dbLwPsn4TR1Tx38K4uWgGZ78mC599XSPJox"),
    decimals: 9,
    category: "nft"
  }
];

export const TOKEN_CATALOG: CatalogAsset[] = [...STABLE, ...YIELD, ...TOKEN, ...NFT];

export const TOKEN_CATALOG_BY_ID = new Map(TOKEN_CATALOG.map((a) => [a.id, a]));
