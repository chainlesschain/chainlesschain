# AI 社区治理 (governance)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **提案管理**: 创建、激活、关闭、过期提案，完整生命周期管理
- **加权投票**: 支持投票权重、法定人数和通过阈值的投票计票
- **影响分析**: 启发式评估提案的风险、收益、工作量和受影响组件
- **投票预测**: 基于已有投票或启发式预测投票结果和置信度
- **治理统计**: 提案/投票总量、按状态和类型分布

## 概述

ChainlessChain CLI AI 社区治理模块 (Phase 54) 提供去中心化社区治理框架。`create` 创建提案 (draft 状态)，`activate` 开启投票期，`vote` 进行加权投票 (yes|no|abstain)，`close` 结算并自动判定通过/拒绝。`tally` 可在不关闭提案的情况下预览计票。`analyze` 提供影响分析（风险分、收益分、工作量估算、社区情绪），`predict` 预测投票结果。

## 命令参考

### governance types — 提案类型

```bash
chainlesschain governance types
chainlesschain governance types --json
```

列出提案类型：parameter_change、feature_request、policy_update、budget_allocation。

### governance statuses — 提案状态

```bash
chainlesschain governance statuses --json
```

列出提案状态：draft、active、passed、rejected、expired、closed。

### governance impact-levels — 影响等级

```bash
chainlesschain governance impact-levels --json
```

列出影响等级及描述。

### governance create — 创建提案

```bash
chainlesschain governance create "增加 AI 请求配额"
chainlesschain governance create "升级加密算法" -t policy_update -d "迁移到 PQC" -p did:key:abc --json
```

创建提案 (初始为 draft)。`-t` 类型 (默认 feature_request)，`-d` 描述，`-p` 提案者 DID。

### governance list — 列出提案

```bash
chainlesschain governance list
chainlesschain governance list -s active -t feature_request --limit 20 --json
```

列出提案。可按状态和类型过滤。

### governance show — 查看提案详情

```bash
chainlesschain governance show <proposal-id> --json
```

显示提案详情：标题、类型、状态、提案者、描述、影响等级、投票数、投票时间窗口。

### governance activate — 激活投票

```bash
chainlesschain governance activate <proposal-id>
chainlesschain governance activate <proposal-id> -d 604800000 --json
```

激活 draft 提案进入投票期。`-d` 投票持续时间 (ms, 默认 7 天)。

### governance close — 关闭投票

```bash
chainlesschain governance close <proposal-id>
chainlesschain governance close <proposal-id> -q 0.3 -t 0.6 -n 10 --json
```

关闭投票并自动判定 passed/rejected。`-q` 法定人数阈值 (0-1)，`-t` 通过阈值 (0-1)，`-n` 总投票人数 (用于法定人数计算)。

### governance expire — 过期提案

```bash
chainlesschain governance expire <proposal-id>
```

将 draft/active 提案标记为 expired。

### governance vote — 投票

```bash
chainlesschain governance vote <proposal-id> did:key:voter1 yes
chainlesschain governance vote <proposal-id> did:key:voter2 no -r "安全风险" -w 2.0 --json
```

对提案投票 (yes|no|abstain)。同一投票者再次投票会替换前一票。`-r` 理由，`-w` 投票权重 (默认 1.0)。

### governance votes — 查看投票

```bash
chainlesschain governance votes <proposal-id>
chainlesschain governance votes <proposal-id> --limit 50 --json
```

列出提案的所有投票记录。

### governance tally — 计票预览

```bash
chainlesschain governance tally <proposal-id>
chainlesschain governance tally <proposal-id> -q 0.3 -t 0.6 -n 10 --json
```

预览计票结果（不改变提案状态）。返回投票数、加权 yes/no/abstain、通过率、法定人数是否达标。

### governance analyze — 影响分析

```bash
chainlesschain governance analyze <proposal-id>
chainlesschain governance analyze <proposal-id> --json
```

启发式影响分析。返回影响等级、风险分、收益分、工作量估算、社区情绪、受影响组件、建议列表。

### governance predict — 投票预测

```bash
chainlesschain governance predict <proposal-id>
chainlesschain governance predict <proposal-id> --json
```

预测投票结果。返回预测结果 (pass|fail)、置信度、基于依据 (votes|heuristic)、样本量、yes/no/abstain 概率。

### governance stats — 治理统计

```bash
chainlesschain governance stats --json
```

治理全局统计：提案总数、投票总数、按状态和类型分布。

## 数据库表

| 表名 | 说明 |
|------|------|
| `governance_proposals` | 提案（标题、类型、状态、描述、提案者、影响等级、投票数、投票时间窗口） |
| `governance_votes` | 投票记录（提案 ID、投票者 DID、投票值、权重、理由） |

## 系统架构

```
用户命令 → governance.js (Commander) → community-governance.js
                                              │
              ┌──────────────────────────────┼──────────────────┐
              ▼                              ▼                   ▼
          提案管理                       投票 & 计票           分析 & 预测
  (create/activate/close/expire)   (vote/votes/tally)    (analyze/predict)
              ▼                              ▼                   ▼
     governance_proposals          governance_votes          启发式引擎
```

## 配置参考

```bash
# governance create
<title>                        # 提案标题（必填）
-t, --type <type>              # parameter_change|feature_request|policy_update|budget_allocation
-d, --description <text>       # 描述
-p, --proposer <did>           # 提案者 DID

# governance activate
-d, --duration-ms <ms>         # 投票持续时间 (默认 7 天)

# governance vote
<proposal-id> <voter-did> <yes|no|abstain>
-r, --reason <text>            # 投票理由
-w, --weight <n>               # 投票权重 (默认 1.0)

# governance close / tally
-q, --quorum <n>               # 法定人数 (0-1)
-t, --threshold <n>            # 通过阈值 (0-1)
-n, --total-voters <n>         # 总投票人数
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| create 创建提案 | < 200ms | ~90ms | OK |
| vote 投票 | < 100ms | ~50ms | OK |
| tally 计票 | < 200ms | ~100ms | OK |
| analyze 影响分析 | < 500ms | ~200ms | OK |
| predict 预测 | < 300ms | ~120ms | OK |
| stats 统计 | < 300ms | ~150ms | OK |

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/governance.js` | governance 命令主入口 (Phase 54) |
| `packages/cli/src/lib/community-governance.js` | 提案 CRUD、投票计票、影响分析、预测、统计核心实现 |
