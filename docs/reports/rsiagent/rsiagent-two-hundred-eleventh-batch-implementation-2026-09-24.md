# RSIAgent 第二百一十一次工程实施：执行后异常的签名未解析证据

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 210 批冻结槽位清单。<br>
> 状态：部分执行后的特定异常可取得最终签名拒绝回执并进入登记槽位分母；全部启动覆盖与完整效果报告仍未认证。

## 实施内容

Eval Gate 增加可信宿主显式调用的 `runEvolutionEvalGateWithFailureEvidence`。完成至少一次已计量执行后，若 executor、grader 或 safety 路径抛出 Gate 分类错误，且独立签名、验签、有效期和墙钟条件仍成立，它返回一个拒绝回执和 `resultEvidence: null`。回执保留 Gate 的执行总用量，并将异常类别标为 `runtime-execution-failed`、`runtime-grader-failed` 或 `runtime-safety-failed`。原有 `run` 和 `runWithEvidence` 仍按原合同抛错；本入口是**尽力签发**，零计量执行、超时、过期权威或签名失败继续抛错，不能补造回执。

PM 侧新增 `buildPmExplorationEffectRuntimeFailureEvidence` 及回读 API。它重新验证最终签名回执、冻结计划、实际 suite/policy、运行上下文和已计量执行数，把该运行每组计划测试观察全部标为未解析，保留已签名的汇总用量，不推断任何逐题通过、失败或分组成本。第 209 批登记汇总现可接收 `runtime-failed` 槽位；只要出现此类槽位，v2 cohort 明确记录数量、阻断晋级，并将其未解析观察计入冻结分母。没有此类槽位时仍输出原 v1 cohort 结构和摘要。第 210 批清单绑定照常核对槽位和分母。

## 验证与剩余边界

[Eval Gate 集成测试](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js)让真实测试签名链中的 grader 在执行后失败，验证原路径仍抛错、显式入口得到拒绝回执、PM 回读与完整运行合并后每组 120 个计划观察中有 60 个未解析；篡改用量或失败类别拒绝回读，冻结清单绑定结果继续保留未认证标志。首个执行没有取得签名计量而超时的负例仍抛错，不产生失败证据。

相关回归为 **6 个测试文件、311 项通过、1 项跳过**；变更范围的 ESLint、Prettier 与 `git diff --check` 通过。最后将运行异常捕获范围收窄到任务执行步骤后，Eval Gate 文件另行完整复跑通过。

这只能证明**已签发最终回执的登记异常运行**，不能说明每个实际启动都已登记或都会取得回执。签名时已到截止时间、权威失败、进程崩溃、系统断电和运行前异常仍没有可认证的最终事件；清单自身也没有独立签名的启动日志或耐久签发时间证明。`cohortCompletenessAuthenticated`、`reportAuthenticated`、`qualifiesForPromotion` 继续为 false。准备成本完整性、目标环境真实 PM 对照和 Pilot 仍待完成；G08 维持“部分完成（待实测）”。
