# ChainlessChain RRSI 实施进度

日期：2026-10-07。承接 [RRSI 实施方案](./rrsi-implementation-plan-2026-10-07.md)。工程基线为 `1de6f0f8d052eb1186a06ce6d30d0aa2dfffe85b`，初始实施分支为 `feature/rrsi-foundation-2026-10-07`。本轮新增文件的摘要及离线结果见 [合成回放记录](./evidence/rrsi-rr01-synthetic-replay-2026-10-07.json)。

2026-10-18 续做及默认管理接口索引有界回读见[第 32 节](#32-默认管理接口索引的有界回读)。

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

## 23 空运行目录的独立认证初始化

[rrsi-registry-runtime-policy.js](../../../packages/cli/src/lib/evolution/rrsi-registry-runtime-policy.js) 仅接收原真正 store-policy、v2 backend、ArtifactPorts 和 resolver，关联既有 committed provisioning 摘要与同一 journal identity。专用 `skill-registry-runtime-policy` artifact 保留在原 Ledger；`rrsi.registry-runtime.initialized` 事件保存 prepared、六个依次 installed 阶段及 committed，共八条不同的确定性事件。重放检查完整连续日志、scope、顺序、前驱 ref/digest、observed head、原配对准备记录和 canonical retention 回读，拒绝额外第九条同类事件。

六个 Release 运行目录由非递归 mkdir 创建，记录实际 path/dev:ino 和目录项 fsync 结果。创建和原生 ACL 修复前、artifact 发布前、事件 CAS 前均复验本次维护锁归属；权限检查前后复验目录身份。只允许已登记前缀完整有效、未登记后缀全部不存在的恢复。mkdir 已成功而 installed 尚未持久化时，目录留在原处并永久 HOLD，不扫描采纳、不删除、不用新的身份覆盖。已登记目录缺失、被替换、含未知业务或恢复内容时亦 HOLD，不补建或 cleanup。initialize/recover 的 ENOENT、ENOTDIR 映射为精确 HOLD 并保留 cause；committed 幂等恢复仍只读检查父目录、原七目录和六个运行目录的实时私有权限，不修复调用者或已登记路径。

为避免每次物理检查重新解析同一完整日志，store-policy 的内部 capture 仅在本次 runtime state 生命周期内保存认证快照。其无参数 recheck 闭包固定原 head，并复验原七个目录、双 marker 字节和身份、原 journal 的完整五字段 head；调用者不能替换快照或静默重基。每次公开操作起点和每次追加后仍重新完整认证两类历史与引用产物。它不持续证明缓存期间 artifact 的实时可用性，后续完整 capture 才重新解析；也不提供跨文件原子快照。原 journal 的合法维护锁和 WAL/checkpoint 恢复继续采用既有协议。

Registry 必须显式接收同原 policy 的真正 runtime attachment；复制、跨 policy、错 backend/ports/resolver 或 accessor/proxy 组合不能取得品牌。旧绑定不会自动升级，无 attachment 时仍要求 marker-only 布局。Release 的私有模式为 `authenticated-empty-read-only`，使用认证的六目录但仅返回空 inventory、revision=0 和既有 NOT_FOUND；构造仍不创建 writer control、不恢复事务、不清理现场。公开及私有业务写入、迁移、lease、finalization、来源准入和晋级继续 HOLD。

既有 ORIGIN_POLICY、provisioning/marker 的不可变摘要与 writer floor 保持原值；originCutoverAuthenticated、originClassificationAvailable、legacyWriterDrainVerified、productionAuthorityVerified、业务写权限和晋级资格继续为 false。Windows 不支持的目录 fsync 如实记录 false。内部维护入口仅供模块自己的可信同步闭包使用，执行后的 Promise 检查不是外部异步代码的撤销或 sandbox 能力；已经进入原生 helper 或原 journal 的操作亦不能靠后检撤销。本层仍不证明真实断电耐久性、生产密钥保管或历史二进制全部排空。

本批已取得 **248 项不同用例的通过结果**：新增 runtime 单元 **18 项**、真实子进程 **16 项**，八个既有 Registry／History／ArtifactPorts／Ledger ports 文件 **189 项**，以及 store-policy **25 项**。store-policy 的通过结果来自完整运行的 22 项、原生独立复测的 1 项和分阶段恢复复测的 2 项；不宣称旧九文件组合或最后一次 store-policy 完整文件全绿。ArtifactPorts 保留原有 Windows symlink 条件跳过 1 项；定向选择未执行的用例不算新增平台 skip。观察器最终四项复测 **4/4** 通过，其余 12 项按名称过滤；重复行为不会增加上述独立用例计数。

最初 genuine ref 的自定义 prototype 导致初始化失败，改为读取原对象自己的数据描述符后保留其严格限制。随后两轮初始化 hook 的 60 秒聚合超时，11 项用例均未执行，不计通过；同 head 捕获减少重复历史解析后，八阶段完整操作仍需更长的聚合期限。后续原生组合为 29 项通过、5 项失败，包含聚合期限、冻结 prototype spy、两个合并子进程 watchdog 和 parent 权限 HOLD 诊断缺失；调整独立观察边界、真实 artifact 树断言及 cause 保留后，新两个完整文件 **34/34** 通过。初始化 hook 与进程外层为 180 秒，child watchdog 为 170 秒；单独 runtime read 仍为 60 秒，原生 ACL helper 的默认 15／30 秒预算和全部校验未改。

旧九文件回归曾为 208 项通过、6 项失败和 1 项原有跳过；失败集中在 store-policy，五项为原 60 秒复合用例超时，另一个 parent 用例为原生 ACL timeout-startup，不能改称聚合超时。拆分真实 fixture、provisioning、reopen 等准备阶段后，定向结果为 6 项通过、1 项诊断字段断言失败、18 项名称过滤未执行；修正 batch 中不存在的 ownerOnly 断言后，完整 store-policy 为 **22/25**。三项失败均含原生 ACL startup 错误：phase 2 在 manifest fixture 失败，prepared response-loss 在 parent fixture 失败；phase 3 已进入 provisionFresh，报告不能排除此前写入，也未保留原错误堆栈和 fired 状态。phase 3 实际同步阻塞 323.8 秒，虽然仍配置 60 秒，测试计时器不能及时中断。

三项原生独立复测取得 1 项通过、2 项失败：prepared response-loss 通过；phase 2 再次 ACL 启动失败，实际 112.8 秒；phase 3 为 60 秒聚合超时，实际 66.9 秒。最后两项仅将 fixture、预期 after-head 中断及同目录 backend reopen 分为三个独立 60 秒 hook，恢复行为仍独立 60 秒，所有原 head／fired／目录／committed／三事件／幂等断言保留；最终 **2/2** 通过。此举分开准备和行为预算，并非保留一个端到端 60 秒总期限；没有放宽原生 helper。沙箱外复测亦出现 startup 错误，不能据此确认沙箱为根因。原失败结果、实际耗时及九个最终源码／测试文件摘要见 [运行目录验证记录](./evidence/rrsi-registry-runtime-local-controls-2026-10-07.json)，原 reporter 文件继续保留在本地 .work 中。原生完整运行后的 fixture 仅改两处空值诊断访问；两项恢复测试拆分区间外的源码与前置备份逐字节一致，未重写旧通过项。提交前 ESLint、Prettier 和 Astra 复核通过；未运行 Linux/macOS 发行矩阵，亦未进行真实付费 A/B/C 实验或生产晋级。

下一步仍需 tenant＋真实 UTF-8 Skill text digest 的永久来源登记，明确它与 RRSI aggregate manifest digest 的不同语义；之后接入候选 alias、发布事务与恢复、Review/Pilot/Promotion 必需来源门。完整 RRSI、真实 A/B/C 试验和生产组装尚未完成。

Astra 的下一层只读设计复核确认：Registry 文本摘要不裁剪、不统一换行；新证据需区分 skillTextDigest、rrsiManifestDigest、rrsiCandidateDigest 和 candidateId。现有 native History 仍为 nativeContentDerivationVerified:false、sourceProvenanceVerified:false，不能仅凭真正 History 品牌把内容声明升级为来源证明。真实生成／准备边界、原文 UTF-8 往返一致性、BOM/CRLF/Unicode，以及登记后公开前／alias finalize 前的未知窗口，均需在后续实施中明确；本节没有实现或授予这些能力。

来源文本的有界存储还需同时满足 RRSI 单字符串最多 8192 个 JavaScript code unit，以及 ArtifactPorts 整份 canonical record 最多 1 MiB 的两处独立限额。最大 1 MiB 原文直接装入 JSON/base64 artifact 会因编码与元数据开销超过后者；后续采用独立 retained text manifest 与有限数量、有限大小的 chunk 引用，并以重建的实际原文 UTF-8 bytes 计算 skillTextDigest，不提高既有限额。当前 PM 签名执行 payload 仅含 memory／trace 摘要，learning 的签名 synthesis receipt 证明评估而非 RRSI 文本生成来源；二者均不能直接升级成来源权威。

## 24 确切文本留存与固定存储图内的限制日志

[rrsi-observed-text-index.js](../../../packages/cli/src/lib/evolution/rrsi-observed-text-index.js) 捕获原真正 store-policy、v2 backend、ArtifactPorts 和 resolver，不接收调用方指定的 namespace、root、tenant、摘要、来源类别或 signer。索引 ID 只从 tenant 派生，主键为 tenant＋实际 UTF-8 skillTextDigest；目标、campaign、候选名称与 alias 不参与主键。另一套真正 backend 仍可使用同 tenant 创建自己的本地日志，因此本层仅固定捕获的存储图，tenantWideIndexAuthorityVerified 始终 false。全租户唯一路由、删除后重建与迁移承接必须由后续独立部署锚认证，不能借真正 backend 品牌宣称已经完成。

原文由模块严格编码并计算 SHA256，不裁剪、不统一换行、不做 Unicode normalize。保留 BOM、CRLF、组合字符与补充平面 Unicode；拒绝孤立 surrogate、空文本和超过 1 MiB 的输入。先检查 primitive string、code unit 数和 UTF-8 byteLength，再分配 Buffer；过长字符串不会先分配额外副本，多字节文本不能绕过实际字节上限。每块最多 64 KiB，最多 16 块；三个专用 Ledger retention 类型分别保存 chunk、manifest 和限制事件。大 base64 字符串采用单独的有界解析器，核对规范重编码、实际块长和块摘要；小 manifest 使用既有 RRSI envelope 限额。逐块拼接后核对完整原文长度、整文 SHA 和严格 UTF-8 往返，不提高既有 8192 code unit／1 MiB canonical record 限额。

registerObservedSkillText 仅接受真实文本、原 History adapter、preparation execution ID 和有限的禁止项。History 的 captured resolvePreparation 在完整语义重放后返回真实 reservation 与登记 ref／digest／sequence；索引检查原 journal、ports／resolver、tenant／artifact scope，以及 candidate-proposal phase。第一次登记依赖这个真正只读解析器；重开时独立认证同 goal 的声明 envelope 链、descriptor、tenant＋goal scope、唯一 operation ID、事件 ID／时间戳、原 journal 和前驱摘要，要求目标声明先于文本事件且 sourceRefs 为空。回执只称 preparationDeclarationRetained，不把历史声明当成当前预算、执行、结算或因果生成证明；不持久化无法独立复算的 reservationDigest 字段。

observedBytesAuthenticated:true 的含义固定为 authenticated-retained-readback：这些确切字节已签名留存并经过真实 resolver 读回。文本仍由调用者提供，尚无 RRSI producer 输入到输出的证明；generationProvenanceVerified、sourceDerivationVerified 和全租户权威保持 false，结果始终 HOLD。generation-unverified 和 rrsi-evidence-required 两项禁止必需保留，其余 source-conflict、cross-pool-exposure、publication-incomplete 只能累加。相同原文跨 goal 的声明引用追加到同一项，限制取并集；没有 ordinary、nonRrsi、off 或手工导入豁免，也没有产生允许范围的接口。

在原 policy 维护锁内完整重放最多 256 条限制事件；每个 chunk／manifest／event 发布前复验锁归属与固定原 head，CAS 追加后按本次 operationId 精确核对 recordDigest。相同观察幂等，不重复发布；新限制不会因原观察重试而消失。缺块、畸形 base64／长度／UTF-8、声明或存储图变化、日志超容量均 HOLD 并保留 cause；提交响应丢失返回 commit unknown，已有记录与孤立产物保留，不回滚删除。已经进入 ArtifactPorts 的发布不能靠后检撤销；本层不承诺跨文件原子快照或物理断电证明。

本批没有接入候选发布前的 alias preparation／finalization、Registry 业务布局与写者、Release lease／prepare／finalize／recovery 的来源门，旧 marker／ORIGIN_POLICY 与来源 cutover 的 false 均不改写。后续先增加可信部署锚与实际 producer 回执，再完成永久限制索引的生产路由和 alias 窗口；限制记录本身不能解除第 23 节的 empty runtime 或 mutation HOLD。

本批最终共有 **135 项不同用例通过**：最终编码／原生单元 **16 项**、集成控制 **8 项**，以及四个完整既有回归文件 **111 项**（ArtifactPorts **42**、History **25**、preparation **30**、Registry／History binding **14**）。ArtifactPorts 保留原有 Windows 文件 symlink 用例跳过 1 项；新增 24 项无跳过。第一轮 7 项纯编码通过，8 项原生行为因初始化失败未执行；原因是索引回读漏掉 Ledger 对 sourceRefs 的 ref／digest 排序，已按原规范比较完整排序数组，未放宽引用校验。后续新增 20/20，通过增加三个 signed malformed 反例后的六文件组合为 **134 项通过＋1 项原有跳过**。

该组合终态后，仅增加新 index 的分配前大小检查、一个 Buffer 分配边界反例，并将三个畸形内容用例收紧为精确 base64／长度错误或 ERR_ENCODING_INVALID_ENCODED_DATA cause。最终两个新文件完整 **24/24** 通过；四个旧回归文件不导入新 index，原 111 项继续计为独立证据，不宣称最后一次精确源码同时完整运行过六个文件。八个最终源码／测试摘要、两次保留的源码快照、三处严格限定的修改区间及各轮 reporter 结果见 [文本观察与限制验证记录](./evidence/rrsi-observed-text-local-controls-2026-10-07.json)。失锁注入在首次 owner 文件读取处，证明真实产物树身份和字节保持不变，但不单独定位最后发布前检查；signed association 反例为内部 goal 元数据不一致，并非完整自洽的伪造 History 链。独立 writer 改 head 的专用故障注入仍待扩展。

ESLint、Prettier 和 Astra 只读复核通过。原生权限 helper 预算未改；真实进程重开使用本地测试 HMAC／manifest replicas，不认证生产密钥、外部 WORM、付费实验或 Linux/macOS 发行矩阵。当前新增来源层仍是固定存储图内的禁止性控制，完整 RRSI、部署锚、producer 来源证明、alias 与业务准入尚未完成。

## 25 运行子目录的完整文件身份

[rrsi-registry-runtime-policy.js](../../../packages/cli/src/lib/evolution/rrsi-registry-runtime-policy.js) 的 directory 检查改为 `lstatSync(target, { bigint: true })`，同时要求 dev 与 ino 实际为 BigInt。NTFS 文件 ID 可超过 Number 精度；不同实际目录可能具有相同 Number 投影，不能用舍入后的值认证目录。既有十进制字符串身份格式、runtime schema、原认证摘要与严格比较保持不变。旧舍入记录若与当前完整 ID 不同，read／recover 均 HOLD，不重新认领、不重算旧记录、不迁移或补建目录。store-policy 原七目录已有 BigInt 检查，本次修复的是 runtime 六子目录。

新增四项身份故障模型使用真实目录、原 v2 Ledger 与认证的八阶段日志，仅在六个 runtime 路径注入合成 inode。六个完整 ID 不同而 Number 全部碰撞仍能完成登记；随后换为相同 Number 投影的另一完整 ID 必须 HOLD；不返回请求的 BigInt 字段亦 HOLD。另一真实 fixture 留存模拟旧模板字符串的舍入身份，切回完整值后拒绝 read／recover，保持原 head、事件和目录。权限、其余目录、marker、Ledger、ArtifactPorts 与锁均不 mock；这些反例不宣称原生 NTFS 上已经实际完成同投影目录替换。原 runtime 单元与子进程 inventory 也改用 BigInt 观察，八阶段正常用例逐目录核对真实 dev／ino。

## 26 部署锚的声明与签名契约

[rrsi-tenant-index-anchor-contracts.js](../../../packages/cli/src/lib/evolution/rrsi-tenant-index-anchor-contracts.js) 新增严格、冻结的 anchor envelope，声明绑定 deployment、tenant、installation／shared-tenant-authority routing scope、确定性 tenant index ID、原 journal identity、artifact scope、storage graph、root 公钥摘要、revision／前驱、checkpoint 和限制历史摘要。Ledger ID／epoch 采用真正 Ledger 的字符串规则；checkpoint 必须与所声明 journal 相同，限制数量不超过 256 或 checkpoint sequence。revision 大于 1 仅声明前驱关系，不认证迁移、历史承接或限制未被删除。

签名消息为独立 `chainlesschain.rrsi-tenant-index-anchor-signature/v1` 域、NUL 和完整 canonical anchor，包含 schema、摘要与所有 false 标志。外部 signer 可取得确切字节；验签只接受显式给出的规范 base64url Ed25519 DER SPKI（44 bytes）与签名（64 bytes），公钥摘要必须等于 anchor 声明。成功仅返回 signatureVerifiedRelativeToKey:true；rootAuthorityVerified、routingPinVerified、historyTransferVerified、tenantWideIndexAuthorityVerified、generationProvenanceVerified 和 mutation／promotion grant 全部 false，decision:HOLD、authenticated:false、执行与晋级资格 false。模块无 I/O、默认 signer、持久 pin 或可信品牌，不改变现有 observed-text descriptor、marker、Registry 空只读模式与业务写入 HOLD。

Astra 查阅既有 deployment loader／config／profile 与 operator registry 后确认，它们的根仍相对于调用者或可修改配置：descriptor 与 root 可同时提供，显式路径可绕过 profile 路径校验，active root 可由写入 API 更换，operator genesis 由 caller 提供。它们不能直接证明根有权代表 tenant，本批没有借用这些品牌授予新权威。先按当前安装内固定路由准备契约；跨宿主 scope 即使由调用者成功自签也不取得租户权威。实际独立宿主根预置、持久路由 pin、高水位／撤销、强制路由、删除后重建防护与跨部署租户唯一性均未闭合。

最终锚契约完整 **30/30** 通过，首版 **23/23** reporter 保留但不重复计数。合法重建后沿用旧签名的反例涵盖 deployment／tenant、routing／artifact scope、journal／checkpoint、限制 tail／集合摘要及 revision／前驱；rootDigest 变化精确拒绝公钥摘要不符，其余签名篡改精确拒绝原签名。同密钥、同 canonical payload 只改变 domain 的反例验证域隔离；伪造权限标志即使重算结构摘要也拒绝。还覆盖错误 signer、非规范编码、边界、空历史声明、合法后继仍不认证迁移，以及 getter／proxy／额外 verifier callback 的拒绝。

两部分合计 **68 项不同用例通过**，零失败、零跳过：三个原生／故障模型文件完整 **38/38**（既有 runtime 单元 **18**、真实子进程 **16**、新增精度反例 **4**），锚契约 **30/30**。原生串行运行耗时约 28 分钟，所有既有行为时限、child watchdog 和 ACL helper 预算保持不变；新增精度 fixture 的两项准备 hook 各 60 秒，八阶段初始化 180 秒，行为各 60 秒。ESLint、Prettier、diff check 与 Astra 只读复核通过，六个源码／测试摘要及三个 reporter 的逐项结果见 [身份与锚契约验证记录](./evidence/rrsi-runtime-identity-anchor-local-controls-2026-10-07.json)。源码摘要检查点在原生回归运行期间、锚测试之后建立，后续未变；没有记录启动前快照，不将最终摘要独立当作每个 worker 所加载字节的证明。未进行 Linux／macOS 发行矩阵、真实模型／费用实验或生产晋级。

后续须先闭合可信根与实际持久路由，再把真实 producer 输入／输出回执、限制历史完整承接与原 backend 回读接入部署锚；随后处理 candidate alias 和发布 lease／恢复的来源门。本批的签名契约不能解除索引与 Registry 的现有 HOLD，完整 RRSI 仍在实施。

## 27 安装路由声明的连续性与严格只读打开

[rrsi-installation-route-contracts.js](../../../packages/cli/src/lib/evolution/rrsi-installation-route-contracts.js) 新增单 tenant 的 root、routes 和 highwater 合同。root 声明 installationId、tenant、installation scope、规范 Ed25519 SPKI 与公钥摘要；routes 绑定完整 root 摘要，保留最多 64 个真实签名 anchor，从 revision=1 开始严格逐次增加、精确关联前驱。highwater 绑定 root、完整 routes 摘要及尾部 anchor revision／digest、checkpoint 和完整限制历史摘要，不接受独立重算结构摘要的低高水位或冲突字段。

纯续接检查先验证真正 Ed25519 签名，再要求 deployment／tenant／scope／index／journal／artifact scope／graph／root 不变。同 revision 只有同一完整 anchor 才幂等，不能重复追加到 routes；后继只接受 +1 和精确前驱。checkpoint 与 restrictionHistory 必须逐字段完全相同，数字增加或限制集合看似扩大均不是历史前缀证明。当前只准备声明，所有安装管理认可、root／pin／journal prefix／history transfer／tenant／generation 与 mutation／promotion 权威继续 false，decision:HOLD。

installationId 本身未进入现有 anchor 的签名消息，root 亦只是未签名声明；相同 key／tenant 的签名包可原样重关联另一 installation 标签，并重算 routes／highwater。专用反例确认这种内部一致声明仍为 installationBindingSignatureVerified:false，不能称签名已经认证安装绑定。后续必须从独立管理主体取得根记录与初始 anchor 的认可，而不能从这三个本地文件推导该主体有权代表租户。

[rrsi-installation-route-reader.js](../../../packages/cli/src/lib/evolution/rrsi-installation-route-reader.js) 仅接受显式绝对、规范目录及 installation／tenant／root 摘要选择，不读取 env、profile、backend 或 caller callback。目录恰好含 root.json、routes.json、highwater.json；逐层检查非链接祖先，捕获完整 BigInt dev／ino 与类型／权限元数据，文件额外比较 uid／gid、单链接、size、mtimeNs／ctimeNs 和实际字节摘要。根／高水位文件各不超过 16 KiB，routes 不超过 256 KiB，目录枚举第四项即拒绝。使用原 bounded descriptor reader 严格读取已检查长度并只探测一个 EOF 字节，再复验 path／fd 身份；拒绝增长、缩短、非规范 UTF-8／JSON、未知字段、硬链接、目录冒充文件和缺失。

三个文件完整验签与交叉绑定后，再次有界读取全部文件并复查目录清单、祖先和完整元数据。reader 的后续 read 不接受替换 context，必须匹配首次捕获的目录／文件身份与字节，不自动接纳合法更新或恢复缺失文件。实现只有只读 filesystem API，没有 mkdir、写文件、锁、ACL 修复、bootstrap、删除或业务派发；ownerOnlyPermissionsVerified:false。该身份复查只检测检查时持续存在的替换，并非 handle-relative openat；共享 helper 的并发祖先保护前置条件尚无独立宿主边界，atomicSnapshotVerified:false，不承诺防任意替换后恢复的 ABA。

Astra 发现 POSIX 的 lstat→open 窗口可被换成 FIFO，导致打开在有界读取前阻塞。文件打开现加 O_NONBLOCK；模块私有 directory fs 适配对原 identity helper 的父目录及 volume 打开统一加 O_NONBLOCK／O_DIRECTORY，随后保留原 fstat 类型和完整身份比较。共享 secure-file-identity 与 evolution-file-identity 源码未改，Windows 的窄 path／handle device 兼容仍按原规则执行，不放宽 inode 或元数据。

真实文件反例覆盖三文件分别缺失／混合、每个文件同字节但不同 inode、同 inode 等长改字节、真实目录替换、保留叶目录 inode 的父目录替换、Windows junction／POSIX symlink 别名，以及一次读取中替换已经读完的另一文件。父目录反例是两次 read 之间的替换，不称中途祖先 race 实测；中途替换用例针对 highwater 文件。新进程可回读完整声明，但所有权威 false；已有 reader 拒绝整组回退，新进程仍可回读内部一致的旧声明且 crossProcessRollbackProtectionVerified:false，明确不认证跨重启防回滚或删除后重建。

首轮六文件 **138/138** 通过；根据复核补强非阻塞打开与边界反例后，最终 Windows 六文件 **142 项通过、2 项 POSIX FIFO 条件跳过**，零失败。新增合同 **44**、reader **35**、子进程 **6**，既有 anchor **30**、evolution file identity **5** 和 secure file identity **22**；不重复计首轮。提交前七个新增源码／测试和八个未改依赖／回归文件均有测试启动前摘要检查点，最终 Vitest 与下述 WSL 检查后均未改变；没有放宽任何既有时限或原生 ACL helper。

WSL Ubuntu 中另外执行 **2/2 个真实 POSIX FIFO 定向场景**：在 open 前分别把文件和父目录 rename 后创建真正 mkfifo，子进程确认已注入、实际目标为 FIFO、及时返回 HOLD 且未被 15 秒 watchdog 杀死。临时 Linux Node v22.22.2 仅解压到工作区 .work，使用官方 SHASUMS256 验证归档；初次沙箱访问 WSL 被拒，获准后确认 Ubuntu 未安装 Node，才使用该临时工具链。定向脚本直接运行仓库同一 child fixture 并核对全部最终源码摘要，不涉及 npm 安装、全 Linux Vitest、macOS 或发行矩阵；Windows 的两个条件跳过仍如实保留。

ESLint、Prettier、diff check 与 Astra 收尾复核通过；首轮／最终 reporter、15 个源码／测试摘要、六处两轮间变更与 WSL 场景记录见 [安装路由本地控制验证记录](./evidence/rrsi-installation-route-local-controls-2026-10-07.json)。本批未建立独立可信安装根、受保护的持久 pin 或业务 router，也未接真实 producer、候选 alias、发布 lease／恢复的来源门和生产晋级。下一步先接入安装管理认可、可信状态存在性与原图／限制历史前缀，再开放依赖这些权威的路径；完整 RRSI 尚未完成。

## 28 原存储组合中的真实历史前缀

[rrsi-observed-text-index.js](../../../packages/cli/src/lib/evolution/rrsi-observed-text-index.js) 的 captured internal API 新增 captureHistoryCheckpoints，仅接受最多两个有界 checkpoint，不接受 caller 的前缀结果、摘要计算器、resolver 或 verifier callback。每次执行原完整 load，认证全部 journal 事件、preparation 关联、限制记录、manifest 与实际 UTF-8 chunks；末事件摘要还须等于捕获 head。内存 retained record 增加真实 eventSequence 以计算历史边界，不改既有持久 record、descriptor 或 artifact 类型。

对正数 N，checkpoint 的 Ledger ID／identity digest／epoch 必须等于原捕获身份，headDigest 必须等于认证 events[N−1].eventDigest。它不是 manifest、anchor 或 restriction record digest。sequence=0 的真实 Ledger head 为 null，而现有 anchor v1 不支持该值，本接口明确拒绝零序号，不伪造空 SHA。fresh v2 的 migration intent／cutover completed 事件保留在 journal 序列，零限制前缀也计算真实非空 head；当前已留存的迁移前事件只认证为当前 v2 历史前缀，不倒推它们当时已有 v2 权限。

两个前缀均由同一次完整 replay 计算：recordCount 计实际限制事件，tailRecordDigest 为前缀最后记录，无记录时为 null；restrictionsDigest 使用独立 `chainlesschain.rrsi-observed-text-restriction-set/v1` 域，内容为按 skillTextDigest 排序的 `{skillTextDigest, restrictions: sortedUnion}` 数组，空集也沿用同一算法。非限制事件不改变限制计数；同一确切文本多次观察会增加记录数并累加禁止项。请求的旧前缀没有文本记录，也不能绕过当前 suffix 中缺失 chunk 或畸形声明。

[rrsi-tenant-index-anchor-history.js](../../../packages/cli/src/lib/evolution/rrsi-tenant-index-anchor-history.js) 捕获真正 index，先对两个 packet 做原 Ed25519 相对公钥验签，再检查 installation scope、固定 deployment／tenant／index／journal／artifact／root／声明 graph、精确 revision／前驱及实际 index scope。后端 checkpoint 必须为此次捕获的 current head，前端为真实原 journal 前缀；两端限制数量／tail／集合摘要均与内部重放结果完全相等。返回前再复验五字段 head，变化即 HOLD，不自动重基或缓存成功。recheck 只复查 head，不重新解析全部 chunks，不能证明捕获后持续的 artifact 可用性。

成功仅置 localJournalPrefixVerified、localRestrictionPrefixVerified 和 localRetainedHistoryReplayed 为 true。localCompositionDigest 明确只由原捕获 index／policy／backend 描述符生成，包含实际 journal/witness 路径与信任描述；现有 API 不完整公开 ArtifactPorts 布局和 v2 retention／manifest 配置，因此 fullPhysicalStorageGraphVerified／storageGraphDigestVerified 保持 false。caller 的 graph 仅要求两个声明同值，不回显为认证图摘要；安装根、installation binding、pin、跨进程回滚、tenant-wide、generation、migration／history transfer、cutover 与 mutation／promotion 权威均未授予，decision:HOLD、authenticated:false、执行／晋级资格 false。

v2 verify／read 会采用既有维护锁并可能恢复已获授权的迁移或 WAL／retained suffix；本批没有新增业务写入接口，但不称物理 open-only、无锁或零文件写入。原三文件路由纯合同仍拒绝 checkpoint／restriction 变化，未以 caller 的序列增加、WeakMap 品牌或新 prefix 回执解除业务 HOLD，也未建立独立的持久高水位。

反例使用真实 v2 日志、留存字节和签名。覆盖迁移事件零限制前缀、夹入非限制事件、相同文本累计限制、真实 head 配错序号／其他事件或记录摘要、零序号、过时 current head、实际限制 count／tail／set 的合法重签篡改、错误 scope／key／修订关系、伪造 index／getter／proxy／callback，以及旧空限制前缀下当前 suffix 缺 chunk。另一 genuine backend 用例属于不同原 Ledger identity，不证明拒绝完整复制同一身份及历史的另一物理后端。独立进程追加验证捕获后的 recheck 会拒绝旧 head，不是 wrapper 返回前窗口的定点故障注入；新进程亦可重建真实前缀，但仍无租户或安装权威。

本批共有 **90 项不同用例通过**、零失败、零跳过：新增前缀单元 **33**、真实子进程 **3**，旧 observed-text 单元／控制 **16＋8** 及 anchor 契约 **30**。首轮五个完整文件 **90/90** 通过；根据 Astra 建议仅收紧新单元的精确 message／嵌套 cause，并明确另一 backend 的不同 Ledger identity，最终该文件完整 **33/33** 再次通过。生产源码、签名／故障注入、准备阶段与时限及其它四文件未再改动；最终计数来自精确单元 33 项与四个不变完整文件 57 项，不称最后一次精确源码共同完整运行过五文件。

六个改动源码／测试与九个相关不变文件均保留两次启动前摘要检查点，原单元字节备份、唯一的诊断断言变更、两个完整 reporter 与逐项结果见 [真实前缀本地控制验证记录](./evidence/rrsi-anchor-history-local-controls-2026-10-07.json)。ESLint、Prettier、diff check 与 Astra 收尾复核通过；原生 ACL helper 和既有回归预算未改，新 fixture 各准备阶段 60 秒，子进程 watchdog 90 秒、外层行为 120 秒。本批未启用独立安装根、持久 pin、全图认证、producer 来源、alias 或发布准入，亦未执行真实费用／模型实验、生产晋级或 Linux／macOS 发行矩阵；完整 RRSI 仍在实施。

## 29 原 ArtifactStore 两目录的身份边界

[evolution-artifact-ports.js](../../../packages/cli/src/lib/evolution/evolution-artifact-ports.js) 的物理目录检查改为 `lstatSync(directory, { bigint: true })`，要求 dev／ino 实际为 BigInt，沿用原文件身份 helper 的十进制字符串、birthtime 与 WSL1 规则。真正 ArtifactPorts 完成构造时，从私有原 layout 固定 root／files 的路径和身份；新 capture 仅接受原精确 prototype 与模块私有登记中的实例，拒绝 Proxy、复制、伪造和 subclass。首次导出与后续 recheck 都复查原目录，不在首次查询时重新认领，不调用 initializer、补建目录或接受替换路径／callback。旧 resolver 的原型规则未改。

新 descriptor 的 scope 明确为 `root-and-files-directories`，indexLocation 只声明位置。索引文件身份／字节、产物清单、独立卷身份、完整物理存储图、根与租户权威、生成来源及修改／晋级授权均保持 false。专用真实反例把 index 文件换成相同字节的新 inode，两目录检查仍可通过且 indexFileIdentityVerified／indexContentsVerified 为 false，明确本层的验证范围。

[rrsi-observed-text-index.js](../../../packages/cli/src/lib/evolution/rrsi-observed-text-index.js) 在原 policy／backend／ports／resolver 组合核验后捕获两目录能力，核对 tenant／audience，计算独立 `chainlesschain.rrsi-file-artifact-store-directory-boundary/v1` 摘要。完整 retained load 前后及固定 head 的最终 recheck 前后均复查两目录；history snapshot 和签名锚前缀检查输出新增目录摘要、复查标志及范围。持久 index descriptor、restriction record、artifact 格式与原 localCompositionDigest 算法未改，storageGraphDigestVerified 继续 false。目录能力自身只使用读取操作；整个 index／history 仍继承原 v2 verify/read 的锁与合法恢复写入，不称物理 open-only。

新增真实 root／files 同字节复制替换分别证明原目录能力及原 index 拒绝新 inode；集成用例保留实际 journal 和历史数据，复查失败不改复制的字节，恢复原目录后再核对原认证 head。另覆盖目录缺失不补建、首次 capture 前已替换、真正 files junction／symlink、root stat 后实际替换 files、另一真正 ports／resolver 混入原组合，以及同一原目录重新打开时摘要稳定。新真正 ports 可以捕获复制目录的新局部摘要，不能据此声称阻断跨进程自洽克隆或获得全租户唯一权威。

三项精度故障模型使用真实 ArtifactStore 和测试配置权威，仅在 root／files 的 lstat 与目录 handle fstat 注入合成 inode：两目录完整 ID 不同但 Number 投影碰撞；换成同投影的另一完整 ID 必须 HOLD；provider 未返回请求的 BigInt 字段亦 HOLD。目录 fd→path 跟踪维持原 Windows path／handle 一致性，其余文件、权限和 helper 仍按真实路径执行。这些反例不是原生 NTFS 同投影替换的实测。顺序 stat／realpath 复查不构成原子快照，现有中途替换仅证明 root stat 后 files 被替换这个注入窗口，不能外推到任意交换后恢复时序。

最终 Windows 九文件一次完整运行 **133 项通过、1 项既有条件跳过**，零失败；新增目录单元 **15**、集成 **5**，既有回归 **113**。原 ArtifactPorts 的 index 文件 symlink 用例仅在非 Windows 运行，平台跳过如实保留；新增真实目录 junction 用例已运行通过。14 个相关源码／测试均保留启动前摘要检查点，最终核对未改变；完整 reporter、逐项结果、精度模型与范围限制见 [原产物目录本地控制验证记录](./evidence/rrsi-artifact-directory-boundary-local-controls-2026-10-07.json)。ESLint、Prettier、diff check 与 Astra 只读复核通过，既有 ACL helper／回归时限未放宽；新集成准备阶段与显式行为各 60 秒。

下一步仍需闭合 index 文件与完整实际 v2／retention 图，再结合独立安装认可、受保护的持久 pin／高水位和强制业务路由；producer 来源、candidate alias、发布 lease／恢复来源门与生产晋级尚未完成。本批未执行真实付费／模型实验或 Linux／macOS 发行矩阵，完整 RRSI 继续实施。

## 30 可信 index 快照的精度与有界读取

[evolution-artifact-ports.js](../../../packages/cli/src/lib/evolution/evolution-artifact-ports.js) 的 index 构造捕获与可信快照读取改用真正 BigInt lstat／fstat，要求 dev、ino、mode、uid、gid、nlink、size、mtimeNs、ctimeNs 全部为 BigInt，拒绝 provider 的 Number 回退。path→fd 保留原共享 helper 的第一个完整比较器及 Windows 窄 device 兼容，再精确检查原比较器未覆盖的 uid／gid；同 API 的读前后 stat 逐字段严格相等。birthtime 仍继承原 artifactPhysicalIdentity 的 Number／WSL1 规则，不称所有时间戳都达到纳秒身份精度。共享 identity helper 未改，也未把只比较稳定字段的 appender 比较器用于快照。

构造仅固定原 dev／ino／birthtime 物理身份，额外复查构造窗口内 path／fd 元数据和 realpath 后关闭 descriptor；不会固定整个生命周期的 size／mtime／ctime 或内容。每次读取独立检查 0–64 MiB 的 BigInt size，检查成功后才转 Number 分配；复用原 bounded-descriptor-read，按已检查长度以最多 64 KiB 分块读取，最后只探测一个 EOF 字节，再复验 descriptor、pathname 和原两目录。短读可继续，提前 EOF、增长、读取异常或元数据漂移均 HOLD，并关闭本次打开的 fd。分块读取范围受检查长度约束；partial read 可能多次请求剩余区间，不把请求长度简单累加称为总读取字节上限。

两处 index 叶节点打开新增 O_NONBLOCK／O_NOFOLLOW；模块私有 directory fs 适配仅在原身份 helper 打开目录时增加 O_NONBLOCK／O_DIRECTORY，不改共享 helper 或 artifact 叶节点打开。该加固只覆盖 inspectPhysicalIndex／readTrustedIndexSnapshot，原 boundedIndexEntries 在两个可信快照之间仍可调用 store.list()，底层 \_readEntries 与产物 bytes 仍使用整文件读取；不能宣称整个 ports API 已有严格读取上界或所有 FIFO race 都不会阻塞。

真正 append 与同 inode 合法写入后可以读取新快照；同字节但不同 inode 的 index 复制替换由原 ports 拒绝，新真正 ports 仍可捕获自己的局部文件。ArtifactStore remove／cleanup 的 temporary＋rename 同样会更换 index inode，原 ports 继续拒绝，不悄悄重新认领。旧 root／files 目录 descriptor、其摘要域、持久 observed index descriptor、限制记录与 localCompositionDigest 全部未改；目录能力的 indexFileIdentityVerified／indexContentsVerified 仍为 false，本批没有增设完整物理图或持久权威能力。

新增反例使用真实 ArtifactStore、索引文件和原 RRSI retained 历史：实际同字节 index 替换时，目录能力仍通过，原历史读取精确 HOLD；复制字节保持不变，恢复原 inode 后重新核对原 journal head 与目录摘要。另覆盖 path stat 与 open 之间同 inode 增长、构造首次 fd 采样后实际 rename／copy、最终 fd stat 采样后实际 pathname 替换、真实超限文件、EOF 时真实增长、实际截断、partial read、分块上限及失败关闭 fd。最后两项文件替换各针对明确采样窗口，不声称防任意交换后恢复的 ABA 或原子快照。

精度故障模型只注入 index path／handle stat：完整 inode 使用 `(1n<<60n)+1n`，换为同 Number 投影的另一完整 ID 必须 HOLD；不同 path／fd 完整 ID 即使 Number 相同也拒绝。mtimeNs／ctimeNs 两 API 使用固定同一大整数，读取后仅 fd 增加 1n，避免真实时间恰处舍入边界而产生不稳定反例；还覆盖全部九字段 Number 回退、open 后仅 uid／gid 漂移、读后 owner／权限漂移，以及 path／fd 的负长度和超限长度在分配前拒绝。这些 stat 模型不是原生 NTFS 同投影替换的实测。

最终 Windows **11 文件一次完整运行 179 项通过、3 项条件跳过**，零失败；新增单元 **44**、集成 **2**，既有回归 **133**。跳过为原 index 文件 symlink 一项和新增 POSIX FIFO 两项，Windows 条件跳过原样保留。WSL Ubuntu 另执行 **2/2** 个实际 FIFO 叶节点场景：分别在 constructor／snapshot 的 lstat→open 窗口 rename 原 index 后真正 mkfifo，确认注入、实际 FIFO 类型、精确 regular-file 拒绝和原文件字节保留；两 child 均及时返回，未被 15 秒 watchdog 杀死。复用上批已校验官方归档的临时 Linux Node v22.22.2，没有再次下载或 npm 安装；不代表完整 Linux Vitest、macOS 或发行矩阵，也不证明 parent-directory FIFO 场景或所有 ports 路径防阻塞。

开发阶段两份诊断 reporter 保留：首版单元把 EOF 后 rename 的错误预期写成最后路径检查，真实 fd ctime 已先改变而正确提前拒绝；随后将注入移到最终 fd stat 采样后，精确验证最后路径分支。初版集成误写 nested observed HOLD 名称，改为导入真实常量。Astra 复核后还固定纳秒故障模型并增加 uid／gid、构造最终复查及 fd 长度边界反例；这些早期通过项不重复计入最终 179 项。生产源码从首版诊断运行后未再改，未放宽既有 ACL helper 或回归预算。

最终 27 个相关源码／测试在 Windows 与 WSL 启动前保留同一摘要检查点，完成后逐一核对未变；逐文件／逐项 reporter、两份诊断失败记录、WSL 场景与模型范围见 [可信 index 本地控制验证记录](./evidence/rrsi-artifact-index-local-controls-2026-10-07.json)。ESLint、Prettier、diff check 和 Astra 收尾复核通过；新集成准备阶段及历史行为各 60 秒。本批仍未认证完整产物清单／v2／retention 图、独立卷／安装根、受保护 pin／高水位、producer、alias 或发布准入；真实费用／模型实验和生产晋级未执行，完整 RRSI 继续实施。

## 31 默认三阶段产物字节的有界回读

[bounded-artifact-file-read.js](../../../packages/cli/src/lib/bounded-artifact-file-read.js) 新增只读的单文件窗口检查，要求规范绝对物理路径、regular 单链接和实际 BigInt dev／ino／mode／uid／gid／nlink／size／mtimeNs／ctimeNs。path→fd 继续使用原第一个完整比较器及 Windows 窄 device 兼容，额外比较 uid／gid 和原 birthtime 身份规则；同 API 逐字段精确复查。实际 path 与 fd size 均须等于 expectedSize 且不超过 maximumBytes，检查后才分配 Buffer／转 Number，以最多 64 KiB 读取已检查长度并探测一个 EOF 字节，最后复查 descriptor、pathname 与 realpath，失败仍关闭本次 fd。叶节点使用 NONBLOCK／NOFOLLOW，私有目录 fs 适配只加固共享 identity helper 的目录打开。birthtime 保持原 Number／WSL1 规则，不能称全部时间戳都是纳秒身份。

[artifact-store.js](../../../packages/cli/src/lib/artifact-store.js) 的 verifyIntegrity 新增严格可选的两字段 bounds。显式 undefined、缺字段、多字段、getter、Proxy、伪装普通对象的 callable、非法长度、超过普通交付物上限或额外 context 在 id lookup 前拒绝，不静默退回整文件读取。有效模式使用新 reader，仍返回原四字段完整性结果；reader 失败折叠为 artifact-bytes-unavailable。无 bounds 的原普通交付物验证保留整文件读取语义，新正对照实际验证 2 MiB 交付物，不声称实测了完整 100 MiB 上限。即使有 bounds，传入 id 的 get／list 仍可读取整个索引，新增控制只约束产物字节。

[evolution-artifact-ports.js](../../../packages/cli/src/lib/evolution/evolution-artifact-ports.js) 的前 verifyIntegrity、中间读取、后 verifyIntegrity 共用新 reader；两个 captured hook 接收同一个冻结的 expectedSize／maximumBytes，大小来自既有严格条目校验，最大值仍为 1 MiB。中间回读独立复算原 signed recordDigest 并保留 canonical record 检查；原 root／files 复验继续执行，旧 Number 文件变更比较器和三处整文件产物读取已从默认路径移除。base 前后失败仍折叠为 ArtifactStore integrity verification failed，中间 reader 错误才保留具体 cause，不把三个阶段的错误链描述为相同。

新正常用例回读真实签名产物，分别统计产物和 index fd：恰有三次产物打开，实际返回字节为 3×entry.size，三个 EOF probe 各返回零，未调用整文件产物读取。每次最多读取 expectedSize＋1 个实际字节；partial read 重试可能重复请求剩余区间，不能把请求长度之和当作实际读取字节。前／中／后三阶段分别实际扩文件到 expectedSize＋1 与 1 MiB＋1，失败阶段在内容读取前拒绝并关闭 fd。实际 RRSI retained chunk 扩大后 history HOLD，原索引字节保留，恢复原 chunk 字节后再核对原 journal head 和目录摘要。

独立 reader 反例覆盖九字段 Number 回退、Number 投影碰撞的不同完整 inode、固定大整数的 mtimeNs／ctimeNs 读后变化、open 时 uid／gid 差异、读后权限／owner 漂移，以及真实 open／最终 pathname 交换、hardlink、junction／symlink 别名、增长、截断、partial read 和 I/O 异常关闭。精度 stat 注入只发生在真实产物 path／handle 上，不证明原生 NTFS 同投影替换。旧 DescriptorOnlyStore 回归只增加 bounds 参数转发，真实 index 故障、fired 检查与精确拒绝保持；新专用用例也证明合作 hook 的实际 index 修改仍可被回读拒绝。任意 override 若忽略参数或自行执行 I/O，仍不受本 reader 的读取上界约束。

每次读取只认证当次稳定窗口的字节。专用同字节新 inode 正对照仍能在下一次独立读取通过原签名摘要，不能称已建立 artifact 生命周期 pin、持久产物清单、三次原子快照或任意 ABA 防御。原两目录 descriptor 的 index／inventory／full graph／root／tenant／generation／grant false 标志、原摘要域、持久 observed 记录和 localCompositionDigest 均未改变。

最终独立 main 工作树的 Windows **16 文件一次完整运行 254 项通过、6 项条件跳过**，零失败；新增 reader 单元 **40**、三阶段单元 **10**、集成 **2**，旧回归 **202**。跳过为原 index symlink 一项、上批 index FIFO 两项及新增 artifact FIFO 三项，Windows 条件跳过原样保留。原 ArtifactStore **15** 与交付证据 **8** 也纳入最终运行，验证无参数的既有接口、实际跨进程 index owner 等行为未被改写；不重复累计初轮通过项。

WSL Ubuntu 补充执行 **3/3** 个真正 FIFO 场景，分别在前校验、中间读取、后校验的实际产物 open 前 rename 原文件并 mkfifo。child 明确返回匹配阶段的错误、注入 phase 和 open 次数，确认目标确为 FIFO、原文件长度保留、raw artifact read 计数为零、已打开产物 fd 全部关闭；故障前成功阶段的实际读取量分别为 0／entry.size／2×entry.size，未被 15 秒 watchdog 杀死。前后校验按原返回语义折叠原因，中间阶段保留 bounded helper cause。复用已有临时 Linux Node v22.22.2，无新下载或 npm 安装；该定向验证不是完整 Linux Vitest、macOS、parent-directory FIFO 或发行矩阵。

初轮真实 reader 与旧回归已通过，但新测试有 **12 项 fixture／调用格式错误**：两处 publishData 使用位置参数而非原对象 API，十项从不存在的 ref.artifactId 查条目而非解析原短 ref。纠正后新单元 **50/50**、集成 **2 项通过／3 项 Windows 跳过**；最终 retained chunk 又收紧为匹配原 nested artifact INTEGRITY。生产源码自首轮控制运行后未再改，诊断 reporter 保留，既有时限／ACL helper 预算与行为断言未放宽。

最终 35 个源码／测试有 Windows 与 WSL 启动前的摘要检查点，独立 main 的复验前再次核对全部摘要一致并保留新检查点，完成后逐一核对未变；完整逐项结果、诊断失败、真实 FIFO 与合成模型边界见 [产物字节本地控制验证记录](./evidence/rrsi-artifact-bytes-local-controls-2026-10-07.json)。ESLint、Prettier、diff check 与 Astra 只读复核通过。原 list／get、source publish、无 bounds verify 与任意 override 的 I/O 仍非全路径有界；完整 v2／retention 图、独立安装根／持久 pin／高水位、producer、alias 和发布准入尚未闭合，完整 RRSI 继续实施。

共享工作区在首份完整回归期间被另一任务切到 feature 分支，并提交了本批 helper 与旧 hook 参数转发两文件，默认 wiring 尚未在 main。为保留另一任务的提交和未提交修改，没有切换／stash／回滚共享 root；从 main 基线 `3e2d1042db` 新建完整独立工作树，只复制本批 12 文件，不为匹配摘要覆盖其它源码。本地 16 个 @chainlesschain workspace 包链接指向独立 main 源码，普通外部依赖复用已有缓存。独立 main 再次完整运行 16 文件并确认同一 254／6 结果，最终计数仅取该次；共享 root 的 254／6 reporter 单独保留为隔离前证据。WSL 三阶段与最终 main 的全部 35 项依赖摘要一致，因此保留其定向证据；本地复验仍不替代准确 release commit 的完整 Actions。

## 32 默认管理接口索引的有界回读

日期：2026-10-18，基线为 `main@7111f3f78725c82c35927fd5bada0e0b1be5983c`。[evolution-artifact-ports.js](../../../packages/cli/src/lib/evolution/evolution-artifact-ports.js) 在 bind 前按实际 data method 的函数身份识别原 ArtifactStore list/get：默认枚举使用第一个可信 descriptor 快照的条目，默认 get 使用已经唯一定位的条目；前后快照的字节摘要／条目 fingerprint、真实 id／recordDigest 唯一性和读取后的 canonical 稳定性检查仍执行。原方法的继承或 own 引用均可识别；不同函数的自定义 hook 仍调用并执行原交叉检查，不能以相同名称或 subclass 身份跳过。原 getter／Proxy 检查、固定目录、产物三阶段回读、签名和当前 authority 检查未放宽。

新增单元使用真实普通交付物构造超过 64 KiB 的索引，在发布完成后的管理 resolve、单次 resolver 和 batch 窗口禁止按路径或实际 index fd 调用 readFileSync；逐次核对最多 64 KiB 的 descriptor 请求、实际返回的完整索引字节、单字节 EOF 探测和真实 fd 关闭。另一正对照保留合作 list/get wrapper 的实际调用及整索引 I/O，明确其不属于默认路径上界；原 OversizedIndexStore、LyingListStore、LyingGetStore 及自定义完整性 hook 故障断言未改。

真实同 inode append 注入发生在 resolve 的单独准入快照之后、首次成对枚举第一个快照的最终 pathname stat 采样后，第二个快照看到稳定新字节而精确拒绝；后续稳定读取可通过。另覆盖真实删除目标、重复 id／recordDigest、不完整／损坏 JSONL、超过行数或 64 MiB 字节上限、同字节新 inode 替换。集成使用真实 retained chunk、原 v2 journal 和 preparation 历史：禁止整索引读取时管理接口与历史重放均认证成功；在实际 payload fd 成功读取后修改原 index 的目标 title，当次管理回读精确 HOLD，恢复原字节后重新核对原 journal head 和完整 retained 历史。故障及恢复后的 index／payload fd 集合均须为空。

最终独立工作树的 Windows **18 文件一次完整运行 271 项通过、6 项既有条件跳过**，零失败；新增单元 **15**、集成 **2**，既有回归 **254**，不重复累计开发阶段结果。跳过仍为非 Windows index symlink 一项、原 index FIFO 两项及 artifact FIFO 三项，本批未新增跳过或运行 Linux／macOS 矩阵。41 个相关源码／测试及测试配置在启动前留存摘要，完成后同时核对独立工作树与共享 root 字节一致；逐文件／逐项结果、诊断记录和范围见[索引管理回读本地控制记录](./evidence/rrsi-artifact-index-readback-local-controls-2026-10-18.json)。ESLint 使用既有 Node recommended 配置对三个变更 JS 文件检查，Prettier、diff check 与 Astra 只读复核均通过；既有 ACL helper、预算和时限未放宽，新集成准备阶段及行为各 60 秒。

开发记录保留最初整文件读取反例，以及两处测试编写修正：超限错误 message 应匹配原 bounded snapshot 提示；append 必须注入首次成对枚举，而非 resolve 的单独前置快照。共享 root 被其他任务切分支并修改无关文件后，最终从上述 main 基线建立独立 `.work/r32`，只复制三个源码／测试文件，16 个本地 workspace 别名指向该工作树源码；原 CLI 局部安装的七个第三方依赖也链接至现有缓存，无下载或安装。首次较长工作树路径遇到 Windows checkout 长路径失败，改用短路径及 core.longpaths；首次完整尝试因缺 CLI 局部 chalk 链接在旧 ArtifactStore 文件导入阶段失败，停止该次测试进程树，补齐缓存链接后原 15 项 ArtifactStore 通过，再从头执行上述完整 18 文件。源码／测试字节、原断言与超时均未为这些环境问题改变；最终结果仅取成功的完整运行。

默认管理回读现在使用原 64 MiB／10,000 条／每条 16 KiB 快照上限；这不是整个 ArtifactStore 的读取上界。发布、普通 list/get/\_readEntries、以 id 调用 verifyIntegrity 及任意 override 的自行 I/O 仍保留原范围。两次稳定快照不构成原子快照、任意 ABA 防御或跨调用 artifact inode pin；原目录 descriptor、持久 observed 协议、localCompositionDigest 及授权 false 标志均未变。完整实际 v2／retention 图、独立安装认可、受保护 pin／高水位、producer、alias 和发布准入继续实施；真实 RRSI A/B/C 实验仍为 `NOT_RUN`，统计质量与晋级保持 `HOLD`。

## 33 实际 manifest 状态的目录绑定与精确回读

日期：2026-10-18，延续独立工作树的 `main@7111f3f78725c82c35927fd5bada0e0b1be5983c` 基线。[evolution-manifest-state-reader.js](../../../packages/cli/src/lib/evolution/evolution-manifest-state-reader.js) 接入实际 v2 manifest catalog 与 head 文件后端，替换原 Number stat 和仅长度比较。构造保存原目录 dev／ino／mode／uid／gid 的冻结 BigInt 标量及既有 birthtime 身份，每次读取前后重新检查目录和规范物理路径；不固定目录的 size／mtime／nlink，保留正常 lock 与 temporary＋rename 写入。原目录被同字节复制替换、丢失或换为 junction 时，原 backend 拒绝；新独立 backend 仍可捕获自己的目录，不将局部捕获称为安装认可。

叶节点要求 regular、非 symlink、单链接及真正 BigInt dev／ino／mode／uid／gid／nlink／size／mtimeNs／ctimeNs；原路径与 descriptor 的完整身份比较继续使用既有 Windows 窄 device 兼容，并额外核对 uid／gid。读取前后同 API 元数据逐字段精确复查，birthtime 沿用原 Number／WSL1 规则，不声称全部时间戳都是纳秒身份。每次读取重新取得叶节点身份，合法原子 rename 更新可以回读；没有建立跨调用 leaf inode pin。

沿用 catalog 默认 64 MiB、head 默认 256 KiB 上限：先检查真实 path／fd 长度，再按检查长度以最多 64 KiB 读取 descriptor，最后探测一个 EOF 字节。提前 EOF、增长、截断、同 inode 等长重写、path／fd 差异或最终目录变化均拒绝并关闭 fd。partial read 可重试剩余区间，以实际返回字节和 EOF probe 计量，不能简单累加请求长度称为总读取上限。叶节点打开增加 NONBLOCK／NOFOLLOW，私有目录适配只加固原身份 helper 的目录打开；所有操作保留调用者原 fsImpl 和 receiver。新的物理读取错误码为 `CC_EVOLUTION_MANIFEST_STATE_READ_FAILED`，原 descriptor、JSON 格式、签名和 CAS 层不改。

仅首次叶节点 lstat 的 ENOENT 保持空状态／null 语义，即使之前存在也如此；EACCES、悬空链接或打开／读取中消失均不变成空状态。writer 在取得 lock 前增加原目录复查，只能拒绝已发生的目录替换，不构成整个写事务的原子防护。两个 constructor 仍执行原 ensurePrivateDirectory，可能创建或加固自己的目录，不能作为缺失状态一律 HOLD 的安装只读入口。

新增单元覆盖实际目录复制、丢失、junction、hardlink、open／最终 pathname 替换、等长重写、增长／截断／I/O 异常、partial read、完整字节计量和真实 fd 关闭。精度模型覆盖两 API 九字段 Number 回退、相同 Number 投影的不同完整 inode、固定大整数时间戳的 1n 漂移、open 时 uid／gid 差异，以及受影响 Windows uv 的目录／卷 handle 桥接；这些是明确的 stat 故障模型，不是原生 NTFS 同投影替换实测。末尾目录检查另有两后端的一次性合成 mode 投影；额外父目录复查返回真实 stat，避免覆盖预期错误。

新集成使用真实 preparation、observed 文本和签名 retained 历史：实际复制 catalog／head 目录后，原历史必须沿错误链精确 HOLD，复制字节和目录内容保持；恢复原目录 inode 后重新认证原 journal head 与完整 retained 历史。新进程正对照核对真正后端字节、禁止整文件读取、逐次 actualReadBytes 和零遗留 fd；所有完整存储图／安装／producer／晋级权威标志仍为 false。

最终 Windows **10 文件一次完整运行 177 项通过、4 项条件跳过**，零失败；新增单元 **86**、集成 **5**，既有回归 **86**。跳过为两后端的 POSIX 叶 symlink 与 FIFO 各两项，本地定向筛选掉的其它用例不算平台跳过，也不累计开发阶段通过项。ESLint 使用既有 Node recommended 配置检查六个源码／测试文件，Prettier、diff check 与 Astra 只读复核通过；原 ACL helper 和既有回归预算未放宽，新历史准备阶段及行为各 60 秒。

WSL Ubuntu 补充 **8/8** 个真实定向场景：两后端各自的 FIFO、悬空 symlink、晚期目录 rename 和最终目录 mode 变化。当前 Windows 文件系统晚期 rename 返回原生 EPERM，WSL1 `4.4.0-19041-Microsoft` 返回 EACCES，均严格核对移动／复制未发生、原 inode／字节保留与 fd 关闭；这些原生拒绝不计为最终目录复查覆盖，也不外推到所有挂载。WSL 的另外两项真实 mode 故障在最终叶 stat 采样后将私有 fixture 目录 0700 改为 0710，精确触发目录身份变化；核对原目录／leaf inode 未变、完整读取量、零 fd 和原 payload 后恢复 0700。FIFO／symlink 各核对实际类型、精确错误及保留原字节，所有 child 均在原 15 秒 watchdog 内完成。复用既有 Linux Node v22.22.2 缓存，无下载或安装；这不是完整 Linux Vitest、macOS 或发行矩阵。

开发阶段两项晚期目录测试起初误以为 Windows 可移动有打开 leaf 的目录；WSL 又发现同类 EACCES 被 fixture 的 saved-directory 查询误掩盖为 ENOENT，已修正报告，生产 reader 未为这些平台假设改变。WSL 首轮最终探针还把报告阶段额外的一次 lstat 漏计，修正 runner 后按冻结源码重新完成八项。一个完整 Windows 尝试在修正 fixture 前主动停止，不纳入最终计数。原诊断与最终两份 checkpoint 均保留，最终 56 项源码／测试／配置在 Windows 与 WSL 前共享同一摘要检查点，结束后核对未变，并在回传六文件前检查共享 root 原摘要，回传后核对全部 56 项一致。逐文件／逐项结果、平台区分、探针 runner、模型与诊断记录见[manifest 状态本地控制记录](./evidence/rrsi-manifest-state-local-controls-2026-10-18.json)。

本批只完成实际 manifest catalog／head 这一局部边界；顺序检查不是原子快照、任意 ABA 防御或持久高水位。完整 journal／witness／segment／retention 物理图、独立安装认可、受保护 pin／高水位、强制业务路由、真实 producer、alias 和发布准入继续实施。真实 RRSI A/B/C 仍为 `NOT_RUN`，统计质量与生产晋级保持 `HOLD`。

## 34 实际 witness 主文件与分段的目录绑定和精确回读

日期：2026-10-18，延续独立工作树 `main@7111f3f78725c82c35927fd5bada0e0b1be5983c`。新增 [evolution-physical-state-reader.js](../../../packages/cli/src/lib/evolution/evolution-physical-state-reader.js)，将第 33 节的实际目录与稳定文件窗口抽成共用内核；原 manifest wrapper 保留原错误码、提示、默认上限和 ENOENT 空状态语义。本批接入 [evolution-file-witness.js](../../../packages/cli/src/lib/evolution/evolution-file-witness.js) 的主文件及被 head 引用的历史分段，使用独立 `CC_EVOLUTION_WITNESS_STATE_READ_FAILED`，witness 错误链不借用 manifest 错误码。

同一 witness 实例至多保存原 root 和 segments 各一个目录 reader，不按 digest 建 reader Map。目录冻结 BigInt dev／ino／mode／uid／gid 及原 birthtime 身份；内容 size／mtime／nlink 可随合法锁、文件创建和 rename 改变。构造可以创建／加固 root，也可以加固并捕获已有 segments 目录；尚未分段时不预建目录。首次读取由另一合法实例发布的分段只捕获已经存在、规范且权限合格的目录，不 mkdir／chmod；引用目录缺失直接拒绝。首次分段发布仍可在原 CAS 锁内创建私有目录。一旦捕获，丢失、复制替换和 junction 在读前后及 lock 前均拒绝，不重新认领或补建；POSIX 读取要求目录 0700，变宽后失败而不修复。Windows 保留原 private-storage helper 规则，不将 stat mode 当作新增 ACL 权威认证。

每个实际文件先要求 regular、非 symlink、单链接和真正 BigInt dev／ino／mode／uid／gid／nlink／size／mtimeNs／ctimeNs，再执行原 ensurePrivateFile，最后重新取得正式读取窗口的 stat；准备前后须保持 dev／ino／birthtime 身份。这样保留 POSIX 叶权限归一引起 mode／ctime 变化的既有行为，而准备期间换成同字节新 inode 会拒绝。正式 path→fd 继续保留原 Windows 窄 device 兼容和完整比较器，并额外核对 uid／gid；同 API 元数据逐字段精确复验。birthtime 仍使用原 Number／WSL1 规则，不声称所有时间戳都是纳秒身份。私有文件准备和 constructor 可能修改权限，不能称为安装只读入口。

单文件默认仍为 64 MiB，累计历史默认仍为 64 MiB，最少 2 字节；实际读取使用 min(maximumBytes, 剩余 maximumHistoryBytes)，剩余 0／1 不回退默认上限。检查成功后才分配，最多 64 KiB 分块读取检查长度并探测一个 EOF 字节，最后复验 descriptor、pathname、realpath 和原目录，失败关闭 fd；叶节点增加 NONBLOCK／NOFOLLOW，目录适配只加固原身份 helper 的打开。partial read 按实际返回字节计量，不累加请求长度充当上限。只有主文件首次 lstat 的 ENOENT 可以返回原签名 absent，即使之前存在；根目录丢失、已捕获分段目录丢失、被引用分段缺失、访问错误及悬空链接都不能变成新空历史。

[evolution-witness-segments.js](../../../packages/cli/src/lib/evolution/evolution-witness-segments.js) 将读取 checkDirectory 与首次发布 prepareDirectory 分开，已有内容地址是否存在也只由初次 lstat 的 ENOENT 判断，避免权限错误／悬空链接被当作可覆盖的新文件。每次仍回读全部被引用分段字节并重新 hash，再按原 trust epoch 决定签名缓存是否可复用；1024 条／16 MiB 编码缓存、16 MiB 分段缓存、两次 epoch 重试、撤销、ancestry、discard、签名格式及 CAS 不改。readStore 在正常签名／epoch 验证后、以及 emptyStore 签名后返回前再复验两个已捕获目录，覆盖 verifier 回调期间实际替换的明确窗口。后续 proof signing、writeBytes、r+ fsync 和 confirmDurable 仍有各自原写入／耐久范围，不将这项复查扩称为整个事务原子身份保护。

新增单元覆盖两种实际文件的真实目录复制／缺失／junction、叶 hardlink、open／最终 pathname 交换、等长重写、合法跨调用同字节新 inode、完整字节与 EOF 计量、失败关闭 fd；精度模型覆盖两 API 九字段 Number 回退、同 Number 投影的不同完整 inode、固定大整数时间戳 1n 漂移、uid／gid 差异及明确的一次性目录 mode 投影。另验证累计剩余 0／1 的分段内容零读取，以及旧实例首次读取其它真正实例新建目录时禁止 mkdir／chmod、绑定后再丢失必须失败。verifier 反例先变更测试 epoch 使回调确实执行，再真实复制原目录，精确拒绝并在恢复原目录后重读成功；不把合法 warm-cache 命中当作故障已触发。

新 RRSI 集成沿原 preparation、observed 文本、实际 v2 journal 与 retained 历史认证链，分别复制真正 source witness 和 v2 witness 的目录；当次历史回读必须沿错误链精确 HOLD，复制文件字节及目录内容保持。恢复原目录后重新核对原 journal head 与 retained 历史。分段文件的物理 I/O 另用真正 witness 将独立测试签名的完整 legacy 历史转换为分段，实际 CAS／read／ancestry／重开与既有缓存／撤销回归均参与验证；这不是把分段 fixture 称为分段 RRSI 生产运行或独立 retention 权威。

最终 Windows **13 文件一次完整运行 340 项通过、13 项条件跳过**，零失败；新增单元 **85**、集成 **5**，既有回归 **250**。跳过包括原 manifest 的 symlink／FIFO 四项，以及新增 witness 的两个 symlink、四个 POSIX private-file 准备用例、一个 POSIX 目录权限用例和两个 FIFO；定向筛选未运行的用例不算平台跳过。完整运行同时保留原 73 项 witness 的缓存上限、撤销、完整累计预算和 response-loss／分段重试回归，旧测试断言与预算未放宽。

WSL Ubuntu 在同一冻结源码上完成 **14/14** 项：head／segment 各自的稳定读取、真实 FIFO、悬空 symlink、晚期原生目录 rename、最终目录 0700→0710、文件准备 0640→0600、准备期间真实同字节新 inode 替换。两个原生 rename 在当前 WSL1 挂载返回 EACCES，严格确认移动／复制未发生、原 inode／字节保留及零 fd，不计为 ending check；两个实际目录 mode 用例精确拒绝后恢复 0700。权限归一正对照完整回读并核对 0600／原 inode，准备中置换则在内容读取前拒绝并保存原字节。所有场景核对保留原完整文件 digest 与真实 fd 关闭；成功读取核对完整实际字节与 EOF，故障场景按注入阶段核对实际字节和精确错误。字节计数只覆盖选中 head 或 segment 的正式测量窗口，不含夹具创建或初次重开认证；其它文件有各自的独立有界读取。

Windows 新进程集成由 parent 在既有测试预算内准备真正签名文件，child 只重开并读取，原 15 秒 read watchdog 不变；WSL 定向 child 则在同一 15 秒 watchdog 内完成自己的夹具准备及实际读取，不能把两者写成全部只做 reopen。复用既有已校验 Linux Node v22.22.2 缓存，无下载或安装；未执行完整 Linux Vitest、macOS 或发行矩阵。

开发诊断保留：首轮两项旧 grow／truncate 已正确拒绝，但包装提示不匹配原 bounded read 断言，修正 witness 可配置文字而不改旧断言；verifier fixture 最初被 warm epoch 缓存绕过，变更测试 epoch 后两项精确通过；新 child 的初版 JSON.stringify 比较受键顺序影响且 Windows fixture 创建超过读取 watchdog，改为结构相等并将 Windows 准备移至 parent，保持读取时限。这些失败与定向通过均不累计最终计数。最终 63 项相关源码／测试／配置在完整 Windows 与 WSL 前留同一摘要检查点，完成后逐一核对未变；回传八文件前核对共享 root 原摘要，回传后再次逐一核对一致。完整逐项结果、源摘要、探针 runner、平台区分和范围见[witness 状态本地控制记录](./evidence/rrsi-witness-state-local-controls-2026-10-18.json)。八个变更源码／测试的 Node recommended ESLint、Prettier、diff check 和 Astra 只读复核通过。

本批仍是实际 witness 的局部目录／稳定字节窗口，不建立完整存储 inventory、journal／retention／authority 物理图、跨调用叶 inode pin、持久高水位、任意 ABA 防御或原子事务。独立安装认可、受保护路由 pin／高水位、强制业务入口、producer、alias 与发布准入继续实施；真实 RRSI A/B/C 仍为 `NOT_RUN`，统计质量和生产晋级保持 `HOLD`。

## 35 实际 journal／authority 的完整精度读取窗口与旧签名兼容

在第 34 节后继续沿实际 source journal 读取路径加固。[evolution-ledger.js](../../../packages/cli/src/lib/evolution/evolution-ledger.js) 将 canonical JSON、增量缓存命中和签名快照的 expectedBytes 回读统一到同一物理读取窗口，覆盖 identity、store marker、HEAD、anchor、event segment 和可丢弃的签名 snapshot。四个原目录（event root、authority root、segments、anchors）另存每实例完整精度 dev／ino／mode／uid／gid 与原 Number／WSL1 birthtime 身份；目录内容、mtime、size 和 nlink 不作持久 pin。旧 Number boundary.identity 继续原样进入 storeBindingDigest，旧 fileFingerprint 继续原样进入 storeMarkerEntryDigest，未迁移签名格式或摘要域。

文件的 dev、ino、mode、uid、gid、nlink、size、mtimeNs、ctimeNs 必须是 BigInt；在 BigInt 上检查 regular／非 symlink／单链接及 2 字节至原上限，再转换已验证 size 分配内存。旧 Number 指纹只在独立完整精度窗口中采样，既不从 BigInt 毫秒字段截断重建，也不充当物理身份权威。路径到 fd 保留原有窄 Windows device bridge，并额外核对 owner 和原 birthtime；同 API 元数据逐字段精确比较。最多 64 KiB 分块回读加单字节 EOF 探测，最后复核 descriptor、pathname、原 Number 指纹，以及相应原目录。expectedBytes 的早返回位于所有叶检查之后。heldParent 仍每目录一次父身份作用域；其整批读取结束后，在记入状态缓存前再检查四个完整精度目录，覆盖签名 verifier 回调后的明确窗口。

叶打开增加 NONBLOCK／NOFOLLOW；独立 adapter 仅为身份 helper 的目录打开增加 NONBLOCK／DIRECTORY，写入／fsync 原端口保持原行为。只有初次可缺叶 lstat 的 ENOENT 可返回 null，且返回前复核目录；晚期叶读取 try-body 的原生 I/O 映射为 CORRUPT，close 和外层 parent helper 仍可保留原生／helper 错误。authority root 缺失先沿原锁边界等待既有 10 秒后报告 LOCK_UNAVAILABLE；其它缺失目录走 STORE_UNSAFE。测试确认这些读取均不重建缺失目录，未放宽 ACL、锁、watchdog 或旧回归预算。

新增单元覆盖 cold／cached／snapshot 三分支的两 API 九字段 Number 回退、同 Number 投影的不同完整 inode、mtime／ctime 的 1ns 差异、uid／gid 在打开和末尾的差异、非法 BigInt 大小、真实 open 前交换、最后 fd stat 后的真实 pathname 交换、同长改写／增长／截断／晚期消失及 fd 关闭。实际 rename 若在最后 fd stat 之前发生，可能先改变原 fd 的 ctime；最终 pathname 用例因此把交换安排在该 stat 之后，并重新取得真实新 pathname stat，不用伪造 inode 证明该分支。缓存和可丢弃 snapshot 遇到一次性扰动可以安全回退，断言必须看到额外 open 与完整冷签名校验；持续损坏仍拒绝。另验四种实际 authority 叶、四目录同字节 clone／缺失、明确标注的合成目录投影，以及 cold／snapshot verifier 触发后的最终目录检查。旧 reincarnation-blind mock 仅改为尊重 bigint 选项，保留原拒绝断言。

升级对照确实先导入摘要核对的旧 ledger 源码，在同一原目录 bootstrap、追加签名事件并写出旧 snapshot，再由新版经 snapshot 和 warm cache 重开、追加第二项，最后由旧代码反向重开。没有复制到账本的新路径，也不是新版自建自验。identity、store marker 和原 snapshot 的完整字节在整个往返结束后再次相等；原 storeBindingDigest／storeMarkerEntryDigest、签名格式及每侧认证均通过。此对照专门验证 journal reader 升级，witness 使用第 34 节实现；不等于部署升级或掉电演练。

新 RRSI 集成沿真实 preparation、observed 文本、v2 journal 和 retained history 链，分别 clone source 的四个 journal／authority 目录；每次沿错误链准确 HOLD，恢复原目录后重新认证原 journal head 与 retained history。新进程正对照则在 parent 准备签名文件，child 在未扩大的 15 秒 watchdog 内完成初次重开和正式测量回读；字节／fd 计数只覆盖选中 segment 的正式测量窗口，不含准备、初次重开或其它文件各自的有界读取。

最终 Windows **12 文件一次完整运行 290 项通过、11 项条件跳过**，零失败；新增单元 **131**、集成 **8**，既有回归 **151**。平台跳过逐项保留在证据中；新增包括一项 POSIX 目录权限，以及三分支各自的 FIFO／symlink／末尾权限和 snapshot parent FIFO 共十项集成。原 ledger 的 57 项、并发／崩溃恢复、v2 journal／manifest、RRSI observed／retained 历史及既有跨进程与可靠性回归均参与最终运行；不累加任何初轮、筛选、终止运行或前批通过数。

同一冻结源码在 WSL Ubuntu／WSL1／缓存 Linux Node v22.22.2 完成 **13/13** 定向实际文件系统场景：cold／cached／snapshot 各自稳定回读、叶 FIFO、悬空 symlink、EOF 后 root 的实际 0700→0710，以及一次 snapshot parent directory FIFO。叶 FIFO 均实际打开一次、读零字节；symlink 在原目录枚举阶段以 STORE_UNSAFE 拒绝，叶 open 为零，不计作 O_NOFOLLOW late-open 证据。parent FIFO 证明 NONBLOCK／DIRECTORY 拒绝打开而不等待 writer，未完成 parent fd 的后置比较；三个真实权限用例才覆盖末尾目录拒绝。各场景核对完整原 digest／inode 恢复及零遗留 fd，成功读取核对实际字节与 EOF。未执行完整 Linux Vitest、macOS 或 Actions 宿主矩阵，当前原生 Windows 正对照也不独立证明历史 libuv 1.49／1.50 运行时；原兼容桥经源码复核保留。

开发诊断保留：首轮三项新 fixture 断言因 rename 的 fd ctime 分支及改写 algorithm 字节触发 TRUST_MISMATCH 而失败，调整注入位置与 reason 字节；扩展中的缺 authority 断言最初误期望目录错误，改为既有锁错误并核对不重建；WSL symlink 实际分类促使修正新增断言并终止尚未完成的首个全量候选，重新冻结、重新完成唯一最终全量。均未放宽生产比较器或原测试条件。391 项本地来源／测试／配置摘要在最终 Windows、WSL 和升级检查前冻结并在结束后逐项核对；发现共享 root 已有三项 plugin dependency 修改及一个新增被引入文件，只同步至独立工作树以对齐依赖，未覆盖共享修改。回传本轮六文件前核对共享目标原摘要，之后再次核对全 391 项一致。六文件的 Node recommended ESLint 与 Prettier、已有 Git diff 的空白检查及 Astra 只读复核通过。完整逐项结果、runner、摘要和范围见 [journal 状态本地控制记录](./evidence/rrsi-journal-state-local-controls-2026-10-18.json)。

本批仍是局部 source journal／authority 的每实例目录绑定和稳定读取窗口，不建立全存储 inventory／物理图、独立安装权威、持久完整精度 pin／高水位、不可变叶的跨调用 pin、任意 ABA 防御或整个事务原子性。constructor 可能准备权限，append、恢复清理、写入／fsync 及后续 receipt／proof 回调各保留其原有范围，不能称为全入口安装只读。真实 producer、tenant-wide 来源、部署准入、业务强制门、candidate alias、release lease／恢复与真实对照继续实施；真实 RRSI A/B/C 仍为 `NOT_RUN`，统计质量和生产晋级保持 `HOLD`。

## 36 原 source journal 四目录能力与历史组合复查

在第 35 节的实际读取边界上，补齐后续存储图核对所需的一项原组件描述。[evolution-ledger.js](../../../packages/cli/src/lib/evolution/evolution-ledger.js) 在成功初始化后，直接把原 #physicalBoundaries 中的 events、authority、segments、anchors 四目录投影为模块私有能力，未在首次查询时重新 lstat 认领路径。dev／ino／mode／uid／gid 转为十进制字符串，birthtime 保留原 Number／WSL1 语义；descriptor、目录列表、identity、能力和 recheck 均冻结，scope 明确为 source-journal-four-directories。目录内容、mtime、size 和 nlink 不纳入绑定；叶身份／内容、witness、retention、完整图和全部权威标志为 false。

capture 仅接受原构造类、精确 prototype 与 WeakMap 登记实例；Proxy／撤销 Proxy 不触发 getter 或 prototype trap。只有 new.target 等于原 EvolutionLedger 时登记，Reflect.construct 使用相同 prototype 的替代 newTarget 也不能取得能力，原 migration source 的既有行为未改。capture 和 recheck 拒绝所有额外上下文，闭包只用原 #assertBoundaries 的 lstat／realpath，不打开叶文件、不读内容、不获取锁、不初始化或修复权限，也不调用 signer、verifier、witness 或替换 callback。缺 authority 的直接能力查询因此立即报告目录错误、不重建；普通 ledger.verify 仍保留第 35 节的原 10 秒锁拒绝行为。

[evolution-ledger-file-backend.js](../../../packages/cli/src/lib/evolution/evolution-ledger-file-backend.js) 另用私有 WeakMap，把真正的局部 sourceLedger 能力绑定到原 backend；v2 对外 ledger 是 wrapper，不能把 wrapper 或公开 descriptor 路径重建为 source。捕获位于 v2 factory 完成后，若 factory 期间实际替换 source 目录，同样不能返回带有效原能力的 backend。公开 backend descriptor、旧 BACKEND_BINDINGS 形状、签名端口及原 v2 组合均未扩张；不按 requested resolve 路径与 source realpath 的文本差异拒绝合法别名。

[rrsi-observed-text-index.js](../../../packages/cli/src/lib/evolution/rrsi-observed-text-index.js) 在确认原 policy／backend／ports／resolver 关系后取得私有 source 能力，在完整 retained load 与固定 head recheck 前后和原 artifact 两目录能力一起复查。临时 history snapshot 及 [anchor history 检查](../../../packages/cli/src/lib/evolution/rrsi-tenant-index-anchor-history.js) 增加 sourceJournalDirectoryBoundaryDigest、复查标志和四目录 scope，使用独立 chainlesschain.rrsi-source-journal-directory-boundary/v1 域。index.descriptor、持久 restriction／artifact／anchor、store binding／marker 签名及原 localCompositionDigest 输入保持原值；临时 snapshot／history check 的摘要随新增输出变化。新的组件摘要不认证 caller 声明的 storageGraphDigest，fullPhysicalStorageGraphVerified／storageGraphDigestVerified 和安装／业务／晋级权威均继续 false／HOLD。初次 index factory 的 capture 可直接抛 STORE_UNSAFE 或 TypeError；既有 index/history 操作才沿原错误链包装 HOLD，不宣称所有入口统一错误码。

新增单元用真实 journal 验证正常追加、snapshot 和同原目录重开后的摘要稳定；逐四目录执行实际 clone、缺失、junction／symlink，capture 前已替换与后续 recheck 均拒绝，缺失不补建，恢复原目录后局部摘要恢复。另覆盖全五字段 Number 回退、真正 v1 backend 的精确绑定及其副本／Proxy／撤销 Proxy、subclass／替代 newTarget、上下文 getter／callback 零调用。无副作用探针仅允许 lstat／realpath，其它文件端口与可信端口调用均抛错，能力仍成功。真实 HEAD 损坏时目录能力保持其局部摘要而 journal 原内容检查拒绝，明确不能把 metadata-only 成功当作文件或账本认证。

新 RRSI 集成走真正 preparation、observed 文本和 v2 retained 历史，核对私有 source 与公开 wrapper 的区别、四目录摘要、原 descriptor／localComposition 和显式 false 权威；四种 source 目录 clone 均精确 HOLD，Windows 恢复原目录后再认证原 head／历史。末尾反例先校准 history.recheck 的最后一次 artifact-files lstat，第二次在该回调中真实 clone source segments；此时最后一次 journal.verify 已返回，新增最终 source 复查必须拒绝。它覆盖新增组合末端窗口，不把第 35 节前置 verify 拒绝重复计作新证据，也不外推任意 ABA 或原子图快照。

兼容对照先导入摘要核对的旧第 35 节 observed-index 模块，在原组合写入真实记录；新版读取后追加另一文本，旧版重新构造并读取两个世代。旧 descriptor、localCompositionDigest 及原 8 个产物完整字节在整个往返后保持不变，index 文件字节在新版只读回放期间不变。旧临时 snapshot 没有新 source 字段，新 snapshot 有组件摘要；此对照共享当前 ledger/backend，仅证明 observed 持久记录双向兼容，不称为整套安装或部署升级。

首次完整 Windows 运行实际为 171 项通过、1 项失败、0 项跳过，新增 34 项均通过。唯一失败发生在 partial-witness 用例第 216 行的初次 fixture 初始化：manifest catalog 的 ensurePrivateDirectory 报 windows-acl:timeout-verify／repair:timeout:verify:ETIMEDOUT，早于该用例 fault armed 和 batch 操作，不能称为恢复断言或新目录能力拒绝；未确立该本机子进程超时的更深原因。独立定向复测为 1 项通过、13 项过滤，并非完整回归。原失败信息、两份报告摘要保留在证据中，未增加 ACL、watchdog、锁或测试预算，源码保持同一冻结版本。

最终 Windows **10 文件一次完整复跑 172 项通过、0 项条件跳过**，零失败；新增单元 **25**、集成 **9**，既有回归 **138**。最终集合包括原 ledger、file backend、v2 journal 迁移／恢复、observed-index、anchor history、跨进程历史、observed 控制及 artifact 目录组合。核对了精确文件集合、每 suite 状态、报告时间和逐断言总数，不累加首轮 26 项、两文件初轮 34 项、失败全量运行的 171 项、定向复测、前批、升级 probe 或 WSL 数量。

同一冻结源码在 WSL Ubuntu／WSL1／缓存 Linux Node v22.22.2 完成 **21/21** 实际定向场景：稳定只读元数据、真正 append／snapshot／同目录重开；四目录分别 clone／缺失／symlink／FIFO 共 16 项；真实 mode 变化、全新健康夹具上的 HEAD 内容范围对照，以及 fresh v2 migration/history 的私有 source 接线。四个 FIFO 均实际创建，能力端口零 open／遗留 fd；不需要 writer，也不把调用者执行的 rename/copy 本身称作只读。目录恢复核对原 inode／组件摘要，不据此声称完整历史恢复。

WSL 开发诊断保留：第一版 probe 在目录轮换夹具上继续假定旧签名 marker 健康，完整 ledger 仍以 CORRUPT 拒绝 store incarnation marker。最终逐字段记录确认原 dev／ino／mode／nlink／size／mtime 相同，但 ctime 和 WSL1 回退 birthtime 已变化；该旧 Number 指纹围栏继续拒绝，未放宽生产检查。最终把 HEAD 范围对照移至独立全新夹具，先确认账本健康，再核对明确的 HEAD 损坏拒绝与字节恢复。21 项能力／接线通过与旧 marker 诊断分别记录，WSL 的目录轮换不声称完整 journal 恢复；未执行完整 Linux Vitest、macOS、Actions 发行矩阵或掉电演练。

393 项本地源码／测试／配置在最终 Windows、WSL 和旧记录对照前冻结，结束后逐项核对；回传六文件前核对共享目标原摘要，之后核对两工作区全 393 项一致。六个 JS 文件的 Node recommended ESLint／Prettier、已有 Git diff 的空白检查及 Astra 只读复核通过；两个未跟踪新测试由 Prettier 检查格式。完整逐项结果、来源摘要、runner、诊断与范围见 [source journal 目录能力本地控制记录](./evidence/rrsi-source-journal-directory-boundary-local-controls-2026-10-18.json)。

本批只把原 source journal 四目录加入已有 artifact 目录组件的局部组合核对，尚无全部 v2 manifest／head／witness／retention 的物理能力汇总、完整文件 inventory 或实际 storageGraphDigest 认证。constructor 可能准备权限，普通 index／history 保留原锁与恢复写入，只有本能力自身为 metadata-only。独立安装认可、持久 pin／高水位、受保护业务入口、真实 producer、tenant-wide 路由、candidate alias 和 release lease／恢复继续实施；真实 RRSI A/B/C 仍为 NOT_RUN，统计质量和生产晋级保持 HOLD。

## 37 manifest catalog 与 head 的原目录能力

继续为后续存储图组合补齐原组件描述。[evolution-physical-state-reader.js](../../../packages/cli/src/lib/evolution/evolution-physical-state-reader.js) 直接投影成功构造时 originalDirectory 的 dev／ino／mode／uid／gid 和既有 Number／WSL1 birthtime；五个完整精度字段序列化为十进制字符串，目录内容、nlink、size 和变更时间不纳入 pin。新增 schema 为 chainlesschain.evolution-physical-state-directory-boundary/v1，scope 固定 single-original-state-directory。descriptor、directory、identity、capability 和新 recheck 均冻结；capture 不重新认领路径。构造结束前额外复核原目录，检查初始 pin 之后的实际替换。

physical reader、[manifest reader](../../../packages/cli/src/lib/evolution/evolution-manifest-state-reader.js)、[file manifest catalog](../../../packages/cli/src/lib/evolution/evolution-ledger-file-manifest-catalog.js) 和 [head backend](../../../packages/cli/src/lib/evolution/evolution-ledger-file-manifest-head-store.js) 分别用模块私有 WeakMap 沿真正构造的原对象传递能力。两个 raw backend 的 capture 严格接受一个原实例，错种、结构副本、相同 descriptor 的 wrapper、Proxy／撤销 Proxy 均拒绝；能力 recheck 严格零参数，不读取额外 getter／callback。通用 descriptor 不包含调用者 label 或宣称 catalog/head 所有权；组件角色只能由相应原 backend 的品牌表达。

能力本身只执行原 reader 的目录 lstat／realpath，不读叶内容、不开 fd、不获取锁、不初始化或修复权限。品牌证明工厂构造的原对象及其原注入端口，**不认证任意 fsImpl 是可信原生文件系统**；本批保留原动态 fsImpl 信任边界。只有此导出能力为 metadata-only：backend factory 仍有 ensurePrivateDirectory／ACL，普通 reader、write、journal 和 history 仍保留原有 I/O、锁与恢复行为。原 reader 的 read／recheck 形状及 recheck 的 undefined 返回、公开 backend descriptor／keys、字节上限、错误码、CAS、签名格式和写入／rename 协议不变。

新增单元 **40** 项核对实际 BigInt 原身份、序列化／冻结、读写后摘要稳定、真实 append／CAS 的叶 rename、同原目录重开，以及原 reader 接口。无副作用正对照只允许原目录 lstat／realpath，其它文件端口、lock 和 random 一旦调用即抛错。首次用户 capture 前实际 clone 目录仍拒绝；已保留能力另覆盖 clone／缺失／junction 或 symlink 后的 capture 和 recheck，缺失不补建，恢复原目录才恢复局部摘要。另逐五字段拒绝 Number 回退及不同完整精度标量，拒绝所有替换上下文，且在通用 reader 构造第二次 stat 时真实 clone 目录，验证末尾检查不接纳新 inode。真实状态叶损坏或删除时，目录能力仍成功；普通读取依原 JSON 校验或 empty/null 合同处理，不把局部元数据成功当作状态认证。

新增集成 **6** 项走真正 preparation、observed 文本与 retained v2 历史，旁证 fixture 持有的真实 catalogBackend／headBackend 能力在原提交及重开后稳定；实际 clone 两目录时，新 raw capability 与原 history reader 分别拒绝，Windows 恢复原目录后再次认证原历史。这里 history HOLD 来自第 33 节既有物理 reader，**尚未把 manifest capability 接入 history composition**。当前 catalog/head 的结构 wrapper 不能凭相同路径或同名方法取得原对象品牌；history 未新增 manifestDirectoryBoundaryDigest，也不接受调用者 capability。未将这些局部对照写成已完成的 v2 物理图汇总。

状态协议兼容对照直接导入共享区第 36 节旧模块与独立区新版模块，在同一原目录分别执行旧写→新读、新写→旧读、旧再次写→新读；catalog 和 head 两角色均通过。两次只读窗口的完整状态字节保持相等，公开 descriptor、旧 v2 state schema 及往返后的原目录组件摘要保持原值。正常写入本来会更新字节并替换叶 inode，未声称写入前后叶字节相同；该对照不等于完整签名 v2 安装或部署升级。

Windows 首次完整 10 文件运行为 **323 项通过、1 项失败、13 项平台跳过**。唯一失败在 slash-bearing tenant 迁移用例第 90 行的初次 migrated fixture：catalog 的 ensurePrivateDirectory 第 80 行报 windows-acl:timeout-traversal／repair:timeout:traversal:ETIMEDOUT，尚未进入第 82 行新 manifest stateReader／目录能力构造。原始完整报告与错误链保留；未确立 native ACL 子进程超时的更深原因。原全量退出后，保持同一冻结源码、测试、参数及预算，完整复测 v2 journal 文件 **14 项通过、0 失败、0 跳过**，没有筛选测试。

本地 Windows **10 文件覆盖结果来自两次运行：按完整文件去重后 324 项通过、13 项平台跳过**。九个原全量成功文件加一个完整复测文件各计一次，未重复计算原失败文件中的 13 项通过，也不把此汇总称为一次全量 clean pass 或 Actions 发行门。其中新增单元 40、集成 6，既有 278；共用 reader 的原 manifest／witness 完整精度与稳定字节窗口、file witness、head CAS、v2 manifest、v2 journal 迁移／故障恢复及实际 retained 集成都覆盖。核对精确文件集、每个所取完整文件的报告来源、逐断言计数、复测晚于全量结束及两次运行的全部列明源码摘要；不累加最初两文件 46 项、WSL 或兼容 probe。

同一冻结源码在 WSL Ubuntu／WSL1／缓存 Linux Node v22.22.2 完成 **15/15** 实际定向场景：catalog/head 各自正常 write/read/reopen、clone／缺失／symlink／FIFO、实际 0700→0710 模式变化、叶损坏／缺失范围对照，共 14 项；另用全新真实 v2 migration 与 domain append 核对两个真实 raw 组件。两个 FIFO 均实际创建；guard 同时记录所有禁止端口尝试并要求为空，因此能力拒绝不是靠 open 失败伪造的成功。它们仅证明 metadata-only 拒绝，不能充当 NONBLOCK 叶打开证据。fresh v2 probe 没有注册 observed 文本；未运行完整 Linux Vitest、macOS、Actions 发行矩阵或物理掉电演练，未下载或安装新运行时。

403 项列明的本地来源／测试／配置及 session-core 私有存储依赖在最终回归前冻结，Windows、WSL、兼容对照后逐项核对；只回传六个测试过的文件，并核对两工作区全量列明摘要一致。Node recommended ESLint、仓库 Prettier、已有 tracked diff 空白检查及 Astra 只读代码复核通过；未跟踪 reader／测试由 ESLint／Prettier 检查。共享研究目录 README 保留其它工作进度，仅更新原 RRSI 条目。逐项结果、原源码摘要、runner、平台跳过与范围见 [manifest 目录能力本地控制记录](./evidence/rrsi-manifest-directory-capability-local-controls-2026-10-18.json)。

下一步先在实际 factory／composition 建立 catalog/head 原对象或原端口的私有所有权绑定，再接入历史组合并继续 witness／retention／source 的组件汇总；不得通过公开路径重建或调用者声明补齐。完整文件 inventory、实际 storageGraphDigest 认证、独立安装认可、受保护持久 pin／高水位、强制业务入口、真实 producer、tenant-wide 来源、candidate alias 和 release lease／恢复仍未闭环。真实 RRSI A/B/C 仍为 NOT_RUN，统计质量和生产晋级保持 HOLD。
