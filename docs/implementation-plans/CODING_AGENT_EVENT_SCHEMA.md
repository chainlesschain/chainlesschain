# Coding Agent 事件协议

## 1. 文档信息

- 项目: `chainlesschain`
- 模块: Coding Agent
- 日期: `2026-04-08`
- 阶段: Phase 0
- 状态: Draft

## 2. 目标

定义一套可同时服务于 CLI Runtime、Electron Main、Renderer 的统一事件协议，避免三端各自发明一套消息格式。

事件协议要解决四个问题：

1. 会话生命周期如何表示
2. 模型文本输出如何流式传输
3. 工具调用与结果如何结构化表达
4. 权限审批、错误、完成状态如何被前端稳定消费

## 3. 设计原则

- 一个事件信封，所有事件共用
- 事件类型稳定，负载可扩展
- 优先面向流式 UI，而不是一次性 RPC
- 允许 CLI 与 Desktop 共享同一协议
- 错误和拒绝也必须是结构化事件，不能只靠字符串

## 4. 统一事件信封

所有事件统一使用以下结构：

```json
{
  "version": "1.0",
  "sessionId": "sess_xxx",
  "requestId": "req_xxx",
  "eventId": "evt_xxx",
  "type": "assistant.delta",
  "timestamp": 1775600000000,
  "source": "cli-runtime",
  "sequence": 12,
  "payload": {},
  "meta": {}
}
```

## 5. 字段定义

### 5.1 顶层字段

- `version`
  - 协议版本，初始为 `1.0`
- `sessionId`
  - 会话标识，贯穿整个 agent session
- `requestId`
  - 单次用户输入的请求标识，用于区分同一会话中的不同轮次
- `eventId`
  - 当前事件唯一标识
- `type`
  - 事件类型
- `timestamp`
  - 事件生成时间戳，毫秒
- `source`
  - 事件来源，推荐值：
  - `renderer`
  - `desktop-main`
  - `cli-runtime`
  - `tool`
- `sequence`
  - 当前 `requestId` 下的递增序号
- `payload`
  - 事件数据
- `meta`
  - 扩展字段，例如耗时、traceId、model、权限级别

### 5.2 约束

- 同一 `requestId` 内，`sequence` 必须单调递增
- `sessionId` 和 `requestId` 不允许为空
- `payload` 必须是对象
- `type` 必须来自本文定义的白名单

## 6. 事件类型

## 6.1 会话生命周期

### `session.started`

会话创建成功。

```json
{
  "payload": {
    "sessionId": "sess_001",
    "mode": "interactive",
    "workspace": "C:\\code\\chainlesschain"
  }
}
```

### `session.resumed`

从持久化存储恢复历史会话。

### `session.interrupted`

当前请求被用户或系统中断。

### `session.completed`

本轮请求完成，但会话仍可继续。

### `session.closed`

整个会话结束。

## 6.2 用户请求生命周期

### `request.accepted`

主进程或 runtime 已接受用户输入，开始处理。

### `request.rejected`

请求被直接拒绝，例如参数错误、会话不存在、权限前置校验失败。

## 6.3 Assistant 输出

### `assistant.message`

一次完整消息，常用于非流式降级模式。

### `assistant.delta`

流式增量文本。

```json
{
  "payload": {
    "text": "正在分析代码结构..."
  }
}
```

### `assistant.thought-summary`

可选事件，只输出对用户可见的简短思路摘要，不暴露内部推理全文。

### `assistant.final`

本轮最终文本结果。

## 6.4 计划模式

### `plan.started`

进入计划生成阶段。

### `plan.updated`

计划步骤更新。

```json
{
  "payload": {
    "planId": "plan_001",
    "steps": [
      { "id": "s1", "title": "阅读相关文件", "status": "completed" },
      { "id": "s2", "title": "修改 IPC 注册逻辑", "status": "in_progress" },
      { "id": "s3", "title": "补测试", "status": "pending" }
    ]
  }
}
```

### `plan.approval_required`

计划已生成，等待用户批准。

### `plan.approved`

用户批准执行。

### `plan.rejected`

用户拒绝执行。

## 6.5 工具调用

### `tool.call.started`

开始调用工具。

```json
{
  "payload": {
    "toolCallId": "tool_001",
    "toolName": "read_file",
    "arguments": {
      "path": "packages/cli/src/runtime/runtime-factory.js"
    },
    "permissionLevel": "read"
  }
}
```

### `tool.call.progress`

可选进度事件，用于长时间运行工具。

### `tool.call.completed`

工具执行成功完成。

### `tool.call.failed`

工具执行失败。

### `tool.call.skipped`

工具由于策略、上下文、缓存等原因未执行。

## 6.6 权限与审批

### `approval.requested`

需要用户明确批准的操作。

```json
{
  "payload": {
    "approvalId": "appr_001",
    "reason": "即将执行 shell 命令修改工作区文件",
    "actionType": "shell.execute",
    "riskLevel": "high",
    "command": "npm run test:jest",
    "scope": ["process:spawn", "filesystem:workspace"]
  }
}
```

### `approval.granted`

### `approval.denied`

### `approval.expired`

## 6.7 上下文与压缩

### `context.compaction.started`

开始压缩上下文。

### `context.compaction.completed`

压缩完成，并返回摘要信息。

## 6.8 错误与告警

### `warning`

非致命告警。

### `error`

结构化错误。

```json
{
  "payload": {
    "code": "TOOL_PERMISSION_DENIED",
    "message": "当前模式不允许执行写操作",
    "retryable": false,
    "details": {
      "toolName": "edit_file"
    }
  }
}
```

## 7. Renderer 消费约定

Renderer 至少要正确处理以下事件：

- `request.accepted`
- `assistant.delta`
- `assistant.final`
- `plan.updated`
- `plan.approval_required`
- `tool.call.started`
- `tool.call.completed`
- `tool.call.failed`
- `approval.requested`
- `approval.granted`
- `approval.denied`
- `error`
- `session.completed`

UI 行为建议：

- `assistant.delta` 直接拼接显示
- `tool.call.started` 与 `tool.call.completed` 形成成对的操作卡片
- `approval.requested` 弹出确认对话框
- `plan.updated` 渲染步骤列表，而不是纯文本
- `error` 与 `warning` 分开显示

## 8. CLI 与 Desktop 映射建议

### CLI Runtime

负责产生原始事件：

- session 相关
- assistant 输出
- tool 调用
- plan 流程
- 压缩事件

### Desktop Main

负责补充宿主信息并转发：

- Electron IPC requestId
- UI 审批结果
- 本地权限门控结果
- 桌面端上下文信息

### Renderer

只做展示、用户交互和最小状态管理，不做协议再解释。

## 9. 错误码建议

推荐首批错误码：

- `SESSION_NOT_FOUND`
- `REQUEST_INVALID`
- `TOOL_NOT_REGISTERED`
- `TOOL_PERMISSION_DENIED`
- `PLAN_APPROVAL_REQUIRED`
- `PLAN_REJECTED`
- `TOOL_EXECUTION_FAILED`
- `MCP_SERVER_UNAVAILABLE`
- `SESSION_PERSISTENCE_FAILED`
- `CONTEXT_COMPACTION_FAILED`
- `RUNTIME_INTERNAL_ERROR`

## 10. 第一版不做的事

以下内容不进入 `v1.0` 事件协议：

- 多代理团队专用事件
- 语音流事件
- 图像块传输事件
- 浏览器自动化视频流事件
- 细粒度 token 计费明细事件

这些能力后续通过新增 `type` 扩展，不在第一版协议里预埋复杂结构。

## 11. 验收标准

- CLI 和 Desktop 使用同一事件信封
- Renderer 不需要依赖字符串解析工具输出
- 权限审批有独立事件类型
- 计划模式有独立事件类型
- 错误事件带稳定错误码

