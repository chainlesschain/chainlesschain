# Session-Core (会话运行时共享包)

**Status**: ✅ Implemented (v5.0.2.10 — session-core 0.3.0)
**Added**: 2026-04-16
**Updated**: 2026-04-16

`@chainlesschain/session-core` 是 Desktop 和 CLI 共用的会话运行时核心包。提供 SessionHandle、TraceStore、AgentDefinition、MemoryStore、ApprovalGate、StreamRouter、QualityGate 等 22 个模块，统一管理 Agent 会话生命周期、可观测性、记忆沉淀、审批策略、流式协议。

**设计文档**: [91. Managed Agents 对标计划](../design/modules/91_Managed_Agents对标计划.md)
**相关系统**: [Agent Bundle](./AGENT_BUNDLES.md) | [SessionManager](./SESSION_MANAGER.md)

## 核心功能

1. **SessionHandle**: 会话状态机（created → running → idle → parked → closed）+ 版本化快照
2. **TraceStore**: 结构化事件追踪（assistant_message / tool_call / tool_result / error / custom）
3. **AgentDefinition**: Agent 定义规范 + 工具 schema 正规化 + 定义缓存
4. **SessionManager**: 会话池管理 — 创建/查询/park/unpark/关闭 + 自动空闲检测
5. **IdleParker**: 可配置空闲阈值 + 轮询间隔，自动 park 空闲会话
6. **AgentGroup**: 多 Agent 分组 — PEER/SUBAGENT/COORDINATOR 关系建模
7. **SharedTaskList**: 并发安全的共享任务列表 — rev-based 乐观锁
8. **MemoryStore**: 四级作用域记忆 — global / session / agent / user + 相关性评分
9. **MemoryConsolidator**: 会话结束时从 TraceStore 提取关键记忆 + 自动分类
10. **ApprovalGate**: 会话级审批策略 — strict / trusted / autopilot + 风险评估
11. **BetaFlags**: 日期制 feature flag — 自动过期 + 解析校验
12. **StreamRouter**: 统一 StreamEvent 协议 — 所有流式输出归一化
13. **QualityGate**: 可插拔质量检查注册表 — 加权评分 + 阈值门控
14. **Agent Bundle**: 约定式 bundle 打包 — schema / loader / resolver 三件套
15. **Service Envelope**: 统一通信协议 — WS / HTTP SSE 双通道
16. **MCP Policy**: 运行模式级 MCP 传输策略 — local / lan / hosted
17. **Sandbox Policy**: 沙箱生命周期策略 — scope / TTL / idle timeout

## 安装

```bash
# 已作为 workspace 包自动解析
npm install  # 在项目根目录
```

包路径: `packages/session-core/`，npm 名: `@chainlesschain/session-core`

## 使用方式

### SessionHandle — 会话状态管理

```javascript
const { SessionHandle, SESSION_STATUS } = require("@chainlesschain/session-core");

const handle = new SessionHandle({
  agentId: "coder",
  approvalPolicy: "trusted",
});

console.log(handle.sessionId);           // "sess_xxxx"
console.log(handle.status);              // "created"

handle.touch();                          // 更新 lastActiveAt
handle.markIdle();                       // status → idle
const snapshot = handle.snapshot();       // 序列化快照
handle.markClosed();                     // status → closed
```

### TraceStore — 事件追踪

```javascript
const { TraceStore, TRACE_TYPES } = require("@chainlesschain/session-core");

const store = new TraceStore({ maxEvents: 5000 });
store.add({ type: TRACE_TYPES.TOOL_CALL, name: "read_file", args: { path: "foo.js" } });
store.add({ type: TRACE_TYPES.ASSISTANT_MESSAGE, content: "文件内容如下..." });

console.log(store.count);               // 2
const toolCalls = store.filter({ type: TRACE_TYPES.TOOL_CALL });
const summary = store.summary();         // { total, byType, ... }
```

### MemoryStore — 四级作用域记忆

```javascript
const { MemoryStore, MEMORY_SCOPE } = require("@chainlesschain/session-core");

const ms = new MemoryStore();

// 写入
ms.store({ content: "Prefers TypeScript", scope: MEMORY_SCOPE.GLOBAL, category: "preference" });
ms.store({ content: "Asked about P2P", scope: MEMORY_SCOPE.SESSION, scopeId: "sess_123", tags: ["p2p"] });

// 召回
const results = ms.recall({ query: "typescript", scope: MEMORY_SCOPE.GLOBAL, limit: 10 });
console.log(results[0].content);         // "Prefers TypeScript"

// 按标签召回
const tagged = ms.recall({ tags: ["p2p"], limit: 5 });
```

**CLI 命令**:

```bash
# 写入
chainlesschain memory store "Prefers TypeScript" --scope global --category preference
chainlesschain memory store "Likes Rust" --scope user --scope-id u_alice

# 召回
chainlesschain memory recall "typescript" --scope global --json
chainlesschain memory recall --tags p2p --limit 20

# 会话结束时自动沉淀
chainlesschain memory consolidate --session sess_123 --scope agent --agent-id coder
```

### ApprovalGate — 审批策略

```javascript
const { ApprovalGate, APPROVAL_POLICY, APPROVAL_RISK } = require("@chainlesschain/session-core");

const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.TRUSTED });

const decision = gate.evaluate({
  toolName: "write_file",
  risk: APPROVAL_RISK.MEDIUM,
  sessionPolicy: APPROVAL_POLICY.TRUSTED,
});

console.log(decision.allowed);           // true (trusted 允许 MEDIUM)
console.log(decision.reason);            // "trusted policy permits medium risk"
```

**CLI 命令**:

```bash
chainlesschain session policy sess_123                  # 查看策略
chainlesschain session policy sess_123 --set trusted    # 设置策略
```

### BetaFlags — 日期制 Feature Flag

```javascript
const { BetaFlags } = require("@chainlesschain/session-core");

const flags = new BetaFlags();
flags.enable("idle-park-2026-05-01");

console.log(flags.isEnabled("idle-park-2026-05-01"));   // true
console.log(flags.isEnabled("idle-park-2025-01-01"));   // false (已过期)
```

**CLI 命令**:

```bash
chainlesschain config beta list [--json]
chainlesschain config beta enable idle-park-2026-05-01
chainlesschain config beta disable idle-park-2026-05-01
```

### StreamRouter — 统一流式协议

```javascript
const { StreamRouter, STREAM_EVENT } = require("@chainlesschain/session-core");

const router = new StreamRouter();

// 注册输出处理器
router.on(STREAM_EVENT.TEXT, (event) => process.stdout.write(event.text));
router.on(STREAM_EVENT.TOOL_CALL, (event) => console.log(`Tool: ${event.name}`));

// 喂入原始流
for await (const chunk of llmStream) {
  router.push(chunk);
}
```

**CLI 命令**:

```bash
# NDJSON 流式输出
chainlesschain stream "summarize file X"
chainlesschain stream "..." --text              # 纯文本输出
chainlesschain stream "..." --provider openai   # 指定 provider
```

### QualityGate — 可插拔质量检查

```javascript
const {
  QualityGate,
  createProtagonistChecker,
  createLintPassChecker,
} = require("@chainlesschain/session-core");

const gate = new QualityGate({ threshold: 0.6, aggregate: "weighted-mean" });

// 注册检查器
gate.register(createProtagonistChecker({ minRatio: 0.3 }));
gate.register(createLintPassChecker({ maxErrors: 0 }));

// 运行检查
const result = await gate.check({ protagonist_ratio: 0.8, errorCount: 0, totalCount: 50 });
console.log(result.pass);                // true
console.log(result.score);              // 0.85 (weighted mean)
```

**内置检查器工厂**:

| 工厂函数 | 用途 | 默认 tags |
|----------|------|-----------|
| `createProtagonistChecker` | 视频主角占比 ≥ minRatio | `["video", "vision"]` |
| `createDurationChecker` | 时长偏差 ≤ tolerance | `["video", "timing"]` |
| `createThresholdChecker` | 通用字段阈值 | 自定义 |
| `createLintPassChecker` | lint/test 错误数 ≤ maxErrors | `["code"]` |

### AgentGroup — 多 Agent 分组

```javascript
const { AgentGroup, RELATIONSHIPS } = require("@chainlesschain/session-core");

const group = new AgentGroup({ metadata: { kind: "debate" } });

group.addMember("reviewer_perf", { relationship: RELATIONSHIPS.PEER });
group.addMember("reviewer_sec", { relationship: RELATIONSHIPS.PEER });
group.addMember("moderator", { relationship: RELATIONSHIPS.COORDINATOR });

console.log(group.size);                 // 3
const peers = group.listByRelationship(RELATIONSHIPS.PEER);
```

### SharedTaskList — 并发安全任务列表

```javascript
const { SharedTaskList, TASK_STATUS } = require("@chainlesschain/session-core");

const tasks = new SharedTaskList();
const task = tasks.add({ title: "Review performance", description: "..." });

// 乐观并发控制
const claimed = tasks.claim(task.id, "reviewer_perf", task.rev);
tasks.complete(task.id, { verdict: "APPROVE" }, claimed.rev);
```

### Service Envelope — 统一通信协议

```javascript
const { createEnvelope, validateEnvelope, ENVELOPE_TYPES } = require("@chainlesschain/session-core");

const env = createEnvelope(ENVELOPE_TYPES.SESSIONS_LIST_RESPONSE, {
  ok: true,
  sessions: [{ sessionId: "sess_123", status: "running" }],
});

const { valid } = validateEnvelope(env);   // true
```

### SessionManager — 会话池管理

```javascript
const { SessionManager } = require("@chainlesschain/session-core");

const mgr = new SessionManager();
const handle = mgr.create({ agentId: "coder", approvalPolicy: "trusted" });

mgr.park(handle.sessionId);              // 持久化到文件
mgr.unpark(handle.sessionId);           // 恢复
mgr.close(handle.sessionId);            // 关闭
```

**CLI 命令**:

```bash
chainlesschain session lifecycle                     # 列出会话
chainlesschain session lifecycle --status parked     # 仅显示已暂停的
chainlesschain session park sess_123                 # 暂停
chainlesschain session unpark sess_123               # 恢复
chainlesschain session end sess_123 --consolidate    # 关闭 + 记忆沉淀
```

## 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `DEFAULT_IDLE_THRESHOLD_MS` | 300000 (5min) | 空闲检测阈值 |
| `DEFAULT_INTERVAL_MS` | 60000 (1min) | IdleParker 轮询间隔 |
| `DEFAULT_MAX_EVENTS` | 10000 | TraceStore 最大事件数 |
| `QualityGate.threshold` | 0.6 | 质量门控通过阈值 |
| `MS_PER_HOUR` | 3600000 | session-hour 计费粒度 |

## 持久化文件

所有文件存储在 `~/.chainlesschain/`（CLI）或 `<userData>/.chainlesschain/`（Desktop）：

| 文件 | 说明 |
|------|------|
| `memory-store.json` | MemoryStore 持久化 |
| `approval-policies.json` | 会话级 ApprovalGate 策略 |
| `beta-flags.json` | BetaFlags 状态 |
| `parked-sessions.json` | park 的会话快照 |
| `sessions/<id>.jsonl` | 会话事件流（NDJSON） |

## Desktop IPC 通道

| 通道 | 功能 |
|------|------|
| `session-core:memory:store` | 写入记忆 |
| `session-core:memory:recall` | 召回记忆 |
| `session-core:memory:delete` | 删除记忆 |
| `session-core:memory:consolidate` | 会话记忆沉淀 |
| `session-core:approval:get` | 获取会话审批策略 |
| `session-core:approval:set` | 设置会话审批策略 |
| `session-core:beta:list` | 列出 beta flags |
| `session-core:beta:enable` | 启用 beta flag |
| `session-core:beta:disable` | 禁用 beta flag |
| `session-core:sessions:list` | 列出会话 |
| `session-core:sessions:park` | 暂停会话 |
| `session-core:sessions:unpark` | 恢复会话 |
| `session-core:sessions:end` | 关闭会话 |
| `session:policy:get` | 获取 session policy |
| `session:policy:set` | 设置 session policy |
| `session:subscribe` | 订阅会话生命周期事件 |
| `session:usage` | 查询 session token usage |
| `session:usage:global` | 查询全局 token usage |
| `session:tail:start` | 开始 tail 会话事件 |
| `session:tail:stop` | 停止 tail |
| `bundle:load` | 加载 Agent Bundle |
| `bundle:info` | 查询当前 Bundle |
| `bundle:unload` | 卸载 Bundle |
| `session-core:status` | session-core 健康状态 |

## Hosted Session API (WebSocket)

`cc serve` 暴露 WebSocket API，路由类型使用 dot-case，返回 `<type>.response` envelope。

### 请求/响应路由

| Type | Payload | Response |
|------|---------|----------|
| `sessions.list` | `agentId?`, `status?` | `{ sessions[] }` |
| `sessions.show` | `sessionId` | `{ session }` |
| `sessions.park` | `sessionId` | `{ parked: true }` |
| `sessions.unpark` | `sessionId` | `{ resumed: true }` |
| `sessions.end` | `sessionId`, `consolidate?` | `{ ended: true }` |
| `sessions.policy.get` | `sessionId` | `{ policy }` |
| `sessions.policy.set` | `sessionId`, `policy` | `{ updated: true }` |
| `memory.store` | `content`, `scope?`, `tags?` | `{ stored: true, id }` |
| `memory.recall` | `query?`, `scope?`, `limit?` | `{ results[] }` |
| `memory.delete` | `id` | `{ deleted: true }` |
| `memory.consolidate` | `sessionId`, `dryRun?` | `{ extracted[] }` |
| `beta.list` | - | `{ flags[] }` |
| `beta.enable` | `flag` | `{ enabled: true }` |
| `beta.disable` | `flag` | `{ disabled: true }` |

### 流式路由

| Type | Payload | Events |
|------|---------|--------|
| `stream.run` | `prompt`, `provider?`, `model?` | `stream.event` → `stream.run.end` |
| `sessions.subscribe` | `events?:string[]` | `stream.event` (lifecycle) |

取消: 发送 `{ type: "cancel", id }` 中止流式请求。

## 性能指标

- **SessionHandle 创建**: < 1ms
- **MemoryStore recall**: < 5ms (1000 条记忆内)
- **TraceStore add**: < 0.1ms
- **QualityGate check**: < 10ms (4 checkers)
- **Bundle load + resolve**: < 50ms

## 测试

```bash
# 全量 session-core 测试 (452 tests)
cd packages/session-core && npx vitest run

# 单模块测试
npx vitest run __tests__/session-handle.test.js
npx vitest run __tests__/memory-store.test.js
npx vitest run __tests__/approval-gate.test.js
npx vitest run __tests__/quality-gate.test.js
npx vitest run __tests__/stream-router.test.js

# Desktop IPC 测试
cd desktop-app-vue && npx vitest run tests/unit/session/session-core-ipc.test.js
```

## 模块清单

| 模块 | 路径 | 测试数 |
|------|------|--------|
| SessionHandle | `lib/session-handle.js` | 25 |
| TraceStore | `lib/trace-store.js` | 24 |
| AgentDefinition | `lib/agent-definition.js` | 30 |
| SessionManager | `lib/session-manager.js` | 25 |
| IdleParker | `lib/idle-parker.js` | 14 |
| AgentGroup | `lib/agent-group.js` | 26 |
| SharedTaskList | `lib/shared-task-list.js` | 26 |
| MemoryStore | `lib/memory-store.js` | 40 |
| MemoryConsolidator | `lib/memory-consolidator.js` | 15 |
| ApprovalGate | `lib/approval-gate.js` | 30 |
| BetaFlags | `lib/beta-flags.js` | 16 |
| StreamRouter | `lib/stream-router.js` | 19 |
| FileAdapters | `lib/file-adapters.js` | 8 |
| AgentBundleSchema | `lib/agent-bundle-schema.js` | 14 |
| AgentBundleLoader | `lib/agent-bundle-loader.js` | 9 |
| AgentBundleResolver | `lib/agent-bundle-resolver.js` | 17 |
| McpPolicy | `lib/mcp-policy.js` | 19 |
| SandboxPolicy | `lib/sandbox-policy.js` | 26 |
| ServiceEnvelope | `lib/service-envelope.js` | 21 |
| EnvelopeSSE | `lib/envelope-sse.js` | 9 |
| QualityGate | `lib/quality-gate.js` | 39 |
| Index (re-exports) | `lib/index.js` | — |
| **合计** | **22 modules** | **452** |
