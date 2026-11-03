# 完整45项复测最终结果

[Actions 41638188839](https://github.com/chainlesschain/chainlesschain/actions/runs/41638188839)，执行提交 `54d0064cab09ac1fe291d4d8b83bcb689a9c7d97`。本轮包含36项普通任务及9次独立首次安装；三包原始发行字节及原冻结任务项目均保持绑定。

生成通过 **39/45**；候选独立验收通过 **24/45**；生成、范围和验收均通过 **24/45**。普通任务 **21/36**，首次安装 **3/9**。

已核对90份原始摘要及候选、setup/check回执摘要，完整证据为true。去重累计覆盖 **36/45**；不扣除此前成功，不把本轮失败改判通过。Sol45/45是跨版本、含修复源码的累计覆盖；冻结项目历史41/45单列，不能将其当成本轮同配置完整对照。

物理调用预留槽598，完整用量回执596，已证实HTTP前未发出1，已发出但用量未知1。实际账户账单未核对；未知费用保持null，不能计零。

原始报告：[results.json](./final-54d0064cab/results.json)；[逐项分析](./failure-analysis.json)；[历史累计账本](./cumulative-status.json)。

| 样本                         | 生成   | 候选验收 | 严格通过 | 分类及具体依据                                                                              |
| ---------------------------- | ------ | -------- | -------- | ------------------------------------------------------------------------------------------- |
| `first-run-win32-cli`        | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-01`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-10`                  | 通过   | 未通过   | 未通过   | 候选 6/6 项断言失败；见failure-analysis                                                     |
| `verify-19`                  | 未通过 | 未通过   | 未通过   | 内部2048 token摘要恰达预算被误判整项截断；候选另有1/3项断言失败，框架修复不自动代表候选合格 |
| `verify-28`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `first-run-win32-vscode`     | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-02`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-11`                  | 未通过 | 未通过   | 未通过   | fetch failed                                                                                |
| `verify-20`                  | 通过   | 未通过   | 未通过   | 未检出 `approval-overrides-policy-deny`                                                     |
| `verify-29`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `first-run-win32-jetbrains`  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-03`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-12`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-21`                  | 通过   | 未通过   | 未通过   | mutant failure must include an assertion, not a syntax/import/runner error                  |
| `verify-30`                  | 通过   | 未通过   | 未通过   | 未检出 `ignore-animation-fallback-pixels`                                                   |
| `first-run-linux-cli`        | 未通过 | 未通过   | 未通过   | 连接在HTTP请求发出前失败；本次预留槽未发出                                                  |
| `verify-04`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-13`                  | 通过   | 未通过   | 未通过   | 未检出 `ignore-image-change-on-pinned-handle`                                               |
| `verify-22`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-31`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `first-run-linux-vscode`     | 通过   | 未通过   | 未通过   | 候选 3/6 项断言失败；见failure-analysis                                                     |
| `verify-05`                  | 通过   | 未通过   | 未通过   | 候选 1/6 项断言失败；见failure-analysis                                                     |
| `verify-14`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-23`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-32`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `first-run-linux-jetbrains`  | 未通过 | 未通过   | 未通过   | 生成改动超出交付范围；详见原始delivery summary及路径证据                                    |
| `verify-06`                  | 通过   | 未通过   | 未通过   | acceptance requires executed test cases                                                     |
| `verify-15`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-24`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-33`                  | 通过   | 未通过   | 未通过   | 候选 3/4 项断言失败；见failure-analysis                                                     |
| `first-run-darwin-cli`       | 未通过 | 未通过   | 未通过   | 提供方主动结束，必需交付文件仍未写出                                                        |
| `verify-07`                  | 通过   | 未通过   | 未通过   | 候选 3/4 项断言失败；见failure-analysis                                                     |
| `verify-16`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-25`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-34`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `first-run-darwin-vscode`    | 未通过 | 未通过   | 未通过   | 火山实际HTTP403 AccountOverdueError：账户欠费中断，不能计为模型能力失败                     |
| `verify-08`                  | 通过   | 未通过   | 未通过   | 候选 1/6 项断言失败；见failure-analysis                                                     |
| `verify-17`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-26`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-35`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `first-run-darwin-jetbrains` | 通过   | 未通过   | 未通过   | 未检出 `trust-tampered-source-digest`                                                       |
| `verify-09`                  | 通过   | 未通过   | 未通过   | 候选 3/6 项断言失败；见failure-analysis                                                     |
| `verify-18`                  | 通过   | 通过     | 通过     | 生成、范围及独立验收均通过                                                                  |
| `verify-27`                  | 通过   | 未通过   | 未通过   | 候选 1/5 项断言失败；见failure-analysis                                                     |
| `verify-36`                  | 通过   | 未通过   | 未通过   | 候选 1/3 项断言失败；见failure-analysis                                                     |

正式冻结计划仍为 `NOT_RUN`；本轮是用户另行授权的诊断。完整单轮、失败补测和历史累计保持各自身份。
