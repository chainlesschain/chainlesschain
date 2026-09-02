# ChainlessChain 对照 WikiSkill、Claude Code 与 Codex 的自进化差距与优化建议

> 审计日期：2026-09-01<br>
> ChainlessChain 仓库基线：`b7aab9d3c0f92ddcaaebcbad7ca3b24b14af9f14`<br>
> 产品版本基线：根项目 `5.0.3.54`、CLI `0.166.15`、Desktop `5.0.3-alpha.135`<br>
> WikiSkill 基线：arXiv `2608.27454v1`，2026-08-27<br>
> Claude Code 基线：`2.1.251`，2026-08-28<br>
> OpenAI Codex 基线：Codex CLI `0.151.0`，2026-08-29<br>
> 二次复审：2026-09-01，重点核对“可直接复用的本项目底座”、最新版本增量与论文结论边界<br>
> 参考章节格式：[`CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md`](./CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md)

## 1. 结论先行

WikiSkill 对 ChainlessChain 最重要的启发，不是再增加一个名为“自进化”的模块，而是把现有学习零件收敛为一套**受控的软件发布系统**：

```text
不可变经验 Raw
    ↓
可纠错、可积累的 Wiki
    ↓
一次只改一个 Skill 的 candidate patch
    ↓
独立 Eval / 安全 / 权限门禁
    ↓
shadow / canary / active / rollback
```

其中，经验是证据，Wiki 是可维护的中间表示，Skill 是编译产物，Eval、权限和人工审阅是发布门。

当前 ChainlessChain 已有 Trajectory、Outcome Feedback、Reflection、Skill Synthesizer、Skill Improver、Eval、Rollout、Record & Replay、Memory、Hooks 和 Desktop Phase 20 等零件，但还没有形成完整的：

`Raw → persistent Wiki → candidate Skill → validation gate → promote / rollback`

这里的“没有形成”是指**尚无覆盖 Synthesizer、Improver、普通 Skill、CLI/Desktop/Graph 的 canonical 闭环**，不是说仓库完全没有生命周期原语。Record & Replay 已实现 `draft→approved→validated→enabled→revoked` 的窄域纵切，Plugin runtime 也已有不可变版本、active pointer 与事务恢复；正确方向是推广和统一这些实现，而非从零开始。

二次复审后，最值得本项目借鉴的并不是再造新基础设施，而是复用现有底座补五个“连接件”：

1. 在现有 [`CAPABILITY_MANIFEST`](../packages/cli/src/lib/capability-manifest.js#L32) 声明 evolution capability ID/静态 gate，再由 `cc agent --capabilities` 输出带 manifest digest 的运行时 status projection，如实公开 `implemented/wired/verified/defaultEnabled/mutationScope/lastEvidence`；不要另建第二套 capability 清单，也不要把易变证据写进静态 manifest digest。
2. 把 Record & Replay 已有的 approval/replay/CAS 生命周期与 Plugin runtime 的不可变版本、active pointer、journal/recovery 抽成通用制品激活端口，不从零重写 Skill Registry 事务。
3. 复用 [`GoalConditionEngine`](../packages/cli/src/lib/goal-condition-engine.js#L301) 的确定性完成条件、token/cost/time/turn 预算，以及现有 worktree/checkpoint，先做“单候选→评分→保留更优→预算停止”的离线纵切闭环。
4. 修复现有 Desktop Skill metrics 接线，并结合 CLI name-level attribution 补 `SkillInvocationReceipt`，把 Skill digest、路由理由、模型/工具/环境/权限指纹和真实 outcome 连接起来；否则无法判断“用了哪个 Skill”是否真的改善结果。
5. 把模型切换、工具结果进入模型前的投影、基础设施故障分类设为证据边界，防止混合模型归因、工具注入和瞬时 MCP/权限失败被错误编译成 Skill 规则。

这五项的投入产出比高于先建设完整 Wiki UI 或新的“自进化”服务；其中第 1、2、5 项属于自动 mutation 开启前的 P0，第 3、4 项属于最小可用闭环的 P1。

源码审计显示，当前被“自进化”命名覆盖的实现实际分为三类：

1. **指标或演示壳**：按公式递增 accuracy、返回固定预测或状态字符串，并没有训练模型或进化 Skill。
2. **尚未接入生产主链的真实组件**：例如 CLI learning hooks 和 `SkillImprover`，静态引用扫描只命中定义，没有找到生产调用点。
3. **接入后可能产生高风险副作用的 writer**：若 `SkillImprover.skillsDir` 指向当前运行时 Skill 树，它会在缺少 candidate/Eval/promotion 语义时原地覆盖 `<skillsDir>/<name>/SKILL.md>`。当前未找到生产构造点，且 CLI loader 在后续 materialize 时有 digest drift/再授权防线；这降低了静默执行风险，但没有补上 mutation-time gate。

这里的优先级按“何时成为发布阻断”定义：当前高风险 writer 尚未接入主链，因此 P0 主要是**启用任何自主 active Skill mutation 之前必须关闭的门禁**；P1 是闭环主能力；P2 是闭环稳定后的产品化与规模化。建议顺序为：

- **P0：先保证真实、安全、可恢复。** 冻结任何未经门禁的 active Skill 自动写入，消除幻影成功，建立 candidate、独立验证、原子晋级、回滚、可信审计和演化数据安全边界。
- **P1：再建立统一演化内核。** 形成 canonical Raw/Wiki/Skill 三层控制面，统一 CLI、Desktop、Graph、Eval、Memory 与 Skill Registry，补齐模型与运行环境兼容矩阵。
- **P2：最后扩展产品体验和规模。** 建立演化工作台、Skill 检索路由、跨设备团队知识、跨模型来源/目标适配和长时在线适应。

在 P0 门禁关闭前，不应把当前 `learning synthesize`、`SkillImprover`、CLI/Desktop `self-evolving` 指标壳描述为生产级自主进化。

### 1.1 当前实施完成情况（截至 2026-09-02）

本节记录本报告转入实施后的当前状态，实施基线截至提交 `4381aece2c`。状态采用两层口径：**“已提交”只表示一个可独立审查、已验证的基础批次完成，不等于对应路线项已经达到第 9 节的生产验收标准**；只有剩余项全部关闭后，路线项才可标记为“完成”。

2026-09-02 已提交窄纵切 `881abf6090`：类型化 matrix receipt envelope 只携带有界 `receiptDigest`，`SkillPromotionController.promoteEvaluated()` 在消费 mutation authority、创建 release prepare 或改写 active state 之前，使用独立 verifier 校验完整 signed matrix receipt，并把 candidate content、dependency lock、runtime manifest、target matrix、active digest/revision 和 `accepted` decision 绑定到同一次晋级。既有 release intent 继续通过 `evalReceipt` digest 固定这份证据。

同日提交 `1a70a880fa` 补齐 typed、digest-bound receipt-resolution 端口：evaluated promotion 不再接受调用者直传完整 matrix receipt，而是用授权 envelope 中的 tenant 与 `receiptDigest` 向声明为 trusted 的类型化 resolver 取回证据；resolver authority/revision/handler digest、tenant、receipt digest 和规范时间戳必须完全匹配，之后仍须由独立 verifier 对 receipt 做密码学认证。该批次只建立 fail-closed resolver 契约与连接点，不把 resolver 的自声明描述符等同于密码学 attestation，也不代表已有真实跨进程持久存储 adapter 或持久 child-receipt resolver。

提交 `0feb536d82` 继续关闭 production composition 的直接绕过面：resolver 与独立 verifier 被收敛到构造期创建的 branded evaluated-promotion provider，`SkillPromotionController` 新增显式 `evaluated-only` 策略；启用该策略后，普通 `promote()` 会在 mutation authority consume、ledger prepare 和 active state 修改前失败关闭，`promoteEvaluated()` 也不再接受逐调用替换 resolver/verifier。该批次提供的是可被生产 adapter 强制选用的组合原语；仓库尚未发现真实生产构造点，因此不能宣称所有生产入口已经完成切换。

提交 `face4e9250` 新增 attested、bounded、freshness-checked durable retain/resolve 生命周期适配器：它在 Eval 后向构造期捕获的外部 durability authority 提交完整 matrix receipt，并要求 retain acknowledgement 与后续 resolution 同时满足 `authenticated=true`、`durable=true`，且完整绑定 authority/revision/handler digest、tenant、matrix receipt digest 和独立 persistence/resolution receipt digest。上述字段被规范 payload digest 与独立 attestation trust/verifier 共同承诺；retain/resolve 受构造期最大操作时限约束，超时会触发 AbortSignal；签名时间还必须落在可信时钟、最大证据年龄和固定时钟偏差构成的窗口内。密钥轮换采用一个 active trust 加至多 8 个有界 grace trust，所有 keyId 全局唯一，旧密钥只在显式 `notAfter` 窗口内可用。重新创建 adapter 后可通过同一外部 authority 恢复 receipt，非 durable 确认、receipt substitution、无效签名、过期重放、过期 grace key、重复 keyId 或永久悬挂均不能进入 promotion provider。该适配器不自建第二套文件存储，也不把测试 HMAC/shared backend 等同于生产 PKI、数据库或 WORM；协作取消也不等同于进程级 hard kill。真实跨进程后端、密钥生命周期运营和故障恢复 E2E 仍未完成。

提交 `3b76883a81` 进一步补上 authority attestation 撤销基线：精确描述符必须提供正整数 revision 与至多 64 个唯一 revoked keyId；当前 active key 已被撤销时 adapter 拒绝构造，grace key 即使仍在 `notAfter` 窗口内也会以独立 `REVOKED` 结果失败关闭。revocation revision 会传入构造期捕获的 verifier，避免 verifier 在不知道撤销快照版本的情况下给出认证结论。该批次只建立 fail-closed 数据模型与组合契约，不宣称已经具备在线 CRL/OCSP、撤销发布认证、跨进程刷新、应急轮换或生产演练。

提交 `23125c71e4` 同时纳入 narrow evaluated-promotion control-plane facade：构造时必须提供 branded evidence provider，并强制创建 `requireEvaluatedPromotion=true` 的 controller；返回面只暴露 `promoteEvaluated()`、授权 `rollback()` 及不可变 provider identity，不暴露 direct `promote()` 或底层 controller。该原语减少了生产 adapter 误用宽控制器表面的机会，但仓库仍没有真实生产构造点，因此不能把“安全装配入口已可用”改写为“生产入口已切换”。

提交 `23125c71e4` 合并关闭 EVO-P0-1 truth cutover、EVO-P0-2 transaction acceptance 与上述受限 evaluated-promotion facade：正式 learning/evolution/Desktop 表面不再报告 phantom success；Candidate/Promotion/Rollback 通过 100 并发单赢家、五阶段 crash/recovery、真实子进程重启和 `<60s` 字节级回滚验收。提交 `be547ba42f` 随后关闭 EVO-P1-8 SkillInvocationReceipt 跨端纵切：canonical schema 移入共享 `session-core`；Desktop Registry→BaseSkill→MetricsCollector 将 receipt 持久到数据库 `context_json`；CLI `run_skill` 将同一 receipt 随 tool result 持久到 transcript；automatic-candidate/canary 缺完整归因字段会在执行前失败关闭；共享 verifier 与 trace projection 可确定性回答选择、路由、环境、判定和成本。

提交 `4381aece2c` 继续关闭 EVO-P1-9 candidate-only 有界评分循环：固定 baseline/split/grader/runtime/gate/root budget 后，每轮只接受一个候选，按确定性 grader→隔离 evaluator 顺序执行并持久确认 receipt；best 只有在预注册 gate、根预算及 active-state 不变式同时通过后才更新。provider/MCP transient、sandbox/evaluator crash 与 permission/policy denial 被明确归类且默认不记为 Skill 负样本；未知证据、receipt 未持久确认和 active 漂移均失败关闭。循环复用 `GoalConditionEngine` 的预算和 snapshot/restore，支持确定性 round key 与恢复重放，不接受 active/promotion writer。

本批次完成 EVO-P1-3 Wiki-informed Single-Skill Proposer：控制面先按固定顺序只读 Wiki index、Skill impact、active Skill digest 与训练摘要，证据矛盾或样本不足直接 `needs-evidence`；模型只能按显式请求选择性追加 pattern/raw，且最多重试一次。通过校验的 proposal 必须固定为单一 Skill，携带等价 `PURPOSE.md` 结构、digest-bound pattern/source lineage、适用/禁用条件、失败反例、回退、验证、requested capabilities、target runtimes、上下文预算和 candidate-root 内 machine diff，最后只写 candidate sink。

本批次继续实现 EVO-P1-2 Evidence-backed Wiki Maintainer 的仓库控制协议：新增 tenant-scoped、digest-bound Wiki state/revision/evidence schema，Maintainer 构造期权限固定为只读 trusted projection 与写 Wiki revision，显式拒绝 raw evidence、active Skill、shell、network 和 secret 权限。确定性 reducer 已覆盖 pattern/index/evolution-log/skill-impact/evidence reverse-dependency，支持等价 cluster 去重、同 kind merge、counterevidence/contradiction、半衰期 confidence decay、expiry/stale、revoke/tombstone 以及 proposal decision impact；单一 model inference 只能保留为不可操作 hypothesis，只有多 trust-domain 来源或真实 grader receipt 才能使 procedure 进入 corroborated/actionable。proposal rejection 追加 impact、降低 operational confidence 并保留历史，不回滚 Wiki revision；decision 字段必须与认证 receipt digest 精确绑定，禁止替换 candidate/outcome/pattern/reason。持久端口使用 expected state digest 做 CAS，并要求 acknowledgement 精确回绑 revision/state digest 与 canonical EvolutionRun ID。13/13 定向测试通过。该批次尚未提供真实跨进程 Wiki authority/ArtifactStore+Ledger adapter、并发 writer/restart/迁移验收和真实 ingress，因此路线项保持“部分完成”，不把端口 mock 当作持久生产纵切。

后续批次新增 `WikiMaintainerLedgerAdapter`，不自建第二套文件存储：完整 Wiki revision 以新增的有限产品类型 `wiki-revision` 写入现有 `EvolutionArtifactPorts`，且只有 `evolution-ledger` purpose 可取得 ledger retention；随后用现有 `EvolutionLedger.appendDomainEvent()` 的 head/sequence CAS 追加 `wiki.revision.committed`，事件 subject 精确绑定不可变 artifact ref，前一 revision ref 进入 source lineage。读取时只接受 ArtifactPorts 工厂产生的 branded read-only resolver，并复核 durable record、artifact tenant、audience、purpose、revision/state/EvolutionRun digest；伪造 resolver 在读取前即被拒绝。响应在 ledger append 后丢失时，相同 revision 可从持久事件恢复为幂等成功；同一 Wiki baseline 的不同并发 revision 只能有一个提交。新增真实组合测试让 revision 经过实际 EvolutionLedger 文件、签名/witness 与 ArtifactStore 后，由全新的 Ledger/adapter 实例恢复同一 state digest。适配器 6/6、Maintainer 13/13、真实 ArtifactPorts 25/25 和 EvolutionLedger 45/45 通过（另 1 项按平台条件跳过）；结合 Ledger 既有进程退出/重启与并发验收，本路线项在仓库内可独立关闭。真实 Agent evidence ingress/生产切换归 EVO-P1-6，通用旧账本迁移归 EVO-P0-5，敏感 evidence retention/crypto-shredding 归 EVO-P0-4/P2-6，不再在本项重复挂账。

本批次开始实现 EVO-P1-7 结构化 Memory 与权力分离：共享 `session-core` 新增 canonical append-only memory event/projection/snapshot，明确 `episodic/semantic/procedural/policy` 四层。episodic 只允许首次追加或 governor tombstone；子 Agent/Proposer 的 semantic 事实只进入带 evidence 的提炼队列，必须由独立 critic+evaluator receipt 和 governor 才能接受，且接受时不可替换 content/artifact/evidence lineage；procedural 只接受 promotion-controller 与 promotion receipt；policy 只接受非自动 human governor 与 policy receipt。memoryId 不得跨层复用，metadata 拒绝 raw content/secret，增量投影 state 必须由上一 projection digest 绑定。运行时 append 不再信任调用者自报 actor/role，只消费 session-core 工厂签发的 tenant-bound branded authority，伪造或跨 tenant authority 在 persistence 前失败。Compaction 强制保留 requirements、decisions、open risks、failed attempts、tests、goal state、delegated tasks 和 memory lineage；`PostCompact` verifier 或持久确认失败/抛错均保持并返回上一快照。后续持久批次新增 `StructuredMemoryLedgerAdapter`：event/snapshot 分别作为有限 `structured-memory-event`/`structured-memory-snapshot` 类型写入真实 `ArtifactStore`，只允许 `evolution-ledger` purpose 使用 ledger retention，再以 head/sequence CAS 追加类型化 Ledger event；读取只接受 ArtifactPorts branded resolver，并复核 durable record、tenant/audience/purpose/type 与 subject ref。相同 event 在 append 响应丢失后可恢复为幂等成功，不同并发 event 不能占用同一 memory sequence；新控制面实例会校验 event/snapshot digest、边界 event root 和 projection digest 后恢复。控制协议 14/14，adapter 4/4，连同 ArtifactPorts 共 29 通过、1 项按平台条件跳过。critic/evaluator/promotion/policy receipt 的 branded resolver 与真实 PostCompact hook 的 production composition 接线仍未完成，因此 P1-7 保持部分完成。

后续验收批次把该 adapter 接到实际 `EvolutionLedger` 文件、签名与 durable witness，而不是只使用端口级 fake：event 与 snapshot 写入后，重新创建 Ledger 和 Memory adapter，可恢复完全一致的 projection/snapshot，并验证两个类型化 domain event 的 sequence/head。Memory adapter 5/5 通过。由此关闭 P1-7 的实际 Ledger 文件/witness 专项 reopen 缺口；剩余仅为四类 receipt 的 branded resolver 和真实 PostCompact hook/production composition。

后续权力分离批次不再允许运行时调用者直接提交 critic/evaluator/promotion/policy digest：新增 tenant-bound branded receipt provider，构造期固定 resolver、独立 verifier 与 authority id/revision/handler digest；按 transition 所需的精确 receipt kind 集合解析完整 receipt，并在持久化前复核 accepted decision、tenant、memory/layer/action、content/artifact/evidence 全绑定。PostCompact 同样改为 branded verifier，必须调用构造期固定 hook，并校验 authenticated result、authority identity、candidate/projection/previous snapshot digest、decision、时间与独立 attestation；普通返回 `true` 的伪 hook 不再可装入控制面。`StructuredMemoryLedgerAdapter` 在构造期同时固定这两个 provider，`createMemory()` 不暴露逐调用替换点。控制协议 19/19、`session-core` 全量 538/538、adapter 6/6 通过。真实 receipt resolver 后端、真实 CLI/Desktop PostCompact hook adapter 及最终 Agent production composition 仍未接线，因此继续保持部分完成。

后续真实 authority 批次先为 receipt 增加 canonical content-addressed digest 与 issuer id/revision/handler 绑定，再新增 `StructuredMemoryAuthorityLedgerAdapter`：完整 critic/evaluator/promotion/policy receipt 进入有限 `structured-memory-authority-receipt` ArtifactPorts ledger-retention 类型，以类型化 Ledger event 建立 digest→不可变 subject 索引；retain 与 resolve 均执行独立签名 verifier，响应丢失可按同一 digest 恢复。实际 Ledger 文件/签名/witness 测试覆盖 receipt→semantic proposal acceptance→snapshot→全新 authority/memory adapter 恢复。CLI `PostCompact` adapter 已等待现有 Hooks V2 的真实 decision-capable producer；零 hook、block、失败 result 均拒绝，成功结果固定 hook outcome digest 并由构造期 attestor 签名后才能更新快照。Memory/authority adapter 8/8、PostCompact adapter 5/5、ArtifactPorts 25/25 通过，另 1 项按平台条件跳过。剩余为实际 critic/evaluator/promotion/policy producer 写入、Desktop PostCompact adapter 与最终 Agent production composition。

Desktop 后续批次复用同一 session-core branded PostCompact 契约，并接到现有 `HookSystem.trigger("PostCompact")`：完整等待所有匹配 hook，要求至少一个 hook、执行数等于注册数、无 prevent/error，结果摘要与 candidate/projection/previous snapshot digest 一并由构造期 attestor 签名；disabled/零 hook、prevent、error 和不可信签名均失败关闭。Desktop adapter 5/5 通过。由此 CLI/Desktop hook adapter 均已形成；P1-7 余项缩减为四类实际 producer 写入与最终 Agent production composition。

后续 producer 批次先关闭 promotion 写入：新增 branded `StructuredMemoryPromotionReceiptWriter`，并由真实 `SkillPromotionController` 在 `SkillReleaseRegistry` 已完成 CAS、prepare/finalize 与 durable transition receipt 后调用。writer 重新计算 release transition receipt digest，复核 tenant/Skill/active release/state/content 绑定；evaluated 路径还要求 matrix binding 与 transition receipt 中的 eval digest 完全一致。生成的 procedural Memory receipt 固定 release content/ref、release receipt 与 matrix receipt evidence，由构造期 attestor 签名并交现有 authority ledger 持久确认；伪造 writer 在 mutation 前拒绝，伪造 transition receipt 不会进入 authority store。PromotionController 与 Memory ledger 联合回归 26/26 通过。该写入发生在 release commit 之后，若 authority ledger 返回未知结果，调用方会收到失败且可按同一 canonical digest 重试恢复，不会伪报 Memory 成功；跨 release/Memory 的最终编排与 reconciliation 仍归 Agent production composition。P1-7 余项缩减为 critic/evaluator/policy 三类 producer 写入与最终 Agent production composition。

后续 producer 批次关闭 policy 写入：新增 branded `StructuredMemoryPolicyReceiptWriter`，由真实 `RemoteApprovalBridge.consumeAuthorization()` 在 coordinator 已线性消费 lease、`DurableRemoteMembershipHostStore` 已验证并持久采用 signed `lease.consumed` statement 后调用；同步响应与事件监听器竞速时，只接受同一 durable statement 的 first-adopt/replay 二选一结果。writer 复核 consumed status、request/fingerprint/approval binding 和 host statement/receipt hash，固定完整 operation tuple 的 content digest，以 coordinator statement 为 artifact ref，由构造期 attestor 签名并经 authority ledger 持久确认；未品牌化 writer 在连接前拒绝。既有 `consumeAuthorization() === true` 契约保持不变，Memory 写入失败则不放行工具 dispatch。真实 loopback WebSocket、coordinator、host fsync store 联合回归连同 decision/state failure 共 17/17 通过。P1-7 余项缩减为 critic/evaluator 两类 producer 写入与最终 Agent production composition。

后续 semantic producer 批次新增 `StructuredMemorySemanticReviewPipeline`：child/proposer 先通过共享 Memory append `semantic/propose`，pipeline 从持久投影读取且不允许替换 content/artifact/evidence，再并发调用 branded critic 与 evaluator。两类 reviewer 的 producer/attestor/verifier authority id 与 handler digest 四方必须全部互异；只有各自返回 accepted、canonical receipt attestation 经独立 verifier 认证、且两份 receipt 均获 authority store durable acknowledgement 后，固定 governor authority 才以精确 receipt refs append `semantic/accept`。任一 reviewer 拒绝、认证失败或持久确认缺失均不追加 accept，队列继续保持 proposed；已持久的单边 receipt 只是不可消费的孤立证据，不会越权激活 Memory。Semantic pipeline 与共享 Memory/authority resolver 联合回归连同 Ledger adapter 共 12/12 通过。至此四类 producer 写入路径均已形成，P1-7 只剩最终 Agent production composition 与其真实后端配置/恢复验收。

后续 composition 批次先把 policy 路径接入真实 Agent 启动链：`AgentRuntime` 构造期只接受 branded `StructuredMemoryPolicyReceiptWriter`，并沿 `startAgentRepl → startHeadlessRemoteApproval → RemoteApprovalBridge` 原样传递，不进入可序列化 policy/config、UI 或日志。未配置时保持既有行为，伪 writer 在 REPL/网络启动前失败；配置后 remote approval 的工具 dispatch 必须等待 policy receipt 持久确认。Runtime、remote bootstrap 与真实 WebSocket 联合回归 28/28 通过。仓库当前没有可复用的生产 EvolutionLedger/ArtifactPorts 密钥和独立 witness 构造根，本批次没有用测试 HMAC 补默认值；P1-7 仍需把恢复后的统一 control plane 接到 semantic/procedural Agent 入口，并完成真实密钥、witness、重启与 reconciliation 验收。

后续 composition-root 批次新增 branded `StructuredMemoryAgentControlPlane`：构造时必须同时提供实际 `StructuredMemoryLedgerAdapter` 与 `StructuredMemoryAuthorityLedgerAdapter`，并要求 tenant、artifact tenant、stream、audience、purpose 完全相同；critic/evaluator、proposer/governor authority 以及 promotion/policy writer 只能一次性固定，writer tenant 不一致即拒绝。root 在暴露任何 producer capability 前调用 `createMemory()` 完成 event/snapshot 权威恢复，再以该同一 Memory 和 authority store 构造 semantic pipeline；输出只包含恢复摘要和四个窄控制面，不暴露底层 ledger/artifact ports。联合测试让 proposal、两份 authority receipt 与 accept event 进入同一 ArtifactStore+Ledger stream，随后重建 authority adapter、memory adapter 与 control root，恢复 sequence 2、active semantic memory 和精确 receipt refs；相关 Memory/Semantic 联合回归 13/13 通过。剩余为把完整 branded root 接入 AgentRuntime 的 semantic/procedural 使用点，以及生产密钥/witness 与进程重启/reconciliation 验收。

后续 Agent-root 接线批次让 `AgentRuntime` 构造期直接捕获完整 branded control plane，并从其中派生唯一 policy writer；禁止同时配置 standalone writer，避免两个 authority stream 分叉。`startAgentSession()` 将同一对象传入 REPL，REPL 在创建 session host lease、预算根或网络服务前再次验证品牌，并拒绝与 root 内 writer 不同的 policy capability；remote approval 因而继续使用 root 所属 authority stream。测试使用上批实际 adapter 恢复出的 control root 启动 AgentRuntime，并验证伪 root、双 writer 配置和 REPL 直接注入均失败关闭。完整 root 的 semantic/procedural 使用点仍未触发，生产密钥/witness 与进程级恢复也仍待完成。

后续 Agent-use 批次为 `AgentRuntime` 增加窄的 `proposeSemanticMemory()` 与 `reviewAndAcceptSemanticMemory()`，二者只能调用构造期 branded root；联合测试从已恢复 sequence 2 的实际 runtime 追加第二条 proposal、通过独立双 receipt 门并把同一持久流推进到 sequence 4。procedural 侧不向 Agent 暴露 writer，而由 root 的 `createEvaluatedPromotionControlPlane()` 强制注入自身 promotion writer 并继续返回 evaluated-only facade；调用方只要携带 `memoryPromotionReceiptWriter` 覆盖字段即在构造 controller 前拒绝。由此 semantic/procedural Agent 使用面已建立；当时尚缺 root 路径下完整 evaluated promotion 的端到端执行，以及生产密钥/witness、真实进程退出重启与跨 release/Memory reconciliation 验收。

后续 durable-witness 批次将 EvolutionLedger 测试中已验证的文件 witness 语义提炼为正式 `createEvolutionFileWitness()` 端口：签名和验证必须由外部同步 authority 注入，模块不持有 ledger key 或内置共享秘密；owner-only 目录/文件、严格跨进程锁、单调 CAS、完整认证 history、discard accumulator/fence、临时文件 fsync→原子 rename→目标文件及父目录 fsync 共同构成持久边界。store/record/signature/discard 使用精确 schema 与容量上限，genesis、状态字段、history 连续性、当前指针、ancestry checkpoint 和重复 discard 均失败关闭。正式端口已通过 6/6 专项测试，并替换一条真实 EvolutionLedger 崩溃恢复用例，证明新实例能读取 fence 且拒绝已丢弃孤儿尾复活；EvolutionLedger 全量连同专项共 51/51 通过。该实现关闭本机独立密钥 durable witness 缺口，但 signer/verifier 的生产密钥托管和跨主机/远程 witness fault domain 仍需部署配置，不能以测试 HMAC 代替。

后续 evaluated-promotion execution preflight 批次修正了此前唯一 accepted matrix fixture 的不可能状态：`baselineReleaseDigest=null` 不再同时宣称非空 active content 和 revision 7，而可表达 PromotionController 实际接受的空 active CAS（`EMPTY_SKILL_ACTIVE_DIGEST`、revision 0）。同一测试中的两个真实隔离 Gate cell 先生成并验证 signed conjunction receipt，再由 branded durable resolver/provider 重新解析，进入 evaluated-only control plane；真实 `SkillMutationAuthority` 完成 authorize/nonce/audit/consume，一次性 registry transition capability 由绑定 registry 消费，且 facade 不暴露 direct `promote`。Matrix 全量 3/3 通过。该批已证明 accepted evidence 不只停留在 parser/provider，但最终验收仍须把 transition 换成真实 `SkillReleaseRegistry` prepare/finalize，并证明 Agent root 强制注入的 promotion writer 将 procedural receipt 写回同一 Memory/authority stream。

后续 evaluated-release execution 批次将上述 transition 换成真实 `SkillReleaseRegistry`：canonical candidate 与 matrix plan 共用 dependency lock/runtime manifest/target matrix，accepted receipt 绑定实际 candidate/content digest；promotion 经真实 prepare/finalize ledger projection、active pointer CAS 和全新 registry 实例 reopen 后仍恢复相同 release/state。该组合首次发现并修复真实阻断：release receipt 的 `receiptDigests.eval` 保存的是 canonical matrix envelope 的 mutation-domain digest，而 Memory promotion writer 错把它与 matrix receipt 本体 digest 直接比较，导致 release 已提交后 procedural receipt 必然失败。writer 现重建同一 canonical envelope 后计算相同域摘要再校验，同时让 procedural receipt evidence 保留 release transition receipt 与 matrix receipt 两个原始 digest。TargetMatrix/Promotion/Memory 受影响三组 30/30 通过。剩余窄缺口为由实际 `StructuredMemoryAgentControlPlane`/`AgentRuntime` 调用同一路径，并证明 root 强制注入的 writer 将 receipt 写入同一持久 authority/Memory stream，而非测试内独立 authority store。

后续 Agent-root promotion completion 批次关闭上述窄缺口：shared session-core 新增 branded authority capture，composition root 构造期要求 tenant-bound `promotion-controller/service`，伪造、跨 tenant 或错误角色在暴露 producer capability 前失败。`AgentRuntime.createEvolutionPromotionControlPlane()` 返回的 evaluated-only facade 在真实 release commit 与 authority receipt durable ack 后，自动以固定 promotion authority 追加 `procedural/accept`；事件的 content/artifact/evidence/receipt ref 全部从已认证 promotion receipt 派生，调用方不能注入 digest。组合测试贯穿两个真实隔离 Gate cell、signed matrix receipt、durable resolver/provider、mutation authority、真实 `SkillReleaseRegistry` prepare/finalize/CAS/reopen、root-owned promotion writer、共享 ArtifactStore/Ledger 及 procedural projection。测试还模拟 Memory ledger 已提交但响应丢失：调用返回 `CC_PROMOTION_MEMORY_COMMIT_PENDING` 和 `release-committed-memory-pending`，随后 `recordPromotionMemory()` 仅凭已持久 receipt 幂等恢复；全新 root 能恢复同一 active procedural memory，再次 reconciliation 返回 recovered 而不重复追加。CLI 受影响四组 39/39、session-core 专项 20/20 通过。仓库内 Agent composition 已闭合，剩余是生产 signer/verifier 密钥托管、跨主机 witness fault domain，以及真实 OS 进程退出/重启下的 release/Memory reconciliation 演练。

后续 file-backend composition 批次新增正式 `createEvolutionLedgerFileBackend()` 构造根：ledger 与 witness 的 signer/verifier 继续只以外部端口注入，强制使用不同 signer、verifier、keyId、trust policy，并要求 event、authority 与 witness 路径互不重叠；返回的 branded descriptor 不暴露签名端口。专项测试通过两个顺序启动、PID 不同的真实 Node 进程重开同一 ledger identity、epoch 与 durable witness；随后仅删除本地 event/authority 根，第三个进程会因仍在的 witness 以 `CC_EVOLUTION_LEDGER_CORRUPT` 拒绝账本“转世”。新增 unit/integration 共 3/3 通过。该批次关闭本机 production-style 构造端口与通用 Ledger OS 进程重启证据；测试 HMAC 仅存在于 fixture，不能替代生产密钥托管，也未证明跨主机 witness fault domain 或完整 release/Memory 的 OS 进程 reconciliation。

后续 promotion-reconciliation 批次移除跨进程恢复对进程 A 内存中 `promotionResult` 的依赖：`StructuredMemoryAuthorityLedgerAdapter.listReceipts()` 只枚举指定 kind 的同 tenant Ledger events，逐项重新解析 ArtifactStore durable record、复核 canonical receipt digest，并以既有独立 verifier 按 resolve 路径重新认证；Agent root 的 `reconcilePromotionMemories()` 仅消费这些已认证 promotion receipts，以 receipt digest 派生确定性 event id 和 metadata，缺失时补写，已存在时核对完整 content/artifact/receipt 绑定后返回 recovered。原 accepted matrix→真实 release CAS 测试现改为 Memory event pre-commit 失败，证明 release 与 authority receipt 已提交后，全新 root 可自行发现并补齐，而非由调用者重传结果。新增三 PID 集成用例进一步让进程 A 写 durable promotion receipt 后退出、进程 B 从真实 ArtifactStore+Ledger+file witness 补写 procedural Memory、进程 C 重开验证幂等且 sequence 保持 1。受影响四组 31/31 通过。剩余 OS 演练已收窄为让进程 A 在同一场景中实际执行完整 release producer 后硬退出；生产密钥托管/部署和跨主机 witness 仍是外部部署边界。

最终 process-kill 批次关闭该窄缺口：集成测试不再用合成 receipt 启动进程 A，而是在独立 Vitest/Node 进程内复用既有两-cell 真实 Gate、signed matrix receipt、mutation authority、`SkillReleaseRegistry` prepare/finalize/CAS 和 root-owned promotion writer；只有 release 与 authority receipt 已 durable commit、Memory event 明确 pre-commit failure 后才发布同步 marker，父进程随后强制终止整个 threads-pool 进程。全新进程 B 不读取 marker 中的授权数据，仅从真实 ArtifactStore+EvolutionLedger+file witness 枚举、解析并重新认证 receipt 后补写 procedural Memory；进程 C 再次重开得到 recovered 且 sequence 仍为 1。process-kill 1/1 及正常 accepted-matrix 路径均通过。至此 EVO-P1-7 的代码、确定性恢复和本机进程级演练已达到仓库闭环；生产 signer/verifier 密钥托管/部署与跨主机 witness fault domain 必须由目标环境提供，继续作为部署发布门而不是用测试 HMAC 伪装成仓库交付。

后续 evidence-artifact composition 批次把 P0-4 既有安全协议接到真实持久边界：`ArtifactStoreEncryptedRawStore` 只把 canonical plaintext 交给构造期捕获的外部 encryptor，要求其返回 tenant-scoped KMS ref 与 AES-256-GCM sealed bytes，ArtifactStore 仅接收密文、cipher digest 和无敏感内容的 lineage，并在返回 receipt 前完成 immutable publication 与字节 readback。`EvolutionEvidenceArtifactAdapter` 先运行既有 source verification、keyed commitment、storage policy、secret/PII redaction、prompt-injection 检测、trust/quarantine 和 attestation，再由独立 bundle verifier 复核；随后分别写入 raw metadata、model-visible projection、trusted projection 与 projection receipt，最后才发布包含四个认证 envelope/ref/digest、source commitment、ruleset digest 和 attestation 的 derivation manifest 作为提交点。真实 ArtifactStore 集成用例证明 Raw 文件中不存在 secret/PII 明文但可由测试 KMS authority 正确解密，五个 projection artifacts 中不存在 canary，新 adapter 实例可逐项认证恢复，注入证据保持 quarantined，manifest digest 替换失败关闭；与 ArtifactPorts 联合回归 72 通过、1 项按平台条件跳过。该批关闭仓库内双层持久化、脱敏/quarantine 与完整 projection derivation manifest 缺口，但真实 Agent/tool pre-model ingress、生产 KMS/HSM、删除/撤销传播、Candidate realpath/symlink/capability 安全、人工 quorum 和 1,000 条生产攻击轨迹仍未验收，故 P0-4 继续保持部分完成。

后续 candidate plaintext guard 批次复用同一 evidence redaction policy，而不是在 Registry 内维护第二套弱正则：projector 导出只读的 `assertEvolutionContentContainsNoKnownSecrets()`，除原 secret/PII 规则外还以 NFKC/default-ignorable 清理和 confusable skeleton 再检查一次；`SkillCandidateRegistry` 的 canonical `normalizeContent()` 在 candidate digest、临时文件和最终文件产生前调用该门。因而 Wiki、record-replay 和 manual-import 共用的唯一 `create()` 路径均不能把 credential、email/phone/government-id/payment-card 或 Unicode 混淆秘密写入 SkillCandidate 明文。新增真实 Registry 负测连续提交 password、email 与全角 password 三个 canary，均返回 `SKILL_CANDIDATE_SECRET_LEAK` 且候选列表保持空；Candidate+Projector 74/74 通过，提交为 `f668598a42`。既有 Registry 已覆盖 strict schema、kebab-case、1 MiB content/2 MiB artifact 上限、realpath containment、non-symlink、single-link、descriptor readback，因此这些不再重复列为 P0-4 未实现；仍缺的是语义恶意指令审查、相对 parent 的 capability/permission diff 与人工 quorum。

后续 human-review promotion 批次把 capability diff 与 quorum 接入真实 active mutation，而非只生成一个 UI DTO：`buildSkillPromotionReviewPacket()` 从认证 Candidate、当前 active release/state 和已验证 matrix binding 确定性生成 evidence 摘要、完整 candidate unified replacement diff、parent-relative capability added/removed/retained/high-risk、Eval receipt 摘要与 target runtimes，并以 packet/candidate-diff/capability-diff 三个 digest 固定。branded `SkillPromotionReviewProvider` 只解析 mutation request 中同一个 canonical `policyReceipt` envelope，经 durable resolver 取得完整 decision，要求 `automated=false`、唯一 human reviewer、签名 verifier、短时效和 exact candidate/packet binding；任何 capability 增量一律要求至少两名不同真人，无增量仍要求至少一名。Agent root 使用的 evaluated-only facade 构造期现强制同时捕获 matrix provider 与 review provider，review 在 mutation authority consume、release prepare 和 active CAS 前完成；review receipt 又通过 release 的 policy receipt digest 与 procedural Memory evidence refs 持久回绑。两-cell Gate→signed matrix→human review→release CAS→Memory pending 正常纵切、producer hard-kill→新进程 reconciliation 均通过；review/controller/registry/release/matrix 五组 82/82，process integration 1/1。顺带修复 process fixture 从仓库根启动时错误解析 `C:\node_modules\vitest` 的 cwd 假设。提交为 `2d7fa726f8`。P0-4 的 capability diff/quorum 仓库门已关闭；真实用户可操作 reviewer UI、生产 human decision resolver/PKI、kill switch/canary 和唯一最终用户入口仍属于 P1-5/P1-6 的未完成产品接线。

后续 content-risk acknowledgement 批次复用证据投影器已有的 NFKC/default-ignorable/confusable prompt-injection 检测，而不是在 reviewer 中复制一套关键词：认证 Candidate 的稳定 finding IDs、是否命中及 `contentRiskDigest` 被纳入 review packet/packet digest；存在 finding 时至少需要两名不同真人，signed decision 必须逐摘要显式确认，否则在 signature verifier、mutation authority consume 和 active 写入前失败关闭。该设计不把包含攻击反例的合法安全 Skill 一概硬拒绝，而是确保混淆恶意指令无法在审阅面中静默消失；review binding 和 procedural Memory promotion receipt 也保留同一风险摘要。全角 `Ｉｇｎｏｒｅ previous instructions` 负测证明未确认时拒绝，review 7/7、Projector+Candidate 74/74、其余 promotion/release/matrix 回归 56/56、process integration 1/1 通过，提交为 `534ca5f4e5`。这关闭 Candidate 静态语义风险发现与人工确认的仓库门，但不替代更广的语义分类器、真实用户 UI、生产 resolver/PKI 或 1,000 条生产攻击轨迹。

后续 adversarial-corpus 批次扩展统一 ruleset 的越权、伪造成功、凭据外传、自授权、关闭护栏及英中同义意图，并同时比较规范词序和去分隔 compact skeleton，使逐字符标点/符号/空白插入不能绕过已有 NFKC/default-ignorable/confusable 处理。确定性语料以 20 类攻击意图 × 10 种大小写/全角/零宽/逐字符分隔/换行/混合脚本变体 × 5 种工具输出/外部内容包装形成 1,000 条唯一候选轨迹，全部必须产生 content-risk finding；Projector+review 55/55、Candidate 单独 27/27、其余晋级链 56/56、process integration 1/1 通过，提交为 `bd3c29b843`。这关闭仓库内 1,000 条合成对抗候选门，不把它表述为真实生产流量、未知攻击召回率或误报率证明；生产 ingress 后的攻击观测和更广语义分类仍未完成。

后续 durable human-review authority 批次不再依赖进程内 decision mock：新增 `SkillPromotionReviewLedgerAdapter`，只有受信 packet builder 产生的 packet 才能进入有限 `skill-promotion-review-packet` ArtifactPorts ledger-retention 类型；approve/reject decision 在写入 `skill-promotion-review-decision` 前必须通过完整 packet/时效/quorum/content-risk binding 与构造期独立签名 verifier。两类不可变 artifact 分别由 `skill.promotion-review.requested/decided` Ledger event 建索引，decision event 必须精确回指 packet subject；同 packet 只允许一个决策，响应丢失可由 event 恢复为幂等成功。新 adapter/真实 Ledger 文件与独立 witness 实例可恢复 pending/approved/rejected 队列，并向既有 branded review provider 提供完全匹配的 decision resolver；伪造 packet、无效签名和 lineage substitution 均在 active mutation 前失败关闭。adapter+review 13/13、ArtifactPorts 25/25（另 1 项按平台跳过）、完整 promotion/release/matrix/process 链 50/50 通过，提交为 `1b30ca030e`。仓库内持久 resolver 已关闭；生产 PKI/密钥部署、用户身份认证、最终 CLI/Desktop surface 与唯一产品入口仍未接线。

后续 offline-audit 批次为真实 `EvolutionLedger` 新增 `exportAuditBundle()` 与无账本/无 ArtifactStore 依赖的 `verifyEvolutionLedgerAuditBundle()`。导出包固定 signed identity、store incarnation marker、完整 legacy/domain event hash chain、逐序号 anchor chain、独立 durable witness，以及逐事件 tenant/ref/digest/resolution receipt/原字节证据；整体另有 canonical export digest。离线 verifier 在调用外部 ledger/witness trust port 前捕获完整 plain-data graph 和 verifier 实现，逐条重算签名域、event/anchor/segment/witness payload、artifact validation aggregate 与原字节 digest，并要求零缺失、零冗余、规范顺序。空账本 genesis、混合事件和删除两个在线 store 后的验证均通过；即使攻击者重算未签名的外层 export digest，截断尾部、修改 signed record、替换 artifact bytes/resolution receipt、重排或追加证据仍全部失败关闭。EvolutionLedger 全量 48/48，连同 ArtifactPorts、Ledger ports、Wiki/Memory/review adapters 共 104 通过、1 项按平台跳过；提交 `27b7e267e9`。这关闭 P0-5 的仓库内离线审计导出/独立验证缺口，但不等同于持久索引/快照、旧数据迁移、规模与故障注入、生产跨进程 authority 或最终 wiring。

后续 authenticated-prefix query-index 批次把公开 `query()`、`queryMany()`、`read()`、receipt verification、audit export 和 ledger verification 接到同一条重新认证的增量加载路径；缓存命中仍逐个重算既有 segment/anchor 文件摘要并校验 HEAD 与独立 witness，外部进程只要追加合法尾部，本进程就只验证新增事件签名后更新状态。认证 state 通过私有 `WeakMap` 建立 eventId/eventDigest O(1) 索引，sequence 直接按连续数组定位；新增 `queryMany()` 将最多 10,000 个 selector 合并到一次锁和一次 state 认证中，默认不批量签发 receipt。5,000 个混合命中/未命中查询在 `<5s` 门内完成且历史 event/domain-event 签名验证次数为 0，另一实例追加后只新增 1 次 event 签名验证；Ledger 49/49、六个相关文件共 105 通过、1 项按平台跳过，提交 `00686ceda8`。这关闭进程内认证增量 prefix 与查询索引缺口，不把内存缓存表述成持久 snapshot；重启后的持久索引/快照、长账本 reopen 基准和迁移仍待完成。

后续 persistent state-snapshot 批次新增显式 `checkpointState()`：以当前 witness digest 命名的不可变 snapshot 同时签名绑定 ledger identity、store incarnation/entry、HEAD/anchor、witness generation/digest 和完整 state digest；state 又逐序号绑定 legacy/domain event chain、anchor chain、内容寻址文件名及每个 canonical 文件字节摘要。重启仍先独立验证 identity、store marker、HEAD 和 witness，再使用 snapshot；命中后重算全部真实 segment/anchor 文件摘要和 schema/chain/digest 关系，但不再逐条调用历史 event/anchor 签名 authority。损坏 snapshot 安全回退到权威日志全验，旧 witness snapshot 即使复制到当前文件名也不能被采用；危险 symlink/hard-link 仍失败关闭。既有 100 并发账本在 checkpoint 后新实例 `<5s` 恢复、历史 event/domain-event 签名调用为 0；Ledger 50/50、六个相关文件共 106 通过、1 项按平台跳过，提交 `9c77318e59`。这关闭可跨重启复用的持久认证 snapshot 与仓库内 100-event reopen 基准；生产量级/资源上限、旧 snapshot retention/清理和旧数据迁移仍未关闭。

后续 snapshot-retention 批次让每次成功 `checkpointState()` 只保留当前 witness 对应的唯一 snapshot；删除严格限制在 authority 根目录、完整匹配 `state-snapshot-v1-<64 hex>.json` 的旧缓存，当前文件永不删除，目录项与 `lstat` 必须同时证明 regular/non-symlink/single-link，删除后同步目录。当前 witness 文件若被 stale replay 占用，checkpoint 明确失败而不覆盖；移除攻击文件后可重建当前 snapshot，并确定性清理损坏旧缓存。Ledger 50/50、ESLint 与差异检查通过，提交 `d6c645aefd`。这关闭旧 snapshot 无界增长与清理边界缺口；生产量级/资源上限仍待目标环境验收。

| 优先级 | 当前判断 | 已完成并写入仓库 | 当前仍需完成 |
| --- | --- | --- | --- |
| P0 | 已完成 30 个基础提交；EVO-P0-1、EVO-P0-2 已完成，P0 整体未关闭 | 能力真值与 mutation freeze 已完成产品表面切换；Candidate/Promotion/Rollback 已完成不可变制品、CAS、journal/recovery、100 并发单赢家和字节级 LKG 回滚验收；可信 mutation authority、独立监督 Eval Gate、signed target-matrix 全 cell 合取门、accepted matrix receipt→promotion/release intent 窄绑定、typed/digest-bound receipt-resolution 端口、evaluated-only controller 与受限 control-plane facade 组合、attested durable receipt lifecycle adapter 及撤销快照基线、密文 Raw→model/trusted projection 的 ArtifactStore 持久组合与 derivation manifest、统一 Candidate secret/PII plaintext guard、parent-relative capability diff、Unicode-aware content-risk digest、1,000 条合成对抗候选与 mutation 前显式 human acknowledgement/quorum、tamper-evident ledger、类型化领域事件、规范执行清单、持久账本端口契约、可离线独立验证的完整 signed audit bundle、认证增量 prefix/O(1) 查询索引、witness-bound 持久 state snapshot 及安全 retention | P0-3～P0-5 仍缺真实跨进程 Eval durability authority/PKI 后端、真实进程级 Eval supervisor 与持久 child resolver、跨 cell 统计校准/多重比较、真实 Agent pre-model ingress、删除传播、更广语义恶意指令分类和生产流量攻击观测；human-review 持久 resolver 已落地，最终用户 UI、生产 PKI 与统一控制面接线归 EVO-P1-5/P1-6 |
| P1 | EVO-P1-1、P1-3、P1-8、P1-9 已完成，P1-2、P1-7 已达仓库闭环；其余主能力仍待验收 | shared EvolutionRun 已统一 CLI/Desktop/Graph 的 Raw/Wiki/Registry/Eval 投影；Wiki Maintainer 已闭环认证 evidence、确定性 pattern/index/log/impact、生命周期、ArtifactPorts 不可变 revision 与真实 Ledger CAS/event/reopen；结构化 Memory 已具备四层写入规则、branded actor/receipt/PostCompact gate、可回退 compaction、ArtifactStore+Ledger event/snapshot、真实 receipt ledger resolver、CLI Hooks V2/Desktop HookSystem PostCompact adapters、critic/evaluator/promotion/policy 四类 producer 写入、同 stream Agent root、authority-ledger 自动 reconciliation、外部 authority 驱动的本机 durable file witness、正式 file-backend 构造端口与实际 release process-kill 恢复；SkillInvocationReceipt 与有界评分循环已闭环 | 生产目标矩阵 Eval、统一 Registry/Agent ingress 仍未完成；P1-7 的生产密钥托管/部署与跨主机 witness fault domain 作为目标环境发布门验收，真实流量接入归 P2 |
| P2 | 未开始 | 尚未把任何 P2 产品能力声明为已交付 | Pilot、Workbench、Retrieval Router、跨设备/团队知识、跨模型市场治理、Wiki pruning 与长时在线适应应在 P0/P1 验收后实施 |

P0 的逐项状态如下；“基础完成”特指底层安全原语已提交，不代表生产接线已经完成：

| 路线项 | 状态 | 已完成部分 | 提交证据 | 未关闭项 |
| --- | --- | --- | --- | --- |
| EVO-P0-1 能力真实性与 mutation freeze | ✅ 已完成 | canonical capability/runtime status；CLI learning/evolution fail-closed 与 metrics-only help；Desktop TechLearning 无制品不再成功；Phase 20 改为 metrics 接线且旧 simulator 未注册；learning/proposer/import writer 全部 candidate-only；产品文档与生成参考完成真值切换；13 文件 295/295 定向回归通过 | `3fdff6c1ee`、`0da1f36a8b`、`c16e1a3912`、`23125c71e4` | 无；通用 Agent/插件等 legacy writer 的统一单写者迁移归 EVO-P1-5，不再作为 learning/proposer 能力声明 |
| EVO-P0-2 Candidate、Promotion 与 Rollback 事务 | ✅ 已完成 | tenant-scoped immutable candidate/release、完整 execution manifest、可信 mutation authority、active CAS、lease/fence、prepare/finalize ledger、journal/staging/pointer recovery、session pin、LKG+dependency lock rollback；五个写入阶段崩溃矩阵与真实子进程退出恢复已覆盖；新增 100 并发候选严格 1 成功/99 拒绝及字节级回滚 `<60s` 断言，三文件 70/70 通过 | `3fdff6c1ee`、`fe16c72d5e`、`ed7882d004`、`233e1bdc3a`、`4cffc53054`、`dfa21b4ba4`、`4f22d70bb5`、`23125c71e4` | 无；shadow/canary 产品编排及唯一最终用户 production writer 的实际构造接线归 EVO-P1-5，跨进程 PKI/Eval authority 归 EVO-P0-3 |
| EVO-P0-3 独立真实 Eval Gate | 单 cell 监督、matrix 合取证据、evaluated-promotion 窄绑定、receipt resolver、evaluated-only 组合、受限 control-plane facade 及 attested/bounded/fresh/rotatable/revocation-aware durable lifecycle adapter 基础完成，生产接线 HOLD | 隔离 target、角色/信任分权、签名 receipt v3、调用/撤销独立证据、hard-termination 收敛、全 run 单调 deadline、descriptor-bound authority root、后验防 TOCTOU；signed matrix plan、tenant durable reserve/finalize 端口契约、verified full child receipt（含 attestation）的有序摘要根、因果时间线与全 cell 一致通过判定；accepted receipt 在 authority consume/release prepare 前绑定 candidate/runtime/target/active CAS，并由 release intent 固定 eval envelope digest；按 tenant/digest 解析完整 receipt 的 fail-closed 端口；构造期 branded provider、拒绝直接 `promote()` 的策略及不暴露宽 controller 的窄 facade；要求 authenticated/durable acknowledgement、验证规范 payload attestation、证据新鲜度、全局唯一 keyId/有界 grace trust、版本化撤销快照，并对 authority 调用施加根时限/AbortSignal 的 retain/resolve 生命周期适配器 | `52427b742c`、`5c2de980d3`、`881abf6090`、`1a70a880fa`、`0feb536d82`、`face4e9250`、`3b76883a81`、`23125c71e4` | train/validation/test 隔离、真实 grader、anti-gaming、跨 cell 统计校准/多重比较；现有生产 adapter 实际构造受限 control plane、真实跨进程 durability authority/PKI 后端、持久 child resolver 与恢复 E2E；生产 attested loader 绑定 descriptor↔callable/真实 settlement 上限；进程级 kill/资源回收；跨进程 plan resolver/reservation/finalization 持久性；认证撤销分发/刷新及生产密钥轮换/撤销演练与目标平台 grace 校准 |
| EVO-P0-4 Raw、入模投影与 Skill 编译安全边界 | 持久组合、Candidate plaintext 与 promotion review gate 基础完成，生产接线 HOLD | attested source→Raw/model/trusted projection；ciphertext-only Raw ArtifactStore；secret/PII 脱敏、injection trust/quarantine 与 derivation manifest；Candidate strict schema/name/size/path/symlink/single-link + Unicode-aware plaintext guard；认证 parent-relative capability diff、evidence/diff/Eval/runtime reviewer packet、Unicode-aware content-risk digest、1,000 条唯一合成对抗候选，以及 mutation 前签名 human acknowledgement/quorum；Projector+review 55/55、Candidate 27/27、其余相关回归 56/56、process integration 1/1 | `b8490faa94`、`b4dca1ee05`、`4cffc53054`、`bc24db7a0b`、`f668598a42`、`2d7fa726f8`、`534ca5f4e5`、`bd3c29b843` | 真实 Agent/tool pre-model ingress 与旧直通路径退役、生产 KMS/HSM、删除/撤销依赖传播、更广语义恶意指令分类与生产流量攻击观测/误报校准；最终用户 reviewer UI 与生产 PKI/用户身份归 P1-5/P1-6 |
| EVO-P0-5 Fail-closed 证据与审计 | 账本、离线导出、认证查询索引与持久 snapshot 基础完成，生产可用性 HOLD | append-only tamper-evident ledger、typed domain events、subject-bound transition、认证制品解析与持久账本组合端口；signed identity/event/anchor/witness/artifact 自包含导出及无在线 store 独立验证；重新认证的增量 prefix、私有 O(1) event 索引、有界 `queryMany()`、witness-bound 不可变 state snapshot 与 single-current retention | `d073bdf3c7`、`233e1bdc3a`、`d098a64253`、`b4dca1ee05`、`dfa21b4ba4`、`27b7e267e9`、`00686ceda8`、`9c77318e59`、`d6c645aefd` | 真实跨进程持久 authority、生产量级/资源上限、旧 projection/journal 迁移、系统化故障注入以及生产 wiring |

P1/P2 当前状态按路线项展开如下，防止提前把“已有依赖”计为“能力完成”：

| 路线项 | 当前状态 | 已复用或提前完成的底座 | 下一关闭条件 |
| --- | --- | --- | --- |
| EVO-P1-1 Canonical Raw/Wiki/Skill | ✅ 已完成 | shared `EvolutionRun` 事件/投影/快照状态机统一 Raw/Wiki/Registry/Eval；CLI/Desktop/Graph 三适配器返回同一状态与 digest；重复、乱序、crash replay、compaction replay、tombstone、敏感内容拒绝及 record-replay direct candidate 共 7/7 通过 | 无；真实 Agent 事件生产接入和旧壳退役归 EVO-P1-6，外部持久 authority 运维归 P0-5 |
| EVO-P1-2 Evidence-backed Wiki Maintainer | 🟢 仓库闭环 | trusted/digest-bound evidence ingress、最小权限 Maintainer、确定性 pattern/index/evolution-log/skill-impact/reverse-dependency、去重/merge/conflict/decay/expiry/revoke/tombstone、digest-bound proposal impact；`wiki-revision` ArtifactPorts ledger-retention 类型、branded resolver、不可变 revision→Ledger domain event、head/sequence CAS、响应丢失幂等以及真实 Ledger 文件/witness 跨实例恢复已接通；Maintainer 13/13、adapter 6/6、ArtifactPorts 25/25、Ledger 45/45 通过 | 本项无仓库内剩余；生产 Agent ingress 归 P1-6，通用迁移归 P0-5，敏感 evidence 删除基础设施归 P0-4/P2-6 |
| EVO-P1-3 Single-Skill Proposer | ✅ 已完成 | 固定最小 Wiki/impact/active/training 读取；矛盾/样本不足 abstain；pattern/raw 选择性读取；单 Skill PURPOSE、digest lineage、适用/禁用边界、反例、回退、验证、capability/runtime/context cost、safe machine diff 与 exact candidate binding；1 文件 10/10 通过 | 无；真实 Wiki authority 的统一生产来源归 EVO-P1-1/P1-2，不重复计入 proposer 控制协议 |
| EVO-P1-4 目标运行时 Eval | 数据模型、单 cell 成对评测、matrix 合取、accepted→promotion 窄绑定、receipt-resolution、evaluated-only 及 attested/bounded/fresh/rotatable/revocation-aware durable lifecycle adapter 基础完成 | dependency lock、runtime manifest、target matrix canonical schema、独立 target/grader/safety receipt 验证、signed plan/tenant-scoped reserve/finalize 持久化端口契约、无缺格的 all-cell conjunction、matrix receipt 与当前 candidate/active CAS 的晋级前校验、tenant/digest-bound receipt resolver 契约、构造期 evidence provider、外部 durability authority retain/resolve、acknowledgement attestation、最大操作时限、证据新鲜度、keyId/grace 轮换及版本化撤销快照基准 | 接入真实跨平台 runtime/grader；现有生产入口构造 evaluated-only controller，落地真实跨进程 durability authority/store/PKI 与认证撤销刷新、跨 cell 统计校准/多重比较、shadow/canary 与持久 child receipt resolver |
| EVO-P1-5 Registry 与单写者治理 | tenant 存储、evaluated+human-reviewed controller、持久 review authority 与受限 facade 原语基础完成 | content-addressed tenant candidate/release、promotion controller、lease/CAS/journal/recovery；root facade 拒绝 direct promotion，强制 matrix+human review provider；review packet 已包含 evidence、candidate diff、权限变化、Eval receipt、target runtime 与 content-risk digest；ArtifactStore+Ledger 持久 pending/approve/reject 队列、真实文件/witness 重开与 provider resolver 已落地，且 active 只接受 signed non-automated quorum approval 和风险摘要显式确认 | 将同一 packet/approve/reject authority 接入最终用户可见的最小 reviewer surface；部署生产 PKI/用户身份；唯一 production writer 的真实入口构造、kill switch、active/LKG/canary 与跨进程部署权威 |
| EVO-P1-6 统一生产接线 | 未开始 | capability status 与 Desktop evidence 已校正部分入口 | 真实 Agent 事件统一进入控制面，并退役或降级重复的 self-evolving 壳 |
| EVO-P1-7 Memory 与多 Agent 权力分离 | 🟢 仓库闭环 | shared canonical 四层 gate、真实 ArtifactStore+Ledger resolver、独立 verifier、四类 producer、同 stream Agent root、新实例恢复、AgentRuntime semantic API、accepted matrix→真实 release CAS/reopen→root-owned procedural event、authority-ledger 自动 pending reconciliation、remote bridge、外部 authority 驱动的 durable file witness、正式 file-backend 构造端口及实际 release process-kill→新进程恢复已接通 | 仓库内无剩余；生产密钥托管/部署与跨主机 witness fault domain 作为目标环境发布门验收 |
| EVO-P1-8 SkillInvocationReceipt | ✅ 已完成 | shared canonical receipt、Desktop DB adapter、CLI transcript adapter、candidate/canary attribution gate、digest verifier 与 deterministic trace projection；5 文件 208/208 通过 | 无；已提交 `be547ba42f`，上层 Eval/Wiki 只需使用已固定的 evolutionRunId/trace/segment/grader receipt refs 做领域 join |
| EVO-P1-9 有界评分改进循环 | ✅ 已完成 | candidate-only 内部控制面已串接 GoalConditionEngine、单候选 proposer、确定性 grader、隔离 evaluator、durable receipt、预注册 best gate、根预算、失败分类、active 不变式及 snapshot/resume/replay；与 GoalConditionEngine 合计 2 文件 31/31 通过；提交 `4381aece2c` | 无；真实流量、人工 review、shadow/canary 明确归 EVO-P2-1，不属于本离线路线项 |
| EVO-P2-1～P2-6 | 未开始 | 无生产能力提前宣称 | P0/P1 验收通过后，再依次开展受控 Pilot、Workbench、Router、团队知识、跨模型治理和 Wiki pruning |

当前验证快照如下；各行均对应已提交的基础批次。测试均采用串行执行以避免 Windows 并发测试进程造成误判：

| 批次 | 验证快照 | 结论 |
| --- | --- | --- |
| EVO-P0-1 truth cutover | capability/learning/writer/authority/Desktop/Phase/keyword/跨表面契约共 13 文件 295/295 通过；真实 CLI help 已核对；manifest/help/reference 生成物无漂移；ESLint 0 error；`git diff --check` 通过 | 路线项已由 `23125c71e4` 提交：正式入口不再把 unavailable、metrics 或内存对象报告为已训练/已进化/已创建 active Skill |
| EVO-P0-2 transaction acceptance | candidate/release/promotion 3 文件 70/70 通过；100 并发完整候选严格单赢家；rollback 原字节与 dependency lock 一致且 `<60s`；五阶段 crash matrix、commit-unknown、真实子进程退出/重启恢复保持通过 | 路线项已由 `23125c71e4` 提交：active CAS、LKG、journal 和 ledger 事务原语达到自身确定性验收 |
| EVO-P0-5 offline audit | EvolutionLedger 48/48，相关 Ledger/Artifact/Wiki/Memory/review 六文件 104 通过、1 项按平台跳过；覆盖空 genesis、legacy/domain 混合链、store 删除后独立验证，以及重算 export digest 后的截断、signed record、artifact bytes/receipt、排序和额外证据篡改 | 提交 `27b7e267e9` 关闭离线导出/验证缺口；索引与 snapshot 后续分别由 `00686ceda8`、`9c77318e59` 关闭 |
| EVO-P0-5 authenticated prefix/index | EvolutionLedger 49/49，相关六文件 105 通过、1 项按平台跳过；5,000 个批量 selector `<5s`，缓存 prefix 不重验历史事件签名，外部实例追加后只验证 1 个新 event | 提交 `00686ceda8` 关闭进程内认证增量 prefix 与 O(1) 查询索引缺口；持久 snapshot 随后由 `9c77318e59` 关闭 |
| EVO-P0-5 persistent state snapshot | EvolutionLedger 50/50，相关六文件 106 通过、1 项按平台跳过；覆盖 mixed legacy/domain state、snapshot/file 逐项绑定、损坏回退、stale witness replay，以及 100 并发事件 checkpoint 后新实例 `<5s` 恢复且历史事件签名调用为 0 | 提交 `9c77318e59` 关闭持久认证 snapshot 与仓库内 100-event reopen 基准；retention 随后由 `d6c645aefd` 关闭 |
| EVO-P0-5 snapshot retention | EvolutionLedger 50/50；覆盖 stale-current checkpoint 失败、攻击文件移除后重建、只保留当前 witness snapshot；ESLint 与 `git diff --check` 通过 | 提交 `d6c645aefd` 关闭旧 snapshot 无界增长和清理限域；生产量级/资源上限、迁移、系统化故障注入及生产 authority/wiring 仍未关闭 |
| EVO-P1-1 canonical EvolutionRun | shared core + CLI/Desktop/Graph adapters 共 7/7 通过；覆盖跨端同状态/digest、重复、乱序、crash replay、compaction replay/append、annotation/tombstone、record-replay direct candidate、冲突/跨 run/敏感内容拒绝 | 路线项已随本批次提交；生产 ingress/旧壳切换归 P1-6，跨进程持久 authority 归 P0-5 |
| EVO-P1-2 Wiki Maintainer 控制协议与持久组合 | Maintainer 13/13、adapter 6/6、ArtifactPorts 25/25、EvolutionLedger 45/45 通过；覆盖多源/grader corroboration、单模型 hypothesis、去重/反证/decay/revoke、proposal/commit substitution、真实不可变 artifact 写入与 branded resolve、Ledger head CAS/文件/witness、新实例恢复及响应丢失幂等 | 路线项仓库闭环；生产 ingress、通用迁移与敏感数据删除分别由 P1-6、P0-5、P0-4/P2-6 统一验收 |
| EVO-P1-7 结构化 Memory 持久与权力分离纵切 | session-core 控制协议 20/20、既有全量 538/538；Memory/authority adapter 9/9、Semantic pipeline 联合回归 12/12、CLI PostCompact 5/5、Desktop PostCompact 5/5、ArtifactPorts 25/25、PromotionController/TargetMatrix/AgentRuntime/reconciliation 受影响回归 31/31、process-kill 1/1、RemoteApproval 联合回归 17/17、FileWitness 6/6、file-backend unit/integration 3/3 通过，另 1 项按平台条件跳过；覆盖 canonical receipt/issuer、四类持久 resolve、独立 critic/evaluator 双门、CLI Hooks V2 与 Desktop HookSystem decision/attestation、四层 reducer、branded actor、真实四类 producer、root-owned procedural append、authority-ledger 自动 pending reconciliation、hydration、ArtifactStore、Ledger CAS/并发/响应丢失、正式 durable file witness、实际文件新实例恢复、本地 Ledger 转世拒绝及实际 release 进程硬终止后的新进程 Memory 恢复 | 路线项仓库闭环；生产 signer/verifier 密钥托管/部署与跨主机 witness fault domain 由目标环境发布门验收 |
| EVO-P1-3 Wiki-informed proposer | proposer 1 文件 10/10 通过；覆盖最小初始读取、矛盾/样本不足 abstention、pattern/raw 选择性加载、单 Skill、PURPOSE lineage、边界/反例/回退/验证、safe diff、tamper、candidate ack failure 与 target runtime substitution | 路线项已随本批次提交；只写 candidate sink，不接收 active writer；统一 Wiki authority 来源归 P1-1/P1-2 |
| EVO-P1-8 SkillInvocationReceipt | shared receipt、Desktop DB、CLI transcript、collector/Phase/pipeline 共 5 文件 208/208 通过；canary 完整归因与缺字段前置拒绝、trace ID 贯穿、digest tamper、deterministic trace join 均有断言 | 路线项已由 `be547ba42f` 提交；普通 incomplete receipt 明确禁止 outcome attribution |
| EVO-P1-9 bounded improvement pilot | 新循环与 GoalConditionEngine 2 文件 31/31 通过；覆盖单候选、grader 顺序、best gate、root budget、provider/MCP transient、permission denial、evaluator crash、unknown evidence、receipt ack failure、active 漂移、snapshot/resume 与相同输入重放 | 路线项已由 `4381aece2c` 提交；仅允许 candidate sink，不暴露 active/promotion writer；真实流量准入继续属于 EVO-P2-1 |
| 证据投影与认证制品持久组合 | evidence projector + encrypted Raw/derivation adapter 47/47 通过；与 artifact ports 联合为 72 通过，Windows 无权限创建 symlink 时另有 1 项按条件跳过；覆盖真实密文文件、projection canary 扫描、新 adapter 恢复、quarantine 与 manifest substitution | 持久组合由 `bc24db7a0b` 提交；真实 Agent/tool pre-model ingress、生产 KMS/HSM 与删除传播仍 HOLD；Candidate 静态语义风险发现已转由下一行的人工确认门处理 |
| Candidate capability diff、content risk 与 human-review promotion gate | Projector+review 55/55、Candidate 27/27、controller/release/matrix 等其余相关回归 56/56；真实 release producer hard-kill→新进程 Memory reconciliation 1/1；覆盖 evidence/diff/permission/Eval/runtime、1,000 条英中/Unicode/分隔混淆候选、content-risk digest、policy envelope、签名/时效、自动/拒绝/低 quorum/candidate substitution、capability 增量双人门及风险摘要未确认拒绝 | `2d7fa726f8`、`534ca5f4e5`、`bd3c29b843` 已让 Agent-root evaluated facade 在 active mutation 前强制 branded human review，并把 review/content-risk receipt 回绑 release/Memory；生产流量攻击观测/误报校准、最终用户 UI 和生产 PKI/用户身份仍归 P0-4/P1-5/P1-6 |
| Durable human-review authority | adapter+review 13/13、ArtifactPorts 25/25（另 1 项平台跳过）、完整 promotion/release/matrix/process 链 50/50；覆盖真实 Ledger 文件/witness 重开、pending/approve/reject、响应丢失幂等、伪造 packet、无效签名与 decision→packet lineage substitution | `1b30ca030e` 已把 packet/decision 放入有限 ArtifactPorts 类型和类型化 Ledger 索引，并直接提供既有 review provider 所需 resolver；生产 PKI/用户身份、最终 CLI/Desktop surface 与唯一入口部署仍归 P1-5/P1-6 |
| Tamper-evident ledger 与 typed events | 相关账本测试 45/45 通过 | 数据模型与 fail-closed 校验基础已提交 |
| Canonical execution manifests | manifest + mutation authority 测试 57/57 通过 | canonicalization、tenant-bound lock、runtime manifest、target matrix 基础已提交 |
| Durable ledger ports + release/promotion compatibility | ledger ports 10/10、release registry 14/14、promotion controller 11/11 通过 | 端口契约可发布为 foundation；当前 O(N) 扫描和缺真实 durability authority 使生产接线继续 HOLD |
| 独立监督 Eval Gate | 128/128 通过，终轮独立复审 RELEASE | 提交 `52427b742c`；可发布为监督/证据 foundation，但真实进程终止、attested loader 与 matrix decision→promotion 生产事务接线仍为阻断 |
| Tenant Candidate/Release/Promotion | candidate + release + promotion 65/65 通过，终轮独立复审 RELEASE | 提交 `4f22d70bb5`；tenant 隔离、恢复和制品绑定基础可发布，生产持久 authority、adapter 组合权与同权限外部篡改防护仍 HOLD |
| Signed target-matrix Eval 合取门 | 3/3 大场景测试通过（含真实 branded Gate 两 cell accepted/needs-more 及攻击断言），两轮独立复审最终 RELEASE | 提交 `5c2de980d3`；可发布为 trusted-composition/all-cell conjunction foundation，不是跨 cell 统计生产门；attested settlement 绑定、真实 hard kill、生产 durable plan resolver/reservation/finalization adapters 与 Promotion 事务接线仍 HOLD |
| Evaluated promotion 窄纵切 | 提交前 matrix eval + promotion controller 定向回归 16/16 通过；相关 evolution 回归 324/324 通过、1 项按条件跳过；另有 ESLint、Node 语法、模块加载与 `git diff --check` 通过 | 已提交 `881abf6090`；accepted matrix receipt 已在 mutation authority consume 和 release prepare 前绑定当前 candidate/runtime/target/active CAS，失败路径保持 revision 0、无 ledger transaction |
| Typed receipt-resolution 端口 | matrix eval 3/3、promotion controller 13/13 定向回归通过，包含 resolver tenant substitution 在 verifier 前失败关闭 | 已提交 `1a70a880fa`；调用者不再直传完整 receipt，resolver authority/revision/handler digest 与 tenant/digest 结构绑定已落地，receipt 仍由独立 verifier 认证；resolver attestation、真实 durable adapter 与跨进程恢复仍 HOLD |
| Evaluated-only controller 与受限 control-plane facade 组合 | promotion controller 15/15 定向回归通过；既有真实 provider 验证和 direct promote 前置拒绝保持通过，新增断言证明 facade 不暴露 `promote` 或底层 controller | controller 基础已提交 `0feb536d82`，窄 facade 已随 `23125c71e4` 提交；生产 adapter 尚未实际构造该 facade，接线仍 HOLD |
| Attested/bounded/fresh/rotatable/revocation-aware durable matrix receipt lifecycle adapter | 13/13 定向测试通过，覆盖跨 adapter 实例恢复、非 durable acknowledgement、receipt substitution、无效 attestation、永久悬挂/AbortSignal、过期签名重放、grace key 窗口、重复 keyId、超长 grace policy、grace key 撤销、active key 已撤销及重复撤销项 | adapter 与版本化撤销快照已分别提交 `face4e9250`、`3b76883a81`；已建立外部 authority retain/resolve、规范 payload attestation、根操作时限、证据新鲜度、唯一 keyId/有界 grace 及 fail-closed revocation 的组合契约；真实跨进程后端、生产 PKI/撤销分发运营、进程级 hard kill、崩溃恢复和生产接线仍 HOLD |

## 2. 外部方案实际提供了什么

### 2.1 WikiSkill：它是研究框架，不是已发布的 Google 产品功能

本文所称 WikiSkill，是 Google Research 与 Virginia Tech 作者于 2026-08-27 发布的 v1 预印本框架，而不是 Google 已正式交付的产品功能。论文没有链接官方实现仓库，因此目前可借鉴的是论文机制和实验结果，不能把其生产成熟度、安全性或可复现性视为已经得到证明。参见 [WikiSkill 论文](https://arxiv.org/html/2608.27454)。

还需限定其适用范围：WikiSkill 验证的是**按数据集运行的离线、批量 Skill 优化**，不是从单次生产任务即时学习的在线系统。每个数据集及独立演化运行从空 Skill/Wiki 开始；每轮对训练集 rollout、提出一个单 Skill 变更，再用反复复用的留出验证集平均分决定是否接受。因此论文中的“persistent”首先指同一演化运行内跨迭代保留，尚未验证跨项目、跨部署或终身持续演化。

WikiSkill 的关键设计不是更新模型权重，而是把 Agent 经验编译为外部、可复用的程序性知识：

| 层 | 论文机制 | 对 ChainlessChain 的启发 |
| --- | --- | --- |
| `raw/` | 保存完整且不可变的执行轨迹 | 原始证据不能被 outcome 回填或后续总结原地改写；应采用 append-only event + deterministic projection |
| `wiki/` | 保存 pattern pages、索引、演化日志和 `skill-impact.md` | 日志不等于知识；需要介于轨迹和 Skill 之间的持久、可纠错、可合并中间表示 |
| `skills/` | 保存 active `SKILL.md` 和回指 Wiki 模式的 `PURPOSE.md` | 每个 Skill 必须回答“为何存在、由哪些证据产生、对什么运行时有效” |
| Inference Agent | 演化训练 rollout 中只读取 active skills，不读取 Wiki | 可作为本项目 Pilot 的默认隔离实验；是否适用于所有生产推理，应按领域对照验证，不能由一次消融直接推广 |
| Wiki Maintainer | 从成功和失败轨迹提炼、更新模式 | 失败不是一次性日志，而应成为跨轮积累的反例与边界知识 |
| Skill Proposer | 基于 Wiki 和选择性 Raw 证据提出单 Skill patch | 一次演化只改一个可归因单元；这是变更粒度，不代表文件或部署事务原子性 |
| Gate | 在留出但每轮复用的 validation split 上严格比较；未提升则恢复上一轮 Skill 配置，Wiki 保留 | 可借鉴“候选不提升就不采用”；它不是统计晋级门、部署事务或外部副作用回滚 |

WikiSkill 直接验证到的是单 Skill 提案、validation score gate 和优化工作区内的 Skill 配置回退；本报告提出的安全/权限门、人工审批、content-addressed registry、shadow/canary 与生产回滚，都是面向 ChainlessChain 的工程化扩展，不应反写成论文已交付能力。

论文结果说明了四个值得直接转化为工程约束的事实：

- Gemini-3.5-Flash 四基准消融中，在 Inference Agent 均不读 Wiki 时，启用 Maintainer 并让 Proposer 使用持久 Wiki，使最终测试平均分由 `48.7%` 提升至 `63.7%`；这支持的是**完整持久知识管线**在该实验设置中的价值，不能只归因于 Wiki 数据结构。
- 同一组消融中，让 Inference Agent 在演化训练 rollout 也读取 Wiki，平均分由 `63.7%` 降至 `60.9%`。论文把可能原因表述为假设，因此本项目应把隔离设为 Pilot 默认和可配置实验，而不是宣布生产推理永远不得访问 Wiki/Memory。
- 五基准测试平均中，Qwen-3.5-9B + WikiSkill 为 `47.4%`，高于无 Skill 的 Qwen-3.6-27B `39.4%`；这说明程序性知识在这组基准中弥补了部分模型规模差距，不能泛化为普遍替代模型规模。
- 跨模型迁移既可能增益，也可能严重负迁移：Qwen-3.5-4B 的 Spreadsheet Skill 曾把 Gemini 从 `50.5%` 降到 `18.1%`；因此“源模型有效”不能替代目标模型、工具集和环境上的重新验证。

WikiSkill 本身也有明确边界：论文采用全量 Skill 注入，没有验证大规模检索和触发；严格 `>` gate 会拒绝中性但可能有后续价值的基础 patch；没有自动 Wiki pruning；验证集较小；没有覆盖数百步、数小时的在线适应；也没有报告隐私、prompt injection、恶意 Skill、权限扩大或供应链安全评测。

### 2.2 Claude Code 最新进展与不足

截至审计日，Claude Code 官方 changelog 最新版本为 `2.1.251`（2026-08-28）。相关能力已经形成很强的执行底座：Auto Memory、agent memory、Skills、Hooks、Plugins、`/goal`、Dynamic Workflows、Agent Teams、跨会话消息和模型切换 hooks。参见 [Claude Code changelog](https://code.claude.com/docs/en/changelog)、[Memory](https://code.claude.com/docs/en/memory)、[Goals](https://code.claude.com/docs/en/goal)、[Workflows](https://code.claude.com/docs/en/workflows) 和 [Hooks](https://code.claude.com/docs/en/hooks)。

`2.1.251` 的直接增量包括 `PreModelSwitch`/`PostModelSwitch` hooks、前台 subagent 工具调用可见性，以及多项 team/subagent 通信修复。该版本还修复了 file tool symlink-swap TOCTOU、plugin command path traversal、Workflow `scriptPath` 在权限检查前读取、Grep/Glob 经 symlink 绕过 deny，以及 project settings 绕过 managed tracing/logging policy 等问题。这些变化增强了观测、编排和路径/策略边界，但仍没有把模型切换、验证或多 Agent 结果自动连接到 Skill candidate 的强制 promotion gate。

对 ChainlessChain 最直接的借鉴不是再复制两个 hook 名称，而是把**每次模型变化变成证据分段边界**。仓库的 WS 路径已经发送 [`model-switch`](../packages/cli/src/gateways/ws/ws-agent-handler.js#L1365)，部分 headless provider fallback 也有 raw event，但独立 `--fallback-model` 路径主要通过 [`onFallback` 写 stderr](../packages/cli/src/commands/agent.js#L1395)，REPL 另有自己的日志/状态。各路径应统一为结构化事件：记录 from/to provider、model/version、原因、失败类别和预算归属；模型变化后关闭上一 trajectory segment、失效兼容性/Eval cache，并禁止把混合模型结果当成单一 Skill 的因果证据。前台 subagent 可见性则应复用到候选审阅页，展示 proposer/critic/evaluator 的实时 tool receipt 与权限，而不是只显示最终自然语言结论。

它当前更接近：

`自动记笔记 → 人工或模型编写 Skill/Workflow → 可选 skill-creator 隔离评测/版本 A/B → 用户决定提交或启用`

而不是：

`轨迹归因 → 候选 Skill → 隔离评测 → 灰度晋级 → 监控回滚`

主要不足如下：

| 能力 | 最新进展 | 相对 WikiSkill 的差距 | 可借鉴的优化方向 |
| --- | --- | --- | --- |
| Memory | 自动记录反馈、项目知识；agent 可拥有独立 memory | 仍以本机 Markdown 笔记为主，缺少统一 source event、测试凭证、置信度、矛盾关系和 Skill impact | 将 memory 分为 episodic、semantic、procedural、policy，并为派生知识建立 evidence lineage |
| Skill / Workflow | 支持热加载、嵌套、fork 到子代理；官方 `skill-creator` 可用隔离 subagent 做 assertions grading、with/without benchmark、两个 Skill 版本盲测 A/B 和 HTML review | 已有很实用的用户触发评测迭代，但不是所有 Skill 变更必经的 candidate registry、promotion、canary 和 rollback 状态机 | 复用其用例/断言/A-B 工作流，接入强制 candidate gate 与版本固定；无需重造评测 UX |
| `/goal` 与验证 | 独立小模型持续判断目标是否完成；部分环境可自主启动 code review | goal evaluator 本身不运行文件或命令；自动验证策略与 skill-creator 仍未组成强制发布事务 | 确定性测试证据 + 独立 verifier 双门禁，模型判断不能替代真实退出码和产物哈希 |
| Hooks / Plugins | 生命周期扩展面完整，插件可持久化数据 | command hook 具有较大宿主权限；自动生成的 Hook/Plugin 缺少演化专用权限清单和原生回滚 | restricted sandbox、capability manifest、签名、SBOM、权限 diff 和 fail-closed promotion |
| Agent Teams | 能并行探索和验证 | 官方仍列出实验性与恢复、状态、嵌套等限制；并行本身不会形成组织学习 | 用持久 evidence ledger 做共享黑板，并用 proposer/evaluator/governor 做权力分离 |

Claude Code 对 ChainlessChain 的最大参照价值是：Skills、Hooks、Agents、Workflows、Plugins 和 Skill 评测 UX 已证明载体形态有效；差距应准确收窄为“这些能力尚未被强制串成自动 candidate/promotion/rollback 控制平面”。

### 2.3 OpenAI Codex 生态最新进展与不足

截至审计日，OpenAI 官方 changelog 最新列出的 CLI 版本为 Codex CLI `0.151.0`（2026-08-29）。Codex 生态已有 Skills、Plugins、Hooks、Memories、Goals、长任务、Subagents、Tasks、Sandbox、Approvals 和多级权限能力；其中 Computer History 与 Record & Replay 是 macOS ChatGPT desktop 产品面，不应归属于 CLI `0.151.0`。参见 [Codex changelog](https://learn.chatgpt.com/docs/changelog)、[Memories](https://learn.chatgpt.com/docs/customization/memories)、[Computer History](https://learn.chatgpt.com/docs/customization/computer-history) 和 [Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)。

`0.151.0` 的直接增量包括可配置的可选 MCP discovery grace period、extension 在结果进入模型前检查或替换 MCP tool result、仓库级 plugin catalog 合并，以及权限恢复、远程沙箱、模型切换和嵌套 subagent 预算等修复；它还修复了权限状态变化后陈旧 Guardian classification 继续授权操作的问题。这些变化继续补强扩展治理和执行稳定性，但仍没有定义 experience→Wiki→candidate→Eval→promotion 的演化事务。对应到本项目，permission/policy digest 改变时，历史批准、分类结果和 Eval cache 都必须失效。

这些增量给本项目三条很具体的优化：第一，在工具结果进入模型和 Maintainer 前增加统一 `ResultProjection`，分别保存受 ACL 保护的 raw evidence 与脱敏、限长、带 trust label 的 model-visible projection，并记录 transformation digest；第二，把 MCP 发现超时、权限拒绝、provider transient、sandbox/环境错误与 Skill 程序错误分开，避免系统围绕瞬时基础设施故障“优化”错误步骤；第三，所有 proposer/evaluator/subagent 消耗都必须计入根 `EvolutionRun` 的 token/cost/time/turn 硬预算。

OpenAI 官方还给出“[用带评分的改进循环迭代困难问题](https://learn.chatgpt.com/use-cases/iterate-on-difficult-problems)”的工作方式：提供评估脚本或可审阅产物，每次只做一个聚焦改动，重跑评估并记录分数直到达到目标。这仍是用户定义目标、单次任务内的 artifact 优化，不是持久 Skill 自动晋级；但它与 ChainlessChain 已有 `GoalConditionEngine + Eval + worktree/checkpoint` 高度贴合，适合先做最小闭环，再决定是否建设完整 Wiki。

它已经形成“经验采集 → 记忆/历史 → 识别重复流程 → 起草或建议 Skill/Automation → 人工确认”的半闭环，但官方文档没有描述“自动评测候选 → canary → 晋级 → 监控 → 自动回滚”的完整闭环。

| 能力 | 最新进展 | 相对 WikiSkill 的差距 | 可借鉴的优化方向 |
| --- | --- | --- | --- |
| History / Memories | 从会话和 Computer History 生成记忆，可识别重复操作并建议 Skill | generated state 主要服务召回；[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)显示外部 MCP/Web/Tool Search 上下文默认也可能进入记忆生成，缺少演化隔离区 | 为来源增加 trust domain、TTL、污染标签和可撤销依赖；外部来源默认 quarantine |
| Record & Replay（macOS desktop） | 用户发起录制，停止后系统起草 Skill，并可继续 refinement 或在新会话请求复用 | 官方没有描述强制的候选 Eval、promotion 或验证性 replay gate | ChainlessChain 可复用现有跨平台录制原语，但必须接入统一 Eval 与 Registry |
| Hooks / Extensions | 可在生命周期检查、转换和观测工具结果；最新版本允许结果进模型前检查/替换 | `PostToolUse` 无法撤销已发生副作用；raw 与 model-visible 结果若不分层会污染证据 | active write 门禁必须在副作用前；同时建立 pre-model projection、双摘要/digest 与转换审计 |
| Sandbox / Approval | 技术沙箱、审批、auto-review 和权限 profile 较完整 | 解决的是“能否执行”，不是“新 Skill 是否更好且可晋级” | 复用其职责分离思想，新增独立 promotion controller 和 last-known-good |
| Multi-agent / Goal | 长任务和多代理已稳定化，任务与成本归属持续增强 | 多代理提高吞吐，但没有自动产生持久 Wiki 和可验证 Skill | 将 proposer、critic、evaluator、governor 配置为不同能力角色和唯一写入者 |
| Skill 选择 | 渐进加载并根据 description 触发 | Skill 多时目录会被压缩或省略；同名和描述重叠可能造成错选 | 命名空间、semver、依赖图、混合检索和 outcome-aware reranking |

Codex 的关键启发是：自进化需要的传感器、记忆、Skill 载体、Hooks、长任务、多代理和安全基础已经可以分别产品化；真正稀缺的是把它们连接起来的、可验证且可回滚的控制平面。

### 2.4 四方能力对照

下表中的“无”表示在本次论文、官方文档或本仓库静态审计范围内没有发现相应的完整机制，不代表厂商内部不存在未公开实现。

| 维度 | WikiSkill | Claude Code 2.1.251 | OpenAI Codex 生态（CLI 0.151.0） | ChainlessChain 当前基线 |
| --- | --- | --- | --- | --- |
| 经验采集 | 完整训练轨迹 | Memory、Hooks、OTel、Workflow | Memories、Hooks；Computer History/Record & Replay 为 macOS desktop | Trajectory、Hooks、Rollout、Record & Replay 均有原语 |
| 持久中间知识 | 独立 Wiki，含模式、日志、impact | Memory 笔记，无独立 Skill impact Wiki | Memories/desktop History，无官方 Skill impact Wiki | 无 canonical Wiki；多套 memory/knowledge/decision 模块并存 |
| 自动 Skill 候选 | Wiki-informed proposer | 可由 Agent 编写，通常需用户固化 | 可起草或建议，通常需用户确认 | Synthesizer CLI 入口不可用；Record & Replay 可形成 draft，但不是通用 proposer |
| Skill 验证门 | 反复复用的留出 validation split 严格提升 gate | `skill-creator` 有隔离评测/A-B，但非自动强制发布门 | 可用 eval/hooks/auto-review 拼装，无官方完整演化门 | Record & Replay 有 replay receipt 验证纵切；通用 Eval 尚未接 Synthesizer/Improver 的 promotion 事务 |
| 单 Skill 变更粒度 | 每轮 proposal 只改一个 Skill；不代表事务原子性 | 无原生强制约束 | 无官方演化级约束 | Record & Replay 以单 recorded Skill 为单位；Improver 自身无 candidate 粒度约束 |
| 回退/回滚 | candidate 未提升时恢复上一 Skill set，Wiki 保留；非部署事务 | Git/插件缓存等可辅助，无原生 Skill 生命周期 | 版本/审批基础可辅助，无官方演化 rollback 状态机 | recorded Skill 与 Plugin 有局部 CAS/rollback；无统一 Skill active/last-known-good 控制面 |
| 跨模型兼容 | 已实验，且发现负迁移 | 无原生 Skill 兼容矩阵 | 无原生 Skill 兼容矩阵 | 无 target model × tools × OS × runtime gate |
| 生产安全 | 论文未评测 | restricted、hooks/plugins 权限仍需治理 | sandbox/approval 较强，但非演化专用 | 已有安全基础，但学习 writer 未统一接入 |

## 3. 本项目已经具备、应保留的能力

以下能力不建议推倒重做，而应作为统一演化控制面的 adapter 或底层端口：

| 能力 | 当前证据 | 判断 |
| --- | --- | --- |
| Canonical capability manifest | [`capability-manifest.js`](../packages/cli/src/lib/capability-manifest.js#L2) 已是 CLI、IDE negotiation、协议文档、fixture、behavior matrix 与 release diff 的单一来源；[`cc agent --capabilities`](../packages/cli/src/lib/headless-manifest.js#L127) 可机器读取 | 不应新增平行 `capability-status.json`；静态 manifest 声明 capability/gate，易变 wiring/evidence 由绑定 manifest digest 的 runtime projection 输出，保留纯函数与 drift guard |
| 目标条件与硬预算 | [`goal-condition-engine.js`](../packages/cli/src/lib/goal-condition-engine.js#L1) 已支持确定性/模型条件、outer turn、token、cost、time 预算和 snapshot/restore；[`agent.js`](../packages/cli/src/commands/agent.js#L493) 已暴露 CLI 参数 | 是“评分改进循环”的现成 orchestration 骨架；补 candidate/eval adapter 与 root-run budget 归集即可形成最小纵切，不必先造新 scheduler |
| Worktree / Checkpoint | [`agent.js`](../packages/cli/src/commands/agent.js#L295) 默认对 Git workspace mutation 建 checkpoint，并提供隔离 worktree；[`worktree-isolator.js`](../packages/cli/src/harness/worktree-isolator.js#L266) 对清理路径 fail closed | 代码/工作区候选先复用现有隔离与恢复；Skill registry 仍需补 content-addressed candidate、active pointer 和 promotion transaction |
| 轨迹存储 | [`trajectory-store.js`](../packages/cli/src/lib/learning/trajectory-store.js#L61) 可记录 intent、tool calls、结果、response 和 outcome | 是 Raw 层原语，但当前会通过 UPDATE 重写 `tool_chain`、score 和 synthesized 标记，不是 immutable event log |
| Outcome Feedback | [`outcome-feedback.js`](../packages/cli/src/lib/learning/outcome-feedback.js#L34) 支持自动和用户反馈 | 可作为候选信号，不可作为 correctness 或 promotion oracle |
| Reflection | [`reflection-engine.js`](../packages/cli/src/lib/learning/reflection-engine.js) 可生成工具统计、趋势和报告 | 可成为 Wiki Maintainer 的分析端口；当前 CLI 传入 null LLM，只有统计反思 |
| Skill Synthesizer | [`skill-synthesizer.js`](../packages/cli/src/lib/learning/skill-synthesizer.js#L186) 可从轨迹抽取 pattern 并写 `SKILL.md` | 是 Raw→Skill writer 原语；应改为只生成 content-addressed candidate |
| Skill Improver | [`skill-improver.js`](../packages/cli/src/lib/learning/skill-improver.js#L207) 支持错误、纠正和更优轨迹三类触发；未发现生产构造点 | 可复用 patch 生成逻辑；必须限制 `skillsDir` 只能指向 candidate store，不能由它决定 active 目标 |
| Eval | [`packages/cli/src/lib/eval`](../packages/cli/src/lib/eval) 与 [`graph-kernel/eval.js`](../packages/cli/src/lib/graph-kernel/eval.js) 已有运行和趋势基础 | 应升级为独立 validator，并增加模型、工具、OS、安全和成本矩阵 |
| Rollout | [`rollout-store.js`](../packages/cli/src/lib/app-server/rollout-store.js) 与 [`sqlite-rollout-store.js`](../packages/cli/src/lib/app-server/sqlite-rollout-store.js) 已有存储端口 | 应成为 Raw event/artifact authority，而不是另建一套不可互通的轨迹库 |
| Record & Replay 生命周期 | [`recorded-skill-store.js`](../packages/cli/src/lib/record-replay/recorded-skill-store.js#L35) 已定义 `draft→approved→validated→enabled→revoked`；approval/replay 与 digest 绑定且 enable 用 revision CAS；[`record-replay.js`](../packages/cli/src/commands/record-replay.js#L516) 有 staged enable/revoke 失败补偿 | 是最接近目标的 Skill 安全纵切，应抽象为通用 Registry adapter；仍缺 Wiki、通用 proposer、shadow/canary、全局 active pointer 与 last-known-good |
| Plugin 制品事务 | [`plugin-runtime/install.js`](../packages/cli/src/lib/plugin-runtime/install.js#L1) 已有不可变版本目录、staging、签名/SBOM、active version、rollback 与 recovery；[`scopes.js`](../packages/cli/src/lib/plugin-runtime/scopes.js#L1) 对断裂 pointer fail closed | 可抽取共享 `VersionedArtifactActivation` 内核给 Skill Registry，避免重写锁、journal、pointer 与恢复；Skill 再叠加 Eval/lineage 专属策略 |
| Memory Kernel | [`context-memory-kernel`](../packages/cli/src/lib/context-memory-kernel) 已有 authority、privacy purge、compaction 和 adapter | 应承载 episodic/semantic memory；policy 与 validated procedural knowledge 仍须分层 |
| Skill Runtime | CLI [`skill-loader.js`](../packages/cli/src/lib/skill-loader.js#L436) 有 execution authority lease；[`materializeSkill`](../packages/cli/src/lib/skill-loader.js#L914) 每次重读 `SKILL.md+handler` digest，内容变化需再授权/fail closed；Desktop 另有 [`skill-loader.js`](../desktop-app-vue/src/main/ai-engine/cowork/skills/skill-loader.js) | 保留 digest/lease/TOCTOU 防线并接 Registry active digest；它是执行时防御，不等于 candidate/promotion 生命周期 |
| Skill metrics | [`skill-metrics-collector.js`](../desktop-app-vue/src/main/ai-engine/cowork/skills/skill-metrics-collector.js#L100) 的数据结构可记录 skill ID、时延、成功、token、成本和 context JSON | 修复 Desktop IPC/事件接线后可作为 InvocationReceipt adapter；当前既未可靠接线，也没有强制 digest、路由理由、模型/工具/权限指纹与任务 outcome |
| 模型选择/回退 | WS 已发 [`model-switch`](../packages/cli/src/gateways/ws/ws-agent-handler.js#L1365)；headless runner 有 [`provider_fallback`](../packages/cli/src/runtime/headless-runner.js#L2612) raw event；独立 [`fallback-model.js`](../packages/cli/src/runtime/fallback-model.js#L250) 支持同/跨 provider 回退 | 已有切换原语但 WS/headless/REPL/独立 fallback 事件口径分裂；应统一结构化证据分段和成本归属，而不是新增另一套模型生命周期 |
| Desktop Phase 20 | [`phase-16-20-skill-evo.js`](../desktop-app-vue/src/main/ipc/phases/phase-16-20-skill-evo.js#L399) 初始化知识图谱、Decision KB、Prompt Optimizer、Skill Discoverer、Debate Review、A/B Comparator | 组件丰富，但目前是六个并列 manager 与 35 个 IPC handler，不是一个原子演化事务 |
| 自改进 Skill | [`self-improving-agent/handler.js`](../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/self-improving-agent/handler.js#L293) 可记录错误、instinct 和 JSON skill | 可复用交互；“extract-skill”只写 JSON，写入失败可被吞且仍报 success，也未发现自动消费这些 learnings 的闭环，修复前不能作为持久学习证据 |

### 3.1 当前实现的关键事实差距

| 对象 | 源码事实 | 差距判断 |
| --- | --- | --- |
| CLI `evolution-system.js` | [`assessCapability`](../packages/cli/src/lib/evolution-system.js#L144) 接受外部 score；[`trainIncremental`](../packages/cli/src/lib/evolution-system.js#L226) 只按公式增加 accuracy；部分 V2 governance 使用进程内 Map，而相关 CLI 操作拆成多次进程调用 | 指标/状态账本，不是模型训练或 Skill 演化器；跨命令生命周期需要持久 store，不能靠进程内状态 |
| Desktop `self-evolving-system.js` | [`trainIncremental`](../desktop-app-vue/src/main/ai-engine/evolution/self-evolving-system.js#L209) 同样公式递增；[`selfRepair`](../desktop-app-vue/src/main/ai-engine/evolution/self-evolving-system.js#L338) 多数只返回动作字符串；[`predictBehavior`](../desktop-app-vue/src/main/ai-engine/evolution/self-evolving-system.js#L361) 使用固定概率；生产扫描未找到该模块接线 | 演示和指标壳，不应作为“真实自进化”证据；注意不要把它与已接线的 cowork Phase 20 混为一体 |
| learning hooks | [`learning-hooks.js`](../packages/cli/src/lib/learning/learning-hooks.js#L38) 定义四个入口，`SessionEnd` 仍是 no-op；生产源码静态扫描未找到定义外调用点 | 当前没有源码证据证明真实 Agent turn 自动产出该 Raw 数据 |
| `learning reflect` | [`learning.js`](../packages/cli/src/commands/learning.js#L196) 以 null LLM 构造 ReflectionEngine | 命令可输出统计，但 LLM 根因归纳未启用 |
| `learning synthesize` | [`learning.js`](../packages/cli/src/commands/learning.js#L270) 以 null LLM、无 outputDir 构造；[`_extractPattern`](../packages/cli/src/lib/learning/skill-synthesizer.js#L254) 无 LLM 即返回 null | 当前产品入口不会真实创建 Skill，因此不会走到后述 phantom-created 分支 |
| Synthesizer artifact | 组件在“有 LLM、无 outputDir”时不写文件，却仍标记 synthesized/created；[`_persistSkill`](../packages/cli/src/lib/learning/skill-synthesizer.js#L305) 直接拼接 LLM 提供的 name | 组件存在“无 artifact 也报 created”的潜在幻影成功分支；该文件内没有确定性名称校验和 realpath containment |
| Skill Improver | LLM 自报 confidence 只需 `>=0.4`；[`_writeSkill`](../packages/cli/src/lib/learning/skill-improver.js#L420) 覆盖配置的 `<skillsDir>/<name>/SKILL.md`，但 `_readSkill` 已拒绝 symlink/非文件并限长；[`_logImprovement`](../packages/cli/src/lib/learning/skill-improver.js#L439) 失败被吞 | 未发现生产构造点；若 `skillsDir` 指向 runtime tree，会绕过 candidate/Eval/CAS/audit，随后 CLI loader 的 digest 再授权只能提供执行时补防，不能替代 mutation gate |
| Improvement log | [`learning-tables.js`](../packages/cli/src/lib/learning/learning-tables.js#L59) 只有 skill、trigger、detail、created_at | 无 evidence、diff、digest、validator、模型、环境、accept/reject、rollback 或 revocation |
| 自动评分 | [`outcome-feedback.js`](../packages/cli/src/lib/learning/outcome-feedback.js#L40) 从 0.5 起，按错误率、retry 和最后工具 completed 固定加减 | 可能奖励“工具调用成功但任务答案错误”，只能用于筛选候选 |
| Skill 使用归因 | [`skill_execution_metrics`](../desktop-app-vue/src/main/database/database-schema.js#L2922) 记录 skill ID、pipeline、成功、token、cost 和自由形态 context；CLI usage ledger 有 name-level Skill/model attribution | 没有强制 Skill content digest、selector 候选/分数/理由、canonical 模型段、环境/权限指纹、terminal outcome 或 evidence digest；“执行未抛错”不能证明 Skill 改善任务结果 |
| Desktop Skill metrics 接线 | [`phase-16-20-skill-evo.js`](../desktop-app-vue/src/main/ipc/phases/phase-16-20-skill-evo.js#L30) 给 pipeline IPC 传 `{hookSystem}`、给 metrics/workflow IPC 传空依赖；[`skill-metrics-ipc.js`](../desktop-app-vue/src/main/ai-engine/cowork/skills/skill-metrics-ipc.js#L13) 实际要求 `metricsCollector`；`BaseSkill` 事件字段与 collector 监听字段也不一致 | 当前 metrics 不是“字段少但已生产可用”，而是依赖与事件 contract 均有断点；先修接线/contract tests，再扩展 Receipt schema |
| Tool result 入模 | MCP 有 [`mcp-tool-result.js`](../packages/cli/src/lib/mcp-tool-result.js#L320) 的 JSON/size/depth/node admission；Agent 随后主要 [`JSON.stringify + cap`](../packages/cli/src/runtime/agent-core.js#L14962) 后直接加入下一轮 model messages | 解决结构与上下文放大，不等于 secret/PII、prompt injection、来源 trust 的 pre-model projection；raw evidence 与 model-visible 内容也未形成可审计双层 |
| 模型切换证据 | WS 与部分 headless provider fallback 已有结构化 raw event，独立 `--fallback-model`/REPL 仍主要写日志或变量；Skill usage 未绑定 loader 的 exact content digest | 现有证据是碎片化事件，不是 canonical segment receipt；同一任务混用模型时仍无法稳定失效 Eval cache 或完成 Skill 版本因果归因 |
| Desktop A/B | [`ab-comparator.js`](../desktop-app-vue/src/main/ai-engine/cowork/ab-comparator.js#L349) 在 Agent 不可用时生成 placeholder；[`_benchmarkVariant`](../desktop-app-vue/src/main/ai-engine/cowork/ab-comparator.js#L362) 主要按长度、正则错误处理和可读性评分，且 winner 可进入 Decision KB 路径 | 不仅不能作为生产晋级门，placeholder 还可能形成 phantom winner 并污染后续知识 |
| Prompt Optimizer | [`getActiveVariant`](../desktop-app-vue/src/main/ai-engine/cowork/prompt-optimizer.js#L212) 从多个 active variant 中排序；[`optimizePrompt`](../desktop-app-vue/src/main/ai-engine/cowork/prompt-optimizer.js#L255) 只返回建议 | 有统计原语，没有真正生成、验证、晋级和回滚变体 |
| Skill Discoverer | [`skill-discoverer.js`](../desktop-app-vue/src/main/ai-engine/cowork/skill-discoverer.js#L215) 优先搜索 marketplace，失败后返回 `keyword-inference` 名称 | fallback 是关键词建议，不是可安装、可验证的真实 Skill，UI 必须明确区分 |

## 4. 优先级总览

### 4.1 P0：真实性、安全与可恢复性

| ID | 任务 | 当前差距 | 目标 | 建议投入 |
| --- | --- | --- | --- | --- |
| EVO-P0-1 | 能力真实性与 mutation freeze | CLI 空入口、指标壳、phantom created、Desktop IPC/事件误接线；配置不当时 Improver 可覆盖 runtime Skill | 扩展现有 canonical capability manifest；未接线能力显示 experimental/unavailable；默认阻止自动 active write | S～M |
| EVO-P0-2 | Candidate、Promotion 与 Rollback 事务 | Record & Replay/Plugin 有局部 CAS 与恢复，但 Synthesizer、Improver、普通 Skill 未共用 canonical lifecycle | 推广现有事务原语；所有变更先写不可变 candidate；独立 controller 原子晋级；60 秒内回滚 | M |
| EVO-P0-3 | 独立真实 Eval Gate | heuristic score、LLM confidence、placeholder A/B 都可能误判 | train/validation/test 隔离；真实任务 grader、安全 hard gate、统计门槛与成本预算 | M～L |
| EVO-P0-4 | Raw、入模投影与 Skill 编译安全边界 | Raw 含不可信用户/工具内容；当前结构/限长 admission 不等于入模脱敏；名称和内容可进入文件 | raw/model-visible 双层、脱敏、trust/quarantine、schema/name/realpath/capability diff、沙箱和人工 quorum | M～L |
| EVO-P0-5 | Fail-closed 证据与审计 | 改写后审计失败可被吞；日志缺少 diff、digest、validator 和 target runtime | append-only/tamper-evident ledger；无审计即拒绝晋级；100% lineage | M |

### 4.2 P1：统一演化控制面

| ID | 任务 | 当前差距 | 目标 | 建议投入 |
| --- | --- | --- | --- | --- |
| EVO-P1-1 | Canonical Raw/Wiki/Skill 架构 | 轨迹、memory、decision KB、reflection 和 Skill writer 分散 | 单一 EvolutionRun 状态机和三层 authority，CLI/Desktop/Graph 共用 | L |
| EVO-P1-2 | Evidence-backed Wiki Maintainer | 无持久 pattern/index/evolution-log/skill-impact | 模式可合并、矛盾、过期、撤销，并回指全部证据 | M～L |
| EVO-P1-3 | Wiki-informed Single-Skill Proposer | Synthesizer 从单一 Raw 直接生成 Skill，缺少 PURPOSE 和多证据归纳 | proposer 只写单 Skill candidate；生成 PURPOSE、diff、边界和反例 | M |
| EVO-P1-4 | 目标运行时 Eval 与负迁移检测 | 没有 model × version × tools × OS × domain 兼容矩阵 | before/after 同种子评测，shadow/canary，跨模型重新验证 | L |
| EVO-P1-5 | Registry、生命周期与单写者治理 | recorded Skill/Plugin 已有局部生命周期；普通 Skill、CLI/Desktop/Graph 与 learning writers 没有共享 Registry | 抽取 content-addressed registry、lease/fence/CAS、唯一 promotion writer、kill switch | M～L |
| EVO-P1-6 | 统一生产接线并退役重复壳 | learning hooks、Improver 未接线；CLI/Desktop 有多套“self-evolving”语义 | 真实 Agent 事件进入统一 adapter；旧壳降级为 metrics view 或退役 | M～L |
| EVO-P1-7 | 结构化 Memory/Compaction 与多 Agent 权力分离 | 摘要、个人记忆和多 Agent 消息不能保证保留关键证据与职责边界 | episodic/semantic/procedural/policy 分层；proposer/critic/evaluator/governor 隔离 | M～L |
| EVO-P1-8 | SkillInvocationReceipt 与因果归因 | metrics 只有 skill ID/执行成功等弱字段；模型切换事件口径分裂 | 每次选择与执行固定 Skill digest、router reason、模型段、环境/权限、outcome 与成本，可反向 join Eval/Wiki | M |
| EVO-P1-9 | 有界评分改进循环 | 已有 GoalConditionEngine、预算、Eval、worktree/checkpoint，但未组成 candidate 优化循环 | 一次一候选、独立评分、保留 best、失败分类、根预算停止；先离线 candidate-only | M |

### 4.3 P2：体验、生态与规模化

| ID | 任务 | 当前差距 | 目标 | 建议投入 |
| --- | --- | --- | --- | --- |
| EVO-P2-1 | 窄域受控生产 Pilot | P1 离线纵切通过后，真实流量 ROI 与安全性仍未知 | opt-in、低风险 cohort，人工 review→shadow→canary；按样本量而非固定百分比扩量 | M |
| EVO-P2-2 | Evolution Workbench | 用户看不到 evidence→pattern→diff→eval→promotion 全链路 | 可解释时间线、权限 diff、兼容范围、一键回滚 | M |
| EVO-P2-3 | Skill Retrieval Router | 全量注入不可扩展，description 路由会错选 | namespace + BM25/vector + outcome-aware rerank + 冲突说明 | M～L |
| EVO-P2-4 | 跨设备、团队和组织知识 | 当前知识多为本机或模块私有 | 加密同步、RBAC、tenant scope、冲突合并、组织批准知识 | L |
| EVO-P2-5 | 跨模型 Skill 来源/目标适配与市场治理 | 迁移可能增益也可能负迁移，市场缺少可复现效果凭证 | target-specific adapter、兼容矩阵、签名 lockfile、Eval badge、分阶段升级 | L |
| EVO-P2-6 | Wiki Pruning 与长时在线适应 | WikiSkill 本身未解决无限增长、检索和小时级在线学习 | merge/decay/TTL/tombstone；离线闭环稳定后再做无提权在线适应 | M～L |

## 5. P0：立即修复的真实性、安全与可恢复问题

### 5.1 EVO-P0-1：能力真实性与 mutation freeze

当前最先要解决的不是“让系统更主动”，而是让能力声明、生产接线和真实副作用一致。

建议：

1. 在现有 `CAPABILITY_MANIFEST` 增加 evolution capability ID、静态 dependency/gate 与 mutation scope；由运行时 probe/receipt 生成 `evolutionStatus`，至少含 `implemented`、`wired`、`verified`、`defaultEnabled`、`lastEvidence`、`manifestDigest`、`evidenceDigest`。`cc agent --capabilities`、IDE negotiation、文档和 fixture 继续共享 capability 定义；禁止另建平行 `capability-status.json`，也禁止让时间戳等易变状态污染 canonical manifest digest。
2. `learning synthesize` 在缺少 LLM、output registry 或 evaluator 时应明确返回 `UNAVAILABLE`，不能把空扫描包装为成功完成。
3. Synthesizer 只有在 artifact 成功持久化并取得 digest 后，才能标记 source trajectory；不允许“无 artifact 也 created”。
4. `SkillImprover` 在新 gate 上线前强制 `skillsDir` 指向 candidate-only root，或以 feature flag 强制只输出 diff；不能依赖 loader 的事后 digest 再授权代替写入门禁。
5. Desktop 未接线的 `self-evolving-system` 改名为 `evolution-metrics`、移除或明确标记 simulated；CLI `evolution-system.js` 保留真实治理/维护动作，但把公式型 `trainIncremental` 等接口单独标为 metrics-only，避免一刀切隐藏有效功能。
6. `keyword-inference` 结果必须显示为“搜索关键词建议”，不能显示为可安装 Skill。
7. 修复 Phase 16 pipeline/metrics/workflow IPC 依赖注入、`BaseSkill`↔collector 事件字段和 token 字段 contract；在真实实例与事件测试通过前，这些能力保持 `wired=false`。

验收标准：

- capability 清单中 `wired=false` 的功能无法通过正式入口产生“已创建/已进化”成功状态。
- 对所有 learning/evolution IPC 与 CLI 命令做 contract test，artifact、数据库状态、UI 状态三者一致。
- 自动 learning/proposer 身份对 active Skill 的非 promotion-controller 写入 100% 被拒绝并记录审计；人工编辑也必须通过显式 import/review 路径重新取得 digest 授权。
- 产品文档、命令 help、UI badge 与 runtime capability manifest 一致。

实施结果（2026-09-02）：**上述路线项已在当前工作区关闭。** canonical capability manifest 默认无证据即 `wired=false`；CLI `learning synthesize` 缺 LLM/candidate registry/evaluator 时返回显式 unavailable 与非零命令结果，持久化制品前不会标记 trajectory；Synthesizer、Improver、Desktop Skill Creator 与 Skill Sync import 均只产生 candidate/diff。Desktop TechLearning 不再用内存 UUID 冒充已合成 Skill，只有 `candidate-created + artifact` 才能由 IPC 返回成功；Phase 20 的正式接线已改称 Evolution Metrics，历史 `self-evolving-system` 明确为 metrics simulator 且未被该 Phase 注册。`cc evolution` 的 parent/learn/train-v2/diagnose/repair/predict help、生成命令索引、CLI reference 和产品页统一为 metrics/governance record 语义，关键词推断继续固定为不可安装的 marketplace search suggestion。writer inventory 对当前 39 个写入面保持 unknown-direct=0，其中 learning/proposer/governed-import 六个目标写入面全部为 `candidate-only`；mutation authority 对 learning/proposer/manual-import 等非 promotion-controller active mutation 继续 fail-closed 并持久记录拒绝审计。通用 coding Agent、插件安装器及旧平台 Skill 管理入口在 inventory 中仍显式标为 legacy authority，它们不以 learning/proposer 身份宣称“自动进化”，后续统一迁移由 EVO-P1-5 承担。

确定性验收：13 个定向测试文件 **295/295** 通过，覆盖 capability manifest、CLI learning contract、Synthesizer、Improver、writer inventory、mutation authority、promotion controller、Desktop TechLearning engine/IPC、Phase 接线与 keyword suggestion；真实 `learning`/`learning synthesize`/`evolution` help 已核对，command manifest、help index、CLI reference 三个生成物均无漂移；相关 ESLint 为 0 error（保留 5 个既有 warning），`git diff --check` 通过。

### 5.2 EVO-P0-2：Candidate、Promotion 与 Rollback 事务

建议把 Skill 当作不可变制品，而不是可原地编辑的 Markdown 文件。实现上不要绿地重写：以 `recorded-skill-store` 的 approval/replay/CAS 生命周期和 Plugin runtime 的 immutable version/active pointer/journal/recovery 为种子，抽取共享 `VersionedArtifactActivation` 端口，再补 Skill 专属 Eval、Wiki lineage、shadow/canary 和 last-known-good。

候选制品至少包含：

```yaml
candidateId: sha256:...
skillName: example-skill
parentDigest: sha256:...
contentDigest: sha256:...
sourceEvidenceRefs: []
derivationMode: wiki | record-replay | manual-import
wikiRevision: null
proposerModel: null
targetRuntimes: []
requestedCapabilities: []
evalRunId: null
status: draft
```

状态机建议为：

`draft → validating → validated → shadow → canary → active → deprecated / rolled-back / revoked`

关键约束：

- Proposer 只能创建 candidate，无权修改 active pointer。
- 默认一次 proposal 只改变一个 Skill；不可分割的依赖升级必须声明显式 transaction group，并在同一 gate 中全成或全败，不能把普通多文件修改伪装成一项原子证据。
- Promotion controller 校验 parent/candidate digest、真实 derivation receipt（Wiki revision 或 recording/approval/replay chain）、eval receipt、policy receipt 和签名后，用 CAS 原子切换 active pointer。
- approval、Guardian/分类结果和 Eval cache 必须绑定 permission/policy digest；权限、managed policy、模型、工具或 grader 版本变化时自动失效并重新验证。
- 运行中的会话固定到启动时的 Skill digest，不允许热加载导致半轮语义变化。
- last-known-good 和依赖 lock 必须一起回滚。

验收标准：

- 候选失败或进程在任意写入点崩溃时，active bytes 与 pointer 均保持不变。
- 100 轮并发 proposal/promotion 压测中无 lost update、双 active 或部分写入。
- 任一 active 版本可在 60 秒内回滚到字节级一致的上一版本。
- crash/restart 后能从 ledger 确定性恢复事务终态。

实施结果（2026-09-02）：**上述事务路线项已在当前工作区关闭。** Candidate 与 Release 均为 tenant-scoped content-addressed immutable artifact；promotion/rollback 必须消费绑定 exact operation、candidate/rollback target、dependency lock 与 active digest/revision 的 mutation authority，随后经 lease/fence、ledger prepare、staging fsync、active pointer CAS、ledger finalize 和 journal cleanup 收敛。`pinActive()` 固定运行中会话的 release digest；每个 release 内嵌 dependency lock、runtime manifest、target matrix 和六类 receipt digest，相关权限/策略/模型/工具/grader 上下文变化无法复用旧 transition subject。active pointer、LKG 和 dependency lock 在同一个认证状态中切换，rollback 重新激活不可变历史 release，不重新拼装字节。

确定性验收：Candidate/Release/Promotion 三个核心测试文件 **70/70** 通过。Release 矩阵覆盖 `after-prepare`、`after-staging-fsync`、`after-pointer`、`after-finalize` 等持久写入边界、finalize unavailable/commit-unknown、tamper、过期 lease、重启恢复，以及真实子进程在 pointer 写后 `process.exit(73)` 再由新实例确定性恢复；新增 promotion 压测同时提交 100 个相同 CAS 基线的完整候选，严格收敛为 1 个 committed active、99 个拒绝、revision/fence 均为 1 且无双 active/部分 ledger；rollback 断言恢复 release 的 candidate content 字节与原版本完全相同、dependency lock digest 一致并在 60 秒上限内完成。最终用户 shadow/canary 编排和唯一 production writer 构造点属于 EVO-P1-5；真实跨进程 Eval/PKI authority 属于 EVO-P0-3，不再重复作为本事务原语的未关闭项。

### 5.3 EVO-P0-3：独立真实 Eval Gate

现有 `autoScore`、LLM confidence、Prompt success rate 和 A/B 可读性分数都可以参与候选排序，但不能决定生产晋级。

最低可用 gate 应包含：

1. **数据隔离**：training 用于提炼；validation 用于选择；test 只用于最终报告。Proposer 不得读取 validation/test 答案和 grader；按时间、项目、用户和任务近重复做 group split，限制单一 workspace/user/replayed trace 的贡献，防止泄漏、投毒和反馈回路放大。
2. **真实 grader**：代码任务运行真实测试；文件任务校验 artifact；检索任务检查引用与答案；UI 任务回放真实状态，而不是只看 tool completed。
3. **同条件对照**：baseline 与 candidate 使用相同模型版本、seed、工具、权限、OS 镜像和输入集。
4. **多目标门禁**：质量、错误率、安全、权限、token、延迟和工具调用预算同时判定；安全是 hard gate。
5. **统计稳健性**：至少三次独立运行，或预注册置信区间/序贯检验；小样本不确定时进入 `needs-more-evidence`，而不是强制晋级或永久拒绝。
6. **防评测投机**：candidate 不能读取测试文件、grader 实现、隐藏答案或历史 validation 结果。

以下仅是**窄域 Pilot 默认起点**，不是跨任务通用发布标准。正式门槛应按风险等级、样本基线、统计功效、流量规模和成本目标预注册；样本不足时进入 `needs-more-evidence`：

- 安全与权限回归必须为零。
- 主要任务成功率的置信下界不得低于 baseline。
- 成功率提升至少 5 个百分点，或同等成功率下 token/延迟降低至少 10%。
- 低风险 Pilot 可先以 30 个 replay、20 个 holdout 作为最低探索量；高风险或高方差任务必须根据功效分析扩大样本，不足时只能停留 draft。

### 5.4 EVO-P0-4：Raw、入模投影与 Skill 编译安全边界

Raw trajectory 同时包含用户输入、工具参数、工具结果和模型输出。任何一层都可能携带秘密、个人信息、prompt injection、恶意路径、伪造成功信息或跨租户内容。把这些内容交给 Maintainer/Proposer，会把一次性攻击编译为持久 Skill。

需要明确区分三种表示：受 ACL 与保留策略保护的 raw evidence、经过脱敏/截断/来源标注后允许进入模型的 model-visible projection，以及可进入 Wiki/Skill 编译的 trusted projection。当前 MCP result admission 已限制结构、大小、深度和节点数，但这不能替代秘密/PII 清理、prompt-injection 标注和来源信任策略。每次转换都应记录 source digest、projection digest、规则版本和删改摘要，使模型看到的内容与审计原文可关联但不混存。

建议建立四道边界：

| 边界 | 必须执行的控制 |
| --- | --- |
| Raw 入库前 | secret/PII redaction、tenant scope、来源 trust、sensitivity、retention、加密与 ACL |
| 工具结果进模型前 | 生成 model-visible projection；secret/PII redaction、trust label、注入标记、内容预算；raw 与 projection 各自 digest |
| Wiki 归纳前 | 只读允许进入学习面的 trusted projection；untrusted/external trace quarantine；区分用户陈述、工具观察、模型推断和真实验证 |
| Candidate 写入前 | 严格 JSON schema、kebab-case 名称、realpath containment、symlink/size 限制、静态恶意指令扫描 |
| Promotion 前 | capability/permission/network/secret diff；独立 sandbox；高风险变更双人或 policy+human quorum |

Maintainer 和 Proposer 默认只应拥有读取指定证据、写 candidate 的最小权限，不应拥有 shell、任意网络、secret 或 active registry write 权限。

验收标准：

- prompt injection、伪成功、secret 泄漏、目录逃逸、symlink、跨租户和恶意重复轨迹负测全部通过。
- 1,000 条对抗轨迹中，零未经审查的 active Skill 修改，零 secret 进入 Wiki/Skill 明文。
- 删除或撤销源证据后，所有派生 pattern 和 candidate 在 60 秒内被定位并降权、隔离或撤销。
- capability 扩张必须显式显示且不能由自动 proposer 自批。

实施结果（2026-09-02，工作区）：**该路线项的持久组合、Candidate plaintext 与 promotion review gate 基础已完成，整体仍为部分完成。** 既有 `EvolutionEvidenceProjector` 已执行 source verification、tenant-keyed commitment、storage/ACL/retention policy、secret/PII redaction、prompt-injection 标记、trust/quarantine、model/trusted 双投影和签名 attestation；`bc24db7a0b` 的 `ArtifactStoreEncryptedRawStore` 将 Raw 接到真实 ArtifactStore，plaintext 只交给捕获的外部 encryptor，持久层只得到 AES-256-GCM sealed bytes、cipher digest、tenant KMS ref 与无敏感 lineage；`EvolutionEvidenceArtifactAdapter` 四分片持久并 readback 后最后发布完整 derivation manifest，新实例逐项重新认证。`f668598a42` 又将同一 Unicode-aware secret/PII policy 接入唯一 Candidate canonical builder，在任何 digest/临时文件/最终文件产生前拒绝普通及混淆 canary；既有 strict schema、kebab-case、size、realpath、symlink、single-link 和 descriptor readback 继续生效。`2d7fa726f8` 进一步从认证 Candidate/active release/state/matrix binding 生成 parent-relative capability diff 和完整 reviewer packet；任何 capability 增量需两个不同真人，无增量仍需一个，签名/时效/quorum/exact packet 在 mutation authority consume 前验证，review receipt 同时进入 release policy lineage 与 procedural Memory evidence。`534ca5f4e5` 再把投影器已有的 Unicode-aware injection findings 作为稳定 `contentRiskDigest` 纳入 packet、decision 和 Memory binding；命中风险时强制双人且必须显式确认同一摘要，未确认在 mutation 前拒绝，同时允许合法安全 Skill 把攻击字符串保留为受审反例。`bd3c29b843` 扩展越权/伪造成功/凭据外传/自授权/关闭护栏等英中意图，并用 compact skeleton 阻断逐字符分隔绕过；20×10×5 形成的 1,000 条唯一合成候选全部产生 finding。Projector+review 55/55、Candidate 27/27、其余相关回归 56/56、process integration 1/1 通过。未关闭项为真实 Agent/tool pre-model 接线与旧直通路径退役、生产 KMS/HSM、60 秒删除/撤销传播、更广语义分类及生产流量攻击观测/误报校准；持久 resolver 已由 `1b30ca030e` 落地，用户可见 reviewer UI 与生产 PKI/用户身份由 P1-5/P1-6 统一验收。

### 5.5 EVO-P0-5：Fail-closed 证据与审计

建议新增 append-only `evolution_events` 和 content-addressed artifacts。每次 proposal 至少记录：

- source trace/artifact digest 与数据分片版本；
- derivation mode；Wiki 路径记录 revision/pattern/evidence counts，Record & Replay 路径记录 recording/approval/replay digests；
- parent/candidate unified diff 与 digest；
- proposer/evaluator/governor 模型、版本、prompt 和权限快照；
- target model、OS、tool/API、sandbox 和依赖 lock；
- before/after 分项分数、置信区间、成本和安全报告；
- accepted/rejected/rolled-back 原因、actor 和时间；
- 签名、hash chain 和 revocation 状态。

日志持久化不是“non-critical”。任何 promotion receipt 写入失败、校验失败、签名失败或 ledger 不可用都必须 fail closed。

验收标准：

- 100% **自动晋级的 active Skill 版本**可从 digest 反查 source evidence、derivation mode、proposal diff、Eval 和审批者；Wiki 派生版本必须回指 Wiki pattern，Record & Replay 可回指 recording/approval/replay receipts，不强迫伪造 Wiki 中转。手工/导入的 legacy Skill 至少有 owner、source/import digest、权限与 migration 状态。
- 100 次数据库异常、磁盘满、断电、hook timeout 和 evaluator crash 故障注入中零误晋级。
- rejected proposal 的非敏感 metadata、digest、原因和 tombstone 按 retention policy 可查；敏感 payload 服从 TTL、用户删除与 crypto-shredding，Proposer 仍可用 tombstone 避免无证据重复提案。
- 审计导出可离线验证 hash chain、签名和 artifact digest。

实施结果（2026-09-02，提交 `27b7e267e9`）：**离线审计导出与独立验证缺口已关闭，路线项仍为部分完成。** `EvolutionLedger.exportAuditBundle()` 在同一账本锁和认证 state 下导出 signed identity、store marker、完整 event/anchor 链、当前 durable witness，以及逐事件按 tenant 和 ref 绑定的 artifact 原字节与 resolution receipt；导出时重新解析每个 artifact，只有 validation aggregate 与原事件精确一致才返回。`verifyEvolutionLedgerAuditBundle()` 不读取原 ledger、witness 或 ArtifactStore，先校验严格 schema/capacity/canonical export digest 并捕获 plain-data graph 与同步 trust ports，再逐条重算 identity/store/event/anchor/segment/witness payload 和 artifact validation digest。真实测试在导出后删除两个在线 store 仍得到 verified 结果；空 genesis 和 legacy/domain 混合链可验证，而重算外层摘要后的尾部截断、signed 内容替换、artifact bytes/receipt 替换、排序与额外证据均失败关闭。Ledger 全量 48/48，相关六文件 104 通过、1 项按平台跳过。该批当时尚缺持久索引/snapshot，随后已由 `00686ceda8`、`9c77318e59` 关闭；路线项仍有生产 authority、迁移、生产规模/故障注入和统一 wiring，因而不升级为完成。

补充实施结果（2026-09-02，提交 `00686ceda8`）：**进程内认证增量 prefix 与查询索引缺口已关闭。** 所有公开只读入口改用同一增量 state loader；缓存不能绕过文件真实性检查，既有 segment/anchor 仍逐文件重算摘要，HEAD、identity、store marker 与独立 witness 仍重新认证。只有完整 prefix 与缓存一致时才复用已验证事件，外部合法追加只解析和验证新增尾部。每个认证 state 同时构建不暴露给调用者的 eventId/eventDigest `WeakMap` 索引，sequence 利用连续数组直接定位；`queryMany()` 最多接收 10,000 个 selector，并在一次锁、一次认证 state 下完成，默认不制造成千上万个签名 receipt。5,000 个混合查询在 `<5s` 门内完成且历史 event/domain-event 签名验证为 0，外部实例追加后只验证新增 1 个 event；Ledger 49/49，相关六文件 105 通过、1 项按平台跳过。该批尚缺的跨重启 snapshot 随后由 `9c77318e59` 关闭。

补充实施结果（2026-09-02，提交 `9c77318e59`）：**可跨重启复用的持久认证 snapshot 已完成，路线项仍为部分完成。** `checkpointState()` 将当前完整 state 与 canonical segment/anchor 文件摘要写成以 witness digest 命名的不可变 snapshot；snapshot 自身由 ledger trust root 签名，并同时绑定 identity、store incarnation/entry、HEAD/anchor 与独立 witness generation/digest。新实例仅在这些当前 authority 全部吻合后采用 snapshot，仍重算真实文件摘要、规范 schema、event/anchor/hash chain 与文件名/字节逐项关系，但省去历史 event/anchor 外部签名调用；进程内后续读取仍优先走已重新认证的 memory prefix，不会反复解析 snapshot。损坏 cache 回退到完整权威日志验证，旧 witness snapshot 改名重放也不能命中。mixed legacy/domain 负测与 100 并发事件 checkpoint→新实例 `<5s` 基准均通过；Ledger 50/50，相关六文件 106 通过、1 项按平台跳过。该批尚缺的旧 snapshot retention/清理随后由 `d6c645aefd` 关闭。

补充实施结果（2026-09-02，提交 `d6c645aefd`）：**snapshot retention 与清理边界已关闭。** checkpoint 成功后只保留当前 witness snapshot；清理只匹配 authority 根下精确命名的旧缓存，要求目录项与 `lstat` 同时为普通、非符号链接、single-link 文件，当前 snapshot 永不删除，删除后同步 authority 目录。stale-current 文件不能被静默覆盖，显式移除攻击文件后才能重建并清理旧缓存。当前剩余为生产跨进程持久 authority、生产量级/资源上限、旧 projection/journal 迁移、系统化故障注入和统一生产 wiring。

## 6. P1：建立统一演化控制面

### 6.1 EVO-P1-1：Canonical Raw/Wiki/Skill 架构

建议新增唯一权威对象 `EvolutionRun`，而不是让 TrajectoryStore、Reflection、Decision KB、Prompt Optimizer、SkillImprover 和 Desktop Phase 20 各自定义一次“进化”。

```text
Agent / Tool / User events
          ↓
Canonical Rollout & Artifact Store
          ↓
Raw projection ──→ Wiki Maintainer ──→ Wiki revision
                                       ↓
Active Skill ──→ Single-Skill Proposer ──→ Candidate
                                       ↓
Independent Eval / Policy / Human Review
                                       ↓
Registry promotion / rollback
```

Wiki 是跨轨迹归纳型学习的中间表示，不应成为所有 Skill 的形式主义中转站。现有 Record & Replay 若已具备 recording、人工 approval 和 replay validation receipts，可以通过 `derivationMode=record-replay` 直接进入同一 Candidate/Registry gate；只有需要跨案例归纳的经验才走 Wiki Maintainer/Proposer。

建议目录或逻辑等价物：

```text
evolution/
  raw/events/
  raw/artifacts/
  wiki/index/
  wiki/patterns/
  wiki/evolution-log/
  wiki/skill-impact/
  registry/candidates/
  registry/releases/
  eval/runs/
  policies/
```

Raw 应是逻辑 append-only event 与 content-addressed artifact reference，查询需要的完整轨迹由 deterministic reducer 投影；outcome、tag、合成状态和删除 tombstone 都作为新事件追加，而不是修改原始事件。敏感 payload 使用独立加密对象和 key reference，使法定删除/用户删除可通过 crypto-shredding 完成，同时保留不含敏感内容的 lineage metadata。

验收标准：重复事件、乱序、crash/replay 和 compaction 后，得到相同 Raw/Wiki/Registry 投影；CLI、Desktop 和 Graph 对同一 run ID 返回相同状态与 digest。

实施结果（2026-09-02，工作区）：**该路线项已关闭。** canonical `EvolutionRun` 位于 CLI 与 Desktop 共同依赖的 `@chainlesschain/session-core/evolution-run`，定义唯一 event、projection 和 snapshot schema，并由 CLI evolution、Desktop AI engine、Graph kernel 三个薄适配器直接调用同一个 projector。状态统一包含 append-only Raw event/artifact refs、annotation、tombstone、Wiki revision、Skill candidates、Eval runs、active/LKG release 和 run lifecycle；Wiki 不是 candidate 的必经路径，`record-replay` candidate 可在 Wiki revision 为空时直接进入同一 Registry 投影。

事件只接受 sha256-bound metadata 与 artifact/key reference，递归拒绝 raw `payload|content|prompt|output|secret`；outcome、tag、synthesis status 和删除均以新事件投影，tombstone 保留 lineage 并允许外部 key crypto-shredding。projector 先按 sequence/eventId 规范排序，完全相同的重复 eventId 幂等去重，冲突重复、同 sequence 竞争、跨 tenant/run 混入全部失败关闭。compaction snapshot 固定完整 projection digest、event root、boundary 和 seen-event digest；边界前完全一致的 crash replay 被幂等忽略，替换或未知旧事件拒绝，边界后事件继续产生与未压缩全量重放完全相同的状态和 digest。7/7 跨端契约覆盖 CLI/Desktop/Graph 字节级等价、重复/乱序/进程重放、compaction 后旧事件重放与继续追加、annotation/tombstone、record-replay direct candidate、冲突/跨 run/晚到替换和敏感内容拒绝。真实 Agent ingress 切换与旧壳退役仍归 EVO-P1-6，避免在本数据模型任务中重复计算生产接线。

### 6.2 EVO-P1-2：Evidence-backed Wiki Maintainer

每个 Wiki pattern 建议至少包含：

```yaml
patternId: pat-...
kind: success | failure | constraint | anti-pattern
summary: ...
rootCause: ...
procedure: ...
appliesWhen: []
doesNotApplyWhen: []
positiveEvidence: []
negativeEvidence: []
contradicts: []
supersedes: []
confidence: 0.0
trustDomains: []
lastVerifiedAt: ...
expiresAt: ...
```

Maintainer 需要完成去重、聚类、根因归纳、成功模式提炼、反例维护、矛盾检测和 evidence count 更新。不能因为某次 Skill proposal 被拒绝就回滚 Wiki，但必须记录拒绝结果，降低或修正关联模式的可操作性。

WikiSkill 只对 Skill proposal 评分，Maintainer 生成的 Wiki pattern 本身不经过同等 gate 且不会随候选回退。本项目因此应把 pattern 定义为可纠错假设，而非已验证事实，至少区分 `hypothesis / corroborated / contradicted / revoked`；单条 LLM 总结不能直接成为可编译 procedure，必须有多源证据或真实 grader receipt。proposal 被拒绝时保留历史，但要更新关联 pattern 的 impact 与反证，防止错误 Wiki 跨轮累积。

知识不是无限追加：pattern 需要 merge、decay、stale、tombstone 和 revocation。非敏感审计 metadata 可按策略保留；敏感 payload 必须服从 retention、用户删除与 crypto-shredding，默认检索视图同时剪枝，并沿依赖图使派生对象 stale/revoked。

实施结果（2026-09-02，工作区）：**该路线项已达到仓库闭环。** `EvidenceBackedWikiMaintainer` 已建立认证 trusted-projection ingress、tenant/digest 绑定、最小权限构造策略和确定性 Wiki revision reducer。canonical state 同时维护 pattern、默认检索 index、append-only evolution log、Skill proposal impact、evidence metadata 与反向依赖；upsert 会按规范 fingerprint 去重，显式 merge 仅允许同 kind pattern，counterevidence/contradiction、TTL、半衰期 confidence decay、evidence revoke/delete、pattern revoke/tombstone 会使 pattern 进入 `contradicted/stale/revoked/tombstoned` 并从默认 index 剪枝。单源模型总结保持不可操作 `hypothesis`；多 trust-domain evidence 或真实 grader receipt 才能使 procedure 进入 `corroborated`，proposal rejection 只追加 impact/rejection count 并降低 operational confidence，不删除或回滚历史；decision candidate/outcome/pattern/reason 必须与认证 receipt digest 精确绑定。持久组合直接复用 `EvolutionArtifactPorts + EvolutionLedger`：有限 `wiki-revision` 类型仅允许 `evolution-ledger` retention，branded resolver、防 artifact substitution、head/sequence CAS、previous-revision lineage、跨 adapter 恢复和 append 响应丢失幂等均已落地；真实组合测试进一步证明 actual Ledger 文件、签名/witness 与 ArtifactStore 可由新实例恢复同一 state digest。Maintainer 13/13、adapter 6/6、真实 ArtifactPorts 25/25、EvolutionLedger 45/45 通过，另 1 项按平台条件跳过。生产 Agent evidence ingress、通用旧账本迁移和敏感 evidence 删除不属于本 Maintainer 重复实现，分别归 EVO-P1-6、EVO-P0-5、EVO-P0-4/P2-6。

### 6.3 EVO-P1-3：Wiki-informed Single-Skill Proposer

Proposer 初始只读取 Wiki index、Skill impact、active Skill digest 和训练任务结果摘要；需要时按权限选择性读取 pattern 和 Raw，避免一次性塞入全部轨迹。

每个 proposal 必须：

- 只创建或修改一个 Skill；
- 提供 `PURPOSE.md` 或等价结构，回指 pattern 和 source evidence；
- 提供适用条件、不适用条件、失败反例、回退步骤和验证方法；
- 明确 requested capabilities、target runtimes 和上下文成本；
- 生成 machine-readable diff，不直接写 active 文件；
- 如果证据矛盾或样本不足，输出 `no-proposal` 或 `needs-evidence`，不能为了完成循环强行修改。

WikiSkill 的研究结果支持在**演化训练 rollout 的 Pilot** 中默认让执行 Agent 只读 active Skill、Wiki 只对 Maintainer/Proposer 开放。ChainlessChain 应把该实验条件实现为可配置 capability policy，并做按域对照；它不是所有生产推理永远禁止访问 Wiki/Memory 的通用结论。

实施结果（2026-09-02，工作区）：**该路线项已关闭。** `WikiInformedSkillProposer` 的构造期 descriptor 固定 tenant、EvolutionRun、目标 Skill、Wiki revision、proposer model、最小样本和选择性证据上限；capability policy 要求 proposer 可读 Wiki且执行 Agent 不可读 Wiki。每次提案首先严格按 Wiki index、Skill impact、active Skill、training summary 顺序读取并验证 trusted/digest-bound envelope；矛盾或样本不足时不调用生成器，直接返回 `needs-evidence`。生成器可返回 `no-proposal`，或只请求有界的 `pattern|raw` 证据并重试一次，不能扩大到未授权数据面或为完成循环强行生成变更。

proposal validator 将 Skill name 固定为 descriptor 中的唯一目标，要求 PURPOSE summary 回指已解析的 pattern/source evidence，且必须同时给出适用条件、不适用条件、失败反例、回退步骤、验证方法、requested capabilities、target runtimes 和正数 context token/byte 上限。machine diff 仅允许 `SKILL.md`、`PURPOSE.md`、`assets/`、`references/`、`scripts/` 候选根，拒绝绝对路径、`..`、active 或 `.chainlesschain` 越界；最终 canonical proposal 连同全部 digest lineage 只发送到 `createCandidate` sink，且回读候选必须逐字段匹配 Skill、内容、Wiki lineage、capability 和 target runtime，任何适配器替换都会失败关闭。10/10 定向测试覆盖成功纵切、固定初始读取、矛盾/样本不足 abstention、pattern 选择性读取、no-proposal、第二 Skill/active path/未知 lineage 拒绝、证据篡改、capability 隔离、candidate acknowledgement failure 和 target runtime substitution。真实 Wiki authority 的统一存储与维护仍由 EVO-P1-1/P1-2 提供，不作为本 proposer 控制协议的重复阻断。

### 6.4 EVO-P1-4：目标运行时 Eval、Shadow 与 Canary

每个已验证 Skill 都应附兼容矩阵：

`model family/version × OS/arch × tool/API version × permission profile × domain/data version`

跨模型 Skill 只能先进入 target-specific validation。对于模型特有 workaround，应允许生成 adapter 或 variant，不能把源模型 Skill 静默设为全局 active。

上线流程建议：

1. offline replay；
2. hidden holdout；
3. shadow，只记录候选决策、不产生副作用；
4. canary 按 tenant/user/session 固定路由；低流量部署使用“接下来 N 个低风险会话/显式 cohort”，有足够流量时再使用预注册百分比；
5. 逐级扩大；
6. 达到预注册质量/成本回归界限、安全违规或预算越界时自动回滚；界限按风险和样本功效校准，不把固定 `+2pp` 当通用标准。

模型、工具或依赖版本变化时，受影响 Skill 自动进入 `stale-needs-revalidation`，而不是继续沿用历史徽章。

### 6.5 EVO-P1-5：Registry、生命周期与单写者治理

Skill Registry 应统一名称空间、semver、content digest、依赖 lock、owner、tenant、trust、sensitivity、allowed tools/sinks、target runtime 和 revocation。

落地时优先把 recorded Skill store 与 Plugin lifecycle 包装成同一 artifact activation port：前者提供 Skill approval/replay/expectedRevision 语义，后者提供 immutable version、active pointer、签名/SBOM、journal、lock 和 recovery。不要让新 Registry 绕过这两套已验证的防线；也不要直接复用整个 Plugin 模块而把 Plugin 专属 marketplace/source policy 强耦合进 Skill，应抽取最小公共事务内核并用 contract test 证明旧路径行为不变。

多 Agent 只用于职责分离和并行评测：

- proposer：只写 candidate；
- critic：只读，寻找反例和过拟合；
- evaluator：只运行固定评测；
- governor：只校验 policy、签名和权限；
- promotion controller：唯一 active pointer 写入者。

Registry 写入必须使用 lease/fence/CAS，避免两个 proposer 或两个客户端同时晋级导致覆盖。任何 Agent 都不能通过自修改 prompt 或 Skill 获得更高权限。

P1 必须同时交付一个最小 reviewer surface：展示 evidence 摘要、candidate diff、权限变化、Eval receipt、target runtime，并支持 approve/reject。P2 Workbench 再补完整时间线、搜索、解释、批量治理和高级可视化；不能因为完整 Workbench 排在 P2，就让 P1 人工门禁退化为盲批。

实施结果（2026-09-02，工作区）：**reviewer 控制协议、持久 decision authority 和 active mutation 人工门已落地，最终用户 surface 仍未接线，因此路线项保持部分完成。** `SkillPromotionReviewPacket` 已稳定包含本节要求的 evidence summary、candidate unified diff、parent-relative capability changes、认证 matrix Eval receipt、target runtimes，以及 `534ca5f4e5` 新增的 Unicode-aware content-risk findings/digest；所有字段及整体 packet 均有 digest。canonical policy envelope 只能按 digest 经捕获的 durable resolver 取得完整 decision，branded provider 要求独立 signature verifier、`automated=false`、唯一 human IDs、短时效、approved decision 和 exact tenant/Skill/candidate/packet；任何 capability 增量要求双人，任何 content risk 同样要求双人并显式确认摘要，无增量且无风险也不能零人通过。`1b30ca030e` 新增的 `SkillPromotionReviewLedgerAdapter` 只接受受信 builder packet，将 packet/decision 写入有限 ArtifactPorts ledger 类型和精确 lineage Ledger event；approve/reject 都须独立签名验证，同 packet 决策唯一，响应丢失可恢复，真实 Ledger/witness 新实例可重建队列并向原 provider 提供 resolver。Agent root 的 evaluated-only facade 仍固定 matrix verify→human review verify→mutation authority consume→release prepare/CAS；release policy lineage 和 procedural Memory evidence 都保留 review/content-risk receipt binding。尚未完成的是把同一持久 packet 和 approve/reject 动作呈现在 CLI/Desktop 最终用户 surface、部署生产 PKI/用户身份、让唯一产品入口构造该 root，以及 kill switch、canary/LKG 可视状态；故不能把协议和持久 adapter 当成已交付 UI。

### 6.6 EVO-P1-6：统一生产接线并退役重复壳

建议把真实生产事件接到统一 adapter：

- UserPrompt/TurnStarted → Raw start event；
- ToolRequested/ToolCompleted/ToolFailed → Raw tool events；
- ResponseCompleted/UserCorrection/TestReceipt → outcome evidence；
- SessionEnd/GoalEnd/ScheduledBatch → Maintainer trigger；
- CandidateCreated/EvalCompleted/HumanTaskSettled → Registry transition。

CLI `learning-hooks.js` 不应继续作为无人调用的平行接口；Desktop Phase 20 的六个 manager 应作为 Maintainer、Eval 或 UI adapter，不能各自写“进化终态”。Desktop 未接线的 `self-evolving-system` 可降级为 metrics projection 或退役；CLI evolution 模块中的真实治理动作保留，只有公式型训练指标移出“训练成功”语义。

### 6.7 EVO-P1-7：结构化 Memory、Compaction 与多 Agent 权力分离

借鉴 Claude Code 和 Codex 的最新能力，但补上其共同缺口：

| 层 | 内容 | 自动经验是否可覆盖 |
| --- | --- | --- |
| Episodic | 原始会话、工具、artifact、用户反馈 | 只追加或依法删除，不静默覆盖 |
| Semantic | 稳定事实、约束、架构决定、矛盾 | 可提案，需证据和冲突处理 |
| Procedural | validated Skill、恢复步骤、workflow | 只能经 promotion gate 更新 |
| Policy | AGENTS、组织规则、权限和合规 | 不得由自动经验覆盖 |

Compaction 必须保存 requirements、decisions、open risks、failed attempts、tests、goal state、delegated tasks 和 memory lineage。`PostCompact` 运行一致性检查；失败时恢复上一快照。

多 Agent 共享的是有证据和 scope 的事实黑板，而不是自由文本“结论”。子 Agent 的经验先进入统一提炼队列，不能直接污染组织 procedural memory。

实施结果（2026-09-02，工作区）：**该路线项部分完成。** `@chainlesschain/session-core/structured-evolution-memory` 提供唯一事件、投影和快照 schema，并导出到共享包主入口。事件只接受 digest-bound content/artifact reference 与 metadata，拒绝 raw content/secret、跨 tenant、sequence gap、冲突重放和跨 layer memoryId；完全相同的乱序/重复事件确定性投影，增量 state 必须匹配上一 projection digest。episodic 记录 append-only，删除使用 governor tombstone；child-agent/proposer 只能提交带 evidence 的 semantic proposal，接受必须同时绑定原 content/artifact/evidence、critic receipt、evaluator receipt 和 governor；procedural 只允许 promotion-controller+promotion receipt，policy 禁止自动经验并要求 human governor+policy receipt。运行时 append 仅从 tenant-bound branded authority 取得 actor 身份；高权限 transition 由 branded provider 解析 canonical digest/issuer-bound receipt，核验真实 ArtifactStore+Ledger subject、authority revision/handler、独立认证及 memory/content/artifact/evidence 绑定。Compaction 强制保留八类关键状态；CLI Hooks V2 与 Desktop HookSystem PostCompact adapters 都要求至少一个完整成功结果且无 block/prevent/error，再由 attestor 固定 outcome/candidate/projection/previous snapshot，失败或 persistence 异常不替换上一快照。持久 adapter 具备 CAS、lineage、并发冲突、响应丢失幂等、hydration 校验及实际 Ledger 文件/签名/witness reopen；同一真实组合已验证 receipt→semantic acceptance→snapshot 的跨实例恢复。`StructuredMemorySemanticReviewPipeline` 已把真实 proposal、四方独立 critic/evaluator producer/attestor/verifier、双 receipt durable acknowledgement 与 governor accept 串成同一失败关闭流程；`SkillPromotionController` 已写入 procedural authority receipt，`RemoteApprovalBridge` 已在 signed consumed lease 由 host durable store 验证后写入 policy authority receipt，并在 Memory 持久确认前阻止工具 dispatch。正式 `createEvolutionFileWitness()` 还将 witness 签名/验证交给外部同步 authority，以 owner-only 存储、严格跨进程锁、单调认证 history、discard fence 和完整 fsync/rename 链提供本机 durable witness，并由真实 Ledger 崩溃重开用例验证。控制协议 19/19、session-core 全量 538/538、Memory/authority adapter 8/8、Semantic pipeline 联合回归 12/12、CLI PostCompact 5/5、Desktop PostCompact 5/5、ArtifactPorts 25/25、PromotionController 联合回归 26/26、RemoteApproval 联合回归 17/17、FileWitness 6/6 通过，另 1 项按平台条件跳过。最终 Agent production composition、生产密钥托管/跨主机 witness 与进程级 reconciliation 验收尚未接线，故不提前标为仓库闭环。

补充验收（2026-09-02）：AgentRuntime/root 的完整 evaluated promotion 已接通 root-owned procedural append，并覆盖 release commit 后 Memory 响应丢失、显式 pending 状态、幂等 reconciliation 与新 root 恢复；同时修复 matrix envelope digest 与 receipt body digest 混用导致的必然 post-commit 失败。P1-7 继续保持“部分完成”仅因为生产密钥/跨主机 witness 和真实 OS 进程演练尚无权威证据，不再把仓库内 Agent composition 列为剩余。

补充验收（2026-09-02，file backend）：正式构造根已强制 ledger/witness authority 与存储路径分离，并由两个真实 Node PID 验证同一 ledger/witness 重开；保留 witness 而移除本地 event/authority 后，第三个 PID 失败关闭。因而“通用 Ledger OS 进程重启”不再列为缺口；仍未关闭的是生产密钥托管/部署、跨主机 witness fault domain，以及把 release commit→Memory pending→reconciliation 整条链放入真实 OS 进程退出/重启演练。

补充验收（2026-09-02，promotion reconciliation）：root 已可从持久 authority ledger 主动发现、重新认证并补齐 promotion Memory；同进程真实 release pre-commit failure 与三 PID durable receipt→Memory 恢复两组证据均通过。跨进程恢复不再依赖未认证 handoff 或上一进程保留的 JS 对象。最后的本机演练缺口只剩把“实际 release producer 执行”和“硬退出”也放入同一个进程 A，而不是由相邻的真实 release 测试与真实进程测试分别证明。

补充验收（2026-09-02，process kill）：上述最后缺口已由独立 Vitest/Node 进程中的真实 Gate→release→authority receipt→Memory pre-commit failure、父进程强制终止、两个新 Node 进程自动 reconcile/reopen 的单场景测试关闭；同步 marker 只决定何时 kill，不进入进程 B 的认证或恢复输入。P1-7 因而升级为“仓库闭环”，外部生产密钥与跨主机 witness 仍保持明确发布门。

### 6.8 EVO-P1-8：SkillInvocationReceipt 与因果归因

修复 IPC 依赖注入、`BaseSkill`/collector 事件字段和 token 字段不一致后，现有 `skill_execution_metrics` 才可作为 adapter；CLI 现有 name-level usage attribution 也应接入。即便如此，“Skill execute 未抛错”只说明局部调用完成，不能回答 Skill 是否被正确选择、是否改善最终任务、是否因模型或环境变化才成功。每次**选择、暴露与执行**至少记录：

```yaml
receiptId: ...
evolutionRunId: ...
traceId: ...
trajectorySegmentId: ...
selectedSkillDigests: []
routerCandidates: [{digest: ..., score: ..., reason: ...}]
providerModelVersion: ...
toolSetDigest: ...
osSandboxPermissionPolicyDigest: ...
taskCohort: ...
executionStatus: ...
graderReceipts: []
userCorrectionRef: null
tokenCostLatency: {}
```

模型切换、fallback、tool set、permission/policy 或关键依赖变化都关闭当前 segment 并开启新 segment；不得把跨 segment 的结果直接归因给同一个 Skill 版本。Receipt 只保留归因所需的 bounded metadata/digest，敏感输入输出继续通过受控 artifact reference 访问。

验收标准：自动候选与 canary 运行 100% 产生可 join 的 exposure/outcome receipt；同一 trace 可确定性回答“选了什么、为何选择、在哪个环境、结果由谁判定、花费多少”；在该覆盖率达标前，不启用 outcome-aware reranking 或自动效果声明。

实施结果（2026-09-02，提交 `be547ba42f`）：**该路线项已关闭。** `chainlesschain.skill-invocation-receipt/v1` 位于共享 `@chainlesschain/session-core`，只保留有界 metadata/digest，不写 task/prompt/output 内容。Desktop `SkillRegistry` 在执行前固定 selected Skill digest、router candidate/reason、evolution run/trace/segment、provider model、tool set、OS/sandbox/permission policy 与 cohort；`BaseSkill` 透传同一个 invocation start；`SkillMetricsCollector` 在 outcome 时补齐 execution status、grader receipt digest、user correction ref、token、cost、latency 和最终 receipt digest，并通过 `skill_execution_metrics.context_json` 持久化。CLI `run_skill` 消费同一 shared builder/verifier，把 receipt 放入 tool result 并随 transcript 持久化；真实 hook trace ID 已贯穿外层和隔离 child，不再退化为 session ID。

`automatic-candidate`/`canary` 缺归因字段会抛出 `CC_SKILL_ATTRIBUTION_REQUIRED`，且发生在 Desktop Skill invocation 计数或 CLI child 启动之前；普通调用可生成 `incomplete` receipt，但 `attributionEligible=false`，不能用于 outcome-aware reranking。共享 `verifySkillInvocationReceipt()` 拒绝 digest tamper，`buildSkillInvocationTraceProjection()` 按 startedAt/receiptId 确定性排序并投影 Skill 选择、router reason、provider/model、工具与策略环境、execution/grader/user-correction 判定以及 token/cost/latency 汇总。Desktop/CLI/collector/Phase/pipeline 5 文件 **208/208** 通过，ESLint 0 error，`git diff --check` 通过。上层 Eval/Wiki 后续只需按已固定的 evolutionRunId/trace/segment/grader receipt refs 领域关联，不再需要重建调用归因协议。

### 6.9 EVO-P1-9：复用现有底座的有界评分改进循环

建议先实现 `cc lab evolution pilot` 或等价内部入口，不先建设新调度服务：

1. 固定 baseline digest、训练/验证 split、grader、runtime fingerprint 与 root budget。
2. 在现有 worktree/checkpoint 或 candidate store 中，每轮只产生一个聚焦候选。
3. 优先运行确定性测试/产物 grader，再运行隔离模型 evaluator；记录 receipt。
4. 对比 best；满足预注册 gate 才更新本次 run 的 best candidate，否则丢弃候选，active 始终不变。
5. 将失败分类为 `procedure | model | data | infrastructure | permission/policy | security`。MCP discovery timeout、provider transient、sandbox 缺失和权限拒绝默认不记为 Skill 负样本，除非任务目标本身就是恢复这类故障。
6. proposer、critic、evaluator、subagent 的 token/cost/time/turn 全部记入根 `EvolutionRun`；任一预算耗尽、证据未知或 receipt 写入失败即停止，不允许隐藏的子任务继续优化。
7. snapshot/restore 延用 `GoalConditionEngine` 的确定性状态；代码候选复用 worktree/checkpoint，Skill 发布仍走 candidate registry，不把 Git checkpoint 当作 active Skill promotion transaction。

这一步是 P1 的离线 candidate-only 纵切，用来验证控制协议和 ROI；P2 才把通过的闭环接入 opt-in 真实流量、人工 review、shadow/canary。验收时应覆盖 budget exhaustion、provider/MCP transient、permission denial、evaluator crash、resume 和相同输入重放，并证明不会误改 active 或把基础设施失败编译成错误 Skill。

实施结果（2026-09-02，工作区）：**该路线项已关闭。** 新增 `BoundedSkillImprovementPilot` 作为 `cc lab evolution pilot` 的等价内部控制面。run descriptor 在启动前固定 tenant、EvolutionRun、Skill、baseline candidate/digest、互异的 train/validation split digest、确定性 grader、隔离 evaluator、runtime fingerprint、预注册 gate 与 root budget，并计算不可变 run digest；snapshot 恢复时 descriptor 或 digest 不匹配即拒绝。每轮 round key 只由 run digest 与轮次确定，proposer 只能返回一个候选，candidate sink 只返回 immutable candidate/content digest；确定性 grader 的可信 receipt 先于隔离 evaluator，任一 authority digest、可信标记、score 或 receipt digest 未知都会在 evaluator/best 更新前失败关闭。

best 更新要求两个 grader 均有可信证据、组合分数超过 baseline/best 的预注册增益、root token/cost/子角色 turn/工作时长与墙钟预算未耗尽、round receipt 获得 digest 一致的 durable acknowledgement，并在 receipt 前后两次确认 active state digest 未变化。控制面构造参数不含 active 或 promotion writer；即使外部端口越界改动 active，也会转为 security failure，候选不会成为 best。失败分类覆盖 `procedure | model | data | infrastructure | permission/policy | security`；provider/MCP transient、sandbox unavailable、evaluator crash 与 permission/policy denial 默认 `skillNegative=false`，只有 run 明确以故障恢复为目标时才允许归为负样本。新循环与既有 `GoalConditionEngine` 两文件 **31/31** 通过，并覆盖根预算先于成功、单候选拒绝、grader 顺序、best 保留、未知证据、receipt ack failure、provider/MCP transient、permission denial、evaluator crash、active 漂移、snapshot/resume 与相同输入 round key/快照重放。真实流量、人工 review、shadow/canary 继续由 EVO-P2-1 承担，本路线项不提前声明生产自动进化。

## 7. P2：产品体验、生态与规模化

### 7.1 EVO-P2-1：窄域、受控生产 Pilot

在 P1 离线 candidate-only 纵切通过后，选择高重复、低副作用、答案可自动验真的窄域，例如固定仓库的测试失败修复建议、结构化数据导入或 Record & Replay 稳定流程。

生产 Pilot 默认 opt-in、单租户或明确 cohort；自动阶段仍只生成 candidate。用户旅程为：

`查看 Why/Evidence → 审查 Diff/权限 → 查看 Before/After → 批准 Shadow → Canary → Active`

至少跨一个预注册观测窗口记录 adoption、success delta、cost delta、用户修订率、误晋级率、回滚率和安全事件；按所需样本量决定窗口，不机械固定 30 天或 5% 流量。未达到门槛不扩域。

### 7.2 EVO-P2-2：Evolution Workbench

工作台应提供一条可解释时间线：

`Raw/Recording evidence → Wiki pattern 或 direct replay derivation → Candidate diff → Eval receipt → Approval → Promotion/Rollback`

这是对 P1 最小 reviewer surface 的产品化扩展：增加检索、完整历史、冲突解释、批量治理与长期指标，而不是 P1 人工门禁的前置依赖。

用户能够回答：

- 为什么产生这个 Skill？
- 哪些成功和失败轨迹支持它？
- 哪些模型、工具和环境验证过？
- 相比上一版改变了什么权限、成本和行为？
- 为什么被接受、拒绝或回滚？
- 当前会话实际固定到了哪个 digest？

### 7.3 EVO-P2-3：Skill Retrieval Router

不要照搬 WikiSkill 的 full injection。建议采用：

`namespace/tag/path filter → BM25 + vector recall → compatibility filter → outcome-aware rerank → conflict resolver`

路由结果显示选择理由、版本、上下文成本和冲突。`500` 个 prompt、Recall@5 `≥95%`、误调用率 `<2%`、本地 p95 `<100ms` 可作为低风险 Pilot 的示例起点，正式阈值按语料规模、错误成本与设备档位预注册；同名或不兼容版本不得静默选择。

### 7.4 EVO-P2-4：跨设备、团队和组织知识

支持 personal/project/team/org scope、端到端加密、RBAC、租户隔离、离线冲突合并、批准与撤销。两台机器或 cloud session 只同步已授权、已批准知识；个人 memory 不因 Agent Team 协作自动升级为团队规则。

删除证据、用户行使隐私删除或组织撤销知识时，反向依赖图必须定位并处理派生 Wiki、candidate 和 active Skill。

### 7.5 EVO-P2-5：跨模型 Skill 来源/目标适配与市场治理

WikiSkill 实验的是 source-model-evolved Skill 文件向 target inference model 的直接迁移，不是教师/学生蒸馏。实验既有正迁移，例如 Qwen-3.6-27B 的 ALFWorld Skill 使 Qwen-3.5-9B 达到 `70.2%`、高于其 self-evolved Skill 的 `63.4%`，也有 Spreadsheet 的严重负迁移。因此可以把“强模型 proposer 为小模型起草候选”作为产品假设，但必须在目标模型上重新评测，且不能预设更强 source 必然更可迁移。

Skill/Plugin 市场增加：签名、来源 commit、SBOM、依赖 lock、权限 manifest、模型/OS/工具兼容矩阵、可复现 Eval badge、演化 lineage、分阶段更新和一键回滚。排名不能只看安装量或 LLM 自报 confidence。

### 7.6 EVO-P2-6：Wiki Pruning 与长时在线适应

建立 pattern 合并、重复检测、evidence decay、TTL、stale、tombstone、矛盾解析和压缩。审计证据保留，默认检索索引可清理过时知识。

只有离线闭环长期稳定后才研究单次长任务内适应；online change 不获得新增权限、不跨过 promotion gate、不跨租户，并在任务结束后重新进入离线验证。

## 8. 90 天建议路线图

90 天目标应限定为“一个窄域、candidate-only 到受控 shadow 的纵切”，不是交付全部 P1/P2 平台。跨组织同步、市场治理、通用 Router 和长期在线适应均不进入本周期承诺。

### 阶段 A：第 1～2 周，冻结风险并校正真实性

- 扩展现有 canonical capability manifest 的 evolution 状态投影，并校正产品文案。
- 强制 `SkillImprover.skillsDir` 只能指向 candidate root，Synthesizer 改为 diff-only/candidate-only。
- 修复无 artifact 仍 created、self-improving 持久化失败仍 success、keyword fallback 冒充 Skill、metrics-only 模块命名问题。
- 修复 Phase 16 pipeline/metrics/workflow IPC 依赖注入与 Skill metrics 事件字段 contract，并用真实实例测试证明 `wired=true`。
- 建立当前所有 learning/evolution 入口、调用点和 writer inventory。

退出条件：没有未登记的 active Skill writer；所有正式入口的状态与 artifact 一致。

### 阶段 B：第 3～5 周，建立 Candidate 与安全门

- 从 recorded Skill lifecycle 与 Plugin activation transaction 抽取公共端口，补 content-addressed Skill candidate、统一 active pointer、last-known-good 和 rollback；代码/工作区候选先复用现有 worktree/checkpoint。
- 上线 Raw redaction、tenant scope、quarantine、名称/路径/schema/capability 校验。
- 建立 append-only evolution ledger 和 fail-closed receipt。
- 对目录逃逸、注入、秘密、跨租户、磁盘/数据库失败做负测。

退出条件：所有自动变更只能进入 candidate；故障注入零误晋级；60 秒回滚达标。

### 阶段 C：第 6～9 周，接入真实 Eval 与三层架构

- 复用 rollout/eval/record-replay，建立 replay、holdout、对抗和成本评测。
- 建立 Raw event projection、Wiki pattern/index/log/impact 和 `EvolutionRun` 状态机。
- 实现 Maintainer 与 Single-Skill Proposer 的 capability 隔离。
- 扩展 Skill metrics 为 `SkillInvocationReceipt`，统一 model-switch/fallback segment、failure taxonomy 和根预算归属。
- 用 `GoalConditionEngine + Eval + worktree/checkpoint` 跑通有界评分改进循环。
- 输出目标模型、工具、OS 和权限 profile 的兼容 scorecard。

退出条件：至少一个窄域 Skill 能完成 evidence→candidate→eval→reject/validate 全流程，且不修改 active。

### 阶段 D：第 10～13 周，Shadow Pilot 与统一接线

- 将真实 CLI/Desktop Agent events 接入 canonical adapter。
- 退役或降级重复 self-evolving 壳和未接线 learning hooks。
- 上线最小 reviewer surface、人工 review 与 shadow；只有样本功效和风险门满足时才进入显式低风险 cohort canary。
- 启动预注册 Pilot 观测窗口，不因演示节点或固定日期而放宽 P0 门禁。

退出条件：至少一个 Skill 在真实目标环境完成可审阅晋级和自动回滚演练；是否扩大范围由量化结果决定。

## 9. 建议验收标准

下列“零越权/零 secret/无审计不晋级”等安全性质是硬门；样本数、时延、百分比和观测窗口是 Pilot 默认值，落项时必须按风险等级与统计功效校准并写入版本化 policy，不能把示例数字当成跨域 SLA。

### 9.1 P0 发布门槛

| 类别 | 必须满足 |
| --- | --- |
| 真实性 | artifact、数据库、UI、CLI 状态一致；未接线能力不得显示成功 |
| 写入权 | active registry 只有 promotion controller 可写；其他路径 100% 阻止 |
| 安全 | 注入、secret、路径逃逸、symlink、跨租户、权限扩大负测全部通过 |
| 审计 | 100% 自动晋级的 active 版本有完整 evidence、derivation mode、diff、eval、policy、actor 和 digest lineage；Wiki/record-replay 各保留真实来源链，legacy/imported 有来源与迁移标记 |
| 故障 | 100 次关键故障注入零误晋级；crash 后可确定恢复 |
| 回滚 | 60 秒内恢复上一版本及依赖 lock，字节级一致 |

### 9.2 P1 Definition of Done

- CLI、Desktop、Graph 对同一 `EvolutionRun` 使用相同 schema、状态和 digest。
- Raw 是 append-only event/artifact，重放结果确定；outcome 和合成状态不修改原始证据。
- Wiki 至少支持 pattern、index、evolution log、skill impact、矛盾、过期和撤销。
- 每个 candidate 默认只改一个 Skill，并有 PURPOSE/evidence、权限 diff 和 target runtime；显式 dependency transaction group 必须全成或全败。
- Proposer 无 validation/test 答案和 active write 权；Evaluator 无 proposal write 权。
- 每个可晋级 Skill 有 replay、holdout、对抗、安全、成本和兼容 scorecard。
- 每次 Skill exposure/execution 有可 join 的 InvocationReceipt；模型、工具、permission/policy 变化产生新 segment 并失效相关批准/Eval cache。
- raw evidence、model-visible projection 与 trusted learning projection 有独立 digest、ACL、转换 receipt 和删除传播。
- 有界改进循环把所有子 Agent 消耗计入根预算，并能区分 procedure 与 infrastructure/permission/provider failure。
- shadow/canary 回归越界时自动回滚，且不会切换正在运行会话的 Skill digest。

### 9.3 P2 Definition of Done

- Workbench 可从任意 active Skill 回溯完整演化时间线并一键回滚。
- Router 在真实基准达到 Recall@5、误调用率、延迟和上下文预算目标。
- 跨设备/团队同步通过 RBAC、加密、冲突和隐私删除测试。
- 市场 Skill 有签名、lock、权限、兼容和可复现 Eval 信息。
- Pilot 在成功率、成本、修订率、误晋级、回滚和安全上达到预注册样本量与门槛后才扩域。

## 10. 不建议照搬的部分

1. **不要把 WikiSkill 写成 Google 已发布产品。** 它当前是预印本研究框架；论文未链接官方实现，也未报告生产安全验证。
2. **不要把“自进化”写成模型权重训练。** 本报告讨论的是外部经验、知识和 Skill 的受控演化。
3. **不要照搬全量 Skill 注入。** 论文为排除触发误差而这样设计，生产规模下会遇到上下文、冲突和错误触发问题。
4. **不要机械照搬严格 `score > best`。** 小验证集有噪声，中性基础变更也可能为后续迭代铺路，应允许 needs-more-evidence 分支。
5. **不要让执行 Agent 同时当提案者和裁判。** 会形成自证、评测污染、权限混合和难以归因的问题。
6. **不要把 Memory 当 Policy。** 自动摘要或个人偏好不能覆盖 AGENTS、组织规则、权限和合规要求。
7. **不要把多 Agent 并行当作组织学习。** 没有 evidence ledger、scope、冲突和晋级门，多代理只会更快地产生不一致。
8. **不要自动启用生成的 Skill、Hook 或 Plugin。** 热加载能力越强，candidate/active 隔离和版本固定越重要。
9. **不要让 Wiki 永久只增不减。** 生产系统必须支持 stale、merge、tombstone、revocation 和隐私删除传播。
10. **不要重建已有 Manifest、Goal/Budget、Worktree/Checkpoint、Eval、Rollout、Memory、Record & Replay 和 Skill Runtime。** 应通过 canonical ports 收敛，而不是再复制一套。
11. **不要把所有失败都归因给 Skill。** MCP/provider transient、权限拒绝、sandbox/依赖缺失与程序步骤错误必须分开，否则自进化会固化环境噪声。
12. **不要跨模型段做伪因果归因。** model switch/fallback 后应产生新 trajectory segment；没有 InvocationReceipt 时不启用 outcome-aware reranking。

## 11. 审计范围与限制

### 11.1 审计口径

- 外部事实仅使用一手来源：WikiSkill 原论文、Anthropic Claude Code 官方文档/官方仓库、OpenAI Codex 官方文档。
- “官方未描述”表示在本次所列官方页面中没有发现该完整机制，不等于证明厂商内部绝对不存在。
- 本仓库判断基于基线提交的静态源码审计、入口与引用扫描；“未找到生产调用点”不排除运行时字符串、动态加载或外部集成，但当前仓库没有给出可验证证据。
- 审计期间工作区存在与本报告无关的 graph/CI 未提交改动；本报告未修改或依赖这些文件，所引用的 learning/Skill/runtime 事实均按上述 HEAD 基线核对。
- 本次没有启动真实 provider、执行 E2E、修改 Skill 或验证运行时性能；建议优先用 P0 inventory 和 contract tests 复核静态结论。
- WikiSkill 是 2026-08-27 的 v1 预印本，结论可能随论文修订、代码发布和更大规模实验变化。

### 11.2 主要外部来源

- [WikiSkill: Compiling Agent Experience into Persistent Knowledge for Skill Evolution](https://arxiv.org/html/2608.27454)
- [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- [Claude Code memory](https://code.claude.com/docs/en/memory)
- [Claude Code goals](https://code.claude.com/docs/en/goal)
- [Claude Code subagents](https://code.claude.com/docs/en/subagents)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- [Claude Code workflows](https://code.claude.com/docs/en/workflows)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code skills：evaluate and iterate](https://code.claude.com/docs/en/skills)
- [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [OpenAI Codex changelog](https://learn.chatgpt.com/docs/changelog)
- [OpenAI Codex Memories](https://learn.chatgpt.com/docs/customization/memories)
- [OpenAI Codex Computer History](https://learn.chatgpt.com/docs/customization/computer-history)
- [OpenAI Codex Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [OpenAI Codex Build Skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI Codex：Iterate on difficult problems](https://learn.chatgpt.com/use-cases/iterate-on-difficult-problems)
- [OpenAI Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [OpenAI Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [OpenAI Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

## 12. 最终建议

ChainlessChain 不缺“会记、会反思、会写 Skill”的功能点，真正缺的是把这些功能变成可信闭环的演化控制平面。

建议把近期资源集中到两个阻断式 P0：

1. **所有自动变更 candidate-only，独立评测后才能由单写者原子晋级并可回滚。**
2. **Raw→model-visible/trusted projection→Wiki→Skill 全链路建立不可信数据、权限、秘密、路径和审计边界。**

最短 P1 路径是：扩展已有 `CAPABILITY_MANIFEST` 并修复 metrics 接线 → 把 recorded Skill lifecycle 与 Plugin activation transaction 抽成通用 Registry 端口 → 用 `GoalConditionEngine + Eval + worktree/checkpoint` 跑通有界 candidate-only 改进循环 → 补 `SkillInvocationReceipt`、模型分段和失败分类 → 再接 Wiki Maintainer。这个顺序能先验证 ROI 和控制协议，也最大限度复用现有实现。

完成这些前提后，再以现有 Rollout、Memory、Record & Replay、Skill Runtime 和 Desktop Phase 20 为 adapter 扩展到受控生产 Pilot，而不是继续新增平行的“自进化”模块。这样才能把 WikiSkill 的研究启发、Claude Code 的评测/扩展载体和 Codex 的安全/编排基础，转化为 ChainlessChain 可验证、可维护、可规模化的产品能力。

## 13. 全量任务完成情况（截至 2026-09-02）

状态口径：`✅ 已完成` 表示该编号自己的代码、确定性验证及应有生产发布边界已经全部关闭；`🟢 仓库闭环` 表示仓库实现、确定性验证和该编号自身可在仓库内完成的边界已经关闭，只剩由其他统一路线验收的生产切换；`🟡 部分完成` 表示核心底座或可复用原语已经落地，但该编号定义的生产接线、跨进程实现或外部验收尚未全部完成；`⏳ 待完成` 表示目前主要只有依赖、设计或已有系统能力可复用，关键目标尚未形成可验收纵切。

总计 20 项：**6 项已完成、2 项仓库闭环、5 项部分完成、7 项待完成**。计入本次 snapshot-retention 后共有 **58 个基础批次**。这两个计数维度不能混用：基础提交数量不代表路线项完成数量。

| 优先级 | 编号 | 任务 | 状态 | 已完成与验证证据 | 剩余工作 |
| --- | --- | --- | --- | --- | --- |
| P0 | EVO-P0-1 | 能力真实性与 mutation freeze | ✅ 已完成 | canonical manifest fail-closed、CLI learning/evolution truth help、Desktop TechLearning phantom-success 移除、Phase 20 metrics 接线、旧 simulator 未注册、六个 learning/proposer/import writer candidate-only、mutation authority 拒绝审计及产品文档一致性均已关闭；13 文件 295/295 通过；提交 `23125c71e4`；详见 §1.1、§5.1 | 无；通用 Agent/插件 legacy writer 的单写者迁移属于 EVO-P1-5 |
| P0 | EVO-P0-2 | Candidate、Promotion 与 Rollback 事务 | ✅ 已完成 | immutable tenant candidate/release、mutation authority、execution manifest、lease/fence、prepare/finalize ledger、active CAS、journal recovery、session pin、LKG+dependency lock rollback 已闭环；五阶段 crash/真实进程重启、100 并发单赢家和 `<60s` 字节级回滚均通过，核心 3 文件 70/70；提交 `23125c71e4`；详见 §1.1、§5.2 | 无；最终用户 shadow/canary 与唯一 production writer wiring 归 EVO-P1-5，真实 Eval/PKI authority 归 EVO-P0-3 |
| P0 | EVO-P0-3 | 独立真实 Eval Gate | 🟡 部分完成 | 独立监督 Gate、signed target matrix 全 cell 合取、accepted receipt→promotion 窄绑定、typed resolver、evaluated-only controller、attested/bounded/fresh/rotatable/revocation-aware durability adapter 及不暴露 direct promotion/底层 controller 的窄 control-plane facade 已提交。promotion controller 定向回归 15/15 通过；详见 §1.1、§5.3 | 接入真实 grader 与 train/validation/test 隔离；完成统计校准/多重比较、生产受限 control plane 构造接线、跨进程 authority/PKI/child resolver、进程级 kill、崩溃恢复及密钥撤销演练 |
| P0 | EVO-P0-4 | Raw、入模投影与 Skill 编译安全边界 | 🟡 部分完成 | attested Raw/model/trusted 持久投影、ciphertext-only ArtifactStore、secret/PII + injection/quarantine、derivation manifest、Candidate strict schema/name/size/path/symlink/plaintext guard，以及 parent-relative capability diff + Unicode-aware content-risk digest + 1,000 条合成对抗候选 + mutation 前 signed human acknowledgement/quorum 已落地；提交 `bc24db7a0b`、`f668598a42`、`2d7fa726f8`、`534ca5f4e5`、`bd3c29b843`；详见 §1.1、§5.4 | 真实 Agent/tool pre-model ingress、生产 KMS/HSM、删除/撤销传播、更广语义分类及生产流量攻击观测/误报校准；用户 UI/生产 PKI/身份接线归 P1-5/P1-6 |
| P0 | EVO-P0-5 | Fail-closed 证据与审计 | 🟡 部分完成 | append-only tamper-evident ledger、typed domain events、subject-bound transition、认证制品解析与持久账本组合端口、signed identity/event/anchor/witness/artifact 自包含离线导出与无在线 store 独立验证，以及重新认证的增量 prefix、私有 O(1) event 索引、有界 `queryMany()`、witness-bound 持久 state snapshot 与 single-current retention 已落地；提交 `27b7e267e9`、`00686ceda8`、`9c77318e59`、`d6c645aefd`；详见 §1.1、§5.5 | 真实跨进程持久 authority、生产量级/资源上限、旧 projection/journal 迁移、系统化故障注入及生产 wiring |
| P1 | EVO-P1-1 | Canonical Raw/Wiki/Skill 架构 | ✅ 已完成 | shared `EvolutionRun` 统一 append-only Raw/Wiki/Registry/Eval projection；CLI/Desktop/Graph 三端调用同一 projector；duplicate/order/crash/compaction/tombstone/direct record-replay 确定性闭环，7/7 通过；详见 §1.1、§6.1 | 无；生产 ingress 与旧壳迁移归 P1-6，跨进程持久 authority 归 P0-5 |
| P1 | EVO-P1-2 | Evidence-backed Wiki Maintainer | 🟢 仓库闭环 | trusted/digest-bound Maintainer 与生命周期 reducer；`wiki-revision` ArtifactPorts ledger retention、branded resolver、不可变 revision→Ledger event、head CAS、响应丢失幂等及真实 Ledger 文件/witness 新实例恢复已闭环；13/13 + 6/6 + 25/25 + 45/45 通过；详见 §1.1、§6.2 | 本项无仓库内剩余；生产 ingress、通用迁移、敏感 evidence 删除分别归 P1-6、P0-5、P0-4/P2-6 |
| P1 | EVO-P1-3 | Wiki-informed Single-Skill Proposer | ✅ 已完成 | 固定最小 Wiki/impact/active/training 读取；矛盾/样本不足 abstain；pattern/raw 选择性读取；单 Skill PURPOSE、digest lineage、适用/禁用边界、反例、回退、验证、capability/runtime/context cost、safe machine diff 与 exact candidate binding 已闭环；1 文件 10/10 通过；详见 §1.1、§6.3 | 无；统一真实 Wiki authority 与 Maintainer 分别归 P1-1/P1-2 |
| P1 | EVO-P1-4 | 目标运行时 Eval 与负迁移检测 | 🟡 部分完成 | dependency/runtime/target matrix 数据模型、独立 receipt 验证、全 cell 合取、evaluated promotion 与 durability/revocation 组合原语已落地；详见 §1.1、§6.4 | 接入真实跨平台 runtime/grader、统计校准与多重比较、shadow/canary、真实跨进程 receipt store/PKI 和持久 child resolver |
| P1 | EVO-P1-5 | Registry、生命周期与单写者治理 | 🟡 部分完成 | content-addressed tenant candidate/release、lease/CAS/journal/recovery；Agent-root facade 强制 matrix+human review 且不暴露 direct promotion；review packet 已含 evidence/diff/permission/Eval/runtime/content-risk；approve/reject ArtifactStore+Ledger authority、真实文件/witness 重开、provider resolver 与 signed non-automated quorum/风险摘要确认 active gate 已落地；提交 `1b30ca030e`；详见 §1.1、§6.5 | 将持久 packet 与 approve/reject 接入最终用户 reviewer surface；部署 production PKI/用户身份；唯一产品入口构造、kill switch、active/LKG/canary 可视接线与跨进程部署权威 |
| P1 | EVO-P1-6 | 统一生产接线并退役重复壳 | ⏳ 待完成 | capability status 与 Desktop evidence 已校正部分入口；尚无统一控制面纵切；详见 §1.1、§6.6 | 让真实 Agent 事件统一进入演化控制面，迁移生产 adapters，并退役或降级重复 self-evolving 壳 |
| P1 | EVO-P1-7 | 结构化 Memory、Compaction 与多 Agent 权力分离 | 🟢 仓库闭环 | shared canonical 四层 gate、真实 ArtifactStore+Ledger resolver、CLI/Desktop PostCompact、四类 producer、同 stream branded Agent root、新实例恢复、AgentRuntime semantic lifecycle、accepted matrix→真实 release CAS/reopen→root-owned procedural event、authority-ledger 自动 pending reconciliation、remote bridge、正式 durable file witness、file-backend 构造端口、通用 Ledger 重启及实际 release process-kill→新进程 Memory 恢复已落地；相关联合回归均通过；详见 §1.1、§6.7 | 本项无仓库内剩余；生产密钥托管/部署与跨主机 witness fault domain 由目标环境发布门验收 |
| P1 | EVO-P1-8 | SkillInvocationReceipt 与因果归因 | ✅ 已完成 | canonical schema 位于 shared session-core；Desktop DB 与 CLI transcript 共用 builder/verifier；Skill/router/model/tool/policy/segment/outcome/grader/correction/token/cost/latency 均被 receipt digest 固定；candidate/canary 缺字段在执行前失败；deterministic trace projection 可直接回答归因问题；5 文件 208/208 通过；提交 `be547ba42f`；详见 §1.1、§6.8 | 无；Eval/Wiki 使用既有 refs 做上层领域 join |
| P1 | EVO-P1-9 | 有界评分改进循环 | ✅ 已完成 | candidate-only 内部控制面固定 baseline/splits/graders/runtime/gate/root budget；逐轮单候选、确定性 grader→隔离 evaluator、durable receipt、best gate、失败分类、active 不变式及 snapshot/resume/replay 已闭环；与 GoalConditionEngine 合计 2 文件 31/31 通过；提交 `4381aece2c`；详见 §1.1、§6.9 | 无；真实流量、人工 review、shadow/canary 明确归 EVO-P2-1 |
| P2 | EVO-P2-1 | 窄域受控生产 Pilot | ⏳ 待完成 | 尚无 P2 生产能力提前声明；已有 rollout 与 approval 原语可在 P0/P1 关闭后复用；详见 §7.1 | 选择低风险 opt-in cohort，执行人工 review→shadow→canary，并按样本量与退出门槛扩量 |
| P2 | EVO-P2-2 | Evolution Workbench | ⏳ 待完成 | 尚未形成 evidence→pattern→diff→eval→promotion 产品时间线；详见 §7.2 | 实现可解释时间线、权限 diff、兼容范围、审批、版本对比与一键回滚 |
| P2 | EVO-P2-3 | Skill Retrieval Router | ⏳ 待完成 | 现有 Skill loader、索引与 outcome 数据只能作为依赖，不构成受控路由器；详见 §7.3 | 建立 namespace + BM25/vector + outcome-aware rerank、冲突说明和误选评测 |
| P2 | EVO-P2-4 | 跨设备、团队和组织知识 | ⏳ 待完成 | 已有 tenant/RBAC/同步相关底座，但尚无演化知识纵切；详见 §7.4 | 实现加密同步、scope/RBAC、冲突合并、组织批准、撤销和隐私删除传播 |
| P2 | EVO-P2-5 | 跨模型 Skill 适配与市场治理 | ⏳ 待完成 | target matrix 与签名制品原语可复用，尚无市场级兼容与效果凭证；详见 §7.5 | 实现 target-specific adapter、兼容矩阵、签名 lockfile、Eval badge、分阶段升级和撤销治理 |
| P2 | EVO-P2-6 | Wiki Pruning 与长时在线适应 | ⏳ 待完成 | 尚未开始；现有 retention/revocation 思路只构成设计输入；详见 §7.6 | 实现 merge/decay/TTL/tombstone、依赖传播和隐私删除；仅在离线闭环稳定后开展无提权在线适应 |
