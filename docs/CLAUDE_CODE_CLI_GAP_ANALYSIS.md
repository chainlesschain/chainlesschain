# ChainlessChain CLI 对照 Claude Code CLI 差距与优化建议

> 评估日期：2026-07-11  
> 评估范围：仅 CLI、Headless 与 Agent Runtime，不包含桌面端 UI

## 实施状态（2026-07-11 同日收口；8 批隔离提交，未发 npm，随下次 cli release）

评估时相当一部分建议已在 0.162.155–0.162.159 各批次落地（--bare、daemon 家族、
MCP tool search / managed allowlist / OAuth 刷新重连、agent-sdk、team 预算、
workflow DSL、cc batch、PR 关联、auto/dontAsk 等）。本轮针对审计确认仍缺的项
实施了 8 批；命令面只加子命令（session rename/prune、daemon rm、mcp
trust-project），**顶层命令数 175 不变**（manifest 无需重生）。

| # | 项 | 状态 | commit |
|---|---|------|--------|
| A | 确定性 Headless：`--ephemeral`、init 事件 `protocol_version`/`session_persistence`/`loaded_sources`/`policy_digest`/`tools_hash`、退出码分类（max-turns 3 / 预算 4 / 模型 5 / 配置 6）、`cc agent --capabilities` | ✅ | `c4533ad848` |
| B | 依赖安装安全：pip auto-install 默认关（settings `runCode.autoInstall` / `CC_RUN_CODE_AUTO_INSTALL` opt-in）+ `installAllowlist` + 安装审计 JSONL；agent 脚本默认写 OS 临时目录（`persist:true` 才进项目） | ✅ | `da75cf00c2` |
| C | 凭据卫生：config `llm.apiKeyHelper`（外部命令→OS 凭据库，fail-closed 不静默替换）+ argv `--api-key` 告警 | ✅ | `e5968433ec` |
| D | 沙箱严格模式：`failIfUnavailable` 启动期强制（原声明未执行；headless+交互双路，退出码 6）+ `isolation_level`（os-sandbox/container/policy-only）进 init 事件与 sandboxSummary | ✅ | `2234283eb1` |
| E | Subagent 契约：`disallowedTools`/`maxTurns`/`isolation:worktree`（spawn 参数 + frontmatter 双入口）；**顺手修真 bug**=子代理 tools 白名单从未传入 agentLoop（LLM 面全量工具） | ✅ | `815019c1c1` |
| F | 会话运营：`cc session rename`（append session_rename，哈希链不破）+ `cc session prune --older-than/--keep/--dry-run` + `cc daemon rm [--force/--keep-log]` | ✅ | `d8edee481e` |
| G | MCP 生命周期：`tools/list_changed`+`resources/list_changed` 合并式重拉（不动 in-flight LLM 工具数组，保 tool-search 缓存稳定性）+ 项目 `.mcp.json` sha256 指纹重信任（变更 fail-closed；`CC_PROJECT_MCP_TRUST=1` / `cc mcp trust-project` 重信任） | ✅ | `90d92251db` |
| H | Hooks 硬化：payload `schema_version`（=1）+ 连续失败熔断（3 次开闸/60s 半开，`CC_HOOK_BREAKER_THRESHOLD/COOLDOWN_MS` 可调；block 决策不计失败） | ✅ | `5c346a3f5e` |

评估时已存在（无需实施）：P0 后台 Supervisor 主体（`--bg`/attach/logs/daemon
status/view/stop/rename/resume）、`--bare`、MCP Tool Search/Managed
Allowlist/OAuth 刷新/断线重连/在途快速失败、Agent SDK（0.1.0 已发）、动态工
作流（workflow DSL + team 预算 + batch）、PR 关联（pr-link-ledger）、每
mutating 工具自动 checkpoint、权限模式 auto/dontAsk。

**剩余（显式挂账，非本轮范围）**：Windows WSL2/原生 OS 隔离（环境阻塞）+
run_code 走沙箱；后台 Agent needs_input/idle 状态、默认独立 worktree、
supervisor 级 per-agent 预算、崩溃后风险工具幂等 ledger；Python per-session
venv、pip 版本锁定/hash 校验、winget/brew 统一权限路径；subagent
permissionMode/skills/mcpServers/hooks/memory/effort、单 subagent 精确取消；
turn_id↔checkpoint 显式绑定表、coverage:partial、加密转录；MCP
Elicitation、正式 scope 选择器；hook replay、插件权限声明；快速收益 #7
（从 Commander/Tool Registry 自动生成 CLI 文档）。

以下原始建议保留作设计记录。

## 结论

当前 `cc agent` 已具备 Headless、JSON/NDJSON、权限规则、Checkpoint、Worktree、MCP、Hooks、斜杠命令和多智能体能力。继续补斜杠命令的边际收益已经很低，下一阶段应重点提升运行时安全、后台执行、可恢复性和可编程性。

建议实施顺序：

1. 沙箱、凭据和依赖安装安全
2. 确定性 Bare/Headless
3. 后台 Agent Supervisor 与会话恢复
4. Subagent 契约与 MCP 生命周期
5. Agent SDK、插件与动态工作流

## 优先级建议

| 优先级 | 建议 | 关键落点 |
| --- | --- | --- |
| P0 | 真正的 OS 沙箱 | 当前工具规则无法约束 Shell 子进程。Linux/WSL2 使用 bubblewrap，macOS 使用 Seatbelt；Windows 先支持 WSL2/容器隔离，并明确显示隔离等级。支持 `failIfUnavailable`，不能静默降级。 |
| P0 | 后台 Agent Supervisor | 增加 `cc agent --bg`、`cc agent ps/attach/logs/stop/respawn/rm`。关闭终端后任务继续执行，支持待审批、崩溃恢复、Worktree 自动隔离和逐 Agent 预算。 |
| P0 | 确定性 Headless | 单独增加 `--bare`，与现有 `--safe-mode` 区分；不自动发现本机 Skills、Hooks、MCP、Memory、Commands、IDE/PDH。补充 `--ephemeral`、协议版本、明确退出码和启动 Capability Manifest。 |
| P0 | 依赖与凭据安全 | `run_code` 自动安装依赖应默认关闭，改走专门权限、临时虚拟环境、版本锁定和审计。API Key 不应通过命令行参数或普通配置文件长期明文保存。 |
| P1 | 完整 Subagent 契约 | 补齐 `disallowedTools`、`permissionMode`、`maxTurns`、`skills`、`mcpServers`、`hooks`、`memory`、`effort`、`background` 和 `isolation`，并支持热加载、Fork Context、单独取消和成本统计。 |
| P1 | 会话与 Checkpoint 合并 | 每个用户回合绑定文件 Checkpoint，支持只回退对话、只回退文件或同时回退。补充命名会话、PR 关联、跨 Worktree 恢复、保留期限、加密转录和项目数据清理。 |
| P1 | MCP 生命周期补齐 | 在已有 OAuth、Resources 和 Prompts 基础上，增加动态能力刷新、Elicitation、自动重连、配置指纹信任、多级 Scope、Managed Allowlist 和大规模 Tool Search。 |
| P1 | 公共 Agent SDK | 从现有 Runtime Factory、事件信封和 JSONL Store 抽取 `@chainlesschain/agent-sdk`，提供 Async Iterator、审批回调、外部 SessionStore、Hooks 和 OTel。 |
| P2 | Hooks 与插件统一 | Hook Payload 增加 Schema Version、Trace/Replay、超时和熔断；插件统一打包 Skills、Agents、Hooks、MCP、LSP，并声明权限和依赖。 |
| P2 | 动态工作流 | 复用现有 `cc team` 和 Workflow DAG，增加可保存、可审阅、可恢复的代码化编排 DSL，并限制并发、Agent 总数、成本和执行时间。 |

## P0 重点

### OS 级沙箱

现有权限规则、Shell 黑名单和网络代理属于执行前策略，无法约束已经启动的子进程。真正的沙箱需要由操作系统限制文件系统、网络和子进程继承边界。

最低验收标准：

- 子进程无法写出工作区和会话临时目录。
- 符号链接、路径穿越和子进程链不能逃逸边界。
- 未授权域名和私网地址均被实际阻断。
- 沙箱不可用且配置为严格模式时，Agent 拒绝启动。
- 运行时明确显示 `os-sandbox`、`container`、`policy-only` 等真实隔离等级。

### 依赖安装与凭据

- 自动安装默认关闭，增加 `DependencyInstall` 权限类型。
- Python 使用每会话临时虚拟环境，禁止污染系统解释器。
- 支持版本锁定、Registry Allowlist、Hash 校验和安装审计事件。
- npm、pip、winget、brew 等安装命令统一进入相同权限路径。
- Agent 生成的脚本默认写入会话临时目录，仅显式保存时进入项目。
- 凭据接入 Windows DPAPI、macOS Keychain、Linux Secret Service 和 `apiKeyHelper`。
- 逐步废弃 `--api-key`，避免凭据进入 Shell History、进程列表、日志和 Session Event。

## 后台 Agent Supervisor

建议命令：

```bash
cc agent --bg "调查并修复 flaky test"
cc agent ps --json
cc agent attach <session-id>
cc agent logs <session-id>
cc agent stop <session-id>
cc agent respawn <session-id>
cc agent rm <session-id>
```

应复用现有 JSONL Session Store、Background Task Manager、Worktree Isolator、预算和 OTel。

最低验收标准：

- 关闭终端后任务继续运行。
- Supervisor 重启后可以恢复会话和任务状态。
- 风险工具在崩溃恢复后不会被静默重复执行。
- 状态区分 `working`、`needs_input`、`idle`、`completed`、`failed` 和 `stopped`。
- 每个后台 Agent 默认使用独立 Worktree。
- 支持逐 Agent 的 Turn、Token、美元、时间和并发预算。

## 确定性 Headless

`--safe-mode` 用于排查配置问题，`--bare` 应用于可复现的 CI 和脚本运行，两者不应混为一个概念。

建议新增：

```bash
cc agent --bare --ephemeral -p "review this change" \
  --settings ./ci-agent.json \
  --output-format stream-json
```

`stream-json` 的首条初始化事件应包含：

- `protocol_version`
- `session_persistence`
- `loaded_sources`
- `policy_digest`
- `tools_hash`
- `provider` 和 `model`

同时区分配置错误、权限拒绝、预算耗尽、Turn 耗尽、模型错误和用户中断等退出码。

## P1 重点

### Subagent

完整支持：

- `disallowedTools`
- `permissionMode`
- `maxTurns`
- `skills`
- `mcpServers`
- `hooks`
- `memory`
- `effort`
- `background`
- `isolation: worktree`

主 Agent、Subagent 和 Team Teammate 应共享同一套权限、事件、预算和取消协议。

### 会话与 Checkpoint

每个用户回合关联：

```text
turn_id -> conversation_offset
        -> file_checkpoint_id
        -> tool_calls
        -> permission_decisions
        -> child_agent_ids
```

恢复时允许选择 Conversation only、Files only 或 Conversation and files。Shell 或外部进程修改文件时，应记录 `coverage: partial`。

### MCP

优先补齐：

- `tools/list_changed`、`resources/list_changed`
- MCP Elicitation 与 Headless 结构化审批
- Local、Project、User、Plugin Scope 和明确优先级
- 项目 MCP 配置指纹变化后的重新信任
- Managed Allowlist/Denylist
- 大规模工具的延迟发现和 Tool Search
- OAuth Refresh、断线重连和在途请求快速失败

目标是在接入数百至上千工具时，不把全部 Tool Schema 注入模型上下文。

### Agent SDK

TypeScript SDK 应复用 CLI 的版本化事件协议，并提供 Async Iterator、审批回调、外部 SessionStore、Hooks、Subagents、MCP 和 OTel。CLI、IDE Bridge、WebSocket 和 SDK 使用 Golden Tests 验证事件流兼容。

## 快速收益项

1. 默认关闭自动 `pip install`，Agent 脚本默认使用临时目录。
2. 权限模式补充 `auto` 和 `dontAsk`，统一 `bypassPermissions` 与 Shell 硬黑名单的语义。
3. 为 JSON/NDJSON 事件增加 `protocol_version`。
4. 增加 `--ephemeral` 或 `--no-session-persistence`。
5. 增加命名会话、显式 Session ID 和 PR 关联恢复。
6. 增加 `cc agent capabilities --json`。
7. 从 Commander 和 Tool Registry 自动生成 CLI 文档，消除工具数、命令数和测试数口径漂移。

## 暂不优先

- 更多斜杠命令
- Claude 账号专属的登录、订阅用量和隐私设置命令
- 云端 Remote Control
- 语音和浏览器类交互增强
- 继续扩张 Agent Team UI
- 无预算和隔离约束的大规模 Agent 编排

## 参考资料

- [ChainlessChain Agent 模式命令大全](https://docs.chainlesschain.com/chainlesschain/cli-agent-mode.html)
- [ChainlessChain CLI Agent Runtime 重构计划](https://docs.chainlesschain.com/chainlesschain/cli-agent-runtime-plan.html)
- [ChainlessChain 更新日志](https://docs.chainlesschain.com/changelog.html)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-usage)
- [Claude Code Headless/Bare Mode](https://code.claude.com/docs/en/headless)
- [Claude Code Agent View](https://code.claude.com/docs/en/agent-view)
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Claude Code Dynamic Workflows](https://code.claude.com/docs/en/workflows)
- [Claude Code Authentication](https://code.claude.com/docs/en/authentication)
