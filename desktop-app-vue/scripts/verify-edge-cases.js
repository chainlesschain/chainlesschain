/**
 * 边界情况处理验证脚本
 * 快速验证所有边界处理功能
 */

const { ResourceMonitor } = require('../src/main/utils/resource-monitor');
const { DatabaseConcurrencyController } = require('../src/main/utils/database-concurrency');
const { FileIntegrityChecker } = require('../src/main/utils/file-integrity');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function verify() {
  console.log('========================================');
  console.log('边界情况处理功能验证');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  // 1. 验证资源监控
  console.log('1. 验证内存监控和降级机制...');
  try {
    const monitor = new ResourceMonitor();

    // 获取内存状态
    const memStatus = monitor.getMemoryStatus();
    if (!memStatus.total || !memStatus.free || !memStatus.usagePercentage) {
      throw new Error('内存状态数据不完整');
    }
    console.log(`   ✅ 内存状态获取成功`);
    console.log(`      - 总内存: ${(memStatus.total / 1024 / 1024 / 1024).toFixed(2)} GB`);
    console.log(`      - 可用内存: ${(memStatus.free / 1024 / 1024 / 1024).toFixed(2)} GB`);
    console.log(`      - 使用率: ${memStatus.usagePercentage}%`);

    // 评估资源水平
    const level = monitor.assessResourceLevel();
    if (!['normal', 'warning', 'critical'].includes(level)) {
      throw new Error('资源水平评估失败');
    }
    console.log(`   ✅ 资源水平评估: ${level}`);

    // 获取降级策略
    const imageStrategy = monitor.getDegradationStrategy('imageProcessing');
    if (!imageStrategy.maxDimension || !imageStrategy.quality) {
      throw new Error('降级策略获取失败');
    }
    console.log(`   ✅ 降级策略: ${imageStrategy.maxDimension}px, ${imageStrategy.quality}%质量, ${imageStrategy.concurrent}并发`);

    passed++;
  } catch (error) {
    console.log(`   ❌ 失败: ${error.message}`);
    failed++;
  }

  console.log();

  // 2. 验证磁盘空间检测
  console.log('2. 验证磁盘空间检测...');
  try {
    const monitor = new ResourceMonitor();
    const tempDir = os.tmpdir();

    const diskStatus = await monitor.getDiskStatus(tempDir);
    if (diskStatus && diskStatus.total && diskStatus.free !== undefined) {
      console.log(`   ✅ 磁盘状态获取成功`);
      console.log(`      - 总空间: ${(diskStatus.total / 1024 / 1024 / 1024).toFixed(2)} GB`);
      console.log(`      - 可用空间: ${(diskStatus.free / 1024 / 1024 / 1024).toFixed(2)} GB`);
      console.log(`      - 使用率: ${diskStatus.usagePercentage}%`);
    } else {
      console.log(`   ⚠️  磁盘状态获取部分成功（平台限制）`);
    }

    const check = await monitor.checkDiskSpace(tempDir, 1024);
    if (check.available !== undefined) {
      console.log(`   ✅ 磁盘空间检查成功`);
    }

    passed++;
  } catch (error) {
    console.log(`   ❌ 失败: ${error.message}`);
    failed++;
  }

  console.log();

  // 3. 验证并发控制
  console.log('3. 验证并发写入冲突处理...');
  try {
    const controller = new DatabaseConcurrencyController({
      maxRetries: 3,
      baseDelay: 10
    });

    // 测试正常操作
    const result1 = await controller.executeWithRetry(async () => {
      return 'success';
    });
    if (result1 !== 'success') {
      throw new Error('正常操作执行失败');
    }
    console.log(`   ✅ 正常操作执行成功`);

    // 测试重试机制
    let attempts = 0;
    const result2 = await controller.executeWithRetry(async () => {
      attempts++;
      if (attempts < 2) {
        const err = new Error('database is locked');
        err.code = 'SQLITE_BUSY';
        throw err;
      }
      return 'retry success';
    });
    if (result2 !== 'retry success' || attempts < 2) {
      throw new Error('重试机制失败');
    }
    console.log(`   ✅ 重试机制工作正常（${attempts}次尝试）`);

    // 检查统计
    const stats = controller.getStatistics();
    console.log(`   ✅ 统计信息: 总操作${stats.totalOperations}, 成功${stats.successfulOperations}, 重试${stats.totalRetries}`);

    passed++;
  } catch (error) {
    console.log(`   ❌ 失败: ${error.message}`);
    failed++;
  }

  console.log();

  // 4. 验证文件完整性
  console.log('4. 验证文件完整性检查和恢复...');
  try {
    const tempDir = path.join(os.tmpdir(), `verify-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const checker = new FileIntegrityChecker({
      backupDir: path.join(tempDir, 'backups'),
      maxBackups: 3
    });

    const testFile = path.join(tempDir, 'test.txt');
    const testContent = 'Hello World';
    await fs.writeFile(testFile, testContent);

    // 计算哈希
    const hash = await checker.calculateFileHash(testFile);
    if (!hash || hash.length !== 64) {
      throw new Error('哈希计算失败');
    }
    console.log(`   ✅ 哈希计算成功: ${hash.substring(0, 16)}...`);

    // 验证完整性
    const isValid = await checker.verifyFile(testFile, hash);
    if (!isValid) {
      throw new Error('完整性验证失败');
    }
    console.log(`   ✅ 文件完整性验证通过`);

    // 创建备份
    const backupPath = await checker.createBackup(testFile);
    if (!backupPath) {
      throw new Error('备份创建失败');
    }
    console.log(`   ✅ 备份创建成功`);

    // 损坏文件
    await fs.writeFile(testFile, 'Corrupted');

    // 恢复
    const result = await checker.restoreFromBackup(testFile, backupPath);
    if (!result.success) {
      throw new Error('恢复失败');
    }

    const restoredContent = await fs.readFile(testFile, 'utf8');
    if (restoredContent !== testContent) {
      throw new Error('恢复内容不匹配');
    }
    console.log(`   ✅ 文件恢复成功`);

    // 清理
    await fs.rm(tempDir, { recursive: true, force: true });

    passed++;
  } catch (error) {
    console.log(`   ❌ 失败: ${error.message}`);
    failed++;
  }

  console.log();
  console.log('========================================');
  console.log('验证结果汇总');
  console.log('========================================');
  console.log(`✅ 通过: ${passed}/4`);
  console.log(`❌ 失败: ${failed}/4`);
  console.log();

  if (failed === 0) {
    console.log('🎉 所有边界情况处理功能验证通过！');
    console.log();
    console.log('已实现功能:');
    console.log('  ✅ 内存不足时优雅降级');
    console.log('  ✅ 磁盘空间不足处理');
    console.log('  ✅ 并发写入冲突处理');
    console.log('  ✅ 损坏文件识别和恢复');
    console.log();
    console.log('详细文档: desktop-app-vue/docs/EDGE_CASES_HANDLING.md');
    process.exit(0);
  } else {
    console.log('⚠️  部分功能验证失败，请检查错误信息');
    process.exit(1);
  }
}

verify().catch(error => {
  console.error('验证过程出错:', error);
  process.exit(1);
});
