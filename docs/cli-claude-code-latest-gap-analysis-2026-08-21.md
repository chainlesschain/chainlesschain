# ChainlessChain CLI 对照 Claude Code 增量差距分析（2026-08-21）

> 分析对象：ChainlessChain CLI `0.165.4`
> 审计快照：`github/main` 提交 `1ef06b52a96a243ae2c340615dc6ef091835f311`
> Claude Code 原基线：`v2.1.220`
> 本次增量窗口：`v2.1.221`～`v2.1.238`；官方没有公开发布 `v2.1.230`
> 审计方法：官方 release/文档核对、代码静态审计、交付与 CI 可执行性复核；相似命令不直接视为行为完全等价。

## 1. 复核后的结论

ChainlessChain CLI 已覆盖安全/裸模式、结构化 headless 输出、后台 Agent、条件式隔离 worktree、MCP 请求生命周期核心、插件供应链、Remote Control 协议、A2A/Team 消息底座、私有 Runner handoff、Linux 强制沙箱与资源限制等大量能力。第二次审查发现，初稿对其中几项存在低估，已在本文修正，后续不应重复建设。

真正需要按 P0 处理的不是继续增加命令，而是三个可验证的安全边界：

1. Remote Control 当前默认监听 `0.0.0.0`，且无 relay 时自动回退 LAN；应改为默认 loopback，LAN 仅显式 opt-in。
2. `blockedMarketplaces` 等托管插件源策略仍存在简单字符串匹配路径；应在任何 DNS、clone、helper 启动前完成 canonical identity 判定。
3. Linux deny-all 网络隔离已经存在，但“按域名选择性放行”的强制 egress 仍不完整；没有真实阻断测试时不得宣称 strict enforcement。

本期还值得完成的 P1/P2 项包括 MCP 残余生命周期与机器可读错误、统一信任判定 API、headless hook/subagent 事件、插件 archive/command source/`headersHelper`、Concise 风格以及 `classic`/`readline` 键位风格。生产 relay、完整 Runner host/control plane、跨机器消息和企业网关活体能力需要外部条件，建议下一期完成。

## 2. 全版本段增量审计

下表覆盖 `v2.1.220` 之后所有已公开版本段的高价值增量，不追逐仅影响 Claude 品牌界面的每个微小修复。

| Claude Code 版本段                                                                                                                                           | 主要官方增量                                                                                                                                                                           | ChainlessChain 复核结论                                                                                                                                 | 建议                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`v2.1.221`](https://github.com/anthropics/claude-code/releases/tag/v2.1.221)～[`v2.1.223`](https://github.com/anthropics/claude-code/releases/tag/v2.1.223) | Linux/WSL 凭据文件 mask、MCP print-mode readiness、worktree 主检出隔离、PreToolUse 限制、proxy-aware startup、市场 owner wildcard、隐藏命令/动态 import 防绕过                         | 已有凭据代理、MCP 初始化后发现、worktree 和符号链接防护；市场 canonical policy、部分命令解析负向矩阵仍可加强                                            | 本期补市场策略和安全回归，不重做 MCP 初始化核心           |
| [`v2.1.224`](https://github.com/anthropics/claude-code/releases/tag/v2.1.224)～[`v2.1.225`](https://github.com/anthropics/claude-code/releases/tag/v2.1.225) | self-hosted environment、archive+SHA-256、`crossSessionInbound`、结构化凭据 mask、跨会话消息、`claude agents` 工作区信任、网关额度提示                                                 | 已有 `cc cloud` handoff、A2A/Team 队列、插件签名与 Remote Control；缺 Runner host、独立 CLI 会话统一 live transport、archive 市场源                     | 本期做协议/本地核心；控制面和跨机器能力后移               |
| [`v2.1.226`](https://github.com/anthropics/claude-code/releases/tag/v2.1.226)～[`v2.1.229`](https://github.com/anthropics/claude-code/releases/tag/v2.1.229) | `v2.1.226/227` 以修复为主；随后增加全条目 marketplace merge、远端 synced skill 降权、command source 及其 `mode: "link"`、server hooks、SSE keepalive、OAuth loopback、IPv6 fail-closed | 已有不可变内容寻址缓存、原子发布、verified fallback 和确定性 catalog；缺 command source/link mode、远端 skill 同等级降权和 gateway keepalive 完整契约   | 复用现有供应链底座扩展，不重做缓存                        |
| [`v2.1.231`](https://github.com/anthropics/claude-code/releases/tag/v2.1.231)～[`v2.1.234`](https://github.com/anthropics/claude-code/releases/tag/v2.1.234) | MCP OAuth、subagent 默认 fork/缓存继承、GitLab marketplace/worktree、Linux cgroup、WebFetch TTL、`forward_user_identity`、mTLS 热轮换、NT `\??\` 防护、项目目录名                      | 已有显式 fork/worktree、GitLab 基础、安全路径、`prlimit` CPU/AS/FD；当前 subagent 默认仍为 `fresh`，缺 cgroup、跨会话策略、结构化身份转发               | 本期明确 fork 默认语义并补资源/路径测试；企业身份活体后移 |
| [`v2.1.235`](https://github.com/anthropics/claude-code/releases/tag/v2.1.235)～[`v2.1.238`](https://github.com/anthropics/claude-code/releases/tag/v2.1.238) | spellcheck、权限预览完整性、Concise、默认模型、`notify_when_idle`、macOS deny 优先、`classic/readline`、市场 `headersHelper`、Runner 优雅停机/代理认证、长会话与 Remote 韧性           | 已有 Remote ack/重放防护、MCP `headersHelper`、输出风格框架和 Vim engine；缺市场 helper、Concise、readline flavor、Runner host 生命周期和部分 soak 指标 | 小型本地项本期完成；生产 Runner/relay 分阶段实施          |

说明：官方未公开 `v2.1.230` release，版本从 `v2.1.229` 跳至 `v2.1.231`。`mcp_server_errors`、sandbox `strictAllowlist` 等仍值得补，但属于 `v2.1.220` 之前已存在的基线遗留差距，不应误归入本次增量窗口。

## 3. 已确认覆盖的能力

| 能力                | 当前实现与证据                                                                                                                                                                    | 复核判断                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 安全/裸模式         | `packages/cli/src/commands/agent.js`、`packages/cli/src/lib/safe-mode.js`：`--safe-mode`、`--bare` 保留权限规则                                                                   | 已覆盖                                                        |
| Headless            | text/json/stream-json、stream-json 输入、JSON Schema、partial messages、回合和 durable session 预算                                                                               | 已覆盖核心                                                    |
| 后台 Agent/worktree | `background-session.js`、`background-worktree-policy.js`、`agent-worktree.js`；mutation-capable + Git + 非 stream-json 且工作区 clean 时默认隔离                                  | 已覆盖核心，文档需保留条件                                    |
| MCP 核心生命周期    | `harness/mcp-client.js` 已执行 initialize→initialized→capability discovery，支持请求 timeout、AbortSignal/cancel、SSE Last-Event-ID/退避、resource subscribe 和 list_changed 刷新 | 已覆盖核心，仅有残余差距                                      |
| MCP `headersHelper` | `mcp-headers-helper.js`、`mcp-headers-helper-trust.js`：项目/插件信任与环境净化                                                                                                   | 已覆盖 MCP，不等于市场 helper                                 |
| 插件供应链          | `plugin-runtime/install.js`、`remote-source.js`、`marketplace-source-cache.js`：签名、SBOM、provenance、替换同意、不可变缓存、staging+fsync+rename                                | 已覆盖较强基础                                                |
| Remote Control 协议 | session/device/epoch 绑定、commandId、sequence、replay ACK、at-most-once、有界 ledger、状态 token 脱敏                                                                            | 协议基础已覆盖；默认监听姿态是主要 P0                         |
| 强制沙箱与资源      | Linux bwrap deny-all 网络；`platform-sandbox.js` 已有 `prlimit` CPU/AS/FD；credential agent 使用短期 opaque ref 和 host/process 绑定                                              | 已覆盖基础；选择性 egress 和结构化文件 mask 待补              |
| 私有 Runner handoff | `commands/cloud.js`、`lib/cloud/cloud-client.js`、`lib/cloud/bundle.js`：bundle→run→status/attach/list→reflow                                                                     | 已有客户端/交接协议，缺 Runner host daemon                    |
| Hooks               | `hooks-v2-runtime.js`、`settings-hook-events.cjs`：事件总线、严格合并、CwdChanged、WorktreeCreate/Remove、MCPElicitation                                                          | 已覆盖内部事件，headless 外部事件流待补                       |
| A2A/Team 消息底座   | `a2a-protocol.js`、`agent-team/team-mailbox.js`、`team-runner.js`：注册、队列、pending cap、idle/stuck、backpressure                                                              | 已覆盖底座，缺独立活跃 CLI 会话统一路由                       |
| 输出/键位框架       | `output-styles.js` 已有 default/explanatory/learning；`--vim`、`/vim` 和 `repl-vim.js` 已有完整 modal engine                                                                      | 缺 Concise 和 prompt 级 `classic/readline` 设置，不应重做 Vim |

## 4. 建议任务与真实优先级

### 4.1 P0：安全边界

| 编号 | 任务                                 | 真实差距                                                                        | 验收标准                                                                                                                                                                                           | 外部条件                                         | 建议                            |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------- |
| P0-1 | Remote Control 默认暴露收紧          | `start` 默认 `0.0.0.0`，无 relay 时静默回退 LAN；协议安全底座已存在             | 默认 bind loopback；无 relay 不自动开放 LAN；新增显式 `--allow-lan` 和风险提示；旧配置给一版迁移警告/显式兼容开关；覆盖 token 过期/重放、scope 提权、重复消息、队列满                              | 无                                               | 本期，S～M                      |
| P0-2 | 插件源 canonical identity 与托管策略 | legacy `blockedMarketplaces`/allowlist 存在简单字符串匹配，源分类前后可能不一致 | Git/URL/SCP/GitLab subgroup 在零 DNS、零 clone、零 spawn 前规范化并决策；兼容 `additionalMarketplaces`/`allowedMarketplaces` aliases；owner wildcard 语义明确；策略变化可审计、可回滚              | 核心无；私有源活体验收有                         | 本期核心，M                     |
| P0-3 | 选择性 egress 强制                   | deny-all 已强制，但按域名选择性放行尚无完整不可绕过后端                         | canonical host/IPv6；redirect 每跳重验；覆盖 DNS rebinding、IPv4-mapped IPv6、metadata、NO_PROXY、WebSocket/UDP/DNS、domain fronting；无强制后端时 fail closed；至少一个真实阻断 cell 通过才标完成 | 需要具备 bwrap/proxy/network namespace 的 runner | 有 live cell 则本期，否则下一期 |

### 4.2 P1：协议、信任和可观测性

| 编号 | 任务                                    | 已有基础与剩余工作                                                                                                                                                                                                                                                                                                                                                                        | 前置依赖                   | 建议期次                            |
| ---- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------- |
| P1-1 | MCP 残余生命周期/可观测性               | 保留现有 deadline/cancel/reconnect；补进度/空闲超时、disabled server 在 DNS/spawn 前拒绝、稳定脱敏 `mcp_server_errors`、重连后恢复 resource subscriptions、discovery cache 开关/TTL/max-stale/strike                                                                                                                                                                                      | Headless schema            | 本期                                |
| P1-2 | 统一工作区信任判定 API                  | MCP 已按路径/指纹，plugin 已按 scope/name/version，hooks 使用 host identity；统一 canonical repo identity、decision API 和审计投影，但保留每类证据和单独 consent                                                                                                                                                                                                                          | 无                         | 本期设计+迁移                       |
| P1-3 | Headless hook/subagent 事件             | 增加仅用于 stream-json 的 `--include-hook-events`；输出 `hook_started`/`hook_progress`/`hook_response`；转发 top-level/nested subagent lifecycle/tool/progress，带 parent id、schema version，默认关闭不改变旧输出                                                                                                                                                                        | 先冻结 additive schema     | 本期                                |
| P1-4 | 结构化凭据 mask 与 Windows 路径         | 已有 opaque ref broker；补 `extract/onExtractNoMatch`、JWT claims、AWS pair/SigV4、managed-only TLS termination；覆盖实际 `\\?\` 和 `\??\`，诊断永不输出解析后 secret                                                                                                                                                                                                                     | P0-3 强制 egress接口       | 本期 Linux/WSL contract；全平台后移 |
| P1-5 | 独立 CLI 会话 live transport            | 复用并收敛 A2A+TeamMailbox，而不是再造第三套消息系统；增加 durable session route、accept/hold/refuse、TTL、rate/size/backpressure、ACK、`notify_when_idle`；消息永不授予权限                                                                                                                                                                                                              | P1-2 identity；协议版本    | 本期本机 prototype，生产/跨机器后移 |
| P1-6 | 长会话和资源治理                        | 保留现有 `prlimit`；增加可选 Linux cgroup 每工具内存、WebFetch TTL、Web Search cap、有界 renderer/tool/event backlog、RSS/CPU/FD soak                                                                                                                                                                                                                                                     | Linux runner               | 本期 smoke；formal soak 定时运行    |
| P1-7 | 插件 archive/command source/市场 helper | 复用现有原子缓存和 catalog；archive 防 zip-slip/symlink/hardlink/重复项/解压炸弹；command source 可选 `mode: "link"`（Windows 不支持）。Claude 官方 command 是在用户主目录运行的 shell 字符串；ChainlessChain 建议主动采用更严格、非完全兼容的 Process Broker descriptor：展示命令默认拒绝、固定 executable/args/cwd、净化 env、timeout/输出上限；headers 仅发 catalog 和逐跳同源 archive | P0-2；P1-2；Process Broker | 本期核心，私有源 live 后移          |
| P1-8 | 网关客户端韧性                          | fake gateway 验证 SSE keepalive/idle recovery、mTLS cert/key 热轮换、上游错误转译和 proxy auth helper 接口                                                                                                                                                                                                                                                                                | 无生产依赖                 | 本期 contract；生产网关后移         |

统一信任迁移必须采用旧规则的 strictest/intersection，损坏 store fail closed，并测试升级/降级、路径移动/复用、大小写、linked worktree 和并发写。远端 synced skill 不得遮蔽本地命令/MCP prompt，也不得通过 `!`/`@` 扩大本地执行面。

### 4.3 P2：低成本体验和产品决策

| 任务                                   | 复核后的准确范围                                                                                                                                                                                                                                                | 外部条件             | 建议                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------ |
| Concise 输出风格                       | 复用现有 output styles，仅增加内置 persona 和回归测试                                                                                                                                                                                                           | 无                   | 本期                           |
| `keybindingFlavor`                     | 仅 `classic`（默认）/`readline`；验证 readline 下 `Ctrl+W`，不重做已有 Vim                                                                                                                                                                                      | 无                   | 本期                           |
| spellcheck                             | adapter 调用已安装的 `aspell`/`hunspell`/`ispell`，需可关闭和代码块抑制                                                                                                                                                                                         | 可选本机二进制       | 核心/fake 本期，真实矩阵条件式 |
| 默认模型/项目目录环境配置              | `ANTHROPIC_DEFAULT_MODEL` 只作新会话最低优先级默认值，低于 CLI、`ANTHROPIC_MODEL`、settings 和组织默认；`CLAUDE_CODE_PROJECT_DIR_NAME` 仅在同时设置 `CLAUDE_CONFIG_DIR` 时生效，只能来自启动环境，用于命名 `projects/` 下保存 transcripts 和 auto memory 的目录 | 无                   | 本期                           |
| subagent fork 默认语义                 | 当前 `agents.js` 默认为 `fresh`；决定是否改为 fork+完整上下文/prompt cache，或明确因安全/成本保持差异                                                                                                                                                           | 无                   | 本期做决策和测试，不盲目追平   |
| selection clear、screen reader、窄终端 | 增加选择清除动作和回归，保留现有屏幕阅读器模式                                                                                                                                                                                                                  | 无                   | 本期                           |
| GitLab MR footer/worktree live         | parser/UI 可本地实现                                                                                                                                                                                                                                            | GitLab/glab 活体     | 代码本期，真实实例后移         |
| Runner host 生命周期扩展               | 基于 `cc cloud`，补 host daemon、base-dir/preflight、SIGTERM park、proxy helper、server-hook trust                                                                                                                                                              | 注册/调度/租户控制面 | P2/下一期，不从零重建 client   |

## 5. 本期无需等待即可完成

| 任务                                       | 为什么可立即做                                    | 推荐验证                                  |
| ------------------------------------------ | ------------------------------------------------- | ----------------------------------------- |
| Remote 默认 loopback、LAN 显式开关和迁移   | 纯本地 CLI 行为                                   | 本地多进程 E2E + 三平台参数/监听断言      |
| 插件 canonical identity/managed policy     | 可用本地 fixture，策略必须在 I/O 前完成           | 禁网测试断言零 DNS/clone/spawn            |
| MCP 残余 lifecycle                         | fake stdio/HTTP/SSE server 可模拟乱序、断线、超时 | 三平台 contract tests                     |
| 统一 trust API 和迁移                      | 临时嵌套 repo/worktree 可覆盖                     | 单元 + 并发/损坏 store 集成测试           |
| Headless hook/subagent schema              | 不需外部服务                                      | NDJSON golden + 旧 consumer compatibility |
| archive/command/helper 核心                | 本地 HTTP、恶意 zip fixture、假 helper 足够       | 安全负向矩阵；私有源 live 后移            |
| Concise、classic/readline、环境配置        | 纯 CLI 能力                                       | PTY/快照/优先级测试                       |
| Gateway transport contract                 | fake gateway/proxy/cert fixture 可验证            | SSE、证书轮换、脱敏错误测试               |
| cgroup/选择性 egress 的策略与降级 contract | 可先实现探测和 fail-closed                        | 只有真实 enforcement cell 才能关闭任务    |

## 6. 建议下一期实施的外部依赖项

| 任务                                 | 外部条件                                                          | 本期保留的交付                                                                         |
| ------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 生产 Remote relay 与 Trusted Devices | 公网 relay、身份/设备登记、WebAuthn/passkey、撤销和运营部署       | loopback 默认、E2EE/协议状态机、fake relay                                             |
| Runner host 完整生命周期             | 注册/调度控制面、队列、租户、计费、仓库凭据和网络策略             | 现有 `cc cloud` client、host contract/fake server                                      |
| 跨机器 Agent 消息                    | 设备身份、中继、离线投递和审计服务                                | 本机 A2A/Team 收敛、envelope、TTL/backpressure                                         |
| 企业身份转发与额度控制               | 企业 IdP、签名密钥、网关额度 API、审计平台                        | signed envelope 接口；仅允许自建 Anthropic upstream proxy，目标为 Anthropic API 时拒绝 |
| 私有 GitLab/Marketplace/OAuth 全矩阵 | 测试账号、私有仓库、OAuth/PAT、不同 GitLab 部署                   | parser、策略、脱敏和模拟集成测试                                                       |
| 全平台选择性 egress/凭据 mask        | 真实 bwrap/proxy/network namespace、macOS entitlement/签名 helper | Linux/WSL contract 和 fail-closed 检测                                                 |

## 7. 推荐实施顺序与容量控制

初稿范围过大。建议本期只承诺以下主线，其余作为条件式或下一期任务。

| 顺序 | 本期承诺                       | 规模 | 完成定义                                           |
| ---- | ------------------------------ | ---- | -------------------------------------------------- |
| 1    | P0-1 Remote 默认姿态           | S～M | 默认无 LAN 监听、迁移/兼容测试通过                 |
| 2    | P0-2 插件源策略                | M    | canonical decision 在任何外部 I/O 前，负向矩阵通过 |
| 3    | P1-1 MCP 残余生命周期          | M    | 仅补真实残差，保留既有 timeout/cancel 行为         |
| 4    | P1-3 Headless 事件契约         | M    | additive schema、默认关闭、旧 consumer 兼容        |
| 5    | P1-2 Trust API/迁移设计        | M～L | strictest migration、损坏 fail closed、有审计投影  |
| 6    | P1-7 市场新源核心              | M～L | 复用缓存/catalog；archive/helper 对抗测试通过      |
| 7    | P2 Concise/keybinding/env 小项 | S～M | PTY/三平台 contract tests 通过                     |

P0-3 只有在 CI 具备真实阻断环境时计入本期完成；跨会话完整 transport、Runner host、生产 relay 和企业控制面不挤入本期承诺。

## 8. GitHub Actions 验证映射

不新增七个仅存在于文档中的“建议 job 名”。优先把测试接入现有 workflow，并确保相关路径能触发它们。

| 能力                                 | 现有 workflow                                                    | 需要补充                                                                                                                                             | 运行层级                          |
| ------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 普通 CLI/MCP/headless/trust contract | `.github/workflows/cli-ci.yml`（CLI CI）                         | 增加 fake MCP、trust migration、NDJSON compatibility；确认相关源码进入 paths                                                                         | PR smoke + 精确发布 SHA           |
| 沙箱/凭据/Remote 默认姿态            | `.github/workflows/cli-strict-sandbox.yml`（CLI Strict Sandbox） | paths 覆盖 project trust、plugin marketplace、remote-control、network/fs policy、MCP helper；同步扩展显式 test/命令清单；增加真实阻断或明确降级 cell | PR smoke + 发布硬门禁             |
| 插件供应链                           | `.github/workflows/ide-roadmap-marketplace-supply-chain.yml`     | 复用现有三平台×网络环境矩阵，增加 canonical policy、archive/helper、恶意 redirect/zip                                                                | PR 相关路径 + manual formal       |
| 长会话/重连/资源                     | `.github/workflows/cli-reliability-soak.yml`                     | 固定 warm baseline、绝对值+增长阈值、RSS/CPU/FD artifact                                                                                             | PR smoke + schedule/manual formal |
| 多会话/消息规模                      | `.github/workflows/cli-session-scale.yml`                        | A2A/Team route、TTL、queue full、rolling protocol version                                                                                            | PR 小规模 + schedule formal       |
| 后台/接管                            | `.github/workflows/cli-background-interaction-e2e.yml`           | 在现有后台稳定性用例之外扩展显式 test/命令清单，覆盖 Remote migration、重连幂等、旧状态兼容                                                          | PR 相关路径                       |

每个工作包的 DoD 必须同时审计 workflow `paths` 和其中显式列出的 test 文件/命令；“成功触发但没有执行新测试”不算覆盖。若手动 workflow 不能接收 `commit_sha`，应在不再移动的 ref 上运行或先增加精确 SHA 输入；不得把旧提交的绿灯算给新提交。CLI 发布仍要求同一精确提交上的 `CLI CI` 与 `CLI Strict Sandbox` 全操作系统矩阵通过。

## 9. 合并前负向测试清单

| 领域           | 必须失败或被阻断的场景                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Remote         | 无 relay 时不得监听 LAN；旧 token/epoch 重放；跨设备 scope 提权；重复 commandId；满队列/断线 ACK                                    |
| Marketplace    | trust 前 DNS/clone/spawn；SCP host 混淆；GitLab subgroup；helper shell 拼接/超时/超大输出；跨源 redirect；zip-slip/symlink/解压炸弹 |
| MCP            | disabled server 零 I/O；timeout 数值边界；取消/完成竞态；迟到响应；畸形 initialize；订阅重连 storm；错误对象 secret/path/env 脱敏   |
| Trust/headless | nested repo、路径大小写/复用、linked worktree、store 损坏/并发；hook stdout 不污染 NDJSON；旧 schema consumer 可继续读取            |
| Sandbox        | `\\?\`、`\??\`、junction/symlink、input redirect、不可见 Unicode、IPv6/redirect/DNS rebinding/domain fronting                       |

## 10. 不建议照搬

1. 不重做 MCP timeout/cancel/reconnect、marketplace cache、Remote replay ledger、Vim engine、A2A 队列或 `cc cloud` client。
2. 不把“配置了域名 allowlist”称为 strict sandbox；必须有不可绕过的 enforcement 和真实阻断证据。
3. 不把 Team 内消息直接当成跨独立会话；应复用底座并补身份、路由和故障语义。
4. 不把 fake control plane 通过称为生产 Runner 完成；它只能证明 contract。
5. 不因 Concise/spellcheck 等 UX 小项提高整体生产就绪结论。
6. 不盲目把 subagent 默认从 `fresh` 改成 fork；先明确缓存收益、隐私边界和成本行为。

## 11. 官方参考资料

- [Claude Code Releases](https://github.com/anthropics/claude-code/releases)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Headless mode](https://code.claude.com/docs/en/headless)
- [Environment variables](https://code.claude.com/docs/en/env-vars)
- [Model configuration](https://code.claude.com/docs/en/model-config)
- [Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Hooks](https://code.claude.com/docs/en/hooks)
- [Remote Control](https://code.claude.com/docs/en/remote-control)
- [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- [Self-hosted environments](https://code.claude.com/docs/en/self-hosted-environments)
- [Self-hosted environments reference](https://code.claude.com/docs/en/self-hosted-environments-reference)
- [Keybindings](https://code.claude.com/docs/en/keybindings)
- [Agent teams](https://code.claude.com/docs/en/agent-teams)

## 12. 审计边界

- 本文针对上述固定 SHA 做静态审计；合并前若 `github/main` 前进，SHA 仍表示审计快照，不表示合并时最新主分支。
- Claude Code 是闭源产品，本文只比较公开行为，不推断其内部实现。
- 本文的版本表是所有已发布版本段的高价值增量摘要，不是 UI 修复逐条抄录。
- “窗口内新增”与“基线遗留差距”已分开；后续版本应按新的 release 窗口追加。
- 没有执行环境的功能仅能标为 contract/prototype，不得标为生产完成。
