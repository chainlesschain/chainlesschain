# 96. V2 规范层（Governance Layer）设计说明

> 本文档记录 CLI 侧 V2 规范层的统一设计模式与第 1-10 批累计 92+ 个治理表面的分类概览。
>
> **定位**：在遗留运行态（SQLite 表 / 文件态 / 内存单例 / 传输层）之上引入纯内存 governance 层，严格增量，与 legacy 路径零冲突，便于灰度与回滚。

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
- 当前累计：**92+ V2 治理表面，1225 新 V2 单元测试（第九批 + 第十批），12979 总测试全绿**（unit 11718 + integration 696 + e2e 565）

---

## 五、后续规划

- 第十一批预计覆盖：`llm-provider-registry`（rate-limit / fallback-chain 子治理）、`did-v2-manager`（与 did-manager V2 合并到统一 governance pattern）、`agent-federation-hub`、运行态告警 / 审计日志 / Dashboards 的 V2 signal / rule 对抽象。
- 工具链：补齐 V2 治理表面的 REST 映射（`/v2/:module/:entity`、`/v2/:module/:record`）与 OpenAPI 生成；`cc gov-stats-v2 --all` 汇总器将枚举所有 lib 级治理表面。
