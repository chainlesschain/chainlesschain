/**
 * Quick MCP Benchmark - Reduced iterations for faster testing
 */
const { MCPClientManager } = require('../mcp-client-manager');
const MCPPerformanceMonitor = require('../mcp-performance-monitor');
const path = require('path');
const fs = require('fs');

const TEST_CONFIG = {
  iterations: 5,
  warmupIterations: 1,
  testDataPath: path.join(__dirname, 'test-data'),
  servers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(__dirname, 'test-data')]
    }
  }
};

async function runQuickBenchmark() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  MCP QUICK BENCHMARK (5 iterations)');
  console.log('═══════════════════════════════════════════════════\n');

  // Setup test data
  if (!fs.existsSync(TEST_CONFIG.testDataPath)) {
    fs.mkdirSync(TEST_CONFIG.testDataPath, { recursive: true });
  }
  const testFilePath = path.join(TEST_CONFIG.testDataPath, 'test-file.txt');
  fs.writeFileSync(testFilePath, 'This is a test file.\n'.repeat(100));

  const monitor = new MCPPerformanceMonitor();
  let mcpManager = null;

  try {
    // Test 1: Connection
    console.log('📊 TEST 1: Single Connection');
    console.log('─────────────────────────────────────────\n');
    
    mcpManager = new MCPClientManager();
    const connStart = Date.now();
    await mcpManager.connectServer('filesystem', TEST_CONFIG.servers.filesystem);
    const connTime = Date.now() - connStart;
    console.log('  Connection time: ' + connTime + 'ms');
    console.log('  Status: ' + (connTime < 60000 ? '✅ OK' : '⚠️ Slow (npx download)') + '\n');

    // Test 2: Tool calls
    console.log('📊 TEST 2: Tool Calls (5x read_file)');
    console.log('─────────────────────────────────────────\n');
    
    const toolTimes = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await mcpManager.callTool('filesystem', 'read_file', { path: 'test-file.txt' });
      const duration = Date.now() - start;
      toolTimes.push(duration);
      console.log('  Call ' + (i + 1) + ': ' + duration + 'ms');
    }
    
    const avgTime = toolTimes.reduce((a, b) => a + b, 0) / toolTimes.length;
    console.log('\n  Average: ' + avgTime.toFixed(2) + 'ms');
    console.log('  Status: ' + (avgTime < 100 ? '✅ EXCELLENT' : avgTime < 200 ? '✅ ACCEPTABLE' : '⚠️ SLOW') + '\n');

    // Test 3: Direct comparison
    console.log('📊 TEST 3: Direct File Read (Baseline)');
    console.log('─────────────────────────────────────────\n');
    
    const directTimes = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      fs.readFileSync(testFilePath, 'utf-8');
      const duration = Date.now() - start;
      directTimes.push(duration);
    }
    const avgDirect = directTimes.reduce((a, b) => a + b, 0) / directTimes.length;
    console.log('  Average: ' + avgDirect.toFixed(2) + 'ms');
    
    const overhead = avgTime - avgDirect;
    console.log('\n📊 OVERHEAD ANALYSIS');
    console.log('─────────────────────────────────────────');
    console.log('  MCP overhead: ' + overhead.toFixed(2) + 'ms');
    console.log('  Status: ' + (overhead < 50 ? '✅ EXCELLENT' : overhead < 100 ? '✅ ACCEPTABLE' : '⚠️ NEEDS REVIEW') + '\n');

    // Summary
    console.log('═══════════════════════════════════════════════════');
    console.log('  QUICK BENCHMARK SUMMARY');
    console.log('═══════════════════════════════════════════════════');
    console.log('  Connection: ' + connTime + 'ms (first time includes npx download)');
    console.log('  Tool call avg: ' + avgTime.toFixed(2) + 'ms');
    console.log('  MCP overhead: ' + overhead.toFixed(2) + 'ms');
    console.log('  Result: ' + (overhead < 100 ? '✅ POC VIABLE' : '⚠️ NEEDS OPTIMIZATION'));
    console.log('═══════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Benchmark failed:', error.message);
    console.error(error.stack);
  } finally {
    if (mcpManager) {
      await mcpManager.shutdown();
    }
  }
}

runQuickBenchmark().catch(console.error);
