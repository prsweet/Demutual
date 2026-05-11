import Elysia from "elysia";
import { assetControllers } from "../controllers/assetController";
import { authMiddlewares } from "../middlewares/auth";
import { upsertAssetSchema } from "../types";

export const assetRoutes = new Elysia();

assetRoutes.get("/assets/catalog", assetControllers.listCatalog);

assetRoutes.group("/assets", (app) => {
  app.onBeforeHandle(authMiddlewares.requireAuth);
  app.get("/", assetControllers.listAssets);
  app.post("/", assetControllers.upsertAsset, { body: upsertAssetSchema });
  app.post("/sync-catalog", assetControllers.resyncCatalog);
  return app;
});
