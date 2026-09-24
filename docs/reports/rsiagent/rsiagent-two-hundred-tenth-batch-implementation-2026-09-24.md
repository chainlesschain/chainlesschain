# RSIAgent 第二百一十次工程实施：冻结槽位清单与登记结果绑定

> 日期：2026-09-24（Asia/Shanghai）<br>
> 对应差距：G08；承接第 209 批登记槽位汇总。<br>
> 状态：可冻结计划内预期槽位并与已认证的登记结果精确绑定；槽位签发时间、全部启动覆盖和完整效果结论仍未认证。

## 实施内容

新增 `buildPmExplorationEffectSlotManifest` 和 `verifyPmExplorationEffectSlotManifest`：在 v2 冻结计划下记录 cohort ID、1–32 个互异槽位 ID 和每组计划测试观察数，生成可复算的 `manifestDigest`。可信宿主须在收集运行证据前独立保存清单和摘要；本接口只校验内容一致性，不证明它实际何时生成、由谁签发或是否耐久保存。历史 v1 计划不能生成新清单。

新增 `buildPmExplorationEffectManifestBoundCohort` 和对应回读 API。它先按第 209 批规则重新认证每个登记槽位的完整逐题报告或签名预算中断记录，再要求登记槽位的**数量、顺序和 ID**与独立保存的清单一致，并核对 cohort ID、计划摘要、每组计划分母及调用者保存的清单摘要。缩减已冻结槽位、替换计划、篡改清单或替换汇总均拒绝。结果明确保留 `slotScheduleAuthenticated: false`、`cohortCompletenessAuthenticated: false`、`reportAuthenticated: false` 和 `qualifiesForPromotion: false`。

离线 `pm-exploration-effect.mjs` 新增 `slots` 与 `verify-slots` 模式。前者以 `--plan plan.json --plan-digest sha256:... --slots slot-input.json` 生成清单，槽位输入为 `{ "cohortId": "...", "slotIds": ["..."] }`；后者以 `--plan plan.json --plan-digest sha256:... --manifest slot-manifest.json` 回读。两者都要求调用者提供事前保存的计划摘要；工具只读本地文件、向 stdout 输出 JSON，不签名也不启动 Eval Gate。

## 验证与剩余边界

[签名评测集成测试](../../../packages/cli/__tests__/unit/evolution-eval-gate.test.js)覆盖完整运行加预算中断运行的两槽绑定、重新回读、缩减槽位、篡改清单及错误摘要；[离线工作流测试](../../../packages/cli/__tests__/unit/pm-exploration-benchmark.test.js)使用真实 UTF-8 文件覆盖生成、回读、输入不变、重复槽位、嵌入替代计划、替换冻结计划、篡改清单、错误计划摘要和 v1 拒绝。

相关回归为 **6 个测试文件、309 项通过、1 项跳过**；变更范围的 ESLint、Prettier 和 `git diff --check` 通过。

本批并未接入可签名且耐久的 Eval Gate 启动事件，因此无法证明清单覆盖**全部实际启动**，也无法纳入没有最终签名回执的异常失败。没有完成准备阶段全部成本认证、目标环境配置生效核验、真实 PM baseline/candidate 对照或 Pilot。G08 继续为“部分完成（待实测）”，G01–G08 完整关闭数量仍为 0。
