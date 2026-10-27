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

### 2026-10-27 实际复测及 Windows 解包修复

用户随后授权直接在 `main` 提交并继续执行。原 13 项计划按单样本顺序派发，未派发的行保持 `PENDING_DISPATCH`；部分轮次不能晋升历史基线。已合格 32 项不重生成，分母保持 45。

- [verify-04 授权重试](https://github.com/chainlesschain/chainlesschain/actions/runs/40459874678)：生成完成，独立基线 22/22 通过，候选 0/7 通过；存在价格假设和 API 字段不符。20 笔请求用量完整，不增加合格数，也不继续自动重试此项。见[结果](./cli/evidence/recovery-2026-10-27/verify04-retry-result.json)。
- [verify-13](https://github.com/chainlesschain/chainlesschain/actions/runs/40463204565)：独立基线 13/13、候选 6/6 通过，但候选未能拒绝行为变异体，仍未合格；9 笔请求用量完整。见[结果](./cli/evidence/recovery-2026-10-27/verify13-attempt-result.json)。
- [verify-10](https://github.com/chainlesschain/chainlesschain/actions/runs/40466023791)：Windows 系统 bsdtar 即使设置 `hdrcharset=UTF-8`，仍拒绝冻结项目中的非 ASCII 文件名，在 CLI 安装及 broker 创建前失败，模型调用为 0。原失败运行和账本绑定保留。见[失败与零调用依据](./cli/evidence/recovery-2026-10-27/verify10-attempt-result.json)。

Windows 解包改用 Python 标准库显式 UTF-8 解码及 Unicode 文件系统调用，先验证完整路径集合，拒绝链接、越界路径、设备名、大小写冲突和重复文件。Linux/macOS 继续原解包路径。中文普通头、PAX 长路径、逐字节一致性和错误路径负对照均已回归。Windows 本地用实际冻结提交归档核对 **22,564 个条目、19,381 个文件、252 个非 ASCII 路径**，文件名和内容摘要全部一致；归档摘要也与上述 GitHub 失败运行一致，见[完整树核对](./cli/evidence/recovery-2026-10-27/windows-frozen-archive-check.json)。工作流增加模型执行前的 Windows 解包回归。

修复后的 verify-10 使用[独立重试计划](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-127-funded-20261027-unicode-plan.json)，保持相同 13 个未合格 ID、32 个历史合格项、公开包版本和冻结验收条件；原失败轮次不可被新运行覆盖。当前累计仍为普通 **26/36**、首次 **6/9**，共 **32/45**。verify-09 的旧请求仍待核对；`paidReady:false`、native `NOT_ADMITTED`、晋升 `HOLD` 不变，无新发布。

修复提交 `5696eb87d5` 的 [Windows 重跑](https://github.com/chainlesschain/chainlesschain/actions/runs/40468780496)已完成：原生生成及冻结树精确检查通过，9 笔请求用量完整；独立基线 2/2、候选 5/6 通过，末页断言与实际索引排序不符，仍未合格。[Linux 首次安装](https://github.com/chainlesschain/chainlesschain/actions/runs/40469980382)也完成公开安装和原生生成，20 笔请求用量完整；独立基线 22/22 通过，候选计价测试 0/6 通过，整项未合格。安装成功不单独关闭包含首次任务的验收项。详见[后续实际结果](./cli/evidence/recovery-2026-10-27/remaining-127-followup-results.json)；相应独立回执、候选和请求用量回执保存在新轮次账本中。未将生成成功改写为任务成功。

本次提交自动触发的 `Full Test Automation with Diagnostics` 长测试已取消以释放执行机，未取消 CLI CI 或原生任务验收。上述本地及原生解包回归不代表全仓库 CI 或准确提交的完整发行矩阵通过，本轮未发布。

[verify-19](https://github.com/chainlesschain/chainlesschain/actions/runs/40471191760)原生生成通过，20 笔请求用量完整；独立基线 17/17 通过，候选 0/2 通过，未合格。`main` 随后合入 LLM 配置改动后，[verify-07 的首次派发](https://github.com/chainlesschain/chainlesschain/actions/runs/40472305015)在前置自检阶段失败：新导入的模型能力模块需要 `@chainlesschain/context-memory-kernel`，而干净工作流尚未准备这一工作区依赖。原生生成和验收两个 job 均为 `skipped`，无制品、无模型调用；见[失败依据与原日志摘要](./cli/evidence/recovery-2026-10-27/verify07-preflight-failure.json)。

工作流现为 validate、generate、accept 三个独立检出分别执行仅选取 kernel 工作区的生产依赖安装，禁用安装脚本，使用现有根锁文件。它服务于操作端脚本导入，首次任务的公开 CLI 安装仍由独立临时目录与公开包锁回执验证。干净隔离检出的安装和 `canonicalDigest` 导入通过；工作流列出的全套本地前置自检 **86/86** 通过。失败轮次绑定继续保留在原 unicode 账本，新执行使用[单独计划](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-127-funded-20261027-preflight-plan.json)，复用相同 32 个历史合格项和已完成尝试，不增加或省略原 13 个未合格 ID。

工作流修复提交 `9461b1ded5` 的后续实际结果如下，完整回执及候选见[结果索引](./cli/evidence/recovery-2026-10-27/remaining-127-followup-results.json)与本轮账本。

| 样本                                                                                                   | 原生生成                                  | 独立基线 | 候选测试 | 结果                                                                     |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------- | -------- | ------------------------------------------------------------------------ |
| [verify-07 重试](https://github.com/chainlesschain/chainlesschain/actions/runs/40474307440)            | 通过，18 笔用量完整                       | 39/39    | 0/6      | 会话夹具未满足 `session_start` 首事件结构要求，未合格                    |
| [macOS CLI 首次安装](https://github.com/chainlesschain/chainlesschain/actions/runs/40476134137)        | 安装及宿主通过，生成未通过；17 笔用量完整 | 39/39    | 6 项跳过 | 存在非规范路径写入拒绝、上下文压缩降级及未完成的测试，不关闭首次安装验收 |
| [Linux JetBrains verify-06](https://github.com/chainlesschain/chainlesschain/actions/runs/40477719399) | 通过，18 笔用量完整                       | 31/31    | 2/3      | 候选回归失败，未合格                                                     |

用户补充的账户截图和交易流水已在本地核对，见不含账户身份或金额的[核对结论](./cli/evidence/recovery-2026-10-27/verify09-account-evidence-review.json)。流水存在与 verify-09 原请求结束时间接近的模型扣费，但没有 provider response ID，不能唯一关联至该请求；原用量仍未恢复，不将时间邻近改写为逐笔结清，也未新增 verify-09 调用。原账务文件仅保留在私有操作证据中。上述执行后累计仍为普通 **26/36**、首次 **6/9**，共 **32/45**；正式准入与自动晋升状态保持不变。

[macOS VS Code verify-08](https://github.com/chainlesschain/chainlesschain/actions/runs/40480645282)因 `DIAGNOSTIC_OUTPUT_TRUNCATED` 中止：4 笔用量完整，候选仍为 27 字节占位文件；独立基线 58/58 通过，没有可执行候选测试。[Windows VS Code verify-11](https://github.com/chainlesschain/chainlesschain/actions/runs/40482653681)原生生成通过，7 笔用量完整；独立基线 16/16 通过，候选回归未通过。两项均不增加合格数。

另核实一项后续工程线索：实测调用使用 32,768 token 上下文窗口，macOS 首次任务出现压缩降级；[火山方舟官方模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=en)对本轮固定 ID `deepseek-v4-flash-ga-260731` 标注的上下文为 `1024k`（2026-10-27 核对官方索引，完整页面抓取超时）。源码的能力投影支持 SDK 参数 `contextMemoryModelWindowTokens`，`llm capabilities --context-window` 也提供诊断覆盖，但 `agent` 命令参数未暴露等价运行覆盖。更大的输入窗口可能降低提前压缩的概率，尚未通过对照实验验证；单次输出截断仍受本轮 8,192 token 上限约束。此处只记录调查结果，未改变本轮模型、思考开关、回合数、输出上限或验收条件。

[Windows JetBrains verify-30](https://github.com/chainlesschain/chainlesschain/actions/runs/40484944269)原生生成通过，5 笔用量完整；独立基线 13/13、候选 6/6 通过，但未能拒绝行为变异体，未合格。[macOS JetBrains 首次安装](https://github.com/chainlesschain/chainlesschain/actions/runs/40493312511)公开安装及原生生成通过，5 笔用量完整；独立基线 11/11 通过，候选回归未通过。

截至本次汇总，已收集剩余 13 个样本中 **12 个样本的新尝试**，新增合格 **0**；尚未新增普通 verify-09 派发。跨版本诊断合格仍为 **32/45**，并非仅剩一项未合格。12 个已解析运行共 **152 笔物理请求**，这些运行的用量回执全部完整；token-only 费用估计合计 **¥4.122235**，不能作为实际账单金额，也不包括旧的未决派发或缺用量请求。见[汇总与运行索引](./cli/evidence/recovery-2026-10-27/remaining-127-resolved-round-summary.json)及[独立证据账本](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-127-funded-20261027-preflight.json)。

普通 verify-09 的[单次新尝试方案](./cli/evidence/recovery-2026-10-27/verify09-explicit-retry-proposal.json)已准备并向用户请求明确授权，旧请求记录保持未结清；不会因首次安装样本使用相同冻结任务而改写普通样本的状态。verify-04 此前授权的一次重试已用完。本次无新版本发布，原 **$99** 不重置，`paidReady:false`、native `NOT_ADMITTED`、晋升 `HOLD` 不变。

提交前补跑了包含 scripts 的源码出口审计：本轮 campaign 因本地 Python 解包改动产生的摘要漂移已复核并更新，模型与网络派发分类仍为 `MODEL_REQUEST`。当前工作区仍有另外 **6 个**审计条目未通过：4 个生成的 Web Panel bundle 尚未复核，`llm-connection-probe.js` 与 `runtime/agent-core.js` 的审查摘要已过期。完整结果见[源码审计回执](./cli/evidence/recovery-2026-10-27/resolved-round-source-audit.json)。该检查未宣称全通过，不替代干净发行提交的跨平台门禁。
