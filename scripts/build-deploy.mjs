/**
 * build-deploy.mjs
 * --------------------------------------------------------------------------
 * Produces a single, self-contained folder you can copy straight onto a VPS.
 *
 * What it does:
 *   1. Runs a PRODUCTION Next.js build (output: "standalone").
 *   2. Assembles ONLY the files the server needs into `deploy/atelier-vps/`:
 *        - .next/standalone/*            -> server.js + traced minimal node_modules
 *        - .next/static/*                -> deploy/atelier-vps/.next/static  (CSS/JS/chunks)
 *        - public/*                      -> deploy/atelier-vps/public        (static assets)
 *        - tessdata/*                    -> deploy/atelier-vps/tessdata       (OCR language data)
 *        - tesseract.js (+ full dep tree) -> OCR core/wasm that tracing trims
 *        - node-cron (+ deps)            -> instrumentation crons (external + dynamic import)
 *        - prisma/schema.prisma          -> for optional db:push / db:seed on the VPS
 *        - node_modules/.prisma          -> generated Prisma client engine (safety net)
 *        - node_modules/@prisma/client   -> Prisma client (safety net)
 *        - .env.production               -> runtime env (if present)
 *
 * The result folder is everything and ONLY what is required at runtime.
 * On the VPS:   cd atelier-vps  &&  node server.js
 * --------------------------------------------------------------------------
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.join(ROOT, "deploy");
const OUT = path.join(OUT_ROOT, "atelier-vps");

function log(msg) {
  console.log(`\n[deploy] ${msg}`);
}

function rmrf(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

/** Recursively list files under `dir` (absolute paths). */
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Next standalone does NOT include .next/static. If that copy is missing or
 * incomplete, the HTML still references hashed CSS/JS and the VPS returns
 * 500 for those URLs while other (cached) chunks may still 200.
 */
function assertStaticAssets(staticDest) {
  const files = listFiles(staticDest);
  const css = files.filter((f) => f.endsWith(".css"));
  const js = files.filter((f) => f.endsWith(".js"));
  if (css.length === 0 || js.length === 0) {
    console.error(
      `\n[deploy] ERROR: .next/static copy looks incomplete (css=${css.length}, js=${js.length}).`,
    );
    console.error(
      "         Without hashed CSS/JS under deploy/atelier-vps/.next/static/chunks/,",
    );
    console.error(
      "         the login page will render unstyled and those assets return 500 on the VPS.",
    );
    process.exit(1);
  }
  log(`verified .next/static: ${css.length} css, ${js.length} js (${files.length} files total)`);
  for (const f of css) {
    log(`  css: ${path.relative(staticDest, f)}`);
  }
}

const SRC_NM = path.join(ROOT, "node_modules");
const OUT_NM = () => path.join(OUT, "node_modules");

function readPkgJson(pkgDir) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * Resolve where `name` lives relative to `fromDir`, walking up node_modules
 * folders (npm hoisting means a dep may sit at the top level or nested).
 */
function resolvePkgDir(name, fromDir) {
  let dir = fromDir;
  // First try nested (fromDir/node_modules/name), then walk up to root.
  const candidates = [path.join(fromDir, "node_modules", name)];
  while (true) {
    candidates.push(path.join(dir, "node_modules", name));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "package.json"))) return c;
  }
  return null;
}

/**
 * Copy a package AND its full runtime dependency tree from the source
 * node_modules into the bundle. Needed for packages that Next.js file tracing
 * trims because they are loaded dynamically (e.g. tesseract.js requires
 * tesseract.js-core / wasm-feature-detect via runtime require()).
 */
function copyPackageWithDeps(name) {
  const seen = new Set();
  let copied = 0;

  function walk(pkgName, fromDir) {
    const srcDir = resolvePkgDir(pkgName, fromDir);
    if (!srcDir) return;
    if (seen.has(srcDir)) return;
    seen.add(srcDir);

    // Mirror the resolved location relative to source node_modules so nested
    // installs keep working after copy. Always overwrite: Next.js tracing may
    // have left a PARTIAL copy (e.g. tesseract.js with only src/), which would
    // otherwise shadow the complete package we need.
    const rel = path.relative(SRC_NM, srcDir);
    const destDir = path.join(OUT_NM(), rel);
    rmrf(destDir);
    copyDir(srcDir, destDir);
    copied += 1;

    const pkg = readPkgJson(srcDir);
    if (!pkg) return;
    const deps = { ...(pkg.dependencies || {}) };
    for (const dep of Object.keys(deps)) {
      walk(dep, srcDir);
    }
  }

  walk(name, ROOT);
  return copied;
}

// --------------------------------------------------------------------------
// 1. Production build
// --------------------------------------------------------------------------
log("Running production build (NODE_ENV=production)…");
execSync("npm run build", {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

const standalone = path.join(ROOT, ".next", "standalone");
if (!fs.existsSync(standalone)) {
  console.error(
    '\n[deploy] ERROR: .next/standalone was not produced. Confirm next.config has output: "standalone".',
  );
  process.exit(1);
}

// --------------------------------------------------------------------------
// 2. Assemble the deploy folder
// --------------------------------------------------------------------------
log(`Assembling deploy bundle at ${path.relative(ROOT, OUT)} …`);
rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

// 2a. Standalone server + traced node_modules
copyDir(standalone, OUT);
log("+ standalone server + traced node_modules");

// 2b. Static build output (hashed CSS/JS chunks) — NOT copied by Next automatically
const staticSrc = path.join(ROOT, ".next", "static");
const staticDest = path.join(OUT, ".next", "static");
if (!copyDir(staticSrc, staticDest)) {
  console.error(
    `\n[deploy] ERROR: ${path.relative(ROOT, staticSrc)} missing after build.`,
  );
  process.exit(1);
}
log("+ .next/static (css / js / chunks)");
assertStaticAssets(staticDest);

// 2c. public assets — NOT copied by Next automatically
if (copyDir(path.join(ROOT, "public"), path.join(OUT, "public"))) {
  log("+ public/ assets");
}

// 2d. tessdata (loaded from process.cwd()/tessdata at runtime)
if (copyDir(path.join(ROOT, "tessdata"), path.join(OUT, "tessdata"))) {
  log("+ tessdata/ (OCR language data)");
}

// 2d-bis. tesseract.js + its FULL dependency tree.
// Next.js file tracing trims tesseract.js-core / wasm-feature-detect because
// tesseract.js loads them via runtime require() (dynamic), so OCR breaks in the
// standalone bundle (it falls back to a CDN fetch that fails on the VPS).
// Copy the whole subtree so OCR runs fully offline on the VPS.
{
  const n = copyPackageWithDeps("tesseract.js");
  if (n > 0) {
    log(`+ tesseract.js + deps (${n} packages incl. tesseract.js-core, wasm-feature-detect)`);
  } else {
    log("! tesseract.js not found in node_modules — OCR may fail on the VPS.");
  }
}

// 2d-ter. node-cron — used by instrumentation.ts via dynamic import +
// serverExternalPackages, so standalone tracing often omits it. Without this
// copy the VPS dies on boot: "Cannot find package 'node-cron'".
{
  const n = copyPackageWithDeps("node-cron");
  if (n > 0) {
    log(`+ node-cron + deps (${n} packages)`);
  } else {
    log("! node-cron not found in node_modules — cron / server prepare will fail on the VPS.");
  }
}

// 2e. Prisma schema + generated client (safety net for engine + optional db scripts)
copyFile(
  path.join(ROOT, "prisma", "schema.prisma"),
  path.join(OUT, "prisma", "schema.prisma"),
);
if (copyDir(path.join(ROOT, "node_modules", ".prisma"), path.join(OUT, "node_modules", ".prisma"))) {
  log("+ node_modules/.prisma (generated client + query engine)");
}
copyDir(
  path.join(ROOT, "node_modules", "@prisma", "client"),
  path.join(OUT, "node_modules", "@prisma", "client"),
);

// 2f. Production env
if (copyFile(path.join(ROOT, ".env.production"), path.join(OUT, ".env.production"))) {
  log("+ .env.production");
} else if (copyFile(path.join(ROOT, ".env.production.example"), path.join(OUT, ".env.production.example"))) {
  log("! .env.production not found — copied .env.production.example instead.");
  log("  Rename it to .env.production on the VPS and fill in real values.");
}

// 2g. A tiny README + start helper inside the bundle
fs.writeFileSync(
  path.join(OUT, "START.md"),
  [
    "# Atelier — VPS deploy bundle",
    "",
    "This folder is fully self-contained. Copy it to your VPS and run it.",
    "",
    "## Critical: replace the WHOLE folder",
    "Do NOT merge into an old `atelier-vps` directory. Delete/rename the old",
    "folder, then upload this new one. A partial copy leaves HTML pointing at",
    "hashed CSS/JS that are missing → unstyled login + 500 on `/_next/static/...`.",
    "",
    "After upload, confirm CSS exists on the VPS:",
    "",
    "```bash",
    "ls .next/static/chunks/*.css",
    "```",
    "",
    "Then restart the process (pm2 restart atelier) and purge Cloudflare cache",
    "if the site sits behind Cloudflare.",
    "",
    "## Requirements on the VPS",
    "- Node.js (same major version used to build, Node 20+ recommended)",
    "- A reachable MongoDB instance",
    "",
    "## First run",
    "1. Ensure `.env.production` exists here with real values",
    "   (rename `.env.production.example` if needed).",
    "2. Start the server (PORT/HOSTNAME are passed as env vars, NOT in the",
    "   .env file, because the standalone server reads them before loading it):",
    "",
    "   ```bash",
    "   PORT=3000 HOSTNAME=0.0.0.0 node server.js",
    "   ```",
    "",
    "   Everything else (DATABASE_URL, SESSION_SECRET, OCR_PROVIDER, ...) is",
    "   read automatically from `.env.production`.",
    "",
    "## Run in background (example with pm2)",
    "```bash",
    "pm2 start server.js --name atelier --update-env \\",
    "  --env PORT=3000,HOSTNAME=0.0.0.0",
    "```",
    "",
    "## (Optional) Seed the database from here",
    "The generated Prisma client is bundled. To push schema / seed you still",
    "need the prisma CLI + tsx, which are NOT bundled. Do that from the source",
    "repo, or install them on the VPS.",
    "",
  ].join("\n"),
);

log(`DONE. Bundle ready: ${OUT}`);
log("Replace the WHOLE atelier-vps folder on the VPS (do not merge), then:");
log("  PORT=3000 HOSTNAME=0.0.0.0 node server.js   # or: pm2 restart atelier");
