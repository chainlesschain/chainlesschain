#!/usr/bin/env node
/**
 * Merge `changelog/v*.md` per-version drafts into the top-level
 * `CHANGELOG.md` at release time.
 *
 * Why a separate script instead of inline editing: trap #10 — concurrent
 * sessions editing the monolithic CHANGELOG.md can race via lint-staged's
 * unstaged-window sweep. Per-version drafts solve the write-side; this
 * script solves the splice-side, run once at release by one process.
 *
 * Usage:
 *   node scripts/changelog-merge.js              # merge + remove drafts
 *   node scripts/changelog-merge.js --dry-run    # show plan, don't touch files
 *   node scripts/changelog-merge.js --keep       # merge but don't delete drafts
 *
 * Behavior:
 *   1. Reads every `changelog/v*.md` file (matches `^v\d+\.\d+\.\d+\.\d+\.md$`).
 *   2. Sorts drafts by version (newest first).
 *   3. Reads top-level `CHANGELOG.md`. Verifies each draft's version is NOT
 *      already present in `CHANGELOG.md` (no double-merge).
 *   4. Inserts each draft block immediately after the file's preamble (above
 *      all existing version entries). Preserves blank-line separation.
 *   5. Writes `CHANGELOG.md` atomically (tmp + rename).
 *   6. Deletes the draft files (unless `--keep`).
 *
 * No git operations — the caller is responsible for staging/committing.
 *
 * Exit:
 *   0  — merged or nothing to merge (no drafts found)
 *   1  — bad args
 *   2  — filesystem error
 *   3  — version conflict (draft version already in CHANGELOG.md)
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const CHANGELOG_PATH = path.join(REPO_ROOT, "CHANGELOG.md");
const CHANGELOG_DIR = path.join(REPO_ROOT, "changelog");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keep = args.includes("--keep");
const unknownArgs = args.filter(
  (a) => a !== "--dry-run" && a !== "--keep",
);
if (unknownArgs.length > 0) {
  console.error(`Unknown args: ${unknownArgs.join(", ")}`);
  console.error("Usage: node scripts/changelog-merge.js [--dry-run] [--keep]");
  process.exit(1);
}

/**
 * Parse "vX.Y.Z" or "vX.Y.Z.N" into a sortable tuple [X, Y, Z, N].
 * 3-part versions get N=0 (treated as the earliest patch of that triplet).
 */
function parseVersion(v) {
  const m4 = /^v(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (m4) return [Number(m4[1]), Number(m4[2]), Number(m4[3]), Number(m4[4])];
  const m3 = /^v(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (m3) return [Number(m3[1]), Number(m3[2]), Number(m3[3]), 0];
  return null;
}

function compareVersionsDesc(a, b) {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
}

// 1. Find drafts.
let entries;
try {
  entries = fs.readdirSync(CHANGELOG_DIR);
} catch (err) {
  if (err.code === "ENOENT") {
    console.log("No changelog/ directory — nothing to merge.");
    process.exit(0);
  }
  console.error(`Could not read ${CHANGELOG_DIR}: ${err.message}`);
  process.exit(2);
}

const drafts = [];
for (const entry of entries) {
  // Accept v3-part (v0.2.0) and v4-part (v5.0.3.97)
  const m = /^(v\d+\.\d+\.\d+(?:\.\d+)?)\.md$/.exec(entry);
  if (!m) continue;
  const parts = parseVersion(m[1]);
  if (!parts) continue;
  drafts.push({
    version: m[1],
    parts,
    filename: entry,
    filepath: path.join(CHANGELOG_DIR, entry),
  });
}

if (drafts.length === 0) {
  console.log("No changelog/v*.md drafts to merge.");
  process.exit(0);
}

// 2. Sort newest first.
drafts.sort((a, b) => compareVersionsDesc(a.parts, b.parts));

// 3. Read existing CHANGELOG.md.
let changelogContent;
try {
  changelogContent = fs.readFileSync(CHANGELOG_PATH, "utf-8");
} catch (err) {
  console.error(`Could not read ${CHANGELOG_PATH}: ${err.message}`);
  process.exit(2);
}

// 4. Verify no version conflicts.
const conflicts = [];
for (const d of drafts) {
  const escaped = d.version.replace(/\./g, "\\.");
  const re = new RegExp(`^## \\[${escaped}\\]`, "m");
  if (re.test(changelogContent)) {
    conflicts.push(d.version);
  }
}
if (conflicts.length > 0) {
  console.error("✗ Version conflict — these draft versions already exist in CHANGELOG.md:");
  for (const c of conflicts) console.error(`    ${c}`);
  console.error("Remove the existing entry from CHANGELOG.md, or delete the draft, before merging.");
  process.exit(3);
}

// 5. Find insertion point: immediately before the FIRST `## [v...` line
//    (accepts both 3-part and 4-part version forms).
const firstVersionMatch = /^## \[v\d+\.\d+\.\d+(?:\.\d+)?\]/m.exec(changelogContent);
let insertOffset;
if (firstVersionMatch) {
  insertOffset = firstVersionMatch.index;
} else {
  // No existing version entries — append at the end (preserve preamble).
  insertOffset = changelogContent.length;
  if (!changelogContent.endsWith("\n")) changelogContent += "\n";
}

// 6. Build the merged block (drafts joined newest-first, each ending with a blank line).
const draftBlocks = drafts.map((d) => {
  let body = fs.readFileSync(d.filepath, "utf-8").trimEnd();
  if (!body.endsWith("\n")) body += "\n";
  return body + "\n"; // blank line separator
});
const insertion = draftBlocks.join("");

const newChangelog =
  changelogContent.slice(0, insertOffset) +
  insertion +
  changelogContent.slice(insertOffset);

// 7. Plan summary.
console.log("Drafts to merge (newest first):");
for (const d of drafts) console.log(`  ${d.version}  (${d.filename})`);
console.log(`Insertion point: byte ${insertOffset}${firstVersionMatch ? ` (above first existing entry ${firstVersionMatch[0]})` : " (end of file — no existing entries)"}`);
console.log(`Net change: +${newChangelog.length - changelogContent.length} bytes`);

if (dryRun) {
  console.log("");
  console.log("--dry-run — no files modified.");
  process.exit(0);
}

// 8. Atomic write: tmp + rename.
const tmpPath = CHANGELOG_PATH + ".tmp." + process.pid;
try {
  fs.writeFileSync(tmpPath, newChangelog, "utf-8");
  fs.renameSync(tmpPath, CHANGELOG_PATH);
} catch (err) {
  console.error(`Could not write ${CHANGELOG_PATH}: ${err.message}`);
  try {
    fs.unlinkSync(tmpPath);
  } catch {}
  process.exit(2);
}
console.log(`✓ Merged into ${path.relative(REPO_ROOT, CHANGELOG_PATH).replace(/\\/g, "/")}`);

// 9. Delete drafts (unless --keep).
if (!keep) {
  for (const d of drafts) {
    try {
      fs.unlinkSync(d.filepath);
      console.log(`✓ Removed ${path.relative(REPO_ROOT, d.filepath).replace(/\\/g, "/")}`);
    } catch (err) {
      console.warn(`! Could not remove ${d.filepath}: ${err.message}`);
    }
  }
} else {
  console.log("--keep — draft files retained.");
}

process.exit(0);
