# ChainlessChain 对照 Claude Code 2.1.221～2.1.238 的 IDE/CLI/Runtime 增量审计

- 初始评估日期：2026-08-21
- 实现复核日期：2026-08-23
- 上游状态：CHANGELOG 最新章节与 GitHub 最新已发布版本均为 [`v2.1.238`](https://github.com/anthropics/claude-code/releases/tag/v2.1.238)
- 上游不可变快照：[`anthropics/claude-code@8a8e81d098cbd0fae4ee5b9c853542945fe87016`](https://github.com/anthropics/claude-code/blob/8a8e81d098cbd0fae4ee5b9c853542945fe87016/CHANGELOG.md)（提交时间 `2026-08-20T20:33:43Z`）
- 上次对标基线：`2.1.220`（见 [原净差距与路线图](./CLAUDE_CODE_IDE_NET_GAPS_AND_ROADMAP_2026-08-01.md)）
- 增量范围：`2.1.221`～`2.1.238`
- ChainlessChain 原始审计基线：`github/main@1ef06b52a96a243ae2c340615dc6ef091835f311`，在干净隔离工作树上静态审阅
- ChainlessChain 当前实现复核基线：`github/main@28f92564f5c5ab203baf76e73350237fe747a8ba`；IDE 发布提交 `ce0b74e9a8618f5395ced746d21965dd1da20368` 已合入 `main`，并由 `ide-vscode-v0.37.63` 与 `ide-jetbrains-v0.4.96` 标签发布
- 审阅范围：以 IDE 为决策中心，同时覆盖会实质影响双 IDE 安全性、可靠性和性能的 CLI runtime、MCP、插件 marketplace、Remote Control 与 self-hosted runner 增量
- 官方补充依据：[实时 CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md)、[VS Code IDE 集成](https://code.claude.com/docs/en/ide-integrations)、[JetBrains 集成](https://code.claude.com/docs/en/jetbrains)、[Remote Control](https://code.claude.com/docs/en/remote-control)、[Chrome 集成](https://code.claude.com/docs/en/chrome)、[Subagents](https://code.claude.com/docs/en/agents)

> 上游事实判断仍以固定 SHA 为准，实时链接只用于观察后续变化。`2.1.230` 没有独立版本节，不能推断为漏审功能。本文前半部分保留 2026-08-21 的原始差距判断；当前实现状态以第 1.1 节和第九节为准。实现进入 `main` 本身不等于通过发布矩阵；本次 IDE 发布的 exact commit 与市场验证见第九节。它不替代本文定义的 Claude Code Increment Audit 36-cell 聚合证据。

## 一、结论

ChainlessChain 已经具备 Plan/Diff、计划 Markdown 审阅与逐项评论、双 IDE、Remote Control、统一 Sessions Workbench、插件签名/SBOM/PAC/离线缓存、Browser/Computer Use、Context Center 和 Diagnostics 等主干能力。最新 Claude Code 增量不支持再造一套 Chat、Plan、工作流或浏览器引擎。

2026-08-21 原始审计识别出的 12 个仓库内承诺项，当前都已有产品代码、定向测试、profile 锁和 Actions producer/verifier。原稿遗漏的 Remote Control P0 也已收口：默认监听已从 `0.0.0.0` 改为 loopback，direct LAN、`approve` 和 `interrupt` 都需要显式 opt-in，relay 启动失败不再静默回退 LAN。当前主要缺口已从“实现代码”转为“让当前 exact-head 的 36 个 required cell 完整运行并聚合”，以及真实 relay、企业基础设施、真人辅助技术听测和长时 soak 等外部尾项。

本文的“优先级”和“处置”是两个维度：

- `P0/P1/P2` 表示下一轮工程优先级，不自动改变现有版本的发布门；
- `本期承诺` 表示代码、测试及 GitHub Actions 证据均可在仓库内闭环；
- `本期候选` 表示完成承诺项后再做，不阻塞本期发布；
- `条件项/不立项` 表示必须先有产品需求或明确不做；
- `下期外部验收` 仅指真实账户、设备、专有基础设施、真人可用性或长时 soak，不能用文档结论代替。

下表保留 2026-08-21 形成的原始工程清单，便于追溯需求来源；它不再代表当前代码仍缺失。当前状态见第 1.1 节。

| 优先级 | 建议                                                                                     | 当前判断                                                                                                                           | 本期/下期结论                                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0     | `RC-DEFAULT`：Remote Control 启动后的默认暴露面与设备/session authority                  | 已确认功能 default-off；但显式启动后默认 `0.0.0.0:18800`、全 scopes，且无 relay 时 direct-LAN fallback；配对 URI 携带 server token | **本期承诺**：默认 loopback/outbound、LAN/approve/interrupt 显式 opt-in、project config 不得放宽或自启、token/日志回归；真实 relay/Trusted Devices/移动端下期 |
| P0     | `SEC-DELTA`：`2.1.221`～`2.1.238` 权限、路径、sandbox、worktree、hook、workflow 差分回归 | 已有较强 authority/sandbox，但缺逐项映射到 test id 的最新清单                                                                      | **本期承诺**；企业 MDM、专有 EDR、真人渗透下期                                                                                                                |
| P0     | `XSESSION`：通用跨会话消息、可靠 inbox、显式接收策略和一次性 idle 通知                   | 现有 Remote Control、A2A 与 Team mailbox 不等同于同一通用 session fabric；在已审阅范围未发现等价协议                               | **本期承诺**；真实跨机器/移动端/公网 relay/弱网 soak 下期                                                                                                     |
| P1     | `AX-TRANSCRIPT`：回复、审批、错误、状态独立播报及逐 turn heading                         | VS Code 已有 `role=log`、`aria-live`、article label 和焦点恢复；在已审阅范围未发现逐 turn heading/分类 announcer                   | **本期承诺**；NVDA/VoiceOver/Orca 真人语言质量下期                                                                                                            |
| P1     | `SESSION-UX`：Focus View、会话分组/批量移动、offline/cloud/pending/unread 状态           | Workbench 已统一 session authority 和动作；在已审阅范围未发现用户分组数据模型与 Focus View                                         | **本期承诺**；真人 UX 评审下期                                                                                                                                |
| P1     | `DIAG-SCALE`：Diagnostics 增量订阅、去抖、版本去重和固定规模性能门                       | 双 IDE 已读取/注入 diagnostics；在已审阅范围未发现统一增量调度器                                                                   | **本期承诺**；真实大型 monorepo 8h IDE soak 下期                                                                                                              |
| P1     | `IDE-INPUT-PERF`：文件建议与 `@mention` 的有界索引、取消和延迟门                         | VS Code 已有 mention provider，但 `2.1.227` 的输入性能增量不应误归到 diagnostics                                                   | **本期承诺**；超大真实 workspace soak 下期                                                                                                                    |
| P1     | `MCP-LIFECYCLE`：OAuth/redirect、初始化顺序、disabled server、helper trust/env、重连     | 已有 30s timeout、cancellation、initialize→tools/list、reconnect 和 helper trust，重点是兼容性补证而非重写                         | **本期承诺**；真实企业 IdP/mTLS 轮换下期                                                                                                                      |
| P1     | `SESSION-RUNTIME`：长 transcript、后台 event backlog、subagent tool result 的内存上限    | Webview transcript 与 CLI output 已有 cap/backpressure；仍需覆盖 recent-window 外结果释放与长会话 heap plateau                     | **本期承诺**；8h/24h 真人长会话 soak 下期                                                                                                                     |
| P1     | `PLUGIN-SOURCE`：Marketplace HTTPS archive+SHA 与动态 source/auth adapter                | 现有签名、SBOM、publisher trust、PAC/custom CA、不可变缓存更强；在已审阅 entry schema 未确认完整 source/auth 入口                  | archive+SHA **本期承诺**；`command`/`headersHelper` 只实现默认拒绝内核，是否启用为条件项；真实私库下期                                                        |
| P1     | `LOCATION-DRAIN`：把 self-hosted runner 优雅退场合入 Execution Location                  | 不新建 Claude 式托管服务；吸收 SIGTERM drain、lease/generation fence、park/reclaim、fresh proxy auth、base-dir 和资源限制          | **本期承诺**；专有宿主、企业代理、物理断电下期                                                                                                                |
| P1     | `BROWSER-EVIDENCE`：把 Browser/Computer Use 结果绑定到 session/diff/test evidence        | 浏览器动作与诊断面已更广，IDE connector 更偏 URL/console/network/screenshot 报告                                                   | **本期承诺**；真人登录态/CAPTCHA/第三方站点下期                                                                                                               |
| P2     | `PROMPT-POLISH`：Concise、prompt Markdown、spellcheck、`keybindingFlavor`                | 已有 output-style 框架；其余是在已审阅范围未确认的低风险 polish                                                                    | **本期候选**，不阻塞发布                                                                                                                                      |
| P2     | `GITLAB`：MR badge、worktree/MR URL、Marketplace 与 delivery provider adapter            | GitHub 路径更完整；是否正式支持 GitLab 尚属产品决策                                                                                | **条件项**：先确认产品范围；未确认前不进入本期承诺表                                                                                                          |

原路线图的 `12/19 尚未关闭、7/19 完成` 和整体 `NO-GO` 仍未改变。当前代码和证据构造已合入，但当前 exact-head 尚未取得 12 项 × 3 OS 的统一成功 artifact；真实账户、设备、专有基础设施、人工验收和长期运行尾项也不应由仓库内测试冒充完成。

### 1.1 2026-08-23 当前实现复核

当前统一合同是 [claude-code-increment-audit-contract.json](../tests/fixtures/claude-code-increment-audit-contract.json)，明确锁定 12 个 commitment、Linux/macOS/Windows 三个平台、`required + passed` disposition/outcome 以及 profile/threshold 一致性。仓库实现不是只有清单：每个 commitment 均有产品路径、producer、verifier 和测试 ID；[claude-code-increment-audit.yml](../.github/workflows/claude-code-increment-audit.yml) 只接受同一 release commit 上成功的七类源 workflow，并重新校验 source run、artifact digest 与 producer bytes 后聚合 36 个 required cell。

| ID                 | 当前代码事实                                                                                                                       | 关键 Git 记录                                          | 锁定证据                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| `RC-DEFAULT`       | 默认 loopback；LAN、approve、interrupt 显式 opt-in；project config 不得自启或放宽；relay 失败不回退 LAN                            | `0e0264ca35`、`e7fa206afe`、`dc8315d768`、`8d0f3ca6e0` | `rc-default/security-v1`，10 个 test id                   |
| `SEC-DELTA`        | `2.1.221`～`2.1.238` 安全映射已绑定真实测试、producer digest 与回滚语义                                                            | `46edcf34f7`、`2b8676ea64`、`5a80131a0f`、`1a4d101b9d` | `sec-delta-v2`，29 个 test id                             |
| `XSESSION`         | `SessionMessageFabric` 已实现 canonical route、accept/hold/refuse、TTL、容量/速率、幂等回执和一次性 idle 通知                      | `3aa3420707`、`dcb083e218`、`e926027c67`               | `claude-2.1.224-238-xsession/v1`，16 个 test id           |
| `AX-TRANSCRIPT`    | 双 IDE 已有稳定 turn heading、分类 announcer、流式去重、tool error label 与焦点恢复证据                                            | `eca788e151`、`3c4296e706`、`f166de4c26`               | `ax-transcript/v1`，7 个 test id                          |
| `SESSION-UX`       | CLI-owned group/focus schema、128-session 批量移动、CAS、offline/cloud/pending/unread 和 thinking collapse 已接入双 IDE            | `dbb3d4ac99`、`1b4e878a5f`、`ce0b74e9a8`               | `session-ux/v1`，11 个 test id                            |
| `DIAG-SCALE`       | VS Code/JetBrains 都已使用按 URI/version 的有界 snapshot scheduler，覆盖取消、去重与 10k 稳定快照                                  | `8065baa9b3`                                           | `diagnostics-scale/v1`，2 个固定规模 test id              |
| `IDE-INPUT-PERF`   | 双 IDE 已使用 100k-path 有界 mention index、workspace revision、取消和最大 200 候选                                                | `a26c27b145`                                           | `ide-input-perf/v1`，2 个固定规模 test id                 |
| `MCP-LIFECYCLE`    | disabled no-connect、init/discover 顺序、OAuth fence、mTLS provenance/rotation、subscription reconnect、single-flight 与脱敏已落地 | `9dca2a41c1`、`4c65f57fde`、`458cd7c632`、`7e5c7a11db` | `claude-2.1.229-238-mcp-lifecycle/v2`，17 个 test id      |
| `SESSION-RUNTIME`  | 旧 result live state 释放、durable resume/evidence、增量扫描、backlog cap、session scale 和 Windows writer 竞争修复已落地          | `ee34833f2d`、`49ddce1bce`、`ab24f3755b`、`c48dc73acd` | `session-runtime/retention-v1`，8 个 test id              |
| `PLUGIN-SOURCE`    | HTTPS archive+SHA、source adapter、不可变缓存/回滚和 governed command/helper 边界已实现；动态 source 默认拒绝                      | `32ac54a9e3`、`caba667ba8`、`a9191adc35`、`ca5ffe4ec3` | `plugin-source-marketplace-supply-chain/v1`，7 个 test id |
| `LOCATION-DRAIN`   | Local/WSL/Container/SSH 已接入 drain、lease/generation fence、park/reclaim、fresh proxy authority 与 target-side CPU/内存证据      | `f6ec3414eb`、`7cf4dd475f`、`d3d8397b7d`、`968faf057a` | `location-drain-v1`，6 个 test id                         |
| `BROWSER-EVIDENCE` | action/origin/revision、登录态脱敏、上传下载、console/network、screenshot diff 与 replay 已绑定 canonical evidence                 | `1be4325a15`、`1e86ee5a97`、`d2d75be804`、`b2205868c4` | `browser-evidence-local-two-origin-v1`，7 个 test id      |

统一 exact-head 审计能力由 `115aca0f60`、`88b5e425f6`、`32e384e1dd`、`62ce4c7a09` 等提交建立，并由 `b0ab0a10f2`、`9843b07245`、`9a76d5f805` 锁定覆盖和 provenance。`PROMPT-POLISH` 不属于 12 个 required commitment，但 Concise/readline、spellcheck 和 GitLab MR 本地 parser 已分别由 `f057a075ea`、`6ef669ced0` 等提交落地；真实词典、PTY 和 GitLab 实例仍是条件式验收。

## 二、逐版本增量复核

| Claude Code 版本 | 主要 IDE/运行时增量                                                                                                                                                                                                                          | 对 ChainlessChain 的净影响                                                                                                | 处置                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `2.1.221`        | VS Code Focus View；credential file mask；zsh/PowerShell（含 quoted path）权限修复；插件安全即时激活/catalog refresh；`/fork` worktree                                                                                                       | Focus View 是 UX 净缺口；权限解析、插件刷新和 worktree 隔离进入差分回归                                                   | `SESSION-UX`、`SEC-DELTA`、`PLUGIN-SOURCE` 本期                                                                |
| `2.1.222`        | destructive git 的 worktree 隔离；PreToolUse auto-allow 不得绕过 tool restriction；raw git blob diff；repo 配置不得开启 Remote Control；移除 Ultraplan                                                                                       | 安全边界价值高；Ultraplan 不立项，若 backlog 已有则移除                                                                   | `RC-DEFAULT`、`SEC-DELTA` 本期；Ultraplan 不立项                                                               |
| `2.1.223`        | Marketplace owner wildcard；不可见 Unicode/Tab 审批展示；workflow `dynamic import()`/crafted Bash 修复；agent `bypassPermissions` 不得绕过组织策略；fallback 告警                                                                            | 组织策略、审批展示和 workflow sandbox 进入矩阵；review 命令不另造入口                                                     | `SEC-DELTA`、`PLUGIN-SOURCE` 本期                                                                              |
| `2.1.224`        | self-hosted environments；HTTPS archive+SHA-256；跨会话 `SendMessage`/`ListAgents` 与 inbound policy；JWT/AWS mask；RC 恢复；移除 200 subagent cap                                                                                           | 形成 session fabric、供应链、runner 生命周期和结构化凭据遮罩；ChainlessChain 仍保留自有 agent budget                      | `XSESSION`、`PLUGIN-SOURCE`、`LOCATION-DRAIN`、`SEC-DELTA` 本期                                                |
| `2.1.225`        | agents workspace trust；headless/OAuth；大历史 RC resume；跨机器 SendMessage；Focus View 上下文修复                                                                                                                                          | workspace/repo identity、history 不串项目，Focus View 必须保留最新 todo、pending question 与 settled answer               | `SESSION-UX`、`XSESSION`、`SEC-DELTA` 本期                                                                     |
| `2.1.226`        | 官方仅记载 bug fixes/reliability                                                                                                                                                                                                             | 没有可识别的独立产品增量                                                                                                  | 不单独立项                                                                                                     |
| `2.1.227`        | 文件建议/`@mention` 性能；`claude-code-action` 在 GitHub-hosted runner 与 `allowed_non_write_users` 下的 Bash 修复                                                                                                                           | 输入性能与 diagnostics 分开测；CI 用户身份兼容进入安全矩阵                                                                | `IDE-INPUT-PERF`、`SEC-DELTA` 本期                                                                             |
| `2.1.228`        | 首会话 inbox；RC resume 防历史泄漏；Marketplace 高优先级整项覆盖；同步 skill 加固；跨会话展示；runner post-session 生命周期                                                                                                                  | 要求 queue 初始化、无 history leak、整项 precedence、远端 skill 低信任及 release fence                                    | `XSESSION`、`PLUGIN-SOURCE`、`LOCATION-DRAIN`、`SEC-DELTA` 本期                                                |
| `2.1.229`        | self-hosted server hooks；Marketplace `command`/link source；offline/cloud session；容器 CPU 感知；diagnostics 卡顿修复；VS Code groups；MCP OAuth loopback                                                                                  | 分别落入 session 状态、diagnostics、插件动态源、target-side quota 与 MCP 回归                                             | `SESSION-UX`、`DIAG-SCALE`、`PLUGIN-SOURCE`、`LOCATION-DRAIN`、`MCP-LIFECYCLE` 本期                            |
| `2.1.230`        | 官方 CHANGELOG 无独立节                                                                                                                                                                                                                      | 无事实依据，不推断增量                                                                                                    | 记录为“无独立发布说明”                                                                                         |
| `2.1.231`        | MCP pre-registered OAuth client redirect URI 修复                                                                                                                                                                                            | 已有 OAuth/helper 原语，补 `127.0.0.1` 与预注册 redirect 精确匹配                                                         | `MCP-LIFECYCLE` 本期                                                                                           |
| `2.1.232`        | `subagent_type:fork` 继承完整会话与 prompt cache；交互会话非 teammate agent 默认后台运行；`@session`、唯一名、inbound policy；GitLab Marketplace；RC reattach；sandbox/MCP/长 transcript 修复                                                | 分开评估上下文继承与后台调度，保留预算上限；吸收 session 寻址、nested repo 独立 trust、MCP fail-fast 和 transcript 增量化 | `XSESSION`、`SESSION-RUNTIME`、`MCP-LIFECYCLE`、`SEC-DELTA` 本期；GitLab 条件项                                |
| `2.1.233`        | GitLab MR worktree；Linux memory cgroup；TUI screen-reader 改进；runner 启动；MCP v2 subscription reconnect；回滚 `2.1.232` 的 Windows Cygwin-style symlink 与 input-redirection 权限改动，保留 PowerShell variable-write 修复               | 回滚项必须记作 `upstream-reverted`，不得盲目 parity；TUI a11y 不冒充 VS Code transcript a11y；资源限制需 target-side 证明 | `SEC-DELTA`、`MCP-LIFECYCLE`、`LOCATION-DRAIN` 本期；GitLab 条件项                                             |
| `2.1.234`        | GitLab badge；Windows NT namespace；跨会话/RC 同步；用户 prompt Markdown；mid-turn permissions；permission preview/MCP diagnostics redaction                                                                                                 | 权限修改需 revision/fence；预览不得因遮罩隐藏 command/path/destination；MCP 日志零 secret                                 | `SEC-DELTA`、`MCP-LIFECYCLE` 本期；`PROMPT-POLISH` 候选                                                        |
| `2.1.235`        | spellcheck；后台/云 event stream 不再全量重扫；权限展示与 grant 同义；跨会话消息大小预拒绝                                                                                                                                                   | 消息发送前拒绝并说明原因；长后台事件进入 backlog/heap 门                                                                  | `XSESSION`、`SESSION-RUNTIME`、`SEC-DELTA` 本期；spellcheck 候选                                               |
| `2.1.236`        | 同机 `notify_when_idle`；macOS wildcard deny precedence；RC 状态/队列；VS Code transcript live announcements/turn headings；git status/Monitor 规则                                                                                          | Windows/跨机支持属于主动增强，不写成上游 parity；transcript 与安全差分均可自动化                                          | `XSESSION`、`AX-TRANSCRIPT`、`SEC-DELTA` 本期                                                                  |
| `2.1.237`        | 内置 Concise output style                                                                                                                                                                                                                    | 可复用现有 output-style 框架，成本低                                                                                      | `PROMPT-POLISH` 本期候选                                                                                       |
| `2.1.238`        | `keybindingFlavor`；Marketplace `headersHelper`；runner defer shutdown/fresh proxy auth；长会话释放旧 subagent result；output style 不再漂移；MCP 顺序/disabled/helper trust-env；RC mid-turn 消息保留与 reconnect；跨会话 refused/full 回执 | “严格保序”是 ChainlessChain 推导验收，不是上游原文；其余分别进入插件、runner、MCP、session runtime 和消息证据             | `PLUGIN-SOURCE`、`LOCATION-DRAIN`、`MCP-LIFECYCLE`、`SESSION-RUNTIME`、`XSESSION` 本期；prompt/keybinding 候选 |

## 三、现有能力：不要重复建设

| 能力                  | 当前仓库证据                                                                                                                                                                                                                                                                                                 | 判断                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown Plan Review  | [plan-review.js](../packages/vscode-extension/src/chat/plan-review.js) 已生成完整 Markdown、逐项 comment、Reviewer Notes、revision、执行锁摘要和 allowed tools；JetBrains 也有 PlanReview/ReviewNote                                                                                                         | 不是缺口；只需继续保证双 IDE schema 一致和 stale revision fail closed                                                                                             |
| Sessions Workbench    | [sessions-workbench.js](../packages/vscode-extension/src/sessions-workbench.js) 已用 CLI-owned v2 projection 汇聚 local/background/remote/team/workflow，并绑定 revision 和动作预览；VS Code conversation 已有 unread/needsApproval/pendingInteractions                                                      | 不再造列表或 pending 状态；把既有状态收敛进 CLI-owned projection，再加 user group、focus、batch move、offline/cloud                                               |
| Remote Control 基础   | [remote-control.js](../packages/cli/src/commands/remote-control.js)、remote command ledger 和 registry 已有 E2EE relay/LAN pairing、QR、scope、sequence/replay ACK 和有界 ledger；durable approval bridge 已接入 challenge-bound resume，standalone `cc remote-control start` 尚未接入                       | 不再造配对/保序内核；修默认监听与 scope，把 standalone 主入口接入 durable membership，补 host crash 后 ledger 持久恢复、relay/direct 统一证据及跨-session receipt |
| Transcript 基础无障碍 | [chat-html.js](../packages/vscode-extension/src/chat/chat-html.js) 已有 `role=log`、`aria-live`、`aria-busy`、article label、tab keyboard 和审批后焦点恢复                                                                                                                                                   | 基础已完成；净差距是独立事件播报与逐 turn heading 导航                                                                                                            |
| Diagnostics/Context   | VS Code [vscode-facade.js](../packages/vscode-extension/src/vscode-facade.js) 与 JetBrains [IntellijEditorFacade.java](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/IntellijEditorFacade.java) 都会采集 diagnostics，目前仍可见全量迭代/拼接路径                               | 能力不缺；净增量是频繁更新时的 delta scheduler、取消、去抖、上限和性能证据                                                                                        |
| MCP 生命周期          | [mcp-client.js](../packages/cli/src/harness/mcp-client.js) 已有 30s call timeout、cancellation、initialize→tools/list、一次重连/认证刷新；[mcp-headers-helper-trust.js](../packages/cli/src/lib/mcp-headers-helper-trust.js) 已有 workspace/source fingerprint trust                                         | 不重写 lifecycle/helper；补 OAuth redirect、discover 顺序、disabled no-connect、v2 subscription、诊断脱敏的兼容证据                                               |
| 长会话/消息上限       | Webview transcript 已限制 node/entry；CLI [output-backpressure.js](../packages/cli/src/runtime/output-backpressure.js) 与 [team-mailbox.js](../packages/cli/src/lib/agent-team/team-mailbox.js) 已有 backpressure、大小/容量和 cursor 原语                                                                   | 复用有界 primitive；补 subagent result recent-window 释放、后台 event 增量消费和 heap plateau                                                                     |
| Plugin 供应链         | [marketplace-remote-artifacts.js](../packages/cli/src/lib/plugin-runtime/marketplace-remote-artifacts.js)、[marketplace-network.js](../packages/cli/src/lib/plugin-runtime/marketplace-network.js)、publisher trust、signature/SBOM 和 transaction journal 已覆盖签名、不可变缓存、PAC/custom CA、离线与恢复 | 不再造 installer；只扩展 source/auth adapter，并保持现有 digest/authority/transaction 内核                                                                        |
| Execution Location    | [execution-location-target.js](../packages/cli/src/lib/execution-location-target.js) 支持 WSL/SSH/Container launcher；Local 是基础路径；Cloud 只有 catalog/handoff 占位，Remote Control 属控制面而非 execution target                                                                                        | 不宣称 Cloud resume 已完成；runner 增量合入现有 location contract，并新增 target-side quota 传播/证明                                                             |
| Browser/Computer Use  | IDE [chrome-connector.js](../packages/vscode-extension/src/chrome-connector.js) 展示 URL、console、network、screenshot 与 DOM 大小/截断元数据，不展示完整 DOM；Desktop 已有 browser actions、workflow、recording、diagnostics 和 Computer Use                                                                | 不复制 Claude 浏览器品牌入口；统一 evidence、origin permission 和凭据边界                                                                                         |
| Output style          | [output-styles.js](../packages/cli/src/lib/output-styles.js) 已支持内置、项目和个人 style                                                                                                                                                                                                                    | 只需增加 Concise 并验证 resume 中不漂移，不需要新框架                                                                                                             |

## 四、本期承诺与自动化合并门

### 4.1 证据规则

只要主要退出条件能在仓库测试或 GitHub Actions 内确定性验证，就列为本期承诺；外部尾项单独延期，不拖成模糊的“整体未完成”。合并证据必须满足：

1. required check 运行在 PR head 或待发布 exact SHA，不能引用旧提交、局部 matrix 或超时结果；
2. Linux、Windows、macOS 的配置单元全部成功；scheduled/soak 只能补强，不能替代 required PR check；
3. 优先扩展现有 `CLI CI`、`CLI Strict Sandbox`、`IDE Extensions`、`IDE Roadmap Safety Matrix`、`IDE Roadmap Accessibility Performance`、`IDE Roadmap Marketplace Supply Chain`、`IDE Roadmap Execution Location`、`CLI Session Scale`、`CLI Reliability Soak`，避免另造平行 workflow；
4. 新增聚合 artifact `claude-code-increment-audit-<sha>`，其 `manifest.json` 必须含 `headSha`、OS/runtime、profile version、阈值、实测值、test id、producer digest 和 required/advisory disposition；
5. required 阈值不可在同一功能 PR 中放宽；确需调整时单独提交基线变更并说明机器规格和统计方法。

现有门中可直接复用的数值基线如下；新增 profile 在表中明确标为“新增 required”。

| Profile                     | GitHub-hosted 环境                                                    | Required 阈值                                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 现有 IDE transcript/a11y    | `ubuntu-24.04`、`macos-15`、`windows-2025`；Node `22.12.0`、Java `21` | 2,000 messages；input-to-paint P99 ≤ 1,000 ms；scroll P99 ≤ 500 ms；diff/log paint ≤ 5,000 ms；Workbench paint ≤ 3,000 ms；Node RSS 增量 ≤ 512 MiB；renderer heap 增量 ≤ 256 MiB；handle/descriptor 增量 ≤ 32；关键语义缺失数 = 0 |
| 现有 CLI session scale      | `ubuntu/windows/macos-latest`；Node `22.12.0`                         | list P95 < 200 ms；resume P95 < 2,000 ms；list/resume peak RSS < 100 MiB；resume I/O ≤ 1 MiB                                                                                                                                      |
| 新增 diagnostics scale      | 同 IDE 三 OS，固定 fixture                                            | 10,000 diagnostics burst 到稳定 snapshot P95 ≤ 1,000 ms；单次 event-loop/EDT 占用 ≤ 200 ms；Node RSS 增量 ≤ 512 MiB；renderer heap 增量 ≤ 256 MiB；丢失/重复/过期 version 数 = 0；50,000 规模先作为 scheduled advisory            |
| 新增长会话 result retention | 同 CLI/IDE 三 OS，`--expose-gc` 固定 fixture                          | 5,000 个 32 KiB subagent results 离开 recent window 后，连续两次稳定 GC 样本差异 ≤ 10%，相对基线净 heap 增量 ≤ 128 MiB；可恢复历史摘要与 durable evidence 不丢失                                                                  |

### 4.2 本期实施表

| ID                 | 本期最小实现                                                                                                                                                                                                                                                                                          | Required Actions/自动化退出条件                                                                                                                                                                                                                                                                                                                                                                | 下期外部尾项                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `RC-DEFAULT`       | 保持 default-off；显式启动默认只绑定 loopback/outbound；direct LAN 必须 `--allow-lan` + 明示风险，approve/interrupt scope 单独 opt-in；project/local config 只能关闭，不能自启或放宽；把 standalone start 接入 durable membership，保留并验证短期 pairing、device/session identity、撤销和有界 ledger | 扩展 `CLI CI` 与 `IDE Roadmap Safety Matrix`：无命令/flag 不开桥，仅存在配置不自启；默认无非 loopback listener；LAN 缺 opt-in fail closed；project `true`/host widen 被忽略；duplicate/stale/revoked device、challenge resume、crash-ledger restore；日志/错误/status/非配对 state/Actions artifact 零 token；只有用户显式请求的 pairing URI/QR 可作为短期 confidential output，禁止留存或上传 | 真实 relay、Trusted Devices/passkey、移动端与公网弱网                                    |
| `SEC-DELTA`        | 建立 `claude-2.1.221-238-security-map`，每个上游修复只能标为 `existing-test`、`new-test`、`not-applicable+reason` 或 `upstream-reverted`；覆盖 shell/path、trust/authority、sandbox/worktree/socket、approval/redaction 四组                                                                          | `CLI CI` + `CLI Strict Sandbox` + `IDE Roadmap Safety Matrix` 三 OS；每行有 test id 和 producer digest；`2.1.233` 回滚的 Cygwin symlink/input-redirection 项不得标成 parity success                                                                                                                                                                                                            | 企业 MDM、专有 EDR、真实攻击复核                                                         |
| `XSESSION`         | 复用 background queue、TeamMailbox 和 remote ledger；新增 canonical session authority、跨进程/机器寻址、durable receipt、accept/hold/refuse、expiry、唯一名及一次性 `notify_when_idle`；消息 ≤ 256 KiB、默认 queue cap 100                                                                            | `CLI CI`/`CLI Reliability Soak`：同机 32 进程；第 101 条、256 KiB+1、乱序、重复、崩溃/重启、policy 切换、断连重接、无 history leak；结果必须区分 delivered/refused/full/expired；双 IDE projection contract                                                                                                                                                                                    | 两台真实机器、移动端、E2EE relay、弱网 8h soak                                           |
| `AX-TRANSCRIPT`    | 每 turn 稳定 heading；独立 announcer 只播 assistant reply、permission request、tool error、status transition；避免流式 token 重播；修 `tool err` accessible label；保留焦点恢复                                                                                                                       | 扩展 `IDE Roadmap Accessibility Performance` 与 `IDE Extensions`；使用上表 2,000-message/性能阈值；heading keyboard journey、AX tree、announcement 去重、关键语义缺失 = 0                                                                                                                                                                                                                      | NVDA/VoiceOver/Orca 真人听测与语言质量                                                   |
| `SESSION-UX`       | 把既有 unread/needsApproval/pendingInteractions 收敛进 CLI projection；持久化 groupId/name/order；双 IDE create/rename/delete/multi-move；Focus View 保留 live tool、最新 todo、pending question、settled answer                                                                                      | `IDE Extensions` + `IDE Roadmap Accessibility Performance`：CAS/stale revision；128 sessions、多窗口、多选、重载恢复、键盘操作；thinking-only summary 完成后重新折叠                                                                                                                                                                                                                           | 真人 UX 评审                                                                             |
| `DIAG-SCALE`       | 在真实采集 facade 上增加按 URI/version 的 delta scheduler、debounce、severity summary、bounded payload、旧任务取消；Context Center 只消费稳定 snapshot                                                                                                                                                | 扩展 `IDE Roadmap Accessibility Performance`；执行上表 10k required，50k scheduled advisory；三 OS artifact 记录 P50/P95/P99、heap/RSS 与 event-loop/EDT 最大占用                                                                                                                                                                                                                              | 大型真实 monorepo 与 8h IDE soak                                                         |
| `IDE-INPUT-PERF`   | 文件/符号 suggestion 使用有界增量索引、query cancellation、workspace revision 和最大候选数；mention 渲染不读取不可信路径内容                                                                                                                                                                          | `IDE Extensions` 三 OS：100k-path fixture，20 个快速连续 query 只提交最后一版；P95 suggestions ≤ 200 ms；候选 ≤ 200；取消/越界/denied path 泄漏数 = 0                                                                                                                                                                                                                                          | 超大真实 workspace 与远程文件系统 soak                                                   |
| `MCP-LIFECYCLE`    | 复用完整 MCP helper lifecycle；补 OAuth `127.0.0.1`/pre-registered redirect、initialize-before-discover、disabled no-connect、malformed/version fail-fast、mTLS rotation、v2 subscription reconnect、diagnostic redaction                                                                             | 扩展 `CLI CI` 与 `CLI Reliability Soak` 的 `mcp-security-soak`：RPC order 精确匹配；disabled outbound count = 0；helper 10s/64 KiB/128 headers/16 KiB 单值既有上限保持；401/403 只刷新一次；重连无 storm；日志 secret 命中 = 0                                                                                                                                                                 | 企业 IdP、真实 mTLS 证书轮换、专有 MCP server                                            |
| `SESSION-RUNTIME`  | transcript/event 消费增量化；旧 subagent tool result 离开 recent display window 后释放 live render state，仅保留 durable 摘要/evidence；所有 backlog 明确 cap/backpressure                                                                                                                            | 扩展 `CLI Session Scale`、`CLI Reliability Soak` 与 IDE perf gate；执行上表 5,000×32 KiB retention profile 和现有 session scale 阈值；compaction/resume 语义一致                                                                                                                                                                                                                               | 8h/24h 真人长会话与生产模型流量                                                          |
| `PLUGIN-SOURCE`    | 先交付 HTTPS archive+SHA 与 source adapter；Marketplace helper 复用 MCP 的 trust/timeout/refresh/process-tree-kill，但新增 catalog/entry authority、same-origin、净化 env 与 preflight revision 绑定；动态命令保持默认拒绝                                                                            | 扩展现有 `IDE Roadmap Marketplace Supply Chain` 三 OS 12-cell：本地 HTTPS、SHA mismatch、source precedence、offline/cache/crash recovery；helper failure/timeout、token rotation、cross-origin redirect、secret scan；安装命令未确认不得执行                                                                                                                                                   | 真实私库、组织 trust root、PAC/custom CA、key revocation；动态 source 产品启用需另行决策 |
| `LOCATION-DRAIN`   | 在既有 Local/WSL/SSH/Container contract 加 accepting/draining/parked/reclaiming、lease/generation fence、SIGTERM drain、post-session hook fence、fresh proxy auth、base-dir 可写预检；复用 broker primitive但必须把 CPU/内存 quota 传播到 target workload                                             | 扩展现有 `IDE Roadmap Execution Location`：各 target 100 trajectories；SIGTERM/lost poll/token rotation/checkout failure/result-return；在 WSL/Container/SSH 目标内部触发 CPU/内存超限并证明 kill/park，不得只观察宿主 wrapper                                                                                                                                                                 | 企业 runner、生产代理、NFS/object store、物理断电                                        |
| `BROWSER-EVIDENCE` | 把 action、origin permission、console/network、screenshot、DOM snapshot digest/截断元数据与 session/revision/diff/test run 绑定；重放动作标识副作用和凭据边界                                                                                                                                         | `IDE Extensions` 本地测试站点：跨 origin、登录态脱敏、上传/下载、console/network failure、screenshot diff、session replay；artifact secret 命中 = 0                                                                                                                                                                                                                                            | CAPTCHA、真实第三方站点与人工登录授权                                                    |

推荐顺序：`RC-DEFAULT`/`SEC-DELTA` → `XSESSION` → `MCP-LIFECYCLE`/`SESSION-RUNTIME` → `AX-TRANSCRIPT`/`SESSION-UX`/`DIAG-SCALE`/`IDE-INPUT-PERF` → `PLUGIN-SOURCE`/`LOCATION-DRAIN` → `BROWSER-EVIDENCE`。安全与 session authority 先稳定，再扩大动态执行入口。

### 4.3 候选、条件项与明确不立项

| 项目                                           | 处置                                                                                                              | 进入本期的前置条件                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `PROMPT-POLISH`                                | 本期候选：Concise、safe prompt Markdown、spellcheck capability、`keybindingFlavor`；不阻塞发布                    | 所有 P0/P1 required gate 已完成；style resume/fork 不漂移，Markdown XSS/Unicode/长文本全绿 |
| Marketplace `command`/`headersHelper` 产品启用 | 条件项；本期只做默认拒绝的安全内核                                                                                | 明确私有 registry 需求、managed policy 和 owner；否则维持 disabled                         |
| `GITLAB`                                       | 条件项；delivery runner 已是 adapter 驱动，只需新增 GitLab adapter 并清理 GitHub-shaped projection，不另造 engine | 产品明确支持 GitLab；先用 fake API/glab 做 contract，真实凭据旅程下期                      |
| Ultraplan                                      | 不立项；若 backlog 已存在则移除                                                                                   | 无                                                                                         |

## 五、关键设计建议

### 5.1 Remote Control 保留 P2P，但默认边界必须最小

Remote Control 当前不是自动开启，这是正确基础；问题出在显式启动后的监听和授权默认值。建议把 outbound relay 与 direct LAN 分成不同 authority：relay/loopback 可走普通 opt-in，direct LAN 必须显式 `--allow-lan`、展示监听地址和 scopes，并让 approve/interrupt 再次确认。project/local config 可以关闭，但不能让检出仓库自动打开 listener、扩大 scope 或写入长期 token。已有 sequence ledger/replay ACK 和 durable approval bridge 的 challenge resume 应保留，并让 standalone start 也取得相同 membership authority；新增工作还要处理默认值、host crash 持久恢复和跨 transport 证据一致性。配对 URI/QR 是用户显式请求的短期机密输出，不得混入日志、status、state 或 Actions artifact。

### 5.2 Cross-session 不要复用普通聊天字符串

Remote Control、Team mailbox 和通用跨 session 消息虽然都传文本，但 authority 不同。建议共享 envelope，不共享默认授权：

```text
message envelope
  identity: messageId + idempotencyKey + source/target session authority
  policy: accept | hold | refuse + expiry + maxBytes
  lifecycle: queued -> accepted/held -> delivered | refused | full | expired
  evidence: sender receipt + recipient durable cursor + correlation trace
```

“写入本地队列成功”不等于“对方已收到”。满队列、rate limit、refuse、目标列表未完全读取和离线状态都必须返回可区分结果，不能静默 success。

### 5.3 Marketplace helper 复用完整 MCP lifecycle，但不复用其 authority

MCP `headersHelper` 已具备 fingerprint trust、10s/64 KiB/128 headers/16 KiB value 上限、净化环境、进程树终止、一次认证刷新和撤销机制。Marketplace 应复用这套完整 lifecycle，但不能直接复用 MCP 的 source/workspace authority。插件 helper 还应满足：

- catalog 级 helper 只用于 catalog 和同源 archive；entry 级 helper 只在安装/升级该 entry 时运行；
- 在执行前展示完整命令并默认 `[N]`，非交互必须显式 `-y` 或 managed policy；
- 不继承 credential 环境变量，输出只接受有界 JSON header map；禁止 `Cookie`、hop-by-hop header 和跨源转发；
- helper command/source、catalog digest、archive SHA、publisher trust、用户确认和最终安装 transaction 绑定到同一 preflight revision；
- 日志、错误、Actions artifact 不得输出 token/header 值。

### 5.4 Transcript 需要“视觉流”和“辅助技术事件流”分离

现有 `aria-live` 放在整个 transcript 上，容易在流式更新时重复朗读或吞掉审批。建议保留视觉 transcript，同时增加隐藏、去重、分类的 announcer；每个 turn 使用稳定 heading（如“Turn 12, Assistant response”），审批卡使用可聚焦 group 和完整 grant 摘要。自动化可验证 DOM/AX tree，真实朗读自然度仍必须人工验收。

### 5.5 Self-hosted 增量应合入 Execution Location，不应另建云产品

ChainlessChain 现有 Local/WSL/SSH/Container 执行路线；Cloud 仅是 catalog/handoff 占位，尚不能宣称 resume 已完成；Remote Control 是控制面，不是 execution target。Claude self-hosted runner 值得借鉴的是生命周期协议，不是 Team/Enterprise 服务形态。重点是 graceful drain、lease/generation fence、session park/reclaim、fresh proxy credentials、workspace trust、result-return fence，以及把 CPU/内存 quota 真正传播到目标 workload。限制宿主 wrapper 不等于限制 WSL/SSH/Container 内的进程，Actions 必须从目标内部证明超限行为。

### 5.6 长会话上限要区分 live state 与 durable evidence

释放 recent display window 外的 subagent result，不等于删除审计历史。live render state 只保留有界 head/tail、摘要和定位符；完整或加密原始 evidence 按既有 retention policy 落盘，由 session/revision/digest 引用。compaction、resume 和导出读取 durable 层，UI/agent loop 不得反复 normalize 全量 transcript 或扫描整个后台 event stream。

## 六、不建议复制的增量

| 上游能力/变化                                              | 不复制原因                                                                            | ChainlessChain 处置                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Ultraplan                                                  | 官方在 `2.1.222` 已明确移除                                                           | 从候选路线删除；保留现有可审阅 Plan/Workflow                          |
| 取消 200 subagent 总量上限                                 | ChainlessChain 已有 session budget、并发/深度/成本/时间 authority；无限放开会削弱治理 | 保留显式上限和可观测拒绝，仅优化合理默认值                            |
| Claude 账户/订阅耦合的 Remote Control 与 self-hosted cloud | 产品身份、计费和云控制面不适配                                                        | 只吸收协议、恢复、状态与 runner 生命周期语义                          |
| 直接共享浏览器登录态                                       | ChainlessChain 面向本地/P2P/企业场景，凭据边界更复杂                                  | 使用 per-origin capability、显式授权、脱敏 evidence；CAPTCHA 交还用户 |
| 新建第四套 workflow/agent engine                           | 现有 Dynamic Workflow、Team、Batch、Background 和 Workbench 已足够丰富                | 继续收敛 projection、authority、恢复和证据                            |
| 为 GitLab 单独复制一套 Delivery UI                         | 会再次造成 GitHub/GitLab surface 分叉                                                 | 先做 provider adapter，再决定是否发布 GitLab 产品入口                 |

## 七、审计附录

### 7.1 `SEC-DELTA` 最小清单

| 分组                    | 必须逐项映射的上游增量                                                                                                                                                                                   | 证据要求                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| shell/path              | zsh conditional、PowerShell quoted path/variable write、NT namespace/UNC、deny path trailing slash、raw blob diff、`status.showUntrackedFiles=no`                                                        | 三 OS test id；审批预览与实际 parser 使用同一 normalized representation                                     |
| trust/authority         | repo config 不得开启 RC、nested repo 独立 trust、agent `bypassPermissions` 不得绕过 org policy、PreToolUse auto-allow、server/Notification hooks、IDE diff re-prompt、mid-turn permission revision/fence | 记录 workspace/repo canonical identity、source digest、authority revision；trust/source 变化后旧 grant 失效 |
| sandbox/worktree/socket | destructive git main checkout、workflow dynamic import/crafted Bash、shared temp socket 的预置 symlink/他人目录、sandbox binary/ripgrep scope、GitHub-hosted runner `allowed_non_write_users`            | `CLI Strict Sandbox` 三 OS fail closed；禁止只测 mock parser                                                |
| display/redaction       | invisible Unicode/Tab/wide glyph、JWT/AWS credential mask、approval 完整 command/path/destination、MCP diagnostic secret、permission comment/grant disclosure                                            | 完整 grant 仍可理解，secret scan 命中 = 0，不能用遮罩隐藏授权目的地                                         |
| upstream rollback       | `2.1.232` Windows Cygwin-style symlink 与 input-redirection 权限变更在 `2.1.233` 被回滚                                                                                                                  | 标记 `upstream-reverted`，审计 ChainlessChain 当前更窄行为；不得将旧行为作为 parity 目标                    |

### 7.2 静态检索范围与置信度

以下命令在 `github/main@1ef06b52a96a243ae2c340615dc6ef091835f311` 的干净工作树执行。它们说明本文判断边界，不替代实现 owner 的 schema、运行时和测试复核。

```powershell
rg -n '0\.0\.0\.0|--host|relay|allowRemote' packages/cli/src/commands/remote-control.js packages/cli/src/lib/remote-control.js
rg -n 'initialize|tools/list|headersHelper|redirect|disabled|reconnect|timeout' packages/cli/src/harness/mcp-client.js packages/cli/src/lib/mcp-headers-helper.js packages/cli/src/lib/mcp-headers-helper-trust.js
rg -n 'workspaceTrust|AutoExecScan|project-mcp-trust|trusted workspace' packages/vscode-extension packages/jetbrains-plugin packages/cli/src
rg -n 'SendMessage|ListAgents|crossSessionInbound|notify_when_idle|accept|hold|refuse' packages/cli/src packages/vscode-extension/src packages/jetbrains-plugin/src
rg -n 'diagnostic|workspace.onDidChange|debounce|version' packages/vscode-extension/src/vscode-facade.js packages/jetbrains-plugin/src/main
rg -n 'MAX_LOG_NODES|TRANSCRIPT_ENTRY_MAX_CHARS|backpressure|MAX_.*QUEUE|MAX_.*RESULT' packages/vscode-extension/src packages/cli/src
rg -n 'headersHelper|archive|command|source' packages/cli/src/lib/plugin-runtime packages/cli/src/harness/mcp-client.js
```

| 判断                                                       | 主要审阅路径                                                           | 结果                                                                                                    | 置信度             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------ |
| RC default-off、启动后 `0.0.0.0`/全 scopes/direct fallback | CLI command/lib、headless runner、VS Code host、remote registry/ledger | 已由代码路径正向确认                                                                                    | 高                 |
| MCP timeout/init/reconnect/helper trust 已存在             | MCP client、helper、trust 与对应 tests                                 | 已由实现及测试正向确认                                                                                  | 高                 |
| Diagnostics 仍有全量采集/拼接路径                          | VS Code/JetBrains facade                                               | 已由实现正向确认                                                                                        | 高                 |
| transcript/output/mailbox 已有上限                         | chat HTML、output backpressure、TeamMailbox/background queue           | 已由常量、状态机和 tests 正向确认                                                                       | 高                 |
| 通用 session-addressable fabric                            | 已查 Remote/A2A/Team/Background/Workbench                              | 在已审阅范围未发现同一 canonical authority + inbound policy + durable receipt；已有可复用局部 primitive | 中；实施前 confirm |
| user-defined session group/Focus View                      | CLI projection、VS Code/JetBrains Workbench、conversation state        | 在已审阅范围未发现完整数据模型；unread/pending 已存在                                                   | 中；实施前 confirm |
| Marketplace archive/command/header entry contract          | plugin-runtime catalog/network/preflight 与 MCP helper                 | 供应链内核已确认；完整 entry source/auth surface 在已审阅范围未确认                                     | 中；实施前 confirm |

### 7.3 已审阅但不单独立项的增量类型

| 类型                                                                     | 处置                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Claude 账户、订阅、usage limit、prompt suggestion 和模型 cache 告警      | 属上游账户/模型产品语义；仅保留 provider-neutral 状态/错误 contract，不做逐字 parity  |
| 终端 repaint、Backspace、Ctrl+L/Cmd+K、1-row nvim、宽字符换行等 TUI 细节 | 有明确 ChainlessChain 复现时进入 CLI reliability；不因上游单点修复另建 IDE 路线       |
| Claude Desktop/mobile/claude.ai 专属入口、计费和云控制面                 | 不复制产品身份；只吸收安全、状态、恢复和证据语义                                      |
| Chrome 品牌入口与直接共享登录态                                          | 继续使用 Browser/Computer Use 的 provider-neutral capability 与 per-origin permission |
| GitLab UI/Marketplace/MR worktree                                        | 保留为条件项；没有产品决策前不计入本期承诺或完成率                                    |

## 八、最终判断

对照 `2.1.238`，ChainlessChain 的功能广度并不落后。2026-08-21 识别出的仓库内工程缺口已在当前 `main` 形成产品实现、测试、三平台 producer/verifier、锁定 profile 与统一聚合器；Remote 默认姿态、session fabric、MCP lifecycle、长会话、双 IDE accessibility/session UX/diagnostics/input、插件源、Execution Location 和浏览器证据不再应写成“尚未开发”。

当前剩余工作分成两类：

1. **当前 exact-head 发布证据**：必须让 Safety、Reliability、Accessibility、Session Scale、Marketplace、Execution Location 和 IDE Extensions 在同一提交成功，再运行 `Claude Code Increment Audit` 聚合 36 个 required cell。旧 SHA、部分矩阵、排队中、取消或超时的 run 都不能复用。
2. **仓库外尾项**：真实 relay/移动端/弱网、企业 IdP 与 mTLS 轮换、第三方私库和 GitLab、专有 runner/代理/共享存储、真人 NVDA/VoiceOver/Orca 与 8h/24h soak。这些不应以本地 fixture 或 fake control plane 冒充完成。

`PROMPT-POLISH` 的本地能力已部分落地，但仍不进入 12 项 required 完成率；动态 marketplace source 的产品启用仍需 managed policy 与 owner 决策；Ultraplan 继续明确不立项。CLI `0.165.8` 与双 IDE 的发布证据已不再是缺口；原路线图的 `12/19 尚未关闭、7/19 完成` 与整体 `NO-GO` 仍针对独立 36-cell 聚合和仓库外尾项保持不变。

## 九、当前 exact-head 运行状态

### 9.1 历史快照（2026-08-23 09:06）

`github/main@c48dc73acd8996cc36a3d6c4361a38e94ae9d473` 的当时运行状态与 `CLI CI` run `32607630246` 的失败分片，属于本节此前记录的历史快照：real-spawn fixture 违反 config-home/workspace 分离规则，数个旧 `paths.js` mock 未继承新增导出，离线 changelog 与 canonical `CHANGELOG.md` 漂移。后续修复已作为发布链路的一部分复核；不能再将该快照表述为当前发布状态。

### 9.2 当前 IDE 发布状态（2026-08-23 11:06，Asia/Shanghai）

IDE 发布 exact commit `ce0b74e9a8618f5395ced746d21965dd1da20368` 已进入 `github/main@28f92564f5c5ab203baf76e73350237fe747a8ba`。该 commit 的 `CLI Strict Sandbox`（run `32604667250`）、`CLI CI`（run `32604664813`）和 `IDE Extensions`（run `32604662647`）均已成功完成。

- `ide-vscode-v0.37.63` 触发的 `IDE Extensions` run `32611779800` 成功；Open VSX `chainlesschain.chainlesschain-ide` `0.37.63` 已通过公开列表验证。
- `ide-jetbrains-v0.4.96` 触发的 `IDE Extensions` run `32611783299` 成功；`com.chainlesschain.ide` `0.4.96` 已完成 JetBrains Marketplace 上传及发布后列表验证。
- `SESSION-UX` 证据要求已由 `ce0b74e9a8` 收窄至专用证据工作流，常规 JetBrains 发布单测不再错误要求该环境变量；六个 JetBrains 实机环境均已通过。

这一定义当前结论为：**本次双 IDE 发布已经完成，发布 commit、三项所需门禁、两个发布标签和两个市场的发布后验证均已成功。** 但这不等同于宣称当前 `github/main` 已取得本文所定义的完整 `Claude Code Increment Audit` 36-cell artifact；该审计仍应按其独立的 exact-head 合同和外部尾项判断，不能由 IDE 发布结果替代。

### 9.3 当前 CLI 发布状态（2026-08-23，Asia/Shanghai）

CLI `0.165.8` 的不可变发布标签 `v-npm-0-165-8` 精确指向 `28f92564f5c5ab203baf76e73350237fe747a8ba`。该提交的 `CLI CI` run `32614151603` 完成 Ubuntu、macOS、Windows 全矩阵，`CLI Strict Sandbox` run `32614151467` 的三个 native boundary job 全部成功。npm 发布 run `32616155187` 的 exact-SHA gate、完整测试、不可变 tarball/SBOM、Trusted Publishing、provenance 与公开 registry 回读也全部成功。

npm 公开 registry 当前报告 `chainlesschain@0.165.8` 且 `latest=0.165.8`；tarball SHA-1 为 `56b8043e611ed03e3d6057b037df34879048269f`。先前 `v-npm-0-165-7` 候选在 package/publish 之前因 Agent SDK 测试夹具的 HOME 隔离问题停止，因此没有发布 `0.165.7`，且该不可变标签未被移动；修复通过新版本和新标签完成。

这一定义 CLI 发布结论为：**`0.165.8` 已从通过完整三平台门禁的精确提交发布并完成公开回读。** 它与 9.2 的双 IDE 发布共同证明当前交付版本已完成各自发布门禁，但仍不能替代独立的 36-cell `Claude Code Increment Audit` 聚合或仓库外验收。

## 十、任务完成情况汇总

本节以第 1.1 节和第九节的当前实现及发布复核为准。前文保留的 2026-08-21 原始差距用于追溯需求来源，不再单独代表当前代码状态。

状态定义：

- **完成**：对应代码、定向验证和当前适用的版本发布门禁已经完成。
- **实现完成/审计待闭环**：产品代码、测试、profile、producer/verifier 已完成，但独立 36-cell exact-head 聚合尚未取得。
- **条件完成**：本地核心或 adapter 已实现，仍需产品启用决策或真实外部环境验收。

### 10.1 总体完成情况

| 维度 | 状态 | 当前结论 |
| --- | --- | --- |
| 12 个 required commitment 的仓库内实现 | 完成 | 12/12 均已有产品代码、定向测试、锁定 profile、Actions producer/verifier 和 test ID |
| VS Code 发布 | 完成 | `0.37.63` 已通过发布标签触发的 `IDE Extensions`，并完成 Open VSX 公开列表验证 |
| JetBrains 发布 | 完成 | `0.4.96` 已通过发布标签触发的 `IDE Extensions`，并完成 JetBrains Marketplace 上传和发布后列表验证 |
| IDE 发布门禁 | 完成 | IDE 发布 exact commit 的 `CLI Strict Sandbox`、`CLI CI` 和 `IDE Extensions` 均成功；六个 JetBrains 实机环境通过 |
| CLI 配套发布 | 完成 | CLI `0.165.8` 已通过 Ubuntu、macOS、Windows 发布矩阵、供应链门禁和 npm 公开回读 |
| 36-cell 增量审计 | 未完成 | 仍需在同一 exact-head 上聚合 12 个 profile × Linux/macOS/Windows，共 36 个 required cell；已发布 IDE/CLI 的各自门禁不能替代该聚合 |
| 仓库外生产验收 | 未完成 | 真实 relay、企业基础设施、真人辅助技术、真实私库/第三方站点、专有 Runner 和长时 soak 等仍待外部环境验收 |
| 文档整体发布判断 | `NO-GO` | 仅针对独立 36-cell 聚合和仓库外尾项；不代表 VS Code、JetBrains 或 CLI 版本尚未发布 |

### 10.2 Required Commitment 完成情况

| ID | 优先级 | 状态 | 仓库内已完成 | 尚未完成/验收边界 |
| --- | --- | --- | --- | --- |
| `RC-DEFAULT` | P0 | 实现完成/审计待闭环 | 默认 loopback；LAN、approve、interrupt 显式 opt-in；project config 不得自启或放宽；relay 失败不回退 LAN | 真实 relay、Trusted Devices/passkey、移动端和公网弱网；统一 36-cell 聚合 |
| `SEC-DELTA` | P0 | 实现完成/审计待闭环 | `2.1.221`～`2.1.238` 安全差分已映射到真实测试、producer digest 和上游回滚语义 | 企业 MDM、专有 EDR、真人攻击复核；统一 36-cell 聚合 |
| `XSESSION` | P0 | 实现完成/审计待闭环 | `SessionMessageFabric`、canonical route、accept/hold/refuse、TTL、容量/速率限制、幂等回执和一次性 idle 通知已实现 | 跨机器、移动端、E2EE relay 和弱网 8 小时 soak；统一 36-cell 聚合 |
| `AX-TRANSCRIPT` | P1 | 实现完成/审计待闭环 | 双 IDE 已有稳定 turn heading、分类 announcer、流式去重、tool error label 和焦点恢复 | NVDA、VoiceOver、Orca 真人听测；统一 36-cell 聚合 |
| `SESSION-UX` | P1 | 实现完成/审计待闭环 | CLI-owned group/focus、128-session 批量移动、CAS、offline/cloud/pending/unread 和 thinking collapse 已接入双 IDE | 真人 UX 评审；统一 36-cell 聚合 |
| `DIAG-SCALE` | P1 | 实现完成/审计待闭环 | 双 IDE 已使用按 URI/version 的有界 snapshot scheduler，并覆盖取消、去重和 10k 稳定快照 | 真实大型 monorepo 和 8 小时 IDE soak；统一 36-cell 聚合 |
| `IDE-INPUT-PERF` | P1 | 实现完成/审计待闭环 | 双 IDE 已使用 100k-path 有界 mention index、workspace revision、取消和最大 200 候选 | 超大真实 workspace 和远程文件系统 soak；统一 36-cell 聚合 |
| `MCP-LIFECYCLE` | P1 | 实现完成/审计待闭环 | disabled no-connect、init/discover 顺序、OAuth fence、mTLS provenance/rotation、subscription reconnect、single-flight 和脱敏已落地 | 企业 IdP、真实 mTLS 轮换和专有 MCP server；统一 36-cell 聚合 |
| `SESSION-RUNTIME` | P1 | 实现完成/审计待闭环 | 旧 result live state 释放、durable resume/evidence、增量扫描、backlog cap、session scale 和 Windows writer 竞争修复已落地 | 8/24 小时真实模型长会话；统一 36-cell 聚合 |
| `PLUGIN-SOURCE` | P1 | 实现完成/审计待闭环 | HTTPS archive+SHA、source adapter、不可变缓存/回滚和 governed command/helper 边界已实现；动态 source 默认拒绝 | 真实私库、组织 trust root、PAC/custom CA、key revocation 和动态 source 产品启用决策；统一 36-cell 聚合 |
| `LOCATION-DRAIN` | P1 | 实现完成/审计待闭环 | Local/WSL/Container/SSH 已接入 drain、lease/generation fence、park/reclaim、fresh proxy authority 和 target-side CPU/内存证据 | 企业 Runner、生产代理、共享存储和物理断电；统一 36-cell 聚合 |
| `BROWSER-EVIDENCE` | P1 | 实现完成/审计待闭环 | action/origin/revision、登录态脱敏、上传下载、console/network、screenshot diff 和 replay 已绑定 canonical evidence | CAPTCHA、第三方真实站点和人工登录授权；统一 36-cell 聚合 |

以上 12 项均不应再描述为“尚未开发”。准确状态是：**仓库内产品实现和证据生产能力已完成，但独立 36-cell exact-head 聚合尚未闭环。**

### 10.3 候选项、条件项与不立项

| 项目 | 状态 | 已完成 | 尚未完成/处置边界 |
| --- | --- | --- | --- |
| `PROMPT-POLISH` | 条件完成 | Concise、`readline`、spellcheck 和 GitLab MR 本地 parser 已分别落地 | 不属于 12 个 required commitment；真实词典、PTY 和完整 prompt polish 继续按候选项处理 |
| Marketplace `command`/`headersHelper` 产品启用 | 条件完成 | 默认拒绝的安全内核、governed command/helper 边界和 managed policy 控制已实现 | 需要明确私有 registry 需求、owner 和产品启用策略，否则维持 disabled |
| `GITLAB` | 条件完成 | 本地 MR/worktree parser 已实现 | 完整 GitLab adapter、Marketplace、真实 API/glab 和凭据旅程仍需产品范围确认 |
| Ultraplan | 不立项 | 已明确不复制上游已移除能力 | 若存在遗留 backlog，应移除而不是实施 |

综上，VS Code `0.37.63`、JetBrains `0.4.96` 和 CLI `0.165.8` 已完成各自发布门禁和公开发布验证；12 个 required commitment 的仓库内实现也已全部落地。当前不能关闭的是统一 36-cell `Claude Code Increment Audit`、依赖生产基础设施或真实账号/设备的外部验收，以及少数需要产品决策的条件项。
