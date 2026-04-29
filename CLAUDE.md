# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainlessChain is a decentralized personal AI management system with hardware-level security (U-Key/SIMKey). It integrates three core features:

1. **Knowledge Base Management** - Personal second brain with RAG-enhanced search
2. **Decentralized Social** - DID-based identity, P2P encrypted messaging, social forums
3. **Decentralized Trading** - Digital asset management, marketplace, smart contracts

**Current Version**: v5.0.3.1 (Evolution Edition — 139 Desktop Skills + 28 Android Skills + 109 CLI Commands + 7600+ Tests)

**Version hierarchy** (independent tracks — do not attempt to unify):
- Product line: `v5.0.3.1` (marketing / release notes / docs — single source: `package.json.productVersion`)
- CLI npm: `chainlesschain@0.157.9` (`packages/cli/package.json`)
- Desktop app: `1.1.0-alpha` (`desktop-app-vue/package.json` — alpha prerelease track)
- Monorepo root: `0.37.8` (`/package.json` — workspaces aggregate, not published)

**Primary Application**: `desktop-app-vue/` (Electron + Vue3) - This is the main development focus.

## Configuration Management

### Unified Configuration Directory (`.chainlesschain/`)

**Location:**
- Windows: `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/`
- macOS: `~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/`
- Linux: `~/.config/chainlesschain-desktop-vue/.chainlesschain/`

**Key Files:**
- **`.chainlesschain/config.json`**: Main configuration file (git-ignored)
- **`.chainlesschain/rules.md`**: Project coding rules - **READ THIS FIRST!** (priority > CLAUDE.md)
- **`desktop-app-vue/src/main/config/unified-config-manager.js`**: Configuration manager

**Priority:** Environment variables > `.chainlesschain/config.json` > Defaults

## Quick Start Commands

```bash
# Desktop App
cd desktop-app-vue && npm install && npm run dev

# CLI
cd packages/cli && npm install && npm test

# Backend (Docker)
docker-compose up -d
```

## CLI Commands Reference

**See [`docs/CLI_COMMANDS_REFERENCE.md`](docs/CLI_COMMANDS_REFERENCE.md)** for the full 90-command reference (thin index → 6 sub-files in `docs/cli/`). Read on demand, not auto-loaded.

Key CLI entry points:
- `cc setup/start/stop/status/doctor` — system management
- `cc chat/ask/agent/skill` — AI headless commands
- `cc note/search/memory/session` — knowledge & sessions
- `cc mcp/browse/did/encrypt/auth` — integrations & security
- `cc cowork/workflow/hook/a2a` — multi-agent & orchestration

## Feature Index

**See [`FEATURES.md`](FEATURES.md)** for the complete list (138 desktop features, 28 Android skills).

Key highlights:
- **AI Engine**: Cowork Multi-Agent, Plan Mode, Instinct Learning, Skills System (138 built-in)
- **Enterprise**: RBAC, SSO, Audit & Compliance, Org Management
- **Integration**: MCP, Browser Automation, Computer Use, IPFS
- **v3.0-v4.0**: Pipeline Orchestrator, NL Programming, Multimodal, Agent Federation
- **v5.0.0+**: IPC Domain Split, DI Container, A2A, Workflow Engine, ZKP, Low-Code, BI Engine

## Architecture Overview

### Key Modules

| Layer | Path | Description |
|-------|------|-------------|
| Desktop Main | `desktop-app-vue/src/main/` | Electron main process (AI, IPC, Security, Enterprise) |
| Desktop Renderer | `desktop-app-vue/src/renderer/` | Vue3 + TypeScript (51 Pinia stores) |
| CLI | `packages/cli/` | npm CLI (~2MB, 109 commands, Commander) |
| Java Backend | `backend/project-service/` | Spring Boot 3.1.11 + Java 17 + PostgreSQL |
| Python AI | `backend/ai-service/` | FastAPI + Ollama + Qdrant |
| Android | `mobile-app/` | 28 skills (12 Kotlin + 8 doc-only + 8 REMOTE) |

### Technology Stack

- **Desktop**: Electron 39.2.6, Vue 3.4, TypeScript 5.9.3, Ant Design Vue 4.1, Pinia 2.1.7
- **Backend**: Java 17 + Spring Boot 3.1.11, Python FastAPI, PostgreSQL 16, Redis 7
- **P2P/Crypto**: libp2p, WebRTC, Signal Protocol, SQLCipher (AES-256)
- **Search**: BM25/TF-IDF (natural), Vector (Qdrant)

## Environment Variables

Key variables (see `.env.example`):
```bash
OLLAMA_HOST=http://localhost:11434
QDRANT_HOST=http://localhost:6333
DB_HOST=localhost:5432
REDIS_HOST=localhost:6379
```

## Known Limitations

1. **U-Key**: Windows only (macOS/Linux simulation mode)
2. **GPU**: Docker Ollama requires NVIDIA GPU for acceleration

## Documentation References

- **Architecture Patterns**: `CLAUDE-patterns.md` (44k — read on demand when working with patterns)
- **Architecture Decisions**: `CLAUDE-decisions.md`
- **Troubleshooting**: `CLAUDE-troubleshooting.md` (22k — read on demand when debugging issues)
- **System Design**: `docs/design/系统设计_主文档.md`
- **Quick Start**: `QUICK_START.md`, `HOW_TO_RUN.md`
- **README**: `README.md` (Chinese), `README_EN.md` (English)

### Doc-site source-of-truth (改文档前**必看**)

`docs-site/` 与 `docs-site-design/` 的 `docs/design/**/*.md` 都是**自动同步生成**的副本，**不是 git tracked 的源文件**。直接编辑这些副本会被下一次同步脚本覆盖（且 git status 看不到，定位极隐蔽）。

| 副本（不要改） | 同步脚本 | **真正的源文件（改这里）** |
|---|---|---|
| `docs-site/docs/design/**/*.md` | `docs-site/scripts/sync-design-docs.js` | `docs/design/**/*.md`（项目根，git tracked，常带中文文件名）|
| `docs-site-design/docs/**/*.md`（不含 `index.md`） | `docs-site-design/scripts/sync-docs.js` | 同上 — `docs/design/**/*.md`（项目根）|

要改设计文档：(1) `git ls-files --error-unmatch <path>` 确认是否 tracked；(2) 若不是，找对应的 `sync-*.js` 看 `sourceDir` 找源；(3) 改源 + 跑 `node <sync-script>` 让两份副本刷新。`docs-site/docs/guide/**` 是 git tracked 的源文件，可以直接改。

**例外白名单（每个 docs site 自管，不来自源）**：`index.md` 和 `.vitepress/`（在 EXCLUDE 里）。

类似的"生成产物 vs 源"也存在于其它子树（如 `desktop-app-vue/docs/api/generated/`），编辑前先确认。

## Rules (path-scoped, auto-loaded)

Detailed rules are in `.claude/rules/` and only load when working in matching paths:

| Rule File | Scope |
|-----------|-------|
| `desktop-dev.md` | `desktop-app-vue/**` |
| `cli-dev.md` | `packages/cli/**`, `packages/core-*/**` |
| `testing.md` | `**/*.test.*`, `**/tests/**` |
| `encoding.md` | `**/*.js`, `**/*.ts`, `**/*.vue` |
| `eslint-style.md` | `**/*.ts`, `**/*.vue`, `**/*.js` |
| `backend.md` | `backend/**` |
