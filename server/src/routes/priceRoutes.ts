import Elysia, { status, t } from "elysia";
import { toJsonSafe } from "../jsonSafe";
import { getPrices } from "../services/priceService";
import { errors, response } from "../types";

/** Public USD price lookups (Jupiter Price v3 wrapper, cached server-side so the API key never leaves). */
export const priceRoutes = new Elysia({ prefix: "/prices" }).get(
  "/",
  async ({ query }) => {
    const raw = (query.mints ?? "").trim();
    if (!raw) return status(400, response(false, null, errors.typeBox400));
    const mints = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    if (mints.length === 0) return status(400, response(false, null, errors.typeBox400));
    const result = await getPrices(mints);
    return status(200, response(true, toJsonSafe(result), null));
  },
  {
    query: t.Object({ mints: t.String({ minLength: 1 }) })
  }
);
