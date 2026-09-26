# RSIAgent 第二百一十八次工程实施：PM 分母与封存准入逐槽绑定

> 日期：2026-09-26（Asia/Shanghai）<br>
> 对应差距：G08；承接[第 217 批最终回执对账](./rsiagent-two-hundred-seventeenth-batch-implementation-2026-09-26.md)。<br>
> 状态：可将已认证的 PM 尝试分母绑定到签名封存准入；G08 仍为部分完成（待实测）。

## 实施内容

[PM 准入绑定接口](../../../packages/cli/src/lib/evolution/evolution-eval-cohort-receipt-reconciliation.js)重新验证既有 PM attempt cohort 的逐槽签名回执和未解析分母，并调用第 217 批对账器重新核验封存准入及已提交最终回执。它要求 PM 计划、cohort ID、槽位数量、顺序和每组计划测试观察分母与事前签名登记一致；已认证尝试必须与同槽准入的 `runId`、最终回执摘要匹配，未准入或有准入但无回执的槽位只能保留为 `receipt-unavailable`。两种缺证分别计数，均不能冒充已认证运行。

接口返回 PM 的 baseline/candidate 已认证观察与未解析观察，以及对应的封存摘要、回执对账摘要和 PM cohort 摘要；绑定摘要可复算，但本接口不把它写成独立耐久效果报告。`receiptSetCompletenessAuthenticated`、`executionCoverageAuthenticated`、`cohortCompletenessAuthenticated`、`reportAuthenticated` 和 `qualifiesForPromotion` 均保持 `false`。

## 验证与剩余边界

[Gate/PM 定向回归](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js)用真实签名零执行预检回执、文件 Ledger 和品牌化回执 verifier 构造三个冻结槽位：有签名回执、已准入但缺回执、未准入。结果将两类缺证分别计数，同时在每组 180 个计划测试观察的分母中保留全部未解析观察；隐藏已提交回执或重排 PM 登记槽位均拒绝。该定向用例 **1 项通过**。

该绑定只验证**提交给接口的** PM 证据与 Ledger 准入的对应关系；它无法证明最终回执来源全集、所有目标启动入口覆盖、Actor 确曾执行或完整准备与真实 provider 成本。真实等预算 PM baseline/candidate 对照、独立 grader、Pilot、人工审核和回滚仍须在目标环境留证，因此 G08 不关闭，automatic promotion 继续为 `HOLD`。
