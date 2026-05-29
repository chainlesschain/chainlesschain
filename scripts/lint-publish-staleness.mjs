#!/usr/bin/env node
/**
 * Lint: generic workspace package publish-staleness (trap #7).
 *
 * For every `packages/<pkg>/` workspace package, if files under
 * `packages/<pkg>/{lib,src,bin}` changed in the diff range but
 * `packages/<pkg>/package.json` `version` did NOT change, flag.
 *
 * Skips:
 *   - Private packages (`package.json` `"private": true`)
 *   - `personal-data-hub` and `cli` — already gated by the more strict
 *     `lint-pdh-bundle-staleness.mjs` which additionally checks
 *     USR_VERSION + cross-package dep propagation. Running this generic
 *     check on top would just duplicate the warning.
 *
 * Strategy: pure git shell-out + JSON parse + plain file walk. No
 * network. Safe in pre-push hook and PR workflow alike.
 *
 * Usage:
 *   node scripts/lint-publish-staleness.mjs --base=origin/main
 *   node scripts/lint-publish-staleness.mjs --base=@{u}      # pre-push
 *   node scripts/lint-publish-staleness.mjs --base=HEAD~3    # local check
 *
 * Exit:
 *   0 — clean (no violations or only allowed packages changed)
 *   1 — bad args
 *   2 — at least one violation
 *
 * See:
 *   docs/internal/hidden-risk-traps.md #7
 *   memory `npm_publish_audit_and_dep_chain.md`
 */
import { execFileSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

// Packages already covered by the more-strict PDH/CLI staleness check.
const SKIP_NAMES = new Set([
  "personal-data-hub",
  "cli",
]);

// Subdirectories within each package that constitute "publishable source".
// A change in any of these triggers the version-bump requirement.
const SOURCE_SUBDIRS = ["lib", "src", "bin"];

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf-8",
    cwd: REPO_ROOT,
  }).trim();
}

function gitFileAtRev(rev, path) {
  try {
    return execFileSync("git", ["show", `${rev}:${path}`], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // file didn't exist at that rev
  }
}

function parseArgs(argv) {
  const out = { base: null, head: "HEAD" };
  for (const a of argv) {
    if (a.startsWith("--base=")) out.base = a.slice("--base=".length);
    else if (a.startsWith("--head=")) out.head = a.slice("--head=".length);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/lint-publish-staleness.mjs --base=<rev> [--head=<rev>]",
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }
  if (!out.base) {
    console.error("Missing --base=<rev>. Example: --base=origin/main");
    process.exit(1);
  }
  return out;
}

function listPackages() {
  if (!existsSync(PACKAGES_DIR)) return [];
  const out = [];
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const pkgDir = join(PACKAGES_DIR, entry);
    if (!statSync(pkgDir).isDirectory()) continue;
    const pkgJsonPath = join(pkgDir, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    let pkgJson;
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    } catch {
      continue;
    }
    out.push({
      dir: entry,
      relPath: `packages/${entry}`,
      pkgJsonRel: `packages/${entry}/package.json`,
      name: pkgJson.name || entry,
      version: pkgJson.version,
      private: !!pkgJson.private,
    });
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const baseRev = args.base;
const headRev = args.head;

// 1. Build the list of files changed between base and head.
let changed;
try {
  changed = git([
    "diff",
    "--name-only",
    `${baseRev}..${headRev}`,
  ])
    .split("\n")
    .filter(Boolean);
} catch (err) {
  console.error(
    `Could not git diff ${baseRev}..${headRev}: ${err.message.split("\n")[0]}`,
  );
  process.exit(1);
}

// 2. Iterate workspace packages.
const packages = listPackages();
const violations = [];
const skipped = [];

for (const pkg of packages) {
  // Skip per allow-list.
  if (pkg.private) {
    skipped.push({ name: pkg.name, reason: "private" });
    continue;
  }
  if (SKIP_NAMES.has(pkg.dir)) {
    skipped.push({
      name: pkg.name,
      reason: "covered by lint-pdh-bundle-staleness.mjs",
    });
    continue;
  }

  // Did any source file in this package change?
  const sourcePrefixes = SOURCE_SUBDIRS.map(
    (sub) => `${pkg.relPath}/${sub}/`,
  );
  const sourceChanged = changed.some((file) =>
    sourcePrefixes.some((p) => file.startsWith(p)),
  );
  if (!sourceChanged) continue;

  // Did the version bump?
  const baseJsonText = gitFileAtRev(baseRev, pkg.pkgJsonRel);
  const headJsonText = gitFileAtRev(headRev, pkg.pkgJsonRel);
  let baseVersion = null;
  let headVersion = null;
  try {
    if (baseJsonText) baseVersion = JSON.parse(baseJsonText).version;
  } catch {}
  try {
    if (headJsonText) headVersion = JSON.parse(headJsonText).version;
  } catch {}

  if (!baseVersion) {
    // New package — needs first version to be published, but not a
    // pre-existing-bump violation.
    skipped.push({
      name: pkg.name,
      reason: `new package at ${pkg.relPath} — version=${headVersion}, ensure it's added to release pipeline + npm published`,
    });
    continue;
  }

  if (baseVersion === headVersion) {
    const touchedFiles = changed.filter((f) =>
      sourcePrefixes.some((p) => f.startsWith(p)),
    );
    violations.push({
      package: pkg.name,
      packageDir: pkg.relPath,
      version: headVersion,
      touchedFiles,
    });
  }
}

// 3. Report.
if (violations.length === 0) {
  console.log(
    `✅ lint-publish-staleness: ${packages.length} packages scanned, ${skipped.length} skipped, 0 violations`,
  );
  if (skipped.length > 0) {
    console.log("Skipped:");
    for (const s of skipped) {
      console.log(`  ${s.name} — ${s.reason}`);
    }
  }
  process.exit(0);
}

console.log(
  `❌ lint-publish-staleness: ${violations.length} violation(s) — package source changed but version did not bump (trap #7)`,
);
console.log("");

for (const v of violations) {
  console.log(`  ${v.package}  (still at ${v.version})`);
  console.log(`    Touched source files:`);
  for (const f of v.touchedFiles.slice(0, 5)) {
    console.log(`      ${f}`);
  }
  if (v.touchedFiles.length > 5) {
    console.log(`      ... and ${v.touchedFiles.length - 5} more`);
  }
  console.log(`    Fix:`);
  console.log(`      1. Bump ${v.packageDir}/package.json "version"`);
  console.log(
    `      2. If any other workspace package depends on ${v.package},`,
  );
  console.log(
    `         bump its package.json dep range AND its own version`,
  );
  console.log(
    `      3. Verify npm-publish.yml workflow lists this package (or it`,
  );
  console.log(`         won't actually publish)`);
  console.log("");
}

console.log(
  "Bypass (not recommended — silent stale-publish has masked real bugs before):",
);
console.log("  git push --no-verify");
console.log("");
console.log("See docs/internal/hidden-risk-traps.md #7.");
process.exit(2);
