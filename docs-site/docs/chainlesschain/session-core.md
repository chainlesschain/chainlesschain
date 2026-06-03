# Session-Core 会话运行时共享包

> **版本: v0.3.0 (2026-04-16) | 状态: ✅ 生产就绪 | 22 模块 | 452 测试 | CLI + Desktop 双端共用**
>
> `@chainlesschain/session-core` 是 Managed Agents 对标的核心产物，提供 SessionHandle / TraceStore / MemoryStore / ApprovalGate / StreamRouter / QualityGate 等 22 个模块，统一管理 Agent 会话生命周期、可观测性、记忆沉淀、审批策略、流式协议。CLI 与 Desktop 共用同一份实现，通过 file-adapters 做本地持久化。

## 概述

Session-Core 解决的核心问题：ChainlessChain 的 CLI 和 Desktop 分别实现了会话管理、记忆、审批等功能，逻辑重复且语义不统一。Session-Core 将这些功能抽取为共享包 `@chainlesschain/session-core`，CLI 和 Desktop 通过同一套 API + 同一份持久化文件交互。

包路径: `packages/session-core/`，npm 名: `@chainlesschain/session-core`

## 核心特性

- 🔄 **会话状态机**: SessionHandle — created → running → idle → parked → closed，版本化快照
- 📝 **结构化追踪**: TraceStore — assistant_message / tool_call / tool_result / error / custom 五种事件类型
- 🤖 **Agent 定义规范**: AgentDefinition — 工具 schema 正规化 + 定义缓存
- 🏊 **会话池管理**: SessionManager — 创建/查询/park/unpark/关闭 + 自动空闲检测
- ⏱️ **自动空闲检测**: IdleParker — 可配置阈值 + 轮询间隔，自动 park
- 👥 **多 Agent 分组**: AgentGroup — PEER / SUBAGENT / COORDINATOR 关系建模
- 📋 **并发安全任务列表**: SharedTaskList — rev-based 乐观锁防冲突
- 🧠 **四级作用域记忆**: MemoryStore — global / session / agent / user + 相关性评分召回
- 🔁 **自动记忆沉淀**: MemoryConsolidator — 会话结束时从 TraceStore 提取关键记忆
- 🛡️ **会话级审批策略**: ApprovalGate — strict / trusted / autopilot + 风险评估
- 🚩 **日期制 Feature Flag**: BetaFlags — 自动过期 + 解析校验
- 🌊 **统一流式协议**: StreamRouter — 所有流式输出归一化为 StreamEvent
- ✅ **可插拔质量门控**: QualityGate — 加权评分 + 阈值门控 + 4 个工厂
- 📦 **Agent Bundle**: 约定式 bundle 打包 — schema / loader / resolver 三件套
- 📡 **统一通信协议**: ServiceEnvelope — WS / HTTP SSE 双通道 + EnvelopeSSE
- 🔒 **MCP 传输策略**: McpPolicy — local / lan / hosted 模式过滤
- 🏖️ **沙箱生命周期**: SandboxPolicy — scope / TTL / idle timeout

## SessionHandle — 会话状态管理

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

## TraceStore — 事件追踪

```javascript
const { TraceStore, TRACE_TYPES } = require("@chainlesschain/session-core");

const store = new TraceStore({ maxEvents: 5000 });
store.add({ type: TRACE_TYPES.TOOL_CALL, name: "read_file", args: { path: "foo.js" } });
store.add({ type: TRACE_TYPES.ASSISTANT_MESSAGE, content: "文件内容如下..." });

console.log(store.count);               // 2
const toolCalls = store.filter({ type: TRACE_TYPES.TOOL_CALL });
const summary = store.summary();         // { total, byType, ... }
```

## MemoryStore — 四级作用域记忆

四级作用域：`GLOBAL`（全局）、`SESSION`（会话级）、`AGENT`（Agent 级）、`USER`（用户级）。

```javascript
const { MemoryStore, MEMORY_SCOPE } = require("@chainlesschain/session-core");

const ms = new MemoryStore();

// 写入
ms.store({ content: "Prefers TypeScript", scope: MEMORY_SCOPE.GLOBAL, category: "preference" });
ms.store({ content: "Asked about P2P", scope: MEMORY_SCOPE.SESSION, scopeId: "sess_123", tags: ["p2p"] });

// 召回 — 支持 query 关键字匹配 + tag 过滤 + scope 过滤
const results = ms.recall({ query: "typescript", scope: MEMORY_SCOPE.GLOBAL, limit: 10 });
const tagged = ms.recall({ tags: ["p2p"], limit: 5 });
```

## ApprovalGate — 审批策略

三种策略：`strict`（每次工具调用需审批）、`trusted`（仅 HIGH 风险需审批）、`autopilot`（全自动）。

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

## StreamRouter — 统一流式协议

```javascript
const { StreamRouter, STREAM_EVENT } = require("@chainlesschain/session-core");

const router = new StreamRouter();
router.on(STREAM_EVENT.TEXT, (event) => process.stdout.write(event.text));
router.on(STREAM_EVENT.TOOL_CALL, (event) => console.log(`Tool: ${event.name}`));

for await (const chunk of llmStream) {
  router.push(chunk);
}
```

## QualityGate — 可插拔质量检查

```javascript
const {
  QualityGate,
  createProtagonistChecker,
  createLintPassChecker,
} = require("@chainlesschain/session-core");

const gate = new QualityGate({ threshold: 0.6, aggregate: "weighted-mean" });
gate.register(createProtagonistChecker({ minRatio: 0.3 }));
gate.register(createLintPassChecker({ maxErrors: 0 }));

const result = await gate.check({ protagonist_ratio: 0.8, errorCount: 0, totalCount: 50 });
console.log(result.pass);                // true
console.log(result.score);              // 0.85
```

## AgentGroup + SharedTaskList — 多 Agent 协同

```javascript
const { AgentGroup, RELATIONSHIPS, SharedTaskList } = require("@chainlesschain/session-core");

// 分组
const group = new AgentGroup({ metadata: { kind: "debate" } });
group.addMember("reviewer_perf", { relationship: RELATIONSHIPS.PEER });
group.addMember("reviewer_sec", { relationship: RELATIONSHIPS.PEER });
group.addMember("moderator", { relationship: RELATIONSHIPS.COORDINATOR });

// 并发安全任务列表
const tasks = new SharedTaskList();
const task = tasks.add({ title: "Review performance" });
const claimed = tasks.claim(task.id, "reviewer_perf", task.rev);
tasks.complete(task.id, { verdict: "APPROVE" }, claimed.rev);
```

## SessionManager — 会话池管理

```javascript
const { SessionManager } = require("@chainlesschain/session-core");

const mgr = new SessionManager();
const handle = mgr.create({ agentId: "coder", approvalPolicy: "trusted" });

mgr.park(handle.sessionId);              // 持久化到文件
mgr.unpark(handle.sessionId);           // 恢复
mgr.close(handle.sessionId);            // 关闭
```

## Service Envelope — 统一通信协议

```javascript
const { createEnvelope, validateEnvelope, ENVELOPE_TYPES } = require("@chainlesschain/session-core");

const env = createEnvelope(ENVELOPE_TYPES.SESSIONS_LIST_RESPONSE, {
  ok: true,
  sessions: [{ sessionId: "sess_123", status: "running" }],
});

const { valid } = validateEnvelope(env);   // true
```

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Desktop (Electron)                        │
│  session-core-ipc.js — 24 IPC 通道                          │
│  Pinia Store (sessionCore.ts)                               │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│              @chainlesschain/session-core                    │
│                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│  │SessionHandle│ │ TraceStore │ │ MemoryStore │ │ApprovalGate│
│  │SessionMgr  │ │ 事件追踪   │ │ 四级作用域  │ │ 审批策略 │ │
│  │IdleParker  │ │            │ │Consolidator│ │ BetaFlags│ │
│  └────────────┘ └────────────┘ └────────────┘ └──────────┘ │
│                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│  │StreamRouter│ │QualityGate │ │AgentGroup  │ │ Bundle   │ │
│  │ 流式协议   │ │ 质量门控   │ │SharedTask  │ │Schema/   │ │
│  │            │ │ 4个工厂    │ │ rev锁      │ │Loader/   │ │
│  │            │ │            │ │            │ │Resolver  │ │
│  └────────────┘ └────────────┘ └────────────┘ └──────────┘ │
│                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐              │
│  │ServiceEnv  │ │ McpPolicy  │ │SandboxPolicy│              │
│  │EnvelopeSSE │ │ 传输过滤   │ │ 生命周期   │              │
│  └────────────┘ └────────────┘ └────────────┘              │
│                                                              │
│  file-adapters.js — JSON 本地持久化                          │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                     CLI (packages/cli)                        │
│  memory / session / config beta / stream / agent --bundle    │
│  cc serve — WebSocket API (14 路由 + 2 流式)                 │
└─────────────────────────────────────────────────────────────┘
```

### 持久化文件

所有文件存储在 `~/.chainlesschain/`（CLI）或 `<userData>/.chainlesschain/`（Desktop）：

| 文件 | 说明 |
|------|------|
| `memory-store.json` | MemoryStore 持久化 |
| `approval-policies.json` | 会话级 ApprovalGate 策略 |
| `beta-flags.json` | BetaFlags 状态 |
| `parked-sessions.json` | park 的会话快照 |
| `sessions/<id>.jsonl` | 会话事件流（NDJSON） |

### Desktop IPC 通道（24 个）

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

### Hosted Session API（WebSocket）

`cc serve` 暴露 WebSocket API，路由类型使用 dot-case，返回 `<type>.response` envelope。

**请求/响应路由（14 个）**:

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

**流式路由（2 个）**:

| Type | Payload | Events |
|------|---------|--------|
| `stream.run` | `prompt`, `provider?`, `model?` | `stream.event` → `stream.run.end` |
| `sessions.subscribe` | `events?:string[]` | `stream.event` (lifecycle) |

取消: 发送 `{ type: "cancel", id }` 中止流式请求。

## 配置参考

### SessionHandle / SessionManager

```javascript
{
  agentId: "coder",                    // Agent 标识
  approvalPolicy: "trusted",           // 审批策略 (strict | trusted | autopilot)
  metadata: {},                        // 自定义元数据
}
```

### IdleParker

```javascript
{
  idleThreshold: 300000,               // 空闲阈值 (5min)
  interval: 60000,                     // 轮询间隔 (1min)
}
```

### MemoryStore

```javascript
{
  scope: "global",                     // 作用域 (global | session | agent | user)
  scopeId: null,                       // 作用域 ID（session/agent/user 需要）
  category: null,                      // 记忆分类
  tags: [],                            // 标签
}
```

### QualityGate

```javascript
{
  threshold: 0.6,                      // 通过阈值 [0, 1]
  aggregate: "weighted-mean",          // 聚合策略 (weighted-mean | min | all-pass)
  onCheck: null,                       // 遥测回调 (checkResult) => void
}
```

### BetaFlags

```javascript
// Flag 格式: <feature>-<YYYY-MM-DD>
// 过期日期之后自动禁用
// 示例: "idle-park-2026-05-01"
```

### Service Envelope

```javascript
{
  type: "sessions.list",               // dot-case 路由类型
  id: "req_xxxx",                      // 请求 ID（用于关联响应）
  ts: 1712000000000,                   // 时间戳
  // ... payload
}
```

## 性能指标

### 响应时间

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| SessionHandle 创建 | &lt; 2ms | &lt; 1ms | ✅ |
| TraceStore add | &lt; 1ms | &lt; 0.1ms | ✅ |
| MemoryStore recall (1000 条) | &lt; 10ms | &lt; 5ms | ✅ |
| ApprovalGate evaluate | &lt; 1ms | &lt; 0.5ms | ✅ |
| QualityGate check (4 checkers) | &lt; 15ms | &lt; 10ms | ✅ |
| Bundle load + resolve | &lt; 100ms | &lt; 50ms | ✅ |
| ServiceEnvelope create | &lt; 1ms | &lt; 0.1ms | ✅ |

### 资源使用

| 指标 | 数值 |
|------|------|
| 包大小 (22 模块) | ~15KB |
| 内存占用 (单会话) | &lt; 5MB |
| 持久化文件 (1000 记忆) | ~200KB |
| 持久化文件 (单会话 JSONL) | ~50KB/1000 events |

### 可扩展性

| 限制 | 数值 |
|------|------|
| 最大并发会话 | 100+ |
| TraceStore 最大事件 | 10000 (可配) |
| MemoryStore 最大条目 | 10000+ |
| SharedTaskList 最大任务 | 1000+ |
| AgentGroup 最大成员 | 50 |

## 测试覆盖率

### 单元测试

```
✅ session-handle.test.js              - 25 测试 (状态机/快照/版本)
✅ trace-store.test.js                 - 24 测试 (事件追踪/过滤/摘要)
✅ agent-definition.test.js            - 30 测试 (定义规范/schema/缓存)
✅ session-manager.test.js             - 25 测试 (池管理/park/unpark)
✅ idle-parker.test.js                 - 14 测试 (空闲检测/阈值/轮询)
✅ agent-group.test.js                 - 26 测试 (分组/关系/成员管理)
✅ shared-task-list.test.js            - 26 测试 (任务/claim/rev锁)
✅ memory-store.test.js                - 40 测试 (四级作用域/召回/标签)
✅ memory-consolidator.test.js         - 15 测试 (提取/分类/去重)
✅ approval-gate.test.js               - 30 测试 (三策略/风险/评估)
✅ beta-flags.test.js                  - 16 测试 (启用/禁用/过期)
✅ stream-router.test.js               - 19 测试 (事件协议/路由)
✅ file-adapters.test.js               - 8 测试 (JSON持久化)
✅ agent-bundle-schema.test.js         - 14 测试 (验证/常量)
✅ agent-bundle-loader.test.js         - 9 测试 (加载/解析)
✅ agent-bundle-resolver.test.js       - 17 测试 (AGENTS.md→prompt/USER.md→memory)
✅ mcp-policy.test.js                  - 19 测试 (传输过滤/模式)
✅ sandbox-policy.test.js              - 26 测试 (沙箱策略/TTL)
✅ service-envelope.test.js            - 21 测试 (创建/验证/类型)
✅ envelope-sse.test.js                - 9 测试 (SSE序列化)
✅ quality-gate.test.js                - 39 测试 (检查器/聚合/工厂)
```

**总覆盖率**: 452 测试，21 测试文件，100% 通过

### Desktop IPC 测试

```
✅ session-core-ipc.test.js            - 33 测试 (24 IPC 通道)
✅ coding-agent-session-service.test.js - 36 测试 (Phase J 合流)
```

### CLI 集成测试

```
✅ agent-bundle-integration.test.js    - 15 测试 (cc agent/serve --bundle)
✅ envelope-http-server.test.js        - 11 测试 (SSE 服务)
```

## 安全考虑

### 审批策略安全

1. **默认 strict** — 新会话默认 `strict` 策略，每次工具调用需审批
2. **策略持久化** — 策略保存到 `approval-policies.json`，重启后恢复
3. **风险评估** — ApprovalGate 内置 LOW / MEDIUM / HIGH / CRITICAL 四级风险
4. **Desktop 合流** — Phase J 确保 `_executeHostedTool` 也走 ApprovalGate，不绕过策略

### 数据安全

1. **本地持久化** — 所有数据存储在本地 `~/.chainlesschain/`，不上传云端
2. **文件级隔离** — 每个会话 JSONL 独立文件，互不干扰
3. **scope 隔离** — MemoryStore 按 scope + scopeId 隔离，防止跨会话泄露
4. **BetaFlags 过期** — 自动过期机制防止遗忘实验性功能开关

### MCP 传输安全

1. **模式级过滤** — `hosted` 模式自动禁止 `stdio` 传输（防止远程执行本地命令）
2. **配置验证** — Bundle MCP 配置经过 schema 验证，拒绝非法配置
3. **传输白名单** — 仅允许 stdio / sse / streamable-http 三种已知传输

## 故障排查

### 常见问题

**Q: MemoryStore recall 返回空结果?**

检查以下几点:

1. scope 和 scopeId 是否正确 — `recall({ scope: "session", scopeId: "sess_123" })`
2. 记忆是否已持久化 — 检查 `~/.chainlesschain/memory-store.json`
3. query 关键字是否匹配 — recall 使用子字符串匹配

**Q: ApprovalGate 始终拒绝?**

可能原因:

1. 策略未设置 — 默认 `strict`，需 `session policy <id> --set trusted`
2. 工具风险过高 — `strict` 拒绝一切，`trusted` 仅允许 LOW/MEDIUM
3. 策略未持久化 — 检查 `~/.chainlesschain/approval-policies.json`

**Q: BetaFlags 启用后不生效?**

检查:

1. Flag 格式是否正确 — 必须为 `<feature>-YYYY-MM-DD`
2. 是否已过期 — 日期在今天之前则自动禁用
3. 文件是否可写 — 检查 `~/.chainlesschain/beta-flags.json` 权限

**Q: Bundle 加载失败?**

检查:

1. 清单文件是否存在 — `chainless-agent.toml` 或 `chainless-agent.json`
2. mode 是否合法 — 必须为 `local` / `lan` / `hosted`
3. 路径是否为绝对路径 — Bundle 路径需要可解析为绝对路径
4. TOML 语法是否正确 — 使用 `cat chainless-agent.toml` 检查

### 调试模式

```bash
# 查看持久化文件内容
cat ~/.chainlesschain/memory-store.json | jq .
cat ~/.chainlesschain/approval-policies.json | jq .

# 检查会话事件流
cat ~/.chainlesschain/sessions/sess_123.jsonl | head -20

# 验证 session-core 模块导出
node -e "const sc = require('@chainlesschain/session-core'); console.log(Object.keys(sc))"
```

## 关键文件

### session-core 核心模块

| 文件 | 职责 | 测试数 |
|------|------|--------|
| `packages/session-core/lib/session-handle.js` | 会话状态机 | 25 |
| `packages/session-core/lib/trace-store.js` | 结构化事件追踪 | 24 |
| `packages/session-core/lib/agent-definition.js` | Agent 定义规范 | 30 |
| `packages/session-core/lib/session-manager.js` | 会话池管理 | 25 |
| `packages/session-core/lib/idle-parker.js` | 空闲检测 | 14 |
| `packages/session-core/lib/agent-group.js` | 多 Agent 分组 | 26 |
| `packages/session-core/lib/shared-task-list.js` | 并发安全任务列表 | 26 |
| `packages/session-core/lib/memory-store.js` | 四级作用域记忆 | 40 |
| `packages/session-core/lib/memory-consolidator.js` | 记忆沉淀 | 15 |
| `packages/session-core/lib/approval-gate.js` | 审批策略 | 30 |
| `packages/session-core/lib/beta-flags.js` | Feature Flag | 16 |
| `packages/session-core/lib/stream-router.js` | 流式协议 | 19 |
| `packages/session-core/lib/file-adapters.js` | JSON 持久化 | 8 |
| `packages/session-core/lib/quality-gate.js` | 质量门控 | 39 |
| `packages/session-core/lib/index.js` | 统一导出 | — |

### Agent Bundle 模块

| 文件 | 职责 | 测试数 |
|------|------|--------|
| `packages/session-core/lib/agent-bundle-schema.js` | 目录结构 + 验证 | 14 |
| `packages/session-core/lib/agent-bundle-loader.js` | 文件系统读取 + 解析 | 9 |
| `packages/session-core/lib/agent-bundle-resolver.js` | AGENTS.md→prompt + USER.md→memory | 17 |
| `packages/session-core/lib/mcp-policy.js` | MCP 传输过滤 | 19 |
| `packages/session-core/lib/sandbox-policy.js` | 沙箱策略 | 26 |
| `packages/session-core/lib/service-envelope.js` | 统一通信协议 | 21 |
| `packages/session-core/lib/envelope-sse.js` | SSE 序列化 | 9 |

### Desktop 集成

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/session/session-core-ipc.js` | 24 IPC 通道 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js` | Phase J 合流 |
| `desktop-app-vue/src/renderer/stores/sessionCore.ts` | Pinia Store |

### CLI 集成

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/agent.js` | `--bundle` 选项 |
| `packages/cli/src/commands/serve.js` | `--bundle` + WS API |
| `packages/cli/src/commands/memory.js` | memory store/recall/consolidate |
| `packages/cli/src/commands/session.js` | session policy/lifecycle/tail/usage |

## 使用示例

### Scoped Memory (CLI)

```bash
# 全局偏好记忆
chainlesschain memory store "Prefers TypeScript" --scope global --category preference
chainlesschain memory recall "typescript" --scope global --json

# 用户级记忆
chainlesschain memory store "Likes Rust" --scope user --scope-id u_alice
chainlesschain memory recall "rust" --scope user --scope-id u_alice --json

# 按标签召回
chainlesschain memory recall --tags p2p --limit 20

# 会话结束时自动沉淀
chainlesschain memory consolidate --session sess_123 --scope agent --agent-id coder
chainlesschain memory consolidate --session sess_123 --dry-run --json
```

### 会话审批策略 (CLI)

```bash
# 查看策略
chainlesschain session policy sess_123

# 设置策略
chainlesschain session policy sess_123 --set trusted
chainlesschain session policy sess_123 --set autopilot
chainlesschain session policy sess_123 --json
```

### 会话生命周期 (CLI)

```bash
# 列出会话
chainlesschain session lifecycle
chainlesschain session lifecycle --status parked --json

# 暂停 / 恢复
chainlesschain session park sess_123
chainlesschain session unpark sess_123

# 关闭 + 记忆沉淀
chainlesschain session end sess_123 --consolidate

# 尾随会话事件
chainlesschain session tail sess_123
chainlesschain session tail sess_123 --type tool_call,assistant_message
```

### 流式输出 (CLI)

```bash
# NDJSON 流式
chainlesschain stream "summarize file X"

# 纯文本输出
chainlesschain stream "..." --text

# 指定 provider
chainlesschain stream "..." --provider openai --model gpt-4o
```

### Beta Flags (CLI)

```bash
chainlesschain config beta list [--json]
chainlesschain config beta enable idle-park-2026-05-01
chainlesschain config beta disable idle-park-2026-05-01
```

## 相关文档

- [Agent Bundle 打包部署 →](/chainlesschain/agent-bundles)
- [QualityGate 通用质量门控 →](/chainlesschain/quality-gate)
- [视频剪辑 Agent →](/chainlesschain/video-editing)
- [Managed Agents 对标与 CLI 接入 →](/chainlesschain/managed-agents-parity)
- [Managed Agents CLI 命令 →](/chainlesschain/managed-agents-cli)
- [WebSocket 服务器 →](/chainlesschain/cli-serve)
- [代理模式 (agent) →](/chainlesschain/cli-agent)

---

> 本文档为 Session-Core 完整参考。设计文档详见：
>
> - [91. Managed Agents 对标计划](/design/modules/91-managed-agents-parity)
> - [92. Deep Agents Deploy 借鉴落地方案](/design/modules/92-deep-agents-deploy)
