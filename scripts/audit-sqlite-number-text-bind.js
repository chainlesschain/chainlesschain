#!/usr/bin/env node
/**
 * audit-sqlite-number-text-bind.js — trap #15 static-scan gate
 *
 * Detects JS Number values being bound through better-sqlite3 / async sqlite
 * APIs into SQLite columns. SQLite type affinity stores `Number(1)` as REAL
 * `1.0`, so a later `WHERE col = '1'` silent-misses. The hand-written rule:
 * any value going into a TEXT column must be String()-wrapped or already a
 * string.
 *
 * This script can't infer column types from raw SQL across all call sites,
 * so it uses a conservative heuristic: flag every `.run(` / `.get(` / `.all(`
 * / `.iterate(` call whose argument list contains `Number(...)`,
 * `parseInt(...)`, `Math.round/floor/ceil/trunc(...)`, or `+<ident>` (unary
 * plus coercion). False positives are accepted because the trap is severe
 * and "wrap with String()" is cheap.
 *
 * Use:
 *   node scripts/audit-sqlite-number-text-bind.js           # default tree scan
 *   node scripts/audit-sqlite-number-text-bind.js --json    # machine-readable
 *   node scripts/audit-sqlite-number-text-bind.js path1 ... # specific files
 *
 * Exit: 0 if no findings, 1 if any. CI workflow runs as advisory (continue-on-
 * error) so it surfaces in PR comments without blocking merge.
 *
 * See: docs/internal/hidden-risk-traps.md §15
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// Scan globs (relative to repo root). Limited to known SQLite-writing trees
// to keep noise down. Extend when new SQLite consumers land.
const SCAN_DIRS = [
  "desktop-app-vue/src/main",
  "packages/personal-data-hub/lib",
  "packages/cli/lib",
  "packages/core-knowledge/src",
];

// File extensions to scan.
const EXTS = new Set([".js", ".cjs", ".mjs"]);

// Skip these subtrees even if under a SCAN_DIR.
const SKIP_RE =
  /(?:^|[\\/])(?:node_modules|dist|build|coverage|__snapshots__|\.git)(?:[\\/]|$)/;

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const explicitFiles = args.filter((a) => !a.startsWith("--"));

/**
 * Walks a directory tree yielding file paths matching EXTS.
 */
function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (SKIP_RE.test(full)) continue;
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && EXTS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

/**
 * Returns the full text of a `.method(` invocation starting at `methodIdx`
 * (the `.` position), respecting nested parens / brackets / strings. Returns
 * null if unbalanced (caller should treat as no-match).
 */
function captureCall(src, methodIdx) {
  const parenStart = src.indexOf("(", methodIdx);
  if (parenStart < 0) return null;
  let depth = 0;
  let inStr = null; // "'", '"', or "`"
  let escape = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = parenStart; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      // template literal expression interpolation
      if (inStr === "`" && ch === "$" && next === "{") {
        // descend into expression — treat as paren depth
        inStr = null;
        depth++;
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0 && ch === ")") {
        return src.slice(parenStart, i + 1);
      }
    }
  }
  return null;
}

// SQLite-binding method names to watch, scoped to receivers that look like
// SQLite handles. Two accepted shapes:
//   1. `<receiver>.method(` where receiver = db / database / stmt / sqlite[Db] / statement
//   2. `).method(` — any chained call (covers `db.prepare("...").run(...)`).
// The chained shape allows false positives; the first-arg SQL-keyword filter
// in scanFile() cuts them.
const METHOD_RE =
  /(?:\b(?:db|database|sqlite|sqliteDb|stmt|statement)|\))\s*\.(run|get|all|iterate|exec)\s*\(/gi;

// Suspicious value-coercion patterns inside arg list.
const PATTERNS = [
  { re: /\bNumber\s*\(/g, label: "Number(...)" },
  { re: /\bparseInt\s*\(/g, label: "parseInt(...)" },
  { re: /\bparseFloat\s*\(/g, label: "parseFloat(...)" },
  {
    re: /\bMath\.(round|floor|ceil|trunc)\s*\(/g,
    label: "Math.round/floor/ceil/trunc(...)",
  },
  // unary plus coercion: `+x` or `+(...)`. Hard to distinguish from binary
  // `+`; require preceding `,`/`[`/`(`/`:`/whitespace+keyword.
  { re: /[,\[(:]\s*\+\s*[A-Za-z_$]/g, label: "+<ident> (unary coercion)" },
];

/**
 * Returns line number (1-based) for a character offset.
 */
function offsetToLine(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

// Matches `.prepare(` — chained pattern where SQL is in the prepare() call
// and bind values are in a subsequent .run/.get/.all/.iterate.
const PREPARE_RE = /\.prepare\s*\(/g;

/**
 * After a `prepare(SQL)` call, finds the next chained `.run/.get/.all/.iterate`
 * call and returns its body. Returns null if no chain or no SQL write keyword.
 */
function findPreparedExecCall(src, prepareIdx) {
  const dotIdx = src.indexOf(".", prepareIdx);
  if (dotIdx < 0) return null;
  const parenStart = src.indexOf("(", dotIdx);
  if (parenStart < 0) return null;
  const prepCall = captureCall(src, dotIdx);
  if (!prepCall) return null;
  // Must be a SQL write (INSERT / UPDATE / REPLACE).
  if (!/^\(\s*['"`]\s*(INSERT|UPDATE|REPLACE)\b/i.test(prepCall)) return null;
  // Walk past the `)` of prepare(), past `.bind(...)` etc. chained calls,
  // looking for `.run/.get/.all/.iterate(` to attribute findings to.
  // prepCall starts at parenStart; its length covers `("...")`. So the
  // position right after the closing `)` of prepare is parenStart + prepCall.length.
  let cursor = parenStart + prepCall.length;
  // Greedy chain walk: keep eating `.method(...)` until we hit run/get/all/iterate.
  while (cursor < src.length) {
    // Skip whitespace
    while (cursor < src.length && /\s/.test(src[cursor])) cursor++;
    if (src[cursor] !== ".") return null;
    const nextDotIdx = cursor;
    const methodNameMatch = src.slice(nextDotIdx + 1).match(/^([A-Za-z_$]+)\s*\(/);
    if (!methodNameMatch) return null;
    const method = methodNameMatch[1];
    const chainedCall = captureCall(src, nextDotIdx);
    if (!chainedCall) return null;
    if (/^(run|get|all|iterate|exec)$/i.test(method)) {
      return { method: method.toLowerCase(), call: chainedCall, offset: nextDotIdx };
    }
    // Otherwise keep walking the chain (e.g. .bind(...).run(...))
    cursor = nextDotIdx + chainedCall.length;
  }
  return null;
}

/**
 * Scans one file, returns array of finding records.
 */
function scanFile(file) {
  let src;
  try {
    src = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  // Cheap pre-filter: must mention at least one SQL-ish keyword and a
  // suspicious binding pattern, otherwise skip entirely.
  if (
    !/\b(INSERT|UPDATE|REPLACE)\b/i.test(src) ||
    !/Number\s*\(|parseInt\s*\(|Math\.(round|floor|ceil|trunc)\s*\(/.test(src)
  ) {
    return [];
  }
  const findings = [];
  METHOD_RE.lastIndex = 0;
  let m;
  while ((m = METHOD_RE.exec(src))) {
    // Position of the `.method(` paren. The capture group spans the dot to
    // the `(`; we want the `(` to start the call body.
    const methodIdx = src.indexOf(".", m.index);
    if (methodIdx < 0) continue;
    const call = captureCall(src, methodIdx);
    if (!call) continue;
    // Require the call's FIRST argument (string literal) to start with a
    // SQL write keyword. Strips leading paren + whitespace + comments.
    const firstArgMatch = call.match(
      /^\(\s*(?:\/\*[\s\S]*?\*\/\s*)?['"`]\s*(INSERT|UPDATE|REPLACE)\b/i,
    );
    if (!firstArgMatch) continue;
    for (const pat of PATTERNS) {
      pat.re.lastIndex = 0;
      let pm;
      while ((pm = pat.re.exec(call))) {
        const srcOffset = methodIdx + pm.index;
        findings.push({
          file: path.relative(ROOT, file).replace(/\\/g, "/"),
          line: offsetToLine(src, srcOffset),
          pattern: pat.label,
          method: m[1].toLowerCase(),
          snippet: call.slice(0, 200).replace(/\s+/g, " ").trim(),
        });
      }
    }
  }

  // Second pass: `.prepare(SQL).run(bindings)` chains where SQL lives in
  // prepare() and bind values live in the chained call.
  PREPARE_RE.lastIndex = 0;
  let pm2;
  while ((pm2 = PREPARE_RE.exec(src))) {
    const prepareIdx = pm2.index; // position of "."
    const exec = findPreparedExecCall(src, prepareIdx);
    if (!exec) continue;
    for (const pat of PATTERNS) {
      pat.re.lastIndex = 0;
      let hit;
      while ((hit = pat.re.exec(exec.call))) {
        const srcOffset = exec.offset + hit.index;
        findings.push({
          file: path.relative(ROOT, file).replace(/\\/g, "/"),
          line: offsetToLine(src, srcOffset),
          pattern: pat.label,
          method: exec.method,
          snippet: exec.call.slice(0, 200).replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  return findings;
}

function collectFiles() {
  if (explicitFiles.length > 0) {
    return explicitFiles
      .map((p) => path.resolve(p))
      .filter((p) => EXTS.has(path.extname(p)) && fs.existsSync(p));
  }
  const out = [];
  for (const sub of SCAN_DIRS) {
    const dir = path.join(ROOT, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of walk(dir)) out.push(f);
  }
  return out;
}

function main() {
  const files = collectFiles();
  const allFindings = [];
  for (const f of files) {
    const findings = scanFile(f);
    allFindings.push(...findings);
  }

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        { findings: allFindings, scanned: files.length },
        null,
        2,
      ) + "\n",
    );
    process.exit(allFindings.length > 0 ? 1 : 0);
  }

  if (allFindings.length === 0) {
    console.log(
      `✅ audit-sqlite-number-text-bind: 0 findings in ${files.length} files`,
    );
    process.exit(0);
  }

  console.log(
    `⚠️  audit-sqlite-number-text-bind: ${allFindings.length} finding(s) in ${files.length} files`,
  );
  console.log(
    `   Trap #15 — JS Number bound to SQLite TEXT column stores as REAL "1.0",`,
  );
  console.log(
    `   later WHERE col = '1' silent-misses. Wrap value with String() if column is TEXT.`,
  );
  console.log("");
  for (const f of allFindings) {
    console.log(`  ${f.file}:${f.line}  [${f.method}]  ${f.pattern}`);
    console.log(`    ${f.snippet}`);
  }
  console.log("");
  console.log(
    `   Fix: stmt.run([..., String(value), ...]) instead of Number(value).`,
  );
  console.log(`   See docs/internal/hidden-risk-traps.md §15.`);
  process.exit(1);
}

main();
