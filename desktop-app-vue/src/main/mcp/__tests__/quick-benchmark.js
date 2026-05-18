/**
 * Quick MCP Benchmark - Reduced iterations for faster testing
 */
const { logger } = require("../../utils/logger.js");
const { MCPClientManager } = require("../mcp-client-manager");
const MCPPerformanceMonitor = require("../mcp-performance-monitor");
const path = require("path");
const fs = require("fs");

const TEST_CONFIG = {
  iterations: 5,
  warmupIterations: 1,
  testDataPath: path.join(__dirname, "test-data"),
  servers: {
    filesystem: {
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        path.join(__dirname, "test-data"),
      ],
    },
  },
};

async function runQuickBenchmark() {
  logger.info("\n═══════════════════════════════════════════════════");
  logger.info("  MCP QUICK BENCHMARK (5 iterations)");
  logger.info("═══════════════════════════════════════════════════\n");

  // Setup test data
  if (!fs.existsSync(TEST_CONFIG.testDataPath)) {
    fs.mkdirSync(TEST_CONFIG.testDataPath, { recursive: true });
  }
  const testFilePath = path.join(TEST_CONFIG.testDataPath, "test-file.txt");
  fs.writeFileSync(testFilePath, "This is a test file.\n".repeat(100));

  const monitor = new MCPPerformanceMonitor();
  let mcpManager = null;

  try {
    // Test 1: Connection
    logger.info("📊 TEST 1: Single Connection");
    logger.info("─────────────────────────────────────────\n");

    mcpManager = new MCPClientManager();
    const connStart = Date.now();
    await mcpManager.connectServer(
      "filesystem",
      TEST_CONFIG.servers.filesystem,
    );
    const connTime = Date.now() - connStart;
    logger.info("  Connection time: " + connTime + "ms");
    logger.info(
      "  Status: " +
        (connTime < 60000 ? "✅ OK" : "⚠️ Slow (npx download)") +
        "\n",
    );

    // Test 2: Tool calls
    logger.info("📊 TEST 2: Tool Calls (5x read_file)");
    logger.info("─────────────────────────────────────────\n");

    const toolTimes = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await mcpManager.callTool("filesystem", "read_file", {
        path: "test-file.txt",
      });
      const duration = Date.now() - start;
      toolTimes.push(duration);
      logger.info("  Call " + (i + 1) + ": " + duration + "ms");
    }

    const avgTime = toolTimes.reduce((a, b) => a + b, 0) / toolTimes.length;
    logger.info("\n  Average: " + avgTime.toFixed(2) + "ms");
    logger.info(
      "  Status: " +
        (avgTime < 100
          ? "✅ EXCELLENT"
          : avgTime < 200
            ? "✅ ACCEPTABLE"
            : "⚠️ SLOW") +
        "\n",
    );

    // Test 3: Direct comparison
    logger.info("📊 TEST 3: Direct File Read (Baseline)");
    logger.info("─────────────────────────────────────────\n");

    const directTimes = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      fs.readFileSync(testFilePath, "utf-8");
      const duration = Date.now() - start;
      directTimes.push(duration);
    }
    const avgDirect =
      directTimes.reduce((a, b) => a + b, 0) / directTimes.length;
    logger.info("  Average: " + avgDirect.toFixed(2) + "ms");

    const overhead = avgTime - avgDirect;
    logger.info("\n📊 OVERHEAD ANALYSIS");
    logger.info("─────────────────────────────────────────");
    logger.info("  MCP overhead: " + overhead.toFixed(2) + "ms");
    logger.info(
      "  Status: " +
        (overhead < 50
          ? "✅ EXCELLENT"
          : overhead < 100
            ? "✅ ACCEPTABLE"
            : "⚠️ NEEDS REVIEW") +
        "\n",
    );

    // Summary
    logger.info("═══════════════════════════════════════════════════");
    logger.info("  QUICK BENCHMARK SUMMARY");
    logger.info("═══════════════════════════════════════════════════");
    logger.info(
      "  Connection: " + connTime + "ms (first time includes npx download)",
    );
    logger.info("  Tool call avg: " + avgTime.toFixed(2) + "ms");
    logger.info("  MCP overhead: " + overhead.toFixed(2) + "ms");
    logger.info(
      "  Result: " +
        (overhead < 100 ? "✅ POC VIABLE" : "⚠️ NEEDS OPTIMIZATION"),
    );
    logger.info("═══════════════════════════════════════════════════\n");
  } catch (error) {
    logger.error("\n❌ Benchmark failed:", error.message);
    logger.error(error.stack);
  } finally {
    if (mcpManager) {
      await mcpManager.shutdown();
    }
  }
}

runQuickBenchmark().catch(console.error);
