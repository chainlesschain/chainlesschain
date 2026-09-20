# RSIAgent 第二十六次工程实施：旧学习来源证明与正式晋级控制面接线

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第二十五次工程实施：隔离 PM clone 恢复控制器合同](./rsiagent-twenty-fifth-batch-implementation-2026-09-19.md)<br>
> 状态：仓库内已把旧自学习数据迁移为可复算、可持久化、不可冒充独立验证的来源线索，并向签名 `evolution`/`serve` 管理部署提供 Candidate、独立 Eval、Review、Promotion、procedural Memory、撤销传播和检索失效的正式装配能力；真实旧数据副本、operator 签发部署及独立 authority 的目标环境验收仍未完成。

## 1. v4 旧学习来源证明

[Self-Improving Agent handler](../../../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/self-improving-agent/handler.js) 的学习格式由 v3 升级为 v4。首次读取旧数据时，每条 instinct/skill 都会生成 `caller-observation-provenance/v1`，其中保留：

- 迁移前格式版本、记录类型和记录 ID；
- 迁移前原始记录快照及其规范化 SHA-256；
- 可供后续 Candidate 提案引用的 opaque source evidence ref；
- 旧 `verified` 是否为真的原始调用方声明；
- 旧 verification status；
- 固定为空的 `independentEvidenceRefs`。

迁移随后把 live 记录降级为 `caller-observation` / `candidate-only`、`promotionEligible: false` 和 `verified: false`。原始 `verified: true` 只留在来源证明的 `callerVerificationClaim` 中，不会获得 grader、reviewer 或 promotion receipt。

迁移是耐久操作：首次读取时必须把 v4 结果写回；落盘失败则不向调用方暴露仅存在内存中的“已迁移”视图。再次读取同一文件不重复改写。来源快照与摘要不一致会以 `SELF_IMPROVE_PROVENANCE_INVALID` 失败关闭，避免修改旧事实后继续沿用原 evidence ref。

## 2. Candidate 只读出口

`export` 结果升级为 v4，并为每条旧学习 skill 输出 `candidateSourceHints`。这些提示只包含：

- `derivationMode: manual-import`；
- `lifecycleStatus: candidate-only`；
- `promotionEligible: false`；
- 来源 ref/digest；
- 空的独立证据列表。

它们不是 Skill Candidate 本身，也没有 runtime manifest、target matrix、Eval receipt 或 Review receipt。正式提案仍须在管理面构造完整 Candidate 并经过现有验证链，旧 handler 不能把提示直接写成 active release。

## 3. 签名管理部署的正式装配面

[Evolution deployment loader](../../../packages/cli/src/lib/evolution/evolution-deployment-loader.js) 现在仅向签名且命令白名单包含 `evolution` 或 `serve` 的管理部署暴露：

- candidate/release registry 与 evaluated promotion control plane；
- 独立 matrix receipt provider、耐久 retain/resolve adapter；
- human review provider 与 review Ledger adapter；
- structured Memory event/authority Ledger adapter、promotion/policy receipt writer 和 Agent control plane；
- Skill revocation propagation、retrieval invalidation authority 与持久化 adapter。

普通 `learning` deployment 仍只能获得受治理的合成/评测能力，测试明确确认它拿不到正式 promotion control plane。这样“产生线索”与“批准 active procedural 经验”仍属于不同管理边界。

由签名管理模块创建的 evaluated-promotion provider、review provider、review Ledger adapter 和 Memory authority writer，必须把 handler/issuer digest 精确绑定到已经验签的 deployment module digest。错摘要会在构造任何 authority 前被拒绝。外部耐久 authority 的摘要不被强行改写为管理模块摘要，仍按自身受信描述符独立验证。

## 4. G06/G07 的仓库边界

本批补齐了 G06 的来源可追溯、幂等迁移、无伪造独立证据和正式控制面装配缺口，也把 G07 已有的 runtime revalidation、撤销传播和检索失效能力放入同一签名管理部署入口。

以下事项仍属于目标环境验收，而不是本地合同测试可以替代的结论：

- 在真实旧 `learnings.json` 副本上执行迁移、留存前后摘要并核对业务数据；
- operator 签发实际 `evolution`/`serve` deployment，并配置彼此独立的 evaluator、reviewer、durability authority；
- 环境摘要变化时阻断旧 release，完成新的独立评测/复核后恢复；
- 执行撤销/回滚并证明所有消费者不能再召回旧可执行版本；
- 完成 v1/v2 跨版本生产消费者回读及恢复演练。

因此 G06、G07 仍标记为“部分完成”，但剩余边界已从仓库装配缺口收敛为真实数据与 operator 环境验收。

## 5. 回归证据

- Self-Improving handler：1 file、24 tests passed；覆盖 v4 迁移落盘、重复回读幂等、历史 caller claim 保留、来源快照篡改拒绝和 candidate-only export。
- 签名 deployment loader：1 file、64 tests passed；覆盖 `evolution`/`serve` 工厂可用性、`learning` 晋级能力隔离及五类 authority 的模块摘要绑定。
- 正式晋级、Memory、环境重校验和撤销链：10 files、73 tests passed。
- 本批合计：12 files、161 tests passed。
- 改动文件 ESLint：0 errors；Self-Improving handler 保留 3 条既有未使用参数 warning。

本批没有创建生产签名、没有修改 active Skill、没有把旧 caller observation 伪装成 Eval/Review receipt，也没有执行发布。
