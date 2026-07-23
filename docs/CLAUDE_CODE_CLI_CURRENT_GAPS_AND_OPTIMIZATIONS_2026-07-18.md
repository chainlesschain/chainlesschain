# ChainlessChain CLI 对照 Claude Code CLI 当前净差距与优化建议

> 评估日期：2026-07-18  
> 评估对象：`packages/cli`、`packages/agent-sdk` 及 Coding Agent 相关验证链  
> 仓库基线：CLI `0.162.175`
> 对标基线：截至评估日的 Claude Code 官方滚动文档  
> 文档状态：持续复核版；2026-07-22 已复核仓库证据路径、CLI 版本和 Runtime Convergence 验收链。
> 说明：本文只列“当前仍值得投入”的净差距。已落地能力不再重复列为待办，历史实施过程见
> [`CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12.md`](./CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12.md)。

## 1. 结论

ChainlessChain CLI 已经不是一个需要继续补基础命令的早期 Coding Agent。当前代码已覆盖
Headless、JSON/NDJSON、`--bare`、会话恢复、后台 Agent、Worktree、Checkpoint、权限策略、
MCP、Skills、Subagent、Hooks、插件治理、LSP、Review、OTel 和 Agent SDK 等主体能力。

下一阶段最有价值的工作不是继续增加 Slash Command 或扩大 Agent 数量，而是把现有能力收敛为
一个可信、可恢复、跨平台一致的运行时。建议优先投入以下五项：

1. **P0：统一 Process Sandbox Broker。** 所有子进程入口统一经过强隔离、网络策略、凭据代理和审计。
2. **P0：后台 Agent 实时交互总线。** 审批和提问能够在当前 turn 内暂停、回答和继续，而不是结束后另起一轮。
3. **P1：Hooks v2。** 补齐新版事件和五种 Hook 类型，并默认并行、去重、最严决策合并及沙箱执行。
4. **P1：常驻 Event Runtime + MCP Elicitation/Channels。** 让 Agenda、Monitor、Webhook 和 MCP 外部事件真正可持续运行。
5. **P1：统一协议与验收门。** CLI、SDK、IDE、Desktop 共用版本化事件协议和真实端到端发布门，清理已过时的能力文档。

如果资源有限，前两项应先于所有体验类功能。它们决定 Agent 能否安全地长时间自治运行。

### 1.1 完成口径

本文不是实现计划的任务拆分，也不把所有 Claude Code 同名能力都列为缺口；完成口径是：

- 只保留对当前仓库仍有净价值的 P0/P1/P2 差距。
- 每个高优先级差距都有仓库证据、建议设计、验收标准或退出条件。
- 已有能力集中放入基线表，避免在后续路线中重复立项。
- 官方资料仅作为能力面参照，具体判断以本仓库代码和验证链为准。
- 后续若实现任一差距，应在对应章节追加 `Implemented` 记录，而不是另起一份平行 Gap 文档。

## 2. 已有基线：这些不应再作为独立大项目

| 维度            | 当前仓库事实                                                                                        | 判断         |
| --------------- | --------------------------------------------------------------------------------------------------- | ------------ |
| Headless        | text/JSON/stream-json、stream input、结构化结果、预算、turn 上限、`--bare`、`--ephemeral`、能力清单 | 主体已具备   |
| 会话            | 新建、恢复、命名、清理、PR 关联、导出、搜索、哈希链与 Mirror                                        | 主体已具备   |
| 后台 Agent      | `--bg`、attach、logs、stop、resume、状态持久化、PID identity、孤儿回收、副作用台账                  | 主体已具备   |
| 权限            | allow/ask/deny、permission mode、managed policy、项目配置信任、authority envelope、远程审批绑定     | 主体已具备   |
| Checkpoint      | 自动 checkpoint、`/rewind`、conversation/files/both、显式 turn binding、partial coverage            | 主体已具备   |
| Skills/Subagent | 多层 Skill、热加载、隔离上下文、完整约束契约、后台运行、Worktree、精确取消                          | 主体已具备   |
| MCP             | stdio/HTTP、Tools、Resources、Prompts、OAuth、Tool Search、动态 list changed、Roots 通知、重连      | 主体已具备   |
| Plugin          | Manifest、签名/信任、能力声明、能力差异与重新 consent、typed options、LSP/MCP/Hooks/Bin             | 主体已具备   |
| 质量            | LSP、多根工作区、编辑后诊断、多 Agent Review + verifier、Doctor、OTel                               | 主体已具备   |
| SDK             | 已有 TypeScript Agent SDK、NDJSON 协议 fixture、background/session 测试                             | 已有产品雏形 |

因此不建议再单独立项：

- 增加更多同义顶层命令或普通 Slash Command。
- 再造一套基础 Chat/Agent Loop。
- 再造一套普通 Skill、MCP 或 Worktree 管理器。
- 在可靠性和隔离未收口前继续扩大 Agent Team 并发规模。
- 为功能数量平价照搬 Claude 账号、订阅或 Anthropic 专属云能力。

## 3. 当前对标矩阵

| 能力面        | Claude Code 官方能力                                                        | ChainlessChain 当前状态                                                                                                                                                                                                            | 当前净差距                                                                                                          | 优先级 |
| ------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| 进程隔离      | macOS Seatbelt、Linux/WSL2 bubblewrap、文件/网络边界、凭据隔离、严格失败    | Docker + bubblewrap，能报告真实隔离级别；Broker async/sync/PTY 已默认过滤 env/argv，并输出不含值的过滤计数                                                                                                                         | macOS/原生 Windows 缺强边界；仍有 spawn 清单入口、原生模块/外部宿主未统一；按审批目标短期解析凭据仍未成为全路径默认 | P0     |
| 后台人机回路  | 后台任务可暂停、请求权限/输入、恢复和接管                                   | attach 可追问；`needs_input` 已有真实状态                                                                                                                                                                                          | 提问会 park 当前子进程，回答作为下一 turn；缺当前 turn 双向通道                                                     | P0     |
| 权限控制面    | CLI、交互、SDK、IDE 使用同一权限规则和决策来源                              | Agent Runtime 已有 settings rules + ApprovalGate；`cc permissions` 仍是另一套管理面                                                                                                                                                | 用户可能误以为 `cc permissions` 已直接约束 Agent 工具；安全默认和来源解释需统一                                     | P0/P1  |
| Hooks         | 完整生命周期；command/http/mcp_tool/prompt/agent 五类；并行、去重、最严合并 | 稳定 command hook、部分事件、async/replay/trace 已有                                                                                                                                                                               | Hook 类型和事件生产者不全；shell 继承全 env；严格并行仍有 opt-in 路径                                               | P1     |
| MCP 交互      | Elicitation、ElicitationResult、Channels、长调用后台化                      | Tools/Resources/Prompts/OAuth/Tool Search/list changed/roots、Elicitation transport、Desktop/VS Code/JetBrains common schema UX 已有                                                                                               | 完整 schema vocabulary 与部分外部事件 producer 仍待补                                                               | P1     |
| Event Runtime | 后台会话、任务、外部事件和持续监控统一运行                                  | Agenda watch、durable inbox/outbox、lease/retry/dead-letter、Agent IPC、MCP、Webhook、Telegram、Monitor producer 默认接线与有界队列已接入；`cc status --json` 已暴露跨进程队列压力/过期租约，跨 owner 恢复演练会拒绝旧租约迟到结算 | 所有宿主统一启动/托管 worker 与完整长运行副作用恢复演练仍待补                                                       | P1     |
| Context       | `/context` 显示 memory、skills、MCP、文件与缓存成本                         | 已显示消息角色、instruction 文件、实际注入 persona Skill 及 persisted MCP schema 的逐来源归因                                                                                                                                      | Skill 按需加载/缓存命中成本仍不完整                                                                                 | P1     |
| Checkpoint    | 对话与文件按 turn 恢复                                                      | Headless 显式绑定已持久化，REPL 可消费                                                                                                                                                                                             | REPL 还不是统一生产者；child/worktree/user edit/provider tool id 归因不完整                                         | P1     |
| Plugin 安全   | 插件统一打包、作用域、企业治理                                              | 能力声明、consent、签名、typed options、OS secret store、lockfile/SBOM、插件 MCP/LSP/Hook/Monitor/Bin Broker provenance；CLI/cc ui 与 Desktop 主进程 child_process、node-pty PTY Broker 已接入                                     | Desktop/CLI 原生模块和外部宿主入口仍需统一 Broker                                                                   | P1     |
| 关键状态并发  | 会话、审批、任务和副作用状态应原子持久化                                    | Agenda/Event Runtime/session transcript 已使用 fail-closed file lock                                                                                                                                                               | approval/部分 ledger/IDE session 状态仍需统一迁移，避免不同宿主各自写入                                             | P1     |
| 结构化输出    | 标准 JSON Schema、启动期校验、最终 validated result                         | 常用 Draft 2020-12 vocabulary（组合、条件、`$ref`、dependent、pattern、contains、format）、显式 external schema registry 及 stream `structured_result`                                                                             | 完整 meta-vocabulary、自动远程 ref 解析与复杂 schema 互操作性仍待补                                                 | P1     |
| SDK/CI        | TypeScript/Python SDK、版本化事件、GitHub/GitLab 自动化                     | TypeScript SDK 已有                                                                                                                                                                                                                | 部分 goal/approval/turn 事件未完全透传；缺统一发布兼容门；Python/CI 模板按需求决定                                  | P1     |
| 验收与文档    | CLI/IDE/SDK 共享运行时和持续发布验证                                        | 单元/集成测试很多                                                                                                                                                                                                                  | MVP 验证脚本没有覆盖完整 Desktop→真实 CLI 链；多份旧文档仍把已完成项列为缺口                                        | P1     |
| 全进程回滚    | 官方 checkpoint 主要覆盖编辑工具                                            | 已对 shell/外部副作用诚实标记 partial                                                                                                                                                                                              | 可进一步做全工具文件变更捕获，形成强于 Claude Code 的差异化                                                         | P2     |

## 4. P0：统一 Process Sandbox Broker

### 4.1 当前证据

- [`agent-sandbox.js`](../packages/cli/src/lib/agent-sandbox.js#L64) 只接受 `docker` 和
  `bubblewrap`；[`capability-manifest.js`](../packages/cli/src/lib/capability-manifest.js#L83)
  也只公开这两个引擎。
- `bubblewrap` 已有真实 Linux 集成测试，Docker 可提供容器边界，但 macOS Seatbelt 和原生
  Windows 等价实现仍缺。
- Hook command 仍从完整 `process.env` 构造执行环境，但已通过 Process Broker；Broker 会移除已识别
  的敏感环境变量。按 executor 声明最小环境 allowlist 尚未完成。
- `run_shell`、`run_code`、Hook、Plugin Bin、LSP、MCP stdio、CLI/`cc ui` PTY 与 Desktop
  `child_process`/PTY 的已迁移入口现已进入 Broker；静态 spawn 清单中的剩余直接入口、原生模块和
  外部宿主仍无法证明遵守同一文件/网络边界。
- 2026-07-23 已统一 Broker async/sync/PTY 的 CredentialAgent 边界：过滤后的 env 与 argv 会真正
  传给原生执行函数，审计仅记录 env/argv 过滤数量，拒绝路径会先脱敏 argv，过滤器异常时不再让
  sync 路径携带原始凭据继续执行。按 host/process 审批后解析短期值的完整代理闭环仍待补。
- 同日已将 npm 登录态命令、`llm.apiKeyHelper` 外部凭据命令和 MCP OAuth 浏览器启动器从直接
  `child_process` 调用迁移到显式 Broker provenance/scope；静态清单继续作为剩余入口的事实源。
- `cc config edit` 也已移除 shell 字符串拼接：`$EDITOR` 被解析为 executable/argv，配置路径作为
  独立参数经 Broker 传递，路径和编辑器参数中的 shell 元字符不再被解释执行。
- `cc update` 的 npm 全局安装与版本校验同样改为 executable/argv Broker 调用；Windows 使用
  `node.exe + npm-cli.js` 绕开不可由 Node 无 shell 启动的 `.cmd` shim，目标版本不再拼接进命令文本。
- 下载更新后的 ZIP 解压默认执行器也已进入 `update:archive-extract` Broker scope；远程产物路径
  继续只作为 argv/环境值传递，不进入 PowerShell 脚本文本或 POSIX shell。
- Cloud handoff 的 `git bundle`/`git apply` 默认执行器已进入 `cloud:git` Broker scope，真实 bundle
  与三方 patch 回流测试保留；测试注入接口不变。
- Broker `execFileSync` 已恢复 Node 同步契约：成功返回 stdout，启动错误或非零退出抛出带
  `status/signal/stdout/stderr` 的错误；归档解压与 Cloud handoff 共用该实现。
- Broker `execFile` 已恢复 Node 异步 callback 契约：支持 args/options 重载、文本或 Buffer 输出、
  非零退出与启动错误，并对 stdout/stderr 独立执行 `maxBuffer` 限制；未订阅 Broker error 事件时
  ENOENT 也不会触发 EventEmitter 的未处理异常。
- `doctor` 的 npm、Git 探针及 Windows UTF-8 控制台初始化已迁移为 Broker executable/argv
  调用；Windows npm 同样使用 `node.exe + npm-cli.js`，固定命令不再依赖业务模块中的裸 shell。
- Docker/Compose 可用性探针及 up/down/pull/logs/status 已迁移到 `service` Broker scope；compose
  文件路径与服务名保持独立 argv，状态查询不再拼接 shell 命令。
- Desktop 应用启动与 Windows `taskkill` 停止路径已进入 `app` Broker scope；可执行文件路径和 PID
  均作为独立 argv，保留 detached/PID 文件生命周期语义。
- PR 草稿的分支、remote、status 与 commit log 查询已进入 `pr:git` Broker scope；base/branch
  组成单一 revision argv 并使用 Git 的 end-of-options 边界，比较 URL 对 ref 做百分号编码。
- Code review 的 diff 与 changed-files 查询已进入 `review:git-diff` Broker scope；除 staged/cached
  明确别名外，target 作为单一 revision argv 放在 end-of-options 边界后。
- 每轮动态上下文的 branch/HEAD/status 查询已进入 `context:git` Broker scope，保留 1.5 秒超时、
  16 MiB 输出上限和 status unknown/clean 的区分。
- 启动期 npm 更新缓存 refresher 已进入 `update:notice-refresh` Broker scope，保留 detached、
  `windowsHide` 与 fail-open 的被动提示语义。
- REPL `/copy` 的 PowerShell、`clip`、`pbcopy`、`wl-copy`、`xclip` 与 `xsel` 候选执行已进入
  `repl:clipboard-copy` Broker scope；剪贴板正文继续只经 stdin 传递，命令参数禁用 shell 解释。
- REPL `/pr-comments` 的 `gh pr view` 与 inline-comments API 查询已进入 `repl:pr-comments`
  Broker scope，保留 16 MiB 输出上限、ENOENT 友好提示与 inline 评论 best-effort 语义。
- `git push` 后的 PR link ledger 分支探针与 `gh pr list` 查询已进入 `pr:link-query` Broker
  scope，保留 3 秒超时和全路径 best-effort，不让关联信息失败影响 shell 工具结果。
- Routine 的 Agent 子进程与 GitHub events 查询已分别进入 `routine:agent`、
  `routine:github-events` Broker origin；Agent prompt 改经 stdin 传递，不再出现在 argv、进程列表或
  Broker 参数审计中，GitHub 轮询继续保持 8 秒超时和失败降级为空事件列表。
- `cc session pr-status` 的 `gh pr view` 实时信号查询已进入 `session:pr-status` Broker scope；
  PR number/repo 继续作为独立参数传递，并保留 8 秒超时、stderr 抑制与上层 fail-closed 提示。
- `cc review` 命令层的 Git diff 和 `gh` review/comment 调用已进入 `review:command-git`、
  `review:command-gh` Broker origin；用户提供的 base/range 位于 `--end-of-options` 后，review JSON
  继续只经 stdin 传递，并保留 256/64 MiB 输出上限。
- `cc memory file --edit` 已复用无 shell 的 `$EDITOR` 引号解析并进入 `memory:editor` Broker
  scope；编辑器参数与 `MEMORY.md` 路径逐项传递，路径中的引号和 shell 元字符不再被解释。
- `cc team --exec/--agent` 的任务进程已进入 `team:shell`、`team:agent` Broker origin；显式
  `--exec` 保留 shell 任务语义但获得危险命令/凭据边界，Agent prompt 改经 stdin 传递而不进入 argv。
- WebSocket gateway 的远程 CLI 子进程已进入 `gateway:ws-command` Broker scope；命令继续先做
  blocklist 与无 shell tokenization，并保留超时取消、流式/缓冲输出和 Electron-as-Node 环境语义。
- Knowledge-base Git integration 的 argv 与遗留字符串命令已分别进入 `git-integration:argv`、
  `git-integration:shell` Broker origin；commit message 继续逐项传递，旧字符串路径保留既有 ref/path
  allowlist 并在审计中显式标记 shell，便于后续继续消除。
- Hook Manager 的 command/script handler 已由手工补写审计升级为 `hook-manager:command` Broker
  执行；保留 shell、超时、64 MiB 输出上限与 `HOOK_EVENT`/`HOOK_CONTEXT` 环境契约，并统一获得
  危险命令拦截、凭据过滤和执行结果审计。
- Computer Use Windows 控制后端的 PowerShell 原语与应用启动已分别进入
  `computer-use:powershell`、`computer-use:app-launch` Broker origin；脚本和应用参数继续使用独立
  argv 且显式禁用 shell，并保留截图输出上限与 detached 应用生命周期语义。
- Local/Docker/SSH Execution Backend 已分别进入 `execution-backend:local`、
  `execution-backend:docker`、`execution-backend:ssh` Broker origin；Local 保留显式 shell 命令语义，
  Docker/SSH 的宿主机调用已改为无 shell argv，容器/远端命令仅作为单一 `-c`/remote-command 参数传递。
- Workspace npm publish 已进入 `publish-workspace:npm` Broker origin；tag/access 作为独立 argv
  传递，不再经过 shell 拼接，并修复发布成功后误调用不存在的 `logger.succeed()` 而返回失败的问题。
- LAN pairing preflight 的 `which`/`where` 防火墙工具探测已进入
  `lan-pairing:firewall-probe` Broker origin；候选工具名作为独立 argv 传递，继续保持只读、失败降级语义。
- Packer precheck 的 repo root、short HEAD 与 porcelain status 查询已进入
  `packer:precheck-git` Broker origin；三组固定 Git 参数均改为无 shell argv，并保留非 Git 目录的静默降级。
- Packer 的 `@yao-pkg/pkg` 运行器已进入 `packer:pkg` Broker origin；runtime、脚本、配置、targets
  与输出路径继续逐项传递，并新增启动失败与成功产物映射的隔离测试。
- Packer Web Panel 的 `npm run build:web-panel` 已进入 `packer:web-panel-build` Broker origin；
  固定 npm argv 显式禁用 shell，并补齐 npm 无法启动与构建产物发现的隔离测试。
- Agent OS sandbox 的 Docker、bubblewrap 执行与可用性探测已分别进入 `agent-sandbox:docker`、
  `agent-sandbox:bubblewrap`、`agent-sandbox:probe` Broker origin；既有隔离 argv、egress proxy、
  超时/输出限制和 fail-closed 错误语义保持不变。
- Checkpoint store 的 shadow commit、ref、diff 与 rewind Git plumbing 已统一进入 `checkpoint:git`
  Broker origin；继续使用临时 index、无 shell argv 和 128 MiB 输出上限，不触碰用户真实暂存区。
- Packer smoke test 的产物启动与 Windows 进程树清理已分别进入 `packer:smoke-launch`、
  `packer:smoke-taskkill` Broker origin；保留 shim shell 兼容、stdio 管道、进程组 teardown 与端口探测语义。
- Packer OTA apply 的 Windows sidecar 与 POSIX 更新后重启已分别进入 `packer:update-sidecar`、
  `packer:update-restart` Broker origin；路径继续作为独立 argv，保留 detached/unref 与原子替换流程。
- Doctor checkup 的 Git worktree 探测与安全 prune 修复已分别进入 `doctor:git-worktree`、
  `doctor:git-worktree-fix` Broker origin；固定 Git 命令改为无 shell argv，sandbox 可用性探测也复用同步 Broker。
- LSP benchmark 的 Windows/POSIX 进程树 RSS 快照已进入 `lsp:benchmark-rss` Broker origin；
  `wmic`/`ps` 参数保持无 shell argv，同时删除 server registry 中从未使用的原生 `execFileSync` 注入。
- Eval 内置任务的 7 条真实 Node 验证路径已统一收口到 `eval:task-check` Broker helper；
  脚本名保持独立 argv，并统一保留 10 秒超时、stderr 捕获和无 shell 执行语义。
- REPL `!` 命令的 Windows `cmd.exe` 与 POSIX `/bin/sh` 执行已进入 `repl:bang-command`
  Broker origin；显式 shell 文本继续作为单一 argv 传递，并保留输出上限、超时和上下文回填语义。
- Slash command 模板中的 `!`cmd`` 展开已进入 `slash-command:bang` Broker origin；
  保留显式 shell 与失败降级为提示文本的兼容语义，同时获得危险命令、凭据和审计边界。
- Orchestrator 的配置化 CI gate 已进入 `orchestrator:ci` Broker origin；保留显式 shell、
  180 秒超时、64 MiB 输出上限及失败重试/重派发语义。
- Plugin remote install 的 Git clone/checkout 已进入 `plugin:install-git` Broker origin；
  URL、ref 与临时目标目录继续作为独立 argv，并保留 option-looking 值的前置拒绝和 120 秒超时。
- Plugin Monitor 的原生 spawn fallback 已移除；带 provenance 的描述符继续使用 `plugin:monitor`，
  兼容描述符使用 `plugin-monitor:process`，两者共享无 shell、并发上限、超时与统一回收语义。
- Host ADB bridge 的设备枚举与 shell/content 调用已进入 `host-adb:command` Broker origin；
  ADB 路径、serial 和子命令保持独立 argv，并保留超时、输出上限和 typed error 映射。
- Agenda 的定时 Agent 启动与 monitor 命令已分别进入 `agenda:agent-run`、
  `agenda:monitor-command` Broker origin；前者使用无 shell argv，后者保留显式 shell 和失败输出匹配语义。
- LSP Client 的内置 server 原生 spawn fallback 已移除并进入 `lsp:server` Broker origin；
  插件 server 继续携带 `plugin:lsp` provenance，stdio、Windows shim 与初始化超时/回收语义保持不变。
- Video editing 的 FFmpeg/FFprobe/Python 子进程已统一收口到共享 `spawnMediaProcess` Broker
  边界；按 frame extract、scene detect、audio probe/mix/duck、concat/clip extract 记录细分 origin。
- `cc eval` 的 headless Agent 启动与 Windows 进程树回收已分别进入 `eval:agent-run`、
  `eval:agent-tree-kill` Broker origin；argv、POSIX process-group kill 与超时后等待退出语义保持不变。
- Chrome connector 的 detached 浏览器启动已进入 `chrome-connector:launch` Broker origin；
  CDP 端口、profile/URL 字面 argv、进程 unref 与可注入测试边界保持不变。
- Claude/Codex 外部 CLI bridge 的版本探测与 Agent 会话已进入 `claude-code-bridge:detect-*`、
  `claude-code-bridge:agent` Broker origin；前者显式保留 Windows shim shell，后者保持无 shell argv。
- CLI-Anything 宿主侧的 Python/package 探测、pip install 与 tool help 已进入 `cli-anything:*`
  Broker origin；生成到用户 Skill 的 CLI-Anything/CLI Pack CommonJS handler 也改由 CLI 宿主按
  `shell-exec` capability 注入受限 Broker 门面，缺少门面时 fail-closed，CLI-Anything 参数使用
  literal argv；Agent `run_skill` 的同门面注入仍待补齐。
- Background task harness 的 worker 启动与任务命令已进入 `background-task:worker`、
  `background-task:command:*` Broker origin；Node `execArgv`、stdio IPC、heartbeat/result 消息语义保持不变。
- MCP stdio client 的普通与插件 server 启动已统一进入 Broker；普通 server 自动记录
  `mcp:server:<name>` origin，插件继续透传 plugin provenance，stdio/env/失败清理语义保持不变。
- Worktree isolator 的 branch/porcelain 查询已复用 Broker 化 `gitExecArgs`；3 处 shell 字符串
  改为 literal Git argv，并统一继承 64 MB 输出上限与 `git-integration:argv` provenance。
- Agent IPC bus 的 subagent stdio 启动已进入 `agent-ipc:subagent` Broker origin；
  初始化握手、Agent identity env、可选 shell 兼容和 heartbeat 生命周期保持不变。
- `cc loop` 的每轮外部命令/Agent 启动已进入 `loop:iteration` Broker origin；
  exec 模式保留 Windows shim 所需 shell，prompt 模式继续使用字面 argv。
- 后台 Agent supervisor/worker 的 PID 创建时间探测、detached worker/turn 启动与 Windows 进程树清理
  已进入 `background-agent:*` Broker origin；IPC stdio、测试注入缝、PID 复用保护和孤儿回收语义保持不变。
- `cc batch` 的 Agent/分解运行、用户测试命令与 Git 暂存/差异/提交已统一进入 `batch:*`
  Broker origin；Agent/Git 保持字面 argv，测试命令保留显式 shell，真实 worktree 集成测试继续通过。
- 后台会话 dashboard 的新 Agent 分发已进入 `background-session:dispatch` Broker origin；
  保留 detached/unref、无 stdio 与字面 prompt argv 语义。
- Team worktree 的任务 shell 与 Git 暂存/提交已分别进入 `team-worktree:task-command`、
  `team-worktree:commit` Broker origin；真实并行 worktree 合并与冲突集成测试保持通过。
- Agent worktree 的 Git identity/status 查询与验证后清理已移除 shell 字符串，统一改为
  `agent-worktree:query` / `agent-worktree:cleanup` Broker 字面 argv；失败清理 E2E 验证无残留。
- Status line 的 CJS 渲染核心已移除原生 `child_process` 默认值，由 ESM 适配层注入
  `status-line:command` Broker runner；保留显式 shell、stdin JSON、终端尺寸与 best-effort 降级语义。
- Desktop Coding Agent bridge 与 sub-runtime pool 已移除各自的原生 spawn 默认值，统一经 fail-closed
  Desktop Broker 门面记录 `desktop:coding-agent-server` / `desktop:sub-runtime` provenance。
- Desktop Advanced Features IPC 的脚本启动已进入 `desktop:advanced-features-script` Broker origin，
  并改用 `process.execPath` + 字面 argv，保留脚本输出和退出码契约。
- Desktop command/script HookExecutor 已显式使用 fail-closed Desktop Broker，并记录脱敏的 Hook
  id/name/type/event provenance；函数 Hook 语义与测试注入接口保持不变。
- REPL `/goal exit-zero` 的命令检查已进入 `repl-goal:exit-zero` Broker origin；保留用户条件所需的
  显式 shell 语义，并增加 30 秒执行上限。
- Headless `--goal-condition exit-zero` 的默认命令检查已进入 `headless-goal:exit-zero` Broker origin；
  测试注入接口保持兼容，并与 REPL 检查统一采用 30 秒执行上限。
- 异步 settings Hook Supervisor 已拆分为纯注入 CJS 核心与 ESM Broker 门面；普通 Hook、插件 Hook 及
  Windows 进程树探测/回收分别记录 `async-hook:command`、插件 origin 与 `async-hook:supervisor`。
- Agent Core 的 Python/pip、Node 与 Git 环境探针已进入 `agent-core:environment-probe` Broker origin，
  并由 shell 命令改为可审计的可执行文件 + 字面 argv。
- Agent Core 的 Windows 后台 shell 任务树异步/同步回收已统一进入
  `agent-core:background-taskkill` Broker origin，退出处理器仍使用同步回收契约。
- Agent Core 的专用 Git 工具已进入 `agent-core:git-command` Broker origin，继续使用无 shell 的
  quote-aware 字面 argv，保留原有注入防护和 60 秒上限。
- Agent Core 的 `search_files` shell 搜索已进入 `agent-core:search-files` Broker origin；`run_code`
  首次执行、策略允许后的 pip 安装与重试分别使用无 shell 字面 argv，并记录独立 Broker provenance。
- 同步/并行 settings Hook runner 已拆分为无原生默认执行器的 CJS 核心与 ESM Broker 门面；所有 CLI、
  Headless 与 REPL 生产入口统一走 `hook` / `plugin:hook` provenance，显式插件 Broker 仍兼容。

### 4.2 建议设计

建立单一 `ProcessExecutionBroker`，禁止业务模块直接调用 `spawn`/`exec`。统一请求至少包含：

```text
ExecutionRequest
  origin: tool | hook | plugin | lsp | mcp | installer
  argv: string[]
  cwd / workspace_roots
  filesystem_policy
  network_policy
  credential_refs
  timeout / output_limits
  sandbox_required
  session_id / turn_id / tool_use_id / plugin_id
```

执行后统一返回：

```text
ExecutionResult
  exit_code / signal / timed_out
  stdout_ref / stderr_ref
  isolation_level
  policy_decisions
  credential_injections
  side_effect_summary
  audit_id
```

落地顺序：

1. 先做 Broker 接口和静态检查，盘点并拦截新增的裸 `spawn`。
2. Linux 复用 bubblewrap；macOS 增加 Seatbelt profile。
3. Windows 首选 WSL2/bubblewrap 或容器；原生受限进程只能在验证达到同一语义后标为强隔离。
4. `failIfUnavailable=true` 时所有入口都必须 fail-closed，不能只约束 `run_shell`。
5. 凭据代理改为 default-on：子进程只看 sentinel，只有经过审批的目标 host/进程得到短期值。
6. Python 使用 per-session venv；安装命令分类、版本锁、hash/registry allowlist 改为默认策略。
7. 分阶段废弃 `--api-key`：当前
   [`agent.js`](../packages/cli/src/commands/agent.js#L122) 和其他入口仍接受命令行密钥，
   警告并不能避免 shell history 与进程列表泄露；改用 stdin、环境句柄、Keychain 或
   `apiKeyHelper`。

### 4.3 验收标准

- 仓库内生产代码不再出现绕过 Broker 的非豁免 `spawn`/`exec`。
- Linux、macOS、Windows 各有真实运行测试，不只测参数拼接。
- 覆盖子进程链、symlink/junction、路径穿越、私网、云 metadata endpoint 和 DNS rebinding。
- 严格模式下引擎不可用时 Agent 拒绝启动，日志明确显示真实隔离等级。
- 未批准子进程读取不到长期凭据；审计和 OTel 中也不存在明文。
- Hook、Plugin、LSP、MCP stdio 与 Tool 使用同一套 provenance 和 side-effect ledger。

## 5. P0：后台 Agent 实时交互总线

### 5.1 当前证据

- [`headless-runner.js`](../packages/cli/src/runtime/headless-runner.js#L1431) 明确说明后台
  `ask_user_question` 没有连接当前子进程的人类通道，只能记录 `needs_input` 后结束该 turn。
- [`background-agent-worker.js`](../packages/cli/src/workers/background-agent-worker.js#L111)
  启动 turn 子进程时 stdin 为 ignore。
- attach 发来的文本进入
  [`promptQueue`](../packages/cli/src/workers/background-agent-worker.js#L170)，当前子进程退出后才以
  `-p` 启动下一 turn。

这让状态展示已经“诚实”，但交互语义仍不完整：一个本可继续的当前 turn 被拆成两轮模型调用，
会增加成本、丢失工具调用现场，也不适合高风险审批。

### 5.2 建议设计

增加 worker 与 turn child 之间的双向本地 IPC：

```text
child -> worker
  interaction.request {
    request_id, kind: question | permission | elicitation,
    schema, choices, tool_use_id, policy_digest, expires_at
  }

worker -> child
  interaction.resolve {
    request_id, answer, authority, binding, resolved_at
  }
```

关键约束：

- `request_id`、`tool_use_id`、参数摘要和 `policy_digest` 共同绑定，旧回答不能批准新动作。
- worker 持久化 pending request；attach、Desktop、IDE、Remote Control 共用同一解析入口。
- 断线后仍保持 `needs_input`/`waiting_permission`，重连可继续，不自动降级成 allow。
- 支持过期、取消、重复回答幂等、背压和 worker/child 任一侧崩溃恢复。
- Headless 可采用结构化 `defer` 结果交给 SDK/CI，而不是在非交互环境中挂死。

### 5.3 验收标准

- 用户回答后继续同一 turn，不新增一次模型首轮调用。
- stale、伪造、跨 session 和跨 tool call 的 approval 全部拒绝。
- worker 或 UI 重启后 pending request 可恢复，且最多执行一次。
- 本地 attach、WebSocket、Desktop、IDE 使用相同的 authority/binding 测试向量。
- `working`、`needs_input`、`waiting_permission`、`uncertain_side_effect`、`idle` 状态有唯一生产者和明确迁移表。

## 6. P1：Hooks v2

### 6.1 当前证据

- [`settings-hooks.cjs`](../packages/cli/src/lib/settings-hooks.cjs#L35) 的旧配置加载面仍是部分集合；Hooks v2 runtime 注册表已扩展为 31 个事件。
- 同一加载器在 [`settings-hooks.cjs`](../packages/cli/src/lib/settings-hooks.cjs#L111) 只收
  `type: "command"`。
- `TaskCreated` / `TaskCompleted` 已由 Subagent 生命周期生产，`MCPElicitation` 已由交互和 headless-stream producer 生产；其余事件仍未全部接入真实 producer。
- 真并行和最严决策合并已经有实现，但仍存在 opt-in/default-flip 余量。
- CLI 与 Desktop command/script Hook 已进入各自的 Process Broker，但仍以 shell 执行并从宿主环境
  构造输入；统一强沙箱和按 executor 声明的 managed 最小环境 allowlist 尚未完成。

2026-07-22 复核：`hooks-v2-runtime.js` 已提供 31 事件注册表、5 种 executor、默认并行
执行、按 id 去重、顺序兼容开关和 `executeHooks` 公共入口；JS handler、Process Broker
同步执行、Agent IPC 注册状态及 Context Source Ledger 适配已由 M5 E2E 覆盖。当前仍未
将每一个事件都接入真实 producer，也未完成统一 sandbox/managed allowlist，因此本节的
“完整 Hooks v2”仍是进行中，不能仅凭事件白名单宣称全部完成。

Claude Code 当前官方 Hook 面已包括更完整的生命周期，并支持 `command`、`http`、`mcp_tool`、
`prompt`、`agent` 五类处理器。值得对标的重点不是“事件数量”，而是把 Hook 作为稳定公共 API。

### 6.2 建议

1. 建立唯一 `HookEventSchema`，CLI、SDK、IDE、插件共用版本和 Golden Fixtures。
2. 补齐高价值事件：
   - `Notification` ✅ **已实现**（`hook-events.js` 新增枚举、`session-hooks.js` 实现 `fireNotification`、`agent-repl.js` 接入触发、payload 支持 `message`/`level`/`subtitle` 字段）
   - `Setup`
   - `UserPromptExpansion`
   - `PostToolUseFailure`
   - `PostToolBatch`
   - `PermissionDenied`
   - `StopFailure`
   - `FileChanged`
   - `PostCompact`
   - `TaskCreated` / `TaskCompleted`
   - `Elicitation` / `ElicitationResult`
   - `TeammateIdle`
3. 实现五种 Hook executor，并为各事件声明允许的类型和决策语义。
4. 默认并行执行、相同处理器去重、最严格决策优先；保留兼容开关和明确迁移日志。
5. command/agent hook 进入 Process Broker；HTTP hook 使用 managed 域名 allowlist；MCP hook 复用 MCP 权限。
6. prompt/agent hook 必须有独立模型、turn、token、时间预算，不能悄悄消耗主会话预算。
7. Replay 只重放事件输入，不允许未经重新授权复制历史 allow 决策。

### 6.3 验收标准

- 每个事件都有 producer、schema fixture、允许的 Hook 类型和阻断语义测试。
- CLI、SDK、IDE 对同一 fixture 产生相同解析结果。
- 并行顺序变化不改变最终决策；重复 Hook 只执行一次。
- Hook 无法读取未授权凭据或写出工作区边界。
- managed hooks 不能被低层配置关闭，项目 Hook 变更会重新触发信任。

## 7. P1：常驻 Event Runtime 与 MCP 交互闭环

### 7.1 当前证据

- [`agent-schedule-store.js`](../packages/cli/src/lib/agent-schedule-store.js#L8) 将执行者描述为
  `cc agenda run`。
- [`agenda.js`](../packages/cli/src/commands/agenda.js#L5) 也明确要求通过 `cc loop`、系统 cron
  或人工调用触发。
- Monitor 已有确定性 event id、authority envelope 和去重原语，但注释仍指向“future resident daemon”。
- [`mcp-client.js`](../packages/cli/src/harness/mcp-client.js#L1054) 已处理 tools/resources
  `list_changed`；Elicitation transport、REPL/Headless/SDK 核心链路及 Desktop
  原生 schema UI 已接入，CLI validator 已补齐 dependent/pattern/contains/propertyNames 等常用 vocabulary；VS Code/JetBrains 已支持 MCP object schema 的常用字段表单，完整 meta-vocabulary 仍待补。

2026-07-22 另补齐 Agenda 的持久执行 lease 和常驻入口：`AgentScheduleStore.claimDue()`
通过跨进程锁标记 due 条目，完成/失败时释放，进程异常后由过期 lease 回收，避免两个
`cc agenda run` 同时触发同一任务；`cc agenda run --watch <seconds>` 现在以可停止
daemon loop 持续轮询。`EventRuntimeStore` 与可停止的 `EventRuntimeWorker` 已提供 durable inbox/outbox、幂等、租约回收、失败重试/死信；`EventRuntimeProducer` 已规范 origin/authority，Agent IPC、MCP resolver、Webhook、Telegram 和 Plugin Monitor 在 `CC_EVENT_RUNTIME_DURABLE=1` 时均自动接入，队列超过上限会 fail-closed。2026-07-23 起 `cc status --json` 会输出 inbox/outbox 的 active、claimable、delayed、processing、dead、过期租约、容量余量及 `normal/high/full` 压力；真实文件存储的双 owner 恢复演练覆盖进程崩溃、租约过期接管，并拒绝旧 owner 的迟到 ack/fail 覆盖新结果。所有宿主统一启动/托管 worker 与完整长运行副作用恢复演练仍待落地。

2026-07-22 已补齐 MCP transport 核心：服务器发出的 `elicitation/create` 会进入注入的
handler，或通过 `elicitation-request` 事件交给宿主；支持 `accept/decline/cancel` 规范化、
超时取消和无宿主时 fail-closed decline。启用 `CC_INTERACTIVE_QUESTIONS=1` 的
stream/headless 路径会复用现有结构化问题通道。WS question channel、REPL、Desktop 原生表单以及 SDK
schema fixture 已接入；VS Code/JetBrains 已补 MCP object schema 的 enum、required、默认值、boolean/number/password 字段表单；完整 schema vocabulary 仍待补，因此 P1-5 仍为部分完成。

### 7.2 建议

把 Agenda、Monitor、Channel 和 MCP 外部事件统一到一个常驻 Event Runtime：

- 持久 inbox/outbox、事件 id、去重键、租约、attempt、dead-letter。
- 定时器只负责唤醒，真实状态以持久存储为准。
- 明确 missed-run 策略：skip、run-once、catch-up-N，默认避免重放风暴。
- Webhook、WebSocket、SSE、MCP Channels 进入有界队列，支持限流和背压。
- 事件只能触发被预授权的低风险动作；高风险动作转入实时交互总线。
- Elicitation 支持结构化表单、URL 跳转、Headless defer 和超时拒绝。
- 所有外部事件带 origin/authority，消息文本本身不能声称“用户已批准”。

### 7.3 验收标准

- daemon 重启后不会漏掉一次性任务，也不会重复执行已确认的副作用。
- 时钟跳变、休眠唤醒、长时间离线和多实例竞争均有确定性测试。
- 高频事件下内存有界，丢弃/合并策略可观测。
- MCP Elicitation 在 CLI、Desktop、IDE、SDK 中共享同一请求和回答协议。
- 每个事件可从 ingress 追踪到 agent run、权限决定和最终副作用。

## 8. P1：Context 成本与懒加载可观测性

[`context-breakdown.js`](../packages/cli/src/lib/context-breakdown.js#L14) 现在会归因实际注入系统提示的
persona Skill 和 persisted MCP tool schema；未注入的 lazy/discoverable Skill 不计入上下文成本。`/context`
已经有价值，但还不能回答：

- 哪个 Skill 描述常驻、哪个正文按需加载、实际占了多少 token。当前已记录实际注入 persona Skill 的来源和 token；普通 lazy Skill 仍待运行时 cache ledger。
- 哪个 MCP server/tool schema 占用最多，Tool Search 节省了多少。当前已将实际 admitted MCP schema 持久化并在 `cc context --sources` 中逐工具归因。
- 哪条指令、规则、文件或 compaction re-injection 导致 cache miss。
- Subagent、Hook、MCP 和主会话各自消耗多少上下文和预算。

建议引入 `ContextSourceLedger`，在真正构造 provider request 的位置记录：

```text
source_id
source_type: system | instruction | rule | memory | skill | mcp_schema | tool | file | history
scope / origin / loaded_because
raw_chars / estimated_tokens / provider_tokens
cache_read / cache_write / cache_miss_reason
turn_id / agent_id
```

验收目标：

- `/context --json` 的分项总和与实际请求 token 误差有明确上限。
- 展示 Top N 上下文来源及可执行优化建议。
- Tool Search、Skill 懒加载、compact 前后都有节省量对比。
- 不把 prompt、文件正文或 tool args 默认发往 OTel。

## 9. P1：Turn、Checkpoint 与跨运行形态统一

Headless 已在 [`headless-runner.js`](../packages/cli/src/runtime/headless-runner.js#L1802)
实时建立并持久化 turn binding，REPL 也已能消费持久表。剩余问题是同一个 Agent Core 在不同入口
仍产生不同完整度的恢复数据：

- REPL 自身尚未成为同等级的显式 turn-binding 生产者。
- provider 原始 `tool_use_id` 没有完整浮出，部分位置仍由 runner 合成。
- child agent 的 checkpoint、worktree id、user edit 标记没有统一进入父 turn。
- shell 和外部进程写文件只能标记 `coverage: partial`。

建议：

1. 把 turn/checkpoint 事件生产下沉到 Agent Core，REPL、Headless、SDK、IDE 只消费。
2. Provider call id、permission decision id、checkpoint id、child agent id 全程保真。
3. 父子 Agent 使用 trace/span 关系，不靠名称或日志文本反推。
4. Worktree、用户编辑和外部文件变化进入同一 coverage 模型。
5. 在 Process Broker 中增加运行前后文件摘要或变更日志，逐步把 shell 文件变更从
   `partial` 提升为可恢复；外部网络/数据库副作用仍必须明确不可回滚。

这也是最值得做的差异化：Claude Code 官方 checkpoint 主要跟踪编辑工具，ChainlessChain 可进一步
覆盖受 Broker 管理的全部文件写入，但不能对外部副作用作虚假承诺。

## 10. P1：Plugin 凭据与供应链闭环

当前 Plugin 能力声明、能力 diff、重新 consent 和 options schema 已较完善。剩余高价值工作：

- 敏感 option 已从 user-scope JSON 迁移到 DPAPI、macOS Keychain、Linux Secret Service（不可用时 fail-closed）。
- 取消 legacy manifest 的隐式旁路：当前
  [`policy.js`](../packages/cli/src/lib/plugin-runtime/policy.js#L180) 对未声明 capabilities 的
  旧插件保留兼容加载。建议设置迁移窗口，首次加载展示推断能力并要求确认；企业模式直接
  fail-closed。
- 插件 MCP stdio、LSP、settings Hook、Monitor 与 `run_shell` 命中的 Plugin Bin 已进入 Process Broker，并携带 `plugin_id/version/source`；CLI/`cc ui` 的 `node-pty` 与 Desktop 主进程的 `child_process`/`node-pty` 入口已统一进入 Broker 并记录脱敏 provenance，原生模块和外部宿主仍待收口。
- Manifest 的 network domains、filesystem roots、process、credential 声明要从“安装期说明”
  升级为“运行时强制”。
- 增加 lockfile、依赖图、签名链、SBOM 和安装产物 hash。当前安装锁已记录并校验文件级 SBOM 摘要，敏感 options 已使用 OS secret store；依赖图与全路径 Broker 强制仍待补。
- 升级前展示新增能力、上下文成本和可执行组件；能力扩大必须重新 consent。
- 禁止不安全 shell-form 插值，默认使用 argv 形式。

验收标准：

- 配置文件、日志、Session 和诊断包中没有插件敏感值。
- 插件声明外的网络、文件、进程和凭据访问被运行时拒绝。
- 插件升级新增能力时旧 consent 失效，降权升级无需重复打扰用户。
- 离线可验证安装包 hash、签名、依赖和 SBOM。

## 11. P0/P1：权限控制面、关键状态与结构化输出

### 11.1 统一权限控制面

[`permissions.js`](../packages/cli/src/commands/permissions.js#L12) 已注明其管理面尚未直接 gate
Agent tool runtime；真正的工具决策还分布在 settings rules、ApprovalGate、Hook、managed policy、
remote approval 和不同运行入口中。

建议建立唯一 `PolicyDecisionService`：

- CLI、REPL、Headless、Desktop、IDE、SDK、Subagent、Hook 和 MCP 都调用同一决策接口。
- 每个结果固定返回 `decision_id`、最终决定、命中规则、配置层级、authority chain、
  sandbox requirement 和可否重试。
- `cc permissions explain <decision-id>` 能解释“谁允许/拒绝了什么”，而不是只展示静态配置。
- managed deny、bypass 禁令和项目 trust 必须在所有入口保持相同优先级。
- 旧 `cc permissions` 若不能立即接入运行时，应明确显示“advisory/not enforced”，避免安全误解。

同时应把 IDE Bridge 本地 token 视为权限边界。VS Code/JetBrains lockfile 的 0600/ACL 设置失败不应
默认 fail-open；多用户主机上应拒绝启动 Bridge，只允许 managed policy 明确开启降级。

### 11.2 关键状态不能 best-effort 无锁继续

[`with-file-lock.js`](../packages/cli/src/lib/with-file-lock.js#L2) 明确采用 best-effort 策略；
锁超时或异常后继续执行临界区可能产生 lost update。对显示缓存这是合理降级，对以下状态则不可接受：

- approval request/resolve 与 authority binding。
- side-effect ledger 与幂等执行记录。
- session/turn/checkpoint binding。
- scheduler lease、delivery id 和任务完成状态。
- plugin trust、capability consent 和凭据元数据。

建议给状态存储分级：

| 等级     | 示例                                            | 锁失败策略                |
| -------- | ----------------------------------------------- | ------------------------- |
| Critical | approval、ledger、turn binding、scheduler lease | fail-closed，不执行副作用 |
| Durable  | session index、task、plugin consent             | 有界重试后报错，不无锁写  |
| Advisory | UI cache、统计快照、提示索引                    | 可 best-effort 降级       |

跨进程关键状态优先迁到 SQLite transaction、单写者 daemon 或带 compare-and-swap 的持久存储，
而不是继续扩展文件锁约定。

2026-07-22 已先将关键调度状态落地为 fail-closed：`withFileLock` 支持
`failIfUnavailable`，`AgentScheduleStore.claimDue()` 在无法取得跨进程锁时拒绝执行，
并用过期 lease 回收崩溃 runner。Approval、side-effect ledger、session/turn binding
等其余关键状态仍需迁移到同等语义的持久事务或 daemon。

### 11.3 标准化 JSON Schema

当前 [`json-schema-validate.js`](../packages/cli/src/lib/json-schema-validate.js) 已覆盖许多常用
关键字，也已经能输出带 JSON Pointer 的 `structured_result`，但仍是自研 Draft 2020-12 子集。

建议：

- 使用成熟 Draft 2020-12 validator，或公开、版本化声明支持的精确子集，避免声称完整兼容。
- 启动时编译 schema；无效 schema 在任何模型调用前失败。
- `stream-json` 明确区分 partial assistant event 和最终 validated result。
- 对 `$ref`、`unevaluatedProperties`、dependent schema、组合关键字和 format 建兼容测试集。
- CLI、SDK、IDE 使用同一 schema digest、错误码和 JSON Pointer。

## 12. P1：Agent SDK、CI 与权限默认值

[`packages/agent-sdk`](../packages/agent-sdk/) 已有 TypeScript SDK 和协议 fixture，因此不建议再
“抽取一套新 SDK”。建议优先补协议收口：

- `goal_*`、approval binding、turn/checkpoint、child agent、recovery 和 defer 事件完整透传。
- CLI、SDK、VS Code、JetBrains、Desktop 共用一份 schema package 和 Golden NDJSON。
- 协议变更有 SemVer、capability negotiation、deprecation window 和兼容矩阵。
- WebSocket approval gate 从 opt-in 迁移为安全默认；项目配置不能放宽 managed deny、
  bypass 或 auto mode 的组织边界。
- SDK 可替换 SessionStore、审批回调、Elicitation、Hook 和 OTel exporter。

Python SDK 和 GitHub/GitLab CI 模板应按真实用户场景决定：

- 若要做第三方嵌入平台，Python SDK 提升为 P1。
- 若主要服务桌面端和自托管 CLI，先把 TypeScript SDK 和协议发布门做稳。
- CI 集成优先提供最小、可审计的 `--bare --ephemeral --dontAsk` 模板，不要默认开放高风险工具。

## 13. P1：统一验收门与文档治理

这是成本最低、回报最快的一项优化。

当前统一入口为 [`verify-coding-agent-parity.js`](../desktop-app-vue/scripts/verify-coding-agent-parity.js)，
已覆盖主要发布链；仍需持续扩展真实环境矩阵。历史 MVP 验证脚本的范围较窄，没有覆盖所有已存在的关键链：

- Desktop 完整 lifecycle integration。
- Desktop 到真实 CLI server。
- CLI WebSocket envelope E2E。
- Renderer store。
- Bridge、contract、policy 与 runtime convergence。
- CLI reference/protocol 生成物漂移检查。
- VS Code 真实 Extension Host + VSIX 安装旅程，以及 JetBrains Remote Robot 的核心交互旅程。
- Remote/WSL/SSH/Dev Container 运行矩阵和长时间 soak。

统一发布入口现已落地：

```text
npm run test:coding-agent:parity
  1. Desktop Coding Agent core unit
  2. Desktop lifecycle integration
  3. Desktop hosted-tools integration
  4. Desktop <-> real CLI bridge
  5. Renderer store
  6. CLI contract/policy/unit
  7. CLI real envelope E2E
  8. SDK protocol fixtures
  9. docs:cli-reference:check
  10. docs:protocol:check
```

2026-07-22 实测上述统一入口的 10/10 步骤全部通过；已纳入权限规则、WebSocket 路由、Desktop
Bridge/store 和 SDK protocol fixtures 的回归验证。Remote/WSL/SSH/Dev Container 长时间 soak
仍属于后续矩阵，不能由本次本机 parity 结果替代。

同时治理文档事实源：

- 本文作为“当前净差距”入口。
- 历史 Gap/Parity 文档增加 `Implemented`、`Superseded` 或 `Historical` 标记。
- 增量报告顶部待办应由各节“仍欠”自动汇总，避免顶部和正文互相矛盾。
- 测试数量、命令数量和 IPC 数量不手写，全部从注册表/测试清单生成。
- 修正 Background stability README 中已经完成的 PID reuse、孤儿回收和
  `waiting_permission` 旧 pinned gaps。

## 14. P2：可形成差异化、但不应抢占 P0/P1 的方向

### 14.1 全工具文件回滚

利用 Process Broker 在受控进程前后记录文件系统变化，把 shell、脚本、插件和 MCP stdio 引起的
工作区写入纳入 checkpoint。建议采用分层承诺：

- `full`：所有文件写入都被捕获，可恢复。
- `partial`：工作区文件可恢复，但外部副作用不可恢复。
- `none`：没有可信快照。

不要把数据库写入、发送消息、部署或支付等外部动作包装成“可回滚”。

### 14.2 Auto mode 安全分类器评测

ChainlessChain 已有 auto/dontAsk 等权限模式。若要进一步对标 Claude Code 的独立安全分类器，
应先建立离线风险集和回归基准，评测越权路径、秘密外发、生产部署、强推、未审核合并、
第三方 Agent 无隔离执行等场景。分类器只能增加一道防线，不能替代 deny 规则和 OS 沙箱。

### 14.3 大规模 Agent Teams

已有 Team、Workflow、Batch 和 Worktree 原语。只有在以下条件满足后才建议继续扩规模：

- 每个 child 有独立预算、checkpoint 和权限上限。
- 文件冲突、任务租约、重复执行和 crash recovery 已可验证。
- Agent View 可人工接管，且事件队列有背压。

否则增加并发只会放大冲突、成本和不可恢复副作用。

### 14.4 标准 OTel Collector 出口

当前 CLI 已有 span、trace、内容脱敏和 permission decision 属性，但主要入口仍以本地 OTLP JSON
文件为主。若企业治理有真实需求，再增加 OTLP HTTP/gRPC exporter、离线队列、背压、重试、
mTLS 和团队级成本/失败聚合；继续坚持内容默认不出端。

## 15. 建议实施路线

| 批次          | 时间建议 | 交付目标                                                                        | 退出条件                                        |
| ------------- | -------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| M0 事实基线   | 1 周     | 统一 parity 验收脚本、spawn 清单、文档状态清理、权限双系统标识                  | 当前能力可一键复验，旧待办和权限 UI 不再误导    |
| M1 可信执行   | 4–6 周   | Process Broker、Linux/macOS/Windows 后端、凭据 default-on、关键状态 fail-closed | 所有生产子进程统一受控，三平台严格测试通过      |
| M2 实时交互   | 3–4 周   | worker-child IPC、approval/question/elicitation、恢复                           | 当前 turn 可安全暂停与继续，stale approval 全拒 |
| M3 扩展运行时 | 4–6 周   | Hooks v2、常驻 Event Runtime、MCP Elicitation/Channels                          | 事件可恢复、幂等、有界，Hook 协议稳定           |
| M4 协议收口   | 3–4 周   | Context ledger、统一 turn binding、标准 JSON Schema、SDK/IDE golden gate        | CLI/SDK/IDE/Desktop 事件与恢复语义一致          |
| M5 差异化     | 按需求   | 全工具文件回滚、安全分类器评测、大规模 Agent                                    | 有真实用户指标与故障模型后再投入                |

可以并行的工作：

- M0 可与 M1 的接口设计并行。
- M2 的协议设计可与 M1 并行，但真正执行必须复用 Broker 和 authority。
- Context ledger 与 SDK Golden Fixtures 可独立推进。

不能倒置的依赖：

- Hook/Plugin/MCP 的执行安全依赖 Process Broker。
- MCP Elicitation 和后台审批依赖实时交互总线。
- 大规模 Agent Teams 依赖 checkpoint、预算、authority 和 Event Runtime。

## 16. 建议 KPI

| 指标          | 目标                                                            |
| ------------- | --------------------------------------------------------------- |
| 子进程受控率  | 生产路径 100% 经过 Broker 或显式、审计化豁免                    |
| 严格沙箱降级  | 0 次静默降级                                                    |
| 凭据泄露      | 子进程、日志、Session、OTel 中 0 个未授权明文凭据               |
| 后台交互      | question/permission/elicitation 可在同一 turn 恢复              |
| 审批安全      | stale、跨 session、跨 tool call approval 拒绝率 100%            |
| 关键状态写入  | Critical 状态锁失败时 0 次无锁继续                              |
| 权限解释      | 每次工具决定均可追溯 decision id、规则层级和 authority          |
| Event Runtime | 重启后不漏一次性任务，已确认副作用不重复                        |
| Hook 兼容     | CLI/SDK/IDE Golden Fixture 结果一致                             |
| Context 归因  | `/context` 分项与实际 provider token 的误差有明确上限并持续监控 |
| 恢复诚实度    | 所有 turn 均标注 full/partial/none，不做过度承诺                |
| 发布验收      | parity 脚本成为 CLI/Coding Agent 发布必过门                     |

## 17. 官方一手资料

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Hooks reference](https://code.claude.com/docs/en/hooks)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Agent teams](https://code.claude.com/docs/en/agent-teams)
- [MCP](https://code.claude.com/docs/en/mcp)
- [Context window](https://code.claude.com/docs/en/context-window)
- [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- [Headless mode](https://code.claude.com/docs/en/headless)
- [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
- [Plugins](https://code.claude.com/docs/en/plugins)
- [Monitoring and OpenTelemetry](https://code.claude.com/docs/en/monitoring-usage)

## 18. 主要仓库证据

- [`packages/cli/package.json`](../packages/cli/package.json)
- [`packages/cli/src/lib/agent-sandbox.js`](../packages/cli/src/lib/agent-sandbox.js)
- [`packages/cli/src/lib/credential-proxy.js`](../packages/cli/src/lib/credential-proxy.js)
- [`packages/cli/src/commands/permissions.js`](../packages/cli/src/commands/permissions.js)
- [`packages/cli/src/lib/with-file-lock.js`](../packages/cli/src/lib/with-file-lock.js)
- [`packages/cli/src/workers/background-agent-worker.js`](../packages/cli/src/workers/background-agent-worker.js)
- [`packages/cli/src/lib/background-session-transport.js`](../packages/cli/src/lib/background-session-transport.js)
- [`packages/cli/src/lib/settings-hooks.cjs`](../packages/cli/src/lib/settings-hooks.cjs)
- [`packages/cli/src/lib/hook-runner.cjs`](../packages/cli/src/lib/hook-runner.cjs)
- [`packages/cli/src/lib/hook-event-bus.cjs`](../packages/cli/src/lib/hook-event-bus.cjs)
- [`packages/cli/src/harness/mcp-client.js`](../packages/cli/src/harness/mcp-client.js)
- [`packages/cli/src/lib/agent-schedule-store.js`](../packages/cli/src/lib/agent-schedule-store.js)
- [`packages/cli/src/lib/monitor-event.js`](../packages/cli/src/lib/monitor-event.js)
- [`packages/cli/src/lib/context-breakdown.js`](../packages/cli/src/lib/context-breakdown.js)
- [`packages/cli/src/lib/turn-binding.js`](../packages/cli/src/lib/turn-binding.js)
- [`packages/cli/src/lib/plugin-runtime/plugin-options.js`](../packages/cli/src/lib/plugin-runtime/plugin-options.js)
- [`packages/cli/src/lib/json-schema-validate.js`](../packages/cli/src/lib/json-schema-validate.js)
- [`packages/agent-sdk`](../packages/agent-sdk/)
- [`desktop-app-vue/scripts/verify-coding-agent-mvp.js`](../desktop-app-vue/scripts/verify-coding-agent-mvp.js)
- [`CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12.md`](./CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12.md)

| **2026-07-20 — 落地** | **Notification Hook 事件** |
| | ✅ **已完成** — 新增 `HookEvents.Notification` 事件类型，在 `session-hooks.js` 中实现 `fireNotification()` 函数，在 `agent-repl.js` 中接入事件触发点（权限请求、子智能体输出、配额告警、闲置告警时触发），可通过 `$CLAUDE_PROJECT_DIR/.claude/hooks/notification/<lifecycle>.sh` 配置脚本，支持 `CLD_HOOK_EVENT_SOURCE=notification` 和 `CLD_NOTIFICATION_MESSAGE` 环境变量 |

## 19. Runtime Convergence 实现交付记录 (2026-07-19)

> M0-M4 核心模块已完成落地，可通过 `npm run runtime:convergence` 一键验证

### 已完成任务清单

| 阶段     | 任务                                                              | 状态                     | 交付文件                                                                                 |
| -------- | ----------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| **M0**   | `process-execution-broker` 单例 + spawn审计清单                   | ✅ **Completed**         | `packages/cli/src/lib/process-execution-broker/index.js`                                 |
| **M0**   | parity 验证脚本 + npm script `runtime:convergence`                | ✅ **Completed**         | `packages/cli/scripts/test-runtime-convergence.mjs`, package.json scripts                |
| **M1**   | Broker 支持所有 origin 类型 (shell/mcp/lsp/agent/background/hook) | ✅ **Completed**         | Broker 内置权限决策、凭据过滤、平台沙箱和审计机制；未提供 `addPolicyEnforcer()` 公共 API |
| **M1**   | 现有入口接入审计 (hook-manager)                                   | ✅ **Completed**         | `packages/cli/src/lib/hook-manager.js` 已由 Process Broker 执行并统一审计                |
| **M2**   | 后台 Agent 实时 IPC 总线 (`agent-ipc-bus`)                        | ✅ **Completed**         | `packages/cli/src/lib/agent-ipc-bus.js`                                                  |
| **M3-1** | Hooks v2: 18个生命周期事件 + 5种executor类型统一API               | 🟡 **Runtime completed** | `packages/cli/src/lib/hooks-v2-runtime.js`；真实 producer 接入与 sandbox 强制仍待补      |
| **M3-2** | Event Runtime 常驻框架 (emit/subscribe)                           | ✅ **Completed**         | HooksV2Runtime 内置 EventEmitter，支持事件调度                                           |
| **M4-1** | Context Source Ledger 来源记账                                    | ✅ **Completed**         | `packages/cli/src/lib/context-source-ledger.js`                                          |
| **M4-2** | Turn binding schema (sessionId/turnId/toolUseId 全透传)           | ✅ **Completed**         | Broker/IPCBus/Ledger 统一支持 traceId 透传                                               |

### 验证结果

```
Results: 11 passed, 0 failed
All runtime convergence tests PASSED! M0-M4 modules and compatibility APIs are available.
```

### 使用方式

```bash
# 一键运行 parity 验证
cd packages/cli
npm run runtime:convergence
```

### 模块能力说明

| 模块                       | 核心API                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **ProcessExecutionBroker** | `broker.spawn()`, `broker.spawnSync()`, `broker.setPermission()`, `broker.getAuditLog()`                           |
| **AgentIPCBus**            | `bus.registerAgent()`, `bus.sendMessage()`, `bus.sendProgress()`, `bus.sendResponse()`, `bus.cancel()`             |
| **HooksV2Runtime**         | `hooks.registerHook()`, `hooks.executeHooks()`, `hooks.emitEvent()`, 支持 command/http/prompt/agent/js 5种executor |
| **ContextSourceLedger**    | `ledger.recordRead()`, `ledger.getProvenance()`, `ledger.getTokenBreakdown()`, `ledger.rollup()`                   |

所有模块均提供单例默认导出，向后兼容现有代码，可按需逐步接入剩余spawn入口。

### M5-M6 Runtime Convergence 完成记录 (2026-07-19) ✅

| 阶段   | 任务                                                                  | 状态             | 交付物                                                 |
| ------ | --------------------------------------------------------------------- | ---------------- | ------------------------------------------------------ |
| **M5** | 全局参数 `--jsii-runtime <native\|quickjs>` + `--otlp-endpoint <url>` | ✅ **Completed** | `packages/cli/src/index.js` 入口参数解析与初始化逻辑   |
| **M5** | 端到端 parity 验证                                                    | ✅ **Completed** | CLI入口加载成功，参数显示正常，命令无报错              |
| **M6** | 收敛设计文档（四层架构/边界/契约/责任链）                             | ✅ **Completed** | `docs/cli/M5_M6_RUNTIME_CONVERGENCE_IMPLEMENTATION.md` |
| **M6** | 四层模块边界严格定义（无超级函数/无跨层调用）                         | ✅ **Completed** | 可观测层/审计层/执行层/扩展层 单向依赖架构             |

### 模块架构总览（四层严格分层，无超级函数）

```
扩展层 Hooks V2 → 执行层 Process Execution Broker → 审计层 Runtime Provenance Ledger → 可观测层 Trace Context + OTLP Exporter
```

所有模块单一职责，层间仅通过公共API契约交互，无循环依赖、无跨层直接调用、无超级函数。

## 20. 2026-07-22 验收复核与纠偏

本次复核发现收敛脚本仍检查已废弃的 `broker.addPolicyEnforcer()`，导致实际运行结果为
9 passed / 1 failed。核对 Broker 实现后确认这是验收脚本漂移，不是 Runtime Convergence 模块缺失。

已将 [`test-runtime-convergence.mjs`](../packages/cli/scripts/test-runtime-convergence.mjs) 的检查改为
当前真实公共契约：`setPermission()`、`getStats()` 和 `getAuditLog()`。复核命令：

```bash
cd packages/cli
npm run runtime:convergence
```

复核结果：`10 passed, 0 failed`。本节 M0-M4 的“已完成”只表示模块加载、核心 API 和来源记账
smoke gate 已通过，不等同于第 4、5、6、7 节所列的跨平台强隔离、同 turn 恢复、完整 Hook
生产者或常驻 Event Runtime 已全部完成；这些仍按矩阵中的 P0/P1 净差距推进。

## 21. 2026-07-22 权限控制面进度

运行时权限规则接线已存在于 Agent Core、Headless 和 REPL；本轮补齐 CLI 管理面的显式快捷命令：
`cc permissions allow <rule>`、`cc permissions ask <rule>`、`cc permissions deny <rule>`，并保留
`cc permissions add <decision> <rule>` 兼容入口。三种快捷命令均写入相同的 settings-loader 目标文件，
因此不会产生第二套规则存储。

新增单元测试覆盖三种快捷命令。根目录 workspace 与 `core-multisig` package manifest 的合并冲突
已清理，权限命令专项测试 `permissions-command.test.js` 现为 13/13 通过。

Desktop 同步链也已完成：CLI server 的认证 WebSocket 暴露 `permission-rules-get/set`，Electron
主进程和 preload 转发同名 API，`useCodingAgentStore` 提供 `refreshPermissionRules()` 和
`addPermissionRule()`；写入成功后会重新读取合并规则，确保 UI 不维护第二份事实源。当前仍缺少
完整发布门测试，不能据此宣称所有权限来源（尤其 managed host deny）可被 Desktop 放宽。
当前协议路由与 WebSocket 回归测试共 81 个用例通过，Desktop Bridge/store 回归测试共 64 个用例
通过；剩余发布门仍需纳入统一 parity 命令。
