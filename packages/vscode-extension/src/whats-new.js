/**
 * "What's New" — surface the cc CLI's own release notes (`cc changelog
 * --json`, shipped offline with the npm package since 0.162.151) inside the
 * IDE, and nudge once after an upgrade is detected. Pure logic (no `vscode`):
 * extension.js wires the command + toast.
 */

const MIN_CHANGELOG_CLI = "0.162.151"; // first cc with `cc changelog`

/** argv for the CLI call behind the panel. */
function buildChangelogArgs({ limit = 5 } = {}) {
  return ["changelog", "-n", String(limit), "--json"];
}

/** Parse `cc changelog --json` stdout → releases[], or null when unusable
 * (old CLI printing an "unknown command" error, garbage, etc.). */
function parseChangelogJson(text) {
  try {
    const data = JSON.parse(String(text || ""));
    return Array.isArray(data?.releases) ? data.releases : null;
  } catch {
    return null;
  }
}

/**
 * Render releases into the markdown document the IDE shows. The section
 * bodies come straight from the package's own curated changelog, so they are
 * passed through as-is (they already ARE markdown).
 */
function changelogToMarkdown(releases, { installed } = {}) {
  const lines = ["# cc CLI — What's New", ""];
  for (const rel of releases || []) {
    const meta = [
      rel.productVersion ? `product ${rel.productVersion}` : null,
      rel.date || null,
    ]
      .filter(Boolean)
      .join(", ");
    const mark =
      installed && rel.cliVersion === installed ? " ← installed" : "";
    lines.push(`## ${rel.cliVersion}${meta ? ` (${meta})` : ""}${mark}`, "");
    if (rel.title) lines.push(rel.title, "");
    for (const s of rel.sections || []) {
      if (s.heading) lines.push(`### ${s.heading}`, "");
      if (s.body) lines.push(s.body.replace(/^>\s?/gm, ""), "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * One-shot upgrade nudge decision. `prev` is the version remembered from the
 * last activation (null on first run — store silently, no toast: nagging a
 * fresh install with "you upgraded!" is noise). Returns null or the toast
 * payload.
 */
function upgradeNudge(prev, current) {
  if (!current) return null; // cc missing/unparsable — nothing to remember
  if (!prev || prev === current) return null;
  // Only nudge on an actual UPGRADE. A downgrade (npm i -g chainlesschain@older)
  // shouldn't say "updated" and offer notes the installed CLI may not even have
  // (cc changelog needs >= 0.162.151, so the button would then just error).
  const { compareVersions } = require("./version-check");
  if (compareVersions(current, prev) <= 0) return null;
  return {
    message: `cc CLI updated: ${prev} → ${current}`,
    button: "What's New",
  };
}

module.exports = {
  MIN_CHANGELOG_CLI,
  buildChangelogArgs,
  parseChangelogJson,
  changelogToMarkdown,
  upgradeNudge,
};
