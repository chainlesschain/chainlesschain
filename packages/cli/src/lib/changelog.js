import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The `cc changelog` data source.
 *
 * The canonical update record is the repository-root `CHANGELOG.md`, which is
 * organized by PRODUCT version (`## [v5.0.3.x]`). Each block references the CLI
 * npm version (`chainlesschain 0.162.x`) it shipped. This parser distills that
 * into a CLI-focused view: it keeps only blocks that actually reference a CLI
 * npm version, and within each block keeps only the CLI-relevant sub-sections.
 *
 * At publish time `scripts/build-changelog.mjs` runs `parseChangelog` over the
 * root CHANGELOG and writes the result to `src/data/changelog.json`, which is
 * bundled with the npm package. `loadChangelog()` reads that file (with a
 * fallback to parsing a raw CHANGELOG.md for in-repo dev use).
 */

// Signals that a `### ` sub-section HEADING is about the CLI npm package rather
// than the desktop app / Android / iOS / PDH portions of the same product
// release. CASE-SENSITIVE on purpose: real CLI notes write the acronym "CLI"
// (e.g. "cc CLI 0.162.150", "CLI 安全"), whereas PDH/Android bundle-roll notes
// write the version tag lowercase ("(pdh 0.4.6 / cli 0.162.48)"). Matching only
// uppercase "CLI" keeps collector releases that merely bundle a cli bump out of
// the CLI view. Heading-only (not body) for the same reason.
const CLI_HEADING_SIGNAL = /\bCLI\b|命令行/;

// A block with no `### ` sub-sections is a CLI release only if its header or
// preamble uses CLI-publish language. Same case-sensitivity: a lowercase
// bundle-roll "cli 0.162.x" mention is not enough.
const CLI_PUBLISH_SIGNAL = /\bCLI\b|命令行|catch-up/;

// CLI npm versions are 3-segment (0.162.x). The `(?<![\d.])` / `(?!\.\d)` guards
// stop a 4-segment PRODUCT version (v5.0.3.134) from matching as "5.0.3".
const V = "(?<![\\d.])(\\d+\\.\\d+\\.\\d+)(?!\\.\\d)";

/**
 * Extract every CLI npm version token referenced in a block of text and return
 * the "primary" one (the highest semver — the released target in a
 * `0.162.149 → 0.162.150` style note).
 *
 * @param {string} text
 * @returns {{ primary: string|null, all: string[] }}
 */
export function extractCliVersions(text) {
  const found = new Set();
  const patterns = [
    // "cc CLI 0.162.150", "CLI 0.162.150"
    new RegExp(`(?:cc\\s+)?cli\\s+${V}`, "gi"),
    // "chainlesschain` 0.162.149 → **0.162.150**" (capture the arrow target)
    new RegExp(
      `chainlesschain[\`\\s]+(?:\\d+\\.\\d+\\.\\d+\\s*(?:→|->)\\s*)?\\*{0,2}${V}`,
      "gi",
    ),
    // bare "cli 0.162.71" inside "(pdh 0.4.25 / cli 0.162.71)"
    new RegExp(`\\bcli\\s+${V}`, "gi"),
    // "→ 0.162.150" / "→ **0.162.150**"
    new RegExp(`(?:→|->)\\s*\\*{0,2}${V}`, "gi"),
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      found.add(m[1]);
    }
  }
  // The CLI npm package (`chainlesschain`) is on the 0.x alpha track; the
  // product line is 5.x. Keeping only major-0 tokens discards any product
  // version (v5.0.3.x) or desktop-app-vue (5.0.3-alpha.x) tokens that slip past
  // the context regexes, so the "primary" is always a real CLI npm version.
  const all = [...found].filter((v) => v.startsWith("0."));
  const primary =
    all.length === 0
      ? null
      : all.reduce(
          (best, v) => (compareSemver(v, best) > 0 ? v : best),
          all[0],
        );
  return { primary, all };
}

/** Numeric semver compare for plain X.Y.Z (no prerelease). */
export function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/**
 * Parse a raw CHANGELOG.md string into CLI-focused release entries.
 *
 * @param {string} md
 * @returns {Array<{
 *   productVersion: string,
 *   cliVersion: string|null,
 *   cliVersions: string[],
 *   date: string|null,
 *   title: string,
 *   sections: Array<{ heading: string, body: string }>,
 * }>}
 */
export function parseChangelog(md) {
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2 && !line.startsWith("###")) {
      if (current) blocks.push(current);
      current = { header: h2[1].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);

  const releases = [];
  for (const block of blocks) {
    const parsed = parseBlockHeader(block.header);
    const bodyText = block.lines.join("\n");
    const fullText = block.header + "\n" + bodyText;

    const { primary, all } = extractCliVersions(fullText);
    // A release must reference a CLI npm version at all.
    if (!primary) continue;

    // CLI-relevance gate is decided by section HEADINGS (or, for a section-less
    // block, by CLI-publish language) — not by a bare bundled-cli mention.
    const sections = extractCliSections(block.lines, block.header);
    if (!sections) continue;

    releases.push({
      productVersion: parsed.version,
      cliVersion: primary,
      cliVersions: all.sort(compareSemver),
      date: parsed.date,
      title: parsed.title,
      sections,
    });
  }
  return releases;
}

/** Parse "## [v5.0.3.134] - 2026-07-03 — title" into parts. */
function parseBlockHeader(header) {
  const tag = header.match(/\[([^\]]+)\]/);
  const version = tag ? tag[1] : header;
  const rest = header.replace(/\[[^\]]+\]\s*/, "");
  const dateMatch = rest.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : null;
  // Title = text after the em dash separator, else whatever remains.
  let title = "";
  const emDash = rest.split(/\s+—\s+/);
  if (emDash.length > 1) {
    title = emDash.slice(1).join(" — ").trim();
  } else {
    title = rest
      .replace(/^-\s*/, "")
      .replace(/\d{4}-\d{2}-\d{2}/, "")
      .trim();
  }
  return { version, date, title };
}

/**
 * Split a block body into `### ` sub-sections and keep only CLI-relevant ones.
 *
 * Returns:
 *  - an array of CLI sections, when the block is a CLI release; or
 *  - `null`, when the block is NOT a CLI release (all-non-CLI sub-sections, e.g.
 *    a PDH/Android collector release that merely bundles a new cli version).
 *
 * @param {string[]} bodyLines
 * @param {string} header
 * @returns {Array<{heading:string, body:string}>|null}
 */
function extractCliSections(bodyLines, header) {
  const sections = [];
  const preamble = [];
  let cur = null;
  for (const line of bodyLines) {
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      if (cur) sections.push(cur);
      cur = { heading: h3[1].trim(), lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
    else preamble.push(line); // before the first ### (blockquote summary etc.)
  }
  if (cur) sections.push(cur);

  if (sections.length === 0) {
    // Section-less block: CLI release only if the `##` TITLE names the CLI.
    // The preamble is NOT consulted — every block carries a boilerplate
    // "Version surfaces: CLI 0.162.x → ..." line, so a body match would let
    // every PDH/Android release through.
    if (!CLI_PUBLISH_SIGNAL.test(header)) return null;
    const body = preamble.join("\n").trim();
    return body ? [{ heading: "", body }] : [];
  }

  const cliSections = sections
    .filter((s) => CLI_HEADING_SIGNAL.test(s.heading))
    .map((s) => ({ heading: s.heading, body: s.lines.join("\n").trim() }));

  // Has `### ` sections but none are CLI-headed → not a CLI release.
  return cliSections.length > 0 ? cliSections : null;
}

/**
 * Resolve and load the CLI changelog data.
 *
 * Order is CHANGELOG-FIRST so the data can never go stale: when the repo-root
 * CHANGELOG.md is reachable (source checkout / dev / this monorepo) it is parsed
 * live, always reflecting the latest edits. The bundled `src/data/changelog.json`
 * (a build artifact, refreshed at `prepublishOnly`) is only the fallback for an
 * installed npm package, where CHANGELOG.md is not shipped.
 *
 * @returns {{ source: string, releases: Array }}
 */
export function loadChangelog() {
  const changelogCandidates = [
    path.join(__dirname, "..", "..", "CHANGELOG.md"), // packages/cli/CHANGELOG.md
    path.join(__dirname, "..", "..", "..", "..", "CHANGELOG.md"), // repo root
  ];
  for (const p of changelogCandidates) {
    if (fs.existsSync(p)) {
      return {
        source: "CHANGELOG.md",
        releases: parseChangelog(fs.readFileSync(p, "utf-8")),
      };
    }
  }
  // Installed npm package: CHANGELOG.md isn't shipped, use the bundled artifact.
  const jsonPath = path.join(__dirname, "..", "data", "changelog.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      if (Array.isArray(data.releases)) return data;
    } catch {
      /* fall through to empty */
    }
  }
  return { source: null, releases: [] };
}
