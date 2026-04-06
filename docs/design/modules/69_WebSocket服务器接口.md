# 69. WebSocket 服务器接口

**版本**: v5.0.2.10  
**创建日期**: 2026-03-14  
**最近更新**: 2026-04-06  
**状态**: 已实现，且已进入 Runtime / Gateway / Event 统一阶段

---

## 1. 背景

`chainlesschain serve` 为 CLI 提供远程调用入口，使 IDE 插件、Web Panel、自动化脚本和其他前端可以通过 WebSocket 驱动 CLI 能力。

最早版本主要解决两类问题：

1. 无状态命令执行
- 通过 `execute` / `stream` 远程调用任意 CLI 命令

2. 有状态会话
- 通过 `session-create` / `session-message` / `session-resume` / `session-close` 远程控制 Agent / Chat 会话

随着 CLI Agent Runtime 重构推进，WS 层已经不再只是“命令转发器”，而是开始承担：

- Session 协议网关
- Background Task 协议网关
- Worktree 协议网关
- Compression Telemetry 协议网关
- Runtime Event 发射点

也就是说，这一层现在已经属于 `gateways/ws`，而不是零散地散布在 `lib/ws-server.js` 里的巨大消息 `switch`。

---

## 2. 设计目标

### 2.1 零侵入暴露 CLI 能力

不要求每个 CLI 命令都单独开发 API，而是尽量复用已有 CLI 行为与现有 session 逻辑。

### 2.2 本地优先、安全优先

- 默认只监听 `127.0.0.1`
- 支持 token 认证
- 使用 shell-safe tokenizer
- 禁止通过 WS 直接走交互式或递归危险命令

### 2.3 从协议消息过渡到统一事件模型

WS 层需要同时兼容两种消费方式：

1. 协议响应
- 给请求方直接返回结构化结果

2. Runtime Event
- 给 Web Panel、未来订阅层、日志层和审计层提供统一事件流

### 2.4 与 Runtime 分层对齐

当前 CLI Agent Runtime 的目标分层为：

- `commands`
- `runtime`
- `gateways`
- `harness`
- `contracts / policies`
- `tools`

WS 层对应其中的 `gateways/ws`，它的职责应当是：

- 连接管理
- 鉴权
- 消息分发
- 协议适配
- 标准事件发射

而不是直接堆放业务逻辑。

---

## 3. 当前代码结构

当前实现已经从单一大文件逐步拆分为以下结构。

### 3.1 入口容器

- `packages/cli/src/lib/ws-server.js`
- `packages/cli/src/gateways/ws/ws-server.js`

当前角色：

- 连接管理
- 认证
- 消息接收
- 委托 dispatcher 和 protocol handler

### 3.2 协议拆分

- `packages/cli/src/gateways/ws/message-dispatcher.js`
- `packages/cli/src/gateways/ws/session-protocol.js`
- `packages/cli/src/gateways/ws/task-protocol.js`
- `packages/cli/src/gateways/ws/worktree-protocol.js`
- `packages/cli/src/gateways/ws/action-protocol.js`

### 3.3 相关 Runtime Contract

- `packages/cli/src/runtime/contracts/session-record.js`
- `packages/cli/src/runtime/contracts/task-record.js`
- `packages/cli/src/runtime/contracts/worktree-record.js`
- `packages/cli/src/runtime/contracts/telemetry-record.js`
- `packages/cli/src/runtime/runtime-events.js`

### 3.4 相关 Harness

- `packages/cli/src/harness/background-task-manager.js`
- `packages/cli/src/harness/worktree-isolator.js`
- `packages/cli/src/harness/compression-telemetry.js`

### 3.5 前端消费层

- `packages/web-panel/src/stores/ws.js`
- `packages/web-panel/src/stores/tasks.js`
- `packages/web-panel/src/stores/chat.js`
- `packages/web-panel/src/stores/dashboard.js`

前端侧当前已经开始通过 `onRuntimeEvent()` 统一消费 WS 层归一化后的事件。

---

## 4. 协议分层

当前 WS 协议可以分为四类。

### 4.1 基础控制协议

| type | 说明 |
|------|------|
| `auth` | 认证 |
| `ping` | 心跳 |
| `execute` | 缓冲模式执行命令 |
| `stream` | 流式模式执行命令 |
| `cancel` | 取消正在执行的请求 |

### 4.2 Session 协议

| type | 说明 |
|------|------|
| `session-create` | 创建 Agent / Chat 会话 |
| `session-resume` | 恢复历史会话 |
| `session-message` | 向会话发送消息 |
| `session-list` | 列出会话 |
| `session-close` | 关闭会话 |
| `session-answer` | 回答交互式问题 |
| `slash-command` | 向 session 发送 slash command |

### 4.3 Background Task 协议

| type | 说明 |
|------|------|
| `tasks-list` | 列出后台任务 |
| `tasks-detail` | 获取任务详情 |
| `tasks-history` | 获取任务历史，支持分页 |
| `tasks-stop` | 停止任务 |
| `task:notification` | 任务完成或失败时实时推送 |

### 4.4 Worktree / Compression 协议

| type | 说明 |
|------|------|
| `worktree-list` | 列出 worktree |
| `worktree-diff` | 获取 diff 预览 |
| `worktree-merge` | 执行合并并返回冲突摘要 |
| `compression-stats` | 获取压缩策略遥测摘要 |

---

## 5. 连接与认证流程

典型握手过程如下：

```text
Client                    Server
  | ---- auth -----------> |
  | <--- auth-result ----- |
  | ---- ping -----------> |
  | <--- pong ------------ |
```

设计要点：

- 若配置了 token，客户端必须先完成 `auth`。
- `auth-result` 负责明确返回成功或失败。
- 心跳由 `ping` / `pong` 维持，避免长连接静默失效。

默认安全策略：

- 默认仅监听 `127.0.0.1`
- 允许远程访问时必须配合 token
- 保留最大连接数、超时与心跳保护

---

## 6. 基础执行协议

### 6.1 `execute`

面向一次性命令调用，适合：

- 查询类命令
- 返回体较短的命令
- 不需要 token 级流式体验的场景

示例：

```json
{
  "id": "exec-1",
  "type": "execute",
  "command": "config features list"
}
```

### 6.2 `stream`

面向流式输出命令，适合：

- 长时间运行命令
- 需要边执行边显示输出
- 需要浏览器或 IDE 持续消费 stdout/stderr 的场景

### 6.3 `cancel`

用于取消已发起但尚未结束的请求，避免客户端断开后服务端仍然保留无意义执行。

---

## 7. Session 协议详解

### 7.1 目标

Session 协议用于支持有状态的 Agent / Chat 工作模式，使前端不只是“执行一条命令”，而是能维持一段持续对话。

### 7.2 `session-create`

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

### 7.3 `session-resume`

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

### 7.4 `session-list`

请求：

```json
{
  "id": "3",
  "type": "session-list"
}
```

响应：

```json
{
  "id": "3",
  "type": "session-list-result",
  "sessions": [
    {
      "id": "session-123",
      "type": "agent",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "messageCount": 1,
      "status": "resumed",
      "record": {
        "id": "session-123",
        "type": "agent",
        "provider": "openai",
        "model": "gpt-4o-mini",
        "messageCount": 1,
        "status": "resumed"
      }
    }
  ]
}
```

### 7.5 `session-message`

发送消息后，服务端会根据会话类型与运行过程返回：

- `response-token`
- `response-complete`
- `tool-executing`
- `tool-result`
- `question`

### 7.6 `session-close`

关闭会话后，协议响应与统一事件流都会同步结束该会话；前端侧也会补发 synthetic `session:end`，保证本地状态流连续。

---

## 8. Session Record 设计

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

统一字段包括：

- `id`
- `type`
- `provider`
- `model`
- `projectRoot`
- `messageCount`
- `history`
- `status`

当前该结构已贯通：

- `session-created`
- `session-resumed`
- `session-list-result`

其作用不只是“多带一个对象”，更重要的是：

- 让 WS 层、Web Panel、Runtime Contract 使用同一套摘要字段
- 降低前端对零散旧字段的依赖
- 为后续日志、审计和订阅层提供稳定结构

---

## 9. Background Task 协议

### 9.1 目标

后台任务协议用于让长时间运行的 CLI 工作流能够脱离前台请求存在，并被前端或其他客户端查询、恢复和停止。

### 9.2 当前能力

- 任务列表查询
- 单任务详情查询
- 任务历史分页查询
- 任务停止
- 完成/失败实时通知

### 9.3 协议项

| type | 说明 |
|------|------|
| `tasks-list` | 返回任务列表 |
| `tasks-detail` | 返回任务详情，含 `outputSummary` |
| `tasks-history` | 返回任务历史，支持 `offset` / `limit` |
| `tasks-stop` | 停止任务 |
| `task:notification` | 任务完成或失败时的实时通知 |

### 9.4 设计意义

后台任务能力已经不只是“列出几个进程”，而是开始接近受控 runtime 能力：

- 可恢复
- 可分页回看历史
- 可拿摘要而不是强迫前端吞下全量输出
- 可在前端实时收到完成通知

---

## 10. Worktree 协议

### 10.1 目标

Worktree 协议用于支撑子 Agent 隔离执行、diff 预览和一键合并流程。

### 10.2 当前协议项

| type | 说明 |
|------|------|
| `worktree-list` | 列出 worktree |
| `worktree-diff` | 返回 diff 预览与 `record` |
| `worktree-merge` | 返回 merge 结果、冲突摘要和预览入口 |

### 10.3 当前返回结构要点

Worktree 返回值已经开始统一包含：

- `record`
- `previewEntrypoints`
- `automationCandidates`

这意味着前端不再只能拿到粗粒度的成功/失败，而是可以展示：

- 文件级冲突摘要
- 自动化解决候选项
- diff 预览入口
- 合并结果建议

---

## 11. 压缩观测协议

### 11.1 目标

压缩观测协议用于把 Prompt Compression 和 A/B 实验结果反馈给 Web Panel 和其他上层消费方。

### 11.2 当前协议项

| type | 说明 |
|------|------|
| `compression-stats` | 返回压缩摘要，支持 `windowMs`、`provider`、`model` |

### 11.3 当前可观测字段

- 压缩命中率
- 节省 token
- 净节省率
- 策略分布
- 变体分布
- 按 `provider` / `model` 切片

---

## 12. 统一 Runtime Event 对齐

WS 协议层现在不再只返回原始响应，也开始同步发出标准 runtime event，主要包括：

- `session:start`
- `session:resume`
- `session:end`
- `session:message`
- `task:notification`
- `worktree:diff:ready`
- `worktree:merge:completed`
- `compression:summary`

这套设计的意义是：

- Web Panel 可通过 `onRuntimeEvent()` 统一消费
- 新页面或新客户端不用分别理解所有细碎协议消息
- 后续日志、审计、通知层可以直接复用统一事件流

## 12.1 三类消息边界

当前 WS 链路里同时存在三类消息，必须明确区分：

### 1. 协议响应

特点：

- 对应某个明确请求
- 通常带请求 `id`
- 主要用于“本次调用返回了什么”

典型示例：

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

特点：

- 是对外暴露的统一事件模型
- 主要用于“系统发生了什么”
- 由 WS 层从协议消息或内部事件归一化后发出

典型示例：

- `session:start`
- `session:resume`
- `session:end`
- `session:message`
- `task:notification`
- `worktree:diff:ready`
- `worktree:merge:completed`
- `compression:summary`

### 3. Session Stream

特点：

- 属于会话内部的流式通道
- 面向当前会话正在进行中的内容流
- 不等同于通用 runtime event

典型示例：

- `response-token`
- `response-complete`
- `tool-executing`
- `tool-result`
- `question`

当前结论：

- `ws.js` 负责把“协议响应”归一化为“runtime event”
- `chat.js` 继续直接消费 `session stream`
- 不应把所有流式 session 消息都强行塞进统一 runtime event

---

## 13. Web Panel 协作关系

当前前端侧已开始围绕 `onRuntimeEvent()` 收口：

- `tasks.js`
- `chat.js`
- `dashboard.js`
- `ws.js`

当前已经归一化的典型消息包括：

- `session-created` → `session:start`
- `session-resumed` → `session:resume`
- `task:notification` → `task:notification`
- `worktree-diff` → `worktree:diff:ready`
- `worktree-merged` → `worktree:merge:completed`
- `compression-stats` → `compression:summary`

这让 WS 协议层开始从“页面一对一耦合接口”转向“统一 Runtime Gateway”。

---

## 14. 错误处理与兼容策略

当前设计采用渐进兼容方式：

- 旧协议响应字段尽量保留
- 新增 `record`、统一事件、不破坏既有前端逻辑
- 对会话关闭等本地状态变化，前端允许补发 synthetic event 保持状态一致

错误处理重点包括：

- 认证失败时立刻拒绝后续操作
- 命令执行保留超时与取消机制
- 任务和合并类操作返回结构化错误，而不是仅返回字符串
- 在 Runtime Contract 推进过程中优先“兼容新增字段”，避免一次性破坏旧客户端

---

## 15. 安全设计

- 默认仅监听 `127.0.0.1`
- 远程访问应始终配合 token
- 不使用 `shell: true`
- 保留最大连接数、心跳和超时保护
- 交互式问题通过 `session-answer` 显式返回，不隐式拼接执行

---

## 16. 关键文件

- `packages/cli/src/lib/ws-server.js`
- `packages/cli/src/gateways/ws/message-dispatcher.js`
- `packages/cli/src/gateways/ws/session-protocol.js`
- `packages/cli/src/gateways/ws/task-protocol.js`
- `packages/cli/src/gateways/ws/worktree-protocol.js`
- `packages/cli/src/gateways/ws/action-protocol.js`
- `packages/cli/src/runtime/runtime-events.js`
- `packages/cli/src/runtime/contracts/session-record.js`
- `packages/web-panel/src/stores/ws.js`

---

## 17. 当前验证

- `packages/cli/__tests__/unit/ws-server.test.js`
- `packages/cli/__tests__/unit/ws-runtime-events.test.js`
- `packages/cli/__tests__/unit/message-dispatcher.test.js`
- `packages/cli/__tests__/unit/action-protocol.test.js`
- `packages/cli/__tests__/integration/ws-session-workflow.test.js`

当前已确认：

- `ws-runtime-events.test.js`：`2/2`
- `ws-session-workflow.test.js`：`16/16`
- `ws-server` 相关回归已通过

---

## 18. 结论

WebSocket 服务器接口当前已经完成了从“本地命令桥接层”到“CLI Runtime Gateway”的第一阶段演进。

它的核心价值不再只是让浏览器能调 CLI，而是：

- 统一承接 Session / Task / Worktree / Compression 四类外部能力暴露
- 向 Web Panel 和其他客户端提供标准化 `record`
- 向上层提供统一 runtime event
- 为后续 CLI Agent Runtime 分层重构提供稳定网关边界

这也是为什么模块 69 不再只是接口文档，而是当前 Runtime 重构的重要基础模块。
