import Elysia from "elysia";
import { userControllers } from "../controllers/userController";
import { authMiddlewares } from "../middlewares/auth";

export const userRoutes = new Elysia({ prefix: "/users" })
  .get("/me", userControllers.getMe, { beforeHandle: authMiddlewares.requireAuth })
  .get("/me/deposits", userControllers.getMyDeposits, { beforeHandle: authMiddlewares.requireAuth });
