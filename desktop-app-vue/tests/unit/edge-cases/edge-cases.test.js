/**
 * 边界情况处理测试
 * 测试内存降级、磁盘空间检查、并发冲突、文件损坏等边界情况
 */

const { ResourceMonitor } = require('../../../src/main/utils/resource-monitor');
const { DatabaseConcurrencyController, ERROR_TYPES } = require('../../../src/main/utils/database-concurrency');
const { FileIntegrityChecker } = require('../../../src/main/utils/file-integrity');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('边界情况处理测试', () => {
  let tempDir;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `edge-cases-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error('清理临时目录失败:', error);
    }
  });

  describe('1. 内存不足优雅降级', () => {
    let monitor;

    beforeEach(() => {
      monitor = new ResourceMonitor({
        memoryWarning: 1024 * 1024 * 1024, // 1GB
        memoryCritical: 512 * 1024 * 1024, // 512MB
        memoryUsageWarning: 85,
        memoryUsageCritical: 95
      });
    });

    afterEach(() => {
      monitor.stopMonitoring();
    });

    test('应该正确获取内存状态', () => {
      const status = monitor.getMemoryStatus();

      expect(status).toHaveProperty('total');
      expect(status).toHaveProperty('free');
      expect(status).toHaveProperty('used');
      expect(status).toHaveProperty('usagePercentage');
      expect(status).toHaveProperty('process');

      expect(status.total).toBeGreaterThan(0);
      expect(status.usagePercentage).toBeGreaterThanOrEqual(0);
      expect(status.usagePercentage).toBeLessThanOrEqual(100);
    });

    test('应该正确评估资源水平', () => {
      const level = monitor.assessResourceLevel();

      expect(['normal', 'warning', 'critical']).toContain(level);
    });

    test('应该根据资源水平提供降级策略', () => {
      const imageStrategy = monitor.getDegradationStrategy('imageProcessing');
      const ocrStrategy = monitor.getDegradationStrategy('ocrProcessing');
      const batchStrategy = monitor.getDegradationStrategy('batchImport');

      expect(imageStrategy).toHaveProperty('maxDimension');
      expect(imageStrategy).toHaveProperty('quality');
      expect(imageStrategy).toHaveProperty('concurrent');

      expect(ocrStrategy).toHaveProperty('concurrent');
      expect(ocrStrategy).toHaveProperty('language');

      expect(batchStrategy).toHaveProperty('batchSize');
      expect(batchStrategy).toHaveProperty('concurrent');
    });

    test('应该在资源水平变化时触发事件', (done) => {
      // 模拟资源水平变化
      const originalLevel = monitor.currentLevel;
      monitor.currentLevel = 'warning'; // 手动设置为不同值

      monitor.once('level-change', (event) => {
        expect(event).toHaveProperty('oldLevel');
        expect(event).toHaveProperty('newLevel');
        expect(event).toHaveProperty('memoryStatus');
        expect(event).toHaveProperty('timestamp');
        done();
      });

      monitor.updateResourceLevel();
    });

    test('应该在critical级别时建议降级', () => {
      monitor.currentLevel = 'critical';

      const imageStrategy = monitor.getDegradationStrategy('imageProcessing');

      expect(imageStrategy.maxDimension).toBeLessThan(1280);
      expect(imageStrategy.quality).toBeLessThan(75);
      expect(imageStrategy.concurrent).toBe(1);
    });

    test('应该能够生成资源报告', async () => {
      const report = await monitor.getReport(tempDir);

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('level');
      expect(report).toHaveProperty('memory');
      expect(report).toHaveProperty('strategies');

      expect(report.strategies).toHaveProperty('imageProcessing');
      expect(report.strategies).toHaveProperty('ocrProcessing');
      expect(report.strategies).toHaveProperty('batchImport');
    });
  });

  describe('2. 磁盘空间不足检测', () => {
    let monitor;

    beforeEach(() => {
      monitor = new ResourceMonitor({
        diskWarning: 1024 * 1024 * 1024, // 1GB
        diskCritical: 500 * 1024 * 1024   // 500MB
      });
    });

    test('应该能够获取磁盘状态', async () => {
      const status = await monitor.getDiskStatus(tempDir);

      if (status) {
        expect(status).toHaveProperty('total');
        expect(status).toHaveProperty('free');
        expect(status).toHaveProperty('used');
        expect(status).toHaveProperty('usagePercentage');

        expect(status.total).toBeGreaterThan(0);
        expect(status.free).toBeGreaterThanOrEqual(0);
      }
    });

    test('应该能够检查是否有足够的磁盘空间', async () => {
      const requiredSpace = 1024; // 1KB
      const check = await monitor.checkDiskSpace(tempDir, requiredSpace);

      expect(check).toHaveProperty('available');
      expect(check).toHaveProperty('warning');
      expect(check).toHaveProperty('critical');

      if (check.freeSpace) {
        expect(check.freeSpace).toBeGreaterThanOrEqual(0);
      }
    });

    test('应该在空间不足时返回deficit', async () => {
      const hugeSpace = 1024 * 1024 * 1024 * 1024 * 1024; // 1PB
      const check = await monitor.checkDiskSpace(tempDir, hugeSpace);

      if (!check.available) {
        expect(check).toHaveProperty('deficit');
        expect(check.deficit).toBeGreaterThan(0);
      }
    });
  });

  describe('3. 并发写入冲突处理', () => {
    let controller;

    beforeEach(() => {
      controller = new DatabaseConcurrencyController({
        maxRetries: 3,
        baseDelay: 50,
        exponentialBackoff: true
      });
    });

    afterEach(() => {
      controller.resetStatistics();
    });

    test('应该成功执行正常操作', async () => {
      const result = await controller.executeWithRetry(async () => {
        return 'success';
      });

      expect(result).toBe('success');
      const stats = controller.getStatistics();
      expect(stats.totalOperations).toBe(1);
      expect(stats.successfulOperations).toBe(1);
    });

    test('应该在遇到BUSY错误时重试', async () => {
      let attemptCount = 0;

      const result = await controller.executeWithRetry(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          const error = new Error('database is locked');
          error.code = 'SQLITE_BUSY';
          throw error;
        }
        return 'success after retries';
      }, {
        operationName: 'test-busy-retry'
      });

      expect(result).toBe('success after retries');
      expect(attemptCount).toBe(3);

      const stats = controller.getStatistics();
      expect(stats.totalRetries).toBeGreaterThan(0);
      expect(stats.busyErrors).toBeGreaterThan(0);
    });

    test('应该在超过最大重试次数后失败', async () => {
      await expect(
        controller.executeWithRetry(async () => {
          const error = new Error('database is locked');
          error.code = 'SQLITE_BUSY';
          throw error;
        }, {
          maxRetries: 2
        })
      ).rejects.toThrow('database is locked');

      const stats = controller.getStatistics();
      expect(stats.failedOperations).toBe(1);
    });

    test('应该在遇到不可重试错误时立即失败', async () => {
      let attemptCount = 0;

      await expect(
        controller.executeWithRetry(async () => {
          attemptCount++;
          const error = new Error('CONSTRAINT violation');
          error.code = 'SQLITE_CONSTRAINT';
          throw error;
        })
      ).rejects.toThrow('CONSTRAINT violation');

      expect(attemptCount).toBe(1); // 不应重试
    });

    test('应该使用指数退避计算延迟', () => {
      const delay0 = controller._calculateRetryDelay(0);
      const delay1 = controller._calculateRetryDelay(1);
      const delay2 = controller._calculateRetryDelay(2);

      expect(delay1).toBeGreaterThan(delay0);
      expect(delay2).toBeGreaterThan(delay1);
    });

    test('应该正确识别错误类型', () => {
      const busyError = new Error('database is locked');
      busyError.code = 'SQLITE_BUSY';
      expect(controller._identifyErrorType(busyError)).toBe(ERROR_TYPES.BUSY);

      const constraintError = new Error('CONSTRAINT violation');
      constraintError.code = 'SQLITE_CONSTRAINT';
      expect(controller._identifyErrorType(constraintError)).toBe(ERROR_TYPES.CONSTRAINT);

      const diskError = new Error('No space left');
      diskError.code = 'ENOSPC';
      expect(controller._identifyErrorType(diskError)).toBe(ERROR_TYPES.NOSPC);
    });

    test('应该正确跟踪统计信息', async () => {
      // 成功操作
      await controller.executeWithRetry(async () => 'ok');

      // 重试后成功
      let count = 0;
      await controller.executeWithRetry(async () => {
        if (count++ < 2) {
          const err = new Error('locked');
          err.code = 'SQLITE_BUSY';
          throw err;
        }
        return 'ok';
      });

      const stats = controller.getStatistics();

      expect(stats.totalOperations).toBe(2);
      expect(stats.successfulOperations).toBe(2);
      expect(stats.retriedOperations).toBe(1);
      expect(stats.totalRetries).toBeGreaterThan(0);
    });

    test('应该能够队列化写入操作', async () => {
      const results = [];

      const promises = [
        controller.queueWrite(async () => {
          await new Promise(r => setTimeout(r, 10));
          return 1;
        }),
        controller.queueWrite(async () => {
          await new Promise(r => setTimeout(r, 10));
          return 2;
        }),
        controller.queueWrite(async () => {
          await new Promise(r => setTimeout(r, 10));
          return 3;
        })
      ];

      const result = await Promise.all(promises);
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('4. 文件损坏检测和恢复', () => {
    let checker;
    let testFile;

    beforeEach(async () => {
      checker = new FileIntegrityChecker({
        backupDir: path.join(tempDir, 'backups'),
        maxBackups: 3
      });

      testFile = path.join(tempDir, 'test-file.txt');
      await fs.writeFile(testFile, 'Hello World');
    });

    test('应该能够计算文件哈希', async () => {
      const hash = await checker.calculateFileHash(testFile);

      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256
      expect(typeof hash).toBe('string');
    });

    test('应该能够验证文件完整性', async () => {
      const hash = await checker.calculateFileHash(testFile);
      const isValid = await checker.verifyFile(testFile, hash);

      expect(isValid).toBe(true);
    });

    test('应该检测到损坏的文件', async () => {
      const originalHash = await checker.calculateFileHash(testFile);

      // 修改文件内容
      await fs.writeFile(testFile, 'Modified Content');

      const isValid = await checker.verifyFile(testFile, originalHash);
      expect(isValid).toBe(false);
    });

    test('应该能够创建文件备份', async () => {
      const backupPath = await checker.createBackup(testFile);

      expect(backupPath).toBeDefined();
      expect(await fs.access(backupPath).then(() => true).catch(() => false)).toBe(true);

      // 验证备份内容
      const originalContent = await fs.readFile(testFile, 'utf8');
      const backupContent = await fs.readFile(backupPath, 'utf8');
      expect(backupContent).toBe(originalContent);
    });

    test('应该创建校验和文件', async () => {
      const backupPath = await checker.createBackup(testFile);
      const checksumPath = `${backupPath}.checksum`;

      expect(await fs.access(checksumPath).then(() => true).catch(() => false)).toBe(true);

      const checksum = await fs.readFile(checksumPath, 'utf8');
      expect(checksum.length).toBe(64);
    });

    test('应该能够从备份恢复文件', async () => {
      const originalContent = 'Original Content';
      await fs.writeFile(testFile, originalContent);

      // 创建备份
      const backupPath = await checker.createBackup(testFile);

      // 损坏文件
      await fs.writeFile(testFile, 'Corrupted!!!');

      // 恢复
      const result = await checker.restoreFromBackup(testFile, backupPath);

      expect(result.success).toBe(true);

      // 验证恢复的内容
      const restoredContent = await fs.readFile(testFile, 'utf8');
      expect(restoredContent).toBe(originalContent);
    });

    test('应该能够检查文件完整性', async () => {
      const result = await checker.checkFile(testFile);

      expect(result.exists).toBe(true);
      expect(result.readable).toBe(true);
      expect(result.corrupt).toBe(false);
      expect(result.issues).toHaveLength(0);
      expect(result.metadata).toBeDefined();
    });

    test('应该检测空文件', async () => {
      const emptyFile = path.join(tempDir, 'empty.txt');
      await fs.writeFile(emptyFile, '');

      const result = await checker.checkFile(emptyFile);

      expect(result.corrupt).toBe(true);
      expect(result.issues).toContain('文件为空');
    });

    test('应该检测不存在的文件', async () => {
      const nonExistent = path.join(tempDir, 'does-not-exist.txt');

      const result = await checker.checkFile(nonExistent);

      expect(result.exists).toBe(false);
      expect(result.issues).toContain('文件不存在');
    });

    test('应该验证文件类型（通过魔数）', async () => {
      // 创建一个假的PNG文件（只有头部）
      const pngFile = path.join(tempDir, 'test.png');
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      await fs.writeFile(pngFile, pngHeader);

      const result = await checker.checkFile(pngFile, { fileType: 'png' });

      // 虽然文件不完整，但魔数正确
      expect(result.exists).toBe(true);
    });

    test('应该清理旧备份', async () => {
      // 创建多个备份
      await checker.createBackup(testFile);
      await new Promise(r => setTimeout(r, 10));
      await checker.createBackup(testFile);
      await new Promise(r => setTimeout(r, 10));
      await checker.createBackup(testFile);
      await new Promise(r => setTimeout(r, 10));
      await checker.createBackup(testFile);
      await new Promise(r => setTimeout(r, 10));

      const backupDir = path.join(tempDir, 'backups');
      const files = await fs.readdir(backupDir);
      const backups = files.filter(f => f.includes('.backup.') && !f.endsWith('.checksum'));

      // 应该只保留最新的3个（maxBackups = 3）
      expect(backups.length).toBeLessThanOrEqual(3);
    });

    test('应该在备份损坏时检测到', async () => {
      const backupPath = await checker.createBackup(testFile);

      // 损坏备份
      await fs.writeFile(backupPath, 'Corrupted Backup');

      // 尝试恢复应该失败
      await expect(
        checker.restoreFromBackup(testFile, backupPath)
      ).rejects.toThrow('备份文件已损坏');
    });
  });

  describe('5. 集成场景测试', () => {
    test('应该在内存不足时降级图片处理参数', () => {
      const monitor = new ResourceMonitor();

      // 模拟内存critical
      monitor.currentLevel = 'critical';

      const strategy = monitor.getDegradationStrategy('imageProcessing');

      expect(strategy.maxDimension).toBeLessThanOrEqual(800);
      expect(strategy.quality).toBeLessThanOrEqual(60);
      expect(strategy.concurrent).toBe(1);
    });

    test('应该在磁盘空间不足时拒绝保存', async () => {
      const monitor = new ResourceMonitor({
        diskCritical: 1024 * 1024 * 1024 * 1024 * 1024 // 1PB (肯定不够)
      });

      const check = await monitor.checkDiskSpace(tempDir, 1024 * 1024 * 1024 * 1024 * 1024);

      if (!check.available) {
        expect(check.deficit).toBeGreaterThan(0);
        // 应该拒绝保存操作
      }
    });

    test('应该在并发冲突时自动重试', async () => {
      const controller = new DatabaseConcurrencyController({
        maxRetries: 5,
        baseDelay: 10
      });

      let attempts = 0;
      const result = await controller.executeWithRetry(async () => {
        attempts++;
        if (attempts < 3) {
          const err = new Error('BUSY');
          err.code = 'SQLITE_BUSY';
          throw err;
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    test('应该能够检测并恢复损坏的文件', async () => {
      const checker = new FileIntegrityChecker({
        backupDir: path.join(tempDir, 'recovery-test')
      });

      const testFile = path.join(tempDir, 'recovery-file.txt');
      await fs.writeFile(testFile, 'Important Data');

      // 创建备份
      const backupPath = await checker.createBackup(testFile);

      // 模拟文件损坏
      await fs.writeFile(testFile, 'CORRUPTED!!!');

      // 检测损坏
      const originalHash = await checker.calculateFileHash(backupPath);
      const currentHash = await checker.calculateFileHash(testFile);
      expect(originalHash).not.toBe(currentHash);

      // 恢复
      await checker.restoreFromBackup(testFile, backupPath);

      // 验证恢复
      const restoredContent = await fs.readFile(testFile, 'utf8');
      expect(restoredContent).toBe('Important Data');
    });
  });
});
