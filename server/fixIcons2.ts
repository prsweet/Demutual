import fs from "fs";

async function run() {
  console.log("Fetching Solflare token list...");
  const res = await fetch("https://raw.githubusercontent.com/solflare-wallet/token-list/master/tokens.json");
  const data = (await res.json()) as any;
  const tokens = data.tokens || data;
  const tokenMap = new Map(tokens.map((t: any) => [t.address, t.logoURI]));

  const catalogPath = "./src/constants/tokenCatalog.ts";
  let catalogContent = fs.readFileSync(catalogPath, "utf-8");
  const { TOKEN_CATALOG } = await import("./src/constants/tokenCatalog");

  let replacedCount = 0;
  for (const token of TOKEN_CATALOG) {
    let newLogo = tokenMap.get(token.id);
    
    // Hardcode some fallbacks if Solflare doesn't have them
    if (!newLogo) {
      if (token.symbol === "JitoSOL") newLogo = "https://storage.googleapis.com/jito-edge/JitoSOL_logo.png";
      if (token.symbol === "bSOL") newLogo = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6hoj8NM15M/logo.png"; // Might still be 404, we'll try
      if (token.symbol === "WIF") newLogo = "https://ipfs.io/ipfs/bafkreibk3covs5ltyqxa272uodhculbr6kea6xv2xc7pqdjoi3hcbfiqq";
      if (token.symbol === "POPCAT") newLogo = "https://ipfs.io/ipfs/bafkreibf3osopuq7qtcus7nkrmr2rsozp3tc2jl4f4mqmyvcbwyk6fqwm";
    }

    if (newLogo && newLogo !== token.iconUrl) {
      const blockRegex = new RegExp(`(id:\\s*"${token.id}"[\\s\\S]*?iconUrl:\\s*")[^"]+(")`);
      if (blockRegex.test(catalogContent)) {
         catalogContent = catalogContent.replace(blockRegex, `$1${newLogo}$2`);
         replacedCount++;
         console.log(`Updated ${token.symbol}: ${newLogo}`);
      } else {
         const ghRegex = new RegExp(`(id:\\s*"${token.id}"[\\s\\S]*?iconUrl:\\s*)gh\\([^)]+\\)`);
         if (ghRegex.test(catalogContent)) {
            catalogContent = catalogContent.replace(ghRegex, `$1"${newLogo}"`);
            replacedCount++;
            console.log(`Updated ${token.symbol} (was gh): ${newLogo}`);
         } else {
             const fallbackRegex = new RegExp(`(id:\\s*"${token.id}"[\\s\\S]*?iconUrl:\\s*")[^"]+(")`);
             if (fallbackRegex.test(catalogContent)) {
                 catalogContent = catalogContent.replace(fallbackRegex, `$1${newLogo}$2`);
                 replacedCount++;
             }
         }
      }
    }
  }

  fs.writeFileSync(catalogPath, catalogContent, "utf-8");
  console.log(`\nSuccessfully updated ${replacedCount} token icons!`);
}

run();