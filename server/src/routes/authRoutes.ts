import Elysia from "elysia";
import { authControllers } from "../controllers/authController";
import { walletAuthSchema } from "../types";

export const authRoutes = new Elysia();

authRoutes.group('/auth', app => {
  app.post('/wallet-login', authControllers.walletLogin, { body: walletAuthSchema });
  return app;
});
