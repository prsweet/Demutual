import { t, type Context, type Static } from "elysia";

export type decoratedContext<T extends Context> = T & {
  userId?: string
}

export const walletAuthSchema = t.Object({
  address: t.String(),
  details: t.Object({ nonce: t.String(), message: t.String() }),
  signature: t.String(),
  username: t.Optional(t.String())
});

export type walletAuthSchema = Static<typeof walletAuthSchema>;

export const nonceCreateSchema = t.Object({
  address: t.String()
});

export type nonceCreateSchema = Static<typeof nonceCreateSchema>;

export const createBucketSchema = t.Object({
  name: t.String(),
  estimatedApy: t.Number(),
  metaData: t.Optional(t.Any())
});

export type createBucketSchema = Static<typeof createBucketSchema>;

type responseType = {
  success: true,
  data: object,
  error: null
} | {
  success: false,
  data: null,
  error: string
};

type overLoadResponse = {
  (success: true, data: object, error: null): responseType
  (success: false, data: null, error: string): responseType
}

export const response: overLoadResponse = (success: boolean, data: object | null, error: string | null) => {
  return { success, data, error } as responseType;
}

export const errors = {
  typeBox400: "INVALID_REQUEST",
  nonce402: "INVALID_OR_EXPIRED_NONCE",
  emailConflict409: "EMAIL_ALREADY_EXISTS",
  bucketConflict409: "BUCKET_ALREADY_EXISTS",
  unauthorized401: "UNAUTHORIZED",
  serverError500: "INTERNAL_SERVER_ERROR",
  bucketCreator403: "BUCKET_CREATOR_REQUIRED",
  bucketNotFound404: "BUCKET_NOT_FOUND"
}