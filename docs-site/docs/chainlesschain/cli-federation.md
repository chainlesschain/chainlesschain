# 联邦硬化 (federation)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **熔断器状态机**: `closed` → `open` → `half_open` → `closed` 三态转换，阻止故障雪崩
- **健康检查记录**: latency / error_rate / availability / throughput / resource 五类指标，最差态聚合节点健康
- **连接池模拟**: `min` / `max` / `idleTimeout` 参数化池，可 acquire/release/销毁
- **失败/成功阈值**: 连续 N 次失败触发熔断；`open_timeout_ms` 后尝试 `half_open`，连续 N 次成功恢复 `closed`

## 概述

ChainlessChain CLI 联邦硬化模块 (Phase 58) 是 Desktop 端 FederationHardeningManager 的 CLI 移植。三大能力域: 熔断器 (failure/success/half-open/reset) + 健康检查 (check/node-health) + 连接池 (pool-init/acquire/release/destroy)。所有状态持久化到 SQLite，首次调用自动建表。

## 命令参考

### federation circuit-states / health-statuses / health-metrics — 枚举目录

```bash
chainlesschain federation circuit-states [--json]   # closed, open, half_open
chainlesschain federation health-statuses [--json]  # healthy, degraded, unhealthy, unknown
chainlesschain federation health-metrics [--json]   # latency, error_rate, availability, throughput, resource
```

### federation register — 注册联邦节点

```bash
chainlesschain federation register node-a
chainlesschain federation register node-b -f 5 -s 2 -t 60000 -m '{"region":"us-west"}' --json
```

注册节点并初始化熔断器。`-f` 失败阈值 (默认 3)，`-s` 成功阈值 (默认 2)，`-t` open 状态超时毫秒数 (默认 30000)，`-m` 节点元数据 JSON。

### federation remove — 移除节点

```bash
chainlesschain federation remove node-a
chainlesschain federation remove node-a --json
```

级联删除节点及其健康检查记录和连接池。

### federation breaker-show / breakers — 查看熔断器

```bash
chainlesschain federation breaker-show node-a
chainlesschain federation breakers -s open --limit 20 --json
```

`breaker-show` 查看单个节点熔断器状态；`breakers` 列出所有节点，`-s` 按状态过滤。

### federation failure / success — 记录失败/成功

```bash
chainlesschain federation failure node-a
chainlesschain federation success node-a --json
```

记录一次调用失败/成功。连续失败达阈值触发 `closed → open`；`half_open` 下连续成功恢复 `closed`。

### federation half-open / reset — 状态机转换

```bash
chainlesschain federation half-open node-a    # open → half_open (超时后)
chainlesschain federation reset node-a        # 任意状态 → closed
```

### federation check — 记录健康检查

```bash
chainlesschain federation check node-a -t latency -s healthy -m '{"p95":120}'
chainlesschain federation check node-a -t error_rate -s degraded --json
```

记录一次健康检查。`-t` 指标类型 (latency/error_rate/availability/throughput/resource)，`-s` 结果状态，`-m` 指标 JSON。

### federation check-show / checks — 查看健康检查

```bash
chainlesschain federation check-show <check-id>
chainlesschain federation checks -n node-a -t latency -s degraded --limit 50 --json
```

### federation node-health — 聚合节点健康度

```bash
chainlesschain federation node-health node-a
chainlesschain federation node-health node-a --json
```

返回节点的综合健康态 (所有指标中最差的状态)，以及各指标最近一次检查结果。

### federation pool-init / acquire / release / destroy — 连接池管理

```bash
chainlesschain federation pool-init node-a --min 2 --max 10 --idle-timeout 30000
chainlesschain federation pool-acquire node-a --json
chainlesschain federation pool-release node-a --json
chainlesschain federation pool-destroy node-a --json
```

初始化连接池 (模拟)，获取/释放连接，销毁连接池。

### federation pool-stats / pools — 连接池状态

```bash
chainlesschain federation pool-stats node-a
chainlesschain federation pools --json
```

显示池的 `available` / `inUse` / `total` 及配置。

### federation stats — 联邦汇总统计

```bash
chainlesschain federation stats
chainlesschain federation stats --json
```

显示节点总数、各状态熔断器数量、健康检查总数、连接池总数。

## 数据存储

所有数据持久化到 SQLite (`_federation_nodes` / `_federation_circuits` / `_federation_health_checks` / `_federation_pools` 四张表)，首次执行子命令时自动建表。

## 系统架构

```
┌────────────────────────────────────────────────────────┐
│        chainlesschain federation (Phase 58)             │
├────────────────────────────────────────────────────────┤
│  Circuit Breaker           │  Health Checks            │
│  closed ↔ open ↔ half_open │  latency / error_rate /   │
│  failure/success counters  │  availability / throughput│
│                            │  / resource               │
├────────────────────────────────────────────────────────┤
│  Connection Pool (模拟)                                 │
│  acquire / release / min / max / idleTimeout           │
├────────────────────────────────────────────────────────┤
│  Node Registry                                          │
│  register / remove (cascade)                            │
├────────────────────────────────────────────────────────┤
│  SQLite: _federation_nodes / _circuits /                │
│          _health_checks / _pools                        │
└────────────────────────────────────────────────────────┘
```

状态机：`closed --N×failure--> open --timeout--> half_open --N×success--> closed`。
节点健康度 = 所有指标中"最差"的状态（availability='unhealthy' → 节点整体 unhealthy）。

## 配置参考

| 配置项               | 含义                    | 默认       |
| -------------------- | ----------------------- | ---------- |
| `failure_threshold`  | 连续失败阈值            | 3          |
| `success_threshold`  | half_open 恢复阈值      | 2          |
| `open_timeout_ms`    | open → half_open 超时   | 30000 ms   |
| `pool.min`           | 连接池最小连接数        | 2          |
| `pool.max`           | 连接池最大连接数        | 10         |
| `pool.idleTimeout`   | 空闲连接回收            | 30000 ms   |
| 健康指标类型         | latency/error_rate/availability/throughput/resource | |
| 健康状态             | healthy/degraded/unhealthy/unknown |    |

## 性能指标

| 操作                      | 典型耗时        |
| ------------------------- | --------------- |
| register（含初始化熔断器）| < 15 ms         |
| failure/success 记录      | < 5 ms          |
| check 写入                | < 5 ms          |
| node-health 聚合          | < 10 ms         |
| pool-acquire              | < 2 ms（有可用连接时）|
| stats 聚合                | < 20 ms         |

## 测试覆盖率

```
__tests__/unit/federation-hardening.test.js — 96 tests (984 lines)
```

覆盖：register/remove cascade、熔断器状态机全路径（closed→open→half_open→closed/open）、
failure/success 阈值边界、open_timeout 转 half_open、health check 聚合（最差态）、
连接池 acquire/release/destroy、pool 溢出处理。

## 安全考虑

1. **级联删除** — `remove` 会连带删除熔断器、健康检查、连接池，避免孤儿数据
2. **熔断器防雪崩** — 连续失败即开启熔断，下游故障不会打爆上游调用方
3. **half_open 限流** — 该状态下只允许有限探测，避免未恢复就大规模打下游
4. **健康聚合最差态** — 任意一项指标 unhealthy 即整体 unhealthy，避免误判
5. **连接池防耗尽** — `max` 硬上限，超过则 `acquire` 失败返回 null

## 故障排查

**Q: `success` 记录了但熔断器未 closed?**

1. 必须在 `half_open` 状态下的成功才计数
2. 使用 `half-open <node>`（仅在 open 超时后可转）再 `success`
3. 直接 `reset <node>` 强制回到 closed（紧急手段）

**Q: 节点显示 unhealthy 但指标看起来正常?**

1. `node-health` 使用"最差态聚合"；某个指标（如 resource）可能仍是 degraded
2. 用 `check-show` / `checks -n <node>` 查看每种指标的最近状态
3. 旧的异常状态需手动 `check -s healthy` 覆盖

**Q: `pool-acquire` 始终返回 null?**

1. `pool-stats` 查看 `inUse` 是否 = `max`
2. 连接未正确 release——检查是否有 orphan 连接
3. `pool-destroy` 后重新 `pool-init` 彻底重置

## 关键文件

- `packages/cli/src/commands/federation.js` — Commander 子命令（~710 行）
- `packages/cli/src/lib/federation-hardening.js` — 熔断器 + 健康 + 连接池
- `packages/cli/__tests__/unit/federation-hardening.test.js` — 单测（96 tests）
- 数据表：`_federation_nodes` / `_circuits` / `_health_checks` / `_pools`
- 设计文档：`docs/design/modules/30_联邦强化系统.md`

## 使用示例

```bash
# 1. 注册节点 + 初始化连接池
chainlesschain federation register node-a -f 3 -s 2 -t 30000
chainlesschain federation pool-init node-a --min 2 --max 10

# 2. 模拟故障直到熔断器打开
for i in {1..3}; do chainlesschain federation failure node-a; done
chainlesschain federation breaker-show node-a   # open

# 3. 等待超时转 half_open → 成功 N 次后恢复
chainlesschain federation half-open node-a
chainlesschain federation success node-a
chainlesschain federation success node-a        # → closed

# 4. 健康检查聚合
chainlesschain federation check node-a -t latency -s healthy -m '{"p95":120}'
chainlesschain federation check node-a -t error_rate -s degraded
chainlesschain federation node-health node-a    # degraded (最差态)

# 5. 全局统计
chainlesschain federation stats --json
```

## 相关文档

- 设计文档: `docs/design/modules/30_联邦强化系统.md`
- 管理器: `packages/cli/src/lib/federation-hardening.js`
- 命令: `packages/cli/src/commands/federation.js`
- [Agent Network →](/chainlesschain/cli-agent-network)
- [Ops / AIOps →](/chainlesschain/cli-ops)
