#!/usr/bin/env node
/**
 * audit-esm-require.mjs — trap #33 static-scan gate
 *
 * Detects bare `require()` / `require.resolve()` in the CLI's ESM source.
 *
 * Why it matters (docs/internal/hidden-risk-traps.md, trap #33):
 *   packages/cli is `"type": "module"`, so every .js under src/ is ESM, where
 *   `require` is NOT a global. A bare `require("fs")` inside a function does
 *   not error at import time — it throws `ReferenceError: require is not
 *   defined` only when that code path actually runs. So it stays latent and
 *   slips past unit tests: vitest inlines CJS and provides a `require`, so the
 *   tests pass even though the published ESM bundle crashes. 2026-06-22:
 *   `cc hub export-events --output` / `cc hub import-events` were fully broken
 *   this way in shipped versions; a whole-tree sweep found 3 more files.
 *
 * The fix at each site is one of:
 *   - a static `import` (for always-needed core modules), or
 *   - `const { createRequire } = ...; const require = createRequire(import.meta.url)`
 *     when a *lazy* / circular-dep-avoiding load must stay synchronous
 *     (Node >=22.12 — our engines floor — supports require(esm)).
 *
 * What this flags (precision via real AST + scope analysis, not regex):
 *   A reference to the identifier `require` (as a call callee `require(...)`
 *   or member object `require.resolve(...)`) that eslint-scope leaves
 *   UNRESOLVED — i.e. it points at a non-existent ESM global rather than a
 *   local `createRequire` shim. Because the analysis is AST-based:
 *     - `require(...)` inside a template literal (generated CJS skill files,
 *       e.g. init.js / cli-anything-bridge.js) is string text, not a node →
 *       never flagged.
 *     - A file that shims `require` in one function but uses a bare `require`
 *       in another scope IS still flagged at the bare site (scope-precise).
 *     - `_require` / `requireCjs` / other names are different identifiers →
 *       not matched.
 *
 * Scope: every .js under packages/cli/src, excluding bundled assets under
 * src/assets (NOTE: glob patterns are spelled out in prose here on purpose —
 * a literal star-slash sequence would close this block comment early).
 *
 * Exit 0 = clean; exit 1 = at least one bare require in ESM. `--json` for
 * machine-readable output.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";
import * as eslintScope from "eslint-scope";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_ROOT = join(REPO_ROOT, "packages", "cli", "src");
const EXCLUDE_DIR_SEGMENTS = [`${sep}assets${sep}`];

// CJS-only module globals — undefined in an ESM module scope.
const CJS_GLOBALS = new Set([
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
]);

function listJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

/** Return findings [{ file, line, column, snippet }] for one source file. */
function auditFile(file) {
  const code = readFileSync(file, "utf-8");
  // Cheap pre-filter: none of the CJS globals appear textually → nothing to do.
  if (![...CJS_GLOBALS].some((g) => code.includes(g))) return [];

  let ast;
  try {
    ast = acorn.parse(code, {
      sourceType: "module",
      ecmaVersion: "latest",
      locations: true,
      ranges: true, // eslint-scope reads node.range[] during resolution
      allowHashBang: true,
    });
  } catch {
    // Unparseable (e.g. a stray non-module asset) — skip rather than crash the
    // gate. The CLI's real ESM sources all parse.
    return [];
  }

  const scopeManager = eslintScope.analyze(ast, {
    sourceType: "module",
    // eslint-scope compares ecmaVersion numerically (>= 6 → ES module mode);
    // a string like "latest" fails that check and mis-parses `import`.
    ecmaVersion: 2022,
  });

  const findings = [];
  const seen = new Set();
  for (const scope of scopeManager.scopes) {
    for (const ref of scope.references) {
      // CJS module globals that don't exist in ESM scope. A bare reference to
      // any of these throws "X is not defined" at runtime (require/module/
      // exports) or yields undefined surprises — the exact root cause that
      // left shell-approval.js's `module.exports = {...}` exporting nothing.
      if (!CJS_GLOBALS.has(ref.identifier.name)) continue;
      // Resolved to a local binding (a createRequire shim, a fn param, an
      // import.meta-derived const) → intentional, not a CJS global.
      if (ref.resolved) continue;
      const node = ref.identifier;
      const key = `${node.loc.start.line}:${node.loc.start.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        file: relative(REPO_ROOT, file).split(sep).join("/"),
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
        snippet: code.split("\n")[node.loc.start.line - 1].trim().slice(0, 100),
      });
    }
  }
  return findings;
}

function main() {
  const asJson = process.argv.includes("--json");
  const files = listJsFiles(SCAN_ROOT).filter(
    (f) => !EXCLUDE_DIR_SEGMENTS.some((seg) => f.includes(seg)),
  );

  const findings = [];
  for (const f of files) findings.push(...auditFile(f));
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  if (asJson) {
    console.log(JSON.stringify({ scanned: files.length, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log(
      `✓ audit-esm-require: scanned ${files.length} CLI ESM files, no bare CJS globals (require/module/exports/__dirname/__filename) found.`,
    );
  } else {
    console.error(
      `✗ audit-esm-require: ${findings.length} bare CJS global(s) in ESM (require/module/exports/__dirname/__filename — undefined in ESM, throws or silently no-ops at runtime):\n`,
    );
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}:${f.column}  ${f.snippet}`);
    }
    console.error(
      `\nFix: use a static \`import\`, or a \`createRequire(import.meta.url)\` shim` +
        ` for lazy/circular loads. See docs/internal/hidden-risk-traps.md trap #33.`,
    );
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

main();
