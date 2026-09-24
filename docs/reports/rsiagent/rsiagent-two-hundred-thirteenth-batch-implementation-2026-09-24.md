# RSIAgent 第二百一十三次工程实施：冻结 cohort 的签名执行用量小计

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 212 批无最终回执槽位的保守分母。<br>
> 状态：可汇总冻结 cohort 内已验签 Eval 最终回执的执行用量，并标明无回执槽位；总成本及真实效果仍未认证。

## 实施内容

新增 `buildPmExplorationEffectCohortUsageEvidence` 和对应回读 API。调用方提供第 210 批冻结槽位清单、第 209/212 批 cohort、清单绑定结果和独立保存的登记上下文。接口先重新认证清单绑定与逐槽最终回执，再将有回执槽位的 `executionCount`、token、耗时、工具调用数与估算费用相加；最后复验回执有效期。每个签名回执只允许对应一个登记槽位，原 cohort 的去重和计划分母检查继续生效。

结果单列 `signedReceiptCount`、`slotsWithoutSignedUsage` 和 `knownSignedUsage`，摘要绑定计划、清单、cohort 与绑定结果。无最终回执槽位不填零成本，也不推断按 arm、任务或阶段拆分的用量。即使全部槽位都有签名回执，结果仍明确将 provider 结算、准备阶段成本、总成本和整份效果报告标为未认证；签名 Eval `totalCostMicrounits` 是执行指标中的估算费用，不能冒充真实账单。

## 验证与剩余边界

[Eval Gate 集成测试](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js)覆盖完整签名运行加无回执槽位的签名用量小计，以及完整运行加预算中断运行的两份签名回执求和；回读拒绝汇总费用篡改和错误清单摘要。冻结清单和最终签名回执均被重新认证后，才会返回用量证据。

Eval Gate 与 PM benchmark 两个完整测试文件分别 **181 项、80 项通过**；变更范围的 ESLint、Prettier 和 `git diff --check` 通过。本批未运行目标环境 PM E2E、真实模型对照或远端 CI。

本批没有独立启动日志，无法证明清单覆盖全部实际运行；无回执槽位的实际费用和准备阶段全部调用仍未知。`cohortCompletenessAuthenticated`、`totalCostAuthenticated`、`reportAuthenticated` 与 `qualifiesForPromotion` 保持 false。目标环境真实 baseline/candidate 对照、Pilot、认证耐久归档及完整成本账目仍待完成；G08 保持“部分完成（待实测）”。
