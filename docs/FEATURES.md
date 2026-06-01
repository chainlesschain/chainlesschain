# ChainlessChain Feature Index

Complete list of implemented features in the ChainlessChain project.

**Last Updated**: 2026-04-26 (v5.0.2.43, web-panel Phase B shipped)

## Core Features

All entry files are relative to `desktop-app-vue/src/`.

| Feature                       | Entry File(s)                                                            | Documentation                                                                      |
| ----------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| MCP Integration               | `main/mcp/`                                                              | [`MCP_USER_GUIDE.md`](docs/features/MCP_USER_GUIDE.md)                             |
| MCP SDK & Community Registry  | `main/mcp/sdk/index.js`, `main/mcp/community-registry.js`                | —                                                                                  |
| MCP Remote Registry Fetch     | `main/mcp/community-registry.js` (`_fetchRemoteCatalog`)                 | —                                                                                  |
| LLM Performance Dashboard     | `main/llm/token-tracker.js`                                              | [`LLM_PERFORMANCE_DASHBOARD.md`](docs/features/LLM_PERFORMANCE_DASHBOARD.md)       |
| SessionManager                | `main/llm/session-manager.js`                                            | [`SESSION_MANAGER.md`](docs/features/SESSION_MANAGER.md)                           |
| ErrorMonitor AI Diagnostics   | `main/monitoring/error-monitor.js`                                       | [`ERROR_MONITOR.md`](docs/features/ERROR_MONITOR.md)                               |
| Manus Optimizations           | `main/llm/manus-optimizations.js`                                        | [`MANUS_OPTIMIZATION_GUIDE.md`](docs/MANUS_OPTIMIZATION_GUIDE.md)                  |
| Cowork Multi-Agent            | `main/ai-engine/cowork/`                                                 | [`COWORK_QUICK_START.md`](docs/features/COWORK_QUICK_START.md)                     |
| Web Cowork 日常任务协作       | `cli/src/lib/cowork-task-*.js` + `web-panel/src/views/Cowork.vue`        | [`86_Web_Cowork`](docs/design/modules/86_Web_Cowork日常任务协作系统.md)             |
| Permanent Memory              | `main/llm/permanent-memory-manager.js`                                   | [`PERMANENT_MEMORY_INTEGRATION.md`](docs/features/PERMANENT_MEMORY_INTEGRATION.md) |
| Hooks System                  | `main/hooks/index.js`                                                    | [`HOOKS_SYSTEM_DESIGN.md`](docs/design/HOOKS_SYSTEM_DESIGN.md)                     |
| Hybrid Search Engine          | `main/rag/hybrid-search-engine.js`, `main/rag/bm25-search.js`            | —                                                                                  |
| IPC Error Handler             | `main/utils/ipc-error-handler.js`                                        | [`IPC_ERROR_HANDLER_GUIDE.md`](docs/guides/IPC_ERROR_HANDLER_GUIDE.md)             |
| Permission Engine (RBAC)      | `main/permission/permission-engine.js`                                   | —                                                                                  |
| Team Manager                  | `main/permission/team-manager.js`                                        | —                                                                                  |
| Context Engineering           | `main/llm/context-engineering.js`                                        | —                                                                                  |
| Plan Mode                     | `main/ai-engine/plan-mode/index.js`                                      | —                                                                                  |
| Skills System (144 built-in)  | `main/ai-engine/cowork/skills/index.js`, `builtin/`                      | —                                                                                  |
| Skill Lazy Loading            | `main/ai-engine/cowork/skills/skill-loader.js` (`parseMetadataOnly`)     | —                                                                                  |
| Unified Tool Registry         | `main/ai-engine/unified-tool-registry.js`                                | —                                                                                  |
| Browser Automation            | `main/browser/browser-engine.js`                                         | [`09_浏览器自动化系统.md`](docs/design/modules/09_浏览器自动化系统.md)             |
| Computer Use                  | `main/browser/computer-use-agent.js`, `main/browser/actions/`            | [`COMPUTER_USE_GUIDE.md`](docs/features/COMPUTER_USE_GUIDE.md)                     |
| Enterprise Audit & Compliance | `main/audit/enterprise-audit-logger.js`                                  | —                                                                                  |
| Plugin Marketplace            | `main/marketplace/marketplace-client.js`                                 | —                                                                                  |
| Specialized Multi-Agent       | `main/ai-engine/agents/agent-coordinator.js`                             | —                                                                                  |
| SSO & Enterprise Auth         | `main/auth/sso-manager.js`                                               | —                                                                                  |
| Verification Loop Skill       | `main/ai-engine/cowork/skills/builtin/verification-loop/handler.js`      | —                                                                                  |
| Orchestrate Workflow Skill    | `main/ai-engine/cowork/skills/builtin/orchestrate/handler.js`            | —                                                                                  |
| Instinct Learning System      | `main/llm/instinct-manager.js`                                           | —                                                                                  |
| Code Knowledge Graph          | `main/ai-engine/cowork/code-knowledge-graph.js`                          | —                                                                                  |
| Decision Knowledge Base       | `main/ai-engine/cowork/decision-knowledge-base.js`                       | —                                                                                  |
| Prompt Optimizer              | `main/ai-engine/cowork/prompt-optimizer.js`                              | —                                                                                  |
| Skill Discoverer              | `main/ai-engine/cowork/skill-discoverer.js`                              | —                                                                                  |
| Debate Review Skill           | `main/ai-engine/cowork/debate-review.js`                                 | —                                                                                  |
| A/B Comparator Skill          | `main/ai-engine/cowork/ab-comparator.js`                                 | —                                                                                  |
| Evolution IPC (35 handlers)   | `main/ai-engine/cowork/evolution-ipc.js`                                 | —                                                                                  |
| Demo Templates                | `main/templates/demo-template-loader.js`                                 | —                                                                                  |
| Enterprise Org Management     | `main/enterprise/enterprise-org-manager.js`                              | —                                                                                  |
| Real-time Collab (CRDT/Yjs)   | `main/collaboration/yjs-collab-manager.js`, `realtime-collab-manager.js` | —                                                                                  |
| IPFS Decentralized Storage    | `main/ipfs/ipfs-manager.js`                                              | —                                                                                  |
| Analytics Dashboard           | `main/analytics/analytics-aggregator.js`                                 | —                                                                                  |
| Autonomous Agent Runner       | `main/ai-engine/autonomous/autonomous-agent-runner.js`                   | —                                                                                  |
| i18n Internationalization     | `main/i18n/index.js`                                                     | —                                                                                  |
| Performance Auto-Tuner        | `main/performance/auto-tuner.js`, `performance-monitor.js`               | —                                                                                  |
| TypeScript Stores (52)        | `renderer/stores/*.ts`                                                   | —                                                                                  |
| Video Editing Agent (CutClaw) | `main/video/video-editing-ipc.js`, `renderer/pages/VideoEditingPage.vue` | [设计文档](docs/design/modules/93_CutClaw借鉴_视频剪辑Agent.md)                   |
| QualityGate (session-core)    | `packages/session-core/lib/quality-gate.js`                              | —                                                                                  |
| Managed Agents (Phase A-J)    | `packages/session-core/`, `main/session/`, `main/ai-engine/code-agent/`  | [对标计划](docs/design/modules/91_Managed_Agents对标计划.md)                       |
| Generic Conflict Resolution   | `main/ai-engine/code-agent/sub-runtime-pool.js`                          | —                                                                                  |

## v1.1.0 Features (v3.0-v4.0 Full-Stack)

| Feature                       | Entry File(s)                                                          | Documentation                                                     |
| ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Pipeline Orchestrator (v3.0)  | `main/ai-engine/cowork/pipeline-orchestrator.js`, `pipeline-ipc.js`    | [流水线编排](docs-site/docs/chainlesschain/pipeline.md)           |
| Deploy Agent (v3.0)           | `main/ai-engine/cowork/deploy-agent.js`, `post-deploy-monitor.js`      | —                                                                 |
| Rollback Manager (v3.0)       | `main/ai-engine/cowork/rollback-manager.js`                            | —                                                                 |
| Requirement Parser (v3.0)     | `main/ai-engine/cowork/requirement-parser.js`                          | —                                                                 |
| NL Spec Translator (v3.1)     | `main/ai-engine/cowork/spec-translator.js`, `nl-programming-ipc.js`    | [自然语言编程](docs-site/docs/chainlesschain/nl-programming.md)   |
| Project Style Analyzer (v3.1) | `main/ai-engine/cowork/project-style-analyzer.js`                      | —                                                                 |
| Modality Fusion (v3.2)        | `main/ai-engine/cowork/modality-fusion.js`, `multimodal-collab-ipc.js` | [多模态协作](docs-site/docs/chainlesschain/multimodal.md)         |
| Document Parser (v3.2)        | `main/ai-engine/cowork/document-parser.js`                             | —                                                                 |
| Screen Recorder (v3.2)        | `main/ai-engine/cowork/screen-recorder.js`                             | —                                                                 |
| Multimodal Context (v3.2)     | `main/ai-engine/cowork/multimodal-context.js`, `multimodal-output.js`  | —                                                                 |
| Alert Manager (v3.3)          | `main/ai-engine/cowork/alert-manager.js`, `autonomous-ops-ipc.js`      | [自主运维](docs-site/docs/chainlesschain/autonomous-ops.md)       |
| Auto Remediator (v3.3)        | `main/ai-engine/cowork/auto-remediator.js`                             | —                                                                 |
| Postmortem Generator (v3.3)   | `main/ai-engine/cowork/postmortem-generator.js`                        | —                                                                 |
| Agent DID (v4.0)              | `main/ai-engine/cowork/agent-did.js`                                   | [代理联邦网络](docs-site/docs/chainlesschain/agent-federation.md) |
| Agent Credential (v4.0)       | `main/ai-engine/cowork/agent-credential-manager.js`                    | —                                                                 |
| Agent Authenticator (v4.0)    | `main/ai-engine/cowork/agent-authenticator.js`                         | —                                                                 |
| Federated Registry (v4.0)     | `main/ai-engine/cowork/federated-agent-registry.js`                    | —                                                                 |
| Cross-Org Task Router (v4.0)  | `main/ai-engine/cowork/cross-org-task-router.js`                       | —                                                                 |
| Agent Reputation (v4.0)       | `main/ai-engine/cowork/agent-reputation.js`                            | —                                                                 |

## System Details

### Canonical Tool Descriptor (v5.0.2.9)

- **Single source of truth**: CLI runtime contract (`coding-agent-contract-shared.cjs`) is the canonical origin for all core tool schemas
- **Unified shape**: `inputSchema` is the schema source of truth; `parameters` is a read-only mirror kept for backwards compatibility
- **Canonical fields**: `name`, `title`, `kind`, `source`, `category`, `inputSchema`, `parameters`, `isReadOnly`, `riskLevel`, `permissions`, `telemetry`, `availableInPlanMode`, `requiresPlanApproval`, `requiresConfirmation`, `approvalFlow`
- **Permission semantics**: Plan Mode and Permission Gate read the same fields across CLI and Desktop — no tool-name whitelists
- **End-to-end propagation**: CLI runtime → Electron main (FunctionCaller, UnifiedToolRegistry, MCP adapter) → Renderer stores/components → MCP settings UI
- **Design doc**: [`docs/design/modules/83_工具描述规范统一.md`](./docs/design/modules/83_工具描述规范统一.md)
- **User doc**: [`docs-site/docs/chainlesschain/coding-agent-tool-descriptor-unification-plan.md`](./docs-site/docs/chainlesschain/coding-agent-tool-descriptor-unification-plan.md)
- **Test coverage**: contract↔adapter, registry normalization, IPC serialization, renderer stores, MCP UI, plus FC→registry integration test

### Skills System

- **4-layer loading**: bundled → marketplace → managed → workspace (higher priority overrides)
- **Agent Skills Open Standard**: 13 extended fields (tools, instructions, examples, dependencies, input-schema, output-schema, model-hints, cost, author, license, homepage, repository)
- **144 built-in skills** with handlers in `main/ai-engine/cowork/skills/builtin/`
- **/skill commands** parsed via `skills-ipc.js`
- **Parser**: `skill-md-parser.js` (YAML frontmatter + Markdown body)

#### Built-in Skills Overview (144 total)

| 组别                     | 版本    | 数量 | 技能（技能名）                                                                                                                                                                                                                                       |
| ------------------------ | ------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原有技能                 | —       | 15   | code-review, git-commit, explain-code, browser-automation, computer-use, workflow-automation, web-scraping, data-analysis, memory-management, smart-search, remote-control, security-audit, devops-automation, test-generator, performance-optimizer |
| 开发工具扩展             | v0.36.0 | 15   | repo-map, refactor, doc-generator, api-tester, onboard-project, lint-and-fix, test-and-fix, dependency-analyzer, db-migration, project-scaffold, env-doctor, context-loader, vulnerability-scanner, release-manager, mcp-server-generator            |
| 高级技能                 | v0.36.1 | 10   | architect-mode, bugbot, commit-splitter, diff-previewer, fault-localizer, rules-engine, impact-analyzer, research-agent, screenshot-to-code, task-decomposer                                                                                         |
| AI会话增强+开发效率      | v0.36.2 | 10   | prompt-enhancer, codebase-qa, auto-context, multi-model-router, code-translator, dead-code-eliminator, changelog-generator, mock-data-generator, git-history-analyzer, i18n-manager                                                                  |
| Office文档+音视频        | v0.37.3 | 10   | pdf-toolkit, doc-converter, excel-analyzer, pptx-creator, doc-comparator, audio-transcriber, video-toolkit, subtitle-generator, tts-synthesizer, media-metadata                                                                                      |
| 图像+数据+工具           | v0.37.4 | 10   | image-editor, ocr-scanner, image-generator, chart-creator, word-generator, csv-processor, template-renderer, code-runner, voice-commander, file-compressor                                                                                           |
| 开发效率+系统工具        | v0.37.5 | 10   | json-yaml-toolkit, regex-playground, log-analyzer, system-monitor, http-client, markdown-enhancer, snippet-library, knowledge-graph, clipboard-manager, env-file-manager                                                                             |
| 系统+安全+设计+分析      | v0.37.6 | 10   | backup-manager, query-enhancer, memory-insights, data-exporter, crypto-toolkit, network-diagnostics, password-generator, text-transformer, color-picker, performance-profiler                                                                        |
| 开发工具增强             | v0.38.0 | 10   | ab-compare, api-docs-generator, cursor-rules-generator, database-query, docker-compose-generator, git-worktree-manager, k8s-deployer, terraform-iac, ultrathink, webapp-testing                                                                      |
| 协作/工作流/自动化       | v0.38.1 | 10   | github-manager, pr-reviewer, debate-review, orchestrate, verification-loop, planning-with-files, proactive-agent, cron-scheduler, agent-browser, stream-processor                                                                                    |
| 知识/研究/内容/生产力    | v0.38.2 | 10   | deep-research, tavily-search, summarizer, youtube-summarizer, news-monitor, obsidian, content-publisher, humanizer, notion, google-workspace                                                                                                         |
| 系统/媒体/安全/工具/示例 | v0.38.3 | 11   | api-gateway, free-model-manager, find-skills, skill-creator, self-improving-agent, remotion-video, weather, zkp-toolkit, handler-test-skill, my-custom-skill, test-skill                                                                             |
| 社区生态补充技能         | v1.2.1  | 6    | brainstorming, debugging-strategies, api-design, frontend-design, create-pr, doc-coauthoring                                                                                                                                                         |
| Agent/研究/协作补充       | —       | 7    | complete, deep-interview, multi-search-engine, ralph, ralplan, team, verify                                                                                                                                                                          |
| 视频剪辑 Agent (CutClaw) | v5.0.2.10 | 1* | video-editing (CLI `cc video edit/deconstruct/plan/assemble/render/assets` + Desktop IPC 7ch + Pinia store + Vue page + parallel orchestrator + beat-snap + ducking + QualityGate)                                                                    |

> 注：上表 13 组 builtin 目录小计 = 137 + 「Agent/研究/协作补充」7 = **144** 个 `builtin/*/SKILL.md`（与磁盘一致）。`video-editing`（标 `1*`）是 CutClaw CLI/IPC 技能，**没有独立 `builtin/` SKILL.md 目录**，单列展示，不计入 144。

### Hooks System

- **21 hook events**, 4 hook types (Sync, Async, Command, Script)
- **Priority levels**: SYSTEM(0) → HIGH(100) → NORMAL(500) → LOW(900) → MONITOR(1000)
- **Config files**: `.chainlesschain/hooks.json` (project), `~/.chainlesschain/hooks.json` (user)
- **Script hooks** auto-load from `.chainlesschain/hooks/*.js`

### Instinct Learning

- **8 categories**: CODING_PATTERN, TOOL_PREFERENCE, WORKFLOW, ERROR_FIX, STYLE, ARCHITECTURE, TESTING, GENERAL
- **Observation pipeline**: PostToolUse/PreCompact hooks → buffer (50 items, 60s flush) → pattern extraction
- **Confidence dynamics**: reinforce (+5% diminishing), decay (×0.9)
- **Auto-injection**: Integrated into LLM prompts via Context Engineering
- **Database tables**: `instincts`, `instinct_observations`

### Orchestrate Workflows

- **4 templates**: `feature` (planner→architect→coder→reviewer→verify), `bugfix`, `refactor`, `security-audit`
- **Usage**: `/orchestrate feature "add user profile page"`

### Verification Loop

- **6 stages**: Build → TypeCheck → Lint → Test → Security → DiffReview
- **Auto-detection**: Supports typescript, nodejs, python, java projects
- **Verdict**: READY / NOT READY

### Code Knowledge Graph (v2.1.0)

- **Entity types**: module, class, function, variable, interface, type, enum, component
- **Relationship types**: imports, exports, extends, implements, calls, contains, depends_on
- **Analysis**: degree centrality, hotspot detection, circular dependency detection (DFS)
- **Auto-injection**: Context Engineering step 4.6
- **Database tables**: `code_kg_entities`, `code_kg_relationships`

### Decision Knowledge Base (v2.1.0)

- **Sources**: manual, voting (TeammateTool), orchestrate, instinct
- **Similarity search**: Keyword matching with success-rate boosting
- **Auto-recording**: PostToolUse events for voteOnDecision and orchestrate results
- **Database table**: `decision_records`

### Self-Evolution (v2.1.0)

- **Prompt Optimizer**: A/B variant testing with SHA-256 prompt hashing, success rate tracking
- **Skill Discoverer**: Task failure keyword extraction → marketplace skill auto-discovery
- **Experience Replay**: Extracts successful orchestrate/verification-loop patterns as workflow instincts
- **Database tables**: `prompt_executions`, `prompt_variants`, `skill_discovery_log`

### Advanced Collaboration Skills (v2.1.0)

- **Debate Review** (`/debate-review`): Multi-perspective code review (performance, security, maintainability) with consensus voting
- **A/B Comparator** (`/ab-compare`): Multi-agent variant generation with benchmarking via verification-loop
- **Stream Processor** (`/stream-processor`): Per-line stream processing for log/csv/json files
- **Database tables**: `debate_reviews`, `ab_comparisons`

### Decentralized AI Market (v3.1.0 — Phase 65-67)

- **Skill-as-a-Service**: Standardized skill description (input/output/deps/SLA), EvoMap Gene format, pipeline DAG composition, remote invocation
- **Token Incentive**: Local token accounting, reward calculation, reputation-weighted pricing, contribution tracking
- **Inference Network**: GPU/CPU node registration, latency/cost scheduling, model shard parallel, TEE privacy, federated learning

### Hardware Security Ecosystem (v3.2.0 — Phase 68-71)

- **Trinity Trust Root**: U-Key+SIMKey+TEE unified trust root, attestation chain, secure boot, hardware fingerprint binding
- **PQC Full Migration**: ML-KEM/ML-DSA full replacement, SIMKey firmware PQC, hybrid-to-pure migration
- **Satellite Communication**: LEO satellite messaging, encryption+compression, offline signature queue, emergency key revocation
- **Open Hardware Standard**: Unified HSM interface, Yubikey/Ledger/Trezor adapters, FIPS 140-3 compliance

### Global Decentralized Social (v3.3.0 — Phase 72-75)

- **Protocol Fusion Bridge**: Unified message format, lossless cross-protocol conversion, DID↔AP↔Nostr↔Matrix identity mapping
- **AI Social Enhancement**: Local LLM translation (50+ languages), AI harmful content detection, decentralized consensus review
- **Decentralized Storage**: Filecoin storage deals, P2P CDN, hot content caching, IPLD DAG versioning
- **Anti-Censorship Communication**: Tor hidden service, traffic obfuscation, CDN domain fronting, BLE/WiFi Direct mesh network

### EvoMap Global Evolution (v3.4.0 — Phase 76-77)

- **Global Evolution Network**: Multi-Hub interconnection, Gene cross-Hub sync, evolution pressure selection, gene recombination, lineage DAG
- **IP & Governance DAO**: DID+VC originality proof, anti-plagiarism, derivation chain, Gene quality voting, dispute arbitration

### Architecture Foundation (v4.0.0-alpha — Phase 78-80)

- **IPC Domain Split**: 10 domain files (core/ai/enterprise/social/security/p2p/evomap/infra/marketplace/autonomous), LazyPhaseLoader on-demand loading, IPC Middleware (rate limiting, permission checks, timing)
- **DI Container & Shared Services**: ServiceContainer with circular dependency detection, SharedCacheManager (LRU+TTL), EventBus cross-module pub/sub, ResourcePool timer/connection management
- **Database Evolution**: MigrationManager versioned up/down migrations, QueryBuilder fluent SQL, IndexOptimizer auto-analysis

### AI Agent 2.0 Ecosystem (v4.1.0 — Phase 81-87)

- **A2A Protocol Engine**: Google A2A standard, Agent Card discovery (JSON-LD), Task lifecycle (submitted→working→completed→failed), SSE/WebSocket streaming
- **Agentic Workflow Engine**: DAG-based workflow editor, conditional branches, approval gates, breakpoints, 5 built-in templates, pause/resume/rollback
- **Hierarchical Memory 2.0**: 4-layer memory (working→short-term→long-term→core), forgetting curve, memory consolidation, cross-agent sharing, episodic/semantic search
- **Multimodal Perception**: Screen understanding, voice conversation, document intelligence, video analysis, cross-modal reasoning
- **Agent Economy**: Micropayments via state channels, compute resource market, Proof of Contribution, Agent NFT identity, revenue distribution
- **Code Agent 2.0**: Full-stack code generation, git-aware context, code review (eval/injection detection), scaffolding (5 frameworks), CI/CD auto-config
- **Agent Sandbox 2.0**: WASM isolation, fine-grained permission whitelist (filesystem/network/syscalls), resource quotas, behavior AI monitoring with risk scoring

### Web3 Deepening & Privacy Computing (v4.2.0 — Phase 88-92)

- **ZKP Engine**: zk-SNARK/zk-STARK local generation, Groth16 proof system, Circom circuit compiler, identity proofs with selective disclosure
- **Cross-Chain Bridge**: EVM chains (Ethereum/Polygon/BSC/Arbitrum) + Solana, HTLC atomic swaps, cross-chain messaging
- **DID v2.0**: W3C DID v2.0 spec, Verifiable Presentations, social recovery, cross-platform roaming, reputation portability
- **Privacy Computing**: Federated learning, secure MPC, differential privacy, homomorphic encryption queries
- **DAO Governance v2**: Quadratic voting, delegation, proposal lifecycle (Draft→Active→Queue→Execute), treasury management

### Enterprise Productivity Platform (v4.5.0 — Phase 93-97)

- **Low-Code Platform**: Visual app builder (drag-and-drop), 15 built-in components, data connectors (REST/GraphQL/DB/CSV), app versioning & rollback
- **Enterprise Knowledge Graph**: Auto entity extraction, graph query (Cypher-like), reasoning engine (graph traversal), GraphRAG deep fusion
- **BI Intelligence**: NL→SQL auto-generation, multi-dimensional OLAP, smart report generator, anomaly detection, trend prediction
- **Workflow Automation**: 12 built-in connectors (Gmail/Slack/GitHub/Jira/Notion/Confluence etc.), trigger system (webhook/schedule/event/condition)
- **Multi-tenant SaaS Engine**: Tenant isolation, usage metering, subscription billing (free/starter/pro/enterprise), data import/export

### Ecosystem Fusion (v5.0.0 — Phase 98-100)

- **Universal App Runtime**: Plugin SDK 2.0, hot update mechanism, built-in profiler (flame graph), CRDT state sync, cross-platform support
- **Plugin Ecosystem 2.0**: AI-driven recommendations, dependency resolution + conflict detection, sandbox isolation, AI code review, revenue sharing
- **Self-Evolving AI**: Auto architecture search (NAS), continual learning, self-diagnosis + self-repair, behavior prediction, capability assessment + growth tracking

### Sub-Agent Isolation (v5.0.1.7 — Phase 71)

- **SubAgentContext**: Isolated execution context with independent messages, context engine, tool whitelisting, 3-level summarization (direct/section-extraction/truncate)
- **spawn_sub_agent tool**: LLM-callable tool for creating isolated child agents, returns summary only to parent
- **Namespaced Memory**: hierarchical-memory `_working`/`_shortTerm` isolated by namespace, backward-compatible proxy for default "global" namespace
- **Scoped Context Engineering**: Role-prefixed BM25 queries, higher retention thresholds (0.6 vs 0.3), namespace-aware memory recall
- **Role Tool Whitelist**: Per-role tool restrictions (code-review: read-only, code-generation: write, testing: full, etc.)
- **SubAgentRegistry**: Singleton lifecycle tracker with RingBuffer(100) completion history, session cleanup integration
- **Cowork Debate Summarization**: Reviewer output truncated to 300 chars before passing to moderator
- **Agent Coordinator Integration**: `executeDecomposedTask()` creates SubAgentContext per subtask with role-appropriate tools

## CLI Headless Commands (v5.0.1+)

37 commands in `packages/cli/src/commands/`, 1009 tests all passing (55 test files):

| Command    | Subcommands                                    | Description                                                        |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `setup`    | —                                              | Interactive setup wizard                                           |
| `start`    | —                                              | Launch desktop app                                                 |
| `stop`     | —                                              | Stop app                                                           |
| `status`   | —                                              | Show status                                                        |
| `services` | up, down, logs, pull                           | Docker service management                                          |
| `config`   | list, get, set, edit, reset                    | Configuration management                                           |
| `update`   | —                                              | Check for updates                                                  |
| `doctor`   | —                                              | Environment diagnostics                                            |
| `db`       | init, info, backup, restore                    | Database management (headless)                                     |
| `note`     | add, list, show, search, delete, history, diff, revert | Note/knowledge CRUD + versioning (headless)                |
| `chat`     | —                                              | Interactive AI chat with streaming (headless)                      |
| `ask`      | —                                              | Single-shot AI query (headless)                                    |
| `llm`      | models, test, providers, add-provider, switch  | LLM provider management (headless)                                 |
| `agent`    | —                                              | Agentic AI session with 10 tools + 144 skills + Plan Mode + Sub-Agent Isolation (headless)|
| `skill`    | list, categories, info, search, run            | 144 built-in skill management (headless)                           |
| `search`   | —                                              | BM25 hybrid search (Phase 1)                                      |
| `tokens`   | show, breakdown, recent, cache                 | Token usage tracking + cost analysis (Phase 1)                     |
| `memory`   | show, add, search, delete, daily, file         | Persistent memory + daily notes (Phase 1)                          |
| `session`  | list, show, resume, export, delete             | Session persistence + resume + export (Phase 1)                    |
| `import`   | markdown, evernote, notion, pdf                | Knowledge import from external sources (Phase 2)                   |
| `export`   | markdown, site                                 | Knowledge export as Markdown or static HTML (Phase 2)              |
| `git`      | status, init, auto-commit, hooks, history-analyze | Git integration for knowledge versioning (Phase 2)              |
| `mcp`      | servers, add, remove, connect, disconnect, tools, call | MCP server management (Phase 3)                            |
| `browse`   | fetch, scrape, screenshot                      | Browser automation (headless fetch) (Phase 3)                      |
| `instinct` | show, categories, prompt, delete, reset, decay | Instinct learning management (Phase 3)                             |
| `did`      | create, show, list, resolve, sign, verify, export, set-default, delete | DID identity management (Ed25519) (Phase 4)              |
| `encrypt`  | file, db, info, status + `decrypt` (file, db)  | AES-256-GCM file encryption + DB encryption (Phase 4)              |
| `auth`     | roles, create-role, delete-role, grant, revoke, grant-permission, revoke-permission, check, permissions, users, scopes | RBAC permission engine (Phase 4) |
| `audit`    | log, search, stats, export, purge, types        | Audit logging + risk assessment (Phase 4)                          |
| `p2p`      | status, peers, send, inbox, pair, devices, unpair | P2P messaging + device pairing (Phase 5)                         |
| `sync`     | status, push, pull, conflicts, resolve, log, clear | File & knowledge synchronization (Phase 5)                      |
| `wallet`   | create, list, balance, set-default, delete, asset, assets, transfer, history, summary | Digital wallet + asset management (Phase 5) |
| `org`      | create, list, show, delete, invite, members, team-create, teams, approval-submit, approvals, approve, reject | Organization management (Phase 5) |
| `plugin`   | list, install, remove, enable, disable, update, info, search, registry, summary | Plugin marketplace (Phase 5) |
| `init`     | --template, --yes, --bare                      | Project initialization (4 templates: code-project/data-science/devops/empty) |
| `learning` | stats, trajectories, reflect, synthesize, cleanup | Autonomous learning loop (trajectory tracking + skill synthesis + self-reflection) |
| `cowork`   | debate, compare, analyze, status               | Multi-agent collaboration (debate review + A/B comparison + code analysis) |
| `skill`    | list, run, info, search, categories, add, remove, sources | Multi-layer skill system (4 layers: bundled/marketplace/managed/workspace) |

**Core packages**: core-env, shared-logger, core-infra, core-config, core-db (118 tests total)
**CLI lib modules**: 42 modules (10 original + 6 Phase 1 + 5 Phase 2 + 4 Phase 3 + 4 Phase 4 + 5 Phase 5 + 8 Phase 102)
- Phase 1: bm25-search, token-tracker, response-cache, session-manager, memory-manager, plan-mode
- Phase 2: knowledge-importer, knowledge-exporter, note-versioning, git-integration, pdf-parser
- Phase 3: mcp-client, llm-providers, browser-automation, instinct-manager
- Phase 4: did-manager, crypto-manager, permission-engine, audit-logger
- Phase 5: p2p-manager, sync-manager, wallet-manager, org-manager, plugin-manager
- Phase 102: project-detector, skill-loader, cowork-adapter, debate-review-cli, ab-comparator-cli, code-knowledge-graph-cli, decision-kb-cli, project-style-analyzer-cli

## Android Application

28 skills in `android-app/feature-ai/.../cowork/skills/`:

- **12 Kotlin handlers**: Local execution on Android device
- **8 doc-only**: Documentation/reference skills
- **8 REMOTE skills**: Delegated to desktop via P2PSkillBridge

Uses same SKILL.md format as desktop. Details in `MEMORY.md`.

### Social — production wiring (2026-05-13)

之前 14 个 social Composable + 9 个 ViewModel + 4 个 Repository 已建好但只有 `MyQRCode/QRCodeScanner` 两路由真接通，其它 7 路由都是 `registerPlaceholder("temporarily simplified for build stability")`。本次收口：

- **`NavGraph.kt` 7 路由换实屏** — `PublishPost / PostDetail / FriendDetail / UserProfile / AddFriend / CommentDetail / EditPost` 全部接 Composable，DID 加载期间渲染 spinner 占位
- **新增 2 路由** — `NotificationCenter`（deep-link target）+ `BlockedUsers`（由 FriendListScreen dropdown 入口可达）
- **`SocialScreen.kt` 3 个 tab 换实屏** — Friends → `FriendListScreen`、Timeline → `TimelineScreen`(myDid 走 `DIDViewModel.didDocument`)、Notifications → `NotificationCenterScreen`（带筛选 / mark-all-read / cleanup 菜单，替换内联 basic 列表）
- **PostReportDao 落地** — 之前 `PostRepository.reportPost()` 只构造 `PostReportEntity` 不入库、`getUserReports()` hardcoded 空。新 DAO 走 Room（entity 早在 schema v23 在册）+ `(postId, reporterDid)` 去重 + status 流转。8 个 in-memory Room 测试覆盖
- **远端 DID profile 查询** — `MessageType.PROFILE_QUERY/RESPONSE` 走现有 P2P 通道；`RealtimeEventManager.queryProfile(targetDid, 5s timeout)` 用 `onSubscription` 解决 SharedFlow replay=0 订阅竞态；`SelfProfileProvider` 接口 + `DefaultSelfProfileProvider`（DID-suffix 占位）在 `ChainlessChainApplication.delayedInit` 注入；`FriendRepository.searchUserByDid()` 本地未命中即 fallback
- **`BlockedUsersScreen` 接 ViewModel** — 之前 `blockedUsers` 永远空 + TODO 注释；现 `FriendViewModel` 注入 `DIDManager`、新增 `loadBlockedUsers()` + `unblockFriend` 走完整 `unblockUser(myDid, targetDid)` 路径（清 `BlockedUserEntity` 行）

测试：39 个新单测 + 集成测试（6 core-p2p / 14 feature-p2p / 8 core-database Room / 11 app 路由 + tab 结构性回归）全绿。架构 + 协议详见 `docs/design/android-social-wiring-2026-05.md`。

## System Quality & Testing (Phase 102+)

### Unit Tests — Pinia Store Coverage

12 store test files with 431 tests covering the top Pinia stores:

| Store | Tests | Coverage |
|-------|-------|----------|
| `app.ts` | 33 | Auth, knowledge CRUD, tabs, favorites, storage |
| `session.ts` | 33 | Session CRUD, pagination, tags, stats, selection |
| `conversation.ts` | 32 | Messages, auto-create, token tracking, export |
| `permission.ts` | 27 | RBAC, workflows, approvals, teams, delegations |
| `skill.ts` | 29 | Skill CRUD, search, enable/disable, config |
| `enterprise-org.ts` | 20 | Enterprise org management |
| `llm.ts` | ~30 | LLM models, providers, connection testing |
| `project.ts` | ~30 | Project CRUD, search, filters |
| `audit.ts` | 34 | Audit logs, compliance, DSR, policies |
| `task.ts` | ~35 | Task boards, CRUD, comments, filters |
| `file.ts` | ~25 | File operations, upload, preview |
| `performance-monitor.ts` | ~20 | Performance metrics |

### CI Pipeline Improvements

- Removed improper `continue-on-error: true` from unit-tests, lint, and database-tests jobs
- Re-enabled store, component, and renderer `__tests__` in CI exclude list
- Added test summary step to GitHub Actions workflow

### Code Quality

- **`builtin-tools.js` split**: 25,386-line monolith split into 8 domain modules (file, web, data, ai, dev, system, blockchain, misc)
- **Empty catch blocks**: Cleaned across `mobile-app-uniapp/` and `packages/cli/`
- **Hardcoded credentials**: Removed test tokens and dev passwords, replaced with env vars
- **Bug fix**: `formatZodError()` in `ipc-validator.js` — was accessing `error.errors` instead of `error.issues`

## Web Panel (`packages/web-panel/`)

Browser-served counterpart of the desktop app, talking to a CLI WebSocket bridge (`cc serve`). 34 named routes in `src/router/index.js`.

### Routes by sidebar group

| Group | Route | View | CLI source | Phase |
|-------|-------|------|------------|-------|
| 概 览 | `/dashboard` | `Dashboard.vue` | `status` | base |
| 概 览 | `/chat` | `Chat.vue` | `chat` (WS streaming) | base |
| 概 览 | `/cowork` | `Cowork.vue` | `cowork` | base |
| 概 览 | `/services` | `Services.vue` | `services` | base |
| 概 览 | `/aiops` | `AIOps.vue` | `cc ops *` | **B4** |
| 概 览 | `/logs` | `Logs.vue` | logs reader | base |
| 配 置 | `/skills` | `Skills.vue` | `skill list` | base |
| 配 置 | `/providers` | `Providers.vue` | `llm providers` + `config get llm` | base |
| 配 置 | `/mcp` | `McpTools.vue` | `mcp servers/tools` | base |
| 配 置 | `/project-settings` | `ProjectSettings.vue` | `config get/set project.*` | **A3** |
| 数 据 | `/notes` | `Notes.vue` | `note list/show/add/search` | base |
| 数 据 | `/memory` | `Memory.vue` | `memory show/add` | base |
| 数 据 | `/knowledge` | `KnowledgeGraph.vue` | `kg list/relations/stats/reason` | **A1** |
| 数 据 | `/marketplace` | `Marketplace.vue` | `cc marketplace *` | **B2** |
| 数 据 | `/cron` | `Cron.vue` | `ccron` | base |
| 数 据 | `/workflow` | `WorkflowEditor.vue` | `workflow` | base |
| 数 据 | `/tasks` | `Tasks.vue` | task store | base |
| 高 级 | `/security` | `Security.vue` | `audit` + `did list` | base |
| 高 级 | `/did` | `DID.vue` | `cc did *` | **A2** |
| 高 级 | `/permissions` | `Permissions.vue` | `auth roles/permissions` | base |
| 高 级 | `/p2p` | `P2P.vue` | `p2p status/peers` | base |
| 高 级 | `/backup` | `Backup.vue` | `db backup/sync` | base |
| 高 级 | `/git` | `Git.vue` | `git status/log` | base |
| 高 级 | `/projects` | `Projects.vue` | project store | base |
| 高 级 | `/crosschain` | `Crosschain.vue` | `cc crosschain *` | **B3** |
| 高 级 | `/compliance` | `Compliance.vue` | `cc compliance threat-intel/ueba` | **B5** |
| 企 业 | `/wallet` | `Wallet.vue` | `wallet list/balance` | base |
| 企 业 | `/organization` | `Organization.vue` | `org list/members` | base |
| 企 业 | `/analytics` | `Analytics.vue` | aggregated stats | base |
| 企 业 | `/templates` | `Templates.vue` | `init --template` | base |
| 社 交 | `/community` | `Community.vue` | `cc social *` | **B1** |
| 媒 体 | `/video` | `VideoEditing.vue` | video pipeline | base |
| 扩 展 | `/rssfeed` | `RssFeed.vue` | rss reader | base |
| 扩 展 | `/webauthn` | `WebAuthn.vue` | `cc webauthn` | base |

### Phase A & B port pattern (mechanical)

Each port = one commit in scope `feat(web-panel):` with 4 deliverables:
1. `src/utils/<feature>-parser.js` (pure, with shared `stripCliNoise` from `community-parser.js`)
2. `src/views/<Feature>.vue` (uses `ws.execute('cc <cmd> --json', timeout)`)
3. `src/router/index.js` + `src/components/AppLayout.vue` sidebar entry
4. `__tests__/unit/<feature>-parser.test.js` + new-pages count assertion +1 + path-mapping test

**Sidebar**: 8 collapsible groups via `<a-sub-menu>` with `v-model:openKeys` persisted to `localStorage['cc.web-panel.sidebar.openKeys']`. Independent scroll inside the sider via `height:100vh` + flex column on `.app-root`.

### Test counts (web-panel)

- Unit (`__tests__/unit/`): **809**
- Integration (`__tests__/integration/`): existing `cli-commands.test.js` + new `phase-b-cli-commands.test.js` (**19** new tests, ~40s)
- E2E (`__tests__/e2e/`): `panel.test.js` HTTP SPA fallback for all 34 routes
