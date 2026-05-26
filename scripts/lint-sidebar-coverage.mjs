#!/usr/bin/env node
/**
 * Lint: design-doc sidebar coverage gap.
 *
 * Failure mode: a new design doc lands in `docs/design/` but nobody adds it
 * to `docs-site/docs/.vitepress/config.js` (or `docs-site-design/`'s config).
 * Sync still publishes the .md, but it has no sidebar entry → users can only
 * reach it by URL, doc effectively invisible. Sidebar is JS so the sync
 * script doesn't touch it.
 *
 * Rule: every source file under `docs/design/**` (excluding README, the
 * filename-map JSON, modules/.. depth >1) must appear in at least one of:
 *   - docs-site/docs/.vitepress/config.js sidebar
 *   - docs-site-design/docs/.vitepress/config.js sidebar
 *
 * The check resolves the source filename through `_filename-map.json` to the
 * site-specific ASCII slug before grepping the config.
 *
 * Advisory only — does not block merge. Run via
 * `node scripts/lint-sidebar-coverage.mjs` locally or via the
 * `Sidebar Coverage Audit` PR workflow.
 *
 * See:
 *   六、文档结构隐患 #4 (sidebar 缺条目)
 *   memory pdh_partial_index_if_not_exists_drift.md sibling pattern
 */
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, basename } from "path";

const ROOT = resolve(process.cwd());
const SOURCE_DIR = resolve(ROOT, "docs/design");
const SHARED_MAP_PATH = resolve(SOURCE_DIR, "_filename-map.json");

const SITES = [
  {
    key: "docs-site",
    config: resolve(ROOT, "docs-site/docs/.vitepress/config.js"),
    linkPrefix: "/design/",
  },
  {
    key: "docs-site-design",
    config: resolve(ROOT, "docs-site-design/docs/.vitepress/config.js"),
    linkPrefix: "/",
  },
];

// Source files exempt from sidebar coverage (templates, indexes, etc).
const EXEMPT_SOURCE = new Set([
  "README.md",
  "_filename-map.json",
]);

// ── load filename map ──
if (!existsSync(SHARED_MAP_PATH)) {
  console.error(`Missing ${SHARED_MAP_PATH} — sync infrastructure broken`);
  process.exit(2);
}
const sharedMap = JSON.parse(readFileSync(SHARED_MAP_PATH, "utf-8"));

function resolveForSite(value, siteKey) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return value[siteKey] ?? null;
}

function targetFor(filename, isModule, siteKey) {
  const section = isModule ? sharedMap.modules : sharedMap.root;
  const mapped = resolveForSite(section[filename], siteKey);
  if (mapped) return mapped;
  // ASCII fall-through (matches sync script behavior)
  if (/^[\x20-\x7e]+$/.test(filename)) return filename;
  return null;
}

// ── walk source ──
function walk(dir, isModuleDir = false) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (EXEMPT_SOURCE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const childIsModule = entry === "modules";
      out.push(...walk(full, childIsModule));
    } else if (entry.endsWith(".md")) {
      out.push({ filename: entry, isModule: isModuleDir });
    }
  }
  return out;
}

const sources = walk(SOURCE_DIR);

// ── load configs ──
const configs = {};
for (const site of SITES) {
  if (!existsSync(site.config)) {
    console.error(`Missing config: ${site.config} (skipping ${site.key})`);
    configs[site.key] = "";
    continue;
  }
  configs[site.key] = readFileSync(site.config, "utf-8");
}

// ── check coverage ──
const missing = []; // { src, perSite: { siteKey: bool } }
for (const { filename, isModule } of sources) {
  const perSite = {};
  let anyPresent = false;
  for (const site of SITES) {
    const target = targetFor(filename, isModule, site.key);
    if (!target) {
      perSite[site.key] = "unmapped";
      continue;
    }
    const slug = target.replace(/\.md$/, "");
    // Match link patterns: "/<prefix>/<slug>" or "/<prefix>/modules/<slug>"
    const linkPattern = isModule
      ? `${site.linkPrefix}modules/${slug}`
      : `${site.linkPrefix}${slug}`;
    const hit = configs[site.key].includes(linkPattern);
    perSite[site.key] = hit;
    if (hit) anyPresent = true;
  }
  if (!anyPresent) missing.push({ filename, isModule, perSite });
}

// ── report ──
console.log(`Scanned ${sources.length} source design docs.`);
console.log(`Sites: ${SITES.map((s) => s.key).join(", ")}.`);
console.log("");

if (missing.length === 0) {
  console.log("✅ All source docs have at least one sidebar entry.");
  process.exit(0);
}

console.log(
  `⚠ ${missing.length} source doc(s) have NO sidebar entry on either site:`,
);
console.log("");
for (const { filename, isModule, perSite } of missing) {
  const where = isModule ? "modules/" : "";
  console.log(`  ${where}${filename}`);
  for (const site of SITES) {
    const status = perSite[site.key];
    const symbol =
      status === true
        ? "✓ in sidebar"
        : status === false
          ? "✗ missing"
          : "(unmapped)";
    console.log(`     ${site.key.padEnd(20)} ${symbol}`);
  }
}
console.log("");
console.log("Add entries to:");
console.log("  - docs-site/docs/.vitepress/config.js");
console.log("  - docs-site-design/docs/.vitepress/config.js");
console.log("");
console.log("(Advisory only — exit code 0; CI uses --strict to fail on missing.)");

// Allow strict mode via flag for CI hard gate later
if (process.argv.includes("--strict")) {
  process.exit(1);
}
