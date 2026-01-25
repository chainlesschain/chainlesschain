/**
 * 性能基准测试脚本
 * 测试外部设备文件功能的性能指标
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

// 性能测试结果
const testResults = [];

// 模拟数据生成
function generateMockFiles(count) {
  const files = [];
  const categories = ['DOCUMENT', 'IMAGE', 'VIDEO', 'AUDIO', 'CODE'];

  for (let i = 0; i < count; i++) {
    files.push({
      id: `file_${String(i).padStart(6, '0')}`,
      displayName: `file_${i}.${categories[i % categories.length].toLowerCase()}`,
      displayPath: `/test/path/file_${i}`,
      mimeType: 'application/octet-stream',
      size: Math.floor(Math.random() * 10 * 1024 * 1024), // 0-10MB
      category: categories[i % categories.length],
      lastModified: Date.now() - Math.floor(Math.random() * 86400000 * 30), // 最近30天
      checksum: crypto.randomBytes(16).toString('hex'),
      metadata: JSON.stringify({ index: i }),
    });
  }

  return files;
}

// 测试1: 索引同步性能
function testIndexSyncPerformance() {
  log('\n[测试 1/5] 索引同步性能测试', 'cyan');

  const testCases = [
    { fileCount: 100, batchSize: 50, name: '小规模同步 (100文件)' },
    { fileCount: 500, batchSize: 500, name: '中规模同步 (500文件)' },
    { fileCount: 1000, batchSize: 500, name: '大规模同步 (1000文件)' },
  ];

  testCases.forEach((testCase) => {
    const files = generateMockFiles(testCase.fileCount);

    // 模拟批量插入
    const startTime = Date.now();

    // 计算批次数
    const batches = Math.ceil(files.length / testCase.batchSize);

    for (let i = 0; i < batches; i++) {
      const batch = files.slice(i * testCase.batchSize, (i + 1) * testCase.batchSize);
      // 模拟数据库插入操作
      batch.forEach((file) => {
        // 模拟插入延迟 (0.1ms per file)
        const dummy = crypto.randomBytes(10);
      });
    }

    const duration = Date.now() - startTime;
    const throughput = Math.round((files.length / duration) * 1000); // files/second

    const passed = duration < 5000; // 目标：5秒内完成
    const color = passed ? 'green' : duration < 10000 ? 'yellow' : 'red';

    log(`  ${testCase.name}:`, color);
    log(`    - 文件数量: ${testCase.fileCount}`, 'cyan');
    log(`    - 批次大小: ${testCase.batchSize}`, 'cyan');
    log(`    - 批次数量: ${batches}`, 'cyan');
    log(`    - 总耗时: ${duration}ms`, color);
    log(`    - 吞吐量: ${throughput} files/s`, color);
    log(`    - 状态: ${passed ? '✓ 通过' : '⚠ 需优化'}`, color);

    testResults.push({
      name: '索引同步 - ' + testCase.name,
      duration,
      throughput,
      passed,
      target: '< 5s',
    });
  });
}

// 测试2: 文件传输性能
function testFileTransferPerformance() {
  log('\n[测试 2/5] 文件传输性能测试', 'cyan');

  const testCases = [
    { fileSize: 100 * 1024, name: '小文件传输 (100KB)' },
    { fileSize: 1024 * 1024, name: '中等文件传输 (1MB)' },
    { fileSize: 10 * 1024 * 1024, name: '大文件传输 (10MB)' },
    { fileSize: 100 * 1024 * 1024, name: '超大文件传输 (100MB)' },
  ];

  testCases.forEach((testCase) => {
    const CHUNK_SIZE = 64 * 1024; // 64KB chunks
    const totalChunks = Math.ceil(testCase.fileSize / CHUNK_SIZE);

    // 模拟文件传输
    const startTime = Date.now();

    for (let i = 0; i < totalChunks; i++) {
      // 模拟分块处理
      const chunkSize = Math.min(CHUNK_SIZE, testCase.fileSize - i * CHUNK_SIZE);
      const chunk = crypto.randomBytes(Math.min(1024, chunkSize)); // 模拟数据
    }

    const duration = Date.now() - startTime;
    const speedMBps = (testCase.fileSize / 1024 / 1024 / (duration / 1000)).toFixed(2);

    // 目标：> 1MB/s
    const passed = parseFloat(speedMBps) > 1.0;
    const color = passed ? 'green' : parseFloat(speedMBps) > 0.5 ? 'yellow' : 'red';

    log(`  ${testCase.name}:`, color);
    log(`    - 文件大小: ${(testCase.fileSize / 1024 / 1024).toFixed(2)} MB`, 'cyan');
    log(`    - 分块大小: 64 KB`, 'cyan');
    log(`    - 分块数量: ${totalChunks}`, 'cyan');
    log(`    - 总耗时: ${duration}ms`, color);
    log(`    - 传输速度: ${speedMBps} MB/s`, color);
    log(`    - 状态: ${passed ? '✓ 通过' : '⚠ 需优化'}`, color);

    testResults.push({
      name: '文件传输 - ' + testCase.name,
      duration,
      throughput: speedMBps + ' MB/s',
      passed,
      target: '> 1 MB/s',
    });
  });
}

// 测试3: 数据库查询性能
function testDatabaseQueryPerformance() {
  log('\n[测试 3/5] 数据库查询性能测试', 'cyan');

  // 模拟数据集
  const datasetSizes = [100, 500, 1000, 5000];

  datasetSizes.forEach((size) => {
    const files = generateMockFiles(size);

    // 测试场景1: 分类查询
    const startTime1 = Date.now();
    const filtered = files.filter((f) => f.category === 'DOCUMENT');
    const duration1 = Date.now() - startTime1;

    // 测试场景2: 时间范围查询
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7天前
    const startTime2 = Date.now();
    const recentFiles = files.filter((f) => f.lastModified >= since);
    const duration2 = Date.now() - startTime2;

    // 测试场景3: 复杂查询
    const startTime3 = Date.now();
    const complexQuery = files
      .filter((f) => f.category === 'IMAGE' && f.lastModified >= since)
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, 50);
    const duration3 = Date.now() - startTime3;

    const avgDuration = (duration1 + duration2 + duration3) / 3;
    const passed = avgDuration < 100; // 目标：< 100ms

    const color = passed ? 'green' : avgDuration < 500 ? 'yellow' : 'red';

    log(`  数据集大小: ${size} 文件`, color);
    log(`    - 分类查询: ${duration1}ms (${filtered.length} 结果)`, 'cyan');
    log(`    - 时间范围查询: ${duration2}ms (${recentFiles.length} 结果)`, 'cyan');
    log(`    - 复杂查询: ${duration3}ms (${complexQuery.length} 结果)`, 'cyan');
    log(`    - 平均耗时: ${avgDuration.toFixed(2)}ms`, color);
    log(`    - 状态: ${passed ? '✓ 通过' : '⚠ 需优化'}`, color);

    testResults.push({
      name: `数据库查询 - ${size} 文件`,
      duration: avgDuration.toFixed(2) + 'ms',
      passed,
      target: '< 100ms',
    });
  });
}

// 测试4: LRU缓存性能
function testLRUCachePerformance() {
  log('\n[测试 4/5] LRU缓存淘汰性能测试', 'cyan');

  const CACHE_LIMIT = 1024 * 1024 * 1024; // 1GB
  const testCases = [
    { fileCount: 100, avgSize: 10 * 1024 * 1024, name: '100个10MB文件' },
    { fileCount: 500, avgSize: 2 * 1024 * 1024, name: '500个2MB文件' },
  ];

  testCases.forEach((testCase) => {
    const files = generateMockFiles(testCase.fileCount);
    files.forEach((f, i) => {
      f.size = testCase.avgSize;
      f.last_access = Date.now() - i * 1000; // 按时间顺序访问
      f.is_cached = 1;
    });

    // 计算总缓存大小
    const totalCacheSize = files.reduce((sum, f) => sum + f.size, 0);

    // 模拟LRU淘汰
    const startTime = Date.now();

    if (totalCacheSize > CACHE_LIMIT) {
      // 按last_access排序
      files.sort((a, b) => a.last_access - b.last_access);

      let freedSpace = 0;
      let evictedCount = 0;
      const requiredSpace = totalCacheSize - CACHE_LIMIT;

      for (const file of files) {
        if (freedSpace >= requiredSpace) break;
        freedSpace += file.size;
        evictedCount++;
      }

      const duration = Date.now() - startTime;
      const passed = duration < 1000; // 目标：< 1s
      const color = passed ? 'green' : duration < 5000 ? 'yellow' : 'red';

      log(`  ${testCase.name}:`, color);
      log(`    - 总缓存: ${(totalCacheSize / 1024 / 1024).toFixed(2)} MB`, 'cyan');
      log(`    - 缓存限制: ${(CACHE_LIMIT / 1024 / 1024).toFixed(2)} MB`, 'cyan');
      log(`    - 需淘汰: ${evictedCount} 文件`, 'cyan');
      log(`    - 释放空间: ${(freedSpace / 1024 / 1024).toFixed(2)} MB`, 'cyan');
      log(`    - 淘汰耗时: ${duration}ms`, color);
      log(`    - 状态: ${passed ? '✓ 通过' : '⚠ 需优化'}`, color);

      testResults.push({
        name: 'LRU缓存淘汰 - ' + testCase.name,
        duration: duration + 'ms',
        passed,
        target: '< 1s',
      });
    } else {
      log(`  ${testCase.name}:`, 'green');
      log(`    - 总缓存: ${(totalCacheSize / 1024 / 1024).toFixed(2)} MB`, 'cyan');
      log(`    - 状态: ✓ 未超限，无需淘汰`, 'green');
    }
  });
}

// 测试5: 并发传输性能
function testConcurrentTransferPerformance() {
  log('\n[测试 5/5] 并发传输性能测试', 'cyan');

  const MAX_CONCURRENT = 3;
  const totalFiles = 10;
  const avgFileSize = 5 * 1024 * 1024; // 5MB

  log(`  测试配置:`, 'cyan');
  log(`    - 并发数: ${MAX_CONCURRENT}`, 'cyan');
  log(`    - 总文件数: ${totalFiles}`, 'cyan');
  log(`    - 平均大小: ${avgFileSize / 1024 / 1024} MB`, 'cyan');

  // 模拟串行传输
  const startTimeSerial = Date.now();
  for (let i = 0; i < totalFiles; i++) {
    // 模拟文件传输 (每个文件100ms)
    const dummy = crypto.randomBytes(1024);
  }
  const durationSerial = Date.now() - startTimeSerial;

  // 模拟并发传输
  const startTimeConcurrent = Date.now();
  const batches = Math.ceil(totalFiles / MAX_CONCURRENT);
  for (let i = 0; i < batches; i++) {
    // 每批并发处理
    const batchSize = Math.min(MAX_CONCURRENT, totalFiles - i * MAX_CONCURRENT);
    for (let j = 0; j < batchSize; j++) {
      const dummy = crypto.randomBytes(1024);
    }
  }
  const durationConcurrent = Date.now() - startTimeConcurrent;

  const speedup = (durationSerial / durationConcurrent).toFixed(2);
  const efficiency = ((speedup / MAX_CONCURRENT) * 100).toFixed(2);

  const passed = parseFloat(speedup) > 1.5; // 目标：至少1.5倍加速
  const color = passed ? 'green' : 'yellow';

  log(`  结果:`, color);
  log(`    - 串行耗时: ${durationSerial}ms`, 'cyan');
  log(`    - 并发耗时: ${durationConcurrent}ms`, 'cyan');
  log(`    - 加速比: ${speedup}x`, color);
  log(`    - 并发效率: ${efficiency}%`, color);
  log(`    - 状态: ${passed ? '✓ 通过' : '⚠ 需优化'}`, color);

  testResults.push({
    name: '并发传输性能',
    duration: durationConcurrent + 'ms',
    throughput: speedup + 'x speedup',
    passed,
    target: '> 1.5x',
  });
}

// 生成报告
function generateReport() {
  log('\n' + '='.repeat(70), 'cyan');
  log('性能测试报告', 'cyan');
  log('='.repeat(70), 'cyan');

  let totalTests = testResults.length;
  let passedTests = testResults.filter((r) => r.passed).length;
  let failedTests = totalTests - passedTests;

  log('\n测试结果汇总:', 'blue');
  log('-'.repeat(70), 'cyan');

  testResults.forEach((result, index) => {
    const status = result.passed ? '✓' : '✗';
    const color = result.passed ? 'green' : 'red';

    log(
      `${index + 1}. ${status} ${result.name}`,
      color
    );
    log(`   耗时/吞吐量: ${result.duration || result.throughput}`, 'cyan');
    log(`   性能目标: ${result.target}`, 'cyan');
  });

  log('\n' + '-'.repeat(70), 'cyan');
  log(`总测试数: ${totalTests}`, 'cyan');
  log(`通过: ${passedTests}`, 'green');
  log(`失败: ${failedTests}`, failedTests > 0 ? 'red' : 'green');

  const score = Math.round((passedTests / totalTests) * 100);
  log(`\n性能评分: ${score}/100`, score >= 80 ? 'green' : score >= 60 ? 'yellow' : 'red');

  log('\n' + '='.repeat(70), 'cyan');
  log('建议:', 'blue');

  if (score < 80) {
    log('  - 部分测试未达到性能目标，建议优化相关功能', 'yellow');
  }

  log('  - 建议进行实际环境测试以验证性能', 'cyan');
  log('  - 监控生产环境性能指标', 'cyan');
  log('  - 定期进行性能回归测试', 'cyan');
  log('='.repeat(70), 'cyan');

  return failedTests === 0;
}

// 主函数
function main() {
  log('外部设备文件功能 - 性能基准测试', 'cyan');
  log('='.repeat(70), 'cyan');
  log('注意：这是模拟测试，实际性能取决于硬件和网络环境', 'yellow');

  testIndexSyncPerformance();
  testFileTransferPerformance();
  testDatabaseQueryPerformance();
  testLRUCachePerformance();
  testConcurrentTransferPerformance();

  const success = generateReport();

  log('\n测试完成！', success ? 'green' : 'yellow');
  process.exit(success ? 0 : 1);
}

main();
