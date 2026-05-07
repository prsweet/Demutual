/** Prisma `Decimal` / `decimal.js` — not JSON-serializable by default; breaks some HTTP serializers. */
function isDecimal(val: unknown): val is { toString: () => string } {
  if (typeof val !== "object" || val === null || val instanceof Date) return false;
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
 * Deep-clone through JSON with Prisma-friendly scalars so Elysia/Bun can return bodies safely.
 */
export function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, jsonReplacer)) as T;
}

function jsonReplacer(_key: string, val: unknown): unknown {
  if (typeof val === "bigint") return val.toString();
  if (isDecimal(val)) return val.toString();
  return val;
}
