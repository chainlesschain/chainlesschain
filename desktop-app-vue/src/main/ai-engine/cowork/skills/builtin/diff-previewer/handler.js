/**
 * Diff Previewer Skill Handler
 *
 * Multi-file diff previewer that shows rich diffs before applying AI changes.
 * Supports git staged/unstaged diffs, file comparison, change statistics,
 * and compact summaries optimized for AI context windows.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

// -- Unified Diff Parser -----------------------------------------------

function parseUnifiedDiff(diffText) {
  const files = [];
  if (!diffText || !diffText.trim()) {
    return files;
  }

  const fileChunks = diffText.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split("\n");
    const headerMatch = lines[0].match(/a\/(.+?)\s+b\/(.+)/);
    if (!headerMatch) {
      continue;
    }

    const filePath = headerMatch[2];
    let status = "M";

    // Detect status from diff header lines
    for (const line of lines.slice(0, 6)) {
      if (line.startsWith("new file")) {
        status = "A";
        break;
      }
      if (line.startsWith("deleted file")) {
        status = "D";
        break;
      }
      if (line.startsWith("rename from")) {
        status = "R";
        break;
      }
    }

    const hunks = [];
    let currentHunk = null;
    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
      const hunkMatch = line.match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
      );
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldCount: parseInt(hunkMatch[2] || "1", 10),
          newStart: parseInt(hunkMatch[3], 10),
          newCount: parseInt(hunkMatch[4] || "1", 10),
          lines: [],
        };
        continue;
      }

      if (currentHunk) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          currentHunk.lines.push(line);
          additions++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          currentHunk.lines.push(line);
          deletions++;
        } else if (line.startsWith(" ") || line === "") {
          currentHunk.lines.push(line);
        }
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    files.push({ path: filePath, status, hunks, additions, deletions });
  }

  return files;
}

// -- Token Estimation --------------------------------------------------

function estimateTokens(text) {
  if (!text) {
    return 0;
  }
  // Rough estimate: ~4 chars per token for English, ~2 chars for CJK
  const cjkCount = (
    text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []
  ).length;
  const nonCjkLength = text.length - cjkCount;
  return Math.ceil(nonCjkLength / 4 + cjkCount / 2);
}

// -- Git Helpers -------------------------------------------------------

function runGit(args, cwd) {
  try {
    return execSync("git " + args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    if (err.stderr && err.stderr.includes("not a git repository")) {
      throw new Error(
        "Not a git repository. Git operations require a git-initialized project.",
      );
    }
    // git diff returns exit code 1 when there are changes in some cases
    if (err.stdout !== undefined) {
      return err.stdout || "";
    }
    throw new Error(`git ${args} failed: ${err.message}`);
  }
}

// -- Change Map Visualization ------------------------------------------

function generateChangeMap(files) {
  if (files.length === 0) {
    return "No changes.";
  }

  const maxChanges = Math.max(
    ...files.map((f) => f.additions + f.deletions),
    1,
  );
  const barWidth = 10;
  const lines = [];

  // Group by directory
  const dirs = {};
  for (const f of files) {
    const dir = path.dirname(f.path) || ".";
    if (!dirs[dir]) {
      dirs[dir] = [];
    }
    dirs[dir].push(f);
  }

  for (const [dir, dirFiles] of Object.entries(dirs).sort()) {
    lines.push(`${dir}/`);
    for (const f of dirFiles) {
      const name = path.basename(f.path);
      const total = f.additions + f.deletions;
      const filled = Math.max(1, Math.round((total / maxChanges) * barWidth));
      const bar = "\u2588".repeat(filled) + "\u2591".repeat(barWidth - filled);
      const pad = Math.max(0, 20 - name.length);
      lines.push(
        `  ${name}${" ".repeat(pad)} ${bar} +${f.additions} -${f.deletions}`,
      );
    }
  }

  return lines.join("\n");
}

// -- Directory Breakdown -----------------------------------------------

function directoryBreakdown(files) {
  const dirs = {};
  for (const f of files) {
    const dir = path.dirname(f.path) || ".";
    if (!dirs[dir]) {
      dirs[dir] = { files: 0, additions: 0, deletions: 0 };
    }
    dirs[dir].files++;
    dirs[dir].additions += f.additions;
    dirs[dir].deletions += f.deletions;
  }
  return dirs;
}

// -- Mode: --staged / --unstaged ---------------------------------------

function modeGitDiff(projectRoot, staged) {
  const gitArgs = staged ? "diff --cached" : "diff";
  const diffText = runGit(gitArgs, projectRoot);
  const files = parseUnifiedDiff(diffText);

  if (files.length === 0) {
    return {
      success: true,
      result: {
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        tokenEstimate: 0,
      },
      message: staged ? "No staged changes." : "No unstaged changes.",
    };
  }

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
  const tokenEstimate = estimateTokens(diffText);
  const changeMap = generateChangeMap(files);

  const label = staged ? "Staged" : "Unstaged";
  let message = `### ${label} Changes\n\n`;
  message += `**${files.length} file(s)** | **+${totalAdditions}** additions | **-${totalDeletions}** deletions | ~${tokenEstimate} tokens\n\n`;
  message += "```\n" + changeMap + "\n```\n\n";

  for (const f of files) {
    const statusLabel =
      { A: "Added", M: "Modified", D: "Deleted", R: "Renamed" }[f.status] ||
      f.status;
    message += `#### ${f.path} (${statusLabel}: +${f.additions} -${f.deletions})\n`;
  }

  return {
    success: true,
    result: { files, totalAdditions, totalDeletions, tokenEstimate },
    message,
  };
}

// -- Mode: --compare ---------------------------------------------------

function modeCompare(projectRoot, file1, file2) {
  if (!file1 || !file2) {
    return {
      success: false,
      error: "Two file paths required",
      message: "Usage: /diff-previewer --compare <file1> <file2>",
    };
  }

  const abs1 = path.isAbsolute(file1)
    ? file1
    : path.resolve(projectRoot, file1);
  const abs2 = path.isAbsolute(file2)
    ? file2
    : path.resolve(projectRoot, file2);

  if (!fs.existsSync(abs1)) {
    return {
      success: false,
      error: `File not found: ${file1}`,
      message: `File not found: ${abs1}`,
    };
  }
  if (!fs.existsSync(abs2)) {
    return {
      success: false,
      error: `File not found: ${file2}`,
      message: `File not found: ${abs2}`,
    };
  }

  // Use git diff --no-index for file comparison (works outside git repos too)
  let diffText = "";
  try {
    diffText = execSync(
      'git diff --no-index -- "' + abs1 + '" "' + abs2 + '"',
      {
        cwd: projectRoot,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      },
    );
  } catch (err) {
    // git diff --no-index returns exit code 1 when files differ (not an error)
    if (err.stdout) {
      diffText = err.stdout;
    } else if (err.status === 1 && err.output) {
      diffText = err.output.filter(Boolean).join("");
    }
  }

  if (!diffText || !diffText.trim()) {
    return {
      success: true,
      result: {
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        tokenEstimate: 0,
      },
      message: "Files are identical.",
    };
  }

  const files = parseUnifiedDiff(diffText);
  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
  const tokenEstimate = estimateTokens(diffText);

  let message = `### Comparison: ${file1} vs ${file2}\n\n`;
  message += `**+${totalAdditions}** additions | **-${totalDeletions}** deletions | ~${tokenEstimate} tokens\n`;

  return {
    success: true,
    result: { files, totalAdditions, totalDeletions, tokenEstimate },
    message,
  };
}

// -- Mode: --stats -----------------------------------------------------

function modeStats(projectRoot) {
  const stagedFull = runGit("diff --cached", projectRoot);
  const unstagedFull = runGit("diff", projectRoot);

  const stagedFiles = parseUnifiedDiff(stagedFull);
  const unstagedFiles = parseUnifiedDiff(unstagedFull);
  const allFiles = [...stagedFiles, ...unstagedFiles];

  // Deduplicate by path (prefer staged)
  const seen = new Set();
  const unique = [];
  for (const f of allFiles) {
    if (!seen.has(f.path)) {
      seen.add(f.path);
      unique.push(f);
    }
  }

  const totalAdditions = unique.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = unique.reduce((s, f) => s + f.deletions, 0);
  const dirs = directoryBreakdown(unique);
  const changeMap = generateChangeMap(unique);

  let message = `### Change Statistics\n\n`;
  message += `**${unique.length} file(s)** | **+${totalAdditions}** additions | **-${totalDeletions}** deletions\n`;
  message += `Staged: ${stagedFiles.length} file(s) | Unstaged: ${unstagedFiles.length} file(s)\n\n`;
  message += "#### Change Map\n\n```\n" + changeMap + "\n```\n\n";
  message += "#### Directory Breakdown\n\n";
  message +=
    "| Directory | Files | Additions | Deletions |\n| --- | --- | --- | --- |\n";

  for (const [dir, info] of Object.entries(dirs).sort()) {
    message += `| ${dir}/ | ${info.files} | +${info.additions} | -${info.deletions} |\n`;
  }

  return {
    success: true,
    result: {
      files: unique,
      totalAdditions,
      totalDeletions,
      tokenEstimate: estimateTokens(stagedFull + unstagedFull),
      staged: stagedFiles.length,
      unstaged: unstagedFiles.length,
      directories: dirs,
    },
    message,
  };
}

// -- Mode: --summary ---------------------------------------------------

function modeSummary(projectRoot) {
  const stagedFull = runGit("diff --cached", projectRoot);
  const unstagedFull = runGit("diff", projectRoot);

  const stagedFiles = parseUnifiedDiff(stagedFull);
  const unstagedFiles = parseUnifiedDiff(unstagedFull);

  // Merge, deduplicate
  const seen = new Set();
  const unique = [];
  for (const f of [...stagedFiles, ...unstagedFiles]) {
    if (!seen.has(f.path)) {
      seen.add(f.path);
      unique.push(f);
    }
  }

  if (unique.length === 0) {
    return {
      success: true,
      result: {
        files: [],
        totalAdditions: 0,
        totalDeletions: 0,
        tokenEstimate: 0,
      },
      message: "No changes to summarize.",
    };
  }

  const totalAdditions = unique.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = unique.reduce((s, f) => s + f.deletions, 0);

  // Compact format: one line per file, no hunk details
  const compact = unique.map((f) => {
    const statusLabel =
      { A: "ADD", M: "MOD", D: "DEL", R: "REN" }[f.status] || f.status;
    return `[${statusLabel}] ${f.path} (+${f.additions}/-${f.deletions})`;
  });

  const tokenEstimate = estimateTokens(compact.join("\n"));

  let message = `Changes: ${unique.length} files, +${totalAdditions}/-${totalDeletions} (~${tokenEstimate} tokens)\n`;
  message += compact.join("\n");

  return {
    success: true,
    result: {
      files: unique.map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
      totalAdditions,
      totalDeletions,
      tokenEstimate,
    },
    message,
  };
}

// -- Handler Entry Point -----------------------------------------------

module.exports = {
  async init(skill) {
    logger.info(
      `[diff-previewer] Handler initialized for "${skill?.name || "diff-previewer"}"`,
    );
  },

  async execute(task, context, _skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();

    const parts = input.split(/\s+/);
    const mode = parts[0] || "--unstaged";
    const arg1 = parts[1] || "";
    const arg2 = parts[2] || "";

    try {
      switch (mode) {
        case "--staged":
          return modeGitDiff(projectRoot, true);

        case "--unstaged":
          return modeGitDiff(projectRoot, false);

        case "--compare":
          return modeCompare(projectRoot, arg1, arg2);

        case "--stats":
          return modeStats(projectRoot);

        case "--summary":
          return modeSummary(projectRoot);

        default:
          // Default to unstaged diff if mode is unrecognized
          if (!mode.startsWith("--")) {
            return modeGitDiff(projectRoot, false);
          }
          return {
            success: false,
            error: `Unknown mode: ${mode}`,
            message:
              "Available modes: --staged, --unstaged, --compare <file1> <file2>, --stats, --summary",
          };
      }
    } catch (err) {
      logger.error(`[diff-previewer] Error: ${err.message}`);
      return {
        success: false,
        error: err.message,
        message: `Diff previewer failed: ${err.message}`,
      };
    }
  },
};
