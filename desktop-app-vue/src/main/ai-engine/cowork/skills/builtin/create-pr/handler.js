/**
 * Create PR Skill Handler
 *
 * Generate PR content from git changes: create, draft,
 * template, changelog.
 */

const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

// ── Mode definitions ─────────────────────────────────────────────
const MODES = {
  create: "create",
  draft: "draft",
  template: "template",
  changelog: "changelog",
};

const COMMIT_TYPE_MAP = {
  feat: "Features",
  fix: "Bug Fixes",
  docs: "Documentation",
  style: "Styling",
  refactor: "Refactoring",
  test: "Tests",
  chore: "Chores",
  perf: "Performance",
  ci: "CI/CD",
  build: "Build",
};

// ── Helpers ──────────────────────────────────────────────────────

function parseInput(raw) {
  const input = (raw || "").trim();
  if (!input) {
    return { mode: MODES.create, description: "" };
  }

  const firstWord = input.split(/\s+/)[0].toLowerCase();
  if (MODES[firstWord]) {
    return {
      mode: firstWord,
      description: input.slice(firstWord.length).trim(),
    };
  }
  return { mode: MODES.create, description: input };
}

function runGit(cmd, cwd) {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
  } catch {
    return "";
  }
}

function getGitInfo(cwd) {
  const branch = runGit("rev-parse --abbrev-ref HEAD", cwd);
  const diffStat = runGit(
    "diff --stat HEAD~1 2>/dev/null || diff --stat --cached",
    cwd,
  );
  const log = runGit("log --oneline -10", cwd);
  const status = runGit("status --short", cwd);
  const diffCached = runGit("diff --cached --stat", cwd);

  return { branch, diffStat, log, status, diffCached };
}

function parseCommits(log) {
  if (!log) {
    return [];
  }
  return log.split("\n").map((line) => {
    const match = line.match(/^(\w+)\s+(.+)$/);
    if (!match) {
      return { hash: "", message: line };
    }
    return { hash: match[1], message: match[2] };
  });
}

function classifyCommit(message) {
  const match = message.match(/^(\w+)(?:\(.*?\))?:\s*/);
  if (match && COMMIT_TYPE_MAP[match[1]]) {
    return {
      type: match[1],
      category: COMMIT_TYPE_MAP[match[1]],
      description: message.slice(match[0].length),
    };
  }
  return { type: "other", category: "Other Changes", description: message };
}

function generateCreate(description, context) {
  const cwd = context?.projectRoot || context?.workspaceRoot || process.cwd();
  const git = getGitInfo(cwd);
  const branch = description || git.branch || "feature/unknown";

  const commits = parseCommits(git.log);
  const classified = commits.map((c) => ({
    ...c,
    ...classifyCommit(c.message),
  }));

  // Group by category
  const groups = {};
  for (const c of classified) {
    if (!groups[c.category]) {
      groups[c.category] = [];
    }
    groups[c.category].push(c);
  }

  // Generate title from branch name
  const title = branch
    .replace(/^(feature|fix|bugfix|hotfix|chore|docs)\//, "")
    .replace(/[-_]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

  const lines = [
    `# Pull Request: ${title}`,
    "",
    `**Branch:** \`${branch}\``,
    "",
    "## Title",
    `\`${title}\``,
    "",
    "## Description",
    "",
    "### Summary",
    `This PR implements ${title.toLowerCase()}.`,
    "",
    "### Changes",
  ];

  for (const [category, items] of Object.entries(groups)) {
    lines.push(`\n**${category}:**`);
    for (const item of items.slice(0, 5)) {
      lines.push(`- ${item.description || item.message}`);
    }
  }

  if (git.diffStat) {
    lines.push("");
    lines.push("### Files Changed");
    lines.push("```");
    lines.push(git.diffStat);
    lines.push("```");
  }

  lines.push("");
  lines.push("## Testing");
  lines.push("- [ ] Unit tests pass");
  lines.push("- [ ] Manual testing completed");
  lines.push("- [ ] No regressions found");
  lines.push("");
  lines.push("## Checklist");
  lines.push("- [ ] Code follows project style guidelines");
  lines.push("- [ ] Self-review completed");
  lines.push("- [ ] Documentation updated (if needed)");
  lines.push("- [ ] No sensitive data committed");

  return {
    output: lines.join("\n"),
    data: { method: "create", branch, title, commitCount: commits.length },
  };
}

function generateDraft(description, context) {
  const cwd = context?.projectRoot || context?.workspaceRoot || process.cwd();
  const git = getGitInfo(cwd);

  const lines = [
    `# Draft PR: ${description || "Work in Progress"}`,
    "",
    `**Branch:** \`${git.branch || "current"}\``,
    "**Status:** Draft (not ready for review)",
    "",
    "## What this PR will do",
    `${description || "_(describe the goal)_"}`,
    "",
    "## Current Progress",
    "- [ ] Implementation",
    "- [ ] Tests",
    "- [ ] Documentation",
    "",
    "## Open Questions",
    "- _(list any decisions that need input)_",
    "",
    "## Notes for Reviewers",
    "This is a draft PR. Please do not merge.",
  ];

  if (git.status) {
    lines.push("");
    lines.push("## Current Changes");
    lines.push("```");
    lines.push(git.status);
    lines.push("```");
  }

  return {
    output: lines.join("\n"),
    data: { method: "draft", branch: git.branch, description },
  };
}

function generateTemplate() {
  const lines = [
    "# PR Template",
    "",
    "Copy this template when creating pull requests:",
    "",
    "---",
    "",
    "## Summary",
    "<!-- Brief description of changes -->",
    "",
    "## Type of Change",
    "- [ ] Bug fix",
    "- [ ] New feature",
    "- [ ] Breaking change",
    "- [ ] Documentation update",
    "- [ ] Refactoring",
    "",
    "## Changes Made",
    "<!-- List specific changes -->",
    "- ",
    "",
    "## Testing",
    "<!-- How was this tested? -->",
    "- [ ] Unit tests added/updated",
    "- [ ] Integration tests pass",
    "- [ ] Manual testing completed",
    "",
    "## Screenshots (if applicable)",
    "<!-- Add screenshots for UI changes -->",
    "",
    "## Checklist",
    "- [ ] Code follows project style guidelines",
    "- [ ] Self-review completed",
    "- [ ] Documentation updated",
    "- [ ] No sensitive data committed",
    "- [ ] Linked related issues",
    "",
    "## Related Issues",
    "<!-- Closes #123 -->",
  ];

  return {
    output: lines.join("\n"),
    data: { method: "template" },
  };
}

function generateChangelog(description, context) {
  const cwd = context?.projectRoot || context?.workspaceRoot || process.cwd();

  // Parse range like "v1.1.0..v1.2.0"
  let logCmd = "log --oneline -20";
  if (description && description.includes("..")) {
    logCmd = `log --oneline ${description}`;
  }

  const log = runGit(logCmd, cwd);
  const commits = parseCommits(log);
  const classified = commits.map((c) => ({
    ...c,
    ...classifyCommit(c.message),
  }));

  // Group by category
  const groups = {};
  for (const c of classified) {
    if (!groups[c.category]) {
      groups[c.category] = [];
    }
    groups[c.category].push(c);
  }

  const lines = [`# Changelog`, "", `## ${description || "Unreleased"}`, ""];

  for (const [category, items] of Object.entries(groups)) {
    lines.push(`### ${category}`);
    for (const item of items) {
      lines.push(`- ${item.description || item.message} (\`${item.hash}\`)`);
    }
    lines.push("");
  }

  return {
    output: lines.join("\n"),
    data: {
      method: "changelog",
      commitCount: commits.length,
      categories: Object.keys(groups),
    },
  };
}

// ── Handler ──────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[create-pr] handler initialized for "${skill?.name || "create-pr"}"`,
    );
  },

  async execute(task, context, _skill) {
    const raw = task?.params?.input || task?.input || task?.action || "";
    const { mode, description } = parseInput(raw);

    try {
      let result;
      switch (mode) {
        case MODES.draft:
          if (!description) {
            return {
              success: false,
              output: "Usage: /create-pr draft <description>",
              error: "No description provided",
            };
          }
          result = generateDraft(description, context);
          break;
        case MODES.template:
          result = generateTemplate();
          break;
        case MODES.changelog:
          result = generateChangelog(description, context);
          break;
        default:
          result = generateCreate(description, context);
          break;
      }

      logger.info(`[create-pr] generated ${mode}`);

      return {
        success: true,
        output: result.output,
        result: result.data,
        message: `Generated ${mode} PR content`,
      };
    } catch (err) {
      logger.error("[create-pr] Error:", err.message);
      return {
        success: false,
        output: `Error: ${err.message}`,
        error: err.message,
      };
    }
  },
};
