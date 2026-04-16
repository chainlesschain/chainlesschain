# Managed Agents 对标计划

> 版本: v2.2 · 日期: 2026-04-16 · 状态: Phase A–I 全部落地（413 session-core tests + ~220 CLI tests + 23 Desktop IPC tests）· Phase J 候选评估中
>
> 对标对象: Anthropic **Claude Managed Agents** (2026-04-01 beta)
>
> 目标: 吸收 Managed Agents 的托管式 Agent 运行时设计，提升 Cowork Runtime 的会话管理、可观测性、资源计量、多 Agent 协作能力，同时保持本地优先 / 离线可用 / 硬件加密的差异化优势。

---

## 一、背景

### 1.1 Managed Agents 核心特征

- **托管 runtime**: Anthropic 管进程、沙箱、会话、扩展
- **Session 一等公民**: `agents.create` → `sessions.create` → `messages.create`
- **内置工具 primitive**: Web Search / Code Exec / File / Bash / MCP
- **多 Agent 语义分离**: Teams（平级）vs Subagents（层级）
- **Memory**: 跨会话长期记忆（研究预览）
- **计费**: token + session-hour（$0.08/h，空闲免费）
- **渐进发布**: `anthropic-beta: managed-agents-2026-04-01` header

### 1.2 现状差距（Cowork Runtime）

| 领域 | 现状 | 差距 |
|---|---|---|
| Session | 概念散在 agent-repl / sub-runtime / hmemory | 无统一 SessionHandle |
| 资源计量 | token-tracker 有，但无 session-hour | 无空闲 park / 无 per-session 预算 |
| 可观测性 | audit-log / hook-stats / token-tracker 各自为政 | 无统一 trace 模型 |
| 多 Agent | cowork debate/compare/analyze 语义混杂 | 无 team vs subagent 区分 |
| Memory | hmemory 独立，但无自动 consolidate | SessionEnd 未触发沉淀 |
| Approval | Permission Gate 在单次调用粒度 | 无 per-session approvalPolicy |
| Stream | 部分路径非流式 | 体验不一致 |

---

## 二、目标

### 2.1 设计原则

1. **吸收而非复制**: 保留本地优先 / 离线 / 硬件加密差异
2. **零破坏增量**: 新增抽象不动现有 API，逐步迁移
3. **语义对齐**: 术语向 Managed Agents 靠拢（agent / session / team / subagent）
4. **可度量**: 每个里程碑都有测试覆盖与指标

### 2.2 非目标

- ❌ 重写 Cowork Runtime
- ❌ 取消本地 Ollama 推理
- ❌ 强制所有会话走云端

---

## 三、当前落地状态

### 3.1 共享包: `@chainlesschain/session-core`

为让 Desktop 和 CLI **共用一套 session runtime**，Managed Agents 对标相关底层实现已抽取到 monorepo workspace 包:

- **路径**: `packages/session-core/`
- **入口**: `lib/index.js`
- **子模块导出**: `./session-handle`、`./trace-store`、`./agent-definition`、`./session-manager`、`./idle-parker`、`./agent-group`、`./shared-task-list`、`./memory-store`、`./memory-consolidator`、`./approval-gate`、`./beta-flags`、`./stream-router`、`./file-adapters`
- **Desktop shim**: `desktop-app-vue/src/main/ai-engine/session/index.js` → re-export
- **CLI shim**: `packages/cli/src/session/index.js` → re-export
- **依赖**: `desktop-app-vue` 和 `packages/cli` 均已添加 `"@chainlesschain/session-core": "0.1.0"`

`file-adapters.js` 已补齐 CLI/后续 Desktop 所需的 JSON 持久化桥接：

- `createMemoryFileAdapter()`
- `createBetaFlagsFileAdapter()`
- `createApprovalGateFileAdapter()` — per-session approval policy 持久化 (v1.9 新增)
- `hydrateMemoryStore()`

当前状态是：**底层能力已全部沉到 session-core；CLI 已开始接入其单例与文件持久化；Desktop 仍主要停留在 shim 兼容层。**

---

### ✅ Phase A — 基础抽象（已完成 · 79 tests）

**落地产物**:
- `packages/session-core/lib/session-handle.js` — SessionHandle 状态机 + runtimeMs/idleMs 计量
- `packages/session-core/lib/trace-store.js` — 统一 TraceEvent 收集 + 汇总 + sink
- `packages/session-core/lib/agent-definition.js` — 不可变 AgentDefinition + hash 缓存
- `packages/session-core/__tests__/session-handle.test.js` (25)
- `packages/session-core/__tests__/trace-store.test.js` (24)
- `packages/session-core/__tests__/agent-definition.test.js` (30)

**已具备能力**:
- Session 生命周期状态统一为 `running | idle | parked | closed`
- Trace 模型统一承载 message / tool_call / tool_result / hook / error / cost
- AgentDefinition 可缓存解析结果，避免重复 parse skill/runtime 定义

---

### ✅ Phase B — 资源计量（已完成 · +39 tests，累计 118）

**落地产物**:
- `packages/session-core/lib/session-manager.js` — SessionHandle 生命周期管理器，含 store 持久化 hook、usage/usageByAgent/usageTotal 汇总
- `packages/session-core/lib/idle-parker.js` — 定时扫描 idle session 自动 park，可注入 setInterval/clearInterval 便于测试
- `packages/session-core/__tests__/session-manager.test.js` (25)
- `packages/session-core/__tests__/idle-parker.test.js` (14)

**已具备能力**:
- Session-hour 计量（按 session / agent / global）
- Idle park + resume（含 store persistence hook）
- 事件广播: `created / idle / parked / resumed / closed / store-error`

---

### ✅ Phase C — Team/Subagent 语义 + 共享任务列表（已完成 · +52 tests，累计 170）

**落地产物**:
- `packages/session-core/lib/agent-group.js` — AgentGroup 容器，`peer` / `child` 关系，内置消息可见性规则
- `packages/session-core/lib/shared-task-list.js` — 乐观锁 task list，事件广播，snapshot/restore
- `packages/session-core/__tests__/agent-group.test.js` (26)
- `packages/session-core/__tests__/shared-task-list.test.js` (26)

**已具备能力**:
- Team（peer）成员互相可见；Subagent（child）只与 parent 互通
- 共享 TODO: add / update / claim / complete / remove，支持 rev-based 并发控制
- 事件: `added / updated / completed / removed`，可驱动 UI 和审计

**未完成（上层集成）**:
- `cowork debate/compare/analyze` 现有 CLI 路径尚未迁移到 `AgentGroup + SharedTaskList`

---

### ✅ Phase D — Memory 闭环（已完成 · +53 tests，累计 223）

**落地产物**:
- `packages/session-core/lib/memory-store.js` — MemoryStore，scope=session/agent/global，支持 tags、默认 scorer、自定义 scorer、adapter hook
- `packages/session-core/lib/memory-consolidator.js` — 从 SessionHandle + TraceStore 提炼长期记忆；rule-based 默认抽取器识别偏好 / 错误 / 已完成工具；可注入 LLM summarizer，失败自动回退
- `packages/session-core/__tests__/memory-store.test.js` (38)
- `packages/session-core/__tests__/memory-consolidator.test.js` (15)

**已具备能力**:
- `recall({ query, scope, scopeId, category, tags, limit })` 跨作用域召回
- SessionEnd 后 `consolidator.consolidate(session, { scope, useLLM })` 可写入 agent/session/global 记忆
- 事件: `added / updated / removed / consolidated / summarizer-error / memory-write-error`

**集成状态**:
- ✅ CLI `chainlesschain memory recall` / `memory store` 已接入 `MemoryStore`
- ✅ CLI 单例已通过 `memory-store.json` 复用 `MemoryStore + file adapter`
- ✅ CLI `chainlesschain memory consolidate --session <id>` 已接入（JSONL→TraceStore 投影 + MemoryConsolidator，6 tests）
- ✅ Desktop SessionEnd hook 自动调用 consolidator（Phase J: `closeSession` → `_autoConsolidate` fire-and-forget）
- ✅ 新 session 启动时把 top-K 相关记忆注入 system prompt（`src/lib/memory-injection.js` + agent-repl 集成 + `--agent-id/--recall-limit/--no-recall-memory`，7 tests）

---

### ✅ Phase E — 审批与渐进发布（已完成 · +37 tests，累计 260）

**落地产物**:
- `packages/session-core/lib/approval-gate.js` — ApprovalGate + POLICY(strict/trusted/autopilot) + RISK(low/medium/high) + DECISION(allow/deny/confirm)
- `packages/session-core/lib/beta-flags.js` — BetaFlags + FeatureNotEnabledError；flag 格式 `<feature>-<YYYY-MM-DD>`；enable/disable/register/requireFeature/list；可选 store 持久化
- `packages/session-core/__tests__/approval-gate.test.js` (21)
- `packages/session-core/__tests__/beta-flags.test.js` (16)

**已具备能力**:
- 决策矩阵: LOW 全放行；AUTOPILOT 放行全部；TRUSTED 仅 HIGH 需确认；STRICT 的 MEDIUM/HIGH 需确认
- confirm 异常/缺失时 safe-by-default 拒绝（`via=no-confirmer` / `confirm-error`）
- `requireFeature(flag)` 抛 `{ code: "feature_not_enabled", flag }` 结构化错误

**集成状态**:
- ✅ CLI `chainlesschain session policy <id> --set trusted`
- ✅ CLI `chainlesschain config beta list|enable|disable`
- ✅ `~/.chainlesschain/beta-flags.json` 已通过 file adapter 持久化
- ✅ ApprovalGate 已支持 `store` 注入 + `load()`；per-session policy 通过 `~/.chainlesschain/approval-policies.json` 跨 CLI 进程持久化 (v1.9)
- ✅ Desktop `_executeHostedTool` + `_buildHostManagedToolPolicy` 已走 ApprovalGate（Phase J），Permission Gate 与 ApprovalGate 合流共存

---

### ✅ Phase F — Stream First（已完成 · +19 tests，累计 279）

**落地产物**:
- `packages/session-core/lib/stream-router.js` — 统一 StreamEvent 协议（`start / token / tool_call / tool_result / message / error / end`）；`normalize(source)` 兼容 AsyncIterable / string / Error / Promise / `{ message | error | content }`
- `packages/session-core/__tests__/stream-router.test.js` (19)

**已具备能力**:
- 非 stream provider 的一次性响应可“假流式化”为 `start → message → end`
- async iterable 字符串 / 对象 chunk 自动包装为 token/message 事件
- callback 异常吞掉不中断流；iterator 抛错转为 error 事件后继续 end
- EventEmitter 的 `error` 事件改名 `stream-error`，避免 Node.js 未监听崩溃
- `collect()` 聚合 token 得最终文本，message 存在时覆盖 token 拼接

**未完成（上层集成）**:
- `cowork analyze / compare` 现有非 stream 路径改走 `StreamRouter`
- CLI 默认流式输出，`--no-stream` 关闭
- Desktop IPC `agent:stream` 事件标准化为 `StreamEvent`

---

### ✅ 补充: File Adapters（已完成 · +8 tests，累计 293）

**落地产物**:
- `packages/session-core/lib/file-adapters.js`
- `packages/session-core/__tests__/file-adapters.test.js` (8)
- CLI 侧配套: `packages/cli/src/lib/session-core-singletons.js` + 5 unit + 8 integration + 6 e2e tests

**已具备能力**:
- `MemoryStore` 可用 JSON 文件读写持久化（`memory-store.json`）
- `BetaFlags` 可用 JSON 文件读写持久化（`beta-flags.json`）
- `ApprovalGate` 可用 JSON 文件读写持久化（`approval-policies.json`，v1.9 新增）
- 缺失/损坏文件时容错 load，目录不存在时自动创建

**价值**:
- 这是 CLI 已接入 D2/E2 的关键桥层
- 也是 Desktop 后续做本地持久化时应复用的同一实现

---

### ✅ Phase G — CLI 收口（已完成）

**目标**: 把已落到 `session-core` 的抽象真正拉通到 CLI 主运行路径，让 Managed Agents 对标从“底层库具备”变成“CLI 默认工作方式”。

**交付范围**:
- ~~`packages/cli/src/commands/cowork.js` 接入 `AgentGroup + SharedTaskList`，显式区分 team(peer) 与 subagent(child)~~ ✅ 已完成（`src/lib/cowork/agent-group-runner.js` 统一封装，debate/compare/analyze 三条路径全部改用 peer group + SharedTaskList，5 tests）
- ~~`packages/cli/src/runtime/agent-core.js` / REPL 输出链路接入 `StreamRouter`，默认流式，`--no-stream` 退回 collect~~ ✅ 已完成（`src/lib/agent-stream.js` + agent-repl 集成 + `--no-stream`，6 tests）
- ~~`packages/cli/src/runtime/coding-agent-shell-policy.cjs` 与 REPL / WS confirm 流程接入 `ApprovalGate`~~ ✅ 已完成（`src/lib/shell-approval.js` + agent-core `run_shell` 分支 + REPL readline confirm 回调 + `ApprovalGate.setConfirmer`，8+5+3 tests）
- ~~`packages/cli/src/commands/memory.js` 新增 `memory consolidate --session <id>` 并接入 `MemoryConsolidator`~~ ✅ 已完成（`src/lib/session-consolidator.js` 做 JSONL→TRACE_TYPES 投影）
- ~~新 session 启动时从 `MemoryStore.recall()` 注入 top-K 到 system prompt~~ ✅ 已完成
- ~~`session policy` 改为文件持久化，补齐 `approval-policies.json`~~ ✅ v1.9 已完成

**验收标准**:
- `cowork debate/compare/analyze` 三条路径不再手写 team/subagent 语义
- CLI 首 token < 500ms，非流式 provider 仍统一走 `StreamRouter`
- `session policy` 跨 CLI 进程可恢复
- `memory consolidate` 能从 session trace 写出 agent/global memory

---

### ✅ Phase H — Desktop 收口 + CLI 对称（已完成 · Desktop 17 tests + CLI 52 tests）

**目标**: 让 `desktop-app-vue` 不只 re-export `session-core`，而是把会话、审批、记忆、流式事件真正纳入桌面主进程与 IPC；同时在 CLI 端提供对称的命令行入口，使 Desktop IPC 和 CLI 命令共享同一文件持久化格式。

**Desktop 交付（22 tests）**:
- `desktop-app-vue/src/main/session/session-core-singletons.js` — `getMemoryStore / getBetaFlags / getApprovalGate / getSessionManager`，`_deps.getUserDataDir` 可注入
- `desktop-app-vue/src/main/session/session-core-ipc.js` — 20 通道（3 policy / 6 lifecycle / 1 subscribe / 4 memory / 2 stream / 3 beta / 1 recall-on-start）
- `desktop-app-vue/src/preload/index.js` — `electronAPI.sessionCore.{policy,session,memory,agent,beta}` 类型化命名空间
- `desktop-app-vue/src/renderer/stores/sessionCore.ts` + `pages/SessionCorePage.vue` — 4 tab UI 面板
- `coding-agent-permission-gate.js` `evaluateToolCallWithApprovalGate()` — Plan Mode × ApprovalGate 合流避免双审批
- `coding-agent-session-service.js` — 懒加载 ApprovalGate 注入

**CLI 对称交付（52 tests）**:
- `packages/cli/src/lib/session-core-singletons.js` — `getSessionManager()` + 文件持久化 parked-sessions.json + `createStreamRouter()`
- `packages/cli/src/commands/session.js` — `lifecycle / park / unpark / end [--consolidate]` 子命令
- `packages/cli/src/commands/stream.js` — `cc stream "<prompt>" [--text]` NDJSON StreamRouter 入口（Ollama + OpenAI SSE）
- `packages/cli/src/repl/agent-repl.js` — `cc agent` 启动注册 SessionHandle，`--session <id>` 自动 unpark，`rl.close()` 自动 park（`--no-park-on-exit` 关闭）
- `packages/cli/src/commands/agent.js` + `runtime/policies/agent-policy.js` — `parkOnExit` 策略（默认 true）

**IPC ↔ CLI 对照表**:

| Desktop IPC | CLI 命令 | 持久化 |
|---|---|---|
| `session:list` | `cc session lifecycle` | `parked-sessions.json` |
| `session:park` | `cc session park` / agent 退出自动 | 同上 |
| `session:resume` | `cc session unpark` / `--session` 自动 | 同上 |
| `session:close {consolidate}` | `cc session end --consolidate` | — |
| `session:policy:*` | `cc session policy` | `approval-policies.json` |
| `memory:store/recall/delete/consolidate` | `cc memory store/recall/consolidate` | `memory-store.json` |
| `beta:list/enable/disable` | `cc config beta *` | `beta-flags.json` |
| `agent:stream:start/cancel` | `cc stream "<prompt>"` NDJSON | — |

**验收达成**:
- Desktop 与 CLI 使用同一套 session-core 语义和持久化格式 ✅
- IPC 层统一为 `StreamEvent`，与 CLI `cc stream` 输出同构 ✅
- 会话 park/resume、审批策略、beta flags 在 Desktop/CLI 重启后可恢复 ✅
- Plan Mode × ApprovalGate 合并消除双审批 ✅

**验收指标**:
- Desktop: 17 tests green（session-core-ipc 14 + permission-gate 3 新增）
- CLI: 52 tests green（singletons 10 + stream 3 + hooks 26 + integration 13）

---

## 四、里程碑与验收

| Phase | 状态 | 关键交付 | 测试 | 指标 |
|---|---|---|---|---|
| A | ✅ 已完成 | SessionHandle / TraceEvent / AgentDefinition | 79 tests | 冷启动 <100ms（结构层） |
| B | ✅ 已完成 | session-hour / idle park | 39 tests | session / agent / global usage 可汇总 |
| C | ✅ 已完成 | team/subagent / shared task | 52 tests | peer/child 语义分离 |
| D | ✅ 底层完成 / ⏳ 集成中 | memory store / consolidator | 53 tests | consolidate 闭环可用，CLI/Desktop 待全接入 |
| E | ✅ 底层完成 / ⏳ 集成中 | approvalPolicy / beta flags + 跨进程持久化 | 46 tests (+9 v1.9) | CLI `session policy` 已跨进程持久化；Desktop 未切换 |
| F | ✅ 底层完成 / ⏳ 集成中 | stream first | 19 tests | StreamEvent 协议已定型 |
| G | ✅ 基本完成 | CLI 收口到 AgentGroup / StreamRouter / ApprovalGate / Consolidator | +40 done (cowork peer group + memory inject + stream + approval REPL 接线 + setConfirmer) | CLI 默认行为与 session-core 对齐 |
| H | ✅ 已完成 | Desktop session service + 18 IPC + CLI 对称 lifecycle/stream/park-on-exit | Desktop 17 + CLI 52 = 69 tests | Desktop/CLI 语义与持久化一致，单点审批合流 |
| I | ✅ 全部完成 | `cc session tail/usage` + Hosted Session API（17+2 WS 路由）+ 三端 token 记账 + Desktop Usage tab | CLI 25 ws-protocol + 9 usage + 7 tail + 10 chat-usage + 95 agent-core; Desktop 23 IPC | 远程驱动 session-core，token 记账可观测，Desktop/CLI 全对称 |
| J | ✅ 已完成 | Desktop 上层集成收尾：hosted-tool ApprovalGate + auto-consolidate + policy sync | +8 tests (session-service 36 total) | 零死路径：所有 Desktop tool 执行路径统一走 ApprovalGate |

**当前已落地**:
- `session-core` 20 个测试文件，共 **413 tests**
- CLI Managed Agents 相关: 25 ws-session-core + 10 singletons + 9 usage + 7 tail + 6 consolidator + 10 chat-core-usage + 1 chat-repl-usage + 40 agent-repl + 95 agent-core + 13 integration + 7 e2e = **~220 tests**
- CLI 全部命令跨进程持久化：`session lifecycle/park/unpark/end/policy/tail/usage`、`memory recall/store/consolidate`、`config beta list|enable|disable`、`stream`
- Desktop 收口完成：`session-core-singletons` + 21 IPC channels + `sessionCore.ts` + `SessionCorePage.vue` (Usage tab) + Plan Mode × ApprovalGate 合并
- Desktop/CLI 共用 `parked-sessions.json / memory-store.json / beta-flags.json / approval-policies.json` 四个 JSON 文件格式
- LLM 三端 (Ollama/OpenAI/Anthropic) 自动 token 记账 → `cc session usage` + WS `usage.*` 路由可观测
- Hosted Session API: 17 req/resp + 2 streaming = 19 WS 路由; Desktop IPC: 21 channels

### ✅ Phase I — 首批交付（2026-04-16）

- **`cc session tail <id>`** — NDJSON 跟随 JSONL 事件流，支持 `--from-start` / `--from-offset` / `--type` / `--since` / `--once` / `--poll` / AbortSignal（SIGINT/SIGTERM）
- **`cc session usage [id]`** — 从 `token_usage` / 嵌入 `assistant_message.usage` 聚合，per-session + global rollup，按 provider/model 分组，支持 `--json`
- **Hosted Session API** — `cc serve` 的 WS 派发器新增 14 个 dot-case 路由：`sessions.list/park/unpark/end`、`sessions.policy.get/set`、`memory.store/recall/consolidate`、`beta.list/enable/disable`、`usage.session/global`，统一返回 `<type>.response` 信封 `{ ok, ... }`
- **新增 helper** — `appendTokenUsage(sessionId, usage)` 供 LLM 层在回调中写入标准化 token 记账事件
- **测试**：9 (session-usage) + 7 (session-tail) + 14 (Hosted Session API handlers + dispatcher wire-up) = **30 tests**，ws-server 回归 47/47 绿
- **持久化**：复用现有 `~/.chainlesschain/sessions/<id>.jsonl`（JSONL 事件流）+ Phase A–H 四个 JSON 文件，Phase I 零新增持久化格式

**后续（Phase I 剩余 + Phase J 候选）**:
- ~~SessionManager 事件广播到多 Desktop 窗口（需 IPC `session:event` 订阅通道）~~ ✅ `session:subscribe` IPC channel + `session:event` push + preload `onEvent()` + auto-cleanup on webContents destroy（+2 tests, Desktop IPC 22 total）
- ~~Hosted Session API 流式路由：`stream.run` 在 WS 上把 StreamEvent 桥到客户端~~ ✅ `stream.run` 4th `context` arg → `envelopeBus.publish` fan-out（+2 tests, 21 total）
- ✅ `stream.run` → Phase 5 envelopeBus bridge：streaming handler 现在接受 `context = {server, ws, clientId}`，当 `context.server.envelopeBus` 存在且 `message.sessionId` 有值时，每个 StreamEvent 通过 `envelopeFromStreamEvent` 转换后发布到 bus，HTTP SSE 订阅者同步收到
- ~~LLM 层自动 `appendTokenUsage`（OpenAI/Ollama/Anthropic 三端接线）~~ ✅ `chatWithTools` 三端返回 `usage`，`agentLoop` yield `token-usage` 事件，`agent-repl` 写入 JSONL（+4 tests agent-core, 95 total）
- ~~Desktop Web Panel 暴露 usage 仪表盘~~ ✅ `session:usage` IPC + SessionCorePage Usage tab（Global summary + byAgent table）+ Pinia store `refreshUsage()`（+1 test, Desktop IPC 23 total）

---

### ✅ Phase J — Desktop 上层集成收尾（2026-04-16）

**目标**: 消除 Desktop 侧 session-core 死路径 —— `_executeHostedTool` 绕过 ApprovalGate、`closeSession` 不触发 memory consolidation、`_buildHostManagedToolPolicy` policy sync 不反映 ApprovalGate 策略。

**交付**:

1. **`_executeHostedTool` → ApprovalGate 合流**: 改用 `await this.evaluateToolCall()` 替代同步 `this.permissionGate.evaluateToolCall()`。所有 Desktop 侧 tool 执行路径现在统一走 ApprovalGate 策略（strict/trusted/autopilot）。此修复消除了 Phase E/H 遗留的最重要的死路径。

2. **`closeSession` → auto-consolidate**: 会话关闭时自动调用 `_autoConsolidate(sessionId, session)` 将 session events 写入 MemoryStore。fire-and-forget 模式，consolidation 失败不阻塞关闭。支持 `{ consolidate: false }` opt-out。

3. **`_buildHostManagedToolPolicy` → ApprovalGate 感知**: policy snapshot 发送给 CLI 子进程前也经过 `evaluateToolCall()`，使 per-session ApprovalGate 策略能影响 CLI 端工具可用性。

4. **`_mapEventToTraceType` helper**: 将 coding-agent 事件类型映射到 session-core TraceEvent 类型，供 consolidator 使用。

**测试**: session-service 28 → 36 tests (+8 Phase J: 2 ApprovalGate 路由 + 3 auto-consolidate + 3 trace mapping)

**未完成上层集成（低优先级）**:
- ⏳ Desktop Permission Gate 完全替换为 ApprovalGate（当前是合流共存，非替换）
- ⏳ Renderer UI surfacing of ApprovalGate deny events as dialog
- ⏳ `cowork analyze/compare` 非 stream 路径改走 `StreamRouter`

---

## 五、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| SessionHandle 改造破坏现有 agent-repl | 中 | 高 | 已通过 session-core 抽象隔离，CLI/Desktop 逐步迁移，保留 shim |
| Idle park 序列化丢状态 | 低 | 中 | state schema 版本化 + 回放测试 |
| consolidate LLM 成本 | 中 | 低 | 仅 token 超阈值会话触发 + category=quick |
| 多 Agent 语义迁移破坏 cowork CLI | 中 | 中 | Phase G 先做兼容层，再切默认路径 |
| ApprovalPolicy 进程内状态与用户预期不一致 | 中 | 中 | 尽快落 `approval-policies.json`，CLI/Desktop 共用文件格式 |
| Desktop 再造一套 IPC stream 协议导致分叉 | 中 | 高 | Phase H 强制以 `StreamEvent` 为唯一协议 |

---

## 六、用户文档片段（Preview）

### 6.1 新概念速查

- **Agent**: 一个 skill/persona 定义（SKILL.md）
- **Session**: 用户与 agent 的一次对话上下文（可恢复、可 park）
- **Team**: 多 agent 平级协作，共享 task list
- **Subagent**: 由父 agent 下派的子任务 agent
- **ApprovalPolicy**: 会话级工具审批策略

### 6.2 CLI 命令状态

```bash
# 已落地（Phase A–H 全部）
chainlesschain session policy <id> --set trusted
chainlesschain session lifecycle [--status parked] [--agent <id>] [--json]
chainlesschain session park <id>
chainlesschain session unpark <id>
chainlesschain session end <id> [--consolidate --scope agent --scope-id <id>]
chainlesschain memory recall "关键词" --scope agent
chainlesschain memory store "偏好 TypeScript" --scope global --category preference
chainlesschain memory consolidate --session <id>
chainlesschain config beta list
chainlesschain config beta enable idle-park-2026-05-01
chainlesschain config beta disable idle-park-2026-05-01
chainlesschain stream "<prompt>" [--text] [--provider ollama|openai|...]
chainlesschain agent [--session <id>] [--no-park-on-exit]

# Phase I 已落地
chainlesschain session tail <id> [--from-start] [--type ...] [--since ms] [--once]
chainlesschain session usage [id] [--json] [--limit 1000]
# Hosted Session API：14 条 dot-case WS 路由（通过 cc serve 暴露）
```

### 6.3 Beta Flag 使用

```bash
# 启用 idle-park 实验特性
chainlesschain config beta enable idle-park-2026-05-01

# 查看当前启用的 beta
chainlesschain config beta list
```

### 6.4 当前 CLI 持久化文件位置

- `~/.chainlesschain/memory-store.json` — MemoryStore 快照
- `~/.chainlesschain/beta-flags.json` — 已启用的 beta flag 列表
- `~/.chainlesschain/approval-policies.json` — per-session approval policy (v1.9)
- `~/.chainlesschain/parked-sessions.json` — parked SessionHandle 快照，支持 `cc session unpark <id>` 跨进程恢复 (v2.0)

Desktop 使用同名文件，位置在 `<userData>/.chainlesschain/`。

---

## 七、参考

- [Claude Managed Agents Overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
- 内部文档:
  - `docs/design/modules/78_CLI_Agent_Runtime重构实施计划.md`
  - `docs/design/modules/82_CLI_Runtime收口路线图.md`
  - `docs/design/modules/87_Cowork_Evolution_N1_N7.md`
  - `docs/design/modules/88_OpenAgents对标补齐方案.md`
  - `docs/design/modules/89_v5.0.2.9_六项优化_设计说明.md`
- 架构模式:
  - `CLAUDE-patterns.md` § Hooks 三件套
  - `CLAUDE-patterns.md` § Skill-Embedded MCP
  - `CLAUDE-patterns.md` § Canonical Tool Descriptor

---

**维护者**: ChainlessChain Agent Runtime 组
**下次评审**: Phase J 已完成。剩余低优先级上层集成：Desktop Permission Gate 完全替换 / Renderer ApprovalGate deny UI / cowork non-stream→StreamRouter
