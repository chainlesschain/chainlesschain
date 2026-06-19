#!/usr/bin/env node
/**
 * Lint: undeclared runtime dependencies in workspace packages.
 *
 * For every npm workspace package under `packages/<pkg>/`, scan its
 * runtime source (`lib/`, `src/`, `bin/`) for `require()` / `import` /
 * dynamic `import()` of EXTERNAL modules, and flag any specifier whose
 * base package is NOT declared in that package's `dependencies`,
 * `peerDependencies`, or `optionalDependencies`.
 *
 * Why this exists (the silent-failure it guards):
 *   In a monorepo, `node_modules` is hoisted to the root, so a package
 *   can `require("sql.js")` and resolve it fine LOCALLY even though its
 *   own `package.json` never declares it — the dep just happens to be
 *   hoisted (or declared by a sibling/consumer). Tests stay green. But
 *   a standalone `npm i @chainlesschain/<pkg>` ships a package that
 *   throws MODULE_NOT_FOUND on that import path. This bit
 *   `@chainlesschain/core-db` (the documented sql.js WASM fallback
 *   driver was undeclared) and the `@noble/*` packages in
 *   core-settlement / core-multisig before it.
 *
 * Deliberately strict about the manifest section:
 *   Runtime source (lib/src/bin) must resolve its imports from
 *   `dependencies` / `peerDependencies` / `optionalDependencies`.
 *   A devDependency is NOT enough — devDeps are not installed for
 *   consumers, so importing one from runtime code is the same bug.
 *   (Tests under `__tests__` / `*.test.*` are excluded from the scan,
 *   so their legitimate devDep imports never trip this.)
 *
 * Scope:
 *   Only packages listed in root `package.json` `workspaces` that live
 *   under `packages/` — i.e. the real npm-published Node libraries.
 *   This intentionally excludes non-workspace dirs such as the VS Code
 *   extension (host-provides `vscode`), the Java JetBrains plugin, and
 *   the private bundled web-panel, which would otherwise be noise.
 *   Private packages are skipped too.
 *
 * Strategy: pure file walk + regex + JSON parse. No network, no git,
 * no install. Safe in pre-commit / pre-push hooks and PR workflow.
 *
 * Usage:
 *   node scripts/lint-undeclared-deps.mjs
 *   node scripts/lint-undeclared-deps.mjs --json
 *
 * Exit:
 *   0 — clean (no undeclared imports)
 *   1 — bad args / could not read root manifest
 *   2 — at least one undeclared import
 *
 * See:
 *   docs/internal/hidden-risk-traps.md
 *   CLAUDE.local milestone 2026-06-19 (core-db sql.js fix)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { builtinModules } from "module";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

// Runtime source directories that ship to consumers.
const SOURCE_SUBDIRS = ["lib", "src", "bin"];
const SOURCE_EXT = /\.(c|m)?js$/;
// Directories/files excluded from the scan (tests, fixtures, generated).
const EXCLUDE_DIR = new Set([
  "node_modules",
  "__tests__",
  "__mocks__",
  "test",
  "tests",
  "fixtures",
  "__fixtures__",
  "assets", // bundled third-party blobs (e.g. cli/src/assets web-panel build)
]);
const EXCLUDE_FILE = /\.(test|spec)\.(c|m)?js$/;

// Node builtins (with and without the `node:` prefix).
const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

// Modules always provided by the runtime host — never an installable npm
// dependency for these libraries. `electron` is accessed defensively
// (`require("electron")` guarded by try/null-check) so the package works
// both inside the desktop app (electron present) and the CLI (absent).
const ALLOWED_AMBIENT = new Set(["electron", "vscode"]);

// npm package-name shape (lowercase, optional scope). Anything that fails
// this is not a real specifier — e.g. `${indexPath}` left over from a
// template literal that generates code.
const VALID_PKG_NAME = /^(?:@[a-z0-9][a-z0-9-._]*\/)?[a-z0-9][a-z0-9-._]*$/;

// ---------------------------------------------------------------------------
// Ratchet baseline: pre-existing undeclared imports, acknowledged with the
// correct fix. These resolve TODAY only via monorepo hoisting / transitive
// installs, so they "work" but are latent standalone-install hazards. The
// gate FAILS on anything NOT listed here (so no NEW undeclared import can
// land); listed items are tracked debt to burn down in each package's normal
// release cycle. Remove an entry the moment the dep is properly declared —
// the gate reports stale baseline entries so they don't rot.
// ---------------------------------------------------------------------------
const KNOWN_BASELINE = {
  // cli items burned down 2026-06-19 (cli 0.162.90): @noble/curves + js-yaml
  // moved/added to dependencies, playwright declared as optional peer.
  "@chainlesschain/personal-data-hub": {
    "pdf-parse":
      "lazy-loaded heavy optional (lib/adapters/email-imap/pdf-extractor.js) — ADD to optionalDependencies; triggers USR_VERSION + Android bundle rollover (traps #27/#28)",
    frida:
      "device-only lazy require (lib/adapters/wechat/key-providers/frida-key-provider.js) — ADD to optionalDependencies; Android bundle chain",
  },
};

/** Base package name of an import specifier: `@scope/name/sub` -> `@scope/name`, `pkg/sub` -> `pkg`. */
export function basePackage(spec) {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.slice(0, 2).join("/");
  }
  return spec.split("/")[0];
}

/**
 * Neutralize text that can hold import-shaped strings which are NOT real
 * imports of this package:
 *   - comments (incl. JSDoc examples like `// require("x")`)
 *   - template-literal contents — a `code generator` writes things like
 *     `import express from "express"` INTO a backtick string for the
 *     project it scaffolds; that's the generated project's dependency,
 *     not this package's. A real import statement is never inside a
 *     template literal, so blanking template contents is loss-free here
 *     (a genuine dynamic `require(`${x}`)` becomes `require()` → ignored,
 *     which is correct — computed paths aren't resolvable to a package).
 */
export function neutralize(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1") // line comments, skip `://`
    .replace(/`(?:\\.|[^`\\])*`/g, "``"); // template-literal contents
}

const IMPORT_PATTERNS = [
  // require("x") / require('x') — not a member access like foo.require(
  /(?:^|[^.\w$])require\(\s*["']([^"']+)["']\s*\)/g,
  // dynamic import("x")
  /(?:^|[^.\w$])import\(\s*["']([^"']+)["']\s*\)/g,
  // import ... from "x"  /  export ... from "x"
  /(?:^|[^.\w$])(?:import|export)\b[^"';]*?\bfrom\s*["']([^"']+)["']/g,
  // side-effect import "x"
  /(?:^|[^.\w$])import\s+["']([^"']+)["']/g,
];

/**
 * Pure core: external (non-relative, non-builtin, non-ambient) base package
 * names imported by a chunk of source text. Exported for unit testing.
 * Returns a sorted array (deterministic).
 */
export function detectExternalImports(text) {
  const cleaned = neutralize(text);
  const found = new Set();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
      const spec = m[1];
      if (!spec || spec.startsWith(".")) continue; // relative
      const base = basePackage(spec);
      if (!VALID_PKG_NAME.test(base)) continue; // template leftover / garbage
      if (BUILTINS.has(base) || BUILTINS.has(spec)) continue;
      if (ALLOWED_AMBIENT.has(base)) continue;
      found.add(base);
    }
  }
  return [...found].sort();
}

/** Collect external import specifiers from a source file (Set). */
function externalImportsOf(filePath) {
  return new Set(detectExternalImports(readFileSync(filePath, "utf-8")));
}

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIR.has(e.name)) continue;
      out.push(...walk(join(dir, e.name)));
    } else if (SOURCE_EXT.test(e.name) && !EXCLUDE_FILE.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

// CLI entry — runs the scan only when invoked directly, NOT when this module
// is imported (e.g. by scripts/__tests__/lint-undeclared-deps.test.mjs), so
// importing the pure helpers never triggers a repo scan or process.exit().
const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  if (args.includes("-h") || args.includes("--help")) {
    console.log("Usage: node scripts/lint-undeclared-deps.mjs [--json]");
    process.exit(0);
  }
  for (const a of args) {
    if (a !== "--json" && a !== "-h" && a !== "--help") {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }

  // 1. Resolve the set of workspace packages under packages/.
  let rootPkg;
  try {
    rootPkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf-8"),
    );
  } catch (err) {
    console.error(`Could not read root package.json: ${err.message}`);
    process.exit(1);
  }
  const workspaceDirs = (rootPkg.workspaces || [])
    .filter((w) => w.startsWith("packages/"))
    .map((w) => w.slice("packages/".length));

  // 2. Scan each.
  const newViolations = []; // [{package, packageDir, missing:[{base,examples}]}]
  const knownDebt = []; // [{package, base, note}]
  const baselineHit = new Set(); // "pkg::base" actually observed
  const scanned = [];
  const skipped = [];

  for (const dir of workspaceDirs) {
    const pkgDir = join(PACKAGES_DIR, dir);
    const pkgJsonPath = join(pkgDir, "package.json");
    if (!existsSync(pkgJsonPath)) continue; // workspaces lists some non-existent stubs
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    } catch {
      continue;
    }
    if (pkg.private) {
      skipped.push({ name: pkg.name || dir, reason: "private" });
      continue;
    }

    const declared = new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
      ...Object.keys(pkg.optionalDependencies || {}),
    ]);
    const ownName = pkg.name;
    const baseline = KNOWN_BASELINE[pkg.name] || {};

    const files = [];
    for (const sub of SOURCE_SUBDIRS) {
      const subDir = join(pkgDir, sub);
      if (existsSync(subDir) && statSync(subDir).isDirectory()) {
        files.push(...walk(subDir));
      }
    }
    scanned.push({ name: pkg.name, fileCount: files.length });

    const missing = new Map(); // base -> [relFiles]
    for (const file of files) {
      for (const base of externalImportsOf(file)) {
        if (base === ownName) continue; // self subpath import
        if (declared.has(base)) continue;
        if (!missing.has(base)) missing.set(base, []);
        const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
        if (missing.get(base).length < 5) missing.get(base).push(rel);
      }
    }

    const fresh = [];
    for (const [base, examples] of missing) {
      if (Object.prototype.hasOwnProperty.call(baseline, base)) {
        baselineHit.add(`${pkg.name}::${base}`);
        knownDebt.push({ package: pkg.name, base, note: baseline[base] });
      } else {
        fresh.push({ base, examples });
      }
    }
    if (fresh.length > 0) {
      newViolations.push({
        package: pkg.name,
        packageDir: `packages/${dir}`,
        missing: fresh,
      });
    }
  }

  // Baseline entries that no longer match a real finding (dep got declared,
  // or file removed) — should be deleted from KNOWN_BASELINE so it doesn't rot.
  const staleBaseline = [];
  for (const [pkgName, mods] of Object.entries(KNOWN_BASELINE)) {
    for (const base of Object.keys(mods)) {
      if (!baselineHit.has(`${pkgName}::${base}`)) {
        staleBaseline.push({ package: pkgName, base });
      }
    }
  }

  // 3. Report.
  if (asJson) {
    console.log(
      JSON.stringify(
        { newViolations, knownDebt, staleBaseline, scanned, skipped },
        null,
        2,
      ),
    );
    process.exit(newViolations.length > 0 ? 2 : 0);
  }

  if (knownDebt.length > 0) {
    console.log(
      `ℹ️  lint-undeclared-deps: ${knownDebt.length} known baseline item(s) (tracked debt — fix on next release of each package):`,
    );
    for (const d of knownDebt) {
      console.log(`    • ${d.package} → ${d.base}`);
      console.log(`        ${d.note}`);
    }
    console.log("");
  }

  if (staleBaseline.length > 0) {
    console.log(
      "⚠️  Stale KNOWN_BASELINE entries (no longer found — remove from scripts/lint-undeclared-deps.mjs):",
    );
    for (const s of staleBaseline)
      console.log(`    • ${s.package} → ${s.base}`);
    console.log("");
  }

  if (newViolations.length === 0) {
    console.log(
      `✅ lint-undeclared-deps: ${scanned.length} workspace package(s) scanned, ${skipped.length} skipped, 0 NEW undeclared imports`,
    );
    process.exit(0);
  }

  console.log(
    `❌ lint-undeclared-deps: ${newViolations.length} package(s) import modules they do not declare (not in baseline)`,
  );
  console.log("");
  for (const v of newViolations) {
    console.log(`  ${v.package}  (${v.packageDir}/package.json)`);
    for (const { base, examples } of v.missing) {
      console.log(`    ✗ ${base}`);
      for (const ex of examples) console.log(`        ${ex}`);
    }
    console.log("");
  }
  console.log("Fix: add each missing module to that package's `dependencies`");
  console.log(
    "(or `optionalDependencies` if it's a soft/fallback driver), then",
  );
  console.log(
    "bump the package version + propagate the dep-range to any sibling",
  );
  console.log(
    "workspace package that pins it (trap #28). A devDependency is NOT",
  );
  console.log("sufficient for code imported from lib/src/bin.");
  console.log("");
  console.log(
    "If it is a genuinely host-provided ambient (electron/vscode-style), add it",
  );
  console.log(
    "to ALLOWED_AMBIENT in scripts/lint-undeclared-deps.mjs instead.",
  );
  console.log("");
  console.log("Bypass (not recommended): git push --no-verify");
  process.exit(2);
}
