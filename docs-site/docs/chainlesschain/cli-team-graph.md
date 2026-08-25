# GraphRun 观测与评估

> 适用版本：`chainlesschain@0.166.2`（功能自 `0.166.0` 起公开）｜命令入口：`cc team graph`｜性质：只读观测、时间旅行与质量门

## 概述

`cc team graph` 从 Graph Kernel 的耐久事件中生成可读 JSON 投影，用于回答：

- 当前 GraphRun 是运行中、成功、失败、死锁，还是需要人工对账？
- 哪些 Agent/Attempt 正在执行哪些 Task？
- Artifact、Message、Effect、Handoff 与 HumanTask 如何关联？
- 某个事件序列时系统处于什么状态？
- 两个时间点之间发生了哪些变化？
- GraphRun 是否满足 CI 阈值？

当前命令只读取已有 GraphRun，不创建、不恢复、不取消任务，也不修改权威状态。GraphRun 由启用 Graph Kernel 的 Team/Cowork/Scheduler 或其他 adapter 产生。

## 核心特性

- **耐久事件投影**：从 append-only Graph event store 重建 Agent、Task、Attempt、Artifact、Message、Effect、Handoff 与 HumanTask 关系。
- **时间旅行**：`inspect --at-seq` 只重放到指定事件序号，复原事故发生前后的真实状态。
- **阻塞根因**：`--blocked-root` 沿依赖、lease、Message、Effect 和人工任务定位节点不能继续的原因。
- **结构化差异**：`diff` 比较同一 GraphRun 的两个投影边界，生成 crash/resume、重试和 cutover 证据。
- **质量门**：`eval` 输出稳定 schema 和指标，阈值失败使用退出码 `2`，可直接接入 CI。
- **默认脱敏**：Message 和 HumanTask 正文默认不进入输出，只有显式 `--include-content` 才展开。
- **只读边界**：三个子命令均不改变 GraphRun 权威状态，也不触发外部副作用。

## 系统架构

```text
Team / Cowork / Scheduler / Adapter
                 │ authoritative events
                 ▼
┌──────────────────────────────────────────┐
│ Graph Kernel                             │
│ compiler · runtime · lease/fence · effect│
├──────────────────────────────────────────┤
│ Graph Event Store（durable rollout）      │
└───────────────┬──────────────────────────┘
                │ replay（只读）
        ┌───────▼────────┐
        │ Graph Projector │
        └───┬────┬────┬──┘
            │    │    │
        inspect diff eval ──→ JSON / CI gate
```

GraphDefinition 先由 compiler 验证 DAG、typed port、能力、预算与写冲突，再由 runtime 生成耐久事件。观测命令只消费 event store，不绕过 writer authority；同一个 GraphRun 的 `revisionDigest`、事件序号与 `projectionDigest` 用于绑定证据。

## 使用示例

### 快速开始

```bash
npm install --global "chainlesschain@0.166.2"

# 查看完整投影
cc team graph inspect <run-id>

# 回看事件序号 120 时的状态
cc team graph inspect <run-id> --at-seq 120

# 定位 task-7 被阻塞的根因
cc team graph inspect <run-id> --blocked-root task-7

# 比较两个时间点
cc team graph diff <run-id> --from-seq 80 --to-seq 120

# 生成指标并要求无死锁、无需未知结果对账
cc team graph eval <run-id> \
  --thresholds '{"deadlocked":{"max":0},"reconciliationRequired":{"max":0}}'
```

Windows PowerShell 中 JSON 建议使用单引号包围；如果 shell 转义复杂，也可以把 JSON 先保存为变量再传入。

## 配置参考

| 命令 / 选项                                | 必填            | 说明                                  |
| ------------------------------------------ | --------------- | ------------------------------------- |
| `inspect <runId>`                          | 是              | 当前或历史投影                        |
| `--at-seq <n>`                             | 否              | 截止到指定耐久事件序号                |
| `--blocked-root <nodeId>`                  | 否              | 输出指定节点的阻塞根因                |
| `--include-content`                        | 否              | 展开 Message/HumanTask 正文，默认关闭 |
| `diff <runId> --from-seq <n> --to-seq <n>` | 是              | 比较两个投影边界                      |
| `eval <runId> --thresholds <json>`         | thresholds 可选 | 生成指标并可执行 min/max gate         |
| `--state-dir <path>`                       | 否              | 覆盖默认 Graph event store 目录       |

### GraphRun 数据目录

默认目录为：

```text
<CHAINLESSCHAIN_HOME>/app-server/graph-runs
```

未设置 `CHAINLESSCHAIN_HOME` 时，`<CHAINLESSCHAIN_HOME>` 使用 CLI 的默认运行目录。测试、CI 或外部采集产物可显式指定：

```bash
cc team graph inspect <run-id> --state-dir ./artifacts/graph-runs
```

注意：`--state-dir` 应指向 Graph event store 本身，不是仓库根目录，也不是 App Server 的 `rollouts` 子目录。

## 4. `inspect`：查看当前或历史投影

```text
cc team graph inspect <runId> [options]

--state-dir <path>       Graph rollout 目录
--at-seq <n>             只重放到指定耐久事件序号
--blocked-root <nodeId>  定位指定节点的阻塞根因
--include-content        输出 Message 与 HumanTask 内容
```

### 4.1 当前状态

```bash
cc team graph inspect graph-run-1042
```

主要输出区域：

| 字段               | 说明                                      |
| ------------------ | ----------------------------------------- |
| `runId` / `status` | 运行身份与状态                            |
| `revisionDigest`   | GraphDefinition/动态 revision 身份        |
| `agentTree`        | Agent、capacity 与父子关系                |
| `taskGraph`        | 节点、依赖与节点状态                      |
| `artifactGraph`    | Artifact 与生产者关系                     |
| `messageGraph`     | Message 与因果/可见边                     |
| `attempts`         | AssignmentAttempt、lease/fence 与结算状态 |
| `effects`          | 外部副作用、receipt 与 reconcile 状态     |
| `handoffs`         | custody offer/accept/commit/reject/revoke |
| `humanTasks`       | 可认领人工任务与决策状态                  |
| `timeline`         | 按事件序号排序的时间线                    |
| `criticalPath`     | 关键路径与持续时间                        |
| `projectionDigest` | 当前投影的稳定摘要                        |

### 4.2 时间旅行

```bash
cc team graph inspect graph-run-1042 --at-seq 120
```

该命令只读取事件前缀，不会回滚 GraphRun。适合分析“死锁出现前哪个 lease/Message/Handoff 发生了变化”。

序号必须来自同一个 run。传入超过当前 head 的值等同于读取全部现有事件，不代表未来状态。

### 4.3 阻塞根因

```bash
cc team graph inspect graph-run-1042 --blocked-root task-7
```

输出同时包含完整 `projection` 与 `blockedRoot`。根因可能来自未完成依赖、失败/过期 Attempt、未决 Effect/HumanTask/Handoff 或资源等待。若 node id 不存在，应先检查 `taskGraph.nodes` 与 run/revision 是否匹配。

### 4.4 敏感内容

默认投影省略 Message 与 HumanTask 的正文。只有在确认输出位置安全时才使用：

```bash
cc team graph inspect graph-run-1042 --include-content
```

不要把带 `--include-content` 的 JSON 上传到公开 Issue、CI 公共 artifact 或第三方日志；其中可能含 prompt、工具结果、个人数据和审批上下文。

## 5. `diff`：比较两个事件序列

```text
cc team graph diff <runId> \
  --from-seq <n> \
  --to-seq <n> \
  [--state-dir <path>]
```

示例：

```bash
cc team graph diff graph-run-1042 --from-seq 80 --to-seq 120
```

典型用途：

- 比较中断前后哪些 Attempt/Effect 改变；
- 检查 crash/resume 是否重复创建 Artifact 或 Message；
- 定位从 running 进入 deadlocked 的首个状态差异；
- 为 shadow-run/cutover 保存差异证据。

`from-seq` 与 `to-seq` 都是包含式投影边界。通常应满足 `from < to`；反向比较虽可生成差异，但不应解释为实际回滚操作。

## 6. `eval`：指标与阈值门

```text
cc team graph eval <runId> [options]

--state-dir <path>    Graph rollout 目录
--thresholds <json>   每个指标的 min/max 约束
```

不传阈值时只生成报告：

```bash
cc team graph eval graph-run-1042
```

输出结构：

```json
{
  "report": {
    "schema": "chainlesschain.graph-eval/v1",
    "runId": "graph-run-1042",
    "metrics": {}
  },
  "gate": null
}
```

传阈值时同时返回 gate：

```bash
cc team graph eval graph-run-1042 --thresholds '{
  "terminalSuccess": {"min": 1},
  "deadlocked": {"max": 0},
  "reconciliationRequired": {"max": 0},
  "duplicateWorkRatio": {"max": 0.1},
  "messageVisibilityRate": {"min": 1}
}'
```

Gate 失败时进程退出码为 `2`，适合 CI：

```bash
cc team graph eval "$GRAPH_RUN_ID" --thresholds "$GRAPH_THRESHOLDS"
if [ $? -eq 2 ]; then
  echo "Graph quality gate failed"
  exit 1
fi
```

命令解析、文件或其他运行错误通常返回非 0；CI 不应只把 `2` 以外的错误当成通过。

## 7. 指标解释

| 指标                      | 范围/单位 | 含义                                     |
| ------------------------- | --------- | ---------------------------------------- |
| `terminalSuccess`         | 0 或 1    | GraphRun 是否以 succeeded 终态结束       |
| `acceptedAttempts`        | 个数      | 被接受并可结算节点的 Attempt 数          |
| `duplicateAttempts`       | 个数      | 同一节点超过首个 Attempt 的数量          |
| `duplicateWorkRatio`      | 0–1       | 重复 Attempt 占全部 Attempt 的比例       |
| `messageVisibilityRate`   | 0–1       | 已投影可见 Message edge / 已发送 Message |
| `handoffCompletionRate`   | 0–1       | 已进入终态的 Handoff 比例                |
| `custodyCommitRate`       | 0–1       | committed Handoff 比例                   |
| `criticalPathUtilization` | 0–1       | critical path / 全部 Attempt 工作时长    |
| `totalWorkMs`             | 毫秒      | 全部 Attempt 持续时间合计                |
| `criticalPathMs`          | 毫秒      | 关键路径持续时间                         |
| `deadlocked`              | 0 或 1    | 运行是否被分类为死锁                     |
| `reconciliationRequired`  | 0 或 1    | 是否存在必须人工/外部对账的未知结果      |

阈值应根据任务类型建立基线。不要对所有工作流机械要求 `duplicateAttempts=0`：有界 retry/speculation 可能是设计行为，但应限制 `duplicateWorkRatio` 并核对成本。

## 性能指标

Graph 的性能观察分为“运行效率指标”和“观测命令自身成本”。0.166.0 已公开前一类的稳定字段，但没有发布跨平台 `inspect/diff/eval` 延迟 SLO：

| 指标                      | 口径                               | 建议关注点                                  |
| ------------------------- | ---------------------------------- | ------------------------------------------- |
| `totalWorkMs`             | 所有 Attempt 工作时间总和          | 实际计算量与重试成本                        |
| `criticalPathMs`          | 关键路径工作时间                   | 理论最短完成路径与瓶颈                      |
| `criticalPathUtilization` | critical path / total work         | 并行度是否产生有效收益                      |
| `duplicateWorkRatio`      | 重复 Attempt / 全部 Attempt        | retry/speculation 的额外成本                |
| `messageVisibilityRate`   | 可见 Message edge / 已发送 Message | 消息投影完整性                              |
| `handoffCompletionRate`   | 终态 Handoff / 全部 Handoff        | 跨 Agent 交接结算质量                       |
| replay 输入规模           | 截止序号内的 durable event 数      | `inspect --at-seq` 与 `diff` 的主要成本来源 |

CI 应保存事件数量、rollout 文件大小、命令 wall time、进程 RSS 与输出大小，自行建立目标机器基线。长期 overload/fairness soak 和真实 provider 三平台 Graph Agent journey 尚未成为公开性能承诺，因此文档不填写未经统一环境复测的毫秒值。

## 8. CI 示例

PowerShell：

```powershell
$thresholds = '{"terminalSuccess":{"min":1},"deadlocked":{"max":0},"reconciliationRequired":{"max":0}}'
cc team graph eval $env:GRAPH_RUN_ID --state-dir .\artifacts\graph-runs --thresholds $thresholds
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Bash：

```bash
set -euo pipefail
cc team graph eval "$GRAPH_RUN_ID" \
  --state-dir ./artifacts/graph-runs \
  --thresholds '{"terminalSuccess":{"min":1},"deadlocked":{"max":0},"reconciliationRequired":{"max":0}}'
```

建议同时保存：

- eval JSON；
- run id 与 revision/projection digest；
- 精确 commit SHA；
- 不含敏感正文的 inspect JSON；
- 失败时的 diff 时间窗。

## 9. 常见分析流程

### 9.1 任务卡住

1. `inspect` 查看 `status`、ready/running node、active Attempt；
2. 对目标节点加 `--blocked-root`；
3. 检查未决 HumanTask、Handoff、Message 与 Effect；
4. 用 `--at-seq` 回到最后一次正常进展；
5. 用 `diff` 比较正常点和当前 head。

### 9.2 怀疑重复副作用

1. 查看 `effects` 的 operation/idempotency identity 与 receipt；
2. 查看同一 node 的 Attempt 数和 fence；
3. 比较 crash 前后的事件序列；
4. 若状态为 `reconciliation_required`，先核验外部系统，不重新运行命令。

### 9.3 Handoff 未完成

1. 查看 `handoffs` 是 offered、accepted、committed、rejected、revoked 还是 expired；
2. 核对 from/to Attempt 与 lease/fence；
3. 查看相关 Message 是否 processed/dead-letter；
4. 不要把 accepted 误写为 committed。

## 测试覆盖

0.166.0 源码含 41 个 Graph Kernel 聚焦测试，分布在五个测试文件：

| 测试文件                               | 重点覆盖                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `graph-kernel-compiler.test.js`        | DAG、依赖闭包、typed port、预算、写冲突、补偿、子图与触发器验证                           |
| `graph-kernel-runtime.test.js`         | 调度、动态扩展、lease/fence、消息、Handoff、HumanTask、死锁、取消、数据策略与 Effect 对账 |
| `graph-kernel-fault-injection.test.js` | dispatch/state/message/effect/ACK crash cutpoint 与恢复幂等性                             |
| `graph-kernel-observability.test.js`   | 投影、时间旅行、阻塞根因、diff、eval gate、多 seed 报告与 scheduler 映射恢复              |
| `graph-kernel-adapters.test.js`        | legacy surface claim、唯一 writer、shadow compare、cutover/rollback fencing               |

发布授权仍以精确提交上的 Linux、Windows、macOS CLI CI 和 Strict Sandbox 为准。41 个测试说明当前聚焦覆盖，不代表所有产品 adapter 已完成 authoritative cutover，也不替代真实 provider journey 与长时间 soak。

## 故障排除

### 输出为空或 run 不存在

- 核对 run id，不要使用 Thread id、Turn id 或 Team task id 替代；
- 核对 `--state-dir`；
- 当前 adapter 可能还未启用 Graph Kernel，只生成 legacy 状态；
- 先确认目录中是否存在该 run 的 rollout 文件。

### `--thresholds` JSON 解析失败

确认是合法 JSON，key 使用双引号；PowerShell 外层建议单引号。复杂配置可在脚本中构造单行字符串。

### Gate 报 `metric_missing`

阈值 key 不属于当前版本指标。先运行不带 `--thresholds` 的 eval，按 `report.metrics` 实际字段配置。

### `messageVisibilityRate` 低

检查 Message 是否只 admitted/delivered 而未进入 projection edge，或 consumer ACK/processed 事件是否在 crash 前未落账；这不应仅靠放宽阈值解决。

### `reconciliationRequired=1`

存在未知 Effect/外部结果。根据 receipt、operation digest 和外部系统证据执行 reconcile；不要盲目重跑任务。

## 安全考虑

- `inspect/diff/eval` 都是只读命令；
- 默认不输出 Message/HumanTask 正文；
- Graph event store 仍可能包含路径、Artifact metadata、tool name 和时间信息，应按敏感运行数据保护；
- 投影成功不等于代码、部署或外部业务结果成功，必须查看 terminal evidence；
- `cc team graph` 已发布不代表 Team/Cowork/Scheduler/Desktop/Browser 都已切换为 Graph authoritative writer；
- 当前真实 provider 三平台 Graph Agent journey 与长期 overload/fairness soak 仍是独立门禁。

## 关键文件

| 文件                                                   | 作用                                              |
| ------------------------------------------------------ | ------------------------------------------------- |
| `packages/cli/src/lib/graph-kernel/compiler.js`        | GraphDefinition 验证与确定性编译                  |
| `packages/cli/src/lib/graph-kernel/runtime.js`         | GraphRun 状态机、调度、lease/fence、Effect 与恢复 |
| `packages/cli/src/lib/graph-kernel/event-store.js`     | Graph durable event store                         |
| `packages/cli/src/lib/graph-kernel/trace-reducer.js`   | 当前/历史投影、diff 与阻塞根因                    |
| `packages/cli/src/lib/graph-kernel/eval.js`            | 指标和 eval gate                                  |
| `packages/cli/src/lib/graph-kernel/adapters.js`        | Team/Cowork/Scheduler 迁移与 writer authority     |
| `packages/cli/src/lib/graph-kernel/trigger-adapter.js` | scheduler occurrence 到 GraphRun 的幂等映射       |
| `packages/cli/src/commands/graph.js`                   | `inspect                                          | diff | eval` 参数、JSON 输出与 gate 退出码 |
| `packages/cli/src/commands/team.js`                    | 把 Graph 子命令注册到 `cc team graph`             |

## 相关文档

- [Agent Team](./cli-team.md)
- [CC App Server](./cli-app-server.md)
- [Agent SDK](./agent-sdk.md)
- [CLI Runtime 当前实现](./cli-runtime-current.md)
- [设计文档：Graph Kernel](/design/modules/105-graph-kernel)
- [设计文档：Agent 平台化](/design/modules/103-agent-sdk-platform)
