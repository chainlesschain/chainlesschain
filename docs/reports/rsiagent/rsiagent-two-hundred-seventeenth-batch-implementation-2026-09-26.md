# RSIAgent 第二百一十七次工程实施：封存准入与签名最终回执逐槽对账

> 日期：2026-09-26（Asia/Shanghai）<br>
> 对应差距：G08；承接[第 216 批 cohort 登记与封存](./rsiagent-two-hundred-sixteenth-batch-implementation-2026-09-26.md)。<br>
> 状态：可核验**提交给对账器的**最终回执与封存准入的对应关系；G08 仍为部分完成（待实测）。

## 实施内容

[逐槽回执对账接口](../../../packages/cli/src/lib/evolution/evolution-eval-cohort-receipt-reconciliation.js)先回读签名登记与封存的 Ledger 准入库存，再要求输入按冻结清单顺序覆盖全部槽位。对有最终回执的槽位，它复算原始 Gate 启动请求摘要、矩阵计划与槽位身份，并核对准入的 `runId`、`runNonce`、租户、策略、评测 authority root 和完整 evaluation context；只有经品牌化 Eval 回执 verifier 验签、验上下文与有效期后才标记为 `signed-receipt`。未准入槽位列为 `unadmitted`；已准入但没有提交最终回执的槽位列为 `receipt-unavailable`，不能填造执行结果。

输入会在异步回读前捕获为有界的普通数据；未知、重排或遗漏槽位、未准入槽位上的回执、请求替换和外来运行回执均拒绝。所有签名回执验完后再次回读封存库存，拒绝审计期间变化的准入集合。结果记录各槽状态及签名回执摘要，但 `receiptSetCompletenessAuthenticated`、`executionCoverageAuthenticated`、`cohortCompletenessAuthenticated` 和 `promotionAuthority` 始终为 `false`。

## 验证与剩余边界

[Gate 定向回归](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js)使用真实 Gate、签名准入、文件 Ledger 和最终回执验签，覆盖有效对账、缺回执、外来回执、冻结请求替换及未准入槽位伪造回执。相关 launch admission 测试组 **5 项通过**；新增模块与测试的 ESLint、Prettier 和 `git diff --check` 通过。

对账器只能认证调用者**提交的**签名回执，无法从准入日志发现被隐瞒的最终回执，也没有证明目标部署的所有启动入口均受同一门禁管控。它不认证 Actor 执行、全部运行的最终状态、准备及失败成本或真实 PM/Pilot 效果；接口结果也不是独立耐久效果报告。关闭 G08 仍需目标环境的完整启动与回执来源清单、缺证分母、真实 provider 成本、等预算 PM 对照、Pilot 和回滚证据。
