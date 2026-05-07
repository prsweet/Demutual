import Elysia from "elysia";
import { assetControllers } from "../controllers/assetController";
import { authMiddlewares } from "../middlewares/auth";
import { upsertAssetSchema } from "../types";

export const assetRoutes = new Elysia();

assetRoutes.group("/assets", (app) => {
  app.onBeforeHandle(authMiddlewares.requireAuth);
  app.post("/", assetControllers.upsertAsset, { body: upsertAssetSchema });
  return app;
});
