#!/usr/bin/env node
/**
 * Cowork CI Intelligent Test Selector
 *
 * Optimized for GitHub Actions CI/CD environment
 * - Detects changed files in PR
 * - Maps changes to affected tests
 * - Always includes critical tests
 * - Dramatically reduces CI test execution time
 *
 * Performance: Run 10-30% of tests instead of 100%
 * Expected savings: 10-15 min per PR
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("🧪 Cowork CI智能测试选择\n");
console.log("=".repeat(60));

const stats = {
  changedFiles: 0,
  selectedTests: 0,
  skippedTests: 0,
  estimatedTimeSaved: 0,
};

/**
 * Get changed files from Git (CI environment)
 * Compares PR head against base branch
 */
function getChangedFilesCI() {
  try {
    // CI environment: compare PR against base branch
    const baseBranch = process.env.GITHUB_BASE_REF || "main";
    const command = `git diff --name-only origin/${baseBranch}...HEAD --diff-filter=ACMR`;

    console.log(`\n📂 Detecting changed files (base: origin/${baseBranch})...`);

    const output = execSync(command, {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    const files = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((file) => path.normalize(file));

    return files;
  } catch (error) {
    console.error("⚠️  Could not get Git diff:", error.message);
    console.error("Falling back to all tests...");
    return [];
  }
}

/**
 * Map source file to test files
 * Supports multiple test location patterns
 */
function mapSourceToTests(sourceFile) {
  const tests = [];

  // Get file info
  const ext = path.extname(sourceFile);
  const basename = path.basename(sourceFile, ext);
  const dirname = path.dirname(sourceFile);

  // Pattern 1: Co-located test (same directory)
  const colocatedTest = path.join(dirname, `${basename}.test${ext}`);
  if (fs.existsSync(colocatedTest)) {
    tests.push(colocatedTest);
  }

  // Pattern 2: __tests__ folder in same directory
  const testsDir1 = path.join(dirname, "__tests__", `${basename}.test${ext}`);
  if (fs.existsSync(testsDir1)) {
    tests.push(testsDir1);
  }

  // Pattern 3: tests/unit/ mirror structure
  // Handle both src/main and src/renderer paths
  let relativePath = "";
  if (dirname.includes("src/main")) {
    relativePath = path.relative("src/main", dirname);
  } else if (dirname.includes("src/renderer")) {
    relativePath = path.relative("src/renderer", dirname);
  } else if (dirname.includes("src")) {
    relativePath = path.relative("src", dirname);
  }

  if (relativePath) {
    const testsDir2 = path.join(
      "tests",
      "unit",
      relativePath,
      `${basename}.test${ext}`,
    );
    if (fs.existsSync(testsDir2)) {
      tests.push(testsDir2);
    }
  }

  // Pattern 4: Vitest convention (*.spec.js)
  const specTest = path.join(dirname, `${basename}.spec${ext}`);
  if (fs.existsSync(specTest)) {
    tests.push(specTest);
  }

  return tests;
}

/**
 * Find tests affected by changed files
 */
function findAffectedTests(changedFiles) {
  console.log("\n📂 Analyzing changed files...");

  const affectedTests = new Set();
  const testFiles = [];
  const sourceFiles = [];

  changedFiles.forEach((file) => {
    // Skip non-code files
    const ext = path.extname(file);
    if (![".js", ".ts", ".jsx", ".tsx", ".vue"].includes(ext)) {
      return;
    }

    // Skip workflow and config files
    if (file.includes(".github/") || file.includes("node_modules/")) {
      return;
    }

    // If it's already a test file, include it
    if (
      file.includes(".test.") ||
      file.includes(".spec.") ||
      file.includes("__tests__")
    ) {
      testFiles.push(file);
      affectedTests.add(file);
      return;
    }

    // It's a source file - find related tests
    sourceFiles.push(file);
    const relatedTests = mapSourceToTests(file);
    relatedTests.forEach((test) => affectedTests.add(test));
  });

  console.log(`   Source files changed: ${sourceFiles.length}`);
  console.log(`   Test files changed: ${testFiles.length}`);
  console.log(
    `   Related tests found: ${affectedTests.size - testFiles.length}`,
  );

  return Array.from(affectedTests);
}

/**
 * Get all test files for baseline
 */
function getAllTestFiles() {
  const testDirs = [
    "tests/unit",
    "tests/integration",
    "src/main/**/__tests__",
    "src/renderer/**/__tests__",
  ];

  const allTests = [];

  testDirs.forEach((pattern) => {
    try {
      const files = findTestFilesRecursive(pattern);
      allTests.push(...files);
    } catch (error) {
      // Directory might not exist
    }
  });

  return allTests;
}

/**
 * Recursively find test files
 */
function findTestFilesRecursive(dir) {
  const tests = [];

  if (!fs.existsSync(dir)) {
    return tests;
  }

  const items = fs.readdirSync(dir);

  items.forEach((item) => {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      tests.push(...findTestFilesRecursive(fullPath));
    } else if (item.match(/\.(test|spec)\.(js|ts|jsx|tsx)$/)) {
      tests.push(fullPath);
    }
  });

  return tests;
}

/**
 * Add critical tests (always run in CI)
 */
function addCriticalTests(selectedTests) {
  console.log("\n🔒 Adding critical tests (always run in CI)...");

  const criticalPatterns = [
    "tests/unit/database.test.js",
    "tests/unit/config.test.js",
    "tests/unit/llm/llm-service.test.js",
    "tests/unit/rag/rag-engine.test.js",
    "tests/unit/did/did-manager.test.js",
  ];

  criticalPatterns.forEach((pattern) => {
    if (fs.existsSync(pattern)) {
      if (!selectedTests.includes(pattern)) {
        selectedTests.push(pattern);
        console.log(`   + ${pattern}`);
      }
    }
  });

  return selectedTests;
}

/**
 * Load test exclusion config
 */
function loadExclusionConfig() {
  const configPath = path.join(process.cwd(), ".cowork", "ci-test-config.json");

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return config.exclusions || [];
    } catch (error) {
      console.warn("⚠️  Could not load exclusion config:", error.message);
      return [];
    }
  }

  // Fallback to hardcoded exclusions (same as test.yml)
  return [
    "**/media/ocr-service.test.js",
    "**/mcp/**",
    "**/p2p/**",
    "**/ukey/**",
    "**/blockchain/**",
    "**/components/**",
    "**/import/**",
    "**/extended-tools*.test.js",
    "**/*-ipc.test.js",
    "**/llm/session-manager*.test.js",
    "**/llm/llm-performance.test.js",
    "**/tools/tool-manager.test.js",
    "**/ai/skill-manager.test.js",
    "**/document/word-engine.test.js",
    "**/media/image-engine.test.js",
    "**/did/did-invitation.test.js",
    "**/core/ipc-guard.test.js",
    "**/security/permission-system.test.js",
    "**/api/**",
    "**/pages/**",
    "**/stores/**",
    "**/sync/**",
    "**/ai/builtin-tools.test.js",
    "**/document/pdf-engine.test.js",
    "**/document/ppt-engine.test.js",
    "**/integration/p2p-sync-engine.test.js",
    "**/components/planning-components.test.js",
    "**/pages/PlanningView.test.js",
    "**/core/function-caller.test.js",
    "**/core/response-parser.test.js",
    "**/media/speech-recognizer.test.js",
    "**/planning/task-planner*.test.js",
    "**/planning/taskPlanner.test.js",
    "**/src/main/**/__tests__/**",
    "**/src/renderer/**/__tests__/**",
    "**/tests/integration/**",
  ];
}

/**
 * Apply test exclusions
 */
function applyExclusions(selectedTests) {
  const exclusions = loadExclusionConfig();

  if (exclusions.length === 0) {
    return selectedTests;
  }

  console.log(`\n🚫 Applying ${exclusions.length} test exclusions...`);

  const filtered = selectedTests.filter((test) => {
    for (const pattern of exclusions) {
      // Simple glob matching (simplified)
      const regex = new RegExp(
        pattern
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^/]*")
          .replace(/\./g, "\\."),
      );

      if (regex.test(test)) {
        return false; // Exclude this test
      }
    }
    return true; // Keep this test
  });

  const excluded = selectedTests.length - filtered.length;
  console.log(`   Excluded: ${excluded} tests`);

  return filtered;
}

/**
 * Generate test execution command
 */
function generateTestCommand(selectedTests) {
  if (selectedTests.length === 0) {
    console.log("\n⚠️  No tests selected. Running default test suite.");
    return "npx vitest run tests/unit";
  }

  // Build command with relative paths
  const testPaths = selectedTests
    .map((t) => path.relative(process.cwd(), t))
    .map((t) => `"${t.replace(/\\/g, "/")}"`) // Use forward slashes for cross-platform
    .join(" ");

  return `npx vitest run ${testPaths}`;
}

/**
 * Estimate time saved
 */
function estimateTimeSaved(selectedTests, allTests) {
  const avgTestTime = 0.5; // seconds per test (estimate)

  const selectedTime = selectedTests.length * avgTestTime;
  const totalTime = allTests.length * avgTestTime;
  const timeSaved = totalTime - selectedTime;
  const percentSaved =
    allTests.length > 0 ? ((timeSaved / totalTime) * 100).toFixed(1) : 0;

  stats.estimatedTimeSaved = timeSaved;

  return {
    selectedTime,
    totalTime,
    timeSaved,
    percentSaved,
  };
}

/**
 * Generate summary
 */
function generateSummary(selectedTests, allTests, changedFiles) {
  console.log("\n" + "=".repeat(60));
  console.log("📊 CI Test Selection Summary");
  console.log("=".repeat(60));

  console.log(`\n📁 Changed Files: ${changedFiles.length}`);
  console.log(`🧪 Selected Tests: ${selectedTests.length}`);
  console.log(`📦 Total Tests Available: ${allTests.length}`);

  const { selectedTime, totalTime, timeSaved, percentSaved } =
    estimateTimeSaved(selectedTests, allTests);

  console.log(`\n⏱️  Estimated Time:`);
  console.log(`   Selected tests: ${selectedTime.toFixed(0)}s`);
  console.log(`   Full test suite: ${totalTime.toFixed(0)}s`);
  console.log(`   Time saved: ${timeSaved.toFixed(0)}s (${percentSaved}%)`);

  if (selectedTests.length > 0 && selectedTests.length < 20) {
    console.log(`\n📋 Selected Test Files:\n`);
    selectedTests.forEach((test) => {
      console.log(`   - ${path.relative(process.cwd(), test)}`);
    });
  } else if (selectedTests.length >= 20) {
    console.log(`\n📋 Selected Test Files (first 15):\n`);
    selectedTests.slice(0, 15).forEach((test) => {
      console.log(`   - ${path.relative(process.cwd(), test)}`);
    });
    console.log(`   ... and ${selectedTests.length - 15} more`);
  }

  console.log("\n" + "=".repeat(60));
}

/**
 * Output for GitHub Actions
 */
function setGitHubOutput(key, value) {
  // GitHub Actions output format
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  } else {
    console.log(`::set-output name=${key}::${value}`);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");

    // Get changed files (CI mode)
    const changedFiles = getChangedFilesCI();

    if (changedFiles.length === 0) {
      console.log("\n⚠️  No changed files detected.");
      console.log("Running default stable test suite.\n");

      // Output for GitHub Actions
      setGitHubOutput("test-mode", "default");
      setGitHubOutput("test-count", "0");

      if (!dryRun) {
        // Run default stable tests (same as test.yml)
        const defaultCommand = "npx vitest run tests/unit";
        console.log(`🚀 Executing: ${defaultCommand}\n`);
        execSync(defaultCommand, { stdio: "inherit", cwd: process.cwd() });
      }

      process.exit(0);
    }

    console.log(`Found ${changedFiles.length} changed file(s)\n`);
    stats.changedFiles = changedFiles.length;

    // Find affected tests
    const affectedTests = findAffectedTests(changedFiles);

    // Add critical tests
    let selectedTests = addCriticalTests(affectedTests);

    // Apply exclusions
    selectedTests = applyExclusions(selectedTests);

    stats.selectedTests = selectedTests.length;

    // Get all tests for comparison
    const allTests = getAllTestFiles();
    stats.skippedTests = allTests.length - selectedTests.length;

    // Generate summary
    generateSummary(selectedTests, allTests, changedFiles);

    // Generate command
    const command = generateTestCommand(selectedTests);

    // Output for GitHub Actions
    setGitHubOutput("test-mode", "intelligent");
    setGitHubOutput("test-count", selectedTests.length.toString());
    setGitHubOutput("test-command", command);

    if (command) {
      console.log(`\n🚀 Test Command:\n${command}\n`);

      if (!dryRun) {
        try {
          console.log("▶️  Running selected tests...\n");
          execSync(command, { stdio: "inherit", cwd: process.cwd() });
          console.log("\n✅ All selected tests passed!\n");
          process.exit(0);
        } catch (error) {
          console.log("\n❌ Some tests failed.\n");
          process.exit(1);
        }
      } else {
        console.log("(Dry run - not executing)\n");
        process.exit(0);
      }
    } else {
      console.log("\n⚠️  No command generated. Exiting.\n");
      process.exit(0);
    }
  } catch (error) {
    console.error("\n❌ CI test selection failed:", error.message);
    console.error(error.stack);

    console.log("\n⚠️  Falling back to default test suite.\n");

    // Fallback: run default tests
    try {
      setGitHubOutput("test-mode", "fallback");
      setGitHubOutput("test-count", "0");

      execSync("npx vitest run tests/unit", { stdio: "inherit" });
      process.exit(0);
    } catch (testError) {
      process.exit(1);
    }
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  getChangedFilesCI,
  findAffectedTests,
  generateTestCommand,
  addCriticalTests,
};
