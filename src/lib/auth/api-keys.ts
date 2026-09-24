import { createHash, randomBytes } from "crypto";
import { headers } from "next/headers";
import { getDb, idOf, ObjectId, oid } from "@/lib/mongo";
import type { SessionUser } from "@/lib/auth/token";

function hashKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey() {
  const secret = randomBytes(24).toString("base64url");
  const raw = `atl_${secret}`;
  return {
    raw,
    prefix: raw.slice(0, 12),
    keyHash: hashKey(raw),
  };
}

export async function listApiKeys(userId: string) {
  const db = await getDb();
  const rows = await db
    .collection("ApiKey")
    .find({ userId: oid(userId) })
    .sort({ createdAt: -1 })
    .toArray();
  return rows.map((row) => ({
    id: idOf(row._id),
    name: row.name as string,
    prefix: row.prefix as string,
    lastUsedAt: (row.lastUsedAt as Date | null) ?? null,
    revokedAt: (row.revokedAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
  }));
}

export async function createApiKey(userId: string, name: string) {
  const db = await getDb();
  const user = await db.collection("User").findOne({ _id: oid(userId) });
  if (!user || user.role !== "USER") throw new Error("User not found.");
  if (!user.isActive) throw new Error("User is disabled.");
  const label = name.trim() || "Default";
  const generated = generateApiKey();
  const now = new Date();
  const doc = {
    _id: new ObjectId(),
    userId: oid(userId),
    name: label,
    prefix: generated.prefix,
    keyHash: generated.keyHash,
    lastUsedAt: null as Date | null,
    revokedAt: null as Date | null,
    createdAt: now,
  };
  await db.collection("ApiKey").insertOne(doc);
  return {
    id: idOf(doc._id),
    name: doc.name,
    prefix: doc.prefix,
    createdAt: doc.createdAt,
    token: generated.raw,
  };
}

export async function revokeApiKey(userId: string, keyId: string) {
  const db = await getDb();
  const key = await db.collection("ApiKey").findOne({
    _id: oid(keyId),
    userId: oid(userId),
  });
  if (!key) throw new Error("API key not found.");
  const revokedAt = new Date();
  await db.collection("ApiKey").updateOne(
    { _id: oid(keyId) },
    { $set: { revokedAt } },
  );
  return {
    id: keyId,
    name: key.name as string,
    prefix: key.prefix as string,
    lastUsedAt: (key.lastUsedAt as Date | null) ?? null,
    revokedAt,
    createdAt: key.createdAt as Date,
  };
}

export async function resolveApiKeyUser(
  raw: string | null | undefined,
): Promise<SessionUser | null> {
  if (!raw || !raw.startsWith("atl_")) return null;
  const prefix = raw.slice(0, 12);
  const db = await getDb();
  const key = await db.collection("ApiKey").findOne({ prefix });
  if (!key || key.revokedAt) return null;
  if (key.keyHash !== hashKey(raw)) return null;
  const user = await db.collection("User").findOne({ _id: key.userId });
  if (!user?.isActive || user.role !== "USER") return null;

  void db.collection("ApiKey").updateOne(
    { _id: key._id },
    { $set: { lastUsedAt: new Date() } },
  );

  return {
    id: idOf(user._id),
    email: user.email as string,
    name: user.name as string,
    role: "USER",
  };
}

export function extractApiKeyFromHeaders(headerList: Headers) {
  const named = headerList.get("x-api-key");
  if (named) return named.trim();
  const auth = headerList.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export async function getApiKeySession(): Promise<SessionUser | null> {
  const headerList = await headers();
  return resolveApiKeyUser(extractApiKeyFromHeaders(headerList));
}
