# ChainlessChain 对照 Claude Code / Codex 的 IDE、CLI 与 Runtime 增量审计（2026-09-27）

> 2026-10-04 Actions 后续修复：[PR #404](https://github.com/chainlesschain/chainlesschain/pull/404)的准确 `22c0e4036c` 已通过 [Windows 浏览器 **157/157**、实际 codec/动画 Worker、Workbench 与两 origin 整项作业](./evidence/browser-windows-repair-22c0e4036c.json)，[ARM64 Docker **24/24**](../cli/evidence/net02-docker-arm64-22c0e4036c.json)亦通过。Windows Node 22.12.0 路径/句柄设备号 **0 / 742408122** 通过 BigInt 身份及读取前后额外句柄核对兼容，保留跨卷、纳秒修改、预算与清理检查。原 **132 通过 / 17 失败**及[诊断](../cli/evidence/actions-gap-repair-20261004.json)保留；[实施状态](../cli-ide-gap-implementation-2026-09-27.md#2026-10-04用户指定的-arm64--windows-actions-失败修复)继续区分指定作业通过、完整发布门及其他真实验收。

- 审计日期：2026-09-27（Asia/Shanghai）。
- 代码快照：`24911a536c9e9800c1e2e6b1d72e610841be4f5c`；开始审计时工作树干净。
- 本项目源码版本：VS Code `0.37.118`、JetBrains `0.4.139`、CLI `0.166.77`；不据此推断本次已经核验公开市场发布。
- 上游最新可核验记录：Claude Code `2.1.283`（09-25），Codex CLI `0.157.1`（09-26）。后者未给出可判定亮点，主要能力依据 `0.157.0` 及此前记录。
- 章节格式参照：[2026-08-21 IDE 增量审计](./CLAUDE_CODE_IDE_LATEST_INCREMENT_GAP_ANALYSIS_2026-08-21.md)。历史状态同时核对 [09-12 综合报告及 09-14～15 更新](../agents/CLAUDE_CODE_CODEX_LATEST_GAP_ANALYSIS_2026-09-12.md)。
- 范围：双 IDE、其 Chat / App Server / CLI runtime 接口及实际测试路径。Codex CLI、IDE、桌面和云端不混为一个支持承诺。
- 配套：[CLI 分析](../cli/cli-claude-code-codex-gap-analysis-2026-09-27.md)。本文是新增审计快照，未实施产品修复。

## 一、结论

**最新发布阻断：** `b2aa3aba08` 的 Windows 浏览器作业在配置的 Node **22.12.0** 下出现图片 snapshot 身份拒绝和缺少 `happy-dom`，[准确失败回执](./evidence/browser-windows-failure-b2aa3aba08.json)记录 **109 通过 / 9 失败**、两组未加载 suite；实际 codec 步骤没有执行。依赖声明及身份差异继续修复，新版宿主恢复与完整发布门仍待验收。

**本轮最新修复：** 新版真实图片旅程定位到 Windows 超长草稿路径的临时目录创建错误，保存失败发生于解码 Worker 启动前。`81a3f8b7a0` 整合原生路径前缀修复，包含实际超过 260 字符路径的完整写入及清理回归，相关 **56/56** 通过。旧候选 `832f6b7270` 因此继续推进；CLI **0.166.86** / VS Code **0.37.131** / JetBrains **0.4.149** 均须新准确提交完整验收后发布。此前 Workbench 性能失败仍保留，不能由路径修复推断其已解决。

后续修复进度见 [共享实施状态](../cli-ide-gap-implementation-2026-09-27.md)。下文保留审计时的事实，不将正在实施的改动回填为当时已完成。

**先前候选记录（已由 `b2aa3aba08` 推进）：** [草稿 PR #402](https://github.com/chainlesschain/chainlesschain/pull/402) 冻结 `832f6b7270`，对齐 CLI **0.166.86**、VS Code **0.37.131** 与 JetBrains **0.4.149**。版本元数据、Marketplace 说明及配对检查通过，完整准确提交矩阵正在执行，尚未发布；先发布并核验，再合并。子包 [13 个 Git tree 与公开基线相同](../cli/evidence/child-package-source-reaudit-832f6b7270.json)，无需重复发布。

**2026-10-04 当前进度：** VS Code **0.37.130** 已在 Open VSX 发布，[公开下载包与正式 VSIX 完全一致](./evidence/vscode-0.37.130-publication-readback-84f204.json)，包含图片草稿恢复、40px 缩略图和页面实例 ACK 隔离。配对 CLI **0.166.85** 已先行完成 [OIDC 发布及公开回读](../cli/evidence/cli-0.166.85-publication-readback-84f204.json)。两者来自 `84f204db94`，其 CLI CI **68/68**、Strict Sandbox **5/5**、IDE **18 成功 / 1 预期跳过**，见[完整门回执](../cli/evidence/cli-ide-0.166.85-candidate-gates-84f204.json)。Microsoft Marketplace 不在本次已发布声明内；真人听测、性能 SLO 和双 IDE 真实项目验收仍按未完成条件保留。

**JetBrains 发布补查：** **0.4.147** 的六个真实宿主组合通过，但最终 JUnit 在 `inFlightCancellationRetainsUntouchedUris` 检出同一诊断 generation 重复提交，发布被阻断。Astra 在原生产代码上确定性复现：诊断内容与两个 URI 均正确，提交计数却为 2。保留失败标签，修复候选推进到 **0.4.148**；该修复随后纳入 **0.4.149**；**0.4.148** 未发布，旧候选检查不作为新候选的发布证明。40px 仅是显示尺寸，完整动画解码预算仍未验收。子包复查覆盖清单、依赖、来源与安装包，[13/13 与公开包逐字节一致](../cli/evidence/child-package-release-reaudit-20261004-84f204.json)，无需重复发布。

**后续图片预算候选 `48fd92562a`：** 已增加结构/累计帧预算、可终止解码 Worker 和两 IDE 同句柄有界读取，本地相关 55 项通过；新版真实 Windows 宿主两次在原 Workbench 性能门失败，p95 为 2,442 / 2,194 ms，尚未进入图片恢复。已保存[失败回执和全部计时样本](./evidence/image-budget-host-failures-48fd92562a.json)，继续定位，不把旧宿主成功转移为新版验收。恢复本轮工作时 PR #401 已合并；该事实不代表 JetBrains 0.4.148 或后续源码已发布。

此前 `cce30a34f1` 开发 VSIX 的 Windows x64 / VS Code 1.132.0 完整打包宿主旅程通过：后台 A/B 历史、PNG/GIF 草稿跨 tab 与重启恢复、图片摘要与实际解码、四类错误反馈、零自动发送均已观察；[独立回读](./evidence/image-draft-recovery-windows-20261004.json)核对 31 个产物。首轮激活失败保留，其他平台、JetBrains 附件及真人/真实模型验收不据此关闭。

2026-10-03 后续实施已补入实际 VS Code 宿主流式测量，以及冻结归档合同下的真实 Volcengine 双轮压缩验收。性能优化和 JetBrains 原生宿主测量继续按准确提交验收，当前有效证据及未闭合范围统一记录于共享实施状态。

以下三段保留 **2026-10-03 历史发布过程**；其中的市场版本与冻结候选不是当前状态，当前发行以本节开头的 0.37.130 / 0.166.85 回执为准。

同日已归档准确 `96cbf6ba56` 的三系统 **18** 个真实宿主旅程，并完成设计、用户文档与官网部署。Strict Sandbox 与 IDE 矩阵通过，但 CLI CI 的 Windows worker 同提交重跑仍失败；后续诊断未复现，不能替代完整发布门。当时 VS Code **0.37.127** 为未发布候选，性能 SLO 与辅助技术验收仍开放。

冻结分支随后整合到 `13095fd426` 并重新运行完整门；Strict 与 CLI 已发现安全 map 的过期 producer 摘要，`88f9dc7d09` 修正后相关 **345/345** 测试通过，后续 updater 修复已提交。新提交仍需完整托管验收；截至本次市场回读，Open VSX `latest` 仍为 **0.37.126**，未推 `0.37.127` 发布 tag。新的门、诊断与候选身份统一见共享实施状态，历史成功不转移。

当前准确冻结为 **1fe7a46c0f**：Strict Sandbox **5/5** 作业及整体通过，IDE 矩阵 **18 成功 / 1 合法跳过**、不可变 VSIX 内部身份与字节摘要核验通过；CLI CI 的 Windows unit **14/16** 两轮报告 worker 异常退出，完整门仍未通过。单文件及 ARM64 专项的局部通过均不替代此门。文档提交 **4d22c79117** 的三站构建、原子部署与公网 **20** 文件逐字节核对已完成，见[部署回执](../cli/evidence/documentation-deployment-2026-10-03-4d22.json)。**0.37.127 尚未发布成功**；完整门和公开产物回读完成后才更新推荐版本。

**优先补齐“结果能回看、输入不丢、模式状态可信、长回复可操作”，收益比增加新 Agent 或工作流入口更明确。** 项目已有 Plan/Diff、Sessions Workbench、双 IDE、团队/worktree、MCP、插件与远程执行基础；不能把 8 月已经完成的 12 项 required commitment 重新列为未开发。

本次找到五个有直接源码依据的改进点：

1. **VS Code 后台 tab 的正文事件被过滤，切回没有历史补放；reload 只恢复 tab 元数据。** 已用真实 ChatView 类的局部探针复现。后台任务完成通知与 unread 已存在，但不足以让用户看到完成结果。
2. **普通输入、图片与问题草稿缺少会话级恢复。** 现有 Plan review draft 和 pending interaction 恢复是良好基础，需要扩展到整个输入流程。
3. **VS Code 流式回复仍每帧重新解析整段 Markdown，并强制滚底。** 已有 RAF 合帧和节点上限，但没有解决长单条回复的重复工作；JetBrains 已有可借鉴实现。
4. **权限模式展示缺少 runtime 生效确认。** 当前主要展示请求模式，缺 requested/effective/pending/failed 合同。这是状态可观测性缺口，本次未证明权限绕过。
5. **图片入口的数量限制没有配套字节/像素预算，且写入失败可能静默丢附件。** VS Code host 还执行同步解码、写文件；可复用 CLI 现有附件限制。

运行时另有最新模型目录、实验 Codex adapter 和真实受限联网差距，由配套 CLI 报告统一立项。缺口与对标功能数量不能直接推导三者编码成功率高低。

### 1.1 本次状态标记

| 标记               | 证据含义                                                              |
| ------------------ | --------------------------------------------------------------------- |
| 本次复现           | 在当前源码上运行局部探针，确认具体输入/输出行为；不自动等于真宿主 E2E |
| 静态确认           | 追踪源码与调用点，确认实现边界；运行时性能或真实失败概率尚未测量      |
| 已实现，待目标验收 | 有实现或工程测试，尚缺当前发布产物/真实设备/真人使用证据              |
| 建议新增           | 本报告提出的工作和验收条件，不计为本次完成                            |

## 二、逐版本段增量复核

| 上游版本段                  | 与 IDE 决策有关的变化                                                                                              | 当前项目判断                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Claude `2.1.239`～`2.1.269` | 逐步完善会话、Hooks、权限设置、agent map、可访问性；`plugin eval` 产品入口                                         | 09-12/14 已有相应项目交付。复用现有 Workbench、Plan、插件 Eval，不重新设计整套 IDE    |
| Claude `2.1.270`～`2.1.277` | 文件上下文开关、Memory/Instructions 配置、后台任务控制、会话状态与设置写入可靠性                                   | 本项目并非缺这些概念；检查实际切 tab、reload、任务完成和配置生效流程                  |
| Claude `2.1.280`            | IDE `/status`、`/sandbox`、`/chrome`、`/export`、`/skills`、`/plan` 更统一；粘贴与模式交互改善                     | 入口可发现性是 P2；先保证既有入口展示真实 runtime 状态                                |
| Claude `2.1.281`～`2.1.283` | 历史加载失败显式报错、host 重启提示、避免长回复全量重解析；修复权限模式显示不一致、reload/rewind/compaction 丢历史 | 与本轮 IDE-REPLAY / STREAM / MODE 高度相关，但不能假定上游和本项目缺陷根因相同        |
| Codex `0.154.0`～`0.155.0`  | 不打断独立工作的异步回答、跨应用只读会话、daemon 恢复、任务归档、草稿和视口保留                                    | 本项目已有 deferred 问题与 session 基础；加强 host 层恢复，不再提出“首次增加异步问题” |
| Codex `0.156.0`～`0.157.1`  | worktree command center、usage、fullscreen、后台服务显式恢复、跨 app fork、问题草稿回收；持续网络限制              | 借鉴连续工作体验；语音/终端主题不属于本期必须补齐。`0.157.1` 没有可判定亮点，不猜测   |

资料已实际抓取：[Claude Code changelog](https://code.claude.com/docs/en/changelog)、[Codex changelog](https://developers.openai.com/codex/changelog)、[Codex App Server](https://developers.openai.com/codex/app-server)。版本窗口不是所有微小修复的逐条安全审计。

## 三、现有能力：不要重复建设

| 已有能力             | 当前证据或实现                                                                                     | 保留边界                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 多 tab / 多 session  | `packages/vscode-extension/src/chat/chat-view.js`，每会话 child、unread、完成通知                  | 不能把后台结果显示缺陷说成完全没有多会话                          |
| Plan / Diff / Review | 双 IDE 现有 review、计划评论及持久化；`chat-view.js:1144` 有 Plan draft                            | 普通 composer/question draft 需补，不重做 Plan/Diff 引擎          |
| 权限、信任与审批绑定 | mode allowlist、spawn 参数、停旧 child、pending approval binding；08-21 required 闭环              | 新增 effective 状态确认，不推翻已有 CLI 执行边界                  |
| 非阻塞澄清与恢复     | 09-13/14 G08 交付；`chat-view.js:3678` 可重发 pending interaction                                  | host 存活时 Webview 重建与整个 Extension Host 重启是不同恢复层级  |
| 有界显示与可访问性   | RAF、800 DOM 节点上限、AX announcer、键盘测试、128-session Workbench                               | 不代表长单条回复已经增量渲染，也不代表已听测实际朗读              |
| JetBrains 流式处理   | `ChatTranscript.java:149,173` follow-bottom / plain append；`ChatComposerImages.java:149` 后台编码 | 借鉴成熟行为，避免把 VS Code 的具体问题泛化到两端                 |
| Execution Location   | Local / WSL / SSH / Container 的 profile 与恢复合同；`execution-location-contract.js`              | Cloud 仍为 self-hosted handoff，resume 明确未实现；属于产品条件项 |
| 真实宿主与 CI        | 已有 VS Code/JetBrains 宿主验证、Strict Sandbox、36-cell 历史闭环、reliability 工作流              | 历史 SHA 的成功不能自动证明本次新场景通过                         |

JetBrains 文件路径前缀为 `packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/`；CLI contract 位于 `packages/cli/src/lib/`。

## 四、本期建议与自动化合并门

### 4.1 证据规则

每项修复绑定具体源码 SHA、发布产物、入口、OS 和场景。单测、协议 fixture、真实宿主、真实 provider、真人辅助技术验收分别记录。未运行或缺证据不能视为通过；既有测试绿灯也不自动覆盖新反例。

### 4.2 建议实施表

以下是建议，尚未作为本轮已完成实施记录。

| ID                      | 优先级                         | 当前不足                                                             | 复用实现与验收                                                                                                   |
| ----------------------- | ------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| IDE-REPLAY / SESSION-01 | P1，首先处理                   | 后台正文被过滤，切回与 reload 不读 durable transcript                | 复用 canonical session/event cursor；双会话交错后结果完整、无串台，reload/rewind/compaction 后不漏不重；有界分页 |
| IDE-DRAFT               | P1                             | composer/附件/问题草稿只有共享 DOM 或内存；发送早于 durable ACK 清空 | 复用 Plan draft、interaction binding；按 session/request 保存，失败可恢复，过期审批不自动重交                    |
| IDE-STREAM              | P1                             | 每帧 mdLite 全文解析、重建 controls、强制滚底                        | 稳定块+活动尾块、follow-bottom；测解析字符量、frame p95、最长 task 和选择区稳定性                                |
| IDE-MODE                | P1                             | 请求模式先展示，缺生效/失败确认                                      | CLI 返回 effective mode/policy revision/request correlation；组织覆盖、stop/spawn 失败时 UI 不报已生效           |
| IDE-IMAGE               | P1 边界与失败反馈，P2 压缩体验 | 缺单图/总 bytes/像素预算；VS Code 同步写入，失败静默跳过             | 复用 CLI 附件策略；两端读入前/解码前验证，异步落盘，失败逐项可见                                                 |
| MODEL-01/02             | P1，共享任务                   | 最新模型在窗口、协议和价格上回落旧值                                 | 按 CLI 报告统一修，IDE 只展示共享 profile 和 unknown 状态                                                        |

### 4.3 候选、条件项与不立项

| 项目                                           | 处置                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Codex App Server                               | 条件性 P1：先修官方 schema/线程隔离、跑真实 turn，再决定产品接线；当前仅实验模块        |
| Cloud resume / 自建云控制面                    | P2 产品决策。不要把已有 SSH/WSL/Container 说成不可用，也不要把 handoff 当成云恢复已完成 |
| 真人 NVDA / VoiceOver / Orca                   | 安排一次当前打包产物的听测；工程 AX 测试继续保留                                        |
| 生产 8h/24h 与大仓库实测                       | 复用已有长时/容量工具，增加真实环境和 SLO；不是新建 soak 框架                           |
| 新 Chat、第四套 workflow engine、品牌云账户 UI | 不立项；优先复用已有 runtime、Workbench、Plan 和 Browser/Computer Use                   |

## 五、关键设计建议

### 5.1 后台 tab 不渲染时，仍须能重放结果

`packages/vscode-extension/src/chat/chat-view.js:562` 的 `_postFrom()` 只向当前 tab 发事件；`:777` 常规正文也走此入口。后台 result 在 `:867` 设置 unread/通知。切回 `:3714` 仅发送 tabs、pending interaction 和 plan，Webview 在 `chat-html.js:1656` 恢复之前保存的 DOM，不补齐未收到的正文。

本次局部探针创建 A、切到 B、让 A 输出 delta/result、再切回 A，捕获到的消息只有 `tabs`，没有结果 sentinel。共享持久 state 重建 ChatView 后发送 ready，也仅收到 `tabs`。`_persistTabs()`（`:194`）保存 sessionId/title/mode/thinking 等元数据；`:3672` ready 未查询正文。CLI 仍可能持有完整 durable 会话，**这里确认的是 IDE 可回看性缺口，不是后端历史被物理删除**。

应将 CLI transcript 作为正文来源，为每会话保存 revision/cursor；切回、reload、重连时先拉有界快照再续接增量。按 session/turn/item/event identity 去重，compaction/rewind 改变 generation 时显式重建视图。旧正文可分页，不能以清空内存代替可访问历史。

既有 `packages/cli/__tests__/unit/vscode-ext-chat-tabs.test.js:193,214,402` 验证了隔离和元数据恢复，但没验证后台完成后的正文。这些测试应保留并扩展完整旅程。

### 5.2 草稿和已接受输入分别持久化

`chat-html.js:765,865,876` 的 pendingImages 和 composer 为共享 Webview 状态，发送时立即清空；`:1656` 切 tab 没有按会话保存/恢复普通输入。question 自由文本在 `:1351` 仅存在 DOM，`:1249` 回答后立即标 done。与之不同，Plan review 已有持久化，host-owned pending question/approval 在同一 Extension Host 内重建 Webview 时也可重发。

建议区分三类记录：未发送的 session draft、已提交但未确认的 clientMessageId、已被 CLI durable 接受的输入。`packages/vscode-extension/src/chat/agent-session.js:142` 的 stdin.write 成功只是 pipe 提交，不是 durable receipt；失败后应恢复文字与附件，而不是要求用户重写。

问题草稿绑定 session/request/binding digest，普通草稿绑定 session；schema 改变、turn 结束或请求取消后只恢复可编辑文本，不自动重交审批。VS Code 的 `app-server-question-review.js:17` 和 JetBrains `ConversationView.java:2046,2066` 的临时对话框也应纳入这一规则。

验收涵盖切 tab、Webview reload、Extension Host 重启、EPIPE、延迟 ACK、问题被取消、附件临时文件失效；“问题已重新出现”与“用户填到一半的回答仍在”分别断言。

### 5.3 流式渲染从限频推进到增量处理

`packages/vscode-extension/src/chat/chat-html.js:618` 每次 `renderStreamNow()` 仍执行 `streamEl.innerHTML = mdLite(streamRaw)`，随后重建代码块控件并在 `:622` 滚到底。`:624` 的 RAF 减少调用频率，但每帧工作量仍随全文增长。`:432` 的 800 节点与 entry 限额有效，只是不能证明长单条消息的处理成本已经解决。

阶段方案可直接借鉴 JetBrains：`ChatTranscript.java:149` 判断是否跟随底部，`:173` 在 streaming 时 plain append，结束后再格式化。进一步做稳定块与活动尾块，仅更新尚未闭合的 Markdown 段。用户向上滚动、选择文字或回答审批时维持锚点，不被新 token 抢走位置。

建议基准为 10KB、100KB、当前上限附近的回复，记录 parse chars、DOM mutations、最长 task、frame p95 和滚动锚点。先测再定阈值；本次静态结论不等于已测得 CPU/RSS 超标。

### 5.4 权限模式由 runtime 确认生效

`chat-view.js:1767` 的 `_setMode()` 在 `:1778` 写 mode、更新状态后才停止旧 child；`:3351` 直接显示保存的 mode。`chat-events.js:133` 和 `chat-view.js:690` 的 init 投影没有 effective mode/revision 回传。现有 `chat-events.js:527` 确实把 mode 传入新进程，正常 stop→respawn 也有测试。

改进重点是为“请求 default，runtime 仍是旧 mode / 被组织策略覆盖 / 新进程未启动”提供确定状态，而不是假定这是已发生的权限绕过。应由 CLI 返回 requestedMode、effectiveMode、policyRevision、correlationId；IDE 显示切换中或失败，等权威 ACK 后更新生效状态。旧 child 未退出时，不能仅改标签就宣称权限已经收紧。

本次 synthetic init 注入 effective 字段的 probe 只证明前端不会读取它，**不证明真实 CLI 当前已经发送该字段**。验收需两端共同实现，并覆盖组织 policy、stop/spawn 失败、模式切换时的 pending approval。

### 5.5 图片能力先补预算与可靠发送

VS Code `chat-html.js:783` 只检查数量后就 FileReader 读 data URL；`chat-view.js:2010` 限制四张、检查 MIME data-URL 前缀白名单，`:2027` 在 Extension Host 同步 base64 解码/写文件，`:2030` 写失败时跳过。数量上限不能限制单张巨大图片的内存开销，UI 也不应把部分附件失败显示成全部发送。

JetBrains `ImageAttachments.java:19,40` 同样主要按数量/扩展名；`ChatComposerImages.java:149` 已把编码移出 EDT，应保留，但 `:153` 仍静默忽略失败。文件位于 `packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/` 及其 `intellij/` 子目录。

CLI `packages/cli/src/repl/clipboard-image.js:33,540,639` 已有 20 MiB 字节检查。建议抽取共享 attachment policy，明确单图与每 turn 总 bytes、尺寸/像素、MIME/实际格式、异步写入和临时文件清理；具体额度沿用并测量现有 CLI 合同，不随意扩大。

验收超大单图、总量超限、坏 base64、MIME 伪装、磁盘写失败、快速多次 drop；用户看到准确成功/拒绝数量。没有必要为验证本问题故意把 IDE 压到 OOM。

### 5.6 测试资源优先覆盖用户旅程

现有 `ide-roadmap-accessibility-performance.yml:230,247,258` 的辅助技术检查主要是进程/存在性/语义合同，producer 明确 `speechQualityAssessed:false`；不能将其写成实际朗读体验通过。真人验收应覆盖审批完整性、流式重复播报、焦点恢复与键盘批量操作。

同样，容量工具已有，下一步应测真正的分页索引和上述流式路径；09-15 Windows+Volcengine 两轮 20/20 真实任务已有，但不能代替干净安装、真实项目、双 IDE 和维护工时基线。复用现有工具，避免重复建测评平台。

## 六、不建议复制的增量

| 上游能力或变化                   | 本项目处置                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| Codex 语音 / fullscreen / 新主题 | 先稳定当前输入、回复和附件。语音作为独立需求评估                                          |
| Claude 云/Slack/订阅体系         | 不复制账户与计费控制面，只借鉴适用的恢复和任务状态合同                                    |
| 自动审批默认变化                 | 保留组织策略与 CLI 权威执行；前端不能自行扩大权限                                         |
| 新建 agent map / session engine  | 复用 Workbench、Team、已有后台会话与 transcript 协议                                      |
| 上游中间版本安全规则             | 关注回滚：Claude `2.1.283` 撤销 `2.1.282` 对 `claude-ai` 名称的保留，不能按旧段落盲目迁移 |
| 实验 App Server 直接成为生产基础 | 先修已复现协议问题、做真实 turn 兼容验证、明确治理接入；保留实验状态与稳定执行路径        |

## 七、审计附录

### 7.1 本次执行与结果

| 验证                                             | 结果                                                           | 证明范围                                                         |
| ------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| ChatView 局部探针                                | 3 条检查完成：后台结果缺重放、重建缺正文、effective 字段未处理 | 使用真实类/投影器和注入依赖，断言的是当前缺口；不是修复后的 PASS |
| `vscode-ext-chat-tabs/mode/images.test.js`       | 3 文件，46 项通过                                              | tab 隔离/元数据、正常模式切换、图片数量/MIME/清理                |
| VS Code App Server question / pilot 测试         | 2 文件，5 项通过                                               | 现有问题交互与 pilot 合同                                        |
| 真宿主 / JetBrains GUI / 付费模型 / 远端 Actions | 本次未重新运行                                                 | 本报告不更新这些环境的验收结果                                   |

可重复执行的既有测试：

```powershell
# 工作目录 packages/cli
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/vscode-ext-chat-tabs.test.js __tests__/unit/vscode-ext-chat-mode.test.js __tests__/unit/vscode-ext-chat-images.test.js --reporter=dot

# 工作目录 packages/vscode-extension
node --test test/app-server-question-review.test.cjs test/app-server-pilot.test.cjs
```

新反例最小输入见 5.1 与 5.4；局部探针不启动付费模型、不删除工作区、不运行未审查插件。本次 51 条既有测试通过说明基础仍工作，不能证明新增旅程已覆盖。

### 7.2 新增验收矩阵

| 场景                            | 必须观察的结果                                                 |
| ------------------------------- | -------------------------------------------------------------- |
| A/B 并发、后台完成再切回        | 正文可见、最终状态正确、无跨会话事件污染                       |
| reload / host 重启 / CLI 重连   | 历史与草稿可区分恢复，不重跑已执行副作用                       |
| rewind / compaction / fork      | generation 与正文一致，不复活撤回内容，不遗漏有效 turn         |
| 延迟 ACK / EPIPE / 被取消的问题 | 未接受输入可恢复；旧答案不能落到新 request；旧审批不会自动提交 |
| 权限切换失败 / 组织策略覆盖     | UI 展示实际生效模式与原因，不虚报收紧成功                      |
| 长回复 + 用户滚动/选择/审批     | 增量处理，滚动锚点稳定；性能阈值来自事前冻结基准               |
| 图片超额 / 解码或磁盘失败       | host 有界、错误明确、成功数量准确、临时文件清理                |

### 7.3 来源与置信度

官方引用见第二节，抓取日期、来源 SHA-256 见 [CLI 报告第 11 节](../cli/cli-claude-code-codex-gap-analysis-2026-09-27.md#11-官方参考资料)。项目引用行号基于开头的 SHA；历史闭环只在其原提交范围成立。

审查深入程度：VS Code Chat 的五项有直接调用链或局部复现；JetBrains 主要核对对应实现差异、附件、问题输入与执行位置，不宣称完成其全部 UI 审计。未发现新 Diff/Review 缺陷，不为凑功能表推测不存在的不足。

## 八、最终判断与实施顺序

建议第一批完成 **IDE-REPLAY + IDE-DRAFT**，同步修共享 MODEL-01/02，让已有能力能够完整显示和恢复。第二批处理 **IDE-STREAM + IDE-MODE + IDE-IMAGE**，用真实宿主冻结可操作性基准。第三批再依据任务成功率、首次运行成功率与维护成本，决定 Codex 持久集成、云恢复和新交互入口的投入。

8 月 required commitment 与 9 月阶段性交付应继续记为已完成。当前短板集中在用户流程和目标环境证据，而不是缺少新的 Agent 概念。上述任务尚未因本报告写入而完成；本次只新增研究文档与索引。
