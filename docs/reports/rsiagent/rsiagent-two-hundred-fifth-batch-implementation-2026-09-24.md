# RSIAgent 第二百零五次工程实施：签名逐题证据接入 PM 完成率报告

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 204 批的 Eval Gate 逐题证据导出。<br>
> 状态：已实现签名逐题证据到 PM v2 报告的投影与认证回读；准备成本认证、真实 PM 对照和 Pilot 仍待完成。

## 1. 问题与结果

第 204 批提供了可按最终签名回执复算的逐题数组，但生成 PM effect report 仍需调用方手工配对 task、seed、arm 和指标。直接复制旧 Eval Gate 的 `pass` 会把部分得分误计为严格完成；只投影 test 数组还可能漏掉同一次评测中 validation 的执行成本和安全违规。

本批在 [PM benchmark](../../../packages/cli/src/lib/evolution/pm-exploration-benchmark.js) 增加 `buildPmExplorationEffectEvidenceReport` 与 `verifyPmExplorationEffectEvidenceReport`。它们复用品牌化 Eval Gate receipt verifier，核对冻结计划、suite/policy、环境、版本和运行上下文，再将已认证测试行投影到原有 v2 统计器。validation 用量另行汇总，参与每个 seed、每组的已知总预算检查。

新报告使用 `chainlesschain.pm-exploration-effect-evidence-report/v1` 外层格式，内部保留原有 v2 `report`。原离线构造器、CLI 和历史回读行为不变。

## 2. 计划与运行绑定

宿主调用方式：

```javascript
const evidenceReport = await buildPmExplorationEffectEvidenceReport(
  trustedReceiptVerifier,
  { plan, suite, policy, receipt, resultEvidence, phaseUsage },
  {
    planDigest: registeredPlanDigest,
    targetMatrixRoot: registeredTargetMatrixRoot,
    cellId: registeredCellId,
    runtimeId: registeredRuntimeId,
    receiptContext: registeredReceiptContext,
  },
);
```

第三个参数须来自可信宿主独立保存的实验/运行记录。不能从待校验文件自行生成预期值，也不能由普通调用方构造 verifier 代替可信组合根。

构造器会：

1. 对所有输入和预期上下文做 plain-data 检查与不可变快照；在异步验签前固定所有数据。
2. 只接受与事前保存摘要一致的 v2 计划，从实际 PM suite/policy 重建该计划，核对测试任务、分组和 seed；仅对伪造分组重新计算摘要不能通过。
3. 将 suite、policy、environment 及 baseline/candidate artifact digest 与预期回执上下文逐项核对。
4. 按既有 `computeEvolutionEvalContextDigest`，以 effect plan digest、tenant、目标环境、authority root、target matrix、cell 和 runtime 重算评测上下文，并要求与回执预期绑定一致。
5. 调用第 204 批验证器，认证最终签名回执及完整逐题证据；完成投影、bootstrap 和外层摘要后，再次检查回执签名与有效期，避免报告计算期间回执过期仍返回认证结果。

Actor/模型/工具/权限/reset 等配置摘要由 effect plan digest 一并承诺。该绑定证明评测回执引用了这份计划，不能单独替代运行宿主对实际配置生效情况的认证。

## 3. 逐题映射与完成率

投影只使用冻结 suite 的 test 任务，以 `taskDigest + seed + arm` 精确查找已认证行，再恢复 PM task ID。不接受调用方提供额外评分或任务映射。按 seed 生成的 run ID 是从源回执摘要确定性派生的统计分组标识，不代表额外执行了一次评测；原始 Eval run ID、最终回执摘要和逐题证据摘要保留在外层报告中。

- `score` 来自 `qualityScore`；只有源 `pass: true`、分数恰为 1、无安全/权限违规时才计为完整 PASS。
- 权限违规记录为 `permission`；安全违规或未通过且存在执行错误计数时记录为 `unknown`，不猜测 provider/tool 等具体故障来源。
- 其他未完成结果按原 v2 规则计为 `incomplete`，部分得分保持原值。
- 原始执行错误计数另外保留为 `testExecutionErrors`。执行过程出现错误不必然表示最终业务结果失败；已通过独立 grader 的完整结果不会仅因该计数非零而被改写成失败。
- outcome、grader 和非零 usage 的引用分别来自签名行的 execution/grade digest。这里的 usage 引用指向指标来源的执行回执，不伪造独立 provider settlement。
- `tokens`、`toolCalls`、`costMicrounits` 保持原值，`latencyMs` 映射为 v2 的 `wallClockMs`。这是按记录时长累加的口径，不证明宿主端到端墙钟耗时或未记录开销。

私有答案、任务提示和输出正文不会进入效果报告。不完整或缺少逐题证据的评测不会在此被补造成完整运行。

## 4. 成本及认证边界

`phaseUsage` 必须完整覆盖冻结 seed；每项精确包含：

```javascript
{
  seed,
  baseline: [/* 每个冻结 cost phase 的 { phase, usage } */],
  candidate: [/* 相同 phase 顺序 */],
}
```

usage 沿用 v2 的 receipt digest、tokens、toolCalls、wallClockMs、costMicrounits 合同。缺 seed、重复 seed、缺阶段或额外自报认证字段均拒绝；不默认为零。按规范顺序计算的 `phaseUsageDigest` 进入外层摘要。

`phaseUsage` 应只申报未包含在源 validation/test 执行行中的成本，避免重复归属；当前摘要格式检查不能证明各成本来源互不重叠，这仍须阶段成本认证解决。

成本分为三个可审阅部分：

| 字段                    | 内容                                                                   |
| ----------------------- | ---------------------------------------------------------------------- |
| `report` 中的 arm usage | test 执行用量 + 调用方申报的准备阶段用量，保持 v2 原始口径             |
| `validationUsage`       | 从同一份已认证证据按 seed/arm 汇总的 validation 执行用量               |
| `knownUsage`            | 上述两部分之和，包含已认证执行用量和未认证准备申报，不代表完整实际账单 |
| `knownBudgetViolations` | 将 validation、test 和准备申报一起与每个 arm/seed 的冻结上限比较       |

准备阶段的摘要引用尚未通过独立 authority 回读，因此外层始终明确：

```javascript
{
  executionEvidenceAuthenticated: true,
  preparationEvidenceAuthenticated: false,
  reportAuthenticated: false,
  requiresIndependentPilotApproval: true,
  qualifiesForPromotion: false,
}
```

外层 `evidenceDecision` 不会返回 `threshold-met`。只要原 Eval Gate 未接受、统计未达标、任一组 validation 有安全/权限违规或已知总预算超限，就明确返回 `threshold-not-met`；其余情况仍为 `insufficient-evidence`，并包含 `preparation-costs-unverified` 原因。

因此内部 v2 统计即使达标，也不能替代外层证据判定。干净的 test 结果不能掩盖 validation 违规，准备成本缺少认证也不能被局部签名证据掩盖。

## 5. 持久化回读接口

```javascript
const verifiedReport = await verifyPmExplorationEffectEvidenceReport(
  trustedReceiptVerifier,
  {
    source: { plan, suite, policy, receipt, resultEvidence, phaseUsage },
    report: reopenedEvidenceReport,
  },
  registeredContext,
);
```

回读会重新认证源证据、投影、统计并核对整个外层报告。修改准备成本、内层统计、外层认证标志或摘要均不能仅靠原效果报告自身摘要通过。输入源和报告的本地文件写入、耐久归档与读取权限仍由可信宿主负责；该 API 不自行保存文件。

## 6. 验证

[集成回归](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js) 新增 PM suite：30 个 training、20 个 validation、20 个 test 任务，3 个 seed。测试实际经过现有 Gate 的 240 个执行单元、测试 authority 签名、证据导出、认证投影和 v2 报告复算。

23 项新增检查覆盖：源 PASS 但部分得分不计完整成功、精确 task/seed 归因、执行错误与终态区分、validation 成本使原本未超预算的 test 报告超限、两组 validation 安全违规、原 Gate 拒绝传播、合法计划替换、伪造分组重哈希、版本/环境/suite/policy/target matrix/cell/runtime 错绑、准备阶段缺项、伪造 verifier、签名行篡改、无完整证据、异步修改、accessor、报告标志/准备成本篡改，以及投影前后有效期检查。

这些任务、评分和签名 authority 均为隔离测试数据，并非真实 PM provider 或生产独立 grader 效果实测。

```powershell
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/evolution-eval-gate.test.js __tests__/unit/skill-target-matrix-eval.test.js __tests__/unit/pm-exploration-benchmark.test.js __tests__/unit/pm-exploration-business-grader.test.js __tests__/unit/pm-result-grader.test.js
```

最终回归：**5 个测试文件、298 项通过、1 项跳过**。新增 23 项认证投影检查全部通过，并覆盖既有 Eval Gate、target matrix、PM benchmark、业务 grader 与产物 grader 回归。变更代码 ESLint 无错误或警告；变更代码和本批记录的 Prettier 检查、`git diff --check` 通过。

## 7. 剩余工作

下一步需认证探索、课程规划、记忆提炼、重试、重置等阶段成本的原始回执与 provider settlement，明确是否还存在 grader/验证和宿主开销，并完成按冻结计划的完整成本归属。还需处理不完整运行的认证失败分母、耐久归档、目标环境实际配置与真实 PM baseline/candidate 对照。

本批没有运行真实模型或 Electron PM E2E，没有创建生产 authority，也没有签发 Pilot 或晋级许可。第 203 批 CLI 仍是离线一致性工具；新能力由可信宿主 API 使用。G08 继续为“部分完成（待实测）”，G01–G08 完整关闭数量仍为 0。
