# Package.json 脚本配置

将以下脚本添加到 `package.json` 的 `scripts` 部分，以便快速使用性能优化工具。

---

## 添加性能相关脚本

在 `package.json` 的 `scripts` 部分添加以下内容：

```json
{
  "scripts": {
    // ... 现有脚本 ...

    // ===== 性能优化脚本 =====

    // 性能基准测试
    "perf:benchmark": "node test-scripts/performance-benchmark.js",

    // 性能监控（带详细日志）
    "perf:monitor": "DEBUG=performance* npm run dev",

    // 导出性能报告
    "perf:report": "node -e \"const { getPerformanceMonitor } = require('./utils/performance-monitor'); const m = getPerformanceMonitor(); m.printReport();\"",

    // 配置管理
    "config:show": "node -e \"const { getPerformanceConfigManager } = require('./utils/performance-config-manager'); const c = getPerformanceConfigManager(); console.log(JSON.stringify(c.getConfigSummary(), null, 2));\"",
    "config:preset:balanced": "node -e \"const { getPerformanceConfigManager } = require('./utils/performance-config-manager'); const c = getPerformanceConfigManager(); c.applyPreset('balanced'); c.saveConfig();\"",
    "config:preset:high": "node -e \"const { getPerformanceConfigManager } = require('./utils/performance-config-manager'); const c = getPerformanceConfigManager(); c.applyPreset('high-performance'); c.saveConfig();\"",
    "config:preset:extreme": "node -e \"const { getPerformanceConfigManager } = require('./utils/performance-config-manager'); const c = getPerformanceConfigManager(); c.applyPreset('extreme'); c.saveConfig();\"",
    "config:reset": "node -e \"const { getPerformanceConfigManager } = require('./utils/performance-config-manager'); const c = getPerformanceConfigManager(); c.reset(); c.saveConfig();\"",

    // 数据库优化
    "db:analyze": "node -e \"const { getDatabase } = require('./src/main/database'); const db = getDatabase(); db.db.exec('ANALYZE');\"",
    "db:vacuum": "node -e \"const { getDatabase } = require('./src/main/database'); const db = getDatabase(); db.db.exec('VACUUM');\"",
    "db:optimize": "npm run db:analyze && npm run db:vacuum",

    // 性能测试套件
    "test:perf": "npm run perf:benchmark",
    "test:perf:quick": "node test-scripts/performance-benchmark.js --quick",
    "test:perf:full": "node test-scripts/performance-benchmark.js --full",

    // 完整性能检查（基准测试 + 报告）
    "perf:check": "npm run perf:benchmark && npm run perf:report",

    // 性能优化一键应用（推荐配置）
    "perf:apply": "npm run config:preset:balanced && npm run db:optimize"
  }
}
```

---

## 使用说明

### 快速开始

```bash
# 1. 应用推荐配置并优化数据库
npm run perf:apply

# 2. 运行性能基准测试
npm run perf:benchmark

# 3. 查看性能报告
npm run perf:report
```

---

### 配置管理

```bash
# 查看当前配置
npm run config:show

# 应用平衡模式（推荐）
npm run config:preset:balanced

# 应用高性能模式
npm run config:preset:high

# 应用极限性能模式
npm run config:preset:extreme

# 重置为默认配置
npm run config:reset
```

---

### 性能测试

```bash
# 运行完整基准测试
npm run perf:benchmark

# 运行快速测试
npm run test:perf:quick

# 运行完整测试
npm run test:perf:full

# 完整性能检查
npm run perf:check
```

---

### 数据库优化

```bash
# 分析数据库统计信息
npm run db:analyze

# 清理数据库碎片
npm run db:vacuum

# 完整数据库优化
npm run db:optimize
```

---

### 性能监控

```bash
# 启动应用并启用性能监控
npm run perf:monitor

# 查看性能报告
npm run perf:report
```

---

## 脚本说明

| 脚本 | 功能 | 运行时间 |
|-----|------|---------|
| `perf:apply` | 一键应用推荐配置 | ~5秒 |
| `perf:benchmark` | 运行性能基准测试 | ~30秒 |
| `perf:monitor` | 启动性能监控模式 | 持续 |
| `perf:report` | 生成性能报告 | <1秒 |
| `config:preset:*` | 应用性能预设 | <1秒 |
| `db:optimize` | 优化数据库 | ~10秒 |

---

## 自动化工作流

### 每日例行检查

```bash
# 运行完整性能检查
npm run perf:check

# 如果发现性能下降，优化数据库
npm run db:optimize

# 重新测试
npm run perf:benchmark
```

### 发布前检查

```bash
# 1. 优化数据库
npm run db:optimize

# 2. 运行性能测试
npm run test:perf:full

# 3. 验证配置
npm run config:show

# 4. 构建应用
npm run build
```

### 性能调优流程

```bash
# 1. 建立基准
npm run perf:benchmark

# 2. 尝试不同预设
npm run config:preset:high
npm run perf:benchmark

npm run config:preset:extreme
npm run perf:benchmark

# 3. 选择最佳配置
npm run config:preset:balanced  # 根据测试结果选择

# 4. 保存配置
# 配置已自动保存
```

---

## CI/CD 集成

在 GitHub Actions 或其他CI中使用：

```yaml
# .github/workflows/performance-test.yml
name: Performance Test

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  performance:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Apply performance config
        run: npm run perf:apply

      - name: Run performance benchmark
        run: npm run perf:benchmark

      - name: Upload performance report
        uses: actions/upload-artifact@v3
        with:
          name: performance-report
          path: test-results/performance-report.json
```

---

## 高级用法

### 自定义脚本

你可以创建自己的性能脚本：

```json
{
  "scripts": {
    "perf:custom": "node -e \"const { getPerformanceMonitor } = require('./utils/performance-monitor'); const m = getPerformanceMonitor({ sampleInterval: 500 }); m.start(); setTimeout(() => { m.printReport(); process.exit(0); }, 60000);\""
  }
}
```

### 组合使用

```bash
# 完整性能优化流程
npm run db:optimize && \
npm run config:preset:high && \
npm run perf:benchmark && \
npm run perf:report
```

---

## 故障排除

### 脚本执行失败

```bash
# 检查Node.js版本
node -v  # 需要 >= 16.x

# 检查依赖
npm install

# 清除缓存
rm -rf node_modules/.cache
npm install
```

### 权限问题

```bash
# Linux/Mac
chmod +x test-scripts/*.js

# Windows（以管理员身份运行）
npm run perf:benchmark
```

---

**注意**: 某些脚本需要应用已初始化数据库。首次运行请先启动应用 `npm run dev`。
