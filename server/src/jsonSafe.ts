/** Prisma `Decimal` / `decimal.js` — not JSON-serializable by default; breaks some HTTP serializers. */
function isDecimal(val: object): boolean {
  if (val instanceof Date) return false;
  const name = (val as { constructor?: { name?: string } }).constructor?.name;
  if (name === "Decimal") return true;
  const v = val as Record<string, unknown>;
  if (
    Array.isArray(v.d) &&
    typeof v.e === "number" &&
    typeof v.s === "number" &&
    typeof (val as { toFixed?: (n?: number) => string }).toFixed === "function"
  ) {
    return true;
  }
  return false;
}

/**
 * Recursively convert Prisma Decimal / BigInt values to JSON-safe primitives
 * in-place (mutates). Avoids the old JSON.parse(JSON.stringify()) roundtrip
 * which doubled memory allocation and CPU on every response.
 */
export function toJsonSafe<T>(value: T): T {
  return walkConvert(value) as T;
}

function walkConvert(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "bigint") return val.toString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val !== "object") return val;
  // val is now `object` — check Decimal before array/plain-object.
  if (isDecimal(val)) return val.toString();
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      val[i] = walkConvert(val[i]);
    }
    return val;
  }
  const obj = val as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    obj[key] = walkConvert(obj[key]);
  }
  return obj;
}
