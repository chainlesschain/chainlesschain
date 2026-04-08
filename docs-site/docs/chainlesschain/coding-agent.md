# Coding Agent 系统

> **版本: v1.0 (Phase 0-3) | 状态: ✅ 统一事件信封已上线 | 9 IPC 通道 | 408 测试通过**

ChainlessChain Coding Agent 是面向真实代码仓库工作的多轮编码助手，吸收 Claude Code 等业界 agent 的工程经验，在 ChainlessChain 既有 CLI runtime 与 Desktop 主进程的基础上落地"读代码 → 计划 → 改文件 → 跑命令 → 流式回放"的最小可用闭环，并同时支持 CLI 与桌面端两种使用场景。

## 概述

Coding Agent 不是对一次性 `code-agent:generate` / `code-agent:review` 接口的扩展，而是一套全新的多轮 session 架构：

- **唯一内核**：真正的 agent loop 只在 `packages/cli` runtime 中实现一份，桌面端只做 host、bridge、permission UI 与 event consumer
- **统一事件协议**：CLI Runtime / Electron Main / Renderer 三端共用同一份事件信封，避免协议分叉
- **先计划、后执行**：写入、删除、shell、非只读 Git 等高风险动作必须先经过 plan mode 与显式审批
- **会话可恢复**：session 持久化、prompt compression 内置在 harness 层
- **MCP 与技能后置**：MVP 不引入 MCP 默认工具集，按信任来源分级后置接入

## 核心特性

- 🔁 **最小 agent loop**：`用户输入 → 模型 → 工具调用 → 工具结果 → 继续循环`，复杂度沉到 harness 层
- 🧰 **运行时工具注册表**：工具是一等对象，具备 schema、权限级别、telemetry 标签、Plan Mode 行为
- 📝 **Plan Mode 与审批门控**：写/执行/删除/联网类动作显式进入审批流，CLI 与 Desktop 共用 allow/deny/ask 语义
- 🌊 **流式事件协议**：`assistant.delta`、`tool.call.*`、`plan.updated`、`approval.requested` 等结构化事件，前端无需解析字符串
- 💾 **会话持久化与压缩**：长会话自动 compaction，可断点恢复
- 🖥️ **CLI / Desktop 双宿主**：同一套 runtime kernel，CLI REPL 与桌面 IPC 都能驱动
- 🛡️ **安全先于自治**：在权限模型、事件协议、审批流稳定前，不引入长期后台自治和多代理常驻

## 系统架构

```
┌────────────────────────────────────────────────────────────┐
│                       Renderer (Vue)                       │
│  会话 UI · 计划面板 · 审批弹窗 · 流式输出 · 工具卡片        │
└──────────────────────────┬─────────────────────────────────┘
                           │ Electron IPC (coding-agent:*)
┌──────────────────────────▼─────────────────────────────────┐
│                Electron Main (Host Layer)                  │
│  CodingAgentSessionService · CodingAgentBridge             │
│  PermissionGate · IPC v3 注册 · Renderer 事件转发           │
└──────────────────────────┬─────────────────────────────────┘
                           │ Local Bridge
┌──────────────────────────▼─────────────────────────────────┐
│              packages/cli Runtime Kernel                   │
│  Session Loop · Tool Registry · Plan Mode · Compression    │
│  Persistence · Worktree Isolation · Background Task        │
└──────────────────────────┬─────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
   ┌────────────────┐            ┌────────────────┐
   │  Tool Layer    │            │  MCP / Skills  │
   │ read/list/     │            │ (按需后置接入) │
   │ search/edit/   │            └────────────────┘
   │ write/shell/git│
   └────────────────┘
```

### 分层职责

| 层 | 职责 | 不做的事 |
| --- | --- | --- |
| Renderer | 展示、用户交互、最小状态 | 不解析工具输出、不直接触达 runtime |
| Desktop Main | 宿主集成、IPC 转发、权限门控、审计 | 不复制 agent loop |
| CLI Runtime | session 生命周期、工具调度、harness 服务 | 不直接驱动 UI |
| Tool Layer | 文件、搜索、shell、git 等运行时工具 | 不持久化会话 |
| Permission Gate | 审批策略判定 | 不执行工具 |

## 工作原理

### 会话生命周期

```text
Renderer  ──coding-agent:start-session──▶  SessionService
                                                │
                                                ▼
                                          Bridge → CLI Runtime
                                                │
                                          session.started
                                                │
Renderer  ◀──forward event──  Main  ◀──────────┘

Renderer  ──coding-agent:send-message──▶  SessionService
                                                │ preflight
                                                ▼
                                          Bridge → Runtime
                                                │
                            request.accepted ───┤
                            assistant.delta ────┤
                            tool.call.started ──┤
                            (审批中断点) ───────┤
                            tool.call.completed ┤
                            assistant.final ────┤
                            session.completed ──┘
```

### 统一事件信封

所有事件三端共用同一份结构：

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

事件类型按域分组：

- **会话生命周期**：`session.started` / `session.resumed` / `session.interrupted` / `session.completed` / `session.closed`
- **请求生命周期**：`request.accepted` / `request.rejected`
- **Assistant 输出**：`assistant.message` / `assistant.delta` / `assistant.thought-summary` / `assistant.final`
- **计划模式**：`plan.started` / `plan.updated` / `plan.approval_required` / `plan.approved` / `plan.rejected`
- **工具调用**：`tool.call.started` / `tool.call.progress` / `tool.call.completed` / `tool.call.failed` / `tool.call.skipped`
- **权限审批**：`approval.requested` / `approval.granted` / `approval.denied` / `approval.expired`
- **上下文压缩**：`context.compaction.started` / `context.compaction.completed`
- **错误告警**：`warning` / `error`

### v1.0 信封落地实现

统一信封已在三端真实落地，所有 Coding Agent WebSocket / IPC 响应都遵循同一外壳。**实现位置**：

| 角色 | 文件 |
| --- | --- |
| 信封事实标准 | `packages/cli/src/runtime/coding-agent-events.cjs` |
| WebSocket 会话事件 | `packages/cli/src/gateways/ws/session-protocol.js` |
| WebSocket Worktree 事件 | `packages/cli/src/gateways/ws/worktree-protocol.js` |
| Desktop 桥接拆封 | `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js` |
| Web UI 兼容层 | `packages/cli/src/lib/web-ui-envelope.js` |

**桥接拆封策略**：检测 `version === "1.0" && eventId 字符串 && payload 对象` → 按 `requestId` 关联挂起请求（旧报文按 `id` 关联）→ payload 平铺为顶层结果，`_envelope` 字段保留诊断信息 → `type === "error"` 用 `payload.message ?? payload.code` reject 挂起 promise。

**双 awaitTypes 灰度迁移**：Bridge 同时接受新点分类型（如 `session.list`）和旧 kebab-case（`session-list-result`），允许 Desktop / CLI / Web UI 独立升级。

**Web UI 兼容**：浏览器旧 switch 表按 kebab-case 分发，`web-ui-envelope.js` 提供 31 条 `UNIFIED_TO_LEGACY` 映射 + `unwrapEnvelope()`，由 `getInlineSource()` 渲染为 ES5-friendly 字符串注入 HTML，Node 单元测试与浏览器内联代码共享同一份源。

### 审批流程

写文件、执行 shell、非只读 Git、MCP 高风险操作触发以下时序：

1. CLI runtime 发出 `approval.requested`
2. Main 暂停该次工具执行，把请求转发给 Renderer
3. Renderer 弹出确认界面
4. 用户决定批准 / 拒绝
5. Renderer 通过 `coding-agent:respond-approval` 回传结果
6. Main 把结果送回 CLI runtime
7. runtime 发出 `approval.granted` 或 `approval.denied`
8. 根据结果继续执行或终止该步骤

## 使用示例

### CLI 模式

```bash
# 启动多轮 coding session（继承 packages/cli 的 agent runtime）
chainlesschain agent

# 恢复之前的 session
chainlesschain agent --session sess_001
```

### Desktop 模式

Renderer 通过 9 个 IPC 通道与 Main 交互：

```js
// 1. 创建会话
const { sessionId } = await window.electron.invoke('coding-agent:start-session', {
  workspacePath: 'C:\\code\\chainlesschain',
  mode: 'interactive',
  resumeSessionId: null,
})

// 2. 订阅事件流
window.electron.on('coding-agent:event', (envelope) => {
  switch (envelope.type) {
    case 'assistant.delta':
      appendText(envelope.payload.text)
      break
    case 'tool.call.started':
      showToolCard(envelope.payload)
      break
    case 'approval.requested':
      openApprovalDialog(envelope.payload)
      break
    case 'plan.updated':
      renderPlan(envelope.payload.steps)
      break
  }
})

// 3. 发送消息
await window.electron.invoke('coding-agent:send-message', {
  sessionId,
  message: '帮我分析 code-agent 的 IPC 入口并给出重构方案',
})

// 4. 回应审批
await window.electron.invoke('coding-agent:respond-approval', {
  sessionId,
  requestId: 'req_001',
  approvalId: 'appr_001',
  decision: 'granted',
})

// 5. 真实中断（保留 session）或彻底关闭
await window.electron.invoke('coding-agent:interrupt', { sessionId })
await window.electron.invoke('coding-agent:close-session', { sessionId })

// 6. 最小 Harness：聚合状态 + 后台任务
const harness = await window.electron.invoke('coding-agent:harness-status')
// { sessions: { total, running, waitingApproval, active },
//   worktrees: { tracked, isolated, dirty },
//   backgroundTasks: { total, pending, running, completed, failed, timeout } }

const tasks = await window.electron.invoke('coding-agent:list-background-tasks')
const task = await window.electron.invoke('coding-agent:get-background-task', { taskId })
const history = await window.electron.invoke('coding-agent:get-background-task-history', { taskId, limit: 10 })
await window.electron.invoke('coding-agent:stop-background-task', { taskId })
```

> **注意**：`coding-agent:interrupt` 已从 `close-session` 的别名收口为**真实中断**语义 —— 它会通过
> CLI runtime 的 `AbortController` 终止当前正在执行的 turn（工具调用 / 模型流），但保留 session，
> 用户仍可继续对话或恢复。如果要彻底关闭 session，请显式调用 `coding-agent:close-session`。

### IPC 通道列表

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| `coding-agent:start-session` | R → M | 创建会话（`start-session` 为 `create-session` 别名） |
| `coding-agent:resume-session` | R → M | 恢复历史会话 |
| `coding-agent:send-message` | R → M | 发送用户消息 |
| `coding-agent:interrupt` | R → M | 真实中断当前 turn（保留 session） |
| `coding-agent:close-session` | R → M | 关闭并清理 session |
| `coding-agent:respond-approval` | R → M | 回传审批结果（plan / high-risk 通用） |
| `coding-agent:list-sessions` | R → M | 查询会话列表 |
| `coding-agent:get-session-state` | R → M | 查询会话状态 |
| `coding-agent:harness-status` | R → M | 聚合 sessions / worktrees / backgroundTasks 概览 |
| `coding-agent:list-background-tasks` | R → M | 列出后台任务 |
| `coding-agent:get-background-task` | R → M | 读取单个后台任务详情 |
| `coding-agent:get-background-task-history` | R → M | 读取后台任务事件历史 |
| `coding-agent:stop-background-task` | R → M | 停止运行中的后台任务 |
| `coding-agent:subscribe-events` | M → R | 推送事件流 |

### Harness 面板（Desktop）

Desktop 聊天页 (`AIChatPage.vue`) 已在审批面板上方新增 **Coding Agent Harness** 面板。
只要当前 session 存在且有 harness 状态或后台任务，面板会自动展示：

- **Active sessions** —— `total` / `waitingApproval` 数量
- **Tracked worktrees** —— `tracked` / `dirty` 数量
- **Background tasks** —— `running` / `pending` 数量
- 高优先级（`running` / `pending`）后台任务列表，支持：
  - `View Details` —— 调用 `get-background-task` + `get-background-task-history`，在侧栏展示
  - `Stop Task` —— 调用 `stop-background-task`，中断运行中的后台任务
  - `Refresh Harness` —— 同时刷新 `harness-status` 和后台任务列表

所有这些 IPC 都通过 renderer 的 `useCodingAgentStore()` 包装暴露为 reactive 状态：
`harnessStatus` / `backgroundTasks` / `selectedBackgroundTask` / `selectedBackgroundTaskHistory`。

## 配置参考

### MVP 工具矩阵

| 工具 | 用途 | 权限级别 | Plan Mode | 是否需审批 |
| --- | --- | --- | --- | --- |
| `read_file` | 读取文件内容 | `read` | 允许 | 否 |
| `list_dir` | 查看目录结构 | `read` | 允许 | 否 |
| `search_files` | 文件名 / 内容检索（优先 `rg`） | `read` | 允许 | 否 |
| `edit_file` | 精确替换式文件编辑 | `write` | 禁止直接执行 | 是 |
| `write_file` | 新建或整体重写文件 | `write` | 禁止直接执行 | 是 |
| `run_shell` | 受控 shell 命令 | `execute` | 禁止直接执行 | 是 |
| `git` | 受控 Git 操作 | `execute` | 部分允许（只读子集） | 是 |

### 权限级别

- `read` — 只读操作，不修改文件、不启动外部进程、不联网
- `write` — 修改工作区文件，但不直接执行系统命令
- `execute` — 执行本地命令或脚本，较高风险
- `elevated` — 需要额外审批：脱离沙箱、网络下载、影响 Git 历史、访问工作区外路径

### 首版命令白名单（`run_shell`）

```text
npm run test:*
npm run lint
npm run build:*
npx playwright test <single-file>
git status
git diff
rg <pattern>
```

### 默认高风险（必须审批）

```text
rm / del
git reset / git checkout -- / git clean
curl / wget
powershell -EncodedCommand
```

### 工具最小契约

每个 MVP 工具都有稳定 schema 与执行规则。以下是每个工具的输入示例与约束。

#### `read_file`

```json
{ "path": "packages/cli/src/runtime/runtime-factory.js" }
```

- 路径必须在工作区内
- 默认仅处理文本文件，PDF/图片后置
- 大文件需截断并返回截断标记

#### `list_dir`

```json
{ "path": "desktop-app-vue/src/main", "depth": 2 }
```

- 限制最大深度
- 限制最大返回项数

#### `search_files`

```json
{ "query": "code-agent-ipc", "path": "desktop-app-vue/src/main", "mode": "content" }
```

- 优先使用 `rg`
- 限制结果条数
- 返回文件路径与上下文片段

#### `edit_file`

```json
{
  "path": "desktop-app-vue/src/main/ipc/ipc-registry.js",
  "edits": [{ "oldText": "old snippet", "newText": "new snippet" }]
}
```

- 首版优先精确替换
- 不支持工作区外写入
- 必须先经过 plan + approval

#### `write_file`

```json
{ "path": "docs/implementation-plans/new-doc.md", "content": "# title" }
```

- 新建文件允许
- 覆盖现有文件需更高风险提示
- 必须先经过 plan + approval

#### `run_shell`

```json
{ "command": "npm run test:jest", "cwd": "C:\\code\\chainlesschain", "timeoutMs": 120000 }
```

- 默认仅工作区内运行
- 首版尽量限制到只读 / 验证型命令
- 高风险命令必须审批
- 结构化返回 `exitCode` / `stdout` / `stderr`
- CLI 已显式拦截：`run_shell` 调用 `git`、删除类命令、网络下载命令、`powershell -EncodedCommand`

#### `git`

```json
{ "command": "status", "cwd": "C:\\code\\chainlesschain" }
```

- 只读子命令（计划阶段例外）：`status` / `diff` / `log` / `show` / `rev-parse`
- 高风险子命令：`commit` / `push` / `reset` / `checkout` / `rebase` / `clean`
- 首版不默认开放破坏性 Git 命令

### 错误码

```text
SESSION_NOT_FOUND
REQUEST_INVALID
TOOL_NOT_REGISTERED
TOOL_PERMISSION_DENIED
PLAN_APPROVAL_REQUIRED
PLAN_REJECTED
TOOL_EXECUTION_FAILED
MCP_SERVER_UNAVAILABLE
SESSION_PERSISTENCE_FAILED
CONTEXT_COMPACTION_FAILED
RUNTIME_INTERNAL_ERROR
```

## 实施阶段与里程碑

Coding Agent 采用渐进式落地，主线分为 6 个阶段（Phase 0–5）。每个阶段都有明确的退出标准，避免 MVP 范围失控。

### 实施原则

- **先复用，再重构** —— 优先复用 CLI runtime / tool registry / prompt compressor / session store / worktree isolator / desktop plan mode / desktop MCP，不在 Electron Main 复制一套独立 agent kernel
- **首版范围必须收紧** —— 只解决一条最小可用链路：读代码 → 查代码 → 产出计划 → 改文件 → 跑受控命令 → 流式展示
- **内核与宿主解耦** —— runtime kernel 只放 CLI 侧，桌面端只做 host / bridge / permission UI / event consumer
- **安全先于自治** —— 在工具权限模型、会话持久化、事件协议、Desktop 审批流稳定前，不引入长期后台自治、多代理常驻协作、自进化等高复杂度行为

### 阶段状态总览

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| **Phase 0** 基线收敛 | ✅ 完成 | 事件协议、MVP 工具矩阵、Desktop ↔ CLI bridge 时序定义 |
| **Phase 1** MVP Runtime Kernel | ✅ CLI 完成 | 多轮 session loop / 工具调度 / 流式事件 / 持久化 hook |
| **Phase 2** 权限与安全 Harness | ✅ CLI 完成 | 工具权限统一 / Plan Mode 门控 / 共享 allow-deny-ask 策略 |
| **Phase 3** Desktop Bridge | ✅ 主链路完成 | session service / bridge / IPC v3 / 事件转发 / 审批 UI |
| **Phase 4** MCP 与技能接入 | ✅ 主线完成 | trusted MCP auto-connect / 共享 managed-tool policy；skill 按需装载待续 |
| **Phase 5** 高阶 Harness | 🔄 最小集完成 | harness 状态聚合 / 后台任务 / 真实 interrupt 完成；子代理、review mode、patch preview 待续 |

### Phase 0 — 基线收敛

- 盘点 CLI runtime 真实可复用 API
- 盘点 desktop code-agent / plan-mode / MCP 接入点
- 定义统一事件协议（v1.0 信封）
- 定义 MVP 工具清单与权限矩阵
- 定义 Desktop 到 CLI 的 bridge 时序

**退出标准**：会话协议确定 / MVP 工具范围确定 / CLI 与 Desktop 职责边界确定。

### Phase 1 — MVP Runtime Kernel（CLI ✅）

- session 创建与恢复
- 多轮消息循环
- 工具调度 + 流式事件
- prompt compression hook
- session persistence hook

**已落地**：`packages/cli/src/lib/agent-core.js` / `coding-agent-contract.js` / `legacy-agent-tools.js` / `session-manager.js` / `ws-session-manager.js` / `ws-agent-handler.js`

### Phase 2 — 权限与安全 Harness（CLI ✅）

- 工具描述 + 权限级别统一
- 写入 / 执行 / 删除 / 高风险 Git 接入 plan mode
- 审批检查点
- CLI 与 Desktop 共享 allow / deny / ask 语义
- 工具执行边界 telemetry tags

**关键模块**：`coding-agent-contract.js`（工具元数据）、`plan-mode.js`（计划门控）、`coding-agent-policy.cjs`（共享策略）、`coding-agent-shell-policy.cjs`（命令策略）

### Phase 3 — Desktop Bridge（✅ 主链路完成）

- 构建 Main 进程 session service
- 构建 Electron IPC 到 CLI runtime 的桥接层
- 注册新的 coding-agent v3 IPC
- 把 session 事件流推送给 renderer
- 保留旧 one-shot `code-agent:*` 接口的兼容层

**新增模块**：`coding-agent-session-service.js` / `coding-agent-bridge.js` / `coding-agent-permission-gate.js` / `coding-agent-events.js` / `coding-agent-ipc-v3.js`

### Phase 4 — MCP 与技能接入（✅ 主线完成）

- 通过 runtime registry 暴露 MCP 工具
- 按权限级别 + 信任来源对 MCP 工具分类
- skill 作为按需上下文或工具扩展接入
- 默认关闭高风险或未知来源 MCP server

**已落地**：`coding-agent-managed-tool-policy.cjs`（共享 allowlist + trusted server 判定 + 高风险 MCP opt-in）、`agent-runtime.js`（trusted MCP auto-connect）、`coding-agent-tool-adapter.js`（共享 managed/MCP 策略消费）

### Phase 5 — 高阶 Harness（🔄 最小集完成）

**本轮已完成**：

- `CodingAgentSessionService.getHarnessStatus()` 聚合 sessions / worktrees / backgroundTasks
- 后台任务只读 + 停止 API（list / get / history / stop）
- Desktop **Coding Agent Harness** 面板（刷新 / 详情抽屉 / 历史 / 筛选 / 分页）
- `coding-agent:interrupt` 收口为真实中断（共享 `abort-utils.js` + `AbortController`）

**仍未完成**：

- 子代理委派
- review mode
- patch preview / diff 总结编排
- 更高阶持久化任务图与编排器

**原则**：每项高阶能力必须是可选层，基础 coding agent 在不启用时仍可正常工作。

## 主要风险与缓解

| 风险 | 描述 | 缓解措施 |
| --- | --- | --- |
| **双内核分叉** | CLI 与 Desktop 演化成两套不同 agent 实现 | 只保留一个 runtime kernel，Desktop 只做宿主与桥接 |
| **权限行为不一致** | CLI 与 Desktop 对允许 / 拒绝的理解不一致 | 统一工具元数据模型与策略词汇表（`coding-agent-policy.cjs`） |
| **上下文膨胀** | 大仓库与长会话快速耗尽上下文窗口 | 尽早接入 prompt compression 与 session summarization |
| **MVP 过度设计** | 首版引入过多模块，范围失控 | 严格控制在 6-7 个工具与一套稳定 session 协议 |

## 性能指标

| 指标 | 目标值 | 说明 |
| --- | --- | --- |
| 会话冷启动 | < 500ms | Desktop IPC → CLI runtime session.started |
| `assistant.delta` 首字延迟 | < 1.5s | 视模型与上下文长度 |
| 事件序列稳定性 | 100% 单调递增 | 同一 `requestId` 内 `sequence` 必须单调递增 |
| 上下文压缩触发阈值 | ≥ 70% 上下文窗口 | harness 自动 compaction |
| 工具调用结构化率 | 100% | 所有工具失败必须以结构化结果返回 |
| 审批流往返延迟 | < 200ms（不含用户决策） | Main ↔ Runtime 链路 |

## 测试覆盖率

### 单元测试

- 工具描述标准化
- 权限策略解析
- Plan Mode 门控
- 事件信封格式化与序列号校验
- Session 持久化与恢复

### 集成测试

- CLI 多轮 session 的"读文件 → 编辑文件"闭环
- Desktop IPC 启动到完成的会话链路
- 审批请求往返流程（granted / denied / expired）
- MCP trusted 与 blocked 场景

### E2E 测试

- 用户要求 agent 分析代码、生成计划、修改一个文件并执行验证命令
- 用户拒绝高风险操作后，agent 能稳定恢复
- 用户恢复旧会话并继续任务

**当前测试覆盖：408 测试通过**

CLI runtime（envelope v1.0 专项）：

- `packages/cli/__tests__/unit/web-ui-envelope.test.js` — 28 测试
- `packages/cli/__tests__/unit/ws-runtime-events.test.js` — 16 测试（session / worktree 事件信封）
- `packages/cli/__tests__/integration/ws-session-workflow.test.js` — 19 测试
- `packages/cli/__tests__/e2e/coding-agent-envelope-roundtrip.test.js` — 7 测试（真实 spawn `chainlesschain serve` + WebSocket 信封 roundtrip）

Desktop main：

- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` — 22 测试（含 9 个 v1.0 信封拆封）
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-ipc-v3.test.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-session-service.test.js`
- `desktop-app-vue/tests/unit/v50210-workflow.test.js` / `coding-agent-contract.test.js` / `ws-session-manager.test.js`

Renderer：

- `desktop-app-vue/src/renderer/stores/__tests__/coding-agent.test.ts`
- `desktop-app-vue/tests/unit/pages/AIChatPage.test.js`

### 本轮新增测试（Phase 5 最小 Harness + 真实 interrupt）

- **`interrupt` 真实中断链路**：CLI `agent-core` / `ws-agent-handler` / `interaction-adapter` 新增共享 `abort-utils.js`（`AbortError` / `throwIfAborted`）—— 单元 + 集成 + e2e 定向回归 `6 files, 175 passed`
- **最小 harness 聚合链路**：Desktop `coding-agent-session-service` / `coding-agent-bridge` / `coding-agent-ipc-v3` / renderer store / AIChatPage 补齐 `getHarnessStatus` + `list/get/history/stop background-task` 回归 `5 files, 84 passed`
- **AIChatPage harness 面板**：`tests/unit/pages/AIChatPage.test.js` 新增 `coding agent harness panel` / `coding agent dot-case events` 两个 describe，总 `69 passed`

## 故障排查

### Issue: Renderer 收不到流式事件

**原因**：未通过 `coding-agent:subscribe-events` 订阅，或事件被旧的 one-shot `code-agent:*` 通道拦截。

**解决**：

- 确认使用的是 v3 IPC 通道（`coding-agent:*`，不是 `code-agent:*`）
- 在 Main 进程检查 `webContents.send('coding-agent:event', envelope)` 是否被调用
- 检查 `sequence` 是否单调递增，如果跳号说明事件被吞

### Issue: `tool.call.started` 之后一直没有 completed / failed

**原因**：工具卡在审批等待，`approval.requested` 事件被 Renderer 错过。

**解决**：

- 检查 Renderer 是否正确处理 `approval.requested` 类型事件
- 确认 `coding-agent:respond-approval` 已正确回传
- 查看 `approval.expired` 事件 — 超时未响应会自动失效

### Issue: `TOOL_PERMISSION_DENIED` 错误

**原因**：当前 Plan Mode 不允许该工具执行（如计划阶段调用 `edit_file`），或工具命中默认拒绝清单。

**解决**：

- 对照"MVP 工具矩阵"确认工具的 Plan Mode 行为
- 写 / 执行类工具必须先经过 plan + approval 流程
- 如需放行白名单外命令，扩展 `run_shell` 白名单而不是降级权限

### Issue: 会话恢复后历史消息丢失

**原因**：session store 写入失败或 prompt compression 把过多上下文压缩掉。

**解决**：

- 检查 `SESSION_PERSISTENCE_FAILED` 与 `CONTEXT_COMPACTION_FAILED` 错误事件
- 使用 `coding-agent:get-session-state` 检查实际存储的状态
- 确认 harness 的 session store 路径可写

### Issue: CLI 与 Desktop 行为分叉

**原因**：在 Electron Main 中复制了一份 agent loop，违反"唯一内核"原则。

**解决**：

- Main 进程不应包含 model 调用逻辑
- 所有 agent 行为都通过 `CodingAgentBridge` 转发到 `packages/cli` runtime
- 在 Main 侧只保留 host、bridge、permission gate、event forwarder

## 安全考虑

### 工具权限

- **默认最小权限**：每个工具显式声明 `read` / `write` / `execute` / `elevated`
- **路径沙箱**：`read_file` / `list_dir` / `edit_file` / `write_file` 默认仅限工作区内
- **命令白名单**：`run_shell` 首版只允许验证型命令，破坏性命令必须审批
- **Git 分级**：`status` / `diff` / `log` 视为只读，`commit` / `push` / `reset` / `checkout` / `rebase` 视为高风险

### 审批策略

| 类别 | 行为 |
| --- | --- |
| 自动放行 | `read_file` / `list_dir` / `search_files`、计划阶段的只读 Git |
| 必须审批 | `edit_file` / `write_file` / `run_shell`、非只读 Git、工作区外访问、脱离沙箱 |
| 默认拒绝 | 工作区外递归写入、未审批的破坏性 Git、未审批的网络下载、删除类工具、浏览器自动化 |

### MCP 接入

- MCP 不进入 MVP 默认工具集
- 按信任来源分级：trusted / verified / unknown
- 高风险或 unknown 来源的 MCP server 默认关闭
- skill 不会默认污染每个 session 的上下文，按需加载

### 审计

- 所有审批决策（granted / denied / expired）通过事件流持久化
- Main 进程负责统一审计而不是由 Renderer 上报
- `meta` 字段记录 traceId、权限级别、模型、耗时

## 关键文件

### Desktop Main

- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js` — 会话服务
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js` — Main → CLI runtime 桥接层
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-events.js` — 事件信封工厂与类型常量
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-permission-gate.js` — 审批与策略判定
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js` — v3 IPC 注册
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-tool-adapter.js` — 工具适配器
- `desktop-app-vue/src/main/ai-engine/code-agent/code-agent-ipc.js` — 旧 one-shot IPC（兼容层）

### Renderer

- `desktop-app-vue/src/renderer/stores/coding-agent.ts` — Pinia store
- `desktop-app-vue/src/renderer/pages/AIChatPage.vue` — 主 UI 入口
- `desktop-app-vue/src/preload/index.js` — IPC 暴露
- `desktop-app-vue/src/renderer/types/electron.d.ts` — IPC 类型声明

### CLI Runtime（复用）

- `packages/cli/src/runtime/runtime-factory.js` — runtime 工厂
- `packages/cli/src/runtime/coding-agent-events.cjs` — **统一信封 v1.0 事实标准**
- `packages/cli/src/gateways/ws/session-protocol.js` — WebSocket 会话事件发射
- `packages/cli/src/gateways/ws/worktree-protocol.js` — WebSocket Worktree 事件发射
- `packages/cli/src/lib/web-ui-envelope.js` — Web UI 兼容层（`UNIFIED_TO_LEGACY` 映射 + `unwrapEnvelope` + `getInlineSource`）
- `packages/cli/src/tools/registry.js` — 工具注册表
- `packages/cli/src/harness/` — prompt compression / session store / background task / worktree isolation
- `packages/cli/src/repl/agent-repl.js` — 交互式 agent 入口

## 相关文档

### 设计文档

- [`docs/design/modules/79_Coding_Agent系统.md`](../design/modules/79-coding-agent.md) — 完整设计文档

### Phase 0 实施计划

- [`docs/implementation-plans/LEARN_CODING_AGENT_IMPLEMENTATION_PLAN.md`](../../../../docs/implementation-plans/LEARN_CODING_AGENT_IMPLEMENTATION_PLAN.md) — 总实施计划
- [`docs/implementation-plans/CODING_AGENT_EVENT_SCHEMA.md`](../../../../docs/implementation-plans/CODING_AGENT_EVENT_SCHEMA.md) — 事件协议
- [`docs/implementation-plans/CODING_AGENT_MVP_TOOL_PERMISSION_MATRIX.md`](../../../../docs/implementation-plans/CODING_AGENT_MVP_TOOL_PERMISSION_MATRIX.md) — 工具与权限矩阵
- [`docs/implementation-plans/CODING_AGENT_DESKTOP_CLI_BRIDGE_SEQUENCE.md`](../../../../docs/implementation-plans/CODING_AGENT_DESKTOP_CLI_BRIDGE_SEQUENCE.md) — 桌面端到 CLI Bridge 时序

### 关联模块

- [代码生成 Agent 2.0 (v2)](./code-agent-v2.md) — 旧版 one-shot 生成接口
- [Minimal Coding Agent Plan](./minimal-coding-agent-plan.md) — 早期方案
- [CLI Agent Runtime](./cli-agent-runtime-plan.md) — CLI 侧 runtime 重构
- [Sub-Agent Isolation](./sub-agent-isolation.md) — 子代理隔离（Phase 5 后置）
