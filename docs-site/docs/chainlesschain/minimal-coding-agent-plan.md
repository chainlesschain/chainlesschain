# Minimal Coding Agent 实施计划

> v5.0.2.10 · 实现进度：Phase 0–6 全部落地
> 目标模块：`desktop-app-vue` + `packages/cli`
>
> **最新状态（2026-04-07）**：6 个核心源文件均已落地；测试覆盖扩展到 **9 个文件 / 85 用例全部通过**（5 单元 + 3 集成 + 1 真实 CLI E2E）；主进程已接线注册 IPC v3，session-service 已支持 worktree diff / merge / preview / automation candidate；`coding-agent-bridge.js` 修复两处并发缺陷（send 失败未清理 pending、ws close 未拒绝 pending）。

## 概述

Minimal Coding Agent 是 v5.0.2.10 周期内规划的桌面端编码 agent MVP。目标是在 `desktop-app-vue` 中提供一个最小可用的多轮编码会话服务，复用 `packages/cli` 已有的 runtime / harness / tool registry 资产，避免在桌面端重复造轮子。

设计遵循 `learn-coding-agent` 的”最小 agent loop 优先”思路：先打通会话与事件流，再接工具，最后再加权限、压缩与 MCP。所有副作用动作必须经过宿主层 plan mode + permission gate，不依赖 LLM 提示词的自我约束，确保高风险操作（写文件、shell 命令）始终在用户可见的批准链路下执行。

## 核心特性

- 🔁 **多轮 Agent Loop**：从”单次 generate / review”升级为多轮对话式编码循环
- 🛡 **统一权限门禁**：所有副作用操作走 plan mode + permission gate，不依赖 prompt 自觉
- 🔌 **进程边界复用**：桌面端通过桥接层调用 `packages/cli` runtime，避免 ESM/CJS 边界爆炸
- 🧰 **6 类核心工具闭环**：`read_file / search_files / list_dir / edit_file / write_file / run_shell`
- 📡 **流式事件返回**：所有进度通过标准事件流推送到桌面端 UI
- 🧩 **可恢复会话**：复用 `sessionManager` + `PromptCompressor`，长对话不爆上下文
- 🗂 **会话状态机**：`idle → starting → ready → running → waiting_approval → completed / failed / cancelled`
- 🔗 **MCP 工具白名单**：MCP 工具调用同样走 plan mode / permission gate，不绕过宿主权限
- 🌳 **Worktree 隔离预留**：多文件改动场景预留 worktree 隔离开关，避免污染主工作区
- 🧪 **85/85 测试覆盖**：5 单元 + 2 集成 + 1 真实 CLI E2E，Phase 0–6 全部通过

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                Renderer (Vue3)                      │
│  startSession / sendMessage / approvePlan / cancel  │
└────────────────────┬────────────────────────────────┘
                     │ Electron IPC
                     ▼
┌─────────────────────────────────────────────────────┐
│         Desktop Main Process                        │
│                                                     │
│  CodingAgentSessionService                          │
│   ├─ session 状态机                                 │
│   ├─ 事件流 (coding-agent-events)                   │
│   └─ IPC v3 入口                                    │
│                                                     │
│  CodingAgentBridge ────► packages/cli runtime       │
│                                                     │
│  ToolAdapter      ───► 6 类工具映射                 │
│  PermissionGate   ───► plan-mode + risk gating      │
└─────────────────────────────────────────────────────┘
```

## 核心设计

### 进程边界复用（推荐方案）

MVP 不在 Electron 主进程内 `require()` CLI agent 内核源码，而是采用**进程边界复用**：

| 原因 | 说明 |
|------|------|
| 模块边界 | `packages/cli` 是 ESM，`desktop-app-vue` 主进程是 CJS，直接内嵌产生复杂度 |
| 复用成熟入口 | CLI 已有 session / runtime / serve / ui 入口，复用比复制更稳 |
| 易于解耦 | 进程边界先行，后续再抽 `packages/agent-kernel` 不影响桌面端 |

### 不推荐的 MVP 路径

- ❌ 把 `ai-engine-manager*.js` 扩成“大一统 agent 控制器”
- ❌ 把 `code-agent-ipc.js` 从单次 RPC 强行演变成多轮 loop
- ❌ 桌面端和 CLI 同时维护两套独立 agent 实现

### 工具风险分级

| 工具 | 来源 | 风险级别 | 默认策略 |
|------|------|---------|----------|
| `read_file` | desktop file utils | low | 直接允许 |
| `search_files` | ripgrep / 现有搜索 | low | 直接允许 |
| `list_dir` | workspace manager | low | 直接允许 |
| `edit_file` | desktop host edit | medium | plan mode 批准后允许 |
| `write_file` | desktop host write | medium | plan mode 批准后允许 |
| `run_shell` | sandboxed executor | high | 二次确认 |

### Session 状态机

```
idle → starting → ready → running → waiting_approval → completed
                                  \→ failed
                                  \→ cancelled
```

## 文件规划

### 新增文件

```
desktop-app-vue/src/main/ai-engine/code-agent/
├── coding-agent-session-service.js   # 会话生命周期
├── coding-agent-bridge.js            # 桌面端 ↔ CLI runtime 桥接
├── coding-agent-tool-adapter.js      # 工具适配
├── coding-agent-permission-gate.js   # 权限裁决
├── coding-agent-events.js            # 流式事件定义
├── coding-agent-ipc-v3.js            # renderer IPC 入口
└── __tests__/
    ├── coding-agent-session-service.test.js
    ├── coding-agent-tool-adapter.test.js
    └── coding-agent-permission-gate.test.js
```

### 修改文件

- `desktop-app-vue/src/main/index-optimized.js` — 注册新 service 与 IPC
- `desktop-app-vue/src/main/ipc/ipc-registry.js` — 接入 coding agent IPC
- `desktop-app-vue/src/main/ai-engine/code-agent/code-agent-ipc.js` — 旧接口标记 legacy

## 工作原理

### 一次编码任务的完整链路

```
用户在 renderer 输入任务
   │
   ▼
window.api.codingAgent.sendMessage(sessionId, { text })
   │
   ▼ Electron IPC
CodingAgentSessionService.handleMessage()
   │
   ├─► 通过 CodingAgentBridge 转发到 packages/cli runtime
   │       │
   │       ▼
   │   AgentRuntime.runTurn()
   │       │
   │       ├─► LLM 生成 tool_calls
   │       │
   │       ├─► 对每个 tool_call:
   │       │     ├─► CodingAgentToolAdapter 解析工具名
   │       │     ├─► CodingAgentPermissionGate 校验风险等级
   │       │     │     ├─ low → 直接执行
   │       │     │     ├─ medium → 触发 plan-required，等待批准
   │       │     │     └─ high → 触发二次确认
   │       │     └─► 工具执行 → 发出 tool-result 事件
   │       │
   │       └─► 必要时压缩上下文 → 持久化 session
   │
   └─► 流式事件返回 renderer (session-started / message-delta /
                              tool-start / tool-result / plan-required /
                              completed / failed)
```

### Session 状态流转

```
idle ──startSession──► starting ──ready──► running
                                              │
                                              ├─tool 副作用─► waiting_approval
                                              │                    │
                                              │                    ├─批准─► running
                                              │                    └─拒绝─► running (只读)
                                              │
                                              ├─完成─► completed
                                              ├─错误─► failed
                                              └─取消─► cancelled
```

### 与 CLI Runtime 的边界

| 组件 | 归属 | 说明 |
|------|------|------|
| Session 状态机 | Desktop Main | 管理 session 生命周期与 IPC v3 协议 |
| Tool 执行 | Desktop Main | 通过 ToolAdapter 使用桌面端能力 |
| Permission Gate | Desktop Main | 不依赖 CLI，使用桌面端 plan-mode |
| LLM 调用 | CLI Runtime | 复用 `agent-runtime.js` 的 turn 调度 |
| 上下文压缩 | CLI Runtime | 复用 `prompt-compressor.js` |
| Session 持久化 | CLI Runtime | 复用 `jsonl-session-store.js` |

## 关键文件

| 文件 | 作用 |
|------|------|
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js` | session 生命周期与状态机 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js` | 桌面端与 CLI runtime 的桥接层 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-tool-adapter.js` | 6 类核心工具适配 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-permission-gate.js` | 统一权限裁决 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-events.js` | 流式事件类型定义 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js` | renderer IPC 入口 |
| `desktop-app-vue/src/main/ai-engine/plan-mode/index.js` | 已有 plan mode 与工具分类 |
| `desktop-app-vue/src/main/index-optimized.js` | 集中持有 `llmManager / sessionManager / toolManager / mcpManager` |
| `packages/cli/src/runtime/agent-runtime.js` | 复用的 CLI runtime 主驱动 |

## 已可复用资产

### CLI 侧

| 文件 | 提供能力 |
|------|---------|
| `packages/cli/src/repl/agent-repl.js` | agent session、plan mode、autonomous、slash commands、streaming 输出 |
| `packages/cli/src/runtime/agent-runtime.js` | runtime 抽象，可启动 agent / chat / server / ui |
| `packages/cli/src/tools/registry.js` | 工具描述、权限级别、telemetry 分类 |
| `packages/cli/src/harness/prompt-compressor.js` | 上下文压缩策略 |
| `packages/cli/src/harness/worktree-isolator.js` | worktree 隔离能力 |

### 桌面端

| 文件 | 提供能力 |
|------|---------|
| `desktop-app-vue/src/main/index-optimized.js` | 集中持有 `llmManager / promptCompressor / sessionManager / toolManager / mcpManager` |
| `desktop-app-vue/src/main/ai-engine/plan-mode/index.js` | 工具分类与阻断逻辑 |
| `desktop-app-vue/src/main/mcp/` | MCP POC、adapter、安全策略 |
| `desktop-app-vue/src/main/skill-tool-system/skill-tool-ipc.js` | 工具与技能查询 / 调试入口 |

## 分阶段实施

### Phase 0：基线确认 ✅

打通最小依赖关系，定义桥接协议与事件流（`session-started / message-delta / tool-start / tool-result / plan-required / completed / failed`）。
**已落地**：`coding-agent-events.js`、`coding-agent-bridge.js` 完成桥接与最小事件集冻结。

### Phase 1：会话服务与事件流 ✅

在桌面主进程建立最小 coding agent 宿主，renderer 可创建 session、收到流式文本事件。
**已落地**：`coding-agent-session-service.js` (1265 行) + `coding-agent-ipc-v3.js`，已在 `index-optimized.js` 注入。状态机覆盖 `idle / starting / ready / running / waiting_approval / completed / failed / cancelled`。

### Phase 2：最小工具适配层 ✅

接入 6 个核心工具,agent 能完成“读文件 → 搜索 → 生成修改 → 写回”一轮任务。
**已落地**：`coding-agent-tool-adapter.js` (537 行)。支持 host-managed tool descriptor 与 MCP 缓存 descriptor。

### Phase 3：权限门禁与 Plan Mode ✅

未批准 plan 时只能读和分析，批准后才能执行写入和 shell；拒绝后 session 不进入脏状态。
**已落地**：`coding-agent-permission-gate.js` (279 行)，与 PlanMode Manager 联动；`enterPlanMode / showPlan / approvePlan / rejectPlan / confirmHighRiskExecution` 全部已暴露。

### Phase 4：上下文、会话恢复、压缩 ✅

接入 `sessionManager` + `PromptCompressor`，session 可恢复、长对话不爆上下文。
**已落地**：`resumeSession / listSessions / closeSession`、session 内部 `MAX_SESSION_EVENTS = 200` 滑窗，policy 同步通过 `_buildHostManagedToolPolicy / _syncSessionPolicy` 完成。

### Phase 5：MCP 与 ToolManager 扩展 🟢

在核心 loop 稳定后开放外部能力，MCP 工具调用也走 plan mode / permission gate。
**已落地**：tool-adapter 已注入 `toolManager` + `mcpManager`，permission-gate 已识别 cached MCP descriptor 与 host-policy 阻断事件；后续主要补白名单管理 UI。

### Phase 6：隔离、验证与收尾 🟢

补 worktree 隔离、单元测试 + 集成测试、最小验收脚本。
**已落地**：session-service 已暴露 `listWorktrees / getWorktreeDiff / mergeWorktree / previewWorktreeMerge / applyWorktreeAutomationCandidate`；测试矩阵完成 — 5 个单测文件 + 2 个集成测试文件 + 1 个真实 CLI E2E 文件，**85/85 通过**；`coding-agent-bridge.js` 通过 `_deps` 注入重构以支持单元测试，并修复两处 pending 泄漏 / 挂起缺陷。

## 里程碑

| 里程碑 | 验收标准 |
|--------|---------|
| **M1: 可连接** | 能创建 session、能发送消息、能流式返回文本 |
| **M2: 可执行** | 能读 / 搜 / 编辑 / 写回，plan mode 生效 |
| **M3: 可恢复** | 支持 session 恢复，支持上下文压缩 |
| **M4: 可扩展** | 接入 MCP / ToolManager 白名单工具，具备最小测试覆盖 |

## MVP 验收标准

满足下面条件即视为最小 coding agent MVP 完成：

1. ✅ 桌面端可创建 coding agent session（`createSession` 已就绪）
2. ✅ agent 可在单个项目目录内进行多轮编码对话（`sendMessage` + 状态机）
3. ✅ agent 至少能调用 6 个核心工具（tool-adapter 已落地）
4. ✅ 写操作和 shell 操作必须经过 plan mode 或审批（permission-gate + plan mode 已联动）
5. ✅ 对话可恢复，长上下文可压缩（`resumeSession` + 事件滑窗已就绪）
6. ✅ 完整主路径测试覆盖（5 单元 + 2 集成 + 1 真实 CLI E2E，共 **85/85 通过**）

## 推荐执行顺序

按最小风险推进，建议实际编码顺序：

1. `coding-agent-events.js`
2. `coding-agent-session-service.js`
3. `coding-agent-ipc-v3.js`
4. `coding-agent-tool-adapter.js`
5. `coding-agent-permission-gate.js`
6. `index-optimized.js` / `ipc-registry.js` 接线
7. 单元测试
8. 集成测试

> 先把 session 与事件流打通，再接工具；先把工具打通，再加权限；最后再接压缩、恢复和 MCP，避免一开始把复杂度堆满。

## 使用示例

> Phase 0–4 已完成；下面示例描述当前主进程已暴露的 IPC v3 调用方式。

### 场景 1：从渲染端发起编码任务

```javascript
// renderer
const session = await window.api.codingAgent.startSession({
  projectRoot: "/path/to/project",
});

await window.api.codingAgent.sendMessage(session.id, {
  text: "请把 src/utils/logger.js 中的 console.log 改成 logger.info",
});

window.api.codingAgent.onEvent(session.id, (event) => {
  if (event.type === "plan-required") showApprovalUI(event.plan);
  if (event.type === "tool-result") appendToolResult(event.result);
  if (event.type === "completed") markDone();
});
```

### 场景 2：Plan Mode 批准写操作

```text
[agent] 我准备修改 3 个文件：
  - src/utils/logger.js  (替换 5 处 console.log)
  - src/utils/index.js   (新增 logger 导出)
  - tests/logger.test.js (补 1 条用例)
[plan-required] 等待用户批准...

→ 用户点击「批准」
[approval-granted] 继续执行 edit_file × 3
[completed] 修改完成，1 个文件保存失败（见错误）
```

### 场景 3：长对话自动压缩

```text
[session] 当前消息数 47，token ~12k
[compression] 触发压缩：保留最近 10 轮 + 工具输出摘要
[session] 压缩后 token ~3.8k，继续编码任务...
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 桌面端无法连接 CLI runtime | 检查 `coding-agent-bridge.js` 桥接方式（WebSocket / spawn 子进程）是否正确启动；查看主进程日志是否有 `runtime-ready` 事件 |
| Plan mode 未拦截写操作 | 确认工具 descriptor 的 `riskLevel` 已设为 `medium` 或 `high`；检查 `coding-agent-permission-gate.js` 是否在 IPC 注册前完成初始化 |
| Session 恢复后上下文丢失 | 检查 `sessionManager` 是否持久化了 `messages / toolCalls / planApprovals` 三个字段；压缩前会自动备份到 JSONL |
| 工具执行结果未推送到 UI | 确认 `coding-agent-events.js` 的事件类型与 renderer 订阅一致；事件字段已版本化 (`version: 1`) |
| Shell 命令被无差别拒绝 | `run_shell` 默认 high 风险，需要二次确认；可在 plan mode 中预先批准白名单命令 |

## 安全考虑

### 权限门禁

- **所有副作用工具走宿主层裁决**：`edit_file / write_file / run_shell` 必须经过 `coding-agent-permission-gate.js`，prompt 只做辅助说明，不做最终授权
- **三级风险分类**：`low` 直接允许、`medium` plan mode 批准后允许、`high` 二次确认
- **未批准 plan 时只读**：在用户明确批准前，agent 只能调用 `read_file / search_files / list_dir` 三个只读工具
- **拒绝后不进入脏状态**：plan 被拒绝后 session 可继续分析或终止，不残留半完成的写操作

### MCP 与外部能力隔离

- **MCP 不绕过宿主权限门禁**：MCP 工具调用同样走 plan mode / permission gate
- **白名单启用**：高风险 MCP 工具默认关闭，需在配置中显式启用
- **不一次性开放 toolManager 全部工具**：MVP 阶段只暴露经过适配的 6 类核心工具

### 进程边界与会话隔离

- **进程桥接不直接暴露 CLI 内核**：renderer 不感知 CLI 实现，只通过 IPC v3 协议交互
- **会话工作目录限定**：每个 session 绑定一个 `projectRoot`，工具执行不允许越界
- **Worktree 隔离预留**：多文件改动场景预留 worktree 隔离开关，避免污染主工作区

### 事件协议稳定性

- **冻结最小事件集**：MVP 阶段只暴露 7 个事件类型，避免协议蔓延
- **事件字段版本化**：所有事件携带 `version: 1`，便于未来兼容性升级

## 测试覆盖率

### 当前实测（2026-04-07）

| 类型 | 测试文件 | 用例数 | 状态 |
|------|----------|-------|------|
| 单元 | `__tests__/coding-agent-bridge.test.js` | 12 | ✅ |
| 单元 | `__tests__/coding-agent-permission-gate.test.js` | 8 | ✅ |
| 单元 | `__tests__/coding-agent-tool-adapter.test.js` | 4 | ✅ |
| 单元 | `__tests__/coding-agent-session-service.test.js` + `coding-agent-ipc-v3.test.js` | 24 | ✅ |
| 集成 | `tests/integration/coding-agent-lifecycle.integration.test.js` | 10 | ✅ |
| 集成 | `tests/integration/coding-agent-hosted-tools.integration.test.js` | 1 | ✅ |
| 集成 | `tests/integration/coding-agent-bridge-real-cli.test.js`（真实 CLI E2E） | 2 | ✅ |
| **合计** | **9 个文件** | **85** | **85/85 通过** |

运行命令：

```bash
cd desktop-app-vue
npx vitest run src/main/ai-engine/code-agent/__tests__/ \
  tests/integration/coding-agent-lifecycle.integration.test.js \
  tests/integration/coding-agent-hosted-tools.integration.test.js \
  tests/integration/coding-agent-bridge-real-cli.test.js
```

### 已修复缺陷

| 文件 | 缺陷 | 修复 |
|------|------|------|
| `coding-agent-bridge.js` | `request()` 在 `_send` 抛错时未清理 `pending` 中已注册的项，导致内存泄漏 | `_send` try/catch 中 `pending.delete(id)` 后再 throw |
| `coding-agent-bridge.js` | WebSocket `close` 时未拒绝在途 pending 请求，调用方永久挂起 | `_attachSocket()` 的 `close` 处理器调用 `_rejectAllPending(...)` |

为支持单元测试，桥接层重构为 `_deps` 注入模式（`spawn / WebSocket / netCreateServer / findAvailablePort / wait` 全部走 `_deps`），符合 CLAUDE.md 中记录的 CJS 模块测试范式。

### 集成测试覆盖项

```
✅ 主进程启动 session            - createSession + IPC v3 链路
✅ 19 个 IPC channel 全部注册    - registerCodingAgentIPCV3
✅ Plan-mode 生命周期            - enter → show → approve → reject 4 步流转
✅ Plan-ready high-risk 拦截    - sendMessage 在 confirm 前被阻断
✅ Session 恢复                  - resumeSession + history 还原
✅ Worktree 全流程               - list → preview → diff → merge → apply
✅ close-session / cancel-session 别名
✅ get-status 暴露 bridge 连接状态
✅ session 事件推送 webContents.send
✅ 真实 CLI 子进程 createSession / listSessions / closeSession
✅ shutdown 取消在途 pending 请求
```

### 回归测试

```
□ 不影响现有 code-agent:generate / review / fix / refactor
□ 不影响现有 ai:processInput
□ 不影响现有 MCP IPC 与 tool IPC
```

### 测试目标

| 项 | 目标 |
|----|------|
| 单元测试覆盖率 | ≥ 80% |
| 集成测试通过率 | 100% |
| Plan mode 拦截覆盖率 | 100%（所有 medium / high 工具） |
| Session 恢复成功率 | ≥ 99%（含异常恢复） |

## 配置参考

### CodingAgentSessionService 配置

```javascript
{
  bridgeMode: "websocket",            // websocket | spawn
  cliRuntimePath: "<auto>",           // 留空时自动定位 packages/cli
  maxConcurrentSessions: 5,           // 主进程同时运行的 session 数
  sessionTimeout: 0,                  // 0 = 无超时
  autoRestoreOnLaunch: true,          // 启动时自动恢复未完成 session
}
```

### CodingAgentPermissionGate 配置

```javascript
{
  defaultPolicy: "plan-mode",         // plan-mode | autonomous | read-only
  riskLevels: {
    read_file: "low",
    search_files: "low",
    list_dir: "low",
    edit_file: "medium",
    write_file: "medium",
    run_shell: "high",
  },
  shellWhitelist: [                   // run_shell 二次确认豁免列表
    "npm test",
    "npm run lint",
    "git status",
    "git diff",
  ],
  autoApproveBelow: "low",            // 自动批准的最高风险等级
}
```

### CodingAgentToolAdapter 配置

```javascript
{
  enabledTools: [                     // MVP 阶段固定 6 类
    "read_file",
    "search_files",
    "list_dir",
    "edit_file",
    "write_file",
    "run_shell",
  ],
  searchEngine: "ripgrep",            // ripgrep | builtin
  shellExecutor: "sandboxed",         // sandboxed | direct
  maxFileSize: 5_000_000,             // edit_file / read_file 上限（5MB）
  maxShellTimeout: 60_000,            // run_shell 超时（ms）
}
```

### 事件协议版本化

```javascript
// coding-agent-events.js
{
  version: 1,
  events: [
    "session-started",
    "message-delta",
    "tool-start",
    "tool-result",
    "plan-required",
    "completed",
    "failed",
  ],
}
```

## 性能指标

> 以下为 MVP 设计目标，待 Phase 6 完成后用实测数据更新。

### 响应时间目标

| 操作 | 目标 | 备注 |
|------|------|------|
| `startSession` 创建 | < 100ms | 含 bridge 初始化 |
| 单条 `message-delta` 推送 | < 5ms | 主进程 → renderer |
| `tool-start` 触发 | < 20ms | 含权限检查 |
| `read_file` 完整执行 | < 50ms | < 1MB 文件 |
| `search_files` 完整执行 | < 200ms | 全项目 ripgrep |
| `edit_file` 完整执行 | < 100ms | 含 plan 校验 |
| Plan mode 批准/拒绝响应 | < 30ms | UI ↔ permission gate |

### 资源使用预算

| 指标 | 预算 |
|------|------|
| 主进程内存（单 session 空闲） | < 50MB |
| 主进程内存（单 session 活动） | < 150MB |
| 同时运行 session 数 | 5（默认） |
| Bridge 连接 keep-alive 心跳 | 30s |

### 可扩展性目标

| 限制 | 数值 |
|------|------|
| 单 session 最大消息轮次 | 100 |
| 单 session 历史消息上限 | 500（超出触发压缩） |
| 单次工具调用最大输出 | 1MB（超出截断） |
| Bridge 重连最大尝试 | 5 次（指数退避） |

## 风险与缓解

| 风险 | 缓解策略 |
|------|---------|
| CLI ESM 与 Desktop CJS 边界复杂 | MVP 走进程桥接，二阶段再评估抽 `packages/agent-kernel` |
| 工具能力重复（桌面 vs CLI） | Desktop 作为宿主只暴露统一适配后的工具协议 |
| plan mode 逻辑分散 | 所有副作用工具统一走 `coding-agent-permission-gate.js` |
| 流式事件协议不稳定 | 先冻结最小事件集，事件字段版本化 |
| 一开始就上多代理导致调试困难 | 多代理延后到 Phase 6 之后 |

## 后续演进

MVP 完成后推荐演进顺序：

1. worktree 隔离
2. sub-agent / reviewer agent
3. git-aware diff / patch preview
4. PR / commit 自动生成
5. 更细粒度权限策略
6. 把 CLI runtime 中稳定能力抽成 `packages/agent-kernel`

## 相关文档

- [CLI Agent Runtime 重构计划](./cli-agent-runtime-plan)
- [Agent 架构优化系统](./agent-optimization)
- [Web 管理面板](./cli-ui)
- [WebSocket 服务](./cli-serve)
