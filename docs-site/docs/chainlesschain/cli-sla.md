# SLA 管理 (sla)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📋 **合约管理**: 创建/查看/终止 SLA 合约，支持 gold / silver / bronze 三级
- 📊 **指标记录**: 记录可用性、响应时间、吞吐量、错误率四类指标
- 🔍 **违约检测**: 自动检测违约（response_time 用 p95，其余用 mean），方向感知偏差
- 💰 **赔偿计算**: 基于月费 x 赔偿率 x 偏差倍率，上限 2.0
- 📈 **合规报告**: 生成合规百分比、违约统计和严重程度分布

## 概述

ChainlessChain CLI SLA 管理模块（Phase 61）实现跨组织的服务等级协议全生命周期管理。`tiers` 查看内置等级定义，`create` 创建合约（绑定组织、等级、月费），`record` 持续记录性能指标，`check` 自动检测违约（对 response_time 使用 p95、对其余 term 使用 mean），`compensate` 按偏差严重程度计算赔偿金额（cap 2.0），`report` 生成时间窗口内的合规报告。

## 命令参考

### sla tiers — 等级目录

```bash
chainlesschain sla tiers
chainlesschain sla tiers --json
```

列出内置 SLA 等级：

| 等级 | 可用性 | 最大响应时间 | 最小吞吐量 | 赔偿率 |
|------|--------|-------------|-----------|--------|
| gold | 最高 | 最低 | 最高 | 最高 |
| silver | 中等 | 中等 | 中等 | 中等 |
| bronze | 基础 | 较宽 | 较低 | 较低 |

### sla create — 创建合约

```bash
chainlesschain sla create <org-id>
chainlesschain sla create org_acme -t gold -f 5000 --json
chainlesschain sla create org_beta -t bronze -d 7776000000 -f 1000
```

创建 SLA 合约。`-t` 选择等级（默认 silver），`-d` 指定合约时长（毫秒），`-f` 设置月费。

### sla list — 列出合约

```bash
chainlesschain sla list
chainlesschain sla list -o org_acme -t gold -s active --limit 20 --json
```

按组织 (`-o`)、等级 (`-t`)、状态 (`-s`: active / expired / terminated) 过滤。

### sla show — 合约详情

```bash
chainlesschain sla show <sla-id>
chainlesschain sla show sla-001 --json
```

显示合约的完整信息：ID、组织、等级、状态、条款详情。

### sla terminate — 终止合约

```bash
chainlesschain sla terminate <sla-id>
```

将活跃合约标记为已终止。

### sla record — 记录指标

```bash
chainlesschain sla record <sla-id> <term> <value>
chainlesschain sla record sla-001 availability 0.998
chainlesschain sla record sla-001 response_time 120
chainlesschain sla record sla-001 throughput 500
chainlesschain sla record sla-001 error_rate 0.002 --json
```

记录 SLA 性能指标。支持的 term：

| Term | 说明 | 典型值 |
|------|------|--------|
| `availability` | 可用性 | 0.0~1.0 |
| `response_time` | 响应时间 (ms) | 正整数 |
| `throughput` | 吞吐量 (rps) | 正整数 |
| `error_rate` | 错误率 | 0.0~1.0 |

### sla metrics — 聚合指标

```bash
chainlesschain sla metrics <sla-id>
chainlesschain sla metrics sla-001 --json
```

返回每个 term 的聚合统计：mean、p95、采样数。

### sla check — 违约检测

```bash
chainlesschain sla check <sla-id>
chainlesschain sla check sla-001 --json
```

检测 SLA 违约。对 `response_time` 使用 p95 值，其余 term 使用 mean 值进行比较。返回违约列表（term、严重程度、期望值、实际值、偏差百分比）。

违约严重程度：

| 严重程度 | 说明 |
|----------|------|
| `minor` | 轻微偏差 |
| `moderate` | 中等偏差 |
| `major` | 严重偏差 |
| `critical` | 极端偏差 |

### sla violations — 违约历史

```bash
chainlesschain sla violations
chainlesschain sla violations -s sla-001 -S major --limit 20 --json
```

列出已记录的违约。`-s` 按 SLA ID 过滤，`-S` 按严重程度过滤。

### sla compensate — 赔偿计算

```bash
chainlesschain sla compensate <violation-id>
chainlesschain sla compensate vio-001 --json
```

计算违约赔偿金额：base (月费 x 赔偿率) x multiplier (基于偏差)，multiplier 上限 2.0。

### sla report — 合规报告

```bash
chainlesschain sla report <sla-id>
chainlesschain sla report sla-001 --start 1700000000000 --end 1710000000000 --json
```

生成 SLA 合规报告：合规百分比、违约总数、赔偿总额、按严重程度分布。`--start` / `--end` 指定时间窗口（毫秒时间戳）。

## 系统架构

```
用户命令 → sla.js (Commander) → sla-manager.js
                                      │
           ┌──────────────────────────┼──────────────────────┐
           ▼                          ▼                      ▼
      合约管理                    指标/违约                赔偿/报告
  (create/list/show)         (record/check)         (compensate/report)
           ▼                          ▼                      ▼
       sla_contracts            sla_metrics              sla_violations
                              sla_violations
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/sla.js` | sla 命令主入口 |
| `packages/cli/src/lib/sla-manager.js` | 等级目录、合约管理、指标聚合、违约检测、赔偿计算核心实现 |

## 测试

```bash
cd packages/cli
npx vitest run __tests__/unit/sla-manager.test.js
# 51 tests, all pass
```

## 使用示例

### 场景：完整 SLA 生命周期

```bash
# 1. 查看等级
chainlesschain sla tiers

# 2. 创建金级合约
chainlesschain sla create org_acme -t gold -f 5000

# 3. 持续记录指标
chainlesschain sla record sla-001 availability 0.999
chainlesschain sla record sla-001 response_time 85
chainlesschain sla record sla-001 throughput 800

# 4. 检测违约
chainlesschain sla check sla-001

# 5. 查看违约并计算赔偿
chainlesschain sla violations -s sla-001
chainlesschain sla compensate vio-001

# 6. 生成合规报告
chainlesschain sla report sla-001 --json
```

## 相关文档

- [信誉优化](./cli-reputation) — DID 信誉评分与异常检测
- [压力测试](./cli-stress) — 联邦负载模拟与容量规划
- [合规管理](./cli-compliance) — 合规框架与报告生成
