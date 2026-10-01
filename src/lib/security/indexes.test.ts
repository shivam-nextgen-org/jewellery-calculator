import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ensureIndexes,
  INDEX_SPECS,
  IndexSafetyError,
  planCollectionIndexes,
  type IndexSpec,
} from "@/lib/security/indexes";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const emailSpec = INDEX_SPECS.find((spec) => spec.name === "User_email_key") as IndexSpec;

describe("index specs", () => {
  it("require the existing unique indexes on User.email and ApiKey.prefix", () => {
    expect(emailSpec).toMatchObject({ collection: "User", key: { email: 1 }, unique: true });
    expect(INDEX_SPECS).toContainEqual(
      expect.objectContaining({ collection: "ApiKey", key: { prefix: 1 }, unique: true }),
    );
  });

  it("have unique names and TTLs only on single date fields", () => {
    const names = INDEX_SPECS.map((spec) => `${spec.collection}.${spec.name}`);
    expect(new Set(names).size).toBe(names.length);
    for (const spec of INDEX_SPECS.filter((s) => s.expireAfterSeconds !== undefined)) {
      expect(Object.keys(spec.key)).toHaveLength(1);
    }
    expect(
      INDEX_SPECS.some((s) => s.collection === "SecurityAdminAction" && s.expireAfterSeconds !== undefined),
    ).toBe(false);
  });
});

describe("planCollectionIndexes (pure)", () => {
  it("accepts an equivalent index under a different name", () => {
    const [item] = planCollectionIndexes([emailSpec], [
      { name: "email_1", key: { email: 1 }, unique: true },
    ]);
    expect(item).toMatchObject({ status: "OK", existingName: "email_1" });
  });

  it("flags a non-unique index on the same key as a conflict", () => {
    const [item] = planCollectionIndexes([emailSpec], [{ name: "email_1", key: { email: 1 } }]);
    expect(item.status).toBe("CONFLICT");
  });

  it("flags a same-name index with a different key as a conflict", () => {
    const [item] = planCollectionIndexes([emailSpec], [
      { name: "User_email_key", key: { name: 1 }, unique: true },
    ]);
    expect(item.status).toBe("CONFLICT");
  });

  it("does not treat a compound key with the same fields in another order as equal", () => {
    const spec: IndexSpec = { collection: "X", name: "x", key: { a: 1, b: 1 } };
    const [item] = planCollectionIndexes([spec], [{ name: "b_a", key: { b: 1, a: 1 } }]);
    expect(item.status).toBe("MISSING");
  });
});

describe("ensureIndexes (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;

  beforeAll(async () => {
    mem = await startMemoryDb();
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());
  beforeEach(async () => mem.reset());

  it("verify is read-only", async () => {
    const report = await ensureIndexes(mem.db, "verify");
    expect(report.items.every((item) => item.status === "MISSING")).toBe(true);
    expect(report.items.every((item) => item.action === "would-create")).toBe(true);
    const collections = await mem.db.listCollections().toArray();
    expect(collections).toHaveLength(0);
  });

  it("apply creates everything once and is idempotent", async () => {
    const first = await ensureIndexes(mem.db, "apply");
    expect(first.items.every((item) => item.action === "created")).toBe(true);

    const second = await ensureIndexes(mem.db, "apply");
    expect(second.items.every((item) => item.status === "OK" && item.action === "none")).toBe(true);

    const verify = await ensureIndexes(mem.db, "verify");
    expect(verify.items.every((item) => item.status === "OK")).toBe(true);
  });

  it("enforces uniqueness on User.email and ApiKey.prefix", async () => {
    await ensureIndexes(mem.db, "apply");
    await mem.db.collection("User").insertOne({ email: "a@example.com" });
    await expect(
      mem.db.collection("User").insertOne({ email: "a@example.com" }),
    ).rejects.toMatchObject({ code: 11000 });

    await mem.db.collection("ApiKey").insertOne({ prefix: "atl_abcdefgh", userId: new ObjectId() });
    await expect(
      mem.db.collection("ApiKey").insertOne({ prefix: "atl_abcdefgh", userId: new ObjectId() }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("keeps a Prisma-created index as-is and never drops unrelated indexes", async () => {
    await mem.db.collection("User").createIndex({ email: 1 }, { unique: true, name: "email_1" });
    await mem.db.collection("User").createIndex({ name: 1 }, { name: "custom_name_idx" });

    await ensureIndexes(mem.db, "apply");
    const names = (await mem.db.collection("User").listIndexes().toArray()).map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["_id_", "email_1", "custom_name_idx"]));
    expect(names).not.toContain("User_email_key");
  });

  it("refuses to build a unique index over duplicates and changes nothing", async () => {
    await mem.db.collection("User").insertMany([
      { email: "dup@example.com" },
      { email: "dup@example.com" },
      { email: "other@example.com" },
    ]);

    const error = await ensureIndexes(mem.db, "apply").catch((e) => e);
    expect(error).toBeInstanceOf(IndexSafetyError);
    expect(error.message).toMatch(/1 duplicate key group\(s\) across 2 document\(s\)/);
    expect(error.message).not.toContain("dup@example.com");

    expect(await mem.db.collection("User").countDocuments()).toBe(3);
    const names = (await mem.db.collection("User").listIndexes().toArray()).map((i) => i.name);
    expect(names).toEqual(["_id_"]);
  });

  it("stops on a conflicting existing index instead of replacing it", async () => {
    await mem.db.collection("User").createIndex({ email: 1 }, { name: "email_1" }); // not unique
    await expect(ensureIndexes(mem.db, "apply")).rejects.toThrow(/Index conflict on User/);
    const indexes = await mem.db.collection("User").listIndexes().toArray();
    expect(indexes.find((i) => i.name === "email_1")?.unique).toBeUndefined();
  });

  it("creates TTL indexes for events, sessions and revoked devices", async () => {
    await ensureIndexes(mem.db, "apply");
    for (const [collection, name] of [
      ["SecurityEvent", "event_expiresAt_ttl"],
      ["SecuritySession", "session_expiresAt_ttl"],
      ["SecurityDevice", "device_purgeAt_ttl"],
    ]) {
      const index = (await mem.db.collection(collection).listIndexes().toArray()).find(
        (i) => i.name === name,
      );
      expect(index?.expireAfterSeconds).toBe(0);
    }
  });
});
