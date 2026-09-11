# 112 受治理的 Skill 自进化设计

> 状态：2026-09-11 核对，公开 npm CLI 为 `0.166.44@0651cbcb7d`；candidate/Eval/evidence/ledger/promotion/release、持久化 `EvolutionRun`、Wiki/Memory、页面化 Evolution Workbench、Skill Retrieval、受治理知识同步及签名部署配置仍保持原有 authority 边界。源码另加入 EvolutionLedger 批量写入、增量前缀重验与 v2 manifest head 持久 CAS；目标环境 authority 和 automatic active promotion 继续保持 HOLD
>
> 适用范围：`packages/cli/src/lib/evolution/`、CLI learning writers、Desktop Skill Creator/Sync/Workbench、App Server、IDE 受治理投影与有界请求
>
> 用户文档：[受治理的 Skill 自进化](https://docs.chainlesschain.com/chainlesschain/governed-skill-evolution.html)

## 1. 概述（背景与决策）

旧的 learning、Skill Creator、Skill Improver 和 Skill Sync 路径能够生成或修改 Skill 内容，但“产生内容”“持久候选”“通过评测”和“进入 active”之间缺少统一的权威边界。模块 112 将 Skill 变化视为软件发布，而不是普通文件写入：所有自动 writer 先进入 candidate，独立角色生成验证证据，最后由受信 promotion/release 事务决定 active 指针。

核心决策是 fail closed：任何依赖、证据、租户身份、文件身份、状态 revision 或 durable adapter 不完整时，不产生 active mutation，也不返回幻影成功。

## 2. 目标与非目标

### 2.1 目标

- 冻结未登记的 active Skill writer，并建立 candidate-only/diff-only 边界。
- 提供 tenant-scoped immutable candidate/release registry。
- 将执行清单、依赖锁、runtime、权限与目标矩阵规范化并绑定摘要。
- 让 proposer 与 target/grader/safety/verifier 权力分离。
- 提供可验签、可撤销、可回读的 Eval/Artifact/Ledger receipt。
- 使用 lease、CAS、journal 和 recovery 支持原子 promotion、LKG 与 rollback。
- 为 CLI、Desktop、Graph、Evolution Workbench、IDE 受治理投影与有界请求提供共同基础。
- 让跨设备/团队/组织知识在加密传输、RBAC 审批、人工冲突合并、撤销依赖处置和发布恢复中保持同一证据身份。

### 2.2 非目标

- 不把公式化 accuracy 增长或模型自评包装成真实训练/Skill 改善。
- 不在 `0.166.30` 默认启用无人值守 active mutation。
- 不把单机内存 Map、普通目录写入或本地测试结果当作生产 durable authority。
- 不用平均分替代缺失的目标平台 cell，也不用 LLM judge 替代确定性测试。
- 不授予 Desktop、sync peer、candidate evaluator 或 marketplace active-layer 写权限。

## 3. 核心特性

| 能力        | 核心组件                                                        | 设计语义                                                              |
| ----------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Candidate   | `SkillCandidateRegistry`                                        | tenant-scoped、content-addressed、不可变                              |
| Manifest    | `SkillExecutionManifest`                                        | dependency/runtime/permission/matrix 规范绑定                         |
| Eval        | `EvolutionEvalGate`                                             | target/grader/safety/supervisor/verifier 分权                         |
| Matrix      | `SkillTargetMatrixEval`                                         | signed plan、reserve/finalize、all-cell conjunction                   |
| Projection  | `EvolutionEvidenceProjector`                                    | raw 与 model-visible 证据分层                                         |
| Ledger      | `EvolutionLedger`                                               | 签名 append-only、witness、receipt/verify                             |
| Authority   | `SkillMutationAuthority`                                        | operation 与 transition subject 精确绑定                              |
| Promotion   | `SkillPromotionController`                                      | lease、CAS、journal、commit-unknown recovery                          |
| Release     | `SkillReleaseRegistry`                                          | release/active/LKG/rollback 基础                                      |
| Ports       | artifact/ledger ports                                           | durable adapter 的严格写入/回读契约                                   |
| Run ingress | `AgentEvolutionIngress` / `EvolutionRunLedgerAdapter`           | CLI、Graph、legacy WebSocket 的 pre-model/pre-tool 持久证据           |
| Wiki        | `EvidenceBackedWikiMaintainer` / `WikiMaintainerLedgerAdapter`  | 证据驱动 revision、CAS、幂等恢复和认证触发                            |
| Review      | `SkillPromotionReview` / review ledger adapter                  | 持久 packet、非自动 quorum、content-risk acknowledgement              |
| Workbench   | `EvolutionWorkbenchCliHost` / version control / metrics         | digest-bound 检索、比较、逐项审阅、回滚与冷热指标留存                 |
| Retrieval   | outcome index / vector authority / canonical router             | 只消费已验证 invocation outcome 与独立向量证据，歧义时 abstain        |
| Knowledge   | governed sync / conflict reader / merge executor / trust ledger | ciphertext-only 同步、人工合并、RBAC/密钥生命周期、撤销依赖与崩溃恢复 |
| Memory      | `StructuredMemory*` adapters                                    | episodic/semantic/procedural/policy 四层权力分离                      |
| Migration   | candidate/release/state migration adapters                      | 计划、journal、故障恢复和 legacy 文件退休                             |
| Composition | `createAgentEvolutionRuntimeComposition()`                      | 显式注入 KMS/PKI/policy/witness 的 branded 生产根                     |
| Deployment  | signed descriptor / owner-only profile / exact-byte loader      | 验签后持久选择部署宿主；环境变量可覆盖；自动晋升固定为 HOLD            |

## 4. 系统架构

```text
Sources
 trajectory | manual creator | sync import | improvement | agent/scheduler
      │
      ▼
Candidate-only adapters ── writer inventory / mutation freeze
      │
      ▼
Tenant Candidate Registry ── canonical manifest + artifact digest
      │
      ├──────────────► Independent Target Matrix Eval
      │                 target / grader / safety / verifier
      │
      └──────────────► Evidence Projection / Artifact Ports
                              │
                              ▼
          EvolutionRun / Wiki / Memory / Review artifacts
                              │
                              ▼
                    Tamper-evident Ledger
                              │
                              ▼
                 Mutation Authority Decision
                              │
                              ▼
              Promotion Controller (lease + CAS)
                              │
                              ▼
             Release Registry / Active / LKG / Rollback
```

领域对象通过 canonical digest 关联，调用者传入的自然语言、路径或内存对象身份不是 authority。

## 5. 领域模型与 schema

候选至少绑定 `tenantId`、`skillId`、`candidateDigest`、版本、source/derivation evidence、dependency lock、runtime manifest、permission profile 和 target matrix。Eval receipt 额外绑定 plan、cell、target/grader/safety identity、输入/输出摘要、deadline、撤销与 settlement。

mutation transition subject 对以下元组做规范绑定：

```text
tenant + operation + candidate/rollback target + dependency lock
+ runtime/matrix decision + expected active revision + policy/permission digest
```

任何一个字段变化都必须重新授权和评测，旧 receipt 不能重放。

## 6. 生命周期与状态机

```text
PROPOSED → CANDIDATE → EVALUATING → VALIDATED → PROMOTING → ACTIVE
                │           │                     │           │
                └→ REJECTED ├→ NEEDS_MORE_EVIDENCE├→ ABORTED  └→ ROLLED_BACK
                            └→ REVOKED
```

- Candidate 创建不修改 active。
- Matrix 只有全部必需 cell 完整且通过才可形成 validated decision。
- Promotion 读取 expected active revision 并获取 lease；CAS 失败返回冲突。
- commit 结果未知时进入 recovery，不自动重复副作用。
- Rollback 只接受绑定 release/LKG digest 的授权目标。

上述是既有领域状态的合并视图。`0.166.24` 已实现外层 release-train、持久阶段输出及跨进程恢复；以下是跨域生命周期视图，不能据此推断目标部署已启用每个阶段：

```text
NEEDS_EVIDENCE → CANDIDATE → PRECHECK → EVALUATING → VALIDATED
→ REVIEW_PENDING → SHADOW → CANARY[n] → ACTIVE_PROBATION → STABLE

REJECTED | QUARANTINED | ROLLED_BACK | RECONCILIATION_REQUIRED
```

`RECONCILIATION_REQUIRED` 表示存在已 prepare/commit 但尚未完成持久 settlement 的可恢复事务，不能投影为成功。`ACTIVE_PROBATION` 期间继续保留上一稳定 LKG；只有预注册 soak window 与全部安全/质量/成本门通过后才进入 `STABLE`，并成为后续演化 baseline。Canary 百分比不固定为 `1%`：低流量租户按固定 N 个显式 opt-in subject，高流量租户按 risk-tier policy 使用有统计功效的预注册阶梯。

## 7. Candidate 与租户隔离

registry root 必须位于 tenant namespace，tenant marker 与调用 authority 一致。父目录可以经过已存在的宿主别名规范化，但新建叶节点必须是非 link 的真实目录/文件并绑定文件系统身份。候选内容使用 exclusive create，避免覆盖已有 digest/version。

legacy migration 必须显式执行；不能把旧 active 树直接声明成 candidate root，也不能以相同相对路径跨 tenant 共享 release。

## 8. 独立 Eval 与目标矩阵

Eval Gate 把 target 执行、grader 判定、安全检查、监督终止和 receipt 验证分成最小角色。目标矩阵维度覆盖 model family/version、OS/arch、tool/API、permission profile 与 domain/data version。

matrix plan 必须签名并持久 reserve；每个 cell 返回完整 child receipt，finalize 对有序摘要根、时间线和 attestation 做合取。缺 cell、重复/越权 cell、角色密钥复用、超时、撤销、后验不一致或 settlement 超限均拒绝。

## 9. 证据、账本与持久端口

Raw evidence 与 model-visible projection 分离。Artifact Port 校验 schema、签名、TTL、retention、authority 和 canonical bytes，并要求 adapter 写入后回读与 receipt 相同。Ledger 使用签名 append-only hash chain 和独立 witness；状态转换事件绑定精确 subject，缺失或不一致时失败关闭。

仓库已提供真实文件 Ledger、durable witness、ArtifactPorts、索引/快照、旧 candidate/release/state migration 与重启恢复组合，并由 branded resolver 限制读取边界；它们仍不等于目标环境已经部署跨主机 PKI/KMS/WORM authority。真实部署必须提供独立 trust root、密钥轮换/撤销、ACL、备份恢复、容量门和跨故障域 witness。

## 10. Writer 接线

- `SkillSynthesizer` 需要 LLM、candidate registry、candidate evaluator 与 active roots；候选评测、持久化和 trajectory 标记按顺序执行。
- `SkillImprover` 只写隔离候选或返回 diff-only，审计失败会使操作失败。
- Desktop Skill Creator 的 create/optimize 返回内存 proposal、diff 和 evidence，不写 active。
- Desktop Skill Sync 验证包后调用 host-owned candidate store，并对创建 receipt 与 readback 做 digest/schema 绑定。
- CLI Agent 的 REPL、单轮 headless、stream headless 与 `AgentRuntime` 可通过 branded composition 注入持久 `EvolutionRun` ingress；UserPrompt、tool request/result 与真实终态在继续执行前确认。
- canonical Graph App Server 和 Desktop direct Coding Agent 的 legacy WebSocket 路径提供宿主 factory 接线缝，拒绝客户端替换 ingress。
- Agent completion 与真实 `SchedulerStore` occurrence 可经独立 authority 形成 Wiki maintenance trigger；trigger、revision 与 settlement 通过 Ledger 队列幂等恢复。
- Candidate/Eval/HumanTask 三事件链通过 registry transition adapter 驱动 evaluated + human-reviewed control plane，commit/settlement 响应丢失可恢复。
- `EvolutionWorkbenchCliHost` 只接收 branded source/projection/transition/metrics authority；CLI、Desktop、VS Code 与 JetBrains 只能提交绑定 packet digest 的审阅或回滚请求，不能替换 identity、receipt 或 active writer。
- `cc skill search`、Agent runtime 与 Desktop/IDE Skill Retrieval 共用 canonical router。BM25、可选向量和 verified outcome 的 source、query、模型、索引及结果摘要必须一致；向量 provider/verifier 在独立、无 shell、无继承环境的 worker 中运行。
- 受治理知识同步先持久 local/remote/conflict，再传输 ciphertext-only envelope。并发写进入人工冲突队列；合并绑定当前 baseline/vector clock、人工 receipt 与发布 plan，按 Ledger prepare → 幂等 publish → settlement 恢复响应丢失或进程崩溃。
- reviewer 注册/撤销与 approval receipt 由持久 trust ledger 见证；密钥轮换必须先撤销旧 key，撤销依赖按 rollback/quarantine/reject/tombstone 分项结算且不得重复副作用。
- 旧 Phase 100 simulator 与未注册 IPC 已退役；公式化训练路径只保留 metrics，不再宣称真实训练或 active mutation。
- writer inventory 维护潜在 mutation 点；未知 active writer 应阻断 capability/publish gate。

## 11. 接口与错误语义

基础库返回结构化状态/错误码，调用面必须同时检查异常、状态、receipt 和最终 readback。典型错误包括 unavailable、authority denied、signature invalid、artifact expired、integrity failed、revision conflict、matrix `needs-more-evidence` 与 persistence failed。

API 不允许“日志写失败但 mutation 成功”或“候选未落盘但报告 created”。未知字段、Proxy/getter、非 plain object、超界 payload、路径逃逸和不稳定文件身份均按输入无效处理。

## 12. 配置与部署边界

可信宿主至少要配置：tenant root/marker authority、candidate/release durable adapter、ledger/PKI authority、target/grader/safety callable descriptor、全 run deadline、资源上限、permission/policy digest、active/LKG store 和 kill switch。

`0.166.43` 将部署选择冻结为两个版本化 schema：`chainlesschain.evolution-deployment-descriptor/v1` 描述签名模块，`chainlesschain.evolution-deployment-profile/v1` 只保存启用状态与 descriptor/trust-root 的绝对路径。`configure` 必须先验证严格字段集、单调 revision、命令白名单、Ed25519 签名、trust-root 摘要、模块摘要和 4 MiB 模块上限，随后以 owner-only 临时文件和原子 rename 写入 profile。loader 执行的是已验摘要的精确模块字节，而不是再次按路径 import，避免验签后路径替换窗口。

环境变量仅选择已认证部署，不赋予调用者 authority；当环境变量与 profile 同时存在时环境变量优先，且 descriptor/trust-root 必须成对提供。损坏或过期的持久 profile 不会启动治理能力，但仍允许 `status`、`configure` 和 `disable` 进入恢复路径。Workbench 与 Knowledge 命令虽已公开注册，缺少可信 host 时仍明确 unavailable，不能回退到测试密钥、内存 authority 或未认证目录。`cc ui` 的配置 topic 只接受 loopback 或 token 保护的控制面，并限制为有界单行路径与布尔开关。

## 13. 性能与容量

Artifact Port 对 canonical artifact、envelope、index entries 和 index bytes 设硬上限；Eval Gate 对 deadline、并发、输出、终止和 settlement 设界。Ledger 已增加私有 O(1) event 索引、有界 `queryMany()`、witness-bound snapshot 与 single-current retention；生产接线仍需按真实账本规模、authority 延迟和故障域执行容量与长时故障注入。

性能资格必须绑定 exact fixture/plan/ledger 与目标机器。Team 10,000-task/64-worker 门证明调度优化，不等同于 evolution promotion SLA。

## 14. 测试策略

测试分为 canonical/schema、candidate/release/promotion、authority、artifact/ledger、Eval Gate、target matrix、writer freeze、三端 ingress、Wiki/Memory、migration/recovery、registry transition、Workbench、Retrieval、governed knowledge 与路径攻击。负向用例覆盖：篡改、缺证、陈旧 revision、跨 tenant、链接/父逃逸、角色混用、receipt 重放、commit unknown、超时/撤销、缺 cell、无效 adapter 回读、进程退出重开、journal 四阶段故障、伪造向量/outcome、陈旧知识 baseline、双裁决和 marketplace candidate fetch。

发布只能引用 exact release SHA 的 Linux/Windows/macOS 工作流；本地或旧 SHA 结果不得代替当前门禁。

## 15. 安全与威胁模型

主要威胁是候选逃逸到 active、跨租户制品混用、有效 receipt 被换用于另一 transition、评测者与提议者串权、软超时后进程继续运行、adapter 幻影持久化、日志重写，以及同步/marketplace 内容绕过候选门。

控制措施包括真实路径/文件身份绑定、strict schema、域隔离摘要、签名与 witness、角色密钥分离、deadline/termination、lease/CAS、readback verification、journal/recovery 和 fail-closed capability projection。

## 16. 可观测性与审计

生产事件应至少公开非敏感的 run/candidate/release/operation/tenant 摘要、状态、cell 计数、deadline、decision、revision 和 error code。原始 trajectory、秘密、PII、grader chain-of-thought 与凭据不得进入普通日志。所有 active mutation 必须可从 release digest 反查 candidate、Eval、approval 与 ledger receipt。

## 17. 限制与后续计划

仓库内已经关闭 canonical `EvolutionRun`、Raw/Wiki/Skill 投影、Wiki Maintainer、单 Skill proposer、四层 Memory、`SkillInvocationReceipt`、有界评分改进循环、持久 human-review authority、旧状态迁移和 registry transition 的主要组合缺口。`0.166.21` 又补齐 Workbench 多端审阅、证据排序 Skill Retrieval，以及 governed knowledge 的持久冲突、认证合并、加密/RBAC、trust ledger、撤销依赖和持久发布恢复。目标矩阵采用全 cell 合取与 Bonferroni family-wise confidence 校正。

仓库已有进程 Eval supervisor、隔离 target、签名子回执、progressive canary traffic worker、外部 watchdog 和持久 Workbench 工厂。仍未关闭的是目标环境真实 grader/runner/kill 权限、生产 KMS/HSM/PKI/身份/policy/witness/scheduler/transition authority 接线、默认 launcher 及实际 IDE 验收、Pilot 运营、两机离线与物理删除传播 E2E、跨主机灾备和生产规模演练。现有 Workbench/Knowledge UI 是受信 host 的有界审阅面，不等于生产 authority 已部署。关闭这些条件前，production auto-promotion 必须保持 HOLD。

## 18. 生产闭环设计与实现进展

### 18.1 Evolution Release Train

增加薄的 `EvolutionReleaseTrain` 编排层，复用而不是替换现有 Maintainer、Proposer、Candidate Registry、Eval、Review、Pilot、Promotion 和 Wiki adapter。每次 run 先持久化签名 `EvolutionPlan`，至少绑定：

```text
tenant + artifact type/id + baseline release + candidate + Wiki revision
+ eval suite/target matrix + risk tier + rollout/metric policy
+ permission/policy digest + root budget + expiry
```

trigger 只能消费认证 `EvolutionRun`/InvocationReceipt：重复 procedure failure、跨来源成功模式或明确用户纠正达到预注册 evidence 门后才可生成候选。provider/MCP transient、sandbox unavailable、permission/policy denial 和数据缺失默认不归因于 Skill。编排器只持有推进状态机的 capability，不获得 grader、human reviewer、active writer 或 KMS 密钥；每一步的完整 receipt 必须由下一步重新解析和认证。

### 18.2 Eval 与可复现 Benchmark

生产 Eval adapter 必须提供 attested descriptor-to-callable loader、固定依赖环境、版本化 regression corpus、hidden holdout、独立 grader/safety/verifier 和 OS 进程或容器级 hard kill。Linux/Windows/macOS cell 绑定真实 model/tool/API/permission/domain fingerprint，缺 cell 或运行环境漂移进入 `needs-more-evidence`，不能用其他 cell 平均分补齐。

外部论文数字与 ChainlessChain 自测使用不同 provenance namespace。正式 benchmark artifact 必须固定 model checkpoint/digest、推理参数和 seed、容器/vLLM/硬件、数据集版本和逐题 split ID、工具/API、prompt、Skill/Wiki、runner 与 Git SHA；保存逐题 trace/result、grader receipt、失败分类、成本和时延。no-skill/skill 至少执行 3 个独立 run，报告均值、95% CI，并在比较优势时使用预注册 paired bootstrap/multiple-comparison policy。官网和 README 只从已签名、不可变、可从零复跑的报告生成数字；否则标记 `external-paper-only / HOLD`。

### 18.3 统计化 Canary 与稳定化

生产 traffic authority 使用服务端稳定 hash 与签名 assignment receipt，客户端不能选择 cohort。Shadow/Canary observation 必须绑定同期 baseline/candidate、subject、model segment、Skill digest、permission/runtime fingerprint 和 outcome grader；质量门使用 paired delta 置信下界或预注册序贯检验，成本、tool-call 数和 p95/p99 latency 使用非劣门。任何 security/permission event 都是硬停止；独立 watchdog 必须能在主宿主失联时触发 kill switch 和 LKG rollback。

promotion 只产生新的 release/outcome evidence，不直接把 Wiki pattern 标成 truth。Maintainer 根据多 trust-domain evidence、样本量和观察窗口决定 `hypothesis → corroborated/actionable`；reject/rollback/revoke 必须沿依赖图使 Wiki、Memory、retrieval index 与 marketplace badge 进入 contradicted/stale/quarantine/revalidation。release、Wiki 和 settlement 任一位置 crash 后，应由新进程按同一 operation digest 幂等收敛。

### 18.4 类型化 EvolvableArtifact

Skill、Prompt、Hook 与 Knowledge 可共享最小制品 envelope：tenant/type/content digest、parent、lineage、dependency lock、runtime/permission manifest、candidate/release、Eval/review/promotion receipt 与 active/LKG；但 admission、evaluator、activation、rollback 和 quorum 按类型注册，不能用统一抽象降低权限门。Hook/脚本属于高风险 executable，额外强制签名、SBOM、沙箱、网络出口策略和双人审批；Knowledge merge 不获得 Skill active writer；Prompt 的输入样本与输出 projection 必须服从脱敏、retention 和 anti-leak policy。

### 18.5 增量交付顺序与门禁

| 顺序 | 执行包                                        | 关闭条件                                                                                                                                           |
| ---- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `EVO-OPT-1` benchmark truth gate              | 外部结果与本项目结果分栏；实验制品可从零复跑，正式文案不能手抄数字                                                                                 |
| 2    | `EVO-OPT-2/3` Release Train + production Eval | 同一 EvolutionPlan 串联全链；跨平台真实 runner、hard kill、PKI 和 regression corpus 通过负测                                                       |
| 3    | `EVO-OPT-4` mandatory Pilot                   | 无 authenticated/durable/statistically-qualified Pilot receipt 不得 active；稳定分桶、渐进 Canary、probation/stable、watchdog 与 rollback 演练通过 |
| 4    | `EVO-OPT-5` Wiki reconciliation               | Active/Stable/reject/rollback/revoke 全部进入证据链，三处强杀后新进程幂等收敛且依赖失效传播正确                                                    |
| 5    | `EVO-OPT-7` deployment composition            | 公共 npm 入口装载真实 branded host；KMS/HSM、PKI/身份/policy、独立 witness、scheduler、traffic、metrics 和灾备通过目标环境验收                     |
| 6    | `EVO-OPT-6` multi-artifact governance         | Prompt/Hook/Knowledge 合同测试证明不能绕过 candidate gate，类型专属安全门和依赖重评测有效                                                          |

统一硬门包括：`100%` active/stable lineage 可回溯、未授权 active writer 与 security/permission violation 为 `0`、paired quality 置信下界通过、成本和 p95/p99 非劣、reconciliation backlog/age 有上限、rollback MTTR 达标，以及 Wiki contradiction/stale/删除传播可观测。详细任务和状态以 [Agent 自进化差距与优化建议](https://github.com/chainlesschain/chainlesschain/blob/main/docs/AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md) §13 为准。在目标部署验收完成前，production auto-promotion 继续 HOLD。

## 18.6 2026-09-06 实现核对：持久治理运行时

本节依据 `0b497ce521..eb7cc93dce` Git 增量核对。CLI 发布为 `0.166.24@9cf9c7bfd7`；VS Code `0.37.84@eb7cc93dce` 与 JetBrains `0.4.111@9a06eb722b` 是独立制品。Desktop 下述入口仅描述当前源码。

| 域               | 已实现行为                                                                                                  | 部署边界                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Release Train    | proposal/candidate 分阶段持久输出、真实域控制器、checkpoint 与跨进程重放；结果可影响下一轮 proposal         | 真实 authority、业务输入和评测环境仍需部署                    |
| Eval / Benchmark | 进程 supervisor、隔离 target、持久子回执，配对 WikiSkill 执行、签名 bundle 与 CLI report                    | 代码和测试不产生生产模型分数                                  |
| Canary           | 统计门、流量 worker、独立 watchdog、跨进程 reservation 与恢复                                               | operator 提供实际 cohort、密钥、deadline 和回滚运营           |
| Typed artifacts  | Skill/Prompt/Hook/Knowledge 依赖重验、持久 transition 与 active 内容恢复；Desktop 只加载受治理 release 字节 | Hook/Skill 隔离与高风险审批仍须完整                           |
| Workbench        | 认证当前 Registry、人工 review/rollback 效果持久化、双实例回读、异步启动工厂                                | 不创建默认 reviewer 或成功回执                                |
| Knowledge / Wiki | 准入 fence、候选 quarantine/reject、真实 Skill 回滚、多级跨 Wiki provenance 与定点 tombstone 联合结算       | 不等于物理删除或两机离线传播验收                              |
| Marketplace      | 实际候选包安装、目标适配与清单校验、状态恢复、只读 Eval 徽章发布；Desktop 同一治理宿主                      | 外部 catalog、PKI、Eval/Pilot/Release 与公网 TLS 仍由部署提供 |

### 持久 Workbench 装配顺序

1. 签名 loader 固定单文件模块字节与 command allowlist；`openEvolutionWorkbenchFileResources` 打开 Artifact、Ledger/witness、ReleaseRegistry，并独立重开校验实例。
2. `createEvolutionWorkbenchControlPorts` 用同账本 audit/nonce ports 组装 mutation authority 和 rollback controller。它仅消费实际 preparation 对应的一次性进程内上下文，克隆 JSON、跨实例或重复请求不能借权。
3. 等待 `createEvolutionWorkbenchRuntime`：验证 Review/rollback 适配器 → 补记已发生审核效果 → 补记已发生回滚效果 → 认证当前完整 Registry → 返回 host。
4. `evolution` 返回 `{ workbenchHost }`；`serve --app-server` 返回 `{ evolutionWorkbenchHost: workbenchHost }`。工厂失败时不通过兼容回退隐藏为 unknown command。

启动 `reconcileCommitted()` 不等于显式 `resume()`：只有已经落账的决策/Registry mutation 可以补 settlement，尚无效果的 preparation 保持 deferred。过期计划不重新取得当前有效性；当前撤销或伪造证据仍拒绝启动。跨两个域的补账不是全或无事务，前域成功后域失败时保留已有 settlement，并阻止宿主开放。

### 撤销和多级 Wiki 来源

Knowledge revocation 绑定已 prepare 的 dependency action、tenant、来源摘要及历史 Wiki checkpoint。跨 Wiki 追踪认证每跳 provenance，而不把当前 head 当成历史证明；对派生 Skill 的回滚、候选 quarantine/reject 与目标 Wiki tombstone 分项执行、独立回读后结算。候选隔离具有独立 disposition 与 receipt，不能等价替换为 reject。准入和真实 Wiki commit 处都检查来源撤销，阻止后续写入或晋升复活旧知识。

Wiki pruning 的计划、授权 checkpoint、维护结果、检索投影和 wiki-only dependency effects 持久恢复。模型入口对正常/辅助模型、fallback chain 与结构化 JSON 使用受验证的持久投影；长文本分段有界且敏感字段脱敏。原始证据删除 tombstone 不证明备份或设备介质已物理擦除。

### 验证与来源

仓库回归覆盖真实文件账本、进程退出/SIGKILL 窗口、双实例恢复、超期人工 preparation、来源撤销、候选包损坏和徽章 HTTP 只读边界。测试中的签名身份、grader 和文件系统适配器明确属于 TEST fixture，不是生产 PKI、实际用户 IDE 或断电演练。

- [Workbench 启动合同](https://github.com/chainlesschain/chainlesschain/blob/main/docs/EVOLUTION_WORKBENCH_STARTUP.md)
- [审核持久化合同](https://github.com/chainlesschain/chainlesschain/blob/main/docs/EVOLUTION_WORKBENCH_REVIEW_RUNTIME.md)
- [回滚持久化合同](https://github.com/chainlesschain/chainlesschain/blob/main/docs/EVOLUTION_WORKBENCH_ROLLBACK_RUNTIME.md)
- [市场候选与徽章合同](https://github.com/chainlesschain/chainlesschain/blob/main/docs/GOVERNED_SKILL_MARKETPLACE_CLI.md)

## 18.7 2026-09-07 源码核对：Desktop 模型入口与 witness 性能

本节只描述 `main@5db62db246`，晚于公共 CLI `0.166.30@87ddf8b126`。Desktop 的 OpenAI、Anthropic、Gemini、Ollama、函数工具循环、response cache 与多模态模型请求现通过 branded host 进入同一个 `EvolutionRun`；用户输入、tool request/result、provider 终态与缓存回放必须保持 tenant、request 和 receipt 绑定。嵌套摘要复用父 Run，不能创建脱离父 lineage 的第二条记录。

已识别的图像/语音/视频、embedding、reranker、项目、文档、planner 和 legacy RAG opaque backend 在没有受治理 bridge 时于网络发送前失败闭合。`CC_AGENT_EVOLUTION_INGRESS_FAILED` 必须越过 cache、关键词降级与 provider fallback 返回调用方，不能被改写为普通服务不可用。Volcengine health check 只检查配置完整性，不再用真实模型调用充当探测。

`EvolutionFileWitness` 新增可选的认证 trust epoch。只有 verifier 在同一次读取前后给出稳定 epoch 才复用逐记录验签；撤销导致 epoch 改变后必须重新验证完整 history，未实现端口或 epoch 异常时保留逐签名校验。1,000-event 演练把验签约从 2,017,022 次降到 1,002 次，但 seed 仍约 1,021 秒，说明完整 history JSON 的 parse/serialize/fsync O(n²) 成本尚未关闭。

详细入口、协议适配、旧路径处置矩阵与生产缺口见[模块 113：Desktop 受治理模型入口](./113-governed-desktop-model-ingress-design.md)。

## 18.8 2026-09-10 发布核对：签名部署配置与多端控制面

`0.166.43@7528bfb81d` 把原先依赖进程环境变量的部署选择补成可审计、可暂停、可恢复的持久配置。CLI 暴露 `cc evolution deployment status/configure/enable/disable`；VS Code `0.37.93`、JetBrains `0.4.120` 与 `cc ui` 只调用同一 CLI-owned 配置接口，不自行验签、不保存治理私钥，也不获得 review、promotion 或 release authority。

```text
CLI / IDE / cc ui
        │ bounded configure/status/toggle
        ▼
deployment-profile/v1 (owner-only, atomic replace)
        │ environment override has precedence
        ▼
descriptor/v1 + Ed25519 trust root
        │ strict schema + signature + trust/module digest
        ▼
authenticated single-file ESM bytes
        │ command allowlist + digest-bound built-in factories
        ▼
deployment-owned branded dependencies
        │
        └── automatic active promotion = HOLD
```

状态投影固定公开 `source`、`effectiveEnabled`、`profileEnabled`、`verified`、路径、revision、module digest、命令白名单、错误与 `autoPromotion: "hold"`。`disable` 只停用持久 profile；显式环境覆盖仍优先，因此运维系统需要先移除环境覆盖才能用本机开关停机。`enable` 不跳过重新验签，配置文件或其引用制品失效后能力继续失败闭合。

发布证据绑定同一 SHA：CLI CI `34476406749`、CLI Strict Sandbox `34476405180`、IDE Extensions `34476405124` 和 npm Trusted Publishing/公共回读 `34479754264` 均成功；npm `0.166.43`、Open VSX `0.37.93` 与 JetBrains Marketplace `0.4.120` 已公开。后续普通 push matrix 曾因 Windows 依赖安装失败产生一次红灯，不改写上述精确 release gate 的成功事实；相关锁竞争测试已继续加固，部署文案不把单次环境故障描述为功能退化。

## 18.9 2026-09-11 源码核对：账本可靠性与 v2 manifest checkpoint

`df93a5aa17` 将账本的容量整改从“只可离线验证的 manifest 链”继续推进到可恢复的 v2 checkpoint 组合，但没有把 v2 静默切换成现有 v1 生产后端。`EvolutionLedger.appendBatch()` 与 `appendDomainEventBatch()` 最多接受 1,024 条事件：先对整批输入执行 schema、重复 ID、artifact、Wiki admission 与签名规划，再开始落盘，避免后续条目校验失败时留下“看似成功”的前缀。每条记录仍经历 segment、anchor、directory durability、witness、HEAD 与重新加载验证；返回的 batch receipt 明确记录 sequence 范围、每条 receipt、最终 head 和 witness digest。

热路径现在可以复用已认证的前缀索引，但不会盲目信任缓存：目录、文件身份、内容摘要和同长度原地篡改均会在读取前重新核验，发现变化即按 `CC_EVOLUTION_LEDGER_CORRUPT` 失败闭合。这个改动改善重复读取与追加的成本边界，不构成 10,000 或 250,000 event 容量门已通过的声明。

v2 manifest backend 新增 `createEvolutionLedgerFileManifestHeadBackend()`。它把 `manifest-head.json` 置于 owner-only 目录，以跨进程文件锁执行 compare-and-set，并在临时文件 fsync、rename、目录 fsync 后重新读取；符号链接、硬链接、超限、文件身份漂移、无效 UTF-8/JSON 与 readback 不一致都会拒绝。backend 继续要求 manifest catalog、head 与 witness checkpoint 三者相互绑定，出现部分提交或 CAS 冲突时要求 reopen/recovery，不能把未知提交当作成功。

该实现仍是本地文件后端与测试组合的一部分：生产 KMS/HSM、独立 witness fault domain、真实事件导入、v1→v2 journaled migration、断电/磁盘写满演练和容量门仍需由部署及后续验收完成。

## 19. 关键文件

- `packages/cli/src/lib/evolution/skill-candidate-registry.js`
- `packages/cli/src/lib/evolution/skill-execution-manifest.js`
- `packages/cli/src/lib/evolution/evolution-eval-gate.js`
- `packages/cli/src/lib/evolution/skill-target-matrix-eval.js`
- `packages/cli/src/lib/evolution/evolution-evidence-projector.js`
- `packages/cli/src/lib/evolution/evolution-ledger.js`
- `packages/cli/src/lib/evolution/evolution-ledger-file-manifest-head-store.js`
- `packages/cli/src/lib/evolution/evolution-ledger-v2-manifest-backend.js`
- `packages/cli/src/lib/evolution/evolution-run-ledger-adapter.js`
- `packages/cli/src/lib/evolution/agent-evolution-ingress.js`
- `packages/cli/src/lib/evolution/agent-evolution-runtime-composition.js`
- `packages/cli/src/lib/evolution/evolution-deployment-config.js`
- `packages/cli/src/lib/evolution/evolution-deployment-profile.js`
- `packages/cli/src/lib/evolution/evolution-deployment-loader.js`
- `packages/cli/src/commands/evolution-deployment.js`
- `packages/cli/src/gateways/ws/evolution-deployment-topic-handlers.js`
- `packages/cli/src/lib/evolution/evidence-backed-wiki-maintainer.js`
- `packages/cli/src/lib/evolution/wiki-maintainer-ledger-adapter.js`
- `packages/cli/src/lib/evolution/structured-memory-agent-control-plane.js`
- `packages/cli/src/lib/evolution/skill-promotion-review-ledger-adapter.js`
- `packages/cli/src/lib/evolution/skill-registry-transition-ledger-adapter.js`
- `packages/cli/src/lib/evolution/evolution-workbench-cli-host.js`
- `packages/cli/src/lib/evolution/evolution-workbench-version-control.js`
- `packages/cli/src/lib/evolution/evolution-workbench-metrics-ledger-adapter.js`
- `packages/cli/src/lib/evolution/governed-knowledge-sync-ledger-adapter.js`
- `packages/cli/src/lib/evolution/governed-knowledge-merge-ledger-executor.js`
- `packages/cli/src/lib/evolution/governed-knowledge-sync-merge-publisher.js`
- `packages/cli/src/lib/evolution/governed-knowledge-trust-ledger.js`
- `packages/cli/src/commands/skill.js`
- `packages/cli/src/lib/skill-retrieval-router.js`
- `packages/cli/src/lib/skill-outcome-authority.js`
- `packages/cli/src/lib/evolution/skill-outcome-index-authority.js`
- `packages/cli/src/lib/skill-vector-authority.js`
- `packages/cli/src/lib/skill-vector-process-authority.js`
- `packages/cli/src/lib/evolution/evolution-artifact-ports.js`
- `packages/cli/src/lib/evolution/evolution-ledger-ports.js`
- `packages/cli/src/lib/evolution/skill-mutation-authority.js`
- `packages/cli/src/lib/evolution/skill-promotion-controller.js`
- `packages/cli/src/lib/evolution/skill-release-registry.js`

## 20. 相关文档

- [Agent 自进化差距与实施状态](https://github.com/chainlesschain/chainlesschain/blob/main/docs/AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md)
- [模块 65：自进化 AI 系统](./65_自进化AI系统.md)
- [Desktop Cowork Skill 执行安全](./109_Desktop_Cowork_Skill_Execution_Security.md)
- [Agent Platform 发布与证据边界](./110-agent-platform-release-boundaries.md)
- [Record & Replay → Skill](./111-record-replay-skill-design.md)
- [Desktop 受治理模型入口](./113-governed-desktop-model-ingress-design.md)
