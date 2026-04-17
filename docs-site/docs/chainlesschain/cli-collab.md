# 协作治理 (collab)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **治理决策**: 提出、投票、计票、执行治理决策（任务分配、资源分配、冲突解决、策略更新）
- **自治等级管理**: 为 Agent 设置分级权限 (L0-L4)，跟踪调整历史
- **冲突解决策略**: 内置投票、共识、仲裁、优先级等冲突解决策略
- **技能匹配**: 计算 Agent 技能匹配度，优化任务分配
- **质量指标与优先级**: 内置质量指标和优先级评估

## 概述

ChainlessChain CLI 协作治理模块 (Phase 64) 提供多 Agent 协作场景下的治理决策框架。`propose` 创建治理决策，`vote` 投票，`tally` 按法定人数和通过阈值计票，`execute` 标记已执行。`set-level` 管理 Agent 自治等级 (L0 只读 ~ L4 完全自主)，每个等级对应不同权限集。`match` 和 `optimize` 子命令支持基于技能的任务分配优化。

## 命令参考

### collab decision-types — 决策类型

```bash
chainlesschain collab decision-types
chainlesschain collab decision-types --json
```

列出已知决策类型：task_assignment、resource_allocation、conflict_resolution、policy_update、autonomy_level。

### collab strategies — 冲突解决策略

```bash
chainlesschain collab strategies
chainlesschain collab strategies --json
```

列出冲突解决策略（投票、共识、仲裁等），每个策略包含子类型或算法。

### collab metrics — 质量指标

```bash
chainlesschain collab metrics --json
```

列出已知质量指标。

### collab priorities — 优先级

```bash
chainlesschain collab priorities --json
```

列出优先级等级 (P0-P4) 及其名称。

### collab permissions — 权限层级

```bash
chainlesschain collab permissions --json
```

列出权限层级 (L0-L4)，每层包含的权限列表。

### collab propose — 提出决策

```bash
chainlesschain collab propose task_assignment "分配 API 重构任务"
chainlesschain collab propose conflict_resolution "解决合并冲突" --json
```

创建治理决策。type 为 task_assignment|resource_allocation|conflict_resolution|policy_update|autonomy_level。

### collab decisions — 列出决策

```bash
chainlesschain collab decisions
chainlesschain collab decisions -t task_assignment -s pending --limit 20 --json
```

列出决策。可按类型和状态 (pending|voting|approved|rejected|executed) 过滤。

### collab show — 查看决策详情

```bash
chainlesschain collab show <decision-id> --json
```

显示决策详情：类型、状态、提案、投票列表、计票结果。

### collab vote — 投票

```bash
chainlesschain collab vote <decision-id> agent-001 approve -r "方案合理"
chainlesschain collab vote <decision-id> agent-002 reject -r "资源不足" --json
```

为决策投票 (approve|reject|abstain)。`-r` 附加投票理由。

### collab tally — 计票

```bash
chainlesschain collab tally <decision-id>
chainlesschain collab tally <decision-id> -q 0.5 -t 0.6 -n 5 --json
```

计票并转换决策状态。`-q` 法定人数比例 (默认 0.5)，`-t` 通过阈值 (默认 0.6)，`-n` 总投票人数。

### collab execute — 执行决策

```bash
chainlesschain collab execute <decision-id>
```

标记已批准的决策为已执行。

### collab set-level — 设置自治等级

```bash
chainlesschain collab set-level agent-001 3 -r "表现良好" --json
```

设置 Agent 的自治等级 (0-4)，返回新等级和对应权限。

### collab agent / agents — 查看 Agent

```bash
chainlesschain collab agent agent-001 --json
chainlesschain collab agents -l 3 --limit 20 --json
```

查看单个 Agent 的自治等级和权限，或列出所有 Agent。

### collab match — 技能匹配

```bash
chainlesschain collab match required.json agent.json --json
```

计算技能匹配分数。输入为 JSON 文件路径。required: `[{name, requiredLevel, weight}]`，agent: `{skillName: level}`。

### collab optimize — 任务分配优化

```bash
chainlesschain collab optimize tasks.json agents.json --json
```

优化任务分配。tasks: `[{id, urgency, importance, complexity, dependencies, requiredSkills}]`，agents: `[{id, skills, currentLoad, maxCapacity}]`。

## 数据库表

| 表名 | 说明 |
|------|------|
| `collab_decisions` | 治理决策（类型、状态、提案、投票、计票结果） |
| `collab_autonomy_levels` | Agent 自治等级（当前等级、权限、调整历史） |

## 系统架构

```
用户命令 → collab.js (Commander) → collaboration-governance.js
                                           │
              ┌───────────────────────────┼──────────────────────┐
              ▼                           ▼                       ▼
         决策治理                     自治等级                任务优化
  (propose/vote/tally/execute)   (set-level/agent/agents)  (match/optimize)
              ▼                           ▼                       ▼
      collab_decisions         collab_autonomy_levels        纯函数计算
```

## 配置参考

```bash
# collab propose
<type> <proposal>              # 决策类型和提案描述（必填）

# collab vote
<decision-id> <agent-id> <vote>  # approve|reject|abstain
-r, --reason <text>              # 投票理由

# collab tally
-q, --quorum <n>               # 法定人数 0..1 (默认 0.5)
-t, --threshold <n>            # 通过阈值 0..1 (默认 0.6)
-n, --total-voters <n>         # 总投票人数

# collab set-level
<agent-id> <level>             # 自治等级 0..4
-r, --reason <text>            # 调整原因
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| propose 创建决策 | < 200ms | ~110ms | OK |
| vote 投票 | < 100ms | ~50ms | OK |
| tally 计票 | < 200ms | ~90ms | OK |
| optimize 任务分配 | < 1s | ~450ms | OK |
| agents 列出 (50 条) | < 300ms | ~130ms | OK |

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/collab.js` | collab 命令主入口 (Phase 64) |
| `packages/cli/src/lib/collaboration-governance.js` | 决策管理、投票计票、自治等级、技能匹配、任务优化核心实现 |
