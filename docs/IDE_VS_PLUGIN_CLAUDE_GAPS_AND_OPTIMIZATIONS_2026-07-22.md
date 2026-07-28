# ChainlessChain IDE 相对插件与 Claude Code 的不足及优化建议

更新日期：2026-07-28；最近代码复核：2026-07-28
评估范围：ChainlessChain VS Code / JetBrains 插件、IDE 宿主能力，以及 Claude Code 官方 IDE 集成和插件生态。

## 实施与发布状态

截至下述公开基线的仓库内高优先级实现、精确提交发布门与公开发布均已完成：

> 2026-07-28 已公开回读的发布基线为 CLI 0.162.184、VS Code 0.37.36、
> JetBrains 0.4.75。三个标签均精确指向提交
> `9c01ee579a4beb1b98e87226eed5f7b3a7a9565f`，不是从本地未提交状态或较旧
> CI 结果发布。下文的“已完成”仍不等于远程、多宿主或长期稳定性矩阵已经穷尽。

该公开基线包含第 7、9、10 节所述的失败升级事务恢复、retry/耗时归因和
team/batch 耐久治理；这些增量已通过同一精确提交的 GitHub Actions 三系统矩阵
与 IDE 发布门，并进入上述公开版本。发布标签之后工作区出现的后续源码增量未被
纳入这些制品，本文不会把未提交或标签之后的代码误写为已发布能力。

### 2026-07-28 发布与验收证据

| 发布面                   | 版本与标签                                                                                             | 公开回读                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI                      | [`v-npm-0-162-184`](https://github.com/chainlesschain/chainlesschain/tree/v-npm-0-162-184)             | [npm `chainlesschain@0.162.184`](https://www.npmjs.com/package/chainlesschain/v/0.162.184) 返回精确版本、tarball 与 integrity                     |
| VS Code / VSCodium       | [`ide-vscode-v0.37.36`](https://github.com/chainlesschain/chainlesschain/tree/ide-vscode-v0.37.36)     | [Open VSX API](https://open-vsx.org/api/chainlesschain/chainlesschain-ide) 返回 `latest=0.37.36`、`downloadable=true`、`listed=true`              |
| JetBrains                | [`ide-jetbrains-v0.4.75`](https://github.com/chainlesschain/chainlesschain/tree/ide-jetbrains-v0.4.75) | [JetBrains Marketplace API](https://plugins.jetbrains.com/api/plugins/32208/updates) 返回 `0.4.75`、`approve=true`、`listed=true`、`hidden=false` |
| VS Code 官方 Marketplace | 同一 `0.37.36` VSIX 已完成宿主验证                                                                     | 未发布；本次 tag workflow 在 Open VSX 即时回读因传播延迟失败后跳过该步骤，不能宣称已在官方市场发布                                                |

精确发布提交 [`9c01ee579a`](https://github.com/chainlesschain/chainlesschain/commit/9c01ee579a4beb1b98e87226eed5f7b3a7a9565f)
的必需门禁均为成功：

| 门禁               | 精确运行证据                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 全矩阵         | [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/30346500912)：52 个作业成功、0 失败，另有 1 个仅 PR 执行的 dry-run 作业按预期跳过；包含 Linux、Windows、macOS 分片与最终包校验                                                                                                                                                                                           |
| 严格沙箱与后台恢复 | [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/30346500650) 3/3 系统成功；[Background Interaction E2E](https://github.com/chainlesschain/chainlesschain/actions/runs/30346500226) 3/3 系统成功                                                                                                                                                              |
| IDE 发布门         | [IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/30346500726) 成功；覆盖 VSIX stable/minimum Extension Host、真实 Bridge、JetBrains build/test/Remote Robot GUI release gate                                                                                                                                                                                      |
| 仓库综合门         | [CI Tests](https://github.com/chainlesschain/chainlesschain/actions/runs/30346500538)、[Full Test Automation](https://github.com/chainlesschain/chainlesschain/actions/runs/30346500353)、[Code Quality & Security](https://github.com/chainlesschain/chainlesschain/actions/runs/30346500444) 与 [E2E Tests](https://github.com/chainlesschain/chainlesschain/actions/runs/30346500559) 均成功 |
| npm 发布           | [Publish CLI to npm](https://github.com/chainlesschain/chainlesschain/actions/runs/30351489255) 成功；npm registry 独立回读确认 `0.162.184` 可下载                                                                                                                                                                                                                                              |

[Open VSX tag workflow](https://github.com/chainlesschain/chainlesschain/actions/runs/30351936950)
已成功发布 `0.37.36`，但紧随其后的 12 次公开 API 验证仍收到传播期 404，因此该运行
最终标记为失败，后续官方 VS Code Marketplace 步骤也未执行。稍后独立执行同一验证
脚本已确认 `0.37.36` 可发现、可下载且公开；这里保留原始运行结论，不把市场传播延迟
改写成绿色工作流。

[JetBrains tag workflow](https://github.com/chainlesschain/chainlesschain/actions/runs/30352574443)
的构建、JUnit、Remote Robot GUI smoke、制品上传和 `publishPlugin` 均成功，但内置
2 分钟公开验证窗口结束时 Marketplace 尚未列出 `0.4.75`，因此该运行同样标记为失败。
约 7 分钟后独立回读已确认版本审核通过且公开。

### 本轮复核后已收口的历史开放项

| 项目                             | 当前证据                                                                                                              | 当前状态                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Desktop Coding Agent V3 生产接线 | `desktop-app-vue/src/main/index.js` 的 `initializeCodingAgentV3()` 创建并 attach `coding-agent-bootstrap`             | C/H 已完成；需打包应用 E2E             |
| 后台 Agent + Worktree            | `packages/cli/__tests__/unit/agent-background-worktree.test.js` 验证 worktree 创建、后台转交和参数剥离                | C/T 已完成；需真实长稳与清理 E2E       |
| 联合恢复幂等                     | headless runner/stream 接入 side-effect ledger reconcile，恢复时对未落定副作用提示核验                                | C/T 已完成；需跨进程 kill E2E          |
| 协议文档、离线回放和治理覆盖率   | `protocol-replay.js`、`gen-protocol-doc.mjs`、`governance-coverage.js` 及对应脚本/测试                                | C/T 已完成；需接入完整发布门           |
| 标准 OTLP 出口                   | `packages/cli/src/lib/observability/otlp-exporter.js` 提供 HTTP/HTTPS、批处理、重试统计和非阻塞失败处理               | C 已完成；需 Collector/SIEM 实环境验证 |
| VS Code Bridge token ACL         | `lockfile.js` 默认 fail-closed，目录、临时文件和最终 lockfile 均独立校验；仅 managed policy 可降级；5 项 ACL 回归通过 | C/T 已完成；仍需真实 Windows ACL 矩阵  |

| 项目                        | 状态                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code 插件能力清单        | 已完成，随 MCP `initialize` 动态返回实际工具和可选能力                                                                                                                                |
| JetBrains 插件能力清单      | 已完成，随 MCP `initialize` 动态返回实际工具和可选能力                                                                                                                                |
| VS Code 契约与插件回归      | 已完成，能力契约、定向 Vitest、VSIX metadata/selftest 与精确提交 IDE workflow 均通过                                                                                                  |
| VS Code 真实 Extension Host | 已完成，`0.37.36` VSIX 在 VS Code Stable 与最低支持版本 1.85.2 的干净 profile 激活，16 个关键命令和真实本地 Bridge 校验通过                                                           |
| JetBrains 契约测试          | 已完成，`IdeCapabilitiesTest` 通过                                                                                                                                                    |
| JetBrains 纯逻辑回归        | 已完成，`PureLogicSmokeMain` 1254/1254 通过                                                                                                                                           |
| JetBrains 完整单元测试      | 已完成，Gradle `test --rerun-tasks` 与精确提交 IDE workflow 通过                                                                                                                      |
| JetBrains 真实 GUI smoke    | 已完成，Remote Robot `IdeUiSmokeTest.chainlessChainToolWindowOpens` 通过                                                                                                              |
| JetBrains 插件构建          | 已完成，`0.4.75` ZIP 构建、JUnit、纯逻辑 smoke 与 Remote Robot GUI release gate 成功                                                                                                  |
| VS Code VSIX 构建           | 已完成，`0.37.36` VSIX 打包、metadata/selftest 及 Windows/Linux 宿主门通过                                                                                                            |
| Open VSX 发布               | 已发布 `0.37.36`；公开 API 已回读并确认可下载，发布 workflow 已接入 `scripts/verify-ide-marketplace.mjs`                                                                              |
| 定向复核测试                | 本地 CLI 相关定向套件 343 项通过、11 项按环境预期跳过；CLI/IDE/仓库级精确提交远程矩阵证据见上表                                                                                       |
| IDE Runtime Doctor          | 两端 Doctor 均主动探测 `cc --version`，把 CLI 下限、Bridge 和 workspace trust 汇总为 `可运行 / 可降级运行 / 需要修复`；共享 JSON fixture 锁定双端规则并拒绝 GCC 同名 `cc`             |
| Runtime 与离线恢复诊断      | 两端 Doctor 均探测 Node/Java，并报告 Managed CLI 当前/回滚副本和 Plugin Registry 离线缓存；探测不从不受信 workspace 解析可执行文件                                                    |
| IDE 脱敏诊断导出            | VS Code 命令/Status 入口与 JetBrains Tools action 均调用 `cc doctor --export-bundle`；私有临时文件通过 schema/隐私契约校验后才替换用户目标，异常产物保留旧文件                        |
| JetBrains Marketplace 发布  | `0.4.75` 已发布；公开 API 已回读并确认 `approve=true`、`listed=true`、`hidden=false`；发布 workflow 已接入同一验证脚本                                                                |
| VS Code 官方 Marketplace    | 未发布；本次发布步骤因前序 Open VSX 即时回读失败而未执行，不影响 Open VSX 已完成的公开发布                                                                                            |
| 跨端 `needs_input` 回答闭环 | `InteractionBinding`、后台 journal/settlement、同 turn 断线重附、Remote 权限校验及 VS Code / JetBrains / Desktop / Web / TS/Python SDK 原绑定回显均已完成定向验收；真实远程矩阵仍开放 |
| IDE Context 质量上下文      | 双端新增 `cc-ide-quality/v1` Test/Coverage/Debugger 只读快照，VS Code Notebook 执行附带真实 Context v2；宿主 API 缺失时显式降级                                                       |
| Plugin IDE 生命周期         | 双端直接展示并执行 upgrade、enable/disable、source、signature/SBOM、managed policy 与 live-session reload；失败升级事务恢复已进入本轮公开版本                                         |
| Plugin 用量归因             | plugin bin 与 plugin 提供的 MCP 工具按 plugin/version 写入无参数 compact transcript，并进入 CLI/双 IDE Usage 报告                                                                     |
| Worktree 后台治理           | IDE 新任务以 `--bg --worktree` 启动；同一任务行展示 lifecycle、owner/session、permission mode、预算和脱敏副作用计数；team/batch 也已接入独立耐久治理记录与只读 IDE 投影               |

当前公开 package/plugin 为 CLI `0.162.184`、VS Code `0.37.36`、
JetBrains `0.4.75`；三个公开制品均对应上文的精确发布提交，不包含标签之后的源码增量。
Plan/Diff、后台 Agent、Remote、
Artifact、Managed CLI、权限保护和安全审计等项目经代码核对已在现有
CLI/插件实现中落地；本轮没有重复实现。

## 一、结论摘要

ChainlessChain 当前的 IDE 插件已经覆盖聊天、Plan Review、原生 Diff、诊断信息、终端、Preview、后台 Agent、Remote Control、MCP/Plugin 管理等主干能力。因此，下一阶段的重点不应是继续堆叠聊天入口，而应集中在以下四件事：

1. **完成“IDE 宿主能力”和“插件能力”的边界治理**：把 IDE 提供的编辑器、语言服务、终端、调试器和浏览器上下文抽象成稳定协议，降低 VS Code 与 JetBrains 的行为差异。
2. **补齐 Claude Code 已形成用户预期的工作流闭环**：Plan → inline review → edit → diff → test/diagnostics → approve/rollback → resume。
3. **把插件系统做成可运营的生态**：市场发现、版本锁定、依赖解析、签名、权限、升级回滚、诊断和企业策略要形成闭环。
4. **提高跨端可观测性和可恢复性**：IDE、CLI、Desktop、Web/Mobile、后台 Agent 共享 session、权限、事件和副作用记录。

Claude Code 的官方 VS Code 集成已经将计划自动打开为完整 Markdown 文档，支持 inline comments；同时提供原生 Diff、当前选择区、Jupyter cell 执行、权限模式、上下文用量和 Remote Control 入口。[官方 VS Code 文档](https://code.claude.com/docs/en/ide-integrations)  
Claude Code 的 JetBrains 插件则突出原生 Diff、选择区/当前文件上下文、文件引用快捷键和诊断共享。[官方 JetBrains 文档](https://code.claude.com/docs/en/jetbrains)

2026-07-27 再核对官方页面：VS Code 集成还明确提供按
skill/subagent/plugin/MCP server 的本机近似用量归因、带 user/project/local scope
的图形 Plugin/Marketplace 管理、`--worktree` 并行任务和 Chrome 浏览器工作流；
这些能力已纳入下文第 7～10 节的对标口径，而不是沿用 7 月 22 日的旧功能面。

## 代码核对后的现状（截至 2026-07-28 发布）

本节以仓库当前代码为准，不把已经实现的能力重复列为缺口。

本轮已落地：两端 IDE MCP Bridge 在 `initialize` 响应中新增统一的
`chainlesschain.ide` 能力清单。清单由实际注册的工具动态生成，支持可选能力
（例如 JetBrains PSI 语义工具、VS Code multi-file diff/notebook）按宿主能力
降级，不再要求客户端假设两个 IDE 完全对称。

| 能力              | VS Code 插件                                                                                          | JetBrains 插件                                                                            | 判断                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 聊天/多会话       | `src/chat/`、`sessions-workbench.js`、`ide-session-index.js`                                          | `AgentChatSession`、`ConversationManager`、`SessionsWorkbench`、`IdeSessionIndex`         | 两端已有；重点转为协议一致性和恢复可靠性                                                                             |
| Plan Review       | `chat/plan-review.js`，有版本化恢复、结构化批注、计划修订 Diff 和逐项执行进度                         | `PlanReview`、`ChatEvents`，有对等解析/合并、修订 Diff 和项目级恢复状态                   | 快照、重启恢复、结构化批注、修订 Diff、执行关联和审批执行锁摘要均已完成                                              |
| 原生 Diff         | `ide-tools.js`、`diff-hunks.js`、`multi-diff.js`、`diff-apply-guard.js`、`diff-review-audit.js`       | `DiffHunks`、`MultiDiff`、`DiffApplyGuard`、`ReviewNote`、`DiffReviewAudit`               | 生命周期（含混合 changeset/mode-change）、审阅归因/后续结果和大小预算已统一；仅剩真实宿主 UI 矩阵验收                |
| IDE MCP Bridge    | `mcp-http-server.js` + `ide-tools.js` + `ide-context-v2.js`                                           | `McpServer` + `IdeTools` + `IdeContextV2`                                                 | 核心/语义/Diff/Test/Coverage/Debug/Notebook 只读上下文已版本化协商；未来写 API 属后续产品范围                        |
| 代码语义          | `semantic-tools.js`，包含 hover、definition、references、rename、call hierarchy、symbol/project model | `SemanticTools`，通过 PSI 提供同类语义工具                                                | 基础语义、项目模型、质量上下文和能力协商已接线；剩余为影响面选门与自动验证循环                                       |
| 终端/Preview      | `terminal-capture.js`、`preview.js`、`preview-detect.js`                                              | `TerminalTextReader`、`PreviewService`、`PreviewDetect`                                   | Preview 健康状态和 CLI 实浏览器 DOM/console/network/action 已有首批闭环；仍需收束进统一 IDE 工作流与实环境验收       |
| 后台 Agent/Remote | `background-agents.js`、`remote-handoff.js`、`remote-control-host.js`、`remote-doctor.js`             | `BackgroundAgents`、`RemoteHandoff`、`RemoteDoctor`、`RemoteControlAction`                | 已有入口；需要统一状态机、断线恢复和副作用账本                                                                       |
| Artifact          | `artifacts-drawer.js`、`ui/artifacts-view.js`                                                         | `Artifacts`、`ArtifactsAction`                                                            | 已有列表、元数据和预览降级；还可增强发布/重发布/会话关联                                                             |
| 权限/安全         | workspace trust、路径保护、Diff approval、auto-exec guard、plugin quality                             | `BridgeSecurityPolicy`、`IdePathGuard`、`DiffApplyGuard`、`AutoExecGuard`、`PolicyViewer` | 已有策略来源中心、拒绝链、脱敏 `PermissionDecision` 与副作用关联；仍需覆盖全部工具/资源和跨端账本 UI                 |
| 插件管理          | `plugin-manager.js`、`plugin-quality.js`、管理视图                                                    | `PluginManager`、`PluginQuality`、管理 action                                             | CLI 供应链治理核已具备签名/SBOM、依赖、事务升级回滚、能力重授权和企业策略；双 IDE 只在确认激活后重载，仍需实环境验收 |
| CLI 运行时        | Managed CLI、版本检查、安装、升级、回滚、`runtime-compatibility.js`                                   | `ManagedCliRuntime`、`ManagedCli`、`CliVersionCheck`、`RuntimeCompatibility`              | 已解决全局 CLI 依赖、单一兼容性结论和离线缓存诊断；仍需真实版本/网络矩阵                                             |
| 代码补全          | VS Code `completion.js`，配置项和手动触发                                                             | Kotlin `CcInlineCompletionProvider`，另有手动触发 action                                  | 两端都有，但仍不是 Claude Code/Copilot 级的持续 ghost-text 体验；应继续控制延迟和成本                                |
| GUI 自动化验证    | extension-host 测试                                                                                   | Remote Robot `uiTest` 为隔离/nightly smoke，60 个 Java 单测文件                           | 单测覆盖较好；发布门仍应加入关键真实 UI 场景，而不仅是纯逻辑测试                                                     |

代码依据（版本以本节顶部的当前基线为准）：

> 说明：下方链接说明的是能力来源；版本以本节顶部的当前代码基线为准。历史版本号不会改变本报告的结论。

- [VS Code package.json](../packages/vscode-extension/package.json)（当前已发布源码版本 `0.37.36`、命令、权限和配置入口）。
- [VS Code IDE tools](../packages/vscode-extension/src/ide-tools.js) 与 [semantic tools](../packages/vscode-extension/src/semantic-tools.js)。
- [JetBrains plugin.xml](../packages/jetbrains-plugin/src/main/resources/META-INF/plugin.xml)（当前版本以插件构建配置和顶部基线为准、Tool Window、Action 和能力说明）。
- [JetBrains IdeTools](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/IdeTools.java) 与 [SemanticTools](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/SemanticTools.java)。
- [VS Code capability manifest](../packages/vscode-extension/src/ide-capabilities.js) 与测试。
- [JetBrains capability manifest](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/IdeCapabilities.java) 与测试。

### 两端相对 Claude Code 的真实差距

结合代码后，当前最值得写入路线图的不是“补齐聊天、Diff、MCP、语义工具”，这些已经存在，而是：

1. **协议和行为仍可能漂移**：两端虽然使用同名工具，但 IDE API 的可选能力、错误形状、超时、路径处理和事件顺序仍需 Golden Fixtures 约束。
2. **VS Code 与 JetBrains 的深度能力不完全对称**：JetBrains 的 PSI 语义能力更强；VS Code 更接近原生编辑器/Notebook 生态。应让 Agent 获得能力声明，而不是假设两端工具永远存在。
3. **用户审阅状态已进入会话与副作用账本，代码闭环已形成**：Plan Review 的批注、审批和后续 Agent turn 已可持久化/重放；Diff hunk 选择、proposed content 用户改写及 Request Changes 后续结果已有跨端统一审计模型，并已绑定 session/turn/toolUse、随对应文件写副作用持久化。剩余工作转为真实宿主与发布矩阵验收。
4. **UI 已有很多入口，但主任务链还未完全收束**：用户可能在 Chat、Dashboard、Sessions、Background Agents、Remote Control、Artifacts、Plugin Manager 之间切换；需要统一工作台或上下文导航。
5. **插件供应链核心已具备，但 IDE 产品面与实环境仍未闭环**：CLI 已有 registry/私有缓存、依赖解析、不可变版本、签名/SBOM、能力 consent、事务升级回滚和 managed policy；双 IDE 已接入版本切换、capability consent、source/signature/policy 明细与失败恢复状态，仍需跨源发现、dependency/license 图和真实私有 registry/失败注入矩阵。
6. **自动验证已有真实宿主门，但关键链路覆盖仍不完整**：JetBrains Remote Robot 已进入 release/scheduled gate，VS Code 也有打包 VSIX Extension Host 测试。仍应扩展 Plan、Diff、权限审批、断线恢复、@mention、Preview、Plugin/MCP/LSP 样例和多版本组合，而不是把现有 smoke 等同于完整验收。

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
- CLI、插件、IDE Bridge 的版本组合此前缺少用户可理解的兼容性结论；双端现已输出统一三态结论，真实版本组合矩阵仍待持续验证。
- `cc` 不在 PATH、CLI 版本过旧、Node/Java 环境缺失时，用户容易只看到底层错误。
- 远程、WSL、代理、防火墙、企业网络环境的失败原因仍可能需要人工排查。

优化建议：

- 首次启动增加 **Installation & Runtime Doctor**：检查插件版本、CLI 版本、Bridge、Node/Java、PATH、网络、权限和 workspace trust。
- 输出单一结论：`可运行 / 可降级运行 / 需要修复`，并提供安全范围内的一键修复。
- 建立兼容性矩阵和自动升级策略；用户显式配置的 CLI 路径不能被静默覆盖。
- 发布前对 VSIX、ZIP、CLI 和 Bridge 执行同一组 smoke tests，并在插件 UI 显示构建版本、协议版本和诊断 ID。

验收标准：新机器无全局 `cc` 时，插件能自动给出可复制的修复路径；失败诊断不再只出现 `command not found` 或超时。

**2026-07-23 代码收口**：现有 VS Code Runtime Doctor、Remote/WSL Doctor 和受控修复入口之外，两端已新增脱敏诊断包导出。VS Code 的 `chainlesschain.ide.exportDiagnostics` 命令可从 Status 视图启动，JetBrains 的 `ExportDiagnosticsAction` 位于 Tools 菜单；用户先选本地目标，CLI 再写入同目录私有临时文件。宿主确认 `cc-diagnostic-bundle/v1` 和默认排除清单契约后才替换目标；无效/旧版 CLI 产物不会截断已有文件，符号链接或非普通文件目标会被拒绝，临时文件始终清理，成功后可直接打开 JSON。该项的 C/T/H 接线缺口已关闭，剩余为真实 VS Code/JetBrains、Remote/WSL 和发布包矩阵验收。

**2026-07-23 续，兼容性单一结论收口**：新增 VS Code `runtime-compatibility.js` 与 JetBrains `RuntimeCompatibility` 孪生纯核；Doctor 主动执行 `cc --version`，结合最低 CLI 版本、Bridge 状态和 workspace trust，输出唯一的 `READY（可运行）`、`DEGRADED（可降级运行）` 或 `NEEDS REPAIR（需要修复）`。CLI 缺失、低于下限或 `cc` 实为 GCC/Clang 等同名命令时要求修复；Bridge 停止或 workspace 受限时允许降级并列出原因。两端直接读取同一 JSON fixture，覆盖三种结论及边界组合；JetBrains 报告同时展示插件、IntelliJ 平台和 CLI 版本。该“单一兼容性结论”的 C/T/H seam 已关闭；Node/Java 环境探测、离线缓存诊断和真实 IDE × 插件 × CLI 发布矩阵仍保留。

**2026-07-27 Runtime 与离线恢复收口**：VS Code `runtime-environment.js` 与
JetBrains `RuntimeEnvironment` 现主动探测 Node/Java 版本，并检查 Managed CLI
当前副本、回滚版本和 Plugin Registry 内容寻址离线缓存。Doctor 报告把这些信号与
既有三态兼容性结论并列显示；缺失、过旧、缓存损坏/不完整与无缓存都给出明确状态，
不会用“0 个条目”冒充可离线恢复。Windows 探测不会从不受信 workspace 当前目录解析
`node.exe`/`java.exe`。双端解析、缓存状态和报告回归通过；本节仓库内 C/T/H seam
已关闭，仍需真实新机、代理/防火墙、Remote/WSL 和发布包版本矩阵。

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
后续批次又增加显式 `delete_file` / `move_file` 工具，并让 CLI → IDE 的 `openDiff`
携带 `operation=modify|create|delete|rename` 与 rename `targetPath`。两端分别独立校验源和
目标路径；Accept 删除会删除源文件，Accept 重命名会拒绝覆盖已有目标并在目标路径应用用户
改写，生命周期操作不提供容易误解的部分 hunk 接受。审计包同时记录 operation/targetPath，
删除接受态的 `final` 为 `null`，不会把空文本误报为最终文件。权限、Plan、子 Agent allowlist
与副作用账本也已识别这两个非幂等文件操作。显式 rename/delete 的代码与定向测试缺口至此
关闭。随后新增 `diff-review-follow-up.js`：`changes-requested` 先以 `followUp.status=pending`
持久化，下一次同一可信 session/path 的审阅会把 accepted/rejected/changes-requested、
review/turn/toolUse、written 和时间回写原审阅，同时在新审阅写入 `followUpOfReviewId`。若本轮
正常结束但未重新提议，记录 `completed-without-reproposal`；异常结束记录 `interrupted`。
pending 状态可从序列化账本恢复，stream、headless runner、WebSocket/IDE Bridge 三条路径均
接线，且不保存回复或代码正文。Request Changes 的实际后续结果代码缺口至此关闭。

同日继续补齐 Diff 降级预算：VS Code `checkReviewPayload` / `planMultiDiffReview` 与
JetBrains `DiffApplyGuard.ReviewPayload` / `MultiDiff.ReviewPlan` 使用相同阈值——单文件
baseline+proposal 合计最多 2 MiB、一个 changeset 最多 64 个文件/8 MiB。二进制、大文件和
超出聚合预算的条目在创建原生编辑器文档前 fail-closed，混合 changeset 只允许明确展示过的
文本子集落盘；结果返回 content-free 的 `degradation.skipped`（path/kind/reason/bytes/limit）
以及兼容字段 `skippedBinary` / `skippedLarge`，不会静默应用被跳过内容。无显式 baseline 时
只读取文件长度和最多 8 KiB 二进制探针，不会为了判断超限先把整个大文件载入内存。JetBrains 多文件
统计也改为复用带 400 万 DP 单元保护的 `DiffHunks`，不再另建无界二维 LCS 数组。大文件/
二进制/changeset 容量降级的 C/T/H 代码缺口至此关闭。

随后双端 `openMultiDiff` 又把每个条目从单纯文本替换扩展为显式
`modify|create|delete|rename|mode-change` 意图，并保留 `targetPath`、`oldMode`、`newMode`。
Bridge 会独立验证源路径和 rename 目标路径；Planner 会在打开原生文档前拒绝未知操作、缺失
rename 目标、带非空 proposal 的 delete、无效 mode 或夹带内容修改的 mode-change。Accept
按操作执行：create 使用不覆盖创建，delete 删除源文件，rename 拒绝覆盖已有目标并可在目标
应用已审阅文本，POSIX 宿主用规范化权限位执行 mode-change；Windows 等不支持 POSIX mode
的宿主返回 content-free 的 `skippedUnsupported` / `degradation.skipped`，不会退化为文本
覆盖。混合批次可应用安全子集，并以 `appliedOperations` / `failedOperations` 明确回传逐项
结果。mode-change/混合生命周期 changeset 的 C/T/H 代码缺口至此关闭，只保留真实 VS Code
与 JetBrains 宿主 UI 矩阵验收。

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

**2026-07-23 首批接线**：VS Code `ide-context-v2.js` 与 JetBrains `IdeContextV2` 已用同一 JSON fixture 固化 `cc-ide-context/v2`。`getSelection`、`getActiveFile`、`getDiagnostics`、`getOpenEditors` 的真实宿主返回会附加 `context`：匿名且稳定的 `workspaceId`（规范化 workspace roots 的 SHA-256 截断摘要，不泄漏路径）、`documentUri`、`documentVersion`、`isDirty`、`permissionSource`，以及 `freshness.state/capturedAt`；多文档 diagnostics/editors 的每条记录也携带各自 URI/version/dirty。VS Code 从 live `TextDocument.version/isDirty` 与 Workspace Trust 采集，JetBrains 从 `Document.modificationStamp`、FileDocumentManager 与 project policy 采集。metadata 探测失败时仅省略 additive `context`，不抹掉旧 payload；旧 fake/宿主未实现该能力时原返回结构保持不变。共享 fixture 锁定 Windows/Unix root 规范化、排序无关 workspace digest、null 文档和毫秒时间格式。该四工具基础封套的 C/T/H seam 已关闭；语义工具、测试结果/coverage、debug state 和写工具的统一元数据仍开放。

**2026-07-23 续，语义工具接线**：VS Code `semantic-tools.js` 和 JetBrains
`SemanticTools` 现通过各自真实编辑器 facade 复用同一 Context v2 构造与权限/新鲜度
探针。`getHover`、`goToDefinition`、`findReferences`、`renamePreview`、
`getCallHierarchy`、`getSymbolInfo` 六个位置型工具附加查询源文档的
URI/version/dirty metadata；`getProjectModel` 附加 document-null 的 workspace
metadata。旧 semantic facade 不提供 metadata、关闭文档或宿主探针异常时，只省略
additive `context`，原语义结果不变。JS/Java 定向测试覆盖全部七工具、项目模型空文档
语义和探针失败降级。语义/项目模型的 C/T/H seam 已关闭；测试结果/coverage、debug
state 和写工具仍开放。

**2026-07-23 续，Diff 写入审阅接线**：双端 `openDiff` 在审阅与 stale guard 落定后
附加源文档 Context v2，rename 同时附加 `targetContext`；`openMultiDiff` 附加
document-null 的 workspace context，并以 `documentContexts` 按受保护 changeset 的
原顺序返回每个源文档、operation 与可选 rename 目标 context。metadata 只描述宿主中
审阅完成后的文档状态，不替代原有 baseline 指纹、漂移拒绝、路径守卫或
`cc-diff-review/v1` 审计。旧 facade 或单个文档探针失败时仅省略对应 additive 字段，
不改变接受/拒绝、逐项结果和审计 payload。Diff 写入审阅 metadata 的 C/T/H seam 已
关闭；测试结果/coverage、debug state、Notebook 执行和未来写 API 仍开放。

**2026-07-27 质量上下文与 Notebook 收口**：双端能力协商新增条件化
`getTestResults`、`getCoverage`、`getDebugState`，统一返回有界
`cc-ide-quality/v1` payload 并附加 Context v2 workspace/permission/freshness
封套。VS Code 在宿主获准 `testObserver` 时读取 Test API，并始终使用稳定 Debug
API；Marketplace 稳定宿主会拒绝读取 proposed `tests.testResults`，facade 以
`try/catch` fail-closed 且不发布 Test/Coverage 能力，避免扩展激活失败。JetBrains
对可选 test runner、coverage 和 debugger API 做只读适配；API、suite 或 provider
不存在时显式返回 unavailable，
不伪造零测试/零覆盖率。Debugger 输出排除 launch args、环境变量、表达式和凭据字段。
VS Code `executeCode` 同时返回 notebook URI/type 并附加实际 Notebook 文档版本、
dirty 与 freshness，而不是 active text editor 的猜测。JS/Java 定向测试与 JetBrains
编译通过。Test/Coverage/Debugger/Notebook 的首批 C/T/H seam 已关闭；未来写 API、
按变更影响面自动选门、失败分类/文件行映射和“失败→修复→重跑→Artifact”循环仍开放。

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

**2026-07-27 `needs_input` 跨端闭环验收**：运行时权威
`InteractionBinding` 校验、后台 question journal 与幂等 settlement、断线后重附
同一 pending turn（不创建 follow-up turn）、Remote 配对端 answer 权限校验，以及
VS Code / JetBrains / Desktop / Web / TS/Python SDK 的原 request/binding 回显已
作为同一协议闭环复核。CLI/Remote/VS 定向 85 项、Web 37 项、TypeScript SDK
35 项、Desktop 40 项及 JetBrains 对应测试通过；Python SDK 的受支持版本矩阵由
CI 负责，本机仅有低于 SDK 下限的 Python 3.8，未将环境阻塞误报为代码通过。

本节尚未整体关闭：session metadata/transcript/checkpoint/approval/artifact
的跨端分层存储、全部宿主对 canonical lifecycle 的直接消费、Mobile 原生入口、
跨 workspace 全生命周期操作，以及真实 Remote/WSL/SSH/Container 的
kill/reconnect/soak 矩阵仍需后续证据。

#### 6. 权限 UI 需要从“显示规则”升级为“可解释决策中心”

插件已有 allow/ask/deny 等权限可视化，但还应让用户看懂：

- 当前权限来自用户、项目、企业策略还是插件声明；
- 某次工具调用访问了哪些文件、网络、进程和凭据；
- auto mode 为什么允许或拒绝；
- 插件升级后新增了什么能力，旧 consent 是否失效；
- 哪些外部副作用无法回滚，例如网络请求、数据库写入、发布和发送消息。

建议引入统一 `PermissionDecision` 和 `SideEffectLedger`，IDE 只负责展示和审批，核心运行时负责最终判定。敏感值不得进入 session、日志、诊断包或插件配置明文。

**2026-07-26 首批可解释决策闭环**：CLI 原有权限核已经按
deny/ask/allow、shell policy、ApprovalGate、managed host policy、
Hooks v2 与 auto-mode 顺序执行；`cc permissions list/recent/test --json`
可给出用户/项目/本地/managed 来源、命中规则、近期拒绝与 auto-mode
决策矩阵。VS Code `policy-viewer` 和 JetBrains `PolicyViewer` 均只读展示
这些 CLI 权威结论，不在宿主侧复制判定逻辑。上一批已经落地的
`SideEffectLedger` 则对文件写删移、shell、git push、包安装、网络变更、
artifact/notify/browser action 等操作执行
`prepared → started → committed|failed|unknown`，恢复时对不确定且非幂等
结果要求 inspect，避免盲目重放。

本批新增版本化、稳定关联且脱敏的 `permission_decision` 协议对象：
当 runtime 结果暴露显式 policy/approval verdict 时，`tool_result` 会携带
decision ID、tool、allow/ask/deny、判定来源、规则、原因和有界分层 chain；
字段缺失不等于“未经过权限门”或“已允许”。单一协商能力
`permission_decision` 原子控制对象与 `permission_decision_id`，不会只下发
其中一个。该对象中的所有可控文本在进入 wire、transcript 或账本副本前先经过
secret redactor；TS/Python SDK 均提供类型化读取。headless runner/stream
会把同一决策写入对应副作用记录，VS Code 与 JetBrains chat 在失败工具旁直接
显示 runtime 给出的来源与原因；IDE 仍不能据此重新授权副作用。插件能力扩宽的
consent 失效/重授权由第 7 节所述统一 plugin runtime 判定。

本批定向证据：CLI 6 个权限/账本/VS Code 映射测试文件 91 项通过；
TypeScript SDK 3 个文件 29 项通过且 `tsc --noEmit` 通过；Python SDK
14 项通过；JetBrains `ChatEventsTest`/`ProtocolFixturesTest` 通过并完成插件
Java 编译。

本节尚未整体关闭：当前统一对象只覆盖产生显式 policy/approval/chain 的调用，
普通未设门的 allow 路径不会伪造“已审计决策”；账本关联目前以持久化
headless runner/stream 为首批闭环，仍需 WS/background/Desktop/Web/Mobile
统一消费。还需将每次调用实际访问的文件、网络、进程、凭据和可回滚性形成
同一资源清单，并完成数据库写入、消息发送、真实远程宿主、诊断导出与长期
恢复矩阵。

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

**2026-07-26 运行时供应链复核**：本节不再能整体表述为“缺少供应链
治理”。统一 CLI plugin runtime 已支持 project/user/managed scope、本地目录、
Git URL/ref 和公开/私有 registry；registry 强制 HTTPS（显式开发例外）、支持
Bearer 凭据与内容寻址离线缓存。安装版本保存在不可变版本目录，`.active`
指针可通过 `cc plugin use` 切换或回滚；依赖使用 semver 约束检查。安装时可
校验 SHA-256 与 detached Ed25519 签名，并把可复验的签名材料和文件级 SBOM
写入版本锁；加载时会重新校验 manifest、签名、SBOM、managed allowlist/
denylist 和 pinned signing keys。能力声明采用集合 consent，升级仅在能力扩宽
时要求重新授权；未授权组件在统一发现入口 fail-closed。runtime reload 会
重新扫描 plugin/MCP/LSP/hooks/agents 等组件而无需重启 CLI。

VS Code 与 JetBrains 的现有管理面已统一提供 installed/add、registry 来源、
trust/untrust、uninstall、MCP connect/remove 和只读质量面板；质量面板结合
`plugin validate` 与 `code-intel status` 展示损坏 manifest、LSP 状态和未使用
组件。2026-07-26 续批又让 `plugin installed --json` 返回有界 installed
versions，并在两端加入版本切换/rollback 以及 capability consent 的查看、
授予和撤销入口；IDE 只构造 argv 和展示 CLI 结论，版本存在性、能力集合与最终
授权仍由 CLI 校验。切换只影响新 session，UI 会明确提醒正在运行的 session
需要自行 reload，不能误报为热替换成功。

供应链核心的 13 个 CLI 测试文件共 271 项通过；新增入口复核的 3 个 JS
测试文件 52 项通过，JetBrains `PluginManagerTest`/`PluginQualityTest`
通过且插件编译成功。

**2026-07-27 IDE 生命周期与供应链明细收口**：统一 runtime 新增 scoped
enable/disable marker，discovery 对 disabled 插件 fail-closed，但 installed
清单仍可检查和恢复；升级可复用 registry/Git/local 来源、SHA-256、Ed25519、
trusted key 和 managed policy，并把去凭据/查询参数的来源元数据写入不可变版本。
`plugin installed --json` 有界返回 source/ref、签名验证、SBOM digest/file/byte
汇总和 managed policy 来源/原因。VS Code 与 JetBrains 管理面直接提供
upgrade、enable/disable、详情和 reload；reload 会重启所有当前 live chat
session，再刷新 CLI 权威清单，不能把旧进程误报为已热替换。CLI lifecycle /
install、VS Code argv/解析/UI 与 JetBrains 纯核/编译定向回归通过。

**2026-07-28 失败升级自动恢复收口**：CLI 安装器不再直接删除/覆盖现役版本。
源码先复制到同卷隐藏 staging 目录，清除来源伪造的 lock/provenance，重新解析完整
manifest，并在签名安装时再次校验 manifest、签名和文件级 SBOM；全部通过后才用
rename 提交版本目录和原子更新 `.active`。升级命令保留事务直到 capability gate
结束：复制、加载校验或命令后处理失败会恢复旧 active；能力扩宽未授权时，新版本会
被移除并恢复旧版本；同版本 `--force` 重装也会恢复原字节，而不是只把指针写回同一
目录。`--json` 输出受控的 `activated / rolled_back / unchanged`、恢复版本和原因。
VS Code 与 JetBrains 均只在 `activated` 后重载 live session；遇到能力扩宽会展示
新增能力，用户明确选择后才以 `--grant-capabilities` 重试，无法解析或已回滚的结果
不会误报“升级完成”。CLI 10 个相关测试文件 93 项通过（Doctor 冷启动用例以
30 秒测试上限单独复核），JetBrains `PluginManagerTest` 及 Java 编译通过。
该增量已包含于精确发布提交 `9c01ee579a4beb1b98e87226eed5f7b3a7a9565f`，
并进入 CLI `0.162.184`、Open VSX `0.37.36` 与 JetBrains `0.4.75` 的公开制品。

仍开放的是 Marketplace 跨源发现 UI、dependency/license 图，以及真实私有
registry、组织签名密钥、并发/断电/杀进程失败注入和多 IDE 版本兼容矩阵。因而本节已关闭核心
runtime 与 IDE 首批完整生命周期 C/T/H seam，但不能据此宣称整个插件生态生命周期
已经验收。

#### 8. 浏览器和 Preview 能力还应形成可验证工作流

仅能获取 Preview URL 或浏览器状态还不足以支撑前端 Agent。建议：

- Preview 面板内置 console、network、DOM 摘要和 screenshot；
- browser action 默认只读，高风险点击、输入、上传、支付和发布必须审批；
- 每个浏览器动作记录目标、页面、结果和截图引用；
- URL、cookie、token、下载文件和截图路径做脱敏；
- 页面状态与代码变更、测试结果关联，形成“修改 → 刷新 → 检查 → 修复”闭环。

**2026-07-26 首批安全验证闭环**：双 IDE 的 Preview 已能自动识别启动
URL、执行本地 HTTP 健康探测，并通过 `getPreviewState` 返回
running/url/script/health/exit/output。CLI `browser_state` 以 LOW、只读且
Plan-mode 可用的工具连接 loopback CDP，采集真实 Chrome 的当前页、tabs、
console、失败/错误 network、限长 DOM 和可选 screenshot；`browser_act`
则只接受 click/type/press/http(s) navigate/wait/screenshot/assert 的显式
动作，按 HIGH risk 走 ApprovalGate，且已进入网络副作用分类。

本轮进一步把浏览器数据边界与审计闭合：URL 移除 userinfo、fragment 和
query value，title/console/network/DOM/错误文本统一做 secret redaction，
敏感表单值及 DOM 内 URL 参数不会进入 Agent 结果；每个动作的 JSONL 审计
记录脱敏后的 pageBefore/pageAfter、目标、结果、耗时和 screenshotRef。
代理侧截图先写到不可由 Agent 指定的临时路径，随后立即发布为绑定 session
的持久 Artifact，工具返回仅含 opaque Artifact 元数据，不暴露临时绝对路径或
内部 `sourcePath`，复制后临时文件被清理。显式本地 `cc browse chrome`
命令仍按本机操作边界返回本地截图路径，不把这一行为误报为远程协议能力。

相关 CLI/VS Code 的 10 个测试文件共 117 项通过；另有 2 个工具契约测试
文件 22 项通过，三个修改后的 runtime 文件通过 Node syntax check。

仍开放的是：把 console/network/DOM 直接收束到 Preview 面板，而不是由
独立 connector 命令查看；把页面证据与具体 code diff、test result 和
verification tier 持久关联；为 upload/download/payment/publish 建立比
“全部 HIGH risk”更细的语义审批；补 cookies/login scope 生命周期、视觉
baseline、真实 Chrome + VS Code + JetBrains 版本矩阵和长时间恢复测试。
因此本节关闭的是首批观察/动作/脱敏/审计/Artifact C/T/H seam，不代表完整
Browser/Preview 产品闭环已经验收。

### P2：差异化和长期竞争力

#### 9. Agent 成本和效果反馈已有基础，仍需治理化

建议按 session、model、tool、skill、subagent、plugin、MCP server 统计：输入/输出 token、缓存命中、耗时、失败率、重试次数和估算成本，并把指标与具体代码变更关联。企业场景还需要按项目、团队和策略导出审计报表。

**2026-07-26 代码复核**：CLI 已有 `cc session usage`、`cc cost`、
`cc context` 和 `cc insights`。持久 session 可按 provider/model 聚合
input/output/cache-read/cache-create token 和估算成本；additive attribution
还能按 main/skill/subagent、具体 skill、subagent、tool 和 MCP server 汇总
调用、错误及 turn 近似 token。`insights` 同时给出 session 时长、消息数、
tool 调用/错误率和 compaction 次数。VS Code 的 Show Token Usage Markdown
报告与 JetBrains 同名对话框已消费同一 CLI 权威数据，提供 24h/7d/30d/all-time、
模型和 attribution 视图，并对 subagent 占比、cache miss 和长上下文给出提示。

**2026-07-27 Plugin 精确归因收口**：plugin bin 的 `plugin_bin` provenance 与
plugin 提供的 MCP descriptor 现携带稳定 plugin/version identity；REPL、
headless runner 和 stream runner 在 tool settle 时只持久化 tool/error/plugin/version
compact record，不落 tool arguments。`cc session usage --by plugin`、全局聚合及
VS Code / JetBrains Usage 报告均展示 plugin 调用、错误和 turn-token 近似值。
真实 JSONL transcript 与命令输出集成测试、MCP provenance、三种 runner、双 IDE
报告回归通过。

**2026-07-28 Retry 与耗时归因首批收口**：REPL、单次 headless 与 IDE 使用的
stream runner 现从 runtime `toolTelemetryRecord` 把每次 tool 的真实耗时写入
无参数 compact record；同一 turn 内失败后再次调用同名工具会标记为 observed
retry。自动 LLM 流重试则精确持久化失败 attempt 的耗时、实际 provider/model 和
受控原因码，不保存原始错误、URL 或凭据。单 session 与全局 Usage 聚合按
tool/MCP server/plugin 汇总 timed calls、耗时和 observed retries，并按原因和
模型汇总 LLM retries；`cc session usage --by retry`、VS Code Markdown 与
JetBrains 报告均直接消费同一权威数据。旧 transcript 没有这些字段时保持旧
JSON/报表形状。当前增量已经过 JS 定向矩阵和 JetBrains `UsageReportTest`
验证，并已包含于精确发布提交 `9c01ee579a4beb1b98e87226eed5f7b3a7a9565f`
及 CLI `0.162.184`、Open VSX `0.37.36`、JetBrains `0.4.75` 的公开制品。

仍开放的是非流式 provider/SDK 内部重试的统一可见性、跨 turn 的语义重试判定、
token/cost 到具体 diff/test/artifact 的因果关联，以及按
workspace/team/managed policy 导出的合规报表和预算告警。因此不能把现有 token
报表等同于完整效果评估平台。

#### 10. Worktree、并行 Agent 和合并体验已有首批产品面

建议提供 worktree 列表、分支、owner、状态、未提交变更、冲突预测和一键 review。多个 Agent 并行时，每个 Agent 必须有独立权限、资源配额和副作用账本；合并前应能预览冲突并回滚。

**2026-07-26 代码复核**：CLI 的 `agent --worktree`、background agent、
`team --worktree` 和 `batch` 已使用真实 git worktree 做隔离，并具备空工作树
安全清理、保留有改动分支、测试结果聚合与 merge preview。VS Code
`worktree-tasks.js` 和 JetBrains `WorktreeTasks`/`WorktreeTasksAction`
已有任务 worktree 列表、dirty/change footprint、ahead/shortstat、
`git merge-tree` 冲突预判、新建隔离任务、合并及确认后丢弃入口；冲突时
merge 会中止，不会强行覆盖主工作树。

**2026-07-27 Background Worktree 治理接线**：后台 supervisor 为每次运行持久化
有界且无 prompt/argv/token 的 governance envelope，owner 由 supervisor 生成，
permission mode 只接受公开枚举，预算只接受正数。`cc daemon view --json` 同时
附加 `SideEffectLedger` 的 total/unsettled/unknown 计数，不暴露副作用 metadata。
双 IDE 的“New isolated task”改为 `cc agent --bg --worktree`，任务行按 branch、
再按规范化路径关联 canonical lifecycle、owner/session、permission mode、预算和
副作用摘要；旧任务没有权威记录时明确显示 unmanaged。`team/*` 分支也能被识别，
不会再从面板消失。CLI/VS Code 定向 26 项与 JetBrains 纯核/编译回归通过。

**2026-07-28 Team/Batch 耐久治理收口**：新增独立
`collaboration-runs/v1` 持久层；它不会把共享 coordinator 下的协作单元伪装成可
attach/stop 的 background process。每个 run/unit 都持久化有界 owner、Agent
session ID、permission mode、资源预算、生命周期和脱敏
SideEffectLedger 计数；prompt、argv、tool arguments、模型输出、凭据和副作用
metadata 不进入记录。`team --state` 升级为 v3 并关联耐久 run，恢复时沿用未完成
任务的 session identity；`batch --json` 返回同一治理摘要，且 Agent prompt 改走
stdin，不再出现在进程 argv。`cc daemon view --json` 以独立
`managedTasks` 只读投影输出这些记录，VS Code/JetBrains 按 branch/path 关联并明确
保留 managed task ID，而不是生成后台控制 ID。CLI、真实 git worktree 和恢复相关
11 个测试文件 87 项通过；JetBrains `WorktreeTasksTest`/`UsageReportTest` 通过并
完成编译。该增量已包含于精确发布提交
`9c01ee579a4beb1b98e87226eed5f7b3a7a9565f` 及 CLI `0.162.184`、
Open VSX `0.37.36`、JetBrains `0.4.75` 的公开制品。

仍开放的是提供 hunk/file review 后再 merge、可恢复的 merge
checkpoint/rollback，以及真实并发、多根、Windows/macOS/Linux 和 IDE 重启矩阵。
当前已不是“没有 Worktree 产品面”，但还不是统一的多 Agent 治理中心。

#### 11. 测试、调试和质量门已有发布门，尚未完全进入主流程

Agent 修改后，IDE 应自动收集相关测试、lint、类型检查、构建和覆盖率结果；失败结果要能直接回到对应文件/行，并区分“代码失败”“环境失败”“测试数据失败”。发布门应同时运行 VS Code、JetBrains、CLI、真实 Bridge 和最小插件样例。

**2026-07-26 代码复核**：VS Code workflow 已安装打包后的 VSIX，并在
stable/minimum VS Code Extension Host 中验证 activation、command registration
和真实本地 Bridge；JetBrains workflow 已有编译/单测、插件构建验证及 xvfb +
Remote Robot GUI smoke，且 release gate 与 scheduled/manual regression 分开。
两端也已有只读 PR/CI 状态入口，Preview 启动会先做 HTTP health check。附录中
已有 release-gate 的具体接线依据。

2026-07-27 已按第 4 节所述接入统一 test result/coverage/debug state 工具和
Notebook 执行上下文；VS Code 稳定 Marketplace 宿主不开放 proposed
`testObserver` 时，只协商 Debug 能力而不冒充存在 Test/Coverage 数据。仍开放的是按改动影响面自动选择
test/lint/typecheck/build、失败类别与文件/行映射，以及“失败 → 修复 → 重跑 →
证据 Artifact”的 session 内循环。真实 Bridge 的更多
故障场景、最小第三方 Plugin/MCP/LSP 样例和多 IDE 版本矩阵也仍需进入必过门。

#### 12. IDE 原生体验仍可进一步补齐

优先级低于稳定性和安全，但可持续优化：

- inline completion / ghost text 的一致性和成本控制；
- 快捷键、命令面板、状态栏、通知和键盘无障碍；
- 大仓库上下文选择、忽略规则和 token budget 可视化；
- Markdown、HTML、图片、日志、JSON 等 Artifact 的统一预览；
- 多窗口、多根工作区、远程开发和容器开发的状态恢复。

**2026-07-26 代码复核**：VS Code 和 JetBrains 均已有手动触发的 inline
ghost-text provider，复用 `cc complete --json`，限制上下文/输出长度并在取消
或超时时终止子进程，避免逐键触发产生不可控成本；两端也已有状态栏、命令入口、
`@file`/symbol mention 和上下文用量提示。Artifact 面板可搜索/按 kind 过滤，
并按受控策略预览 Markdown、文本/日志/JSON 和图片；HTML 不在受信 Webview
中执行，而是外部打开，未知二进制降级为 reveal/copy/download。

本轮复核的 usage/worktree/completion/artifact 等 11 个 JS 测试文件共 172 项
通过；JetBrains 对应 5 个测试类通过，插件 Java/Kotlin 编译成功。仍开放的是
低延迟自动补全的双端一致策略和预算、键盘/读屏无障碍真实验收，以及多窗口、
多根、Remote/WSL/容器下的 session/Artifact/Preview 状态恢复。

## 四、建议的落地顺序

### 近期：P0（1 个版本周期）

1. Installation & Runtime Doctor 的单一兼容性结论、Node/Java 探测与离线恢复诊断已完成；继续真实新机、网络和版本矩阵。
2. Plan Review 快照、批注、审批、恢复闭环。
3. Diff 混合生命周期 changeset 的真实多宿主 UI 矩阵验收（代码语义已落地）。
4. VS Code / JetBrains 关键流程 Golden Fixtures 与真实 UI smoke test。

### 中期：P1（2～3 个版本周期）

1. `IdeContext v2`：LSP/PSI、项目模型、Diff 写入审阅、测试结果/coverage、debug state 与 Notebook 执行已接线；继续未来写 API 和自动验证循环。
2. 统一 session/checkpoint/approval 状态机和跨端恢复。
3. `PermissionDecision` 脱敏协议、双 IDE 拒绝解释和首批
   `SideEffectLedger` 关联已接线；继续覆盖全部工具资源与跨端账本 UI。
4. Plugin runtime 与双 IDE 的 registry 来源、升级、enable/disable/reload、
   签名/SBOM、能力 consent、事务回滚和企业策略明细已接线；继续跨源发现、
   dependency/license 图和真实供应链矩阵。
5. Browser/Preview 首批只读观察、审批动作、脱敏审计和截图 Artifact 已接线；
   继续统一 Preview 工作台、代码/测试证据关联、细粒度动作审批与真实宿主矩阵。

### 长期：P2

1. Usage/Insights、plugin/version、流式 retry/工具耗时归因与双 IDE 报表已接线；继续非流式/跨 turn retry、diff/test 因果归因和企业导出。
2. Worktree 隔离、冲突预判、双 IDE 管理面，以及 background/team/batch 的 owner/session/权限/预算/账本耐久治理已接线；继续 hunk/file review 与可恢复 merge。
3. 双 IDE 发布门和 Test/Coverage/Debugger API 已接线；继续自动测试修复循环、最小生态样例和多版本宿主矩阵。
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

本轮已经把安装诊断、Plan/Diff 审阅、`needs_input`、权限决策、浏览器安全边界、
Plugin 供应链、retry/耗时归因以及 background/team/batch 治理推进到有代码和
定向测试证据的边界。剩余项不再混写成未完成的小修复，而分为：

| 类别            | 范围                                                                                                     | 关闭条件/状态                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 需产品/协议决策 | 跨端分层 session 存储、全资源 SideEffectLedger、Marketplace 图、统一 Preview、merge review、自动质量循环 | 先确定数据所有权、迁移/兼容、审批 UX 和恢复语义，再按独立 epic 实施                                    |
| 需真实基础设施  | Remote/WSL/SSH/Container、私有 registry、组织签名、OTLP/SIEM、多 IDE/OS、长稳和故障注入矩阵              | 在对应宿主、凭据和 CI 资源中取得可重复证据                                                             |
| 已完成发布闭环  | 失败升级事务恢复、retry/耗时归因、team/batch 耐久治理                                                    | 精确提交 `9c01ee579a` 的 CLI 三系统与 IDE 发布门通过，三个目标公开渠道均已发布并完成 registry/API 回读 |

当这些独立 epic 和真实证据闭环完成后，ChainlessChain 才能在“本地化、跨端、企业
权限、可审计和可恢复”方面形成相对 Claude Code 的真正差异化，而不是只做功能数量
对齐。本文至此已经完成当前源码可独立关闭项的复核与实现，不把需要新产品范围或外部
环境的工作伪装成本地已完成。

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

- VS Code: the slash-command catalog first shipped in `0.37.26` and remains
  verified in the published `0.37.36`; it is discoverable from `/`, and command
  syntax passes Node parse and parity smoke checks.
- JetBrains: the same command catalog first shipped in `0.4.68` and remains
  verified in the published `0.4.75`. It is implemented in
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
- 当前公开基线 Open VSX `0.37.36` 与 JetBrains `0.4.75` 均已完成发布及
  公开 API 回读；CLI `0.162.184` 也已由 npm registry 回读。官方 VS Code
  Marketplace 仍需 `VSCE_PAT`。

### `/` 输入边界修复

Fixed the bare `/` edge case that previously fell through to `unknown command /`.
The fix has been included since VS Code `0.37.26` and JetBrains `0.4.68`, and is
present in the published `0.37.36` / `0.4.75` pair.
