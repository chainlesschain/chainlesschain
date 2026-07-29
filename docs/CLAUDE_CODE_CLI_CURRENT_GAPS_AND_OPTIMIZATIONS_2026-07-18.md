# ChainlessChain CLI 对照 Claude Code CLI 当前净差距与优化建议

> 评估日期：2026-07-18  
> 评估对象：`packages/cli`、`packages/agent-sdk` 及 Coding Agent 相关验证链  
> 仓库基线：CLI `0.162.177`
> 对标基线：截至评估日的 Claude Code 官方滚动文档  
> 文档状态：持续复核版；2026-07-24 已复核 CLI 版本、后台当前 turn 交互、双语言 Agent SDK、
> Skill/Desktop Process Broker 收口及静态进程清单。
> 说明：本文只列“当前仍值得投入”的净差距。已落地能力不再重复列为待办，历史实施过程见
> [`CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12.md`](./CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12.md)。

## 1. 结论

ChainlessChain CLI 已经不是一个需要继续补基础命令的早期 Coding Agent。当前代码已覆盖
Headless、JSON/NDJSON、`--bare`、会话恢复、后台 Agent、Worktree、Checkpoint、权限策略、
MCP、Skills、Subagent、Hooks、插件治理、LSP、Review、OTel 和 Agent SDK 等主体能力。

下一阶段最有价值的工作不是继续增加 Slash Command 或扩大 Agent 数量，而是把现有能力收敛为
一个可信、可恢复、跨平台一致的运行时。建议优先投入以下五项：

1. **P0：统一 Process Sandbox Broker。** 所有子进程入口统一经过强隔离、网络策略、凭据代理和审计。
2. **P0/P1：后台 Agent 实时交互总线产品化。** CLI 当前 turn 暂停/回答/继续、持久 settlement 与跨宿主 authority/binding 核心已落地，继续补齐三平台端到端验收。
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

| 维度            | 当前仓库事实                                                                                        | 判断             |
| --------------- | --------------------------------------------------------------------------------------------------- | ---------------- |
| Headless        | text/JSON/stream-json、stream input、结构化结果、预算、turn 上限、`--bare`、`--ephemeral`、能力清单 | 主体已具备       |
| 会话            | 新建、恢复、命名、清理、PR 关联、导出、搜索、哈希链与 Mirror                                        | 主体已具备       |
| 后台 Agent      | `--bg`、attach、logs、stop、resume、状态持久化、PID identity、孤儿回收、副作用台账                  | 主体已具备       |
| 权限            | allow/ask/deny、permission mode、managed policy、项目配置信任、authority envelope、远程审批绑定     | 主体已具备       |
| Checkpoint      | 自动 checkpoint、`/rewind`、conversation/files/both、显式 turn binding、partial coverage            | 主体已具备       |
| Skills/Subagent | 多层 Skill、热加载、隔离上下文、完整约束契约、后台运行、Worktree、精确取消                          | 主体已具备       |
| MCP             | stdio/HTTP、Tools、Resources、Prompts、OAuth、Tool Search、动态 list changed、Roots 通知、重连      | 主体已具备       |
| Plugin          | Manifest、签名/信任、能力声明、能力差异与重新 consent、typed options、LSP/MCP/Hooks/Bin             | 主体已具备       |
| 质量            | LSP、多根工作区、编辑后诊断、多 Agent Review + verifier、Doctor、OTel                               | 主体已具备       |
| SDK             | TypeScript/Python Agent SDK、24 类 typed stream 事件、交互回调、共享 NDJSON fixture 与 CI 示例      | 双语言基线已具备 |

因此不建议再单独立项：

- 增加更多同义顶层命令或普通 Slash Command。
- 再造一套基础 Chat/Agent Loop。
- 再造一套普通 Skill、MCP 或 Worktree 管理器。
- 在可靠性和隔离未收口前继续扩大 Agent Team 并发规模。
- 为功能数量平价照搬 Claude 账号、订阅或 Anthropic 专属云能力。

## 3. 当前对标矩阵

| 能力面        | Claude Code 官方能力                                                        | ChainlessChain 当前状态                                                                                                                                                                                                                                                                                                                | 当前净差距                                                                                                                      | 优先级 |
| ------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 进程隔离      | macOS Seatbelt、Linux/WSL2 bubblewrap、文件/网络边界、凭据隔离、严格失败    | Docker/bubblewrap、macOS Seatbelt wrapper 与 Windows Job Object/Restricted Token adapter 已有；Broker async/sync/PTY 默认过滤 env/argv；credential ref 已通过本地认证 transport 按进程/host/TTL/次数解析；206 项 runtime 静态匹配已全部归类且 unreviewed=0                                                                             | Windows Node IPC fd3/detached 目标身份尚不能跨原生 wrapper 保真；真实三平台严格隔离 CI 待补                                     | P0     |
| 后台人机回路  | 后台任务可暂停、请求权限/输入、恢复和接管                                   | CLI turn child 与 worker 已有绑定校验的 Node IPC；attach 回答会返回同一 child、继续同一 turn；pending/settlement 已写入 session journal，重连可重放，worker 丢失会 exactly-once 拒绝；Desktop/IDE/Web Panel/Remote Control/双语言 SDK 已共用 runtime authority 与 binding 验收向量                                                     | 三平台全链 E2E 已接入现有 CLI matrix，当前改动的远端结果待验收                                                                  | P0/P1  |
| 权限控制面    | CLI、交互、SDK、IDE 使用同一权限规则和决策来源                              | Agent Runtime 已有 settings rules + ApprovalGate；`cc permissions` 仍是另一套管理面                                                                                                                                                                                                                                                    | 用户可能误以为 `cc permissions` 已直接约束 Agent 工具；安全默认和来源解释需统一                                                 | P0/P1  |
| Hooks         | 完整生命周期；command/http/mcp_tool/prompt/agent 五类；并行、去重、最严合并 | 40 事件 registry、5 类公共 executor + trusted JS、默认并行/去重、11 项高价值 producer、最小环境交集、command/workspace/MCP/agent/skill managed allowlist、MCP 共享授权和 delegated budget 已接真实路径                                                                                                                                 | 跨平台强文件写沙箱仍依赖 P0 原生隔离收口                                                                                        | P1     |
| MCP 交互      | Elicitation、ElicitationResult、Channels、长调用后台化                      | Tools/Resources/Prompts/OAuth/Tool Search/list changed/roots，以及 Elicitation form/URL/defer、complete 通知、`-32042` exactly-once retry 和 Desktop/VS Code/JetBrains/双语言 SDK 宿主协议均已有                                                                                                                                       | 完整 schema vocabulary 与部分外部事件 producer 仍待补                                                                           | P1     |
| Event Runtime | 后台会话、任务、外部事件和持续监控统一运行                                  | Agenda watch、durable inbox/outbox、lease/retry/dead-letter、Agent IPC、MCP、Webhook、Telegram、Monitor producer 默认接线与有界队列已接入；真实 binary lazy 入口统一托管 process-level worker，短命命令 final drain；`cc status --json` 暴露队列与跨进程 host heartbeat/stale，真实双进程演练验证更高 fence 接管和幂等副作用只应用一次 | ✅ 核心闭环；新增外部副作用仍须携带稳定 event id 并实现领域幂等 handler                                                         | P1     |
| Context       | `/context` 显示 memory、skills、MCP、文件与缓存成本                         | instruction、实际注入 persona Skill、persisted MCP schema 已逐来源归因；普通 Skill 使用 descriptor/body 双层 cache，Headless/REPL 持久化无正文快照，分别报告磁盘读取、cache hit、正文大小等价量与实际 prompt 注入 token                                                                                                                | ✅ 当前核心闭环；Subagent/Hook 独立预算与 provider 实际计费误差仍作为后续可观测性增强                                           | P1     |
| Checkpoint    | 对话与文件按 turn 恢复                                                      | Headless/REPL 共用 turn-binding producer，provider tool/turn/decision id、child/worktree/checkpoint 与 IDE user edit 均进入持久归因                                                                                                                                                                                                    | ✅ 核心闭环；shell/外部进程副作用继续诚实标记为 partial                                                                         | P1     |
| Plugin 安全   | 插件统一打包、作用域、企业治理                                              | 能力声明/consent/签名/typed options/OS secret/lockfile/SBOM 与执行 Broker provenance 已有；强制 consent 同时强制 permissions 声明，direct URL MCP hostname 按声明 domain 连接前拒绝；Desktop Loader 依赖探测/安装/解压已去 shell                                                                                                       | stdio/native 外部宿主的跨平台 network/filesystem 强隔离仍需随 P0 原生沙箱收口                                                   | P1     |
| 关键状态并发  | 会话、审批、任务和副作用状态应原子持久化                                    | Approval CAS、side-effect/turn/session、Agenda/Event Runtime/Cowork delivery、goal/config/MTC、plugin/MCP trust/consent/凭据元数据均有界 fail-closed；VS Code/JetBrains 共用 `.lock` 目录协议                                                                                                                                          | ✅ Critical/Durable 清单已收口；仅 Advisory cache/统计允许 best-effort                                                          | P1     |
| 结构化输出    | 标准 JSON Schema、启动期校验、最终 validated result                         | `Ajv2020`/`ajv-formats` 执行完整 Draft 2020-12 meta-schema、动态引用、`unevaluated*` 与组合互操作；所有入口在模型调用前解析并编译 local/public-HTTPS ref graph，稳定 digest/错误指针/`structured_result` 不变                                                                                                                          | ✅ 核心闭环；远程 ref 限于无凭证公网 HTTPS 且有 DNS-SSRF、数量、字节与超时上限                                                  | P1     |
| SDK/CI        | TypeScript/Python SDK、版本化事件、GitHub/GitLab 自动化                     | 当前双语言源码覆盖 24 类 typed stream 事件（含 MCP defer/complete）、approval/question/MCP elicitation callback、resume 与未知事件无损透传；共享 fixture、GitHub Actions 模板及 22 项 hermetic 测试已落地；已发布 Python SDK 0.1.0 是此前 22 类事件基线，并通过 3.10/3.12/3.13 公网 wheel 安装矩阵                                     | SemVer/capability negotiation/deprecation 矩阵、跨宿主 schema package、GitLab、双语言联合发布兼容门及新增事件的新版本发布仍待补 | P1     |
| 验收与文档    | CLI/IDE/SDK 共享运行时和持续发布验证                                        | 单元/集成测试很多                                                                                                                                                                                                                                                                                                                      | MVP 验证脚本没有覆盖完整 Desktop→真实 CLI 链；多份旧文档仍把已完成项列为缺口                                                    | P1     |
| 全进程回滚    | 官方 checkpoint 主要覆盖编辑工具                                            | 已对 shell/外部副作用诚实标记 partial                                                                                                                                                                                                                                                                                                  | 可进一步做全工具文件变更捕获，形成强于 Claude Code 的差异化                                                                     | P2     |

## 4. P0：统一 Process Sandbox Broker

### 4.1 当前证据

- [`agent-sandbox.js`](../packages/cli/src/lib/agent-sandbox.js#L64) 的显式 Agent sandbox 仍只接受
  `docker` 和 `bubblewrap`；Broker 的
  [`platform-sandbox.js`](../packages/cli/src/lib/process-execution-broker/platform-sandbox.js)
  已另行提供 macOS Seatbelt wrapper 与 Linux `prlimit` 执行计划。
- `bubblewrap` 已有真实 Linux 集成测试，macOS Seatbelt wrapper 有注入式单元测试；Windows
  adapter 通过系统 PowerShell bootstrap P/Invoke Win32，以 restricted token 挂起创建目标、
  加入 kill-on-close Job 后再恢复。Windows 真实测试已覆盖 privilege 收缩、`cmd.exe /s /c`
  内嵌引号、2 MiB 输出与 detached grandchild 清理；adapter/系统宿主缺失时严格模式仍
  fail-closed。
- Windows helper 仍是中间 wrapper，当前不能复制 Node/libuv fd3 IPC 描述符表，也不能让
  `spawn().pid` 保持 detached 目标身份。Broker 对这两类计划显式报告 unavailable：
  非严格模式审计降级，`CC_SANDBOX_STRICT=1` 则在启动前拒绝。
- Hook command 仍从完整 `process.env` 构造执行环境，但已通过 Process Broker；Broker 会移除已识别
  的敏感环境变量。按 executor 声明最小环境 allowlist 尚未完成。
- `run_shell`、`run_code`、Hook、Plugin Bin、LSP、MCP stdio、CLI/`cc ui` PTY 与 Desktop
  `child_process`/PTY 的已迁移入口现已进入 Broker；静态 spawn 清单中的剩余直接入口、原生模块和
  外部宿主仍无法证明遵守同一文件/网络边界。
- 2026-07-26 重新生成
  [`PROCESS_SPAWN_INVENTORY.generated.md`](./cli/PROCESS_SPAWN_INVENTORY.generated.md)：当前共
  290 个词法匹配（runtime 206、tooling 56、test 28）；runtime 已逐项归类为 157 个
  `brokered`、16 个 `audited-exemption` 与 33 个 `non-executable`，`unreviewed=0`。
  `docs:spawn-inventory:check` 在文档漂移或出现任意未复核 runtime 匹配时失败。
- 2026-07-26 已统一 Broker async/sync/PTY 的 CredentialAgent 边界：过滤后的 env 与 argv 会真正
  传给原生执行函数，审计仅记录 env/argv 过滤数量，拒绝路径会先脱敏 argv，过滤器异常时不再让
  sync 路径携带原始凭据继续执行；ref 通过 Windows named pipe / POSIX Unix socket transport，
  按 Broker execution decision、进程、host、TTL 与使用次数认证解析。
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
- Slash command 模板中的 `!`cmd``展开已进入`slash-command:bang` Broker origin；
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
  literal argv；Agent `run_skill` 现已通过 `createSkillProcessBroker(match)` 注入同一门面，仅
  声明 `shell-exec` 的 Skill 可获得，普通 Skill 收到 `null`，并有 Agent Core 回归测试覆盖。
- `init ai-media-creator` 生成的 `audio-gen` Skill 已声明 `shell-exec` capability；edge-tts/Python
  探测、异步合成与 piper stdin 路径均只使用宿主注入的无 shell Broker 门面，缺少门面时 fail-closed。
- `init ai-doc-creator` 生成的 `doc-generate` Skill 已按同一 capability/fail-closed 契约迁移；
  `chainlesschain ask`、pandoc 与 LibreOffice 探测/转换均使用独立 argv，Windows 路径不再依赖 shell 引号。
- 同模板组的 `libre-convert` Skill 也已迁移 soffice/libreoffice 探测和 headless 转换；用户输入路径
  保持独立 argv，Windows 默认安装路径直接交给无 shell Broker，不再生成原生 `child_process`。
- `doc-edit` 生成 Skill 的 LLM、Python、pandoc 与 soffice 路径已全部进入同一门面；xlsx/pptx
  临时脚本改从 `sys.argv` 和 JSON 侧车文件读取路径/修改结果，不再把用户值拼入 Python 源码。
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
- Desktop AI Commit 的 staged/working/stat Git 查询已改用 fail-closed `execFileSync` Broker 门面；
  `git diff` 参数保持独立 argv，并统一记录 `desktop:ai-commit-message` origin。
- Desktop PreviewManager 的开发服务器启动已显式进入 `desktop:preview-dev-server` Broker origin；
  保留自定义 shell 命令、输出解析、LRU 与进程生命周期语义，并提供无真实进程的测试注入点。
- Desktop PythonBridge 的 Python 版本探测与工具脚本启动已分别进入
  `desktop:python-bridge-probe` / `desktop:python-bridge-tool`，均使用无 shell 字面 argv 并支持测试注入。
- Desktop FineTuningManager 的 llama.cpp 训练进程已进入 `desktop:fine-tuning-llama-cpp` Broker origin；
  训练参数保持独立 argv，取消/进度/结果生命周期不变，并由现有 manager 测试直接注入执行器验证。
- Desktop 语音链的 Edge TTS、Local Piper 探测/合成及 Whisper 单次/流式转写已分别进入
  `desktop:speech-edge-tts`、`desktop:speech-local-tts-*` 与 `desktop:speech-whisper-*`；
  均保留字面 argv、进度/流生命周期和可注入测试执行器。
- GGUF/GPTQ 量化与 CodeExecutor 的 Python 探测/代码运行已进入 `desktop:quantization-*`、
  `desktop:code-executor-*`；取消、进度和结果契约不变，代码执行继续使用无 shell argv。
- Control Panel API、Data Science Python 与 Project Automation 脚本分别进入
  `desktop:menu-control-panel-api`、`desktop:data-science-python`、
  `desktop:project-automation-script`，自动化脚本不再依赖 shell 字符串执行。
- Desktop Plugin Loader 的依赖探测、安装、归档解压与兼容命令入口已进入
  `desktop:plugin-loader-dependencies`、`desktop:plugin-loader-install`、
  `desktop:plugin-loader-extract` / `desktop:plugin-loader-command`；Windows npm 使用
  `npm.cmd`，PowerShell 解压路径只经 `$args` 传入，并记录 `pluginSource` provenance。
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

## 5. P0/P1：后台 Agent 实时交互总线产品化

### 5.1 已实现（2026-07-26 复核）

- [`background-agent-worker.js`](../packages/cli/src/workers/background-agent-worker.js) 启动 turn child
  时已打开 Node IPC；[`headless-runner.js`](../packages/cli/src/runtime/headless-runner.js) 将后台
  `ask_user_question` 接到 `backgroundInteractionClient`，当前工具调用会保持挂起。
- [`background-interaction-resolver.js`](../packages/cli/src/lib/background-interaction-resolver.js)
  实现版本化的 `interaction-request` / `interaction-response`，并逐字段绑定
  `backgroundAgentId/sessionId/turnId/toolUseId/sequence`；不匹配的回答不能解析其他请求。
- worker 通过
  [`background-session-transport.js`](../packages/cli/src/lib/background-session-transport.js)
  向 attach 客户端广播 `interaction_request`。客户端回答后，结果经 worker 返回同一个 turn child，
  不进入下一轮 `promptQueue`；重连时会重放当前 pending request。
- [`background-interaction-journal.js`](../packages/cli/src/lib/background-interaction-journal.js)
  在 request 对宿主可见前持久化完整 binding/payload 指纹，并在结果交付 child 前先写 terminal
  settlement。同一答案重试幂等，不同答案与跨绑定响应 fail-closed；worker 重启或监管器确认
  worker 已丢失时，遗留 pending 会确定性写成一次 rejected settlement。
- [`interaction-binding.js`](../packages/cli/src/lib/interaction-binding.js) 是 runtime 的绑定
  规范化和逐字段比较事实源。Desktop trusted main、VS Code、JetBrains、Web Panel 与 Remote
  Control 只保留并回传 request 携带的 opaque binding，不能以 UI 文本或自报字段改变最终
  session/turn/tool authority；Remote Control 的回答还要求认证的人类 actor 和 `prompt` scope。
- TypeScript/Python SDK 的自动 question/MCP elicitation callback 会原样回传 binding；
  WebSocket `session-answer`、后台 `bg-answer` 和 Remote Control `question.answer` 都要求完整
  binding。Agent SDK `interaction.ndjson` 中的共享 Golden 向量由 CLI、SDK、VS Code 和
  JetBrains 用于缺字段、stale 及跨 session/turn/tool 一致拒绝测试。
- `headless-side-effect-ledger-resume.test.js` 已验证后台问题在同一 turn 内解析；
  `background-stability-realspawn.test.js` 已在本地 Windows 覆盖真实子进程链的
  提问→断线→重连→回答→同 turn 完成。现有 CLI CI 会在 Ubuntu/macOS/Windows 运行全部
  integration 分片，且该用例无平台跳过条件；当前改动尚无远端运行结果，三平台结果仍待验收。

因此，“后台提问只能结束当前 turn、回答必须另起一轮”的核心缺口已经关闭。

### 5.2 剩余收口

现有双向通道已经收敛为以下跨宿主交互协议：

```text
turn child -> worker (Node IPC)
  interaction-request {
    protocolVersion, requestId, payload,
    binding { backgroundAgentId, sessionId, turnId, toolUseId, sequence }
  }

worker -> turn child (Node IPC)
  interaction-response { protocolVersion, requestId, result | error, binding }

worker <-> attach/Desktop/IDE/Remote
  interaction_request / interaction_response
```

已完成：

- attach、Desktop、VS Code、JetBrains、Web Panel 与 Remote Control 共用 runtime
  authority/binding resolver 和 Golden Fixtures；UI 文本不能自行代表用户授权。

仍需完成：

- question、permission 与 MCP elicitation 共用状态迁移、取消、超时、重复回答幂等和有界背压。
- Headless 无可交互宿主时返回结构化 `defer`，交给 SDK/CI 处理，不能挂死或静默 allow。

### 5.3 剩余验收标准

- stale、伪造、跨 session、跨 turn 和跨 tool call 的回答在所有宿主上一致拒绝。
- 本地 attach、WebSocket、Desktop、VS Code、JetBrains 使用相同 authority/binding 测试向量。
- `working`、`needs_input`、`waiting_permission`、`uncertain_side_effect`、`idle` 状态有唯一生产者和
  明确迁移表。
- 真实后台 Agent 的“提问→断线→重连→回答→同 turn 完成”进入三平台 E2E。

## 6. P1：Hooks v2

### 6.1 当前证据

- [`settings-hooks.cjs`](../packages/cli/src/lib/settings-hooks.cjs#L35) 的旧配置加载面仍是部分集合；Hooks v2 runtime 注册表已扩展为 40 个事件。
- 同一加载器在 [`settings-hooks.cjs`](../packages/cli/src/lib/settings-hooks.cjs#L111) 只收
  `type: "command"`。
- `TaskCreated` / `TaskCompleted` 已由 Subagent 生命周期生产；顺序与并行 tool loop
  会在每项 settlement 后发 `PostToolUse`/`PostToolUseFailure`，并在整批完成后发一次
  `PostToolBatch`；成功的文件写工具会发支持跨平台 glob 过滤的 `FileChanged`。
- 自动与手动压缩会发 `PostCompact`；Desktop/WS 与 headless MCP 通道会发
  `MCPElicitation` 兼容事件以及成对的 `Elicitation`/`ElicitationResult`。
- Setup 已接 stream/一次性 headless 启动门并 fail-closed；UserPromptExpansion
  在模型调用前合并唯一 prompt 更新和附加上下文，冲突会拒绝本轮。
- 停止 hook 的执行错误、畸形决策与断路器打开会发 `StopFailure`；团队调度状态机在成员
  从运行态真实回到空闲态时发 `TeammateIdle`，不把初始化或重复 idle 当作事件。
- 真并行和最严决策合并已经有实现，但仍存在 opt-in/default-flip 余量。
- CLI 与 Desktop command/script Hook 已进入各自的 Process Broker。所有 CLI Hook 面与
  Desktop Hook 已改用最小环境，额外变量要求管理员 allowlist 与 Hook 请求取交集；Hooks v2
  另有 command/workspace/MCP/agent/skill allowlist、MCP 共享授权和 delegated executor
  独立超时。旧 command/script 兼容面仍会显式进入 shell，跨平台强文件写沙箱尚未完成。

2026-07-26 复核：`hooks-v2-runtime.js` 已提供 40 事件注册表、5 种公共 executor、trusted
JS compatibility handler、默认并行
执行、按 id 去重、顺序兼容开关和 `executeHooks` 公共入口；JS handler、Process Broker
同步执行、Agent IPC 注册状态及 Context Source Ledger 适配已由 M5 E2E 覆盖。真实 loop
新增真实 loop 的 `PostToolUseFailure`/`PostToolBatch` 绑定聚合、FileChanged 跨平台 glob、
Setup fail-closed、UserPromptExpansion、StopFailure、TeammateIdle 状态迁移、最小环境交集、
managed target deny、MCP 共享授权和 delegated timeout 测试。
11 项高价值 producer 与 managed policy 缺口已闭合，但仍未完成跨平台强文件写 sandbox，因此本节的
“完整 Hooks v2”仍是进行中，不能仅凭事件白名单宣称全部完成。

Claude Code 当前官方 Hook 面已包括更完整的生命周期，并支持 `command`、`http`、`mcp_tool`、
`prompt`、`agent` 五类处理器。值得对标的重点不是“事件数量”，而是把 Hook 作为稳定公共 API。

### 6.2 建议

1. 建立唯一 `HookEventSchema`，CLI、SDK、IDE、插件共用版本和 Golden Fixtures。
2. 补齐高价值事件：
   - `Notification` ✅ **已实现**（`hook-events.js` 新增枚举、`session-hooks.js` 实现 `fireNotification`、`agent-repl.js` 接入触发、payload 支持 `message`/`level`/`subtitle` 字段）
   - `Setup` ✅
   - `UserPromptExpansion` ✅
   - `PostToolUseFailure` ✅
   - `PostToolBatch` ✅
   - `PermissionDenied` ✅
   - `StopFailure` ✅
   - `FileChanged` ✅
   - `PostCompact` ✅
   - `TaskCreated` / `TaskCompleted` ✅
   - `Elicitation` / `ElicitationResult` ✅
   - `TeammateIdle` ✅
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
  原生 schema UI 已接入，CLI validator 已补齐 dependent/pattern/contains/propertyNames 等常用 vocabulary。Desktop/VS Code 已复用共享 core，JetBrains 通过同一 fixture 对拍，覆盖 MCP form elicitation 规定的受限 flat vocabulary 与提交前校验；这不等于完整 JSON Schema meta-vocabulary。

2026-07-22 另补齐 Agenda 的持久执行 lease 和常驻入口：`AgentScheduleStore.claimDue()`
通过跨进程锁标记 due 条目，完成/失败时释放，进程异常后由过期 lease 回收，避免两个
`cc agenda run` 同时触发同一任务；`cc agenda run --watch <seconds>` 现在以可停止
daemon loop 持续轮询。`EventRuntimeStore` 与可停止的 `EventRuntimeWorker` 已提供 durable inbox/outbox、幂等、租约回收、失败重试/死信；`EventRuntimeProducer` 已规范 origin/authority，Agent IPC、MCP resolver、Webhook、Telegram 和 Plugin Monitor 在 `CC_EVENT_RUNTIME_DURABLE=1` 时均自动接入，队列超过上限会 fail-closed。2026-07-26 起，真实发布 binary 的 lazy-dispatch 入口统一托管 process-level host：所选命令先注册 handler 再开始 claim，长驻命令持续 drain，短命命令退出前进行最多 10 tick 的有界 final drain。Webhook/Telegram durable 事件通过 queue/type/origin required-handler 恢复路由进入当前会话，不会在无 handler 时被误 ack。

`cc status --json` 除 inbox/outbox 的 active、claimable、delayed、processing、dead、过期租约、容量余量及 `normal/high/full` 压力外，还会从同锁域、100 条上限的 `hosts.json` 输出 process host 的 pid、role、heartbeat、lastStats/lastError 及 running/stale/stopped 汇总。`npm run runtime:event-recovery` 会启动两个真实 Node 进程：首进程 claim 后硬退出，lease 过期后 successor 以更高 fence 接管，通过真实 host 执行幂等 marker 副作用并结算；本地演练锁定 attempts 2、fence `1 → 2`、副作用应用一次及 stale/stopped host 可观测。核心常驻与恢复闭环已完成；后续新增外部副作用仍必须携带稳定 event id，并提供领域幂等 handler。

2026-07-22 已补齐 MCP transport 核心：服务器发出的 `elicitation/create` 会进入注入的
handler，或通过 `elicitation-request` 事件交给宿主；支持 `accept/decline/cancel` 规范化、
超时取消和无宿主时 fail-closed decline。启用 `CC_INTERACTIVE_QUESTIONS=1` 的
stream/headless 路径会复用现有结构化问题通道。WS question channel、REPL、Desktop 原生表单以及 SDK
schema fixture 已接入；Desktop/VS Code/JetBrains 已补齐 MCP 受限 form vocabulary：
字符串长度和四种标准格式、数值上下界、`enum`/`enumNames`/带标题 `oneOf`、多选
`items.enum`/`items.anyOf` 与 item 数约束，并在提交前使用同一 conformance contract
校验。2026-07-26 又按 MCP 稳定版本 `2025-11-25` 补齐 URL-mode：client 声明
form/URL capability，仅接受带 `elicitationId` 的无凭证 HTTPS URL；CLI、Desktop、
VS Code、JetBrains 和 SDK 均展示完整 URL/host，并在用户明确同意后才打开浏览器，
URL 应答不携带 `content`。`notifications/elicitation/complete` 按 server/id 关联，
未知、跨 server 与重复通知会被忽略；`URLElicitationRequiredError (-32042)` 在全部
URL 流完成后只重试原工具调用一次。无交互宿主输出 typed
`elicitation_deferred`，MCP wire 同时 fail-closed `decline`，不会挂死。因此 P1-5
路由项已完成；嵌套 schema、`$ref`（含远程解析）和完整 Draft 2020-12 继续归 P1-11，
不回退 P1-5 状态。Streamable HTTP 也会在初始化后发送协商版本 header，分派 POST SSE
响应中先于 request response 到达的 server message，并在交互宿主安装 handler 后保持
可恢复的 GET SSE 接收器；因此异步 URL complete 与 HTTP server-initiated elicitation
不再只在 stdio 上生效。

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
persona Skill 和 persisted MCP tool schema；未注入的 lazy/discoverable Skill 不计入上下文成本。
普通 Skill 已使用 descriptor/body 双层 cache：discovery 仅解析 YAML frontmatter，正文只在 persona
注入或 `run_skill` 执行时 materialize，并按文件 mtime/size 失效。cache ledger 不保存正文，
但会分别记录 descriptor prompt return、body 磁盘读取、cache hit、正文大小等价量，以及正文
真正进入 prompt 的 `contextLoads/contextTokens`；因此 `run_skill` 读取 handler 正文不会被误报
成 provider token。

Headless 与交互 REPL 现在共享 session-scoped Skill loader。两种入口都会把 admitted MCP schema、
实际 persona 和最新 Skill cache ledger 写为 content-free `context_sources` 事件；REPL 在 MCP
启动、每轮完成、`/reload-skills` 和退出时刷新。`cc context --sources` 文本和 JSON 可展示
resident/lazy、逐 Skill 来源、磁盘/缓存读取与 prompt 注入成本。

仍可继续增强的可观测性：

- 哪条 compaction re-injection 导致 cache miss。
- Subagent、Hook、MCP 和主会话各自消耗多少上下文和预算。
- `/context --json` 与 provider 最终计费 token 的持续误差上限。

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

Headless 与交互 REPL 现在共用
[`createTurnBindingFeed`](../packages/cli/src/lib/turn-binding.js) 作为唯一事件归因核心。
REPL 会 rehydrate 已持久化表、在 rewind/clear/compact 后剪除废弃 timeline，并在每个
settled turn（包括无工具问答）以 fail-closed 锁定写入。Agent Core 的 checkpoint、
tool-executing 和 tool-result 全程保留 provider 原始 `tool_use_id`、`turn_id` 与稳定的
permission decision id；父 turn 也持久化 child trace/checkpoint/tool/worktree lineage、
IDE user edit 标记及顶层交互 `--worktree` branch id。

当前 coverage 保持诚实：只有可信调用方显式声明 `coverageTarget=full`、
`writerIsolation=exclusive-workspace`，且没有 exclusions、unsafe entries、外部 Git metadata
或外部副作用时，事务引擎才允许 `full`。受平台隔离保证的 managed shell/process 会把工作区
内容、mode 与毫秒级 mtime 纳入持久事务，但因网络、数据库、消息、部署、支付等副作用不可撤销，
整体仍标为 `partial`；ambient MCP/LSP、后台 shell/Agent/Hook、外部 executor 或 additional
roots 会跳过 checkpoint 并报告 `none`。只有 active managed process 缺少强制
platform/process-tree 边界时才在 spawn 前 fail closed。Linux managed process 要求受信
bubblewrap contract，Windows 使用 restricted token + kill-on-close Job；macOS managed
shell/process 目前因没有可证明的 process-tree 保证而在 native spawn 前拒绝，直接文件工具仍可
checkpoint。

Process Broker 已完成运行前 checkpoint、成功提交、失败/取消回滚，以及 canonical workspace
identity、state authority 和跨进程锁。死进程只有在 owner/lock 精确匹配、所有 execution 已
settled 且具备 process-tree proof 时才自动回滚，否则返回 `recovery_required`。后续增强只剩把
同一 binding/coverage 与 recovery 视图直接暴露给 SDK 和 IDE；外部副作用继续明确不可回滚。

## 10. P1：Plugin 凭据与供应链闭环

当前 Plugin 能力声明、能力 diff、重新 consent 和 options schema 已较完善。剩余高价值工作：

- 敏感 option 已从 user-scope JSON 迁移到 DPAPI、macOS Keychain、Linux Secret Service（不可用时 fail-closed）。
- legacy manifest 兼容迁移窗口默认保留，但企业/显式严格模式已关闭隐式旁路：
  `requirePluginCapabilityConsent` 会同时强制 `permissions` 声明，另可使用 managed
  `requirePluginCapabilityDeclarations` 或 `CC_REQUIRE_PLUGIN_CAPABILITIES=1` 独立
  fail-closed；未声明插件不再能靠删除权限块绕过 consent。
- 插件 MCP stdio、LSP、settings Hook、Monitor 与 `run_shell` 命中的 Plugin Bin 已进入 Process Broker，并携带 `plugin_id/version/source`；CLI/`cc ui` 的 `node-pty` 与 Desktop 主进程的 `child_process`/`node-pty` 入口已统一进入 Broker 并记录脱敏 provenance，原生模块和外部宿主仍待收口。
- Manifest 的直接 URL MCP network domains 已在连接前强制；stdio/native 外部宿主的
  filesystem roots、network egress、process 与 credential 仍需随 P0 平台沙箱完整收口。
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

2026-07-26 已完成清单收口。`withFileLock` 仍允许 Advisory 调用方选择 best-effort，
但 Critical/Durable 调用方均显式使用 `failIfUnavailable` 或等价的有界严格锁：

- `ApprovalAuthorityStore` 在锁内执行 CAS revision，并以临时文件 fsync/rename；
  side-effect ledger、turn binding 与 JSONL session append 默认拒绝持久化失败。
- Agenda/Event Runtime 保持 lease/fence；Cowork cron 增加持久 delivery id、owner、
  lease 续租与 fenced settlement，过期 owner 不能覆盖后继结果。Goal、config/feature
  与 MTC batch 读改写也不再无锁继续。
- Plugin trust、capability consent、plugin option secret-ref、project MCP trust、
  MCP OAuth、sync credential 与 pairing token 均在锁内严格读取并原子替换；损坏文件
  不会被空对象覆盖。项目 MCP trust service 或首次 fingerprint 无法持久化时，
  `.mcp.json` 可执行配置直接跳过。
- VS Code 与 JetBrains 对共享 `ide/session-index.json` 使用同一个原子 `.lock`
  目录协议；锁超时与损坏输入均 fail-closed，写入使用同目录临时文件原子替换。

Advisory 的 UI cache、统计快照和提示索引仍可按上表 best-effort；该例外不再用于
审批、幂等、调度、信任或凭据状态。

### 11.3 标准化 JSON Schema

2026-07-26 已完成标准化迁移：

- [`json-schema-validate.js`](../packages/cli/src/lib/json-schema-validate.js) 现在是
  `Ajv2020`/`ajv-formats` 的稳定协议适配层，不再自行近似实现 keyword 语义。Draft
  2020-12 meta-schema、`$dynamicRef` 动态作用域、嵌套 `$id`、`unevaluated*` 和跨
  applicator evaluated-location 均由标准引擎执行。
- 适配层保留原有 `code`/`keyword`/RFC 6901 JSON Pointer、规范化 schema path、
  key-order-independent digest 与 `structured_result` envelope；digest 还会绑定
  已解析外部文档内容，远端契约变化不会复用旧摘要。SDK/IDE 消费者无需因校验器
  替换改变协议。
- 文本、单轮 `stream-json` 与输入流入口在模型调用前解析并编译完整 schema graph。
  本地相对 ref 限于根 schema 目录并校验 realpath；远程 ref 只接受无凭证公网 HTTPS，
  复用 DNS pinning/重绑定及 private/metadata SSRF 防护，另有 32 文档、单文档 1 MB、
  总计 4 MB 和 10 秒请求上限。远程 schema 不能反向读取本地文件。
- 回归覆盖 `allOf + unevaluatedProperties`、重叠 `properties`/
  `patternProperties`、`prefixItems + unevaluatedItems`、递归动态引用、本地/递归
  HTTPS 引用、私网 SSRF、远程→本地 pivot 与文档预算超限；坏 schema/ref graph
  在任何模型调用前 fail-closed。

## 12. P1：Agent SDK、CI 与权限默认值

2026-07-24 复核时，SDK 主体已经从单一 TypeScript 雏形扩展为双语言基线：

- [`packages/agent-sdk`](../packages/agent-sdk/) 与
  [`packages/agent-sdk-python`](../packages/agent-sdk-python/) 均覆盖协议中的 24 类 typed stream
  事件，并支持 approval、question、MCP elicitation callback、session resume。
- 两端都会无损保留未知事件，旧消费者不会因新事件类型破坏事件泵；共享 NDJSON fixture 作为
  跨语言事实源。
- Python 包已提供穷举 CI consumer、最小权限 GitHub Actions 示例和 22 项 hermetic 测试。
- `chainlesschain-agent-sdk==0.1.0` 已通过 tag 驱动的 PyPI Trusted Publishing 正式发布；
  发布门包含版本/tag 一致性、编译、测试、共享 fixture 回放、wheel/sdist 构建、`twine check`
  和隔离环境 wheel 导入。发布后又从公开 PyPI 在 Python 3.10、3.12、3.13 上完成安装与
  公共 API 烟测。证据：[PyPI](https://pypi.org/project/chainlesschain-agent-sdk/)、
  [发布工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/30065060091)、
  [公网安装矩阵](https://github.com/chainlesschain/chainlesschain/actions/runs/30065341896)。
- 上述 0.1.0 是 22 类事件发布基线；当前源码新增的
  `ElicitationDeferredEvent` / `ElicitationCompleteEvent` 尚未发布新版本，不能把本地
  24 类事件验证误写成公网包已包含。

因此 Python SDK、基础事件透传、GitHub Actions 示例和 Python 独立发布门不再列为缺口。
剩余工作集中在跨语言、跨宿主兼容门：

- CLI、TypeScript/Python SDK、VS Code、JetBrains、Desktop 共用版本化 schema package 和
  Golden NDJSON，而不是由各宿主手工复制 union。
- 协议变更增加 SemVer、capability negotiation、deprecation window、兼容矩阵和未知字段策略。
- 把已落地的 Python 独立发布门扩展为 npm/Python 联合兼容门，加入双语言版本矩阵、
  穷举 consumer 与真实 CLI smoke，防止只更新一端。
- WebSocket approval gate 迁移为安全默认；项目配置不能放宽 managed deny、bypass 或 auto mode
  的组织边界。
- GitLab 模板若发布，也沿用最小、可审计的 `--bare --ephemeral --dontAsk` 基线，不默认开放
  高风险工具或长期凭据。

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

### 14.1 全工具文件回滚：✅ 分层完成（2026-07-29）

Process Broker 已在受控执行前建立持久 workspace transaction，并在成功时提交、失败或取消时
回滚；跨进程互斥、workspace root identity 与 authority 路径均 fail closed。死进程只有在
owner/lock 精确匹配、所有 execution 已 settled 且具备 process-tree proof 时才自动回滚，
否则返回 `recovery_required`。采用分层承诺：

- `full`：可信调用方显式声明 `coverageTarget=full` 与
  `writerIsolation=exclusive-workspace`，且没有 exclusions、unsafe entries、外部 Git
  metadata 或外部副作用。
- `partial`：受平台保证的 managed shell/process 工作区文件可恢复，但外部副作用不可恢复。
- `none`：没有可信快照，或存在未静止 writer/additional root；checkpoint 会跳过并明确报告
  coverage。只有 active managed process 缺少强制 platform/process-tree 边界时才拒绝执行。

Linux managed process 要求受信 bubblewrap execution contract；Windows 使用 restricted
token + kill-on-close Job，并在要求的 AppContainer 边界缺失时拒绝；macOS managed
shell/process 当前因没有可证明的 process-tree 保证而在 native spawn 前拒绝，直接文件工具仍
可 checkpoint。数据库写入、发送消息、部署、支付等外部动作不会被包装成“可回滚”。

验证包括 17 个核心测试文件（198 passed / 16 skipped / 0 failed）、共享 state lock
16/16、真实 Windows nested restricted-token Broker 与跨进程 crash recovery。P2-16 下游兼容
烟测中的旧 commit/rollback 回归和真实双进程 DAG 也通过。

### 14.2 Auto mode 安全分类器评测

ChainlessChain 已有 auto/dontAsk 等权限模式。若要进一步对标 Claude Code 的独立安全分类器，
应先建立离线风险集和回归基准，评测越权路径、秘密外发、生产部署、强推、未审核合并、
第三方 Agent 无隔离执行等场景。分类器只能增加一道防线，不能替代 deny 规则和 OS 沙箱。

### 14.3 大规模 Agent Teams：🟡 基础批次（2026-07-29）

当前状态是基础批次，而非完成。已有 Team、Workflow、Batch 和 Worktree 原语，并新增：

- 10k task / 64 worker indexed scheduler；
- bounded mailbox/backpressure 与真实 stream usage；
- per-task tightened contract、fenced lease、claim-time token/USD reservation；启用 token/USD cap 时，
  usage 缺失或远端模型无法定价会 fail closed；
- scope ownership、fail-closed durable hooks/journal、跨进程 state ownership；
- 崩溃后的真实任务默认停止并要求裁决，只有 dry-run 或显式 `retrySafe: true` 才自动重领；
- resume 以 append-only journal seq+digest 锚定治理状态，并保留带 commit/integration/cleanup
  阶段的 run-scoped worktree manifest；
- worktree cleanup 采用 prepare→persist→remove→persist 两阶段协议，恢复路径绑定当前 repo、
  run、branch 与 `.worktrees` 直接子目录。

多 worker 的真实 Agent/shell 执行强制使用 `--worktree`；`scopePaths` 只影响调度，不能证明命令的
实际写集。collaboration governance journal 不保存 prompt/argv，但 `--state` 恢复文件是**未签名
的可信控制面 authority**，包含 task graph、命令/提示词、预算、权限与 mailbox 内容。真实执行
强制把它放在 Agent 可写 repo 之外；seq+digest 只提供回滚/分叉一致性，不是来源认证。v5 严格
authority schema 会拒绝 v2–v4 状态。`--symlink-dirs` 只允许显式批准的 `node_modules` 根，且它
是指向主 checkout 的可写共享，会降低依赖隔离。

仍未闭环：

- IDE Agent View 人工接管；
- 可交互的 kill-point/side-effect recovery adjudication 与安全续跑；
- 跨进程分布式队列与长期 soak；
- worktree DAG 当前只保证执行顺序；依赖任务不会自动继承上游未集成分支的文件成果。

在这些故障与运维闭环完成前，不应把基础扩容宣传为生产级大规模 Agent Teams；继续增加并发仍会
放大冲突、成本和不可恢复副作用。

### 14.4 标准 OTel Collector 出口：✅ 已完成（2026-07-29）

真实发布 binary 已接入 process-level OTel Collector runtime，不再只依赖本地 OTLP JSON 文件：

- traces/metrics 支持标准 OTLP/HTTP JSON、OTLP/HTTP protobuf 与 OTLP/gRPC；兼容
  `OTEL_EXPORTER_OTLP_*` 的全局/分 signal endpoint、protocol、headers、timeout、gzip、
  `OTEL_SERVICE_NAME` 和 `OTEL_RESOURCE_ATTRIBUTES`；
- HTTPS 与 HTTP/2 gRPC 均支持标准 CA、client certificate、client key 环境变量，可接企业 mTLS；
- 2048 条默认有界队列、批量发送、`Retry-After`/指数退避、最大尝试次数、丢弃计数与
  per-process 原子 `0600` crash spool 已闭环；后继进程只接管死亡 owner 的同 endpoint/protocol
  队列，避免活进程之间互相窃取；
- agent、eval、team 的真实 `TelemetryRecorder` 会进入 Collector；team 另输出任务数、token、
  USD 成本、失败数、完成数聚合 metric，并保留 `workflow.run_id` / `workflow.name` 维度；
- `--otlp-endpoint` 在 eager/lazy binary 均生效，正常或门禁失败退出前都会 final flush；
  `cc status --json` 暴露 protocol、signal endpoint、queue pressure、retry/drop/permanent failure、
  recovery/spool error；
- 内容继续默认不出端；prompt/response/tool arguments 只有显式 `--otlp-content` 才进入 recorder，
  所有 string attribute/event 在离机前仍走 secret redaction。

最小配置：

```bash
# OTLP/HTTP（默认 http/json；也可设置 http/protobuf）
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
cc agent -p "..."

# OTLP/gRPC
OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example.com:4317 \
OTEL_EXPORTER_OTLP_PROTOCOL=grpc \
OTEL_EXPORTER_OTLP_CERTIFICATE=/path/ca.pem \
OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE=/path/client.pem \
OTEL_EXPORTER_OTLP_CLIENT_KEY=/path/client.key \
cc team run tasks.json
```

协议、重试、背压、crash recovery、mTLS 配置、真实 binary exit flush 与隐私回归由
`otlp-collector-exporter.test.js`、`otlp-cli-entrypoint.test.js`、
`headless-runner-otlp.test.js`、`status-observability.test.js` 覆盖。

## 15. 建议实施路线

| 批次          | 时间建议 | 交付目标                                                                          | 退出条件                                          |
| ------------- | -------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| M0 事实基线   | 1 周     | 统一 parity 验收脚本、spawn 清单、文档状态清理、权限双系统标识                    | 当前能力可一键复验，旧待办和权限 UI 不再误导      |
| M1 可信执行   | 4–6 周   | Process Broker、Linux/macOS/Windows 后端、凭据 default-on、关键状态 fail-closed   | 所有生产子进程统一受控，三平台严格测试通过        |
| M2 实时交互   | 2–3 周   | 已有 worker-child IPC、持久 settlement 与跨宿主 resolver 之上的三平台断线重连 E2E | 所有宿主同 turn 继续，stale response 全拒且可恢复 |
| M3 扩展运行时 | 4–6 周   | Hooks v2、常驻 Event Runtime、MCP Elicitation/Channels                            | 事件可恢复、幂等、有界，Hook 协议稳定             |
| M4 协议收口   | 3–4 周   | Context ledger、统一 turn binding、标准 JSON Schema、双语言 SDK/IDE golden gate   | CLI/SDK/IDE/Desktop 事件与恢复语义一致            |
| M5 差异化     | 按需求   | 全工具文件回滚、安全分类器评测、大规模 Agent                                      | 有真实用户指标与故障模型后再投入                  |

可以并行的工作：

- M0 可与 M1 的接口设计并行。
- M2 的三平台恢复验收可和 M1 剩余入口审计并行，并继续复用同一 authority。
- Context ledger 与双语言 SDK Golden Fixtures/发布门可独立推进。

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

| 阶段     | 任务                                                                    | 状态                     | 交付文件                                                                                                       |
| -------- | ----------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **M0**   | `process-execution-broker` 单例 + spawn审计清单                         | ✅ **Completed**         | `packages/cli/src/lib/process-execution-broker/index.js`                                                       |
| **M0**   | parity 验证脚本 + npm script `runtime:convergence`                      | ✅ **Completed**         | `packages/cli/scripts/test-runtime-convergence.mjs`, package.json scripts                                      |
| **M1**   | Broker 支持所有 origin 类型 (shell/mcp/lsp/agent/background/hook)       | ✅ **Completed**         | Broker 内置权限决策、凭据过滤、平台沙箱和审计机制；未提供 `addPolicyEnforcer()` 公共 API                       |
| **M1**   | 现有入口接入审计 (hook-manager)                                         | ✅ **Completed**         | `packages/cli/src/lib/hook-manager.js` 已由 Process Broker 执行并统一审计                                      |
| **M2**   | 后台 Agent 实时 IPC 总线 (`agent-ipc-bus`)                              | ✅ **Completed**         | `packages/cli/src/lib/agent-ipc-bus.js`                                                                        |
| **M3-1** | Hooks v2: 当前 40 个事件 + 5 种公共 executor（另有 trusted JS）统一 API | 🟡 **Runtime completed** | `packages/cli/src/lib/hooks-v2-runtime.js`；高价值 producer/managed policy 已接，跨平台强文件写 sandbox 仍待补 |
| **M3-2** | Event Runtime 常驻框架 (emit/subscribe)                                 | ✅ **Completed**         | HooksV2Runtime 内置 EventEmitter，支持事件调度                                                                 |
| **M4-1** | Context Source Ledger 来源记账                                          | ✅ **Completed**         | `packages/cli/src/lib/context-source-ledger.js`                                                                |
| **M4-2** | Turn binding schema (sessionId/turnId/toolUseId 全透传)                 | ✅ **Completed**         | Broker/IPCBus/Ledger 统一支持 traceId 透传                                                                     |

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
