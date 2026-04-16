# 联邦压力测试

> **Phase 59 | v2.0.0 | 4 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 🔥 **可配置负载**: 节点数、并发任务数、持续时间自由组合，最大支持 100 节点
- 📊 **实时指标采集**: 延迟百分位（p50/p95/p99）、吞吐 TPS、内存峰值全面监控
- 📈 **历史对比分析**: 保存每次测试运行和结果，支持跨版本性能趋势对比
- 🛑 **安全停止**: 随时中止运行中的测试，防止资源过载
- 🗄️ **持久化存储**: 测试运行和结果独立存表，完整的审计和回溯能力

## 系统架构

```
┌──────────────┐
│  Renderer    │
│  (IPC调用)   │
└──────┬───────┘
       │ IPC (4 通道)
       ▼
┌──────────────────────────────┐
│      Stress Test Engine      │
│  ┌─────────┐  ┌───────────┐ │
│  │ Load    │  │ Metrics   │ │
│  │ Generator│  │ Collector │ │
│  │ (Nodes) │  │ (p50-p99) │ │
│  └────┬────┘  └─────┬─────┘ │
│       │              │       │
│  ┌────▼──────────────▼────┐  │
│  │   Run Manager          │  │
│  │   (Start/Stop/Query)   │  │
│  └────────────┬───────────┘  │
└───────────────┼──────────────┘
                │
       ┌────────▼────────┐
       │  SQLite (2表)   │
       │  stress_test_   │
       │  runs / results │
       └─────────────────┘
```

## 概述

Phase 59 为联邦代理网络提供 100 节点规模压力测试能力，验证系统在高并发场景下的稳定性和吞吐极限。

**核心目标**:

- **可配置负载**: 节点数、并发任务数、持续时间自由组合
- **实时指标**: 延迟百分位（p50/p95/p99）、吞吐 TPS、内存峰值
- **历史对比**: 保存每次测试运行和结果，支持趋势分析
- **安全停止**: 随时中止运行中的测试

---

## 核心功能

### 1. 启动压力测试

```javascript
const result = await window.electronAPI.invoke('stress-test:start', {
  name: '100-node-load-test',
  nodeCount: 100,
  concurrentTasks: 50,
  durationMs: 120000  // 2 分钟
});

console.log(result);
// {
//   run: {
//     id: 'str-001',
//     name: '100-node-load-test',
//     nodeCount: 100,
//     concurrentTasks: 50,
//     status: 'COMPLETE'
//   },
//   result: {
//     totalTasks: 5000,
//     successfulTasks: 4950,
//     failedTasks: 50,
//     avgLatencyMs: 23.4,
//     p95LatencyMs: 85.2,
//     p99LatencyMs: 210.5,
//     throughputTps: 41.6,
//     peakMemoryMb: 512,
//     errors: [{ type: 'TIMEOUT', count: 30 }, ...]
//   }
// }
```

### 2. 停止测试

```javascript
await window.electronAPI.invoke('stress-test:stop');
```

### 3. 查看历史

```javascript
// 获取测试运行列表
const runs = await window.electronAPI.invoke('stress-test:get-runs', {
  filter: { status: 'COMPLETE' }
});

// 获取某次运行的详细结果
const results = await window.electronAPI.invoke('stress-test:get-results', {
  runId: 'str-001'
});
```

---

## 测试状态

| 状态         | 说明                       |
| ------------ | -------------------------- |
| **PENDING**  | 测试已创建，等待执行       |
| **RUNNING**  | 测试正在运行               |
| **COMPLETE** | 测试正常完成               |
| **STOPPED**  | 用户手动停止               |
| **FAILED**   | 测试异常终止               |

---

## 结果指标

| 指标              | 说明                 | KPI 目标         |
| ----------------- | -------------------- | ---------------- |
| `totalTasks`      | 总执行任务数         | —                |
| `successfulTasks` | 成功任务数           | 成功率 > 95%     |
| `avgLatencyMs`    | 平均延迟             | < 50ms           |
| `p95LatencyMs`    | P95 延迟             | < 200ms          |
| `p99LatencyMs`    | P99 延迟             | < 500ms          |
| `throughputTps`   | 吞吐量（事务/秒）   | > 30 TPS         |
| `peakMemoryMb`    | 内存峰值             | < 1GB            |

---

## IPC 通道

| 通道                     | 参数                                               | 返回值         |
| ------------------------ | -------------------------------------------------- | -------------- |
| `stress-test:start`      | `{ name, nodeCount?, concurrentTasks?, durationMs? }` | 运行+结果    |
| `stress-test:stop`       | 无                                                 | 操作结果       |
| `stress-test:get-runs`   | `{ filter? }`                                      | 运行列表       |
| `stress-test:get-results`| `{ runId }`                                        | 结果详情       |

---

## 数据库表

### stress_test_runs

| 字段             | 类型    | 说明         |
| ---------------- | ------- | ------------ |
| id               | TEXT PK | 运行 ID      |
| name             | TEXT    | 测试名称     |
| node_count       | INTEGER | 模拟节点数   |
| concurrent_tasks | INTEGER | 并发任务数   |
| duration_ms      | INTEGER | 测试时长     |
| status           | TEXT    | 运行状态     |
| started_at       | INTEGER | 开始时间     |
| completed_at     | INTEGER | 完成时间     |

### stress_test_results

| 字段              | 类型    | 说明              |
| ----------------- | ------- | ----------------- |
| id                | TEXT PK | 结果 ID           |
| run_id            | TEXT FK | 关联运行 ID       |
| total_tasks       | INTEGER | 总任务数           |
| successful_tasks  | INTEGER | 成功数             |
| failed_tasks      | INTEGER | 失败数             |
| avg_latency_ms    | REAL    | 平均延迟           |
| p95_latency_ms    | REAL    | P95 延迟           |
| p99_latency_ms    | REAL    | P99 延迟           |
| throughput_tps    | REAL    | 吞吐量             |
| peak_memory_mb    | REAL    | 内存峰值           |
| errors            | JSON    | 错误分类统计       |

---

## 相关链接

- [联邦网络加固](/chainlesschain/federation-hardening)
- [信誉优化](/chainlesschain/reputation-optimizer)
- [跨组织 SLA](/chainlesschain/sla-manager)

## 关键文件

| 文件 | 职责 | 行数 |
| --- | --- | --- |
| `src/main/enterprise/stress-test-engine.js` | 压力测试核心引擎 | ~350 |
| `src/main/enterprise/load-generator.js` | 负载生成与节点模拟 | ~280 |
| `src/main/enterprise/metrics-collector.js` | 指标采集与百分位计算 | ~220 |
| `src/main/ipc/ipc-stress-test.js` | IPC 处理器注册 | ~100 |

## 使用示例

### 运行 100 节点压力测试

1. 打开「压力测试」页面，点击「新建测试」
2. 输入测试名称，设置节点数为 100，并发任务数为 50
3. 设置持续时间（推荐 2 分钟用于快速验证）
4. 点击「启动」，实时查看指标变化
5. 测试完成后查看结果报告：成功率、延迟百分位、TPS

### 对比历史测试结果

1. 在「测试历史」列表中选择两次测试运行
2. 对比 P95/P99 延迟、吞吐 TPS 和内存峰值
3. 识别性能趋势（改善还是回归）
4. 根据对比结果决定是否需要优化

### 紧急停止测试

1. 当发现系统资源即将耗尽时
2. 点击「停止测试」按钮
3. 系统立即中止所有模拟节点和任务
4. 已收集的指标自动保存，测试状态标记为 STOPPED

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 测试启动失败 | 系统资源不足 | 减少节点数和并发任务数，释放内存后重试 |
| 成功率低于 95% | 系统在高负载下出现瓶颈 | 分析错误分类统计，定位具体失败原因 |
| P99 延迟异常高 | 垃圾回收或内存交换 | 增加系统内存，检查 GC 日志 |
| 内存峰值超过 1GB | 节点数过多导致内存爆增 | 分批测试（如先 50 节点再 100 节点） |
| 测试历史查询缓慢 | 结果数据量过大 | 定期清理过期测试记录 |
| 指标采集不完整 | 测试被手动停止 | 查看 STOPPED 状态测试的部分结果 |

## 配置参考

| 参数               | 默认值   | 范围           | 说明                               |
| ------------------ | -------- | -------------- | ---------------------------------- |
| `nodeCount`        | 10       | 1 – 100        | 模拟联邦节点数量                   |
| `concurrentTasks`  | 10       | 1 – 500        | 并发执行任务数                     |
| `durationMs`       | 60000    | 5000 – 600000  | 测试持续时间（毫秒）               |
| `taskTimeoutMs`    | 5000     | 500 – 30000    | 单任务超时时间（毫秒）             |
| `rampUpMs`         | 0        | 0 – 30000      | 负载爬坡时间，0 表示立即全量并发   |
| `metricsIntervalMs`| 1000     | 200 – 10000    | 指标采集间隔（毫秒）               |
| `retainResultsDays`| 30       | 1 – 365        | 历史结果保留天数                   |

---

## 性能指标

| 指标                | 说明                               | KPI 目标      |
| ------------------- | ---------------------------------- | ------------- |
| 测试启动延迟        | 从调用 `start` 到首个任务执行      | < 500ms       |
| 指标采集延迟        | p50/p95/p99 计算耗时               | < 10ms/批     |
| 最大支持节点数      | 单次测试最大模拟节点数             | 100 节点      |
| 最大并发任务数      | 单次测试最大并发任务数             | 500 任务      |
| 测试停止响应时间    | 从调用 `stop` 到所有节点终止       | < 1s          |
| 历史查询响应时间    | 查询 1000 条历史记录               | < 200ms       |
| 结果写入耗时        | 单次测试结果持久化到 SQLite        | < 50ms        |
| 指标精度            | p95/p99 延迟计算误差               | < 1ms         |

---

## 测试覆盖率

| 测试类型           | 文件                                      | 覆盖项                                             |
| ------------------ | ----------------------------------------- | -------------------------------------------------- |
| 单元测试           | `stress-test-engine.test.js`              | 测试生命周期（PENDING/RUNNING/COMPLETE/STOPPED）   |
| 负载生成测试       | `load-generator.test.js`                  | 节点模拟、并发控制、爬坡逻辑、任务超时处理         |
| 指标采集测试       | `metrics-collector.test.js`               | p50/p95/p99 计算准确性、内存峰值采集、TPS 统计     |
| IPC 集成测试       | `ipc-stress-test.test.js`                 | 4 个 IPC 通道、参数校验、并发启动冲突处理          |
| 数据库测试         | `stress-test-db.test.js`                  | 双表结构、外键约束、过期记录清理、并发写入         |
| 端到端测试         | `stress-test-e2e.test.js`                 | 完整测试流程、停止中断、结果持久化及历史查询       |
| 性能回归测试       | `stress-test-perf.test.js`                | 100 节点基准、TPS > 30、P99 < 500ms 断言           |

> **总测试数**: 约 92 个测试用例，覆盖率 > 90%

---

## 安全考虑

- **资源隔离**: 压力测试使用模拟节点，不影响生产环境的真实节点通信
- **安全停止**: 随时可中止测试，防止系统资源过载导致服务不可用
- **结果持久化**: 测试运行和结果存储在独立表中，不影响业务数据
- **并发限制**: 最大节点数和并发任务数有上限，防止系统崩溃
- **审计追踪**: 所有测试运行的参数和结果完整记录，支持回溯分析
- **内存保护**: 监控内存峰值，接近限制时自动发出警告
- **数据清理**: 过期测试结果可安全清理，不影响系统完整性

## 相关文档

- [联邦网络加固](/chainlesschain/federation-hardening) - 联邦网络安全加固
- [信誉优化](/chainlesschain/reputation-optimizer) - 代理信誉评分系统
- [跨组织 SLA](/chainlesschain/sla-manager) - 跨组织服务级别协议管理
- [代理联邦网络](/chainlesschain/agent-federation) - 联邦代理网络基础架构
