# ChainlessChain IDE 对照 Claude Code：净差距与优化路线图

- 评估日期：2026-08-01
- ChainlessChain 原始审计仓库快照：`eb0bc663b6eb794b1b62ba2bfc7a1267c699d25d`
- 当前代码/Git 核验快照：`7d3120fc1ed7ef1c32c183d3235ced4a39589e1f`（`github/main`，2026-08-15，PR #197）
- 原始审计版本基线（2026-08-01，非当前发布状态）：CLI `0.162.194` release candidate（`0.162.190` / `0.162.191` / `0.162.192` 未发布；`0.162.193` 被非权威通用 workflow 发布，npm `latest` 为 `0.162.193`）、Open VSX `0.37.45`、JetBrains Marketplace `0.4.81`；Microsoft Marketplace 尚未发布。当前状态以第十二节 2026-08-15 快照及第十三节未完成项表为准
- Claude Code 基线：[CLI `2.1.220`](https://code.claude.com/docs/en/changelog)；官方文档回读日期 2026-08-01

> 本文是一份面向下一阶段决策的“净差距”报告，不重复罗列已经完成的能力。
> 既有实现、发布门和历史证据详见
> [IDE 相对插件与 Claude Code 的完整审计](./IDE_VS_PLUGIN_CLAUDE_GAPS_AND_OPTIMIZATIONS_2026-07-22.md)。
> 原始判断按原始审计快照核验，当前状态按当前代码/Git 核验快照及第十二节列出的 exact-head 证据核验；
> 公开版本只用于说明当前分发基线。除非另有发布证据，不能据此推断每项
> 本地实现或缺口已经存在于对应公开版本。

## 一、结论先行

ChainlessChain 当前已经不缺 Chat、Plan、Diff、上下文工具、后台 Agent、Worktree、
权限、插件、远程控制、Checkpoint 或多 Agent 运行时。与 Claude Code 当前体验相比，
真正影响用户感知的差距是：**已有能力没有收敛成一条连续、可理解、可恢复、可验收的 IDE 工作流**。

最值得优先投入的五个方向是：

1. **先关闭安全与正确性缺口**：让交互式 Plan Mode 具备不可放宽的安全上限；让参与 authority、权限或
   执行决策的 Skill/MCP/Hook/Subagent 失败路径 fail closed；让子目录指令在 mutation 前生效，并接通
   真实语义压缩与 Plan/TODO 耐久状态。纯观测/Post Hook 可按策略 fail open，但必须产生可见 incident/audit。
2. **统一 Agent Workbench**：把 Sessions、Background、Team、Worktree、Remote、Artifacts、
   PR/CI 和 Policy 从多个命令入口收敛为一个以 session 为中心的工作台。
3. **补齐 IDE 级 Rewind/Branch**：复用现有 CLI Checkpoint，在消息时间线上统一产品化代码/对话恢复、
   定向总结和从历史点分支，并如实展示回滚覆盖范围。
4. **打通验证到交付闭环**：从 Diff、影响分析、测试/构建、Preview、代码审查、修复重跑，
   一直到 PR、CI、受控自动修复和受控合并，形成同一份可追溯证据。
5. **完成真实分发与宿主验收**：发布 Microsoft VS Code Marketplace，并把当前偏激活/注册级的
   smoke 扩为真实 Chat、Plan、Diff、审批、恢复、Preview、远程重连用户旅程。

此外有两个应立即处理的低成本问题：

- Desktop `/v2` 预览壳挂载的 `Ctrl/Cmd+K` 命令面板仍有 `console.debug` 占位动作，legacy
  `MainLayout` 的另一套面板可以执行 handler，而默认入口当前转向 `/v6-preview`。问题是三个 shell
  surface 的命令模型分叉，应收敛为单一 registry，而不是把 `/v2` 问题外推为默认 Desktop 现状。
- Legacy `AIChatPage` 与 `/v2` `AIChatPanel` 在用户开启 “Include current file” 后，最多把当前文件
  12,000 字符直接内联进 prompt。该路径应升级为有 token 预算、来源说明且可移除的 context chips；
  它不是默认自动注入，也不能外推为 `/v6-preview` 的实现。

反过来，当前**不值得**再新建一套 Chat、Checkpoint、多 Agent 调度或工作流引擎。正确策略是先把
现有 runtime 的信任边界和持久状态做实，再产品化，并让 IDE、Desktop、Web、Mobile 共享同一控制面
和证据模型。

## 二、评估口径

### 2.1 对标范围

Claude Code 的官方 VS Code/JetBrains 集成和已明确支持 IDE extension 的 Dynamic Workflows 是直接基线；
同时纳入 Agent View、Desktop、Routines 和 Code Review，是因为这些相邻界面已经定义了用户对“现代
Coding Agent IDE”的预期。对 Research Preview 或 Experimental 能力只作方向参考，不把它们视为必须逐项
复制的 GA 要求，也不把多个独立 Claude surface 拼接出的理想流程误写成一个已存在的官方产品闭环。

截至 2026-08-01，Claude Code 官方能力中：

- [VS Code](https://code.claude.com/docs/en/vs-code) 已把原生上下文、Plan/Diff、多会话和三种消息级
  Checkpoint 动作放入图形界面。普通 Hooks/Subagents 已是核心能力，但 Agent hooks 和部分 forked
  subagent 行为仍有 Experimental 边界；不能笼统称所有变体均已稳定。
- [Dynamic Workflows](https://code.claude.com/docs/en/workflows) 从 `2.1.154` 起直接支持 IDE extension，
  并提供后台阶段、token/耗时视图、暂停/恢复/停止/重启、保存复用和插件分发。它不是 Preview；但阶段间
  不支持一般用户输入（权限提示除外），恢复也有 prompt-cache 边界。
- [Desktop](https://code.claude.com/docs/en/desktop) 已把并行 Worktree、Preview 自动验证、Diff Review、
  PR/CI 自动修复与受控自动合并，以及 Local/SSH/WSL/Cloud 环境放入同一工作空间。Auto-merge 只用 squash、
  要求仓库启用 GitHub auto-merge；PR 监控要求已安装并认证 `gh`，auto-archive 只适用于完成的本地 session。
- [Agent View](https://code.claude.com/docs/en/agent-view) 是 `2.1.139+` 的 Research Preview、本地 TUI 且
  local-only；关机后本机任务停止。托管 [Code Review](https://code.claude.com/docs/en/code-review) 也是
  Research Preview；Agent Teams 仍是默认关闭的 Experimental 能力。
- [Routines](https://code.claude.com/docs/en/web-scheduled-tasks) 支持 schedule、API、GitHub 事件、
  run history、run-now 和 connector/environment scope，但仍是 Research Preview。其 pause 是暂停 schedule，
  不是暂停正在运行的 task；它启动自主 Cloud session，没有运行中 permission picker，connector 可产生写操作。
- 托管 Code Review 的多 Agent 验证/去重/分级与 Desktop 本地 Diff 的“回复并要求修订”是两个 surface：
  前者的 GitHub 评论回复不会触发 Claude 回应或更新 PR，后者也没有官方多 Agent 声明。
- Remote Control 和 Channels 均为 Research Preview。官方 [Sandbox](https://code.claude.com/docs/en/sandboxing)
  支持 macOS、Linux 和 WSL2，
  不支持原生 Windows；因此跨宿主安全矩阵必须区分“工具层限制”和真实 OS sandbox。

### 2.2 证据等级

| 等级 | 含义                                                       |
| ---- | ---------------------------------------------------------- |
| A    | 已发布并有公开 registry/Marketplace 或精确发布门回读       |
| B    | 仓库代码和定向测试存在，但完整真实宿主/远程/长期矩阵仍不足 |
| C    | 有局部 primitive 或只读入口，尚未形成用户闭环              |
| D    | 当前没有可信实现或不应宣称已实现                           |

排序同时考虑用户价值、可复用的现有实现、失败风险和外部依赖，不按“Claude 有什么就复制什么”排序。

## 三、当前能力与净差距

### 3.1 已经具备、不要重复建设

- VS Code/JetBrains 已有 Chat、Plan、Native Diff、多文件和 hunk 审阅、Diagnostics、语义工具、Preview、
  Background/Remote Agent、Artifacts、Worktree、Plugin、Policy 和 Managed CLI；Test/Coverage/Debugger/Terminal
  等按宿主 capability 暴露，Notebook execution 是 VS Code 侧能力。代码存在不等于完整宿主矩阵已经验收。
  入口可从 [VS Code 命令清单](../packages/vscode-extension/package.json) 和 JetBrains `plugin.xml` 核对。
- CLI 已有后台 Agent、Worktree/Team/Batch、权限和沙箱、Checkpoint、Session、Remote Control、
  Cloud、Routine/Agenda/Loop、Channels、Plugin/Marketplace、MCP、Skills、Hooks、Usage/Insights、
  Artifact、浏览器状态与 OTel。
- 多 Agent 治理已经包含本地 authority、分布式 queue、预算/lease/wall fencing、受控 writer
  checkpoint/rollback、人工裁决和双 IDE 控制面；底层重写的边际价值很低。
- Plugin 的签名、SBOM、升级恢复、策略、live-session reload 和用量归因已经较强；短板主要是
  发现体验与真实私有基础设施矩阵，而不是再造安装器。

### 3.2 净差距矩阵

| 能力面                    | ChainlessChain 当前状态                                                                                             | 相对 Claude Code 的净差距                                                                                                                       | 建议优先级      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Plan Mode 正确性          | C：Headless `--permission-mode plan` 已取只读工具交集；交互式 Plan 另走 `agent-core`                                | 未建立 execution lock 时，settings `allow`（及显式 host allow 的外部工具）仍可绕过 `planManager.isToolAllowed`；WS plan 快照/事件也未完整持久化 | P0 安全门       |
| Skill / MCP / Hook 信任   | C：生态和治理能力丰富                                                                                               | 非隔离 Skill handler 在 CLI 进程直接 import；MCP tool annotations 未保留；部分 contract/hook 异常路径会放宽限制                                 | P0 安全门       |
| 子目录指令                | C：支持懒加载 `AGENTS.md`/`CLAUDE.md`/`cc.md`                                                                       | write/edit/move 在落盘后才注入，delete 未走该路径；loader 以 `path.resolve(cwd)` 为键在进程级共享，无法在首次 mutation 前约束行为               | P0 正确性门     |
| 长会话与状态              | C：有 compressor、Plan 和 TODO primitive                                                                            | 标准入口未向 compressor 注入 `llmQuery`，超限主要 truncate；TODO 仍在内存，WS Plan 转移持久化不完整                                             | P0 质量门       |
| Plan / Diff / IDE Context | A/B：双 IDE 已有原生 Plan/Diff、质量与语义上下文；三个 Desktop shell 已统一消费有界 Context Center contract         | 自动影响分析、最小 gate 选择、失败修复重跑尚未进入主路径；Desktop 尚未提供双 IDE 的完整交互式 chip 管理面                                       | P0/P1           |
| Session / Agent View      | B：Sessions、Background、Team、Worktree、Remote 各自有入口                                                          | 入口和状态模型碎片化，缺统一 dispatch、peek/reply、attach/detach、needs-input 和交付状态视图                                                    | P0              |
| Rewind / Branch           | B/C：CLI Checkpoint 和受控 writer rollback 强；双 IDE `/rewind` 仅恢复 work tree                                    | IDE 消息时间线缺代码/对话/二者、定向总结、fork/branch 和副作用覆盖提示                                                                          | P0              |
| Preview / Verification    | B：Preview、DOM/Browser primitive、Test/Coverage/Debug 已存在                                                       | 缺 DOM/console/network/screenshot 与 diff/test/fix 的统一证据闭环                                                                               | P0              |
| PR / CI                   | C：双 IDE 有只读 PR/CI 状态，CLI 保持 authority                                                                     | 缺创建 PR、失败日志映射、自动修复重跑、受控 auto-merge/auto-archive 的完整闭环                                                                  | P0              |
| 真实宿主与分发            | B：Open VSX 和 JetBrains Marketplace 已发布，已有 Extension Host/Robot 门；VS Code 多根真实宿主子门已关闭           | Microsoft Marketplace 未发布；Remote/多窗口/重启矩阵仍不足                                                                                      | P0              |
| Dynamic Workflows         | B/C：已有 Cowork DAG 与持久 run history，并另有 Team/Batch、后台 Agent 原语                                         | 缺 prompt 生成且可审阅的编排、阶段/agent 进度、token/耗时、暂停恢复、版本化保存与插件分发的一体化 UX                                            | P1              |
| Automation                | B/C：CLI 已有 routine/agenda/loop 与 agent channels                                                                 | IDE 缺统一 Automation Center、trigger scope、run history、run-now/schedule pause 和 needs-input 通知                                            | P1              |
| Execution Environment     | B/C：有 Remote Control、Cloud、后台与跨端能力                                                                       | Local/WSL/SSH/Cloud 尚未成为创建会话时可理解、可比较、可交接的一等选择；Container 可作为 ChainlessChain 扩展                                    | P1              |
| Permission / Side Effect  | A/B：CLI 已提供 scoped authority 与版本化 actual-effect 投影；双 IDE 已消费当前会话的规则、资源、调用链与恢复覆盖   | 仍需长期并发、真实宿主与故障矩阵验证所有入口不泄露凭据值、不扩大 authority，且不会把外部副作用误报为可回滚                                      | P1              |
| Plugin / Marketplace      | A/B：catalog、统一选择、执行/impact authority、本地 readback 与仓库内远端 signature/SBOM activation evidence 已实现 | 缺真实 private registry 与 publisher trust root、组织 key revocation、代理/PAC/custom CA、离线/依赖/供应链故障及外部环境矩阵                    | P1/P2           |
| Inline Completion         | C：当前是手动触发                                                                                                   | 缺自动 debounce/cancel/cache、延迟 SLO 和独立成本预算；有价值但不是决定性差距                                                                   | P2              |
| Desktop 命令与 WebIDE     | C：legacy、`/v2` 与默认 `/v6-preview` 的命令 surface 分叉；WebIDE 更接近 playground                                 | 命令行为不一致；固定三文件 WebIDE surface 未与 session/context/diff/git/terminal 形成同一产品模型                                               | P0 快赢/P2 决策 |

### 3.3 重大判断的源码证据与目标测试

下表中的行号只对应本报告仓库快照；“目标测试”是关闭缺口时必须新增或扩展的定向回归，不表示当前已经通过。

| ID  | 当前事实与精确证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 复现/目标测试                                                                                             | 目标修复                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| E1  | Headless 已在 [headless-runner.js](../packages/cli/src/runtime/headless-runner.js) `:216-232` 强制只读交集；但 [agent-core.js](../packages/cli/src/runtime/agent-core.js) `:1818-1821,1883-1915,2065-2099` 允许无 execution lock 的 settings/host allow 绕过交互式 Plan tool check。                                                                                                                                                                                                                                                                                                                    | 扩展 headless 矩阵；新增 `agent-core-plan-hard-ceiling.test.js`，覆盖 settings/host/Skill/MCP/Git/shell。 | 所有入口复用不可放宽的 Plan capability ceiling；Plan 文件写入使用单独窄能力。                        |
| E2  | **已关闭当前生产路径**：`run_skill` 不再 import 非隔离 handler，固定返回 `CC_SKILL_DIRECT_HANDLER_BLOCKED`；隔离 Skill 只获得三个只读文件工具，且无消费方的 `skill-process-broker` 已删除。                                                                                                                                                                                                                                                                                                                                                                                                             | 已覆盖 legacy direct handler 阻断、隔离 child 工具交集、无 MCP/process authority 与休眠 façade 缺失。     | 若未来恢复 handler，必须重新完成 source/digest approval、可执行身份、完整进程树与宿主 dispose 门禁。 |
| E3  | [mcp-config.js](../packages/cli/src/runtime/mcp-config.js) `:295-322` 将 schema/source 放入 descriptor，却没有传播 MCP effect annotations。                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 新增未标注、伪报只读、destructive/open-world、同资源并发调用的 MCP 风险矩阵。                             | annotations 版本化但仅作提示；最终 effect 由宿主策略、观测与资源冲突检测共同决定。                   |
| E4  | [agent-core.js](../packages/cli/src/runtime/agent-core.js) `:6313-6364,6457-6505` 在 contract 解析失败时放开 Skill allowlist/permission gate，MCP/Hook 则退为空集；后续 permission enforcement 仍按 best-effort 继续。[hook-runner.cjs](../packages/cli/src/lib/hook-runner.cjs) `:671-677` 的默认首个 `block/ask` 短路可让较早 `ask` 遮住后续 `block`。                                                                                                                                                                                                                                                | 新增 malformed contract、permission resolver throw、hook `ask→block` 顺序置换与 timeout/spawn failure。   | authority-bearing failure 退到最严能力；PreToolUse 运行全部匹配规则并取最严格决策。                  |
| E5  | [agent-core.js](../packages/cli/src/runtime/agent-core.js) `:2905-2929` 以 `path.resolve(cwd)` 为键共享进程级 loader；write `:3223-3230`、move `:3302-3306`、edit `:3402-3406` 在 mutation 后注入，delete `:3259` 未走注入路径。                                                                                                                                                                                                                                                                                                                                                                        | 新增新 session 首次 write/edit/move/delete 进入嵌套指令目录的“执行前已加载”测试。                         | loader 按 session/root 隔离；所有路径 mutation 在 policy/approval/执行前完成 preflight。             |
| E6  | [prompt-compressor.js](../packages/cli/src/harness/prompt-compressor.js) `:234,299,426` 仅在提供 `llmQuery` 后总结；标准构造 [agent-core.js](../packages/cli/src/runtime/agent-core.js) `:8270+`、[agent-repl.js](../packages/cli/src/repl/agent-repl.js) `:645`、[compact.js](../packages/cli/src/commands/compact.js) `:41,46` 均未注入。                                                                                                                                                                                                                                                             | 用 provider spy 验证超过预算时确实调用摘要，并以冻结事实语料测试失败降级与 usage 记录。                   | 接通受预算 provider query、真实 tokenizer/usage 和统一结构化 handoff。                               |
| E7  | [todo-manager.js](../packages/cli/src/lib/todo-manager.js) `:4,20` 是进程内 store；[ws-session-gateway.js](../packages/cli/src/gateways/ws/ws-session-gateway.js) `:1525-1537,1556-1572` 的 plan snapshot/hydrate 缺 execution lock，`:1621-1629` 监听也未覆盖 revise/executing/settled。                                                                                                                                                                                                                                                                                                               | 新增 WS/IDE/进程 kill-restart、event replay、revision/approval/execution lock 原子一致性测试。            | 以 canonical event + snapshot 持久化 Plan/TODO，并使用 revision/CAS 防止恢复后权限变宽。             |
| E8  | 双 IDE `/rewind` 聚焦 work tree：[chat-view.js](../packages/vscode-extension/src/chat/chat-view.js) `:2298-2399`、[ConversationView.java](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ConversationView.java) `:871-963`。PR 状态明确只读：[extension.js](../packages/vscode-extension/src/extension.js) `:551-553`、[PrStatusAction.java](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/PrStatusAction.java) `:20`；macOS strict gate 固定旧宿主的原因见 [cli-strict-sandbox.yml](../.github/workflows/cli-strict-sandbox.yml) `:170-173`。 | 双 IDE 真实宿主走 conversation/code/partial rewind、PR commit freshness、macOS capability 降级旅程。      | 统一 Rewind/Delivery 协议；宿主不能实现 strict sandbox 时显式降级且不得计入安全发布门。              |

其他产品判断的证据边界：

- [VS Code 命令清单](../packages/vscode-extension/package.json) 把 Team、PR、Background、Sessions、Remote、
  Worktree、Artifacts、Policy 暴露为多个独立命令，为“入口碎片化”的产品判断提供证据，但命令数量本身不是
  可用性结论。
- 已有声明式 DAG、拓扑排序、并行、循环/重试和持久 run history，见
  [cowork-workflow.js](../packages/cli/src/lib/cowork-workflow.js)，因此没有证据支持再造第四套工作流引擎。
- `/v2` 占位面板见 [shell/CommandPalette.vue](../desktop-app-vue/src/renderer/shell/CommandPalette.vue)，legacy
  handler 面板见 [common/CommandPalette.vue](../desktop-app-vue/src/renderer/components/common/CommandPalette.vue)；
  可选的 12,000 字符文件内联见 [AIChatPage.vue](../desktop-app-vue/src/renderer/pages/AIChatPage.vue) 与
  [chatPanelHelpers.ts](../desktop-app-vue/src/renderer/shell/helpers/chatPanelHelpers.ts)。

## 四、P0：先过安全门，再完成四个用户闭环

这里的 P0 分成两类，避免把“发布阻断的安全事实”和“季度级高价值产品闭环”混成一个无限范围：

- **P0-S release blockers**：修复 authority/permission/correctness 失败会扩大能力或破坏恢复一致性的事实缺口。
- **P0-Q quarterly outcomes**：Workbench、Rewind、Delivery、真实宿主等用户闭环；可以并行开发，但扩大
  Auto/无人值守范围前必须通过相关 P0-S 门。

建议按以下最小垂直切片分工。工期可重叠、不可相加，且只表示相对量级：

| 工作流 | 性质         | 最小垂直切片                                                                   | 首责代码面                       | 估算/置信度     | 主要依赖                        |
| ------ | ------------ | ------------------------------------------------------------------------------ | -------------------------------- | --------------- | ------------------------------- |
| S0-1   | Release gate | 交互式 Plan ceiling + contract/permission + PreToolUse strict merge + 子树前置 | `packages/cli` runtime/policy    | 2～4 周 / 高    | 统一 capability/effect 语义     |
| S0-2   | Release gate | Skill worker/trust/digest + MCP effect descriptor 与调用 ledger                | CLI skill/MCP/process broker     | 4～6 周 / 中    | S0-1 的宿主裁决接口             |
| S0-3   | Foundation   | Plan/TODO 原子持久化 + WS replay + 真实语义压缩/结构化 handoff                 | CLI session/WS/compressor        | 3～5 周 / 中    | canonical event/snapshot schema |
| Q0     | Quick win    | 单一 command registry + Microsoft Marketplace exact readback                   | Desktop shells + VS Code release | 1～2 周 / 高    | release secret/manifest         |
| Q1     | Product P0   | 一个 local session 的 dispatch→needs-input→resume→artifact Workbench 路径      | IDE projection/control plane     | 3～6 周 / 中    | S0-3                            |
| Q2     | Product P0   | 同一 fixture 的 code/conversation/combined/branch 与 partial coverage          | CLI checkpoint + 双 IDE timeline | 2～4 周 / 中    | canonical checkpoint lineage    |
| Q3     | Product P0   | 一类真实项目的 diff→gate→preview→review→PR/CI fix-rerun                        | CLI evidence + IDE delivery      | 6～10 周 / 低中 | Q1、S0-1                        |
| Q4a    | Test infra   | 可复用的真实宿主 driver、fixture manifest、artifact capture                    | VS/JB E2E + release workflows    | 2～4 周 / 中    | 可与 Q1/Q2 并行                 |
| Q4b    | Release gate | 对已交付 Q1～Q3 功能运行完整宿主/远程/重启/soak 矩阵                           | Release engineering              | 持续 / 中       | Q1～Q3 与 Q4a                   |

### P0-S：安全与运行时正确性前置门

这些问题位于所有 IDE 表面之下，应视为 Workbench、Workflow、Automation 和 Auto Mode 扩大使用前的
发布阻断项。否则更统一的 UI 只会放大同一不一致行为。

#### 1. 让交互式 Plan Mode 成为不可被 `allow` 放宽的硬边界

Headless `--permission-mode plan` 已强制只读工具交集；缺口在共享 `agent-core.js` 的交互式
`PlanModeManager` 路径：没有 `executionLock` 时，settings `allow`（以及显式 host allow 的外部工具）可短路
Plan 工具限制。应复用 headless 的硬上限语义，把有效能力计算改为集合交集：

```text
effective tools
  = plan-mode hard ceiling
  ∩ managed/user/project policy
  ∩ host/environment capability
  ∩ session approval
```

任何 `allow` 只能减少提示，不能把 write、未知 effect MCP/Skill 或已分类为 mutation 的 shell/外部动作加入
ChainlessChain 的 Plan Mode。Claude Code 官方 [Permissions](https://code.claude.com/docs/en/permissions) 只承诺
Plan 不编辑源文件，并允许只读研究命令；启用 Auto 时还可运行 classifier-approved 命令。因此这里的“零未授权
mutation”是 ChainlessChain 更严格、可测试的安全目标，不是对 Claude 当前行为的逐字复制。Plan 文件自身的
写入如需保留，应使用单独窄能力，而不是放宽通用文件写入。

同时完成 Plan/TODO 原子持久化：保存 `executionLock`、revision、executing/settled、依赖、owner、checkpoint、
approval 和 evidence 关联；IDE/WS 重启不能把已批准计划恢复成更宽松状态，也不能丢失正在执行的 item。

#### 2. 封闭 Skill 的宿主进程执行边界

workspace/project/marketplace Skill 仍会被分层发现，但当前 production `run_skill` 已不再 import 非隔离
`handler.js`：该路径固定失败为 `CC_SKILL_DIRECT_HANDLER_BLOCKED`；隔离 Skill 只在 child Agent 中获得
`read_file`、`search_files`、`list_dir` 与父级 ceiling 的交集，不继承 MCP 或 process authority。无 production
consumer 的 `skill-process-broker` façade 已删除，因此历史 `shell-exec` descriptor/template 不产生权限。
若未来恢复 handler 执行，以下要求重新成为 release blocker：

- 对含 handler、binary、hook 或 embedded MCP 的 Skill 建立 source + content digest 信任记录；首次使用、
  内容变更、来源切换都重新授权，并与 IDE Workspace Trust 联动。
- handler 必须在受限 worker/child process 执行，使用显式 capability manifest，只获得声明且获批的文件、
  网络、进程、MCP 和 secret 能力；主进程只通过结构化 RPC 交互。
- 新 process façade 不得复活已删除实现；实际 policy/approval/sandbox/ledger、完整进程树 deadline 与宿主 dispose 必须由宿主重新计算和持有。
- 企业 managed 模式可禁止 workspace code handler，只允许签名/白名单来源。

#### 3. 为 MCP 建立可信度与 effect/risk contract

MCP tool 的 `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint` 等 annotations 当前没有保留到
tool descriptor。应保留并版本化，但只把第三方 annotation 当作**提示而非安全证明**：

- 来源未信任、未标注或声明有副作用的工具默认 `ask`；Plan Mode 默认拒绝未知 effect。
- 只有“可信来源 + 只读声明 + 本地策略允许”的工具才能进入 Plan/并行只读路径。
- 实际调用记录输入摘要、资源范围、网络目标、effect、结果和 ledger id；观测到的行为与声明冲突时立即
  降级、告警并要求重新授权。
- 并发调度同时依据数据依赖和 effect；两个可能写同一资源的调用不得仅凭模型判断并行。

#### 4. 将 authority-bearing contract、permission 和 Hook 异常改为 fail closed

当前 subagent contract 解析失败会令 Skill allowlist 和 permission gate 放宽，而 MCP/Hook 继承已退到空集；
后续权限 enforcement 异常仍明确按 best-effort 继续。Hook 默认短路合并时，较早的 `ask` 还可能遮住后续
`block`。建议：

- contract/permission 解析失败时拒绝 spawn，或退到最严格的 read-only、无 Skill/MCP/Hook 继承、manual gate；
  绝不能比父级更宽。
- managed/Auto/无人值守路径上的 permission enforcement 异常一律停止并产生 `needs_input`/incident artifact。
- PreToolUse Hook 默认执行所有匹配规则并采用 `block > ask > allow > continue`；managed policy 不允许降回
  首个结果短路。Hook timeout/spawn failure 的处理策略按来源和模式配置，安全强制 Hook 故障必须阻断。
- Observe-only DB Hook、PostToolUse telemetry 或通知类 Hook 可以 fail open，但必须标记 degraded、保留失败
  artifact，并且不得参与扩大权限或掩盖工具本身的失败。

#### 5. 在 mutation 前加载子目录指令

当前子树指令在 write/edit/move 已落盘后才随结果注入，delete 未走该注入路径；loader 以
`path.resolve(cwd)` 为键在进程级池中共享，并把该值同时作为 `repoRoot`/`baseDir`。应改为：

- loader 状态按 session/root 隔离；首次访问结果可以缓存，但不能跨 session 误判“已经向模型注入”。
- read、write、edit、delete、move、notebook edit 先解析目标路径并加载适用指令，再进入 policy/approval 和执行。
- 对路径型 shell/git/Skill/MCP 调用做 best-effort preflight；无法可靠确定目标且可能 mutation 时按未知 effect
  处理，而不是先执行再通知。

#### 6. 接通真实语义压缩与结构化 handoff

`PromptCompressor` 当前只有传入 `llmQuery` 才会调用摘要，但 agent loop、REPL 和 `/compact` 的标准入口只传
model/provider，因此超限主路径是 dedupe/collapse/truncate。应接入受预算约束的 provider query 和真实 tokenizer/
provider usage，并输出稳定结构：目标、约束、关键决策、已改文件、测试、未裁决副作用、Checkpoint、阻塞和下一步。

摘要失败时可以有界退回抽取式压缩，但必须记录 degraded reason，不能静默丢掉关键事实。Subagent handoff 也应
复用同一结构，而不是主要依赖少量最近 assistant 文本。

前置门验收：

- Plan Mode 在 settings allow、host allow、Skill、MCP、Hook、Git、shell 的组合矩阵下 mutation 次数为 0。
- Skill handler 内容变化必定重新授权；未信任 handler 无法在 CLI 主进程获得任意 Node 能力。
- contract/permission/hook 解析或执行失败不会得到比成功路径更宽的工具集。
- 首次 mutation 前模型/策略已经接收到目标路径的全部适用子树指令。
- WS/IDE/进程重启后 Plan/TODO/execution lock 的状态和 evidence lineage 一致。
- 长会话压缩保留冻结事实集中的目标、决策、文件、测试和阻塞；provider/token 使用可追踪，失败显式降级。

### P0-0：可信入口与分发快赢

目标是在不改底层 runtime 的前提下，先消除“入口看得见但不能稳定完成”的问题。

范围：

1. 建立 Desktop 单一 command registry，让 legacy、`/v2` 和 `/v6-preview` 消费同一 title、category、handler、
   availability、permission 和 telemetry；移除 `/v2` 的 `console.debug` 占位行为。
2. 从单一 capability manifest 生成/校验 IDE 命令、Doctor、README、最低 CLI 版本和发布说明，修复
   JetBrains README 与已发布能力不一致的问题。
3. 在 GitHub Actions Environment/Organization Secret 中配置 `VSCE_PAT`，把同一经过验证的 VSIX 实际发布到
   Microsoft VS Code Marketplace；PAT 不得进入仓库、日志或 artifact。公开回读必须验证 exact version、
   publisher、digest 和可下载性，不能只停留在凭据 preflight 或发布方案。

验收：

- Command Palette 中不存在没有明确 disabled reason 的空动作；核心命令全部有一条真实执行测试。
- capability manifest 与 VS Code、JetBrains、Desktop 的公开入口无漂移。
- Microsoft Marketplace 能从干净的 stock VS Code 搜索、安装、升级和回滚；不能用 Open VSX 结果代替。

### P0-1：统一 Session-Centric Agent Workbench

目标是让用户在一个界面完成“发起、观察、介入、审阅、恢复、交付”，而不是在多个命令间寻找状态。

建议布局：

- 左侧：按 `needs_input / working / blocked / done / failed / stopped` 分组的 session/workflow 列表，支持
  project、environment、owner、worktree、PR 状态过滤。
- 中间：Chat、Plan、Tasks、Subagents、Diff、Terminal、Preview 等可切换 pane。
- 右侧：Context、Permission、Side Effects、Artifacts、Cost、Checkpoint、PR/CI 证据。Workbench v1 只读取
  canonical projection 并展示规则/资源摘要；交互式解释、最小 scoped rule 与 rule revoke 属于 P1-4。
- 行级动作：dispatch、peek、reply、attach/detach、stop、takeover、checkpoint、archive。

实现原则：

- 复用现有 `sessions-workbench`、background、team monitor、remote control、artifact、policy 和 PR 状态
  projection；不在 IDE 内复制 authority 数据库。
- CLI/control plane 是唯一可写权威源，IDE 只通过带 authority/lease/evidence fence 的命令执行变更。
- 将 Local、Background、Team、Workflow、Remote、Cloud 归一到同一 lifecycle，但保留各自 capability，
  不伪造不支持的 pause、resume 或 rollback。

验收：

- 所有活跃任务都能映射到一个 canonical session/workflow id，不重复、不丢失、无双 writer。
- `needs_input` 从运行时产生到 IDE 可见的 P95 小于 2 秒；断线重连后状态和原绑定仍一致。
- VS Code 与 JetBrains 使用同一状态 fixture；Desktop/Web/Mobile 可逐步消费同一 projection。
- 关闭并重启 IDE 后，working/waiting/done、approval、artifact、worktree 和 PR 关联可恢复。

### P0-2：IDE 完整 Rewind、Summary 与 Branch

Claude Code CLI 的 [Checkpointing](https://code.claude.com/docs/en/checkpointing) 把每个 prompt 变成可选时间点；
`/rewind` 提供恢复代码与对话、仅对话、仅代码和两种定向总结，`/branch` 则是独立命令。官方
[VS Code](https://code.claude.com/docs/en/vs-code) 图形界面只公开三个消息级动作：从这里 fork 对话、回退代码、
fork 对话并回退代码；[JetBrains](https://code.claude.com/docs/en/jetbrains) 没有声明图形化 Rewind。
ChainlessChain 的底层 Checkpoint 已有较强 primitive，本项是把完整 CLI 能力统一产品化到双 IDE，而不是声称
Claude 两个 IDE 已经拥有同一套菜单。

范围：

- 在消息时间线上显示 checkpoint、commit、tool side effect、artifact 和 verification marker。
- 对每个 checkpoint 提供：`恢复代码`、`恢复对话`、`同时恢复`、`从这里总结`、`总结到这里`、
  `从这里创建分支`。
- 保留现有 restore diff preview，并增加 `full / partial / none` 覆盖、排除路径、外部 Git metadata、
  数据库/网络/消息/部署等不可回滚副作用说明。
- Worktree/Team 改动不在当前 session checkpoint 内时，必须引导 Git/managed recovery，不能显示虚假的成功。
- 将 shell 直接改文件、后台任务/Subagent 改动、外部进程改动、symlink/hardlink 等纳入 coverage fixture。
  Claude 官方 Checkpoint 明确不保证恢复这些类别；ChainlessChain 必须按自身实际捕获结果显示覆盖，不能照搬文案。

验收：

- 对话指针、文件内容、checkpoint lineage 和新 branch 的确定性 fixture 全部通过。
- 任一 partial/none 恢复都明确列出未恢复资源；不可逆副作用不得只用通用 warning 隐藏。
- VS Code、JetBrains 与 CLI 对同一 session 的可用动作和执行结果一致。

### P0-3：从改动到 PR 的 Evidence-Driven Delivery Loop

这是一个有意合成的 ChainlessChain 目标：借鉴托管 Code Review 的多 Agent 验证/去重/分级，以及 Desktop 本地
Diff Review 的回复与要求修订，但 Claude 当前没有把二者合成一个 surface，托管 Review 的 GitHub 回复也不会
自动触发修改。报告因此对齐的是用户结果，不把它写成现成的单一 Claude parity flow。

目标流程：

```text
Plan/Diff
  -> 影响分析
  -> 最小安全 gate（test/lint/type/build）
  -> Preview（DOM/console/network/screenshot）
  -> Code Review
  -> fix + rerun
  -> PR + CI
  -> 受控 merge / artifact / archive
```

范围：

1. 根据 changed files、依赖图、语言服务、测试历史选择 impacted gates；无法可靠选择时回退到项目定义的
   全量关键门，而不是为了速度跳过验证。
2. 将测试失败、诊断、Preview DOM/console/network/screenshot 与具体 diff hunk、turn、tool call 关联。
3. 提供高信号多 Agent review，结果去重、分级并可定位到行；允许用户回复、要求修复或标记已知风险。
4. 在 IDE 内创建 PR、显示 CI 日志和失败映射、自动触发受限 fix/rerun。
5. Auto-merge 必须同时满足仓库允许、全部 required checks 通过、策略允许、无未裁决副作用和用户显式配置；
   任一信号不确定即 fail closed。若对齐 Claude Desktop，还要明确 GitHub auto-merge 前置条件与 squash-only
   行为；ChainlessChain 若支持其他 merge method，必须由仓库策略显式授权。

验收：

- 每次“完成”都附一份不可变 evidence artifact：commit/diff、执行环境、gate、结果、review、未验证项和 PR。
- 失败 gate 能定位到相关文件/测试并进入修复重跑；达到最大轮次或无进展时停止并说明原因。
- CI 状态来自目标 commit，不得复用旧提交或部分 matrix；merge 后自动归档不删除未推送/未提交 worktree。

### P0-4：真实 IDE 用户旅程作为发布门

当前 VS Code Extension Host smoke 主要验证激活、命令注册和 Bridge/lockfile；JetBrains Robot smoke 主要验证
Tool Window、Tab、输入框和 Send/Stop。它们能证明插件“能启动”，不能证明核心工作流“能完成”。

实施时拆成两段：Q4a 的 host driver、fixture manifest 和 artifact capture 可与 Workbench/Rewind 并行；Q4b
针对完整功能的 release gate 必须在对应 Q1～Q3 垂直切片可用后运行，不能用“并行建设测试基础设施”宣称
尚未实现的用户旅程已验收。

最低发布旅程：

1. 首轮消息、流式输出、Stop、retry、IDE 重启后 resume。
2. Plan 打开、行内评论/修订、批准进入执行。
3. create/modify/delete/rename 多文件 Diff、用户编辑、pick hunks、request changes、漂移保护。
4. permission/elicitation、`needs_input`、断线重附后原请求回答。
5. Terminal/selection/diagnostic/test/debug/notebook/preview context。
6. Rewind preview 与至少一种 partial coverage；Artifact 与 PR/CI 证据回读。
7. Plugin/MCP/LSP 启停、升级失败恢复和 workspace trust 降级。

宿主矩阵至少覆盖：

- VS Code stable + minimum，Windows/Linux/macOS，干净 profile；Microsoft Marketplace、Open VSX 和 VSIX。
- WSL、SSH、Dev Container/Codespaces，多根、多窗口、IDE restart、CLI/Bridge restart、网络抖动。
- JetBrains minimum + current，Windows/Linux/macOS，Gateway/Remote Development。
- 一组 8 小时重连/恢复 soak；与现有 Agent Team 120 分钟双进程 soak 分开记录，不能互相替代。
- macOS strict-sandbox CI 当前固定旧宿主以保留 `sandbox-exec`；应为新版 macOS 提供替代后端，或在 capability
  协商中明确降级并禁止把它计入 strict/Auto 安全保证。
- 增加 nightly live-provider trajectory：长上下文压缩、取消/恢复/审批竞态、真实 tool sequence 和失败注入；
  现有 deterministic Team soak 继续作为调度证据，但不能替代真实模型轨迹。

## 五、P1：复用现有底座做产品化

### P1-1：Dynamic Workflow 收敛，而非新增引擎

现有 `cowork-workflow.js` 已具备 DAG、并行、循环、重试、变量和 run history；Team/Batch 又提供 worktree、
预算、lease 和人工治理。因此应收敛为一个 workflow runtime façade，而不是新增第四套编排状态。

建议补充：

- 用户用自然语言要求 workflow，Agent 生成可读的阶段计划和受限脚本/DSL；运行前可看 raw definition、成本/规模
  估算和资源权限，并可“一次允许 / 此项目长期允许 / 拒绝”。
- Workbench 展示 phase、agent、状态、token、耗时、budget、最近 tool/result；支持 pause/resume/stop/restart。
- 成功运行可保存到项目或个人范围、版本化、代码审阅，并通过 plugin/marketplace 分发。
- workflow 的 permission、sandbox、side-effect ledger、checkpoint、artifact 必须复用普通 session 规则。
- 大规模 fan-out 设置硬上限和软 size guideline，显示 projected token/USD，并在异常膨胀时告警或按策略停止。

Claude Dynamic Workflows 当前除 permission prompt 外不支持阶段间一般用户输入；如果 ChainlessChain 增加
`needs_input`/reply，这是明确的扩展能力，必须定义暂停点、缓存失效和恢复幂等语义。

退出条件：同一 versioned definition 在声明的 host/environment 矩阵中可重放；暂停/恢复后阶段最多提交一次；
token/time/budget 与 artifact lineage 可回读；未知能力或超预算不能静默继续。验收重点不是“能跑 1000 个
agent”，而是同一 workflow 可读、可审、可复现、可暂停、可计费和可恢复。

截至 2026-08-15，仓库内 definition/preflight 子切片已由 commit `58bfdceb84` 实现。它没有新增 scheduler，
而是在现有 Cowork DAG 上增加 `cc-dynamic-workflow-definition/v1` 与
`cc-dynamic-workflow-preflight/v1`：`cc cowork workflow manifest|preflight` 可输出绑定 SHA-256 digest 的 raw
definition、批次/步骤计划、实际使用能力、最坏任务调用数，以及 token、USD 和按 DAG 批次/重试计算的预计耗时。
manifest 明确声明当前 runtime 的 durable pause/resume、恢复后 exactly-once 与阶段间 `needs_input` 均不成立，
history durability 仍为 `best-effort`，不得由 façade 名称外推不存在的保证。

preflight 在启动前核对 engine capability、Execution Location、permission、sandbox、network policy、data
boundary 与仅含 name/source/scope 的 credential reference；未知动态 fan-out、未观测 authority、未知 capability、
凭据缺失和 token/USD/time/parallel 超预算均 fail closed。任务调用采用 16 的 soft guideline 与不可由 workflow
配置放宽的 64 硬上限；`facade.requirements.credentials` 内出现 credential value/API key 时拒绝生成 manifest。

随后 commit `b6dc772384` 关闭版本化持久 definition 与 exact replay 仓库子门。新保存使用
`cc-cowork-workflow-record/v1` current envelope，并先写入按 SHA-256 命名、内容校验的 immutable version；旧裸 JSON
只以 `legacy-unversioned` 兼容读取，不能在 preflight 中冒充 versioned authority。读取限制为 1 MiB、regular
single-link、固定文件描述符和工作区内 realpath，workflow id 不能路径穿越；current 被删除后 version archive 仍保留。
`cc cowork workflow versions` 可列出 digest，`manifest|preflight|run --definition-digest` 与 WS save/get/run 使用同一
definition authority，run record/history 也写入 exact digest，错误 pin 在 task 执行前失败。

commit `c5f14a2105` 又关闭了“可展示 preflight、但真实 run 可绕过”的执行入口：CLI 与 WS 现在只能以宿主侧
resolver 重新读取 exact versioned definition 和 verified `session_start` execution-location authority，执行前完成
prepare/final 双重校验，并把 definition、location、execution policy 与 admission digest 固定到严格 run record。
permission、sandbox、network、data boundary、credential、预算、并行度或 authority 任一不成立时，均在
`workflow:started`、task runner 与 history 写入前 fail closed；WS 消息不能自报 binding 或 credential value。
全局 semaphore 覆盖普通 step、batch/pipeline、literal/runtime `forEach`、loop 与 retry；timeout 会发出
`AbortSignal` 并等待物理 task settle 后才释放 permit，runner 若永久忽略取消则 workflow 保持 pending，且不写
虚假 terminal/history。定向回归为 6 files、192/192，独立终审无 blocker/high。

这些提交关闭可读预检、版本化保存、单机 exact replay 和执行前强制 admission 子门，但 run history 写入仍为
best-effort；现有 ambient session 若缺少可验证 permission/sandbox/network 事实会诚实阻断，不能把结构化
`verified-session-start` 外推为真实宿主 attestation。运行中
pause/resume、恢复后阶段最多一次提交、artifact/ledger/checkpoint lineage、Workbench/双 IDE 消费、跨 host 矩阵和
plugin/marketplace 分发仍未完成，manifest 也继续明确不承诺 durable resume、exactly-once 或阶段间
`needs_input`。因此 P1-1 整体保持部分完成。

### P1-2：Execution Location 成为一等会话属性

Claude Desktop 当前明确的一等环境是 `Local / WSL / SSH / Cloud`。ChainlessChain 应先把这四类做成可理解、
可比较、可交接的会话属性；`Container` 是可追加的 ChainlessChain 扩展目标，不应写成 Claude 当前独立选择器。
创建 session/workflow 时显示：

- 文件与 Git 的实际位置、支持的工具、模型/credential 来源、网络策略、sandbox 强度和数据边界。
- 预计启动延迟、持续运行条件、成本、可用 connector、是否支持 Preview/Computer Use。
- “继续到另一环境”时的 commit、未提交 diff、session summary、artifact 和 permission handoff 预览。

Remote Control 是“远端界面控制本机执行”，Cloud 是“远端基础设施执行”，两者必须在产品文案和协议中明确区分。
跨环境不能安全迁移未提交状态时，应要求 commit/stash/export patch，而不是承诺无损切换。

现有 distributed Agent Team queue 依赖可信共享文件系统，不是网络分区下的共识服务。它足以服务本机/受控共享
存储场景；若目标扩为跨网络远程团队，应引入具备 lease fencing、幂等 claim、durable mailbox 和分区恢复的
真正队列后端，或明确维持当前产品边界，不能直接把本地 soak 证据外推到远程一致性。

退出条件：每类声明支持的环境都有 versioned capability manifest 和 launch/resume fixture；环境切换前后 commit、
diff、summary、artifact 与 credential/permission 交接可审阅；不支持的工具、sandbox 或数据边界必须在启动前阻断
或明确降级，不能静默转移 secret 与未提交状态。

截至 2026-08-15，仓库内 contract/authority 子切片已实现：`cc-execution-location-binding/v1` 在 headless、stream、
Agent REPL 与 chat REPL 创建新 JSONL session 时采集当前进程的 Local/WSL/SSH/Container/Cloud 环境信号、实际
工作目录与可验证的 Git root/head/commit，并由 `session_start` hash chain 固定；旧 session 缺少 binding 时明确
fail closed，不以当前主机事实回填。`cc session location current|show|compare` 通过版本化 catalog 区分当前已观测、
需配置与未实现能力；Container 明确标为 ChainlessChain 扩展，Remote Control 明确只是控制本机执行的 control plane。

同一子切片增加 `cc session location handoff <id> <target> --facts <path>`：有界、拒绝 symlink 的 facts reader 和
`cc-execution-location-handoff/v1` 预览要求目标配置 evidence、Git clean commit 或 dirty stash/patch、summary、
permission、artifact、network、sandbox、data boundary 与所需 capability 全部可审阅，并绑定 exact
sessionId/headHash/eventCount 与 Git base；credential 只保留
name/source/scope，值永不进入投影。该实现关闭仓库内版本化 binding、比较与 fail-closed handoff preview 子门，
不关闭真实 WSL/SSH/Cloud/Container launch/resume、跨宿主 authority/evidence 继承、Preview/Computer Use、IDE/Desktop
创建面或远程/故障/长期宿主矩阵，P1-2 整体仍为部分完成。

### P1-3：Automation Center

把已有 `cc routine`、`cc agenda`、`cc loop`，以及 `cc agent --channels` 与现有 schedule/cron 原语做成统一
IDE/Desktop 控制面：

- trigger：schedule、one-shot、API/webhook、GitHub event、channel event。
- execution：local、always-on daemon、remote/cloud，并显示离线时行为。
- control：创建、编辑、run now、暂停/恢复 schedule、history、失败重跑、禁用、删除；正在运行的 task 只有
  runtime 明确支持 pause/resume 时才展示对应动作。
- security：仓库/branch、network、secret、connector、write scope、预算和最终交付动作。
- attention：`needs_input`、失败、预算、PR/CI 完成通过 IDE/desktop/mobile 通知，但不把通知本身当作审批。

Claude Routines 启动自主 Cloud session，没有运行中 permission picker；这使启动前边界尤其重要。ChainlessChain
无人值守任务不应在运行中临时扩大权限；启动前必须完成可执行权限包的 preflight，运行中越界则停止或转
`needs_input`，不能静默 bypass。

退出条件：同一 trigger 重放不会重复交付；明确 missed-run/离线/时区/DST 策略；run-now、禁用、失败重跑和
history 的状态一致；secret/connector/write scope 越界为 0，越界时有绑定原 run id 的可恢复 incident。

### P1-4：Context 与 Permission 两个可解释中心

Context Center：

- 将 selection、active file、open tabs、diagnostics、Git diff、terminal selection、test/debug、preview evidence、
  memory、MCP resource 显示为 chips。
- 每项显示来源、范围、freshness、token/cost，可 pin/remove/refresh；自动选择必须能解释“为什么加入”。
- Legacy 与 `/v2` 的 “Include current file” 不再只有 12,000 字符整文件内联路径；优先 selection、symbol、
  relevant hunks 和结构化 diagnostics，并保持默认关闭。`/v6-preview` 应消费同一 context contract。

Permission & Side Effect Center：

- 显示最终决策、规则来源与优先级、精确文件/网络/进程/credential 资源、有效期和调用链。
- 允许为当前请求生成最小 scoped rule，但只能通过 CLI authority 修改；IDE 不直接写策略文件。
- 将“允许执行”和“可回滚”分开表达，数据库写入、消息、发布、部署、支付等外部动作单独标识。

退出条件：固定 token budget 下 context 选择与裁剪结果确定；每个 chip 的 source/freshness/range 可回读；
规则优先级解释与 CLI authority 结果一致；新增 scoped rule 可 diff、定时失效和 revoke，且不能放宽 managed deny。

截至 2026-08-15，Permission Center 第一子切片已实现：CLI authority 在仓库外的 owner-only security state
保存 workspace 绑定、TTL 到期和 revision/generation CAS 的 scoped rule；REPL、headless、stream、WS 与子 Agent
在每次工具调用前重新解析 authority，撤销、到期或存储损坏分别即时生效或 fail closed。VS Code 与 JetBrains
展示 rule source/status/expiry/revision，并且只通过经过校验的 `cc permissions scoped|revoke` argv 修改 authority；
managed-only 与 deny 优先级继续收紧，不能被 workspace rule 放宽。

同日，Context Center foundation 子切片已实现：VS Code 与 JetBrains 通过同一
`cc-context-center/v1` contract 和 `priority-stable-v1` 算法返回稳定 chip id、source、scope、range、freshness、
estimated/allocated token、include/trim/remove 状态和自动加入原因；pin/remove/refresh 意图在每次请求中显式传入，
固定 budget 下的排序与 UTF-8 裁剪由同一 JSON fixture 在 Node/Java 两端验证。双 IDE 当前从宿主实时采集 selection、
active file、open tabs、diagnostics、terminal、test/debug 与 preview evidence，并把能力发布为
`getContextCenter/context_center`；Chat 的 `@context` 以固定 4,096-token budget 消费该 projection，并在注入前执行
secret-shaped text redaction。

随后完成的 UI 子切片在双 IDE 增加 Context Center 入口：VS Code 以可键盘操作的 Quick Pick chip 列表展示，
JetBrains 以 project dialog 的 chip 列表与 detail pane 展示；两者都可 pin/unpin、remove/restore、refresh、设置固定
token budget 和 reset。偏好分别保存到 workspaceState 与 project PropertiesComponent，默认 `getContextCenter`
自动消费持久偏好，显式 MCP 参数仍可按请求覆盖；损坏、越界或重叠状态被规范化，removed 始终优先于 pinned。

Context source 子切片也已完成实际采集：VS Code 通过内置 Git API，JetBrains 通过 VCS change list 生成有界 patch/hunk；
双 IDE 只读取 realpath 仍位于 workspace/project 内的 `cc.md`、`CLAUDE.md`、`AGENTS.md`、
`.chainlesschain/rules.md` 与直接 `.claude/rules/*.md`，单文件上限 64 KiB、最多 20 项；MCP resource 通过 canonical
`cc mcp resources --json` 读取连接目录并缓存 30 秒，只把 server/URI/name/description/MIME 元数据转为 chip，绝不自动
调用 resource read 或注入正文。该外部来源 contract 由同一 JSON fixture 在 Node/Java 两端验证，各来源失败独立降级。

Desktop consumer 子切片也已完成：legacy、`/v2` 与默认 `/v6-preview` 统一通过 browser-safe
`cc-context-center/v1` twin 生成固定 budget projection；显式 selection、结构化 diagnostics 与 Git diff 存在时不再
回退整文件，否则 active file 仍按 budget 做 UTF-8 安全裁剪。三条路径均保持开关默认关闭、只丰富发往模型的临时
prompt、持久化和展示原始用户消息；任一 context 收集或 Web Crypto 失败均降级为原始 prompt。`/v6-preview` 在用户
点击文件后通过 `project:get-file` 延迟取正文，并用请求令牌防止快速切换时旧响应覆盖当前文件。Desktop twin 复用双 IDE
JSON fixture 验证稳定 ID、排序、budget 和裁剪结果。

Permission & Side-effect explanation 子切片也已实现：CLI 新增版本化
`cc-permission-side-effect-center/v1` 投影与 `cc permissions activity --session <id> --json`；REPL、headless、stream
与 WS 的标准副作用 ledger 记录有界文件、网络 origin、可执行程序/runtime 和 credential **变量名**，MCP 调用复用其
verified ledger 的 resource/network scope 与 host effect contract。投影把实际 effect 与 permission decision、rule/source、
session/turn/tool-call、TurnBinding checkpoint 和 `redo|inspect|skip` 恢复动作关联；本地 checkpoint 只可覆盖有证据的
文件资源，网络、进程、credential 与 host-owned MCP 资源会保守降级为 `partial|none|unknown` 并逐项列入未恢复资源，
“允许执行”与“可回滚”不再混写。credential 值、URL userinfo/query、文件正文和完整 shell command 不进入投影；旧 ledger
缺少 target 时明确显示 unresolved，不伪造资源。VS Code 与 JetBrains Policy Viewer 均读取当前 Chat session 的同一 CLI
投影并显示不可逆标记、决策来源、调用链与恢复覆盖。

P1-4 仍未整体关闭：上述仓库内可解释中心已完成，但长期并发、真实宿主、故障注入和跨入口凭据不泄露/恢复诚实性矩阵
仍待完成；不得把本地单元/烟测外推为这些环境门已经通过。

### P1-5：Marketplace 发现与组织治理

在现有签名、SBOM、策略和升级恢复基础上，补齐：

- 多来源检索、版本/兼容性/健康度、依赖图、license 与权限摘要。
- 安装前 diff、更新影响、来源切换、离线缓存来源和失败回滚证据。
- private registry、组织签名/撤销、代理/离线、依赖冲突和供应链故障注入的真实环境矩阵。

退出条件：每个安装候选展示 digest/signature/SBOM/license/capability；干净环境可完成安装、升级和回滚；签名撤销、
来源切换、依赖冲突、代理中断与 private registry 故障均 fail closed 并保留可复核 artifact。

2026-08-15 完成 Marketplace catalog 治理子切片（实现 commit `392ed39d24`）：CLI 新增版本化
`cc-plugin-marketplace-catalog/v1` 与 `cc plugin catalog [query] --registry <url>`，支持最多 16 个可重复来源，
把 online/cached/unavailable 来源健康、候选 manifest digest/signature、plugin-files SBOM、license、能力摘要、
宿主兼容性和已安装依赖检查投影到同一确定性 catalog digest；依赖图显式给出 candidate/installed nodes、range edge、
未解析/版本不符状态和环。单来源最多 2,048 个候选、单候选最多 128 个依赖、全图最多 65,536 条边；重复来源和
同名同版本却 package/integrity 不同的多来源冲突 fail closed。`--strict` 还会因来源不可用、治理元数据缺失、
依赖/宿主不兼容或 publisher-declared unhealthy 返回非零。registry URL、SBOM/signature URL 和错误文本会移除
userinfo/query/hash 与 bearer token；输出明确标注 registry metadata 未验证、未下载 plugin bytes、未执行代码，
manifest 签名和 SBOM 的真实校验仍只在 install/load 阶段发生。

随后完成的执行绑定子切片（实现 commit `b93f354679`）新增
`cc-plugin-marketplace-install-preflight/v1`：registry `add/upgrade` 在 clone/process 前强制消费所选候选的 catalog
authority，阻断无效 integrity、缺失/错版依赖、宿主不兼容、异常 publisher health 与危险来源；旧 registry 仅缺
version 时可明确延迟到 plugin manifest，但候选 name 和已声明 version 必须与 fetched manifest 精确一致，否则在
落盘前失败。成功安装把 catalog digest、candidate id、governance/registry/version authority 写入 installer-owned
`.plugin-source.json`；upgrade 只有在 active immutable bytes 回读到同一 authority 后才 finalize，同版本旧 bytes
缺 authority 时要求 `--force` 重取并验证，事务失败恢复原 active version。hash-only manifest 校验不再写出未签名
的 signature lock，也会对 staged manifest 重验 digest；只有真实 Ed25519 验证才生成绑定 component SBOM 的 lock。

更新影响子切片（实现 commit `07f4d41fa6`）又新增 `cc-plugin-marketplace-update-impact/v1` 与
`cc plugin impact <name> --registry <url>`：以当前 active immutable install 为基线，对 registry candidate 的
version、registry/resolved source、manifest/signing-key/SBOM digest、license、capability widening 和 dependency
range 做确定性 diff；输出 stable impact digest、blocker 与 source-switch/downgrade/capability approvals，并明确
candidate metadata 未验证、未下载/执行 candidate bytes。candidate/content digest 不受 observation time 影响；
registry `upgrade` 可用 `--expected-impact-digest` 绑定已审阅 exact diff，来源 authority 改变或降级分别要求
`--allow-source-switch` / `--allow-downgrade`，批准过的 impact digest 随 catalog authority 写入 immutable
provenance。真实 loopback journey 已覆盖 v1→v2 同 registry digest-pinned upgrade，以及 v2→v3 跨 registry
先阻断、显式批准后事务完成并回读 provenance。

统一候选选择子切片（实现 commit `6bd8c11271`）新增 `cc-plugin-marketplace-candidate-selection/v1` 与
`cc plugin select <name> --registry <url>...`：在最多 16 个 exact registry sources 上先生成同一 catalog authority，
再按最高版本、同版本输入来源优先级确定候选；任一请求来源不可用、最高候选有冲突/依赖/兼容性 blocker，或同名候选超过
1,024 个时均 fail closed，不会静默忽略来源或降级回退。selection digest 不含 observation time，并绑定 source set、
catalog 与全部候选 digest；`add/impact/upgrade` 均消费可重复 `--registry`，`--expected-selection-digest` 在 clone 前
阻断 stale review，selection digest/source count 随 catalog/impact authority 写入 immutable provenance。真实 Commander/
loopback journey 已覆盖 v1/v2 跨 registry 选择、stale digest 零落盘阻断、v1→v2 显式来源切换事务及 provenance 回读。

本地 artifact evidence 子切片（实现 commit `3d171256fb`）新增 `cc-plugin-marketplace-artifact-readback/v1` 与
`cc plugin evidence <name>`：安装 provenance 会保存 registry-declared manifest digest、license、signing-key digest
和 SBOM format/digest expectation；命令从 active immutable install 重新读取 manifest bytes/license、重验 Ed25519
签名与 signature-bound component SBOM，并在 10,000 文件、单文件 64 MiB、总计 1 GiB 上限内重算排除 installer metadata
的 `cc-plugin-marketplace-payload-sbom/v1`。可比字段输出 exact match/mismatch；在该本地 readback 子切片中，CycloneDX
等未抓取远端 SBOM 明确是
`not-comparable`；stable evidence digest 不含 observation time。真实 Commander journey 已覆盖四项 `matched`、篡改后
manifest/license/signature/payload-SBOM 四重 blocker 与 exit 2，以及普通 registry install 的诚实 `partial` 状态。

远端 artifact activation-preflight 仓库内子切片（实现 commit
`6b7e183c33f8c9d8a3509cac9e27f5401a5c9104`）又新增
`cc-plugin-marketplace-remote-artifact-evidence/v1`。当 catalog 给出完整 signature URL、public-key URL/SPKI
SHA-256，或 SBOM URL/显式 document SHA-256 时，registry `add/upgrade` 会在 activation/finalize 前有界抓取；
artifact 与 redirect 必须保持在用户所选 registry 的 exact origin，registry token 也只发送到该 origin。抓取结果会校验
signature/public-key document digest、public-key SPKI 与 SBOM document digest；installer 随后对 staged manifest 执行
Ed25519 验证，并按 expected digest/SPKI 重验同一 signature/key bytes，避免 fetch→install 间文件替换。版本化 evidence
随 catalog authority 写入 immutable provenance，`cc plugin evidence` 会复核 evidence digest/origin/URL，并把远端 signature
证据绑定到当前 installed signature lock。Marketplace add/upgrade 只在 authority 持久化后 finalize；错误 signature/SBOM、
CLI 与 registry manifest digest 冲突或 evidence 持久化失败均不会激活候选，fresh add 会移除，upgrade 保留原 active
version。内容寻址缓存以同目录临时文件、fsync 与独占发布落盘，读取时重验；旧式 `sbom.url + digest` 继续作为 payload
assertion，不冒充远端 document verification。

该提交仍不关闭 P1-5 整项。它不验证 registry/publisher identity，不建立 publisher/组织 trust root，也没有组织 key
revocation feed、epoch 与长期传播；`publisherIdentityVerified` 仍为 `false`。远端 SBOM 在 readback 中只是 install-time
document-digest evidence，不重新抓取，也未与当前 payload 做语义比较。仍缺真实 private registry TLS/auth、代理/PAC/
custom CA、air-gapped/offline upgrade、依赖冲突，以及网络中断、registry outage、cache corruption、撤销和供应链攻击的
完整 fault matrix 与干净外部环境 install/upgrade/rollback。

## 六、P2：体验和差异化

1. **因果可观测性（已完成，2026-08-13）**：已把 token/USD、retry、tool latency 关联到受验证的
   session 与 diff、gate、artifact、PR/merge 结果，支持按 workspace/team/policy 导出和 fail-closed
   预算告警；关闭证据见实现 commit `2e5036922e27d4b11eeb3007e91d8400555c87aa` 与本文件末尾记录。
2. **自动 ghost-text completion（已完成，2026-08-12）**：双 IDE 已在默认关闭的独立开关和预算下实现
   debounce、cancel、exact-context dedupe/cache、局部上下文、P50/P95 SLO 与质量回退；手动补全入口保持兼容，
   自动路径超时或质量不合格时 fail quiet，不阻塞主 Agent 体验。关闭证据见 PR #178 与本文件末尾记录。
3. **多 Agent 合并审阅（完成；PR #191 合并后生效）**：已提供 merge 前 hunk/file 选择、冲突解释、
   跨分支 batch checkpoint、受控 rollback 与双 IDE 严格 evidence 消费；关闭证据见本文件末尾记录。
4. **可访问性与性能**：键盘全路径、屏幕阅读器、焦点恢复、长会话虚拟化、大 diff/大日志/100+ session 压测。
5. **WebIDE 定位决策**：若没有独立“浏览器 IDE”商业目标，应把当前固定 HTML/CSS/JS playground 收敛为
   Preview/Artifact 面板；只有确认投入后才补仓库树、搜索、诊断、Git/Diff、Terminal 和 session 绑定。

## 七、推荐实施顺序

以下工期按 3～5 名熟悉现有 CLI/IDE 协议的工程师估算，只用于排序和依赖规划，不是发布日期承诺；并行项会重叠，
不能把各行简单相加。细分工作流的置信度见第四节。

| 阶段              | 建议周期        | 交付物                                                                                         | 退出条件                                                             |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| S0：安全正确性    | 3～6 周并行     | S0-1～S0-3 的 Plan/contract/Hook/subtree、Skill/MCP、持久化/压缩最小切片                       | 版本化安全矩阵与冻结事实集通过；authority-bearing 失败不扩大能力     |
| R0：可信入口      | 1～2 周         | Command registry、capability manifest、Microsoft Marketplace 实际发布与 exact public readback  | 无占位动作；stock VS Code 可搜索/安装；version/publisher/digest 一致 |
| R1：统一控制面    | 3～6 周         | Workbench v1、canonical session projection、核心动作、完整 Rewind/Summary/Branch               | 单入口完成 dispatch→介入→恢复；双 IDE fixture 一致                   |
| R2：工程闭环      | 6～10 周        | impact gates、Preview evidence、合成 review loop、PR/CI fix-rerun、受控 merge                  | 一次真实变更从 prompt 走到绑定 exact commit 的可审计 PR/merge        |
| R3a：验收基础设施 | 2～4 周，可并行 | 真实 VS/JB host driver、fixture manifest、失败 artifact capture、Remote/多根/重启/soak harness | 基础设施可稳定重放已实现的 journey；失败可诊断                       |
| R3b：发布门       | R1/R2 后持续    | 对 R1/R2 功能运行声明的 stock/minimum/OS/remote 矩阵；不再承担 Marketplace 首发                | 每个 required journey 在 exact release commit 上通过；不得提前宣称   |
| R4：规模化        | 10～16 周       | Dynamic Workflow façade、Execution Location、Automation Center                                 | 可审阅、可预算、可暂停恢复且权限预检有界的本地/远端自动化闭环        |
| R5：差异化        | 后续版本        | 交互式 Context/Permission Center、Marketplace 图、因果观测、completion、a11y/perf              | 以本节量化指标和企业试点关闭                                         |

依赖关系应保持为：

```text
security/correctness gate + canonical session/event/evidence schema
  -> unified workbench + rewind
  -> verification/review/PR delivery
  -> workflows + automation + environment handoff
  -> enterprise governance and causal analytics
```

如果资源有限，优先完成 S0 与 R0～R2。它们比继续增加新命令或新 Agent 类型更能改变用户对产品成熟度的判断。

## 八、建议的架构约束

```text
VS Code / JetBrains / Desktop / Web / Mobile
                  |
       command + projection protocol
                  |
       CLI / Control Plane（唯一写权威）
                  |
 Session | Workflow | Permission | Evidence
                  |
    Local | WSL | SSH | Cloud | Container*
```

`Container*` 是 ChainlessChain 的扩展环境，不是 Claude Desktop 当前独立的一等选项。

1. **一个权威源**：IDE 不直接改 session/team/workflow authority 文件，所有写操作经过 CLI 的 CAS、lease、
   policy 和 side-effect fence。
2. **限制只能收紧**：Plan、managed policy、parent contract、Skill/MCP capability 和 host capability 按交集计算；
   任一解析/加载/enforcement 失败不得扩大权限，路径指令必须在 mutation 前生效。
3. **一个事件语义**：turn、tool、approval、question、checkpoint、artifact、verification、PR 都使用稳定 id、
   correlation 和可回放事件；UI 可以不同，事实不能不同。
4. **能力协商而非猜测**：宿主、CLI 版本、远端环境和插件通过 capability manifest 协商；缺能力时显示明确
   degraded reason。
5. **恢复承诺分层**：文件快照、Git、managed writer、conversation、外部副作用分别报告；永不把 partial
   写成 full。
6. **自动化默认有界**：并发、token/USD、wall time、network、credentials、write scope 和 merge 权限都有
   硬上限或策略上限。
7. **压缩可审计**：语义摘要、结构化 handoff 和 context 裁剪记录来源、模型、token、保留/丢弃类别和
   degraded reason，不能让长会话在无提示时丢掉安全约束。
8. **发布证据独立**：代码存在、测试通过、真实宿主通过、公开发布回读分别记录；不可互相替代。

## 九、统一验收指标

先建立共同的 metric contract，再把百分比或 P95 设成 release gate：

1. 新建版本化 fixture/corpus manifest（建议 `tests/fixtures/ide-roadmap/manifest.json`），固定 case id、输入、
   expected outcome、seed、fixture digest、release commit、host/CLI/OS/transport 和参考硬件；运行产物回写 manifest
   version，不能只给“全绿”截图。
2. 每项明确 `required` 或 `advisory`。P0-S、CI commit freshness、不可逆交付和 Marketplace exact readback 从首版
   即为 required；性能阈值可先收集两个 release 的基线再转 required，但期间必须报告回归。
3. 所有 P95 至少使用每个声明 host/transport 100 次独立注入/运行；报告样本数、预热、时间窗口、网络条件和
   reference hardware。soak 指标另报，不能与短样本合并。
4. 失败必须保留脱敏 event replay、日志、截图/DOM、diff/checkpoint、环境和 exact commit；安全或交付 gate 的
   缺 artifact 本身就是失败。
5. impacted-test selector 使用覆盖声明语言/构建生态的 versioned golden corpus；漏掉 required gate 次数必须为 0，
   无法分类或置信度不足时自动回退到项目定义的全量 required gates。

| 维度               | 建议的可执行指标                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安全边界           | manifest 覆盖每个 policy source × tool/effect class × failure class；Plan 未授权 mutation、失败路径权限提升、变更 Skill 未重授权执行均为 0               |
| 长会话             | 至少 100 条版本化 synthetic/adversarial trajectory；目标/约束/决策/文件/测试/阻塞冻结事实保留率 100%，静默丢失为 0；摘要失败必须带 degraded reason       |
| 持久状态           | 每种 WS/IDE/进程 kill point 至少 100 次；Plan/TODO/execution lock/revision/evidence replay 后状态一致率 100%，恢复后能力变宽为 0                         |
| 会话与人工介入     | 每个 host/transport `n≥100`；canonical id 覆盖率 100%、双 writer 为 0、回答错绑为 0；runtime 发出 `needs_input` 到 IDE 可见 P95 < 2 秒                   |
| 恢复               | code/conversation/combined/summary/branch 以及 shell/background/Subagent/external/symlink fixture 结果确定；`partial/none` 未列出资源次数为 0            |
| 验证与交付         | impacted-selector golden corpus 漏掉 required gate 为 0；未知时全量回退率 100%；旧 commit/部分 matrix 误用于交付为 0；不满足策略时 auto-merge 为 0       |
| 宿主与分发         | manifest 中每个 required stock/minimum/OS/remote journey 在 exact commit 通过；fresh-profile 安装/升级/回滚可重放；失败 100% 有诊断 artifact             |
| 工作流与自动化     | definition/phase/agent/token/time/budget/恢复边界字段完整率 100%；trigger 重放重复交付为 0；missed-run/离线/DST/越权策略 fixture 全通过                  |
| Execution Location | 每个声明环境 launch/resume/handoff fixture 全通过；不支持能力静默降级、secret 静默转移、未提交状态静默丢失均为 0                                         |
| Marketplace        | public/private 候选均可回读 digest/signature/SBOM/license/capability；安装/升级/回滚及签名撤销、依赖冲突、代理/registry 故障 fixture 全通过              |
| 上下文与权限       | 固定预算下选择/裁剪 hash 确定；每个 chip 可解释/移除/计量；scoped rule 可 diff/expire/revoke，managed deny 被放宽为 0                                    |
| 性能               | 固定数据集：100 sessions、10,000 messages、100-file 或 10 MB diff；reference hardware 上 input-to-paint P95 < 100 ms，单个主线程 long task 不超过 200 ms |
| 可访问性           | VS Code/JetBrains/Desktop 核心 journey 全键盘可达；焦点恢复 fixture 通过；声明的屏幕阅读器/OS 组合完成逐版本人工验收并附记录                             |

## 十、不建议的路线

- 不在 Plan、Skill/MCP、Hook/Subagent、子树指令与语义压缩前置门关闭前扩大 Auto/无人值守任务范围。
- 不再添加彼此独立的 Sessions、Team、Remote、Artifact 页面来“补一个入口”；先统一 Workbench。
- 不新建第四套 workflow scheduler；以 Cowork DAG + Team/Batch + canonical session runtime 收敛。
- 不照搬 Claude Code Research Preview 的具体 UI 或规模数字；学习交互目标，并保留 ChainlessChain 的本地化、
  跨端、企业策略和可审计差异化。
- 不宣称网络、数据库、消息、部署或支付能被文件 Checkpoint 完整回滚。
- 不把 ghost-text completion、WebIDE 全量重写或视觉微调排在验证/交付/发布闭环之前。
- 不用 mock、命令注册数、单元测试数量或可选发布步骤的绿色状态替代真实用户旅程和公开回读。

## 十一、参考资料

### Claude Code 官方资料

- [Changelog](https://code.claude.com/docs/en/changelog)
- [VS Code](https://code.claude.com/docs/en/vs-code)
- [JetBrains](https://code.claude.com/docs/en/jetbrains)
- [Desktop](https://code.claude.com/docs/en/desktop)
- [Agents overview](https://code.claude.com/docs/en/agents)
- [Agent View](https://code.claude.com/docs/en/agent-view)
- [Dynamic Workflows](https://code.claude.com/docs/en/workflows)
- [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- [Worktrees](https://code.claude.com/docs/en/worktrees)
- [Remote Control](https://code.claude.com/docs/en/remote-control)
- [Routines](https://code.claude.com/docs/en/web-scheduled-tasks)
- [Channels](https://code.claude.com/docs/en/channels)
- [Code Review](https://code.claude.com/docs/en/code-review)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Plugins](https://code.claude.com/docs/en/plugins)
- [Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)

### 仓库主要证据

- [CLI changelog](../CHANGELOG.md)
- [CLI package](../packages/cli/package.json)
- [VS Code extension](../packages/vscode-extension/)
- [VS Code changelog](../packages/vscode-extension/CHANGELOG.md)
- [JetBrains plugin](../packages/jetbrains-plugin/)
- [JetBrains changelog](../packages/jetbrains-plugin/CHANGELOG.md)
- [Desktop coding agent bootstrap](../desktop-app-vue/src/main/bootstrap/coding-agent-bootstrap.js)
- [现有完整差距审计](./IDE_VS_PLUGIN_CLAUDE_GAPS_AND_OPTIMIZATIONS_2026-07-22.md)

## 十二、实施状态快照（更新至 2026-08-15）

本节记录原始审计快照之后的实施进展。状态严格区分“仓库实现”“本地定向验证”“真实宿主/远程矩阵”和
“公开发布回读”：前两者不能替代后两者，也不能据此宣称 Microsoft Marketplace 发布、真实 PR/merge 或完整
release gate 已完成。

当前核验基线为 `github/main@7d3120fc1ed7ef1c32c183d3235ced4a39589e1f`。公开分发基线为 CLI npm
`0.163.8` 与 Open VSX `0.37.52`；JetBrains `0.4.88` 已上传 Marketplace，但尚无本文采用的公开 listing
回读。已发布 IDE tags `ide-vscode-v0.37.52` / `ide-jetbrains-v0.4.88` 精确绑定
`f044181efbfc7fc9bcff38558eda556ae671a9e3`；后续 `0.37.53` / `0.4.89` 仍按 source candidate 处理，
不能仅凭 tag 外推为公开发布。Microsoft Marketplace、JetBrains 作者签名及 Desktop/native 签名公开闭环
仍未关闭。开放 PR 只按候选记录，不计入 `main` 已交付范围。

下方首张总表保留 2026-08-09 的粗粒度校准基线，便于追溯当时的纠偏；它不是当前最终状态表。
与后续“剩余任务计数与可执行清单”或 exact-SHA 增量冲突时，以日期更新、当前核验 head 和最新清单为准。

> 2026-08-09 纠偏：此前 P0-3 的“完成”声明只覆盖 host-neutral state machine、pending-effect
> 协议、IDE projection 和 fake-adapter 测试。在该日快照中，生产代码尚未实例化
> `DeliveryCoordinator` 的真实 provider adapter；`cc artifacts delivery-step` 明确不调用
> PR、CI、merge 或 archive provider，双 IDE 也只请求/结算外部结果。因此 P0-3 外部交付闭环重新列为
> **未完成**，不能再用 PR #86 或 fake adapter 把真实 provider 接线外推为已交付。后续 PR #142 已关闭
> 仓库内 production adapter/runner 子门，但真实公网交付 journey 仍未关闭，详见后文。

| 路线项                   | 当前状态                                                                                                                                         | 已有证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 尚未关闭的范围                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-S / S0-1～S0-3        | 仓库级安全/正确性闭包及审计加固已拆分提交；CLI release 双门已在发布 SHA 关闭，长期安全矩阵未关闭                                                 | `70306bd8ee` 提交 structured semantic handoff；`ece470137d` 提交 Plan/TODO persistence；`7c97c11ebd`、`c841a58e2b` 提交 Skill/MCP safety 与受控 Skill 执行；`199b2cb7c6` 提交 WS recovery state；`9332a21ab3` 提交子树 mutation preflight；`6be06f4448` 提交 Plan hard ceiling、capability fence、contract/permission/Hook fail-closed 与 subagent authority inheritance；`46688dd9ca` 补齐 owner-only `secure-fs` 依赖；`a72d75d153` 至 `ab32a57e4b` 收口 verified MCP authority、严格 ledger、malformed projection、动态 latch、ambiguous outcome、REPL 原子切换和各宿主共享恢复 authority；`24349b05fd` 收紧 WS projection/refresh，`842691eedf` 覆盖 roots-only client，`223c0f505c` 使 Stream recovery 切换保持事务一致；`b6a2c096ea` 把核心 ledger/recovery/adjudication 边界纳入 Strict Sandbox 触发范围。`1c572b213f` 提交独立 `mcp_call_recovery_adjudication` event、verified head/recovery digest、单次 CAS、TTY typed confirmation 与单调 exact-replay deny，不把 started-only 调用伪造成机器 terminal record。发布 SHA `a03ad1b548` 的 CLI CI `30978007430`、CLI Strict Sandbox `30978007359`、Session Host Consistency `30978007292` 与 Background Interaction E2E `30978007505` 均成功 | `HOST STOPPED` 是操作性前置条件，不是跨进程 lease/revision 或即时全局撤权；新 authority 只在 restart/resume 后采用，旧宿主必须停止并保持停止。仍需恶意 MCP、跨进程 kill/restart、即时撤权和长期安全矩阵。sidecar anchor 仍只覆盖 crash/尾截断，不防同时改写 transcript 与 metadata 的更强攻击者；真实矩阵完成前不得扩大 Auto/无人值守保证                                                                         |
| P0-0 / R0                | Desktop command、capability、不可变发布门与原生事务仓库实现已提交；CLI npm 已公开回读，unsigned CLI 六目标执行已关闭，IDE/签名原生公开闭环仍阻断 | `66f8a7e467` 提交 Desktop 单一 command registry；`a1fa5e41e8` 提交不可覆盖、带 digest、缺诊断 fail-closed 的 host evidence；`af6cc890a4` 提交 Microsoft Marketplace exact 回读器；`72429c1729` 提交公开 capability manifest、漂移检查和 required release gate；`55b3c55a1c` 加固 immutable stable-channel/release contract；`8990999771` 提交 installer/OTA 锁、状态、sidecar、alias、lineage、结果消费和 rollback/rescue 事务加固，冻结本地矩阵 142/142；`a1c9eed07e` 再关闭下载目标替换恢复缺口。CLI `chainlesschain@0.162.197` 已由 `v-npm-0-162-197` 发布，托管回读 `30983536627` 验证 npm 签名/SLSA、原发布 run `30979565206`、不可变 artifact 与公开 tarball 逐字节一致。PR `#105` 的 merge SHA `e3f56b11e27ae1bd5d19ad8638434843c244aa68` 又由 `CLI Native Validation` run `31240927257` 在 Linux/Windows/macOS 的 x64 + ARM64 匹配 runner 上完成 standalone build、真实命令执行、transaction regressions 与六份 evidence 聚合                                                                                                                                                                                                                                                                 | 缺少可回读的 Microsoft Marketplace `0.37.47` 公共版本；unsigned CLI 六目标匹配宿主执行已关闭，但原生链仍缺完整 generation transaction、真实 taskkill/断电一致性、签名 Desktop/native Linux/macOS/ARM64 发行、notarization/Authenticode 及公开资产回读。CLI npm 或 unsigned native validation 成功不得外推为 IDE Marketplace、Desktop installer 或原生升级闭环                                                     |
| P0-1 / Q1 / R1 Workbench | **完成**；本状态只在承载该行的 closure PR 经 squash 合并后生效                                                                                   | `7cbb95ffeb` 建立 CLI、VS Code、JetBrains 共用的 canonical session projection v1；`636c414f55` 增加有界且带认证的 `cc daemon reply`、canonical action route、五类 session（local/background/remote/team/workflow）以及 owner/worktree/input/artifact/PR 投影；`b3fdb39f88` 将同一持久化 fixture 接入双 IDE 的两进程重启 journey，随后由 `d9f21563b5` 收口三 OS 共用的真实 VS Code Webview action relay。implementation head `d9f21563b57fc9d518eecb49bcec6a1547a63db5` 的 IDE Extensions run [31065512726](https://github.com/chainlesschain/chainlesschain/actions/runs/31065512726) 整体成功：VS Code stable/current 与 minimum `1.85.2` × Windows/macOS/Linux、JetBrains `2024.2`/`2025.2` × 三 OS、不可变 VSIX、Plugin Verifier 与最终 build 全绿。12/12 evidence 均为 `result=passed`、`evidenceComplete=true`，逐格执行 dispatch→needs_input→reply→done、artifact/PR 回读及独立 IDE 进程重启恢复；12 个 `needs-input-visible` 样本为 212～689ms，nearest-rank P95 689ms，满足 `<2s`。提交前 VS Code unit 68/68、extension-host 36/36、CLI/JetBrains workbench 定向集 40/40 通过；closure PR [#89](https://github.com/chainlesschain/chainlesschain/pull/89)                                     | 无（P0-1 范围关闭）；本行中的 `remote` 只证明 canonical projection kind 与同一 fixture parity，不代表 Remote/SSH/WSL/devcontainer transport 已关闭。真实远程传输、多窗口、网络抖动、ARM64 与 soak 继续归属 P0-4，不能反向重开或扩大 P0-1 结论                                                                                                                                                                     |
| P0-2 / Q2 / R1 Rewind    | **完成**；本状态只在承载该行的 closure PR 经 squash 合并后生效                                                                                   | `fa6e9e6951` 与 `df78ee7060` 完成 canonical timeline、bounded reader 和 session index 基础；`d2af28e205` 将 VS Code 的确认统一为可键盘操作且取消即 fail closed 的原生 Quick Pick，并等待 JetBrains 各级弹窗实际关闭后再进入下一步；`c281b266c1` 分离 Rewind 前控制历史与 Branch 后新会话 DOM 证据。exact head `c281b266c14cdba3bb21537b590273f0261079ca` 的 IDE Extensions run [31020937841](https://github.com/chainlesschain/chainlesschain/actions/runs/31020937841) 整体成功：VS Code current `1.132.0` 与 minimum `1.85.2` × Windows/macOS/Linux、JetBrains `2024.2`/`2025.2` × 三 OS、不可变 VSIX、Plugin Verifier 与最终 build 全绿；真实宿主逐项执行 code-only、conversation-only、combined、summary-from、summary-to、branch，并回读 partial coverage、excluded paths 与 irreversible side effects。提交前 Rewind 定向回归 65/65、宿主驱动 33/33 通过；closure PR [#88](https://github.com/chainlesschain/chainlesschain/pull/88)                                                                                                                                                                                                                                                            | 无（P0-2 范围关闭）；Remote/SSH/WSL/devcontainer、多窗口、网络抖动、ARM64 与 soak 继续归属 P0-4，不能反向重开或扩大 P0-2 结论                                                                                                                                                                                                                                                                                     |
| P0-3 / Q3 / R2           | **部分完成**：host-neutral coordinator、pending-effect 协议、impact/evidence policy 与双 IDE projection 已完成；生产 provider 外部闭环未完成     | `30bb5cd661` 与 `4b2df9c4cc` 完成 resumable state machine、impacted gate、不可变 evidence、exact-commit policy 与双 IDE UI 接线；Q4a 的 `fb39e2cbe6` exact-SHA 真实宿主矩阵覆盖 VS Code stable/minimum × Windows/macOS/Linux 及 JetBrains 两版本 × 三 OS。真实 PR [#86](https://github.com/chainlesschain/chainlesschain/pull/86) 及 run `30983536627` 证明仓库层面确实发生过公网 PR/CI/readback/merge，但该路径没有由生产 `DeliveryCoordinator` provider adapter 驱动；现有 coordinator 仅在测试中由 fake adapter 实例化，CLI 与双 IDE 都只请求或结算外部 effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 仍缺生产代码中的真实 provider adapter 与入口接线，用于 `runGates`、`runPreview`、`runReview`、`applyFix`、`createPr`、`refreshCi`、`publishEvidence`、`merge`、`archive`；还必须由 coordinator 绑定 exact head、发布 immutable evidence、执行 fix-rerun/受控 merge 并安全归档。fake adapter、只读 UI 或一次人工 PR 不能关闭该范围；Remote/SSH/WSL/devcontainer、网络抖动与 8 小时 soak 另归 P0-4                  |
| P0-4 / Q4a / R3a         | required local-host、多根、多窗口与 IDE ARM64 real-host exact-SHA 子门已在各自提交关闭；完整远程/公开渠道门未关闭                                | `5860747f0a` 为隔离的 macOS journey 启用 VS Code 自带的 in-memory test secret storage，恢复 current stable 验收而不采用失败的旧版 host pin。已结算候选 `fb39e2cbe6` 的 IDE Extensions `30965289911` 整体成功：capability、Windows/macOS/Linux 的 stable + minimum `1.85.2`、JetBrains 2024.2/2025.2 × 三 OS 六格、VSIX package/artifact 与 JetBrains build/compatibility 全部通过。PR [#99](https://github.com/chainlesschain/chainlesschain/pull/99) 关闭有序双根，PR `#102` 关闭多窗口，PR `#118` 及 exact-SHA run `31269850865` 关闭 IDE ARM64 real-host 子门；各结论只授权其声明矩阵                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 仍缺 Remote/SSH/WSL/devcontainer/Codespaces 与 JetBrains Gateway、网络抖动/断线恢复、公开渠道 fresh-profile 安装/升级/回滚、作者签名和签名 ARM64 公开发行、8 小时 IDE soak 与 live-provider trajectory；这些范围不得从本地宿主或 unsigned real-host 成功外推。restricted 二进制工件仍不宣称文本级脱敏                                                                                                             |
| Q4b / R3b                | CLI npm 的 exact-SHA 发布与公开回读已完成；unsigned CLI 六目标执行已完成；IDE Marketplace、签名原生安装/升级闭环未完成                           | `a03ad1b548` 的 CLI CI `30978007430`、CLI Strict Sandbox `30978007359`、Session Host Consistency `30978007292`、Background Interaction E2E `30978007505` 与 IDE Extensions `30978007086` 均成功；tag `v-npm-0-162-197` 触发 run `30979565206`，全部 gate、测试、不可变 tarball/SBOM 及 npm 上传成功。上传后首次即时 `npm pack` 因 registry 传播延迟使原 run 红灯，但公开包已带 npm/Sigstore SLSA 证明；PR `#86` 的只读 run `30983536627` 由 npm 11 验证签名、精确 repo/workflow/tag/SHA/digest，按证明中的 run ID 下载原 artifact，并证明 registry tarball 与原 artifact 逐字节一致，证据 artifact `8921133281` 保留至 2026-11-03。merge SHA `e3f56b11e27ae1bd5d19ad8638434843c244aa68` 的 native run `31240927257` 又关闭 unsigned CLI 六目标匹配宿主执行；同 SHA 的 tag `v-npm-0-163-1` 与 npm run `31246063305` 已完成 `chainlesschain@0.163.1` 的 exact-SHA 发布、SLSA 与公网逐字节回读                                                                                                                                                                                                                                                                                                           | Microsoft Marketplace `0.37.47` exact-version/digest 回读、签名原生发行（含 ARM64）、fresh-profile 安装/升级/回滚仍未完成；Open VSX、CLI npm 或 unsigned native validation 结果不能替代 Microsoft Marketplace 与 Desktop/native 公开渠道。原 publish workflow 的传播延迟误报由 `2338900f8b` 有界重试修复；产品 release 中不适用于 tarball publish 的 `gitHead` 前置条件由 PR `#86` 改为 npm 已验证 SLSA authority |
| P1 / R4 与 P2 / R5       | 三批命令生命周期迁移、会话预算 foundation、热进程 formal scale 与两小时 CLI reliability 子门已关闭；完整 R4/R5 未完成                            | `c50d2f8a53`、`1f2a9caf3d` 与 `56c87fa5d0` 完成三批长尾迁移：25 个旧顶层入口保留兼容别名并收敛到虚拟 `cc lab ...`，至少保留两个 release cycle；注册图仍为 175、净增长 0，推荐顶层命令从 166 降至 151，manifest、README、namespace help 与四种 shell completion 同源生成。核心 lifecycle/lazy/completion 39/39，扩大命令/文档矩阵 103/103。`008335171f` 至 `6b4570c80f` 的预算 foundation、后台与 TeamRunner 定向矩阵继续保持通过。发布 SHA `a03ad1b548` 的 `CLI Session Scale` formal run `30979989460` 在 Ubuntu、Windows、macOS 全绿，覆盖 100/10,000 会话配置、1 GiB 逻辑 transcript、P95/RSS/I/O 阈值与 crash-repair artifact；main SHA `e3f56b11e2` 的 `CLI Reliability Soak` run `31240943985` 又在三系统完成 8/8 场景、1,000 turn 与至少 7,200 秒连续 duplex，并通过 RSS、FD/handle 和子进程回收门槛                                                                                                                                                                                                                                                                                                                                                                                           | 命令面迁移已完成计划中的三批，但仍需按弃用周期观测使用并决定后续移除；预算能力仍只是 foundation/local adapters，生产 root、全部 turn/token/tool 与 WS/REPL/headless 入口尚未统一 authority。formal scale 当前测量范围仍是 `canonical-store-hot-process`；Dynamic Workflow、Execution Location、Automation、Context/Permission Center、Marketplace 治理、8 小时 IDE soak 与真实长会话全宿主验收仍待推进            |

### 2026-08-06 P0-1 与 P0-S 正式门收口补充

本节是对上表 P0-S、P0-0/R0 与 Q4b/R3b 渠道状态的较新精确取证；与上表历史措辞冲突时，
以下方 exact-SHA、公开回读和未完成边界为准。

- P0-1 的早期 12-sample 证据已由强制每格 100 次的正式质量门替代。PR
  [#91](https://github.com/chainlesschain/chainlesschain/pull/91) 以 merge commit
  `98107f0767cf10d9b0ba4c1a2dcab80e7d868851` 合并；最终候选
  `b5177f13c950fcc74be8a2a4aa573f5c422a1b13` 的 IDE Extensions
  [31086078037](https://github.com/chainlesschain/chainlesschain/actions/runs/31086078037) 整体成功。
  VS Code stable `1.132.0` / minimum `1.85.2` × Windows、macOS、Linux 与 JetBrains
  `2024.2` / `2025.2` × 三 OS 共 12/12 个 journey 均为 `result=passed`、
  `evidenceComplete=true`，每格 100 个测量样本和 1 个 warmup，共 1,200 个样本；最高
  nearest-rank P95 为 1,205ms，满足 `<2s`。不可变 VSIX `0.37.44` 为 467,023 字节，
  SHA-256 `7e7b4aaccb8153c6c55d3361cfe669285b3daf31b6993b3195e2e75de4b29762`；
  JetBrains ZIP `chainlesschain-ide-bridge-0.4.81.zip` 为 802,584 字节，SHA-256
  `99b2c86875bae413d1498d11cb5988d958918b6da56d29ee0d60aa545606a285`。本证据关闭
  P0-1，并同时作为该候选的本地真实宿主门；不外推到 P0-4 的 remote/多根/网络抖动/8 小时 soak。
- P0-S 的 Plan/TODO/WS 持久化恢复与结构化语义 handoff 已有正式跨平台门。PR
  [#94](https://github.com/chainlesschain/chainlesschain/pull/94) 以同一 final candidate
  `b5177f13c950fcc74be8a2a4aa573f5c422a1b13` 合并；IDE Roadmap Safety Matrix
  [31085994178](https://github.com/chainlesschain/chainlesschain/actions/runs/31085994178) 在 Linux、macOS、
  Windows 全绿。聚合 artifact `8961872748`（保留至 2026-11-04）验证每个声明 kill point 和每个
  semantic transport 各 100 次，共 2,100 次真实子进程强杀与 600 条语义轨迹；状态一致率和冻结事实
  保留率均为 100%，capability widening、错误 approval binding 与 silent loss 均为 0。
- P0-S 的恶意 MCP 默认确认子门已关闭。PR
  [#97](https://github.com/chainlesschain/chainlesschain/pull/97) 的 exact head
  `60ac0731226a81fda78007bb12fbcc528724fcb3` 先通过三平台 CLI Strict Sandbox
  [31097515933](https://github.com/chainlesschain/chainlesschain/actions/runs/31097515933) 与 IDE Roadmap
  Safety Matrix [31097516655](https://github.com/chainlesschain/chainlesschain/actions/runs/31097516655)，再以
  squash commit `e7023539a6d0fd557809e4fa31515d1b9de254e3` 合并到 `main`。该 main SHA 的正式矩阵
  [31099259639](https://github.com/chainlesschain/chainlesschain/actions/runs/31099259639) 在 Windows、Linux、
  macOS 和最终 aggregate 全绿：每 OS 对 claimed-read mutation、unknown mutation、declared write 各执行
  100 次未批准请求，共 300 次，transport、外部 mutation 与 ledger 均为 0；stale host-read 不能降级
  unknown/write，显式批准探针只产生一次 prompt、一次 transport，并按 unknown/untrusted 记账。
- 上述两个 P0-S 正式子门关闭版本化 fixture 声明的持久化/结构化 handoff，以及未获批准的恶意 MCP
  effect admission；它们不关闭运行中即时全局撤权、任意 taskkill/断电与 fsync durability、更强
  transcript+metadata 同时篡改攻击者或长期安全 soak。因此整个 P0-S 和 Auto/无人值守扩大范围仍未完成。
- IDE 公开发布子范围已从候选升级为 **两渠道完成**。exact candidate
  `b5177f13c950fcc74be8a2a4aa573f5c422a1b13` 以 tag `ide-vscode-v0.37.44` 和
  `ide-jetbrains-v0.4.81` 发布；Open VSX workflow
  [31090450115](https://github.com/chainlesschain/chainlesschain/actions/runs/31090450115) 与 JetBrains workflow
  [31090452195](https://github.com/chainlesschain/chainlesschain/actions/runs/31090452195) 的发布及 post-publish
  verify 均成功。独立公开 API 回读确认 Open VSX `0.37.44` 为 latest、listed 且可下载，JetBrains `0.4.81`
  已 approve、listed 且非 hidden。Microsoft Marketplace 因仓库没有 `VSCE_PAT` 未执行发布，也没有
  `chainlesschain.chainlesschain-ide` listing；不得把 Open VSX 结果外推为 Microsoft Marketplace 已完成，
  Microsoft exact-version/digest 和 JetBrains 作者签名仍属于 R0/Q4b 剩余边界。
- P0-4 的 **VS Code 多根真实宿主子门已关闭**。PR
  [#99](https://github.com/chainlesschain/chainlesschain/pull/99) 的 exact head
  `a8ff6fabd4120cf878df9014bb445aae2b0a05e0` 将已安装的不可变 VSIX 默认旅程改为有序双根
  `.code-workspace`：真实 VS Code `workspaceFolders`、owner-only Bridge lockfile、initial/restart
  ready signal 与不可变 journey evidence 必须逐根同序一致；evidence 只公开 `rootCount=2` 和脱敏的
  ordered-root digest，不泄露工作区路径。IDE Extensions
  [31103761885](https://github.com/chainlesschain/chainlesschain/actions/runs/31103761885) attempt 2
  整体成功，Windows、macOS、Linux 的 stable 与 minimum `1.85.2` 六格均完成真实 Webview/Workbench、
  Bridge、100 次采样和 IDE 重启旅程；JetBrains 两版本 × 三 OS、插件 build 与 compatibility 也成功。
  attempt 1 的 JetBrains Windows 2025.2 在准备阶段因 Maven Central/Gradle Plugin Portal HTTP 403
  失败，未进入插件代码；同一 SHA 的 failed-job rerun 越过下载并完成真实 journey，不能把首次红灯抹除。
  PR 最终以 squash `90d78399f61a63e11020dff0f0283480907b8262` 合并。本证据只关闭 VS Code
  多根子范围；多窗口、Remote/SSH/WSL/devcontainer、网络抖动、ARM64 与 8 小时 soak 仍未关闭。
- GitHub 远端分支在精确 ancestry、PR 和 tag 取证后完成归档：本轮共清理 23 个已合并、已完成、由同 SHA
  release tag 承接或 `ahead=0` 的旧分支；`release/cli-0.162.195`～`0.162.197` 分别由同 SHA 的
  `v-npm-0-162-195`～`v-npm-0-162-197` 保留不可变引用。当前仅保留受保护的 `main` 与自动化需要的
  `chore/auto-docs`；未根据 GitHub 证据推断删除 Gitee 或本地共享工作树分支。

按 2026-08-09 纠偏后的当前口径，P0-1、P0-2 完成，P0-3 仅 state machine/projection 子范围完成，
生产 provider 闭环仍为部分完成；Open VSX `0.37.47` 与 JetBrains `0.4.83` 的公开发布子范围为 GO。
整体产品 release 仍为 NO-GO：Microsoft Marketplace、JetBrains 作者签名、Desktop/native 签名与
fresh-profile 安装/升级/回滚、remote/SSH/WSL/devcontainer、网络抖动、8 小时 IDE soak、任意断电/fsync
与外部 anchor 一致性及其余 R4/R5 产品旅程尚未关闭。CLI npm 或两家 IDE 渠道成功均不得外推为这些范围已交付。

### 2026-08-07 VS Code 多窗口真实宿主与 Open VSX `0.37.45` 发布

- PR [#102](https://github.com/chainlesschain/chainlesschain/pull/102) 的 final head
  `a7db8c2df2ac6f3b5899809fc08dcd3092f23f78` 关闭 VS Code 多窗口真实宿主子门。IDE Extensions
  [31201770460](https://github.com/chainlesschain/chainlesschain/actions/runs/31201770460) attempt 2
  整体成功：stable `1.132.0` 与 minimum `1.85.2` × Windows、macOS、Linux 六格均完成
  initial/restart journey。Windows 验证同一真实宿主实例的多个窗口；macOS/Linux 由外层 runner 显式管理
  第二个隔离真实 VS Code 宿主。不可变 evidence 证明两个宿主具有不同 PID、CDP 端口和受认证 token，且在
  断言窗口内同时监听。提交前 VS Code unit 为 79/79。attempt 1 的 macOS Node 下载 DNS 失败与
  JetBrains Windows 2025.2 owner ACL 准备超时均发生在产品旅程之前；failed-job rerun 后完整矩阵成功，
  不把首次基础设施红灯抹除。
- PR 以 squash commit `aed0a3ae5327917ce0490a5decbddd777f66f33b` 合并。该 main SHA 的发布前
  IDE Extensions [31204896161](https://github.com/chainlesschain/chainlesschain/actions/runs/31204896161)
  整体成功，再次覆盖 VS Code 六格、JetBrains `2024.2`/`2025.2` × 三 OS、不可变 VSIX、插件 build 与
  compatibility；因此没有使用 PR 旧 SHA 或局部矩阵授权发布。
- 轻量 tag `ide-vscode-v0.37.45` 精确指向上述 merge SHA；tag workflow
  [31207738786](https://github.com/chainlesschain/chainlesschain/actions/runs/31207738786) 整体成功。
  Open VSX credential preflight、publish 和公开 listing verify 均成功；公开 API 回读为 latest
  `0.37.45`、listed、downloadable。registry VSIX 与 workflow 不可变候选归档 SHA-256 均为
  `0b6347c1d16a4a9fe3b1f03cc3ad3c71f99310348088a357194e08aed9ee3e5a`，规范化内容 SHA-256 为
  `130531b8e33650508a44e098cd0107f79a88ee585c6c58fdc068a70ea4f38dc1`。Microsoft Marketplace
  credential preflight、publish 与 exact VSIX verify 全部为 `skipped`；本轮未发布 Microsoft
  Marketplace。VS Code tag 下 JetBrains build/publish/verify 也全部为 `skipped`，JetBrains 公开版本保持
  `0.4.81`。
- 本证据只新增关闭 **VS Code 多窗口** 子范围，并将 Open VSX 公开版本前进到 `0.37.45`。它不关闭
  Remote/SSH/WSL/devcontainer、网络抖动、fresh-profile 安装/升级/回滚、ARM64、8 小时 soak 或完整
  冷进程恢复，也不授权 Microsoft Marketplace 发布。

### 2026-08-08 CLI 冷恢复、Session authority、原生验证与可靠性门增量

- 上一节保留了当时“完整冷进程恢复未关闭”的判断；较新的 exact-SHA 证据已经关闭该子项。实现提交
  `f99f18e4cb3832b8848534186ba32756e98c66c9` 的 CLI Session Scale
  [31085110318](https://github.com/chainlesschain/chainlesschain/actions/runs/31085110318) 在 Ubuntu、macOS、
  Windows 三格全部成功。每格都验证 20 writers × 1,000 append、10,000 sessions、1 GiB 完整 hash-chain
  transcript、15 个完整 CLI 冷进程样本、8 次真实强杀和 344 个 exhaustive byte cuts；cold-process P95
  分别为 `222.56ms`、`219.04ms`、`286.66ms`，峰值 RSS 均低于 `76MiB`。因此
  **P0-5/P1-6 的冷进程规模与 `<2s` / `<100MiB` SLO 子项已关闭**；这不关闭任意断电/fsync、远端宿主、
  同时回滚 transcript 与外部 anchor 或长期 IDE soak。
- Session Host Consistency 也已由公开 release SHA
  `dbb06e16fef0600e41d25d383c5595c7945f60ff` 的三平台 run
  [31191709454](https://github.com/chainlesschain/chainlesschain/actions/runs/31191709454) 正式关闭，并由不可变
  `v-npm-0-162-200` 保留。随后 `chainlesschain@0.163.0` 从 exact SHA
  `aed0a3ae5327917ce0490a5decbddd777f66f33b` 完成 CLI CI、CLI Strict Sandbox、不可变 tarball/SBOM、
  npm Trusted Publishing、SLSA provenance 和公网回读。上述证据只更新 CLI Session/npm 子范围，不外推到
  Microsoft Marketplace、Desktop/native 或远程 IDE。
- `0.163.1` 候选 SHA `f56a27b9376e3c15f30322c3d60c8e3a93bd6405` 的 CLI Strict Sandbox
  [31217225572](https://github.com/chainlesschain/chainlesschain/actions/runs/31217225572)、Session Host
  [31217225397](https://github.com/chainlesschain/chainlesschain/actions/runs/31217225397) 与 IDE Roadmap Safety
  Matrix [31217225550](https://github.com/chainlesschain/chainlesschain/actions/runs/31217225550) 成功，但 CLI CI
  [31217225565](https://github.com/chainlesschain/chainlesschain/actions/runs/31217225565) 在 macOS unit 3/4
  真实暴露 `session-tail` 删除/恢复竞态。后续 SHA `a29eb4203d333756fc258b493b0c43af4fc36759`
  已在外层 `stat/open` 竞态后重新读取 durable witness；其 CLI Strict Sandbox
  [31219890201](https://github.com/chainlesschain/chainlesschain/actions/runs/31219890201) 与 Session Host
  [31219691603](https://github.com/chainlesschain/chainlesschain/actions/runs/31219691603) 与 CLI CI
  [31219886076](https://github.com/chainlesschain/chainlesschain/actions/runs/31219886076) 已成功。两小时 CLI
  Reliability Soak [31219797408](https://github.com/chainlesschain/chainlesschain/actions/runs/31219797408)
  随后在三平台全部失败：screen-reader probe 在 REPL prompt 就绪前注入输入后超时；duplex loop 又因
  `turns < 1000 || elapsed < 2h` 在达到 1,000 次后继续无界执行，实际产生 122 万～443 万 turn，并使 RSS
  增长 140～206MiB，超过 128MiB 门槛。该失败不能解释为基础设施绿灯或被旧门拼接覆盖。
- 当前增量继续对 witness presence 读取自身的瞬态 `ENOENT` 做三次有界重试；持续歧义仍 fail closed 为稳定的
  `SESSION_TRANSCRIPT_UNVERIFIED`。`9ef2b8390e` 又将正式 1,000 turn 确定性均匀铺到完整两小时，并等待真实
  REPL prompt 后再注入多语 screen-reader 输入，RSS/FD/handle 阈值保持不变；Windows 本地真实 TTY +
  duplex smoke 只作为实现诊断，不作为发布证据。最终 main SHA
  `e3f56b11e27ae1bd5d19ad8638434843c244aa68` 已从头取得 CLI CI
  [31240892299](https://github.com/chainlesschain/chainlesschain/actions/runs/31240892299)、CLI Strict Sandbox
  [31240892177](https://github.com/chainlesschain/chainlesschain/actions/runs/31240892177)、Session Host
  [31240892148](https://github.com/chainlesschain/chainlesschain/actions/runs/31240892148) 与 Background E2E
  [31240892133](https://github.com/chainlesschain/chainlesschain/actions/runs/31240892133) 成功；旧失败 SHA 与局部门
  没有参与授权。
- 同一 exact SHA 的两小时 CLI Reliability Soak
  [31240943985](https://github.com/chainlesschain/chainlesschain/actions/runs/31240943985) 在 Ubuntu、Windows、
  macOS 三格全部成功。三份 `chainlesschain.cli-reliability-soak.v2` artifact 均为 `status=passed`、
  `exactShaVerified=true`、干净源码、8/8 场景与零 violation；duplex 均完成 1,000 turn，连续时长分别为
  `7200.039s`、`7202.076s`、`7200.163s`，P95 分别为 `5.327ms`、`9.392ms`、`25.792ms`。RSS 增长分别为
  `-12.637MiB`、`-75.570MiB`、`-15.172MiB`，低于 `128MiB` 上限；FD/handle delta 分别为 `0`、`-2`、
  `0`，峰值 delta 均为 `1`，低于 `8` 上限，required measurements 可用且子进程全部回收。对应 artifact digest
  分别为 `sha256:8c851918558d0987fda412c38519a3340dba059b69c9a83408e3a65dc0ee2ad5`、
  `sha256:c92c590df56a199b425e99cc199d9ce1a54617adcf80bdf4ff03d756114766fe`、
  `sha256:a6321855d6a435cd08591c32dba7652deb504cc0f24ce570b4ab5286ed3dc1fc`。因此
  **exact-main 两小时 CLI formal reliability 子范围已关闭**；这不关闭 8 小时 IDE soak、remote transport 或
  完整 R4/R5 产品旅程。
- 新增只读 `CLI Native Validation` workflow，解决正式 native release 在宿主证据形成前即阻断全部 build 的
  循环依赖。该门只允许手工指定 exact SHA，在 Linux/Windows/macOS 的 x64 + ARM64 六个匹配真实 runner 上
  构建并执行 standalone binary 的 `--version` 与 `status --json`，逐文件运行 installer/updater transaction
  回归，并聚合 content-free `chainlesschain.cli-native-validation.v1` 证据。它不申请 `contents: write` /
  `id-token: write`，所有记录固定 `signed=false`、`releaseEligible=false`，不能发布或替代签名门。
- 首次真实 Windows x64 诊断同时发现旧 `node20-*` 目标在锁定的 `@yao-pkg/pkg-fetch@3.6.4`
  [v3.6 cache](https://github.com/yao-pkg/pkg-fetch/releases/tag/v3.6) 中没有六平台基座，以及生成入口静态导入
  top-level-await `src/index.js` 后不能由 pkg 的 CommonJS bootstrap 启动。正式/验证矩阵、installer、包管理器
  manifest 和 host-aware 默认值现统一为 `node22-*`；构建前 `--force-fetch` 使缺失基座直接失败，不再退回
  不可控的源码编译；生成入口改用无 top-level await 的 phase-0 lazy dispatcher。本地 dirty-tree 诊断只用于
  实现调试，不作为 release evidence。PR [#105](https://github.com/chainlesschain/chainlesschain/pull/105) 的实现
  head `5abe3671eff41d0cf00200dc75c18aeb53c6931f` 先由
  [31240390649](https://github.com/chainlesschain/chainlesschain/actions/runs/31240390649) 完成六格；squash merge
  `e3f56b11e27ae1bd5d19ad8638434843c244aa68` 又由最终 main run
  [31240927257](https://github.com/chainlesschain/chainlesschain/actions/runs/31240927257) 从头验证。Linux、Windows、
  macOS 的 x64 + ARM64 六个匹配 runner 均完成 standalone build、`--version`、`status --json`、installer/updater
  transaction regressions 与单格 evidence 上传，aggregate job 成功；聚合 artifact digest 为
  `sha256:768d0cf0ae22a94ee47dbd35ae98df27f8634f880ce90b71f4e97d14f8e34ab4`。因此
  **unsigned CLI 六目标匹配宿主真实执行子范围已关闭**。
- 随后创建的不可变 tag `v-npm-0-163-1` 精确指向同一实现 SHA；正式 npm workflow
  [31246063305](https://github.com/chainlesschain/chainlesschain/actions/runs/31246063305) 的 exact-SHA gate、完整
  tests、package 与 publish job 全部成功。gate artifact digest 为
  `sha256:6c726654981fd25a7206be0f44b4809a812a89aac6acf77b6076801e9ebac373`，不可变 tarball/SBOM
  artifact digest 为 `sha256:2f248553bf68eb942f48be7e5bd70a6d3091b1563084af527093c677759a79c7`，
  公网回读 artifact digest 为 `sha256:6a4c547159451fea937b3189f8e1c6d6d1c7763150c65343bfb6fb5aad1c60d2`。
  `chainlesschain-0.163.1.tgz` 为 `5,958,150` bytes，SHA-256
  `d9e09e25c6086e0777e97a670105649e3a7e5fb1c2816e1834557da32157cbee`；重新从 npm 官方 registry
  `npm pack` 得到的 tarball 与 workflow artifact 逐字节一致。回读证据将 Trusted Publishing/SLSA provenance
  绑定到 `refs/tags/v-npm-0-163-1`、exact SHA、workflow 与 run，`npm audit signatures --include-attestations`
  为 `invalid=0`、`missing=0`；npm `latest` 现为 `0.163.1`。因此 **CLI npm 0.163.1 发布子范围已关闭**，
  但这不改变下一条签名 native/IDE 阻断。
- 2026-08-08 的仓库 secret/variable 名称只读回读仍没有 `VSCE_PAT`、native updater key、Windows
  Authenticode 或 macOS signing/notarization 凭据；代码不能伪造这些外部授权。Microsoft Marketplace、六目标
  签名发行、IDE ARM64、fresh install/upgrade/rollback 公网回读、Remote/SSH/WSL/devcontainer、网络抖动、
  8 小时 IDE soak 与其余 R4/R5 旅程继续 **NO-GO**。上述 native evidence 固定 `signed=false`、
  `releaseEligible=false`，不得外推为签名、notarization、发布或公开资产回读。

### 2026-08-02 恢复安全检查点

- `5c828517df` 是首批 MCP ledger admission，不再单独作为“所有入口已经阻断”的完成证据。
- `38ab06cfdd` 至 `223c0f505c` 把 malformed recovery、运行时 latch、Host `callTool`、WS projection/refresh、REPL session switch、roots-only client 与 Stream resume 收敛到共享 fail-closed authority；模型发起的 MCP 调用仍使用 raw client + 同一 durable ledger，避免重复记账。
- `1c572b213f` 使用独立 `mcp_call_recovery_adjudication` event、verified head/recovery digest 与单次 CAS 表达人工事实确认；`confirmed_applied` 保留 exact replay deny，`confirmed_not_applied` 只解除恢复不确定性，二者都不伪造机器 `completed`、`failed` 或 `settled`。
- 裁决要求 TTY 内键入包含 `HOST STOPPED` 的完整 challenge，但仓库尚无跨进程 lease/revision 撤销；这是“既有宿主已停止并保持停止”的操作性前置条件。裁决后的 authority 仅在 restart/resume 后采用；若旧宿主仍活跃，必须先停止并复核 transcript，不能宣称即时全局生效。
- `925a49fb7b` 让 MCP admission、ledger identity 与 transport 共用同一个深冻结 JSON wire snapshot，并在网络调用前拒绝 Proxy/accessor/thenable 等歧义输入；公开 recovery effect 严格限制为四个枚举。非持久 REPL、headless 和 ephemeral stream 也始终使用 host guarded ledger，第一次不安全 `outcome_unknown` 后的第二次调用会在 prewrite 阶段阻断。提交前核心矩阵 132/132、REPL MCP 子集 32/32 通过，独立复审无剩余高/中 blocker。
- `1cd36e4212` 将 Headless、Background 与 WS 的 resume projection 对齐；`CLI Session Host Consistency` run `30728860710` 在三 OS 成功。该门只证明 same-process adapter conformance，不包含跨进程 head lease/fencing、独立 anti-rollback anchor、bounded resume I/O、fsync/断电或 remote-host durability。
- `223c0f505c` 的 Strict Sandbox run `30715641925`、`b6a2c096ea` 的 run `30716039185` 和 `5df2e1bdac` 的 run `30724810078` 均在三 OS 全绿。`6b4570c80f` 的 Strict run `30727179738` 三 OS 全绿，但其 `CLI CI` run `30727179832` 已失败；`1cd36e4212` 的 Strict run `30728860734` 三 OS 均失败。`8c9f83860b`、`2bb379bf1e`、`a28f5f4c6e`、`2123c0731e` 与 `5ca77069c7` 修复跨平台 fixture、契约隔离、POSIX/Windows 边界、JSON 错误解析和 Windows 清理重试；`2e50772542` 又补齐注入 transcript 的 hash chain，本地 headless-runner 67/67，其 Strict run `30729294491` 在 Ubuntu 24.04、Windows、macOS 15 全绿，但同 SHA 的 `CLI CI` run `30729294557` 被取消。这些结果只能授权各自 SHA 和各自门禁，不能替代最终 exact SHA 的完整双门。
- `8990999771` 的最终本地冻结矩阵为 142/142，旧的中间矩阵证据已撤销；`a1c9eed07e` 又关闭下载目标替换恢复缺口。`dc69dbb62d` 进一步让 fresh-install 的 post-replace lineage 失败可回滚，并用同目录原子 rename 恢复 upgrade 的旧 lineage；本地相邻矩阵 146 passed、7 个 POSIX 动态用例在 Windows 跳过。`ab17a76048` 再把 `priorTarget` 硬链接快照纳入 durable recovery pointer，以同一 `O_NOFOLLOW` 描述符覆盖 validate→retire，重检 inode/content，并补 final anchor 父目录 durability barrier、SIGKILL、同字节 inode 替换和最终 fsync 故障回归；Windows 定向为 6 passed、24 个 POSIX 用例按平台跳过，bash/sh/dash 语法检查通过。`6a1ebaa188` 的 macOS CI 中本文件 28 passed / 2 个 PowerShell 用例跳过，但 Ubuntu 的 alias 同内容新 inode successor 用例失败并发生 target 部分回滚；Linux blocker 正在修复，Windows exact-SHA native job 尚未形成结论。该 pointer 不等于完整 generation transaction；原生 installer/OTA 仍缺完整 durable generation、真实强杀/断电、ARM64 与签名矩阵，不能据此宣称 release-ready。

### 2026-08-02 Session scale 证据边界

- `b5c50bb513` 已提交独立 `CLI Session Scale` 组件门、session index/repair 加固与 exact-SHA artifact；本地定向测试 79 passed、1 skipped，Windows 默认 smoke 通过。formal run `30724908237` 以完整 `b5c50bb51368a849d649fb8d27bd790d46217c20` 作为 checkout 输入，Ubuntu、Windows、macOS 三个 job 全部成功并上传 exact-SHA artifact；该证据只授权该提交及组件门范围，最终 release SHA 仍须重跑。
- 最终发布 SHA `a03ad1b548cc6f15c9bef8f82d519e9c625eef8d` 已通过 `CLI Session Scale` formal run `30979989460`：Ubuntu、Windows、macOS 三个 job 全部成功并分别上传 exact-SHA evidence。该 run 关闭发布 SHA 上 100/10,000 会话配置、1 GiB 逻辑 transcript、热进程 P95/RSS/I/O 与 crash-repair 的组件门；测量明确标记为 `canonical-store-hot-process`，不关闭完整 CLI cold-process resume SLO。
- 当前 1 GiB/P95 指标仅测热进程 `rebuildMessages()` 的 checkpoint 后缀读取。`9cbe020b08`、`213c3ae7c5` 已让覆盖到的 Headless/Stream/WS 路径复用 verified projection，`d14a4eb8eb` 又移除默认 MCP adjudication 与 Cowork 对完整 event 数组的强制 materialization；但普通 hash-chain 认证仍为 O(N)，reducer authority 仍可能随唯一 ledger/replay-deny 状态增长，legacy/create/IDE/background 等全部入口也未完成一致性验收。因此 P0-5 的真实冷进程恢复 `< 2s`、RSS `< 100MB` 与跨宿主目标仍未完成。
- 下一步不是放宽门槛，而是增加可验证 checkpoint/分段 anchor、剩余入口的 composite projection，以及冷进程真实入口矩阵。现有真实 SIGKILL 仅覆盖两个 append pipeline 边界；人工 exhaustive prefix、sidecar repair 和同 head 元数据检查均不得外推为任意 taskkill/断电、fsync durability 或任意 metadata corruption 已恢复。

### 2026-08-02 命令生命周期与会话预算 foundation

- `c50d2f8a53` 已提交虚拟 `cc lab` namespace，并以 `dao`、`evomap` 完成命令长尾迁移 pilot；旧顶层入口保留兼容转发与弃用提示至少两个 release cycle，注册顶层命令净增长为 0，completion 与 README 由同一策略生成。命令组 3 文件 35/35 通过；`1f2a9caf3d` 补强 lifecycle 契约，补充 13/13 通过。该阶段不代表其余长尾已经迁移。
- `008335171f` 提交 session resource budget primitive 与 SubAgent 本地 adapter；`f9c3a7d258` 提交后台 cleanup 基础；`65796e6ec6` 保持后台 lease 直到子进程实际退出；`9611afb8c8` 校验 usage aggregate/details 一致性；`6383e66201` 为 TeamRunner 增加 fence 与 scoped authority；`6b4570c80f` 把相关矩阵纳入 Strict Sandbox gate。`e5963e8a2b` 将运行数修正为活跃 PID 与 `RUNNING` task ID 的并集，恢复后台 `maxConcurrent` admission；后台矩阵 44/44、并发目标 2/2 通过。`35d9ce9aba` 使 PowerShell completion 生成在不同平台保持确定性。
- `6a1ebaa188` 提交持久化 session budget runtime：unknown-usage intent 采用 marker-first，read 绑定 main revision 与 marker revision/SHA-256，read/write/mark/finalize/clear 共用 per-session 主锁；finalize 只清除精确观察到的 marker，后到 marker 会 durable merge 后冲突并保留证据；authority 持久化失败会回滚本地 release/end/usage/recovery 状态，custom signal cleanup 不再泄漏 runtime reference。独立扩大回归为 10 files、181 passed / 2 个 POSIX 用例在 Windows 跳过，三文件 Node 语法和 Prettier 通过。
- 当前状态仍是 **foundation/process-local runtime + cooperating-writer CAS**。生产 root 与全部 WS/REPL/headless/tool/token/turn 入口尚未统一接线；sidecar 不是 machine-wide authority，也没有独立 anti-rollback/transcript-head 绑定。host snapshot 仍缺跨进程 head lease/fencing，真实恢复仍有 O(N) 全量读取，精确竞态回归也不是 fork 进程证明；不得标记“统一全会话预算”或“真实长会话完成”。`6a1ebaa188` 的 Strict Sandbox run `30729639108` 已在 Ubuntu 24.04、macOS 15、Windows 全绿，但同 SHA 的 `CLI CI` run `30729639052` 已失败，暴露 resume legacy fixture、Linux alias rollback、macOS synthetic Windows-sidecar 和 Windows 8.3 path fixture 问题；前两项 fixture 分别由 `b6e648a820`、`2f0182226c` 修复，安全语义相关的 Linux alias 与 macOS sidecar 仍在处理。单独的 Strict 成功不构成发布授权；最终待发布 SHA 的 `CLI CI` 与 `CLI Strict Sandbox` 全矩阵同时成功前不得发布。

### 2026-08-02 canonical 宿主、流式恢复、预算与原生事务增量

- `63a67cc676` 是 REPL canonical resume 提前校验的中间提交；后续独立审计发现 P1，不能引用该 SHA 或“REPL 87/87”宣称安全闭包。`13e0f074b3` 随后加固 canonical absence/error provenance、resume id、role/tool authority 与 canonical system admission；关键定向 30 项和相邻 40 项共 70 passed，独立增量审计为 P0=0、P1=0。该审计登记的 inherited live-switch host-prefix 风险由 `5c9f05494a` 跟进；其本地新行为 4/4、相邻 35/35，独立审计在该提交范围为 P0=0、P1=0。以上结论只授权各自提交范围，不替代 exact-SHA CI 或 release gate。
- `9cbe020b08` 提交 forward verified projection、sidecar head/count anchor、checkpoint 后缀消息重建、增量 MCP reducer、WS turn lifecycle projection 与 index/export 接线；`213c3ae7c5` 将覆盖到的 Headless/Stream 恢复收敛到同一 verified sample，并为 canonical WS resume request 加入跨进程 opaque claim。owner 崩溃后的 claim 保持 pending，不自动接管或重放；它不是 general session lease。`3bf36193dc` 只恢复 compatibility export 完整性；`fa3aa32801` 补齐 canonical host consistency workflow 与测试覆盖，不代表 release gate 已关闭。
- covered canonical path 已不再要求把全部 event materialize 成数组，但普通 hash-chain 身份认证仍为 O(N)，sidecar 不是独立 anti-rollback anchor。真实冷进程 1 GiB P95/RSS、fsync/断电、remote host、legacy/create 路径和全宿主长期一致性仍未完成。
- `2a85acb901`、`be86097be2` 加固持久预算 authority、persist-first close、durable dirty recovery 与旧 handle/lease 撤权；`73ad3b7378` 保持精确 budget 文件身份，本地单文件为 36 passed / 3 skipped。独立复审只在“私有目录 + cooperating writer”范围为 P0=0、P1=0；非协作 same-UID writer 下的临时路径 cleanup、sidecar rename overwrite 和 marker retirement successor 仍是 machine-wide P1 NO-GO。生产 root 及全部 turn/token/tool/WS/REPL/headless 入口也未统一接线。
- `4145508010` 只是 retained tombstone cleanup 语义的中间提交；后续独立审计仍发现 P1，不能写成 installer 安全闭包。`1354be776a` 对 transaction successor、orphan 与 retained evidence 采用保守保留和 fail-closed；本地单文件为 10 passed / 43 skipped，其中包含 `wsl.exe` 下 4 个 bash/dash 动态用例，第六轮独立只读审计在该提交范围为 P0=0、P1=0。完整 durable generation、三 OS 强杀/断电、ARM64、签名和公开资产回读仍未完成。
- exact-SHA 组件结果如下：`9cbe020b08` 的 Strict `30732462022` 与 Host Consistency `30732462034` 成功，但 CLI CI `30732462105` cancelled；`213c3ae7c5` 的 Strict `30733555412` 与 Host Consistency `30733555422` 成功，但 CLI CI `30733555516` cancelled；`fa3aa32801` 的 Host Consistency `30734282464` 成功，但 CLI CI `30734282599` failure；`73ad3b7378` 的 Host Consistency `30737250601` 成功，但 CLI CI `30737250661` cancelled；`13e0f074b3` 的 Strict `30737581562` 与 Host Consistency `30737581567` 成功，但 CLI CI `30737581680` cancelled；`1354be776a` 的 CLI CI `30737890854` cancelled；`5c9f05494a` 的 CLI CI `30738312745` cancelled、Strict `30738312596` 与 Host Consistency `30738312610` success。所有这些 SHA 均为 **release NO-GO**；不得把任一旧 SHA、部分门或组件门成功外推到其他提交。

### 2026-08-02 后续提交与 exact-SHA 证据

- `5c9f05494a` 的最终结果为 CLI CI `30738312745` cancelled、Strict `30738312596` success、Host Consistency `30738312610` success。`9cadcaf4d6` 随后保持摘要后的 durable system provenance；其 CLI CI `30738491468` failure，而 Strict `30738576056` 与 Host Consistency `30738491365` success。本切片目标测试在 CLI CI 中通过，但独立 native/packer 失败仍使提交保持 NO-GO。
- `4bb6e25fe4` 修正 POSIX fixture 精确注入、Darwin fd 启动预检兼容与 PowerShell fixture 初始化；CLI CI `30739539943` 将 Ubuntu/macOS native failures 分别从 40/39 项降为相同 5 项，但 Windows 仍有 2 项 `Get-FileHash` 失败，并保留当时 48 项 packer 身份误判，因此整门失败。
- `755ee07926` 以可信 volume/share-root、parent handle 与二次 pathname descriptor 关闭 Windows libuv 1.49/1.50 跨 API `dev` 投影误判，同时继续严格绑定句柄 `dev+ino` 与变更字段；Node 22.12 和 22.22 下的 packer 相关矩阵均为 87/87。该 SHA 的 CLI CI `30742304070` 被后续提交取消，不能作为发布证据。
- `d14a4eb8eb` 将 MCP adjudication 改为单次 verified projection，并让 Cowork binding 与 ledger 在同一 verified scan 中折叠；factory finish identity、accepted count/head 与不安全同步对象均 fail closed。独立复验 5 文件 204/204。它移除了这两个入口对完整 event 数组的强制 materialization，但 ledger/replay-deny authority 仍可能增长，hash-chain 认证仍为 O(N)，1 GiB 冷进程 P95/RSS 目标仍未验收。
- `d14a4eb8eb` 的 Strict `30742425145` 与 Host Consistency `30742425143` 已成功，但 CLI CI `30742425229` 最终 cancelled。取消前已完成的 unit shard 4/4 只形成诊断证据：Ubuntu/macOS 各有相同 5 个 POSIX fault-injection failure；Windows 有 2 个 `Get-FileHash` failure 与 1 个 packer `SIDECAR_NOT_READY`；MCP/Cowork 目标集在每个 OS 均为 129/129；packer 在 Ubuntu/macOS 为 applier 54/54 + downloader 30/30、Windows 为 applier 53/54 + downloader 30/30。cancelled run 的局部结果不构成完整门禁。
- `0de8744151` 修复 MCP runtime 的 `configScope`、`configSource`、`projectPath` 传播，并确立 `managed/显式 > local > project（.mcp.json 优先于 legacy project DB）> user > plugin`。新增 `type:"ws"` 配置经 runtime loader 连接真实 socket，以及结构化 close/timeout 回归；本地变更集 70/70，扩大 9 文件 156/156。CLI CI `30743223135` cancelled，且没有同 SHA 的 Strict/Host 完成证据，仍为 **NO-GO**。
- `77639a241a` 将 READY token 改为临时文件写入后同目录 rename，本地三个 packer 文件 87/87；CLI CI `30743389086` cancelled。后继 CI 仍在同一 readiness case 报 `SIDECAR_NOT_READY`，因此该提交不能被表述为 sidecar readiness 已闭合。
- `4c95005a30` 以内置 SHA-256 helper 消除 installer 对 `Get-FileHash` 的依赖。CLI CI `30743648603` 中 Windows native 文件为 49 tests / 43 skipped / 0 failed，原两个 PowerShell failure 均消失；但 Windows packer 仍有 1 个 readiness failure，Ubuntu/macOS 仍各有 5 个 POSIX failure，整门为 failure。
- `43bc6d1a39` 只修复 POSIX fault-injection、signal 注入与 cleanup 断言 fixture，没有修改 installer 生产实现；CLI CI `30748505309` cancelled。其后 `60dbe9861c` 的 Ubuntu unit4 证明原 5 个旧 POSIX failure 已消失，但暴露 1 个 `backup publication TERM` 残余；macOS/Windows unit4 未完成即因后续 SHA 取消，故仍无跨平台闭合证据。
- `00905ff90c` 将 Windows sidecar、READY 与 READY_TEMP 发布到 canonical TEMP，同时保留 raw TEMP 的逐祖先 reparse 预检，解决 GitHub runner `RUNNER~1` 被 long-path 实路径误判的问题；未放宽父进程的安全祖先与 transactionId 校验。本地三个 packer 文件 89/89、applier 56/56，Node 22.12 真实 8.3 TEMP 握手连续 3/3。CLI CI `30749292414` 被后续提交取消，Windows unit4 尚未进入测试，且没有同 SHA 的 Strict/Host 完成证据；当前仍为 **release NO-GO**。

### 2026-08-02 Durable replay 与 fork 发布事务

- `741ffebff8` 将 compact 绑定到同一 verified projection 与完整 canonical replay 指纹；REPL 自动/退出 compact 在 concurrent turn 改变持久消息时拒绝 stale write。其 CLI CI `30742928259` cancelled，故只构成本地/组件实现证据。
- `9a780a0c84` 关闭 `9cadcaf4d6` 之后审计发现的 forged wire provenance、深层 Proxy/accessor、runtime clone、WS recovery notice、structured handoff 与 `SUMMARY_TO` 晋升缺口。durable system 只有在 hash chain + sidecar anchor 验证后才恢复进程内 authority；REPL、Headless、WS、checkpoint、branch/fork 使用同一 canonical projection。
- branch 采用 deterministic plan、completion digest、strict-prefix crash recovery 与 anti-anchor-downgrade；fork 以 `(sourceId, requestId)` 绑定唯一 successor，并把首次 source revision 写入 hash-protected、provider 侧剥离的 `_cc_fork_authority`。未完成 copy/lineage 只存在于非枚举 `.fork.pending`，验证后才同目录原子发布；`--fork-session` 默认生成独立 request ID，`--fork-request-id` 支持稳定 unknown-commit retry。
- 最终本地矩阵为 14 files、626/626，完整 Host Consistency gate passed；四个真实 `exit(91)` 窗口均在 list 介入与 source advance 后恢复到单一 verified successor。两路独立终审为 P0=0、P1=0。该 gate 明示 `trackedWorktreeDirty=true`、`gateSourcePathsExact=false`，不得外推为 exact-SHA artifact。
- `9a780a0c84` 的 CLI CI `30745539604` 最终 failure，Host Consistency `30745539474` 与 Strict Sandbox `30745539476` success；状态仍为 **release NO-GO**。O(N) chain verification、独立 anti-rollback anchor、general cross-process lease、checkpoint restore-both partial apply、pending GC/quarantine、真实 1 GiB 冷进程 P95/RSS、fsync/断电、remote host 与最终 exact-SHA 双门仍待关闭。

### 2026-08-03 MCP 动态请求头与 CLI 0.162.190 发布判断

- `5751994818` 已实现 Claude Code 对标所需的可信 `headersHelper`：HTTP/SSE/WS 统一接线，连接、重连及 401/403 只允许一次受控刷新；动态头按大小、数量、控制字符与 transport-owned header fail closed。local/project/plugin 分别绑定持久同意、项目文件 authority 与插件 sandbox/provenance，Broker 审计和错误 URL 做凭据脱敏。核心回归为 146 passed / 1 skipped，相邻回归为 131 passed，独立复审未发现 P0/P1 blocker。
- `30ee87cbca` 修复 Windows 后台进程树测试收尾：同步终止整棵树、显式轮询 terminal state，并仅对 `EBUSY`、`ENOTEMPTY`、`EPERM` 做 10 秒有界删除重试。本地重复 20/20、单文件 15/15、相邻 32/32、三文件 47/47 通过；旧 CI 中曾失败的 EBUSY 用例随后在 Windows shard 通过。
- `713b1d90cf` 修复首轮跨平台门禁暴露的三类确定性问题：macOS `/var`→`/private/var` 与 Windows `RUNNER~1`→长路径的测试夹具 canonicalization、deprecated `mcp-client.js` 漏导出 `redactMcpUrl` / `isMcpAuthenticationError`。`8dd5aa9944` 的 CLI CI `30755786437` 已证明 shim integration 6/8 三 OS 全绿、MCP unit 1/4 的旧四项失败消失、workspace transaction unit 2/4 在 Windows/macOS 全绿。
- `8dd5aa9944` 的 Strict Sandbox `30755786295` 与 Background Interaction E2E `30755786309` 均三 OS success；CLI CI `30755786437` 为 Ubuntu 16/16、macOS 16/16、Windows 15/16，唯一失败是 Windows unit 1/4 中 6 个 `file-checkpoint` path `lstat` 与 fd `fstat` 跨 API identity 误判。该 SHA 没有同 SHA 的 Session Host Consistency run，因此仍是 **release NO-GO**。
- Windows Server 2025 / Node 22.12 / libuv 1.49.1 的 path↔fd identity 误判已随 `4ddb5c9c98` 集成主线；`non-authoritative-trash/v1` 同时让 rename 后仍保留原 workspace ACL 的隔离文件退出恢复 authority。真实 Windows `Everyone:F`、rename 后强杀、fresh-process 篡改/恢复与组合定向测试为 78 passed / 1 skipped，独立终审当时为 P0=0、P1=0、P2=0。
- 从 `v-npm-0-162-189` 到本轮候选已有 150+ CLI 提交，包含安全配置/secret 写入、MCP scope/WS/动态头与恢复、session/后台/预算/checkpoint、CLI/REPL/补全、签名 native 更新与回滚、plan/todo/skills 等用户可见变化，功能量足以发布 **`chainlesschain@0.162.190`**。需在 release notes 明示：secret 改用 `config set-secret`、`mcp add` 默认 local scope、`status --json` 默认快速报告且完整 Docker 信息需 `--deep`，以及损坏 session、陈旧 checkpoint 和 outcome-unknown MCP 调用会更严格拒绝继续。
- `01bfdcaea7` 把 restore safety arm 前移到任何 workspace publish 之前，并补齐失败/强杀窗口回归；`20fd6a23c4` 将 CLI 发布校验扩展到实际 npm tarball、package/changelog、Web 资产与 attestation 一致性，避免本地目录通过但发布载荷漂移。
- `63b1e401d6` 收口 Windows Node 22.12 / FSLogix 场景的 secure-path false negative，并加强 owner-private ACL 验证；相关 secure-fs 定向测试在当前 Node 与 Node 22.12 均为 48/48，ESLint、Prettier、语法与 diff 检查通过。
- `d5394c7505` 已加入 append-only、hash-chained、CAS 驱动的 durable checkpoint restore saga 存储；`34810ced1c` 已把 timeline code/both restore 的正常路径和失败路径接入该 saga，覆盖 `created → locked → prepared → intent_committed → safety_ready → mutation_started → workspace_applied → session_committed → completed`，并把实际 restore engine kind、immutable checkpoint identity、session operationId、`safetyPlanIdentity` 与 incumbent `blockingOperationId` 纳入持久证据。
- 最新定向验证为 timeline command 21/21、checkpoint store 49/49、新增真实 Git safety hooks 11/11、JSONL session store 98/98；saga/command 组合在当前 Node 为 78 passed / 2 skipped，Node 22.12 的 saga/command/Git 定向组合为 91 passed / 40 skipped。本地一次七文件并行运行出现的 20 项失败均为高并发 Git/ACL 操作触发固定 5 秒 test timeout，相关文件独立运行全部通过，真实 Git 用例随后增加显式 20 秒源码 timeout；该次本地运行没有断言失败。
- `34810ced1c` 的 exact-SHA Session Host run `30764663099` 已在 Ubuntu/macOS/Windows 全绿；CLI CI run `30764663195` 则暴露两处跨平台测试 fixture 问题：macOS/Ubuntu 的 timeline command 各 13 项因硬编码 `C:/workspace` 被 POSIX 正确拒绝，Windows 的 saga 6 项因新增 maintenance-lock owner 读取抢先进入 event/HEAD path-device 模拟而失败。本轮已把 timeline mock 改为宿主绝对 `process.cwd()`，并为 lock owner 建立与 event/HEAD sample 隔离的 exact control-device 投影；timeline 单文件为 21/21，saga 在 Node 22.22.2 与 Node 22.12.0/libuv 1.49.1 均为定向 6/6、完整 60 passed / 2 skipped。该修复仍需新的 exact-SHA CI 证明；`34810ced1c` 未触发 Strict Sandbox 与 Background Interaction，不能据 Session Host 单门外推发布通过。
- `0ab774f1b7` 增加 operation-local restore intent，`daa4a63f58` 暴露 immutable restore target identity，`ec31d6410b` 提供 shared durable restore orchestrator foundation；`70d24d76e7` 才把传统 direct `cc checkpoint restore` 接入该 orchestrator/saga。`fb03baf466` 与 `116b0abade` 分别保留已发布到 saga 的 session intent，以及“transcript 已提交、saga intent CAS 未提交”的 authority；`a3755f0505` 再把 timeline `restore-code` / `restore-both` 迁入同一 `plan → locked revalidate → restore → withSessionAuthority` 编排。至此 direct 与 timeline code restore 已统一使用 saga，但统一接线不等于通用 resume/rollback 已完成。
- `87edbd5be2` 落地 verified session recovery read-model，其精确分类是 `no-session/direct`、`clean-abort`、`code-settlement-resumable`、`both-settlement-resumable`、`already-completed` 与 `conflict/unknown`；`b1fdc986c2` 提供 pre-intent abort / terminal release 的保守 controller，`19cf060030` 公开 `checkpoint recovery list/show/abort/release`。窄 mutation 同时绑定 exact seq/head 和**当前** live owner digest 或 verified owner absence，controller 会再次 reload、inspect 与 CAS，不复用 saga 中的历史 owner evidence。
- `1c1df20cc7` 的真实 Git/copy terminal kill matrix 关闭“saga completed、workspace lock 未释放时被杀 → 新进程 release/archive”窗口，copy/git 2/2 无 skip；它不覆盖 mutation-phase kill、冷启动 CLI 或一般 rollback。
- `4b85468917` 已把 `checkpoint recovery resume` 接入公开 CLI，但范围严格限制为 verified timeline already-completed settlement：replacement lease 下先验证 session，再用 production Git/copy verifier 校验 immutable checkpoint namespace/identity、scope、target poststate 与 digest，然后 CAS completed、释放锁后 archive；不会重放 workspace 或 conversation mutation。`5f48437b0b` 加入真实 Git/copy exact/drift 测试，`59ec5bb9b8` 与 `8facbdc3de` 分别修复并行 home 竞争和 macOS `/var` / Windows 8.3 temp alias，不能把这条窄 resume 写成通用 resume。
- `5ac697dfa2` 加入 crash-safe rollback v2 saga 边界，`5654e1ac1f` 以 `checkpoint_restore_recovery_resolution` 建立 workspace settlement event hash → session resolution hash → saga session commit digest 的双向权威链，`db90af42c5` 同步 recovery read-model/CLI phase 与 rollback request 投影。`e8a58bd585`、`f27495bca7` 分别加入 verified Git/copy rollback adapter，`000d3af245` 接入 crash-safe partial rollback controller，`bac192c488` 保留 original/safety recovery authority。
- `4fca29f2f3` 将真实 kill/restart 扩为 Git/copy × terminal/mutation 四路径，**4/4 无 skip**；mutation 路径在 `mutation_started` 强杀后由新进程凭持久 saga、真实 adapter 与 session resolution 恢复到 pre-restore workspace。`805706136e` 随后公开同步 `cc checkpoint recovery rollback --yes`：要求 exact seq/head、当前 live owner digest、cycle-bound original target count，并对普通 thenable 与恶意 `then` getter fail closed；四个 recovery 文件为 **142/142**。
- `767fdada75` 把 checkpoint delete/clear/prune 接入 workspace→saga retention guard。Git 以 expected-OID transaction 删除并验证 `_tip` predecessor；copy 使用 root-bound 私有 sentinel/维护锁、ID no-replace、全组删除前布局验证，并拒绝 nested custom store。最终冻结回归为 `file-checkpoint` **86 passed / 1 skip**、Git retention/predecessor **12/12**、timeline command **27/27**；独立终审为 P0=0、P1=0。非阻断 P2 是 filesystem/UNC 卷根祖先检查的极端终止顺序，删除仍 fail closed。
- `d465de2013` 已完成 clean-worktree npm artifact create/verify；tarball SHA-256 为 `f6e422bf1f401ffb1b5b41f348891887ffd22f9cbcb4a5bb4f5733b9b49d402c`。其 Strict Sandbox `30781907923`、Session Host `30781910691` 与 Background Interaction `30781914093` 成功，但 CLI CI `30781904317` 在 macOS、Windows unit shard 3/4 failure，所以该 SHA 明确 **NO-GO**。
- 两个失败 shard 都是 `checkpoint-store` 同 10 项：新增 retention fixture 混用了未 canonicalize 的 macOS `/var` / Windows 8.3 temp root 与 canonical workspace，production durable-authority 校验按设计 fail closed。`bb15105561` 在派生 state/lock 前 canonicalize fixture 根，未修改生产 saga；本地相关 retention/delete/prune 回归 **12/12**。这不是 flake，旧 SHA 不应直接重跑放行。
- 截至 2026-08-03，仓库 package version 已准备为 **`0.162.190` release candidate**，npm registry `latest` 仍为 `0.162.189`。从 registry gitHead 到代码冻结提交 `767fdada75` 的 CLI 范围为 164 commits、391 files、137,900 additions / 4,015 deletions。结论保持：**功能量足以发 `0.162.190`，但修复与文档所在的最终 exact-SHA 门完成前仍是 release NO-GO，不要发布**。最终精确 SHA 必须重新取得 `CLI CI`、`CLI Strict Sandbox` 与受影响的 Session Host/checkpoint 门在全部配置 OS 上成功，并重新验证 immutable npm tarball；任何旧 SHA、queued、cancelled、failure 或局部成功都不能授权发布。即使门禁转绿，本轮也只给出发布建议，不自动打 tag 或执行 npm publish。
- 用户授权发布后，轻量 tag `v-npm-0-162-190` 精确指向 `ec4941b0630ffdfb5470be9814052ea690f3776f` 并已同步 GitHub/Gitee。正式 npm workflow `30790359741` 的 exact-SHA gate 成功，但综合 `test` 在 Agent SDK E2E 阶段失败，后续 `package-cli` / `publish` 全部 skipped；npm `0.162.190` 从未写入。失败由测试把 `CHAINLESSCHAIN_HOME` 同时作为 `cwd` 引起，新安全规则按设计返回 `CONFIG_HOME_UNSAFE`，不是 flake，也不能重跑放行。
- 测试夹具已改为同一临时根下互为 sibling 的 owner-private home 与 workspace，真实 CLI 的写文件、审批回调和 resume 路径本地复跑为 Agent SDK **7 files / 50 tests 全绿**；生产安全规则未放宽。已推送的失败 tag 不移动、不覆盖，后续发布身份前进为 **`chainlesschain@0.162.191` / `v-npm-0-162-191`**，仍须由新 exact SHA 重新取得全部三平台权威门和 immutable tarball 验证。
- `0.162.191` 的最终 SHA `9e2a3238426499a3de1d228034e66dab91cbfa2c` 已取得 CLI CI `30791273745`、Strict Sandbox `30791273563` 与 Session Host `30791273622` 成功；正式 workflow `30793513643` 中 core/Agent SDK/PDH/Web/完整 CLI tests 全部成功，但 `package-cli` 在 root-monorepo `npm sbom --package-lock-only` 被无关 desktop/mobile peer graph 污染后失败，artifact upload / publish 均 skipped，npm 仍未写入。该失败不是测试或 tarball 身份失败，也不能直接重跑放行。
- SBOM 门改为从 immutable CLI tarball 解包，在禁用 lifecycle scripts 的前提下生成发布包独立 lock 与 CycloneDX，再校验 root name/version/purl 及非空 dependency graph；本地验证为 CycloneDX 1.5、606 components、607 dependency entries。`v-npm-0-162-191` 保持不可变，后续身份前进到 **`chainlesschain@0.162.192` / `v-npm-0-162-192`**，并重新要求 final exact-SHA 权威门。
- `0.162.192` 的最终 SHA `19dcdea87a87892fe9eb22a23b4f3fe9ce05af93` 已取得 CLI CI `30795367296` attempt 2、Strict Sandbox `30795367089` 与 Session Host `30795366927` 成功；CLI CI 首次执行仅 macOS unit 4/4 的真实双进程 CAS 用例失败，重跑后该分片及三平台 `verify-cli` 全绿。正式 npm workflow `30799974832` 的 `exact-sha-gate` 却用 `filter=all` 同时读取同一 run 的旧失败 attempt 和最新成功 attempt，错误地以旧 job 阻断发布；下游 package/publish 因门禁失败不可达，npm 未写入。
- release gate 已改为 GitHub jobs API `filter=latest`，回归单测 **6/6** 通过，并对真实 `19dcdea…` run 成功验证两项 exact-SHA 门。`v-npm-0-162-192` 保持不可变，后续身份前进到 **`chainlesschain@0.162.193` / `v-npm-0-162-193`**，仍须由包含该修复和版本文档的 final SHA 重新取得全部权威门与 immutable tarball/SBOM 验证。
- 首个 `0.162.193` 候选提交的 Strict Sandbox 与 Session Host 已成功，但 CLI CI run `30800530258` 再次在 macOS unit 4/4 暴露真实双进程 CAS 竞争：协作方可在非 owner 安全检查的 `lstat/realpath`、目录枚举与 `owner.json` 读取之间正常释放锁，旧实现把该瞬时 `ENOENT` 包装为 `LOCK_FAILED`，使输掉 CAS 的进程未进入串行 stale-head 校验并返回预期 `CONFLICT`。修复只在 `requireOwner=false` 的 unlocked pre/postflight 容忍该精确消失并交由 `withFileLock` 重试；临界区 owner 丢失仍 fail closed。新增目录项与 owner 文件两个确定性回归，完整 checkpoint saga **105 passed / 2 skipped**，真实双进程 CAS 独立重复 5 次均通过。该候选尚未打 tag、npm 未写入；修复后的 final SHA 仍须重跑全部权威门，不能用旧成功 job 拼接放行。
- 后续权威回读纠正了上一条末句：通用 workflow run `30820089779` 已从 `e8e7ba274b487ed491c04ec3359841a0e545debb` 发布 `chainlesschain@0.162.193`，但没有 `v-npm-0-162-193`，且同 SHA 的 CLI CI `30819465463` 随后失败。提交 `734a438156` 实际覆盖了专用 `npm-publish.yml`，使通用 auto-detect 绕过 exact-SHA 双门、immutable tarball/SBOM 与完整测试。修复恢复专用流程，将通用发布器迁到独立 workflow/`v-packages-*` namespace，并在检测与最终 publish loop 双重拒绝 CLI；候选前进为 `0.162.194`，已发布 `0.162.193` 不删除、不覆盖、不补造授权 tag。
- 专用 npm workflow 的 tag trigger 同步从重叠的 `v*` 收紧到 `v-npm-*`；通用 workflow 只响应独立 package tag 与数字产品 tag，且双重拒绝 CLI。产品 `release.yml` 删除 token-backed `publish-cli` / `skip_tests`，改为在 finalize 前验证已发布 CLI 的 `v-npm-*` tag、registry `gitHead` 和 exact-SHA 双门；两份本地通用 publisher 也移除并拒绝 CLI。同一失败 SHA 中的 VS Code inline-chat 重复注册、错误 `open/runAction` API 与未定义 `outputLog` 已合并为单一 decorator/ChatProvider 接线，六个公开命令同步进入 canonical capability manifest；release/changelog/gate/IDE 定向矩阵本地为 **11 files / 63 tests passed**。这些结果不能替代 `0.162.194` final SHA 的完整权威门。

### 2026-08-04 IDE 宿主门与命令面收敛增量

- PR `#84` 的 `4b5102a3136cdf42dc85f239f04099ca4cd94030` 为 VS Code 真实宿主阶段加入 bounded CDP settlement 与受控进程终止：CDP journey 已结算但 Electron 未退出时，runner 会先记录 phase-scoped progress，再请求 shutdown，并在有界窗口后终止子进程树；正常退出不会触发额外 kill。诊断发现继续限制在 release-relevant host logs。`extension-host-runner.test.cjs` 本地 **15/15** 通过。该 SHA 的 IDE Extensions run `30923194189` 仍在运行，不能提前写成 macOS/Windows/JetBrains 宿主矩阵成功。
- CLI 第三批命令面迁移把 15 个明确标注为 V2 governance/in-memory overlay 的入口收敛到虚拟 `cc lab ...`：`execbe`、`itbudget`、`mcpscaf`、`meminj`、`orchgov`、`promcomp`、`seshhook`、`seshsearch`、`seshtail`、`seshu`、`slotfill`、`svccont`、`tms`、`topiccls`、`uprof`。旧顶层拼写继续路由到同一 lazy registrar，stderr-only 提示至少保留到 `0.164.0`；`todo`、`subagent`、`webfetch` 与 `planmode` 保持产品级顶层入口。注册图仍为 175、净增长 0，推荐面从 166 降为 151；manifest、README、namespace help 与四种 shell completion 同源生成。
- `56c87fa5d0` 已提交第三批迁移，`d4a5590db7` 已提交对应 CLI 审计记录。核心 lifecycle/lazy/completion 为 **3 files / 39 tests passed**；加入 command registration、changelog 与 docs drift 后为 **103 tests passed**。本机完整 `index.js` 冷导入约 20 秒，扩大矩阵使用显式 30 秒测试预算而没有修改 CI 默认契约；manifest/help-index/completion 漂移检查、Node syntax 与 `git diff --check` 均通过。`4b5102a313` 的在途 IDE 结果只能授权该 SHA，不能与更晚提交拼接为 release GO；当前 PR head 仍须重新取得 CLI/IDE 权威门。
- `4b5102a313` 的 macOS job 已明确失败而非再次 hang：driver/扩展/loopback bridge 均 ready，但上传 artifact 的 CDP trace 在 120 秒内始终为 `targets=[]`；runner 随后有界终止 host 并成功写出完整失败 evidence。旧 launch argv 把 workspace positional argument 放在 remote-debugging switches 之前；`86c936d0d9` 已将所有 switches 前置、加入 `--new-window` 并把 workspace 放到最后，本地扩展单测 **36/36**。新 head 的 IDE Extensions `30924118914` 与 CLI CI `30924121034` 已排队；PR evidence 记录的是 Actions 合并候选，不替代最终 main/tag exact-SHA 门。

### 2026-08-05 固定命令中继、真实矩阵与最终边界

- `350ef5601e` 用一次性 256-bit token 控制固定命令 `chainlesschainTests.runHostJourney`，绕过 signed macOS host 未调度 `extensionTestsPath` 的上游 bootstrap 缺陷；正常产品启动没有 token，命令调度与 Webview relay 均保持 inert。relay 只接受 `snapshot`、`send` 和固定语义 `click`，不暴露 `eval`、任意 JavaScript 或通用选择器。`521c35a77a` 再移除 macOS relay 启动中的 Inspector；`7f323aa188` 激活外层 `.app` 并等待真实 Chat focus；`54db9c8ff7` 将无响应协议探针的单次重建宽限从 750ms 调整为 5 秒，版本不匹配仍立即 fail closed。
- 真实工件已经把阻断逐层缩小。`350ef5601e` 的 IDE run `30947671847` 首次证明 driver 进入、已安装 VSIX 激活、17 个必需命令与 bridge 均通过；`c9d46b4a7a` 的 macOS job（workflow `30948364724` 后续被取消）证明视图为 `view=true/visible=true`，但 `ready=false/protocol=false`。去除 Inspector 的 `521c35a77a` / `30958675402`、前台激活并等待 focus 的 `7f323aa188` / `30959379151`、以及 5 秒冷启动宽限的 `54db9c8ff7` / `30959722716` 均在同一 Webview 消息边界失败；每轮都上传了 phase-scoped progress、trace、redacted host logs 与 immutable evidence manifest。由此可排除 VSIX 未安装、产品未激活、driver 未运行、命令缺失、bridge 未启动、视图隐藏、Inspector 干扰、应用未激活、focus 未落定和 750ms 冷启动误判；不能排除 macOS hosted runner/VS Code Webview renderer 的上游限制。
- `9327ea0ad2` 的 IDE Extensions `30948438452` 提供当前最完整的非 macOS 对照：capability manifest、Windows VS Code host、JetBrains 2024.2/2025.2 × Windows/Linux/macOS 六格和 JetBrains build 成功；macOS VS Code stable 失败，minimum 与依赖该门的 Linux/package job 跳过。因此 Q4a 已从“真实矩阵未运行”升级为“矩阵已运行且阻断边界明确”，但没有达到通过。PR artifact 内的 `releaseCommit` 可指向 Actions merge candidate；判断 exact-SHA 时以 run `headSha`、job 与 artifact 三者共同核对，不把 merge candidate 字段当作分支 head。
- 候选 VS Code 版本已前进到 `0.37.41`；本地扩展单测 **58/58**、Webview 协议专项 **8/8**、VSIX self-test **11/11**、打包元数据 **18/18**、Prettier 与 `git diff --check` 均通过。`54db9c8ff7` 的 Workspace Publish Staleness Check `30959722765` 成功，关闭 `0.37.40` 未随源代码变化递增的问题。这些是实现/包验证证据，不替代失败的 macOS real-DOM host gate。
- CLI 命令面已完成计划中的三批迁移：总计 25 个长尾旧顶层入口保留兼容别名并收敛到 `cc lab ...`，注册图仍为 175、净增长 0，推荐顶层命令从 166 降至 151；核心与扩大矩阵分别为 **39/39**、**103/103**。`9327ea0ad2` 的 CLI CI `30948439064` 成功；`7f323aa188` 的 CLI Strict Sandbox `30959399318` 成功，但同 SHA 的 CLI CI 被后续提交取消且 IDE macOS 门失败，不能拼接为 release GO。
- `2bad1d4c94` 对隔离的 macOS real-DOM host 强制 `--disable-gpu` 软件渲染并启用 `--verbose` renderer/service-worker 诊断；IDE run `30960717723` 证明该实验没有修复 current stable，但 minimum、Windows、JetBrains 六格与 JetBrains build 均成功。软件渲染因此只保留为诊断/隔离参数，不构成关闭 stable 门的依据。
- `61f8235105` 停止对 token-gated fresh Webview 执行无消息超时重建，并把 minimum step 改为在 stable 失败后仍取证；本地扩展单测 **59/59**、协议专项 **8/8** 通过。IDE run `30960237759` 的 macOS stable `1.131.0` 仍失败；minimum `1.85.2` 则完整通过：initial/restart 两阶段均发现真实 `vscode-webview://` target，stream、retry、plan approval、permission、interrupt 与 IDE restart-resume 全部通过，evidence manifest 为 `result=passed`、`evidenceComplete=true`、15 个 artifact。该结果证明 relay 与生产 Webview 在同一 runner 的受支持最低宿主可用，并把剩余阻断精确到 current stable 路径；它不允许跳过 stable 门。
- 已结算候选 `f72dc01c4f` 完成了本轮权威证据收口：CLI CI `30960881488` 与 CLI Strict Sandbox `30960888570` 同 SHA 成功；IDE Extensions `30960881338` 的 capability、Windows VS Code、macOS minimum、JetBrains 六格及 build 成功，但 macOS current stable job `92164590186` 失败，最终 VSIX package/publish job `92165638115` 跳过。该提交不再有“CLI 尚未结算”或“软件渲染待验证”的状态歧义，发布阻断精确为 required stable host、不可变发布工件与公开渠道回读。
- `b86ea54468` 的 IDE run `30964554075` 证明固定 stable `1.130.0` 仍失败、minimum `1.85.2` 再次完整通过，因此不采用 host pin。`5860747f0a` 恢复 current stable 门、删除会让宿主更早停滞的 `--disable-gpu`，并使用 VS Code 自动化自身采用的 `--use-inmemory-secretstorage`，避免 fresh macOS CI profile 在 Webview 启动前阻塞于无界面的 Keychain。
- 已结算候选 `fb39e2cbe6` 完成最终 host/CI 取证：IDE Extensions `30965289911` 整体 success；Windows job `92177910508`、macOS job `92177910568` 和 Linux/package job `92178949946` 均让 stable + minimum 完整通过，JetBrains 六格及 build/compatibility 也成功。macOS `1.131.0` 与 `1.85.2` 的 evidence 均为 `result=passed`、`evidenceComplete=true`、15 个 artifact。CLI CI `30965290031` 与 CLI Strict Sandbox `30965296663` 同 SHA 成功，staleness gate `30965289905` 成功。
- 在没有形成新的发布授权时，GitHub tag `v-npm-0-162-194` 随后被创建并固定指向 `fb39e2cbe6`。正式 npm workflow `30966796114` 的 `exact-sha-gate` 成功，但 `test` job 在 Agent SDK build 中因 `packages/agent-sdk/node_modules/.bin/tsc` 不存在而失败；`dry-run`、`package-cli` 和 `publish` 全部跳过。npm registry 回读仍为 `0.162.193` / `gitHead=e8e7ba274b487ed491c04ec3359841a0e545debb`。失败 tag 不移动、不删除、不重跑 publish；若修复后继续发布，版本与 tag 身份必须前进。

P0-4/Q4a 的 required local-host gate 已由 `fb39e2cbe6` 关闭；CLI 后续前进到 `0.162.197`，发布 SHA
`a03ad1b548` 的 required CLI/IDE 门成功，`v-npm-0-162-197` 已发布到 npm。原 workflow
`30979565206` 在 npm 接受上传后因注册表即时回读传播延迟红灯；不得把红灯抹成成功，但 npm 公开状态已由
PR `#86` 的只读 run `30983536627` 独立闭合：npm 11 签名/SLSA、精确 tag/SHA/workflow、原 run
artifact、manifest 双摘要与公开 tarball 逐字节一致均通过。当前 **CLI npm 子范围为 GO**；VS Code
多根与多窗口子门分别由 PR `#99`、PR `#102` 关闭，Open VSX 已发布并精确回读 `0.37.47`。整体路线图
仍为 **product release NO-GO**，因为 Microsoft Marketplace、Desktop/native 与 JetBrains 作者签名、
fresh-profile 安装/升级/回滚、签名 ARM64 公开发行、remote/SSH/WSL/devcontainer、网络抖动、8 小时 soak、
真实 DeliveryCoordinator provider、任意断电/fsync 与外部 anchor 一致性和
R4/R5 产品旅程仍未关闭。不得把 CLI npm、Open VSX 或 VS Code 本地宿主子门成功外推为这些范围已经交付。

### 2026-08-09 IDE ARM64、公开渠道与证据诚信更新

- 当前远端 `main` 为 `9fa5162e668fa9b457b0d70d54a0806773c363ab`。IDE 发布提交
  `9db081c5a9b24d1c51952e86513b0520620feadd` 是其祖先；PR `#111`、`#117`、`#118`
  均已合并，剩余同名远端分支无需再次合并。
- `IDE Extensions` run
  [31269850856](https://github.com/chainlesschain/chainlesschain/actions/runs/31269850856) 与
  `IDE ARM64 Validation` run
  [31269850865](https://github.com/chainlesschain/chainlesschain/actions/runs/31269850865)
  在 exact SHA `9db081c5...` 成功；ARM64 11-cell aggregate 完成 SHA、架构、矩阵和 artifact
  digest 校验。故 **IDE ARM64 real-host exact-SHA 子门已关闭**，但这不关闭作者签名、公开渠道
  fresh-profile ARM64 安装/升级/回滚。
- 不可变 tag `ide-vscode-v0.37.47` 与 `ide-jetbrains-v0.4.83` 均指向
  `9db081c5...`。Open VSX `0.37.47` verified 且可下载，公开 VSIX SHA-256 为
  `a89b59bd30a3dfd44d8c1e703a7067c6e95471ef8e1cea2c152d1b927c1bf5a0`；
  JetBrains `0.4.83` 已 `approve=true`、`listed=true`、`hidden=false`，公开 ZIP SHA-256
  为 `c17f18ba5a3f826e94295b5a3fddf2fb8259c5ebd1fc41108c94d82aaad8d03a`。
- JetBrains tag run 明确 author-signing 的 certificate/private-key/password 均未配置，
  `:signPlugin` 被跳过。Microsoft Gallery 对 `chainlesschain.chainlesschain-ide` 的精确查询仍为
  `TotalCount=0`，且 `0.37.47` tag 没有 Marketplace backfill run；因此两个签名/官方分发子门仍是
  NO-GO。
- 旧 `p0-host-evidence` manifest 把 `remote × 三 OS × 100 runs` 写成 required，却只校验
  fixture 和测试文件存在，不能证明任何 runtime matrix。本次 evidence-integrity 修订将 manifest
  contract 与 runtime evidence 分离，并把 local 与 remote 分案；scoped verifier 只做 envelope 的结构、
  矩阵计数、调用者声明 SHA、outcome 与 digest 字段一致性审计，不验证 CI provenance、checkout HEAD 或
  外部 artifact 内容。当前没有可信 generic producer/attestation，且 manifest 尚不能表达版本、具体远程环境、
  硬件、网络 profile、sample measurement 与 P95，因此 `--require-release-ready` 必须明确失败，绝不返回
  `releaseReady=true`。待这些 authority 和维度接线后，才能启用真正的发布就绪判定。

### 2026-08-09 剩余任务计数与可执行清单

计数必须先固定口径，避免把阶段别名、已关闭子门或同一外部阻塞重复计算：

> 下述更新口径随 PR #191 通过最终 exact-head required checks 并合并后生效；合并前仍以本文件后文记录的
> 15/19、4/19 与 15 个剩余工作包为 `main` 事实。

- **原始路线图编号口径：14/19 项尚未关闭，5/19 项完成。** 分母为 S0-1～S0-3（3）、
  Q0～Q4b（6，Q4 拆为 Q4a/Q4b）、P1-1～P1-5（5）、P2-1～P2-5（5）；R0～R5
  只是阶段别名，不重复计数。完成项为 P0-1/Q1 Workbench、P0-2/Q2 Rewind、P2-1/R5 因果可观测性、
  P2-2/R5 自动补全与 P2-3/R5 多 Agent 合并审阅。
- 若不拆 Q4a/Q4b，则口径为 **13/18 项尚未关闭**。Q4a 中的 local-host、多根、多窗口与 IDE
  ARM64 real-host exact-SHA 是已关闭子门，但 Remote、公开渠道、故障矩阵和 soak 尚未使整个 Q4a/Q4b 关闭。
- 按可并行实施、并把同一外部阻塞合并后的工程口径，当前为 **14 个剩余工作包**。相较 2026-08-09
  的 22 个，已合并的 `needs_input` 可恢复通知减 1，堆叠 PR #166、#168、#169、#172 在完成各自
  exact-head 门并进入 `main` 后再减 4，P2-2/R5 自动补全由 PR #178 关闭后再减 1，P2-1/R5 因果
  可观测性的仓库内关闭候选由 commit `2e5036922e27d4b11eeb3007e91d8400555c87aa` 再减 1，P2-3/R5
  多 Agent 合并审阅由 PR #191 再减 1。该数字用于排期，
  不与 17 个原始编号相加；fresh-profile 升降级并入相应渠道，已关闭的 CLI 冷恢复 SLO、两小时 CLI soak、
  local-host、多根、多窗口和 IDE ARM64 exact-SHA 不再重复计入。

| #   | 路线映射             | 状态                                                                                          | 剩余工作与关闭条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | S0-1                 | 部分完成                                                                                      | 完成即时撤权、跨进程 kill/restart、任意断电/fsync、独立 anti-rollback anchor、强篡改者与长期安全矩阵；现有 restart/resume 与 crash/尾截断证据不能外推。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | S0-2                 | 部分完成                                                                                      | 完成恶意 Skill/MCP 来源、effect/ledger、动态撤销、进程树与长期对抗矩阵；direct handler 已阻断和默认确认门已过，但不等于完整信任闭环。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | S0-3                 | 部分完成                                                                                      | `dc79df9f11` 已提交 production `agentLoop` 双轮语义压缩、结构化 handoff、唯读工具轨迹、严格 evidence verifier 与夜间/手动真实 provider workflow；本地三平台前置 loopback 设计中 100 个独立 run 已通过，但明确不计入真实 provider 证据。仍需在 exact commit 上完成至少 100 次真实 provider 长会话与全宿主长期一致性矩阵；synthetic 矩阵及 CLI 冷恢复 SLO 已关闭。                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | Q0 / R0              | 未完成/外部阻塞                                                                               | 配置发布 authority，将同一验证 VSIX 发布到 Microsoft Marketplace，并完成 exact publisher/version/digest 回读及 stock VS Code 搜索、安装、升级、回滚；当前 Gallery 精确查询为 `TotalCount=0`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5   | Q0 / Q4b             | 部分完成/外部阻塞                                                                             | 为 JetBrains `0.4.86` 配置作者证书、私钥和密码，执行 `signPlugin`，再做签名包 fresh-profile 安装、升级、失败恢复与回滚；`0.4.86` 已由 tag workflow 上传并通过发布后 Marketplace listing 验证，但 author signing 与签名包升降级/回滚仍未关闭。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6   | Q0 / Q4b             | 部分完成/外部阻塞                                                                             | 完成 Desktop/native x64+ARM64 签名发行、完整 generation transaction、真实 taskkill/断电、Authenticode、macOS signing/notarization 与公开资产逐字节回读；unsigned CLI 六目标不能替代。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | Q3 / P0-3 / R2       | 部分完成/外部验证延后                                                                         | PR #142 的 production GitHub adapter、`cc artifacts delivery-run` 与 crash-safe exact-effect runner 已通过 merge commit `e08a61530225e3371849e54f7cfb03efb8cf63a1` 进入 `main`，仓库内实现子门已关闭；仍需通过该入口真实执行 gates→preview→review→fix→PR/CI→受控 merge→archive，并关闭真实 ruleset/branch protection、required checks/review、权限及外部不可变归档回读。本期延后该外部 live journey；fake adapter、人工 PR 和仓库内测试不能替代。                                                                                                                                                                                                                                                                                                                          |
| 8   | Q4a/Q4b / P0-4       | 未完成                                                                                        | 完成 Remote/SSH/WSL/devcontainer/Codespaces 与 JetBrains Gateway 的 stock/minimum × OS 真实宿主矩阵。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 9   | Q4a/Q4b / P0-4       | 未完成                                                                                        | 完成网络抖动、断线重连、Bridge/CLI restart、失败注入、原请求重附与 authority 一致性矩阵。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 10  | Q4b / P0-4           | 未完成                                                                                        | 完成独立 8 小时 IDE reconnect/recovery soak 与 nightly live-provider trajectory；两小时 CLI reliability soak 不能替代。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 11  | P1-1 / R4            | 部分完成（definition/preflight/persistence/replay/run-admission 子门已实现）                  | `58bfdceb84` 在现有 Cowork DAG 上增加版本化 definition/digest、raw plan 与 fail-closed capability/location/permission/sandbox/data-boundary/credential/规模/成本预检；`b6dc772384` 增加 current envelope、content-addressed immutable versions、legacy-unversioned 边界、CLI/WS exact-digest replay 与 run history digest；`c5f14a2105` 强制 CLI/WS 双重 authority reverify、secret-free admission/execution-policy digest、全局并发门、timeout physical-settle 与严格 run record，阻断时不发 started、不执行 task、不写 history。仍需真实宿主 attestation、生成式编排、运行中 pause/resume、恢复后阶段最多一次、耐久 history 与 artifact/ledger/checkpoint lineage、Workbench/双 IDE 消费、跨 host 矩阵和 plugin/marketplace 分发。                                       |
| 12  | P1-2 / R4            | 部分完成                                                                                      | CLI 已将当前环境事实作为版本化 `session_start` authority，提供五类位置比较与 secret-free、fail-closed handoff preview；仍需真实 WSL/SSH/Cloud/Container launch/resume、跨宿主 evidence/authority 继承、IDE/Desktop 创建面和完整远程/故障矩阵。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 13  | P1-3 / R4            | 部分完成（执行底座、通知、控制面与裁决已合并）                                                | `main` 已覆盖 Agenda/Automation/Cowork/Loop/Routine/monitor、统一 daemon、`needs_input` 可恢复通知、Agenda/Cowork 的 IANA timezone/DST/missed-run policy、outcome-unknown 人工裁决，以及 #166/#168/#169/#172 的 scoped channel dispatch、真实权限/预算 preflight、双 IDE Automation Center 与 Routine 统一控制面。仍需运行中 task 的条件式暂停/恢复、绑定原 run id 的越界 incident、完整迁移/回滚、磁盘故障和长期矩阵。                                                                                                                                                                                                                                                                                                                                                    |
| 14  | R4 budget            | 部分完成                                                                                      | 把预算 authority 从 foundation/local adapters 接到 production root、全部 turn/token/tool 及 WS/REPL/headless 入口。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 15  | R4 command lifecycle | 部分完成                                                                                      | 观测三批兼容别名的完整弃用周期，依据使用证据决定移除或延长；不得提前删除入口。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 16  | P1-4 / R5            | 部分完成（Context/Permission 主体子切片已实现）                                               | CLI authority 已提供 workspace 绑定、TTL、CAS revoke 和逐工具调用刷新，双 IDE 只通过 CLI 创建/撤销 scoped rule，managed deny 不可放宽；双 IDE 已共享确定性 context contract、持久 pin/remove/budget 偏好、交互式 chips，并实际采集有界 Git diff、project memory 与 metadata-only MCP resource catalog；legacy、`/v2`、`/v6-preview` 已通过 browser-safe twin 消费同一 contract，默认关闭且只丰富临时 outbound prompt。`cc-permission-side-effect-center/v1` 已关联标准/MCP ledger 的实际文件、network origin、process/runtime、credential 变量名、决策/来源、调用链和保守恢复覆盖，双 IDE Policy Viewer 消费当前 Chat session；外部资源不会被本地 checkpoint 误报为可恢复，敏感值与完整命令不进入投影。仍需长期并发、真实宿主、故障注入和跨入口凭据不泄露/恢复诚实性矩阵。 |
| 17  | P1-5 / R5            | 部分完成（catalog、选择、执行/impact、本地 readback 与仓库内远端 activation evidence 已实现） | `392ed39d24` 提供多来源 catalog；`b93f354679` 持久 install authority；`07f4d41fa6` 增加 update impact；`6bd8c11271` 增加 exact registry-set selection；`3d171256fb` 提供 immutable local readback；`6b7e183c33` 在 add/upgrade activation 前完成有界 signature/public-key/SBOM 抓取、digest/SPKI、staged-manifest Ed25519、transactional finalize/rollback 及版本化 provenance/readback。仍需真实 private registry、publisher/组织 trust root 与 key revocation、代理/PAC/custom CA、air-gapped/offline、依赖冲突、完整供应链故障矩阵和外部环境验证。                                                                                                                                                                                                                      |
| 18  | P2-1 / R5            | **完成**                                                                                      | commit `2e5036922e27d4b11eeb3007e91d8400555c87aa` 已实现受验证 session→delivery→diff/gate/artifact/PR/merge 因果图、workspace/team/policy 过滤与 JSON 导出、token/USD/retry/retry-ratio/tool P50/P95 预算告警；`call-ledger@1` 在 REPL/headless/stream/WS、Cowork、子 Agent、隔离 Skill、语义压缩及 direct-model/tool 路径按真实 call ID fail closed。关闭证据见末尾记录。                                                                                                                                                                                                                                                                                                                                                                                                 |
| 19  | P2-2 / R5            | **完成**                                                                                      | PR [#178](https://github.com/chainlesschain/chainlesschain/pull/178) 已将双 IDE 默认关闭的自动 ghost-text、650ms cancellable debounce、exact-context dedupe/cache、滚动请求/字符预算、质量回退与 P50/P95 SLO 合入 `main`；手动补全保持兼容，自动路径超时/拒绝时 fail quiet。exact head 与真实宿主证据见末尾关闭记录。                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 20  | P2-3 / R5            | **完成**（PR #191 合并后生效）                                                                | commit `df91365c76b28ba9263146ad7f4a767d52d135c7` 提供 CLI 权威的稳定 file/hunk 决策、跨分支单提交发布、持久冲突解释与保留历史的受控 rollback；VS Code 与 JetBrains 只消费严格 v1 evidence 和 exact argv，关闭证据见末尾记录。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 21  | P2-4 / R5            | 部分完成                                                                                      | 完成键盘全路径、屏幕阅读器、焦点恢复、长会话虚拟化、大 diff/日志和 100+ session 的量化验收。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 22  | P2-5 / R5            | 未决                                                                                          | 作出 WebIDE 产品定位决定；若无独立浏览器 IDE 目标则收敛为 Preview/Artifact，否则补齐仓库树、搜索、诊断、Git/Diff、Terminal 与 session 绑定。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

当前结论仍为 **product release NO-GO**。最短关键路径是：先关闭 #1～#7 的安全/公开分发/真实交付门，
再以 #8～#10 的远程、故障和长期宿主证据关闭 R3，最后推进 #11～#22 的 R4/R5 产品化。

### 2026-08-10 已完成子门、在途验证与本期范围

以下更新采用 exact commit、公开 workflow 与公网回读作为完成证据；它只修订已经关闭的子门，不把
部分完成的路线项整体改写为完成，也不回写正在开发或尚未终态的 CI：

- **CLI npm `0.163.3` exact-SHA 发布子门已完成。** 最终 release SHA
  `17fcf6aa7917dd0fcc83b3ab5204c196bbb81758` 的
  [CLI CI `31329476135`](https://github.com/chainlesschain/chainlesschain/actions/runs/31329476135)、
  [CLI Strict Sandbox `31329476020`](https://github.com/chainlesschain/chainlesschain/actions/runs/31329476020)
  和正式两小时 reliability/MCP soak
  [`31329539092`](https://github.com/chainlesschain/chainlesschain/actions/runs/31329539092) 成功；不可变
  tag `v-npm-0-163-3` 精确指向该 SHA。正式 npm 发布
  [`31335579227`](https://github.com/chainlesschain/chainlesschain/actions/runs/31335579227) 与独立公网回读
  [`31336362525`](https://github.com/chainlesschain/chainlesschain/actions/runs/31336362525) 均成功，
  SLSA/Sigstore provenance 有效，registry tarball 与 workflow 不可变 artifact 逐字节一致。该结论关闭
  CLI npm 发布与 covered-scope 两小时恶意 MCP 观察子门，不外推到 Microsoft Marketplace、签名
  Desktop/native、Remote IDE 或八小时 IDE soak。
- **S0-2 的固定 npm MCP capsule 宿主四边界强制子门已完成。** PR
  [#138](https://github.com/chainlesschain/chainlesschain/pull/138) 的 exact head
  `d2fcbddc99526dd3027e2de187345d240a1b48a2` 以 merge commit
  `d3520301a8b018d81cb658a6c9a2ef8dfb83b6d1` 进入 `main`。受信 client 对物化 capsule 强制加入不可降级的
  `code-snapshot`、`filesystem`、`network`、`process-tree` floor；弱调用方 policy、缺失边界和 authority
  replay 均 fail closed。该 head 的 [CLI Strict Sandbox `31338888334`](https://github.com/chainlesschain/chainlesschain/actions/runs/31338888334)、
  [P0-S formal matrix `31338888348`](https://github.com/chainlesschain/chainlesschain/actions/runs/31338888348)
  与 [reliability/MCP soak `31338888360`](https://github.com/chainlesschain/chainlesschain/actions/runs/31338888360)
  全部成功。S0-2 整项仍为**部分完成**：真实 Client→Broker→OS 物化 capsule live chain 已形成
  PR #140 的 exact-SHA 三宿主验证候选，但尚待合并；macOS 原子 runtime exec/open、任意
  native/shared-library 递归闭包、远端即时撤权/distributed authority 与长期对抗矩阵仍必须分别关闭。

以下候选实现尚未进入 `main`。它们只记录仓库内内部子门的完成候选，不构成整项完成、release GO
或外部 live authority 已关闭；合并状态及 required Actions 必须按 exact head 重新核验：

- **PR #142 的内部实现候选已完成 exact-SHA 多平台验证。** PR
  [#142](https://github.com/chainlesschain/chainlesschain/pull/142) 的已验证 head
  `1b1838d6a1054beb4d576cf06c7b8aa49642c957` 上，
  [CLI CI `31364412646`](https://github.com/chainlesschain/chainlesschain/actions/runs/31364412646)、
  [CLI Strict Sandbox `31364412497`](https://github.com/chainlesschain/chainlesschain/actions/runs/31364412497)
  与 [CLI Session Host Consistency `31364412418`](https://github.com/chainlesschain/chainlesschain/actions/runs/31364412418)
  均成功。该 PR 仍为开放候选、尚待合并；这些结果绑定该 exact head，不表示实现已经进入 `main`。
- **S0-1 的 durable host revocation 与 MCP send-time admission 内部子门已形成完成候选。**
  PR #142 的 implementation commit `f696f87833efdfd2823c0a3bdb0c67a45a08ab09` 将 session-host
  lease 升级为持久化 `revocationEpoch`、fencing token、跨进程锁和永久 `requestId` 幂等撤权；
  MCP recovery adjudication 在 verified-head CAS 前先持久撤销原 host generation。stdio、WebSocket、
  HTTP 的实际 write/send/fetch 及重连重试统一经过 one-shot send-time admission，REPL、headless、
  stream、WebSocket 与 sub-agent host 均已接入。S0-1 整项仍为**部分完成**：已 dispatch 的外部
  effect 无法召回，强制 kill/restart、独立 anti-rollback、同 UID 强篡改者、任意断电以及长期分布式
  对抗矩阵仍未关闭。
- **S0-3 的 provider-backed semantic compaction 与 canonical settlement 内部子门已形成完成候选。**
  同一 implementation commit `f696f87833efdfd2823c0a3bdb0c67a45a08ab09` 将 tool-free provider
  compaction 接入 agent core、REPL、headless runner/stream 与 WebSocket；provider 调用在 canonical
  writer lock 外执行，持久化前按 exact canonical message projection 做单次 CAS，只有成功 settlement
  才替换 live messages，已知 usage 只结算一次，usage unknown 时 fail closed，并提供 structured
  extractive degradation。S0-3 整项仍为**部分完成**：in-memory microcompact prepass 尚无 durable
  canonical CAS，真实 provider 长会话、可验收 structured handoff/live trajectory 与全宿主长期一致性
  矩阵仍未关闭。
- **#7 的 production delivery provider、CLI 入口与 crash-safe runner 内部子门已形成完成候选。**
  PR #142 中的 implementation commit `03a4b71324ffff5571a776d472264ae043229ca4` 实现
  `cc artifacts delivery-run` 及 gates、preview、review、fix、PR、CI、evidence、merge、archive 九类
  production 动作；绑定 exact base/head/diff/`changedFiles`，并在 review、CI 与 merge 前重新 fail
  closed 核验。pending effect 在 provider 调用前以 lock、fsync、same-directory rename 持久化，
  settlement 重新核对 flow、revision、state digest 与 effect id，fixer 限定为 hermetic exact-file
  工具面。已验证 head `1b1838d6a1054beb4d576cf06c7b8aa49642c957` 还兼容 Windows
  pathname/opened-file stat projection，同时保持 descriptor identity 与 staging-path replacement 拒绝。
  #7 整项仍为**部分完成/外部验证延后**：真实 GitHub PR→CI→受控 merge→archive journey、
  ruleset/branch protection、权限及外部不可变/WORM 归档回读仍未关闭。
- **S0-2 的真实 materialized Client→Broker→OS live chain 内部子门已形成完成候选。** PR
  [#140](https://github.com/chainlesschain/chainlesschain/pull/140) 的已验证 commit
  `241929977ad35003f51a3465b150bc2ca624dd3b` 保持固定 npm MCP capsule 的 `code-snapshot`、
  `filesystem`、`network`、`process-tree` 不可降级 floor，并补齐真实 Client→Broker→OS、background
  与 direct plugin 边界；nested child readiness 使用继承 fd 和 exact PID/process-group/session 绑定，
  不依赖被 Linux seccomp 禁止的 socketpair。该 head 的
  [CLI CI `31364409253`](https://github.com/chainlesschain/chainlesschain/actions/runs/31364409253) 与
  [CLI Strict Sandbox `31364409081`](https://github.com/chainlesschain/chainlesschain/actions/runs/31364409081)
  均完成 Linux、Windows、macOS 验证并成功。此后 PR head 已由并发开发继续前移，新增提交必须另做
  exact-SHA 验证；PR 仍待合并。S0-2 整项仍为**部分完成**：macOS 原子 runtime exec/open、任意
  native/shared-library 递归闭包、远端即时撤权/distributed authority 及长期对抗矩阵仍未关闭。
- **本期执行范围调整。** 按 2026-08-10 的执行决定，#4～#6，以及 #8～#10 中必须依赖第三方发布
  authority、签名证书/私钥、专用 Remote/Codespaces/Gateway 宿主或独立八小时资源的部分，本期不执行，
  统一保留为“未完成／外部阻塞／本期延后”。延后不是完成、豁免或 release GO；本期仅推进 #1～#3、#7
  及 R4/R5 中可由仓库代码与现有 GitHub Actions 权限独立验证的内部子门，不据此关闭整项。

截至当前实现候选，原始编号为 **15/19 尚未关闭**；已合并的 `needs_input` 子门、#166/#168/#169/#172
四个 Automation/Routine 工程包、PR #178 的 P2-2 整项及 P2-1 因果可观测性关闭候选使工程口径由
22 个降为 **15 个剩余工作包**。
只有对应整项的全部关闭条件与权威证据满足后，才减少原始编号计数；
开放候选在合并前也不能从工程口径中扣除。

### 2026-08-11～12 已合并内部子门、scheduler 收敛与 IDE 插件发布

- **PR #142 与 PR #140 已进入 `main`。** PR
  [#142](https://github.com/chainlesschain/chainlesschain/pull/142) 已于 2026-08-10 合并，merge commit 为
  `e08a61530225e3371849e54f7cfb03efb8cf63a1`；因此其 durable host revocation、MCP send-time
  admission、provider-backed semantic compaction、production GitHub delivery adapter 与 crash-safe
  exact-effect runner 不再是“尚待合并”的仓库内候选。PR
  [#140](https://github.com/chainlesschain/chainlesschain/pull/140) 也已通过 merge commit
  `bb2f34ad905250fd5e8cde6c7d3fb0d4d8bd49ab` 进入 `main`，真实 materialized
  Client→Broker→OS MCP capsule chain 的仓库内子门随之落地。两项合并均不关闭真实 GitHub
  delivery live journey、外部 WORM 归档、远端即时撤权、macOS 原子 runtime exec/open、任意
  native/shared-library 递归闭包或长期对抗矩阵。
- **S0-3 durable microcompact canonical CAS 已进入 `main`。** PR
  [#146](https://github.com/chainlesschain/chainlesschain/pull/146) 的 implementation commit
  `f19af7c794961eaaa08307eed0d5ca9e312d3e18` 将 microcompact checkpoint 持久化，并以 canonical
  message revision/digest CAS 拒绝 stale settlement；checkpoint 去除运行时 marker，trace context 在
  broker 边界继续传播。合并最新 `main` 后的 exact head
  `6ab6e69f35b0b73676d948bd9f75abb730a3cbec` 已通过
  [CLI CI `31462529252`](https://github.com/chainlesschain/chainlesschain/actions/runs/31462529252)、
  [CLI Strict Sandbox `31462529148`](https://github.com/chainlesschain/chainlesschain/actions/runs/31462529148)、
  [P0-S formal matrix `31462529163`](https://github.com/chainlesschain/chainlesschain/actions/runs/31462529163)、
  [CLI Session Host Consistency `31462529135`](https://github.com/chainlesschain/chainlesschain/actions/runs/31462529135)
  与 [CI Tests `31462529141`](https://github.com/chainlesschain/chainlesschain/actions/runs/31462529141)。PR #146
  随后以 merge commit `67fa3c4a4be34471c5aa2a01a01980087d2a827f` 进入 `main`；该合并只关闭
  durable microcompact 的仓库内子门，不能替代真实 provider 长会话、structured handoff/live
  trajectory 与全宿主长期一致性验收。
- **S0-3 live-provider trajectory 仓库内执行器已提交。** commit `dc79df9f11`
  新增版本化双 compaction trajectory、production `agentLoop`→provider transport→`read_file`
  实际路径、结构化 handoff 九字段冻结事实校验、有界/排他的 secret-free
  evidence 发布与严格聚合器。本地 100-run loopback 完成 100 个唯一 run ID、600 次
  provider HTTP 请求，28 项定向测试通过；workflow 只把 secret 注入 exact
  `github.sha` 的 live 调用步骤。这些是执行路径与证据合同子门，loopback 明确不计入
  manifest 的 `external-live-provider × 100` 关闭条件，尚未产生真实 provider/外部宿主运行证据。
- **Open VSX `0.37.49` 已公开发布。** PR
  [#147](https://github.com/chainlesschain/chainlesschain/pull/147) 以 merge commit
  `2c76d288a266ee2bc0a6292629af9d6415d596d8` 进入 `main`。同一 exact SHA 的
  [IDE Extensions `31448636327`](https://github.com/chainlesschain/chainlesschain/actions/runs/31448636327)
  与 [IDE ARM64 Host Validation `31448636315`](https://github.com/chainlesschain/chainlesschain/actions/runs/31448636315)
  均成功；不可变 tag `ide-vscode-v0.37.49` 触发
  [发布 run `31450287978`](https://github.com/chainlesschain/chainlesschain/actions/runs/31450287978)，
  Windows/macOS/Linux 的 stable + minimum `1.85.2`、不可变 VSIX 校验、Open VSX credential、publish
  和 listing verify 全部成功。独立公开 API 回读确认 `0.37.49` 为 latest、listed 且可下载。
- **JetBrains `0.4.85` 已公开发布。** 同一 exact SHA 的不可变 tag
  `ide-jetbrains-v0.4.85` 触发
  [发布 run `31458637231`](https://github.com/chainlesschain/chainlesschain/actions/runs/31458637231)：
  `2024.2`/`2025.2` × Windows、macOS、Linux 六格真实宿主、smoke、JUnit、插件构建、结构与
  Plugin Verifier 均成功，`publishPlugin` 上传成功。独立公开 API 回读确认 `0.4.85` 已
  `approve=true`、`listed=true`、`hidden=false`。作者签名 secret 仍未配置，本次上传继续沿用现有
  unsigned Marketplace 路径；公开 listed 不替代作者签名与签名包 fresh-profile 升降级/回滚子门。
- 两个 IDE 版本说明均推荐配套 CLI `0.163.4`，并概述 immutable MCP capsule build inputs、
  platform-bound live capsule evidence、durable revision-CAS scheduler storage foundation，以及从
  `0.163.3` 延续的 background worktree isolation/fenced ownership。IDE 版本本身是维护发布，不宣称
  新增 IDE UI 行为。
- **Agenda wakeup/cron 已接入统一 scheduler kernel。** PR
  [#152](https://github.com/chainlesschain/chainlesschain/pull/152) 的 exact head
  `7ed345b36672bd5895af33c0a384727e23d132e2` 已通过
  [CLI CI `31462505648`](https://github.com/chainlesschain/chainlesschain/actions/runs/31462505648) 与
  [CLI Strict Sandbox `31462505731`](https://github.com/chainlesschain/chainlesschain/actions/runs/31462505731)，
  并以 merge commit `fa80965ab37fb7231c7be448294cb34e5aa6a0c5` 进入 `main`。生产 `agenda run`
  的 wakeup/cron 现使用版本化 snapshot/digest、expected-revision CAS、owner/fence、旧/新 driver
  互斥和 durable execution evidence；成功后结算失败可恢复而不重复启动 Agent，start-only 或成功结果
  未能落盘则按 outcome-unknown fail closed。该子门不包含 Agenda monitor、真实共享权限/预算 resolver、
  IANA timezone/DST、standalone daemon、磁盘回滚或长期故障矩阵，因此 #13 与完整 scheduler 收敛仍为
  **部分完成**。
- **Automation cron scheduler 已合并。** PR
  [#154](https://github.com/chainlesschain/chainlesschain/pull/154) 的 implementation commit
  `15a641fa85` 将 active flow 的 cron 执行接入统一 scheduler kernel，并增加生产
  `cc automation run-scheduled`：canonical flow snapshot/digest 与最小 `automation.execute` authority
  绑定 logical occurrence；停机期间多个 missed run 收敛为一次；pause、定义变更和 authority tamper 在
  connector 执行前拒绝；deterministic execution id 允许恢复已落盘成功，start-only 结果未知则拒绝自动
  重放。当前本地扩大回归为 11 个文件 **285/285 passed**，目标 ESLint 0 error，Prettier、help-index、
  Node syntax、`git diff --check` 与 993 项 npm dry-run pack 均通过。最终功能 head
  `930531a9868349d5a11ada5468a1b5abd12509ba` 已以 merge commit
  `af041852e6bf13be1604e44c277aabee37800bea` 进入 `main`。随后 PR #167 只修复发布后 canonical
  CHANGELOG 与内置 artifact 漂移；其 follow-up head `b609c30fb9bd1ce28f2e6a2dcdd3a092a9815f1e` 的
  [CLI CI `31551868259`](https://github.com/chainlesschain/chainlesschain/actions/runs/31551868259) attempt 2
  为 53/53 jobs success，[CLI Strict Sandbox `31551894005`](https://github.com/chainlesschain/chainlesschain/actions/runs/31551894005)
  为三平台 3/3 success。该合并关闭 Automation cron/runtime/history 仓库内子门，但不关闭
  trigger scope、needs-input 通知、真实权限/预算预检、完整 Automation Center UI 或 scheduler 长期矩阵。
- **Cowork cron scheduler 的仓库内子门已合并。** PR
  [#155](https://github.com/chainlesschain/chainlesschain/pull/155) 的 implementation commit
  `05d14ec338` 将每个确定性 cron fire 绑定到不可变 schedule/task snapshot、最小
  `cowork.execute` authority、owner/fence 与 durable delivery evidence；同一 fire 的并发 driver 只启动一次，
  已落盘成功可恢复，start-only 或 task 返回失败而未形成可信成功证据时不会伪装为成功。final head
  `41a6a02fc9250a88a82a77d75c101b64a20c60e1` 以 merge commit
  `2eb17a0c0cae9ac3cd46bb47d33fb5e3bde1f52e` 进入 `main`；其
  [CLI Strict Sandbox `31469776963`](https://github.com/chainlesschain/chainlesschain/actions/runs/31469776963)、
  CI Tests、Full Test Automation、E2E、PR Tests 与审计门已成功。该 head 的聚合 CLI CI 在合并时仍未终态，
  因此不能把已成功子门拼接成完整 exact-head CLI CI 结论；合并也不关闭完整 Automation Center、统一预算/
  权限预检、standalone daemon 或长期故障矩阵。
- **Loop iteration scheduler 已合并。** PR
  [#156](https://github.com/chainlesschain/chainlesschain/pull/156) 的 implementation head
  `b8495975c84e15068acdc557eed727f3938faac7` 将生产 `cc loop` 每次 iteration 接入统一 kernel，
  使用不可变 definition snapshot、最小 process/agent authority、持久 iteration identity 与 CAS session event；
  live contention 返回 busy，已结算结果恢复而不重复 spawn，claim 后崩溃且结果未知则以
  `LOOP_SCHEDULER_OUTCOME_UNKNOWN` 拒绝重放。提交前定向 unit/integration/E2E 为 **82/82 passed**，
  [CLI Strict Sandbox `31471958501`](https://github.com/chainlesschain/chainlesschain/actions/runs/31471958501)
  已成功；测试 HOME 隔离修复后的 final exact head
  `0cf5716b15e58eeb8f10f8b977a22c2bcf43152e` 又通过
  [CLI CI `31475518293`](https://github.com/chainlesschain/chainlesschain/actions/runs/31475518293)；同一 head 的
  [CLI Strict Sandbox `31475526493`](https://github.com/chainlesschain/chainlesschain/actions/runs/31475526493)
  为三平台 3/3 success。PR 以 merge commit `98c6831329b82850b407d6ec97c3ad6b5dd31570`
  进入 `main`，最终 checks 为 **89 passed / 7 skipped / 0 failed / 0 pending**。
- **Routine GitHub event scheduler 已合并。** PR
  [#157](https://github.com/chainlesschain/chainlesschain/pull/157) 的 implementation head
  `ad8ac3b591c058ed9c2dde3f7a52602502d1ece3` 先持久化不可变 GitHub event batch occurrence 再推进
  legacy cursor，以 per-batch job identity 保留新旧批次并发恢复能力；cursor 写失败会 deduplicate 到同一
  occurrence，十进制 GitHub event id 单调比较且不回退，repository rebinding 在执行前拒绝。提交前
  Scheduler/Routine 回归 **61/61 passed**，ESLint、Prettier、command manifest/help/completions 与 npm pack
  dry-run 通过。旧 head 的 CLI CI 两次只在同一个无关 Windows `headless-runner` EPIPE cleanup 用例命中
  15 秒高负载 timeout；完整测试文件本地为 **81/81 passed**，因此只把该用例的 CI 容差提高到 30 秒，
  功能断言不变。修复后的 exact head `6460e49b011720a3a233ffc7f0fd803bfe52e3c3` 的
  [CLI CI `31541236578`](https://github.com/chainlesschain/chainlesschain/actions/runs/31541236578) 为 53/53 jobs
  success，[CLI Strict Sandbox `31541236398`](https://github.com/chainlesschain/chainlesschain/actions/runs/31541236398)
  为三平台 3/3 success；PR 以 merge commit `cb354ef9c9744e7b60d837c077108750f7aae0a4`
  进入 `main`。
- **Agenda monitor scheduler 已合并。** PR
  [#158](https://github.com/chainlesschain/chainlesschain/pull/158) 的 implementation commit
  `2ddc09d4cb16034f8082630238d0c9e2ba0640df` 将生产 command/file/HTTP monitor observation 接入统一
  kernel，并绑定独立 `monitor.observe` authority。monitor check、re-arm/match 与 scheduler evidence 在同一
  JSONL replacement 中结算；双 live driver 只观察一次，持久化结果可恢复且不重复通知，运行中崩溃的未知
  observation outcome fail closed，observed output 保持 transient；`81474931222e9f3f872d60fed9ef91c17311dbd3`
  又使缺失 notification handler 显式产生可见错误而非静默丢弃。提交前全部 Scheduler Kernel 相关回归
  **161/161 passed**，ESLint、Prettier、command manifest/help/completions 与 npm pack dry-run 通过；
  final exact head `81474931222e9f3f872d60fed9ef91c17311dbd3` 的
  [CLI CI `31474844368`](https://github.com/chainlesschain/chainlesschain/actions/runs/31474844368) 与
  [CLI Strict Sandbox `31474844226`](https://github.com/chainlesschain/chainlesschain/actions/runs/31474844226)
  均成功，PR checks 为 **92 passed / 7 skipped / 0 failed / 0 pending**；PR 以 merge commit
  `650154f8b4c045ae48ab68b88a9da7165b4af557` 进入 `main`。
- **Agenda 已补齐 IANA timezone/DST 调度语义。** PR
  [#159](https://github.com/chainlesschain/chainlesschain/pull/159) 的 exact head
  `d472854abc5e6fec730478ce6cdfebea1be177fb` 将 Agenda schedule 的 IANA zone、DST gap/fold、离线
  missed-run 与下一次 occurrence 计算收敛到版本化定义，避免用宿主本地时区或固定 offset 产生漂移；
  本地相关 10 文件为 **192/192 passed**，manifest/help/completions、lint、format、syntax 与 pack 均通过。
  [CLI CI `31477873086`](https://github.com/chainlesschain/chainlesschain/actions/runs/31477873086) 与
  [CLI Strict Sandbox `31477873007`](https://github.com/chainlesschain/chainlesschain/actions/runs/31477873007)
  均成功，PR checks 为 **99 passed / 7 skipped / 0 failed / 0 pending**；PR 以 merge commit
  `fda5212638f7e3d84c8317c7a96b17bbbe137629` 进入 `main`。这关闭 #13 的
  timezone/DST 内部子门，但不关闭 Automation Center 产品整项。
- **统一 foreground scheduler daemon 已合并。** PR
  [#161](https://github.com/chainlesschain/chainlesschain/pull/161) 的 exact head
  `0e7d016d48a413642fb4e465c4138118a4e03426` 增加 `cc daemon scheduler run`，在一个受 supervisor
  管理的进程内承载 Agenda 与 Cowork domain，共享 scheduler store、串行 tick、隔离 domain failure、
  有界保留 summary，并支持 `--domains`、`--interval`、`--once`、NDJSON 及 SIGINT/SIGTERM graceful
  shutdown。调度/Agenda/Cowork/background 扩大回归为 **190/190 passed**，生成物、lint、format 与真实
  isolated-home CLI smoke 均通过；
  [CLI CI `31500072164`](https://github.com/chainlesschain/chainlesschain/actions/runs/31500072164) 与
  [IDE Extensions `31500072356`](https://github.com/chainlesschain/chainlesschain/actions/runs/31500072356)
  成功，PR checks 为 **107 passed / 8 skipped / 0 failed / 0 pending**。首次 JetBrains Ubuntu 2025.2
  失败发生在 Microsoft APT 源 403、产品测试前，failed-job rerun 成功；该基础设施红灯未被抹除。PR 以
  merge commit `08881ec573158745a7c4a1443082966167168520` 进入 `main`，随后同一 exact head 的
  [CLI Strict Sandbox `31543095330`](https://github.com/chainlesschain/chainlesschain/actions/runs/31543095330)
  为三平台 3/3 success。
- #13 的 scheduler execution foundation 已从 Agenda 单域前进到 `main` 中的 Agenda/Automation/Cowork/
  Loop/Routine/monitor、统一 daemon、durable `needs_input` 通知、Agenda/Cowork 的 IANA timezone/DST/
  missed-run policy，以及 governed Automation/Routine 控制面。截至该批控制面合并时，原始编号为
  **17/19 尚未关闭**，通知与四个控制面工程包合并后为 **17 个剩余工作包**；随后 PR #178 的 P2-2
  整项关闭将当前口径继续降为 16/19 与 16 个工作包。
  Microsoft Marketplace、JetBrains
  作者签名、Remote/SSH/WSL/devcontainer/Codespaces/Gateway、网络故障矩阵、八小时 IDE soak 与真实
  delivery live journey 继续按“外部阻塞／本期延后”处理；整体 product release 仍为 **NO-GO**。

### 2026-08-12 最新 `main`、发布与开放候选

- **CLI npm `0.163.5` 发布闭环已完成。** release SHA
  `095087c1e859a8451ce01ed58c59af3fede756fd` 由不可变 tag `v-npm-0-163-5` 指向；
  [CLI CI `31509337185`](https://github.com/chainlesschain/chainlesschain/actions/runs/31509337185) attempt 2
  为 53/53 jobs success，[CLI Strict Sandbox `31509336854`](https://github.com/chainlesschain/chainlesschain/actions/runs/31509336854)
  为三平台 3/3 success。专用 [npm 发布 workflow `31509336832`](https://github.com/chainlesschain/chainlesschain/actions/runs/31509336832)
  attempt 2 完成 exact-SHA gate、不可变 artifact、SBOM、Trusted Publishing 与签名 provenance；独立
  [公网 readback `31514940240`](https://github.com/chainlesschain/chainlesschain/actions/runs/31514940240)
  证明 registry tarball 与 GitHub artifact 逐字节一致。该公开包不包含随后合并的 PR #154、#156～#159、
  #161、#165、#173，不能把当前 `main` 的后续能力外推到 `0.163.5`。
- **durable `needs_input` 可恢复通知已合并。** PR
  [#165](https://github.com/chainlesschain/chainlesschain/pull/165) 的 exact head
  `e1ddf7a39ce9a437d86668600e7a665fc0740d95` 将不含提示正文的 incident 投影到已配置 channel，持久记录
  delivery outcome，并提供受控 retry；含糊交付必须显式 `--force`。该 head 以 merge commit
  `65022a4c9bfe3e1c15a11ba878c39b075b8417f8` 进入 `main`，PR rollup 为 110 success、8 skipped、
  0 failed、0 pending。该合并正式关闭 1 个工程工作包，但不等于 Automation Center 整项完成。
- **Agenda/Cowork 时区与 missed-run 内部子门已合并。** PR #159 的 Agenda IANA zone/DST 语义以 merge
  commit `fda5212638f7e3d84c8317c7a96b17bbbe137629` 进入 `main`；PR
  [#173](https://github.com/chainlesschain/chainlesschain/pull/173) 又把 Cowork cron、next-fire cursor、DST
  repeated wall time 与显式 collapse policy 收敛到同一策略，merge commit 为当前核验 head
  `90f266efeeec38913587c9b92203315cedec6206`。PR #173 的本地/定向证据为 44 文件 1213/1213，exact head 的
  [CLI Strict Sandbox `31562610018`](https://github.com/chainlesschain/chainlesschain/actions/runs/31562610018)
  为三平台 3/3 success，[CLI CI `31562505163`](https://github.com/chainlesschain/chainlesschain/actions/runs/31562505163)
  为 53/53 jobs success；该仓库内时区策略子门的 exact-head 双门已关闭，但不替代公开发布与长期矩阵。
- **PR #174 仅为开放的证据文档跟进。** exact head `0723e5382cc23a160419b45ec0f33eae0a2bb082`
  只更新 `docs/cli-claude-code-gap-analysis-2026-08-01.md`，记录 PR #159/#173 双门并把该文档的
  P2-4 内部剩余子项由 6 降为 5；其 CI 尚未终态，且不修改产品代码、当前 `main` 或本清单计数。
- **四个 Automation/Routine 工程包已完成 exact-head 门并全部合并。** PR
  [#166](https://github.com/chainlesschain/chainlesschain/pull/166) 的 scoped Webhook/Telegram event dispatch
  以 `4681fd84a2d08854d2e3a2e51dae0f7c71a7e0df` 进入 `main`；PR
  [#168](https://github.com/chainlesschain/chainlesschain/pull/168) 的 flow principal、`automation:execute`、
  connector RBAC 与 rolling-window run/action budget preflight 以
  `1e7efd50d23589f35b2f76fadaeb46a10187c6ab` 进入 `main`。PR
  [#172](https://github.com/chainlesschain/chainlesschain/pull/172) 先把 Routine cron/one-shot/webhook/GitHub
  trigger 与 CAS 创建/编辑合入 #169，随后 PR
  [#169](https://github.com/chainlesschain/chainlesschain/pull/169) 以 exact head
  `91a3d9c6e5d6a76f06788cf869ac37acd4284a7b` 的 **15/15 workflows success** 收口 CLI-owned versioned
  projection、scope/preflight/history、run-now、失败重跑、暂停/恢复、禁用/删除及双 IDE Automation Center，
  并以 `074bc471297b4ae0f02445b9bdb30d4dd11d5536` 进入 `main`。该 exact main 发布提交的
  [IDE Extensions `31586925945`](https://github.com/chainlesschain/chainlesschain/actions/runs/31586925945)
  与 [IDE ARM64 Host Validation `31586925848`](https://github.com/chainlesschain/chainlesschain/actions/runs/31586925848)
  均成功，故四个工程包已从排期口径扣除，工程剩余数由 21 降至 **17**。P1-3 原始整项仍需运行中
  task 的条件式暂停/恢复、绑定原 run id 的越界 incident、未知结果裁决、迁移/回滚、磁盘故障与三平台
  长期 soak，故 **17/19** 原始编号不变。
- **Open VSX `0.37.50` 与 JetBrains Marketplace `0.4.86` 已从同一 exact SHA 发布。** 不可变 tags
  `ide-vscode-v0.37.50` 与 `ide-jetbrains-v0.4.86` 均绑定
  `074bc471297b4ae0f02445b9bdb30d4dd11d5536`。Open VSX
  [发布 run `31589542152`](https://github.com/chainlesschain/chainlesschain/actions/runs/31589542152) 完成不可变
  VSIX、Windows/macOS/Linux stable + minimum `1.85.2`、publish 与公开 listing 回读。JetBrains
  [发布 run `31589547677`](https://github.com/chainlesschain/chainlesschain/actions/runs/31589547677) 的
  `2024.2`/`2025.2` × 三 OS 六格真实宿主全部成功；attempt 1 因 Gradle 临时未解析到 `IC-2024.2`
  installer 而在 smoke 配置期失败，attempt 2 越过同一点并完成 smoke、JUnit、build、Plugin Verifier、
  Marketplace upload 及 post-publish listing verification。该发布不关闭 Microsoft Marketplace、JetBrains
  作者签名或 signed fresh-profile 升降级/回滚。
- **CLI `0.163.6` 已从 exact release SHA 正式发布。** 不可变 tag `v-npm-0-163-6` 绑定
  `85c3577c887003fea98d0a159603cd359506f09b`；[CLI CI `31595865423`](https://github.com/chainlesschain/chainlesschain/actions/runs/31595865423)、
  [CLI Strict Sandbox `31595865206`](https://github.com/chainlesschain/chainlesschain/actions/runs/31595865206)、
  [npm 发布 `31595865181`](https://github.com/chainlesschain/chainlesschain/actions/runs/31595865181)与
  [独立公网回读 `31597577056`](https://github.com/chainlesschain/chainlesschain/actions/runs/31597577056)均成功。
  npm `latest` 为 `0.163.6`，公开 tarball SHA-1 为 `18bb9d807a4a35a36cf9049dcc15f67eb47bbfa6`；
  这使 governed Automation/Routine commands 成为公开安装契约，但仍不关闭本节记录的 outcome-unknown、
  mixed-version migration/rollback、磁盘故障、长期 soak 或 signed native 边界。
- **两个 IDE 版本说明已概述 CLI `0.163.5` 新能力及兼容边界。** README/CHANGELOG 说明 durable unified
  scheduler runtime、Routine/Agenda/Cowork migration、snapshot-bound authority/fencing、bounded retry、
  dead-letter、crash recovery 与 durable compaction；同时明确 `0.163.5` 早于 governed
  Automation/Routine commands，现有 chat/bridge 可继续使用，新 Automation Center 控制需要后续 CLI，
  不把尚未公开的 CLI 命令误写成 `0.163.5` 已交付。
- **P2-2 / R5 自动 ghost-text completion 已关闭。** PR
  [#178](https://github.com/chainlesschain/chainlesschain/pull/178) 的 implementation head
  `2f809762cc2ba0e9a5ef721e7954e0f38fa8bc54` 以 merge commit
  `106e6115d153f574e4f665f38ffe2fecdce5c779` 进入 `main`。VS Code 与 JetBrains 均采用默认关闭的独立
  自动补全开关、650ms cancellable debounce、exact-context in-flight dedupe 与 TTL/LRU cache、滚动一小时
  请求/上下文字符预算、最大字符/行数及重复后缀/散文/代码围栏质量拒绝；自动路径以 5 秒为端到端硬上界，
  统计 P50/P95 且在不满足 SLO 时 fail quiet，手动补全入口保持兼容。exact head 的
  [IDE Extensions `31599212078`](https://github.com/chainlesschain/chainlesschain/actions/runs/31599212078)
  整体成功（12 success、1 个发布条件分支 skipped、0 failed），覆盖 VS Code stable/minimum `1.85.2` ×
  Windows/macOS/Linux、JetBrains `2024.2`/`2025.2` × 三 OS、不可变 VSIX、JUnit、build 与 Plugin Verifier；
  [IDE ARM64 Host Validation `31599211993`](https://github.com/chainlesschain/chainlesschain/actions/runs/31599211993)
  也整体成功并聚合 11-cell exact-SHA 证据。提交前 VS Code unit 91/91、自动补全定向集 28/28、
  extension-host 51/51、JetBrains test/smokeTest 1276/1276 与新增 policy 7/7 均通过。因此原始编号由
  17/19 降为 **16/19 尚未关闭（3/19 完成）**，工程口径由 17 降为 **16 个剩余工作包**。此结论关闭
  仓库内 P2-2 整项。随后 `ide-vscode-v0.37.51` 与 `ide-jetbrains-v0.4.87` 均绑定 exact SHA
  `dd0adad7b1ba500400042ff62d138ec7784a5722` 完成上传与公开 listing 回读；外部阻塞和本期延后项不因此改变。

### 2026-08-13 P2-1 / R5 因果可观测性关闭记录

- **受验证的因果链、导出与预算门已完成。** implementation commit
  `2e5036922e27d4b11eeb3007e91d8400555c87aa` 新增 `cc session observability-authority` 与
  `cc session observability`，把 hash-chain/sidecar/anti-rollback 已验证的精确 session revision 绑定到
  delivery state，再投影为 `session -> delivery -> diff/gate/artifact/PR/merge` 图。请求可按
  workspace/team/policy 精确过滤并导出 secret-free JSON；报告保留 pricing table digest、report digest、
  evidence completeness 与 token/cache/USD、LLM retry/retry-ratio、tool call/error/retry、P50/P95/timing
  coverage，并对未知用量、未计价模型、缺失工具结算及不完整因果证据保守返回 `unknown` 或
  `exceeded`，不把缺失证据当零。
- **生产调用边界已 fail closed。** scoped session 使用 `call-ledger@1`，在 REPL、headless runner、
  stream-json、WebSocket、chat/compact、Cowork debate/compare、子 Agent、后台子 Agent、隔离 Skill、
  语义压缩及 `/auto`/`/plan execute` direct tool 路径中，于 provider/tool 执行前持久化真实
  started，并用同一真实 call ID 写 known/unknown settlement；重试、取消、budget exhaustion、冻结
  compactor、后台终止和 writer failure 均不能留下可继续计费的静默缺口。session transcript 同时要求
  `session_start` 唯一且为首条，repair/resume/causal projection 对迟到或重复声明 fail closed。
- **计量完整性与成本精度已关闭假通过反例。** input/output 必须由 provider 明确给出非负 safe integer；
  cache 字段若出现则必须合法且 alias 不冲突，缺失/非法/歧义用量转为 unknown。USD authority 和硬预算
  保留未舍入成本；实测 `gpt-5-nano` 单个 input token 为 `5e-8 USD`，`maxUsd: 0` 正确判为
  `exceeded`。报告不保存 prompt、响应正文、tool 参数/结果或 provider 错误文本。
- **本地关闭证据。** 当前改动覆盖的 **38 个测试文件全部通过：1034 passed / 1 skipped**（Vitest，
  `--maxWorkers=1 --fileParallelism=false --testTimeout=15000`）；63 个变更 JS/JSON/Markdown 文件通过
  Prettier check，29 个 `packages/cli/src` JavaScript 文件通过 `node --check`，`git diff --check` 通过。
  三路独立终审最终结论均为剩余 **P0=0、P1=0**；其中 child/provider 边界 11 个文件 223 项通过，
  session structure 3 个文件 173 passed / 1 skipped 且 causal CLI integration 17/17，通过后的安全复核
  8 个文件为 359 passed / 1 skipped。一次额外的宽范围 session-host consistency gate 在本机 180 秒无
  输出超时，未把该次运行冒充成功；它不否定上述直接覆盖的合法 legacy、repair、resume 与 causal
  regression，但后续 exact-head GitHub Actions 仍应作为合并门记录。

因此 P2-1/R5 从“未完成”改为“完成”，原始编号口径由 **16/19 尚未关闭、3/19 完成**降为
**15/19 尚未关闭、4/19 完成**，工程口径由 **16** 降为 **15 个剩余工作包**。这只关闭仓库内
因果可观测性整项，不改变 Microsoft Marketplace、JetBrains 作者签名、Remote 宿主、网络故障矩阵、
八小时 IDE soak、真实 delivery live journey 等“外部阻塞／本期延后”项，也不把整体 product release
改写为 GO。

### 2026-08-14 后台会话 authority 与恢复安全加固候选

- **后台交互恢复改为受验证的单写者协议。** PR [#182](https://github.com/chainlesschain/chainlesschain/pull/182)
  的后续候选把 interaction journal 的 pending/terminal snapshot 置于 transcript writer lock、完整结构验证和
  expected-fingerprint CAS 下，保留 first-terminal-wins；模糊 append 只有在 verified exact readback 与预期
  snapshot 完全一致时才视为已提交。worker、supervisor 和恢复路径分别使用精确 owner PID、lease/fencing/
  revocation 绑定的 delegated write authority 或 recovery lease，迟到响应不能越过已丢失的 live child 重新
  结算 pending 请求。
- **启动、终止和故障边界 fail closed。** fresh background session 只在 job 与 state 同时保留同一 generation
  的 immutable bootstrap evidence、且尚无 turn/pending interaction 时允许 transcript 暂时 absent；missing、
  tombstoned、conflict 或结构损坏均拒绝启动。`--bg --ephemeral` 在 CLI、launch profile、argv 和 supervisor
  四层拒绝。child IPC 增加私有 nonce、sender PID 与 delegation owner 校验；`error -> close`、状态投影清理
  失败和异常 child exit 均不能吞掉已持久化 terminal answer。stop/remove 只对带成功 fresh creation-time
  probe 的精确进程身份发送信号，缺 anchor、探针失败、PID reuse 或 self PID 一律保留可见 stop-pending/
  lost 状态而不误杀。POSIX stop 又将 detached process group 纳入执行存活判定：leader 已成为 zombie 或被
  reap 时，只要 group 仍有可执行成员或 group snapshot 不可验证，就继续保持 stop-pending 并阻止恢复和
  worktree 删除；只有空 group 或全 zombie group 才可判定停止。
- **本地候选验证已通过。** supervisor 为 **69 passed / 7 skipped**；session store、persistence failure 与
  host lease 为 **160 passed / 1 skipped**；interaction journal/resolver、worker termination 与 headless resume
  为 **38/38**；argv/profile/worktree 与四个真实后台 worker/transport 回归为 **31/31**，合计
  **298 passed / 8 skipped**，并通过变更文件语法检查与 `git diff --check`。独立审计额外发现并关闭损坏
  `agentPid=self` 可能误杀当前 stop 进程的反例。本记录是 exact-head GitHub Actions 和合并前的内部候选证据，
  **不减少 15 个剩余工作包**，也不替代 S0-1 的任意断电/fsync、强篡改者、跨宿主即时撤权及长期矩阵。

### 2026-08-14 Automation Center 运行态控制、IDE 发布与长期门状态

- **迁移/回滚内部子门已经进入 `main`。** PR
  [#183](https://github.com/chainlesschain/chainlesschain/pull/183) 以 merge commit
  `1fa938fae7` 收敛 Agenda、Cowork Cron、Routine、Automation 与 Loop 五域的 typed source identity、
  schema-v5 migration journal、target-first recovery、exact evidence/CAS rollback 与 crash-safe source restore。
  因此 P1-3 的 mixed-version migration/rollback 不再列为当前仓库候选的剩余子门。
- **运行中 occurrence 的协作式 checkpoint 控制已进入 `main`。** PR
  [#187](https://github.com/chainlesschain/chainlesschain/pull/187) 以 merge commit
  `f044181efbfc7fc9bcff38558eda556ae671a9e3` 合入 scheduler store schema-v6，为 pause/resume、
  control revision、owner/fence、checkpoint 与 dead-letter requeue 提供持久 CAS；Agenda、Automation、
  Automation Event、Cowork Cron、Loop 与 Routine 六个生产 adapter 只在声明的 `before_execute` /
  `adapter_checkpoint` safe point 暂停，并从持久 checkpoint 恢复。未知 job kind、能力或 commit 状态均
  fail closed，不能把重新 claim 冒充新 attempt。
- **越界 incident 与恢复动作绑定原执行证据。** Automation 在执行前和 send-time 校验 exact principal、
  connector/action/effect/resource boundary；拒绝结果持久绑定原 run/occurrence，incident retry/cancel 又绑定
  exact incident revision、最新 dead-letter fence 与 occurrence。相同失败证据幂等，变化证据形成独立
  observation；只有 authoritative run success 才能 resolve 对应 incident。Center JSON 只输出 allowlist
  code 与有界去敏字段，不传播 native error、路径、secret、payload、authority 或 checkpoint。
- **双 IDE 发布版本保持已发布 CLI 兼容。** VS Code/Open VSX `0.37.52` 与 JetBrains `0.4.88` 仅接受
  精确配对的 Center v2/schemaVersion 2 或 v3/schemaVersion 3。公开 CLI `0.163.7` 的 v2 继续提供既有
  item actions，runtime/incidents 为空；只有后续 exact-gated CLI 的 v3 才显示 pause/resume 与
  incident retry/cancel，并在执行前刷新且重核 revision/fence/control revision/exact argv。
- **本地候选证据已通过，但不冒充正式长期门。** 受影响 CLI 回归为 **20 文件 423 passed / 1 skipped**，VS Code unit
  为 **97/97**，CLI→VS Code 定向集为 **4/4**，JetBrains Automation Center 为 **8/8** 且
  `buildPlugin` 成功；35 个变更 JavaScript 文件通过 `node --check`，全部相关文件通过 Prettier 与
  `git diff --check`。Windows 真实 SQLite FULL、rollback/quick-check/reopen 及 incident 生命周期的
  1-cycle smoke 通过，但它显式标记 `releaseGateEligible: false`，不计入长期发布证据。
- **exact `main` IDE 门已经关闭。** merge SHA 上的
  [IDE Extensions `31768054186`](https://github.com/chainlesschain/chainlesschain/actions/runs/31768054186)
  完整成功，覆盖不可变 VSIX、VS Code stable/minimum `1.85.2` × Windows/macOS/Linux、JetBrains
  `2024.2`/`2025.2` × 三 OS、JUnit、build 与 Plugin Verifier；
  [IDE ARM64 Host Validation `31768054225`](https://github.com/chainlesschain/chainlesschain/actions/runs/31768054225)
  也完整成功并聚合 11-cell exact-SHA 证据。
- **Open VSX `0.37.52` 已公开发布。** 不可变 tag `ide-vscode-v0.37.52` 绑定 exact merge SHA；
  [发布 run `31772012272`](https://github.com/chainlesschain/chainlesschain/actions/runs/31772012272) attempt 2
  通过 Windows/macOS/Linux stable + minimum `1.85.2`、发布与官方 API 回读，`0.37.52` 已可列出、下载且为
  latest。attempt 1 的 macOS job 在任何产品测试前因 `actions/download-artifact@v6` 临时 403 失败，重跑后
  同一点及全部后续门成功；Microsoft Marketplace 分支按既定范围跳过，不能由 Open VSX 结果外推为已发布。
- **JetBrains `0.4.88` 已上传，公开 listing 仍待人工审核。** 不可变 tag
  `ide-jetbrains-v0.4.88` 绑定同一 exact merge SHA；
  [发布 run `31772012844`](https://github.com/chainlesschain/chainlesschain/actions/runs/31772012844) 完整成功，
  覆盖 `2024.2`/`2025.2` × Windows/Linux/macOS 六格真实宿主、build、Plugin Verifier 与 Marketplace
  upload。post-publish 门接受官方的 pending manual review 状态；官方 API 尚未返回 `0.4.88` 公开版本，
  因而不能写成已公开 listing，JetBrains 作者签名也仍是开放项。
- **正式 scheduler 长期门已重新调度但尚未完成。** exact merge SHA 的
  [CLI Reliability Soak `31773664173`](https://github.com/chainlesschain/chainlesschain/actions/runs/31773664173)
  以 `duration_seconds=7200`、每平台不少于 `1000` cycles 运行 Linux/Windows/macOS aggregate；本文更新时
  9 个 jobs 均为 running/pending，不能计作通过。

PR、exact `main` GitHub Actions 与双 IDE 三平台真实宿主/制品门已经完成；P1-3 仍须等待 scheduler
Linux/Windows/macOS 每平台不少于 2 小时且不少于 1000 cycles 的正式 aggregate 终态成功。该长期门完成前，
P1-3 和当前 **15/19 尚未关闭、4/19 完成**的计数均不减少；Open VSX `0.37.52` 已公开发布，JetBrains
`0.4.88` 仅能写成上传成功并等待人工审核。

### 2026-08-14 P2-3 多 Agent 合并审阅关闭记录

- **CLI 成为唯一合并 authority。** implementation commit
  `df91365c76b28ba9263146ad7f4a767d52d135c7` 新增 `cc team merge-review` 严格 v1 协议：preview 将 exact
  base/candidate OID、file/hunk identity、patch digest 与 plan digest 绑定；apply 先以 append-only hash-chain
  和 revision CAS 持久化 actor/host/reason/selection，再用临时 index 组合跨分支选择并以一个 direct-child
  commit fast-forward 发布；conflict evidence 持久、可解释且不推进基础分支。
- **rollback 不重写或丢弃历史。** 已发布结果通过带 exact base tree、父节点为 published commit 的 retained
  rollback commit 恢复，再以 clean-worktree + exact-ref 条件执行 `--ff-only`；不使用 `reset --hard`。并发推进、
  脏工作树、branch/OID/evidence/revision 漂移均 fail closed，结果与回滚 commit 另由受控 ref 保留。
- **双 IDE 只消费 CLI evidence。** VS Code 与 JetBrains 已移除 merge preview/apply 的直接 `git merge` /
  `merge-tree` 权限，严格校验 schema、字段、稳定 ID、revision/digest、selection、conflict 与 exact action argv；
  两端支持 file/hunk 选择、冲突说明、发布后受控 rollback。v1 单次 durable selection 统一限制 100 个 ID，最大
  恢复 action 为 215 个参数，低于两端 256 参数上限。
- **双 IDE 发布候选已同步。** VS Code source candidate 升为 `0.37.53`，JetBrains source candidate 升为
  `0.4.89`，两端 changelog/README 均说明 CLI-owned merge-review、file/hunk 选择、持久冲突证据、单提交发布与
  retained-history rollback。公开 CLI `0.163.7` 尚不包含该命令；这些控制只在后续 exact-gated CLI 发布后出现。
  本候选版本记录不冒充 Open VSX 或 JetBrains Marketplace 已发布证据。
- **安全与本地回归已关闭。** Git 子进程剥离继承的全部非白名单 `GIT_*`，禁用 hooks、gpg signing、
  fsmonitor、external diff/textconv、active filter/custom driver 与 pager；真实反例覆盖恶意
  `GIT_DIR/GIT_WORK_TREE/GIT_CONFIG_*`、post-merge hook、filter、rename/mode metadata、冲突和 selective hunk。
  最终 core/store/VS Code 定向集为 **39/39**，真实 Git 为 **5/5**；JetBrains final targeted test 重新编译并
  `BUILD SUCCESSFUL`，此前全量 `test` 也成功；ESLint、Node 语法、Prettier、命令 manifest/help/completion 与
  `git diff --check` 通过。独立终审确认 Git 环境隔离和 IDE action 上限两个阻塞均关闭，未发现新的 S0/S1。

本节的“完成”、下方 **14/19 尚未关闭、5/19 完成**以及 **14 个剩余工作包**只在承载本记录的
[PR #191](https://github.com/chainlesschain/chainlesschain/pull/191) 通过最终 exact-head required checks 并合并后
生效；合并前 `main` 仍保持 15/19、4/19 与 15 个剩余工作包，不能用本地通过替代 GitHub Actions。

### 2026-08-15 P1-3 Automation Center 长期门关闭记录

- **原定正式长期门已经终态成功。** Automation Center 的生产实现与双 IDE 门绑定 exact merge SHA
  `f044181efbfc7fc9bcff38558eda556ae671a9e3`；同一 SHA 的
  [CLI Reliability Soak `31773664173`](https://github.com/chainlesschain/chainlesschain/actions/runs/31773664173)
  已完成并成功。Linux、macOS、Windows 的 scheduler jobs 均连续运行不少于 7200 秒，随后 aggregate job
  成功；不存在用短时 PR smoke、旧 SHA 或单平台结果替代正式矩阵的问题。
- **不可变 aggregate 精确满足退出指标。** artifact
  `scheduler-reliability-soak-formal-aggregate-f044181efbfc7fc9bcff38558eda556ae671a9e3-1`
  （ID `9211705590`，workflow artifact digest
  `sha256:44143aedf4b407b094f53274307421bd3cf4ad5cc8088ff12b25620716bcde14`）回读为
  `result=passed`、`qualifyingEvidence=true`、`releaseGateEligible=true`。统一 profile 为
  `durationSeconds=7200`、每平台 `cycles=1000`；三平台合计 3000 cycles、9000 jobs、18000 claims、
  3000 次 contention/stale-lease/retry/pause/checkpoint/resume/dead-letter/requeue，
  `duplicateExecutions=0`、`invariantViolations=0`，并包含三平台各自 evidence SHA-256。
- **当前 main 上的独立 kernel 门再次复验通过。** 修复 worker 失败证据保留后的 exact
  `github/main@7d3120fc1ed7ef1c32c183d3235ced4a39589e1f` 通过
  [CLI Scheduler Kernel Soak `31821080101`](https://github.com/chainlesschain/chainlesschain/actions/runs/31821080101)：
  Linux、macOS、Windows 与 aggregate 四个 jobs 全部成功。aggregate artifact
  `cli-scheduler-soak-aggregate-7d3120fc1ed7ef1c32c183d3235ced4a39589e1f-1`
  （ID `9230910714`，digest
  `sha256:f90462a1f23ceb6a59fd07f65643a80a523ee92cdbae403ddc201124142c59dc`）为
  `result=passed`，逐平台 profile 均为 7200 秒、100 rounds × 10 steady occurrences；三平台合计
  3000 steady occurrences、600 次 hard kill、3603 个 effects。
- **关闭边界保持窄且可审计。** P1-3 原始退出条件是已实现的统一 daemon/通知/时区/权限预算/
  outcome-unknown/迁移回滚/checkpoint pause-resume/incident/磁盘故障/双 IDE 控制面，再加三平台每平台
  不少于 2 小时且不少于 1000 cycles 的正式 aggregate；这些条件现已全部满足，故 P1-3 从本节起正式关闭。
  `31821080101` 同时是独立 72 小时 scheduler kernel campaign 的第一个有效 segment（`1/4`，定义新的
  `T0`），但后续 `+25h/+50h/+75h` segment 与 campaign verifier 仍属于更长观察证据；它们不被写成
  已完成，也不反向重开已满足原始退出条件的 P1-3。Remote IDE、8 小时 IDE soak、签名发行与外部
  live-provider trajectory 继续归属 Q4a/Q4b。

### 2026-08-15 P1-5 远端 Marketplace artifact 仓库内子门记录

- **实现身份。** exact implementation commit 为
  `6b7e183c33f8c9d8a3509cac9e27f5401a5c9104`。它把完整远端声明的抓取、digest/SPKI、staged-manifest
  Ed25519、installer exact-byte recheck、immutable provenance/readback 与 add/upgrade transaction 绑定到同一
  activation-preflight；冲突 digest aliases、孤立 SBOM document digest 和 registry/CLI manifest digest 漂移均
  fail closed。catalog/preflight/update-impact 继续采用 additive v1 contract，旧式 payload digest 语义不被重释。
- **定向 unit 证据。** 本地隔离 Vitest 最终为 **6 files / 99 tests passed**，覆盖 URL/redirect/auth、同源 token、
  私钥/证书/DER 容器拒绝、response/timeout/size 上限、digest/SPKI、原子 cache/offline readback、截断/并发/symlink/
  4xx/5xx、installer TOCTOU、evidence 自洽与 installed-lock 绑定、legacy partial、digest alias 冲突及同 schema
  payload impact。14 个相关 JS 文件的 `node --check`、Prettier check 与全工作区 `git diff --check` 同时通过。
- **真实 Commander/loopback 证据。** **1 file / 9 tests passed**：完整 add+evidence、mixed/legacy declaration、坏
  signature/SBOM 零安装、CLI/registry manifest digest 冲突零 artifact 抓取、失败 upgrade 保留 v1、已有目标版本必须
  重新安装验证而不能 pointer-only activation；query/hash secret 不进入 provenance。
- **证据边界。** 以上是 Windows 本地/loopback 仓库证据，不是 GitHub release matrix，也不证明真实 private
  registry TLS/auth、proxy/PAC/custom CA、外部 host、publisher identity/trust root、组织撤销传播、air-gapped upgrade
  或供应链 fault matrix。远端 SBOM readback 只证明安装时 document digest 记录，不证明当前远端文档或 payload 语义。

- **S0-1 durable remote approval / membership authority 子门已提交。** `860d66148f` 将结构化批准绑定到一次性
  authorization consumer，在目标 shell/browser/process dispatch、proxy listen、background reaper 与 install audit 前完成
  consume，并在批准等待前后重验 execution、permission/host/plan/tool admission 与 Plugin manifest/trust/sandbox authority；
  coordinator 在同一 authority lock/CAS 中裁决 capability、scope、device cap、revoke、close tombstone 与 re-enable，WS、
  relay 和 push 在发送前逐接收者重新授权。Web 使用 IndexedDB 中不可导出的持久设备密钥，Android 回传完整
  fingerprint/binding/revision；`73cddc9a32` 单独补齐 iOS 的 exact tuple 与 `approval-binding-v1` 协议 parity。定向证据为
  CLI **18 files / 212 tests**、session-core **41/41**、Web **37/37**、Android **8/8**，Prettier、ESLint 与 diff check
  同时通过。iOS 在 Windows 仅做静态核对，尚无 transient resume 或生产 UI 接线；跨进程 relay resume、物理断电/
  跨设备 fsync 与长期分布式矩阵也未关闭，因此 S0-1 整项仍为**部分完成**；lost-join scoped 补强见下一条。
- **S0-1 lost-join outcome reconciliation 仓库内子门已提交。** `0fbcbe4509` 为 Web direct durable join 在发送
  one-shot token 前持久化确定性 principal，并在 ACK/连接丢失后只用 possession resume 读回；join/resume 的
  session/membership epoch 与签名 challenge 精确绑定，只有权威 `MEMBERSHIP_NOT_ACTIVE` 终态允许 fresh URI 重入 join。
  同一进程 relay 以认证 receipt 对 key/token/capability/scope/principal/epoch 做 exact readback，Web 与 Android 的
  `pair.accepted` 重试共享有界 operation budget，错误 key/token/envelope 与新 token/旧 transport 冲突不会消费 token、
  覆盖旧 key 或制造 coordinator orphan。验证为 CLI **4 files / 69 tests**、Web **3 files / 43 tests**、Android
  **5/5**。该提交尚未取得 GitHub exact-SHA 远程矩阵；跨进程/host-restart relay、iOS transient resume/生产 UI、
  真实多机 relay/push/network 与 post-commit fault recovery 仍未关闭。
- **S0-2 Linux inherited-FD closure 仓库内子门已提交。** `87526246bc` 在实际 bwrap exec 前使用 descriptor-pinned、
  root-owned、hash-attested `/usr/bin/python3` launcher，以固定 `-I -S -E` 源码关闭密集 allowlist 之外的全部 child FD，
  并在 Broker admission 后再次校验 launcher/bwrap identity；真实注入的 non-`CLOEXEC` FD 142 在 WSL 探针目标端归零。
  平台单测 **328/328**、workflow contract **13/13**、Windows 条件矩阵与静态检查均通过。完整 Linux+bwrap live 仍须
  该精确提交的 `CLI Strict Sandbox` GitHub job；macOS 原子 helper、任意 `dlopen`/共享加载闭包和长期对抗矩阵不在此子门。
- **Q4a-R1 trusted Remote-SSH evidence bridge 仓库内候选已提交。** `73e63b5d25` 将 manifest 升至 `1.4.0`，新增
  一个明确标注的 Linux `remote-ssh-container` cell：固定 VS Code、Remote-SSH 双摘要与 Ubuntu image digest，使用严格
  host-key 的真实 `ssh-remote` extension host 跑多根/activation/bridge journey；candidate manifest/VSIX 在 host、容器与
  aggregate 多次重验。producer 非 success 时 aggregate/publisher 均阻断，PR 只产 advisory；release-ready 要求受信
  main/tag 事件、`workflowSha == releaseCommit`、同 run artifact 与重新派生的 semantic outcome。定向证据为 CLI
  **35/35**、Remote/workflow **12/12**、VS Code unit **97/97**。case 继续标记 `external-evidence-required`：本机未运行
  Docker + VS Code Remote-SSH，必须等待该精确提交的 GitHub cell，且不替代 WSL/devcontainer/Codespaces/Gateway 全矩阵。
- **JetBrains `0.4.90` 已公开发布。** exact SHA
  `7d21c7a9ae54663d4c57f5203a4b85787748858f` 的发布 run
  [31889750517](https://github.com/chainlesschain/chainlesschain/actions/runs/31889750517) 完成 6/6 real-host、JUnit、
  smoke、build、compatibility、upload 与 post-publish readback；不可变 artifact ID `9248465992`，SHA-256
  `8d36b5339e8281a2ed1f9f8bb69b9ed2e200239113210cf68dc592436e7e1cf3`。三项作者签名 secret 均未配置，按现行
  runbook 走允许的 unsigned 路径；随后官方 Marketplace API 精确回读 `0.4.90` 为
  `status=ready / approve=true / listed=true / hidden=false`。这关闭公开 listing 子门，但不关闭作者签名。

## 十三、未完成项汇总表（截至 2026-08-16）

本表按原始路线图编号汇总当前仍未关闭的整项，便于排期和持续更新。PR #191 合并且 P1-3 正式
aggregate 回读后，当前为 **13/19 项尚未关闭，6/19 项完成**；已完成的 P0-1/Q1 Workbench、
P0-2/Q2 Rewind、P1-3/R4 Automation Center、P2-1/R5 因果可观测性、P2-2/R5 自动补全和
P2-3/R5 多 Agent 合并审阅不再列入。
R0～R5 只是阶段别名，不重复计数。“部分完成”表示已有实现或子门已经关闭，但整项退出条件仍未满足；
“外部阻塞”与“本期延后”均不代表完成、豁免或 release GO。

| #   | 路线项                                         | 当前状态                         | 已完成基础/最新进展                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 未完成范围与关闭条件                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | S0-1：Plan、权限与运行时正确性                 | 部分完成；P0 release gate        | Plan/contract/Hook/子树指令、durable host revocation、MCP send-time admission、后台 interaction journal CAS、delegated/recovery lease、精确进程身份、独立 machine-local anti-rollback witness、covered-scope 磁盘故障恢复与 canonical session SIGKILL/fsync v1 均已进入 `main`；`860d66148f` 又提交 one-shot durable approval consumer、执行/策略/Plugin 二次 authority fence、coordinator CAS/device-cap/revoke/close→re-enable 与 WS/relay/push send-time reauthorization，`73cddc9a32` 补齐 iOS exact approval tuple/capability parity；`0fbcbe4509` 关闭 Web direct 与同进程 relay 的 lost-join ACK reconciliation 子门；PR #182 exact-head 双门、PR #196 三平台 CLI CI、Session Scale、Host Consistency 及后续发布门已通过 | 关闭已 dispatch 外部 effect 无法召回的分布式撤权/人工裁决边界、真实任意物理断电与跨设备 fsync、首次 state-root 逐级目录持久化、同时回滚 transcript 与机器外部 witness 的同 UID 强篡改者、跨宿主 authority 及长期安全矩阵；iOS transient resume/生产 UI、跨进程/host-restart relay 与 post-commit fault recovery 仍未交付；任何 authority-bearing 失败均不得扩大能力 |
| 2   | S0-2：Skill/MCP 信任边界                       | 部分完成；P0 release gate        | production Skill direct handler 已阻断；固定 npm MCP capsule 的四类不可降级宿主边界及真实 Client→Broker→OS live chain 已合并；`87526246bc` 又提交 Linux bwrap inherited-FD closure、descriptor-pinned launcher 与 admission 后 identity reattestation，仓库内 328 项平台单测及 WSL FD142 探针通过                                                                                                                                                                                                                                                                                                                                                                                                                               | 取得 `87526246bc` 精确提交的 Linux+bwrap `CLI Strict Sandbox` live 证据；补齐 macOS 原子 runtime exec/open、任意 native/shared-library 递归闭包、远端即时撤权/distributed authority、恶意来源/effect ledger/动态撤销/进程树和长期对抗矩阵                                                                                                                           |
| 3   | S0-3：持久状态、语义压缩与 handoff             | 部分完成；P0 foundation          | provider-backed semantic compaction、canonical settlement、durable microcompact canonical CAS 与 covered-scope CLI 冷恢复子门已关闭；`dc79df9f11` 提交 production-path live trajectory runner、严格 evidence verifier、真实 provider workflow 与 100-run loopback 回归，loopback 明确不计 live evidence                                                                                                                                                                                                                                                                                                                                                                                                                         | 在 exact commit 上完成至少 100 次真实 provider 长会话、可验收 structured handoff/live trajectory 与全宿主长期一致性矩阵                                                                                                                                                                                                                                             |
| 4   | Q0：可信入口与 Microsoft Marketplace           | 部分完成；外部阻塞               | Desktop 单一 command registry、公开 capability manifest、不可变发布门已实现；Open VSX `0.37.54` 与 JetBrains `0.4.90` 均已公开发布并完成 listing 回读                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 配置 Microsoft Marketplace 发布 authority，发布同一已验证 VSIX，并完成 exact publisher/version/digest 回读及 stock VS Code 搜索、fresh-profile 安装、升级和回滚                                                                                                                                                                                                     |
| 5   | Q3：Evidence-Driven Delivery Loop              | 部分完成；外部 live journey 延后 | production GitHub adapter、`cc artifacts delivery-run` 与 crash-safe exact-effect runner 已进入 `main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 通过生产入口真实执行 gates→preview→review→fix→PR/CI→受控 merge→archive；绑定 exact head，并关闭 ruleset/branch protection、required checks/review、权限及外部不可变/WORM 归档回读                                                                                                                                                                                   |
| 6   | Q4a：真实宿主验收基础设施                      | 部分完成                         | local-host、stable/minimum、多根、多窗口与 IDE ARM64 exact-SHA 子门已关闭；`73e63b5d25` 提交可信 roadmap evidence bridge、manifest `1.4.0` 与一个严格固定供应链/host-key/candidate bytes 的 Linux `remote-ssh-container` 真实驱动候选，producer、aggregate 和 publisher 均 fail closed                                                                                                                                                                                                                                                                                                                                                                                                                                          | 先取得 `73e63b5d25` 精确提交的 GitHub Remote-SSH/container evidence；随后完成 WSL/devcontainer/Codespaces、JetBrains Gateway、更多真实 Remote/SSH 宿主、失败 artifact capture、网络故障与可重放矩阵；单一 container cell 不代表完整远程矩阵                                                                                                                         |
| 7   | Q4b：完整发布与用户旅程门                      | 部分完成；外部阻塞/本期延后      | CLI npm `0.164.0` exact-SHA 发布和公网回读、Open VSX `0.37.54` 与 JetBrains `0.4.90` 公开回读、unsigned CLI 六目标执行已完成；JetBrains `0.4.90` exact-SHA workflow、不可变 artifact 与 Marketplace `ready/approve/listed` 回读均已成功，但未配置作者签名                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 完成 Microsoft Marketplace、JetBrains 作者签名、Desktop/native x64+ARM64 签名与公证、公开渠道 fresh-profile 升降级/回滚、网络抖动/重连/Bridge 与 CLI restart、8 小时 IDE soak 和 nightly live-provider trajectory                                                                                                                                                   |
| 8   | P1-1：Dynamic Workflow façade                  | 部分完成                         | 已有 Cowork DAG、run history、Team/Batch 和统一 scheduler/Automation 控制基础；`58bfdceb84` 增加版本化 definition/digest、raw plan、最坏任务调用与 token/USD/DAG 耗时投影，以及 capability/location/permission/sandbox/network/data-boundary/credential 的 fail-closed preflight；16 soft/64 hard 规模门不可静默放宽。`b6dc772384` 又增加 current envelope、content-addressed immutable versions、legacy-unversioned 边界、CLI/WS exact-digest replay 和 run history digest；`c5f14a2105` 强制 CLI/WS 在 started/task/history 前双重核验 definition/session authority，固定 secret-free admission/execution policy，统一所有 task invocation 的并发门，并严格验证 terminal record                                               | 完成真实宿主 attestation、自然语言生成与审阅、运行中 pause/resume/stop/restart、恢复后阶段最多一次、耐久 history 与 artifact/ledger/checkpoint lineage、Workbench/双 IDE 消费、跨 host 矩阵和 plugin/marketplace 分发；当前 manifest 明确不承诺 durable resume、exactly-once 或阶段间 `needs_input`                                                                 |
| 9   | P1-2：一等 Execution Location                  | 部分完成                         | CLI 已有 hash-chain 锚定的 `cc-execution-location-binding/v1`、五类位置 capability catalog、`session location current/show/compare/handoff` 与 secret-free fail-closed handoff preview；Container/Remote Control 边界已显式建模                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 完成真实 WSL/SSH/Cloud/Container launch/resume、跨宿主 commit/diff/summary/artifact/evidence/authority 继承、Preview/Computer Use、IDE/Desktop 创建面，以及远程、故障和长期宿主矩阵                                                                                                                                                                                 |
| 10  | P1-4：Context 与 Permission/Side-effect Center | 部分完成                         | CLI authority 已支持 workspace scoped rule、TTL、CAS revoke 与逐工具调用刷新；双 IDE Policy Viewer 只通过 CLI 修改并展示来源/状态/有效期/revision。双 IDE Context Center 已共享确定性 contract、持久偏好与交互式 chips，并实际采集有界 Git diff、project memory 和 metadata-only MCP resource catalog；legacy、`/v2`、`/v6-preview` 已通过 browser-safe twin 消费同一 contract，managed deny 不可放宽。版本化 Permission/Side-effect 投影已展示标准/MCP ledger 的实际文件、network origin、process/runtime、credential 变量名、不可逆标记、决策来源、调用链及逐资源恢复覆盖，并由双 IDE 绑定当前 Chat session 消费                                                                                                              | 补齐长期并发、真实宿主、故障注入和跨入口矩阵；验证凭据值/完整命令始终不泄露，外部副作用始终不会被本地 checkpoint 误报为可回滚                                                                                                                                                                                                                                       |
| 11  | P1-5：Marketplace 发现与组织治理               | 部分完成                         | `392ed39d24` 新增 catalog；`b93f354679` 新增 preflight/provenance；`07f4d41fa6` 新增 update impact；`6bd8c11271` 新增 exact registry-set selection；`3d171256fb` 新增 local artifact readback；`6b7e183c33` 新增版本化 remote artifact evidence，在 add/upgrade activation 前完成有界 signature/public-key/SBOM 抓取、digest/SPKI、staged-manifest Ed25519、transactional finalize/rollback，并由 `cc plugin evidence` 复核 provenance、绑定 installed signature lock；publisher identity 仍明确未验证，远端 SBOM 仍是 install-time document evidence                                                                                                                                                                           | 完成真实 private registry TLS/auth 与干净外部旅程、publisher/组织 trust root 和 key revocation、代理/PAC/custom CA、air-gapped/offline，以及依赖冲突、网络/registry/cache/供应链故障注入矩阵；远端 SBOM 当前 payload 语义绑定仍未关闭                                                                                                                               |
| 12  | P2-4：可访问性与性能                           | 部分完成                         | 已有局部 IDE 宿主、长会话和规模测试基础                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 完成键盘全路径、屏幕阅读器、焦点恢复、长会话虚拟化、大 diff/日志和 100+ session 的量化验收；覆盖真实宿主和长期运行                                                                                                                                                                                                                                                  |
| 13  | P2-5：WebIDE 定位                              | 未决                             | 当前 WebIDE 更接近固定 HTML/CSS/JS playground                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 明确产品决策：若无独立浏览器 IDE 目标则收敛为 Preview/Artifact；若继续投入，则补齐仓库树、搜索、诊断、Git/Diff、Terminal 与 session 绑定                                                                                                                                                                                                                            |

建议关闭顺序为：先完成 **S0-1～S0-3、Q0、Q3** 的安全、可信分发和真实交付门，再用 **Q4a/Q4b**
关闭远程、故障与长期宿主证据，随后推进 **P1-1～P1-5** 的产品化，最后处理 **P2-4～P2-5**。
在 Q0、Q3 和 Q4b 的外部证据未闭合前，整体产品发布结论保持 **NO-GO**。

## 十四、2026-08-16 最新未完成项复核（`07:17 +08:00`）

本节以 `main@697416bd5a85b0f6a50fc4367adbd97dffc3b2f2` 为当前源码基线，补充第十三节之后的公开发布与 Actions 运行状态；它优先于第十二、十三节中的旧版本运行态，但不改写已经取得的历史证据。复核后仍是 **13/19 项尚未关闭、6/19 项完成**，没有新增整项关闭。已完成项继续是 P0-1/Q1 Workbench、P0-2/Q2 Rewind、P1-3/R4 Automation Center、P2-1/R5 因果可观测性、P2-2/R5 自动补全和 P2-3/R5 多 Agent 合并审阅。

| #   | 未完成路线项                         | 当前判定                         | 最新核验后的主要关闭条件                                                                                                                                                                                                      |
| --- | ------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | S0-1：Plan、权限与运行时正确性       | **部分完成 / P0 release gate**   | `697416bd5a` 已进一步加固 durable relay membership commit、恢复与 candidate key/replay 隔离，但仍须完成跨宿主 distributed revoke/人工裁决、真实物理断电与跨设备 fsync、强篡改者、长期安全矩阵、iOS transient resume/生产 UI。 |
| 2   | S0-2：Skill/MCP 信任边界             | **部分完成 / P0 release gate**   | 当前实现仍显式保留 `sharedLibraryClosure=false`；补齐 macOS 签名后的原子 runtime `exec/open`、跨平台任意 native/shared-library 闭包、distributed authority 与长期恶意矩阵，并取得当前 exact SHA 的完整绿色安全门。            |
| 3   | S0-3：持久状态、语义压缩与 handoff   | **部分完成 / P0 foundation**     | 在同一 exact SHA 上完成至少 100 次真实 provider 长会话、可验收 structured handoff/live trajectory 与全宿主长期一致性；三平台 100-run loopback 只能验证执行路径和证据合同，不能代替真实 provider。                             |
| 4   | Q0：可信入口与 Microsoft Marketplace | **部分完成 / 外部阻塞**          | 配置 `VSCE_PAT`，把同一已验证 VSIX 发布到 Microsoft Marketplace，并完成 exact publisher/version/digest 回读，以及 stock VS Code 的搜索、fresh-profile 安装、升级和回滚。                                                      |
| 5   | Q3：Evidence-Driven Delivery Loop    | **部分完成 / live journey 延后** | 通过生产入口真实执行 gates→preview→review→fix→PR/CI→受控 merge→archive，绑定 exact head，并验证 ruleset/branch protection、required checks/review、权限与外部不可变/WORM 归档。                                               |
| 6   | Q4a：真实宿主验收基础设施            | **部分完成**                     | 先取得当前 exact SHA 的 Remote-SSH/container producer 与 trusted aggregate；随后完成 WSL/devcontainer/Codespaces、JetBrains Gateway、更多 Remote/SSH、失败 artifact、网络故障和可重放矩阵。                                   |
| 7   | Q4b：完整发布与用户旅程门            | **部分完成 / 外部阻塞**          | 完成 Microsoft Marketplace、JetBrains 作者签名、Desktop/native x64+ARM64 签名与公证、公开渠道 fresh-profile 升降级/回滚、网络抖动/重连/Bridge 与 CLI restart、8 小时 IDE soak 和 nightly live-provider trajectory。           |
| 8   | P1-1：Dynamic Workflow façade        | **部分完成**                     | 实现并验证真实宿主 attestation、自然语言生成/审阅、运行中 pause/resume/stop/restart、恢复后阶段最多一次、durable lineage、Workbench/双 IDE 消费、跨 host 与 plugin/marketplace 分发。                                         |
| 9   | P1-2：一等 Execution Location        | **部分完成**                     | 完成 WSL/SSH/Cloud/Container 的真实 launch/resume、跨宿主 commit/diff/summary/artifact/evidence/authority 继承、Preview/Computer Use、IDE/Desktop 创建面及长期故障矩阵。                                                      |
| 10  | P1-4：Context 与 Permission Center   | **部分完成**                     | 补齐长期并发、真实宿主、故障注入和跨入口矩阵；证明凭据值/完整命令始终不泄露，外部副作用不会被本地 checkpoint 误报为可回滚。                                                                                                   |
| 11  | P1-5：Marketplace 组织治理           | **部分完成**                     | 完成真实 private registry TLS/auth、publisher/组织 trust root 与 key revocation、代理/PAC/custom CA、air-gapped/offline、依赖/网络/cache/供应链故障矩阵，以及远端 SBOM payload 语义绑定。                                     |
| 12  | P2-4：可访问性与性能                 | **部分完成**                     | 完成键盘全路径、屏幕阅读器、焦点恢复、长会话虚拟化、大 diff/日志和 100+ session 量化验收，并覆盖真实宿主与长期运行。                                                                                                          |
| 13  | P2-5：WebIDE 定位                    | **未决**                         | 作出产品决策：没有独立浏览器 IDE 目标时收敛为 Preview/Artifact；若继续投入，则补齐仓库树、搜索、诊断、Git/Diff、Terminal 与 session 绑定。                                                                                    |

本次运行态复核带来以下更新，但不减少上述 13 项：

- CLI `chainlesschain@0.164.0` 已由 tag `v-npm-0-164-0` 的 exact SHA `313dec85cffa09dbb183be17d2b6597e303bed5f` 发布；[npm workflow `31912844032`](https://github.com/chainlesschain/chainlesschain/actions/runs/31912844032) 与[独立公网 readback `31913903124`](https://github.com/chainlesschain/chainlesschain/actions/runs/31913903124)均成功，公网 `latest` 已回读为 `0.164.0`。这只更新 Q4b 的 CLI npm 基础，不替代签名 native、IDE Marketplace 或真实用户旅程。
- Open VSX 公网 `latest` 在本次快照仍为 `0.37.53`；tag `ide-vscode-v0.37.54` 已存在，但对应 [IDE Extensions `31913429988`](https://github.com/chainlesschain/chainlesschain/actions/runs/31913429988)仍未终态。仓库 secrets/variables 仍无 `VSCE_PAT`，所以即使 Open VSX `0.37.54` 发布成功也不能关闭 Q0。
- 当前 `main@697416bd5a` 的 [CLI Strict Sandbox `31913015310`](https://github.com/chainlesschain/chainlesschain/actions/runs/31913015310) 已失败，Ubuntu 24.04、macOS 15、Windows 三个 `strict native boundary` job 全部为 failure；故 S0-2 没有当前 HEAD 的完整绿色安全门。当前 main 的 macOS launcher gate 成功只覆盖 unsigned contract/负向边界，不是 Developer ID、notary Accepted 与 root-installed signed package 的正式发行证据。
- [IDE Roadmap Live Provider Trajectory `31913015319`](https://github.com/chainlesschain/chainlesschain/actions/runs/31913015319) 已成功，但本次 push 只执行 Linux、Windows、macOS 各 100 次 production-path loopback；real-provider 与 verifier jobs 被跳过。因此该 run 不计 S0-3 所需的 100 次真实 provider 证据。
- 当前 main 的 [IDE Extensions `31913015336`](https://github.com/chainlesschain/chainlesschain/actions/runs/31913015336) 尚未终态；其中 `VS Code Remote-SSH container (scoped trusted cell)` 在最近一次回读仍为 queued。即使该单格最终成功，也只关闭 Q4a 的一个 Remote-SSH/container 子门，不代表 WSL、devcontainer、Codespaces、Gateway 与网络故障矩阵完成。
- Dynamic Workflow manifest 仍明确为 `durablePauseResume=false`、`exactlyOnceAfterResume=false`、`needsInputBetweenStages=false`；Marketplace 远端 artifact evidence 仍明确为 `publisherIdentityVerified=false`、`sbomPayloadCompared=false`。因此 P1-1 与 P1-5 均不能从已有 catalog/preflight/replay/readback 子门外推为完成。

建议执行顺序保持为：先修复当前 exact-SHA 安全门并完成 **S0-1～S0-3**，再关闭 **Q0、Q3** 的可信分发和真实交付；随后用 **Q4a/Q4b** 完成远程、故障、签名与长期宿主证据，再推进 **P1-1、P1-2、P1-4、P1-5**，最后处理 **P2-4** 和 **P2-5**。在 Q0、Q3、Q4b 及 P0 安全退出条件未闭合前，整体产品发布结论继续为 **NO-GO**。

## 十五、2026-08-16 发布门修复候选复核（`11:35 +08:00`）

本节复核 PR [#205](https://github.com/chainlesschain/chainlesschain/pull/205) 的运行时代码冻结点
`34f55fe3c01eff36681b8bb397d218a2dac743ff`。该候选修复了第十四节暴露的 exact-SHA 安全门、证据路径和宿主矩阵基础设施问题；但修复提交的完整 Actions 矩阵仍须取得终态绿色，且外部发布 authority、真实生产旅程、签名与长期矩阵没有因此自动完成。因此计数保持 **13/19 项尚未关闭、6/19 项完成**，整体仍为 **NO-GO**。

本轮已经落地、且有本地或前序 exact-SHA 子门证据支撑的修复如下：

- **S0-1 / S0-2 发布门基础：** `843c334021` 的 [CLI Strict Sandbox `31923959409`](https://github.com/chainlesschain/chainlesschain/actions/runs/31923959409) 已在 Ubuntu 24.04、Windows、macOS 15 三格全部成功。候选同时统一 run-shell workspace authority、Plugin 后台合约的平台判定 seam、后台 stop/IPC 终止结算和 supervisor lock zombie owner 回收，并继续保持强边界 fail closed；`agent-core-remote-shell-authorization` 当前本地为 22/22 通过。由于后续代码冻结点仍须重新取得完整 `CLI CI` 与 Strict exact-SHA 终态，这只关闭当前已知回归，不关闭 S0-1/S0-2 的分布式撤权、物理断电、共享库递归闭包和长期对抗矩阵。
- **证据完整性与后台 keeper：** verifier 现在对 macOS `/var`→`/private/var`、Windows junction 和嵌套 canonical root 使用同一 containment authority，同时保留 symlink/reparse、realpath containment 与 digest 校验；keeper soak 的临时 state root 在创建时 canonicalize，未放宽 secure-fs。回归测试分别为 29/29 与 11/11，本地真实 junction keeper smoke 成功。`843c334021` 的 keeper run 中 Windows、Ubuntu 已成功，macOS 因后续提交取消，故三格 aggregate 仍待当前候选重跑，不得记为完成。
- **Q3 生产 adapter：** delivery 配置新增显式 Git remote，并在 push/修复 push/create-PR 前核对该 remote 的 push URL 必须精确绑定配置的 GitHub repository；不匹配时拒绝外部 effect，相关测试 63/63。当前 `main` branch protection 虽有 required checks，但 `required_approving_review_count=0`、`enforce_admins=false`、`required_signatures=false`，且无 repository ruleset；生产入口的 gates→preview→review→fix→PR/CI→受控 merge→WORM archive 也尚未真实执行，所以 Q3 继续是 live journey 阻塞。
- **Q4a Remote-SSH：** 真实宿主 runner 接受 remote home 本身或其 canonical 子目录作为 extension cwd，开启 `remote.SSH.loglevel=trace`，并在 VS Code 失败后继续收集本地/container 日志、VS Code trace、remote server logs 与 diagnostics；静态合同测试 14/14。前序候选的 Remote-SSH job 被后续提交取消，当前冻结点仍需 producer 与 trusted aggregate 同 SHA 成功；即使成功也只关闭一个 scoped container cell，不代表 WSL、devcontainer、Codespaces、Gateway、网络故障与可重放矩阵完成。
- **Q0 / Q4b 公开渠道状态更正：** [IDE Extensions `31913429988`](https://github.com/chainlesschain/chainlesschain/actions/runs/31913429988) 已终态成功，Open VSX `0.37.54` 已完成 publish、listing 与下载回读；CLI npm `0.164.0` 的发布与独立公网回读也已成功。Microsoft Marketplace 仍未配置 `VSCE_PAT`，JetBrains 仍无作者签名，Desktop/native 仍缺 x64+ARM64 签名与公证，因此 Q0/Q4b 状态不变。

当前候选的最短关闭路径是：先让 `34f55fe3c0`（或仅含本节文档的后继 SHA）的 `CLI CI`、`CLI Strict Sandbox`、`IDE Roadmap Safety Matrix`、`CLI Background Agent Keeper Soak` 与 Remote-SSH producer/aggregate 全部取得同 SHA 终态绿色；再由有权限的发布方补齐 Microsoft Marketplace、签名/公证、Q3 生产交付/WORM 和 S0-3 至少 100 次真实 provider 证据。任何旧 SHA 的成功、取消中的 job、局部 OS 成功或 loopback 结果均不得外推为整项完成或 release GO。

## 十六、2026-08-16 发布门修复收口复核（`14:52 +08:00`）

本节以 PR [#209](https://github.com/chainlesschain/chainlesschain/pull/209) 的运行时代码冻结点
`21f3eb73aaac16bae5602a753d5f7ae8e5c2185a` 为准，取代第十五节尚未终态的候选运行证据。PR 使用精确基线分支
`fix/roadmap-release-gates-base-818bcc3@818bcc3ed6d1a5cd611b2960ebc1f662b99dd42a`，没有覆盖并发演进的旧候选分支。此次只关闭已经暴露的 keeper、Remote-SSH 与证据桥回归；外部发布 authority、真实生产交付、真实 provider、签名/公证和完整长期矩阵仍未完成。因此总数继续是 **13/19 项尚未关闭、6/19 项完成**，整体发布结论继续为 **NO-GO**。

- **后台 keeper 当前 exact-SHA 子门已恢复：** [CLI Background Agent Keeper Soak `31931762868`](https://github.com/chainlesschain/chainlesschain/actions/runs/31931762868) 在 Ubuntu、Windows、macOS 三个 producer 及 `Background Agent keeper soak aggregate` 全部成功。修复把 Darwin 超过 `sockaddr_un` 上限的 keeper/attach socket 映射到独立、私有、按 state-root/user/id 哈希的短路径，并为 Windows worker 增加认证 heartbeat，使 PID/start-anchor 探针不可用或延迟时仍可在有界时间内判定 worker 丢失；secure-fs 的 owner、mode、symlink/reparse 与 containment 拒绝条件没有放宽。本地 keeper/transport 定向集为 **27/27**，完整 supervisor 为 **79 passed / 7 skipped**；Windows 三 Agent 真进程 smoke 完成 ready、reconnect、hard-kill 清理，最大观察清理约 24.1 秒，低于 30 秒门限。手工 20-Agent run [31928109052](https://github.com/chainlesschain/chainlesschain/actions/runs/31928109052) 在 Windows 诊断失败后取消，不能计作 Q4b 的正式长时 soak，也不关闭物理断电、分布式撤权或长期对抗矩阵。
- **Remote-SSH producer 与 trusted aggregate 已在同一 SHA 成功：** [IDE Extensions `31931762904`](https://github.com/chainlesschain/chainlesschain/actions/runs/31931762904) 整体终态成功，其中不可变 VSIX、Windows/macOS/Linux VS Code host、`VS Code Remote-SSH container (scoped trusted cell)` 与 `IDE roadmap evidence (trusted scoped aggregate)` 均成功。runner 先把 development driver、test runner、workspace file 和两根 workspace 绑定为所选 `ssh-remote+...` authority；远端 workspace extension host 再以其原生 `file:` 资源呈现两根路径，并由 `vscode.env.remoteName=ssh-remote`、容器 hostname/marker、`.vscode-server` 精确安装路径、候选 VSIX 摘要/字节数与完整 host-journey stages 共同证明实际远端执行。修复同时统一 marker 的精确写入字节、允许 extension cwd 等于 remote home 或其 canonical 子目录，并让 roadmap artifact 保留受控 `.vsix` 扩展名供后置 inspector 重验。最终 journey 证明 activation、commands、bridge、view dispatch 和 phase completion 全部完成，credential leak、wrong-commit binding 与 evidence replacement 均为 0；本地 Remote 合同为 **10/10**，journey evidence 与 runtime verifier 定向集为 **36/36**。
- **同一运行时代码点的安全与 PR 基础门已成功：** [IDE Roadmap Safety Matrix `31931762870`](https://github.com/chainlesschain/chainlesschain/actions/runs/31931762870) 的 Ubuntu、Windows、macOS producer 及正式 aggregate 全部成功；[PR Tests `31931762876`](https://github.com/chainlesschain/chainlesschain/actions/runs/31931762876) 的 Code Quality 与 Quick Tests 全部成功。最终仅文档后继 SHA 仍须按仓库发布规则取得完整三平台 `CLI CI` 与 `CLI Strict Sandbox`；本地结果、旧 SHA、部分 OS 或取消的 run 不能替代该 exact-SHA 发布门。
- **公开渠道结论不变：** Open VSX `0.37.54` 已完成发布、listing 与下载回读，CLI npm `0.164.0` 已完成发布和独立公网回读；Microsoft Marketplace 仍没有 `VSCE_PAT`，JetBrains 仍缺作者签名，Desktop/native 仍缺 x64+ARM64 签名与公证。已有公开子门不能替代 Microsoft Marketplace 的 exact publisher/version/digest、stock VS Code 搜索及 fresh-profile 安装、升级、回滚。

本次收口后仍需完成的范围保持如下：

1. **S0-1～S0-3：** 完成跨宿主 distributed revoke、真实物理断电/跨设备 fsync、强篡改者与 iOS transient resume/生产 UI；关闭当前仍显式为 `sharedLibraryClosure=false` 的任意 native/shared-library 递归闭包、签名后的 macOS 原子 `exec/open` 和长期恶意矩阵；在同一 exact SHA 上取得至少 100 次真实 provider 长会话与 structured handoff，三平台 loopback 不计真实 provider。
2. **Q0 / Q3：** 由有权限的发布方补齐 Microsoft Marketplace；再从生产入口真实执行 gates→preview→review→fix→PR/CI→受控 merge→外部不可变/WORM archive。当前 branch protection 的 review、admin enforcement、signature 与 ruleset 仍不足，不能把 adapter 单测当作 live journey。
3. **Q4a / Q4b：** 本次只关闭一个严格 scoped 的 Linux Remote-SSH/container cell。仍须覆盖 WSL、devcontainer、Codespaces、JetBrains Gateway、更多 SSH/Remote 宿主、网络故障/重连/可重放矩阵、公开渠道 fresh-profile 升降级/回滚、Desktop/native 与 JetBrains 签名、8 小时 IDE soak 和 nightly real-provider trajectory。
4. **P1-1、P1-2、P1-4、P1-5：** 继续完成 durable pause/resume/exactly-once/lineage、真实 WSL/SSH/Cloud/Container launch 与 handoff、长期 Context/Permission 故障矩阵，以及 private registry publisher/组织 trust root、key revocation、TLS/auth、代理/PAC/custom CA、offline 与 SBOM payload 语义绑定。
5. **P2-4 / P2-5：** 完成键盘/屏幕阅读器/焦点恢复、长会话与大 diff/日志/100+ session 量化验收；同时作出 WebIDE 独立产品或 Preview/Artifact 收敛的明确决策。

后续关闭顺序仍为：先在文档后继 SHA 上补齐 `CLI CI` 与 `CLI Strict Sandbox`，再由相应 authority 关闭 S0-1～S0-3、Q0、Q3 和 Q4b 的外部证据；随后推进剩余 P1 与 P2 项。在这些退出条件全部满足前，任何 scoped producer/aggregate 成功都不得把整体结论改写为 release GO。

## 十七、2026-08-16 P1-5 语义 SBOM 子门与 P2-5 定位收口复核（`18:36 +08:00`）

本节记录第十六节之后的两项变化。实现与定位文档冻结点为 exact commit
`4b1adbc8124d19f8f2d50a634c6d47b7c5f4268b`；承载本节的后继文档提交仍须在 PR
[#209](https://github.com/chainlesschain/chainlesschain/pull/209) 上取得 exact-head `CLI CI` 与
`CLI Strict Sandbox` 三平台终态绿色后方可合并。这里不把本地测试、旧 SHA 或部分矩阵冒充正式发布门。

| 路线项                     | 当前判定     | 本节结论与边界                                                                                                                                                                                                                  |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-5：Marketplace 组织治理 | **部分完成** | 本轮关闭 repository-defined semantic payload SBOM 的 staged-byte 比较、防降级、严格 readback 与串行 add/upgrade/direct replacement 子门；publisher/组织信任、外部 registry 与长期故障矩阵仍未完成。                             |
| P2-5：WebIDE 定位          | **完成**     | Accepted [产品定位 ADR](implementation-plans/WEBIDE_PREVIEW_ARTIFACT_POSITIONING_ADR.md) 明确不建设独立浏览器 IDE；旧 `/webide` 保留为固定 HTML/CSS/JavaScript 兼容 playground，规范方向收敛为 session-bound Preview/Artifact。 |

### P1-5 本轮已关闭的仓库内子门

- **语义 payload 合同与 staged-byte 比较。** 新增 `cc-plugin-marketplace-payload-sbom/v2`，显式绑定
  `file`/`symlink` 类型，排除 installer 自有 provenance 与 VCS metadata，并在任何版本目录替换或 active
  pointer 更新前，把远端文档、catalog payload digest 与经过 guarded copy 的实际 staged bytes 做 canonical
  exact comparison。v1 schema 和 parser 行为保持兼容；完整 v1 声明继续受保护，真正不完整的 legacy v1
  仍按未绑定状态处理，含 Git metadata 的 v1 文档则拒绝用于安装绑定。
- **串行更新路径防降级。** registry `add` 覆盖既有安装、registry `upgrade`、local/Git direct add/upgrade、
  force replacement 与 update 内部的既有版本 pointer reuse 均比较 semantic strength；v2→v1、v2/v1→非语义
  声明被非可覆盖 blocker 拒绝。source switch 与 version downgrade 必须显式批准；既有安装的 registry 候选若
  延迟到 plugin manifest 才给出版本，则在 artifact/source fetch 前 fail closed，避免把 `to:null` 当成已审阅版本。
- **当前安装与既有目标不再只信任 metadata。** impact、evidence 和 installer 会重新遍历当前目录并核对
  persisted comparison；当前/目标 payload 漂移、缺失或损坏 provenance、完整 v1/v2 evidence 丢失均失败。
  pointer reuse 另外比较 guarded-copy 后的候选与既有目标精确 inventory，并拒绝 root/嵌套 symlink 或 Windows
  junction、`.git`、特殊文件，以及把 `.plugin-lock.json` / `.plugin-source.json` 伪装成目录的 exclusion
  smuggling；失败保持原 active bytes 与 authority。
- **证据表述保持真实。** `comparisonDigest` 只被描述为安装目录内可写记录的 self-consistency checksum，
  不再称为认证或外部 trust anchor；readback 明确区分安装时远端文档 digest 记录、当前本地 payload 新鲜哈希
  与没有保留远端文档字节时无法重新验证的事实。

### 本地证据与独立终审

- 最新 12 个相关 CLI 测试文件为 **216 passed / 1 skipped**；其中四个 semantic install/readback/impact/command
  核心文件的最终复跑为 **125 passed / 1 skipped**。变更 JavaScript 通过 ESLint，全部相关 JavaScript/
  Markdown 通过 Prettier check，`git diff --check` 通过。
- 一次完整 `npm test -- --reporter=dot` 在本机运行 604.4 秒后无终态输出超时，故本节明确把它记为
  **未取得完整结果**，不记为通过；exact-head GitHub Actions 仍是发布 authority。
- 独立对抗复核对限定范围给出“无剩余高置信 blocker”：串行 registry add/upgrade、direct replacement、
  update 内 pointer reuse 与 semantic readback 已覆盖 binding downgrade、current/saved drift、candidate-target
  差异、link/junction、VCS/metadata exclusion smuggling 和完整 v1 evidence loss。该签核没有外推到下列剩余项。

### P1-5 仍未关闭的边界

1. **跨进程事务：** install/upgrade 的 state check、activation、command-level finalize/rollback 尚无覆盖完整事务
   生命周期的 per-plugin cross-process lock/CAS；并发进程和崩溃恢复仍可能产生 TOCTOU 或 stale rollback。
2. **activation-only：** 显式 `plugin use`、卸载后的自动 active fallback、缺失/损坏 `.active` 后的版本选择，
   尚未统一经过 semantic-strength 与 fresh-payload 门；它们不能由本轮 update pointer reuse 测试代替。
3. **cross-scope：** 当前比较限定于请求 scope，尚未统一裁决 `local > project > user` shadowing 后的 effective
   plugin authority。
4. **legacy metadata migration：** 缺失或无效 `.plugin-source.json` 目前 fail closed，并要求移除后从可信来源
   重装；尚无可审计、事务化的旧安装 metadata backfill/migration。另缺固定历史 v1 digest fixture；v1 parser
   仍可解析含 `.git/...` 的文档，但完整 install equality 会拒绝其绑定。
5. **外部信任与环境矩阵：** 仍缺真实 private registry TLS/auth、publisher/组织 trust root、key revocation、
   代理/PAC/custom CA、air-gapped/offline/cache、依赖冲突、供应链故障和干净外部宿主矩阵。本地可写的
   source/lock/comparison 记录不是 publisher authentication。

### P2-5 决策关闭边界

P2-5 的退出条件是作出独立浏览器 IDE 或 Preview/Artifact 收敛的明确产品决定；Accepted ADR 已完成该条件。
兼容页只维护固定 `index.html`、`style.css`、`script.js` 的编辑、预览、Console、本地文件保存与导出原语，
不再补齐仓库树、全局搜索、诊断、Git/Diff、Terminal、Worktree 或 canonical session runtime。此关闭不表示
session-bound App Preview 自动“启动→观察→断言→修复→复验→evidence artifact”已经实现，也不表示旧入口迁移、
Preview 交付验收或 P2-4 的键盘/屏幕阅读器/性能退出条件完成。

因此本候选只新增关闭 P2-5：第十六节的 **13/19 项尚未关闭、6/19 项完成**更新为
**12/19 项尚未关闭、7/19 项完成**，工程口径更新为 **12 个剩余工作包**。七个完成项是
P0-1/Q1、P0-2/Q2、P1-3/R4、P2-1/R5、P2-2/R5、P2-3/R5 和 P2-5；当前剩余范围如下：

| #   | 未完成路线项                         | 当前判定                         | 主要剩余关闭条件                                                                                                               |
| --- | ------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | S0-1：Plan、权限与运行时正确性       | **部分完成 / P0 release gate**   | distributed revoke、真实物理断电/跨设备 fsync、强篡改者、长期安全矩阵与 iOS transient resume/生产 UI。                         |
| 2   | S0-2：Skill/MCP 信任边界             | **部分完成 / P0 release gate**   | 任意 native/shared-library 递归闭包、签名后的 macOS 原子 `exec/open`、distributed authority 与长期恶意矩阵。                   |
| 3   | S0-3：持久状态、语义压缩与 handoff   | **部分完成 / P0 foundation**     | 同一 exact SHA 的至少 100 次真实 provider 长会话、structured handoff/live trajectory 与长期多宿主一致性。                      |
| 4   | Q0：可信入口与 Microsoft Marketplace | **部分完成 / 外部阻塞**          | `VSCE_PAT`、Microsoft Marketplace exact publisher/version/digest 回读及 stock VS Code fresh-profile 安装、升级、回滚。         |
| 5   | Q3：Evidence-Driven Delivery Loop    | **部分完成 / live journey 延后** | 生产入口 gates→preview→review→fix→PR/CI→受控 merge→外部不可变/WORM archive 的 exact-head 真实旅程。                            |
| 6   | Q4a：真实宿主验收基础设施            | **部分完成**                     | WSL、devcontainer、Codespaces、JetBrains Gateway、更多 SSH/Remote 宿主、网络故障、失败 artifact 与可重放矩阵。                 |
| 7   | Q4b：完整发布与用户旅程门            | **部分完成 / 外部阻塞**          | Microsoft Marketplace、JetBrains/desktop/native 签名公证、公开渠道升降级/回滚、重连、8 小时 soak 与 live-provider trajectory。 |
| 8   | P1-1：Dynamic Workflow façade        | **部分完成**                     | 真实宿主 attestation、自然语言生成/审阅、durable pause/resume/stop/restart、exactly-once lineage、双 IDE 与 marketplace 分发。 |
| 9   | P1-2：一等 Execution Location        | **部分完成**                     | WSL/SSH/Cloud/Container 真实 launch/resume、跨宿主 lineage、Preview/Computer Use、IDE/Desktop 创建面与长期故障矩阵。           |
| 10  | P1-4：Context 与 Permission Center   | **部分完成**                     | 长期并发、真实宿主、故障注入与跨入口矩阵；继续证明 secret/完整命令不泄露，外部副作用不被本地 checkpoint 误报为可回滚。         |
| 11  | P1-5：Marketplace 组织治理           | **部分完成**                     | 上述跨进程、activation-only、cross-scope、legacy migration、publisher/组织信任、private registry 与网络/供应链长期矩阵。       |
| 12  | P2-4：可访问性与性能                 | **部分完成**                     | 键盘全路径、屏幕阅读器、焦点恢复、长会话虚拟化、大 diff/日志、100+ session 量化验收，以及真实宿主与长期运行。                  |

P2-5 的产品定位关闭不解除任何安全、可信分发或外部交付门。S0-1～S0-3、Q0、Q3、Q4b 与 P1-5 等退出条件仍未闭合，
因此整体产品发布结论继续为 **NO-GO**。本节计数在 PR #209 exact-head required checks 成功并合并后生效；合并前
`main` 仍保留第十六节的历史计数。

## 十八、2026-08-17 P1-5 同作用域激活生命周期子门复核（`07:22 +08:00`）

本节继续第十七节的 P1-5 收口，但不改写其历史快照。实现冻结点为 exact commit
`f6e01da1f4403adbe4e68056c22bc6b661c76521`；承载本节的后继文档提交仍须在 PR
[#209](https://github.com/chainlesschain/chainlesschain/pull/209) 上取得 exact-head `CLI CI` 与
`CLI Strict Sandbox` 三平台终态绿色后方可合并。本节关闭的是**单进程、同 name/scope、串行 activation
lifecycle** 子门，不把它外推成跨进程、跨 scope 或完整 Marketplace 产品化完成。

### 本轮关闭的 activation lifecycle 子门

- **显式激活与自动 fallback 统一 fail closed。** `plugin use`、版本卸载后的 active fallback、普通与
  pointer-only update activation 都要求目标版本存在、目录结构安全、manifest name/version 精确匹配、
  `.plugin-source.json` 严格有效；完整 v1/v2 语义绑定会重新哈希当前 payload，semantic strength 不得降低，
  source switch 必须显式批准。缺失、损坏、悬空、非普通文件或超长 `.active` 不再静默选择最高 semver。
- **公共 mutation 默认执行审批与路径约束。** `installFromDirectory`、`installFromSource`、`updatePlugin`
  的 direct API 默认拒绝未批准的 source switch 与 version downgrade；name/version traversal、编码碰撞、
  symlink/junction ancestor、manifest identity mismatch 与不安全保存目标在写 pointer、覆盖或删除前拒绝。
- **同进程事务由恢复 namespace 串行化。** 普通 replacement 与 pointer-only transaction 均持有
  `.install-*` sentinel；除 transaction-owned activation、`finalize`、`rollback` 和整名恢复性卸载外，后续
  use/install/update/enable/version-uninstall 全部拒绝。默认 runtime discovery 在该 namespace 存在时阻断该
  plugin，命令内部只在审阅 capability/catalog authority 时显式读取 transaction-owned candidate。
- **失败恢复保留精确前驱并可重试。** rollback 先恢复/隔离 bytes，再恢复精确 pointer snapshot，并核对
  pointer generation、candidate/predecessor payload 与 source digest；candidate quarantine、predecessor publish
  或 pointer quarantine 的组合 I/O 失败不会把被拒 payload 暴露给 runtime，保留 topology 可在同一 handle
  上重试。卸载 fallback 同样先隔离版本、再原子提交 pointer，双失败留下 `.uninstall-*` 恢复证据。
- **恢复债务可见，已提交清理债务不再锁死。** `listInstalled` 与 doctor 会显示
  `runtimeBlocked/recovery-required`、inspection version 和精确 recovery path；整名 uninstall 是缺少安全自动
  判断时的显式修复边界。成功 finalize/rollback/install/uninstall 会先把事务目录原子退役为 inert
  `.cleanup-*` 后再 best-effort 删除；删除失败会在下次 mutation 重试，但不再被误判为未完成 authority。
  若退役 rename 与删除同时失败，原 `.install-*` 保持 authoritative、runtime 继续阻断且管理面可见。

### 仓库内验证与独立复审

- exact code commit 上全部 21 个 `plugin-runtime-*` 单测文件为 **383 passed / 3 skipped**。
- Marketplace impact/readback/remote-artifact 三文件为 **72 passed / 1 skipped**；doctor、manifest 与 lifecycle
  command 三文件为 **66 passed / 3 skipped**。独立终审另复跑五个聚焦文件，得到
  **179 passed / 4 skipped**，并对 pointer-only sentinel、install/uninstall 双失败、cleanup retirement、
  recovery inventory/doctor 与 whole-name remediation 做了故障注入复核。
- 所有变更 JavaScript 通过 Prettier check；ESLint 为 **0 errors**（doctor 仅保留 6 条既有 unused-parameter
  warnings）；`git diff --check` 通过。GitHub Actions exact-head 三平台结果仍待本节文档提交后取得，故这些
  本地证据不替代正式 release gate。

### P1-5 仍未关闭的边界

1. **跨进程与崩溃一致性：** 仍没有覆盖 command validation→consent→finalize/rollback 全生命周期的 OS 级
   per-name/scope lock、durable journal、owner token、generation CAS 与 crash recovery。WeakMap handle 和目录
   sentinel 只证明串行同进程路径；并发 CLI、进程崩溃、断电与 fsync durability 仍是明确残余。
2. **cross-scope effective authority：** 当前审批与 semantic baseline 仍限定于目标 scope；`local > project > user`
   shadowing、disable/uninstall 后暴露低优先级同名 plugin、以及全 scope 物理 inventory/blocked diagnostics
   尚未统一进入 effective-authority preflight。
3. **legacy metadata migration：** 缺失或无效 provenance 继续 fail closed，并要求整名移除后从可信来源重装；
   尚无签名、事务化、可审计的旧安装 metadata backfill/migration。
4. **外部 Marketplace 产品化：** 真实 private registry TLS/auth、publisher/组织 trust root、key revocation、
   代理/PAC/custom CA、air-gapped/offline/cache、依赖冲突、供应链故障与干净外部宿主矩阵仍未完成。

因此，第十七节中的 “activation-only” 剩余项由本节的**同作用域串行子门**取代并关闭；P1-5 整项仍为
**部分完成**。总计数保持 **12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体发布结论继续为
**NO-GO**。本节不关闭 P2-4，也不改变 P2-5 已由 Accepted ADR 完成的结论。

## 十九、2026-08-17 P1-5 跨作用域 effective authority 子门复核（`23:23 +08:00`）

本节继续第十八节的 P1-5 收口，但不改写此前的历史证据。审计基线为
`c6ec46ff2d` 之后的本地候选工作树；本节及实现仍须形成不可变提交，并在该 exact head 上取得 `CLI CI` 与
`CLI Strict Sandbox` 的 Linux、Windows、macOS 全矩阵终态成功，才能成为 npm 发布证据。本节关闭的是
**单进程、跨 `local > project > user` 作用域的 effective-authority 决策**子门，不把它外推成跨进程事务、
旧安装迁移或外部 Marketplace 产品化完成。

### 本轮关闭的 cross-scope 子门

- **物理 inventory 与运行时 authority 分离。** `listInstalled` 保持兼容的运行时有效视图；新增
  `listInstalledAllScopes` 与 `cc plugin installed --all-scopes`，逐作用域显示同名插件的物理安装、disabled/
  blocked 状态、`effectiveAuthority`、`shadowedByScope` 与 `inactiveReason`。诊断不再因高优先级覆盖而丢失
  project/user 层的潜在 fallback。
- **disable/uninstall 在写盘前审阅将被暴露的 authority。** 只有当前有效 scope 被禁用、整名卸载或删除唯一
  active version 时才计算低优先级 fallback；fallback 的 pointer、目录、manifest identity、provenance 与当前
  payload 必须严格有效。来源发生变化必须显式传入 `--allow-source-switch`；高优先级安装本身已 blocked 时，
  整名修复也要求该显式批准，不能把无法认证的当前状态当作静默授权。失败发生在 marker、pointer 或目录删除前，
  原有效 authority 保持不变。
- **所有物理 scope 共同形成不可降级基线。** install/replacement、enable/use 与 fallback activation 会遍历同名
  插件在 user/project/local 的已安装版本；任何完整 semantic payload binding 均不能被较弱格式或 unbound payload
  取代。source-switch 批准只批准来源变化，不能绕过 `SEMANTIC_SBOM_BINDING_DOWNGRADE`。因此 shadowed payload
  不能再作为删除高优先级插件后的降级 trampoline。
- **Marketplace impact 升级为跨作用域 v2。** 当前合同为
  `cc-plugin-marketplace-update-impact/v2`；历史 v1 记录保持原义。v2 将规范化的 `installedScopes`、目标 scope、
  effective-from/to、物理 source-switch scopes 与 semantic-downgrade scopes 纳入 canonical impact digest。
  `plugin add` 的 source switch/version downgrade、`plugin enable/disable` 的 source switch 均需命令行显式批准；
  `plugin impact` 文本与 JSON 会暴露 scope authority 变化。

### 仓库内验证与证据边界

- 全部 21 个 `plugin-runtime-*` 单测文件最终为 **389 passed / 3 skipped**。其中真实 Node/Broker attestation
  用例在完整并行矩阵中两次超过默认 5 秒、单文件复跑通过；只为该条真实进程测试设置 15 秒上限后，完整矩阵
  取得上述终态成功，没有放宽全局超时。
- remote-artifact command、add capability notice、install audit、artifact readback、impact 与 lifecycle command
  六文件为 **97 passed / 1 skipped**；install/lifecycle/impact 三个核心文件的最终聚焦复跑为 **119/119**。
- command manifest 与 help-index freshness 检查通过。变更文件通过 Prettier、ESLint 与 `git diff --check`；这些
  本地结果不替代 exact-head GitHub Actions。`doctor-checkup.test.js` 的 Windows 默认时限问题不计入上述通过证据，
  也不在本节中宣称已关闭。

### P1-5 仍未关闭的边界

1. **跨进程与崩溃一致性：** 仍缺覆盖 validation→consent→finalize/rollback 全生命周期的 OS 级 per-name/scope
   lock、durable journal、owner token、generation CAS、crash recovery、断电与 fsync durability 证明。
2. **legacy metadata migration：** 缺失或无效 provenance 继续 fail closed；尚无签名、事务化、可审计的旧安装
   metadata backfill/migration 与固定历史兼容证据。
3. **外部 Marketplace 产品化：** 真实 private registry TLS/auth、publisher/组织 trust root、key revocation、
   代理/PAC/custom CA、air-gapped/offline/cache、依赖冲突、供应链故障及干净外部宿主长期矩阵仍未完成。

因此，第十八节的 **cross-scope effective authority** 剩余项由本节关闭；P1-5 整项仍为**部分完成**。总计数
保持 **12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节不关闭
任何外部发布门，也不改变 P2-4 与其他 11 个剩余路线项的状态。

## 二十、2026-08-18 P1-5 同作用域跨进程 owner 与进程崩溃恢复子门复核（`00:12 +08:00`）

本节继续第十九节的 P1-5 收口，但保留此前各节的历史快照。实现审计起点是 `c6ec46ff2d`；验证期间基线由不重叠的
release 文档提交前进到 `58cbc7a316`，本节插件候选变更仍位于其未提交工作树之上。实现与本节文档尚未形成不可变提交，
也没有取得该 exact head 的 GitHub Actions 结果。因此下述证据是仓库内候选验证，
不能替代 npm 发布要求的 `CLI CI` 与 `CLI Strict Sandbox` Linux、Windows、macOS 全矩阵终态成功。本节只关闭
**同一 name/scope 下 install/add/upgrade 审阅事务的跨进程 owner 与进程被杀恢复**子门，不把它外推成跨 scope
同时写入、物理断电、多主机共享存储、
所有插件生命周期操作的通用崩溃恢复、旧安装迁移或外部 Marketplace 产品化完成。

### 本轮关闭的进程崩溃子门

- **固定 OS 级 per-name/scope owner。** 每个物理插件名称目录使用固定 `.plugin-transaction-lock`，通过同卷 staging、
  原子目录发布和排他创建建立单写者。`owner.json` 绑定 PID、启动时间、hostname 与随机 owner token；普通 install、
  update、active-version、enable/disable、uninstall 命令只会拒绝已有 owner，绝不凭 PID 失活自动偷锁。锁目录及 owner、
  journal、recovery-claim authority 会拒绝 symlink、非预期类型、硬链接和超限文件。
- **可恢复、带 CAS 的持久 journal。** `cc-plugin-lifecycle-transaction/v1` 记录 operation、phase、revision、前序 digest、
  owner、transaction root、pointer byte snapshot/file generation、候选与前驱 payload/source digest。每次 phase 迁移先验证
  exact owner、当前 revision/digest 与 authority 文件，再以新随机临时名写入、文件 `fsync`、原子替换；旧 writer、损坏
  digest、被替换 pointer/version bytes 或错误 recovery claim 均 fail closed。
- **审阅事务贯穿 validation→consent→finalize/rollback。** `plugin add` 现在与 `plugin upgrade` 一样始终返回待决事务，
  capability notice、install audit、Marketplace impact 与用户同意均在同一 owner 下完成；只有 exact candidate/state 仍匹配
  才能 finalize，拒绝或错误路径执行 rollback。进程在 staging、prepared、前驱 quarantine、候选发布、pointer 已替换但
  `candidate-active` journal 尚未写入、以及 active 待 finalize 等窗口退出时，恢复器按 journal 和实际字节共同裁决。
- **恢复 authority 独立且显式。** `cc plugin transaction <name>` 只输出去敏后的 PID/host/liveness、phase、revision 与
  journal digest，不泄露 owner token。`cc plugin recover <name> --action rollback|finalize|abort` 使用排他 recovery claim；
  同主机 owner 必须已死亡，跨主机或仍存活 owner 必须经 `--force-owner` 明确覆写。恢复动作继续受观察到的 owner token、
  journal digest/revision、pointer generation 与候选/前驱状态约束，成功释放时再以原子 rename 退休固定锁。
- **候选字节和原子指针进入刷盘边界。** staged regular files、版本元数据、active-pointer 临时文件与 disabled marker 在
  发布前执行文件 `fsync`；候选/前驱 rename、pointer 替换、transaction root 退休及锁发布/释放在平台支持时刷新父目录。
  staged 文件或 active pointer 刷盘失败会在暴露新 authority 前回滚，保留原有效字节；Windows 明确不支持的目录句柄
  flush 错误仅作为平台能力缺失返回，不被误写为已证明的目录持久化。

### 仓库内验证与证据边界

- 全部 23 个 `plugin-runtime-*` 单测文件终态为 **410 passed / 3 skipped**。其中真实 child-process fixture 覆盖：并发
  CLI 拒绝、owner 被杀后的 rollback/finalize、staging 与 prepared kill、active pointer 写入后且 journal 更新前 kill，
  rollback bytes intent/restore、pointer 已恢复但 terminal journal 尚未写入、finalize cleanup 前后，以及同版本前驱
  quarantine 后 kill 并恢复 exact 原字节；该真实进程组为 **11/11**。
- transaction journal 单测为 **6/6**，覆盖排他 owner、digest/revision 链、stale writer、journal 篡改、live/dead owner
  recovery、recovery-claim fencing/精确回收与硬链接 authority 拒绝；install fault injection 又覆盖 staged-file `fsync`
  和 active-pointer `fsync` 失败。
- remote-artifact command、add capability notice、install audit、artifact readback、impact 与 lifecycle command 六文件为
  **98 passed / 1 skipped**。command manifest 与重新生成后的 175-command help index freshness 检查通过。
- 上述均为本地候选证据。`doctor-checkup.test.js` 的既有 Windows 默认时限问题没有计入通过数，也没有在本节中宣称
  关闭；物理断电、文件系统/杀毒软件/网络盘差异、长期矩阵和 exact-head CI 仍须独立验证。

### P1-5 仍未关闭的边界

1. **物理断电、平台目录持久化与共享存储：** 尚无真实突然掉电/硬重启矩阵；Windows 当前不能通过 Node 目录句柄证明
   parent-directory `fsync`，跨 hostname 的共享/网络文件系统也没有可靠的 owner liveness、fencing 与故障注入证据。
   不同 scope 当前各自持有独立 owner；会读取其他 scope baseline 的并行 mutation 尚无全局有序 multi-lock/fence，不能从
   本节同作用域互斥外推为跨 scope 原子决策。
   enable/disable/uninstall 虽已跨进程串行并保持跨作用域 preflight，但本节也不把它们声明为拥有与 install/add/upgrade
   相同的逐阶段崩溃恢复协议。
2. **legacy metadata migration：** 缺失或无效 provenance 继续 fail closed；仍无签名、事务化、可审计的旧安装 metadata
   backfill/migration 与固定历史兼容矩阵。
3. **外部 Marketplace 产品化：** 真实 private registry TLS/auth、publisher/组织 trust root、key revocation、代理/PAC/
   custom CA、air-gapped/offline/cache、依赖冲突、供应链故障及干净外部宿主长期矩阵仍未完成。

因此，第十九节“跨进程与崩溃一致性”剩余项中的**同 name/scope 进程存活期单写者与 process-kill recovery**由本节关闭，
并将跨 scope 并行 fencing、物理断电、目录持久化与多主机存储证明保留为显式剩余边界。P1-5 整项仍为**部分完成**；总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节不关闭任何外部发布门，
也不改变 P2-4 与其他 11 个剩余路线项的状态。

## 二十四、2026-08-18 P1-5 managed publisher/组织信任与 key revocation 子门复核（`01:41 +08:00`）

本节继续第二十三节，不回写此前历史快照。候选仍是 `58cbc7a316` 之上的未提交工作树，尚无 exact-head GitHub Actions。
本节关闭的是仓库内**组织管理策略直接绑定 registry publisher identity 与 manifest signing key，并在当前策略下执行 key
revocation**的子门；它不声称完成真实 private registry 部署、外部透明日志、TLS/代理/offline 或干净外部宿主旅程。

### 本轮关闭的 publisher trust 子门

- **registry 自述不能建立身份。** catalog/preflight 只规范化可选 `publisher.id` 与 `publisher.organizationId` 声明，仍将其视为
  registry assertion。只有组织控制的 managed settings 中存在 exact `trustRootId + publisherId + organizationId + pluginNames +
registryOrigins + signingKeySha256 + validity window` 映射，且该 Ed25519 key 真正验证当前 manifest，installer 才生成
  `cc-plugin-publisher-authority/v1`。
- **authority 同时绑定四个不可互换维度。** 持久记录包含 publisher/organization、插件 exact name、规范化 registry origin、
  实际 SPKI SHA-256、组织 trust-root id、规范化 policy digest、验证时间和 authority digest。错误 publisher、错误组织、同 key 的
  其他插件、镜像 registry、过期/未生效窗口或 registry 仅改 metadata 均不能匹配。
- **revocation 是当前 admission，而非一次性安装结论。** `revokedPluginPublisherKeys` 接受有界 fingerprint/record 列表；安装前
  已撤销 key 立即拒绝。strict provenance read 与 runtime managed-policy filter 会重新验证当前 manifest signature、持久 authority
  和当前组织策略；安装后新增撤销记录、删除/修改 trust mapping、替换 key/manifest 或篡改 authority 都 fail closed。
- **远端 artifact evidence 继续保持诚实分层。** signature/public-key/SBOM fetch evidence 仍不把 registry metadata 自称为
  publisher proof；publisher 结论来自单独 managed authority。`plugin evidence` 只有在 strict read 已按当前 managed root 重验后，
  才报告 `registryPublisherIdentityVerified=true`，否则继续明确为 unverified。

### 仓库内验证与证据边界

- 全部 24 个 `plugin-runtime-*` 文件终态为 **428 passed / 3 skipped**；新增 publisher-trust 文件 **3/3**，覆盖 exact 组织映射、
  identity/origin/name/key mismatch、validity window、撤销和安装后 manifest/current-policy 重验。
- Marketplace 六文件为 **100 passed / 1 skipped**；完整 loopback remote-artifact 文件为 **35/35**。新增真实 loopback 旅程使用
  registry publisher 声明、远端 detached signature/public key、managed organization mapping 完成安装和 evidence readback，随后
  写入 key revocation 并证明 strict provenance 立即拒绝。
- catalog 旧兼容矩阵仍为 **16/16**；无 publisher 声明的 registry 保持历史未验证语义，不会被本功能伪装为已验证。任务文件
  ESLint 通过，只有仓库既有的 `MODULE_TYPELESS_PACKAGE_JSON` 运行时提示。

### P1-5 仍未关闭的边界

1. **物理断电、平台目录持久化与多主机：** Windows 目录句柄 flush、突然掉电/硬重启、网络或共享文件系统 lease/fencing、
   文件系统/杀毒软件差异及长期矩阵仍无正式证据；当前 authority 只证明同一 OS 用户和本地文件系统。
2. **外部 Marketplace 产品化剩余项：** 仍需真实 private registry 的 TLS/auth 与干净外部旅程、代理/PAC/custom CA、
   air-gapped/offline/cache、依赖冲突和供应链故障矩阵，以及组织 key rotation/撤销在独立外部 trust distribution 或透明日志中的
   长期验证。本节的 managed direct mapping 是仓库内信任根执行核心，不替代这些部署证据。

因此，第二十三节外部 Marketplace 边界中的 **publisher/组织 trust root 与 key revocation 仓库内执行核心**由本节关闭；
P1-5 整项仍为**部分完成**。总计数保持 **12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为
**NO-GO**。本节不关闭任何外部发布门，也不改变 P2-4 与其他 11 个剩余路线项的状态。

## 二十五、2026-08-18 P1-5 private registry 网络与显式离线核心子门复核（`02:16 +08:00`）

本节继续第二十四节，不回写此前历史快照。候选仍是 `58cbc7a316` 之上的未提交工作树，尚无 exact-head GitHub Actions。
本节关闭的是仓库内**真实 TLS/auth、显式 proxy/PAC/custom CA 传输，以及 registry/signature/key/SBOM 的 pinned offline
回放核心**；它不把 loopback 旅程外推成企业外网部署、远端 Git source-package cache、干净外部宿主或长期故障矩阵。

### 本轮关闭的 registry 网络与离线核心

- **registry 缓存从可变 latest 文件升级为不可变 authority。** registry 响应设 4 MiB 硬上限和严格 UTF-8/JSON 校验，按完整 URL
  hash 与文档 SHA-256 写入单链接、同目录原子发布的不可变条目；读取重新计算 digest 并限制候选数量。显式 `--offline` 在任何
  cache 检查前都不会构造 transport，同一 URL 存在多个有效历史文档时拒绝猜测，要求 repeatable `--registry-digest
<url=sha256>` 精确 pin。401/403、malformed response 和 digest mismatch 不再被历史 cache 静默掩盖，只有 transport/timeout/5xx
  可走隐式 verified-cache fallback。
- **六个 registry 入口共享显式网络语义。** `browse`、`catalog`、`select`、`impact`、`add` 与 `upgrade` 均支持 offline/pin、
  `--proxy`、`--pac-file` 和 `--ca-file`；专用环境变量为 `CC_PLUGIN_REGISTRY_PROXY`、`CC_PLUGIN_REGISTRY_PAC_FILE` 与
  `CC_PLUGIN_REGISTRY_CA_FILE`。ambient `HTTP_PROXY/HTTPS_PROXY` 不会在未审阅时改变 Marketplace authority。注册表文档 digest、
  去凭据后的 proxy origin、PAC digest 与 CA digest 进入 catalog digest 和最终 provenance；proxy userinfo 只转换为内存中的
  authorization header，不会写入 authority。
- **PAC 是有界且可终止的输入。** PAC 只从本地单链接普通文件读取，限制 256 KiB、严格 UTF-8 并要求 `FindProxyForURL`；脚本由
  QuickJS 在 resource-limited worker 中运行，默认 2 秒硬超时，worker error/exit/死循环均 fail closed。仅接受按顺序解析的
  `PROXY`、`HTTP`、`HTTPS` 或 `DIRECT` route；显式 proxy 与 PAC 互斥。CA bundle 同样要求单链接、非空、1 MiB 上限，并在联网前
  创建 TLS context；自定义 CA 追加到系统 roots，而不是删除公共 roots。
- **离线安装不会在解析后偷跑 Git。** registry、detached signature、public key 与 SBOM 都可从 verified immutable cache 回放；
  `add/upgrade --offline` 还要求 registry entry 指向已存在的本地插件目录且不得带 git ref。远端 Git/归档 source-package cache
  尚未实现时，命令会在 clone/process 前明确拒绝，因此本节证明的是零网络的本地 seed 旅程，而不是伪称任意远端源已 air-gapped。
- **真实请求覆盖 TLS、认证、proxy 与断网回放。** loopback HTTPS 私有 registry 使用运行时生成的自签名证书：默认 trust 失败，
  exact CA file 加载后成功，并在服务端观察到 Bearer token。独立 HTTP proxy 实际承载 registry 请求；PAC route 也实际穿过该
  proxy。完整 Marketplace 旅程先在线缓存 registry/signature/public-key/SBOM，关闭服务器后用 registry digest pin 在另一 scope
  完成安装，服务端请求计数保持 0，持久 evidence 的所有远端文档均标为 cache read。

### 仓库内验证与证据边界

- 全部 24 个 `plugin-runtime-*` 文件终态仍为 **428 passed / 3 skipped**；这次完整重跑覆盖第二十四节之后对 managed-policy
  无配置路径的 fail-closed 修正。
- 六个 `plugin-marketplace-*` 单测与完整 remote-artifact 集成文件合计 **122 passed / 1 skipped**；新 network 文件为 **5/5**，
  真实 loopback remote-artifact 文件为 **36/36**。六个核心/命令/安装聚焦文件另取得 **174/174**。
- command help index 已按新增参数重生成。任务文件 ESLint 为 **0 errors**；原 catalog 的 unused warning 已清理，只保留仓库根
  `MODULE_TYPELESS_PACKAGE_JSON` 提示。上述本地证据仍不替代 exact-head `CLI CI` 与 `CLI Strict Sandbox` 的 Linux、Windows、
  macOS 终态矩阵。

### P1-5 仍未关闭的边界

1. **物理断电、平台目录持久化与多主机：** Windows 目录句柄 flush、突然掉电/硬重启、共享/网络文件系统 lease/fencing、
   文件系统与安全软件差异及长期矩阵仍无正式证据。
2. **外部 Marketplace 产品化剩余项：** 当前 TLS/auth/proxy/PAC/custom-CA 是仓库内真实 loopback 核心，不是干净外部企业宿主
   部署证明；远端 Git/归档 source-package 的 air-gapped seed/cache、依赖冲突与供应链故障矩阵、独立 trust distribution/
   transparency log、key rotation 以及长期网络退化旅程仍未完成。

因此，第二十四节外部 Marketplace 边界中的 **private registry 网络与 pinned registry/artifact offline 仓库内执行核心**由本节
关闭；P1-5 整项仍为**部分完成**。总计数保持 **12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为
**NO-GO**。本节不关闭外部发布门，也不改变 P2-4 与其他 11 个剩余路线项的状态。

## 二十六、2026-08-18 P1-5 semantic source-package air-gap 与依赖环阻断子门复核（`02:27 +08:00`）

本节继续第二十五节，不回写此前历史快照。候选仍是 `58cbc7a316` 之上的未提交工作树，尚无 exact-head GitHub Actions。
本节关闭的是仓库内**以 manifest digest + repository-defined payload SBOM 为双锚的远端 Git source-package cache**，以及把
已投影的 dependency cycle 升级为安装 blocker；它不声称完成外部企业宿主、任意无 payload anchor 的源包缓存或长期供应链演练。

### 本轮关闭的 source-package 与 dependency 子门

- **远端源只有完整 semantic anchor 才可 seed。** 新 `cc-plugin-marketplace-source-cache/v1` 从 registry provenance 读取 exact
  resolved source/ref、manifest SHA-256 与 `cc-plugin-marketplace-payload-sbom/v1|v2` digest，形成 content-addressed cache key。
  缺 manifest digest、缺 semantic payload digest、普通 CycloneDX 或非 registry source 均返回 not-cacheable；它们不能只凭本地
  cache metadata 自证代码完整性。
- **cache payload 与 installer staged bytes 使用同一排除语义。** 在线 Git materialization 成功通过 manifest/signature、远端 SBOM
  staged-byte 比较和安装校验后，source cache 才复制排除 `.git`、signature lock 与 provenance 的 payload。条目先在同根隐藏目录
  写入，authority 文件 durable 后原子 rename 发布；authority 绑定 source/ref、manifest digest、payload schema/digest、fileCount/
  totalBytes、cache key 与 authority digest。并发已有条目不会覆盖，而是重新读取并验证。
- **离线读取不信任本地 authority。** exact cache path 由外部 registry/SBOM 锚点直接计算；读取要求目录非 symlink、authority 为有界
  单链接普通文件，再重新解析 manifest、重算 manifest SHA-256 和完整 semantic payload SBOM，并与规范 authority 逐字段比较。
  payload/authority tamper、hardlink、错误 manifest、特殊文件或缺失锚点均在 installer staging/clone 前 fail closed；installer 仍会在
  cache read 后再次复制并执行原有 signature/SBOM/load validation，避免 read-to-copy race 放宽 authority。
- **真实 Git air-gap 旅程不依赖原始仓库。** 测试创建真实 Git repository，以 `file://` Git source 走实际 clone 和在线 cache seed；
  随后原始 repository 被 rename、registry 服务器被关闭。另一 scope 使用 pinned registry、signature/public-key/SBOM cache 与 source
  cache 完成安装，网络请求为 0，result 报告 exact source-cache hit，最终 provenance 保留 offline 与 matched semantic comparison。
- **依赖环从可见诊断升级为 admission blocker。** catalog 仍发布有界 dependency nodes/edges/cycles；任何位于 cycle 的候选现在新增
  `DEPENDENCY_CYCLE` 并标记不可安装，图超过 65,536 edges 时 selection 新增 `DEPENDENCY_GRAPH_TRUNCATED`。现有 missing/mismatch、
  host incompatibility、same-name/version source conflict、unhealthy publisher 和 source-set incomplete blocker 继续保持 fail closed。

### 仓库内验证与证据边界

- 全部 24 个 `plugin-runtime-*` 文件终态仍为 **428 passed / 3 skipped**；source-cache integration 没有放宽 install、transaction、
  cross-scope 或 managed-policy 既有矩阵。
- 七个 `plugin-marketplace-*` 单测与完整 remote-artifact 集成文件合计 **126 passed / 1 skipped**；source-cache 文件 **3/3**，
  完整 remote-artifact 文件 **37/37**。catalog/source-cache/install/remote-artifact 四文件聚焦回归为 **160/160**。
- 新增依赖只用于正式运行时：`undici` 提供 request-scoped dispatcher，`pac-resolver` 与 QuickJS 提供隔离 PAC；npm lockfile 已绑定
  解析结果。本地测试与 lockfile 不替代 exact-head `CLI CI`、`CLI Strict Sandbox` 的 Linux/Windows/macOS 全矩阵和 npm 发布门。

### P1-5 仍未关闭的边界

1. **物理断电、平台目录持久化与多主机：** Windows 目录 flush、突然掉电/硬重启、共享/网络文件系统 lease/fencing、文件系统与
   安全软件差异及长期矩阵仍无正式证据。
2. **外部 Marketplace 产品化剩余项：** 当前 private registry、proxy/PAC/CA、四层 offline cache 和 dependency blockers 仍是仓库内
   loopback/本地 Git 证据；干净外部企业 registry/代理/宿主的安装→升级→回滚、代理中断和 cache corruption 长期矩阵，组织 key
   rotation、独立 trust distribution/transparency log，以及更广泛供应链事故演练仍未完成。无 semantic payload anchor 的远端源包
   继续明确不支持离线缓存。

因此，第二十五节保留的 **remote Git source-package air-gap 仓库内执行核心与 dependency-cycle admission**由本节关闭；P1-5
整项仍为**部分完成**。总计数保持 **12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。
本节不关闭外部发布门，也不改变 P2-4 与其他 11 个剩余路线项的状态。

## 二十七、2026-08-18 P1-5 cache corruption 与供应链矩阵合同子门复核（`02:41 +08:00`）

本节继续第二十六节，不回写其历史测试计数。候选仍位于 `58cbc7a316` 之上的未提交工作树，尚无 exact-head GitHub Actions。
本节关闭的是仓库内**source-package cache 的 hardlink/TOCTOU 检查**与**供应链故障矩阵的版本化输入合同**；它不会把合同、
loopback 或本地回归外推成三平台企业网络 100 次独立运行的外部 evidence。

### 本轮关闭的 cache 与矩阵合同

- **缓存 payload 不再只依赖最终 digest 发现链接攻击。** 离线 source-package read 在重算 manifest/SBOM 前递归检查 payload：目录不得
  是 symlink，每个 payload 文件必须是普通单链接文件，特殊文件、symlink 与 hardlink 均 fail closed。authority read 从
  `lstat → path read` 改为 `lstat → O_NOFOLLOW open → fstat → descriptor read`，校验 inode 视图中的类型、链接数、大小和严格 UTF-8；
  exact content-addressed 条目缺失会报告 `OFFLINE_SOURCE_CACHE_MISS`，不再泄漏无语义的原始 `ENOENT`。
- **代理中断只允许回放外部 pin 已绑定的有效缓存。** 真实 loopback proxy 先承载 registry 请求并 seed immutable cache，proxy 关闭后，
  exact registry document pin 可从重验后的 cache 回放；随后修改同一 cache bytes，下一次相同中断场景会以
  `verified immutable cache rejected` 和 digest mismatch 失败，不会把网络退化变成未验证 activation。
- **供应链故障范围成为可机读 required contract。** roadmap fixture manifest 从 `1.4.0` 升至 `1.5.0`，新增
  `p1-marketplace-supply-chain`：明确 registry 401/403/5xx/timeout、proxy/PAC/CA、跨 origin redirect、signature/key/SBOM、
  registry/artifact 文档 cache 与 source cache corruption、依赖缺失/错版/环/同版本来源冲突、未批准来源切换、publisher revocation，及
  activation/rollback crash 等 24 类注入。要求 Windows/Linux/macOS × private-TLS/explicit-proxy/PAC/air-gap 四类 transport，
  每个 cell 至少 100 次独立运行，并产出 exact commit、network authority、fault record、redacted diagnostics、artifact/source digest、
  transaction journal、rollback evidence 与 outcome observations。
- **fixture 与 manifest 不能各写一套成功标准。** verifier 现在要求 fixture 内的 `expectedOutcome` 与 manifest case 的
  `expectedOutcome` canonical-equal；只修改一侧即 contract failure。该合同明确以 `external-evidence-required` 保持发布门关闭，
  仓库测试文件只能证明实现覆盖，不能充当外部运行结果。

### 仓库内验证与证据边界

- 七个 `plugin-marketplace-*` 单测与完整 remote-artifact 集成文件为 **127 passed / 1 skipped**；其中 source-cache 为 **4/4**、
  network 为 **5/5**、完整 remote-artifact 为 **37/37**。source-cache/install/remote-artifact 三文件加固聚焦回归为 **145/145**。
- roadmap verifier 文件为 **30/30**；network/source-cache/verifier 三文件合计 **39/39**。`--contract-only` 回读 manifest `1.5.0` 为
  **11 cases / 39 referenced test files**，并明确报告 runtime evidence 与 release readiness 未被评估。
- 第二十六节记录的 24 个 `plugin-runtime-*` 文件 **428 passed / 3 skipped**仍是最近完整 runtime 结果；本节没有把未重跑的外部
  exact-head CI 或三平台 1,200 个供应链样本写成成功。任务文件仍须通过 ESLint、help/command manifest freshness 与 diff 检查后才可交付。

### P1-5 仍未关闭的边界

1. **物理断电、平台目录持久化与多主机：** Windows 目录 flush、突然掉电/硬重启、共享/网络文件系统 lease/fencing、文件系统与
   安全软件差异及长期矩阵仍无正式证据。
2. **外部供应链矩阵：** `p1-marketplace-supply-chain` 现在精确定义了 12 个 OS/transport cells 和每格 100 次要求，但尚未取得干净
   外部企业 registry/代理/宿主的 exact-head evidence；组织 key rotation、独立 trust distribution/transparency log 与真实事故演练
   仍未完成。manifest `1.5.0` 是门的输入，不是门的通过结果。

因此，第二十六节保留的**本地 cache corruption 防线与供应链矩阵输入合同**由本节关闭；P1-5 整项仍为**部分完成**。总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节不关闭外部发布门，也不改变
P2-4 与其他 11 个剩余路线项的状态。

## 二十八、2026-08-18 P2-4 双 IDE 可访问语义与长会话边界合同子门复核（`03:08 +08:00`）

本节开始推进第二十七节仍保留的 P2-4，但不回写此前历史状态。候选仍位于 `58cbc7a316` 之上的未提交工作树，尚无
exact-head GitHub Actions。本节关闭的是仓库内**双 IDE 聊天与 Sessions Workbench 入口的可访问语义、焦点生命周期、
2,000-message 有界 transcript 及 128-session 本地规模实现核心**，并把完整真实宿主验收变成版本化合同；它不把
DOM/Swing 单测外推为 NVDA、VoiceOver、Orca 或
八小时真实宿主证据。

### 本轮关闭的可访问性与有界 transcript 子门

- **VS Code Webview 不再只依赖视觉结构。** conversation transcript 现在是可聚焦的 `role=log`，status/context/attachment
  使用有界 live-region 语义，流式 turn 显式投影 `aria-busy`；composer 与 suggestion list 形成
  `aria-controls/expanded/activedescendant + listbox/option` 关系，消息、错误和工具活动具有稳定 accessible label，所有键盘焦点
  使用 IDE focus color。conversation tabs 使用 `tablist/tab/aria-selected`，支持 ArrowLeft/ArrowRight/Home/End 移动焦点、
  Enter/Space 激活和 Delete 关闭；close button 也有逐 tab 名称。
- **VS Code 长会话裁剪成为可直接回归的纯函数。** `trimOldestLogNodes` 从生成 HTML 中复用，而不是测试另写一套算法；2,000 个
  message node 输入会精确移除最旧 1,200 个，只保留最新 800 个。生成后的全部 inline scripts 继续由 `vm.Script` 做语法校验，
  所以函数源码注入不会把真实 Webview 变成只在源码层看似有效。
- **单条超大 diff/log 不再绕过 transcript 总量边界。** VS Code streaming answer、thinking、plain command/log 与非流式 final answer
  共用 200,000 字符 head/tail accumulator；JetBrains active assistant run 与普通 append 采用同一上限。两端都保留开头和最新结尾、
  不保留被省略的中段，并在正文中显示 `N characters omitted from oversized transcript entry`，因此裁剪不是静默的。纯逻辑以
  64 MiB ASCII 输入验证完整逻辑计数与有界驻留，JetBrains 另以 16 MiB 分块 assistant stream 验证 finalize 前后均不超过上限。
- **Sessions Workbench 的 128-session 合同不再超过实现上限。** VS Code 与 JetBrains 的 canonical projection 请求均改为有界
  256 条；VS Code 以 128 行真实 HTML 回归表格渲染、筛选、caption/column scope、逐操作 accessible label、region/loading
  `aria-busy` 与可播报计数，JetBrains 以 128 行纯模型回归保留与筛选，并为 root、search、status、session/delivery controls 和
  动态 delivery action 设置稳定 AccessibleContext 名称。该回归只证明输入不会先被 100/50 条旧默认值截断，不声明 128 条
  真实宿主延迟或资源 SLO 已通过。
- **JetBrains Swing 暴露稳定 AccessibleContext。** transcript、composer、send/stop、LLM、context status、approval/question
  card region、conversation root 与 Sessions Workbench controls 均提供可读名称或说明；screen reader 不再只能猜测匿名
  `JTextPane/JTextArea/JPanel`。真实
  `ChatTranscript` 追加 2,000 条固定大小消息后保持在 `TranscriptCap.DEFAULT_MAX_CHARS=200,000` 内，最旧内容被移除且最新
  message 仍存在。
- **Desktop 共用焦点工具补齐销毁与恢复边界。** focus history 上限为 32，恢复时跳过已 detach 节点；focus trap 释放后回到仍连接的
  opener，hidden/inert/disabled/negative-tabindex 元素不会进入顺序。document keyboard listener、延迟 announcer timer 与
  `DOMContentLoaded` listener 均在 destroy 时移除，singleton 被销毁后会安全重建；document 自身作为 key target 不再触发
  `tagName` 运行时异常。该项是 Desktop shell 的仓库内补强，不代替双 IDE 真实宿主证据。
- **P2-4 退出条件成为 external-evidence-required 合同。** roadmap manifest 从 `1.5.0` 升至 `1.6.0`，新增
  `p2-accessibility-performance`（fixture SHA-256
  `d8f5045f41e34086b75f8ed09802723be86eeb2ee6105e79e64e751cb1cbad4d`）。合同要求 VS Code/JetBrains ×
  Windows/Linux/macOS × keyboard-only/screen-reader/long-session-scale 共 18 个 cell；输入固定为每会话 2,000 messages、
  16 MiB diff、64 MiB log、128 sessions 与 28,800 秒连续运行，并要求 keyboard/action、accessibility tree、screen-reader、
  focus、P50/P95/P99、RSS/heap、FD/handle 与 orphan-process 证据。Windows/macOS/Linux 分别声明 NVDA、VoiceOver、Orca，
  manifest/fixture 的 expected outcome 仍须 canonical-equal。

### 仓库内验证与证据边界

- Desktop accessibility 定向为 **12/12**，完整 `vue-tsc --noEmit` 与该目录 ESLint 均通过。
- VS Code `host-dom-relay` 聚焦文件为 **10/10**，与 `sessions-view-delivery` 合并聚焦为 **16/16**；完整 `test:unit` 为
  **101/101**，其中包含生成 HTML 脚本语法、固定 DOM relay journey、ARIA/键盘合同、2,000→800 node 裁剪、64 MiB 单条输入和 Workbench
  region/loading 语义。CLI 侧 Workbench 纯逻辑文件为 **33/33**，包含 256 条默认请求与 128 行 HTML render/filter 回归。
- JetBrains 完整 JUnit 为 **744 passed / 3 skipped**（747 tests、0 failures、0 errors）；`SessionsWorkbenchTest` 聚焦为
  **16/16**，`TranscriptCapTest` 为 **9/9**，`ChatTranscriptTest` 为 **5/5**，且 `compileJava/compileKotlin` 在本机 JetBrains
  Runtime 21 下通过。
- roadmap verifier 与 journey evidence 两文件为 **37/37**；`--contract-only` 回读 manifest `1.6.0` 为
  **12 cases / 46 referenced test files**，并明确报告 runtime evidence 与 release readiness 未被评估。任务 JS/TS 文件 ESLint
  为 0 errors；仓库根仍只有既有 `MODULE_TYPELESS_PACKAGE_JSON` 提示。

### P2-4 仍未关闭的边界

1. **真实 assistive technology 与键盘全路径：** 尚未在 stock/minimum VS Code 与 JetBrains 的 Windows NVDA、macOS VoiceOver、
   Linux Orca 上完成 chat、approval、question、plan、diff、Workbench 和恢复后的完整语音/焦点旅程；仓库 ARIA/AccessibleContext
   断言不能替代用户实际听到的顺序、重复率与可操作性。
2. **性能与长期宿主：** 2,000-message 裁剪、16/64 MiB transcript-entry accumulator 与 128-session render/filter 只证明聊天视图和
   Workbench 的本地有界实现；它们不等价于真实 diff editor/log artifact surface，也不证明这些输入的 P50/P95/P99、RSS/heap、
   FD/handle、orphan 或八小时稳定性。18-cell 合同尚无 exact-head 外部 artifact，任何缺失 measurement 必须 fail closed，不能用
   本地单测补齐。

因此，P2-4 的**仓库内双 IDE accessibility semantics、focus lifecycle、transcript/oversized-entry bound、128-session Workbench
基线，以及外部验收输入合同**由本节关闭；
P2-4 整项仍为**部分完成**。总计数保持 **12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为
**NO-GO**。本节也不改变 P1-5、Q0、Q3、Q4a/Q4b 或其他外部发布门的状态。

## 二十九、2026-08-18 Q3 生产交付 live journey 退出合同子门复核（`03:35 +08:00`）

本节继续推进第十八节保留的 Q3 外部交付门，但不把已经存在的 production adapter/runner 仓库实现或其单元测试重写成真实公网
交付成功。候选仍位于 `58cbc7a316` 之上的未提交工作树，尚无 exact-head GitHub Actions，也没有在本轮调用 GitHub provider、创建
PR、合并分支或写入外部归档。本节关闭的是**把唯一可接受的生产旅程、仓库保护策略、故障注入和不可变证据输入固化为版本化、
fail-closed 的 required contract**；Q3 整项仍须由具备相应仓库与归档权限的执行方产生外部证据。

### 本轮关闭的 Q3 退出合同子门

- **生产入口必须执行完整序列，而不是只证明 provider 可构造。** 新增 `q3-production-delivery-live` fixture，固定入口为
  `cc artifacts delivery-run`、provider 为 `github-production`，要求顺序为
  `run_gates → run_preview → run_review → apply_fix → run_gates → run_preview → run_review → create_pr → refresh_ci → publish_evidence → merge → archive`。
  fix 之后的 gates/preview/review 是独立必需阶段，不能以修复前结果复用或省略；所有外部 effect 仍须由 coordinator revision 与
  exact head 共同约束。
- **受保护合并条件成为合同输入。** repository policy 明确要求 branch protection、至少一名 approving review、admin enforcement、
  signed commit 或等价 ruleset，以及精确 required-check 集。结果合同要求 unprotected merge、缺 required review、缺 required check、
  moved-head mismatch 与 effect replay 均为 0，避免“PR/CI 存在”被误当成“受控交付完成”。
- **成功响应丢失与外部漂移必须可重放但不可重复执行。** 故障矩阵固定注入 provider 成功但 settlement 前崩溃、settlement response
  丢失、stale state revision、remote head 移动、重复 required check、缺 review、evidence bytes 篡改和 archive readback mismatch。
  live evidence 必须能证明 effect ledger 没有重复副作用，并保留 delivery state revisions、gate/preview/review、fix diff digest、PR/CI、
  merge 与 archive 的完整链路。
- **archive 必须是外部不可变/WORM authority，而不是本地自述。** 合同要求独立或公开回读、逐字节 digest 重验、exact-commit 绑定、
  redacted diagnostics 与 outcome observations；缺任一 measurement、回读不一致或 credential 泄漏都不得把场景标记为通过。
- **roadmap 合同升级到 `1.7.0`。** fixture SHA-256 为
  `90281a31545d059c72e2a45728bd2af885c5f99d6d36b64440703b9ad911940e`；manifest 将该场景标为
  `P0 / required / external-evidence-required`。fixture 与 manifest 的 `expectedOutcome` 继续由 verifier 做 canonical-equal 校验，
  所以修改单边成功标准会直接失败。

### 仓库内验证与证据边界

- `delivery-coordinator`、`delivery-production-adapter`、`delivery-production-runner` 与 `delivery-production-command` 四个聚焦文件为
  **49/49**。这些测试证明仓库内生产接线、revision-bound settlement 与 fail-closed 行为未被新合同破坏，不证明本次发生了真实外部 effect。
- roadmap verifier 与 journey evidence 两文件为 **37/37**；`--contract-only` 回读 manifest `1.7.0` 为
  **13 cases / 50 referenced test files**，并继续明确报告 runtime evidence 与 release readiness 未被评估。
- 本轮未读取或使用生产凭据，未变更 GitHub ruleset/branch protection，未创建 PR，未执行 merge，也未写入 WORM 归档。因此仓库内
  49 项测试和合同回读都只能作为执行前门，不能充当 `q3-production-delivery-live` 的成功运行记录。

### Q3 仍未关闭的边界

1. **exact-head 真实生产执行：** 尚需在同一发布 commit 上由 `cc artifacts delivery-run` 调用真实 GitHub provider，完成上述 12 阶段
   序列及 fix-rerun，并把 PR head、required checks、review、merge commit 与全部 evidence digest 绑定到同一 authority。
2. **真实仓库保护与独立归档：** 执行仓库必须实际启用合同声明的 review、admin enforcement、signature/ruleset 和精确 checks；最终
   evidence 必须写入外部不可变/WORM 存储并由独立读者逐字节回读。现有 adapter 单测、人工 PR、普通 artifact 或本地文件均不能替代。

因此，Q3 的**真实生产旅程退出输入、失败注入、仓库策略与 WORM 回读合同**由本节关闭；Q3 整项仍为**部分完成 / live journey
延后**。总计数保持 **12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节也不改变
S0-1～S0-3、Q0、Q4a/Q4b、P1-1～P1-5 或 P2-4 的外部发布状态。

## 三十、2026-08-18 P1-1 模型草案与人工摘要确认子门复核（`03:51 +08:00`）

本节开始推进第二十九节仍保留的 P1-1，但不把“模型能返回 JSON”外推为 workflow 已获执行 authority，也不改变 manifest 中
`durablePauseResume=false`、`exactlyOnceAfterResume=false`、`needsInputBetweenStages=false` 的真实声明。候选仍位于
`58cbc7a316` 之上的未提交工作树，尚无 exact-head GitHub Actions；本节关闭的是仓库内**自然语言请求→不可执行草案→人工核对精确
digest→带审阅 lineage 的版本化定义**子门，不关闭运行中控制、崩溃恢复、双 IDE 或 plugin 分发。

### 本轮关闭的生成与审阅 authority

- **模型输出默认没有写入或执行权限。** `cc cowork workflow draft <prompt>` 调用显式 provider/model 后只向 stdout 输出
  `cc-dynamic-workflow-draft/v1`；草案状态固定为 `pending-review`，包含 prompt digest 而不保留原 prompt，且该命令不创建
  `.chainlesschain/cowork/workflows`。模型只能返回一个裸 JSON object 或一个精确 JSON fence；前后 prose、超限响应、无效 JSON、
  secret-shaped 内容及模型自行伪造的 generation/review authority 均 fail closed。
- **草案必须先满足可审阅的完整治理合同。** 生成定义继续复用现有 `createDynamicWorkflowManifest` 与版本化 definition digest；声明的
  capability 必须与实际 DAG/loop/retry/parallel 计划精确一致，execution location、permission、sandbox、data boundary、credential
  reference、token/USD/time estimates 与 budget 均不得缺失。未知运行时 fan-out、超过 64 task 上限、parallel/token/USD/time 预算不足
  会在人工审阅前被拒绝，不能靠 reviewer 按钮绕过 preflight 基线。
- **人工接受绑定读到的 exact draft bytes。** `cc cowork workflow review <file>` 只读取有界、普通、单硬链接文件，并以
  `lstat → O_NOFOLLOW open → fstat → descriptor read → fstat` 固定文件身份。reviewer 必须显式提供
  `--expected-draft-digest` 以及且仅有一个 `--accept/--reject`；摘要漂移、hardlink、读取竞态、secret-shaped reason 或同时/均未给出
  decision 均不落盘。
- **只有 accepted 定义进入现有不可变版本仓库。** 接受操作把 generation schema、prompt digest、provider/model、generatedAt、
  source definition digest、draft digest、reviewer、reason 与 reviewedAt 写入最终 definition；随后复用 `saveWorkflow` 的 current record 与
  content-addressed version，并立即回读最终 definition digest。拒绝记录返回 `definition=null` 且 `persisted=false`，不会产生可执行版本。
  这是一条本地人工审阅 authority，不冒充组织签名、Marketplace publisher 或真实宿主 attestation。
- **P1-1 完整退出条件进入 machine-readable contract。** roadmap manifest 从 `1.7.0` 升至 `1.8.0`，新增
  `p1-dynamic-workflow`（fixture SHA-256
  `df377b8b287343bf3259973e4ab905610c0232db2e6ae994b3cb905eafd98e9f`）。合同固定生成/拒绝/接受/执行/pause/resume/stop/restart/replay
  旅程、15 类故障注入、64-task 上限、token/time/cost/checkpoint/artifact measurement，以及 CLI/VS Code/JetBrains × 三 OS ×
  Local/WSL/SSH/Container/Cloud 矩阵；每个 cell 至少 100 次。该 case 保持 `external-evidence-required`，合同本身不是通过结果。

### 仓库内验证与证据边界

- 新增 draft/review 纯逻辑文件为 **7/7**，Commander 集成为 **4/4**，合计 **11/11**；覆盖无落盘生成、严格 JSON、secret/review
  authority 拒绝、治理与预算、定义/投影/digest 漂移、exact human acceptance、拒绝不保存、hardlink 拒绝、accepted store/readback。
- Dynamic Workflow draft、facade、Cowork DAG、WebSocket、run admission 与两份 command integration 共六个文件为 **189/189**；既有
  runtime claims 仍断言三个未实现能力为 `false`。lazy-dispatch/help index 为 **22/22**，175 个顶层命令 help index freshness 通过。
- roadmap verifier 与 journey evidence 两文件为 **37/37**；`--contract-only` 回读 manifest `1.8.0` 为
  **14 cases / 56 referenced test files**，并继续明确报告 runtime evidence 与 release readiness 未被评估。

### P1-1 仍未关闭的边界

1. **durable runtime control 与阶段最多一次：** 当前 Cowork executor 仍没有可恢复的 pause/resume/stop/restart 状态机，也没有 provider
   effect 成功但 settlement 前崩溃时的 reconcile authority。不能把 accepted definition、best-effort history 或 scheduler 的其他
   adapter 能力外推为 workflow stage exactly-once；阶段间一般 `needs_input` 仍明确不支持。
2. **真实宿主、lineage 与分发：** 尚未取得双 IDE phase/agent/token/time/budget/control UI、checkpoint/artifact/side-effect lineage、
   Local/WSL/SSH/Container/Cloud 真实执行、100 次每格重放以及 plugin/marketplace 安装升级的 exact-head 外部证据。本轮 provider 路由
   已接到 CLI，但自动测试使用注入 provider，不能充当真实模型质量或长期稳定性证据。

因此，P1-1 的**模型生成不可直接执行、严格治理草案、人工 exact-digest 审阅与版本化保存 lineage**由本节关闭；P1-1 整项仍为
**部分完成**。总计数保持 **12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节也不改变
S0-1～S0-3、Q0、Q3、Q4a/Q4b、P1-2、P1-4、P1-5 或 P2-4 的状态。

## 三十一、2026-08-18 P1-1 串行 durable runtime 与 outcome-unknown reconcile 子门复核（`04:04 +08:00`）

本节继续第三十节，但不回写其当时尚未实现 durable control 的快照。候选仍位于 `58cbc7a316` 之上的未提交工作树，尚无
exact-head GitHub Actions。本节关闭的是仓库内**串行 workflow effect 的 request-before-provider、settlement 持久化、安全点
pause/resume/stop、崩溃后禁止自动重放与显式 reconcile**核心；它刻意把 `maxParallel` 固定为 1，不把串行语义外推为并发阶段、
真实 provider 幂等或完整 P1-1。

### 本轮关闭的 durable runtime 子门

- **每个物理 task call 在 provider 前先取得持久 effect identity。** `runStepWithRetry` 现在向 runner 传递稳定的
  `stepId + iteration + attempt` context；durable runtime 将其与无 signal 的 canonical payload、run id 共同摘要，先在跨进程严格锁内
  写入 `pending` effect、fsync 临时文件、原子 rename，并在 POSIX 上 fsync 父目录，随后才调用 task provider。provider 同时收到
  `workflowEffectId`，可把同一 identity 继续传给具有原生幂等能力的外部服务。当前 durable 路径还会在创建 state 前拒绝带 step retry
  或 timeout 的 definition，避免一个超时但随后成功 settlement 的 attempt 被现有 retry 语义再次调用 provider。
- **outcome unknown 永不自动重放。** provider 抛错、返回后进程崩溃、settlement 写入失败或下一进程发现 pending effect 时，run 进入
  `blocked` 并返回 `reconciliation-required`；普通 resume 会因 pending effect fail closed。operator 必须在 exact runtime revision 上提供
  有界、secret-free、普通单链 result 文件完成 reconcile，之后重跑从已 settlement 的结果回放，provider 不会再次收到该 step/iteration/
  attempt。没有外部结果的场景不会被系统猜测成成功或安全重试。
- **pause/resume/stop 只在无新 effect 的边界生效。** 每次新 provider request 前重新读取控制状态；运行中 pause 先记
  `pause_requested`，当前 provider 结算后在下一安全点进入 `paused`。resume 需要 exact revision，且必须先清空 pending reconcile；随后
  从头确定性重建 DAG，但所有 settled effect 直接回放。stop 为终态，不允许 resume；当前已发生 effect 的 settlement evidence 仍保留，
  不会因 stop 被抹除或伪装成 rollback。
- **状态本身具有单写者、摘要链与读取身份检查。** 每个 run 使用独立 state file、严格 owner lock、revision CAS、state digest 与逐事件
  previous-digest lineage；读取采用 `lstat → O_NOFOLLOW open → fstat → descriptor read → fstat`，拒绝 symlink、hardlink、超限、
  路径/handle identity 漂移、JSON corruption、event/effect/revision/state digest 篡改。状态最多 64 effects 和 512 lineage events，
  不允许无界恢复元数据。
- **生成草案仍不能绕过第三十节人工门。** durable runtime 发现 definition 含 generation/review metadata 时，必须同时看到受支持 generation
  schema 与 `decision=accepted` 的 review authority、draft/source digest 和 reviewer；pending model draft 在创建 state 或调用 provider 前
  被拒绝。手写 versioned definition 继续由既有 admission/preflight authority 进入，不被强迫伪造“模型生成”记录。
- **真实 CLI 入口已接线但保持显式 opt-in。** `cc cowork workflow run ... --durable-run-id <id>` 使用同一双重 definition/location
  authority 核验，并强制 `maxParallel=1`；新增 `runtime-status|pause|resume|stop|reconcile`，所有 mutation 都要求 status 中显示的 exact
  revision。resume 只把 run 授权回 `ready`，随后仍须重新执行 `workflow run`，从而再次核验当前 definition 与 session-start authority。

### 仓库内验证与证据边界

- durable runtime 纯逻辑/真实文件测试为 **8/8**，Commander 生产路由为 **4/4**，合计 **12/12**；覆盖完整两阶段完成、provider-success
  后 settlement 前崩溃、pending 禁止 resume、人工 reconcile 后首阶段不重放、安全点 pause/resume、终态 stop、stale revision、secret
  reconcile 拒绝、pending generated definition 拒绝、accepted definition 执行、state tamper 与 hardlink 拒绝。
- draft/review、durable runtime、facade、Cowork DAG、WebSocket、run admission 及两组 command integration 共八个文件为
  **201/201**。lazy dispatch/help index 与 roadmap verifier/journey 合并回归为 **59/59**，其中 help/lazy 为 **22/22**、roadmap 两文件仍为
  **37/37**；175 个顶层命令 help index freshness 通过。
- manifest `1.8.0` 的 `p1-dynamic-workflow` case 已引用两份新增 runtime 测试；`--contract-only` 现回读
  **14 cases / 58 referenced test files**，并继续明确 runtime evidence 与 release readiness 未被评估。任务文件 ESLint 为 0 errors，
  仅保留 `cowork.js` 既有 `DEFAULT_PERSPECTIVES` unused warning 与仓库根既有 module-type 提示。

### P1-1 仍未关闭的边界

1. **并发 effects、retry/timeout 与外部 provider 幂等：** 当前 durable 路径明确拒绝 `maxParallel>1` 及带 per-step retry/timeout 的
   definition；尚未为同批并发 effects 建立多 pending 原子快照、cancel/settle barrier 与恢复排序，也未把 late timeout settlement 与
   可安全重试的未应用 attempt 分开。`workflowEffectId` 已交给 provider，但真实 LLM/tool/external service 是否持久消费该 idempotency key、
   operator reconcile 是否可由独立 provider receipt 自动证明，仍需生产 adapter 与故障矩阵；人工 result 不能冒充第三方证明。
2. **完整控制与 lineage 产品面：** 尚未实现运行中强制中断当前不可取消 provider、阶段间一般 `needs_input`、restart policy、token/time/cost
   实际 settlement、checkpoint/artifact/side-effect ledger 聚合、双 IDE phase/agent/control UI 及 plugin/marketplace 分发。Local/WSL/SSH/
   Container/Cloud × 三 OS × 双 IDE 的每格 100 次 exact-head 外部合同也尚无证据。

因此，P1-1 的**串行 durable request/settlement、safe-point control、outcome-unknown 禁止重放、显式 reconcile 与 CLI authority**由本节
关闭；P1-1 整项仍为**部分完成**，manifest 中三个完整能力声明仍保持 `false`。总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节也不改变 S0-1～S0-3、Q0、Q3、
Q4a/Q4b、P1-2、P1-4、P1-5 或 P2-4 的状态。

## 三十八、2026-08-18 P1-1 effect-bound provider request identity 与 trace-only receipt 子门复核（`09:10 +08:00`）

本节继续第三十七节，只关闭生产 Cowork 普通模型轮次的 **effect identity 消费、OpenAI request correlation 与回执血缘**；
不把 `X-Client-Request-Id` 外推为 provider 原生幂等键，也不把响应 header/object id 外推为可独立查询的 durable receipt。
候选基于本地主分支 `e870d66f9f28e5bc56ad96248e3c303f3366000c` 的功能分支，尚无本候选 exact-head GitHub Actions。

### 本轮关闭的生产 provider 边界

- **`workflowEffectId` 不再止于 outer runtime 参数。** `runCoworkTask` 在挂载 MCP、构造 child 或调用 provider 前先要求规范
  `sha256:` identity，再把它锁定到 `SubAgentContext`；调用方不能通过 `loopOptions` 替换。`agentLoop` 在任何 provider work 前再次
  校验，并按 `effect id + source + model-turn sequence` 派生稳定的 `ccwf_<sha256>` 请求 identity。相同 effect 的安全 pre-dispatch
  恢复得到同一轮 identity，不同合法模型轮次不会误用同一 key。
- **OpenAI transport 实际消费请求 identity。** 非流式与 SSE Chat Completions 都发送官方记录能力
  [`X-Client-Request-Id`](https://platform.openai.com/docs/api-reference/debugging-requests)，并拒绝控制字符、非 printable ASCII 与
  512 字符以上输入。只有 `https://api.openai.com` 官方 origin 获得该 contract；即使配置名为 `openai`，custom gateway 也不会被
  冒充为官方 receipt provider。普通流式调用的物理 retry 使用独立 suffix；workflow-bound 调用则禁用透明 stream retry 与跨
  provider runnable fallback，避免一个 durable model boundary 隐藏第二次物理 provider attempt。
- **只有 provider 返回的标识才形成 receipt。** OpenAI 返回 `x-request-id` 或 completion object id 后，runtime 才产生
  `cc-provider-request-receipt/v1`；仅本地发送了 client id 不计 receipt。receipt 只接受有界标识、普通 enumerable data fields，
  Proxy/accessor、effect/client-id 漂移、空 provider id、伪称 `idempotent` 或 `independentlyReadable=true` 都 fail closed。协议固定声明
  `requestIdentitySemantics=trace-only` 与 `independentlyReadable=false`。
- **provider 未知 outcome 不再降级成 retryable task failure。** workflow-bound child 的 transport/provider/receipt 验证异常会穿过
  `SubAgentContext` 和 `runCoworkTask` 抛回 durable runtime；outer effect 保持 pending 并要求 reconcile。普通非 durable Cowork 仍保留
  原有“返回 failed entry”的兼容行为。
- **receipt 进入 durable result digest 与 observability lineage。** Cowork entry 返回 exact effect binding 和有界 receipts；settlement
  result digest 因而覆盖这些字段。`cc-dynamic-workflow-observability/v1` 新增 `providerReceipts` 投影，逐条绑定 effect/call sequence/
  client id/provider ids，并固定 `nativeIdempotencyProven=false`、`independentlyReadable=false`。缺失、无效或截断 receipt 形成显式 gap，
  不会被 operator reconcile 或 task result 内容冒充为第三方证明。

### 仓库内验证与证据边界

- provider HTTP、agent loop、SubAgent、Cowork runner 与 durable projection 五个聚焦文件终态为 **234/234**；覆盖非流式/SSE header、
  provider header/object receipt、稳定 per-turn identity、header injection、无透明 stream retry、异常向 outer unknown 传播、receipt
  保存，以及 effect mismatch/idempotency overclaim 拒绝。
- agent stream/retry 四文件为 **62/62**；P1-1 draft/runtime/facade/DAG/WS/command 八文件为 **214/214**。
- roadmap verifier 与 journey evidence 两文件为 **37/37**；manifest 从 `1.9.4` 升到 `1.9.5`，fixture digest 为
  `sha256:3b0d74e7685618a18b5abaaeac1a3eb1b5cf9204117296b3cc400926d0fcea19`。`--contract-only` 回读
  **15 cases / 66 referenced test files**，并继续明确 runtime evidence 与 release readiness 未被评估。

### P1-1 仍未关闭的边界

1. **原生幂等与独立 receipt readback：** OpenAI `X-Client-Request-Id` 是 correlation/debug identity，不是 exactly-once key；当前也没有
   provider API 自动回读 `x-request-id` 的独立裁决。Anthropic、Ollama、DeepSeek、DashScope、Mistral、Gemini 与 Volcengine 尚未取得
   等价生产 contract。任何 provider 没有返回标识时，observability 会诚实显示 receipt incomplete。
2. **outer task 之外的 provider/effect：** semantic compaction 的模型调用，以及 nested tool/MCP/external-system side effects 尚未统一绑定
   本 receipt；ArtifactStore/checkpoint immutable readback、真实 provider token/USD usage 与物理取消也仍未完成。
3. **完整产品与外部矩阵：** 一般阶段间 `needs_input`、Workbench/VS Code/JetBrains phase/agent/control UI、plugin/marketplace 分发，
   以及 Local/WSL/SSH/Container/Cloud × 三 OS × 双 IDE 每格 100 次 exact-head 真实 provider/故障矩阵仍未关闭。

因此，P1-1 的**生产 Cowork effect identity 消费、OpenAI trace correlation、provider-returned receipt 血缘及 unknown-outcome 不降级**
由本节关闭；P1-1 整项仍为**部分完成**，不得据此声明 provider-native exactly-once 或 independently-readable receipt。总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节也不改变 S0-1～S0-3、Q0、Q3、
Q4a/Q4b、P1-2、P1-4、P1-5 或 P2-4 的状态。

## 三十七、2026-08-18 P1-1 retry/timeout dispatch authority 与晚到结算子门复核（`07:28 +08:00`）

本节继续第三十六节，但不把 runtime 自有 dispatch marker 外推为第三方 provider receipt，也不宣称跨进程网络调用获得全局
exactly-once。候选位于已合并本地主分支 `ca638db6152f5ff10bd9cc1bb012694de6d3ee84` 之上的功能分支，尚无本候选 exact-head
GitHub Actions。本节关闭的是仓库内**attempt-scoped retry、timeout 前未 dispatch、timeout 后晚到成功和晚到未知 outcome 的可区分恢复**子门。

### 本轮关闭的 dispatch 与 timeout settlement authority

- **request 与 provider dispatch 成为两个持久事实。** effect batch 仍先原子写入 pending；每条 effect 在实际调用 provider 前再写
  `providerDispatchedAt`。进程在 request 后、dispatch marker 前崩溃时，operator 可通过精确 runtime revision 恢复，同一 effect 可安全
  继续而不要求伪造 reconcile；marker 已存在的 pending effect 则一律视为 outcome unknown。marker 写入后、函数调用前仍有一个保守的
  模糊窗口，该窗口选择阻断而不是自动重放。
- **每个 retry attempt 拥有独立 effect identity。** provider 明确返回 `failed` 时，attempt 先以 `provider-return` settlement 持久化，
  Cowork 才按 definition-bound retry policy 进入下一 attempt；恢复时已 settled attempt 直接使用缓存结果。provider throw、response loss 或
  settlement failure 不会被当成 retryable failure，而是保持 pending/blocked，禁止下一 attempt 越过未知副作用。
- **timeout 在 dispatch 前后采用不同 authority。** timeout 在 provider dispatch 前发生时，runtime 写入
  `runtime-not-dispatched` failed settlement、`timeoutObservedAt` 与 `providerDispatched=false`，不调用 provider，并可安全进入下一 attempt。
  dispatch 后 timeout 会先持久化 observation，再等待物理 task 结束：晚到 `completed` 是最终 authoritative result，不再重试；晚到明确
  `failed` 可进入下一 attempt；晚到 throw/未知结果传播 reconciliation-required，不能被 timeout wrapper 吞掉。
- **调度器不再丢弃晚到结算。** admitted Cowork timeout 在 abort 后继续等待 task promise；晚到 completed entry 直接结束该 step，晚到
  failed entry 保留为本 attempt 结果，晚到 runtime control 或 invalid-result signal 原样上抛。并发 permit 继续由物理 promise 持有到真实
  settlement，重试不会绕过 `maxParallel`。
- **状态校验与观测投影绑定新事实。** runtime verifier 校验 request/dispatch/timeout/settlement 时间顺序、未 dispatch settlement 的精确
  failed reason，以及 provider-return/reconcile 必须已有 dispatch marker；status/observability 投影新增 timeout、dispatch 与
  `runtimeNotDispatched` 计数。旧 runtime state 缺少新字段时保持可读，但其 pending effect 按可能已 dispatch 处理，不获得安全重放特权。

### 仓库内验证与证据边界

- durable runtime 单文件为 **17/17**，其中新增覆盖：明确 failed 后 attempt 2、request 后 dispatch 前崩溃恢复、timeout 后 provider 晚到
  success 且调用次数保持 1、timeout-before-dispatch 不调用 provider 并安全进入下一 attempt，以及 timeout 后未知 outcome 保持 blocked
  且不重试。Cowork DAG 与 runtime 合并聚焦为 **111/111**。
- draft/review、durable runtime、facade、Cowork DAG、WebSocket、run admission 与两组 command integration 共八个聚焦文件为
  **213/213**。roadmap verifier 与 journey evidence 两文件为 **37/37**；`--contract-only` 回读
  manifest `1.9.4` 的 **15 cases / 63 referenced test files**，并继续明确 runtime evidence 和 release readiness 未被评估。
- `p1-dynamic-workflow` fixture 新增 request-before-dispatch crash、pre-dispatch timeout、late provider success 与 late unknown outcome
  故障注入；expected outcome 要求 provider-after-pre-dispatch-timeout、late-success duplicate retry、unknown-timeout retry 和
  undispatched reconcile 均为 0。manifest 同时要求 provider-dispatch 与 timeout-settlement ledger。

### P1-1 仍未关闭的边界

1. **第三方幂等、receipt 与物理取消：** provider 尚未强制消费 effect/batch idempotency key，也没有返回可独立回读的 durable receipt；
   dispatch marker 后、真实调用前的 crash 只能保守阻断。pause/stop/timeout 的 AbortSignal 也不能强制终止不合作的进程、网络请求或外部系统。
2. **完整阶段与制品语义：** 一般阶段间 `needs_input`、持久 restart policy/backoff schedule、真实 token/USD usage、checkpoint restore、
   ArtifactStore immutable bytes readback 与嵌套 tool/MCP/external-system side-effect ledger 仍未接线。
3. **产品消费与外部矩阵：** Workbench/VS Code/JetBrains 的 phase/agent/control UI、plugin/marketplace 分发，以及
   Local/WSL/SSH/Container/Cloud × 三 OS × 双 IDE 每格 100 次 exact-head 真实 provider/宿主故障矩阵均尚未关闭。

因此，P1-1 的**attempt-scoped retry、provider dispatch authority、pre-dispatch timeout 安全重试、late-success 去重与 late-unknown 阻断**
由本节关闭；P1-1 整项仍为**部分完成**，runtime ledger 不能替代第三方 idempotency/receipt。总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节也不改变 S0-1～S0-3、Q0、Q3、
Q4a/Q4b、P1-2、P1-4、P1-5 或 P2-4 的状态。

## 三十三、2026-08-18 P1-2 固定命令目标 attestation 与预置 session resume 子门复核（`04:33 +08:00`）

本节开始推进第三十二节仍保留的 P1-2，但不把 transport mock 外推为真实 WSL/SSH/Container 宿主已运行，也不把“目标已有 session
副本”改写成 launcher 已完成副本传输。候选仍位于 `58cbc7a316` 之上的未提交工作树，尚无 exact-head GitHub Actions。本节关闭的是
仓库内**source handoff authority → secret-free target profile → 固定目标探针 → stable target facts → exact canonical session replica →
交互式 resume**的串联核心；Cloud、复制、重连和返回路径仍在外部边界。

### 本轮关闭的 target launch/resume 子门

- **target profile 是严格 authority，不是任意 shell 配置。** 新 `cc-execution-location-profile/v1` 只接受 exact schema，绑定 profile id、
  target/evidence id、固定 CLI 路径、cwd、transport、预期 platform/arch/CLI version/Git commit/tools 以及可选 session-store authority；profile
  必须是有界、普通、单硬链接、严格 UTF-8 JSON，并经 `lstat → O_NOFOLLOW open → fstat → descriptor read → fstat` 读取。未知字段、
  secret-shaped 内容、路径/handle 漂移、hardlink 或 profile digest 漂移均 fail closed。
- **launcher 只允许固定 ChainlessChain argv。** WSL 使用 `wsl.exe --distribution ... --cd ... --exec <cli>`，Container 使用
  `docker exec --workdir ... <container> <cli>`，SSH 仅拼装经单字段验证和 POSIX quoting 的 `session location current/show` 与
  `session resume`；所有本地 process 调用均 `shell=false`。profile 不能注入任意额外 CLI 参数或用以 `-` 开头的 target/options。
- **SSH 不复用旧 backend 的 host-key 绕过。** 新路径强制 `BatchMode=yes`、`StrictHostKeyChecking=yes`、零密码提示及显式
  `UserKnownHostsFile`。launcher 先以安全 descriptor 读取并核验 profile 声明的 known-hosts SHA-256，再把读到的 exact bytes fsync 到
  私有临时 authority 文件，让 OpenSSH 使用该文件，并在同步调用结束后删除；因此 profile 校验后替换原 known-hosts 路径不能改变本次
  host identity。identity file 只作为路径引用，credential 是否可用仍明确未 attested。
- **目标观测同时绑定位置、代码和源码事实。** `session location current --json` 的 binding 新增 CLI version；target attestation 要求
  observed location、cwd、Git commit、platform、arch、CLI version 与 required tools 全部匹配 profile 和 handoff，并输出
  `cc-execution-location-target-attestation/v1`。带时间的 attestation digest 保留每次探针身份；另一个排除 `observedAt` 的 stable
  `targetFactsDigest` 供人接受后在 resume 前重新探针比较，既不会因正常时间变化永远失配，也不能容忍目标事实漂移。
- **resume 必须先证明目标已有 exact canonical session。** `session location resume` 要求 accepted stable facts digest，再在目标调用
  `session location show <id> --json`；返回的 `sessionId + headHash + eventCount` 必须同时与 profile session-store authority 和本次 source
  handoff authority 精确一致，随后才以固定 argv 启动交互式 `session resume <id>`。返回 receipt 明确标出 `target-process-lifetime`、
  launcher 未执行 session-store transfer、disconnect/reconnect 尚不 durable，不把同步进程退出冒充后台连续性。
- **catalog 与命令面同步。** WSL 不再错误标为 `not-implemented`，而与 SSH/Container 一样标为 `requires-configuration`；CLI 新增
  `session location attest|resume`，README、command manifest、help index 与四种 shell completion 已重生并通过 freshness check。

### 仓库内验证与证据边界

- target launcher、location contract、session projection 与 Commander route 四文件为 **20/20**；覆盖固定 Docker/WSL/SSH argv、时间变化下
  stable facts、严格 known-hosts 物化/清理与 pin drift、location/cwd/commit/version/tool drift、stale facts、缺失/错版 canonical session、
  secret/schema/hardlink profile 拒绝以及生产命令参数转发。
- `node ... session location current --json` 在当前 Windows 工作树真实回读 `location=local`、`platform=win32`、`arch=x64`、CLI
  `0.165.1`、Node `v22.22.2` 与 exact Git commit `58cbc7a3163984765ad4a6db8fdd8f57c50af34b`；这只证明本地 current probe，不是远端
  WSL/SSH/Container 成功证据。本轮没有连接任何真实远端宿主，也没有执行真实 session resume。
- roadmap manifest 从 `1.8.0` 升至 `1.9.0`，新增 `p1-execution-location`（fixture SHA-256
  `0eedba6e0051b2a63ca92447a92846d43099c87c065e96e804bbedbab36ce2ed`）。verifier/journey 仍为 **37/37**；`--contract-only` 回读
  **15 cases / 62 referenced test files**，并继续明确 runtime evidence 与 release readiness 未被评估。合同要求 CLI/VS Code/JetBrains ×
  三 OS × WSL/SSH/Container/Cloud 每格 100 次、八小时连续运行与完整故障/返回路径证据；仓库内 20 项测试不替代这些结果。

### P1-2 仍未关闭的边界

1. **传输、生命周期与返回路径：** launcher 只消费预先存在的 canonical session store，不负责安全复制/增量同步、双写 fencing、冲突
   合并或删除；同步 SSH/WSL/docker exec 退出后没有 detach/reattach、断网重连、sleep/reboot 恢复、orphan 清理或八小时资源轨迹。
   commit/diff/summary/artifact/evidence 的目标侧生成、回传、摘要复核和 source-side 应用也尚未接入本 receipt。
2. **Cloud、策略 attestation 与产品入口：** 现有 `cc cloud` bundle/job/reflow 仍未与 session location authority 合并；target network、sandbox、
   credential availability 仍是 operator handoff facts，不能由 ambient probe 远程证明。双 IDE/Desktop 创建与控制面、真实 WSL/SSH/Container/
   Cloud、多架构、网络故障和 100-run exact-head 矩阵均未完成。

因此，P1-2 的**固定命令 target attestation、严格 SSH host identity、CLI/Git/host facts 绑定及预置 canonical session resume authority**
由本节关闭；P1-2 整项仍为**部分完成**。总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节也不改变 S0-1～S0-3、Q0、Q3、
Q4a/Q4b、P1-1、P1-4、P1-5 或 P2-4 的状态。

## 三十四、2026-08-18 P1-2 exact session replica transfer 子门复核（`04:51 +08:00`）

本节继续第三十三节，并明确替代其中“launcher 未执行 session-store transfer”的旧边界；但不把仓库内 pipe/mock 与临时目录测试外推为真实
WSL/SSH/Container 已完成传输或 resume。候选仍位于 `58cbc7a316` 之上的未提交工作树，没有 exact-head GitHub Actions。本节关闭的是
**source verified transcript bytes → 固定目标端 receive → exact digest/head/count/structure 校验 → 原子发布与目标本机锚点 → canonical readback → resume**
子门；增量/双向同步、断线重连、结果返回、Cloud 与外部矩阵仍未关闭。

### 本轮关闭的 replica transfer authority

- **源端只能传输锁内已验证的 canonical bytes。** `session location resume` 在 `replicated` profile 下调用
  `readVerifiedTranscriptBytes`，因此来源必须先通过完整 hash chain、sidecar physical witness 与独立 machine-local anti-rollback anchor；传输材料再绑定
  source handoff 的 exact `sessionId + headHash + eventCount` 及原始 transcript bytes SHA-256。`shared` profile 不复制，只保留后续目标权威回读。
- **目标端只接受固定、有界的 stdin 协议。** launcher 调用固定 `session location receive <id>` argv；Container 仅为该 stdin 路径增加 `docker exec -i`，
  WSL/SSH 继续使用 `shell=false` 的固定 transport。目标同步读取最多 64 MiB，要求 strict UTF-8 JSONL，并在任何 canonical 写入前校验 byte digest、完整
  transcript hash chain、结构约束、exact head hash 与 event count；profile 或任意 transport 字段仍不能注入额外命令。
- **安装只允许空目标或 exact 幂等重试。** 新 `installSessionReplica` 在 session host writer lock 下处理同目录 private pending 文件，先 fsync、验证，再 atomic rename；
  随后 flush 发布边界、重建 sidecar/activity projection，并创建目标机器自己的 anti-rollback witness。不同 canonical 内容、墓碑、missing-transcript/conflict、
  hardlink/symlink pending、digest/head/count 漂移均 fail closed，永不覆盖目标已有 authority。进程若在 rename 后、目标锚点前崩溃，重试只会在 exact bytes
  再验证通过后补齐本机锚点，并返回 `installed=false` 的幂等 receipt。
- **resume 消费可复核的安装 receipt，而不是相信传输退出码。** `chainlesschain.session-replica-install/v1` receipt 绑定 session、head、event count、
  transcript digest、是否首次安装及自身 digest；source launcher 校验 exact schema 与 receipt digest，随后仍在目标执行 `session location show --json`，只有目标
  canonical authority 同 profile 与 handoff 同时一致，并重新读取源 session authority 确认其在传输期间未前进，才启动交互式 `session resume`。最终 resume
  receipt 记录 source revalidation 与 transfer mode/receipt，但连续性仍诚实限制为 `target-process-lifetime`，且明确列出没有 durable cross-host writer fence。
- **命令面与机器合同同步。** README 已区分 replicated whole-revision transfer 与 shared store，command manifest、help index 和四种 shell completion 已重生并通过
  freshness check。roadmap manifest 从 `1.9.0` 升至 `1.9.1`，`p1-execution-location` fixture digest 更新为
  `9835e353b4faab1e654d7979d9ce3af035be2b8bc3fd72afbbd2f3057d785063`，合同新增 source byte digest、target install receipt、divergent replacement=0、
  partial publication=0 以及 publish-before-anchor crash journey。

### 仓库内验证与证据边界

- replica 安装、target launcher、location contract、session projection 与 Commander route 五文件为 **26/26**；其中 replica 专项 **4/4** 覆盖 exact 首装、幂等
  retry、byte/head/count 漂移拒绝、不同目标不覆盖，以及 Windows/POSIX 共用的 atomic publish 后、local anchor 前崩溃恢复。launcher 测试同时证明固定
  Docker `-i` argv、stdin bytes、receipt digest、目标 canonical readback、源 head advance 阻断和最终交互式 resume 的顺序。
- session-store、index 与 anti-rollback 三个既有核心文件回归为 **172 passed / 4 skipped**；这覆盖原有 append、projection、fork、repair、索引与本机
  防回滚路径，证明新增 import boundary 没有把既有 canonical readers/writers 改成未锚定读取。skip 保留其原有平台/环境条件，不计作通过。
- roadmap verifier/journey 两文件为 **37/37**，lazy-dispatch/help-index 为 **22/22**；`--contract-only` 回读 manifest `1.9.1` 的
  **15 cases / 63 referenced test files**，并继续明确 runtime evidence 与 release readiness 未被评估。任务文件 ESLint 为 0 errors；仓库根既有 module-type warning
  仍不属于发布证据。
- 本轮没有连接真实 WSL、SSH、Container 或 Cloud，没有向远端发送任何 session 内容，也没有执行真实目标端 resume。因此 26 项仓库测试只证明实现与拒绝语义，
  不证明 transport、credential、网络、宿主资源或真实数据边界已满足发布合同。

### P1-2 仍未关闭的边界

1. **生命周期、同步与返回路径：** 当前只传输一个锁定的 whole revision，并在 launch 前二次读取源 head，但该检查不是跨宿主持久 writer fence；尚无
   source/target 双写 fencing、增量或双向同步、分歧合并/删除传播、detach/reattach、
   断网重连、sleep/reboot 恢复、orphan 清理与八小时资源轨迹。目标侧产生的 commit/diff/summary/artifact/evidence 仍未进入 digest-bound 回传、source readback 与应用流程。
2. **Cloud、策略 attestation 与产品入口：** `cc cloud` bundle/job/reflow 仍未与本 target authority 合并；target network、sandbox 与 credential availability
   仍未由远端证明。双 IDE/Desktop 控制面、真实 WSL/SSH/Container/Cloud、多架构、网络故障与每格 100 次 exact-head 矩阵均没有外部证据。

因此，P1-2 的**exact whole-revision replica transfer、目标原子安装/本机防回滚锚定、幂等 crash recovery、receipt 与 canonical readback 后 resume**由本节关闭；
P1-2 整项仍为**部分完成**。总计数保持 **12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节也不改变
S0-1～S0-3、Q0、Q3、Q4a/Q4b、P1-1、P1-4、P1-5 或 P2-4 的状态。

## 三十五、2026-08-18 P1-2 canonical location-handoff successor 子门复核（`05:34 +08:00`）

本节继续第三十四节，并明确替代其中“复制后的 transcript 仍保留原始 `session_start` location，尚未追加 canonical location-handoff event”的旧边界。
候选仍位于 `58cbc7a316` 之上的未提交工作树，没有 exact-head GitHub Actions，也没有真实远端宿主运行证据。本节关闭的是仓库内
**exact source replica → target ambient re-attestation → predecessor-head CAS → canonical location-handoff successor → exact successor readback → resume**
子门；它不关闭跨宿主写者围栏、shared-store handoff、重连或返回路径。

### 本轮关闭的 canonical successor authority

- **replicated prepare 以 canonical 事件改变当前执行位置。** launcher 不再只调用裸 `session location receive`，而是调用固定、有界的
  `session location prepare <id>`，同时传入 source head/count/transcript digest、accepted stable target facts、profile digest、target evidence id 与
  本次 attestation digest。目标先按原有原子协议安装 exact replica，再以 source head 为 CAS predecessor 追加
  `execution_location_handoff`；事件把 exact source authority、目标 binding、profile/evidence、stable target facts 与 attestation authority 绑定为一个
  `handoffId`，目标 head/count 因此成为 source revision 的唯一一事件 successor。
- **target attestation 不能再靠任意 digest 自证。** source launcher 与 target session store 共享同一个
  `cc-execution-location-target-attestation/v1` canonical material builder。目标 store 在任何 handoff append 前，用事件携带的 binding、source
  head/count、profile/evidence 与 exact Git commit 独立重算 stable facts 和 attestation digest；facts drift、任意 attestation digest、schema 漂移或
  predecessor 不一致均在 canonical 写入前 fail closed。`observedAt` 仍进入 attestation digest，但排除在 stable handoff identity 外，因此正常重试可接受新的
  观测时间，同时只能返回首次 canonical 事件保存的 attestation authority。
- **位置投影现在追踪最新 canonical binding。** `getVerifiedSessionExecutionLocationAuthority` 从完整已锚定 transcript 折叠最新
  `execution_location_handoff`，返回 `verified-session-location-handoff`、binding event hash/count 与完整 handoff projection；后续普通消息不会把位置退回
  `session_start`。复制目标的 `session location show --json` 必须精确证明 successor head/count、handoff id、source transcript digest 及目标
  profile/evidence/facts/attestation，launcher 才会继续。
- **response loss 只允许精确的一事件幂等恢复。** 若 append 已 durable 但响应丢失，重试仅在当前 target head 仍是同一 handoff 的
  `sourceEventCount + 1` successor 时返回 `replicaInstalled=false`、`handoffAppended=false` 的原 authority receipt；不同 handoff、篡改 target facts、
  篡改 attestation 或 handoff 后 target session 已继续前进均拒绝，避免同一 source 请求触发第二次交互式 resume。
- **工作流入口不会丢弃迁移后的权威类型。** Dynamic Workflow facade、Cowork admission validator、Commander 与 WebSocket projection 均显式接受并保留
  `verified-session-start` 或 `verified-session-location-handoff`；CLI/WS 写入的 run admission 保持 exact authority，而不是把移动后的 session 降回初始位置。
  source launcher 在 target successor 安装和 readback 后仍再次读取 source authority，只有 source head/count 未前进才启动固定 argv 的交互式 resume。
- **shared 模式没有被伪装成已完成。** shared store 仍要求原始 `verified-session-start` exact authority，receipt 继续列出
  `shared-session-location-handoff-event-not-anchored`；replicated 与 shared 的语义不会通过同一个成功标志混淆。

### 仓库内验证与证据边界

- location contract、session projection、target launcher、replica 与 Commander route 五文件为 **32/32**；replica 专项为 **9/9**，新增覆盖 canonical
  successor、观测时间变化下的幂等 retry、append 后响应丢失、target 前进后拒绝重复 resume、target-facts 篡改与 attestation-digest 篡改。
- Dynamic Workflow draft/runtime/facade、Cowork DAG/WebSocket/run admission 与两组 command integration 八文件为 **205/205**；其中新增三项分别证明
  facade、CLI 与 WS admission 保留 `verified-session-location-handoff`。session-store、index 与 anti-rollback 三个核心文件回归无失败，为
  **170 passed / 6 skipped**；skip 是当前平台条件分支，不计作通过。
- roadmap verifier/journey 两文件为 **37/37**，lazy dispatch 为 **22/22**；command manifest、help index 与四种 shell completion freshness check 均通过。
  manifest 为 `1.9.2`，`p1-execution-location` fixture SHA-256 为
  `7196ce278bf5155a345f8f4ee3f91b77c0197822d70c32f809038be3a0d1e709`；`--contract-only` 回读 **15 cases / 63 referenced test files**，并明确
  runtime evidence 与 release readiness 未被评估。任务文件 ESLint 为 0 errors；两个既有 unused warning 与仓库根 module-type warning 不计作发布证据。
- 本轮没有连接真实 WSL、SSH、Container 或 Cloud，没有向远端发送 session 内容，也没有执行真实目标端 resume；上述测试只证明仓库实现、canonical
  authority 和拒绝语义，不证明 transport、网络、credential、宿主生命周期或真实数据边界已经满足发布合同。

### P1-2 仍未关闭的边界

1. **跨宿主写者围栏与 shared authority：** source 在 target resume 前虽再次校验 head，但仍没有把 source writer generation durable revoke/lease handoff
   到另一宿主；readback 与交互式 resume 之间也没有分布式 fence。shared store 尚无 canonical location-handoff event，网络文件系统的 lease、并发与故障语义
   未验证，因此 source/target 双写、重复 continuation 与 split-brain 退出条件尚未关闭。
2. **同步、生命周期与返回路径：** 仍只有 whole-revision 单向复制，没有增量/双向同步、分歧合并、删除传播、return handoff、detach/reattach、断网重连、
   sleep/reboot 恢复、orphan 清理、八小时资源轨迹，目标侧 commit/diff/summary/artifact/evidence 也未进入 digest-bound 回传与 source readback/apply。
3. **Cloud、策略、产品入口与外部矩阵：** `cc cloud` 尚未合并本 authority；target network/sandbox/credential availability 未被远端证明；Desktop、VS Code、
   JetBrains 控制面与真实 WSL/SSH/Container/Cloud、多架构、网络故障、每格 100 次 exact-head 矩阵仍无关闭证据。

因此，P1-2 的**replicated canonical location-handoff successor、目标 attestation 独立重算、响应丢失幂等恢复、前进后重复 resume 阻断及工作流 authority
互操作**由本节关闭；P1-2 整项仍为**部分完成**。总计数保持 **12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为
**NO-GO**。本节也不改变 S0-1～S0-3、Q0、Q3、Q4a/Q4b、P1-1、P1-4、P1-5 或 P2-4 的状态。

## 三十二、2026-08-18 P1-1 settlement observability 与 digest-only lineage 子门复核（`04:18 +08:00`）

本节继续第三十一节，但不把 Cowork 的本地预算估算改名为 provider 真实用量，也不把 task result 中未经外部回读的对象改名为已发布
artifact 或 checkpoint。候选仍位于 `58cbc7a316` 之上的未提交工作树，尚无 exact-head GitHub Actions。本节关闭的是仓库内
**settled effect 的可验证身份、结果摘要、结算来源、墙钟耗时与 digest-only artifact/checkpoint 聚合**子门；它不关闭真实 provider
usage/cost、artifact store readback、checkpoint provider receipt 或嵌套工具副作用账本。

### 本轮关闭的 settlement 与观测投影子门

- **effect 身份不再只是一条不可解释的 NUL 分隔 key。** 每个持久 effect 现在显式保存 `stepId`、`iteration`、`attempt`、
  `payloadDigest`、`resultDigest` 与 `settlementAuthority`。状态 verifier 会重新计算 key、run-bound effect id 和 settled result digest，校验
  request/settlement 时间顺序，并要求 pending effect 的 result/digest/authority 全部为空；因此只改结果、把人工 reconcile 伪装成 provider
  return，或漂移 step/iteration/attempt 都不能作为有效状态回读。
- **provider 返回与人工 reconcile 在 lineage 中不可混淆。** 正常结算记录 `provider-return`，outcome-unknown 的人工结果记录
  `operator-reconciled`；对应 lineage event 同时绑定 effect id、result digest 和 settlement authority。`runtime-status --json` 只投影这些
  已持久化事实，不根据 task status 猜测外部副作用是否真的发生，也不把人工断言冒充第三方 receipt。
- **观测聚合有明确 authority 和缺口。** 新 `cc-dynamic-workflow-observability/v1` 投影汇总 requested/settled/pending effect、完成/失败 task、
  provider-return/reconcile 数量以及 request-to-settlement 墙钟时间。`tokenCount` 只标为 `cowork-result-heuristic`，因为当前
  `SubAgentContext` 使用约四字符一 token 的预算估算；provider reported tokens 和 USD cost 固定为 `null`，不会用定义中的 estimate 或 0
  冒充实际结算值。
- **artifact/checkpoint 只保存并展示摘要血缘。** task result 中的 `artifacts[]`/`checkpoints[]` 逐项生成 domain-separated digest，投影最多
  每 effect 256 条，并给出总数、截断 effect 数及整体 lineage digest；若对象带规范 SHA-256，只把该 content digest 作为 reported field
  投影，不暴露正文、标题或宿主路径。它的 authority 明确为 `task-result-digest-only`，没有 artifact store/provider 独立回读就保持缺口。
- **不完整性是机器可读输出，而不是文档脚注。** projection 固定 `complete=false`，并列出 provider token、provider cost、checkpoint
  readback、artifact-store readback 与 nested-tool side-effect ledger 五类 gap；缺 token estimate 或 lineage 投影截断还会追加具体 gap。
  人类可读 `runtime-status` 同样显示估算 token、墙钟耗时、artifact/checkpoint 数量和全部 telemetry gap。

### 仓库内验证与证据边界

- durable runtime 纯逻辑/真实文件测试现为 **9/9**，Commander 生产路由为 **4/4**，合计 **13/13**；新增覆盖显式 effect/result
  digest、provider/reconcile authority、估算 token、digest-only artifact/checkpoint lineage、缺口列表以及投影不泄露 artifact 正文。
- draft/review、durable runtime、facade、Cowork DAG、WebSocket、run admission 及两组 command integration 共八个文件为
  **202/202**。本节未改 roadmap manifest 或其引用文件集合；`p1-dynamic-workflow` 仍是 manifest `1.8.0` 中的
  `external-evidence-required` case，而不是仓库内成功记录。

### P1-1 仍未关闭的边界

1. **真实 usage、cost、checkpoint 与 artifact authority：** 当前 token 是本地启发式预算量，不是 provider usage ledger；USD cost 无实际值。
   `checkpoints[]` 与 `artifacts[]` 即使由 task 返回，也只有 result-bound digest，尚未与 checkpoint engine、ArtifactStore immutable bytes、
   provider receipt 或独立读者回读绑定。嵌套 MCP/tool/external-system 调用也没有逐调用汇总到本 effect 投影。
2. **其余 runtime 与产品面仍开放：** 并发 effect、retry/timeout late settlement、运行中强制取消、阶段间一般 `needs_input`、真实 provider
   idempotency/receipt、双 IDE phase/agent/control UI、plugin/marketplace 分发，以及 Local/WSL/SSH/Container/Cloud × 三 OS × 双 IDE
   每格 100 次 exact-head 外部矩阵均尚未关闭。

因此，P1-1 的**result-bound settlement authority、digest-only artifact/checkpoint lineage 与诚实的不完整观测投影**由本节关闭；P1-1
整项仍为**部分完成**，manifest 中三个完整能力声明仍保持 `false`。总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节也不改变 S0-1～S0-3、Q0、Q3、
Q4a/Q4b、P1-2、P1-4、P1-5 或 P2-4 的状态。

## 二十三、2026-08-18 P1-5 legacy provenance 签名迁移子门复核（`01:26 +08:00`）

本节继续第二十二节，不回写此前历史快照。候选仍是 `58cbc7a316` 之上的未提交工作树，尚无 exact-head GitHub Actions。
本节关闭的是仓库内**缺失 `.plugin-source.json` 的旧安装显式签名迁移**；它不把 migration signer 冒充 Marketplace publisher，
不覆盖已有 provenance，也不放宽外部 registry、组织 trust root 或物理断电门。

### 本轮关闭的 legacy metadata migration

- **plan 与 apply 分离，签名对象由已安装字节确定。** `plugin provenance-plan` 只接受一个已安装 name/version/scope 和有界
  source metadata，输出规范化 authority、`signingPayloadBase64` 与 SHA-256。authority 绑定插件身份、scope、规范化安装路径摘要、
  canonical payload SBOM digest/fileCount/totalBytes、source metadata 和 canonical UTC issuance time；计划后任一 payload、路径、scope
  或 source 变化都会使 apply 失败。
- **apply 需要显式人类批准和精确 signer pin。** `plugin provenance-migrate` 要求单链接普通 attestation 文件、`--yes` 和
  `--expected-signer-sha256`；只接受 Ed25519 SPKI 公钥，并重新计算 fingerprint、验证 canonical authority 的 detached signature。
  若 managed policy 配置 `trustedPluginKeySha256`，migration signer 还必须属于该集合。无效类型、非规范 base64、错误 key、签名
  篡改和 signer mismatch 均 fail closed。
- **迁移只补缺失记录，不改写既有 authority。** plan/apply 发现 `.plugin-source.json` 已存在即拒绝，包括无效或攻击者构造的
  旧记录；此类情况必须 remove/reinstall 或外部人工裁决。带 component-SBOM 的现有 signature lock 也拒绝原位 backfill，避免新增
  metadata 破坏其历史文件集承诺。迁移记录明确标为 migration authority，不声称 publisher identity、catalog selection 或远端
  artifact evidence。
- **签名记录在每次 strict read 重验。** 新 record 保留完整 signed authority、公钥、签名、authority digest 与 signer
  fingerprint；读取时重新检查普通文件/单链接/大小上限、manifest identity、安装路径、当前 payload、source metadata、时间格式、
  Ed25519 签名及 managed trust。删除、hardlink/symlink、payload 漂移、record/source/signature 篡改不会退化为普通 legacy metadata。
- **写盘复用全局 durable lifecycle。** 新 `provenance-migration` kind 经过 `provenance-prepared`、`provenance-committing`、
  `provenance-published` 与 finalize/rollback；journal 在写文件前保留 predecessor/intended bytes 与 generation。全局 same-name fence
  阻断所有 scope runtime/第二写者，owner 死亡后 `plugin recover` 可在 exact CAS 下 finalize 或 rollback，普通 mutation 不偷锁。

### 仓库内验证与证据边界

- 全部 23 个 `plugin-runtime-*` 文件终态为 **425 passed / 3 skipped**；真实 child-process 文件为 **21/21**，新增 provenance
  commit 前死亡后 finalize、文件发布后 journal 前死亡再 rollback 两个真实进程用例。
- install 主文件为 **104/104**，覆盖成功 backfill、既有 metadata 拒绝、payload drift、wrong signer、stored signature tamper、
  component-SBOM 历史锁拒绝与 hardlink authority 拒绝；
  lifecycle CLI 文件为 **9/9**，覆盖 plan 输出、外部 Ed25519 签名、exact fingerprint 与 `--yes` apply。
- remote-artifact、capability notice、install audit、artifact readback、impact 与 lifecycle command 六文件为
  **99 passed / 1 skipped**；完整 loopback remote-artifact 文件仍为 **34/34**。任务文件 ESLint 通过，只有仓库既有的
  `MODULE_TYPELESS_PACKAGE_JSON` 运行时提示。

### P1-5 仍未关闭的边界

1. **物理断电、平台目录持久化与多主机：** Windows 目录句柄 flush、突然掉电/硬重启、网络或共享文件系统 lease/fencing、
   文件系统/杀毒软件差异及长期矩阵仍无正式证据；本节只证明同一 OS 用户、本地文件系统与真实进程终止。
2. **外部 Marketplace 产品化：** 真实 private registry TLS/auth、publisher/组织 trust root、key revocation、代理/PAC/
   custom CA、air-gapped/offline/cache、依赖冲突、供应链故障及干净外部宿主长期矩阵仍未完成。migration signer 只证明一次
   受审 backfill，不能替代 publisher 或组织发布 authority。

因此，第二十二节保留的 **legacy metadata migration** 由本节关闭；P1-5 整项仍为**部分完成**。总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节不关闭任何外部发布门，
也不改变 P2-4 与其他 11 个剩余路线项的状态。

## 二十二、2026-08-18 P1-5 非 install 生命周期崩溃恢复子门复核（`01:12 +08:00`）

本节继续第二十一节，不回写此前历史快照。候选仍是 `58cbc7a316` 之上的未提交工作树，尚无 exact-head GitHub Actions；
因此本节只关闭仓库内的 **enable/disable/version-uninstall/whole-name-uninstall 逐阶段进程崩溃恢复子门**，不把本地
`fsync`、原子 rename 与真实进程 kill 结果外推为物理断电、多主机共享盘或正式发布证据。

### 本轮关闭的非 install crash protocol

- **enable/disable marker 成为可恢复 authority。** mutation 在触碰 `.disabled` 前先持久化 predecessor 与 intended bytes、
  file generation 和目标 enabled 状态，再经过 `marker-prepared`、`marker-committing`、`marker-published`、finalize/rollback
  阶段。marker 必须是单链接、大小有界的普通文件；symlink、hardlink、超限或事务外 generation 变化均 fail closed。
  原子替换或 durable unlink 后、journal 发布前发生崩溃时，恢复器会根据 exact predecessor/intended 内容收养该窗口，且只允许
  operator 显式选择 finalize 或 rollback。
- **版本卸载先隔离 immutable bytes，再发布 fallback。** journal 在创建 `.uninstall-<token>` 前记录被删版本的
  payload/source/generation、原 active pointer、目标 fallback pointer，以及 disabled marker 的前后状态。版本目录通过同卷 rename
  隔离；active pointer 和最终版本删除所需的 marker 依次 durable 发布。任何阶段死亡后，rollback 会恢复精确版本、pointer 与
  marker，finalize 则验证已发布状态后把隔离区退役为 inert cleanup；最终一个 disabled 版本不会留下空 name-dir 或 marker。
- **整名卸载以名称目录原子隔离划分逻辑删除和物理回收。** 完整 name-dir 的 generation 与规范化 payload tree digest 先写入
  journal，再把整个目录 rename 到同 scope 根的 `.uninstall-<encoded-name>-<token>`。全局 coordinator 位于目录之外，故 rename
  后仍持续阻断全部 scope 的运行时与第二写者。rollback 只在隔离树仍与快照一致时原子还原；finalize 进入不可逆清理阶段后不再
  允许回滚，清理中断可按 journal 重试而不会把低 scope fallback 误报为未经审阅的正常加载。
- **统一恢复入口按持久 kind 分派。** `plugin transaction` 继续只暴露脱敏 owner/revision/digest；`plugin recover --action
finalize|rollback` 在 claim 死 owner 后，按 `install`、`enabled-state`、`uninstall-version` 或 `uninstall-name` 解析严格路径和
  context。普通 mutation 仍不偷取 stale owner；错误 scope/cwd、歧义拓扑、外部 pointer/marker/bytes 变化与 journal tamper 均在
  磁盘恢复前或下一次 authority publication 前失败。

### 仓库内验证与证据边界

- 按 `packages/cli/vitest.config.js` 运行全部 23 个 `plugin-runtime-*` 文件，终态为 **419 passed / 3 skipped**；其中真实
  child-process 文件为 **19/19**。新增真实进程用例覆盖 marker commit 前 finalize、marker bytes 发布后 rollback、版本隔离后
  rollback、fallback pointer 发布窗口与 finalizing 阶段的 finalize，以及整名目录隔离后的 rollback/finalize。
- install/uninstall 主文件为 **100/100**，覆盖最终 disabled 版本的 marker/name-dir 清理，并继续保持 pointer commit 失败时的
  同进程精确恢复和双失败 retained recovery 行为。
- remote-artifact command、add capability notice、install audit、artifact readback、impact 与 lifecycle command 六文件仍为
  **98 passed / 1 skipped**；完整 loopback remote-artifact 文件仍为 **34/34**。任务文件 ESLint 通过，只有仓库既有的
  `MODULE_TYPELESS_PACKAGE_JSON` 运行时提示。

### P1-5 仍未关闭的边界

1. **物理断电、平台目录持久化与多主机：** Windows 目录句柄 flush、突然掉电/硬重启、网络或共享文件系统 lease/fencing、
   文件系统/杀毒软件差异及长期矩阵仍无正式证据；本节只证明同一 OS 用户、本地文件系统与真实进程终止。
2. **legacy metadata migration：** 缺失或无效 provenance 继续 fail closed；仍无签名、事务化、可审计的旧安装 metadata
   backfill/migration 与固定历史兼容矩阵。
3. **外部 Marketplace 产品化：** 真实 private registry TLS/auth、publisher/组织 trust root、key revocation、代理/PAC/
   custom CA、air-gapped/offline/cache、依赖冲突、供应链故障及干净外部宿主长期矩阵仍未完成。

因此，第二十一节保留的**非 install 生命周期逐阶段 crash protocol**由本节关闭；P1-5 整项仍为**部分完成**。总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节不关闭任何外部发布门，
也不改变 P2-4 与其他 11 个剩余路线项的状态。

## 二十一、2026-08-18 P1-5 跨作用域全局 mutation fence 子门复核（`00:49 +08:00`）

本节继续第二十节，不回写其“同 name/scope”历史快照。候选仍位于 `58cbc7a316` 的未提交工作树之上，尚无 exact-head
GitHub Actions，因此只能作为仓库内候选证据。本节关闭的是**同一 OS 用户下，同名插件跨 user/project/local 的并行
mutation fence**；不把单机本地文件系统结果外推为多主机共享盘或物理断电证明。

### 本轮关闭的跨 scope fence

- **同名插件只使用一个全局 coordinator。** owner/journal 从目标 scope 目录移到用户级
  `plugin-lifecycle-transactions/<encoded-name>` 协调根；install/update/use、enable/disable 与 uninstall 无论目标是 user、
  project 还是 local，都会竞争同一个 fixed lock。不同 scope 不再能在各自锁下同时读取旧 baseline 并分别提交。
- **目标 workspace 被 journal context 绑定。** journal 新增规范化 target-name-dir 的 SHA-256 context digest，并继续将 scope、
  owner、revision 与 transaction state 纳入 canonical journal digest。`plugin transaction/recover` 必须从相同 scope 与项目
  cwd 调用；错误项目即使同名、同 scope 也在 claim 或任何磁盘恢复前以 context mismatch fail closed。
- **运行时也服从全局 fence。** discovery 在 user/project/local 每层解析同名插件时都会检查 coordinator fixed lock；审阅事务
  存续期间不会从另一个 scope 加载旧版或刚发布候选。事务内部的 effective-authority/semantic baseline 检查携带 exact
  owner，可读取全部物理 scope；外部运行时和第二个 CLI 则统一被阻断。
- **失败前尚无目标目录不再制造假恢复债。** source/signature 等验证若在 target name-dir 创建前失败，`ENOENT` 被识别为
  “无 retained bytes”，journal 进入 aborted 并释放全局 owner；Marketplace 集成旅程增加逐测试 coordinator 泄漏断言。
  CLI Vitest setup 使用每 worker 临时 coordinator 根，真实 child fixture 继承同一根，从而既验证跨进程互斥，也不污染用户目录。

### 仓库内验证与证据边界

- 按 `packages/cli/vitest.config.js` 运行全部 23 个 `plugin-runtime-*` 文件，终态为
  **411 passed / 3 skipped**。真实 child-process fixture 增加 project owner 阻断 local mutation、阻断跨 scope runtime、
  wrong-cwd inspection fail closed，以及 owner 死亡后恢复再允许 local 提交；真实进程组为 **12/12**。
- remote-artifact command、add capability notice、install audit、artifact readback、impact 与 lifecycle command 六文件终态仍为
  **98 passed / 1 skipped**；其中完整 loopback remote-artifact 文件为 **34/34**，包含成功、预激活拒绝、升级回滚及逐测试
  全局 owner 泄漏检查。
- 首轮错误地从仓库根绕过 CLI Vitest setup 的调试运行曾在真实 AppData 留下一条测试 owner；确认 owner/journal/路径后已精确
  删除该单一 `durable-process` 测试目录。后续所有正式复跑均使用 CLI 自身配置与隔离 coordinator 根。

### P1-5 仍未关闭的边界

1. **物理断电、平台目录持久化与多主机：** Windows 目录句柄 flush、突然掉电/硬重启、网络/共享文件系统的 lease/fencing、
   文件系统与杀毒软件差异、长期矩阵仍无正式证据；本节全局 coordinator 仅证明同一 OS 用户和本地文件系统。
2. **非 install 生命周期的逐阶段 crash protocol：** enable/disable/uninstall 已受全局单写者与跨 scope preflight 保护，但尚未
   拥有与 install/add/upgrade 相同的逐 phase bytes/pointer journal 与 process-kill 恢复矩阵。
3. **legacy metadata migration：** 缺失或无效 provenance 继续 fail closed；仍无签名、事务化、可审计的旧安装 metadata
   backfill/migration 与固定历史兼容矩阵。
4. **外部 Marketplace 产品化：** 真实 private registry TLS/auth、publisher/组织 trust root、key revocation、代理/PAC/
   custom CA、air-gapped/offline/cache、依赖冲突、供应链故障及干净外部宿主长期矩阵仍未完成。

因此，第二十节保留的**跨 scope 并行 fencing**由本节关闭；P1-5 整项仍为**部分完成**。总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节不关闭任何外部发布门，
也不改变 P2-4 与其他 11 个剩余路线项的状态。

## 三十六、2026-08-18 P1-1 并发 durable effect 原子批次与结算屏障子门复核（`07:05 +08:00`）

本节继续第三十一、三十二节的 durable runtime，但不把仓库内并发调度回归外推为真实 provider 已提供幂等 receipt，也不宣称
retry/timeout、强制取消或完整 P1-1 已关闭。候选位于本地主分支 `f6421a858187c9a14156a7c680db73ccf704dc41` 之上的功能分支，尚无
本候选 exact-head GitHub Actions。本节关闭的是仓库内**同一调度轮次 effect 的原子 request-before-provider、持久顺序恢复和 pause
结算屏障**子门。

### 本轮关闭的并发 durable effect 协议

- **并发 dispatch 先作为一个原子批次持久化。** 同一调度轮次进入 durable provider 的 effect 会先按稳定 key 排序，并在一次状态事务中
  写入全部 pending effect；事务提交后各 provider 才能开始。每条 effect 保留原有 step/iteration/attempt identity，同时新增
  `batchId`、`batchIndex` 与 `batchSize`。batch digest 绑定 runId、稳定顺序、effect key 和 payload digest；状态回读还会校验完整
  cardinality、连续 index、共同 requestedAt 与 hard 64 上限，拒绝部分批次或元数据漂移。
- **显式 bounded parallel 受同一 admission authority 约束。** durable CLI 继续默认 `maxParallel=1`，但显式
  `--max-parallel <n>` 不再被硬编码拒绝；实际并发值必须同时通过 definition budget、digest-bound run admission 和 runtime 1～64
  边界，并原样传给 Cowork executor。retry 或 timeout step 仍在创建 runtime state 前 fail closed，避免把晚到 provider settlement
  误判为从未执行的 attempt。
- **多个未知 outcome 只能按持久顺序显式 reconcile。** 任一 provider/settlement response 未知都会使 run 保持 `blocked`；operator
  只能处理 effect ledger 中最早的 pending effect，越序返回
  `CC_DYNAMIC_WORKFLOW_EFFECT_RECONCILIATION_OUT_OF_ORDER`。处理部分 pending 后状态仍为 `blocked`，只有最后一条完成后才回到
  `ready`；恢复执行直接消费已持久结果，不重放 provider。
- **失败和暂停都等待已请求 provider 物理结算。** 一个并发 provider 先失败时，执行 promise 不会在同批其他 provider 仍运行时提前返回；
  其余成功结果先写为 settled，未知 effect 保留 pending。收到 pause 后状态保持 `pause_requested`，直到全部已请求 effect 已 settled；
  只有屏障清空后才写 `paused`，若仍有未知 outcome 则转为 reconciliation-required，而不是伪造安全暂停点。
- **观测投影暴露批次血缘但不夸大 authority。** runtime status 和 observability effect lineage 新增 batch identity/index/size；
  provider-return 与 operator-reconciled authority、digest-only artifact/checkpoint 以及既有 telemetry gap 继续保持，不把 batch ledger
  冒充第三方 receipt。

### 仓库内验证与证据边界

- draft/review、durable runtime、facade、Cowork DAG、WebSocket、run admission 与两组 command integration 共八个聚焦文件为
  **209/209**；其中 durable runtime 单文件 **13/13**，覆盖双 effect 在首个 provider 前原子可见、双未知 outcome 的顺序 reconcile、
  部分 provider 失败结算屏障、pipeline control signal 传播和并发 pause 屏障；Commander durable command 文件为 **4/4**，覆盖显式
  `maxParallel=2`。
- roadmap verifier 与 journey evidence 两文件为 **37/37**；`--contract-only` 回读 manifest `1.9.3` 的
  **15 cases / 63 referenced test files**，并继续明确 runtime evidence 和 release readiness 未被评估。`p1-dynamic-workflow` fixture
  新增 partial batch publication、partial provider failure、越序 reconcile 与 pause-during-settlement 故障注入，并要求对应违规计数为 0。

### P1-1 仍未关闭的边界

1. **retry/timeout、取消与真实 provider authority：** late settlement 与 genuinely-unapplied attempt 仍无可验证区分，当前 retry/timeout
   继续拒绝；stop/pause 不能物理中断不合作的 provider。真实 provider 也尚未消费 effect/batch idempotency key 并返回可独立回读的
   receipt，因此仓库 ledger 不能证明外部系统的全局 exactly-once。
2. **完整阶段与制品语义：** 一般阶段间 `needs_input`、restart policy、真实 provider token/USD usage、checkpoint restore、ArtifactStore
   immutable bytes readback 与嵌套 tool/MCP/external-system side-effect ledger 仍待接线。
3. **产品消费与外部矩阵：** Workbench/VS Code/JetBrains 的 phase/agent/control UI、plugin/marketplace 分发，以及
   Local/WSL/SSH/Container/Cloud × 三 OS × 双 IDE 每格 100 次 exact-head 真实 provider/宿主故障矩阵均尚未关闭。

因此，P1-1 的**bounded-parallel 原子 request 批次、持久顺序 reconcile、并发失败结算屏障与 pause settlement barrier**由本节关闭；
P1-1 整项仍为**部分完成**，完整 exactly-once/durable resume/needs-input 能力不得据此标为完成。总计数保持
**12/19 项尚未关闭、7/19 项完成、12 个剩余工作包**，整体产品发布结论继续为 **NO-GO**。本节也不改变 S0-1～S0-3、Q0、Q3、
Q4a/Q4b、P1-2、P1-4、P1-5 或 P2-4 的状态。
