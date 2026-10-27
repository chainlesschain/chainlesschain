# CLI / IDE 保存输入删除与恢复续做（2026-10-26）

承接 [10 月 15 日实施计划](./cli-ide-codex-claude-implementation-plan-2026-10-15.md)的 RUN-03 / IDE-03，以及 [10 月 23 日续做](./cli-ide-recovery-progress-2026-10-23.md)。本轮基线为 `082bdf7a24`，工作分支为 `feature/research-input-recovery-20261026`；新增工程修复尚未发布。

代码与证据已提交至 [PR #498](https://github.com/chainlesschain/chainlesschain/pull/498)。本批工程修复与独立归档回复恢复已完成，汇总见 [completion.json](./cli/evidence/recovery-2026-10-26/completion.json)；完整计划与候选发行矩阵仍分别跟踪。

## 当前发布与验收基线

仓库已保存的 [CLI .125 发布回读](./cli/evidence/release125-public/publication.json)绑定源码 `4285a55c2f4dfb0c0eddb7cb8f63fc73f2ff1a2b`，包含该提交三系统 CLI CI、CLI Strict Sandbox 与 npm 公开制品的核验。公共 CLI 为 **0.166.125**，Session Core 为 **0.3.24**。同一回读记录的既有 IDE 配对为 Open VSX **0.37.162**、JetBrains **0.4.179**，推荐 CLI **0.166.123**；这次 CLI 发布没有重新发行 IDE，也没有声称重新比对 IDE 压缩包字节。

CLI 状态沿用已有发行证据。本轮另从 JetBrains 公共 API 重新确认 **0.4.179** 已批准、列出且未隐藏，并下载 **1,555,693 字节** ZIP，核对内嵌插件身份与版本；SHA-256 为 `673ab724812ab5b0bbc52c085ff4f128a7b89a68ff7af89bea86f4fbca6d44b3`。独立[下载回读](./cli/evidence/recovery-2026-10-26/jetbrains-public-readback.json)及[恢复专用包清单](./cli/verify01-package-sets/2026-10-26-archived-reply-179.json)供真实宿主检查绑定使用；这不是与标签 Actions 制品的字节比较，也没有重新执行公共 CLI / VS Code 包。

本轮没有发行。本分支的新增修复仍须取得自己的准确提交检查；旧发布的通过记录不能转移给新源码。

PR 首轮 `Workspace Publish Staleness Check` 要求源码改动配套提升版本。为满足现有门禁，VS Code 准备未发布候选 **0.37.163**，推荐已公开 CLI **0.166.125**；包清单、changelog 与 Marketplace README 同步区分候选及既有公开版本，未放宽检查。JetBrains .179 继续仅用作归档恢复的公开测试对象。

36+9 的跨版本累计合格交付仍为 **32/45**（普通 **26/36**、首次 **6/9**），剩余 **13** 项，逐项沿用[剩余清单](./cli/evidence/recovery-2026-10-23/remaining-36-plus-9.json)。本地恢复回归不增加正式模型任务数；`paidReady:false`、native `NOT_ADMITTED`、自动晋升 `HOLD` 保持各自边界。

## 本轮完成的工程修复

VS Code 的“Discard saved input”此前会在 Agent 存活时直接删除保存记录及附件。管道返回失败也不能证明输入路径没有被部分发送，因而存在尚未读取的图片被删除的情况。另一个问题是删除操作仅在入队前检查页面；存储队列等待期间页面、草稿身份或会话状态改变后，旧删除仍会执行。

修复后的行为：

- Agent 存活、输入准备中或停止尚未确认时，删除请求保留原记录和附件，并提示先停止 Agent；停止失败时继续保留。
- 收到停止确认后，用户可以再次显式删除，记录和不再引用的附件正常清理。
- 删除在进入存储队列、处理清单及发布前复查页面、会话与草稿身份。旧页面排队的请求、会话重置后的请求及排队期间重新开始输入的请求均被拒绝。
- 空清单删除与保留下一份草稿的清单替换都沿用已有原子写入边界；失效操作保留原清单字节和附件，清理临时文件。

产品源码改动位于 `packages/vscode-extension/src/chat/chat-view.js` 和 `draft-store.js`。另有下述 JetBrains 采证测试修复；CLI 回执协议、共享 SDK、公开 JetBrains 包及历史评测产物保持原样。恢复和删除均不会自动重发输入。

## 验证结果

Windows x64，Node **22.22.2**。可机读结果、命令、源码摘要及验证范围见 [validation.json](./cli/evidence/recovery-2026-10-26/validation.json)。

配套候选元数据的 **26 项**测试通过，版本一致性 lint 为 **0 违规**；候选清单更新后再次执行完整 VS Code 单元套件，仍为 **308 项通过、0 跳过**，新日志摘要记录在 [completion.json](./cli/evidence/recovery-2026-10-26/completion.json)。两次完整套件验证同一组用例，不相加计数。

| 检查                        | 结果与范围                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 修复前行为复现              | 新增 5 个场景均失败：成功排队和失败管道各一项，页面、草稿身份、输入准备状态在排队期间改变各一项；原始结果保留在 `discard-before.json` |
| 修复后定向复测              | 上述 5 项通过；筛选同时命中 1 项既有回归，原始结果保留在 `discard-after.json`                                                         |
| CLI / VS Code 相关组合      | **5 个文件、84 项通过，0 跳过**，覆盖草稿、问题表单、历史恢复与同步、输入回执；包含新增的 7 项删除回归                                |
| VS Code 完整单元测试        | **308 项通过，0 跳过**；完整 TAP 输出保留在 `vscode-unit.log`                                                                         |
| 既有 verify-33 归档回复检查 | **8 项通过、1 项 Linux 专项跳过**；该检查使用已有归档，不调用模型，不构成真实 Linux IDE 重启验收                                      |

现有 runner 的 `--prepare-only` 已成功绑定原 verify-33 回复、验收链及上述公开 ZIP；准备成功不代表 Linux IDE 的实际执行。

删除回归使用真实磁盘清单和图片快照，Agent 管道与停止确认通过测试注入控制。它们证明本地宿主处理行为；未执行公开 VSIX 的真实窗口旅程或跨系统矩阵。

## verify-33 真实宿主复查

[首次复查](https://github.com/chainlesschain/chainlesschain/actions/runs/40306765448)在源码 `0e9252755d3afa36dc9721151dd936c6f102c3ce` 上完成 Linux 2025.2 宿主启动、公开 .179 ZIP 的安装字节核验、原回复的持久化与唯一显示，但在初始阶段的精确正文断言失败，未执行重启阶段。原始快照、日志、peer 收据及其摘要保存在[失败回执](./cli/evidence/recovery-2026-10-26/archived-reply-first-attempt/receipt.json)，没有改写为通过。

失败快照中的 canonical source 完整一致，`bodyText` 多包含了新版辅助技术标题 `Turn 1, Assistant response`。原采证代码假定从 live 提升的 span 没有标题，因此把标题也交给固定正文摘要校验。

采证修复只提取明确格式的外层标题；保留旧版 live 正文与两种既有 saved 标题格式，完整保留正文空白、原始 Markdown、重复正文及截断标记。原回复内容、渲染摘要、唯一性、行身份、公开 ZIP 身份和禁止恢复时启动 Agent 的断言均未放宽。四项新增回归包含本次真实失败快照以及错误标题、原始 Markdown和重复正文的负对照。

修复后本地归档检查 **12 项通过、1 项 Linux 专项跳过**，JDK **21.0.12.1** 的离线 `compileUiTestJava` 成功，保留既有 IntelliJ API 弃用警告。

源码 `c02d27e7e525c4361dafd584a990fe2f5ed2d49d` 的[第二次真实宿主复查](https://github.com/chainlesschain/chainlesschain/actions/runs/40309760152)已成功结束。下载制品后，再用原独立 verifier 在本地完整复核，结果与工作流保存的 `result.json` 完全一致：**`PASSED_ARCHIVED_REPLY_RECOVERY_ONLY`**。初始进程为 `3400`，重启进程为 `4320`；profile、tab、session、assistant row ID 以及原 source / rendered 摘要均保持一致，恢复阶段没有启动 Agent。完整证明与原始日志的逐文件摘要见[成功回执](./cli/evidence/recovery-2026-10-26/archived-reply-success/receipt.json)及[验证结果](./cli/evidence/recovery-2026-10-26/archived-reply-success/result.json)。

至此，公开 JetBrains .179 在 Linux 2025.2 的这一归档回复恢复检查已关闭。它复用既有回复与候选文件，模型请求为 **0**，没有执行公共 CLI 或新任务；原历史样本的 `endToEndPassed:false` 保留，累计 **32/45** 和其余 **13** 项均不因此改变。

## 仍需完成

| 工作                  | 当前边界与下一步                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| RUN-03 跨入口恢复     | 继续公开安装包上的跨入口组合故障、重启并发输入、未决副作用，以及生产 Linux 预算恢复验收                              |
| IDE-03 原生恢复       | verify-33 的 .179 / Linux 2025.2 归档回复恢复已通过；完整九入口公开安装、真实模型任务及其他恢复旅程仍须分别验收      |
| IDE-03 人工与发行渠道 | 真人辅助技术验收及 Microsoft Marketplace 的发行回读仍开放                                                            |
| 36+9 剩余 13 项       | 新一轮只生成未合格项，保留 32 项已合格文件和回执；超时且用量未知项先核对原请求结果，继续沿用冻结验收条件             |
| 新修复发行            | 从本分支最终准确提交完成相关门禁；按必要子 npm 包 → CLI → IDE → 移动端 / PC 顺序核验与发行，不以本地通过替代 Actions |

本轮完成保存输入删除的工程修复和本地回归，整份研究实施计划仍在进行。

## 2026-10-27 剩余 13 项复测准备

用户要求继续完成 36 项任务与 9 次首次安装。新工作分支为 `feature/verify01-remaining-20261027`，起点为主线 `dc3576fbddb88633310e81c6c7715a06e1fd456e`。严格重验既有证据链后，累计合格仍为普通 **26/36**、首次 **6/9**，共 **32/45**；本次不重新生成已合格文件。

已重新获取公共 npm、Open VSX、JetBrains 元数据及完整公开制品，确认 CLI **0.166.127**、VS Code **0.37.165**、JetBrains **0.4.182**。CLI tarball、VSIX 与 JetBrains ZIP 的 SHA-256 均与既有 .127 发行证据相符；CLI 的 SHA-512 和 npm integrity 也一致，JetBrains 为批准、列出且未隐藏的最新稳定版本。原始公共元数据压缩归档及摘要见[公开回读](./cli/evidence/recovery-2026-10-27/public-readback.json)和[元数据索引](./cli/evidence/recovery-2026-10-27/public-metadata-index.json)。这一步不执行下载的包代码，也不构成原生宿主验收。

独立[包清单](./cli/verify01-package-sets/2026-10-27-remaining-127.json)及[复测计划](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-127-20261027-plan.json)保留原项目提交、任务、宿主版本和验收条件，选择剩余 13 项、9 个互不重叠的执行分片。计划严格校验通过，状态为 `PREPARED_NOT_DISPATCHED`；旧计划、结果和轮次链保持原字节。

前置测试发现 `verify01-native-subset.node-test.mjs` 仍提取旧 `node -e` 工作流文本，而实际工作流已使用 heredoc。修复只更新脚本提取格式，继续实际执行工作流中的选择器，保留跨宿主、跨入口、已合格样本、未知包集合及历史包付费生成的拒绝断言。修复前 46 项中 1 项失败；修复后工作流列出的全部 11 个测试文件 **85 项通过、0 跳过**，Python 派发与收集器 **27 项通过**。这些是本地前置检查，不是正式任务通过或远端系统矩阵。

另在 Windows x64 独立目录完成公开 .127 的 npm 安装（启用生命周期脚本），并在仓库外的临时用户目录和工作区通过版本、静态能力、三项配置写入及精确读回。配置写入在受限 Codex 沙箱中被 owner-only ACL 检查拒绝；同一公开安装在沙箱外、当前普通 Windows 用户下复核通过，未放宽生产 ACL 检查。见[预检记录及原始采集摘要](./cli/evidence/recovery-2026-10-27/windows-preflight.json)。初始本地安装预检遗漏 `--prefix`，导致 npm 临时重命名仓库依赖目录；已停止该进程，并按 npm 自己的备份映射恢复 325 个原目录/命令项，隔离 4 个新建项。源码包清单和锁文件未改写；成功安装明确指定独立 prefix，并有独立 package.json。这些预检没有模型调用，不增加 `verify-30` 或首次安装的历史验收计数。

已从 [run 39139263000](https://github.com/chainlesschain/chainlesschain/actions/runs/39139263000) 的原始生成制品找回 `verify-09` 第三笔物理请求回执。原响应 **1,149,179 字节、3,992 个完整 SSE JSON 事件**，HTTP 200，已确认派发，但没有 `finish_reason`、usage 或 `[DONE]`。provider response ID 为 `021792336925419cd483641bd2945773645203cda9eaa13b9041f`，UTC 请求窗口为 **2026-10-18 15:19:46.821 至 15:22:46.836**。原候选文件只有 27 字节，未形成完整交付；旧验收结果不变。[核对记录](./cli/evidence/recovery-2026-10-27/verify09-request-reconciliation.json)及原始脱敏回执保留原摘要，没有保存请求正文或响应正文。

下一步需先用账户记录核对原共享 **$99** 的历史实付/剩余额度，并核对上述未决请求，再按原分片执行生成和独立验收。已向用户询问账单金额或本地证据路径。当前没有新模型调用、新合格样本或发布；`paidReady:false`、native `NOT_ADMITTED`、自动晋升 `HOLD` 及原正式评测窗口不因准备工作改变。
