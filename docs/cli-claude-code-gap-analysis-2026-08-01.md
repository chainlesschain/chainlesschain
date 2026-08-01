# ChainlessChain CLI 对照 Claude Code CLI 补齐与优化方案

> 分析日期：2026-08-01
>
> ChainlessChain 基线：`packages/cli` v0.162.189
>
> Claude Code 参考基线：官方文档与 2.1.220 changelog（2026-07-25）
>
> 文档性质：现状审计、实施方案与持续进度记录；未标记“已完成”的项目仍是待办

## 实施进展（2026-08-01）

| 方案项                                             | 状态              | 落地结果与验证证据                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 lazy dispatch、单次执行与启动 SLO               | 已完成            | `c42820ab13`：phase-0 dispatch、生成式帮助、`OutputContext`、轻量 status 与启动基准落地；Windows 冷启动四项 p95 均满足仓库阈值                                                                                                                                         |
| P0 typed config、secret、文件权限与 Sandbox 默认值 | 已完成            | `a4d1c05133`：版本化 schema、统一 redaction、OS secret store、原子迁移、POSIX mode、Windows 当前用户 ACL、doctor 修复和 fail-closed sandbox；179 项目标测试通过                                                                                                        |
| P0 MCP `ws/wss` 与 scope                           | 已完成            | `392398a09d`：WebSocket transport、作用域与运行时契约落地                                                                                                                                                                                                              |
| P0 Session 事实源与可恢复 Agent runtime            | 已完成            | `ca4fe4ef73`、`199b2cb7c6`、`4c656ac7ec`：Session 索引、增量持久化、WS 恢复、side-effect ledger、Skill/MCP/headless 恢复语义收敛，并将 E2E 的配置目录与工作区隔离；核心分组回归 519 项、真实子进程回归 9 项通过                                                        |
| P0 Skill 受控执行与内容身份授权                    | 已完成基础        | `c841a58e2b`：用户可写 Skill 默认不受信，执行前异步复核精确 digest，经隔离 Agent 与 host-owned 工具边界运行，并透传 LLM 配置、命令侧失败关闭；主复验 118 项通过；通用 runtime 的结构化 child-failure 契约继续收口                                                      |
| P0 exact-SHA 发布门禁与原生发行链                  | 已实现，待最终 CI | `6d229d0df4`、`55b3c55a1c`：三平台 exact-SHA gate、不可变 npm tarball、六目标签名 manifest、完整同版本身份校验、versioned asset 禁止覆盖、可恢复的 stable channel 激活协议；发布契约 28 项通过，正式发布仍须待发布精确提交的两套权威矩阵全绿                           |
| P0 签名更新与回滚链                                | 已完成            | `4d3a4ee788`：签名 manifest、健康检查与自动回滚链落地                                                                                                                                                                                                                  |
| P1 `/btw` 临时旁路与统一输出契约                   | 已完成            | `316f7497b4`、`c42820ab13`：旁路问题不污染主会话历史与上下文，quiet/verbose/json 统一经输出上下文收口                                                                                                                                                                  |
| P1 后台 Agent 恢复配置与隔离                       | 已完成            | `34414b64f9`、`b1b0570091`：持久化、去敏的 background launch profile、指纹与兼容性校验、外部凭据注入、跨平台 canonical path 恢复；本地单文件 39 项通过，`CLI Strict Sandbox` 在 Ubuntu 24.04、macOS 15、Windows 全绿                                                   |
| P1 默认 Agent 与命令面 manifest                    | 已完成基础        | `6b2b394fd1`：修复 14 个域的嵌套帮助路由和跨 OS help 漂移，175 条命令写入 stability/category/visibility/replacement 元数据，默认命令与核心分组由 manifest 驱动；单元 30 项、E2E 57 项通过。长尾迁移、真实 replacement/deprecation 周期、completion/README 生成仍待完成 |
| P1 Plan/Todo/会话可靠性                            | 已完成            | `ece470137d`、`d28dd7d9fc`、`70306bd8ee`：Plan/Todo 持久化、revision 冲突保护和结构化 handoff 落地                                                                                                                                                                     |
| P2 Provider-neutral Advisor                        | 已完成            | `8e6e617373`：Advisor runtime、命令与 REPL 接口落地；83 项测试通过                                                                                                                                                                                                     |
| P2 交互输入、提示建议与 Session recap              | 已完成基础与接线  | `6845c4a6ac`、`ca4fe4ef73`：剪贴板图片、编辑器、stash、suggestions、快捷键、终端布局与 recap 模块及 REPL 接线；独立 UX 回归 49 项通过                                                                                                                                  |

本轮安全批次已覆盖真实 Windows Unicode 路径及目录/文件 ACL 修复。Windows PowerShell ACL 的冷启动延迟仍列为后续 P2 性能优化，不影响当前安全语义与提交边界。`b1b0570091` 的 `CLI Strict Sandbox` 已在 Ubuntu 24.04、macOS 15、Windows 三个平台通过；这只是已验证实现证据，不等同于发布授权。npm/原生发行物不得依据本地测试或旧提交矩阵发布，必须以待发布精确提交上的 `CLI CI` 与 `CLI Strict Sandbox` 全部通过为最终门禁。

## 1. 结论先行

ChainlessChain CLI 已经不是“功能少于 Claude Code”的阶段。当前清单有 **175 个顶层命令、28 个静态 Agent 工具**，权限、Sandbox、MCP、Skills、Plugins、Hooks、后台 Agent、Agent Teams、Worktree、Goal、Routine、Remote Control、IDE、语音、全屏 TUI、Artifacts 等主体能力大多已经落地。

下一阶段最值得做的，不是继续增加顶层命令，而是把已有能力收敛成一个更快、更安全、更可预测的 coding-agent 产品。优先级建议如下：

1. **P0：修复启动路径与重复执行风险**——当前所谓 lazy dispatch 被静态导入破坏，且 action 抛错后可能回退并再次执行。
2. **P0：收紧密钥、文件权限与 Sandbox 默认值**——避免 secret 出现在 argv、终端输出和弱权限文件中，避免 Sandbox 初始化失败后静默裸跑。
3. **P0：让 npm 发布门禁满足仓库自己的 exact-SHA 三平台规则**。
4. **P0：修复 MCP `ws/wss`“配置可接受、运行不可连接”的契约错误**。
5. **P0：统一 Session 事实源并解决长会话全量读取、并发 hash 链分叉问题**。
6. **P1：把 175 个顶层命令收敛为核心入口 + 兼容别名 + 扩展域**，并让 `cc` 在 TTY 中默认进入 Agent。
7. **P1：统一后台 Agent 的恢复配置、隔离、并发与预算取消语义**。
8. **P1：修正 `/btw` 语义，统一 `quiet/verbose/json` 输出契约和配置来源解释**。
9. **P1：基于现有 `cc pack` 建立官方签名原生发行物、包管理器和可回滚更新链**。
10. **P2：再做多模型 Advisor、提示建议、Session recap 等体验增强**。

一句话判断：**能力广度已经足够，当前竞争差距主要在“核心路径的完成度”，而不是 feature count。**

## 2. 分析范围与方法

本次结论来自四类证据：

- 静态核对 `packages/cli` 的 command manifest、Agent contract、REPL、MCP、Session、Sandbox、配置、后台任务和发布工作流。
- 对照仓库现有的 [CLI Runtime 当前实现](./design/cli-runtime-current.md)、[2026-07-11 Claude Code gap 分析](./internal/cli-claude-code-gap-analysis-2026-07-11.md) 与 [自动生成 CLI Reference](./cli/CLI_REFERENCE.generated.md)。
- 对照 Claude Code 官方 overview、CLI reference、interactive mode、MCP、subagents、sandbox、advisor 和 changelog。
- 在 Windows 10、Node.js 22.22.2、Intel i7-4770HQ 环境进行新进程诊断计时。该计时用于定位量级，不等同于正式跨平台基准。

本次没有执行完整测试套件、渗透测试或真实 LLM 长会话压测，因此所有“已具备”判断以代码与现有测试/文档为准；性能目标需要进入三平台 CI 后再校准。

## 3. 已经具备、不建议重复建设的能力

| 领域                      | 当前状态                                                                                                                          | 判断                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Agent / Headless          | text、json、stream-json、JSON Schema、模型/provider、图片、resume/fork、checkpoint、工具 allow/deny、max turns/token/USD 等已存在 | 强，不应重做基础 Agent loop            |
| 权限与 Sandbox            | allow/ask/deny、managed policy、Docker/bwrap/Seatbelt/Windows 隔离、Process Broker、credential agent 已存在                       | 实现广，重点应改默认值和降级语义       |
| MCP                       | stdio、HTTP/SSE、OAuth、tools/resources/prompts、roots、elicitation、`list_changed`、ToolSearch 已存在                            | 主体完整，优先修 transport 契约        |
| Skills / Agents / Plugins | 多 scope skill、`.claude/agents`、hooks/MCP/LSP/native bin、签名/SBOM、marketplace 已存在                                         | 强，重点做加载性能、治理一致性和文档   |
| Session / Background      | list/show/resume/export/search/verify/tail/usage、attach/dashboard/logs/stop、外部 session index 已存在                           | 功能广，但底层事实源与长会话性能需收敛 |
| Agent Teams / Worktree    | DAG、mailbox、lease、预算、worktree、batch、分布式 queue 已存在                                                                   | 强，重点统一运行时上限与取消           |
| 自动化                    | agenda、loop、cron、routine、channels、cloud handoff、remote control 已存在                                                       | 不缺入口，缺调度内核收敛               |
| 交互                      | Vim、voice、fullscreen TUI、fast、rewind/compact、plan、custom commands 已存在                                                    | 基础强，仍有语义与日常输入体验差距     |
| IDE / SDK / CI            | VS Code、JetBrains、Agent SDK、headless、多个 CLI 专项 CI 已存在                                                                  | 强，重点收紧发布权威性                 |

此前两份 gap 文档列出的权限模式、后台 attach、MCP Tool Search、Agent SDK、远控、动态 workflow、PowerShell、Artifacts、Agent View、Channels、Computer Use、Routines、PR/session link、Voice、Fast mode、Plugin 治理和外部 Session Store 等项目，大部分已经实现。继续按旧清单“补功能”会造成重复建设。

## 4. 关键现状数据

### 4.1 命令与文档规模

- [`command-manifest.json`](../packages/cli/src/command-manifest.json#L3) 注册 175 个顶层命令，来自 166 个模块、170 个唯一 registrar。
- 存在 4 组共享 registrar 的顶层入口：`attach/daemon/logs`、`auto/automation`、`decrypt/encrypt`、`orchestrate/router`。
- 以摘要关键字做启发式扫描，有 59 个顶层命令带 `Phase`、`governance`、`in-memory`、`experimental`、`preview` 或 `prototype` 标记。这不代表它们不可用，但说明公开入口混入了大量内部阶段/治理信息。
- [`packages/cli/README.md`](../packages/cli/README.md#L203) 仍写“19 个工具”，而自动生成 reference 已是 [28 个工具](./cli/CLI_REFERENCE.generated.md#L183)；README 版本说明也停留在 v0.162.160。
- 根帮助分类在 [`index.js`](../packages/cli/src/index.js#L63) 硬编码了实际不存在的 `rag`、`ukey`、`backup`、`trade`、`data`、`monitor` 顶层命令。

### 4.2 冷启动诊断

本地两组独立新进程采样得到：

| 命令                                                    |          观测值 |
| ------------------------------------------------------- | --------------: |
| `node packages/cli/bin/chainlesschain.js --version`     |   约 4.3–6.3 秒 |
| `node packages/cli/bin/chainlesschain.js agent --help`  |   约 3.3–4.6 秒 |
| `node packages/cli/bin/chainlesschain.js status --json` | 约 10.7–15.8 秒 |

根因不是 Commander 本身，而是入口结构：

- [`lazy-dispatch.js:4`](../packages/cli/src/lazy-dispatch.js#L4) 顶层静态导入 `createProgramAsync`。
- 被导入的 [`index.js:27`](../packages/cli/src/index.js#L27) 在模块求值阶段通过 top-level await 导入全部 175 个命令模块。
- 因此 [`lazy-dispatch.js`](../packages/cli/src/lazy-dispatch.js#L103) 后续“只动态加载一个命令”的 fast path 实际已经失去主要收益。
- `--version`、根帮助和无参数路径仍显式进入完整 program。
- `status` 还会同步探测 Docker/Compose 并串行扫描多个端口，缺少统一 deadline。

### 4.3 产品入口与 Claude Code 的差别

Claude Code 的官方 quickstart 是进入项目后直接执行 `claude`，默认启动 coding agent；大多数 coding 能力通过 flags、slash commands、skills 和 plugins 暴露。ChainlessChain 的无参数 `cc` 则进入完整根 program/help，核心 coding agent 只是 175 个顶层命令中的一个。

这不是单纯审美问题：它会同时放大冷启动、帮助可发现性、安装体积、回归矩阵和安全审计面的成本。

## 5. P0：必须先修的正确性、安全与发布问题

### P0-1 真正的 lazy dispatch，并保证命令最多执行一次

#### 现状与风险

[`lazy-dispatch.js`](../packages/cli/src/lazy-dispatch.js#L103) 把动态 import、registrar 和 `program.parseAsync()` 放在同一个 `try/catch` 中。如果 action 已产生副作用后抛错，catch 会创建完整 program 并再次 `parseAsync(argv)`，存在变更命令执行两遍的风险。

文件末尾的 `LazyDispatch.matches()` / `spawn()` 仍是恒定返回 `false` 的空壳，也会误导后续维护者。

#### 方案

1. 新建不依赖 `index.js` 的 phase-0 parser，只解析全局 flags、版本、已知命令 token 和最小帮助。
2. `--version` 直接读取轻量版本常量并退出；根帮助由 manifest 的精简索引生成，不导入 command modules。
3. 已知命令仅动态导入其 registrar；只有未知命令和显式 `help --all` 才动态导入完整 program。
4. 将 import/registration 错误边界与 action 执行边界分开；一旦进入 `parseAsync()`，失败就原样返回，禁止 eager fallback。
5. 删除空壳 `LazyDispatch`，或让 bin 真正通过该对象完成分发，避免双实现。
6. `status` 改为并行探针，所有外部探针有 deadline；提供默认快速状态和显式 `--deep`。

#### 验收标准

- 三平台 CI 冷进程 p95：`--version <= 250ms`，稳定后目标 `<= 150ms`。
- `<known-command> --help <= 400ms`，普通不依赖服务的只读命令 `<= 500ms`。
- `status --json` 在 Docker 不可用时 `< 1s`，正常本地环境 `< 2s`；单探针 deadline `<= 500ms`。
- 注入“写入一次后抛错”的 action，最终副作用计数必须为 1，退出码与原始错误不被 fallback 覆盖。
- 性能基准相对已批准基线回退超过 15% 时阻断合并。

### P0-2 密钥、文件权限与 Sandbox 使用安全默认值

#### 现状与风险

- [`config set`](../packages/cli/src/commands/config.js#L153) 会回显完整 value；API key 同时进入 shell history 与 process argv。
- `config get` 原样输出值，`config list` 在 [`printConfig`](../packages/cli/src/commands/config.js#L317) 中只按字段名包含 `key` 做遮罩，`token`、`password`、`secret` 等可能漏出。
- [`config-manager.js`](../packages/cli/src/lib/config-manager.js#L73) 写入含密钥的 JSON 时没有显式 `0600`；[`paths.js`](../packages/cli/src/lib/paths.js#L60) 创建运行目录时没有显式 `0700`。Session JSONL 也没有明确权限契约。
- 此前 README 曾示范 `config set llm.apiKey sk-...`，会鼓励用户把 secret 放进历史；本轮已迁移为 `set-secret` 示例。
- Process Broker 只有 [`CC_SANDBOX_STRICT=1`](../packages/cli/src/lib/process-execution-broker/index.js#L905) 才强制隔离失败闭合；部分初始化失败路径会警告后继续无 Sandbox 执行。

#### 方案

1. 建立 schema 驱动的 secret registry，不再靠字段名子串猜测；所有 text/json/get/list/doctor/export 使用同一个 redactor。
2. 新增 `cc config set-secret <key>`，从无回显 TTY、stdin 或 OS keychain 引用读取；普通 `config set` 遇到 secret key 时拒绝或引导迁移。
3. `--api-key` 保留兼容但显示弃用警告；推荐 provider credential helper、环境注入或 OS keychain，禁止写入 transcript/trace。
4. POSIX 目录 `0700`、配置与 transcript `0600`；Windows 使用当前用户 ACL。Doctor 检测并可修复历史文件权限。
5. 明确 `--sandbox-mode off|workspace-write|strict`。Safe/Auto 模式在平台能力可用时 fail closed；任何降级到裸执行都需要显式确认，并写入审计事件。
6. 对已有配置做幂等迁移：先备份、校验权限与内容、再原子切换；不可用 keychain 时保持安全文件 fallback。

#### 验收标准

- secret 不出现在 stdout、stderr、JSON、debug/OTel、session、argv 快照和错误对象中。
- 跨用户读取配置与 transcript 的权限测试失败；Windows ACL、Linux/macOS mode 均进入 CI。
- 所有 get/list/set/export 路径有统一泄漏测试，覆盖 `apiKey/token/password/secret/credential` 及 schema 自定义 secret。
- Safe/Auto 下 Sandbox 初始化失败不得静默继续；显式 off 模式必须可被 managed policy 禁止。

### P0-3 exact-SHA 三平台发布门禁与可信更新链

#### 现状与风险

仓库规则要求：CLI 发布前，同一精确提交的 `CLI CI` 与 `CLI Strict Sandbox` 必须在全部配置 OS 上通过。但当前 [`npm-publish.yml`](../.github/workflows/npm-publish.yml#L18) 提供 `skip_tests`，自身测试 job 只在 Ubuntu 执行，publish 只依赖该 job；权威三平台矩阵在其他 workflow 中，发布流没有对同一 SHA 强制核验。

此外，[`selfUpdateCli`](../packages/cli/src/commands/update.js#L95) 在版本验证命令异常时会“assume success”，这会把无法验证误报为更新成功。

#### 方案

1. 将 `CLI CI` 与 `CLI Strict Sandbox` 抽成 reusable required gate，或在发布 job 中通过 GitHub Checks API 校验 **当前 release SHA** 的完整矩阵。
2. 正式发布删除 `skip_tests` 通路；dry-run 可以跳过昂贵测试，但不得共享生产 publish job 的权限。
3. CI 先产生不可变 npm tarball，记录 SHA-256、SBOM、provenance；验证和 publish 必须使用同一个 tarball digest。
4. 启用 npm provenance；发布摘要记录 commit、workflow run、tarball digest、各矩阵结果。
5. 更新验证异常视为失败或 `unknown`，不得报告 success；原生更新采用 staging、签名校验、原子切换和 last-known-good rollback。

#### 验收标准

- 任一 OS、任一 required job 未通过、超时、来自旧 SHA 或被跳过，生产发布都必须失败。
- 发布后 registry tarball digest 与 CI 验证 digest 完全一致。
- 篡改、截断、错误版本、更新中断和校验进程异常的 fault-injection 在三平台均不会破坏可用旧版本。

### P0-4 修复 MCP WebSocket 与 scope 契约

#### 现状与风险

- [`cc mcp add`](../packages/cli/src/commands/mcp.js#L483) 接受 `ws/wss` transport 并持久化。
- [`inferTransport`](../packages/cli/src/harness/mcp-client.js#L71) 也保留 `ws/wss`。
- 实际 connect 分支在 [`mcp-client.js`](../packages/cli/src/harness/mcp-client.js#L711) 只处理 HTTP/SSE 或 stdio，没有 WebSocket 连接实现。

因此用户能成功保存一个运行时必定无法正常连接的配置。Claude Code 官方 MCP 文档已把 WebSocket 作为独立配置方式，并同时定义 local/project/user scope；ChainlessChain 不能只复制枚举而缺少执行契约。

#### 方案

短期优先保证诚实契约：

1. 若一个小版本内不能完成 WS，实现前在 add/import/validate 阶段明确拒绝 `ws/wss`，并给出迁移提示。
2. `cc mcp doctor` 对已有 WS 配置报告 `unsupported_transport`，而不是模糊连接失败。
3. 给 `mcp add/get/remove/list` 补齐 `local|project|user|managed` scope 与来源显示。

随后再按真实需求实现持久双向 WS、headers helper、重连/backoff、取消、消息大小上限、channels push 和集成测试。不要让“支持的枚举”领先于“支持的运行时”。

#### 验收标准

- 配置层支持的每种 transport 都必须通过真实 server 连接矩阵；否则在保存前失败。
- malformed URL、TLS、401/403、协议不匹配、断线重连、取消和超时都返回结构化诊断。
- scope precedence、项目信任和 managed deny 有端到端测试。

### P0-5 统一 Session 事实源和长会话存储

#### 现状与风险

- REPL 会在 JSONL 与 DB 路径之间切换；headless resume 主要读取 JSONL；session export 又先读 chat DB、再 fallback JSONL，存在多套事实源。
- [`jsonl-session-store.js`](../packages/cli/src/harness/jsonl-session-store.js#L64) 的 tail hash cache 明确假定单 writer。虽然 append 使用文件锁，但跨进程缓存可能在进入锁前已经过期，形成分叉 hash chain。
- `verifySession`、`readEvents`、`rebuildMessages`、`listJsonlSessions` 等路径会整文件读取；大量 session 或超大 transcript 会导致启动延迟和高 RSS。
- 当前 hash chain 能检测很多中间篡改，但不是外部 anchor，也不能代替机密性保护。

#### 方案

1. 选择 `session-core` 作为 canonical contract：append-only event log 是内容事实源，SQLite/sidecar index 只保存可重建元数据。
2. 在文件锁内部重新读取并 CAS 校验 tail hash；写入使用 framed record 或临时文件 + 原子 append 协议，允许识别最后一条 partial record。
3. transcript 分段，索引 title、count、mtime、lastHash、compact checkpoint、PR/branch/worktree；list/search 不再扫描所有正文。
4. resume 从最近 compact checkpoint + 增量事件恢复；verify/repair 使用流式读取，支持按段校验。
5. DB、旧 JSONL 和外部 store 通过版本化 adapter 迁移；所有 `resume/search/export/rename/delete/prune` 共享同一语义测试。
6. 可选增加 OS-keychain 管理的 transcript AEAD；完整性 anchor 可写入独立 ledger/HMAC，而不是把自包含 hash chain 宣传为防删除证明。

#### 验收标准

- 20 个并发 writer 各 append 1,000 条后 hash 链完整、无丢失、无重复。
- 10,000 个 session 中 `list --limit 10` p95 `< 200ms`，RSS `< 100MB`。
- 1GB transcript 恢复 p95 `< 2s`，且测试证明没有全量载入内存。
- 任意写入点 kill -9 后，最多丢弃一条 partial record；`session repair` 可诊断且不伪造成功。
- REPL、headless、IDE、background attach 对同一个 session 得到一致结果。

## 6. P1：高价值产品与架构优化

### P1-1 收敛命令面，让 Agent 成为默认产品入口

#### 目标形态

- `cc`：TTY 中默认进入 coding agent；stdin 有内容时默认进入 headless prompt，非交互且无输入时返回简洁帮助。
- `cc help`：只展示约 8–12 个稳定域，例如 `agent`、`session`、`mcp`、`plugin`、`config`、`doctor`、`auth`、`admin`。
- `cc help --all`：展示完整兼容面。
- 长尾业务命令迁移到 `cc lab ...`、领域子命令或插件；旧顶层命令保留 alias 与 deprecation 至少两个 release cycle。
- `command-manifest` 增加 `stability/category/visibility/replacement` 元数据，帮助、文档、completion 和弃用提示全部自动生成。

#### 原则

1. 不做破坏式“一次删 175 个命令”。先隐藏、归类、别名转发、采集使用率，再删除。
2. 核心安装 profile 只加载 coding-agent 所需依赖；web3、social、governance 等作为可选扩展 profile。
3. 新增顶层命令必须说明为什么不能是 slash command、skill、plugin 或现有域的子命令。
4. 建立“顶层命令净增长不高于 0”的阶段性约束，直到稳定面完成收敛。

#### 验收标准

- 新用户从安装到第一次 Agent 对话不需要先理解 175 个命令。
- 默认帮助只含真实存在且稳定的入口；完整帮助、completion、README 与 manifest 零漂移。
- 旧脚本在兼容窗口内继续工作，弃用信息写 stderr，不污染 JSON stdout。

### P1-2 统一后台 Agent 的恢复、隔离与预算取消

#### 现状

- Background supervisor 恢复时没有完整持久化原始 launch profile，可能丢 provider/model/tool allowlist/sandbox/MCP/settings。
- Background worktree 仍是显式选项，未必隔离当前工作区。
- 不同运行路径已有多种上限：Agent core 默认深度 5、单次共享 spawn 计数 32，registry 有 active/pending cap，TeamBudget 又有 task/token/USD/wall time；这些并非一个统一 session runtime budget。

#### 方案

1. 持久化脱敏的 launch profile 与 config fingerprint；resume 时重新校验 provider、model、权限、MCP、plugin、workspace 和 budget。
2. Git 仓库中的 mutating background task 默认创建 worktree；只读任务可共享，显式 `--no-worktree` 才覆盖。
3. 建立 session 级统一预算：concurrency、total spawns、depth、tokens、USD、wall time、max turns、tool time。
4. 预算耗尽时主动取消仍在运行的子 Agent/后台 shell，而不只是禁止下一次 spawn。
5. 所有嵌套 Agent 事件携带 parent/child tool-use id，stream-json、TUI、OTel 和 attach 使用同一棵执行树。

#### 验收标准

- resume 后有效配置与原 session 一致；不兼容变化明确拒绝，不能静默换模型或放宽权限。
- 任一预算耗尽后，所有受管后代在 deadline 内停止并完成审计归因。
- 并发 20 个 Agent、嵌套多层、主进程取消、断线重连和 worktree 清理进入长时 soak。

### P1-3 修正 `/btw` 与统一交互输出契约

#### `/btw` 语义

当前 [`btw-command.js`](../packages/cli/src/repl/btw-command.js#L4) 实际是“给下一条消息排队一个 aside”，并不是 Claude Code 的即时侧问。

Claude Code 官方语义是：在主任务运行时也可发起一个独立、即时、只读当前上下文、无工具、单回答且不写主历史的侧问，并可从 overlay fork 新会话。

建议改为：

1. `/btw <question>` 立即发起独立 ephemeral model call，复用父会话已缓存前缀。
2. 禁用工具、写入和 follow-up；结果显示在 overlay，默认不进入主 transcript。
3. 支持 `f`/`--fork` 将侧问变成独立 session。
4. 为兼容现有“下一轮 aside”，另命名为 `/note-next`，不要继续占用 `/btw`。

#### 输出契约

`program-base.js` 声明了全局 `--verbose/--quiet`，但 logger 的 `setVerbose/setQuiet` 没有统一绑定到 program lifecycle。建议建立一个 OutputContext：

- stdout 只承载用户结果或可解析 JSON/NDJSON。
- diagnostics、progress、deprecation、trace 全部走 stderr。
- `quiet` 抑制非错误文本；`verbose` 只增加 stderr 诊断。
- Commander preAction 一次绑定全局 flags，子命令不得各自猜测。

验收时对所有稳定顶层域执行 `default/quiet/verbose/json` 矩阵，并验证 JSON 可被单独解析。

### P1-4 建立统一、可解释的 typed config schema

当前 [`config-keys.js`](../packages/cli/src/lib/config-keys.js#L1) 从 `DEFAULT_CONFIG` 推导基础 key，再手工维护额外 key；`config set` 仍接受任意 dotted key 和弱类型 value。与此同时，`config.json`、`.claude/settings*.json`、managed policy 和环境层都有各自优先级。

建议：

- 发布版本化 JSON Schema，统一类型、enum、default、secret、scope、managed-lock、deprecation 和 migration。
- 增加 `cc config validate [--fix]`。
- 增加 `cc config effective --json`。
- 增加 `cc config explain <key>`，展示最终脱敏值、来源、被覆盖层、policy lock 与弃用迁移。
- 默认拒绝未知 key；插件通过命名空间注册 schema。保留显式 `--allow-unknown` 仅用于开发。

### P1-5 官方原生发行物与可回滚升级

Claude Code 官方提供 native installer、Homebrew、WinGet 以及 native background update。ChainlessChain 已有 `cc pack` 能力与 Linux dry-run CI，但本次检索未发现把 CLI 自身作为签名、多平台 release artifact 并持续发布到 Homebrew/WinGet/apt 的完整链路；当前权威发布仍以 npm 为主。

建议复用现有 packer，而不是新造打包器：

1. 产出 macOS arm64/x64、Linux x64/arm64、Windows x64/arm64 的 signed artifact。
2. 发布 manifest 包含版本、精确 commit、平台、架构、SHA-256、签名、SBOM 和最低 schema 版本。
3. 提供 PowerShell/shell installer、Homebrew tap、WinGet manifest，随后再评估 apt/dnf/apk。
4. updater 下载到 staging，验证后原子切换；保留 last-known-good 与 `cc update rollback`。
5. npm 入口继续兼容，并可作为开发/插件生态渠道。

这项工作应在 P0 启动、安全与发布门禁完成后进行，否则只是把当前缺陷复制到更多渠道。

### P1-6 建立长会话与运行时可靠性 SLO

Claude Code 近期 changelog 的高频主题不是增加命令，而是内存泄漏、长会话 O(n²)、并发 Agent、MCP 输出、worktree、stream、symlink、partial response 和终端恢复。ChainlessChain 也应把这些从零散回归测试升级成固定 SLO：

- 1,000+ turns、1GB transcript、10,000 sessions。
- 1,000 个 MCP tool schema，超大 tool output，长 MCP call 自动后台化。
- 20+ 并发 Agent、预算耗尽、主线程取消、后台仍运行、嵌套 stream forwarding。
- slow pipe、broken pipe、磁盘满、只读目录、文件被外部删除、symlink/worktree 改变。
- midstream API error 时保留已收到文本并明确标注 incomplete。
- 退出后无 orphan process、listener、timer、PTY、worktree 和未刷盘审计记录。

要求每项有延迟、RSS、FD/handle、落盘一致性和清理 deadline 指标，而不仅是“测试最终通过”。

## 7. P2：有价值，但不应抢占 P0/P1 的增强

### P2-1 多 Provider Advisor / Critic

Claude Code Advisor 会在选方案、连续失败和宣布完成前调用更强模型给第二意见。ChainlessChain 不宜复制 Anthropic server tool，而应复用现有 `review --multi/--verify` 与 sub-agent runtime，做 provider-neutral advisor：

- `advisorModel` / `advisorProvider` / `advisorBudgetUsd`。
- `/advisor on|off|once|status` 与单次启动 flag。
- 默认触发点：方案提交前、相同错误重复 N 次、完成前风险审查。
- advisor 只给建议，不直接获得更高权限；主 Agent 必须用本地证据验证建议。
- 调用次数、token、成本和命中效果可观测，支持 managed allowlist。

### P2-2 交互细节

在 `/btw` 修正后，再逐步补：

- 后台生成且可关闭的 prompt suggestions。
- `/recap`，从已有 session index 生成轻量回顾。
- 真正的系统剪贴板图片粘贴 chip，而不仅是路径识别。
- 外部编辑器编辑 prompt、prompt stash、自定义 keybindings。
- narrow terminal、screen reader、RTL/CJK 宽度和 resize 的快照回归。

Emoji completion 等装饰项优先级最低。

### P2-3 MCP 可选协议面

在 WS 契约修好后，按真实 server 使用数据决定是否补 sampling、logging level、completion、resource subscribe/templates 等。不要为了协议条目数量一次性实现所有可选 capability。

### P2-4 调度内核收敛

`automation schedule`、agenda、routine、loop/ccron 已分别存在。长期应收敛到一个持久 scheduler service，统一 timezone/DST、missed-run policy、幂等键、去重、history、权限与预算；外层命令只做不同视图。该项是降低维护成本，不是继续新增第五套调度入口。

## 8. 建议实施顺序

| 里程碑           | 内容                                                                                            | 依赖   | 退出条件                                    |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- |
| M0：契约止血     | lazy import、禁止 action fallback 重跑、secret 全局遮罩、临时拒绝未实现 WS、发布 exact-SHA gate | 无     | P0 回归全部通过，正式发布无 skip 通路       |
| M1：核心体验     | phase-0 parser、快速 status、默认 Agent 入口、生成式帮助、OutputContext、config explain         | M0     | 冷启动 SLO 达标，默认帮助与 manifest 零漂移 |
| M2：持久化与后台 | canonical session store/index、CAS hash、分段 transcript、launch profile、统一 budget/cancel    | M0     | 并发/1GB/10k session/kill-9 验收通过        |
| M3：发行与差异化 | signed native releases、rollback updater、Advisor、recap、交互 polish                           | M1、M2 | 三平台安装/升级/回滚和长会话 soak 通过      |

### 可以先独立落地的 Quick Wins

1. 把 `createProgramAsync` 改为 fallback 内动态 import。
2. 把 `parseAsync()` 移出 lazy registration 的 catch。
3. `--version` 走零 command-module 的直接路径。
4. 在 WS 实现前拒绝 `ws/wss` 保存，并给已有配置 doctor 诊断。
5. `config get/list/set` 复用统一 secret redactor，README 删除明文 key 示例。
6. 在 Commander preAction 绑定 `quiet/verbose`。
7. 根帮助和 README 计数从 manifest/Agent contract 生成，删除不存在的硬编码命令。
8. 生产 npm publish 禁止 `skip_tests`，强制校验 exact SHA 的两套三平台矩阵。

## 9. 工程门禁与 Definition of Done

### 必须新增的 CI 门禁

- `cli-startup-benchmark`：Windows/Linux/macOS 冷进程 p50/p95 与 RSS。
- `cli-command-idempotency`：所有 mutation action 的 exception/fallback 测试。
- `cli-secret-leak`：stdout/stderr/JSON/trace/session/argv/file mode/ACL 矩阵。
- `cli-mcp-transport-contract`：每个公开 transport 的真实 server E2E。
- `cli-session-scale`：并发 append、10k index、1GB restore、crash repair。
- `cli-long-session-soak`：Agent/MCP/PTY/worktree/stream/取消/预算/资源清理。
- `cli-release-gate`：exact SHA、三平台 checks、tarball digest、provenance。
- `cli-doc-drift`：manifest、根帮助、README、generated reference、Node/npm 要求和示例 smoke test。

### 代码覆盖策略

不要只追总体百分比。优先要求以下分支覆盖不低于 90%，并采用 ratchet 防止回退：

- 密钥处理与脱敏。
- Sandbox fail-closed 与 managed policy。
- updater 签名/原子切换/回滚。
- lazy dispatch 与 mutation failure。
- session append/verify/repair/migration。
- MCP transport、auth、scope 和 trust。

E2E retry-pass 应记为 flake，而不是普通 pass；超过阈值阻断发布。

## 10. 不建议近期投入的方向

- 继续增加 Web3、治理、社交或“Phase N”顶层命令。
- 为了数字好看，把已实现的 Hooks、MCP ToolSearch、Skills、Plugins、Agent Teams 再写一套。
- 直接复制 Anthropic-only 的云端 Advisor 或 Routines 基础设施。
- 在 Session 和预算一致性未完成前继续提高嵌套 Agent 深度。
- 把 emoji、动画、更多 alias 放在启动、安全和发布门禁之前。

## 11. 建议的产品指标

完成 M2 后，用以下指标判断优化是否真的有效：

- 首次安装到第一次有效 Agent 回复的中位时间。
- `cc` 启动到 prompt ready 的 p50/p95。
- 7 天内发生过一次有效 Agent 会话的安装用户比例。
- Session resume 成功率与配置不一致拒绝率。
- 每 1,000 次 tool call 的 orphan、重复执行、权限误放行、不可恢复 transcript 数。
- Background task 在预算/取消后按 deadline 清理的比例。
- MCP 连接失败中可直接定位到配置/认证/传输层的比例。
- 发布因 exact-SHA gate 被正确阻断的次数，以及 retry-pass flake 率。
- 稳定顶层命令使用覆盖率；长期无人使用命令进入插件/隐藏面的比例。

## 12. 官方参考资料

- [Claude Code Overview](https://code.claude.com/docs/en/overview)：默认入口、原生安装、Homebrew、WinGet、自动更新与产品表面。
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)：CLI flags、headless 与 `--bare`。
- [Claude Code Interactive Mode](https://code.claude.com/docs/en/interactive-mode)：快捷键、历史、图片粘贴、后台任务、`/btw`、suggestions 与 recap。
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)：HTTP/SSE/stdio/WebSocket、scope、OAuth、ToolSearch、重连与长调用后台化。
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)：嵌套、并发、session 总量、background、worktree 与恢复。
- [Claude Code Sandboxing](https://code.claude.com/docs/en/sandboxing) 与 [Permissions](https://code.claude.com/docs/en/permissions)：隔离与权限的两层模型。
- [Claude Code Advisor](https://code.claude.com/docs/en/advisor)：决策点第二意见、模型配置、成本与限制。
- [Claude Code Changelog](https://code.claude.com/docs/en/changelog)：2.1.220 及近期长会话、并发 Agent、MCP、stream、worktree 和内存可靠性修复。

## 13. 最终建议

如果只能选择一条主线，建议定为：

> **“把 `cc` 从一个拥有 175 个入口的综合命令集合，收敛成一个启动快、默认安全、会话可信、后台可控的 coding-agent runtime；长尾能力通过子域和插件保留。”**

这条主线既能直接缩小与 Claude Code 的真实体验差距，也能保留 ChainlessChain 在多 Provider、去中心化、跨端、自动化和企业治理方面的差异化优势。
