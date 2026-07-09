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
- 一个简洁的 agent view：列表、状态、耗时、cwd、最近输出、attach/stop 快捷入口。

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
