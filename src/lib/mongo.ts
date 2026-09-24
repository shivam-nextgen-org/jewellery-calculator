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
    globalForMongo.mongoReady = client.connect().then((connected) => {
      globalForMongo.mongoClient = connected;
      return connected;
    });
  }
  return globalForMongo.mongoReady;
}

export async function getDb(): Promise<Db> {
  const client = await getMongo();
  return client.db("atelier");
}

export function oid(id: string) {
  return new ObjectId(id);
}

export function idOf(value: ObjectId | string) {
  return typeof value === "string" ? value : value.toHexString();
}

export { ObjectId };
