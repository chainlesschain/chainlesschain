# fdead 工程提交 Actions 快照与旧提交结算

准确工程提交为 `fdead28689393bdf6881c9f806927f9f09333194`，API 回读时点 **2026-10-12T05:51:31.849Z**。下列每项按自己的 run/job 原件判定。API 开始采集的 run 状态与随后 job 快照可能相差数秒，未完成和排队均不计为通过。全矩阵完成标志为 `false`，当前不作为公开发行、合并或正式验收准入。

| 工作流                                                                                                                            | Run 状态              | Job 数量                                        |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| [CLI CI (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206567211)                                | queued / pending      | success=26, in_progress=13, queued=26           |
| [Model Catalog Review (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206566986)                  | completed / success   | success=1                                       |
| [IDE Roadmap Accessibility Performance (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206567090) | completed / success   | success=4                                       |
| [Context Memory Kernel CI (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206566942)              | completed / success   | success=3                                       |
| [CLI Strict Sandbox (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206566970)                    | completed / success   | success=5                                       |
| [CI Tests (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206566916)                              | in_progress / pending | success=12, in_progress=1, skipped=1            |
| [CLI Session Host Consistency (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206567032)          | completed / success   | success=3                                       |
| [IDE Roadmap Safety Matrix (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206567045)             | completed / success   | success=4                                       |
| [Code Quality & Security (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206567172)               | completed / success   | success=7, skipped=2                            |
| [VERIFY01 Host Diagnostics (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206567047)             | in_progress / pending | success=6, in_progress=1                        |
| [IDE Roadmap Live Provider Trajectory (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206567110)  | completed / success   | success=4, skipped=2                            |
| [IDE Extensions (pull_request)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206566982)                        | in_progress / pending | success=12, in_progress=3, failure=1, skipped=1 |
| [Context Memory Kernel CI (push)](https://github.com/chainlesschain/chainlesschain/actions/runs/38206561968)                      | completed / success   | success=3                                       |

Model Catalog PR 路径的本地合同检查通过；官方端点抓取与上游版本漂移检测为条件跳过，不能把此 run 当作上游场景关闭。完整步骤见 [summary.json](./summary.json)。Accessibility/Performance 路径仍是自动化回归，不代替真人辅助技术、固定硬件 SLO 或 8h/24h 观察。

历史 `bdaf873c68a706ee65b985892d2603cbe0510979` 于 2026-10-12T05:20:44.444Z 的结算另行保存：Strict5/5、Host7/7、Quality7成功/2条件跳过、Kernel3/3、Model本地合同成功；CLI21成功/48取消、CI Tests12成功/1取消/1跳过、IDE14成功/5取消。未完成矩阵在新工程提交后由并发规则取消，取消与结算步骤的 failure 不自行改记为原测试失败或完整通过，原始逐步记录保留。旧成绩不转移给当前或后续文档 SHA。

当前及历史 run/jobs JSON、只读采集器与失败日志（如有）保存于 [manifest.json](./manifest.json)，含 gzip 与原文双摘要。原 [ci-progress](../ci-progress/README.md) 与早期快照均未覆写。没有新增付费调用或发行，正式 **36+9 / NOT_RUN / observed=0 / $99** 与冻结指纹、原窗口及其未完成验收保持。
