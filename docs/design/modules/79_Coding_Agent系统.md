# Coding Agent 系统 (v1.0 / Phase 0-3)

> **状态**: ✅ Phase 0-3 已完成 (统一事件信封 v1.0 已上线 / Phase 4-5 待执行)
> **日期**: 2026-04-08
> **依赖**: `packages/cli` runtime kernel, Electron Main, Vue3 Renderer

## 1. 概述

Coding Agent 是 ChainlessChain 在 v5.0.2.9 阶段引入的全新多轮编码助手，目标是基于业界 coding agent（包括 `sanbuphy/learn-coding-agent`、Claude Code 等）的工程经验，落地一个可在真实代码仓库工作的最小可用闭环：

> **读代码 → 查代码 → 产出计划 → 改文件 → 跑受控命令 → 流式展示**

它不是对现有 `code-agent:generate` / `code-agent:review` 一次性接口的扩展，而是新建一套以 session、事件流、plan + approval、harness 为核心的运行时，并明确：

- 真正的 agent loop 只在 **CLI runtime** 中实现一份
- Desktop 只做 host、bridge、permission UI、event consumer
- 通过统一事件协议解决 CLI / Main / Renderer 三端协议分叉问题

## 2. 设计目标

| 目标 | 描述 |
| --- | --- |
| 单内核 | CLI runtime 是唯一的 agent kernel，桌面端不复制 |
| 协议统一 | 三端共用同一份事件信封 |
| 安全先于自治 | 写 / 执行 / 删除 / 联网必须进入 plan + approval |
| 范围收紧 | MVP 仅 7 个工具，MCP / 子代理 / worktree 后置 |
| 可恢复 | session 持久化与上下文压缩内置 harness |
| CLI / Desktop 双宿主 | 同一套 runtime 同时驱动 CLI REPL 与桌面 IPC |

## 3. 设计原则

### 3.1 先复用，再重构

优先复用已有模块，避免在 Electron Main 复制 agent kernel：

- `packages/cli/src/runtime/` — runtime 工厂与生命周期
- `packages/cli/src/tools/registry.js` — 工具描述标准化、权限、telemetry
- `packages/cli/src/harness/` — prompt compression / session store / background task / worktree isolation
- `packages/cli/src/repl/agent-repl.js` — 交互式入口
- `desktop-app-vue/src/main/ai-engine/plan-mode/index.js` — Plan Mode 状态机
- `desktop-app-vue/src/main/mcp/mcp-ipc.js` — MCP 配置与 IPC

### 3.2 内核与宿主解耦

```
内核（CLI runtime）：session loop、tool registry、harness
宿主（Desktop）   ：IPC、permission UI、event forwarding
```

### 3.3 安全先于自治

在以下能力稳定之前，不引入长期后台自治、多代理常驻协作、自进化等高复杂度行为：

- 工具权限模型稳定
- 会话持久化稳定
- 事件协议稳定
- Desktop 审批流稳定

### 3.4 MVP 范围必须收紧

首版只解决一条最小可用链路。MCP 默认工具集合、子代理委派、worktree 隔离、后台任务都后置到 Phase 5。

## 4. 系统架构

```text
┌──────────────────────────── Renderer (Vue) ────────────────────────────┐
│  AIChatPage · Pinia coding-agent store · 流式输出 · 计划面板 · 审批弹窗 │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ Electron IPC v3 (coding-agent:*)
┌────────────────────────────────▼───────────────────────────────────────┐
│                        Electron Main (Host)                            │
│  CodingAgentSessionService                                             │
│  CodingAgentBridge                                                     │
│  CodingAgentPermissionGate                                             │
│  CodingAgentEvents (envelope factory)                                  │
│  CodingAgentToolAdapter                                                │
│  ipc-v3 注册 + Renderer 事件转发                                        │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ Local Bridge
┌────────────────────────────────▼───────────────────────────────────────┐
│                    packages/cli Runtime Kernel                         │
│  Session Loop · Tool Registry · Plan Mode · Compression                │
│  Persistence · Worktree Isolation · Background Task                    │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                ┌────────────────┴────────────────┐
                ▼                                 ▼
       ┌────────────────┐                ┌────────────────┐
       │   Tool Layer   │                │ MCP / Skills   │
       │ read / list /  │                │  (Phase 4 后置) │
       │ search / edit /│                └────────────────┘
       │ write / shell /│
       │ git            │
       └────────────────┘
```

### 4.1 模块归属

| 路径 | 模块 |
| --- | --- |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js` | 会话服务 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js` | Main → CLI runtime 桥接 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-events.js` | 事件信封工厂 / 类型常量 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-permission-gate.js` | 审批与策略判定 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js` | v3 IPC 注册 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-tool-adapter.js` | 工具适配器 |
| `desktop-app-vue/src/main/ai-engine/code-agent/code-agent-ipc.js` | 旧 one-shot IPC（兼容层） |
| `desktop-app-vue/src/renderer/stores/coding-agent.ts` | Renderer Pinia store |
| `desktop-app-vue/src/renderer/pages/AIChatPage.vue` | 主交互 UI |
| `packages/cli/src/runtime/`、`tools/`、`harness/` | CLI 内核（复用） |

## 5. 事件协议设计

### 5.1 设计原则

- 一个事件信封，所有事件共用
- 事件类型稳定，负载可扩展
- 优先面向流式 UI，而不是一次性 RPC
- 允许 CLI 与 Desktop 共享同一协议
- 错误和拒绝必须是结构化事件，不能只靠字符串

### 5.2 统一信封

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

| 字段 | 含义 |
| --- | --- |
| `version` | 协议版本，初始 `1.0` |
| `sessionId` | 会话标识，贯穿整个 agent session |
| `requestId` | 单次用户输入的请求标识 |
| `eventId` | 当前事件唯一标识 |
| `type` | 事件类型（白名单） |
| `timestamp` | 毫秒时间戳 |
| `source` | `renderer` / `desktop-main` / `cli-runtime` / `tool` |
| `sequence` | 同一 `requestId` 内单调递增 |
| `payload` | 事件数据（必须是对象） |
| `meta` | 扩展字段：耗时、traceId、model、权限级别 |

### 5.3 事件类型清单

**会话生命周期**

- `session.started` — 会话创建成功
- `session.resumed` — 从持久化恢复
- `session.interrupted` — 当前请求被中断
- `session.completed` — 本轮请求完成
- `session.closed` — 整个会话结束

**用户请求生命周期**

- `request.accepted` / `request.rejected`

**Assistant 输出**

- `assistant.message` — 一次完整消息（非流式降级）
- `assistant.delta` — 流式增量文本
- `assistant.thought-summary` — 简短思路摘要（不暴露内部推理全文）
- `assistant.final` — 本轮最终文本结果

**计划模式**

- `plan.started` / `plan.updated` / `plan.approval_required` / `plan.approved` / `plan.rejected`

`plan.updated` 示例：

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

**工具调用**

- `tool.call.started` / `tool.call.progress` / `tool.call.completed` / `tool.call.failed` / `tool.call.skipped`

`tool.call.started` 示例：

```json
{
  "payload": {
    "toolCallId": "tool_001",
    "toolName": "read_file",
    "arguments": { "path": "packages/cli/src/runtime/runtime-factory.js" },
    "permissionLevel": "read"
  }
}
```

**权限审批**

- `approval.requested` / `approval.granted` / `approval.denied` / `approval.expired`

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

**上下文压缩**

- `context.compaction.started` / `context.compaction.completed`

**错误告警**

- `warning` / `error`

```json
{
  "payload": {
    "code": "TOOL_PERMISSION_DENIED",
    "message": "当前模式不允许执行写操作",
    "retryable": false,
    "details": { "toolName": "edit_file" }
  }
}
```

### 5.4 Renderer 必须正确处理的事件

`request.accepted` · `assistant.delta` · `assistant.final` · `plan.updated` · `plan.approval_required` · `tool.call.started` · `tool.call.completed` · `tool.call.failed` · `approval.requested` · `approval.granted` · `approval.denied` · `error` · `session.completed`

### 5.5 v1.0 不做的事

不进入 v1.0 协议（后续按 `type` 扩展）：

- 多代理团队专用事件
- 语音流事件
- 图像块传输事件
- 浏览器自动化视频流事件
- 细粒度 token 计费明细事件

### 5.6 错误码

```
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

### 5.7 v1.0 信封落地实现

统一信封协议 v1.0 已在三端落地，所有 Coding Agent 相关 WebSocket / IPC 响应都遵循同一个外壳：

```text
{
  version:   "1.0",
  eventId:   "evt_xxx",      // 每条事件唯一
  type:      "session.started", // 点分小写命名
  requestId: "req_xxx",      // 与请求一一对应
  sessionId: "sess_xxx",     // 顶层冗余便于路由
  source:    "cli-runtime",
  payload:   { ... }         // 载荷,所有业务字段
}
```

**实现位置**

| 角色 | 文件 |
| --- | --- |
| 信封事实标准 | `packages/cli/src/runtime/coding-agent-events.cjs` |
| WebSocket 会话事件发射 | `packages/cli/src/gateways/ws/session-protocol.js` |
| WebSocket Worktree 事件发射 | `packages/cli/src/gateways/ws/worktree-protocol.js` |
| Desktop 桥接拆封 | `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js` |
| Web UI 兼容层 | `packages/cli/src/lib/web-ui-envelope.js` |
| Web UI 浏览器嵌入 | `packages/cli/src/lib/web-ui-server.js`（内联 `getInlineSource()`） |

**桥接拆封策略 (`CodingAgentBridge`)**

1. 解析 WebSocket 帧 → JSON
2. 检测 v1.0 信封：`msg.version === "1.0" && typeof msg.eventId === "string" && typeof msg.payload === "object"`
3. 关联策略：信封按 `requestId` 关联挂起请求，旧报文按 `id` 关联
4. 拆封：`payload` 字段平铺到顶层结果对象，`_envelope` 字段保留原始信封以便诊断
5. 错误信封 (`type === "error"`)：用 `payload.message ?? payload.code` reject 挂起 promise
6. 类型映射：`UNIFIED_TO_LEGACY` 按需将点分类型映射回旧 kebab-case

**双 awaitTypes 灰度迁移**

旧调用方按消息类型 (`session-list-result`) 等待响应；新发射器使用点分类型 (`session.list`)。Bridge 在内部维护双 awaitTypes，例如：

```js
awaitTypes: ["session.list", "session-list-result"]
```

任意一个匹配即解除等待。这使得 Desktop / CLI / Web UI 可以独立升级，迁移期间不中断。

**Web UI 兼容层**

Web UI 浏览器端的旧 switch 表仍按 kebab-case 分发 (`session-created` 等)。`web-ui-envelope.js` 提供 31 条 `UNIFIED_TO_LEGACY` 映射 + `unwrapEnvelope()` 函数，由 `getInlineSource()` 渲染为 ES5-friendly 字符串，再由 `web-ui-server.js` 注入到 HTML 模板。Node 端单元测试 (`web-ui-envelope.test.js`) 与浏览器内联代码共享同一份源文件，确保两侧行为一致。

**测试覆盖（v1.0 信封专项）**

| 位置 | 文件 | 用例数 |
| --- | --- | --- |
| CLI 单元 | `packages/cli/__tests__/unit/web-ui-envelope.test.js` | 28 |
| CLI 单元 | `packages/cli/__tests__/unit/ws-runtime-events.test.js` | 16 |
| CLI 集成 | `packages/cli/__tests__/integration/ws-session-workflow.test.js` | 32 |
| CLI E2E | `packages/cli/__tests__/e2e/coding-agent-envelope-roundtrip.test.js` | 7 |
| Desktop 单元 | `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` | 22 |
| 三端总计 | — | **408 测试通过** |

**2026-04-08 文档对齐回归（修改文件全量定向）**：

| 类型 | 范围 | 通过 |
| --- | --- | --- |
| CLI 单元 | agent-core / sub-agent-registry / ws-agent-handler | 126/126 |
| Desktop main 单元 | coding-agent-bridge / coding-agent-ipc-v3 / coding-agent-session-service | 77/77 |
| Renderer 单元 | coding-agent store / AIChatPage | 81/81 |
| CLI 集成 | ws-session-workflow | 32/32 |
| Desktop 集成 | coding-agent-lifecycle | 18/18 |
| CLI E2E | coding-agent-envelope-roundtrip | 7/7 |
| **小计** | **6 套** | **341/341** |

E2E roundtrip 会真实 spawn `chainlesschain serve` 子进程并经过 WebSocket 验证：信封形态在 `JSON.stringify` / `parse` 之后依旧正确，证明 Bridge 与 CLI 的网络契约稳定。

## 6. 工具与权限矩阵

### 6.1 MVP 范围

仅 7 类能力，MCP 不进入 MVP 默认工具集：

1. 读取文件
2. 列出目录
3. 搜索文件
4. 编辑文件
5. 写入文件
6. 受控 shell 命令
7. 受控 Git 命令

### 6.2 权限级别

| 级别 | 含义 |
| --- | --- |
| `read` | 只读，不修改文件、不启动外部进程、不联网 |
| `write` | 修改工作区文件，不直接执行系统命令 |
| `execute` | 执行本地命令或脚本，较高风险 |
| `elevated` | 需要额外审批：脱离沙箱、网络下载、影响 Git 历史、访问工作区外路径 |

### 6.3 工具矩阵

| 工具 | 用途 | 权限 | Plan Mode | 需审批 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `read_file` | 读文件 | `read` | 允许 | 否 | 文本文件优先，PDF/图片后置 |
| `list_dir` | 列目录 | `read` | 允许 | 否 | 仅工作区内 |
| `search_files` | 文件名 / 内容检索 | `read` | 允许 | 否 | 优先 `rg` |
| `edit_file` | 精确替换式编辑 | `write` | 禁止直接执行 | 是 | 先 plan，后 approval |
| `write_file` | 新建或整体重写 | `write` | 禁止直接执行 | 是 | 限工作区内 |
| `run_shell` | 受控 shell | `execute` | 禁止直接执行 | 是 | 默认白名单 |
| `git` | 受控 Git | `execute` | 部分允许 | 是 | `status/diff` 可降级 |

### 6.4 工具最小契约

#### `read_file`

```json
{ "path": "packages/cli/src/runtime/runtime-factory.js" }
```

规则：路径必须在工作区内、默认仅文本文件、大文件需截断并返回截断标记。

#### `list_dir`

```json
{ "path": "desktop-app-vue/src/main", "depth": 2 }
```

规则：限制最大深度与最大返回项数。

#### `search_files`

```json
{ "query": "code-agent-ipc", "path": "desktop-app-vue/src/main", "mode": "content" }
```

规则：优先 `rg`、限制结果条数、返回路径与上下文片段。

#### `edit_file`

```json
{
  "path": "desktop-app-vue/src/main/ipc/ipc-registry.js",
  "edits": [{ "oldText": "old snippet", "newText": "new snippet" }]
}
```

规则：首版精确替换、不支持工作区外写入、必须经 plan + approval。

#### `write_file`

```json
{ "path": "docs/implementation-plans/new-doc.md", "content": "# title" }
```

规则：新建文件允许；覆盖现有文件需更高风险提示；必须经 plan + approval。

#### `run_shell`

```json
{ "command": "npm run test:jest", "cwd": "C:\\code\\chainlesschain", "timeoutMs": 120000 }
```

规则：默认仅工作区内运行；首版尽量限制到只读 / 验证型命令；高风险命令必须审批；需结构化返回 exitCode、stdout、stderr。

#### `git`

```json
{ "command": "status", "cwd": "C:\\code\\chainlesschain" }
```

规则：`status` / `diff` / `log` 视为低风险；`commit` / `push` / `reset` / `checkout` / `rebase` 高风险；首版不默认开放破坏性 Git。

### 6.5 Plan Mode 行为矩阵

| 工具 | 计划阶段 | 执行阶段 | 说明 |
| --- | --- | --- | --- |
| `read_file` | ✅ | ✅ | 计划时允许读上下文 |
| `list_dir` | ✅ | ✅ | 计划时允许探查目录 |
| `search_files` | ✅ | ✅ | 计划时允许定位影响面 |
| `edit_file` | ❌ | ✅ | 需 plan + approval |
| `write_file` | ❌ | ✅ | 需 plan + approval |
| `run_shell` | ❌ | ✅ | 需明确批准 |
| `git` | 部分 | ✅ | 只读 Git 在计划期可放行 |

计划阶段只读 Git 例外：`git status`、`git diff`、`git log --oneline`。

### 6.6 审批策略

**自动放行**：`read_file` / `list_dir` / `search_files`、计划阶段只读 Git 查询

**必须审批**：`edit_file` / `write_file` / `run_shell`、非只读 Git、工作区外路径访问、脱离沙箱

**默认拒绝**：工作区外递归写入、未审批的破坏性 Git、未审批的网络下载、删除类工具、浏览器自动化与 GUI 控制类工具

### 6.7 命令白名单与高风险清单

**首版 `run_shell` 白名单**

```
npm run test:*
npm run lint
npm run build:*
npx playwright test <single-file>
git status
git diff
rg <pattern>
```

**默认高风险**

```
rm / del
git reset
git checkout --
git clean
curl / wget
powershell -EncodedCommand
```

## 7. Desktop ↔ CLI Bridge 时序

### 7.1 参与者

- `Renderer` — Vue 界面
- `Electron IPC` — Renderer ↔ Main 通信
- `CodingAgentSessionService` — Main 会话服务
- `CodingAgentBridge` — Main → CLI runtime 适配
- `CLI Runtime` — `packages/cli` agent runtime
- `Tool Layer` — 文件、搜索、shell、git、MCP
- `Permission Gate` — 审批与策略

### 7.2 总体时序

```text
Renderer
  -> IPC: coding-agent:start-session
  -> Main/SessionService: create session
  -> Bridge: create runtime session
  -> CLI Runtime: session.started
  -> Main: forward
  -> Renderer: ready

Renderer
  -> IPC: coding-agent:send-message
  -> Main/SessionService: validate
  -> Permission Gate: preflight
  -> Bridge: submit
  -> CLI Runtime: request.accepted / assistant.delta / tool.call.started
  -> Main: forward
  -> Renderer: render

If approval required:
  Runtime/Main -> Renderer: approval.requested
  Renderer -> Main: respond-approval
  Main -> Runtime: result
  Runtime -> Main -> Renderer: continue

On completion:
  Runtime -> Main: assistant.final + session.completed
  Main -> Renderer: final
```

### 7.3 详细流程

#### 创建会话

IPC：`coding-agent:start-session`

```json
{
  "workspacePath": "C:\\code\\chainlesschain",
  "mode": "interactive",
  "resumeSessionId": null
}
```

Main 处理：校验工作区路径 → 创建 `sessionId` → 初始化 `SessionService` → 通过 `Bridge` 创建 CLI runtime session → 转发 `session.started`。

#### 发送消息

IPC：`coding-agent:send-message`

```json
{ "sessionId": "sess_001", "message": "帮我分析 code-agent 的 IPC 入口并给出重构方案" }
```

Main 处理：校验 `sessionId` → 分配 `requestId` → 记录上下文 → 前置策略检查 → 转发到 CLI runtime。

CLI runtime：`request.accepted` → agent loop → `assistant.delta` → 工具调用对 → `assistant.final` → `session.completed`。

#### 工具调用与事件回传

统一路径：

```
CLI Runtime → CodingAgentBridge → CodingAgentSessionService → Electron IPC → Renderer
```

CLI runtime 不直接操作 Renderer。这样做的目的：降低 UI 与 runtime 耦合、Main 统一做权限和审计、CLI 与桌面共享同一 runtime。

#### 审批

写文件、执行 shell、非只读 Git、MCP 高风险时：

1. CLI runtime 生成 `approval.requested`
2. Main 暂停该次工具执行
3. Main 把请求转发给 Renderer
4. Renderer 弹窗
5. 用户决定
6. Renderer 通过 IPC 回传
7. Main 把结果送回 CLI runtime
8. runtime 发出 `approval.granted` / `approval.denied`
9. 继续执行或终止该步骤

IPC：`coding-agent:respond-approval`

```json
{
  "sessionId": "sess_001",
  "requestId": "req_001",
  "approvalId": "appr_001",
  "decision": "granted"
}
```

#### 中断

IPC：`coding-agent:interrupt` → `CodingAgentSessionService.interruptSession()` → `CodingAgentBridge` →
CLI runtime `ws-agent-handler` 通过共享 `abort-utils.js` 向当前 turn 的 `AbortController`
广播 `AbortError("Session interrupted by client")` → `agent-core` / `interaction-adapter`
立即抛出、释放等待中的审批 / 工具调用，runtime 发出 `session.interrupted` → 转发给 renderer。

关键点：

- `interrupt` 不再是 `close-session` 的别名，session 依然存活可继续使用
- `AbortController` 在每个 turn 开始时新建，结束后清理，避免跨 turn 状态泄漏
- `interaction-adapter.rejectAllPending(reason)` 会把所有 pending 审批请求以 `AbortError` 拒绝，
  调用方可通过 `isAbortError(err)` 区分中断与真实错误

#### 恢复

IPC：`coding-agent:resume-session` → Main 加载 session store → 恢复摘要 / 历史 / 计划状态 → bridge 恢复 runtime → 转发 `session.resumed`。

### 7.4 推荐 IPC 清单

| IPC | 方向 | 用途 |
| --- | --- | --- |
| `coding-agent:start-session` | R → M | 创建会话（`start-session` 为 `create-session` 别名） |
| `coding-agent:resume-session` | R → M | 恢复历史会话 |
| `coding-agent:send-message` | R → M | 发送消息 |
| `coding-agent:interrupt` | R → M | **真实中断**当前 turn，保留 session（`AbortController`） |
| `coding-agent:close-session` | R → M | 关闭并清理 session |
| `coding-agent:respond-approval` | R → M | 回传审批（plan / high-risk 通用） |
| `coding-agent:list-sessions` | R → M | 查询会话列表 |
| `coding-agent:get-session-state` | R → M | 查询状态 |
| `coding-agent:harness-status` | R → M | 聚合 sessions / worktrees / backgroundTasks（Phase 5 最小 harness） |
| `coding-agent:list-background-tasks` | R → M | 列出后台任务 |
| `coding-agent:get-background-task` | R → M | 读取后台任务详情 |
| `coding-agent:get-background-task-history` | R → M | 读取后台任务事件历史 |
| `coding-agent:stop-background-task` | R → M | 停止运行中的后台任务 |
| `coding-agent:subscribe-events` | M → R | 推送事件流（`webContents.send`） |

### 7.5 不推荐的实现方式

1. **在 Electron Main 复制 agent loop** — CLI / 桌面分叉，测试与维护倍增
2. **继续把 `code-agent-ipc.js` 扩展成超大 one-shot RPC** — 不适合多轮、流式、审批中断与恢复
3. **Renderer 直接知道工具实现细节** — UI 耦合过深，runtime 切换成本高

## 8. 分阶段实施

### Phase 0 — 基线收敛 ✅

- 盘点 CLI runtime 可复用 API
- 盘点 desktop code-agent / plan-mode / MCP 接入点
- 定义统一事件协议（本文 §5）
- 定义 MVP 工具清单与权限矩阵（本文 §6）
- 定义桌面到 CLI 的 bridge 时序（本文 §7）

**退出标准**：会话协议确定 / MVP 工具范围确定 / CLI 与 Desktop 职责边界确定。

### Phase 1 — MVP Runtime Kernel

在 CLI runtime 落地多轮 coding agent loop。

- session 创建与恢复
- 多轮消息循环
- 工具调度
- 流式事件输出
- prompt compression hook
- session persistence hook

**MVP 工具**：`read_file` / `list_dir` / `search_files` / `edit_file` / `write_file` / `run_shell` / 可选 `git`

**建议落点**：`packages/cli/src/runtime/`、`packages/cli/src/tools/`、`packages/cli/src/lib/agent-core.js`（或更窄的 kernel 模块）

**退出标准**：agent 可读取仓库上下文 / 完成"分析 → 修改 → 验证"闭环 / CLI 模式事件流稳定 / 工具失败结构化返回

### Phase 2 — 权限与安全 Harness

让 agent 可以安全地在真实仓库工作。

- 工具描述与权限级别统一
- 写入 / 执行 / 删除 / 高风险 Git 接入 plan mode
- 审批检查点
- 统一 CLI 与 Desktop 的 allow / deny / ask 语义
- 工具执行边界 telemetry tags

**复用**：`packages/cli/src/tools/registry.js`、`desktop-app-vue/src/main/ai-engine/plan-mode/index.js`

**退出标准**：只读链路无额外审批噪音 / 写与执行链路一致审批 / 权限决策清晰展示 / Plan Mode 能解释阻断原因

### Phase 3 — Desktop Bridge

把 CLI runtime 暴露为桌面端 Coding Agent 服务。

- 构建 Main session service
- 构建 Electron IPC 到 CLI runtime 的桥接层
- 注册 v3 IPC
- session 事件流推送给 renderer
- 保留旧 `code-agent:*` 兼容层或转发到新服务

**新增模块**：`coding-agent-session-service.js` / `coding-agent-bridge.js` / `coding-agent-permission-gate.js` / `coding-agent-events.js` / `coding-agent-ipc-v3.js`

**退出标准**：桌面端可启动 / 流式接收 / 中断 / 恢复一个 coding session；renderer 收到结构化事件；plan + approval 可通过 UI 交互。

### Phase 4 — MCP 与技能接入

- 通过 runtime registry 暴露 MCP 工具
- 按权限级别与信任来源分类
- skill 作为按需上下文或工具扩展接入
- 默认关闭高风险或未知来源 MCP server

**复用**：`desktop-app-vue/src/main/mcp/`、`packages/cli/src/lib/mcp-client.js`

**退出标准**：可信 MCP 可列出与调用 / 高风险 MCP 被门控 / skill 不污染默认上下文。

### Phase 5 — 高阶 Harness（最小集 ✅ / CLI 扩展能力 ✅）

**本轮已完成（最小 Harness 主线）**：

- `CodingAgentSessionService.getHarnessStatus()`：统一聚合 `sessions` / `worktrees` / `backgroundTasks`
  三类概览，供 renderer 一次性读取
- 后台任务只读 + 停止 API：`list-background-tasks` / `get-background-task` /
  `get-background-task-history` / `stop-background-task`，在 Desktop main / IPC / preload /
  renderer store 全链路补齐
- Desktop 聊天页 (`AIChatPage.vue`) 新增 **Coding Agent Harness** 面板，展示会话 / worktree /
  后台任务概览，支持刷新、查看后台任务详情与历史、停止后台任务
- `coding-agent:interrupt` 收口为真实中断（见 §7.3 中断小节），不再复用 close 语义
- 整体 Phase 5 最小 harness 定向回归通过：`5 files, 84 passed`，AIChatPage harness 面板
  页面回归通过：`1 file, 69 passed`

**CLI 扩展能力（已落地，详见 §8）**：

- **子代理委派**：`spawn_sub_agent` 工具 + `SubAgentRegistry` 单例 + `sub-agent.*` 事件 +
  WS `sub-agent-list` / `sub-agent-get`。子代理拥有独立 message history，结束后只把摘要回写父
  会话；事件 payload 携带 `parentSessionId` + `subAgentId`，UI 可按父 turn 分组。
- **Review mode**：`enterReview` / `submitReviewComment` / `resolveReview` /
  `getReviewState` / `isReviewBlocking`；阻塞模式下 `handleSessionMessage` 必须以
  `REVIEW_BLOCKING` 短路。WS：`review-enter` / `review-submit` / `review-resolve` /
  `review-status`。事件：`review.requested` / `review.updated` / `review.resolved` /
  `review.state`。
- **Patch preview / diff 总结**：`proposePatch` / `applyPatch` / `rejectPatch` /
  `getPatchSummary` / `hasPendingPatches`，在 session 上维护 `pendingPatches` Map +
  `patchHistory` 数组，并按文件维度计算 `{ added, removed }`。WS：`patch-propose` /
  `patch-apply` / `patch-reject` / `patch-summary`。事件：`patch.proposed` /
  `patch.applied` / `patch.rejected` / `patch.summary`。
- **持久化任务图编排**：`createTaskGraph` / `addTaskGraphNode` / `updateTaskGraphNode` /
  `advanceTaskGraph` / `getTaskGraph`，session metadata 序列化整张 DAG，CLI 重启后可继续
  编排；`advanceTaskGraph` 把所有依赖已满足的 `pending` 节点提升为 `running`。WS：
  `task-graph-create` / `task-graph-add-node` / `task-graph-update-node` /
  `task-graph-advance` / `task-graph-state`。事件：`task-graph.created` /
  `task-graph.updated` / `task-graph.node.added` / `task-graph.node.updated` /
  `task-graph.node.completed` / `task-graph.node.failed` / `task-graph.advanced` /
  `task-graph.completed` / `task-graph.state`。

**Desktop 端落地策略**：四类扩展能力先在 CLI runtime 内沉淀稳定 API 与事件协议，
Desktop renderer 的 review drawer / diff strip / sub-agent timeline / task-graph 视图
留到下一轮实现。CLI WS 协议本身已通过 `ws-session-workflow` 集成测试覆盖。

**原则**：每项必须是可选层，基础 coding agent 在不启用时仍可正常工作。

### Phase 5 扩展能力详细设计（CLI 端 ✅）

#### 子代理委派（spawn_sub_agent）

- 工具入口：`packages/cli/src/lib/agent-core.js` `spawn_sub_agent` 工具描述
- 注册中心：`packages/cli/src/lib/sub-agent-registry.js` 单例 `SubAgentRegistry`
- 上下文：`packages/cli/src/lib/sub-agent-context.js`，子代理拥有自己的 `messages` /
  `toolsUsed` / `tokenCount` / `iterationCount`
- 父子隔离：子代理的工具白名单可由 `tools: [...]` 限制；默认继承父代理工具集
- 事件：`sub-agent.started` / `sub-agent.progress` / `sub-agent.completed` /
  `sub-agent.failed`，每条事件 payload 都带 `parentSessionId` 与 `subAgentId`
- 历史容量：最近 100 条放在 RingBuffer，再老的丢弃；活动子代理保留在 Map 中
- 外部观察接口（WS）：
  - `sub-agent-list` → 当前活动 + 最近完成快照 + 累计统计
  - `sub-agent-get { subAgentId }` → 单个子代理详情

#### Review mode

- 数据结构：`session.reviewState = { reviewId, status, reason, requestedBy, requestedAt,
  resolvedAt, resolvedBy, decision, blocking, comments[], checklist[], summary? }`
- 状态机：`null` → `pending`（`enterReview`）→ `approved` / `rejected`（`resolveReview`）
- 阻塞语义：`isReviewBlocking(sessionId)` 在 `pending` + `blocking === true` 时返回 true，
  agent handler 在执行 turn 前必须检查并以 `REVIEW_BLOCKING` 错误短路
- 评论与 checklist：`submitReviewComment` 支持单次同时追加 `comment` 与 `checklistItem` 更新
- 持久化：`reviewState` 跟随 session 一起被 `_persistSessionState` 写盘
- WS：`review-enter` / `review-submit` / `review-resolve` / `review-status`
- 事件：`review.requested` / `review.updated` / `review.resolved` / `review.state`

#### Patch preview / diff 总结

- 数据结构：
  - `session.pendingPatches: Map<patchId, patch>`
  - `session.patchHistory: Array<patch>`
  - `patch = { patchId, status, origin, reason, requestId, proposedAt, resolvedAt,
    resolvedBy, files: [...], stats: { fileCount, added, removed } }`
  - `file = { index, path, op, before, after, diff, stats: { added, removed } }`
- 行数统计：当 file 没有显式 `stats` 时使用 `_computePatchStats` 启发式计算（创建/删除按
  全文行数算；修改按行数差算）
- 三种解析路径：
  - `applyPatch(sessionId, patchId, { resolvedBy, note })` → 移到 history，状态 `applied`
  - `rejectPatch(sessionId, patchId, { resolvedBy, reason })` → 移到 history，状态 `rejected`
  - `getPatchSummary(sessionId)` → `{ pending, history, totals }`
- WS：`patch-propose` / `patch-apply` / `patch-reject` / `patch-summary`
- 事件：`patch.proposed` / `patch.applied` / `patch.rejected` / `patch.summary`

#### 持久化任务图与编排器

- 数据结构：`session.taskGraph = { graphId, title, createdAt, updatedAt, nodes: { [id]:
  { id, title, status, dependsOn: [...], metadata, result, error, startedAt, completedAt } } }`
- 节点状态机：`pending` → `running` → `completed` / `failed`
- `advanceTaskGraph` 算法：遍历所有 `pending` 节点，若其 `dependsOn` 全部为 `completed`
  则立即标记为 `running` 并发出 `task-graph.advanced` 事件
- 序列化：`_serializeTaskGraph` / `_hydrateTaskGraph` 在 session 持久化与恢复时使用，
  CLI 重启后任务图依然可用
- 边界保护：未声明的依赖节点抛 `INVALID_DEPENDENCY`；重复 `nodeId` 抛 `DUPLICATE_NODE`
- WS：`task-graph-create` / `task-graph-add-node` / `task-graph-update-node` /
  `task-graph-advance` / `task-graph-state`
- 事件：`task-graph.created` / `task-graph.updated` / `task-graph.node.added` /
  `task-graph.node.updated` / `task-graph.node.completed` / `task-graph.node.failed` /
  `task-graph.advanced` / `task-graph.completed` / `task-graph.state`

#### 与最小 harness 的关系

| 维度 | 最小 harness | Phase 5 扩展能力 |
| --- | --- | --- |
| 时间作用域 | 单次后台任务 | session 级 DAG / review / patch |
| 持久化 | `background-task-manager` 自身记录 | 写入 session metadata 一起持久化 |
| Desktop UI | 已就位（Harness 面板） | CLI 协议先就位，Desktop 视图后续 |
| 中断语义 | `stop-background-task` | `coding-agent:interrupt` + review 阻塞门控 |

## 9. 测试计划

### 9.1 单元

- 工具描述标准化
- 权限策略解析
- Plan Mode 门控
- 事件信封格式化与序列号校验
- session 持久化与恢复

### 9.2 集成

- CLI 多轮 session 的"读文件 → 编辑文件"闭环
- Desktop IPC 启动到完成的会话链路
- 审批请求往返流程
- MCP trusted 与 blocked 场景

### 9.3 E2E

- 用户要求 agent 分析代码、生成计划、修改一个文件并执行验证命令
- 用户拒绝高风险操作后 agent 能稳定恢复
- 用户恢复旧会话并继续任务

### 9.4 当前测试文件

**CLI runtime（envelope v1.0 专项）**

- `packages/cli/__tests__/unit/web-ui-envelope.test.js` — 28 测试，UNIFIED_TO_LEGACY 映射 + `unwrapEnvelope` + 浏览器内联源
- `packages/cli/__tests__/unit/ws-runtime-events.test.js` — 16 测试，session / worktree 事件信封发射
- `packages/cli/__tests__/integration/ws-session-workflow.test.js` — 19 测试，多步 session 工作流
- `packages/cli/__tests__/e2e/coding-agent-envelope-roundtrip.test.js` — 7 测试，真实 spawn `chainlesschain serve` 子进程 + WebSocket 信封 roundtrip

**Desktop main（桥接 + IPC + Session）**

- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` — 22 测试（含 9 个 v1.0 信封拆封用例）
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-ipc-v3.test.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-session-service.test.js`
- `desktop-app-vue/tests/unit/v50210-workflow.test.js` / `coding-agent-contract.test.js` / `ws-session-manager.test.js`

**Renderer**

- `desktop-app-vue/src/renderer/stores/__tests__/coding-agent.test.ts`
- `desktop-app-vue/tests/unit/pages/AIChatPage.test.js`

**总计**: 408 测试通过，覆盖 CLI runtime / Desktop main / Renderer 三端 + envelope v1.0 wire roundtrip。

## 10. 主要风险

### 10.1 双内核分叉

CLI 与 Desktop 演化成两套不同 agent 实现 → 只保留一个 runtime kernel，Desktop 只做宿主与桥接。

### 10.2 权限行为不一致

CLI 与 Desktop 对允许 / 拒绝的理解不一致 → 统一工具元数据模型与策略词汇表。

### 10.3 上下文膨胀

大仓库与长会话快速耗尽上下文窗口 → 尽早接入 prompt compression 与 session summarization。

### 10.4 MVP 过度设计

首版引入过多模块 → 严格控制在 6-7 个工具与一套稳定 session 协议。

## 11. 第一里程碑完成定义

- 用户可从 CLI 或 Desktop 发起多轮 coding session
- agent 可完成"读取 → 计划 → 修改 → 验证"闭环
- 写入与执行动作受 plan mode + 审批控制
- 会话可恢复
- 事件流稳定
- 核心 runtime / 权限流 / bridge 集成具备基础测试覆盖

## 12. 验收标准（Phase 0）

### 事件协议

- CLI 与 Desktop 使用同一事件信封
- Renderer 不需要依赖字符串解析工具输出
- 权限审批有独立事件类型
- 计划模式有独立事件类型
- 错误事件带稳定错误码

### 工具与权限

- 工具集合控制在 7 个左右
- 每个工具都有稳定 schema
- 每个工具都有明确权限级别
- Plan Mode 是否允许调用有明确定义
- 审批策略可直接映射到 CLI 与 Desktop

### Bridge 时序

- Renderer 能创建并关闭会话
- Renderer 能发送多轮消息
- Main 能稳定转发 runtime 流式事件
- 审批流程可回传到 runtime
- 会话可恢复
- 不需要在 Renderer 中解析杂乱字符串判断工具状态

## 12.5 Phase 5 — 持久化任务图与编排器（v0.45.66+）

### 设计目标

让 Coding Agent 不仅能"对话",还能围绕一个**持久化的任务 DAG**编排多步骤工作。任务图存活在 session 内、跨重启可恢复,并以统一信封事件向 Desktop / Renderer 广播状态变化。

### 任务图模型

```ts
interface TaskNode {
  id: string;                                       // session 内唯一
  title: string;
  description: string | null;
  status: "pending" | "ready" | "running"
        | "completed" | "failed" | "skipped";
  dependsOn: string[];                              // 必须先完成的 nodeId
  metadata: Record<string, any>;
  createdAt: string; updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: any;
  error: any;
}

interface TaskGraph {
  graphId: string;
  title: string | null;
  description: string | null;
  status: "active" | "completed" | "failed";
  order: string[];                                  // 拓扑序
  nodes: Record<string, TaskNode>;
  createdAt: string; updatedAt: string;
  completedAt: string | null;
}
```

任务图作为 session 状态的一部分序列化,与 session 一同持久化与恢复。

### 编排器语义

- **`advanceTaskGraph`** — 将所有依赖均已 `completed`/`skipped` 的 `pending` 节点提升为 `ready`,返回新提升的 nodeId 列表 (`becameReady`)
- **自动完成** — 当所有节点进入终态时,图状态自动跃迁为 `completed`(无失败)或 `failed`(存在失败)
- **失败传播** — 失败节点的下游依赖在 `advance` 时不会被提升

### WebSocket 协议(请求 → 信封事件)

| 请求 type              | 载荷                                       | 响应信封 type                |
| ---------------------- | ------------------------------------------ | ---------------------------- |
| `task-graph-create`    | `{sessionId, title?, description?, nodes}` | `task-graph.created`         |
| `task-graph-add-node`  | `{sessionId, node}`                        | `task-graph.node.added`      |
| `task-graph-update-node` | `{sessionId, nodeId, updates}`           | `task-graph.node.updated` / `task-graph.node.completed` / `task-graph.node.failed` |
| `task-graph-advance`   | `{sessionId}`                              | `task-graph.advanced`        |
| `task-graph-state`     | `{sessionId}`                              | `task-graph.state`           |
| (auto)                 | —                                          | `task-graph.completed`       |

所有响应都是统一信封 `{version:"1.0", eventId, type, requestId, sessionId, source:"cli-runtime", payload:{graph, ...}}`。

### 三层贯穿

1. **CLI 层** (`packages/cli/src/lib/agent-core.js` + `gateways/ws/session-protocol.js`) — 持有任务图、执行 advance、发出信封
2. **Desktop Main 层** (`coding-agent-bridge.js` + `coding-agent-session-service.js` + `coding-agent-ipc-v3.js`) — bridge 拆信封返回 payload,session-service 暴露领域 API,IPC v3 转发到 Renderer
3. **Renderer 层** (`stores/coding-agent.ts`) — Pinia store 持有 `taskGraphs: Record<sessionId, TaskGraph>`,9 种 lifecycle 事件类型实时更新

### IPC v3 通道

- `coding-agent:task-graph:create`
- `coding-agent:task-graph:add-node`
- `coding-agent:task-graph:update-node`
- `coding-agent:task-graph:advance`
- `coding-agent:task-graph:state`

### 测试矩阵

| 层 | 文件 | 用例 |
| -- | ---- | --- |
| CLI 单元 | `packages/cli/__tests__/unit/agent-core.test.js` | 任务图 CRUD + advance + 自动完成 |
| CLI 集成 | `packages/cli/__tests__/integration/ws-session-workflow.test.js` | WS 协议 round-trip |
| CLI E2E | `packages/cli/__tests__/e2e/coding-agent-envelope-roundtrip.test.js` | 真实 `chainlesschain serve` 子进程信封 round-trip |
| Desktop 单元 | `coding-agent-bridge.test.js` / `coding-agent-ipc-v3.test.js` / `coding-agent-session-service.test.js` | bridge 拆信封 + service 委托 + IPC v3 |
| Desktop 集成 | `tests/integration/coding-agent-lifecycle.integration.test.js` | MockBridge 内存图全生命周期 |
| Desktop E2E | `tests/integration/coding-agent-bridge-real-cli.test.js` | 真实 CLI 子进程任务图 round-trip |
| Renderer | `stores/__tests__/coding-agent.test.ts` | store actions + lifecycle 事件应用 |

## 13. 相关文档

### 用户文档

- `docs-site/docs/chainlesschain/coding-agent.md`

### Phase 0 实施计划（源文档）

- `docs/implementation-plans/LEARN_CODING_AGENT_IMPLEMENTATION_PLAN.md`
- `docs/implementation-plans/CODING_AGENT_EVENT_SCHEMA.md`
- `docs/implementation-plans/CODING_AGENT_MVP_TOOL_PERMISSION_MATRIX.md`
- `docs/implementation-plans/CODING_AGENT_DESKTOP_CLI_BRIDGE_SEQUENCE.md`

### 关联模块

- `docs/design/modules/77_Agent架构优化系统.md`
- `docs/design/modules/78_CLI_Agent_Runtime重构实施计划.md`
- `docs/design/modules/71_子代理隔离系统.md`
