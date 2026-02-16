/**
 * Test & Fix Skill Handler
 *
 * Detects test framework, runs test suites, parses failure output,
 * and provides structured reports. Implements the test-then-fix loop
 * pattern inspired by Aider.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const TEST_RUNNERS = {
  vitest: {
    name: "Vitest",
    configs: ["vitest.config.ts", "vitest.config.js", "vitest.config.mts"],
    runCmd: "npx vitest run --reporter=json",
    runFileCmd: "npx vitest run --reporter=json",
    lang: "js/ts",
  },
  jest: {
    name: "Jest",
    configs: ["jest.config.js", "jest.config.ts", "jest.config.cjs"],
    runCmd: "npx jest --json",
    runFileCmd: "npx jest --json",
    lang: "js/ts",
  },
  pytest: {
    name: "Pytest",
    configs: ["pytest.ini", "pyproject.toml", "setup.cfg"],
    runCmd: "python -m pytest --tb=short -q",
    runFileCmd: "python -m pytest --tb=short -q",
    lang: "python",
  },
};

const MAX_ITERATIONS = 5;

module.exports = {
  async init(skill) {
    logger.info("[TestAndFix] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { targetPath, options } = parseInput(input, context);

    logger.info(`[TestAndFix] Target: ${targetPath}`, { options });

    try {
      const workspaceRoot =
        context.workspacePath || findProjectRoot(targetPath);
      const runner = options.runner
        ? TEST_RUNNERS[options.runner]
        : detectTestRunner(workspaceRoot);

      if (!runner) {
        return {
          success: false,
          message:
            "No test framework detected. Supported: Vitest, Jest, Pytest.",
        };
      }

      return await handleTestRun(runner, targetPath, workspaceRoot, options);
    } catch (error) {
      logger.error(`[TestAndFix] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Test run failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    sourceOnly: false,
    testOnly: false,
    affectedBy: null,
    maxIterations: MAX_ITERATIONS,
    runner: null,
  };
  let targetPath = "";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--source-only") {
      options.sourceOnly = true;
    } else if (p === "--test-only") {
      options.testOnly = true;
    } else if (p === "--affected-by") {
      options.affectedBy = parts[++i];
    } else if (p === "--max-iterations") {
      options.maxIterations = parseInt(parts[++i]) || MAX_ITERATIONS;
    } else if (p === "--runner") {
      options.runner = parts[++i];
    } else if (p && !p.startsWith("-")) {
      targetPath = p;
    }
  }

  return { targetPath, options };
}

function findProjectRoot(startPath) {
  let current = path.resolve(startPath || process.cwd());
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

function detectTestRunner(projectRoot) {
  for (const [key, runner] of Object.entries(TEST_RUNNERS)) {
    for (const config of runner.configs) {
      if (fs.existsSync(path.join(projectRoot, config))) {
        return { ...runner, key, detectedConfig: config };
      }
    }
  }

  // Check package.json for jest or vitest
  const pkgPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const devDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (devDeps.vitest) {
        return {
          ...TEST_RUNNERS.vitest,
          key: "vitest",
          detectedConfig: "package.json",
        };
      }
      if (devDeps.jest) {
        return {
          ...TEST_RUNNERS.jest,
          key: "jest",
          detectedConfig: "package.json",
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function runTests(runner, targetPath, projectRoot) {
  const cmd = targetPath
    ? `${runner.runFileCmd} "${targetPath}"`
    : runner.runCmd;

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      cwd: projectRoot,
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return parseTestOutput(output, runner.key);
  } catch (error) {
    const output = (error.stdout || "") + (error.stderr || "");
    return parseTestOutput(output, runner.key);
  }
}

function parseTestOutput(output, runnerKey) {
  const result = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
    duration: 0,
  };

  if (runnerKey === "vitest" || runnerKey === "jest") {
    // Try JSON
    try {
      const jsonStart = output.indexOf("{");
      if (jsonStart >= 0) {
        const data = JSON.parse(output.substring(jsonStart));
        if (data.testResults) {
          // Jest format
          result.total = data.numTotalTests || 0;
          result.passed = data.numPassedTests || 0;
          result.failed = data.numFailedTests || 0;
          result.skipped =
            (data.numPendingTests || 0) + (data.numTodoTests || 0);

          for (const suite of data.testResults) {
            for (const test of suite.testResults || []) {
              if (test.status === "failed") {
                result.failures.push({
                  testFile: suite.testFilePath
                    ? path.basename(suite.testFilePath)
                    : "unknown",
                  testName: test.fullName || test.title,
                  message: (test.failureMessages || [])
                    .join("\n")
                    .substring(0, 500),
                });
              }
            }
          }
          return result;
        }

        if (data.numTotalTests !== undefined) {
          // Vitest format
          result.total = data.numTotalTests || 0;
          result.passed = data.numPassedTests || 0;
          result.failed = data.numFailedTests || 0;
          return result;
        }
      }
    } catch {
      // Fall through
    }

    // Text fallback
    const summaryMatch = output.match(
      /Tests?\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed/,
    );
    if (summaryMatch) {
      result.failed = parseInt(summaryMatch[1]);
      result.passed = parseInt(summaryMatch[2]);
      result.total = result.failed + result.passed;
    } else {
      const passedMatch = output.match(/(\d+)\s+passed/);
      const failedMatch = output.match(/(\d+)\s+failed/);
      if (passedMatch) {
        result.passed = parseInt(passedMatch[1]);
      }
      if (failedMatch) {
        result.failed = parseInt(failedMatch[1]);
      }
      result.total = result.passed + result.failed;
    }

    // Extract failure details from text
    const failBlocks = output.split(/FAIL\s+/);
    for (let i = 1; i < failBlocks.length && i <= 10; i++) {
      const block = failBlocks[i];
      const lines = block.split("\n");
      const testFile = lines[0]?.trim() || "unknown";
      const errLine = lines.find(
        (l) => l.includes("Error:") || l.includes("expect("),
      );
      result.failures.push({
        testFile: path.basename(testFile),
        testName: testFile,
        message: (errLine || lines.slice(0, 3).join("\n")).substring(0, 300),
      });
    }
  } else if (runnerKey === "pytest") {
    const summaryMatch = output.match(/(\d+)\s+passed(?:.*?(\d+)\s+failed)?/);
    if (summaryMatch) {
      result.passed = parseInt(summaryMatch[1]);
      result.failed = summaryMatch[2] ? parseInt(summaryMatch[2]) : 0;
      result.total = result.passed + result.failed;
    }
  }

  return result;
}

async function handleTestRun(runner, targetPath, projectRoot, options) {
  const testResult = runTests(runner, targetPath, projectRoot);

  const lines = [
    `Test & Fix Report`,
    `=================`,
    `Runner: ${runner.name}`,
    `Config: ${runner.detectedConfig || "auto"}`,
    targetPath ? `Target: ${targetPath}` : `Target: all tests`,
    ``,
    `Results: ${testResult.total} tests`,
    `  ✅ ${testResult.passed} passed`,
  ];

  if (testResult.failed > 0) {
    lines.push(`  ❌ ${testResult.failed} failed`);
  }

  if (testResult.skipped > 0) {
    lines.push(`  ⏭️ ${testResult.skipped} skipped`);
  }

  if (testResult.failures.length > 0) {
    lines.push("", "Failures:");
    for (const f of testResult.failures.slice(0, 10)) {
      lines.push(`  ❌ ${f.testFile}: ${f.testName}`);
      if (f.message) {
        lines.push(`     ${f.message.split("\n")[0]}`);
      }
    }

    if (testResult.failures.length > 10) {
      lines.push(`  ... and ${testResult.failures.length - 10} more failures`);
    }

    if (options.sourceOnly) {
      lines.push(
        "",
        "Mode: --source-only (modify source code only, not tests)",
      );
    } else if (options.testOnly) {
      lines.push("", "Mode: --test-only (update test assertions only)");
    }
  }

  const allPassed = testResult.failed === 0;
  lines.push(
    "",
    `Status: ${allPassed ? "✅ All tests passed!" : `❌ ${testResult.failed} tests need fixing`}`,
  );

  return {
    success: true,
    result: testResult,
    allPassed,
    message: lines.join("\n"),
  };
}
