# RSIAgent 第二百零二次工程实施：严格完成率与任务族群配对评测

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；依据主报告 7.3、8.2.1、9.2 的完成率及实验报告要求。<br>
> 基线：`c309bfa77e`；本批修改见当前工作树。<br>
> 状态：已实现离线评测合同 v2；真实结构化 PM baseline/candidate 对照、签名 Eval Gate、Pilot 和生产验收仍待完成。

## 1. 问题与结果

原 [PM benchmark](../../../packages/cli/src/lib/evolution/pm-exploration-benchmark.js) 的 effect report v1 根据部分得分的增益区间判定 `threshold-met`，并将全部 task × seed 的观测直接用于 bootstrap。即使两组都没有完整完成任务，部分分提高仍可能达标；同任务的重复 seed 也会被当作独立抽样单位。这与主报告要求的完整成功率、任务族群不确定性不一致。

本批让新计划和报告使用 v2，将严格完整成功率作为主指标，保留部分分作为辅助指标。历史 v1 的评分与摘要语义保持不变，不能自动变成 v2 完成率证据。

## 2. 预注册与抽样合同

`buildPmExplorationEffectPlan` 保留原有 suite/policy、baseline/candidate artifact、模型、工具、权限、环境、reset、seed 和等预算绑定，并作以下调整：

- 新输入用 `minimumPassRateDelta` 替代 `minimumScoreDelta`；
- 必须指定 `minimumIndependentGroups`，范围为 2–10,000；这个技术下限不代表两个组足以支持生产效果结论；
- `taskGroups` 从验证过的 suite 自动投影，绑定 test task ID 及 template/project/principal/time-window 四类 key，不接受结果阶段自报分组；
- `primaryMetric` 固定为 `strict-completion-rate`，`resamplingUnit` 固定为 `task-group-component`；这些字段全部参与计划摘要。

报告先对每个任务的全部 seed 汇总两组成功率与得分，再将任意共享 key 的任务合并为一个组，包含 A 与 B 共享模板、B 与 C 共享项目的传递关联。1,000 次 bootstrap 每次有放回抽取同样数量的完整组，组内任务和 seed 始终一起保留；每次结果按抽中任务数量加权，维持任务等权的估计目标。

抽样随机序列由冻结的任务分组派生。因此，增加结果完全相同的 seed 重复不会凭空增加独立组数，也不会通过改变随机序列缩窄区间。报告同时给出 `pairedObservationCount`、`independentGroupCount`、逐任务指标、`pairedPassRateDelta` 和辅助 `pairedScoreDelta`。

## 3. 完整成功、失败和硬门

v2 的 `passed: true` 必须同时满足：得分为 1、`failureClass: none`、安全和权限违规均为 0；否则拒绝该矛盾输入。仅部分得分变好且完整成功率没有提高时，不能达标。

每个 seed 仍须完整覆盖冻结的任务集，缺行、重复 task/seed/runId 或缺少成本阶段均拒绝。新增 `setup`、`timeout`、`cancelled` 失败类别，保留原有 `grader` 等分类；全部失败保留在两组相同分母中，已花费的执行及准备成本照常累加。报告分别提供 `failureCount` 和 `failureCounts`，无显式失败但未完成的结果计为 `incomplete`。

没有取得 grader 回执的失败可以使用 `graderReceiptDigest: null`，但必须零分、未通过、有明确失败类别且仍提供 outcome evidence digest；成功和非零部分分继续要求 grader digest。此规则不允许缺失运行记录，也不允许补造 grader 成功。

v2 判定顺序：

1. 任一组存在安全/权限违规或任一 arm/seed 超预算，返回 `threshold-not-met`；
2. 独立组数低于计划门槛，返回 `insufficient-evidence`；只有一个组时，组间 `bootstrap95Ci` 为 `null`；
3. 其余情况仅在平均完成率增益大于 0，且其 95% 区间下界达到预注册门槛时返回 `threshold-met`。

用量和违规数累加超过安全整数范围时拒绝计算，避免不精确总额进入预算判断。所有版本继续固定 `requiresIndependentPilotApproval: true`、`qualifiesForPromotion: false`。

## 4. 历史兼容

`verifyPmExplorationEffectPlan` / `verifyPmExplorationEffectReport` 根据 schema 精确回读 v1 与 v2，拒绝混用计划和报告版本。v1 保留原字段、score bootstrap、判定和摘要，不进行隐式迁移。

[历史 fixture](../../../packages/cli/__tests__/fixtures/pm-exploration-effect-v1.json) 在修改前由原实现生成。回归使用其完整 plan/report 验证原摘要不变。新的计划构造器只生成 v2；调用方必须明确给出完成率和独立组数门槛，不能把旧 score 门槛自动解释成完成率门槛。

## 5. 验证

[回归测试](../../../packages/cli/__tests__/unit/pm-exploration-benchmark.test.js) 覆盖完整成功与部分分的区别、矛盾成功、无 grader 的失败分母、成本保留、baseline 污染、单组和组数不足、传递分组、不等大小组的任务权重、身份/时间窗口关联、重复 seed 不制造独立样本、输入次序、重复 runId、数组 accessor、用量溢出、主指标与分组篡改，以及 v1 原摘要回读。

验证命令（从 `packages/cli` 执行）：

```powershell
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/pm-exploration-benchmark.test.js __tests__/unit/pm-result-grader.test.js __tests__/unit/pm-exploration-business-grader.test.js __tests__/unit/evolution-eval-gate.test.js
```

最终回归：**4 个测试文件、229 项测试全部通过**，包含 benchmark、业务 grader、产物 grader 和 Eval Gate。变更代码的 ESLint 检查无错误；变更代码、历史 fixture 和本批记录的 Prettier 检查通过，`git diff --check` 通过。

## 6. 验收边界与下一步

本模块对传入结果作一致性校验和统计复算；digest 引用本身不能证明外部回执真实、独立或耐久。受治理 runner、独立 grader、usage settlement、签名 Eval Gate 和 Pilot 仍须认证其原始证据与绑定关系。

本批未运行真实模型、Electron PM E2E 或生产对照实验。新增 fixture 和合成测试仅证明统计合同及兼容性，不构成完成率提升实测。G08 继续为“部分完成（待实测）”，G01–G08 完整关闭数量仍为 0。

下一步按主报告 8.2.1 冻结真实任务、独立分组、至少三个 seed 和等预算计划，从目标受治理环境取得完整逐题证据后生成 v2 报告。样本量与独立组数门槛必须在看结果之前确定；不能通过事后拆分组或增加相同任务的重复次数跨过门槛。
