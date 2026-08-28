# 105. Graph Kernel 设计

> 状态：核心与只读观测面首次随 `chainlesschain@0.166.0` 发布；CLI、Team、distributed-team、Cowork、Scheduler 与 App Server 的 authoritative entry cutover 已随完整门禁的 `0.166.7@19834a1845` 发布（2026-08-28）｜GraphDefinition v1｜Graph event v1｜Desktop/Browser 等产品面的切换继续独立验收

## 1. 定位

Graph Kernel 是 ChainlessChain 的 canonical 多 Agent 执行内核。它统一描述任务依赖、动态扩展、Agent capacity、AssignmentAttempt、消息与 custody handoff、外部 Effect、Artifact、HumanTask、恢复和终态证据。

Graph Kernel 与 CC App Server 分工明确：

| 层            | 负责                                                   | 不负责                           |
| ------------- | ------------------------------------------------------ | -------------------------------- |
| CC App Server | 产品接入、Thread/Turn/Item/Approval、协议协商、rollout | Task DAG 调度与多 Agent 资源竞争 |
| Graph Kernel  | Graph IR、调度、消息、Effect、HumanTask、事件与投影    | UI transport、客户端生命周期协议 |

## 2. GraphRun 与三类图

`GraphRun` 是 authority envelope，不是把所有关系混在一起的第四种“万能图”。它绑定 run id、definition/revision digest、trace/correlation、权限、预算与事件 head；三类图共享这些身份，但各自只有一种职责：

| 平面 | 回答的问题 | 权威职责 | 明确不负责 |
| --- | --- | --- | --- |
| Task Graph / runtime | 哪些任务何时可以运行？ | 确定性依赖、condition、join、retry、ready frontier、Attempt 与终态 predicate | 表达动态 Agent 父子关系 |
| Agent Tree | 谁在执行和协作？ | spawn、capacity、AssignmentAttempt、message、handoff、wait/interrupt 与 residency | 定义 Task 依赖；父子关系不自动生成 DAG 边 |
| Artifact/Trace projection | 发生了什么，证据在哪里？ | 从 append-only 事件确定性生成 provenance、因果、timeline、replay、diff 与 Eval | 作为 scheduler source of truth 或反向写 runtime |

![GraphRun、Task Graph、Agent Tree 与 Artifact/Trace 投影关系图](/graph-kernel-planes.svg)

> 实线表示命令、调度或耐久事件；虚线只表示确定性只读投影。

箭头语义也不能混用：`start/wake` 是命令，`dispatch AssignmentAttempt` 是调度，指向 event store 的边是耐久事实，虚线 reduce 是只读投影。Agent 动态 spawn 只改变执行拓扑；只有通过 compile、权限/预算复验和 expected-revision CAS 的显式 append 才改变 Task Graph。

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

### 3.1 现有执行面的收敛职责

Canonical Graph Kernel 不是再造一个平行 scheduler，而是把已有真实能力收敛到上述职责边界：

| 现有执行面 | 复用到 canonical kernel 的能力 | 收敛要求 |
| --- | --- | --- |
| CLI Scheduler Kernel | occurrence identity、temporal admission、lease/fence、retry/dead-letter 与 unknown-outcome adjudication | 只负责 Trigger/Occurrence；以 journal 关联唯一逻辑 GraphRun，不计算 Task ready frontier |
| CLI `cc team` | 依赖 DAG、priority、Task lease/fence、预算、scope、worktree/checkpoint/merge 与分布式恢复 | 收敛为 Task runtime/AssignmentAttempt adapter；补齐 typed contract、revision CAS 和 authoritative event writer |
| CLI Cowork / Dynamic Workflow | condition、fan-out、loop、retry/timeout、definition digest、Effect/Receipt 与 Artifact lineage | 收敛为 Graph Compiler、structured control 与 Effect adapter；并行写必须进入 scope/worktree 隔离 |
| Desktop Browser Workflow | condition、nested loop、try/catch/finally 与 sub-workflow | 作为 Region/LoopRegion/SubgraphCall adapter；补 restart hydration、parent binding、cycle/depth guard 与取消级联 |
| 旧 Workflow/AgentCoordinator/`$team` | designer、UI、模板与兼容状态 | 降级为 designer/simulator 或只读投影，不能继续声明 phantom success |
| `*V2` governance overlay | profile、容量与策略原型 | feature-gate，或改为耐久事件投影；进程内 `Map` 不能冒充可恢复 runtime |

收敛完成的判据不是“存在同名类”，而是同一 adapter contract、同一事件账本、唯一 authoritative writer、shadow projection 等价、rollback drill 通过并关闭 legacy write entrypoint。

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

### 4.1 Versioned typed Graph IR

Canonical IR 至少包含以下一等实体，不能把它们压回 prompt 字符串或一个宽泛的 `task.status`：

| 实体 | 绑定内容 |
| --- | --- |
| `GraphDefinition / GraphRevision` | version、immutable digest、typed node/edge、预算与权限上界 |
| `GraphRun / TriggerBinding / OccurrenceRef` | 运行身份、revision、authority、correlation、event head 与幂等 admission |
| `TaskNode / Edge` | capability/role、tools/skills、typed input/output、acceptance、permission、budget、write-set、retry、effect class 与 compensation |
| `Region / LoopRegion / SubgraphCall / IterationFrame` | 显式 entry/exit、bounded iteration、digest pin、budget slice、cancel/compensation boundary 与 call-cycle/depth guard |
| `AgentRuntime / AssignmentAttempt` | 真实 executor/participant、capacity slot、role、grant、lease/fence 与 participation status |
| `Message / Handoff / HumanTask / Decision` | 因果消息、custody 状态机、人工 claim/quorum、operation digest、TTL 与 CAS |
| `ArtifactRef / Receipt / WaitReason` | 不可变产物、外部 Effect 证据、消费者、retention 与确定性等待根因 |

边区分 control、data、message、review、merge 与 compensation，并支持 `success/failure/always/timeout/cancel` 传播；join 支持 `all/any/quorum/race`。Task 依赖保持无环，循环和递归只能通过有界 Region/Subgraph 展开为 `(nodeId, iterationPath, attempt)` 唯一的无环执行尝试。

Message、DataRef 与 ArtifactRef 还携带可信 dispatch 赋值的 `origin/trust/sensitivity/allowedSinks`。解密、降级或跨信任域发送必须绑定审计化 declassification decision；不可信内容不能自行变成 approval、Graph control edge 或新增 capability。

## 5. GraphRun 生命周期

GraphRun 从 immutable compiled graph 与 revision digest 启动。运行时允许在 producer lease 下追加经过编译的新图片段；append 使用 revision CAS，seal 后禁止继续扩展。

一次正常运行按以下边界推进：

1. Scheduler occurrence 通过幂等 admission，仅提交 start/wake 命令；
2. GraphRun 绑定 immutable revision、authority 与预算，同一 occurrence 重试仍关联同一逻辑 run；
3. Task runtime 计算 ready frontier，并向 Agent Tree 分派 `AssignmentAttempt`；
4. Attempt、Message/Handoff、Effect/Receipt、Artifact 与状态转换追加到事件账本；
5. terminal predicate 成立后结算 run；projector 始终只读消费事件并生成调试/Eval 投影。

```text
created → running/open ──seal──> running/sealed
             │                         ├─ waiting_input / waiting_external
             │                         ├─ waiting_human / reconciliation_required
             │                         └─ succeeded / failed / partial / cancelled
             │                            blocked / deadlocked / budget_exhausted
             └─ producer lease + revision CAS append（仅 open）
```

Quiescence 不等于成功：当没有 ready/running work 时，还要检查 active producer lease、待处理消息、未决 handoff、HumanTask、timer/child/revision 和 unknown Effect，才能判断成功、等待、死锁或需要对账。Occurrence `succeeded` 只表示 start/wake 已耐久接纳，不代表 GraphRun 成功；外部 Effect 响应丢失必须依据 receipt/reconcile 裁决，不能从 Trace 投影猜测后盲目重放。

运行终态采用确定性代数：全部取消才是 `cancelled`，成功与失败/取消并存为 `partial`，失败依赖产生 `upstream_failed/blocked-root`，循环上限产生 `budget_exhausted`。`reconciliation_required` 是必须继续裁决的非成功状态，不能通过 UI 文案改写为 completed。

## 6. 调度、Attempt 与 fencing

Task node 与执行尝试采用 N:M 模型：一个 node 可以有多个 AssignmentAttempt，但只有 accepted attempt 可以结算节点。

关键字段：

- Agent `capacity`：限制并行占用；
- Attempt `leaseId` + `fence` + TTL：防止过期 Worker 回写；
- priority donation / aging / critical boost：缓解反转与饥饿；
- budget reservation：尝试开始前预留，结算时核销；
- artifact/write provenance：绑定 attempt、lease 与 scope。

`renewAttempt`、`beginEffect`、`settleEffect`、`registerArtifact` 与 `settleAttempt` 都复核 lease/fence。取消、租约过期或新 fence 生效后的迟到结果不能改变权威状态。

调度还必须同时处理：

- 依赖后代的 priority donation、等待 aging 与 critical-path boost，避免 priority inversion 和长期饥饿；
- `all/any/quorum/race` join，以及 race loser cancellation；
- workspace write-set 静态冲突检查和运行时 active scope 冲突；并行可写节点默认使用独立 worktree，不能把 checkpoint 当成外部副作用补偿；
- cancel/timeout 停止新分派、级联中断 child、等待在途 settlement，再以 fencing 拒绝 late result；
- Task/Agent/Message/Scope/Lease/Timer/Human/Join wait-for graph，以及 progress digest 重复形成的 livelock 诊断。

## 7. Effect、Receipt 与补偿

外部副作用使用两阶段语义：

1. `beginEffect` 在执行前记录 operation digest、attempt、authority 与幂等身份；
2. driver 执行外部操作；
3. `settleEffect` 记录 receipt；响应丢失或结果不明进入 unknown；
4. `reconcileEffect` 依据外部证据裁决，不盲目重放；
5. 需要时由显式 compensation node 处理，不把“反向执行”假设成天然可逆。

Graph Kernel 不宣称全局 exactly-once。正确口径是 durable admission、幂等身份、at-least-once delivery 与 unknown-outcome reconciliation。

Graph state、lease、Message 和 Effect Receipt 之间的跨组件提交使用 transactional outbox/inbox 或等价 journal 收敛。必须覆盖“状态已提交但消息未发”“任务已派发但 lease 未落账”“Effect 已发生但 Receipt 丢失”“processed 已发生但 ACK 未持久化”等 crash cut point；恢复依靠 inbox dedup、fencing 与 reconcile，而不是进程内回调顺序。

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

### 14.1 CLI 0.166.7 authoritative cutover

`0.166.7` 将 CLI graph、Team、distributed-team、Cowork、Scheduler 与 App Server 入口统一接入持久 cutover ledger 和 authority resolver。每次入口运行绑定 checked-out source evidence、entry、store、writer 与 revision；takeover、恢复和 migration saga 复核 lease/fence 与耐久 head。过期 owner、错误 store 或不匹配源码不能继续写入。

Retired runtime 只保留显式只读历史投影；未分类或仍尝试 mutation 的 legacy route 失败闭合并返回 canonical replacement target。这里的“authoritative”只覆盖上述 CLI 产品入口，不把 Desktop、Browser 或 IDE 自动视为完成切换。

### 14.2 Desktop Graph Run Debugger

Desktop 源码提交 `3e4d70eb52` 与 `8995ca2488` 增加只读 Graph Run Debugger，并在 AI Chat、Workflow Monitor 与 Agent Dashboard 任务历史中消费 canonical Graph/history：

- Topology：节点依赖、状态、critical path、slack 与 blocked root；
- Timeline：耐久事件时间线；
- Budget heatmap：节点预算使用率；
- Trace overlay：Attempt、Artifact 与 Effect 证据；
- Causality：任务、消息、审批、租约与 Artifact 的元数据因果链；
- replay slider：按历史 revision/time frame 回放并展示节点增删、状态差异。

Debugger 是 Renderer 侧只读投影，不持有 writer authority。消息与 Artifact 正文不进入 overlay；历史来源没有耐久事件时必须显示缺口，不能从 UI 状态反推或补写权威事实。该 Desktop 源码增量不属于 npm CLI `0.166.7` 制品。

## 15. 安全不变量

- 编译先于 Effect，非法图不能产生副作用；
- 权限、预算、write scope 与 data sink 在节点和动态 append 时都复验；
- `origin`、`trust`、`sensitivity`、`allowedSinks` 随 DataRef/ArtifactRef 传播；
- lease/fence 阻止迟到 Worker、旧 Agent 与已取消 attempt 结算；
- Message/HumanTask 内容默认从 CLI 投影中省略；
- terminal success 必须有不可变证据；
- Browser 无 restart hydration 时只能 non-durable 且 feature-gated。

## 16. 发布状态与未决项

已发布：GraphDefinition v1 编译、Graph runtime 核心、structured Loop/Subgraph、event store、trace/time travel/diff、eval、runtime claims/shadow/cutover gate 与 CLI 只读观测面。`0.166.7` 进一步完成 CLI graph、Team、distributed-team、Cowork、Scheduler 与 App Server entry 的 authoritative writer 切换、耐久 fencing/recovery 和 legacy mutation containment；这仍不能外推为所有 Desktop/Browser/IDE 产品面已完成切换。

| 层级 | 当前状态 | 对外口径 |
| --- | --- | --- |
| Compiler / Runtime / Event Store | 源码核心已发布并有聚焦测试 | 内核能力存在；不等于稳定公共 writer API |
| `cc team graph` | `inspect/diff/eval` 已公开 | 只读已有 GraphRun，不创建、恢复或取消 |
| CLI Team/distributed-team/Cowork/Scheduler/App Server | `0.166.7` 已通过 cutover ledger 解析唯一 writer | entry/store/source evidence 不匹配或 legacy mutation 时失败闭合 |
| Desktop | Graph 执行 adapter、耐久历史与只读 Debugger 已进入源码 | 独立完成 packaged Electron、hydration、rollback 与 writer-cleanup 前不继承 CLI 发布结论 |
| Browser/IDE | claims、pilot、shadow/cutover 机制已有 | 不满足 hydration/rollback/writer-cleanup 时保持 non-authoritative 或 feature-gated |

未关闭：

- Desktop/Browser/IDE 的 authoritative 切换；
- loop/subgraph 完整生产执行语义；
- 逆依赖补偿执行器和全部 durable cut-point fault matrix；
- 真实 child Agent message/handoff 长时恢复；
- 30 分钟 overload/fairness soak；
- 真实 provider 的 Linux/Windows/macOS Graph Agent journey；
- Desktop HumanTask 决策 UI 与 IDE 原生 topology/timeline UI；Desktop 只读 Graph Debugger 已完成。

## 17. 关键文件

| 路径                                                   | 说明                                                |
| ------------------------------------------------------ | --------------------------------------------------- |
| `packages/cli/src/lib/graph-kernel/compiler.js`        | GraphDefinition 编译、迁移与 digest                 |
| `packages/cli/src/lib/graph-kernel/runtime.js`         | GraphRun、调度、Effect、Message、Handoff、HumanTask |
| `packages/cli/src/lib/graph-kernel/event-store.js`     | append-only Graph event store                       |
| `packages/cli/src/lib/graph-kernel/trace-reducer.js`   | 投影、time travel、diff、blocked root               |
| `packages/cli/src/lib/graph-kernel/eval.js`            | 指标、threshold 与 suite                            |
| `packages/cli/src/lib/graph-kernel/adapters.js`        | claims、shadow diff 与 cutover gate                 |
| `packages/cli/src/lib/graph-kernel/cutover-ledger.js`  | entry/store/writer authority 与耐久切换证据         |
| `packages/cli/src/lib/graph-kernel/authority.js`       | writer、lease、receipt 与恢复 authority             |
| `packages/cli/src/lib/graph-kernel/trigger-adapter.js` | Scheduler occurrence → GraphRun dispatch journal    |
| `packages/cli/src/commands/graph.js`                   | `cc team graph` 只读命令                            |
| `desktop-app-vue/src/renderer/components/graph/GraphRunDebugger.vue` | Desktop topology/timeline/budget/trace/causality 只读调试器 |

## 18. 相关文档

- [Graph Kernel 用户指南](../../../docs-site/docs/chainlesschain/cli-graph-kernel.md)
- [GraphRun 观测子指南](../../../docs-site/docs/chainlesschain/cli-team-graph.md)
- [CC App Server 设计](./104_CC_App_Server设计.md)
- [Agent 平台化方案](./103_Agent_SDK平台化方案.md)
- [Agent Team 用户指南](../../../docs-site/docs/chainlesschain/cli-team.md)
