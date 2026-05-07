import Elysia from "elysia";
import { authControllers } from "../controllers/authController";
import { nonceCreateSchema, walletAuthSchema } from "../types";

export const authRoutes = new Elysia();

authRoutes.group('/auth', app => {
  app.get('/nonce', authControllers.getNonce, { query: nonceCreateSchema });
  app.post('/wallet-login', authControllers.walletLogin, { body: walletAuthSchema });
  return app;
});
