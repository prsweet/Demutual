import Elysia from "elysia";
import { bucketControllers } from "../controllers/bucketControllers";
import { authMiddlewares } from "../middlewares/auth";
import { createBucketSchema } from "../types";

export const bucketRoutes = new Elysia();

bucketRoutes.group('/buckets', app => {
  app.get('/', bucketControllers.getAllBuckets);
  app.get('/:id', bucketControllers.getBucketById);
  app.get('/:id/performance', bucketControllers.getBucketById);
  app.group('/', app => {
    app.onBeforeHandle(authMiddlewares.requireAuth);
    app.post('/', bucketControllers.createBucket, { body: createBucketSchema });
    app.post('/:id/invest', bucketControllers.getBucketById);
    app.group('/creator', app => {
      app.onBeforeHandle(authMiddlewares.requireBucketCreator);
      // there will be other routes relateed to creator for bucket seeing and all
      return app;
    })
    return app;
  });
  return app;
});