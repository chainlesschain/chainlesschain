# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainlessChain is a decentralized personal AI management system with hardware-level security (U-Key/SIMKey). It integrates three core features:

1. **Knowledge Base Management** - Personal second brain with RAG-enhanced search
2. **Decentralized Social** - DID-based identity, P2P encrypted messaging, social forums
3. **Decentralized Trading** - Digital asset management, marketplace, smart contracts

**Current Version**: v0.36.1 (40 Skills + SSO Fix + 100% Handler Coverage) - Updated 2026-02-17

**Primary Application**: `desktop-app-vue/` (Electron + Vue3) - This is the main development focus.

## Configuration Management

### Unified Configuration Directory (`.chainlesschain/`)

**Location:**

- **Production/Development**: `{Electron userData}/.chainlesschain/`
  - Windows: `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/`
  - macOS: `~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/`
  - Linux: `~/.config/chainlesschain-desktop-vue/.chainlesschain/`

**Key Files:**

- **`.chainlesschain/config.json`**: Main configuration file (git-ignored)
- **`.chainlesschain/rules.md`**: Project coding rules - **READ THIS FIRST!** (priority > CLAUDE.md)
- **`desktop-app-vue/src/main/config/unified-config-manager.js`**: Configuration manager implementation

**Configuration Priority:** Environment variables > `.chainlesschain/config.json` > Default configuration

## Memory Bank System

项目使用 Memory Bank 系统保持 AI 助手的跨会话上下文：

| 文件                        | 用途                   | 更新时机       |
| --------------------------- | ---------------------- | -------------- |
| `CLAUDE.md`                 | 主要项目文档和 AI 指南 | 重大功能变更时 |
| `CLAUDE-patterns.md`        | 已验证的架构模式       | 发现新模式时   |
| `CLAUDE-decisions.md`       | 架构决策记录 (ADR)     | 重大架构决策时 |
| `CLAUDE-troubleshooting.md` | 已知问题和解决方案     | 解决新问题时   |
| `CLAUDE-activeContext.md`   | 当前会话状态           | 每次会话结束时 |

## Critical Build & Development Commands

### Desktop Application (Primary Focus)

```bash
cd desktop-app-vue
npm install
npm run dev                # Development mode (Vite + Electron)
npm run build:main         # Build main process (required before dev if modified)
npm run build              # Full build
npm run make:win           # Package for Windows
npm run test:db            # Run database tests
npm run test:ukey          # Run U-Key tests
```

### Backend Services (Docker-based)

```bash
docker-compose up -d       # Start all services
docker-compose down        # Stop services
docker-compose logs -f     # View logs
docker exec chainlesschain-ollama ollama pull qwen2:7b  # Pull LLM model
```

### Java Backend Services

```bash
cd backend/project-service
mvn clean compile && mvn spring-boot:run
mvn test
```

### Python AI Service

```bash
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Root-level Commands

```bash
npm run dev:desktop-vue    # Run desktop app from root
npm run docker:up          # Start Docker services
npm run lint && npm run format
```

## Key Features (Summary)

### MCP (Model Context Protocol) Integration

**Status**: POC v0.1.0 | **Docs**: [`docs/features/MCP_USER_GUIDE.md`](docs/features/MCP_USER_GUIDE.md)

Standardized AI tool integration supporting Filesystem, PostgreSQL, SQLite, Git servers with defense-in-depth security.

### LLM Performance Dashboard

**Status**: ✅ Implemented | **Route**: `#/llm/performance` | **Docs**: [`docs/features/LLM_PERFORMANCE_DASHBOARD.md`](docs/features/LLM_PERFORMANCE_DASHBOARD.md)

Token usage tracking, cost analysis, and performance monitoring with ECharts visualization.

### SessionManager

**Status**: ✅ Implemented v0.29.0 | **Docs**: [`docs/features/SESSION_MANAGER.md`](docs/features/SESSION_MANAGER.md)

Intelligent session context management with auto-compression (30-40% token savings), search, tags, export/import, auto-summary, and Permanent Memory integration.

### ErrorMonitor AI Diagnostics

**Status**: ✅ Implemented | **Docs**: [`docs/features/ERROR_MONITOR.md`](docs/features/ERROR_MONITOR.md)

Smart error diagnosis with local Ollama LLM (free), auto-classification, severity assessment, and auto-fix strategies.

### Manus Optimizations

**Status**: ✅ Implemented v0.24.0 | **Docs**: [`docs/MANUS_OPTIMIZATION_GUIDE.md`](docs/MANUS_OPTIMIZATION_GUIDE.md)

Context Engineering (KV-Cache optimization), Tool Masking, Task Tracking (todo.md), and Multi-Agent system.

### Cowork Multi-Agent Collaboration

**Status**: ✅ Implemented v1.0.0 | **Docs**: [`docs/features/COWORK_QUICK_START.md`](docs/features/COWORK_QUICK_START.md) | [`docs/features/COWORK_FINAL_SUMMARY.md`](docs/features/COWORK_FINAL_SUMMARY.md)

Claude Cowork-style multi-agent collaboration system with 13 core operations (TeammateTool), secure file access control (FileSandbox), long-running task management with checkpoint/recovery, and extensible Skills framework (Office, Data Analysis). Includes intelligent single/multi-agent decision engine, 45 IPC handlers, and 200+ test cases with ~90% code coverage.

**Workflow Integration**: [`docs/PROJECT_WORKFLOW_OPTIMIZATION_PLAN.md`](docs/PROJECT_WORKFLOW_OPTIMIZATION_PLAN.md) | [`docs/COWORK_INTEGRATION_ROADMAP.md`](docs/COWORK_INTEGRATION_ROADMAP.md)

Comprehensive plan to integrate Cowork into project workflow, achieving 80-120% productivity boost. Covers requirement analysis, parallel development, intelligent code review, CI/CD optimization, and automated documentation generation.

### Permanent Memory System (Clawdbot Integration)

**Status**: ✅ Implemented v0.26.2 | **Docs**: [`docs/features/PERMANENT_MEMORY_INTEGRATION.md`](docs/features/PERMANENT_MEMORY_INTEGRATION.md)

Cross-session persistent memory inspired by Clawdbot architecture:

- **Daily Notes**: Auto-logging daily activities to `.chainlesschain/memory/daily/YYYY-MM-DD.md`
- **MEMORY.md**: Long-term knowledge extraction and persistent insights
- **Pre-compaction Flush**: Auto-save before context compression (prevents data loss)
- **Hybrid Search**: Vector (semantic, 0.6 weight) + BM25 (keyword, 0.4 weight) with RRF fusion
- **Auto-indexing**: File watching with 1.5s debounce, automatic index rebuild
- **Embedding Cache**: SQLite-based cache to avoid redundant computation

### Hooks System (Claude Code Inspired)

**Status**: ✅ Implemented v0.27.0 | **Docs**: [`docs/design/HOOKS_SYSTEM_DESIGN.md`](docs/design/HOOKS_SYSTEM_DESIGN.md)

Extensible hooks system inspired by Claude Code, enabling custom logic at key operation points:

- **21 Hook Events**: PreToolUse, PostToolUse, SessionStart, PreCompact, FileModified, etc.
- **4 Hook Types**: Sync, Async, Command (shell), Script (JS/Python/Bash)
- **Priority System**: SYSTEM(0) → HIGH(100) → NORMAL(500) → LOW(900) → MONITOR(1000)
- **Middleware Integration**: IPC, Tool, Session, File, Agent middleware factories
- **Configuration**: `.chainlesschain/hooks.json` (project) and `~/.chainlesschain/hooks.json` (user)
- **Script Hooks**: Auto-load from `.chainlesschain/hooks/*.js`

**Key Files**: `src/main/hooks/index.js`, `src/main/hooks/hook-registry.js`, `src/main/hooks/hook-executor.js`

**Key Files**: `src/main/llm/permanent-memory-manager.js`, `src/main/llm/permanent-memory-ipc.js`

### Hybrid Search Engine

**Status**: ✅ Implemented v0.26.2 | **Docs**: [`docs/features/PERMANENT_MEMORY_INTEGRATION.md`](docs/features/PERMANENT_MEMORY_INTEGRATION.md)

Dual-path search combining semantic and keyword matching:

- **Vector Search**: Semantic similarity via RAG Manager embeddings
- **BM25 Search**: Okapi BM25 algorithm with Chinese/English tokenizer
- **RRF Fusion**: Reciprocal Rank Fusion for result merging
- **Performance**: <20ms search latency, parallel execution

**Key Files**: `src/main/rag/hybrid-search-engine.js`, `src/main/rag/bm25-search.js`

### IPC Error Handler Middleware

**Status**: ✅ Implemented v0.26.2 | **Docs**: [`docs/guides/IPC_ERROR_HANDLER_GUIDE.md`](docs/guides/IPC_ERROR_HANDLER_GUIDE.md)

Enterprise-grade error handling for IPC channels:

- **Error Classification**: 10 error types (Validation, Network, Permission, NotFound, Conflict, Timeout, Database, Filesystem, Internal, Unknown)
- **Standardized Response**: Unified error format with severity, retry hints, suggestions
- **ErrorMonitor Integration**: AI-powered error diagnosis via local Ollama
- **Statistics Collection**: Error tracking and reporting

**Key Files**: `src/main/utils/ipc-error-handler.js`

### Permission Engine (Enterprise RBAC)

**Status**: ✅ Implemented v0.29.0

Enterprise-grade Role-Based Access Control system:

- **Resource-Level Permissions**: Fine-grained access control on individual resources
- **Permission Inheritance**: Parent-child resource permission propagation
- **Permission Delegation**: Temporary permission grants with time bounds
- **Team-Based Permissions**: Team membership-driven access control
- **Audit Logging**: Complete permission change history

**Key Files**: `src/main/permission/permission-engine.js`, `src/main/permission/team-manager.js`, `src/main/permission/delegation-manager.js`

### Team Manager

**Status**: ✅ Implemented v0.29.0

Organization sub-team management system:

- **Team CRUD**: Create, update, delete teams with hierarchy support
- **Member Management**: Add/remove members, set team leads
- **Team Hierarchy**: Parent-child team relationships
- **Team Reports**: Daily standup and weekly report system with AI summaries

**Key Files**: `src/main/permission/team-manager.js`, `src/main/task/team-report-manager.js`

### Context Engineering (KV-Cache Optimization)

**Status**: ✅ Implemented v0.29.0

KV-Cache optimization system for improved LLM performance:

- **Static/Dynamic Separation**: Place static content first for cache hits (60-85% hit rate)
- **Tool Definition Serialization**: Deterministic ordering by name
- **Task Context Management**: Goal restatement to prevent "lost in the middle"
- **Error History Tracking**: Learn from past errors
- **Recoverable Compression**: Preserve references for later recovery
- **Token Estimation**: Chinese/English auto-detection

**Key Files**: `src/main/llm/context-engineering.js`, `src/main/llm/context-engineering-ipc.js` (17 IPC handlers)

### Plan Mode (Claude Code Style)

**Status**: ✅ Implemented v0.29.0

Safe planning mode inspired by Claude Code:

- **Security Analysis Mode**: Only allow Read/Search/Analyze tools
- **Plan Generation**: Auto-record blocked operations to plan
- **Approval Workflow**: Full/partial approval, rejection support
- **Hooks Integration**: Works with PreToolUse hooks for permission control

**Key Files**: `src/main/ai-engine/plan-mode/index.js`, `src/main/ai-engine/plan-mode/plan-mode-ipc.js` (14 IPC handlers)

### Skills System (Markdown Skills)

**Status**: ✅ Implemented v0.29.0

Extensible skill system with Markdown definitions:

- **Three-Layer Loading**: bundled → managed → workspace (higher layers override)
- **Gate Checks**: Platform, binary dependencies, environment variables
- **/skill Commands**: User command parsing and auto-execution
- **Agent Skills Open Standard**: 13 extended fields (tools, instructions, examples, dependencies, input-schema, output-schema, model-hints, cost, author, license, homepage, repository)
- **40 Built-in Skills** (Handler 覆盖 40/40, 100%):
  - **Core**: code-review, git-commit, explain-code
  - **Automation**: browser-automation, computer-use, workflow-automation
  - **Data**: web-scraping, data-analysis
  - **Knowledge**: memory-management, smart-search, context-loader, research-agent
  - **Remote**: remote-control
  - **Security**: security-audit, vulnerability-scanner
  - **DevOps**: devops-automation, env-doctor, release-manager
  - **Development**: test-generator, performance-optimizer, repo-map, refactor, onboard-project, project-scaffold, mcp-server-generator, architect-mode, commit-splitter, screenshot-to-code, diff-previewer, task-decomposer
  - **Documentation**: doc-generator
  - **Testing**: api-tester, lint-and-fix, test-and-fix, bugbot, fault-localizer
  - **Analysis**: dependency-analyzer, impact-analyzer, rules-engine
  - **Database**: db-migration
  - **Analysis**: dependency-analyzer, impact-analyzer
  - **Database**: db-migration

**Key Files**: `src/main/ai-engine/cowork/skills/index.js`, `src/main/ai-engine/cowork/skills/skills-ipc.js` (17 IPC handlers), `src/main/ai-engine/cowork/skills/skill-md-parser.js`, `src/main/ai-engine/cowork/skills/markdown-skill.js`

### AI Skills Demo Templates

**Status**: ✅ Implemented v0.35.0

10 demo project templates showcasing AI skills with browsable UI:

- **Automation**: web-form-autofill, batch-screenshot, data-extraction-pipeline
- **AI Workflow**: ai-research-assistant, daily-report-generator, code-review-pipeline
- **Knowledge**: personal-knowledge-base, meeting-notes-manager
- **Remote**: multi-device-sync, remote-desktop-monitor
- **DemoTemplateLoader**: Auto-discovers JSON templates from `src/main/templates/{category}/`
- **4 IPC Handlers**: template:get-demos, template:get-demo-by-skill, template:preview-demo, template:run-demo

**Key Files**: `src/main/templates/demo-template-loader.js`
**Frontend**: `src/renderer/pages/DemoTemplatesPage.vue` (route: `#/demo-templates`)

### Unified Tool Registry (Agent Skills Open Standard)

**Status**: ✅ Implemented v0.36.0

Unified registry aggregating three tool systems (FunctionCaller 60+ tools, MCP 8 servers, Skills 40 skills) with Agent Skills metadata, fully wired into AI conversation call chain:

- **UnifiedToolRegistry**: Core registry binding FunctionCaller, MCPToolAdapter, SkillRegistry (with initialization lock)
- **MCPSkillGenerator**: Auto-generates SkillManifestEntry when MCP servers connect
- **ToolSkillMapper**: Auto-groups uncovered built-in tools into 10 skill categories
- **Name Normalization**: `browser-click` (SKILL.md) → `browser_click` (FunctionCaller) bridging
- **AI Call Chain Integration**: `ManusOptimizations.bindUnifiedRegistry()` → `ContextEngineering` skill-grouped prompts
- **6 IPC Handlers**: `tools:get-all-with-skills`, `tools:get-skill-manifest`, `tools:get-by-skill`, `tools:search-unified`, `tools:get-tool-context`, `tools:refresh-unified` (with init-wait guard)
- **Community Registry Enriched**: 8 MCP servers with `skillInstructions`, `skillExamples`, `skillCategory`
- **31 Tests**: 27 unit + 4 E2E integration (full call chain verification)

**Key Files**: `src/main/ai-engine/unified-tool-registry.js`, `src/main/ai-engine/tool-skill-mapper.js`, `src/main/mcp/mcp-skill-generator.js`, `src/main/ai-engine/unified-tools-ipc.js`, `src/main/llm/manus-optimizations.js` (bindUnifiedRegistry)
**Frontend**: `src/renderer/pages/ToolsExplorerPage.vue` (route: `#/tools/explorer`), `src/renderer/stores/unified-tools.ts`

### Browser Automation System

**Status**: ✅ Implemented v0.29.0 | **Docs**: [`docs/design/modules/09_浏览器自动化系统.md`](docs/design/modules/09_浏览器自动化系统.md)

Complete browser automation system with workflow editing, intelligent element location, and recording/playback:

- **BrowserEngine** (~300 lines): Core automation engine, Puppeteer API compatible
- **ElementLocator** (~450 lines): Multi-strategy element location (XPath/CSS/Text/Visual)
- **SnapshotEngine** (~280 lines): Snapshot comparison and diagnostics
- **RecordingEngine** (~250 lines): User action recording and playback
- **SmartDiagnostics** (~350 lines): AI-powered diagnostics with auto-fix suggestions
- **Performance**: 95%+ element location accuracy, <200ms snapshot comparison

**Key Files**: `src/main/browser/browser-engine.js`, `src/main/browser/element-locator.js`, `src/main/browser/recording/recorder.js`

### Computer Use Capabilities (Claude Computer Use 风格)

**Status**: ✅ Implemented v0.33.0 | **Docs**: [`docs/features/COMPUTER_USE_GUIDE.md`](docs/features/COMPUTER_USE_GUIDE.md)

类似 Claude Computer Use 的电脑操作能力，支持浏览器和桌面级操作（68+ IPC handlers）：

- **CoordinateAction**: 像素级坐标点击、拖拽、手势操作
- **VisionAction**: Vision AI 集成，视觉元素定位，支持 Claude/GPT-4V/LLaVA
- **NetworkInterceptor**: 网络请求拦截、模拟、条件控制
- **DesktopAction**: 桌面级截图、鼠标键盘控制、窗口管理
- **ComputerUseAgent**: 统一代理，整合所有能力
- **AuditLogger**: 操作审计日志，风险评估（LOW/MEDIUM/HIGH/CRITICAL），敏感信息自动脱敏
- **ScreenRecorder**: 屏幕录制为截图序列，支持暂停/恢复/导出
- **ActionReplay**: 操作回放引擎，支持变速、单步、断点调试
- **SafeMode**: 安全模式，权限控制、区域限制、速率限制、确认提示
- **WorkflowEngine**: 工作流引擎，支持条件分支、循环、并行执行、子工作流
- **ElementHighlighter**: 元素高亮显示，调试和演示可视化
- **TemplateActions**: 预定义操作模板，快速执行常用自动化任务
- **ComputerUseMetrics**: 性能指标收集和分析

**与 Claude Computer Use 对比优势**：

- Shadow DOM 支持（Web Components 兼容）
- 多语言 OCR（10+ 语言）
- 完整工作流引擎（条件/循环/并行）
- 用户录制回放与断点调试
- 操作审计与风险评估
- 安全模式与权限控制

**AI Tools Integration**: 12 个工具可供 AI 调用（browser_click, visual_click, browser_type, browser_key, browser_scroll, browser_screenshot, analyze_page, browser_navigate, browser_wait, desktop_screenshot, desktop_click, desktop_type）

**IPC Handlers**: 45+ 个 IPC 处理器（审计 5、录制 10、回放 8、安全模式 7、工作流 11）

**Frontend Component**: `src/renderer/components/browser/ComputerUsePanel.vue`

**Key Files**: `src/main/browser/computer-use-agent.js`, `src/main/browser/actions/coordinate-action.js`, `src/main/browser/actions/vision-action.js`, `src/main/browser/actions/network-interceptor.js`, `src/main/browser/actions/desktop-action.js`, `src/main/browser/actions/audit-logger.js`, `src/main/browser/actions/screen-recorder.js`, `src/main/browser/actions/action-replay.js`, `src/main/browser/actions/safe-mode.js`, `src/main/browser/actions/workflow-engine.js`

### TypeScript Migration

**Status**: ✅ Completed v0.29.0

Full TypeScript migration for frontend state management:

- **28 Pinia Stores**: All stores migrated to TypeScript (app.ts, auth.ts, session.ts, conversation.ts, llm.ts, task.ts, memory.ts, file.ts, workspace.ts, etc.)
- **Type Safety**: Complete type definitions and interfaces
- **IDE Support**: Full type inference and intelligent hints
- **Compatibility**: Improved logger.info() call compatibility

**Store Location**: `src/renderer/stores/*.ts`

### Enterprise Audit & Compliance

**Status**: ✅ Implemented v0.34.0

Enterprise-grade audit logging and compliance management:

- **Unified Audit Logger**: Aggregates audit events across all subsystems (browser, permission, file, API, cowork)
- **Compliance Manager**: GDPR/SOC2/HIPAA compliance checks, policy engine, report generation
- **Data Subject Handler**: GDPR DSR (access, erasure, rectification, portability) request processing
- **18 IPC Handlers**: Full CRUD for audit logs, compliance policies, DSR, retention policies
- **Hook Events**: `AuditLog`, `ComplianceCheck`, `DataSubjectRequest` integrated into HookSystem

**Key Files**: `src/main/audit/enterprise-audit-logger.js`, `src/main/audit/compliance-manager.js`, `src/main/audit/data-subject-handler.js`, `src/main/audit/audit-ipc.js`
**Frontend**: `src/renderer/pages/EnterpriseAuditPage.vue`, `src/renderer/pages/ComplianceDashboard.vue`, `src/renderer/stores/audit.ts`

### Plugin Marketplace

**Status**: ✅ Implemented v0.34.0

Desktop frontend and bridge for the plugin marketplace backend:

- **Marketplace Client**: HTTP client with DID auth to marketplace REST API
- **Plugin Installer**: Download, hash verification, extraction, SkillLoader registration
- **Plugin Updater**: Background update checks, auto-update notifications
- **22 IPC Handlers**: Browse, install, uninstall, update, rate, publish, configure plugins

**Key Files**: `src/main/marketplace/marketplace-client.js`, `src/main/marketplace/plugin-installer.js`, `src/main/marketplace/plugin-updater.js`, `src/main/marketplace/marketplace-ipc.js`
**Frontend**: `src/renderer/pages/PluginMarketplacePage.vue`, `src/renderer/pages/PluginDetailPage.vue`, `src/renderer/pages/InstalledPluginsPage.vue`, `src/renderer/stores/marketplace.ts`

### Specialized Multi-Agent System

**Status**: ✅ Implemented v0.34.0

8 specialized AI agent templates with coordination capabilities:

- **Agent Templates**: CodeSecurity, DevOps, DataAnalysis, Documentation, TestGenerator, Architect, Performance, Compliance
- **Agent Coordinator**: Multi-agent task decomposition, assignment, result aggregation
- **Agent Registry**: Type registry, factory, versioning, instance lifecycle management
- **16 IPC Handlers**: Template CRUD, deploy/terminate, task assignment, orchestration, analytics
- **5 Built-in Skills**: security-audit, devops-automation, data-analysis, test-generator, performance-optimizer
- **4th Skill Layer**: Marketplace skills layer added to SkillLoader (bundled → marketplace → managed → workspace)

**Key Files**: `src/main/ai-engine/agents/agent-templates.js`, `src/main/ai-engine/agents/agent-coordinator.js`, `src/main/ai-engine/agents/agent-registry.js`, `src/main/ai-engine/agents/agents-ipc.js`
**Frontend**: `src/renderer/pages/AgentDashboardPage.vue`, `src/renderer/pages/AgentTemplateEditorPage.vue`, `src/renderer/stores/agents.ts`

### SSO & Enterprise Authentication

**Status**: ✅ Implemented v0.34.0

Multi-provider Single Sign-On with DID identity linking:

- **SSO Manager**: Multi-provider coordinator (SAML 2.0, OAuth 2.0, OIDC) with PKCE support
- **SAML Provider**: SP metadata generation, AuthnRequest, assertion parsing, signature verification
- **OAuth Provider**: Authorization code + PKCE, token refresh, userinfo, ID token validation
- **Session Manager**: Encrypted token storage (AES-256-GCM), auto-refresh, session lifecycle
- **Identity Bridge**: DID ↔ SSO identity linking with bidirectional lookup
- **20 IPC Handlers**: Provider config, auth flows, identity linking, session management, SAML/OIDC

**Key Files**: `src/main/auth/sso-manager.js`, `src/main/auth/saml-provider.js`, `src/main/auth/oauth-provider.js`, `src/main/auth/sso-session-manager.js`, `src/main/auth/identity-bridge.js`, `src/main/auth/sso-ipc.js`
**Frontend**: `src/renderer/pages/SSOConfigurationPage.vue`, `src/renderer/pages/SSOLoginPage.vue`, `src/renderer/pages/IdentityLinkingPage.vue`, `src/renderer/stores/sso.ts`

### MCP SDK & Community Registry

**Status**: ✅ Implemented v0.34.0

SDK for building custom MCP servers and community server discovery:

- **Server Builder**: Fluent API (`new MCPServerBuilder().name().tool().build()`)
- **HTTP+SSE Server**: HTTP server with SSE streaming, CORS, auth (Bearer/API-Key/Basic)
- **Stdio Server**: Line-delimited JSON-RPC 2.0 over stdin/stdout
- **Community Registry**: Discover/install 8+ pre-cataloged community MCP servers (filesystem, postgresql, sqlite, git, brave-search, puppeteer, slack, github)

**Key Files**: `src/main/mcp/sdk/index.js`, `src/main/mcp/sdk/server-builder.js`, `src/main/mcp/sdk/http-server.js`, `src/main/mcp/sdk/stdio-server.js`, `src/main/mcp/community-registry.js`
**Frontend**: `src/renderer/pages/MCPServerMarketplace.vue`

## Architecture Overview

### Desktop Application Structure

```
desktop-app-vue/
├── src/main/              # Electron main process
│   ├── index.js           # Main entry point
│   ├── database.js        # SQLite/SQLCipher database
│   ├── ukey/              # U-Key hardware integration
│   ├── llm/               # LLM service integration
│   │   ├── session-manager.js           # Session context management
│   │   ├── permanent-memory-manager.js  # Clawdbot memory system
│   │   ├── permanent-memory-ipc.js      # Memory IPC handlers
│   │   ├── context-engineering.js       # KV-Cache optimization
│   │   └── context-engineering-ipc.js   # Context Engineering IPC (17 handlers)
│   ├── rag/               # RAG retrieval system
│   │   ├── rag-manager.js          # Vector search
│   │   ├── hybrid-search-engine.js # Vector + BM25 fusion
│   │   └── bm25-search.js          # Okapi BM25 implementation
│   ├── permission/        # Enterprise RBAC system (v0.29.0)
│   │   ├── permission-engine.js        # RBAC permission engine
│   │   ├── team-manager.js             # Team management
│   │   ├── delegation-manager.js       # Permission delegation
│   │   └── approval-workflow-manager.js # Approval workflows
│   ├── task/              # Task management (v0.29.0)
│   │   └── team-report-manager.js      # Daily/weekly reports
│   ├── hooks/             # Hooks system (Claude Code inspired)
│   │   ├── index.js               # Main entry, HookSystem class
│   │   ├── hook-registry.js       # Hook registration and management
│   │   ├── hook-executor.js       # Hook execution engine
│   │   ├── hook-middleware.js     # IPC/Tool/Session middleware
│   │   └── hooks-ipc.js           # IPC handlers for hooks
│   ├── did/               # DID identity system
│   ├── p2p/               # P2P network (libp2p + Signal)
│   │   └── webrtc-data-channel.js  # WebRTC data channel manager
│   ├── browser/           # Browser automation system (v0.29.0)
│   │   ├── browser-engine.js       # Core automation engine
│   │   ├── element-locator.js      # Intelligent element location
│   │   ├── actions/                # Automation actions (click, input, etc.)
│   │   ├── diagnostics/            # Smart diagnostics and snapshots
│   │   └── recording/              # Recording and playback
│   ├── mcp/               # MCP integration
│   │   ├── sdk/                  # MCP Server SDK (v0.34.0)
│   │   ├── community-registry.js # Community MCP server discovery
│   │   └── mcp-skill-generator.js # Auto-generate skills from MCP servers
│   ├── audit/             # Enterprise Audit & Compliance (v0.34.0)
│   │   ├── enterprise-audit-logger.js  # Unified audit aggregator
│   │   ├── compliance-manager.js       # GDPR/SOC2 compliance
│   │   ├── data-subject-handler.js     # GDPR DSR handling
│   │   └── audit-ipc.js               # 18 IPC handlers
│   ├── marketplace/       # Plugin Marketplace (v0.34.0)
│   │   ├── marketplace-client.js  # HTTP client to marketplace API
│   │   ├── plugin-installer.js    # Plugin download & install
│   │   ├── plugin-updater.js      # Auto-update management
│   │   └── marketplace-ipc.js     # 22 IPC handlers
│   ├── auth/              # SSO Enterprise Authentication (v0.34.0)
│   │   ├── sso-manager.js         # Multi-provider SSO coordinator
│   │   ├── saml-provider.js       # SAML 2.0 SP
│   │   ├── oauth-provider.js      # OAuth 2.0 + OIDC + PKCE
│   │   ├── sso-session-manager.js # Encrypted session management
│   │   ├── identity-bridge.js     # DID ↔ SSO identity linking
│   │   └── sso-ipc.js             # 20 IPC handlers
│   ├── utils/             # Utility modules
│   │   └── ipc-error-handler.js    # IPC error middleware
│   └── ai-engine/         # AI engine and multi-agent
│       ├── plan-mode/             # Plan Mode (Claude Code style)
│       │   ├── index.js           # PlanModeManager
│       │   └── plan-mode-ipc.js   # Plan Mode IPC (14 handlers)
│       ├── agents/                # Specialized Multi-Agent System (v0.34.0)
│       │   ├── agent-templates.js    # 8 agent templates
│       │   ├── agent-coordinator.js  # Task decomposition & orchestration
│       │   ├── agent-registry.js     # Agent type registry & factory
│       │   ├── agent-capabilities.js # Capability definitions
│       │   └── agents-ipc.js         # 16 IPC handlers
│       ├── unified-tool-registry.js   # Unified tool registry (3 systems)
│       ├── tool-skill-mapper.js       # Auto-group tools into skills
│       ├── unified-tools-ipc.js       # Unified tools IPC (6 handlers)
│       └── cowork/
│           └── skills/            # Skills system
│               ├── index.js       # Skill loader (4-layer: bundled→marketplace→managed→workspace)
│               ├── skills-ipc.js  # Skills IPC (17 handlers)
│               └── builtin/       # 30 built-in skills (15 original + 15 new in v0.36.0)
└── src/renderer/          # Vue3 frontend
    ├── pages/             # Page components
    ├── components/        # Reusable components
    └── stores/            # Pinia state management (32 TypeScript stores)
```

### Android Application (Agent Skills System)

```
android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/
├── model/                    # Data models (Skill, SkillMetadata, SkillParameter, SkillCategory)
├── registry/                 # SkillRegistry (thread-safe) + SkillIndex (category/fileType/tag indexes)
├── loader/                   # SkillMdParser (YAML frontmatter) + SkillLoader (3-layer: bundled→managed→workspace)
├── gating/                   # SkillGating (platform/SDK/permission checks)
├── executor/                 # SkillExecutor (handler-first, LLM-fallback) + SkillCommandParser (/skill commands)
├── handler/                  # SkillHandler interface + 7 implementations (CodeReview, ExplainCode, Summarize, Translate, Refactor, UnitTest, Debug)
├── bridge/                   # P2PSkillBridge (desktop-only skill delegation placeholder)
└── di/                       # SkillModule (Hilt DI)

android-app/feature-ai/src/main/assets/skills/   # 15 bundled SKILL.md files (7 with handlers + 8 doc-only)
```

**Key Patterns**: Same SKILL.md format as desktop (YAML frontmatter + Markdown body), Agent Skills Open Standard compatible, `SkillRegistry.toFunctionDefinitions()` for LLM function calling, `/skill-name` command detection in `ConversationViewModel`.

**Dependency**: `org.yaml:snakeyaml:2.2` in `feature-ai/build.gradle.kts`

### Backend Services

- **project-service** (Spring Boot 3.1.11 + Java 17): PostgreSQL, Redis, MyBatis Plus 3.5.9
- **ai-service** (FastAPI + Python): Ollama, Qdrant, 14+ cloud LLM providers

### Database Schema

SQLite with SQLCipher (AES-256). Key tables:

**Core Tables**: `notes`, `chat_conversations`, `did_identities`, `p2p_messages`, `contacts`, `social_posts`

**Memory System Tables** (v0.26.2):

- `embedding_cache` - Vector embedding cache for RAG
- `memory_file_hashes` - File hash tracking for change detection
- `daily_notes_metadata` - Daily notes metadata and statistics
- `memory_sections` - MEMORY.md section categorization
- `memory_stats` - Memory usage statistics

## Technology Stack

### Desktop App

- **Electron**: 39.2.6, **Vue**: 3.4, **TypeScript**: 5.9.3, **UI**: Ant Design Vue 4.1
- **State**: Pinia 2.1.7 (28 TypeScript stores)
- **P2P**: libp2p 3.1.2, WebRTC (wrtc), **Crypto**: Signal Protocol
- **Image**: Sharp, Tesseract.js, **Git**: isomorphic-git
- **Search**: natural (BM25/TF-IDF), Qdrant (Vector)
- **Browser Automation**: Custom engine with multi-strategy element location

### Backend

- **Java**: 17 + Spring Boot 3.1.11 + MyBatis Plus 3.5.9
- **Python**: FastAPI, Ollama, Qdrant
- **Databases**: PostgreSQL 16, Redis 7, SQLite

## Common Development Workflows

### Adding a New Feature

1. Define IPC channel in `src/main/index.js`
2. Implement logic in main process module
3. Create Vue component in `src/renderer/`
4. Add Pinia store if needed
5. Update routes for new pages

### Working with Database

- File: `data/chainlesschain.db` (encrypted)
- Schema: `src/main/database.js`
- Always use prepared statements

## U-Key Integration

**Windows Only**: Via Koffi FFI, SDK in `SIMKeySDK-20220416/`, default PIN: `123456`
**macOS/Linux**: Simulation mode only

## Environment Variables

Key variables (see `.env.example`):

```bash
OLLAMA_HOST=http://localhost:11434
QDRANT_HOST=http://localhost:6333
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chainlesschain
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Testing

```bash
# Desktop - Unit Tests
cd desktop-app-vue
npm run test:db            # Database tests
npm run test:ukey          # U-Key hardware tests
npm run test:unit          # All unit tests (Vitest)
npm run test:security      # Security tests (OWASP)

# Desktop - Integration Tests
npm run test:integration   # Frontend-backend integration
npm run test:e2e           # End-to-end user journey tests

# Backend
cd backend/project-service && mvn test
cd backend/ai-service && pytest
```

**Test Coverage** (v0.29.0): ~75% code coverage, 233+ test cases, 99.6% pass rate

## Code Style & Commit Conventions

Semantic commits: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`

Example: `feat(rag): add reranker support`

## Known Limitations

1. **U-Key**: Windows only (macOS/Linux simulation mode)
2. **GPU**: Docker Ollama requires NVIDIA GPU for acceleration

## Important File Locations

- **Main config**: `desktop-app-vue/package.json`
- **Database schema**: `desktop-app-vue/src/main/database.js`
- **IPC handlers**: `desktop-app-vue/src/main/index.js`, `src/main/ipc/ipc-registry.js`
- **Memory system**: `src/main/llm/permanent-memory-manager.js`, `src/main/llm/permanent-memory-ipc.js`
- **Context Engineering**: `src/main/llm/context-engineering.js`, `src/main/llm/context-engineering-ipc.js`
- **Search engine**: `src/main/rag/hybrid-search-engine.js`, `src/main/rag/bm25-search.js`
- **Permission system**: `src/main/permission/permission-engine.js`, `src/main/permission/team-manager.js`
- **Plan Mode**: `src/main/ai-engine/plan-mode/index.js`, `src/main/ai-engine/plan-mode/plan-mode-ipc.js`
- **Skills system**: `src/main/ai-engine/cowork/skills/index.js`, `src/main/ai-engine/cowork/skills/skills-ipc.js`, `src/main/ai-engine/cowork/skills/skill-md-parser.js` (Agent Skills standard), `src/main/ai-engine/cowork/skills/builtin/` (40 skills)
- **Demo Templates**: `src/main/templates/demo-template-loader.js`, `src/main/templates/{automation,ai-workflow,knowledge,remote}/` (10 templates)
- **Hooks system**: `src/main/hooks/index.js`, `src/main/hooks/hook-registry.js`, `src/main/hooks/hook-executor.js`
- **Error handler**: `src/main/utils/ipc-error-handler.js`
- **P2P/WebRTC**: `src/main/p2p/webrtc-data-channel.js`
- **Browser automation**: `src/main/browser/browser-engine.js`, `src/main/browser/element-locator.js`, `src/main/browser/recording/`
- **Computer Use**: `src/main/browser/computer-use-agent.js`, `src/main/browser/actions/` (12+ modules: coordinate-action, vision-action, desktop-action, audit-logger, screen-recorder, action-replay, safe-mode, workflow-engine, element-highlighter, template-actions, computer-use-metrics)
- **Enterprise Audit**: `src/main/audit/enterprise-audit-logger.js`, `src/main/audit/compliance-manager.js`, `src/main/audit/data-subject-handler.js`, `src/main/audit/audit-ipc.js`
- **Plugin Marketplace**: `src/main/marketplace/marketplace-client.js`, `src/main/marketplace/plugin-installer.js`, `src/main/marketplace/marketplace-ipc.js`
- **Specialized Agents**: `src/main/ai-engine/agents/agent-templates.js`, `src/main/ai-engine/agents/agent-coordinator.js`, `src/main/ai-engine/agents/agents-ipc.js`
- **SSO Authentication**: `src/main/auth/sso-manager.js`, `src/main/auth/saml-provider.js`, `src/main/auth/oauth-provider.js`, `src/main/auth/sso-ipc.js`
- **MCP SDK**: `src/main/mcp/sdk/index.js`, `src/main/mcp/sdk/server-builder.js`, `src/main/mcp/community-registry.js`
- **TypeScript stores**: `src/renderer/stores/*.ts` (32 stores)
- **Unified Tool Registry**: `src/main/ai-engine/unified-tool-registry.js`, `src/main/ai-engine/tool-skill-mapper.js`, `src/main/mcp/mcp-skill-generator.js`, `src/main/ai-engine/unified-tools-ipc.js`
- **Tools Explorer UI**: `src/renderer/pages/ToolsExplorerPage.vue` (route: `#/tools/explorer`), `src/renderer/stores/unified-tools.ts`
- **Demo Templates UI**: `src/renderer/pages/DemoTemplatesPage.vue` (route: `#/demo-templates`)
- **Docker**: `docker-compose.yml`, `docker-compose.cloud.yml`
- **Hooks config**: `.chainlesschain/hooks.json`, `.chainlesschain/hooks/*.js`

## Troubleshooting

### Port Conflicts

| Service         | Port  |
| --------------- | ----- |
| Vite Dev        | 5173  |
| Signaling       | 9001  |
| Ollama          | 11434 |
| Qdrant          | 6333  |
| PostgreSQL      | 5432  |
| Redis           | 6379  |
| Project Service | 9090  |
| AI Service      | 8001  |

### Build Failures

- **Electron**: Run `npm run build:main` before `npm run dev`
- **Spring Boot**: Check MyBatis Plus 3.5.9 and jakarta imports
- **Python**: Ensure `httpx<0.26.0`

### Database Issues

- Reset: Delete `data/chainlesschain.db`
- Default PIN: `123456`

## Documentation References

- **System Design**: `docs/design/系统设计_主文档.md`, `docs/design/系统设计_个人移动AI管理系统.md`
- **Browser Automation**: `docs/design/modules/09_浏览器自动化系统.md`
- **Quick Start**: `QUICK_START.md`, `HOW_TO_RUN.md`
- **README**: `README.md` (Chinese), `README_EN.md` (English)
- **Memory System**: `docs/features/PERMANENT_MEMORY_INTEGRATION.md`
- **Error Handler**: `docs/guides/IPC_ERROR_HANDLER_GUIDE.md`
- **Phase 2 Summary**: `docs/reports/phase2/PHASE2_FINAL_SUMMARY.md`
- **Active Context**: `CLAUDE-activeContext.md`
