/**
 * @solana/web3.js expects Node's `Buffer`. Vite externalizes the `buffer` built-in unless we alias the npm package.
 */
import { Buffer } from "buffer";

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (typeof g.Buffer === "undefined") {
  g.Buffer = Buffer;
}
