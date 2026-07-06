#!/usr/bin/env node
/**
 * Build the bundled CLI changelog data (`src/data/changelog.json`) from the
 * repository-root CHANGELOG.md. Runs at publish time (chained into
 * `prepublishOnly`) so the shipped npm package can serve `cc changelog` offline.
 *
 * The parser (`src/lib/changelog.js`) distills the product-versioned CHANGELOG
 * into a CLI-focused subset — see that module for the extraction rules.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog } from "../src/lib/changelog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..", "..");
const srcPath = path.join(repoRoot, "CHANGELOG.md");
const outDir = path.join(__dirname, "..", "src", "data");
const outPath = path.join(outDir, "changelog.json");

if (!fs.existsSync(srcPath)) {
  console.error(`[build-changelog] source not found: ${srcPath}`);
  process.exit(1);
}

const md = fs.readFileSync(srcPath, "utf-8");
const releases = parseChangelog(md);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: "CHANGELOG.md",
      releases,
    },
    null,
    0,
  ),
  "utf-8",
);

console.log(
  `[build-changelog] wrote ${releases.length} CLI releases → ${path.relative(repoRoot, outPath)}`,
);
