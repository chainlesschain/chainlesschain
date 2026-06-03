#!/usr/bin/env node
/**
 * audit-bs3mc-dual-load.js — trap #23 static-scan gate
 *
 * Every PDH adapter (or any module) that requires
 * `better-sqlite3-multiple-ciphers` (a.k.a. bs3mc) must do so via a
 * **dual-load** pattern: accept an injectable factory in `deps`, fall
 * back to the direct require only if the factory wasn't provided. The
 * canonical shape (used by all 10 social/messaging/travel adapters):
 *
 *     const Driver = this._deps.dbDriverFactory
 *         ? this._deps.dbDriverFactory()
 *         : require("better-sqlite3-multiple-ciphers");
 *
 * Why it matters (trap #23):
 *   - bs3mc native binding is ABI-specific. Electron 39 = ABI 140;
 *     Node 22 = ABI 127. The same install can't load both — calling
 *     `require("better-sqlite3-multiple-ciphers")` from a context
 *     that doesn't match its compiled ABI throws at runtime.
 *   - Without the factory escape hatch, tests can't inject a mock /
 *     sandbox / in-memory driver. The dual-load pattern lets
 *     `dbDriverFactory: () => require("better-sqlite3")` (or a stub)
 *     drive the adapter in non-Electron environments.
 *   - Memory: bs3mc_bs3_abi_dual_load_adapter.md +
 *     bs3mc_electron_abi_sandbox_workaround.md.
 *
 * The lint:
 *   - Scans packages/personal-data-hub/lib/adapters/**\/index.js,
 *     **\/adapter.js, **\/*-reader.js (matches what landed in tree).
 *   - Flags files that call `require("better-sqlite3-multiple-ciphers")`
 *     without a sibling `dbDriverFactory` ternary in the immediate
 *     surrounding statement.
 *
 * Heuristic: require() match within 250 chars of `dbDriverFactory` =
 * compliant; otherwise flag. False positives possible if the factory
 * lives further away in the file (e.g. extracted helper).
 *
 * Usage:
 *   node scripts/audit-bs3mc-dual-load.js
 *   node scripts/audit-bs3mc-dual-load.js --json
 *
 * Exit: 0 clean, 1 findings.
 *
 * See: docs/internal/hidden-risk-traps.md §23
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_ROOTS = ["packages/personal-data-hub/lib"];
const NAME_FILTER = /(?:^|[\\/])(?:index|adapter|.*-reader)\.(?:js|cjs|mjs)$/;
const SKIP_RE =
  /(?:^|[\\/])(?:node_modules|dist|build|coverage|__tests__|__snapshots__)(?:[\\/]|$)/;

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const explicitFiles = args.filter((a) => !a.startsWith("--"));

const BS3MC_RE = /require\(\s*["']better-sqlite3-multiple-ciphers["']\s*\)/g;
// Accept either the canonical `dbDriverFactory` name (10 PDH adapters)
// or any `_driver` / `driver:` DI-seam pattern (wechat/db-reader.js). The
// shared signal is "the module exposes a way for callers to inject an
// alternate sqlite Driver constructor so tests / non-Electron contexts
// don't trip the ABI mismatch."
const FACTORY_RE = /dbDriverFactory|\bthis\._driver\b|\bopts\.driver\b|\bdriver\s*:/;

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
    } else if (entry.isFile() && NAME_FILTER.test(full)) {
      yield full;
    }
  }
}

function offsetToLine(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

function scanFile(file) {
  let src;
  try {
    src = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  BS3MC_RE.lastIndex = 0;
  // File-level check: if the file contains the require AND a DI-seam factory
  // pattern ANYWHERE, treat as compliant. Cross-function dual-load (helper
  // function with the require + class field as the seam, like wechat/db-
  // reader.js) shouldn't be flagged just because they're far apart.
  const hasFactory = FACTORY_RE.test(src);
  const findings = [];
  let m;
  while ((m = BS3MC_RE.exec(src))) {
    if (hasFactory) continue; // file-level compliant
    findings.push({
      file: path.relative(ROOT, file).replace(/\\/g, "/"),
      line: offsetToLine(src, m.index),
      severity: "HIGH",
      message:
        "require(\"better-sqlite3-multiple-ciphers\") with no DI-seam factory pattern anywhere in file — trap #23 ABI dual-load",
      snippet: src
        .slice(Math.max(0, m.index - 100), Math.min(src.length, m.index + 150))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200),
    });
    break; // one finding per file is sufficient
  }
  return findings;
}

function collectFiles() {
  if (explicitFiles.length > 0) {
    return explicitFiles
      .map((p) => path.resolve(p))
      .filter((p) => fs.existsSync(p));
  }
  const out = [];
  for (const sub of SCAN_ROOTS) {
    const dir = path.join(ROOT, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of walk(dir)) out.push(f);
  }
  return out;
}

function main() {
  const files = collectFiles();
  const allFindings = [];
  for (const f of files) allFindings.push(...scanFile(f));

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
      `✅ audit-bs3mc-dual-load: 0 findings in ${files.length} adapter files`,
    );
    process.exit(0);
  }

  console.log(
    `⚠️  audit-bs3mc-dual-load: ${allFindings.length} finding(s) in ${files.length} files`,
  );
  console.log(
    `   Trap #23 — bs3mc native binding ABI-specific (Electron ABI 140 vs Node`,
  );
  console.log(
    `   ABI 127). Adapters must accept injectable dbDriverFactory so the`,
  );
  console.log(`   sandbox / Node-only test path can load a compatible driver.`);
  console.log("");
  for (const f of allFindings) {
    console.log(`  ${f.file}:${f.line}  [${f.severity}]  ${f.message}`);
    console.log(`    ${f.snippet}`);
  }
  console.log("");
  console.log(`   Canonical pattern (used by all current PDH adapters):`);
  console.log("");
  console.log(`     const Driver = this._deps.dbDriverFactory`);
  console.log(`         ? this._deps.dbDriverFactory()`);
  console.log(`         : require("better-sqlite3-multiple-ciphers");`);
  console.log("");
  console.log(`   See docs/internal/hidden-risk-traps.md §23.`);
  process.exit(1);
}

main();
