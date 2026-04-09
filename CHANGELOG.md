# Changelog

All notable changes to ChainlessChain will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-04-09 — CLI Runtime 收口闭环 (Phase 7 Parity Harness)

### Added

- **Phase 7 Parity Harness 全量落地** — CLI Runtime 收口路线图 (`docs/design/modules/82_CLI_Runtime收口路线图.md`) Phase 0–7 全部完成，统一 Coding Agent envelope 协议 v1.0 在 CLI / Desktop / Web UI 三端达成字节级对齐。
  - 8 步 parity 测试矩阵全部通过（91 tests）：envelope 契约、sequence tracker、legacy→unified 双向映射、WS server envelope 透传、JSONL session store、SubAgentContext worktree 隔离、mock LLM provider、desktop bridge envelope parity。
  - 新增 `packages/cli/__tests__/integration/parity-envelope-bridge.test.js`(58 tests)覆盖 `createCodingAgentEvent` / `CodingAgentSequenceTracker` / `wrapLegacyMessage` / `unwrapEnvelope` / 数据驱动 roundtrip / `validateCodingAgentEvent` / `mapLegacyType` 全路径。
  - `src/lib/agent-core.js` / `src/lib/ws-server.js` / `src/lib/ws-agent-handler.js` 降级为 @deprecated shim（26/16/12 行），canonical 实现收归 `src/runtime/` 与 `src/gateways/ws/`。

### Status

- 收口完成定义 5 项准则全部达成 ✅（见 82 路线图 §8）：单一入口、envelope 协议统一、parity harness 全绿、shim 明确标注迁移窗口、文档同步。

### Docs

- 同步更新 `docs-site/docs/chainlesschain/cli-runtime-convergence-roadmap.md` 与 `docs-site/docs/design/modules/82-cli-runtime-convergence.md` 镜像至 canonical。

## [v0.45.55–v0.45.61] - 2026-04-08 — 技术债收官 (M2 + IPC Registry)

### Performance

- **M2 启动期同步 IO 异步化收官** — 把启动关键路径上的同步 IO 全部转为 `fs.promises`，避免阻塞 Electron 主进程事件循环。共改造 11 个模块（unified-config-manager / ai-engine-config / tool-skill-mapper-config / mcp-config-loader / database-config / logger / git-auto-commit / project-config + 3 个 ai-engine-manager 变体）。所有改造均使用 `_deps` 注入模式以保持单元测试可 mock；同步 API 作为运行时快路径保留。
  - v0.45.58: `project-config.js` 新增 `initializeAsync` / `loadConfigAsync` / `saveConfigAsync` + `getProjectConfigAsync()` 工厂；`ai-engine-manager.js` / `ai-engine-manager-p1.js` / `ai-engine-manager-optimized.js` 三个变体的 `initialize()` 改用 `await getProjectConfigAsync()`。

### Refactored

- **IPC Registry 收官** (v0.45.59~60)
  - **v0.45.59** — `ipc-registry.js` 的 Phase 5 / Phase 9-15 deps 构造曾用 `{ mcpClientManager, mcpToolAdapter }` 简写但顶部从未声明这两个标识符。由于 `...dependencies` 已经覆盖了它们，简写引用纯属冗余 + 真实潜在 ReferenceError。删除两处冗余引用。
  - **v0.45.60** — 主文件顶部 30+ 行的 destructure（绝大多数项只解构出来又通过 `...dependencies` 转发）压缩到只剩 5 个本文件直接引用的 manager (`app` / `database` / `mainWindow` / `llmManager` / `aiEngineManager`)，其余通过 `...dependencies` 透传。文件 495 → 446 行。

### Fixed

- **v0.45.61** — `project-export-ipc.js` 的 `project:import-file` 处理器有 v0.45.13 引入的 copy-paste 死代码块，引用了 `projectPath` 和 `normalizedProjectPath` 两个未在该作用域定义的变量；进入该 handler 即抛 `ReferenceError`。彻底删除死块，改用 `getActiveDatabase()` 路径（与 export-file handler 一致）。同步补全 `project-export-ipc.test.js` 中 mockDatabase 的 `getProjectById` / `getProjectFiles` / `db.get` / `db.run` 接口，原本静默失败的 3 个文件操作测试还原为真实断言。
- **v0.45.57** — `git-auto-commit.js` 的 `isGitRepository()` 改用 `fs.promises.stat` + ENOENT/ENOTDIR 容错，消除最后一处启动可达的 `existsSync` 调用。

### Tests

本轮全面回归通过：
- `src/main/ipc/__tests__/`: 89/89 ✅
- `src/main/git/__tests__/` + `tests/unit/git/`: 192/192 ✅
- `tests/unit/project/`: 212/212 ✅（修复了 3 个 pre-existing 失败）
- `tests/unit/ai-engine/`: 1987/1987 ✅
- `packages/cli/__tests__/unit/`: 3053/3053 ✅

### Tasks

- ✅ #2 H2 IPC Registry 拆分（completed）
- ✅ #7 M2 启动期同步 IO 异步化（completed）

12 项 tech-debt 列表全部清零。

## [3.4.0] - 2026-02-28

### Added

**v3.1.0 — Decentralized AI Market (Phase 65-67):**

- Phase 65: Skill-as-a-Service — SkillServiceProtocol, SkillInvoker, 5 IPC handlers
- Phase 66: Token Incentive — TokenLedger, ContributionTracker, 5 IPC handlers
- Phase 67: Inference Network — InferenceNodeRegistry, InferenceScheduler, 6 IPC handlers

**v3.2.0 — Hardware Security Ecosystem (Phase 68-71):**

- Phase 68: Trinity Trust Root — TrustRootManager, attestation chain, 5 IPC handlers
- Phase 69: PQC Full Migration — PQCEcosystemManager, ML-KEM/ML-DSA replacement, 4 IPC handlers
- Phase 70: Satellite Communication — SatelliteComm, DisasterRecovery, 5 IPC handlers
- Phase 71: Open Hardware Standard — HsmAdapterManager, FIPS 140-3, 4 IPC handlers

**v3.3.0 — Global Decentralized Social (Phase 72-75):**

- Phase 72: Protocol Fusion Bridge — ProtocolFusionBridge, cross-protocol conversion, 5 IPC handlers
- Phase 73: AI Social Enhancement — RealtimeTranslator, ContentQualityAssessor, 5 IPC handlers
- Phase 74: Decentralized Storage — FilecoinStorage, ContentDistributor, 5 IPC handlers
- Phase 75: Anti-Censorship — AntiCensorshipManager, MeshNetworkManager, 5 IPC handlers

**v3.4.0 — EvoMap Global Evolution (Phase 76-77):**

- Phase 76: Global Evolution Network — EvoMapFederation, multi-Hub sync, 5 IPC handlers
- Phase 77: IP & Governance DAO — GeneIPManager, EvoMapDAO, 5 IPC handlers

**Infrastructure:**

- 64 new IPC handlers across 13 phases
- 23 new database tables
- 13 new Pinia stores, Vue pages, and routes
- 4 new Context Engineering setters (steps 4.9-4.12)
- 13 new config sections
- Comprehensive unit tests (279 tests passing) and E2E tests

## [0.21.0] - 2026-01-19

### Added

**Desktop Application (v0.20.0 → v0.21.0):**

- GitHub Release automation system with comprehensive workflows
- Multi-platform build improvements and optimizations
- Virtual project creation for AI chat E2E tests
- Test infrastructure improvements with ESLint fixes
- Playwright E2E testing support at root level

**Android Application (v0.1.0 → v0.4.0 → Phase 5):**

- **Phase 3**: Knowledge base feature module with CRUD, FTS5 search, and Paging 3
- **Phase 4**: AI chat integration with LLM adapters (OpenAI, DeepSeek, Ollama), SSE streaming, RAG retrieval
- **Phase 5**: P2P networking (WebRTC, NSD discovery, DataChannel transport) and DID identity system (did:key, Ed25519)

**Mobile Application:**

- Performance testing tools and Lighthouse integration
- Final performance metrics report

### Fixed

- CI workflow: Added Playwright dependency to root package.json
- CI workflow: Corrected package-lock.json path in release workflow
- Test failures: Converted CommonJS to ESM imports in test files
- Test failures: Updated IPC handler counts for LLM and Knowledge Graph
- Test failures: Fixed syntax errors and module path issues
- MCP: Removed unused variables and imports
- MCP: Added missing latency metrics to performance monitor
- PDF engine: Fixed test failures with dependency injection
- Tool manager: Fixed test mocks and upsert logic
- Word engine: Fixed HTML parsing
- Windows: Fixed unit test failures
- MCP: Improved server environment variables and default configs
- Desktop: Ensured main window shows after splash screen

### Changed

- Improved P2P voice/video tests with real manager integration
- Enhanced MCP tool testing UI and permission handling
- Added public validation methods to MCPSecurityPolicy
- Refactored test infrastructure with global mocks
- Organized root directory files
- Reorganized src/main into categorized subdirectories

### Performance

- Lazy loading for blockchain, plugins, and media modules
- Optimized startup time with deferred module loading
- Reduced memory footprint with lazy highlight.js loading

### Security

- Enhanced MCP security with improved config validation
- Better error handling for incomplete server configurations

## [0.20.0] - 2026-01-15

### Added

- MCP (Model Context Protocol) integration POC v0.1.0
  - Filesystem, PostgreSQL, SQLite, Git server support
  - Defense-in-depth security architecture
  - Tool testing UI
- LLM Performance Dashboard with ECharts visualization
- SessionManager v0.22.0 with auto-compression (30-40% token savings)
- ErrorMonitor AI diagnostics with local Ollama LLM
- Manus optimizations (Context Engineering, Tool Masking, Task Tracking)

### Changed

- Updated all design documentation to v0.20.0
- Refactored main process modules into categorized subdirectories
- Enhanced login debug logging

### Fixed

- Git status modal now receives correct project ID
- Added WebRTC compatibility layer for P2P
- Improved monitoring and test stability

## [0.19.0] - 2026-01-10

### Added

- P2P encrypted messaging with Signal Protocol
- Knowledge graph visualization
- Advanced RAG retrieval system
- Multi-agent task execution framework

### Fixed

- Database encryption with SQLCipher
- U-Key hardware integration improvements

## [0.18.0] - 2026-01-05

### Added

- Desktop app Vue 3 migration complete
- Ant Design Vue 4.1 UI components
- Electron 39.2.6 upgrade

### Changed

- Migrated from Vue 2 to Vue 3 with Composition API
- Updated build toolchain to Vite

## [0.16.0] - 2025-12-20

### Added

- Knowledge base management (95% complete)
- RAG-enhanced search
- DID-based identity system
- P2P network foundation

---

## Version History

- **3.4.0** (2026-02-28) - v3.1.0-v3.4.0 Phase 65-77: AI Market, Hardware Security, Global Social, EvoMap
- **0.21.0** (2026-01-19) - Android Phase 5, Release automation, Test improvements
- **0.20.0** (2026-01-15) - MCP integration, Performance dashboard, Manus optimizations
- **0.19.0** (2026-01-10) - P2P messaging, Knowledge graph
- **0.18.0** (2026-01-05) - Vue 3 migration, Electron upgrade
- **0.16.0** (2025-12-20) - Knowledge base MVP

---

## Links

- [Repository](https://github.com/chainlesschain/chainlesschain)
- [Documentation](https://github.com/chainlesschain/chainlesschain/tree/main/docs)
- [Issues](https://github.com/chainlesschain/chainlesschain/issues)
- [Releases](https://github.com/chainlesschain/chainlesschain/releases)
