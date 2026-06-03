# Coding Agent 桌面端到 CLI Bridge 时序说明

## 1. 文档信息

- 项目: `chainlesschain`
- 模块: Coding Agent
- 日期: `2026-04-08`
- 阶段: Phase 0
- 状态: Draft

## 2. 目标

定义桌面端 Renderer、Electron Main、CLI Runtime 之间的调用顺序和职责边界。

核心原则：

- Renderer 只负责展示和用户交互
- Desktop Main 负责宿主集成、权限门控、IPC 转发
- CLI Runtime 负责真正的 agent loop、工具调度、会话持久化

## 3. 参与者

- `Renderer`
  - Vue 界面
- `Electron IPC`
  - Renderer 与 Main 间通信通道
- `CodingAgentSessionService`
  - Main 进程里的会话服务
- `CodingAgentBridge`
  - Main 到 CLI Runtime 的适配层
- `CLI Runtime`
  - `packages/cli` 中的 agent runtime
- `Tool Layer`
  - 文件、搜索、shell、git、MCP 等工具
- `Permission Gate`
  - 审批与策略判定

## 4. 总体时序图

```text
Renderer
  -> Electron IPC: coding-agent:start-session
  -> Main/CodingAgentSessionService: create session
  -> CodingAgentBridge: create runtime session
  -> CLI Runtime: session.started
  -> Main: forward session event
  -> Renderer: show session ready

Renderer
  -> Electron IPC: coding-agent:send-message
  -> Main/CodingAgentSessionService: validate request
  -> Permission Gate: preflight check
  -> CodingAgentBridge: submit request
  -> CLI Runtime: request.accepted
  -> CLI Runtime: assistant.delta
  -> CLI Runtime: tool.call.started
  -> Main: forward event stream
  -> Renderer: render output and tool progress

If approval required:
  CLI Runtime/Main -> Renderer: approval.requested
  Renderer -> Main: coding-agent:approve-action / deny-action
  Main -> CLI Runtime: approval result
  CLI Runtime -> Main -> Renderer: continue stream

On completion:
  CLI Runtime -> Main: assistant.final + session.completed
  Main -> Renderer: final result
```

## 5. 详细流程

## 5.1 创建会话

Renderer 发起：

- IPC: `coding-agent:start-session`

建议参数：

```json
{
  "workspacePath": "C:\\code\\chainlesschain",
  "mode": "interactive",
  "resumeSessionId": null
}
```

Main 侧处理：

1. 校验工作区路径
2. 创建 `sessionId`
3. 初始化 `CodingAgentSessionService`
4. 通过 `CodingAgentBridge` 创建 CLI runtime session
5. 把 `session.started` 事件转发给 Renderer

## 5.2 发送用户消息

Renderer 发起：

- IPC: `coding-agent:send-message`

建议参数：

```json
{
  "sessionId": "sess_001",
  "message": "帮我分析 code-agent 的 IPC 入口并给出重构方案"
}
```

Main 侧处理：

1. 校验 `sessionId`
2. 分配 `requestId`
3. 记录请求上下文
4. 做一次前置策略检查
5. 将请求发给 CLI runtime

CLI runtime 处理：

1. 发出 `request.accepted`
2. 进入 agent loop
3. 输出 `assistant.delta`
4. 如需调用工具，发出 `tool.call.started`
5. 工具返回后发出 `tool.call.completed`
6. 完成后发出 `assistant.final`
7. 最后发出 `session.completed`

## 5.3 工具调用与事件回传

CLI runtime 不直接操作 Renderer。

统一路径：

`CLI Runtime -> CodingAgentBridge -> CodingAgentSessionService -> Electron IPC -> Renderer`

这样做的目的：

- 降低 UI 与 runtime 耦合
- 让主进程统一做权限和审计
- 让 CLI 模式和桌面模式共享一套 runtime

## 5.4 审批流程

当遇到写文件、执行 shell、非只读 Git、MCP 高风险操作时：

1. CLI runtime 生成 `approval.requested`
2. Main 接收到事件后暂停该次工具执行
3. Main 把审批请求转发给 Renderer
4. Renderer 弹出确认界面
5. 用户选择批准或拒绝
6. Renderer 通过 IPC 回传结果
7. Main 将结果送回 CLI runtime
8. runtime 发出 `approval.granted` 或 `approval.denied`
9. 根据结果继续执行或终止该步骤

建议 IPC：

- `coding-agent:respond-approval`

建议参数：

```json
{
  "sessionId": "sess_001",
  "requestId": "req_001",
  "approvalId": "appr_001",
  "decision": "granted"
}
```

## 5.5 中断流程

Renderer 发起：

- `coding-agent:interrupt`

Main 侧处理：

1. 标记该 `requestId` 为中断中
2. 通知 bridge 中断当前 runtime 执行
3. runtime 发出 `session.interrupted`
4. Main 把结果转发给 Renderer

## 5.6 恢复会话

Renderer 发起：

- `coding-agent:resume-session`

Main 侧处理：

1. 加载 session store
2. 恢复摘要、历史消息、计划状态
3. 通过 bridge 恢复 runtime session
4. 转发 `session.resumed`

## 6. 推荐 IPC 清单

建议新增而不是复用旧的 one-shot `code-agent:*` 语义。

推荐首批 IPC：

- `coding-agent:start-session`
- `coding-agent:resume-session`
- `coding-agent:send-message`
- `coding-agent:interrupt`
- `coding-agent:close-session`
- `coding-agent:respond-approval`
- `coding-agent:list-sessions`
- `coding-agent:get-session-state`
- `coding-agent:subscribe-events`

说明：

- 如果当前 Electron 架构不适合事件订阅型 IPC，也可以用 `webContents.send` 推送事件
- 关键不是具体 IPC 形式，而是不要退回一次请求一次完整结果的 one-shot 模型

## 7. 模块归属建议

## Main 进程

建议放在：

- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-events.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-permission-gate.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js`

## CLI 侧

建议复用：

- `packages/cli/src/runtime/`
- `packages/cli/src/tools/`
- `packages/cli/src/harness/`

## 8. 不推荐的实现方式

以下方式不建议采用：

### 8.1 在 Electron Main 里复制一套 agent loop

问题：

- CLI 和桌面端会迅速分叉
- 测试与维护成本倍增

### 8.2 继续把 `code-agent-ipc.js` 扩展成超大 one-shot RPC

问题：

- 不适合多轮会话
- 不适合流式工具事件
- 不适合审批中断与恢复

### 8.3 Renderer 直接知道工具实现细节

问题：

- UI 层耦合过深
- 后续切换 runtime 或工具实现会很痛

## 9. 第一版验收标准

- Renderer 能创建并关闭会话
- Renderer 能发送多轮消息
- Main 能稳定转发 runtime 流式事件
- 审批流程可以回传到 runtime
- 会话可以恢复
- 不需要在 Renderer 中解析杂乱字符串来判断工具状态

