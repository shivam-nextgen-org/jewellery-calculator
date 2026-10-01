import { MongoServerError, type Db, type Document, type IndexSpecification } from "mongodb";
import { SECURITY_COLLECTIONS } from "@/lib/security/collections";

/**
 * Index ownership (ADR-014).
 *
 * `ensureIndexes()` is idempotent and conservative:
 * - it never drops or modifies an existing index and never touches data;
 * - an existing index with the same key and the same options satisfies a
 *   spec regardless of its name (Prisma may already have created it);
 * - an existing index with the same key/name but different options is a
 *   CONFLICT and is reported, not "fixed";
 * - before building a unique index it checks for duplicates and fails with
 *   counts only (never the duplicate values, which may be PII).
 *
 * It is NOT run at application startup: production indexes are created in a
 * controlled deployment step via `npm run security:indexes`.
 */

export type IndexSpec = {
  collection: string;
  name: string;
  key: Record<string, 1 | -1>;
  unique?: boolean;
  /** TTL: documents expire `expireAfterSeconds` after the date in the (single) key field. */
  expireAfterSeconds?: number;
  /** Partial index: only documents matching this filter are indexed. */
  partialFilterExpression?: Document;
  /** Pre-existing index declared in prisma/schema.prisma (name follows Prisma's convention). */
  prismaDeclared?: boolean;
};

export const INDEX_SPECS: IndexSpec[] = [
  // Existing, declared in prisma/schema.prisma. Required before enforcement.
  { collection: "User", name: "User_email_key", key: { email: 1 }, unique: true, prismaDeclared: true },
  { collection: "ApiKey", name: "ApiKey_prefix_key", key: { prefix: 1 }, unique: true, prismaDeclared: true },
  { collection: "ApiKey", name: "ApiKey_userId_idx", key: { userId: 1 }, prismaDeclared: true },

  // Devices: lookup by secret hash; list/count per user; TTL purge of revoked devices.
  { collection: SECURITY_COLLECTIONS.device, name: "device_secretHash_unique", key: { secretHash: 1 }, unique: true },
  { collection: SECURITY_COLLECTIONS.device, name: "device_userId_status", key: { userId: 1, status: 1 } },
  // I3: admin pending-approval queue and expiry sweep (oldest first).
  { collection: SECURITY_COLLECTIONS.device, name: "device_status_createdAt", key: { status: 1, createdAt: 1 } },
  { collection: SECURITY_COLLECTIONS.device, name: "device_purgeAt_ttl", key: { purgeAt: 1 }, expireAfterSeconds: 0 },

  // Sessions: lookup by id hash; active per user / per device; TTL purge at expiry.
  { collection: SECURITY_COLLECTIONS.session, name: "session_sessionIdHash_unique", key: { sessionIdHash: 1 }, unique: true },
  { collection: SECURITY_COLLECTIONS.session, name: "session_userId_status", key: { userId: 1, status: 1 } },
  { collection: SECURITY_COLLECTIONS.session, name: "session_deviceId_status", key: { deviceId: 1, status: 1 } },
  // Race backstop: at most one ACTIVE session per device (I2 "re-login replaces").
  {
    collection: SECURITY_COLLECTIONS.session,
    name: "session_active_per_device_unique",
    key: { deviceId: 1 },
    unique: true,
    partialFilterExpression: { status: "ACTIVE" },
  },
  { collection: SECURITY_COLLECTIONS.session, name: "session_expiresAt_ttl", key: { expiresAt: 1 }, expireAfterSeconds: 0 },

  // Security events: per-user timeline, per-type monitoring, TTL retention.
  { collection: SECURITY_COLLECTIONS.event, name: "event_userId_occurredAt", key: { userId: 1, occurredAt: -1 } },
  { collection: SECURITY_COLLECTIONS.event, name: "event_type_occurredAt", key: { type: 1, occurredAt: -1 } },
  { collection: SECURITY_COLLECTIONS.event, name: "event_expiresAt_ttl", key: { expiresAt: 1 }, expireAfterSeconds: 0 },

  // I5 risk history: per-customer timeline; TTL retention (180 days).
  { collection: SECURITY_COLLECTIONS.riskAssessment, name: "risk_userId_evaluatedAt", key: { userId: 1, evaluatedAt: -1 } },
  { collection: SECURITY_COLLECTIONS.riskAssessment, name: "risk_expiresAt_ttl", key: { expiresAt: 1 }, expireAfterSeconds: 0 },

  // I6 restrictions: per-customer history (no TTL: security record). Expiry
  // sweep over accounts holding a restriction pointer.
  { collection: SECURITY_COLLECTIONS.restriction, name: "restriction_userId_createdAt", key: { userId: 1, createdAt: -1 } },
  {
    collection: SECURITY_COLLECTIONS.account,
    name: "account_restriction_expiresAt",
    key: { "restriction.expiresAt": 1 },
    partialFilterExpression: { "restriction.expiresAt": { $type: "date" } },
  },

  // Admin audit: no TTL (>= 2 years retention).
  { collection: SECURITY_COLLECTIONS.adminAction, name: "adminAction_targetUserId_occurredAt", key: { targetUserId: 1, occurredAt: -1 } },
  { collection: SECURITY_COLLECTIONS.adminAction, name: "adminAction_adminId_occurredAt", key: { adminId: 1, occurredAt: -1 } },
];

export type ExistingIndex = {
  name: string;
  key: Record<string, unknown>;
  unique?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Document;
  sparse?: boolean;
};

export type IndexPlanStatus = "OK" | "MISSING" | "CONFLICT";

export type IndexPlanItem = {
  spec: IndexSpec;
  status: IndexPlanStatus;
  /** Name of the existing index that satisfies or conflicts with the spec. */
  existingName?: string;
  detail?: string;
};

function sameKey(a: Record<string, unknown>, b: Record<string, unknown>) {
  const ea = Object.entries(a);
  const eb = Object.entries(b);
  return (
    ea.length === eb.length &&
    ea.every(([k, v], i) => eb[i][0] === k && Number(eb[i][1]) === Number(v))
  );
}

function optionDifferences(spec: IndexSpec, existing: ExistingIndex): string[] {
  const diffs: string[] = [];
  if (Boolean(spec.unique) !== Boolean(existing.unique)) {
    diffs.push(spec.unique ? "existing index is not unique" : "existing index is unique");
  }
  if (spec.expireAfterSeconds !== existing.expireAfterSeconds) {
    diffs.push("TTL setting differs");
  }
  const wantPartial = spec.partialFilterExpression
    ? JSON.stringify(spec.partialFilterExpression)
    : null;
  const havePartial = existing.partialFilterExpression
    ? JSON.stringify(existing.partialFilterExpression)
    : null;
  if (wantPartial !== havePartial) {
    diffs.push(
      havePartial ? "partial filter differs" : "existing index is not partial",
    );
  }
  if (existing.sparse) diffs.push("existing index is sparse");
  return diffs;
}

/** Pure: compare desired specs of one collection with its existing indexes. */
export function planCollectionIndexes(
  specs: IndexSpec[],
  existing: ExistingIndex[],
): IndexPlanItem[] {
  return specs.map((spec) => {
    const byKey = existing.find((index) => sameKey(index.key, spec.key));
    if (byKey) {
      const diffs = optionDifferences(spec, byKey);
      return diffs.length === 0
        ? { spec, status: "OK", existingName: byKey.name }
        : { spec, status: "CONFLICT", existingName: byKey.name, detail: diffs.join("; ") };
    }
    const byName = existing.find((index) => index.name === spec.name);
    if (byName) {
      return {
        spec,
        status: "CONFLICT",
        existingName: byName.name,
        detail: "an index with this name exists with a different key",
      };
    }
    return { spec, status: "MISSING" };
  });
}

export class IndexSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexSafetyError";
  }
}

async function listIndexes(db: Db, collection: string): Promise<ExistingIndex[]> {
  try {
    return (await db.collection(collection).listIndexes().toArray()) as ExistingIndex[];
  } catch (error) {
    // NamespaceNotFound: the collection doesn't exist yet → no indexes.
    if (error instanceof MongoServerError && error.code === 26) return [];
    throw error;
  }
}

/** Counts groups of documents that would violate a unique index. Values are never returned. */
export async function countDuplicateKeys(
  db: Db,
  spec: IndexSpec,
): Promise<{ duplicateGroups: number; affectedDocuments: number }> {
  const groupId = Object.fromEntries(
    Object.keys(spec.key).map((field) => [field.replace(/\./g, "_"), `$${field}`]),
  );
  const [result] = await db
    .collection(spec.collection)
    .aggregate<{ duplicateGroups: number; affectedDocuments: number }>(
      [
        ...(spec.partialFilterExpression
          ? [{ $match: spec.partialFilterExpression }]
          : []),
        { $group: { _id: groupId, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        {
          $group: {
            _id: null,
            duplicateGroups: { $sum: 1 },
            affectedDocuments: { $sum: "$n" },
          },
        },
        { $project: { _id: 0, duplicateGroups: 1, affectedDocuments: 1 } },
      ],
      { allowDiskUse: true },
    )
    .toArray();
  return result ?? { duplicateGroups: 0, affectedDocuments: 0 };
}

export type EnsureIndexesMode = "verify" | "apply";

export type EnsureIndexesReport = {
  mode: EnsureIndexesMode;
  items: (IndexPlanItem & { action: "none" | "created" | "would-create" })[];
  ok: boolean;
};

function toIndexOptions(spec: IndexSpec) {
  return {
    name: spec.name,
    ...(spec.unique ? { unique: true } : {}),
    ...(spec.expireAfterSeconds !== undefined
      ? { expireAfterSeconds: spec.expireAfterSeconds }
      : {}),
    ...(spec.partialFilterExpression
      ? { partialFilterExpression: spec.partialFilterExpression }
      : {}),
  };
}

/**
 * verify: read-only. Reports OK / MISSING / CONFLICT for every spec.
 * apply:  creates MISSING indexes only. Any CONFLICT or duplicate data stops
 *         the run before anything is created for that collection.
 */
export async function ensureIndexes(
  db: Db,
  mode: EnsureIndexesMode,
  specs: IndexSpec[] = INDEX_SPECS,
): Promise<EnsureIndexesReport> {
  const collections = [...new Set(specs.map((spec) => spec.collection))];
  const items: EnsureIndexesReport["items"] = [];

  for (const collection of collections) {
    const plan = planCollectionIndexes(
      specs.filter((spec) => spec.collection === collection),
      await listIndexes(db, collection),
    );

    if (mode === "verify") {
      for (const item of plan) {
        items.push({ ...item, action: item.status === "MISSING" ? "would-create" : "none" });
      }
      continue;
    }

    const conflict = plan.find((item) => item.status === "CONFLICT");
    if (conflict) {
      throw new IndexSafetyError(
        `Index conflict on ${collection}.${conflict.spec.name} (existing "${conflict.existingName}"): ${conflict.detail}. Nothing was changed for this collection; resolve manually.`,
      );
    }

    for (const item of plan) {
      if (item.status !== "MISSING") {
        items.push({ ...item, action: "none" });
        continue;
      }
      if (item.spec.unique) {
        const dupes = await countDuplicateKeys(db, item.spec);
        if (dupes.duplicateGroups > 0) {
          throw new IndexSafetyError(
            `Cannot create unique index ${collection}.${item.spec.name}: ${dupes.duplicateGroups} duplicate key group(s) across ${dupes.affectedDocuments} document(s). Resolve duplicates manually; no data was changed.`,
          );
        }
      }
      try {
        await db
          .collection(collection)
          .createIndex(item.spec.key as IndexSpecification, toIndexOptions(item.spec));
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          throw new IndexSafetyError(
            `Unique index ${collection}.${item.spec.name} failed: duplicate keys were written during the build. No data was changed; re-run after resolving duplicates.`,
          );
        }
        throw error;
      }
      items.push({ ...item, action: "created" });
    }
  }

  return {
    mode,
    items,
    ok: items.every((item) => item.status !== "CONFLICT"),
  };
}
