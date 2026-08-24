# 105. Graph Kernel 设计

> 状态：核心与只读观测面已随 `chainlesschain@0.166.0` 发布（2026-08-24）｜GraphDefinition v1｜Graph event v1｜authoritative 产品切换尚未完成

## 1. 定位

Graph Kernel 是 ChainlessChain 的 canonical 多 Agent 执行内核。它统一描述任务依赖、动态扩展、Agent capacity、AssignmentAttempt、消息与 custody handoff、外部 Effect、Artifact、HumanTask、恢复和终态证据。

Graph Kernel 与 CC App Server 分工明确：

| 层            | 负责                                                   | 不负责                           |
| ------------- | ------------------------------------------------------ | -------------------------------- |
| CC App Server | 产品接入、Thread/Turn/Item/Approval、协议协商、rollout | Task DAG 调度与多 Agent 资源竞争 |
| Graph Kernel  | Graph IR、调度、消息、Effect、HumanTask、事件与投影    | UI transport、客户端生命周期协议 |

## 2. 三类图

系统不把所有关系混成一张图：

1. **Task Graph**：运行前编译的确定性依赖 DAG，回答“哪些任务必须先完成”；
2. **Agent Tree**：运行时动态的 Agent、capacity 与 AssignmentAttempt，回答“谁在执行”；
3. **Artifact/Trace Graph**：运行后由 append-only 事件投影出的产物、消息、Effect 和时间线，回答“发生了什么、证据在哪里”。

三者共享 run id、revision digest、trace/correlation、权限、预算与事件序列，但不能互相代替。Agent Tree 的父子关系不是任务依赖，Artifact 边也不是调度边。

## 3. 架构

```text
GraphDefinition v1
  │ canonicalize + schema validate + migrate/upcast
  ▼
Graph Compiler
  ├─ reference / dependency / cycle validation
  ├─ port / capability / budget / write-scope validation
  ├─ loop / region / trigger / compensation validation
  └─ revisionDigest + immutable compiled graph
       │
       ▼
GraphKernel
  ├─ GraphRun + producer lease + dynamic revision CAS
  ├─ agent capacity + AssignmentAttempt lease/fence
  ├─ Effect begin/settle/reconcile + compensation
  ├─ Artifact provenance
  ├─ causal Message + dead letter
  ├─ custody handoff state machine
  ├─ HumanTask claim/quorum/separation-of-duty
  └─ deadlock/livelock/quiescence classification
       │
       ▼
GraphEventStore (append-only hash-chained rollout)
       │
       ├─ Trace reducer / time travel / diff / blocked root
       ├─ Graph eval / thresholds / schedule equivalence
       └─ runtime adapter shadow/cutover evidence
```

## 4. GraphDefinition 与编译器

`compileGraphDefinition()` 接受纯 JSON GraphDefinition。当前支持版本范围为 v1；canonical JSON 对 key 排序并拒绝非有限数字、函数、Symbol、BigInt、循环/重复对象和非 plain object，随后生成 domain-separated SHA-256 digest。

编译必须在任何 Effect 前完成。验证至少包括：

- Schema、版本与 migration/upcast；
- node/edge/loop/trigger/region id 唯一性；
- 未知引用、自引用和 dependency cycle；
- 输入/输出 port 与 `${node...}` / `${step...}` 引用；
- capability、预算（turn/token/cost/wall/spawn）与 write scope；
- loop/region 的边界和动态扩展约束；
- compensation node 唯一归属，禁止自补偿和冲突目标；
- trigger binding 与 scheduler dispatch 身份。

失败抛出 `GraphCompileError`，code 为 `CC_GRAPH_COMPILE_FAILED`，diagnostics 按 path/code 稳定排序，并明确 `effectStarted: false`。

## 5. GraphRun 生命周期

GraphRun 从 immutable compiled graph 与 revision digest 启动。运行时允许在 producer lease 下追加经过编译的新图片段；append 使用 revision CAS，seal 后禁止继续扩展。

```text
created → running ─┬─ succeeded
                   ├─ failed
                   ├─ cancelled
                   ├─ deadlocked
                   └─ reconciliation_required
```

Quiescence 不等于成功：当没有 ready/running work 时，还要检查 active producer lease、待处理消息、未决 handoff、HumanTask 和 unknown Effect，才能判断成功、等待、死锁或需要对账。

## 6. 调度、Attempt 与 fencing

Task node 与执行尝试采用 N:M 模型：一个 node 可以有多个 AssignmentAttempt，但只有 accepted attempt 可以结算节点。

关键字段：

- Agent `capacity`：限制并行占用；
- Attempt `leaseId` + `fence` + TTL：防止过期 Worker 回写；
- priority donation / aging / critical boost：缓解反转与饥饿；
- budget reservation：尝试开始前预留，结算时核销；
- artifact/write provenance：绑定 attempt、lease 与 scope。

`renewAttempt`、`beginEffect`、`settleEffect`、`registerArtifact` 与 `settleAttempt` 都复核 lease/fence。取消、租约过期或新 fence 生效后的迟到结果不能改变权威状态。

## 7. Effect、Receipt 与补偿

外部副作用使用两阶段语义：

1. `beginEffect` 在执行前记录 operation digest、attempt、authority 与幂等身份；
2. driver 执行外部操作；
3. `settleEffect` 记录 receipt；响应丢失或结果不明进入 unknown；
4. `reconcileEffect` 依据外部证据裁决，不盲目重放；
5. 需要时由显式 compensation node 处理，不把“反向执行”假设成天然可逆。

Graph Kernel 不宣称全局 exactly-once。正确口径是 durable admission、幂等身份、at-least-once delivery 与 unknown-outcome reconciliation。

## 8. Artifact

Artifact 注册绑定：

- stable id 与 digest；
- producer node/attempt；
- Graph revision；
- workspace/write scope；
- provenance 与 terminal evidence。

成功不能只依赖状态字符串。Adapter 返回 `succeeded` 时必须同时绑定 terminal event digest，以及 output digest、Artifact digest、commit 或 test receipt 中至少一类不可变输出证据。

## 9. Message 与 custody handoff

Message 生命周期区分 admitted、delivered、read、processed 与 dead-letter，携带 causation、correlation、conversation、sender attempt/lease、revision 与 payload digest。

消费语义是 at-least-once + consumer key 去重。ACK 丢失、poison message 和跨 channel 重排都必须能恢复。

Custody handoff 独立建模：

```text
offered → accepted → committed
   ├────→ rejected
   ├────→ revoked
   └────→ expired
```

commit/revoke 复核双方 attempt、lease/fence 与 binding，避免已失权 Agent 继续交付。

## 10. HumanTask

HumanTask 是可持久恢复的图节点等待态，不占用执行 slot。它支持：

- claim / reclaim；
- revision、attempt 与 operation digest binding；
- 单人决策或多人 quorum；
- separation of duty；
- 重启快照；
- cancel/decision CAS。

UI 不能仅凭本地按钮状态结算 HumanTask；必须提交绑定当前 revision 的决定并处理冲突。

## 11. 事件账本与投影

`GraphEventStore` 复用 hash-chained rollout，每个事件包含 schema、runId、seq、type、timestamp、prevHash、hash、idempotencyKey 与 payload。

Trace reducer 生成：

- Agent Tree；
- Task Graph；
- Artifact Graph；
- Message Graph；
- Effect/Attempt/Handoff/HumanTask 列表；
- Timeline 与 critical path；
- blocked root 与 projection digest。

`timeTravelGraphTrace(events, seq)` 只读取指定序列前缀；`diffGraphTrace(left, right)` 比较两个投影；这些操作不修改权威事件。

## 12. Eval

单次 GraphRun 指标包括：

- `terminalSuccess`
- `acceptedAttempts`
- `duplicateAttempts` / `duplicateWorkRatio`
- `messageVisibilityRate`
- `handoffCompletionRate` / `custodyCommitRate`
- `criticalPathUtilization`
- `totalWorkMs` / `criticalPathMs`
- `deadlocked`
- `reconciliationRequired`

Threshold gate 支持每个指标的 `min` / `max`。多 case/seed eval suite 还比较 single-agent control 与 graph candidate 的 terminal node / Artifact schedule equivalence，并要求绑定精确 40/64 字符 commit SHA。

## 13. CLI 观测面

```bash
cc team graph inspect <run-id> [--at-seq <n>] [--blocked-root <node-id>]
cc team graph diff <run-id> --from-seq <n> --to-seq <n>
cc team graph eval <run-id> [--thresholds <json>]
```

这是只读观测面，不负责创建 GraphRun。默认隐藏 Message/HumanTask 内容，`--include-content` 只应在受控诊断环境显式使用。

## 14. Adapter 与 authoritative 切换

已定义的 runtime surface：`cli_team`、`cowork`、`scheduler`、`desktop`、`browser`。每个 adapter 必须发布 machine-readable claims：

- execution：real / simulated / planned；
- persistence：durable / non_durable；
- isolated；
- terminalEvidence；
- authoritative；
- Browser 的 restartHydration / featureGated。

同一时刻最多一个 authoritative writer。切换前必须：

1. legacy 与 canonical shadow projection 的 terminal/causal diff 全等；
2. 完成可验证 rollback exercise；
3. 清零 legacy write entrypoints。

不满足任一条件时 `assertGraphKernelCutover` 失败闭合。

## 15. 安全不变量

- 编译先于 Effect，非法图不能产生副作用；
- 权限、预算、write scope 与 data sink 在节点和动态 append 时都复验；
- `origin`、`trust`、`sensitivity`、`allowedSinks` 随 DataRef/ArtifactRef 传播；
- lease/fence 阻止迟到 Worker、旧 Agent 与已取消 attempt 结算；
- Message/HumanTask 内容默认从 CLI 投影中省略；
- terminal success 必须有不可变证据；
- Browser 无 restart hydration 时只能 non-durable 且 feature-gated。

## 16. 发布状态与未决项

已发布：GraphDefinition v1 编译、Graph runtime 核心、event store、trace/time travel/diff、eval、runtime claims/shadow/cutover gate 与 CLI 只读观测面。

未关闭：

- CLI Team/Cowork/Scheduler/Desktop/Browser 的 authoritative 切换；
- loop/subgraph 完整生产执行语义；
- 逆依赖补偿执行器和全部 durable cut-point fault matrix；
- 真实 child Agent message/handoff 长时恢复；
- 30 分钟 overload/fairness soak；
- 真实 provider 的 Linux/Windows/macOS Graph Agent journey；
- Desktop/IDE topology、timeline 与 HumanTask UI。

## 17. 关键文件

| 路径                                                   | 说明                                                |
| ------------------------------------------------------ | --------------------------------------------------- |
| `packages/cli/src/lib/graph-kernel/compiler.js`        | GraphDefinition 编译、迁移与 digest                 |
| `packages/cli/src/lib/graph-kernel/runtime.js`         | GraphRun、调度、Effect、Message、Handoff、HumanTask |
| `packages/cli/src/lib/graph-kernel/event-store.js`     | append-only Graph event store                       |
| `packages/cli/src/lib/graph-kernel/trace-reducer.js`   | 投影、time travel、diff、blocked root               |
| `packages/cli/src/lib/graph-kernel/eval.js`            | 指标、threshold 与 suite                            |
| `packages/cli/src/lib/graph-kernel/adapters.js`        | claims、shadow diff 与 cutover gate                 |
| `packages/cli/src/lib/graph-kernel/trigger-adapter.js` | Scheduler occurrence → GraphRun dispatch journal    |
| `packages/cli/src/commands/graph.js`                   | `cc team graph` 只读命令                            |

## 18. 相关文档

- [GraphRun 用户指南](../../../docs-site/docs/chainlesschain/cli-team-graph.md)
- [CC App Server 设计](./104_CC_App_Server设计.md)
- [Agent 平台化方案](./103_Agent_SDK平台化方案.md)
- [Agent Team 用户指南](../../../docs-site/docs/chainlesschain/cli-team.md)
