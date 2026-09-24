# RSIAgent 第二百零六次工程实施：准备阶段 Provider 结算逐请求归属

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 205 批的 PM 效果报告。<br>
> 状态：已增加可耐久回读的准备阶段 provider token 与估算费用证据；完整准备成本、整份效果报告和真实 PM 对照仍未认证。

## 问题与实现

第 205 批 `phaseUsage` 能检查每个 seed/arm 的探索、课程规划、记忆提炼、失败重试和环境重置申报，并将其计入预算，但申报中的摘要并不证明成本来自哪次真实调用。本批在 [PM benchmark](../../../packages/cli/src/lib/evolution/pm-exploration-benchmark.js) 增加 `buildPmExplorationPreparationProviderEvidence` 与 `verifyPmExplorationPreparationProviderEvidence`，利用现有 [Provider settlement adapter](../../../packages/cli/src/lib/evolution/pm-exploration-provider-settlement-adapter.js) 对已登记请求的无密结算做耐久精确回读。

宿主提供三部分：冻结的 v2 plan 与完整 `phaseUsage`、包含 `seed/arm/phase/settlement/persistence` 的逐请求结算、独立登记的 `planDigest/descriptorDigest/requests`。每项预登记请求须绑定 seed、arm、阶段、operation ID、原始 execution request digest 与 provider request digest；不能从待核验结算自身反向生成预期值。适配器必须是真实 `PmExplorationProviderSettlementAdapter` 实例。函数重新验证计划、阶段申报与注册覆盖，拒绝重复 execution request、错位归属、缺漏注册、伪造持久化回执或耐久副本替换；结算的 token 与费用再按 seed/arm/phase 汇总，不能高于该阶段的申报值。

输出记录每次结算摘要、耐久 artifact 摘要、token、估算 USD，以及每阶段的 token 和向上取整的微美元费用上界；报告摘要同时绑定计划、请求登记和阶段申报。`verify` 会重新访问耐久副本并与保存的证据逐字段比较。该接口只认证**已登记且已回读的 provider 调用**的 token 和估算费用，不证明登记涵盖全部调用，也不从结算推导工具调用、阶段墙钟时间或零成本。申报的其他来源和执行结果之间是否重叠，仍需宿主原始执行回执认证。因此输出明确保持 `preparationEvidenceAuthenticated: false` 和 `reportAuthenticated: false`，第 205 批效果报告的外层判定也不因此提升。

## 验证与剩余边界

测试以隔离的模拟 Volcengine 响应实际走预算执行器、结算适配器、artifact 写入与耐久 replica retain/resolve；重开适配器后再次核验。负例包括阶段错配、请求摘要替换、重复登记、token/费用少报、伪造非耐久回执、假适配器、证据篡改和耐久副本替换。该测试 provider 和 replica authority 为本地合成环境，不是目标 PM 生产部署或真实费用账单。

仍需对每个阶段的原始调用清单和无调用证明建立完整性认证，核对工具调用、墙钟耗时、其他服务费用、宿主开销及 validation/test 成本互斥；还需处理不完整运行的分母、实际配置生效、耐久归档、真实 baseline/candidate 对照和 Pilot 审批。G08 维持“部分完成（待实测）”，G01–G08 完整关闭数量仍为 0。
