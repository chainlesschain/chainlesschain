# 联邦网络加固

> **Phase 58 | v2.0.0 | 4 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 🔌 **熔断器模式**: 自动隔离故障节点，三状态机（CLOSED/OPEN/HALF_OPEN）防止级联失败
- 🏥 **智能健康检查**: 定期探测节点延迟与可用性，实时评估网络拓扑健康度
- 🔗 **连接池管理**: TCP 连接复用与并发限制，提升跨组织节点通信吞吐
- 🔄 **自动恢复机制**: HALF_OPEN 试探性恢复，无需人工干预即可恢复故障节点
- 📊 **状态仪表板**: 综合展示熔断器分布、健康检查统计与连接池使用率

## 系统架构

```
┌────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Vue3 前端  │────→│  IPC 处理器       │────→│  Hardening Core  │
│  状态仪表板 │     │  federation-      │     │  熔断器 + 健康检查│
└────────────┘     │  hardening        │     └────────┬─────────┘
                   └──────────────────┘              │
                                          ┌──────────┼──────────┐
                                          ▼          ▼          ▼
                                    ┌──────────┐ ┌────────┐ ┌────────┐
                                    │ 熔断器   │ │ 健康   │ │ 连接池 │
                                    │ 状态机   │ │ 检查器 │ │ 管理器 │
                                    └─────┬────┘ └───┬────┘ └────────┘
                                          ▼          ▼
                                    ┌──────────────────────┐
                                    │  federation_circuit_  │
                                    │  breakers / health_   │
                                    │  checks (SQLite)      │
                                    └──────────────────────┘
```

## 概述

Phase 58 为 Cowork 联邦代理网络引入生产级可靠性保障，包含熔断器模式、健康检查和连接池管理，确保跨组织节点间通信的稳定性。

**核心目标**:

- **熔断器**: 自动隔离故障节点，防止级联失败
- **健康检查**: 定期探测节点状态，评估延迟与可用性
- **连接池**: 复用 TCP 连接，限制并发数，提升吞吐
- **自动恢复**: HALF_OPEN 试探性恢复，无需人工干预

---

## 熔断器状态机

```
          成功
   ┌──────────────────────────┐
   │                          │
   ▼           失败≥阈值      │
 CLOSED ──────────────→ OPEN
                          │
                    超时恢复│
                          ▼
                      HALF_OPEN
                       │    │
                  成功 │    │ 失败
                       ▼    ▼
                    CLOSED  OPEN
```

| 状态        | 说明                                         |
| ----------- | -------------------------------------------- |
| **CLOSED**  | 正常通信，记录失败次数                       |
| **OPEN**    | 拒绝所有请求，等待恢复超时                   |
| **HALF_OPEN** | 试探性放行少量请求，成功则恢复，失败则重新打开 |

---

## 核心功能

### 1. 熔断器管理

```javascript
// 查看所有熔断器状态
const breakers = await window.electronAPI.invoke('federation-hardening:get-circuit-breakers');
// [{ nodeId, state: 'CLOSED', failureCount: 0, lastSuccessAt, ... }]

// 手动重置熔断器
await window.electronAPI.invoke('federation-hardening:reset-circuit', {
  nodeId: 'node-abc'
});
```

### 2. 健康检查

```javascript
// 对指定节点运行健康检查
const result = await window.electronAPI.invoke('federation-hardening:run-health-check', {
  nodeId: 'node-abc'
});

console.log(result);
// {
//   nodeId: 'node-abc',
//   status: 'HEALTHY',       // HEALTHY | DEGRADED | UNHEALTHY
//   latencyMs: 45.2,
//   checkedAt: 1709078400000
// }
```

### 3. 状态仪表板

```javascript
// 获取综合状态
const status = await window.electronAPI.invoke('federation-hardening:get-status');
// {
//   circuitBreakers: { total: 12, closed: 10, open: 1, halfOpen: 1 },
//   healthChecks: { healthy: 9, degraded: 2, unhealthy: 1, lastCheckAt: ... }
// }
```

---

## 配置参数

| 参数                  | 默认值 | 说明                         |
| --------------------- | ------ | ---------------------------- |
| `failureThreshold`    | 5      | 触发熔断的连续失败次数       |
| `recoveryTimeout`     | 30s    | OPEN → HALF_OPEN 等待时间    |
| `healthCheckInterval` | 60s    | 健康检查间隔                 |
| `maxPoolSize`         | 10     | 连接池最大连接数             |

---

## 配置参考

```javascript
// federation-hardening 完整配置示例
const federationHardeningConfig = {
  circuitBreaker: {
    // 触发熔断的连续失败次数（超过此值 CLOSED → OPEN）
    failureThreshold: 5,

    // OPEN 状态等待恢复的时间（毫秒）
    recoveryTimeoutMs: 30000,

    // HALF_OPEN 状态允许通过的试探请求数
    halfOpenProbeCount: 1
  },

  healthCheck: {
    // 定期健康检查间隔（毫秒）
    intervalMs: 60000,

    // 单次健康检查超时（毫秒）
    timeoutMs: 5000,

    // 延迟超过此值标记为 DEGRADED（毫秒）
    degradedLatencyThreshold: 200,

    // 延迟超过此值标记为 UNHEALTHY（毫秒）
    unhealthyLatencyThreshold: 1000,

    // 每批并发探测节点数
    batchSize: 50
  },

  connectionPool: {
    // 连接池最大连接数
    maxPoolSize: 10,

    // 空闲连接超时释放时间（毫秒）
    idleTimeoutMs: 300000,

    // 连接建立超时（毫秒）
    connectTimeoutMs: 5000
  }
};
```

---

## IPC 通道

| 通道                                      | 参数           | 返回值         |
| ----------------------------------------- | -------------- | -------------- |
| `federation-hardening:get-status`          | 无             | 综合状态       |
| `federation-hardening:get-circuit-breakers`| 无             | 熔断器列表     |
| `federation-hardening:reset-circuit`       | `{ nodeId }`   | 操作结果       |
| `federation-hardening:run-health-check`    | `{ nodeId }`   | 检查结果       |

---

## 数据库表

### federation_circuit_breakers

| 字段            | 类型    | 说明                       |
| --------------- | ------- | -------------------------- |
| id              | TEXT PK | 记录 ID                   |
| node_id         | TEXT    | 节点 ID（唯一索引）       |
| state           | TEXT    | CLOSED / OPEN / HALF_OPEN  |
| failure_count   | INTEGER | 连续失败次数               |
| last_failure_at | INTEGER | 最后失败时间               |
| last_success_at | INTEGER | 最后成功时间               |
| opened_at       | INTEGER | 熔断器打开时间             |

### federation_health_checks

| 字段       | 类型    | 说明                             |
| ---------- | ------- | -------------------------------- |
| id         | TEXT PK | 记录 ID                         |
| node_id    | TEXT    | 节点 ID                         |
| status     | TEXT    | HEALTHY / DEGRADED / UNHEALTHY   |
| latency_ms | REAL    | 延迟（毫秒）                    |
| details    | JSON    | 检查详情                         |
| checked_at | INTEGER | 检查时间                         |

---

## 使用示例

### 查看网络健康状态

1. 打开「联邦加固」页面，查看综合仪表板
2. 熔断器分布图显示 CLOSED/OPEN/HALF_OPEN 各状态节点数
3. 健康检查统计显示 HEALTHY/DEGRADED/UNHEALTHY 节点分布
4. 连接池使用率图表展示当前资源占用情况

### 手动运行健康检查

1. 在节点列表中选择目标节点
2. 点击「运行健康检查」，系统探测节点延迟和可用性
3. 查看检查结果：状态、延迟（ms）、检查时间
4. 异常节点会自动标记并触发熔断器状态转换

### 重置故障熔断器

1. 在熔断器列表中找到状态为 OPEN 的节点
2. 确认故障已修复后，点击「重置」
3. 熔断器恢复为 CLOSED 状态，节点重新参与任务路由

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 大量节点进入 OPEN 状态 | 网络大面积故障或配置阈值过低 | 检查网络连通性，适当调高 `failureThreshold` |
| 健康检查全部超时 | 检查间隔过短导致资源争用 | 增大 `healthCheckInterval`（默认 60s） |
| 熔断器无法恢复 | HALF_OPEN 试探请求持续失败 | 确认节点已修复后手动重置熔断器 |
| 连接池耗尽 | 并发请求过多或连接泄露 | 增大 `maxPoolSize`，检查连接释放逻辑 |
| 状态仪表板数据延迟 | 数据库查询缓慢 | 检查 SQLite 表索引，清理过期记录 |
| 节点频繁在 OPEN/CLOSED 间切换 | 节点网络不稳定 | 增大 `recoveryTimeout` 避免过早试探 |

## 性能指标

| 指标                  | 说明                         | 参考值        |
| --------------------- | ---------------------------- | ------------- |
| 熔断器状态切换延迟    | CLOSED → OPEN 触发响应时间   | < 5ms         |
| 健康检查探测延迟      | 单节点探测往返时间           | < 100ms       |
| 连接池建立时间        | 新连接建立耗时               | < 50ms        |
| 状态仪表板刷新延迟    | IPC 查询到渲染完成           | < 200ms       |
| 最大并发节点数        | 同时管理的联邦节点上限       | 500 节点      |
| 健康检查并发数        | 同时探测节点数               | 50 节点/批次  |
| 连接池复用率          | 复用连接占总连接比例         | > 80%         |
| 状态持久化耗时        | 熔断器状态写入 SQLite        | < 10ms        |

---

## 测试覆盖率

| 测试类型           | 文件                                            | 覆盖项                                         |
| ------------------ | ----------------------------------------------- | ---------------------------------------------- |
| 单元测试           | `federation-hardening.test.js`                  | 熔断器三态转换、失败计数、恢复超时逻辑         |
| 集成测试           | `federation-hardening-ipc.test.js`              | 4 个 IPC 通道、参数验证、返回值格式            |
| 健康检查测试       | `health-check.test.js`                          | HEALTHY/DEGRADED/UNHEALTHY 状态判定、延迟计算  |
| 连接池测试         | `connection-pool.test.js`                       | 最大连接数限制、连接复用、超时释放             |
| 状态机测试         | `circuit-breaker-state-machine.test.js`         | 全状态转移路径、边界条件（阈值恰好满足）       |
| 数据库测试         | `federation-hardening-db.test.js`               | 表结构、索引、并发写入、过期记录清理           |
| 端到端测试         | `federation-hardening-e2e.test.js`              | 节点故障模拟、自动熔断、HALF_OPEN 自动恢复     |

> **总测试数**: 约 85 个测试用例，覆盖率 > 90%

---

## 安全考虑

- **级联故障防护**: 熔断器自动隔离故障节点，防止单点故障扩散到整个网络
- **无需人工干预**: HALF_OPEN 试探性恢复机制自动检测节点恢复，减少运维负担
- **连接池限流**: 最大连接数限制防止资源耗尽和 DoS 攻击
- **健康检查认证**: 探测请求经过 DID 认证，防止伪造健康状态
- **状态持久化**: 熔断器和健康检查状态写入数据库，重启后自动恢复
- **配置安全**: 阈值参数通过加密配置管理，防止未授权修改
- **监控告警**: 关键状态变化触发事件通知，支持及时响应

## 相关文档

- [代理联邦网络](/chainlesschain/agent-federation)
- [压力测试](/chainlesschain/stress-test)
- [信誉优化](/chainlesschain/reputation-optimizer)
- [跨组织 SLA](/chainlesschain/sla-manager)

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/ai-engine/cowork/federation-hardening.js` | 联邦加固核心引擎（熔断器/健康检查/连接池） |
| `src/main/ai-engine/cowork/federation-hardening-ipc.js` | IPC 处理器（4 个通道） |
| `src/renderer/stores/federationHardening.ts` | Pinia 状态管理 |
| `src/renderer/pages/ai/FederationHardeningPage.vue` | 状态仪表板页面 |
