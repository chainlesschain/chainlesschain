# ChainlessChain RRSI 实施进度

日期：2026-10-07。承接 [RRSI 实施方案](./rrsi-implementation-plan-2026-10-07.md)。工程基线为 `1de6f0f8d052eb1186a06ce6d30d0aa2dfffe85b`，初始实施分支为 `feature/rrsi-foundation-2026-10-07`。本轮新增文件的摘要及离线结果见 [合成回放记录](./evidence/rrsi-rr01-synthetic-replay-2026-10-07.json)。

首批合同与离线回放已提交为 `3238aa30cc`，第二批耐久控制已提交为 `c885bd7cb6`，位于共享工作区当前的 `feature/dots-muse-mods-foundation` 分支。各批仅提交本页所列 RRSI 文件及有限的产物类型注册；其他任务的工作区修改继续独立保留。

## 1 当前交付

已实现五池数据合同、冻结实验合同、候选来源与变化范围检查，以及无需模型的正则化筛选回放。合成例子中，训练增益为 0.50、选择集增益为负的候选被拒绝；选择集表现稳定且成本较低的候选被标记为 `shadow-selected`。这个结果证明离线筛选分支可执行，不代表真实 PM 泛化收益。

第二批已增加基于真实文件 Ledger 的耐久选择与终评控制，包括候选及槽位预占、五种资源记账、独立签名结算、来源暴露记录和进程恢复。真实预算权威、provider、grader 和生产签发仍需通过后续组装接入。

本轮继续补齐准备阶段的声明与耐久计账，包括课程规划、探索、候选提议、记忆蒸馏、失败重试和环境重置。新增不可退还的尝试次数、跨改名请求去重、独立准备结算签名域，以及准备/筛选间的未结算阻断；真实 PM 执行桥接尚未接入。

| 批次  | 状态                           | 已交付                                                                              | 尚需完成                                                          |
| ----- | ------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| RR-01 | 部分完成                       | 严格合同、五池隔离、A/B/C 公共预算、统计计划、候选登记与合成回放                    | 真实有效父版本、独立私有任务来源、operator 签发和目标部署就绪登记 |
| RR-02 | 准备、选择与终评耐久控制已实施 | Ledger 历史、三阶段预占与签名结算、不可退还尝试次数、来源暴露、进程恢复及原筛选计算 | 真实 PM 执行与账单接线、逐轮质量/无收益停止判定、真实权威组装     |
| RR-03 | 待实施                         | 原 Eval 与 PM 合同保持兼容                                                          | 真实五池执行映射、来源认证、组级校正统计与覆盖率验证              |
| RR-04 | 待实施                         | 现有正式晋级门保持原语义                                                            | Release Train、Review、Workbench、Pilot 与回滚接线                |
| RR-05 | 待目标条件就绪                 | 合成三组计划可冻结                                                                  | 真实 PM 的 A/B/C 对照、完整费用、一次性未见集审计和试用           |
| RR-06 | 待实施                         | 原准确提交的 CI 与 OIDC 发行要求继续适用                                            | CLI 任务族、目标矩阵、完整 Actions、发行和公开回读                |

## 2 代码落点

| 文件                                                                                                     | 行为                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [rrsi-data.js](../../../packages/cli/src/lib/evolution/rrsi-data.js)                                     | 有界、独立复制的 plain-data 校验；拒绝 Proxy、getter、非有限数字、负零、稀疏数组和循环；提供规范化摘要与不可变结构标记 |
| [rrsi-contracts.js](../../../packages/cli/src/lib/evolution/rrsi-contracts.js)                           | Policy、Dataset、Campaign、Candidate 的构造与回读；绑定五池、父版本、模型、价格、环境、grader、预算与统计计划          |
| [rrsi-selector.js](../../../packages/cli/src/lib/evolution/rrsi-selector.js)                             | 合成指标硬条件、正则项及贡献、确定性排序和全局预算/HOLD 判断                                                           |
| [rrsi-shadow-fixture.js](../../../packages/cli/__tests__/fixtures/rrsi-shadow-fixture.js)                | 220 个合成任务引用、四维合成来源、两个候选与固定合成观察；所有部署身份均明确为 fixture                                 |
| [rrsi-offline-replay.mjs](../../../packages/cli/scripts/rrsi-offline-replay.mjs)                         | 仓库内离线入口；内置 demo 或读取有界 JSON 并核对独立保存的 campaign digest                                             |
| [rrsi-history-ledger-adapter.js](../../../packages/cli/src/lib/evolution/rrsi-history-ledger-adapter.js) | 真实 v1/v2 Ledger 的历史回读、原子控制、来源暴露、签名结算与预算恢复                                                   |
| [rrsi-preparation-contracts.js](../../../packages/cli/src/lib/evolution/rrsi-preparation-contracts.js)   | 准备计划与尝试上限冻结、六种阶段、训练来源和输入规范化、独立预占及结算域                                               |
| [evolution-artifact-ports.js](../../../packages/cli/src/lib/evolution/evolution-artifact-ports.js)       | 仅新增 `rrsi-history-event` 有限类型，长期保留用途固定为 `evolution-ledger`                                            |

每个 Policy、Dataset、Campaign、Candidate 和 Replay 输出均保留 `structuralOnly:true`、`authenticated:false`、`readyForExecution:false`、`qualifiesForPromotion:false`。候选入选状态使用 `shadow-selected`，没有请求模型、启动真实 Actor 或写正式版本的能力。

## 3 合同与筛选约束

任务引用绑定与 ID、分区无关的内容摘要，以及 `template/project/principal/timeWindow` 四类带命名空间的来源摘要。跨池重复内容或共享已声明来源会被拒绝；同池通过来源关系计算传递连通分量，任务重复和 seed 重复不能增加独立组数。提议器投影只包含训练池的任务 ID 和内容引用。

这些检查验证的是输入中声明的来源关系；无法识别未声明的别名、伪造来源或重新包装的内容。`sourceMetadataAuthenticated:false` 保留这个边界，真实来源授权和语义重复检查进入 RR-03。

Campaign 使用共同的 A/B/C 总预算和共同的 B/C 提议、筛选预算，分阶段配置加最终预留不得超过总额。主比较列表必须包含 `rrsi-vs-rsi` 和 `rrsi-vs-baseline`，Bonferroni alpha 从完整列表派生。固定 seed 为 3–32 个不同值，最终评测预留覆盖冻结任务分母；筛选预留包含干净任务和全部已登记扰动的 baseline/candidate 配对执行。

合成统计区间由 fixture 或输入提供，`statisticalProtocolValidated:false` 不变。重采样次数只校验计划的尾部样本量下限，尚未执行组级统计或证明覆盖率、功效及实际置信水平。

候选必须绑定 Campaign 的目标、类型、父版本和训练任务；路径只允许对应 `skills/<target>/` 的 Markdown/JSON 或 `memory-policies/<target>/` 的 JSON，拒绝路径穿越、驱动器/UNC/ADS、Windows 设备名、尾点路径与大小写碰撞。文件数、总声明大小与谱系深度受冻结上限约束。内容身份排除候选 ID、假设、文件大小和工作流节点的声明，因此改名或修改计数不能逃避重复内容检查；实际产物字节仍待运行期验证。

筛选同时保存原始指标、各惩罚、加权贡献和总分。相同得分依次比较成本、体积和内容摘要。重复内容的所有候选都拒绝，输入排序不会决定哪一个副本被保留。

已知越权、数据泄漏或稳定锚点退化先拒绝该候选；即使候选已被拒绝，其缺失结果、未知成本、未确认清理或未知预算仍阻止整个 campaign 选出胜者。费用、token、工具调用、真实合成墙钟及执行/重试次数均按所有输入观察合计，不能通过删除坏候选的贡献绕过预算。p95 延迟只用于正则项，不代替墙钟预算。

## 4 第一批本地验证

Windows x64 下的新测试 **85/85** 通过，已有相关合同 **117/117** 通过，合计 **202/202**；共六个测试文件。ESLint 和 Prettier 检查通过。

| 测试组                                                                                                                                                                                                                                | 范围                                                                                          | 结果    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------- |
| [RRSI 合同](../../../packages/cli/__tests__/unit/rrsi-contracts.test.js)、[合成筛选](../../../packages/cli/__tests__/unit/rrsi-selector.test.js)、[离线入口](../../../packages/cli/__tests__/integration/rrsi-offline-replay.test.js) | 隔离、恶意数据形状、路径、预算、跨池来源、候选身份、整体 HOLD、扰动、重复内容和真实子进程入口 | 85/85   |
| 既有 PM rounds、PM benchmark、Skill execution manifest                                                                                                                                                                                | 原三分区、探索协议与运行清单兼容                                                              | 117/117 |

可复现命令在仓库根目录执行：

```powershell
node packages/cli/scripts/rrsi-offline-replay.mjs --demo
```

也可保存 `{campaign,candidates,observations}` 格式的合成输入，再使用事先独立保存的摘要：

```powershell
node packages/cli/scripts/rrsi-offline-replay.mjs --input replay.json --campaign-digest sha256:...
```

输入文件不超过 2 MiB，严格 UTF-8 解码；输入不会被修改，输出为 JSON。退出码 0 表示合成 shadow 选择，2 表示 HOLD，1 表示输入无效。该脚本使用仓库 fixture，首期不加入公开包的安装命令。

本轮请 Astra 复核了合同与信任边界。按审查修正了拒绝候选缺证时的整体 HOLD、大小声明不能逃避内容去重、尾点路径别名，以及扰动和实际执行次数的预算覆盖。

这些本地测试和合成回放不替代准确提交的完整 GitHub Actions，不是正式 36+9 或真实 RRSI A/B/C 样本。真实实验状态为 `NOT_RUN`，生产 automatic promotion 保持 `HOLD`。

## 5 第二批耐久控制

记录保留在既有 Evolution Ledger 和 ArtifactPorts 中，不新增数据库。预算作用域固定为租户与目标，首次登记的父版本、锚点、策略、模型/环境和预算不可由新的 campaign ID 改写。候选内容去重、槽位与执行 ID、选择查询次数和长期成本均从经过签名核验的完整历史重建。

每次预占覆盖完整的 task/seed/扰动执行分母；资源先按最大额度计账。只有当前进程取得的首次预占响应才能提交一次派发意图，JSON 复制、另一进程读回或重启恢复均不能取得新的派发标记。派发意图是启动前记录，不证明模型已经执行。

独立 Ed25519 结算回执同时签入签发者/策略/公钥上下文、实际 Ledger ID/身份摘要/epoch、campaign/候选、模型环境、槽位、执行 ID、预占摘要、五类实际资源及原始回执引用。回读再次核验签名和绑定；同一原始回执不能移到另一执行。只有终态、成本和清理完整时，预算才从预占额切换到独立签发的实际用量；未知、缺成本或未清理继续占用上限。真实超支留证并阻断后续预占，不能因超支不合法而漏记费用。

历史结算按原始 Ledger 事件的接受时间检查有效期，旧回执不会仅因今天超过其有效期而失去历史真实性。新的过期回执仍拒绝。没有配置独立验证器时，可以登记、预占和恢复状态，不能结算退还额度。

训练来源在 campaign 登记时即记入暴露历史。后续切换任务 ID、manifest ID 或分区，不能把已训练或已选择的数据再次作为未见集；已经使用的终评来源不得静默退役到训练池。有效结算可释放资源差额，始终不返还题库查询次数。

冻结最终候选前，整个作用域不得有未知/未结算执行或超支，并要求所选候选的选择执行已独立结算成功。这个冻结只是 operator 的版本意图；`qualityVerdictVerified:false` 保留，统计筛选接受仍须由 RR-03 接入。`readyForExecution:false`、`qualifiesForPromotion:false` 不变。

### 5.1 事务与并发范围

使用既有严格文件锁，按真实后端的固定 authority 根串行化该后端全部 RRSI 控制操作；无未锁定回退。读取、预占、产物发布、Ledger CAS 和回读在同一控制临界区，实际 Ledger 的 `expectedHeadDigest/expectedSequence` 仍验证未经过此锁的写入。初始组装与 inspect 也使用该锁。

首次双进程测试曾返回 `CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED`。原因是另一个合法发布者在 ArtifactPorts 的分阶段索引快照之间追加数据，严格读回正确拒绝变化的快照。固定后端的 RRSI 控制锁解决同后端 RRSI 进程之间的竞争，没有把完整性错误改写成可重试成功。其他领域发布者或共享同一 ArtifactStore 的另一后端不受这把锁管理，发生真实快照变化时仍失败关闭。

仅 Ledger head 冲突执行最多八次 CAS 重试。其他追加错误保留为 `CC_RRSI_COMMIT_UNKNOWN`，随后只能读回对账，不能盲目再追加或派发。硬退出发生在 Ledger head 已耐久写入但响应尚未返回时，恢复后读到已提交预占，返回 `newlyCommitted:false`。

v1 与已迁移 v2 使用原后端的品牌化 journal 方法；没有在 v2 失败时新建 v1 或清空历史的回退。

### 5.2 验证与边界

本地第二批新增 **31/31** 通过：25 个真实文件控制测试和 6 个进程/恢复测试，含真实 v2 journal 重开、两个子进程争用同一槽位、同一执行去重、head 写入后的硬退出和响应丢失。同期复测 RR-01 **85/85**；ArtifactPorts 回归 **42/42** 通过，既有的索引 symlink 替换用例在 Windows 下按原条件跳过 1 项。合计 **158 项通过、1 项既有平台跳过**。ESLint、Prettier 通过，摘要与逐文件结果见 [第二批验证记录](./evidence/rrsi-rr02-durable-controls-2026-10-07.json)。

测试使用真正的 ArtifactStore、Ledger、witness 文件、子进程和独立 Ed25519 验签，但 Ledger HMAC 与签发密钥均为测试权威。既有 Windows 目录 fsync 兼容适配不作为物理断电持久性证明。正式 provider、业务效果、真实账户账单和准确提交的完整 Actions 尚未由这些测试认证。

第二批提交时 `controlBudgetCoverage` 为 `selection-and-final-only`。本轮扩展后的声明范围见下一节；额度隔离可验证，但真实 provider 的完整账单与 RRSI 效果仍待实际执行认证。

## 6 准备阶段耐久计账

`registerPreparationPlan` 在租户/目标作用域首次冻结尝试上限、PM plan/manifest、训练映射和 PM 训练分区摘要。上限不得超过 campaign 已冻结的提议执行配置；新 campaign、重开 Ledger 或退款均不能重置该计划。RRSI 与 PM 的训练分区摘要分开保留，`mappingAuthenticated:false` 明确表示尚未认证真实映射。

`reservePreparation` 只接受训练池任务，尚未存在的候选不使用虚构 candidate ID。六类阶段共享 `proposalPerExploringArm` 与总预算，每次预占至少覆盖一个执行，并不可逆地消耗一次准备尝试。记账覆盖 token、工具调用、墙钟、费用和执行次数；真实重试/子执行用量仍须由独立签发者报告。签名完整的未启动、失败或取消结算可以退还资源差额，不能恢复尝试次数或重放已消费请求。

请求身份从阶段、规范化训练内容/来源、instruction/memory/artifact 摘要、冻结计划和执行环境派生。任务、campaign、execution、slot、round 和 branch ID 不参与去重身份；输入列表顺序也不影响身份。更换输入摘要仍是声明的新输入，真实字节、语义等价和来源真实性需由后续执行组装认证。

准备和筛选共用执行 ID、结算回执 ID、原始费用回执归属与总资源记账。准备结算使用独立的 `rrsi-preparation-settlement/v1` 域，旧 query settlement 的签名字节不变。历史完整回读继续复验签名与实际 Ledger 身份，不允许准备与筛选相互使用费用回执。

未结清的准备执行阻断下一次准备、筛选和冻结；未结清的筛选执行也阻断准备，以免已取得的筛选派发凭据与准备执行交叠。最终候选冻结后不得登记或执行准备计划。实时派发重新检查超支和准备 HOLD；旧版本已接受的派发历史继续可读、可结算费用，不产生新的派发权限。超时、未知状态、缺费用或未确认清理保留全额预占；后续完整签名只能对账同一执行，不能重跑。已知用量不得被较低的晚到回执覆盖。

本轮由 Astra 复核并修正了旧派发凭据绕过准备 HOLD 和超支停止条件的时序问题。验证记录见 [准备阶段验证记录](./evidence/rrsi-preparation-controls-2026-10-07.json)，包括实际 v2 重开、head 写入后的硬退出、响应丢失、两个进程的准备预占竞争和旧回执域兼容性。测试仍使用测试密钥与声明的 PM 摘要，不证明生产来源、provider 隔离或真实账单。

本轮新增 **34 项通过**：30 个准备控制测试与 4 个进程测试。七个相关测试文件的最新结果合计 **192 项通过、1 项既有 Windows 平台跳过**；ESLint、Prettier 通过。完整回归首轮的签名域测试先触发了共享回执 ID 去重；修正测试回执 ID 并增加双向跨域检查后，准备文件 **30/30** 复测通过。生产源码和其余六个已通过的测试文件未再变动，未重复整套测试；验证记录保留两次报告的摘要。

登记准备计划后的 inspect 返回 `controlBudgetCoverage:preparation-selection-and-final`，表示控制 API 的覆盖范围；未登记的历史保留 `selection-and-final-only`。`qualityVerdictVerified:false`、`readyForExecution:false`、`qualifiesForPromotion:false` 不变，真实实验仍为 `NOT_RUN`。

## 7 下一批工作

下一步把 RR-02 控制接到既有品牌化 `PmExplorationExecutionHost`、验证的 plan/manifest、journal 和真实 Suite 训练映射，再进入 RR-03 的五池执行映射、来源认证和组级校正统计。现有低层预算执行器的回调与超时结果不证明生产准入、清理或完整成本；PM 执行回执也不能自动当作五资源结算证据。逐轮无收益停止条件须由真实质量回执触发，不能只据结算成功或当前合成分数宣布质量改善。

真实父版本与数据清单的登记独立于合成例子。待受信部署和来源可核验后，以新冻结合同开启真实实验；不把示例摘要重新标为生产身份。
