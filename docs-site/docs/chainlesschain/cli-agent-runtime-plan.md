# CLI Agent Runtime 重构计划

> v5.0.2.10 收口完成（对应设计文档模块 78）

## 核心特性

- 🧱 **职责边界固化**：把 CLI Agent 从“入口、协议、状态、增强能力混杂”收敛为 `commands / runtime / gateways / harness / contracts / tools` 六层结构
- 🔁 **兼容迁移而非重写**：旧 `packages/cli/src/lib/*` 路径保留兼容导出，调用方按需迁移
- 📡 **统一 Runtime Event**：CLI、WebSocket 协议层、Web Panel store 共享同一套 event envelope
- 📦 **标准 Record 模型**：`session-record / task-record / worktree-record / telemetry-record` 四套 contract 落地
- 🛠 **统一 Tool Registry**：`shell / git / mcp` 三类工具进入统一描述符模型，附带权限元数据与 telemetry tags

## 概述

CLI Agent Runtime 重构是 v5.0.2.10 周期内对 `packages/cli` 的核心架构治理。借鉴 `learn-coding-agent` 的分层思路，把过去散落在 `lib/` 下的会话、协议、增强能力按职责拆分为六层稳定结构，使 CLI / WebSocket / Web Panel 三端共享同一套 `record` 和 event envelope。

重构遵循“收口而非重写”原则：旧路径全部保留兼容导出，调用方按需迁移；同时通过 contract 优先策略保证前后端解耦演进。本轮 v5.0.2.10 已完成 Phase 1–5 全部主线任务，进入兼容层收缩与常规回归维护阶段。

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│              CLI Agent Runtime (重构后)              │
│                                                      │
│  commands/  →  解析命令、选择入口、调用 factory       │
│       │                                              │
│       ▼                                              │
│  runtime/   →  AgentRuntime / runtime-context        │
│               runTurn / resumeSession / events       │
│       │                                              │
│       ├─────────► gateways/                          │
│       │           ├─ repl/   (本地 REPL)             │
│       │           ├─ ws/     (WebSocket 协议分拆)    │
│       │           └─ ui/     (Web Panel 入口)        │
│       │                                              │
│       ├─────────► harness/                           │
│       │           ├─ prompt-compressor               │
│       │           ├─ jsonl-session-store             │
│       │           ├─ background-task-manager         │
│       │           ├─ worktree-isolator               │
│       │           ├─ feature-flags                   │
│       │           └─ compression-telemetry           │
│       │                                              │
│       ├─────────► contracts/                         │
│       │           ├─ agent-turn                      │
│       │           ├─ session-record                  │
│       │           ├─ task-record                     │
│       │           ├─ worktree-record                 │
│       │           └─ telemetry-record                │
│       │                                              │
│       └─────────► tools/                             │
│                   ├─ registry                        │
│                   ├─ tool-context                    │
│                   ├─ tool-permissions                │
│                   └─ tool-telemetry                  │
└──────────────────────────────────────────────────────┘
```

## 核心设计

### 六层职责边界

| 层 | 职责 | 不再承担 |
|----|------|----------|
| `commands` | 解析参数、选择入口、调用 runtime factory | 拼 session、操作协议、管理增强能力 |
| `runtime` | 驱动 agent turn 生命周期、统一 session 恢复与事件发射 | 协议适配、外部接入边界 |
| `gateways` | 处理外部接入（REPL / WS / UI）、协议适配与消息分发 | 复杂业务逻辑 |
| `harness` | 持久化、压缩、恢复、隔离、遥测等生产级增强 | 直接驱动 agent loop |
| `contracts / policies` | 定义标准 record 与 event envelope、统一策略入口 | 具体实现细节 |
| `tools` | 把 shell / git / mcp 纳入统一注册表，提供权限元数据与 schema | 工具实现的具体逻辑 |

### 实施原则

1. **不重写已有能力，而是收口边界** — 优先把现有实现收敛到正确分层，不追求“大搬家”
2. **先建 contract，再迁消费方** — 先建立稳定 `record` 和 event envelope，再推动 WS 与前端消费迁移
3. **兼容迁移，不做破坏式切换** — 新目录承接实现，旧路径保留兼容导出
4. **文档只写真实状态** — 不把“想做的点”写成“已经完成”

### 事件统一：Runtime Event Envelope

所有运行时事件经过统一 envelope，由 Web Panel 通过 `onRuntimeEvent()` 单一入口消费：

```text
turn:start  →  tool:invoked  →  tool:result  →  turn:end
session:created / session:resumed / session:closed
task:started / task:progress / task:completed / task:notification
worktree:diff / worktree:merge
compression:applied / compression:stats
```

## 工作原理

### 一次 Agent Turn 的完整链路

```
用户消息
  │
  ▼
commands/agent.js  →  解析参数、选择入口
  │
  ▼
runtime-factory.js  →  构造 AgentRuntime + RuntimeContext
  │
  ▼
AgentRuntime.runTurn()
  │
  ├─► 发出 turn:start (envelope: { type, ts, sessionId, ... })
  │
  ├─► policies/agent-policy.js  →  策略校验
  │
  ├─► tools/registry.js  →  按 descriptor 调用工具
  │       │
  │       ├─► tool-context.js  注入运行上下文
  │       ├─► tool-permissions.js  权限检查
  │       └─► tool-telemetry.js  采集 metadata
  │
  ├─► harness/prompt-compressor.js  →  必要时压缩上下文
  │
  ├─► harness/jsonl-session-store.js  →  持久化 session-record
  │
  └─► 发出 turn:end (envelope: { type, ts, sessionId, result, ... })
       │
       ▼
gateways/ws/message-dispatcher.js  →  广播到所有订阅者
       │
       ▼
Web Panel onRuntimeEvent()  →  统一更新 store
```

### 三种消息边界

| 类型 | 用途 | 通道 | 示例 |
|------|------|------|------|
| **协议响应** | 一次性请求/响应 | `gateways/ws/*-protocol.js` | `session-list-result` |
| **Runtime Event** | 订阅型流式事件 | `runtime-events.js` envelope | `turn:start / task:notification` |
| **Session Stream** | 高频会话内容流 | 直连 session stream | `chat.js` 文本增量 |

三类消息边界明确，不互相取代——session stream 不进 runtime event 以避免高频抢占主流，协议响应不发 envelope 以避免双倍解析开销。

## 实施进度

### Phase 1 已完成：Runtime 骨架落地

- 新增 `packages/cli/src/runtime/agent-runtime.js`
- 新增 `packages/cli/src/runtime/runtime-factory.js`
- 新增 `packages/cli/src/runtime/runtime-context.js`
- 新增 `packages/cli/src/runtime/runtime-events.js`
- 新增 `packages/cli/src/runtime/policies/agent-policy.js`
- `agent / chat / serve / ui` 命令统一通过 runtime factory 收口

### Phase 2 已完成：Gateway 与 Runtime 解耦

- 新增 `packages/cli/src/gateways/repl/`、`gateways/ws/`、`gateways/ui/`
- `ws-server` 已拆分为：
  - `message-dispatcher.js`
  - `session-protocol.js`
  - `task-protocol.js`
  - `worktree-protocol.js`
  - `action-protocol.js`
- `ws-server` 收敛为“连接管理 + 分发入口”

### Phase 3 已完成：Harness 分层迁移

迁入 `packages/cli/src/harness/` 的模块：

- `feature-flags.js`
- `compression-telemetry.js`
- `prompt-compressor.js`
- `jsonl-session-store.js`
- `background-task-manager.js`
- `background-task-worker.js`
- `worktree-isolator.js`

### Phase 4 已完成：State / Contract / Event 统一

- runtime contracts 全部落地（`agent-turn / session-record / task-record / worktree-record / telemetry-record`）
- `AgentRuntime.runTurn()` 已发出标准 `turn:start / turn:end`
- `session-protocol.js` 为 `session-created / session-resumed / session-close` 统一构造 `record`
- `session-list-result` 也返回标准 `record`
- Web Panel `stores/ws.js`、`stores/tasks.js`、`stores/chat.js`、`stores/dashboard.js`、`views/Dashboard.vue` 全部接入 `onRuntimeEvent()`

### Phase 5 已完成：Tool Registry 正规化

- `tools/` 基础目录已建立（`registry / tool-context / tool-permissions / tool-telemetry`）
- Tool Descriptor 已定义（`name / kind / schema / permission / telemetry tags`）
- `shell / git / mcp` 三类工具完成首批纳管，runtime 通过统一入口识别并附带 metadata
- Tool Registry 单测 + 集成测试覆盖主路径，metadata 已进入 runtime event envelope

## 关键文件

| 文件 | 作用 |
|------|------|
| `packages/cli/src/runtime/agent-runtime.js` | Runtime 主驱动，提供 `runTurn / resumeSession / startUiServer` |
| `packages/cli/src/runtime/runtime-factory.js` | 命令入口统一构造 runtime 实例 |
| `packages/cli/src/runtime/runtime-events.js` | 事件 envelope 与订阅入口 |
| `packages/cli/src/runtime/contracts/session-record.js` | 会话标准 record 模型 |
| `packages/cli/src/gateways/ws/message-dispatcher.js` | WS 消息统一分发 |
| `packages/cli/src/gateways/ws/session-protocol.js` | 会话协议处理与 record 构造 |
| `packages/cli/src/harness/prompt-compressor.js` | 上下文压缩 |
| `packages/cli/src/harness/jsonl-session-store.js` | 会话持久化 |
| `packages/cli/src/tools/registry.js` | 统一工具注册表 |
| `packages/web-panel/src/stores/ws.js` | Web Panel 统一 runtime event 订阅入口 |

## 测试覆盖率

### 单元测试

```
✅ ws-runtime-events.test.js          - 2 测试 (envelope 构造 + 订阅入口)
✅ tools-registry.test.js             - 6 测试 (descriptor 注册/查询/权限/telemetry)
✅ agent-core.test.js                 - 66 测试 (runTurn / resumeSession / state)
✅ message-dispatcher.test.js         - WS 分发回归
✅ ws-agent-handler.test.js           - 协议处理回归
✅ ws-session-manager.test.js         - session 协议回归
```

### 集成测试

```
✅ ws-session-workflow                - 16 测试 (create / resume / list / close)
✅ Web Panel ws-store.test.js         - 27 测试 (runtime event 订阅 + record 映射)
```

### 验证结果（v5.0.2.10）

| 验证项 | 结果 |
|--------|------|
| CLI `ws-runtime-events` 定向单测 | ✅ 2/2 |
| CLI `tools-registry` 定向单测 | ✅ 6/6 |
| CLI `agent-core` 定向单测 | ✅ 66/66 |
| CLI `ws-session-workflow` 集成 | ✅ 16/16 |
| CLI 本轮定向合计 | ✅ 90/90 |
| Web Panel 定向单元 | ✅ 27/27 |
| Web Panel 构建 | ✅ 通过 |
| Docs Site 构建 | ✅ 通过 |

## 配置参考

### Runtime Factory 选项

```javascript
// packages/cli/src/runtime/runtime-factory.js
createRuntime({
  mode: "agent",                    // agent | chat | serve | ui
  sessionId: null,                  // 恢复指定会话
  workingDir: process.cwd(),
  policies: {
    autonomous: false,              // 自主模式（跳过 plan 批准）
    planMode: true,                 // 启用 plan mode
    maxTurns: 50,                   // 单次会话最大轮次
  },
  harness: {
    enableCompression: true,        // 启用上下文压缩
    enableJsonlStore: true,         // 启用 JSONL session 持久化
    compressionThreshold: 8000,     // 压缩触发阈值（token）
  },
})
```

### WebSocket Gateway 选项

```javascript
// packages/cli/src/gateways/ws/index.js
{
  port: 18800,
  host: "127.0.0.1",
  token: process.env.CC_WS_TOKEN,   // 认证 token
  emitRuntimeEvents: true,          // 是否广播 runtime event
  protocols: ["session", "task", "worktree", "action"],
}
```

### Tool Descriptor 字段

```javascript
// packages/cli/src/tools/registry.js
{
  name: "shell",
  kind: "shell",                    // shell | git | mcp | filesystem
  schema: { /* JSON schema */ },
  permission: "high",               // low | medium | high
  telemetry: ["cmd", "exit_code", "duration"],
  execute: async (context, args) => { ... },
}
```

## 性能指标

### Runtime 开销

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| `createRuntime()` 实例化 | < 50ms | ~30ms | ✅ |
| `runTurn()` 单轮调度 | < 10ms | ~6ms | ✅ |
| `session-record` 序列化 | < 5ms | ~2ms | ✅ |
| Runtime event envelope 构造 | < 1ms | <1ms | ✅ |
| Tool descriptor 查询 | < 1ms | <1ms | ✅ |

### Gateway 吞吐

| 指标 | 数值 |
|------|------|
| WS 单连接事件吞吐 | 1000+ events/s |
| 并发会话数 | 100+ |
| `message-dispatcher` 单消息分发 | < 0.5ms |
| Session 列表加载（100 条） | < 80ms |

### Harness 资源使用

| 指标 | 数值 |
|------|------|
| `prompt-compressor` 压缩率 | 0.76–0.93 |
| 长对话压缩节省 token | 7–24% |
| `jsonl-session-store` 写入延迟 | < 5ms |
| 兼容导出层运行时开销 | 0（仅 require 别名） |

## 使用示例

### 场景 1：通过统一 runtime factory 启动 agent

```bash
# 通过 agent 命令进入交互式 REPL（走 runtime factory）
chainlesschain agent

# 恢复历史会话（runtime 自动加载 session-record）
chainlesschain agent --session <session-id>
```

`agent / chat / serve / ui` 四个命令都已统一通过 `runtime/runtime-factory.js` 收口，外部使用者无感切换。

### 场景 2：Web Panel 订阅统一 runtime event

```javascript
// packages/web-panel/src/stores/ws.js
import { onRuntimeEvent } from "@/lib/runtime-events";

onRuntimeEvent((event) => {
  switch (event.type) {
    case "session:created":
    case "session:resumed":
      handleSessionRecord(event.record);
      break;
    case "task:notification":
      handleTaskNotification(event.record);
      break;
    case "compression:applied":
      updateCompressionStats(event.record);
      break;
  }
});
```

所有运行时事件经过统一 envelope，前端只需一个订阅入口。

### 场景 3：调用统一 Tool Registry

```javascript
// packages/cli/src/runtime/agent-runtime.js
const tool = toolRegistry.get("shell");
const result = await tool.execute(context, {
  command: "ls -la",
  cwd: workingDir,
});
// result 自动带 metadata 进入 runtime event envelope
```

`shell / git / mcp` 都通过同一个 descriptor 模型描述，`runtime` 不再为每个工具单独写适配代码。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 旧 `lib/` 路径导入仍可用，是否需要迁移 | 兼容导出会保留至少一个版本周期，新代码请直接 `require("packages/cli/src/harness/...")` |
| Web Panel 收不到 runtime event | 确认 `stores/ws.js` 已切换到 `onRuntimeEvent()`；旧 `case "<message-type>"` 分支已废弃 |
| `session-list-result` 字段缺失 | 检查 CLI 版本是否 ≥ v0.45.13，旧版本不带 `record` |
| Tool 执行后 metadata 没出现 | 确认工具已在 `tools/registry.js` 注册并定义 `descriptor.permission` 与 `descriptor.telemetry` |
| `ws-server` 报 dispatcher 找不到 handler | 检查协议消息是否在 `gateways/ws/message-dispatcher.js` 中注册 |

## 安全考虑

### 协议边界

- **Runtime Event vs 协议响应**：runtime event 是订阅型流式事件，协议响应是请求/响应一次性消息；两者经 `runtime-events.js` 统一封装但保持语义边界
- **Session Stream 单独通道**：`chat.js` 的 session stream 为合理保留通道，不强制走 runtime event 以避免高频事件抢占主流

### 兼容层策略

- **导出兼容窗口**：`packages/cli/src/lib/*` 兼容导出会保留至少一个 minor 版本周期，提供迁移缓冲
- **不破坏式切换**：所有重构都先建立新路径再迁移消费方，避免大爆炸式发布
- **测试断言固化**：`ws-runtime-events / tools-registry / agent-core / ws-session-workflow` 四组定向测试覆盖关键边界，回归即拦截

### Tool Registry 权限元数据

- 每个 tool descriptor 必须声明 `permission` 字段（`low / medium / high`）
- `runtime` 在执行前根据 permission 决定是否需要 plan mode 或二次确认
- `telemetry tags` 字段支持按工具类型聚合调用量与成功率，便于审计

## 后续工作

本轮核对后，原先列出的 Phase 4 / Phase 5 未完成项已全部收尾。后续工作转入：

- 兼容层收缩：逐步移除 `packages/cli/src/lib/*` 中的兼容导出
- Metadata 消费扩展：把 tool metadata 进一步暴露到 Web Panel 工具面板
- 常规回归维护：每轮发布前跑 `ws-runtime-events / tools-registry / agent-core` 三组定向单测

## 相关文档

- [Agent 架构优化系统](./agent-optimization)
- [Minimal Coding Agent 实施计划](./minimal-coding-agent-plan)
- [Web 管理面板](./cli-ui)
- [WebSocket 服务](./cli-serve)
- [设计模块 78：CLI Agent Runtime 重构计划（完整版）](/design/modules/78-cli-agent-runtime)
