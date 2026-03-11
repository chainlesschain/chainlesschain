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
