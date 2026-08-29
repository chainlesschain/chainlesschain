# 108 Context/Memory Kernel 设计

> 状态：仓库实现与默认切换完成；正式生产关闭等待 exact-SHA 三平台矩阵和 30 分钟 soak｜范围：CLI、Desktop、IDE、Agent SDK 共用的上下文构建、压缩与记忆生命周期｜更新：2026-08-30

## 1. 定位

Context/Memory Kernel 是 ChainlessChain Agent Platform 的逻辑基础模块，统一回答四个问题：

1. 一次模型调用应该看到哪些上下文；
2. 上下文超过预算时如何压缩并恢复；
3. 哪些会话事实可以提升为跨会话记忆；
4. 记忆如何按作用域、来源、可信度、保留和删除策略演化。

它不是新的模型/工具循环，也不是新的多 Agent 调度器。Agent Kernel 仍负责单 Agent 执行，Graph Kernel 仍负责 Task/Attempt/Effect authority，Session/Event Store 仍负责原始会话事件，Context/Memory Kernel 负责从这些权威来源生成有界上下文和受治理的记忆。

“Kernel”表示单一契约、状态机和一致性门，不要求所有代码运行在同一进程或立即合并成一个文件。

## 2. 基线问题与当前状态

迁移前至少存在以下独立实现：

| 能力 | 当前实现 | 主要边界 |
| --- | --- | --- |
| CLI 离线/自动压缩 | `packages/cli/src/harness/prompt-compressor.js` | CLI 独立策略和阈值 |
| CLI provider-backed 压缩 | `packages/cli/src/harness/provider-backed-compaction.js` | 单独处理语义摘要和 usage |
| CLI 上下文工程 | `packages/cli/src/lib/cli-context-engineering.js` | 独立注入顺序与压缩摘要 |
| Desktop 压缩 | `desktop-app-vue/src/main/llm/prompt-compressor.js` | 与 CLI 不是同一权威实现 |
| Desktop 上下文工程 | `desktop-app-vue/src/main/llm/context-engineering.js` | Desktop 自有注入器和 IPC |
| scoped memory | `packages/session-core/lib/memory-store.js` | session/agent/user/global 原语 |
| 会话记忆巩固 | `packages/session-core/lib/memory-consolidator.js` | 规则或 LLM 提炼，主路径接入未统一 |
| 永久/层次化记忆 | CLI 与 Desktop 多套模块 | schema、检索和清理语义不同 |

这些历史实现解释了迁移起点；它们不再代表 2026-08-30 的 writer authority。当前仓库状态如下：

- `packages/context-memory-kernel` 是 schema v1、纯 reducer/planner、authority registry、ports、删除对账和 writer inventory 的唯一 canonical 包。
- CLI 每次付费 provider 调用前生成 `ContextPlan`，召回记忆以 data-only assistant message 注入；JSONL compaction 与 canonical memory 使用 CAS/receipt，旧 SQLite/session-core/永久/层次 writer 在 `canonical_default` 下失败关闭。
- Desktop main process 默认 `canonical_default`，旧 memory/context mutation 入口失败关闭；VS Code 与 JetBrains 是 App Server canonical lifecycle 的有界只读 projection。
- Agent Protocol、App Server、TypeScript/Python SDK 与两个 IDE 绑定同一 schema 和 `cross-surface-projection-v1.tsv` fixture；fixture 固定 14 个恢复/作用域/provider/删除场景和 7 个消费 surface，不提供 generic memory RPC 逃逸口。
- 删除先提交最小 tombstone，再物理清除已注册 ContentPort、索引/缓存/副本和已迁移的旧 SQLite/session-core projection；部分失败持久化 reconciliation，重启后可继续，完成后封存来源引用。离线副本受 fence 阻止回灌。外部备份及未接入 Kernel 的历史离线文件不在在线 purge receipt 内，继续受部署保留政策约束。
- `writers.v1.json` 的生产状态只有一个 `canonical_runtime`，所有 legacy writer 均为 `legacy_read_only`，静态发现门不允许未分类 writer；`context-memory-writer-probe.mjs` 在运行期验证 CLI/Desktop 旧 mutation fail closed 和 IDE projection-only 边界。

仓库内 canonical authority、已登记迁移、恢复、在线隐私对账、容量门和 quick soak 已完成。生产关闭仍是独立状态：只有最终候选提交的 Linux/Windows/macOS `CLI CI`、`CLI Strict Sandbox`、`Context Memory Kernel CI` 与 Linux 30 分钟 `Context Memory Long Soak` 全绿，经 attested evidence/production-close 工作流验签后，才能写成“正式生产关闭”。

## 3. 设计目标与非目标

### 3.1 设计目标

1. 对相同输入、模型窗口配置和策略，CLI、Desktop、VS Code、JetBrains 得到等价的上下文选择与恢复状态。
2. 压缩保留任务连续性、安全边界、未完成交互和工具调用/结果完整性。
3. 记忆具有统一 scope、provenance、confidence、importance、retention、sensitivity 和 deletion 语义。
4. 大工具结果可以外置并通过内容哈希、摘要和引用恢复，不用反复占用模型窗口。
5. 压缩与记忆变更形成可重放、可评估、可回滚或可对账的 rollout/event。
6. 存储、索引、向量库和同步实现通过 adapter 接入，不改变上层语义。
7. 所有预算、队列、摘要输入、召回数量、索引任务和删除任务都有显式上限。

### 3.2 非目标

- 不替代 Agent Kernel 的模型、工具、审批、沙箱或 Process Broker。
- 不替代 Graph Kernel 的 Task/Attempt/lease/fence/Effect/HumanTask authority。
- 不把 RAG 知识库、项目源文件或 SecretStore 复制成普通记忆。
- 不承诺压缩可以撤销已经发生的外部副作用。
- 不以“一次性重写所有旧存储”为首个发布目标。
- 不允许为了跨端一致而把不可信内容提升为系统指令。

## 4. 总体架构

```text
CLI / Desktop / VS Code / JetBrains / Agent SDK
                         │
                         ▼
                   Agent Kernel
                         │ turn request
                         ▼
              Context/Memory Kernel API
       ┌─────────────────┼──────────────────┐
       ▼                 ▼                  ▼
 Context Planner   Compaction Engine   Memory Lifecycle
 budget/select     summarize/verify    candidate/recall/delete
       │                 │                  │
       └─────────────────┼──────────────────┘
                         ▼
              Canonical events + receipts
       ┌─────────────────┼──────────────────┐
       ▼                 ▼                  ▼
 Session/Event Store  Memory Store    Artifact/Blob Store
 transcript/rollout   durable facts   large tool evidence
                         │
                         ▼
              Rebuildable search indexes
```

各产品入口只负责收集宿主上下文和呈现结果，不得自行实现另一套 authoritative 压缩或记忆状态机。入口可以提供更严格的预算或隐私策略，不能扩大 Kernel 给出的 scope、trust 或 allowed sinks。

## 5. 所有权与边界

| 数据或决定 | 权威所有者 | Context/Memory Kernel 的职责 |
| --- | --- | --- |
| 原始消息、工具事件、终态 | Session/Event Store | 只读并生成有版本的上下文投影 |
| 单轮执行和工具副作用 | Agent Kernel | 在调用模型前提供上下文；不结算副作用 |
| 多 Agent Task/Attempt | Graph Kernel | 读取绑定的工作状态；不改写 Graph 终态 |
| 持久记忆记录 | Memory Store | 校验、写入、替代、过期和删除 |
| 大型正文与制品 | Artifact/Blob Store | 保存摘要、digest 和受控引用 |
| 搜索/向量索引 | Rebuildable projection | 提交索引任务；索引不能成为事实 authority |
| 密钥和凭据 | SecretStore | 拒绝进入普通上下文/记忆正文 |

Context projection 是派生状态。Kernel 崩溃后必须能从 session head、memory revision、artifact digest 和策略版本重建；不能要求客户端相信一个来源不明的 prompt 缓存。

## 6. 核心数据契约

### 6.1 ContextItem

ContextItem 是进入候选上下文池的最小单位：

```ts
interface ContextItem {
  schemaVersion: number;
  itemId: string;
  kind:
    | "system-policy"
    | "tool-schema"
    | "skill"
    | "task-state"
    | "message"
    | "tool-evidence"
    | "memory"
    | "project-rule"
    | "artifact-ref";
  scope: Scope;
  sourceRef: SourceRef;
  provenance: Provenance;
  trust: "host" | "verified" | "user" | "external" | "untrusted";
  sensitivity: "public" | "internal" | "personal" | "secret" | "restricted";
  allowedSinks: string[];
  tokenEstimate: number;
  priority: number;
  pinned: boolean;
  createdAt: string;
  expiresAt?: string;
  digest: string;
  content?: string;
  contentRef?: ContentRef;
}
```

`pinned` 只表示不得被普通压缩策略丢弃，不代表内容可信。外部网页即使 pinned，仍不能变成 host policy。

### 6.2 MemoryRecord

```ts
interface MemoryRecord {
  schemaVersion: number;
  memoryId: string;
  scope: Scope;
  scopeId?: string;
  category: string;
  content: string;
  summary?: string;
  provenance: Provenance;
  evidenceRefs: SourceRef[];
  confidence: number;
  importance: number;
  tags: string[];
  sensitivity: ContextItem["sensitivity"];
  allowedSinks: string[];
  state:
    | "candidate"
    | "active"
    | "reinforced"
    | "superseded"
    | "archived"
    | "expired"
    | "deleted"
    | "purged";
  retentionPolicy: RetentionPolicy;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  accessCount: number;
  supersedes?: string[];
  revision: number;
  digest: string;
}
```

`confidence` 表示事实可靠程度，`importance` 表示对未来任务的价值，`relevance` 是一次查询的动态得分，三者不能合并为一个 `score`。

### 6.3 Scope

目标 scope 集合为：

| Scope | 可见范围 | 默认保留倾向 |
| --- | --- | --- |
| `turn` | 当前轮 | 轮次结束即失效 |
| `session` | 当前会话 | 会话结束后可归档或提升 |
| `agent` | 指定 Agent | 不向其他 Agent 自动扩散 |
| `project` | 指定项目身份 | 绑定 project/workspace identity |
| `user` | 指定用户 | 跨项目使用需通过策略 |
| `global` | 明确授权的全局范围 | 禁止作为默认提升目标 |

从窄 scope 提升到宽 scope 是受审计的状态转换，不能由一次普通召回或摘要隐式完成。

## 7. 上下文构建与预算

Context Planner 接收模型窗口、输出预留、入口策略、session head、task state、工具集合和可见 memory scopes，输出 ContextPlan：

```text
model window
  - reserved output
  - provider safety margin
  = input budget

input budget partitions
  1. trusted system / safety policy
  2. current task / pending interaction / working state
  3. tool and skill schemas
  4. recent conversation
  5. tool evidence and artifacts
  6. recalled memory and project rules
  7. compaction/recovery reserve
```

分区使用可配置 ceiling 和最低保留，不固化一个适用于所有模型的百分比。选择顺序必须确定性；相同 priority 时使用稳定的 kind、source sequence 和 item ID 排序。

以下信息不得仅因 token 紧张而静默丢失：

- 当前用户目标和最后一条尚未结算的请求；
- pending approval、question、HumanTask 及其 binding；
- 未完成 Task/Attempt、计划进度、预算和 cancellation state；
- 工具调用与结果配对，或明确的 pending/unknown outcome；
- workspace/cwd/worktree identity 和权限 ceiling；
- 被策略明确 pinned 的事实及其来源；
- 恢复所需的 session head、revision、digest 和引用。

可信 system/security policy 应从权威配置重新构建，不能交给 LLM 摘要。MCP/工具 schema 过大时优先 deferred discovery，不应挤掉安全和任务状态。

## 8. 压缩生命周期

### 8.1 状态机

```text
IDLE
  → EVALUATING
  → PREPARING
  → SUMMARIZING?            provider-backed 时可选
  → VERIFYING
  → COMMITTING (CAS)
  → COMMITTED

任一前置失败 → ABORTED
provider/effect 结果未知 → RECONCILIATION_REQUIRED
session head 冲突 → STALE，基于新 head 重新计算
```

### 8.2 原子提交

一次 compaction 至少绑定：

```text
session_id, input_head, input_digest, policy_version,
model_profile, strategy, output_digest, artifact_refs,
usage_receipt, started_at, committed_at
```

流程为：读取固定 head → 生成候选 → 验证不变量 → 以 compare-and-swap 追加 compact rollout → 推进 session head。CAS 失败不能覆盖更新后的会话，必须重新读取并重新计算。

provider-backed 摘要若出现传输结果未知或 usage ledger 未结算，不得把本地 fallback 伪装成同一次成功；进入显式对账或重新开始新的 operation identity。

### 8.3 压缩不变量

1. system/security policy 不由不可信摘要替代。
2. tool call/result 保持完整配对；未知结果保持 unknown，不伪造失败或成功。
3. pending approval/question 的 operation、nonce、expiry、turn/item binding 不变。
4. 最后一个用户请求、当前任务和未完成工作可恢复。
5. pinned item 按 digest 原文保留，除非更高优先级安全策略拒绝其进入模型。
6. 外置正文必须有 digest、byte length、存储身份和访问策略；引用不可用时标记不可恢复。
7. 压缩可以缩短模型输入，但不能删除原始证据或改变外部副作用事实。

### 8.4 大结果外置

大型工具结果优先写入 Artifact/Blob Store，上下文仅保留：

```ts
interface ContentRef {
  store: string;
  objectId: string;
  digest: string;
  byteLength: number;
  mimeType?: string;
  summary: string;
  recoverable: boolean;
}
```

摘要不得隐藏“结果被截断”“引用已过期”或“读取需要审批”。按需恢复仍需经过原始 scope、sensitivity、allowed sinks 和权限检查。

## 9. 记忆生命周期

```text
evidence observed
      │
      ▼
  CANDIDATE ──reject──► discarded audit
      │ validate/policy
      ▼
    ACTIVE ──new evidence──► REINFORCED
      │ conflict/newer authority
      ├────────────────────► SUPERSEDED
      │ retention/cold path
      ├────────────────────► ARCHIVED
      │ expires
      └────────────────────► EXPIRED

ACTIVE / REINFORCED / SUPERSEDED / ARCHIVED / EXPIRED
      │ deletion request + authority
      ▼
    DELETED ──replica/index/cache purge──► PURGED
```

### 9.1 候选生成

候选可以来自用户显式写入、会话巩固、项目文件、工具证据或导入。模型生成的摘要只是候选，不是事实 authority。候选必须携带 evidenceRefs，且继承来源的 sensitivity 和 allowed sinks。

### 9.2 激活与强化

显式用户写入可以按策略直接激活；自动提取通常要求分类、敏感信息过滤、重复检测、scope 校验和最低 confidence。重复证据可以提高 confidence，但不能无限累加或覆盖冲突来源。

### 9.3 冲突与替代

相互冲突的记忆不使用“最后写入必胜”。Kernel 根据来源 authority、时间、scope 和用户修正生成 `supersedes` 关系；无法裁决时同时保留并在召回结果中公开冲突。

### 9.4 过期与删除

过期停止参与默认召回，但可以按审计策略保留。删除首先写入带 revision/fence 的 tombstone，阻止离线副本回灌；随后清理正文、搜索索引、embedding、缓存和同步副本。达到保留期限或用户授权后进入 `purged`。

## 10. 召回与巩固

召回管线固定为：

```text
scope admission
  → sensitivity / allowed-sink filter
  → lexical/vector candidates
  → provenance and confidence adjustment
  → conflict/supersession filter
  → diversity and token budget
  → stable top-K + attribution
```

召回结果必须显示 memory ID、scope、来源、动态 relevance 和被截断状态。搜索索引丢失时可以重建或退化为可解释的关键词搜索，不能跨 scope 扫描作为 fallback。

会话巩固生成 candidate memory，不直接写全局有效记忆。默认 scope 不得宽于输入会话/Agent；提升到 project、user 或 global 需要显式策略或用户决定。LLM summarizer 失败可退化为规则提取，但必须记录 `degraded`，且不得绕过敏感信息过滤。

## 11. 持久化、恢复与 adapter

Kernel 使用逻辑 ports 隔离物理存储：

```ts
interface SessionContextPort {
  readSnapshot(sessionId: string): Promise<SessionSnapshot>;
  appendCompaction(event: CompactionEvent, expectedHead: string): Promise<CasResult>;
}

interface MemoryPort {
  query(request: MemoryQuery): Promise<MemoryRecord[]>;
  mutate(command: MemoryCommand, expectedRevision?: number): Promise<MemoryReceipt>;
}

interface ContentPort {
  put(content: Uint8Array, policy: ContentPolicy): Promise<ContentRef>;
  get(ref: ContentRef, access: AccessContext): Promise<Uint8Array>;
  purge(ref: ContentRef, fence: string): Promise<PurgeReceipt>;
}
```

JSONL、SQLite/SQLCipher、文件、远端同步和向量数据库都是 adapter。adapter 不得改变 scope、状态机或失败语义。索引和缓存必须可从权威记录重建；恢复时不能采用“哪个 legacy store 有值就信哪个”的 fallback。

每次上下文构建绑定 `sessionHead + memoryRevision + policyVersion + modelProfile`。任何一个版本变化都会使旧 plan 失效，避免把删除后的记忆或过期授权继续送给模型。

## 12. 安全、隐私与删除

### 12.1 信任与提示注入

provenance/trust 与消息 role 分开保存。网页、MCP、工具输出和导入记忆即使包含“system”或“approve”等文字，仍是数据，不能创建控制边。派生摘要继承最低 trust，不能因 LLM 重写而提权。

### 12.2 敏感信息

- SecretStore 值、私钥、bearer token、恢复码和认证 cookie 默认禁止进入 MemoryRecord 正文。
- 日志、trace 和统计使用 digest、类别或脱敏摘要，不记录秘密正文。
- 发送给远端 provider 前再次执行 allowed-sink 和数据分类检查。
- 用户/项目级记忆进入共享 Agent 或远端执行前需要 scope admission。

### 12.3 删除语义

删除请求至少绑定 subject、scope、selector、authority、request ID 和 fence。Kernel 返回每个存储、索引、缓存与同步副本的 receipt；任何必要副本失败时结果为 `partial` 或 `reconciliation_required`，不能返回全局成功。

会话压缩、归档、索引删除和记忆删除是四种不同操作。API 和 UI 禁止用同一个模糊的“清理”按钮隐藏这些差异。

## 13. 事件与可观测性

目标事件族包括：

```text
context.plan.created
context.plan.rejected
context.compaction.started
context.compaction.committed
context.compaction.aborted
context.compaction.reconciliation_required
memory.candidate.created
memory.activated
memory.reinforced
memory.superseded
memory.expired
memory.deleted
memory.purged
memory.recalled
```

具体 discriminator 必须进入 canonical Agent Protocol Schema 后才成为公开 wire contract；本节名称在此之前只是设计命名空间。

默认指标不包含正文：

- 各预算分区的 item/token 数和 drop reason；
- 压缩输入/输出 token、比例、策略、耗时和 degraded 状态；
- 召回候选数、过滤原因、top-K、延迟和 cache hit；
- 各 scope/state 的记忆数量、过期积压和删除对账；
- blob 引用命中、不可恢复引用和 digest mismatch；
- CLI/Desktop/IDE parity divergence。

## 14. 跨端等价性

给定相同的 canonical fixture、模型窗口、策略版本和已录制 provider 摘要，所有入口必须得到：

1. 相同的 ContextItem identity 集合和稳定顺序；
2. 相同的保留/丢弃 reason；
3. 相同的 tool pair、pending state 和 task state；
4. 相同的 output digest 与恢复结果；
5. 相同的 memory scope/state 变更和删除 receipt 语义。

UI 展示、平台路径格式和 tokenizer 的诊断估算可以不同，但不能改变权威 item identity。需要 provider-backed shadow 时复用录制响应，不允许 legacy 和 Kernel 两条路径各调用一次真实 provider 或工具。

## 15. API 表面

最小上层 API：

```ts
planContext(request): Promise<ContextPlan>
compactContext(request): Promise<CompactionReceipt>
recallMemory(request): Promise<MemoryRecallResult>
proposeMemory(request): Promise<MemoryCandidateReceipt>
decideMemory(command): Promise<MemoryReceipt>
deleteMemory(request): Promise<DeletionReceipt>
reconcile(operationId): Promise<ReconciliationReport>
```

产品入口不能直接写 MemoryStore row 或追加 compact event。所有 mutation 经过上述 command、revision/CAS、policy 和 receipt；只读查询可由受版本约束的 projection 提供。

## 16. 迁移与 authoritative cutover

### Phase 0：清单与契约

- 生成所有 context builder、compressor、memory writer、store、索引、配置、IPC/command 和恢复入口的 machine-readable inventory。
- 冻结 ContextItem、MemoryRecord、CompactionEvent、DeletionReceipt schema v1。
- 为现有 CLI、Desktop、IDE fixture 建立基线。

### Phase 1：共享纯内核与 shadow

- 提取无 I/O 的选择、预算、压缩验证和生命周期 reducer。
- legacy 路径继续 production，Kernel 使用冻结输入和录制 provider 结果做无副作用 shadow。
- divergence 必须有 reason code，不能只比较摘要字符串。

### Phase 2：CLI canonical

- 先迁移 `cc context`、`cc compact`、headless auto-compaction 和 scoped memory。
- JSONL/session-core adapter 进入 CAS/receipt 路径。
- 旧 compressor writer 变为 compatibility adapter，再转 read-only。

### Phase 3：Desktop canonical

- Desktop IPC 改为调用共享 Kernel adapter。
- 永久记忆、层次化记忆和 context-engineering 先双读比对，再迁移 writer。
- renderer 不直接写记忆数据库或自行决定压缩。

### Phase 4：IDE、SDK 与跨设备

- App Server/Agent Protocol 暴露稳定 Context/Memory 事件与固定能力方法。
- VS Code、JetBrains 只消费 canonical projection。
- 同步 adapter 补齐 tombstone、replica receipt 和冲突测试。

### Phase 5：legacy fenced/retired

- 所有旧 mutation API fail closed，只保留有期限的 importer/read-only projection。
- 静态调用图、运行期写探针和三平台测试证明 legacy writer 为零后再删除代码。

仓库门由 `writers.v1.json`、`context-memory-writer-probe.mjs` 和三平台 `Context Memory Kernel CI` 共同实现：静态清单/调用关系出现未知 writer、canonical runtime 数量不为 1、任一实际旧写入口没有返回 fence，或 IDE 变成本地 writer 时均失败关闭。代码物理删除仍需保留期结束后的独立变更，不与 authority 切换混为一谈。

任何阶段出现双 writer、scope 扩大、删除回灌、工具结果错配、pending state 丢失或 shadow 双重副作用，均为 NO-GO。

## 17. 失败语义

| 场景 | 必须返回 | 禁止行为 |
| --- | --- | --- |
| token 估算/构建超限 | `context_over_budget` + 分区明细 | 静默截掉安全/任务状态 |
| provider 摘要失败且可安全退化 | `degraded` + fallback 策略 | 冒充语义摘要成功 |
| provider 结果未知 | `reconciliation_required` | 当成零费用并重试 |
| session head CAS 冲突 | `stale` + 当前 head | 覆盖新事件 |
| artifact 引用缺失/digest 错误 | `content_unavailable` / `digest_mismatch` | 使用错误正文继续恢复 |
| memory scope 不匹配 | `scope_denied` | 跨 scope fallback |
| 部分副本删除失败 | `partial` + pending receipts | 返回“已彻底删除” |
| 索引损坏 | rebuild/lexical degraded | 把索引行当权威记忆 |

## 18. 性能与容量

实现前冻结基准方法，不先承诺脱离环境的统一毫秒值。至少测量：

- 1k/10k ContextItem 的 plan P50/P95 和峰值 RSS；
- 100/1k 消息及 1/10/100 MiB 工具结果的压缩；
- 1k/10k/100k MemoryRecord 的 scope filter、lexical/vector recall；
- concurrent compaction CAS 冲突和重算成本；
- 删除 1/100/10k 条记录在主存储、索引、缓存和副本上的收敛时间；
- CLI/Desktop/IDE 长会话 30 分钟与多轮压缩 soak。

所有队列和单项正文必须有配置上限；超过上限先 admission，再启动 provider、embedding、blob 或同步副作用。性能优化不能跳过 provenance、scope 或 digest 校验。

当前机器门由 `packages/context-memory-kernel/scripts/context-memory-benchmark.mjs` 生成 `chainlesschain.context-memory-capacity-benchmark/v1` receipt。`quick` profile 用于 Windows/macOS 和日常回归；Linux exact-SHA 矩阵运行 `release` profile，完整覆盖上述 1k/10k、100/1k、1/10/100 MiB、1k/10k/100k、CAS 重算和 1/100/10k 删除规格。大工具正文先进入 `ContentPort`，压缩只处理带 digest/byteLength 的 `ContentRef`。

2026-08-30 的本地 Windows release 诊断运行约 29.6 秒：10k plan P50/P95 为约 535/672 ms，100k lexical/vector recall 为约 5.90 s/44.5 ms，10k 条记录跨 authority/index/cache/replica 收敛约 8.04 s，峰值 RSS 约 447 MiB。数值只描述该环境，不是跨机器统一 SLO；正式证据以候选 SHA 的 receipt 为准。

## 19. 测试与发布门

### 19.1 单元与性质测试

- 预算分区、稳定排序和确定性 digest；
- 任意压缩策略都保持 pinned item、tool pair 和 pending state；
- scope 不扩大、派生敏感级别不降低；
- memory 状态机只允许合法转换；
- CAS、幂等 command、重复 event 和 tombstone fencing；
- 任意正文不会通过统计/日志泄露。

### 19.2 Conformance

单一 fixture 覆盖 CLI JS、Desktop JS、App Server、TypeScript/Python SDK、VS Code、JetBrains，并固定：

- 中英文长会话和多模型窗口；
- 并行工具调用、孤儿/迟到结果、pending approval/question；
- project/user/agent/session scope 交叠；
- provider-backed 正常、失败、usage unknown 和取消；
- crash/restart、CAS race、索引重建、离线副本回灌和部分删除。

`cross-surface-projection-v1.tsv` 同时包含 4 条 lifecycle projection event、最终投影和 14 个可执行场景。canonical parser 对列集合、JSON 大小、场景 ID 和 7 surface 集合做 fail-closed 校验；Kernel 执行全部场景，各语言/宿主消费者只回放 event 行并独立验证相同场景清单，避免把 fixture 元数据误当 wire event。

### 19.3 发布门

本地测试只作补充。正式切换要求精确 release commit 的 Linux、Windows、macOS CLI CI 与 Strict Sandbox，以及 Desktop/IDE 对应矩阵全部通过；schema/codegen、migration dry-run、shadow divergence、恢复、隐私删除和长期 soak 必须绑定同一候选身份。

当前机器门实现：

- `.github/workflows/context-memory-kernel.yml`：三平台 Kernel、CLI、Desktop、VS Code、JetBrains、协议和 SDK 矩阵，运行实际 writer probe 与四宿主 quick multi-compaction soak；Linux 生成完整容量 receipt，Windows/macOS 生成 bounded quick capacity receipt；
- `.github/workflows/context-memory-long-soak.yml`：只接受完整且等于事件提交的 SHA，运行至少 30 分钟的 release soak 并签注 receipt；
- `.github/workflows/context-memory-release-evidence.yml`：读取四个成功 workflow run，拒绝不同 SHA/错误 workflow/失败 run，组装并签注 26 槽 evidence manifest；
- `.github/workflows/context-memory-production-close.yml`：验签 manifest，运行 `validate-release-evidence.mjs`，拒绝缺平台、缺检查、重复检查和混合 SHA，再签注最终关闭 receipt。

截至 2026-08-30，本地 Windows Kernel 45/45、Desktop 56/56、Agent Protocol 19/19、VS Code 4/4、TypeScript SDK 11/11 已通过；quick writer/benchmark/soak receipt 和完整 release benchmark 也已通过。Python 本机只有 3.8、JetBrains 本机缺 JDK 21，未把加载前工具链失败写成产品通过或失败；上述最终候选的外部 GitHub Actions 证据尚未产生，因此本节不把生产发布状态提前写成完成。

## 20. 关键文件

| 文件 | 当前作用 |
| --- | --- |
| `packages/cli/src/harness/prompt-compressor.js` | CLI PromptCompressor 和保护不变量 |
| `packages/cli/src/harness/provider-backed-compaction.js` | provider-backed 语义压缩 |
| `packages/cli/src/harness/jsonl-session-store.js` | JSONL 会话与 compact event |
| `packages/cli/src/lib/cli-context-engineering.js` | CLI 上下文注入/压缩摘要 |
| `packages/context-memory-kernel/schema/context-memory-kernel.schema.json` | canonical schema v1 |
| `packages/context-memory-kernel/lib/runtime.js` | 唯一 Context/Memory mutation runtime |
| `packages/context-memory-kernel/inventory/writers.v1.json` | 全产品 writer/cutover 状态清单 |
| `packages/context-memory-kernel/fixtures/cross-surface-projection-v1.tsv` | 7 surface、14 场景 conformance fixture |
| `packages/context-memory-kernel/scripts/context-memory-writer-probe.mjs` | 静态 writer graph 与运行期 fail-closed receipt |
| `packages/context-memory-kernel/scripts/context-memory-benchmark.mjs` | §18 quick/release 容量矩阵 receipt |
| `packages/context-memory-kernel/scripts/context-memory-soak.mjs` | CLI/Desktop/VS Code/JetBrains 多轮压缩与重启 soak |
| `packages/cli/src/lib/context-memory-kernel/` | CLI durable/session/provider/privacy adapters |
| `packages/cli/src/lib/app-server/context-memory-notifications.js` | 固定 lifecycle notification 映射 |
| `packages/session-core/lib/memory-store.js` | scoped MemoryStore |
| `packages/session-core/lib/memory-consolidator.js` | 会话记忆巩固 |
| `desktop-app-vue/src/main/llm/context-engineering.js` | Desktop 上下文构建 |
| `desktop-app-vue/src/main/llm/prompt-compressor.js` | Desktop PromptCompressor |

共享 Kernel 的最终包路径已经冻结为 `packages/context-memory-kernel`；上层只能通过公开 API、固定 App Server 方法或只读 projection 接入。

## 21. 已决策项与开放问题

### 已决策

- Context 与 Memory 使用一套治理契约，但会话事件和持久记忆仍是不同 authority。
- 压缩是 append/rollout，不是删除。
- 自动巩固先生成 candidate，不能默认提升到 global。
- 搜索索引和 embedding 是可重建 projection。
- 所有跨端实现最终只保留一个 authoritative mutation path。
- schema v1 中 `project` 是仓库/工作区共享 scope，入口不能另造第二个 workspace identity。
- 自动提炼默认只生成 candidate；显式用户命令和可审计 importer 才能按策略激活。
- Context/Memory lifecycle 作为 Agent Protocol v1 additive 能力发布。

### 开放问题

- 物理 purge 的法务保留例外、备份窗口和跨设备完成 SLO；
- 企业多租户部署中 user/global identity 与法务保留 policy 的外部 authority 接口。

这些剩余项是部署 policy/外部存储适配问题，不能改变已冻结的 schema、扩大 scope，或让备份/离线副本绕过 tombstone fence；新增 policy 需要 ADR 和 schema 的兼容性审查。

## 22. 相关文档

- [106 Agent Kernel 设计](./106_Agent_Kernel设计.md)
- [105 Graph Kernel 设计](./105_Graph_Kernel设计.md)
- [107 单一协议 Schema 与自动代码生成](./107_单一协议Schema与自动代码生成.md)
- [91 Managed Agents 对标计划](./91_Managed_Agents对标计划.md)
- [99 项目记忆与 init 对标方案](./99_项目记忆与init对标方案.md)
- [CLI Runtime 当前实现](../cli-runtime-current.md)
- [开源差距分析 6.4](../../CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md#64-统一上下文压缩与记忆生命周期)
