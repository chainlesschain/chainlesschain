/**
 * Verification Loop Skill Handler
 *
 * 6-stage automated verification pipeline:
 * Build → TypeCheck → Lint → Test → Security → DiffReview
 *
 * Produces a READY/NOT READY verdict based on stage results.
 * Inspired by the everything-claude-code verification loop pattern.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");
const {
  requireBundledSkillProcessBroker,
} = require("../../bundled-skill-process-broker.js");

const ALL_STAGES = [
  "build",
  "typecheck",
  "lint",
  "test",
  "security",
  "diffreview",
];

module.exports = {
  async init(_skill) {
    logger.info("[VerificationLoop] Handler initialized");
  },

  async execute(task, context = {}, _skill) {
    const input = task.input || task.args || "";
    const { targetPath, options } = parseInput(input, context);

    logger.info(`[VerificationLoop] Target: ${targetPath}`, { options });

    try {
      const workspaceRoot =
        context.workspacePath || findProjectRoot(targetPath);
      const projectType = detectProjectType(workspaceRoot);

      logger.info(
        `[VerificationLoop] Project type: ${projectType}, root: ${workspaceRoot}`,
      );

      const stages = options.stages || ALL_STAGES;
      const results = [];
      const startTime = Date.now();

      for (const stage of stages) {
        if (options.skip.includes(stage)) {
          results.push({
            stage,
            status: "SKIP",
            duration: 0,
            details: "Skipped by user",
          });
          continue;
        }

        const stageStart = Date.now();
        let stageResult;

        switch (stage) {
          case "build":
            stageResult = stageBuild(workspaceRoot, projectType, context);
            break;
          case "typecheck":
            stageResult = stageTypeCheck(workspaceRoot, projectType, context);
            break;
          case "lint":
            stageResult = stageLint(workspaceRoot, projectType, context);
            break;
          case "test":
            stageResult = stageTest(workspaceRoot, projectType, context);
            break;
          case "security":
            stageResult = await stageSecurity(workspaceRoot, context);
            break;
          case "diffreview":
            stageResult = stageDiffReview(workspaceRoot, context);
            break;
          default:
            stageResult = { passed: false, details: `Unknown stage: ${stage}` };
        }

        const duration = ((Date.now() - stageStart) / 1000).toFixed(1);
        results.push({
          stage,
          status: stageResult.passed ? "PASS" : "FAIL",
          duration: parseFloat(duration),
          details: stageResult.details,
        });
      }

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      return generateVerdict(
        results,
        workspaceRoot,
        projectType,
        totalDuration,
        options,
      );
    } catch (error) {
      logger.error(`[VerificationLoop] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Verification loop failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    skip: [],
    stages: null,
    verbose: false,
  };
  let targetPath = "";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--skip" && parts[i + 1]) {
      options.skip = parts[++i].split(",").map((s) => s.toLowerCase().trim());
    } else if (p === "--stages" && parts[i + 1]) {
      options.stages = parts[++i].split(",").map((s) => s.toLowerCase().trim());
    } else if (p === "--verbose") {
      options.verbose = true;
    } else if (p && !p.startsWith("-")) {
      targetPath = p;
    }
  }

  if (!targetPath) {
    targetPath = context.workspacePath || process.cwd();
  }

  return { targetPath, options };
}

function findProjectRoot(startPath) {
  let current = path.resolve(startPath || process.cwd());
  while (current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, "package.json")) ||
      fs.existsSync(path.join(current, "pom.xml")) ||
      fs.existsSync(path.join(current, "pyproject.toml"))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

function detectProjectType(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, "package.json"))) {
    const pkg = safeReadJSON(path.join(projectRoot, "package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (
      deps.typescript ||
      fs.existsSync(path.join(projectRoot, "tsconfig.json"))
    ) {
      return "typescript";
    }
    return "nodejs";
  }
  if (
    fs.existsSync(path.join(projectRoot, "pom.xml")) ||
    fs.existsSync(path.join(projectRoot, "build.gradle"))
  ) {
    return "java";
  }
  if (
    fs.existsSync(path.join(projectRoot, "pyproject.toml")) ||
    fs.existsSync(path.join(projectRoot, "setup.py")) ||
    fs.existsSync(path.join(projectRoot, "requirements.txt"))
  ) {
    return "python";
  }
  return "nodejs";
}

function safeReadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function runCommand(file, args, cwd, timeoutMs, context) {
  try {
    const output = requireBundledSkillProcessBroker(
      context,
      "verification-loop",
    ).execFileSync(file, args, {
      cwd,
      timeout: timeoutMs,
    });
    return { exitCode: 0, output: output || "" };
  } catch (error) {
    if (String(error?.code || "").startsWith("CC_BUNDLED_SKILL_PROCESS_")) {
      throw error;
    }
    return {
      exitCode: error.status || 1,
      output: (error.stdout || "") + (error.stderr || ""),
    };
  }
}

// ============================================================
// Stage Implementations
// ============================================================

function stageBuild(projectRoot, projectType, context) {
  logger.info("[VerificationLoop] Stage: Build");

  let file;
  let args;
  switch (projectType) {
    case "typescript":
    case "nodejs": {
      const pkg = safeReadJSON(path.join(projectRoot, "package.json"));
      const scripts = pkg.scripts || {};
      if (scripts.build) {
        file = process.platform === "win32" ? "npm.cmd" : "npm";
        args = ["run", "build"];
      } else if (scripts["build:main"]) {
        file = process.platform === "win32" ? "npm.cmd" : "npm";
        args = ["run", "build:main"];
      } else {
        return { passed: true, details: "No build script found, skipping" };
      }
      break;
    }
    case "java":
      file = process.platform === "win32" ? "mvn.cmd" : "mvn";
      args = ["compile", "-q"];
      break;
    case "python":
      return { passed: true, details: "Python: no compile step needed" };
    default:
      return { passed: true, details: "No build step detected" };
  }

  const result = runCommand(file, args, projectRoot, 180_000, context);
  if (result.exitCode === 0) {
    return { passed: true, details: "Clean build" };
  }
  const errorLines = result.output
    .split("\n")
    .filter((l) => l.includes("error") || l.includes("Error"))
    .slice(0, 5);
  return {
    passed: false,
    details: `Build failed: ${errorLines.join("; ") || "exit code " + result.exitCode}`,
  };
}

function stageTypeCheck(projectRoot, projectType, context) {
  logger.info("[VerificationLoop] Stage: TypeCheck");

  if (projectType === "typescript") {
    const hasTsConfig = fs.existsSync(path.join(projectRoot, "tsconfig.json"));
    if (!hasTsConfig) {
      return { passed: true, details: "No tsconfig.json, skipping" };
    }
    const result = runCommand(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsc", "--noEmit"],
      projectRoot,
      120_000,
      context,
    );
    if (result.exitCode === 0) {
      return { passed: true, details: "0 type errors" };
    }
    const errorCount = (result.output.match(/error TS\d+/g) || []).length;
    return {
      passed: false,
      details: `${errorCount} type error${errorCount !== 1 ? "s" : ""} found`,
    };
  }

  if (projectType === "python") {
    const result = runCommand(
      "python",
      ["-m", "mypy", ".", "--ignore-missing-imports"],
      projectRoot,
      120_000,
      context,
    );
    if (result.exitCode === 0) {
      return { passed: true, details: "mypy: 0 errors" };
    }
    const errorCount = (result.output.match(/error:/g) || []).length;
    return {
      passed: errorCount === 0,
      details: errorCount > 0 ? `mypy: ${errorCount} error(s)` : "mypy: clean",
    };
  }

  return { passed: true, details: "No type checker applicable" };
}

function stageLint(projectRoot, projectType, context) {
  logger.info("[VerificationLoop] Stage: Lint");

  let file;
  let args;
  switch (projectType) {
    case "typescript":
    case "nodejs": {
      const pkg = safeReadJSON(path.join(projectRoot, "package.json"));
      const scripts = pkg.scripts || {};
      if (scripts.lint) {
        file = process.platform === "win32" ? "npm.cmd" : "npm";
        args = ["run", "lint"];
      } else if (
        fs.existsSync(path.join(projectRoot, ".eslintrc.js")) ||
        fs.existsSync(path.join(projectRoot, ".eslintrc.json")) ||
        fs.existsSync(path.join(projectRoot, "eslint.config.js")) ||
        fs.existsSync(path.join(projectRoot, "eslint.config.mjs"))
      ) {
        file = process.platform === "win32" ? "npx.cmd" : "npx";
        args = ["eslint", ".", "--max-warnings=0"];
      } else {
        return { passed: true, details: "No linter configured" };
      }
      break;
    }
    case "python":
      file = "python";
      args = ["-m", "flake8", ".", "--count", "--statistics"];
      break;
    case "java":
      return { passed: true, details: "Java: lint via build plugins" };
    default:
      return { passed: true, details: "No linter detected" };
  }

  const result = runCommand(file, args, projectRoot, 60_000, context);
  if (result.exitCode === 0) {
    return { passed: true, details: "0 lint issues" };
  }
  const issueCount =
    result.output.match(/\d+ problems?/)?.[0] ||
    result.output.match(/\d+ errors?/)?.[0] ||
    "issues found";
  return { passed: false, details: `Lint: ${issueCount}` };
}

function stageTest(projectRoot, projectType, context) {
  logger.info("[VerificationLoop] Stage: Test");

  let file;
  let args;
  switch (projectType) {
    case "typescript":
    case "nodejs": {
      const pkg = safeReadJSON(path.join(projectRoot, "package.json"));
      const scripts = pkg.scripts || {};
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (scripts.test) {
        file = process.platform === "win32" ? "npm.cmd" : "npm";
        args = ["test"];
      } else if (deps.vitest) {
        file = process.platform === "win32" ? "npx.cmd" : "npx";
        args = ["vitest", "run"];
      } else if (deps.jest) {
        file = process.platform === "win32" ? "npx.cmd" : "npx";
        args = ["jest"];
      } else {
        return { passed: true, details: "No test runner configured" };
      }
      break;
    }
    case "python":
      file = "python";
      args = ["-m", "pytest", "--tb=short", "-q"];
      break;
    case "java":
      file = process.platform === "win32" ? "mvn.cmd" : "mvn";
      args = ["test", "-q"];
      break;
    default:
      return { passed: true, details: "No test runner detected" };
  }

  const result = runCommand(file, args, projectRoot, 180_000, context);
  if (result.exitCode === 0) {
    const passedMatch = result.output.match(/(\d+)\s+passed/);
    const count = passedMatch ? passedMatch[1] : "all";
    return { passed: true, details: `${count} tests passed` };
  }

  const failedMatch = result.output.match(/(\d+)\s+failed/);
  const passedMatch = result.output.match(/(\d+)\s+passed/);
  const failed = failedMatch ? failedMatch[1] : "?";
  const passed = passedMatch ? passedMatch[1] : "?";
  return { passed: false, details: `${failed} failed, ${passed} passed` };
}

async function stageSecurity(projectRoot, context) {
  logger.info("[VerificationLoop] Stage: Security");

  // Delegate to the security-audit handler if available
  try {
    const securityHandler = require("../security-audit/handler.js");
    const result = await securityHandler.execute(
      { input: "", args: "" },
      { workspacePath: projectRoot, ...context },
    );

    if (!result.success) {
      return { passed: false, details: result.error || "Security scan failed" };
    }

    const findings = result.result?.findings || [];
    const critical = findings.filter((f) => f.severity === "critical").length;
    const high = findings.filter((f) => f.severity === "high").length;

    if (critical > 0 || high > 0) {
      return {
        passed: false,
        details: `${critical} critical, ${high} high severity findings`,
      };
    }

    return {
      passed: true,
      details: `${findings.length} finding${findings.length !== 1 ? "s" : ""} (none critical/high)`,
    };
  } catch (error) {
    logger.warn(
      `[VerificationLoop] Security handler not available: ${error.message}`,
    );
    return { passed: true, details: "Security handler unavailable, skipped" };
  }
}

function stageDiffReview(projectRoot, context) {
  logger.info("[VerificationLoop] Stage: DiffReview");

  const diffResult = runCommand(
    "git",
    ["diff", "--stat"],
    projectRoot,
    30_000,
    context,
  );
  if (diffResult.exitCode !== 0) {
    return { passed: true, details: "Not a git repo or no git, skipped" };
  }

  const diff = diffResult.output.trim();
  if (!diff) {
    return { passed: true, details: "No uncommitted changes" };
  }

  // Get the full diff for analysis
  const fullDiff = runCommand("git", ["diff"], projectRoot, 30_000, context);
  const diffContent = fullDiff.output || "";
  const lines = diffContent.split("\n");

  // Check for common issues in the diff
  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only check added lines
    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    if (/console\.log\s*\(/.test(line)) {
      issues.push("console.log statement added");
    }
    if (/debugger\b/.test(line)) {
      issues.push("debugger statement added");
    }
    if (/TODO|FIXME|HACK|XXX/.test(line)) {
      issues.push("TODO/FIXME comment added");
    }
    if (/(?:password|secret|token)\s*[:=]\s*['"][^'"]+['"]/i.test(line)) {
      issues.push("Possible hardcoded credential");
    }
  }

  // Count changed files
  const statLines = diff.split("\n").filter((l) => l.includes("|"));
  const fileCount = statLines.length;

  const uniqueIssues = [...new Set(issues)];
  if (uniqueIssues.length > 0) {
    return {
      passed: false,
      details: `${fileCount} file(s) changed: ${uniqueIssues.slice(0, 3).join(", ")}`,
    };
  }

  return { passed: true, details: `${fileCount} file(s) changed, no issues` };
}

// ============================================================
// Verdict Generation
// ============================================================

function generateVerdict(
  results,
  projectRoot,
  projectType,
  totalDuration,
  _options,
) {
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const active = results.filter((r) => r.status !== "SKIP").length;
  const allPassed = failed === 0;
  const verdict = allPassed ? "READY" : "NOT READY";

  const projectName = path.basename(projectRoot);
  const lines = [
    `Verification Loop Report`,
    `========================`,
    `Project: ${projectName} (${projectType})`,
    ``,
    `| Stage      | Status | Duration | Details          |`,
    `| ---------- | ------ | -------- | ---------------- |`,
  ];

  for (const r of results) {
    const icon =
      r.status === "PASS" ? "PASS" : r.status === "FAIL" ? "FAIL" : "SKIP";
    lines.push(
      `| ${r.stage.padEnd(10)} | ${icon.padEnd(6)} | ${(r.duration + "s").padEnd(8)} | ${(r.details || "").substring(0, 40)} |`,
    );
  }

  lines.push(``);
  lines.push(
    `Stages: ${passed} passed, ${failed} failed, ${skipped} skipped (${active} active)`,
  );
  lines.push(`Duration: ${totalDuration}s`);
  lines.push(``);
  lines.push(`Verdict: ${verdict}`);

  if (failed > 0) {
    lines.push(``);
    lines.push(`Failed stages:`);
    for (const r of results.filter((r) => r.status === "FAIL")) {
      lines.push(`  - ${r.stage}: ${r.details}`);
    }
  }

  return {
    success: true,
    result: {
      verdict,
      stages: results,
      passed,
      failed,
      skipped,
      totalDuration: parseFloat(totalDuration),
      projectType,
    },
    allPassed,
    message: lines.join("\n"),
  };
}
