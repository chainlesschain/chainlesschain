# RSIAgent 第二百零四次工程实施：Eval Gate 逐题证据导出与签名回执复算

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 202–203 批的完成率报告与离线操作入口。<br>
> 状态：已提供由现有 Eval Gate 最终签名回执绑定的逐题证据出口和验证 API；尚未完成真实 PM 对照实验或生产验收。

## 1. 问题与结果

原 Eval Gate 在宿主内收集逐题执行、grader、安全检查结果，并将每组结果数组的 `resultDigest` 纳入最终签名回执；返回调用方的只有汇总回执。G08 需要逐题数据来做严格完成率和任务族群 bootstrap，但缺少这些摘要对应的原始数据出口，无法直接复算已有签名承诺。

本批在 [Eval Gate](../../../packages/cli/src/lib/evolution/evolution-eval-gate.js) 增加显式的 `runEvolutionEvalGateWithEvidence` 和只读 `verifyEvolutionEvalResultEvidence`。新出口返回现有回执及其逐题证据，验证器重算结果摘要和全部比较指标，再通过原有品牌化 receipt verifier 核验签名、信任配置、独立预期上下文与有效期。没有增加新的签名 authority，也没有改变现有回执 schema 或决定规则。

## 2. 导出边界

`runEvolutionEvalGate` / `gate.run()` 继续只返回原始回执。可信评测宿主明确调用新入口时才会取得：

```javascript
const { receipt, resultEvidence } = await runEvolutionEvalGateWithEvidence(
  trustedGate,
  registeredRequest,
);
```

完整执行后的 `resultEvidence` 使用 `chainlesschain.evolution-eval-result-evidence/v1`，包含最终 `receiptDigest`、validation/test 两个分区各自的 baseline/candidate 数组、证据摘要，以及固定的 `qualifiesForPromotion: false`。

每行保留现有评测内部记录的字段：

- task digest、seed、PASS、quality score 与安全/权限违规数；
- output artifact、subject binding/reservation、execution、grade、safety 的摘要引用；
- tokens、latency、tool calls、cost、errors 五项执行指标。

数组保留运行时顺序，以精确复现已有签名回执中的结果摘要。导出不包含任务提示、私有答案、输出正文、grader detail 或可执行的 opaque handle/capability；但是任务/seed 关联和评分仍属于评测侧信息，必须保存在可信 evaluator 范围，不得回注 Actor/Curriculum 或已冻结候选。

数据只在 validation 与 test 全部执行完毕、最终回执签名并通过验证后返回。没有逐题观察回调，也不在 gate 实例中维护额外的跨运行结果缓存。导出后再次核对运行 deadline、回执有效期和各端口回执有效期，越界不返回证据。

导出和回读共用既有的 1 MiB 规范 JSON 上限；导出时也把 `evidenceDigest` 字段计入大小检查，避免产生只能写出、无法按同一边界回读的证据文件。更大的结果集仍需后续分片归档方案。

完整执行但被安全门或效果门拒绝的比较也会导出原结果，不能只保存成功评测。任务不足、执行预算不足或总用量耗尽时，保留现有签名失败/证据不足回执，并返回 `resultEvidence: null`；grader 崩溃或签名失败继续抛错。这些情形不补造完整逐题数据。

## 3. 回读与认证

可信宿主保存回执与逐题 JSON 后，可重新读取并验证：

```javascript
const verifiedRows = await verifyEvolutionEvalResultEvidence(
  trustedReceiptVerifier,
  { receipt, resultEvidence, suite: privateSuite, policy: frozenPolicy },
  registeredExpectedContext,
);
```

`registeredExpectedContext` 须来自可信运行宿主保存的上下文，不能从待验证文件自行构造。私有 suite 保持由评测侧管理；验证器没有将其投影给执行侧。

验证依次检查：

1. 使用既有有界规范数据校验，快照 receipt、逐题证据、suite、policy 和 expected；拒绝 Proxy、accessor、非法字段与超限数据，所有快照在第一次异步调用前完成。
2. suite/policy 自身摘要与回执绑定一致，分区任务数量、confidence Z、最终回执摘要和证据 schema 一致。
3. 两个分区的每组结果精确覆盖冻结任务 × seed；不接受缺题、重复、跨分区任务或未登记 seed。
4. 从原始行重算每组 result digest、通过率、得分、成本、违规计数，以及比较区间和派生指标，与最终回执逐项形成的规范比较摘要相等。
5. 重算逐题证据自身摘要，再调用既有 `EvolutionEvalReceiptVerifier` 校验最终签名、issuer/key/trust policy、独立预期上下文和有效期。异步验签期间修改调用方对象不影响此次结果。

修改结果后重新计算证据自身摘要无法绕过第 4–5 步；把另一轮的真实签名回执接到当前行上也会被拒绝。成功返回的逐题证据为不可变快照。

认证含义是“这些行与受信 Eval Gate 已签名的汇总承诺一致”。它不逐项重新获取 execution/grader/safety 原始回执，也不证明外部存储已耐久保留这些回执。

## 4. 验证

[回归测试](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js) 新增真实评测宿主路径及 JSON 文件重开测试。它执行完整的 240 次测试执行单元，验证每个分区/arm 的 20 个任务 × 3 个 seed，覆盖逐题摘要与指标篡改、数组顺序、arm 互换、缺题、重复、跨分区任务、错误 seed、回执替换、错误 policy、伪造签名、过期回执、错误 expected context、异步对象修改、accessor/Proxy 及额外字段。

另验证不完整运行没有虚构结果、完整安全拒绝保留原始违规行、其他运行的签名回执不能重放，以及 grader 崩溃不返回证据。测试使用隔离的合成任务和测试签名 authority，不是目标环境真实 PM 收益实测。

```powershell
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/evolution-eval-gate.test.js __tests__/unit/skill-target-matrix-eval.test.js __tests__/unit/pm-exploration-benchmark.test.js __tests__/unit/pm-exploration-business-grader.test.js __tests__/unit/pm-result-grader.test.js
```

最终回归：**5 个测试文件、275 项通过、1 项跳过**。在补入跨运行回执重放断言后，新增证据出口范围另行复跑，**22 项全部通过**；其余 129 项因本次测试名称筛选未执行，已由前述完整回归覆盖。相关代码 ESLint 无错误或警告；变更代码及本批记录的 Prettier 检查、`git diff --check` 通过。

## 5. 未完成边界

本批没有将旧 Eval Gate 的 `pass` 或既有决定自动解释成 G08 v2 的严格完整成功率，也没有修改其评测阈值。将已认证逐题行投影到 PM effect runs，仍需精确核对 PM task ID、effect plan/evaluation context、baseline/candidate 版本和各类配置绑定，并保留 v2 的完整成功条件。

准备、探索、规划、提炼、重试、重置等成本不由此逐题执行出口认证；原始 provider settlement 和各阶段成本还需独立回读及绑定。不完整评测的失败分母、耐久归档、目标环境签名部署、真实 PM 对照、Pilot、人工审核和回滚也没有据此完成。离线 effect CLI 继续只做一致性复算，不会因本 API 存在而自动具备外部证据认证。

G08 仍为“部分完成（待实测）”；G01–G08 完整关闭数量仍为 0。
