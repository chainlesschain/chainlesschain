# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainlessChain is a decentralized personal AI management system with hardware-level security (U-Key/SIMKey). It integrates three core features:

1. **Knowledge Base Management** - Personal second brain with RAG-enhanced search
2. **Decentralized Social** - DID-based identity, P2P encrypted messaging, social forums
3. **Decentralized Trading** - Digital asset management, marketplace, smart contracts

**Current Version**: v0.26.2 (100% complete, production-ready for all features)

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

**Status**: ✅ Implemented v0.22.0 | **Docs**: [`docs/features/SESSION_MANAGER.md`](docs/features/SESSION_MANAGER.md)

Intelligent session context management with auto-compression (30-40% token savings), search, tags, export/import, and auto-summary.

### ErrorMonitor AI Diagnostics

**Status**: ✅ Implemented | **Docs**: [`docs/features/ERROR_MONITOR.md`](docs/features/ERROR_MONITOR.md)

Smart error diagnosis with local Ollama LLM (free), auto-classification, severity assessment, and auto-fix strategies.

### Manus Optimizations

**Status**: ✅ Implemented v0.24.0 | **Docs**: [`docs/MANUS_OPTIMIZATION_GUIDE.md`](docs/MANUS_OPTIMIZATION_GUIDE.md)

Context Engineering (KV-Cache optimization), Tool Masking, Task Tracking (todo.md), and Multi-Agent system.

## Architecture Overview

### Desktop Application Structure

```
desktop-app-vue/
├── src/main/              # Electron main process
│   ├── index.js           # Main entry point
│   ├── database.js        # SQLite/SQLCipher database
│   ├── ukey/              # U-Key hardware integration
│   ├── llm/               # LLM service integration
│   ├── rag/               # RAG retrieval system
│   ├── did/               # DID identity system
│   ├── p2p/               # P2P network (libp2p + Signal)
│   ├── mcp/               # MCP integration
│   └── ai-engine/         # AI engine and multi-agent
└── src/renderer/          # Vue3 frontend
    ├── pages/             # Page components
    ├── components/        # Reusable components
    └── stores/            # Pinia state management
```

### Backend Services

- **project-service** (Spring Boot 3.1.11 + Java 17): PostgreSQL, Redis, MyBatis Plus 3.5.9
- **ai-service** (FastAPI + Python): Ollama, Qdrant, 14+ cloud LLM providers

### Database Schema

SQLite with SQLCipher (AES-256). Key tables: `notes`, `chat_conversations`, `did_identities`, `p2p_messages`, `contacts`, `social_posts`

## Technology Stack

### Desktop App

- **Electron**: 39.2.6, **Vue**: 3.4, **UI**: Ant Design Vue 4.1
- **P2P**: libp2p 3.1.2, **Crypto**: Signal Protocol
- **Image**: Sharp, Tesseract.js, **Git**: isomorphic-git

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
# Desktop
cd desktop-app-vue && npm run test:db && npm run test:ukey

# Backend
cd backend/project-service && mvn test
cd backend/ai-service && pytest
```

## Code Style & Commit Conventions

Semantic commits: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`

Example: `feat(rag): add reranker support`

## Known Limitations

1. **U-Key**: Windows only
2. **Mobile App**: 10% complete
3. **GPU**: Docker Ollama requires NVIDIA GPU

## Important File Locations

- **Main config**: `desktop-app-vue/package.json`
- **Database schema**: `desktop-app-vue/src/main/database.js`
- **IPC handlers**: `desktop-app-vue/src/main/index.js`
- **Docker**: `docker-compose.yml`, `docker-compose.cloud.yml`

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

- **System Design**: `docs/design/系统设计_个人移动AI管理系统.md`
- **Quick Start**: `QUICK_START.md`, `HOW_TO_RUN.md`
- **README**: `README.md` (Chinese), `README_EN.md` (English)
