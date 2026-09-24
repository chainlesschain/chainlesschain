# RSIAgent 第二百一十四次工程实施：零执行预检拒绝的签名槽位证据

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 211–213 批异常、缺失回执及用量汇总。<br>
> 状态：已签名的零执行预检拒绝可进入冻结槽位的未解析分母；实际启动完整性与效果结论仍未认证。

## 实施内容

新增 `buildPmExplorationEffectPreflightRejectionEvidence` 和对应回读 API。它重新认证 Eval Gate 最终签名回执、冻结计划、实际 suite/policy 及运行上下文，再独立复算训练/验证/测试数量和计划执行数。只有两类真正的零执行预检结果可通过：数据集低于策略下限时的 `needs-more-evidence` 和相应 `insufficient-*` 原因；或数据集满足下限、计划执行数超过策略上限时的 `rejected`、`execution-budget-insufficient`。回执中的执行次数、token、耗时、工具调用和估算费用必须全部为零；逐题结果始终不可用。

冻结 cohort 新增 `preflight-rejected` 槽位及 v4 摘要。已签名预检回执按槽位核对和去重，计划测试观察全部计为未解析，`preflightRejectedCount` 单列且阻断晋级。它与第 212 批 `receipt-unavailable` 不同：前者有可验签的最终拒绝回执，后者没有回执。第 213 批用量接口因此能把前者计入已签名回执数并记录零用量，同时继续单列真正无回执的槽位。

## 验证与剩余边界

[Eval Gate 集成测试](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js)使用真实测试签名链覆盖数据集数量不足和执行预算不足两种预检拒绝；验证冻结 cohort 的未解析分母、清单绑定、已签名零用量回读和篡改拒绝。既有预算中断 API 仍拒绝将零执行预检误归为执行后预算中断。

Eval Gate 与 PM benchmark 两个完整测试文件分别 **182 项、80 项通过**；变更范围的 ESLint、Prettier 和 `git diff --check` 通过。本批未运行目标环境 PM E2E、真实模型对照或远端 CI。

签名预检拒绝证明 Eval Gate 已处理该请求并作出零执行决定，不证明 Actor 执行、所有实际启动均被登记，也不认证准备阶段调用或总成本。`cohortCompletenessAuthenticated`、`reportAuthenticated`、`qualifiesForPromotion` 继续为 false；签名启动日志、完整成本、目标环境真实 PM 对照及 Pilot 仍待完成，G08 保持“部分完成（待实测）”。
