# ChainlessChain Coding Agent 实施计划

## 1. 文档信息

- 项目: `chainlesschain`
- 主题: 基于 `sanbuphy/learn-coding-agent` 的思路落地生产可用的 Coding Agent
- 日期: `2026-04-08`
- 状态: 执行中

## 2. 总体目标

在 ChainlessChain 中落地一个可用于真实代码仓库工作的 Coding Agent，并同时支持 CLI 与桌面端场景。

目标不是复刻 Claude Code，而是吸收其中真正有工程价值的部分：

- 最小 agent loop
- 工具注册表与权限门控
- 先计划、后执行的 plan mode
- 会话持久化与上下文压缩
- MCP 与技能按需接入
- 子代理与 worktree 隔离后置到稳定期

## 3. 从 `learn-coding-agent` 真正要学什么

这个外部仓库更适合作为架构研究材料，而不是直接复用的实现底座。

真正值得吸收的点有五个：

1. 核心循环必须足够小：`用户输入 -> 模型 -> 工具调用 -> 工具结果 -> 继续循环`
2. 复杂度不要堆到主循环里，而要沉到 harness 层
3. 工具必须是运行时的一等对象，具备 schema、权限级别、遥测标签、执行策略
4. 写入、执行、删除、联网类动作必须显式进入计划与审批流
5. 上下文压缩、持久化、MCP、委派能力要逐层加，不要首版全上

## 4. 当前仓库可复用基础

当前仓库已经有不少能力，不适合重写一套新的 agent 内核。

### 4.1 CLI 侧

- `packages/cli/src/runtime/runtime-factory.js`
  - 已有 `agent`、`chat`、`server`、`ui` 四类 runtime 工厂边界
- `packages/cli/src/tools/registry.js`
  - 已有工具描述标准化逻辑，包含权限与 telemetry 元数据
- `packages/cli/src/harness/`
  - 已有 prompt compression、session store、background task、worktree isolation
- `packages/cli/src/repl/agent-repl.js`
  - 已有交互式 agent 入口

### 4.2 Desktop 侧

- `desktop-app-vue/src/main/ai-engine/plan-mode/index.js`
  - 已有 plan mode 状态和工具分类限制
- `desktop-app-vue/src/main/mcp/mcp-ipc.js`
  - 已有 MCP 配置与 IPC 接入
- `desktop-app-vue/src/main/ai-engine/code-agent/code-agent-ipc.js`
  - 当前还是单次生成、单次 review 风格，不是完整多轮 agent loop
- `desktop-app-vue/src/main/ipc/`
  - 已有较大的 IPC 注册体系，可承接新的 coding-agent 通道

## 5. 实施原则

### 5.1 先复用，再重构

优先复用：

- CLI runtime
- tool registry
- prompt compressor
- session store
- worktree isolator
- desktop plan mode
- desktop MCP integration

不要在 Electron Main 再复制一套独立的 agent kernel。

### 5.2 首版范围必须收紧

首版只解决一条最小可用链路：

- 读代码
- 查代码
- 产出计划
- 改文件
- 跑受控命令
- 流式展示过程与结果

### 5.3 内核与宿主解耦

真正的运行时内核应放在 CLI 侧，桌面端只做：

- host
- bridge
- permission UI
- event consumer

### 5.4 安全先于自治

在以下能力稳定之前，不引入长期后台自治、多代理常驻协作、自进化等高复杂度行为：

- 工具权限模型稳定
- 会话持久化稳定
- 事件协议稳定
- Desktop 审批流稳定

## 6. 目标架构

```text
Renderer UI
  -> Electron IPC
  -> Coding Agent Session Service
  -> Local Agent Bridge
  -> packages/cli runtime
     -> model adapter
     -> tool registry
     -> permission policy
     -> harness services
  -> event stream back to renderer
```

### 6.1 分层说明

- 入口层
  - CLI REPL、Desktop Session Service
- 查询与运行时层
  - 多轮 session 生命周期
- 工具层
  - read、search、write、shell、git、MCP
- Harness 层
  - plan mode、compression、session store、background task、worktree isolation
- 宿主集成层
  - desktop IPC、权限弹窗、流式 UI

## 7. 分阶段实施

## 7.0 当前完成度

截至 `2026-04-08`，主线状态如下：

- Phase 0：完成
- Phase 1：CLI 主线已完成
- Phase 2：CLI 主线已完成
- Phase 3：Desktop 主链路已基本完成
- Phase 4：主线已完成
- Phase 5：最小 Harness 主线已完成，扩展能力未完成

当前结论：

- CLI 已具备多轮 coding session、工具合同、plan mode 门控、会话恢复、tool telemetry、独立 `git` 工具
- Desktop 已打通 session service、IPC、preload、renderer store、审批 UI 和结构化事件信封
- CLI runtime 已支持 trusted MCP auto-connect，并可将可信低风险 MCP 工具直接注入 coding session
- `interrupt` 已从 `close-session` 别名收口为真实中断语义，CLI / Desktop 可中断正在执行的 turn，并保留 session 继续使用
- Desktop 已补齐最小 harness 读写链路，可聚合 `sessions/worktrees/backgroundTasks` 状态，并提供后台任务查询、详情、历史、停止接口
- MCP trusted / blocked 主线已落地，技能接入和更高阶 harness 仍未进入完成态

## Phase 0: 基线收敛

状态：
已完成

目标：
把现有能力、缺口和边界先收敛清楚，避免边做边改协议。

任务：

- 盘点 CLI runtime 的真实可复用 API
- 盘点 desktop code-agent、plan-mode、MCP 的接入点
- 定义统一事件协议
- 定义 MVP 工具清单与权限矩阵
- 定义 desktop 到 CLI 的 bridge 时序

交付物：

- 事件协议文档
- MVP 工具与权限矩阵
- Desktop 到 CLI 桥接时序文档

退出标准：

- 会话协议确定
- MVP 工具范围确定
- CLI 与 Desktop 的职责边界确定

## Phase 1: MVP Runtime Kernel

状态：
CLI 已完成

目标：
在 CLI runtime 中落地一个可运行的多轮 coding agent loop。

范围：

- session 创建与恢复
- 多轮消息循环
- 工具调度
- 流式事件输出
- prompt compression hook
- session persistence hook

MVP 工具：

- `read_file`
- `list_dir`
- `search_files`
- `edit_file`
- `write_file`
- `run_shell`
- 可选 `git`

建议落点：

- `packages/cli/src/runtime/`
- `packages/cli/src/tools/`
- `packages/cli/src/lib/agent-core.js` 或更窄的 kernel 模块

退出标准：

- agent 可以读取仓库上下文
- agent 可以完成一次简单的分析 -> 修改 -> 验证闭环
- CLI 模式下事件流稳定
- 工具失败会以结构化结果返回

已落地：

- `packages/cli/src/lib/agent-core.js`
  - 多轮 tool loop、结构化 tool result、`git` 独立工具、plan mode 执行边界
- `packages/cli/src/runtime/coding-agent-contract.js`
  - CLI Coding Agent 的 MVP/extension 工具合同
- `packages/cli/src/tools/legacy-agent-tools.js`
  - 旧 agent-core 到新工具合同的兼容桥
- `packages/cli/src/lib/session-manager.js`
  - session metadata 持久化
- `packages/cli/src/lib/ws-session-manager.js`
  - session create/resume、plan snapshot 恢复、workspace/worktree 恢复、`enabledToolNames` 会话级恢复
- `packages/cli/src/lib/ws-agent-handler.js`
  - session-scoped plan manager、sessionId telemetry、会话级工具 allowlist 贯通

## Phase 2: 权限与安全 Harness

状态：
CLI 已完成

目标：
让 agent 可以安全地在真实仓库中工作。

任务：

- 将工具描述与权限级别统一
- 将写入、执行、删除、高风险 Git 动作接入 plan mode
- 增加审批检查点
- 统一 CLI 与 Desktop 的 allow、deny、ask 语义
- 在工具执行边界补 telemetry tags

建议复用：

- `packages/cli/src/tools/registry.js`
- `desktop-app-vue/src/main/ai-engine/plan-mode/index.js`
- 现有 permission、sandbox 相关模块

退出标准：

- 只读链路无额外审批噪音
- 写与执行链路有一致的审批行为
- 权限决策可在事件流中被清晰展示
- plan mode 能解释为什么某一步被阻断

已落地：

- `packages/cli/src/runtime/coding-agent-contract.js`
  - 工具权限、风险级别、plan mode 可用性、approval flow 元数据
- `packages/cli/src/lib/plan-mode.js`
  - 写入、执行、Git 操作的计划门控
- `packages/cli/src/lib/agent-core.js`
  - host-managed tool policy、plan mode 阻断、tool telemetry record
- `packages/cli/src/lib/ws-session-manager.js`
  - WebSocket coding session 默认只启用 MVP 工具集，扩展工具需显式通过 `enabledToolNames` 打开

当前限制：

- `allow / deny / ask` 语义已收口到共享策略模块 `packages/cli/src/runtime/coding-agent-policy.cjs`
- `run_shell` 已收口到共享命令策略模块 `packages/cli/src/runtime/coding-agent-shell-policy.cjs`

## Phase 3: Desktop Bridge

状态：
主链路已基本完成

目标：
把 CLI runtime 暴露为桌面端 Coding Agent 服务。

任务：

- 构建 Main 进程 session service
- 构建 Electron IPC 到 CLI runtime 的桥接层
- 注册新的 coding-agent IPC
- 将 session 事件流推送给 renderer
- 保留现有 one-shot `code-agent:*` 接口的兼容层，或将其转发到新服务

建议落点：

- `desktop-app-vue/src/main/ai-engine/code-agent/`
- `desktop-app-vue/src/main/ipc/`

推荐新增模块：

- `coding-agent-session-service.js`
- `coding-agent-bridge.js`
- `coding-agent-permission-gate.js`
- `coding-agent-events.js`
- `coding-agent-ipc-v3.js`

退出标准：

- 桌面端可以启动、流式接收、中断、恢复一个 coding session
- renderer 能收到结构化进度事件
- plan 与 approval 请求能通过桌面 UI 正常交互

已落地：

- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-permission-gate.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-events.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js`
- `desktop-app-vue/src/preload/index.js`
- `desktop-app-vue/src/renderer/stores/coding-agent.ts`
- `desktop-app-vue/src/renderer/pages/AIChatPage.vue`

当前限制：

- Desktop 与 CLI 已共享 `coding-agent-policy.cjs` 中的核心权限语义与 Git 只读例外规则
- `run_shell` 的命令级策略当前先在 CLI 执行边界生效，Desktop 侧主要消费结果和策略同步元数据
- 更完整的 renderer 级集成回归和跨进程端到端链路还可以继续加强

## Phase 4: MCP 与技能接入

状态：
主线已完成，扩展项未完成

目标：
在不破坏核心循环稳定性的前提下接入外部能力。

任务：

- 通过 runtime registry 暴露 MCP 工具
- 按权限级别与信任来源对 MCP 工具分类
- 将 skill 作为按需上下文或工具扩展接入
- 默认关闭高风险或未知来源 MCP server

建议复用：

- `desktop-app-vue/src/main/mcp/`
- `packages/cli/src/lib/mcp-client.js`
- 现有 skill loading 与 cowork skill 体系

退出标准：

- 可信 MCP server 可以被列出与调用
- 高风险 MCP 行为会被门控
- skill 不会默认污染每个 session 的上下文

已落地：

- `packages/cli/src/runtime/coding-agent-managed-tool-policy.cjs`
  - 共享 managed tool allowlist、trusted MCP server 判定、高风险 MCP opt-in 规则
- `packages/cli/src/runtime/agent-runtime.js`
  - 已支持从 MCP 配置表自动连接 trusted/allowlisted server，并把本地 MCP client 下发到 session manager
- `packages/cli/src/lib/ws-session-manager.js`
  - WebSocket coding session 默认只暴露 MVP core tool，不再默认把 `run_skill`、`run_code`、`spawn_sub_agent` 注入每个会话
  - 已支持将本地 MCP client 暴露的可信工具转换成 session 级 external tool definition/executor
- `packages/cli/src/lib/agent-core.js`
  - 已支持直接执行 session 级本地 MCP 工具，不必完全依赖 Desktop 下发 host-managed tool policy
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-tool-adapter.js`
  - 已改为消费共享 managed/MCP policy，不再单独维护一套 trusted/allowlist 判断
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js`
  - 已支持 `allowedMcpServerNames`、`allowHighRiskMcpServers` 下发到 host-managed tool policy

当前已完成：

- trusted MCP server 可以被列出并同步到 CLI host policy
- trusted、allowlisted、auto-connect 的 MCP server 可以由 CLI runtime 直接接入，并进入 coding session 工具集
- 未知来源 MCP server 会被直接排除
- trusted 但高风险的 MCP server 默认关闭，只有显式 opt-in 才会进入会话
- MCP tool risk 会取 server security level 与 tool risk descriptor 的更高值
- WebSocket coding session 默认只暴露 MVP 工具；skill / run_code / sub-agent 已从默认上下文中移出，需要会话级显式启用
- Desktop bridge / session-service 已补 MCP 跨进程回归，覆盖 `session-policy-update` 透传与 `resumeSession()` 后 host policy 重同步
- Desktop integration 已补 IPC 别名与 hosted MCP 回归，覆盖 `start-session`、`respond-approval`、`interrupt` 和 hosted MCP resume 同步
- Renderer store 已对齐共享 dot-case 事件协议，并补回归覆盖 `assistant.final`、`approval.requested`、`tool.call.failed`、`runtime.server.ready`
- AIChatPage 已兼容共享 dot-case 事件协议，并补页面回归覆盖 `tool.call.started`、`tool.call.completed`、`assistant.final`、`approval.requested`、`approval.high-risk.*`

当前限制：

- 这轮已收口 managed tool / MCP 的共享策略与 CLI runtime 直连 MCP 主线，skill 的按需装载边界还没有继续下探
- 更完整的 renderer/IPC/CLI 端到端 MCP 集成测试仍可继续补强

## Phase 5: 高阶 Harness

状态：
部分完成（最小 harness 已落地）

目标：
在核心链路稳定后再增加复杂能力。

本轮已完成：

- `CodingAgentSessionService.getHarnessStatus()`，统一聚合 `sessions/worktrees/backgroundTasks`
- Desktop main / IPC / preload / renderer store 已补齐后台任务只读与停止接口
- Desktop 聊天页已增加 harness 面板和后台任务详情抽屉，可查看会话/工作树/后台任务摘要，并执行刷新、停止后台任务、按状态筛选/搜索任务、分页浏览任务、查看历史、加载更多 history
- Desktop integration / store / session-service / bridge / IPC 已补最小 harness 回归

仍未完成：

- 子代理委派
- review mode
- patch preview / diff 总结编排
- 更高阶的持久化任务图与编排器

候选能力：

- 子代理委派
- 后台任务
- worktree 隔离
- 持久化任务图
- review mode
- patch preview 与 diff 总结

原则：
这些能力必须是可选层，而不是基础会话的硬依赖。

退出标准：

- 每项高阶能力都能独立开关
- 基础 coding agent 在不启用这些能力时仍可正常工作

## 8. 文件组织建议

### CLI

- 在 `packages/cli/src/runtime/` 扩生命周期与事件信封逻辑
- 在 `packages/cli/src/tools/` 扩标准化 coding-agent 工具
- 在 `packages/cli/src/harness/` 复用压缩、持久化、隔离能力

### Desktop

- 将 coding-agent 会话编排集中在 `desktop-app-vue/src/main/ai-engine/code-agent/`
- IPC 注册仍放在 `desktop-app-vue/src/main/ipc/`
- 不要把 coding-agent 的主职责分散到其他 AI 模块

## 9. 测试计划

### Unit

- 工具描述标准化
- 权限策略解析
- plan mode 门控
- 事件信封格式化
- session 持久化与恢复

### Integration

- CLI 多轮 session 的读文件与编辑文件闭环
- Desktop IPC 启动到完成的会话链路
- 审批请求往返流程
- MCP trusted / blocked / high-risk opt-in 场景

### E2E

- 用户要求 agent 分析代码、生成计划、修改一个文件并执行验证命令
- 用户拒绝高风险操作后，agent 能稳定恢复
- 用户恢复旧会话并继续任务

## 10. 主要风险

### 10.1 双内核分叉

风险：
CLI 与 Desktop 逐步演化成两套不同 agent 实现。

缓解：
只保留一个 runtime kernel，Desktop 只做宿主与桥接。

### 10.2 权限行为不一致

风险：
CLI 与 Desktop 对允许和拒绝的理解不一致。

缓解：
统一工具元数据模型与策略词汇表。

### 10.3 上下文膨胀

风险：
大仓库和长会话很快耗尽上下文窗口。

缓解：
尽早接入 prompt compression 和 session summarization，不要等到后期补。

### 10.4 MVP 过度设计

风险：
首版引入过多现有模块，导致范围失控。

缓解：
MVP 只保留 6 到 7 个工具和一套稳定 session 协议。

## 11. 执行顺序

推荐顺序：

1. 完成 Phase 0 并冻结 MVP 合同
2. 落地 CLI MVP kernel
3. 落地权限与 plan harness
4. 落地 desktop bridge
5. 接入 MCP 与技能
6. 最后再补子代理与高阶自治

执行状态更新：

1. 完成 Phase 0 并冻结 MVP 合同
2. 已完成 CLI MVP kernel
3. 已完成 CLI 权限与 plan harness
4. Desktop bridge 已基本落地
5. MCP 与技能接入已完成共享策略主线，skill 接入待继续
6. 子代理与高阶自治待继续

## 12. 第一里程碑完成定义

当满足以下条件时，可认为第一里程碑完成：

- 用户可从 CLI 或 Desktop 发起多轮 coding session
- agent 可以完成读取、计划、修改、验证的闭环
- 写入与执行动作受到 plan mode 与审批控制
- 会话可恢复
- 事件流稳定
- 核心 runtime、权限流、bridge 集成具备基础测试覆盖

当前判断：

- CLI 已满足第一里程碑定义
- Desktop 已接近第一里程碑完成，但仍建议补更完整的跨进程回归验证后再标记完全完成

## 13. Phase 0 文档

Phase 0 已拆成三份配套文档：

- [CODING_AGENT_EVENT_SCHEMA.md](C:\code\chainlesschain\docs\implementation-plans\CODING_AGENT_EVENT_SCHEMA.md)
- [CODING_AGENT_MVP_TOOL_PERMISSION_MATRIX.md](C:\code\chainlesschain\docs\implementation-plans\CODING_AGENT_MVP_TOOL_PERMISSION_MATRIX.md)
- [CODING_AGENT_DESKTOP_CLI_BRIDGE_SEQUENCE.md](C:\code\chainlesschain\docs\implementation-plans\CODING_AGENT_DESKTOP_CLI_BRIDGE_SEQUENCE.md)

## 14. 下一步建议

当前最合理的下一步不是再扩 MVP，而是收尾剩余主线：

1. 把 CLI 和 Desktop 的 `allow / deny / ask` 策略收口成共享 policy 模块
2. 给 Desktop 补更完整的跨进程集成回归
3. 再进入 Phase 4，收口 MCP 与技能接入边界
