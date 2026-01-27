/**
 * 远程控制系统性能基准测试
 *
 * 测试日志记录、统计收集的性能
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const CommandLogger = require('../src/main/remote/logging/command-logger');
const BatchedCommandLogger = require('../src/main/remote/logging/batched-command-logger');
const { applyDatabaseOptimizations } = require('../src/main/remote/logging/performance-config');

console.log('================================================');
console.log('远程控制系统性能基准测试');
console.log('================================================\n');

// 测试数据库路径
const testDbPath = path.join(__dirname, '../tests/fixtures/benchmark.db');

/**
 * 创建测试数据库
 */
function createTestDatabase() {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const db = new Database(testDbPath);
  applyDatabaseOptimizations(db);
  return db;
}

/**
 * 生成测试日志
 */
function generateTestLog(index) {
  return {
    requestId: `req-${index}`,
    deviceDid: `did:key:device${index % 10}`,
    deviceName: `Device ${index % 10}`,
    namespace: index % 2 === 0 ? 'ai' : 'system',
    action: index % 2 === 0 ? 'chat' : 'getStatus',
    params: { test: `param-${index}` },
    result: { test: `result-${index}` },
    status: index % 10 === 0 ? 'failure' : 'success',
    level: 'info',
    duration: Math.floor(Math.random() * 1000),
    timestamp: Date.now()
  };
}

/**
 * 测试标准日志记录器性能
 */
async function benchmarkStandardLogger(logCount) {
  console.log(`\n[标准日志记录器] 测试 ${logCount} 条日志...`);
  console.log('─'.repeat(50));

  const db = createTestDatabase();
  const logger = new CommandLogger(db, { enableAutoCleanup: false });

  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  for (let i = 0; i < logCount; i++) {
    logger.log(generateTestLog(i));
  }

  const duration = Date.now() - startTime;
  const endMemory = process.memoryUsage().heapUsed;
  const memoryUsed = (endMemory - startMemory) / 1024 / 1024;

  // 验证数据
  const count = db.prepare('SELECT COUNT(*) as count FROM remote_command_logs').get();

  db.close();

  console.log(`✅ 完成`);
  console.log(`  总耗时: ${duration}ms`);
  console.log(`  平均耗时: ${(duration / logCount).toFixed(2)}ms/条`);
  console.log(`  吞吐量: ${Math.floor((logCount / duration) * 1000)} 条/秒`);
  console.log(`  内存使用: ${memoryUsed.toFixed(2)} MB`);
  console.log(`  数据库记录数: ${count.count}`);

  return {
    type: 'standard',
    duration,
    avgTime: duration / logCount,
    throughput: (logCount / duration) * 1000,
    memoryUsed,
    recordCount: count.count
  };
}

/**
 * 测试批处理日志记录器性能
 */
async function benchmarkBatchedLogger(logCount) {
  console.log(`\n[批处理日志记录器] 测试 ${logCount} 条日志...`);
  console.log('─'.repeat(50));

  const db = createTestDatabase();
  const logger = new BatchedCommandLogger(db, { enableAutoCleanup: false });

  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  for (let i = 0; i < logCount; i++) {
    logger.log(generateTestLog(i));
  }

  // 等待批处理完成
  await logger.forceFlush();

  const duration = Date.now() - startTime;
  const endMemory = process.memoryUsage().heapUsed;
  const memoryUsed = (endMemory - startMemory) / 1024 / 1024;

  // 获取性能统计
  const perfStats = logger.getPerformanceStats();

  // 验证数据
  const count = db.prepare('SELECT COUNT(*) as count FROM remote_command_logs').get();

  await logger.close();
  db.close();

  console.log(`✅ 完成`);
  console.log(`  总耗时: ${duration}ms`);
  console.log(`  平均耗时: ${(duration / logCount).toFixed(2)}ms/条`);
  console.log(`  吞吐量: ${Math.floor((logCount / duration) * 1000)} 条/秒`);
  console.log(`  内存使用: ${memoryUsed.toFixed(2)} MB`);
  console.log(`  数据库记录数: ${count.count}`);
  console.log(`  批量写入次数: ${perfStats.batchedWrites}`);
  console.log(`  平均批次大小: ${perfStats.avgBatchSize.toFixed(1)}`);
  console.log(`  最大缓冲区大小: ${perfStats.maxBufferSize}`);

  return {
    type: 'batched',
    duration,
    avgTime: duration / logCount,
    throughput: (logCount / duration) * 1000,
    memoryUsed,
    recordCount: count.count,
    batchedWrites: perfStats.batchedWrites,
    avgBatchSize: perfStats.avgBatchSize
  };
}

/**
 * 测试查询性能
 */
function benchmarkQuery(logger, queryCount) {
  console.log(`\n[查询性能] 执行 ${queryCount} 次查询...`);
  console.log('─'.repeat(50));

  const startTime = Date.now();

  for (let i = 0; i < queryCount; i++) {
    logger.query({
      page: (i % 10) + 1,
      pageSize: 20,
      namespace: i % 2 === 0 ? 'ai' : 'system'
    });
  }

  const duration = Date.now() - startTime;

  console.log(`✅ 完成`);
  console.log(`  总耗时: ${duration}ms`);
  console.log(`  平均耗时: ${(duration / queryCount).toFixed(2)}ms/次`);
  console.log(`  吞吐量: ${Math.floor((queryCount / duration) * 1000)} 次/秒`);

  return {
    duration,
    avgTime: duration / queryCount,
    throughput: (queryCount / duration) * 1000
  };
}

/**
 * 生成性能报告
 */
function generateReport(results) {
  console.log('\n================================================');
  console.log('性能测试报告');
  console.log('================================================\n');

  const standardResult = results.find((r) => r.type === 'standard');
  const batchedResult = results.find((r) => r.type === 'batched');

  if (standardResult && batchedResult) {
    const improvement = ((standardResult.duration - batchedResult.duration) / standardResult.duration * 100).toFixed(1);
    const throughputImprovement = ((batchedResult.throughput - standardResult.throughput) / standardResult.throughput * 100).toFixed(1);

    console.log('📊 写入性能对比：\n');
    console.log('  标准日志记录器：');
    console.log(`    耗时: ${standardResult.duration}ms`);
    console.log(`    吞吐量: ${Math.floor(standardResult.throughput)} 条/秒`);
    console.log(`    内存: ${standardResult.memoryUsed.toFixed(2)} MB\n`);

    console.log('  批处理日志记录器：');
    console.log(`    耗时: ${batchedResult.duration}ms`);
    console.log(`    吞吐量: ${Math.floor(batchedResult.throughput)} 条/秒`);
    console.log(`    内存: ${batchedResult.memoryUsed.toFixed(2)} MB`);
    console.log(`    批量写入: ${batchedResult.batchedWrites} 次`);
    console.log(`    平均批次: ${batchedResult.avgBatchSize.toFixed(1)} 条\n`);

    console.log('  性能提升：');
    console.log(`    ⚡ 耗时减少: ${improvement}%`);
    console.log(`    ⚡ 吞吐量提升: ${throughputImprovement}%\n`);
  }

  if (results.query) {
    console.log('📊 查询性能：\n');
    console.log(`  平均耗时: ${results.query.avgTime.toFixed(2)}ms/次`);
    console.log(`  吞吐量: ${Math.floor(results.query.throughput)} 次/秒\n`);
  }

  console.log('================================================\n');

  // 保存报告
  const reportPath = path.join(__dirname, '../tests/reports/remote-performance-report.json');
  const reportDir = path.dirname(reportPath);

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const report = {
    timestamp: new Date().toISOString(),
    results
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 报告已保存到: ${reportPath}\n`);
}

/**
 * 运行基准测试
 */
async function runBenchmarks() {
  const LOG_COUNT = 1000; // 测试 1000 条日志
  const QUERY_COUNT = 100; // 测试 100 次查询

  const results = [];

  try {
    // 测试标准日志记录器
    const standardResult = await benchmarkStandardLogger(LOG_COUNT);
    results.push(standardResult);

    // 测试批处理日志记录器
    const batchedResult = await benchmarkBatchedLogger(LOG_COUNT);
    results.push(batchedResult);

    // 测试查询性能（使用批处理日志记录器）
    const db = createTestDatabase();
    const logger = new BatchedCommandLogger(db, { enableAutoCleanup: false });

    // 插入测试数据
    for (let i = 0; i < LOG_COUNT; i++) {
      logger.log(generateTestLog(i));
    }
    await logger.forceFlush();

    const queryResult = benchmarkQuery(logger, QUERY_COUNT);
    results.query = queryResult;

    await logger.close();
    db.close();

    // 生成报告
    generateReport(results);

    // 清理测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    console.log('✅ 所有基准测试完成！\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ 基准测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
runBenchmarks();
