import Elysia from "elysia";
import { bucketControllers } from "../controllers/bucketControllers";
import { jupiterInvestControllers } from "../controllers/jupiterInvestController";
import { authMiddlewares } from "../middlewares/auth";
import {
  addBucketAssetsSchema,
  createBucketSchema,
  investInBucketSchema,
  jupiterInvestCompleteSchema,
  jupiterInvestPlanSchema,
  listBucketsQuerySchema
} from "../types";

/** Flat routes under `/buckets` — nested `group("/")` was omitting POST /buckets and creator paths in Elysia. */
const creatorOnly = [authMiddlewares.requireAuth, authMiddlewares.requireBucketCreator];

export const bucketRoutes = new Elysia({ prefix: "/buckets" })
  .get("/", bucketControllers.getAllBuckets, { query: listBucketsQuerySchema })
  .get("/:id", bucketControllers.getBucketById)
  .post("/", bucketControllers.createBucket, {
    beforeHandle: authMiddlewares.requireAuth,
    body: createBucketSchema
  })
  .post("/:id/invest", bucketControllers.investInBucket, {
    beforeHandle: authMiddlewares.requireAuth,
    body: investInBucketSchema
  })
  .post("/:id/invest/jupiter-plan", jupiterInvestControllers.buildJupiterPlan, {
    beforeHandle: authMiddlewares.requireAuth,
    body: jupiterInvestPlanSchema
  })
  .post("/:id/invest/jupiter-complete", jupiterInvestControllers.completeJupiterInvest, {
    beforeHandle: authMiddlewares.requireAuth,
    body: jupiterInvestCompleteSchema
  })
  .post("/:id/creator/assets", bucketControllers.addBucketAssets, {
    beforeHandle: creatorOnly,
    body: addBucketAssetsSchema
  })
  .post("/:id/creator/publish", bucketControllers.publishBucket, {
    beforeHandle: creatorOnly
  })
  .post("/:id/creator/versions", bucketControllers.forkBucketVersion, {
    beforeHandle: creatorOnly
  });
