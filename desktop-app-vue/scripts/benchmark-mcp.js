#!/usr/bin/env node
/**
 * MCP Performance Benchmark Script
 *
 * Measures performance metrics for MCP server connections and tool calls.
 *
 * Usage:
 *   node scripts/benchmark-mcp.js [options]
 *
 * Options:
 *   --server <name>     Specific server to benchmark (default: filesystem)
 *   --iterations <n>    Number of iterations (default: 100)
 *   --warmup <n>        Warmup iterations (default: 10)
 *   --output <file>     Output results to JSON file
 *   --verbose           Show detailed output
 *
 * @module MCPBenchmark
 */

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  server: "filesystem",
  iterations: 100,
  warmup: 10,
  output: null,
  verbose: false,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--server":
      options.server = args[++i];
      break;
    case "--iterations":
      options.iterations = parseInt(args[++i], 10);
      break;
    case "--warmup":
      options.warmup = parseInt(args[++i], 10);
      break;
    case "--output":
      options.output = args[++i];
      break;
    case "--verbose":
      options.verbose = true;
      break;
    case "--help":
      console.log(`
MCP Performance Benchmark

Usage:
  node scripts/benchmark-mcp.js [options]

Options:
  --server <name>     Specific server to benchmark (default: filesystem)
  --iterations <n>    Number of iterations (default: 100)
  --warmup <n>        Warmup iterations (default: 10)
  --output <file>     Output results to JSON file
  --verbose           Show detailed output
  --help              Show this help message
`);
      process.exit(0);
  }
}

// Import MCP modules
let MCPClientManager;
try {
  MCPClientManager = require("../src/main/mcp/mcp-client-manager");
} catch (error) {
  console.error("Failed to import MCPClientManager:", error.message);
  console.log("\nMake sure you have built the project: npm run build:main\n");
  process.exit(1);
}

/**
 * Performance metrics collection
 */
class PerformanceCollector {
  constructor() {
    this.metrics = {
      connectionTime: [],
      toolCallLatency: [],
      errors: [],
    };
  }

  addConnectionTime(ms) {
    this.metrics.connectionTime.push(ms);
  }

  addToolCallLatency(ms) {
    this.metrics.toolCallLatency.push(ms);
  }

  addError(error) {
    this.metrics.errors.push({
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }

  getStatistics(data) {
    if (data.length === 0) return null;

    const sorted = [...data].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = sum / sorted.length;

    return {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: avg.toFixed(2),
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      stdDev: Math.sqrt(
        sorted.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) /
          sorted.length,
      ).toFixed(2),
    };
  }

  getReport() {
    return {
      connectionTime: this.getStatistics(this.metrics.connectionTime),
      toolCallLatency: this.getStatistics(this.metrics.toolCallLatency),
      errors: this.metrics.errors,
      errorRate:
        this.metrics.errors.length /
        (this.metrics.toolCallLatency.length + this.metrics.errors.length),
    };
  }
}

/**
 * Setup test environment
 */
function setupTestEnvironment() {
  const testDataPath = path.join(__dirname, "../test-data/mcp-benchmark");

  // Create test directory
  if (!fs.existsSync(testDataPath)) {
    fs.mkdirSync(testDataPath, { recursive: true });
  }

  // Create test files
  const testFiles = [
    { name: "small.txt", size: 100 },
    { name: "medium.txt", size: 10000 },
    { name: "large.txt", size: 100000 },
  ];

  for (const file of testFiles) {
    const filePath = path.join(testDataPath, file.name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "x".repeat(file.size));
    }
  }

  return testDataPath;
}

/**
 * Cleanup test environment
 */
function cleanupTestEnvironment() {
  const testDataPath = path.join(__dirname, "../test-data/mcp-benchmark");
  if (fs.existsSync(testDataPath)) {
    fs.rmSync(testDataPath, { recursive: true, force: true });
  }
}

/**
 * Run benchmark
 */
async function runBenchmark() {
  console.log("=".repeat(60));
  console.log("MCP Performance Benchmark");
  console.log("=".repeat(60));
  console.log(`Server: ${options.server}`);
  console.log(`Iterations: ${options.iterations}`);
  console.log(`Warmup: ${options.warmup}`);
  console.log("=".repeat(60));
  console.log("");

  const collector = new PerformanceCollector();
  const testDataPath = setupTestEnvironment();
  let manager;

  try {
    manager = new MCPClientManager({});

    // Benchmark connection time
    console.log("Benchmarking connection time...");
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await manager.connectServer(`bench-${i}`, {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", testDataPath],
        transport: "stdio",
      });
      const elapsed = Date.now() - start;
      collector.addConnectionTime(elapsed);

      if (options.verbose) {
        console.log(`  Connection ${i + 1}: ${elapsed}ms`);
      }

      await manager.disconnectServer(`bench-${i}`);
    }

    // Connect for tool benchmarks
    console.log("\nConnecting for tool benchmarks...");
    await manager.connectServer("benchmark", {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", testDataPath],
      transport: "stdio",
    });

    // Warmup
    console.log(`\nWarming up (${options.warmup} iterations)...`);
    for (let i = 0; i < options.warmup; i++) {
      try {
        await manager.callTool("benchmark", "read_file", {
          path: "small.txt",
        });
      } catch (error) {
        // Ignore warmup errors
      }
    }

    // Benchmark tool calls
    console.log(
      `\nBenchmarking tool calls (${options.iterations} iterations)...`,
    );
    const progressInterval = Math.floor(options.iterations / 10);

    for (let i = 0; i < options.iterations; i++) {
      try {
        const start = Date.now();
        await manager.callTool("benchmark", "read_file", {
          path: "small.txt",
        });
        const elapsed = Date.now() - start;
        collector.addToolCallLatency(elapsed);

        if (options.verbose && (i + 1) % progressInterval === 0) {
          console.log(
            `  Progress: ${i + 1}/${options.iterations} (${elapsed}ms)`,
          );
        }
      } catch (error) {
        collector.addError(error);
        if (options.verbose) {
          console.log(`  Error at iteration ${i + 1}: ${error.message}`);
        }
      }
    }

    // Get report
    const report = collector.getReport();

    // Print results
    console.log("\n" + "=".repeat(60));
    console.log("RESULTS");
    console.log("=".repeat(60));

    console.log("\nConnection Time:");
    if (report.connectionTime) {
      console.log(`  Min:    ${report.connectionTime.min}ms`);
      console.log(`  Max:    ${report.connectionTime.max}ms`);
      console.log(`  Avg:    ${report.connectionTime.avg}ms`);
      console.log(`  Median: ${report.connectionTime.median}ms`);
      console.log(`  P95:    ${report.connectionTime.p95}ms`);
      console.log(`  P99:    ${report.connectionTime.p99}ms`);
    }

    console.log("\nTool Call Latency:");
    if (report.toolCallLatency) {
      console.log(`  Count:  ${report.toolCallLatency.count}`);
      console.log(`  Min:    ${report.toolCallLatency.min}ms`);
      console.log(`  Max:    ${report.toolCallLatency.max}ms`);
      console.log(`  Avg:    ${report.toolCallLatency.avg}ms`);
      console.log(`  Median: ${report.toolCallLatency.median}ms`);
      console.log(`  P95:    ${report.toolCallLatency.p95}ms`);
      console.log(`  P99:    ${report.toolCallLatency.p99}ms`);
      console.log(`  StdDev: ${report.toolCallLatency.stdDev}ms`);
    }

    console.log("\nErrors:");
    console.log(`  Count:  ${report.errors.length}`);
    console.log(`  Rate:   ${(report.errorRate * 100).toFixed(2)}%`);

    // Performance assessment
    console.log("\n" + "=".repeat(60));
    console.log("PERFORMANCE ASSESSMENT");
    console.log("=".repeat(60));

    const assessments = [];

    if (report.connectionTime) {
      const connAvg = parseFloat(report.connectionTime.avg);
      if (connAvg < 500) {
        assessments.push("✅ Connection time: EXCELLENT (<500ms)");
      } else if (connAvg < 1000) {
        assessments.push("✅ Connection time: ACCEPTABLE (<1s)");
      } else {
        assessments.push("❌ Connection time: POOR (>1s)");
      }
    }

    if (report.toolCallLatency) {
      const latAvg = parseFloat(report.toolCallLatency.avg);
      if (latAvg < 100) {
        assessments.push("✅ Tool call latency: EXCELLENT (<100ms)");
      } else if (latAvg < 200) {
        assessments.push("✅ Tool call latency: ACCEPTABLE (<200ms)");
      } else {
        assessments.push("❌ Tool call latency: POOR (>200ms)");
      }
    }

    if (report.errorRate < 0.01) {
      assessments.push("✅ Error rate: EXCELLENT (<1%)");
    } else if (report.errorRate < 0.05) {
      assessments.push("✅ Error rate: ACCEPTABLE (<5%)");
    } else {
      assessments.push("❌ Error rate: POOR (>5%)");
    }

    assessments.forEach((a) => console.log(a));

    // Save to file if requested
    if (options.output) {
      const fullReport = {
        timestamp: new Date().toISOString(),
        options,
        results: report,
        assessments,
      };

      fs.writeFileSync(options.output, JSON.stringify(fullReport, null, 2));
      console.log(`\nResults saved to: ${options.output}`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("Benchmark completed!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\nBenchmark failed:", error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (manager) {
      await manager.shutdown();
    }
    cleanupTestEnvironment();
  }
}

// Run benchmark
runBenchmark().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
