# 112 受治理的 Skill 自进化设计

> 状态：`0.166.20` 已公开 candidate/Eval/evidence/ledger/promotion/release、持久化 `EvolutionRun`、Wiki/Memory、旧状态迁移与 registry transition 组合；目标环境 authority、最终用户控制面和自动 active promotion 保持 HOLD
>
> 适用范围：`packages/cli/src/lib/evolution/`、CLI learning writers、Desktop Skill Creator/Sync/metrics 接线
>
> 用户文档：[受治理的 Skill 自进化](../../../docs-site/docs/chainlesschain/governed-skill-evolution.md)

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
- 为 CLI、Desktop、Graph 和未来 Evolution Workbench 提供共同基础。

### 2.2 非目标

- 不把公式化 accuracy 增长或模型自评包装成真实训练/Skill 改善。
- 不在 `0.166.20` 默认启用无人值守 active mutation。
- 不把单机内存 Map、普通目录写入或本地测试结果当作生产 durable authority。
- 不用平均分替代缺失的目标平台 cell，也不用 LLM judge 替代确定性测试。
- 不授予 Desktop、sync peer、candidate evaluator 或 marketplace active-layer 写权限。

## 3. 核心特性

| 能力 | 核心组件 | 设计语义 |
| --- | --- | --- |
| Candidate | `SkillCandidateRegistry` | tenant-scoped、content-addressed、不可变 |
| Manifest | `SkillExecutionManifest` | dependency/runtime/permission/matrix 规范绑定 |
| Eval | `EvolutionEvalGate` | target/grader/safety/supervisor/verifier 分权 |
| Matrix | `SkillTargetMatrixEval` | signed plan、reserve/finalize、all-cell conjunction |
| Projection | `EvolutionEvidenceProjector` | raw 与 model-visible 证据分层 |
| Ledger | `EvolutionLedger` | 签名 append-only、witness、receipt/verify |
| Authority | `SkillMutationAuthority` | operation 与 transition subject 精确绑定 |
| Promotion | `SkillPromotionController` | lease、CAS、journal、commit-unknown recovery |
| Release | `SkillReleaseRegistry` | release/active/LKG/rollback 基础 |
| Ports | artifact/ledger ports | durable adapter 的严格写入/回读契约 |
| Run ingress | `AgentEvolutionIngress` / `EvolutionRunLedgerAdapter` | CLI、Graph、legacy WebSocket 的 pre-model/pre-tool 持久证据 |
| Wiki | `EvidenceBackedWikiMaintainer` / `WikiMaintainerLedgerAdapter` | 证据驱动 revision、CAS、幂等恢复和认证触发 |
| Review | `SkillPromotionReview` / review ledger adapter | 持久 packet、非自动 quorum、content-risk acknowledgement |
| Memory | `StructuredMemory*` adapters | episodic/semantic/procedural/policy 四层权力分离 |
| Migration | candidate/release/state migration adapters | 计划、journal、故障恢复和 legacy 文件退休 |
| Composition | `createAgentEvolutionRuntimeComposition()` | 显式注入 KMS/PKI/policy/witness 的 branded 生产根 |

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
                │           │            │           │
                └→ REJECTED ├→ NEEDS_MORE├→ ABORTED  └→ ROLLED_BACK
                            └→ REVOKED
```

- Candidate 创建不修改 active。
- Matrix 只有全部必需 cell 完整且通过才可形成 validated decision。
- Promotion 读取 expected active revision 并获取 lease；CAS 失败返回冲突。
- commit 结果未知时进入 recovery，不自动重复副作用。
- Rollback 只接受绑定 release/LKG digest 的授权目标。

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
- 旧 Phase 100 simulator 与未注册 IPC 已退役；公式化训练路径只保留 metrics，不再宣称真实训练或 active mutation。
- writer inventory 维护潜在 mutation 点；未知 active writer 应阻断 capability/publish gate。

## 11. 接口与错误语义

基础库返回结构化状态/错误码，调用面必须同时检查异常、状态、receipt 和最终 readback。典型错误包括 unavailable、authority denied、signature invalid、artifact expired、integrity failed、revision conflict、matrix needs-more 与 persistence failed。

API 不允许“日志写失败但 mutation 成功”或“候选未落盘但报告 created”。未知字段、Proxy/getter、非 plain object、超界 payload、路径逃逸和不稳定文件身份均按输入无效处理。

## 12. 配置与部署边界

可信宿主至少要配置：tenant root/marker authority、candidate/release durable adapter、ledger/PKI authority、target/grader/safety callable descriptor、全 run deadline、资源上限、permission/policy digest、active/LKG store 和 kill switch。

这些配置尚未冻结为公共最终用户 schema。`0.166.20` 不允许用户通过环境变量或客户端 payload 拼装 production composition；宿主必须从进程内可信构造点注入 branded root。缺失配置时 capability 保持关闭或 unavailable，不能回退到测试密钥、内存 authority 或未认证目录。

## 13. 性能与容量

Artifact Port 对 canonical artifact、envelope、index entries 和 index bytes 设硬上限；Eval Gate 对 deadline、并发、输出、终止和 settlement 设界。Ledger 已增加私有 O(1) event 索引、有界 `queryMany()`、witness-bound snapshot 与 single-current retention；生产接线仍需按真实账本规模、authority 延迟和故障域执行容量与长时故障注入。

性能资格必须绑定 exact fixture/plan/ledger 与目标机器。Team 10,000-task/64-worker 门证明调度优化，不等同于 evolution promotion SLA。

## 14. 测试策略

测试分为 canonical/schema、candidate/release/promotion、authority、artifact/ledger、Eval Gate、target matrix、writer freeze、三端 ingress、Wiki/Memory、migration/recovery、registry transition 与路径攻击。负向用例覆盖：篡改、缺证、陈旧 revision、跨 tenant、链接/父逃逸、角色混用、receipt 重放、commit unknown、超时/撤销、缺 cell、无效 adapter 回读、进程退出重开、journal 四阶段故障和 marketplace candidate fetch。

发布只能引用 exact release SHA 的 Linux/Windows/macOS 工作流；本地或旧 SHA 结果不得代替当前门禁。

## 15. 安全与威胁模型

主要威胁是候选逃逸到 active、跨租户制品混用、有效 receipt 被换用于另一 transition、评测者与提议者串权、软超时后进程继续运行、adapter 幻影持久化、日志重写，以及同步/marketplace 内容绕过候选门。

控制措施包括真实路径/文件身份绑定、strict schema、域隔离摘要、签名与 witness、角色密钥分离、deadline/termination、lease/CAS、readback verification、journal/recovery 和 fail-closed capability projection。

## 16. 可观测性与审计

生产事件应至少公开非敏感的 run/candidate/release/operation/tenant 摘要、状态、cell 计数、deadline、decision、revision 和 error code。原始 trajectory、秘密、PII、grader chain-of-thought 与凭据不得进入普通日志。所有 active mutation 必须可从 release digest 反查 candidate、Eval、approval 与 ledger receipt。

## 17. 限制与后续计划

仓库内已经关闭 canonical `EvolutionRun`、Raw/Wiki/Skill 投影、Wiki Maintainer、单 Skill proposer、四层 Memory、`SkillInvocationReceipt`、有界评分改进循环、持久 human-review authority、旧状态迁移和 registry transition 的主要组合缺口。目标矩阵采用全 cell 合取与 Bonferroni family-wise confidence 校正。

仍未关闭的是目标环境真实跨平台 grader/runner 与进程级 kill、生产 KMS/PKI/身份/policy/witness/scheduler/transition authority、Desktop 默认 launcher 和其他最终入口注入、最终用户 review/promote/rollback/kill-switch/canary 可视面、跨主机灾备与生产规模演练。关闭这些条件前，production auto-promotion 必须保持 HOLD。

## 18. 关键文件

- `packages/cli/src/lib/evolution/skill-candidate-registry.js`
- `packages/cli/src/lib/evolution/skill-execution-manifest.js`
- `packages/cli/src/lib/evolution/evolution-eval-gate.js`
- `packages/cli/src/lib/evolution/skill-target-matrix-eval.js`
- `packages/cli/src/lib/evolution/evolution-evidence-projector.js`
- `packages/cli/src/lib/evolution/evolution-ledger.js`
- `packages/cli/src/lib/evolution/evolution-run-ledger-adapter.js`
- `packages/cli/src/lib/evolution/agent-evolution-ingress.js`
- `packages/cli/src/lib/evolution/agent-evolution-runtime-composition.js`
- `packages/cli/src/lib/evolution/evidence-backed-wiki-maintainer.js`
- `packages/cli/src/lib/evolution/wiki-maintainer-ledger-adapter.js`
- `packages/cli/src/lib/evolution/structured-memory-agent-control-plane.js`
- `packages/cli/src/lib/evolution/skill-promotion-review-ledger-adapter.js`
- `packages/cli/src/lib/evolution/skill-registry-transition-ledger-adapter.js`
- `packages/cli/src/lib/evolution/evolution-artifact-ports.js`
- `packages/cli/src/lib/evolution/evolution-ledger-ports.js`
- `packages/cli/src/lib/evolution/skill-mutation-authority.js`
- `packages/cli/src/lib/evolution/skill-promotion-controller.js`
- `packages/cli/src/lib/evolution/skill-release-registry.js`

## 19. 相关文档

- [Agent 自进化差距与实施状态](../../AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md)
- [模块 65：自进化 AI 系统](./65_自进化AI系统.md)
- [Desktop Cowork Skill 执行安全](./109_Desktop_Cowork_Skill_Execution_Security.md)
- [Agent Platform 发布与证据边界](./110-agent-platform-release-boundaries.md)
- [Record & Replay → Skill](./111-record-replay-skill-design.md)
