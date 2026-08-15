# CLI Runtime 当前实现核对（稳定版 0.163.8）

> 更新时间：2026-08-14。npm `latest`、生产推荐版与 `github/main` 包元数据均为 `0.163.8`；公开 CLI 能力绑定不可变 tag `v-npm-0-163-8` 的精确 SHA `a0631cb4f97f45ff7fcef9c19d346ed2b8387da6`。`main@affafa7f0f` 此后的原生剪贴板图片粘贴属于发布后源码能力，不能反向写成 `0.163.8` tarball 契约。本文继续把 npm/CLI、源码增量、IDE 市场与 Desktop/native 签名发行的证据边界分开记录。

## 版本与证据边界

- `0.163.8` 是当前生产推荐基线。`v-npm-0-163-8` 精确指向 `a0631cb4f97f45ff7fcef9c19d346ed2b8387da6`；同一 SHA 的 `CLI CI`、`CLI Strict Sandbox` Linux/Windows/macOS、专用 npm 发布、Trusted Publishing、签名 provenance 与独立 registry readback 均成功。npm 公网回读为 `latest=0.163.8`，tarball SHA-1 为 `655557b5c5b897b23a29975708abbf8d5cd31e88`，SHA-256 为 `862a0f450da013740a1c21d084233b002982b4b816f156e4949b6110eda80e12`。
- `0.163.7` 是上一完整门禁基线。它公开 outcome-unknown 裁决、五域迁移/回滚与因果观测，现由 `0.163.8` 取代。
- `0.162.200` 是上一完整门禁基线，并完整承接上传前失败的 `0.162.199` 候选；`v-npm-0-162-199` 保持不可变，不移动或伪造成已发布版本。`0.162.193` 继续作为非权威发布历史审计记录保留。
- `0.163.2` 完整承接 `0.163.1`，并公开显式 MCP runtime identity、Linux descriptor-bound 固定 npm/Node capsule、Windows 一次性 restricted-token/AppContainer authority、macOS 无法证明原子 image binding 时的类型化失败闭合，以及恶意宿主证据 v4。unsigned 六目标原生 validation 仍不等于签名 Desktop/native 发行完成。
- `0.163.3` 进一步公开默认后台 worktree、generation/token-fenced supervisor、grammar-safe detached argv、MCP source policy/cwd authority、Linux plugin 全树逐文件封存与 Windows adapter artifact 安全回收；其剩余边界不外推为任意 shared-library closure、macOS atomic exec、远端 revoke 或签名 native 发行。
- `0.163.5` 公开 host-owned `SchedulerRuntime`，并把 Routine manual/cron/once、Agenda wakeup/cron 与 Cowork Cron 接到统一内核；durable microcompact checkpoint 同时进入发布。terminal evidence 可以在崩溃后安全补结算，start-only 或副作用后持久化失败固定为 outcome-unknown，不外推为全局 exactly-once。
- `0.163.6` 完成 Agenda monitor、Loop、Automation cron、Routine GitHub、channel event 与 standalone daemon 的 adapter 迁移，并统一权限/预算 authority 及 Agenda/Cowork 的 timezone/DST/missed-run 语义。
- `0.163.7` 正式公开 outcome-unknown 人工裁决、五域 migration journal 与受治理回滚、因果交付报告、call-ledger 预算和后台恢复权威加固。裁决与回滚均依赖精确证据/CAS；它们不扩张为跨独立存储的原子事务或语义因果证明。
- `0.163.8` 正式承接确定性 scheduler disk-fault matrix、checkpoint-aware Automation pause/resume、incident retry/cancel、受治理多 Agent merge review、只读 MCP resource templates 与 transaction-time lease clock。首个 formal soak run `31807830251` 因 Windows worker 提前退出而无效；后继 exact-main run `31821080101` 三平台及 aggregate 全部成功并定义新 `T0`，正式计数为 `1/4`，其余三个 segment 与 72 小时 campaign verifier 尚未完成。
- `main@affafa7f0f` 在发布后新增原生 `/paste-image`。Windows、macOS 与 Linux 使用各自受控宿主桥读取有界图片并进入下一轮 vision message；最终 merge SHA 的 host workflow `31813967006`、CLI CI `31810849262` 与 CLI Strict Sandbox `31810848956` 均通过，但该提交仍不属于 `0.163.8` tarball。
- IDE 当前公开版本为 Open VSX `0.37.52`；JetBrains `0.4.88` 已上传但尚无本文采用的公开 listing 回读。已发布双 tag 指向 `f044181efb`，默认关闭的受治理自动 ghost-text、Automation Center、真实宿主矩阵与发布回读已完成；微软 VS Code Marketplace 与 JetBrains 作者签名仍未完成。

## 当前边界

CLI 运行时由命令分发、会话生命周期、受控执行与回滚、Agent Team authority、扩展运行时、事件总线和可观测出口共同组成。

```text
cc entry
  ├─ command manifest + lazy dispatch
  ├─ foreground / background agent runtime
  │    ├─ local attach transport (NDJSON / TCP fallback)
  │    ├─ canonical transcript / compaction / resource-budget authority
  │    └─ interactive clipboard-image adapter → bounded vision content
  ├─ process-execution-broker
  │    ├─ platform sandbox + native execution attestation
  │    ├─ credential agent
  │    └─ managed workspace transaction + checkpoint restore saga/recovery
  ├─ plugin runtime
  │    ├─ manifest capability + sandbox policy
  │    ├─ hooks / MCP / LSP / monitors / native bins
  │    └─ lifecycle + signature / SBOM / source provenance
  ├─ controlled Skill boundary
  │    └─ isolated child → read_file / search_files / list_dir only
  ├─ durable event + interaction journal
  ├─ scheduler kernel
  │    ├─ versioned SQLite contract + revision-CAS jobs/occurrences/history
  │    ├─ host-owned runtime + owner/fence claims + lease heartbeat
  │    ├─ adapters: Routine / Agenda / Cowork / Automation / Loop
  │    ├─ shared authority: exact capabilities + revision-bound budgets
  │    ├─ adjudication + migration/rollback: evidence CAS + monotonic decisions
  │    └─ source-only runtime recovery: checkpoint pause/resume + incident requeue
  ├─ Agent Team authority
  │    ├─ local state v6 + distributed queue v1
  │    ├─ budget / lease / worktree / adjudication fences
  │    └─ merge-review: file/hunk decision + atomic publish/rollback evidence
  ├─ bounded usage + retry attribution
  ├─ MCP ws/wss + uncertain-outcome recovery authority
  │    ├─ stdio runtime identity + source policy/workspace authority → Broker
  │    └─ bounded resources + resource-template discovery cache
  ├─ Auto mode safety classifier
  ├─ OTLP traces + metrics exporter
  └─ session hooks (Setup / Notification / lifecycle)
```

## 0.162.198 → 0.163.8 发布增量

- **交互输出与发布可移植性**：REPL、headless streaming、provider pacing 与 TTY writer 在输出饱和时等待 drain，并在完成、中断和会话切换时清理监听器；Windows path alias、状态路径、Skill metadata、POSIX executable bit 与兼容 shim 夹具已对齐三平台 CLI CI / Strict Sandbox。
- **Canonical Workbench 路由**：CLI-owned session projection 与有界 reply/action route 支持 VS Code / JetBrains Workbench 和 rewind journey，同时保持所有持久 mutation 的 CLI authority。
- **观察基线**：`0.162.198` 是包含当前 OTLP 接线的首个明确公开命令生命周期观察基线。下面的配置、MCP、session/budget、native update 与 checkpoint 能力继承自 `0.162.197`，并随本版本继续公开。
- **`0.162.200` 会话与 MCP 权威**：canonical session host lease、transcript witness、anti-rollback anchor、CAS 持久化与有界清理已经公开；npm-backed MCP launcher 固定到精确版本和完整传递闭包，物化为受守护、内容寻址的 Node capsule；Windows/POSIX 原生更新恢复保持 generation、锁与路径身份。
- **`0.163.0` macOS PTY 与原生宿主**：postinstall 只对窄范围解析出的 regular-file `node-pty` helper 修复并验证执行位，拒绝 symlink；六个 Linux/Windows/macOS x64/ARM64 目标使用匹配架构 runner 并要求产物在自身架构执行。
- **`0.163.1` 可靠性与打包**：公开有界长会话压缩、live session tail durable-witness 竞态修复、Windows MCP 原子启动、可复现 Web Panel 构建、Node 22 standalone 基座、跨平台可靠性探针和原生发行凭据 preflight。
- **`0.163.2` MCP capsule**：stdio 配置显式声明 runtime kind；Linux descriptor-bound capsule、Windows 一次性 Broker-private authority 与 macOS typed fail-closed boundary 分别记录真实平台能力，不把 pathname snapshot 冒充原子 code identity。
- **`0.163.3` 后台 Agent 隔离**：干净 Git checkout 的非 `stream-json` 后台运行默认从 committed `HEAD` 创建 worktree；`--worktree` 使用同一路径，`--no-worktree` 才共享 checkout。版本化脱敏 launch profile、worker generation claim、terminal-absorbing update、durable turn intent 与 stop/cleanup fence 共同约束状态与回收。
- **`0.163.3` MCP/插件平台边界**：source-required `filesystem`/`network` 与可信 workspace/cwd 贯通 Broker；Linux strict plugin/native 树逐目录 FD 遍历后把普通文件封为独立 sealed snapshot；Windows helper/cache/test artifact 绑定经 canonical/reparse/identity 复验的 run-owned root，未知项失败闭合并保留现场。
- **`0.163.4` capsule build/evidence**：exact-package 输入进入 immutable WASM VFS，builder 受内存上限约束；平台 live gate 把 runtime/entry/native asset、sandbox capability 与 trace context 绑定到同一证据链。scheduler-kernel v1 store 提供版本化 schema、expected-revision CAS、logical occurrence 去重、durable claim 与 history。
- **`0.163.5` scheduler runtime**：统一 runtime 注册按 kind 隔离的 adapter，执行前复验 snapshot-bound authority，领取 owner/fence lease 并心跳续租，以有界 retry/dead-letter/terminal settlement 结束 occurrence。Routine manual/cron/once、Agenda wakeup/cron 和 Cowork Cron 已进入正式契约。
- **`0.163.5` durable microcompact**：持久化前移除瞬态 runtime marker，保存 compact checkpoint，并在 REPL/Agent 恢复时重建状态且保持 Process Broker trace 传播。
- **`0.163.6` 调度收敛**：Agenda monitor、Loop、Automation cron、Routine GitHub、scope-checked channel event 与 standalone daemon 进入共享 scheduler service；Agenda/Cowork cron 持久化规范 IANA timezone，并对 DST gap/repeated minute 与停机错过触发采用一致且有界的处理。
- **`0.163.6` authority 与控制面**：Agenda、Routine、Cowork、Automation、Loop 对 exact capability policy revision 进行执行前复验，并用同一事务 reservation/settlement 约束 run/unit 预算；Automation Center 的 flow/Routine 动作必须经过 CLI-owned projection、preflight 与 revision CAS。
- **`0.163.7` migration/rollback**：五域迁移以 schema-v5 journal 绑定 source locator、source/target digest、retirement fence 与恢复阶段；回滚先停止或恢复 target，再按最新 evidence digest、交互 TTY 和 exact typed challenge 恢复 legacy source。Windows/UNC identity、Automation 原生 SQLite 与 Loop retirement marker 均失败闭合。
- **`0.163.7` 裁决与因果观测**：`*_OUTCOME_UNKNOWN` 只在停 host、排空 dispatch、外部核验后接受 evidence digest + attempt + fence CAS；`confirmed_applied` 不重放，`confirmed_not_applied` 只放行一次有界 claim。delivery report 绑定 transcript head/event count 与 diff/gate/artifact/PR/merge revision，call-ledger 对未知 token/cost/retry/tool-latency 不按零处理。
- **`0.163.8` 恢复与持久化**：Agenda/Cowork 写入使用 private temp、完整 short-write、file/directory fsync 与 atomic rename；Automation runtime/incident mutation 绑定 exact fence、control revision、capability 和 dead-letter evidence。claim、renew、settlement 的 lease clock 在写事务内读取，避免排队时间污染裁决。
- **`0.163.8` Agent Team merge review**：`cc team merge-review preview|show|apply|rollback` 把候选 branch、base identity、稳定 file/hunk id、选择、actor/reason、revision、plan/evidence digest 与冲突持久化到仓库外 owner-only 状态。发布使用受控临时 branch 与原子引用更新；Git hook/config/env、branch 漂移、选择超限和旧 revision 都失败闭合。
- **`0.163.8` MCP resource templates**：连接阶段把 server resource templates 纳入有界只读 discovery cache，并向模型暴露 `list_mcp_resource_templates {server?}`。模型必须先选择并实例化具体 URI，再进入既有 `read_mcp_resource` 边界；不会自动展开 URI、订阅资源或产生隐式网络请求。
- **第二观察周期**：`0.163.0` 开启命令生命周期的第二个 minor cycle；由于仍缺代表性 opt-in collector cohort、三平台 coverage 与逐命令样本下限，25 个兼容 alias 全部保留，且不在 `0.164.0` removal floor 前删除。

- **配置与 sandbox 默认值**：schema secret 不允许经普通 `config set` 写入，必须使用隐藏 TTY/stdin 与 OS store/owner-only fallback 的 `config set-secret`；显式 `workspace-write` / `strict` 以及 managed-required sandbox 在能力缺失时失败闭合。`mcp add` 默认 local scope，常规 `status` 使用有界 quick probe，完整 Docker Compose 细节改由 `--deep` 请求。
- **MCP 恢复权威**：`ws/wss` transport、可信动态 header 与 timeout notification 已接线；REPL、stream、Cowork/host 与 WebSocket 使用共享的持久恢复记录。结果不明确时必须 verification/adjudication，不能盲目重放可能已有外部副作用的调用。
- **Canonical session 与预算**：REPL、stream、WebSocket、headless 使用可验证 transcript projection、事务化 summary/compaction 与 stale/corrupt resume 拒绝。持久 token/USD/wall-clock 预算已接入后台与 Team adapter，但尚不是跨所有宿主的统一预算 authority。
- **Agent 工作流控制**：plan/todo revision 与 authority ceiling、受控 Skill 子 Agent、后台 launch profile、semantic handoff、`/btw` 临时旁路、manifest-driven help 与确定性 shell completion 已进入当前树。
- **原生更新恢复**：不可变 release identity、签名 updater rollback chain、下载替换恢复与跨平台 cleanup/recovery fence 已落地；真实签名、平台 notarization/Authenticode 与最终发布矩阵仍由 release gate 决定。
- **Checkpoint restore saga**：直接恢复与 timeline restore 共享 workspace prestate binding、生命周期锁、Git/copy 不可变目标、安全 checkpoint、hash-chained CAS journal 和 transaction-fenced settlement。`cc checkpoint recovery list|show|abort|resume|rollback|release` 只允许 live owner 或已验证 owner absence 加 exact seq/head fence 后的 eligible 动作；`resume` 仅结算已完成状态，`rollback` 仅反转已验证的部分文件变更。
- **边界**：checkpoint recovery 不是通用多资源原子事务、断电证明或 checkpoint GA。网络、数据库、消息、部署、支付等外部副作用仍需各自幂等键、事务日志与结果核验。

## 2026-08-08 `0.163.1` 发布闭环

- **有界长会话压缩**：既有 durable summary 和 compacted tool record 会折入下一份摘要，不再作为永久累积的 system message；2,000 turn 回归验证状态有界，同时保留 checkpoint 等可信 host provenance。
- **live session tail 竞态失败闭合**：transcript 在路径检查与异步 `stat` / `open` 之间被删除或恢复时，follow 操作通过 durable session witness 重新分类为受治理的 deleted / unverified-transcript 错误，不再向上泄漏平台相关的原始 `ENOENT`。
- **Windows MCP 原子启动**：严格沙箱从挂起进程 image 创建起持有已验证 runtime/entry identity，恢复执行前再次复核；真实路径替换竞态在不可信 entry code 执行前失败闭合。
- **真实跨平台可靠性探针**：正式矩阵加入 EROFS/ENOSPC session、bounded pipe consumer、原生 TTY screen-reader、多语言键盘、Windows/macOS Unicode 剪贴板、localhost SSH 断线、超大 MCP 输出、并发 Agent 与两小时资源核算。
- **Native 凭据 preflight**：六目标原生 workflow 在 Linux signing、Windows Authenticode、macOS signing/notarization 或 updater key 缺失时拒绝构建；这不等于相关原生发行链已完成。
- **可复现 Web Panel 与 standalone 基座**：CLI pack 从干净、lockfile 驱动的 Web Panel 依赖图构建；Vite/Rollup/Intlify 运行链固定，Rollup 文件并发有界，Node 22 standalone 基座在 Linux、Windows、macOS 的 x64/ARM64 验证宿主上保持确定性。
- **发布闭环**：`v-npm-0-163-1` 精确指向 `e3f56b11e27ae1bd5d19ad8638434843c244aa68`。同 SHA 的 CLI CI `31240892299`、CLI Strict Sandbox `31240892177`、unsigned 六目标原生验证 `31240927257`、三系统两小时可靠性门 `31240943985` 与 npm release `31246063305` 均成功；正式发布完成 immutable tarball、CycloneDX SBOM、Trusted Publishing、SLSA provenance、registry bytes 与 npmmirror 回读。
- **原生边界不变**：六目标 validation 固定记录 `signed=false`、`releaseEligible=false`。Windows Authenticode、macOS signing/notarization、updater key 与公开 fresh install/upgrade/rollback 回读仍未闭环，npm 发布成功不能替代这些证据。IDE ARM64 在后续 `0.37.47` / `0.4.83` 的独立发布门中闭环，不属于 CLI native 签名发行。

## 2026-08-09 `0.163.2` 发布闭环

- **runtime identity**：`runtimeKind` 仅接受 `native`、`node`、`python`、`posix-shell`、`powershell`、`java`、`dotnet`。已识别 runtime 不能通过错误标签改变语义；改名或自定义 executable 必须先声明语义，字段贯穿 local/project/managed、Skill 与 Cowork 来源。
- **Linux capsule**：固定 npm/Node server 的 runtime descriptor、entry descriptor 与 passthrough argv 绑定到同一次启动；direct inherited-FD 与 `bwrap` 路径都校验 exact runtime/entry/arguments，并拒绝路径穿越、歧义 separator、mixed evidence 与 pathname replacement。
- **Windows capsule**：restricted-token/AppContainer plan 只由 production adapter 发行并只由内建 Broker 消费；一次性 capability 绑定 contract、helper payload、环境、stdio handles 与 post-spawn closure，验证/收尾均 delete-before-use，重放、注入 adapter 和废弃 plan 均失败闭合。
- **macOS capsule**：公共 Darwin API 不能原子地把已验证 descriptor 绑定到最终 exec image，因此严格 MCP capsule 返回类型化 fail-closed；root-owned/signed broker 或等价 atomic exec 仍是独立路线图项。
- **权威发布**：tag `v-npm-0-163-2`、CLI CI `31277578939`、CLI Strict Sandbox `31277578889`、两小时可靠性/恶意 MCP 门 `31271803404`、npm release `31277578900` 与公网 readback `31278310621` 均绑定 `2d6f19aea2` 并成功。

## 2026-08-10 `0.163.3` 发布闭环

- **默认后台 worktree**：干净 Git checkout 中的非 `stream-json` `cc agent --bg` 默认从 committed `HEAD` 创建隔离 worktree；`--worktree` 显式请求同一路径，`--no-worktree` 才共享 checkout。dirty tracked/untracked source 拒绝启动，避免用户误以为未提交内容进入快照。
- **所有权与 argv fence**：locked atomic state、不可变 worktree/profile identity、worker generation claim、terminal-absorbing update、durable turn intent 与 cleanup fence 阻止 stale worker 复活或删除 live work。detached 参数保留 option value 与 `--` literal，把 prompt 固定为单个 `--print=<text>` token，并确定性归一 resume/continue/fork/session。
- **MCP source policy**：`mcp-sandbox-policy.js` 与 `mcp-stdio-workspace-authority.js` 把 source-required `filesystem`/`network` 和可信 `cwd` 从 local/project/user/managed、Skill、Cowork 定义贯通 Broker。Proxy、accessor、未知字段、非支持 boundary、越权 cwd 直接拒绝；高优先级无效定义保留名称，低层同名 source 不能绕过策略。
- **平台文件封存**：Linux strict native/plugin 路径逐目录 FD 遍历，拒绝 link、跨 device/mount、special file、hardlink 与超限树，并把每个普通文件复制到独立匿名 sealed snapshot。Windows adapter artifact 只在可信 run-owned root 内物化、复验和非递归回收；无法证明的对象保留并使清理失败。
- **权威发布**：tag `v-npm-0-163-3`、CLI CI `31329476135`、CLI Strict Sandbox `31329476020`、两小时可靠性/恶意 MCP 门 `31329539092`、npm release `31335579227` 与公网 readback `31336362525` 均绑定 `17fcf6aa79` 并成功。
- **剩余边界**：native spawn 至 PID commit 的 hard-kill 窗口、无可复验 PID 的 detached descendant、macOS runtime atomic exec、任意 native/shared-library 递归闭包、远端 revoke/distributed authority、受信 Node builtin 的最终跨平台隔离和签名 native 发行仍未关闭。
- **后续归属**：`d2fcbddc99` 的宿主四边界地板已由后续 `0.163.4` 发布链承接，不再标为当前未发布增量。

## 2026-08-11 `0.163.4` / `0.163.5` 调度发布闭环

- **存储与 runtime 分层**：`0.163.4` 先发布 strict schema、jobs/occurrences/history、revision CAS、logical-occurrence dedup 与 durable claim；`0.163.5` 再发布 `SchedulerRuntime`，负责 adapter 注册、claim 后 authority/snapshot 复验、heartbeat 续租、attempt 上限、retry/dead-letter 和 terminal settlement。
- **Routine adapter**：manual trigger 与 cron/once 使用不同 channel/job id；occurrence 生成确定性 `run-scheduler-*` id，并把 occurrence/snapshot digest 写入既有 `runs.jsonl`。已存在终态 run evidence 时只恢复结算，不再次执行 Agent；只存在 start 时拒绝重放。
- **Agenda adapter**：只迁移 wakeup 与 cron；完整 `runPolicy` 进入 snapshot，legacy JSONL claim 与 scheduler claim 双向 fencing。已知的 pre-effect 失败可以有限重试，terminal evidence 可以恢复；monitor 仍走旧路径且不在本次承诺内。
- **Cowork Cron adapter**：snapshot 只含定义字段，恢复 claim 按 workspace 隔离；新旧 driver 共享 delivery id/lease/fence，六字段 cron 自动使用一秒轮询。start-only、terminal JSONL 替换失败或 outcome 不可证明时死信，不盲目重放 Cowork task。
- **`0.163.5` 正式边界**：Agenda monitor、Automation、Loop、Routine GitHub、standalone scheduler daemon/liveness、共享权限/预算 resolver、IANA timezone/DST/missed-run、迁移/回滚、磁盘故障与长期 soak 尚未进入该版本；这些已交付项由后续 `0.163.6` 承接。

## 2026-08-12 `0.163.6` 统一 authority 与 Automation 控制面发布闭环

- **适配器收敛**：Agenda monitor、Loop iteration、Automation cron、Routine GitHub polling、Webhook/Telegram scoped channel event 与 standalone scheduler daemon 使用共享 job/occurrence、definition snapshot、owner/fence lease、recovery fence 和 bounded retry/dead-letter 语义。
- **时区与错过触发**：Agenda/Cowork cron 保存规范 IANA timezone；spring-forward gap 不制造不存在的 civil minute，fall-back repeated minute 映射到两个真实 instant，停机追赶折叠到最近一个到期 occurrence，避免 replay storm。
- **共享 permission/budget authority**：五个 domain 绑定 exact capability policy revision，并经同一事务 reservation/settlement 处理 `maxRuns`/`maxUnits`。缺失、过期、停用、耗尽或不一致的策略失败闭合；retry 复用原 reservation，不重复计费。
- **Automation 双层复验**：scheduler authority 与 flow creator、connector RBAC、live revocation、per-flow run/action budget 分别核验；其中任一证据失效都拒绝 unattended execution。
- **Governed Automation Center**：CLI 生成 versioned projection 与 exact argv；VS Code `0.37.50` / JetBrains `0.4.86` 展示 scope、preflight、history，支持 run-now、失败重试、pause/resume、disable/delete，并以 bounded JSON stdin + revision CAS 创建/编辑 cron、once、webhook、GitHub Routine。IDE 不直接写权威存储。
- **诚实剩余边界**：`0.163.6` 本身不含 scheduler outcome-unknown 人工裁决；完整 mixed-version migration/rollback、scheduler disk-fault closure 与三系统长期 soak 未完成。本发布不宣称全局 exactly-once 或 Desktop/native 签名发行。

## 2026-08-14 `0.163.7`：scheduler outcome-unknown 人工裁决

`c7d49beaa1` 在 scheduler store schema v3 中新增单调裁决记录，并把 Agenda、Routine、Cowork Cron、Automation cron/event 与 Loop 的恢复适配器接入同一协议。它只接受状态为 `dead_letter` 且错误码匹配 `*_OUTCOME_UNKNOWN` 的 occurrence。

```text
outcome-unknown dead letter
  → stop every scheduler host
  → drain already-dispatched work
  → verify the external system
  → read evidenceDigest + attempt + fence
  → interactive typed challenge + reason/operator digest
     ├─ confirmed_applied     → settle from evidence; never replay
     └─ confirmed_not_applied → authorize exactly one bounded claim
```

裁决以 occurrence、authority、payload、reservation outcome、attempt 与 fence 生成 evidence digest；写入时逐项 CAS 复验。旧 evidence、非交互终端、重复裁决、已变化 fence 或不支持裁决的 adapter 全部失败闭合。数据库只保存 reason/operator 的摘要，不保存理由明文。typed challenge 是操作证据，不是机器范围进程租约，因此停机、排空与外部核验仍是操作员前置责任。

该能力已随 `0.163.7` 的精确发布 SHA `3e997168621c53708a1682868c6cc4edc9baf15b` 进入稳定安装契约；typed challenge 仍只是操作证据，不是机器范围锁，不能跳过停 host、排空和外部核验。

## 2026-08-14 `0.163.7`：五域迁移、回滚与因果观测

- Agenda、Cowork Cron、Routine、Automation 与 Loop 共享 schema-v5 migration journal；source locator、source/target digest、retirement fence 与阶段状态持久绑定，恢复幂等且冲突/歧义失败闭合。
- `cc daemon scheduler migration list|show|rollback` 只暴露脱敏状态和 blocker。rollback 必须带最新 evidence digest，在交互式 TTY 完成 exact typed challenge；target-first 顺序防止 legacy source 与新 target 同时重新持有权威。
- 会话因果观测把精确 transcript head/event count 绑定到 delivery graph，覆盖 diff、gate、artifact、PR 和 merge；workspace/team/policy filter 属于范围选择，不是身份、成员或语义因果证明。
- `call-ledger@1` 覆盖 model、retry、compaction、subagent、isolated Skill 与 tool call；严格预算在 settlement 缺失或不可评估时拒绝，不把未知量记为零。

## 2026-08-14 `0.163.8`：可靠性、恢复、merge review 与 MCP templates

- **磁盘故障闭环（PR #186）**：Agenda/Cowork 权威 JSONL 使用 private exclusive temp、完整 short-write loop、file fsync、atomic rename 与 POSIX directory fsync，并区分 `not-committed` 和 post-rename `unknown`。矩阵覆盖 ENOSPC、partial write、file/directory fsync、rename、损坏记录、原生 SQLite `SQLITE_FULL` 事务回滚、Automation source 原子恢复、数据库截断与 reopen fail-closed。
- **受治理 runtime recovery（PR #187）**：`center-projection` 投影可控 occurrence、exact fence/control revision 与声明的 `checkpoint_v1` safe point；`center-runtime-action` 只允许 running→pause-request→paused→resume 的合作式转换。能力变化、旧 fence/revision、终态或不支持的 job kind 全部失败闭合。
- **Automation incident（PR #187）**：schedule/event 失败形成 revisioned incident；`center-incident-action <id> retry|cancel --expected-revision` 中，retry 必须再次匹配 occurrence/job/run/fence/error code 才能做幂等 requeue，manual incident 因无法证明外部副作用而禁止 retry。IDE 只消费脱敏投影与 exact argv，不读取 authority/boundary/detail evidence。
- **三平台 soak（PR #188/#197）**：真实 Linux/Windows/macOS worker 验证 contention、higher-fence recovery、stale settlement、outcome-unknown no-replay、heartbeat、DST、backlog、SQLite quick-check、descendant retirement 与 RSS/FD/handle/orphan 趋势。campaign gate 要求绑定 exact release/control-plane SHA，至少 72 小时、至少 4 个 formal segment、最大段间隔 30 小时。首次正式 run `31807830251` 的 Windows worker 在第 4 轮提前退出，Ubuntu/macOS 随后取消；该 run 不计数。后继 `main@7d3120fc1e` 的 run `31821080101` 三平台及 aggregate 全部成功，定义新 `T0` 并把正式样本推进到 `1/4`；不得把这一段外推为完整 campaign 已通过。
- **多 Agent merge review（PR #191）**：`preview` 从精确 base 与候选 branch 生成稳定 file/hunk 选择；`apply` 必须匹配 revision、plan digest、选择、actor 与 reason，先 prepare 再以受控 ref transaction 发布；`rollback` 还要求当前 evidence digest 与完整 review id 二次确认。默认状态位于 `CHAINLESSCHAIN_HOME/team-merge-reviews`，显式 `--state-dir` 必须位于 agent 可写仓库之外。
- **MCP resource templates**：templates-only server 可以注册既有 resource surface。`list_mcp_resource_templates` 只读 discovery cache，可按 server 过滤；订阅、peer logging、completion 与 sampling 仍未进入公开契约。
- **剩余边界**：soak 工作流、formal segment 和 verifier 已合并，首个 exact-main 三平台正式 segment 已成功；当前仍为 `1/4`，尚缺其余三个 segment、至少 72 小时观察与最终 campaign verifier，因此长期 soak 仍是 P2-4 唯一未关闭项。以上基础能力已经进入不可变 `0.163.8` tarball，后继修复与首段证据位于发布后 `main`。

## 2026-08-14 `main@affafa7f0f`：发布后原生剪贴板图片

- 交互式 Agent REPL 自动探测受支持宿主；用户把图片复制到系统剪贴板后运行 `/paste-image`，图片会以本地 data-image block 排入下一轮视觉模型消息。该入口不把剪贴板内容解释为命令或远程 URL。
- Windows 仅使用可信系统目录内的 Windows PowerShell，找不到时才从受控 `PATH` 解析 `pwsh`；macOS 固定 `/usr/bin/osascript` 并用 AppKit/ImageIO 把 PNG/TIFF 安全归一；Linux 在真实 Wayland/X11 display 下使用 `wl-paste` / `xclip`，无 display 或工具时明确报告不可用。
- 支持 PNG/JPEG/GIF/WebP 并校验 magic bytes。单图最多 20 MiB，每轮最多 4 张、总计 40 MiB，读取最多 10 秒；macOS 额外限制 TIFF 源、像素数、尺寸、行字节与解码预算，临时目录/文件要求 owner-private 并在使用后清理。
- PR #190 最终 merge SHA 的专用原生 host workflow `31813967006` 已通过 Linux、Windows、macOS 与 aggregate，CLI CI `31810849262` 和 CLI Strict Sandbox `31810848956` 也已通过。由于变更晚于 `v-npm-0-163-8`，当前只能标为源码能力；后续版本仍须在自己的最终 exact SHA 重新完成发布与公网回读。

## 2026-08-15 发布后安全候选

- **后台 hard-kill keeper**：`1724f05300` 在 native child 进入用户代码前建立 bootstrap barrier，并由 sibling keeper 在 supervisor PID commit 前持有 process-tree cleanup authority；`0edc932aa5` 增加 20-Agent、7200 秒、1000-cycle 的三平台 exact-SHA formal workflow。实现已提交，但 CLI CI、Strict Sandbox 与 keeper formal artifact 尚未在该最终 SHA 上形成，因此 P1-2 仍为部分完成。
- **Node capsule builtin policy**：`b22e65d1e9` 将构建期静态 external builtin 集绑定为最终 allowlist，并同时约束 `Module._load`、`Module._resolveFilename`、`process.getBuiltinModule`、internal bindings 与 `process.dlopen`。`2d4dff4052` 进一步把 `worker_threads` / `child_process` 等新执行上下文显式归入强制 OS sandbox contract，并用 fresh-isolate Worker 直接尝试未列入父 allowlist 的文件/网络访问。实现候选已关闭直接 loader 与执行上下文归属歧义；macOS atomic exec、任意 shared-library closure、远端 distributed authority 和该最终 exact SHA 的三平台恶意矩阵仍未关闭。
- **Linux dynamic-native pathname loader closure candidate**：未发布源码候选把 Plugin 全树、Node runtime、system DSO 与 loader cache 逐文件 descriptor-pin、hash 并挂入只读 synthetic namespace；dynamic-only seccomp 拒绝 `recvmsg`/`recvmmsg` 的 `SCM_RIGHTS`、`pidfd_getfd`、`open_by_handle_at`、user/mount namespace 与 mount mutation syscall，并以 `clone3=ENOSYS` 保留 glibc classic-clone fallback、只允许 classic `clone` 的非 namespace flags。live 合同覆盖 approved `dlopen`、host/drop-in/proc/dev FD/nested tmpfs 拒绝和 admission 后替换仍执行 pinned bytes。该能力只声明 runtime pathname resolution closure，legacy/broad `sharedLibraryClosure=false`，明确排除匿名 JIT/custom loader。Windows DLL/delay-load/`LoadLibrary` 与 macOS `@rpath`/`dlopen`/dyld 仍为 NO-GO；本机无 bwrap，最终 clean exact-SHA Linux CI artifact 尚未形成，因此当前计数和完整产品 NO-GO 不变。
- 当前只验证 plain Node runtime；yao-pkg packed `process.execPath` 因未设置 `PKG_EXECPATH=PKG_INVOKE_NODEJS` 会 probe fail-closed，尚未支持。

## 已落地能力

### 1. 命令分发

- 命令注册以 `packages/cli/src/command-manifest.json` 为索引。
- 启动阶段只解析当前命令需要的模块，lazy dispatch 会保留 `--help`、命令过滤和别名行为。
- Windows 下 hook 输出清理、命令参数处理和 Node.js 22 JSON import 语法已完成兼容性修复。
- 当前顶层命令数保持 **175**，本轮主要是分发稳定性和启动路径修复，没有扩大命令面。

### 1.1 统一 Scheduler Kernel

- `contract.js` 规范 job、occurrence、authority、claim 与 history JSON；`store.js` 以 SQLite 版本表和 strict schema 管理 revision-CAS 更新、logical key 去重以及 owner/fence lease。
- `runtime.js` 只执行与 adapter kind 匹配的 occurrence。每次 execute 前重新读取 job/occurrence、验证 authority 与 snapshot，运行中续租，结算时继续要求同一 owner/fence，避免 stale worker 完成别人的 claim。
- Routine、Agenda 与 Cowork adapter 保留各自兼容存储作为定义/用户历史或恢复证据；统一 SQLite 不是把既有 JSONL 静默迁走，而是提供跨 driver 的调度权威与历史。
- `0.163.6` 的 Automation/Loop/monitor/GitHub 适配器已发布；`0.163.7` 进一步发布五域 migration journal 与受治理回滚。它们协调 legacy source 与 scheduler target 的权威切换，但不宣称跨独立存储/文件系统的单一原子事务。

### 2. 后台 Agent 与交互 attach

- `cc agent --bg` 启动独立 worker，并持久化状态、心跳、日志与 phase。
- 在干净 Git checkout 中，非 `stream-json` 后台运行默认创建 committed `HEAD` 的隔离 worktree；`--no-worktree` 是显式共享 checkout 的风险接受开关。
- `cc attach <id>` 在本地控制通道可用时支持发送 follow-up prompt、停止和查看状态；不可用时退化为日志跟随。
- 提问、审批和副作用确认写入 durable interaction journal，并绑定会话、回合、请求与操作指纹；重连或恢复后继续等待原问题，不会被错误降级为普通 idle 或重复执行。
- 控制通道优先使用本机 IPC；TCP 传输用于跨平台或 IPC 不可用的场景，仍需本地会话凭据握手。
- supervisor 对自杀 PID、死 PID 和孤儿 worker 有保护，停止操作不会误杀当前 CLI 或被 PID 复用的进程树。
- IDE 发起的隔离任务可由后台 Agent 持有 worktree，并持久化 owner/session、权限模式、资源预算、生命周期与有界副作用计数。
- team/batch 协作单元也持久化同一组有界治理字段，但不保存 prompt、argv、工具参数、输出或凭据；IDE 可以把它们显示为 managed collaboration record，却不能借此授予后台 attach/stop 等进程控制能力。

### 3. 执行安全

- `process-execution-broker` 统一前台、后台、IPC、hook、MCP、monitor、LSP、PTY 与插件 bin 的进程执行入口，跨平台 sandbox 与 credential agent 默认接入。
- 带策略的插件 bin 在 async/background 启动中继续携带钉住的执行身份；通用后台任务、CLI PTY 与桌面项目 PTY 进入同一套失败闭合的 Linux 文件系统/网络边界，不再存在“直接执行已隔离、后台或 PTY 旁路”的分叉。
- production `run_skill` 不会在 CLI 主进程 import `handler.js`，也不向 Skill 注入 MCP client、process broker 或 Node.js `child_process`。非隔离 handler 固定返回 `CC_SKILL_DIRECT_HANDLER_BLOCKED`；隔离 Skill 只获得与父级 ceiling 相交后的 `read_file`、`search_files`、`list_dir`。
- `capabilities: [shell-exec]` 当前只是历史 descriptor/template 元数据，不产生 runtime authority。无 production consumer 的 `skill-process-broker` façade 已删除，避免后续代码在没有完整进程树、可执行身份和宿主 dispose 证明时误接回休眠执行权限。
- CLI-Anything、CLI Pack 与 `init ai-*-creator` 仍可生成 legacy `handler.js` 供显式外部迁移/检查，但 production `run_skill` 不执行它们；这些模板中的 `processBroker` 调用不能作为当前可运行能力或安全边界证据。若未来恢复 handler 执行，必须重新通过 source/digest approval、可执行字节身份、OS process-tree ownership、fixed deadline、host-owned dispose 与三平台真实回归，不能复活已删除 façade。
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
- IDE `0.37.50` / `0.4.86` 只在插件升级结果为 `activated` 后重载 live session；capability widening 必须先展示新增能力并由用户显式批准，`rolled_back` 或不可读结果保持失败闭合。
- 两个 IDE 只读观察本地 Agent Team schema v6 与分布式 queue schema v1。takeover、managed checkpoint recovery 和 side-effect adjudication 必须携带精确 authority digest、lease/evidence fence，并通过解析出的 CLI 执行；文件监听与刷新只更新投影，不能绕开 CLI-owned compare-and-swap authority。
- IDE 还把 CLI-owned session graph 投影到 Sessions Workbench，并提供受 projection revision 约束的 resume/attach、可恢复 GitHub/Gitee/remote/manual delivery，以及绑定 session/workspace/repository/checkpoint/manifest digest 的 rewind/branch timeline。过期按钮与 projection 必须失败闭合。
- Open VSX 当前公开 `0.37.50`，JetBrains Marketplace 当前公开 `0.4.86`。双端新增 governed Automation Center，并继续通过真实三平台宿主、不可变制品、Marketplace listing 与精确 ARM64 聚合门。Microsoft VS Code Marketplace 与 JetBrains 作者签名仍未完成。
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
| Restore saga    | `packages/cli/src/lib/checkpoint-restore-saga.js`、`checkpoint-restore-recovery*.js`、`commands/checkpoint-restore-recovery.js`                  |
| 会话与资源预算  | `packages/cli/src/lib/session-*.js`、`session-resource-budget.js`、`session-host-runtime.js`                                                     |
| MCP 恢复        | `packages/cli/src/lib/mcp-call-recovery*.js`、`harness/mcp-client.js`                                                                            |
| MCP source 策略 | `packages/cli/src/lib/mcp-sandbox-policy.js`、`mcp-stdio-workspace-authority.js`、`runtime/mcp-config.js`                                        |
| Agent Team      | `packages/cli/src/lib/agent-team/`、`commands/team.js`、`commands/team-distributed.js`                                                           |
| Auto 安全分类   | `packages/cli/src/lib/auto-mode-safety-classifier.js`、`lib/auto-mode-safety-eval.js`、`commands/auto-mode.js`                                   |
| OTLP 出口       | `packages/cli/src/lib/otlp-exporter.js`、`lib/observability/otlp-exporter.js`                                                                    |
| 插件沙箱策略    | `packages/cli/src/lib/plugin-runtime/sandbox-policy.js`                                                                                          |
| 插件生命周期    | `packages/cli/src/lib/plugin-runtime/install.js`、`commands/plugin.js`                                                                           |
| 插件用量归因    | `packages/cli/src/lib/plugin-usage-attribution.js`、`lib/session-usage.js`                                                                       |
| 技能执行边界    | `packages/cli/src/lib/skill-loader.js`、`runtime/agent-core.js`                                                                                  |
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

`0.163.8` 的精确正式发布提交为 [`a0631cb4f97f45ff7fcef9c19d346ed2b8387da6`](https://github.com/chainlesschain/chainlesschain/commit/a0631cb4f97f45ff7fcef9c19d346ed2b8387da6)。该提交的 [CLI CI run 31804468633](https://github.com/chainlesschain/chainlesschain/actions/runs/31804468633)、[CLI Strict Sandbox run 31804468464](https://github.com/chainlesschain/chainlesschain/actions/runs/31804468464)、[npm publish run 31806101423](https://github.com/chainlesschain/chainlesschain/actions/runs/31806101423)与[独立公网回读 run 31807574517](https://github.com/chainlesschain/chainlesschain/actions/runs/31807574517)均成功；npm `latest` 已回读为 `0.163.8`，公开 tarball SHA-1 为 `655557b5c5b897b23a29975708abbf8d5cd31e88`，SHA-256 为 `862a0f450da013740a1c21d084233b002982b4b816f156e4949b6110eda80e12`。

后续版本仍必须在各自 final exact SHA 上重新完成权威门；`main@affafa7f0f` 的原生剪贴板图片源码增量与本地/PR 测试只能补充，不能继承 `v-npm-0-163-8` 的发布授权。

平台专项还应覆盖 Linux bubblewrap 的 fd 绑定、private mount topology、静态 ELF/架构/segment/栈校验、通用后台/PTY 强边界与网络隔离，以及 Windows `.cmd` 启动、AppContainer 目标句柄/策略摘要、后台 attach、停止自 PID 记录、hook 输出清理和进程树能力探测。P2-14 专项必须区分 `full` / `partial` / `none`，验证 crash recovery 在证据不足时进入 `recovery_required`；P2-16 专项必须分别覆盖单进程规模测试、真实跨进程短门和三平台长期 soak。Hooks 专项需覆盖 stdin `EPIPE` 的 status 0/2 协议、单一 CredentialTransport listener 与 teardown 后 FD 零增长。TCP attach 需要运行对应的 IPC/transport 回归测试。真实系统能力不可用时，测试必须明确跳过并由注入测试补齐，不得把权限拒绝伪装成功。
