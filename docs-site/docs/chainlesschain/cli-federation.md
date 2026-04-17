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

## 相关文档

- 设计文档: `docs/design/modules/30_联邦强化系统.md`
- 管理器: `packages/cli/src/lib/federation-hardening.js`
- 命令: `packages/cli/src/commands/federation.js`
