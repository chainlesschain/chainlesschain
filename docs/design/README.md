# 设计文档

> 本目录收录 ChainlessChain 的系统设计、模块设计、实施计划与阶段总结。这里不是简版提纲，而是面向实际研发、联调和回归验证的设计入口。内容已对齐到 2026-04-08 当前代码状态。

## 当前文档状态

- 设计文档已重新对齐 CLI Agent Runtime 重构、WebSocket 协议拆分、Web Panel 统一事件入口、后台任务增强、Worktree 合并助手、会话迁移、以及 **Coding Agent Phase 5 最小 Harness + 真实 interrupt** 能力。
- 模块 `69`、`77`、`78`、`79` 已补回较完整的说明，不再只保留短摘要。
- 本目录是 `docs-site` 设计区的同步源，修改这里会在构建文档站时自动同步过去。

## 最近更新

- `modules/80_规范工作流系统.md`
  - 新增模块：规范编码工作流（`$deep-interview → $ralplan → $ralph/$team`）四阶段状态机、SessionStateManager 门控（G1/G2）、Phase 3.5 AIChatPage 输入拦截、Phase 4 生命周期 Hooks（8 事件 / 30s timeout / require.cache 热重载 / pre-veto 传播 / post-swallow）。
- `modules/79_Coding_Agent系统.md`
  - §7.3 补齐真实 `interrupt` 语义：`AbortController` + `abort-utils.js` 链路，`rejectAllPending` 广播 `AbortError`，session 保留可继续使用。
  - §7.4 IPC 列表新增 `harness-status` / `list-background-tasks` / `get-background-task` / `get-background-task-history` / `stop-background-task` 五条通道。
  - Phase 5 升级为"最小集 ✅ / CLI 扩展能力 ✅"：最小 harness 主线已落地，并补齐 **子代理委派** / **review mode** / **patch preview / diff 总结** / **持久化任务图与编排器** 四类 CLI 端扩展能力（详见模块 79 §Phase 5 扩展能力详细设计）。
  - 新增 §Phase 5 扩展能力详细设计，列出四类能力的数据结构、状态机、WS 协议、事件清单、与最小 harness 的关系矩阵。
- `modules/69_WebSocket服务器接口.md`
  - 已补回协议分层、请求响应示例、runtime event 对齐、session/task/worktree/compression 四类契约。
- `modules/77_Agent架构优化系统.md`
  - 已同步后台任务历史增强、Worktree 合并助手、压缩观测与会话迁移能力。
- `modules/78_CLI_Agent_Runtime重构实施计划.md`
  - 已更新到 Phase 4 收尾阶段，记录 runtime、gateway、harness、session contract 与 Web Panel 事件收口的真实进度。

## 推荐阅读路径

### 总览入口

1. `系统设计_主文档.md`
2. `实施总结与附录.md`
3. `modules/77_Agent架构优化系统.md`
4. `modules/78_CLI_Agent_Runtime重构实施计划.md`

### 与当前重构最相关

- `modules/69_WebSocket服务器接口.md`
- `modules/73_Web管理界面.md`
- `modules/75_Web管理面板.md`
- `modules/77_Agent架构优化系统.md`
- `modules/78_CLI_Agent_Runtime重构实施计划.md`

### 面向联调与验证

- `modules/43_IPC域分割与懒加载系统.md`
- `modules/44_共享资源层与依赖注入容器.md`
- `modules/45_数据库演进与迁移框架.md`
- `modules/63_统一应用运行时.md`
- `modules/69_WebSocket服务器接口.md`

## 当前设计重点

### 1. CLI Agent Runtime 重构

当前重构方向已经明确为以下边界：

- `commands`
- `runtime`
- `gateways`
- `harness`
- `contracts / policies`
- `tools`

已落地的主线包括：

- 命令入口开始统一经过 runtime factory。
- `ws-server` 的 session、task、worktree、action 协议已拆到 `gateways/ws`。
- `feature-flags`、`prompt-compressor`、`jsonl-session-store`、`background-task-manager`、`worktree-isolator` 已迁入 `src/harness`，旧 `lib/` 保留兼容层。
- CLI / WS / Web Panel 已开始共享统一 runtime event envelope。
- `session-record`、`task-record`、`worktree-record`、`telemetry-record` 已作为最小 contract 建立。

### 2. Web Panel 对齐

当前 Web Panel 已开始从零散协议消息迁到统一事件入口：

- `tasks.js`
- `chat.js`
- `dashboard.js`
- `ws.js`

已接入的统一事件包括：

- `session:start`
- `session:resume`
- `session:end`
- `task:notification`
- `worktree:diff:ready`
- `worktree:merge:completed`
- `compression:summary`

这意味着前端开始从“直接理解每条协议消息”过渡到“消费统一 runtime event”，后续页面扩展和协议演进的耦合会更低。

### 3. Session Contract 标准化

当前标准 session summary 结构已贯通以下响应：

- `session-created`
- `session-resumed`
- `session-list-result`

统一字段包括：

- `id`
- `type`
- `provider`
- `model`
- `projectRoot`
- `messageCount`
- `history`
- `status`
- `record`

### 4. 后台任务与 Worktree 能力

当前文档已经反映以下真实实现：

- 后台任务支持历史分页查询、详情摘要、重启恢复和通知推送。
- Worktree 合并助手支持 diff 预览、一键合并、冲突摘要和自动化候选项。
- 压缩观测支持时间窗口、`provider` / `model` 切片和变体分布。
- JSON → JSONL 会话迁移支持 dry-run、抽样校验和失败重试。

### 5. Coding Agent Phase 5 最小 Harness 与真实 Interrupt

当前文档已经反映以下真实实现（2026-04-08）：

- `coding-agent:interrupt` 不再是 `close-session` 的别名。CLI 侧新增共享 `packages/cli/src/lib/abort-utils.js`（`AbortError` / `throwIfAborted` / `isAbortError`），`ws-agent-handler` 每个 turn 新建 `AbortController`，`agent-core` / `interaction-adapter` 感知 abort 后会立即释放 pending 审批 / 工具调用、发出 `session.interrupted`，session 本身仍保留可继续使用。
- Desktop `CodingAgentSessionService.getHarnessStatus()` 聚合 `sessions` / `worktrees` / `backgroundTasks` 三类概览，供 renderer 一次性读取。
- IPC v3 + preload + renderer store 全链路补齐 `list-background-tasks` / `get-background-task` / `get-background-task-history` / `stop-background-task`。
- `AIChatPage.vue` 新增 **Coding Agent Harness** 面板，展示会话 / worktree / 后台任务概览，支持 Refresh、View Details（详情 + 历史）、Stop Task。
- AIChatPage 已迁移到点分小写事件协议，`tool.call.*` / `assistant.final` / `approval.*` / `approval.high-risk.*` 已打通。

## 当前验证摘要

- CLI 定向单元（含 `agent-core` / `ws-agent-handler` / `interaction-adapter` / `abort-utils` interrupt 主线）：`175/175`
- CLI 定向集成（含 `ws-session-workflow`）：`20/20`
- CLI `coding-agent-envelope-roundtrip` E2E：`7/7`
- Desktop Coding Agent 主链路（bridge / ipc-v3 / session-service / permission-gate / tool-adapter / 集成 / store / AIChatPage）：`9 files, 197/197`
- Phase 5 最小 harness 定向回归：`5 files, 84/84`
- AIChatPage harness 面板 + dot-case 事件页面回归：`69/69`
- Web Panel 定向单元：`23/23`
- Web Panel E2E：`29/29`
- Web Panel 构建：通过
- Docs Site 构建：通过

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

## 目录说明

- `系统设计_主文档.md`
  - 系统总览与主设计说明。
- `实施总结与附录.md`
  - 阶段总结、落地说明与补充信息。
- `modules/`
  - 各阶段模块设计文档。

## 文档站同步

- `docs-site/scripts/sync-design-docs.js` 会从本目录同步设计文档到文档站。
- 模块 `78_CLI_Agent_Runtime重构实施计划.md` 当前固定映射到 `/design/modules/78-cli-agent-runtime`。
- 模块 `69_WebSocket服务器接口.md` 当前固定映射到 `/design/modules/69-websocket-server`。
