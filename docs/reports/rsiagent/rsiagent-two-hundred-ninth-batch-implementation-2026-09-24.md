# RSIAgent 第二百零九次工程实施：完整与预算中断运行的登记槽位汇总

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 208 批签名预算中断记录。<br>
> 状态：已可在同一冻结计划下汇总完整签名运行与预算中断签名运行；启动覆盖、其他异常失败与生产效果验收仍待完成。

## 实施内容

完整逐题效果报告与预算中断记录此前各自可回读，但没有共同分母。新增 `buildPmExplorationEffectAttemptCohort` 和 `verifyPmExplorationEffectAttemptCohort`，从可信宿主独立保存的 cohort ID、冻结计划摘要和运行槽位清单出发，逐槽重新认证完整效果报告或预算中断记录。每个槽位指定独立 ID、预期签名回执摘要和回执上下文；缺槽、重复槽、重复回执、重复运行 ID、计划替换或已保存证据篡改均拒绝。所有数据在异步验签前快照，计算结束再复核全部签名回执有效期。

汇总按冻结 `seed × test task × 登记槽位` 计算每组计划观察数。完整运行贡献已认证逐题观察和通过数；预算中断只贡献未解析观察，不被补造成通过或业务失败。输出分别列出 baseline/candidate 的 `authenticatedOutcomes`、`verifiedPasses`、`unresolved`，要求各组已认证观察加未解析观察恰好等于登记计划分母。只要有预算中断，晋级即被阻断；即使全部登记槽位都有结果，当前接口也不重新计算跨运行 bootstrap 或宣称完整效果报告认证。

这份清单只证明**所登记槽位**已经由相应签名证据覆盖。槽位登记本身尚无独立签名的启动日志或耐久完整性证明，因此 `cohortCompletenessAuthenticated: false`、`reportAuthenticated: false`、`statisticalEstimateAvailable: false`、`qualifiesForPromotion: false` 始终保持。它不能发现从清单中整体省略的运行，也不能包含没有最终签名回执的 grader、执行器或进程异常。

## 验证与剩余边界

[集成回归](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js) 使用相同 PM 计划下的一次完整签名评测和一次签名预算中断。两个登记槽位给出每组 120 个计划观察；完整运行贡献每组 60 个已认证观察，预算中断贡献每组 60 个未解析观察，候选组只有 57 个已认证通过。重新回读可复算同一结果；缺槽、重复登记回执和篡改通过数均被拒绝。

相关回归为 **6 个测试文件、307 项通过、1 项跳过**；ESLint、Prettier 与 `git diff --check` 均通过。

下一步需为**所有启动尝试**建立独立签名且耐久的槽位清单，并为无最终 Eval Gate 回执的异常失败签发可验证的失败事件与成本记录，之后才能判断完整 cohort 分母。准备阶段全部成本、目标环境配置生效、真实 PM baseline/candidate 对照和 Pilot 也仍待验收。G08 维持“部分完成（待实测）”，G01–G08 完整关闭数量仍为 0。
