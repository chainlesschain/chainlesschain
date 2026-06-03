/**
 * Release Manager Skill Handler
 *
 * Calculates semantic version bumps from commit history, generates changelog,
 * previews release changes, and identifies version files to update.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

module.exports = {
  async init(skill) {
    logger.info("[ReleaseManager] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[ReleaseManager] Action: ${action}`, { options });

    try {
      switch (action) {
        case "bump":
          return await handleBump(options.bumpType, options.targetDir);
        case "changelog":
          return await handleChangelog(options.range, options.targetDir);
        case "dry-run":
          return await handleDryRun(options.targetDir);
        case "release-notes":
          return await handleReleaseNotes(options.range, options.targetDir);
        default:
          return await handleDryRun(options.targetDir);
      }
    } catch (error) {
      logger.error(`[ReleaseManager] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Release management failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    targetDir: context.workspacePath || process.cwd(),
    bumpType: "auto",
    range: null,
  };
  let action = "dry-run";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--bump") {
      action = "bump";
      const next = parts[i + 1];
      if (next && ["major", "minor", "patch", "auto"].includes(next)) {
        options.bumpType = parts[++i];
      }
    } else if (p === "--changelog") {
      action = "changelog";
      const next = parts[i + 1];
      if (next && !next.startsWith("-")) {
        options.range = parts[++i];
      }
    } else if (p === "--dry-run") {
      action = "dry-run";
    } else if (p === "--release-notes") {
      action = "release-notes";
      const next = parts[i + 1];
      if (next && !next.startsWith("-")) {
        options.range = parts[++i];
      }
    }
  }

  return { action, options };
}

function runGit(cmd, cwd) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      cwd,
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function getCurrentVersion(targetDir) {
  const pkgPath = path.join(targetDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return pkg.version || "0.0.0";
    } catch {
      /* fall through */
    }
  }
  return "0.0.0";
}

function getLatestTag(targetDir) {
  return runGit("git describe --tags --abbrev=0 2>/dev/null", targetDir);
}

function getCommitsSinceTag(targetDir, tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD~50..HEAD";
  const output = runGit(
    `git log ${range} --pretty=format:"%H|%s|%an|%ad" --date=short`,
    targetDir,
  );
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, author, date] = line.split("|");
      const conventionalMatch = (subject || "").match(
        /^(\w+)(?:\(([^)]*)\))?!?:\s*(.*)/,
      );
      const isBreaking =
        (subject || "").includes("!:") ||
        (subject || "").includes("BREAKING CHANGE");

      return {
        hash: (hash || "").substring(0, 7),
        type: conventionalMatch ? conventionalMatch[1] : "other",
        scope: conventionalMatch ? conventionalMatch[2] : null,
        message: conventionalMatch ? conventionalMatch[3] : subject,
        author,
        date,
        breaking: isBreaking,
      };
    });
}

function calculateBump(commits, requestedType) {
  if (requestedType && requestedType !== "auto") {
    return requestedType;
  }

  const hasBreaking = commits.some((c) => c.breaking);
  const hasFeat = commits.some((c) => c.type === "feat");
  const hasFix = commits.some((c) => c.type === "fix" || c.type === "perf");

  if (hasBreaking) {
    return "major";
  }
  if (hasFeat) {
    return "minor";
  }
  if (hasFix) {
    return "patch";
  }
  return "patch";
}

function bumpVersion(version, type) {
  const parts = version.split(".").map(Number);
  switch (type) {
    case "major":
      return `${parts[0] + 1}.0.0`;
    case "minor":
      return `${parts[0]}.${parts[1] + 1}.0`;
    case "patch":
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    default:
      return version;
  }
}

function findVersionFiles(targetDir) {
  const files = [];
  const candidates = [
    "package.json",
    "desktop-app-vue/package.json",
    "android-app/app/build.gradle.kts",
    "ios-app/ChainlessChain/Resources/Info.plist",
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(targetDir, candidate);
    if (fs.existsSync(fullPath)) {
      files.push(candidate);
    }
  }
  return files;
}

function groupCommits(commits) {
  const groups = {};
  const typeLabels = {
    feat: "Features",
    fix: "Bug Fixes",
    perf: "Performance",
    refactor: "Refactoring",
    docs: "Documentation",
    test: "Tests",
    chore: "Chores",
    style: "Style",
    ci: "CI/CD",
    build: "Build",
  };

  for (const c of commits) {
    const label = typeLabels[c.type] || "Other";
    if (!groups[label]) {
      groups[label] = [];
    }
    groups[label].push(c);
  }

  return groups;
}

async function handleBump(bumpType, targetDir) {
  const currentVersion = getCurrentVersion(targetDir);
  const tag = getLatestTag(targetDir);
  const commits = getCommitsSinceTag(targetDir, tag);
  const bump = calculateBump(commits, bumpType);
  const newVersion = bumpVersion(currentVersion, bump);
  const versionFiles = findVersionFiles(targetDir);

  const report =
    `Release Manager - Version Bump\n${"=".repeat(35)}\n` +
    `Current: v${currentVersion}\n` +
    `Bump: ${bump}\n` +
    `New: v${newVersion}\n` +
    `Commits since ${tag || "start"}: ${commits.length}\n\n` +
    `Files to update:\n` +
    versionFiles.map((f) => `  ✏️ ${f}`).join("\n") +
    `\n\nNote: Preview only. Use file_editor to apply version changes.`;

  return {
    success: true,
    result: {
      currentVersion,
      newVersion,
      bump,
      commits: commits.length,
      versionFiles,
    },
    message: report,
  };
}

async function handleChangelog(range, targetDir) {
  const tag = getLatestTag(targetDir);
  const effectiveRange = range || (tag ? `${tag}..HEAD` : null);
  const commits = getCommitsSinceTag(targetDir, tag);

  if (commits.length === 0) {
    return {
      success: true,
      result: { entries: [] },
      message: "No commits found for changelog.",
    };
  }

  const groups = groupCommits(commits);
  const currentVersion = getCurrentVersion(targetDir);
  const bump = calculateBump(commits, "auto");
  const newVersion = bumpVersion(currentVersion, bump);
  const today = new Date().toISOString().split("T")[0];

  const changelog =
    `## [${newVersion}] - ${today}\n\n` +
    Object.entries(groups)
      .filter(([label]) => label !== "Other" && label !== "Chores")
      .sort(([a], [b]) => {
        const order = [
          "Features",
          "Bug Fixes",
          "Performance",
          "Refactoring",
          "Documentation",
          "Tests",
        ];
        return order.indexOf(a) - order.indexOf(b);
      })
      .map(
        ([label, commits]) =>
          `### ${label}\n\n` +
          commits
            .map(
              (c) =>
                `- ${c.scope ? `**${c.scope}**: ` : ""}${c.message} (${c.hash})`,
            )
            .join("\n"),
      )
      .join("\n\n");

  return {
    success: true,
    result: { groups, version: newVersion, commitCount: commits.length },
    message: `Changelog for v${newVersion}\n${"=".repeat(30)}\n\n${changelog}`,
  };
}

async function handleDryRun(targetDir) {
  const currentVersion = getCurrentVersion(targetDir);
  const tag = getLatestTag(targetDir);
  const commits = getCommitsSinceTag(targetDir, tag);
  const bump = calculateBump(commits, "auto");
  const newVersion = bumpVersion(currentVersion, bump);
  const versionFiles = findVersionFiles(targetDir);
  const groups = groupCommits(commits);

  const commitSummary = Object.entries(groups)
    .map(([label, cs]) => `  ${label}: ${cs.length}`)
    .join("\n");

  const breakingChanges = commits.filter((c) => c.breaking);

  const report =
    `Release Manager - Dry Run\n${"=".repeat(30)}\n` +
    `Current: v${currentVersion}\n` +
    `Latest tag: ${tag || "(none)"}\n` +
    `Commits: ${commits.length}\n` +
    `Recommended bump: ${bump} → v${newVersion}\n\n` +
    `Commit breakdown:\n${commitSummary}\n\n` +
    (breakingChanges.length > 0
      ? `⚠️ Breaking changes:\n${breakingChanges.map((c) => `  - ${c.message}`).join("\n")}\n\n`
      : "") +
    `Version files:\n${versionFiles.map((f) => `  ${f}`).join("\n")}\n\n` +
    `No files modified (dry run).`;

  return {
    success: true,
    result: {
      currentVersion,
      newVersion,
      bump,
      commits: commits.length,
      groups,
      versionFiles,
    },
    message: report,
  };
}

async function handleReleaseNotes(range, targetDir) {
  const tag = getLatestTag(targetDir);
  const commits = getCommitsSinceTag(targetDir, tag);
  const currentVersion = getCurrentVersion(targetDir);
  const bump = calculateBump(commits, "auto");
  const newVersion = bumpVersion(currentVersion, bump);
  const groups = groupCommits(commits);

  const features = groups["Features"] || [];
  const fixes = groups["Bug Fixes"] || [];
  const authors = [...new Set(commits.map((c) => c.author).filter(Boolean))];

  const notes =
    `# Release v${newVersion}\n\n` +
    `## Highlights\n\n` +
    (features.length > 0
      ? features
          .slice(0, 5)
          .map((f) => `- ${f.scope ? `**${f.scope}**: ` : ""}${f.message}`)
          .join("\n")
      : "- Maintenance and bug fixes") +
    `\n\n## What's Changed\n\n` +
    `- ${features.length} new features\n` +
    `- ${fixes.length} bug fixes\n` +
    `- ${commits.length} total commits\n\n` +
    `## Contributors\n\n` +
    authors.map((a) => `- @${a}`).join("\n") +
    `\n\n**Full Changelog**: ${tag || "initial"}...v${newVersion}`;

  return {
    success: true,
    result: {
      version: newVersion,
      features: features.length,
      fixes: fixes.length,
      authors,
    },
    message: notes,
  };
}
