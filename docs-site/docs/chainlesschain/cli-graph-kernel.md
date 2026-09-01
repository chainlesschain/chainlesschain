# Graph Kernel 使用与运维指南

> 适用版本：生产推荐与 npm `latest` 均为 `chainlesschain@0.166.15`（精确发布 SHA `22db04f559`）｜核心与只读观测面自 `0.166.0` 起公开，CLI authoritative entry 自 `0.166.7` 完成切换，当前版承接 durable history、retirement、quorum HumanTask 与平台安全边界｜性质：CLI 内置的 canonical 多 Agent 执行内核，不是独立 daemon

## 概述

Graph Kernel 用同一套耐久语义描述多 Agent 任务依赖、执行分派、消息与交接、外部副作用、人工决策、产物证据、恢复和终态。它要解决的不是“再画一张图”，而是让 Scheduler、Team、Cowork、Desktop 与 Browser 不再各自解释成功、失败、取消和恢复。

用户通常不会直接启动名为 `graph-kernel` 的服务。目前公开入口分成两类：

- `cc team plan/run/queue` 提供真实任务 DAG、lease/fence、预算、worktree 与恢复能力；`0.166.7` 的 entry-scoped store 与 cutover ledger 已将受支持 CLI 入口切到 canonical authoritative writer，`0.166.9` 再公开耐久历史、definition migration/retirement evidence 与跨端 single-winner settlement；
- `cc team graph inspect/diff/eval` 只读取已经存在的 canonical GraphRun 事件账本，用于观测、时间旅行、差异分析和质量门，不创建、恢复或取消 GraphRun。

因此，GraphRun ID 不能用 Team state ID、Thread ID、Turn ID 或 task key 代替。只有已经接入 canonical writer 的 adapter 才会返回可供 `cc team graph` 使用的 GraphRun ID。

## 核心特性

- **一个运行身份**：GraphRun envelope 绑定 run ID、definition/revision digest、authority、预算、correlation 与事件 head。
- **职责分离**：Task Graph 决定依赖与 ready frontier；Agent Tree 描述执行协作；Artifact/Trace 只从事件生成证据投影。
- **先编译后执行**：GraphDefinition 在任何工具、Provider、文件或网络 Effect 前完成依赖、类型、预算、权限与写冲突校验。
- **N:M 执行分派**：TaskNode 不与 Agent 固定 1:1 绑定，`AssignmentAttempt` 记录真实 Agent、角色、capacity、lease 与 fence。
- **可恢复副作用**：Effect 先记 operation identity，再记录 Receipt；响应丢失进入对账，不盲目重放。
- **实时协作证据**：Message、ACK、Handoff 与 HumanTask 都是耐久状态，不依赖 prompt 快照猜测。
- **动态扩图受控**：只有持有 producer lease，且通过 expected revision CAS、幂等 request ID、权限和预算复验的显式 append 才能修改 Task Graph。
- **确定性观测**：Trace reducer 只读重放 append-only 事件，生成拓扑、timeline、blocked root、diff 与 Eval，不反向写运行状态。
- **耐久历史与退休证据**：definition revision、migration、retirement、quorum HumanTask 与审批决定均绑定 expected revision/CAS；恢复时不能借用旧 generation 或过期授权。

## 系统架构

![GraphRun、Task Graph、Agent Tree 与 Artifact/Trace 投影关系图](/graph-kernel-planes.svg)

> 实线表示命令、调度或耐久事件；虚线只表示确定性只读投影。

必须按以下边界理解输出：

| 平面                  | 回答的问题                                     | 不能据此推断                      |
| --------------------- | ---------------------------------------------- | --------------------------------- |
| Trigger / Occurrence  | 哪个 cron、事件、resume 或 timer 被接纳？      | occurrence 成功就是 GraphRun 成功 |
| GraphRun envelope     | 这是哪个 revision、权限和预算下的运行？        | envelope 是包办调度的“万能图”     |
| Task Graph / runtime  | 哪些任务 ready、blocked、running 或 terminal？ | Agent 父子关系自动生成任务依赖    |
| Agent Tree            | 谁在执行、等待、发消息或交接？                 | spawn child 自动修改 Task DAG     |
| Artifact / Trace 投影 | 已发生什么，证据和因果在哪里？                 | 投影可以结算任务或触发副作用      |

### 当前可用性

| 能力                                        | `0.166.15` 用户口径                                             | 使用边界                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Team DAG 计划与执行                         | 已公开：`cc team plan/run/queue`                                | 受支持 CLI 入口已 canonical cutover；Desktop/Browser/IDE 等其他产品面仍按各自迁移证据判断 |
| GraphDefinition v1 compiler/runtime         | 源码核心已发布                                                  | 当前没有稳定的 `cc graph run` 公共 writer CLI；由产品 adapter 集成                        |
| GraphRun 观测                               | 已公开：`cc team graph inspect/diff/eval`                       | 只读；必须已有 GraphRun event store 与真实 run ID                                         |
| Scheduler occurrence 映射                   | 内核具备幂等映射与恢复契约                                      | occurrence 与 GraphRun 是两个状态机                                                       |
| Desktop/Cowork/Browser 接入                 | CLI entry cutover gate 已发布；Desktop Graph 调试器已有源码实现 | 非 CLI 产品面仍按各自 cutover 与发布身份判断，调试器只读投影不授予写权限                  |
| 动态扩图、Loop/Subgraph、Handoff、HumanTask | 内核契约与聚焦测试已有                                          | 生产可用性仍取决于具体 adapter、真实 provider journey 和发布门                            |

## 使用示例

### 1. 安装生产推荐版

```bash
npm install --global "chainlesschain@0.166.15"
cc team --help
```

### 2. 用 Team DAG 安全预览

创建 `team-graph.json`：

```json
{
  "tasks": [
    {
      "key": "build",
      "title": "构建",
      "command": "npm run build",
      "retrySafe": true
    },
    {
      "key": "test",
      "title": "测试",
      "command": "npm test",
      "dependsOn": ["build"],
      "retrySafe": true
    }
  ]
}
```

先验证 DAG 和并行波次，不执行命令：

```bash
cc team plan --tasks team-graph.json
cc team run --tasks team-graph.json
```

第二条命令默认也是 dry-run；只有显式 `--exec`、`--agent` 或 `--worktree` 才进入真实执行。

### 3. 真实运行并保存恢复状态

```bash
cc team run \
  --tasks team-graph.json \
  --exec \
  --worktree \
  --managed-checkpoint \
  --teammates 2 \
  --state /srv/cc-state/release-001/team-state.json
```

`--state` 必须位于任务不可写、仓库外部的可信目录。Windows 可使用受保护的绝对路径，例如 `C:\cc-state\release-001\team-state.json`。

Team adapter 的恢复入口是：

```bash
cc team run --tasks team-graph.json \
  --exec --worktree --teammates 2 \
  --state /srv/cc-state/release-001/team-state.json \
  --resume
```

这是 Team state 恢复，不等于公开的 Graph Kernel `recoverRun` CLI；不要把 `--state` 文件传给 `cc team graph --state-dir`。

### 4. 观测 canonical GraphRun

当接入的 adapter 返回 GraphRun ID 后：

```bash
cc team graph inspect <run-id>
cc team graph inspect <run-id> --at-seq 120
cc team graph inspect <run-id> --blocked-root task-7
cc team graph diff <run-id> --from-seq 80 --to-seq 120
cc team graph eval <run-id> \
  --thresholds '{"terminalSuccess":{"min":1},"deadlocked":{"max":0},"reconciliationRequired":{"max":0}}'
```

这些命令只读事件账本。`inspect --at-seq` 是历史投影，不会让真实运行回滚；`eval` gate 失败使用退出码 `2`，解析或运行错误使用其他非零退出码。

### 5. 判断运行是否结束

不能用“当前没有 ready task”或 occurrence `succeeded` 作为成功条件：

| 状态类别 | 典型状态                                                                                   | 操作建议                                                         |
| -------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 活动     | `running`                                                                                  | 查看 ready node、active Attempt、producer lease 与预算           |
| 等待     | `waiting_input`、`waiting_external`、`waiting_human`                                       | 完成对应输入、外部事件或 HumanTask；不要伪写成功                 |
| 待对账   | `reconciliation_required`                                                                  | 核对 Effect receipt、operation digest 与外部系统证据，不盲目重跑 |
| 终态     | `succeeded`、`failed`、`partial`、`cancelled`、`blocked`、`deadlocked`、`budget_exhausted` | 检查 terminal event digest 和不可变输出证据                      |

GraphRun 只有在图已 `SEALED`、producer lease 已结束、Attempt/Effect/Handoff/HumanTask 均已结算，并满足确定性 terminal predicate 时才能结束。

## 配置参考

### Team 执行入口

| 参数                          | 作用                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `--tasks <file>`              | Team 任务 DAG；不是完整 GraphDefinition v1 文件              |
| `--teammates <n>`             | 并发 teammate 数；真实共享目录执行大于 1 时必须使用 worktree |
| `--exec` / `--agent`          | 分别运行 shell 或 headless Agent；二者互斥                   |
| `--worktree`                  | 每任务 Git worktree 隔离，也是显式真实执行模式               |
| `--managed-checkpoint`        | 通过 Process Broker 保存受控文件写入检查点                   |
| `--state <file>` / `--resume` | Team adapter 的可信恢复状态与恢复开关                        |
| `--max-tasks/tokens/usd/wall` | 整个 Team run 的预算 ceiling                                 |
| `--agent-max-*`               | 每个 Agent task 的预算；只能收紧父级约束                     |

### GraphRun 观测入口

| 参数                       | 作用                                             |
| -------------------------- | ------------------------------------------------ |
| `inspect <runId>`          | 生成当前 GraphRun 投影                           |
| `--at-seq <n>`             | 只重放到指定耐久事件序号                         |
| `--blocked-root <nodeId>`  | 定位节点的确定性阻塞根因                         |
| `--include-content`        | 显式输出 Message/HumanTask 正文；默认关闭        |
| `diff --from-seq --to-seq` | 比较同一 GraphRun 两个事件边界                   |
| `eval --thresholds <json>` | 生成指标并应用 min/max 质量门                    |
| `--state-dir <path>`       | Graph event store 目录；不是 Team `--state` 文件 |

默认 GraphRun 事件目录是 `<CHAINLESSCHAIN_HOME>/app-server/graph-runs`。生产环境应显式管理目录权限、备份、保留期和敏感数据清理策略。

## 性能指标

Graph Kernel 不承诺脱离任务、provider、OS 与 adapter 的统一延迟数字。公开观测面提供以下可建立基线的指标：

| 指标                                          | 含义                                      |
| --------------------------------------------- | ----------------------------------------- |
| `totalWorkMs`                                 | 全部 accepted Attempt 的累计工作时间      |
| `criticalPathMs`                              | 关键路径工作时间                          |
| `criticalPathUtilization`                     | 关键路径与总工作的比率                    |
| `duplicateWorkRatio`                          | retry/speculation 造成的重复 Attempt 比率 |
| `messageVisibilityRate`                       | 已形成接收方可见证据的 Message 比率       |
| `handoffCompletionRate` / `custodyCommitRate` | 交接结算与 custody commit 质量            |
| `deadlocked`                                  | 是否形成确定性 wait-for cycle             |
| `reconciliationRequired`                      | 是否存在未知 Effect 或未决外部结果        |

CI 应同时保存 exact commit、revision/projection digest、event 数量、rollout 字节、wall time、RSS、provider/model、OS 与 sandbox 信息。不要把单机短测写成跨平台 SLO。

## 测试覆盖

Graph Kernel 聚焦测试覆盖以下契约：

- compiler：typed port、依赖闭包、cycle、预算、write scope、compensation、Loop/Subgraph 与 N/N-1 upcast；
- runtime：Occurrence/GraphRun 分离、动态 revision CAS、Attempt lease/fence、Artifact、Message/Handoff、HumanTask、取消与终态代数；
- structured control：有界循环、iteration identity、digest-pinned child run、预算切片与级联取消；
- fault injection：dispatch、状态、Message/ACK、Effect receipt、Loop decision 与 Subgraph binding 的 crash cut point；
- observability/eval：投影、time travel、blocked root、diff、threshold 与 occurrence journal 恢复；
- adapters：唯一 authoritative writer、shadow compare、cutover 与 rollback gate。

测试说明内核契约受到保护，不代表 Team/Cowork/Scheduler/Desktop/Browser 已全部完成 authoritative 切换。正式发布仍以 exact SHA 的 Linux、Windows、macOS `CLI CI` 与 `CLI Strict Sandbox` 全矩阵为准。

P2-3 的 formal Graph 协作质量评测与上述普通发布矩阵、下节 P1-12 生产切换证据是不同边界。GitHub `main@458b342f5f` 将 Windows 时延比最终上限调整为 `1.65`；固定 run `33411796790` 的 Windows 实测为 `1.6379980224`，三平台产物离线加权 aggregate 为 `0.6008293973`。该 run 仍为失败，且没有 final-SHA aggregate success/OIDC attestation。发布负责人显式接受不重跑的剩余证据风险并关闭 P2-3；这不把失败 run 改写为成功，不属于 `0.166.15` 制品，也不能作为 P1-12 或其他发布门的通用先例。

## 生产切换完成门

P1-12 的生产完成结论不能由单个 entry 的 ledger 状态或一份手写摘要给出。受保护部署必须先生成完整的 `chainlesschain.graph-production-cutover-evidence/v1`，再运行：

```bash
npm --prefix packages/cli run graph:production-evidence -- \
  --evidence /trusted/graph-production-cutover-evidence.json \
  --expected-commit <full-commit-sha> \
  --expected-repository chainlesschain/chainlesschain \
  --expected-environment graph-kernel-production \
  --expected-run-id <github-actions-run-id> \
  --output /trusted/graph-production-cutover-receipt.json
```

聚合门会失败闭合地要求：

- 20 个 durable entry 全部按顺序完成 shadow、internal canary、opt-in canary、canonical default 与 legacy read-only；
- 每个 entry 的 definition/revision、终态根因、Task/Attempt、assignment、Message/Handoff、Effect/Receipt、Artifact、预算与 workspace/test receipt 九类 projection 全等价；
- Linux、Windows、macOS 同一精确 SHA 的 canary 产品旅程全部通过；
- `shadow → legacy`、`canary → shadow`、`canonical → canary` 三个回滚边界均证明 RPO=0、无重复 Effect，并保留既有 canonical run authority；
- 13 个 retire entry 的 replacement、360 个旧 mutation、32 个历史只读入口与逐 writer 观察完整；7 个 migrate entry 的旧 writer/mutation 同样有正样本且零成功；
- Browser 的 3 个 non-durable entry 继续默认关闭，且没有 durable authority 或 direct-engine 调用；
- evidence 绑定受保护 producer 的 repository、environment、run ID、OIDC attestation 与精确提交。

`.github/workflows/graph-kernel-production-cutover.yml` 只消费并验证受信生产 artifact，不生成或伪造流量。缺少 staged rollout、观察窗口或 attestation 时不会产生通过 receipt。

## 安全考虑

- GraphDefinition 必须在首个 Provider、工具、文件、进程或网络 Effect 前编译成功。
- 权限、预算、capability、write scope 和 allowed sink 在动态 append 与恢复时必须重新验证，不能只信初始 prompt。
- `origin/trust/sensitivity/allowedSinks` 随 Message、DataRef 与 ArtifactRef 传播；不可信内容不能自行升级为 approval、authority 或 control edge。
- Agent spawn 只改变 Agent Tree；只有 producer lease + revision CAS + 幂等 request ID 的显式 append 才能修改 Task Graph。
- 外部 Effect 不宣称 exactly-once。响应丢失时依据 receipt/reconcile 裁决，不能从 Trace 投影猜测后重放。
- `--include-content` 可能暴露 prompt、工具结果、路径和人工审批正文，不要上传到公开 CI artifact 或 Issue。
- terminal `succeeded` 必须绑定 terminal event digest，以及 Artifact、output、commit 或 test receipt 中至少一种不可变证据。
- 同一运行面最多一个 authoritative writer；shadow adapter 只能比较，不能同时写权威状态。

## 故障排查

### `GraphRun not found`

先确认使用的是真实 GraphRun ID，并核对 `--state-dir`。Team state ID、Thread ID、Turn ID 和 task key 都不是 GraphRun ID。若 adapter 尚未 canonical cutover，它可能只保存 legacy state，此时应使用对应 Team/Cowork/Scheduler 恢复入口。

### occurrence 显示成功，但 GraphRun 仍在运行

这是正常的双状态机语义。occurrence 成功只表示 start/wake 已耐久接纳；继续检查 GraphRun 的 ready frontier、Attempt、producer lease、HumanTask、Handoff 与 Effect。

### 没有 ready task，但没有终态

检查图是否仍为 `OPEN`、是否存在 active producer lease、待处理 Message、HumanTask、timer、child run、unknown Effect 或 revision。只有 `SEALED` 且所有未决项结算后才能判断 blocked/deadlocked/terminal。

### `reconciliation_required`

核对 operation digest、idempotency identity、Receipt 和外部系统记录。确认结果后通过 owning adapter 的裁决入口提交决定；不要直接删除事件、改状态文件或重跑副作用。

### `CC_GRAPH_REVISION_CONFLICT` / stale lease

动态 producer 使用了旧 `expectedGraphRevision`，或 Attempt/producer lease 已被新的 fence 取代。重新读取权威 head，重新编译与复验；不要覆盖 CAS 或接受迟到结果。

### Team `--resume` 后仍要求裁决

说明先前真实执行可能已产生无法自动判断的副作用。先用 `cc team adjudications --state <file>` 查看案件，再把最新 state ID、adjudication digest、operator authority 和 reason 传给 `cc team adjudicate`，做一次性 `retry/accept/cancel` 决策；没有证据时默认失败闭合。

## 关键文件

| 文件                                                               | 作用                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `packages/cli/src/lib/graph-kernel/compiler.js`                    | GraphDefinition v1、upcast、静态验证与 revision digest        |
| `packages/cli/src/lib/graph-kernel/runtime.js`                     | GraphRun、Attempt、Effect、Message、Handoff、HumanTask 与恢复 |
| `packages/cli/src/lib/graph-kernel/event-store.js`                 | append-only Graph event store                                 |
| `packages/cli/src/lib/graph-kernel/trace-reducer.js`               | 当前/历史投影、blocked root 与 diff                           |
| `packages/cli/src/lib/graph-kernel/eval.js`                        | 指标、threshold gate 与多 seed suite                          |
| `packages/cli/src/lib/graph-kernel/trigger-adapter.js`             | occurrence 到 GraphRun 的幂等 dispatch journal                |
| `packages/cli/src/lib/graph-kernel/adapters.js`                    | adapter claims、shadow compare 与 cutover gate                |
| `packages/cli/src/lib/graph-kernel/production-cutover-evidence.js` | 五 surface/23 entry 生产切换聚合门                            |
| `packages/cli/scripts/graph-production-cutover-evidence.mjs`       | 校验受保护 evidence 并生成完成 receipt                        |
| `packages/cli/src/commands/graph.js`                               | `cc team graph` 只读命令                                      |
| `packages/cli/src/commands/team.js`                                | 当前公开 Team DAG 与迁移 adapter 入口                         |

## 相关文档

- [GraphRun 观测与评估](./cli-team-graph.md)
- [Agent Team 使用指南](./cli-team.md)
- [Agent Kernel 使用与运维](./cli-agent-kernel.md)
- [CC App Server 使用指南](./cli-app-server.md)
- [CLI Runtime 当前实现](./cli-runtime-current.md)
- [设计文档：Graph Kernel](/design/modules/105-graph-kernel)
- [开源差距分析 6.9（GitHub）](https://github.com/chainlesschain/chainlesschain/blob/main/docs/CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md#69-将多套图收敛为-canonical-graph-kernel)
