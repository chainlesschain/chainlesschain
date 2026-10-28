# CLI / IDE 差距优化第十一批：Codex 三系统 CI 与分页边界

日期：2026-10-28。承接[第十批本地验证](./cli-ide-codex-history-progress-2026-10-28.md)及[差距复核](./cli-ide-codex-claude-gap-review-2026-10-27.md)。草稿 PR：[#504](https://github.com/chainlesschain/chainlesschain/pull/504)。当前兼容验证源码为 `26e481c909561c6ff60b6d05c55613a787388e68`。

## 本批修复

[VS Code README](../../packages/vscode-extension/README.md)已有 `.166 / .128` 发布回执，但当前版本块缺少 `release166-status` 标记、机器可核验的配对声明及对应表格。[原始 CI](https://github.com/chainlesschain/chainlesschain/actions/runs/40621971135/job/122598068671) 的完整单元测试为 326 / 327 通过，商店概述检查拒绝了这个状态块。提交 `36e199c03d` 补齐结构后，本地完整 VS Code 单元测试 327 项通过；使用既有发布回执，没有重新发行或更换推荐版本。

在该提交的 [Codex CI](https://github.com/chainlesschain/chainlesschain/actions/runs/40622671473) 中，Linux `.164`、macOS `.160`、Windows `.160` 的重启旅程读取线程时只得到 1 / 2 个身份。原始失败报告及通知保留在[失败清单](./cli/evidence/codex-ci-2026-10-28/retained-failures.json)中；失败运行未计为合格矩阵。

## 游标诊断与明确支持的查询路径

用隔离的 Windows 原生进程并发创建两个持久线程，先完成两次模拟请求，关闭并重新启动进程，然后比较每页一项和一次读取全部身份的结果。两个版本的[原始诊断](./cli/evidence/codex-ci-2026-10-28/diagnostics/)均绑定源码 `26e481c909`、二进制摘要及固定版本，使用本地模拟服务。

| 查询                                     | `.160` 逐页读取身份数 / 完整列表 | `.164` 逐页读取身份数 / 完整列表 |
| ---------------------------------------- | -------------------------------- | -------------------------------- |
| 默认 rollout 扫描、默认排序              | 1 / 2                            | 1 / 2                            |
| `useStateDbOnly:true`、默认 `created_at` | 1 / 2                            | 2 / 2                            |
| `sortKey:recency_at`                     | 2 / 2                            | 2 / 2                            |

这些是特定并发样本的结果；默认扫描的时间处理及旧版默认数据库游标仍有未验收边界。不能把后续指定查询路径的成功推广到所有历史查询参数。

提交 `e5d14ee0fa` 显式选择数据库路径，但 `.160` 并发样本仍漏项；提交 `26e481c909` 进一步指定 `sortKey:recency_at`。现在[恢复探针](../../packages/cli/scripts/codex-app-server-history-probe.mjs)并发创建两线程，以 `useStateDbOnly:true`、`sortKey:recency_at`、升序、每页 1 项读取；继续核对两个身份、分页续读、设置恢复、原上下文保留及请求不重放。

没有放宽两个身份必须全部出现的断言，也没有用延迟创建线程来回避碰撞。报告新增 `threadListMode`、`threadListSortKey`、`threadCreationTimes`、`sameCreatedAtSecond` 和 `rolloutScanPaginationVerified:false`，让样本与查询范围可追溯。[支持说明](../cli/CODEX_APP_SERVER_SUPPORT.generated.md)同步标出默认扫描及旧版 `created_at` 边界。

## 验证状态

本地 Codex / 外部适配器回归为 6 个套件、85 项通过；[原始测试报告](./cli/evidence/codex-ci-2026-10-28/local-unit-results.json)。新增同时间线程和不透明游标的筛选条件保持检查。两个版本均通过 Windows 的数据库 `recency_at` 重启旅程。相关语法、Prettier、文档生成一致性及隔离 ESLint 检查通过。

GitHub Actions [40623725845](https://github.com/chainlesschain/chainlesschain/actions/runs/40623725845) 已成功完成，绑定准确提交 `26e481c909561c6ff60b6d05c55613a787388e68`，全部 **21 / 21** 作业通过：12 个基础版本 / 平台单元、6 个 schema / turn / 恢复单元、清单与文档检查、适配器合同和最终汇总门禁。

| 固定版本                             | Linux x64 | Windows x64 | macOS ARM64 |
| ------------------------------------ | --------- | ----------- | ----------- |
| `0.160.0` schema / turn / 数据库恢复 | 通过      | 通过        | 通过        |
| `0.164.0` schema / turn / 数据库恢复 | 通过      | 通过        | 通过        |

[完整 CI 制品回读](./cli/evidence/codex-ci-2026-10-28/run-40623725845/verification.json)保存运行、作业及 19 份制品的元数据，并下载六个原生单元的全部原始文件及基础矩阵汇总。核对内容包括准确源码、上游版本、平台、schema、二进制、通知、审批和报告摘要；六个样本均实际在同一秒创建两线程。每个原生单元包含 8 次本地模拟请求，合计 48 次，外部模型请求为 0。

先行保存的[`.164` 目标版本回读](./cli/evidence/codex-ci-2026-10-28/target-0.164.0/verification.json)仍保留当时的 `fullMatrixVerified:false`；该文件只代表目标版本先完成时的快照，完整矩阵结论以上述最终回读及 GitHub 汇总门禁为准。[回读脚本](./cli/evidence/codex-ci-2026-10-28/collect-ci-evidence.mjs)可重新核对该准确提交的制品。

## 仍未关闭的验收

同一 PR 的另一工作流 [VERIFY01 Host Diagnostics](https://github.com/chainlesschain/chainlesschain/actions/runs/40623725873) 有三个 JetBrains 宿主首次配置旅程失败，分别为 Linux、Windows 和 macOS Intel。日志显示 `onboarding UI journey exited 1/null`，具体原因仍需读取其宿主制品后定位；[检查快照](./cli/evidence/codex-ci-2026-10-28/other-pr-checks.json)保留作业链接。不能将 Codex 兼容工作流通过解释为这三个 IDE 旅程通过，PR 继续保持草稿状态。

实验允许列表、默认关闭策略和生产准入保持原范围。真实模型任务、正式付费 / native 范围及 npm 发行门禁继续依据各自完整证据验收。
