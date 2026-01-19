# Changelog

All notable changes to ChainlessChain will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
