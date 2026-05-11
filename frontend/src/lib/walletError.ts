/**
 * Wallet adapters (Phantom, Backpack, etc.) throw inconsistently when the user denies
 * a signing request — sometimes a plain `Error`, sometimes a bare `{ code, message }`
 * object, occasionally something with `.error` nested. Stringifying via
 * `String(e instanceof Error ? e.message : e)` lands on "[object Object]" for the
 * object case, which is what the user is seeing.
 *
 * This helper normalises any thrown value into:
 *   - `message`: a human-readable string (never empty, never "[object Object]")
 *   - `isUserDenial`: true when the wallet reported the user explicitly cancelled.
 *
 * Detection uses both the EIP-1193 `code: 4001` convention and a handful of message
 * substrings — wallets aren't standardised here, so we cast a wide net.
 */

export class WalletDeniedError extends Error {
  constructor(message = "You cancelled the transaction in your wallet.") {
    super(message);
    this.name = "WalletDeniedError";
  }
}

export function parseWalletError(e: unknown): { isUserDenial: boolean; message: string } {
  if (e instanceof WalletDeniedError) {
    return { isUserDenial: true, message: e.message };
  }

  let message = "";
  let code: number | undefined;

  if (e instanceof Error) {
    message = e.message;
    const c = (e as Error & { code?: unknown }).code;
    if (typeof c === "number") code = c;
  } else if (typeof e === "string") {
    message = e;
  } else if (typeof e === "object" && e !== null) {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.length > 0) {
      message = o.message;
    } else if (typeof o.error === "string" && o.error.length > 0) {
      message = o.error;
    } else if (typeof o.reason === "string" && o.reason.length > 0) {
      message = o.reason;
    }
    if (typeof o.code === "number") code = o.code;
    // Some wallets nest: { error: { message: "..." } }
    if (!message && typeof o.error === "object" && o.error !== null) {
      const inner = o.error as Record<string, unknown>;
      if (typeof inner.message === "string") message = inner.message;
    }
  }

  if (!message) message = "Unknown wallet error — try again or check the wallet extension.";

  const lower = message.toLowerCase();
  const isUserDenial =
    code === 4001 ||
    lower.includes("user reject") ||
    lower.includes("user denied") ||
    lower.includes("user declined") ||
    lower.includes("user cancel") ||
    lower.includes("user closed") ||
    lower.includes("approval denied") ||
    lower.includes("transaction was rejected") ||
    lower.includes("rejected by the user") ||
    lower === "rejected" ||
    lower === "user rejected";

  return { isUserDenial, message };
}
