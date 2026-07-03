# ChainlessChain CLI 对照 Claude Code 优化计划

> 制定日期：2026-07-03  
> 对象：`packages/cli` Coding Agent 核心链路  
> 目标：从“功能覆盖广”提升为“高可靠、高安全、可扩展的 Coding Agent CLI”

## 1. 当前判断

ChainlessChain CLI 已具备会话恢复、Checkpoint、上下文压缩、MCP、Subagent、Worktree、Hooks、Permissions、Status Line、Loop 和结构化输出等主要能力。

> **基线校准（2026-07-03 逐项 grep 坐实，`packages/cli@0.162.148`）** —— 各 Phase 的真实起点不同，规划必须区分「从零建」「扩既有」「产品化」：
>
> | 领域               | 现状判定                                                                                                                                                                 | 关键实现                                                                                                   | 本计划性质                                   |
> | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
> | 沙箱               | **EXISTS**（仅 Docker 后端，无后端抽象，无 bwrap/seatbelt）                                                                                                              | `lib/agent-sandbox.js`（`docker run --network none`）、`lib/sandbox-v2.js`（策略/配额监控，非 OS 隔离）    | 扩既有：抽 `SandboxBackend` + 原生后端       |
> | **LSP / 代码智能** | **ABSENT**（纯文本搜索 `search_files`，无任何 LSP）                                                                                                                      | `runtime/agent-core.js`                                                                                    | **从零建（本次起点）**                       |
> | 插件 / Marketplace | **PARTIAL**（manifest 只加载 `skills`，无 agents/hooks/mcp 组合，无 user/project/local scope）                                                                           | `harness/plugin-manager.js`、`lib/plugin-ecosystem.js`                                                     | 扩既有：统一多组件 manifest + scope          |
> | Agent Team         | **PARTIAL**（master-worker + worktree + cowork，无 lease / teammate 任务图）                                                                                             | `commands/agents.js`、`harness/worktree-isolator.js`、`lib/cowork/agent-group-runner.js`                   | 扩既有：加 lease 共享任务图                  |
> | Remote Control     | **EXISTS（健全）**                                                                                                                                                       | `harness/remote-session-*`、`gateways/remote-session-relay.js`、`cc serve --allow-remote`                  | **产品化，非新建**：补三端 UX + 断线序列校验 |
> | 异步 Hooks         | **PARTIAL**（`HookType.ASYNC` 存在但仍 inline await，无 `async:true` fire-and-forget、无 `asyncRewake`）                                                                 | `lib/hook-manager.js`、`lib/settings-hook-events.cjs`                                                      | 扩既有：真异步 + 失败唤醒                    |
> | 后台 Monitors      | **PARTIAL → 首付已落地**（Phase 3.3i：`PluginMonitorSupervisor` interval/longRunning + 去重/并发上限/超时/回收；剩 REPL 每轮 additionalContext 注入 + 事件驱动 monitor） | `lib/plugin-monitor-supervisor.js`、`lib/plugin-runtime/monitors.js`、`harness/background-task-manager.js` | 扩既有                                       |
> | 可靠性评测 / OTel  | **ABSENT**（有 vitest + golden-transcript 测试基建，无任务成功率基准，无 OTel 依赖）                                                                                     | `harness/golden-transcript.js`                                                                             | 从零建                                       |
> | 编辑并发保护       | **PARTIAL**（unique-match + `edit_file_hashed` 锚定，**无 mtime/read-freshness 守卫**）                                                                                  | `runtime/agent-core.js` `edit_file`                                                                        | 补 mtime/hash 新鲜度守卫                     |
> | 模型 fallback      | **EXISTS（仅同 provider，≤3 跳）**                                                                                                                                       | `runtime/fallback-model.js`                                                                                | 扩既有：跨 provider                          |
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

## 2. 实施原则

- 优先提升真实编码任务成功率，而不是增加外围命令。
- 所有新增能力必须接入真实 Agent 执行链，避免只提供治理状态机或展示接口。
- 安全边界必须由操作系统或独立执行环境强制，不依赖模型遵守提示词。
- 每个阶段都需要单元测试、集成测试、E2E 测试和故障恢复测试。
- 对标结论使用可验证的 parity matrix，不以“已有同名命令”判定完成。
- 保持 Windows、macOS、Linux/WSL2 的行为差异清晰可见，并采用明确的降级策略。

## 3. 分阶段计划

### Phase 1：OS 级 Agent 沙箱（P0）

> 状态：进行中。已完成分层 settings 策略合并、Agent 接入、bubblewrap 初版后端、Docker 能力失败关闭和针对性单测；待完成网络代理、macOS Seatbelt、后台 Shell、Native Windows 方案与跨平台安全 E2E。

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

> 状态：一期 + 二期均已落地（2026-07-03）。**一期** `packages/cli/src/lib/lsp/`（jsonrpc-stream / lsp-client / lsp-server-registry / lsp-manager / code-intelligence）+ `cc code-intel` 命令（status/def/refs/hover/symbols/wsymbols/diag/rename）+ 单测 + 真实 `typescript-language-server` 集成测试（无 server 时 skip）。已对真实 TS 项目验证：跨文件 def / 全量 refs / TS 诊断 / rename 预览全部工作。零新增运行时依赖（探测 PATH/node_modules）。**二期** `code_intelligence` 已接入真实 Agent 执行链：契约 `coding-agent-contract-shared.cjs`（tier:extension，单 `action` 判别 7 子命令）+ 策略元数据 `coding-agent-policy.cjs`（readonly / plan-mode 可用）+ `agent-core.js` `executeToolInner` case（先验参再查，无 server 优雅降级）+ 系统提示引导（改符号前查引用、改后查诊断）+ 空闲 60s 自释放的 server 池（`_getSharedCodeIntel` / `disposeSharedCodeIntel`，防 orphaned 进程/悬挂 timer 泄漏）+ `formatToolArgs` 显示 + checkpoint readonly 归类。默认工具数 20→21，5 处计数断言同步。真机 `executeTool` 实测 references(4)/diagnostics(TS2322)/definition 通过，dispose 干净退出；新增 `agent-core-code-intel.test.js`（校验/降级/格式 + skip-guarded live）。**三期** 编辑后自动增量诊断回喂已落地：`write_file`/`edit_file`/`edit_file_hashed` 成功后经 `_postEditDiagnostics` 给结果附 `newDiagnostics`（error+warning，≤20），agent 同轮即见自己引入的错误。零成本当无 server（先 `resolveServer` 探测不冷启不存在的 server）+ 全程限时（6s 墙钟 cap + 3s 诊断超时，仅首编辑付冷启动税）+ 复用 idle server 池 + `CC_EDIT_DIAGNOSTICS=0` 可关；系统提示已加「见 newDiagnostics 先修再继续」。真机验证：编辑引入未声明名 → TS2304 附到 edit_file 结果。**待完成**：Python/Go/Rust 真机验证、大仓启动/内存基准、崩溃自动重启的真机故障测试。

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
> **待完成**：`/reload-plugins` 热加载（reset 各模块 memo：`_resetPluginLspLoadState`/`_resetPolicyCache`/skill 层/monitor 重启）；remote-manifest source + 私有仓认证 + 离线 seed cache；Monitor 输出接入 REPL 每轮 additionalContext 注入（supervisor `drainOutputs` 已就绪，待接 turn loop）；bin（可执行文件 PATH 注入）+ settings（默认配置合并）两组件尚未接。

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

#### 目标

让测试、日志监控和外部状态检查在后台运行，并能在异常时主动唤醒 Agent。

#### 工作项

- Hook 支持 `async: true`。
- Hook 支持 `asyncRewake: true`，失败时主动恢复 Agent 执行。
- 后台结果可在下一轮注入 `additionalContext` 或 `systemMessage`。
- 补充事件：
  - Notification
  - PermissionRequest
  - SubagentStart/SubagentStop
  - ConfigChange
  - SessionPause/SessionResume
- 支持 MCP tool hooks。
- 增加后台任务去重、并发上限、超时、取消和进程回收。
- 支持插件 `monitors/monitors.json`，监控日志、文件和外部状态。

#### 验收标准

- 异步 Hook 不阻塞主 Agent 工具链。
- 后台测试失败能唤醒 Agent 并携带结构化错误。
- 会话结束后不存在遗留 Monitor 或 Hook 进程。
- 高频文件写入不会造成无限 Hook 并发。

### Phase 7：可靠性评测与工程质量（P1）

#### 目标

以真实任务成功率、回归率、安全性和成本作为 Coding Agent 的主要质量指标。

#### 工作项

- 建立内部 SWE-bench 风格任务集：
  - Bug 修复
  - 跨文件重构
  - 测试补全
  - 构建失败修复
  - 依赖升级
  - 安全修复
- 记录指标：
  - 首次修复成功率
  - 最终任务成功率
  - 回归率
  - 无关改动率
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
