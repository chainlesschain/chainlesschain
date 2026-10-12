# CLI .99 / IDE 候选准确源码 CI 快照

源码：`8750f6afc346458115ff0e84ec9963f3dec79ffa`；API 采集：2026-10-12T06:29:17.020Z。原API、逐job、checkout来源及已采集宿主证据均以原字节压缩，并绑定压缩/解压双SHA256，见[manifest.json](./manifest.json)与[summary.json](./summary.json)。

| 工作流                                                                                                             | run / attempt   | 状态                 | job 结算                                      |
| ------------------------------------------------------------------------------------------------------------------ | --------------- | -------------------- | --------------------------------------------- |
| [Memory Query Index Measurement](https://github.com/chainlesschain/chainlesschain/actions/runs/38211137620)        | 38211137620 / 1 | queued / 未终结      | in_progress=2；queued=1                       |
| [Model Catalog Review](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979959)                  | 38210979959 / 1 | completed / success  | success=1                                     |
| [CLI Background Interaction E2E](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979763)        | 38210979763 / 1 | queued / 未终结      | success=2；queued=1                           |
| [CI Tests](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979960)                              | 38210979960 / 1 | queued / 未终结      | queued=9；success=3；in_progress=1；skipped=1 |
| [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/38210980033)                    | 38210980033 / 1 | queued / 未终结      | success=4；queued=1                           |
| [IDE Roadmap Live Provider Trajectory](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979977)  | 38210979977 / 1 | queued / 未终结      | in_progress=2；queued=1；skipped=2            |
| [IDE Roadmap Safety Matrix](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979987)             | 38210979987 / 1 | queued / 未终结      | success=1；queued=2                           |
| [Code Quality & Security](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979852)               | 38210979852 / 1 | queued / 未终结      | success=2；queued=4；skipped=2                |
| [Context Memory Kernel CI](https://github.com/chainlesschain/chainlesschain/actions/runs/38210980124)              | 38210980124 / 1 | queued / 未终结      | success=2；queued=1                           |
| [Full Test Automation with Diagnostics](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979772) | 38210979772 / 1 | in_progress / 未终结 | in_progress=1；success=2                      |
| [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/38210980329)                                | 38210980329 / 1 | queued / 未终结      | queued=59；success=6                          |
| [IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979819)                        | 38210979819 / 1 | queued / 未终结      | queued=1                                      |
| [VERIFY01 Host Diagnostics](https://github.com/chainlesschain/chainlesschain/actions/runs/38210980010)             | 38210980010 / 1 | queued / 未终结      | success=3；in_progress=3；queued=1            |
| [PR Tests](https://github.com/chainlesschain/chainlesschain/actions/runs/38210980105)                              | 38210980105 / 1 | in_progress / 未终结 | success=1；in_progress=1                      |
| [IDE Roadmap Accessibility Performance](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979889) | 38210979889 / 1 | completed / success  | success=4                                     |
| [CLI Session Host Consistency](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979952)          | 38210979952 / 1 | completed / success  | success=3                                     |
| [IDE ARM64 Host Validation](https://github.com/chainlesschain/chainlesschain/actions/runs/38210979864)             | 38210979864 / 1 | in_progress / 未终结 | success=6；in_progress=3                      |
| [Context Memory Kernel CI](https://github.com/chainlesschain/chainlesschain/actions/runs/38210971992)              | 38210971992 / 1 | completed / success  | success=3                                     |

快照不等同发行准入。排队、运行中、失败、取消均不计成功；默认PR merge checkout须另核实际commit与tree，不能只看API head_sha。旧fdead macOS P95=2113ms的原失败保持，2s门限/100样本不放宽。正式36+9仍NOT_RUN/observed=0，未增加真实付费provider请求。
