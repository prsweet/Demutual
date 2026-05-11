import Elysia, { status, t } from "elysia";
import { toJsonSafe } from "../jsonSafe";
import { getTokenInfo } from "../services/tokenInfoService";
import { errors, response } from "../types";

/** Jupiter Tokens v2 wrapper — surfaces verification/sus/organicScore. API key stays server-side. */
export const tokenInfoRoutes = new Elysia({ prefix: "/token-info" }).get(
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
    const result = await getTokenInfo(mints);
    return status(200, response(true, toJsonSafe(result), null));
  },
  {
    query: t.Object({ mints: t.String({ minLength: 1 }) })
  }
);
