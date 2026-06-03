#!/usr/bin/env node
/**
 * audit-hand-written-tar-parsers.js — trap #21 static-scan gate
 *
 * Any hand-written tar parser in Kotlin (or anywhere) that processes
 * the `typeFlag` field MUST handle GNU extensions 'L' (long-name) and
 * 'K' (long-linkname). Without them, npm-pack tarballs with paths
 * longer than 100 chars get parsed as if `@LongLink` was a regular
 * file — the long-name entry's data is written to disk as content,
 * and the next entry uses a truncated name. Result: cc bundle
 * extraction silently corrupts on Android.
 *
 * The fix lives at android-app/feature-local-terminal/src/main/java/
 * com/chainlesschain/android/feature/localterminal/LocalFilesystemBootstrapper.kt
 * (line 572 ish — `if (typeFlag == 'L' || typeFlag == 'K')`).
 *
 * This lint flags any .kt file that:
 *   - References a `typeFlag` (or `typeflag`) variable / member, AND
 *   - Does NOT contain both `'L'` and `'K'` literal checks
 *
 * False positives possible: a file that uses `typeFlag` for a totally
 * unrelated purpose, or a parser that handles 'L'/'K' via a different
 * mechanism (constants, helper). Advisory only.
 *
 * Usage:
 *   node scripts/audit-hand-written-tar-parsers.js
 *   node scripts/audit-hand-written-tar-parsers.js --json
 *
 * Exit: 0 clean, 1 findings.
 *
 * See: docs/internal/hidden-risk-traps.md §21
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["android-app"];
const SKIP_RE =
  /(?:^|[\\/])(?:build|generated|\.gradle|node_modules)(?:[\\/]|$)/;

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const explicitFiles = args.filter((a) => !a.startsWith("--"));

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
    } else if (entry.isFile() && entry.name.endsWith(".kt")) {
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
  // Pre-filter: must reference typeFlag in a way that suggests tar parsing.
  const tfMatch = /\btypeFlag\b|\btypeflag\b/.exec(src);
  if (!tfMatch) return [];
  // If the file mentions both 'L' and 'K' as char literals, we treat it as
  // correct. Need to look for the actual literal characters in single quotes.
  const hasL = /'L'/.test(src);
  const hasK = /'K'/.test(src);
  if (hasL && hasK) return [];
  // Otherwise: flag.
  const missing = [];
  if (!hasL) missing.push("'L' (long-name)");
  if (!hasK) missing.push("'K' (long-linkname)");
  return [
    {
      file: path.relative(ROOT, file).replace(/\\/g, "/"),
      line: offsetToLine(src, tfMatch.index),
      severity: "MEDIUM",
      message: `tar parser missing GNU typeflag handling: ${missing.join(", ")}`,
      typeFlagAt: tfMatch.index,
    },
  ];
}

function collectFiles() {
  if (explicitFiles.length > 0) {
    return explicitFiles
      .map((p) => path.resolve(p))
      .filter((p) => p.endsWith(".kt") && fs.existsSync(p));
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
    allFindings.push(...scanFile(f));
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
      `✅ audit-hand-written-tar-parsers: 0 findings in ${files.length} Kotlin files`,
    );
    process.exit(0);
  }

  console.log(
    `⚠️  audit-hand-written-tar-parsers: ${allFindings.length} finding(s) in ${files.length} files`,
  );
  console.log(
    `   Trap #21 — hand-written tar parsers must handle GNU 'L' / 'K' typeflag`,
  );
  console.log(
    `   extensions or @LongLink entries get parsed as regular files (silent`,
  );
  console.log(`   on-device corruption with paths > 100 chars).`);
  console.log("");
  for (const f of allFindings) {
    console.log(`  ${f.file}:${f.line}  [${f.severity}]  ${f.message}`);
  }
  console.log("");
  console.log(
    `   Reference fix: android-app/feature-local-terminal/src/main/.../`,
  );
  console.log(`   LocalFilesystemBootstrapper.kt — search for 'L'/'K' typeFlag.`);
  console.log(`   See docs/internal/hidden-risk-traps.md §21.`);
  process.exit(1);
}

main();
