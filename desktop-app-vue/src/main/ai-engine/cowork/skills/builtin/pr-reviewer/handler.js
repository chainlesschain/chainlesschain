/**
 * PR Reviewer Skill Handler
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { logger } = require("../../../../../utils/logger.js");
const { execSync } = require("child_process");
/* eslint-enable @typescript-eslint/no-require-imports */

const _deps = { execSync };

module.exports = {
  _deps,
  async init(_skill) {
    logger.info("[PRReviewer] Initialized");
  },

  async execute(task, context = {}, _skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    logger.info(`[PRReviewer] Action: ${parsed.action}`);

    try {
      switch (parsed.action) {
        case "review":
          return handleReview(parsed.target, context);
        case "summary":
          return handleSummary(parsed.target, context);
        case "diff":
          return handleDiffReview(parsed.target, context);
        default:
          return { success: false, error: `Unknown action: ${parsed.action}` };
      }
    } catch (error) {
      logger.error("[PRReviewer] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "diff", target: "main" };
  }
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "diff").toLowerCase();
  const target = parts[1] || "main";
  return { action, target };
}

function exec(cmd, cwd) {
  try {
    return _deps
      .execSync(cmd, {
        cwd: cwd || process.cwd(),
        encoding: "utf8",
        timeout: 30000,
      })
      .trim();
  } catch (e) {
    return e.stdout || e.message;
  }
}

function handleReview(prNumber, context) {
  const cwd = context.cwd || process.cwd();
  let prInfo, diff;

  try {
    prInfo = exec(
      `gh pr view ${prNumber} --json title,body,additions,deletions,files,author`,
      cwd,
    );
    diff = exec(`gh pr diff ${prNumber}`, cwd);
  } catch (e) {
    return {
      success: false,
      error: `Cannot fetch PR #${prNumber}: ${e.message}`,
    };
  }

  const analysis = analyzeDiff(diff);

  return {
    success: true,
    action: "review",
    prNumber,
    prInfo: safeParseJSON(prInfo),
    analysis,
    message: `PR #${prNumber} reviewed: ${analysis.findings.length} finding(s).`,
  };
}

function handleSummary(branch, context) {
  const cwd = context.cwd || process.cwd();
  const base = branch || "main";

  const log = exec(`git log ${base}..HEAD --oneline`, cwd);
  const stat = exec(`git diff ${base}...HEAD --stat`, cwd);
  const diffSummary = exec(`git diff ${base}...HEAD --shortstat`, cwd);

  const commits = log ? log.split("\n").filter(Boolean) : [];

  return {
    success: true,
    action: "summary",
    baseBranch: base,
    commits: commits.map((c) => {
      const [hash, ...msg] = c.split(" ");
      return { hash, message: msg.join(" ") };
    }),
    commitCount: commits.length,
    stat,
    shortStat: diffSummary,
    message: `${commits.length} commit(s) ahead of ${base}. ${diffSummary}`,
  };
}

function handleDiffReview(baseBranch, context) {
  const cwd = context.cwd || process.cwd();
  const base = baseBranch || "main";

  const diff = exec(`git diff ${base}...HEAD`, cwd);
  const analysis = analyzeDiff(diff);

  return {
    success: true,
    action: "diff-review",
    baseBranch: base,
    analysis,
    message: `Diff review against ${base}: ${analysis.findings.length} finding(s), ${analysis.filesChanged} file(s) changed.`,
  };
}

function analyzeDiff(diff) {
  if (!diff) {
    return { findings: [], filesChanged: 0, additions: 0, deletions: 0 };
  }

  const findings = [];
  const lines = diff.split("\n");
  let currentFile = "";
  let lineNum = 0;
  let additions = 0;
  let deletions = 0;
  const files = new Set();

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/b\/(.+)$/);
      currentFile = match ? match[1] : "";
      files.add(currentFile);
    } else if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      lineNum = match ? parseInt(match[1], 10) : 0;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
      lineNum++;

      // Security checks
      if (
        /(?:password|secret|api_key|token)\s*[:=]\s*["'][^"']+["']/i.test(line)
      ) {
        findings.push({
          severity: "critical",
          file: currentFile,
          line: lineNum,
          type: "security",
          message: "Potential hardcoded secret detected",
        });
      }
      if (/eval\s*\(/.test(line)) {
        findings.push({
          severity: "warning",
          file: currentFile,
          line: lineNum,
          type: "security",
          message: "Use of eval() detected",
        });
      }
      // Console.log in production
      if (
        /console\.(log|debug)\(/.test(line) &&
        !/test|spec|debug/i.test(currentFile)
      ) {
        findings.push({
          severity: "info",
          file: currentFile,
          line: lineNum,
          type: "style",
          message: "console.log in production code",
        });
      }
      // TODO/FIXME
      if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(line)) {
        findings.push({
          severity: "info",
          file: currentFile,
          line: lineNum,
          type: "todo",
          message: line.trim().substring(1),
        });
      }
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  return {
    findings,
    filesChanged: files.size,
    additions,
    deletions,
    files: Array.from(files),
  };
}

function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
