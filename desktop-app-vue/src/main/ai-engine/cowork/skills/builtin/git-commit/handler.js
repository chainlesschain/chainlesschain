/**
 * Git Commit Skill Handler
 *
 * Analyzes staged changes and generates semantic commit messages.
 * Supports --dry-run, --scope, --type overrides, and conventional
 * commit format (feat, fix, docs, style, refactor, test, chore, perf).
 */

const { execSync } = require("child_process");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Commit type detection ──────────────────────────────────────────

const TYPE_HINTS = [
  { type: "feat", patterns: [/^A\s/, /new file/i, /added/i] },
  { type: "fix", patterns: [/fix/i, /bug/i, /patch/i, /resolve/i] },
  { type: "docs", patterns: [/\.md$/i, /readme/i, /changelog/i, /doc/i] },
  { type: "test", patterns: [/\.test\.|\.spec\.|__tests__/i] },
  { type: "style", patterns: [/\.css$|\.scss$|\.less$/i, /format|lint/i] },
  { type: "refactor", patterns: [/refactor|rename|restructure|move/i] },
  {
    type: "chore",
    patterns: [/package\.json|\.config\.|\.gitignore|\.eslint/i],
  },
  { type: "perf", patterns: [/perf|optim|cache|speed/i] },
];

function git(cmd, cwd) {
  try {
    return execSync("git " + cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
  } catch (err) {
    return err.stdout?.trim() || "";
  }
}

function detectType(diff, files) {
  const combined = diff + "\n" + files.join("\n");
  for (const { type, patterns } of TYPE_HINTS) {
    for (const p of patterns) {
      if (p.test(combined)) {
        return type;
      }
    }
  }
  return "chore";
}

function detectScope(files) {
  // Find common top-level directory
  const dirs = files
    .map((f) => f.split(/[/\\]/))
    .filter((p) => p.length > 1)
    .map((p) => p[p.length >= 3 ? p.length - 2 : 0]);
  if (dirs.length === 0) {
    return null;
  }
  const counts = {};
  for (const d of dirs) {
    counts[d] = (counts[d] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

function summarizeChanges(diff) {
  const lines = diff.split("\n");
  const added = lines.filter(
    (l) => l.startsWith("+") && !l.startsWith("+++"),
  ).length;
  const removed = lines.filter(
    (l) => l.startsWith("-") && !l.startsWith("---"),
  ).length;

  // Extract meaningful change descriptions from hunk headers
  const hunks = lines
    .filter((l) => l.startsWith("@@"))
    .map((l) => l.replace(/^@@.*@@\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);

  return { added, removed, hunks };
}

// ── Handler ────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[git-commit] handler initialized for "${skill?.name || "git-commit"}"`,
    );
  },

  async execute(task, context, skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();

    const isDryRun = /--dry-run/i.test(input);
    const scopeMatch = input.match(/--scope\s+(\S+)/);
    const typeMatch = input.match(/--type\s+(\S+)/);
    const userScope = scopeMatch ? scopeMatch[1] : null;
    const userType = typeMatch ? typeMatch[1] : null;

    try {
      // 1. Check for staged changes
      const staged = git("diff --cached --name-only", projectRoot);
      if (!staged) {
        // Check for any changes
        const status = git("status --porcelain", projectRoot);
        return {
          success: true,
          result: {
            message: status
              ? "No staged changes. Stage files first with: git add <files>"
              : "Working tree is clean — nothing to commit.",
            stagedFiles: [],
          },
          message:
            "No staged changes found. Use `git add` to stage files first.",
        };
      }

      const files = staged.split("\n").filter(Boolean);

      // 2. Get diff content
      const diff = git("diff --cached --stat", projectRoot);
      const fullDiff = git("diff --cached", projectRoot);
      const { added, removed, hunks } = summarizeChanges(fullDiff);

      // 3. Detect type and scope
      const commitType = userType || detectType(fullDiff, files);
      const scope = userScope || detectScope(files);

      // 4. Build commit message
      const scopePart = scope ? `(${scope})` : "";
      const subject =
        hunks.length > 0
          ? hunks[0].slice(0, 60).toLowerCase()
          : `update ${files.length} file${files.length > 1 ? "s" : ""}`;
      const title = `${commitType}${scopePart}: ${subject}`;

      const body = files.map((f) => `- ${f}`).join("\n");
      const fullMessage = `${title}\n\n${body}`;

      // 5. Summary
      const result = {
        commitType,
        scope: scope || "(none)",
        filesChanged: files.length,
        additions: added,
        deletions: removed,
        suggestedMessage: fullMessage,
        title,
        body,
        files,
        dryRun: isDryRun,
      };

      if (isDryRun) {
        return {
          success: true,
          result,
          message: `[DRY RUN] Suggested commit:\n\n${fullMessage}\n\n+${added}/-${removed} in ${files.length} file(s)`,
        };
      }

      // 6. Commit
      const commitResult = git(
        `commit -m "${title.replace(/"/g, '\\"')}"`,
        projectRoot,
      );

      return {
        success: true,
        result: { ...result, commitOutput: commitResult },
        message: `Committed: ${title} (+${added}/-${removed}, ${files.length} files)`,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `Git commit failed: ${err.message}`,
      };
    }
  },
};
