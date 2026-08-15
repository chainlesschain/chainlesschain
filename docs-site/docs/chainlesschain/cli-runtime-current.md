# CLI Runtime 当前实现（0.163.8）

> 更新时间：2026-08-14。npm `latest`、生产推荐版与主线包元数据均为 `0.163.8`。稳定能力以不可变 tag `v-npm-0-163-8` 的精确 SHA [`a0631cb4f9`](https://github.com/chainlesschain/chainlesschain/commit/a0631cb4f97f45ff7fcef9c19d346ed2b8387da6) 为准。`main@affafa7f0f` 的原生剪贴板图片粘贴晚于该不可变 tarball，本文会明确区分源码能力与稳定安装契约。

## 概述

本文是当前 CLI 运行时的实现快照，适合部署、排障和集成方阅读。设计取舍详见[运行时设计核对](/design/cli-runtime-current)。

## 安装版本怎么选

| 用途                | 版本      | 说明                                                                                                                |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| 生产 / 日常稳定使用 | `0.163.8` | `v-npm-0-163-8` 的同一 exact SHA 已完成 Linux、Windows、macOS CLI CI、Strict Sandbox、制品与发布门 |
| npm `latest`        | `0.163.8` | registry、tag、provenance、tarball 与授权 workflow 已交叉回读                                      |
| IDE 工作台          | CLI `0.163.8` + VS Code `0.37.51` / JetBrains `0.4.87` | Automation Center + 默认关闭的受治理自动 ghost-text |
| Runtime / Agent Team | `0.163.8` | scheduler 恢复、`team merge-review` 与 MCP resource templates 已发布 |
| 原生剪贴板图片      | `main@affafa7f0f` | `/paste-image` 仅供源码验证；不属于 `0.163.8` tarball |

生产安装建议显式固定：

```bash
npm i -g chainlesschain@0.163.8
```

已安装 `0.163.8` 的用户就是当前生产推荐版。`0.163.7` 是上一完整门禁基线；旧的失败 tag 保持不可变，不移动或复用。

## 核心特性

- `cc agent --bg`：后台启动长任务，返回可持久化的会话 ID。
- `cc attach <id>`：通过本机控制通道继续提问、停止或查看后台 Agent；通道不可用时自动改为日志跟随。
- `cc logs <id>`、`cc daemon status|view|resume|stop`：查看和管理后台会话。
- 后台提问、审批与副作用确认：重连后继续等待原问题，并按会话/回合/操作指纹校验，避免重复执行。
- `Setup` / `Notification` hooks：在命令开始前注入环境并发送会话通知。
- 安全配置写入：schema secret 必须经 `cc config set-secret` 的隐藏输入与 OS store/owner-only fallback，普通 `config set` 会拒绝敏感字段；显式 `workspace-write` / `strict` sandbox 在不可用时失败闭合。
- MCP `ws/wss`、可信动态 header、timeout notification 与不确定结果恢复：REPL、stream、Cowork/host、WebSocket 使用共享 recovery authority，结果不明确时要求核验或裁决，不盲目 replay。
- Canonical session 与持久预算：REPL、stream、WebSocket、headless 使用可验证 transcript projection 与事务化 summary/compaction；后台/Team adapter 使用 fenced token、USD 与 wall-clock 预算。
- Agent 工作流：plan/todo revision 与 authority ceiling、受控 Skill 子 Agent、后台 launch profile、semantic handoff、`/btw` 临时旁路、manifest-driven help 与 shell completion 已进入当前源码。
- `0.162.200` 会话与 MCP 权威：session host lease、anti-rollback witness、持久化失败分类与有界 cleanup 已公开；npm-backed MCP 固定精确版本和完整传递依赖闭包，物化为内容寻址的受守护 capsule；POSIX/Windows installer/OTA generation recovery 已进入稳定版。
- `0.163.0` 安装与原生宿主：macOS postinstall 窄范围修复并验证 `node-pty` helper 执行位且拒绝 symlink；Linux、Windows、macOS x64/ARM64 六个目标改由匹配架构 runner 执行验证；命令生命周期进入第二个观察周期，25 个兼容 alias 继续保留。
- `0.163.1` 可靠性与打包：live session tail 在 transcript 路径检查与异步 `stat` / `open` 之间遇到删除或恢复时，改由 durable session witness 重新分类并失败闭合；长会话摘要和 compacted tool record 改为有界折叠；Windows 严格沙箱在挂起创建到恢复前持有并复核 MCP runtime/entry identity；矩阵覆盖 EROFS/ENOSPC、原生 TTY、多语言键盘、Unicode 剪贴板、SSH 断线、超大 MCP 输出、并发 Agent与两小时资源核算。CLI pack 还从干净、lockfile 驱动的 Web Panel 依赖图构建，固定 Vite/Rollup/Intlify 运行链、限制 Rollup 文件并发，并使用 Node 22 standalone 基座。上述能力已随 `v-npm-0-163-1` 公开。
- `0.163.2` MCP capsule：stdio MCP 可用 `--runtime-kind` 声明七类 runtime 语义；Linux 固定 npm/Node runtime、entry、参数以 descriptor 绑定到启动，Windows restricted-token/AppContainer plan 使用一次性内建 Broker authority，macOS 在公共 API 无法证明 atomic final-image binding 时类型化失败闭合。恶意宿主证据 v4 分别记录 Linux 路径替换、Windows strict gate 与 macOS fail-closed。
- `0.163.3` 后台隔离与 source policy：干净 Git checkout 中的非 `stream-json` `cc agent --bg` 默认从 committed `HEAD` 创建隔离 worktree；`--worktree` 显式请求同一路径，只有 `--no-worktree` 共享当前 checkout，脏工作区拒绝启动。generation/token fence、原子状态、durable turn intent 与 grammar-safe detached argv 阻止过期 worker 复活、误删 live worktree 或把 prompt 当成权限参数。`sandboxPolicy.requiredBoundaries` 与可信 `cwd` 已从 local/project/user/managed、Skill 和 Cowork 定义贯通到 Broker。
- `0.163.3` 平台封存：Linux strict plugin/native 路径逐目录 FD 遍历并拒绝 link、跨挂载、special file、hardlink 与超限树，把每个普通文件复制为 sealed snapshot；Windows helper/cache/test artifact 绑定可信非 reparse 临时根，身份不明或无法复验的残留会保留现场并使清理失败闭合。
- `0.163.4` capsule 与 scheduler store：exact-package 输入在有界 worker 的 immutable WASM VFS 中构建；scheduler SQLite store 提供 strict schema、revision CAS、logical-occurrence 去重、durable claim 与 history。
- `0.163.5` 统一调度：Routine manual/cron/once、Agenda wakeup/cron 与 Cowork Cron 已接入共享 runtime。driver 领取 owner/fence lease、持续 heartbeat，并在执行前复验 definition snapshot 与 authority；只有可核验的 terminal evidence 才能在崩溃后补结算，start-only/outcome-unknown 不自动重放。
- `0.163.5` microcompact：压缩 checkpoint 持久化并可在 REPL/Agent 恢复；瞬态 runtime marker 不进入长期状态。
- `0.163.6` 统一调度收敛：Agenda monitor、Loop、Automation cron、Routine GitHub、scope-checked channel event 与 standalone daemon 已接入共享 scheduler；Agenda/Cowork cron 支持规范 IANA timezone、DST gap/repeated minute 与 missed-run collapse。
- `0.163.6` 共享 authority：Agenda、Routine、Cowork、Automation、Loop 在执行前复验 exact capability policy revision，并以同一事务 reservation/settlement 处理 run/unit 预算；缺失、过期、停用、耗尽或不一致的策略失败闭合，retry 不重复扣减。
- `0.163.6` Automation Center：CLI-owned versioned projection 暴露 scope、preflight 与 history；VS Code `0.37.50` / JetBrains `0.4.86` 通过 exact argv 与 revision CAS 执行 run-now、失败重试、pause/resume、disable/delete 及 Routine 创建/编辑。IDE 不直接写权威存储。
- `0.163.7` scheduler adjudication：只针对 `*_OUTCOME_UNKNOWN` 的 `dead_letter`，以 evidence digest、attempt、fence 做 CAS。`confirmed_applied` 只结算不重放；`confirmed_not_applied` 只放行一次有界 claim。操作前必须停掉全部 scheduler host、排空已分发工作并核验外部结果。
- `0.163.7` migration/rollback：Agenda、Cowork Cron、Routine、Automation 与 Loop 以 schema-v5 journal 绑定 source/target digest、retirement fence 与恢复阶段；rollback 先处理 target，再经最新 evidence digest、交互 TTY 和 exact typed challenge 恢复 legacy source。
- `0.163.7` causal observability：session delivery graph 绑定精确 transcript head/event count 与 diff/gate/artifact/PR/merge revision；`call-ledger@1` 对 model、retry、compaction、subagent、isolated Skill 与 tool call 的未知 settlement 失败闭合，而不是按零计费。
- `0.163.8` 磁盘与 Automation 恢复：Agenda/Cowork 权威写入使用 private temp、完整 short-write、fsync 与 atomic rename，确定性 fault matrix 已关闭；Automation Center 另新增 exact fence/control revision/capability 约束的 checkpoint pause/resume，以及只对 scheduler-backed dead letter 安全开放的 incident retry/cancel。
- `0.163.8` merge review 与 MCP templates：`cc team merge-review preview|show|apply|rollback` 以 revision/digest 绑定 file/hunk 选择、原子发布和受控回滚；`list_mcp_resource_templates {server?}` 只读有界模板缓存，具体资源仍由 `read_mcp_resource` 读取。
- `0.163.8` scheduler soak framework：Linux/Windows/macOS workflow 已覆盖双 worker contention、higher-fence recovery、stale settlement、no-replay、heartbeat、DST、backlog、数据库完整性、后代回收和资源趋势；首次 formal run `31807830251` 因 Windows worker 提前退出而无效，Ubuntu/macOS 随后取消。后继 exact-main run `31821080101` 三平台及 aggregate 全部成功并定义新 `T0`，正式计数为 `1/4`；退出仍需其余三个 segment、至少 72 小时观察、最大段间隔 30 小时和最终 campaign verifier。
- `main@affafa7f0f` 原生剪贴板图片：交互式 Agent REPL 的 `/paste-image` 可从受控 Windows/macOS/Linux 宿主桥读取 PNG/JPEG/GIF/WebP。单图 20 MiB、每轮 4 张/40 MiB、10 秒超时；最终 merge SHA 的 host workflow、CLI CI 与 CLI Strict Sandbox 均通过，但它仍属于发布后源码能力。
- 原生发行边界：unsigned 六目标 native validation 与三系统两小时可靠性门已在同一精确 SHA 成功，但 validation 固定 `signed=false`、`releaseEligible=false`；Windows Authenticode、macOS signing/notarization、updater key 与公开原生 fresh install/upgrade/rollback 回读仍未完成。
- 跨平台 sandbox 与 credential agent：前台、后台、hook、MCP、monitor、LSP、PTY 和插件 bin 都通过统一 broker 执行。
- 强执行路径补齐：插件异步/后台进程、通用后台任务、CLI PTY 与桌面项目 PTY 共用失败闭合边界；未经证明的项目根和远端 metadata 不能获得本机 PTY 权限。
- 技能执行边界：production `skill run` 不在 CLI 主进程导入生成的 `handler.js`，也不向 Skill 注入 MCP client、Process Broker 或 `child_process`；隔离 Skill 只获得与父级 ceiling 相交后的 `read_file`、`search_files`、`list_dir`。历史 `shell-exec` metadata 与 legacy handler 不产生当前运行权限。
- 插件治理：按 scope 启停、来源感知升级/回滚、当前会话热重载，并查看签名、SBOM、来源与组织策略摘要；升级在 staging 校验后原子激活，失败时恢复旧版本。
- 用量与重试归因：`cc session usage` 可按插件/版本归因 plugin-bin 与插件 MCP 调用，并显示有界工具耗时、观测重试及脱敏 LLM retry 原因，不记录工具参数、输出或凭据。
- IDE worktree 与协作任务：VS Code / JetBrains 显示 worktree、team 与 batch 的 owner、权限模式、预算、状态和副作用计数；协作单元不会因此获得后台进程 attach/stop 权限。
- P2-14 托管 workspace 回滚：Process Broker 为声明范围内的 managed writer 建立持久 checkpoint，成功时接受，失败、取消或超时时带 fence 恢复，并显式区分 `full`、`partial` 与 `none` 覆盖。
- Checkpoint restore saga：direct/timeline restore 绑定 workspace prestate、生命周期锁、Git/copy 不可变目标、安全 checkpoint 与 hash-chained CAS journal；`cc checkpoint recovery list|show|abort|resume|rollback|release` 只对验证通过的恢复状态开放。
- P2-16 Agent Teams：`cc team run` 使用本地 schema v6 authority；`cc team queue` 使用独立 queue schema v1、fenced lease、四维预算与共享可信本地文件系统协调，恢复和不明确副作用进入显式裁决。
- `cc session export <id>`：默认扫描并脱敏会话中的 API Key、JWT、连接串等秘密；只有显式 `--no-redact` 才保留原文。
- `CHAINLESSCHAIN_HOME=<dir>`：把配置、会话、状态、日志和缓存统一隔离到指定目录，适合 CI、多项目或便携部署。

## 系统架构

```text
cc
 ├─ lazy command dispatch (manifest + help/alias)
 ├─ agent runtime (foreground / background)
 │    ├─ local attach (NDJSON/TCP)
 │    └─ canonical transcript / compaction / resource budget
 ├─ process-execution-broker
 │    ├─ platform sandbox + native attestation
 │    ├─ credential agent
 │    └─ managed workspace transaction + restore saga/recovery
 ├─ agent-team runtime
 │    ├─ local authority schema v6
 │    └─ shared-filesystem queue schema v1
 ├─ plugin runtime (policy + lifecycle + provenance)
 ├─ controlled Skill boundary
 │    └─ isolated child → read_file / search_files / list_dir only
 ├─ durable event / interaction journal
 ├─ scheduler kernel
 │    ├─ versioned SQLite + revision CAS + occurrence history
 │    ├─ Routine / Agenda / Cowork / Automation / Loop adapters
 │    ├─ exact capability policy + transactional budget authority
 │    ├─ adjudication + migration/rollback evidence CAS
 │    └─ source-only checkpoint control + incident requeue
 ├─ MCP ws/wss + uncertain-outcome recovery authority
 │    └─ stdio runtime identity + source policy/workspace authority → Broker
 ├─ bounded usage / retry attribution
 ├─ async-hook supervisor (timeout + process-tree reap)
 └─ Hooks v2 + session hooks (Setup/Notification)
```

## Scheduler 运维与发布后恢复命令

`0.163.8` 继续公开人工裁决与迁移检查。裁决前必须停掉所有 scheduler host、排空已分发工作，并在外部系统核验真实结果；不要直接编辑 SQLite/JSONL 绕过证据 CAS。

```bash
cc daemon scheduler adjudication list
cc daemon scheduler adjudication show <occurrence-id>
cc daemon scheduler adjudication decide <occurrence-id> \
  --decision confirmed_applied \
  --expected-evidence-digest sha256:<digest> \
  --expected-attempt <attempt> \
  --expected-fence <fence>

cc daemon scheduler migration list
cc daemon scheduler migration show <migration-id>
cc daemon scheduler migration rollback <migration-id> \
  --expected-evidence-digest sha256:<digest>
```

`0.163.8` 的 Automation Center 会在 `center-projection` 中给出 exact argv。以下 mutation 必须使用刚读取到的 fence/revision；投影过期就重新读取，不要猜值：

```bash
cc automation center-projection --json
cc automation center-runtime-action <occurrence-id> pause \
  --expected-fence <fence> --expected-control-revision <revision> --json
cc automation center-runtime-action <occurrence-id> resume \
  --expected-fence <fence> --expected-control-revision <revision> --json
cc automation center-incident-action <incident-id> retry \
  --expected-revision <revision> --json
cc automation center-incident-action <incident-id> cancel \
  --expected-revision <revision> --json
```

pause 是合作式 checkpoint 控制，不是强杀；manual incident 不提供 retry，因为无法证明外部副作用未发生。上述 runtime/incident 命令已经进入 `0.163.8`，仍必须按投影给出的 exact fence/revision 操作。

## 受治理的多 Agent 合并审查

`0.163.8` 不要求直接合并 Agent 生成的完整 branch。先预览候选分支，读取输出中的 review id、revision、plan digest 以及稳定的 file/hunk id，再只发布审核通过的选择：

```bash
cc team merge-review preview \
  --branch agent/api --branch agent/tests --json

cc team merge-review show <review-id> --json

cc team merge-review apply <review-id> \
  --revision <next-revision> \
  --plan-digest sha256:<plan-digest> \
  --file-id <file-id> \
  --hunk-id <hunk-id> \
  --actor local-operator \
  --reason "reviewed API and tests" \
  --json
```

`show` 会给出当前状态下可执行的 exact argv。发生冲突、base/branch 漂移或发布后需要撤销时，重新 `show`，再按输出的 revision/evidence digest 与完整 review id 执行受控回滚：

```bash
cc team merge-review rollback <review-id> \
  --revision <next-revision> \
  --evidence-digest sha256:<evidence-digest> \
  --confirm <review-id> \
  --json
```

状态默认保存在 `CHAINLESSCHAIN_HOME/team-merge-reviews`。自定义 `--state-dir` 必须位于 Agent 可写仓库之外并由当前用户私有；不要把 revision/digest 当签名，也不要绕过 Git 冲突或外部副作用核验。

## MCP resource templates

连接的 MCP server 只暴露参数化资源模板时，Agent 可以先调用：

```text
list_mcp_resource_templates {}
list_mcp_resource_templates {"server":"docs"}
```

返回值来自连接阶段的有界 discovery cache。模型或用户选择参数并形成具体 URI 后，再调用 `read_mcp_resource`；CLI 不会自动枚举模板参数、订阅资源或因为列模板而发起额外网络请求。resource subscriptions、peer-controlled logging、completion 与 MCP sampling 仍不在该稳定契约中。

## 发布后源码：从系统剪贴板附图

`main@affafa7f0f` 的交互式 Agent REPL 支持以下流程，但 npm `0.163.8` 用户需要等待后续版本发布：

1. 在截图工具、浏览器或图片应用中复制图片。
2. 在 Agent REPL 输入 `/paste-image`；看到 `Image attached from clipboard` 后继续输入问题。
3. 提交 prompt；排队的图片只进入这一轮视觉模型请求，发送后清空。

支持 PNG、JPEG、GIF 与 WebP。每张最多 20 MiB，每轮最多 4 张且总计不超过 40 MiB，读取超时 10 秒。Windows 使用系统 PowerShell；macOS 使用系统 `osascript`；Linux 需要有效 Wayland/X11 display，并安装 `wl-paste`（Wayland）或 `xclip`（X11）。剪贴板为空、类型不支持、magic bytes 不匹配、宿主工具缺失或超过上限时会明确失败，不会把错误内容发送给模型。

最终 merge SHA `affafa7f0f6fede3274e503d2387ce493e74bfd0` 的专用三平台 host workflow `31813967006`、CLI CI `31810849262` 与 CLI Strict Sandbox `31810848956` 均成功。这证明当前主线源码边界，不改变 npm `0.163.8` tarball 内容；后续稳定版仍须在自己的最终 exact SHA 完成发布与公网回读。

## 关键文件

主要入口位于：

- `packages/cli/src/cli.js`：启动与注册。
- `packages/cli/src/lazy-dispatch.js`：命令延迟分发。
- `packages/cli/src/lib/background-agent-supervisor.js`：后台会话监督。
- `packages/cli/src/lib/session-host-runtime.js`、`session-resource-budget.js`：canonical host 与持久资源预算。
- `packages/cli/src/lib/process-execution-broker/`：子进程安全执行。
- `packages/cli/src/lib/checkpoint-restore-saga.js`、`checkpoint-restore-recovery*.js`：持久 restore saga、投影与恢复控制器。
- `packages/cli/src/commands/checkpoint-restore-recovery.js`：保守的 `cc checkpoint recovery` 命令面。
- `packages/cli/src/lib/mcp-call-recovery*.js`：MCP 不确定结果记录、核验与裁决。
- `packages/cli/src/lib/mcp-sandbox-policy.js`、`mcp-stdio-workspace-authority.js`：MCP source policy 规范化、可信 cwd 与 workspace authority。
- `packages/cli/src/lib/agent-team/`、`packages/cli/src/commands/team.js`：Agent Team、本地 authority、分布式 queue 与人工裁决。
- `packages/cli/src/commands/team-merge-review.js`、`lib/agent-team/team-merge-review*.js`：`0.163.8` 的 file/hunk 审查、持久证据、原子发布与受控回滚。
- `packages/cli/src/lib/plugin-runtime/`：插件安装、scope、来源与 sandbox 策略。
- `packages/cli/src/lib/plugin-usage-attribution.js`：插件调用归因。
- `packages/cli/src/lib/skill-execution-authority.js`、`skill-execution-identity.js`：Skill 执行权威、外部 owner-private 状态与身份校验。
- `packages/cli/src/lib/session-host-lease.js`、`session-anti-rollback-anchor.js`：发布后源码中的单宿主租约与会话 anti-rollback witness。
- `packages/cli/src/lib/mcp-stdio-executable-identity.js`、`mcp-stdio-package-materialization.js`：MCP 可执行信任代际与 npm 依赖闭包物化。
- `packages/cli/src/lib/async-hook-supervisor.cjs`：异步 hook 并发、超时与进程树回收。
- `packages/cli/src/lib/paths.js`：`CHAINLESSCHAIN_HOME` 与运行目录解析。
- `packages/cli/src/lib/session-hooks.js`：通知与会话钩子。
- `packages/cli/src/lib/scheduler-kernel/{contract,store,runtime}.js`：统一调度契约、SQLite 状态与 host-owned runtime。
- `packages/cli/src/lib/scheduler-kernel/{routine,agenda,cowork-cron,automation,loop,automation-event}-adapter.js`：`0.163.6` 已发布 adapter，`0.163.7` 已发布迁移/裁决接线。
- `packages/cli/src/lib/scheduler-kernel/authority-resolver.js`、`service.js`：共享权限/预算解析与常驻 scheduler service。
- `packages/cli/src/commands/scheduler-daemon.js`、scheduler store migration/adjudication tables：`0.163.7` 的 typed challenge、证据 CAS、单调裁决与受治理 rollback。
- `packages/cli/src/lib/automation-center-runtime.js`、`automation-center-incidents.js`：`0.163.8` 的脱敏 runtime/incident 投影、exact argv 与 fenced mutation。
- `packages/cli/src/repl/clipboard-image.js`、`prompt-interactions.js`：发布后 `/paste-image` 宿主探测、图片校验、队列上限与 vision content 合并。
- `packages/cli/scripts/scheduler-kernel-soak*.mjs`、`.github/workflows/cli-scheduler-soak*.yml`：三平台 formal segment 与 72 小时 campaign verifier。

## 平台注意

- Linux 严格原生插件路径只接受受支持的当前架构静态 ELF，并把解析、探测和启动绑定到同一插件树/文件描述符；动态 loader、可执行栈、畸形 segment、复制或过期 contract 会在启动前拒绝。
- Linux 上每个实际 bind source 都必须证明 private mount propagation；证明不足时拒绝启动。父进程 pinned descriptor 在 spawn 后关闭，避免 authority 泄漏。
- Windows AppContainer 路径绑定目标句柄、受信环境与策略摘要；跨 probe、spawn、IPC 和 detached 启动边界都会复核目标及插件身份。
- Windows 上 `.cmd` 启动、hook 输出清理、后台 attach 路径已修复。
- Windows 异步 hook 优先使用 `taskkill /T /F` 回收整棵进程树；当系统允许枚举但拒绝 `taskkill` 时，会先快照后代 PID 并从叶子向上兜底终止。受限沙箱若同时禁止枚举和终止，只能回收当前可控子进程并显式跳过真实树终止测试。
- raw PTY 在 close/error 后立即失效；attached session 停止时回收完整 POSIX process group 或 Windows process tree。
- Hooks v2 以 generation-aware opaque identity 绑定可信宿主根。晚到的 stdin `EPIPE` 不会吞掉已完成 hook 的 status 0 输出或 status 2 block；其它 spawn error 仍失败闭合。
- Hooks 与 Broker 共享单一 runtime graph，避免重复 CredentialTransport worker/listener 与稳态 FD。
- 本地控制通道优先使用 NDJSON/TCP fallback，需要本地会话凭据。
- 停止后台 Agent 时，supervisor 会校验 PID 与会话绑定关系，避免误杀。

## MCP runtime identity 与沙箱策略

已发布版可以在新增 stdio server 时显式声明 runtime：

```bash
cc mcp add my-server --command node --args ./server.mjs \
  --runtime-kind node --auto-connect
```

`0.163.8` 允许在 `.mcp.json`、managed settings、Skill 或 Cowork 定义中声明 source-required boundary：

```json
{
  "mcpServers": {
    "workspace-tools": {
      "command": "node",
      "args": ["./tools/server.mjs"],
      "runtimeKind": "node",
      "cwd": ".",
      "sandboxPolicy": {
        "requiredBoundaries": ["filesystem", "network"]
      }
    }
  }
}
```

source 配置中的 `requiredBoundaries` 当前只接受 `filesystem` 和 `network`。这不是“尽力而为”提示：配置会绑定可信 workspace/cwd 后进入 Process Broker；当前平台无法证明所需边界时 server 不启动。exact-package capsule 还会强制叠加内部的 `code-snapshot` 与 `process-tree` 宿主边界。

## 在 IDE 中查看质量、插件、Worktree 与 Agent Teams

Open VSX 当前公开 VS Code `0.37.51`，JetBrains Marketplace 当前公开 `0.4.87`。生产建议搭配 CLI `0.163.8`：

- 质量上下文只发送有界的测试结果、覆盖率与调试器快照，并标注新鲜度；VS Code Notebook 使用当前 notebook 的真实执行上下文。
- Installation Doctor 会同时检查 Node/Java、managed CLI 与插件 registry 离线恢复状态，不从工作区目录探测可执行文件。
- Plugin Manager 的 enable/disable、upgrade、reload、签名/SBOM 与策略来源都由 CLI runtime 执行；IDE 只在收到 `activated` 后重载会话，扩大 capability 前必须显式确认。
- Worktree Tasks 和 team/batch 协作记录显示 durable owner/session、权限、预算、生命周期与副作用摘要；team/batch 仍不暴露后台进程控制按钮。
- Team Monitor 只读观察本地 v6 或 queue v1 原始状态；takeover、managed checkpoint recovery 与 side-effect adjudication 通过解析出的 CLI 执行，并绑定精确 authority digest、lease 和 evidence fence。IDE 不直接改写权威 JSON。
- 用量视图显示真实工具耗时、观测重试与实际 provider/model 的脱敏 retry 原因。
- Sessions Workbench 只消费 CLI-owned session projection，并按 exact revision 决定 resume、attach、delivery 与 remote-control 动作；可恢复 delivery 覆盖 GitHub、Gitee、configured remote 与 manual handoff，rewind/branch timeline 绑定 session、workspace、repository head、checkpoint revision 与 manifest digest。
- VS Code `0.37.50` / JetBrains `0.4.86` 公开版新增 Automation Center，并继续认证 local/background/remote/team/workflow 五类 canonical session、artifact/PR 回读、独立 IDE 进程重启恢复及真实宿主聚合。

## 托管回滚与 Agent Team 边界

- `--managed-checkpoint` 只覆盖 Process Broker 管理且位于声明 workspace 范围内的 writer；未托管进程、其他本地进程与范围外路径不在保证内。
- `coverageTarget=full` 仍要求 `writerIsolation=exclusive-workspace`；Agent Team 当前 checkpoint authority 为 `partial`、`writerIsolation=unknown`、`externalSideEffects=true`。
- 网络、数据库、消息、部署、支付和其他外部系统操作不能由 workspace checkpoint 回滚；需要业务幂等键、事务日志与结果核验。
- queue v1 依赖共享可信本地文件系统和文件锁，不提供复制、仲裁、BFT 或网络分区容错。状态是未签名的可信控制面，父目录与祖先必须可信。
- 10,000 task / 64 worker 结果来自单进程内 TeamRunner 异步 worker；三平台长期 soak 使用 2 个真实 OS worker 验证跨进程 DAG、故障与恢复，不等价于 64 个分布式进程或 live-model 质量保证。

## 配置参考

默认运行目录是 `~/.chainlesschain`。设置 `CHAINLESSCHAIN_HOME` 时，该值就是运行目录本身，不会再追加一层 `.chainlesschain`：

```bash
CHAINLESSCHAIN_HOME=/tmp/cc-ci cc session list
# 会话文件：/tmp/cc-ci/sessions/<id>.jsonl
# 主配置：  /tmp/cc-ci/config.json
```

credential agent 会保留运行所需的非秘密会话标识（如 `CC_SESSION_ID`、`CLAUDE_CODE_SESSION_ID`），但仍过滤未知的 `*_SESSION` 变量与长效凭据，避免把无关宿主环境透传给子进程。

## Skill 执行边界

- production `skill run` 不导入 `handler.js`；非隔离 direct handler 会返回 `CC_SKILL_DIRECT_HANDLER_BLOCKED`。
- 隔离 Skill 只获得父级权限上限允许的 `read_file`、`search_files`、`list_dir`，没有 MCP client、Process Broker 或 Node.js `child_process`。
- `capabilities: [shell-exec]` 目前只是历史 descriptor/template 元数据，不产生 runtime authority；CLI-Anything、CLI Pack 与 creator 生成的 legacy handler 仅供显式迁移和检查。
- 不要通过修改 handler、恢复已删除 façade 或直接 import 来绕过边界。若未来恢复 handler 执行，必须重新证明 source/digest approval、可执行字节身份、完整进程树、固定 deadline、host-owned dispose 与三平台真实回归。

## 使用示例

```bash
# 后台启动 Agent，并用返回的会话 ID 接管或查看日志
cc agent --bg -p "重构 auth 模块并补测试"
cc attach <session-id>
cc logs <session-id>

# Git 仓库中后台任务默认使用 committed HEAD 的隔离 worktree；
# 只有明确接受共享 checkout 风险时才使用 --no-worktree
cc agent --bg --no-worktree -p "只读分析当前未提交修改"

# 使用隔离运行目录验证配置与会话
CHAINLESSCHAIN_HOME=/tmp/cc-ci cc session list

# 只预览 Agent Team DAG，不执行任务
cc team plan --tasks team-shell.json --json

# 查看 checkpoint 恢复状态；执行 resume/rollback 前先核验证据
cc checkpoint recovery list --json

# main 源码：只读列出 scheduler outcome-unknown 待裁决项
cc daemon scheduler adjudication list
cc daemon scheduler adjudication show <occurrence-id>
```

`decide` 只能在交互式 TTY 中运行，并要求最新 `evidenceDigest`、`attempt`、`fence`。不要在 scheduler host 仍运行、已分发任务尚未排空或外部结果未核验时执行。决策落盘后重启一个 scheduler host 应用结果。

## 性能指标

当前 Runtime 不承诺跨机器固定延迟。模型响应时间取决于 provider、上下文和网络；本地性能主要受 CLI 冷启动、JSONL 会话大小、工具进程数量、Git/worktree 操作和磁盘性能影响。

| 指标/边界           | 当前口径                                                                         |
| ------------------- | -------------------------------------------------------------------------------- |
| 命令加载            | manifest + lazy dispatch，未使用命令不在启动阶段加载                             |
| TeamRunner 容量验证 | 单进程异步 worker 场景覆盖 10,000 task / 64 worker；不等价于 64 个 OS 进程       |
| 跨进程长期验证      | Linux、Windows、macOS 各使用 2 个真实 OS worker 运行 120 分钟 soak               |
| 资源预算            | token、USD、wall-clock 预算持久化并带 fencing；未知计量不会在启用 cap 时按零处理 |
| Hook 回收           | 受 timeout 管理；退出时回收已知子进程或进程树，并显式报告平台限制                |

性能回归应记录 CLI 版本、准确提交、操作系统、Node 版本、provider/model、输入规模和 sandbox 模式；不能把 fake-LLM 或单进程压力结果外推为线上模型质量或分布式吞吐保证。

## 安全考虑

- 所有前台、后台、Hook、MCP、PTY、插件和技能子进程应经统一 Process Broker；不要在生成的 handler 中直接绕过 Broker。
- 显式 `workspace-write` / `strict` sandbox 无法建立时失败闭合。配置值不等于隔离已经生效，应结合 `cc doctor` 和平台证明检查。
- secret 使用 `cc config set-secret` 或受支持的环境/OS store；普通 `config set`、argv、日志和会话导出不应用于保存明文凭据。
- 后台控制通道凭据、checkpoint authority、Team lease/fence 和恢复 evidence 都是本机能力边界，状态目录及其祖先必须可信。
- managed checkpoint 只回滚声明 workspace 内由 Broker 管理的 writer，不能撤销网络、数据库、部署、消息或支付等外部副作用。
- `cc session export` 默认脱敏；只有理解泄露风险时才使用 `--no-redact`。

更细的平台约束见“平台注意”，回滚与队列限制见“托管回滚与 Agent Team 边界”。

## 故障排查

| 症状                               | 排查与处理                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `cc` 命令或帮助与源码不一致        | 比较 `cc --version` 与 `packages/cli/package.json`；源码运行使用 `node packages/cli/bin/chainlesschain.js --help` |
| 后台 `attach` 只能跟随日志         | 检查 session 状态与本地控制通道；worker 已退出或通道不可用时降级为日志跟随是预期行为                              |
| strict sandbox 启动即拒绝          | 运行 `cc doctor`，检查 Docker/bubblewrap/AppContainer 与平台证明；不要通过降低策略掩盖生产配置错误                |
| checkpoint 显示 `partial` / `none` | 检查 writer 是否由 Broker 管理、是否位于声明 workspace，以及是否存在外部副作用                                    |
| Team task 停在 adjudication        | 重新读取 status、authority digest、attempt 和 evidence，再显式 retry、accept 或 cancel                            |
| Scheduler 出现 outcome-unknown 死信 | `0.163.7` 先停全部 host、排空 dispatch、外部核验，再执行 `adjudication show/decide`；禁止盲目重跑或直接改存储 |
| pause/resume 提示 fence/revision conflict | 重新读取 `center-projection` 并使用最新 exact argv；不要复用旧投影或自行改 fence |
| incident retry 被拒绝               | 只有与 scheduler dead letter 的 occurrence/job/run/fence/error code 全部匹配才可重试；manual incident 只能 cancel |
| `CC_SKILL_DIRECT_HANDLER_BLOCKED`  | 当前 production 不执行 direct handler；改用受支持的隔离 Skill 工具，不要修改 handler 绕过检查                     |
| 会话或预算状态异常                 | 在同一 `CHAINLESSCHAIN_HOME` 下检查 session JSONL、状态日志和目录权限，避免混用多个运行目录                       |

## 测试覆盖

在发布或本地验证前，建议执行：

```bash
cd packages/cli
npm run test:unit
npm run test:integration
npm run test:e2e
```

`0.163.8` 的权威发布提交为 [`a0631cb4f97f45ff7fcef9c19d346ed2b8387da6`](https://github.com/chainlesschain/chainlesschain/commit/a0631cb4f97f45ff7fcef9c19d346ed2b8387da6)。同一 `head_sha` 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/31804468633)、[CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/31804468464)、[npm 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/31806101423)与[独立公网回读](https://github.com/chainlesschain/chainlesschain/actions/runs/31807574517)均成功。npm 公网回读为 `latest=0.163.8`，tarball SHA-1 为 `655557b5c5b897b23a29975708abbf8d5cd31e88`，SHA-256 为 `862a0f450da013740a1c21d084233b002982b4b816f156e4949b6110eda80e12`。Linux、Windows、macOS 的权威矩阵必须绑定精确提交；本地结果和发布后源码门只能补充，不能替代发布授权。

## 相关文档

- [CLI 命令行工具](./cli.md)
- [后台 Agent 与 attach](./cli-background-agents.md)
- [Agent Team 用户指南](./cli-team.md)
- [CLI 安全沙箱](./cli-sandbox.md)
- [Checkpoint 与回滚](./checkpoint.md)
- [配置管理](./cli-config.md)
- [Cowork 多智能体协作](./cowork.md)
- [命名任务 `cc routine`](./cli-routine.md)
- [长任务调度 `cc agenda`](./cli-agenda.md)
- [工作流自动化 `cc automation`](./cli-automation.md)
- [运行时设计核对](/design/cli-runtime-current)
