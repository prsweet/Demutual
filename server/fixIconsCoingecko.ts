import fs from "fs";

async function run() {
  console.log("Fetching Coingecko token list...");
  const res = await fetch("https://tokens.coingecko.com/solana/all.json");
  const data = (await res.json()) as any;
  const tokenMap = new Map(data.tokens.map((t: any) => [t.address, t.logoURI]));

  const catalogPath = "./src/constants/tokenCatalog.ts";
  let catalogContent = fs.readFileSync(catalogPath, "utf-8");
  const { TOKEN_CATALOG } = await import("./src/constants/tokenCatalog");

  let replacedCount = 0;
  for (const token of TOKEN_CATALOG) {
    let newLogo = tokenMap.get(token.id);
    
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