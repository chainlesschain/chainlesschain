# CLI 对照 Claude Code 后续补齐建议

日期：2026-07-11  
范围：ChainlessChain `cc` CLI，对照 Claude Code CLI 最新公开文档与 changelog

## 实施状态（2026-07-11 全部落地，未发 npm，随下次 cli release）

14 项全部实现并各自隔离提交（含单测；REPL-only 项不改顶层命令数，仅 `cc cloud`
新增使 commandCount 174→175）。下次 cli 发版需扫 ~13 文档面 + changelog。

| # | 项目 | 提交 | 备注 |
|---|------|------|------|
| P0-1 | agent view TUI (`cc bg view`) | 见 bg-dashboard | 分组/peek/reply/dispatch |
| P0-2 | background supervisor 稳定性矩阵 | supervisor 回归 | assertUsableCwd 等 |
| P0-3 | `/doctor`→checkup + `/checkup` | doctor-checkup | 分层 + `--fix` 安全修复 |
| P0-4 | transcript 防篡改 hash chain | transcript-integrity | `cc session verify` |
| P0-5 | Inbound Channels | channel-manager | webhook/telegram allowlist |
| P1-6 | Computer-use MCP（显式开启） | computer-use-server | 授权门 + 高风险确认 |
| P1-7 | Cloud handoff 自托管 | `1588f5818c` | `cc cloud run/status/attach/list` |
| P1-8 | Routines | routine-store | cron/once/webhook/github |
| P1-9 | PR/session linking | pr-link-ledger | gh 输出解析 + push 查 PR |
| P1-10 | Fullscreen TUI / no-flicker | `5fec63da29` | `/tui` + CC_NO_FLICKER + diff repaint |
| P2-11 | Voice dictation | `357d004631` | `/voice` local-first STT + 降级 |
| P2-12 | Fast mode | `cff654d2ce` | `/fast` latency profile |
| P2-13 | Plugin 治理 | `375ecb247e` | dep 约束 + LSP fallback + in-use |
| P2-14 | 外部 session storage | `7deb7d4201` | `cc session index` SQLite + mirror |

以下原始建议保留作设计记录。

## 结论

当前 `cc` CLI 版本为 `0.162.158`，主干平价已经比较靠前。已覆盖或接近覆盖的能力包括：

- headless agent / stream-json
- 权限模式与 auto mode
- checkpoint / rewind
- MCP tool search
- background session / attach / daemon
- remote-control
- batch / worktree 并行
- Artifacts
- PowerShell / Windows shell 一等支持
- browser_state / Chrome CDP 页面观察
- Agent SDK

剩余最值得补的不是基础命令，而是多 agent 可运营性、长任务稳定性、外部事件进入 session、安全审计、云/远程执行和 CLI TUI 体验。

## P0：最值得优先补

### 1. 真正的 agent view TUI

Claude Code 的 `claude agents` 是一个全屏任务面板，用来管理所有 background sessions：分组、状态、peek/reply、attach/detach、dispatch 新任务、PR 状态等。

现状：

- `cc` 已有 `attach`、`logs`、`daemon status/view/stop/rename/resume`。
- IDE 侧已有 Background Agents 面板。
- 但 CLI 内还缺一个交互式、可长期驻留的 agent view。

建议：

- 新增 `cc daemon view` 或 `cc bg view`，避免与当前 `cc agents` 自定义 subagents 命名冲突。
- 分组显示：
  - `Needs input`
  - `Working`
  - `Completed`
  - `Failed`
  - `Stopped`
- 支持：
  - dispatch 新后台任务
  - peek 最近输出
  - 在 peek 中直接回复
  - attach / detach
  - stop / rename / pin / filter
  - 显示等待审批数量
  - 显示 session 所属 workspace / worktree
  - 显示 PR 链接与状态

### 2. background supervisor 稳定性矩阵

Claude Code 2.1.203-2.1.205 的修复大量集中在 background agents、daemon、attach、worktree、PATH/env、cwd 和状态恢复。`cc` 已有对应基础设施，下一步应做系统级回归矩阵。

建议覆盖：

- attach 时 worker 正在升级/重启，等待并恢复。
- daemon session token 过期后自动恢复。
- background session 继承 dispatch shell 的 `PATH` / provider env / base URL。
- cwd 被删除、锁定、替换成文件、unmounted 时给出一次性清晰错误。
- Windows worktree 删除遇到 NTFS junction / symlink 不越界。
- worktree-isolated subagent 不在 parent checkout 执行 shell。
- nested repository / multi-repo workspace 下 worktree 创建不误拒。
- `Needs input` 回答后不再显示等待。
- 空输出 turn 不把 blocked session 错判回 working。
- Remote Control / web / mobile 面板不会显示 stale running。

### 3. `/doctor` 升级为可修复 checkup

现状：仓库已有 `doctor` 和 REPL `/doctor`，但 Claude 最新把 `/doctor` 做成完整 setup checkup，并有 `/checkup` alias。

建议：

- 新增 `/checkup` alias。
- `cc doctor` 输出分层：
  - installation health
  - Node/npm/cc version skew
  - config load chain
  - invalid JSON / corrupted backup
  - provider auth
  - MCP servers
  - IDE bridge
  - PDH bridge
  - plugin trust/signature
  - duplicate subagents
  - transcript tamper
  - worktree cleanup
- 对安全范围内问题提供 `--fix`。
- 对需要人工权限的问题输出可复制命令。

### 4. Session transcript 防篡改

Claude Code 2.1.205 新增 auto mode rule，阻止篡改 session transcript files。`cc` 已有 JSONL session、plan review 快照和审计基础，适合进一步加固。

建议：

- 为 session transcript 增加 hash chain。
- 每条记录包含 previous hash。
- 增加 `cc session verify <id>`。
- `cc doctor` 检查 transcript tamper。
- auto mode 默认阻止直接改 session store / transcript 文件。
- 被检测到篡改时禁止自动恢复为可信上下文，改走 read-only / warning。

### 5. Inbound Channels

Claude channels 是 MCP server 把 Telegram/Discord/iMessage 等外部事件推入正在运行的 session。`cc` 已有 `notify` / `schedule` 往外通知，但缺“外部事件进入当前 agent”的统一通道。

建议：

- 新增 `cc agent --channels <channel>`。
- 通道事件作为 user-role 或 channel-role 消息进入正在运行的 session。
- 支持双向 reply tool。
- 通道必须有 allowlist / pairing。
- 首批可接：
  - Telegram
  - 企业微信
  - 钉钉
  - 飞书
  - Webhook
  - P2P/Remote Control event

价值：

- 让长任务能响应监控、CI、聊天、审批系统。
- 与已有 remote-control、agenda、notifier 形成闭环。

## P1：高价值增强

### 6. Computer Use / GUI Control

现状：`browser_state` / Chrome connector 更偏只读观察。

建议：

- 新增显式开启的 computer-use / gui-use MCP server。
- 能力包括：
  - screenshot
  - window/app list
  - click
  - type
  - scroll
  - clipboard read/write
  - app launch
- 按 app/session 授权。
- 终端、IDE、文件管理器、系统设置类 app 额外高风险提示。
- 优先顺序：
  - MCP/API
  - shell
  - browser action
  - computer use

### 7. Cloud handoff / teleport 的自有版本

Claude Code 有 `--cloud`、`--teleport`、Ultraplan、Ultrareview、Routines。`cc` 可以做自托管或私有 relay 版本，不必依赖 Anthropic 云。

建议：

- `cc cloud run`
- `cc cloud status`
- `cc cloud attach`
- `cc plan cloud`
- `cc review ultra`
- 本地 repo snapshot / worktree bundle 上传到私有 runner。
- runner 完成后把 plan、patch、PR、artifact 回流本地 session。

适合场景：

- 大仓深度 review。
- 长时间测试。
- 本机资源不足。
- 企业内网 runner。

### 8. Routines API / GitHub trigger

现状：`cc agenda` 已有 wakeup / cron / monitor。

建议把 agenda 升级为 routine 层：

- schedule trigger
- one-off trigger
- API webhook trigger
- GitHub trigger
- run history
- connector/env/network policy
- routine enable/disable
- per routine cost / result summary

命令建议：

- `cc routine create`
- `cc routine trigger`
- `cc routine runs`
- `cc routine stop`
- `cc routine logs`

### 9. PR / session linking

Claude agent view 能显示 session 创建、修改、评论、push 关联的 PR。

建议：

- 新增 PR link ledger。
- 从 `gh pr create/view/checkout/comment/merge` 输出中解析 PR。
- 大输出超过 inline cap 时，从保存文件或完整 command output 解析。
- push 后按 branch 查询 open PR。
- session row 显示 `#123`、checks/review/draft/merged 状态。
- `cc session show` 展示相关 PR。

### 10. Fullscreen TUI / no-flicker

Claude fullscreen renderer 用 alternate screen buffer，解决长对话闪屏、滚动跳动和内存增长。

建议：

- 新增 `/tui fullscreen` / `/tui default`。
- 环境变量 `CC_NO_FLICKER=1`。
- 只渲染 visible messages，历史进入 transcript mode。
- 支持鼠标展开 tool result。
- 支持 transcript search。
- 支持 terminal hyperlink。

## P2：可做但优先级略低

### 11. Voice dictation

Claude CLI 支持 `/voice`。本项目已有 voice / perception 能力，但 CLI prompt dictation 可进一步产品化。

建议：

- `/voice hold|tap|off`
- 本地 Whisper / 系统 STT 优先。
- 云转写可选。
- 支持 agent view dispatch input 和 peek reply。
- SSH/remote 环境给出清晰降级。

### 12. Fast mode 抽象

Claude `/fast` 绑定 Opus fast mode。`cc` 多 provider 场景可抽象成 latency profile。

建议：

- `/fast on|off|status`
- `settings.fastMode`
- provider adapter 可选择：
  - 低延迟模型
  - 高并发 endpoint
  - 较小 reasoning budget
  - streaming coalesce 降低
- 必须显示成本和质量 tradeoff。

### 13. Plugin relevance / dependency constraints / LSP failure isolation

建议补齐插件生态治理：

- plugin dependency version constraints。
- marketplace relevance hint。
- CLI 检测到官方工具时推荐对应插件。
- LSP-only 插件不因没有显式 tool call 被误判 unused。
- 单个 plugin LSP 初始化失败不阻塞同扩展名其他 LSP。

### 14. 外部 session storage

如果要支撑跨设备、云 runner、团队协作，session store 应抽象。

建议：

- 本地 JSONL 继续保留。
- 增加 SQLite index。
- 可选 S3 / WebDAV / Redis / self-hosted API mirror。
- 支持 resume / fork / search / verify。
- 加密和访问控制独立配置。

## 建议实施顺序

1. `cc daemon view` / `cc bg view`
2. background/worktree 稳定性矩阵
3. transcript verify + auto-mode 防篡改
4. `/doctor` / `/checkup` 可修复化
5. inbound channels
6. PR/session linking
7. routines API/GitHub trigger
8. self-hosted cloud handoff
9. computer-use / GUI control
10. fullscreen TUI / voice / fast mode

## 参考来源

- Claude Code changelog：https://code.claude.com/docs/en/changelog
- Agent view：https://code.claude.com/docs/en/agent-view
- Channels：https://code.claude.com/docs/en/channels
- Computer use：https://code.claude.com/docs/en/computer-use
- Claude Code on the web：https://code.claude.com/docs/en/claude-code-on-the-web
- Routines：https://code.claude.com/docs/en/routines
- Ultraplan：https://code.claude.com/docs/en/ultraplan
- Ultrareview：https://code.claude.com/docs/en/ultrareview
- Fullscreen rendering：https://code.claude.com/docs/en/fullscreen
- Voice dictation：https://code.claude.com/docs/en/voice-dictation
- Debug configuration：https://code.claude.com/docs/en/debug-your-config
- 本仓库参考：
  - `README.md`
  - `CHANGELOG.md`
  - `packages/cli/package.json`
  - `packages/cli/src/command-manifest.json`
  - `packages/cli/src/commands/`
