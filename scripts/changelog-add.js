#!/usr/bin/env node
/**
 * Create a per-version changelog draft file under `changelog/` and
 * atomically `git add` it.
 *
 * Why: editing the monolithic top-level `CHANGELOG.md` directly leaves an
 * unstaged window where another session's `lint-staged --no-stash` can
 * sweep-format and (worst case) silently overwrite — trap #10. Working
 * in `changelog/v<version>.md` per-version files instead avoids the
 * collision entirely.
 *
 * Usage:
 *   node scripts/changelog-add.js v5.0.3.97 "fix(desktop): small fix"
 *   node scripts/changelog-add.js v5.0.3.97 "fix(desktop): small fix" --date=2026-05-29
 *
 * Behavior:
 *   1. Creates `changelog/v5.0.3.97.md` with the standard header template.
 *   2. Runs `git add changelog/v5.0.3.97.md` so the file is in the index
 *      immediately (closes the trap #10 unstaged window).
 *   3. Prints the file path so the user can open + finish writing.
 *
 * Exit codes:
 *   0  — created (or already exists; user can finish writing)
 *   1  — bad args
 *   2  — filesystem error
 *   3  — git add failed (still exits 0 if file was created; reports warn)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const CHANGELOG_DIR = path.join(REPO_ROOT, "changelog");

function usage() {
  console.error("Usage: node scripts/changelog-add.js <vX.Y.Z.N> <one-line subject> [--date=YYYY-MM-DD]");
  console.error('Example: node scripts/changelog-add.js v5.0.3.97 "fix(desktop): tray menu reset"');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();

const version = args[0];
const subject = args[1];
const dateArg = args.find((a) => a.startsWith("--date="));
const date = dateArg
  ? dateArg.slice("--date=".length)
  : new Date().toISOString().slice(0, 10);

if (!/^v\d+\.\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Bad version "${version}" — expected vX.Y.Z.N (e.g. v5.0.3.97).`);
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`Bad date "${date}" — expected YYYY-MM-DD.`);
  process.exit(1);
}
if (!subject.trim()) {
  console.error("Subject must be non-empty.");
  process.exit(1);
}

// 1. Ensure the changelog/ directory exists.
try {
  fs.mkdirSync(CHANGELOG_DIR, { recursive: true });
} catch (err) {
  console.error(`Could not mkdir ${CHANGELOG_DIR}: ${err.message}`);
  process.exit(2);
}

// 2. Build the draft path.
const draftPath = path.join(CHANGELOG_DIR, `${version}.md`);
const draftRel = path.relative(REPO_ROOT, draftPath).replace(/\\/g, "/");

// 3. If file already exists, don't overwrite — just report + git add.
if (fs.existsSync(draftPath)) {
  console.log(`✓ ${draftRel} already exists — leaving untouched.`);
  tryGitAdd(draftRel);
  console.log(`  Edit it: ${draftRel}`);
  process.exit(0);
}

// 4. Write the template.
const template = `## [${version}] - ${date} — ${subject}

> <Optional pull-quote: what's this release about? Why does it exist? Cite the
> user-visible problem or the upstream incident driving the work. Delete this
> blockquote if you don't need it.>

### <Section heading: Fix / Added / Changed / etc.>

- <bullet> (\`<commit-sha>\`)
- <bullet> (\`<commit-sha>\`)

### Bundled

- <commit subject> (\`<commit-sha>\`)
`;

try {
  fs.writeFileSync(draftPath, template, "utf-8");
} catch (err) {
  console.error(`Could not write ${draftPath}: ${err.message}`);
  process.exit(2);
}

console.log(`✓ Created ${draftRel}`);

// 5. Atomically git add — closes the trap #10 unstaged window.
tryGitAdd(draftRel);

console.log("");
console.log("Next:");
console.log(`  1. Edit ${draftRel}`);
console.log("  2. git commit (the file is already staged)");
console.log("  3. At release time, scripts/changelog-merge.js splices it into CHANGELOG.md");
process.exit(0);

function tryGitAdd(relPath) {
  try {
    execSync(`git add ${JSON.stringify(relPath)}`, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });
    console.log(`✓ git add ${relPath}`);
  } catch (err) {
    console.warn(
      `! git add ${relPath} failed — please stage manually. (${err.message.split("\n")[0]})`,
    );
  }
}
