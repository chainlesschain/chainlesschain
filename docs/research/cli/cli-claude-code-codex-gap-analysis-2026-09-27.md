# ChainlessChain CLI 对照 Claude Code / Codex 最新版本的差距与优化分析（2026-09-27）

> 2026-10-04 发布推进：CLI **0.166.85** 已通过 OIDC 发布并[回读验证](./evidence/cli-0.166.85-publication-readback-84f204.json)，VS Code **0.37.130** 已在 [Open VSX 公开可用](../ide/evidence/vscode-0.37.130-publication-readback-84f204.json)。两者来自 `84f204db94`，其[完整发布门](./evidence/cli-ide-0.166.85-candidate-gates-84f204.json)通过。重新清点全部 18 个包后，[13 个独立子 npm 包的源码、版本和安装包均与公开版本一致](./evidence/child-package-release-reaudit-20261004-84f204.json)，没有漏发子包。JetBrains **0.4.147** 的发布测试发现诊断重复提交竞态，尚未发布；修复已纳入整合候选 **0.4.149**，仍待验收和发布。按用户要求，先发布后合并；进展见[共享实施状态](../cli-ide-gap-implementation-2026-09-27.md)。

> 审计日期：2026-09-27（Asia/Shanghai）
>
> 代码快照：`24911a536c9e9800c1e2e6b1d72e610841be4f5c`；开始审计时工作树干净。
>
> 本项目源码版本：CLI `0.166.77`、VS Code `0.37.118`、JetBrains `0.4.139`。源码版本不自动代表本次已核验公开发布状态。
>
> 官方最新可核验更新记录：Claude Code `2.1.283`（2026-09-25）；Codex CLI `0.157.1`（2026-09-26）。`0.157.1` 官方页面未提供可判定的发布亮点，能力增量主要依据 `0.157.0` 及之前版本。
>
> 参照格式：[2026-08-21 CLI 分析](./cli-claude-code-latest-gap-analysis-2026-08-21.md)；补充历史：[2026-09-12 综合分析及其 09-14～15 更新](../agents/CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)。
>
> 配套报告：[IDE 差距与优化分析](../ide/ide-claude-code-codex-gap-analysis-2026-09-27.md)。本文记录分析与建议，不表示建议已实施。

## 1. 复核后的结论

**新增验收：** `b2aa3aba08` 的[Linux/Windows/macOS formal 容量](./evidence/persistent-capacity-matrix-b2aa3aba08.json)均完成，三档并发读/更新/删除各 **8/8**及审计保留通过，100K 点读 p95 **25–51 ms**，全扫 query **6–8 秒**，不关闭 SLO/二级索引。VERIFY-01 的[36 任务与 9 首次安装计划](./verify01-plan-2026-10-04/README.md)已冻结并校验，所有执行结果仍为 `NOT_RUN`。

**最新发布阻断：** `b2aa3aba08` 的 IDE Windows 浏览器作业在 Node 22.12.0 下出现图片 snapshot 身份拒绝及缺少 DOM 测试依赖，[失败回执](../ide/evidence/browser-windows-failure-b2aa3aba08.json)保留 **109 通过 / 9 失败**和两组未加载 suite，继续修复。Windows ARM64 updater 的[原 gate 上下文诊断](./evidence/updater-arm64-gate-context-84f.json)再次复现 **64 通过 / 5 失败**，晚到成功结果不关闭原 60 秒失败。最新准确提交的 [ARM64 24 项真容器](./evidence/net02-docker-arm64-b2aa3aba08.json)及[全部子包/依赖复查](./evidence/child-package-source-reaudit-b2aa3aba08.json)通过；候选尚未发布或合并。

**本轮最新验收：** 100K canonical Memory 的 Windows formal 测量已完整通过重开、8 路读/更新/删除和审计后验；点读 p95 约 110 ms，全量 query 约 14 秒，索引及全局 SLO 仍开放。NET 在 `832f6b7270` 的 Linux ARM64 真容器 **24/24** 通过。随后真实 IDE 宿主发现 Windows 长路径图片保存错误，已整合最小修复及 **56/56** 回归，因此候选继续推进，完整准确提交门重新执行；全部证据与范围见[共享实施状态](../cli-ide-gap-implementation-2026-09-27.md)。

后续修复进度见 [共享实施状态](../cli-ide-gap-implementation-2026-09-27.md)。下文保留审计时的事实，不将正在实施的改动回填为当时已完成。

**先前候选记录（已由 `b2aa3aba08` 推进）：** [草稿 PR #402](https://github.com/chainlesschain/chainlesschain/pull/402) 冻结 `832f6b7270`，准备 CLI **0.166.86** / VS Code **0.37.131** / JetBrains **0.4.149**，尚未发布。canonical Memory 已增加有界分片和原子 v1 迁移，默认 shadow 不变；NET 显式 Linux 受控宿主已修复托管预验收暴露的观测品牌和并发探针问题，新准确提交的完整门继续执行。13 个子包 [Git tree 与公开基线一致](./evidence/child-package-source-reaudit-832f6b7270.json)，本轮无需重发子包。图片真实宿主性能失败、100K formal 测量和外部验收按实际结果保留，详见共享实施状态。

**2026-10-04 当前进度：** `d85af91aa1` 的 Memory 容量边界与 scoped generation/revision 溢出修复已随 CLI **0.166.85** 发布；图片草稿恢复与 Webview 页面实例 ACK 隔离已随 VS Code **0.37.130** 在 Open VSX 发布。旧版 0.37.127 / 0.37.128 的记录保留为历史。跨进程权限撤销接线、100K Memory 容量、真实模型/账单、任务效果与 SLO 等剩余项仍逐项保留，不以本批修复代表全部完成。

**Native 最新验收：** 已发布源码 `84f204db94` 的六平台重新验证为 **5 成功 / Windows ARM64 失败**；ARM64 构建与版本运行成功，更新器完整文件 64 项通过、5 项失败。已[归档各平台回执和失败日志](./evidence/native-validation-readback-84f-20261004.json)，正在按准确源码和完整文件继续诊断；不能据此声明六平台或签名 native 发布完成。

2026-10-03 新增验收：真实 Volcengine 单条双轮压缩旅程通过，冻结归档事实保留 100%；Codex 0.157.1 的历史准确提交三系统协议/turn 产物已独立回读。范围、原始证据和剩余条件见共享实施状态的 PERF-02 / CODEX-01 更新；不代表真实 Codex provider、获准工具执行或全部审计任务已经完成。

同日补入严格 settings 权限投影、Linux 固定监督器的准确源码 pkg 入口证据，以及 updater/Windows worker 的独立诊断；README、设计与用户文档、三站官网已按 `4e5bc593da` 更新部署并完成公网字节核对。跨进程撤销、完整 native 宿主与真实项目验收仍按共享实施状态保留。

后续 `f7ec90ec9b` 消除 pkg helper 目标准入的隐式进程探测并绑定有限构建预算；`fedc71423e` 修复 Windows ready 等待阻塞真实子进程 error/exit 的独立缺陷。新冻结 `13095fd426` 已完成六平台 standalone 构建与版本/status，但 Windows ARM64 后续回归及完整 CLI/Strict 门未通过；更新源码摘要及后续修复仍须按新准确提交重新验收。原慢事务问题和发布边界见共享实施状态，不标为全部完成。

**2026-10-03 历史候选：** 当时冻结候选为 **1fe7a46c0f**：Strict Sandbox **5/5** 作业及整体通过，IDE 矩阵 **18 成功 / 1 合法跳过**、不可变 VSIX 核验通过；CLI CI 的 Windows unit **14/16** 两轮 worker 异常退出，发布被阻断。ARM64 专项的原五项断言通过，但历史超时未复现的原因仍未隔离。文档源码 **4d22c79117** 已重新构建并部署三站，**20** 个 Git 输入及 **20** 个公网文件逐字节核对通过，见[部署回执](./evidence/documentation-deployment-2026-10-03-4d22.json)。该段不再代表当前发行状态；当前 CLI **0.166.85** 和 Open VSX **0.37.130** 的完整门及公开回读见本文开头。尚未完成的 native 验收仍单独保留。

当前最值得投入的是**最新模型的真实可用性、会话结果不丢失、受限联网的实际交付，以及已有能力的效果验证**。项目已经有相当完整的 Agent、权限、MCP、插件、评测和跨入口基础，再按功能名称补齐会造成重复建设。

本次新增的直接代码证据主要有四组：

1. **模型更新没有完整传播到协议、上下文和费用。** GPT-6 Sol/Luna 在当前目录中回落为 Chat Completions、128K 估算窗口；官方 GPT-6 Sol 页面要求有推理的工具调用使用 Responses。GPT-6 系列在主要价格表中仍为 unpriced，Opus 5.5 则命中旧 Opus 通配价格。
2. **实验 Codex App Server 的协议投影仍有接线前缺陷。** 官方 `agentMessage` 被当作 artifact、最终文本为空，其他 thread 的完成事件还能提前结束当前执行。该模块刻意没有生产调用方，不能将反例描述成默认 CLI 已发生的生产故障。
3. **部分能力有实现、有 CI，但验证对象没有覆盖最终使用路径。** 域名选择性 egress 仍明确 unsupported；App Server 真进程测试只到初始化与会话列表；容量脚本仍测全扫，未测已经实现的分页索引收益。
4. **外部 Agent 的帮助说明与实际准入不一致。** `orchestrate` 仍宣传 Claude/Codex 执行后端，但当前主路由因缺逐请求治理证据而硬拒绝这些 backend。应提前准确展示 blocked 原因，保留现有安全门。

IDE 当前用户路径上更直接的问题是后台标签页事件丢失、重载不补放历史、长回复全量重复解析，详见配套报告；这些应优先于扩大实验 App Server 集成。

### 1.1 判断口径

| 标记           | 含义                                                        |
| -------------- | ----------------------------------------------------------- |
| 本次复现       | 在当前源码上运行无付费模型的局部探针，观察到具体反例        |
| 静态确认       | 已追踪实现及调用关系，但未完成真实 provider / OS / 生产旅程 |
| 已实现，待验收 | 有源码或工程证据，剩余的是目标环境、效果或支持范围验证      |
| 建议新增       | 本文提出的改进，尚未实施；验收指标也不是当前性能结果        |

本次没有复现生产权限绕过。下文安全事项描述的是能力缺口或测试边界；保持 fail-closed 是已有优点。

## 2. 版本段增量审计

本节覆盖影响项目决策的版本段，不宣称逐条审计了上游全部修复，也不把未出现的版本号补成已发布版本。

| 上游版本段                       | 本次实际读取的官方增量                                                                                                                                       | 本项目处置                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code `2.1.239`～`2.1.269` | 新一轮会话、插件、IDE 改进；`2.1.269` 提供 `plugin eval`、IDE agent map 和配置管理增强                                                                       | 与 09-12 报告及后续交付核对。项目已有 plugin eval 双臂、重复采样、holdout 和非阻塞问题恢复，不重做入口                                   |
| Claude Code `2.1.270`～`2.1.277` | 每命令 `allowed_domains`、插件命令 digest 接受、AGENTS.md 回退、IDE 后台任务/记忆/指令入口，恢复与缓存一致性修复                                             | 优先补强受限网络与恢复不变量；已有项目指令、后台任务、Memory 和插件框架复用                                                              |
| Claude Code `2.1.278`～`2.1.283` | Opus 5.5；MCP URL elicitation；恢复历史保真、重复流事件处理；managed 非法嵌套值 fail-closed；模型 exact/deny；prompt-audit；IDE 权限状态、历史与流式性能修复 | 更新模型合同；将新安全案例映射到既有测试；将 IDE 恢复/性能作为当前批次。不能照搬 `2.1.282` 的 `claude-ai` 命名保留规则，`2.1.283` 已回滚 |
| Codex CLI `0.154.0`              | Astra、异步问题回答、实验 worktree、Windows 后台服务、权限恢复；移除旧 `codex mcp-server`                                                                    | 作为 09-12 历史基线。本项目已有异步交互、worktree 和 Responses 实现，不列为从零缺失                                                      |
| Codex CLI `0.155.0`～`0.156.1`   | daemon 更新及目标恢复、任务归档；worktree 默认启用、用量面板、fullscreen/voice、会话与沙箱修复                                                               | 优先吸收状态、草稿、恢复与运维行为。语音和终端主题是产品候选，不挤占可靠性工作                                                           |
| Codex CLI `0.157.0`～`0.157.1`   | Sol/Luna；符合条件的会话自动启动后台服务；跨应用 fork；HTTP/WS 持续网络策略及撤销；问题草稿恢复。`0.157.1` 无可判定亮点                                      | 最新模型能力和兼容探针需要更新；未知版本仍不得自动加入生产准入。不能臆测补丁版修复内容                                                   |

依据：[Claude Code changelog](https://code.claude.com/docs/en/changelog)、[Codex changelog](https://developers.openai.com/codex/changelog)。CLI、模型、IDE、桌面和云产品分别判断；本报告不比较模型编码正确率。

## 3. 已确认覆盖的能力

| 能力                                                     | 当前证据                                                                                         | 本轮判断                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Remote Control 默认边界                                  | `packages/cli/src/commands/remote-control.js:40,58,318`                                          | loopback、LAN 显式许可和 relay 失败不降级已有，不重开 8 月 P0-1                  |
| 插件源策略与供应链                                       | `packages/cli/src/lib/plugin-runtime/remote-source.js:177`；既有签名、缓存、provenance 模块      | 已有 transport 前策略判定，不重开 canonical source 基础建设                      |
| 模型 profile 与 Responses                                | `packages/cli/src/lib/model-capabilities.js:123`；`packages/cli/src/runtime/agent-core.js:11587` | 已接主调用链，问题是新增模型目录未跟上，而非没有 Responses                       |
| 插件效果评测                                             | 09-13/14 G05 实施记录，链接见 09-12 综合报告                                                     | 已有双臂、1–20 次采样、JSON/HTML、holdout；剩余是真实模型效果验收                |
| 中文记忆、deferred 问题恢复、后台分页索引                | 09-14 收口记录；当前 context-memory-kernel、ask-user 与 background 实现                          | 已有阶段实现，不能沿用首次审计中的“尚未开发”                                     |
| MCP、信任、headless 事件、跨会话、资源预算、Concise/键位 | 08-21 报告第 14～15 节及当前相应模块                                                             | 8 月独立 36/36 required、3/3 advisory 是历史已完成证据，不自动等于本次 HEAD 通过 |
| 真实测试基础                                             | Strict Sandbox 的 bwrap cell；IDE 真宿主；reliability 长时模式；09-15 真实模型试点               | 不能写成“只有 mock / 没有真实模型 / 没有 soak”                                   |
| npm 发布门                                               | `.github/workflows/npm-publish.yml:130` 及 release gate verifier                                 | 已要求精确提交的 CLI CI / CLI Strict Sandbox 三系统矩阵；继续保留                |

## 4. 建议任务与真实优先级

### 4.1 P0：仅在扩大安全能力承诺前设阻断条件

| ID     | 当前事实                                                                                                                    | 优先级与建议                                                                   | 验收                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| NET-01 | `agent-sandbox.js:508` 明确 `domain_policy_has_no_non_bypassable_backend`，执行前拒绝；Linux 真 cell 验的是 `network:false` | 受限联网交付为 P1；若要宣称“可联网且域名受强制限制”，该声明的发布前置条件为 P0 | 至少一个真实 Linux 强制出口后端；清空代理变量、原始 IP/socket、DNS/UDP、IPv6、子进程、redirect 和 WebSocket 均不能绕过；后端缺失继续拒绝 |
| NET-02 | 最新上游修复持续 HTTP/WS 策略撤销；本次未证明本项目具备所有对应行为                                                         | 在 NET-01 上增加策略 revision 与运行中撤销测试；这是新增审计项，不是已确认漏洞 | 已建立的连接也必须在策略收紧时终止；已批准调用不得自动继承被撤销的域名许可                                                               |

### 4.2 P1：先修用户路径，再补实验接线条件

| ID                        | 差距与证据                                                                                                        | 建议                                                                                             | 完成标准                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| MODEL-01                  | catalog 日期仍为 `2026-09-13`，官方目录仅显式列 `gpt-4o`、`gpt-6-astra`；Sol/Luna 回落 Chat Completions/128K      | 用版本化 model profile 统一协议、窗口、reasoning、输出限额和价格；保留 endpoint/account 适用范围 | 最新指定模型的真实工具往返、stream、reasoning 恢复、预算；自定义网关不得仅凭同名模型继承官方认证      |
| MODEL-02                  | GPT-6 价格未匹配；Opus 5.5 命中旧 `opus` 通配；legacy tracker 又使用另一组默认价                                  | 收敛价格来源，明确 unknown、估算、缓存和长上下文阶梯，禁止将新型号静默视为旧家族价格             | `cc cost`、预算、Eval 与旧统计 API 的口径一致；unpriced 可解释，不冒充零费用或官方账单                |
| READY-01                  | `commands/orchestrate.js:25,47` 宣传 Claude/Codex backend；`lib/agent-router.js:280,425` 过滤并硬拒绝 CLI backend | 区分 installed、configured、governance-admitted、runnable；任务分解前预检，帮助说明标明当前限制  | 仅安装外部 CLI 不显示可执行；明确 blocked reason、可用替代路径；不能靠删除治理检查“补齐功能”          |
| SESSION-01                | VS Code 后台标签页结果与重载历史的本次反例                                                                        | 复用 canonical session/revision/event cursor，补播放与草稿恢复；详细任务见 IDE 报告              | A/B 会话并行、后台完成、切回、reload、compaction、重连均能恢复最终结果，且不重跑副作用                |
| CODEX-01，接线前条件性 P1 | 实验 adapter 使用 exec JSONL 的 snake_case，而官方 App Server 用 camelCase；不隔离通知的 thread/turn              | 先修 schema、delta、terminal 归属，再决定是否接主链；保持未准入版本 fallback                     | 官方 schema fixture + 双 thread 交错反例 + 最新固定版本真实 turn 旅程；失败/中断/结果不明保持不同终态 |
| VERIFY-01                 | 现有真实模型试点为 Windows+Volcengine、10 题、两轮 20/20，且绑定 dirty source                                     | 复用已有 outcome 工具，补公开安装、真实项目、双 IDE 分层                                         | 预先冻结 30–50 个任务、OS/入口/provider、预算和维护观察窗口；报告原始成功率、补救、每成功任务成本     |
| PLATFORM-01               | Strict Sandbox 固定 `macos-15`；依赖 `/usr/bin/sandbox-exec`；Windows 部分 stdio 组合显式 unsupported             | 将支持声明细化为 OS/架构/后端/stdio；增设最新系统能力探针                                        | 缺后端给出准确诊断；支持组合有真进程证据，不能以一般单测通过代替 enforcement                          |

### 4.3 P2：测量与维护成本优化

| ID        | 现状                                                                                                                                      | 建议                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-01   | `persistent-capacity-benchmark.mjs:623,636,717` 仍测全扫，并明确 `indexApplied:false`、`paginationApplied:false`、`performanceGate:false` | 用同一数据集比较全扫、冷/热分页索引与失效重建；先定 p95/p99、RSS、锁等待 SLO，再决定 Memory 索引/归档投入                                                |
| PERF-02   | `context-memory-kernel/message-adapter.js:143`、`provider-context.js:134,240` 仍用 bytes/4 估算与固定留白；已有压缩及 tool 配对保护       | 用真实 usage 按中文/代码/emoji/大工具 schema 校准 token 误差，测压缩后的事实保真和任务成功率；不能仅凭估算写成已发生溢窗                                 |
| MCP-01    | `harness/mcp-client.js:3553` 对没有 reconnector / headersHelper 的普通 HTTP server 直接抛连接错误；已有 OAuth 等重连路径                  | 增加 stateless 短暂 404、stateful session 失效的恢复合同；区分重初始化与重放工具，不能为恢复而重复副作用。本次没有证实永久断连                           |
| BRIDGE-01 | 外部 Claude bridge 的 error→close 双完成、abort 不按 killGraceMs 升级可复现                                                               | 统一 finalize-once 与取消状态机，绑定进程树退出；在外部 agent 重新接入前完成。当前 AgentRouter 阻止未 attested CLI backend，不能称主编排正在运行这些缺陷 |
| MAINT-01  | `runtime/agent-core.js` 同时承载 prompt、provider transport、tool execution 与 turn scheduler；平台隔离模块也承载多平台职责               | 固化执行前持久化、权限不放宽、结果配对与未知结果不重跑等合同，再按职责做保行为拆分；以修复触及的独立实现数和维护工时衡量收益，不追求行数指标             |
| DOC-01    | 旧报告前段保留“未实现”、后段追加“完成”，容易重复开工                                                                                      | 在研究入口维护当前状态索引：实现 SHA、有效证据、待验收条件、替代关系。先用现有报告与 verifier，不另建证据系统                                            |
| UX-01     | 官方新增 prompt-audit、voice、fullscreen、usage 等入口                                                                                    | 可复用现有 doctor/instructions/cost/TUI 做低成本改善；语音、主题及新入口先测使用需求                                                                     |

## 5. 本期无需等待即可完成

### 5.1 模型合同与价格复现

调用当前 `resolveModelCapabilityProfile()`、`lookupRate()`、`estimateCost()` 和 `calculateCost()`，无网络、无模型费用，得到：

| 输入                          | 当前协议 / 窗口                              | 主价格表                        | legacy tracker             |
| ----------------------------- | -------------------------------------------- | ------------------------------- | -------------------------- |
| `openai / gpt-6-astra`        | Responses / 1,050,000                        | unpriced                        | 回落 OpenAI 默认价         |
| `openai / gpt-6-sol`          | Chat Completions / 128,000，provider-default | unpriced                        | 回落 OpenAI 默认价         |
| `openai / gpt-6-luna`         | Chat Completions / 128,000，provider-default | unpriced                        | 回落 OpenAI 默认价         |
| `anthropic / claude-opus-5-5` | Messages / 200,000，provider-default         | 输入/输出 `$5/$25` 每百万 token | 默认 `$3/$15` 每百万 token |

官方 [GPT-6 Sol 页面](https://developers.openai.com/api/docs/models/gpt-6-sol) 写明 1,050,000 上下文、128,000 最大输出；工具调用应使用 Responses，Chat Completions 的 function calling 只在 `reasoning_effort=none` 下支持。因此这里是**已确认的选择结果不匹配风险**，不是本次已执行账号上的 API 失败。官方 Claude `2.1.280` 记录 Opus 5.5 为 1M 上下文、基础输入/输出 `$4/$20`。

源码：`model-context-catalog.js:48,87`；`model-capabilities.js:175,186`；`agent-core.js:11587`；`llm-pricing.js:38,45,49,163`；`token-tracker.js:21,37,70`。以上文件均位于 `packages/cli/src/lib/`，`agent-core.js` 位于 `packages/cli/src/runtime/`。

注意：legacy tracker 的差异证明模块口径分叉，本次未证明同一用户流程同时调用两套计价。`estimateCost` 的零值附带 `matched:false/free:false`，不是宣称免费；`session-resource-budget.js:1137` 已对有美元预算的 unpriced usage 阻断，不能误报为预算必然无限绕过。价格更新还需处理缓存、长上下文、服务层级和自定义网关覆盖。

### 5.2 App Server 接线前反例

给当前 `CodexAppServerAdapter` 注入一个无外部进程的 client，配置已准入版本 `0.154.0`：

| 通知序列                                                                                   | 本次观察                                                     | 应有行为                        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------- |
| `item/agentMessage/delta` → `item/completed`，item.type=`agentMessage` → 本 turn completed | delta 进入 unknownMethods；item 被归为 artifact；output 为空 | 投影 assistant 文本并保留最终值 |
| 当前请求为 thread A / turn A；client 仅发 thread B / turn B completed                      | A 的 execute 返回 completed，记录的终态却属于 B              | 忽略/另行路由 B；A 保持待完成   |

依据：`packages/cli/src/lib/codex-app-server-adapter.js:31,51,68,185`；官方 [App Server 的 Items / Item deltas / Approvals](https://developers.openai.com/codex/app-server)。当前版本白名单最高 `0.154.0`，所以测试没有放宽准入来制造问题。

09-13 已修复的“提交结果不明时 fallback 重跑”和“failed 被投影为成功”不重开。当前 `scanProductionReferences()` 与删除演练刻意要求 adapter 可移除；env flag 本身不等于产品已接线。

### 5.3 外部 Agent 的“已安装”不等于“可执行”

`packages/cli/src/commands/orchestrate.js:25` 仍描述 “ChainlessChain → Claude Code/Codex agents”，并提供 `--cli-tool`、`--backends`。但 `packages/cli/src/lib/agent-router.js:280` 对调度候选过滤 `isCLI`，`:425` 的单任务路径也无条件拒绝外部 CLI，错误为 `EXTERNAL_MODEL_INGRESS_UNATTESTED`。原因是外部 Agent 内部的重试、压缩和模型请求不能由当前父进程证明已经过 durable ingress。

这是静态确认的产品说明/就绪状态不一致，不能写成桥接模块根本不存在，也不应以绕过治理为修复。建议安装检测保留，但 status/help/preflight 明确显示“已安装，当前未获准作为编排执行后端”；若要恢复执行能力，另行设计可验证的子协议与验收。

### 5.4 可立即安排的低风险批次

先修 MODEL-01/02、READY-01 与 IDE SESSION-01；并行修 CODEX-01 的纯协议反例、增加官方版本变更提醒。新目录须经审阅，未知版本继续 fail-closed。无需等待云控制面、生产身份或外部账号即可完成这些代码改进及局部验证。

## 6. 建议下一期实施的外部依赖项

| 项目                 | 依赖与真实剩余工作                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| NET-01               | Linux namespace、强制出口、真实 IPv4/IPv6/WS 流量；本机 Windows 探针不能替代                                           |
| 最新模型旅程         | 实际账号、模型权限、目标网关；验证工具、stream、重试、缓存和结算，不只做模型列表查询                                   |
| App Server 产品接线  | 先明确生产需求和治理入口；再做真实 thread/turn、审批、取消与恢复。官方仍将命令及 WS 传输标为实验，不应承担关键生产路径 |
| 首次安装与跨入口效果 | 固定公开产物、干净环境、真实项目任务；CLI、VS Code、JetBrains 分开统计                                                 |
| 企业与跨设备尾项     | 真实 relay/Runner、PKI、私库、撤销、目标 workload 资源约束；协议合同通过不等于完成部署                                 |

## 7. 推荐实施顺序与容量控制

1. **第一批：当前用户路径。** 修模型合同与价格目录、IDE 后台结果和重载恢复；保留可复现输入与回归。
2. **第二批：实际结果基线。** 复用 outcome/Eval，测首次成功率、任务成功率和维护成本；同步测分页索引与流式渲染，避免只增加测试数量。
3. **第三批：能力扩张。** 受限联网按需求投入；App Server 先协议与真实 turn 验证，通过后才决定接线。

每批限定一个主要失败原因和一个验收数据集；CODEX、NET、MODEL 和 IDE 任务共用 ID，不按两份报告重复立项。收益未实测时标为假设，不承诺“功能补齐即提升成功率”。

## 8. GitHub Actions 验证映射

| 工作流 / 机制                        | 已有价值                                                                 | 本轮应增加或保留的边界                                                           |
| ------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `CLI CI` / `CLI Strict Sandbox`      | 精确发布提交、三系统、真实 bwrap 与平台负向测试                          | npm 发布仍必须全部配置矩阵通过；MODEL 回归与平台组合证据需绑定同一提交           |
| `codex-app-server-compatibility.yml` | 固定四版本、三系统、生成 schema、真实 initialize / thread/list、删除演练 | 加 advisory 定时上游探针；准入前新增真实 turn。schema 中存在方法不等于执行过方法 |
| `cli-persistent-capacity.yml`        | 手动三系统 formal 测量                                                   | 改测当前分页路径；增加事先批准的 SLO 及三系统汇总后，才能称性能门                |
| 既有 reliability / IDE 真宿主门      | 已有长时模式、实际宿主和恢复基础                                         | 新增后台 A/B tab、reload、流式与附件负载旅程；不以旧 36-cell 自动覆盖新反例      |
| outcome metrics                      | 严格样本、费用、失败及维护记录                                           | 继续区分 BASELINE_RECORDED 与效果提升；未运行、缺证据、人工补救不能伪装原始成功  |

本次只读取工作流定义和历史回执，未查询当前 HEAD 的远端 Actions 状态，也未触发发布。

## 9. 合并前负向测试清单

- **模型：** 未知 ID、版本别名、自定义 endpoint、长上下文、无价格、有美元预算；不能把名称相似视为协议或价格已验证。
- **App Server：** 官方 camelCase、未知 additive event、两个 thread/turn 交错、迟到 terminal、重复 completed、usage 独立事件、审批取消；被接纳后的不明结果不能 fallback 重跑。
- **网络：** raw socket/IP、清空代理、NO_PROXY、DNS/UDP、IPv6、redirect、WS 和运行中撤销；先证明目标后端强制，再写已支持。
- **持久状态：** 已接受输入在 compaction 失败、断流、reload 后仍存在；工具结果未知与已失败分别保留；恢复不重复执行副作用。
- **上游安全增量：** managed 嵌套非法值、项目配置不能放宽组织策略、插件未识别记录不丢失、模型 deny/exact、Windows 跨 shell 删除边界。此组是建议新增映射，本次没有逐项复现项目漏洞。

## 10. 不建议照搬

| 上游变化                    | 本项目取舍                                                       |
| --------------------------- | ---------------------------------------------------------------- |
| 新增模型成为默认            | 不自动切用户模型；先验证协议、权限、成本和能力范围               |
| Auto mode 默认与收费分类器  | 保留既有权限治理；自动审批不能替代确定性边界                     |
| 语音、终端主题、品牌模型 UI | P2 候选，排在结果完整性和首次成功率之后                          |
| Codex daemon / App Server   | 复用现有 session、app-server、进程治理；不新增第四套 Agent 引擎  |
| 上游命名空间与已回滚规则    | 以当前官方记录为准，不固化中间版本行为                           |
| 云订阅、Slack、品牌账户体系 | 只吸收适用的协议、恢复和可观测性，保持本地、多模型及企业部署定位 |

## 11. 官方参考资料

以下页面均于 2026-09-27 实际抓取正文；“最新”仅表示当日页面可核验记录，不是未来版本保证。

1. [Claude Code changelog](https://code.claude.com/docs/en/changelog)：版本、Opus 5.5、MCP、managed policy、IDE 修复与回滚。
2. [Codex changelog](https://developers.openai.com/codex/changelog)：`0.154.0`～`0.157.1`，其中 `0.157.1` 无可判定亮点。
3. [Codex App Server](https://developers.openai.com/codex/app-server)：协议、schema 生成、Items、delta、审批与实验性边界。
4. [Codex Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)：沙箱、网络与审批边界。旧 `/codex/security` 当前是另一产品页面，不作为 CLI 沙箱依据。
5. [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)：协议、上下文、输出及价格适用条件。

抓取体 SHA-256（用于本次来源识别；网页不是不可变发布文件）：Claude changelog Markdown `dc55f421cfb20bcfa66040a902870425ab9bb9d5daf0c2a9bbe2af7678ef626d`；Codex changelog HTML `68e6f5619d5d5610e0fa223629fe5db658ce93c095dad6e80b5202a364350c41`；App Server HTML `6aab80ffc7791de9f62b2e0af11e0a16c141229818e2ed1f931670ed6d2c0475`。

## 12. 审计边界与本次验证

本轮为文档与代码审查，不修改产品实现。引用行号均基于开头的完整 SHA；历史报告中“已发布”“已通过”只在其原日期、提交与矩阵范围内有效。

| 验证                                     | 本次结果                                                                       | 限制                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 模型 profile / 价格纯函数探针            | 四个模型的回落/价格结果已复现，见 5.1                                          | 未调用真实账号；不能证明 provider 端错误或官方账单金额      |
| adapter / bridge 局部探针                | 官方事件投影、跨 thread terminal、error→close 双完成、abort 宽限四项反例已复现 | 注入 client/child，未运行真实外部 Agent；生产接线被明确限制 |
| 既有 adapter / bridge 单测               | 2 文件、35 项通过                                                              | 既有绿灯没有覆盖上述新增反例，不表示反例已修复              |
| VS Code ChatView 局部探针                | 后台完成后切回、重建后 ready 均未补发历史正文                                  | 直接调用真实类并注入宿主依赖；不是完整 IDE E2E              |
| 发布、三平台强制联网、最新模型、真人读屏 | 本次未执行                                                                     | 不据此更新生产验收为通过或失败                              |

后续应把已复现问题转为回归，再修实现。不要因本报告提出了验收项，就将它们计入已完成能力。
