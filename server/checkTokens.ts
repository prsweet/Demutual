import { TOKEN_CATALOG } from "./src/constants/tokenCatalog";

async function check() {
  console.log("Checking Token Catalog...");
  let invalidMints = 0;
  let brokenIcons = 0;

  for (const token of TOKEN_CATALOG) {
    // 1. Check basic length (Solana addresses are 32-44 chars base58)
    if (token.id.length < 32 || token.id.length > 44) {
      console.log(`❌ [MINT] ${token.symbol}: Invalid mint length (${token.id})`);
      invalidMints++;
    }

    // 2. Check icon URL
    try {
      const res = await fetch(token.iconUrl, { method: "HEAD" });
      if (!res.ok) {
        // Fallback to GET just in case HEAD is blocked
        const resGet = await fetch(token.iconUrl, { method: "GET" });
        if (!resGet.ok) {
           console.log(`❌ [ICON] ${token.symbol}: Broken URL (${resGet.status}) -> ${token.iconUrl}`);
           brokenIcons++;
        }
      }
    } catch (e) {
      console.log(`❌ [ICON] ${token.symbol}: Fetch error -> ${token.iconUrl}`);
      brokenIcons++;
    }
  }

  console.log(`\nDone! Found ${invalidMints} invalid mints and ${brokenIcons} broken icons.`);
}

void check();