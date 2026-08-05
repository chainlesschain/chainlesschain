# CLI Runtime 当前实现核对（稳定版 0.162.197）

> 更新时间：2026-08-05。本文同时记录当前代码与正式发布证据。当前源码版本、npm `latest` 与最后完整门禁通过的公开基线均为 `0.162.197`；发布能力仍绑定精确 tag SHA，而不是仅凭版本字符串判断。路线图与实验性设计仍以各自计划文档为准。

## 版本与证据边界

- `0.162.197` 是当前生产推荐基线。`v-npm-0-162-197` 精确指向 `a03ad1b548cc6f15c9bef8f82d519e9c625eef8d`；同一 SHA 的 `CLI CI`、`CLI Strict Sandbox`、专用 npm 发布、exact-SHA gate、不可变 tarball/SBOM 和 provenance 均成功。
- `0.162.193` 保留为历史审计记录：它由错误接管专用路径的通用 workspace publisher 写入，缺少同 SHA 的完整 CLI 矩阵和专用制品交接，不能追溯性补造成权威发布；它已被 `0.162.197` 正式取代。
- 当前树的包版本仍为 `0.162.197`。发布后新增 registry bytes、签名 provenance、workflow identity 与重试回读校验；这些变更加强后续发布链，不改变 `a03ad1b548` 已发布 CLI 的运行时能力。
- IDE 当前公开与源码版本已对齐：Open VSX `0.37.42`、JetBrains Marketplace `0.4.79`，双标签都指向 `0844f1cb8512bbb7cde2c0242d84f91533c6f5af`，各自 tag workflow 完成三平台宿主、制品与 registry 回读。微软 VS Code Marketplace 仍未发布。

## 当前边界

CLI 运行时由命令分发、会话生命周期、受控执行与回滚、Agent Team authority、扩展运行时、事件总线和可观测出口共同组成。

```text
cc entry
  ├─ command manifest + lazy dispatch
  ├─ foreground / background agent runtime
  │    ├─ local attach transport (NDJSON / TCP fallback)
  │    └─ canonical transcript / compaction / resource-budget authority
  ├─ process-execution-broker
  │    ├─ platform sandbox + native execution attestation
  │    ├─ credential agent
  │    └─ managed workspace transaction + checkpoint restore saga/recovery
  ├─ plugin runtime
  │    ├─ manifest capability + sandbox policy
  │    ├─ hooks / MCP / LSP / monitors / native bins
  │    └─ lifecycle + signature / SBOM / source provenance
  ├─ skill-process-broker
  │    └─ host-owned facade → process-execution-broker
  ├─ durable event + interaction journal
  ├─ Agent Team authority
  │    ├─ local state v6 + distributed queue v1
  │    └─ budget / lease / worktree / adjudication fences
  ├─ bounded usage + retry attribution
  ├─ MCP ws/wss + uncertain-outcome recovery authority
  ├─ Auto mode safety classifier
  ├─ OTLP traces + metrics exporter
  └─ session hooks (Setup / Notification / lifecycle)
```

## 0.162.197 发布增量

- **配置与 sandbox 默认值**：schema secret 不允许经普通 `config set` 写入，必须使用隐藏 TTY/stdin 与 OS store/owner-only fallback 的 `config set-secret`；显式 `workspace-write` / `strict` 以及 managed-required sandbox 在能力缺失时失败闭合。`mcp add` 默认 local scope，常规 `status` 使用有界 quick probe，完整 Docker Compose 细节改由 `--deep` 请求。
- **MCP 恢复权威**：`ws/wss` transport、可信动态 header 与 timeout notification 已接线；REPL、stream、Cowork/host 与 WebSocket 使用共享的持久恢复记录。结果不明确时必须 verification/adjudication，不能盲目重放可能已有外部副作用的调用。
- **Canonical session 与预算**：REPL、stream、WebSocket、headless 使用可验证 transcript projection、事务化 summary/compaction 与 stale/corrupt resume 拒绝。持久 token/USD/wall-clock 预算已接入后台与 Team adapter，但尚不是跨所有宿主的统一预算 authority。
- **Agent 工作流控制**：plan/todo revision 与 authority ceiling、受控 Skill 子 Agent、后台 launch profile、semantic handoff、`/btw` 临时旁路、manifest-driven help 与确定性 shell completion 已进入当前树。
- **原生更新恢复**：不可变 release identity、签名 updater rollback chain、下载替换恢复与跨平台 cleanup/recovery fence 已落地；真实签名、平台 notarization/Authenticode 与最终发布矩阵仍由 release gate 决定。
- **Checkpoint restore saga**：直接恢复与 timeline restore 共享 workspace prestate binding、生命周期锁、Git/copy 不可变目标、安全 checkpoint、hash-chained CAS journal 和 transaction-fenced settlement。`cc checkpoint recovery list|show|abort|resume|rollback|release` 只允许 live owner 或已验证 owner absence 加 exact seq/head fence 后的 eligible 动作；`resume` 仅结算已完成状态，`rollback` 仅反转已验证的部分文件变更。
- **边界**：checkpoint recovery 不是通用多资源原子事务、断电证明或 checkpoint GA。网络、数据库、消息、部署、支付等外部副作用仍需各自幂等键、事务日志与结果核验。

## 已落地能力

### 1. 命令分发

- 命令注册以 `packages/cli/src/command-manifest.json` 为索引。
- 启动阶段只解析当前命令需要的模块，lazy dispatch 会保留 `--help`、命令过滤和别名行为。
- Windows 下 hook 输出清理、命令参数处理和 Node.js 22 JSON import 语法已完成兼容性修复。
- 当前顶层命令数保持 **175**，本轮主要是分发稳定性和启动路径修复，没有扩大命令面。

### 2. 后台 Agent 与交互 attach

- `cc agent --bg` 启动独立 worker，并持久化状态、心跳、日志与 phase。
- `cc attach <id>` 在本地控制通道可用时支持发送 follow-up prompt、停止和查看状态；不可用时退化为日志跟随。
- 提问、审批和副作用确认写入 durable interaction journal，并绑定会话、回合、请求与操作指纹；重连或恢复后继续等待原问题，不会被错误降级为普通 idle 或重复执行。
- 控制通道优先使用本机 IPC；TCP 传输用于跨平台或 IPC 不可用的场景，仍需本地会话凭据握手。
- supervisor 对自杀 PID、死 PID 和孤儿 worker 有保护，停止操作不会误杀当前 CLI 或被 PID 复用的进程树。
- IDE 发起的隔离任务可由后台 Agent 持有 worktree，并持久化 owner/session、权限模式、资源预算、生命周期与有界副作用计数。
- team/batch 协作单元也持久化同一组有界治理字段，但不保存 prompt、argv、工具参数、输出或凭据；IDE 可以把它们显示为 managed collaboration record，却不能借此授予后台 attach/stop 等进程控制能力。

### 3. 执行安全

- `process-execution-broker` 统一前台、后台、IPC、hook、MCP、monitor、LSP、PTY 与插件 bin 的进程执行入口，跨平台 sandbox 与 credential agent 默认接入。
- 带策略的插件 bin 在 async/background 启动中继续携带钉住的执行身份；通用后台任务、CLI PTY 与桌面项目 PTY 进入同一套失败闭合的 Linux 文件系统/网络边界，不再存在“直接执行已隔离、后台或 PTY 旁路”的分叉。
- 声明 `capabilities: [shell-exec]` 的技能不会直接获得 Node.js `child_process`。宿主通过 `createSkillProcessBroker()` 注入窄化且冻结的 `run`、`runSync`、`runFileSync` facade；没有声明该能力的技能得到 `null`。
- 执行来源由宿主写入并覆盖 handler 传入值：`origin=skill:<id>`、`scope=skill`、`policy=allow`，以及可用的插件 id/version/source。技能不能伪造来源或绕开统一审计。
- CLI-Anything 生成 handler 会把输入解析为字面 argv，经 `runFileSync(..., shell:false)` 执行；危险 shell 字符、未闭合引号和缺失 Broker 都会拒绝执行。
- CLI 指令技能包的 direct/hybrid handler 经 `processBroker.runSync` 调用 `chainlesschain`，先校验域内命令白名单与 shell 元字符。Windows `.cmd` shim 仍可显式请求 `shell:true`，但执行、来源和生命周期继续由宿主 Broker 管理。
- 凭据代理向子进程提供受控占位符，避免把长效凭据直接暴露给 agent 工具链。
- 非秘密运行标识使用显式 allowlist：`CC_SESSION_ID`、`CLAUDE_CODE_SESSION_ID` 可以跨 broker 边界；未知 `*_SESSION` 与凭据型变量仍默认过滤。这样既不破坏会话关联，也不放宽通用环境透传。
- 插件 manifest 可以声明所需 sandbox 边界；未声明、策略不允许、宿主能力不足或证明不匹配时，hook、MCP、LSP、monitor、PTY、Python 发现、`run_code`、bang command 与后台任务均失败闭合。
- Linux 原生插件执行只接受当前架构、显式非可执行栈的受支持静态 ELF；解析、探测与启动绑定同一插件树/文件描述符，并在固定 bubblewrap 文件系统与网络策略内执行。每个实际 bind source 必须证明 private mount propagation，无法证明时保持失败闭合；父进程持有的 pinned descriptor 在 spawn 后关闭。动态 loader、畸形 segment、复制/重放/过期 contract 或可变宿主路径都会在启动前被拒绝。
- Windows AppContainer 路径保留 resolver 发出的目标句柄、受信环境与策略摘要，跨 probe、spawn、IPC 和 detached 边界复核目标及插件身份；未继承需要的句柄或摘要不一致时拒绝降级执行。
- 桌面项目根只在本机来源、owner 与路径证明通过后获得 PTY authority；历史未证明根进入 quarantine，远端 init/sync metadata 和外部 cache 都不能写入或提升本机执行根。

### 4. 路径与会话隔离

- `getHomeDir()` 的默认值为 `~/.chainlesschain`。
- `CHAINLESSCHAIN_HOME` 是完整运行目录覆盖值，而不是用户 home 的父目录；设置为 `/tmp/cc-run` 时，会话位于 `/tmp/cc-run/sessions/`，不会写入 `/tmp/cc-run/.chainlesschain/sessions/`。
- 配置、状态、服务、日志、缓存和 JSONL 会话共享这条目录契约。单元、集成和 E2E 夹具必须设置独立的 `CHAINLESSCHAIN_HOME`，不得写入开发者真实 home。
- `cc session export` 默认经过 secret scan/redaction；`--no-redact` 是显式可信备份开关。

### 5. Process Broker 受控 checkpoint 与回滚（P2-14）

- Process Broker 在接受受控 workspace writer 执行前建立持久 workspace transaction，记录声明范围内的文件内容、mode 与毫秒级 mtime；执行成功后提交，失败、取消或超时后按 fenced authority 回滚。
- crash recovery 只有在 owner/lock 精确匹配、相关 execution 全部 settled 且具备可信 process-tree proof 时才自动回滚；证据不足时返回 `recovery_required`，不会把不确定状态伪装成恢复成功。
- coverage 分为 `full`、`partial` 与 `none`。`full` 还要求受控 writer 完整接线和 `writerIsolation=exclusive-workspace`；部分入口、并发未知 writer 或外部副作用只能报告较弱 coverage。
- 完成口径只覆盖 Process Broker 管理且位于声明 workspace 范围内的 writer，不表示捕获宿主机上的全部文件写入。网络、数据库、消息、部署、支付以及其它外部副作用不在回滚承诺内。
- workspace root 的 canonical path、device/inode identity、state binding 与可信父目录共同参与恢复校验。Node.js 不提供 `openat` / handle-relative authority，无法声称消除完整 ABA；Windows native spawn 仍存在检查到创建之间的有限 TOCTOU，相关路径保持失败闭合或降级为显式恢复。
- 当前源码进一步把 direct/timeline restore 统一进持久 saga：原始 checkpoint 与自动建立的 full-safety checkpoint、选定 Git/copy engine、目标 identity、workspace prestate、owner digest、seq/head hash 均进入可验证 projection。
- 恢复 CLI 先用 `recovery show` 取得 live mutation fence；`abort|resume|rollback|release` 都要求 `--yes` 和匹配的 `--expected-seq`、`--expected-head-hash`，存在 retained live owner 时还要求 `--expected-owner-digest`。任何 stale projection 或 eligibility 变化都会拒绝执行。

### 6. 大规模 Agent Teams（P2-16）

- TeamRunner 使用 indexed scheduler、依赖 bookkeeping、有界 mailbox/backpressure 与 per-task tightened contract；单进程内已验证 10,000 task / 64 个异步 worker 的调度规模。
- 本地状态以 schema v6 为当前 authority；v5 只允许由 `team run --resume` 执行一次 CLI-owned 迁移，v2-v4 被拒。分布式协作使用独立 queue schema v1，不能把两类状态文件混写或由 IDE 直接修改。
- 分布式 queue 以 state/queue authority digest、lease、compare-and-swap 与完成发布尾部 fencing 协调多个进程。它依赖共享且可信的本地文件系统，不是带复制、共识或网络分区容错的分布式数据库。
- `TeamBudget` 同时限制 `maxTasks`、`maxTokens`、`maxUsd` 与 `maxWallMs`。启用 token/USD cap 时，usage 缺失或远端模型无法定价会失败闭合；恢复只允许收紧 cap，不能抹去已经消费的预算。
- 本地 active wall time 不计算进程停机时间；分布式全局 wall 从第一次 acquire 开始并包含 worker 停机时间。executor 返回、checkpoint、commit 和完成发布尾部都会重新 fencing，超限后的迟到结果不能发布为成功。
- worktree 按任务隔离并执行 prepare → persist → remove → persist 两阶段清理。崩溃后的不确定外部副作用进入交互式 adjudication；只有 dry-run、明确 `retrySafe` 或具有可接受 committed evidence 的任务才能按相应路径安全恢复。
- TeamRunner 库保留有界 mailbox，但公共 CLI 当前没有 `cc team send`，分布式 queue 也没有 teammate 消息命令，不能把内部消息接口宣传成公共命令契约。
- Agent Team checkpoint authority 当前为 `coverageTarget=partial`、`writerIsolation=unknown`、`externalSideEffects=true`。三平台长期 soak 使用 2 个真实 OS worker 验证跨进程 DAG、故障与恢复；它与单进程 64-worker 规模测试是两项不同证据。

### 7. Hooks 与进程生命周期

- `Setup` 在命令执行前触发，可注入受控环境变量。
- `Notification` 支持把会话状态转发到配置的通知适配器。
- hooks 输出会经过统一清理；异常输出不会破坏命令 dispatch 或污染后续会话。
- 未注册 hooks 时保持兼容路径，默认不改变既有输出。
- 异步 hooks 受并发上限、去重和单 hook timeout 约束。停止或超时时必须回收 shell 与真实命令形成的整棵进程树，不能只杀 shell 留下孤儿任务。
- POSIX 通过独立进程组和负 PID 信号回收；Windows 优先 `taskkill /T /F`。为处理策略限制下 `taskkill` 非零退出，supervisor 会在终止前一次性读取进程表、构造目标后代树，并按叶子优先顺序兜底终止。
- raw PTY master 在 close、error 或 native failure 后立即失效并清空排队写入，阻止 FD reuse 把旧会话数据写进新进程；attached session 停止时回收完整 POSIX process group 或 Windows process tree。
- Hooks v2 在 headless、stream、REPL 与 WebSocket 回合中把 canonical host root 绑定为 generation-aware opaque durable identity，旧 generation、跨宿主或未证明 binding 不能恢复本机 authority。
- hook 子进程已完成时，Node 晚到的 stdin `EPIPE` 被解释为 transport 收尾：status 0 输出和 status 2 block 协议继续保留；缺失 exit status 或其它 spawn error 仍失败闭合。
- 默认 Hooks runtime 通过显式 event sink 注册到 Broker，不再反向同步加载第二份 ESM 模块图；首次执行后只保留一个 CredentialTransport worker/listener，重复后台执行相对预热基线保持稳态 FD 零增长。
- WMIC 不存在时才使用 PowerShell/CIM，避免在权限拒绝场景重复做高延迟探测。受管沙箱同时禁止进程枚举与树终止时，真实树测试按能力跳过，解析和 fallback 行为由可注入单元测试覆盖。

### 8. 插件生命周期、归因与 IDE 运行时

- `cc plugin` 的安装、分 scope 启停、source-aware 升级、回滚和 live-session reload 由 CLI runtime 持有；IDE 只呈现命令结果，不自行绕过组织策略。
- 插件升级先进入 staging，重新校验 manifest 与签名 SBOM，再原子激活。复制、load check、post-install 或 capability widening 被拒时恢复旧 active version；强制重装同版本也保留并恢复原字节。CLI 对外只返回受控的 `activated / rolled_back / unchanged` 结果。
- 插件管理面显示签名、SBOM、来源、托管策略及 registry/Git/local 元数据的脱敏摘要。来源字符串不会作为 shell 命令执行，工作区目录也不会参与可执行文件探测。
- compact transcript 与 `cc session usage` 可按插件 id/version 归因 plugin-bin 和插件提供的 MCP 调用，并记录有界工具耗时、同轮观测重试与脱敏的流式 LLM retry 原因/实际 provider/model；不持久化工具参数、输出或凭据。
- VS Code 与 JetBrains 通过 `cc-ide-quality/v1` 提供有界的测试、覆盖率和调试器快照，并携带 Context v2 freshness 元数据；Notebook 执行使用真实 notebook 上下文。
- IDE `0.37.42` / `0.4.79` 只在插件升级结果为 `activated` 后重载 live session；capability widening 必须先展示新增能力并由用户显式批准，`rolled_back` 或不可读结果保持失败闭合。
- 两个 IDE 只读观察本地 Agent Team schema v6 与分布式 queue schema v1。takeover、managed checkpoint recovery 和 side-effect adjudication 必须携带精确 authority digest、lease/evidence fence，并通过解析出的 CLI 执行；文件监听与刷新只更新投影，不能绕开 CLI-owned compare-and-swap authority。
- IDE 还把 CLI-owned session graph 投影到 Sessions Workbench，并提供受 projection revision 约束的 resume/attach、可恢复 GitHub/Gitee/remote/manual delivery，以及绑定 session/workspace/repository/checkpoint/manifest digest 的 rewind/branch timeline。过期按钮与 projection 必须失败闭合。
- Open VSX 当前公开 `0.37.42`，JetBrains Marketplace 当前公开且审核通过 `0.4.79`。VS Code 的内联聊天、Sessions Workbench、可恢复交付、canonical rewind 和首次标签页 activation 重试已进入公开版；JetBrains 同步公开会话、交付和 rewind 能力。Microsoft VS Code Marketplace 仍未发布。
- Installation Doctor 同时报告 Node/Java、managed CLI 和插件 registry 的离线恢复状态；恢复建议不把不可信工作区加入命令搜索路径。

### 9. Auto mode 安全分类与标准 OTLP 出口

- Auto mode 安全分类器使用版本化、不可变的离线评测语料识别 workspace 越界、秘密外传、生产部署、force push、未审合并和未隔离第三方 Agent 等危险意图。评测器不执行语料命令，也不在报告中回显原始参数。
- 分类结果只是一道附加风险信号，不能降低 shell hard deny、managed deny、credential guard、Process Broker 或 OS sandbox 的既有结论；尚未进入统一 preflight 的 Git、MCP、Hook、第三方工具与 Agent Team 路径不能被宣传为已受分类器全面保护。
- OTLP exporter 支持 traces/metrics 的 OTLP/HTTP JSON、OTLP/HTTP protobuf 与 OTLP/gRPC，读取标准全局及 per-signal endpoint、protocol、header、timeout、compression、service/resource 配置，并支持自定义 CA 与 mTLS。
- exporter 使用有界 batching、queue-pressure 计数、`Retry-After` / 指数重试、永久失败与 drop 指标、原子 crash spool 和退出前 final flush。prompt、response 与工具参数默认不出站，所有字符串属性和事件继续经过秘密脱敏。

## 关键入口

| 领域            | 实现                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 命令分发        | `packages/cli/src/lazy-dispatch.js`、`command-manifest.json`                                                                                     |
| 后台监督        | `packages/cli/src/lib/background-agent-supervisor.js`                                                                                            |
| 交互协议        | `packages/cli/src/lib/ipc-attach-protocol.js`、`background-session-transport.js`                                                                 |
| 执行安全        | `packages/cli/src/lib/process-execution-broker/`                                                                                                 |
| 受控事务与回滚  | `packages/cli/src/lib/process-execution-broker/workspace-transaction.js`、`commands/checkpoint-managed.js`                                       |
| Restore saga    | `packages/cli/src/lib/checkpoint-restore-saga.js`、`checkpoint-restore-recovery*.js`、`commands/checkpoint-restore-recovery.js`                 |
| 会话与资源预算  | `packages/cli/src/lib/session-*.js`、`session-resource-budget.js`、`session-host-runtime.js`                                                      |
| MCP 恢复        | `packages/cli/src/lib/mcp-call-recovery*.js`、`harness/mcp-client.js`                                                                            |
| Agent Team      | `packages/cli/src/lib/agent-team/`、`commands/team.js`、`commands/team-distributed.js`                                                           |
| Auto 安全分类   | `packages/cli/src/lib/auto-mode-safety-classifier.js`、`lib/auto-mode-safety-eval.js`、`commands/auto-mode.js`                                   |
| OTLP 出口       | `packages/cli/src/lib/otlp-exporter.js`、`lib/observability/otlp-exporter.js`                                                                    |
| 插件沙箱策略    | `packages/cli/src/lib/plugin-runtime/sandbox-policy.js`                                                                                          |
| 插件生命周期    | `packages/cli/src/lib/plugin-runtime/install.js`、`commands/plugin.js`                                                                           |
| 插件用量归因    | `packages/cli/src/lib/plugin-usage-attribution.js`、`lib/session-usage.js`                                                                       |
| 技能进程 facade | `packages/cli/src/lib/skill-process-broker.js`                                                                                                   |
| 技能生成入口    | `packages/cli/src/lib/cli-anything-bridge.js`、`lib/skill-packs/generator.js`                                                                    |
| 技能注入入口    | `packages/cli/src/commands/skill.js`、`runtime/agent-core.js`                                                                                    |
| 路径契约        | `packages/cli/src/lib/paths.js`、`harness/jsonl-session-store.js`                                                                                |
| 异步 hook 回收  | `packages/cli/src/lib/async-hook-supervisor.cjs`                                                                                                 |
| hooks           | `packages/cli/src/lib/session-hooks.js`、`hook-manager.js`                                                                                       |
| IDE 运行时接线  | `packages/vscode-extension/src/runtime-environment.js`、`packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/RuntimeEnvironment.java` |

## 验证口径

发布前应分别执行三个层级，不能只用默认 `npm test` 代替：

```bash
cd packages/cli
npm run test:unit
npm run test:integration
npm run test:e2e
```

`0.162.197` 的精确正式发布提交为 [`a03ad1b548cc6f15c9bef8f82d519e9c625eef8d`](https://github.com/chainlesschain/chainlesschain/commit/a03ad1b548cc6f15c9bef8f82d519e9c625eef8d)。该提交的 [CLI CI run 30979565407](https://github.com/chainlesschain/chainlesschain/actions/runs/30979565407)、[CLI Strict Sandbox run 30979565251](https://github.com/chainlesschain/chainlesschain/actions/runs/30979565251) 与 [npm publish run 30979565206](https://github.com/chainlesschain/chainlesschain/actions/runs/30979565206) 均成功；CLI CI 含 Ubuntu、Windows、macOS 的 unit/integration/E2E 分片、打包与全局安装验证，Strict Sandbox 三平台全绿，发布 workflow 的 `exact-sha-gate`、immutable package、SBOM 与 provenance 全绿。

发布后的 [CLI npm release readback](https://github.com/chainlesschain/chainlesschain/actions/runs/30983536627) 又从 registry 回读 `0.162.197`，核对不可变 artifact bytes、签名 provenance 与授权 workflow identity。`0.162.193` 的历史非权威记录仍保留，不移动或伪造 tag；`0.162.194`、`0.162.195`、`0.162.196` 的失败 tag 也保持不可变。后续版本仍必须在各自 final exact SHA 上重新完成全部权威门，本地测试只作补充。

平台专项还应覆盖 Linux bubblewrap 的 fd 绑定、private mount topology、静态 ELF/架构/segment/栈校验、通用后台/PTY 强边界与网络隔离，以及 Windows `.cmd` 启动、AppContainer 目标句柄/策略摘要、后台 attach、停止自 PID 记录、hook 输出清理和进程树能力探测。P2-14 专项必须区分 `full` / `partial` / `none`，验证 crash recovery 在证据不足时进入 `recovery_required`；P2-16 专项必须分别覆盖单进程规模测试、真实跨进程短门和三平台长期 soak。Hooks 专项需覆盖 stdin `EPIPE` 的 status 0/2 协议、单一 CredentialTransport listener 与 teardown 后 FD 零增长。TCP attach 需要运行对应的 IPC/transport 回归测试。真实系统能力不可用时，测试必须明确跳过并由注入测试补齐，不得把权限拒绝伪装成功。
