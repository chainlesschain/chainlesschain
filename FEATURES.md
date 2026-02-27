# ChainlessChain Feature Index

Complete list of implemented features in the ChainlessChain project.

**Last Updated**: 2026-02-27 (v1.1.0-alpha)

## Core Features

All entry files are relative to `desktop-app-vue/src/`.

| Feature                       | Entry File(s)                                                            | Documentation                                                                      |
| ----------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| MCP Integration               | `main/mcp/`                                                              | [`MCP_USER_GUIDE.md`](docs/features/MCP_USER_GUIDE.md)                             |
| MCP SDK & Community Registry  | `main/mcp/sdk/index.js`, `main/mcp/community-registry.js`                | —                                                                                  |
| LLM Performance Dashboard     | `main/llm/token-tracker.js`                                              | [`LLM_PERFORMANCE_DASHBOARD.md`](docs/features/LLM_PERFORMANCE_DASHBOARD.md)       |
| SessionManager                | `main/llm/session-manager.js`                                            | [`SESSION_MANAGER.md`](docs/features/SESSION_MANAGER.md)                           |
| ErrorMonitor AI Diagnostics   | `main/monitoring/error-monitor.js`                                       | [`ERROR_MONITOR.md`](docs/features/ERROR_MONITOR.md)                               |
| Manus Optimizations           | `main/llm/manus-optimizations.js`                                        | [`MANUS_OPTIMIZATION_GUIDE.md`](docs/MANUS_OPTIMIZATION_GUIDE.md)                  |
| Cowork Multi-Agent            | `main/ai-engine/cowork/`                                                 | [`COWORK_QUICK_START.md`](docs/features/COWORK_QUICK_START.md)                     |
| Permanent Memory              | `main/llm/permanent-memory-manager.js`                                   | [`PERMANENT_MEMORY_INTEGRATION.md`](docs/features/PERMANENT_MEMORY_INTEGRATION.md) |
| Hooks System                  | `main/hooks/index.js`                                                    | [`HOOKS_SYSTEM_DESIGN.md`](docs/design/HOOKS_SYSTEM_DESIGN.md)                     |
| Hybrid Search Engine          | `main/rag/hybrid-search-engine.js`, `main/rag/bm25-search.js`            | —                                                                                  |
| IPC Error Handler             | `main/utils/ipc-error-handler.js`                                        | [`IPC_ERROR_HANDLER_GUIDE.md`](docs/guides/IPC_ERROR_HANDLER_GUIDE.md)             |
| Permission Engine (RBAC)      | `main/permission/permission-engine.js`                                   | —                                                                                  |
| Team Manager                  | `main/permission/team-manager.js`                                        | —                                                                                  |
| Context Engineering           | `main/llm/context-engineering.js`                                        | —                                                                                  |
| Plan Mode                     | `main/ai-engine/plan-mode/index.js`                                      | —                                                                                  |
| Skills System (95 built-in)   | `main/ai-engine/cowork/skills/index.js`, `builtin/`                      | —                                                                                  |
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
| TypeScript Stores (51)        | `renderer/stores/*.ts`                                                   | —                                                                                  |

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

### Skills System

- **4-layer loading**: bundled → marketplace → managed → workspace (higher priority overrides)
- **Agent Skills Open Standard**: 13 extended fields (tools, instructions, examples, dependencies, input-schema, output-schema, model-hints, cost, author, license, homepage, repository)
- **95 built-in skills** with handlers in `main/ai-engine/cowork/skills/builtin/`
- **/skill commands** parsed via `skills-ipc.js`
- **Parser**: `skill-md-parser.js` (YAML frontmatter + Markdown body)

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

## Android Application

28 skills in `android-app/feature-ai/.../cowork/skills/`:

- **12 Kotlin handlers**: Local execution on Android device
- **8 doc-only**: Documentation/reference skills
- **8 REMOTE skills**: Delegated to desktop via P2PSkillBridge

Uses same SKILL.md format as desktop. Details in `MEMORY.md`.
