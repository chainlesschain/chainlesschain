/**
 * BugBot Skill Handler
 *
 * Proactive bug detector that scans code changes and diffs to find
 * potential bugs, race conditions, null-pointer issues, and more
 * before they reach production. Supports 15+ bug patterns with
 * three operational modes: scan, diff, and watch.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
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
  ".venv",
  "vendor",
]);

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const BUG_PATTERNS = [
  {
    id: "sql-injection",
    pattern:
      /(['`"]SELECT\s|['`"]INSERT\s|['`"]UPDATE\s|['`"]DELETE\s)[^'`"]*\$\{|(\+\s*['`"]\s*(?:SELECT|INSERT|UPDATE|DELETE)\b|\b(?:SELECT|INSERT|UPDATE|DELETE)\s[^'`"]*['`"]\s*\+)/gi,
    severity: "critical",
    message:
      "Potential SQL injection via string concatenation or template literal in SQL query",
    suggestion:
      "Use parameterized queries or prepared statements instead of string concatenation",
  },
  {
    id: "xss-innerhtml",
    pattern: /\.innerHTML\s*=\s*[^'`"\s]/g,
    severity: "critical",
    message: "XSS risk - innerHTML set with dynamic content",
    suggestion:
      "Use textContent, or sanitize with DOMPurify before assigning to innerHTML",
  },
  {
    id: "race-condition",
    severity: "critical",
    message:
      "Potential race condition - shared mutable variable modified across async boundaries",
    suggestion:
      "Use local variables within async scope, or protect shared state with a mutex/lock",
    custom: "race-condition",
  },
  {
    id: "deadlock-potential",
    pattern:
      /(?:acquire|lock)\s*\([^)]*\)[\s\S]{0,200}(?:acquire|lock)\s*\([^)]*\)/g,
    severity: "critical",
    message: "Potential deadlock - nested lock acquisition detected",
    suggestion:
      "Always acquire locks in a consistent order, or use a single lock",
  },
  {
    id: "null-undefined-access",
    pattern: /(?<!\?\.)\.(\w+)\.(\w+)\.(\w+)/g,
    severity: "high",
    message: "Deep property access without null guard - may throw TypeError",
    suggestion:
      "Use optional chaining (?.) or add null checks before deep access",
  },
  {
    id: "promise-no-catch",
    pattern: /new\s+Promise\s*\([^)]*\)(?:\s*;|\s*$)/gm,
    severity: "high",
    message:
      "Promise created without .catch() or .then() - unhandled rejection risk",
    suggestion: "Add .catch() handler or use try/catch with await",
  },
  {
    id: "promise-no-await",
    pattern:
      /(?<!await\s)(?<!return\s)(?:fetch|axios\.\w+|fs\.promises\.\w+)\s*\(/g,
    severity: "high",
    message: "Async operation called without await - result will be discarded",
    suggestion: "Add await keyword or handle the returned Promise",
  },
  {
    id: "resource-leak",
    pattern: /(?:createReadStream|createWriteStream|openSync)\s*\([^)]*\)/g,
    severity: "high",
    message:
      "Resource opened - verify it is closed in a finally block to prevent leaks",
    suggestion:
      "Ensure resources are closed in a finally block or use pipeline/stream.promises",
    postFilter: "resource-leak",
  },
  {
    id: "infinite-loop",
    pattern: /while\s*\(\s*(?:true|1)\s*\)\s*\{/g,
    severity: "high",
    message:
      "while(true) loop - ensure a break/return/throw exists within the body",
    suggestion:
      "Add a break condition, timeout, or iteration limit inside the loop",
    postFilter: "infinite-loop",
  },
  {
    id: "type-coercion",
    pattern: /[^!=<>]==[^=]|[^!]=!=[^=]/g,
    severity: "medium",
    message:
      "Loose equality (== or !=) - implicit type coercion may cause unexpected behavior",
    suggestion:
      "Use strict equality (=== or !==) to avoid type coercion surprises",
  },
  {
    id: "array-bounds",
    pattern: /\[\s*\w+\.length\s*\]/g,
    severity: "medium",
    message:
      "Array access at .length index - always out of bounds (last valid is length-1)",
    suggestion: "Use array[array.length - 1] for the last element",
  },
  {
    id: "regexp-catastrophic-backtracking",
    pattern:
      /new\s+RegExp\s*\(\s*['`"].*(?:\+\+|\*\*|\{\d+,\}.*\{\d+,\}).*['`"]/g,
    severity: "medium",
    message: "RegExp with nested quantifiers - catastrophic backtracking risk",
    suggestion:
      "Simplify the regex, use atomic groups, or add input length limits",
  },
  {
    id: "switch-no-break",
    severity: "medium",
    message: "Switch case without break/return - unintentional fall-through",
    suggestion:
      "Add break/return at each case end, or add a falls-through comment",
    custom: "switch-no-break",
  },
  {
    id: "off-by-one",
    pattern:
      /for\s*\(\s*(?:let|var|const)\s+\w+\s*=\s*0\s*;\s*\w+\s*<=\s*\w+\.length\s*;/g,
    severity: "low",
    message:
      "Off-by-one - loop uses <= array.length instead of < (accesses undefined element)",
    suggestion: "Change <= to < when iterating array indices",
  },
  {
    id: "unreachable-code",
    severity: "low",
    message:
      "Unreachable code after return/throw - dead code that never executes",
    suggestion: "Remove the unreachable code or restructure the logic",
    custom: "unreachable-code",
  },
  {
    id: "callback-no-error",
    pattern:
      /\.on\s*\(\s*['`"](?:data|message|connection|request)['`"]\s*,\s*(?:function\s*\(|(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>)/g,
    severity: "low",
    message:
      "Event handler without visible error handling - errors may be swallowed",
    suggestion:
      "Wrap callback body in try/catch or add an error event listener",
  },
];

function collectFiles(dir, maxFiles) {
  maxFiles = maxFiles || 100;
  const results = [];
  function walk(d) {
    if (results.length >= maxFiles) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (let idx = 0; idx < entries.length; idx++) {
      const ent = entries[idx];
      if (results.length >= maxFiles) {
        return;
      }
      if (IGNORE_DIRS.has(ent.name)) {
        continue;
      }
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (CODE_EXTS.has(path.extname(ent.name).toLowerCase())) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function runGit(args, cwd) {
  try {
    return execSync("git " + args, {
      cwd: cwd,
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    logger.warn("[bugbot] git failed: git " + args + " - " + err.message);
    return "";
  }
}

function detectCustomPattern(id, lines, lineFilter) {
  const hits = [];
  if (id === "race-condition") {
    for (let i = 0; i < lines.length; i++) {
      if (lineFilter && !lineFilter.has(i + 1)) {
        continue;
      }
      const varMatch = lines[i].match(/(?:let|var)\s+(\w+)\s*=/);
      if (!varMatch) {
        continue;
      }
      const varName = varMatch[1];
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        if (
          /(?:await\s|\.then\s*\(|setTimeout|setInterval)/.test(lines[j]) &&
          new RegExp("\b" + varName + "\b").test(lines[j])
        ) {
          hits.push(j + 1);
          break;
        }
      }
    }
  }
  if (id === "switch-no-break") {
    let inSwitch = false,
      caseStart = -1,
      hasBreak = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (/^switch\s*\(/.test(trimmed)) {
        inSwitch = true;
      }
      if (!inSwitch) {
        continue;
      }
      if (/^case\s|^default\s*:/.test(trimmed)) {
        if (caseStart >= 0 && !hasBreak) {
          if (!lineFilter || lineFilter.has(caseStart + 1)) {
            hits.push(caseStart + 1);
          }
        }
        caseStart = i;
        hasBreak = false;
      }
      if (/\b(?:break|return|throw|continue)\b/.test(trimmed)) {
        hasBreak = true;
      }
    }
  }
  if (id === "unreachable-code") {
    for (let i = 0; i < lines.length - 1; i++) {
      if (lineFilter && !lineFilter.has(i + 2)) {
        continue;
      }
      const trimmed = lines[i].trim();
      if (/^(?:return|throw)\s/.test(trimmed) && !trimmed.endsWith("{")) {
        const nextLine = (lines[i + 1] || "").trim();
        if (
          nextLine &&
          nextLine !== "}" &&
          nextLine !== "" &&
          !/^(?:case\s|default:|\/\/)/.test(nextLine)
        ) {
          hits.push(i + 2);
        }
      }
    }
  }
  return hits;
}

function scanContent(content, filePath, lineFilter) {
  const bugs = [],
    lines = content.split("\n");
  for (let p = 0; p < BUG_PATTERNS.length; p++) {
    const bp = BUG_PATTERNS[p];
    if (bp.custom) {
      const hitLines = detectCustomPattern(bp.custom, lines, lineFilter);
      for (let h = 0; h < hitLines.length; h++) {
        bugs.push({
          file: filePath,
          line: hitLines[h],
          severity: bp.severity,
          pattern: bp.id,
          message: bp.message,
          suggestion: bp.suggestion,
        });
      }
      continue;
    }
    const re = new RegExp(bp.pattern.source, bp.pattern.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split("\n").length;
      if (lineFilter && !lineFilter.has(lineNum)) {
        continue;
      }
      if (bp.postFilter === "resource-leak") {
        if (
          /\.close\(|\.end\(|\.destroy\(|\.release\(|finally/.test(
            content.slice(match.index, match.index + 500),
          )
        ) {
          continue;
        }
      }
      if (bp.postFilter === "infinite-loop") {
        if (
          /\bbreak\b|\breturn\b|\bthrow\b/.test(
            content.slice(match.index, match.index + 500),
          )
        ) {
          continue;
        }
      }
      bugs.push({
        file: filePath,
        line: lineNum,
        severity: bp.severity,
        pattern: bp.id,
        message: bp.message,
        suggestion: bp.suggestion,
      });
    }
  }
  return bugs;
}

function parseDiffOutput(diffText) {
  let fileChanges = new Map(),
    currentFile = null,
    lineNum = 0;
  const diffLines = diffText.split("\n");
  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
    } else if (line.startsWith("@@ ")) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      if (m) {
        lineNum = parseInt(m[1], 10) - 1;
      }
    } else if (currentFile && line.startsWith("+") && !line.startsWith("+++")) {
      lineNum++;
      if (!fileChanges.has(currentFile)) {
        fileChanges.set(currentFile, new Set());
      }
      fileChanges.get(currentFile).add(lineNum);
    } else if (currentFile && !line.startsWith("-")) {
      lineNum++;
    }
  }
  return fileChanges;
}

function buildSummary(bugs) {
  const s = { critical: 0, high: 0, medium: 0, low: 0 };
  for (let i = 0; i < bugs.length; i++) {
    s[bugs[i].severity] = (s[bugs[i].severity] || 0) + 1;
  }
  return { total: bugs.length, bySeverity: s };
}

function filterBySeverity(bugs, filter) {
  if (!filter || filter === "all") {
    return bugs;
  }
  const threshold = SEVERITY_ORDER[filter];
  if (threshold === undefined) {
    return bugs;
  }
  return bugs.filter(function (b) {
    return SEVERITY_ORDER[b.severity] <= threshold;
  });
}

function modeScan(targetPath, projectRoot, severityFilter) {
  let files;
  try {
    const stat = fs.statSync(targetPath);
    files = stat.isDirectory() ? collectFiles(targetPath) : [targetPath];
  } catch (err) {
    return { success: false, error: "Cannot access target: " + err.message };
  }
  if (files.length === 0) {
    return {
      success: true,
      result: { bugs: [], summary: buildSummary([]) },
      message: "No scannable source files found.",
    };
  }

  let allBugs = [];
  for (let i = 0; i < files.length; i++) {
    try {
      allBugs = allBugs.concat(
        scanContent(
          fs.readFileSync(files[i], "utf-8"),
          path.relative(projectRoot, files[i]),
          null,
        ),
      );
    } catch (err) {
      logger.warn("[bugbot] Failed to read " + files[i] + ": " + err.message);
    }
  }
  const filtered = filterBySeverity(allBugs, severityFilter);
  filtered.sort(function (a, b) {
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
  const summary = buildSummary(filtered);
  return {
    success: true,
    result: { bugs: filtered.slice(0, 50), summary: summary },
    message:
      "Scanned " +
      files.length +
      " files. Found " +
      summary.total +
      " bugs (" +
      summary.bySeverity.critical +
      " critical, " +
      summary.bySeverity.high +
      " high, " +
      summary.bySeverity.medium +
      " medium, " +
      summary.bySeverity.low +
      " low).",
  };
}

function modeDiff(ref, projectRoot, severityFilter) {
  let diffText;
  if (!ref || ref === "staged") {
    diffText = runGit("diff --cached", projectRoot);
    if (!diffText) {
      diffText = runGit("diff HEAD~1", projectRoot);
    }
  } else {
    diffText = runGit("diff " + ref, projectRoot);
  }
  if (!diffText) {
    return {
      success: true,
      result: { bugs: [], summary: buildSummary([]) },
      message: "No diff output - no changes detected.",
    };
  }

  const fileChanges = parseDiffOutput(diffText);
  let allBugs = [];
  for (const entry of fileChanges) {
    if (!CODE_EXTS.has(path.extname(entry[0]).toLowerCase())) {
      continue;
    }
    try {
      allBugs = allBugs.concat(
        scanContent(
          fs.readFileSync(path.resolve(projectRoot, entry[0]), "utf-8"),
          entry[0],
          entry[1],
        ),
      );
    } catch (_e) {
      logger.debug("[bugbot] Skipping: " + entry[0]);
    }
  }
  const filtered = filterBySeverity(allBugs, severityFilter);
  filtered.sort(function (a, b) {
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
  const summary = buildSummary(filtered);
  return {
    success: true,
    result: { bugs: filtered.slice(0, 50), summary: summary },
    message:
      "Analyzed diff across " +
      fileChanges.size +
      " files. Found " +
      summary.total +
      " bugs (" +
      summary.bySeverity.critical +
      " critical, " +
      summary.bySeverity.high +
      " high).",
  };
}

function modeWatch(projectRoot) {
  const logOutput = runGit(
    'log --since="7 days ago" --name-only --pretty=format: --diff-filter=ACMR',
    projectRoot,
  );
  if (!logOutput) {
    return {
      success: true,
      result: {
        recentFiles: 0,
        hotFiles: [],
        bugs: [],
        summary: buildSummary([]),
      },
      message: "No recent file changes found.",
    };
  }

  const seen = {};
  const recentFiles = logOutput
    .split("\n")
    .filter(function (f) {
      if (!f || seen[f]) {
        return false;
      }
      seen[f] = true;
      return CODE_EXTS.has(path.extname(f).toLowerCase());
    })
    .slice(0, 30);

  let allBugs = [];
  for (let i = 0; i < recentFiles.length; i++) {
    try {
      allBugs = allBugs.concat(
        scanContent(
          fs.readFileSync(path.resolve(projectRoot, recentFiles[i]), "utf-8"),
          recentFiles[i],
          null,
        ),
      );
    } catch (_e) {
      /* file removed */
    }
  }
  allBugs.sort(function (a, b) {
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });

  const density = {};
  for (let i = 0; i < allBugs.length; i++) {
    density[allBugs[i].file] = (density[allBugs[i].file] || 0) + 1;
  }
  const hotFiles = Object.entries(density)
    .sort(function (a, b) {
      return b[1] - a[1];
    })
    .slice(0, 10)
    .map(function (e) {
      return { file: e[0], bugCount: e[1] };
    });

  const summary = buildSummary(allBugs);
  return {
    success: true,
    result: {
      recentFiles: recentFiles.length,
      hotFiles: hotFiles,
      bugs: allBugs.slice(0, 30),
      summary: summary,
    },
    message: "Watched " + recentFiles.length + " recently changed files.",
  };
}

function parseArgs(input) {
  const args = { mode: "scan", target: null, severityFilter: "all" };
  if (!input) {
    return args;
  }
  const tokens = input.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "--scan") {
      args.mode = "scan";
    } else if (tokens[i] === "--diff") {
      args.mode = "diff";
    } else if (tokens[i] === "--watch") {
      args.mode = "watch";
    } else if (tokens[i] === "--severity" && tokens[i + 1]) {
      args.severityFilter = tokens[++i];
    } else if (!tokens[i].startsWith("--")) {
      args.target = tokens[i];
    }
  }
  return args;
}

module.exports = {
  async init(_skill) {
    logger.info("[bugbot] handler initialized");
  },

  async execute(task, context, _skill) {
    const input = (
      (task && task.params && task.params.input) ||
      (task && task.action) ||
      ""
    ).trim();
    const projectRoot =
      (context && context.projectRoot) ||
      (context && context.workspaceRoot) ||
      process.cwd();
    const args = parseArgs(input);
    logger.info(
      "[bugbot] mode=" + args.mode + ", target=" + (args.target || "(default)"),
    );

    try {
      switch (args.mode) {
        case "diff":
          return modeDiff(args.target, projectRoot, args.severityFilter);
        case "watch":
          return modeWatch(projectRoot);
        case "scan":
        default: {
          let targetPath = args.target || projectRoot;
          if (!path.isAbsolute(targetPath)) {
            targetPath = path.resolve(projectRoot, targetPath);
          }
          return modeScan(targetPath, projectRoot, args.severityFilter);
        }
      }
    } catch (err) {
      logger.error("[bugbot] execution error: " + err.message);
      return {
        success: false,
        error: err.message,
        message: "BugBot failed: " + err.message,
      };
    }
  },
};
