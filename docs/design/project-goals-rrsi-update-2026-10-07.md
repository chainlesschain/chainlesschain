# 持久项目目标、受控动作与 RRSI 增量设计

日期：2026-10-07；源码基线：`36ca503291`。本页按 `docs/research` 中 Dots/Muse/Mods、RRSI 和 Palantir 的研究、实施记录及对应代码整理。公开 CLI 为 `0.166.91@23afea300b`，Open VSX `0.37.136` 与 JetBrains `0.4.154` 的发行提交为 `5b78b8d828`；这三个边界独立于本页的主线实现。Desktop/Android/iOS 产品版本仍为 `v5.0.3.138`。

## 1 实现与发布范围

| 范围            | 已实现                                                                                           | 验收边界                                                              |
| --------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 项目目标        | 版本合同、个人项目 SQLite、公共调度、风险巡检、建议/动作、独立验收和停止控制                     | 已合入 main；未进入公开桌面安装包；真实 Electron GUI 与业务效果未验收 |
| RRSI            | 五池合同、耐久计账、PM broad 桥接、原生登记/准入/行/census、统计 v2、预注册、HOLD 回执与后端关联 | 本地工程控制；真实 A/B/C 实验 `NOT_RUN`；自动晋升 `HOLD`              |
| Palantir 第五批 | 受控任务创建、风险→描述动作血缘、人工复核、审计治理、REST 探针与投影运维核查                     | 主线源码；连接器、向量目的地、真实业务样本仍需验收                    |
| CLI 0.166.91    | Windows 原生评测身份/ACL、失败与清理证据、锁释放重试、依赖及跨平台验证修复                       | 准确发行提交已通过 CLI CI、Strict Sandbox，随后 OIDC 发布             |

源码的 Session Core 虽仍标记 `0.3.16`，其新增 goal/scheduler 子路径晚于同版本的公共制品；开发者必须按 Git tree 或制品字节判断能力，不能只比较 package.json 版本。

## 2 目标、执行与完成是三个独立事实

`goal-contract.js` 保存目标定义、`revision`、`controlGeneration`、存储标识和个人项目引用。目标状态为 `active/paused/done/abandoned`；当前执行状态从监控宿主读取。CAS 修订推进版本及控制代次，旧审批、执行和验收证据不能授权新版本。

CLI `cc goal` 继续使用原 `<home>/goals/<id>.json`。版本化适配在严格文件锁内检查 CAS；旧文件只读兼容，不自动绑定 DID、开启巡检或赋予项目权限。旧 `close` 是人工关闭，模型自评和进度 100 都不产生项目独立验收证明。超限旧历史保留原适配路径，避免静默裁剪。

个人项目宿主在原项目数据库保存 `cc_project_goal_store_meta` 与 `cc_project_goals`。读写解析主进程当前 DID、检查实际项目归属；写入在原生 immediate 事务中再次检查身份及版本。组织/工作区关联不进入本轮合同。记录序列化上限为 64 KiB，损坏、未知 schema 和冲突拒绝写入。

```mermaid
flowchart LR
  G[版本化目标] --> S[独立持久调度账本]
  S --> R[原生项目风险检查]
  R --> P[持久建议与动作意图]
  P --> A[当前预览与原生确认]
  A --> T[业务写入与 ActionRun 同事务]
  T --> V[独立读取业务事实与验收]
  V --> C[当前版本完成证明]
```

## 3 持久巡检与授权

Session Core 提供宿主中立的 scheduler contract/service/runtime/store/authority resolver。原 Graph、home 和驱动仍由宿主装配。调度库具有独立 application ID、schema 和 catalog，不能直接混入项目库。Desktop 按可信应用路径和数据库实路径派生私有调度文件，连接轮换或退出时先撤销并排空旧宿主，再关闭连接。

创建目标只保存意图；用户明确开启后才巡检。周期合同为 1 分钟至 7 天，界面提供 1 分钟、15 分钟、1 小时、1 天；离线周期合并为一次到期检查。风险只计算逾期与未完成直接依赖，不运行模型，不预测交付概率。

真实 PIN/密码登录成功才建立专用主进程会话。默认加载 DID 不能代替登录。UKey 模式绑定当前驱动；锁定、拔出、身份变化及退出撤权。旧登录结果、旧窗口/frame、旧数据库连接和迟到响应均不能恢复授权。

风险 review、检查证据和目标 usage 同项目事务保存；调度 occurrence 的结算为另一数据库投影。项目已提交而调度结算失败时，恢复读取同一 review，不重复扣账。每目标最多保留 1000 次有效检查/手动意图，状态返回最新 20 条；单次扫描上限 50。目标次数/时间预算与 principal 全局额度同时生效。

## 4 建议到原生业务动作

风险检查保存语义去重的建议，同一控制代次不因检查时间改变重复消费。每目标分别最多 500 条建议和 500 条意图，单次检查最多新增 100 条建议；容量不足保存省略计数及完整风险结果。

准备动作先持久化 `requestId`、参数及幂等身份，再读取当前业务版本生成预览。执行只接受持久化的 `intentId`，经原生确认后重验目标版本、期限、身份、归属、风险来源和对象版本。业务变更、ActionRun、风险血缘、目标意图和 usage 同一项目 SQLite 事务提交。关联保存失败回滚业务写入，未解决 admission 保留。

未知结果沿原 request/ActionRun 对账，不能换键重放。当前动作修改任务描述或创建任务，不修改截止日期、依赖或自动完成项目。人工风险复核追加保存，不覆盖规则的原始结果。

风险检查、动作和独立验收共用 `goal-usage-ledger.js`。已报告实际用量是不可降低的下界，未知费用/耗时保留 `null`；无模型的原生操作 token/模型费用为零。已消费预算不能靠停止或恢复返还为派发权限。

## 5 独立验收与停止控制

`project-goal-completion.js` 要求用户明确配置条件及类型映射：

| 条件                            | 业务判据                                                 |
| ------------------------------- | -------------------------------------------------------- |
| `all-tasks-completed`           | 项目非空，当前全部任务为 completed；取消任务不能替代完成 |
| `selected-risk-signals-cleared` | 当前显式选择的逾期/未完成直接依赖信号已消除              |
| `all-goal-actions-resolved`     | 无 draft/prepared/running 目标动作                       |
| manual                          | strict/high 原生 ApprovalGate 确认当前版本人工条件       |

配置推进版本，旧计划/人工确认失效。检查读取新风险与动作成员快照；完成操作再次核验当前业务行。完成 CAS、来源、回执、verifier usage 及关闭巡检同项目事务提交，不能复用过去一次通过的检查。失败或到期记录实际 usage，不生成完成证明。`cc_project_goal_acceptance` 有界保存计划、确认和历史，回读复验 digest/version、原生来源与 usage。

停止本次 occurrence 持久保存停止意图，然后投影到调度库；`stop-requested` 等待真实结算才变 `stopped`，未来巡检配置保留。暂停目标禁止未来派发，在途任务仍须排空。结束跟进置目标为 abandoned 并关闭未来巡检，先 `end-requested` 后 `ended`；它不是验收完成。项目库与调度库之间没有共同原子事务。

## 6 RRSI 五池与完整计账

五池为训练（train）、选择（select）、验证（gate-validation）、测试（gate-test）与审计（audit）。冻结 campaign 绑定来源关系、目标、父版本、模型/运行时与统计合同；A 是固定基线，B 是无正则 RSI，C 是 RRSI。来源关系连通分量用于独立组，重复 seed 不能增加独立样本数。声明校验不证明真实来源独立性。

准备、筛选和终评采用三阶段预占，覆盖 token、工具调用、墙钟、费用和执行次数。课程规划、探索、候选提议、记忆蒸馏、失败重试、环境重置共享不可退还的尝试上限。未知/未结算执行、超支或未确认清理阻断新派发；只允许独立签名结算同一执行。真实文件锁、Ledger head CAS 和 witness 保留响应丢失后的对账身份。

原生测量图冻结 C–B、C–A、B–A 三角采集，每 task×seed×arm×variant×target 有两份计划观察。完整原生批次、签名 enrollment/admission、cohort 行和 census 绑定计划及真实 History；缺行、额外行、重复槽位、版本替换或旧 admission 均不能缩减原分母。三角采集不代表增加确认性 B–A 假设。

## 7 统计 v2、预注册与必需质量回执

v2 先在任务内聚合固定重复，再按来源组和事前权重计算差值。统计 family 包含完整比较×池×variant×target，冻结 alpha、bootstrap/RNG 承诺、minimum groups、停止规则和操作上限。区间采用 cluster bootstrap 与有限样本 Hoeffding 界的外包络；合成覆盖率网格仍为 HOLD，没有认证生产校准。

`rrsi-native-statistics-protocol.js` 将 scope 协议写入耐久 History，强制注册早于受控预占/派发；尚未认证外部真实观察时间。纯 plan 不自行授予 `preObservationRegistrationVerified`。原生批次和 launch admission 绑定该已登记协议，不能看到结果后缩小 family 或增加预算修改旧历史。

质量回执只接受真正带私有品牌的 census 和原计划，重新计算统计并保留原 Gate veto、全分母、费用缺口及 History head。当前 v1 固定 `decision:HOLD`、`qualityVerdictVerified:false`，JSON 克隆、callback 或外部 PASS 不能替代。`freezeNativeCandidateV2` 返回 `QUALITY_HOLD`；新的泛化预占/派发缺少有效选择质量准入即拒绝。重开的历史快照不恢复 live 品牌或当前执行权限；旧冻结及已预留记录仅按原身份对账。

## 8 Registry / History / backend 关联

`rrsi-registry-history-binding.js` 将实际 backend、History、Registry、transaction ports、ArtifactPorts 和 resolver 绑定为私有品牌。v2 effective parent 和 PM runtime 校验同一对象/存储图，预占及调用实际 host 前重验。相同路径新开的对象、复制描述符或另一 History 不能替代；当前真实 Release Registry 的内部恢复及读取避免可覆写方法和 caller 函数属性。

这仅证明当前组装关联。输出仍保留 `originCutoverAuthenticated:false`、`registryStoreIdentityAuthenticated:false`、`originClassificationAvailable:false`、`productionAuthorityVerified:false`。永久来源登记、按 tenant＋实际 contentDigest 的来源门、transition lease 内核验、两个 Registry 的 writer floor/维护排空与 cutover 恢复仍需交付，不能由 sidecar 或 quiescent 声明代替。

## 9 Palantir 与运行时补齐

第五批增加原生受控任务创建、风险到描述 ActionRun 的事务血缘、独立人工反馈，以及默认元数据审计与受限诊断存储。低代码 REST 连接器有真实 HTTP(S) HEAD 探针、超时和错误状态，但设计发布仍不等于应用运行部署；SCIM 出站同步未接通。PDH 历史投影 dry-run 和 consumer 运维保留 running/unknown，当前宿主仍为内存 KG/BM25，无向量目的地。

Linux 的 `process-ownership` 恢复核验并停止指定持久 cgroup，确认清理后解除隔离，不恢复任务执行；Windows/macOS 不支持此恢复命令。Windows 原生 evaluator 的墙钟限制、能力诊断和 review admission 保留缺证/清理失败；诊断不能代替实际 launch 的能力授权。完整 VERIFY01 Windows 原生 native36/Vitest review 后端仍 `NOT_READY`：可信工具链与锁定测试支持未实现，`readyTasks:0`、`fullReviewPackReady:false`、执行 `NOT_RUN`；这不否定已经可运行的有界原生诊断。冷启动、模式及生命周期证据仍按原采集来源和执行分母评估。

## 10 验证与待完成

目标验收批为 30 个互不重叠文件、545 项通过（CLI 292、Desktop 172、Renderer 79、隔离打包 2），包含 13 项真实 Node 子进程恢复。RRSI 后端关联批 170 项通过、1 项既有 Windows 平台跳过；预注册批 441 项通过、质量回执批 86 项独立用例通过。Palantir 第五批 1481 项通过。各历史批次存在重叠，不相加为独立总数；这些是研究目录保存的既有本地记录，本次文档同步不重认证实现测试。

真实 Electron GUI、业务效果、模型/真实账单、五池来源认证、统计校准、完整生产来源/晋级门、记忆与通知、场景包和准确主线提交的完整发行验收仍开放。工作区未提交的 Memory adapter、async lock 和 Registry 维护代码不列为本基线已完成能力。

## 11 来源与关联文档

- [Dots/Muse/Mods 实施进度](https://github.com/chainlesschain/chainlesschain/blob/36ca503291/docs/research/agents/dots-muse-mods-implementation-progress-2026-10-07.md)
- [RRSI 实施进度](https://github.com/chainlesschain/chainlesschain/blob/36ca503291/docs/research/agents/rrsi-implementation-progress-2026-10-07.md)
- [Palantir 实施进度](https://github.com/chainlesschain/chainlesschain/blob/36ca503291/docs/research/palantir/palantir-gap-implementation-progress-2026-10-06.md)
- [项目目标用户指南](https://docs.chainlesschain.com/chainlesschain/project-goals-current.html)
- [RRSI 使用与证据边界](https://docs.chainlesschain.com/chainlesschain/rrsi-current.html)
- [既有数据与受控动作设计](./data-actions-update-2026-10-06.md)
