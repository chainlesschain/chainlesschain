# 最新 CLI / IDE：36+9 实际任务结果

评测版本：CLI **0.166.104**、VS Code **0.37.149**、JetBrains **0.4.166**。

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

下一版候选：CLI **0.166.105**、VS Code **0.37.150**、JetBrains **0.4.167**；发布 PR [#461](https://github.com/chainlesschain/chainlesschain/pull/461)，当前记录状态 `ORIGINAL_ROUND_ARCHIVED_WAITING_EXACT_COMMIT_RELEASE_GATES`。发布需精确提交的完整矩阵、npm OIDC 和公开包回读；这些优化尚不能计为新版实际任务通过。

修复覆盖静态导入错误反馈、真实 API 与 fixture 检查指导、延迟写入未完成时的终态、上游中止分类、安全传输原因代码，以及 JetBrains 重启后的 Markdown 渲染。新版公开后仅补未合格项；已有合格文件用于界面恢复核验时直接复用，不重新生成。

已准备 [verify-33 归档回复恢复检查](./next-package-archived-reply-recovery-plan.json)：复用原合格文件与原 Markdown，在公开 `.167` 的 Linux 2025.2 真实 IDE 验证重启后正文、会话和行身份，不调用模型。当前仅完成本地回归与 UI 编译，真实公开插件检查尚未运行；旧全流程失败判定保持不变。

费用未评估、未推算。旧轮完整报告见 [README](./README.md)。
