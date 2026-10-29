# Goal 模型评审预算与取消闭环

日期：2026-10-29。对应[差距评审](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.2、4.3、4.10、4.11 节。按用户要求直接修改主分支；Microsoft 渠道继续暂缓。

默认 `--goal-condition` 模型评审和 `--goal-assess` 原先写入独立用量账本，但没有消耗作者任务的 `IterationBudget`，也没有将该调用的 token / 缓存用量与费用汇入本次运行结果。取消信号和明确输出上限未传入；评审请求失败还可能被当成普通未达标条件，触发下一轮。

本次提取 [goal-model-call.js](../../packages/cli/src/lib/goal-model-call.js)，两个入口共用原有模型传输与用量结算：

| 行为                | 修复后的结果                                                                       | 验证                                                       |
| ------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 回合预算            | 请求前检查并同步预留同一 `IterationBudget`；用完最后一轮后不启动额外评审或作者续跑 | 最后一轮拒绝、评审未通过后耗尽、`--goal-assess` 共用预算   |
| 用量与费用          | 评审已知用量加入运行结果、流事件和 Goal 累积状态；缓存计费继续走既有 `CostBudget`  | 结果 / Goal token 与费用一致；评审触及费用上限返回退出码 4 |
| 取消                | 传递本次运行及 session budget 信号；取消后的迟到结果不完成 Goal，已知用量仍保留    | 调用前取消、持久意图后未发送、调用中取消后返回用量         |
| 输出上限            | 评审最多请求 2048 输出 token；调用方指定更小上限时取更小值，保留服务档位           | 较小上限与默认上限接线                                     |
| 未知用量 / 传输失败 | 返回明确错误，不接受模型完成声明，不通过下一外层轮次隐式重试                       | 缺失、空对象、负数用量；传输失败与原始错误脱敏             |
| 持久化              | 保留调用前写入及结算后再汇总的顺序；写失败仍为终止错误                             | 开始记录 / 结算记录写失败；同一 session budget 不重复计数  |
| 临时会话            | 在内存中校验和汇总用量，不创建会话账本文件                                         | 临时会话用量归一化及无效用量阻断                           |
| Goal 自身预算       | 已达到 Goal token、费用或时间上限时不再发送默认模型评审                            | token 上限已耗尽时零额外调用                               |

`contains:`、`file-exists:`、`exit-zero:` 等确定性条件沿用原有验收方式。本次没有把模型评价改成独立产物 checker，也没有完成工作区摘要绑定。费用仍是 token 估算；未知模型定价和正式预算 / native 准入边界不由这次修复改变。

验证结果：Windows、Node `22.22.2`，**9 个套件、224 项测试全部通过**。其中两个新增套件共 22 项，覆盖上述实际运行边界；其余包括完整 headless runner、费用预算、Goal 引擎、工具证据、评审和用量账本回归。模型响应均由测试替身返回，没有真实付费模型请求。

源码出口审查覆盖待提交的源码和脚本字节：**78 个候选、0 个未分类、0 个解析错误**。额外复核了两个先前已合入改动的完整差异并更新旧摘要：Volcengine 推荐模型名称，以及只读 Git 命令跳过检查点；没有改变其出口分类。工作区四个被忽略的生成 Web Panel 文件未纳入源码快照，也未为了本地通过而重新分类。

JavaScript 语法、Prettier 和 `git diff --check` 通过。ESLint 因缺少本地 `@eslint-community/eslint-utils` 依赖未启动，不计通过。源码摘要、测试原始 JSON 压缩归档与审查报告见[验证回执](./cli/evidence/goal-model-budget-2026-10-29/verification.json)。这些是本地结果，尚无本次修复的三系统发行门禁或公开包证据。

复现命令：

```powershell
cd packages/cli
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/headless-goal-model-budget.test.js __tests__/unit/goal-model-call.test.js __tests__/unit/headless-runner.test.js __tests__/unit/headless-runner-cost-budget.test.js __tests__/unit/headless-runtime-ledger-failclosed.test.js __tests__/unit/goal-assess.test.js __tests__/unit/direct-model-usage.test.js __tests__/unit/goal-condition-engine.test.js __tests__/unit/goal-check-evidence.test.js --maxWorkers 1
```

跨版本产物合格保持 **34/45**，剩余 **11** 项产物；真实任务验收、工作区 / 产物证据绑定、完整恢复旅程、MCP 真实任务 A/B 和 Memory 完整磁盘性能基线继续跟踪，不因本次回归通过自动结案。

> 公开状态更新（第三十七批）：本页保留实施时的本地验证范围；本修复现已包含在公开 CLI `.130`，准确发行源码为 `f3015e7996`。祖先关系、公开包原始字节及完整三系统门禁见[新回读](./cli-ide-release130-reconcile-progress-2026-10-29.md)。真实任务质量和费用验收继续单独跟踪。
