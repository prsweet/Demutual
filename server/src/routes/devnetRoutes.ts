import Elysia from "elysia";
import { devnetControllers } from "../controllers/devnetController";

export const devnetRoutes = new Elysia({ prefix: "/devnet" }).get(
  "/airdrop",
  devnetControllers.requestDevnetAirdrop
);
