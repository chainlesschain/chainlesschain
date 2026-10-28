# 真实任务续测：保留 .128 记录并准备 .129（2026-10-29）

本批完成旧轮次证据继承与新计划准备，未新增真实任务通过数。累计交付物仍为 **34/45**（普通 27/36、首次入口 7/9）。Microsoft 渠道按用户要求暂缓。

| 工作            | 当前结果                                                                                                                 | 边界 / 下一步                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `.128` 运行核对 | 按准确源码 SHA 查询全部 11 个工作流，均已结束；包含从 `main` 派发的首个运行                                              | 不按单一分支过滤，避免漏掉既有责任                                                                   |
| 原始计划与账本  | 字节保持不变，账本仍是 `IN_PROGRESS`                                                                                     | 9 项失败、2 项未派发均保留，未知用量不改写                                                           |
| 继承已验收产物  | 原严格校验器复核压缩归档、验收记录和摘要后，继承 `verify-06`、`first-run-linux-cli`，累计 34 项                          | `verify-06` 原生恢复未通过；不重复生成合格产物                                                       |
| 旧轮次替代说明  | 新增单独带摘要的 supersession 记录，绑定旧计划、账本、完整远端运行清单和新公开包                                         | 不给未派发任务完成分，不结清历史账单，不授予新预算                                                   |
| 新公开配对      | CLI `0.166.129`、Open VSX `0.37.167`、JetBrains `0.4.184` 均可公开获取；JetBrains 已批准、列出且未隐藏                   | CLI 来源 `fd8a2163…`，IDE 来源 `800e9cc9…`，不假定三个包来自同一次提交                               |
| 公开归档回读    | CLI SHA-512 integrity、源码选定文件和发行回执匹配；VSIX 摘要与发行回读匹配；JetBrains 所有归档成员与成功发行 CI 产物相同 | JetBrains ZIP 容器字节不同，不能声称整包字节相同；未执行下载包                                       |
| `.129` 新计划   | 仅剩余 11 项，全部拆成单样本；优先 `verify-11`、`verify-30`                                                              | `PREPARED_NOT_DISPATCHED`；冻结项目、模型与原有预算限制继续保留                                      |
| 审查模式        | 保持 `reviewChanges=true`；20 个模型回合、最多 24 个物理请求、每请求 8192 输出 token 和六种文件工具                      | 不通过增加预算改变原验收口径；一个样本完成收集和用量核对后才处理下一个                               |
| CI 摘要修复     | 修正安全映射中 `headless-runner.test.js` 的过期摘要                                                                      | 原提交 `04648988ac` 的 Linux 单元审计和 Linux / Windows 严格沙箱失败均指向此项；不把旧失败改写为通过 |
| 本地回归        | 轮次 / 替代记录 **44/44**；指定安全映射 **29/29**；统一审计 **15/15**                                                    | Windows 本地结果。安全映射通过名称筛选另有 960 项未运行；准确新提交的三系统 CI 另行跟踪              |

## 证据

- [公开包固定清单](./cli/verify01-package-sets/2026-10-29-review-129.json)及[归档回读](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-128-review-20261028/supersession/package-readback.json)。公开归档保留在本地操作目录，URL、长度、摘要和逐文件核对结果可用于独立回读。
- [旧轮次替代说明](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-128-review-20261028-supersession.json)、[完整运行清单](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-128-review-20261028/supersession/runs.json)、[显式轮次链](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-round-chain.json)。
- [11 项新计划](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-129-review-20261029-plan.json)及[本地验证摘要](./cli/evidence/native-retest129-2026-10-29/validation.json)。

离线验证命令：

```powershell
node --test packages/cli/test-node/verify01-native-retest-supersession.node-test.mjs packages/cli/test-node/verify01-native-retest-plan.node-test.mjs packages/cli/test-node/verify01-native-retest-round.node-test.mjs
node packages/cli/scripts/verify01-native-retest-round.mjs --plan docs/research/cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-129-review-20261029-plan.json --plan-only
node packages/cli/scripts/run-claude-security-map-tests.mjs --output .work/native-retest129-security-map.json
```

新校验覆盖活跃 / 未收集运行、重复执行、截断清单、遗漏待派发样本、未知本地请求、未公开版本、未批准 JetBrains 包、摘要改写、越界路径和晚于结案的观察；真实归档回归另确认伪造验收标记、缺失 / 损坏归档仍被原严格校验器拒绝。`--require-complete` 仍拒绝 `.128` 未完整轮次。

补充验证：工作流完整派发前检查清单 **110/110** 本地通过，其中包含上述 44 项轮次测试，不重复累加。共享资金检查已纳入 `.128` 的全部 11 个运行、此前已知支出和原有责任，在原用户授权额度内允许下一单样本 `verify-11`；未重置预算、未增加资金授权、未改写未知用量，金额仅保存在本地私有记录。

继续派发前，还需验证准确已提交源码及当前公开版本。新计划不代表已执行请求、已结账或已取得正式付费 / native 生产准入。
