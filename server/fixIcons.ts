import fs from "fs";

async function run() {
  console.log("Fetching Jupiter token list...");
  const res = await fetch("https://tokens.jup.ag/tokens?tags=strict");
  const jupTokens = (await res.json()) as any[];
  const jupMap = new Map(jupTokens.map((t: any) => [t.address, t.logoURI]));

  const catalogPath = "./src/constants/tokenCatalog.ts";
  let catalogContent = fs.readFileSync(catalogPath, "utf-8");

  // We want to find objects in the catalog and update their iconUrl.
  // Using a regex to match: id: "MINT", ... iconUrl: "OLD_URL"
  // It's safer to just iterate the known list of broken mints and replace their iconUrl strings.
  
  // Let's import the current catalog first
  const { TOKEN_CATALOG } = await import("./src/constants/tokenCatalog");

  let replacedCount = 0;
  for (const token of TOKEN_CATALOG) {
    const newLogo = jupMap.get(token.id);
    if (newLogo && newLogo !== token.iconUrl) {
      // Find the specific iconUrl line for this token.
      // We can search for the block containing the token.id and replace the iconUrl inside it.
      const blockRegex = new RegExp(`(id:\\s*"${token.id}"[\\s\\S]*?iconUrl:\\s*")[^"]+(")`);
      if (blockRegex.test(catalogContent)) {
         catalogContent = catalogContent.replace(blockRegex, `$1${newLogo}$2`);
         replacedCount++;
         console.log(`Updated ${token.symbol}: ${newLogo}`);
      } else {
         // Some use the gh() helper, which looks like: iconUrl: gh("...")
         const ghRegex = new RegExp(`(id:\\s*"${token.id}"[\\s\\S]*?iconUrl:\\s*)gh\\([^)]+\\)`);
         if (ghRegex.test(catalogContent)) {
            catalogContent = catalogContent.replace(ghRegex, `$1"${newLogo}"`);
            replacedCount++;
            console.log(`Updated ${token.symbol} (was gh): ${newLogo}`);
         } else {
             // For TRUMP, MEW, which have literal URLs but didn't match the first regex if spacing is weird
             const fallbackRegex = new RegExp(`(id:\\s*"${token.id}"[\\s\\S]*?iconUrl:\\s*")[^"]+(")`);
             if (fallbackRegex.test(catalogContent)) {
                 catalogContent = catalogContent.replace(fallbackRegex, `$1${newLogo}$2`);
                 replacedCount++;
             } else {
                console.log(`Could not regex-replace ${token.symbol}`);
             }
         }
      }
    }
  }

  fs.writeFileSync(catalogPath, catalogContent, "utf-8");
  console.log(`\nSuccessfully updated ${replacedCount} token icons!`);
}

run();