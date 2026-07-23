/**
 * "What's New" — surface the cc CLI's own release notes (`cc changelog
 * --json`, shipped offline with the npm package since 0.162.151) inside the
 * IDE, and nudge once after an upgrade is detected. Pure logic (no `vscode`):
 * extension.js wires the command + toast.
 */

const fs = require("node:fs");
const path = require("node:path");

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
 * Prefer usable CLI output, but let an empty (rather than malformed) JSON
 * result fall back to the artifact bundled in the same installation.
 */
function chooseChangelogReleases(parsed, bundled) {
  if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  if (Array.isArray(bundled) && bundled.length > 0) return bundled;
  return Array.isArray(parsed)
    ? parsed
    : Array.isArray(bundled)
      ? bundled
      : null;
}

function releaseVersions(release) {
  return [
    release?.cliVersion,
    ...(Array.isArray(release?.cliVersions) ? release.cliVersions : []),
  ].filter(Boolean);
}

/**
 * Detect a non-empty but stale changelog. Older published CLI packages can
 * report a newer `cc --version` than any release in their bundled artifact.
 * Never present that data as if it described the installed build.
 */
function reconcileChangelogReleases(releases, { installed } = {}) {
  const list = Array.isArray(releases) ? releases : [];
  const versions = [...new Set(list.flatMap(releaseVersions))];
  if (!installed || versions.includes(installed) || versions.length === 0) {
    return { releases: list, stale: false };
  }
  const { compareVersions } = require("./version-check");
  const latest = versions.reduce((best, version) =>
    compareVersions(version, best) > 0 ? version : best,
  );
  if (compareVersions(installed, latest) <= 0) {
    return { releases: list, stale: false };
  }

  return {
    stale: true,
    releases: [
      {
        productVersion: null,
        cliVersion: installed,
        cliVersions: [installed],
        date: null,
        title: "Installed CLI build — matching release notes were not bundled",
        sections: [
          {
            heading: "Release-note data is out of date",
            body:
              `- Installed CLI: \`${installed}\`\n` +
              `- Newest bundled notes: \`${latest}\`\n\n` +
              "Older bundled notes follow below. Reinstall or upgrade the CLI " +
              "after a corrected package is published.",
          },
        ],
      },
      ...list,
    ],
  };
}

/**
 * Read the changelog artifact shipped inside the installed CLI package.
 *
 * Older Windows installations can have a parent-level `CHANGELOG.md` (the
 * Node.js distribution ships one) that makes `cc changelog --json` return an
 * empty release list. The npm package still contains the authoritative
 * `src/data/changelog.json`, so the IDE can recover without waiting for a CLI
 * upgrade or requiring network access.
 */
function loadBundledChangelog({
  command = "cc",
  env = process.env,
  fsApi = fs,
  pathApi = path,
} = {}) {
  const commandText = typeof command === "string" ? command.trim() : "";
  const pathEntries = String(env?.PATH || "")
    .split(pathApi.delimiter)
    .filter(Boolean);
  const commandCandidates = pathApi.isAbsolute(commandText)
    ? [commandText]
    : [
        commandText,
        ...pathEntries.flatMap((entry) =>
          process.platform === "win32"
            ? [
                pathApi.join(entry, `${commandText}.cmd`),
                pathApi.join(entry, commandText),
              ]
            : [pathApi.join(entry, commandText)],
        ),
      ];
  const packageRoots = [];
  for (const executable of commandCandidates) {
    if (!pathApi.isAbsolute(executable)) continue;
    const dir = pathApi.dirname(executable);
    packageRoots.push(
      pathApi.join(dir, "node_modules", "chainlesschain"),
      pathApi.join(dir, "..", "node_modules", "chainlesschain"),
    );
  }
  for (const root of [...new Set(packageRoots)]) {
    const dataPath = pathApi.join(root, "src", "data", "changelog.json");
    try {
      if (!fsApi.existsSync(dataPath)) continue;
      const data = JSON.parse(fsApi.readFileSync(dataPath, "utf8"));
      if (Array.isArray(data?.releases) && data.releases.length > 0)
        return data.releases;
    } catch {
      // A broken optional fallback must not hide the normal CLI error path.
    }
  }
  return null;
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
  chooseChangelogReleases,
  reconcileChangelogReleases,
  loadBundledChangelog,
  changelogToMarkdown,
  upgradeNudge,
};
