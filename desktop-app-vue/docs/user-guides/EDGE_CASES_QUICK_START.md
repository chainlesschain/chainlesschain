# 边界情况处理 - 快速开始

## 快速验证

```bash
cd desktop-app-vue
node scripts/verify-edge-cases.js
```

## 核心模块

| 模块 | 路径 | 功能 |
|------|------|------|
| 资源监控器 | `src/main/utils/resource-monitor.js` | 内存/磁盘监控、降级策略 |
| 并发控制器 | `src/main/utils/database-concurrency.js` | 重试、队列、事务 |
| 完整性检查器 | `src/main/utils/file-integrity.js` | 校验、备份、恢复 |

## 快速集成

### 1. 启用资源监控（主进程启动时）

```javascript
const { getResourceMonitor } = require('./utils/resource-monitor');

// 启动监控
const monitor = getResourceMonitor();
monitor.startMonitoring(10000); // 每10秒

// 监听变化
monitor.on('level-change', ({ newLevel }) => {
  console.log(`资源水平: ${newLevel}`);
});
```

### 2. 图片处理降级（自动）

```javascript
const ImageProcessor = require('./image/image-processor');
const processor = new ImageProcessor();

// 自动根据资源水平降级
await processor.compress(inputPath, outputPath);
// normal:   1920px, 85%质量
// warning:  1280px, 75%质量
// critical: 800px,  60%质量
```

### 3. 磁盘空间检查（文件保存前）

```javascript
const { getResourceMonitor } = require('./utils/resource-monitor');
const monitor = getResourceMonitor();

// 检查空间
const check = await monitor.checkDiskSpace(targetDir, fileSize * 1.2);

if (!check.available) {
  throw new Error(`磁盘空间不足: 需要 ${check.deficit} 字节`);
}

// 执行保存...
```

### 4. 数据库操作重试（自动）

```javascript
const { getConcurrencyController } = require('./utils/database-concurrency');
const controller = getConcurrencyController();

// 自动重试（最多5次）
await controller.executeWithRetry(async () => {
  return db.run('INSERT INTO ...');
});
```

### 5. 文件完整性保护

```javascript
const { getFileIntegrityChecker } = require('./utils/file-integrity');
const checker = getFileIntegrityChecker();

// 保存前创建备份
await checker.createBackup(filePath);

// 检查完整性
const result = await checker.checkFile(filePath);
if (result.corrupt) {
  // 恢复
  await checker.restoreFromBackup(filePath);
}
```

## 配置调整

### 内存阈值

```javascript
const monitor = new ResourceMonitor({
  memoryWarning: 500 * 1024 * 1024,    // 500MB
  memoryCritical: 200 * 1024 * 1024,   // 200MB
  memoryUsageWarning: 85,              // 85%
  memoryUsageCritical: 95              // 95%
});
```

### 重试策略

```javascript
const controller = new DatabaseConcurrencyController({
  maxRetries: 5,           // 最大重试次数
  baseDelay: 100,          // 基础延迟（毫秒）
  exponentialBackoff: true // 指数退避
});
```

### 备份策略

```javascript
const checker = new FileIntegrityChecker({
  maxBackups: 5,           // 保留最新5个备份
  autoBackup: true,        // 自动备份
  hashAlgorithm: 'sha256'  // 校验算法
});
```

## 监控和统计

### 资源报告

```javascript
const report = await monitor.getReport(dataDir);
console.log(report);
// {
//   level: 'warning',
//   memory: { total, free, usagePercentage },
//   disk: { total, free, usagePercentage },
//   strategies: { imageProcessing, ocrProcessing, batchImport }
// }
```

### 并发统计

```javascript
const stats = controller.getStatistics();
console.log(stats);
// {
//   totalOperations: 100,
//   successfulOperations: 98,
//   totalRetries: 5,
//   successRate: '98.00%'
// }
```

## 常见问题

### Q: 内存持续处于 critical 怎么办？

```javascript
// 1. 强制垃圾回收
monitor.forceGarbageCollection();

// 2. 降低阈值
monitor.thresholds.memoryCritical = 100 * 1024 * 1024;

// 3. 检查内存泄漏
console.log(monitor.getMemoryStatus().process);
```

### Q: 数据库 BUSY 错误频繁？

```javascript
// 启用 WAL 模式
db.pragma('journal_mode = WAL');

// 使用写入队列
await controller.queueWrite(/* ... */);
```

### Q: 所有备份都损坏？

```javascript
// 查看备份目录
const backups = await fs.readdir(backupDir);

// 紧急情况：跳过验证直接恢复
await fs.copyFile(backupPath, targetPath);
```

## 性能影响

| 功能 | 开销 | 说明 |
|------|------|------|
| 内存监控 | < 0.1% CPU | 每10秒检查 |
| 磁盘检查 | 10-50ms | 每次文件保存前 |
| 重试逻辑 | < 5% | 大部分一次成功 |
| 哈希计算 | 1-10ms/MB | SHA-256 |
| 备份创建 | 5-20ms/MB | 文件复制 |

## 测试覆盖

```bash
# 运行所有边界情况测试
cd desktop-app-vue
npm test -- edge-cases.test.js

# 快速验证
node scripts/verify-edge-cases.js
```

**38个测试用例** 覆盖：
- ✅ 内存降级（7个）
- ✅ 磁盘空间（3个）
- ✅ 并发冲突（10个）
- ✅ 文件完整性（14个）
- ✅ 集成场景（4个）

## 更多信息

详细文档: `desktop-app-vue/docs/EDGE_CASES_HANDLING.md`
