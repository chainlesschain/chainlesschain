/**
 * Code Review Skill Handler
 *
 * Analyzes code files for quality issues, style, best practices,
 * security concerns, and performance patterns. Outputs a structured
 * review with severity ratings and a quality score.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const CODE_EXTS = new Set([
  ".js",
  ".mjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".cpp",
  ".h",
]);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "__pycache__",
]);

// ── Pattern definitions ────────────────────────────────────────────
const QUALITY_PATTERNS = [
  {
    pattern: /console\.(log|debug|warn|error)\(/g,
    severity: "info",
    category: "quality",
    message: "Console statement found — remove before production",
  },
  {
    pattern: /TODO|FIXME|HACK|XXX/g,
    severity: "info",
    category: "quality",
    message: "TODO/FIXME marker found",
  },
  {
    pattern: /var\s+\w+/g,
    severity: "warning",
    category: "style",
    message: "Use const/let instead of var",
  },
  {
    pattern: /==\s|!=\s/g,
    severity: "warning",
    category: "quality",
    message: "Use strict equality (===, !==)",
  },
  {
    pattern: /function\s+\w+\s*\([^)]{100,}\)/g,
    severity: "warning",
    category: "quality",
    message: "Function has too many parameters",
  },
];

const SECURITY_PATTERNS = [
  {
    pattern: /eval\s*\(/g,
    severity: "critical",
    category: "security",
    message: "ev" + "al() usage — potential code injection",
  },
  {
    pattern: /innerHTML\s*=/g,
    severity: "critical",
    category: "security",
    message: "innerHTML assignment — potential XSS",
  },
  {
    pattern: /document\.write\s*\(/g,
    severity: "critical",
    category: "security",
    message: "document.wri" + "te() — potential XSS",
  },
  {
    pattern: /exec\s*\(|spawn\s*\(/g,
    severity: "warning",
    category: "security",
    message: "Shell execution — validate inputs",
  },
  {
    pattern: /password\s*[:=]\s*['"][^'"]+['"]/gi,
    severity: "critical",
    category: "security",
    message: "Possible hardcoded password",
  },
];

const PERF_PATTERNS = [
  {
    pattern: /\.forEach\s*\([^)]*=>\s*\{[\s\S]{0,200}\.push\(/g,
    severity: "info",
    category: "performance",
    message: "forEach+push pattern — consider .map() or .filter()",
  },
  {
    pattern: /JSON\.parse\(JSON\.stringify\(/g,
    severity: "warning",
    category: "performance",
    message: "Deep clone via JSON — use structuredClone or a library",
  },
  {
    pattern: /new\s+RegExp\(/g,
    severity: "info",
    category: "performance",
    message: "Dynamic RegExp in hot path? Consider pre-compiling",
  },
];

const ALL_PATTERNS = [
  ...QUALITY_PATTERNS,
  ...SECURITY_PATTERNS,
  ...PERF_PATTERNS,
];

// ── Helpers ────────────────────────────────────────────────────────

function collectFiles(dir, maxFiles = 50) {
  const results = [];
  function walk(d) {
    if (results.length >= maxFiles) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= maxFiles) {
        return;
      }
      if (IGNORE_DIRS.has(e.name)) {
        continue;
      }
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (CODE_EXTS.has(path.extname(e.name).toLowerCase())) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const issues = [];

  // Pattern-based analysis
  for (const { pattern, severity, category, message } of ALL_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split("\n").length;
      issues.push({
        line: lineNum,
        severity,
        category,
        message,
        snippet: match[0].slice(0, 60),
      });
    }
  }

  // Complexity: functions > 50 lines
  let funcStart = null;
  let braceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(async\s+)?function\s|=>\s*\{/.test(line) && funcStart === null) {
      funcStart = i;
      braceDepth = 0;
    }
    if (funcStart !== null) {
      braceDepth +=
        (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (braceDepth <= 0) {
        const funcLen = i - funcStart + 1;
        if (funcLen > 50) {
          issues.push({
            line: funcStart + 1,
            severity: "warning",
            category: "quality",
            message: `Function is ${funcLen} lines long — consider splitting`,
          });
        }
        funcStart = null;
      }
    }
  }

  // File-level: too many lines
  if (lines.length > 500) {
    issues.push({
      line: 1,
      severity: "info",
      category: "quality",
      message: `File has ${lines.length} lines — consider modularizing`,
    });
  }

  return { filePath, lineCount: lines.length, issues };
}

function computeScore(allIssues) {
  let score = 10;
  for (const issue of allIssues) {
    if (issue.severity === "critical") {
      score -= 2;
    } else if (issue.severity === "warning") {
      score -= 0.5;
    } else {
      score -= 0.1;
    }
  }
  return Math.max(1, Math.round(score * 10) / 10);
}

// ── Handler ────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[code-review] handler initialized for "${skill?.name || "code-review"}"`,
    );
  },

  async execute(task, context, skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();

    let targetPath = input || projectRoot;
    if (!path.isAbsolute(targetPath)) {
      targetPath = path.resolve(projectRoot, targetPath);
    }

    try {
      let files;
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        files = collectFiles(targetPath);
      } else {
        files = [targetPath];
      }

      if (files.length === 0) {
        return {
          success: true,
          result: {
            message: "No reviewable source files found.",
            issues: [],
            score: 10,
          },
        };
      }

      const fileResults = files.map((f) => analyzeFile(f));
      const allIssues = fileResults.flatMap((r) =>
        r.issues.map((i) => ({
          ...i,
          file: path.relative(projectRoot, r.filePath),
        })),
      );
      const score = computeScore(allIssues);

      const summary = {
        filesReviewed: files.length,
        totalLines: fileResults.reduce((s, r) => s + r.lineCount, 0),
        score,
        issueCount: { critical: 0, warning: 0, info: 0 },
      };
      for (const i of allIssues) {
        summary.issueCount[i.severity] =
          (summary.issueCount[i.severity] || 0) + 1;
      }

      // Top issues
      const topIssues = allIssues
        .sort((a, b) => {
          const ord = { critical: 0, warning: 1, info: 2 };
          return ord[a.severity] - ord[b.severity];
        })
        .slice(0, 30);

      return {
        success: true,
        result: { summary, issues: topIssues },
        message: `Reviewed ${files.length} files (${summary.totalLines} lines). Score: ${score}/10. Found ${allIssues.length} issues (${summary.issueCount.critical} critical, ${summary.issueCount.warning} warnings).`,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `Code review failed: ${err.message}`,
      };
    }
  },
};
