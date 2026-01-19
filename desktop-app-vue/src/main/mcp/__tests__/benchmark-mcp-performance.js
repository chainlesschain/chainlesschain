/**
 * MCP Performance Benchmark
 *
 * Measures performance of MCP operations and compares with direct calls.
 * Run with: node src/main/mcp/__tests__/benchmark-mcp-performance.js
 */

const { logger, createLogger } = require('../../utils/logger.js');
const { MCPClientManager } = require('../mcp-client-manager');
const MCPPerformanceMonitor = require('../mcp-performance-monitor');
const path = require('path');
const fs = require('fs');

// Test configuration
const TEST_CONFIG = {
  iterations: 100,           // Number of iterations per test
  warmupIterations: 10,      // Warmup iterations (not counted)
  testDataPath: path.join(__dirname, 'test-data'),
  servers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(__dirname, 'test-data')]
    }
  }
};

class MCPBenchmark {
  constructor() {
    this.monitor = new MCPPerformanceMonitor();
    this.mcpManager = null;
    this.results = {
      directCall: [],
      mcpCall: [],
      overhead: []
    };
  }

  async setup() {
    logger.info('\n🔧 Setting up benchmark environment...\n');

    // Ensure test data directory exists
    if (!fs.existsSync(TEST_CONFIG.testDataPath)) {
      fs.mkdirSync(TEST_CONFIG.testDataPath, { recursive: true });
    }

    // Create test file
    const testFilePath = path.join(TEST_CONFIG.testDataPath, 'test-file.txt');
    fs.writeFileSync(testFilePath, 'This is a test file for MCP benchmarking.\n'.repeat(100));

    logger.info('✅ Test environment ready\n');
  }

  async cleanup() {
    logger.info('\n🧹 Cleaning up...\n');

    if (this.mcpManager) {
      await this.mcpManager.shutdown();
    }

    logger.info('✅ Cleanup complete\n');
  }

  /**
   * Benchmark 1: Connection time
   */
  async benchmarkConnection() {
    logger.info('📊 BENCHMARK 1: Connection Time');
    logger.info('─────────────────────────────────────────\n');

    const times = [];

    for (let i = 0; i < TEST_CONFIG.iterations; i++) {
      const manager = new MCPClientManager();
      const startTime = Date.now();

      try {
        await manager.connectServer('filesystem', TEST_CONFIG.servers.filesystem);
        const duration = Date.now() - startTime;
        times.push(duration);

        this.monitor.recordConnection('filesystem', duration, true);

        await manager.shutdown();

      } catch (error) {
        logger.error(`❌ Connection failed:`, error.message);
        this.monitor.recordConnection('filesystem', Date.now() - startTime, false);
      }

      // Progress indicator
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`  Progress: ${i + 1}/${TEST_CONFIG.iterations}\r`);
      }
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const p95 = this._percentile(times, 95);

    logger.info(`\n  Results:`);
    logger.info(`    Avg: ${avg.toFixed(2)}ms`);
    logger.info(`    Min: ${min}ms`);
    logger.info(`    Max: ${max}ms`);
    logger.info(`    P95: ${p95.toFixed(2)}ms`);
    logger.info();
  }

  /**
   * Benchmark 2: Direct file read (baseline)
   */
  async benchmarkDirectFileRead() {
    logger.info('📊 BENCHMARK 2: Direct File Read (Baseline)');
    logger.info('─────────────────────────────────────────\n');

    const testFilePath = path.join(TEST_CONFIG.testDataPath, 'test-file.txt');
    const times = [];

    // Warmup
    for (let i = 0; i < TEST_CONFIG.warmupIterations; i++) {
      fs.readFileSync(testFilePath, 'utf-8');
    }

    // Actual benchmark
    for (let i = 0; i < TEST_CONFIG.iterations; i++) {
      const startTime = Date.now();
      fs.readFileSync(testFilePath, 'utf-8');
      const duration = Date.now() - startTime;
      times.push(duration);

      this.results.directCall.push(duration);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    this.monitor.setBaseline('directCall', avg);

    logger.info(`  Results:`);
    logger.info(`    Avg: ${avg.toFixed(2)}ms`);
    logger.info(`    Min: ${min}ms`);
    logger.info(`    Max: ${max}ms`);
    logger.info();
  }

  /**
   * Benchmark 3: MCP file read
   */
  async benchmarkMCPFileRead() {
    logger.info('📊 BENCHMARK 3: MCP File Read');
    logger.info('─────────────────────────────────────────\n');

    // Connect to MCP server
    this.mcpManager = new MCPClientManager();
    await this.mcpManager.connectServer('filesystem', TEST_CONFIG.servers.filesystem);

    const times = [];

    // Warmup
    for (let i = 0; i < TEST_CONFIG.warmupIterations; i++) {
      try {
        await this.mcpManager.callTool('filesystem', 'read_file', {
          path: 'test-file.txt'
        });
      } catch (error) {
        // Ignore warmup errors
      }
    }

    // Actual benchmark
    for (let i = 0; i < TEST_CONFIG.iterations; i++) {
      const startTime = Date.now();

      try {
        await this.mcpManager.callTool('filesystem', 'read_file', {
          path: 'test-file.txt'
        });

        const duration = Date.now() - startTime;
        times.push(duration);
        this.results.mcpCall.push(duration);

        this.monitor.recordToolCall('filesystem', 'read_file', duration, true);

      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`❌ MCP call failed:`, error.message);
        this.monitor.recordToolCall('filesystem', 'read_file', duration, false);
      }

      // Progress indicator
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`  Progress: ${i + 1}/${TEST_CONFIG.iterations}\r`);
      }
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const p95 = this._percentile(times, 95);

    this.monitor.setBaseline('stdioCall', avg);

    logger.info(`\n  Results:`);
    logger.info(`    Avg: ${avg.toFixed(2)}ms`);
    logger.info(`    Min: ${min}ms`);
    logger.info(`    Max: ${max}ms`);
    logger.info(`    P95: ${p95.toFixed(2)}ms`);
    logger.info();
  }

  /**
   * Calculate overhead
   */
  calculateOverhead() {
    logger.info('📊 BENCHMARK 4: Overhead Analysis');
    logger.info('─────────────────────────────────────────\n');

    if (this.results.directCall.length === 0 || this.results.mcpCall.length === 0) {
      logger.info('  ⚠️  Insufficient data for overhead calculation\n');
      return;
    }

    // Calculate per-call overhead
    for (let i = 0; i < Math.min(this.results.directCall.length, this.results.mcpCall.length); i++) {
      const overhead = this.results.mcpCall[i] - this.results.directCall[i];
      this.results.overhead.push(overhead);
    }

    const avgDirect = this.results.directCall.reduce((a, b) => a + b, 0) / this.results.directCall.length;
    const avgMCP = this.results.mcpCall.reduce((a, b) => a + b, 0) / this.results.mcpCall.length;
    const avgOverhead = avgMCP - avgDirect;
    const overheadPercent = (avgOverhead / avgDirect) * 100;

    const minOverhead = Math.min(...this.results.overhead);
    const maxOverhead = Math.max(...this.results.overhead);
    const p95Overhead = this._percentile(this.results.overhead, 95);

    logger.info(`  Direct Call Avg: ${avgDirect.toFixed(2)}ms`);
    logger.info(`  MCP Call Avg: ${avgMCP.toFixed(2)}ms`);
    logger.info();
    logger.info(`  Overhead:`);
    logger.info(`    Avg: ${avgOverhead.toFixed(2)}ms (${overheadPercent.toFixed(1)}%)`);
    logger.info(`    Min: ${minOverhead.toFixed(2)}ms`);
    logger.info(`    Max: ${maxOverhead.toFixed(2)}ms`);
    logger.info(`    P95: ${p95Overhead.toFixed(2)}ms`);
    logger.info();

    // Performance assessment
    logger.info(`  Assessment:`);
    if (avgOverhead < 50) {
      logger.info(`    ✅ EXCELLENT - Overhead < 50ms`);
    } else if (avgOverhead < 100) {
      logger.info(`    ✅ ACCEPTABLE - Overhead < 100ms`);
    } else if (avgOverhead < 200) {
      logger.info(`    ⚠️  MARGINAL - Overhead < 200ms`);
    } else {
      logger.info(`    ❌ UNACCEPTABLE - Overhead > 200ms`);
    }
    logger.info();
  }

  /**
   * Generate final report
   */
  generateReport() {
    logger.info('═══════════════════════════════════════════════════');
    logger.info('  BENCHMARK SUMMARY');
    logger.info('═══════════════════════════════════════════════════\n');

    logger.info(this.monitor.generateReport());

    logger.info('\n📈 POC SUCCESS CRITERIA EVALUATION\n');
    logger.info('─────────────────────────────────────────\n');

    const summary = this.monitor.getSummary();
    const overhead = this.monitor.baselines.overhead;

    const criteria = [
      {
        name: 'Connection Time',
        target: '< 500ms',
        acceptable: '< 1s',
        actual: summary.connections.avgTime.toFixed(2) + 'ms',
        passed: summary.connections.avgTime < 500
      },
      {
        name: 'Tool Call Latency',
        target: '< 100ms',
        acceptable: '< 200ms',
        actual: this.monitor.baselines.stdioCall.toFixed(2) + 'ms',
        passed: this.monitor.baselines.stdioCall < 100
      },
      {
        name: 'stdio Overhead',
        target: '< 50ms',
        acceptable: '< 100ms',
        actual: overhead.toFixed(2) + 'ms',
        passed: overhead < 50
      },
      {
        name: 'Error Rate',
        target: '< 1%',
        acceptable: '< 5%',
        actual: ((summary.toolCalls.failed / summary.toolCalls.total) * 100).toFixed(1) + '%',
        passed: (summary.toolCalls.failed / summary.toolCalls.total) < 0.01
      }
    ];

    criteria.forEach(c => {
      const status = c.passed ? '✅' : '❌';
      logger.info(`  ${status} ${c.name}`);
      logger.info(`      Target: ${c.target} | Acceptable: ${c.acceptable}`);
      logger.info(`      Actual: ${c.actual}`);
      logger.info();
    });

    const passedCount = criteria.filter(c => c.passed).length;
    const totalCount = criteria.length;

    logger.info('─────────────────────────────────────────\n');
    logger.info(`  Overall: ${passedCount}/${totalCount} criteria met\n`);

    if (passedCount === totalCount) {
      logger.info('  🎉 POC SUCCESSFUL - All criteria met!\n');
    } else if (passedCount >= totalCount * 0.75) {
      logger.info('  ✅ POC PASSED - Most criteria met\n');
    } else {
      logger.info('  ⚠️  POC NEEDS IMPROVEMENT\n');
    }

    logger.info('═══════════════════════════════════════════════════\n');
  }

  /**
   * Run all benchmarks
   */
  async run() {
    logger.info('\n');
    logger.info('═══════════════════════════════════════════════════');
    logger.info('  MCP PERFORMANCE BENCHMARK');
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`  Iterations: ${TEST_CONFIG.iterations}`);
    logger.info(`  Warmup: ${TEST_CONFIG.warmupIterations}`);
    logger.info('═══════════════════════════════════════════════════\n');

    try {
      await this.setup();

      await this.benchmarkConnection();
      await this.benchmarkDirectFileRead();
      await this.benchmarkMCPFileRead();
      this.calculateOverhead();

      this.generateReport();

    } catch (error) {
      logger.error('\n❌ Benchmark failed:', error);
      logger.error(error.stack);

    } finally {
      await this.cleanup();
    }
  }

  _percentile(arr, p) {
    if (arr.length === 0) {return 0;}
    const sorted = arr.slice().sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index];
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  const benchmark = new MCPBenchmark();
  benchmark.run().catch(err => {
    logger.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = MCPBenchmark;
