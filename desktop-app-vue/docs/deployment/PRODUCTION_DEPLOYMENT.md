# 生产环境部署指南

本指南提供ChainlessChain三大高级特性的生产环境部署完整流程。

## 目录

1. [部署前检查](#部署前检查)
2. [部署步骤](#部署步骤)
3. [配置调优](#配置调优)
4. [监控与维护](#监控与维护)
5. [故障排查](#故障排查)
6. [回滚方案](#回滚方案)

---

## 部署前检查

### 系统要求

- [ ] **Node.js**: >= 14.0.0
- [ ] **操作系统**: Windows 10/11 或 Server 2016+
- [ ] **磁盘空间**: >= 10GB 可用空间
- [ ] **内存**: >= 4GB RAM (推荐8GB)
- [ ] **数据库**: SQLite (已内置)

### 验证环境

```bash
# 检查Node.js版本
node --version

# 检查npm版本
npm --version

# 检查磁盘空间 (Windows PowerShell)
Get-PSDrive C | Select-Object Used,Free

# 检查内存
systeminfo | findstr /C:"Total Physical Memory"
```

### 数据备份

**重要**: 部署前务必备份数据库

```bash
# 备份数据库
cd C:\code\chainlesschain\data
copy chainlesschain.db chainlesschain.db.backup.%date:~0,4%%date:~5,2%%date:~8,2%

# 验证备份
dir chainlesschain.db*
```

### 依赖检查

- [ ] 主应用已安装并初始化
- [ ] 数据库文件存在: `data/chainlesschain.db`
- [ ] 有足够的历史数据(建议至少7天运行数据)

---

## 部署步骤

### 第一阶段: 准备阶段 (第1天)

#### 1.1 文件部署

确认以下文件已部署:

```
desktop-app-vue/
├── adaptive-threshold.js          # 自适应阈值调整
├── online-learning.js             # 模型在线学习
├── advanced-optimizer.js          # 高级优化器
├── production-integration.js      # 生产集成主脚本
├── start-production.bat           # 启动脚本
├── stop-production.bat            # 停止脚本
├── status-production.bat          # 状态查看脚本
└── config/
    └── advanced-features.json     # 配置文件
```

#### 1.2 创建日志目录

```bash
cd desktop-app-vue
mkdir logs
```

#### 1.3 配置文件检查

检查 `config/advanced-features.json`:

```json
{
  "adaptiveThreshold": {
    "enabled": true,         // ✓ 确认启用
    "interval": 60           // ✓ 调整检查间隔(分钟)
  },
  "onlineLearning": {
    "enabled": true,         // ✓ 确认启用
    "trainDays": 30          // ✓ 训练数据天数
  },
  "advancedOptimizer": {
    "enabled": true          // ✓ 确认启用
  }
}
```

#### 1.4 环境检查

```bash
cd desktop-app-vue
node production-integration.js health
```

**预期输出**:
```
✓ 数据库文件: 通过
✓ 日志目录: 通过
✓ Node.js版本: 通过
✓ 配置文件: 通过
```

### 第二阶段: 试运行 (第2-7天)

#### 2.1 启动服务

```bash
cd desktop-app-vue
start-production.bat
```

**验证启动成功**:
```bash
# 查看状态
status-production.bat

# 预期看到所有进程running: true
```

#### 2.2 监控日志

```bash
# 实时查看日志 (PowerShell)
Get-Content -Path logs\production-integration.log -Wait

# 或使用批处理
tail -f logs\production-integration.log
```

**关键日志检查点**:

```
[INFO] 环境检查完成，所有检查通过
[INFO] 自适应阈值调整已启动
[INFO] 模型在线学习定时任务已设置
[INFO] 高级优化器定时任务已设置
[INFO] 健康检查已启动
[INFO] 所有服务已启动
```

#### 2.3 验证功能

**自适应阈值调整**:
```bash
# 查看监控结果
node adaptive-threshold.js monitor --days=7
```

**在线学习**:
```bash
# 查看学习统计
node online-learning.js stats
```

**高级优化器**:
```bash
# 执行瓶颈检测
node advanced-optimizer.js bottleneck --days=7
```

#### 2.4 性能基线测试

记录初始性能指标:

| 指标 | 值 | 日期 |
|------|-----|------|
| 小模型使用率 | ___% | __________ |
| 成功率 | ___% | __________ |
| 成本节约 | ___% | __________ |
| 平均响应时间 | ___ms | __________ |

### 第三阶段: 全面部署 (第8天起)

#### 3.1 设置自动启动

**方法1: Windows任务计划程序**

1. 打开"任务计划程序"
2. 创建基本任务
   - 名称: "ChainlessChain 生产集成"
   - 触发器: "计算机启动时"
   - 操作: 启动程序
     - 程序: `C:\code\chainlesschain\desktop-app-vue\start-production.bat`
     - 起始于: `C:\code\chainlesschain\desktop-app-vue`

**方法2: 注册为Windows服务 (推荐)**

使用 `node-windows` 包:

```bash
npm install -g node-windows

# 创建服务安装脚本
node install-service.js
```

`install-service.js`:
```javascript
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'ChainlessChain Production',
  description: 'ChainlessChain 生产环境集成服务',
  script: 'C:\\code\\chainlesschain\\desktop-app-vue\\production-integration.js',
  nodeOptions: ['--harmony', '--max_old_space_size=4096']
});

svc.on('install', () => {
  svc.start();
});

svc.install();
```

#### 3.2 配置监控告警

**日志监控**:
- 每日检查日志文件
- 关注ERROR和WARN级别日志
- 设置日志文件大小阈值告警

**性能监控**:
- 监控小模型使用率(目标: 40-60%)
- 监控成功率(目标: >95%)
- 监控评分(告警阈值: <70)

**系统监控**:
- CPU使用率
- 内存占用
- 磁盘空间

#### 3.3 定期维护计划

| 频率 | 任务 |
|------|------|
| **每日** | 查看日志摘要 |
| **每周** | 性能报告审查 |
| **每月** | 配置优化调整 |
| **每季度** | 全面性能审计 |

---

## 配置调优

### 自适应阈值调整

#### 场景1: 小模型使用率过低 (<40%)

```json
{
  "adaptiveThreshold": {
    "targets": {
      "smallModelRate": {
        "min": 45,    // 提高最低目标
        "max": 65,
        "ideal": 50   // 提高理想值
      }
    }
  }
}
```

#### 场景2: 成功率下降 (<90%)

```json
{
  "adaptiveThreshold": {
    "adjustment": {
      "learningRate": 0.02,  // 降低学习率，更保守调整
      "maxAdjustment": 0.05  // 减小最大调整幅度
    }
  }
}
```

#### 场景3: 阈值震荡不收敛

```json
{
  "adaptiveThreshold": {
    "adjustment": {
      "minSampleSize": 100,        // 增加样本量
      "cooldownPeriod": 7200000    // 延长冷却期到2小时
    }
  }
}
```

### 在线学习

#### 场景1: 训练数据不足

```json
{
  "onlineLearning": {
    "trainDays": 60,  // 增加训练窗口
    "models": {
      "complexityEstimator": {
        "minSampleSize": 1000  // 提高最小样本要求
      }
    }
  }
}
```

#### 场景2: 模型过拟合

```json
{
  "onlineLearning": {
    "models": {
      "complexityEstimator": {
        "learningRate": 0.005  // 降低学习率
      },
      "intentRecognizer": {
        "confidenceThreshold": 0.8  // 提高置信度阈值
      }
    }
  }
}
```

### 高级优化器

#### 场景1: 内存占用过高

```json
{
  "advancedOptimizer": {
    "config": {
      "predictiveCache": {
        "maxPredictions": 5,      // 减少预测数量
        "cacheExpiry": 600000     // 缩短过期时间(10分钟)
      }
    }
  }
}
```

#### 场景2: CPU使用率高

```json
{
  "advancedOptimizer": {
    "config": {
      "parallelOptimization": {
        "maxParallelTasks": 2,    // 降低并行度
        "cpuThreshold": 0.6       // 降低CPU阈值
      }
    }
  }
}
```

---

## 监控与维护

### 日常监控检查清单

#### 每日检查 (5分钟)

```bash
# 1. 查看服务状态
status-production.bat

# 2. 检查最新日志
powershell -Command "Get-Content -Path logs\production-integration.log -Tail 50"

# 3. 查看错误日志
findstr /C:"[ERROR]" logs\production-integration.log
```

#### 每周检查 (30分钟)

```bash
# 1. 性能评估
node adaptive-threshold.js monitor --days=7
node online-learning.js evaluate
node advanced-optimizer.js bottleneck --days=7

# 2. 数据库优化
sqlite3 ../data/chainlesschain.db "VACUUM;"
sqlite3 ../data/chainlesschain.db "ANALYZE;"

# 3. 日志分析
# 统计错误数量
findstr /C:"[ERROR]" logs\production-integration.log | find /C "[ERROR]"

# 4. 生成周报
node generate-weekly-report.js
```

#### 每月检查 (2小时)

```bash
# 1. 全面优化
node advanced-optimizer.js optimize

# 2. 模型重训练
node online-learning.js train --days=60

# 3. 配置审查
# 根据性能数据调整配置参数

# 4. 数据清理
# 删除90天前的历史数据
sqlite3 ../data/chainlesschain.db "DELETE FROM knowledge_distillation_history WHERE created_at < datetime('now', '-90 days');"

# 5. 备份数据
copy ..\data\chainlesschain.db ..\data\backups\chainlesschain.db.%date:~0,4%%date:~5,2%%date:~8,2%
```

### 性能指标监控

#### 关键性能指标 (KPI)

| 指标 | 目标值 | 告警阈值 | 检查频率 |
|------|--------|----------|----------|
| 小模型使用率 | 40-60% | <35% 或 >65% | 每日 |
| 成功率 | >95% | <90% | 每日 |
| 成本节约 | >60% | <50% | 每周 |
| 综合评分 | >85 | <70 | 每日 |
| 复杂度预测准确率 | >85% | <80% | 每周 |
| 意图识别准确率 | >80% | <75% | 每周 |
| 工具推荐采纳率 | >75% | <70% | 每周 |

#### 监控脚本示例

`monitor-kpis.js`:
```javascript
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('../data/chainlesschain.db');

// 查询最近7天的KPI
db.all(`
  SELECT
    AVG(CASE WHEN selected_model = 'small' THEN 100.0 ELSE 0.0 END) as small_model_rate,
    AVG(CASE WHEN is_success = 1 THEN 100.0 ELSE 0.0 END) as success_rate,
    AVG(cost_savings) as avg_cost_savings
  FROM knowledge_distillation_history
  WHERE created_at >= datetime('now', '-7 days')
`, (err, rows) => {
  if (err) {
    console.error('查询失败:', err);
    return;
  }

  const kpi = rows[0];
  console.log('最近7天 KPI:');
  console.log(`- 小模型使用率: ${kpi.small_model_rate.toFixed(1)}%`);
  console.log(`- 成功率: ${kpi.success_rate.toFixed(1)}%`);
  console.log(`- 成本节约: ${kpi.avg_cost_savings.toFixed(1)}%`);

  // 告警检查
  if (kpi.small_model_rate < 35 || kpi.small_model_rate > 65) {
    console.warn('⚠️ 小模型使用率异常');
  }
  if (kpi.success_rate < 90) {
    console.error('🚨 成功率过低');
  }
  if (kpi.avg_cost_savings < 50) {
    console.warn('⚠️ 成本节约不足');
  }
});
```

### 日志管理

#### 日志级别

- **DEBUG**: 调试信息(开发环境)
- **INFO**: 正常运行信息
- **WARN**: 警告(需要关注)
- **ERROR**: 错误(需要处理)

#### 日志轮转

自动轮转配置:
- 单文件大小: 10MB
- 保留文件数: 5个
- 总计最大: 50MB

#### 日志分析

```bash
# 统计各级别日志
findstr /C:"[INFO]" logs\production-integration.log | find /C "[INFO]"
findstr /C:"[WARN]" logs\production-integration.log | find /C "[WARN]"
findstr /C:"[ERROR]" logs\production-integration.log | find /C "[ERROR]"

# 查找特定错误
findstr /C:"调整失败" logs\production-integration.log
findstr /C:"训练失败" logs\production-integration.log

# 导出最近24小时日志
powershell -Command "$date = (Get-Date).AddDays(-1); Get-Content logs\production-integration.log | Where-Object { $_ -match '\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})' -and [datetime]::Parse($Matches[1]) -gt $date }" > logs\last-24h.log
```

---

## 故障排查

### 常见问题诊断

#### 问题1: 服务启动失败

**症状**:
```
[错误] 启动失败
环境检查未通过
```

**排查步骤**:
1. 检查数据库文件
   ```bash
   dir ..\data\chainlesschain.db
   ```

2. 检查Node.js版本
   ```bash
   node --version
   # 应该 >= 14.0.0
   ```

3. 检查日志目录权限
   ```bash
   mkdir logs
   ```

4. 查看详细错误
   ```bash
   node production-integration.js health
   ```

#### 问题2: 进程异常退出

**症状**:
```
[WARN] 自适应阈值调整进程退出，代码: 1
```

**排查步骤**:
1. 查看错误日志
   ```bash
   findstr /C:"[自适应阈值]" logs\production-integration.log | findstr /C:"[ERROR]"
   ```

2. 检查数据库锁定
   ```sql
   -- 查看活跃连接
   PRAGMA database_list;
   ```

3. 手动测试
   ```bash
   node adaptive-threshold.js monitor
   ```

4. 检查资源占用
   ```bash
   tasklist | findstr node.exe
   ```

#### 问题3: 性能下降

**症状**: 评分持续 < 70

**排查步骤**:
1. 分析各项指标
   ```bash
   node adaptive-threshold.js monitor --days=30
   ```

2. 检查数据质量
   ```sql
   SELECT
     COUNT(*) as total,
     AVG(execution_time_ms) as avg_time,
     AVG(CASE WHEN is_success = 1 THEN 1.0 ELSE 0.0 END) as success_rate
   FROM knowledge_distillation_history
   WHERE created_at >= datetime('now', '-7 days');
   ```

3. 查看失败案例
   ```sql
   SELECT user_input, actual_complexity, selected_model, error_message
   FROM knowledge_distillation_history
   WHERE is_success = 0
   ORDER BY created_at DESC
   LIMIT 20;
   ```

4. 调整配置(见配置调优章节)

#### 问题4: 内存占用过高

**症状**: 进程内存 > 2GB

**排查步骤**:
1. 查看进程内存
   ```bash
   tasklist /FI "IMAGENAME eq node.exe" /FO TABLE
   ```

2. 检查缓存配置
   ```json
   {
     "predictiveCache": {
       "maxPredictions": 5  // 降低
     }
   }
   ```

3. 清理历史数据
   ```sql
   DELETE FROM knowledge_distillation_history
   WHERE created_at < datetime('now', '-30 days');
   VACUUM;
   ```

4. 重启服务
   ```bash
   stop-production.bat
   start-production.bat
   ```

### 紧急响应流程

#### 严重故障 (P0)

**定义**: 服务完全不可用

**响应时间**: 立即

**处理步骤**:
1. 停止所有服务
   ```bash
   stop-production.bat
   ```

2. 备份当前日志
   ```bash
   copy logs\production-integration.log logs\emergency-%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%.log
   ```

3. 检查数据库完整性
   ```bash
   sqlite3 ../data/chainlesschain.db "PRAGMA integrity_check;"
   ```

4. 恢复备份(如需要)
   ```bash
   copy ..\data\chainlesschain.db.backup.YYYYMMDD ..\data\chainlesschain.db
   ```

5. 重新启动
   ```bash
   start-production.bat
   ```

6. 验证恢复
   ```bash
   status-production.bat
   ```

#### 一般故障 (P1)

**定义**: 部分功能异常

**响应时间**: 2小时内

**处理步骤**:
1. 识别故障组件
2. 查看组件日志
3. 尝试组件重启
4. 如无法恢复，禁用该组件
5. 提交问题报告

---

## 回滚方案

### 完全回滚

**场景**: 严重问题无法修复

**步骤**:

1. **停止生产服务**
   ```bash
   stop-production.bat
   ```

2. **恢复数据库备份**
   ```bash
   # 备份当前数据库
   copy ..\data\chainlesschain.db ..\data\chainlesschain.db.before-rollback

   # 恢复备份
   copy ..\data\chainlesschain.db.backup.YYYYMMDD ..\data\chainlesschain.db
   ```

3. **移除集成脚本**(可选)
   ```bash
   # 重命名而非删除
   ren production-integration.js production-integration.js.disabled
   ```

4. **验证主应用**
   ```bash
   # 启动主应用，确认正常工作
   ```

5. **记录回滚原因**
   - 创建 `rollback-report.md`
   - 记录问题详情
   - 记录回滚时间
   - 记录影响范围

### 部分回滚

**场景**: 某个特性有问题

**步骤**:

1. **编辑配置文件**
   ```json
   {
     "adaptiveThreshold": {
       "enabled": false  // 禁用有问题的特性
     }
   }
   ```

2. **重启服务**
   ```bash
   stop-production.bat
   start-production.bat
   ```

3. **验证其他特性**
   ```bash
   status-production.bat
   ```

### 数据恢复

**场景**: 配置错误导致数据异常

**步骤**:

1. **停止服务**
   ```bash
   stop-production.bat
   ```

2. **导出异常数据(用于分析)**
   ```sql
   .output data-anomaly.sql
   SELECT * FROM knowledge_distillation_history
   WHERE created_at >= datetime('now', '-1 days');
   .quit
   ```

3. **恢复备份**
   ```bash
   copy ..\data\chainlesschain.db.backup.YYYYMMDD ..\data\chainlesschain.db
   ```

4. **验证数据完整性**
   ```bash
   sqlite3 ../data/chainlesschain.db "PRAGMA integrity_check;"
   ```

5. **重启服务**
   ```bash
   start-production.bat
   ```

---

## 部署检查清单

### 部署前

- [ ] 已阅读完整部署指南
- [ ] 已备份数据库
- [ ] 已验证系统要求
- [ ] 已准备回滚方案
- [ ] 已通知相关人员

### 部署中

- [ ] 所有文件已部署
- [ ] 配置文件已检查
- [ ] 环境检查通过
- [ ] 服务启动成功
- [ ] 日志显示正常

### 部署后

- [ ] 功能验证通过
- [ ] 性能基线已记录
- [ ] 监控已配置
- [ ] 文档已更新
- [ ] 部署报告已提交

---

## 联系支持

如遇到无法解决的问题:

1. 收集以下信息:
   - 错误日志
   - 配置文件
   - 环境信息
   - 重现步骤

2. 创建问题报告:
   ```
   问题描述:
   发生时间:
   影响范围:
   已尝试方案:
   ```

3. 提交到 GitHub Issues

---

**文档版本**: 1.0.0
**最后更新**: 2026-01-02
**维护者**: ChainlessChain Team
