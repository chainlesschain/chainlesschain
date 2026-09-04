# 受治理的 Skill 自进化

> 适用版本：Agent Platform CLI `0.166.21`；更新：2026-09-04
>
> 适用对象：使用学习合成、Evolution Workbench、证据排序 Skill Retrieval、Desktop Skill Creator、Skill Sync 或加密知识同步的用户与管理员

## 概述

受治理的 Skill 自进化把学习结果先变成隔离候选，再通过评测、证据和发布事务决定是否可以进入 active。它解决旧路径中“生成成功”和“已经安装”容易混淆的问题：候选生成、内容改进、跨设备导入都不再直接覆盖正在运行的 Skill。

`0.166.21` 在既有 candidate、目标矩阵 Eval、证据投影、可检测篡改的 append-only 账本、mutation authority、promotion/release、持久 `EvolutionRun`、Wiki/Memory 和 registry transition 之上，公开了 Evolution Workbench、摘要绑定的 Skill Retrieval，以及受治理的加密知识冲突审核与合并入口。候选比较、人工批准/拒绝、回滚请求、冲突分页和合并计划现在都有 CLI/App Server 投影。

这些入口不把客户端变成 authority。Workbench 和知识审核需要部署方注入受信治理宿主；未接线时 CLI 明确失败闭合。批准只提交与确切 revision、digest 和 dependency lock 绑定的决定，发布仍由 mutation authority、CAS、账本和策略共同裁决。生产 KMS/PKI、identity、policy、witness、scheduler 与真实 grader 仍由目标部署提供，当前版本不宣称会无人值守地升级 active Skill。

## 核心特性

- 自动生成和改进只写隔离候选或返回 diff，active Skill 保持不变。
- 缺少 LLM、候选存储、评测器或 active roots 时明确返回 unavailable。
- 候选绑定 Skill/版本/内容摘要、依赖锁、运行时、权限和目标矩阵。
- target、grader、safety、supervisor 与 verifier 分权，缺少任一必要 receipt 即失败。
- 所有目标矩阵 cell 必须合取通过，不能用平均分掩盖缺失平台或负迁移。
- release、active、last-known-good 与 rollback 使用 lease、CAS、journal 和 recovery。
- append-only `EvolutionLedger` 提供签名链、witness、receipt 与 subject-bound 状态转换。
- candidate/release registry 绑定 tenant 与真实文件身份，拒绝链接逃逸和跨租户复用。
- CLI Agent 的交互、单轮 headless、stream headless 和 `AgentRuntime` 可在宿主启用后，于模型/工具继续执行前持久确认 `EvolutionRun` 事件。
- Wiki revision、Memory event/snapshot、human-review packet/decision 与 registry transition 复用 ArtifactPorts + Ledger，可在响应丢失或进程重启后按同一 digest 恢复。
- Agent 完成和 `SchedulerStore` 成功 occurrence 可由独立 authority 生成 Wiki 维护触发；客户端不能替换触发来源或 composition。
- 旧 Phase 100 simulator 与不可达 IPC 已退役；历史公式训练只保留 metrics，不再显示为真实训练或 active mutation。
- 当前仓库候选新增共享 `EvolvableArtifact` 协议；Desktop Prompt 新变体只写 inactive candidate，Renderer Hook 注册只写候选且不能直接 enable/reload。Hook candidate 必须绑定代码签名、SBOM、沙箱、网络出口策略和双人高风险审批；该能力尚未包含在上方所列公开版本中。
- Evolution Workbench 可列出候选、比较 revision、提交 approve/reject 决定和 rollback 请求；CLI、Desktop、VS Code 与 JetBrains 消费同一受治理投影。
- `cc skill search` 对 bundled、marketplace、managed 与 workspace Skill 做摘要绑定的混合检索，验证后的结果和 outcome evidence 优先。
- 加密知识同步只输出删节冲突投影；合并计划经过认证、签名，并绑定基线、vector clock 与依赖处置，在 crash/response-loss 恢复后才可发布 canonical record。
- review、merge、revocation 与 settlement 都以可回读信任账本绑定确切 subject，避免旧授权或旧回执被换用于新状态。

## 系统架构

```text
Trajectory / Skill Creator / Skill Sync
                 │
                 ▼
       candidate-only boundary
                 │
                 ▼
      Tenant Candidate Registry
          │               │
          ▼               ▼
 Target-matrix Eval   Evidence Projector
          │               │
          └───────┬───────┘
                  ▼
         EvolutionLedger
                  │
                  ▼
 Mutation Authority + Promotion CAS
                  │
          Release / Active / LKG
```

生成器没有 active 写权限，评测器没有发布写权限，同步 peer 也没有晋升权限。只有受信宿主组合完整证据与当前 active revision 后，才能调用 promotion/release 原语。

## 四阶段应该怎样理解

外部材料把演化概括为 Mutation、Selection、Promotion 和 Stabilization，这个方向可以借鉴，但在当前产品中必须按下面的治理语义理解：

| 阶段          | 可借鉴的做法                                                    | `0.166.21` 的真实边界                                                                                                                                      |
| ------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mutation      | 从重复失败、成功模式和用户纠正中提出一个聚焦改动                | 只能生成单 Skill candidate 或 diff；一次失败不会直接改 active，provider/MCP/sandbox/权限故障也不能被误记为 Skill 缺陷                                      |
| Selection     | 在隔离环境使用独立 grader、隐藏 holdout、安全门和目标运行时矩阵 | 仓库已有控制协议，但目标部署仍需提供真实跨平台 runner、attested loader、进程级 hard kill 和版本化回归集；不能理解为公共 CLI 已执行“全部历史测试”           |
| Promotion     | 先 Shadow，再以稳定 cohort 做 Canary，越界立即回滚              | 仓库已有受控 Pilot 协议，但公共版本尚未接入真实流量分配器。`1%` 不是固定规则；低流量使用固定 N 个显式 cohort，高流量才按风险和统计功效使用预注册百分比阶梯 |
| Stabilization | 把发布结果和回滚影响作为持久知识，供下一轮复用                  | 一次晋升只新增 evidence，不自动成为“真理”；需要独立结果、观察窗口和多来源佐证后，Wiki pattern 才能从 hypothesis 变为 corroborated/actionable               |

因此，“可控”在这里指变更制品可版本化、可审计、可失败关闭，不代表 LLM 行为、第三方工具或已经发生的外部副作用绝对可控。回滚可以恢复受管 Skill 的 active/LKG 指针，但不能自动撤销已发送的网络请求、已写入的外部数据库或 SaaS 操作。

## WikiSkill 论文数据怎么读

> **Provenance：`external-paper-only / HOLD`。** 以下数字不得生成 ChainlessChain 产品性能声明；只有通过仓库 benchmark truth gate 的可信签名报告才能切换为 `chainlesschain-measured / VERIFIED`。

以下数字来自 [WikiSkill 论文](https://arxiv.org/html/2608.27454) Table 1 的五个 benchmark 等权平均，是外部研究结果，不是 ChainlessChain 实测或性能承诺：

| 模型                 | No skill | WikiSkill | 相对自身提升 | 相对 Qwen-3.6-27B No skill `39.4%` |
| -------------------- | -------: | --------: | -----------: | ---------------------------------: |
| Qwen-3.5-4B-Instruct |  `26.2%` |   `38.5%` |    `+12.3pp` |                           `-0.9pp` |
| Qwen-3.5-9B-Instruct |  `29.9%` |   `47.4%` |    `+17.5pp` |                           `+8.0pp` |
| Qwen-3.6-27B         |  `39.4%` |   `63.3%` |    `+23.9pp` |                          `+23.9pp` |

流传摘要中的“Qwen-4B + WikiSkill `33.3%`、相对 27B 裸模型 `-6.1pp`”是抄录错误，正确值为 `38.5%` 和 `-0.9pp`。论文结果是三次完整演化运行的平均，并使用 paired bootstrap 做显著性检验；论文没有提供官方代码仓库、逐题原始结果和完整运行环境，因此只能用于说明研究趋势。ChainlessChain 在固定模型、数据集、seed、runner、prompt/Skill digest、逐题 receipt 和 exact Git SHA 完成独立复现前，不会把这些数字当作自身 benchmark。

## 快速开始

查看学习数据：

```bash
cc learning stats
cc learning trajectories --limit 20
cc learning reflect
```

尝试合成候选：

```bash
cc learning synthesize
cc learning synthesize --json
```

默认 CLI bootstrap 不伪造 candidate evaluator、生产 candidate store 或演化 authority。依赖未由可信宿主注入时，命令会以非零状态返回 `LEARNING_SYNTHESIS_UNAVAILABLE`；这表示自动写入被安全阻断，不表示 active Skill 损坏。

检查 Agent 能力和安装是否完整：

```bash
cc --version
cc agent --capabilities
```

`0.166.21` 的公共安装应能加载 `agent`、`evolution workbench`、`evolution knowledge` 与 `skill search` 命令；命令存在不代表当前宿主已启用 active promotion 或知识合并 authority。

## Evolution Workbench 与知识冲突审核

```bash
# 只读候选和差异
cc evolution workbench list --status pending --limit 20
cc evolution workbench compare <left-packet-digest> <right-packet-digest>

# 精确 revision 上提交治理决定；服务端 authority 最终裁决
cc evolution workbench review approve <review-packet-digest> --reason "评测与证据已复核"
cc evolution workbench review reject <review-packet-digest> --reason "证据不足"
cc evolution workbench rollback <from-packet-digest> <to-packet-digest> \
  --reason "canary 指标退化"

# 分页查看删节后的知识冲突，并提交摘要绑定的合并计划
cc evolution knowledge conflicts --cursor 0 --limit 20
cc evolution knowledge merge <conflict-envelope-digest> \
  --record '<canonical-record-json>' \
  --reason "已复核双方来源与撤销依赖"
```

以上变更命令必须连接 branded trusted deployment host。缺少宿主时会返回 `a trusted deployment host is required`，不会退回本地文件直写。冲突列表不返回原始明文、密钥材料或可复用 authority；Desktop/IDE 也只能提交投影中明确允许的动作。

## 证据排序的 Skill Retrieval

```bash
cc skill search "审阅 Spring Boot 安全配置"
cc skill search "知识冲突合并" --source managed --limit 8
cc skill search "browser automation" --source bundled --category automation --tag browser --json
```

`--source` 可取 `bundled`、`marketplace`、`managed` 或 `workspace`，`--limit` 为 `1..64`。候选始终绑定 canonical digest；只有部署方配置并通过验证的 outcome/vector/index authority 才会提供相应证据并参与排序，未配置时会明确报告 unavailable，而不是伪造见证。检索命中本身不会安装、激活或晋升 Skill。

## 使用示例

CI 中应同时检查进程退出码和 JSON `status`：

```powershell
cc learning synthesize --json
if ($LASTEXITCODE -ne 0) {
  Write-Error "候选合成不可用或失败；不要继续发布"
}
```

成功结果中的 `created` 只表示候选已经过 evaluator 并持久化到隔离候选区。它仍不是 active Skill。Desktop Skill Creator 返回 `candidateOnly: true`、`persisted: false`、`activeMutation: false` 时，只应展示为“待审阅候选”。

## 配置参考

当前公开 CLI 没有稳定的 candidate/promotion 配置文件。可信宿主构造合成器或改进器时必须提供以下边界；普通用户不应自行伪造：

| 依赖                                | 用途                                                     | 缺失结果                        |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------- |
| LLM callable                        | 从 trajectory 提取单 Skill 模式                          | unavailable                     |
| candidate output registry           | 隔离持久化不可变候选                                     | unavailable                     |
| candidate evaluator                 | 对内容和证据做独立判定                                   | unavailable                     |
| active Skill roots                  | 证明候选目录不与 active 树重叠                           | unavailable                     |
| tenant authority/marker             | 隔离候选与 release namespace                             | fail closed                     |
| durable ledger/release adapters     | 跨进程持久证据和 CAS 状态                                | promotion HOLD                  |
| KMS/PKI + witness                   | 加密、签名、撤销和独立账本见证                           | composition unavailable         |
| review identity/policy              | 认证人工决定、quorum 与风险确认                          | active mutation denied          |
| scheduler/transition authority      | 认证 trigger 与 registry 状态事件                        | maintenance/transition disabled |
| target runner/grader                | 执行真实平台 cell 和独立判定                             | matrix `needs-more-evidence`    |
| trusted Workbench host              | 校验 revision、review packet、rollback target 与可用动作 | Workbench unavailable           |
| knowledge KMS/PKI + merge authority | 解密、验签、撤销依赖结算与 canonical merge               | knowledge review unavailable    |

## 状态与结果

| 状态                 | 含义                           | 是否改变 active    |
| -------------------- | ------------------------------ | ------------------ |
| `completed`          | 返回项已评测并持久化为隔离候选 | 否                 |
| `candidate-proposed` | 返回内存候选、文件集合或 diff  | 否                 |
| `diff-only`          | 只提供内容差异                 | 否                 |
| `unavailable`        | 缺少必需的可信依赖             | 否                 |
| `error`              | 生成、评测、持久化或审计失败   | 否                 |
| `validated`          | 基础原语已确认候选证据完整     | 否，仍需 promotion |
| `active`             | 仅受信发布事务可以形成         | 是                 |

## 性能指标

目标矩阵评测按 cell 独立执行并受全 run deadline、settlement 上限和资源回收约束；安全性优先于吞吐。当前仓库测试验证 10,000 task / 64 worker 的 Team 调度门与大量治理单元场景，但这不是 Skill 自动晋级的生产 SLA。真实 P50/P95 必须绑定模型、grader、OS/arch、工具版本、样本数和 exact release SHA。

## 测试覆盖

- Candidate、release 与 promotion：租户隔离、摘要绑定、lease/CAS、journal/recovery、LKG/rollback。
- Eval Gate：角色分权、签名 receipt、deadline、撤销、后验校验、hard termination 边界。
- Target matrix：signed plan、reserve/finalize、完整 child receipt、有序摘要根与 all-cell conjunction。
- Ledger/artifact ports：append-only hash chain、witness、回读绑定、篡改和 schema 拒绝。
- Ingress：CLI REPL/headless/stream/`AgentRuntime`、canonical Graph 和 legacy WebSocket 的 pre-model/pre-tool 持久确认。
- Wiki/Memory/review：CAS、幂等恢复、四层 authority、PostCompact、人工 quorum 与 content-risk acknowledgement。
- Migration/transition：旧 candidate/release/state ledger journal、启动 reconciliation、故障阶段恢复和 durable registry request/attempt/settlement。
- Desktop：Skill Creator candidate-only、Skill Sync candidate store、Phase 16 metrics wiring 与 legacy simulator 退役。
- Typed artifacts：共享 Skill/Prompt/Hook/Knowledge schema、类型隔离 policy/authority、Prompt/Hook candidate gate、Hook 高风险硬门与依赖 stale 级联；stale 制品只能以新 dependency lock 和 revalidation receipt 生成候选，不能原地恢复；Skill Sync 成功结果已强制进入共享 Skill gate，旧 Skill-only store 只作为 tenant-bound 持久后端，knowledge 统一 adapter 尚待收口。
- Workbench/Retrieval：候选比较、陈旧 revision、批准/拒绝/回滚、canonical digest、索引 witness、来源过滤与 verified outcome 排序。
- Governed knowledge：密文冲突删节、认证 merge plan、Ed25519/AES-256-GCM、撤销依赖结算、响应丢失和进程重启恢复。
- 路径安全：canonical ancestor alias、leaf link、父目录逃逸与 marketplace fail-closed 路径。

本地测试通过不能替代发布提交自己的 Linux、Windows、macOS CI 与 Strict Sandbox 门禁。

## 安全考虑

- 不要把 candidate 目录加入 active Skill 搜索路径。
- 不要通过复制文件绕过 promotion；这样会丢失内容摘要、授权、评测、policy 和 active revision 绑定。
- candidate/release root 必须是受信目录，叶节点不能是符号链接或重解析跳转。
- 评测结果必须绑定同一 tenant、candidate、依赖锁、runtime manifest、target matrix 和 grader identity。
- Ledger 缺失、断链、witness 不一致或 transition subject 不匹配时必须拒绝发布。
- 同步导入内容默认是不受信 candidate；peer 身份不能变成 active-layer authority。

### 已安装 CLI 的部署宿主装载

公开 npm CLI 的 lazy/eager 入口支持由管理员装载目标部署宿主。部署必须同时设置绝对路径
`CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR` 与
`CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT`。描述符使用
`chainlesschain.evolution-deployment-descriptor/v1`，以 Ed25519 签名固定 revision、单文件 ESM
宿主路径及 SHA-256、trust-root SHA-256 和 `agent/evolution/serve` 命令白名单。宿主必须导出
`createChainlessChainCommandDependencies()` 并返回各命令需要的 branded authority；调用上下文按命令提供 Workbench、knowledge review 与 Agent composition 的窄内置 factory，使已验签模块无需重新导入可变包文件也能取得 CLI 自身的不可伪造品牌。CLI 直接执行已验签的模块字节，避免摘要校验后的路径替换窗口。

这只是安全装载入口，不会生成生产身份或密钥。描述符/信任根只配置一项、签名或摘要漂移、导出缺失，或目标 KMS/PKI/Ledger/witness/identity authority 不完整时，Workbench 继续显示 unavailable，且不会回退测试密钥、内存 store 或客户端自报权限。

## 故障排查

| 现象/错误                                     | 原因                                                  | 处理                                                            |
| --------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `LEARNING_SYNTHESIS_UNAVAILABLE`              | 缺 LLM、candidate registry、evaluator 或 active roots | 使用提供完整受信依赖的宿主；不要手工安装候选                    |
| `candidate-output-overlaps-active-skill-tree` | 候选目录与 active 根重叠                              | 改用独立、owner-private 的候选根                                |
| candidate persistence failed                  | 回读摘要、schema、文件身份或 tenant 绑定不一致        | 保留证据并检查 adapter/文件系统，不要重试晋升                   |
| matrix `needs-more-evidence` / rejected       | 缺 cell、receipt 或真实 grader 未通过                 | 补齐同一计划的目标证据后重新评测                                |
| revision/CAS conflict                         | active 已被另一事务更新                               | 重新读取当前 revision，重新评测并审批                           |
| ledger verify failed                          | 日志断链、签名/witness 或 subject 不一致              | 停止发布，使用可信备份和审计流程恢复                            |
| `unknown command 'agent'`                     | 安装了存在依赖导出缺口的 `0.166.18`                   | 从官方 npm registry 升级到 `0.166.21` 后重试                    |
| `a trusted deployment host is required`       | Workbench 或知识审核未接入受信部署宿主                | 保持失败闭合；由管理员接线 identity/policy/ledger/KMS authority |
| search result digest/witness mismatch         | Skill 索引记录与 canonical 内容或见证不一致           | 丢弃结果并重建/回填受信索引，不要安装该 Skill                   |
| capability 显示未接线                         | 宿主未注入 branded production composition             | 保持关闭；由管理员配置生产 authority，勿使用测试密钥绕过        |

## 关键文件

- `packages/cli/src/lib/evolution/skill-candidate-registry.js`
- `packages/cli/src/lib/evolution/evolution-eval-gate.js`
- `packages/cli/src/lib/evolution/skill-target-matrix-eval.js`
- `packages/cli/src/lib/evolution/evolution-evidence-projector.js`
- `packages/cli/src/lib/evolution/evolution-ledger.js`
- `packages/cli/src/lib/evolution/agent-evolution-runtime-composition.js`
- `packages/cli/src/lib/evolution/evolution-run-ledger-adapter.js`
- `packages/cli/src/lib/evolution/evidence-backed-wiki-maintainer.js`
- `packages/cli/src/lib/evolution/wiki-maintainer-ledger-adapter.js`
- `packages/cli/src/lib/evolution/structured-memory-agent-control-plane.js`
- `packages/cli/src/lib/evolution/skill-promotion-review-ledger-adapter.js`
- `packages/cli/src/lib/evolution/skill-registry-transition-ledger-adapter.js`
- `packages/cli/src/lib/evolution/skill-mutation-authority.js`
- `packages/cli/src/lib/evolution/skill-promotion-controller.js`
- `packages/cli/src/lib/evolution/skill-release-registry.js`
- `packages/cli/src/commands/evolution-workbench.js`
- `packages/cli/src/commands/evolution-knowledge.js`
- `packages/cli/src/commands/skill.js`
- `packages/cli/src/lib/evolution/evolution-workbench-projection.js`
- `packages/cli/src/lib/evolution/governed-knowledge-review-host.js`
- `packages/cli/src/lib/skill-retrieval-router.js`
- `packages/cli/src/lib/skill-outcome-authority.js`
- `packages/cli/src/lib/evolution/skill-outcome-index-authority.js`
- `packages/cli/src/lib/skill-vector-authority.js`
- `packages/cli/src/lib/skill-vector-process-authority.js`
- `packages/cli/src/lib/learning/skill-synthesizer.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-sync-manager.js`

## 最佳实践与限制

- 把 candidate 视为待审代码：查看 diff、来源、反例、权限和目标矩阵后再决定下一步。
- 使用确定性测试与独立 grader；模型自评不能替代退出码、产物哈希和真实 UI 状态。
- 任何 permission、policy、model、tool、grader 或 dependency lock 变化都应使旧 approval/Eval cache 失效。
- 当前 Workbench 提供统一的 review/rollback 请求入口，但它不是客户端自有 promotion authority，也没有承诺自动 active mutation 或 canary；仓库文件持久化与重启恢复不替代目标环境的生产 PKI/KMS、跨主机 witness 和灾备验收。

## 后续优化路线

当前优先补齐的是已有治理原语的生产纵切，而不是再增加一个平行“自进化”模块：

1. 建立可复现 benchmark 与文案 truth gate，严格分开外部论文结果和本项目实测。
2. 用同一个签名 EvolutionPlan 串起证据触发、Wiki、单 Skill candidate、真实 Eval、人工审阅、Pilot、发布和 Wiki impact。
3. 部署真实 Linux/Windows/macOS runner、独立 grader/safety/verifier、版本化 regression corpus 和进程级 hard kill。
4. 让 Pilot 成为 promotion 必经门，增加稳定分桶、同期 baseline、统计置信门、渐进 Canary、外部 watchdog 和 `ACTIVE_PROBATION → STABLE`。
5. 把 reject/rollback/revoke 结果反向传播到 Wiki、Memory、检索索引和 marketplace badge，避免旧知识继续参与决策。
6. 在不降低类型专属安全门的前提下，逐步把 Prompt、Hook 和 Knowledge 接入与 Skill 一致的不可变 candidate/evidence/review/release 协议。
7. 为公共 CLI 装载真实 branded deployment host，并完成 KMS/HSM、PKI/身份、独立 witness、流量 authority、灾备和 kill-switch 演练。

详细任务、状态与验收标准见仓库 `docs/AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md`。完成目标部署验收前，production auto-promotion 继续保持 HOLD。

## 相关文档

- [受治理的 Skill 自进化设计](/design/modules/112-governed-skill-evolution-design)
- [自进化 AI 系统](/chainlesschain/self-evolving-ai)
- [自进化 CLI 命令](/chainlesschain/cli-evolution)
- [Skill Creator](/chainlesschain/skill-creator)
- [Desktop Graph 调试与 Skill 安全](/chainlesschain/desktop-graph-skill-security)
- [Agent Platform 发布与证据边界](/chainlesschain/agent-platform-release)
