import { Elysia, status } from "elysia";
import { authRoutes } from "./routes/authRoutes";
import { assetRoutes } from "./routes/assetRoutes";
import { errors, response } from "./types";
import { bucketRoutes } from "./routes/bucketRoutes";
new Elysia()
  .onError(({ code }) => {
    if (code === 'VALIDATION') return status(400, response(false, null, errors.typeBox400));
  })
  .use(authRoutes)
  .use(assetRoutes)
  .use(bucketRoutes)
  .listen(3000, () => console.log("server is listen to port:", 3000));
