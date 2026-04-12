# WebSocket 服务（serve）

> `chainlesschain serve` 用于把 CLI 能力通过 WebSocket 暴露给浏览器端、IDE 插件、自动化脚本和其他前端。当前文档已对齐 Runtime / Gateway 重构、统一 runtime event、session record、后台任务、Worktree 和压缩观测的最新实现。

## 概述

`chainlesschain serve` 启动一个 WebSocket 服务器，将 CLI 全部 60+ 命令通过统一的 WS 协议对外暴露。它不是一个简单的命令转发层，而是 CLI Runtime 的 WS Gateway，支持命令缓冲执行与流式执行、有状态的 Agent/Chat 会话管理、后台任务调度与通知、Worktree 预览与合并，以及压缩观测统计。

任何能建立 WebSocket 连接的客户端（浏览器、IDE 插件、自动化脚本、移动端）都可以通过此服务驱动 CLI 的全部能力，无需直接操作命令行。

## 核心特性

- **命令执行双模式**: `execute`（缓冲模式，等待完成后一次性返回结果）和 `stream`（流式模式，逐片段推送输出）
- **Token 认证**: 客户端连接后需先发送 `auth` 消息通过认证，远程访问时必须配合 `--token`
- **心跳保活**: 30 秒间隔的 `ping/pong` 心跳检测，自动断开无响应的死连接
- **命令注入防护**: 内置 `tokenizeCommand` 安全分词器，不使用 `shell: true`，阻止 shell 注入攻击
- **有状态会话**: 支持 Agent/Chat 两种会话类型的创建、恢复、消息发送、中断和关闭，会话状态通过 Session Record 统一管理
- **后台任务**: 任务列表、详情、历史分页、停止操作，以及任务完成/失败的实时通知
- **Worktree 协议**: Git worktree 的 diff 预览、merge 操作、冲突摘要和自动化建议
- **压缩观测**: 按 provider/model 维度的压缩命中率、节省 token 数、策略分布等统计数据
- **最大连接数**: 默认最多 10 个并发连接，可通过 `--max-connections` 调整
- **命令超时**: 默认 30 秒超时，可通过 `--timeout` 调整
- **命令黑名单**: `serve`、`chat`、`agent`、`setup` 等交互式命令被禁止通过 WS 执行

## 系统架构

```
Client (浏览器/IDE/脚本)
    │
    ▼ WebSocket (ws://127.0.0.1:18800)
    │
┌───┴──────────────────────────────────────┐
│  ChainlessChainWSServer (ws-server.js)   │
│  ├── message-dispatcher.js   消息分发     │
│  ├── session-protocol.js     会话协议     │
│  ├── action-protocol.js      指令协议     │
│  ├── task-protocol.js        任务协议     │
│  └── worktree-protocol.js    Worktree     │
├──────────────────────────────────────────┤
│  ws-session-gateway.js                   │
│  └── ws-agent-handler.js  Agent 会话桥接  │
├──────────────────────────────────────────┤
│  CLI Runtime (60+ commands)              │
│  └── spawn child process (bin/cc.js)     │
└──────────────────────────────────────────┘
```

- **ws-server.js**: WebSocket 服务器主体，管理连接、认证、心跳、消息路由
- **message-dispatcher.js**: 根据消息 `type` 分发到对应的协议处理器
- **session-protocol.js**: 处理 Agent/Chat 会话的全生命周期（create/resume/message/close/interrupt/answer 等）
- **action-protocol.js**: 处理 slash 命令和 orchestrate 调度
- **task-protocol.js**: 处理后台任务的 detail 和 history 查询
- **worktree-protocol.js**: 处理 worktree diff/merge/compression 等 Git 相关协议
- **ws-agent-handler.js**: Agent 会话的运行时桥接，将 WS 消息转换为 Agent Runtime 调用

## 适用场景

`chainlesschain serve` 适合以下几类接入：

- Web Panel 作为前端界面，复用本地 CLI 的会话、任务和观测能力。
- IDE 或编辑器插件通过 WS 驱动 Agent / Chat 会话。
- 自动化脚本、CI/CD、远程控制流程通过统一协议调度 CLI。
- 需要把命令执行、流式输出和有状态会话放到同一个本地服务里。

它的定位不是单纯的“命令执行器”，而是 CLI Runtime 的 WS Gateway。

## 默认行为

- 默认监听 `127.0.0.1`
- 支持 token 认证
- 支持缓冲模式与流式模式命令执行
- 支持 Agent / Chat 有状态 session
- 支持后台任务查询、任务历史和实时通知
- 支持 Worktree diff 预览与一键合并协议
- 支持压缩观测统计

## 使用示例

### 基本启动

```bash
# 默认配置 (127.0.0.1:18800, 无认证)
chainlesschain serve

# 自定义端口
chainlesschain serve --port 9000

# 带 token 认证
chainlesschain serve --token my-secret-token

# 远程访问 (必须配合 --token)
chainlesschain serve --allow-remote --token my-secret-token

# 完整参数示例
chainlesschain serve --port 9000 --host 0.0.0.0 --token secret --max-connections 20 --timeout 60000 --project /path/to/project
```

### 命令选项

```
Options:
  -p, --port <port>           端口号 (默认: 18800)
  -H, --host <host>           绑定地址 (默认: 127.0.0.1)
  --token <token>             认证 token (远程访问时必填)
  --max-connections <n>       最大并发连接数 (默认: 10)
  --timeout <ms>              命令执行超时毫秒数 (默认: 30000)
  --allow-remote              允许非 localhost 连接 (需配合 --token)
  --project <path>            会话的默认项目根目录
```

### 客户端连接示例

```javascript
const ws = new WebSocket("ws://127.0.0.1:18800");

// 1. 认证 (如果服务端设置了 --token)
ws.send(JSON.stringify({ id: "1", type: "auth", token: "my-secret-token" }));

// 2. 执行命令 (缓冲模式)
ws.send(JSON.stringify({ id: "2", type: "execute", command: "note list --json" }));

// 3. 流式执行
ws.send(JSON.stringify({ id: "3", type: "stream", command: "search keyword" }));

// 4. 取消执行
ws.send(JSON.stringify({ id: "4", type: "cancel", id: "3" }));
```

建议：

- 仅本机联调时直接使用默认配置。
- 允许远程访问时始终配合 `--token`。
- 与 `chainlesschain ui` 搭配时，通常无需手工启动，它会自动带起内置 WS 服务。

## 协议总览

当前协议可以理解为 4 层：

1. 基础控制协议
2. Session 协议
3. 后台任务协议
4. Worktree / Compression 协议

## 1. 基础控制协议

### Client → Server

| type | 说明 | 额外字段 |
|------|------|----------|
| `auth` | 认证 | `token` |
| `ping` | 心跳 | — |
| `execute` | 缓冲模式执行命令 | `command` |
| `stream` | 流式模式执行命令 | `command` |
| `cancel` | 取消请求 | `id` |

### Server → Client

| type | 说明 |
|------|------|
| `auth-result` | 认证结果 |
| `pong` | 心跳响应 |
| `result` | 命令执行结果 |
| `stream-data` | 流式输出片段 |
| `stream-end` | 流结束 |
| `error` | 错误响应 |

## 2. Session 协议

### 常用消息

| type | 说明 | 额外字段 |
|------|------|----------|
| `session-create` | 创建 agent/chat 会话 | `sessionType`, `provider`, `model`, `apiKey`, `baseUrl`, `projectRoot` |
| `session-resume` | 恢复会话 | `sessionId` |
| `session-message` | 发送消息 | `sessionId`, `content` |
| `session-list` | 列出会话 | — |
| `session-close` | 关闭会话 | `sessionId` |
| `slash-command` | 发送 slash 命令 | `sessionId`, `command` |
| `session-answer` | 回答交互式问题 | `sessionId`, `requestId`, `answer` |

### 创建会话示例

请求：

```json
{
  "id": "1",
  "type": "session-create",
  "sessionType": "agent",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "projectRoot": "C:/code/demo"
}
```

响应：

```json
{
  "id": "1",
  "type": "session-created",
  "sessionId": "session-123",
  "sessionType": "agent",
  "record": {
    "id": "session-123",
    "type": "agent",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "projectRoot": "C:/code/demo",
    "messageCount": 0,
    "history": [],
    "status": "created"
  }
}
```

### 恢复会话示例

请求：

```json
{
  "id": "2",
  "type": "session-resume",
  "sessionId": "session-123"
}
```

响应：

```json
{
  "id": "2",
  "type": "session-resumed",
  "sessionId": "session-123",
  "history": [
    { "role": "user", "content": "hello" }
  ],
  "record": {
    "id": "session-123",
    "type": "agent",
    "messageCount": 1,
    "history": [
      { "role": "user", "content": "hello" }
    ],
    "status": "resumed"
  }
}
```

### 列出会话示例

请求：

```json
{
  "id": "3",
  "type": "session-list"
}
```

响应中的 `sessions[]` 现在每项都会带 `record`，用于让前端和 WS 层共享统一的会话摘要结构。

### Session 流式事件

运行过程中常见的服务端消息包括：

- `tool-executing`
- `tool-result`
- `response-token`
- `response-complete`
- `question`

## Session Record

当前标准 session summary 结构如下：

```json
{
  "id": "session-123",
  "type": "agent",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "projectRoot": "C:/code/demo",
  "messageCount": 3,
  "history": [
    { "role": "user", "content": "hello" }
  ],
  "status": "resumed"
}
```

这个结构当前已经贯通：

- `session-created`
- `session-resumed`
- `session-list-result`

## 3. 后台任务协议

| type | 说明 |
|------|------|
| `tasks-list` | 返回任务列表 |
| `tasks-detail` | 返回任务详情，含 `outputSummary` |
| `tasks-history` | 返回任务历史，支持 `offset` / `limit` |
| `tasks-stop` | 停止任务 |
| `task:notification` | 任务完成或失败时的实时通知 |

这部分能力已不只是“列任务”，还承担：

- 重启恢复后的任务可见性
- 历史分页检索
- 输出摘要查询
- 前端实时通知

## 4. Worktree 协议

| type | 说明 |
|------|------|
| `worktree-list` | 列出 worktree |
| `worktree-diff` | 返回 diff 预览与 `record` |
| `worktree-merge` | 返回 merge 结果、冲突摘要和预览入口 |

当前 worktree 返回值已开始统一带：

- `record`
- `previewEntrypoints`
- `automationCandidates`

也就是说，前端不再只能收到一个“成功/失败”字符串，而是能拿到更细粒度的文件级摘要和建议操作。

## 5. 压缩观测协议

| type | 说明 |
|------|------|
| `compression-stats` | 返回压缩摘要，支持 `windowMs`、`provider`、`model` |

当前可观测数据包括：

- 压缩命中率
- 节省 token
- 净节省率
- 策略分布
- 变体分布
- 按 `provider` / `model` 维度切片

## 统一 Runtime Event

WS 协议层已经开始同步发出标准 runtime event，主要包括：

- `session:start`
- `session:resume`
- `session:end`
- `session:message`
- `task:notification`
- `worktree:diff:ready`
- `worktree:merge:completed`
- `compression:summary`

Web Panel 现在会通过 `onRuntimeEvent()` 统一消费这套事件，而不是每个页面都直接理解所有原始协议消息。

## 三类消息的区别

为了避免联调时把不同类型的消息混在一起，当前建议按下面三类理解：

### 1. 协议响应

这类消息回答的是“某次请求返回了什么”，通常和请求 `id` 对应。

典型包括：

- `session-created`
- `session-resumed`
- `session-list-result`
- `tasks-list`
- `tasks-detail`
- `tasks-history`
- `worktree-diff`
- `worktree-merged`
- `compression-stats`

### 2. Runtime Event

这类消息回答的是“系统状态发生了什么变化”，由前端统一通过 `onRuntimeEvent()` 消费。

典型包括：

- `session:start`
- `session:resume`
- `session:end`
- `task:notification`
- `worktree:diff:ready`
- `worktree:merge:completed`
- `compression:summary`

### 3. Session Stream

这类消息回答的是“当前会话正在流式输出什么”，主要属于会话专用通道。

典型包括：

- `response-token`
- `response-complete`
- `tool-executing`
- `tool-result`
- `question`

当前口径是：

- `ws.js` 负责把协议响应归一化为 runtime event
- `chat.js` 继续直接消费 session stream
- 不要求所有流式消息都迁到统一事件模型

## 与 `ui` 的关系

- `serve` 是 WS Gateway，本身不负责页面展示。
- `ui` 会自动启动 HTTP 服务和内置 WS 服务。
- 如果你只是想用浏览器面板，优先使用 `chainlesschain ui`。
- 如果你要把 CLI 接到外部前端或插件，优先使用 `chainlesschain serve`。

## 调试建议

联调 WS 时，优先检查下面几项：

- 是否开启了 token，但客户端没有先发 `auth`
- 当前消息是“协议响应”还是“runtime event”
- 会话类消息是否已经带上 `record`
- `session-list-result.sessions[]` 是否已被前端归一化
- `tasks-history` 是否传了分页参数
- `compression-stats` 是否传了 `windowMs` / `provider` / `model`

## 当前验证

- `ws-runtime-events.test.js`：`2/2`
- `ws-session-workflow.test.js`：`16/16`
- `ws-server.test.js`：相关回归已通过

## 安全说明

- 默认仅监听 `127.0.0.1`
- 开启远程访问时应始终配合 `--token`
- `serve` 内部不使用 `shell: true`
- 命令执行仍保留超时、最大连接数和心跳保护

## 故障排查

### 端口被占用

**症状**: `Error: listen EADDRINUSE :::18800`

**解决方案**:

```bash
# 检查占用进程
# Windows
netstat -ano | findstr :18800
# Linux/macOS
lsof -i :18800

# 使用其他端口
chainlesschain serve --port 9000
```

### 认证失败

**症状**: 客户端收到 `{ type: "auth-result", success: false }` 或连接立即被关闭

**排查步骤**:

1. 确认服务端启动时是否设置了 `--token`
2. 确认客户端在连接后第一条消息是 `{ type: "auth", token: "..." }`
3. 确认 token 值完全匹配（区分大小写）
4. 未启用 token 时无需发送 auth 消息

### 连接断开 / 心跳超时

**症状**: 客户端频繁断开连接

**排查步骤**:

1. 检查客户端是否正确响应 `ping` 消息（应回复 `pong`）
2. 心跳间隔为 30 秒，超过此时间未响应将被断开
3. 检查网络中间件（反向代理、防火墙）是否有 idle 超时设置
4. 确认未超过 `--max-connections` 限制

### 命令执行超时

**症状**: `{ type: "error", message: "Command timed out" }`

**解决方案**:

```bash
# 增加超时时间
chainlesschain serve --timeout 60000

# 对于长时间运行的命令，使用 stream 模式而非 execute 模式
```

### 命令被阻止

**症状**: `{ type: "error", message: "Command blocked" }`

**原因**: `serve`、`chat`、`agent`、`setup` 等交互式命令不允许通过 WS 执行。请使用对应的 session 协议（`session-create` + `session-message`）替代。

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/serve.js` | `serve` 命令注册与参数解析 |
| `packages/cli/src/gateways/ws/ws-server.js` | WebSocket 服务器主体（连接管理、认证、心跳、命令执行） |
| `packages/cli/src/gateways/ws/message-dispatcher.js` | 消息类型分发器 |
| `packages/cli/src/gateways/ws/session-protocol.js` | Agent/Chat 会话协议处理 |
| `packages/cli/src/gateways/ws/ws-session-gateway.js` | 会话网关（会话池管理） |
| `packages/cli/src/gateways/ws/ws-agent-handler.js` | Agent 会话运行时桥接 |
| `packages/cli/src/gateways/ws/action-protocol.js` | Slash 命令和 orchestrate 协议 |
| `packages/cli/src/gateways/ws/task-protocol.js` | 后台任务协议 |
| `packages/cli/src/gateways/ws/worktree-protocol.js` | Worktree 和压缩观测协议 |
| `packages/cli/src/lib/ws-server.js` | 向后兼容的 re-export shim（已废弃） |

## 相关文档

- [Web 管理界面（ui）](/chainlesschain/cli-web-panel) — 基于此 WS 服务的 Vue3 管理面板
- [Agent 架构优化](/chainlesschain/agent-optimization) — Agent 会话内部架构
- [AI Orchestration](/chainlesschain/cli-orchestrate) — 多 AI 后端调度（通过 WS `orchestrate` 协议触发）
- [Coding Agent](/chainlesschain/coding-agent) — 编程 Agent 会话协议详情
- [设计文档索引](/design/) — 完整设计文档
- [设计模块：WebSocket 服务器接口](/design/modules/69-websocket-server) — 详细技术设计
