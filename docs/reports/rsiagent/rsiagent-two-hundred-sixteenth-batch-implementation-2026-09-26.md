# RSIAgent 第二百一十六次工程实施：事前 cohort 登记与准入库存封存

> 日期：2026-09-26（Asia/Shanghai）<br>
> 对应差距：G08；承接[第 215 批启动前签名准入](./rsiagent-two-hundred-fifteenth-batch-implementation-2026-09-25.md)。<br>
> 状态：可认证共享 Ledger stream 中的准入库存；G08 仍为部分完成（待实测）。

## 实施内容

[cohort 登记模块](../../../packages/cli/src/lib/evolution/evolution-eval-cohort-enrollment.js)要求可信宿主在该 stream 首条准入前，签名并耐久登记完整的 PM 效果计划、冻结槽位清单和与清单顺序一致的每槽矩阵绑定。每个槽位绑定评测计划、规范化请求、策略及评测 authority root 的摘要；缺槽、重排、重复或篡改的清单不能登记。同一 stream 的其他 cohort 也须在首条准入前完成登记，不能用旧版准入事件补造可信的 cohort 身份。

宿主只能从已登记槽位派生独立准入 authority。启动前复核登记证据和槽位绑定，拒绝未知槽位、请求或策略替换、跨 cohort 混用，以及封存后的再次准入。登记、准入和封存共享 Ledger 的 CAS head；并发写入冲突不会静默重试。签名登记与封存事件连同独立耐久 artifact 均需回读核验；已提交但应答丢失时可恢复审计结果，不能因此重新授权已占用槽位。

封存从实际 Ledger 事件全集重新核验准入，列出已准入与未准入槽位，并检查其他已登记 cohort 的事件，拒绝旧版或未登记准入、重复槽位、封存后准入和证据替换。返回的 `admissionInventoryAuthenticated` 为 `true`，但 `executionCoverageAuthenticated`、`cohortCompletenessAuthenticated` 和 `promotionAuthority` 仍为 `false`。

## 验证与剩余边界

[定向单元回归](../../../packages/cli/__tests__/unit/evolution-eval-cohort-enrollment.test.js) **19 项通过**，覆盖真实 Ed25519、文件 Ledger 与 artifact 回读、空库存和跨 cohort 事件、签名/存储篡改、准入与封存的 CAS 竞争、旧版准入、重复或未知槽位，以及提交成功但应答丢失后的恢复。本地测试只证明合同与负例；尚无目标环境断电耐久验收。

封存认证的是该 stream 的**准入库存**，不是 Actor 执行事实，也没有证明目标部署所有 Eval 启动入口都强制使用该门。还需把封存库存与每槽最终签名回执或明确缺证逐项对账，归集完整准备、重试、失败和真实 provider 成本，并完成等预算真实 PM baseline/candidate 对照、独立 grader、Pilot 与回滚验收。在这些证据齐备前，不能从本批推断 cohort 完整、真实任务效果提升或自动晋级资格。
