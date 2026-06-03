# 96. V2 规范层（Governance Layer）设计说明

> 本文档记录 CLI 侧 V2 规范层的统一设计模式与第 1-10 批 + iter11-iter28 累计 228+ 个治理表面的分类概览。
>
> **定位**：在遗留运行态（SQLite 表 / 文件态 / 内存单例 / 传输层）之上引入纯内存 governance 层，严格增量，与 legacy 路径零冲突，便于灰度与回滚。
>
> **最近更新**（2026-04-19）：iter22-iter28 在 iter16-iter21 的 64 lib 表面之上再叠加 72 lib 级治理表面（iter22-iter26 各 8 个 + iter27/iter28 各 16 个），覆盖 automation / cowork-share / did-v2 / knowledge-export-import / llm / pqc / social（iter22）、response-cache / tech / universal-runtime / note-versioning / permanent-memory / protocol-fusion / dbevo / decentral-infra（iter23）、recommendation / mcp-registry / plugin-ecosystem / skill-loader / token-tracker / autonomous-developer / threat-intel / ueba（iter24）、cowork-templates / cowork-marketplace / cli-anything-bridge / agent-router / sub-agent-registry / todo-manager / execution-backend / evomap-federation（iter25）、interactive-planner / cli-context-engineering / sub-agent-context / interaction-adapter / workflow-expr / plugin-autodiscovery / hashline / web-ui-server（iter26）、downloader / skill-mcp / cowork-mcp-tools / stix-parser / sub-agent-profiles / cowork-observe / process-manager / ws-chat-handler / evomap-client / provider-options / session-core-singletons / service-manager / cowork-evomap-adapter / provider-stream / cowork-observe-html / cowork-adapter（iter27, 16 个）、a2a-protocol / agent-coordinator / agent-economy / autonomous-agent / chat-core / compliance-manager / cross-chain / crypto-manager / dao-governance / evolution-system / evomap-manager / hierarchical-memory / inference-network / knowledge-graph / pipeline-orchestrator / plan-mode（iter28, 16 个）。每个 lib 表面 44 个 V2 单测，全部遵循 4-state profile maturity + 5-state record lifecycle + auto-{stale,suspend,pause,degrade,mute,dormant,disable}-idle + auto-fail-stuck 模式；与 legacy + 既有 V2 前缀通过 `preAction` 钩子避让嵌套。累计 iter16-iter28：136 lib 表面、~5,984 V2 单测。

---

## 一、统一设计模式

所有 V2 治理表面均遵循相同的骨架：

### 1. 双状态机

- **实体成熟度**（Profile / Resource / Actor / Budget / Baseline / Agent 等）
  - 4-state：`pending/active/<衰减态>/<终态>`，典型变体如 `pending→active→deprecated→retired`、`pending→active→degraded→retired`、`provisioned→active→frozen→retired` 等
  - 恢复路径：多数 V2 表面提供 `<衰减态>→active` 恢复通道（如 `deprecated→active`、`paused→active`、`idle→active`）
  - 终态：不可回退，如 `retired` / `archived` / `revoked` / `superseded` / `deprovisioned`
- **运行记录生命周期**（Run / Job / Task / Dispatch / Invocation / Assignment / Proof / Incident 等）
  - 5-state：`queued→running→<终态>` 三终态，典型如 `completed/failed/cancelled`、`confirmed/failed/rejected`、`succeeded/failed/cancelled`
  - 中间态可恢复：若干表面允许 `failed→pending` 重试或 `applied→rolled_back` 回退

### 2. 容量治理（Caps）

- **per-owner active-entity cap**：在 `pending→active` 转换时强制（`draft→active` 对草稿模型），不影响已 active 的扩展
- **per-entity pending-record cap**：在创建记录时强制（`createRunV2` / `createJobV2` / `createDispatchV2` 等），对 queued + running 统一计数
- 运行时通过 `setMax*V2()` / `get*V2()` 配置项实时调整，无需重启

### 3. 自动化治理

- **`autoXIdleV2()`**：扫描超过阈值未活动的实体，降级到衰减态（deprecate/degrade/pause/park/offline）
- **`autoFailStuckV2()`**：扫描超过阈值仍在 running 态的记录，终结为 failed 终态并记录原因
- 幂等设计：`activatedAt` / `startedAt` 等关键时间戳 stamp-once，重复触发不改写

### 4. 分派隔离

- **命令分派**：所有 V2 action 以 `-v2` 后缀分派（如 `cc workflow create-v2`），preAction hook 通过 `actionCommand.name().endsWith("-v2")` bypass legacy 数据库引导
- **函数命名**：同 lib 内 legacy 与 V2 命名严格前缀区分，如 V2 使用 `A2A_AGENT_MATURITY_V2` / `createA2aMessageV2` / `_resetStateA2aProtocolV2`
- **状态隔离**：V2 state 是每个 lib 模块级的私有 Map/Object，`_resetState*V2()` 仅清空 V2 态，不影响 legacy

### 5. 测试形态

- 每个 V2 表面一个独立 `*-v2.test.js` 或同文件 `V2 Surface` describe 块
- 典型测试分 4 段：enums 冻结、config setters/getters 边界、实体/记录 lifecycle 正向路径、自动化治理与 caps 的拒绝路径
- 无 mock，无数据库，纯内存

---

## 二、第 1-10 批累计治理表面总览（92+）

### 第一批（运维管家）

| 模块 | 命令 | 实体成熟度 | 运行记录生命周期 |
| ---- | ---- | ---------- | ---------------- |
| Automation | `cc automation` | 4-state | 5-state execution |
| Instinct | `cc instinct` | 4-state | 5-state observation |
| Memory | `cc memory` | 4-state | 5-state consolidation-job |
| Note | `cc note` | 4-state | 5-state revision |
| Org | `cc org` | 4-state | 5-state member |
| PermMem | `cc permmem` | 4-state | 5-state retention-job |
| RCache | `cc rcache` | 4-state | 5-state refresh-job |
| SCIM | `cc scim` | 4-state | 5-state sync-job |
| Session | `cc session` | 4-state | 5-state turn |
| Social | `cc social` | 4-state | 5-state thread |
| Sync | `cc sync` | 4-state | 5-state sync-run |
| Tokens | `cc tokens` | 4-state | 5-state usage-record |
| Wallet | `cc wallet` | 4-state | 5-state tx |

### 第二批（安全与协议）

Trust & Security (Phase 68-71)、Protocol Fusion (Phase 72-73)、Decentralized Infra (Phase 74-75)、DB Evolution (Phase 80)、Multimodal Perception (Phase 84)、Universal Runtime (Phase 63)、NL Programming (Phase 28)、Model Quantization (Phase 20)、IPFS (Phase 17)、Multimodal (Phase 27)、Content Recommendation (Phase 48)、Community Governance (Phase 54)、Tenant SaaS (Phase 97)、AIOps (Phase 25)、Knowledge Graph (Phase 94)、Plugin Ecosystem (Phase 64)、Token Incentive (Phase 66)、Audit Logger (Phase 11)、Compliance (Phase 19)、Production Hardening (Phase 29)、Federation Hardening (Phase 58)。

### 第三批（链 / 零知识 / 隐私）

ZKP Engine (Phase 88 + Phase 88 base)、Privacy Computing (Phase 91)、Inference Network (Phase 67)、Cross-Chain Interop (Phase 89)、Skill Marketplace (Phase 65)、Reputation Optimizer (Phase 60)、SLA (Phase 61)、Stress Test (Phase 59)、Terraform (Phase 56)、EvoMap Advanced (Phase 42)、SIEM (Phase 51)、DLP (Phase 50)、A2A (Phase 81)、BI Analytics (Phase 95)、Low-Code (Phase 93)、Self-Evolving AI (Phase 100)、Agent Economy 2.0 (Phase 85)、Agent Sandbox 2.0 (Phase 87)、Hierarchical Memory 2.0 (Phase 83)、DAO Governance 2.0 (Phase 92)。

### 第四批（数据导入导出 / 自主开发 / 学习）

Knowledge Exporter V2、Knowledge Importer V2、Autonomous Developer V2、Tech Learning Engine V2、Code Gen Agent V2 (Phase 86)、Collaboration Governance V2、Compliance Threat-Intel V2、Compliance UEBA V2。

### 第五批（身份 / 连接 / 算法）

DID Manager V2、PQC Manager V2、P2P Manager V2、LLM Providers V2、Agent Network V2、Skill Loader V2、Response Cache V2、Permanent Memory V2。

### 第六批（安全 / 合作 / 加密）

SSO Manager V2、Workflow Engine V2、Crypto Manager V2。

### 第七批（编排管家 · 9 个治理表面）

| 命令 | 实体成熟度 | 运行记录生命周期 | V2 测试数 |
| ---- | ---------- | ---------------- | --------- |
| `cc sso` | Provider 4-state (deprecated→active) | 5-state login | 35 |
| `cc workflow` | Workflow 4-state (paused→active) | 5-state run | 44 |
| `cc router` | Router Profile 4-state (degraded→active) | 5-state dispatch | 37 |
| `cc hook` | Hook Profile 4-state (disabled→active) | 5-state exec | 42 |
| `cc mcp` | MCP Server 4-state (degraded→active) | 5-state invocation | 33 |
| `cc cowork coord-*-v2` | Coord Agent 4-state (idle→active) | 5-state assignment | 32 |
| `cc subagent` | Sub-Agent 4-state (paused→active) | 5-state task | 37 |
| `cc execbe` | Execution Backend 4-state (degraded→active) | 5-state exec-job | 46 |
| `cc todo` | Todo List 4-state (paused→active) | 5-state item | 39 |

### 第八批（lib 级治理表面 · 12 个）

| lib 模块 | 对应协议/系统 | 实体成熟度 | 运行记录生命周期 | V2 测试数 |
| -------- | -------------- | ---------- | ---------------- | --------- |
| `a2a-protocol` | Phase 81 A2A 协议 | `A2A_AGENT_MATURITY_V2` 4-state | `A2A_MESSAGE_LIFECYCLE_V2` 5-state | 40 |
| `activitypub-bridge` | 去中心化社交 ActivityPub | `AP_ACTOR_MATURITY_V2` 4-state | `AP_ACTIVITY_LIFECYCLE_V2` 5-state | 39 |
| `bi-engine` | Phase 95 BI 智能分析 | `BI_DATASET_MATURITY_V2` 4-state | `BI_QUERY_LIFECYCLE_V2` 5-state | 39 |
| `browser-automation` | Phase 09 浏览器自动化 | `BROWSE_SESSION_MATURITY_V2` 4-state | `BROWSE_STEP_LIFECYCLE_V2` 5-state | 37 |
| `cross-chain` | Phase 89 跨链互操作 | `CC_BRIDGE_MATURITY_V2` 4-state | `CC_TRANSFER_LIFECYCLE_V2` 5-state | 40 |
| `dao-governance` | Phase 92 DAO 治理 2.0 | `DAO_REALM_MATURITY_V2` 4-state | `DAO_PROPOSAL_LIFECYCLE_V2` 5-state | 41 |
| `dlp-engine` | Phase 50 数据防泄漏 | `DLP_POLICY_MATURITY_V2` 4-state | `DLP_INCIDENT_LIFECYCLE_V2` 5-state | 40 |
| `evomap-manager` | Phase 42 EvoMap 高级联邦 | `EVOMAP_HUB_MATURITY_V2` 4-state | `EVOMAP_SUBMISSION_LIFECYCLE_V2` 5-state | 39 |
| `matrix-bridge` | 去中心化社交 Matrix | `MX_ROOM_MATURITY_V2` 4-state | `MX_EVENT_LIFECYCLE_V2` 5-state | 37 |
| `nostr-bridge` | Phase 23 Nostr 桥接 | `NOSTR_RELAY_MATURITY_V2` 4-state | `NOSTR_EVENT_LIFECYCLE_V2` 5-state | 39 |
| `session-consolidator` | Session 聚合流 | `CONSOL_PROFILE_MATURITY_V2` 4-state | `CONSOL_JOB_LIFECYCLE_V2` 5-state | 38 |
| `zkp-engine` | Phase 88 零知识证明 | `ZKP_CIRCUIT_MATURITY_V2` 4-state | `ZKP_PROOF_LIFECYCLE_V2` 5-state | 41 |

**第八批累计新增**: 470 V2 单元测试。

### 第九批（session / 上下文 / 权限治理层 · 14 个）

聚焦会话上下文、权限、社交图谱与组件容器的 lib 级 governance，同 legacy 路径（`session.db`、角色表、DI 容器、社交边）零耦合。

| lib 模块 | 对应系统 | 实体成熟度 | 运行记录生命周期 | V2 测试数 |
| -------- | -------- | ---------- | ---------------- | --------- |
| `slot-filler` | 模板槽填充引擎 | 4-state（archived 终态、stale→active 恢复） | 5-state（3 终态） | 37 |
| `web-fetch` | Web Fetch Job 调度 | 4-state（retired 终态、degraded→active 恢复） | 5-state（3 终态） | 37 |
| `memory-injection` | 记忆注入规则引擎 | 4-state（archived 终态、paused→active 恢复） | 5-state（3 终态） | 37 |
| `session-search` | 会话检索 profile | 4-state（archived 终态、stale→active 恢复） | 5-state（3 终态） | 37 |
| `session-tail` | 会话 NDJSON Tail 订阅 | 4-state（closed 终态、paused→active 恢复） | 5-state（3 终态） | 37 |
| `session-usage` | 会话用量预算 | 4-state（archived 终态、exhausted→active 恢复） | 5-state（recorded/rejected/cancelled） | 37 |
| `session-hooks` | 会话生命周期钩子 | 4-state（retired 终态、disabled→active 恢复） | 5-state（3 终态） | 37 |
| `mcp-scaffold` | MCP Server 脚手架 | 4-state（archived 终态、stale→active 恢复） | 5-state（failed 仅从 generating） | 37 |
| `plan-mode` | Plan Mode 计划与步骤 | 4-state（archived 终态、paused→active 恢复） | 5-state（3 终态） | 39 |
| `permission-engine` | 权限规则/检查引擎 | 4-state（retired 终态、disabled→active 恢复） | 5-state（allowed/denied/cancelled） | 38 |
| `user-profile` | 用户画像 | 4-state（archived 终态、dormant→active 恢复） | 5-state（applied 非终态） | 37 |
| `social-graph` | 社交图谱 V2（sg-* 前缀） | 4-state（removed 终态、inactive→active 恢复） | 5-state（established 非终态） | 37 |
| `service-container` | DI 容器 | 4-state（decommissioned 终态、degraded→active 恢复） | 5-state（3 终态） | 37 |
| `task-model-selector` | 任务-模型选择器 | 4-state（decommissioned 终态、stale→active 恢复） | 5-state（3 终态） | 37 |

**第九批累计新增**: 521 V2 单元测试。命令层采用全新 top-level 分派（`cc slotfill`、`cc webfetch`、`cc meminj`、`cc seshsearch`、`cc seshtail`、`cc seshu`、`cc seshhook`、`cc mcpscaf`、`cc planmode`、`cc perm`、`cc uprof`、`cc svccont`、`cc tms` 等；`cc social sg-*-v2` 借前缀与 social-manager V2 并存）。

### 第十批（编排 / 自治 / 经济 / 进化治理层 · 16 个）

进一步下沉到 orchestrator、pipeline、evolution、hierarchical-memory、inference-network、agent-economy、siem、git 等运行时核心模块，以及四个"进化/自治"lib（app-builder、autonomous-agent、compliance-framework-reporter、content-recommender、cowork-task-runner、iteration-budget、perf-tuning、topic-classifier）。

| lib 模块 | 对应系统 | 实体成熟度 | 运行记录生命周期 | V2 测试数 |
| -------- | -------- | ---------- | ---------------- | --------- |
| `orchestrator` | Claude Code / Codex / Multi-Agent 编排（`cc orchgov`） | 4-state（retired 终态、paused→active 恢复） | 5-state task（3 终态） | 45 |
| `perf-tuning` | 性能自调优 Phase 22 lib 层（appended to `cc perf`） | 4-state（decommissioned 终态、stale→active 恢复） | 5-state bench（3 终态） | 45 |
| `topic-classifier` | 话题分类器（`cc topiccls`） | 4-state（archived 终态、stale→active 恢复） | 5-state job（3 终态） | 45 |
| `iteration-budget` | 迭代预算引擎（`cc itbudget`） | 4-state（exhausted 终态、paused→active 恢复） | 5-state run（3 终态） | 45 |
| `git-integration` | Git 仓库集成（`cc git`） | 4-state（decommissioned 终态、archived→active 恢复） | 5-state commit（3 终态） | 45 |
| `cowork-task-runner` | Cowork Task Runner（`cc cowork runner-*-v2`） | 4-state（retired 终态、paused→active 恢复） | 5-state exec（3 终态） | 45 |
| `inference-network` | Phase 67 推理网络 governance（`cc inference`） | 4-state（decommissioned 终态、degraded→active 恢复） | 5-state job（3 终态） | 45 |
| `content-recommender` | 内容推荐 V2（`cc recommend cr-*-v2`） | 4-state（archived 终态、stale→active 恢复） | 5-state job（3 终态） | 45 |
| `app-builder` | 低代码 App Builder（`cc lowcode`） | 4-state（archived 终态、paused→active 恢复） | 5-state build（3 终态） | 45 |
| `siem-exporter` | SIEM 导出器（`cc siem`） | 4-state（retired 终态、degraded→active 恢复） | 5-state export（3 终态） | 45 |
| `autonomous-agent` | 自治 Agent（`cc autoagent`） | 4-state（archived 终态、paused→active 恢复） | 5-state run（3 终态） | 45 |
| `compliance-framework-reporter` | 合规框架报告（`cc compliance fwrep-*-v2`） | 4-state（archived 终态、deprecated→active 恢复） | 5-state report（3 终态） | 45 |
| `agent-economy` | Agent 经济账户/交易（`cc economy`） | 4-state（closed 终态、frozen→active 恢复） | 5-state tx（3 终态） | 41 |
| `pipeline-orchestrator` | Pipeline 编排（`cc pipeline`） | 4-state（archived 终态、paused→active 恢复） | 5-state run（3 终态） | 41 |
| `evolution-system` | 自进化系统（`cc evolution`） | 4-state（archived 终态、paused→active 恢复） | 5-state cycle（3 终态） | 41 |
| `hierarchical-memory` | 分层记忆 V2（`cc hmemory`） | 4-state（retired 终态、dormant→active 恢复） | 5-state promotion（3 终态） | 41 |

**第十批累计新增**: 704 V2 单元测试。命令层多数新增 top-level（`cc orchgov`、`cc itbudget`、`cc topiccls`、`cc hmemory`、`cc autoagent`、`cc pipeline`、`cc evolution`、`cc economy`、`cc inference`、`cc lowcode`、`cc siem`、`cc git`），少数挂到现有命令（`cc perf *-v2` appended、`cc recommend cr-*-v2`、`cc compliance fwrep-*-v2`、`cc cowork runner-*-v2`）以避免冲突。

### iter16（基础设施治理 lib · 8 个）

`audit-logger`（`cc audit aud-gov-*-v2`）、`knowledge-graph`（`cc kg kgov-*-v2`）、`sandbox-v2`（`cc sandbox sbox-gov-*-v2`）、`sla-manager`（`cc sla slagov-*-v2`）、`stress-tester`（`cc stress strgov-*-v2`）、`terraform-manager`（`cc terraform tfgov-*-v2`）、`reputation-optimizer`（`cc reputation repgov-*-v2`）、`skill-marketplace`（`cc marketplace mktgov-*-v2`）。统一 4-state profile（archived 终态、衰减→active 恢复）+ 5-state lifecycle（3 终态）；每个表面 44 V2 单测；caps 8/30 / 6/20 / 6/12 等按场景配置。

### iter17（chat / 桥接 / 合规 / 学习 / 隐私治理 lib · 8 个）

`chat-core`（`cc chat chatgov-*-v2`）、`claude-code-bridge`（`cc orchestrate ccbgov-*-v2`）、`compliance-manager`（`cc compliance cmgr-*-v2`）、`cowork-learning`（`cc cowork learn-*-v2`）、`cowork-workflow`（`cc cowork cwwf-*-v2`）、`privacy-computing`（`cc privacy pcgov-*-v2`）、`token-incentive`（`cc incentive incgov-*-v2`）、`hardening-manager`（`cc hardening hardgov-*-v2`）。每表面 44 V2 单测，与 legacy 路径完全零交集，命令前缀按避免与 iter15 之前已存在的 `*-v2` 命令冲突原则选择。

### iter18（运维 / 多模态 / 直觉 / 租户 / 量化 / 信任治理 lib · 8 个）

`aiops`（`cc ops aiopsgov-*-v2`）、`multimodal`（`cc multimodal mmgov-*-v2`）、`instinct-manager`（`cc instinct instgov-*-v2`）、`tenant-saas`（`cc tenant tnsgov-*-v2`）、`quantization`（`cc quantize qntgov-*-v2`）、`trust-security`（`cc trust trustgov-*-v2`）、`nl-programming`（`cc nlprog nlpgov-*-v2`）、`perception`（`cc perception percgov-*-v2`）。每表面 44 V2 单测；多数与已有 V2 surface 共存（如 Playbook / Remediation / Session / Artifact / Sensor 等）。

### iter19（身份 / SSO / 组织 / SCIM / 同步 / 代码 Agent / 协作治理 lib · 8 个）

`code-agent`（`cc codegen cdagov-*-v2`）、`collaboration-governance`（`cc collab cogov-*-v2`）、`community-governance`（`cc governance commgov-*-v2`）、`did-manager`（`cc did didgov-*-v2`）、`sso-manager`（`cc sso ssogov-*-v2`）、`org-manager`（`cc org orggov-*-v2`）、`scim-manager`（`cc scim scimgov-*-v2`）、`sync-manager`（`cc sync syncgov-*-v2`）。每表面 44 V2 单测。

### iter20（Agent 网络 / 浏览 / DLP / EvoMap / 联邦 / IPFS / P2P / 钱包 lib · 8 个）

`agent-network`（`cc agent-network anetgov-*-v2`）、`browser-automation`（`cc browse bagov-*-v2`）、`dlp-engine`（`cc dlp dlpgov-*-v2`）、`evomap-governance`（`cc evomap evgov-*-v2`）、`federation-hardening`（`cc federation fedgov-*-v2`）、`ipfs-storage`（`cc ipfs ipfsgov-*-v2`）、`p2p-manager`（`cc p2p p2pgov-*-v2`）、`wallet-manager`（`cc wallet walgov-*-v2`）。每表面 44 V2 单测。

### iter21（社交桥 / BI / 记忆 / 会话 / Hook / Workflow lib · 8 个）

`activitypub-bridge`（`cc activitypub apgov-*-v2`）、`matrix-bridge`（`cc matrix matgov-*-v2`）、`nostr-bridge`（`cc nostr nosgov-*-v2`）、`bi-engine`（`cc bi bigov-*-v2`）、`memory-manager`（`cc memory memgov-*-v2`）、`session-manager`（`cc session sesgov-*-v2`）、`hook-manager`（`cc hook hookgov-*-v2`）、`workflow-engine`（`cc workflow wfgov-*-v2`）。每表面 44 V2 单测；所有命令均挂到对应的现有顶层命令下，前缀按"避免与同模块既有 *-v2 命令冲突"原则选择。

**iter16-iter21 累计**：64 个 lib 级治理表面 × 44 V2 单测 = 2,816 新增 V2 单测。叠加 iter15 之前的 92+ 表面，全栈 156+ V2 治理表面。

### iter22（自动化 / 社交桥 / DID-v2 / 知识导入导出 / LLM / PQC / 社交治理 lib · 8 个）

`automation-engine`（`cc automation augov-*-v2`）、`cowork-share`（`cc cowork shgov-*-v2`）、`did-v2-manager`（`cc did-v2 dv2gov-*-v2`）、`knowledge-exporter`（`cc export kexpgov-*-v2`）、`knowledge-importer`（`cc import kimpgov-*-v2`）、`llm-providers`（`cc llm llmgov-*-v2`）、`pqc-manager`（`cc pqc pqcgov-*-v2`）、`social-manager`（`cc social smgov-*-v2`）。每表面 44 V2 单测；caps 由 6/12（pqc）至 12/30（hook-event 式 pattern）按业务负载配置。

### iter23（运行时缓存 / 学习 / 运行时 / 笔记 / 永久记忆 / 协议融合 / 数据库演进 / 去中心化基础设施 lib · 8 个）

`response-cache`（`cc rcache rcgov-*-v2`）、`tech-learning-engine`（`cc tech techgov-*-v2`）、`universal-runtime`（`cc runtime rtgov-*-v2`）、`note-versioning`（`cc note ntgov-*-v2`）、`permanent-memory`（`cc permmem pmgov-*-v2`）、`protocol-fusion`（`cc fusion pfgov-*-v2`）、`dbevo`（`cc dbevo dbevogov-*-v2`）、`decentral-infra`（`cc infra digov-*-v2`）。每表面 44 V2 单测；与既有 ResponseCache / UniversalRuntime / NoteVersioning / PermanentMemory / dbevo / decentral-infra V2 表面共存。

### iter24（推荐 / MCP / 插件生态 / 技能加载 / 代币追踪 / 自主开发 / 威胁情报 / UEBA lib · 8 个）

`content-recommendation`（`cc recommend rcmdgov-*-v2`）、`mcp-registry`（`cc mcp mcpgov-*-v2`）、`plugin-ecosystem`（`cc ecosystem ecogov-*-v2`）、`skill-loader`（`cc skill sklgov-*-v2`）、`token-tracker`（`cc tokens toktgov-*-v2`）、`autonomous-developer`（`cc dev devgov-*-v2`）、`threat-intel`（`cc compliance tigov-*-v2`）、`ueba`（`cc compliance uebgov-*-v2`）。每表面 44 V2 单测；`compliance` 顶层命令下 tigov / uebgov 与 iter17 cmgr 共存。

### iter25（协作模板 / 协作市场 / cli-anything 桥 / Agent 路由 / 子 Agent 注册 / todo / 执行后端 / Evomap 联邦 lib · 8 个）

`cowork-task-templates`（`cc cowork cttgov-*-v2`）、`cowork-template-marketplace`（`cc cowork ctmgov-*-v2`）、`cli-anything-bridge`（`cc cli-anything clibgov-*-v2`）、`agent-router`（`cc orchestrate argov-*-v2`）、`sub-agent-registry`（`cc agent saregov-*-v2`）、`todo-manager`（`cc agent todogov-*-v2`）、`execution-backend`（`cc agent ebgov-*-v2`）、`evomap-federation`（`cc evomap evfedgov-*-v2`）。每表面 44 V2 单测；`agent` 顶层命令下 saregov / todogov / ebgov 与既有 SUBAGENT / TODO / EXECBE V2 共存。

### iter26（交互规划 / 上下文工程 / 子 Agent 上下文 / 交互适配 / 表达式 / 插件自发现 / Hashline / Web UI lib · 8 个）

`interactive-planner`（`cc planmode plannergov-*-v2`）、`cli-context-engineering`（`cc cli-anything ctxenggov-*-v2`）、`sub-agent-context`（`cc agent sactxgov-*-v2`）、`interaction-adapter`（`cc chat iagov-*-v2`）、`workflow-expr`（`cc workflow wfexgov-*-v2`）、`plugin-autodiscovery`（`cc plugin padgov-*-v2`）、`hashline`（`cc memory hlgov-*-v2`）、`web-ui-server`（`cc ui webuigov-*-v2`）。每表面 44 V2 单测；`cli-anything` 顶层下 ctxenggov 与 iter25 clibgov 共存；`agent` 顶层下 sactxgov 与 saregov/todogov/ebgov 共存。

### iter27（下载器 / 技能 MCP / 协作 MCP 工具 / STIX / 子 Agent 配置 / 协作观察 / 进程管理 / WS 聊天 / Evomap 客户端 / LLM 参数 / 会话核心单例 / 服务管理 / 协作 Evomap 适配 / 流式提供者 / 协作 HTML / 协作适配器 lib · 16 个）

`downloader`（`cc setup dlgov-*-v2`）、`skill-mcp`（`cc skill smcpgov-*-v2`）、`cowork-mcp-tools`（`cc cowork cmcpgov-*-v2`）、`stix-parser`（`cc compliance stixgov-*-v2`）、`sub-agent-profiles`（`cc agent sapgov-*-v2`）、`cowork-observe`（`cc cowork cobsgov-*-v2`）、`process-manager`（`cc start pmgrgov-*-v2`）、`ws-chat-handler`（`cc chat wscgov-*-v2`）、`evomap-client`（`cc evomap evcligov-*-v2`）、`provider-options`（`cc llm poptgov-*-v2`）、`session-core-singletons`（`cc config scsgov-*-v2`）、`service-manager`（`cc services smgrgov-*-v2`）、`cowork-evomap-adapter`（`cc cowork ceadgov-*-v2`）、`provider-stream`（`cc stream pstrmgov-*-v2`）、`cowork-observe-html`（`cc cowork cohtgov-*-v2`）、`cowork-adapter`（`cc cowork cadpgov-*-v2`）。每表面 44 V2 单测，共 16 × 44 = 704 新单测；`cowork` 顶层下 cmcpgov / cobsgov / ceadgov / cohtgov / cadpgov 与 iter17/22/25 前缀共存。

### iter28（A2A 协议 / Agent 协调 / Agent 经济 / 自主 Agent / 聊天核心 / 合规管理 / 跨链 / 加密管理 / DAO 治理 / 进化系统 / Evomap 管理 / 分层记忆 / 推理网络 / 知识图谱 / 流水线编排 / Plan Mode lib · 16 个）

`a2a-protocol`（`cc a2a a2apgov-*-v2`）、`agent-coordinator`（`cc orchestrate acrdgov-*-v2`）、`agent-economy`（`cc economy aecogov-*-v2`）、`autonomous-agent`（`cc agent autagov-*-v2`）、`chat-core`（`cc chat ccoregov-*-v2`）、`compliance-manager`（`cc compliance cmpmgov-*-v2`）、`cross-chain`（`cc crosschain crchgov-*-v2`）、`crypto-manager`（`cc encrypt crygov-*-v2`）、`dao-governance`（`cc dao daomgov-*-v2`）、`evolution-system`（`cc evolution esysgov-*-v2`）、`evomap-manager`（`cc evomap emgrgov-*-v2`）、`hierarchical-memory`（`cc hmemory hmemgov-*-v2`）、`inference-network`（`cc inference infnetgov-*-v2`）、`knowledge-graph`（`cc kg kggov-*-v2`）、`pipeline-orchestrator`（`cc pipeline pipogov-*-v2`）、`plan-mode`（`cc planmode pmodegov-*-v2`）。每表面 44 V2 单测，共 16 × 44 = 704 新单测。与既有同模块前缀（如 `chat chatgov-*-v2` (iter17) / `iagov-*-v2` (iter26) / `wscgov-*-v2` (iter27)，`compliance cmgr-*-v2` (iter17) / `stixgov-*-v2` (iter27) / `tigov-*-v2` / `uebgov-*-v2` (iter24)，`orchestrate ccbgov-*-v2` (iter17) / `argov-*-v2` (iter25)，`planmode plannergov-*-v2` (iter26)，`kg kgov-*-v2` (iter16) 等）全部共存，不覆盖、不回归。

**iter22-iter28 累计**：5 × 8 + 2 × 16 = **72 lib 级治理表面** × 44 V2 单测 = **3,168 新增 V2 单测**。叠加 iter16-iter21 的 64 表面 / 2,816 V2 单测，iter16-iter28 合计 **136 lib 级治理表面 / ~5,984 V2 单测**，全栈 V2 治理表面从 156+ → **228+**。

**2026-04-19 post-iter28 回归**：CLI 单元 iter28 新增 16 文件 704 / 704 通过；CLI 集成 40 文件 696 / 696 通过；CLI E2E 38 文件 565 / 565 通过；**合计 94 文件 1,965 / 1,965 零回归**。

---

## 三、与 legacy 的交互边界

### 数据层

- V2 state **从不写 SQLite**。legacy `registerHook` / `executeHooks` / `insertNote` / `saveWallet` 等仍完全独立。
- V2 可以 **只读** legacy SQLite 作为上下文（例：V2 `workflow` 初始化时读取一次 workflow_definitions），但不会 reverse-write。

### 运行态

- legacy action 不调 V2 函数。
- V2 action 不调 legacy handler（除非为 `-v2` suffix bypass preAction 后的显式触发）。

### 测试隔离

- V2 单测 `beforeEach` 调用 `M._resetState*V2()` 清空 V2 内存态，legacy 单测仍使用各自的 SQLite in-memory fixture。
- Integration / E2E 测试对两条路径都有验证，确认无串联。

---

## 四、版本演进

- CLI 0.106 → 0.130：第一批到第七批 50+ 管家治理表面
- CLI 0.131 → 0.136：第八批 12 个 lib 级治理表面
- CLI 0.137 → 0.139：第九批 14 个 session/context/permission/social lib 级治理表面（+521 V2 单测）
- CLI 0.140 → 0.142：第十批 16 个 orchestration/infra/economy/evolution lib 级治理表面（+704 V2 单测）
- CLI 0.143 → 0.145：iter16 8 个基础设施 lib 级治理表面（+352 V2 单测）
- CLI 0.146 → 0.151：iter17-iter21 共 56 个 lib 级治理表面（+2,464 V2 单测）
- 当前累计：**156+ V2 治理表面，14,255 单元 + 696 集成 + 565 e2e = 15,516 总测试全绿**（CLI 0.151.0）

---

## 五、后续规划

- 第十一批预计覆盖：`llm-provider-registry`（rate-limit / fallback-chain 子治理）、`did-v2-manager`（与 did-manager V2 合并到统一 governance pattern）、`agent-federation-hub`、运行态告警 / 审计日志 / Dashboards 的 V2 signal / rule 对抽象。
- 工具链：补齐 V2 治理表面的 REST 映射（`/v2/:module/:entity`、`/v2/:module/:record`）与 OpenAPI 生成；`cc gov-stats-v2 --all` 汇总器将枚举所有 lib 级治理表面。
