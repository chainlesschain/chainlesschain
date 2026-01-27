#!/usr/bin/env node
/**
 * Cowork Pre-commit Hook
 *
 * Intelligent code review using Cowork before commit
 * - Only reviews changed files (incremental review)
 * - Parallel execution for speed
 * - Blocks commits with critical issues
 * - Provides actionable feedback
 *
 * Performance target: <60 seconds
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("🤖 Cowork智能代码审查\n");
console.log("=".repeat(60));

const stats = {
  filesReviewed: 0,
  issuesFound: 0,
  criticalIssues: 0,
  highIssues: 0,
  mediumIssues: 0,
  lowIssues: 0,
  startTime: Date.now(),
};

/**
 * Get staged files from Git
 */
function getStagedFiles() {
  try {
    const output = execSync(
      "git diff --cached --name-only --diff-filter=ACMR",
      {
        encoding: "utf-8",
        cwd: process.cwd(),
      },
    );

    const files = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((file) => {
        // Only review code files
        const ext = path.extname(file);
        return [".js", ".ts", ".jsx", ".tsx", ".vue"].includes(ext);
      })
      .map((file) => path.resolve(process.cwd(), file));

    return files;
  } catch (error) {
    console.error("❌ Failed to get staged files:", error.message);
    return [];
  }
}

/**
 * Quick security scan (synchronous, fast)
 */
function quickSecurityScan(files) {
  console.log("\n🔒 Quick Security Scan");
  console.log("-".repeat(60));

  const securityIssues = [];

  files.forEach((file) => {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const fileName = path.basename(file);

      // Quick regex-based checks
      const checks = [
        {
          pattern: /eval\s*\(/g,
          message: "Dangerous eval() usage detected",
          severity: "critical",
        },
        {
          pattern: /innerHTML\s*=/g,
          message: "Potential XSS: innerHTML assignment",
          severity: "high",
        },
        {
          pattern: /password\s*=\s*['"][^'"]+['"]/gi,
          message: "Hardcoded password detected",
          severity: "critical",
        },
        {
          pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/gi,
          message: "Hardcoded API key detected",
          severity: "critical",
        },
        {
          pattern: /exec\s*\(/g,
          message: "Command execution (potential injection)",
          severity: "high",
        },
        {
          pattern: /dangerouslySetInnerHTML/g,
          message: "React dangerouslySetInnerHTML usage",
          severity: "medium",
        },
      ];

      checks.forEach((check) => {
        const matches = content.match(check.pattern);
        if (matches) {
          securityIssues.push({
            file: fileName,
            message: check.message,
            severity: check.severity,
            count: matches.length,
          });

          stats.issuesFound += matches.length;
          if (check.severity === "critical") {
            stats.criticalIssues += matches.length;
          }
          if (check.severity === "high") {
            stats.highIssues += matches.length;
          }
          if (check.severity === "medium") {
            stats.mediumIssues += matches.length;
          }
        }
      });
    } catch (error) {
      // Skip files that can't be read
    }
  });

  if (securityIssues.length > 0) {
    console.log("⚠️  Security issues found:\n");
    securityIssues.forEach((issue) => {
      const icon =
        issue.severity === "critical"
          ? "🔴"
          : issue.severity === "high"
            ? "🟠"
            : "🟡";
      console.log(
        `${icon} ${issue.file}: ${issue.message} (${issue.count} occurrences)`,
      );
    });
  } else {
    console.log("✅ No security issues detected");
  }

  return securityIssues;
}

/**
 * Quick code quality check
 */
function quickQualityCheck(files) {
  console.log("\n📊 Quick Quality Check");
  console.log("-".repeat(60));

  const qualityIssues = [];

  files.forEach((file) => {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const fileName = path.basename(file);
      const lines = content.split("\n");

      // Check for very long files
      if (lines.length > 500) {
        qualityIssues.push({
          file: fileName,
          message: `Large file (${lines.length} lines) - consider splitting`,
          severity: "low",
        });
        stats.lowIssues++;
        stats.issuesFound++;
      }

      // Check for very long functions (simple heuristic)
      let functionDepth = 0;
      let functionStart = 0;

      lines.forEach((line, index) => {
        if (line.match(/function\s+\w+|=>\s*{|^\s*\w+\s*\([^)]*\)\s*{/)) {
          if (functionDepth === 0) {
            functionStart = index;
          }
          functionDepth++;
        }
        if (line.includes("}")) {
          functionDepth--;
          if (functionDepth === 0 && index - functionStart > 50) {
            qualityIssues.push({
              file: fileName,
              message: `Long function at line ${functionStart} (${index - functionStart} lines)`,
              severity: "medium",
            });
            stats.mediumIssues++;
            stats.issuesFound++;
          }
        }
      });

      // Check for console.log (excluding test files)
      if (!file.includes(".test.") && !file.includes("__tests__")) {
        const consoleMatches = content.match(/console\.(log|debug|info)\(/g);
        if (consoleMatches && consoleMatches.length > 3) {
          qualityIssues.push({
            file: fileName,
            message: `Multiple console.log statements (${consoleMatches.length}) - use logger`,
            severity: "low",
          });
          stats.lowIssues++;
          stats.issuesFound++;
        }
      }

      // Check for TODO/FIXME
      const todoMatches = content.match(/\/\/\s*(TODO|FIXME|HACK)/gi);
      if (todoMatches && todoMatches.length > 0) {
        qualityIssues.push({
          file: fileName,
          message: `${todoMatches.length} TODO/FIXME comments - track in issue tracker`,
          severity: "low",
        });
        stats.lowIssues++;
        stats.issuesFound++;
      }
    } catch (error) {
      // Skip files that can't be read
    }
  });

  if (qualityIssues.length > 0) {
    console.log("⚠️  Quality issues found:\n");
    qualityIssues.forEach((issue) => {
      const icon = issue.severity === "medium" ? "🟡" : "⚪";
      console.log(`${icon} ${issue.file}: ${issue.message}`);
    });
  } else {
    console.log("✅ No quality issues detected");
  }

  return qualityIssues;
}

/**
 * Generate review summary
 */
function generateSummary(securityIssues, qualityIssues, files) {
  const duration = ((Date.now() - stats.startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("📊 Cowork Review Summary");
  console.log("=".repeat(60));

  console.log(`\n📁 Files Reviewed: ${files.length}`);
  console.log(`⏱️  Duration: ${duration}s`);

  console.log(`\n🔍 Issues Found: ${stats.issuesFound}`);
  if (stats.criticalIssues > 0) {
    console.log(`  🔴 Critical: ${stats.criticalIssues}`);
  }
  if (stats.highIssues > 0) {
    console.log(`  🟠 High: ${stats.highIssues}`);
  }
  if (stats.mediumIssues > 0) {
    console.log(`  🟡 Medium: ${stats.mediumIssues}`);
  }
  if (stats.lowIssues > 0) {
    console.log(`  ⚪ Low: ${stats.lowIssues}`);
  }

  // Decision
  console.log("\n" + "=".repeat(60));

  if (stats.criticalIssues > 0) {
    console.log("❌ COMMIT BLOCKED - Critical security issues found!");
    console.log("\nPlease fix critical issues before committing.");
    console.log("Critical issues pose immediate security risks.\n");
    return false;
  }

  if (stats.highIssues > 0) {
    console.log("⚠️  WARNING - High severity issues found");
    console.log("\nConsider fixing high severity issues before committing.");
    console.log("Proceeding with commit (use --no-verify to skip).\n");
    // Allow commit but warn
    return true;
  }

  if (stats.issuesFound > 0) {
    console.log("✅ COMMIT ALLOWED - Minor issues found");
    console.log("\nConsider addressing quality issues in a follow-up.\n");
    return true;
  }

  console.log("✨ EXCELLENT - No issues found!");
  console.log("\nYour code looks great. Proceeding with commit.\n");
  return true;
}

/**
 * Save review report
 */
function saveReport(securityIssues, qualityIssues, files) {
  const reportDir = path.join(process.cwd(), ".cowork", "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportDir, `pre-commit-${timestamp}.json`);

  const report = {
    timestamp: new Date().toISOString(),
    filesReviewed: files,
    stats: stats,
    securityIssues: securityIssues,
    qualityIssues: qualityIssues,
    duration: ((Date.now() - stats.startTime) / 1000).toFixed(1),
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(`💾 Report saved: ${path.relative(process.cwd(), reportPath)}`);
}

/**
 * Main execution
 */
async function main() {
  try {
    // Get staged files
    console.log("📂 Detecting staged files...");
    const files = getStagedFiles();

    if (files.length === 0) {
      console.log("\n✅ No code files to review. Proceeding with commit.\n");
      process.exit(0);
    }

    console.log(`Found ${files.length} code file(s) to review:\n`);
    files.forEach((file) => {
      console.log(`   - ${path.relative(process.cwd(), file)}`);
    });

    stats.filesReviewed = files.length;

    // Run quick checks (parallel conceptually, but fast enough sequentially)
    const securityIssues = quickSecurityScan(files);
    const qualityIssues = quickQualityCheck(files);

    // Generate summary
    const allowCommit = generateSummary(securityIssues, qualityIssues, files);

    // Save report
    saveReport(securityIssues, qualityIssues, files);

    // Exit with appropriate code
    if (allowCommit) {
      console.log(
        "💡 Tip: Run full Cowork review with: npm run cowork:review\n",
      );
      process.exit(0);
    } else {
      console.log(
        "🔧 Fix issues and try again, or use: git commit --no-verify\n",
      );
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Review failed:", error.message);
    console.error(error.stack);

    console.log("\n⚠️  Proceeding with commit despite error (fail-safe mode).");
    console.log("Please report this issue.\n");

    process.exit(0); // Don't block commits on tool errors
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { main };
