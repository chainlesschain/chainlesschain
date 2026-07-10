# 对照 Claude Code CLI 的补齐与优化建议

日期：2026-07-09

## 结论

`cc` 当前已经覆盖了 Claude Code CLI 的主要 agent 能力：headless / stream-json、MCP、checkpoint、worktree、sandbox、background agent、review、run、verify、项目记忆、hooks、permissions、OTel 等。后续不应再以“命令数量”追 parity，而应优先补齐 Claude Code 当前拉开体验差距的几个产品化闭环：

1. 权限模式与安全决策解释
2. 后台会话 daemon / attach / 视图
3. MCP tool search 与大规模工具上下文治理
4. Agent SDK 化
5. 事件型 Monitor / Cron / Push 工具
6. 远控跨端闭环

## 当前已具备的本地基础

- CLI 命令面：`packages/cli/src/command-manifest.json` 当前约 165 个命令。
- Agent 入口：`packages/cli/src/commands/agent.js` 已支持 headless、MCP config、permission mode、checkpoint、worktree、sandbox、background、OTLP、structured output 等。
- Background：已有 `packages/cli/src/lib/background-agent-supervisor.js`、`cc agents background/logs/stop`。
- Checkpoint：已有 `packages/cli/src/commands/checkpoint.js`，支持 git-plumbing snapshot / restore。
- Permissions：已有 `.claude/settings.json` 规则加载、deny/ask/allow、managed settings 基础。
- MCP：已有 OAuth、resources、prompts、roots/list、auto-connect、permission-prompt-tool 等。

## P0：最值得优先补

### 1. 补齐权限模式：`manual` / `auto` / `dontAsk`

当前 `cc agent --permission-mode` 主要支持：

- `default`
- `plan`
- `acceptEdits`
- `bypassPermissions`

Claude Code 当前已经把默认模式命名为 `manual`，并提供 `auto` 与 `dontAsk` 语义。建议补：

- `manual` alias：与 `default` 等价，降低迁移成本。
- `auto`：基于规则/分类器自动允许低风险，风险动作继续 ask/deny。
- `dontAsk`：不交互，所有需人确认的动作直接 deny。
- `cc auto-mode defaults`：打印内置分类规则 JSON。
- `cc auto-mode config`：打印 settings 合并后的有效 auto-mode 配置。
- `/permissions recent` 或等价命令：查看最近 auto/deny 的原因。

价值：这是安全与效率的核心差距。比继续加新业务命令更重要。

参考：

- https://code.claude.com/docs/en/permissions
- https://code.claude.com/docs/en/cli-reference

### 2. Background daemon / attach 体验闭环

已有 background supervisor，但还缺 Claude Code 式完整后台会话体验：

- 顶层 `cc attach <id>`：直接接入后台会话。
- 顶层 `cc logs <id>`：无需走 `cc agents logs`。
- `cc daemon status` / `cc daemon stop --any`。
- session rename 后持久，不因 worker 重启丢失。
- daemon lock stale / PID reuse / 版本 handover 防护。
- background session 崩溃后可重连 worker。
- 一个简洁的 agent view：列表、状态、耗时、cwd、最近输出、attach/stop 快捷入口（CLI `daemon view` 已落地，UI 仍待做）。

价值：长任务、多任务、远控的底座。没有这个，background 只是“能跑”，不是“可运营”。

参考：

- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/agents

### 3. MCP Tool Search

当前 MCP 已经比较完整，但大规模 MCP 场景仍需要 tool search：

- session 启动只注入 server 名称、server instructions、tool names。
- tool schema 延迟加载。
- 提供内部 search 工具，让模型按任务检索相关 MCP tools。
- 支持配置：
  - `ENABLE_TOOL_SEARCH=1|0|auto`
  - `alwaysLoad`
  - 阈值加载，例如工具定义小于上下文 10% 时直接加载。
- 对工具变更保持 prompt cache 稳定，减少中途连接/断开 MCP server 的 cache invalidation。

价值：这是接入大量 MCP server 后的上下文成本关键优化。

参考：

- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/prompt-caching

### 4. Agent SDK 化

建议抽一个稳定公共包，例如：

- `@chainlesschain/agent-sdk`
- Python 可后置，先做 TypeScript SDK

核心 API：

```ts
for await (const event of query({
  prompt: "Fix the flaky test",
  cwd,
  allowedTools: ["read_file", "edit_file", "run_shell"],
  permissionMode: "acceptEdits",
  mcpServers,
  hooks,
  resume,
})) {
  // stream events
}
```

应支持：

- streaming input/output
- approval callback
- user question callback
- custom tools
- MCP servers
- subagents
- session resume/fork
- checkpoint
- cost/usage events
- OTel recorder

价值：把 CLI runtime 变成平台能力，供 desktop、web-panel、IDE、CI、自定义自动化复用。

参考：

- https://code.claude.com/docs/en/agent-sdk

### 5. 事件型 Monitor / Cron / Push 工具

Claude Code 的 `Monitor`、`CronCreate`、`ScheduleWakeup`、`PushNotification` 很适合长任务：

- 盯 CI/log/WebSocket 输出。
- 到时间唤醒继续检查。
- 需要人审批时推送移动端。
- 插件可声明自动 monitors。

本地可整合已有 `loop`、`workflow`、`notification`，暴露成 agent 可调用工具：

- `monitor_start`
- `monitor_stop`
- `cron_create`
- `schedule_wakeup`
- `push_notification`

价值：让 agent 从“一问一答/一轮执行”变成可持续观察与响应。

参考：

- https://code.claude.com/docs/en/tools-reference
- https://code.claude.com/docs/en/routines

## P1：中高价值优化

### 6. 远控跨端闭环

本项目已有 web-panel、Android、iOS、P2P/relay 基础。建议做成 Claude Code 式 `/remote-control`：

- QR code / pairing URL。
- terminal、web、mobile 同步同一会话。
- 图片/文件附件从移动端回传本机，作为文件引用注入 agent。
- 权限请求同步到移动端审批。
- permission mode 在远端 UI 正确显示。
- push：长任务完成、需要审批、需要回答时推送。
- trusted device / device enrollment，至少先做本项目 DID 设备信任。
- server mode 支持多 session，`--spawn worktree` 隔离。

价值：这是你们相比 Claude Code 可以做出自有优势的方向。

参考：

- https://code.claude.com/docs/en/remote-control

### 7. 动态 workflow + worktree 默认隔离

已有 `cc team run --worktree`，可以补 `/batch` 风格能力：

- 自动把大任务拆成 5-30 个独立单元。
- 每个单元一个 worktree。
- 每个 worker 跑测试/验证。
- 汇总冲突、失败、diff、测试结果。
- 可选自动开 PR 或生成 patch queue。

价值：大改动效率提升明显，也能降低多 agent 同文件冲突。

参考：

- https://code.claude.com/docs/en/agents

### 8. Windows / PowerShell first-class

Claude Code 当前把 PowerShell 作为独立 tool，而不只是 shell fallback。建议：

- `powershell` 工具独立注册。
- 权限规则支持 `PowerShell(...)`。
- compound command 解析按 PowerShell AST/语义处理。
- Windows 默认 shell 策略可配置。
- hooks/skills 支持 `shell: powershell`。
- 尊重企业 ExecutionPolicy 的配置开关。

价值：本仓库当前工作环境就是 Windows，补这个会直接提升日常可靠性。

参考：

- https://code.claude.com/docs/en/tools-reference

### 9. TUI / 可访问性 / 入口一致性

建议补迁移成本低但体验明显的入口：

- `--bare`：跳过 hooks、skills、plugins、MCP、memory，加速脚本调用。
- `--disable-slash-commands`。
- `--ax-screen-reader`：屏幕阅读器友好输出。
- 顶层 `cc attach` / `cc logs` / `cc daemon`。
- `/tui fullscreen` 或至少稳定的 fullscreen renderer。

价值：减少 Claude Code 用户迁移摩擦，提升 SSH/CI/无障碍场景体验。

参考：

- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/interactive-mode

### 10. Artifacts / SendUserFile

建议把 agent 生成的重要文件升级为 artifact：

- Markdown report
- HTML preview
- screenshots
- test logs
- review findings JSON
- generated patch

能力：

- web-panel 直接预览。
- mobile/remote 可下载。
- session transcript 只记录 artifact metadata，不塞大内容。
- 支持过期/清理策略。

价值：提升交付物体验，减少“生成了文件但用户不知道看哪里”的问题。

参考：

- https://code.claude.com/docs/en/tools-reference

## P2：不建议优先追的项目

以下能力对本项目价值较低，或强绑定 Anthropic 云服务，不建议优先做完全 parity：

- `/passes`
- `/stickers`
- Claude 订阅页 `/upgrade`、`/usage-credits` 的等价体验
- Anthropic 托管 cloud routines 的完全复刻
- `claude.ai/code` 的 web session teleport 完全兼容
- Claude 专属 OAuth/企业后台 UI 的逐项复刻

本项目更应该突出：

- 私有化部署
- 多模型/多 provider
- P2P/移动端远控
- 本地数据与 Personal Data Hub
- 企业自管 MCP、插件、策略

## 建议路线

## 开工记录

### 2026-07-09 第一批

已落地：

- `cc agent --permission-mode` 补充 `manual`、`auto`、`dontAsk`。
  - `manual` 等价于原 `default`。
  - `auto` 先映射到现有 `trusted` 策略，复用当前中风险自动、HIGH 风险确认/拒绝的安全边界。
  - `dontAsk` 使用 strict 策略并禁用交互审批，需确认的动作直接 deny。
- `cc agents run`、`cc command run` 的 `--permission-mode` 帮助文案同步新模式。
- 新增后台会话顶层入口：
  - `cc logs <id>`
  - `cc attach <id>`
  - `cc daemon status`
  - `cc daemon stop <id>`
  - `cc daemon stop --any`
- 更新 `command-manifest.json`，保证新增顶层命令走 lazy dispatch 快路径。
- 增加单元测试覆盖权限模式映射和后台会话状态行格式。

仍待后续：

- `auto` 需要继续从“映射 trusted 策略”升级为可配置分类器和可解释规则。
- `cc attach <id>` 当前是日志流 attach；真正可交互接管后台会话还需要 daemon/session transport 协议。
- background session rename、crash reconnect、stale lock/PID reuse 防护尚未落地。

### 2026-07-09 第二批

已落地：

- 新增 `cc auto-mode defaults`，输出内置 auto-mode 分类默认值 JSON。
- 新增 `cc auto-mode config`，输出合并后的有效 auto-mode 配置。
- `cc auto-mode config --json` 支持机器可读输出。
- 支持别名 `cc automode`。
- 新增 `auto-mode-config` helper，读取 user/project/local/explicit/managed settings 中的 `autoMode` 配置。
- 更新 `command-manifest.json`，保证 `auto-mode` 走 lazy dispatch 快路径。
- 增加单元测试覆盖默认文档、layered config 合并和 managed settings 覆盖。

仍待后续：

- `autoMode` 当前只有 `classifyAllShell` 被运行时消费；其它扩展键会被配置面保留展示，但尚未接入实际策略分类。
- 下一步可补 `/permissions recent` 的顶层等价入口，或开始做 background stale lock / PID reuse 防护。

### 2026-07-09 第三批

已落地：

- 新增 `cc permissions recent`，查看最近 agent 运行中被策略拒绝的工具调用。
- 新增别名 `cc permissions denials`，对齐 REPL `/permissions denials` 语义。
- 支持 `cc permissions recent --json` 机器可读输出。
- 支持 `cc permissions recent --clear` 清空本地 recent denial ring buffer。
- headless agent 运行结束时会把本轮 denials 追加到 `~/.chainlesschain/recent-denials.json`。
- 新增 `permission-denial-store`，以 bounded ring buffer 记录 tool、summary、reason、via、rule、sessionId、permissionMode、cwd、source。
- 增加单元测试覆盖 denial store、`permissions recent` 命令输出和 headless runner 既有行为。

仍待后续：

- REPL denials 已在第六批接入 `permission-denial-store`；`/permissions denials` 仍显示本会话内存视图，`cc permissions recent` 显示跨会话持久视图。
- recent denials 目前记录的是最终拒绝结果；后续可补“规则解释链”，展示 managed/settings/shell-policy/approval-gate 的逐层决策。

### 2026-07-09 第四批

已落地：

- background worker 增加 heartbeat，状态文件持续记录 `heartbeatAt`。
- background 状态新增 `workerPid` 与 `agentPid`，区分 supervisor worker 和实际 agent 子进程。
- supervisor 对 `running` 状态增加 stale heartbeat 判定。
- heartbeat 过期时，状态会被修正并持久化为 `lost`，`lostReason=heartbeat-stale`。
- worker PID 不存在时，状态会被修正并持久化为 `lost`，`lostReason=process-exited`。
- `stopBackgroundAgent` 会先走有效状态判定；疑似 PID reuse/stale heartbeat 的会话不会被误杀。
- `cc daemon status` 和 `cc agents background` 通过 `listBackgroundAgents` 自动触发 stale 状态修正。
- 增加单元测试覆盖 stale heartbeat、PID reuse 防误杀、真实 worker heartbeat 字段。

仍待后续：

- 真正可交互的 `cc attach <id>` 仍需 session transport，而不是当前日志流 attach。
- background session 崩溃后“重连 worker/恢复执行”尚未实现，目前是可靠标记为 `lost`。
- 后台视图中的 title 内联编辑尚未实现；CLI rename 已落地。

### 2026-07-09 第五批

已落地：

- 新增 `renameBackgroundAgent` supervisor API，基于状态文件原子持久化后台会话 title。
- 新增 `normalizeBackgroundAgentTitle`，拒绝空 title，并限制状态文件中的 title 长度。
- 新增 `cc daemon rename <id> <title...>`。
- 新增 `cc daemon rename <id> <title...> --json`。
- 新增兼容入口 `cc agents rename <id> <title...>`。
- rename 会先走 `effectiveBackgroundAgentState`，避免对 stale/lost 会话显示错误 running 状态。
- worker completion 写状态时继续合并当前 state，运行中的 rename 不会在任务完成时被旧 title 覆盖。
- 增加单元测试覆盖 rename 持久化、空 title 拒绝、真实 worker 完成后保留运行中 rename。

仍待后续：

- 真正可交互的 `cc attach <id>` 仍需 session transport，而不是当前日志流 attach。
- background session 崩溃后“重连 worker/恢复执行”尚未实现，目前是可靠标记为 `lost`。
- 后台视图中的 title 内联编辑尚未实现，可复用本批 `renameBackgroundAgent` API。

### 2026-07-09 第六批

已落地：

- REPL 的 policy denial 记录从“仅 `_recentDenials` 内存态”升级为同步写入 `permission-denial-store`。
- `cc permissions recent` 现在可查看 headless agent 与交互式 REPL 两类来源的最近拒绝记录。
- 持久记录新增 `source=repl`，并保留 `sessionId`、`permissionMode`、`cwd` 元数据。
- `permission-denial-store` 增加连续相同 denial 合并，避免 REPL 重复触发同一条策略时刷屏。
- REPL 内部仍保留 `/permissions denials` 的本会话内存视图，用于即时查看当前 session 被拦截的调用。
- 增加单元测试覆盖 REPL wrapper 持久化、store 连续合并逻辑。

仍待后续：

- recent denials 目前记录的是最终拒绝结果；后续可补“规则解释链”，展示 managed/settings/shell-policy/approval-gate 的逐层决策。
- 可在 `/permissions denials` 增加 `--recent` 或提示文案，引导用户查看跨会话 `cc permissions recent`。

### 2026-07-09 第七批

已落地：

- 新增 `cc daemon view <id>`，输出单个后台 agent 的详情视图。
- `daemon view` 展示 status、title、cwd、pid、workerPid、agentPid、sessionId、elapsed、startedAt、endedAt、log path、exitCode/lostReason。
- `daemon view` 默认附带最近 40 行日志，可用 `-n/--lines` 调整。
- `daemon view --json` 输出 `{ session, log }`，方便 IDE/web-panel 复用。
- 详情视图附带 `cc attach`、`cc logs`，running 状态下附带 `cc daemon stop` 快捷命令。
- 新增兼容入口 `cc agents view <id>`。
- 增加单元测试覆盖详情视图格式。

仍待后续：

- 详情视图目前是 CLI 文本/JSON；web-panel/IDE 中的后台任务列表仍需接入。
- 真正可交互的 attach 仍需 session transport。

### 2026-07-09 第八批

已落地：

- `auto` 权限模式从"硬映射 trusted 策略"升级为可配置分类器。
- 新增 `autoMode.decisions` 设置项，按 riskLevel（low/medium/high）配置 allow/ask/deny。
- 支持两种配置形态：对象形 `{"medium":"ask","high":{"decision":"deny","reason":"…"}}` 与数组形（同 defaults 文档 shape）。
- `confirm` 作为 `ask` 的别名；非法 riskLevel/decision 值被忽略（fail to defaults），配置 typo 不会放宽也不会击穿 gate。
- 决策结果携带可解释字段：`via=auto-mode-config`、`reason`、`rule{riskLevel,decision,source}`，denial 记录可见规则来源。
- 仅当配置真正偏离默认映射时才包装 ApprovalGate；未配置路径字节不变（`via` 等全部保持原状）。
- 包装器在 CLI 层实现（`auto-mode-config.js`），不改 `@chainlesschain/session-core`，避免触发 npm publish 链。
- 硬 shell-policy deny 在 gate 之前就返回，`autoMode.decisions` 无法 up-authorize 硬拒绝命令。
- `cc agent`（headless-runner）与 stream 变体（headless-stream）两条装配路径同步接线。
- `cc auto-mode config` 摘要与 `--json` 现在展示解析后的 riskLevel→decision 映射、来源与 customized 标记。
- 增加单元测试覆盖 resolver 两种配置形态/非法值忽略/等值不算 customized、gate 包装器 allow/deny/ask/无 confirmer fail-closed/confirmer 转发、headless-runner 装配（customized 才包装、manual 不包装、默认 auto 保持裸 gate + trusted）。

仍待后续：

- ~~REPL 交互式会话的权限层（permission-tier）尚未消费 `autoMode.decisions`~~（第九批已落地）。
- 决策解释链仍只到"单条规则"粒度；managed/settings/shell-policy/approval-gate 的逐层决策链展示待做。
- `autoMode.decisions` 目前只按 riskLevel 分类；按 tool 名/命令 pattern 的细粒度匹配可作为后续扩展。

### 2026-07-09 第九批

已落地：

- REPL 交互式会话消费 `autoMode.decisions`：新增 `auto` 权限模式（`/permissions auto`，别名 `auto-mode`/`automode`）。
- `auto` 骑在 trusted gate tier 上，同时激活 autoMode.decisions 分类器包装（`createAutoModeApprovalGate` 新增 `isActive` 谓词，REPL 常驻安装、按当前模式动态生效/让行）。
- 包装在 setConfirmer 之前完成，`ask` 决策走 REPL 的交互式审批提示（y/always/N），非 headless 的 fail-closed。
- 未定制 decisions 时不安装包装器，`/permissions auto` 行为等同 trusted（有提示说明）；已定制时切换到 auto 会显示 low/medium/high 映射摘要。
- Shift+Tab 循环把 auto 当 trusted 参与（auto → autopilot），循环也是退出 auto 的方式。
- `/permissions`（无参）现在显示当前模式行；usage 文案补 `auto`/`manual` 别名。
- `parsePermissionTier` 新增 `manual` 别名（→strict）；新增纯函数 `parsePermissionModeArg`（auto 感知）。
- `cc agent --permission-mode` 现在对交互式会话也生效（manual/auto/acceptEdits/bypassPermissions 及各别名；显式 flag 优先于 bundle approvalPolicy；dontAsk/plan 仍 headless-only）。
- REPL denial 记录的 `permissionMode` 元数据现在如实携带 `auto`。
- **顺带修复预存 bug**：`resolveAgentPolicy` 显式白名单丢弃 REPL 消费的键——交互式 `cc agent` 的 `--vim`/`--think`/`--thinking-budget`/`--fallback-model`/`--pdh`/`--output-style` 此前全部被静默丢弃（与当年 systemPrompt 同类 bug，有既有回归守卫先例）；本批补齐 7 键透传 + 新守卫测试。
- 单元测试：parsePermissionModeArg 别名/普通 tier/非法值、describeTier(auto)、isActive 动态让行/生效、policy 透传守卫 ×2。

仍待后续：

- 交互式 `dontAsk`（不问直接 deny 而非弹审批）尚未支持——headless 语义在交互场景的取舍待定。
- REPL 的 auto 模式切换只影响本会话；`cc session policy --set` 侧尚无 auto 概念。
- 决策逐层解释链、按 tool/pattern 细粒度匹配同上批待做。

### 2026-07-09 第十批

已落地：

- **可交互 attach 的 session transport**：background worker 每会话托管本地 NDJSON 控制通道（Windows named pipe `\\.\pipe\cc-bg-<id>` / POSIX domain socket），端点+随机 token 写入 0600 state 文件（持有 state 文件=能力，防同机他用户注入 prompt）。
- 协议：client→worker `hello(token)/prompt/status/stop/detach`；worker→client `hello/accepted/status/error/turn-started/turn-ended/idle/stopping/closing`；NDJSON 带 carry buffer（跨 chunk 分帧安全）。
- **worker 多轮 turn 循环**：初始任务=turn 1；prompt 队列；child 退出后若有排队 prompt → `followUpArgv + ["-p", text]` 续轮（同 `--session` 自动续接对话历史）；有客户端 attach 时进 `phase=idle` 存活等待；仅当「无 turn 运行 + 队列空 + 无客户端」才 finalize 退出。
- `launchBackgroundAgent` 新增 `followUpArgv` 模板（`buildFollowUpArgv` 纯函数从原 argv 剥掉首轮 prompt token——positional/`-p <val>`/裸 `-p` 三种来源；其余 flags（model/permission-mode/session 等）逐轮沿用）；未带模板的旧会话 transport 拒绝 prompt（明确报错）。
- **`cc attach <id>` 交互模式**：TTY + transport 可用 + running 时默认交互——日志尾随 + 键入文字即发 follow-up prompt，`/stop` 截断当前轮，`/status` 查询，Ctrl-C/`/detach` 断开（turn 运行中断开→任务继续后台跑；idle 断开→会话收尾）；连接失败自动回退日志模式；`--no-input` 强制纯日志。
- launcher 改为 spawn 前写初始 state + spawn 后 merge pid，且 worker heartbeat 重申 transport 字段——双保险防 launcher/worker 竞写丢 transport 端点。
- 外部 `cc daemon stop` 语义保持：finalize 不覆盖已记录的 stopped 状态，只清理 transport 端点；worker heartbeat 发现外部终态时自我回收。
- `cc daemon view` 显示 `phase`/`turns`/`transport: interactive attach available`。
- 测试：transport 单测 7（token 认证/错 token 拒绝/prompt 队列+错误中继/broadcast/detach 计数/跨 chunk 分帧/CRLF+坏 JSON 容错/管道命名）+ **真进程 E2E**（launch→等 transport 发布→connect→turn 1 运行中排队 prompt→`/stop` 截断→turn 2 自动续跑带 `-p "second task"`→detach→worker finalize completed + transport 清空 + turnCount=2）+ buildFollowUpArgv 4 场景 + view 格式。

仍待后续：

- 交互 attach 的输入行与流式日志同终端混排，长输出时提示行可能被冲掉（v1 接受；可做全屏/alternate-screen 渲染）。
- follow-up turn 输出仍走日志文件轮询（500ms 粒度）；可升级为 worker 直推输出流。
- ~~web-panel/IDE 复用同一 transport 协议接后台会话面板~~（第十一批已落地 web-panel；IDE 插件可复用同一 `bg-*` WS 协议）。
- `--print=value` 等号形式的 prompt token 不会从 followUpArgv 剥除（commander 后者优先，行为仍正确，仅 argv 冗余）。

### 2026-07-09 第十一批

已落地：

- **`bg-*` WS 协议**（`gateways/ws/background-agent-protocol.js`）：web-panel/IDE 通过 CLI 的 WS server 复用后台 session transport——`bg-list`/`bg-view`/`bg-attach`/`bg-prompt`/`bg-stop-turn`/`bg-detach`/`bg-stop`；attach 期间服务端向该客户端推送 `bg-event`（worker 生命周期事件中继）与 `bg-log`（日志增量，500ms 轮询）。
- **token 永不过 WS 边界**：`sanitizeBackgroundSession` 剥掉 `transport.token`（本机接管能力），对外只暴露 `interactive: true/false`；pipe 握手由 server 进程（同用户）代做。
- 幂等 re-attach（面板重连重发 bg-attach 不叠加中继）；WS 客户端断连自动清理其全部中继（与 CLI detach 语义一致：idle worker 无客户端自行收尾）；`bg-stop` 先撤中继再杀会话，避免与 finalize 竞态。
- **web-panel「后台 Agent」面板**：`BackgroundAgents.vue` + `backgroundAgents` store + 路由 `/background-agents` + 双导航菜单项——列表（状态/phase/轮次/耗时/接管/终止）+ 接管卡片（日志流自动滚动 + follow-up prompt 输入 + 停止本轮 + 断开 + 事件行 + 会话结束标记）。
- 测试：CLI 侧 7（sanitize 不泄 token / list/view / 真 transport attach-prompt-stop-turn-事件-日志增量-幂等重连-detach / 死会话与未 attach 拒绝 / 断连清理 / **真 WS server 全链路**——真 socket 走 dispatcher 发 bg-list/attach/prompt、worker broadcast 推回、断 socket 中继归零、token 不出现在任何 wire frame）+ web-panel store 7（bg-list/attach 种子/推送过滤/transport-closed/prompt/detach 容错/stopSession/轮询 teardown）+ 路由计数守卫 65→67 同步。web-panel 全套 2318 绿 + vite build 过。

仍待后续：

- IDE 插件（VS Code/JetBrains）侧的后台面板 UI 尚未接——协议已就绪，插件可直连 CLI WS 发 `bg-*`。
- 面板日志目前整段 append；超长日志可做虚拟滚动。
- bg-attach 面板暂无 rename 入口（CLI `cc daemon rename` 已有，协议可加 `bg-rename`）。

### 2026-07-09 第十二批

已落地：

- **决策逐层解释链**：run_shell 被拒时 result 附带 `permissionChain`——`settings-rules`（decision/rule 或 no-match）→ `shell-policy`（decision/ruleId/reason）→ `approval-gate`（decision/via/policy/riskLevel + autoMode 规则与 reason 透传）。
- shell-policy 硬拒（gate 未被咨询）不出现幻影 gate 层；`ruleAllowed` 短路路径的 shell 硬拒同样带两层链。
- `shell-approval.js` 透传 `gateReason`/`gateRule`（第八批 autoMode wrapper 的可解释字段就此接通到 denial 面）。
- `classifyDenial` 提取 chain；`formatDenials`（REPL `/permissions denials`）与 `formatRecentDenials`（`cc permissions recent`）各加一行紧凑链渲染（`formatDenialChain` 共享）。
- `permission-denial-store` 持久化 chain（旧记录 null 兼容）。
- 真机例证：`settings-rules→allow (Bash(rm:*)) · shell-policy→deny (dangerous-delete)`——一眼看清「allow 规则为何没生效」。
- 修接线：`settingsVerdict` 从 executeTool 外层传入 executeToolInner（此前只传 ruleAllowed）。
- 测试：agent-core 三场景（gate deny 全三层含 autoMode reason/rule / 硬拒无幻影层 / allow 规则短路后命令真执行）+ classifyDenial 提取与旧形状无 chain 字段 + formatDenialChain 渲染 + store 持久化跨进程回读渲染。

仍待后续：

- 链目前只覆盖 run_shell（denial 最主要来源）；settings deny/host deny 的 early-return 无链（彼时后续层未被咨询，属正确语义），但 read_file/write 等其它工具的 guard 层（sensitive-file/credential/destructive-git）尚未挂链。
- hook（PreToolUse）拒绝暂不在链内。

### 2026-07-09 第十三批

已落地：

- **autoMode.decisions 按 tool/commandPattern 细粒度匹配**：数组形规则的 `match` 现支持 `tool`（精确名）与 `commandPattern`（`*` glob，anchored、case-sensitive、正则字符转义防注入）；可与 `riskLevel` 组合。
- 语义：细粒度规则按声明序在 riskLevel map 之前求值，第一条全条件命中者胜；未命中落回 riskLevel map（现行为不变）；非法值忽略 fail-to-defaults。
- 决策结果的 `rule` 字段带 `match` 详情（接上第十二批解释链——denial chain 里能看到命中的具体规则）。
- `cc auto-mode config` 摘要显示 rule 行；`--json` 输出 `rules` 数组。
- **顺带修真 bug（第八批遗留）**：`loadAutoModeConfig` 此前用 `mergeSandboxSettings` 合并层级配置，其数组分支 `map(String)` 把数组形 decisions 的规则对象全毁成 `"[object Object]"`——数组形配置在真实 settings 读取路径上从未生效（第八批真机验证用对象形未暴露）。新 `mergeAutoModeSettings`：decisions 数组=有序规则集、closer layer 整体替换；标量/对象保持原语义。补两条回归测试（穿层保真 + closer 替换）。
- 测试：resolver 细粒度收集/声明序/非法 pattern 忽略 + gate 规则优先/glob 不过度匹配（`npm *` 不吃 `pnpm install`）/tool-only/riskLevel-scoped/落回 map + merge 回归 ×2；真机 `cc auto-mode config` 验证 rule 行与 customized 判定。

仍待后续：

- commandPattern 目前仅 `*` 通配（有意保守）；`?`/字符类等按需再扩。
- 细粒度规则只在 auto 模式生效（by design——manual/acceptEdits 不消费 decisions）。

### 2026-07-09 第十四批（小项收口）

已落地：

- **`cc daemon resume <id> <prompt...>`**：崩溃/完成/停止的后台会话按 `sessionId` 续接为新的后台运行（`agent --session <sid> -p <prompt>` 最小 argv——原 argv 有意不持久化防 secrets 落盘，model/flags 走 config 默认；headless 自动重放 JSONL 对话史）；running 会话拒绝并指引 `cc attach`；WS 侧对应 `bg-resume`。这补上了第一/四/五批「crash reconnect」的用户可用形态：崩溃会话不丢，一条命令续跑。
- **`bg-rename` WS 协议 + 面板重命名/续跑入口**：web-panel 表格加「重命名」（所有会话）与「续跑」（非 running 且有 sessionId）modal；store 新增 `renameSession`/`resumeSession`。
- REPL `/permissions denials` 尾部提示跨会话入口 `cc permissions recent`（第六批遗留小项）。
- `buildFollowUpArgv` 处理 `--print=<value>` 等号形式（第十批遗留）。
- 顺带：command-manifest 重生同步第十批更新的 attach 描述。
- 测试：resume argv/followUpArgv 构造 + running/无 sessionId/空 prompt 三拒绝 + equals-form 剥除 + bg-rename/bg-resume 协议（token 不泄露、running 拒绝）+ web-panel store rename/resume/空输入短路。

仍待后续（明确不做/待拍板，非工程遗留）：

- ~~交互式 `dontAsk`~~（第十五批已落地）。
- IDE 插件（VS Code/JetBrains）后台面板 UI——`bg-*` 协议已就绪，属独立插件发版批次。
- attach alternate-screen 渲染 / 日志直推 / 面板虚拟滚动——UI polish，v1 行为已接受。
- `cc session policy --set` 增加 auto 概念——与 REPL auto 模式的会话级持久化联动，待拍板。
- 第二/三/四阶段（MCP tool search / Agent SDK / 跨端 remote-control）为路线图级 epic，另立计划。

### 2026-07-09 第十五批（第一阶段无保留收口）

已落地：

- **交互式 `dontAsk` 模式**：`/permissions dontask`（别名 `dont-ask`/`noask`/`no-ask`）+ `cc agent --permission-mode dontAsk` 对交互式会话生效——骑 strict gate tier，两处交互式 confirmer（ApprovalGate 审批提示 + settings/hook `ask` 规则与 guard 提示）在 dontAsk 激活时不弹窗直接 deny，打一行黄字说明；Shift+Tab 把 dontAsk 当 strict 参与循环（循环即退出）；`/permissions` 无参显示与 usage 同步。
- **修 rename 竞态（全量套抓到）**：worker 状态写是 read-modify-write（heartbeat/transport/turn 合并），rename 落盘撞进某次 read→write 窗口会被 worker 旧快照覆盖（批10 启动期写风暴放大了窗口）；`renameBackgroundAgent` 改为写后 15ms 校验 + 基于最新 state 重套（≤4 次有界重试）。满载全套曾复现失败，修后隔离 4 连稳。
- 测试：parsePermissionModeArg dontAsk 别名/形状同步 + REPL 相关套件 69 绿。

**第一阶段 4 项全部完成**：① manual/auto/dontAsk 三模式（headless 批1 + auto 分类器批8/13 + REPL 批9/15）② `cc auto-mode defaults/config`（批2/13）③ `cc daemon status/stop`+`cc attach`+`cc logs`（批1/7，交互 attach 批10）④ rename/crash/stale-lock（rename 批5+竞态修复批15；crash→`cc daemon resume` 批14；stale heartbeat/PID reuse 批4）。

### 2026-07-09 第十六批（第二阶段 上下文规模化 1-3 全落地）

已落地（新模块 `src/runtime/mcp-tool-search.js`）：

- **MCP tool search（延迟 schema，第 1 项）**：当 MCP tool schema 估算 token 超过阈值（默认 auto = 窗口的 10%），每个 MCP 工具定义被就地替换为紧凑 stub（名字 + `[deferred]` 一行摘要 + 空 parameters），并追加内部工具 `tool_search`。模型用 `select:<name>`（逗号分隔多名/唯一裸名）或关键词（name 命中 ×3 > description ×1，`+term` 必须出现在名字里）检索；完整 schema 从 **tool result**（对话内容）返回，不改写 tools 数组。
- **配置面**：settings `mcp.toolSearch { enabled: auto|true|false, thresholdRatio, maxResults, alwaysLoad: ["server"|"mcp__s__t"|"mcp__s__*"] }`（分层合并 closest wins，非法值 fail-to-defaults）+ env `CC_TOOL_SEARCH=1|0|auto` 覆盖。off / 低于阈值路径**字节不变**（wiring 对象不被触碰）。
- **直接调用自愈 gate**：未先 search 就直接调 deferred 工具 → 返回内嵌完整 schema 的错误并标记已加载（该次调用不出 CLI，不打真 server），重试即通过——最多浪费一轮。
- **prompt cache 友好（第 2 项）**：stub 常驻 tools 数组（Anthropic 路径的尾部 `cache_control` 断点因此稳定，见 agent-core chatWithTools 的 anthropicTools 序列化）；stub 按名字典序排序（与连接顺序解耦）；schema 装载走 tool result（append-only）；`applyToolSearchDeferral` 可重入——晚连接 server 的新工具以 stub **追加在数组末尾**（缓存前缀已见部分不重排）。集成测试断言跨 turn tools 数组引用+内容双稳定。今日无 mid-session 连接面（`/mcp`、`/ide` 均只读状态），重入路径为未来 late-connect 备好并有测试；server 断开不改 tools 数组（本就 prefix 稳定，调用报连接错误）。
- **`/context` MCP 一节（第 3 项）**：REPL `/context` 在角色分桶后新增「MCP tool schemas (sent every request)」——per-server 工具数/token/窗口占比、tool search 状态（deferred/loaded/saved）、优化建议（超阈值未启用→提示开启；最大 server 点名→建议 alwaysLoad 收窄或断开）。`describeMcpToolContext` 输出 sent vs full 双口径。headless `cc context` 不加（归档 JSONL 不含工具定义，无从重建）。
- **顺带**：MCP `initialize` 的 server `instructions` 此前被丢弃——现 mcp-client 捕获（`entry.instructions` + connect 返回），`setupMcpFromConfig` 聚合成 `instructionsByServer`，tool_search 结果按 server 附带（deferred server 的使用指引仍能按需到达模型）。
- **接线**：headless-runner + headless-stream + agent-repl 三处 `resolveAgentMcp` 后统一 `maybeApplyToolSearch`（deps 可注入）；dispatch 在 agent-core `kind: "tool-search"`（只读本地，同 list_skills 风险级，无审批门）+ `kind: "mcp"` 分支前置 deferred gate。agent-core 无新增导出（lib shim 无需同步）。
- 测试：单测 30（config 分层/env 覆盖/非法值/alwaysLoad glob 锚定/排序/重入 append-only/select 与关键词语义/gate 自愈/context 口径）+ 真 loop 集成 3（search→call 全链路含 serverInstructions、直调自愈两连、CC_TOOL_SEARCH=0 legacy 路径等价）；mcp-client 95 / headless-runner+stream+cc-context 83 / agent-repl 50 / shim-parity+parity-mcp-invoke 45 回归全绿。

仍待后续：

- headless `cc context` 若要展示 MCP 占用，需在 session_start 事件记录工具面摘要（待拍板）。
- ws-session-gateway（web-panel 会话）用独立的 externalTools 组装路径，未接 tool search（web 面板上下文预算另议）。
- auto 阈值默认 10% 是否合适待真实大 MCP 面校准；`alwaysLoad` 建议可做成 `/context` 一键写 settings（polish）。

### 2026-07-09 第十七批（第四阶段 #1 — `cc remote-control` 统一入口）

已落地：

- **`cc remote-control`（alias `rc`）**：把既有 remote-session 栈（WS server + E2EE relay + registry + 幂等 ledger + push + audit）组合成 Claude-Code `/remote-control` 形态的统一入口。`start`（默认子命令）在进程内起 WS server，再开一个 loopback 客户端充当 remote session **host**（registry 语义：host 断连即整会话关闭，故该连接常驻），自动 `session-create` + `remote-session-create`，打印配对 URI（可选终端 QR）。`status`/`stop` 通过 `~/.chainlesschain/remote-control/<port>.json`（0600，含 server token，与 ide/<port>.json 同本地信任域；status 输出侧脱敏）跨进程发现。
- **双模配对**：配置 relay（`--relay-url`/`CC_REMOTE_SESSION_RELAY_URL`/config `remoteControl`/`remoteSession`）→ 原生 E2EE `chainlesschain://remote-session/pair#…` URI；无 relay → **direct LAN** 模式，新 `chainlesschain://remote-control/pair#<b64url json>`（v1，内嵌 wsUrl/serverToken/remoteSessionId/一次性 pairingToken/scopes/expiresAt），同一字符串既是深链也是 QR 载荷。`--scopes` 默认全四 scope（observe,prompt,approve,interrupt）。
- **QR 为渐进增强**：懒加载可选 `qrcode` 包（不加硬依赖，规避 trap #6/#27 hoisting 装机崩），不可用回退纯 URI + 提示。
- 新 `src/lib/ws-rpc-client.js`：promise 化最小 WS RPC 客户端。**坑：session 协议回包是 envelope（`createCodingAgentEvent`），`id` 被重用为随机 eventId，关联键在 `requestId`**——client 先按 `requestId` 再按 `id` 匹配；错误文本可能在 `payload.message`。首次真机 smoke 即因此超时（server 侧 session 已建、client 等 `id` 匹配等到超时），据实修复。
- **顺带修真 bug**：`resolveServerPolicy` 白名单丢 `remoteSessionRelayUrl`/`remoteSessionPeerId`——`cc serve --remote-session-relay-url` 自始被静默丢弃、relay 从命令行永远起不来（与第九批 resolveAgentPolicy 丢键同类）。补键 + 回归测试。
- command-manifest 169→170。
- 测试：unit 22（scopes/选项优先级/URI 往返/state 文件/QR 注入/policy 回归）+ integration 2（真 WSServer 全链路：起 host→设备仅凭 URI 载荷真实 join→一次性 token 二次 join 被拒→status 不泄 token→stop 注入 kill）；真进程 E2E smoke：start（免 --session，走 envelope 关联）→跨进程 status(running)→stop→status 空，全通。

仍待后续：

- ~~REPL `/remote-control` slash 入口（agent-repl.js 与并行 session 争用中，待窗口）~~（第二十六批已落地）。
- `devices`/`revoke` 跨进程管理面（registry host-only 语义下需管理密钥通道，v2）。
- 移动端/web-panel 对 direct-LAN URI 的扫码消费（协议已就绪）。

### 2026-07-09 第十八批（第四阶段 #2 — mobile/web 权限审批）

已落地：

- **协议扩展：client-hosted 会话控制事件回传 host**。`handleRemoteSessionPublish` 成员控制分支（prompt/approval.resolve/interrupt）此前只会 dispatch 进**本 server 的 sessionManager**——REPL/headless 这类「以 WS 客户端身份注册本地会话」的 host，设备发的 approval.resolve 会静默 no-op（`handleSessionAnswer` 查不到 session 也回 success）。现在：会话不在 server 侧 → 转发 `remote-session-control` 帧给 host 连接，由 host 进程解本地权限门；host 不可达在 **ledger 之前**报错（不消耗 commandId slot，host 重连后同 commandId 仍可重试）；审计带 `forwarded:true`；server-hosted 路径字节不变（既有 protocol 测试全绿）。
- **host 发布路径 relay/push 平价**：host 发布 runtime 事件的 fan-out 此前只发本地连接的成员——relay 配对的手机（无本地 socket）被静默跳过、也不触发厂商 push。现补 `_mirrorRemoteSessionEvent` 同款逻辑：relay 成员走 E2EE `sendEncrypted`；`permission.request`（命中 `isApprovalRequestEvent`）对带 pushToken 的成员触发 push 唤醒。
- **新 `src/lib/remote-approval-bridge.js`**：`RemoteApprovalBridge`（host 端）——发布 `permission.request`（含 tool/action/detail）、收 `remote-session-control` 的 approval.resolve 解 pending、决策后发 `permission.resolved` 清设备 UI；`makeConfirmer()` 适配 ApprovalGate confirmer 契约（`async (ctx)=>boolean`）：无 fallback = 纯远端 + 超时 fail-closed（默认 5min）；有 fallback = 本地/远端赛跑、本地先答自动 `resolveLocally` 收尾远端 pending。`startHeadlessRemoteApproval()` 一键装配：自起轻量 WSServer（port 0 免冲突、**无 sessionManager**——会话本就 client-hosted）+ bridge + LAN/relay 配对 URI + QR。
- **`cc agent --remote-control`**：headless（`-p`）与 stream-json 双路接线，同 `--permission-prompt-tool` 的 gate `setConfirmer` 挂点（显式 routing 优先：permission-prompt-tool/interactive-approvals 给出时本 flag 让位）；文本模式配对 URI/QR 打到 stderr，stream 模式发 `remote_control` pairing/unavailable 事件；起桥失败保持 fail-closed 并说明原因；finally 阶段桥+server 必拆（端口不外溢）。
- 测试：unit 6（转发三事件/审计/host 不可达不耗 commandId + 重连重试/server-hosted 字节不变/relay 加密投递/push 只醒 request 不醒 resolved）+ integration 6（真 WSServer 全链路：设备扫 URI 配对→gate ask→设备 approve/deny→幂等 replay→本地 fallback 赛跑赢后清远端→超时 fail-closed→approverCount）；真进程 smoke：`cc agent -p "say OK" --remote-control` 打印 direct 配对 URI（ephemeral port）→ turn 正常完成 → 干净退出。headless-runner/stream/protocol/mirroring/ledger 回归全绿。

仍待后续：

- ~~REPL 交互式会话的 bridge 接线（本地终端与远端赛跑已由 makeConfirmer fallback 支持，等 agent-repl.js 争用窗口）~~（第二十六批已落地——注意并未复用 makeConfirmer fallback，见批26 说明）。
- web-panel/Android 客户端消费 `permission.request` 卡片 UI（协议+push 已就绪）。
- `permission.request` 事件带完整决策链上下文（第十二批 permissionChain）——polish。

### 2026-07-09 第十九批（第四阶段 #3 — Monitor / Cron / Push agent 工具）

已落地：

- **两个新 agent 工具（extension tier）**：`notify` + `schedule`。工具集 21→23（`AGENT_TOOLS.length`）。
  - `notify`：把已有多渠道 NotificationManager（Telegram/WeCom/DingTalk/Feishu，`fromEnv`）暴露给 agent——长任务完成/需人决策/报错时推送。`level`→`notifyStart/Success/Failure`；无渠道配置返回 no-op note（不报错）；返回 delivered/failed/channels。新 `src/lib/agent-notify.js`。
  - `schedule`：一个工具五动作（`wakeup`/`cron`/`monitor`/`list`/`cancel`），对应 Claude Code 的 ScheduleWakeup/CronCreate/Monitor。因一次 `cc agent` turn 无法自己续命定时器，工具**持久化意图**到 `~/.chainlesschain/agent-schedule/<kind>.jsonl`（0600），由新命令 `cc agenda run` 真正触发。
- **新 `src/lib/agent-schedule-store.js`**：wakeup（一次性 dueAt）/cron（自带 5-field cron 解析+求值器，`* , - /`）/monitor（命令+间隔+stopWhen 正则+maxChecks）三类共享 JSONL 存储；纯函数、注入时钟、per-row 容错（坏行跳过不毒化全表）；`due()`/`markWakeupFired`/`advanceCron`/`recordMonitorCheck` 生命周期。
- **新 `cc agenda` 命令**（list/run/cancel）：`run` 对每条到期项 wakeup/cron→spawn `cc agent -p <prompt>`（cron 完后 `advanceCron` 推进下次）、monitor→跑命令、输出命中 stopWhen 则 `notify` 并停、否则重挂下一间隔或到 maxChecks 耗尽。effectful deps（spawnAgent/runCommand/notify/now）全可注入。命令数 170→171。
- **策略**：两工具 riskLevel LOW、`planModeBehavior: blocked`（外部副作用/未来副作用不进 plan mode）、非 read-only（会触发 auto-checkpoint，无害）；`notify` 面向用户自己的渠道故 auto flow。
- 测试：unit 29——schedule-store 12（cron 解析/nextCronTime/wakeup due/cron 推进/monitor 命中+maxChecks/坏正则/坏行容错/list+cancel）+ agent-notify 5（无渠道 no-op/level 映射/delivered-failed 拆分）+ agenda 8（list/cancel/dry-run/wakeup 触发/monitor 命中+notify/未命中重挂/spawn 失败 exit1）+ agent-core dispatch 9（三类持久化/list/cancel/参数校验/formatToolArgs）。真机 smoke：`cc agenda list/run/--help` 全通；`AGENT_TOOLS` 含 notify/schedule。工具计数回归（agent-core/parity-open-agents/sub-agent-isolation/persona-filter）21→23、19→21 已同步。contract/tool-search/parity-mcp 回归全绿。

仍待后续：

- `cc agenda run` 的常驻触发（`cc loop --every 1m -- cc agenda run` 或系统 cron/systemd timer）——留给用户按环境接；未内建 daemon。
- monitor 输出的结构化解析（现只 regex over stdout+stderr）；cron 秒级/时区（现分钟级本地时区）——按需再扩。
- `notify` 接 remote-session 已配对设备 push（`cc notification send` 已有独立通道，未与 agent notify 合流）。

### 2026-07-09 第二十批（第四阶段 #4 — dynamic workflow + worktree batch）

已落地：

- **`cc batch` 命令**：把一个大改动拆成 N 个独立 UNIT，每个跑在**自己的 git worktree** 里（有界并发），跑测试，汇总每单元的 agent 状态 / 测试结果 / diff stat / 合并冲突预览。这是 Claude Code `/batch` 形态，复用 `cc team --worktree` 同款 worktree-isolator 原语。
  - `--units <file>`（`{ units: [{key, prompt, test?}] }`）显式单元表；或 `--decompose <goal> --parts N` 让 agent 用 `--json-schema` 结构化输出把目标拆成单元表（`--plan-only` 只出表不跑）。
  - `--concurrency N`（worker pool）/ `--test <cmd>`（默认测试命令）/ `--merge`（干净且测试通过的分支顺序合回 base）/ `--model` / `--json`。
- **新 `src/lib/agent-batch.js`**：纯 fan-out + 聚合核心，全 deps 注入（createWorktree/removeWorktree/runAgent/runTest/diffStat/commit/previewMerge/mergeBranch）。**顺序集成**（同 TeamWorktreeCoordinator.integrate）——后一分支与已合入分支冲突时如实报告不覆盖；测试失败的单元即便 committed 也**不合并**（红单元不进 base）；无改动单元跳过集成；`mapPool` 保序有界并发。
- **命令面 `src/commands/batch.js`**：真 deps=worktree-isolator（create/remove/preview/merge）+ 每单元 worktree 内 `cc agent -p --permission-mode acceptEdits`、`git add -A` numstat diff、`git commit --no-verify`；`--decompose` spawn `cc agent --json-schema`。command-manifest 171→172。
- 测试：unit 15（core 8——fan-out/test-failed 不合并/冲突不覆盖/no-changes/agent 错误/并发上限/事件/校验 + 内部 mapPool 保序 + normalizeUnits 默认 key；command 7——缺参/units 文件端到端/测试失败 exit1/decompose plan-only/坏文件）+ **integration 2（真 git repo + 真 worktree）**：两独立单元真 worktree 跑通并双合入 main（a.txt/b.txt 真落地）；两单元改 README 同行→第二个真合并冲突被如实报告（merged=1/conflicted=1，base 未被覆盖）。真机 smoke：`cc batch --help` / 缺参错误路径全通。

**第四阶段 4 项全部完成**：① `cc remote-control` 统一入口（批17）② mobile/web 权限审批（批18）③ Monitor/Cron/Push agent 工具（批19）④ dynamic workflow + worktree batch（批20）。

仍待后续：

- `--decompose` 的单元质量依赖 LLM 拆分（无依赖保证是提示词约束，非强制）；跨单元依赖 DAG 仍走 `cc team`（batch 假设单元互相独立）。
- patch queue / 自动开 PR（现留分支供人 review/merge；未内建 PR 创建）。
- worktree 清理策略：未合并分支保留供检查（已合并的删分支）；大批量下的磁盘占用留给用户 `git worktree prune`。

### 2026-07-10 第二十一批（P1 #9 — TUI/入口一致性：--bare / --disable-slash-commands / --ax-screen-reader）

已落地：

- **`cc agent --bare`**（也认 `CC_BARE` env）：`--safe-mode` 的全部 kill-switch **加** skills（`CC_SKILLS=0`）、plugins（`CC_PLUGINS=0`）与 MCP/IDE/PDH/JetBrains 自动连接关闭——脚本化调用的最小快速面。两个新 env 在各自单一咽喉消费：skill-loader `loadAll`（所有 8 层 skill 一处清空）、plugin-runtime `discoverPlugins`（六类组件收集器全部经此漏斗）。显式输入不被杀：`--mcp-config` 仍加载、显式 `--ide/--pdh/--jetbrains` 仍生效（bare 只杀 ambient 默认）。权限规则保持生效（同 safe-mode 铁律）。
- **`cc agent --disable-slash-commands`**（也认 `CC_DISABLE_SLASH_COMMANDS` env）：交互式 REPL 不再分发 "/" 输入——内建 slash、custom macros（.claude/commands）、MCP prompt 展开全部旁路，行文本原样进模型（与现有「未匹配 slash 落回 LLM」同一条 fall-through）；`/exit`/`/quit` 保留可退出；TAB 补全不再提示 slash。实现为纯谓词+哨兵（`lib/slash-dispatch.js`，哨兵首字符 NUL 保证任何 dispatch 分支永不匹配），零重构 2300 行 handleLine 分发链；经 `resolveAgentPolicy` 白名单透传（批9 丢键 trap 已加回归守卫）。
- **`cc agent --ax-screen-reader`**（也认 `CC_SCREEN_READER` env）：屏幕阅读器友好输出——REPL 强制 mono 主题（chalk level 0，无 ANSI 色码；持久化的 cli.theme 不动）+ 复用 `CC_STATUSLINE=0` 关掉原地重绘状态行。新 `lib/accessibility.js`。headless 文本输出本就是顺序纯文本。
- 顶层 `cc attach`/`cc logs`/`cc daemon` 已于批1/7/10 落地（#9 清单中该项无需重做）。
- 测试：safe-mode 套件扩展（applyBareMode 开关集/请求检测/CC_SKILLS 门经真 CLISkillLoader/CC_PLUGINS 门经真 discoverPlugins）+ accessibility 8 例 + slash-dispatch 谓词与哨兵性质 6 例 + agent-policy REPL 透传守卫加 disableSlashCommands；skill-loader/plugin-runtime/repl-theme/multiline/macro 回归全绿。真机 smoke：`--help` 三 flag 在列；`--bare --ax-screen-reader -p` 打印 8 开关通知后 headless 正常完成。

仍待后续：

- `/tui fullscreen`（#9 清单最后一项）——alternate-screen 渲染与批10 attach 的同类 UI polish，v1 不做。
- screen-reader 模式目前作用于 REPL 主题/状态行；spinner 类命令（`cc ask`/`cc search` 的 ora）按需再扫。

### 2026-07-10 第二十二批（P1 #8 — Windows / PowerShell first-class）

已落地：

- **新 `src/lib/shell-selector.cjs`**：shell 选择的单一决策点——per-call `run_shell { shell }` > settings `shell.windowsDefault`（layered .claude/settings.json，closest wins；仅 win32 生效）/ `CC_WINDOWS_SHELL` env（赢过 settings）> 平台默认。未配置路径**字节不变**（`useDefaultShell:true` → 既有 execSync/spawn shell:true 原样）。PowerShell 路线走**显式 argv**（`powershell.exe -NoProfile [-ExecutionPolicy <p>] -Command <cmd>`）而非 `shell:"powershell.exe"` 字符串，因此企业 ExecutionPolicy 覆盖（settings `shell.powershell.executionPolicy`）能按调用附加且不改机器状态；policy 值对 PowerShell 固定枚举校验——settings typo 无法夹带 argv（注入防护有单测）。3s TTL 配置 memo（run_shell 每调用解析不重复读盘）。
- **`run_shell` 工具契约新增可选 `shell` 参数**（`default|cmd|powershell|pwsh`）：模型可按命令语法（cmdlet/对象管道/$变量）自选 shell。前台（execSync→spawnSync argv，错误按 execSync 契约整形：status/stdout/stderr）与后台（spawn argv）双路接线；结果带 `shell` 字段（降级时带 `shell_note`）。平台语义：`pwsh` 跨平台可用；`powershell`/`cmd` 非 Windows 请求降级到默认 shell 并附注释；win32 显式 `cmd` = 默认路径字节不变（作为 windowsDefault=powershell 时的 opt-out）。
- **权限规则 `PowerShell(...)` umbrella**：映射到 run_shell family（Claude Code settings.json 的 PowerShell 规则原样可用）；shell 级细分可用参数规则形 `PowerShell(shell:pwsh)`（复用 2.1.178 `Tool(param:value)` 机制，因 `shell` 现在是真实工具参数）。
- **hooks 支持 per-hook `shell: "powershell"|"pwsh"`**（settings hook entry 字段，经 settings-hooks 原样保留到 hook-runner）：显式 argv 执行 + ExecutionPolicy 配置同样生效；shell 字段取字面值（Linux 上缺 powershell.exe → 走既有非阻塞 spawn error 面，不静默换 shell）；stdin JSON 决策协议不变。windowsDefault **刻意不**重写既有 hooks（存量 hook 都按 cmd/sh 写）。
- **复合命令 PowerShell 语义**：既有 shell-policy 切分器已覆盖 PowerShell 分隔符（`;`/`|`/`&&`/`||`/换行/`$( )` 子表达式），且已有 `powershell-encoded-command` deny 规则；无需 PS AST，判定为已满足（本批验证并记录）。
- 测试：shell-selector 14（kind/policy 归一化+注入拒绝/argv 构造/优先级/平台降级/layered settings+env 覆盖/非法值 fail-to-default）+ hook-runner PowerShell 路线 6（argv 形状/pwsh/runHooks 透传/fail-to-default/决策协议不变）+ permission-rules PowerShell umbrella 3 + **agent-core 真 spawn 4**（win32 真 powershell.exe 前台 `$(1+1)`→2 语义验证/exit 3 整形/后台任务/POSIX 降级注释——skipIf 平台守卫）；contract/parity/sub-agent-isolation/agent-core 核心+hooks+permission-rules 回归全绿。

仍待后续：

- skills 的 `shell:` 声明——skill handler 是 JS，shell 执行都经 agent 工具链（run_shell 已支持 per-call shell），无独立面；SKILL.md 层面按需再议。
- REPL `!` bash 透传与 `cc ask` 等命令的 shell 选择——run_shell/hook 之外的散点，按需扫。
- PowerShell 输出编码（5.1 cmdlet 重定向场景）依赖 CLI 入口的 chcp 65001；如遇中文乱码个案再按 encoding.md 加显式 `[Console]::OutputEncoding`。

### 2026-07-10 第二十三批（P1 #10 — Artifacts v1：交付物存储 + publish_artifact 工具 + cc artifacts）

已落地：

- **新 `src/lib/artifact-store.js`**：`~/.chainlesschain/artifacts/`（`index.jsonl` 元数据 + `files/<id><ext>` 副本）。`publish` 拷贝文件并记录 id/title/kind/mime/sha256/size/sessionId/createdAt/expiresAt（TTL 默认 30 天，100MB 上限守卫——artifact 是交付物不是构建产物）；per-row 容错 JSONL（坏行不毒化全表）；注入时钟可测；`list/get/storedPath/remove/cleanupExpired`。
- **新 agent 工具 `publish_artifact`**（extension tier，工具集 23→24）：任务收尾时把重要产出（报告/patch/截图/日志/findings JSON）发布为持久 artifact；**对话/transcript 只进元数据，永不塞文件体**（gap 清单「session transcript 只记录 artifact metadata」项由工具返回形状天然满足）。策略 LOW / plan mode blocked / auto flow（写的是用户自己的 store，无第三方 egress）。
- **新命令 `cc artifacts`**（alias `artifact`；list/show/open/remove/clean；命令数 **172→173**，manifest 已重生）：跨会话浏览交付物、按 session/kind 过滤、`open` 输出存储路径供管道/打开、`clean` 按 TTL 清理——直接回应「生成了文件但用户不知道看哪里」。
- 测试：artifact-store 12（publish 元数据不含 body/副本逐字节一致/TTL/坏行容错/remove+过期清理注入时钟/缺源与目录与超限拒绝）+ 命令 runner 3（注入 store）+ **工具 dispatch 3（HOME 重定向真 executeTool：发布+元数据+hint / 缺文件干净报错 / formatToolArgs）**；工具计数回归 4 处 23→24 同步（agent-core ×2 / parity-open-agents / sub-agent-isolation，含 persona 过滤 21→22）；lazy-dispatch 漂移守卫 + contract + persona-system 回归全绿。真机 smoke：`cc artifacts --help`/`list` 空店提示。

仍待后续：

- web-panel/移动端预览与下载（`bg-*` 面板同类接线，属独立批次；store 单点已备好）。
- 过期清理目前是显式 `cc artifacts clean`（可挂 `cc agenda`/cron）；未内建后台清理。
- **命令数 172→173：下次 cli 发版时必扫 ~13 文档面**（mem `cli_command_count_doc_surfaces`），本批未发 npm。

### 2026-07-10 第二十四批（P1 #10 收尾 — web-panel artifact 预览面板）

已落地（代码 commit `e16d488a85`，由并行 session 在发版收尾时连带提交——内容即本批工作）：

- **CLI 侧 `artifact-*` WS 协议**（`gateways/ws/artifact-protocol.js`，与批11 `bg-*` 同构）：`artifact-list`（kind/session 过滤）/ `artifact-show`（元数据+storedPath）/ `artifact-content`（内联预览）/ `artifact-remove` / `artifact-clean`；ws-server 5 个 wrapper + message-dispatcher 5 路由。
- **预览策略（服务端强制上限）**：text 类 mime（text/_ + json/yaml/xml）→ utf8，256KB 硬顶（caller `maxBytes` 只能收窄不能放大）+ `truncated` 标记；image/_ → base64，8MB 硬顶（超限回 `previewable:false` 不灌爆 socket）；其余 mime 元数据-only（提示本机 `cc artifacts open`）。
- **防篡改守卫**：index.jsonl 的 `file` 字段必须是纯 basename——手改索引行 `"file":"../../…"` 无法把 content 路由变成任意文件读（有回归测试）。
- **artifact-store 加 `CC_ARTIFACTS_DIR` env 覆盖**（同 `CC_BACKGROUND_AGENTS_DIR` 惯例，测试/部署隔离用）。
- **web-panel「交付物」面板**：`Artifacts.vue` + `artifacts` Pinia store + 路由 `/artifacts` + 双导航菜单项（FileDoneOutlined）——列表（标题/kind tag/mime/大小/发布时间/会话 + kind 过滤）+ 预览卡（文本 `<pre>` / 图片 data-URI `<img>` / 不可预览显示原因）+ 删除/清理过期。
- 测试：CLI 协议 7（真 ArtifactStore 温 dir：过滤/show/文本 cap+truncated/maxBytes 收窄/图片 base64 逐字节/zip 拒预览/篡改索引拒服务/remove+clean）+ web-panel store 6（list 过滤+倒序/文本与图片预览/失败包含/删除关预览/clean 计数/helpers）+ 路由计数守卫 67→68；web-panel 全套 2464 绿 + vite build 过（tracked dist/index.html 构建后已还原）+ CLI bg-ws 协议回归绿。

仍待后续：

- 移动端（Android/iOS）对同一 `artifact-*` 协议的消费（协议就绪）。
- 预览目前不渲染 Markdown（纯文本 `<pre>`）；富渲染属 polish。
- 下载（浏览器另存）——现只有预览与本机 `cc artifacts open`；可加 HTTP 端点或 blob 下载。

### 2026-07-10 第二十五批（P1 #10 polish — 预览 Markdown 富渲染 + 浏览器下载）

已落地：

- **Markdown 富渲染**：交付物预览对 `text/markdown` 复用面板既有 `MarkdownRenderer.vue`（marked + DOMPurify 消毒 + highlight.js 代码高亮）——store 新增 `previewIsMarkdown` 判定（previewable ∧ utf8 ∧ text/markdown），其余文本仍走 `<pre>`；无新依赖。
- **浏览器下载 `GET /api/artifacts/<id>/download`**（web-ui-server）：完整文件流式下载（WS `artifact-content` 预览路由有 256KB/8MB 上限，本端点不截断）——`fs.createReadStream` + `Content-Type`/`Content-Length`/`Content-Disposition`（RFC 5987 filename\*，标题带扩展名优先，CRLF 清洗）+ `no-store`/`nosniff`。**token 门**：server 配了 wsToken 时下载必须带同一 token（`Authorization: Bearer` 或 `?token=`，sha256+timingSafeEqual 常时比较，与 WS auth 同强度）；未配 token（本机默认）不加门。同一 basename 防篡改守卫（同批24 WS 路由）。`handleApiRequest` 加第三参 `ctx`（附加式，smoke-runner 的 /api/skills 兼容不变），SPA 与 minimal 两个 server 都传 wsToken。
- **面板「下载」按钮**（表格行 + 预览卡）：store `downloadArtifact(entry)` = fetch（token 走 Bearer header，**不进 URL** 防浏览器历史泄漏）→ blob → objectURL → 瞬时 `<a download>` 点击 → revoke；同源相对路径（面板即由该 HTTP server 服务）。
- 测试：CLI 4（真 http server + 真 fetch——300KB 文件逐字节完整下载不被预览 cap 截断 + Content-Disposition/Length；token 门四态 Bearer/?token=/wrong/absent；未知 id 404 + 篡改索引 400；/api/skills 与 SPA fallback 不被遮蔽）+ web-panel store 3（previewIsMarkdown 三态 / download 全链路含 Bearer header 与 blob 点击序列 / HTTP 错误与网络失败包含）；web-ui-server 既有 106+28 回归绿；vite build 过（dist/index.html 已还原）。

仍待后续：

- 移动端消费 `artifact-*` 协议（协议就绪，独立批）。
- vite dev 模式下下载走相对路径需 devServer proxy `/api`（生产面板由同一 server 服务无此问题）——如遇再配。

### 2026-07-10 第二十六批（批17/18 REPL 遗留收口 — 交互式会话的远端审批）

已落地：

- **REPL `/remote-control` slash 入口**（别名 `/rc`；on/off/status）：交互式会话内起停配对——`on` 复用批18 的 `startHeadlessRemoteApproval` 装配（自托管 WS server（OS 分配端口）+ RemoteApprovalBridge），打印配对 URI + 可选 QR；`status` 显示 URI 与 approverCount；`off` 拆桥+关 server，confirmers 立即回落本地。TAB 补全、`/help` 同步；`cc agent --remote-control` 现在对交互式会话也生效（经 `resolveAgentPolicy` 白名单透传——批9 丢键 trap，守卫测试已扩展；headless 起桥失败 fail-closed，交互式则降级 local-only 打黄字警告，因为终端本身仍可审批）。
- **REPL 两个交互 confirmer 的赛跑接线**（新 `src/repl/remote-approval.js`）：ApprovalGate confirmer 与 settings/hook `ask` confirmer 的本地 readline 提示重构为**可取消句柄**（`{promise, cancel}`），`/remote-control` 激活时经 `raceLocalAndRemote` 与配对设备赛跑——先答者胜。未激活路径字节不变（`local.promise` 直接返回）。
- **交互语义与 headless 刻意不同（未复用 makeConfirmer fallback，因其有两处不适配）**：① 远端 `timeout`/`closed` **不是决定**——手机静默不能自动 deny 坐在键盘前的用户（headless 的 fail-closed 超时语义只属于无人值守场景），赛跑落回本地继续等；② 设备先答时**取消本地 readline**（makeConfirmer 的 race 会把本地提示悬挂在 stdin 上吃掉后续输入）+ `canceled` 标记灭掉 stranded idle-timeout 腿（否则几分钟后突然打印"auto-denied"）。本地先答仍 `resolveLocally` 清设备卡片（与批18 同语义）。
- **dontAsk 优先**：dontAsk 激活时不弹本地也不发远端（deny before bridge），语义不变。
- 退出清理：`rl.on("close")` 拆桥+关 server（配对端点不外溢过 session）。
- 测试：unit 11（describeAskContext 4 形态 + race 6 语义——本地胜/远端胜取消/timeout 非决定/closed 非决定/本地 reject 不外抛/无 requestId 容错 + policy 透传守卫扩展 remoteControl）+ **integration 2（真 WSServer + 真 bridge + 真配对设备）**：设备先答→本地句柄被取消；远端真超时→终端仍权威可 allow。agent-repl/permission-prompt/repl-denials/repl-completer/permissions-command/repl-multiline/slash-dispatch/remote-control-lib/agent-policy 回归全绿；`cc agent --help` 真机验 flag 文案。

仍待后续：

- `/remote-control` 与 `cc remote-control start`（批17 统一入口，常驻 server + prompt/interrupt scopes）是两个形态：REPL 内是 approve-only 轻装配；若要 REPL 会话同时被远端 prompt/observe，属 remote-session host 接线（另立批次）。
- web-panel/Android `permission.request` 卡片 UI 与移动端扫码消费（协议+push 已就绪，同批18 遗留）。

### 第一阶段：安全与可运营性 ✅（2026-07-09 批1-15 全部落地）

1. `manual/auto/dontAsk` permission mode。✅
2. `cc auto-mode defaults/config`。✅
3. `cc daemon status/stop`、`cc attach`、`cc logs`。✅
4. background session rename / crash / stale lock 修复。✅

### 第二阶段：上下文规模化 ✅（2026-07-09 批16 落地）

1. MCP tool search。✅
2. prompt cache 友好的 MCP 动态更新。✅（稳定排序 + stub 常驻 + tool-result 装载 + 重入 append-only；无 mid-session 连接面，接口已备）
3. `/context` 增加 MCP tool schema 占用与优化建议。✅（REPL 侧；headless 归档视图待拍板）

### 第三阶段：平台化 ✅（2026-07-09/10 并行 session 出货）

1. TypeScript Agent SDK。✅（`packages/agent-sdk` → `@chainlesschain/agent-sdk` 0.1.0 npm 首发，随 cli `0.162.156` 同 CI run；`protocol.ts` 单一来源 + `PROTOCOL.md`）
2. web-panel / IDE 改用 SDK，而不是各自拼 CLI argv。✅（四端契约化；VS Code 协议 argv/NDJSON framing 委托 vendored agent-sdk，JB 声明 Agent Protocol v1 契约；首会话持久化修复随 IDE `0.37.8`/`0.4.51` 上市场）
3. approval callback、stream event、checkpoint、session resume 成为 SDK 契约。✅（stream-json 事件契约化；SDK 真 CLI e2e 36 例含会话持久化回归）

### 第四阶段：跨端与长任务

1. `/remote-control` 统一入口。✅（2026-07-09 批17 — `cc remote-control` start/status/stop + 双模配对 URI/QR）
2. mobile/web 权限审批。✅（2026-07-09 批18 — client-hosted 控制回传 + relay/push 平价 + RemoteApprovalBridge + `cc agent --remote-control`）
3. Monitor / Cron / Push 工具。✅（2026-07-09 批19 — `notify` + `schedule` agent 工具 + `cc agenda` 消费者 + AgentScheduleStore）
4. dynamic workflow + worktree batch。✅（2026-07-09 批20 — `cc batch` + agent-batch 核心 + `--decompose` 结构化拆分）

## 参考资料

- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude Code commands: https://code.claude.com/docs/en/commands
- Permissions: https://code.claude.com/docs/en/permissions
- MCP: https://code.claude.com/docs/en/mcp
- Prompt caching: https://code.claude.com/docs/en/prompt-caching
- Parallel agents: https://code.claude.com/docs/en/agents
- Agent SDK: https://code.claude.com/docs/en/agent-sdk
- Remote Control: https://code.claude.com/docs/en/remote-control
- Tools reference: https://code.claude.com/docs/en/tools-reference
