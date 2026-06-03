/**
 * Commit Splitter Skill Handler
 *
 * Analyzes uncommitted changes and groups them into atomic, semantic
 * commit groups. Supports --analyze, --suggest, and --dry-run modes.
 * Groups files by directory proximity, file type, and semantic
 * relationships (test files with source, config together, docs together).
 */

const { execSync } = require("child_process");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Commit type patterns ────────────────────────────────────────────

const TYPE_PATTERNS = [
  { type: "test", pattern: /\.test\.|\.spec\.|__tests__/i },
  { type: "docs", pattern: /\.md$|\.txt$|\.rst$|docs[/\\]/i },
  { type: "style", pattern: /\.css$|\.scss$|\.less$|\.styl$/i },
  {
    type: "chore",
    pattern:
      /package\.json$|package-lock\.json$|yarn\.lock$|\.config\.|\.eslint|\.prettier|\.gitignore|\.env\.example/i,
  },
  { type: "perf", pattern: /perf|optim|cache|benchmark/i },
  {
    type: "ci",
    pattern:
      /\.github[/\\]|\.gitlab|Jenkinsfile|Dockerfile|docker-compose|\.yml$/i,
  },
];

// ── Helpers ─────────────────────────────────────────────────────────

function git(cmd, cwd) {
  try {
    return execSync("git " + cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 15000,
    }).trim();
  } catch (err) {
    return err.stdout?.trim() || "";
  }
}

function detectFileType(filePath) {
  for (const { type, pattern } of TYPE_PATTERNS) {
    if (pattern.test(filePath)) {
      return type;
    }
  }
  return "feat";
}

function getDirectory(filePath) {
  const dir = path.dirname(filePath);
  return dir === "." ? "(root)" : dir;
}

function inferScope(files) {
  if (files.length === 0) {
    return null;
  }
  const dirs = files
    .map((f) => {
      const parts = f.split(/[/\\]/).filter(Boolean);
      return parts.length >= 3 ? parts[parts.length - 2] : parts[0] || null;
    })
    .filter(Boolean);
  if (dirs.length === 0) {
    return null;
  }
  const counts = {};
  for (const d of dirs) {
    counts[d] = (counts[d] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0] ? sorted[0][0] : null;
}

function findTestSourcePair(filePath, allFiles) {
  const base = path.basename(filePath);
  const testMatch = base.match(/^(.+)\.(test|spec)\.(js|ts|jsx|tsx|vue)$/i);
  if (testMatch) {
    const sourceName = testMatch[1] + "." + testMatch[3];
    return allFiles.find(
      (f) => path.basename(f) === sourceName && f !== filePath,
    );
  }
  const ext = path.extname(base);
  const nameNoExt = path.basename(base, ext);
  const testNames = [nameNoExt + ".test" + ext, nameNoExt + ".spec" + ext];
  return allFiles.find(
    (f) => testNames.includes(path.basename(f)) && f !== filePath,
  );
}

function groupFiles(files) {
  const groups = [];
  const assigned = new Set();

  // Pass 1: Group test files with their source files
  for (const file of files) {
    if (assigned.has(file)) {
      continue;
    }
    const pair = findTestSourcePair(file, files);
    if (pair && !assigned.has(pair)) {
      const sourceFile = /\.(test|spec)\./.test(file) ? pair : file;
      const testFile = sourceFile === file ? pair : file;
      assigned.add(file);
      assigned.add(pair);
      groups.push({
        files: [sourceFile, testFile],
        type: detectFileType(sourceFile),
        scope: inferScope([sourceFile]),
        reason: "test-source pair",
      });
    }
  }

  // Pass 2: Group by category (docs, chore, ci, style)
  const categoryBuckets = {};
  for (const file of files) {
    if (assigned.has(file)) {
      continue;
    }
    const type = detectFileType(file);
    if (["docs", "chore", "ci", "style"].includes(type)) {
      if (!categoryBuckets[type]) {
        categoryBuckets[type] = [];
      }
      categoryBuckets[type].push(file);
      assigned.add(file);
    }
  }
  for (const [type, bucketFiles] of Object.entries(categoryBuckets)) {
    if (bucketFiles.length > 0) {
      groups.push({
        files: bucketFiles,
        type,
        scope: inferScope(bucketFiles),
        reason: type + " category",
      });
    }
  }

  // Pass 3: Group remaining files by directory proximity
  const dirBuckets = {};
  for (const file of files) {
    if (assigned.has(file)) {
      continue;
    }
    const dir = getDirectory(file);
    if (!dirBuckets[dir]) {
      dirBuckets[dir] = [];
    }
    dirBuckets[dir].push(file);
    assigned.add(file);
  }
  for (const [dir, dirFiles] of Object.entries(dirBuckets)) {
    groups.push({
      files: dirFiles,
      type: detectFileType(dirFiles[0]),
      scope: inferScope(dirFiles),
      reason: "directory: " + dir,
    });
  }

  return groups;
}

function generateMessage(group) {
  const { type, scope, files } = group;
  const scopePart = scope ? "(" + scope + ")" : "";
  let subject;
  if (type === "docs") {
    subject = "update documentation";
  } else if (type === "chore") {
    subject = "update configuration and dependencies";
  } else if (type === "ci") {
    subject = "update CI/CD configuration";
  } else if (type === "style") {
    subject = "update styles";
  } else if (type === "test") {
    subject = "add tests for " + (scope || "modules");
  } else {
    const names = files.map((f) => path.basename(f, path.extname(f)));
    subject =
      names.length <= 3
        ? "update " + names.join(", ")
        : "update " +
          names.slice(0, 2).join(", ") +
          " and " +
          (names.length - 2) +
          " more";
  }
  return type + scopePart + ": " + subject;
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      "[commit-splitter] init: " + (skill?.name || "commit-splitter"),
    );
  },

  async execute(task, context, _skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();
    const isAnalyze = /--analyze/i.test(input);
    const isDryRun = /--dry-run/i.test(input);

    try {
      const statusRaw = git("status --porcelain", projectRoot);
      if (!statusRaw) {
        return {
          success: true,
          result: { groups: [], totalFiles: 0, groupCount: 0 },
          message: "Working tree is clean -- nothing to split.",
        };
      }

      const statusLines = statusRaw.split("\n").filter(Boolean);
      const allFiles = statusLines.map((l) => l.substring(3).trim());
      const modifiedFiles = git("diff --name-only", projectRoot)
        .split("\n")
        .filter(Boolean);
      const stagedFiles = git("diff --cached --name-only", projectRoot)
        .split("\n")
        .filter(Boolean);
      const untrackedFiles = statusLines
        .filter((l) => l.startsWith("??"))
        .map((l) => l.substring(3).trim());
      const allUniqueFiles = [...new Set([...allFiles])];

      const groups = groupFiles(allUniqueFiles);
      const enrichedGroups = groups.map((group, idx) => ({
        index: idx + 1,
        files: group.files,
        fileCount: group.files.length,
        type: group.type,
        scope: group.scope || "(none)",
        reason: group.reason,
        suggestedMessage: generateMessage(group),
      }));

      const result = {
        groups: enrichedGroups,
        totalFiles: allUniqueFiles.length,
        groupCount: enrichedGroups.length,
        staged: stagedFiles.length,
        modified: modifiedFiles.length,
        untracked: untrackedFiles.length,
      };

      if (isAnalyze) {
        const summary = enrichedGroups
          .map(
            (g) =>
              "  Group " +
              g.index +
              " [" +
              g.type +
              "]: " +
              g.fileCount +
              " file(s) -- " +
              g.reason,
          )
          .join("\n");
        return {
          success: true,
          result,
          message:
            "Commit Splitter Analysis\nTotal: " +
            allUniqueFiles.length +
            " files, " +
            enrichedGroups.length +
            " groups\n\n" +
            summary,
        };
      }

      if (isDryRun) {
        const preview = enrichedGroups
          .map(
            (g) =>
              "  " + g.suggestedMessage + "\n    Files: " + g.files.join(", "),
          )
          .join("\n\n");
        return {
          success: true,
          result: { ...result, dryRun: true },
          message:
            "[DRY RUN] Would create " +
            enrichedGroups.length +
            " commits:\n\n" +
            preview,
        };
      }

      // --suggest (default)
      const suggestion = enrichedGroups
        .map((g) => {
          const fileList = g.files.map((f) => "    - " + f).join("\n");
          return (
            "Group " + g.index + ": " + g.suggestedMessage + "\n" + fileList
          );
        })
        .join("\n\n");

      return {
        success: true,
        result,
        message:
          "Suggested " +
          enrichedGroups.length +
          " atomic commits for " +
          allUniqueFiles.length +
          " files:\n\n" +
          suggestion,
      };
    } catch (err) {
      logger.error("[commit-splitter] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Commit splitter failed: " + err.message,
      };
    }
  },
};
