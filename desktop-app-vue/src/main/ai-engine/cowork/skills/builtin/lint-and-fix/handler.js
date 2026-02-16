/**
 * Lint & Fix Skill Handler
 *
 * Detects project linter configuration, runs linters, parses errors,
 * and provides structured reports. Implements the lint-then-fix loop
 * pattern inspired by Aider.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const LINTER_CONFIGS = {
  eslint: {
    name: "ESLint",
    configs: [
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.json",
      ".eslintrc.yml",
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
    ],
    runCmd: "npx eslint --format json",
    fixCmd: "npx eslint --fix --format json",
    lang: "js/ts",
  },
  prettier: {
    name: "Prettier",
    configs: [
      ".prettierrc",
      ".prettierrc.js",
      ".prettierrc.json",
      ".prettierrc.yml",
      "prettier.config.js",
      "prettier.config.cjs",
    ],
    runCmd: "npx prettier --check",
    fixCmd: "npx prettier --write",
    lang: "js/ts/css",
  },
};

const MAX_ITERATIONS = 5;

module.exports = {
  async init(skill) {
    logger.info("[LintAndFix] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { targetPath, options } = parseInput(input, context);

    logger.info(`[LintAndFix] Target: ${targetPath}`, { options });

    try {
      // Detect linter
      const workspaceRoot =
        context.workspacePath || findProjectRoot(targetPath);
      const linter = options.linter
        ? LINTER_CONFIGS[options.linter]
        : detectLinter(workspaceRoot);

      if (!linter) {
        return {
          success: false,
          message:
            "No linter configuration found. Supported: ESLint, Prettier.",
        };
      }

      if (options.checkOnly) {
        return await handleCheckOnly(
          linter,
          targetPath,
          workspaceRoot,
          options.strict,
        );
      }

      return await handleLintAndFix(linter, targetPath, workspaceRoot, options);
    } catch (error) {
      logger.error(`[LintAndFix] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Lint failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    checkOnly: false,
    strict: false,
    maxIterations: MAX_ITERATIONS,
    linter: null,
  };
  let targetPath = context.workspacePath || process.cwd();

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--check-only") {
      options.checkOnly = true;
    } else if (p === "--strict") {
      options.strict = true;
    } else if (p === "--max-iterations") {
      options.maxIterations = parseInt(parts[++i]) || MAX_ITERATIONS;
    } else if (p === "--linter") {
      options.linter = parts[++i];
    } else if (p && !p.startsWith("-")) {
      const resolved = path.resolve(targetPath, p);
      if (fs.existsSync(resolved)) {
        targetPath = resolved;
      }
    }
  }

  return { targetPath, options };
}

function findProjectRoot(startPath) {
  let current = startPath;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return startPath;
}

function detectLinter(projectRoot) {
  for (const [key, linter] of Object.entries(LINTER_CONFIGS)) {
    for (const config of linter.configs) {
      if (fs.existsSync(path.join(projectRoot, config))) {
        return { ...linter, key, detectedConfig: config };
      }
    }
  }

  // Check package.json for eslintConfig
  const pkgPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.eslintConfig) {
        return {
          ...LINTER_CONFIGS.eslint,
          key: "eslint",
          detectedConfig: "package.json (eslintConfig)",
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function runLinter(linter, targetPath, projectRoot, fix = false) {
  const cmd = fix ? linter.fixCmd : linter.runCmd;
  const fullCmd = `${cmd} "${targetPath}"`;

  try {
    const output = execSync(fullCmd, {
      encoding: "utf-8",
      cwd: projectRoot,
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output, issues: [] };
  } catch (error) {
    const output = (error.stdout || "") + (error.stderr || "");
    const issues = parseLintOutput(output, linter.key);
    return { success: false, output, issues };
  }
}

function parseLintOutput(output, linterKey) {
  const issues = [];

  if (linterKey === "eslint") {
    // Try JSON format
    try {
      const jsonStart = output.indexOf("[");
      if (jsonStart >= 0) {
        const results = JSON.parse(output.substring(jsonStart));
        for (const file of results) {
          for (const msg of file.messages || []) {
            issues.push({
              file: file.filePath,
              line: msg.line,
              column: msg.column,
              severity: msg.severity === 2 ? "error" : "warning",
              message: msg.message,
              ruleId: msg.ruleId,
              fixable: !!msg.fix,
            });
          }
        }
        return issues;
      }
    } catch {
      // Fall through to text parsing
    }

    // Text format fallback
    const lines = output.split("\n");
    for (const line of lines) {
      const m = line.match(
        /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)$/,
      );
      if (m) {
        issues.push({
          line: parseInt(m[1]),
          column: parseInt(m[2]),
          severity: m[3],
          message: m[4],
          ruleId: m[5],
        });
      }
    }
  }

  return issues;
}

function formatIssues(issues) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const fixable = issues.filter((i) => i.fixable).length;

  const summary = `${errors} errors, ${warnings} warnings${fixable ? `, ${fixable} auto-fixable` : ""}`;
  const details = issues.slice(0, 20).map((i) => {
    const loc = i.file
      ? `${path.basename(i.file)}:${i.line}:${i.column}`
      : `${i.line}:${i.column}`;
    return `  ${i.severity === "error" ? "❌" : "⚠️"} ${loc} - ${i.message} (${i.ruleId || "unknown"})`;
  });

  if (issues.length > 20) {
    details.push(`  ... and ${issues.length - 20} more issues`);
  }

  return { summary, details: details.join("\n") };
}

async function handleCheckOnly(linter, targetPath, projectRoot, strict) {
  const result = runLinter(linter, targetPath, projectRoot, false);
  const issues = strict
    ? result.issues
    : result.issues.filter((i) => i.severity === "error");
  const { summary, details } = formatIssues(issues);

  const lines = [
    `Lint Report`,
    `===========`,
    `Linter: ${linter.name}`,
    `Config: ${linter.detectedConfig || "auto"}`,
    `Target: ${targetPath}`,
    ``,
    `Result: ${issues.length === 0 ? "✅ All clean" : `${summary}`}`,
  ];

  if (details) {
    lines.push("", details);
  }

  return {
    success: true,
    result: { linter: linter.name, issues, total: issues.length },
    message: lines.join("\n"),
  };
}

async function handleLintAndFix(linter, targetPath, projectRoot, options) {
  const rounds = [];
  let iteration = 0;
  let totalFixed = 0;

  while (iteration < options.maxIterations) {
    iteration++;

    // Run with --fix first
    const fixResult = runLinter(linter, targetPath, projectRoot, true);

    // Run again to check remaining
    const checkResult = runLinter(linter, targetPath, projectRoot, false);
    const remaining = options.strict
      ? checkResult.issues
      : checkResult.issues.filter((i) => i.severity === "error");

    const beforeCount = fixResult.issues.length;
    const afterCount = remaining.length;
    const fixed = Math.max(0, beforeCount - afterCount);
    totalFixed += fixed;

    rounds.push({
      round: iteration,
      found: beforeCount,
      autoFixed: fixed,
      remaining: afterCount,
    });

    if (afterCount === 0) {
      break;
    }

    // If no progress, stop
    if (fixed === 0 && iteration > 1) {
      rounds[rounds.length - 1].stalled = true;
      break;
    }
  }

  const lastRound = rounds[rounds.length - 1];
  const allClean = lastRound.remaining === 0;

  const lines = [
    `Lint & Fix Report`,
    `=================`,
    `Linter: ${linter.name}`,
    `Config: ${linter.detectedConfig || "auto"}`,
    ``,
  ];

  for (const r of rounds) {
    lines.push(`Round ${r.round}: ${r.found} issues found`);
    lines.push(`  - Auto-fixed: ${r.autoFixed}`);
    lines.push(`  - Remaining: ${r.remaining}`);
    if (r.stalled) {
      lines.push(`  - ⚠️ No progress, stopping`);
    }
    lines.push("");
  }

  lines.push(
    `Result: ${allClean ? "✅ All clean" : `❌ ${lastRound.remaining} issues remain`} after ${iteration} round(s)`,
  );
  lines.push(`Total auto-fixed: ${totalFixed}`);

  return {
    success: true,
    result: { rounds, totalFixed, allClean },
    message: lines.join("\n"),
  };
}
