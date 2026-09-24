# RSIAgent 第二百零三次工程实施：G08 计划预检与离线报告命令

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 202 批的严格完成率与任务族群配对评测。<br>
> 状态：已实现可执行的离线计划/报告流程；外部回执认证、真实 PM 对照实验、签名 Eval Gate 和 Pilot 尚未完成。

## 1. 问题与结果

第 202 批已经提供 effect plan/report v2 的统计合同，但使用者仍需自行编写调用代码，且独立组数不足要等到提交完整结果后才会显现。报告构造器也无法知道调用者传入的计划摘要是否为实验前保存的版本。

本批新增 [命令行工具](../../../packages/cli/scripts/pm-exploration-effect.mjs)，支持计划生成、运行前分组检查、固定计划下的报告生成和已有报告复算。工具只读输入，将 JSON 写到标准输出；不加载 deployment、不执行任务、不调用模型，也不修改配置。

## 2. 运行前检查

[统计模块](../../../packages/cli/src/lib/evolution/pm-exploration-benchmark.js) 新增 `inspectPmExplorationEffectPlan`，只接受已通过摘要校验的 v2 计划。它与报告共用同一个传递分组实现，给出：

- 冻结的计划摘要、测试任务数和 seed 运行数；
- 计划配对观测数和两组总观测数；
- 实际独立组数、事前要求的组数及各组任务 ID；
- `group-count-satisfied` 或 `insufficient-independent-groups`。

共享 template/project/principal/time-window key 的关联仍会传递合并。增加同一任务的 seed 不会增加独立组数。检查结果明确固定 `runtimeVerified: false`、`evidenceAuthenticated: false`、`qualifiesForPromotion: false`；组数够用不代表统计功效充分、Eval Gate 数据集门槛通过或运行环境就绪。

## 3. 使用方法

以下命令从 `packages/cli` 执行。输入文件由数据集作者和受治理执行环境提供；本工具不生成虚构的任务结果或成功回执。

### 3.1 准备与冻结计划

`plan-input.json` 使用 `buildPmExplorationEffectPlan` 的输入格式：

| 字段                                               | 内容                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `experimentId`                                     | 实验标识                                                                          |
| `suite`                                            | `buildPmExplorationSuite` 生成的完整私有 suite，包含三类分区和真实来源分组        |
| `policy`                                           | `buildEvolutionEvalPolicy` 生成的规范 policy                                      |
| `baselineVersion`、`candidateVersion`              | 各自的 `id` 与冻结 `artifactDigest`                                               |
| `actorConfigDigest`、`modelConfigDigest`           | 固定执行与模型配置摘要                                                            |
| `toolPolicyDigest`、`permissionPolicyDigest`       | 固定工具与权限策略摘要                                                            |
| `environmentDigest`、`resetProtocolDigest`         | 固定环境与重置协议摘要                                                            |
| `seeds`                                            | 与 policy 完全一致的 3–32 个不同 seed                                             |
| `budgetPerArmPerSeed`                              | `maxTokens`、`maxToolCalls`、`maxWallClockMs`、`maxCostMicrounits` 四项正整数上限 |
| `minimumPassRateDelta`、`minimumIndependentGroups` | 在查看实验结果前确定的完成率增益及独立组数门槛                                    |

```powershell
node scripts/pm-exploration-effect.mjs plan --input plan-input.json
```

标准输出为规范 v2 计划，不包含私有答案或任务提示正文。需要保存时，Windows PowerShell 可先捕获输出并检查退出码，再按 UTF-8 写盘，避免默认重定向产生 UTF-16：

```powershell
$pmPlanJson = node scripts/pm-exploration-effect.mjs plan --input plan-input.json
if ($LASTEXITCODE -ne 0) { throw 'PM plan generation failed' }
$pmPlanJson | Set-Content -Encoding utf8 -LiteralPath plan.json
node scripts/pm-exploration-effect.mjs inspect --plan plan.json
```

确认任务来源、分组与预算后，在运行开始前把 `planDigest` 记录到独立的实验登记记录。后续命令显式传入该值；不能在看到结果后从修改过的计划重新取摘要代替原值。命令检查摘要相等本身不能证明登记时间或签名真实性。

### 3.2 收集与复算结果

`runs.json` 是 `buildPmExplorationEffectReport` 所需的数组。每个元素精确包含 `runId`、`seed`、`phases`、`cases`；`phases` 分别记录 baseline/candidate 的完整准备阶段成本，`cases` 分别记录同一任务的两组结果、失败类别、用量及 outcome/grader/usage 摘要。每个冻结 seed 都必须覆盖每个冻结测试任务。

```powershell
node scripts/pm-exploration-effect.mjs report --plan plan.json --plan-digest sha256:替换为事前登记的摘要 --runs runs.json
node scripts/pm-exploration-effect.mjs verify --plan plan.json --plan-digest sha256:替换为事前登记的摘要 --report report.json
```

`report` 输出规范报告，可另行保存为 `report.json`；`verify` 从报告内原始 runs 重算所有指标、判断和摘要。摘要核对在读取结果文件之前执行；内部有效但与事前登记不符的替换计划也会被拒绝。

缺任务、缺 seed、缺成本阶段或无效输入不生成报告，不能用删除记录来排除失败。已具备证据的 setup、timeout、grader、cancelled 等失败按 v2 原规则保留在分母与成本中。该命令不为缺失记录补造失败回执。

### 3.3 退出码与历史回读

| 退出码 | 含义                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| `0`    | 帮助/计划生成成功；预检组数满足；或 v2 报告达到离线统计门槛，具体含义由子命令决定 |
| `1`    | 参数、文件、数据结构或摘要绑定无效；不输出报告                                    |
| `2`    | 预检独立组不足、报告证据不足，或历史 v1 仅完成原语义回读                          |
| `3`    | 报告未达到离线统计门槛，包括安全/预算硬门失败                                     |

`verify` 支持 v1 原报告和原摘要，但即使旧 score 门槛达标也返回 `2`，并明确提示不能视为 v2 完成率证据。`report` 和 `inspect` 不接受旧计划。重复、额外或缺失的参数会被拒绝。

输入必须是普通 UTF-8 JSON 文件，每份上限为 16 MiB；兼容 UTF-8 BOM，拒绝损坏 UTF-8、目录和超限文件。读取长度有界，读取期间长度变化也会拒绝。错误输出不包含私有输入正文或本地文件路径。

## 4. 验证

[回归测试](../../../packages/cli/__tests__/unit/pm-exploration-benchmark.test.js) 新增实际文件与 Node 子进程流程，覆盖 UTF-8 BOM、含空格路径、完整 plan → inspect → report → verify、输入保持不变、任务提示/私有答案不进入计划、计划替换、缺任务、报告指标篡改、独立组不足、未达标退出码、v1 原摘要回读、参数歧义、损坏编码与超限文件。运行前检查另覆盖传递分组和与报告组数一致。

```powershell
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/pm-exploration-benchmark.test.js __tests__/unit/pm-result-grader.test.js __tests__/unit/pm-exploration-business-grader.test.js __tests__/unit/evolution-eval-gate.test.js
```

最终回归：**4 个测试文件、247 项测试全部通过**，包含本批新增的 18 项检查及第 202 批统计合同、两类 grader 和 Eval Gate 回归。相关代码 ESLint 无错误或警告；相关代码与本批记录的 Prettier 检查、`git diff --check` 通过。

## 5. 验收边界

本批使离线比较流程可直接操作，提前暴露样本分组问题，并防止误用不同计划生成报告；它没有认证外部 outcome/grader/usage 回执，没有证明计划登记早于结果，也没有取得真实 PM 收益。计划检查不能替代 suite/policy 及环境的完整独立准入。

仍需目标环境按第 8.2.1 节冻结真实任务，完成全部 baseline/candidate 重复采样和原始证据认证，再取得签名 Eval Gate、Pilot、人工审核与回滚证据。所有报告的 `qualifiesForPromotion` 继续为 `false`。G08 仍为“部分完成（待实测）”；G01–G08 完整关闭数量仍为 0。
