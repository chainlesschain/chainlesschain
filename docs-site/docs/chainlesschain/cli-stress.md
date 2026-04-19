# 压力测试 (stress)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔥 **负载模拟**: 四级负载预设（light / medium / heavy / extreme），支持自定义参数
- 📊 **性能指标**: TPS、p50/p95/p99 延迟、错误率等关键指标
- 🔍 **瓶颈分析**: 自动识别瓶颈类型与严重程度
- 📈 **容量规划**: 基于测试结果生成扩容建议和裕度评估
- 📋 **测试历史**: 持久化存储测试结果，支持回溯分析

## 概述

ChainlessChain CLI 压力测试模块（Phase 59）提供联邦网络的合成负载模拟与性能分析。`levels` 查看内置负载级别，`run` 执行压力测试并自动生成合成指标，`analyze` 对测试结果做瓶颈检测，`plan` 基于当前吞吐量和目标 RPS 生成容量规划建议。所有测试结果持久化到 SQLite。

## 命令参考

### stress levels — 负载级别目录

```bash
chainlesschain stress levels
chainlesschain stress levels --json
```

列出内置负载级别及其默认参数（并发数、RPS、持续时间）。

| 级别 | 并发 | RPS | 持续时间 |
|------|------|-----|---------|
| light | 低 | 低 | 短 |
| medium | 中 | 中 | 中 |
| heavy | 高 | 高 | 长 |
| extreme | 极高 | 极高 | 最长 |

### stress run — 执行压力测试

```bash
chainlesschain stress run
chainlesschain stress run -l heavy --json
chainlesschain stress run -l medium -c 50 -r 200 -d 30000
```

执行压力测试。`-l` 选择负载级别（默认 medium），`-c` 覆盖并发数，`-r` 覆盖 RPS，`-d` 覆盖持续时间（毫秒）。

输出包含：测试 ID、负载参数、TPS、p50/p95/p99 延迟、错误率、瓶颈列表。

### stress list — 测试历史

```bash
chainlesschain stress list
chainlesschain stress list -l heavy -s complete --limit 20 --json
```

列出历史测试记录。`-l` 按负载级别过滤，`-s` 按状态过滤（running / complete / stopped），`--limit` 限制条目数。

### stress show — 测试详情

```bash
chainlesschain stress show <test-id>
chainlesschain stress show st-001 --json
```

查看指定测试的完整结果：负载参数、所有性能指标、状态。

### stress analyze — 瓶颈分析

```bash
chainlesschain stress analyze <test-id>
chainlesschain stress analyze st-001 --json
```

对测试结果执行瓶颈分析，返回瓶颈列表（类型、严重程度、详情）和摘要。

### stress plan — 容量规划

```bash
chainlesschain stress plan <test-id>
chainlesschain stress plan st-001 --json
```

基于测试结果生成容量规划建议：目标 RPS vs 实际 TPS、扩展倍数、裕度评估、具体扩容建议。

### stress stop — 停止测试

```bash
chainlesschain stress stop <test-id>
```

将运行中的测试标记为 stopped。

## 系统架构

```
用户命令 → stress.js (Commander) → stress-tester.js
                                         │
              ┌──────────────────────────┼──────────────────────┐
              ▼                          ▼                      ▼
         负载模拟                    指标分析                容量规划
   (合成指标生成)              (瓶颈启发式)          (扩展倍数/建议)
              ▼                          ▼                      ▼
       stress_tests              bottleneck 检测          recommendations
```

## 配置参考

```bash
# stress run
-l, --level <level>            # 负载级别: light|medium|heavy|extreme (默认 medium)
-c, --concurrency <n>          # 覆盖并发数
-r, --rps <n>                  # 覆盖每秒请求数
-d, --duration <ms>            # 覆盖持续时间（毫秒）

# stress list
-l, --level <level>            # 按负载级别过滤
-s, --status <status>          # 按状态过滤: running|complete|stopped
--limit <n>                    # 最大条目数 (默认 10)

# 通用
--json                         # JSON 输出
```

## 性能指标说明

| 指标 | 说明 |
|------|------|
| `tps` | 每秒事务数（实际吞吐量） |
| `p50ResponseTime` | 50 分位延迟（ms） |
| `p95ResponseTime` | 95 分位延迟（ms） |
| `p99ResponseTime` | 99 分位延迟（ms） |
| `errorRate` | 错误率 (0~1) |
| `bottlenecks` | 检测到的瓶颈列表 |

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/stress.js` | stress 命令主入口 |
| `packages/cli/src/lib/stress-tester.js` | 合成指标生成、瓶颈启发式、容量规划核心实现 |

## 性能指标

| 操作 | 典型耗时 | 备注 |
| ---- | -------- | ---- |
| `stress levels` | < 20 ms | 纯内存枚举 |
| `stress run`（合成指标） | 与 `-d` 一致 | 真实占用低，主要阻塞等待 |
| `stress list` / `show` | < 50 ms | SQLite 索引查询 |
| `stress analyze` | < 100 ms | 启发式瓶颈检测 |
| `stress plan` | < 50 ms | 线性外推 |

注意：`stress run` 当前产出的是合成指标（用于容量规划/回归），非真实打流；若需真实打流请配合外部负载工具。

## 测试覆盖率

```
__tests__/unit/stress-tester.test.js — 66 tests
```

覆盖四级负载预设、run/list/show/analyze/plan 全路径、瓶颈启发式（CPU/IO/网络/队列）、容量规划倍数与裕度计算、stop 转为 stopped 状态机。

## 安全考虑

1. **合成打流**：默认模式不会对外发起真实请求，CI 中运行安全
2. **资源上限**：`-c` / `-r` / `-d` 组合过大会放大 CPU/内存占用，建议在容器中运行
3. **结果脱敏**：`stress_tests` 表不保存业务载荷，仅保存参数与统计指标
4. **历史清理**：长时间运行会累积 SQLite 记录，建议定期 VACUUM

## 测试

```bash
cd packages/cli
npx vitest run __tests__/unit/stress-tester.test.js
# 33 tests, all pass
```

## 使用示例

### 场景：性能评估与容量规划

```bash
# 1. 查看负载级别
chainlesschain stress levels

# 2. 运行中等负载测试
chainlesschain stress run -l medium --json

# 3. 查看详细结果
chainlesschain stress show <test-id>

# 4. 分析瓶颈
chainlesschain stress analyze <test-id>

# 5. 生成容量规划建议
chainlesschain stress plan <test-id>

# 6. 运行极端负载测试对比
chainlesschain stress run -l extreme -c 200 -r 1000
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "No stress tests recorded" | 未执行过测试 | 使用 `stress run` 执行 |
| 测试结果异常 | 自定义参数不合理 | 先用 `levels` 查看预设参数 |
| 瓶颈分析为空 | 负载不足以触发瓶颈 | 使用更高负载级别 |

## 相关文档

- [安全加固](./cli-hardening) — 性能基线与回归检测
- [SLA 管理](./cli-sla) — 服务等级协议与违约检测
- [信誉优化](./cli-reputation) — DID 信誉评分与优化
