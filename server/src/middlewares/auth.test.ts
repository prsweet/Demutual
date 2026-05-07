import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sign } from "jsonwebtoken";
import { authMiddlewares } from "./auth";
import { prisma } from "../db";

describe("authMiddlewares (current behavior)", () => {
  const originalFindFirst = prisma.bucket.findFirst;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  afterEach(() => {
    (prisma.bucket as any).findFirst = originalFindFirst;
  });

  it("returns an unauthorized response for invalid token", async () => {
    const result = await authMiddlewares.requireAuth({
      headers: { authorization: "Bearer invalid-token" },
      userId: undefined,
    } as any);

    expect(result).toBeDefined();
  });

  it("does not persist userId to caller context on valid token", async () => {
    const token = sign({ userId: "user-1" }, process.env.JWT_SECRET!);
    const ctx = {
      headers: { authorization: `Bearer ${token}` },
      userId: undefined as string | undefined,
    };

    const result = await authMiddlewares.requireAuth(ctx as any);

    expect(result).toBeUndefined();
    expect(ctx.userId).toBeUndefined();
  });

  it("returns creator-required response when creator is not found", async () => {
    (prisma.bucket as any).findFirst = async () => null;

    const result = await authMiddlewares.requireBucketCreator({
      userId: "missing-user",
    } as any);

    expect(result).toBeDefined();
  });

  it("returns undefined when creator exists", async () => {
    (prisma.bucket as any).findFirst = async () => ({ id: "bucket-1", creatorId: "creator-1" });

    const result = await authMiddlewares.requireBucketCreator({
      userId: "creator-1",
    } as any);

    expect(result).toBeUndefined();
  });

  it("does NOT persist when assigning destructured userId", async () => {
      const token = sign({ userId: "user-1" }, process.env.JWT_SECRET!);
      const ctx = {
        headers: { authorization: `Bearer ${token}` },
        userId: undefined as string | undefined,
      };
      const result = await authMiddlewares.requireAuth(ctx as any);
      expect(result).toBeUndefined();
      expect(ctx.userId).toBeUndefined();
  });
  
  let token: string;
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    token = sign({ userId: "user-1" }, process.env.JWT_SECRET!);
  });
});
