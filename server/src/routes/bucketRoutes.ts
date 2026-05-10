import Elysia from "elysia";
import { bucketControllers } from "../controllers/bucketControllers";
import { jupiterInvestControllers } from "../controllers/jupiterInvestController";
import { jupiterSellControllers } from "../controllers/jupiterSellController";
import { authMiddlewares } from "../middlewares/auth";
import {
  addBucketAssetsSchema,
  createBucketSchema,
  investInBucketSchema,
  jupiterInvestCompleteSchema,
  jupiterExecuteSchema,
  jupiterInvestPlanSchema,
  jupiterLegOrderSchema,
  jupiterSellCompleteSchema,
  jupiterSellPlanSchema,
  listBucketsQuerySchema,
  withdrawBucketSchema,
  idParamSchema
} from "../types";

/** Flat routes under `/buckets` — nested `group("/")` was omitting POST /buckets and creator paths in Elysia. */
const creatorOnly = [authMiddlewares.requireAuth, authMiddlewares.requireBucketCreator];

export const bucketRoutes = new Elysia({ prefix: "/buckets" })
  .get("/", bucketControllers.getAllBuckets, { query: listBucketsQuerySchema })
  .get("/:id/my-position", bucketControllers.getMyBucketPosition, {
    beforeHandle: authMiddlewares.requireAuth,
    params: idParamSchema
  })
  .get("/:id", bucketControllers.getBucketById, {
    params: idParamSchema
  })
  .post("/", bucketControllers.createBucket, {
    beforeHandle: authMiddlewares.requireAuth,
    body: createBucketSchema
  })
  .post("/:id/invest", bucketControllers.investInBucket, {
    beforeHandle: authMiddlewares.requireAuth,
    body: investInBucketSchema,
    params: idParamSchema
  })
  .post("/:id/invest/jupiter-plan", jupiterInvestControllers.buildJupiterPlan, {
    beforeHandle: authMiddlewares.requireAuth,
    body: jupiterInvestPlanSchema,
    params: idParamSchema
  })
  .post("/:id/invest/jupiter-leg-order", jupiterInvestControllers.buildJupiterLegOrder, {
    beforeHandle: authMiddlewares.requireAuth,
    body: jupiterLegOrderSchema,
    params: idParamSchema
  })
  .post("/:id/invest/jupiter-execute", jupiterInvestControllers.executeJupiterOrder, {
    beforeHandle: authMiddlewares.requireAuth,
    body: jupiterExecuteSchema,
    params: idParamSchema
  })
  .post("/:id/invest/jupiter-complete", jupiterInvestControllers.completeJupiterInvest, {
    beforeHandle: authMiddlewares.requireAuth,
    body: jupiterInvestCompleteSchema,
    params: idParamSchema
  })
  .post("/:id/sell/jupiter-plan", jupiterSellControllers.buildJupiterSellPlan, {
    beforeHandle: authMiddlewares.requireAuth,
    body: jupiterSellPlanSchema,
    params: idParamSchema
  })
  .post("/:id/sell/jupiter-complete", jupiterSellControllers.completeJupiterSell, {
    beforeHandle: authMiddlewares.requireAuth,
    body: jupiterSellCompleteSchema,
    params: idParamSchema
  })
  .post("/:id/withdraw", bucketControllers.withdrawFromBucket, {
    beforeHandle: authMiddlewares.requireAuth,
    body: withdrawBucketSchema,
    params: idParamSchema
  })
  .post("/:id/creator/assets", bucketControllers.addBucketAssets, {
    beforeHandle: creatorOnly,
    body: addBucketAssetsSchema,
    params: idParamSchema
  })
  .post("/:id/creator/publish", bucketControllers.publishBucket, {
    beforeHandle: creatorOnly,
    params: idParamSchema
  })
  .post("/:id/creator/versions", bucketControllers.forkBucketVersion, {
    beforeHandle: creatorOnly,
    params: idParamSchema
  });
