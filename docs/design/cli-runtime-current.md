# CLI Runtime 当前实现核对（0.162.185）

> 更新时间：2026-07-29。本文只记录已经进入当前代码并完成发布门验证的运行时能力；路线图与实验性设计仍以各自的计划文档为准。

## 当前边界

CLI 运行时由四个相互协作的层组成：命令分发、会话生命周期、工具执行安全和 hooks 事件总线。

```text
cc entry
  ├─ command manifest + lazy dispatch
  ├─ foreground / background agent runtime
  │    └─ local attach transport (NDJSON / TCP fallback)
  ├─ process-execution-broker
  │    ├─ platform sandbox + native execution attestation
  │    └─ credential agent
  ├─ plugin runtime
  │    ├─ manifest capability + sandbox policy
  │    ├─ hooks / MCP / LSP / monitors / native bins
  │    └─ lifecycle + signature / SBOM / source provenance
  ├─ skill-process-broker
  │    └─ host-owned facade → process-execution-broker
  ├─ durable event + interaction journal
  ├─ bounded usage + retry attribution
  └─ session hooks (Setup / Notification / lifecycle)
```

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

### 5. Hooks 与进程生命周期

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

### 6. 插件生命周期、归因与 IDE 运行时

- `cc plugin` 的安装、分 scope 启停、source-aware 升级、回滚和 live-session reload 由 CLI runtime 持有；IDE 只呈现命令结果，不自行绕过组织策略。
- 插件升级先进入 staging，重新校验 manifest 与签名 SBOM，再原子激活。复制、load check、post-install 或 capability widening 被拒时恢复旧 active version；强制重装同版本也保留并恢复原字节。CLI 对外只返回受控的 `activated / rolled_back / unchanged` 结果。
- 插件管理面显示签名、SBOM、来源、托管策略及 registry/Git/local 元数据的脱敏摘要。来源字符串不会作为 shell 命令执行，工作区目录也不会参与可执行文件探测。
- compact transcript 与 `cc session usage` 可按插件 id/version 归因 plugin-bin 和插件提供的 MCP 调用，并记录有界工具耗时、同轮观测重试与脱敏的流式 LLM retry 原因/实际 provider/model；不持久化工具参数、输出或凭据。
- VS Code 与 JetBrains 通过 `cc-ide-quality/v1` 提供有界的测试、覆盖率和调试器快照，并携带 Context v2 freshness 元数据；Notebook 执行使用真实 notebook 上下文。
- VS Code `0.37.36` 与 JetBrains `0.4.75` 只在插件升级结果为 `activated` 后重载 live session；capability widening 必须先展示新增能力并由用户显式批准，`rolled_back` 或不可读结果保持失败闭合。
- Installation Doctor 同时报告 Node/Java、managed CLI 和插件 registry 的离线恢复状态；恢复建议不把不可信工作区加入命令搜索路径。

## 关键入口

| 领域            | 实现                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 命令分发        | `packages/cli/src/lazy-dispatch.js`、`command-manifest.json`                                                                                     |
| 后台监督        | `packages/cli/src/lib/background-agent-supervisor.js`                                                                                            |
| 交互协议        | `packages/cli/src/lib/ipc-attach-protocol.js`、`background-session-transport.js`                                                                 |
| 执行安全        | `packages/cli/src/lib/process-execution-broker/`                                                                                                 |
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

`0.162.185` 的精确发布提交为 `d7d378d3e14825d316f28a3ee62a8ab8da40c452`。该提交的 [CLI CI run 30402651323](https://github.com/chainlesschain/chainlesschain/actions/runs/30402651323)、[CLI Strict Sandbox run 30402651097](https://github.com/chainlesschain/chainlesschain/actions/runs/30402651097) 与 [npm publish run 30404265474](https://github.com/chainlesschain/chainlesschain/actions/runs/30404265474) 均已成功；Code Quality & Security、Full Test Automation、E2E、Project Management E2E 与 CI Tests 也在同一 `head_sha` 成功。Linux、Windows、macOS 的发布矩阵必须来自精确提交；本地测试只作补充，不能替代发布门。

平台专项还应覆盖 Linux bubblewrap 的 fd 绑定、private mount topology、静态 ELF/架构/segment/栈校验、通用后台/PTY 强边界与网络隔离，以及 Windows `.cmd` 启动、AppContainer 目标句柄/策略摘要、后台 attach、停止自 PID 记录、hook 输出清理和进程树能力探测。Hooks 专项需覆盖 stdin `EPIPE` 的 status 0/2 协议、单一 CredentialTransport listener 与 teardown 后 FD 零增长。TCP attach 需要运行对应的 IPC/transport 回归测试。真实系统能力不可用时，测试必须明确跳过并由注入测试补齐，不得把权限拒绝伪装成功。
