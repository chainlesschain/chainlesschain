#!/usr/bin/env node
/**
 * npm publish script - publishes packages in dependency order
 * Skips packages that are already published at current version
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

// Publish order based on dependency graph (leaves first)
const publishOrder = [
  "core-env", // no deps
  "shared-logger", // -> core-env
  "core-config", // -> core-env
  "core-infra", // -> shared-logger
  "core-db", // independent (better-sqlite3)
  "core-mtc", // independent crypto
  "core-multisig", // -> core-mtc
  "core-settlement", // -> core-mtc, core-db, core-multisig
  "session-core", // independent
  "personal-data-hub", // -> core-db, core-mtc, core-multisig, core-settlement, session-core
  "cli", // -> all core-* + pdh
];

function getPkgInfo(pkgDir) {
  const pkgJsonPath = path.join(rootDir, "packages", pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return null;
  return JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
}

function isPublished(name, version) {
  try {
    const result = execSync(`npm view "${name}@${version}" version 2>&1`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    });
    return result.trim() === version;
  } catch (e) {
    return false;
  }
}

function publish(pkgDir) {
  const fullDir = path.join(rootDir, "packages", pkgDir);
  const pkgJson = getPkgInfo(pkgDir);
  if (!pkgJson) {
    console.log(`⚠️  Skipping ${pkgDir} - no package.json`);
    return { skipped: true, reason: "no-package-json" };
  }

  const { name, version, private: priv } = pkgJson;
  if (priv) {
    console.log(`⏭️  Skipping ${name}@${version} - private package`);
    return { skipped: true, reason: "private" };
  }

  // Check if build exists
  const libDir = path.join(fullDir, "lib");
  const srcDir = path.join(fullDir, "src");
  const hasLib = fs.existsSync(libDir);
  const hasSrc = fs.existsSync(srcDir);

  // CLI uses src/ directly; others need lib/
  if (pkgDir !== "cli" && !hasLib) {
    console.log(`⚠️  Skipping ${name}@${version} - lib/ not built`);
    return { skipped: true, reason: "not-built" };
  }
  if (pkgDir === "cli" && !hasSrc) {
    console.log(`⚠️  Skipping ${name}@${version} - src/ missing`);
    return { skipped: true, reason: "src-missing" };
  }

  // Check if already published
  if (isPublished(name, version)) {
    console.log(`⏭️  ${name}@${version} already published - skipping`);
    return { skipped: true, reason: "already-published" };
  }

  console.log(`📦 Publishing ${name}@${version}...`);
  try {
    execSync("npm publish --access public", {
      cwd: fullDir,
      encoding: "utf8",
      stdio: "inherit",
      timeout: 120000,
    });
    console.log(`✅ Published ${name}@${version}`);
    return { success: true, name, version };
  } catch (e) {
    console.error(`❌ Failed to publish ${name}@${version}:`, e.message);
    return { success: false, name, version, error: e.message };
  }
}

console.log("=".repeat(60));
console.log("ChainlessChain npm Publisher");
console.log("=".repeat(60));
console.log("");

// Verify npm login first
try {
  const user = execSync("npm whoami", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  console.log(`Logged in as: ${user}`);
} catch (e) {
  console.error("❌ Not logged in to npm. Please run: npm login");
  process.exit(1);
}
console.log("");

const results = { published: [], skipped: [], failed: [] };

for (const pkgDir of publishOrder) {
  const r = publish(pkgDir);
  if (r.success) results.published.push(r);
  else if (r.skipped) results.skipped.push({ dir: pkgDir, ...r });
  else results.failed.push(r);
  console.log("");
}

console.log("=".repeat(60));
console.log("Summary:");
console.log(`  Published: ${results.published.length}`);
console.log(`  Skipped:   ${results.skipped.length}`);
console.log(`  Failed:    ${results.failed.length}`);
console.log("");

if (results.published.length > 0) {
  console.log("Newly published:");
  for (const p of results.published) {
    console.log(`  ✅ ${p.name}@${p.version}`);
  }
  console.log("");
}

if (results.failed.length > 0) {
  console.log("Failures:");
  for (const f of results.failed) {
    console.log(`  ❌ ${f.name}@${f.version}`);
  }
  process.exit(1);
}

console.log("Done!");
