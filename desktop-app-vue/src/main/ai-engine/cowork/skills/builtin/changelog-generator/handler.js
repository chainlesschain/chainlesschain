/**
 * Changelog Generator Skill Handler
 *
 * Generates categorized Markdown changelogs from git commit history.
 * Modes: --generate, --since, --unreleased, --format
 */

const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

// ── Conventional commit categories ──────────────────────────────────

const COMMIT_TYPES = {
  feat: { title: "Features", emoji: "✨", order: 1 },
  fix: { title: "Bug Fixes", emoji: "🐛", order: 2 },
  perf: { title: "Performance", emoji: "⚡", order: 3 },
  refactor: { title: "Refactoring", emoji: "♻️", order: 4 },
  docs: { title: "Documentation", emoji: "📝", order: 5 },
  test: { title: "Tests", emoji: "✅", order: 6 },
  style: { title: "Styles", emoji: "💄", order: 7 },
  chore: { title: "Chores", emoji: "🔧", order: 8 },
  ci: { title: "CI/CD", emoji: "👷", order: 9 },
  build: { title: "Build", emoji: "📦", order: 10 },
  revert: { title: "Reverts", emoji: "⏪", order: 11 },
};

// ── Git helpers ─────────────────────────────────────────────────────

function git(cmd, cwd) {
  try {
    return execSync("git " + cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 15000,
    }).trim();
  } catch (_e) {
    return "";
  }
}

function getLatestTag(cwd) {
  return git("describe --tags --abbrev=0 2>/dev/null", cwd) || null;
}

function getCommitsSince(since, cwd) {
  const range = since ? since + "..HEAD" : "HEAD";
  const format = "--pretty=format:%H|%s|%an|%ai|%b---END---";
  const raw = git("log " + range + " " + format, cwd);
  if (!raw) {
    return [];
  }

  return raw
    .split("---END---")
    .filter(Boolean)
    .map((entry) => {
      const lines = entry.trim().split("|");
      if (lines.length < 4) {
        return null;
      }
      const hash = lines[0].trim();
      const subject = lines[1]?.trim() || "";
      const author = lines[2]?.trim() || "";
      const date = lines[3]?.trim().split("T")[0] || "";
      const body = lines.slice(4).join("|").trim();

      // Parse conventional commit
      const ccMatch = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
      const type = ccMatch ? ccMatch[1].toLowerCase() : "other";
      const scope = ccMatch ? ccMatch[2] || "" : "";
      const breaking = ccMatch
        ? !!ccMatch[3] || /BREAKING\s+CHANGE/i.test(body)
        : false;
      const message = ccMatch ? ccMatch[4] : subject;

      return {
        hash: hash.substring(0, 8),
        type,
        scope,
        message,
        author,
        date,
        breaking,
        body,
      };
    })
    .filter(Boolean);
}

function getAllTags(cwd) {
  const raw = git("tag --sort=-creatordate", cwd);
  return raw ? raw.split("\n").filter(Boolean) : [];
}

// ── Changelog generation ────────────────────────────────────────────

function categorizeCommits(commits) {
  const categories = {};
  const breakingChanges = [];

  for (const commit of commits) {
    const type = COMMIT_TYPES[commit.type] ? commit.type : "other";
    if (!categories[type]) {
      categories[type] = [];
    }
    categories[type].push(commit);
    if (commit.breaking) {
      breakingChanges.push(commit);
    }
  }

  return { categories, breakingChanges };
}

function generateMarkdown(title, commits, includeBreaking) {
  const { categories, breakingChanges } = categorizeCommits(commits);
  let md = "";

  if (title) {
    md += "## " + title + "\n\n";
  }

  // Breaking changes first
  if (includeBreaking !== false && breakingChanges.length > 0) {
    md += "### ⚠ Breaking Changes\n\n";
    for (const c of breakingChanges) {
      md +=
        "- " +
        (c.scope ? "**" + c.scope + "**: " : "") +
        c.message +
        " (" +
        c.hash +
        ")\n";
    }
    md += "\n";
  }

  // Categories sorted by order
  const sortedTypes = Object.keys(categories)
    .filter((t) => COMMIT_TYPES[t])
    .sort(
      (a, b) => (COMMIT_TYPES[a]?.order || 99) - (COMMIT_TYPES[b]?.order || 99),
    );

  for (const type of sortedTypes) {
    const info = COMMIT_TYPES[type];
    const items = categories[type];
    if (!items || items.length === 0) {
      continue;
    }

    md += "### " + info.title + "\n\n";
    for (const c of items) {
      md += "- " + (c.scope ? "**" + c.scope + "**: " : "") + c.message;
      md += " (" + c.hash + ")\n";
    }
    md += "\n";
  }

  // Uncategorized
  if (categories.other && categories.other.length > 0) {
    md += "### Other Changes\n\n";
    for (const c of categories.other) {
      md += "- " + c.message + " (" + c.hash + ")\n";
    }
    md += "\n";
  }

  return md;
}

function generateJson(title, commits) {
  const { categories, breakingChanges } = categorizeCommits(commits);
  return {
    title,
    date: new Date().toISOString().split("T")[0],
    totalCommits: commits.length,
    breakingChanges: breakingChanges.map((c) => ({
      message: c.message,
      scope: c.scope,
      hash: c.hash,
    })),
    categories: Object.fromEntries(
      Object.entries(categories).map(([type, items]) => [
        type,
        items.map((c) => ({
          message: c.message,
          scope: c.scope,
          hash: c.hash,
          author: c.author,
        })),
      ]),
    ),
  };
}

function computeStats(commits) {
  const stats = {
    total: commits.length,
    byType: {},
    byAuthor: {},
    breaking: 0,
    dateRange: { from: "", to: "" },
  };
  for (const c of commits) {
    stats.byType[c.type] = (stats.byType[c.type] || 0) + 1;
    stats.byAuthor[c.author] = (stats.byAuthor[c.author] || 0) + 1;
    if (c.breaking) {
      stats.breaking++;
    }
  }
  if (commits.length > 0) {
    stats.dateRange.from = commits[commits.length - 1].date;
    stats.dateRange.to = commits[0].date;
  }
  return stats;
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[changelog-generator] init: " + (_skill?.name || "changelog-generator"),
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    const sinceMatch = input.match(/--since\s+(\S+)/i);
    const formatMatch = input.match(/--format\s+(\S+)/i);
    const isUnreleased = /--unreleased/i.test(input);
    const isGenerate =
      /--generate/i.test(input) || (!sinceMatch && !isUnreleased && !input);

    const outputFormat = formatMatch ? formatMatch[1].toLowerCase() : "md";

    try {
      // Verify git repo
      const isGit = git("rev-parse --is-inside-work-tree", projectRoot);
      if (isGit !== "true") {
        return {
          success: false,
          error: "Not a git repository",
          message: "Not a git repository: " + projectRoot,
        };
      }

      let since = null;
      let title = "Changelog";

      if (sinceMatch) {
        since = sinceMatch[1];
        title = "Changelog since " + since;
      } else if (isUnreleased || isGenerate) {
        since = getLatestTag(projectRoot);
        if (since) {
          title = "Unreleased (since " + since + ")";
        } else {
          title = "All Changes";
        }
      }

      const commits = getCommitsSince(since, projectRoot);
      if (commits.length === 0) {
        return {
          success: true,
          result: { changelog: "", stats: { total: 0 }, commits: [] },
          message: "No commits found" + (since ? " since " + since : "") + ".",
        };
      }

      const stats = computeStats(commits);

      if (outputFormat === "json") {
        const json = generateJson(title, commits);
        return {
          success: true,
          result: {
            changelog: JSON.stringify(json, null, 2),
            stats,
            commits: commits.slice(0, 100),
          },
          message: "Generated JSON changelog: " + commits.length + " commits",
        };
      }

      // Markdown output
      const changelog = generateMarkdown(title, commits);
      let msg = "Changelog Generated\n" + "=".repeat(30) + "\n";
      msg +=
        "Commits: " + stats.total + " | Breaking: " + stats.breaking + "\n";
      msg +=
        "Date range: " +
        stats.dateRange.from +
        " → " +
        stats.dateRange.to +
        "\n";
      msg +=
        "Types: " +
        Object.entries(stats.byType)
          .map(([t, c]) => t + "=" + c)
          .join(", ") +
        "\n\n";
      msg += changelog;

      return {
        success: true,
        result: { changelog, stats, commits: commits.slice(0, 100) },
        message: msg,
      };
    } catch (err) {
      logger.error("[changelog-generator] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Changelog generation failed: " + err.message,
      };
    }
  },
};
