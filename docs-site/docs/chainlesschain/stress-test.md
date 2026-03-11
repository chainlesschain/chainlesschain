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

## 相关文档

- [联邦网络加固](/chainlesschain/federation-hardening) - 联邦网络安全加固
- [信誉优化](/chainlesschain/reputation-optimizer) - 代理信誉评分系统
- [跨组织 SLA](/chainlesschain/sla-manager) - 跨组织服务级别协议管理
- [代理联邦网络](/chainlesschain/agent-federation) - 联邦代理网络基础架构
