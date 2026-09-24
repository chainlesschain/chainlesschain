# RSIAgent 第二百零八次工程实施：签名预算中断的计划分母记录

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 207 批的联合证据回读。<br>
> 状态：预算中断且仍有最终签名回执的运行可保留计划分母与未解析观察；其他异常失败和真实 PM 对照仍待完成。

## 问题与实现

Eval Gate 在总预算耗尽时会签发 `rejected` 回执，保留已计量的汇总 usage 和 execution count，但 validation/test 汇总及逐题证据均为空。原 PM 报告 API 正确拒绝缺少逐题证据，却无法给实验记录留下这次已开始运行的计划分母。若后续人工只汇总完整运行，就可能静默遗漏预算失败。

[PM benchmark](../../../packages/cli/src/lib/evolution/pm-exploration-benchmark.js) 新增 `buildPmExplorationEffectInterruptedEvidence` 与 `verifyPmExplorationEffectInterruptedEvidence`。它们复用完整报告的冻结计划、实际 suite/policy 和独立预登记上下文校验，并两次验证最终签名回执及其有效期。仅接受 `reasonCodes: ["total-budget-exceeded"]`、至少 1 次签名计量执行、无 validation/test 结果的拒绝回执；预检阶段的 `needs-more-evidence`、执行预算不足等零执行结果，以及 grader 崩溃后没有最终签名回执的异常，不能进入此合同。

输出记录计划总执行数、每组计划测试观察数、签名 execution count、签名汇总 usage，以及每组未解析测试观察数。它明确设定 `authenticatedTestOutcomesPerArm: 0`、`outcomeAvailability: "unavailable"`、`statisticalEstimateAvailable: false` 和 `denominatorTreatment: "unresolved-blocks-promotion"`。这些值表示没有可认证的逐题结果，**不表示所有测试题都实际执行或业务失败**；汇总 usage 也不能分配到 seed、arm 或阶段。预算硬门已失败，因此 `evidenceDecision` 为 `threshold-not-met`，且不能晋级。该记录供后续实验 cohort 审计保留计划分母，不计算伪造的完成率或 bootstrap 区间。

## 验证与剩余边界

[Eval Gate 回归](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js) 使用真实测试签名链触发首次计量后预算耗尽，验证回执无逐题证据、计划测试分母为每组 60、已计量执行数为 1、全部测试结果仍标记未解析；重新回读会拒绝篡改的已认证结果数和伪造 verifier。另用低于训练任务门槛的签名零执行回执验证预检拒绝不会被计作预算中断。

相关回归为 **6 个测试文件、306 项通过、1 项跳过**；ESLint、Prettier 与 `git diff --check` 均通过。

仍需对 grader/执行器崩溃、超时及进程中断建立独立签名的失败事件和成本记录，才能形成覆盖全部启动运行的 cohort 分母；还需认证准备阶段全部成本、实际配置生效、耐久归档、真实 PM baseline/candidate 对照与 Pilot。G08 仍为“部分完成（待实测）”，G01–G08 完整关闭数量仍为 0。
