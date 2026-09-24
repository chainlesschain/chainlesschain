# RSIAgent 第二百一十二次工程实施：无最终回执槽位的保守分母

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 210 批冻结槽位清单和第 211 批异常运行回执。<br>
> 状态：可在已登记槽位缺少最终签名回执时继续生成保守汇总；启动完整性、效果报告认证和真实 PM/Pilot 仍未完成。

## 实施内容

`buildPmExplorationEffectAttemptCohort` 现接受明确的 `receipt-unavailable` 槽位。该槽位的登记记录必须同时使用 `receiptDigest: null`、`context: null`，输入必须使用 `source: null`、`evidence: null`。汇总按冻结计划的任务与 seed 数，将两个 arm 的该槽位全部计划测试观察记为未解析；`authenticatedAttemptCount` 只统计有最终签名回执并通过回读的槽位。出现缺失回执时使用 v3 cohort 结构，显式记录 `missingReceiptCount`，并使 `unresolvedBlocksPromotion` 为 true、`allRegisteredOutcomesAvailable` 为 false、`evidenceDecision` 为 `threshold-not-met`。

旧 v1/v2 cohort 输出在没有缺失回执时保持原有结构。第 210 批清单绑定仍要求槽位 ID、顺序、计划和分母与独立保存的清单摘要一致；缺失槽位不能通过删除记录或收缩清单规避。回读会重新认证现有签名槽位、重算缺失数与分母，并拒绝在缺失槽位中混入来源或篡改认证运行数。

## 验证与剩余边界

[Eval Gate 集成测试](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js)覆盖一个完整签名运行加一个缺失回执槽位：每组 120 个计划观察中，60 个有认证结果、60 个未解析，认证运行数为 1；清单绑定保留全部未认证标志。另覆盖缺失槽位的来源替换、汇总篡改及省略槽位拒绝。

受影响的 Eval Gate 与 PM benchmark 两个完整测试文件分别 **181 项、80 项通过**；变更范围的 ESLint、Prettier 及 `git diff --check` 通过。本批未运行目标环境 PM E2E、真实模型对照或远端 CI。

此结构只表达**冻结清单中没有提交可验签最终回执**。它不能证明该槽位实际启动、没有取得回执、由谁启动，或实际耗用了多少 token、费用和时间；未签名用量不得填入认证成本。清单仍缺独立签名、耐久启动事件和签发时间证明，不能发现清单之外的实际启动。`slotScheduleAuthenticated`、`cohortCompletenessAuthenticated`、`reportAuthenticated`、`qualifiesForPromotion` 继续为 false。准备成本完整性、目标环境真实 baseline/candidate 对照和 Pilot 仍待完成；G08 保持“部分完成（待实测）”。
