import { Elysia, status } from "elysia";
import { authRoutes } from "./routes/authRoutes";
import { errors, response } from "./types";
new Elysia()
  .onError(({code}) => {
    if (code === 'VALIDATION') return status(400, response(false, null, errors.typeBox400));
  })
  .use(authRoutes)
  .listen(3000, () => console.log("server is listen to port:", 3000));
