import chalk from "chalk";
import { VERSION } from "../constants.js";
import { latestCliVersion, loadChangelog } from "../lib/changelog.js";
import logger from "../lib/logger.js";

/**
 * Render a release's markdown-ish body into readable terminal text.
 * Light-touch: **bold** → bold, `code` → cyan, keep bullets, drop blockquote
 * markers, collapse blank runs.
 */
function renderBody(body, indent = "    ") {
  const out = [];
  let blank = 0;
  for (const raw of body.split("\n")) {
    let line = raw.replace(/^>\s?/, ""); // blockquote marker
    line = line.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
    line = line.replace(/`([^`]+)`/g, (_, t) => chalk.cyan(t));
    if (line.trim() === "") {
      blank++;
      if (blank > 1) continue;
      out.push("");
      continue;
    }
    blank = 0;
    out.push(indent + line);
  }
  return out.join("\n").replace(/\n+$/, "");
}

function renderRelease(rel, { isCurrent }) {
  const lines = [];
  const ver = chalk.bold.green(rel.cliVersion);
  const meta = [
    rel.productVersion ? `product ${rel.productVersion}` : null,
    rel.date || null,
  ]
    .filter(Boolean)
    .join(", ");
  const current = isCurrent ? chalk.yellow("  ← installed") : "";
  lines.push(`${ver}  ${chalk.dim("(" + meta + ")")}${current}`);
  if (rel.title) lines.push("  " + chalk.white(rel.title));
  lines.push("");
  for (const s of rel.sections) {
    if (s.heading) lines.push("  " + chalk.bold.cyan("▸ " + s.heading));
    if (s.body) lines.push(renderBody(s.body, s.heading ? "    " : "  "));
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "");
}

/**
 * Find releases matching a user-supplied version query. Matches the CLI npm
 * version (0.162.150 / v0.162.150) or the product version (v5.0.3.134 / 134).
 */
function matchVersion(releases, query) {
  const q = query.replace(/^v/i, "").trim();
  return releases.filter((r) => {
    const cli = r.cliVersion || "";
    const prod = (r.productVersion || "").replace(/^v/i, "");
    return (
      cli === q ||
      cli.endsWith("." + q) ||
      prod === q ||
      prod.endsWith("." + q) ||
      (r.cliVersions || []).includes(q)
    );
  });
}

export function registerChangelogCommand(program) {
  program
    .command("changelog")
    .alias("whatsnew")
    .description("Show cc CLI version update notes (npm package changelog)")
    .argument(
      "[version]",
      "Show notes for a specific version (e.g. 0.162.150 or v5.0.3.134)",
    )
    .option("--all", "Show the full CLI release history")
    .option("-n, --limit <n>", "Show the N most recent releases", "5")
    .option("--json", "Output as JSON")
    .action((version, options) => {
      const data = loadChangelog();
      const releases = data.releases || [];
      const jsonPayload = (selected) =>
        JSON.stringify(
          {
            ...data,
            installedVersion: VERSION,
            latestDocumentedVersion: latestCliVersion(releases),
            releases: selected,
          },
          null,
          2,
        );

      if (releases.length === 0) {
        if (options.json) {
          logger.log(jsonPayload([]));
        } else {
          logger.warn("No changelog data is bundled with this build.");
        }
        return;
      }

      let selected = releases;
      if (version) {
        selected = matchVersion(releases, version);
        if (selected.length === 0) {
          if (options.json) {
            logger.log(jsonPayload([]));
          } else {
            logger.warn(`No CLI release notes found for "${version}".`);
            logger.info(
              `Available CLI versions: ${releases
                .map((r) => r.cliVersion)
                .join(", ")}`,
            );
          }
          return;
        }
      } else if (!options.all) {
        const limit = Math.max(1, parseInt(options.limit, 10) || 5);
        selected = releases.slice(0, limit);
      }

      if (options.json) {
        logger.log(jsonPayload(selected));
        return;
      }

      logger.newline();
      logger.log(
        chalk.bold(
          `  ChainlessChain CLI — update notes ${chalk.dim(`(installed: ${VERSION})`)}`,
        ),
      );
      logger.log(
        chalk.dim(
          `  Showing ${selected.length} of ${releases.length} documented CLI releases.`,
        ),
      );
      logger.newline();

      for (const rel of selected) {
        logger.log(
          renderRelease(rel, { isCurrent: rel.cliVersion === VERSION }),
        );
        logger.log(chalk.dim("  " + "─".repeat(58)));
      }

      if (!version && !options.all && releases.length > selected.length) {
        logger.newline();
        logger.info(
          `Run ${chalk.cyan("cc changelog --all")} for the full history, or ${chalk.cyan("cc changelog <version>")} for one release.`,
        );
      }
    });
}
