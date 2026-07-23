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
import { format } from "prettier";
import { latestCliVersion, parseChangelog } from "../src/lib/changelog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..", "..");
const srcPath = path.join(repoRoot, "CHANGELOG.md");
const outDir = path.join(__dirname, "..", "src", "data");
const outPath = path.join(outDir, "changelog.json");
const packagePath = path.join(__dirname, "..", "package.json");

if (!fs.existsSync(srcPath)) {
  console.error(`[build-changelog] source not found: ${srcPath}`);
  process.exit(1);
}

const md = fs.readFileSync(srcPath, "utf-8");
const releases = parseChangelog(md);
const packageVersion = JSON.parse(
  fs.readFileSync(packagePath, "utf-8"),
).version;
const documentedVersion = latestCliVersion(releases);

// Never publish a package whose offline `cc changelog` data predates the
// package itself. This was previously silent: 0.162.176 shipped while the
// newest bundled record still said 0.162.170.
if (documentedVersion !== packageVersion) {
  console.error(
    `[build-changelog] latest documented CLI version is ${documentedVersion || "missing"}, package version is ${packageVersion}`,
  );
  process.exit(1);
}

// Deterministic output: no timestamp (would churn the committed file on every
// regen), and formatted THROUGH Prettier so the bytes match exactly what the
// pre-commit hook would produce — regenerating only changes the file when
// CHANGELOG's CLI content actually changed (cf. the web-panel content-hash
// artifact). This keeps a committed build artifact from drifting the index.
const pretty = await format(
  JSON.stringify({ source: "CHANGELOG.md", releases }),
  {
    parser: "json",
  },
);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, pretty, "utf-8");

console.log(
  `[build-changelog] wrote ${releases.length} CLI releases → ${path.relative(repoRoot, outPath)}`,
);
