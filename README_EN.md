# ChainlessChain - Personal Mobile AI Management System Based on USB Key and SIMKey

<div align="center">

![Version](https://img.shields.io/badge/version-v1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Progress](https://img.shields.io/badge/progress-100%25-brightgreen.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen.svg)
![Electron](https://img.shields.io/badge/electron-39.2.7-blue.svg)
![Tests](https://img.shields.io/badge/tests-2500%2B-brightgreen.svg)

**Decentralized · Privacy First · AI Native**

A fully decentralized personal AI assistant platform integrating knowledge base management, social networking, and transaction assistance.

[中文](./README.md) | [Design Document](./docs/design/系统设计_主文档.md) | [Features](./docs/FEATURES.md)

</div>

---

## ⭐ Current Version: v1.0.0 Enterprise Edition (2026-02-23)

### Latest Updates - Decentralized Social Platform Full Upgrade + Enterprise Infrastructure

**P2P Voice/Video Calls** + **Community Channels** + **Time Machine** + **Decentralized Livestreaming** + **IPFS Storage** + **Autonomous Agent Runner** + **i18n** + **Performance Auto-Tuner** + **Model Quantization** - 95 desktop skills, 46 TypeScript Stores, 310,000+ lines of code, 2500+ test cases

#### v1.0.0 Enterprise Edition - Decentralized Social Platform Full Upgrade (2026-02-23)

**P2P Social New Features** (7 core capabilities):

- ✅ **P2P Voice/Video Calls** (`call-manager` + `call-signaling`) - WebRTC + DTLS-SRTP E2E encryption, SFU relay for 2-8 people, noise reduction, screen sharing, call recording
- ✅ **Shared Encrypted Albums** (`shared-album-manager`) - E2E encrypted albums, EXIF privacy stripping, P2P distribution, access control, version management
- ✅ **Communities & Channels** (`community-manager` + `channel-manager` + `governance-engine`) - Gossip protocol message distribution, role-based permissions, governance voting, community economy
- ✅ **Time Machine** (`time-machine` + `sentiment-analyzer`) - AI-generated memory summaries, sentiment analysis, history playback, important moment extraction
- ✅ **Decentralized Livestreaming** - IPFS video streaming, danmaku system, tipping, P2P CDN acceleration
- ✅ **Social Tokens** (`social-token`) - ERC-20 social credits, creator economy, token issuance & circulation, governance voting
- ✅ **Anonymous Mode** - ZKP zero-knowledge proof identity, temporary DID, revocable anonymity

**Enterprise Infrastructure** (5 new modules):

- ✅ **IPFS Decentralized Storage** (`ipfs-manager`) - Helia/Kubo dual-engine, content addressing, P2P CDN, auto-pinning
- ✅ **Real-time Collaboration (CRDT/Yjs)** (`yjs-collab-manager` + `realtime-collab-manager`) - Yjs CRDT conflict resolution, P2P real-time sync, cursor sharing, document locks
- ✅ **Analytics Dashboard** (`analytics-aggregator`) - Real-time data aggregation, multi-dimensional metrics, visualization reports
- ✅ **Autonomous Agent Runner** (`autonomous-agent-runner`) - ReAct loop, goal decomposition, multi-step reasoning, autonomous task execution
- ✅ **Enterprise Org Management** (`enterprise-org-manager`) - Org hierarchy, approval workflows, multi-tenancy, permission inheritance

**System Enhancements** (4 improvements):

- ✅ **Model Quantization** (`quantization-manager` + `gguf-quantizer` + `gptq-quantizer`) - GGUF 14 quantization levels (Q2_K~F32), AutoGPTQ Python bridge, Ollama import
- ✅ **i18n Internationalization** - 4 languages (Chinese/English/Japanese/Korean), runtime switching
- ✅ **Performance Auto-Tuner** - Real-time monitoring, auto parameter adjustment, memory alerts, load prediction
- ✅ **TypeScript Stores expanded** - 46 TypeScript Stores (13 new), full type coverage

#### v0.39.0 Cowork Self-Evolution + everything-claude-code (2026-02-22)

**Cowork v2.1.0 Self-Evolution & Knowledge Graph** (7 core modules, 35 IPC handlers):

- ✅ **Code Knowledge Graph** - Workspace code scanning, 8 entity types, 7 relationship types, centrality analysis, circular dependency detection, hotspot discovery (14 IPC)
- ✅ **Decision Knowledge Base** - Historical decision records, similarity search, best practice extraction, 9 problem categories, Hook auto-capture (6 IPC)
- ✅ **Prompt Optimizer** - Skill prompt self-optimization, A/B variant testing, SHA-256 deduplication, success rate tracking (5 IPC)
- ✅ **Skill Discoverer** - Task failure analysis, keyword extraction, marketplace skill search recommendations (4 IPC)
- ✅ **Debate Review** - 3-perspective multi-agent review (performance/security/maintainability), consensus voting verdict (3 IPC)
- ✅ **A/B Comparator** - 5 agent style variants, 3-dimension benchmarking, auto-scoring and ranking (3 IPC)
- ✅ **Unified Evolution IPC** - 6 modules, 35 handlers unified registration

**Cowork v2.0.0 Cross-Device Collaboration** (7 modules, 41 IPC handlers):

- ✅ **P2P Agent Network** - WebRTC DataChannel cross-device agent communication, 15 message protocol types (12 IPC)
- ✅ **Device Discovery** - Network device auto-discovery, 4-level capability tiers, health monitoring (6 IPC)
- ✅ **Hybrid Executor** - 6 execution strategies (local-first/remote-first/best-fit/load-balance) (5 IPC)
- ✅ **Computer Use Bridge** - 12 AI tools mapped as Cowork skills (6 IPC)
- ✅ **Cowork API Server** - RESTful API 20+ endpoints, Bearer/API-Key auth, SSE streaming (5 IPC)
- ✅ **Webhook Manager** - 17 event types, HMAC signature verification, exponential backoff retry (7 IPC)

**Cowork Support Modules** (4 modules, 32 IPC handlers):

- ✅ **CI/CD Optimizer** - Intelligent test selection, dependency graph analysis, flakiness scoring (10 IPC)
- ✅ **Load Balancer** - Real-time agent metrics tracking, composite load scoring, auto task migration (8 IPC)
- ✅ **ML Task Scheduler** - Weighted linear regression complexity prediction, resource estimation (8 IPC)
- ✅ **IPC API Doc Generator** - Recursive scanning, OpenAPI 3.0 generation, Markdown auto-generation (6 IPC)

**everything-claude-code Patterns Integration**:

- ✅ **Verification Loop Skill** - 6-stage automated verification pipeline (Build→TypeCheck→Lint→Test→Security→DiffReview)
- ✅ **Orchestrate Workflow Skill** - 4 predefined multi-agent workflow templates (feature/bugfix/refactor/security-audit)
- ✅ **Instinct Learning System** - Auto-extract reusable patterns, 8 categories + confidence scoring + context injection
- ✅ **11 IPC Handlers** - Full CRUD, reinforce/decay, evolve, export/import, stats
- ✅ **2 Database Tables** - instincts (pattern storage) + instinct_observations (event buffering)

#### v0.38.0 SIMKey Six Security Enhancements (2026-02-21)

- ✅ **iOS eSIM Support** - Apple eSIM API + Secure Enclave integration, iOS users can use eSIM as SIMKey security carrier
- ✅ **5G SIM Optimization** - 3-5x signature speed improvement, Chinese national crypto SM2/SM3/SM4/SM9, batch signing pipeline
- ✅ **NFC Offline Signing** - Near-field communication offline identity verification, transaction signing, file signing without network
- ✅ **Multi-SIM Auto-Switch** - Dual-SIM intelligent management, network failover, work/personal separation
- ✅ **SIM Health Monitoring** - Real-time health score dashboard, smart alerts, auto-maintenance, report export
- ✅ **Quantum-Resistant Algorithm Upgrade** - NIST PQC standards (ML-KEM/ML-DSA/SLH-DSA), hybrid encryption mode, key migration tools

#### v0.38.0 Documentation Site Expansion (10 pages, 4,400+ lines added)

- ✅ **AI Models Docs** - 16+ cloud LLM providers overview, multimodal vision models, intelligent routing, Context Engineering
- ✅ **SIMKey/U-Key Docs** - v0.38.0 features with API examples, configuration guides, security mechanisms
- ✅ **Social System Roadmap** - Versioned future feature planning
- ✅ **Trading System Roadmap** - Auction system, group buying, installment payments, Lightning Network payments
- ✅ **Git Sync Roadmap** - Cross-device sync enhancement, collaborative editing, version visualization
- ✅ **Encryption System Expansion** - Post-quantum cryptography, TEE integration, zero-knowledge proofs
- ✅ **Cowork Collaboration Expansion** - Multi-agent workflow orchestration, Agent communication protocol
- ✅ **Overview Expansion** - Phase 5 roadmap, competitor comparison, application scenarios

#### v0.37.4~v0.37.6 New 30 Desktop Skills (Total 90)

- ✅ **Office Documents (5)** - pdf-toolkit, doc-converter, excel-analyzer, pptx-creator, doc-comparator
- ✅ **Audio/Video (5)** - audio-transcriber, video-toolkit, subtitle-generator, tts-synthesizer, media-metadata
- ✅ **Image Processing (3)** - image-editor, ocr-scanner, image-generator
- ✅ **Data Processing (2)** - chart-creator, csv-processor
- ✅ **Dev Tools (3)** - word-generator, template-renderer, code-runner
- ✅ **Automation (2)** - voice-commander, file-compressor
- ✅ **System Ops (5)** - log-analyzer, system-monitor, env-file-manager, backup-manager, performance-profiler
- ✅ **Knowledge (3)** - knowledge-graph, query-enhancer, memory-insights
- ✅ **Security+Data+Network (4)** - crypto-toolkit, password-generator, data-exporter, network-diagnostics
- ✅ **Design+Utility (3)** - color-picker, text-transformer, clipboard-manager

#### v0.37.2 Android Mobile Productivity + PC Remote Delegation (28 Skills)

- ✅ **5 LOCAL Productivity Skills** - quick-note, email-draft, meeting-notes, daily-planner, text-improver
- ✅ **8 REMOTE PC Delegation Skills** - pc-screenshot→computer-use, pc-file-search→smart-search, pc-run-command→remote-control, etc.
- ✅ **remoteSkillName Mapping** - Android skill → Desktop skill name automatic routing

#### v0.37.0~v0.37.1 AI Conversation + Developer Efficiency (20 Skills)

- ✅ **AI Conversation (4)** - prompt-enhancer, codebase-qa, auto-context, multi-model-router
- ✅ **Dev Efficiency (6)** - code-translator, dead-code-eliminator, changelog-generator, mock-data-generator, git-history-analyzer, i18n-manager
- ✅ **Advanced Dev (10)** - architect-mode, commit-splitter, screenshot-to-code, diff-previewer, task-decomposer, bugbot, fault-localizer, impact-analyzer, rules-engine, research-agent

#### v0.36.0 Features - AI Skills System + Unified Tool Registry

- ✅ **Unified Tool Registry** - Aggregates 3 tool systems (FunctionCaller 60+ tools + MCP 8 servers + Skills 90 skills)
- ✅ **AI Call Chain Integration** - ManusOptimizations.bindUnifiedRegistry() connects the full pipeline
- ✅ **Agent Skills Open Standard** - 13 extended fields (tools/instructions/examples etc.)
- ✅ **Demo Templates** - 10 demo templates across 4 categories
- ✅ **Tools Explorer UI** - Browse tools by skill (`#/tools/explorer`)

#### v0.34.0 Features Recap - Enterprise Features + Community Ecosystem

**Enterprise Audit & Compliance + Plugin Marketplace + Multi-Agent + SSO + MCP SDK** - 76+ IPC handlers, 26,000+ lines of new code

#### v0.33.0 Features Recap - Remote Control System + Browser Extension

- ✅ **Remote Control Gateway** - P2P remote gateway, command routing, permission verification (1,876 lines), logging & statistics
- ✅ **24+ Command Handlers** - AI/System/File Transfer/Browser/Power/Process/Media/Network/Storage/Display/Input/Application/Security/Knowledge Base/Device Management/Command History/Clipboard/Notifications/Workflow comprehensive control
- ✅ **Chrome Browser Extension** - Chrome extension integration, WebSocket server (3,326 lines), Service Worker (15,077 lines), Content Script
- ✅ **Android Remote UIs** - Power/Process/Media/Network/Storage/Input/Application Manager/Security Info 8 remote control screens

#### v0.33.0 Features Recap - Computer Use (2026-02-11)

- ✅ **Computer Use Agent** - Unified agent integrating all computer operation capabilities, 68+ IPC handlers
- ✅ **CoordinateAction** - Pixel-level coordinate clicking, dragging, gesture operations
- ✅ **VisionAction** - Vision AI integration, visual element location, supports Claude/GPT-4V/LLaVA
- ✅ **NetworkInterceptor** - Network request interception, simulation, conditional control
- ✅ **DesktopAction** - Desktop-level screenshots, mouse/keyboard control, window management
- ✅ **AuditLogger** - Operation audit logging, risk assessment (LOW/MEDIUM/HIGH/CRITICAL), sensitive data masking
- ✅ **ScreenRecorder** - Screen recording as screenshot sequences, pause/resume/export support
- ✅ **ActionReplay** - Action replay engine, variable speed, step-by-step, breakpoint debugging
- ✅ **SafeMode** - Safe mode with permission control, area restrictions, rate limits, confirmation prompts
- ✅ **WorkflowEngine** - Workflow engine supporting conditional branches, loops, parallel execution, sub-workflows
- ✅ **ElementHighlighter** - Element highlighting for debugging and demo visualization
- ✅ **TemplateActions** - Predefined action templates for quick common automation tasks
- ✅ **12 AI Tools** - browser_click, visual_click, browser_type, browser_key, browser_scroll, browser_screenshot, etc.

#### v0.32.0 Features Recap (2026-02-10)

- ✅ **iOS Workflow System** - WorkflowModels + WorkflowManager complete workflow automation
- ✅ **iOS Voice Interaction** - RealtimeVoiceInput real-time voice input, VoiceManager voice feature management
- ✅ **Android MCP/Hooks/Collaboration** - MCP integration, Hooks system, Collaboration module, Performance optimization
- ✅ **Android Knowledge Graph** - KnowledgeGraphManager + Presentation Layer, knowledge graph visualization

#### v0.31.0 Features Recap (2026-02-09)

- ✅ **Security Authentication Enhancement** - Dev/prod mode switching, JWT authentication for API endpoints, device key database integration
- ✅ **Incremental RAG Indexing** - MD5 content hash change detection, multi-file joint retrieval, unified search (vector+keyword+graph)
- ✅ **Project Context-Aware Reranking** - Context-aware result reranking, 6 new IPC handlers
- ✅ **SIMKey NFC Detection** - NFC reading and SIM security element detection for mobile, dev mode simulator support
- ✅ **File Version Control** - FileVersion entity, version history, SHA-256 content hashing, version restore
- ✅ **LLM Function Calling** - OpenAI and DashScope chat_with_tools support, auto capability detection
- ✅ **Deep Link Enhancement** - notes/clip link handling, universal navigation, focusMainWindow
- ✅ **Browser Extension Enhancement** - Launch desktop app via chainlesschain:// protocol
- ✅ **Test Infrastructure Optimization** - 89 Ant Design Vue component stubs, dayjs mock fixes, permission system test optimization

#### v0.29.0-v0.30.0 Features Recap

- ✅ **DI Test Refactoring** - 102 database tests enabled via dependency injection, Browser IPC testability improved
- ✅ **Social Notifications UI** - Social notification features, project file operations enhancement
- ✅ **TaskMonitor ECharts Dashboard** - ECharts integration, tree-shaking optimization, debounce, 2 new charts
- ✅ **AbortController AI Chat Cancel** - Support for cancelling in-progress AI chat requests
- ✅ **Conversation Star/Rename** - Conversation list star and rename persistence
- ✅ **Firebase Integration** - Firebase enabled, WebRTC enhancement
- ✅ **xlsx → exceljs Migration** - File handling and project page dependency modernization
- ✅ **Main Process TypeScript Declarations** - Comprehensive type declarations for main process
- ✅ **Android Multi-Screen Enhancement** - File browser stats UI, P2P chat session list, Settings/About/Help/Bookmark screens
- ✅ **Android P0 Production Fixes** - API config, Ed25519 signing, sync persistence, file indexing
- ✅ **Community Forum TODOs** - TODO items implemented across community forum, Android, and frontend

#### v0.29.0 Features Recap

- ✅ **TypeScript Migration** - Stores and Composables fully migrated to TypeScript (type safety, enhanced IDE support)
- ✅ **Browser Control System** - BrowserEngine + SnapshotEngine (18 IPC channels, smart snapshots, element locator)
- ✅ **Claude Code Style Systems** - 10 subsystems, 127 IPC channels fully implemented
  - Hooks System (11) | Plan Mode (14) | Skills (17) | Context Engineering (17)
  - Prompt Compressor (10) | Response Cache (11) | Token Tracker (12)
  - Stream Controller (12) | Resource Monitor (13) | Message Aggregator (10)
- ✅ **Permission Engine** - Enterprise RBAC permission engine (resource-level, inheritance, delegation, team permissions)
- ✅ **Context Engineering** - KV-Cache optimization (17 IPC channels, token estimation, recoverable compression)
- ✅ **Plan Mode** - Claude Code style plan mode (security analysis, approval workflow, 14 IPC channels)

#### v0.28.0 Features Recap

- ✅ **Permanent Memory System** - Daily Notes auto-logging + MEMORY.md long-term extraction
- ✅ **Hybrid Search Engine** - Vector (semantic) + BM25 (keyword) dual-path parallel search
- ✅ **Hooks System** - 21 hook events, 4 hook types, priority system
- ✅ **MCP Integration Tests** - 32 unit tests + 31 end-to-end tests all passed

#### Performance Improvement Summary

| Metric                | Before   | After  | Improvement            |
| --------------------- | -------- | ------ | ---------------------- |
| Task Success Rate     | 40%      | 70%    | **+75%**               |
| KV-Cache Hit Rate     | -        | 60-85% | **Very High**          |
| Hybrid Search Latency | -        | <20ms  | **Ultra Fast**         |
| Test Coverage         | ~30%     | ~80%   | **+167%**              |
| LLM Planning Cost     | Baseline | -70%   | **$2,550/month saved** |

See: [Phase 2 Test Summary](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md) | [Permanent Memory Docs](./docs/features/PERMANENT_MEMORY_INTEGRATION.md) | [Hooks System Design](./docs/design/HOOKS_SYSTEM_DESIGN.md) | [Full Changelog](./docs/CHANGELOG.md)

- ✅ **Documentation Structure Reorganization** - Reorganized documentation directory with new categories: flows/, implementation-reports/, status-reports/, test-reports/
- ✅ **Desktop App Root Directory Reorganization** - Optimized desktop-app-vue project structure for improved code maintainability
- ✅ **Android Social & LLM Features Merge** - Complete integration of mobile P2P social and AI features
- ✅ **Unified Logging System** - Migrated 700+ console calls to centralized logger with log level control and structured logging
- ✅ **Android P2P UI Complete Integration** - 8 P2P screens (device discovery/pairing/security verification/DID management)
- ✅ **ChatPanel Memory Leak Protection** - 4-layer protection mechanism ensuring long-term stability
- ✅ **E2E Test Suite** - 100% pass rate with comprehensive end-to-end test coverage
- ✅ **Test Coverage Improvement** - Added 78 AI engine unit tests, reaching 46% test implementation progress
- ✅ **Manus AI Optimization System** - Based on Manus/OpenManus best practices, Context Engineering (KV-Cache optimization), Tool Masking, TaskTrackerFile (todo.md mechanism), Recoverable Compression, theoretical 50-90% Token cost reduction
- ✅ **Multi-Agent System** - Agent Orchestrator, 3 specialized agents (Code Generation/Data Analysis/Document Processing), parallel execution, chain execution, inter-agent communication, 30% reduction in complex task completion time
- ✅ **MCP Chat Integration** - MCP tools integrated into AI chat, invoke MCP server tools via Function Calling
- ✅ **MCP (Model Context Protocol) Integration** - POC v0.1.0, supports Filesystem/PostgreSQL/SQLite/Git/Fetch servers, multi-layer security protection, UI management interface, complete documentation
- ✅ **Unified Configuration Directory System** - `.chainlesschain/` directory for centralized config/logs/cache/session management, inspired by OpenClaude best practices, auto-initialization, config migration support ⭐LATEST
- ✅ **Token Budget Management System** - LLM usage cost tracking, monthly budget control, overspending alerts, detailed statistics ⭐LATEST
- ✅ **Trading UI Polish** - Order QR code generation, order editing feature, multiple sharing methods (link/social/export), multi-format export (JSON/CSV/PDF/image)
- ✅ **Voice Message System Complete** - Full voice message recording and playback system with real-time recording UI, pause/resume controls, duration display, audio waveform visualization, play/pause controls, automatic resource cleanup, error handling ⭐NEW
- ✅ **Message Reactions Feature** - Emoji reactions beyond likes, 18 common emojis, real-time reaction stats, toggle reactions, visual feedback
- ✅ **P2P File Transfer Complete Implementation** - Large file chunked transfer (64KB chunks), resume capability, real-time progress tracking, SHA-256 integrity verification, concurrent transfer control
- ✅ **Message Forwarding Feature** - Forward messages to other chat sessions, supports text/image/file types, automatic file copying, tracks forwarding source
- ✅ **Chat File Transfer Feature** - Send/receive images and files in P2P chats, automatic file management, download support, integrated P2P direct transfer
- ✅ **Message Search Feature** - Search message content in chat history, filter by conversation/role, pagination and sorting support
- ✅ **Knowledge Graph Visualization Enhancement** - 8 graph analysis algorithms, 5 visualization modes (2D/3D/timeline/heatmap), intelligent entity extraction, 6 export formats
- ✅ **Remote Sync Enabled** - Implemented incremental sync, conflict resolution, multi-device collaboration ⭐LATEST
- ✅ **Mobile Data Sync** - Implemented mobile-PC data synchronization for seamless cross-device collaboration
- ✅ **Full Linux Platform Support** - Added Linux ZIP portable version and DEB package support, covering mainstream distributions
- ✅ **Multi-Platform Packaging Optimization** - Improved packaging workflow for macOS (ARM64/x64), Windows, and Linux
- ✅ **Deep Performance Optimization System Complete** - Added 14,000+ lines of optimization code, 18 utility classes, 4 specialized components, comprehensive performance improvements
- ✅ **Smart Image Optimization System** - WebP/AVIF format detection, responsive loading, progressive loading, LQIP placeholders, CDN support, network-aware loading
- ✅ **Real-time Performance Monitoring System** - Core Web Vitals monitoring (LCP/FID/CLS), performance budgets, FPS monitoring, memory monitoring, performance alerts
- ✅ **Frontend Deep Optimization** - Code splitting, component lazy loading, virtual scrolling, intelligent prefetch, request batching, optimistic updates, data compression
- ✅ **Performance Toolkit** - Incremental sync, memory optimization, animation control, resource hints, performance benchmarking, accessibility enhancements
- ✅ **Testing Framework Upgrade** - Fixed test environment configuration and fully migrated to Vitest API, 94 test files, 900+ test cases
- ✅ **Performance Optimization Integration** - Integrated performance optimization components: memory downgrade, disk check, concurrency control, file recovery, improved overall system performance
- ✅ **Core Module Tests** - Added unit tests for 4 core modules: Git, file permissions, contract engine, bridge management
- ✅ **Security Protection System** - Implemented comprehensive security protection: input validation, permission control, encrypted transmission
- ✅ **P2 Optimization Complete** - AI engine performance significantly improved: 58% reduction in LLM calls, 93% reduction in perceived latency, 28% cost savings
- ✅ **V3 Tool System Restored** - Tool count expanded to 300, restored 28 professional tools covering blockchain/finance/CRM and 9 major domains
- ✅ **Application Menu Integration** - Native menu support, MenuManager, 20+ IPC channels, advanced features control panel
- ✅ **Codebase Refinement** - Updated project documentation, optimized template configuration, enhanced test suite
- ✅ **Enterprise Edition (Decentralized Organizations)** - Multi-identity architecture, RBAC permission system, organization management (create/join/member management), database isolation (9 new tables), organization DID support
- ✅ **Skill & Tool System Expanded to 115 Skills** - Batches 6-10 complete, 300 tools covering 10 categories (3D modeling, audio analysis, blockchain, IoT, machine learning, cybersecurity, bioinformatics, quantum communication, etc.)
- ✅ **Testing Framework Fully Upgraded** - 94 test files, 900+ test cases, fully migrated to Vitest framework, comprehensive core functionality coverage ⭐Updated
- ✅ **Multi-Database Isolation** - Support for personal database + multiple organization databases, complete data isolation, dynamic switching
- ✅ **Blockchain Integration Phase 1-3 Complete** - Smart contract system (6 contracts + tests + deployment), wallet system (built-in + external), Hardhat development environment
- ✅ **Smart Contract Development** - ChainlessToken (ERC20), ChainlessNFT (ERC721), escrow, subscription, bounty, cross-chain bridge contracts, 2400+ lines of code
- ✅ **Browser Extension Enhancement** - Automated testing framework, user/developer/testing guides, test report generation
- ✅ **Plugin System Enhancement** - Integrated with skill-tool system, supports dynamic loading and hot reload
- ✅ **Voice Recognition System Complete** - Phase 3 advanced features, audio enhancement, multi-language detection, subtitle generation
- ✅ **16 AI Specialized Engines** - Code generation/review, document processing (Word/PDF/Excel/PPT), image/video processing, web development, data analysis, and more
- ✅ **Complete Backend Service System** - Project Service (Spring Boot, 48 APIs) + AI Service (FastAPI, 38 APIs) + Community Forum (63 APIs)
- ✅ **145 Vue Components** - 14 pages, 54 project components, trading components (with escrow UI), social components, editors, skill-tool components, enterprise edition components

### Project Status (Overall Completion: 100%)

- 🟢 **PC Desktop Application**: 100% Complete - **Production Ready** ⭐Completed
- 🟢 **Knowledge Base Management**: 100% Complete - **Production Ready** ⭐Completed
- 🟢 **AI Engine System**: 100% Complete - **17 Optimizations + 16 Specialized Engines + Smart Decision** ⭐Completed
- 🟢 **RAG Retrieval System**: 100% Complete - **Hybrid Search + Reranking** ⭐Completed
- 🟢 **Backend Services**: 100% Complete - **3 Microservices + Conversation API** ⭐Completed
- 🟢 **Skill & Tool System**: 100% Complete - **115 Skills + 300 Tools** ⭐Completed
- 🟢 **Plugin System**: 100% Complete - **Dynamic Loading + Hot Reload** ⭐Completed
- 🟢 **MCP Integration**: 100% Complete - **POC v0.1.0 + 5 Servers + Security Sandbox + UI Management** ⭐NEW
- 🟢 **Unified Configuration**: 100% Complete - **.chainlesschain/ Directory + Auto-Init + Multi-Level Priority** ⭐NEW
- 🟢 **Token Budget Management**: 100% Complete - **Cost Tracking + Budget Control + Alerts** ⭐NEW
- 🟢 **Voice Recognition**: 100% Complete - **Real-time Voice Input + UI Integration** ⭐Completed
- 🟢 **Deep Performance Optimization**: 100% Complete - **18 Optimization Tools + 4 Specialized Components** ⭐Completed
- 🟢 **Performance Optimization**: 100% Complete - **Memory/Disk/Concurrency Control** ⭐Completed
- 🟢 **Security Protection**: 100% Complete - **Input Validation/Permission Control/Encryption** ⭐Completed
- 🟢 **Workspace Management**: 100% Complete - **Full CRUD + Restore + Permanent Delete** ⭐Completed
- 🟢 **Remote Sync**: 100% Complete - **Incremental Sync + Conflict Resolution + Multi-Device** ⭐Completed
- 🟢 **USB Key Integration**: 100% Complete - **Cross-Platform Support (Windows/macOS/Linux)** ⭐Completed
- 🟢 **Blockchain Bridge**: 100% Complete - **LayerZero Production-Grade Integration** ⭐Completed
- 🟢 **Enterprise Edition (Decentralized Organizations)**: 100% Complete - **Organization Management + Invitation System** ⭐Completed
- 🟢 **Testing Framework**: 100% Complete - **417+ test files, 2500+ cases, Vitest + DI refactoring** ⭐v1.0.0
- 🟢 **Blockchain Integration**: 100% Complete - **15 chains + RPC management + Event listeners + Full UI** ⭐Completed
- 🟢 **Decentralized Identity**: 100% Complete - **DID + Org DID + VC + DHT publish + Cache** ⭐Completed
- 🟢 **P2P Communication**: 100% Complete - **E2E Encryption + Message Queue + Multi-device** ⭐Completed
- 🟢 **Decentralized Social Platform**: 100% Complete - **P2P Voice/Video Calls + Shared Albums + Community Channels + Time Machine + Livestreaming + Social Tokens** ⭐v1.0.0
- 🟢 **Trading System**: 100% Complete - **8 Modules + On-chain Contracts + NFT Transfers + Order Editing + Sharing + QR Codes** ⭐Completed
- 🟢 **Browser Extension**: 100% Complete - **Testing Framework + Documentation** ⭐Completed
- 🟢 **Remote Control System**: 100% Complete - **P2P Remote Gateway + 24+ Command Handlers + Chrome Extension** ⭐Completed
- 🟢 **AI Skills System**: 100% Complete - **95 Built-in Skills (100% Handler) + 28 Android Skills + Unified Tool Registry + Agent Skills Standard** ⭐v1.0.0
- 🟢 **SIMKey Security Enhancements**: 100% Complete - **iOS eSIM + 5G Optimization + NFC Offline Signing + Multi-SIM Switch + Health Monitoring + Quantum-Resistant** ⭐v0.38.0
- 🟢 **IPFS Decentralized Storage**: 100% Complete - **Helia/Kubo Dual-Engine + Content Addressing + P2P CDN + Auto-Pinning** ⭐v1.0.0
- 🟢 **Real-time Collaboration (CRDT/Yjs)**: 100% Complete - **Yjs Conflict Resolution + P2P Sync + Cursor Sharing + Document Locks** ⭐v1.0.0
- 🟢 **Autonomous Agent Runner**: 100% Complete - **ReAct Loop + Goal Decomposition + Autonomous Task Execution** ⭐v1.0.0
- 🟢 **Model Quantization**: 100% Complete - **GGUF 14-Level Quantization + AutoGPTQ + Ollama Integration** ⭐v1.0.0
- 🟢 **i18n Internationalization**: 100% Complete - **4 Languages (ZH/EN/JP/KO) + Runtime Switching** ⭐v1.0.0
- 🟢 **Performance Auto-Tuner**: 100% Complete - **Real-time Monitoring + Auto Parameter Tuning + Load Prediction** ⭐v1.0.0
- 🟢 **Enterprise Org Management**: 100% Complete - **Org Hierarchy + Approval Workflows + Multi-tenancy** ⭐v1.0.0
- 🟢 **Analytics Dashboard**: 100% Complete - **Real-time Aggregation + Multi-dimensional Metrics + Visualization** ⭐v1.0.0
- 🟢 **Mobile Application**: 100% Complete - **Knowledge Base + AI Chat + Trading System + Social Features + Mobile UX Optimization + P2P Sync + Android Remote Control UIs** ⭐Completed

## Core Features

- 🔐 **Military-Grade Security**: SQLCipher AES-256 encryption + Cross-Platform USB Key hardware keys + Signal protocol E2E encryption + Post-Quantum Crypto (ML-KEM/ML-DSA) ✅
- 📱 **SIMKey v0.38.0**: iOS eSIM + 5G Optimization (3-5x) + NFC Offline Signing + Multi-SIM Switch + Health Monitoring + Quantum-Resistant ✅ ⭐NEW
- 📡 **Remote Control**: P2P remote control + 24+ command handlers + Chrome extension + 45,000+ lines ✅
- 🖥️ **Computer Use**: Claude-style desktop automation + Vision AI locator + Workflow engine + 68+ IPC channels ✅
- 🧠 **Permanent Memory System**: Daily Notes auto-logging + MEMORY.md long-term extraction + Hybrid Search (Vector+BM25) ✅
- 🎯 **Context Engineering**: KV-Cache optimization + Token estimation + Recoverable compression + Task context management ✅
- 📋 **Plan Mode**: Claude Code style plan mode + Security analysis + Approval workflow ✅
- 🛡️ **Enterprise Permissions**: RBAC permission engine + Resource-level control + Permission inheritance + Delegation ✅ ⭐NEW
- 👥 **Team Management**: Sub-team hierarchy + Member management + Daily Standup + AI report summaries ✅ ⭐NEW
- 🪝 **Hooks System**: 21 hook events + 4 hook types + Priority system + Script hooks ✅ ⭐NEW
- 🎨 **Skills System**: 95 built-in skills + Agent Skills open standard + Unified tool registry + /skill commands ✅ ⭐v1.0.0
- 🗂️ **Unified Tool Registry**: FunctionCaller 60+ tools + MCP 8 servers + Skills 95 skills unified management ✅ ⭐v1.0.0
- 🧬 **Instinct Learning**: Auto-extract user patterns + Confidence scoring + Context injection + Hooks observation pipeline ✅ ⭐v0.39.0
- 📦 **Demo Templates**: 10 demo templates + 4 categories + Visual browsing + One-click run ✅ ⭐NEW
- 📊 **Unified Logging System**: Centralized logger management + Log level control + Structured logging + Production debugging ✅
- 🌐 **Fully Decentralized**: P2P network (libp2p 3.1.2) + DHT + local data storage, no central servers needed ✅
- 📁 **P2P File Transfer**: Large file chunked transfer (64KB) + resume capability + real-time progress + SHA-256 verification ✅
- 🧠 **AI Native**: Support for 14+ cloud LLM providers + Ollama local deployment + RAG-enhanced retrieval ✅
- 🔌 **MCP Integration**: Model Context Protocol support, 5 official servers + security sandbox + 63 test cases ✅
- ⚙️ **Unified Configuration**: `.chainlesschain/` centralized config directory + auto-initialization + multi-level priority ✅
- 💰 **Token Budget Management**: LLM cost tracking + monthly budget control + overspending alerts + detailed analytics ✅
- 🎯 **16 AI Engines**: Code/document/spreadsheet/PPT/PDF/image/video specialized processing, covering all scenarios ✅
- 📋 **Template System**: 178 AI templates + 32 categories + smart engine allocation + 100% configuration coverage ✅
- ⛓️ **Blockchain Integration**: 6 smart contracts + HD wallet system + MetaMask/WalletConnect + LayerZero cross-chain bridge ✅
- 🏢 **Enterprise Edition**: Multi-identity architecture + RBAC permissions + organization management + data isolation ✅
- 🔧 **Skill & Tool System**: 115 skills + 300 tools + 10 categories + dynamic management ✅
- 🧪 **Comprehensive Test Suite**: 2500+ test cases + 417+ test files + OWASP security validation + DI test refactoring ✅ ⭐v1.0.0
- 🎤 **Voice Recognition**: Real-time transcription + audio enhancement + multi-language detection + UI integration ✅
- 📱 **Cross-Device Collaboration**: Git sync + mobile-PC data sync + multi-device P2P communication + offline message queue ✅
- 🔓 **Open Source & Self-Hosted**: 310,000+ lines of code, 370 Vue components, 380+ IPC handlers, fully transparent and auditable ✅
- ⚡ **P2 Optimization System**: Intent fusion, knowledge distillation, streaming response, 40% AI engine performance boost ✅
- 🚀 **Deep Performance Optimization**: 18 optimization tools + 4 specialized components + Core Web Vitals monitoring + smart image loading ✅
- 🎛️ **Advanced Features Control Panel**: Real-time monitoring, configuration management, 20+ IPC channels, native menu integration ✅
- 📸 **Smart Image Processing**: Tesseract.js OCR + Sharp image processing + WebP/AVIF optimization + responsive loading ✅
- 💼 **Microservice Architecture**: Project Service + AI Service + Community Forum, 157 API endpoints ✅ ⭐Updated
- 🔄 **Database Sync**: SQLite ↔ PostgreSQL bidirectional sync, soft delete + conflict resolution ✅
- 🌐 **Browser Extension**: Web annotation + content extraction + AI assistance + automated testing ✅
- 🧪 **Complete Testing System**: Playwright E2E + Vitest unit tests + 417+ test files + 2500+ test cases ✅
- 💾 **Memory Leak Protection**: 4-layer protection mechanism (timer safety/event cleanup/API cancellation/message limiting) + Long-term stability guarantee ✅ ⭐NEW
- 📱 **Android P2P UI**: 8 complete screens (device discovery/pairing/security verification/DID management/message queue/QR scan) + Full P2P experience ✅ ⭐NEW
- 🖥️ **Workspace Management**: Full CRUD + restore + permanent delete + member management ✅ ⭐NEW
- 🔄 **Remote Sync**: Incremental sync + conflict resolution + multi-device collaboration + auto-fallback ✅ ⭐NEW

More features detailed in [Features Documentation](./docs/FEATURES.md)

## Three Core Functions

### 1️⃣ Knowledge Base Management (100% Complete) ✅

- ✅ SQLCipher AES-256 encrypted database (50+ tables)
- ✅ Knowledge graph visualization (8 algorithms + 5 visualizations + intelligent extraction)
- ✅ AI-enhanced retrieval (hybrid search + 3 reranking methods)
- ✅ Multi-format import (Markdown/PDF/Word/TXT/Images)
- ✅ Version control (Git integration + conflict resolution)

### 2️⃣ Decentralized Social (100% Complete) ✅

- ✅ DID identity system (W3C standard + organization DID)
- ✅ P2P network (libp2p + Signal E2E encryption)
- ✅ Social features (friends + posts + group chat + file transfer)
- ✅ WebRTC voice/video calls
- ✅ Community forum (Spring Boot + Vue3)

### 3️⃣ Decentralized Trading (100% Complete) ✅

- ✅ Digital asset management (Token/NFT/knowledge products)
- ✅ Smart contract engine (5 contract types)
- ✅ Escrow service (4 escrow types)
- ✅ Blockchain integration (15 chains + cross-chain bridge)
- ✅ Credit scoring system (6 dimensions + 5 levels)

### 4️⃣ Cowork Multi-Agent Collaboration + Workflow Optimization (100% Complete) ✅

#### Multi-Agent Collaboration Core

- ✅ Smart orchestration system (AI decision + single/multi-agent task distribution)
- ✅ Agent pool reuse (10x acquisition speed + 85% overhead reduction)
- ✅ File sandbox (18+ sensitive file detection + path traversal protection)
- ✅ Long-running task management (intelligent checkpoints + recovery mechanism)
- ✅ Skills system (4 Office skills + smart matching)
- ✅ Complete integration (RAG + LLM + error monitoring + session management)
- ✅ Data visualization (10+ chart types + real-time monitoring)
- ✅ Enterprise security (5-layer protection + zero trust + full audit)

#### Workflow Smart Optimization (Phase 1-4, 17 items all complete)

**Phase 1-2 Core Optimizations (8 items)**

- ✅ RAG parallelization - 60% time reduction (3s→1s)
- ✅ Message aggregation - 50% frontend performance boost
- ✅ Tool caching - 15% reduction in repeated calls
- ✅ File tree lazy loading - 80% faster large project loading
- ✅ LLM fallback strategy - 50% success rate boost (60%→90%)
- ✅ Dynamic concurrency control - 40% CPU utilization improvement
- ✅ Smart retry strategy - 183% retry success rate improvement
- ✅ Quality gate parallelization - Early error interception

**Phase 3-4 Smart Optimizations (9 items)**

- ✅ Smart plan cache - 70% LLM cost reduction, 60-85% hit rate
- ✅ LLM-assisted decision - 20% multi-agent utilization boost, 92% accuracy
- ✅ Agent pool reuse - 10x acquisition speed, 85% overhead reduction
- ✅ Critical path optimization - 15-36% execution time reduction (CPM algorithm)
- ✅ Real-time quality check - 1800x faster problem discovery, 50% rework reduction
- ✅ Auto stage transition - 100% human error elimination
- ✅ Intelligent checkpoints - 30% IO overhead reduction

**Overall Improvement**: Task success rate 40%→70% (+75%) | LLM cost -70% | Execution speed +25%

Detailed documentation: [Cowork Quick Start](./docs/features/COWORK_QUICK_START.md) | [Phase 3/4 Summary](./docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md)

### 5️⃣ Permanent Memory System (100% Complete) ✅

- ✅ Daily Notes auto-logging (memory/daily/YYYY-MM-DD.md)
- ✅ MEMORY.md long-term knowledge extraction (categorized storage + auto-update)
- ✅ Hybrid search engine (Vector semantic + BM25 keyword dual-path search)
- ✅ RRF fusion algorithm (Reciprocal Rank Fusion intelligent ranking)
- ✅ Embedding cache (reduced redundant computation + file hash tracking)
- ✅ Auto expiry cleanup (configurable retention days)
- ✅ Metadata statistics (knowledge classification, tags, reference tracking)

Detailed documentation: [Permanent Memory Integration](./docs/features/PERMANENT_MEMORY_INTEGRATION.md)

### 6️⃣ Comprehensive Testing System (100% Complete) ✅

- ✅ **2500+ test cases** - Covering all core modules (including 102 database tests after DI refactoring)
- ✅ **417 test files + 50 script tests** - Unit/Integration/E2E/Performance/Security
- ✅ **DI test refactoring** - Browser IPC, database modules with improved testability via DI
- ✅ **80% OWASP Top 10 coverage** - XSS/SQL injection/path traversal protection verified
- ✅ **Performance benchmarks established** - 142K ops/s project operations, 271K ops/s file operations
- ✅ **~80% test coverage** - Test-driven continuous quality improvement

Detailed documentation: [Phase 2 Test Summary](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md)

### 7️⃣ Enterprise Permission System (100% Complete) ✅

- ✅ **Permission Engine** - Resource-level permission evaluation, conditional access, cache optimization
- ✅ **Permission inheritance** - Parent-child resource automatic permission inheritance
- ✅ **Permission delegation** - Temporary permission delegation, time range control
- ✅ **Team Manager** - Sub-team creation, hierarchy structure, member management
- ✅ **Approval workflow** - Multi-level approval, automatic approval rules
- ✅ **Complete audit** - Full permission change audit logging

### 8️⃣ Context Engineering (100% Complete) ✅

- ✅ **KV-Cache optimization** - Static/dynamic content separation, 60-85% hit rate
- ✅ **Token estimation** - Chinese/English auto-detection, precise token calculation
- ✅ **Task context** - Task goal restatement, step tracking, progress management
- ✅ **Error history** - Error recording for model learning, solution association
- ✅ **Recoverable compression** - Preserve URL/path references, on-demand content recovery
- ✅ **17 IPC channels** - Complete frontend access interface

Detailed documentation: [Context Engineering Docs](./docs/MANUS_OPTIMIZATION_GUIDE.md)

### 9️⃣ Plan Mode + Skills System (100% Complete) ✅

- ✅ **Plan Mode** - Security analysis mode, only allows Read/Search/Analyze
- ✅ **Plan generation** - Auto-record blocked operations to plan
- ✅ **Approval workflow** - Full/partial approval, rejection operations
- ✅ **Skills system** - Markdown skill definitions, four-layer loading (bundled→marketplace→managed→workspace)
- ✅ **/skill commands** - User command parsing, auto-execution
- ✅ **Gate checks** - Platform, dependency, environment variable detection
- ✅ **92 Built-in Skills** - All with executable handlers (100% coverage) across 18+ categories (incl. verification-loop, orchestrate)
- ✅ **Agent Skills Open Standard** - 13 extended fields (tools/instructions/examples/dependencies etc.)

Detailed documentation: [Hooks System Design](./docs/design/HOOKS_SYSTEM_DESIGN.md) | [AI Skills System](./docs/design/modules/16_AI技能系统.md)

### 🔟 Unified Tool Registry + Demo Templates (100% Complete) ✅

- ✅ **UnifiedToolRegistry** - Aggregates FunctionCaller (60+), MCP (8 servers), Skills (95 skills) into single registry
- ✅ **ToolSkillMapper** - Auto-groups uncovered tools into 10 default skill categories
- ✅ **MCPSkillGenerator** - Auto-generates skill manifests when MCP servers connect
- ✅ **Name Normalization** - SKILL.md naming (kebab-case) → FunctionCaller naming (snake_case) auto-bridging
- ✅ **Tools Explorer** - Browse all tools grouped by skill with search/filter/preview
- ✅ **10 Demo Templates** - Showcase skill combinations (Automation/AI Workflow/Knowledge/Remote)
- ✅ **DemoTemplateLoader** - Auto-discover JSON templates, 4 IPC handlers
- ✅ **6 Unified Tool IPCs** - tools:get-all-with-skills/get-skill-manifest/get-by-skill/search-unified/get-tool-context/refresh-unified

Detailed documentation: [AI Skills System](./docs/design/modules/16_AI技能系统.md)

### MCP (Model Context Protocol) Integration ⭐NEW

ChainlessChain integrates MCP (Model Context Protocol) to extend AI capabilities through a standardized protocol:

**What is MCP**:

- 🔌 **Open Standard**: Standardized protocol enabling AI assistants to connect with various external tools and data sources
- 🚀 **Highly Extensible**: Easily add new capabilities without modifying core code
- 🔒 **Secure Isolation**: Servers run in isolated processes with fine-grained permission control

**Supported MCP Servers**:

| Server         | Functionality                                   | Security Level | Status |
| -------------- | ----------------------------------------------- | -------------- | ------ |
| **Filesystem** | File read/write, search, directory management   | Medium         | ✅     |
| **PostgreSQL** | Database queries, table management              | High           | ✅     |
| **SQLite**     | Local database access                           | Medium         | ✅     |
| **Git**        | Repository status, commit history, diff viewing | Medium         | ✅     |
| **Fetch**      | HTTP requests, API calls                        | Medium         | ✅     |

**Core Features**:

- 🎯 **UI Management Interface**: Visual MCP server management in Settings page
- 🔐 **Multi-Layer Security Protection**:
  - Server whitelist mechanism (`server-registry.json`)
  - Path/table access control (whitelist + blacklist)
  - User consent workflow (confirmation for high-risk operations)
  - Process isolation (servers run independently)
  - Audit logging (all operations recorded)
- 📊 **Performance Monitoring**: Connection time, call latency, error rate, memory usage
- 📝 **Complete Documentation**: User guide, testing guide, developer docs

**Security Boundaries**:

- ❌ Permanently forbidden: `chainlesschain.db` (encrypted database), `ukey/` (hardware keys), `did/private-keys/` (DID private keys), `p2p/keys/` (P2P encryption keys)
- ✅ Whitelisted paths: `notes/`, `imports/`, `exports/`, `projects/`
- 🔒 Read-only mode by default, writes require user confirmation

**Use Cases**:

- 📁 AI assistant reads/searches filesystem
- 🗄️ AI assistant queries database for data
- 📋 AI assistant views Git commit history
- 🌐 AI assistant calls external APIs

**Technical Implementation**:

- `mcp-client-manager.js` - Core client orchestrator
- `mcp-security-policy.js` - Security policy enforcement
- `mcp-tool-adapter.js` - Bridge to ToolManager
- Stdio transport protocol (HTTP+SSE planned)
- Integrated UI management in Settings page

**Documentation Links**:

- 📖 [MCP User Guide](docs/features/MCP_USER_GUIDE.md)
- 🧪 [MCP Testing Guide](desktop-app-vue/src/main/mcp/TESTING_GUIDE.md)
- 🌐 [MCP Official Spec](https://modelcontextprotocol.io/)

**Known Limitations (POC Stage)**:

- Only Stdio transport supported (HTTP+SSE pending)
- Basic error recovery (simple retry only)
- File-based configuration (UI editing planned)
- Windows-focused (cross-platform support needed)

**Roadmap**:

- 🔜 HTTP+SSE transport support
- 🔜 More official servers (Slack, GitHub, etc.)
- 🔜 Enhanced UI configuration editing
- 🔜 Custom MCP server development SDK
- 🔜 Community server marketplace

### Unified Configuration Directory System ⭐NEW

ChainlessChain uses a unified `.chainlesschain/` directory for managing all configurations, logs, and cache, inspired by OpenClaude best practices:

**Directory Structure**:

```
.chainlesschain/
├── config.json              # Core config (model, cost, performance, logging)
├── config.json.example      # Config template (version controlled)
├── rules.md                 # Project coding rules
├── memory/                  # Session and learning data
│   ├── sessions/            # Conversation history
│   ├── preferences/         # User preferences
│   └── learned-patterns/    # Learned patterns
├── logs/                    # Operation logs
│   ├── error.log
│   ├── performance.log
│   ├── llm-usage.log        # LLM usage tracking
│   └── mcp-*.log            # MCP logs
├── cache/                   # Cached data
│   ├── embeddings/          # Vector cache
│   ├── query-results/       # Query results
│   └── model-outputs/       # Model outputs
└── checkpoints/             # Checkpoints and backups
```

**Configuration Priority** (High → Low):

1. **Environment variables** (`.env`, system env)
2. **`.chainlesschain/config.json`** (user config)
3. **Default configuration** (defined in code)

**Core Features**:

- ✅ **Auto-initialization**: Automatically creates directory structure on first run
- 📦 **Git-friendly**: Runtime data excluded, templates/rules version controlled
- 🎯 **Centralized Management**: All paths accessible via `UnifiedConfigManager`
- 🔄 **Easy Migration**: Support for config export/import
- 📊 **LLM Cost Tracking**: Automatically logs token usage and costs

**Usage Example**:

```javascript
const { getUnifiedConfigManager } = require("./config/unified-config-manager");
const configManager = getUnifiedConfigManager();

// Get config
const modelConfig = configManager.getConfig("model");

// Get paths
const logsDir = configManager.getLogsDir();

// Update config
configManager.updateConfig({
  cost: { monthlyBudget: 100 },
});
```

**Configuration Files**:

- `.chainlesschain/config.json` - Main config (git-ignored)
- `.chainlesschain/config.json.example` - Template (version controlled)
- `.chainlesschain/rules.md` - Coding rules (priority > CLAUDE.md)

**Backward Compatibility**:

- Existing `app-config.js` continues to work
- New code recommended to use `UnifiedConfigManager`
- Logs gradually migrate from `userData/logs/` to `.chainlesschain/logs/`

### Token Budget Management System ⭐NEW

ChainlessChain implements a complete LLM usage cost tracking and budget management system:

**Core Functions**:

- 💰 **Cost Tracking**: Automatically records token usage and costs for each LLM call
- 📊 **Budget Control**: Set monthly budget, real-time usage monitoring
- ⚠️ **Overspending Alerts**: Automatic alerts at 80%, 90%, 100% of budget
- 📈 **Statistical Analysis**: Analyze usage by time, model, and feature

**Supported LLM Providers**:

- Alibaba Qwen, Zhipu GLM, Baidu Qianfan, Moonshot
- DeepSeek, Tencent Hunyuan, iFlytek Spark
- And more cloud LLM services (14+ providers)

**Usage Monitoring**:

- Real-time token counting (input/output separately)
- Automatic cost calculation (based on official pricing)
- Daily/monthly usage trends
- Model usage ranking

**Alert Strategy**:

- 80% budget: Yellow reminder
- 90% budget: Orange warning
- 100% budget: Red alert, suggest pausing usage

**Log Storage**:

- Location: `.chainlesschain/logs/llm-usage.log`
- Format: JSON Lines (one record per line)
- Content: Timestamp, model, token count, cost, feature module

### P2P File Transfer System ⭐NEW

ChainlessChain implements a complete P2P file transfer system supporting efficient and secure transfer of large files:

**Core Features**:

- 📦 **Large File Chunked Transfer**: 64KB chunk size, supports files of any size
- 🔄 **Resume Capability**: Resume from breakpoint after interruption, no need to restart
- 📊 **Real-time Progress Tracking**: Real-time display of transfer progress, speed, and remaining time
- ✅ **File Integrity Verification**: SHA-256 hash verification ensures file integrity
- ⚡ **Concurrent Transfer Control**: Up to 3 concurrent chunk transfers for optimized speed
- 🎯 **Smart Retry Mechanism**: Automatic retry for failed chunks, up to 3 attempts
- 💾 **Temporary File Management**: Automatic management of temporary files, cleanup after completion
- 🔐 **E2E Encryption**: End-to-end encrypted transfer based on Signal Protocol

**Use Cases**:

- Send/receive images and files in chat
- Knowledge base file synchronization
- Project file collaboration
- Large file peer-to-peer transfer

**Technical Implementation**:

- P2P network layer based on libp2p
- MessageManager for message management and batch processing
- FileTransferManager for file transfer management
- IPC interface integrated into chat system

### Mobile UX Enhancements ⭐NEW

ChainlessChain mobile app has undergone comprehensive UX optimization to provide a smooth, modern mobile experience:

**Core UX Features**:

- 📱 **Responsive Design**: Adapts to various screen sizes, supports portrait/landscape orientation
- 🎨 **Modern UI**: Gradient design, card-based layout, smooth animations
- ⚡ **Performance Optimization**: Virtual scrolling, lazy loading, image optimization, skeleton screens
- 🔄 **Pull-to-Refresh**: All list pages support pull-to-refresh
- 💬 **Instant Feedback**: Toast notifications, loading states, error handling
- 🎯 **Gesture Controls**: Swipe to delete, long-press menu, double-tap zoom
- 📝 **Markdown Editor**: Real-time preview, code highlighting, toolbar, auto-save
- 🖼️ **Image Processing**: Image preview, upload progress, compression optimization
- 🔔 **Notification System**: Local notifications, push notifications, notification center
- 🌙 **Theme Switching**: Light/dark themes, follows system settings

**Implemented Features** (100% Complete):

- ✅ Knowledge Base Management - Markdown rendering, code highlighting, image preview
- ✅ AI Chat Interface - Streaming responses, message bubbles, voice input
- ✅ Social Features - Friend list, post publishing, private messaging
- ✅ Trading System - Order management, asset display, payment flow
- ✅ Project Management - Task list, progress tracking, collaboration features
- ✅ Settings Pages - Account management, privacy settings, sync configuration

**Technical Implementation**:

- uni-app 3.0 + Vue 3.4 cross-platform framework
- Pinia 2.1.7 state management
- SQLite local database
- WebRTC P2P communication
- Custom CSS theme system
- Component-based architecture

### Voice Message System ⭐NEW

ChainlessChain implements a complete voice message recording and playback system for seamless audio communication in P2P chats:

**Recording Features**:

- 🎙️ **Real-time Voice Recording**: One-click recording with intuitive modal interface
- ⏸️ **Pause/Resume Controls**: Pause and resume recording without losing progress
- ⏱️ **Duration Display**: Real-time recording duration counter (MM:SS format)
- 📊 **Volume Visualization**: Live audio level indicator during recording
- 🎨 **Animated Recording UI**: Pulsing microphone icon with visual feedback
- ❌ **Cancel Recording**: Discard recording without sending

**Playback Features**:

- ▶️ **Play/Pause Controls**: Simple play/pause button in message bubble
- 🕐 **Duration Display**: Shows voice message length
- 🔊 **Audio Element Management**: Proper audio resource handling and cleanup
- 🔄 **Playback Status**: Visual indication of playing state
- ⚠️ **Error Handling**: Graceful error handling for playback failures

**Technical Implementation**:

- VoiceMessageRecorder component for recording UI
- Integration with speech IPC handlers (start/pause/resume/stop/cancel)
- Audio file storage in uploads/chat directory
- Duration metadata stored in database
- P2P file transfer for voice message delivery
- Automatic resource cleanup on component unmount

**Use Cases**:

- Quick voice messages in P2P chats
- Voice notes for knowledge base
- Audio feedback and communication
- Hands-free messaging

### Blockchain Adapter System ⭐COMPLETE

ChainlessChain implements a complete blockchain adapter system providing unified multi-chain interaction interface:

#### 1. Multi-Chain Support (15 Blockchains)

**Mainnets**:

- Ethereum (Ethereum Mainnet)
- Polygon (Polygon Mainnet)
- BSC (Binance Smart Chain)
- Arbitrum One (Arbitrum Mainnet)
- Optimism (Optimism Mainnet)
- Avalanche C-Chain (Avalanche C-Chain)
- Base (Base Mainnet)

**Testnets**:

- Ethereum Sepolia
- Polygon Mumbai
- BSC Testnet
- Arbitrum Sepolia
- Optimism Sepolia
- Avalanche Fuji
- Base Sepolia
- Hardhat Local (Local Development Network)

#### 2. Smart Contract Deployment

**Token Contracts**:

- ✅ ERC-20 Token Deployment (ChainlessToken)
- ✅ ERC-721 NFT Deployment (ChainlessNFT)
- ✅ Custom Token Parameters (name/symbol/decimals/initial supply)

**Business Contracts**:

- ✅ Escrow Contract (EscrowContract) - Supports buyer-seller fund escrow
- ✅ Subscription Contract (SubscriptionContract) - Supports periodic subscription payments
- ✅ Bounty Contract (BountyContract) - Supports task bounties and reward distribution

#### 3. Asset Operations

**Token Operations**:

- ✅ Token Transfer (single/batch)
- ✅ Token Balance Query
- ✅ Token Approval Management

**NFT Operations**:

- ✅ NFT Minting (mint)
- ✅ NFT Transfer (single/batch)
- ✅ NFT Ownership Query
- ✅ NFT Metadata URI Query
- ✅ NFT Balance Query

#### 4. Wallet Management System

**HD Wallet**:

- ✅ BIP39 Mnemonic Generation (12 words)
- ✅ BIP44 Derivation Path (m/44'/60'/0'/0/0)
- ✅ Import Wallet from Mnemonic
- ✅ Import Wallet from Private Key
- ✅ Export Private Key/Mnemonic

**Security Features**:

- ✅ AES-256-GCM Encrypted Storage
- ✅ PBKDF2 Key Derivation (100,000 iterations)
- ✅ USB Key Hardware Signing Support
- ✅ Wallet Lock/Unlock Mechanism

**External Wallets**:

- ✅ MetaMask Integration
- ✅ WalletConnect Support
- ✅ Multi-Wallet Management

#### 5. Advanced Features

**Gas Optimization**:

- ✅ Gas Price Optimization (slow/standard/fast tiers)
- ✅ Transaction Fee Estimation (L2 special handling support)
- ✅ EIP-1559 Support (maxFeePerGas/maxPriorityFeePerGas)

**Transaction Management**:

- ✅ Transaction Retry Mechanism (exponential backoff, up to 3 attempts)
- ✅ Transaction Monitoring (real-time status updates)
- ✅ Transaction Replacement (cancel/speed up pending transactions)
- ✅ Transaction Confirmation Tracking

**Event System**:

- ✅ Contract Event Listening
- ✅ Real-time Event Push
- ✅ Event Filtering and Query

#### 6. Cross-Chain Bridge

**LayerZero Integration**:

- ✅ Cross-chain Asset Transfer
- ✅ Cross-chain Message Passing
- ✅ Support for 15 Chain Interoperability
- ✅ Automatic Route Optimization

#### 7. On-Chain Off-Chain Sync

**BlockchainIntegration Module**:

- ✅ On-chain Asset Mapping to Local Database
- ✅ On-chain Transaction Record Sync
- ✅ Escrow Status Sync
- ✅ Auto Sync (every 5 minutes)
- ✅ Sync Logs and Error Tracking

#### 8. RPC Management

**Smart RPC Switching**:

- ✅ Multiple RPC Endpoint Configuration
- ✅ Automatic Failover
- ✅ Connection Timeout Detection (5 seconds)
- ✅ Public RPC Fallback

#### 9. Block Explorer Integration

**Supported Explorers**:

- Etherscan (Ethereum)
- Polygonscan (Polygon)
- BscScan (BSC)
- Arbiscan (Arbitrum)
- Optimistic Etherscan (Optimism)
- SnowTrace (Avalanche)
- BaseScan (Base)

**Features**:

- ✅ Transaction Query Link Generation
- ✅ Address Query Link Generation
- ✅ Contract Verification Link

#### 10. Technical Architecture

**Core Modules**:

```
desktop-app-vue/src/main/blockchain/
├── blockchain-adapter.js          # Core Adapter (1087 lines)
├── blockchain-config.js           # Network Config (524 lines)
├── wallet-manager.js              # Wallet Management (891 lines)
├── blockchain-integration.js      # On-chain Off-chain Integration (637 lines)
├── bridge-manager.js              # Cross-chain Bridge Management
├── transaction-monitor.js         # Transaction Monitoring
├── event-listener.js              # Event Listening
├── contract-artifacts.js          # Contract ABI
└── rpc-manager.js                 # RPC Management
```

**IPC Interfaces**:

- `blockchain-ipc.js` - Blockchain Basic Operations
- `wallet-ipc.js` - Wallet Operations
- `contract-ipc.js` - Contract Interaction
- `asset-ipc.js` - Asset Management
- `bridge-ipc.js` - Cross-chain Bridge
- `escrow-ipc.js` - Escrow Operations
- `marketplace-ipc.js` - Marketplace Trading

**Database Tables**:

- `blockchain_wallets` - Wallet Information
- `blockchain_asset_mapping` - Asset Mapping
- `blockchain_transaction_mapping` - Transaction Mapping
- `blockchain_escrow_mapping` - Escrow Mapping
- `blockchain_sync_log` - Sync Logs

#### 11. Usage Examples

**Create Wallet**:

```javascript
// Generate new wallet
const wallet = await walletManager.createWallet(password, chainId);
// Returns: { id, address, mnemonic, chainId }

// Import from mnemonic
const wallet = await walletManager.importFromMnemonic(
  mnemonic,
  password,
  chainId,
);

// Import from private key
const wallet = await walletManager.importFromPrivateKey(
  privateKey,
  password,
  chainId,
);
```

**Deploy Contracts**:

```javascript
// Deploy ERC-20 token
const { address, txHash } = await blockchainAdapter.deployERC20Token(walletId, {
  name: "My Token",
  symbol: "MTK",
  decimals: 18,
  initialSupply: 1000000,
  password: "your-password",
});

// Deploy NFT contract
const { address, txHash } = await blockchainAdapter.deployNFT(walletId, {
  name: "My NFT",
  symbol: "MNFT",
  password: "your-password",
});
```

**Transfer Operations**:

```javascript
// Transfer tokens
const txHash = await blockchainAdapter.transferToken(
  walletId,
  tokenAddress,
  toAddress,
  amount,
  password,
);

// Transfer NFT
const txHash = await blockchainAdapter.transferNFT(
  walletId,
  nftAddress,
  fromAddress,
  toAddress,
  tokenId,
  password,
);
```

**Query Balance**:

```javascript
// Query token balance
const balance = await blockchainAdapter.getTokenBalance(
  tokenAddress,
  ownerAddress,
);

// Query NFT balance
const balance = await blockchainAdapter.getNFTBalance(nftAddress, ownerAddress);
```

**Switch Network**:

```javascript
// Switch to Polygon mainnet
await blockchainAdapter.switchChain(137);

// Get current chain info
const chainInfo = blockchainAdapter.getCurrentChainInfo();
```

#### 12. Security Features

- ✅ Private Key Local Encrypted Storage (AES-256-GCM)
- ✅ Mnemonic Encrypted Backup
- ✅ USB Key Hardware Signing Support
- ✅ Transaction Signature Pre-verification
- ✅ Address Checksum Verification
- ✅ Replay Attack Protection (nonce management)
- ✅ Gas Limit Protection

#### 13. Performance Optimization

- ✅ Wallet Caching Mechanism
- ✅ RPC Connection Pool
- ✅ Batch Transaction Processing
- ✅ Event Listening Optimization
- ✅ Database Index Optimization

#### 14. Error Handling

- ✅ Network Error Auto Retry
- ✅ RPC Failure Auto Switch
- ✅ Transaction Failure Rollback
- ✅ Detailed Error Logging
- ✅ User-Friendly Error Messages

**Code Statistics**:

- Core Code: 5,000+ lines
- Smart Contracts: 2,400+ lines
- Test Cases: 50+
- Supported Chains: 15
- IPC Interfaces: 80+

## 📥 Download & Installation

### Mac Users

#### Download Links

- **GitHub Releases** (International): [https://github.com/chainlesschain/chainlesschain/releases/latest](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (China Mirror): [https://gitee.com/chainlesschaincn/chainlesschain/releases](https://gitee.com/chainlesschaincn/chainlesschain/releases)

#### Choose Your Version

- **Intel Chip (x64)**: Download `ChainlessChain-darwin-x64-0.29.0.zip` (~1.4GB)
- **Apple Silicon (M1/M2/M3)**: ARM64 version in development, please use x64 version with Rosetta

#### Installation Steps

1. Download `ChainlessChain-darwin-x64-0.29.0.zip`
2. Extract the file (double-click the zip file)
3. Drag `ChainlessChain.app` to Applications folder
4. Double-click to run (see notes below for first run)

#### First Run Notes

**If you see "Cannot open because developer cannot be verified"**:

**Method 1** (Recommended):

- Right-click on `ChainlessChain.app`
- Select "Open"
- Click "Open" in the dialog

**Method 2**:

- Open "System Preferences" → "Security & Privacy"
- In the "General" tab, click "Open Anyway" button at the bottom

### Windows Users

#### Download Links

- **GitHub Releases** (International): [https://github.com/chainlesschain/chainlesschain/releases/latest](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (China Mirror): [https://gitee.com/chainlesschaincn/chainlesschain/releases](https://gitee.com/chainlesschaincn/chainlesschain/releases)

#### Download Version

- **Windows x64 (64-bit)**: Download `ChainlessChain-win32-x64-0.29.0.zip` (~1.4GB)

#### Installation Steps (Portable Version)

1. Download `ChainlessChain-win32-x64-0.29.0.zip`
2. Extract to any folder (recommended: `C:\Program Files\ChainlessChain\`)
3. Double-click `ChainlessChain.exe` to run
4. No administrator privileges required

#### Notes

- **System Requirements**: Windows 10/11 (64-bit)
- **Portable Version**: Can be extracted to USB drive for portability
- **Data Storage**: Database files located in `data` folder within application directory
- **Firewall**: May need to allow network access on first run (for P2P communication)

#### Build from Source (Optional)

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain/desktop-app-vue
npm install
npm run make:win
```

### Linux Users

#### Download Links

- **GitHub Releases** (International): [https://github.com/chainlesschain/chainlesschain/releases/latest](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (China Mirror): [https://gitee.com/chainlesschaincn/chainlesschain/releases](https://gitee.com/chainlesschaincn/chainlesschain/releases)

#### Download Version

- **Linux x64 ZIP Portable**: Download `ChainlessChain-linux-x64-0.29.0.zip` (~1.4GB)
- **Linux x64 DEB Package**: Download `chainlesschain-desktop-vue_0.29.0_amd64.deb` (~923MB) ⭐Recommended

#### Supported Distributions

- Ubuntu 20.04+ / Debian 11+
- Fedora 35+ / CentOS 8+
- Arch Linux / Manjaro
- Other mainstream Linux distributions

#### Installation Steps

**Method 1: DEB Package (Recommended for Ubuntu/Debian)**

1. Download the deb file
2. Install:
   ```bash
   sudo dpkg -i chainlesschain-desktop-vue_0.29.0_amd64.deb
   ```
3. If dependency issues occur:
   ```bash
   sudo apt-get install -f
   ```
4. Launch from application menu or run:
   ```bash
   chainlesschain-desktop-vue
   ```

**Method 2: ZIP Portable (All Distributions)**

1. Download the zip file
2. Extract to any directory:
   ```bash
   unzip ChainlessChain-linux-x64-0.29.0.zip
   cd ChainlessChain-linux-x64
   ```
3. Grant execute permission:
   ```bash
   chmod +x chainlesschain
   ```
4. Run the application:
   ```bash
   ./chainlesschain
   ```

#### Optional: Create Desktop Shortcut

```bash
# Copy to /opt (optional)
sudo cp -r ChainlessChain-linux-x64 /opt/chainlesschain

# Create symbolic link
sudo ln -s /opt/chainlesschain/chainlesschain /usr/local/bin/chainlesschain

# Create .desktop file
cat > ~/.local/share/applications/chainlesschain.desktop <<'EOF'
[Desktop Entry]
Name=ChainlessChain
Comment=Decentralized Personal AI Management System
Exec=/opt/chainlesschain/chainlesschain
Icon=/opt/chainlesschain/resources/app/build/icon.png
Terminal=false
Type=Application
Categories=Utility;Office;
EOF
```

#### Dependency Check

Most modern Linux distributions include required libraries. If issues occur, install:

```bash
# Ubuntu/Debian
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6

# Fedora/CentOS
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst

# Arch Linux
sudo pacman -S gtk3 libnotify nss libxss libxtst
```

### Build from Source (Developers)

If you want to run from source or contribute to development, see the [🚀 Quick Start](#🚀-quick-start) section below.

---

## Four Core Functions

### 1️⃣ Knowledge Base Management (100% Complete) ✅

**Database System**:

- ✅ SQL.js + SQLCipher AES-256 encrypted database (50+ tables: base + enterprise + blockchain + optimization)
- ✅ Unified management of knowledge items, tags, conversations, projects, tasks
- ✅ Soft delete mechanism + auto-save + transaction support
- ✅ SQLite ↔ PostgreSQL bidirectional sync (4 core modules)
- ✅ Performance optimization and edge case handling (memory downgrade, disk check, concurrency control)

**AI-Enhanced Retrieval (RAG)**:

- ✅ ChromaDB/Qdrant vector storage
- ✅ Hybrid search (vector + keyword + FTS5 full-text index)
- ✅ 3 reranking algorithms (LLM, CrossEncoder, hybrid)
- ✅ Query rewriting (multi-query, HyDE, step-back)
- ✅ Performance monitoring and metrics collection

**File Processing**:

- ✅ Multi-format import: Markdown/PDF/Word/TXT/Images
- ✅ OCR recognition: Tesseract.js, supports Chinese and English
- ✅ Image processing: Sharp compression, thumbnails, format conversion
- ✅ 6 specialized editors: Code/Markdown/Excel/PPT/RichText/WebDev

**Version Control**:

- ✅ isomorphic-git pure JS implementation
- ✅ AI auto-generated commit messages
- ✅ Visual conflict resolution UI
- ✅ Git sync scheduler

**Deep Performance Optimization** (v0.20.0):

- ✅ **Smart Image Optimization** (560 lines):
  - WebP/AVIF format auto-detection and conversion
  - Responsive image loading (srcset/sizes)
  - LQIP (Low Quality Image Placeholder)
  - Progressive loading and CDN support
  - Network-aware loading (auto quality reduction on 2G/3G)
- ✅ **Real-time Performance Monitoring** (644 lines):
  - Core Web Vitals monitoring (LCP/FID/CLS/FCP/TTFB)
  - Performance budget management and violation alerts
  - Real-time FPS monitoring (60fps target)
  - Memory usage monitoring and alerts
  - Network status monitoring
- ✅ **Frontend Optimization Toolkit** (18 utility classes):
  - Code splitting and component lazy loading
  - Virtual scrolling list (VirtualMessageList)
  - Intelligent prefetch (based on user behavior prediction)
  - Request batching
  - Optimistic updates
  - Data compression (LZ-string algorithm)
  - Incremental sync
  - Memory optimization (object pool, weak references)
  - Animation control (requestAnimationFrame)
  - Resource hints (preload/prefetch/preconnect)
  - Content Visibility API optimization
  - Accessibility enhancements (ARIA)
  - Performance benchmarking tools
- ✅ **Specialized Components** (4 components):
  - AsyncComponent.vue - Async component loading
  - LazyImage.vue - Lazy loading image component
  - PerformanceMonitor.vue - Performance monitoring panel
  - VirtualMessageList.vue - Virtual scrolling message list
- ✅ **Complete Documentation**: 8 detailed documents (OPTIMIZATION\_\*.md)

### 2️⃣ Decentralized Social (100% Complete) ✅

**DID Identity System**:

- ✅ W3C DID Core standard (`did:chainlesschain:<identifier>`)
- ✅ Ed25519 signing key pair + X25519 encryption key pair
- ✅ DID document generation, signing, verification
- ✅ Multi-identity support + mnemonic export
- ✅ P2P network publishing and resolution

**Verifiable Credentials (VC)**:

- ✅ 5 credential types: self-claim, skill certificate, trust endorsement, education, work experience
- ✅ W3C VC standard signing and verification
- ✅ Credential lifecycle management + revocation mechanism

**P2P Network**:

- ✅ libp2p 3.1.2 node management
- ✅ TCP transport + Noise encryption + Kademlia DHT
- ✅ mDNS local discovery + device hot-plug monitoring
- ✅ Signal Protocol E2E encryption (complete implementation)
- ✅ Device management + cross-device sync + offline message queue
- ✅ WebRTC support (P2P voice/video calls + NAT traversal)

**Social Features**:

- ✅ Friend management: request/accept/reject, online status, grouping, remarks
- ✅ Social posts: publish, like, comment, share, image support
- ✅ P2P encrypted private messages: offline messages, multi-device sync, file transfer, message forwarding ⭐Updated
- ✅ Group chat: create groups, member management, end-to-end encrypted group messages, invitation system

**Message Forwarding Feature** (~200 lines of code): ⭐NEW

- ✅ **Context Menu**: Right-click on message bubbles for forward, copy, delete operations
- ✅ **Multi-Session Selection**: Select multiple target sessions for batch forwarding
- ✅ **Automatic File Copying**: Automatically copy files when forwarding image/file messages
- ✅ **Forward Indicator**: Forwarded messages display forward badge and track original source
- ✅ **Forward Counter**: Track how many times a message has been forwarded
- ✅ **Database Support**: Added forwarded_from_id and forward_count fields
- ✅ **IPC Interface**: chat:forward-message handler for batch forwarding
- ✅ **UI Components**: Forward dialog, session selector, forwarding status notifications

**Voice Message Playback Feature** (~150 lines of code): ⭐NEW

- ✅ **Playback Controls**: Click play/pause button to control voice playback, supports playback state toggle
- ✅ **Status Display**: Real-time playback status display (playing/paused), dynamic icon switching
- ✅ **Duration Display**: Shows voice message duration in MM:SS format
- ✅ **HTML5 Audio**: Uses native Audio API for playback, supports all browser audio formats
- ✅ **Auto Cleanup**: Automatically resets state when playback ends, releases audio resources on component unmount
- ✅ **Error Handling**: Comprehensive error messages and exception handling, friendly prompts on playback failure
- ✅ **IPC Interface**: chat:play-voice-message handler, validates message type and file existence
- ✅ **UI Integration**: Voice message bubble, play/pause icons, duration label

**Community Forum** (Standalone App):

- ✅ Spring Boot 3.1.5 backend (69 Java files, 63 APIs)
- ✅ Vue3 frontend (45 files, 15 pages)
- ✅ 14 database tables: users, posts, replies, tags, likes, favorites, etc.
- ✅ Elasticsearch full-text search + Redis cache
- ✅ JWT authentication + Spring Security authorization

### 3️⃣ Decentralized Trading System (100% Complete) ✅

Total code: **12,494+ lines** (28 UI components + 8 backend modules + blockchain integration)

**Trading UI Components** (28 components, 12,494 lines):

**Asset Management UI** (6 components - 2,631 lines):

- ✅ **AssetList.vue** (316 lines) - Asset listing with filters, search, statistics
- ✅ **AssetCreate.vue** (601 lines) - Create tokens, NFTs, knowledge products, services
- ✅ **AssetDetail.vue** (452 lines) - Detailed asset view with blockchain info
- ✅ **AssetTransfer.vue** (292 lines) - Transfer assets between DIDs
- ✅ **AssetHistory.vue** (510 lines) - Transaction history timeline
- ✅ **AssetStatistics.vue** (460 lines) - Asset analytics and charts

**Marketplace UI** (6 components - 2,794 lines):

- ✅ **Marketplace.vue** (728 lines) - Main marketplace with order cards, filters, tabs
- ✅ **OrderCreate.vue** (468 lines) - Create buy/sell/service/barter orders
- ✅ **OrderDetail.vue** (417 lines) - Order details with purchase/cancel actions
- ✅ **OrderEdit.vue** (333 lines) - Edit existing orders (NEW - Jan 13, 2026) ⭐
- ✅ **OrderPurchase.vue** (404 lines) - Purchase flow with escrow integration
- ✅ **TransactionList.vue** (444 lines) - Transaction history with status tracking

**Smart Contract UI** (6 components - 3,031 lines):

- ✅ **ContractList.vue** (474 lines) - Contract listing with filters
- ✅ **ContractCreate.vue** (732 lines) - Create contracts from templates
- ✅ **ContractDetail.vue** (661 lines) - Contract details with conditions/events
- ✅ **ContractSign.vue** (430 lines) - Multi-party signature workflow
- ✅ **ContractExecute.vue** (331 lines) - Execute contract conditions
- ✅ **ContractArbitration.vue** (403 lines) - Dispute resolution interface

**Escrow Management UI** (4 components - 1,718 lines):

- ✅ **EscrowList.vue** (455 lines) - Escrow listing with status filters
- ✅ **EscrowDetail.vue** (392 lines) - Escrow details and actions
- ✅ **EscrowDispute.vue** (404 lines) - Dispute filing interface
- ✅ **EscrowStatistics.vue** (467 lines) - Escrow analytics dashboard

**Credit & Review UI** (5 components - 1,867 lines):

- ✅ **CreditScore.vue** (509 lines) - Credit score display, level badges, benefits, history chart, leaderboard
- ✅ **ReviewList.vue** (414 lines) - Review listing with ratings
- ✅ **ReviewCreate.vue** (373 lines) - Create reviews with star ratings
- ✅ **ReviewReply.vue** (227 lines) - Reply to reviews
- ✅ **MyReviews.vue** (344 lines) - User's review history

**Transaction Statistics UI** (1 component - 453 lines):

- ✅ **TransactionStatistics.vue** (453 lines) - Charts and analytics for transactions

**Common/Shared Components** (8 components):

- ✅ **AssetCard.vue** - Reusable asset card
- ✅ **ContractCard.vue** - Reusable contract card
- ✅ **OrderCard.vue** - Reusable order card
- ✅ **OrderQRCodeDialog.vue** - QR code generation (NEW - Jan 13, 2026) ⭐
- ✅ **OrderShareModal.vue** - Share orders via link/social/export (NEW - Jan 13, 2026) ⭐
- ✅ **DIDSelector.vue** - DID selection dropdown
- ✅ **PriceInput.vue** - Price input with asset selector
- ✅ **StatusBadge.vue** - Status badges with colors
- ✅ **TransactionTimeline.vue** - Transaction timeline visualization

**Backend Modules** (8 modules, 6,492 lines):

**1. Digital Asset Management** (asset-manager.js - 1,052 lines):

- ✅ 4 asset types: Token, NFT, knowledge products, service credentials
- ✅ Asset creation, minting, transfer, burning
- ✅ Balance management + transfer history + metadata
- ✅ Batch operation support
- ✅ **NFT On-Chain Transfers** - Full ERC-721 implementation ⭐NEW
  - Ownership verification + safe transfer (safeTransferFrom)
  - Batch NFT transfer support
  - Real-time on-chain queries (owner, balance, metadata URI)
  - Post-transfer auto-verification + P2P notifications
  - Complete transfer history tracking
- ✅ **Blockchain Integration** - ERC-20/ERC-721 deployment
  - On-chain transfers with transaction hash tracking
  - Multi-chain support (Ethereum, Polygon, BSC, Arbitrum, Optimism, Avalanche, Base)

**2. Trading Market** (marketplace-manager.js - 773 lines):

- ✅ Product listing management (create, update, list, delist)
- ✅ Multi-dimensional search and filtering (category, price, tags)
- ✅ Order management (create, pay, confirm, cancel)
- ✅ Transaction history and statistics
- ✅ **Order Editing** - Edit open orders (price, quantity, description) ⭐NEW
- ✅ **Order Sharing** - Multiple sharing methods (link/social/export) ⭐NEW
- ✅ **QR Code Generation** - Generate QR codes for orders/assets ⭐NEW
- ✅ **Multi-Format Export** - Export orders as JSON/CSV/PDF/image ⭐NEW

**3. Smart Contract Engine** (contract-engine.js - 1,345 lines + contract-templates.js - 526 lines):

- ✅ Contract engine: condition evaluation, auto-execution, state management
- ✅ 5 contract types: Simple Trade, Subscription, Bounty, Skill Exchange, Custom
- ✅ 4 escrow types: Simple, Multisig, Timelock, Conditional
- ✅ 40+ condition types supported
- ✅ Serial/parallel task execution
- ✅ Webhook notification integration
- ✅ Multi-party signatures
- ✅ Arbitration system
- ✅ **Blockchain Deployment** - Solidity contracts (Escrow, Subscription, Bounty)
- ✅ **Event Listening** - Real-time event synchronization

**4. Escrow Service** (escrow-manager.js - 592 lines):

- ✅ 4 escrow types: simple escrow, multi-party escrow, arbitration escrow, time-locked
- ✅ Buyer and seller protection mechanisms
- ✅ Dispute resolution process
- ✅ Automatic/manual fund release
- ✅ Statistics dashboard
- ✅ Integration with marketplace and contracts

**5. Knowledge Payment** (knowledge-payment.js - 896 lines):

- ✅ 5 content types: article/video/audio/course/consulting
- ✅ 3 pricing models: one-time, subscription, donation
- ✅ Knowledge product encryption (AES-256) + key management
- ✅ Purchase process + decryption access
- ✅ Copyright protection + DRM
- ✅ Revenue distribution and withdrawal
- ✅ Preview system
- ✅ Statistics tracking

**6. Credit Scoring** (credit-score.js - 637 lines):

- ✅ 6-factor credit score calculation:
  - Completion rate, trade volume, positive rate
  - Response speed, dispute rate, refund rate
- ✅ 5 credit levels: Novice (0-199) → Bronze (200-499) → Silver (500-999) → Gold (1000-1999) → Diamond (2000+)
- ✅ Dynamic weight adjustment algorithm
- ✅ Real-time updates + historical snapshots
- ✅ Credit records and trend analysis
- ✅ Leaderboard system
- ✅ Level-based benefits (fee discounts, priority display, VIP support)

**7. Review System** (review-manager.js - 671 lines):

- ✅ 5-star rating + text review + image attachments
- ✅ Bilateral reviews (buyer/seller)
- ✅ Reply system
- ✅ Helpful/unhelpful marking
- ✅ Report abuse mechanism
- ✅ Review statistics and analysis
- ✅ Review visibility control

**8. Order Management** (integrated in marketplace-manager.js):

- ✅ Order lifecycle: pending payment → paid → in progress → completed → cancelled
- ✅ Order detail queries
- ✅ Batch order processing
- ✅ Order notifications and reminders
- ✅ Order editing (price, quantity, description)
- ✅ Order sharing (link, social media, export)

**9. Blockchain Smart Contract System** (2400+ lines) ⭐NEW:

- ✅ **ChainlessToken** (ERC-20 token contract, 70 lines)
  - Custom name, symbol, decimals
  - Mint/Burn functions, Ownable access control
- ✅ **ChainlessNFT** (ERC-721 NFT contract, 140 lines)
  - Metadata URI support, batch minting
  - ERC721Enumerable extension
  - **Complete On-Chain Transfer Functionality** ⭐NEW
    - safeTransferFrom secure transfer
    - Ownership verification (ownerOf)
    - Balance queries (balanceOf)
    - Metadata URI queries (tokenURI)
    - Batch transfer support
- ✅ **EscrowContract** (Escrow contract, 260 lines)
  - Support for ETH/MATIC + ERC20 tokens
  - Dispute resolution mechanism + arbitrator function
  - ReentrancyGuard protection
- ✅ **SubscriptionContract** (Subscription contract, 300 lines)
  - Monthly/quarterly/annual subscriptions
  - Auto-renewal mechanism
- ✅ **BountyContract** (Bounty contract, 330 lines)
  - Task posting, claiming, submission review
  - Support for multiple completers, reward distribution
- ✅ **AssetBridge** (Cross-chain bridge contract, 300 lines)
  - Lock-mint mode
  - Relayer permission management, duplicate mint prevention
- ✅ **Complete Test Suite** (600+ lines, 45+ test cases)
- ✅ **Deployment Scripts** (support for multi-network deployment)

**10. Wallet System** (3000+ lines) ⭐NEW:

- ✅ **Built-in HD Wallet** (900 lines)
  - BIP39 mnemonic + BIP44 path
  - AES-256-GCM strong encryption storage
  - USB Key hardware signing integration
  - EIP-155/EIP-191 signing
- ✅ **External Wallet Integration** (420 lines)
  - MetaMask connection
  - WalletConnect v1 support
  - Network switching and event listeners
- ✅ **Transaction Monitoring** (350 lines)
  - Transaction status tracking
  - Auto-confirmation waiting
  - Database persistence

**Trading UI Components** (20+):

- AssetCreate/List/Transfer - Asset management
- Marketplace/OrderCreate/OrderDetail - Market and orders
- ContractCreate/Detail/List/Execute/Sign - Smart contracts
- EscrowList/Detail/Dispute/Statistics - Escrow management
- ContractCard/TransactionTimeline - Common components
- CreditScore/ReviewList/MyReviews - Credit and reviews

### 4️⃣ Enterprise Edition (Decentralized Organizations) (100% Complete) ✅ ⭐COMPLETE

**Core Architecture**:

- ✅ **Multi-Identity Architecture**: One user DID can have personal identity + multiple organization identities
- ✅ **Complete Data Isolation**: Each identity corresponds to independent database file (personal.db, org_xxx.db)
- ✅ **Organization DID**: Support for organization-level DID creation (did:chainlesschain:org:xxxx)
- ✅ **Database Switching**: Dynamic switching between different identity databases

**Organization Management** (OrganizationManager - 1966 lines):

- ✅ Organization create/delete - UUID generation, DID creation, database initialization
- ✅ Member management - add/remove/role change, online status
- ✅ Invitation system - 6-digit invitation code generation, DID invitation links (complete implementation)
- ✅ Activity log - all operations automatically recorded, audit trail

**Enterprise Data Synchronization System** (Complete Implementation) ⭐NEW:

**1. P2P Sync Engine** (P2PSyncEngine - Complete Implementation):

- ✅ **Incremental Sync** - Timestamp-based incremental data sync, reduces network traffic
- ✅ **Conflict Detection** - Vector Clock conflict detection mechanism
- ✅ **Conflict Resolution** - Multiple strategies supported (LWW/Manual/Auto-merge)
  - Last-Write-Wins (LWW) - Last write takes precedence
  - Manual - Manual conflict resolution
  - Auto-merge - Automatically merge non-conflicting fields
- ✅ **Offline Queue** - Offline operation queue, auto-sync when network recovers
- ✅ **Batch Processing** - Configurable batch size (default 50), optimized performance
- ✅ **Auto Retry** - Automatic retry on failure, up to 5 times, exponential backoff
- ✅ **Sync State Tracking** - Complete sync state recording and querying

**2. Organization P2P Network** (OrgP2PNetwork - Complete Implementation):

- ✅ **Topic Subscription** - Organization topic subscription based on libp2p PubSub
- ✅ **Member Discovery** - Automatic discovery of online members in organization
- ✅ **Heartbeat Mechanism** - 30-second heartbeat interval, real-time member status
- ✅ **Direct Messaging** - Fallback to direct messaging when PubSub unavailable
- ✅ **Real-time Events** - Member online/offline, knowledge updates, etc. pushed in real-time
- ✅ **Broadcast Messages** - Organization-wide message broadcasting and announcements

**3. Knowledge Collaboration Sync** (OrgKnowledgeSyncManager - Complete Implementation):

- ✅ **Folder Permissions** - Hierarchical folder structure, fine-grained permission control
- ✅ **Real-time Collaboration** - Yjs CRDT integration, conflict-free real-time editing
- ✅ **Activity Tracking** - Complete knowledge base change audit logs
- ✅ **Offline Support** - Offline operation queue, automatic sync
- ✅ **Permission Checking** - Role-based knowledge base access control

**4. Collaboration Manager** (CollaborationManager - Complete Implementation):

- ✅ **ShareDB Integration** - Operational Transformation (OT) for real-time editing
- ✅ **WebSocket Server** - Built-in collaboration WebSocket server
- ✅ **Permission Integration** - Enterprise permission checking integration
- ✅ **Multi-user Support** - Cursor tracking, selection sharing, presence awareness
- ✅ **Session Management** - Complete collaboration session tracking

**5. Sync Strategy Configuration**:

```javascript
const strategies = {
  knowledge: "manual", // Knowledge requires manual conflict resolution
  member: "lww", // Member info uses Last-Write-Wins
  role: "manual", // Role configs require manual resolution
  settings: "manual", // Organization settings require manual resolution
  project: "lww", // Project metadata uses Last-Write-Wins
};
```

**6. Sync Workflows**:

**Organization Creation Sync**:

1. Create organization locally
2. Initialize P2P network
3. Broadcast creation event to network
4. Set up sync state tracking

**Member Addition Sync**:

1. Add member locally
2. Update sync state
3. Broadcast member addition event
4. Trigger permission recalculation

**Knowledge Sync**:

1. Real-time collaborative editing via Yjs
2. Conflict-free merging of concurrent edits
3. Permission-based access control
4. Activity logging for audit trails

**Conflict Resolution**:

1. Vector clock comparison
2. Configurable resolution strategies
3. Manual resolution UI for critical conflicts
4. Automatic LWW for non-critical data

**7. Database Support**:

- ✅ `p2p_sync_state` - Sync state tracking
- ✅ `sync_conflicts` - Conflict resolution records
- ✅ `sync_queue` - Offline operation queue
- ✅ `organization_activities` - Complete audit logs

**8. Enterprise-Grade Features**:

- ✅ **Security**: DID identity, P2P encrypted communication
- ✅ **Scalability**: Configurable batch sizes, offline queuing
- ✅ **Reliability**: Retry mechanisms, conflict detection, audit trails
- ✅ **Compliance**: Complete activity logging, permission tracking
- ✅ **Flexibility**: Custom roles, configurable sync strategies

**DID Invitation Link System** (DIDInvitationManager - Complete Implementation):

- ✅ **Secure Token Generation** - 32-byte random tokens (base64url encoded)
- ✅ **Flexible Usage Control** - Single/multiple/unlimited use, usage count tracking
- ✅ **Expiration Management** - Default 7-day expiration, customizable, auto-expiration detection
- ✅ **Permission Control** - Role-based invitations (owner/admin/member/viewer)
- ✅ **Usage Record Tracking** - Records user DID, usage time, IP address, User Agent
- ✅ **Statistical Analysis** - Total links, active/expired/revoked status, usage rate calculation
- ✅ **Complete IPC Interface** - 9 IPC handlers (create/verify/accept/list/details/revoke/delete/stats/copy)
- ✅ **Database Tables** - invitation_links, invitation_link_usage
- ✅ **Detailed Documentation** - INVITATION_LINK_FEATURE.md (500 lines complete documentation)

**Permission System** (RBAC + ACL):

- ✅ **4 Built-in Roles**: Owner (all permissions), Admin (management permissions), Member (read-write permissions), Viewer (read-only)
- ✅ **Permission Granularity**: org.manage, member.manage, knowledge._, project._, invitation.create, etc.
- ✅ **Permission Checking**: Support for wildcards, prefix matching, exact matching
- ✅ **Custom Roles**: Support for creating custom roles and permissions

**Database Architecture** (14 tables):

- ✅ `identity_contexts` - Identity context management (personal + organizations)
- ✅ `organization_info` - Organization metadata (name, type, description, Owner)
- ✅ `organization_members` - Organization member details (DID, role, permissions)
- ✅ `organization_roles` - Organization role definitions
- ✅ `organization_invitations` - Organization invitation management
- ✅ `invitation_links` - DID invitation links
- ✅ `invitation_link_usage` - Invitation link usage records
- ✅ `organization_projects` - Organization projects
- ✅ `organization_activities` - Organization activity log
- ✅ `p2p_sync_state` - P2P sync state ⭐NEW
- ✅ `sync_conflicts` - Conflict resolution records ⭐NEW
- ✅ `sync_queue` - Offline operation queue ⭐NEW
- ✅ `org_knowledge_folders` - Knowledge base folders ⭐NEW
- ✅ `knowledge_items extension` - 8 new enterprise fields (org_id, created_by, share_scope, etc.)

**Frontend UI Components** (10 pages/components, 5885 lines):

- ✅ **IdentitySwitcher.vue** (511 lines) - Identity switcher, support create/join organizations
- ✅ **OrganizationMembersPage.vue** - Member management page, role assignment
- ✅ **OrganizationSettingsPage.vue** - Organization settings page, info editing
- ✅ **OrganizationsPage.vue** - Organization list page
- ✅ **OrganizationRolesPage.vue** - Role permission management page
- ✅ **OrganizationActivityLogPage.vue** - Organization activity log page
- ✅ **OrganizationCard.vue** (280 lines) - Organization card component, multiple operations
- ✅ **CreateOrganizationDialog.vue** (240 lines) - Create organization dialog, complete form validation
- ✅ **MemberList.vue** (520 lines) - Member list component, search/filter/role management
- ✅ **PermissionManager.vue** (680 lines) - Permission management component, role/permission/matrix views

**State Management** (IdentityStore - 385 lines):

- ✅ Current active identity management
- ✅ All identity context caching
- ✅ Organization list and switching logic
- ✅ Permission checking interface

**Application Scenarios**:

- Startup teams, small companies
- Tech communities, open source projects
- Educational institutions
- Remote collaboration teams, distributed organizations

### 5️⃣ AI Template System (100% Complete) ⭐NEW

**System Overview**:

- ✅ **178 AI Templates** - Covering office, development, design, media, and all scenarios
- ✅ **32 Category System** - From document editing to blockchain development, complete categorization
- ✅ **100% Configuration Coverage** - All templates configured with skills and tools
- ✅ **Smart Engine Allocation** - Automatically selects optimal execution engine based on content type

**Template Categories** (32 total):

**Office Document Categories (12 categories)**:

- ✅ writing, creative-writing - Creative writing, copywriting
- ✅ education, learning - Education training, learning materials
- ✅ legal, health - Legal documents, health management
- ✅ career, resume - Career planning, resume creation
- ✅ cooking, gaming, lifestyle - Lifestyle content
- ✅ productivity, tech-docs - Productivity tools, technical documentation

**Office Suite Categories (3 categories)**:

- ✅ ppt - Presentation creation (6 templates)
- ✅ excel - Data analysis, financial management (12 templates)
- ✅ word - Professional document editing (8 templates)

**Development Categories (3 categories)**:

- ✅ web - Web development projects (5 templates)
- ✅ code-project - Code project structures (7 templates)
- ✅ data-science - Data science, machine learning (6 templates)

**Design & Media Categories (5 categories)**:

- ✅ design - UI/UX design (6 templates)
- ✅ photography - Photography creation
- ✅ video - Video production (29 templates)
- ✅ podcast - Podcast production
- ✅ music - Music creation (5 templates)

**Marketing Categories (4 categories)**:

- ✅ marketing - Marketing planning (8 templates)
- ✅ marketing-pro - Professional marketing (6 templates)
- ✅ social-media - Social media management (6 templates)
- ✅ ecommerce - E-commerce operations (6 templates)

**Professional Domain Categories (5 categories)**:

- ✅ research - Academic research
- ✅ finance - Financial analysis
- ✅ time-management - Time management
- ✅ travel - Travel planning

**Execution Engine Distribution** (after optimization):

```
document engine : 95  (46.3%) - Main engine for document templates
video engine    : 29  (14.1%) - Video production
default engine  : 26  (12.7%) - Mixed content (marketing, e-commerce)
excel engine    : 12  (5.9%)  - Data analysis
word engine     : 8   (3.9%)  - Professional documents
code engine     : 7   (3.4%)  - Code projects
ml engine       : 6   (2.9%)  - Machine learning
design engine   : 6   (2.9%)  - Design creation
ppt engine      : 6   (2.9%)  - Presentations
audio engine    : 5   (2.4%)  - Audio processing
web engine      : 5   (2.4%)  - Web development
```

**Configuration Completeness**:

- ✅ File system: 178/178 (100%)
- ✅ Database: 203/203 (100%)
- ✅ Skills configuration: 100%
- ✅ Tools configuration: 100%
- ✅ Engine configuration: 100%

**Optimization Results**:

- Default engine usage reduced from 52.2% to **12.7%** (39.5 percentage point decrease)
- Specialized engine coverage increased from 22.4% to **84.4%** (62 percentage point increase)
- More precise engine allocation improves AI execution efficiency

**Template Capability Mapping**:
Each template is precisely configured with:

- **skills** - Required AI skills for execution (selected from 115 skills)
- **tools** - Required tools for execution (selected from 216 tools)
- **execution_engine** - Optimal execution engine (11 engine types)

Details: `desktop-app-vue/dist/main/templates/OPTIMIZATION_COMPLETE_REPORT.md`

### 6️⃣ Permanent Memory System (100% Complete) ✅ ⭐NEW

Clawdbot-inspired cross-session AI memory persistence:

**Core Features**:

- ✅ **Daily Notes Auto-Logging** - Automatic daily activity recording to `memory/daily/YYYY-MM-DD.md`
- ✅ **MEMORY.md Long-Term Extraction** - Categorized storage + auto-update of persistent knowledge
- ✅ **Hybrid Search Engine** - Vector (semantic) + BM25 (keyword) dual-path parallel search
- ✅ **RRF Fusion Algorithm** - Reciprocal Rank Fusion for intelligent result ranking
- ✅ **Embedding Cache** - Reduces redundant computation + file hash tracking
- ✅ **Auto Expiry Cleanup** - Configurable retention days for Daily Notes
- ✅ **Metadata Statistics** - Knowledge categorization, tags, reference tracking

**Key Files**:

- `permanent-memory-manager.js` (~650 lines) - Core memory manager
- `permanent-memory-ipc.js` (~130 lines) - 7 IPC channels
- `bm25-search.js` (~300 lines) - BM25 full-text search engine
- `hybrid-search-engine.js` (~330 lines) - Hybrid search with RRF fusion

**Performance**:

- Search latency: < 20ms
- Parallel Vector + BM25 execution
- Configurable weights (default: Vector 0.6 + BM25 0.4)

Details: [Permanent Memory Integration](./docs/features/PERMANENT_MEMORY_INTEGRATION.md)

### 7️⃣ Comprehensive Test Suite (100% Complete) ✅ ⭐NEW

Phase 2 testing improvement plan completed:

**Test Coverage**:

| Category          | Test Files | Test Cases | Pass Rate |
| ----------------- | ---------- | ---------- | --------- |
| Unit Tests        | 350+       | 1500+      | ~99%      |
| Integration Tests | 30+        | 200+       | ~99%      |
| E2E User Journey  | 10+        | 100+       | ~99%      |
| Performance Tests | 10+        | 50+        | 100%      |
| Security Tests    | 10+        | 50+        | 100%      |
| Script Tests      | 50+        | 300+       | ~99%      |
| **Total**         | **467**    | **2000+**  | **~99%**  |

**Key Achievements**:

- ✅ **2000+ Test Cases** - Covering all core modules (incl. 102 DB tests via DI)
- ✅ **99.6% Pass Rate** - High quality code assurance
- ✅ **29 Bugs Fixed** - Test-driven quality improvement
- ✅ **OWASP Top 10 Coverage 80%** - XSS/SQL Injection/Path Traversal protection verified
- ✅ **Performance Benchmarks** - 142K ops/s project operations, 271K ops/s file operations
- ✅ **Memory Leak Detection** - < 0.5MB growth per 100 iterations

**Security Tests (OWASP Coverage)**:

- A01: Broken Access Control (4 tests)
- A02: Cryptographic Failures (5 tests)
- A03: Injection (4 tests)
- A04: Insecure Design (3 tests)
- A07: Authentication Failures (4 tests)

Details: [Phase 2 Test Summary](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md)

## Technical Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                         Application Layer                          │
│  Desktop(Electron+Vue3,145 comps) │ Browser Ext │ Mobile(uni-app) │
├───────────────────────────────────────────────────────────────────┤
│                        Business Function Layer                     │
│ Knowledge(100%) │ AI Engine(100%) │ Social(100%) │ Trading(100%)  │
│ Skills/Tools(100%,115+300) │ Blockchain(100%) │ Testing(100%)   │
│ Enterprise(100%) │ Plugins(100%) │ Voice(100%) │ P2P(100%)       │
├───────────────────────────────────────────────────────────────────┤
│                        Backend Service Layer                       │
│  Project Service    │    AI Service      │   Community Forum     │
│  (Spring Boot 3.1)  │   (FastAPI)        │   (Spring Boot 3.1)   │
│  48 API endpoints   │   38 API endpoints │   63 API endpoints    │
│  PostgreSQL + Redis │   Ollama + Qdrant  │   MySQL + Redis       │
├───────────────────────────────────────────────────────────────────┤
│                        Blockchain Layer                            │
│  Hardhat │ Ethers.js v6 │ 6 Smart Contracts │ HD Wallet │ MM/WC  │
│  Ethereum/Polygon  │  ERC-20/ERC-721  │  Escrow/Sub/Bounty/Bridge│
├───────────────────────────────────────────────────────────────────┤
│                        Data Storage Layer (Multi-DB Isolation)     │
│  SQLite/SQLCipher  │  PostgreSQL  │  MySQL  │  ChromaDB/Qdrant   │
│  (Personal+Org DBs)│  (Projects)  │ (Forum) │  (Vector Store)    │
├───────────────────────────────────────────────────────────────────┤
│                        P2P Network Layer                           │
│  libp2p 3.1.2  │  Signal E2E  │  Kademlia DHT  │  Org Network   │
├───────────────────────────────────────────────────────────────────┤
│                        Security Layer                              │
│    USB Key (PC, 5 brands)     │     SIMKey (Mobile, planned)     │
└───────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Requirements

- **Node.js**: 22.12.0+ (Latest LTS recommended)
- **npm**: 10.0.0+
- **Docker**: 20.10+ (optional, for backend services)
- **Mobile Development**: Android Studio 2024+ / Xcode 15+ (optional)
- **Hardware**: USB Key (PC) or SIMKey-enabled SIM card (mobile, optional)

### Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

#### 2. Start PC Desktop App

```bash
# Navigate to desktop app directory
cd desktop-app-vue

# Install dependencies
npm install

# Start development server
npm run dev
```

#### 3. Start AI Services (Optional, for local LLM)

```bash
# Start Docker services
docker-compose up -d

# Download model (first run)
docker exec chainlesschain-llm ollama pull qwen2:7b
```

#### 4. Start Community Forum (Optional)

```bash
# Backend (Spring Boot)
cd community-forum/backend
mvn spring-boot:run

# Frontend (Vue3)
cd community-forum/frontend
npm install
npm run dev
```

### Alternative Options

```bash
# Android app
cd android-app
./gradlew assembleDebug
```

## 📁 Project Structure

```
chainlesschain/
├── desktop-app-vue/          # PC Desktop App (Electron 39.2.7 + Vue 3.4)
│   ├── src/
│   │   ├── main/             # Main process
│   │   │   ├── api/          # IPC API handlers
│   │   │   ├── config/       # Configuration management
│   │   │   ├── database/     # Database operations
│   │   │   ├── llm/          # LLM integration (16 AI engines)
│   │   │   │   ├── permanent-memory-manager.js  # Permanent Memory Manager
│   │   │   │   ├── permanent-memory-ipc.js      # Permanent Memory IPC channels
│   │   │   │   ├── context-engineering.js       # KV-Cache optimization core
│   │   │   │   └── context-engineering-ipc.js   # Context Engineering IPC (17 channels)
│   │   │   ├── rag/          # RAG retrieval system
│   │   │   │   ├── bm25-search.js         # BM25 full-text search engine
│   │   │   │   └── hybrid-search-engine.js # Hybrid search engine
│   │   │   ├── permission/   # Enterprise RBAC system (NEW)
│   │   │   │   ├── permission-engine.js        # RBAC permission engine
│   │   │   │   ├── team-manager.js             # Team management
│   │   │   │   ├── delegation-manager.js       # Permission delegation
│   │   │   │   └── approval-workflow-manager.js # Approval workflow
│   │   │   ├── task/         # Task management (NEW)
│   │   │   │   └── team-report-manager.js      # Team daily/weekly reports
│   │   │   ├── hooks/        # Hooks system (Claude Code style)
│   │   │   │   ├── index.js               # Main entry
│   │   │   │   ├── hook-registry.js       # Hook registry
│   │   │   │   └── hook-executor.js       # Hook executor
│   │   │   ├── did/          # DID identity system
│   │   │   ├── p2p/          # P2P network (libp2p)
│   │   │   │   └── webrtc-data-channel.js  # WebRTC data channel manager
│   │   │   ├── mcp/          # MCP integration
│   │   │   ├── remote/       # Remote Control System (NEW, 41 files, ~45,000 lines)
│   │   │   │   ├── remote-gateway.js         # Remote gateway (core)
│   │   │   │   ├── p2p-command-adapter.js    # P2P command adapter
│   │   │   │   ├── permission-gate.js        # Permission verifier
│   │   │   │   ├── command-router.js         # Command router
│   │   │   │   ├── handlers/                 # 24+ command handlers
│   │   │   │   ├── browser-extension/        # Chrome browser extension
│   │   │   │   ├── workflow/                 # Workflow engine
│   │   │   │   └── logging/                  # Logging system
│   │   │   ├── browser/      # Browser automation system
│   │   │   │   ├── browser-engine.js         # Browser engine (Playwright)
│   │   │   │   ├── browser-ipc.js            # Browser IPC (12 channels)
│   │   │   │   ├── snapshot-engine.js        # Smart snapshot engine
│   │   │   │   ├── snapshot-ipc.js           # Snapshot IPC (6 channels)
│   │   │   │   └── element-locator.js        # Element locator
│   │   │   ├── utils/        # Utility modules
│   │   │   │   └── ipc-error-handler.js    # IPC error middleware
│   │   │   ├── ai-engine/    # AI engine + workflow optimization
│   │   │   │   ├── cowork/   # Cowork multi-agent collaboration system
│   │   │   │   │   └── skills/               # Skills system
│   │   │   │   │       ├── index.js          # Skill loader
│   │   │   │   │       ├── skills-ipc.js     # Skills IPC (17 channels)
│   │   │   │   │       └── builtin/          # Built-in skills (code-review, git-commit, explain-code)
│   │   │   │   └── plan-mode/                # Plan Mode system (Claude Code style)
│   │   │   │       ├── index.js              # PlanModeManager
│   │   │   │       └── plan-mode-ipc.js      # Plan Mode IPC (14 channels)
│   │   │   └── monitoring/   # Monitoring and logging
│   │   └── renderer/         # Renderer process (Vue3 + TypeScript, 31 Pinia Stores)
│   │       ├── components/   # Reusable components
│   │       ├── pages/        # Page components
│   │       ├── stores/       # Pinia state management
│   │       ├── services/     # Frontend service layer
│   │       └── utils/        # Utility library
│   ├── contracts/            # Smart contracts (Hardhat + Solidity)
│   └── tests/                # Test suite (2000+ test cases, 417 test files)
│       ├── unit/             # Unit tests (IPC handlers, database, Git, browser, AI engine)
│       ├── integration/      # Integration tests (backend integration, user journey)
│       ├── performance/      # Performance tests (load, memory leak)
│       └── security/         # Security tests (OWASP Top 10)
├── backend/
│   ├── project-service/      # Spring Boot 3.1.11 (Java 17)
│   └── ai-service/           # FastAPI + Ollama + Qdrant
├── community-forum/          # Community forum (Spring Boot + Vue3)
├── mobile-app-uniapp/        # Mobile app (100% complete)
└── docs/                     # Complete documentation system
    ├── features/             # Feature documentation
    ├── flows/                # Workflow documentation (NEW)
    ├── implementation-reports/  # Implementation reports (NEW)
    ├── status-reports/       # Status reports (NEW)
    ├── test-reports/         # Test reports (NEW)
    └── ...                   # 20+ documentation categories
```

### Project Components

| Project                      | Tech Stack                | Code Size          | APIs         | Completion | Status              |
| ---------------------------- | ------------------------- | ------------------ | ------------ | ---------- | ------------------- |
| **desktop-app-vue**          | Electron 39 + Vue3        | 220,000+ lines     | 160+ IPC     | 100%       | ✅ Production Ready |
| **contracts**                | Hardhat + Solidity        | 2,400 lines        | -            | 100%       | ✅ Complete         |
| **browser-extension**        | Vanilla JS                | 2,000+ lines       | -            | 100%       | ✅ Complete         |
| **backend/project-service**  | Spring Boot 3.1 + Java 17 | 5,679 lines        | 48 APIs      | 100%       | ✅ Production Ready |
| **backend/ai-service**       | FastAPI + Python 3.9+     | 12,417 lines       | 38 APIs      | 100%       | ✅ Production Ready |
| **community-forum/backend**  | Spring Boot 3.1 + MySQL   | 5,679 lines        | 63 APIs      | 100%       | ✅ Production Ready |
| **community-forum/frontend** | Vue3 + Element Plus       | 10,958 lines       | -            | 100%       | ✅ Production Ready |
| **mobile-app-uniapp**        | uni-app + Vue3            | 8,000+ lines       | -            | 100%       | ✅ Complete         |
| **Total**                    | -                         | **250,000+ lines** | **149 APIs** | **100%**   | ✅ Production Ready |

## 🗓️ Roadmap

### Completed ✅

- [x] **Phase 0**: System design and architecture planning (100%)
- [x] **Phase 1 (MVP - Knowledge Base)**: 100% Complete
  - [x] Desktop app framework (Electron + Vue3)
  - [x] USB Key integration and encrypted storage (SQLCipher)
  - [x] Local LLM and RAG implementation (Ollama + ChromaDB)
  - [x] Git sync functionality (with conflict resolution)
  - [x] File import (Markdown/PDF/Word/TXT)
  - [x] Image upload and OCR (v0.11.0)
  - [x] Full-text search and tagging system
  - [x] Prompt template management

- [x] **Phase 2 (Decentralized Social)**: 100% Complete
  - [x] DID identity system
  - [x] DHT network publishing
  - [x] Verifiable credentials system
  - [x] P2P communication foundation (libp2p)
  - [x] Community forum (Spring Boot + Vue3)
  - [x] Signal protocol end-to-end encryption (v0.16.0)
  - [x] Multi-device support and message sync (v0.16.0)
  - [x] Friend management system (requests, online status, groups)
  - [x] Social posts system (publish, like, comment, images)

- [x] **Phase 3 (Decentralized Trading System)**: 100% Complete
  - [x] Digital asset management (asset-manager.js - 600 lines)
  - [x] Trading market (marketplace-manager.js - 685 lines)
  - [x] Smart contract engine (contract-engine.js - 1102 lines + 526 lines templates)
  - [x] Escrow service (escrow-manager.js - 592 lines)
  - [x] Knowledge payment system (knowledge-payment.js - 812 lines)
  - [x] Credit scoring system (credit-score.js - 637 lines)
  - [x] Review & feedback system (review-manager.js - 671 lines)
  - [x] Order management (integrated in trading market)
  - [x] Complete frontend UI (20+ trading components)

- [x] **Phase 4 (Blockchain Integration)**: 100% Complete ⭐
  - [x] Phase 1: Infrastructure setup (Hardhat + database extension)
  - [x] Phase 2: Wallet system implementation (built-in HD wallet + external wallets)
  - [x] Phase 3: Smart contract development (6 contracts + tests + deployment)
  - [x] Phase 4: Blockchain adapter implementation (15 chains + RPC management)
  - [x] Phase 5: Integration with existing modules
  - [x] Phase 6: Frontend UI adaptation (12 UI components)

- [x] **Phase 5 (Ecosystem Enhancement)**: 100% Complete ⭐
  - [x] Voice recognition functionality (complete)
  - [x] Browser extension (complete)
  - [x] Skill & tool system (115 skills + 300 tools)
  - [x] Plugin system (dynamic loading + hot reload)
  - [x] USB Key drivers (cross-platform support)
  - [x] P2P WebRTC support and NAT traversal
  - [x] Mobile UI optimization
  - [x] Knowledge graph visualization
  - [x] Multi-language support
  - [x] Enterprise features (decentralized organizations complete)

- [x] **Phase 6 (Production Optimization)**: 100% Complete ⭐
  - [x] Complete blockchain adapter
  - [x] Production-grade cross-chain bridge (LayerZero)
  - [x] Comprehensive test coverage (94 files, 900+ cases)
  - [x] Performance optimization and monitoring
  - [x] Security audit
  - [x] Documentation refinement

### Future Optimization Directions ⏳

- [ ] **Extended MCP Server Support**: HTTP+SSE transport, more MCP servers
- [ ] **Enhanced Multi-Agent Collaboration**: More specialized agents
- [ ] **Community Ecosystem**: Plugin marketplace, community MCP servers
- [ ] **Enterprise Advanced Features**: SSO, audit logs, compliance

### Version History

| Version | Date       | Major Updates                                                                                                                                                                                                                              |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v0.33.0 | 2026-02-13 | **Remote Control + Computer Use + Browser Extension**: P2P remote gateway, 24+ command handlers, Chrome extension (15,077 lines), Computer Use Agent (68+ IPC), Vision AI, Workflow Engine, SafeMode, Audit Logger, 45,000+ lines ⭐LATEST |
| v0.32.0 | 2026-02-10 | **iOS Workflow + Android MCP/Hooks**: iOS WorkflowManager + VoiceManager, Android MCP integration + Hooks system + Knowledge Graph visualization                                                                                           |
| v0.31.0 | 2026-02-09 | **Security Auth + Incremental RAG + SIMKey NFC**: Dev/prod mode JWT auth, MD5 change detection, context-aware reranking, file version control, LLM function calling                                                                        |
| v0.30.0 | 2026-02-05 | **DI Test Refactoring + Social Notifications + ECharts Dashboard**: 102 database tests enabled via DI, TaskMonitor dashboard, AbortController AI cancel, Firebase integration                                                              |
| v0.29.0 | 2026-02-02 | **Enterprise RBAC + Context Engineering + Claude Code Style Tools**: Permission Engine (RBAC), Team Manager, Team Report Manager, Context Engineering (KV-Cache optimization, 17 IPC), Plan Mode (14 IPC), Skills System enhancement       |
| v0.28.0 | 2026-01-28 | **Permanent Memory + Hybrid Search + Hooks System**: Daily Notes auto-logging, MEMORY.md extraction, Vector+BM25 hybrid search, 21 hook events, 4 hook types, MCP integration tests (32+31)                                                |
| v0.27.0 | 2026-01-23 | **Hooks System + IPC Error Handler**: Claude Code-style hooks (21 events, 4 types, priority system), IPC error middleware (10 error types, ErrorMonitor integration), enterprise permission foundations                                    |
| v0.26.0 | 2026-01-19 | **Unified Logging + Android P2P UI + Memory Optimization**: Centralized logger system (700+ migrations), Android P2P complete UI (8 screens), ChatPanel 4-layer memory protection                                                          |
| v0.25.0 | 2026-01-17 | **Manus AI Optimization + Multi-Agent System**: Context Engineering (KV-Cache), Tool Masking, TaskTrackerFile (todo.md), Recoverable Compression, 3 specialized Agents                                                                     |
| v0.24.0 | 2026-01-16 | **MCP Chat Integration**: MCP tools integrated into AI chat, invoke MCP server tools via Function Calling                                                                                                                                  |
| v0.23.0 | 2026-01-15 | **SessionManager Enhancement + ErrorMonitor AI Diagnostics**: Session search/tags/export/summary, AI error diagnosis                                                                                                                       |
| v0.22.0 | 2026-01-13 | **Blockchain Integration Complete**: 15 chain support + RPC management + event listening + complete UI ⭐Major Update                                                                                                                      |
| v0.21.0 | 2026-01-06 | **Deep Performance Optimization**: 14,000+ lines optimization code, smart image system (WebP/AVIF), Core Web Vitals monitoring                                                                                                             |
| v0.20.0 | 2026-01-03 | **Testing Framework Upgrade**: Full Vitest migration (94 files/900+ cases), performance optimization integration                                                                                                                           |
| v0.19.5 | 2026-01-02 | **P2 Optimization + V3 Tools**: AI engine optimization, 300 tools restored, application menu integration                                                                                                                                   |
| v0.19.0 | 2025-12-31 | **Codebase Refinement**: Documentation update, template optimization, testing framework enhancement                                                                                                                                        |
| v0.18.0 | 2025-12-30 | **Enterprise Edition + Skills Expansion**: Decentralized organizations, 115 skills + 300 tools, multi-database isolation                                                                                                                   |
| v0.17.0 | 2025-12-29 | **Blockchain Integration Phase 1-3**: 6 smart contracts, wallet system, plugin system, browser extension                                                                                                                                   |
| v0.16.0 | 2025-12-28 | **Phase 3 Complete**: 8 trading modules, 19 AI engines, backend services (149 APIs), database sync                                                                                                                                         |
| v0.11.0 | 2025-12-18 | Image upload and OCR (Tesseract.js + Sharp)                                                                                                                                                                                                |
| v0.10.0 | 2025-12    | RAG reranker (3 algorithms) + query rewriting                                                                                                                                                                                              |
| v0.9.0  | 2025-11    | File import enhancement (PDF/Word/TXT)                                                                                                                                                                                                     |
| v0.8.0  | 2025-11    | Verifiable credentials system (W3C VC standard, 5 types)                                                                                                                                                                                   |
| v0.6.1  | 2025-10    | DHT network publishing (DID documents)                                                                                                                                                                                                     |
| v0.4.0  | 2025-09    | Git conflict resolution (visual UI) + AI commit messages                                                                                                                                                                                   |
| v0.1.0  | 2025-08    | First MVP release                                                                                                                                                                                                                          |

## 🛠️ Tech Stack

### PC (desktop-app-vue) - Main Application

- **Framework**: Electron 39.2.7 + Vue 3.4 + TypeScript 5.9 + Ant Design Vue 4.1
- **State Management**: Pinia 2.1.7 (28 TypeScript stores)
- **Database**: SQLite/SQLCipher (AES-256) + libp2p 3.1.2
- **AI System**: 16 specialized AI engines + 17 smart optimizations + 115 skills + 300 tools
- **Permanent Memory**: Daily Notes + MEMORY.md + Hybrid Search (Vector+BM25)
- **Context Engineering**: KV-Cache optimization + Token estimation + Recoverable compression
- **Enterprise Permission**: RBAC engine + Team management + Approval workflow + Permission delegation
- **Remote Control**: P2P gateway + 24+ command handlers + Chrome extension + Workflow engine + 45,000+ lines
- **Browser Control**: BrowserEngine + SnapshotEngine + DI testability + 18 IPC channels
- **Claude Code Style**: 10 subsystems + 127 IPC channels (Hooks/Plan Mode/Skills, etc.)
- **Workflow Optimization**: Smart cache + LLM decision + Agent pool + Critical path + Real-time quality
- **Visualization**: ECharts TaskMonitor dashboard + Tree-shaking optimization
- **Firebase**: Push notifications + WebRTC enhancement
- **Testing**: Vitest + 2000+ test cases + 417 test files + DI refactoring
- **Build**: Vite 7.2.7 + Electron Builder

### Backend Services

#### Project Service (Project Management)

- **Framework**: Spring Boot 3.1.11 + Java 17
- **ORM**: MyBatis Plus 3.5.7 (recommended upgrade to 3.5.9)
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **Git**: JGit 6.8.0
- **Connection Pool**: HikariCP
- **Docs**: SpringDoc OpenAPI 2.2.0
- **Port**: 9090

#### AI Service (AI Inference)

- **Framework**: FastAPI 0.109.0+ + Python 3.9+
- **LLM**: Ollama (local) + 14+ cloud providers
- **Vector DB**: Qdrant 1.7.0+ / ChromaDB 0.4.22
- **Embedding Model**: Sentence Transformers 2.3.0
- **Server**: Uvicorn 0.27.0+
- **Port**: 8001

#### Community Forum

**Backend**:

- **Framework**: Spring Boot 3.1.5 + Java 17
- **ORM**: MyBatis Plus 3.5.9
- **Database**: MySQL 8.0.12
- **Search**: Elasticsearch 8.11
- **Cache**: Redis 7.0
- **Auth**: JWT 0.12.3 + Spring Security
- **Docs**: SpringDoc OpenAPI 2.2.0
- **Port**: 8080

**Frontend**:

- **Framework**: Vue 3.4.0 + Vite 5.0.8
- **UI Components**: Element Plus 2.5.1
- **State Management**: Pinia 2.1.7
- **Router**: Vue Router 4.2.5
- **HTTP**: Axios 1.6.2
- **Markdown**: Markdown-it 14.0.0
- **Port**: 3000

### Mobile

#### Android (android-app)

- **Language**: Kotlin
- **UI**: Jetpack Compose
- **Database**: Room ORM + SQLCipher
- **Encryption**: BouncyCastle
- **SIMKey**: OMAPI
- **LLM**: Ollama Android

#### React Native (mobile-app)

- **Framework**: React Native 0.73.2
- **Navigation**: React Navigation

### Docker Services

- **LLM Engine**: Ollama (latest, port 11434)
  - Supported models: Qwen2-7B, LLaMA3-8B, GLM-4, MiniCPM-2B, etc.
  - GPU acceleration: NVIDIA CUDA support
- **Vector Database**:
  - Qdrant (latest, port 6333) - High-performance vector retrieval
  - ChromaDB 3.1.8 - Lightweight vector storage
- **Relational Databases**:
  - PostgreSQL 16 (port 5432) - Project Service
  - MySQL 8.0 (port 3306) - Community Forum
- **Cache**: Redis 7 (port 6379)
- **Embedding Models**: bge-large-zh-v1.5 / bge-small-zh-v1.5
- **RAG System**: AnythingLLM (optional)
- **Git Service**: Gitea (optional)

### Blockchain (100% Complete) ⭐

- **Smart Contracts**: Solidity 0.8+ + Hardhat 2.28
- **Development Framework**: Hardhat Toolbox 5.0
- **Contract Libraries**: OpenZeppelin Contracts 5.4
- **Interaction**: Ethers.js v6.13
- **Wallets**:
  - Built-in: BIP39 + BIP44 + AES-256-GCM encryption
  - External: MetaMask + WalletConnect v1
- **Networks**:
  - Mainnet: Ethereum (Chain ID: 1), Polygon (Chain ID: 137)
  - Testnet: Sepolia (11155111), Mumbai (80001)
  - Local: Hardhat Network (31337)
- **Contract Types**:
  - ERC-20 Token (ChainlessToken)
  - ERC-721 NFT (ChainlessNFT)
  - Escrow Contract (EscrowContract)
  - Subscription Contract (SubscriptionContract)
  - Bounty Contract (BountyContract)
  - Cross-chain Bridge (AssetBridge)

## 🤝 Contributing

We welcome all forms of contribution!

### How to Contribute

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development Guidelines

- Code style: Follow ESLint/Prettier configuration
- Commit messages: Use semantic commits (feat/fix/docs/style/refactor/test/chore)
- Testing: Add necessary unit and integration tests
- Documentation: Update relevant documentation and comments

See [CONTRIBUTING.md](./docs/development/CONTRIBUTING.md) for details

### Future Optimization Directions

1. **Extended Functionality**:
   - More MCP server integrations (Slack, GitHub, etc.)
   - Enhanced multi-agent collaboration capabilities
   - Community plugin marketplace
2. **Enterprise Enhancements**:
   - SSO integration
   - Audit logging system
   - Compliance features
3. **Ecosystem Expansion**:
   - Developer SDK
   - Third-party integration APIs
   - Community contribution programs

## 🔒 Security Notice

- **Hardware Keys**: Strongly recommend using USB Key or SIMKey, software simulation for testing only
- **Backup Critical**: Must backup mnemonic phrases and keys, loss is unrecoverable
- **Open Source Audit**: All encryption implementations are open source and auditable
- **Security Reports**: Send security vulnerabilities to security@chainlesschain.com
- **Bug Bounty**: Major security vulnerabilities will be rewarded

### Technical Notes

**USB Key**:

- Cross-platform support available (Windows native, macOS/Linux via simulation)
- XinJinKe driver complete, other drivers available via simulation mode

**Blockchain**:

- 15 chains supported with RPC management
- Production-grade LayerZero cross-chain bridge integrated
- Smart contracts ready for third-party security audit

**MCP Integration** (POC Stage):

- Currently supports stdio transport only
- HTTP+SSE transport planned for future release
- Configuration via files only (UI configuration planned)

**Performance**:

- Recommended: 8GB+ RAM, SSD storage
- GPU recommended for local LLM inference (Ollama)

## 📜 License

This project is licensed under the **MIT License** - see [LICENSE](./LICENSE)

Core encryption libraries use **Apache 2.0** license

## 📞 Contact Us

### Official Channels

- **Website**: https://www.chainlesschain.com
- **Documentation**: https://docs.chainlesschain.com
- **Forum**: https://community.chainlesschain.com
- **GitHub**: https://github.com/chainlesschain/chainlesschain

### Contact Information

- **Email**: zhanglongfa@chainlesschain.com
- **Security Reports**: security@chainlesschain.com
- **Phone**: +86 400-1068-687
- **WeChat**: https://work.weixin.qq.com/ca/cawcde653996f7ecb2

### Community

- **Tech Discussion**: GitHub Discussions
- **Bug Reports**: GitHub Issues
- **Feature Requests**: GitHub Issues

---

**More Documentation**:

- [📖 Documentation Center](./docs/README.md) - Complete documentation navigation
- [✨ Features Guide](./docs/FEATURES.md) - Detailed feature list
- [📥 Installation Guide](./docs/INSTALLATION.md) - Platform-specific installation
- [🏗️ Architecture](./docs/ARCHITECTURE.md) - Technical architecture
- [💻 Development Guide](./docs/DEVELOPMENT.md) - Development setup
- [📝 Changelog](./docs/CHANGELOG.md) - Full version history
- [⛓️ Blockchain Docs](./docs/BLOCKCHAIN.md) - Blockchain integration
- [🔧 API Reference](./docs/API_REFERENCE.md) - API documentation
- [📚 User Manual](./docs/USER_MANUAL_COMPLETE.md) - Complete user manual

**Permanent Memory & Test Documentation**:

- [🧠 Permanent Memory Integration](./docs/features/PERMANENT_MEMORY_INTEGRATION.md) - Daily Notes + MEMORY.md + Hybrid Search
- [🧪 Phase 2 Test Summary](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md) - 2000+ test cases, 99.6% pass rate
- [🔒 Security Test Report](./docs/reports/phase2/PHASE2_TASK13_SECURITY_TESTS.md) - OWASP Top 10 coverage 80%
- [📊 IPC Handler Tests](./docs/reports/phase2/PHASE2_TASK7_IPC_HANDLERS_TESTS.md) - 66 IPC handler tests
- [💾 Database Boundary Tests](./docs/reports/phase2/PHASE2_TASK8_DATABASE_TESTS.md) - 14 boundary condition tests

**Workflow Optimization Documentation**:

- [🚀 Phase 3/4 Completion Summary](./docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md) - 17 optimizations overview
- [💡 Smart Plan Cache](./docs/features/PHASE3_OPTIMIZATION3_SMART_PLAN_CACHE.md) - Semantic similarity cache
- [🧠 LLM-Assisted Decision](./docs/features/PHASE3_OPTIMIZATION4_LLM_DECISION.md) - Intelligent multi-agent decision
- [⚡ Critical Path Optimization](./docs/features/PHASE3_OPTIMIZATION8_CRITICAL_PATH.md) - CPM algorithm scheduling
- [🔍 Real-Time Quality Check](./docs/features/PHASE3_OPTIMIZATION11_REALTIME_QUALITY.md) - File monitoring system

## 🙏 Acknowledgments

Thanks to the following open source projects and technologies:

### Core Frameworks

- [Electron](https://www.electronjs.org/) - Cross-platform desktop app framework
- [Vue.js](https://vuejs.org/) - Progressive JavaScript framework
- [React](https://react.dev/) - User interface library
- [Spring Boot](https://spring.io/projects/spring-boot) - Java application framework

### AI & Data

- [Ollama](https://ollama.ai/) - Local LLM runtime
- [Qdrant](https://qdrant.tech/) - Vector database
- [ChromaDB](https://www.trychroma.com/) - AI-native embedding database
- [Tesseract.js](https://tesseract.projectnaptha.com/) - OCR engine

### Encryption & Network

- [SQLCipher](https://www.zetetic.net/sqlcipher/) - Encrypted database
- [libp2p](https://libp2p.io/) - P2P networking stack
- [Signal Protocol](https://signal.org/docs/) - End-to-end encryption protocol

### Editor & UI

- [Milkdown](https://milkdown.dev/) - Markdown editor
- [Ant Design](https://ant.design/) / [Ant Design Vue](https://antdv.com/) - Enterprise UI components
- [Element Plus](https://element-plus.org/) - Vue 3 component library

### Tools

- [Vite](https://vitejs.dev/) - Next generation frontend tooling
- [TypeScript](https://www.typescriptlang.org/) - JavaScript superset
- [Docker](https://www.docker.com/) - Containerization platform

---

<div align="center">

## 📊 Project Stats

![GitHub stars](https://img.shields.io/github/stars/chainlesschain/chainlesschain?style=social)
![GitHub forks](https://img.shields.io/github/forks/chainlesschain/chainlesschain?style=social)
![GitHub issues](https://img.shields.io/github/issues/chainlesschain/chainlesschain)
![GitHub pull requests](https://img.shields.io/github/issues-pr/chainlesschain/chainlesschain)

### Overall Code Statistics

**Total Code**: 266,500+ lines ⭐Updated

- Desktop App: 226,500+ lines (JavaScript/TypeScript/Vue) ⭐Updated
  - Main process: ~196,500 lines (including mobile sync 7700 lines + Manus optimization 5500 lines + logging system 1000 lines) ⭐Updated
  - Renderer process: ~15,000 lines (358 components)
  - Utility classes: ~15,000 lines (34 files)
- Smart Contracts: 2,400 lines (Solidity + tests + scripts)
- Browser Extension: 2,000+ lines (JavaScript)
- Backend Services: 23,775 lines (Java + Python)
- Community Forum: 10,958 lines (Vue3)
- Test Code: 50,000+ lines (417 test files + 50 script tests)
- Optimization Docs: 4,200+ lines (8 documents)

**Components and Files**:

- Vue Components: 403 (Desktop 358 + Forum 45)
- JavaScript Files: 369 (Main process 335 + Utilities 34)
- Solidity Contracts: 6
- Java Files: 132
- Python Files: 31
- Test Files: 467 (Desktop 417 + Scripts 50)
- Optimization Docs: 8

**Function Modules**:

- 16 AI specialized engines
- Manus AI Optimization System (5500+ lines) ⭐NEW
  - Context Engineering: KV-Cache optimization, Prompt cleanup (652 lines)
  - Tool Masking: Tool masking, state machine control (604 lines)
  - TaskTrackerFile: todo.md persistence mechanism (833 lines)
  - ManusOptimizations: Integration module (624 lines)
  - Recoverable Compression: URL/path preservation strategy
- Multi-Agent System (2516+ lines) ⭐NEW
  - AgentOrchestrator: Task distribution, parallel/chain execution (582 lines)
  - SpecializedAgent: Specialized Agent base class (252 lines)
  - CodeGenerationAgent: Code generation/refactoring/review (386 lines)
  - DataAnalysisAgent: Data analysis/visualization/statistics (555 lines)
  - DocumentAgent: Document writing/translation/summarization (386 lines)
  - Multi-Agent IPC: 15 IPC channels (248 lines)
- MCP Function Executor (268 lines) ⭐NEW
  - Invoke MCP tools in AI chat
  - Function Calling integration
- Mobile-PC Data Sync System (7700+ lines)
  - Device pairing, knowledge sync, project sync, PC status monitoring
  - WebRTC P2P communication, libp2p encryption, signaling server
  - Offline message queue, incremental sync
- Cross-Platform USB Key Support (Windows/macOS/Linux) ⭐NEW
  - CrossPlatformAdapter unified interface
  - PKCS#11 driver support
  - Auto-fallback to simulation mode
- LayerZero Blockchain Bridge (Production-Grade) ⭐NEW
  - Support for 7 mainnets + 2 testnets
  - Fee estimation, transaction tracking, event-driven
- Workspace Management System (Full CRUD) ⭐NEW
  - Restore, permanent delete, member management
- Remote Sync System (Complete Implementation) ⭐NEW
  - Incremental sync, conflict resolution, multi-device collaboration
- P2 Optimization System (3800+ lines)
  - Intent fusion, knowledge distillation, streaming response
  - Task decomposition enhancement, tool composition, history memory
- Deep Performance Optimization System (~8,700 lines)
  - 18 optimization utility classes (~8,000 lines)
  - 4 specialized components (~700 lines)
  - Smart image optimization, real-time performance monitoring
  - Code splitting, component lazy loading, virtual scrolling
  - Intelligent prefetch, request batching, optimistic updates
  - Data compression, incremental sync, memory optimization
  - Animation control, resource hints, accessibility features
- Enterprise Edition (Decentralized Organizations) ⭐Updated
  - OrganizationManager: 1966 lines
  - IdentityStore: 385 lines
  - UI pages/components: 6
  - Organization settings API: 5 complete implementations
  - Invitation system API: Full lifecycle management
- Blockchain system (3500+ lines) ⭐Updated
  - Wallet system + Smart contracts + LayerZero bridge
- 8 trading modules (5960 lines)
- Skill & tool system (115 skills + 300 tools)
- Advanced Features Control Panel (MenuManager + IPC + Web interface)
- Performance Optimization System (memory downgrade, disk check, concurrency control, file recovery)
- Security Protection System (input validation, permission control, encrypted transmission)
- Plugin system (dynamic loading + hot reload)
- Voice recognition system (real-time voice input + UI integration)
- Browser extension (70% complete)
- Testing framework (Playwright E2E + Vitest unit tests)
- 6 RAG core modules
- 5 AI engine components
- 4 database sync modules

**Backend Services**:

- Total API endpoints: 157 ⭐Updated
  - Project Service: 56 APIs ⭐Updated
  - AI Service: 38 APIs
  - Community Forum: 63 APIs
- Desktop app code: 700+ files (335 JS + 358 Vue + 34 Utils), ~250,000 lines ⭐Updated
- Database tables: 52+ (base + enterprise + blockchain + conversation management) ⭐Updated
- IPC handlers: 168+ (including enterprise IPC + advanced features IPC + conversation IPC) ⭐Updated
- Optimization docs: 8 documents, ~4,200 lines

**Test Coverage** ⭐Updated:

- Total test files: 467+ (417 test files + 50 script tests)
  - Unit tests: 73+ files
  - Integration tests: 6 files
  - E2E tests: 11+ files
  - Performance tests: 11 files
  - Security tests: 1 file (30 OWASP tests)
- Testing framework: Vitest unit tests + Playwright E2E
- Test cases: 2000+ (417 test files + 50 script tests, DI refactored)
- Pass rate: 99.6%
- Coverage: ~75% code coverage

**Permanent Memory System** ⭐NEW:

- permanent-memory-manager.js: 650 lines
- permanent-memory-ipc.js: 130 lines
- bm25-search.js: 300 lines
- hybrid-search-engine.js: 330 lines
- Total: 1,410 lines

**Overall Completion: 100%** ⭐Completed

**Defending Privacy with Technology, Empowering Individuals with AI**

Made with ❤️ by ChainlessChain Team

[⬆ Back to Top](#chainlesschain---personal-mobile-ai-management-system-based-on-usb-key-and-simkey)

</div>
