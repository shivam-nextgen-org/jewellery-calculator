/**
 * Controlled index verification / creation for the security foundation.
 *
 *   npm run security:indexes -- --env-file .env.local            # verify (read-only, default)
 *   npm run security:indexes -- --env-file .env.local --apply --confirm-db atelier
 *
 * Safety:
 * - Never loads an env file implicitly. DATABASE_URL must come from the
 *   process environment or an explicit --env-file.
 * - Verify mode is read-only.
 * - Apply mode only creates missing indexes, never drops/changes indexes or
 *   data, and requires --confirm-db matching the target database name.
 * - Credentials and hostnames are never printed.
 */
import { config as loadEnv } from "dotenv";
import { MongoClient } from "mongodb";
import {
  ensureIndexes,
  IndexSafetyError,
  type EnsureIndexesReport,
} from "../src/lib/security/indexes";

type Args = {
  apply: boolean;
  envFile?: string;
  confirmDb?: string;
  db: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, db: "atelier" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--apply") args.apply = true;
    else if (arg === "--verify") args.apply = false;
    else if (arg === "--env-file") args.envFile = next();
    else if (arg === "--confirm-db") args.confirmDb = next();
    else if (arg === "--db") args.db = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function describeTarget(url: string): string {
  if (url.startsWith("mongodb+srv://")) return "remote cluster (mongodb+srv)";
  if (/@?(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) return "local server";
  return "remote server";
}

function printReport(report: EnsureIndexesReport) {
  for (const item of report.items) {
    const where = `${item.spec.collection}.${item.spec.name}`;
    const via = item.existingName && item.existingName !== item.spec.name
      ? ` (satisfied by "${item.existingName}")`
      : "";
    const extra = item.detail ? ` — ${item.detail}` : "";
    console.log(`${item.status.padEnd(8)} ${item.action.padEnd(12)} ${where}${via}${extra}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.envFile) {
    const result = loadEnv({ path: args.envFile, override: false, quiet: true });
    if (result.error) throw new Error(`Could not read env file ${args.envFile}`);
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set. Pass --env-file <file> explicitly.");
  }
  if (args.apply && args.confirmDb !== args.db) {
    throw new Error(
      `--apply requires --confirm-db ${args.db} to confirm the target database.`,
    );
  }

  console.log(
    `Mode: ${args.apply ? "APPLY (create missing only)" : "VERIFY (read-only)"}; target: ${describeTarget(url)}; database: ${args.db}`,
  );

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  try {
    await client.connect();
    const report = await ensureIndexes(client.db(args.db), args.apply ? "apply" : "verify");
    printReport(report);
    const problems = report.items.filter(
      (item) => item.status === "CONFLICT" || (!args.apply && item.status === "MISSING"),
    );
    if (problems.length > 0) {
      console.log(`${problems.length} index(es) need attention.`);
      process.exitCode = 1;
    } else {
      console.log("All required indexes are present.");
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  if (error instanceof IndexSafetyError) {
    console.error(`Stopped safely: ${error.message}`);
  } else {
    // Driver errors can contain connection details; print only the type.
    console.error(
      error instanceof Error && !/mongo/i.test(error.name)
        ? error.message
        : `Database error (${error instanceof Error ? error.name : "unknown"})`,
    );
  }
  process.exit(1);
});
