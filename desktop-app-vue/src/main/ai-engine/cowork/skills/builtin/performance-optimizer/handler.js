/**
 * Performance Optimizer Skill Handler
 *
 * Analyzes code for performance patterns: algorithmic complexity,
 * memory leaks, I/O bottlenecks, unnecessary re-renders, and slow
 * database queries. Rates issues by impact and difficulty.
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
  ".sql",
]);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "__pycache__",
]);

// ── Performance patterns ───────────────────────────────────────────

const PERF_CHECKS = [
  // Algorithm issues
  {
    pattern: /\.filter\([^)]*\)\.map\(/g,
    id: "chain-filter-map",
    severity: "P2",
    category: "algorithm",
    message:
      "Chained filter().map() — consider single reduce() to avoid double iteration",
    impact: "medium",
    difficulty: "low",
  },
  {
    pattern: /for\s*\([^)]*\)\s*\{[\s\S]{0,500}for\s*\([^)]*\)/g,
    id: "nested-loops",
    severity: "P1",
    category: "algorithm",
    message: "Nested loops detected — O(n²) potential; consider Map/Set lookup",
    impact: "high",
    difficulty: "medium",
  },
  {
    pattern: /\.indexOf\([^)]+\)\s*[!=><]/g,
    id: "indexOf-check",
    severity: "P2",
    category: "algorithm",
    message: "indexOf for existence check — use .includes() or Set.has()",
    impact: "low",
    difficulty: "low",
  },
  {
    pattern: /Array\.from\(\{.*length.*\}\)/g,
    id: "array-from-length",
    severity: "P3",
    category: "algorithm",
    message: "Array.from with length — pre-allocate if possible",
    impact: "low",
    difficulty: "low",
  },

  // Memory issues
  {
    pattern: /setInterval\s*\(/g,
    id: "setInterval-leak",
    severity: "P1",
    category: "memory",
    message: "setInterval without clearInterval — potential memory leak",
    impact: "high",
    difficulty: "low",
  },
  {
    pattern: /addEventListener\s*\(/g,
    id: "event-listener-leak",
    severity: "P2",
    category: "memory",
    message: "addEventListener — ensure removeEventListener on cleanup",
    impact: "medium",
    difficulty: "low",
  },
  {
    pattern: /new\s+Map\(\)|new\s+Set\(\)|new\s+WeakMap\(\)/g,
    id: "unbounded-collection",
    severity: "P2",
    category: "memory",
    message: "Unbounded collection — consider size limits or LRU eviction",
    impact: "medium",
    difficulty: "medium",
  },
  {
    pattern: /JSON\.parse\(JSON\.stringify\(/g,
    id: "json-deep-clone",
    severity: "P1",
    category: "memory",
    message: "JSON deep clone — use structuredClone() or targeted copy",
    impact: "high",
    difficulty: "low",
  },

  // I/O issues
  {
    pattern: /readFileSync|writeFileSync/g,
    id: "sync-io",
    severity: "P1",
    category: "io",
    message: "Synchronous file I/O — blocks event loop; use async version",
    impact: "high",
    difficulty: "medium",
  },
  {
    pattern: /await\s+\w+[\s\S]{0,50}await\s+\w+[\s\S]{0,50}await\s+\w+/g,
    id: "sequential-await",
    severity: "P2",
    category: "io",
    message: "Sequential awaits — use Promise.all() for independent operations",
    impact: "medium",
    difficulty: "low",
  },

  // Rendering issues (Vue/React)
  {
    pattern: /v-for[\s\S]{0,100}(?!:key)/g,
    id: "vfor-no-key",
    severity: "P1",
    category: "render",
    message: "v-for without :key — causes inefficient DOM patching",
    impact: "high",
    difficulty: "low",
  },
  {
    pattern: /computed\(\(\)\s*=>\s*\{[\s\S]{100,}\}/g,
    id: "heavy-computed",
    severity: "P2",
    category: "render",
    message: "Heavy computed property — consider caching or memoization",
    impact: "medium",
    difficulty: "medium",
  },

  // Database issues
  {
    pattern: /SELECT\s+\*\s+FROM/gi,
    id: "select-star",
    severity: "P2",
    category: "database",
    message: "SELECT * — specify needed columns to reduce data transfer",
    impact: "medium",
    difficulty: "low",
  },
  {
    pattern:
      /(?:for|forEach|map)[\s\S]{0,200}(?:query|execute|findOne|findById)/g,
    id: "n-plus-one",
    severity: "P0",
    category: "database",
    message: "Possible N+1 query pattern — use batch/join instead",
    impact: "critical",
    difficulty: "high",
  },
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

  for (const check of PERF_CHECKS) {
    const re = new RegExp(check.pattern.source, check.pattern.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split("\n").length;
      issues.push({
        line: lineNum,
        severity: check.severity,
        category: check.category,
        message: check.message,
        impact: check.impact,
        difficulty: check.difficulty,
        snippet: match[0].slice(0, 80).replace(/\n/g, " "),
      });
    }
  }

  // File-level metrics
  const lineCount = lines.length;
  const funcCount = (
    content.match(/(?:async\s+)?function\s+\w+|=>\s*\{/g) || []
  ).length;

  return { filePath, lineCount, funcCount, issues };
}

function computeScore(allIssues) {
  let score = 100;
  for (const issue of allIssues) {
    if (issue.severity === "P0") {
      score -= 15;
    } else if (issue.severity === "P1") {
      score -= 8;
    } else if (issue.severity === "P2") {
      score -= 3;
    } else {
      score -= 1;
    }
  }
  return Math.max(0, Math.round(score));
}

// ── Handler ────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[performance-optimizer] handler initialized for "${skill?.name || "performance-optimizer"}"`,
    );
  },

  async execute(task, context, skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();

    const focusMatch = input.match(/--focus\s+(cpu|memory|io|render|all)/);
    const depthMatch = input.match(/--depth\s+(shallow|normal|deep)/);
    const focus = focusMatch ? focusMatch[1] : "all";
    const depth = depthMatch ? depthMatch[1] : "normal";
    const cleanInput = input
      .replace(/--\w+\s+\S+/g, "")
      .replace(/--benchmark/g, "")
      .trim();

    let targetPath = cleanInput || projectRoot;
    if (!path.isAbsolute(targetPath)) {
      targetPath = path.resolve(projectRoot, targetPath);
    }

    try {
      let files;
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        const maxFiles = depth === "deep" ? 100 : depth === "shallow" ? 20 : 50;
        files = collectFiles(targetPath, maxFiles);
      } else {
        files = [targetPath];
      }

      if (files.length === 0) {
        return {
          success: true,
          result: { message: "No analyzable files found.", score: 100 },
          message: "No source files found to analyze.",
        };
      }

      const fileResults = files.map((f) => analyzeFile(f));
      let allIssues = fileResults.flatMap((r) =>
        r.issues.map((i) => ({
          ...i,
          file: path.relative(projectRoot, r.filePath),
        })),
      );

      // Filter by focus
      if (focus !== "all") {
        const focusMap = {
          cpu: "algorithm",
          memory: "memory",
          io: "io",
          render: "render",
        };
        allIssues = allIssues.filter(
          (i) => i.category === focusMap[focus] || i.category === "database",
        );
      }

      const score = computeScore(allIssues);

      // Group by severity
      const bySeverity = { P0: [], P1: [], P2: [], P3: [] };
      for (const i of allIssues) {
        (bySeverity[i.severity] || bySeverity.P3).push(i);
      }

      const summary = {
        filesAnalyzed: files.length,
        totalLines: fileResults.reduce((s, r) => s + r.lineCount, 0),
        totalFunctions: fileResults.reduce((s, r) => s + r.funcCount, 0),
        score,
        issueCount: allIssues.length,
        bySeverity: Object.fromEntries(
          Object.entries(bySeverity).map(([k, v]) => [k, v.length]),
        ),
        focus,
        depth,
      };

      const topIssues = allIssues
        .sort((a, b) => {
          const ord = { P0: 0, P1: 1, P2: 2, P3: 3 };
          return (ord[a.severity] || 3) - (ord[b.severity] || 3);
        })
        .slice(0, 25);

      const issueLines = topIssues
        .slice(0, 15)
        .map(
          (i) =>
            `  [${i.severity}] ${i.file}:${i.line} — ${i.message} (impact: ${i.impact})`,
        )
        .join("\n");

      const message = [
        `## Performance Analysis`,
        `**Score: ${score}/100** | ${files.length} files, ${summary.totalLines} lines`,
        `Issues: ${bySeverity.P0.length} critical, ${bySeverity.P1.length} high, ${bySeverity.P2.length} medium, ${bySeverity.P3.length} low`,
        "",
        "### Top Issues",
        issueLines || "  No performance issues detected!",
      ].join("\n");

      return { success: true, result: { summary, issues: topIssues }, message };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `Performance analysis failed: ${err.message}`,
      };
    }
  },
};
