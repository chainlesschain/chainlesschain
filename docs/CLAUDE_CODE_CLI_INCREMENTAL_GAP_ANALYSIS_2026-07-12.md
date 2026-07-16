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

- **副作用台账 + 崩溃恢复重放（纯核已落地）**：新增
  [`side-effect-ledger.js`](../packages/cli/src/lib/side-effect-ledger.js)——
  每个不可逆动作两阶段记账 `prepare→start→commit|fail|unknown`，`reconcileSideEffects`
  把每个 op 分桶 **redo/inspect/skip**：`committed`→skip、仅 `prepared`→redo（未发出
  副作用）、`started` 未落定的**非幂等** op→**inspect**（可能已生效，禁盲目重放）——
  正是验收要求的「file-write/git-push/package-install 中途强杀，恢复后不重复副作用」。
  幂等性按 kind 默认（外部效果一律 false，`read`/`file-write-checkpointed` 为 true）可
  显式覆盖；时钟经注入保持确定性（无 `Date.now()`）。持久化经
  [`side-effect-ledger-store.js`](../packages/cli/src/lib/side-effect-ledger-store.js)
  落链式 `side_effect_ledger` 事件（继承哈希链，`reconcileSessionSideEffects` 为恢复
  入口）。测试：`side-effect-ledger.test.js` + `side-effect-ledger-store.test.js` 26 项
  （含三类副作用中途强杀的验收）（`75ed4843b7`）。

**已接线（2026-07-13，`e3d75e778e`，副作用台账进 headless 工具循环）**：`SideEffectLedger`
的 `prepare→start→commit|fail` 已接进 headless agent 的工具执行事件——纯核
`classifyToolSideEffect(tool,args)`（fail-closed 分类：file-write 非幂等 / `edit_file_hashed`
幂等 / opaque shell·run_code 非幂等 / 只记 `git push` / publish·schedule·notify·browser_act
网络突变 / 只读工具 null 免刷屏）；headless-runner 在 tool-executing 记 prepare→start 且
**在副作用 settle 之前**持久化快照、tool-result 记 commit/fail；`--resume` 时 reconcile 上一
ledger，对每个 started-未-settle 的非幂等 op 注入 “Recovery notice” 系统消息 + stderr 警告
（`opId = runNonce:seq` 防跨 run 碰撞）。**字节不变默认**：无危险工具 / 非持久化 run → 零
ledger 事件、零注入。这满足了本项验收「file-write/git-push/package-install 中途强杀，恢复后
不重复副作用」——记账 seam 落在 headless-runner 的工具事件层（包住 agent-core 的工具执行），
而非 agent-core 内部。

**仍欠**：状态机的其余持久态（`waiting_permission`/`uncertain_side_effect`
等）需要真实**生产者**——由 daemon/headless 把被阻塞的审批/提问写入
`state.phase` / `pendingApprovals`（消费侧契约已就绪；后台交互 agent 走 daemon-attach
路径而非一次性 headless-runner，故生产点属 daemon 运行时接线）留待。

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

**已接线（2026-07-16，安装入口统一权限类型 + 审计事件）**：补上「npm/pip/winget/brew 等安装
入口的统一权限类型与审计事件」——此前只有 `dependency-install-policy.js` 管 `run_code` 里的 pip
自动安装，`run_shell` 的 `npm install`/`brew install`/… 只是**普通 shell 命令**，没有任何一处认出
「这在下载并运行第三方代码」、也无统一审计。新纯核 `src/lib/install-command-policy.js`：
`classifyInstallSegment`/`classifyInstallCommand`——**20 个包管理器**（npm/pnpm/yarn/bun/pip/pipx/
poetry/conda/brew/winget/choco/apt/dnf/yum/apk/snap/gem/cargo/go/composer/dotnet）的 per-manager 表，
识别安装子命令、抽取包名、判 **global/system 作用域**（`-g`/`--global`/`yarn global`/系统级管理器
恒 global）；复用 shell-policy 的 `splitCommandSegments` 故 `npm i a && pip install b` **两笔都报**；
`unwrapArgv` 剥 `sudo`/`env`/`VAR=` 前缀、`normalizeBin` 剥路径与 `.exe/.cmd`。`resolveInstallPolicy`
（env `CC_INSTALL_AUDIT`/`CC_INSTALL_RISK_FLOOR` 或 settings `installPolicy`，**默认全关**）+
`applyRiskFloor`（只升不降）+ `recordInstallCommandAudit`（注入-fs，写 `~/.chainlesschain/audit/
install-commands.jsonl`，best-effort 永不抛）。**接线**（`shell-approval.js` `evaluateShellCommandWith
Approval`，**非** agent-core）：显式 `installPolicy` 优先，否则**自 env 自激活**——`CC_INSTALL_AUDIT=1`
即让真 `run_shell` 审批路径**无需改 agent-core** 就开始分类+审计；命中安装则把分类挂到结果的
`install` 字段、按 `riskFloor` **在 gate 前**抬高风险（如强制 install 恒过审批门）、记审计。**默认
字节不变**：env/policy 全未设→`install:null`、零 I/O、风险与决策逐字节同旧。测试：
`install-command-policy.test.js` 17（多管理器+global / sudo·env·路径·.cmd / dotnet package-word /
compound 两笔 / 非安装 null / resolveInstallPolicy env-wins·settings·关 / riskFloor 只升 / 审计注入-fs
+失败不抛）+ `shell-approval.test.js` +4（默认无 install 字节不变 / riskFloor 抬高致 strict 拒 /
审计经注入-fs 记 global apt / 非安装不套 floor）= 30 绿；agent-core run-shell approval 6 回归绿。

**已接线（2026-07-16 续，远程脚本执行 `curl … | sh` 检测）**：包管理器只是「下载并运行第三方
代码」的一半；另一半是 `curl -fsSL https://x/install.sh | sh` / `bash -c "$(curl …)"` / `sh <(wget …)`
这类**从网络取脚本直接喂给解释器**的惯用法——它绕过所有包管理器却同样是任意远程代码执行，此前也无
任何一处认出。为 `install-command-policy.js` 增 `classifyRemoteExecCommand`：两条模式——**pipe-to-shell**
（fetcher `curl`/`wget`/`fetch`/`iwr`/`Invoke-WebRequest` 管道进 `sh`/`bash`/`zsh`/`python`/`node`/`ruby`/
`perl`/`php`，允许中间 `sudo`/`env`/`tee`/`cat` 包裹，抽取 URL+解释器）与 **subst-to-shell**（解释器读
`$(…)`/`<(…)` 命令·进程替换里的 fetcher）；`cat script.sh | sh`、`curl -O file.tar`（纯下载不管道进
shell）**不误报**。统一入口 `classifyCodeAcquisition` = install ∪ remote-exec（`flagged`=任一命中），
`shell-approval.js` 改调它、命中即抬 riskFloor + 记审计（审计含 `remoteExec` 明细）。同样**默认字节
不变**（policy 未开→跳过）。测试：`install-command-policy.test.js` +13（classifyRemoteExecCommand
pipe/subst/不误报 + classifyCodeAcquisition install·curl|sh·普通命令）+ `shell-approval.test.js` +1
（`curl|sh` 触发 riskFloor 致 strict 拒）= `install-command-policy.test.js` 30 + `shell-approval.test.js`
+5；三文件 43 绿；agent-core run-shell approval 回归绿。

**仍欠（多为环境/平台阻塞）**：macOS Seatbelt profile；原生 Windows 的 OS 级
边界（WSL2/容器/受限进程）；把 `run_shell`/`run_code`/Hook/Plugin Bin/LSP/
MCP stdio 统一收进 Process Sandbox Broker；Python per-session venv + 版本锁 +
hash 校验；把 install-command 分类接进 `run_code`/Plugin-Bin 安装路径（现覆 `run_shell`）+
default-on（现 opt-in）；凭据代理 default-on + 逐 host 短期凭据注入接到 egress proxy；三平台真集成
测试（子进程链 / symlink·junction / 路径穿越 / 私网·metadata endpoint）。

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

**已落地（2026-07-13，channel 消息显式标注 authority）**：`channel-manager.js` 新增
`channelEventEnvelope(event)`——为每条入站 channel 事件构建**不可伪造**的 authority 信封
（`origin: ORIGIN.CHANNEL` → `authorityForOrigin` 恒得 `steer`、`canApprove` 恒 false、
`describeAuthorityChain` provenance 串）。`origin` 由**事件如何到达**（入站 channel）在此
赋值，绝不从不可信的**消息内容**读取（镜像 agent-authority 契约）。`startChannels` 用
`stampChannelAuthority` 包住 caller 的 `onEvent`——每条事件在到达 agent **之前**就被打上
`authority:"steer"` + `canApprove:false`，caller 无法漏标、消息内容也无法把自己抬过 steer
（webhook/telegram 正文里的 “the user approved” 只是文本）。把此前**仅靠可见文本前缀**隐含的
steer-only 契约变成**机器可校验**（下游审批 seam 可断言 `canApprove===false`）。测试：
`channels.test.js` +2（envelope 恒 steer/never-approve 即便正文含 “approved” / startChannels
包裹每条投递事件带 channel authority 且原字段存活）= 13 绿。

**已接线（2026-07-13，远端审批 seam）**：把 `assertCanApprove` + `describeAuthorityChain`
接进 `remote-session-protocol.js` 的 `approval.resolve` seam——远端 _approve_ 现经**单一
权威规则** `assertCanApprove({origin:remote, authenticated, approve scope})` 前置校验（在
幂等 ledger 之前，故被拒的 approve 绝不消耗 commandId slot），使远端 seam 与本地/headless
审批门共用同一规则、绝不漂移；`describeAuthorityChain` provenance（origin/principal/session/
authority）落 `control.approval` 审计（server-hosted 与 forwarded 两路）。**binding 透传 +
fail-closed 校验**：回显的 `binding` 经 `approval.resolve` → `handleSessionAnswer` →
interaction-adapter `resolveAnswer(requestId, answer, binding)` 贯通；带 binding 发起的请求
若 approve 回显的 binding 不匹配 → 结算为 **DENY**（fail closed），镜像本地 headless 门。向后
兼容：请求无 binding 或答复未回显 binding → 逐字节不变。测试：interaction-adapter +4（binding
随请求外发 / 不匹配→deny / 未回显向后兼容 / 纯 question 不加 binding 字段）+
remote-session-protocol +2（binding 透传到 host 门 / 审计带 authority provenance）+ 既有
approval 测试改为 3 参 `resolveAnswer`。

**已覆盖（2026-07-13 勘误）**：G-relay 加密控制路径（`_handleRemoteEncryptedControl`）**无需单独
接线**——它解密移动端信封后即汇流进 `handleRemoteSessionPublish`（本笔已加固的同一 handler，见
`ws-server.js` L1369），故 `approval.resolve` 走同款 `assertCanApprove` authority 门 +
`describeAuthorityChain` 审计、回显 `binding` 经 `handleSessionAnswer` 同样透传；authority
envelope 的 principal 用已认证的 relay peer（`from`），语义与 server-hosted / forwarded 三路一致。

**仍欠**：把 binding 从**权限门产生端**真正
attach 到 interaction-adapter 请求（现校验就绪但尚无生产者 attach binding，需权限-门-over-WS 接线）；
agent-sdk 的 `ApprovalRequestEvent` 可选加 `binding` 回显（需 bump SDK 版本，留待下次 SDK 发版）；
repo 配置不得开 bypass/auto 与 managed deny 放宽的强制项亦未做（注：permission mode 来自 CLI flag
而非 project settings，故经 settings 的 mode 升级路径本就不存在）。

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

**已接线（2026-07-12 收尾）**：引擎已接进 headless-runner 现有的外层 `while(true)`
循环（与 auto-rewake 并列的新 opt-in re-drive）。新增 flag `--goal-condition <spec>`

- `--max-outer-turns`/`--goal-max-tokens`/`--goal-max-cost`/`--goal-max-time`，spec
  在命令层前置校验。每回合 settle 后（auto-rewake 之后）评估条件：确定性检查内联跑
  （spawnSync/existsSync，`deps.goalCheck` 可注入）；`model:` 条件复用运行模型作独立
  judge（默认 `chatWithTools`+`firstBalancedJson`，`deps.goalConditionJudge` 可覆盖）。
  未满足且预算剩余 → 追加 follow-up user 回合 re-drive；满足 → `goal_completed`；预算
  耗尽 → `goal_exhausted`。四个 `goal_*` 事件经 stream-json 输出，per-turn 用量以增量
  喂引擎（引擎累计 == run 累计）。OPT-IN：未设时外层循环恰跑一次、字节不变。测试：
  `headless-runner.test.js` 新增 5 项（确定性 re-drive 到完成 / max-outer-turns 耗尽 /
  exit-zero 注入 spawnSync / 注入 model judge / 未设时惰性）；cost-budget/stall/
  async-hook(auto-rewake) 回归全绿。

**已落地（跨进程 resume）**：引擎快照现作为哈希链 `goal_snapshot` session 事件持久化
（`persistGoalSnapshot` 每回合 checkpoint），`--resume` 时倒扫最近一条**未完成**快照经
`GoalConditionEngine.fromSnapshot` 续跑——outerTurns/tokens/cost/startedAtMs 全部跨进程
保留（已完成快照忽略，故 `--goal-condition` 起新一轮）；`rebuildMessages` 跳过该事件类型故
不污染模型上下文。见 [`headless-runner.js`](../packages/cli/src/runtime/headless-runner.js)
的 `persistGoalSnapshot`/`restoredSnap` 分支。测试：`headless-runner.test.js` 的
「goal-condition cross-process resume」套（持久化快照 / 续跑未完成目标 / 忽略已完成快照）。

**已落地（2026-07-13，REPL `/goal <condition>` 交互入口）**：REPL 现有会话完成条件——
`/goal <cond>` 设 / `/goal` 查 / `/goal clear` 清；每回合后**评估并报告**：✔ 已达 /
◎ 未达（带 reason + 回合）/ ⛔ 超回合预算丢弃。确定性条件内联跑（contains/regex 判答复文本、
exit-zero/file-exists 经 spawnSync/existsSync）；自然语言条件复用会话模型作独立 judge。
**刻意只报告不 auto re-drive**——交互中人在场逐轮决定是否继续，自主 re-drive 循环留给 headless
（无人看守处）。新纯核 [`repl-goal.js`](../packages/cli/src/lib/repl-goal.js)
（parse/create/render/evaluate，建于已测的 [[goal-condition-engine.js]]），`agent-repl.js`
接线为薄层（state + slash handler + 逐回合评估 + `/help` + 补全）；best-effort，评估失败绝不
扰动回合。测试：`repl-goal.test.js` 14（parse/create/status/verdict/四种确定性/model-judged +
无 judge/回合预算耗尽）；agent-repl 65 绿。

**仍欠**：SDK `AgentSession` 的 `goal_*` 事件转发（需 SDK 版本 bump，留待下次 SDK 发版）。

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

**已接线（2026-07-12 收尾）**：`readStringArraySetting`（settings-loader.cjs，跨
分层 `.claude/settings.json` union + 去重）把 `instructionExcludes` 读出，
headless-runner 与 headless-stream 两个 `composeSystemPrompt` 调用点均已前向透传
（显式 `options.instructionExcludes` 优先，读错 fail-open，默认 null 时行为字节不变）。
测试：`settings-loader.test.js` 新增 5 项（单层/跨层 union/去重/非数组忽略/空数组）。

**已落地（2026-07-12 三轮）**：`cc context --sources`（opt-in）在原按角色分桶的
基础上加**按来源分解**——新纯核 `context-breakdown.js`（`breakdownInstructionSources`
逐 instruction 文件 token 归因 + `rankContextSources` 把 project-memory 总量与消息角色
桶合并成按占比排名的来源列表 + `relativizeInstructionPath`，估算器注入、零 I/O）；
命令层 `--sources` 对当前 cwd 加载 project-instruction 文件（honor 同一
`instructionExcludes`），文本渲染「By source」段（逐 cc.md/CLAUDE.md/规则/@import 文件
的 scope+路径+token）+ JSON 加 `sources`/`instructions`/`instructionTokens`/
`combinedTotal`；**无 flag 时字节不变**。诚实边界：skill/MCP 工具 schema 是运行时工具
定义，不在持久 transcript 也不在 project memory 内，明示不计入。仓库根实测归因真
CLAUDE.md(3033)+截断 CLAUDE.local.md(11150)+4 规则文件。测试 `context-breakdown.test.js`
+10 + `cc-context.test.js` 6/6 不变。commit `afd2f6695b`。

**已落地（子树懒加载纯核）**：子目录指令**按首次访问子树懒加载**的判定核心已建——
[`project-instructions.js`](../packages/cli/src/lib/project-instructions.js) 新增
`resolveSubtreeInstructions`（给一个 tool 刚访问的路径，返回 `baseDir`（启动 cwd，已
加载）与该路径所在目录之间**每一层**的 `cc.md`/`CLAUDE.md`/`AGENTS.md`，shallowest-first、
honor `instructionExcludes`、对已加载文件去重；尚未创建的待写文件回落到其父目录；只对
`baseDir` 的**后代**生效，祖先在启动时已加载）+ `SubtreeInstructionLoader`（跨会话记录已
注入的子树，二次访问同子树 no-op，返回**仅新增**的文件）。纯 + fail-open。测试
`project-instructions-subtree.test.js` 13 项（真临时 monorepo 树）（`70783bdb02`）。

**已落地（2026-07-13，per-directory Skills `paths:` 按需发现 + 接线）**：技能现可声明
`paths:`（别名 `globs:`/`pathScope:`）frontmatter 把自己**按目录作用域化**——只在 agent 于
匹配子树工作时才被 `list_skills` 发现、`run_skill` 允许，避免大仓里无关子树的技能污染按需
技能面。新纯核 [`skill-path-scope.js`](../packages/cli/src/lib/skill-path-scope.js)：
`normalizeSkillPaths(data)`（string/array + 别名 → 非空 glob 数组或 null）+ `relCwdForCwd`
（cwd 相对项目根、正斜杠；根内/根外/缺参 → `""`＝全适用，绝不因定位不到根而藏技能）+
`skillAppliesToCwd`/`filterSkillsByRelCwd`——匹配语义**复用** `project-instructions.js` 已有的
`ruleApplies`（与路径作用域 `.claude/rules` 同一 prefix-overlap 规则，DRY）。`skill-loader.js`
`_collectSkills` 现把 `data.paths` 归一后挂到每个技能对象的 `paths` 字段（null=处处适用）。
**接线**：agent-core.js 新增 best-effort `filterSkillsByCwd(skills, cwd)`（经 project-detector
`findProjectRoot` 定位根 + 纯核过滤），接进 `list_skills`/`run_skill` 两个 handler 的
`skillAllowed` 之后。**默认字节不变**：无 `paths` 的技能处处适用（现存全部技能不受影响，
121 项技能回归绿）；fail-open——定位不到根/出错即返回全集，绝不误藏。测试：
`skill-path-scope.test.js` 8（normalize 全形态含 parseSkillMd 提取 / relCwd 根内外 / 作用域
命中兄弟不命中 / filter 保无作用域+在域丢出域）+ `agent-core-skill-path-scope.test.js` 3
（e2e：list_skills 出域丢弃 / 入域保留 / run_skill 出域按名解析不到）= 11 绿。未改 agent-core 导出。

**已落地（2026-07-13，`worktree.sparsePaths` sparse-checkout + `symlinkDirectories`
逃逸防护）**：补上静态检索确认缺失的两件——`createWorktree` 新增可选 `options`
参数（第四位、默认 `{}`，向后兼容全部现有 positional caller）：

- **`sparsePaths`**：新纯核 [`worktree-sparse.js`](../packages/cli/src/lib/worktree-sparse.js)
  的 `normalizeSparsePaths`（backslash→slash、trim、去重、排序，**保留 leading `/`
  故绝对路径被安全检查拒**而非静默重解释为 repo-relative）产出安全 include 列表后，
  `createWorktree` 跑 `git sparse-checkout set <paths…>`（`gitExecArgs` 无 shell），只
  materialize 任务需要的包——大仓里裁掉无关子树的 checkout 时间与磁盘。空/缺省→全量
  checkout，**字节不变**于原路径。
- **`symlinkDirectories`**：`planSymlinkDirectories`（纯，**fail-closed**）对每个显式
  批准的依赖目录（如 `node_modules`）做**双重防护**——词法安全（复用 `assertSafeGitPath`
  同款拒 `..`/绝对/flag 规则）+ **解析后 containment**（`isContainedPath`：source 必在
  `repoDir` 内、dest 必在 worktreePath 内，用 resolve+带分隔符前缀比较防 `/repo-evil`
  混淆），任一 junction/symlink 逃逸即**抛错不静默跳过**。通过后 `createWorktree` 用
  `symlinkSync(source, dest, "junction"|"dir")`（Windows junction 免管理员）把主 checkout
  的依赖目录链进 worktree，任务无需重装；approved-but-absent 的源目录跳过不报错。
  - 测试：`worktree-sparse.test.js` 11（isSafeRelPath 各拒项 / normalize 归一去重排序 /
    isContainedPath 兄弟·逃逸 / plan 双重防护 + 逃逸 fail-closed + dedupe）+
    `worktree-isolator.test.js` +5（**真 git**：sparse 只出请求包·excluded 缺席 / 无
    sparsePaths→全量 / 真 symlink 读穿到主 checkout 依赖 / absent 源跳过 / `../outside`
    逃逸抛错）= 16 绿；worktree 消费方 team-worktree/agent-worktree 回归 26 绿。

**已接线（2026-07-13，team 路径透传 sparsePaths/symlinkDirectories）**：把上面的能力从
任务定义**透传**进 `TeamWorktreeCoordinator`——coordinator 构造接受 team-wide 默认
`{sparsePaths, symlinkDirectories}`，`makeRunTask` 里新纯函数 `resolveWorktreeOptions(task,
defaults)` 让**每任务** `task.sparsePaths`/`task.metadata.sparsePaths` 覆盖 team 默认（经
`normalizeSparsePaths` 过滤不安全路径），解析出的 options 作第四参喂 `createWorktree`；无
配置→传 `undefined`→createWorktree 走全量 checkout **字节不变**。命令面 `cc team run` 新增
`--sparse-paths <逗号列表>`/`--symlink-dirs <逗号列表>`（配 `--worktree`），一次给整个 team
run 指定只 checkout 的包 + 复用的依赖目录。测试：`team-worktree.test.js` +4（默认无 options /
team 默认应用 / 每任务覆盖 team 默认 / 全不安全路径→无 options）= 14 绿；team-command-io +
real-git 回归 6 绿。

**已接线（2026-07-16，additional roots 变更发 MCP `roots/list_changed`）**：MCP 客户端**早已**
实现 `setRoots(dirs)` + `notifyRootsListChanged()`（`harness/mcp-client.js`，Claude-Code 2.1.203：
roots 是**客户端**能力，服务器发 `roots/list` 请求并订阅 `notifications/roots/list_changed`），
`/cd` 也早已在 chdir 后广播——**缺的是 `/add-dir` 与启动 `--add-dir` 这个真正改变根**列表**的
向量**：加了一个新根后从不告知已连服务器，它们的 `roots/list` 永远只见 cwd。新纯核（
[`add-dir.js`](../packages/cli/src/repl/add-dir.js)）：`workspaceRootDirs(cwd, extraRoots)`（cwd
优先 + 解析绝对 + 去重的完整根列表，镜像系统提示所广告的根）+ `notifyMcpRootsChanged(clients,
dirs)`（best-effort 对每个**去重、非空、带 `setRoots`** 的客户端调 `setRoots(dirs)`——它只在列表
**真变**时才发 `roots/list_changed`；一个客户端抛错绝不阻断其余，返回已通知数）。**接线**（均在
`agent-repl.js`，**非** agent-core）：`/add-dir` 成功加根后对 `[_adhocMcp?.mcpClient,
_bundleMcpClient]` 广播新根列表；会话若以 `--add-dir` 启动，两个 MCP 客户端就绪后**seed 一次**
（否则首次 `/add-dir` 前启动根不被广告）。**默认字节不变**：无额外根→seed 是 no-op；`setRoots`
只在变更时发通知。测试：`add-dir.test.js` +7（`workspaceRootDirs` cwd 优先·去重·空 / `notifyMcp
RootsChanged` 多客户端计数·跳过 null·重复·无 setRoots·一个抛错不阻断·空/非数组返 0）= 16 绿；
agent-repl 50 回归绿。

**仍欠**：把 `SubtreeInstructionLoader.onAccess` 接进 agent-core 的 read/edit 工具执行路径
做 **tool-time 注入**（属 agent-core 接线）；**subagent** worktree spawn 路径的
sparsePaths/symlinkDirectories 透传（team 路径已接；subagent-worktree 创建在 agent-core /
sub-agent-context，属 agent-core 接线）；headless（`cc agent -p --add-dir`）的启动根 seed（headless
MCP 客户端构造在 runtime 层，属该路径接线）；`/context` 的 skill/MCP schema 来源归因（需运行时
加载技能/MCP 注册表，非持久会话可得）留待。

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

**已落地（2026-07-12 四轮）**：调度**过期退休 end-to-end**（daemon runtime 的一块）——
`agent-schedule-store.js` 的三个 create（scheduleWakeup/createCron/createMonitor）现接受
并存储归一化 `expiresAt`（正 epoch-ms 否则 null）；新 `retireExpired(atMs)` 用
schedule-planner 的 `isEntryExpired` 把过期的可调度条目跨 kind 标 `status:"expired"`
（盖 `expiredAt`）并返回退休列表；`due()` 加防御性过期跳过——过期条目即便未退休也绝不
再 fire。`cc agenda run` 在 fire due 之前先退休过期（dry-run 用 `partitionSchedule`
只读探查不改动）并在 JSON/文本报 `retired`；`list` 显示 `expires <ISO>` 与 expired 徽章。
测试 store +4 / agenda +3（退休先于 fire、退休过期同时 fire 存活、dry-run 不改动、
幂等）= 40/40；agent-core schedule-tool caller 8/8 向后兼容。commit `4556add29e`。
**注**：agent `schedule` 工具透传 `expiresAt` 的 1 行改在 `agent-core.js`（并行 session
占用）故本轮 defer；`jitterMs` 目前是 planner 的**全局**入参而非 per-entry，per-entry
jitter 留待。

**已落地（2026-07-13，per-entry jitterMs）**：把 jitter 从 planner 的**全局**入参下沉为
**每条目属性**——`agent-schedule-store.js` 三个 create（scheduleWakeup/createCron/
createMonitor）现接受并存储归一化 `jitterMs`（非负整数否则 0）；schedule-planner 新增
`resolveEntryJitterMs(entry, global)`：**per-entry `entry.jitterMs` 权威、盖过传入的全局
fallback**，无该字段的 legacy 条目仍回落全局，`effectiveFireAt`/`partitionSchedule`/
`nextWakeupAt` 全部据此解析。`store.due()` 改用 `effectiveFireAt(entry)` 比较——一条 cron
可自带 spread 错峰而不扰动其余；`jitterMs:0`（默认）→ 基准 fire 时间**逐字节不变**于原
`dueAt`/`nextAt` 比较。测试：schedule-planner +1（per-entry 盖全局 / 0 禁用 / legacy 回落）

- agent-schedule-store +3（三 kind 归一化存储 / due 按 per-entry offset 推迟 / jitterMs:0
  即时 fire）；scheduler 套 73/73 + agent-core schedule-tool caller 8/8 回归绿。**注**：agent
  `schedule` 工具透传 `jitterMs`（连同 `expiresAt`）随即由下一笔（见下方 `b9ad1a1538`）
  接进 `agent-core.js`，故 agent 现在也能经工具供给 jitter，不再仅限直接 store API。

**已落地（2026-07-13 收尾，agent `schedule` 工具透传 `expires`/`jitter`）**：补上前两笔的
`agent-core.js` 接线缺口——`schedule` 工具现把 `args.expires`/`args.jitter`（duration 串）
经 `parseDuration` 解析后透传给 wakeup/cron/monitor 三 create；store 三 create 新增相对
`expiresInMs` 选项（经 `resolveExpiresAt` 锚定 `_now()`，与 `delayMs` 对称、注入时钟下确定
性；显式绝对 `expiresAt` 恒胜）；共享工具 contract descriptor（`coding-agent-contract-shared.cjs`）
新增 `expires`/`jitter` 两 optional 属性文档（tool 数不变、contract 测试不 snapshot 该 schema
故安全）。至此过期条目经工具即可自动退休、共享同一计划的任务经工具即可错峰，无需直接
store API。测试：schedule-store +2（相对 expiresInMs 三 kind 解析 / 绝对胜过相对+非法→null）

- schedule 工具 +2（expires/jitter 透传进持久条目 / 缺省 null·0），scheduler 60 + agenda/
  contract 32 绿。commit `b9ad1a1538`。

**已落地（2026-07-13 六轮）**：(a) `cc agenda prune`（`--older-than <秒>`/`--json`）——
store 新 `pruneTerminal({before})` + 导出 `TERMINAL_STATUSES`，把 fired/matched/
exhausted/expired 且终止时间戳 ≤ before 的条目跨 kind 清除（防 append-only JSONL 无界
增长，配 retireExpired 成 reclaim 对；子命令不改顶层命令数）。commit `49c23ca68e`。
(b) **Monitor 文件源**（"Monitor 扩到文件变化"首项）——`createMonitor` 接受 `watchFile`
（与 `command` 互斥、恰一）并标 `source:"command"|"file"`；`cc agenda run` 经可注入
`readWatchedFile` 读文件：有 `stopWhen` 匹配内容、无 pattern 则**文件出现**即触发（哨兵
文件用例），不再每 tick spawn shell；command 监视器字节兼容。commit `98124b255f`。
两笔测试各 store+agenda 共 +14（prune 7 / file-monitor 7），scheduler 套 62/62 全绿。

**已落地（2026-07-13 续，两笔 Monitor 源扩展）**：(c) **Monitor HTTP 源**（"Monitor 扩
到…HTTP"）——`createMonitor` 现是三向互斥源 `command`/`watchFile`/`watchUrl`（恰一，
`source:"http"`），创建期校验 http(s) 协议 + URL 合法性（拒 `file://` 等）；`cc agenda
run` 经可注入 `fetchUrl`（默认 global fetch，30s 超时，失败不报错只 re-arm）GET 端点：
有 `stopWhen` 匹配响应体、无 pattern 则 **2xx 即触发**（"等服务起来"用例）；`list` 显示
`url <watchUrl>`。commit `5d45d684bf`。(d) **文件源真·mtime 变化检测**——`createMonitor`
加 `watchChange`（文件专属、与 `stopWhen` 互斥），entry 带 `lastMtimeMs` 基线；
`recordMonitorCheck` 接受 `mtimeMs` **仅首次**落基线且此后固定（"自开始监视以来变化"
语义）；`readWatchedFile` 默认经 `statSync` 返回 `mtimeMs`，文件分支在 `watchChange` 下比
基线，mtime 前进即触发、首检只建基线。commit `7c6d365682`。两笔测试各 store+agenda 共
+15（http 7 / mtime 8），scheduler 套 70/70 全绿。

**已落地（2026-07-13 收尾，每个定时任务独立权限模式·Worktree·预算）**：补上"每个定时/
事件任务独立预算·权限模式·Worktree"——wakeup/cron 条目现可携带**每任务执行策略** `runPolicy`
（`agent-schedule-store.js` 新 `normalizeRunPolicy`，单一真源 `SUBAGENT_PERMISSION_MODES`
校验）：`permissionMode`（非法即丢）/ `worktree`（严格 true 才加）/ `maxTurns`（正整数、
floored）。`cc agenda run` 的 `defaultSpawnAgent(prompt, policy)` 经新纯核 `buildAgentArgs`
把它们译成**真** `cc agent` flag：`--permission-mode <mode>` / `--worktree` / `--max-turns
<n>`——一个定时任务因此可用自己的权限模式（如 `plan` 出只读报告）、worktree 隔离、回合预算
运行，而非继承 `cc agenda run` 所处的环境。**默认字节不变**：无策略→`runPolicy` 键整个省略
→spawn 恰为 `cc agent -p <prompt>`（monitor 跑 shell 命令不 spawn agent，故永不带策略）。
`schedule` 工具经 `permission_mode`/`worktree`/`max_turns` 三 optional 参数透传（共享 contract
descriptor 加三属性文档，非法 mode 丢弃后无余项→省略）；`cc agenda list` 加 `· <mode>,
worktree, ≤N turns` 策略摘要。**最大存活期** = 已落的 `expiresAt`（本笔不重复）。测试：
`agent-schedule-store.test.js` +3（normalizeRunPolicy 校验/丢弃、wakeup·cron 存策略+JSONL
round-trip、monitor 不带、unset 省键）+ `agenda-command.test.js` +2（buildAgentArgs flag 映射、
fired 条目 runPolicy 透传 spawnAgent）+ `agent-core-schedule-notify.test.js` +2（工具三参透传、
非法 mode 丢弃+unset 省键）；scheduler+agenda+schedule-tool 套 77+15 全绿。未改 agent-core 导出。

**已落地（2026-07-13 续，per-task token/cost/time 预算 via goal-condition）**：补上前笔仍欠的
per-task **token/cost/time** 预算——`runPolicy` 现可携带 `goalCondition`（经 `parseGoalCondition`
schedule-**创建期**校验，非法 spec 连同其预算整组丢弃，doomed 条件永不入库）+ 每任务
`goalMaxTokens`/`goalMaxCost`/`goalMaxTime`/`maxOuterTurns`。`buildAgentArgs` 译成真 `cc agent`
flag：`--goal-condition <spec>` + `--goal-max-tokens`/`--goal-max-cost`/`--goal-max-time`/
`--max-outer-turns`——一个定时任务因此可**跑到完成条件**（如 `exit-zero: npm test` 每夜重驱动到
测试全绿）并带自己的 token/cost/time/回合预算，复用已落的 goal-condition 引擎。`schedule` 工具
经 `goal_condition`/`max_outer_turns`/`goal_max_*` 透传（contract descriptor 加 5 属性）；无
goal-condition→零 goal flag；预算无有效条件即无意义故只在条件解析成功时保留；`cc agenda list`
加 `goal: <spec>` 摘要。create 方法改为把**整个 options 对象**喂 `normalizeRunPolicy`（只读它认识
的字段），后续策略字段零签名改动。**默认仍字节不变**。测试：store +3（goal 全字段保留 / 非法
spec 整组丢弃+非 goal 字段存活 / cron round-trip）+ agenda +1（buildAgentArgs goal flag，无
condition→零 flag）+ schedule-tool +1（goal_condition 透传）= 82 绿。未改 agent-core 导出。

**已落地（2026-07-13 续，Monitor 事件投递守卫纯核）**：新增纯逻辑模块
[`monitor-event.js`](../packages/cli/src/lib/monitor-event.js)，把「事件加
`event_id`/去重窗口/backpressure/大小上限/authority」里的五件全部实现为可单测、零运行时
接线的核：

- **event_id**：`monitorEventId(monitorId, payload)` 用 sha256 对 monitor id +
  **key-order 无关**的稳定序列化观测求值（无 RNG）——同一观测跨 daemon 重启哈希不变，
  可被去重识别为重复而非重新 fire。
- **去重窗口**：`DedupWindow`（时间 `windowMs` + 计数 `maxEntries` 双界）——`shouldEmit`
  对窗口内已见 id 返回 false，故每轮都匹配的 monitor 只 fire 一次相同事件；按龄 + 按数
  双向淘汰，内存有界。
- **backpressure**：`BoundedEventQueue`（`maxSize` + `dropPolicy: oldest|newest`）——
  满时**丢弃并计数**而非无限增长，丢失可观测（可审计）而非静默。
- **大小上限**：`capEventPayload(payload, maxBytes)`（默认 64 KiB）——超限载荷按 UTF-8
  字节截断（不切多字节码点）并打 `truncated` 标，防跑飞的命令输出撑爆 turn / 审计日志。
- **authority**：`monitorEventEnvelope` 把 monitor firing 标成 `ORIGIN.SYSTEM` 事件——
  上限 `steer`、`canApprove:false`（复用 [[agent-authority.js]]，与 channel/hook 同一天花板），
  `origin` 由「什么产生了事件」决定，绝不读事件内容。测试：`monitor-event.test.js` 24
  （event_id 确定性/key-order/变更敏感 + 截断不切码点/零上限/默认预算 + 信封 SYSTEM→steer→
  !canApprove + 去重窗口时间·计数淘汰 + 有界队列 oldest/newest 丢弃计数）。纯核尚未接进
  monitor firing seam（daemon runtime / `cc agenda run`），故默认路径零影响。

**已接线（2026-07-13，monitor firing seam 事件信封 + 审计）**：把 [[monitor-event.js]] 接进
`cc agenda run` 的**真** monitor firing seam（`commands/agenda.js` monitor 分支）——每次 match
现经 `monitorEventEnvelope(entry.id, {what,output}, {at,source})` 打上三件可用不变量：
（i）**确定性 event_id**（`ev_<24hex>`，RNG-free 审计身份，供跨系统关联/未来去重）；
（ii）**SYSTEM authority 信封**（`authority:"steer"`、`canApprove:false`——一次 monitor firing
**永远**答不了权限门，与已落的 channel 信封同款、机器可校验）；（iii）**字节安全大小上限**——
通知正文从按**字符**截断的 `truncate(output,500)` 换成 `capEventPayload(output,500).value`
（UTF-8 不切码点）。**审计记录**：`recordMonitorCheck` 新增 `eventId`/`authority` 入参，match
时把 `lastEventId`/`lastEventAt`/`lastAuthority` 持久到 monitor 条目（`cc agenda list --json`
可见；未供 id 的 legacy caller 逐字节不变），JSON action 增 `event_id`/`authority`（+`truncated`）。
**记录先于通知**：`recordMonitorCheck`（含 event_id 审计）在 `notify` 副作用**之前**落，故投递
失败也不丢 match 记录（notify 包 try/catch，失败仅在 action 记 `notifyError`、run 不判失败）。
**去重守卫**：`entry.lastEventId===envelope.event_id` → action `duplicate` 且**不重复通知**（当前
terminal-on-match 模型下罕触，为常驻 daemon re-observation 前瞻，经注入 store 单测覆盖）。测试：
`agenda-command.test.js` +4（event_id+steer 审计持久 / 注入-store 命中 duplicate 不通知 /
notify 失败仍 matched+notifyError / 多字节正文字节封顶不切码点）+ `agent-schedule-store.test.js`
+2（match 存 event_id/authority/at 审计 / legacy 无 id 与非 match 均不 stamp）= scheduler 五文件套
128 绿（agenda/store/monitor-event/schedule-planner/schedule-notify）。

**仍欠（daemon 事件运行时闭环）**：把 daemon 变成常驻 Event Runtime——用
`msUntilNextWakeup` 驱动睡眠、`partitionSchedule` fire due（退休已接；agent 工具的
`expires`/`jitter`/`permission_mode`/`worktree`/`max_turns`/`goal_condition`+预算 透传亦已接）；
Monitor 再扩到 WebSocket/SSE/入站 HTTP webhook（服务端接收，区别于已落的 HTTP **轮询**源）/
MCP event；**Monitor 事件的 `event_id`/大小上限/authority + 审计已接进 firing seam**（见上），
`DedupWindow`/`BoundedEventQueue` backpressure 两件是常驻**轮询**循环所需，`cc agenda run`
一次性 + terminal-on-match 模型下暂不适用，随常驻 daemon Event Runtime 一并接（
**per-task 预算/权限模式/Worktree/最大存活期全部已落**）；Channel pairing/allowlist 与
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

**已接线（2026-07-12 收尾）**：`_executeSpawnSubAgent` 现在**真正调用**
`resolveSubagentContract`（spawnArgs > agent-file `md.contract` > 父 ceiling
`ctx.subAgentContract`），并消费安全的 tighten-only 字段：

- **effective contract 透传**——child 的有效契约经 `SubAgentContext.subAgentContract`
  → loop options 成为**其自身嵌套 spawn 的 ceiling**（跨深度 tighten-only 生效）。
- **isolation fail-closed**——`isolation:worktree` 但 cwd 非 git repo 时
  `resolveIsolationFailClosed` 拒绝 spawn；并**修掉 sub-agent-context.js line ~180
  的 fail-open**（静默回落主 checkout → 返回 fail-closed 失败结果；`WORKTREE_ISOLATION`
  默认 false 故只影响显式 opt-in，无测试依赖该回落）。
- **递归 tighten**——`enforceRecursionLimits`（父契约 maxDepth/maxChildren 只降硬上限，
  在 breadth 计数自增前评估）。
- **budget.tokens → 子 tokenBudget**；**effort → 子 LLM options**（compute hint）；
  显式 **`context:fresh`** 抑制父上下文自动浓缩继承（fork/未设不变）。
- **skills capability INTERSECT**（2026-07-12 二轮收尾）——resolved `skills` allow-list
  真正喂进子 `agentLoop`：`run_skill`/`list_skills` 按 `skillAllowlist`（id/dirName）
  过滤（null=不限 / []=无 / 列表=仅这些），`run_skill` 拒跑白名单外技能（真强制非装饰）；
  经 `toolContext`→`executeTool`→`executeToolInner` 贯通，`SubAgentContext.skillAllowlist`
  转发进子 loop，嵌套 spawn 经 effective-contract 链跨深度 INTERSECT。**安全**：
  `_executeSpawnSubAgent` 仅当**显式驱动**（显式 `skills` 列表或显式 `context` 模式）才置
  allow-list——全默认 spawn 保持 null（不限），故 silent-`fresh`→[] 默认永不剥光全部技能。
- 测试：`sub-agent-context.test.js` +3（fail-closed worktree / subAgentContract 存储与
  默认）+ `sub-agent-isolation.test.js` +1（executeTool 层 fail-closed 拒绝）+
  `agent-core-skill-mcp.test.js` +4（allow-list 限制/空表 restricted/run_skill 拒外允内/
  默认不限）；全 subagent + skill-mcp + runtime-convergence shim parity 回归绿。未改
  agent-core 导出（shim parity）。

- **mcp/hooks capability 继承 + INTERSECT**（2026-07-12 三轮收尾）——spawn 路径现在把
  父 loop 的**活** MCP plumbing（`mcpClient`/`externalToolDescriptors`/`externalToolExecutors`/
  `extraToolDefinitions`）与 `settingsHooks` 按契约的 `mcpServers`/`hooks` allow-list 过滤后
  传给子。新纯核 `subagent-inheritance.js`（`filterInheritedMcp` 按 `mcp__<server>__<tool>`
  的 server 段过滤、`filterInheritedHooks` 按 group 的 `matcher` 过滤，null=全 / []=无 /
  列表=子集）。**默认字节不变**：silent-`fresh`→契约 `mcpServers=[]`/`hooks=[]`→过滤返回
  null→spawn 什么都不传，plain sub-agent 与旧行为逐字节一致；`context:fork`→null→继承全部；
  显式 `mcpServers`/`hooks` 列表→INTERSECT 父上限后子集继承。经 `toolContext`→`executeTool`
  →`executeToolInner`→`_executeSpawnSubAgent`→`SubAgentContext.create` 贯通，子 loop 的
  `_runCore` 已把这些 forward 进 `agentLoop` options。嵌套 spawn 经 effective-contract 链跨
  深度 INTERSECT。测试 +19：`subagent-inheritance.test.js` +14（server/matcher 提取 + null/
  []/列表三态 + 无匹配返 null + 缺 serverName 回退 wire 名）+ `sub-agent-isolation.test.js`
  +5（默认不继承 / fork 继承全部 MCP+hooks / 显式 mcpServers 子集 / 显式 hooks matcher 子集）；
  全 subagent + runtime-convergence shim parity 回归绿。未改 agent-core 导出（shim parity）。
- **memory capability 继承 + INTERSECT**（2026-07-12 四轮收尾）——`memory` 不是工具而是
  `CLIContextEngineering` 的分层记忆召回（`this.db && userQuery`→`recallMemory`）。spawn 现在
  仅当 resolved 契约 `memory === true`（显式 `memory:true`，或 `context:fork` 且父上限契约
  已授记忆）才把父 loop 的记忆 DB（`ctx.memoryDb`/`permanentMemory`，从本 loop 的
  `contextEngine.db` 取）传给子；子的 `CLIContextEngineering` 用**子 taskId 作命名空间**隔离召回。
  **默认字节不变**：silent-`fresh`→`memory:false`→不传 db + `memoryEnabled:false`→零召回=旧行为。
  `effectiveContract.memory` 已是 tighten-only 交集结果（父拒记忆则下游永不再授）。**双侧闸**：
  新增 `CLIContextEngineering` 的 `memoryEnabled` 选项（默认 true），false 时即便 db 在场也硬压
  召回块（防御纵深，非仅靠 spawn 不传 db）。经 `toolContext`（`memoryDb`/`permanentMemory`）→
  `executeTool`→`executeToolInner`→`_executeSpawnSubAgent`→`SubAgentContext.create`
  （`memoryEnabled` + 条件 `db`）贯通。测试 +6：`cli-context-engineering.test.js` +2
  （memoryEnabled:false 硬压召回 / 默认 true 召回）+ `sub-agent-isolation.test.js` +4（默认拒 /
  显式 memory:true 授父 db / memory:true 但父无 db 仍拒 / 顶层 fork 不擅授）。未改 agent-core 导出。
- **permissionMode 强制进子门**（2026-07-12 五轮收尾）——`plan` 模式的子被夹到只读工具集
  （`read_file`/`search_files`/`list_dir`/`list_skills`/`search_sessions`），与主 loop 完全同一
  规则：复用 `resolvePermissionMode`+`resolveEnabledTools`（单源零漂移），plan-mode 子物理上
  无法 write/exec。`tightenPermissionMode` 已阻止子**超过**父模式；本笔强制其**限制端**（plan→
  零 mutation），且 deny-list 与只读夹在 spawn 内组合（先减 deny 再交只读）。非 plan 模式工具集
  不动→全默认 spawn（→"default"）逐字节不变。best-effort try/catch 永不因强制而破坏 spawn。
  测试 +4（`sub-agent-isolation.test.js`：默认不夹 / plan 夹到只读 / plan+显式列表取交 /
  非 plan(manual) 不夹保留写工具）。未改 agent-core 导出（shim parity）。
- **非 plan confirmer 线程化 + 运行模式作子上限**（2026-07-12 六轮收尾）——把 resolved 模式的
  **非交互 confirmer** 作为子的 `permissionConfirm`（治 ask / 敏感文件写 / 破坏性 git 三门），
  **仅当**它是 autopilot（`bypassPermissions`）的**放行** confirmer 才线程化；其余模式的无头子本就
  隐式拒（无 confirmer），故不设以保持逐字节不变——**关键**保住并行只读快路径与 IDE-diff 分支
  （二者都以「是否存在 permissionConfirm」为闸）。`SubAgentContext` 存 `_permissionConfirm` 并转发进
  子 `agentLoop`。**可达性**：bypass 唯有当子上限契约=bypass 才解析得到（tighten-only），故
  headless-runner 的 loopOptions 现播种 `subAgentContract:{permissionMode: 运行模式}` 作子上限——
  `--permission-mode bypassPermissions` 的运行可把 bypass 交给子（→放行 confirmer），`default` 运行
  解析子仍为 "default"（逐字节不变，原 null 上限也得 "default"）。测试 +6（`sub-agent-isolation`：
  默认不线程 / manual 不线程 / bypass 上限→子得放行 confirmer 且 `()`==true / default 上限下子请求
  bypass 被夹→不线程；`headless-runner`：运行模式播种进 ceiling / 缺省播 "default"）。未改 agent-core
  导出（shim parity）。
- **agent-repl 运行模式播种子上限**（2026-07-13 七轮收尾）——补齐上一笔只做了 headless 的缺口：
  交互 REPL 现也把**当前会话审批档**作子上限。REPL 只跟踪 `_sessionTier`（tier 词表 strict/trusted/
  autopilot/auto/dontAsk，可由 `--permission-mode` 启动 + `/permissions`/Shift+Tab 中途改），与
  permission-mode 词表不同，故新增纯核 `permissionModeForTier`（permission-tier.js）反向映射：
  autopilot→`bypassPermissions`（**放行端精确**，是让 bypass 会话把放行 confirmer 交给子的关键）、
  trusted→`acceptEdits`、auto/dontAsk 原样、strict/未知→`default`（限制端有损但对子解析等价）。REPL
  的 `agentLoop` options 现加 `subAgentContract:{permissionMode: permissionModeForTier(_sessionTier)}`，
  每轮读 `_sessionTier` 故中途改档即时生效；本地 `agentLoop` 包装器 `...options` 透传进 `coreAgentLoop`
  →toolContext.subAgentContract→spawn 上限。strict 会话→子 "default" 逐字节不变。测试 +4
  （`permission-tier.test.js`：autopilot→bypass 精确 / trusted→acceptEdits + auto/dontAsk 透传 /
  strict+未知→default / 五个 tier 全 round-trip 到合法 SUBAGENT_PERMISSION_MODES）。未改 agent-core 导出。
- **ApprovalGate sessionPolicy 进子门**（2026-07-13 八轮收尾）——补齐 `run_shell`/`browser_act` 的
  会话策略强制。原共享单例 gate 的 confirmer 是**全局**的（转发给无头子会触发父的交互 confirmer），
  故改**给子建专属、无 confirmer 的 ApprovalGate**（`new ApprovalGate({defaultPolicy: perm.sessionPolicy})`
  from `@chainlesschain/session-core`），零干扰父单例。`decide()` 仅在 base=CONFIRM 时问 confirmer——
  无 confirmer 则自动 DENY（无头正确）：strict 拒 MED/HIGH、trusted 仅拒 HIGH、autopilot 全放。
  `perm.sessionPolicy`（已算）即 tier。**仅当** permissionMode 被显式驱动（spawn/agent-file 显式，或
  运行上限非 "default"）**且** tier≠autopilot 才挂——纯默认 spawn 不挂门=逐字节不变（旧=无门=放行），
  autopilot 挂门是纯 no-op 故跳过。`SubAgentContext` 存 `_approvalGate` 并转发进子 `agentLoop`。⚠️
  `run_code` 门在 `interactiveApproval` 之后（子恒 false）故本笔只覆 run_shell/browser_act。测试 +5
  （`sub-agent-isolation.test.js`：默认不挂 / "default" 上限不挂 / 显式 manual→strict 门+HIGH·MED 拒
  LOW 放 / acceptEdits 上限→trusted 门+HIGH 拒 MED 放 / autopilot 不挂）。未改 agent-core 导出（shim parity）。
- **run_code 会话策略进子门**（2026-07-13 九轮收尾）——补齐上一笔的 `run_code` 独立缺口。原 run_code
  门在 `interactiveApproval`（子恒 false）之后故子里不 gate；run_code 执行任意代码比 run_shell 更强，
  strict/trusted 子里放行=洞。**零管道**修法：子拿到的专属 gate 是**无 confirmer** 的，据此判定——
  `policyGateNoConfirmer = approvalGate && typeof hasConfirmer==="function" && !hasConfirmer()` 唯一
  标识子的专属 gate（主 headless + REPL 的 gate **恒有** confirmer），run_code 门条件改为
  `(interactiveApproval || policyGateNoConfirmer)`。子的无 confirmer gate → decide HIGH → CONFIRM →
  no-confirmer → DENY，与 run_shell/browser_act 一致。主 headless/REPL 有 confirmer 故 `!hasConfirmer()`
  false → 逐字节不变（现存 gate stub 无 hasConfirmer 方法 → `typeof==="function"` false → 也不变）。
  测试 +3（`agent-core-run-code-gate.test.js`：无 confirmer gate 非交互也 gate 且 DENY / 有 confirmer gate
  非交互不 gate 逐字节 / 无 confirmer gate ALLOW 则放行）+ sub-agent-isolation 加 `hasConfirmer()===false`
  断言。未改 agent-core 导出（shim parity）。

**已落地（2026-07-13 续，精确取消单个 Subagent）**：`SubAgentContext` 现内建一个自有
`AbortController`（独立于可选的外部 `options.signal`），新增 `isAborted()`（外部 signal **或**
内部 controller 任一 aborted 即真）与 `abort(reason)`（仅在 `status==="active"` 且未 abort 时生效，
记录首个 `_cancelReason`，重复调用 no-op 返回 false）。ReAct 循环的中断检查从只看外部 signal 改为
`if (this.isAborted())` → `forceComplete(this._cancelReason || "cancelled", ...)`，故自有 abort 与
父级 signal 走同一收敛路径。`SubAgentRegistry` 新增 `cancel(id, reason)`：查 `_active`，未命中
`{found:false,cancelled:false}`；命中则调 `subCtx.abort?.(reason)`，返回 `{found:true, cancelled}`
（legacy 无 abort 的 ctx → cancelled:false，不抛）。默认路径逐字节不变（无人调 `abort`/`cancel` 时
新增字段休眠）。测试 +10（context 5：fresh 未 abort / abort 置位记原因 / 二次 no-op 保首因 / 非 active
拒绝 / 外部 AbortSignal 透传；registry 5：单个 abort / unknown not-found / 兄弟不受影响 / 无 abort()
→ cancelled:false / 已完成 → cancelled:false）。

**仍欠（更大面 / 仍未接）**：`background` 由契约统一驱动（现仍读 spawn args）；每 child 的
checkpoint 归因仍缺。**至此 subagent-contract 强制轴全部收口**（skills/mcp/hooks/memory/
permissionMode + confirmer + 两 runner ceiling + shell/run_code 门）+ 精确单-agent 取消。

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

**已落地（持久化 + 恢复计划派生）**：绑定现作为**链式事件**
`appendEvent(sessionId, "turn_checkpoint_binding", …)` 落 canonical
`../harness/jsonl-session-store.js`（继承哈希链防篡改，替代易失的
`_checkpointMarks`）——新纯核 `src/lib/turn-binding-store.js`：
`persistTurnBinding`（写整张表快照，**最新快照胜**，best-effort 永不抛）/
`loadTurnBindingLog`（resume 时倒扫重建，跳过 malformed 快照）/
`resolveRestorePlanFromSession` / `selectTurnRangeFromSession`（I/O 经 `_deps`
注入，纯测试）。`repl-rewind.js` 加 `buildRewindPlan`/`renderRewindWarnings`：
从 REPL **现有**的隐式 marks（`listUserTurns` + `{atMessageCount,id,tool}`）经
`buildTurnBindingFromMarks` → `resolveRestorePlan` 派生 coverage-aware 计划，让
`/rewind` **今天**就能打印诚实的 coverage/警告（side-effect / 缺 checkpoint /
对话-文件漂移），无需先改 agent loop。测试：`turn-binding-store.test.js` 11 项 +
`repl-rewind.test.js` 新增 4 项（`955177b3e8`）。

**已接线（2026-07-13，`/rewind` coverage-aware 警告）**：把 `buildRewindPlan` +
`renderRewindWarnings` 接进 `agent-repl.js` 的交互 `/rewind` 处理器——一个 turn 被回退
后，从 REPL **现有**的 checkpoint marks 派生 coverage-aware 计划（不需新 agent-loop
事件），在**文件恢复提示之前**打印诚实警告：shell/外部副作用 → PARTIAL（“restore is
not guaranteed”）、无 checkpoint → 文件不可复原、对话-文件漂移。`rewindToTurn` 会**截断**
`messages`，故处理器先 `messages.slice()` 快照（`buildRewindPlan` 需目标 turn 仍在场才能
绑定其 checkpoint）；best-effort——advisory 绝不阻断回退本身；FULL 覆盖的 turn 不打印
（不无谓打断）。测试：`repl-rewind.test.js` +3 集成（处理器数据流：快照 + `res.index`
→ partial/shell 警告 / 无 checkpoint 警告 / 从 post-rewind 截断 messages 构建则绑不到
turn → coverage `none` 的守卫）；agent-repl 65 + repl-rewind 26 绿。

**已接线（2026-07-13，`/rewind` scope 选择 conversation-only / files-only）**：补上
「`/rewind` 的 scope 选择交互入口待接」——新纯核 `parseRewindArg(arg)`（repl-rewind.js，
从 `/rewind <n>` 解析出 turn 号 + 可选 `--conversation`/`--files`/`--both`（含 `--conv`/
`--files-only` 别名），任意顺序；无 turn 号/typo 回落 `list` 不静默回退，未知 flag 忽略），
`agent-repl.js` `/rewind` 处理器据此分三态：**both**（默认，原行为逐字节不变——截断对话 +
提示恢复文件 + prune marks + 预填输入）/ **conversation**（只截断对话，**不碰文件**，plan
scope=CONVERSATION 打印「文件不会回退→工作树领先对话」漂移警告）/ **files**（**不截断对话**、
不 prune marks、不预填，只把文件恢复到该 turn 的 checkpoint，plan scope=FILES 打印「对话未回退」
漂移警告；无 checkpoint 则提示 nothing to restore）。coverage-aware 警告改按**选定 scope**
（`buildRewindPlan(...,scope)`）打印。`/help` 与 list-usage 提示加 scope 说明。测试：
`repl-rewind.test.js` +8（parseRewindArg：空/typo→list、clear、裸 turn、两序 scope+别名、
未知 flag 忽略、首个数字为 turn / buildRewindPlan 按 scope：conversation-only 警告 files
不动、files-only plan scope）；repl-rewind 34 + agent-repl 65 绿。

**已接线（2026-07-16，Session Mirror 加密 / 删除 / 保留期 / key rotation）**：勘误——外部
Session Mirror **并非「未起」**：`harness/session-mirror.js`（fs/http 驱动的 off-box 会话副本，
gap-2026-07-11 P2#14）**早已存在**，缺的正是本项点名的四件。本笔补齐：
- **加密**（at-rest）：新 `createMirrorCipher(config)`——passphrase 经 **scrypt** 派 256-bit 密钥、
  **AES-256-GCM** + per-record 随机 salt/nonce/tag，自描述信封 `{v,alg,keyId,salt,nonce,tag,ct}`
  （base64url）；篡改密文 GCM 校验即失败、错 passphrase 解不开。`createMirror` 见 `config.encryption
  .passphrase` 即用 `wrapEncryptedMirror` **透明**包住 driver——推入即密文落盘、拉出即明文，target
  永远只存 ciphertext；无 passphrase→原始字节**逐字节不变**。
- **删除**：fs/http 两 driver 各加 `delete(id)`（fs unlink / http DELETE，404=幂等成功）。
- **保留期**：`pruneMirror(mirror, {keep})`——删掉 keep-set 外的所有条目；命令层 keep-set = 本地仍
  存在的会话 id（镜像单向派生自本地真源，`store.listSessionIds()` 新导出）。
- **key rotation**：`rotateMirrorKey(driver, {from,to})`——逐条用旧 cipher 解、新 cipher 重加密，
  按 `keyId` 跳过已轮换项（幂等重跑）、解不开的**上报不静默丢**。
- **命令面**（`cc session index` 加 option，非新顶层命令→命令数 175 不变）：`--mirror-delete <ids…>`
  / `--mirror-prune`（保留期到本地现存会话）/ `--mirror-rotate`（读 `session.mirror.encryptionPrevious`
  →`session.mirror.encryption` 轮换，驱动 RAW driver 自管密文）。测试：`session-mirror.test.js` 17
  （fs push/pull/list/delete 幂等+unsafe-id 拒 / cipher 往返·错密码·篡改·非信封·缺 passphrase /
  加密包装存密文拉明文·无密码原样·null-config / prune keep-set / rotate 重加密+旧钥失效+幂等跳过+
  失败上报+缺钥抛错）= 全绿；session-index 12 回归绿。**仍欠（外部传输 + turn-binding 运行时事件）**：
  真正的**外部**传输目标（S3/WebDAV/Redis driver 需真端点，配置非捆绑）；从 agent loop 事件
  （checkpoint / tool-executing 的 `tool_use_id` / 权限决定 `requestId` / `spawn_sub_agent` /
  worktree create）**实时**喂 `TurnBindingLog`（tool-call **持久 id** 目前不存在，需引入），并在每
  turn 结束 `persistTurnBinding`（当前 `/rewind` 警告从**隐式** marks 就地派生，尚未落显式持久表）留待。

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

**已接线（2026-07-12 收尾）**：consent 持久化 + 门 + UI 首段落地——新 sibling store
[`capability-consent.js`](../packages/cli/src/lib/plugin-runtime/capability-consent.js)
（用户数据目录 `plugin-capability-consent.json`，IO 注入、绝不进仓库，与
[[trust.js]] 正交：trust 锚**版本代码**、consent 锚**能力集**）。纯核
`capabilityConsentStatus(declared, entry)`：无声明→免 consent；无 entry→未同意（带
added tokens）；**任何加宽**（diffCapabilities.widened）→需重新 consent；收窄/版本
bump 但集不变→仍同意（版本交给 trust）——与 `consentRequiredForUpgrade` 语义一致。
`consentPluginCapabilities`/`revokeCapabilityConsent`/`listCapabilityConsent` +
`isPluginCapabilityConsented(plugin, declared)` 门。**坑**：`normalizeCapabilities`
**非幂等**（对已归一集重跑会把 `filesystem:{roots:[]}`/`credential:{names:[]}` 经
`toList` 腐化成 `"[object Object]"` token），故本模块用 `canonicalCaps` 探测已归一集
直通、只归一 raw。命令面：`cc plugin consent [name]`（无名/`--list` 列出；`<name>`
经 discoverPlugins 取声明能力+当前 consent 状态；`--grant` 记录、`--revoke` 撤销；
`--json`）+ `cc plugin validate` 渲染 “Capabilities (declared)” 段（`describeCapabilities`）。
均 `plugin` 子命令 → 顶层数 175 不变。测试：`plugin-runtime-capability-consent.test.js`
11（空集/never/widened/covered/narrowed/版本 bump 不重提 + store 往返 grant→widen 撤销
→revoke→list + 无版本 throw）+ `plugin-consent-command.test.js` 6（装真插件 fixture
到临时 project scope 驱动 Commander：needs-consent→grant→consented / 升级加宽重提 /
list+revoke / 未装报错 / validate 渲染能力 JSON）；plugin-runtime capabilities/manifest/
install 回归 61 绿。

**已接线（consent 强制拦截，opt-in）**：consent 门已接进 `discoverPlugins` 这个**唯一
chokepoint**（六类组件收集器都经它）——`policy.js` 新增 `filterByCapabilityConsent`（声明了
能力但未 consent 的插件**整体丢弃**、fail-closed、widening 后重掉、scope 敏感；未声明
permissions 的 legacy 插件与空 all-deny 声明不受影响）+ `capabilityConsentRequired`（gate
判定）；`scopes.js` `discoverPlugins` 在 managed-policy 过滤后再跑 consent 过滤。**opt-in
保字节不变**：org 设 `requirePluginCapabilityConsent` 或用户 `CC_REQUIRE_PLUGIN_CONSENT=1`
才启用，默认（无 managed + 未开）原样返回全部。测试 `plugin-runtime-consent-enforce.test.js`
7 项 + policy/scopes/install/consent/command/doctor 回归绿（`659d2909b4`）。

**已接线（2026-07-13 收尾，`cc plugin add`/`upgrade` 渲染能力清单+diff）**：新增共享
helper `resolvePluginCapabilityNotice`（经 `discoverPlugins` 取刚装插件的**解析后 manifest**
声明能力 + `capabilityConsentStatus` 现状；best-effort，能力渲染绝不破坏一次成功安装）+
`printPluginCapabilityNotice`。`add` 成功后渲染「Capabilities (declared)」清单，并对**未
consent / 加宽**打 `⚠ capability consent required` + `added` diff + 指到 `cc plugin consent
<name> --grant`；`--json` 把该结构折进结果（`capabilities` 字段，无声明→`null`）。`upgrade`
成功后同样渲染——一次加宽能力的升级会 diff 出**新增**能力并要求重新 consent。声明能力为
空的插件不打扰（notice=null）。测试：`plugin-add-capability-notice.test.js` 5（fresh 装
needs-consent JSON 折入 / 无声明→null / 文本 re-consent 提示 / 升级加宽→重 consent+network
diff / 升级不加宽→满意 notice），plugin consent/install 回归 46 绿。

**已落地（2026-07-13，声明缺失→单组件拒：hooks + monitors + bin + lsp）**：把「声明了
permissions 却 under-declare 某组件所需能力→拒该**单个组件**」从纯警告升级为**真拦**。新增共享
纯核 `componentCapabilityDenial(manifest, capabilityNames)`（capabilities.js）——仅对**已 opt-in**
（`capabilitiesDeclared === true`）的插件，用 `auditDeclaredCapabilities` 找出 caller 关心的
能力缺口，返回 `{reason}` 否则 null；legacy（无 permissions 块）插件永不受限（能力模型 opt-in
的既定设计）。接进**四个**组件收集器：`collectPluginHooks`（hooks 跑 shell → 需 `process`）/
`collectPluginMonitors`（需 `monitor`）/ `collectPluginBinDirs`（bin 是可执行文件 → 需 `process`）/
`ensurePluginLspServers`（LSP server spawn 二进制 → 需 `process`）——各对 under-declare 的插件
**拒收该组件**，带一次性 stderr 告警（`_resetHookWarnings`/`_resetMonitorWarnings`/`_resetBinWarnings`/
`_resetLspWarnings` 测试可重置）。**默认字节不变**：legacy 插件与已正确声明能力的插件行为不变
（现有 collector 回归全绿）。测试：`plugin-runtime-capabilities.test.js` +4（helper：缺声明拒/
声明放/legacy 放/只认 caller 关心的能力）+ hooks/monitors/bin/lsp 各 +3（真临时插件：declared-无
能力拒、declared-有能力放、legacy 放）= 46+18 绿。

**已落地（2026-07-13，MCP 组件拒收口第五个收集器）**：把同一 `componentCapabilityDenial`
接进 `collectPluginMcpServers`（mcp.js）——声明了 permissions 却未声明 `mcp` 能力的插件的
MCP server 被**拒收该组件**（`componentCapabilityDenial(p.manifest, ["mcp"])`，带一次性 stderr
告警 + `_resetMcpWarnings` 测试可重置），与 hooks/monitors/bin/lsp 同款。**刻意只按 primary
`mcp` 能力拒、不按 `network` 拒**——本地 stdio MCP server 不需网络，network 由连接期的
egress/网络策略强制（非收集期），否则会误拒合法 stdio server。**默认字节不变**：legacy（无
permissions 块）与已声明 `mcp` 的插件行为不变。测试：`plugin-runtime-mcp.test.js` +4
（declared-无 mcp 拒 / declared-有 mcp 放 / stdio 缺 network 仍放 / legacy 放）= 21 绿；
plugin-runtime-manifest/consent-enforce/install 回归 49 绿。**至此 6 个组件收集器
（hooks/monitors/bin/lsp/mcp + settings 早已安全子集）能力拒全收口。**

**已落地（2026-07-13，optionsSchema 敏感项 project-scope 门 + 值解析消费方）**：此前
optionsSchema 只被 manifest.js **归一化**、`validateOptions`/`optionDefaults`/
`redactSensitiveOptions` 纯核也在，但**没有任何消费方**真正解析并应用选项**值**——敏感
项 project 门空有规则、无接线。新建纯核 + 注入-IO store
[`plugin-options.js`](../packages/cli/src/lib/plugin-runtime/plugin-options.js)
（镜像 [[capability-consent.js]] 的双存储 + 纯解析器结构）：

- **双 scope 值存储**：user scope → 用户数据目录 `plugin-options.json`（可含密钥）/
  project scope → 仓库内 `.chainlesschain/plugin-options.json`（可 checked-in → **禁含
  密钥**）。IO 注入，单测绝不碰真目录。
- **`resolvePluginOptions`（纯）**：按 `defaults < project(仅非敏感·非 user-only) < user`
  分层合并，对 project config 里出现的**任何敏感/user-only 选项 DROP + WARN**（复用
  `validateOptions` 的 `scope:"project"` 错误——sensitive/user-only 在 project 即 error），
  返回 `{options, redacted, warnings, sources, droppedFromProject}`——checked-in 的项目
  文件**无法注入密钥**，敏感项只能走 user scope。`getResolvedPluginOptions` 从两存储读值
  再解析。
- **命令面 `cc plugin options <name>`**（`plugin` 子命令 → 顶层数 175 不变）：默认渲染
  解析后选项（敏感值 `***` 脱敏 + 每项 `[default|project|user]` 来源 + project 掉落告警）；
  `--set key=value`（可重复）在 `--scope user|project` 存值；`--json` 结构化。
- 测试：`plugin-runtime-plugin-options.test.js` 8（纯解析：默认 / 三层优先级 / 敏感项
  project 掉落 / user-only project 掉落 / 脱敏 / 类型强制+未知告警 + store 注入-IO 往返/
  两存储经门合并）+ `plugin-options-command.test.js` 4（真插件 fixture：默认 / user 存值脱敏
  显示 / 敏感项 project 掉落 / 畸形 --set·未装报错）= 12 绿；plugin-runtime 全套 209 回归绿。

**已接线（2026-07-13，`cc plugin add`/`upgrade` 安装期 diff→重新 consent 门）**：补上前一条
「装/升级时非阻塞、需事后 `cc plugin consent --grant`」——把 consent 提到**安装/升级当下**决策。
新纯核 `resolveConsentAction(notice, {grant, interactive})`（[[capability-consent.js]]，无 IO、确定
性）把「有无待 consent 能力 × 是否显式授予 × 是否交互 TTY」判成 `advisory | prompt | grant`
三态（**显式 flag 恒胜过交互 prompt**）。命令层新增 `--grant-capabilities`（`add` 与 `upgrade`
各一）+ 共享 `applyCapabilityConsentGate`：`grant`→立即记 consent（脚本/CI 路径，`--json` 也
honor 并折出 `capabilitiesGranted`）、`prompt`→交互 TTY 下 `@inquirer/prompts` `confirm` 当场
问、答 yes 才 `consentPluginCapabilities` 记录（Ctrl-C / 非交互 fail-closed 视为拒绝）、
`advisory`→保留原「⚠ + 指到 `cc plugin consent --grant`」提示。**默认字节不变**：非交互、无
`--grant-capabilities` 时逐字节等于原 advisory 路径（既有 add/upgrade 通知测试全绿）。一次
加宽能力的 `upgrade --grant-capabilities` 直接 diff 出新增能力并就地 re-consent（记录版本推进）。
测试：`plugin-runtime-capability-consent.test.js` +4（`resolveConsentAction` 三态 + flag-wins-over-TTY）
+ `plugin-add-capability-notice.test.js` +4（默认非交互不 grant / `--grant-capabilities` json+text
记录 consent / 升级 re-consent 到 widened 版本）= 27 绿；consent/enforce/install/doctor 回归 39 绿。

**仍欠（keychain 托管 + 更大基建）**：把敏感选项**值**从 user-scope JSON 迁到 **OS keychain**
（DPAPI/Keychain/Secret Service，平台相关；project-scope 门已强制，keychain 取值属平台接线）；
shell-form 命令插值加固 / 统一 Sandbox Broker / lockfile-SBOM 属更大基建，未起。

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
  PostToolUse/UserPromptSubmit/Session\*/Stop/SubagentStart·Stop/ConfigChange/
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

**已接线（2026-07-12 收尾）**：持久事件日志 + `cc hook replay` 落地——新纯核
[`hook-event-log.cjs`](../packages/cli/src/lib/hook-event-log.cjs)（IO 注入、可单测）
把此前**被丢弃**的完整 envelope 持久化成**哈希链** JSONL（`{envelope, prevHash,
hash}`，`hash=sha256(prevHash+stableStringify(envelope))`，镜像 session transcript
integrity；编辑/删除/重排任一行即断链，`verifyHookEventChain` 检出；>5 MiB 自动
rotate 到 `<file>.1`）。**OPT-IN**：仅当 `CC_HOOK_EVENT_LOG` 开启时
`settings-hook-events.cjs` 的 `withDeliveryId` 才 best-effort 记录（try/catch 吞错、
默认关时**字节不变**、无新 IO）。新命令 `cc hook replay <event-id>`（默认 dry-run 打
`planHookReplay` 的 payload；`--run` 只执行 observe-only 事件；DECISION 事件无
`--sandbox` 拒绝，即便有 `--sandbox` 也**不执行**——真沙箱执行器仍缺，只出 dry-run
plan，绝不 re-gate 真流程）+ `cc hook events-log [--limit/--verify/--file/--json]`
（列出/校验链）。均为 `hook` 子命令，顶层命令数 175 不变。测试：
`hook-event-log.test.js`(13：opt-in 门/append+find 往返/链校验+篡改检出/latest-wins/
list limit/malformed 跳过/rotation) + `hook-replay-command.test.js`(6 命令：
events-log list·verify / replay 未知 id·observe dry-run·decision 拒绝·decision
sandbox 不执行·observe --run + 2 recording-wire：关不记·开记录)；hook-event-bus/
hook-test-command/settings-hook-events 回归 34 绿。

**已接线（2026-07-16，async hook 持久队列 + 崩溃恢复）**：补上「async hook 持久队列」——
`async: true` 的 settings hook 由 [[async-hook-supervisor.cjs]] fire-and-forget 跑，结果**只在
内存**（`_results`/`_rewakes`）里存到下一回合 drain。其中 **rewake**（一个**opt-in** `asyncRewake`
且**失败**收场的后台检查，如 `npm test` 挂了）是该管线唯一的**可行动信号**——「重新唤起 agent 处
理这个失败」。若进程在 record 与 drain 之间死掉（崩溃/被杀/硬退出），这个失败信号**静默丢失**：
下次 `--resume` 该会话毫不知情。新纯核 + 注入-IO `src/lib/async-hook-queue.cjs`（镜像
[[hook-stats-store.cjs]]：纯 fold 无时钟/RNG、注入 fs、原子 tmp+rename、per-session +
session-count 双界、best-effort 全程不抛）给 supervisor 一个**按 session id 分桶**的持久落点：
**记录即写**（rewake 稀少故立即持久，连 SIGKILL 都能幸存，非等 stopAll）、**drain 即清**
（`drainRewakes` 消费后删除持久副本，故已处理的不会在下次 resume 重放）、**resume 即取**
（`takePending` load+clear 该 session 桶，顺带 prune >7d 陈旧桶）。**接线**：`AsyncHookSupervisor`
新增 opt-in `sessionId`+`persistQueue`/`queuePath`（+注入 `queueFs`）——`_record` 里 rewake
落桶、`drainRewakes` 里清桶；两者都在 `_queueEnabled()`（session id + 路径俱在）为假时**零写、逐
字节不变**。`headless-runner.js` 构造 supervisor 时按 `persist`（仅可持久化的会话才可能被 resume）
传 `sessionId`/`persistQueue`；resume 分支新增恢复块——`takePending(sessionId)` 取回被上一崩溃运行
parked 的失败 rewake，构建 **“Recovery notice”** system 消息（镜像既有 `resumeSideEffectContext`）
注入本轮，让模型复核每个后台失败，而非静默吞掉。**刻意只覆 rewake**（非 rewake 的 informational
结果丢了成本低；rewake 是值得幸存崩溃的失败信号）。测试：`async-hook-queue.test.js` 16
（queueEntryKey/normalize/coerce/foldAppend 去重+界+忽略空 session·非法记录 / foldRemove 幂等+空桶自清 /
boundSessions / foldPruneStale + IO 端到端：append→take 恢复即清 / remove 消费不复现 / session 隔离
+陈旧 prune / 空队列纯读不重写 / 空 session id 拒 / 损坏文件 best-effort）+ `async-hook-supervisor.test.js`
+4（失败 rewake 落桶跨崩溃恢复 / 成功 rewake 不落 / drain 清持久副本 / 未配置零写字节不变）+
`headless-runner-async-hook-recovery.test.js` 2（parked 失败 rewake → resume 注入 Recovery-notice
system 消息且取后清桶 / 无 parked 时零注入零写）= 22 绿。与 `allowManagedHooksOnly`（早已在
settings-hooks.cjs）合并即 gap 的「async hook 持久队列 + allowManagedHooksOnly」全落。

**已接线（2026-07-16，`CwdChanged` 生命周期事件真触发）**：新事件类型里挑第一个**命令层
可触发**的落地——REPL `/cd` 改工作目录后真发 `CwdChanged`。此前这些新事件（TaskCreated/
CwdChanged/Worktree\*/…）只在 `hook-event-bus` 的 `HOOK_EVENT_TYPES` 注册，**无生产者**、
loader 的 `HOOK_EVENTS` 也不认（故 `collectHooks` 永不匹配、doctor `checkHookConfig` 还会当
unknown-event 警告）。补：①`settings-hooks.cjs` `HOOK_EVENTS` 加入 `CwdChanged`（loader 认它、
doctor 视其为合法事件）；②`settings-hook-events.cjs` 新纯核 `runCwdChangedHooks`（镜像
`runSessionStartHooks`：observe-only，cwd 变更**永不 gate**，带 delivery-id envelope，payload
`{old_cwd, cwd, session_id}`，无注册 hook 时 no-op 字节不变）；③REPL `/cd` 成功 `chdir` 后（cwd
真变时）best-effort 发 sync `runCwdChangedHooks` + `dispatchAsyncHooks`，镜像既有 ConfigChange
producer。测试：`settings-hook-events.test.js` +3（无 hook/matcher 不匹配→null / 触发注入 context /
old_cwd·cwd·event 名经 stdin JSON 贯通）+ `settings-hooks.test.js` +1（`HOOK_EVENTS` 含
CwdChanged + `collectHooks` 匹配）= 4 绿；hook-events/hooks/doctor 套回归 65 绿。

**已接线（2026-07-16 续，`WorktreeCreate`/`WorktreeRemove` 真触发）**：接上一笔——把
`--worktree` 会话的 create/finish 一对生命周期做成第二/第三个命令层生产者。补：
①`HOOK_EVENTS` 加入 `WorktreeCreate`+`WorktreeRemove`（loader 认它、doctor 不再当
unknown-event 警告用户配的 `Worktree*` hook）；②`settings-hook-events.cjs` 新纯核
`runWorktreeCreateHooks`（payload `{worktree_path, branch, base_sha, session_id}`）+
`runWorktreeRemoveHooks`（payload 加 `{removed, reason}` 区分「空 worktree 自动删」与
「有改动保留」），均 observe-only、matcher target=分支名（regex matcher 可按分支模式限定）、
无注册 hook 时 no-op 字节不变；③`agent.js` 命令层：`setupAgentWorktree` 成功后从 repoRoot
`loadHooks` 一次并 best-effort 发 sync + `dispatchAsyncHooks`（懒建 `AsyncHookSupervisor`）；
`_finishWorktree` 结算后复用同一份 hooks 发 `WorktreeRemove`（`removed` 取自 `fin.removed`）。
测试：`settings-hook-events.test.js` +6（create/remove 各：无 hook/matcher 不匹配→null、
触发注入 context、path·branch·base_sha·removed·reason 经 stdin JSON 贯通、kept→removed:false）
+ `settings-hooks.test.js` +1（`HOOK_EVENTS` 含两事件 + 分支 regex matcher 只匹配对应分支）=
7 绿；settings-hook-events/settings-hooks/doctor/subdir/trust/event-bus/runner 套回归 135 绿。

**已接线（2026-07-16 续，`InstructionsLoaded` 真触发）**：第四个命令层生产者——会话启动
组装完项目指令块（cc.md/CLAUDE.md/AGENTS.md 层级 + `.claude/rules/*`）后真发
`InstructionsLoaded`，hook 可审计本会话哪些指令文件是权威（审计、异常 local 覆盖告警、加载配套
工具配置）。**零漂移设计**：`composeSystemPrompt` 内联 `loadProjectInstructionsBlock` 为
load→render 并新增可选 `onInstructionsLoaded(loaded)` 回调（回调抛错被吞、**不影响** prompt，
无回调时输出字节完全不变），把**真正注入**的那份 loaded set（非另行 re-discover）交给调用方——
事件报告的 files 与系统提示里的完全一致。补：①`HOOK_EVENTS` 加入 `InstructionsLoaded`；
②`settings-hook-events.cjs` 新纯核 `runInstructionsLoadedHooks`——把每条目裁成
`{path, scope, truncated}`（**永不含文件 content**，要内容的 hook 自己读 path）+ `count`，
observe-only；③三个会话入口（`headless-runner`/`headless-stream`/`agent-repl` 初始 compose，
即 `SessionStart` 也触发处）经回调捕获 loaded、best-effort 发 hook 并把 context 像 SessionStart 一样
注入（project memory 关时无 loaded=no-op）。测试：`system-prompt.test.js` +3（回调收到 loaded /
memory 关时不调 / 回调抛错不改 prompt）+ `settings-hook-events.test.js` +3（无 hook→null / 触发注入 /
裁剪 path·scope·truncated+count·丢弃 content 经 stdin 贯通）+ `settings-hooks.test.js` +1 = 7 绿；
system-prompt/hook-events/hooks/headless-runner/headless-stream/agent-repl/project-instructions/
agent-policy 套回归 ~249 绿。

**仍欠（合并接线 + 真沙箱 + 余下新事件触发）**：把 `mergeHookDecisions` 真正接进
agent-core 的 PreToolUse/PermissionRequest 合并点（现为手写 first-wins + 从 results
捞 allow）并让多 hook **并行**跑；`planHookReplay`/`cc hook replay --run` 的 DECISION
事件需要真沙箱执行器（hook 目前 `shell:true` 继承全 env，无沙箱层）；**余下**新事件类型
（TaskCreated/TaskCompleted/MCPElicitation）的真触发（`CwdChanged`/`Worktree*`/`InstructionsLoaded`
已落；剩下的 TaskCreated/TaskCompleted 无单一「用户任务表」语义 seam（散在 team/cowork/a2a 编排命令），
MCPElicitation 深在 MCP client 协议层——均非 CwdChanged/Worktree 那种干净命令层 seam，属产品语义/
agent-core 决策）；trace_id/parent_id 从 agent-core context 线程进 envelope 留待。

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

**已接线（2026-07-12 收尾）**：**移除了 `--json-schema` × `stream-json` 互斥守卫**——
stream 模式下正常流式输出后，把终局 `structured_result` 事件（schema_digest + valid +
value，invalid 带 coded/pointered errors）作为最后一行 NDJSON emit（由 run 的 final
text 经 `extractJsonPayload`→`buildStructuredResult` 组装，退出码反映 validity）；
**`--json-schema` 现支持 inline JSON**（值以 `{` 开头即当字面 schema，路径不可能以 `{`
开头故判定无歧义，错误信息区分 inline/file，meta-validation 两者都跑）。text/json 路径
的 capture+validate+retry 循环保持不变。测试：`json-schema-output.test.js` 新增 7 项
（inline 有效/无效/meta-invalid + stream-branch 组装有效/无效）+ 坏 inline schema
在任何模型调用前失败验证分支可达。

**已落地（2026-07-12 二轮）**：`json-schema-validate.js` 现**断言** `format`
（date-time/date/time/email/uri/uuid/ipv4/ipv6/hostname，日历感知 date、闰秒 time、
无前导零 ipv4 八位组、单 `::` ipv6、RFC-1123 hostname；未知 format 按 Draft 2020-12
退回注解一律通过，导出 `KNOWN_FORMATS`）+ 支持 **`if`/`then`/`else`** 条件模式（`if`
复用 `_branchValid` 作**永不上报**的测试，then/else 错误带 `/then`·`/else` schemaPath）；
meta-validation 加 `format` 须为字符串 + if/then/else 递归为子 schema。测试
`json-schema-validate.test.js` +16（36 项，原 20），`json-schema-output` 消费套
25/25 无回归（经 `validateSchema` 贯通）。commit `0849b2ae3e`。

**已落地（2026-07-12 三轮）**：`runJsonSchemaConstrained` 的**重试校验已切到新验证器**
——每次尝试从 loose `validateAgainstSchema`（仅 type/required/enum/const/
additionalProperties、`$.a.b` 串）换成 [[json-schema-validate.js]] 的 `validate()`，故
约束式结构化输出现**强制** format 断言、if/then/else、min/max、pattern、allOf/anyOf/
oneOf/not，且纠错提示带 **JSON Pointer**（新增导出 `formatSchemaErrors` 把 coded/
pointered 错误渲染成 `<pointer>: <message>`，root→`(root)`）。`validateAgainstSchema`
保留导出向后兼容（自有测试不动），仅切内部调用。测试 `json-schema-output.test.js`
+4（formatSchemaErrors 映射/null-safe；约束器拒非法 `format:email`、把 `/age`+`minimum`
喂进重试提示——两者 loose 验证器都漏）；output(29)+validate(36) 套全绿。commit
`e2a699cd74`。

**已落地（2026-07-13，stream-input per-turn structured_result）**：`--input-format
stream-json` 之前**忽略** `--json-schema`（该 flag 只在单-prompt 的 `runAgentHeadless`
路径生效，stream-INPUT 走另一个函数 `runAgentHeadlessStream`）。现 `runAgentHeadlessStream`
接受 `options.jsonSchema`：启动期经 [[json-schema-output.js]] `loadSchemaFile`
（inline/文件 + meta-validation）解析，**坏 schema fail-fast**（写 stderr + `exitCode:1,
turns:0`，镜像单-prompt）；把 `buildSchemaInstruction` 的输出契约注入系统提示（模型末轮出
JSON）；每回合 `result` 事件之后**紧接**发一条 `structured_result`（`schema_digest` +
valid + value/errors，JSON Pointer coded）——两协议至此平价。**绝不退回自由文本**：不可解析/
不合规的回复报 `valid:false`。OPT-IN：未设 `--json-schema` 时无 `structured_result`、字节
不变。`agent.js` 的 stream 分支透传 `jsonSchema`。测试：`headless-stream-json-schema.test.js`
7 项（合规/违规/无 JSON 三种裁决 + 多回合逐轮 + 系统提示契约注入 + 坏 schema fail-fast +
默认关 no-op）；headless-stream/json-schema-output 回归 70 绿。

**仍欠**：单-prompt 的**终局** `structured_result`（agent.js 命令层旁路）与 stream-input
的**逐轮** `structured_result`（现落）已双双到位；无余项。

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

**已接线（2026-07-12 收尾）**：多 Agent Review fan-out 落地——`cc review --multi`（opt-in
新 flag）在 `review.js` 新增 `runMultiFinderReview`：对 4 个维度
（correctness/security/performance/tests）各跑**一个聚焦 finder**（`runAgentHeadless`×N，
输出 captured 不落 stdout，只出最终报告），每个 finder 回 JSON findings 经 `parseFindings`
标 category、跨 finder 用 `buildReviewReport`（dedupe→verdicts→filter→rank）合成结构化
报告（path/line/category/severity/failure_scenario/evidence + bySeverity/byCategory
rollup + byDimension 计数）。title→`failureScenario`、body→`evidence`，title 保留供
`path:line:title` 跨维 dedup（同一 finding 被多 finder 报→合并、取最高 severity、union
categories）。纯核 `buildDimensionPrompt`/`renderMultiFinderReport` + `REVIEW_DIMENSIONS`。
`--multi` 默认关时单遍路径**字节不变**；finder 抛错容错（该维 0 计、其余照跑）。测试：
`review-multi-finder.test.js` 7（prompt 聚焦/render/跨维合并+max severity/captured 不打印/
finder throw 容错/默认 4 维），review 命令套回归 74 绿。

**verifier 扇出续接（2026-07-12）**：`cc review --multi --verify` 落地——finder 扇出后对
**去重后**的每个 finding 派**一个 skeptic verifier agent**（`runVerifierPass`，captured），
prompt 要求"默认 REFUTED 除非能复现"，回 `{reproduced,confidence,reason}` 经 `parseVerdict`
→ verdict `{verified,confidence,note}`，keyed by `findingKey`(`path:line:title`) 喂
`buildReviewReport(all,{verdicts})`——`applyVerdicts` 丢弃 `verified:false`（refuted）、给
reproduced 提置信度。报告/返回带 `verified` 计数。纯核 `buildVerifierPrompt`/`parseVerdict`。
verifier 抛错/不可解析→无 verdict→finding 保留（保守）；仅 `--multi` 生效。测试
`review-multi-finder.test.js` +5（buildVerifierPrompt/parseVerdict 含 null/runVerifierPass
keyed+throw 无 verdict/multi--verify 丢 refuted+verified 计数+4 调用=2 finder+2 verifier）=
12 绿 + review 套回归 67。

**已接线（effort 自动开）**：`--multi`/`--verify` 现按 effort **自动开**——新纯核
`resolveMultiVerify({multi,verify,effort,single})`：顶层 tier `high` 无 flag 时自动开
multi+verify（一次 high review 即彻底的、经核验的一遍），low/medium 无 flag 保持单遍
**字节不变**；显式 flag 恒胜、`--single` 强制单遍、verify 永不脱离 multi；auto 时 stderr
提示。接进 `runReview`（`if(options.multi)`→`resolveMultiVerify` 决策）+ 新 `--single`
命令 flag。测试 `review-multi-finder.test.js` +7（low/medium/未设单遍 + high 自动双开 +
single 强制单遍 + 低 effort 显式 multi 无 verify + no-verify 保 multi + verify 不脱 multi）；
review 套回归 129 绿（`b8b2e8df95`）。

**已落地（2026-07-13，LSP 重启指数退避，opt-in）**：`lsp-manager.js` 在原有滑窗**隔离**
（`maxRestarts` 内 crash 数达上限即 quarantine）之上补**退避**——之前落在 quarantine 上限内的
崩溃会在**下一次请求**立即 re-spawn，一个启动即崩的 server 会毫秒级连爆 `maxRestarts` 次再隔离。
新增 `restartBackoffBaseMs`/`restartBackoffMaxMs` 选项 + `_restartBackoffMs(crashCount)`（指数
`base·2^(N-1)` 封顶，确定性无 jitter）：第 N 次崩溃后第 N+1 次 spawn 须等退避时间，`ensureFor`
在 quarantine 判定之后、spawn 之前查「距上次崩溃是否够久」，未够则返回 `{unavailable, backoff:true,
retryInMs}`（transient 冷却，区别于 quarantine，caller 一样降级文本搜索）。**默认 `restartBackoffBaseMs=0`
＝关 → 逐字节不变**（立即 re-spawn 的原行为，现有崩溃循环测试全不动）——因无法在 agent-core
（并行 session 占用）接线打开，故取 opt-in 成熟度，恰合本项「留待评估」定性。测试：
`lsp-manager.test.js` +3（指数值 0/1000/2000/4000/8000/封顶 + 默认关 0 / 冷却期降级 backoff:true
+retryInMs 后放行 / 默认关立即 re-spawn）= 17 绿；LSP 套 81 绿。

**已接线（2026-07-16，LSP `/doctor` 就绪检查）**：补上 P2 LSP 的「`/doctor` 检查」——`cc doctor`
是**独立进程**、无活的语言服务器可 introspect，但它能做一件**静态**且高价值的事：把**项目里实际
存在的语言**与**语言服务器是否安装**对上——这正是 `code_intelligence`/`cc code-intel` **静默降级
成纯文本搜索**的根因（用户毫不知情）。新纯核 `checkLspReadiness(languages)`（runtime-checkup.js）：
对每个 `{languageId, fileCount, available, serverId, exampleBin}`，仅**存在文件却无服务器**者 warn
（「N 个 <lang> 文件但未装语言服务器 → code-intelligence 降级为文本搜索，装 <server> 或忽略」），
已安装者**零输出**（不刷屏）。注册表新增纯函数 `describeServer(languageId)`（lsp-server-registry.js）
——命名**期望**的服务器（首个插件候选否则 builtin）**即便未安装**，故 doctor 能说清「装什么」
（`resolveServer` 未装时返 null 无从取名）。**接线**（doctor-checkup.js `runtimeSection`，**非**
agent-core）：`scanProjectLanguages(root, deps)` 有**双界**（entries + depth）浅扫项目，跳过
node_modules/dist/vendor/dot-dir 等重目录，按扩展名计数各语言源文件（注入 fs，大仓下仍快）；对每个
present 语言用 `resolveServer` 判安装 + `describeServer` 取期望名，喂评估器出 findings。**默认无源
文件→整块 no-op**；扫描 best-effort 失败降一条 check 不崩。测试：`runtime-checkup.test.js` +5
（missing→warn / installed→静默 / 零文件→无 / 空·畸形输入 / 无 serverId 回退泛称）+
`lsp-server-registry.test.js` +3（`describeServer` builtin·未装仍命名 / unsupported→null / 插件盖
builtin）+ `doctor-checkup.test.js` +3（注入 .ts 树 + 强制 registry `existsSync` → 未装 warn /
已装静默 / 无源文件无 finding）= 11 绿；runtime-checkup 32 + registry + doctor 全套回归绿。

**仍欠（调度器接线 + LSP 多根 + 退避 default-on）**：`DiagnosticsScheduler`/`capDiagnostics` 接进
agent-core 的编辑→诊断路径（替 `_postEditDiagnostics` 的裸 cap 20 + 无节流，属 agent-core接线）；
LSP 多根 workspace（需 agent-core 把多个 root 传进 manager/`_getSharedCodeIntel`）；退避 default-on
（需 agent-core 处构造 LSPManager 时传 base，属 agent-core接线）留待。

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

### 已落地（增量）

三个纯核 + 各自最小接线（审计确认：背景孤儿/PID、worktree 陈旧、session lifecycle、
task-lease 过期**已被现有 `backgroundSection`/`worktreeSection`/`session-lifecycle.js`/
`task-lease.js` 覆盖**，故本轮只补真缺口，不重复上报）：

- **统一 OTel id + 内容脱敏 + 基数收敛**（`src/lib/telemetry-ids.js`）：
  `buildTelemetryAttributes(ctx,{includeContent})` 把杂乱别名（`sessionId`/`session_id`/
  `session.id` …）归一到九个稳定 id key；`content.prompt/response/tool_arguments`
  **默认脱敏为 `[redacted]`**，仅显式 `includeContent` 才输出且仍长度封顶；只发
  allow-list key（外来高基数 label 直接丢弃），id 值经 `sanitizeIdValue` 收字符集 +
  ≤128 截断；`auditAttributes` 可 fail-closed 校验。此前 `span-recorder.js` **仅** 打
  `workflow.run_id`/`workflow.name`、无脱敏、无基数控制。**接线**：`agent-core.js` 运行
  开场把 `workflow.run_id`+`session.id`(+`agent.id`/`parent_agent.id` 若在)经归一化
  `setDefaultAttribute` 到每个 span（`session.id` 现每 span 都带，字符集已净化，
  `agent-core-telemetry.test.js` 端到端断言）。
- **Doctor Runtime Checkup 纯评估器**（`src/lib/runtime-checkup.js`）：对注入的运行时
  快照产出分级 findings —— agenda 逾期/漏触发、孤儿进程、慢/熔断 Hook、失效
  Plugin/LSP、陈旧 session/worktree、冗长指令文件；`runRuntimeCheckup` 汇总按严重度
  排序 + rollup，缺失快照段跳过不崩。**接线**：`doctor-checkup.js` 新增 `runtimeSection`
  （排在 section 数组末）**只**消费 `checkAgenda`（真读 `AgentScheduleStore.list()`，逾期
  wakeup / 可退休 cron）+ `checkInstructionFiles`（真 stat `cc.md`/`AGENTS.md`/`CLAUDE.md`
  字节数），其余检查刻意不接线以免与既有 section 双报。
- **CLI 参考文档自动生成 + 漂移检测**（`src/lib/docs-drift.js` + `scripts/gen-cli-reference.mjs`）：
  从权威源 `command-manifest.json`（175 命令）+ `listCodingAgentToolNames()`（26 工具）
  构建 canonical reference、渲染稳定 markdown，并双向 diff 一份手写文档（
  `detectDocDrift` → 未文档化命令/工具 + 指向已删命令的陈旧 `cc <x>` 提及，`knownTokens`
  可把 flag/退出码/协议字段一并纳入权威集）。生成器 `node scripts/gen-cli-reference.mjs`
  可 `--out <file>` 生成或 `--check <doc>` 在 CI 里对文档 fail-on-drift（退出 1）。此前
  无任何 reference 生成器/漂移检测。

测试：`telemetry-ids.test.js`(9) + `runtime-checkup.test.js`(12) + `docs-drift.test.js`(10)

- `agent-core-telemetry`(+1 session.id 断言) + `doctor-checkup`(section-id 更新) 全绿。

**已接线（2026-07-12 收尾）**：`checkPluginsAndLsp` 评估器 + 插件能力 consent 喂进
doctor——`doctor-checkup.js` 的 `pluginSection`（此前只报安装数 + 签名锁）新增一块：
用 `discoverPlugins` 拿每个已装插件的**解析后 manifest**（`listInstalled` 丢了它），
对 `manifest.ok===false` 的**坏 manifest** 经共享 `checkPluginsAndLsp` 评估器报 warn，
并对**声明了能力但未 consent** 的插件（复用上节 [[capability-consent.js]] 的
`isPluginCapabilityConsented` 门）报 warn + 指到 `cc plugin consent <name>`。与既有签名
锁检查不重叠、best-effort（失败降一条 err check 不崩）。测试：
`doctor-plugin-capabilities.test.js` 3（装真 fixture：未 consent 报警 / consent 后消失
/ 无声明不报）；doctor-checkup + runtime-checkup + doctor-status 回归 34 绿。

**已接线（2026-07-13，`--otlp-content` opt-in）**：脱敏纯核（`buildTelemetryAttributes`
的 `includeContent`）此前无 CLI flag 暴露，故 span 内容永远保持脱敏。新增
`cc agent --otlp-content`，经 headless-runner loopOptions（`otlpIncludeContent`）线程进
`agent-core.js` 的 run 级属性 stamp：开启时把首个 user prompt（字符串或多模态 text 片段）
经脱敏器以 `includeContent` 喂入、stamp 成 `content.prompt`；默认关**整字段省略**（非仅脱敏），
故默认 `--otlp` 输出逐字节不变。测试：`agent-core-telemetry.test.js` +3（默认省略 /
opt-in stamp / 多模态提取）；未改 agent-core 导出（shim parity）。

**已接线（2026-07-13，per-span 统一 id）**：`turn.id`/`prompt.id`/`tool_use.id`/
`checkpoint.id` 已在 `agent-core.js` 各自 seam 的 span 上真正 stamp（此前只在 run 级
默认属性接了 session/agent/workflow）——`agent.model` span 带 `turn.id`
（`<runId>:t<iteration>`，与既有 `agent.iteration` 计数对应）+ `prompt.id`
（`<turn.id>:p`）；`agent.tool` span 带同 iteration 的 `turn.id` + provider
`tool_use.id`（`call.id`，让 tool-result 事件可回溯到其 call）+ 自动 checkpoint 触发时的
`checkpoint.id`（`cpId`）。全部经 `buildTelemetryAttributes` 归一化（charset 净化 + 基数
封顶），仅在 `recorder` 挂载时构建（未插桩路径零开销）；未改 agent-core 导出（shim
parity）。同批把 `content.*` opt-in 补齐到逐 span：`agent.model` span 在
`--otlp-content` 下 stamp `content.response`（assistant 文本），`agent.tool` span stamp
`content.tool_arguments`（工具入参 JSON），均经 `redactContent` 长度封顶、**默认关整字段
省略**（非仅脱敏，故默认 OTLP 逐字节不变）。测试：`agent-core-telemetry.test.js` +4（读
工具 span 的 turn/prompt/tool_use 断言两 iteration 两 turn id / 真 git repo + 写工具的
checkpoint.id 正向匹配 checkpoint 事件 / opt-in 下 response+tool_arguments 双 stamp / 默认
两字段全 undefined）。

**已接线（2026-07-13，`permission.decision_id` — 统一 id 集收口 5/5）**：`executeTool`
对**被门拦的**工具（deny / ask-fail / host-block / sandbox）返回 `{error, policy}`——
allow 路径的工具直接执行无独立决定。`agent.tool` span 的 `onResult` 现从已浮出的
`r.policy` 派生 `permission.decision_id`（纯函数 `permissionDecisionId(callId, policy)` =
`<tool_use.id>:perm:<via|decision>`，确定性无时钟/RNG，故持 tool-result 的 policy +
tool_call_id 的消费方可重算）+ stamp 低基数 `permission.decision`（allow-list META key）。
**不改权限热路径**（只读既有 policy 字段），仅在真发生门决定时 stamp（allow 路径无
id）。测试：`agent-core-telemetry.test.js` +2（settings deny → `call-…:perm:settings` +
`permission.decision=deny` + is_error / 普通 allow 路径两字段全 undefined）。至此
`session/turn/prompt/tool_use/agent/parent_agent/workflow.run_id/permission.decision_id/
checkpoint.id` 九个 id 全部在真实 seam 落地。

**已接线（2026-07-13，doctor 静态 hook 配置校验）**：hook doctor 项的**静态可判子集**
落地——纯核 `checkHookConfig(hooksBlock, {validEvents,maxTimeoutSec})`（`runtime-checkup.js`）
静态校验 settings.json `hooks` 块的**可靠可判**故障：①事件名不在 `HOOK_EVENTS` 白名单
（该事件下所有 hook **静默永不触发**，最高价值捕获）②`/…/` 正则 matcher 编译失败（永不
匹配）③hook 无 `command`（空操作）④timeout 非正/超 600s 上限（clamped）。**接线**：
`doctor-checkup.js` 的 `runtimeSection` 用 `settings-hooks.cjs` 的 `settingsFiles()` +
`HOOK_EVENTS`（单源）遍历各 settings 文件、parse `.hooks` 跑评估器，findings 进 runtime
section。**零热路径改动**（纯静态读配置，不碰 hook 执行）。测试：`runtime-checkup.test.js`
+7（未知事件/坏 matcher/无 command/坏 timeout×2/干净/空块/无 validEvents 跳过）+
`doctor-checkup.test.js` +1（fake settings.json 未知事件 → runtime section warn）。

**已接线（2026-07-13，hook 运行时健康持久化 → doctor `checkHooks`）**：为 `checkHooks`
评估器补上真实数据源——新纯核 `hook-stats-store.cjs`（跨会话 async-hook 可靠性聚合：每
hook 的 runs/failures/consecutiveFailures/totalMs/maxMs/lastRunAt，`aggregateRun` 纯折叠、
`mergeStats` 跨会话累加、`toCheckHooksInput` 塑形成 `{id,failures,avgMs,circuitOpen}`、
load/save best-effort 原子写、entries 上限 200 按 lastRunAt 淘汰）。`async-hook-supervisor.cjs`
在唯一完成漏斗 `_record` 把每次运行折进**内存**聚合（按 distinct hook 有界），**仅在
`stopAll()` 持久化一次**（与磁盘 merge，跨会话累加）——**hook 热路径零额外 I/O、零写放大**；
持久化 opt-in（生产 5 处 `new AsyncHookSupervisor({persistStats:true})`，测试不传→hermetic
不写）。`doctor-checkup.js` 的 `runtimeSection` 读该聚合跑 `checkHooks` → 慢/失败/熔断 hook
findings（与上节**静态**配置校验互补：静态抓"永不触发"、这里抓"跑了但坏"）。**顺带修**
既有 latent bug：`runtimeSection` 调 `checkAgenda`/`checkInstructionFiles` 漏传 thresholds，
非空 agenda 或存在 `CLAUDE.md` 时 `t.xxx` 解引用 undefined 抛错被 catch 成 failedCheck（这两
检查在真实仓里从来没真正跑过）——现传 `DEFAULT_CHECKUP_THRESHOLDS`。测试：
`hook-stats-store.test.js`(7) + `async-hook-supervisor.test.js` +2（内存聚合 hermetic /
stopAll 持久化+delta 清零）+ `doctor-checkup.test.js` +1（注入熔断 hook stats → runtime
section err）。

**已接线（2026-07-13，doctor 沙箱真实能力 / 静默降级）**：P2 doctor 项"沙箱真实能力和
静默降级"落地——纯核 `checkSandbox(snapshot)`（`runtime-checkup.js`）对已探测快照分级：
①**已配置但引擎不可用且非 fail-closed** → **error `sandbox-silent-degrade`**（工具子进程
**无隔离却不告警**，最危险；你以为在沙箱里其实没有）②已配置 strict 但不可用 → warn（fail-
closed 会拒启动，非静默）③可用 → info 报真实 isolation level。**接线**：`runtimeSection`
从 settings 文件读 `.sandbox`（`deps.readFileSync` 可注入），`enabled===true` 时经既有
`normalizeAgentSandbox` + `probeSandboxAvailability`（一次 `spawnSync` `docker version`/
`bwrap --version` 探测，`deps.spawnSync` 可注入）+ `isolationLevel` 喂评估器。**纯静态探测、
不启容器**。测试：`runtime-checkup.test.js` +4（silent-degrade error / strict-unavailable
warn / available info / 未配置 no-op）+ `doctor-checkup.test.js` +2（fake 不可用引擎 →
runtime section err / 可用引擎 → info 无误报）。

**已接线（2026-07-13，doctor 重复 Skill 检测）**：P2 doctor 项"重复 Agent/Skill"的 **Skill**
半边落地（Agent 半边 `subagentSection` 已覆盖）——纯核 `checkDuplicateSkills(entries)`
（`runtime-checkup.js`）对全层未去重的 skill 条目列表检测同 id ≥2 处定义。根因：
`skill-loader.js` 的 `loadAll()` 用 `Map.set(skill.id)` 按层优先级**静默覆盖**，用户永远
不知道自己的自定义 skill 覆盖了/被覆盖了另一个。新增 `CLISkillLoader.listSkillLayerEntries()`
（复用同一扫描逻辑但**不去重**，返回 `{id,layer,skillDir}[]`）供 doctor introspection。
**接线**：`runtimeSection` 调该方法（`opts.skillLayerEntries` 可注入测试）跑评估器 → 每个
多定义 id 一条 warn 列出各层。测试：`runtime-checkup.test.js` +4（跨层重复/同层重复/唯一
干净/空与畸形）+ `doctor-checkup.test.js` +2（注入重复 → runtime warn / 唯一 → 无误报）。

**已接线（2026-07-13，文档：CLI 参考生成器纳入 npm 脚本 + committed 参考）**：P2 "文档"
支柱落地——`gen-cli-reference.mjs`（权威源 `command-manifest.json` 175 命令 + `AGENT_TOOLS`
26 工具）此前只是孤立脚本。现 `package.json` 加两脚本：`npm run docs:cli-reference`（重生
`CLI_REFERENCE.generated.md`）+ `npm run docs:cli-reference:check`（对该文件跑漂移检测，退出
1 on drift）；并 commit 生成的 `CLI_REFERENCE.generated.md`（175 命令 + 26 工具，含"Do not
edit by hand"头）作为可浏览参考。**刻意不接 CI drift-gate**（避免 fail-build 维护义务——
仍为**产品决策**，非本轮范围）；参考文档漂移时 `npm run docs:cli-reference` 一键重生（自动
产物非手维护）。round-trip 已验证（生成后 `:check` 退出 0 无漂移）。

**已接线（2026-07-16，orphan 进程评估器喂真实快照 → 泄漏的 agent 子进程）**：`checkOrphanProcesses`
纯核此前**从未被 doctor 喂过快照**（`runtimeSection` 跳过它、`backgroundSection` 只读 supervisor 的
**status 字段**从不验真实 PID 活性）。补上一个**精确**的生产者：`runtimeSection` 从
`listBackgroundAgents({all:true})` 取每个后台 agent 的持久记录，对**记录里的** `agentPid`（每回合的
LLM/工具子进程，非 worker 自身）做**一次性静态活性探测**——`isSameProcess(agentPid, agentStartedAt)`
（按进程起始时间锚定，防 PID 复用误判）；worker 已死（`isSameProcess(pid,startedAt)` 假）而子进程仍活
＝**泄漏的孤儿子进程**（`backgroundSection` 的 status 字段抓不到，因为 worker 记录可能仍是 running 或已
被判 lost 但其子进程未被 `reclaimOrphanAgentProcess` 回收）。喂进共享 `checkOrphanProcesses`（parent-dead
或 session-gone → error），每条附**不安全** fix（`taskkill /PID … /T /F` 或 `kill …`，杀进程需人判）。
**只探测我们记录过的 PID** → 零误报、**不扫全 OS 进程表**。可注入 `opts.backgroundProcesses`/
`opts.activeSessionIds`（镜像 `opts.skillLayerEntries`）故可单测。测试：`doctor-checkup.test.js` +3
（worker 死+子活→error+kill 命令 / session-gone→orphan / 健康子进程不报）+ `runtime-checkup.test.js`
既有 `checkOrphanProcesses` 纯核套回归；全套 57 绿。

**仍欠**：`checkOrphanProcesses` 的**背景 shell** 孤儿（非 agent 子进程，仅硬崩溃遗留）仍未喂——价值低
且需 agent-core 热路径记录 shell 子进程 PID，未做；`gen-cli-reference` 的 **CI drift-gate** 仍刻意不接
（避免维护漂移义务，产品决策）；`/doctor` 的 MCP schema 成本需活连接、session `mirror`/保留策略在本仓非
既有特性（造检查会违反"先查证"原则），均需新基建而非接线，留待产品决策。

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
