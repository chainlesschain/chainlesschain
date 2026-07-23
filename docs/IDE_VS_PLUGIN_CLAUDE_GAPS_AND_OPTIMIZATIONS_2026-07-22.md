# ChainlessChain IDE 相对插件与 Claude Code 的不足及优化建议

更新日期：2026-07-22  
评估范围：ChainlessChain VS Code / JetBrains 插件、IDE 宿主能力，以及 Claude Code 官方 IDE 集成和插件生态。

## 实施与发布状态

本轮文档对应的高优先级实现已完成并发布：

> 当前发布基线为 VS Code 0.37.26、JetBrains 0.4.68；下文的“已完成”仅表示仓库代码、定向测试或构建证据；正式 Marketplace 渠道、远程环境和长期稳定性仍需单独核验。VS Code Extension Host 与 JetBrains Remote Robot 已有真实 smoke 和发布门接线，不能把它们与多宿主矩阵混为一谈。

### 本轮复核后已收口的历史开放项

| 项目                             | 当前证据                                                                                                              | 当前状态                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Desktop Coding Agent V3 生产接线 | `desktop-app-vue/src/main/index.js` 的 `initializeCodingAgentV3()` 创建并 attach `coding-agent-bootstrap`             | C/H 已完成；需打包应用 E2E             |
| 后台 Agent + Worktree            | `packages/cli/__tests__/unit/agent-background-worktree.test.js` 验证 worktree 创建、后台转交和参数剥离                | C/T 已完成；需真实长稳与清理 E2E       |
| 联合恢复幂等                     | headless runner/stream 接入 side-effect ledger reconcile，恢复时对未落定副作用提示核验                                | C/T 已完成；需跨进程 kill E2E          |
| 协议文档、离线回放和治理覆盖率   | `protocol-replay.js`、`gen-protocol-doc.mjs`、`governance-coverage.js` 及对应脚本/测试                                | C/T 已完成；需接入完整发布门           |
| 标准 OTLP 出口                   | `packages/cli/src/lib/observability/otlp-exporter.js` 提供 HTTP/HTTPS、批处理、重试统计和非阻塞失败处理               | C 已完成；需 Collector/SIEM 实环境验证 |
| VS Code Bridge token ACL         | `lockfile.js` 默认 fail-closed，目录、临时文件和最终 lockfile 均独立校验；仅 managed policy 可降级；5 项 ACL 回归通过 | C/T 已完成；仍需真实 Windows ACL 矩阵  |

| 项目                        | 状态                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code 插件能力清单        | 已完成，随 MCP `initialize` 动态返回实际工具和可选能力                                                                                                                                          |
| JetBrains 插件能力清单      | 已完成，随 MCP `initialize` 动态返回实际工具和可选能力                                                                                                                                          |
| VS Code 契约与插件回归      | 已完成，能力契约 Node 测试 2/2 通过；`vscode-ext-*` Vitest 全量 82 个文件、926 项测试无失败                                                                                                     |
| VS Code 真实 Extension Host | 已完成，当前 `0.37.26` VSIX 在 VS Code Stable 干净 profile 激活，16 个关键命令和 Bridge 端口校验通过                                                                                            |
| JetBrains 契约测试          | 已完成，`IdeCapabilitiesTest` 通过                                                                                                                                                              |
| JetBrains 纯逻辑回归        | 已完成，`PureLogicSmokeMain` 1219/1219 通过                                                                                                                                                     |
| JetBrains 完整单元测试      | 已完成，Gradle `test --rerun-tasks` 通过，608 项测试无失败（另有 2 项按条件跳过）                                                                                                               |
| JetBrains 真实 GUI smoke    | 已完成，Remote Robot `IdeUiSmokeTest.chainlessChainToolWindowOpens` 通过                                                                                                                        |
| JetBrains 插件构建          | 已完成，`0.4.68` ZIP 构建成功                                                                                                                                                                   |
| VS Code VSIX 构建           | 已完成，`0.37.26` VSIX 构建成功                                                                                                                                                                 |
| Open VSX 发布               | 已发布 `0.37.26`；公开 API 已回读并确认可下载，发布 workflow 已接入 `scripts/verify-ide-marketplace.mjs`                                                                                        |
| 定向复核测试                | CLI 6 个相关测试文件 48 项通过；Desktop bootstrap 2 项通过；关键 JS 语法检查通过                                                                                                                |
| IDE Runtime Doctor          | VS Code `chainlesschain.ide.doctor` now includes extension/VS Code versions, workspace trust, workspace path, live bridge state, `cc ide status`, and `cc ide doctor` output; 6 assertions pass |
| JetBrains Marketplace 发布  | `0.4.68` 已发布；公开 API 已回读并确认 `approve=true`、`listed=true`、`hidden=false`；发布 workflow 已接入同一验证脚本                                                                          |
| VS Code 官方 Marketplace    | 未发布，当前未配置 `VSCE_PAT`；不影响 Open VSX 发布                                                                                                                                             |

本轮版本：VS Code `0.37.26`，JetBrains `0.4.68`。Plan/Diff、后台 Agent、Remote、Artifact、Managed CLI、权限保护和安全审计等项目经代码核对已在现有 CLI/插件实现中落地；本轮没有重复实现。

## 一、结论摘要

ChainlessChain 当前的 IDE 插件已经覆盖聊天、Plan Review、原生 Diff、诊断信息、终端、Preview、后台 Agent、Remote Control、MCP/Plugin 管理等主干能力。因此，下一阶段的重点不应是继续堆叠聊天入口，而应集中在以下四件事：

1. **完成“IDE 宿主能力”和“插件能力”的边界治理**：把 IDE 提供的编辑器、语言服务、终端、调试器和浏览器上下文抽象成稳定协议，降低 VS Code 与 JetBrains 的行为差异。
2. **补齐 Claude Code 已形成用户预期的工作流闭环**：Plan → inline review → edit → diff → test/diagnostics → approve/rollback → resume。
3. **把插件系统做成可运营的生态**：市场发现、版本锁定、依赖解析、签名、权限、升级回滚、诊断和企业策略要形成闭环。
4. **提高跨端可观测性和可恢复性**：IDE、CLI、Desktop、Web/Mobile、后台 Agent 共享 session、权限、事件和副作用记录。

Claude Code 的官方 VS Code 集成已经将计划自动打开为完整 Markdown 文档，支持 inline comments；同时提供原生 Diff、当前选择区、Jupyter cell 执行、权限模式、上下文用量和 Remote Control 入口。[官方 VS Code 文档](https://code.claude.com/docs/en/ide-integrations)  
Claude Code 的 JetBrains 插件则突出原生 Diff、选择区/当前文件上下文、文件引用快捷键和诊断共享。[官方 JetBrains 文档](https://code.claude.com/docs/en/jetbrains)

## 代码核对后的现状（2026-07-22）

本节以仓库当前代码为准，不把已经实现的能力重复列为缺口。

本轮已落地：两端 IDE MCP Bridge 在 `initialize` 响应中新增统一的
`chainlesschain.ide` 能力清单。清单由实际注册的工具动态生成，支持可选能力
（例如 JetBrains PSI 语义工具、VS Code multi-file diff/notebook）按宿主能力
降级，不再要求客户端假设两个 IDE 完全对称。

| 能力              | VS Code 插件                                                                                          | JetBrains 插件                                                                            | 判断                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 聊天/多会话       | `src/chat/`、`sessions-workbench.js`、`ide-session-index.js`                                          | `AgentChatSession`、`ConversationManager`、`SessionsWorkbench`、`IdeSessionIndex`         | 两端已有；重点转为协议一致性和恢复可靠性                                                            |
| Plan Review       | `chat/plan-review.js`，有版本化恢复、结构化批注、计划修订 Diff 和逐项执行进度                         | `PlanReview`、`ChatEvents`，有对等解析/合并、修订 Diff 和项目级恢复状态                   | 快照、重启恢复、结构化批注、修订 Diff、执行关联和审批执行锁摘要均已完成                             |
| 原生 Diff         | `ide-tools.js`、`diff-hunks.js`、`multi-diff.js`、`diff-apply-guard.js`、`diff-review-audit.js`       | `DiffHunks`、`MultiDiff`、`DiffApplyGuard`、`ReviewNote`、`DiffReviewAudit`               | 接受/拒绝/改写/hunk 归因、会话绑定和副作用账本持久化已统一；剩 rename/delete 意图和真实宿主降级验收 |
| IDE MCP Bridge    | `mcp-http-server.js` + `ide-tools.js`                                                                 | `McpServer` + `IdeTools`                                                                  | 已统一 `getSelection/getActiveFile/getDiagnostics/getOpenEditors/openDiff` 等基础契约               |
| 代码语义          | `semantic-tools.js`，包含 hover、definition、references、rename、call hierarchy、symbol/project model | `SemanticTools`，通过 PSI 提供同类语义工具                                                | 不应再把“增加基础语义工具”列为 P0；应补测试结果、覆盖率、调试状态和能力协商                         |
| 终端/Preview      | `terminal-capture.js`、`preview.js`、`preview-detect.js`                                              | `TerminalTextReader`、`PreviewService`、`PreviewDetect`                                   | 已有只读输出和 Preview 状态；浏览器 DOM/console/network/action 仍是后续能力                         |
| 后台 Agent/Remote | `background-agents.js`、`remote-handoff.js`、`remote-control-host.js`、`remote-doctor.js`             | `BackgroundAgents`、`RemoteHandoff`、`RemoteDoctor`、`RemoteControlAction`                | 已有入口；需要统一状态机、断线恢复和副作用账本                                                      |
| Artifact          | `artifacts-drawer.js`、`ui/artifacts-view.js`                                                         | `Artifacts`、`ArtifactsAction`                                                            | 已有列表、元数据和预览降级；还可增强发布/重发布/会话关联                                            |
| 权限/安全         | workspace trust、路径保护、Diff approval、auto-exec guard、plugin quality                             | `BridgeSecurityPolicy`、`IdePathGuard`、`DiffApplyGuard`、`AutoExecGuard`、`PolicyViewer` | 安全基础较完整；需要统一 `PermissionDecision` 和策略来源解释                                        |
| 插件管理          | `plugin-manager.js`、`plugin-quality.js`、管理视图                                                    | `PluginManager`、`PluginQuality`、管理 action                                             | 已有管理面；供应链签名、依赖锁定、升级回滚和企业策略仍需补齐                                        |
| CLI 运行时        | Managed CLI、版本检查、安装、升级、回滚                                                               | `ManagedCliRuntime`、`ManagedCli`、`CliVersionCheck`、安装/回滚 action                    | 已解决“只能依赖全局 CLI”的主要问题；仍需更清晰的兼容矩阵和离线缓存诊断                              |
| 代码补全          | VS Code `completion.js`，配置项和手动触发                                                             | Kotlin `CcInlineCompletionProvider`，另有手动触发 action                                  | 两端都有，但仍不是 Claude Code/Copilot 级的持续 ghost-text 体验；应继续控制延迟和成本               |
| GUI 自动化验证    | extension-host 测试                                                                                   | Remote Robot `uiTest` 为隔离/nightly smoke，60 个 Java 单测文件                           | 单测覆盖较好；发布门仍应加入关键真实 UI 场景，而不仅是纯逻辑测试                                    |

代码依据（版本以本节顶部的当前基线为准）：

> 说明：下方链接说明的是能力来源；版本以本节顶部的当前代码基线为准。历史版本号不会改变本报告的结论。

- [VS Code package.json](../packages/vscode-extension/package.json)（当前版本 `0.37.26`、命令、权限和配置入口）。
- [VS Code IDE tools](../packages/vscode-extension/src/ide-tools.js) 与 [semantic tools](../packages/vscode-extension/src/semantic-tools.js)。
- [JetBrains plugin.xml](../packages/jetbrains-plugin/src/main/resources/META-INF/plugin.xml)（当前版本以插件构建配置和顶部基线为准、Tool Window、Action 和能力说明）。
- [JetBrains IdeTools](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/IdeTools.java) 与 [SemanticTools](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/SemanticTools.java)。
- [VS Code capability manifest](../packages/vscode-extension/src/ide-capabilities.js) 与测试。
- [JetBrains capability manifest](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/IdeCapabilities.java) 与测试。

### 两端相对 Claude Code 的真实差距

结合代码后，当前最值得写入路线图的不是“补齐聊天、Diff、MCP、语义工具”，这些已经存在，而是：

1. **协议和行为仍可能漂移**：两端虽然使用同名工具，但 IDE API 的可选能力、错误形状、超时、路径处理和事件顺序仍需 Golden Fixtures 约束。
2. **VS Code 与 JetBrains 的深度能力不完全对称**：JetBrains 的 PSI 语义能力更强；VS Code 更接近原生编辑器/Notebook 生态。应让 Agent 获得能力声明，而不是假设两端工具永远存在。
3. **用户审阅状态已进入会话与副作用账本，后续闭环仍需验收**：Plan Review 的批注、审批和后续 Agent turn 已可持久化/重放；Diff hunk 选择与 proposed content 用户改写已有跨端统一审计模型，并已绑定 session/turn/toolUse、随对应文件写副作用持久化。`changes-requested` 当前记录 `followUpRequested`，实际后续 turn 是否完成仍需端到端指标。
4. **UI 已有很多入口，但主任务链还未完全收束**：用户可能在 Chat、Dashboard、Sessions、Background Agents、Remote Control、Artifacts、Plugin Manager 之间切换；需要统一工作台或上下文导航。
5. **插件管理偏本地管理器，而 Claude Code 已形成 Marketplace 工作流**：还缺少可信来源、能力 diff、依赖图、版本锁定、签名、SBOM、回滚和团队策略的完整闭环。
6. **自动验证仍有隔离**：JetBrains Remote Robot 已存在，但主要作为隔离/nightly UI smoke；VS Code 也有 extension-host 测试。应把 Plan、Diff、权限审批、断线恢复、@mention、Preview 等关键链路纳入 release gate。

### 不应再作为当前缺口的项目

以下项目在现有代码中已有明确实现，不建议继续作为模糊的 P0 任务：

- “增加 active file、selection、diagnostics、open editors、native diff”；
- “增加基础 hover、跳转定义、查找引用、重命名预览、调用层级”；
- “增加后台 Agent、Remote Control、Artifact 面板”；
- “增加 JetBrains 终端输出和 Preview 状态”；
- “增加 managed CLI 安装、版本检查和回滚”；
- “增加 Plan Review 的基本 approve/reject/request changes 操作”。

这些项目应改写成稳定性、兼容性、可观测性和跨端一致性任务。

## 二、先明确三个概念

| 对象                  | 主要职责                                                           | ChainlessChain 当前应达到的目标              |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| IDE 宿主              | 编辑器、Diff、光标、选区、诊断、LSP/PSI、终端、测试、调试、Preview | 提供稳定、权限受控、可测试的 IDE Context API |
| IDE 插件              | UI、命令、会话面板、审批交互、状态展示、连接 Bridge                | 做好工作流编排，不重复实现 IDE 已有能力      |
| Claude/Agent 插件生态 | Skills、Agents、Hooks、MCP、LSP、命令、后台监控和分发              | 支持声明式安装、版本化、权限治理和跨项目复用 |

Claude Code 官方插件可组合 Skills、Agents、Hooks、MCP、LSP、Monitors，并可通过 Marketplace 按 user/project/local/managed scope 安装。[官方插件参考](https://code.claude.com/docs/en/plugins-reference)  
这意味着“插件管理器”不应只展示已安装数量，还需要解释插件到底改变了什么、需要什么权限、由哪个版本提供以及失败后如何恢复。

## 三、当前仍存在的主要不足

### P0：影响基本可用性和用户信任

#### 1. 首次安装和运行链路仍不够顺滑

潜在问题：

- VS Code 官方 Marketplace、Open VSX、JetBrains Marketplace 的发布和版本状态可能不完全一致。
- CLI、插件、IDE Bridge 的版本组合缺少一个用户可理解的兼容性结论。
- `cc` 不在 PATH、CLI 版本过旧、Node/Java 环境缺失时，用户容易只看到底层错误。
- 远程、WSL、代理、防火墙、企业网络环境的失败原因仍可能需要人工排查。

优化建议：

- 首次启动增加 **Installation & Runtime Doctor**：检查插件版本、CLI 版本、Bridge、Node/Java、PATH、网络、权限和 workspace trust。
- 输出单一结论：`可运行 / 可降级运行 / 需要修复`，并提供安全范围内的一键修复。
- 建立兼容性矩阵和自动升级策略；用户显式配置的 CLI 路径不能被静默覆盖。
- 发布前对 VSIX、ZIP、CLI 和 Bridge 执行同一组 smoke tests，并在插件 UI 显示构建版本、协议版本和诊断 ID。

验收标准：新机器无全局 `cc` 时，插件能自动给出可复制的修复路径；失败诊断不再只出现 `command not found` 或超时。

#### 2. Plan Review 还需要成为真正的 IDE 工作流

Claude Code 会把计划打开成完整 Markdown 编辑器，用户可以 inline comment 后再让 Agent 修改计划。ChainlessChain 已有 Plan Review 基础，但还应进一步统一：

- comments 必须绑定文件、行号、计划项和 session/turn；
- “Request changes” 需要保留审阅快照，不能只转成普通 prompt；
- 重新生成计划时要展示旧版/新版差异；
- Approve 后要明确锁定执行计划、权限模式和允许的工具范围；
- 计划状态应可恢复、可审计，而不是只存在于当前面板。

验收标准：用户关闭 IDE 后重新打开，仍可恢复同一份计划、批注、审批结果和执行进度。

2026-07-23 落地状态：两端现使用同一语义的 `cc-plan-review/v1` 持久化模型，
按 `sessionId` 优先关联审阅，记录单调 `revision`、draft/decision/terminal
状态、受限计划快照和最多 24K 字符的 Markdown 批注正文；每个 workspace/project
只保留最近 20 个 session。VS Code 在 plan 更新、审阅动作和面板销毁时写入
`workspaceState`，JetBrains 对等写入项目级 `PropertiesComponent`。自由 Markdown
中的 item comment 与 Reviewer Notes 会解析成最多 64 条带 `itemId`、文档源行、
文件/行/列和 agent turn 的结构化记录并随 review 事件传给 CLI；CLI 将获批计划项
与 `tool_use.id` 精确关联，流式回写 executing/completed/failed、开始/完成时间和错误。
两端只合并机器拥有的 status/progress 行，因此不会覆盖用户批注；重启后会恢复仍在
审批或执行的审阅，completed/failed/rejected 终态保持审计状态而不误弹编辑器。2026-07-23
进一步完成计划修订状态机：request changes/regenerate 会冻结旧 plan ID、创建新版本，
两端在机器管理的 Markdown 区块中持续展示 added/removed/changed，并忽略纯状态/进度变化。
Approve 会生成不可扩大的执行锁，审批记录和 `plan_update.execution_lock` 显式固化 plan ID、
权限模式、批准项 ID 与允许工具；settings/host allow 也不能绕过该锁。至此本节 Plan Review
代码与定向测试剩项已收口，真实多宿主发布验收仍按后文 E/H/D 项单独跟踪。

#### 3. Diff 审阅需要覆盖“用户修改 → Agent 反馈”闭环

已有原生 Diff 是基础，但还需保证：

- 文件级、hunk 级 Accept/Reject/Pick 的语义在 VS Code 与 JetBrains 一致；
- 用户在 proposed content 中的编辑不会被静默丢弃；
- Request changes 能带行号、批注和上下文回传 Agent；
- 接受、拒绝、用户改写、外部修改的来源可追踪；
- 冲突、文件删除、重命名、二进制文件和大文件有明确降级体验。

验收标准：任何一次接受或拒绝都能回答“谁在何时修改了什么、最终写入了什么、是否触发了后续 Agent turn”。

2026-07-23 落地状态：VS Code 与 JetBrains 的 `openDiff` 现在都会返回同语义的
`cc-diff-review/v1` 审计包，记录 review ID、时间、actor、host、路径、接受/拒绝结果、
`agent-proposed` / `user-edited` / `hunk-selection` 来源、实际选中的 hunk、结构化行批注、
是否写入及 baseline/proposed/reviewed/final 的 SHA-256/字符数/行数指纹；代码正文不进入
审计包。两端原有的可编辑 proposed content、文件/部分 hunk 接受、Request changes 行批注、
活缓冲区/磁盘漂移保护和二进制保护继续生效，并已增加 JS/Java 纯核与工具接线断言。
同日续批已把审计包绑定到 CLI 侧可信的 `sessionId / turnId / toolUseId`，并在
stream、headless runner 和 WebSocket/IDE Bridge 三条执行路径上，将有界、去正文的
`diffReview` 元数据写入对应文件写副作用账本；宿主回传的路径和关联 ID 会被 CLI 请求值覆盖，
审计对象通过非枚举内部字段交给账本，不进入模型可见的工具结果 JSON。`changes-requested`
会记录 `followUpRequested=true`，但这只表示请求了后续修订，不宣称后续 Agent turn 已完成。
本节尚未完全关闭：rename/delete 仍需协议显式携带意图；实际后续 turn 结果、大文件和真实
多宿主 UI 降级仍由验收矩阵跟踪。

### P1：影响效率和跨端一致性

#### 4. IDE Context API 仍需扩展到真正的代码理解

当前 active file、selection、diagnostics、open editors、terminal、diff 等能力已经具备基础。相对成熟 IDE 和 Claude Code 的 LSP 能力，还应补充统一协议：

| 能力                             | VS Code         | JetBrains             | 价值               |
| -------------------------------- | --------------- | --------------------- | ------------------ |
| Hover / 类型信息                 | Language Server | PSI / Language Server | 减少猜测类型和 API |
| Definition / References          | LSP             | PSI                   | 精准导航调用关系   |
| Implementations / Call hierarchy | LSP             | PSI                   | 支持影响面分析     |
| Symbol owner / Project model     | 部分可得        | PSI 较强              | 理解模块和依赖边界 |
| Rename preview                   | Workspace Edit  | Refactoring API       | 安全执行重构       |
| Test results / coverage          | Test API        | Test framework API    | 修改后自动验证     |
| Debug state                      | Debug Adapter   | Debugger API          | 复现运行时问题     |

建议定义版本化 `IdeContext v2`，所有工具统一返回 `workspaceId`、`documentUri`、版本号、dirty 状态、权限来源和数据新鲜度，避免 Agent 使用过期选区或旧诊断。

#### 5. Session、后台 Agent 和 Remote Control 还需统一状态机

当前已经有共享 session index 和后台 Agent 入口，但 IDE、CLI、Web/Mobile 之间仍需要统一以下状态：

`idle → working → waiting_permission / needs_input → completed / failed / stopped`

优化方向：

- session metadata、transcript、checkpoint、approval、artifact 分层存储；
- 使用 `sessionId / turnId / toolUseId / checkpointId` 全链路关联；
- 支持跨 workspace 搜索、重命名、删除、恢复、转后台、重新接管；
- 同一 session 只能有一个明确的写入者，避免 IDE tab 与后台 worker 并发写入；
- 断线后支持幂等重连、事件补发和孤儿进程回收；
- UI 展示“等待什么”“下一步由谁操作”，而不是只展示 spinner。

#### 6. 权限 UI 需要从“显示规则”升级为“可解释决策中心”

插件已有 allow/ask/deny 等权限可视化，但还应让用户看懂：

- 当前权限来自用户、项目、企业策略还是插件声明；
- 某次工具调用访问了哪些文件、网络、进程和凭据；
- auto mode 为什么允许或拒绝；
- 插件升级后新增了什么能力，旧 consent 是否失效；
- 哪些外部副作用无法回滚，例如网络请求、数据库写入、发布和发送消息。

建议引入统一 `PermissionDecision` 和 `SideEffectLedger`，IDE 只负责展示和审批，核心运行时负责最终判定。敏感值不得进入 session、日志、诊断包或插件配置明文。

#### 7. Plugin/MCP/LSP 管理器还不够“生态化”

相比 Claude Code 的 Marketplace 模型，重点差距不是安装按钮，而是全生命周期：

- Marketplace/私有 registry/本地目录的统一发现；
- scope、依赖、版本、锁定 commit、来源和许可证展示；
- 安装前能力 diff 和风险摘要；
- 插件加载错误、LSP 启动慢、MCP 不可用的可操作诊断；
- enable/disable/reload 无需重启；
- 升级前快照、失败回滚和兼容性检查；
- 企业 allowlist、denylist、签名、SBOM、审计日志。

Claude Code 官方文档明确区分插件的 Marketplace 来源和单个插件来源，并支持通过 SHA 锁定来源。[Marketplace 文档](https://code.claude.com/docs/en/plugin-marketplaces) ChainlessChain 可以在此基础上进一步做企业级签名和运行时沙箱。

#### 8. 浏览器和 Preview 能力还应形成可验证工作流

仅能获取 Preview URL 或浏览器状态还不足以支撑前端 Agent。建议：

- Preview 面板内置 console、network、DOM 摘要和 screenshot；
- browser action 默认只读，高风险点击、输入、上传、支付和发布必须审批；
- 每个浏览器动作记录目标、页面、结果和截图引用；
- URL、cookie、token、下载文件和截图路径做脱敏；
- 页面状态与代码变更、测试结果关联，形成“修改 → 刷新 → 检查 → 修复”闭环。

### P2：差异化和长期竞争力

#### 9. 缺少可量化的 Agent 成本和效果反馈

建议按 session、model、tool、skill、subagent、plugin、MCP server 统计：输入/输出 token、缓存命中、耗时、失败率、重试次数和估算成本，并把指标与具体代码变更关联。企业场景还需要按项目、团队和策略导出审计报表。

#### 10. Worktree、并行 Agent 和合并体验需要产品化

建议提供 worktree 列表、分支、owner、状态、未提交变更、冲突预测和一键 review。多个 Agent 并行时，每个 Agent 必须有独立权限、资源配额和副作用账本；合并前应能预览冲突并回滚。

#### 11. 测试、调试和质量门还没有完全进入主流程

Agent 修改后，IDE 应自动收集相关测试、lint、类型检查、构建和覆盖率结果；失败结果要能直接回到对应文件/行，并区分“代码失败”“环境失败”“测试数据失败”。发布门应同时运行 VS Code、JetBrains、CLI、真实 Bridge 和最小插件样例。

#### 12. IDE 原生体验仍可进一步补齐

优先级低于稳定性和安全，但可持续优化：

- inline completion / ghost text 的一致性和成本控制；
- 快捷键、命令面板、状态栏、通知和键盘无障碍；
- 大仓库上下文选择、忽略规则和 token budget 可视化；
- Markdown、HTML、图片、日志、JSON 等 Artifact 的统一预览；
- 多窗口、多根工作区、远程开发和容器开发的状态恢复。

## 四、建议的落地顺序

### 近期：P0（1 个版本周期）

1. Installation & Runtime Doctor 和版本兼容矩阵。
2. Plan Review 快照、批注、审批、恢复闭环。
3. Diff rename/delete 意图、Request Changes 后续 turn 结果和真实宿主降级验收。
4. VS Code / JetBrains 关键流程 Golden Fixtures 与真实 UI smoke test。

### 中期：P1（2～3 个版本周期）

1. `IdeContext v2`：LSP/PSI、测试结果、项目模型和数据新鲜度。
2. 统一 session/checkpoint/approval 状态机和跨端恢复。
3. PermissionDecision + SideEffectLedger。
4. Marketplace、依赖、签名、能力 diff、升级回滚和企业策略。
5. Browser/Preview 的只读观察、审批动作和审计闭环。

### 长期：P2

1. Agent 成本、质量和耗时的可观测性。
2. Worktree/并行 Agent/冲突合并中心。
3. 自动测试修复循环、调试器集成和发布门。
4. 面向企业的离线、私有部署、策略同步和合规报表。

## 五、建议的验收指标

| 指标                 | 建议目标                                                |
| -------------------- | ------------------------------------------------------- |
| 首次启动成功率       | 常见 Windows/macOS/Linux 环境 ≥ 95%                     |
| CLI/插件协议兼容失败 | 启动时可检测并给出明确修复，不进入无提示超时            |
| Plan 恢复成功率      | IDE 重启后 ≥ 99%                                        |
| Diff 用户改写丢失    | 0；所有改写都有来源和事件记录                           |
| 跨端 session 恢复    | IDE、CLI、Web 至少支持 attach/resume/stop               |
| 高风险操作           | 100% 可审计，默认不静默执行                             |
| 插件升级失败         | 可回滚到上一版本，且不破坏用户配置                      |
| IDE Bridge           | VS Code 与 JetBrains 共享协议、错误码和 Golden Fixtures |

## 六、最终判断

ChainlessChain 与 Claude Code 的差距已经不主要是“有没有聊天和 Diff”，而是**是否能把 IDE 原生能力、Agent 运行时和插件生态组合成一个稳定、可解释、可恢复的工程系统**。

最值得优先投入的是：

- 安装与诊断；
- Plan/Diff 审阅闭环；
- 跨端 session 与后台 Agent；
- 权限和副作用审计；
- Plugin/MCP/LSP 的供应链治理。

这些能力完成后，ChainlessChain 才能在“本地化、跨端、企业权限、可审计和可恢复”方面形成相对 Claude Code 的真正差异化，而不是只做功能数量对齐。

## 参考资料

- [Claude Code：VS Code 集成](https://code.claude.com/docs/en/ide-integrations)
- [Claude Code：JetBrains 集成](https://code.claude.com/docs/en/jetbrains)
- [Claude Code：发现和安装插件](https://code.claude.com/docs/en/discover-plugins)
- [Claude Code：创建插件](https://code.claude.com/docs/en/plugins)
- [Claude Code：插件 Marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- [ChainlessChain：IDE 差距分析](./ide/CLAUDE_CODE_IDE_GAP_ANALYSIS.md)
- [ChainlessChain：IDE 插件对照分析（2026-07-11）](./internal/ide-plugin-claude-code-gap-analysis-2026-07-11.md)

## 附录：命令兼容性增量（2026-07-22）

The VS Code and JetBrains chat panels now expose the same core command set:
`/new`, `/clear`, `/sessions`, `/plan`, `/approve`, `/reject`, `/auto`,
`/bypass`, `/normal`, `/think`, `/ultrathink`, `/think-off`, `/stop`,
`/compact`, `/cost`, `/context`, `/rewind`, `/retry`, `/handoff`, `/review`,
`/goal`, `/loop`, `/status`, `/doctor`, `/init`, `/mcp`, `/hooks`,
`/permissions`, `/agents`, `/tasks`, `/memory`, `/plugin`, and
`/release-notes`. Read-only diagnostic commands are forwarded to the local
CLI; `/goal` and `/loop` are panel-native and remain available without a
separate terminal. This follows Claude Code's documented slash-command model
and its official `/loop` and `/goal` workflows.

## Command parity implementation and verification

- VS Code `0.37.26`: the current slash-command catalog is discoverable from
  `/`; command syntax passes Node parse and parity smoke checks.
- JetBrains `0.4.68`: the same command catalog is implemented in
  `SlashCommands`, with `/goal` passed as `--goal-condition` and `/loop`
  scheduled on the application executor. Targeted `SlashCommandsTest` and
  `SessionArgsTest` pass.
- CLI-backed commands use the existing hardened CLI runner and are rendered as
  output in the chat transcript. Commands requiring richer interactive UI are
  intentionally not advertised until their UI contract is implemented.

### 2026-07-22 Release-gate wiring

- The VS Code extension workflow now installs `@vscode/test-electron` and runs
  the packaged VSIX in a fresh Extension Host profile, checking activation,
  command registration, and the local Bridge before artifact upload.
- PR/CI status is now exposed read-only in both IDEs through the CLI's
  `cc session pr-status last --json` authority; merge/push remains outside the
  IDE action and stays fail-closed in the CLI policy.
- Preview startup now performs a local HTTP health check after URL detection
  in both IDEs; `getPreviewState` exposes `health` so an emitted URL is not
  mistaken for a ready application.
- The JetBrains GUI smoke runs both as a release-gate job (Linux + xvfb) and as
  a scheduled/manual regression job because it requires a downloaded IDE and
  Remote Robot. Its result is intentionally not represented as a headless
  unit-test pass. It now also asserts that the chat composer, Send, and Stop
  controls render.
- Plan Review drafts now survive IDE restart in both hosts through a bounded
  `cc-plan-review/v1` state model. It versions each session's Markdown snapshot,
  plan items, and submitted/terminal decision state; VS Code persists it in
  workspace state and JetBrains in project properties. Active approval or
  execution views are reopened, while completed/failed/rejected reviews remain
  terminal audit state.
- Plan Review comments are now structured as bounded item/file/line/column/turn
  records and carried in the additive plan-control review payload. Approved
  tool calls emit `plan_item_id` and stream executing/completed/failed state;
  both hosts merge those machine-owned progress lines without overwriting
  reviewer text. Completed/failed/rejected reviews remain terminal audit state.
- Plan revisions now freeze the previous plan ID and create a new version.
  VS Code and JetBrains render a bounded machine-owned added/removed/changed
  block while ignoring status-only progress. Approval emits an immutable
  execution lock containing the plan ID, permission mode, approved item IDs,
  and allowed tools; settings or host allow rules cannot widen that lock.
- Agent extension-tool admission is now wired through the IDE launch boundary,
  not only at the CLI runtime seam. VS Code and JetBrains chat children pass a
  bounded, secret-free `CC_TOOL_ADMISSION` session envelope with host source,
  capability/policy/permission/budget/UI decisions, and explicit host-level
  deny overrides for `publish_artifact` and `notify`. The CLI accepts only the
  decision/provenance vocabulary (32 KiB and 256-tool caps), strips unrelated
  fields, and refuses an invalid enforcement envelope instead of starting an
  ungoverned session. Headless/stream runners and child agents inherit the
  sanitized policy; every admitted or denied call receives token-free
  `toolAttribution`. Actual MCP availability remains constrained by the runtime
  descriptor loader and managed MCP policy, so a disabled/unavailable server
  does not become callable merely because the host supports generic tool UI.
- Scheduled CLI/`cc ui` runs now opt into a fail-closed shell action policy:
  `git push` to protected branches, publish, merge, deploy, and infrastructure
  mutation commands require attendance or an explicit allowlist; unknown shell
  commands are denied. The policy is covered by shell classification, agenda
  argv, and `agent-core.executeTool` tests, while interactive runs remain
  unchanged unless `--unattended` is supplied.

### 当前无法由本地仓库单独关闭的验收项

- Official VS Code Marketplace 的正式发布仍需要配置 `VSCE_PAT`；Open VSX
  和 JetBrains Marketplace 已有 API 验证门。
- WSL、SSH、Dev Containers、Codespaces、JetBrains Gateway 的真实连接、断线、
  approval/cancel/resume 矩阵，以及跨进程 kill/resume 和 8 小时/1000 次
  soak，需要对应运行环境和 CI 资源。
- Collector/SIEM 的 OTLP 端到端接收、企业签名/SBOM/升级回滚生命周期，
  需要组织级基础设施与发布凭据。
- 本轮版本的 Open VSX 与 JetBrains `0.4.68` 均已完成发布及公开 API 回读；官方 VS Code Marketplace 仍需 `VSCE_PAT`。

### `/` 输入边界修复

Fixed the bare `/` edge case that previously fell through to `unknown command /`.
The fix is included in VS Code `0.37.26` and JetBrains `0.4.68`.
