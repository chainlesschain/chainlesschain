# ChainlessChain IDE 对照 Claude Code：净差距与优化路线图

- 评估日期：2026-08-01
- ChainlessChain 仓库快照：`eb0bc663b6eb794b1b62ba2bfc7a1267c699d25d`
- ChainlessChain 公开版本基线：CLI `0.162.189`、VS Code `0.37.37`、JetBrains `0.4.76`
- Claude Code 基线：[CLI `2.1.220`](https://code.claude.com/docs/en/changelog)；官方文档回读日期 2026-08-01

> 本文是一份面向下一阶段决策的“净差距”报告，不重复罗列已经完成的能力。
> 既有实现、发布门和历史证据详见
> [IDE 相对插件与 Claude Code 的完整审计](./IDE_VS_PLUGIN_CLAUDE_GAPS_AND_OPTIMIZATIONS_2026-07-22.md)。
> 本地事实按上述仓库快照核验，公开版本只用于说明当前分发基线；除非另有发布证据，不能据此推断每项
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

| 能力面                    | ChainlessChain 当前状态                                                              | 相对 Claude Code 的净差距                                                                                                                       | 建议优先级      |
| ------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Plan Mode 正确性          | C：Headless `--permission-mode plan` 已取只读工具交集；交互式 Plan 另走 `agent-core` | 未建立 execution lock 时，settings `allow`（及显式 host allow 的外部工具）仍可绕过 `planManager.isToolAllowed`；WS plan 快照/事件也未完整持久化 | P0 安全门       |
| Skill / MCP / Hook 信任   | C：生态和治理能力丰富                                                                | 非隔离 Skill handler 在 CLI 进程直接 import；MCP tool annotations 未保留；部分 contract/hook 异常路径会放宽限制                                 | P0 安全门       |
| 子目录指令                | C：支持懒加载 `AGENTS.md`/`CLAUDE.md`/`cc.md`                                        | write/edit/move 在落盘后才注入，delete 未走该路径；loader 以 `path.resolve(cwd)` 为键在进程级共享，无法在首次 mutation 前约束行为               | P0 正确性门     |
| 长会话与状态              | C：有 compressor、Plan 和 TODO primitive                                             | 标准入口未向 compressor 注入 `llmQuery`，超限主要 truncate；TODO 仍在内存，WS Plan 转移持久化不完整                                             | P0 质量门       |
| Plan / Diff / IDE Context | A/B：双 IDE 已有原生 Plan/Diff、质量与语义上下文                                     | 自动影响分析、最小 gate 选择、失败修复重跑尚未进入主路径；legacy 与 `/v2` 的可选整文件上下文仍偏粗粒度                                          | P0/P1           |
| Session / Agent View      | B：Sessions、Background、Team、Worktree、Remote 各自有入口                           | 入口和状态模型碎片化，缺统一 dispatch、peek/reply、attach/detach、needs-input 和交付状态视图                                                    | P0              |
| Rewind / Branch           | B/C：CLI Checkpoint 和受控 writer rollback 强；双 IDE `/rewind` 仅恢复 work tree     | IDE 消息时间线缺代码/对话/二者、定向总结、fork/branch 和副作用覆盖提示                                                                          | P0              |
| Preview / Verification    | B：Preview、DOM/Browser primitive、Test/Coverage/Debug 已存在                        | 缺 DOM/console/network/screenshot 与 diff/test/fix 的统一证据闭环                                                                               | P0              |
| PR / CI                   | C：双 IDE 有只读 PR/CI 状态，CLI 保持 authority                                      | 缺创建 PR、失败日志映射、自动修复重跑、受控 auto-merge/auto-archive 的完整闭环                                                                  | P0              |
| 真实宿主与分发            | B：Open VSX 和 JetBrains Marketplace 已发布，已有 Extension Host/Robot 门            | Microsoft Marketplace 未发布；真实 IDE smoke 太浅；Remote/多根/多窗口/重启矩阵不足                                                              | P0              |
| Dynamic Workflows         | B/C：已有 Cowork DAG 与持久 run history，并另有 Team/Batch、后台 Agent 原语          | 缺 prompt 生成且可审阅的编排、阶段/agent 进度、token/耗时、暂停恢复、版本化保存与插件分发的一体化 UX                                            | P1              |
| Automation                | B/C：CLI 已有 routine/agenda/loop 与 agent channels                                  | IDE 缺统一 Automation Center、trigger scope、run history、run-now/schedule pause 和 needs-input 通知                                            | P1              |
| Execution Environment     | B/C：有 Remote Control、Cloud、后台与跨端能力                                        | Local/WSL/SSH/Cloud 尚未成为创建会话时可理解、可比较、可交接的一等选择；Container 可作为 ChainlessChain 扩展                                    | P1              |
| Permission / Side Effect  | B/C：策略、审批、ledger、裁决已存在；Policy Viewer 仍偏只读                          | 缺规则来源、实际文件/网络/进程/凭据资源、不可逆副作用、恢复覆盖和 scoped-rule 的统一视图                                                        | P1              |
| Plugin / Marketplace      | A/B：供应链和治理强                                                                  | 缺跨来源发现、依赖/许可证图、健康度、真实 private registry/组织签名/故障注入矩阵                                                                | P1/P2           |
| Inline Completion         | C：当前是手动触发                                                                    | 缺自动 debounce/cancel/cache、延迟 SLO 和独立成本预算；有价值但不是决定性差距                                                                   | P2              |
| Desktop 命令与 WebIDE     | C：legacy、`/v2` 与默认 `/v6-preview` 的命令 surface 分叉；WebIDE 更接近 playground  | 命令行为不一致；固定三文件 WebIDE surface 未与 session/context/diff/git/terminal 形成同一产品模型                                               | P0 快赢/P2 决策 |

### 3.3 重大判断的源码证据与目标测试

下表中的行号只对应本报告仓库快照；“目标测试”是关闭缺口时必须新增或扩展的定向回归，不表示当前已经通过。

| ID  | 当前事实与精确证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 复现/目标测试                                                                                             | 目标修复                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| E1  | Headless 已在 [headless-runner.js](../packages/cli/src/runtime/headless-runner.js) `:216-232` 强制只读交集；但 [agent-core.js](../packages/cli/src/runtime/agent-core.js) `:1818-1821,1883-1915,2065-2099` 允许无 execution lock 的 settings/host allow 绕过交互式 Plan tool check。                                                                                                                                                                                                                                                                                                                    | 扩展 headless 矩阵；新增 `agent-core-plan-hard-ceiling.test.js`，覆盖 settings/host/Skill/MCP/Git/shell。 | 所有入口复用不可放宽的 Plan capability ceiling；Plan 文件写入使用单独窄能力。            |
| E2  | 非隔离 Skill handler 在 [agent-core.js](../packages/cli/src/runtime/agent-core.js) `:5350-5353` 被主进程直接动态 import；[skill-process-broker.js](../packages/cli/src/lib/skill-process-broker.js) `:43-50` 固定发送 `policy: "allow"`。                                                                                                                                                                                                                                                                                                                                                               | 新增 handler digest 变化、未信任 workspace handler、任意 Node/child-process 获取能力的集成测试。          | handler 默认隔离；宿主按来源、digest、capability、policy 和 approval 重新裁决。          |
| E3  | [mcp-config.js](../packages/cli/src/runtime/mcp-config.js) `:295-322` 将 schema/source 放入 descriptor，却没有传播 MCP effect annotations。                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 新增未标注、伪报只读、destructive/open-world、同资源并发调用的 MCP 风险矩阵。                             | annotations 版本化但仅作提示；最终 effect 由宿主策略、观测与资源冲突检测共同决定。       |
| E4  | [agent-core.js](../packages/cli/src/runtime/agent-core.js) `:6313-6364,6457-6505` 在 contract 解析失败时放开 Skill allowlist/permission gate，MCP/Hook 则退为空集；后续 permission enforcement 仍按 best-effort 继续。[hook-runner.cjs](../packages/cli/src/lib/hook-runner.cjs) `:671-677` 的默认首个 `block/ask` 短路可让较早 `ask` 遮住后续 `block`。                                                                                                                                                                                                                                                | 新增 malformed contract、permission resolver throw、hook `ask→block` 顺序置换与 timeout/spawn failure。   | authority-bearing failure 退到最严能力；PreToolUse 运行全部匹配规则并取最严格决策。      |
| E5  | [agent-core.js](../packages/cli/src/runtime/agent-core.js) `:2905-2929` 以 `path.resolve(cwd)` 为键共享进程级 loader；write `:3223-3230`、move `:3302-3306`、edit `:3402-3406` 在 mutation 后注入，delete `:3259` 未走注入路径。                                                                                                                                                                                                                                                                                                                                                                        | 新增新 session 首次 write/edit/move/delete 进入嵌套指令目录的“执行前已加载”测试。                         | loader 按 session/root 隔离；所有路径 mutation 在 policy/approval/执行前完成 preflight。 |
| E6  | [prompt-compressor.js](../packages/cli/src/harness/prompt-compressor.js) `:234,299,426` 仅在提供 `llmQuery` 后总结；标准构造 [agent-core.js](../packages/cli/src/runtime/agent-core.js) `:8270+`、[agent-repl.js](../packages/cli/src/repl/agent-repl.js) `:645`、[compact.js](../packages/cli/src/commands/compact.js) `:41,46` 均未注入。                                                                                                                                                                                                                                                             | 用 provider spy 验证超过预算时确实调用摘要，并以冻结事实语料测试失败降级与 usage 记录。                   | 接通受预算 provider query、真实 tokenizer/usage 和统一结构化 handoff。                   |
| E7  | [todo-manager.js](../packages/cli/src/lib/todo-manager.js) `:4,20` 是进程内 store；[ws-session-gateway.js](../packages/cli/src/gateways/ws/ws-session-gateway.js) `:1525-1537,1556-1572` 的 plan snapshot/hydrate 缺 execution lock，`:1621-1629` 监听也未覆盖 revise/executing/settled。                                                                                                                                                                                                                                                                                                               | 新增 WS/IDE/进程 kill-restart、event replay、revision/approval/execution lock 原子一致性测试。            | 以 canonical event + snapshot 持久化 Plan/TODO，并使用 revision/CAS 防止恢复后权限变宽。 |
| E8  | 双 IDE `/rewind` 聚焦 work tree：[chat-view.js](../packages/vscode-extension/src/chat/chat-view.js) `:2298-2399`、[ConversationView.java](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ConversationView.java) `:871-963`。PR 状态明确只读：[extension.js](../packages/vscode-extension/src/extension.js) `:551-553`、[PrStatusAction.java](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/PrStatusAction.java) `:20`；macOS strict gate 固定旧宿主的原因见 [cli-strict-sandbox.yml](../.github/workflows/cli-strict-sandbox.yml) `:170-173`。 | 双 IDE 真实宿主走 conversation/code/partial rewind、PR commit freshness、macOS capability 降级旅程。      | 统一 Rewind/Delivery 协议；宿主不能实现 strict sandbox 时显式降级且不得计入安全发布门。  |

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

当前 workspace/project/marketplace Skill 会被分层发现，非隔离 Skill 的 `handler.js` 在调用时直接 import 到
CLI 主进程，嵌入 MCP 也可在同一上下文连接；`skill-process-broker` 传递的 policy 元数据还是固定 `allow`。
建议：

- 对含 handler、binary、hook 或 embedded MCP 的 Skill 建立 source + content digest 信任记录；首次使用、
  内容变更、来源切换都重新授权，并与 IDE Workspace Trust 联动。
- handler 默认在受限 worker/child process 执行，使用显式 capability manifest，只获得声明且获批的文件、
  网络、进程、MCP 和 secret 能力；主进程只通过结构化 RPC 交互。
- Broker 不接受 Skill 自报的 `allow` 作为最终决策，实际 policy/approval/sandbox/ledger 必须在宿主侧重新计算。
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

### P1-5：Marketplace 发现与组织治理

在现有签名、SBOM、策略和升级恢复基础上，补齐：

- 多来源检索、版本/兼容性/健康度、依赖图、license 与权限摘要。
- 安装前 diff、更新影响、来源切换、离线缓存来源和失败回滚证据。
- private registry、组织签名/撤销、代理/离线、依赖冲突和供应链故障注入的真实环境矩阵。

退出条件：每个安装候选展示 digest/signature/SBOM/license/capability；干净环境可完成安装、升级和回滚；签名撤销、
来源切换、依赖冲突、代理中断与 private registry 故障均 fail closed 并保留可复核 artifact。

## 六、P2：体验和差异化

1. **因果可观测性**：把 token/USD、retry、tool latency 关联到 diff、gate、artifact、PR 结果，支持按
   workspace/team/policy 导出和预算告警。
2. **自动 ghost-text completion**：在独立开关和预算下实现 debounce、cancel、dedupe、cache、局部上下文、
   P50/P95 延迟和质量回退；不能阻塞主 Agent 体验。
3. **多 Agent 合并审阅**：提供 merge 前 hunk/file 选择、冲突解释、跨分支 batch checkpoint 和受控 rollback。
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

## 十二、实施状态快照（2026-08-01）

本节记录原始审计快照之后的实施进展。状态严格区分“仓库实现”“本地定向验证”“真实宿主/远程矩阵”和
“公开发布回读”：前两者不能替代后两者，也不能据此宣称 Microsoft Marketplace 发布、真实 PR/merge 或完整
release gate 已完成。

| 路线项                   | 当前状态                                                                    | 已有证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 尚未关闭的范围                                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-S / S0-1～S0-3        | 仓库级安全/正确性闭包及审计加固已拆分提交；release gate 尚未全局关闭        | `70306bd8ee` 提交 structured semantic handoff；`ece470137d` 提交 Plan/TODO persistence；`7c97c11ebd`、`c841a58e2b` 提交 Skill/MCP safety 与受控 Skill 执行；`199b2cb7c6` 提交 WS recovery state；`9332a21ab3` 提交子树 mutation preflight；`6be06f4448` 提交 Plan hard ceiling、capability fence、contract/permission/Hook fail-closed 与 subagent authority inheritance；`46688dd9ca` 补齐 owner-only `secure-fs` 依赖；`a72d75d153` 收口 verified MCP authority read/write、严格 ledger 转换、Headless/Stream/Cowork 恢复及 semantic-compaction 计费，合并矩阵 462 项通过、1 项跳过，独立复审矩阵 185 项通过 | 仍需在 exact release commit 上完成 Linux/Windows/macOS、strict sandbox、kill/restart 与安全矩阵；sidecar anchor 只覆盖 crash/尾截断，不防同时改写 transcript 与 metadata 的更强攻击者；真实矩阵完成前不把仓库实现宣称为发布验收，也不扩大 Auto/无人值守保证                  |
| P0-0 / R0                | Desktop command、capability 与不可变发布门代码已提交，公开发布仍阻断        | `66f8a7e467` 提交 Desktop 单一 command registry；`a1fa5e41e8` 提交不可覆盖、带 digest、缺诊断 fail-closed 的 host evidence；`af6cc890a4` 提交 Microsoft Marketplace exact publisher/name/version/stable/VSIX digest 回读器；`72429c1729` 提交公开 capability manifest、漂移检查和 required release gate；`55b3c55a1c` 加固 immutable stable-channel/release contract，28 项发布契约测试通过                                                                                                                                                                                                                    | 缺少 `VSCE_PAT` 与可回读的 Microsoft Marketplace 公共版本；原生 installer/OTA 事务仍在修复 lock、backup lineage、Windows sidecar/alias、结果消费与 rescue rollback，且尚无待发布精确提交的完整三平台签名安装/升级/回滚证据。Open VSX、本地测试和旧提交 CI 均不能替代这些门禁 |
| P0-1 / Q1 / R1 Workbench | canonical session projection 垂直切片已提交并通过定向验证；完整 R1 尚未关闭 | `7cbb95ffeb` 提交 CLI、VS Code、JetBrains 共用的 canonical session projection v1，包括 `cc session projection --json`、只读 projection、fixture/parser parity 与 stale fail-closed；CLI + VS Code 定向集 41 项、JetBrains 定向集 18 项通过                                                                                                                                                                                                                                                                                                                                                                     | 证据仍限于仓库实现和本地定向测试；真实宿主 journey，以及完整 dispatch→needs-input→resume→artifact、local/background/remote、重启恢复矩阵仍待完成                                                                                                                             |
| P0-2 / Q2 / R1 Rewind    | 仓库实现完成并提交                                                          | `fa6e9e6951`（`feat(ide): add canonical rewind and branch timeline`）；CLI/VS Code/JetBrains 的 code、conversation、combined、summary、branch 与 coverage 语义已接通，本轮 96 项定向回归通过；`df78ee7060` 补齐该提交链引用的 bounded line reader 与 session index 依赖                                                                                                                                                                                                                                                                                                                                        | 证据等级仍为仓库实现/本地验证；required stock/minimum/OS/remote 真宿主矩阵尚未完成                                                                                                                                                                                           |
| P0-3 / Q3 / R2           | 完整宿主界面接线已提交并通过本地验证；真实外部交付闭环未验收                | `30bb5cd661` 提交 resumable delivery coordinator、impacted gate selector、不可变 evidence、exact-commit strict PR policy、CLI delivery 命令与 VS Code 纯 controller；`4b2df9c4cc`（`feat(ide): complete delivery workflow surfaces`）完成 VS Code ready handshake 与 fail-closed action clearing，以及 JetBrains 实际 UI 接线与 strict integer parity；VS Code 完整单元集 26/26、Delivery + glue 9/9、shared fixture consumer 13/13、JetBrains 定向集 6/6 通过，完整 Gradle 测试为 713 tests、0 failures、0 errors、3 skipped                                                                                  | 没有创建真实 PR，也没有执行真实 CI fix-rerun、merge 或 auto-archive，R2 外部闭环退出条件仍未满足；Windows/Linux/macOS 三 OS 真实宿主矩阵亦未验收                                                                                                                             |
| P0-4 / Q4a / R3a         | 验收基础设施与离线 VS Code DOM/CDP journey 已提交；真实宿主矩阵未运行       | `72429c1729` 提交 VS Code stable/minimum × 三 OS gate、JetBrains 2024.2/2025.2 × 三 OS deterministic driver、capability drift gate 与证据上传；`7868696670` 提交 VS Code DOM/CDP host journey 的离线 driver/evidence；前者的干净 worktree 通过 capability check、14 项相关 CLI 测试、VS Code 17 项单测、Marketplace self-test，以及 JetBrains 2024.2 Gradle `test`/`compileUiTestJava`                                                                                                                                                                                                                         | `7868696670` 仅证明离线 driver/evidence 路径，不代表 Windows/Linux/macOS 上的真实 Extension Host journey 已运行；JetBrains 六格 Remote Robot、Remote/多根/多窗口/重启/网络抖动/8 小时 soak 也尚未实际运行。二进制截图标记为 restricted artifact，不宣称经过文本级脱敏        |
| Q4b / R3b                | 未完成，发布保持 fail-closed                                                | 已有 required workflow 与 immutable stable-channel contract，但没有足以关闭发布门的 exact-release-commit 全矩阵运行证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | required stock/minimum/OS/remote journeys、fresh-profile 安装/升级/回滚、原生 updater 事务修复、真实 Marketplace 回读和失败诊断 artifact 仍待完成                                                                                                                            |
| P1 / R4 与 P2 / R5       | 待实施                                                                      | 本轮没有可验收交付                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Dynamic Workflow、Execution Location、Automation、Context/Permission Center、Marketplace 治理及差异化体验继续按依赖顺序推进                                                                                                                                                  |

当前唯一可声明的外部代码动作是上述提交已由仓库 post-commit hook 推送到 GitHub 与 Gitee；这些提交和
本地定向测试不等同于 Microsoft Marketplace 发布，也不等同于真实 GitHub PR、CI、merge、产品发布或
Linux/Windows/macOS 完整 release matrix。任何后续状态升级都应绑定 exact commit、真实运行矩阵和可回读
artifact。
