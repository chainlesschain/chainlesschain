# ChainlessChain 对照 Claude Code IDE 的当前净差距与优化建议

> 评估日期：2026-07-17
> 仓库基线：`17cd625101c6d46fdbb9bc649e022b4200947f21`
> 本地产品基线：VS Code 扩展 `0.37.16`、JetBrains 插件 `0.4.60`
> 对标基线：Claude Code CLI、VS Code、JetBrains、Desktop、Web/Remote Control 的官方公开文档
> 文档定位：继承 2026-07-10 至 07-13 的多份对标报告，只保留当前仍开放的净差距，不再把已经实现的能力重复列为待办
> 状态校准：本报告是 2026-07-17 历史快照；当前版本与 2026-07-22 增量以 [`IDE_VS_PLUGIN_CLAUDE_GAPS_AND_OPTIMIZATIONS_2026-07-22.md`](./IDE_VS_PLUGIN_CLAUDE_GAPS_AND_OPTIMIZATIONS_2026-07-22.md) 为准。

### 2026-07-22 复核结果

以下项目在本报告编写后已具备仓库级实现，不应继续列为“代码缺失”：

本轮真实验收证据：VS Code `0.37.24` VSIX 在 VS Code Stable 干净 profile 中激活成功，16 个关键命令和 Bridge 端口校验通过；JetBrains `uiSmokeTest` 的 `IdeUiSmokeTest.chainlessChainToolWindowOpens` 通过；JetBrains Gradle `test` 602 项通过，`PureLogicSmokeMain` 1219 项通过。

- Desktop Coding Agent V3 已由 `desktop-app-vue/src/main/index.js` 的 `initializeCodingAgentV3()` 接入真实 Electron 主进程；剩余是打包应用和窗口重建 E2E。
- `cc agent --bg --worktree` 已解除互斥，后台 supervisor 接收独立 worktree；`agent-background-worktree.test.js` 覆盖创建、转交和子参数剥离。
- headless/stream resume 已接入 side-effect ledger reconcile；跨 CLI、Bridge、Extension Host 的物理 kill/resume 仍需真实环境。
- `protocol-replay.js`、治理覆盖率脚本、`cc doctor --export-bundle` 和 OTLP HTTP/HTTPS exporter 已存在；剩余是发布门接线、Collector/SIEM 和长期运行证据。
- Bridge token ACL 的默认路径已改为 fail-closed；JetBrains 侧 ACL/权限验证失败会阻断 lockfile 发布，只有组织级 managed downgrade 才允许降级。JetBrains `LockfileAclTest` 已通过；VS Code `0.37.24` Extension Host 和 JetBrains Remote Robot 核心 smoke 已通过，剩余是多版本/多宿主、真实 Windows ACL 矩阵与正式分发渠道验收。

### 2026-07-22 状态覆盖说明

本文件正文保留 2026-07-17 的历史审计快照，正文中关于“V3 未接线”、后台 Agent 与 worktree 互斥、VS Code 无 Extension Host、JetBrains GUI 未通过、ACL fail-open 以及仅输出本地 OTLP JSON 的表述，均不再代表当前代码状态。它们已分别由当前实现、针对性测试、VS Code Extension Host smoke、JetBrains GUI smoke、fail-closed ACL 政策和 OTLP HTTP/HTTPS exporter 覆盖；2026-07-22 又补上了 `agent-core.executeTool` / `agentLoop` 的可选会话级 Tool Admission 与 attribution seam。当前仍未完成的项目只以 2026-07-22 增量报告中的 C/T/H/E/D 状态为准。

本报告正文中第 6 条关于“Bridge ACL fail-open/仅本地 OTLP JSON”的段落，以及第 3 节中 Remote Robot 未成功的历史运行记录，均属于 2026-07-17 截面；当前请以 2026-07-22 的 VS Code/JetBrains 双端 fail-closed ACL、HTTP/HTTPS OTLP、JetBrains GUI smoke 和 Marketplace API 复核结果为准。

## 1. 结论先行

ChainlessChain 已经具备较完整的 AI 编码基础设施：IDE Chat、Plan Review、原生 Diff、会话恢复、Managed CLI、Remote Control、Worktree、Checkpoint、后台 Agent、语义工具、MCP、Skills、Hooks、插件治理、权限策略、沙箱、用量归因和 Trace 等都已有实现。当前最值得投入的方向不是继续堆普通 Slash Command 或再造一套聊天面板，而是把“代码存在”推进到“生产可达、真实验收、安全可恢复、可发布运营”。

本轮审计后，最重要的六件事是：

1. **先验证 Desktop Coding Agent V3 的生产启动接线。** preload、renderer、IPC 文件和 Session Service 都存在，但静态检索没有发现主进程生产路径实例化 `CodingAgentSessionService` 或调用 `registerCodingAgentIPCV3()`。若没有仓库外或动态注册，这会使丰富的 Coding Agent UI 在打包应用中不可达。
2. **把真实 IDE GUI 测试修绿并升级为发布门。** JetBrains Remote Robot 已连续运行但连续失败；VS Code 仍缺真实 Extension Host、VSIX 安装和核心旅程测试。
3. **把 CLI 已有的联合 Rewind/Branch 能力接入 IDE 和 Desktop。** 当前 IDE 面板主要只能恢复文件，而 CLI 已支持只恢复对话、只恢复文件、恢复两者和从某一轮分支。
4. **解除后台 Agent 与 Worktree 的互斥。** 当前 `cc agent --bg --worktree` 仍被显式拒绝，无法做到“后台执行 + 默认隔离”，这是安全并行工作流的关键缺口。
5. **把 Desktop 从 Agent 模式聊天页升级为编码工作台。** 重点是统一会话时间线、Diff、任务、子代理、PTY、App Preview、Git/PR/CI，而不是增加更多孤立弹窗。
6. **补齐安全和治理最后一公里。** IDE Bridge 的 bearer-token lockfile ACL 仍明确采用 fail-open；OTel 目前主要是写本地 OTLP JSON 文件，尚未形成标准 Collector/SIEM 实时出口。

### 当前优先级

| 顺序 | 净差距                               | 当前事实                                                      | 优先级 | 直接收益                                 |
| ---- | ------------------------------------ | ------------------------------------------------------------- | ------ | ---------------------------------------- |
| 1    | Desktop Coding Agent V3 生产接线实证 | 静态检索只发现定义和测试注册，未发现生产注册                  | P0     | 避免“功能代码很多、打包应用无 handler”   |
| 2    | JetBrains/VS Code 真实宿主测试       | JetBrains nightly 连续失败；VS Code 无真实 Extension Host E2E | P0     | 阻止死面板、卡死、安装后不可用进入发布   |
| 3    | IDE/Desktop 联合 Rewind 与 Branch    | CLI 完整，IDE 主要仅文件恢复                                  | P0     | 安全试错、回退和方案分叉                 |
| 4    | 后台 Agent + Worktree                | 两个参数仍显式互斥                                            | P0     | 并行写任务默认隔离，减少污染与冲突       |
| 5    | 远程与长稳验收                       | 适配代码丰富，真实环境矩阵和 soak 不足                        | P0     | 提升 WSL/SSH/容器及长会话可靠性          |
| 6    | Bridge 凭据 fail-closed              | Windows ACL 收紧失败后仍启动                                  | P0     | 降低本机其他用户读取 bridge token 的风险 |
| 7    | Desktop 原生编码工作台               | 有 Agent、Worktree、任务等局部 UI，仍较分散                   | P1     | 降低跨页面切换和上下文断裂               |
| 8    | App Preview 自动验证闭环             | Preview、Browser、WebIDE 原语存在，Agent 闭环不足             | P1     | 形成修改、运行、观察、修复、复验闭环     |
| 9    | PR/CI/Review 交付闭环                | CLI/Skill 有原语，Coding Agent 缺统一状态 UI                  | P1     | 从本地改动推进到可合并结果               |
| 10   | 标准 OTel 与企业分析                 | 有 trace/span 和 OTLP JSON，本地文件出口为主                  | P1     | 实时成本、质量、失败与审计治理           |
| 11   | Cloud/SSH 执行位置与跨端接力         | Remote Control 较完整，但它仍是本机执行                       | P1     | 支持离线、长任务和多端接续               |
| 12   | Agent Teams / Dynamic Workflow       | Runtime 原语丰富，产品化与冲突治理不足                        | P2     | 支持复杂并行任务，但需先完成安全地基     |

## 2. 本报告的状态口径

过去几份报告容易把“代码写完”“单测通过”“宿主接线”“真实 GUI 验收”和“已发布可安装”混为一个“完成”。本报告将其拆成五个独立状态：

| 状态            | 含义                                                   |
| --------------- | ------------------------------------------------------ |
| C：Code         | 实现代码存在                                           |
| T：Test         | 单元、纯核或协议测试存在并通过                         |
| H：Host         | 已接入真实 Electron、VS Code 或 JetBrains 宿主启动路径 |
| E：E2E          | 在真实宿主/远程环境完成自动化旅程                      |
| D：Distribution | 从正式分发渠道安装、升级、回滚后仍可用                 |

“C/T/H 都完成”仍不等于 E；“已经发布”也不能反向证明 E。对 Registry、Marketplace、nightly 和 npm 等外部状态，若本轮没有直接验证，统一标为“待实证”。

## 3. 已具备能力：不建议重复立项

以下能力已有代码和较充分的局部证据，后续重点应是补验收、统一入口和体验收口：

| 能力                                     | 当前证据                                                                                                                                                                                                                                              | 判断                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| VS Code / JetBrains Chat 与流式事件      | [`packages/vscode-extension/src/chat`](../packages/vscode-extension/src/chat)、[`packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide`](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide)                                  | 已有主体                       |
| Plan Review、Diff、hunk、行级意见        | [`multi-diff.js`](../packages/vscode-extension/src/multi-diff.js)、[`diff-hunks.js`](../packages/vscode-extension/src/diff-hunks.js)、JetBrains `PlanReview`/`DiffHunks`                                                                              | 已有主体，真实 GUI 覆盖不足    |
| 会话索引、恢复、后台会话工作台           | [`sessions-workbench.js`](../packages/vscode-extension/src/sessions-workbench.js)、[`background-agents.js`](../packages/vscode-extension/src/background-agents.js)                                                                                    | 已有主体                       |
| Managed CLI 与回滚                       | [`managed-cli.js`](../packages/vscode-extension/src/managed-cli.js)、[`ManagedCliRuntime.java`](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/ManagedCliRuntime.java)                                                             | 已有主体                       |
| IDE 精确上下文和语义工具                 | [`ide-tools.js`](../packages/vscode-extension/src/ide-tools.js)、[`semantic-tools.js`](../packages/vscode-extension/src/semantic-tools.js)                                                                                                            | 已有主体                       |
| Remote Control、QR、Relay                | [`remote-control-host.js`](../packages/vscode-extension/src/remote-control-host.js)、[`remote-control.js`](../packages/cli/src/commands/remote-control.js)                                                                                            | 已有主体                       |
| Worktree、Checkpoint、Side-effect Ledger | [`agent-worktree.js`](../packages/cli/src/lib/agent-worktree.js)、[`checkpoint-store.js`](../packages/cli/src/lib/checkpoint-store.js)、[`side-effect-ledger.js`](../packages/cli/src/lib/side-effect-ledger.js)                                      | Runtime 较完整                 |
| Skills、Hooks、MCP、Plugins              | [`skill-loader.js`](../packages/cli/src/lib/skill-loader.js)、[`settings-hooks.cjs`](../packages/cli/src/lib/settings-hooks.cjs)、[`mcp-client.js`](../packages/cli/src/harness/mcp-client.js)、[`plugin.js`](../packages/cli/src/commands/plugin.js) | Runtime 较完整                 |
| 权限、Safe Mode、沙箱、凭据保护          | [`safe-mode.js`](../packages/cli/src/lib/safe-mode.js)、[`agent-sandbox.js`](../packages/cli/src/lib/agent-sandbox.js)、[`credential-guard.js`](../packages/cli/src/lib/credential-guard.js)                                                          | 已有主体，需平台实证与 UI 解释 |
| 用量归因、Trace、诊断包、协议回放        | [`usage-report.js`](../packages/vscode-extension/src/usage-report.js)、[`span-recorder.js`](../packages/cli/src/lib/telemetry/span-recorder.js)、[`diagnostic-bundle.js`](../packages/cli/src/lib/diagnostic-bundle.js)                               | 已有主体                       |
| Desktop Worktree/任务/子代理局部 UI      | [`useAiChatWorktree.js`](../desktop-app-vue/src/renderer/pages/useAiChatWorktree.js)、[`HarnessTaskDrawer.vue`](../desktop-app-vue/src/renderer/components/chat/HarnessTaskDrawer.vue)                                                                | 部分产品化，不是“完全没有”     |

因此，不建议再把“新增 Chat”“新增 Slash Commands”“新增通用 Agent SDK”“新增基本 Worktree”“新增普通 MCP 管理器”列为独立大项目。

## 4. Claude Code 当前官方基线

截至 2026-07-17，Claude Code 官方公开能力可归纳为以下工作流基线：

- **VS Code**：自动带入选区和打开文件、精确 `@file#Lx-Ly`、附件、终端引用、并排 Diff、直接修改提议内容、Plan Markdown 行内评论、会话搜索/重命名/多标签、云会话下载、插件 GUI、Chrome、Remote Control、Checkpoint 回退。
- **JetBrains**：IDE Diff、选区和标签页上下文、文件引用、诊断、外部终端 `/ide` 连接、Remote Development/WSL；能力面通常比 VS Code 略窄。
- **Desktop**：并行会话、多 pane、内置文件/终端/Diff/Plan/Tasks/Subagent、App Preview、Local/Cloud/SSH/WSL 环境、每会话 Worktree、PR/CI 监控与自动修复。
- **CLI Runtime**：会话恢复/分支、后台会话、Subagent、Worktree、Checkpoint、权限模式、沙箱、Safe Mode、Hooks、Skills、MCP、Plugins、Remote/Web、结构化输出和预算。
- **治理**：Managed Settings、操作级 allow/ask/deny、Workspace Trust、OTel metrics/events/traces、团队分析与审计。

官方能力仍在快速变化。Agent Teams、部分 Agent View/Workflow、Cloud Code Review、Computer Use、Linux Desktop 等仍带有 experimental、research preview 或 beta 属性，不应被当成稳定 SLA。

## 5. 当前净差距矩阵

| 维度                     | Claude Code 公开基线                        | ChainlessChain 当前事实                                             | C/T/H/E/D      | 优先级 |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------- | -------------- | ------ |
| Desktop 生产启动         | Desktop 会话可直接创建并执行                | Coding Agent V3 定义、preload、store、UI 齐全；生产注册静态证据缺失 | ✅/✅/⚠️/❌/❓ | P0     |
| VS Code 真实宿主质量门   | 官方扩展在真实 VS Code 中运行               | 以 Node/Facade/包校验为主，未见 Extension Host GUI E2E              | ✅/✅/✅/❌/⚠️ | P0     |
| JetBrains 真实宿主质量门 | 官方插件面向多 JetBrains IDE                | Remote Robot 已运行但持续失败，当前仅一个浅烟测                     | ✅/✅/✅/❌/⚠️ | P0     |
| Rewind / Branch          | IDE 可从消息回退代码、分支对话              | CLI 已有联合语义；两端 IDE 面板主要恢复 work tree                   | ✅/✅/⚠️/❌/⚠️ | P0     |
| 后台隔离执行             | Subagent 可后台并使用独立 Worktree          | `--bg` 与 `--worktree` 仍互斥                                       | ⚠️/✅/⚠️/❌/⚠️ | P0     |
| 生命周期可靠性           | 后台任务、恢复、Checkpoint、通知            | 事件、账本、重连较强；跨宿主 kill/soak 证据不足                     | ✅/✅/✅/⚠️/⚠️ | P0     |
| Bridge 本地凭据          | 本地连接需最小权限和工作区信任              | bearer token 已有，但 ACL 收紧失败仍 fail-open                      | ✅/✅/✅/⚠️/⚠️ | P0     |
| Desktop 工作台           | Chat/Diff/Terminal/Files/Plan/Tasks 多 pane | 多数原语分散在 AIChat、Terminal、WebIDE、Git 页面                   | ✅/✅/⚠️/❌/⚠️ | P1     |
| 自动上下文               | 选区、文件、标签、诊断、终端可见可控        | Desktop Agent 主要是默认关闭的当前文件全文注入，12k 上限            | ✅/✅/✅/⚠️/⚠️ | P1     |
| App Preview              | 启动、截图、DOM、交互、Console/Network 回灌 | WebIDE/Browser/Preview 原语存在，Agent 自动复验闭环不足             | ✅/✅/⚠️/❌/⚠️ | P1     |
| Git/PR/CI                | PR、Checks、Review、Auto-fix、受控合并      | CLI/Skill 有局部原语，Coding Agent 缺统一状态与证据 UI              | ✅/✅/⚠️/❌/⚠️ | P1     |
| 扩展治理                 | Skills/Hooks/MCP/Plugins 会话级可见和可控   | 管理面丰富，Agent 会话内选择、解释和归因仍分散                      | ✅/✅/⚠️/⚠️/⚠️ | P1     |
| 远程/云执行              | Local/SSH/Cloud/Web 与跨端接力              | Remote Control 成熟度较高，但主要仍是本机执行                       | ✅/✅/⚠️/⚠️/⚠️ | P1     |
| OTel/团队分析            | 标准 OTLP 出口、metrics/events/traces       | Span 与 trace 已有，主要输出本地 OTLP JSON 文件                     | ✅/✅/✅/⚠️/⚠️ | P1     |
| 多 Agent 团队            | 独立上下文、任务依赖、消息、预算            | Team/Batch/Harness 原语多，统一 GUI 和冲突治理不足                  | ✅/✅/⚠️/⚠️/⚠️ | P2     |

## 6. P0：先完成生产可达、安全回退和真实验收

### P0-0 验证并修复 Desktop Coding Agent V3 生产接线

这是本轮新增且最需要优先实证的风险。

静态证据：

- preload 在 [`desktop-app-vue/src/preload/index.js`](../desktop-app-vue/src/preload/index.js) 266-381 行暴露了 `coding-agent:*` 的完整调用面。
- renderer store 和 [`AIChatPage.vue`](../desktop-app-vue/src/renderer/pages/AIChatPage.vue) 已调用这些 API。
- [`coding-agent-ipc-v3.js`](../desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js) 定义了 `registerCodingAgentIPCV3()`。
- [`coding-agent-session-service.js`](../desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js) 定义了 `CodingAgentSessionService`。
- 但在 `desktop-app-vue/src/main/index.js`、`src/main/bootstrap` 和 `src/main/ipc` 中未检索到生产实例化或注册调用；当前明确命中主要来自单元测试。

这不是仅靠静态检索就能最终判定的线上故障，因此建议先用打包应用做最短实证：

1. 启动生产构建而非测试 harness。
2. 枚举 `ipcMain` 中全部 `coding-agent:*` handler。
3. 从 UI 创建 Session、发送消息、进入 Plan、取消、恢复、查看任务和 Worktree。
4. 关闭窗口和应用，确认 service、bridge、worker、WebSocket 全部释放。

若确认缺失，应在单一 bootstrap 位置完成：

```text
Application bootstrap
  ├─ create CodingAgentBridge
  ├─ create CodingAgentSessionService
  ├─ registerCodingAgentIPCV3
  ├─ bind mainWindow lifecycle
  └─ dispose service/bridge on shutdown
```

验收标准：

- 打包应用中所有 preload 暴露的 `coding-agent:*` channel 均有 handler 或被显式删除。
- 增加“preload invoke surface ↔ ipcMain registered surface”字节级或集合级 CI 守卫。
- 首条消息、Plan、审批、Resume、Background、Worktree、Subagent、Review、Patch、Task Graph 至少各有一条生产启动 E2E。
- `No handler registered`、重复注册和退出后残留进程均为 `0`。

### P0-1 修绿真实 IDE GUI 测试，并升级为发布证据

#### JetBrains

当前并非“Remote Robot 尚未运行”，而是**已经连续运行但未成功**。截至本轮核验：

- 2026-07-11 至 07-16 的六次 `IDE JetBrains UI Smoke` 均失败。
- 最新失败运行：[GitHub Actions #29531942064](https://github.com/chainlesschain/chainlesschain/actions/runs/29531942064)。
- IDE 和 Robot Server 已成功启动，失败发生在 `IdeUiSmokeTest` 客户端反序列化/反射访问，出现 `JsonIOException` / `InaccessibleObjectException`。
- 当前测试仅打开 Tool Window 并断言 `JBTabbedPane`；[`IdeUiSmokeTest.java`](../packages/jetbrains-plugin/src/uiTest/java/com/chainlesschain/ide/uitest/IdeUiSmokeTest.java) 30-32 行仍把首条消息、Diff、Plan、`@mention`、Terminal、补全、Remote QR 列为扩展队列。

建议顺序：

1. 先修 Remote Robot/JDK 模块开放或依赖版本兼容问题，让最浅测试连续 10 次为绿。
2. 增加首条消息与流式输出。
3. 增加 Plan approve/reject/comment。
4. 增加 Diff accept/reject/request changes/hunk。
5. 增加 `@selection`、诊断、Terminal、补全、Remote QR。
6. 稳定后从 nightly 提升为 release required check。

#### VS Code

当前工作流主要覆盖打包和 VSIX 元数据，没有发现 `@vscode/test-electron` 或等价的 Extension Host 自动化。建议新增：

- 从新用户目录安装 CI 刚生成的 VSIX。
- 打开可信和不可信工作区。
- 验证 Extension 激活、Managed CLI、首条消息、流式输出、Diff、Plan、审批、Resume、Background、Remote。
- 覆盖 Stable、Insiders，以及 Windows/Linux；macOS 可作为 nightly。
- 失败时上传 Extension Host log、截图、webview console、CLI/bridge 脱敏 trace。

### P0-2 建立远程开发与长稳矩阵

真实环境至少覆盖：

- Windows 原生 + PowerShell/cmd.exe；
- WSL2；
- VS Code Remote SSH；
- Dev Containers；
- GitHub Codespaces 或等价云容器；
- JetBrains Gateway / Remote Development；
- macOS 与 Linux 本地；
- 多根工作区、空格/中文路径、符号链接、UNC/网络盘的允许与拒绝路径。

每个环境都应验证：

- Extension/Plugin 应安装在 UI 端还是 workspace host；
- 选区、诊断、Terminal、`@mention`、Diff、Plan 和审批；
- bridge 断线重连、IDE reload、CLI kill、Extension Host kill；
- Session Resume、事件序列 gap/replay、重复副作用为 `0`；
- Worktree 创建、冲突预览、合并和安全清理；
- Relay/Remote Control 断网、重连、设备撤销和冷启动。

长稳目标建议：

- 1,000 次 Session create/start/attach/detach/resume/stop/archive 循环；
- 8 小时混合前台/后台/慢消费者 soak；
- 随机 kill CLI、Bridge、Extension Host、IDE、Dev Server；
- 监控孤儿进程、句柄、端口、锁文件、临时文件、Worktree 和内存增长。

### P0-3 将联合 Checkpoint / Rewind / Branch 接入 IDE 和 Desktop

当前两端 IDE 的 `/rewind` 主要调用：

- `cc checkpoint list`
- `cc checkpoint show --diff`
- `cc checkpoint restore`

证据见：

- [`rewind-commands.js`](../packages/vscode-extension/src/chat/rewind-commands.js)
- [`chat-view.js`](../packages/vscode-extension/src/chat/chat-view.js) 1407-1512 行
- [`RewindCommands.java`](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/RewindCommands.java)

CLI 已在 [`repl-rewind.js`](../packages/cli/src/lib/repl-rewind.js) 和 [`agent-repl.js`](../packages/cli/src/repl/agent-repl.js) 支持：

- 只恢复对话；
- 只恢复文件；
- 恢复两者；
- 从某一轮创建独立 Branch；
- 写任务要求独立 Worktree；
- 对外部副作用和不完整覆盖给出诚实警告。

建议在每条用户消息的时间线上提供统一动作：

1. `仅恢复代码`
2. `仅恢复对话`
3. `恢复代码和对话`
4. `从这里分支`

UI 必须显示：

- Checkpoint 覆盖到哪些文件；
- Shell、人工编辑、外部系统副作用是否未覆盖；
- 恢复前安全快照；
- Parent Session、Branch Session、Worktree 和 PR 的关系；
- Session 级临时授权默认不继承。

Desktop、VS Code、JetBrains 应复用同一结构化 CLI/API，而不是三端各自重写恢复规则。

### P0-4 支持后台 Agent 的默认 Worktree 隔离

[`packages/cli/src/commands/agent.js`](../packages/cli/src/commands/agent.js) 1035-1043 行仍明确拒绝：

```text
--bg and --worktree cannot be combined yet
```

这意味着当前最需要隔离的长时间后台写任务反而不能直接使用会话级 Worktree。建议：

- 写意图后台任务默认建议或强制独立 Worktree；
- Background Session 状态持久化 `repoRoot/worktreePath/baseSha/branch`；
- Attach/Resume 后仍在原 Worktree；
- 主 checkout 漂移时展示 merge-base 变化；
- 清理前检查未提交改动、未合并提交、未完成副作用和活跃进程；
- 同一文件的多个 Agent 建立 ownership/advisory lock 或冲突预警；
- UI 中显示 ahead/behind、dirty、冲突预测、测试结果和成本。

验收：

- `cc agent --bg --worktree` 可用；
- kill/restart 后 Worktree 不丢失、不误删；
- 两个并行写 Agent 不直接写同一主 checkout；
- 冲突时 fail-closed，不留下半合并工作树。

### P0-5 将 IDE Bridge 凭据保护改为 fail-closed

VS Code [`lockfile.js`](../packages/vscode-extension/src/lockfile.js) 和 JetBrains [`LockfileWriter.java`](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/LockfileWriter.java) 都明确采用以下策略：

- 写入 localhost bridge port 和 bearer token；
- 尝试把目录/文件权限收紧为 owner-only；
- Windows ACL、`chmod` 或 `icacls` 失败时只警告，Bridge 仍继续启动。

这对易用性友好，但对于共享 Windows 主机、远程开发主机和企业终端，不应默认继续发布可读 token。

建议分层：

1. 首选用户隔离的 Named Pipe/Unix Domain Socket，避免 bearer token 落普通文件。
2. 必须落盘时使用原子创建、owner-only ACL，并验证最终有效 ACL。
3. ACL 无法收紧时默认不启动 bridge，允许管理员通过显式策略选择受控降级。
4. token 轮换绑定 IDE 实例、workspace、短 TTL 和进程身份。
5. Doctor 显示“配置期望”和“实际有效隔离”，而不只显示配置值。
6. Workspace Trust 未通过时禁用会写文件、执行 Terminal、Notebook 和自动配置的 IDE 工具。

### P0-6 完成正式分发与供应链验收

[`packages/vscode-extension/README.md`](../packages/vscode-extension/README.md) 12-22 行仍明确说明：

- 仅发布到 Open VSX；
- 未上架 Microsoft VS Code Marketplace。

建议补齐：

- Microsoft Marketplace publisher 和发布凭据；
- 从 Marketplace/Open VSX/JetBrains Marketplace 的真实搜索安装；
- 首次安装、升级、降级、离线 VSIX/ZIP、Managed CLI 首启和回滚；
- 包签名、SBOM、provenance、依赖和恶意文件扫描；
- CI 产物与 Registry 下载包的摘要一致性；
- 分发失败必须阻断“发布完成”状态，不能只以 Git tag 或本地包成功作为完成。

## 7. P1：形成完整编码工作台和交付闭环

### P1-1 Desktop 原生多 pane 编码工作台

当前 Desktop 已有 AIChat、独立 Terminal、WebIDE、Git、Worktree、任务和子代理能力，但用户需要在多个页面和弹窗间切换。建议建立一个 Session-centric 工作台：

```text
Coding Session
  ├─ Chat / Side Chat
  ├─ Files / Search / Diagnostics
  ├─ Plan / Tasks / Subagents
  ├─ Review Queue / Diff / Comments
  ├─ Terminal / Background Processes
  ├─ App Preview / Browser Evidence
  ├─ Git / PR / CI
  └─ Timeline / Checkpoints / Cost / Audit
```

核心要求：

- 每个 pane 都绑定同一 `session_id/turn_id/trace_id/worktree`；
- 用户可并排看 Chat 与 Diff、Plan 与评论、Terminal 与 Preview；
- Side Chat 默认只读，不污染主任务上下文，用户确认后才提升为主会话事实；
- Session 隐藏或切换时仍能看到 waiting permission、needs input、completed 通知；
- 附件、图片、PDF 页、Artifact、终端选区和浏览器证据使用统一引用模型。

### P1-2 丰富且可解释的自动上下文

Desktop Agent 当前已修复“活动文件完全不进入 Agent 分支”的旧问题，但仍较弱：

- [`AIChatPage.vue`](../desktop-app-vue/src/renderer/pages/AIChatPage.vue) 中活动文件上下文默认关闭；
- 主要读取 `projectStore.currentFile`；
- [`chatPanelHelpers.ts`](../desktop-app-vue/src/renderer/shell/helpers/chatPanelHelpers.ts) 主要内联整文件并限制到约 12k 字符；
- 缺少与 IDE 一致的 Selection、Open Tabs、Diagnostics、Git Diff、Terminal 引用。

建议将本轮实际上下文显示为可移除 chips：

- Selection：精确路径和行范围；
- Active File：摘要或相关片段，不默认塞完整大文件；
- Open Tabs：只发送路径，模型需要时再读；
- Diagnostics：当前文件优先，带 severity；
- Git：branch、status、diff 摘要；
- Terminal：用户显式选择的输出范围；
- Browser/Preview：URL、截图、DOM 摘要、Console/Network 错误；
- Memory/Rules：显示实际加载来源和 token 占比。

同时提供上下文预算、去重、延迟加载和敏感文件拒绝原因，避免“上下文越多越好”。

### P1-3 App Preview 自动验证闭环

当前已有 WebIDE iframe/server preview、Browser Action、Chrome Connector 和 Preview 状态原语，但尚未形成稳定的 Coding Agent 完成条件。建议统一成：

```text
detect command
  → launch dev server
  → wait for readiness
  → open isolated preview
  → capture DOM/screenshot/console/network
  → run declared interactions/assertions
  → feed failures to agent
  → patch
  → re-run
  → publish evidence artifact
```

关键约束：

- 登录态浏览器和隔离浏览器明确区分；
- 外部网站默认只读或受限域名；
- 截图、DOM、Console、Network 均有大小上限和脱敏；
- “页面打开了”不等于验证成功，必须有用户目标对应的断言；
- 完成结果附可复现命令、URL、截图和失败日志。

### P1-4 Git / PR / CI / Review 统一交付流

CLI 已有 `session pr-status`、Review、GitHub 相关 Skill 和受控 auto-merge 的部分基础，但 IDE/Desktop 的 Coding Session 尚未形成统一闭环。

建议增加：

- 当前 branch、staged/unstaged、ahead/behind、Worktree 状态；
- 从 Session 创建 commit 和 PR，并保存 Session/PR 双向关联；
- 展示 Checks、失败步骤、日志摘要、Review comments；
- 只把失败相关日志回灌到 Agent，而不是整个 CI 日志；
- 修复后重跑失败检查；
- auto-merge 需要测试、Review、权限、分支保护和用户策略全部通过；
- 合并后安全清理 Worktree，并保留可审计证据。

### P1-5 统一异步 Agent View

目前 Sessions Workbench、Background Agents、Worktree Tasks、Team Monitor、Desktop Harness Task Drawer 等入口较分散。建议统一状态模型：

```text
queued
  → planning
  → running
  → waiting_permission | needs_input | blocked
  → verifying
  → completed | failed | cancelled | lost
```

每个 Agent 行应显示：

- 当前目标和最近一步；
- 父/子 Agent、任务依赖和 ownership；
- Session、Worktree、branch、commit/PR；
- 权限模式、待审批数量；
- turn/token/cost/time 预算；
- 最近心跳、重试、失败分类；
- Attach、Reply、Approve、Cancel、Open Diff、Open Worktree。

任务 claim 必须原子化；Agent lost 后要区分可恢复、需人工核实副作用和只能重新执行。

### P1-6 把 Skills / Hooks / MCP / Plugins 带入会话治理

当前独立管理器已经较丰富，下一步应从“安装了什么”升级为“本 Session 实际用了什么、为什么能用”：

- 新建 Session 时选择 Skill、Agent、Plugin、MCP Profile；
- 显示 user/project/local/managed scope 和覆盖来源；
- 会话级 allow/deny 只能收紧组织上限；
- MCP tool lazy discovery 和 schema token 占用可见；
- Hook 生命周期可视化，支持输入/输出脱敏预览和失败诊断；
- 每次调用归因到 skill/subagent/plugin/MCP server；
- 插件升级显示能力 diff，敏感能力重新征得同意；
- Safe Mode 一键禁用项目/用户定制，用于故障定位。

### P1-7 统一 Local / WSL / SSH / Container / Cloud 执行模型

Remote Control 的价值是“代码和工具仍在本机，其他设备负责控制”，它不等于 Cloud Session。建议把执行位置做成一等字段：

```text
execution_location:
  local | wsl | ssh | dev_container | cloud
```

UI 必须持续显示：

- 实际执行主机和路径；
- 文件、终端、MCP、凭据和网络边界；
- 配置来自本机、仓库还是远端；
- 数据是否上传；
- Session 能否 handoff、继续或只读查看；
- 云端结果如何回到本地 Git/PR。

Cloud 模式应在本地隔离和恢复闭环稳定后再扩大，且需要独立 secrets store、租户隔离、成本上限和销毁证明。

### P1-8 标准 OTel、SIEM 和团队分析

当前 CLI 的 `--otlp <file>` 会把 recorder 转成 OTLP JSON 并写入文件；[`span-recorder.js`](../packages/cli/src/lib/telemetry/span-recorder.js) 也明确采用轻量结构，不依赖 OTel SDK。它适合离线分析，但还不是完整的实时可观测出口。

建议增加：

- OTLP HTTP/gRPC exporter；
- batch、retry、backpressure、磁盘缓冲和断点续传；
- metrics：session、turn、token、cost、latency、cache hit、tool errors、permission decisions、accepted/rejected edits；
- traces：IDE → bridge → CLI → model/tool/hook/subagent/workflow；
- logs/events：状态转换、审批、重试、compact、worktree、MCP/plugin/hook；
- `session.id/prompt.id/tool_use_id/agent_id/parent_agent_id/workflow.run_id` 关联；
- 默认不采集 prompt、response、tool 参数和文件内容；
- 内容采集必须显式启用、脱敏并受 managed policy 限制；
- 对接 Collector、Prometheus、Grafana 和 SIEM，而非在 IDE 内重造全部后端。

### P1-9 性能、可访问性与真实用户体验

建议建立以下产品 SLO：

- 首次打开面板、首 token、Resume、Diff 打开和审批响应的 P50/P95/P99；
- 流式 Markdown 期间 UI 主线程卡顿为 `0`；
- 隐藏面板不高频轮询，后台日志按 tail 读取；
- 取消补全/任务后真实子进程和网络请求停止；
- 键盘全流程、屏幕阅读器、焦点顺序、高对比度、缩放和中英文布局；
- 10k 文件、多根工作区、超大 Diff、长会话、慢本地模型下的降级策略。

## 8. P2：受控推进前瞻能力

### P2-1 Agent Teams 与动态工作流

ChainlessChain 的 Team、Batch、Task Graph、Harness 已提供不错的地基。产品化前必须先补：

- 文件 ownership 或 Worktree 隔离；
- 依赖任务原子 claim；
- 点对点消息和 lead/teammate 状态；
- 单 Agent 与全队预算；
- 失败重试、恢复和部分结果提交；
- 冲突合并、交叉验证和最终责任 Agent；
- 团队视图中的成本和上下文放大警告。

Agent Teams 在 Claude Code 中仍属于实验能力，不建议为了表面同名而绕过上述可靠性门槛。

### P2-2 Web/Cloud Session 与远程 Code Review

可在本地闭环稳定后逐步增加：

- 浏览器/手机启动云任务；
- 多任务并行和 PR 交付；
- 云端 Review 与 CI autofix；
- IDE 下载或接管云 Session；
- 仓库化的 Skills/Hooks/MCP 配置迁移；
- 云端 secrets、网络和数据驻留策略。

### P2-3 Browser / Computer Use / Scheduled Session

仓库已有 Browser、Computer Use、Agenda/Schedule 原语，但 Coding Agent 产品层应先限制为：

- 本地站点和明确允许的域名；
- 有目标、有预算、有超时、有截图证据；
- 计划任务默认只读或 Worktree 隔离；
- 高风险外部动作必须人工审批；
- 机器休眠、应用退出、凭据失效和网络中断有明确状态；
- 重复触发使用事件幂等键。

## 9. 不建议优先做

- 不建议为了对齐命名继续添加大量普通 Slash Command。
- 不建议重写已经存在的 Worktree、Checkpoint、MCP、Hooks、Plugin 或 Agent SDK。
- 不建议在真实 GUI 测试仍为红色时继续扩大 JetBrains 面板数量。
- 不建议把 Agent Teams、Computer Use、Cloud Review 等预览能力宣传为稳定能力。
- 不建议默认启用 bypass/全自动高权限模式。
- 不建议用“代码已合并”代替“打包应用可达”和“Registry 可安装”。
- 不建议在 Local/Remote/Cloud 执行位置不透明时自动迁移任务。
- 不建议把 Checkpoint 描述成 Git 的替代品；Shell、人工和并发编辑覆盖必须诚实展示。

## 10. 建议路线图

### 里程碑 A：生产真相与红灯收口（1-2 周）

- 实证并修复 Desktop Coding Agent V3 bootstrap。
- 增加 preload channel ↔ ipcMain handler CI 守卫。
- 修复 JetBrains Remote Robot 当前反射/序列化失败。
- 建立 VS Code Extension Host 最浅安装/激活测试。
- 把历史文档标为归档，建立单一当前状态表。

### 里程碑 B：安全恢复与隔离（2-4 周）

- IDE/Desktop 接入联合 Rewind/Branch API。
- 打通 `--bg --worktree`。
- Bridge token 改为 fail-closed 或受保护 IPC。
- 完成 kill/resume、副作用账本和 Worktree 清理 E2E。
- 启动 WSL/SSH/Dev Container/JetBrains Remote 矩阵。

### 里程碑 C：真实宿主与分发（3-6 周）

- JetBrains 核心旅程 GUI E2E 连续稳定。
- VS Code Stable/Insiders、Windows/Linux 核心旅程。
- 8 小时 soak 和 1,000 次生命周期循环。
- Microsoft Marketplace、Open VSX、JetBrains Marketplace 真实安装升级测试。
- SBOM、签名、provenance 和 Registry 摘要核验。

### 里程碑 D：Desktop 交付工作台（4-8 周）

- Session 时间线、多 pane、PTY 接入和自动上下文 chips。
- App Preview 证据闭环。
- PR/CI/Review/auto-fix 受控闭环。
- 统一 Background/Task/Subagent/Worktree Agent View。

### 里程碑 E：治理与受控多 Agent（6-12 周）

- 标准 OTLP exporter 与团队分析。
- Session 级 Skills/Hooks/MCP/Plugin 治理。
- Local/WSL/SSH/Container 执行位置统一。
- 在预算、隔离、冲突和恢复门槛通过后，再推进 Agent Teams 与 Cloud。

## 11. 验收指标

### 11.1 功能与真实宿主

- Desktop 打包应用 `coding-agent:*` preload channel handler 覆盖率 `100%`。
- JetBrains 与 VS Code 核心 GUI 旅程连续 10 次为绿。
- 从正式 Registry 新装、升级、降级后的核心旅程成功率 `100%`。
- IDE、CLI、Desktop 对同一 Session 的 Resume、Rewind、Branch 结果一致。

### 11.2 可靠性

- 8 小时 soak：孤儿进程、重复副作用、丢失审批、错误 Worktree 删除均为 `0`。
- 1,000 次生命周期循环：不可恢复失败率为 `0`。
- 网络断开、IDE reload、CLI/Bridge kill 后可解释恢复率 `100%`。
- `waiting_permission`、`needs_input`、`lost` 不得被错误显示为普通 running。

### 11.3 安全

- Bridge token 文件无法设置 owner-only 权限时默认不启动或进入显式受管降级。
- Workspace Trust 未确认时，高风险 IDE 工具不可执行。
- Session 临时授权不自动继承给 Branch/Subagent/Cloud。
- 诊断包、OTel 和日志默认不包含 prompt、文件内容、凭据和完整工具参数。
- 自动合并、发布、消息发送和外部写操作必须可绑定到唯一审批与幂等键。

### 11.4 用户体验与成本

- 每轮显示实际附带的上下文和 token 占比。
- Resume、首 token、Diff 打开的 P95 建立基线并持续回归。
- 被取消的补全和后台任务不继续消耗模型 token。
- Skill/Subagent/Plugin/MCP 用量可归因，异常 fan-out 有提示。
- UI 主线程长任务和隐藏面板高频轮询为 `0`。

### 11.5 可观测性

- IDE、Bridge、CLI、Tool、Hook、Subagent、Workflow 的 trace 可串联。
- OTLP exporter 在 Collector 暂时不可用时不阻塞 Agent，并能限额缓冲与重试。
- 权限决策、恢复警告、Worktree 清理和发布动作都有审计事件。

## 12. 文档与状态治理

当前同主题文档较多，且存在“顶部仍列为待办、下文又追加已完成”“已发布但未真实验收”“旧版本号未更新”等问题。建议：

1. 将以下文档标为历史基线，不再继续追加实现日志：
   - [`CLAUDE_CODE_IDE_GAP_ANALYSIS.md`](./CLAUDE_CODE_IDE_GAP_ANALYSIS.md)
   - [`CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md`](./CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md)
   - [`ide/CLAUDE_CODE_IDE_GAP_ANALYSIS.md`](./ide/CLAUDE_CODE_IDE_GAP_ANALYSIS.md)
   - [`internal/ide-plugin-claude-code-gap-analysis-2026-07-11.md`](./internal/ide-plugin-claude-code-gap-analysis-2026-07-11.md)
2. 用一份机器可生成的 Capability Manifest 维护版本、协议、宿主、测试和分发状态。
3. 每个能力分别记录 C/T/H/E/D，不再使用笼统的“已完成”。
4. Changelog 只记录已发布行为；待验证项进入 Issue/Project，而不是长期堆在 `GLUE_TODO.md`。
5. 文档站把已经发布的 Plan Review、热重连、Coding Agent 阶段状态同步为当前事实。
6. 外部状态必须附最后核验时间和链接。

## 13. 主要本地证据

### 版本与发布

- [`packages/vscode-extension/package.json`](../packages/vscode-extension/package.json)
- [`packages/vscode-extension/README.md`](../packages/vscode-extension/README.md)
- [`packages/vscode-extension/CHANGELOG.md`](../packages/vscode-extension/CHANGELOG.md)
- [`packages/jetbrains-plugin/build.gradle.kts`](../packages/jetbrains-plugin/build.gradle.kts)
- [`packages/jetbrains-plugin/CHANGELOG.md`](../packages/jetbrains-plugin/CHANGELOG.md)

### IDE 测试与待验收

- [`.github/workflows/ide-extensions.yml`](../.github/workflows/ide-extensions.yml)
- [`.github/workflows/ide-jetbrains-ui-smoke.yml`](../.github/workflows/ide-jetbrains-ui-smoke.yml)
- [`packages/jetbrains-plugin/src/uiTest/java/com/chainlesschain/ide/uitest/IdeUiSmokeTest.java`](../packages/jetbrains-plugin/src/uiTest/java/com/chainlesschain/ide/uitest/IdeUiSmokeTest.java)
- [`packages/jetbrains-plugin/GLUE_TODO.md`](../packages/jetbrains-plugin/GLUE_TODO.md)
- [最近一次 JetBrains GUI smoke 失败运行](https://github.com/chainlesschain/chainlesschain/actions/runs/29531942064)

### Desktop Coding Agent

- [`desktop-app-vue/src/preload/index.js`](../desktop-app-vue/src/preload/index.js)
- [`desktop-app-vue/src/renderer/stores/coding-agent.ts`](../desktop-app-vue/src/renderer/stores/coding-agent.ts)
- [`desktop-app-vue/src/renderer/pages/AIChatPage.vue`](../desktop-app-vue/src/renderer/pages/AIChatPage.vue)
- [`desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js`](../desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js)
- [`desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js`](../desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js)
- [`desktop-app-vue/src/main/index.js`](../desktop-app-vue/src/main/index.js)

### 恢复、并行与安全

- [`packages/vscode-extension/src/chat/rewind-commands.js`](../packages/vscode-extension/src/chat/rewind-commands.js)
- [`packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/RewindCommands.java`](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/RewindCommands.java)
- [`packages/cli/src/lib/repl-rewind.js`](../packages/cli/src/lib/repl-rewind.js)
- [`packages/cli/src/commands/agent.js`](../packages/cli/src/commands/agent.js)
- [`packages/vscode-extension/src/lockfile.js`](../packages/vscode-extension/src/lockfile.js)
- [`packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/LockfileWriter.java`](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/LockfileWriter.java)

### 可观测性

- [`packages/cli/src/lib/telemetry/span-recorder.js`](../packages/cli/src/lib/telemetry/span-recorder.js)
- [`packages/cli/src/runtime/headless-runner.js`](../packages/cli/src/runtime/headless-runner.js)
- [`packages/cli/src/commands/team.js`](../packages/cli/src/commands/team.js)

## 14. Claude Code 官方参考

- [VS Code 集成](https://code.claude.com/docs/en/vs-code)
- [JetBrains 集成](https://code.claude.com/docs/en/jetbrains)
- [Desktop 应用](https://code.claude.com/docs/en/desktop)
- [会话管理](https://code.claude.com/docs/en/sessions)
- [Checkpoint / Rewind](https://code.claude.com/docs/en/checkpointing)
- [Worktree](https://code.claude.com/docs/en/worktrees)
- [权限](https://code.claude.com/docs/en/permissions)
- [沙箱](https://code.claude.com/docs/en/sandboxing)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Skills](https://code.claude.com/docs/en/skills)
- [MCP](https://code.claude.com/docs/en/mcp)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Remote Control](https://code.claude.com/docs/en/remote-control)
- [OpenTelemetry 与使用监控](https://code.claude.com/docs/en/monitoring-usage)
- [2026 Week 28 更新](https://code.claude.com/docs/en/whats-new/2026-w28)

## 15. 最终建议

如果只能选择一个短周期方向，先做：

1. Desktop Coding Agent V3 生产 bootstrap 实证；
2. JetBrains GUI smoke 修绿；
3. VS Code Extension Host 最短真实旅程；
4. IDE 联合 Rewind/Branch；
5. `--bg --worktree`；
6. Bridge token fail-closed。

这六项完成后，ChainlessChain 才真正从“能力覆盖广”进入“生产闭环可信”。之后再投入 Desktop 多 pane、App Preview、PR/CI、标准 OTel 和 Agent Teams，收益会更稳定，也更容易形成可验证的产品优势。

- VS Code 当前版本的真实 Extension Host smoke 已通过；JetBrains Remote Robot 的 `IdeUiSmokeTest.chainlessChainToolWindowOpens` 也已通过。剩余是多版本、多宿主重复运行和发布渠道安装升级矩阵。
