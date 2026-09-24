# RSIAgent 第二百零七次工程实施：PM 签名报告与准备结算联合回读

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 205 批签名逐题报告与第 206 批 Provider 结算证据。<br>
> 状态：已建立两类证据的同计划、同阶段申报绑定及联合回读；完整准备成本、真实 PM 对照和 Pilot 仍待完成。

## 实施内容

第 206 批的结算证据可独立认证已登记 Provider 调用的 token 与估算费用，但此前没有单一接口核对它与第 205 批签名评测报告是否使用同一份冻结计划和阶段申报。[PM benchmark](../../../packages/cli/src/lib/evolution/pm-exploration-benchmark.js) 新增 `buildPmExplorationEffectProviderEvidenceBundle` 和 `verifyPmExplorationEffectProviderEvidenceBundle`，接受两份原始证据、两份已保存结果、各自独立登记的预期上下文，以及真正的 Provider settlement adapter。

联合构造先固定全部输入，再比较计划和阶段申报，分别重新认证签名 Eval Gate 逐题报告和耐久 Provider 结算，且在异步评测回读结束后再次精确回读结算副本。两份结果的 `planDigest` 和 `phaseUsageDigest` 必须一致。输出摘要绑定效果报告摘要、准备结算证据摘要、阶段申报摘要及已认证的 Provider 阶段小计；回读时完整重算联合结果，不能仅依赖保存的联合摘要或自报认证标志。

联合结果仅表示**已登记调用**的 Provider token/估算费用可与该份评测报告对齐。它保留原报告的 `evidenceDecision` 和阻断原因，并固定 `preparationEvidenceAuthenticated: false`、`reportAuthenticated: false`、`qualifiesForPromotion: false`。调用清单是否完整、零调用、工具次数、阶段耗时、其他费用及跨阶段成本互斥均未由此次绑定证明。

## 验证与边界

[集成回归](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js) 在现有 240 次隔离评测及测试签名回执上，加入本地模拟 Volcengine 调用、结算 artifact、耐久 replica 和重新打开后的联合回读。正例证明签名报告与结算的摘要关联；负例覆盖阶段申报错位、联合认证标志篡改和副本替换。另有第 206 批的请求归属、少报与伪造持久化负例。

相关回归为 **6 个测试文件、304 项通过、1 项跳过**；ESLint、Prettier 与 `git diff --check` 通过。最后一次代码调整仅增加联合回读末尾的签名回执有效期复核，随后对应集成测试再次通过。

这仍是隔离测试 authority 与模拟 Provider 响应，不能代表生产签名部署、真实 PM baseline/candidate 采样或 Pilot 验收。完整阶段成本认证、失败运行分母、实际配置生效、耐久归档和目标环境验收仍需后续实施。G08 继续为“部分完成（待实测）”，G01–G08 完整关闭数量仍为 0。
