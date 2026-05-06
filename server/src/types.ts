import { t, type Static } from "elysia";

export const walletAuthSchema = t.Object({
  address: t.String(),
  details: t.Object({ nonce: t.String(), message: t.String() }),
  signature: t.String()
});

export type walletAuthSchema = Static<typeof walletAuthSchema>;

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
}