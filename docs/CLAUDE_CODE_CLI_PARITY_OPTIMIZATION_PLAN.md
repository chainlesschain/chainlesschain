# ChainlessChain CLI 对照 Claude Code 优化计划

> 制定日期：2026-07-03  
> 对象：`packages/cli` Coding Agent 核心链路  
> 目标：从“功能覆盖广”提升为“高可靠、高安全、可扩展的 Coding Agent CLI”

## 1. 当前判断

ChainlessChain CLI 已具备会话恢复、Checkpoint、上下文压缩、MCP、Subagent、Worktree、Hooks、Permissions、Status Line、Loop 和结构化输出等主要能力。

> **基线校准（2026-07-03 逐项 grep 坐实，`packages/cli@0.162.148`）** —— 各 Phase 的真实起点不同，规划必须区分「从零建」「扩既有」「产品化」：
>
> | 领域               | 现状判定                                                                                                                                                                                                    | 关键实现                                                                                                   | 本计划性质                                   |
> | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
> | 沙箱               | **EXISTS**（仅 Docker 后端，无后端抽象，无 bwrap/seatbelt）                                                                                                                                                 | `lib/agent-sandbox.js`（`docker run --network none`）、`lib/sandbox-v2.js`（策略/配额监控，非 OS 隔离）    | 扩既有：抽 `SandboxBackend` + 原生后端       |
> | **LSP / 代码智能** | **ABSENT**（纯文本搜索 `search_files`，无任何 LSP）                                                                                                                                                         | `runtime/agent-core.js`                                                                                    | **从零建（本次起点）**                       |
> | 插件 / Marketplace | **PARTIAL**（manifest 只加载 `skills`，无 agents/hooks/mcp 组合，无 user/project/local scope）                                                                                                              | `harness/plugin-manager.js`、`lib/plugin-ecosystem.js`                                                     | 扩既有：统一多组件 manifest + scope          |
> | Agent Team         | **PARTIAL**（master-worker + worktree + cowork，无 lease / teammate 任务图）                                                                                                                                | `commands/agents.js`、`harness/worktree-isolator.js`、`lib/cowork/agent-group-runner.js`                   | 扩既有：加 lease 共享任务图                  |
> | Remote Control     | **EXISTS（健全）**                                                                                                                                                                                          | `harness/remote-session-*`、`gateways/remote-session-relay.js`、`cc serve --allow-remote`                  | **产品化，非新建**：补三端 UX + 断线序列校验 |
> | 异步 Hooks         | **PARTIAL**（`HookType.ASYNC` 存在但仍 inline await，无 `async:true` fire-and-forget、无 `asyncRewake`）                                                                                                    | `lib/hook-manager.js`、`lib/settings-hook-events.cjs`                                                      | 扩既有：真异步 + 失败唤醒                    |
> | 后台 Monitors      | **PARTIAL → 首付已落地**（Phase 3.3i：`PluginMonitorSupervisor` interval/longRunning + 去重/并发上限/超时/回收；剩 REPL 每轮 additionalContext 注入 + 事件驱动 monitor）                                    | `lib/plugin-monitor-supervisor.js`、`lib/plugin-runtime/monitors.js`、`harness/background-task-manager.js` | 扩既有                                       |
> | 可靠性评测 / OTel  | **ABSENT**（有 vitest + golden-transcript 测试基建，无任务成功率基准，无 OTel 依赖）                                                                                                                        | `harness/golden-transcript.js`                                                                             | 从零建                                       |
> | 编辑并发保护       | **DONE（read-freshness 守卫已落地）** —— 每会话记录 read/write 的 mtime，edit/write/edit_hashed 前若盘上 mtime 变新（外部并发改）则拒绝并要求重读；自身写回重设基线；未读文件不拦；`CC_EDIT_FRESHNESS=0` 关 | `runtime/agent-core.js` `_checkFileFreshness`                                                              | 补 mtime 新鲜度守卫 ✅                       |
> | 模型 fallback      | **DONE（跨 provider 已落地）** —— `provider:model` 条目跨厂商回退（换 provider+baseUrl+apiKey，从 BUILT_IN_PROVIDERS + apiKeyEnv 解析；缺 key 跳过不复用主 key，遵守 auth-hijack 铁律）                     | `runtime/fallback-model.js`                                                                                | 扩既有：跨 provider ✅                       |
>
> 校准结论：**Phase 5 (Remote Control) 是「产品化」而非「新建」**，工作量应下调、验收聚焦断线重连幂等与设备撤销；**Phase 2 (LSP) 是唯一完全空白且跨平台可在主力 Windows 机验证的项**，作为实施起点。

下一阶段不应继续以命令数量为主要目标，而应集中补强以下核心闭环：

1. OS 级沙箱与网络隔离。
2. 基于 LSP 的语义代码智能。
3. 统一的插件运行时和 Marketplace。
4. 从主从式 Subagent 升级为 Agent Team。
5. 可安全跨终端、浏览器和移动端接管的 Remote Control。
6. 异步 Hooks、后台 Monitors 和失败唤醒。
7. 以任务成功率为核心的可靠性评测体系。

## 1.5 实施进度总览（2026-07-04 更新）

> 每格状态基于真实落地代码 + 测试（非「已有同名命令」），Windows 主力机上凡可建、可测者皆已建。剩余项均为**物理/环境阻塞**（内核 OS 隔离、跨平台 toolchain、真机三端、活模型非确定性、Docker 沙箱），已逐项诚实标注阻塞原因。

| Phase | 主题            | 状态                     | Windows 已落地（可测）                                                                                                                                                                                                                                      | 剩余（环境阻塞原因）                                                                    |
| ----- | --------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1     | OS 沙箱 + 网络  | **核心落地，硬隔离阻塞** | 网络域策略判定 + SSRF 守卫 + **出口过滤代理**（把策略从判定变强制，跨平台免 root）+ **DNS 重绑定守卫**（解析后复检私网 IP + pin 连接）+ **文件系统路径策略硬化**（穿越/边界/symlink 逃逸，接 checkFilePermission）                                          | 内核级出口硬隔离（Seatbelt/bwrap netns/AppContainer）、沙箱内后台 Shell、跨平台隔离 E2E |
| 2     | LSP 代码智能    | **四期全落地**           | LSP client/manager + `cc code-intel` + 接入 agent 链 + 编辑后增量诊断 + **崩溃自动重启有界守卫**                                                                                                                                                            | Python/Go/Rust 真机验证、大仓启动/内存基准（需各语言 toolchain + 大仓）                 |
| 3     | 插件运行时      | **核心完备**             | 8/8 manifest 组件接真实 agent 链 + 安装生命周期 + 双 fail-closed gate + trust + 热加载 + monitor 每轮注入                                                                                                                                                   | remote-manifest source + 私有仓认证 + 离线 seed cache（网络/凭据耦合，niche defer）     |
| 4     | Agent Team      | **✅ 全闭合**            | lease+DAG + `cc team` 真执行 + 会话恢复 + worktree 隔离 + **预算 + 定向消息 + 生命周期 + `--agent --worktree`**                                                                                                                                             | —                                                                                       |
| 5     | Remote Control  | **服务端落地，设备阻塞** | RemoteCommandLedger（幂等/全序/撤销）+ **接进 `cc serve` 活 WS 路径**（execute/stream **及**真正的接管路径 remote-session prompt/approval/interrupt 均幂等；并发重发竞态已修）—— 客户端带 commandId 即生效                                                  | 三端客户端**发送** commandId 协议采纳 + 三端真 UX/同步 E2E + worktree 远程会话真机      |
| 6     | 异步 Hooks      | **✅ 全闭合**            | async hooks + auto-rewake + Stop/SubagentStart/ConfigChange/**SessionPause/Resume** + MCP 前缀钩子 + 无头支持                                                                                                                                               | —                                                                                       |
| 7     | 可靠性评测/OTel | **核心落地**             | eval 框架 + **10** 客观任务类别（SWE-bench 六类全覆盖：bug 修复/跨文件重构/测试补全/**构建失败修复**/**依赖升级**/安全修复 exploit-probe）+ TelemetryRecorder + agent-core 真埋点 + `--otlp` + **发布趋势报告/回归门** + **compaction 确定性 pin 事实保留** | 默认 auto-pin 策略（产品 UX 决策，待拍板）；活模型验未 pin 事实摘要保留率（非确定性）   |

**结论**：Phase 4、6 完全闭合；1、2、3、5、7 的**全部 Windows-doable 部分**已落地并测试，剩余项 100% 为不可在单台 Windows 机上完成的物理阻塞（其它 OS 内核 / 各语言 toolchain / 真机三端 / 活模型 / Docker）。

## 2. 实施原则

- 优先提升真实编码任务成功率，而不是增加外围命令。
- 所有新增能力必须接入真实 Agent 执行链，避免只提供治理状态机或展示接口。
- 安全边界必须由操作系统或独立执行环境强制，不依赖模型遵守提示词。
- 每个阶段都需要单元测试、集成测试、E2E 测试和故障恢复测试。
- 对标结论使用可验证的 parity matrix，不以“已有同名命令”判定完成。
- 保持 Windows、macOS、Linux/WSL2 的行为差异清晰可见，并采用明确的降级策略。

## 3. 分阶段计划

### Phase 1：OS 级 Agent 沙箱（P0）

> 状态：进行中。已完成分层 settings 策略合并、Agent 接入、bubblewrap 初版后端、Docker 能力失败关闭和针对性单测。**1.x 已落地（网络域名访问策略 + SSRF 守卫，2026-07-04）**：`lib/sandbox-network-policy.js` —— OS 级出口封禁属平台相关（proxy/seatbelt/bwrap），但**策略判定**是纯共享逻辑，独立可测：`extractHost`（URL / host:port / **IPv6 方括号归一** —— 修 `new URL()` `[::1]` 漏括号 SSRF 坑）+ `matchesDomain`（`*` / `*.example.com` 含 apex / 精确，防后缀欺骗）+ `isPrivateHost`（loopback/10/172.16-31/192.168/169.254/::1/fc00::/fe80::/云 metadata/IPv4-mapped）+ `evaluateNetworkAccess`（deny > 具体 allow > 私网守卫 > `*` allow > 默认拒 > 无表放行；裸 `*` 放行公网但**不含**内网/metadata；具体列白名单可覆盖私网守卫供 dev）。接进 `sandbox-v2.js` `checkNetworkPermission`（原仅精确串匹配，URL/`[::1]` 会漏）。14 策略单测 + 148 sandbox 测试全绿。**1.y 已落地（出口过滤代理——把策略从"判定"变"强制"，2026-07-04）**：`lib/sandbox-egress-proxy.js` `createEgressProxy(policy)` —— 本地转发代理，对**每个** HTTP 请求 + HTTPS `CONNECT` 隧道调 `evaluateNetworkAccess`，拒绝的 host 直接 403 / 关隧道（**上游零接触**），私网/metadata 即使 `*` allow 也拦（SSRF）。沙箱进程 `HTTP(S)_PROXY` 指向它，其 `curl/npm/pip/git/wget/fetch` 出口即被过滤。接进真执行链：`agent-sandbox.js` `executeSandboxedShell` 原**因无代理而 refuse** 域限网络，现收 `{egressProxy:{port}}` → Docker 注 `--add-host host.docker.internal:host-gateway` + `HTTP(S)_PROXY`（bwrap `--share-net` 用 127.0.0.1），无代理仍 fail-closed；`agent-core.js` run_shell 在策略限域时**起代理→跑→拆**，代理起不来则 fail-closed。**跨平台（Windows 可验、免 root）**，属**代理层**控制非内核——忽略 proxy env 的工具仍需 OS netns 隔离（诚实标注）。6 socket 级集成测试（真 allow/deny/SSRF/上游往返）+ 2 arg-wiring 单测。**1.z 已落地（DNS 重绑定/解析后 SSRF 守卫，2026-07-05）**：域策略按**名字**判定，但公网样子的名字可**解析**到私网/metadata IP（`rebind.evil.com → 127.0.0.1`/`169.254.169.254`），名字检查永远看不见——经典 DNS 重绑定绕过（验收明列「DNS 重绑定有安全测试」）。`sandbox-egress-proxy.js`：名字通过 wildcard/permissive allow 后，`guardResolvedTarget` 用 `dns.lookup(host,{all:true})` **解析并逐 IP 复检** `isPrivateHost`，任一私网即 403（`allowPrivate` 可放行 dev），**解析失败 fail-closed**（无法核实即拒），成功则把连接**pin 到已核实的 IP**（防 check→connect 之间二次解析重绑定 TOCTOU）。`specific`（用户点名 vet 的精确/子域 allow）**豁免**——`sandbox-network-policy.js` `evaluateNetworkAccess` 加 `specific:true` 标记，故有意的内网名单仍工作，只有 `*`/permissive 才复检解析 IP。注入 resolver 确定性可测（无真 DNS）。`opts.checkDnsRebinding:false` 逃生门。7 集成测试（loopback/metadata 重绑定拒 CONNECT+HTTP、多记录任一私网即拒、fail-closed、specific 豁免不解析、resolve+pin 转发、guard 关不解析）+1 policy 单测（specific 标记）。**1.w 已落地（沙箱文件系统路径策略硬化，2026-07-05）**：`sandbox-v2.js` `checkFilePermission`（接在 `executeSandbox`/`enforcePermission` 真链）原用裸 `filePath.startsWith(root)` 判 allowRead/allowWrite/deny——放三类绕过：**路径穿越**（`/tmp/../etc/passwd` startsWith `/tmp` 却解析到 `/etc`）、**边界混淆**（`/tmpfoo` startsWith `/tmp` 却是别的树）、**符号链接逃逸**（allow 目录里的 link 指向外面）。新建 `sandbox-fs-policy.js` `evaluatePathAccess(target,{mode,policy,cwd,realpath})`（网络策略的文件系统孪生）：先 `path.resolve` 收 `..`、用 `path.relative` 判真边界（非子串）、resolveReal 解析**最长存在祖先**的 symlink 再拼未存在尾（新建写目标也防经 symlink 父目录逃逸）、deny>allow>default-deny（空 allow=拒，与原语义一致）；roots 同样归一化保可比。跨平台（Windows 盘符/分隔符经 path.relative 正确）。`checkFilePermission` 委托之（`fs.realpathSync` 真解 symlink）。13 单测（三绕过各拒 + 边界 + 注入 realpath symlink 逃逸 + 真盘 symlink 逃逸[Win 无权限跳过] + 精度/默认）+ 1 sandbox-v2 集成（穿越经 enforcePermission 真拒）；既有 80 sandbox-v2 测全绿（合法路径不变）。**1.v 已落地（后台 Shell 孤儿进程回收——信号退出路径硬化，2026-07-05）**：验收明列「取消、超时和**孤儿进程回收**」；普通模式后台 Shell 早已有 `killAllBackgroundShellTasks`（REPL `rl.on('close')` + 无头 `finally` 调用）+ 空闲内存压力回收，但**信号退出漏网**——`Ctrl-C`(SIGINT)/SIGTERM 令 Node **不展开 `finally`** 即终止，那个 reaper 被绕过，无头 `cc agent -p` 里 backgrounded 的 `npm run dev` 变**孤儿**存活；且 async `spawn`/`taskkill` 在终止瞬间会被切断（异步回收在信号路径根本跑不完）。新增**同步** reaper `killAllBackgroundShellTasksSync`（POSIX `process.kill(-pid,'SIGKILL')` 进程组、Windows `spawnSync('taskkill /T /F')`——均同步、可安全用于 exit/signal handler）+ 首个后台任务时**惰性装一次** `process.once('exit')` 网（覆盖任何显式 `process.exit()`：serve 关停、无头信号 handler），+ 无头 `runAgentHeadless` 装**作用域内** SIGINT/SIGTERM handler（同步回收 + 停 async-hook supervisor + `process.exit(130/143)`，`finally` 里 removeListener 防泄漏/防重入误退）。无头无竞争信号属主（不像 REPL 的 raw-mode keypress）故不抢占。3 单测（真 spawn：同步杀整树 / 无任务返 0 / exit 网只装一次幂等，既有 16 后台测全绿证默认路径不变）。**1.u 已落地（出口代理 CONNECT 的 IPv6 host:port 解析修复，2026-07-06，bugfix）**：`sandbox-egress-proxy.js` 的 HTTPS `CONNECT` handler 用裸 `req.url.split(":")` 拆 `host:port` —— 对 IPv6 字面量（`[2001:db8::1]:8443`）**双重错**：host 变 `"[2001"`、port 因 `parseInt("db8")=NaN` 静默退回 **443**，故即便连接已 pin 到已核实 IP，**端口也连错**（非 443 的 IPv6 目标全部打到 443）。新 `parseConnectTarget()` 正确处理 括号 IPv6（带/不带端口）、裸 IPv6 字面量、`name[:port]` 三形态，port 越界/非数字才退 443。HTTP 路径本就用 `new URL()`（IPv6 正确）故只改 CONNECT。common `name:port` 路径逐字节等价（`lastIndexOf(":")` 与 split 同解）。真机 node 复现旧解析 host=`[2001`/port=443 → 修后 host=`2001:db8::1`/port=8443。6 解析单测 + 既有 13 egress + 98 network-policy/sandbox-v2 全绿。**待完成**：内核级出口硬隔离（macOS Seatbelt / Linux bwrap netns egress / Windows AppContainer——平台相关，需 Linux/macOS 或研究级）、**沙箱内**后台 Shell（普通模式后台 Shell 已 EXISTS 且信号退出已硬化[1.v]，但沙箱模式显式拒绝后台任务，容器内 detached exec+轮询需 Docker/bwrap，平台阻塞）、跨平台真隔离 E2E。

#### 目标

将当前主要基于 Docker 的 `cc agent --sandbox` 扩展为原生 OS 沙箱，统一控制 Shell 子进程的文件系统和网络访问。

#### 工作项

- 增加沙箱后端抽象：
  - macOS：Seatbelt。
  - Linux/WSL2：bubblewrap。
  - Docker：兼容和 fallback 后端。
  - Native Windows：明确标记能力范围，优先研究 AppContainer 或受限令牌方案。
- 支持配置：
  - `sandbox.filesystem.allowRead`
  - `sandbox.filesystem.denyRead`
  - `sandbox.filesystem.allowWrite`
  - `sandbox.filesystem.denyWrite`
  - `sandbox.network.allowedDomains`
  - `sandbox.network.deniedDomains`
  - `sandbox.excludedCommands`
  - `sandbox.allowUnsandboxedCommands`
  - `sandbox.failIfUnavailable`
- 增加网络代理出口和域名级访问控制。
- 将权限规则与沙箱路径规则合并为统一的有效策略。
- 支持沙箱内后台 Shell、取消、超时和孤儿进程回收。
- 沙箱不可用时明确提示实际执行模式，禁止静默降级。

#### 验收标准

- Shell 及其所有子进程不能越权读写受限路径。
- 未授权域名无法通过 curl、npm、pip 或自定义程序访问。
- macOS、Linux、WSL2 均有真实隔离 E2E 测试。
- `failIfUnavailable=true` 时无法建立沙箱必须拒绝执行。
- 沙箱逃逸、符号链接、路径穿越和 DNS 重绑定有安全测试。

### Phase 2：LSP 语义代码智能（P0）

> 状态：一期 + 二期均已落地（2026-07-03）。**一期** `packages/cli/src/lib/lsp/`（jsonrpc-stream / lsp-client / lsp-server-registry / lsp-manager / code-intelligence）+ `cc code-intel` 命令（status/def/refs/hover/symbols/wsymbols/diag/rename）+ 单测 + 真实 `typescript-language-server` 集成测试（无 server 时 skip）。已对真实 TS 项目验证：跨文件 def / 全量 refs / TS 诊断 / rename 预览全部工作。零新增运行时依赖（探测 PATH/node_modules）。**二期** `code_intelligence` 已接入真实 Agent 执行链：契约 `coding-agent-contract-shared.cjs`（tier:extension，单 `action` 判别 7 子命令）+ 策略元数据 `coding-agent-policy.cjs`（readonly / plan-mode 可用）+ `agent-core.js` `executeToolInner` case（先验参再查，无 server 优雅降级）+ 系统提示引导（改符号前查引用、改后查诊断）+ 空闲 60s 自释放的 server 池（`_getSharedCodeIntel` / `disposeSharedCodeIntel`，防 orphaned 进程/悬挂 timer 泄漏）+ `formatToolArgs` 显示 + checkpoint readonly 归类。默认工具数 20→21，5 处计数断言同步。真机 `executeTool` 实测 references(4)/diagnostics(TS2322)/definition 通过，dispose 干净退出；新增 `agent-core-code-intel.test.js`（校验/降级/格式 + skip-guarded live）。**三期** 编辑后自动增量诊断回喂已落地：`write_file`/`edit_file`/`edit_file_hashed` 成功后经 `_postEditDiagnostics` 给结果附 `newDiagnostics`（error+warning，≤20），agent 同轮即见自己引入的错误。零成本当无 server（先 `resolveServer` 探测不冷启不存在的 server）+ 全程限时（6s 墙钟 cap + 3s 诊断超时，仅首编辑付冷启动税）+ 复用 idle server 池 + `CC_EDIT_DIAGNOSTICS=0` 可关；系统提示已加「见 newDiagnostics 先修再继续」。真机验证：编辑引入未声明名 → TS2304 附到 edit_file 结果。**四期 已落地（崩溃自动重启的有界守卫，2026-07-04）**：`lsp-manager.js` 原已惰性重启（`ensureFor` 见 `!client.running` 即下次请求重 spawn），但「restart once」是**文档谎言**——`restarts` 字段是死代码从不自增/检查，启动即崩的 server 会**每请求 thrash 重 spawn**（每次重新索引项目）。现真做守卫：per-(root,serverId) key 的 `_crashLog` 记崩溃时戳（跨 entry 重建存活），滑动窗 `restartWindowMs`（默认 30s）内崩 `maxRestarts`（默认 3）次即**隔离**——`ensureFor` 返 `{unavailable:true,quarantined:true,reason}` 让调用方降级文本搜索而非 thrash；窗口过后（无新崩溃）历史 prune，重新允许 fresh start（非永久隔离）。注入时钟确定性。3 新单测（崩溃后下次请求真重 spawn / 超阈崩溃循环隔离不再 spawn / 窗口清后恢复）。**五期 多语言真机验证（Python 已验，2026-07-05）**：Python/pyright 真机验证通过、**零代码改动**（证明 registry-driven 架构语言无关；`npm i pyright` 纯 npm 无需解释器）——def 跨文件 `main.py`→`mathlib.py` / refs 3 处 / diag `reportUndefinedVariable` / symbols 全通；独立复验三个 Windows 坑（`.cmd` spawn / 盘符归一 / 冷启 readiness）对 pyright 亦成立，pyright 同样不支持 pull 诊断走 push+settle。**六期 查询耗时基准（已落地 2026-07-05）**：新增 `cc code-intel bench <file>` 子命令（`src/lib/lsp/benchmark.js` 纯统计 helper `percentile`/`summarize`/`sumSubtreeRss` + 12 单测）——量测**冷启动**（spawn+索引+首查）、**warm 每查询延迟**（document_symbols/definition/references/hover/diagnostics 各 N 次取 min/median/p95/max）、**server RSS**（Windows 求进程子树和，避开 `.cmd` 经 cmd.exe 启动只测到 launcher 的 5MB 假象）。真机基线：**小项目**（2 文件）冷启 4.2s / RSS 406MB / warm def 14ms·refs 9ms·hover 7ms·diag 59ms（median）；**大仓 desktop-app-vue（1083 TS/Vue 文件）** 冷启 8.9s / RSS 561MB / warm def 116ms·refs 255ms（p95 512ms，跨文件引用最重）·hover 213ms·diag 61ms·document_symbols 35ms（median）——warm 查询全部亚秒，随项目规模上升但可用。**待完成**：Go(gopls)/Rust(rust-analyzer)/Java(jdtls) 真机验证（重 toolchain，环境阻塞）。

#### 目标

让 Agent 使用定义、引用、符号和诊断信息完成代码理解与修改，降低纯文本搜索造成的误改。

#### 工作项

- 建立统一 `code_intelligence` 服务和工具接口。
- 支持：
  - Go to definition
  - Find references
  - Hover/type information
  - Workspace/document symbols
  - Diagnostics
  - Rename preview
- 首批支持 TypeScript/JavaScript、Python、Java、Go、Rust。
- 自动识别项目根、语言和可用 Language Server。
- 管理 Language Server 的启动、复用、超时、崩溃恢复和关闭。
- 编辑后执行增量诊断并将相关错误回喂 Agent。
- 通过插件 `.lsp.json` 注册额外语言服务器。
- 在无 LSP 时明确降级到搜索工具。

#### 验收标准

- Agent 能基于符号引用完成跨文件安全重命名。
- 修改后新增诊断能够在同一 Agent 轮次被发现。
- LSP 崩溃不导致会话退出，且可自动恢复一次。
- 大型仓库有启动延迟、内存和查询耗时基准。

#### 实施设计（可执行，2026-07-03 细化）

模块落在 `packages/cli/src/lib/lsp/`（ESM，遵循 `_deps` 注入以便单测），命令 `cc code-intel`，Agent 工具 `code_intelligence` 二期接入 `runtime/agent-core.js`。

| 文件                         | 职责                                                                                                                                                                                              | 可单测            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `lsp/jsonrpc-stream.js`      | LSP 传输层：`Content-Length` 分帧编解码器（增量喂字节 → 完整消息），纯函数无 IO                                                                                                                   | ✅ 纯             |
| `lsp/lsp-client.js`          | 单个 language server：`spawn` stdio、initialize 握手、request/notify 关联（id→Promise）、通知分发、超时、`shutdown`/`exit`、进程 `error`/`exit` 事件                                              | ✅ mock child     |
| `lsp/lsp-server-registry.js` | 语言 ↔ server 命令映射 + 可用性探测（TS/JS→`typescript-language-server --stdio`；Python→`pyright-langserver`/`pylsp`；Go→`gopls`；Rust→`rust-analyzer`），插件 `.lsp.json` 注册额外 server        | ✅ 纯（探测注入） |
| `lsp/lsp-manager.js`         | 生命周期池：按 `(projectRoot, languageId)` 懒启动 + 复用 server、`didOpen`/`didChange` 文档同步、0-based LSP ↔ 1-based 用户位置换算、崩溃自动重启一次、全部关闭                                   | ✅ mock client    |
| `lsp/code-intelligence.js`   | 高层服务 API：`definition` / `references` / `hover` / `documentSymbols` / `workspaceSymbols` / `diagnostics` / `rename`（预览）；结果归一化为 `{file,line,col,snippet}`；无 server 时明确降级信号 | ✅ mock manager   |
| `commands/codeintel.js`      | `cc code-intel <sub> …`，端到端验证（不触 agent-core）                                                                                                                                            | ✅                |

关键约束：

- **零新增运行时依赖**：传输层纯 Node `child_process`，不把 `typescript-language-server` 列入 cli deps（重）。改为**探测** PATH / `node_modules/.bin` / npx，缺失即按 §"无 LSP 时明确降级到搜索工具"降级，并在 `cc doctor` 报告可用 server。这满足 undeclared-deps gate。
- **跨平台 spawn 编码**：子进程 stdout 显式按 UTF-8 解码（`.claude/rules/encoding.md`），Windows 下 `.cmd`/`.bat` server 用 `shell:false` + 解析 `.bin` 全路径避免 GBK 与命令注入。
- **位置协议**：LSP 用 0-based `line/character`（UTF-16 code unit），CLI 面向用户用 1-based `line/col`，换算集中在 manager 一处。

**二期（接入真实 Agent 执行链）**：新增 `code_intelligence` agent 工具 —— 触碰 5 处（`coding-agent-policy.cjs` metadata → `coding-agent-contract-shared.cjs` 定义 → `agent-core.js` `executeToolInner` case → 工具数断言 5 处 → readonly 权限归类）。系统提示引导：改代码前先 `code_intelligence` 查引用/定义，降低纯文本误改；编辑后回喂增量诊断。

**验证**：`jsonrpc-stream` + `lsp-client`（mock server）+ `code-intelligence`（mock manager）单测；集成测试若检测到 `typescript-language-server` 则对本仓真实取定义/引用，否则 `skip`（不假绿）。

### Phase 3：统一插件运行时和 Marketplace（P0）

> 状态：进行中。**基线**（survey 坐实）：仓内三套互不相通的「plugin」子系统 —— A `harness/plugin-manager.js`（真实、DB 支撑、**仅 skills**，经 `<userData>/marketplace/skills/`→skill-loader 到 agent）、B `plugin-autodiscovery.js`（有 tools/hooks/commands 提取但**完全未接线**）、C `plugin-ecosystem.js`/`skill-marketplace.js`（记账态机+桩）。真实安全在 `plugin-security.js`（SHA-256+Ed25519+managed allow/deny+`_isWithin`），复用不重写。
>
> **3.1 已落地（统一 manifest 骨架）**：`lib/plugin-runtime/manifest.js` 解析归一化统一布局（skills/agents/hooks/.mcp.json/.lsp.json/monitors/bin/settings，显式字段或约定发现，显式优先），逐路径 `isWithin` 防穿越（`../`/绝对路径拒绝），永不抛、收集 errors/warnings；`lib/plugin-runtime/scopes.js` user/project/local 三 scope（local>project>user）+ 不可变 `<name>/<version>/` 版本目录 + `.active` pin + `discoverPlugins()`；`cc plugin validate <dir>` 真检视命令（列组件+防穿越+可选签名校验，非法 exit 1）。25 单测。
>
> **3.2 已落地（首个组件接入真实 agent 链）**：`lib/plugin-runtime/lsp.js` `ensurePluginLspServers()` 把插件 `.lsp.json` 经 Phase 2 `registerLanguageServer` 注册进 LSP registry，`code_intelligence` 工具与 `cc code-intel` 透明获得该语言的定义/引用/诊断 —— 新语言零核心改动。接在 `CodeIntelligence` 构造 + `cc code-intel status` 两处，按 root memoize、坏 manifest 不抛。真机验证：project-scope 插件声明 `toml`/taplo → `cc code-intel status` 列出、`.toml` 成识别扩展。12 单测。
>
> **3.3b 已落地（Skills 组件接入 agent 链）**：`lib/plugin-runtime/skills.js` `discoverPluginSkillLayers()` 把各安装插件的 `skills/` dir（仅 manifest 校验通过者）作为 skill-loader 的 `"plugin"` 层（介于 marketplace 与 managed，用户 managed/workspace/project 技能仍覆盖），一插件一层，best-effort 不破坏加载。真机验证：project-scope 插件的 `skills/hello-plugin/SKILL.md` → `cc skill list` 带 `[plugin]` 标显示，直接从不可变版本目录加载不拷贝。
>
> **3.3c 已落地（Hooks 组件接入 agent 生命周期）**：`lib/plugin-runtime/hooks.js` `mergePluginHooks()` 把各插件 `hooks/hooks.json` 叠加进有效 settings-hook map（只加不替换，仅 manifest 校验通过者），接在 `headless-runner` + `agent-repl` 两处 hook 加载点。LLM-free e2e：插件 SessionStart hook 经真 hook-runner spawn，stdout 注入 additionalContext。**安全 follow-up**：插件 hook 跑 shell 尚未在加载时强制验签 / trust-gate（属后续安全硬化）。
>
> **验收标准进度**：一个插件同时注册 6 组件类型已全部打通 **6/6**（✅ LSP / ✅ Skill / ✅ Hook / ✅ MCP / ✅ Agent / ✅ Monitor）—— 每个都经真实 CLI 端到端验证接入真实 agent 链。
>
> **3.3d 已落地（安装生命周期，让系统可用）**：`lib/plugin-runtime/install.js` + `cc plugin add/installed/uninstall/use`。从本地目录校验+拷进不可变 `<scope>/<name>/<version>/` 版本目录、标 active，支持整插件/单版本卸载、`.active` rollback；拷贝跳 symlink、绝不写出目标外；重装需 `--force`。git/GitHub source 识别但 defer。真机端到端：`cc plugin add <dir>` → `installed` → bundled skill 现于 `cc skill list [plugin]` + `.lsp.json` server 现于 `cc code-intel status`（安装到 agent 全链路），uninstall 往返 skill 消失。
>
> **3.3e 已落地（git/GitHub source 拉取）**：`cc plugin add` 现支持 git URL（https/git@/`.git`/`file://`）+ GitHub `owner/repo` + `#ref`。shallow clone→安装→清理；git 经无-shell spawn（url/ref 是 argv，无注入）；commit-SHA ref 退回 full clone+checkout。真机端到端：`cc plugin add file://<repo>` 克隆装 from-git → skill 现于 `cc skill list [plugin]`。
>
> **3.3f 已落地（安全：trust-gate 代码组件）**：插件 hook（跑 shell）/ LSP（spawn 二进制）不再因在盘上就执行。user/local scope 信任（本机装的）、project scope 不信任直到 `cc plugin trust <name>`（按版本 pin）。`lib/plugin-runtime/trust.js` + gate `ensurePluginLspServers`/`collectPluginHooks`；声明式组件（skill/mcp/settings）不受影响。真机 e2e：project 插件 `.lsp.json` [untrusted] 时 server 不现于 `cc code-intel status`，`trust` 后现。
>
> **3.3g 已落地（MCP 组件接入 agent 链）**：`lib/plugin-runtime/mcp.js` `collectPluginMcpServers()` 收集受信插件 `.mcp.json` 的 `mcpServers`，`runtime/mcp-config.js` `loadPluginMcp()` 连接、`resolveAgentMcp()` 默认调用（在 registered+project 之后，二者 name 冲突时胜出；`pluginMcp:false`/`--strict-mcp-config` 跳过）。**安全**：MCP stdio server spawn 命令 → 与 hooks/LSP 同样 trust-gate（不同于 opt-in 的 project `.mcp.json`，插件 MCP 默认加载，因 install+trust 即显式同意）。真机端到端（真 spawn stdio MCP server）：untrusted project 插件被 skip 无连接，`cc plugin trust` 后 server spawn、JSON-RPC 握手完成、其 `echo` tool 进入 agent 工具面。22 单测。
>
> **3.3h 已落地（Agent 子代理接入发现）**：`lib/plugin-runtime/agents.js` `discoverPluginAgentLayers()` 把各受信插件 `agents/` dir 以**最低优先级**并入 `lib/agents.js` `agentDirs()`（用户自有 project/personal 同名 agent 覆盖之，不重复）；`includePlugins:false` 可关。**不 trust-gate**：agent 定义是声明式（system prompt + 工具 allow-list 只缩不扩），仅用户按名 `cc agents run` 调用、绝不启动即执行（同 skill；code-bearing 组件 hooks/LSP/MCP 仍 gate）。真机端到端：local 插件 `agents/haiku-reviewer.md` 现于 `cc agents list [plugin]` 带 tools+model，`cc agents show` 从不可变版本目录解析完整 system prompt。23 测试。
>
> **3.3i 已落地（Monitor 后台监控 —— 第 6 组件 + Phase 6 首付）**：`lib/plugin-runtime/monitors.js` `collectPluginMonitors()` + `lib/plugin-monitor-supervisor.js` `PluginMonitorSupervisor`。两模式：`interval`（按 cadence 重跑命令、逐次捕获）/ `longRunning`（spawn 一次保活流式输出）。结构化输出 `drainOutputs()` 供下一轮注入 additionalContext（Phase 6）。护栏：id 去重、`maxConcurrent` 并发上限、per-run 超时 kill、`stopAll()`+`process.once('exit')` 回收（会话结束无遗留进程）。接在 agent-repl 启动 start / SessionEnd cleanup 回收。新 `cc plugin monitors [--run --seconds N]` 列出+运行+回收验证。**安全**：monitor spawn 命令 → trust-gate（同 hooks/LSP/MCP）；shell:false argv 无注入。真机端到端：local 插件 interval monitor 3× 重跑（不同 PID）+ longRunning 流式（10 行捕获）后干净回收；untrusted project 副本被 skip，`trust` 后现。29 单测（14 新）。
>
> **3.3j 已落地（管理策略加载时强制 org allow/deny）**：`lib/plugin-runtime/policy.js` 把 `plugin-security.js` `enforcePluginPolicy`（name allow/deny）接进 `discoverPlugins`——6 组件唯一 chokepoint——denied/非 allowlist 插件加载 0 组件。fail-closed（malformed managed-settings 抛错不降级），per-plugin 非抛（一坏不断全部），memoize 加载，一次性 stderr 警告，`skipPolicy:true` 管理视图逃逸；无 managed file 零过滤。真机 e2e：`CC_MANAGED_SETTINGS`→`{deniedPlugins}` 令其 skill 从 `cc skill list` 消失。18 单测。
> **3.3k 已落地（`cc plugin upgrade` + 管理可见 listInstalled）**：`updatePlugin(source)` 经共享 `_withMaterializedSource` 单次 fetch（本地 dir/git）读 name+version→装新版（repoint `.active`，旧版留盘供 `cc plugin use` 回滚）或已最新则 no-op（`--force` 重装）。新 `cc plugin upgrade <source>`（区别于 legacy DB-backed `plugin update <name> <version>`）。`listInstalled` 改 `skipPolicy:true`——org 策略 block 加载的插件仍须在管理视图可见以便查/卸/解禁。真机 e2e：装 v1→upgrade v2（active 切、v1 留）→重 upgrade no-op→`use` 回滚 v1→卸载删两版。21 install 单测（4 新）。
> **3.3l 已落地（`requireSignedPlugins` 加载时验签 + 签名安装）**：签名从 add/validate-only 检查升为 fail-closed 加载 gate（“无效签名必须失败关闭”）。`lib/plugin-runtime/signature.js` 安装时把验签结果（manifest sha256 + 签名 key 指纹 + signatureVerified）写进不可变版本目录 `.plugin-lock.json`；`verifyInstalledSignature()` 加载时**重算** on-disk manifest sha 对比（装后篡改必败）+ 可选 `trustedPluginKeySha256` allowlist。`installFromDirectory` 收 `opts.signature`（verifyPluginManifest 抛错→坏签名绝不落盘），`cc plugin add` 加 `--sha256/--signature/--public-key` 显示 `✔ signed`。`policy.js` 在 managed `requireSignedPlugins` 时于 chokepoint drop 无有效锁的插件（覆盖 6 组件）。**局限**（signature.js 注明）：签名只覆 manifest 文件非全组件文件——完整性锚+篡改检测，非完整供应链封印。真机 e2e：真 Ed25519 签名 add→`✔ signed` 写锁；`{requireSignedPlugins:true}` 令无签名插件 skill 被 block（“no signature lock”）而签名者存活；装后篡改 manifest 的签名安装抛错留空盘。9 签名单测。
>
> **3.3m 已落地（`/reload-plugins` 热加载）**：`lib/plugin-runtime/reload.js` `reloadPluginRuntime()` reset 各模块 memo（`_resetPluginServers`/`_resetPluginLspLoadState`/`_resetPolicyCache`/`_resetPolicyWarnings`/`_resetTrustWarnings`）+ 强制重注册 LSP + 回各组件计数摘要。REPL `/reload-plugins` 另加 live-session 面：重 merge hook map + 用新集重启 monitor supervisor + 重应用 bin/settings（新信任插件即时生效）；已连 MCP 本会话不变（新增下会话生效）。注册进 completer + /help。验证：装后再 reload 的插件 LSP server 注册进 probeServers——证明无需重启。3 单测。
> **3.3n 已落地（bin 可执行文件接入 PATH）**：`lib/plugin-runtime/bin.js` `collectPluginBinDirs()`（trust-gate——PATH 上可执行=跑代码，同 hooks/LSP/MCP/monitors）+ `applyPluginBinPath()` 把受信插件 `bin/` dir 前插 `env.PATH` 返回 `restore()`（会话作用域：已在 PATH 不重加，不覆盖系统命令）。接 agent-repl 启动 apply / SessionEnd restore / `/reload-plugins` 重应用 + headless-runner（run 后进程退出无需 restore）。真机集成：装 `bin/ccbintest.cmd` 后 `where` apply 前 not-found→apply 后解析到不可变版本目录→按名 **RUN**（`CCBINTEST_RAN`，子进程继承 env）→restore 后 not-found。6 单测。
> **3.3o 已落地（settings 默认配置，安全收窄 + trust-gate）**：`lib/plugin-runtime/settings.js` `collectPluginSettings()` 只读**安全子集** `env`+`model`——permissions/hooks/mcp/其余**一律忽略**，插件绝不能经 settings 扩权限包络。`applyPluginSettingsEnv()` 仅对用户/系统**未设**的 env key 设默认（用户永胜）+ 会话作用域 restore。trust-gate（env 可影响工具行为）。接 agent-repl（启动 apply/SessionEnd restore/reload 重应用）+ headless-runner。真机集成：`{env,model,permissions:{allow:[run_shell]}}` 只收 env+model（permissions **不**采集）、env 默认到达子进程（`hello-from-plugin`）、restore 清除、用户已设 key 不覆盖。5 单测。**→ 8/8 manifest 组件（skills/agents/hooks/mcp/lsp/monitors/bin/settings）全接入真实 agent 链。**
>
> **3.3p 已落地（Monitor 输出接入 REPL 每轮注入 —— Phase 6 闭合）**：`agent-repl.js` 每轮构建 userContent 时 `_pluginMonitors.drainOutputs()`（UserPromptSubmit hook 之后），把受信插件 monitor 自上轮以来的新输出作为 `[plugin monitors — new output since last turn]` 附入（末 40 行 + 省略计数），agent 同轮即见后台状态变化。SessionEnd `stopAll()` + `process.once('exit')` 回收，会话结束无遗留 monitor 进程。
>
> **3.4 已落地（远程 registry/manifest source + 私有仓认证 + 离线 seed cache，2026-07-05）**：`lib/plugin-runtime/remote-source.js` —— `cc plugin add` 现接受**远程 registry/manifest URL**（`https?://….json`）。两种形状：多插件索引（`{plugins:[{name,source,ref,version,sha256,description}]}`，按 `--name` 选）或单插件 manifest（顶层 `source`）。**远程层是纯 INDIRECTION**：把 name → git source 串（`source#ref`）交给既有 `installFromSource` clone，**不碰同步 install 核心、不引 tar 解包器**。**离线 seed cache**：拉到的 registry JSON 按 URL sha256 内容寻址缓存（`<userData>/plugin-registry-cache/`），网络/HTTP 失败自动回退缓存（`fromCache` 标记 + 可见 warning），离线仍可 browse/装曾见过的 registry。**私有仓认证**：Bearer token 从 `--token` / `CC_PLUGIN_REGISTRY_TOKEN` env / `config.plugins.registryTokens[host]` 三级解析。entry `sha256` 顺带成安装完整性校验（复用 `--sha256` 签名路径）。新 `cc plugin browse [query] --registry <url>` 发现命令（列/过滤远程插件）。18 单测（注入 fetch+fs：形状校验/单插件包装/按名选/离线回退/HTTP 错/auth 头/token 三级/内容寻址）+ **真机 E2E**（本地 HTTP registry → `browse` 列出 → `add toml-tools --registry <url> --scope local` 拉 git → 装 → 插件 skill 现于 `cc skill list [plugin]`；停服 → `browse` 回退缓存；auth server 无 token→401 干净报错、`--token`→成功）。**局限**：仅 git-indirection artifact（tarball 直载 defer，git 覆盖主场景）；registry URL 用户显式指定故不设 SSRF 私网封禁（私有内网 registry 是正当用例）。**待完成**：tarball artifact 直载（niche）。**Phase 3 全部工作项 + 4 条验收全落地**（8/8 组件 + 安装生命周期 add/upgrade/uninstall/rollback + **本地/git/GitHub/远程 registry 四类 source** + 两道 fail-closed 加载 gate org-policy/requireSignedPlugins + trust 模型 + 热加载 + monitor 每轮注入 + 私有仓认证 + 离线缓存）。

#### 目标

将插件升级为能够组合 Skills、Agents、Hooks、MCP、LSP、Monitors、可执行文件和默认配置的完整扩展单元。

#### 建议插件结构

```text
plugin/
├── .chainlesschain-plugin/plugin.json
├── skills/
├── agents/
├── hooks/hooks.json
├── .mcp.json
├── .lsp.json
├── monitors/monitors.json
├── bin/
└── settings.json
```

#### 工作项

- 支持 `user`、`project`、`local` 三种安装 scope。
- 提供 Marketplace 的 add/list/update/remove/validate。
- 支持 GitHub、Git URL、本地目录和远程 manifest。
- 增加版本锁定、release channel、缓存、更新和回滚。
- 增加私有仓库认证和离线 seed cache。
- 保留签名校验，并增加路径越界、可执行文件和依赖审计。
- 实现 `/reload-plugins` 热加载。
- 支持组织级 Marketplace allowlist/denylist。
- 插件缓存使用不可变版本目录，避免运行中更新破坏现有会话。

#### 验收标准

- 一个插件可以同时注册 Skill、Agent、Hook、MCP、LSP 和 Monitor。
- Project scope 配置可随仓库共享，同时不提交用户凭据。
- 更新失败可继续使用最后一个有效版本。
- 恶意相对路径、损坏 manifest、无效签名必须失败关闭。

### Phase 4：Agent Team 与协作任务图（P1）

> 状态：**已闭合（2026-07-04）** —— 全部工作项 + 四条验收落地（4.1 lease+DAG / 4.2 `cc team` 真执行 / 4.3 会话恢复+worktree 隔离 / 4.4 预算+定向消息+生命周期+`--agent --worktree`）。**基线**（survey 坐实）：团队原语大多已存在但缺两样关键——`session-core` `SharedTaskList`（claim 明确「不互斥」、无 lease TTL、无 dependsOn/DAG）、`agent-coordinator.js` V2 生命周期/并发上限（in-memory 记账、**不在执行热路径**）、`harness/worktree-isolator.js`（per-teammate worktree + 冲突检测 + `previewWorktreeMerge` **已完备**）、`sub-agent-context.js` `SubAgentContext.run()`（真 claim→执行 seam，含 worktree 隔离）。
>
> **4.1 已落地（lease + DAG 核心）**：`lib/agent-team/task-lease.js` `TaskLeaseRegistry` —— **组合** 真 `SharedTaskList`（复用乐观锁/状态机/snapshot/终态守卫），叠加两项它缺的能力：**独占 lease + TTL**（同一任务同时至多一个 holder，valid 期内他人 acquire 被拒、过期可 steal；renew 心跳/release 归还——满足验收「多 Agent 不重复处理已 lease 的任务」）+ **崩溃回收** `reclaimExpired()`（过期 lease 扫回 PENDING 可重派，过期 stale holder 不能再 complete/renew——满足「teammate 崩溃后任务可回收重分配」）+ **依赖 DAG** `dependsOn`（deps 未全 COMPLETED 不可 acquire；加边即检环，自环/回边拒绝防死锁）+ fail 重试到上限转 CANCEL + snapshot/restore（团队会话恢复）。clock 注入 → lease 过期确定性可测。13 单测。
>
> **4.2 已落地（`cc team` 接真实执行）**：`lib/agent-team/team-runner.js` `TeamRunner` 驱动 N 个 teammate 并发 claim→acquire(独占)→run→complete/fail 循环（registry 的 lease+DAG 保证一任务至多一 teammate 跑、deps 完成才起；CANCELLED 任务的 dependent 永不跑）。`runTask` 注入（离线可测）；事件流（run:start/task:claimed/completed/failed/run:end）。`commands/team.js` `cc team plan`（拓扑波次预览）+ `cc team run`（默认 dry-run 校验+排程无副作用；`--exec` 真跑各 task shell `command`；`--agent` 把 `prompt` 交无头 `cc agent -p`；`--teammates N`/`--ttl`/`--json`；未全完 exit 1）。**真机端到端**（`--exec` 真 shell，3 teammate 跑菱形图）：build →（test-a ‖ test-b 并发 peak 2）→ deploy，每任务恰一次，exit 0。20 单测（13 registry + 7 runner）。新增顶层 `cc team` 命令（计数 162→163）。
>
> **4.3 已落地（会话恢复 + per-teammate worktree 隔离）**：`cc team run --state <file> --resume` —— 每任务 settle 后写 snapshot（崩溃可恢复），`--resume` 从 state 恢复图 + `reclaimExpired()` 释放崩溃残留 lease（COMPLETED 保持，未完重跑）。真机验证：跑完写 4 completed → resume「4/4 already done」0 执行、副作用不重现。`lib/agent-team/team-worktree.js` `TeamWorktreeCoordinator` —— 每 teammate 在**自己的 git worktree** 跑 task `command`（并行不争工作区），`integrate({merge})` **顺序** 逐 branch preview→合并干净者→冲突**报告不强合**（后一 branch 与已合并者冲突时被检出，满足「并行 Worktree 修改可预览冲突并安全合并」）。git 面注入可单测。`cc team run --worktree [--merge]`（需 git 仓）。真机验证：6 单测（注入 git）+ 2 **真 git** 集成（temp 仓：两独立任务隔离双 clean 合并；两任务改同文件→先合并者成、后者 CONFLICT 不合、base 保留 A 版）+ `--worktree --merge` e2e（2 并发 worktree→双合并→worktree 清理）。
>
> **4.4 已落地（预算 + 定向消息 + teammate 生命周期 + `--agent --worktree`，Phase 4 闭合，2026-07-04）**：全 Windows-doable 纯逻辑，snapshot 持久化以满足验收「团队会话恢复后任务图、消息和预算保持一致」。**预算** `lib/agent-team/team-budget.js` `TeamBudget` —— 四维团队级封顶：maxTasks（总执行数）/ maxTokens（input+output 累加）/ maxUsd（**委托**已审计的 `CostBudget`，同 `--max-budget-usd` 的 cache-token 计价与 NaN 防毒）/ maxWallMs（注入时钟）。**领取前**consulted、**每任务 settle 后**folded（失败任务也计数，杜绝 doomed 重试循环绕过预算），故至多超支在途任务数。snapshot/restore 跨 `--resume` 保留 running totals；resume 时 CLI flag **覆盖**旧 cap（省略的 flag 保留旧 cap，绝不静默丢安全阈）；wall-clock 窗口 resume 时**重启**不计崩溃间隔。**定向消息** `team-mailbox.js` `TeamMailbox` —— directed（`to:<id>`）+ 广播（`to:"*"`），per-recipient 投递游标：广播对每 teammate 恰投一次、teammate 收不到自己的广播、peek 不进游标、id 单调（不依赖时钟）；snapshot 只重投未 drain 的。**生命周期** TeamRunner：per-teammate idle/running/failed/shutdown 状态 + `teammate:state` 事件 + `members()` 快照；每 runTask 现收 `inbox` + `sendMessage` 句柄；resume 时对崩溃 holder 的回收 lease 报 `teammate:lost`。**`--agent --worktree`**：`TeamWorktreeCoordinator.makeRunTask({runInWorktree})` 可注入执行器 → 每 agent turn 在**自己的 git worktree** cwd 跑（`cc agent -p`），并行编辑不争工作区、分支照 `--exec --worktree` 集成合并。`cc team run` 新 `--max-tasks/--max-tokens/--max-usd/--max-wall`，v2 state 文件捆 registry+mailbox+budget+members。**真机 E2E**：`--max-tasks 2` 停在 2/3、`--resume --max-tasks 10` 续跑至 3/3 且 totals 累计。28 单测（budget 四维+snapshot resume / mailbox 投递+snapshot / runner budget-stop/消息/生命周期 / worktree 注入执行器）。**Phase 4（Agent Team）全部工作项闭合**。

#### 目标

在现有 Subagent 和 Worktree 隔离基础上，实现多个 Agent 可直接协作、领取任务和恢复执行的团队模式。

#### 工作项

- 建立团队级共享任务图和依赖关系。
- 支持 task create/update/claim/release/complete。
- 使用 lease 防止多个 Agent 重复领取同一任务。
- 支持 Agent 间直接消息和定向通知。
- 每个 teammate 可使用独立 Worktree。
- 增加 teammate idle、failed、shutdown、lost 状态。
- 主 Agent 异常退出后可恢复团队任务。
- 支持 token、时间、并发数和费用预算。
- 增加冲突检测、合并预览和可配置合并策略。
- 提供 Team 状态面板和机器可读事件流。

#### 验收标准

- 多 Agent 不会重复处理已被有效 lease 的任务。
- teammate 崩溃后任务可回收并重新分配。
- 并行 Worktree 修改可预览冲突并安全合并。
- 团队会话恢复后任务图、消息和预算保持一致。

### Phase 5：Remote Control 产品化（P1）

> 状态：进行中。底座已 **EXISTS（健全）**：`harness/remote-session-*`、`gateways/remote-session-relay.js`、`cc serve --allow-remote`（仅出站中继 + E2EE + 二维码配对 + registry.revokeMember）。**5.x 断线幂等/全序/撤销核心已落地（2026-07-04）**：`harness/remote-command-ledger.js` `RemoteCommandLedger` —— 纯逻辑、独立可测，直击三条验收里**与设备/硬件无关**的部分：①**断网恢复不重复执行工具调用**——`apply(command, execute)` 按 `commandId` **at-most-once**，重投（reconnect 重发同 commandId）返回缓存 `replayed` 不再执行；**失败的执行不缓存**（重试可再跑），杜绝"半截失败被当成已完成"。②**三端交替顺序一致**——`applyIndex` 单调全序，`appliedSince(cursor)` 让重连端只补尾部；per-device `seq` 倒退（新 commandId 却低 seq = 协议违规）拒绝。③**被撤销设备无法继续控制**——`revokeDevice`/`isRevoked`/构造期 `revokedDevices`，撤销后该设备全部命令拒绝且不执行。`snapshot`/`restore` 往返保幂等+撤销态（注入时钟确定性）。9 单测（幂等重放 / 失败不缓存 / 全序 + 游标追赶 / stale-seq 拒 / 撤销拒 / 快照往返）。**5.y 已落地（ledger 接进 `cc serve` 真 WS 调用路径，2026-07-04）**：`gateways/ws/message-dispatcher.js` `executeWithIdempotency(server,…)` —— `execute`/`stream` 两路由现经它跑：无 `commandId` → 直调 `server._executeCommand`（back-compat 逐字节不变）；带 `commandId` → 惰性建 `server._commandLedger`（`RemoteCommandLedger`），`apply({commandId,deviceId,seq}, ()=>_executeCommand)`，replayed→回 `{type:"replayed"}`、rejected（撤销设备）→回 `{code:"COMMAND_REJECTED"}` 且不执行。`ws-server.js:299` 建 dispatcher、`:507` 把每条入站消息 `dispatch(clientId,ws,message)` 过它——故 ledger **在 `cc serve --allow-remote` 的活 WS 路径里**（客户端一带 commandId 即生效）。9 dispatcher 单测（无 id 直跑×2 / 带 id 执行一次+重投 replayed / 撤销设备 rejected 不执行 + 既有路由回归）。**5.z 已落地（幂等接进真正的接管路径 —— remote-session 控制事件，2026-07-05）**：发现 5.y 的 ledger 只覆盖 `message-dispatcher.js` 的 `execute`/`stream` 直连路由，而**配对设备驱动主机 agent 的真实接管路径**是 `remote-session.publish` 的 `event.type: prompt`/`approval.resolve`/`interrupt`（经 `handleRemoteSessionPublish → handleSessionMessage`，**另一条 handler**）——此路径**零幂等**，断线后设备重发同一 prompt 会**再跑一次 agent turn**（正是验收「断网恢复不重复执行工具调用」要防的）。`remote-session-protocol.js` 新 `applyControlIdempotent(server,clientId,ws,message,forward)`：带 `commandId` 时经**独立** `_remoteControlLedger`（与 execute 路径的 `_commandLedger` 分开，各自 per-device seq 空间）跑 `apply`，副作用（audit+dispatch 进主机会话）**至多一次**、重发回 `remote-session-published{replayed:true}` ack 不再执行；**deviceId=已认证 clientId**（设备无法伪造他人幂等/顺序流）；**无 commandId 逐字节不变**（现有客户端不受影响）。校验（prompt 内容必填）前置于幂等包装，故错误行为与有无 commandId 无关。**顺带修 5.y 同类并发竞态**：两路径原本都 `if(!ledger){ await import(); ledger=new }` —— check 与 assign 之间的 `await` 让**同一 commandId 的并发重发各自建 ledger、双双执行**；改为顶层 static import + **同步**惰性建（check 与 assign 间无 await），两路径均race-safe。测试：remote-session-protocol +6（顺序重发 forward 一次+replayed ack / 不同 commandId 各跑 / 无 id 不去重且 ledger 不建 / approval 重发 resolveAnswer 一次 / **并发重发合并成一次执行** / 校验行为与 commandId 无关且坏 prompt 不消耗 commandId 槽）+ message-dispatcher +1（并发重发合并成一次，race-fix 回归门）。**仍待完成（设备/客户端集成阻塞，Win 单机不可验）**：三端客户端（Terminal/Web/Mobile）**发送** commandId+deviceId 的协议采纳（**服务端两路径现均就绪**，仅客户端未发）；三端真 UX + 实时同步 E2E；Worktree 模式并发远程会话隔离的真机验证。

#### 目标

允许用户从终端、浏览器和移动端安全接管本地 Agent 会话，同时保留本地文件、MCP、工具和项目配置。

#### 工作项

- 新增 `cc remote-control` 和 REPL `/remote-control`。
- 支持 Terminal/Web/Mobile 多端输入和会话实时同步。
- 使用仅出站连接，避免要求用户开放入站端口。
- 支持二维码配对、短期凭证、设备撤销和会话吊销。
- 网络中断后自动重连并校验事件序列。
- 将权限请求、任务完成和失败通知推送到移动端。
- Server mode 支持：
  - `same-dir`
  - `worktree`
  - `session`
  - 并发容量限制
- 远程端持续展示 cwd、Git 分支、权限模式、沙箱状态和费用。

#### 验收标准

- 三端可以交替发送消息且顺序一致。
- 断网恢复后不会重复执行工具调用。
- 被撤销设备无法继续读取或控制会话。
- Worktree 模式下并发远程会话互不污染。

### Phase 6：异步 Hooks 和后台 Monitors（P1）

> 状态：进行中。**后台 Monitors 已闭合**（Phase 3.3i supervisor + 3.3p REPL 每轮注入 + SessionEnd 回收，见 Phase 3）。**6.1 异步 Hooks 已落地（2026-07-04）**：`lib/async-hook-supervisor.cjs` `AsyncHookSupervisor` —— `async:true` 的 settings hook 经 `spawn`（非 `spawnSync`）**fire-and-forget**，不阻塞工具链；结果后台收集，下一轮 `drainResults()` 注入 `additionalContext`。`asyncRewake:true` 且**失败**（非零/`decision:block`/超时）的 hook 进 `drainRewakes()` —— REPL 下一轮以 `[async hook — REWAKE]` 抢先醒目注入，后台测试失败即带**结构化错误**重新唤起 agent。护栏（对应验收「高频文件写入不会造成无限 Hook 并发」）：per-(event+command) 去重（在跑不叠）、`maxConcurrent` 上限（超额丢弃为**可见** skip 非静默）、per-hook 超时 kill、`stopAll()`+`process.once('exit')` 回收（会话不留孤儿）。`settings-hooks.cjs` `collectHooks` 透传 `event/async/asyncRewake`；`settings-hook-events.cjs` `runUserPromptSubmitHooks` 把 `async` hook 从阻塞/决策路径**排除**（fire-and-forget 不能决定它已不阻塞的轮次）+ 新 `dispatchAsyncHooks`。接进 agent-repl turn loop（dispatch after sync UPS / drain before userContent / SessionEnd 回收）。19 单测（fake spawn）+ 4 集成（**真** `child_process.spawn`：fire-and-forget stdout→context / JSON additionalContext 经真管道往返 / 真非零退出 rewake / 真超时 SIGTERM 回收）。**6.2 已落地（Stop 事件 + async Stop 触发）**：REPL 每轮结束（响应+情景记忆后）fire sync Stop（observe）+ dispatch async Stop hooks —— async hook 的**规范触发点**「turn 结束跑测试套件」，结果/rewake 下轮注入。`runObserveHooks` 现**排除** async hooks（否则 Stop async 会双执行：一次阻塞一次 fire-and-forget）。**6.3 已落地（SubagentStart 事件，2026-07-04）**：`agent-core.js` `_executeSpawnSubAgent` 在**创建/运行子代理之前**fire `SubagentStart`（原已有 SubagentStop 在 summary 返回后 fire，现补齐对称的 start）——policy hook 可 `block` **否决 spawn**（返错、不跑任何 LLM）或注入 `additionalContext` **前置到子代理继承上下文**。`settingsHooks` 经 `executeToolInner → _executeSpawnSubAgent` 透传。否决路径完全确定（无 LLM），2 单测覆盖（block 否决 + 校验失败路径不 fire）。**6.4 已落地（MCP tool hook 命中，2026-07-04）**：`collectHooks` 现支持 **MCP 服务器前缀匹配** —— 裸 `mcp__github` matcher 对该服务器**全部**工具（`mcp__github__create_issue` …）fire PreToolUse/PostToolUse（Claude-Code 语义）。matcher 是锚定 `^…$`，前缀本不匹配全名；现额外用抽取的 `mcp__<server>` token 测试。全名精确 + `mcp__server*` 通配仍各自命中单工具/服务器。3 单测。MCP 工具本就经 `executeTool → executeToolInner` 的 default 分支（`mcpClient.callTool`）执行，故 Pre/PostToolUse 钩子链已覆盖，仅补齐前缀命中语义。**6.5 已落地（ConfigChange 事件 + 事件注册表补齐，2026-07-04）**：`HOOK_EVENTS` 补入 `SubagentStart`（agent-core 已接线）+ `ConfigChange`；`/reload-plugins` 在**重新合并 `_settingsHooks` 之后**以**新鲜**钩子集 fire `ConfigChange`（sync observe + async dispatch）——插件信任/热重载改变了 live 钩子/权限集，policy hook 可观察/重审新配置（Claude-Code 语义）。复用已测的 `runObserveHooks`+`dispatchAsyncHooks` 路径。注册表 + collectHooks ConfigChange 命中 2 单测。**6.6 已落地（PostToolUse async dispatch，2026-07-04）**：修复潜在 bug —— `async:true` 的 PostToolUse hook 原在**同步决策路径**跑（阻塞工具循环，「每次编辑后跑后台 lint/test」会拖住这一轮）。`agent-core.js` 现 `partitionAsyncHooks` 拆分：sync 走原决策/`hookFeedback` 路径；async 经 `context.hookSupervisor`（REPL 拥有、经 loop options 透传，新 `toolContext.hookSupervisor` 字段）**fire-and-forget**，结果/rewake 下一轮注入。无 supervisor 时 async PostToolUse 被跳过（不 sync 跑）。REPL 在 agentLoop 调用前惰性建 supervisor 并传入。3 确定性单测（fake supervisor：async 派发不 sync 跑 / 无 supervisor 跳过 / sync 与 async 并存各行其道）。**6.7 已落地（无头 `cc agent -p` 支持 async hooks，2026-07-04）**：原 async hook（PostToolUse/Stop）在无头**被静默跳过**（只有 REPL 拥有 supervisor）。`runAgentHeadless` 现建 supervisor→穿进 loopOptions（无头也能派发 async PostToolUse）→运行结束 fire async Stop hooks→**有界 settle**（默认 5s，`--asyncHookWaitMs` 可调，`runningCount()→0` 或超时即止，无 async hook 时零延迟）→drain rewakes/results 经 **stderr 带外呈现**（stdout envelope 不动、退出码不变）→`stopAll()` 回收。3 集成测试（真 spawn：rewake 呈现 / additionalContext 呈现 / sync hook 不误判）。**6.8 已落地（`cc agent --auto-rewake` 全自动重驱动，2026-07-04）**：直译 Phase 6 目标「asyncRewake:true，失败时主动恢复 Agent 执行」到无头。`--auto-rewake`（`--max-rewakes <n>` 默认 1）开启后：每轮结束 settle async Stop hooks，若 `asyncRewake` check **失败**且重驱动预算未尽 → 把失败报告作为**新 user turn 追加**→再跑一轮 agent 修复。**opt-in**：默认关 → 循环恰跑一次、一次性 `cc agent -p` 行为**逐字节不变**（脚本/CI 不会被静默重跑意外）。重驱动**共享迭代预算**（防失控）+ 无论如何 reap supervisor。实现：`while(true)` 包住 for-await（预算 0 时首轮即 break，等价原结构），`_asyncStopHandled` 防 finally 双触发。4 集成测试（真 spawn：预算 1 重驱一次 counter=2 / `maxRewakes` 上限 counter=3 / 默认不重驱 counter=1 但呈现 / check 通过不重驱）。**82 无头测试全绿证默认路径未变**。`--auto-rewake`/`--max-rewakes` 是 `cc agent` 选项非新命令→无命令数扫。**6.9 已落地（SessionResume / SessionPause 事件，Phase 6 闭合，2026-07-04）**：原判「无真实暂停/恢复触发点」是误判——真触发点确实存在。**SessionResume**：当持久会话的历史被**重放**时 fire（区别于 fresh startup 只 fire SessionStart）——无头 `cc agent --resume` 在 SessionStart 块之后（`resumeId && history.length>0`）、REPL 在 resume 块之后（`messages.some(m=>m.role!=="system")`）各 fire，均以「有真实非 system 历史」为 gate 防 fresh 误触。**SessionPause**：REPL Esc 打断（`_turnAbort.abort()`）即真实暂停点——当前轮被中止而会话仍存活；keypress handler 无法 await，故经动态 import **observe-only fire-and-forget**（`reason:"user-interrupt"`）。`HOOK_EVENTS` 补入 SessionResume+SessionPause。新集成测试 `headless-session-resume.test.js`（resume 时 fire / fresh run 静默）。**6.10 已落地（PermissionRequest 事件 —— 映射到既有 tool-permission 决策路径，2026-07-05）**：Claude-Code 语义「PermissionRequest 在需要审批时触发」。`agent-core.js` 新 `runSettingsPermissionRequestHooks` + `requestInteractivePermission` 包住**全部 5 个交互式权限门**（settings-rule `ask` / 敏感文件 / 破坏性 git / 凭据 / PreToolUse-hook `ask`）——每门在**弹提示前**先跑 PermissionRequest 钩子：`allow`/`approve` → **自动批准不弹窗**、`deny`/`block`/exit 2 / `permissionDecision:deny` → **自动拒绝不弹窗**、`ask`/无决策/无匹配钩子 → 落回原 confirmer（**无钩子时逐字节不变**）。精度：**deny > ask > allow > defer**（任一钩子 deny/ask 胜过 allow，安全优先）；`allow` 从 per-hook `results` 回收（shared `runHooks` 把 aggregate allow 折叠成 continue，故不动共享聚合器、零回归其它 consumer）。`PermissionRequest` 补入 `settings-hooks.cjs` HOOK_EVENTS。真机 E2E：真 `.claude/settings.json` 的 `PermissionRequest` allow 钩子经 `loadHooks`→`executeTool` 自动批准、confirmer 零调用。9 单测（真 `node -e` 钩子 spawn：allow 批准 confirmer 零调用 / deny 两形状拒绝 confirmer 零调用 / ask 落回 confirmer / matcher 作用域 / 无钩子字节不变 / 多钩子 deny 胜 allow / git 门覆盖证多门接入）。**Phase 6 全部生命周期事件闭合**（SubagentStart/Stop、ConfigChange、SessionPause/Resume、MCP 工具钩子、PermissionRequest、async PostToolUse/Stop、auto-rewake）。**6.11 已落地（异步 Hook 孤儿子进程 tree-kill 硬化，2026-07-05，bugfix）**：类文档承诺「stopAll()/process 'exit' 回收每个子进程，会话不留孤儿」，但 `async-hook-supervisor.cjs` 超时路径与 `stopAll` 都只 `child.kill("SIGTERM")` —— hook 以 `shell:true` 跑，真实命令是 shell 的**孙进程**，裸 kill 只信号 shell（POSIX 孙进程被 reparent 继续跑 / Windows 杀 cmd.exe 不动其子），**孤儿泄漏**。而这正是 async hook 的典范用法（「turn 结束跑测试套件」→ spawn node/worker）。修 = 新 `_killChildTree`（POSIX spawn detached + `process.kill(-pid,SIGTERM)` 进程组 / Windows `spawnSync taskkill /T /F`——均同步安全于 stopAll/'exit'；无真 pid 的测试 fake 回退 `child.kill`），超时与 stopAll 均改用之；镜像后台 Shell `_killTask` tree-kill 模式。⚠️ **真机反证**：把超时路径退回裸 kill → 新 grandchild-orphan 集成测试**失败**（孙进程存活），证 bug 真实且测试有牙。25 单测（fake 无 pid 走回退，零回归）+ 2 真 spawn 集成测试（超时 tree-kill 孙进程 / stopAll tree-kill 孙进程，经 `process.kill(gpid,0)` 存活探测）。

#### 目标

让测试、日志监控和外部状态检查在后台运行，并能在异常时主动唤醒 Agent。

#### 工作项

- Hook 支持 `async: true`。
- Hook 支持 `asyncRewake: true`，失败时主动恢复 Agent 执行。
- 后台结果可在下一轮注入 `additionalContext` 或 `systemMessage`。
- 补充事件：
  - Notification ✅（已注册于 HOOK_EVENTS）
  - PermissionRequest ✅（6.10，映射到既有 tool-permission 决策路径）
  - SubagentStart/SubagentStop ✅（6.3）
  - ConfigChange ✅（6.5）
  - SessionPause/SessionResume ✅（6.9）
- 支持 MCP tool hooks ✅（6.4，mcp\_\_&lt;server&gt; 前缀命中）。
- 增加后台任务去重、并发上限、超时、取消和进程回收。
- 支持插件 `monitors/monitors.json`，监控日志、文件和外部状态。

#### 验收标准

- 异步 Hook 不阻塞主 Agent 工具链。
- 后台测试失败能唤醒 Agent 并携带结构化错误。
- 会话结束后不存在遗留 Monitor 或 Hook 进程。
- 高频文件写入不会造成无限 Hook 并发。

### Phase 7：可靠性评测与工程质量（P1）

> 状态：进行中。**编辑并发保护 DONE**（read-freshness 守卫，见基线表）；**模型 fallback 跨 provider DONE**（见基线表）。**7.1 可靠性评测框架已落地（2026-07-04）**：`lib/eval/runner.js` `runEvalSuite(tasks,{runAgent})` —— 每任务开临时工作区 → `setup()` 铺起始文件 → 注入的 `runAgent` 尝试 → `check()` 用**客观断言**（真跑脚本 / 真 import 校验，非 LLM 模糊评分）判 pass/fail，产出可验证的任务成功率 `{passed,total,passRate,ms}`。agent 崩溃记为任务失败（非中断整套），坏任务定义记 failed（非抛）。`runAgent` 注入 → 框架可离线测（perfect-solver mock 得 100%、no-op 得 0% 证明 check 既接受正解又拒绝非解）。`lib/eval/tasks.js` **10** 个确定性内置任务：精确内容建档 / 修语法错真跑校验 / 加函数真 import 校验 / **fix-failing-test**（bug 修复——修 module 让 `run-checks.mjs` 真跑过 + 防改测试守卫）/ **refactor-rename**（跨文件重构——两文件改名，旧名必消失+新名双现+`node main.js` 行为不变）/ **write-test**（测试补全——agent 写 verifier，check 对**正确实现**跑必过 + 对**变异/坏实现**跑必失败，杜绝 `process.exit(0)` 橡皮图章）/ **migrate-signature**（API 升级——函数签名 positional→options 对象 + 更新全部 caller，check 断言新签名 + 无 caller 留旧式 + 运行输出不变）/ **secure-path**（安全修复——路径穿越漏洞，check 用 **exploit probe** 判定：`readNote('../secret.txt')` 修后必**不**泄漏 TOP_SECRET，正常读仍工作；naive `replace('../')` 修法被探针识破）/ **fix-build**（构建失败修复——跨模块 export/import 名不匹配的 ESM 链接失败，check 真跑 `node build.mjs` 必印 BUILD OK + 防改 build 断言橡皮图章）/ **upgrade-dependency**（依赖升级——vendored 依赖 breaking rename `capitalize→toTitle`，agent 须①bump package.json 到 2.x ②改 caller 用新 export ③**不得编辑依赖文件**；check 逐字比对依赖未改 + 断言 manifest bump + caller 无旧名 + `node run.mjs` 印 OK；rigor 证「编辑依赖绕过升级」被拒）+ `getSuite`。`commands/eval.js` `cc eval` 把 runAgent 接到无头 `cc agent -p`（acceptEdits）子进程；`--dry-run`/`--json`/`--suite`/`--model`/`--provider`/`--keep`；未全过 exit 1（CI gate）。真机 `cc eval --dry-run` 端到端跑通 5 任务+报告 exit 1。9 单测（计数从 `BUILTIN_TASKS.length` 派生防漂移）。**7.2 已落地（OTel-shaped 遥测 + eval 指标，2026-07-04）**：`lib/telemetry/span-recorder.js` `TelemetryRecorder` —— **零新增依赖**记录 OpenTelemetry 同构 span/attribute 模型（不引 `@opentelemetry/*` 重依赖树 + collector），`toOtlp()` 出 OTLP/JSON（resourceSpans + typed attr string/double/bool）供真 collector 后续摄入。覆盖计划指标集：per-name 时延（avg/p50/p95/max + error 数）、counter（token/cost/cache.hit/retry + 按 attr 分解）、**失败分类** `recordException(err, category)`。接入 eval：`runEvalSuite` 收 recorder，每任务记 `eval.task` span + 分类失败（agent_error/harness_error/check_failed）；`cc eval` 打印遥测块 + `--otlp <file>` 落 OTLP JSON。注入时钟确定性。真机：`cc eval --dry-run --otlp` 打印「eval.task n=5 … p95」+「failures 5 (check_failed=5)」+ 写 5-span 有效 OTLP。7 recorder 单测 + 2 eval-集成。**7.3 已落地（agent-core 真实埋点 + `cc agent --otlp`，2026-07-04）**：`agentLoop` 现经可选 `options.recorder` **发射真实 span** —— 每次模型调用 `agent.model` span（provider/model + input/output/**cache-read/cache-write** token usage + has_tool_calls）、每次工具调用 `agent.tool` span（tool.name + is_error）、provider fallback 记 `agent.model.fallback` counter（按 reason）+ `agent.model.calls`/`agent.tool.calls` counter。无 recorder 时零成本（`_withSpan` 短路）。经 `cc agent --otlp <file>` 触达用户：headless-runner 建 recorder→穿进 loopOptions→退出时写 OTLP/JSON（best-effort 不改退出码）。测试：3 单测经 chatFn seam（usage/token 属性 + 工具错误标记 + 无 recorder no-op）+ 2 headless 单测（OTLP 文件形状/属性经 recording fake loop + 无 otlp 干净路径）。**7.4 已落地（补 eval 类别 5→7，2026-07-04）**：新增 **write-test**（测试补全）+ **migrate-signature**（API 升级/依赖升级味）两确定性类别，各配严格客观 check（write-test 用正确/变异双跑证 verifier 有意义；migrate-signature 断言签名迁移 + caller 全更新 + 行为不变）+ 2 rigor 测试（橡皮图章 verifier 拒 / 半迁移拒）。**7.5 已落地（安全修复类别 secure-path，2026-07-04）**：离线客观校验「无注入」用 **exploit probe** 破题——路径穿越任务，check 主动跑 `readNote('../secret.txt')`，修后必**不**泄漏 `TOP_SECRET`（含遏制）且正常读仍工作；naive `path.resolve(BASE,name)` 无遏制修法被探针识破（rigor 测试证）。BASE 锚 `path.dirname(fileURLToPath(import.meta.url))` 防工作区路径干扰。eval 类别达 **8**（7.9 后补至 **10**）。**7.6 已落地（发布趋势报告 + 回归门，2026-07-04）**：eval **运行**需真模型（dry-run 恒 0%），但发布流水线真正接的**消费端**——把历史 run 画成趋势 + 回归门——是**纯逻辑离线可测**。`lib/eval/trend.js` `computeTrend(runs,{regressionThreshold})` 比最新 run 与上一 run → `{delta, direction, regressions(**前过今败**), fixed, newlyMissing(掉的任务), regressed, history}`；**单任务回归即触门**即使总 pass-rate 持平（一个修好另一个坏=率平但真回归）；run 按 `ranAt` 排序 + `sparkline`/`formatTrend`。`cc eval --history <file>`（每 run 追加紧凑 JSONL 记录 ranAt/label/counts/per-task）+ `--label`（标版本/commit）+ `--trend --history <file> [--regression-threshold <pts>]`（读历史报趋势不跑，回归 exit 1 做 CI 门）——**均是 `cc eval` 选项非新命令→无命令数扫**。E2E 验证：两 dry-run 追加→2 历史行→平趋势 exit 0；注入回归→REGRESSED 报告 + exit 1。10 单测（趋势逻辑：改善/率平含回归/阈值/排序/掉任务/空 + sparkline/format）+ 3 CLI 集成（追加往返/门 exit 1/`--trend` 缺 `--history` 报错）。**7.7 已落地（Compaction 确定性事实保留 pin 守卫 + 离线测试，2026-07-04）**：破题「事实保留测试需真模型」——压缩引擎原已确定性保留 system / recent-N / last-user，但滚出窗口的重要事实只能**指望** LLM 摘要碰巧留住（非确定性）。现给**硬保证**：`prompt-compressor.js` `compress()` 把 `pinned:true`（或 `options.isPinned` 谓词命中）的消息在**任何策略前**抽出（snip/dedup/collapse/truncate/summarize 都碰不到），再**逐字**作为 sticky 块重插到 system 之后——pin 的事实即使置于最老一轮、即使摘要器丢弃全部细节也**必存活**。纯加性：无 pin 时字节不变（既有 26 测不动）。**这是 Phase 7「compaction 事实保留」的离线可测核**：保证已确定性化，故无需活模型即可验。4 新测（最老轮经 truncate 存活 / 经丢弃式 LLM 摘要存活 / `options.isPinned` 内容谓词 / 无 pin no-op）。**7.8 已落地（opt-in auto-pin 策略，2026-07-05）**：把 7.7 的 pin **机制**配上**策略**——但**严格 opt-in，默认零改**。`runtime/auto-pin.js` `buildAutoPinPredicate(messages, opt)`：关（falsy）→返 **null** → caller **不传** `isPinned` → 压缩走既有默认（只认已标 `pinned:true`）→ **字节完全不变**；开→默认 pin **原始任务（首个 user 轮）**（最易滚出窗口却最重要=coding agent 目标），+ 恒守显式 `pinned:true`/`_pin`，+ token cap（首轮自身过大则跳过，免 pin 反噬预算），identity 匹配（压缩 filter 同数组）。opt-in 三面：`cc agent --auto-pin`（headless）/ `CC_AUTO_PIN=1` env / config `context.autoPin`；接 agent-core 压缩点（headless agentLoop）+ agent-repl 两处 `/compact`+自动压缩（共享 `_compactOpts`）。**真机 E2E 证价值**：60 轮长历史强制 truncate —— **关**→原始任务被丢（present:false，与现状一致）；**开**→原始任务**存活**、pin 到 index 1（system 后 sticky 块）。11 单测（off 返 null / 首轮 pin / 显式 pin 恒守 / firstUserGoal 关仍守显式 / 超 cap 跳过 / identity 匹配 / describe）+ agent-core 110 测证 off 字节不变。**待完成（product-UX 判断，未擅动）**：是否**默认开** auto-pin（当前保守默认关，待 maintainer 拍板）；②活模型验证 LLM 摘要对**未 pin** 任意事实的保留率（本就非确定性，pin 守卫已使重要事实免于此）。**7.9 已落地（补齐 SWE-bench 六类，eval 8→10，2026-07-05）**：工作项明列的 SWE-bench 任务集六类此前差两类未独立覆盖——现补 **fix-build（构建失败修复）**：跨模块 export/import 名不匹配的 ESM **链接**失败（区别于 fix-syntax-error 的单文件语法错），check 真跑 `node build.mjs` 必印 BUILD OK + 防改 build 断言橡皮图章；**upgrade-dependency（依赖升级）**：vendored 依赖 breaking rename（`capitalize→toTitle`），agent 须 bump `package.json` 到 2.x + 改 caller 用新 export + **不得编辑依赖文件**，check 逐字比对依赖未改（防「编辑依赖绕过升级」）+ 断言 manifest bump + caller 无旧名 + `node run.mjs` 印 OK。perfect-solver=100%（含新任务正解）/ no-op=0% / 各 1 rigor 测试（build 神化拒 / 编辑依赖拒）。计数仍从 `BUILTIN_TASKS.length` 派生零漂移；`cc eval --dry-run --json` 真机验 total=10。**SWE-bench 六类（bug 修复/跨文件重构/测试补全/构建失败/依赖升级/安全修复）全覆盖。** **7.10 已落地（无关改动率 / edit-locality 度量，2026-07-05）**：补齐「记录指标」清单里此前唯一没有客观量化的一项——**无关改动率**（agent 解题时是否顺手涂改了任务范围外的文件，反映编辑克制/质量）。`runEvalSuite` 在 `setup()` 之后、agent **之前**对工作区做内容 hash 快照（`snapshotWorkspace`→`Map<relPath, sha1>`），agent 跑完、`check()` **之前**再快照并 `diffSnapshots`（含增/改/删）得该 run 真实触碰的文件集；任务可声明 `expectedFiles`（合法编辑面），`rec.unrelatedChanges` = 触碰但不在声明面内的文件（未声明 `expectedFiles` 的任务→`null`→不计入率）。10 内置任务全部标注 `expectedFiles`。汇总 `unrelatedChangeRate`=（在已声明任务中）至少改了一个范围外文件的任务占比 + `tasksWithUnrelatedChanges`；`formatEvalReport` 打印「Unrelated-change rate: X%」+ 每任务 `[+N unrelated: ...]` 注解；`cc eval` 人读输出同印该行，`--history` 记录追加 `unrelatedChangeRate` 字段（趋势侧加性无回归）。perfect-solver 跨全部 10 任务无关改动率=0% 证度量不误报。真机 `cc eval --dry-run` 端到端印「Unrelated-change rate: 0.0%」。6 locality 单测（零无关改动 / 标记逸出文件 / 删已声明文件不算无关 / 未声明不度量 / perfect-solver 全 0 / 报告格式）。**「记录指标」7 项中的客观可离线项全部有量化实现。**

#### 目标

以真实任务成功率、回归率、安全性和成本作为 Coding Agent 的主要质量指标。

#### 工作项

- 建立内部 SWE-bench 风格任务集（六类全覆盖，10 确定性任务，7.9）：
  - Bug 修复 ✅（fix-failing-test）
  - 跨文件重构 ✅（refactor-rename）
  - 测试补全 ✅（write-test）
  - 构建失败修复 ✅（fix-build）
  - 依赖升级 ✅（upgrade-dependency）
  - 安全修复 ✅（secure-path，exploit probe）
- 记录指标：
  - 首次修复成功率
  - 最终任务成功率
  - 回归率
  - 无关改动率 ✅（7.10 edit-locality 度量）
  - 平均工具调用数
  - 平均 token、费用和耗时
  - 人工审批次数
- 对编辑工具增加 hash/mtime 并发修改保护。
- 长命令统一为后台任务，支持轮询、取消和输出截断。
- 模型 fallback 从同 provider 扩展到跨 provider 策略。
- 为 Context Compaction 增加事实保留和任务连续性测试。
- 引入 OpenTelemetry，覆盖模型、工具、缓存、重试和失败分类。

#### 验收标准

- 每次 CLI 发布均运行固定任务集并生成趋势报告。
- 不允许以通过单元测试替代真实任务成功率评估。
- Compaction 前后任务关键约束保留率达到既定阈值。
- 跨 provider fallback 不重复执行已经成功的副作用工具。

## 4. 次要体验优化（P2/P3）

- 自定义 CLI keybindings。
- `/doctor` 输出可直接执行或确认执行的修复建议。
- Prompt history 模糊搜索和会话 fork。
- Shell 输出折叠、Diff 分栏和工具活动面板。
- Voice 输入、图片粘贴和文件引用统一体验。
- 自动更新 release channel、原子安装和失败回滚。
- 原生二进制发行，降低 Node.js 环境和启动成本。

## 5. 推荐里程碑

| 里程碑 | 内容                                    | 建议周期 | 发布条件                   |
| ------ | --------------------------------------- | -------- | -------------------------- |
| M1     | OS 沙箱设计、Linux/WSL2 原型、策略模型  | 2–3 周   | 越权读写和网络访问测试通过 |
| M2     | LSP 核心、TS/Python 支持、编辑后诊断    | 3–4 周   | 跨文件重构 E2E 通过        |
| M3     | 插件运行时、三种 scope、Marketplace MVP | 3–4 周   | 组合插件安装/更新/回滚通过 |
| M4     | Agent Team、任务 lease、Worktree 合并   | 4–5 周   | 崩溃恢复和冲突合并通过     |
| M5     | Remote Control、多端同步和安全配对      | 4–6 周   | 断线恢复与设备撤销通过     |
| M6     | Async Hooks、Monitors、可靠性基准       | 3–4 周   | 后台唤醒和基准报告进入 CI  |

周期可并行，但建议严格保持技术依赖顺序：沙箱和 LSP 先于大规模 Agent Team 与远程无人值守执行。

## 6. Parity Matrix 模板

每项对标能力都应按以下维度验收：

| 能力          | CLI/API | 真实运行语义 | 安全边界 | 异常恢复 | 跨平台 | 自动化测试 | 文档 |
| ------------- | ------- | ------------ | -------- | -------- | ------ | ---------- | ---- |
| 示例：Sandbox | ✅      | 部分         | 部分     | ❌       | 部分   | 部分       | ✅   |

状态定义：

- `✅`：真实链路实现并有自动化证据。
- `部分`：仅支持部分平台、场景或降级路径。
- `❌`：未实现。
- 不以存在同名命令或内存状态机作为 `✅` 的依据。

#### 当前实测矩阵（2026-07-04，随实现推进更新）

| 能力                         | CLI/API | 真实运行语义 | 安全边界 | 异常恢复 | 跨平台 | 自动化测试 | 文档 |
| ---------------------------- | ------- | ------------ | -------- | -------- | ------ | ---------- | ---- |
| Sandbox（OS 隔离）           | ✅      | 部分＋       | 部分＋   | 部分     | 部分＋ | 部分＋     | ✅   |
| LSP 代码智能                 | ✅      | ✅           | ✅       | 部分     | 部分   | ✅         | ✅   |
| 插件运行时（8 组件）         | ✅      | ✅           | ✅       | ✅       | ✅     | ✅         | ✅   |
| Marketplace 安装生命周期     | ✅      | ✅           | ✅       | ✅       | ✅     | ✅         | ✅   |
| Agent Team（lease 图）       | ✅      | ✅           | ✅       | ✅       | ✅     | ✅         | ✅   |
| Remote Control               | ✅      | ✅           | 部分＋   | 部分＋   | 部分   | 部分＋     | 部分 |
| 异步 Hooks                   | ✅      | ✅           | ✅       | ✅       | ✅     | ✅         | ✅   |
| 后台 Monitors                | ✅      | ✅           | ✅       | ✅       | ✅     | ✅         | ✅   |
| 编辑并发保护                 | ✅      | ✅           | ✅       | ✅       | ✅     | ✅         | ✅   |
| 模型 fallback（跨 provider） | ✅      | ✅           | ✅       | ✅       | ✅     | ✅         | ✅   |
| 可靠性评测（任务成功率）     | ✅      | ✅           | n/a      | ✅       | ✅     | ✅         | ✅   |

> 判读：Sandbox 的「安全边界/自动化测试」由**部分**升为**部分＋**——**网络域名访问策略 + SSRF 守卫已落地**（`lib/sandbox-network-policy.js`，wildcard/apex/deny-precedence/default-deny + 私网/loopback/云 metadata/IPv6 方括号 SSRF 拦截，14 策略单测 + 148 sandbox 测试，已接进 `sandbox-v2.js` `checkNetworkPermission`）；「真实运行语义/跨平台」由**部分**升为**部分＋**——**出口过滤代理已把域策略从判定变强制**（`sandbox-egress-proxy.js`，逐 HTTP/CONNECT 调 evaluateNetworkAccess 拒绝非白名单 + SSRF，接进 `executeSandboxedShell`＋`agent-core` run_shell，跨平台免 root，6 socket 集成测试），原「因无代理 refuse 域限网络」现「起代理强制」；仅剩**内核级出口硬隔离**（Windows AppContainer / macOS Seatbelt / Linux bwrap netns——平台相关，需 Linux/macOS）未落。Agent Team 已全绿（lease 独占防重复 + 会话恢复 + per-teammate worktree 隔离 + 冲突预览安全合并，均有真机/真-git 自动化证据）。Remote Control 由**部分**升为**部分＋**——**断线幂等/全序/设备撤销核心已落地**（`harness/remote-command-ledger.js`：commandId at-most-once 重放、失败不缓存、applyIndex 全序 + 游标追赶、per-device stale-seq 拒、revokeDevice、snapshot/restore，9 单测）；剩三端真 UX + 断线注入 E2E + host executor 真接线（需真机）。异步 Hooks / Monitors / 评测 / 编辑并发 / 模型 fallback 均已具备自动化证据。**当前未全绿仅剩两项且均为环境阻塞**：Sandbox（**策略层已可测全绿**，仅剩原生 OS 出口隔离需 Linux/macOS，Windows 侧不可验证）、Remote Control（**幂等/撤销核心已可测全绿**，仅剩真机三端 + 断线注入 E2E）。

## 7. 近期首批任务建议

1. 输出现有 `agent --sandbox` 的威胁模型和实际隔离边界。
2. 抽取 `SandboxBackend` 接口，实现 bubblewrap MVP。
3. 定义 `code_intelligence` 工具 schema 和 LSP 生命周期接口。
4. 选取 20 个真实仓库任务建立首版可靠性基线。
5. 审计现有 plugin、skill、agent、hook、MCP 的加载路径，形成统一 manifest 草案。
6. 建立 parity matrix，并将结果纳入 CLI 发布检查。

## 8. 最终路线

```text
OS 沙箱
   ↓
LSP 代码智能
   ↓
统一插件运行时
   ↓
Agent Team + Worktree
   ↓
Remote Control
   ↓
Async Hooks / Monitors
   ↓
可靠性评测与持续优化
```

完成上述路线后，ChainlessChain CLI 的竞争点将从“命令和模块数量”转向可验证的编码成功率、安全性、扩展性与跨设备协作能力。
