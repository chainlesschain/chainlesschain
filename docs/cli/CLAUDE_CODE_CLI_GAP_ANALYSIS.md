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

- 交互式 `dontAsk`（不问直接 deny）——headless 语义在交互场景的产品取舍待拍板。
- IDE 插件（VS Code/JetBrains）后台面板 UI——`bg-*` 协议已就绪，属独立插件发版批次。
- attach alternate-screen 渲染 / 日志直推 / 面板虚拟滚动——UI polish，v1 行为已接受。
- `cc session policy --set` 增加 auto 概念——与 REPL auto 模式的会话级持久化联动，待拍板。
- 第二/三/四阶段（MCP tool search / Agent SDK / 跨端 remote-control）为路线图级 epic，另立计划。

### 第一阶段：安全与可运营性

1. `manual/auto/dontAsk` permission mode。
2. `cc auto-mode defaults/config`。
3. `cc daemon status/stop`、`cc attach`、`cc logs`。
4. background session rename / crash / stale lock 修复。

### 第二阶段：上下文规模化

1. MCP tool search。
2. prompt cache 友好的 MCP 动态更新。
3. `/context` 增加 MCP tool schema 占用与优化建议。

### 第三阶段：平台化

1. TypeScript Agent SDK。
2. web-panel / IDE 改用 SDK，而不是各自拼 CLI argv。
3. approval callback、stream event、checkpoint、session resume 成为 SDK 契约。

### 第四阶段：跨端与长任务

1. `/remote-control` 统一入口。
2. mobile/web 权限审批。
3. Monitor / Cron / Push 工具。
4. dynamic workflow + worktree batch。

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
