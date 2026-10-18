# 当前组件发布状态

CLI **0.166.106 已正式发布并完成独立公开回读**：[GitHub Actions OIDC 发布流程 39130542725](https://github.com/chainlesschain/chainlesschain/actions/runs/39130542725) 已 `completed/success`，固定标签 `v-npm-0-166-106` 对应提交 `dca47fd91a209642b6536afd5bc9e99ec74c7d06`。已保存公开 npm 元数据、包原文及 `VERIFIED_PUBLIC_CLI_ONLY` 回执，校验包摘要、SRI 和回执列明的源码字节；没有重复下载、安装、执行包或调用模型。见[CLI 最终发布与公开回读证据](./next-release-validation/followup-106-cli-publication-final-review.json)。

| 组件 | 版本 | 当前状态 |
| --- | --- | --- |
| CLI | 0.166.106 | 已发布，公开回读通过 |
| VS Code | 0.37.151 | [官方发行中](https://github.com/chainlesschain/chainlesschain/actions/runs/39131607926)，尚未完成公开核验 |
| JetBrains | 0.4.168 | [官方发行中](https://github.com/chainlesschain/chainlesschain/actions/runs/39131605961)，尚未完成公开核验 |

两个 IDE 固定标签已由独立远端查询确认均指向上述提交，官方运行均由标签 `push` 触发。原客户端因 Python `Path.write_text(newline=)` 兼容错误未写回最终收据；原 intent 保持原文，另存[远端标签及官方运行核验](./next-release-validation/followup-106-cli-publication-final-ide-tag-resolution.json)，不伪造客户端响应，也未重推标签。

全套 `published` 仍为 **false**；此 CLI 单组件回执不代表三包齐备，也不授权开始新版原生模型评测。累计仍为 **31/45**（普通 **26/36**、首次 **5/9**），剩余 **14** 项，31 项合格产物及原结果全部复用。本次只归档已取得的发布和回读证据。

以下为此前过程记录，原文按字节保留；其中“发布中”“尚未发布”等描述对应当时观察。

---

# 最新 CLI / IDE：36+9 实际任务结果

当前公开包补测使用 CLI **0.166.105**、VS Code **0.37.150**、JetBrains **0.4.167**。[本轮账本](./next-package-105-20261018.json) 已完整收取生成 **20/20**、独立验收 **20/20**，新增 **6** 项候选及全流程通过。累计候选合格 **31/45**（普通 **26/36**、首次 **5/9**），剩余 **14** 项；完整性严格校验通过，原生任务没有重复派发。逐项及原因见[本轮复核](./next-package-105-20261018-review.json)，状态 `COMPLETED` 表示证据收齐。

发行提交 `dca47fd91a209642b6536afd5bc9e99ec74c7d06` 的完整正式门禁现已通过：CLI **71/71**、Strict **5/5**、IDE **18/18**、ARM64 **10/10**，共 **104** 个必需任务成功；IDE 唯一条件跳过项为发布标签才触发的 Marketplace 验证，ARM64 第 2 次运行的 **11 格证据聚合**成功。[最终完整复核及原始证据](./next-release-validation/followup-106-final-gates-review.json) 已保存，旧失败均未改写。CLI 固定标签 `v-npm-0-166-106` 已推送同一提交，[OIDC 正式发布流程 39130542725](https://github.com/chainlesschain/chainlesschain/actions/runs/39130542725) 正在运行；公开包尚待严格回读，随后才能发行 IDE，当前不宣称三包已发布。下方排队和失败段落保留为此前过程记录。

下一候选 **.106/.151/.168** 见 [PR #462](https://github.com/chainlesschain/chainlesschain/pull/462) 和[准备记录](./followup-106-preparation.json)。产品提交已更新为 `dca47fd91a209642b6536afd5bc9e99ec74c7d06`。对应官方运行：CLI CI [39114428682](https://github.com/chainlesschain/chainlesschain/actions/runs/39114428682)、CLI Strict Sandbox [39114428621](https://github.com/chainlesschain/chainlesschain/actions/runs/39114428621)、IDE Extensions [39114428636](https://github.com/chainlesschain/chainlesschain/actions/runs/39114428636)、ARM64 [39114428701](https://github.com/chainlesschain/chainlesschain/actions/runs/39114428701)，初始观察均为 queued/pending，尚未完成，不能放行发行。CLI 聚焦 **58** 项、JetBrains 聚焦 **38** 项及 README 定向 **4/4** 通过不替代官方完整矩阵。候选尚未发布，也未进行新版模型补测。

新提交 ARM64 运行 `39114428701` 的 Windows JetBrains `2026.2.0.1` job `117637196667` 首次失败，已由官方日志确认：安装包下载完成，但获取供应商 checksum 时 DNS 解析失败，校验、安装、Gradle 和 IDE journey 均未执行，与新增 Java 测试无关。[失败与原始证据](./next-release-validation/followup-106-dca47-arm64-dns-failure-review.json) 保留早先因原工作流仍运行而被拒绝的请求。原矩阵结束后，监控于 **09:51:38Z** 成功提交唯一一次单项重试，现为同一提交的 **attempt 2**，Windows ARM64 仍在运行，严格 checksum 校验保留；没有新派发模型任务。最新观察中 Strict Sandbox 已 **5/5 通过**，CLI CI 已 **13 项通过**，其余 CLI、IDE 及 ARM64 结果尚未收齐，候选仍未发布。见[重试回执及门禁快照](./next-release-validation/followup-106-dca47-dns-rerun-and-release-progress.json)；初始 queued 快照与原失败均未改写。

旧提交 `4317bf01a48a7ec612e12000936a81851c6febf3` 已被新提交取代；其正式 ARM64 工作流独立失败为 VS Code README 一致性检查，原始汇总 **274/275** 通过，未进入 VSIX 打包，聚合随后拒绝不完整矩阵。[原失败证据](./next-release-validation/followup-106-vscode-contract-failure-review.json) 与[补充归档](./next-release-validation/followup-106-dca47-evidence-review.json) 均保留；旧结果不能放行新提交，原失败没有改写为成功。

按用户“取消和发布无关的 runner”授权，已逐项核验并取消 **9** 个辅助或旧源码 CI 流程，官方回读均为 `completed/cancelled`；另一个已自行结束的流程没有重复取消。当前发行提交的四项发布门禁及三个保护流程均保留，未取消任何 36+9 原生任务或正在发布的流程，未重新调用模型。清理后的观察为 CLI **15 项通过、10 项运行**，Strict **5/5 通过**，IDE **14 项通过、1 项运行**，ARM64 **8 项通过、1 项运行**，其余必需的后续任务仍须收齐，候选尚未发布。取消的辅助检查不记作通过；[取消回执、最终状态、保留清单及容量提示](./next-release-validation/followup-106-release-priority-cleanup-review.json) 已归档。GitHub 直接提示 macOS ARM 容量紧张，不能据此推断其他平台或账户计费原因。

Windows JetBrains 的原生 ACL 超时根因仍未解决。新产品提交包含插件 Java 子进程生命周期修复，本地 JUnit **9/9**（含 **5** 个真实子进程测试）通过：关闭未使用 stdin、完整排空输出、共用单一 **5 秒**清理等待预算，仅回收自身子进程并保留中断；原操作 **30 秒**期限与 ACL 脚本不变。执行时记录的生产源码摘要与新 git 对象一致，原始源码、测试源码及各自摘要已归档；未执行的 Node 原型不作为测试结果。继承管道未关闭时 daemon reader/closer 仍可能晚于调用方结束，这不证明原生超时根因已修复。

独立阶段诊断运行 [39112546523](https://github.com/chainlesschain/chainlesschain/actions/runs/39112546523) 精确绑定 `2ceaa8421901fbdc68bec4d4c2395f6af089602d`，完成 **16** 项测试和 **3** 个 probe。约 **22–29 秒**为阶段区间，包含间隔工作，不是精确 native call 用时；未重现 IDE/Gradle/CEF 并发负载，也未向产品提交引入 session-core 修改。[诊断及原始/存储 SHA-256 清单](./next-release-validation/followup-106-dca47-evidence-review.json) 保留这些限制及候选版本尚不可用的只读快照。

新增合格为 `verify-12`、`verify-14`、`verify-32`、`first-run-linux-jetbrains`、`first-run-linux-vscode` 和 `first-run-darwin-vscode`。已将完整轮次摘要登记至[累计轮次链](./next-package-round-chain.json)，新计划会严格排除全部 31 项合格样本。可下载[31 项交付包](./next-package-105-20261018-accepted-deliverables.tar.gz)及[索引](./next-package-105-20261018-accepted-deliverables.json)，原 25 项产物和收据按字节复用，原包保持不变；打包没有重新执行模型或候选测试。累计跨版本的文件合格与原生全流程结论分别保留。

## 已收齐的上一轮

评测版本：CLI **0.166.104**、VS Code **0.37.149**、JetBrains **0.4.166**。以下保留上一轮原始结果，累计和当前补测状态以上方账本为准。

固定条件：thinking disabled、六种文件工具、20 turns、24 requests、180 秒请求期限及 8192 输出 token；模型不执行测试，生成后由独立验收器检查。这些结果对应本组固定条件。

历史合格的 **20 项直接复用**，仅对余下 **25 项**使用最新公开包。最新轮已收取生成 **25/25**、独立验收 **25/25**；新增候选合格 **5**、全流程通过 **4**。状态 `COMPLETED` 仅描述记录是否收齐，不代表全部任务成功。

| 类别 | 历史合格复用 | 本次新增合格 | 累计合格交付 |
| --- | --- | --- | --- |
| 普通任务 | 18 | 5 | 23/36 |
| 独立首次任务 | 2 | 0 | 2/9 |

累计交付来自不同版本和多次尝试；20 项复用文件没有重新在最新包生成，不能把累计数字称为统一最新版本的单轮成功率。

## 最新包逐项结果

| 样本 | 原生入口 | 生成流程 | 候选验收 | 全流程 | 结果摘要 |
| --- | --- | --- | --- | --- | --- |
| `verify-04` | linux-cli | 通过 | 失败 | 失败 | candidate or baseline regression failed |
| `verify-05` | linux-vscode | 通过 | 通过 | 通过 | 候选及行为变异验收通过 |
| `verify-06` | linux-jetbrains | 失败 | 失败 | 失败 | candidate or baseline regression failed |
| `verify-07` | darwin-cli | 通过 | 失败 | 失败 | candidate or baseline regression failed |
| `verify-08` | darwin-vscode | 通过 | 失败 | 失败 | candidate or baseline regression failed |
| `verify-09` | darwin-jetbrains | 失败 | 失败 | 失败 | acceptance requires executed test cases |
| `verify-10` | win32-cli | 通过 | 失败 | 失败 | candidate or baseline regression failed |
| `verify-11` | win32-vscode | 通过 | 失败 | 失败 | candidate tests did not reject the behavioral mutant |
| `verify-12` | win32-jetbrains | 失败 | 失败 | 失败 | acceptance requires executed test cases |
| `verify-13` | linux-cli | 通过 | 失败 | 失败 | candidate or baseline regression failed |
| `verify-14` | linux-vscode | 通过 | 失败 | 失败 | acceptance requires executed test cases |
| `verify-19` | win32-cli | 失败 | 失败 | 失败 | provider-fetch-failed |
| `verify-23` | linux-vscode | 通过 | 通过 | 通过 | 候选及行为变异验收通过 |
| `verify-25` | darwin-cli | 通过 | 通过 | 通过 | 候选及行为变异验收通过 |
| `verify-30` | win32-jetbrains | 失败 | 失败 | 失败 | acceptance requires executed test cases |
| `verify-32` | linux-vscode | 通过 | 失败 | 失败 | candidate or baseline regression failed |
| `verify-33` | linux-jetbrains | 失败 | 通过 | 失败 | 候选及行为变异验收通过；原生流程仍失败 |
| `verify-34` | darwin-cli | 通过 | 通过 | 通过 | 文档规则及基线验收通过 |
| `first-run-win32-jetbrains` | win32-jetbrains | 失败 | 失败 | 失败 | missing-terminal |
| `first-run-linux-cli` | linux-cli | 通过 | 失败 | 失败 | acceptance requires executed test cases |
| `first-run-linux-vscode` | linux-vscode | 通过 | 失败 | 失败 | candidate tests did not reject the behavioral mutant |
| `first-run-linux-jetbrains` | linux-jetbrains | 失败 | 失败 | 失败 | candidate or baseline regression failed |
| `first-run-darwin-cli` | darwin-cli | 失败 | 失败 | 失败 | agent-error |
| `first-run-darwin-vscode` | darwin-vscode | 通过 | 失败 | 失败 | candidate or baseline regression failed |
| `first-run-darwin-jetbrains` | darwin-jetbrains | 失败 | 失败 | 失败 | candidate tests did not reject the behavioral mutant |

所有候选在原生系统生成；执行验收统一使用 Linux 无网 Docker。生成完成和单独测试通过均不能替代全部验收。

完整绑定见 [轮次清单](./latest-package-round.json)，具体失败断言、候选摘要及收据见 [只读质量复核](./latest-package-task-quality-review.json)。离线核验命令：`node verify-latest-package-round.mjs --require-complete`（尚未收齐时会失败）。

已验收的 **25 项产物及原始收据**可直接下载 [交付包](./accepted-deliverables.tar.gz)，对应 [文件清单及摘要](./accepted-deliverables.json)。每项按样本单独存放，包内保留历史版本、最新版本和全流程判定；仅适用于固定项目快照。打包未重新生成或执行测试。

Astra 对最新 Linux VS Code 五项的 [源码与收据专项复核](./latest-linux-vscode-review.json) 已确认两项全流程通过；其余三项分别漏测拒绝行为、导入路径错误和使用了旧 worker。

[最新 JetBrains 重启快照复核](./latest-jetbrains-restart-review.json) 比较了原文、已保存行及实际显示：会话和原文保留，但重启后把 Markdown 源文直接当作正文显示，原渲染结果未保持。通过文件验收的 `verify-33` 仍保留原生全流程失败。

[Windows JetBrains 启动专项复核](./latest-windows-jetbrains-startup-review.json) 保留了最后三项的失败证据：首次任务 CLI 私有目录 ACL 遍历超时，后续清理的进程身份查询也超时；另两项端口 8082 被占用。三项均只留下原占位文件，未达到交付要求。端口占用者及真实 runner 超时根因尚未确定；新版补测采用独立分片并修正评测环境目录关系。

## 未完成网络失败项的独立诊断

仅对 `verify-19` 的原 `fetch failed`、27 字节占位且验收失败执行一次单项采证；run `39089395770`，状态 `COMPLETED`。被动记录 Undici 安全错误码，不更改 fetch、重试策略、提示、工具权限或原判定。此项不覆盖原 25 项轮次，也没有重新生成已合格任务。见 [独立补测清单](./fetch-diagnostics-followup.json)。

补测候选验收：**失败**；全流程：**失败**。

本次生成正常，19 次请求均有完整用量收据；被动诊断仅有启用标识，未复现原网络错误，不能据此断言根因已修复。基线 17/17、候选 5/5 通过，但行为变异也为 5/5，故未达到任务验收要求。见 [只读补测复核](./fetch-diagnostic-followup-review.json)。

## 问题修复与下一版补测

已按用户要求将结论、代码修复与发布安排写入 [下一版记录](./next-release-plan.json)，JetBrains 修复来源见 [发布准备复核](./next-release-jetbrains-readiness.json)。

CLI **0.166.105**、VS Code **0.37.150** 与 JetBrains **0.4.167** 均已正式发布并完成公开安装包回读。JetBrains 新版已批准、上架且可公开下载，更新 ID 为 `1197193`；三个包的版本、摘要和 CLI 推荐关系已核验。三个发行标签仍固定 `d4065008bb`，该提交完整 CLI、Strict、IDE 与 ARM64 门禁全过。产品发布 PR [#461](https://github.com/chainlesschain/chainlesschain/pull/461) 已经六项保护检查正常合并，后续文档及合并提交不改变发行标签。[新版补测计划](./next-package-105-20261018-plan.json) 仅生成剩余 **20** 项，全部 **13** 个 run 已完成防重复派发与唯一绑定，固定评测来源 `a48e13fc30`；直接复用全部 **25** 项合格交付。首次收集时 13 个 run 均在 GitHub 队列中，新增生成及验收记录均为 0。公开回读和派发不构成新版任务通过，后续结果使用独立轮次保存。

修复覆盖静态导入错误反馈、真实 API 与 fixture 检查指导、延迟写入未完成时的终态、上游中止分类、安全传输原因代码，以及 JetBrains 重启后的 Markdown 渲染。新版公开后仅补未合格项；已有合格文件用于界面恢复核验时直接复用，不重新生成。

已执行 [verify-33 归档回复恢复检查](./next-package-archived-reply-recovery-plan.json)：复用原合格文件与原 Markdown，不调用模型。公开 `.167` 第二次检查已通过正式 Node 22.12 的 **7/7** canonical 回归并进入 Linux 2025.2 真实 IDE，但在初始阶段出现正文重复，未进入重启阶段。已分别复现并修复异步输入回执打断回复、退出回调抢先于最终 stdout 的产品缺陷；[修复前后证据](./next-release-validation/followup-106-archived-reply-regressions.json) 保留原失败。修正的夹具先保留独立 live 快照并检查正文唯一，再点击实际 Latest 按钮读取历史；公开 `.168` 的真实恢复检查尚未运行。

费用未评估、未推算。旧轮完整报告见 [README](./README.md)。

## 已保存的补测工具

新版派发凭据、完整 run 映射及原子 intent 日志见 [派发收据](./next-release-validation/native-105-dispatch-receipt.json)。原独立归档恢复 run [`39107288123`](https://github.com/chainlesschain/chainlesschain/actions/runs/39107288123) 在 Linux canonical 持久化回归失败，尚未启动真实 IDE；6 项单元检查通过、1 项失败，模型请求为 0。WSL 复现定位到评测环境把 `HOME` 与 `CHAINLESSCHAIN_HOME` 设为同一路径，正确触发产品的 `CONFIG_HOME_UNSAFE` 保护。现已分离评测 HOME，并补充断言和安全阶段诊断；两个受影响用例在 WSL Linux、Node 22.22.2 均通过。原失败和产品保护均保留，正式 Node 22.12 检查及公开插件的真实恢复仍待验证。

派发、证据收集和累计交付包工具已迁入 `packages/cli/scripts/`，不再依赖 `.work` 内的未跟踪脚本。派发 14 项、交付包 8 项、收集 8 项离线检查全部通过；此次工具验证未调用模型、未派发真实任务、未执行候选。七个 Python 文件语法检查及三个入口的 `--help` 检查通过。

在评测工作树根目录运行以下命令；`<plan>` 为已提交的补测计划，`<runs.json>` 为派发器完整解析后输出的绑定文件：

```powershell
python -X utf8 packages/cli/scripts/verify01-dispatch-native-retest.py --plan <plan>
python -X utf8 packages/cli/scripts/verify01-dispatch-native-retest.py --plan <plan> --submit
python -X utf8 packages/cli/scripts/verify01-dispatch-native-retest.py --plan <plan> --resolve
python -X utf8 packages/cli/scripts/verify01-collect-native-retest.py --plan <plan> --runs-file <runs.json>
node packages/cli/scripts/verify01-native-retest-round.mjs --plan <plan> --require-complete
python -X utf8 packages/cli/scripts/verify01-package-native-deliveries.py --round-name <next-package-round>
```

派发默认仅预览；`--submit` 才发送请求，`--resolve` 只读解析已有请求。所有关联工作树共用 Git common directory 对应的 `.work/next-package-dispatch/` 日志；未解析 intent 必须保留，不得删除或盲目重发。派发至所有 run 绑定完成期间应保持评测分支 HEAD 不变。GitHub 凭据只通过进程环境 `GH_TOKEN` 传入，不放入参数或文件。

收集器和归档读取器只读取已有任务；严格完整验收后才能把轮次及摘要显式加入 `next-package-round-chain.json`。交付包工具默认预览，确认链尾轮次后添加 `--pack` 才在共享 `.work/accepted-round-exports/` 创建独立包；原 25 项产物和收据按字节复用，原包不覆盖。原子创建交付目录目前限 Windows。以上工具及记录属于评测分支，发行源码仍固定 `d4065008bb`。

派发器现支持 `--submit --max-new-dispatches 2`，每次最多提交两个尚未请求的分片。只有等待本批生成结束后再提交下一批，才能减少同时执行量；全部批次必须保持同一已提交计划及评测 HEAD，未解析 intent 仍须先只读解析。只有全部分片完整绑定后才创建正式账本。19 项派发回归通过，见[验证记录](./next-release-validation/native-dispatch-batch-validation.json)；未调用模型、未改变请求预算或验收规则，并发也未被确定为此前网络失败的原因。

公开回读入口已保存为 `packages/cli/scripts/verify-public-cli.py`、`verify-public-vscode.py` 和 `verify-public-package-set.py`。它们要求显式完整产品 SHA、新 manifest 及前轮 manifest，按 CLI → VS Code → 三包清单依序复验；版本从固定 Git 对象读取，最终清单使用独占创建。7 项离线回归通过；源码绑定见[记录](./next-release-validation/public-readback-generic-tool-git-binding.json)。

## 持续修复与发布要求

评测隔离修复已提交并推送为 `04d48ca7fe`。零模型恢复检查 [`39108779712`](https://github.com/chainlesschain/chainlesschain/actions/runs/39108779712) 固定该提交并使用公开 `.167`，已结束失败；它与原失败 `39107288123` 均保留。后续工具严格从明确选择的公开 manifest 派生插件版本、ZIP 摘要和大小，保留公开批准、安装树、正文唯一及重启身份检查；Linux **8/8**、Windows **7 通过 / 1 平台跳过**，UI Java 编译通过。没有对旧 `.167` 再次派发。13 个真实任务分片仍固定原评测来源 `a48e13fc30`，没有重新派发。

用户明确要求继续修复不合格项，重新发布 CLI 和 IDE 插件，直到普通 **36** 项与首次 **9** 项均合格。每轮根据实际失败修复产品，经精确提交的正式门禁、发布与公开包核验后，再补测未合格项；已合格的文件和收据直接复用。每次记录失败原因、修复、版本和验收结论。候选文件通过与原生全流程通过分别保留，宿主、终态及恢复失败继续跟踪，历史失败不能被改写或用局部检查通过替代。
