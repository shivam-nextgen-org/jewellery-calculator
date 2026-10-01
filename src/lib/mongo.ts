import { MongoClient, ObjectId, type Db } from "mongodb";

const globalForMongo = globalThis as unknown as {
  mongoClient?: MongoClient;
  mongoReady?: Promise<MongoClient>;
};

function mongoUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

export async function getMongo(): Promise<MongoClient> {
  if (globalForMongo.mongoClient) return globalForMongo.mongoClient;
  if (!globalForMongo.mongoReady) {
    const client = new MongoClient(mongoUrl(), {
      tls: true,
      tlsAllowInvalidCertificates: true,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    globalForMongo.mongoReady = client.connect().then(
      (connected) => {
        globalForMongo.mongoClient = connected;
        return connected;
      },
      (error) => {
        // Don't cache a failed connection: let the next request retry.
        globalForMongo.mongoReady = undefined;
        void client.close().catch(() => {});
        throw error;
      },
    );
  }
  return globalForMongo.mongoReady;
}

/** Database name taken from the connection string path (`...mongodb.net/<name>?...`), if any. */
export function databaseNameFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?#]*)/.exec(url.trim());
  const name = match ? decodeURIComponent(match[1]).trim() : "";
  return name || null;
}

/**
 * Database name, in priority order:
 *   1. DATABASE_NAME
 *   2. the database in DATABASE_URL (e.g. `/atelier-prod`)
 *   3. "atelier"
 */
export function databaseName(): string {
  return (
    process.env.DATABASE_NAME?.trim() ||
    databaseNameFromUrl(process.env.DATABASE_URL) ||
    "atelier"
  );
}

export async function getDb(): Promise<Db> {
  const client = await getMongo();
  return client.db(databaseName());
}

export function oid(id: string) {
  return new ObjectId(id);
}

export function idOf(value: ObjectId | string) {
  return typeof value === "string" ? value : value.toHexString();
}

export { ObjectId };
