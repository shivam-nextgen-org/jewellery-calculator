import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";

/**
 * Throwaway in-process MongoDB for integration tests. Tests never use
 * DATABASE_URL or src/lib/mongo.ts, so they can't reach a real database.
 */
export async function startMemoryDb(dbName = "security_test") {
  const server = await MongoMemoryServer.create();
  const client = await MongoClient.connect(server.getUri());
  const db: Db = client.db(dbName);
  return {
    db,
    async reset() {
      await db.dropDatabase();
    },
    async stop() {
      await client.close();
      await server.stop();
    },
  };
}

export const MEMORY_DB_TIMEOUT = 180_000;
