import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sign } from "jsonwebtoken";
import { authMiddlewares } from "./auth";
import { prisma } from "../db";

describe("authMiddlewares", () => {
  const originalFindUnique = prisma.bucket.findUnique;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  afterEach(() => {
    (prisma.bucket as unknown as { findUnique: typeof originalFindUnique }).findUnique =
      originalFindUnique;
  });

  it("returns unauthorized for invalid token", async () => {
    const result = await authMiddlewares.requireAuth({
      headers: { authorization: "Bearer invalid-token" },
      userId: undefined
    } as any);

    expect(result).toBeDefined();
  });

  it("persists userId on context for valid token", async () => {
    const token = sign({ userId: "user-1" }, process.env.JWT_SECRET!);
    const ctx = {
      headers: { authorization: `Bearer ${token}` },
      userId: undefined as string | undefined
    };

    const result = await authMiddlewares.requireAuth(ctx as any);

    expect(result).toBeUndefined();
    expect(ctx.userId).toBe("user-1");
  });

  it("requireBucketCreator returns 403 when bucket not owned", async () => {
    (prisma.bucket as unknown as { findUnique: () => Promise<{ id: string; creatorId: string } | null> }).findUnique =
      async () => ({ id: "b1", creatorId: "other" });

    const result = await authMiddlewares.requireBucketCreator({
      userId: "user-1",
      params: { id: "b1" }
    } as Parameters<typeof authMiddlewares.requireBucketCreator>[0]);

    expect(result).toBeDefined();
  });

  it("requireBucketCreator passes when user owns bucket", async () => {
    (prisma.bucket as unknown as { findUnique: () => Promise<{ id: string; creatorId: string } | null> }).findUnique =
      async () => ({ id: "b1", creatorId: "user-1" });

    const result = await authMiddlewares.requireBucketCreator({
      userId: "user-1",
      params: { id: "b1" }
    } as Parameters<typeof authMiddlewares.requireBucketCreator>[0]);

    expect(result).toBeUndefined();
  });
});
