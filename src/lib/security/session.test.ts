import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSecurityConfig } from "@/lib/security/config";
import { ensureIndexes } from "@/lib/security/indexes";
import {
  countActiveSessions,
  createServerSession,
  evaluateSession,
  hashSessionId,
  lookupSession,
  revokeSession,
  sessionRef,
} from "@/lib/security/session";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const DAY = 24 * 60 * 60 * 1000;
const config = getSecurityConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

describe("server sessions (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  const userId = new ObjectId();
  const deviceId = new ObjectId();

  beforeAll(async () => {
    mem = await startMemoryDb();
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
  });

  it("creates a session with the required fields and stores only a hash", async () => {
    const now = new Date("2026-03-01T10:00:00Z");
    const { sessionId, session } = await createServerSession(
      mem.db,
      { userId, deviceId, now },
      config,
    );

    expect(sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session).toMatchObject({
      userId,
      deviceId,
      status: "ACTIVE",
      rememberMe: false,
      createdAt: now,
      lastActivityAt: now,
      revokedAt: null,
      revokedReason: null,
    });
    expect(session.expiresAt.getTime() - now.getTime()).toBe(7 * DAY);

    const stored = await mem.db.collection("SecuritySession").findOne({ _id: session._id });
    expect(stored?.sessionIdHash).toBe(hashSessionId(sessionId));
    expect(JSON.stringify(stored)).not.toContain(sessionId);
  });

  it("uses the remember-me lifetime, capped by the retention maximum", async () => {
    const now = new Date();
    const { session } = await createServerSession(
      mem.db,
      { userId, deviceId, rememberMe: true, now },
      config,
    );
    const days = (session.expiresAt.getTime() - now.getTime()) / DAY;
    expect(days).toBe(30);
    expect(days).toBeLessThanOrEqual(config.retention.sessionMaxDays);
  });

  it("looks up a valid session and rejects unknown or malformed ids", async () => {
    const { sessionId } = await createServerSession(mem.db, { userId, deviceId }, config);
    expect((await lookupSession(mem.db, sessionId)).state).toBe("VALID");
    const lastChar = sessionId.at(-1) === "A" ? "B" : "A";
    expect((await lookupSession(mem.db, `${sessionId.slice(0, 42)}${lastChar}`)).state).toBe(
      "NOT_FOUND",
    );
    expect((await lookupSession(mem.db, hashSessionId(sessionId))).state).toBe(
      "NOT_FOUND",
    );
    expect((await lookupSession(mem.db, undefined)).state).toBe("NOT_FOUND");
  });

  it("reports expiry even before the TTL monitor removes the document", async () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const { sessionId } = await createServerSession(
      mem.db,
      { userId, deviceId, now: created },
      config,
    );
    const justBefore = new Date(created.getTime() + 7 * DAY - 1);
    const atExpiry = new Date(created.getTime() + 7 * DAY);
    expect((await lookupSession(mem.db, sessionId, justBefore)).state).toBe("VALID");
    expect((await lookupSession(mem.db, sessionId, atExpiry)).state).toBe("EXPIRED");
  });

  it("revokes a session once, idempotently, and it stops validating", async () => {
    const { sessionId } = await createServerSession(mem.db, { userId, deviceId }, config);
    expect(await revokeSession(mem.db, sessionId, "LOGOUT")).toBe(true);
    expect(await revokeSession(mem.db, sessionId, "ADMIN")).toBe(false);

    const state = await lookupSession(mem.db, sessionId);
    expect(state.state).toBe("REVOKED");
    if (state.state === "REVOKED") {
      expect(state.session.revokedReason).toBe("LOGOUT");
      expect(state.session.revokedAt).toBeInstanceOf(Date);
    }
    expect(await revokeSession(mem.db, "garbage", "LOGOUT")).toBe(false);
  });

  it("counts only live sessions for a user", async () => {
    // Distinct devices: I2 allows at most one ACTIVE session per device.
    const a = await createServerSession(mem.db, { userId, deviceId }, config);
    await createServerSession(mem.db, { userId, deviceId: new ObjectId() }, config);
    await createServerSession(mem.db, { userId: new ObjectId(), deviceId: new ObjectId() }, config);
    await createServerSession(
      mem.db,
      { userId, deviceId: new ObjectId(), now: new Date(Date.now() - 8 * DAY) },
      config,
    );
    expect(await countActiveSessions(mem.db, userId)).toBe(2);
    await revokeSession(mem.db, a.sessionId, "EVICTED");
    expect(await countActiveSessions(mem.db, userId)).toBe(1);
  });

  it("gives a log-safe reference that is not the id or its full hash", async () => {
    const { sessionId } = await createServerSession(mem.db, { userId, deviceId }, config);
    const ref = sessionRef(sessionId);
    expect(ref).toMatch(/^[a-f0-9]{16}$/);
    expect(sessionId).not.toContain(ref);
    expect(ref).not.toBe(hashSessionId(sessionId));
  });
});

describe("evaluateSession (pure)", () => {
  it("treats a revokedAt timestamp as revoked even if status is stale", () => {
    const now = new Date();
    const state = evaluateSession(
      {
        _id: new ObjectId(),
        sessionIdHash: "x",
        userId: new ObjectId(),
        deviceId: new ObjectId(),
        status: "ACTIVE",
        rememberMe: false,
        createdAt: now,
        lastActivityAt: now,
        expiresAt: new Date(now.getTime() + DAY),
        revokedAt: now,
        revokedReason: "ADMIN",
      },
      now,
    );
    expect(state.state).toBe("REVOKED");
  });
});
