# 性能自动调优

> **版本: v1.0.0+ | 实时监控 | 规则引擎 | 参数自动调整 | 负载预测**

## 概述

性能自动调优系统通过 6 阶段 AI 管道追踪（意图识别、任务规划、工具执行、RAG 检索、LLM 调用、完整管道）持续监控应用性能指标，并基于规则引擎自动调整配置参数。系统内置 5 条调优规则（数据库慢查询、碎片清理、LLM 高延迟、内存压力、P2P 连接数），支持冷却期防抖和 500 条历史回溯。

性能自动调优系统持续监控应用性能指标，通过规则引擎自动调整配置参数，确保最优运行状态。

## 核心特性

- 📊 **6 阶段管道追踪**: 从意图识别到完整管道，全链路性能监控与百分位统计（P50/P90/P95/P99）
- 🔍 **瓶颈自动识别**: 实时检测性能瓶颈，自动生成优化建议
- ⚙️ **5 条内置规则**: 数据库慢查询、数据库碎片、LLM 高延迟、内存压力、P2P 连接数自动调优
- ❄️ **冷却期防抖**: 每条规则 10 分钟冷却期，避免频繁调优震荡
- 📈 **调优历史记录**: 完整记录每次调优动作，支持 500 条历史回溯

## 系统架构

```
性能数据源
  │
  ▼
┌──────────────────────┐
│  PerformanceMonitor   │
│  (6阶段管道追踪)      │
│  ├─ intent_recognition│
│  ├─ task_planning     │
│  ├─ tool_execution    │
│  ├─ rag_retrieval     │
│  ├─ llm_calls         │
│  └─ total_pipeline    │
└──────────┬───────────┘
           │ 指标采集 (每5分钟)
           ▼
┌──────────────────────┐
│     AutoTuner         │
│  ┌────────────────┐  │
│  │   规则引擎      │  │
│  │ (5内置+自定义)  │  │
│  └───────┬────────┘  │
│          ▼           │
│  ┌────────────────┐  │
│  │ 冷却期检查     │  │
│  └───────┬────────┘  │
│          ▼           │
│  ┌────────────────┐  │
│  │ 调优动作执行   │  │
│  └────────────────┘  │
└──────────────────────┘
```

## 系统概述

### 双层架构

```
性能系统
├─ PerformanceMonitor (监控层)
│   ├─ 6 阶段 AI 管道性能追踪
│   ├─ 百分位统计 (P50/P90/P95/P99)
│   ├─ 瓶颈识别
│   └─ 优化建议生成
└─ AutoTuner (调优层)
    ├─ 规则引擎（内置 + 自定义规则）
    ├─ 冷却期防抖
    ├─ 调优历史记录
    └─ 自动参数调整
```

---

## 性能监控

### 追踪的管道阶段

| 阶段                 | 说明     | 警告阈值 | 危险阈值 |
| -------------------- | -------- | -------- | -------- |
| `intent_recognition` | 意图识别 | 可配置   | 可配置   |
| `task_planning`      | 任务规划 | 可配置   | 可配置   |
| `tool_execution`     | 工具执行 | 可配置   | 可配置   |
| `rag_retrieval`      | RAG 检索 | 可配置   | 可配置   |
| `llm_calls`          | LLM 调用 | 可配置   | 可配置   |
| `total_pipeline`     | 完整管道 | 可配置   | 可配置   |

### 统计指标

```
每个阶段统计:
├─ 平均耗时 (Mean)
├─ P50 (中位数)
├─ P90
├─ P95
├─ P99
├─ 最小值 / 最大值
├─ 调用次数
└─ 异常比例
```

### 瓶颈识别

系统自动识别管道中的性能瓶颈并生成优化建议：

```
瓶颈分析:
  RAG 检索阶段 P95 = 2500ms (警告)
  → 建议: 优化向量索引, 减少检索文档数量
  → 建议: 启用 BM25 预过滤减少候选集
```

---

## 自动调优

### 内置规则

| 规则               | 触发条件       | 调优动作                   | 冷却期 |
| ------------------ | -------------- | -------------------------- | ------ |
| `db-slow-queries`  | 数据库查询慢   | 增大 SQLite 缓存，启用 WAL | 10分钟 |
| `db-vacuum`        | 数据库碎片多   | 执行 VACUUM                | 10分钟 |
| `llm-high-latency` | LLM 响应慢     | 缩小上下文窗口             | 10分钟 |
| `memory-pressure`  | 内存压力大     | 触发 GC，发出警告          | 10分钟 |
| `p2p-connections`  | P2P 连接数过多 | 降低连接上限               | 10分钟 |

### 规则引擎配置

```json
{
  "autoTuner": {
    "evaluationIntervalMs": 300000,
    "cooldownMs": 600000,
    "maxHistoryEntries": 500,
    "rules": [
      {
        "name": "custom-rule",
        "condition": "metrics.cpuUsage > 80",
        "action": "reduceParallelism",
        "cooldownMs": 300000
      }
    ]
  }
}
```

### 调优流程

```
1. 定期采集性能指标（默认每 5 分钟）
2. 评估所有规则条件
3. 条件满足 → 检查冷却期
4. 冷却期已过 → 执行调优动作
5. 记录调优历史
6. 发出事件通知
```

---

## 数据库表

### `performance_metrics`

| 字段         | 类型     | 说明             |
| ------------ | -------- | ---------------- |
| `id`         | INTEGER  | 主键             |
| `phase`      | TEXT     | 管道阶段         |
| `duration`   | REAL     | 耗时（毫秒）     |
| `metadata`   | TEXT     | 附加信息（JSON） |
| `session_id` | TEXT     | 会话 ID          |
| `created_at` | DATETIME | 记录时间         |

---

## 关键文件

| 文件                                          | 职责                     |
| --------------------------------------------- | ------------------------ |
| `src/main/monitoring/performance-monitor.js`  | 性能监控器（6 阶段追踪） |
| `src/main/performance/auto-tuner.js`          | 自动调优引擎（规则引擎） |
| `src/main/performance/performance-monitor.js` | 性能数据采集器           |

## 使用示例

### 查看性能瓶颈

1. 打开「性能调优」页面，查看 6 阶段管道统计
2. 关注 P95/P99 延迟超过阈值的阶段（标红显示）
3. 系统自动生成优化建议（如"优化向量索引"）
4. 按建议调整配置后观察指标变化

### 配置自动调优规则

1. 在配置文件中添加自定义调优规则
2. 设置触发条件（如 `metrics.cpuUsage > 80`）和调优动作
3. 配置冷却期防止频繁调优（推荐 5-10 分钟）
4. 规则引擎每 5 分钟自动评估并执行

### 查看调优历史

1. 切换到「调优历史」标签页
2. 查看每次自动调优的触发规则、执行动作和效果
3. 分析调优趋势，识别反复触发的规则
4. 根据历史数据优化规则参数

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 性能数据未采集 | 监控模块未初始化 | 重启应用，确认 PerformanceMonitor 已加载 |
| 自动调优不触发 | 冷却期未过或条件未满足 | 检查冷却期配置（默认 10 分钟），确认指标达到阈值 |
| 调优后性能反而下降 | 规则动作不适合当前场景 | 调整规则条件和动作，增大冷却期避免震荡 |
| P99 延迟持续偏高 | 系统整体负载过重 | 排查资源瓶颈（CPU/内存/磁盘），考虑扩容 |
| 历史记录超过 500 条 | 调优频率过高 | 增大评估间隔和冷却期，减少不必要的调优 |
| 数据库慢查询规则误触发 | 阈值设置过低 | 根据实际业务场景调整慢查询阈值 |

## 配置参考

### 完整配置项

在 `.chainlesschain/config.json` 中配置：

```json
{
  "performanceTuning": {
    "monitor": {
      "enabled": true,
      "evaluationIntervalMs": 300000,
      "retentionDays": 30,
      "stages": {
        "intent_recognition": { "warnMs": 200, "criticalMs": 500 },
        "task_planning":      { "warnMs": 500, "criticalMs": 1000 },
        "tool_execution":     { "warnMs": 2000, "criticalMs": 5000 },
        "rag_retrieval":      { "warnMs": 1500, "criticalMs": 3000 },
        "llm_calls":          { "warnMs": 5000, "criticalMs": 15000 },
        "total_pipeline":     { "warnMs": 8000, "criticalMs": 20000 }
      }
    },
    "autoTuner": {
      "enabled": true,
      "cooldownMs": 600000,
      "maxHistoryEntries": 500,
      "rules": {
        "db-slow-queries":  { "enabled": true, "thresholdMs": 100 },
        "db-vacuum":        { "enabled": true, "fragmentRatio": 0.3 },
        "llm-high-latency": { "enabled": true, "p95ThresholdMs": 10000 },
        "memory-pressure":  { "enabled": true, "heapUsageRatio": 0.85 },
        "p2p-connections":  { "enabled": true, "maxConnections": 50 }
      },
      "customRules": []
    }
  }
}
```

### 环境变量

| 变量                             | 默认值   | 说明                     |
| -------------------------------- | -------- | ------------------------ |
| `PERF_MONITOR_INTERVAL_MS`       | `300000` | 指标采集间隔（毫秒）     |
| `PERF_TUNER_COOLDOWN_MS`         | `600000` | 调优规则冷却期（毫秒）   |
| `PERF_TUNER_MAX_HISTORY`         | `500`    | 最大历史记录条数         |
| `PERF_LLM_LATENCY_THRESHOLD_MS`  | `10000`  | LLM 高延迟触发阈值       |
| `PERF_DB_SLOW_QUERY_THRESHOLD_MS`| `100`    | 数据库慢查询触发阈值     |

---

## 性能指标

### 基准测试结果

> 测试环境：Intel Core i7-12700K / 32GB RAM / NVMe SSD / Windows 10 Pro

| 指标                     | 典型值   | P95 值   | 目标上限  |
| ------------------------ | -------- | -------- | --------- |
| 意图识别延迟             | 45 ms    | 120 ms   | 200 ms    |
| 任务规划延迟             | 180 ms   | 420 ms   | 500 ms    |
| RAG 检索延迟（10 文档）  | 320 ms   | 890 ms   | 1500 ms   |
| LLM 调用延迟（qwen2:7b） | 1800 ms  | 4200 ms  | 5000 ms   |
| 完整管道端到端延迟       | 2800 ms  | 6500 ms  | 8000 ms   |
| 指标采集开销             | < 1 ms   | < 3 ms   | < 5 ms    |
| 规则引擎评估耗时（5 规则）| < 2 ms  | < 5 ms   | < 10 ms   |

### 内存占用

| 组件                  | 空闲内存  | 峰值内存  |
| --------------------- | --------- | --------- |
| PerformanceMonitor    | ~2 MB     | ~8 MB     |
| AutoTuner（500 历史） | ~4 MB     | ~12 MB    |
| 性能指标数据库        | ~10 MB    | ~50 MB    |

### 调优效果

内置规则在典型场景下的实测改善效果：

| 规则               | 改善场景                     | 平均改善幅度 |
| ------------------ | ---------------------------- | ------------ |
| `db-slow-queries`  | 启用 WAL 后高并发写入        | 延迟降低 40% |
| `db-vacuum`        | 碎片率 > 30% 时执行 VACUUM   | 查询提速 15% |
| `llm-high-latency` | 缩小上下文窗口后响应加速     | 延迟降低 25% |
| `memory-pressure`  | GC 触发后内存回收            | 堆降低 30%   |
| `p2p-connections`  | 降低连接上限后网络稳定性提升 | 丢包减少 20% |

---

## 测试覆盖率

### 测试文件

| 测试文件                                                    | 测试数 | 覆盖模块                     |
| ----------------------------------------------------------- | ------ | ---------------------------- |
| `tests/unit/monitoring/performance-monitor.test.js`        | 24     | 6 阶段追踪、百分位统计       |
| `tests/unit/performance/auto-tuner.test.js`                 | 31     | 规则引擎、冷却期、历史记录   |
| `tests/unit/performance/auto-tuner-rules.test.js`           | 18     | 5 条内置规则触发与执行       |
| `tests/unit/performance/performance-monitor.test.js`        | 12     | 数据采集与持久化             |
| `tests/integration/performance/tuner-monitor.test.js`       | 9      | 监控→调优端到端联动          |

**总计: 94 个测试**

### 覆盖率摘要

| 模块                       | 语句覆盖率 | 分支覆盖率 | 函数覆盖率 |
| -------------------------- | ---------- | ---------- | ---------- |
| `performance-monitor.js`   | 96%        | 91%        | 100%       |
| `auto-tuner.js`            | 94%        | 89%        | 100%       |

### 运行测试

```bash
# 单元测试
cd desktop-app-vue && npx vitest run tests/unit/performance/

# 集成测试
cd desktop-app-vue && npx vitest run tests/integration/performance/

# 全部性能模块测试
cd desktop-app-vue && npx vitest run tests/unit/monitoring/ tests/unit/performance/ tests/integration/performance/
```

---

## 安全考虑

- **只读监控**: 性能监控仅采集指标数据，不修改业务逻辑
- **调优范围限制**: 自动调优仅调整预定义的配置参数，不执行任意命令
- **冷却期防抖**: 每条规则设有冷却期，防止快速连续调优导致系统不稳定
- **历史审计**: 所有调优动作完整记录，支持回溯和问责
- **权限控制**: 调优规则的增删改需要管理员权限
- **指标数据保护**: 性能指标存储在加密数据库中，防止信息泄露
- **资源保护**: 调优动作不会超出系统安全边界（如不会关闭安全模块）

## 相关文档

- [生产加固](/chainlesschain/production-hardening) - 性能基线与安全审计
- [自主运维](/chainlesschain/autonomous-ops) - 告警与自动修复
- [数据分析仪表盘](/chainlesschain/analytics) - 实时 KPI 监控与报告
