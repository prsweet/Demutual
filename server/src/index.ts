import { cors } from "@elysiajs/cors";
import { Elysia, status } from "elysia";
import { API_ROUTE_MANIFEST } from "./constants/apiManifest";
import { corsOrigins, publicServiceInfo, serverPort } from "./config";
import { prisma } from "./db";
import { authRoutes } from "./routes/authRoutes";
import { assetRoutes } from "./routes/assetRoutes";
import { bucketRoutes } from "./routes/bucketRoutes";
import { devnetRoutes } from "./routes/devnetRoutes";
import { userRoutes } from "./routes/userRoutes";
import { errors, response } from "./types";
import { authPlugin } from "./middlewares/auth";

async function bootstrap() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      "DATABASE_URL is missing. Copy .env.example to .env in this folder, set DATABASE_URL, then run: bun run db:push"
    );
    process.exit(1);
  }

  if (!process.env.JWT_SECRET?.trim()) {
    console.error("JWT_SECRET is missing. Set it in .env (see server/.env.example).");
    process.exit(1);
  }

  try {
    await prisma.$connect();
  } catch (e) {
    console.error("Could not connect to Postgres. Check DATABASE_URL and that the server is running.", e);
    process.exit(1);
  }

  if (!process.env.SOLANA_RPC_URL?.trim() || !process.env.INVEST_TREASURY_PUBKEY?.trim()) {
    console.warn(
      "[config] On-chain invest is disabled until SOLANA_RPC_URL and INVEST_TREASURY_PUBKEY are set (use devnet URLs for demos)."
    );
  }

  new Elysia()
    .get("/", () =>
      status(
        200,
        response(
          true,
          {
            service: "demutual-api",
            health: "/health",
            routes: API_ROUTE_MANIFEST,
            config: publicServiceInfo()
          },
          null
        )
      )
    )
    .get("/favicon.ico", () => new Response(null, { status: 204 }))
    .get("/health", async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return status(200, response(true, { ok: true, ...publicServiceInfo() }, null));
      } catch (e) {
        console.error("[health]", e);
        return status(503, response(false, null, errors.serverError500));
      }
    })
    .use(
      cors({
        origin: corsOrigins(),
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization"]
      })
    )
    .onError(({ code, error }) => {
      if (code === "VALIDATION") return status(400, response(false, null, errors.typeBox400));
      if (code === "NOT_FOUND") {
        return status(404, response(false, null, errors.notFound404));
      }
      console.error("[elysia]", code, error);
      return status(500, response(false, null, errors.serverError500));
    })
    .use(authPlugin)
    .use(authRoutes)
    .use(userRoutes)
    .use(assetRoutes)
    .use(bucketRoutes)
    .use(devnetRoutes)
    .listen(serverPort(), () =>
      console.log(`Demutual API listening on http://localhost:${serverPort()} (GET /health)`)
    );
}

void bootstrap();
