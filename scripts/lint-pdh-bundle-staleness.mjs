#!/usr/bin/env node
/**
 * Lint: PDH bundle staleness (hidden-risk-traps #27 + #28).
 *
 * Failure modes guarded:
 *
 *   #27 — USR_VERSION sentinel cache: changing `packages/personal-data-hub/lib/**`
 *   or `packages/cli/lib/**` without bumping
 *   `android-app/feature-local-terminal/build.gradle.kts` `USR_VERSION` makes
 *   the LocalFilesystemBootstrapper fast-path skip extraction. Device runs
 *   stale code despite the new APK install.
 *
 *   #28 — Workspace dep stale: changing PDH/cli lib without bumping
 *   `packages/personal-data-hub/package.json` `version` and the matching
 *   `packages/cli/package.json` `@chainlesschain/personal-data-hub` dep makes
 *   `node-runtime-bundle.yml` pull the pinned (old) version from the npm
 *   registry. The git-tracked code never reaches the Android cc-cli.tgz.
 *
 * Strategy: take a base ref (e.g. `origin/main` or `@{u}`), diff against
 * HEAD. If lib paths changed but the required version/USR fields did not,
 * report a violation with the 4-step fix chain.
 *
 * Pure shell-out to git + JSON parse + plain text grep. No network. Safe in
 * pre-push hook and PR workflow alike.
 *
 * See memory:
 *   android_usr_version_sentinel_cache.md  (trap #27)
 *   pdh_workspace_dep_npm_publish_stale.md (trap #28)
 *   docs/internal/hidden-risk-traps.md     (#27, #28)
 */
import { execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const PDH_LIB_PREFIX = "packages/personal-data-hub/lib/";
const CLI_LIB_PREFIX = "packages/cli/lib/";
const GRADLE_PATH = "android-app/feature-local-terminal/build.gradle.kts";
const PDH_PKG_PATH = "packages/personal-data-hub/package.json";
const CLI_PKG_PATH = "packages/cli/package.json";
const PDH_DEP_NAME = "@chainlesschain/personal-data-hub";

const USR_VERSION_RE = /buildConfigField\(\s*"String"\s*,\s*"USR_VERSION"\s*,\s*"\\"(\d+)\\""\s*\)/;

/**
 * Run a git command, return stdout text or throw with context. Always utf-8
 * to dodge GBK on Windows (per .claude/rules/encoding.md).
 */
function git(args, opts = {}) {
  return execFileSync("git", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function gitChangedFiles(base) {
  const out = git(["diff", "--name-only", `${base}..HEAD`]);
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function gitShowAtRef(ref, path) {
  try {
    return git(["show", `${ref}:${path}`]);
  } catch {
    return null;
  }
}

function readWorkingTree(path) {
  // Read via git so we get the HEAD content even when called from a different
  // cwd. Falls back to null if the file doesn't exist at HEAD.
  return gitShowAtRef("HEAD", path);
}

/**
 * Classify which library trees changed in the diff. The two trees ship into
 * the same Android cc-cli.tgz so either one triggers the same gate.
 */
export function classifyLibChanges(changedFiles) {
  const pdhLibChanged = changedFiles.some((f) => f.startsWith(PDH_LIB_PREFIX));
  const cliLibChanged = changedFiles.some((f) => f.startsWith(CLI_LIB_PREFIX));
  return { pdhLibChanged, cliLibChanged };
}

export function extractUsrVersion(gradleSrc) {
  if (!gradleSrc) return null;
  const m = USR_VERSION_RE.exec(gradleSrc);
  return m ? m[1] : null;
}

/**
 * trap #27 — require USR_VERSION bumped when PDH/CLI lib changed.
 *
 * Returns array of violation objects { code, message, fix }.
 */
export function checkUsrVersionBumped({
  pdhLibChanged,
  cliLibChanged,
  gradleBase,
  gradleHead,
}) {
  const violations = [];
  if (!pdhLibChanged && !cliLibChanged) return violations;

  const baseVer = extractUsrVersion(gradleBase);
  const headVer = extractUsrVersion(gradleHead);

  if (headVer === null) {
    violations.push({
      code: "trap-27-usr-version-missing",
      message:
        `${GRADLE_PATH} is missing USR_VERSION buildConfigField — required ` +
        `pattern: buildConfigField("String", "USR_VERSION", "\\"N\\"")`,
      fix: trap27FixChain(),
    });
    return violations;
  }

  if (baseVer !== null && baseVer === headVer) {
    violations.push({
      code: "trap-27-usr-version-not-bumped",
      message:
        `PDH/CLI lib changed but USR_VERSION still "${headVer}" — ` +
        `LocalFilesystemBootstrapper fast-path will skip re-extraction. ` +
        `Device runs stale code after install.`,
      fix: trap27FixChain(),
    });
  }

  return violations;
}

/**
 * trap #28 — require workspace package.json bump + CLI dep sync when PDH
 * lib changed.
 *
 * Returns array of violation objects { code, message, fix }.
 */
export function checkWorkspaceVersionBumped({
  pdhLibChanged,
  pdhPkgBase,
  pdhPkgHead,
  cliPkgBase,
  cliPkgHead,
}) {
  const violations = [];
  if (!pdhLibChanged) return violations;

  let basePdh = null;
  let headPdh = null;
  let baseCliDep = null;
  let headCliDep = null;

  try {
    if (pdhPkgBase) basePdh = JSON.parse(pdhPkgBase).version;
  } catch {
    /* base may be malformed on first commit; treated as missing */
  }
  try {
    if (pdhPkgHead) headPdh = JSON.parse(pdhPkgHead).version;
  } catch {
    /* head must parse; downstream report */
  }
  try {
    if (cliPkgBase) baseCliDep = JSON.parse(cliPkgBase).dependencies?.[PDH_DEP_NAME] ?? null;
  } catch {
    /* see above */
  }
  try {
    if (cliPkgHead) headCliDep = JSON.parse(cliPkgHead).dependencies?.[PDH_DEP_NAME] ?? null;
  } catch {
    /* see above */
  }

  if (!headPdh) {
    violations.push({
      code: "trap-28-pdh-package-unparseable",
      message: `${PDH_PKG_PATH} unparseable or missing version field at HEAD`,
      fix: trap28FixChain(),
    });
    return violations;
  }

  if (basePdh && basePdh === headPdh) {
    violations.push({
      code: "trap-28-pdh-version-not-bumped",
      message:
        `${PDH_LIB_PREFIX}** changed but ${PDH_PKG_PATH} version still "${headPdh}". ` +
        `cc-cli.tgz pulls @chainlesschain/personal-data-hub@${headPdh} from npm registry — ` +
        `your lib changes will not reach the Android device.`,
      fix: trap28FixChain(),
    });
  }

  if (!headCliDep) {
    violations.push({
      code: "trap-28-cli-dep-missing",
      message:
        `${CLI_PKG_PATH} is missing "${PDH_DEP_NAME}" in dependencies`,
      fix: trap28FixChain(),
    });
  } else if (headCliDep !== headPdh) {
    violations.push({
      code: "trap-28-cli-dep-mismatch",
      message:
        `${CLI_PKG_PATH} dep "${PDH_DEP_NAME}" = "${headCliDep}" but ` +
        `${PDH_PKG_PATH} version = "${headPdh}" — npm install will pull the ` +
        `pinned old version, not the workspace.`,
      fix: trap28FixChain(),
    });
  }

  if (basePdh && baseCliDep && basePdh === baseCliDep && headPdh !== headCliDep) {
    // Drift detection — base was synced, head is not. Already covered by
    // dep-mismatch above; left as a noop branch for symmetry / future cases.
  }

  return violations;
}

function trap27FixChain() {
  return [
    `trap #27 fix (android_usr_version_sentinel_cache.md):`,
    `  1. bump ${GRADLE_PATH} buildConfigField USR_VERSION "N" → "N+1"`,
    `  2. rebuild APK so BuildConfig.USR_VERSION reflects new value`,
    `  3. install on device — LocalFilesystemBootstrapper sees mismatch + re-extracts`,
    `  4. verify: adb logcat -s LocalFilesystemBootstrapper:* | grep -i 'extracting'`,
  ];
}

function trap28FixChain() {
  return [
    `trap #28 fix (pdh_workspace_dep_npm_publish_stale.md) — 4 steps, all required:`,
    `  1. bump ${PDH_PKG_PATH} version (semver patch)`,
    `  2. sync ${CLI_PKG_PATH} dep "${PDH_DEP_NAME}" to the new version`,
    `  3. gh workflow run "npm-publish.yml" — wait ~8–10 min for registry publish`,
    `  4. gh workflow run "Node.js Runtime Bundle (Termux)" — rebuilds cc-cli.tgz from registry`,
    `  Then bump USR_VERSION per trap #27 + rebuild APK.`,
  ];
}

// ── CLI entry ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { base: null, check: "all" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--base=")) args.base = a.slice(7);
    else if (a === "--base") args.base = argv[++i];
    else if (a.startsWith("--check=")) args.check = a.slice(8);
    else if (a === "--check") args.check = argv[++i];
  }
  return args;
}

function printViolations(violations) {
  const seen = new Set();
  for (const v of violations) {
    console.error(`\x1b[31m✘ ${v.code}\x1b[0m  ${v.message}`);
    const sig = v.fix?.[0];
    if (sig && !seen.has(sig)) {
      seen.add(sig);
      console.error("");
      for (const line of v.fix) console.error(line);
      console.error("");
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  const { base, check } = parseArgs(process.argv.slice(2));
  if (!base) {
    console.error("usage: lint-pdh-bundle-staleness.mjs --base=<ref> [--check=all|usr-version|workspace-version]");
    process.exit(2);
  }

  let changedFiles;
  try {
    changedFiles = gitChangedFiles(base);
  } catch (err) {
    console.error(`✘ git diff failed against base "${base}": ${err.message}`);
    console.error(`  if base is @{u}, set an upstream: git branch --set-upstream-to=origin/<branch>`);
    console.error(`  if running in CI, ensure actions/checkout fetch-depth: 0 and origin is fetched.`);
    process.exit(2);
  }

  const { pdhLibChanged, cliLibChanged } = classifyLibChanges(changedFiles);

  if (!pdhLibChanged && !cliLibChanged) {
    console.log(`PDH bundle staleness lint: no PDH/CLI lib changes vs ${base}; nothing to check.`);
    process.exit(0);
  }

  const violations = [];

  if (check === "all" || check === "usr-version") {
    violations.push(
      ...checkUsrVersionBumped({
        pdhLibChanged,
        cliLibChanged,
        gradleBase: gitShowAtRef(base, GRADLE_PATH),
        gradleHead: readWorkingTree(GRADLE_PATH),
      })
    );
  }

  if (check === "all" || check === "workspace-version") {
    violations.push(
      ...checkWorkspaceVersionBumped({
        pdhLibChanged,
        pdhPkgBase: gitShowAtRef(base, PDH_PKG_PATH),
        pdhPkgHead: readWorkingTree(PDH_PKG_PATH),
        cliPkgBase: gitShowAtRef(base, CLI_PKG_PATH),
        cliPkgHead: readWorkingTree(CLI_PKG_PATH),
      })
    );
  }

  if (violations.length === 0) {
    console.log(
      `PDH bundle staleness lint: ${changedFiles.length} files changed vs ${base}, ` +
      `pdhLib=${pdhLibChanged} cliLib=${cliLibChanged}; all required bumps present.`
    );
    process.exit(0);
  }

  console.error("");
  console.error(`✗ PDH bundle staleness FAILED (${violations.length} violation${violations.length === 1 ? "" : "s"}):`);
  console.error("");
  printViolations(violations);
  process.exit(1);
}

void dirname;
