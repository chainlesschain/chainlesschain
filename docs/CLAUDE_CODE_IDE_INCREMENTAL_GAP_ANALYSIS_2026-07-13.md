# ChainlessChain 对照 Claude Code IDE 的增量差距与优化建议

> 评估日期：2026-07-13  
> 评估对象：ChainlessChain Desktop / CLI Agent Runtime / VS Code 扩展 / JetBrains 插件  
> 对标对象：Claude Code CLI、Desktop、VS Code、JetBrains、Web/Mobile 及官方扩展机制  
> 文档定位：继承 `docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md` 的增量审计，不重复 2026-07-10、2026-07-11 已完成的实施清单  
> 状态口径：`已具备`、`部分具备`、`已实现待验收`、`未形成闭环`、`外部状态待实证`

## 1. 结论先行

ChainlessChain 当前已经不是“缺一个 Claude Code 风格 IDE 插件”的阶段。VS Code 与 JetBrains 的基础桥接、IDE 上下文、原生 Diff、Plan Review、Session Workbench、远程 handoff、受控审批、MCP、语义工具、Artifacts、Policy UI、managed CLI 等主要能力已经存在。

下一阶段最值得投入的不是继续增加普通 Slash Command 或聊天面板按钮，而是完成三类闭环：

1. **把已写出的能力变成可证明可靠的能力**：JetBrains 真实 GUI nightly、五类远程开发 E2E、恢复幂等、长稳测试、真实 Marketplace 安装验证。
2. **把“能执行任务”升级为“可安全探索、回退和交付”**：代码与对话联合 checkpoint/rewind、会话 branch、复杂 Diff、默认 Worktree 隔离、App Preview 自验证、PR/CI 自动修复闭环。
3. **把单会话 Agent 升级为可治理的异步工作台**：后台 Agent 状态、`needs_input` 接管、移动端远程审批、定时/事件触发、Agent View、多 Agent 成本与冲突治理。

建议最高优先级如下：

| 顺序 | 建议                                               | 当前判断                               | 优先级 | 直接收益                                 |
| ---- | -------------------------------------------------- | -------------------------------------- | ------ | ---------------------------------------- |
| 1    | 修复 Desktop Agent 活动文件上下文未进入 Agent 分支 | 代码链路疑似遗漏                       | P0     | 立即提高任务相关性，减少重复解释上下文   |
| 2    | 将恢复幂等守卫接入 IDE/headless resume             | 已有谓词，执行闭环未完成               | P0     | 避免恢复后重复写文件、发布或调用外部系统 |
| 3    | 代码与对话联合 rewind，并支持会话 branch           | Checkpoint 与 Session 有基础但未联合   | P0     | 用户可以低成本试错和切换方案             |
| 4    | 跑通 JetBrains 真实 GUI nightly                    | 骨架已实现，未真实验收                 | P0     | 消除“单测通过、真实 IDE 不可用”的风险    |
| 5    | 建立五类远程开发 E2E + 8 小时 soak                 | 适配代码存在，验收不足                 | P0     | 提升远程和长会话可靠性                   |
| 6    | Desktop 原生逐 hunk Diff、评论和可逆编辑           | 扩展较完整，Desktop 偏文本/抽屉        | P1     | 安全审阅多文件改动                       |
| 7    | 交互终端与自动 IDE 上下文                          | Shell 工具有，Agent 工作台集成不足     | P1     | 用户可接管长进程，减少上下文断层         |
| 8    | App Preview 自动验证工作台                         | Browser/WebIDE 有基础，Agent 闭环不足  | P1     | 形成修改、运行、观察、修复、复验闭环     |
| 9    | PR/CI 状态、失败自动修复与受控合并                 | 泛化 Git 可用，专用闭环缺少            | P1     | 从本地代码延伸到可合并结果               |
| 10   | 统一后台 Agent/Worktree 工作台                     | Runtime 和 Harness 已有，任务视图分散  | P1     | 并行任务可监控、接管并追踪成本           |
| 11   | Agent 内 Skills/MCP/Plugin 会话级治理              | 独立管理 UI 丰富，Agent 仅开放部分工具 | P1     | 扩展能力可发现、可解释、可审计           |
| 12   | Remote SSH/Cloud、定时任务与 Side Chat             | 未形成 Coding Agent 产品闭环           | P2     | 支持异步、远程和复杂探索工作流           |

## 2. 本轮基线与判断边界

### 2.1 仓库事实基线

当前版本应以扩展 Changelog 和真实 Registry 为准：

- VS Code：`packages/vscode-extension/CHANGELOG.md:5-25` 记录 `0.37.14`。
- JetBrains：`packages/jetbrains-plugin/CHANGELOG.md:3-20` 记录 `0.4.58`。
- 主基线：`docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:19-66`。
- 产品工作流收口：`docs/ide/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:23-31`。
- 插件运营收口：`docs/internal/ide-plugin-claude-code-gap-analysis-2026-07-11.md:12-29`。

部分历史章节仍保留旧版本号或旧决策，不能直接作为当前事实源，详见第 11 节。

### 2.2 Claude Code 官方基线

本轮核对以 Anthropic 官方文档为准，官方 Changelog 在评估时最新条目为 `2.1.205`（2026-07-08）：

- [平台与集成矩阵](https://code.claude.com/docs/en/platforms)
- [VS Code 集成](https://code.claude.com/docs/en/ide-integrations)
- [JetBrains 集成](https://code.claude.com/docs/en/jetbrains)
- [Claude Code Desktop](https://code.claude.com/docs/en/desktop)
- [会话管理](https://code.claude.com/docs/en/sessions)
- [Checkpoint 与 Rewind](https://code.claude.com/docs/en/checkpointing)
- [Worktree 并行隔离](https://code.claude.com/docs/en/worktrees)
- [权限与沙箱](https://code.claude.com/docs/en/permissions)
- [并行 Agent](https://code.claude.com/docs/en/agents)
- [扩展能力总览](https://code.claude.com/docs/en/features-overview)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [MCP](https://code.claude.com/docs/en/mcp)
- [Remote Control](https://code.claude.com/docs/en/remote-control)
- [Desktop 定时任务](https://code.claude.com/docs/en/desktop-scheduled-tasks)
- [官方 Changelog](https://code.claude.com/docs/en/changelog)

### 2.3 判断边界

Claude Code 各端并不完全等价：VS Code 的图形化会话、Plan 评论和 MCP 管理比 JetBrains 更完整；Desktop 强于可视化工作台，但缺少一部分 CLI 自动化能力。本文按“工作流结果”比较，不按各平台是否出现同名按钮比较。

同时应注意：

- Claude Code Checkpoint 主要追踪 Agent 编辑工具产生的修改，不覆盖全部 Shell、人工或并发会话修改，不能代替 Git。
- Agent View、Agent Teams、Remote Control、Computer Use 中部分能力仍是 Research Preview、Experimental 或 Preview。
- Agent Teams 本身不自动解决文件冲突；缺少 Worktree 或文件所有权时，并行越高，冲突越多。
- 本地定时任务依赖 Desktop 保持运行且机器唤醒；云端任务又会引入凭据、成本和数据边界问题。

## 3. 已完成能力：本轮不重复设计

2026-07-10/11 批次已经完成以下主体：

- Plan Review、Session Index / Sessions Workbench。
- Remote Handoff、Remote QR、IDE MCP、Diff Review。
- Browser State / Browser Action、managed CLI、Usage Attribution。
- Background/Worktree 稳定性、IDE Semantic Tools。
- Artifacts、Policy UI、Plugin/LSP Quality、Remote/WSL 修复。
- Trace ID、事件序列、Replay、Backpressure、Capability Negotiation。
- Remote Path Mapping、上下文脱敏基础规则、连接和路径 Guard。
- Approval Operation Fingerprint 主机侧校验。
- Session Lifecycle Vocabulary、Diff Optimistic Concurrency、Binary Guard。

证据：

- `docs/ide/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:23-31`
- `docs/internal/ide-plugin-claude-code-gap-analysis-2026-07-11.md:12-29`
- `docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:25-43`
- `packages/vscode-extension/CHANGELOG.md:5-81`
- `packages/jetbrains-plugin/CHANGELOG.md:3-69`

以下 Runtime 真源也不应在 IDE 层重新发明：

- `docs/implementation-plans/CODING_AGENT_EVENT_SCHEMA.md`
- `docs/implementation-plans/CODING_AGENT_MVP_TOOL_PERMISSION_MATRIX.md`
- `docs/implementation-plans/CODING_AGENT_DESKTOP_CLI_BRIDGE_SEQUENCE.md`
- `docs/design/modules/79_Coding_Agent系统.md`
- `docs/design/modules/83_工具描述规范统一.md`

## 4. Desktop Coding Agent 代码盘点

### 4.1 已有真实主链

- `desktop-app-vue/src/renderer/pages/AIChatPage.vue:206-250,1451,1521,1966-1978`：Agent、Worktree、Plan、Remote Session 入口和消息发送。
- `desktop-app-vue/src/renderer/stores/coding-agent.ts:1058-1254`：会话 list/create/resume/send、Plan approve/reject、close/interrupt。
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js:9-729`：会话、远程、审批、后台、Worktree、Review/Patch、Task Graph、Workflow 等 IPC。
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js:40-145,341-790`：启动本地 `cc serve`，通过 WebSocket 连接并处理断线。
- `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-session-service.js:247-350`：创建、恢复、列出 Session，支持 Provider、Model、Project Root 和 Worktree Isolation。

因此，Desktop 已有真实 Coding Agent 执行链，不是 UI Mock；但整体仍偏“聊天页中的 Agent 模式”，尚未形成 Claude Code Desktop 式完整工作台。

### 4.2 发现的高价值具体缺口

1. **Agent 上下文疑似丢失**：`AIChatPage.vue:1218-1231` 构造 Active File Context，但调用位于普通 Chat 分支；Agent 分支 `1966-1978` 直接发送文本。应先写回归测试确认，再将 Active File、Selection、Diagnostics、Open Tabs、Git Diff、Terminal Context 统一注入 Agent。
2. **Desktop Diff 仍偏卡片/抽屉**：Patch/Review 和 Worktree Diff 已有，但未形成 Monaco 原生逐 hunk accept/reject、行级评论、多文件 Review Queue 和消息级可逆 Checkpoint。
3. **终端不是 Agent 工作台的一部分**：Shell 工具支持前后台、超时和 Kill，桌面也有独立 Terminal；但 Agent 页面没有可交互 PTY、持续 ANSI 流、Terminal Selection/Context 和用户接管。
4. **Git 是泛化工具而非交付工作流**：可运行 status/diff/log/commit/branch，但未见 Agent 页原生 Staged/Unstaged、Commit Graph、Create PR、CI Checks、失败日志和 Review Comment 闭环。
5. **远程当前主要是手机 Relay**：已有 QR、设备撤销、审计和 Policy，但不等于 SSH、Dev Container 或 Cloud Sandbox。
6. **扩展能力没有完全进入 Agent**：Desktop 有独立 MCP/Skill/Plugin 管理 UI；但 Tool Adapter 以 MVP Tier 为主，`run_skill`、`spawn_sub_agent`、Browser、Schedule、Publish Artifact 等 Contract 存在不等于 Agent UI 已完整开放。
7. **Preview 没有自动验证闭环**：Browser Preview、Browser Control 和 WebIDE PreviewFrame 已存在，但 Agent 分支尚未形成 Dev Server 自动识别、Console/Network Error 回灌、DOM/截图验证和修复复验。
8. **缺专用 Checkpoint/Rewind、PR/CI、Scheduled Coding Session 和 Side Chat**：已核主链中未发现完整 UI/API。

## 5. 能力矩阵：对照后的净差距

| 能力面          | Claude Code 当前做法                                 | ChainlessChain 当前判断                           | 建议                                                 |
| --------------- | ---------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| 编辑器上下文    | 自动带入选区、活动文件、终端和 IDE 诊断              | VS/JB 扩展较强；Desktop Agent 疑似漏传活动文件    | P0 修链路并加自动上下文回归测试                      |
| 原生审阅        | Native Diff、Plan/行评论、逐文件 Review              | 扩展主体已有；Desktop 偏卡片/抽屉                 | 补逐 hunk、锚定评论、复杂文件语义                    |
| Notebook        | VS Code IDE MCP 执行 Jupyter，始终原生确认           | VS Code 已有 `executeCode`                        | 统一审计、取消、超时和输出裁剪                       |
| 会话            | 命名、恢复、按 PR 恢复、分支、导出、跨 Worktree 搜索 | Session Workbench 已有，联合 Rewind/Branch 不完整 | 建立 Turn、Checkpoint、Branch、PR、Worktree 一等关系 |
| 权限            | Plan/Ask/Accept/Auto/dontAsk/Bypass + 规则和沙箱     | 多模式与 Policy UI 已有                           | 补恢复幂等、拒绝原因、跨设备指纹                     |
| Worktree        | 并行会话自动或显式隔离                               | 有基础                                            | 后台可写 Session 默认隔离并安全清理                  |
| 后台/多 Agent   | Subagent、Agent View、Teams、Workflow、Batch         | Pool、Task Graph、Harness 已有                    | 统一状态、人工接管、成本和文件所有权                 |
| App Preview     | Dev Server、浏览器、DOM/截图/交互、自验证            | Browser/WebIDE 基础有，Agent 闭环缺               | 建 Launch、Preview、Evidence Artifact                |
| Git/PR/CI       | PR、Checks、Auto-fix、受控 Auto-merge                | 泛化 Git 有，专用 UI 缺                           | 建 PR 状态条和有限自动修复                           |
| Local/SSH/Cloud | Desktop 可切 Local/SSH/Cloud                         | Mobile Relay 有，SSH/Cloud 缺                     | 统一执行位置、权限、凭据和回传                       |
| 定时/事件       | Scheduled Tasks、Loop、Channels、CI/Slack            | 未形成 Coding Session 产品闭环                    | 先本地受控任务，再扩事件/云                          |
| 扩展生态        | Skills/Plugins/MCP/Hooks/LSP/Marketplace             | 平台 UI 丰富，Agent 会话级整合有限                | 加 Picker、Scope、权限解释和归因                     |
| 企业治理        | Managed Settings、Provider/Gateway、OTel、Doctor     | Policy/Usage/Trace/Doctor 有基础                  | 补 Workflow Trace、诊断包和 SBOM                     |

## 6. P0：可靠性、安全回退和真实验收

### P0-1 修复 Desktop Agent 自动上下文链路

先为当前代码路径增加失败用例：开启 Active File Context 后，从 Agent 分支发送消息，断言 Session Service 收到活动文件；随后扩展为以下自动、临时、可见且可关闭的上下文：

- Active File 与 Selection。
- Open Tabs，只传路径和必要摘要。
- Problems/Diagnostics，优先传当前文件。
- 用户显式引用的 Terminal Output。
- 当前 Git Diff、Branch 和 Working Tree 状态。

UI 应显示本轮实际附带了什么，并允许移除敏感文件。自动上下文仍必须服从 Read Deny 和脱敏规则。

### P0-2 恢复路径保证副作用幂等

**现状**：生命周期状态和 `requiresIdempotencyGuard` 谓词已有基础，但 IDE/headless resume 尚未在所有路径用它阻止危险工具静默重试。

**建议**：

- 每次 Tool Call 写不可变 Ledger：`tool_call_id`、输入摘要、权限决策、起止状态、外部幂等键、结果摘要。
- Resume 区分 `not_started`、`started_unknown`、`succeeded`、`failed_retryable`、`failed_final`。
- 写文件、Shell、发布、消息发送、数据库和远程 API 使用不同恢复策略。
- `started_unknown` 的风险操作默认进入 `needs_input`，禁止模型自行重放。
- Diff Apply 使用内容哈希/版本号；外部 API 优先使用 Provider Idempotency Key。

**验收**：

- 在请求已发出、结果未返回的窗口随机 kill CLI/Bridge/Extension Host，恢复后重复副作用为 `0`。
- 被拦截的恢复操作必须显示原始参数摘要、风险和建议动作。

**已落地（2026-07-13 续，headless 崩溃安全副作用台账 + resume 拦截接线）**：P0-2 的纯核（[`side-effect-ledger.js`](../packages/cli/src/lib/side-effect-ledger.js) 两相 `prepare→start→commit|fail|unknown` + 诚实恢复规划器，[`side-effect-ledger-store.js`](../packages/cli/src/lib/side-effect-ledger-store.js) 链式持久化）此前已建但**无任何执行/恢复路径调用**——所以恢复时永远无账可对。本轮补齐两半，把 P0-2 从「有谓词、无闭环」推进到「headless 路径真拦截」：

- **工具分类器**（纯核）：新增 [`side-effect-ledger.js`](../packages/cli/src/lib/side-effect-ledger.js) 的 `classifyToolSideEffect(tool, args)`——把一次 agent 工具调用映射为副作用 kind 或 `null`。**保守 fail-closed**：`write_file`/`edit_file`/`notebook_edit`→`file-write`（非幂等）、`edit_file_hashed`→`file-write-checkpointed`（hash 守卫，重放安全→幂等）、`run_shell`/`run_code`→`shell`（不透明命令一律非幂等，对应「`started_unknown` 风险操作默认 needs_input」）、`git`→仅 `push` 记为 `git-push`（其余 status/diff/commit/branch/pull 皆本地可恢复→`null`）、`publish_artifact`/`schedule`/`notify`/`browser_act`→`network-mutation`；只读/本地工具（read_file/search/list/web_search/todo_write/browser_state/spawn_sub_agent…）→`null`，避免 resume 被无关警告刷屏。
- **记录接线**（[[headless-runner.js]]）：仅当 `persist`（ephemeral/一次性 run 无从恢复，字节路径不变）时，在 `tool-executing` 事件对危险工具 `prepare(opId).start(opId)` 并**在效果落定前持久化整快照**，`tool-result` 再 `commit`（无错）/`fail`（有错）并持久化。`opId = ${runNonce}:${seq}` 以 run 起始时钟去重跨 run（避免 resume 后新 op 与旧 op 撞 id 被 `prepare` 幂等吞掉）。`prepare` 幂等 + 快照最新胜出，与 [[turn-binding-store.js]] 同一持久化形态（新事件类型 `side_effect_ledger` 不入 message rebuild、走既有 hash 链故 `verifySession` 不破）。
- **resume 拦截**（[[headless-runner.js]]）：`--resume` 时先从最新持久化快照重建台账并 `reconcileSideEffects`，任一 `inspect`（started-but-unsettled 非幂等 op）→ ①stderr 警告 ②注入一条 system「Recovery notice — 上次 run 中断时这些不可逆操作在途、结果 UNKNOWN，勿盲目重跑，先核实是否已生效」列出 kind+key+原因，让恢复的模型不再静默重放。无在途危险 op → 零注入、零行为变化。

测试：`side-effect-ledger.test.js` +7（分类器逐类：file-write 非幂等/edit_file_hashed 幂等/shell fail-closed/仅 git push/network-mutation 四类/只读→null/长 key 截断）；新 `headless-side-effect-ledger-resume.test.js` 3（in-flight git push 崩溃→resume 注入 Recovery notice+stderr / 干净 commit→resume 零注入 / read_file 不产生台账事件）。既有 headless-runner/resume/tamper/stream/determinism/approvals/async-hooks/budget/notices 全套回归绿（142 用例）。

**已落地（2026-07-13 续②，P0-2 四个剩项全收口）**：上一轮闭合的是 headless CLI 路径；本轮把剩下四项也落地：

- **① 接进 IDE/Bridge/Extension-Host resume**：WS 网关的 [[ws-agent-handler.js]] 现和 headless 一样，在 `tool-executing`/`tool-result` 事件对危险工具 record prepare→start（快照落定前持久化）+ commit/fail，keyed by `session.id`（`appendEvent` 按需建文件，与 sessionManager 的消息存储各行其道）；[[session-protocol.js]] 的 `handleSessionResume` 加 `buildResumeRecovery`——resume 时 reconcile 该 session 台账，任一 `inspect` op → ①`SESSION_RESUMED` 载荷 + `SESSION_RESUME` 运行时事件带**去标识** recovery 描述子（kind+短 key+原因，**绝不带参数值**）②往 `session.messages` 注入一条 system Recovery notice，让恢复的 IDE 模型不静默重放。无在途危险 op → 零 recovery 字段、零注入。
- **② Diff Apply 内容哈希幂等**：新纯核 [`idempotency.js`](../packages/cli/src/lib/idempotency.js) `classifyEditReplay({content, oldString, newString})` → `apply`（old 在→照改）/`already_applied`（old 没了但 new 在→已落地）/`conflict`（都不在→真不匹配）。接进 [[agent-core.js]] `edit_file` 执行器的 `count===0` 分支：原来一律报 `old_string not found` 错误，现先跑 classifyEditReplay——`already_applied` 则返回**幂等 no-op 成功**（`{success, alreadyApplied, idempotencyKey}`，**不写文件、零数据风险**），让崩溃恢复的 worker 不会卡在重发一个已经做过的编辑；`conflict` 仍照旧报错。删除类（new 为空）刻意不自动判已应用（保守报错）。
- **③ 外部 API Provider Idempotency Key**：`idempotency.js` `operationIdempotencyKey({tool, args, scope?})` = tool + **规范化（键序无关）** args 的确定性 sha256 key（无时钟/RNG，同一逻辑效果恒同 key）。headless + WS 两路径 record 时把它写进台账 op 的 `meta.idempotencyKey`；这是一个稳定 key，外部 provider 支持 `Idempotency-Key` 时可直接透传去重（注：当前 agent 工具面无发起变更型外部 HTTP 的工具——notify/schedule/publish_artifact 皆本地存储、web_fetch 仅 GET，故暂无 header 可挂，key 先作为台账去重锚 + 未来外呼即用）。
- **④ Kill-point E2E `0` 重复副作用度量**：`side-effect-ledger.js` 加 `countDuplicateCommittedEffects(ledger)`——统计 `meta.idempotencyKey`（缺则退回唯一 opId）重复的 committed op。headless kill-point E2E：run1 push commit → run2 CORRECT resume 不重发 → 度量 = **0**；对照 run2 盲目重发同 push（不同 run clock 给新 opId）→ 度量 = **1**（能抓到 naive replay）。

新增/改动测试：`idempotency.test.js` 12（edit-replay 三态 + 删除不误判 + edit/operation key 确定性与敏感度 + 键序无关）；`agent-core-edit-idempotent-replay.test.js` 3（already-applied no-op 不写文件 / 真不匹配仍报错 / 正常编辑照常）；`side-effect-ledger.test.js` +3（0-duplicate 度量：无重复/同 key 二次 commit=1/未落定与无 key 不误判）；`ws-bridge-side-effect-resume.test.js` 2（WS 记录 mid-flight push → bridge resume 载荷+system note 都带 git-push / 干净 commit 零 recovery）；`headless-side-effect-ledger-resume.test.js` +2（kill-point 0 与 1 度量）。edit-freshness/edit-hashed/ws-agent-handler/message-dispatcher/headless 全套回归绿（本轮跨文件 391 用例）。**P0-2 至此四剩项全清**；唯一未做=真机 kill CLI/Bridge/Extension-Host 的物理 E2E（环境阻塞，度量与 record/reconcile 逻辑已锁定）。

证据：`docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:57-61`。

### P0-3 代码与对话联合 Checkpoint / Rewind / Branch

建议建立明确关系：

```text
session
  └─ turn
      ├─ conversation_checkpoint
      ├─ file_checkpoint
      ├─ tool_ledger_range
      ├─ worktree_ref
      └─ parent_turn / branch_id
```

Session Timeline 提供四个动作：“只恢复代码”“只恢复对话”“恢复二者”“从这里分支”。外部人工修改、Shell 修改和其他 Session 修改不在快照内时必须警告，不能暗示完全可逆。Branch 默认创建独立 Session；有写入任务时默认进入独立 Worktree。

验收要求：

- 恢复后文件哈希、对话上下文、Session 指针和 Tool Ledger 一致。
- 原 Session 不被 Branch 覆盖；Session 级临时授权不默认继承。

**已落地（2026-07-13 续，联合 Rewind 的第四个动作「从这里分支」纯核）**：P0-3 的前三个恢复动作（「只恢复对话 / 只恢复代码 / 恢复二者」）此前已由 [`turn-binding.js`](../packages/cli/src/lib/turn-binding.js) 的 `resolveRestorePlan()` + 诚实 coverage 覆盖；缺的第四个动作「从这里分支」现补齐为纯逻辑模块 [`session-branch.js`](../packages/cli/src/lib/session-branch.js)（复用 turn-binding 的 `TURN_COVERAGE`，无 RNG / Date / fs / git）：

- **`deriveBranchId(parentSessionId, parentTurnId, seq)`**：sha256 确定性分支 id（无 RNG）——同输入同 id，跨重启重放的分支请求解析为一个分支；`seq` 消歧「同一 turn 上的两个分支」。
- **`deriveBranchSessionId`**：traversal-safe 的新 session id（清掉分隔符），确定性命名。
- **`planSessionBranch({ parentSessionId, turn, seq, writeIntent })`** 落实 P0-3 四条不变量：目标恒为**新** session id（绝不落回父）；`preservesParent:true`（原 session 永不被覆盖）；`requiresWorktree` 当分支要写、或分支点本身已改文件（避免与父工作树碰撞）；`inheritSessionGrants:false`（Session 级临时授权不入分支）。`conversationTruncateTo` = 分支点 turn 的会话偏移（保留该 turn 及之前历史）。warnings 诚实：PARTIAL（不可逆副作用无法在分支重现）/ NONE（无 checkpoint、工作树可能与分支点对话不符）/ 缺 offset（退回父全量历史）。
- **`validateBranchLineage(records)`**：分支血统完整性守卫——检测环（分支不得是自己的祖先，否则 restore 会走回原分支）与孤儿（声明的父不存在），是「原 Session 不被覆盖」的图级后盾。

`forkSession()`（[[jsonl-session-store.js]]）是整会话拷贝、无 turn 级截断/血统/worktree/授权语义，故本模块为其纯规划层。测试：`session-branch.test.js` 19（分支 id 确定性/消歧 + traversal-safe + 四不变量 + worktree 触发（写意图 / 分支点已改文件）+ PARTIAL/NONE/缺 offset 诚实 warning + 血统环/孤儿检测）。纯核尚未接进 REPL `/rewind` 与 IDE Session Timeline seam，故默认路径零影响。

### P0-4 JetBrains GUI 自动化成为发布证据

`packages/jetbrains-plugin/GLUE_TODO.md:995-1028` 表明 Remote Robot 骨架尚未完成真实 IDE 首次闭环。

首个 nightly 必测：

1. 全新安装插件并启动真实 IDE。
2. 首条消息与流式输出。
3. Diff Accept / Reject / Request Changes。
4. Plan Review。
5. `@mention` 文件和选区。
6. Terminal 上下文与审批。
7. Inline Completion。
8. Remote QR / Handoff。
9. 失败时上传截图、IDE 日志和脱敏 Trace。

先作为 nightly 非阻塞检查，稳定后再升级为 release required check。

### P0-5 五类远程开发真实 E2E

真实环境必须覆盖：

- WSL。
- VS Code Remote SSH。
- Dev Containers。
- GitHub Codespaces。
- JetBrains Gateway / Remote Development。

每个环境验证连接、重连、Selection、Diagnostics、Terminal、`@mention`、Diff、审批、取消、Resume、中文/空格路径、Symlink、Multi-root 和网络闪断。验收口径见 `docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:125-149`。

### P0-6 生命周期与长稳测试

- 1,000 次 Session create/start/attach/detach/resume/stop/archive。
- 8 小时 soak，混合前台会话、后台工具、慢消费者和 IDE 重载。
- 随机 kill CLI、Bridge、Extension Host、Dev Server。
- 监控残留进程、端口、锁文件、Worktree、临时文件、句柄和内存增长。
- 记录 P50/P95/P99 恢复耗时及消息丢失/重复率。

当前单元测试较丰富，但仍需补真实 CLI Spawn + WebSocket、Shell/Git、审批点击、Crash/Resume、Worktree Conflict/Merge、Remote Relay 的 Electron/Playwright E2E。

### P0-7 发布渠道和真实安装包

仓库对 Microsoft Marketplace 状态存在冲突，不能只依据单一 README 或 Changelog 判定。

发布门建议：

- Registry API 校验版本、Publisher、签名、资产和兼容范围。
- 在全新 VS Code、Open VSX 兼容编辑器、IntelliJ IDEA/Android Studio 真实搜索安装。
- 校验 Registry 下载包与 CI 产物一致。
- 覆盖首次安装、升级、降级、离线安装、managed CLI 首启和卸载清理。
- Open VSX 当前可检索到 ChainlessChain IDE Bridge，但外部 Registry 状态仍应自动持续实证。

冲突证据：

- `packages/vscode-extension/CHANGELOG.md:488-494`
- `packages/vscode-extension/README.md:12-28`
- `docs/internal/ide-extensions-releasing.md:27-58`
- `docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:62-63`

## 7. P1：完整工作台与交付闭环

### P1-1 原生复杂 Diff 与评论驱动修复

下一步重点不是普通文本 Diff，而是语义和并发正确性：

- Rename、Delete、Mode Change、Create/Delete 混合 Changeset。
- Formatter、Watcher、Git 或人工编辑造成的并发修改。
- Binary/Large File 的明确降级。
- Desktop 使用 Monaco 原生多文件 Review Queue 和逐 hunk accept/reject。
- 行评论传递 `file + base hash + line/hunk anchor + comment`。
- Agent 修复后评论标记为 resolved/outdated，不错误复用旧行号。

**已落地（2026-07-13 续，行评论锚定 + 陈旧判定纯核）**：本节最后两条（行评论的 `file + base hash + line anchor` 传递、修复后标 resolved/outdated 且**不复用旧行号**）现落为纯逻辑模块 [`review-comment-anchor.js`](../packages/cli/src/lib/review-comment-anchor.js)。此前 [[review-pipeline.js]] 只聚合 findings，其 `line` 是**对单快照的裸坐标**——agent 一改文件，行 42 就指向无关代码。新模块把评论锚到它所指的**代码**而非坐标：

- **`makeCommentAnchor({file, content, line, comment, contextRadius})`** 捕获 `file` / sha256 `baseHash` / 1-based line / 锚定行原文 + 上下各 `contextRadius` 行上下文；越界行 → `line:null`、`anchorLine:""`。
- **`reanchorComment(anchor, newContent)`** 在新版本重算命运：`current`（hash 一致，行保留）/ `moved`（锚定行**唯一**重定位，行更新）/ `outdated`（锚定行被改走/删除 → **`line:null`**，修复多半已处理它，旧号绝不复用）/ `ambiguous`（多个等可能位置 → `line:null`，交人）。上下文仅作**同文本多命中的消歧 tie-breaker**，故 0-radius 的唯一命中仍能重定位。**硬不变量**：任何无法唯一定位的场景 `line` 恒为 `null`，再无陈旧坐标穿越 re-anchor。
- **`markResolved`**（调用方显式「你修好了」终态，区别于自动检测的 outdated「被评论的代码消失了」）+ **`reconcileComments(anchors, newContent, {resolvedIds})`**（批量 re-anchor 并按 status 分桶）。

测试 `review-comment-anchor.test.js` 11（锚定捕获 + current/moved/outdated（编辑走/整段删/无捕获文本）/ambiguous（对称 0-radius 多命中）+ 上下文消歧唯一→moved + resolved 终态 + 混合集分桶且 outdated/ambiguous 恒 null 行）。纯核尚未接进 [[review-pipeline.js]] 的 finding 输出与 IDE Diff Review 评论线程 seam，故默认路径零影响。剩项（Rename/Delete/Mode-change changeset 语义、Monaco 逐 hunk Review Queue、Binary/Large 降级）仍开放。

证据：`docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:64-66,187-192`。

### P1-2 交互终端

- Agent Session 内嵌真实 PTY，与 Agent 共享 CWD 和环境。
- 持续 ANSI 输出、滚动裁剪、搜索和复制。
- 用户可接管输入，也可把选中输出附加到下一轮。
- 后台命令显示 PID、端口、健康状态并可安全停止。
- Agent 不得把 Terminal 中的敏感输出默认加入模型上下文。

**已落地（2026-07-13 续，终端上下文策略层纯核）**：本节的文本处理与「敏感输出不入上下文」策略落为纯逻辑模块 [`terminal-context.js`](../packages/cli/src/lib/terminal-context.js)——它是**策略 + 文本层，不是 PTY**（永不 spawn shell / 分配伪终端 / 碰 fs·clock·RNG·process），由真 PTY 宿主喂入捕获字节与选区意图、读回「哪些可安全交给模型」：

- **核心不变量①（fail-closed）**：`selectTerminalContextForModel({output, selection, optIn, maxLines})` 在 `optIn !== true` 时返回 **`null`（什么都不附带）**——落实「Agent 不得把 Terminal 中的敏感输出默认加入模型上下文」，环境 scrollback 绝不静默流进 prompt；truthy-but-not-true 亦 fail-closed。
- **核心不变量②**：一旦显式 opt-in，优先取用户 `selection`（「把选中输出附加到下一轮」）而非全量 output，且**先 ANSI-strip 再 secret-redact（过 [[secret-scan.js]]）再 scrollback-cap** 才成为上下文——打印出的 token 或控制序列都进不去。
- **`stripAnsi`**：可审计的 CSI/OSC/两三字节转义清除（供搜索/复制/入模前），非串→`""`；**`truncateScrollback`**：保留活跃尾部 N 行并**标注省略行数**（非静默截头），坏 `maxLines` 回落默认 400。
- **`describeBackgroundCommand({command, pid, ports, status})`**：「后台命令显示 PID、端口、健康状态并可安全停止」的安全描述子——命令串 secret-redact（`FOO=token cmd` 不把 token 泄进状态胶囊）、PID 强转正整数或 null、端口校验去重、`normalizeHealthStatus` fail-closed 归一（未知→UNKNOWN），`stoppable` 仅在握有真 PID 时为真。

测试 `terminal-context.test.js` 17（ANSI 清除 CSI/光标/非串 + scrollback 保尾标省略/坏 cap 回落 + 选上下文四路 fail-closed/选区优先/ANSI+secret 双清/scrollback cap + 健康状态归一 + 后台描述子端口去重·命令脱敏·无 PID 不可停）。纯核尚未接进真 PTY 宿主 / Agent 终端面板 / shell-tool 后台任务视图 seam，故默认路径零影响。剩项（真 PTY 内嵌、持续 ANSI 流、用户接管输入、终端搜索/复制 UI）仍开放。

### P1-3 App Preview 自动验证

增加项目级 Launch 配置：启动命令、CWD、端口、健康检查、环境变量引用和关闭策略。Session 统一展示 Preview、Server Log、Console Error、Network Failure 和最近验证证据。

Agent 每轮按风险选择静态检查、API Probe、DOM 断言或视觉截图，不要求所有改动都启动浏览器。截图、DOM 摘要、操作序列和测试结果保存为 Artifact；登录态持久化必须显式开启并区分项目、Session 和用户作用域。

**已落地（2026-07-13 续，App Preview 自动验证判定层纯核）**：本节的 Launch 配置契约、按风险选层、证据 Artifact 契约与登录态作用域全部落为纯逻辑模块 [`app-preview.js`](../packages/cli/src/lib/app-preview.js)——它是**判定 + 描述层，不是 runner**（永不 spawn dev server / 开浏览器 / 碰 fs·clock·RNG·process），与 [[execution-location.js]] 同姿态：

- **`detectDevServer(pkg)`**：从 package.json 自动识别 dev-server——先按依赖签名（vite/next/nuxt/angular/vue-cli/astro/sveltekit/gatsby/remix/CRA/webpack-dev-server）给出 framework + **已知默认端口** + `npm run <dev|start|serve|develop>`；仅命中 dev 脚本而无已知框架时给命令但 **`port:null`（绝不臆造端口）**；无可识别信号 → `null`（调用方不得猜命令）。
- **`normalizeLaunchConfig` / `validateLaunchConfig`**（fail-closed，EXHAUSTIVE）：Launch 配置 = 启动命令 / cwd / 端口 / 健康检查{path,timeoutMs} / **env 引用（仅名字）** / 关闭策略（graceful 默认）。**核心不变量**：env 只留**引用名**、值一律丢弃——env 条目携带 `value/secret/token/password` → `env-value-present`；缺启动命令 → `missing-start-command`；启动命令内嵌秘密（过 [[secret-scan.js]] `containsSecret`）→ `secret-in-command`；给了 healthCheck 却无 path/url → `health-check-missing-target`。配置可安全渲染/落日志/外传。
- **`selectVerificationTier(change, {minTier})`**：落实「不要求所有改动都启动浏览器」——无信号 → **static-check**（最便宜，不起服务不开浏览器）；server/API 改 → api-probe；UI 改 → dom-assert；高危或显式视觉关切 → visual-screenshot；多信号取最高层；显式 `minTier` **只能抬高不能压低**地板。
- **`buildEvidenceArtifact(kind, data)`**（secret-safe）：截图/DOM 摘要/操作序列/测试结果四类证据 Artifact 契约，未知 kind → `null`（不盲存）；每个自由文本字段（summary/steps/output/label）过 `redactSecrets`，捕获的 console error 不会把 token 带进 Artifact。
- **`resolveLoginStateScope(req)`**（fail-closed）：登录态持久化默认 **OFF**——`enabled!==true` 不持久化；即便开启，scope 不在 {project|session|user} 也不持久化（`scope-unspecified`）；truthy-but-not-true 亦 fail-closed。绝不静默留 cookie jar。

测试 `app-preview.test.js` 30（dev-server 依赖/脚本/无端口臆造/null + 配置 env-仅名·端口越界·健康检查 + 校验五违规穷举 + 选层默认/单信号/多信号取高/minTier 只抬 + 证据四类 secret 零泄漏 + 登录态四路 fail-closed）。纯核尚未接进 Agent 分支的 Dev Server 启动 / Session Preview 面板 / Artifact 落盘 seam，故默认路径零影响。剩项（Dev Server 自动识别真起进程、Console/Network Error 回灌、DOM/截图真捕获与修复复验闭环）仍开放。

### P1-4 PR/CI Monitor、Auto-fix 与受控合并

Session 顶部提供 PR 状态条，展示 Branch、PR、Checks、Review、Mergeability 和最近失败原因。

Auto-fix 边界：

- 每个失败 Check 最多自动迭代 N 次，并显示 Token/时间预算。
- 只读取当前 Commit 对应的日志，避免修复过期失败。
- 每次修复创建独立 Checkpoint，变更和测试可回看。
- Auto-merge 默认关闭；必须满足分支保护、必需 Checks、Review 和无待处理审批。
- 不默认直接 Push 主分支或绕过保护。

**已落地（2026-07-13 续，PR/CI 自动化策略纯核）**：本节的 Auto-fix 边界与受控合并全部落为纯逻辑判定引擎 [`pr-automation-policy.js`](../packages/cli/src/lib/pr-automation-policy.js)——无状态、无 I/O，一切**默认 DENY**（未证明即拦）：

- **`autoFixDecision({check, headCommitSha, iteration, maxIterations, budget})`**：仅当 check 为 failing、`iteration < maxIterations`（默认 3）、且**失败日志 commit == head commit**（`stale-failure-log` 拦过期失败、缺 sha→`commit-sha-unverifiable`）、且 token/时间预算未耗尽时放行；每种拒因带名（对应「最多迭代 N 次 / 只读当前 Commit 日志 / 显示预算」）。
- **`autoMergeDecision(...)`**：**穷举**收集所有未满足项，仅当 `unmet` 为空才允许——`enabled!==true`→默认关；`hasOpenPr!==true`→拒直推分支绕过 PR；分支保护 / Review / 待处理审批 / 任一 check failing 或 pending / **必需 check 缺席或未过**（present-and-passed，缺跑的必需 check 是拦而非放）逐条成为 `unmet`。对应「默认关 + 分支保护 + 必需 Checks + Review + 无待处理审批 + 不绕过保护」。
- `summarizeChecks`（跨 provider 词汇归一，空 checks≠allPassed）+ `describePrStatusBar`（Branch/PR#/checks tally/review/merge 的**无 token** 状态条）。

测试 `pr-automation-policy.test.js` 16（归一/summary + auto-fix 六判定 + auto-merge 穷举拒因/必需 check 缺席/默认关 + 状态条）。纯核尚未接进 `cc` 的 PR 监控命令 / IDE 状态条 seam，故默认路径零影响。剩项（真 GitHub Checks 拉取 + 每次修复独立 Checkpoint 的接线）待后续。

### P1-5 统一后台 Agent / Worktree 工作台

复用现有 Background Harness、Sub-runtime Pool、Task Graph 和 Worktree：

- 状态统一为 `queued`、`working`、`needs_input`、`idle`、`completed`、`failed`、`stopped`。
- 显示 Worktree、Branch、当前步骤、最后工具、权限等待、Token、成本、耗时和变更统计。
- 支持 Peek、Reply、Attach、Detach、Pause、Stop、Retry、以新 Worktree 重试。
- 后台可写 Session 默认独立 Worktree；只读任务可复用当前树。
- 清理前检查未提交修改、未追踪文件、未 Push Commit 和关联 PR。
- 跨 Session 只传摘要和 Artifact 引用，避免整段 Transcript 污染上下文。

**已落地（2026-07-13 续，Worktree 清理安全闸纯核）**：本节「清理前检查未提交修改、未追踪文件、未 Push Commit 和关联 PR」现落为纯逻辑模块 [`worktree-cleanup-safety.js`](../packages/cli/src/lib/worktree-cleanup-safety.js)。此前 [[agent-worktree.js]] `finishAgentWorktree()` 把「dirty」压成一个标志，**不区分未追踪文件、不知道 commit 是否已 push、也无关联 PR 概念**——一个已 commit+push 但留了开着的 PR、或留了全新未追踪临时文件的后台 agent worktree，仍可能被更宽的 sweep 收割。新模块是任何 worktree reaper 背后的纯决策：给一个状态描述子（调用方从 `git status --porcelain` / `git rev-list @{u}..HEAD` / PR store 收集），返回是否可安全移除，并像 [[pr-automation-policy.js]] 一样**穷举**收集全部 blocker：

- **`evaluateWorktreeCleanup(state)`** 一切**默认 KEEP**：`readable===false`（git 状态读不出）→ 短路只报 `unverifiable`（绝不销毁无法核实可弃的工作）；否则逐项收集 `uncommitted-changes` / `untracked-files`（与 uncommitted 区分）/ `unpushed-commits`（有 upstream 看 `aheadCount>0`；**无 upstream 则任何越过 base 的 commit 都算未 push**——fail-closed 读法）/ `linked-pr`（有开着的 PR 引用本分支）。仅当**全清**才 `safeToRemove:true`。
- **`summarizeWorktreeCleanup(state)`** 人读单行，只列计数与具名 blocker（PR 数正确单复数），**绝不回显文件内容或 PR 正文**。

测试 `worktree-cleanup-safety.test.js` 15（clean 放行 + unverifiable 短路 + 四类 blocker 单独命中 + 显式 `unpushed` 覆写 + 已 push（upstream/0-ahead）不拦 + 全命中穷举收集 + summary secret-safe）。

**已接线（2026-07-13 续）**：纯核已接进后台 worktree reaper。[[worktree-isolator.js]] 的 `cleanupAgentWorktrees` 此前**无条件 `worktree remove --force`** 掉每个 `agent/*` worktree——正是 P1-5 警告的数据丢失面（后台 agent 未 push/未提交的活儿被清理销毁）。现每个待清理 worktree 先过 `_worktreeCleanupState`（porcelain 拆 tracked-modified vs `??` untracked + `branch -r --contains` 判 commit 是否在远端 → `unpushed`；git 读不出→`readable:false` fail-closed）再喂 `evaluateWorktreeCleanup`，**不安全即跳过（保留）**；`{ force:true }` 保留旧「全清」逃生门。另加只读 `assessAgentWorktreeCleanup(repoDir)`=清理前 P1-5 检查报告（removable/kept/blockers，删任何东西之前）。回归=`worktree-isolator.test.js` 既有「清全部」用例仍绿（fresh 无提交无改动的 agent worktree 判 safe 照常删）+ 新 4 例（脏 worktree 保留 / 未 push commit 保留 / force 照删 / assess 只读报告带 blocker）。剩项（统一后台 Agent 状态视图、Peek/Attach/Retry 交互、PR-linked 需上层 PR store 注入 `linkedPrs`）仍开放。

### P1-6 Agent 内 Skills / MCP / Plugin 治理

独立 Marketplace 和管理页已有基础，下一步是进入 Agent Session：

- `/skills` 或图形 Picker，展示来源、版本、Scope 和说明。
- MCP 可按 Session Enable/Disable，并解释 Tool 为什么可用或被策略阻止。
- 每次 Tool/Skill 调用显示 Attribution。
- Extension Tier 工具需经过 Capability、Policy、权限、预算和 UI 支持检查后再开放。
- 企业策略锁定来源、版本和 Allowlist。

**已落地（2026-07-13 续，Agent 工具准入 + 归因纯核）**：本节「Extension Tier 工具需经过 Capability、Policy、权限、预算和 UI 支持检查后再开放」+「每次 Tool/Skill 调用显示 Attribution」现落为纯逻辑模块 [`agent-tool-admission.js`](../packages/cli/src/lib/agent-tool-admission.js)。[[plugin-runtime/capabilities.js]] 判的是**插件**是否声明了组件所需能力（安装期契约），**不**决定一个 agent **工具**能否开进运行中的 session。新模块是那个 session 级准入 + 归因，穷举 fail-closed（同 [[pr-automation-policy.js]]）：

- **`admitTool({tool, tier, capabilityGranted, policyAllowed, permissionGranted, budgetOk, uiSupported})`**：**extension 层**（run_skill/spawn_sub_agent/browser/schedule/publish_artifact/MCP）需五闸全过——Capability + Policy + 权限 + 预算 + UI 支持，任一不 `=== true` 即入 `unmet` 具名拒因；**mvp 层**（内置读写/shell）只受 Policy + 预算约束（内置工具的**逐次权限**在执行期问，不在准入期）；**未知 tier 一律当 extension**（最严 fail-closed）。
- **`buildToolAttribution` / `describeToolAttribution`**：每次调用的归因记录（tool ← source@version (scope) · tier · admitted/denied(reason)），**只带来源不带参数值/凭据**，可安全落 transcript。

测试 `agent-tool-admission.test.js` 10（tier 归一 fail-closed + extension 五闸单独/穷举 + 未知 tier=extension + mvp 仅 policy+budget + 归因记录/否决 unmet + 无 token 单行）。纯核尚未接进 agent 工具注册 / `/skills` picker / MCP session enable seam（把它插进 extension 工具开放前置检查是后续接线），故默认路径零影响。

### P1-7 Local / SSH / Cloud / Remote Control 统一模型

“任务在哪执行”应是 Session 一等属性：

| 属性               | 必须显示                             |
| ------------------ | ------------------------------------ |
| Execution Location | Local、WSL、SSH、Container、Cloud    |
| Source             | 目录、仓库、Commit、多仓库           |
| Permissions        | 文件、Shell、网络、MCP、外部系统边界 |
| Credentials        | 只显示来源和作用域，不显示值         |
| Lifecycle          | 前后台、断线和休眠行为               |
| Cost               | 模型、Token、远程环境费用            |
| Return Path        | Commit、PR、Patch、Artifact 或报告   |

移动端/Web 审批卡必须显示操作摘要与 Fingerprint 短标识，Resolve 请求携带完整 Fingerprint；陈旧或不匹配请求 Fail-closed。

**已落地（2026-07-13 续，执行位置一等属性模型纯核）**：本节的属性表（「任务在哪执行是 Session 一等属性」）现落为纯逻辑模块 [`execution-location.js`](../packages/cli/src/lib/execution-location.js)。此前 [[execution-backend.js]] 只是运行时**执行器**（Local/Docker/SSH backend 真跑命令），**无** session 级、可展示、可失效的策略层，也没有 UNKNOWN 位置的 fail-closed 默认。新模块是那一层的纯描述子 + 策略：

- **`describeExecutionContext(input)`** 产出属性表全字段的安全描述子——Execution Location（`normalizeExecutionLocation` 归一 Local/WSL/SSH/Container/Cloud，无法识别 → **UNKNOWN**）/ Source（dir/repo/commit/多仓库）/ Permissions（`clampPermissionsForLocation` 收窄）/ Credentials（`redactCredentialRefs` 只留 name/source/scope）/ Lifecycle / Cost / Return Path。
- **两条给它牙齿的不变量**：①**凭据永不带值**——`redactCredentialRefs` 丢弃任何 `value/token/secret/password/key` 字段，描述子可安全渲染/落日志/外传（对应「Credentials 只显示来源和作用域，不显示值」）；②**UNKNOWN 位置 fail-closed** 到最严权限地板（read-only、shell/network/mcp/external 全关），绝不给未知/远程环境默认环境权限。已知位置每个 ambient power 需显式 `=== true` 才授予（truthy-not-true 不算）。
- **`validateExecutionContext(input)`** 穷举收集违规（fail-closed）：`credential-value-present`（凭据带值泄漏）/ `unknown-location` / `remote-without-return-path`（远程任务结果无处安全回传）/ `remote-egress-granted`（远程箱子拿到 network/external 出网——最高危，必须显式确认而非 ambient）。

测试 `execution-location.test.js` 15（别名归一 + remote 分类 + UNKNOWN 地板 + 显式-true 授予 + 凭据零值 + 描述子全字段 + 未知 return-path→none + 校验五违规穷举）。纯核尚未接进 Session 创建 / Desktop 执行位置切换 / 审批卡 seam（审批卡指纹已由 §8.2 [[operation-fingerprint.js]] 覆盖），故默认路径零影响。

### P1-8 Scheduled / Event-driven Coding Session

按风险分阶段：

1. 本地定时任务：启动全新受控 Session，明确 Desktop 在线和唤醒要求。
2. 事件触发：从 CI、Issue、监控或 P2P Channel 创建任务，外部内容默认不可信。
3. 云端持续任务：凭据托管、数据边界、预算和审计完成后再开放。

每个任务配置模型、预算、时长、并发、Worktree、权限、成功条件、失败通知和产物去向；默认禁止无人值守发布、合并或修改共享基础设施。

**已落地（2026-07-13 续，无人值守动作策略纯核）**：本节末句「默认禁止无人值守发布、合并或修改共享基础设施」现落为纯逻辑模块 [`unattended-action-policy.js`](../packages/cli/src/lib/unattended-action-policy.js)。[[cost-budget.js]] 已封 USD 花费、[[schedule-planner.js]] 决定任务**何时**触发，但没有任何东西决定被触发的任务**能做什么**不可逆动作。新模块是那个决策，一切**默认 DENY**：

- **`evaluateUnattendedAction({actionClass, attended, trigger, allowlist, protectedBranch, budgetExhausted})`**：预算耗尽→全拦（不分是否值守）；`attended===true`→人可在预算内授权任何动作；**无人值守**下 read/local_write/commit 低危放行、plain push 到非保护分支放行，而 **publish/merge/deploy/infra_mutation/external_message 高危默认 `requires-attendance` 拦**——**push 到保护分支等同 merge**（拦）。高危仅当**显式 allowlist** 且触发源可信才放行；`trigger.trusted===false`（P1-8「外部内容默认不可信」）即便 allowlisted 也 `untrusted-trigger` 拦。无法识别的动作在无人值守下 `unknown-action-unattended` fail-closed（值守则交人裁决）。
- `normalizeActionClass` / `classifyActionRisk`（low/high/conditional/unknown 分级）。

测试 `unattended-action-policy.test.js` 11（别名分级 + 值守全放/预算全拦 + 无人值守低危放行 + 五类高危默认拦 + 保护分支 push=merge + allowlist 放行 + 不可信触发拦 + 未知动作 fail-closed）。

**已接线（2026-07-13 续，`cc agenda` 动作门落到工具层）**：纯核已接进定时/事件 runner。`cc agenda run` 对每个 due 的 wakeup/cron 任务 spawn 一个**独立** `cc agent -p` 子进程（[[agenda.js]] `defaultSpawnAgent`），该 run 恒为**无人值守**——所以把动作门投影到**工具层**：新增 [`unattended-action-policy.js`](../packages/cli/src/lib/unattended-action-policy.js) `unattendedDisallowedTools({attended, allowlist, trigger, budgetExhausted})`——用 `TOOL_ACTION_CLASS`（`publish_artifact`→publish、`notify`→external_message，两个能干净按工具粒度拦的高危外呼；`git push`/npm-publish-via-shell 走 `git`/`run_shell` 工具，仍由 shell 策略管而非整工具删）逐个跑 `evaluateUnattendedAction`，deny 的就进 disallow 列表。[[agenda.js]] `buildAgentArgs` 现给每个定时 agent run 追加 `--disallowed-tools <deny>`（默认 `notify,publish_artifact`），模型连调用都不能——**默认禁止无人值守发布/外呼**落地。任务经 `runPolicy.unattendedAllowlist`（action-class 数组）显式把某类放回：[[agent-schedule-store.js]] `normalizeRunPolicy` 校验并持久化该字段（未知类丢弃），`schedule` 工具的 `unattended_allow`（数组或逗号串）→ runPolicy。allowlist 到某类 → 对应工具从 deny 集移除；attended run（此路径无）/两类都 allowlist → 空 deny 集（byte-identical `cc agent -p`）。

测试 `unattended-action-policy.test.js` +5（默认拦两外呼 + allowlist 移除 + attended 零限 + 不可信触发即便 allowlist 仍拦 + 预算耗尽全拦）；`agenda-command.test.js` buildAgentArgs 更新为默认带 deny + allowlist 用例；`agent-schedule-store.test.js` +1（normalizeRunPolicy 校验/去重 unattendedAllowlist、未知类丢弃）。⚠️行为变更：定时 `cc agent` run 默认失去 `notify`/`publish_artifact`（P1-8 意图内），任务需 `unattended_allow` 显式放回。剩项（`git push`/deploy/infra 的 shell 层动作分类门、事件触发 runner 的触发源信任传播）仍开放。

### P1-9 Capability Manifest 与脱敏诊断包

从一份 Canonical Manifest 生成 CLI Capability、VS Code/JetBrains 协商、协议文档、Compatibility Fixture、行为矩阵和 Release Notes Capability Diff，防止代码、文档与测试漂移。

应明确：Trace 字段传播已经落地；一键导出的脱敏诊断包、覆盖率指标和离线协议回放仍需完成。诊断包包含版本、平台、Capability、连接状态、脱敏事件、Trace、重连历史、进程/端口/锁文件/Worktree 摘要；默认不包含源码正文、API Key、Cookie、完整环境变量和未经许可的终端输出。导出前必须运行 Secret Scan。

**已落地（2026-07-13 续，Capability Manifest 单源生成器纯核）**：本节第一句「从一份 Canonical Manifest 生成 …，防止代码、文档与测试漂移」现落为纯逻辑模块 [`capability-manifest.js`](../packages/cli/src/lib/capability-manifest.js)。此前 wire-protocol 能力面被**手写三处**（[[capability-negotiation.js]] 的 `PROTOCOL_FEATURES` / `FEATURE_MIN_VERSION` / 私有 `FEATURE_TO_FIELD`、[[headless-manifest.js]] 的 `buildAgentCapabilities().features`、Java 孪生 + 共享 fixture），加一个 v2 字段只改其一即会在漏掉的对端错解析。新模块是**唯一**定义，其余全为纯投影：

- `toProtocolFeatures` / `toFeatureMinVersion` / `toFieldGate` / `toServerOffer` → 喂 `negotiateProtocol`；`toAgentFeatureFlags` → `cc agent --capabilities` 的 `features` 对象。
- `buildCompatFixture`（VS/JB 孪生可 pin 的确定性快照 + `digest`）、`renderBehaviorMatrix` / `renderProtocolDoc`（可被 CI 与签入副本 byte-diff 的行为矩阵 + Markdown）、`capabilityDigest`（一字符串变即能力面变）、`diffCapabilities(prev,next)`（release-notes 用的 added/removed/changed + 协议 bump）。
- **防漂移牙齿**：`capability-manifest.test.js` 的 drift-guard 断言**活的手写常量**（`PROTOCOL_FEATURES`/`FEATURE_MIN_VERSION`、negotiator 实际打的字段、`buildAgentCapabilities().features` 深比对）恒等于 manifest 投影——某处改而 manifest 未改即 CI 红。测试 16（drift-guard ×6 + fixture/digest/matrix/doc/diff）。

**已接线（2026-07-13 续②，negotiator + `--capabilities` 常量改为从 manifest 读）**：上一笔的「纯核尚未接进 `--capabilities` 命令与 negotiator 的常量导出」现收口——把手写三处的**值**换成 manifest 投影，drift 从「CI 红拦」升级为「结构上不可能」：[[capability-negotiation.js]] 的 `PROTOCOL_VERSION`/`PROTOCOL_MIN_VERSION`/`PROTOCOL_FEATURES`（=`toProtocolFeatures()`）/`FEATURE_MIN_VERSION`（=`toFeatureMinVersion()`）/私有 `FEATURE_TO_FIELD`（=`toFieldGate()`），以及 [[headless-manifest.js]] `buildAgentCapabilities()` 的 `features`（=`toAgentFeatureFlags()`）+ `permission_modes`/`output_formats`/`input_formats`（=manifest 列表投影）。**零行为变化**：投影值与原手写逐项相等（`--capabilities` JSON 输出仅 `event_seq`/`tool_use_id` 键序对调，无 consumer 依赖，无 byte-compare 测试）；共享协商 fixture + Java 孪生的值不变故仍有效；加一个 v2 wire 字段现只改 manifest 一处即流到 negotiator + `--capabilities` + 文档 + fixture。drift-guard 6 断言现为恒真但保留（防有人回退接线或投影 bug）。回归：capability-manifest 16 + capability-negotiation + headless-determinism + headless-stream-negotiation + remote-session-registry = 79 绿；`--capabilities` 运行时输出逐字段核验一致。剩项（覆盖率指标 / 离线协议回放 / renderProtocolDoc 接进 CI byte-diff 签入副本）仍开放。

**已落地（2026-07-13 续，脱敏诊断包纯核）**：本节第二句「一键导出的脱敏诊断包」现落为纯逻辑模块 [`diagnostic-bundle.js`](../packages/cli/src/lib/diagnostic-bundle.js)，把诊断包契约钉成代码：

- **`buildDiagnosticBundle(input, opts)`** 组装 schema `cc-diagnostic-bundle/v1`——版本 / 平台 / Capability（复用 [[capability-manifest.js]] `buildCompatFixture`，绝不另造第二真相）/ 连接状态 / 重连历史 / Trace 摘要（仅 traceId+spanCount，无内容）/ 脱敏事件 {surface,category,count} / 进程·端口·锁文件·Worktree 摘要 / env（`summarizeEnv` 只留**变量名**并旗标 secret-named，值绝不入包）。**默认排除** `EXCLUDED_BY_DEFAULT`=源码正文 / API Key / Cookie / 完整环境变量值 / 未经许可的终端输出（终端输出默认整段丢弃 + `terminalOutputWithheld` 标记，仅 `includeTerminalOutput:true` 才纳入且仍脱敏）。组装末尾对**整包**跑一次 `deepRedact`，无论秘密落在哪个字段都被 [[secret-scan.js]] 兜住。
- **导出前必跑 Secret Scan**：`secretScanGate(bundle)` 深走全部字符串，任何残留秘密→`ok:false`/`blocked:true` 并给出**点路径**（如 `notes`/`a.b[1]`），**fail-closed**；`exportDiagnosticBundle` 一步组装+闸门，闸门不过则**不交出可导出体**。
- 测试 `diagnostic-bundle.test.js` 10（env 仅名 / 契约字段 / 终端默认扣留 vs 显式纳入 / 自由文本脱敏 / 干净包过闸 / 手改残留秘密被拦带路径 / 七字段喂 token 零泄漏）；复用的 secret-scan+capability-manifest 25 绿。

**已接线（2026-07-13 续，`cc doctor --export-bundle` 落地）**：纯核已接进 `cc doctor` 命令面——新增 `--export-bundle [path]` 旗标（[[doctor.js]] `runExportBundle`）：先 `collectDoctorReport()` 取真实体检数据，经 [[diagnostics.js]] 新增的纯映射 `buildDoctorDiagnosticInput(report, {env, worktrees, lockfiles})`（version + 仅 open 端口 + 本机 platform 标签 + 实时 `git worktree list --porcelain` 解析（新纯核 `parseGitWorktrees`）+ 配置目录顶层 `*.lock`）折成 bundle 输入，喂 `exportDiagnosticBundle` 组装+脱敏+强制 secret-scan 闸门；闸门过 → 写 JSON 到 `<path>`（无 path 则 stdout），闸门拦（残留秘密，防御纵深）→ 打印泄漏点位并 exit 1、**不交出可导出体**。这是「一键导出脱敏诊断包」的真实用户面（bypass 人读渲染，是支持工件非终端读出）。env 仅留变量名 + secret-named 旗标、终端输出默认扣留，故导出体可安全外发。测试 `doctor-diagnostic-bundle.test.js` 7（`parseGitWorktrees` porcelain/detached/空 + `buildDoctorDiagnosticInput` 映射/open-only 端口/信号透传/null 报告容错 + `runExportBundle` 端到端：写 v1 包、env 带**名**不带**值**、真实 secret 值零泄漏、终端扣留）；diagnostics/diagnostic-bundle/doctor-status/doctor-checkup/plugin-capabilities 全套 56 回归绿；live `cc doctor --export-bundle` 实证（schema v1 / 98 env 名 / 1 worktree / 注入 `sk-` 秘密值零泄漏而名捕获）。剩项（覆盖率指标 / 离线协议回放 / IDE「导出诊断」命令 seam）仍开放。

证据：`docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:28,62-66,194-200`。

## 8. 安全、质量和企业治理

### 8.1 凭据脱敏真实语料基准

现有规则需要用真实 Fixture 证明：

- 覆盖主流 Provider Token、JWT、Bearer、PEM、云凭据、连接串、Cookie 和 `.env` 变体。
- 加入示例值、哈希、UUID、普通 Base64 等反例测量误报。
- 分别测量 Source Context、Transcript、Trace、Artifact、Diagnostic Bundle。
- 给出 Recall、False Positive Rate、P95 延迟和最大输入内存。

**已落地（2026-07-13 续，凭据脱敏真实语料基准纯核）**：现有 [[ide-context-redaction.js]] `redactSecretsInText` 是**精度优先**（守 IDE 上下文，不能乱改代码否则用户关掉），覆盖 AWS/Bearer/PEM/厂商前缀/`SECRET=value`——但 JWT、连接串、Cookie 无专规则，且无语料/指标。本节补为**新**纯逻辑模块 [`secret-scan.js`](../packages/cli/src/lib/secret-scan.js)，走**导出闸门该有的召回优先**姿态（诊断包/Artifact/Trace 出机器必须朝「不泄漏」失败）：

- **`scanSecrets` / `redactSecrets` / `containsSecret`**：7 类——provider_token（sk-/gh\*/glpat/xox/AKIA/ASIA）、**jwt**（`eyJ…`.`eyJ…`.`…` 三段）、bearer、pem_private_key、**connection_string**（`scheme://user:pass@host`，仅 `:pass@` 形态命中故 `https://example.com` 不动）、**cookie**（Set-Cookie/Cookie 头值）、env_assignment（key 过 `isSecretEnvName` 闸 + 值 token-like + 前瞻拒 `getToken()`）。每类保留读者仍需的结构（Bearer 词 / 头名 / 连接 scheme），只吞秘密值。每次扫描**新编译 RegExp**避免 `/g/` lastIndex 跨调用漏配。
- **标注语料 `SECRET_CORPUS`**：10 正例（逐条带必须消失的 `secret` 子串）+ 8 反例（UUID / git sha / 纯 base64 / 函数调用 `getToken()` / 非秘密 key 赋值 / 无凭据 URL / 散文 / hex 摘要），跨 5 个导出面分布。
- **`runRedactionBenchmark(corpus, {redactor, clock})`**：客观指标——overall/byCategory/bySurface 的 **Recall**、**False-Positive-Rate**、**maxInputBytes**，注入时钟时给 **P95 延迟**。诚实性由测试锁定：本模块 recall=1.0 / FPR=0 全类全面，且**空操作 redactor 打分 recall=0**（防作弊）。

测试：`secret-scan.test.js` 9（逐类检测 + 反例零改动 + benchmark recall/FPR/per-category/per-surface/P95/no-op-0）；`ide-context-redaction`+`credential-guard` 42 绿（仅只读 import `isSecretEnvName`，零回归）。

**已接线（2026-07-13 续，Transcript 导出闸落地）**：三个导出面中，Diagnostic-Bundle 已由 [[diagnostic-bundle.js]] 的 `deepRedact`+`secretScanGate` 强制脱敏（P1-9），本轮补齐 **Transcript 面**——[`cc session export`](../packages/cli/src/commands/session.js) 现在导出前对渲染出的 Markdown（chat-DB 或 JSONL agent transcript 两条源都过同一闸）跑 `scanSecrets`，命中即 `redactSecrets` 替换为 `[REDACTED]` 并把脱敏计数写 **stderr**（不进导出文件）。默认脱敏——一份 transcript 可能夹带 provider token / JWT / 连接串 / cookie（在工具命令或结果里），导出离机必须朝「不泄漏」失败；`--no-redact` 保留原值供用户自己的可信备份。E2E 用真 `cc` bin：种一个用户轮携带 `sk-` token 的 JSONL 会话，`export` 默认输出零 SECRET+含 `[REDACTED]`+stderr 有计数，`--no-redact` 保留原值。测试 `session-export-redact.test.js` 2 绿。剩项（Trace 导出面脱敏接线 + 与覆盖率指标联动）待后续接线。

证据：`docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:51-52,117-123`。

### 8.2 跨设备 Operation Fingerprint

- Fingerprint 覆盖工具名、规范化参数、目标环境、Workspace、Session、有效期和策略版本。
- 审批端显示可读摘要与短标识，协议携带完整值。
- 参数、策略或目标变化后旧审批立即失效。
- 离线重放、多卡并发、超时和重复提交全部 Fail-closed。

**已落地（2026-07-13 续，跨设备 Operation Fingerprint 纯核）**：此前审批指纹被拆成两套不相交机制——[[operation-fingerprint.js]] 的 `operationFingerprint` 只覆盖 tool+params，agent-authority.js 的 `approvalBindingDigest` 只覆盖 toolCallId+args+松散 rule 标签，**目标环境 / Workspace / Session / 有效期 / 真策略版本全缺**，一个陈旧审批在 env/workspace/session/策略版本变更后仍能生效。本节四条现补齐为 [[operation-fingerprint.js]] 的**追加**函数（不动旧三函数，向后兼容）：

- **全元组指纹** `computeOperationFingerprint({toolName, params, targetEnv, workspace, session, policyVersion, notBefore, notAfter})`（`opf_`+40hex，与 32hex legacy 不混淆）——覆盖全部七维；`operationDescriptorKey` 是**去有效期**的逻辑键（同一操作、不同窗口逻辑键相同）。任一维（含参数/策略/目标）变→指纹变→旧审批失效（第 1、3 条）。
- **可读摘要 + 短标识分离**：`summarizeOperation`（**绝不回显参数值**，只列 param key 名 + 目标坐标 ws/env/sess/pol，防 shell 命令/token 泄漏）+ `shortOperationId`（`XXXX-XXXX`，操作员在设备与终端肉眼比对同一卡）——协议仍携带完整指纹（第 2 条）。
- **Fail-closed 解析器** `resolveOperationApproval(pending, resolution, {now})` + `OperationApprovalRegistry`（注入时钟纯核）：`fingerprintsMatch` 常数时间比对（离线重放不同操作→`fingerprint-mismatch`）、有效期窗口外→`not-yet-valid`/`expired`（超时）、设了窗口却无时钟→`no-clock`（fail-closed）、已解析→`duplicate`（重复提交）、被新卡取代→`superseded`（多卡并发单赢家：`issue` 同逻辑键再发即让旧卡失活）。第 4 条四种全 fail-closed。

测试：`operation-fingerprint.test.js` 27（原 13 + §8.2 新 14：全元组确定性/七维敏感/窗口敏感/逻辑键窗口无关 + 短标识+摘要 secret-safe + 解析器六种拒因 + registry 单赢家/at-most-once/未知/过期）。

**已接线（2026-07-13 续，remote-approval-bridge 用全元组指纹 + 失败关闭 registry）**：[[remote-approval-bridge.js]] 此前用旧 2 字段 `operationFingerprint({tool, action, detail})` + `approvalFingerprintOk` 做混淆代理防护——只绑 tool+detail，一个陈旧审批在 session/workspace/env/policy 变更后仍能生效。现改用 §8.2 全元组：`requestDecision` 用 `OperationApprovalRegistry.issue({toolName, params, workspace, session(默认 agentSessionId), targetEnv, policyVersion, notBefore:askedAt, notAfter:askedAt+timeout})` 发卡（`opf_`+40hex），`permission.request` 同时发**完整指纹** + `shortId`（设备/终端肉眼比对同一卡）+ **secret-free `summary`**（只列工具+param key 名+目标坐标，不回显命令值；原始命令仍在 `detail` 供人看）+ 有效期窗口。`approval.resolve` 走 `registry.resolve(fingerprint, {now})` 失败关闭——`fingerprint-mismatch`（换操作/换 session·workspace·env·policy）/`superseded`（多卡并发单赢家）/`duplicate`（重复提交）/`not-yet-valid`·`expired`（离线重放过窗），任一拒 → ask 留 pending → 超时 fail-closed。回显无指纹 = legacy 设备，用本卡自身指纹解析（仍受窗口/重复守卫）；`resolveLocally` 也消费 registry 卡防迟到远端二次结算。有效期窗口贴 ask 生命周期（notAfter=askedAt+timeout）。

测试 `remote-approval-fingerprint.test.js` 重写为 6（发布指纹回显即结算 + 异操作指纹拒 + **异 session 指纹拒**（陈旧上下文）+ legacy 无指纹兼容 + **过窗 expired 拒不结算**（注入时钟）+ 发布带 opf_/shortId/secret-free summary/窗口）；bridge 集成 6 + repl-race 都绿（legacy 无回显路径零回归）。剩项（把 `policyDigest` 升级为真 policyVersion 传入 + headless-stream 侧绑定 seam）仍开放。⚠️注：`remote-session-client-hosted.test.js > keeps server-hosted dispatch byte-identical` 在 main HEAD 即 fail（并行 session 遗留，与本改无关，stash 验证过）。

证据：`docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:36,52-54`。

### 8.3 企业发布与可访问性

- Marketplace 包签名、SBOM、依赖来源、版本 Pin、灰度和回滚。
- Managed Settings、Provider/MCP/Plugin Allowlist、审计导出。
- 全键盘、屏幕阅读器、高对比度、200% 缩放和减少动画。
- Agent、Subagent、Workflow 和外部工具统一 OTel 归因。

## 9. P2：前瞻能力及风险门槛

### 9.1 Agent View 与多 Agent 协作

Claude Code 的 Subagent、Agent View、Agent Teams 和 Dynamic Workflow 是不同层级：

- Subagent：上下文隔离，完成后返回摘要。
- Agent View：用户监控多个独立 Session，并在 `needs_input` 时接管。
- Agent Team：Worker 共享任务和消息，需要文件所有权与冲突策略。
- Dynamic Workflow：大规模编排，必须设置 Agent 总数、Token、金额、时间和并发预算。

ChainlessChain 已有 Sub-runtime Pool、Task Graph、Team/Workflow 基础，应先完成 Agent View 和默认 Worktree 隔离，再开放 Worker 互相通信；大规模 Workflow 默认只读或要求显式预算确认。

### 9.2 Side Chat 与上下文卫生

增加不污染主线程的 Side Chat，用于解释代码、比较方案和临时调查。Side Chat 默认只读；若转成执行任务，用户明确选择：

- 合并摘要回主会话。
- 从当前点 Branch 新 Session。
- 在独立 Worktree 执行。

### 9.3 Channels、Computer Use 与语音

- Channels 有利于 CI、监控和聊天事件进入会话，但必须先解决外部输入信任。
- Computer Use 适合无 API 桌面工具，但审计和可重复性弱，优先 IDE/MCP/API。
- 语音适合导航和派发，不进入代码正确性的关键路径。

## 10. 建议路线图

### 里程碑 A：事实与可靠性收口（1-2 周）

- 修复 Desktop Agent Active File Context，并加 Selection/Diagnostics 回归测试。
- 跑通 JetBrains 首个 Remote Robot nightly。
- 核实三大 Registry 并做真实安装 Smoke。
- 接入 Resume 幂等守卫和 Kill-point 测试。
- 清理版本、Marketplace、managed CLI、Trace、JetBrains TODO 冲突。

### 里程碑 B：安全回退与远程验收（2-4 周）

- 实现 Turn ↔ Conversation Checkpoint ↔ File Checkpoint ↔ Tool Ledger。
- 完成 Rewind 三种恢复和 Session Branch。
- 建立五类远程环境 E2E。
- 跑 1,000 次生命周期和 8 小时 soak。

### 里程碑 C：IDE 交付工作台（3-6 周）

- Desktop 原生复杂 Diff 与 Anchored Comment-to-fix。
- 交互 PTY Terminal 和可控终端上下文。
- App Preview、Dev Server 和验证 Artifact。
- PR/CI Monitor、有限 Auto-fix 和受控 Auto-merge。
- 统一 Agent View、`needs_input` 和 Worktree 可视化。

### 里程碑 D：异步与企业治理（4-8 周）

- Remote SSH/Cloud 与移动端审批 Fingerprint。
- Scheduled/Event-driven Session。
- Agent 内 Skills/MCP/Plugin Picker 和会话级 Policy。
- Capability Manifest、脱敏诊断包、协议回放、Workflow OTel、SBOM。

### 里程碑 E：受控多 Agent（后续）

- Agent Team 文件所有权和冲突检测。
- Dynamic Workflow 预算、并发、人工关卡和失败恢复。
- Side Chat、Channels 和跨端任务派发。

## 11. 验收指标

### 11.1 用户体验

- Time to First Useful Diff。
- 从任务到可合并 PR 的中位耗时。
- 每任务平均权限打断和无效审批次数。
- Reject/Request Changes 后一次修正成功率。
- Session Resume、Branch、Rewind 成功率。

### 11.2 正确性与可靠性

- Resume 重复副作用：`0`。
- Diff 错应用或覆盖用户外部修改：`0`。
- IDE Bridge 消息丢失/重复率。
- P95 重连和 Session 恢复时间。
- 8 小时 soak 后残留进程、端口、锁文件和 Worktree：`0`。
- VS Code/JetBrains/Desktop 核心 GUI Journey 稳定通过率。

### 11.3 安全与治理

- Secret Redaction Recall 和 False Positive Rate。
- 陈旧/篡改 Fingerprint 拒绝率：`100%`。
- 高风险 Tool Call Ledger/Trace 覆盖率：`100%`。
- 无人值守任务越权或突破预算：`0`。
- Plugin/MCP/Skill/Hook 来源、版本、权限可追溯率：`100%`。

### 11.4 成本

- 每个成功任务的 Token、模型成本和执行时长。
- Subagent/Team/Workflow 增量成本与耗时收益。
- Context 中系统提示、Tool Schema、历史和源码占比。
- Auto-fix 因过期日志或重复循环造成的浪费率。

## 12. 文档债务与事实校准

> ✅ **本节 5 项已校准（2026-07-13）**：
>
> - **12.1** `docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:8,74` 版本号 `0.37.4`/`0.4.46` → `0.37.14`/`0.4.58`。
> - **12.2** `docs/ide/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:306,318` 的 managed CLI「刻意不做」标为历史决策并划除，记录 0.37.13/0.4.57 已发布的 Managed CLI runtime（按需 npm 下载到全局存储 + sha512 + 回滚 + 显式 path 不被替换）。
> - **12.3** `docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:64-66,196-197` 改写为「trace id 传播已落地，剩项=脱敏诊断包/覆盖率/离线回放」，消除「trace 未贯穿」的误读。
> - **12.4** `packages/jetbrains-plugin/GLUE_TODO.md` 顶部加状态调和横幅，明确区分「是否发布（`(unreleased)` 标签已过期，均已随 0.4.56–0.4.58 上架）」与「是否真实 GUI 验收（多数仍开放，唯一权威待办=文末 GUI smoke gate）」。
> - **12.5** `packages/vscode-extension/CHANGELOG.md` 0.36.16 条目 + `docs/ide/...:312` 更正「已发 Microsoft Marketplace」的失实声明——实测 gallery API 0 结果、`VSCE_PAT` 从未配置，Open VSX 为唯一渠道（README / releasing.md 本就正确）。

### 12.1 版本基线冲突

`docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:8-9,74-82` 仍出现 VS Code `0.37.4`、JetBrains `0.4.46`；同文 `19-23` 和 Changelog 已是 `0.37.14`、`0.4.58`。历史章节不应继续作为当前版本事实源。

### 12.2 Managed CLI 历史决策过期

`docs/ide/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:304-318` 曾判定 managed/private CLI“不做”，但后续已实现：

- `docs/internal/ide-plugin-claude-code-gap-analysis-2026-07-11.md:17`
- `packages/vscode-extension/CHANGELOG.md:43-50`
- `packages/jetbrains-plugin/CHANGELOG.md:56-69`

应把旧结论标为历史决策。

### 12.3 Trace 已传播，诊断闭环未完成

`docs/CLAUDE_CODE_IDE_GAP_ANALYSIS.md:28` 已确认 Trace 字段贯穿；`64-66` 应改写为脱敏诊断包、覆盖率、协议回放和真实验收，避免笼统写“Trace 尚未贯穿”。

### 12.4 JetBrains TODO 状态过期

`packages/jetbrains-plugin/GLUE_TODO.md:87-995` 的部分 `unreleased` 标题已被 `0.4.57/0.4.58` 发布事实覆盖；`995-1028` 的真实 GUI Smoke 待办仍有效。应把“是否发布”和“是否真实 GUI 验收”拆开。

### 12.5 Marketplace 状态冲突

`packages/vscode-extension/CHANGELOG.md:488-494`、`packages/vscode-extension/README.md:12-28`、`docs/internal/ide-extensions-releasing.md:27-58` 对 Microsoft Marketplace 描述不一致，应由 Registry API 和全新 IDE 安装自动生成状态。

## 13. 不建议优先做

- 继续堆普通 Slash Command、右键菜单或只改样式的 Chat UI。
- 在 IDE 复制 CLI 的 Session、Permission、Cost、Context 真相，形成第二状态源。
- 重新设计已有 Event Schema、Tool/Permission Matrix 或 Desktop/CLI Bridge。
- 为宣传数字直接开放几十或上百 Agent 并发。
- 在缺少幂等、预算、审计和 Worktree 前开放无人值守发布或 Auto-merge。
- 把 Claude 账号、订阅、专属云基础设施等供应商绑定 UI 当成必须平价。
- 继续把 `docs/design/modules/98_IDE桥接对标方案.md:21-33` 的早期缺口表当成现状。

## 14. 最终建议

短期资源应集中在 **Desktop Agent 上下文、恢复幂等、联合 Rewind、JetBrains 真实 GUI、远程 E2E、长稳和真实安装包**。这些工作不增加很多演示按钮，却决定产品能否被长期信任。

中期建设 **原生 Diff、交互终端、App Preview 自验证、PR/CI、Agent View、会话级扩展治理和 Remote Control**，把 ChainlessChain 从“聊天页中的 Coding Agent”推进到“跨 IDE、桌面和移动端的可治理开发工作台”。

多 Agent、Dynamic Workflow、Computer Use 和 Channels 放在可靠性与治理之后，并以 Worktree、预算、权限、审计和人工关卡为前提。
