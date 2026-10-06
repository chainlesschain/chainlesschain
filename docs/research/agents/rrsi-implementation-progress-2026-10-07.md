# ChainlessChain RRSI 实施进度

日期：2026-10-07。承接 [RRSI 实施方案](./rrsi-implementation-plan-2026-10-07.md)。工程基线为 `1de6f0f8d052eb1186a06ce6d30d0aa2dfffe85b`，初始实施分支为 `feature/rrsi-foundation-2026-10-07`。本轮新增文件的摘要及离线结果见 [合成回放记录](./evidence/rrsi-rr01-synthetic-replay-2026-10-07.json)。

首批合同与离线回放已提交为 `3238aa30cc`，第二批耐久控制已提交为 `c885bd7cb6`，准备阶段计账已提交为 `80591450ad`，PM broad 桥接已提交为 `1b278b14b6`，RR-03 五池映射与统计已提交为 `4abe03f44d`，位于共享工作区当前的 `feature/dots-muse-mods-foundation` 分支。各批仅提交本页所列 RRSI 文件及有限的产物类型注册；其他任务的工作区修改继续独立保留。

## 1 当前交付

已实现五池数据合同、冻结实验合同、候选来源与变化范围检查，以及无需模型的正则化筛选回放。合成例子中，训练增益为 0.50、选择集增益为负的候选被拒绝；选择集表现稳定且成本较低的候选被标记为 `shadow-selected`。这个结果证明离线筛选分支可执行，不代表真实 PM 泛化收益。

第二批已增加基于真实文件 Ledger 的耐久选择与终评控制，包括候选及槽位预占、五种资源记账、独立签名结算、来源暴露记录和进程恢复。真实预算权威、provider、grader 和生产签发仍需通过后续组装接入。

准备阶段的声明与耐久计账覆盖课程规划、探索、候选提议、记忆蒸馏、失败重试和环境重置，具有不可退还的尝试次数、跨改名请求去重、独立准备结算签名域，以及准备/筛选间的未结算阻断。本轮新增既有 PM host 的 broad round 桥接与结构训练映射；真实来源、模型、价格、父版本及生产隔离认证仍未完成。

| 批次  | 状态                           | 已交付                                                                         | 尚需完成                                                                 |
| ----- | ------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| RR-01 | 部分完成                       | 严格合同、五池隔离、公共预算、统计计划、只读有效父版本绑定及合成回放           | 父版本生产权威/锚点稳定性、独立私有来源、operator 签发和部署准入         |
| RR-02 | 耐久控制与 PM broad 接线已实施 | 三阶段预占、签名结算、不可退还尝试、PM host/journal 接线及 off/shadow 初步组装 | 其他准备操作、生产隔离与完整账单接线、逐轮停止判定、完整生产权威组装     |
| RR-03 | 五池映射与描述统计已实施       | 原 Eval 签名行映射、训练投影、完整分母、组级外包络与两类合成模拟               | 可信 launch/实验组/扰动/预占绑定、真实来源认证、正式统计校准与端到端执行 |
| RR-04 | 待实施                         | 现有正式晋级门保持原语义                                                       | Release Train、Review、Workbench、Pilot 与回滚接线                       |
| RR-05 | 待目标条件就绪                 | 合成三组计划可冻结                                                             | 真实 PM 的 A/B/C 对照、完整费用、一次性未见集审计和试用                  |
| RR-06 | 待实施                         | 原准确提交的 CI 与 OIDC 发行要求继续适用                                       | CLI 任务族、目标矩阵、完整 Actions、发行和公开回读                       |

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
| [rrsi-pm-training-mapping.js](../../../packages/cli/src/lib/evolution/rrsi-pm-training-mapping.js)       | PM Suite/plan 的结构校验、独立内容摘要、完整可访问训练来源映射；不认证来源权威                                         |
| [rrsi-pm-execution-bridge.js](../../../packages/cli/src/lib/evolution/rrsi-pm-execution-bridge.js)       | 既有品牌化 PM host/journal 的 broad round 接线，先预占、一次派发、状态变化检测与观察留证                               |
| [rrsi-evaluation-adapter.js](../../../packages/cli/src/lib/evolution/rrsi-evaluation-adapter.js)         | 五池到既有 Eval Suite 的内容/来源双射，训练专用投影及原 final receipt 签名行验证                                       |
| [rrsi-group-statistics.js](../../../packages/cli/src/lib/evolution/rrsi-group-statistics.js)             | 固定来源连通分量与任务权重、全比较家族、完整槽位分母和 bootstrap/Hoeffding 外包络                                      |
| [rrsi-statistics-simulation.js](../../../packages/cli/src/lib/evolution/rrsi-statistics-simulation.js)   | 完整方法小网格及明确标记的 Hoeffding-only 辅助网格，独立报告同时 Monte Carlo 界及 HOLD                                 |
| [evolution-artifact-ports.js](../../../packages/cli/src/lib/evolution/evolution-artifact-ports.js)       | 仅新增 `rrsi-history-event` 有限类型，长期保留用途固定为 `evolution-ledger`                                            |

每个 Policy、Dataset、Campaign、Candidate 和 Replay 输出均保留 `structuralOnly:true`、`authenticated:false`、`readyForExecution:false`、`qualifiesForPromotion:false`。候选入选状态使用 `shadow-selected`，没有请求模型、启动真实 Actor 或写正式版本的能力。

## 3 合同与筛选约束

任务引用绑定与 ID、分区无关的内容摘要，以及 `template/project/principal/timeWindow` 四类带命名空间的来源摘要。跨池重复内容或共享已声明来源会被拒绝；同池通过来源关系计算传递连通分量，任务重复和 seed 重复不能增加独立组数。提议器投影只包含训练池的任务 ID 和内容引用。

这些检查验证的是输入中声明的来源关系；无法识别未声明的别名、伪造来源或重新包装的内容。`sourceMetadataAuthenticated:false` 保留这个边界，真实来源授权和语义重复检查进入 RR-03。

Campaign 使用共同的 A/B/C 总预算和共同的 B/C 提议、筛选预算，分阶段配置加最终预留不得超过总额。主比较列表必须包含 `rrsi-vs-rsi` 和 `rrsi-vs-baseline`，Bonferroni alpha 从完整列表派生。固定 seed 为 3–32 个不同值，最终评测预留覆盖冻结任务分母；筛选预留包含干净任务和全部已登记扰动的 baseline/candidate 配对执行。

旧合成筛选区间仍由 fixture 或输入提供。新组级模块执行独立版本的描述统计与合成模拟，详见第 8 节；它不反向认证旧区间，`statisticalProtocolValidated:false` 不变，也未证明真实生产覆盖率或功效。

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

## 7 既有 PM host 的 broad round 接线

### 7.1 映射和组装边界

`projectRrsiPmTrainingReferences` 从经过结构校验的 PM Suite 派生训练引用。PM `taskDigest` 包含任务 ID 和分区，另定义 `rrsi-pm-task-content/v1`，只对 `taskType/publicInput/graderId/privateExpected` 计算内容摘要，不含任务 ID、分区或来源声明。输出同时保留两个摘要与四维来源摘要，既不输出 prompt，也不输出 private expected。内容摘要与来源组必须逐一匹配 campaign 的训练池；plan 的所有可访问训练任务都必须映射，不能只登记当轮 task。RRSI 与 PM 的训练分区摘要分别保留。

这些校验验证已声明字节之间的对应关系；Suite、来源、输入 Memory 与父发布版本仍没有生产来源认证。`correspondenceVerified:true` 不改变 `mappingAuthenticated:false`、`parentProvenanceVerified:false`。任务内容的语义等价、未声明别名及任意换装数据仍须通过后续来源权威核验。

`createRrsiPmExplorationBridge` 只接收已组装的真实品牌化 history adapter、PM host 和冻结数据，不接受 callback/provider/signing factory。它核对 scope、campaign 环境、plan/manifest、已登记准备计划和重算映射；捕获原始 history 方法，复制外壳不能取得权限。PM manifest 能绑定其配置的 provider/handler 描述，不能证明 RRSI 的真实模型、价格或父版本。`modelPricingAdmissionVerified:false`、`productionIsolationVerified:false` 保留。

### 7.2 执行、费用和恢复

首版仅支持 **无 curriculum 的 broad round**；deep 分支、课程规划、merge、最终 evaluation 等操作暂未接线。`reserveRrsiPmBroadRound` 检查当前 journal 的精确 branch head，并在派发前预占整个 PM plan 的 token、工具调用和墙钟上限，避免漏掉 host 私有 overhead。两种执行单元为 runner 与 grader；显式 `plannedExecutions:2` 使用新的 `rrsi-preparation-reservation/v2`，旧 v1 的预占和签名字节保持兼容。独立准备 settlement 继续使用 v1 签名域，由 reservationDigest 绑定 v2；成功结算至少覆盖两个执行单元。

PM host 强制执行三类资源限制；货币和全部内部重试/模型调用次数没有由此强制限制，`monetaryBudgetEnforced:false`、`executionCountBudgetEnforced:false` 明确保留。五资源的真实费用、额外执行和清理状态仍须独立结算；超支继续留证并阻断后续准入。

`executeRrsiPmBroadRound` 在首次 await 之前消费 history/bridge 的新鲜凭据并记录派发意图。凭据绑定该桥接、journal 与完整 round 上下文；序列化复制、恢复返回或普通 v1 凭据均不能执行。桥接之间绑定 host/journal 归属，并用同步 in-flight 检查阻断并发消费。返回后验证只增加预期 checkpoint、branch head 和对应指标；发现其他调用改变 journal 时保持 HOLD。这些检查不证明隔离外部代码：直接调用原 PM API 的代码仍可能干扰 journal，生产组装还须限制 host 暴露。

派发响应丢失时返回 `dispatchPersistence:unknown`、`dispatchCommitted:null`、`hostInvoked:false`、`readbackRequired:true`，不能重跑或把事件当成确定未提交。派发 head 写入后硬退出同样保留完整预占和已消费尝试，恢复进程无派发权限。

执行后的原始 PM 签名结果通过 `observe-preparation` 保留在既有 Ledger artifact 中。观察不会修改 knownUsage、独立 settlement、回执归属或任何配额；即使 PM 原始结果含 `receiptsAuthenticated:true`，外层仍保持 `executionEvidenceVerified:false`、`costEvidenceVerified:false`，并保留 unknown 与全额预占。已独立结算的执行追加观察时只留证，不降级状态或改写费用。历史观察标记 `independentlyReverified:false`，后续消费必须重新验证对应 PM 权威。

观察写入结果不明时，返回原始 PM result 和 `observationPersistence:unknown`，要求回读；不丢弃实际回执，不盲目再追加或再执行。超时可能早于不响应 AbortSignal 的 callback 结束，不能据此声明 cleanup 或零费用。此接口不自动形成质量判定或晋级凭据。

本轮由 Astra 复核并修正派发响应丢失时误报未提交的恢复语义。验证记录见 [PM 桥接验证记录](./evidence/rrsi-pm-bridge-controls-2026-10-07.json)。本地测试运行既有 host 的签名、工具白名单和预算路径，以及真实 Ledger/进程恢复；callback、密钥、Memory 和业务数据均为测试配置，不是生产准入或真实 A/B/C 实验。

本轮新增 **26 项通过**：7 个训练映射测试、16 个桥接测试和 3 个真实进程恢复测试。12 个相关文件的完整本地回归合计 **284/284**，包括既有 PM host/rounds/benchmark、RRSI 合同/筛选/离线回放/耐久控制，以及 v2 journal 的多执行单元预占与重开。ESLint、Prettier 通过；本地结果不替代准确提交的完整 GitHub Actions。

## 8 五池 Eval 映射与组级统计

三份原严格 Eval Suite 分别承接 Gate、selection 和 audit：training 全部对应 train；Gate validation/test 对应 gate-validation/gate-test；selection 和 audit 各自在自己的池内以完整来源组拆分。映射核验实际 PM 内容摘要、四维来源、全池双射、原 30/20/20 样本下限和固定 seed，不向原 schema 添加字段。品牌化训练投影仅返回 train 引用，拒绝 JSON 克隆及伪造标签。

签名行收集复用真实 `EvolutionEvalReceiptVerifier` 和 `verifyEvolutionEvalResultEvidence`，核验完整十二字段上下文；原运行 `planDigest` 必须已经绑定本次 mapping digest。更名实验组、改行、替换池、旧上下文和伪造签名均拒绝。该路径只认证 final receipt 覆盖的行和版本；生命周期属于 A/B/C、实际扰动、launch slot、Ledger 预占均明确未认证。来源、逐级原始回执、完整费用、清理和晋级仍未认证。

统计计划冻结全部比较×池×variant：默认 selection 有 8 项假设，generalization 有 24 项，不能事后删比较再分配 alpha。组单位为四类来源关系的传递连通分量，任务权重事前固定；重复 seed 先在任务内聚合，不能增加独立组数或改变 RNG 缩窄区间。缺行、unknown、缺回执和缺 grade 保留原分母并 HOLD；人工补救不算原始成功。重复槽位、复用结果引用或替换版本/seed/variant 均拒绝。

最终区间取任务加权 cluster percentile bootstrap 与有限样本 Hoeffding 界的外包络。保证来源是独立有界组及固定权重条件下的 Hoeffding 界，不能称 bootstrap 已校准。同池比较共享 bootstrap index stream。尾部至少需要 25 个重采样：默认 10,000 次对 selection 足够，对 generalization 不足，必须 HOLD；增加次数须创建新事前计划。单次重采样上限 5,000 万次；大型逐槽数据还受现有 2 MiB/5,000 项等 plain-data 边界约束，尚需批处理或流式证据接口。

[合成模拟文件](./evidence/rrsi-rr03-statistics-synthetic-grid-2026-10-07.json) 保存两份冻结网格。完整方法复用分析的直接抽样内核，固定 100 trials、20/100 groups、两项 contrast 和 2,000 次 bootstrap，共 3.84 亿次 cluster picks；最低覆盖率点估计 0.99，但全网格同时下界最低约 0.792，结果为 HOLD。辅助 Hoeffding-only 网格为 2,000 trials、20/40/100/400 groups，最低同时覆盖率下界约 0.945，也 HOLD；其功效不能用于正式外包络样本量选择。

每份报告分别对全部预登记场景×四项 rate 给出 Hoeffding 同时 Monte Carlo 界；Wilson 区间仅作逐项诊断。两份报告不能合称联合 95% 保证。模拟采用人工独立 contrast delta，保留同 trial 比较共享 bootstrap stream；这不是实际三臂共同 outcome 的功效分析，也不证明真实来源独立性。生产协议、coverage、power 及晋级标志均保持 false。Astra 只读复核已确认上下文修正与完整方法模拟边界；本地验证仍不替代准确提交的完整 Actions。

[RR-03 本地验证记录](./evidence/rrsi-rr03-local-controls-2026-10-07.json) 保存源码摘要及逐文件结果。本轮新增 34 项用例；16 个相关文件合计 **506/506** 通过，包括完整原 Eval Gate、RRSI 合同/筛选/耐久控制、PM broad/host/benchmark 和真实进程恢复。ESLint、Prettier 通过；未进行真实模型调用、生产晋级或发行。

## 9 有效父版本与首段运行组装

[rrsi-parent-binding.js](../../../packages/cli/src/lib/evolution/rrsi-parent-binding.js) 捕获真正 `SkillReleaseRegistry` 的原方法，并确认其绑定宿主提供的同一 transaction Ledger。JSON 克隆、回调替代、另一租户及 Memory-policy 父版本拒绝。冻结 release/content/candidate、revision/state、transaction/authority/fence、依赖/manifest/矩阵；前后 `readActive` 夹住 parent/anchor 读取，真实提交或文件变化便拒绝。原 Skill controller 的 CAS 使用 content digest，与 release digest 分开；不能拿发布摘要充当 Memory 摘要或沿 `parentDigest` 推断 release 谱系。

锚点保持 campaign 初始冻结值，不随 LKG 移动。可读 release 可能从未激活，LKG 也不独立证明稳定质量、观察窗口、撤销状态和部署适用性。当前只确认锚点产物完整性；生产 Ledger 权威、历史激活、稳定质量和部署标志均为 false，不授予执行、修改或晋级能力。

[rrsi-runtime-composition.js](../../../packages/cli/src/lib/evolution/rrsi-runtime-composition.js) 显式接入 live parent binding 和原 PM bridge。模式限定 off/shadow，单 host 的绑定不可变；生产准入不齐时 enforced 拒绝。绑定后直接调用原 bridge API 也会检查模式和 live parent。预占前重读；dispatch 持久化完成、host 调用之前再重读，缩小 Ledger I/O 期间的变化窗口。它仍是检查时点的快照，不能替代执行租约、原 Registry CAS 或完整生产准入。

父版本过期或损坏不清除已发生的预占、派发意图或费用。fresh 能力消费后不得重放，unknown 保留并要求独立结算；已持久化 dispatch 禁止 `not-started` 结算。实际 host 未调用的拒绝也须由独立权威提供允许的终态和清理/费用证据。历史读回和原签名结算不因父版本陈旧而阻断。

当前组装仅支持无 curriculum 的 PM broad，不提供 provider、签名密钥、模型/价格、源数据或晋级默认值。off/shadow 是单 host 的工程控制，尚未接入受信部署模式登记、Release Train 或不可剥离的 RRSI 来源；不能声称 RR-04 无降级晋级门或全量恢复已完成。Astra 已复核派发后二次检查和待对账语义。

[父版本与运行控制验证记录](./evidence/rrsi-parent-runtime-local-controls-2026-10-07.json) 保存六个相关文件 **128/128** 的本地回归结果；本轮新增 13 项父版本/模式/派发反例，包含真实 Registry 提交、真实文件损坏、签名 host、独立结算和进程重开。ESLint、Prettier 通过。Registry 的 Ledger/权限、callback、密钥和业务输入仍为测试配置，不能据此认证生产父版本、收费准入或目标隔离。

## 10 下一批工作及完成审计

下一步接入有效父版本与真实运行权威，在派发前绑定实验组、variant、launch slot 和 reservation，再把认证原始行接入统计与选择回执。继续完善其他准备操作、实际模型/价格和完整费用证据，以及 Release Train/Review/Pilot/Promotion 的新增必需门。逐轮无收益停止条件须由真实质量回执触发，不能只据结算成功或当前合成分数宣布质量改善。

| 必需条件            | 当前证据                                           | 未完成的工程或外部条件                                                      |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| 有效父版本与锚点    | live Registry/预期 Ledger 绑定及 PM 派发重查已实现 | 生产权威、锚点稳定/撤销/适用性、晋级 CAS 接线和真实版本清单                 |
| 私有五池与来源      | 内容/声明来源的隔离及双射已实现                    | 独立来源审查、权限/缓存隔离、来源权威和真实任务                             |
| 模型/价格/环境/预算 | 冻结合同、预占和签名结算结构已实现                 | 目标部署准入、端点/账户/模型认证、官方账单、人工成本                        |
| 全准备操作与恢复    | 六阶段耐久控制，PM broad 和 off/shadow 初步组装    | 课程、提议、蒸馏、retry/reset host 接线、受信模式登记和完整账单             |
| 五池真实派发与统计  | 签名 final rows、描述统计、有限模拟                | launch/variant/arm/reservation 权威、全部扰动、正式统计校准                 |
| 选择/泛化必需回执   | 离线 selector 和历史冻结控制                       | 可信 receipt、逐轮停止条件和锚点回归                                        |
| 晋级无降级绕过      | 既有发布门保持原行为                               | RRSI 来源不可剥离、off/shadow/enforced、Review/Pilot/Promotion 必需门及恢复 |
| Workbench 与回滚    | 既有底座可复用                                     | RRSI 收益/费用/HOLD 投影、在途终止与清理、有效版本恢复                      |
| 真实 A/B/C 与审计   | 无真实 RRSI 效果样本                               | 新冻结实验、等预算请求全分母、独立未见集、人工审阅和真实观察窗口            |
| CLI 扩展与交付      | 原发行门仍适用                                     | PM 达标后的新任务/宿主范围；准确提交跨平台 CI、OIDC 发行与公开回读          |

真实父版本与数据清单的登记独立于合成例子。待受信部署和来源可核验后，以新冻结合同开启真实实验；不把示例摘要重新标为生产身份。
