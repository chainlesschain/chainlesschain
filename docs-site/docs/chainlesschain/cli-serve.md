# WebSocket 服务（serve）

> `chainlesschain serve` 用于把 CLI 能力通过 WebSocket 暴露给浏览器端、IDE 插件、自动化脚本和其他前端。当前文档已对齐 Runtime / Gateway 重构、统一 runtime event、session record、后台任务、Worktree 和压缩观测的最新实现。

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

## 启动方式

```bash
chainlesschain serve
chainlesschain serve --port 9000
chainlesschain serve --token my-secret-token
chainlesschain serve --allow-remote --token my-secret-token
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

## 关联文档

- [Web 管理界面（ui）](/chainlesschain/cli-ui)
- [Agent 架构优化](/chainlesschain/agent-optimization)
- [设计文档索引](/design/)
- [设计模块：WebSocket 服务器接口](/design/modules/69-websocket-server)
