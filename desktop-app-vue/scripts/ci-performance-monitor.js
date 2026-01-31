#!/usr/bin/env node
/**
 * CI Performance Monitor
 *
 * Tracks CI/CD pipeline performance metrics over time
 * - Workflow duration
 * - Cache hit rates
 * - Test selection efficiency
 * - Cost analysis
 * - Trend visualization
 *
 * Usage: node scripts/ci-performance-monitor.js [options]
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("📊 CI Performance Monitor\n");
console.log("=".repeat(60));

/**
 * Get recent workflow runs from GitHub CLI
 */
function getWorkflowRuns(workflow = "test.yml", limit = 30) {
  try {
    console.log(`\n📂 Fetching workflow runs (${workflow}, last ${limit})...`);

    const command = `gh run list --workflow=${workflow} --limit=${limit} --json conclusion,startedAt,updatedAt,headBranch,headSha,event,status`;

    const output = execSync(command, {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    const runs = JSON.parse(output);
    console.log(`   Found ${runs.length} workflow runs`);

    return runs;
  } catch (error) {
    console.error("❌ Failed to fetch workflow runs:", error.message);
    console.error("Make sure GitHub CLI (gh) is installed and authenticated.");
    return [];
  }
}

/**
 * Calculate workflow duration
 */
function calculateDuration(startedAt, updatedAt) {
  const start = new Date(startedAt);
  const end = new Date(updatedAt);
  const durationMs = end - start;
  const durationSec = Math.floor(durationMs / 1000);
  const durationMin = (durationSec / 60).toFixed(1);

  return {
    milliseconds: durationMs,
    seconds: durationSec,
    minutes: parseFloat(durationMin),
  };
}

/**
 * Analyze workflow performance
 */
function analyzeWorkflows(runs) {
  console.log("\n📊 Analyzing workflow performance...");

  const metrics = {
    total: runs.length,
    successful: 0,
    failed: 0,
    cancelled: 0,
    totalDuration: 0,
    avgDuration: 0,
    minDuration: Infinity,
    maxDuration: 0,
    durations: [],
  };

  runs.forEach((run) => {
    // Count by status
    if (run.conclusion === "success") {
      metrics.successful++;
    } else if (run.conclusion === "failure") {
      metrics.failed++;
    } else if (run.conclusion === "cancelled") {
      metrics.cancelled++;
    }

    // Calculate duration
    if (run.startedAt && run.updatedAt) {
      const duration = calculateDuration(run.startedAt, run.updatedAt);
      metrics.durations.push({
        date: run.startedAt,
        branch: run.headBranch,
        duration: duration.minutes,
        conclusion: run.conclusion,
      });

      metrics.totalDuration += duration.minutes;
      metrics.minDuration = Math.min(metrics.minDuration, duration.minutes);
      metrics.maxDuration = Math.max(metrics.maxDuration, duration.minutes);
    }
  });

  if (metrics.durations.length > 0) {
    metrics.avgDuration = (
      metrics.totalDuration / metrics.durations.length
    ).toFixed(1);
  }

  return metrics;
}

/**
 * Read cache performance from reports
 */
function analyzeCachePerformance() {
  console.log("\n💾 Analyzing cache performance...");

  const reportsDir = path.join(process.cwd(), ".cowork", "reports");

  if (!fs.existsSync(reportsDir)) {
    console.log("   No reports directory found. Skipping cache analysis.");
    return null;
  }

  const reportFiles = fs
    .readdirSync(reportsDir)
    .filter((f) => f.startsWith("ci-performance-"))
    .sort()
    .slice(-30); // Last 30 reports

  if (reportFiles.length === 0) {
    console.log("   No cache performance reports found.");
    return null;
  }

  let totalRuns = 0;
  let cacheHits = 0;
  let cacheMisses = 0;

  reportFiles.forEach((file) => {
    try {
      const content = fs.readFileSync(path.join(reportsDir, file), "utf-8");
      const data = JSON.parse(content);

      if (data.cache) {
        totalRuns++;
        if (data.cache.hit) {
          cacheHits++;
        } else {
          cacheMisses++;
        }
      }
    } catch (error) {
      // Skip invalid files
    }
  });

  const hitRate =
    totalRuns > 0 ? ((cacheHits / totalRuns) * 100).toFixed(1) : 0;

  return {
    totalRuns,
    cacheHits,
    cacheMisses,
    hitRate: parseFloat(hitRate),
  };
}

/**
 * Read test selection efficiency from reports
 */
function analyzeTestSelection() {
  console.log("\n🧪 Analyzing test selection efficiency...");

  const reportsDir = path.join(process.cwd(), ".cowork", "reports");

  if (!fs.existsSync(reportsDir)) {
    console.log("   No reports directory found. Skipping test analysis.");
    return null;
  }

  const reportFiles = fs
    .readdirSync(reportsDir)
    .filter((f) => f.startsWith("test-selection-"))
    .sort()
    .slice(-30); // Last 30 reports

  if (reportFiles.length === 0) {
    console.log("   No test selection reports found.");
    return null;
  }

  let totalRuns = 0;
  let totalSelected = 0;
  let totalAvailable = 0;
  let totalTimeSaved = 0;

  reportFiles.forEach((file) => {
    try {
      const content = fs.readFileSync(path.join(reportsDir, file), "utf-8");
      const data = JSON.parse(content);

      if (data.selectedTests !== undefined && data.totalTests !== undefined) {
        totalRuns++;
        totalSelected += data.selectedTests;
        totalAvailable += data.totalTests;
        if (data.timeSaved) {
          totalTimeSaved += data.timeSaved;
        }
      }
    } catch (error) {
      // Skip invalid files
    }
  });

  const avgSelected = totalRuns > 0 ? Math.round(totalSelected / totalRuns) : 0;
  const avgAvailable =
    totalRuns > 0 ? Math.round(totalAvailable / totalRuns) : 0;
  const reductionRate =
    avgAvailable > 0 ? ((1 - avgSelected / avgAvailable) * 100).toFixed(1) : 0;
  const avgTimeSaved =
    totalRuns > 0 ? (totalTimeSaved / totalRuns).toFixed(0) : 0;

  return {
    totalRuns,
    avgSelected,
    avgAvailable,
    reductionRate: parseFloat(reductionRate),
    avgTimeSaved: parseFloat(avgTimeSaved),
  };
}

/**
 * Calculate cost savings (GitHub Actions pricing)
 */
function calculateCostSavings(beforeAvgMin, afterAvgMin, runsPerMonth = 250) {
  // GitHub Actions pricing: $0.008 per minute (Linux)
  const costPerMinute = 0.008;

  const beforeCost = beforeAvgMin * costPerMinute;
  const afterCost = afterAvgMin * costPerMinute;
  const savingsPerRun = beforeCost - afterCost;
  const savingsPerMonth = savingsPerRun * runsPerMonth;
  const savingsPerYear = savingsPerMonth * 12;

  return {
    beforeCost: beforeCost.toFixed(3),
    afterCost: afterCost.toFixed(3),
    savingsPerRun: savingsPerRun.toFixed(3),
    savingsPerMonth: savingsPerMonth.toFixed(2),
    savingsPerYear: savingsPerYear.toFixed(2),
    percentSaved: ((savingsPerRun / beforeCost) * 100).toFixed(1),
  };
}

/**
 * Generate performance report
 */
function generateReport(workflows, cache, testSelection) {
  console.log("\n" + "=".repeat(60));
  console.log("📊 CI Performance Report");
  console.log("=".repeat(60));

  // Workflow Performance
  console.log("\n🚀 Workflow Performance:");
  console.log(`   Total Runs: ${workflows.total}`);
  console.log(
    `   Successful: ${workflows.successful} (${((workflows.successful / workflows.total) * 100).toFixed(1)}%)`,
  );
  console.log(
    `   Failed: ${workflows.failed} (${((workflows.failed / workflows.total) * 100).toFixed(1)}%)`,
  );
  console.log(`   Cancelled: ${workflows.cancelled}`);
  console.log(`\n   Duration Statistics:`);
  console.log(`   Average: ${workflows.avgDuration} min`);
  console.log(`   Min: ${workflows.minDuration.toFixed(1)} min`);
  console.log(`   Max: ${workflows.maxDuration.toFixed(1)} min`);

  // Cache Performance
  if (cache) {
    console.log("\n💾 Cache Performance:");
    console.log(`   Total Runs: ${cache.totalRuns}`);
    console.log(`   Cache Hits: ${cache.cacheHits}`);
    console.log(`   Cache Misses: ${cache.cacheMisses}`);
    console.log(`   Hit Rate: ${cache.hitRate}%`);

    if (cache.hitRate >= 70) {
      console.log("   ✅ Cache performance is EXCELLENT (target: >70%)");
    } else if (cache.hitRate >= 50) {
      console.log("   ⚠️  Cache performance is GOOD (target: >70%)");
    } else {
      console.log("   ❌ Cache performance is POOR (target: >70%)");
    }
  }

  // Test Selection
  if (testSelection) {
    console.log("\n🧪 Test Selection Efficiency:");
    console.log(`   Total Runs: ${testSelection.totalRuns}`);
    console.log(`   Avg Selected Tests: ${testSelection.avgSelected}`);
    console.log(`   Avg Total Tests: ${testSelection.avgAvailable}`);
    console.log(`   Test Reduction: ${testSelection.reductionRate}%`);
    console.log(`   Avg Time Saved: ${testSelection.avgTimeSaved}s per run`);

    if (testSelection.reductionRate >= 70) {
      console.log("   ✅ Test selection is EXCELLENT (target: 70-90%)");
    } else if (testSelection.reductionRate >= 50) {
      console.log("   ⚠️  Test selection is GOOD (target: 70-90%)");
    } else {
      console.log("   ❌ Test selection is POOR (target: 70-90%)");
    }
  }

  // Cost Savings (estimate)
  console.log("\n💰 Cost Analysis (Estimated):");
  const beforeAvg = 45; // Baseline: 30-60 min
  const afterAvg = parseFloat(workflows.avgDuration);
  const savings = calculateCostSavings(beforeAvg, afterAvg);

  console.log(
    `   Before Optimization: $${savings.beforeCost}/run (${beforeAvg} min)`,
  );
  console.log(
    `   After Optimization: $${savings.afterCost}/run (${afterAvg} min)`,
  );
  console.log(
    `   Savings: $${savings.savingsPerRun}/run (${savings.percentSaved}%)`,
  );
  console.log(
    `   Monthly Savings: $${savings.savingsPerMonth} (250 runs/month)`,
  );
  console.log(`   Annual Savings: $${savings.savingsPerYear}`);

  console.log("\n" + "=".repeat(60));

  return {
    workflows,
    cache,
    testSelection,
    savings,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Save report to file
 */
function saveReport(report) {
  const reportsDir = path.join(process.cwd(), ".cowork", "reports");

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .split("T")[0];
  const reportPath = path.join(reportsDir, `ci-performance-${timestamp}.json`);

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(`\n💾 Report saved: ${path.relative(process.cwd(), reportPath)}`);
}

/**
 * Generate trend chart (ASCII)
 */
function generateTrendChart(workflows) {
  console.log("\n📈 Duration Trend (Last 30 runs):");
  console.log("=".repeat(60));

  // Take last 15 runs for chart
  const recentRuns = workflows.durations.slice(-15);

  if (recentRuns.length === 0) {
    console.log("   No data available");
    return;
  }

  // Find max for scaling
  const maxDuration = Math.max(...recentRuns.map((r) => r.duration));
  const scale = 40 / maxDuration; // 40 chars wide

  recentRuns.forEach((run, idx) => {
    const barLength = Math.round(run.duration * scale);
    const bar = "█".repeat(barLength);
    const status = run.conclusion === "success" ? "✅" : "❌";
    console.log(
      `   ${String(idx + 1).padStart(2)}: ${bar} ${run.duration} min ${status}`,
    );
  });

  console.log(
    "\n   Average: " +
      "─".repeat(Math.round(workflows.avgDuration * scale)) +
      ` ${workflows.avgDuration} min`,
  );
  console.log("=".repeat(60));
}

/**
 * Main execution
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const workflow = args.includes("--workflow")
      ? args[args.indexOf("--workflow") + 1]
      : "test.yml";
    const limit = args.includes("--limit")
      ? parseInt(args[args.indexOf("--limit") + 1])
      : 30;
    const noSave = args.includes("--no-save");

    // Fetch workflow runs
    const runs = getWorkflowRuns(workflow, limit);

    if (runs.length === 0) {
      console.log("\n⚠️  No workflow runs found. Exiting.\n");
      process.exit(0);
    }

    // Analyze performance
    const workflows = analyzeWorkflows(runs);
    const cache = analyzeCachePerformance();
    const testSelection = analyzeTestSelection();

    // Generate report
    const report = generateReport(workflows, cache, testSelection);

    // Generate trend chart
    generateTrendChart(workflows);

    // Save report
    if (!noSave) {
      saveReport(report);
    }

    console.log("\n✅ Performance analysis complete!\n");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Performance monitoring failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  getWorkflowRuns,
  analyzeWorkflows,
  analyzeCachePerformance,
  analyzeTestSelection,
  calculateCostSavings,
};
