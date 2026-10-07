# ChainlessChain RRSI 实施进度

日期：2026-10-07。承接 [RRSI 实施方案](./rrsi-implementation-plan-2026-10-07.md)。工程基线为 `1de6f0f8d052eb1186a06ce6d30d0aa2dfffe85b`，初始实施分支为 `feature/rrsi-foundation-2026-10-07`。本轮新增文件的摘要及离线结果见 [合成回放记录](./evidence/rrsi-rr01-synthetic-replay-2026-10-07.json)。

首批合同与离线回放已提交为 `3238aa30cc`，第二批耐久控制已提交为 `c885bd7cb6`，准备阶段计账已提交为 `80591450ad`，PM broad 桥接已提交为 `1b278b14b6`，RR-03 五池映射与统计已提交为 `4abe03f44d`，有效父版本与运行组装为 `7879476ee2`，原生测量图为 `3f94d1f33f`，原生批次计账为 `b82072d9b0`，签名登记与准入为 `6ed173c65f`，后续统计 v2、耐久预注册、HOLD 质量回执和后端关联见第 15–19 节；已通过 `58a30cbae7` 随功能分支合入 `main`，本页最新控制验证记录至 `2afd65c12f`。各批仅提交本页所列 RRSI 文件及有限的产物类型注册；其他任务的工作区修改继续独立保留。

## 1 当前交付

已实现五池数据合同、冻结实验合同、候选来源与变化范围检查，以及无需模型的正则化筛选回放。合成例子中，训练增益为 0.50、选择集增益为负的候选被拒绝；选择集表现稳定且成本较低的候选被标记为 `shadow-selected`。这个结果证明离线筛选分支可执行，不代表真实 PM 泛化收益。

第二批已增加基于真实文件 Ledger 的耐久选择与终评控制，包括候选及槽位预占、五种资源记账、独立签名结算、来源暴露记录和进程恢复。真实预算权威、provider、grader 和生产签发仍需通过后续组装接入。

准备阶段的声明与耐久计账覆盖课程规划、探索、候选提议、记忆蒸馏、失败重试和环境重置，具有不可退还的尝试次数、跨改名请求去重、独立准备结算签名域，以及准备/筛选间的未结算阻断。本轮新增既有 PM host 的 broad round 桥接与结构训练映射；真实来源、模型、价格、父版本及生产隔离认证仍未完成。

| 批次  | 状态                             | 已交付                                                                                    | 尚需完成                                                             |
| ----- | -------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| RR-01 | 部分完成                         | 严格合同、五池隔离、公共预算、统计计划、只读有效父版本绑定及合成回放                      | 父版本生产权威/锚点稳定性、独立私有来源、operator 签发和部署准入     |
| RR-02 | 耐久控制与 PM broad 接线已实施   | 三阶段预占、原生三角批次/逐臂记账、签名结算、PM host/journal 及 off/shadow 组装           | 其他准备操作、生产隔离与完整账单接线、逐轮停止判定、完整生产权威组装 |
| RR-03 | 原生控制、统计 v2 与预注册已实施 | 五池双射、三角计划、逐臂预算、签名准入/行/census、统计 v2、耐久预注册、固定 HOLD 质量回执 | 真实来源/费用、正式校准、端到端效果及有效质量 PASS                   |
| RR-04 | 待实施                           | 现有正式晋级门保持原语义                                                                  | Release Train、Review、Workbench、Pilot 与回滚接线                   |
| RR-05 | 待目标条件就绪                   | 合成三组计划可冻结                                                                        | 真实 PM 的 A/B/C 对照、完整费用、一次性未见集审计和试用              |
| RR-06 | 待实施                           | 原准确提交的 CI 与 OIDC 发行要求继续适用                                                  | CLI 任务族、目标矩阵、完整 Actions、发行和公开回读                   |

## 2 代码落点

| 文件                                                                                                       | 行为                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [rrsi-data.js](../../../packages/cli/src/lib/evolution/rrsi-data.js)                                       | 有界、独立复制的 plain-data 校验；拒绝 Proxy、getter、非有限数字、负零、稀疏数组和循环；提供规范化摘要与不可变结构标记 |
| [rrsi-contracts.js](../../../packages/cli/src/lib/evolution/rrsi-contracts.js)                             | Policy、Dataset、Campaign、Candidate 的构造与回读；绑定五池、父版本、模型、价格、环境、grader、预算与统计计划          |
| [rrsi-selector.js](../../../packages/cli/src/lib/evolution/rrsi-selector.js)                               | 合成指标硬条件、正则项及贡献、确定性排序和全局预算/HOLD 判断                                                           |
| [rrsi-shadow-fixture.js](../../../packages/cli/__tests__/fixtures/rrsi-shadow-fixture.js)                  | 220 个合成任务引用、四维合成来源、两个候选与固定合成观察；所有部署身份均明确为 fixture                                 |
| [rrsi-offline-replay.mjs](../../../packages/cli/scripts/rrsi-offline-replay.mjs)                           | 仓库内离线入口；内置 demo 或读取有界 JSON 并核对独立保存的 campaign digest                                             |
| [rrsi-history-ledger-adapter.js](../../../packages/cli/src/lib/evolution/rrsi-history-ledger-adapter.js)   | 真实 v1/v2 Ledger 的历史回读、原子控制、来源暴露、签名结算与预算恢复                                                   |
| [rrsi-native-evaluation-batch.js](../../../packages/cli/src/lib/evolution/rrsi-native-evaluation-batch.js) | 从原生上下文编译完整请求清单、逐 child/arm 预算及分类执行单位；输出引用，不复制私有题目                                |
| [rrsi-preparation-contracts.js](../../../packages/cli/src/lib/evolution/rrsi-preparation-contracts.js)     | 准备计划与尝试上限冻结、六种阶段、训练来源和输入规范化、独立预占及结算域                                               |
| [rrsi-pm-training-mapping.js](../../../packages/cli/src/lib/evolution/rrsi-pm-training-mapping.js)         | PM Suite/plan 的结构校验、独立内容摘要、完整可访问训练来源映射；不认证来源权威                                         |
| [rrsi-pm-execution-bridge.js](../../../packages/cli/src/lib/evolution/rrsi-pm-execution-bridge.js)         | 既有品牌化 PM host/journal 的 broad round 接线，先预占、一次派发、状态变化检测与观察留证                               |
| [rrsi-evaluation-adapter.js](../../../packages/cli/src/lib/evolution/rrsi-evaluation-adapter.js)           | 五池到既有 Eval Suite 的内容/来源双射，训练专用投影及原 final receipt 签名行验证                                       |
| [rrsi-group-statistics.js](../../../packages/cli/src/lib/evolution/rrsi-group-statistics.js)               | 固定来源连通分量与任务权重、全比较家族、完整槽位分母和 bootstrap/Hoeffding 外包络                                      |
| [rrsi-statistics-simulation.js](../../../packages/cli/src/lib/evolution/rrsi-statistics-simulation.js)     | 完整方法小网格及明确标记的 Hoeffding-only 辅助网格，独立报告同时 Monte Carlo 界及 HOLD                                 |
| [evolution-artifact-ports.js](../../../packages/cli/src/lib/evolution/evolution-artifact-ports.js)         | 仅新增 `rrsi-history-event` 有限类型，长期保留用途固定为 `evolution-ledger`                                            |

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

## 10 扰动来源与原生测量图

[rrsi-evaluation-variants.js](../../../packages/cli/src/lib/evolution/rrsi-evaluation-variants.js) 将 clean、paraphrase、tool-order、tool-delay 对应到真正严格 Eval Suite。原 task ID、split、四维来源组、grader 和隐藏评分目标固定，training 内容不可改。paraphrase 只允许 PM prompt 变化；非文本扰动保留原 Suite 身份，工具执行变换仍待独立 runtime 接线。原始/派生三份 suite 及多个 variant 之间统一检查可精确识别的跨五池 publicInput 重复；训练投影只给出原 train 引用。

原 Eval 的 native training context digest 包含整个 suiteDigest，改写留出题即使不改 training 也会产生新摘要。本模块同时保存 base/derived native 摘要，不复贴旧 provenance 回执；RRSI train 来源摘要和任务仍不变。`hiddenObjectivesUnchanged` 仅证明字段未变，不能证明改写的语义等价、未夹带答案或 recipe 确实执行。这些认证标志均为 false。

[rrsi-native-evaluation-plan.js](../../../packages/cli/src/lib/evolution/rrsi-native-evaluation-plan.js) 编译选择或泛化阶段全部 role×variant×原生 pair。新测量图在观察结果之前固定 C–B、C–A、B–A 三角采集，每 task×seed×arm×variant×target 有两份计划观察；第三个 pair 的 A/B 结果进入主 arm 均值测量，并非可丢弃的诊断数据，也不自动新增 B–A 零假设。未来统计 v2 需先在任务内聚合固定重复，再按来源组求差；不能增加独立组数，也不能用 pooled 改善覆盖原 C–A/C–B Gate 的拒绝。

原生 `SkillTargetMatrixEvalPlan.planDigest` 保持原义，4 字段 request context、12 字段 expected context 和 request digest 从其真实 cell 生成，不改成 mapping 或 RRSI plan digest。声明的 typed lock/manifest/target matrix 与每个 case 的全部 cellId/runtime/environment 必须一致；所有 case 同步删同一 cell 也会拒绝。这里只校验声明矩阵完整性，不认证矩阵部署或签名权威。缺 pair、缺 variant、换产物/父版本/调用身份均拒绝；stage 对象的隐式转换不执行。

完整观察计数包括 validation/test、全部 seed、全部 variant、全部目标和重复 arm。单目标泛化图有 24 个 native cases，每 arm 2,880 个 Actor 观察；默认 v1 的 clean-only 最终预算 400 不足，编译必须拒绝，不能修改已冻结历史来补额度。两目标图有 48 个 slots、每 arm 5,760 个观察。确认性 family 包括原已登记比较×池×variant×target；三角采集不代表已实现统计 v2、等实际费用或完整成本图。

私有源上下文分别有界复制，输出只保留引用及原生计划，不含题目和隐藏目标；生成 envelope 也必须通过同一 2 MiB/节点上限，否则拒绝而不裁剪矩阵。现有 40-target 合成反例能稳定触发这一界限，较大图需继续设计分块/引用协议。

本批仍没有原生派发能力、独立付费预算、生命周期/recipe 执行认证或 admission inventory。下一层必须用版本化 batch/child 预占绑定完整三角图和各 arm 的全请求费用，再将这些根签入 enrollment v2；由 Gate 自己产生 runId/runNonce 后，连接实际 admission 与最终签名回执。旧单 partition reservation、PM-only enrollment 和单观察统计不能自动升级为这条新协议。

[本地验证记录](./evidence/rrsi-native-evaluation-local-controls-2026-10-07.json) 保存源码摘要和四文件 **39/39** 回归结果：新增 variant 13 项、native plan 13 项，以及旧 Eval/训练映射 13 项。ESLint、Prettier 通过。Astra 只读复核后补上跨池碰撞、stage 转换、完整矩阵和自身输出上限反例；未执行真实原生 Actor、付费请求或 A/B/C 实验。

## 11 原生批次、逐臂记账及对子结算

[rrsi-native-evaluation-batch.js](../../../packages/cli/src/lib/evolution/rrsi-native-evaluation-batch.js) 从原生 contextual compiler 重建全部 role × variant × pair × target，生成紧凑引用清单。History 一次原子预留整批，消耗一次 selection query，并登记完整来源闭包；generalization 同时占用 gate-validation、gate-test、audit。失败、取消、未开始或进程退出均不返还 query、候选及来源暴露记录。新的原生命名空间保持旧 v1 reservation、preparation 和 settlement 的字节及读回规则。

每个 child 是完整 paired Eval attempt，内含两份逐臂 reservation；新鲜 child capability 只能原子记录一次双臂派发意图。序列化副本、重启读回、幂等 reserve 及不确定提交不能重新获得 capability。独立 Ed25519 结算在同一签名中固定两臂 bindings、费用、清理和分类执行单位；一张 paired 回执归该 child，不能再次认领到其他 child 或旧 reservation。完整结算不能用新 receipt ID 改写，部分结算的已确认单位和费用不能降低。

分类向量为 Actor、grade、safety、reset、provider。每臂 Actor/grade/safety 均须保留非训练任务数 × seeds；reset/provider 及逐臂 cost inventory 摘要必须显式声明。新 `executions` 是明确注册的 stage + provider 计费节点数，包含嵌套层次，不能冒充物理 provider 请求数，也不能拿旧 Gate 的 Actor-only count 作为新结算总量。增加 provider 次数不能弥补缺失 Actor。未知类别不补零，保留 ceiling/HOLD；已知类别合计形成下界，超过预算也会阻止新派发。

旧无 arm 的消耗保守计入每个新 arm，后续旧接口同样核对这些逐臂开销。全 History 固定 control arms、目标范围及 native/RRSI 两套候选身份，分别消耗 invocation ID、nonce 和原生 request context，避免换 query/campaign/candidate 名称重放。native 路径启用后，live freeze 只允许一个全局 finalist；旧事件回放仍保持原语义。native 候选不能降级到旧 final reservation。冻结只确认声明结算及子任务终态齐全，质量选择回执仍待接线。

最低恢复图在 admission 前预留容量，未结清 child 始终保留至少一个最终对账槽；RRSI writer 同时检查自身 5,000-event 和完整 Ledger 剩余容量。实际 Artifact wrapper 及返回 envelope 在 Ledger append 前检查同一数据上限，拒绝超限而不裁剪分母。容量预留只约束遵循此 History 协议的 writer；其他 Ledger writer 尚无共享容量租约。去重和预算范围也限于同 tenant/goal 的同一权威 Ledger，不能宣称任意新 backend/epoch 已全球闭合。

费用归属目前仅冻结每 child/arm 的 inventory 引用，不验证其实际请求、共享费用 owner、provider/reset profile 或官方账单；native Skill content 与 RRSI aggregate content 保留独立身份，不认证两者的派生关系。已签名预算声明不升级成原生执行证明：`executionEvidenceVerified`、`costEvidenceVerified`、`nativeExecutionDenominatorVerified`、`requestCostGraphVerified` 和 `billingComplete` 均保持 false；不提供 Gate launch、生产预算或晋级授权。

[批次本地验证记录](./evidence/rrsi-native-batch-local-controls-2026-10-07.json) 保存源码/测试摘要、逐文件回归结果与限制。八个相关文件最终 **169/169** 通过；新增 24 项 unit 和 4 项真实进程/迁移用例，覆盖完整分母、非对称费用、不完整计数下界、签名/归属篡改、跨批重放、跨 campaign finalist、旧接口预算绕过、持续 unknown 的恢复槽，以及真实并发、硬退出和 Ledger v2 journal。ESLint、Prettier 和 Astra 只读复核已通过；未执行真实 Actor、付费请求或 A/B/C 实验。

## 12 原生签名登记与准入

[rrsi-cohort-registration.js](../../../packages/cli/src/lib/evolution/rrsi-cohort-registration.js) 从 genuine History 的根登记及已预留批次推导 enrollment 声明。campaign root 固定 Ledger identity、最初登记引用、policy/model/budget/experiment 摘要及全局 query 上限；root 事件身份不随 signer/key 或调用方 stream 改名释放。query stream 由 root digest、全 History selection ordinal 和阶段确定，包含旧 selection 的已消耗额度；generalization 继承被选候选的 ordinal。新候选使用新的确定性子 stream，继续共享同一 History quota 和来源闭包。

既有 [cohort enrollment](../../../packages/cli/src/lib/evolution/evolution-eval-cohort-enrollment.js) 新增静态 RRSI v2 分支，PM v1 保留原签名字节和语义。五字段 SLOT_KEYS 不变，slot 的 `evaluationPlanDigest` 仍为原生矩阵摘要；RRSI 摘要保存在独立 synopsis，不能替代原生计划。签名 manifest 绑定 batch、实际 reservation event/ref/sequence、双臂 reservation digests、完整 sibling cohort 清单，以及 validation/test 对应的完整分区分母。新协议不借用旧 PM test-only denominator，也不接受可注入的 plan verifier。

每个 query 的全部 cohort 必须先登记，才允许第一次 admission。新鲜子任务能力由原 WeakMap 验证，预算派发在 admission 捕获 CAS head 之前完成，并绑定 Gate 提供的 run ID、nonce 和完整 request；两次 `assertOpen` 只读核对 live permit、开放状态、配额及双臂 intent。签名、CAS 或读回失败会保留费用/来源占用并尝试记录 unknown，不能重发能力或回滚成未开始；普通重放被拒绝时不改写先前成功的 intent。恢复得到的 authority 可 resolve/seal，不能 admit。

[Eval Ledger capture](../../../packages/cli/src/lib/evolution/evolution-eval-ledger-capture.js) 捕获真正 v1 原型方法或 branded v2 journal 的 own methods，始终使用同一个 backend.ledger。完整读取显式使用 250,000-event 上限并校验前后 head、epoch 与连续覆盖，修复旧默认 10,000 条截断；同一 native 屏障共享已验证 census，末尾重新核对 head。typed artifact ref 仅复制原 schema/ref/digest 的自有字符串字段，以支持 v2 的 null-prototype JSON，不放宽 rrsi-data。History 预留前和 resolver 使用同一有界合并模板，包含实际 event 引用及最长后续状态；不复制重复的完整 reservation 对象。

本层只认证登记及准入清单，不认证 Actor、生命周期、扰动执行、实际费用和生产预算。完整 runtime 的有效父版本/模式检查、按分类执行单位强制预算、provider/reset profile 和官方账单仍需接入；原生签名行收集与统计 v2 尚未完成。真实 v2 文件日志流程较慢，本地迁移回归使用独立长时限；尚未据此验证生产时延或 Gate 的真实执行窗口。

[登记与准入本地验证记录](./evidence/rrsi-native-enrollment-local-controls-2026-10-07.json) 保存八个源码/测试文件摘要和七文件最终 **282/282** 的逐项结果。联合回归先通过 281 项，真实迁移 v2 用例使用启动时加载的旧 180 秒时限超时；生产源码不变，以当前独立 300 秒时限单独重跑通过，实际用例耗时约 195 秒。记录同时保留初次报告和重跑摘要，不把超时报为通过。本轮新增 14 项用例，覆盖完整历史 census、原生 root/分母、fresh capability、stream 配额、未知派发、迁移/恢复与旧错误契约。ESLint、Prettier 和 Astra 只读复核通过；未执行真实原生 Actor、付费请求或 A/B/C 实验。

## 13 原生 cohort 签名行与有界结果块

[rrsi-native-eval-row-collector.js](../../../packages/cli/src/lib/evolution/rrsi-native-eval-row-collector.js) 使用只读的 RRSI v2 enrollment authority 和原 branded final Eval verifier，不接受调用方指定的 arm、run ID、预期上下文或可替换 verifier。原生计划由冻结上下文重建，摘要与签名 synopsis 比较；suite、policy、variant/source 对应、完整 12 字段上下文，以及 provenanceAudience/trainerAuthority/trainerRevision 从原 plan/cell 推导，runId/runNonce 仅来自真实 sealed admission。原生计划摘要保留原义，训练分区对应派生 Suite，不能从待验回执自供。

每个 cohort 的全部目标按登记顺序提供，即使未准入、缺回执或缺行也保留完整 validation/test 分母。签名终态没有比较行与完整回执缺 sidecar 分开记录；不补零、不制造成功。完整两臂 task × seed 行经原 verifier 重算 signed comparison 后，分别映射回 RRSI 任务和 variant 来源。原 Gate 的 decision、reasonCodes 与 usage 保留；高通过率不能抹掉原 C–A/C–B 拒绝。分块内及本 cohort 各目标之间拒绝 execution、grade、safety、subject binding/reservation 的重复声明，允许不同执行产生同一 output digest。跨 cohort 的执行声明仍需下一层批次 census。

每个 child 的结果块单独遵守原数据限额，cohort 只保存完整 child 索引和摘要，不把完整三角观察复制成超限单文件。冻结 lifecycle、recipe 和双臂 reservation 引用进入块，但不认证其实际执行或费用。live collector/result 通过 WeakMap 品牌捕获，JSON 副本不能凭自身布尔标志获得认证。单 cohort 完整不等于三角批次完整；完整 `allCohortIds` 保留给下一层汇总，`batchTriangleCompletenessVerified:false`。

原 [Eval verifier](../../../packages/cli/src/lib/evolution/evolution-eval-gate.js) 新增仅检查时间的同步接口，复用私有捕获的可信时钟，不暴露 clock port，也不授予签名权限。collector 在全部签名、末尾 seal 审计和结果构造之后，再同步检查整个回执集合，拒绝早先回执在后续验证中到期；64 个目标的有效期窗口独立捕获，不合并完整文档。块保留 issued/expires，live capture 可再次检查当前有效期；历史导出不能被解释为永久有效的当前授权。

此层仍未认证真实 Actor、扰动 recipe、生命周期、底层 execution/grader/safety、来源权威、清理和完整费用，统计协议及晋级标志保持 false。下一层须核对整批全部 sibling cohorts 和底层声明，再聚合每任务内的固定三角重复与目标 strata；本批不执行真实付费模型或 A/B/C 实验。

[原生签名行本地验证记录](./evidence/rrsi-native-row-local-controls-2026-10-07.json) 保存六个源码/测试/fixture 摘要及六文件 **291/291** 的完整联合回归结果。新增 23 项用例使用原 Gate 的测试签名和真实文件 enrollment/admission/seal，覆盖三个目标的完整分母、改写来源、五类已签名重复声明、合法相同输出、无行终态、冻结上下文替换、原 Gate 拒绝、高分、输入捕获和集合时效。原 Gate 191 项及旧映射/统计、variant、native plan/batch 回归保持通过；签名 fixture 不认证真实生产 Actor 或独立来源。ESLint、Prettier 和 Astra 最终只读复核通过；未进行真实模型调用、生产晋级或发行。

## 14 完整原生批次 census 与只读审计

[rrsi-native-batch-evidence.js](../../../packages/cli/src/lib/evolution/rrsi-native-batch-evidence.js) 从 genuine History 的完整 batch.children 重建 cohort、child、target 和双臂分母。未提交的 sibling cohort 与未观察的行保留原计划量；单 cohort 完整不能改写整批完整性。各已呈交 cohort 的 enrollment、seal 和整个 query stream admission 均复验，foreign、legacy、unknown admission 不被 caller 子集隐藏。全部呈交行跨 cohort 检查 execution、grade、safety、subject binding/reservation、runId、runNonce 和 final receipt 声明重用，原 C–A/C–B Gate veto 独立保留。

完整结果仍分块保存，摘要只列索引和分母；live WeakMap 捕获拒绝 JSON 复制及重复 cohort capability。三目标 selection 的本地用例保留 36 个 child、8,640 个原始 Actor 观察；仅一个 main cohort 的 240 行已观察时，另外 8,400 行保持缺失，不能补零或缩减分母。缺预算结算、超支、缺行或缺统计协议均继续 HOLD。

新增 [evolution-eval-readonly-audit.js](../../../packages/cli/src/lib/evolution/evolution-eval-readonly-audit.js) 捕获 genuine v1/v2 journal 的完整冻结事件与五字段 head。短期、authority 绑定的 cohort session 共用这一视图，缓存只在完整 artifact、签名、manifest、enrollment、request、descriptor 和 Ledger event 核验后写入；预构造 registration 复用大 batch 结构，保留原有效输入字节和第一次匹配语义。读取快照不授予执行能力；结果明确是 historical snapshot，必须在外层完成原 journal 的最终 assertUnchanged。head 改变或 verify 报错会永久使该快照失效。PM v1 的原 inventory 路径独立保留。

首次完整 inventory 用例耗时约 656 秒，超过原 360 秒时限；诊断定位到多 cohort、多 admission 重复读取整个 journal 和重建 registration。共享快照及已验证的缓存修正后，独立重跑通过，用例耗时约 124 秒，未提高时限。该本地测量包含测试清单/签名准备，不证明生产时延或长批次 receipt TTL 已达标。

最终检查先复读真实 History root/batch 和 shared head，再用 verifier 私有捕获时钟同步检查有效期。新的窗口接口保留每块 64 窗口和最多 128 块的独立限额；各 verifier 有各自的时间域，不声明共同可信瞬间。无回执时不声称 singleTrustedClockInstant。auditHead 是登记、预算和 inventory 的历史快照；live assertCurrentFreshness 只重查时间，不能冒充当前预算或新的执行授权。

完整 census、快照边界和 PM/native 回归结果见 [本批验证记录](./evidence/rrsi-native-census-local-controls-2026-10-07.json)：九文件完整联合回归 **346/346**，独立只读审计文件 **7/7**，合计 **353/353**，新增 14 项。包括真实 v2 journal、完整超 2 MiB 事件集、复制/异源凭据拒绝、独立 writer 改变 head，以及真实 verify 错误后的永久失效。ESLint、Prettier 和 Astra 接线复核通过。统计 v2 的观察前预注册、真实来源、Actor/recipe/lifecycle、底层执行签名与完整账单仍待接线，真实实验保持 NOT_RUN。

## 15 原生目标分层与三角统计 v2

[rrsi-native-group-statistics.js](../../../packages/cli/src/lib/evolution/rrsi-native-group-statistics.js) 新增独立的 v2 描述性 plan/report。plan 从规范化的完整 batch 和冻结 campaign 重建，绑定 batch、native graph、目标矩阵、版本、生命周期、原来源连通分量与任务权重。每个 partition/variant/target/task/seed/arm 必须保留两个不同 pair 的观察；先平均 pair replicas，再平均 seeds，再按原任务权重和来源 component 求差。B–A 行进入 baseline/rsi 均值，只有 campaign 已登记 B–A 时才增加其比较假设。

targets、seeds 和 replicas 均不增加独立来源组。完整单批、单阶段 family 为 comparison × partition × variant × target；bootstrap 与 Hoeffding 外包络复用原数值 kernel，随机承诺和每项 alpha 来自冻结计划。预检 1,000,000 次 kernel 上限与计入全部 targets 的 50,000,000 总重采样操作上限。默认 10,000 次 bootstrap 在最终 24 项假设时尾部次数不足，保持 HOLD；不能在观察后追加次数。两目标、120 个原来源组、48,000 次最终重采样超过总操作上限，必须在执行前拒绝。

原始观察按 child 分块捕获，不扩大文档限额。缺 chunk、task/seed 行或任何固定 replica 都保留完整分母，相关 task/arm 均值和差值为 null，不生成区间，不补零，也不根据已观察子集重算均值。重复 child、replica slot 或 row result digest，以及 task/partition/seed/arm 替换均拒绝。v2 的 success 定义为签名 reportedPass 且 security/permission violations 均为零；manualRemediationMeasured:false 保留，不能冒充 v1 已测量的无人工补救完成率。

纯 childRows 接口只消费结构声明，所有真实性和质量权限保持 false。live wrapper 只从品牌化的完整 census 取得真实 final-receipt 行块，保留原 C–A/C–B veto、预算 HOLD 和历史 auditHead，在统计计算前后重查有效期。presentedFinalReceiptRowsAuthenticated 与 underlyingExecutionReceiptsReverified 分开；前者不能证明 Actor、grader、recipe、费用或来源真实执行。报告始终 decision:HOLD，preObservationRegistrationVerified:false、statisticalProtocolValidated:false、qualityVerdictVerified:false。

本层数值 family 覆盖同一冻结 batch/stage 的全部 targets，不自动认证多轮 selection 的整体错误率。旧 native reservation 没有观察前统计预注册证据，不能通过新分析器事后改为已注册。下一步增加 scope 首次协议冻结、逐 query/batch 原样 plan 预注册和新版本 reservation，在真实 History 的 lock/load/apply/CAS 中核验严格事件顺序。scope 内的新 campaign 不得重置方法、family、随机承诺和 cap；旧记录的回读、结算与恢复必须保持兼容。

本批结果见 [原生统计验证记录](./evidence/rrsi-native-statistics-local-controls-2026-10-07.json)：两个完整统计文件 **37/37**，真实签名行接线与当前过期拒绝的定向 Gate 用例 **2/2**，合计 **39 项通过**。新增 17 项，并扩展原过期用例；Gate 本次其余 220 项按筛选条件跳过，不作为第二次完整 Gate 运行计数。原 Gate 221 项及 native/legacy source 已在前批 **353/353** 中完整验证，本批未改动这些生产源码。首轮统计专项有一项因测试配置的空扰动列表不符合合同而失败；修正测试配置后完整复测通过，生产校验未放宽。ESLint、Prettier 和 Astra 统计只读复核通过。未进行真实模型调用或 A/B/C 效果实验。

## 16 观察前的耐久统计协议与逐批绑定

[rrsi-native-statistics-protocol.js](../../../packages/cli/src/lib/evolution/rrsi-native-statistics-protocol.js) 将 scope 协议独立于 candidate，直接校验原 dependency lock、runtime manifest 和完整 target matrix。协议冻结整个 campaign scope 投影、三阶段 population/source components/任务权重、targets、方法、两份固定 replicas、alpha/family、bootstrap/随机承诺、minimum groups、stopping rule 和显式 kernel/总操作 cap。原 manifest 的合法 null-prototype 输出先经原校验器生成独立可信副本，再转为可持久化 plain data；未校验的 caller 不经 JSON 序列化，不调用 getter、toJSON 或 Proxy trap。

新增 [rrsi-native-group-statistics-plan.js](../../../packages/cli/src/lib/evolution/rrsi-native-group-statistics-plan.js) 作为无 History/census 依赖的纯 plan 层，避免预注册导入形成循环。原 native statistics 重新导出相同 API。Astra 在搬移前保存八组 v1/v2 plan/report canonical 快照，搬移后逐字节对比一致；原数值方法与 pure plan 的 preObservationRegistrationVerified:false 不变。

真实 History 新增三步：registerNativeStatisticsScope({execution}) → registerNativeStatisticsPlan(nativeBatchInput) → reserveNativeBatchV2(nativeBatchInput)。scope 固定 operation ID 由租户/目标 authority 约束，首次必须在整个作用域任何执行 reservation 之前；已有准备、旧 native、unknown 或零用量结算均不能事后补注册。scope 绑定真实 ledger identity、descriptor 与原 root registration。新 campaign 必须保持同一协议投影，不能更换数据、方法、targets、随机承诺或预算来重置实验。

逐 query 的 registration 自行编译完整 native batch，保留原样 v2 statistics plan，绑定 scope record。新 reservation 在同一次 lock/load/apply/CAS 中复验两个注册，要求真实序列 root < scope < plan < reservation。同内容幂等读取不会重新产生 fresh child；append 已提交但响应丢失仍要求回读，不能重新执行。新 scope 内拒绝旧评测 reservation 降级；旧 scope 的 records、settlement 和恢复路径保持。新记录计入原 5,000-operation、journal 和 native recovery capacity 限额，不增加数据库。

三个新 kind 必须使用各自 canonical operation ID，resolution 取出的 kind/payload 必须就是建立对应状态的记录。新 domain event 的 sourceRefs 与完整引用链复验；仅有正确 Ledger HMAC、recordDigest 或排序不够。真实 v2 backend 的畸形记录测试覆盖非 canonical ID、无关记录占位、重哈希的替换 plan、缺失/替换 sourceRefs 和移植的跨 journal artifact，不能据此生成错误 provenance。

旧 campaign root plan 和 query stream 身份保持；新 reservation 派生 nested cohort plan/manifest v2，加入紧凑注册绑定，逐 cohort 不复制完整统计 population。原 enrollment 外层签名字节仍用现有 v2 域；签名 synopsis、完整声明重建、额外 scope/plan sourceRefs、全部 sibling barrier 和 enrollmentDigest 传递绑定。底层 native request、arm reservation、final receipt 和 settlement 域不变。

原生 row/cohort/batch evidence 使用新的 v2 输出，品牌化 capture 只从 genuine History 取得注册证据；每个已呈交 cohort/child 与同一 scope/plan/reservation 比较，最终 shared head 封口和 receipt 有效期检查保留。live statistics 对新 evidence 输出 report v3，只消除 STATISTICAL_PROTOCOL_NOT_PREREGISTERED；缺行、原 C–A/C–B Gate veto、未知费用、超支和 STATISTICAL_PROTOCOL_UNVALIDATED 均保留。旧 evidence/report 的输出分支与 HOLD 不被回写升级。

controlledHistoryRegistrationOrderVerified:true 仅说明已认证 History 中的注册早于受控 reservation/dispatch；underlyingObservationTimeVerified:false 明确不证明外部实际观察时间。单 batch/stage 的 family 不证明多轮 selection 整体错误率。真实来源、Actor/recipe/lifecycle、生产签发、统计校准、完整费用与清理仍未通过，因此实际实验为 NOT_RUN，qualityVerdictVerified 与晋级权限保持 false。

联合验证已完成：14 个文件 **441/441** 通过，零失败、零跳过；本批新增 71 项，并完整执行原 Gate 与新增预注册分支。逐文件结果与源码摘要见 [耐久预注册验证记录](./evidence/rrsi-native-preregistration-local-controls-2026-10-07.json)。ESLint、Prettier 和 Astra 独立复核通过；原八组 canonical 快照保持一致。验证仅涵盖本地控制与历史接线，不证明真实五池来源、质量、账单或跨平台发行准入。

## 17 下一批工作及完成审计

原生质量 HOLD 回执与耐久记录已接线，详见第 18 节。下一步补齐可验证的质量与统计校准供给，以及 Registry 的持久来源约束。继续完善真实运行权威、全分类硬预算、其他准备操作、实际模型/价格和完整费用证据，以及 Release Train/Review/Pilot/Promotion 的新增必需门。逐轮无收益停止条件须由真实质量回执触发，不能只据结算成功或当前合成分数宣布质量改善。

Astra 的治理复核确认：旧候选冻结只核验结算，不能据此认定质量通过；新预注册分支的拒绝门见第 18 节。候选来源引用与 derivationMode 参与 candidateId，contentDigest 则只由内容字节计算；改变引用、模式或包装可能产生新 ID，因此新增来源约束必须在真正 Registry 存储与写边界按内容摘要查询。来源登记本身不证明质量；旧冻结、普通 callback、相同租户或相同路径都不能授予新晋级权限。新增质量回执须保留原 Gate veto、完整分母与费用缺口，再接入 Release/Review/Pilot/恢复路径。

transaction ports 对真正 v2 journal 的捕获及 Registry/History/backend 关联已接线，详见第 19 节；参与写者的维护排他过渡层见第 20 节。下一增量接入持久 store identity、writer floor 和来源 cutover。现有 `_tenant.json` 的严格 v1 校验同时用于构造、read 和 write；升级 marker 可以拒绝旧 writer，也会拒绝旧二进制的 read。因此后续须让新 reader 兼容旧 candidate/release/state 字节，并准备维护排空与跨存储恢复协议。新增可删除 sidecar、普通 migration audit 或仅凭路径相等均不能建立不可降级来源门；本批未切换任何生产存储。

| 必需条件            | 当前证据                                                                                | 未完成的工程或外部条件                                                      |
| ------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 有效父版本与锚点    | live Registry/预期 Ledger 绑定及 PM 派发重查已实现                                      | 生产权威、锚点稳定/撤销/适用性、晋级 CAS 接线和真实版本清单                 |
| 私有五池与来源      | 内容/声明来源的隔离及双射已实现                                                         | 独立来源审查、权限/缓存隔离、来源权威和真实任务                             |
| 模型/价格/环境/预算 | 冻结合同、预占和签名结算结构已实现                                                      | 目标部署准入、端点/账户/模型认证、官方账单、人工成本                        |
| 全准备操作与恢复    | 六阶段耐久控制，PM broad 和 off/shadow 初步组装                                         | 课程、提议、蒸馏、retry/reset host 接线、受信模式登记和完整账单             |
| 五池真实派发与统计  | 原生三角计划、批次预留、签名登记/准入、cohort 行分块、完整 census、统计 v2 与耐久预注册 | 生产 launch 权威、全部扰动真实执行及正式校准                                |
| 选择/泛化必需回执   | genuine census 派生的 HOLD 回执、耐久快照及新预注册终评拒绝门                           | 真正质量 PASS 的来源/费用/校准供给、逐轮停止条件和锚点回归                  |
| 晋级无降级绕过      | 既有发布门保持原行为                                                                    | RRSI 来源不可剥离、off/shadow/enforced、Review/Pilot/Promotion 必需门及恢复 |
| Workbench 与回滚    | 既有底座可复用                                                                          | RRSI 收益/费用/HOLD 投影、在途终止与清理、有效版本恢复                      |
| 真实 A/B/C 与审计   | 无真实 RRSI 效果样本                                                                    | 新冻结实验、等预算请求全分母、独立未见集、人工审阅和真实观察窗口            |
| CLI 扩展与交付      | 原发行门仍适用                                                                          | PM 达标后的新任务/宿主范围；准确提交跨平台 CI、OIDC 发行与公开回读          |

真实父版本与数据清单的登记独立于合成例子。待受信部署和来源可核验后，以新冻结合同开启真实实验；不把示例摘要重新标为生产身份。

## 18 原生必需质量回执与终评准入

[rrsi-native-quality-receipt.js](../../../packages/cli/src/lib/evolution/rrsi-native-quality-receipt.js) 仅接收真正带有私有品牌的 batch census 与原统计计划，直接重新计算统计报告。selection/generalization 回执分别绑定真实 campaign、candidate/content、三组实际版本、父版本、runtime/target、生命周期、统计预注册、完整行摘要、原 Gate veto、全分母、声明费用与原 History head。外部 report、PASS 标志、verifier callback、caller clock、复制 JSON 和跨 journal 的真正回执不能授予该 live 品牌。

census 新增消费时的严格复验：在同一真正 Ledger、ArtifactPorts 与 resolver 组合中创建全新的只读 audit，并为每个原 cohort authority 创建新 session。重读原始 enrollment、seal、receipt 库存及产物字节，比较原 root/batch/注册/head，前后检查真正 verifier 的有效期。原 session 内的缓存不能代替这次重读；保留原行的所有字段摘要，而非只保存数值分析所用的成功标志。

回执将控制事实与未验证的生产条件分开。来源独立性、真实观察时间、实际 execution receipts、内容派生、arm lifecycle、recipe、请求费用图、完整账单、清理、校准、多轮选择错误率、人工修复和生产父版本回读仍为 false，所有必需 HOLD 原因必须保留。当前 v1 回执固定 decision:HOLD、qualityVerdictVerified:false；不能通过配置或重新计算摘要变成 PASS。

History 的 recordNativeQualityReceipt 在真正私有品牌复验后，通过同步 lock/load/严格 head CAS 保存紧凑快照及真实 scope/plan/reservation 引用。发布和 append 前再次检查有效期；head 变化拒绝新写入，不自动 rebase。canonical operation ID、完整 sourceRefs、实际 applied payload 与紧邻前一 Ledger head 在重放时复验。成功提交后原 census head 已过时；仅同一已提交记录的幂等回读可以恢复，重开的 JSON 投影始终 historicalSnapshotOnly:true、currentReceiptFreshnessVerified:false，不恢复 live 品牌或执行权限。保存 report/census/完整行的摘要不代表已归档或认证所有底层生产证明。

新预注册 scope 的旧 freezeCandidate 不再接受新的冻结请求；freezeNativeCandidateV2 复验真正 selection 回执并返回 QUALITY_HOLD，当前版本不产生质量冻结记录。新的 v2 generalization 预占和 live dispatch 必须有可验证的选择质量准入，当前拒绝。旧冻结、已预留记录、unknown 与 settlement 的历史回读和对账保持兼容；已结算成功和旧冻结意图不能自动升级为新的终评权限。本批尚未实现 Registry/Review/Pilot 的完整来源门，旧发布入口的治理接线仍属 RR-04 后续工作。

本批验证已完成：新增回执 **9/9**、耐久边界 **6/6**、真实签名记录来源对抗 **3/3**，旧 History 与新增恢复联合 **64/64**，两个分支的签名库存损坏与当前过期定向复测 **4/4**，共 **86 项独立用例通过**。新增 22 项，扩展原过期用例两项；Gate 每个定向分支另有 253 项跳过，不作为新一轮完整 Gate 运行计数。首轮组合定向 run 的旧分支两项通过，预注册分支在套件级别失败而未执行目标用例；JSON reporter 未保存嵌套 hook 的错误详情。两个分支随后独立复测全部通过，未放宽验证器或任何时限。ESLint、Prettier 与 Astra 复核通过，摘要见 [必需质量回执验证记录](./evidence/rrsi-native-quality-local-controls-2026-10-07.json)。after-head 用例验证 v1 文件 Ledger 的真实已提交响应丢失；旧冻结用例追加经过认证的历史字节。它们不证明 v2 断电、实际费用/清理或运行过旧二进制。

## 19 Registry、History 与真实 backend 的关联

[evolution-ledger-ports.js](../../../packages/cli/src/lib/evolution/evolution-ledger-ports.js) 的 release transaction、audit 和 nonce ports 现在同时捕获原 v1 Ledger 与真正品牌化 v2 journal。所有消费端使用同一组原方法，operation reader 精确比较 journal 和 ArtifactPorts 对象，并从原 verify 取得 current context。v2 的成功仍要求完整留存回读；WAL 已提交但留存失败继续抛出 COMMIT_UNKNOWN，不能按旧 v1 响应丢失路径提前成功。旧 receipt 可以按原语义验证，已完成 cutover 的旧 writer 仍被原持久屏障拒绝。

v2 journal 对真实 migration source 捕获原 Ledger 私有字段方法和物理路径 getter，避免真实子类的覆写路径、query 或 verify 替换数据。findByEventId、recoverReceipt 与 getAuthority 改用原 query/verify，消除这些原方法内部的虚调用。原 ArtifactPorts 方法和 Registry transaction 方法以 Reflect.apply 调用，不读取 caller 可修改的函数 bind/call 属性。

Release Registry 的 readRelease、readState、readActive、readInventory 改为公开包装与私有实现；构造恢复、迁移、finalization、pins 及 transition 内部均走私有读取。可信 reader 继续拒绝 subclass、复制和 Proxy，不放宽原 exact prototype 边界。Astra 首次指出 subclass 能绕过父版本 freshness 的结论在复查后已纠正：原 capture 入口就拒绝 subclass；此次修复封闭的是内部恢复/原方法的虚调用与函数属性捕获。没有据此声称旧父版本绑定曾可经 subclass 绕过。

[rrsi-registry-history-binding.js](../../../packages/cli/src/lib/evolution/rrsi-registry-history-binding.js) 仅从真实 backend、History、Registry 与 transaction ports 创建私有品牌。backend 和 resolver 的私有构造元数据比较原 journal、原 ArtifactPorts 和原 resolver，描述符相同或同物理路径新开的对象不能替代。绑定前后重查真实 History root、ledger identity、Registry 目录/marker 和 current head；正常无关事件推进 head 可以继续，root 或存储图改变拒绝。v2 verify 可能恢复已获授权的 WAL 后缀，因此这是可恢复的回读控制，不能宣称无写入快照或共同原子瞬间。

新 effective parent binding v2 保留原 parent/content/revision、anchor 与 drift 检查，再关联上述存储图。PM runtime 绑定时比较它实际捕获的 History，拒绝另一真实 backend 上的相同 campaign；后续 reserve 和实际 host 调用前复验原存储图和父版本。Workbench 将真实 primary/verifier backend 保存在私有 WeakMap，供关联验证使用，原公开 runtimeResources 与 mutationPorts 字段不变。

所有新增输出仍为 originCutoverAuthenticated:false、registryStoreIdentityAuthenticated:false、originClassificationAvailable:false、productionAuthorityVerified:false；不授予晋级或 enforced 权限。它们只证明当前组合中的对象与存储关联，尚不证明永久来源约束、受信模式登记、生产权威、旧稳定版本豁免或跨存储 cutover。后续必须在真正候选公开前按 tenant＋实际 contentDigest 登记来源，在 Release transition lease 内再次核验，并将 writer floor、prepared/markers-installed/committed 恢复与真实维护排空接入两个 Registry。可删除的 sidecar 和 quiescent:true 声明不能替代该边界。

本批验证已完成：新增关联与 v2 端口两个完整文件 **22/22**，八个旧行为/恢复文件 **148 项通过**，合计 **170 项通过**、零失败。ArtifactPorts 原有 file-symlink 用例使用 runIf(process.platform !== "win32")，在本机 Windows 跳过 1 项；没有新增 skip。覆盖真实 promotion/rollback/reopen、留存服务故障后的 unknown、已提交旧 receipt、旧 writer 屏障、真实 source 子类与路径覆写、同物理路径对象替换、marker/载荷损坏、同 History PM 派发与回滚后拒绝，以及真实 PM 进程退出/重开。

新增 22 项，扩展原 Workbench 独立 reader 用例。首轮关联文件 11 项通过、3 项失败：两项测试错误地假设 subclass reader 可被捕获、已冻结的 transaction 函数可安装属性，第三项受属性安装失败后的清理遗漏影响。保持原可信类型边界，纠正这些测试，并将安装和清理置于 try/finally 后完整复测通过；未放宽生产校验或任何既有时限。该 subclass 用例在已提交的真实存储上构造并走原恢复入口，不声称它独立覆盖 pending-journal 故障；原 Registry 和 v2 Journal 的完整恢复套件另外验证该类故障。ESLint、Prettier 与 Astra 最终复核通过，逐文件结果、源码摘要、首轮错误与平台跳过原因见 [存储关联验证记录](./evidence/rrsi-registry-history-local-controls-2026-10-07.json)。全部证据为本地控制，不替代真实来源、费用、统计校准、生产晋级或准确提交的跨平台发行门。

## 20 参与写者的维护排他与异步事务

[with-file-lock.js](../../../packages/cli/src/lib/with-file-lock.js) 新增 withFileLockAsync，复用原获取、确认死亡后的回收与释放算法；同步接口的等待、异常优先级和提前 handoff 语义保留。异步等待让出事件循环，锁一直持有到 callback 完成或拒绝后，才执行共享清理。异步 context 不发布提前 handoff，避免 callback 仍在运行时让 contender 进入。新的 assertOwnership 复验原 directory identity、owner PID/start/token 与 release marker；失效或 callback 生命周期结束后拒绝，不暴露 token。

[skill-registry-writer-control.js](../../../packages/cli/src/lib/evolution/skill-registry-writer-control.js) 将真实 Registry 构造、候选 create/单项与批量 migration、Release migration、整段 applyTransition，以及独立 legacy journal archive 接入严格参与者锁。锁目标是 canonical tenant/root 的固定 sibling，既有 marker/artifact/state 字节和严格 tenant root inventory 不变。同进程重入立即 BUSY，避免同步等待阻塞异步 owner；迁移调用内部 private 写方法，不能公开继承锁令牌。Release 的初始产物公开、所有 await、heartbeat、错误恢复与清理均在同一写锁区间，原 Skill lease、CAS 和 Ledger 验证继续使用。

[skill-registry-maintenance.js](../../../packages/cli/src/lib/evolution/skill-registry-maintenance.js) 只捕获真实 candidate/release Registry 的原构造控制，核验同一租户与独立目录，按 canonical key 顺序持有两个锁。维护 callback 期间拒绝新参与写者，已有 reader 保留原字节回读；第二锁失败、callback 拒绝或进程退出均有恢复路径。callback 结束后旧 context 的 assertCurrent 失效。该排他只覆盖已实现本协议的写者：preTransitionBinaryWritersExcluded、persistentStoreIdentityAuthenticated、originCutoverAuthenticated 和晋级资格始终 false，不能以维护锁或 quiescent:true 声明认证旧二进制已排空。

构造函数初始捕获已有目录时仅校验身份与拓扑，获取写锁后按 base→tenants→root 修复权限，继续比较原 path/dev:ino，不用硬化结果覆盖旧基准。缺失的 bootstrap 目录仍可能先创建；其它租户可在自己的锁内硬化共享祖先。因此本层保护本租户 marker/artifact/recovery 的写区间，不宣称所有构造期、跨租户或管理员 mount 元数据排他。原文件身份检查本身也不是 OS 排他锁；旧 writer 仍可能在 check/link 之间跨过首次切换点。

独立 archive 在公开 link 与 source unlink 前再次复验 ownership；回调或其它操作替换锁后停止公开/退休，清理只关闭自有 descriptor，并保留私有 temporary debris。原恢复行为、旧 schema 的读取和既有 mutation validator 不放宽。Registry 以外的 History/授权审计写者没有被该双锁排空；下一步仍需 authenticated History policy、持久 storeId/writer floor、prepared→markers-installed→committed 双存储恢复，以及真正的旧部署排空条件，之后才能把永久 contentDigest 来源查询放到候选公开和晋级 lease 边界。

验证共 **185 项独立用例通过**，零失败、零跳过：原同步锁与新异步锁完整 **50/50**；补强后的六文件 **101/101**，包含真实 Windows ACL 及独立权限检查；未受后续 secure/归档补强影响的 v1/v2 ports 与 Registry/History 三文件 **34/34**。新增 21 项，扩展原同步 ownership 断言和 legacy archive 的两个 owner-token 替换场景。原先完整组合 run 为 124 项通过、1 项失败：child fixture 的 rollback operationId 含空格，被原请求校验器在写边界之前拒绝；改成合法 test:child:rollback:id 后独立进程完整复测通过，未放宽任何校验、skip 或时限。

新用例直接验证另一个进程中已打开的 candidate/rollback writer 在维护期间不能写入、维护 owner 活着时不能回收，以及 SIGKILL 确认退出后回收两个原锁。ACL mock 的调用排他与真实 Windows 权限检查分别记录；真实权限不证明模型/来源/账单或生产权威。ESLint、Prettier 与 Astra 最终复核通过，逐文件结果、源码摘要和首次用例错误见 [参与写者验证记录](./evidence/rrsi-registry-writer-local-controls-2026-10-07.json)。本批没有安装永久来源索引或新 marker，也未完成生产 cutover、enforced、Review/Pilot/Promotion 必需门或真实效果试验。

## 21 新存储的前置登记与配对标记

[rrsi-registry-store-policy.js](../../../packages/cli/src/lib/evolution/rrsi-registry-store-policy.js) 在构造 Registry 之前捕获真正的 v2 backend、原 journal、ArtifactPorts 与原 resolver，逐项核验 tenant/artifact tenant/audience/purpose，不依赖已构造的 v1 Registry 或 campaign root。新的专用 store-policy artifact 使用 Ledger retention，并由原 resolver 回读真实 canonical wrapper；独立 domain event 保存 prepared→markers-installed→committed 三个阶段。完整连续日志重放检查阶段、确定性事件 ID、前驱记录与产物引用、原 journal identity 和紧邻的 observed head，写入使用 head/sequence CAS。

调用者仅提供已有绝对父目录和 operation ID；创建前及恢复时只读检查父目录身份和 owner-only 权限，不自动修复调用者目录。模块生成随机 namespace 与两个 store ID，通过非递归 mkdir 创建全新候选、发布目录；拒绝嵌套进已知 Ledger、Registry 或 pair namespace。既有根、空目录声明、quiescent:true、caller RNG 或旧存储升级均不是入口。准备记录固定物理目录身份和来源策略，两个 v2 marker 绑定 tenant、store/peer、原 journal identity、operation、epoch、writer floor=2、策略与准备摘要，通过单次原子 hardlink 公开，不覆盖旧初始化器抢先安装的 v1 marker。mkdir、ACL 修改、临时文件写入、link 和 unlink 前均复验实际锁及目录身份；失锁后保留 debris，不修改新 owner 的文件。

committed 仅表示新物理存储配对创建已认证，并不表示来源切换或业务准入完成。本节提交时，Registry 的 v1 marker 构造入口拒绝这些 v2 marker，尚未接入可用的 v2 Registry reader/writer、永久 tenant＋contentDigest 来源索引、候选 alias finalize、晋级 lease 内来源复验或 Review/Pilot/Promotion 必需门。仅凭这一层不能阻止“删除 marker 后尝试 v1 初始化”；后续第 22 节已接入当前构造入口的保留 namespace 与真正 policy binding，业务准入仍待完成。

恢复只认同一准备记录、原目录及预期 marker 字节。prepared-only 时两端预期 v2 marker 均以单链接存在，可建立首次 marker 身份证明并补记后续阶段；这不能证明首次身份登记前未发生同字节替换。已有 markers-installed 认证身份后，同字节 marker 更换 inode 亦 HOLD。任一 marker 缺失、未知临时文件、双链接残留或目录身份变化都拒绝恢复，不重新生成 ID、不修复缺失 marker、不删除另一端。准备记录之前失败的目录保留为 orphan，不扫描接管或递归清理。提交响应丢失仅允许按原操作回读恢复；off 或换 backend 不产生来源豁免。

bootstrapDirectoryFsyncVerified 仅记录创建目录项时的实际刷新结果；markerDirectoryFsyncAttested 保持 false，不将 Node 在 Windows 上无法刷新目录的情况改写为成功。文件 fsync、认证日志及回读检查均不代替真实断电、生产密钥保管或 WORM 证明。legacyWriterDrainVerified、originCutoverAuthenticated、originClassificationAvailable、productionAuthorityVerified、业务写权限与晋级资格继续为 false。既有 v1 升级仍需持续有效的原生旧写者排除能力；已有 cgroup、Job、宿主 lease 和本批维护锁都不覆盖全部历史写者。

本批本地验证共有 **98 项不同用例取得通过结果**：新增最终单元行为 **25 项**、真实子进程 **3 项**，既有 ArtifactPorts **42 项**、v2 journal **14 项**和 Registry/History 关联 **14 项**。ArtifactPorts 原有 Windows 条件 symlink 用例跳过 1 项；没有新增平台 skip。受影响用例按原门槛分批复测，不宣称最终一次完整组合 run 全绿；定向选择未执行的其它用例不计为新的平台跳过。

初轮新单元 **15/15**；既有回归曾为 69 项通过、1 项失败及 1 项原有跳过，失败来自固定 retention 白名单期望缺少本批合法类型，补上精确一项后完整文件 **42/42** 通过。后续原生组合 **16/23** 通过：包含 helper 启动失败、未保留原生细节的 parent HOLD、三个原 60 秒超时被 Vitest 的 STACK_TRACE_ERROR 报告问题掩盖，以及 v1 竞争断言吞掉前置错误后的次生异常。加强 ownership 观察的定向 run 为 3 项通过、1 项 fixture 初始化失败。串行受影响用例 6/8 通过，剩余两个复合用例仅超原时限；去重后的复测亦有这两个超时，未放宽检查或时限。

Astra 参与诊断、实现复核和测试拆分。两个复合用例拆为六项独立行为，保留全部断言；真实 backend 初始化、真实 provisioning 两个准备操作各自保持 60 秒预算，回读用例也各 60 秒。共享 fixture 生命周期明确，不依赖某个测试先执行。先前合并 setup 的 beforeAll 超时使五项未执行，不算通过；拆分后五项回读全部通过。新 ancestry 回归在真正权限检查之后、同 inode 下插入 Registry 标记，确认没有 namespace 或日志写入。v1 竞争现在要求真实 EEXIST 和已注入的 winner；ownership 观察原生权限修改调用，失锁后为零。提交前 ESLint、Prettier 与 Astra 复核通过，六个改动源码/测试文件的摘要和逐次结果见 [新存储初始化验证记录](./evidence/rrsi-registry-store-policy-local-controls-2026-10-07.json)。这些证据不替代生产来源、旧写者排空、真实效果试验或发行矩阵。

## 22 真正 v2 Registry 绑定与未初始化回读

[rrsi-registry-store-policy.js](../../../packages/cli/src/lib/evolution/rrsi-registry-store-policy.js) 增加只由原 policy 对象签发的 component binding，固定 operation、component、tenant、store/peer、物理根、原 journal identity 和 committed record。Registry 通过 WeakMap 捕获真正绑定，拒绝复制、序列化、proxy、accessor、错组件、错 tenant、错路径、自定义 filesystem、非 secure 选项和 subclass。Release 在访问调用方 transaction 方法之前验证真正的 operation reader，要求同一原 journal 和 ArtifactPorts，并精确比较 adapter 私有字段导出的 artifact tenant、显式 audience 和 purpose；同对象但错 scope 或省略 audience 的真正端口亦 HOLD。仅摘要相同、复制方法或调用方自报 scope 不是原对象。

当前 [候选 Registry](../../../packages/cli/src/lib/evolution/skill-candidate-registry.js) 和 [发布 Registry](../../../packages/cli/src/lib/evolution/skill-release-registry.js) 在任何 mkdir、ACL 修复、marker 初始化和 writer lock 之前拒绝无绑定的 `pair.<UUID>` 保留路径，也检查已有父路径的原生 realpath，关闭删除 marker 后从物理别名尝试 v1 初始化的入口。bound 模式使用已认证的七个目录和两枚 v2 marker，构造不创建缺失路径、不修复权限、不创建 Release 的六个运行目录、不执行事务恢复或残留清理。重新打开还会实时原生检查 provisioning parent 的 owner-only 权限，不把旧绑定当作权限缓存。此限制约束本版入口，不表示所有历史 CLI、desktop 或已继承句柄的旧写者已排空。

无绑定的目录 helper 在修改前捕获最近已有祖先及剩余路径的 canonical 目标，mkdir 前复验、得到真实 canonical 后再次拒绝保留 namespace 并核对原目标；捕获 base 后及私有 marker／写入／恢复入口继续复验。当前 v1 实例的公开目录 helper、subclass 返回保留 canonical base，以及前检后将已有／缺失 base 的祖先换成指向 pair 的 junction/symlink 均被拒绝；反例确认注入确实发生、未执行 Registry mkdir，配对树身份和字节不变。它不承诺在任意外部修改时刻提供跨目录原子保护。

空布局与不可变目录／marker 边界已分开校验；由于尚无来源或运行目录认证关联，本批回读仍要求两端完整 marker-only 布局。候选返回真实空 inventory 或既有 NOT_FOUND；Release 私有模式固定为未初始化，返回空 inventory、revision=0 的初始 state、无 active release。它不会把任意 ENOENT、部分运行目录或未知 JSON 当成正常空存储。读取时重新验证完整 policy 历史、原目录及两端 marker；认证边界缺失和同内容 inode 替换均为 HOLD，并保留原 cause，不包装成普通候选不存在。出现业务内容、运行目录、待恢复 journal 或 debris 均保留现场且 HOLD，不自动切换运行模式。

公开 create、transition 和所有 legacy migration 在获取 writer lock、执行准入回调或消费一次性 transition capability 之前 HOLD，私有写入、发布、lease、prepare/finalize、pointer、恢复和 cleanup 入口再次阻断。公开 candidate bootstrap helper 只验证已有绑定路径，不能补建 v1 marker 或新目录；真正只读实例不提供 writer control。这些控制不伪造来源分类，writer floor=2 也不代表业务写权限。

绑定回读不使用 store-policy operation lock，不产生 Registry/policy namespace 写入；原 v2 journal 的 verify/read 仍按既有协议获取自身维护锁并可能恢复已授权 WAL。manifest backend 的 read/readEvents 本身亦可能修复 checkpoint，因此没有将它们改作未经设计的“无恢复快照”。本批不承诺整个 backend 读取零写入。provisioning policy v1 和 marker 摘要保持原值；originCutoverAuthenticated、originClassificationAvailable、生产权威、写权限与晋级资格继续为 false。

本批最终共有 **152 项不同用例通过**：新增单元 **34 项**、真实子进程 **4 项**，完整 Candidate **31 项**、Release **44 项**、Registry/History **14 项**，Ledger ports v1 **12 项**、v2 **8 项**，以及 store-policy containment 定向 **5 项**。最终 namespace／Registry 组合 **127/127** 通过，随后 ports **20/20**、containment **5/5** 通过；containment 的其余 20 项按名称过滤未执行，不算新的平台 skip。九个源码／测试文件及其摘要、逐次结果见 [v2 Registry 只读接入验证记录](./evidence/rrsi-registry-read-only-local-controls-2026-10-07.json)。未运行 Linux/macOS 的工作流矩阵，不把这些本地控制作为正式效果试验或发行验证。

初轮观察器错误地把原 journal 的维护锁计为 Registry 写入，结果为 10 项通过、15 项失败；随后两轮为 28/30、118/120，剩余两项同样来自观察器漏掉原 source journal 的 `ledger-v2.lock` 清理。定向诊断捕获了真实 `authority/ledger-v2.lock.release-*` 路径，最终仅精确放行同 authority 下的 source 与 manifest-cutover 锁族，没有放宽整片 authority 或 Registry/policy namespace。原生 ACL 观察同时覆盖 JSON 批量与 args 单路径 repair；Buffer 路径兼容不被宣称为上述失败的实际原因。Astra 又发现最后六个反例误放在旧测试回调内，已仅停止经 PID/命令核对的自有 runner/worker，移至 describe 层后重新收集并完整重跑，中断不计通过证据。原生预算和校验器未放宽。

提交前 ESLint、Prettier 与 Astra 只读复核通过；所有先前发现已落实到代码与反例。下一批实施独立认证的运行目录初始化与 tenant＋真实 UTF-8 contentDigest 来源关联，再接候选 alias、发布事务与恢复的来源准入；本批仍不表示整个 RRSI 已完成。
