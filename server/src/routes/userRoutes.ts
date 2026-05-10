import Elysia, { t } from "elysia";
import { basketAttemptControllers } from "../controllers/basketAttemptController";
import { userControllers } from "../controllers/userController";
import { authMiddlewares } from "../middlewares/auth";
import { myAttemptsQuerySchema, paginationQuerySchema } from "../types";

export const userRoutes = new Elysia({ prefix: "/users" })
  .get("/me", userControllers.getMe, { beforeHandle: authMiddlewares.requireAuth })
  .get("/me/deposits", userControllers.getMyDeposits, {
    beforeHandle: authMiddlewares.requireAuth,
    query: paginationQuerySchema
  })
  .get("/me/attempts", basketAttemptControllers.listMyAttempts, {
    beforeHandle: authMiddlewares.requireAuth,
    query: myAttemptsQuerySchema
  });

/** Top-level attempt abandon — direction-agnostic, mounted off the API root. */
export const attemptRoutes = new Elysia({ prefix: "/attempts" }).post(
  "/:attemptId/abandon",
  basketAttemptControllers.abandonAttempt,
  {
    beforeHandle: authMiddlewares.requireAuth,
    params: t.Object({ attemptId: t.String({ minLength: 1 }) })
  }
);
