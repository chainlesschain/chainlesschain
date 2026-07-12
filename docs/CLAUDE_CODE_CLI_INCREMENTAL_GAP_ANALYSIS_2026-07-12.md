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

### 已落地（增量）

- **凭据代理（子进程不再默认继承真实长期凭据）**：新增纯逻辑模块
  [`credential-proxy.js`](../packages/cli/src/lib/credential-proxy.js)。此前
  `run_shell`/`run_code` 以 `{...process.env}` 派生子进程
  （[`agent-core.js`](../packages/cli/src/runtime/agent-core.js) 前台+后台两处），
  会把 agent 自己的 `ANTHROPIC_API_KEY`、云密钥、token 原样泄露给任意命令。
  - `maskCredentialEnv` 把凭据命名的 env 变量替换成不可逆 **sentinel**
    （`cc-cred-redacted:<NAME>`）或直接删除（`mode:"deny"`），真值留在
    **parent 持有的 vault**，子进程永远拿不到；`resolveApprovedInjection` 仅对
    **已批准 host** 即时注入（fail-closed）。凭据名分类复用 credential-guard 的
    `isSecretEnvName`（单一真源，避免漂移）。
  - `redactEnvForAudit` / `redactSecretValue` 保证审计日志只见 `***`/sentinel，
    绝不记录还原后的真值。
  - 已接线到两处 `run_shell`/`run_code` spawn（`applyCredentialProxy(env).env`），
    **opt-in**（`CC_CREDENTIAL_PROXY=1` 或 `config.credentialProxy.enabled`），
    默认关时返回**同一对象**、行为字节不变；开启即掩码。默认关是为了不破坏
    合法从 env 读 token 的工作流；**default-on 是后续目标**（需 changelog 行为
    变更 + 逐 host 注入接线齐备）。
  - 测试：`credential-proxy.test.js`（分类 / 掩码 / deny / 不双掩 / 审计脱敏 /
    approved-only 注入 / 配置与 env 门 / **真 spawn 端到端**证明子进程只见
    sentinel、`deny` 下变量彻底消失）。

**仍欠（多为环境/平台阻塞）**：macOS Seatbelt profile；原生 Windows 的 OS 级
边界（WSL2/容器/受限进程）；把 `run_shell`/`run_code`/Hook/Plugin Bin/LSP/
MCP stdio 统一收进 Process Sandbox Broker；Python per-session venv + 版本锁 +
hash 校验；npm/pip/winget/brew 安装入口的统一权限类型与审计事件；凭据代理
default-on + 逐 host 短期凭据注入接到 egress proxy；三平台真集成测试
（子进程链 / symlink·junction / 路径穿越 / 私网·metadata endpoint）。

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

### 已落地（增量）

- **完成条件引擎核心**：新增纯逻辑模块
  [`goal-condition-engine.js`](../packages/cli/src/lib/goal-condition-engine.js)
  （与 `cc goal` OKR、`cc loop` 定时器**刻意分离**，驱动 agent **外层回合**）：
  - `parseGoalCondition`：`exit-zero:<cmd>` / `file-exists:<path>` /
    `contains:<text>` / `regex:<pat>` 四种**确定性检查器** + `model:<desc>`／裸
    文本的**模型判断**。
  - `checkDeterministicCondition`（纯，按 evidence 判定）+ `runDeterministicCheck`
    （注入 `spawnSync`/`existsSync` 采证，真 spawn 跑 `exit-zero`）。
  - `evaluateGoalStep` 纯 reducer + `GoalConditionEngine` 类：每个外层回合
    evaluate → `complete`/`continue`/`exhausted`，强制 `max_outer_turns` +
    token/cost/time 预算（含硬上限 100 回合防空转），产出 SDK 事件
    `goal_started/goal_evaluated/goal_completed/goal_exhausted`，每个事件带
    结构化 reason/evidence + turn/token/cost/time。
  - **可 resume**：`snapshot()`/`fromSnapshot()` 保留 startedAtMs 与累计用量，
    跨进程继续计时/计量。时钟经 `now` 注入、绝不隐式读取——快照可确定性重放。
  - 测试：`goal-condition-engine.test.js`（条件解析/预算归一含硬上限/四种确定性
    检查含真 spawn exit-zero/reducer 的 complete·continue·exhausted 四种终止
    条件/引擎驱动到完成/**快照跨 resume 累计正确**）。

**仍欠（接到外层回合驱动）**：把引擎接进 headless-runner 的外层回合循环——加
`--goal-condition <spec>` + `--max-outer-turns`/`--goal-max-tokens`/`-cost`/`-time`
flag（REPL `/goal <condition>`），未满足条件时用 `job.followUpArgv` 自动起下一回合
（与后台 worker 的续跑机制一致），并把四个 `goal_*` 事件经 stream-json 输出、
SDK `AgentSession` 转发；`model:` 条件复用现有 `assessChat`/`chatWithTools` 作
独立 evaluator。均需真实外层循环 harness，作为下一步集成。

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

### 已落地（增量）

- **`instructionExcludes`（大仓上下文缩减杠杆）**：
  [`project-instructions.js`](../packages/cli/src/lib/project-instructions.js)
  新增 `normalizeInstructionExcludes` + `pathIsExcluded`，让 legacy/vendor/
  generated 子树的 `cc.md`/`CLAUDE.md`/`AGENTS.md`、路径作用域 `.claude/rules/
*.md`、以及**解析到被排除子树的 `@import`** 全部**不加载**（否则一个指向
  vendor 的 import 就能绕过杠杆）。匹配相对仓库根：裸名（`node_modules`/`dist`）
  按**任意路径段**命中；带斜杠前缀（`packages/legacy`）命中该目录及其全部子孙；
  glob（`**/generated/**`、`vendor/*`，`*`/`**`/`?`）按祖先目录命中即排除整棵
  子树。**opt-in**：无 excludes 时行为字节不变；user-scope（仓库外）豁免。已经
  `composeSystemPrompt(opts.instructionExcludes)` 前向透传（任意 caller/SDK 可
  供给）。
  - 测试：`project-instructions.test.js` 新增块——normalize 归一/去重/斜杠、
    `pathIsExcluded` 三类匹配、真临时目录验证「排除子树的 cc.md 不载 / 排除子树
    的规则不载 / 指向排除子树的 @import 不载（附对照的未排除控制）」。

**仍欠**：把 `instructionExcludes` 从 `.claude/settings.json` / 统一 config 读出
并在 headless-runner 处传入 `composeSystemPrompt`（最后一公里配置接线）；子目录
指令**按首次访问子树懒加载**（tool-time 注入，module 99 §5.3）；per-directory
Skills/`paths:` 按需发现只注入名称/短描述；`worktree.sparsePaths` sparse-checkout

- `symlinkDirectories`（含 junction/symlink 逃逸防护，需真 git）；additional roots
  变更发 MCP `roots/list_changed`；`/context` 扩展为按 instruction/skill/MCP schema/
  消息的 token 占用+来源分解（现 `cc context` 仅按消息角色分桶）。

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

### 已落地（增量）

- **调度规划器（自适应 wakeup + 确定性 jitter + 过期）**：新增纯逻辑模块
  [`schedule-planner.js`](../packages/cli/src/lib/schedule-planner.js)，补上持久
  store 之外仍缺的三件：
  - **确定性 jitter**：`jitterOffsetMs(id, jitterMs)` 用 FNV-1a 哈希 task id 得
    稳定偏移（无 RNG，跨重启不变），把共享同一 cron 分钟（如 `0 * * * *`）的任务
    错峰，避免惊群；`effectiveFireAt` = 基准 fire + jitter。
  - **自适应 wakeup**：`nextWakeupAt`/`msUntilNextWakeup` 给出所有可调度、未过期
    条目里最早的未来 fire 时间——daemon 据此**精确睡眠**而非轮询（现 `cc agenda
run` 依赖外部周期调用）。
  - **过期**：`isEntryExpired`（`expiresAt<=now`）；`partitionSchedule` 把条目分成
    `expired`（先退休，绝不再补最后一次）/`due`（立即 fire）/`waiting`。
  - 「重启只补一次不惊群」的 catch-up 不变式本就由 store 的 `advanceCron`（跳到
    `nextCronTime(now)`）保证，本模块不重新引入 per-miss 扇出。
  - 已接线到 `cc agenda list`：输出 `nextWakeupAt`（JSON）+「next wakeup」行。
  - 测试：`schedule-planner.test.js`（jitter 确定性/有界/错峰、effectiveFireAt、
    schedulable/expired、partition 三分含 jitter 推迟、adaptive wakeup 忽略过期/
    终态、`msUntilNextWakeup` 钳位）+ `agenda-command.test.js`（list 报告最早
    next-wakeup、无可调度时为 null）。

**仍欠（daemon 事件运行时闭环）**：把 daemon 变成常驻 Event Runtime——用
`msUntilNextWakeup` 驱动睡眠、`partitionSchedule` fire due/退休 expired（并给
create 加 `expiresAt`/`jitterMs`）；Monitor 扩到文件变化/WebSocket/SSE/HTTP
webhook/MCP event（现仅 shell stdout 正则）；事件加 `event_id`/去重窗口/
backpressure/大小上限/authority（复用 [[agent-authority.js]]）/审计；每个定时/
事件任务独立预算·权限模式·Worktree·最大存活期；Channel pairing/allowlist 与
Permission Approval 分层不混用。

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

### 已落地（增量）

统一继承/覆盖的**纯策略核心** `src/lib/subagent-contract.js`（无 I/O、确定性）——
把 gap 列出的整套字段（`permissionMode`、`skills`、`mcpServers`、`hooks`、
`memory`、`effort`、`background`、`context: fresh|fork`、`maxDepth`、
`maxChildren`、token/cost/time budget）normalize + validate + 按 **spawnArgs >
definition > parent** 合并，并强制**只能收紧不能放宽**的安全不变量（镜像
[[agent-authority.js]]）：

- **`permissionMode` tighten-only**：`tightenPermissionMode` 按 permissiveness
  rank（`plan < manual < default < acceptEdits < auto=dontAsk < bypassPermissions`）
  钳制——子 Agent 请求比父更宽的模式一律降到父的模式；非法/缺省则继承父（fail-safe）。
- **能力集 INTERSECT 父上限**：`skills`/`mcpServers`/`hooks` 与父的集合求交（父
  为 null=不限），子永远拿不到父没有的能力；`context: fresh`（默认）不继承任何
  能力、`fork` 才继承。
- **memory 不可越权授予**：父显式拒绝（`memory:false`）时子永远拿不到；fork 且父
  有才继承。
- **budget 封顶父剩余**：`capBudget` 逐字段（tokens/cost/time）取 `min(请求, 父剩余)`。
- **深度/宽度天花板只降不升**：`maxDepth`/`maxChildren` 取 `min(父, 子请求)`。
- **递归 fail-closed**：`enforceRecursionLimits` 在 depth/breadth 达上限即拒（子契约
  上限与 run 硬上限取更小者）；`resolveIsolationFailClosed` 编码「worktree 不可用
  必须失败、不得回落主 checkout」的策略。

**接线（最小、低风险）**：`agents.js` `parseAgentFile` 现把上述扩展字段
normalize 成 `contract`（前十六字段仍原样保留给现有 spawn 路径），agent-file 定义
可声明整套契约、并在对象上可读。**测试**：`subagent-contract.test.js` 33 项
（normalize/enums/tighten-only/intersect/fresh-vs-fork/budget-cap/recursion/
worktree-fail-closed）+ `agents-loader.test.js` 补 2 项 = 42 绿；相关
spawn-delegation/contract-extended/scaffold/status 25 项回归绿。

**仍欠（把 `contract` 接到运行时执行）**：`_executeSpawnSubAgent` 目前只消费
`tools`/`disallowedTools`/`maxTurns`/`isolation`，尚未把 resolved 的
`permissionMode`/`effort`/`context`/`skills`/`mcpServers`/`hooks`/`memory`/
`background`/`budget` 喂进子 `agentLoop`（需父有效契约 + 运行时剩余 budget 的真源
接入）；`context:fresh` 当前已是 SubAgentContext 的隐式行为但未由 `context` 字段
显式驱动；`resolveIsolationFailClosed` 的策略未替换 sub-agent-context.js 里
「非 git repo → 静默跑主 checkout」的 fail-open（line ~180）；精确取消单个
Subagent、每 child 的 checkpoint 归因仍缺。

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

### 已落地（增量）

**显式的 turn→checkpoint 绑定表**（此前只有 `repl-rewind.js` 的隐式
`_checkpointMarks` 扁平数组 + `pickCheckpointForTurn` 启发式，且进程内易失、切
session 即清）。新建纯核 `src/lib/turn-binding.js`（无 timer/RNG/git/IO，确定性）：

- **每 turn 一条显式记录** `TurnBindingLog`：`turnId → {conversationOffset,
  fileCheckpointId, toolCallIds[], permissionDecisionIds[], childAgentIds[],
  worktreeId, coverage}`——gap 列的整张表；`startTurn`/`recordToolCall`/
  `recordPermissionDecision`/`recordChildAgent`/`bindCheckpoint`（保留最早=pre-
  mutation 快照）/`setWorktree`/`markUserEdit` 累积，`toJSON`/`fromJSON` 可序列化
  给 session 记录持久化（IO 归调用方）。
- **诚实的 `coverage: full|partial|none`**（`computeCoverage`，确定性）：跑过
  shell/外部进程/用户编辑（`classifyToolKind` 子串判定 shell）→ **PARTIAL**（副
  作用在文件树之外、`不能承诺完全恢复`）；无文件改动→FULL；改文件且有 checkpoint
  →FULL；改文件但无 checkpoint→NONE（文件不可复原）。把 `agent-repl.js` 里那句非
  正式提示串正式建模成数据字段。
- **恢复计划 `resolveRestorePlan(turn, scope)`**——scope∈{conversation, files,
  both} 对应 gap 的三种恢复界面，**永不过度承诺**：partial 覆盖、缺 checkpoint、
  或单侧恢复导致文件与对话漂移，都返回 warnings 而非静默做有损恢复。
- **区间选择 `selectTurnRange`**（Summarize from here / up to here）+ **桥接
  `buildTurnBindingFromMarks`**：从 REPL 现有的 `listUserTurns` + `_checkpointMarks`
  就地构造显式表（把每个 mark 归属到「其 atMessageCount 之下最大 index 的 turn」、
  turn 的 checkpoint 取该 turn 最早 mark），**让 coverage-aware 恢复今天就能从已有
  状态派生**，无需先改 agent loop。

**测试**：`turn-binding.test.js` 21 项（classifyToolKind / computeCoverage 四分支 /
TurnBindingLog 全字段 + earliest-checkpoint + dedupe + JSON round-trip /
resolveRestorePlan 三 scope + 漂移与 partial warnings / selectTurnRange /
桥接归属与 orphan mark）全绿。

**仍欠（持久化 + 运行时事件 + 恢复 UI）**：把绑定作为**新链式事件**
`appendEvent(sessionId, "turn_checkpoint_binding", …)` 落 `jsonl-session-store.js`
（继承哈希链防篡改，替代易失的 `_checkpointMarks`）；从 agent loop 事件（checkpoint /
tool-executing 的 `tool_use_id` / 权限决定 `requestId` / `spawn_sub_agent` /
worktree create）实时喂 `TurnBindingLog`（tool-call **持久 id** 目前不存在，需引入）；
把 `resolveRestorePlan` 的 scope 选择 + coverage 警告接进 `/rewind` 交互输出；外部
Session Mirror 的加密/保留期/删除/key rotation 属独立基建，未起。

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

### 已落地（增量）

新建纯核 `src/lib/plugin-runtime/capabilities.js`（无 IO，manifest 的声明式安全契
约），覆盖 gap 前四条（能力声明 / 安装升级 capability diff + 重新 consent /
optionsSchema 类型·默认·校验·作用域·敏感性 / 敏感项不得来自项目配置）：

- **声明式能力**（`manifest.permissions` → `normalizeCapabilities`）：`process` /
  `network{any,domains}` / `filesystem{roots}` / `mcp` / `monitor` /
  `credential{names}`，全部**默认 DENY**、必须显式声明。`network:true|"*"`=任意
  主机（描述里高亮）。
- **capability diff + 重新 consent**：`diffCapabilities(prev,next)` 输出
  added/removed（稳定 token，如 `process`/`network:*`/`network:api.x.com`/
  `filesystem:/tmp`/`credential:GH_TOKEN`）+ `widened`；`consentRequiredForUpgrade`
  ——**任何加宽**（新能力/新域名/新根）都要求重新 consent（首装=从空 diff，必
  consent）；**收窄**不需要。与现有 exact-version trust（[[trust.js]]）互补：trust
  锚版本、diff 锚能力。
- **声明 vs 实际审计** `auditDeclaredCapabilities`：抓「声明了 permissions 但组件超
  出声明」——ship MCP server 却没声明 `mcp`/`network`、ship bin/hooks/lsp（spawn 进
  程）却没声明 `process`、ship monitors 没声明 `monitor`。**接线**：manifest.js
  `parsePluginManifest` 现 normalize `permissions`→`result.capabilities`
  (+`capabilitiesDeclared`) 与 `optionsSchema`→`result.optionsSchema`；**仅当**声明
  了 permissions 才跑审计并把发现推进 `warnings`（未声明的 legacy 插件不受限、零新
  警告，现有 manifest 测试全绿）。
- **typed optionsSchema**（`normalizeOptionsSchema`/`validateOptions`/
  `optionDefaults`/`redactSensitiveOptions`）：每键 `type`(string/number/boolean/
  enum/string[])·`default`·`required`·`enum`·`scope`(user/project/both)·
  `sensitive`；`validateOptions` 强制类型/必填/enum/作用域，并强制**敏感项永不能来
  自项目配置**（`sensitive` 键 scope 归一到 user、project 传入即 error——checked-in
  的项目文件无法夹带密钥，须走 user scope/OS keychain）；`redactSensitiveOptions`
  给日志/审计打码。

**测试**：`plugin-runtime-capabilities.test.js` 33 项（normalize/diff/consent/
audit/optionsSchema/validate 敏感-项目拒绝 + user 放行/redact）+
`plugin-runtime-manifest.test.js` 补 3 项（normalize 上 manifest / legacy 零警告 /
声明缺 mcp 告警）= 39 绿；依赖套 settings/install/signature/scopes/manager 88 项回
归绿。

**仍欠（consent 持久化 + 强制 + UI）**：把 consented capabilities 落进 trust 条目
（或 sibling store），`isPluginTrusted` 旁加 `isPluginCapabilityConsented` 门；
`install.js` `installFromDirectory`/`updatePlugin` 里接 diff→交互重新 consent（现装
非交互）；`discoverPlugins`/各 collector 按声明能力**强制**（如未声明 `network` 的
MCP server 真拦，非仅 warn）；`cc plugin validate`/`add`/`upgrade` 渲染能力清单+diff
（仿现有 dependencyCheck）；把 optionsSchema 敏感项接 settings.js 的 `p.scope` 项目
门 + OS keychain 取值；shell-form 命令插值加固 / 统一 Sandbox Broker /
lockfile-SBOM 属更大基建，未起。

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

### 已落地（增量）

新建纯核 `src/lib/hook-event-bus.cjs`（确定性，`crypto` 仅哈希 delivery id），把
现在「payload 有 `schema_version`+熔断、`runHooks` **按序 first-decision-wins**、无
delivery/trace/parent id、无事件日志/replay/沙箱」升级为统一事件总线的纯逻辑层：

- **统一事件注册表** `HOOK_EVENT_TYPES`：现有 settings-hook 生命周期（PreToolUse/
  PostToolUse/UserPromptSubmit/Session*/Stop/SubagentStart·Stop/ConfigChange/
  PermissionRequest…）**并集** gap 新增（PermissionDenied/TaskCreated·Completed/
  InstructionsLoaded/CwdChanged/WorktreeCreate·Remove/MCPElicitation）；
  `DECISION_EVENTS` 标出可 gate 流程的事件（PreToolUse/UserPromptSubmit/Stop/
  PermissionRequest）。
- **versioned envelope + delivery id**（`buildHookEnvelope`）：每次投递
  `{schema_version, event_type, event_id, trace_id, parent_id, session_id,
  timestamp, data}`；`event_id` = `evt_`+sha256(eventType+session+seq+**key-order
  无关**的 data) 前 16 hex——同输入同 id（可 dedup/replay 寻址）、每次投递靠 seq 唯
  一。**接线**：`settings-hook-events.cjs` 三个 payload 构造点
  （UserPromptSubmit/SessionStart/observe）现 stamp `event_id`（additive，hook 读不
  读都不受影响；2 个 real `node -e` 端到端测试证明 stdin 收到 `evt_…`）。
- **最严格决策合并** `mergeHookDecisions`（并行模型）：`block>ask>allow>continue`
  取最严（现 `runHooks` 是按序遇 block/ask 短路、allow 折成 continue），归一
  deny→block/approve→allow，胜者留 reason+hook 并列出全部 contributor。
- **同 handler 去重** `dedupeHooks`：按 command+shell+matcher 折叠（settings 与
  plugin 供了同一 hook 时一次事件不重复触发），首个胜出保序。
- **replay 沙箱策略** `planHookReplay(envelope,{sandbox})`：observe-only 事件自由
  重放；**decision 事件不显式 `sandbox:true` 即 fail-closed 拒绝**（decision hook 会
  re-gate 流程，裸重放会真的重新 allow/deny）；重放 payload 打 `replay:true` +
  `replay_of`。

**测试**：`hook-event-bus.test.js` 16 项（注册表/decision 判定/envelope 确定性+seq
唯一+key-order 无关/strictest merge/dedupe/replay 沙箱四态）+ `settings-hook-events`
补 2 项端到端 delivery-id = 18 绿；hook-runner/settings-hooks/settings-hook-events
回归 87 项绿。

**仍欠（事件日志 + 命令 + 真沙箱 + 强制并行合并）**：`cc hook replay <event-id>` 命
令 + 可重放的**持久事件日志**（仿哈希链 `appendEvent`，greenfield）；把
`mergeHookDecisions` 真正接进 agent-core 的 PreToolUse/PermissionRequest 合并点（现
为手写 first-wins + 从 results 捞 allow）并让多 hook **并行**跑；`planHookReplay`
需要真沙箱执行器（hook 目前 `shell:true` 继承全 env，无沙箱层）；把新事件类型
（TaskCreated/CwdChanged/Worktree*/InstructionsLoaded/MCPElicitation）**真触发**到
各生命周期点；trace_id/parent_id 从 agent-core context 线程进 envelope；async hook
持久队列 + `allowManagedHooksOnly`（后者已在 settings-hooks.cjs）留待。

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

### 已落地（增量）

新建纯核 `src/lib/json-schema-validate.js`（无依赖，`crypto` 仅算 digest），把现有
只支持 type/properties/required/items/enum/const/additionalProperties:false、报
`$.a.b[0]` 字符串、且不自校验的子集升级为更全的 Draft 2020-12 子集验证器：

- **稳定错误码 + RFC 6901 JSON Pointer**：`validate(value, schema)` 返回
  `{valid, errors:[{code, keyword, instancePath, schemaPath, message}]}`——`code`=
  失败关键字（type/required/enum/minimum/pattern/uniqueItems/anyOf/oneOf/$ref…，
  标准且稳定），`instancePath`/`schemaPath` 均为 JSON Pointer（`/items/0/name`），
  **不再是自由文本**。
- **更全关键字**：新增 minimum/maximum/exclusiveMinimum·Maximum/multipleOf、
  minLength/maxLength/pattern、minItems/maxItems/uniqueItems、minProperties/
  maxProperties、prefixItems(元组)、additionalProperties 的 **schema 形**、
  allOf/anyOf/oneOf/not、以及**本地 `$ref`**（`#/$defs/…`、`#/definitions/…`、任意
  文档内 JSON Pointer，带 128 层递归护栏防环）。
- **启动时校验 schema** `validateSchema`（meta-validation）：拒绝坏 type 值、非数组
  required、非数字的数值关键字、非法正则、非对象 properties 等——**接线**到
  `json-schema-output.js` 的 `loadSchemaFile`：加载 `--json-schema` 文件时先跑
  meta-validation，坏 schema **fail-fast** 报带 schemaPath 的清单，而非静默拿坏契约
  逐条误判。
- **`structured_result` 终局事件**（`buildStructuredResultEvent`/导出的
  `buildStructuredResult`）：`{type:"structured_result", schema_digest:"sha256:…",
  valid, value, errors?}`——`schema_digest` 用 canonical(sorted-key) sha256 让消费方
  可 pin 契约；invalid 时带 coded/pointered errors，**永不退回自由文本**。

**测试**：`json-schema-validate.test.js` 20 项（pointer 转义/digest 确定性+key-order
无关/core+numeric+string+array 约束/prefixItems·tuple/combinators/$ref 解析与未解析/
meta-validation 拒绝各类坏 schema/structured_result 两态）+ `json-schema-output`
补 3 项（loadSchemaFile meta-validation 拒坏 schema + buildStructuredResult 两态）=
40 绿。

**仍欠（接进流协议 + 命令面）**：把 `structured_result` 真正 emit 进
`headless-stream.js`（在 per-turn `result` 事件旁，line ~2028），并**移除
`--json-schema` 与 `stream-json` 的互斥守卫**（agent.js:1089-1094）让二者兼容；
`runJsonSchemaConstrained` 的重试校验切到新验证器（更精确的纠错提示 + JSON Pointer）
并在最终失败时 emit `structured_result{valid:false}` 而非仅 exit 1+stderr；
`--json-schema` 支持 inline JSON（当前只接文件路径）；format(email/uri/date-time)
断言与 if/then/else 留待。

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

### 已落地（增量）

审计确认 LSP 侧 **server crash/backoff（滑窗隔离）与 server 池、空闲自释放**已存
在（`lsp-manager.js` maxRestarts/restartWindowMs + agent-core `_getSharedCodeIntel`
60s idle），`review.js` 已有 `--comment` 的 JSON findings 单遍模型；只补两处真缺口，
两个纯核（无 timer/RNG，可测）：

- **多 Agent Review 聚合管线** `src/lib/review-pipeline.js`：把 review 从单遍升级为
  finder→verifier→deduper→结构化输出的**纯聚合核**——`dedupeFindings`（按
  `path:line:title` 合并，保留最高 severity，跨 finder 时 union
  categories/dimensions/evidence，**对 `{path,line,severity,title,body}` 形状无损**
  以便接线）+ `applyVerdicts`（verifier 复现裁决：refuted 丢弃、reproduced 提置信
  度）+ `filterByConfidence` + `rankFindings`（severity→confidence 排序）+
  `buildReviewReport`（gap 要的 path/line/category/severity/**failure_scenario**/
  evidence + severity/category rollup）。finder/verifier **agent 扇出**是命令层编排
  （仍欠）。**接线**：`review.js` `parseFindings` 现把解析结果过 `dedupeFindings`，
  折叠模型重复报的同一 `path:line:title`（保留高 severity），形状无损、现有测试全绿。
- **LSP 编辑触发自动诊断调度器** `src/lib/lsp/diagnostics-scheduler.js`（纯+时钟注
  入）：`DiagnosticsScheduler` 把编辑流变成节流的诊断运行——**debounce**（连打合并
  成一次，`due(now)` 判定）+ **throttle**（同文件最小运行间隔，被限流仍保 pending
  待窗口过）+ `msUntilNextDue`（睡到最早可运行）；`capDiagnostics` **token 上限**（按
  message 估 token，超预算截断，**先丢最不严重**，保底留 1，接受数字/字符串两种
  severity）。补齐现有单发 `_postEditDiagnostics`（cap 20、无 debounce）缺的调度层。

**测试**：`review-pipeline.test.js` 18 项（severity/confidence/dedup 形状无损+跨维合
并+区分同位不同 issue/verdicts/filter/rank/结构化报告）+ `diagnostics-scheduler.test.js`
13 项（debounce 合并/throttle 保 pending/msUntilNextDue/独立文件/token cap 按严重度
丢弃+数字 severity+保底 1）+ `review-command` 补 1 项 dedup = 32 绿；review-command
既有回归绿。

**仍欠（agent 扇出编排 + 调度器接线）**：`review.js` `runReview` 真正 fan-out 4 个
finder（correctness/security/performance/tests，经 `runAgentHeadless`×N 或
`spawn_sub_agent` + 新 sub-agent-profiles）→ verifier 复现 → 喂 `buildReviewReport`
出结构化报告（`--json`/`--comment` 复用），高 effort 才开多 Agent；
`DiagnosticsScheduler`/`capDiagnostics` 接进 agent-core 的编辑→诊断路径（替
`_postEditDiagnostics` 的裸 cap 20 + 无节流）；LSP 多根 workspace / `/doctor` 检查
（Doctor 段一并做）；backoff 目前是滑窗隔离非指数退避，留待评估。

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
