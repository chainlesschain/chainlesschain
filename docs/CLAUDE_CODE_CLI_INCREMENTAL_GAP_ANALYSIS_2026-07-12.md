# ChainlessChain CLI 对照 Claude Code v2.1.207 增量差距分析

> 评估日期：2026-07-12  
> Claude Code 基线：v2.1.207（2026-07-11）  
> ChainlessChain CLI 基线：0.162.160  
> 范围：CLI、Headless、Agent Runtime、后台 Agent、扩展与安全；不评价 Claude 账号、订阅权益和 Anthropic 专属云能力

## 结论

ChainlessChain CLI 已经不是“缺基础功能”的阶段。当前版本已经覆盖 Headless、
JSON/stream-json、JSON Schema、Fallback Model、权限模式、Linux bubblewrap/Docker
沙箱、后台 Supervisor、交互式后台面板、Remote Control、Goal、Loop、Agenda、
Inbound Channels、Subagent、Team、Workflow、Worktree、MCP Tool Search、Hooks、
Plugin、LSP、Checkpoint、会话哈希链和 Agent SDK。

继续增加顶层命令或复制 Claude Code 的斜杠命令，边际收益很低。下一阶段更值得做的
是把已经存在的功能连成一个**可恢复、可验证、可治理的 Agent Runtime**。

如果只做五项，建议依次是：

1. 后台 Agent 的真实状态机、崩溃恢复和副作用幂等台账。
2. macOS/Windows 沙箱、`run_code` 隔离和凭据代理。
3. 跨 Agent/Channel/Hook 的权限来源与用户授权不可伪造。
4. 会话级完成条件闭环，以及 Goal、Loop、Agenda、Channel 的统一事件运行时。
5. 面向大型 Monorepo 的上下文懒加载和稀疏 Worktree。

## 已实现基线

上一版 [`CLAUDE_CODE_CLI_GAP_ANALYSIS.md`](./CLAUDE_CODE_CLI_GAP_ANALYSIS.md)
记录的 8 批工作已在 CLI 0.162.160 收口，见
[`changelog.json`](../packages/cli/src/data/changelog.json#L27)。本报告不重复建议
以下已经落地的能力：

| 能力                       | 当前实现证据                                                                                                                                                                                             | 判断                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 确定性 Headless            | `--bare`、`--ephemeral`、协议版本、能力清单、退出码分类                                                                                                                                                  | 已有，不再扩命令面       |
| Fallback 与结构化输出      | [`fallback-model.js`](../packages/cli/src/runtime/fallback-model.js#L234)、[`json-schema-output.js`](../packages/cli/src/lib/json-schema-output.js#L206)                                                 | 已有，需补标准完整度     |
| 后台 Agent                 | `--bg`、daemon、attach、reply、logs、rm、[`bg-dashboard.js`](../packages/cli/src/repl/bg-dashboard.js#L42)                                                                                               | 已有主体，需补恢复语义   |
| Goal/Loop/Schedule/Monitor | [`goal-assess.js`](../packages/cli/src/lib/goal-assess.js#L203)、[`loop.js`](../packages/cli/src/commands/loop.js#L139)、[`agent-schedule-store.js`](../packages/cli/src/lib/agent-schedule-store.js#L6) | 已有分立能力，缺统一闭环 |
| Inbound Channels           | [`agent.js`](../packages/cli/src/commands/agent.js#L346)、[`channel-manager.js`](../packages/cli/src/lib/channels/channel-manager.js#L2)                                                                 | Webhook/Telegram 已有    |
| LSP                        | [`code-intelligence.js`](../packages/cli/src/lib/lsp/code-intelligence.js#L79)、[`agent-core.js`](../packages/cli/src/runtime/agent-core.js#L3437)                                                       | 语义查询工具已完整       |
| Plugin Runtime             | LSP、MCP、Hooks、Monitors、Bin、Settings、签名和版本信任                                                                                                                                                 | 已有生态主体             |
| MCP 生命周期               | Tool Search、OAuth、重连、`list_changed`、项目指纹重信任                                                                                                                                                 | 已有主要链路             |
| 会话完整性                 | Hash chain、`cc session verify`、resume tamper gate、运行时写保护                                                                                                                                        | 已有基础防篡改           |

## 优先级总表

| 优先级 | 建议                                      | 用户价值 | 实现量 | 当前主要差距                                                            |
| ------ | ----------------------------------------- | -------- | ------ | ----------------------------------------------------------------------- |
| P0     | 后台 Agent 状态机与恢复台账               | 很高     | 大     | `idle` 被当作 `needs-input`；无真实等待审批态；风险工具崩溃后缺幂等状态 |
| P0     | 跨平台沙箱与凭据代理                      | 很高     | 大     | Linux 较完整；macOS/Windows 与 `run_code` 隔离未闭环                    |
| P0     | 权限来源与跨 Agent 授权边界               | 很高     | 中     | Agent/Channel/Hook 消息需要不可伪造的 authority                         |
| P1     | 会话级完成条件引擎                        | 高       | 中     | Goal 只记录/评估进展，Loop 独立；没有未达条件自动续轮                   |
| P1     | 大型 Monorepo 上下文与 Worktree 优化      | 很高     | 中     | 缺目录懒加载、排除规则、`sparsePaths` 和安全依赖复用                    |
| P1     | 持久 Scheduler/Monitor/Channel 事件运行时 | 高       | 大     | Agenda 依赖外部调用；Monitor 主要是命令输出正则；Channel 仅接交互 REPL  |
| P1     | 完整 Subagent 契约                        | 高       | 中     | 尚缺 permission/skills/MCP/hooks/memory/effort/background 等统一继承    |
| P1     | Turn、Checkpoint 与会话恢复合一           | 高       | 中     | 绑定偏隐式；Shell/外部进程修改覆盖范围无法精确表达                      |
| P1     | Plugin 能力声明与配置 Schema              | 中       | 中     | 已有版本信任，但缺逐能力 consent、`optionsSchema` 和敏感配置托管        |
| P2     | Hooks 统一事件总线与 Replay               | 中       | 中     | 事件覆盖和两套 Hook 模型未完全统一                                      |
| P2     | JSON Schema 与流式结构化结果              | 中       | 小     | 只实现常用子集，且和 `stream-json` 不兼容                               |
| P2     | LSP 自动诊断与多 Agent Code Review        | 中       | 中     | LSP 以主动查询为主；Review 是单 Agent 单遍发现                          |
| P2     | Doctor、文档生成与因果可观测性            | 中       | 小/中  | CLI 文档仍应从注册表生成；跨 Agent trace 需统一                         |

## P0：后台 Agent 从“能后台跑”升级为“可恢复运行时”

### 当前问题

后台面板目前把 `status=running && phase=idle` 直接分组为 `needs-input`：

```js
if (status === "running") {
  return session.phase === "idle" ? "needs-input" : "working";
}
```

证据见 [`bg-dashboard.js`](../packages/cli/src/repl/bg-dashboard.js#L42)。`idle` 只能说明
当前没有执行回合，不能说明 Agent 正在等待用户问题或权限批准。

现有稳定性矩阵还明确记录了几个未解决边界：

- worker 死亡而 agent child 仍存活时，Supervisor 会标记 `lost`，但不会回收泄漏子进程；
  见 [`README-background-stability.md`](../packages/cli/__tests__/README-background-stability.md#L62)。
- PID 被其他进程复用且 heartbeat 尚新鲜时存在误判窗口；
  见 [`README-background-stability.md`](../packages/cli/__tests__/README-background-stability.md#L79)。
- worker 当前只持久化 `turn`/`idle`，没有真实的 `waiting_approval` 或
  `needs_input` phase；见
  [`README-background-stability.md`](../packages/cli/__tests__/README-background-stability.md#L81)。
- 日志截断后 follow reader 可能重复输出保留前缀；见
  [`README-background-stability.md`](../packages/cli/__tests__/README-background-stability.md#L111)。

Claude Code Agent View 已明确区分 Working、Needs input、Idle、Completed、Failed 和
Stopped，并由独立 Supervisor 在终端关闭、睡眠、升级和进程退出后维护会话。
参考 [Agent View 官方文档](https://code.claude.com/docs/en/agent-view)。

### 建议设计

持久状态至少拆成：

```text
starting
working
needs_input
waiting_permission
idle
completed
failed
stopped
lost
uncertain_side_effect
```

同时增加：

- `process_instance_id = pid + process_start_time + random_boot_token`，不再只信 PID。
- worker/agent 进程组或 Windows Job Object，Supervisor 可回收整棵进程树。
- `turn_id`、`tool_call_id`、`checkpoint_id` 和最后安全提交点的原子持久化。
- 副作用工具台账：`prepared -> started -> committed | failed | unknown`。
- 恢复时只自动重放确定为未执行的调用；`unknown` 必须进入人工确认。
- 后台编码 Agent 默认独立 Worktree，并有逐 Agent 的 turn/token/cost/time/concurrency 预算。
- `needs_input`、完成、失败和预算临界点触发通知；`idle` 不触发“需要输入”。

最低验收：

- 在文件写入、`git push`、包安装三个阶段分别强杀 worker/Supervisor，恢复后不重复副作用。
- 模拟 PID reuse、sleep/wake、CLI 热升级、工作目录被删和日志轮转。
- 问题等待和权限等待可在 daemon 重启后继续显示并通过 attach/reply 完成。
- worker 死亡后无孤儿 agent 子进程。
- Dashboard 的 `Idle` 与 `Needs input` 有独立状态和测试。

### 已落地（增量）

- **PID 复用识别（Gap 1）**：`isSameProcess(pid, startedAt)` 用进程创建时间
  锚定，复用的陌生 pid 即便心跳新鲜也被 reconcile 成
  `lost/pid-reused`；见
  [`background-agent-supervisor.js`](../packages/cli/src/lib/background-agent-supervisor.js#L307)。
- **孤儿 agent 子进程回收（Gap 2）**：worker 死亡/被判 pid-reused 时，
  `reclaimOrphanAgentProcess` 以 `agentStartedAt` 锚定后 tree-kill 记录的
  `agentPid`（无锚点 fail-closed）；见
  [`background-agent-supervisor.js`](../packages/cli/src/lib/background-agent-supervisor.js#L334)。
- **`Idle` 与 `Needs input` 独立状态**：新增共享纯逻辑契约
  [`background-agent-phase.js`](../packages/cli/src/lib/background-agent-phase.js)
  （`BACKGROUND_AGENT_PHASES` + `normalizeBackgroundAgentPhase` +
  `phaseGroupKey`），把 `idle`（结束一轮、已停泊、无阻塞）与真正的
  `needs_input`/`waiting_permission`/pending-approval 区分开，Dashboard 新增
  独立的 **Idle** 分组。修复了此前把每个 `idle` 会话误归入 “Needs input”
  的分类 bug。测试：`background-agent-phase.test.js` +
  `bg-dashboard.test.js`。

**仍欠**：状态机的其余持久态（`waiting_permission`/`uncertain_side_effect`
等）需要真实**生产者**——由 headless-runner 把被阻塞的审批/提问写入
`state.phase` / `pendingApprovals`（消费侧契约已就绪）；副作用台账
（prepared→started→committed|failed|unknown）与崩溃恢复重放尚未实现。

## P0：跨平台沙箱、`run_code` 和凭据代理

当前 Agent 沙箱已经支持 Docker 和 bubblewrap，并能报告
`os-sandbox/container/policy-only`，见
[`agent-sandbox.js`](../packages/cli/src/lib/agent-sandbox.js#L64) 和
[`agent-sandbox.js`](../packages/cli/src/lib/agent-sandbox.js#L220)。

剩余边界：

- macOS 没有 Seatbelt 实现。
- 原生 Windows 没有等价 OS 级边界；需要 WSL2、容器或受限进程方案。
- `run_code` 的依赖安装已默认关闭，但执行本身还应统一进入 Agent 沙箱。
- Python 仍值得补 per-session venv、锁版本和 hash 校验。
- npm、pip、winget、brew 等安装入口需要统一权限类型与审计事件。
- API Key Helper 解决了获取问题，但 Agent 子进程仍不应默认看到真实长期凭据。

建议：

- macOS 实现 Seatbelt profile；Windows 优先提供 WSL2/bubblewrap 或容器后端。
- `run_shell`、`run_code`、Hook、Plugin Bin、LSP、MCP stdio 统一走 Process Sandbox Broker。
- 子进程只看到 credential sentinel，由代理仅向批准的 host/进程注入短期凭据。
- 凭据文件和高风险环境变量支持 deny/mask；审计日志不得记录还原后的值。
- `failIfUnavailable=true` 时任何入口都不能静默降级。
- Windows、macOS、Linux 各有真实集成测试，覆盖子进程链、symlink/junction、
  路径穿越、私网/metadata endpoint 和凭据脱敏。

参考 [Sandbox 官方文档](https://code.claude.com/docs/en/sandboxing)。

## P0：权限来源与跨 Agent 授权边界

当系统同时存在 Subagent、Team、Remote Control、Inbound Channel、Hook 和 MCP 时，
“一段文本来自谁”已经是安全边界。其他 Agent 发来的“用户已批准”不能获得用户权限，
外部 Channel 消息也不能自动扩大当前会话权限。Claude Code v2.1.207 也专门加固了
跨会话消息、repo 配置来源和插件变量插值，见
[v2.1.207 官方发布说明](https://github.com/anthropics/claude-code/releases/tag/v2.1.207)。

建议每条输入和批准携带不可由模型伪造的 envelope：

```text
origin: user | model | subagent | teammate | channel | hook | remote | system
principal_id
session_id
parent_agent_id
correlation_id
authority: none | steer | approve(tool_call_id) | manage_session
signature_or_local_capability
```

规则：

- 只有本地用户 UI、已配对 Remote Approval Bridge 或显式 Permission Tool 能产生
  `approve(tool_call_id)`。
- Subagent/Teammate/Channel/Hook 普通消息只能 steer，不能代表用户批准。
- 批准绑定 `tool_call_id + normalized_arguments + policy_digest`，参数变化即失效。
- repo 配置不能开启 bypass/auto、注入敏感 Plugin Options 或放宽 managed deny。
- Permission 日志记录完整来源链，并显示是哪一个 Agent 请求了什么权限。
- Subagent Worktree 隔离失败必须 fail closed，不能回落到主 checkout。

安全测试必须证明：恶意消息中的“approved/用户同意”不会通过权限门；重连重放、参数
替换、Agent 名称复用和跨 Session 投递不会复用错误批准。

### 已落地（增量）

- **不可伪造的 authority 契约**：新增纯逻辑模块
  [`agent-authority.js`](../packages/cli/src/lib/agent-authority.js) 作为单一
  真源——`ORIGIN`（user/model/subagent/teammate/channel/hook/remote/system/
  permission_tool）+ `AUTHORITY`（none/steer/approve/manage）+
  `authorityForOrigin` + `canApprove`/`assertCanApprove`。规则内建：只有本地
  user、显式 permission_tool、或**已认证且被授予 approve scope** 的 remote 设备
  能批准；model/subagent/teammate/channel/hook 的消息最高只能 steer——其载荷里
  的 “approved” 只是文本。`origin` 恒由可信派发代码按“消息如何到达”赋值，绝不
  从不可信的消息**内容**读取。
- **批准绑定 `tool_call_id + normalized_arguments + policy_digest`**：
  `approvalBindingDigest` / `verifyApprovalBinding`（key 顺序无关、常数时间比较、
  fail-closed）。已在本地 headless 审批链路端到端接线——
  [`headless-stream.js`](../packages/cli/src/runtime/headless-stream.js) 的
  `approval_request` 现携带 `binding`，`settleApproval` 对携带**不匹配** binding
  的 _approve_ 裁决判为 `binding-mismatch` 拒绝（deny 恒放行，无 binding 向后兼容）。
  这挫败重放、参数替换与错投的批准。
- **provenance 描述**：`describeAuthorityChain` 输出无秘密的来源链字符串，供权限/
  审计日志记录“哪个 principal、哪个 session、什么 authority”。
- 测试：`agent-authority.test.js`（伪造批准被拒 / 未认证 remote 不能批准 /
  参数替换·跨请求·agent 名复用 binding 失配 / rank 排序 / provenance）+
  `headless-stream-approvals.test.js`（binding 往返：匹配放行、失配拒绝、缺失
  向后兼容）。

**仍欠（把契约接到其余 seam）**：当前**唯一**的 origin 感知检查是
`remote-session-protocol.js:440` 的 per-device scope。下一步把 `assertCanApprove`

- `describeAuthorityChain` 接到远端审批 seam（E: `handleSessionAnswer` /
  G: relay 控制路径）与审计日志，并把 `binding` 透传到远端/relay 审批往返
  （`approval_request` → 设备回显 → 校验）；channel 消息虽已是 steer-only 文本前缀，
  仍应显式标注 authority；agent-sdk 的 `ApprovalRequestEvent` 可选加 `binding` 回显
  （需 bump SDK 版本，故留待下次 SDK 发版）。repo 配置不得开 bypass/auto 与 managed
  deny 放宽的强制项亦未做。seam 全图见提交说明。

## P1：会话级完成条件引擎

当前 `cc goal` 是跨会话目标/OKR：它可以向运行注入目标，并在 `--goal-assess` 后
记录一次进展，见
[`headless-runner.js`](../packages/cli/src/runtime/headless-runner.js#L1665)。
`cc loop` 则是独立的命令/Agent 周期执行器。

这两者尚未形成 Claude Code `/goal` 的语义：每个外层回合结束后由独立 evaluator
判断完成条件，未满足时自动开始下一回合，直到完成或预算耗尽。参考
[Goals 官方文档](https://code.claude.com/docs/en/goal)。

建议保留两个概念：

- `cc goal`：长期、跨会话的项目目标和 Key Results。
- REPL `/goal <condition>` 或 Headless `--goal-condition <condition>`：当前会话完成条件。

完成条件引擎应使用独立 evaluator，支持模型判断和确定性检查器，输出结构化 reason、
evidence、turn/token/cost/time，可随 session resume，并强制
`max_outer_turns`、token/cost/time 上限。SDK 增加
`goal_started/evaluated/completed/exhausted` 事件。

## P1：大型 Monorepo 的上下文和 Worktree 优化

ChainlessChain 本身包含 Electron/Vue、Spring Boot、FastAPI、Forum、Android、iOS、
UniApp 和 signaling server，是最合适的真实基准仓库。

当前已有项目 Memory、路径作用域 Rules、`--add-dir` 和 Worktree，但本次静态检索未在
`worktree-isolator.js` 找到 `sparsePaths`、sparse-checkout 或
`symlinkDirectories`。

建议补齐：

- 子目录 `cc.md/AGENTS.md/CLAUDE.md` 在首次访问子树时懒加载。
- `instructionExcludes`，排除 legacy/vendor/generated 子树。
- per-directory Skills 和 `paths:` 按需发现，启动时只注入名称/短描述。
- `worktree.sparsePaths`，只 checkout 当前任务需要的包。
- `symlinkDirectories` 仅允许显式批准的依赖目录，并防 junction/symlink 逃逸。
- additional roots 变化后发送 MCP `roots/list_changed`。
- `/context` 展示每个 instruction、skill、MCP schema 和消息的 token 占用与来源。

验收直接以本仓库测量冷启动、首轮 token、Worktree 创建时间、磁盘占用和检索调用数。
参考 [大型代码库官方指南](https://code.claude.com/docs/en/large-codebases)。

## P1：统一持久 Scheduler、Monitor 和 Channel

当前 Schedule/Monitor 意图已持久化到 JSONL，但需要外部周期调用 `cc agenda run`；
Monitor 主要轮询 shell 输出并用正则判断；Webhook/Telegram Channel 目前只接
interactive REPL，见 [`agent.js`](../packages/cli/src/commands/agent.js#L1199)。

建议让 daemon 成为统一 Event Runtime：

- 持久 timer wheel/cron，支持 one-shot、recurring、自适应 wakeup、过期和取消。
- 重启后只补触发一次，不按错过次数形成惊群，并加入确定性 jitter。
- Monitor 支持命令 stdout、文件变化、WebSocket、SSE、HTTP webhook 和 MCP event。
- 事件有 `event_id`、去重窗口、backpressure、大小上限、authority 和审计记录。
- Background/Headless/REPL 使用同一注入协议。
- 每个定时/事件任务有独立预算、权限模式、Worktree 和最大存活期。
- Channel pairing/allowlist 与 Permission Approval 是两个权限层，不能混用。

参考 [Scheduled Tasks](https://code.claude.com/docs/en/scheduled-tasks) 和
[Channels](https://code.claude.com/docs/en/channels)。

## P1：补齐 Subagent 契约

当前已实现 `disallowedTools`、`maxTurns` 和 `isolation: worktree`。还应补齐：

- `permissionMode`
- `skills`
- `mcpServers`
- `hooks`
- `memory`
- `effort`
- `background`
- `context: fresh | fork`
- `maxDepth`、`maxChildren`、token/cost/time budget
- 精确取消单个 Subagent
- 每个 child 的用量、权限和 checkpoint 归因

递归派生默认必须有深度和总 Agent 数上限。Worktree 不可用时必须失败。参考
[并行 Agent 官方总览](https://code.claude.com/docs/en/agents)。

## P1：显式绑定 Turn、Checkpoint 和恢复

当前已有自动 Checkpoint、哈希链和 `/rewind`，但建议升级为显式表：

```text
turn_id
  -> conversation_offset
  -> file_checkpoint_id
  -> tool_call_ids
  -> permission_decision_ids
  -> child_agent_ids
  -> worktree_id
  -> coverage: full | partial | none
```

恢复界面提供 Conversation only、Files only、Conversation and files，以及
Summarize from here/up to here。Shell、外部进程和用户编辑造成的变化标记
`coverage: partial`，不能承诺完全恢复。外部 Session Mirror 应支持加密、保留期、
删除和 key rotation。参考
[Checkpointing 官方文档](https://code.claude.com/docs/en/checkpointing)。

## P1：Plugin 能力声明和配置 Schema

当前 Plugin 已具备 exact-version trust、签名、managed allow/block、LSP、MCP、Hooks、
Monitors、Bin 和安全 Settings 子集。下一步建议：

- Manifest `permissions` 声明 process、network domains、filesystem roots、MCP、
  monitor、credential 等能力。
- 安装/升级显示 capability diff；新增能力必须重新 consent。
- `optionsSchema` 描述类型、默认值、校验、作用域和敏感性。
- 敏感项保存到 OS Keychain/DPAPI/Secret Service，项目配置不能提供。
- shell-form 命令禁止不安全变量插值，优先 exec argv。
- Bin/LSP/MCP/Hook 进入统一 Sandbox Broker，并保留 plugin provenance。
- 版本锁、依赖图和签名进入 lockfile/SBOM 与审计日志。

当前 Plugin Settings 只合并安全的 env/model 子集，见
[`settings.js`](../packages/cli/src/lib/plugin-runtime/settings.js#L23)。
参考 [Plugins 官方文档](https://code.claude.com/docs/en/plugins)。

## P2：Hooks、结构化输出与质量闭环

### Hooks

当前 Hook payload 已有 `schema_version` 和熔断；现有 DB Hook 枚举见
[`hook-manager.js`](../packages/cli/src/lib/hook-manager.js#L33)。建议补齐
PermissionDenied、SubagentStart/Stop、TaskCreated/Completed、InstructionsLoaded、
ConfigChange、CwdChanged、WorktreeCreate/Remove、MCP Elicitation，并统一：

- versioned envelope、delivery id、trace id 和 parent id。
- 多 Hook 并行、最严格决策合并和同 handler 去重。
- `cc hook replay <event-id>`；decision hook 重放必须显式沙箱。
- async hook 持久队列及 `allowManagedHooksOnly`。

参考 [Hooks 官方文档](https://code.claude.com/docs/en/hooks)。

### JSON Schema

当前 validator 支持常用子集并最多纠错三次，但不是完整 JSON Schema，且
`--json-schema` 与 `stream-json` 不兼容。建议支持 Draft 2020-12，启动时校验
schema，并在流协议增加最终事件：

```json
{
  "type": "structured_result",
  "schema_digest": "sha256:...",
  "valid": true,
  "value": {}
}
```

失败时返回稳定错误码和 JSON Pointer，不得静默退回自由文本。

### LSP 与 Code Review

现有 LSP 已支持 definition、references、hover、symbols、diagnostics 和 rename preview。
可继续增加 Edit 后自动 diagnostics、节流/token 上限、多根 workspace、server
crash/backoff 和 `/doctor` 检查。

当前 `cc review` 是一个只读 Agent 的单遍 findings，见
[`review.js`](../packages/cli/src/commands/review.js#L489)。高 effort 可升级为：

1. 多个 finder 分别检查 correctness/security/performance/tests。
2. verifier 独立复现每条 finding。
3. deduper 合并重复结论并按置信度过滤。
4. 输出 path、line、category、severity、failure scenario、evidence。

## P2：Doctor、文档与可观测性

`/doctor` 已经存在，建议扩展为 Runtime Checkup：

- 沙箱真实能力和静默降级。
- MCP auth/重连和 schema context 成本。
- 慢/熔断 Hook、重复 Agent/Skill、失效 Plugin/LSP。
- 后台孤儿进程、PID 身份、过期 Session/Worktree/Agenda。
- 冗长或可从代码推导的 `cc.md/AGENTS.md`。
- Session hash、Mirror 加密和保留策略。

同时完成上一版遗留的“从 Commander + Tool Registry 自动生成 CLI 文档”，避免命令、
工具、flag、退出码和协议字段漂移。

OpenTelemetry 统一 `session.id`、`turn.id`、`prompt.id`、`tool_use.id`、`agent.id`、
`parent_agent.id`、`workflow.run_id`、`permission.decision_id`、`checkpoint.id`。
默认隐藏 prompt/response/tool arguments，显式 opt-in 才输出内容，并控制标签基数。

## 不建议优先复制

- Claude 账号登录、订阅用量、Anthropic 专属云权限与品牌命令。
- 更多同义顶层命令或斜杠命令。
- 在现有自托管 Remote Control、Cloud Handoff 和 Web Panel 上照搬 Anthropic
  Remote Control/Artifacts，除非已有明确分享场景。
- 继续扩 Voice、Browser、Computer Use 的交互花样。
- 没有预算、Worktree、authority 和幂等保证的大规模 Agent Team 扩张。
- 只为功能数量平价增加实验特性，而没有真实指标和故障模型。

## 推荐实施批次

1. **后台可靠性**：真实状态、process identity、孤儿回收、副作用 ledger、恢复测试。
2. **安全边界**：authority envelope、跨平台沙箱、统一 Process Broker、credential proxy。
3. **自主闭环**：`/goal`/`--goal-condition`、daemon Scheduler/Monitor/Channel、任务预算。
4. **大型仓库与多 Agent**：懒加载、sparse Worktree、完整 Subagent 契约。
5. **会话与生态协议**：turn/checkpoint、Plugin schema、Hook replay、stream schema。
6. **质量与运营**：自动 LSP diagnostics、多 Agent verified review、Doctor、文档和 OTel。

## 建议新增测试

| 测试                                   | 关键场景                                                  |
| -------------------------------------- | --------------------------------------------------------- |
| `background-agent-recovery.test.js`    | Supervisor/worker 在副作用前中后崩溃、PID reuse、孤儿回收 |
| `background-agent-needs-input.test.js` | idle/question/permission 三态、重启后 reply               |
| `permission-authority.test.js`         | Agent/Channel/Hook 文本不能伪造用户批准                   |
| `sandbox-platform-contract.test.js`    | Linux/macOS/Windows 相同语义，严格模式不降级              |
| `sandbox-credential-broker.test.js`    | sentinel 注入、host 限制、日志脱敏                        |
| `goal-condition-loop.test.js`          | 未完成续跑、完成停止、预算耗尽、resume                    |
| `daemon-agenda-recovery.test.js`       | cron 重启、错过触发只补一次、去重和过期                   |
| `monitor-event-backpressure.test.js`   | WS/SSE 高频事件、断线重连、大小限制                       |
| `monorepo-lazy-context.test.js`        | 子目录说明/Skills 按需加载、excludes、token 预算          |
| `worktree-sparse-security.test.js`     | sparse checkout、junction/symlink 逃逸、清理              |
| `subagent-runtime-contract.test.js`    | 权限/Skills/MCP/Hooks/Memory/Effort 继承与覆盖            |
| `checkpoint-turn-binding.test.js`      | conversation/files/both、partial coverage、跨 Worktree    |
| `plugin-capability-schema.test.js`     | capability diff、敏感选项 scope、重新 consent             |
| `hook-event-golden.test.js`            | CLI/SDK/IDE 的 event schema、顺序、合并和 replay          |
| `structured-output-stream.test.js`     | 完整 schema、无效 schema、stream final envelope           |

## 参考资料

### Claude Code 官方一手资料

- [Claude Code v2.1.207 Release](https://github.com/anthropics/claude-code/releases/tag/v2.1.207)
- [Agent View](https://code.claude.com/docs/en/agent-view)
- [Agents and parallel work](https://code.claude.com/docs/en/agents)
- [Goals](https://code.claude.com/docs/en/goal)
- [Scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)
- [Channels](https://code.claude.com/docs/en/channels)
- [Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Large codebases](https://code.claude.com/docs/en/large-codebases)
- [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Plugins](https://code.claude.com/docs/en/plugins)
- [Tools reference](https://code.claude.com/docs/en/tools-reference)

### 仓库证据

- [`CLAUDE_CODE_CLI_GAP_ANALYSIS.md`](./CLAUDE_CODE_CLI_GAP_ANALYSIS.md)
- [`packages/cli/package.json`](../packages/cli/package.json#L2)
- [`packages/cli/src/data/changelog.json`](../packages/cli/src/data/changelog.json#L27)
- [`packages/cli/__tests__/README-background-stability.md`](../packages/cli/__tests__/README-background-stability.md)
- [`packages/cli/src/lib/agent-sandbox.js`](../packages/cli/src/lib/agent-sandbox.js)
- [`packages/cli/src/lib/background-agent-supervisor.js`](../packages/cli/src/lib/background-agent-supervisor.js)
- [`packages/cli/src/repl/bg-dashboard.js`](../packages/cli/src/repl/bg-dashboard.js)
- [`packages/cli/src/runtime/headless-runner.js`](../packages/cli/src/runtime/headless-runner.js)
- [`packages/cli/src/lib/channels/channel-manager.js`](../packages/cli/src/lib/channels/channel-manager.js)
- [`packages/cli/src/lib/plugin-runtime/settings.js`](../packages/cli/src/lib/plugin-runtime/settings.js)
- [`packages/cli/src/lib/hook-manager.js`](../packages/cli/src/lib/hook-manager.js)
