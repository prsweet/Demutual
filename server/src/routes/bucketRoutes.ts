import Elysia from "elysia";
import { bucketControllers } from "../controllers/bucketControllers";
import { authMiddlewares } from "../middlewares/auth";
import {
  addBucketAssetsSchema,
  createBucketSchema,
  investInBucketSchema,
  listBucketsQuerySchema
} from "../types";

export const bucketRoutes = new Elysia();

bucketRoutes.group("/buckets", (app) => {
  app.get("/", bucketControllers.getAllBuckets, { query: listBucketsQuerySchema });
  app.get("/:id", bucketControllers.getBucketById);

  app.group("/", (authApp) => {
    authApp.onBeforeHandle(authMiddlewares.requireAuth);
    authApp.post("/", bucketControllers.createBucket, { body: createBucketSchema });

    authApp.group("/:id", (idApp) => {
      idApp.post("/invest", bucketControllers.investInBucket, {
        body: investInBucketSchema
      });

      idApp.group("/creator", (creatorApp) => {
        creatorApp.onBeforeHandle(authMiddlewares.requireBucketCreator);
        creatorApp.post("/assets", bucketControllers.addBucketAssets, {
          body: addBucketAssetsSchema
        });
        creatorApp.post("/publish", bucketControllers.publishBucket);
        creatorApp.post("/versions", bucketControllers.forkBucketVersion);
        return creatorApp;
      });

      return idApp;
    });

    return authApp;
  });

  return app;
});
