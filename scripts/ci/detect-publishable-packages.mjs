#!/usr/bin/env node
/**
 * CI helper: detect which npm packages to publish.
 *
 * Trigger modes:
 *   1. Tag push (refs/tags/v-packages-*) → publish generic public packages
 *   2. workflow_dispatch.version set → publish that specific package
 *   3. workflow_dispatch (no inputs) → publish packages whose version > npm latest
 *   4. INPUT_FORCE=true              → skip version-exists check
 *
 * Outputs (to GITHUB_OUTPUT and to .publish-order.txt):
 *   has_packages = "true" | "false"
 *   count        = number of packages
 *   .publish-order.txt = newline-separated dir names in topo order
 */
import { execFileSync } from "child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const ORDER_FILE = join(REPO_ROOT, ".publish-order.txt");
const PROTECTED_PACKAGE_NAMES = new Set(["chainlesschain"]);
const PROTECTED_PACKAGE_DIRS = new Set(["cli"]);

// ── helpers ──────────────────────────────────────────────────
const log = (m) => console.log(`[detect] ${m}`);
const warn = (m) => console.warn(`[detect] ⚠️  ${m}`);
const err = (m) => {
  console.error(`[detect] ❌ ${m}`);
  process.exit(1);
};

function listPackages() {
  if (!existsSync(PACKAGES_DIR)) return [];
  const out = [];
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const pkgDir = join(PACKAGES_DIR, entry);
    if (!statSync(pkgDir).isDirectory()) continue;
    const pj = join(pkgDir, "package.json");
    if (!existsSync(pj)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pj, "utf-8"));
    } catch {
      continue;
    }
    out.push({
      dir: entry,
      name: pkg.name || entry,
      version: pkg.version || "0.0.0",
      private: !!pkg.private,
      deps: new Set([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
      ]),
    });
  }
  return out;
}

function isProtectedPackage(pkg) {
  return (
    PROTECTED_PACKAGE_NAMES.has(pkg.name) || PROTECTED_PACKAGE_DIRS.has(pkg.dir)
  );
}

/** Topological sort — dependencies before dependents */
function topoSort(pkgs) {
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const visited = new Set();
  const result = [];
  const stack = new Set();

  function visit(p) {
    if (visited.has(p.dir)) return;
    if (stack.has(p.dir)) {
      result.push(p.dir);
      visited.add(p.dir);
      return;
    }
    stack.add(p.dir);
    for (const depName of p.deps) {
      const dep = byName.get(depName);
      if (dep) visit(dep);
    }
    stack.delete(p.dir);
    visited.add(p.dir);
    result.push(p.dir);
  }
  pkgs.forEach(visit);
  return result;
}

/** npm registry latest version; null if unpublished / error */
function npmLatest(pkgName) {
  try {
    const out = execFileSync("npm", ["view", pkgName, "version", "--silent"], {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** semver-ish compare: a > b ? */
function verGt(a, b) {
  if (!b) return true;
  const pa = String(a)
    .split(/[.-]/)
    .map((p) => (/^\d+$/.test(p) ? +p : p));
  const pb = String(b)
    .split(/[.-]/)
    .map((p) => (/^\d+$/.test(p) ? +p : p));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0,
      vb = pb[i] ?? 0;
    if (typeof va === "number" && typeof vb === "number") {
      if (va > vb) return true;
      if (va < vb) return false;
    } else {
      const sa = String(va),
        sb = String(vb);
      if (sa > sb) return true;
      if (sa < sb) return false;
    }
  }
  return false;
}

function setOutput(key, val) {
  const f = process.env.GITHUB_OUTPUT;
  if (f) appendFileSync(f, `${key}=${val}\n`);
}

// ── main ─────────────────────────────────────────────────────
const inputVersion = process.env.INPUT_VERSION?.trim() || "";
const force = process.env.INPUT_FORCE === "true";
const isTag = (process.env.GITHUB_REF || "").startsWith("refs/tags/");

const all = listPackages();
const publicPackages = all.filter((p) => !p.private);
const pub = publicPackages.filter((p) => !isProtectedPackage(p));
log(
  `Found ${all.length} workspace packages (${publicPackages.length} public, ${pub.length} generic-publishable)`,
);

let toPublish;

if (inputVersion) {
  // "@scope/name@ver"  or  "name@ver"
  const at = inputVersion.lastIndexOf("@");
  const name = at > 0 ? inputVersion.slice(0, at) : inputVersion;
  const protectedPackage = publicPackages.find((p) => p.name === name);
  if (protectedPackage && isProtectedPackage(protectedPackage)) {
    err(
      `Package "${name}" is protected and must use the dedicated exact-SHA CLI release workflow.`,
    );
  }
  const pkg = pub.find((p) => p.name === name);
  if (!pkg) err(`Package "${name}" not found in workspace or is private.`);
  toPublish = [pkg];
  log(`Manual mode: publish ${name}@${pkg.version}`);
} else if (isTag) {
  toPublish = [...pub];
  log(`Tag trigger: publishing ${pub.length} generic public packages`);
} else {
  toPublish = [];
  log("Auto mode: comparing versions against npm registry...");
  for (const p of pub) {
    const latest = npmLatest(p.name);
    if (force || verGt(p.version, latest)) {
      log(`  ✓ ${p.name}: ${latest ?? "(unpublished)"} → ${p.version}`);
      toPublish.push(p);
    } else {
      log(`  - ${p.name}: ${p.version} already on npm (${latest}), skip`);
    }
  }
}

if (toPublish.length === 0) {
  log("No packages to publish.");
  writeFileSync(ORDER_FILE, "");
  setOutput("has_packages", "false");
  setOutput("count", "0");
  process.exit(0);
}

const ordered = topoSort(toPublish);
const orderText = ordered.join("\n") + "\n";
writeFileSync(ORDER_FILE, orderText);
log(`Publish order written to .publish-order.txt:`);
ordered.forEach((d) => {
  const p = all.find((x) => x.dir === d);
  log(`  ${p.name}@${p.version}  (packages/${d})`);
});

setOutput("has_packages", "true");
setOutput("count", String(ordered.length));
log(`✅ ${ordered.length} package(s) ready to publish.`);
