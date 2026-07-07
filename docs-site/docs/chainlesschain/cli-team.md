# Agent Team — 声明式任务图团队编排（`cc team`）

> **版本: Phase 4 (Agent Team) 全闭合 · 2026-07-04 | 状态: ✅ 生产就绪 | 独占 lease + 依赖 DAG + 团队预算 + 定向消息 + 会话恢复 + Worktree 隔离 | 50 测试（48 单元 + 2 真-git 集成）**
>
> `cc team` 把一份声明式任务图交给 N 个协作 teammate 并发执行：每个任务由**至多一个** teammate 持有独占租约（lease）执行，依赖未满足的任务不会启动，崩溃的 teammate 其任务会被自动回收重派。相比 [Cowork](./cowork.md) 的 master-worker 模式，Agent Team 提供了 lease 互斥的**共享任务图**、四维**团队预算**、teammate 间**定向消息**、以及每个 teammate 独立 **git worktree** 的并行隔离。

## 概述

Agent Team 是 ChainlessChain CLI 的多智能体任务图编排器。它解决的核心问题是：当一批任务之间存在**依赖关系**、需要**多个 teammate 并发**推进、且必须**不重复执行、不超预算、崩溃可恢复**时，如何安全地调度。

系统以一个 JSON 任务图为输入（每个任务声明 `key` / `title` / `dependsOn` / 要跑的 `command` 或 `prompt`），经拓扑排序后由 `TeamRunner` 驱动 N 个 teammate 循环「领取可执行任务 → 获取独占租约 → 执行 → 完成/失败重试」。底层的 `TaskLeaseRegistry` 组合复用 `session-core` 的 `SharedTaskList`（乐观锁 + 状态机 + 快照），叠加了它缺失的两项关键能力——**独占租约 + TTL** 和 **依赖 DAG**——从而保证：

- 一个任务在同一时刻**至多被一个 teammate 执行**（独占 lease），即便 M 个 teammate 同时抢占；
- 一个任务**只有在其全部依赖 COMPLETED 后才可领取**（DAG 门控），依赖被取消的任务永不执行；
- **teammate 崩溃**（租约过期未续）后，其任务被扫回 PENDING 重新分配。

`cc team run` 默认是**干跑（dry-run）**——只校验任务图 + 排程、无任何副作用，等价于 `cc eval --dry-run` 的安全探索语义；显式加 `--exec`（跑 shell 命令）或 `--agent`（把 prompt 交给无头 agent）才真正执行。

## 核心特性

- 🔒 **独占租约 + TTL**: 同一任务同时至多一个 holder，valid 期内他人领取被拒；租约过期可被 steal，崩溃 teammate 的任务自动回收。
- 🕸️ **依赖 DAG**: 任务声明 `dependsOn`，依赖全部完成才可领取；加边即 DFS 检环，自环/回边在加载期被拒（防死锁）。
- 💰 **四维团队预算**: `--max-tasks` / `--max-tokens` / `--max-usd`（委托已审计的 `CostBudget`，同 `--max-budget-usd` 计价）/ `--max-wall`；领取前检查、每任务结算后累加（失败任务也计数），至多超支在途任务数。
- 📬 **定向 + 广播消息**: teammate 间 `sendMessage(to, body)`（定向到某 teammate 或 `*` 广播），per-recipient 投递游标——广播对每个 teammate 恰投一次，teammate 收不到自己的广播。
- 🔄 **会话恢复**: `--state <file>` 每任务结算后写快照，`--resume` 从快照恢复任务图 + 消息 + 预算 + teammate 生命周期；崩溃残留租约被回收重跑，已完成任务保持完成。
- 🌲 **Worktree 隔离**: `--worktree` 让每个 teammate 在**自己的 git worktree** 执行（`--exec` 或 `--agent` 均可），并行编辑不争工作区；`--merge` 顺序预览并合并干净分支，冲突**报告不强合**。
- 👤 **Teammate 生命周期**: 每个 teammate 有 idle / running / failed / shutdown 状态 + `teammate:state` 事件；resume 时对崩溃 holder 的回收租约报 `teammate:lost`。
- 📡 **机器可读事件流**: `--json` 输出 `run:start` / `task:claimed` / `task:completed` / `task:failed` / `teammate:state` / `run:budget-exhausted` / `run:end` JSON Lines，供面板 / CI 消费。
- 🔁 **失败重试 → 取消**: 任务失败在 attempt 上限内退回 PENDING 重试，达上限转 CANCELLED（终态），团队不在必败任务上死循环。
- 🚦 **CI 门**: 任务图未全部完成时进程退出码为 1，可直接用作流水线闸门。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        cc team run                                │
│                  (commands/team.js — CLI 编排)                     │
│   载入任务图 · 建 budget/mailbox · 选执行器 · 事件打印 · 快照持久化    │
└───────────────┬───────────────────────────────┬──────────────────┘
                │                               │
     ┌──────────▼──────────┐        ┌───────────▼────────────┐
     │     TeamRunner      │        │   TeamWorktreeCoordinator│
     │ (team-runner.js)    │        │  (team-worktree.js)      │
     │ N teammate worker   │        │  每任务一个 git worktree  │
     │ 循环：              │        │  顺序 preview→merge      │
     │  claimable? ─┐      │        │  冲突报告不强合           │
     │  budget.stop?│      │        └──────────────────────────┘
     │  acquire ────┤      │
     │  run ────────┤      │        ┌──────────────────────────┐
     │  complete/fail│─────┼───────▶│   TeamBudget             │
     │  lifecycle    │      │  fold  │  (team-budget.js)        │
     │  drain inbox  │──────┼───────▶│  tasks/tokens/usd/wall   │
     └───────┬───────┘      │        │  snapshot/restore        │
             │              │        └──────────────────────────┘
             │              │        ┌──────────────────────────┐
             │              └───────▶│   TeamMailbox            │
             │                       │  (team-mailbox.js)       │
             │                       │  directed + broadcast    │
             │                       │  per-recipient 游标       │
             ▼                       └──────────────────────────┘
     ┌───────────────────────────────────────────────┐
     │            TaskLeaseRegistry                    │
     │            (task-lease.js)                      │
     │  组合 SharedTaskList（乐观锁 rev + 状态机 +      │
     │  快照）+ 独占 lease/TTL + dependsOn DAG +        │
     │  reclaimExpired 崩溃回收 + 检环                   │
     └───────────────────────┬───────────────────────┘
                             │ composes
                 ┌───────────▼────────────┐
                 │  SharedTaskList         │
                 │  (@chainlesschain/      │
                 │   session-core)         │
                 └─────────────────────────┘
```

**执行时序（一个 teammate worker 的循环）：**

```
loop:
  ├─ executions ≥ maxTasks?          → shutdown(max-tasks)
  ├─ budget.shouldStop()?            → shutdown(reason) + run:budget-exhausted
  ├─ nextClaimable(holder)?
  │    ├─ 无 & 有在途 → idle, tick, 重试
  │    └─ 无 & 无在途 → shutdown(no-more-work)
  ├─ acquire(lease)?  失败 → idle, tick, 重试
  └─ execute:
       running → drain inbox → runTask(inbox,sendMessage,budget)
       ├─ 成功 → complete + budget.record(usage) + completed++
       └─ 抛错 → fail(retry|cancel) + budget.record() + failed++
```

## 命令参考

### `cc team plan`

展示任务图的拓扑波次（wave）排程，不执行。

```bash
cc team plan --tasks graph.json           # 人类可读波次
cc team plan --tasks graph.json --json     # { waves, total } JSON
```

每个 wave 是「其依赖全部落在前序 wave」的任务集合——同一 wave 内的任务可并发。

### `cc team run`

用 N 个协作 teammate 运行任务图。

| 旗标                   | 说明                                                           | 默认       |
| ---------------------- | -------------------------------------------------------------- | ---------- |
| `--tasks <file>`       | 任务图 JSON 文件（必填）                                       | —          |
| `--teammates <n>`      | 并发 teammate 数                                               | `2`        |
| `--ttl <seconds>`      | 每任务租约 TTL（秒）                                           | `60`       |
| `--exec`               | 真实执行每个任务的 shell `command`                             | 关（干跑） |
| `--agent`              | 把每个任务的 `prompt` 交给无头 `cc agent -p`                   | 关         |
| `--model <model>`      | `--agent` 运行使用的模型                                       | 默认模型   |
| `--worktree`           | 每个任务在自己的 git worktree 执行（并行隔离；需 git 仓）      | 关         |
| `--merge`              | 配合 `--worktree`：把干净分支顺序合并回 base（冲突报告不强合） | 关         |
| `--max-tasks <n>`      | 预算：团队总任务执行数                                         | 无限       |
| `--max-tokens <n>`     | 预算：团队总 LLM token 数                                      | 无限       |
| `--max-usd <n>`        | 预算：团队总估算 USD 花费                                      | 无限       |
| `--max-wall <seconds>` | 预算：整轮墙钟秒数                                             | 无限       |
| `--state <file>`       | 把团队进度持久化到文件（供崩溃后 `--resume`）                  | 关         |
| `--resume`             | 从 `--state` 恢复（已完成任务保持，陈旧租约释放）              | 关         |
| `--json`               | 以 JSON Lines 输出事件流                                       | 关         |

**执行器优先级**：`--worktree`（+ `--exec`/`--agent`）> `--exec` > `--agent` > 干跑。默认干跑安全无副作用。

## 任务图格式

任务图是一个 JSON 文件（也接受顶层裸数组）：

```json
{
  "tasks": [
    { "key": "build", "title": "编译", "command": "npm run build" },
    {
      "key": "test-a",
      "title": "单元测试",
      "dependsOn": ["build"],
      "command": "npm run test:unit"
    },
    {
      "key": "test-b",
      "title": "集成测试",
      "dependsOn": ["build"],
      "command": "npm run test:integration"
    },
    {
      "key": "deploy",
      "title": "部署",
      "dependsOn": ["test-a", "test-b"],
      "prompt": "把 dist/ 部署到预发布环境并回报健康检查结果",
      "priority": "high"
    }
  ]
}
```

| 字段        | 必填                     | 说明                                                        |
| ----------- | ------------------------ | ----------------------------------------------------------- |
| `key`       | 是                       | 稳定的任务标识（供 `dependsOn` 引用，与插入顺序无关）       |
| `title`     | 是                       | 人类可读标题                                                |
| `dependsOn` | 否                       | 依赖的 `key` 列表；全部 COMPLETED 才可领取（也接受 `deps`） |
| `command`   | `--exec`/`--worktree` 时 | 要执行的 shell 命令                                         |
| `prompt`    | `--agent` 时             | 交给无头 agent 的自然语言任务                               |
| `priority`  | 否                       | `high` / `normal` / `low`——领取时高优先                     |

依赖成环（含自环）在加载期即被拒绝并报出环路路径。

## 配置参考

| 项           | 机制                            | 默认 | 备注                                           |
| ------------ | ------------------------------- | ---- | ---------------------------------------------- |
| 并发度       | `--teammates`                   | 2    | 独立任务的最大并发执行数                       |
| 租约 TTL     | `--ttl`（秒）                   | 60   | 超时未续约 → 任务可被回收/steal                |
| 失败重试上限 | `TaskLeaseRegistry.maxAttempts` | 3    | 达上限转 CANCELLED 终态                        |
| 任务预算     | `--max-tasks`                   | ∞    | 总执行数（含失败）上限                         |
| Token 预算   | `--max-tokens`                  | ∞    | input+output 累加（仅 `--agent` 有 usage）     |
| USD 预算     | `--max-usd`                     | ∞    | 委托 `CostBudget`，含 cache-token 计价         |
| 墙钟预算     | `--max-wall`（秒）              | ∞    | 首个任务开始起计；resume 时窗口**重启**        |
| 状态文件     | `--state`                       | 无   | v2 快照：registry + mailbox + budget + members |

**预算与 resume 的交互**：`--resume` 会恢复上次的预算 running totals（花费累计不清零）；若 resume 时又传了预算旗标，则 CLI 旗标**覆盖**旧上限（省略的旗标保留旧上限——绝不静默丢掉一个安全阈）。墙钟窗口 resume 时重启，不计崩溃间隔。

## 性能指标

| 维度          | 特性                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| 调度开销      | 纯内存 lease/DAG 记账，无外部依赖；`claimable()` 每轮 O(任务数)         |
| 并发上限      | `--teammates` 精确封顶（4 独立任务 + 2 teammate → 峰值恰 2 并发，非 4） |
| 依赖门控      | 依赖未全 COMPLETED 的任务零执行；被取消依赖的任务永不跑                 |
| 预算超支界    | 至多超支「在途任务数」——领取前检查，结算后累加                          |
| 崩溃回收      | 租约 TTL 过期即 `reclaimExpired()` 扫回 PENDING，O(任务数)              |
| 快照大小      | 与任务数 + 消息数线性，JSON 序列化                                      |
| Worktree 集成 | 顺序 preview→merge，后合并分支与已合并者冲突时被检出（非静默覆盖）      |

> 真机端到端验证（`--exec` 真 shell，3 teammate 跑菱形图）：`build →（test-a ‖ test-b 并发峰值 2）→ deploy`，每任务恰执行一次，退出码 0。预算：`--max-tasks 2` 在 2/3 处停；`--resume --max-tasks 10` 续跑至 3/3，totals 累计。

## 测试覆盖

共 **50 测试**（48 单元 + 2 真-git 集成），全绿。

| 测试文件                         | 数量 | 覆盖                                                                                |
| -------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| `task-lease-registry.test.js`    | 14   | 独占 lease / TTL steal / 崩溃回收 / DAG 门控 / 检环 / 重试→取消 / 快照往返          |
| `team-runner.test.js`            | 13   | 菱形 DAG 顺序 + 每任务恰一次 / 并发封顶 / 失败重试 / 预算停止 / 定向消息 / 生命周期 |
| `team-worktree.test.js`          | 8    | 每任务 worktree / 注入执行器（agent prompt）/ 顺序合并 / 冲突不合 / cleanup         |
| `team-budget.test.js`            | 7    | 四维封顶 / 结算累加 / snapshot resume / CLI 覆盖旧 cap / NaN 防毒                   |
| `team-mailbox.test.js`           | 6    | 定向投递一次 / 广播每人一次 / peek 不进游标 / 单调 id / snapshot 重投               |
| `team-worktree-real-git.test.js` | 2    | **真 git**：两独立任务双 clean 合并 / 同文件冲突后者 CONFLICT base 保留             |

## 安全考虑

- **命令执行边界**：`--exec` 与 `--worktree` 会真实执行任务图里的 shell `command`——任务图文件应视为可信输入，勿运行来源不明的任务图。`--agent` 走无头 `cc agent -p`，继承 agent 自身的权限模式（默认 `acceptEdits`）。
- **Worktree 隔离**：`--worktree` 让并行任务各自在独立 git worktree 修改，杜绝并行写争用；合并阶段冲突**只报告不强合**，绝不静默覆盖 base。
- **预算即安全阀**：USD 预算委托经审计的 `CostBudget`，对畸形/负成本做 NaN 防毒（不会把上限静默失效为无限）；resume 时省略的预算旗标保留旧上限，防止误删安全阈。
- **崩溃语义**：过期租约的陈旧 holder 不能再 `complete`/`renew`（防止一个已被重派的僵尸 teammate 误标他人工作完成）。
- **干跑默认**：`cc team run` 不加 `--exec`/`--agent` 时零副作用，鼓励先 `plan` / 干跑校验再真跑。

## 故障排除

| 现象                                   | 原因                         | 处理                                                            |
| -------------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| `dependency cycle [a → b → a]`         | 任务图成环                   | 检查 `dependsOn`，打破环路                                      |
| `--worktree requires a git repository` | 不在 git 仓内                | 在 git 仓根运行，或先 `git init`                                |
| 任务卡在 pending 不执行                | 依赖未完成或依赖被 CANCELLED | `cc team plan` 看波次；被取消依赖的任务永不跑（设计如此）       |
| `budget reached (max-tasks)` 提前停    | 命中团队预算                 | 调高对应 `--max-*`，或 `--resume` 时用更高的 cap 续跑           |
| resume 后仍立即停                      | 旧快照的预算上限已耗尽       | resume 时显式传更高的 `--max-tasks` 等覆盖旧 cap                |
| 合并报冲突未合并                       | 两任务改了同一文件           | 预期行为——冲突分支被报告不强合，手工解决后再合                  |
| teammate `lost`（resume 时）           | 上次运行崩溃残留租约         | 正常回收——该任务已扫回 PENDING 重跑                             |
| `--agent` 任务全失败                   | 无模型/provider 凭据         | 配置模型（见 `cc auth` / 环境变量），或先用 `--exec` 验证图结构 |

## 关键文件

| 文件                                               | 职责                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/cli/src/commands/team.js`                | `cc team plan/run` CLI 编排、任务图加载、执行器选择、事件打印、快照持久化     |
| `packages/cli/src/lib/agent-team/task-lease.js`    | `TaskLeaseRegistry`——独占 lease + TTL + DAG + 崩溃回收（组合 SharedTaskList） |
| `packages/cli/src/lib/agent-team/team-runner.js`   | `TeamRunner`——N teammate worker pool、生命周期、预算/消息接线                 |
| `packages/cli/src/lib/agent-team/team-budget.js`   | `TeamBudget`——四维团队预算 + snapshot/restore                                 |
| `packages/cli/src/lib/agent-team/team-mailbox.js`  | `TeamMailbox`——定向/广播消息 + per-recipient 游标                             |
| `packages/cli/src/lib/agent-team/team-worktree.js` | `TeamWorktreeCoordinator`——每任务 git worktree + 顺序合并                     |
| `packages/cli/src/harness/worktree-isolator.js`    | 底层 git worktree 创建/预览/合并原语                                          |

## 使用示例

### 1. 预览排程（不执行）

```bash
cc team plan --tasks pipeline.json
# Task graph: 4 task(s), 3 wave(s)
#   wave 1: build
#   wave 2: test-a, test-b
#   wave 3: deploy
```

### 2. 真实执行 shell 命令，3 个 teammate

```bash
cc team run --tasks pipeline.json --exec --teammates 3
#   → build [teammate-1]
#   ✔ build
#   → test-a [teammate-1]
#   → test-b [teammate-2]
#   ✔ test-a
#   ✔ test-b
#   → deploy [teammate-1]
#   ✔ deploy
# Team run: 4/4 completed (3 teammates, 4 executions, peak 2 concurrent)
```

### 3. 带预算 + 崩溃恢复

```bash
# 首次运行：限制总任务数 2，进度存盘
cc team run --tasks pipeline.json --exec --max-tasks 2 --state .team-state.json
# ... 2/4 completed — stopped early (max-tasks)

# 提高预算续跑，已完成的不重做
cc team run --tasks pipeline.json --exec --resume --state .team-state.json --max-tasks 10
# Resumed: 2/4 already done
# ... 4/4 completed
```

### 4. 每个 agent 任务在自己的 worktree 并行执行并合并

```bash
cc team run --tasks refactor.json --agent --worktree --merge --teammates 4
# 每个 teammate 在独立 git worktree 跑 prompt，结束后干净分支自动合并回 base，
# 冲突分支报告但不强合。
```

### 5. CI 门（JSON 事件流 + 退出码）

```bash
cc team run --tasks ci-graph.json --exec --json > events.jsonl
# 逐行 JSON 事件；任务图未全完成时退出码为 1，可直接做流水线闸门
```

## 相关文档

- [Cowork 多智能体协作系统](./cowork.md) — master-worker 模式的多智能体系统（Agent Team 的姊妹能力）
- [CLI Agent 模式](./cli-agent.md) — `cc agent -p` 无头执行（`--agent` 任务的底层）
- [可靠性评测 `cc eval`](./cli-eval.md) — 任务成功率评测 + 趋势报告（同 Phase 7 CI 门思路）
- [A2A 协议](./a2a-protocol.md) — 代理间通信协议
- [CLI 对标 Claude Code 优化计划](/design/CLAUDE_CODE_CLI_PARITY_OPTIMIZATION_PLAN) Phase 4（Agent Team）
