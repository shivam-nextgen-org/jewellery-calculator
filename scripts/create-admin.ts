/**
 * Create one SUPER_ADMIN user without touching any other data.
 *
 *   $env:ADMIN_EMAIL="owner@example.com"; $env:ADMIN_PASSWORD="<strong password>"
 *   npm run admin:create -- --env-file .env.production --db atelier-prod --confirm-db atelier-prod
 *
 * Safety:
 * - Never loads an env file implicitly; DATABASE_URL comes from the process
 *   environment or an explicit --env-file.
 * - Inserts a single User document. Never deletes or updates anything.
 * - Refuses if a user with that email already exists.
 * - The password is read from ADMIN_PASSWORD (not argv, so it stays out of
 *   shell history and process lists) and is never printed.
 */
import { config as loadEnv } from "dotenv";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import { validatePassword } from "../src/lib/auth/password";

type Args = { envFile?: string; db?: string; confirmDb?: string; name: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { name: "Super Admin" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--env-file") args.envFile = next();
    else if (arg === "--db") args.db = next();
    else if (arg === "--confirm-db") args.confirmDb = next();
    else if (arg === "--name") args.name = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.envFile) {
    const result = loadEnv({ path: args.envFile, override: false, quiet: true });
    if (result.error) throw new Error(`Could not read env file ${args.envFile}`);
  }

  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set. Pass --env-file <file> explicitly.");
  if (!args.db) throw new Error("--db <name> is required (e.g. --db atelier-prod).");
  if (args.confirmDb !== args.db) {
    throw new Error(`--confirm-db ${args.db} is required to confirm the target database.`);
  }

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email.includes("@")) throw new Error("Set ADMIN_EMAIL to a valid email address.");
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(`ADMIN_PASSWORD: ${passwordError}`);
  if (password.length < 12) throw new Error("ADMIN_PASSWORD: use at least 12 characters for an admin.");

  const client = new MongoClient(url, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  try {
    await client.connect();
    const users = client.db(args.db).collection("User");
    // Same unique index Prisma defines (User.email @unique); no-op if it exists.
    await users.createIndex({ email: 1 }, { unique: true, name: "User_email_key" });

    if (await users.findOne({ email }, { projection: { _id: 1 } })) {
      throw new Error("A user with this email already exists. Nothing was changed.");
    }

    const now = new Date();
    await users.insertOne({
      _id: new ObjectId(),
      name: args.name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "SUPER_ADMIN",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Created SUPER_ADMIN ${email} in database "${args.db}".`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  // Driver errors can contain connection details; print only the type.
  console.error(
    error instanceof Error && !/mongo/i.test(error.name)
      ? error.message
      : `Database error (${error instanceof Error ? error.name : "unknown"})`,
  );
  process.exit(1);
});
