# 更新日志

所有重要的项目变更都会记录在此文件中。  
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循语义化版本。

## [5.0.2.10 / CLI 0.123.0] - 2026-04-18 晚 (V2 第六批 · 13 个运行时管家)

### Added — 13 个 V2 规范表面（严格增量，全部基于内存 governance 层，与遗留 SQLite/ 文件态独立）

- **`cc automation` V2** — `AUTOMATION_MATURITY_V2` draft/active/paused/archived + `EXECUTION_LIFECYCLE_V2` queued/running/succeeded/failed/cancelled，per-owner active-automation cap = 20、per-flow pending-execution cap = 30，`autoPauseIdle*` + `autoCancelStuck*`。
- **`cc instinct` V2** — `PROFILE_MATURITY_V2` pending/active/dormant/archived + `OBSERVATION_LIFECYCLE_V2` captured/reviewed/reinforced/discarded/promoted，per-user 5、per-profile 100，`autoDormantIdleProfilesV2` + `autoDiscardStaleObservationsV2`。
- **`cc memory` V2** — `ENTRY_MATURITY_V2` draft/active/stale/archived + `CONSOLIDATION_LIFECYCLE_V2` pending/running/merged/rejected/superseded，per-owner 200、per-owner 20，`autoStaleEntries*` + `autoSupersedeStuck*`。
- **`cc note` V2** — `NOTE_MATURITY_V2` draft/active/stale/archived + `REVISION_LIFECYCLE_V2` pending/applied/rolled_back/conflicting/discarded，per-author 100、per-note 50，`autoStaleNotesV2` + `autoDiscardStaleRevisionsV2`。
- **`cc org` V2** — `ORG_MATURITY_V2` provisional/active/suspended/archived + `MEMBER_LIFECYCLE_V2` invited/active/suspended/removed/expired，per-owner 10、per-org 500，`autoSuspendIdleOrgsV2` + `autoExpireStaleMembersV2`。
- **`cc permmem` V2**（新命令组）— `PIN_MATURITY_V2` pending/active/dormant/archived + `RETENTION_JOB_LIFECYCLE_V2` queued/running/succeeded/failed/cancelled，per-owner 100、per-pin 10，`autoDormantIdlePinsV2` + `autoCancelStuckJobsV2`。
- **`cc rcache` V2**（新命令组）— `PROFILE_MATURITY_V2` pending/active/suspended/archived + `REFRESH_JOB_LIFECYCLE_V2` queued/running/completed/failed/cancelled，per-owner active-profile 25、per-profile pending-job 4，`autoSuspendIdleProfilesV2` + `autoFailStuckRefreshJobsV2`。与 legacy LRU `cc tokens cache` 并存不冲突。
- **`cc scim` V2** — `IDENTITY_LIFECYCLE_V2` pending/provisioned/suspended/deprovisioned + `SYNC_JOB_V2` queued/running/succeeded/failed/cancelled，per-tenant 5000、per-idp 50，`autoSuspendIdleIdentitiesV2` + `autoFailStuckSyncJobsV2`。
- **`cc session` V2** — `CONVERSATION_MATURITY_V2` active/idle/closed/archived + `TURN_LIFECYCLE_V2` queued/running/completed/failed/cancelled，per-user 20、per-session 100，`autoIdleConversationsV2` + `autoFailStuckTurnsV2`。
- **`cc social` V2** — `RELATIONSHIP_MATURITY_V2` pending/active/muted/blocked + `THREAD_LIFECYCLE_V2` draft/posted/archived/flagged/removed，per-user 1000、per-user 500，`autoMuteStaleRelationshipsV2` + `autoArchiveStaleThreadsV2`。
- **`cc sync` V2** — `RESOURCE_MATURITY_V2` pending/active/paused/archived + `SYNC_RUN_V2` queued/running/succeeded/failed/cancelled，per-owner 50、per-resource 20，`autoPauseIdleResourcesV2` + `autoFailStuckRunsV2`。
- **`cc tokens` V2** — `BUDGET_MATURITY_V2` pending/active/warning/exhausted + `USAGE_RECORD_LIFECYCLE_V2` pending/committed/refunded/rejected/disputed，per-owner 10、per-budget 10000，`autoExhaustBudgetsV2` + `autoCommitStaleRecordsV2`。
- **`cc wallet` V2** — `WALLET_MATURITY_V2` provisioned/active/frozen/retired + `TX_LIFECYCLE_V2` pending/submitted/confirmed/failed/cancelled，per-user 10、per-wallet 100，`autoFreezeIdleWalletsV2` + `autoCancelStuckTxsV2`。

### Changed

- **CLI 包版本**：`chainlesschain@0.106.0 → 0.123.0`（V2 第六批一次性推进 13 个管家 + 小版本收口）
- **README**：中/英双语在最新版本区前插入 V2 第六批条目，替换安装命令到 `chainlesschain@0.123.0`

### Tests

| 模块 | 单元测试（新/总） | 状态 |
| --- | --- | --- |
| `automation-engine.test.js` | +46 / 114 | 全通过 |
| `instinct-manager.test.js` | +48 / 73 | 全通过 |
| `memory-manager.test.js` | +47 / 101 | 全通过 |
| `note-versioning.test.js` | +49 / 71 | 全通过 |
| `org-manager.test.js` | +43 / 75 | 全通过 |
| `permanent-memory.test.js` | +46 / 71 | 全通过 |
| `response-cache.test.js` | +46 / 66 | 全通过 |
| `scim-manager.test.js` | +39 / 62 | 全通过 |
| `session-manager.test.js` | +33 / 77 | 全通过 |
| `social-manager.test.js` | +34 / 75 | 全通过 |
| `sync-manager.test.js` | +39 / 65 | 全通过 |
| `token-tracker.test.js` | +49 / 88 | 全通过 |
| `wallet-manager.test.js` | +41 / 70 | 全通过 |

本批相较 0.106.0 累计新增 **560 个 V2 单元测试**，零回归。

- CLI 单元：232 文件 / **9219/9229**（10 skipped）
- CLI 集成：40 文件 / **696/696**
- CLI E2E：38 文件 / **565/565**
- Desktop core+database / renderer stores / ai-engine sample 全部绿（15+16+3 files / 1587 pass）

---

## [5.0.2.10 / CLI 0.106.0] - 2026-04-18 (V2 第五批 · 协作治理 + UEBA + 威胁情报)

### Added — 3 个 V2 规范表面（严格增量）

- **`cc collab` V2** (CLI 0.105.0)：4-state Agent 成熟度 (`provisional/active/suspended/retired`，`suspended→active` 恢复) + 5-state 提案生命周期 (`draft/voting/approved/rejected/withdrawn`，3 终态)，per-realm active-agent cap = 10、per-proposer voting-proposal cap = 3，`autoRetireIdleAgentsCgV2` + `autoWithdrawStuckProposalsV2` 批量 auto-flip。
- **`cc compliance ueba` V2** (CLI 0.105.0)：4-state baseline 成熟度 (`draft/active/stale/archived`，`stale→active` 恢复) + 5-state investigation 生命周期 (`open/investigating/closed/dismissed/escalated`，3 终态)，per-owner active-baseline cap = 20、per-analyst open-investigation cap = 10（在 `openInvestigationV2` 创建时强制，因 open 即起始态），`autoMarkStaleBaselinesV2` + `autoEscalateStuckInvestigationsV2`。
- **`cc compliance threat-intel` V2** (CLI 0.106.0)：4-state Feed 成熟度 (`pending/trusted/deprecated/retired`，`deprecated→trusted` 恢复) + 5-state Indicator 生命周期 (`pending/active/expired/revoked/superseded`，3 终态)，per-owner active-feed cap、per-feed active-indicator cap、`autoDeprecateIdleFeedsV2` + `autoExpireStaleIndicatorsV2`。SQLite IoC 目录之上叠加纯内存 V2 层。

### Changed

- **CLI 包版本**：`chainlesschain@0.104.0 → 0.105.0 → 0.106.0`（V2 第五批分两次推进）
- **docs-site**：`cli-collab.md` / `cli-compliance.md` 追加 V2 规范表面段（共 4 个枚举 + 3 状态机 + 6 个 auto-flip + 18 配额配置）
- **docs-website-v2**：`index.astro` 升级到 48 条 evolution 条目（v5.0.2.10 新增 39 项，第五批 V2 列入）；CLI chip 从 `v0.104.0` 升至 `v0.106.0`
- **docs/cli/platform.md**：吸收 Collaboration Governance V2 / Compliance UEBA V2 段（项目根反向同步）

### Tests

| 模块 | 单元测试 | V2 新增 | 状态 |
| --- | --- | --- | --- |
| `collaboration-governance.test.js` | 98 | 37 | 全通过 |
| `ueba.test.js` | 59 | 29 | 全通过 |
| `threat-intel.test.js` | 69 | 41 | 全通过 |

本批相较 0.104.0 累计新增 **107 个 V2 单元测试**，零回归。

---

## [5.0.2.34] - 2026-04-17 (npm 0.66.0 · 7 个新命令组 + 8 个 V2 强化)

### Added — 7 个新 CLI 命令组

- **`cc agent-network`** — 去中心化 Agent 网络：Ed25519 DID + W3C VC + Kademlia k-bucket 模拟 + 4 维加权声誉任务路由 (Phase 24)
- **`cc automation` / `cc auto`** — 工作流自动化引擎：12 个 SaaS 连接器 (Gmail/Slack/GitHub/Jira/Notion/Trello/Discord/Teams/Airtable/Figma/Linear/Confluence) + 5 种触发器 + DAG 流 (Phase 96)
- **`cc didv2`** — W3C DID v2.0：did:key/web/chain + Ed25519 VC/VP + k-of-n 守护人社交恢复 + 身份漫游 (Phase 55)
- **`cc perf`** — 性能自动调优：OS 真采样 + 5 规则带滞回 + 冷却，CLI 只汇报不自动应用 (Phase 22)
- **`cc pipeline`** — 开发流水线编排：7 阶段 AI 开发流水线 (req→arch→code→test→review→deploy→monitor) + 4 模板 + 6 部署策略 (Phase 26)
- **`cc ecosystem` / `cc eco`** — 智能插件生态 2.0：注册 + DFS 依赖求解器 + 沙箱日志 + 发布状态机 + 70/30 收益分账 (Phase 64)
- **`cc sso`** — 企业身份认证：SAML/OAuth2/OIDC 配置 CRUD + PKCE S256 + AES-256-GCM Token 加密 + DID↔SSO 身份桥 (Phase 14)

### Added — 8 个现有命令 V2 强化（严格增量，向后兼容）

- **`cc social graph`** — 图分析：度/紧密度/中介中心性 + 影响力 + 社区发现 + BFS 最短路径 (Phase 42)
- **`cc dao`** — 4 阶段生命周期 + 二次投票 (cost=n²) + 防环委托 + 时锁 + 多数+法定人数门槛 (Phase 92)
- **`cc economy`** — 支付类型 + 双边状态通道 + NFT 铸造/列表/购买/销毁 + 任务贡献加权分账 (Phase 85)
- **`cc evolution`** — 6 维能力评估 + 4 级严重度诊断 + 4 种修复策略 + 成长里程碑自动记录 (Phase 100)
- **`cc hmemory`** — 4 层内存 + 3 类型 + 3 权限共享 + 巩固状态机 + 概念重叠语义搜索 (Phase 83)
- **`cc sandbox`** — 沙箱状态机 + 5 类权限 + 5 级风险评分 + 5 类配额 + 自动隔离 + 审计过滤 (Phase 87)
- **`cc workflow`** — 5 类标准模板 + 检查点快照 + 回滚到检查点 + 条件断点（正则安全） + JSON 导入/导出 (Phase 82)
- **`cc zkp`** — 3 种证明方案 (Groth16/PLONK/Bulletproofs) + 方案参数化证明形状 + 凭证注册表 + 选择性披露 (Phase 88)

### Changed

- **CLI 包版本**：`chainlesschain@0.51.0 → 0.66.0`（单次 npm publish，包含 2026-04-17 下午全部新增）
- **docs-site 新增 12 个命令参考页**：`cli-agent-network` / `cli-automation` / `cli-did-v2` / `cli-perf` / `cli-pipeline` / `cli-ecosystem` / `cli-sso` 等，VitePress 侧栏同步更新
- **docs/cli 子文件**：`blockchain-enterprise.md` / `core-phases.md` / `platform.md` 吸收新命令项

### Tests

| 层 | 文件数 | 用例数 | 耗时 |
| --- | --- | --- | --- |
| CLI 单元 | 232 | **7618/7618** | 129s |
| CLI 集成 | 40 | **696/696** | 46s |
| CLI E2E | 38 | **565/565** | 427s |

本批相较 0.51.0 新增 **536 个单元测试**（7082 → 7618），覆盖 15 个新 / 强化命令，全部通过；集成 / E2E 零回归。

### npm

| Tag | 版本 | 发布时间 |
| --- | --- | --- |
| v5.0.2.34 | 0.66.0 | 2026-04-17 晚 |

`npm i -g chainlesschain@0.66.0`（别名 `cc` / `clc` / `clchain`）

---

## [5.0.2.33] - 2026-04-17 (npm 发布批次 · CLI 0.51.0)

### Added

- **Phase 17 IPFS 去中心化存储 CLI**：`cc ipfs node-start/add/get/pin/gc/set-quota/attach-knowledge`，确定性 bafy CID + AES-256-GCM + 配额/GC + 知识库附件，64 tests
- **Phase 20 模型量化 CLI**：`cc quantize`，GGUF 14 级 + GPTQ 目录 + 作业生命周期 (pending→running→completed/failed/cancelled) + 进度追踪，48 tests
- **Phase 27 多模态协作 CLI**：`cc mm session/stream/track/snapshot`，CRDT 风格会话状态 + 5 模态/7 文档格式/6 输出格式参考目录，68 tests
- **Phase 28 自然语言编程 CLI**：`cc nlprog classify/extract/detect-stack/translate/refine/convention-add/conventions/stats`，启发式双语意图/实体/技术栈识别 + 翻译/惯例 CRUD，62 tests
- **Phase 63 统一应用运行时 CLI**：`cc runtime`，OS/容器/云环境能力检测 + 自适应资源分配策略 + 运行时统计，60 tests
- **5 个新 docs-site 页面**：`cli-ipfs.md` · `cli-quantize.md` · `cli-mm.md` · `cli-nlprog.md` · `cli-runtime.md`（由并行会话 commit `27267ed9f` 落地）
- **VitePress 侧栏**：新增 2 个命令分组，去除过期 NEW 标记

### Changed

- **CLAUDE.md 计数更新**：90 → 102 CLI commands，7200+ → 7400+ tests
- **CLI 包版本**：`chainlesschain@0.47.9 → 0.49.0 → 0.51.0`（v5.0.2.32 / v5.0.2.33 两次 npm 发布）
- **docs-website-v2**：`index.astro` 升级到 36 条 evolution 条目，`cli.astro` 新增 3 个命令类别

### npm

| Tag | 版本 | 包含 Phase |
| --- | --- | --- |
| v5.0.2.31 | 0.48.0 | 2026-04-17 文档重构基线（本地 tag） |
| v5.0.2.32 | 0.49.0 | + Phase 63 Universal Runtime |
| v5.0.2.33 | 0.51.0 | + Phase 17 IPFS + Phase 27 Multimodal |

发布渠道：`npm i -g chainlesschain@0.51.0`（别名 `cc` / `clc` / `clchain`）

### Tests

| 层 | 文件数 | 用例数 | 耗时 |
| --- | --- | --- | --- |
| CLI 单元 | 232 | **7082/7082** | 210s |
| CLI 集成 | 40 | **696/696** | 76s |
| CLI E2E | 38 | **565/565** | 459s |

本批新增 Phase 17/20/27/28/63 共 **302 个 CLI 单元测试**（64 + 48 + 68 + 62 + 60），全部通过。E2E 首次运行时 vitest-worker 出现一次 `Timeout calling "onTaskUpdate"` RPC 告警（已知长跑套件抖动），重跑全绿。

---

## [5.0.2.10-cli-wrap] - 2026-04-17

### Added

- **Phase 58 联邦硬化 CLI**：`cc federation register/breaker/failure/success/half-open/check/node-health/pool-* /stats`，熔断器三态 (closed/open/half_open) + 健康检查最差态聚合 + 连接池模拟
- **Phase 84 多模态感知 CLI**：`cc perception record/results/voice-start/voice-status/index-add/query/context/stats`，四模态 (screen/voice/document/video) + 语音会话状态机 + 跨模态索引搜索
- **Phase 80 数据库演进 CLI**：`cc dbevo register/up/down/status/history/query-log/query-stats/analyze/suggestions/apply/stats`，迁移 CRUD + 慢查询分析 + 索引建议追踪
- **Phase 25 AIOps CLI**：`cc ops detect/incidents/baselines/playbooks/postmortem/stats`，Z-Score/IQR 异常检测 + 事件四阶段生命周期 + playbook + 事后复盘
- **Phase 86 代码生成 Agent 2.0 CLI**：`cc codegen generate/show/list/review/review-show/reviews/scaffold/scaffolds/stats`，生成追踪 + 5 条启发式安全规则 + 脚手架记录
- **新增 docs-site 页面**：`cli-federation.md` (Phase 58 CLI 参考) · `cli-perception.md` (Phase 84 CLI 参考)，VitePress 侧栏新增"v5.0.2.10 联邦与多模态感知"分组

### Changed

- **`docs/CLI_COMMANDS_REFERENCE.md` 精简重构**：54.8k → 4.4k 精简索引；完整命令清单拆到 `docs/cli/` 6 个子文件 (core-phases / managed-agents / blockchain-enterprise / observability / platform / video)
- **命令注释全量中文化**：~371 条 `#` 注释由英文翻译为中文，技术术语 (DID/P2P/MCP/PQC/...) 保留原文
- **CLAUDE.md 计数更新**：65 → 90 CLI commands，5960+ → 7200+ tests

### Tests

| 层 | 文件数 | 用例数 | 耗时 |
| --- | --- | --- | --- |
| CLI 单元 | 219 | **6010/6010** | 114s |
| CLI 集成 | 40 | **696/696** | 36s |
| CLI E2E | 38 | **565/565** | 495s |

本轮新增 Phase 25/58/80/84/86 共 **239 个 CLI 单元测试**（48 + 59 + 47 + 47 + 38），全部通过。E2E 运行过程中 vitest-worker 抛出一次 `Timeout calling "onTaskUpdate"` RPC 超时告警（长跑套件已知问题），不影响任何断言结果。

### Fixed

- `docs-site/docs/chainlesschain/ai-video-generation.md` 最后一个参考链接由已删除的锚点修正为 `cli/video.md`

---

## [5.0.2.9-polish] - 2026-04-15

### Added

- **会话钩子第四事件 `AssistantResponse`**：在 `agentLoop()` 返回后 fire-and-forget 触发，钩子可读到 `{sessionId, response, messageCount, provider, model}`
- **`UserPromptSubmit` 钩子支持 rewrite / abort**：钩子 stdout 返回 `{"rewrittenPrompt": "..."}` 即可改写本轮 prompt；返回 `{"abort": true, "reason": "..."}` 直接跳过 LLM
- **Skill-Embedded MCP 上下文过滤**：`buildOptimizedPrompt({ activeMcpServers })` 只把白名单内的 MCP 服务器工具暴露给 LLM，避免 130+ 技能场景下的工具爆炸
- **`UnifiedToolRegistry.initialize({ deferSkills: true })`**：fast init 立即返回，技能解析延迟到第一次读 API 或 `setImmediate` 后台执行；生产 wiring 已切换
- **`MCPClientManager.disconnect(name)`**：单服务器断开别名，配合 Skill-Embedded MCP 的 mount/unmount 流程
- **Category Routing 扩展 `EMBEDDING` / `AUDIO`**：embedding 默认 `ollama` 优先（本地、免费）；audio 默认 `openai` 优先（whisper/tts 质量最高）

### Tests

- 新增 145 测试覆盖本轮（unit 131 + integration 11 + e2e 3），全绿
- 新增 `tests/integration/skill-mcp-context-filter.integration.test.js`、`tests/integration/unified-tool-registry-deferred.integration.test.js`、`__tests__/integration/session-hooks-lifecycle.test.js`、`__tests__/e2e/session-hooks-smoke.test.js`

### Performance

- 6 个核心包 `vitest.config.js` 统一加 `pool: "forks", maxForks: 2` 防御并行 OOM
- UnifiedToolRegistry 冷启动从 ~数百 ms 降到接近 0（138 技能解析延迟到首次读）

### Compatibility

- 全部改动**向后兼容**：未传新参数时行为与之前完全一致

## [5.0.2.10] - 2026-04-06

### Changed

- 文档站版本同步到 `v5.0.2.10`
- CLI Agent Runtime 重构文档已对齐到当前实现
- Web Panel 文档已补齐 runtime event、session record、后台任务、Worktree、压缩遥测相关说明
- 设计文档模块 78 已接入固定路由，不再生成 `78-unmapped.md`
- 根 README、设计文档索引、文档站首页已重新补回推荐阅读与当前架构主线
- 设计模块 69 / 73 / 75 / 77 / 78 已统一补成当前实现对应的长版文档

### Added

- `session-created`、`session-resumed`、`session-list-result` 的 `record` 字段文档
- `tasks-detail`、`tasks-history`、`task:notification` 的用户文档
- `worktree-diff`、`worktree-merge` 的用户文档
- `compression-stats` 的筛选参数文档
- `cli-ui` 增补项目模式、全局模式、会话流转、联调要点说明
- `agent-optimization` 增补五个核心优化模块与已完成增强集成说明
- `minimal-coding-agent-plan` 文档同步代码实际进度：Phase 0–6 全部落地、9 个测试文件 85/85 通过
- 新增 `coding-agent-bridge.test.js` 单元测试（12 用例），通过 `_deps` 注入覆盖桥接层并发场景
- 新增 `coding-agent-lifecycle.integration.test.js`（10 用例）覆盖 19 个 IPC channel、plan-mode、high-risk gating、worktree 全流程
- 新增 `coding-agent-bridge-real-cli.test.js`（2 用例）真实子进程启动 `chainlesschain serve` 端到端验证

### Fixed

- `coding-agent-bridge.js`：`request()` 在 `_send` 抛错时未清理 `pending`，导致内存泄漏；现 try/catch 中先 `pending.delete(id)` 再 throw
- `coding-agent-bridge.js`：WebSocket `close` 时未拒绝在途 pending 请求，调用方永久挂起；现 `_attachSocket()` 的 close 处理器调用 `_rejectAllPending(...)`
- 修复 `docs-site` 首页、Agent 架构页、UI / Serve 文档页的中文乱码
- 修复设计文档首页与运行时重构计划页的内容不同步问题
- 修复模块 78 在文档站同步时未映射到稳定路由的问题
- 修复模块 69 / 73 / 75 / 77 文本被压缩成提纲页的问题
- 同步修正首页、Agent 架构页、UI 页中过期的验证结果数字
- 文档站新增 `Minimal Coding Agent 实施计划`，与设计模块 78 一并入口化
- 设计文档站补齐模块 77 / 78 的稳定路由与侧边栏入口

### Tests

- CLI `ws-runtime-events`：`2/2`
- CLI `tools-registry`：`6/6`
- CLI `agent-core`：`66/66`
- CLI `ws-session-workflow`：`16/16`
- CLI 本轮定向合计：`90/90`
- Web Panel 定向单元：`27/27`
- Web Panel 构建：通过
- Docs Site 构建：通过

## [5.0.2.8] - 2026-03-31

### Added

- Web 管理面板扩展为 10 个模块、4 套主题
- 新增 Services、Logs、Notes、McpTools、Memory、Cron 页面
- 新增主题切换 store 与全局主题变量覆盖
- 新增多组纯函数解析器用于 Web Panel 输出解析

### Fixed

- 修复技能列表始终显示 0 的问题，`stdout` / `output` 字段兼容恢复
- 修复多个页面的中文字符损坏
- 修复浅色主题下组件样式未完整适配的问题
- 修复 DeepSeek 图标损坏

### Tests

- 新增 29 个 Web Panel 单元测试
- Web Panel 测试总量提升到 150+ 级别

## [5.0.2.7] - 2026-03-25

### Added

- Skill Creator v1.2.0
- 新增 `optimize-description`
- 新增 eval 样本自动生成、训练集 / 测试集划分
- 支持 LLM 驱动的技能描述迭代优化

### Tests

- 新增 76 个测试

## [5.0.2.6] - 2026-03-24

### Added

- Vue3 Web 管理面板 npm 打包接入发布流程
- `prepublishOnly` 自动构建 Web Panel
- `findWebPanelDist()` 支持多路径查找

### Fixed

- 修复 `$&`、`$'`、`$$` 等特殊字符注入导致的配置损坏
- 修复文档中部分字符被 U+FFFD 覆盖的问题

### Tests

- 新增 `$` 特殊字符相关回归测试

## [5.0.2.3] - 2026-03-20

### Fixed

- 修复 Web UI 与 WS 服务器之间 5 处协议不匹配：
  - 消息缺少 `id`
  - `auth-ok` / `auth-result` 不一致
  - `msg.session.id` / `msg.sessionId` 不一致
  - `session-list` / `session-list-result` 不一致
  - `stream-data` / `response-token` 语义不一致

### Added

- 新增 21 个协议单元回归测试
- 新增 6 个协议集成测试
- 设计文档模块 73 补充 v1 -> v2 协议对照说明

## [5.0.2.2] - 2026-03-18

### Added

- 新增 `chainlesschain ui`
- 支持项目模式与全局模式
- 支持会话列表、Markdown 流式渲染、自动重连
- 支持 HTTP + WebSocket 一体化启动
- 支持浏览器自动打开、token 注入和基础安全响应头

### Fixed

- 修复 UI 关闭流程与 `server.listen` 错误处理问题
- 修复带 query 参数时的 URL 路由匹配问题

## [5.0.2.1] - 2026-03-17

### Added

- 新增 `doc-edit` 技能
- 支持 md/txt/html/docx/xlsx/pptx 文档编辑
- 支持 `edit` / `append` / `rewrite-section`
- 输出总是写入 `_edited` 新文件

### Added Docs

- 新增 ai-doc-creator 与 ai-media-creator 用户文档
- 文档站开始按用户文档与设计文档分层导航

## [5.0.2.0] - 2026-03-17

### Added

- 新增 AI 文档创作模板 `ai-doc-creator`
- 新增 AI 音视频创作模板 `ai-media-creator`
- 新增 `doc-generate`、`libre-convert`、ComfyUI / TTS 技能
- 文档站升级到 `v5.0.2.0`

## [5.0.1.9] - 2026-03-17

### Added

- 新增 CLI 指令技能包系统
- 将 60+ CLI 指令自动封装为 9 组技能包
- 引入 `sync-cli`
- 支持 direct / agent / hybrid / llm-query 四种执行模式

## [5.0.1.8] - 2026-03-16

### Added

- 子代理隔离系统 v2
- `SubAgentContext`
- `SubAgentRegistry`
- 命名空间记忆与作用域上下文
- Agent 智能增强 v2

## [5.0.1.7] - 2026-03-15

### Added

- 子代理隔离系统初版
- `spawn_sub_agent`
- 三级摘要策略
- 作用域上下文引擎

## [5.0.1.6] - 2026-03-15

### Added

- Agent 智能增强
- `run_code` 工具的 auto pip-install
- 脚本持久化
- 错误分类
- 环境检测
- `agent-core` 从 REPL 中提取

## [5.0.1.5] - 2026-03-15

### Added

- SlotFiller 集成到 Agent 主循环
- `serve` 自动接入 `WSSessionManager`
- `session:create` / `session:close` 事件日志

### Fixed

- 修复 `session-resume` 后无法继续发送消息的问题

## [5.0.1.4] - 2026-03-15

### Added

- WebSocket 有状态会话
- `session-create`
- `session-resume`
- `session-message`
- `session-list`
- `session-close`
- `slash-command`
- `session-answer`

### Notes

- 这是后续 Runtime / Gateway / Event 统一演进的重要基础版本
