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

/** Database name. Set DATABASE_NAME per environment (e.g. "atelier-prod"); defaults to "atelier". */
export function databaseName(): string {
  return process.env.DATABASE_NAME?.trim() || "atelier";
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
