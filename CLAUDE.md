# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainlessChain is a decentralized personal AI management system with hardware-level security (U-Key/SIMKey). It integrates three core features:

1. **Knowledge Base Management** - Personal second brain with RAG-enhanced search
2. **Decentralized Social** - DID-based identity, P2P encrypted messaging, social forums
3. **Decentralized Trading** - Digital asset management, marketplace, smart contracts

**Current Version**: v0.39.0 (92 Desktop Skills + Android 28 Skills + Instinct Learning System) - Updated 2026-02-22

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

Project uses Memory Bank system to maintain AI assistant cross-session context:

| File                        | Purpose                        | Update Trigger               |
| --------------------------- | ------------------------------ | ---------------------------- |
| `CLAUDE.md`                 | Main project docs & AI guide   | Major feature changes        |
| `CLAUDE-patterns.md`        | Verified architecture patterns | New patterns discovered      |
| `CLAUDE-decisions.md`       | Architecture Decision Records  | Major architecture decisions |
| `CLAUDE-troubleshooting.md` | Known issues & solutions       | New issues resolved          |
| `CLAUDE-activeContext.md`   | Current session state          | Each session end             |

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

## Feature Index

All features are implemented. Entry files are relative to `desktop-app-vue/src/`.

| Feature                       | Entry File(s)                                                       | Docs                                                                               |
| ----------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| MCP Integration               | `main/mcp/`                                                         | [`MCP_USER_GUIDE.md`](docs/features/MCP_USER_GUIDE.md)                             |
| MCP SDK & Community Registry  | `main/mcp/sdk/index.js`, `main/mcp/community-registry.js`           | —                                                                                  |
| LLM Performance Dashboard     | `main/llm/token-tracker.js`                                         | [`LLM_PERFORMANCE_DASHBOARD.md`](docs/features/LLM_PERFORMANCE_DASHBOARD.md)       |
| SessionManager                | `main/llm/session-manager.js`                                       | [`SESSION_MANAGER.md`](docs/features/SESSION_MANAGER.md)                           |
| ErrorMonitor AI Diagnostics   | `main/monitoring/error-monitor.js`                                  | [`ERROR_MONITOR.md`](docs/features/ERROR_MONITOR.md)                               |
| Manus Optimizations           | `main/llm/manus-optimizations.js`                                   | [`MANUS_OPTIMIZATION_GUIDE.md`](docs/MANUS_OPTIMIZATION_GUIDE.md)                  |
| Cowork Multi-Agent            | `main/ai-engine/cowork/`                                            | [`COWORK_QUICK_START.md`](docs/features/COWORK_QUICK_START.md)                     |
| Permanent Memory              | `main/llm/permanent-memory-manager.js`                              | [`PERMANENT_MEMORY_INTEGRATION.md`](docs/features/PERMANENT_MEMORY_INTEGRATION.md) |
| Hooks System                  | `main/hooks/index.js`                                               | [`HOOKS_SYSTEM_DESIGN.md`](docs/design/HOOKS_SYSTEM_DESIGN.md)                     |
| Hybrid Search Engine          | `main/rag/hybrid-search-engine.js`, `main/rag/bm25-search.js`       | —                                                                                  |
| IPC Error Handler             | `main/utils/ipc-error-handler.js`                                   | [`IPC_ERROR_HANDLER_GUIDE.md`](docs/guides/IPC_ERROR_HANDLER_GUIDE.md)             |
| Permission Engine (RBAC)      | `main/permission/permission-engine.js`                              | —                                                                                  |
| Team Manager                  | `main/permission/team-manager.js`                                   | —                                                                                  |
| Context Engineering           | `main/llm/context-engineering.js`                                   | —                                                                                  |
| Plan Mode                     | `main/ai-engine/plan-mode/index.js`                                 | —                                                                                  |
| Skills System (92 built-in)   | `main/ai-engine/cowork/skills/index.js`, `builtin/`                 | —                                                                                  |
| Unified Tool Registry         | `main/ai-engine/unified-tool-registry.js`                           | —                                                                                  |
| Browser Automation            | `main/browser/browser-engine.js`                                    | [`09_浏览器自动化系统.md`](docs/design/modules/09_浏览器自动化系统.md)             |
| Computer Use                  | `main/browser/computer-use-agent.js`, `main/browser/actions/`       | [`COMPUTER_USE_GUIDE.md`](docs/features/COMPUTER_USE_GUIDE.md)                     |
| Enterprise Audit & Compliance | `main/audit/enterprise-audit-logger.js`                             | —                                                                                  |
| Plugin Marketplace            | `main/marketplace/marketplace-client.js`                            | —                                                                                  |
| Specialized Multi-Agent       | `main/ai-engine/agents/agent-coordinator.js`                        | —                                                                                  |
| SSO & Enterprise Auth         | `main/auth/sso-manager.js`                                          | —                                                                                  |
| Verification Loop Skill       | `main/ai-engine/cowork/skills/builtin/verification-loop/handler.js` | —                                                                                  |
| Orchestrate Workflow Skill    | `main/ai-engine/cowork/skills/builtin/orchestrate/handler.js`       | —                                                                                  |
| Instinct Learning System      | `main/llm/instinct-manager.js`                                      | —                                                                                  |
| Demo Templates                | `main/templates/demo-template-loader.js`                            | —                                                                                  |
| TypeScript Stores (32)        | `renderer/stores/*.ts`                                              | —                                                                                  |

### Skills System Details

- 4-layer loading: bundled → marketplace → managed → workspace (higher overrides)
- Agent Skills Open Standard: 13 extended fields (tools, instructions, examples, dependencies, input-schema, output-schema, model-hints, cost, author, license, homepage, repository)
- 92 built-in skills with handlers in `main/ai-engine/cowork/skills/builtin/`
- `/skill` commands parsed via `skills-ipc.js`
- Parser: `skill-md-parser.js` (YAML frontmatter + Markdown body)

### Hooks System Details

- 21 hook events, 4 hook types (Sync, Async, Command, Script)
- Priority: SYSTEM(0) → HIGH(100) → NORMAL(500) → LOW(900) → MONITOR(1000)
- Config: `.chainlesschain/hooks.json` (project), `~/.chainlesschain/hooks.json` (user)
- Script hooks auto-load from `.chainlesschain/hooks/*.js`

### Instinct Learning Details

- 8 categories: CODING_PATTERN, TOOL_PREFERENCE, WORKFLOW, ERROR_FIX, STYLE, ARCHITECTURE, TESTING, GENERAL
- Observation pipeline: PostToolUse/PreCompact hooks → buffer (50 items, 60s flush) → pattern extraction
- Confidence dynamics: reinforce (+5% diminishing), decay (×0.9)
- Auto-injected into LLM prompts via Context Engineering integration
- DB tables: `instincts`, `instinct_observations`

### Orchestrate Workflows

- 4 templates: `feature` (planner→architect→coder→reviewer→verify), `bugfix`, `refactor`, `security-audit`
- Usage: `/orchestrate feature "add user profile page"`

### Verification Loop

- 6 stages: Build → TypeCheck → Lint → Test → Security → DiffReview
- Auto-detects project type (typescript, nodejs, python, java)
- Verdict: READY / NOT READY

## Architecture Overview

### Desktop Application Structure

```
desktop-app-vue/
├── src/main/              # Electron main process
│   ├── index.js           # Main entry point
│   ├── database.js        # SQLite/SQLCipher database
│   ├── ukey/              # U-Key hardware integration
│   ├── llm/               # LLM service (session, memory, context-engineering, instinct)
│   ├── rag/               # RAG retrieval (vector, BM25, hybrid search)
│   ├── permission/        # Enterprise RBAC (engine, team, delegation, approval)
│   ├── task/              # Task management (team reports)
│   ├── hooks/             # Hooks system (registry, executor, middleware)
│   ├── did/               # DID identity system
│   ├── p2p/               # P2P network (libp2p + Signal + WebRTC)
│   ├── browser/           # Browser automation + Computer Use actions
│   ├── mcp/               # MCP integration + SDK + community registry
│   ├── audit/             # Enterprise Audit & Compliance
│   ├── marketplace/       # Plugin Marketplace
│   ├── auth/              # SSO Enterprise Authentication (SAML, OAuth, OIDC)
│   ├── templates/         # Demo templates (10 templates)
│   ├── utils/             # Utility modules (ipc-error-handler)
│   └── ai-engine/         # AI engine
│       ├── plan-mode/     # Plan Mode (Claude Code style)
│       ├── agents/        # Specialized Multi-Agent (8 templates)
│       ├── unified-tool-registry.js
│       ├── tool-skill-mapper.js
│       └── cowork/skills/ # Skills system (92 built-in, 4-layer loading)
└── src/renderer/          # Vue3 frontend
    ├── pages/             # Page components
    ├── components/        # Reusable components
    └── stores/            # Pinia state management (32 TypeScript stores)
```

### Android Application

28 skills in `android-app/feature-ai/.../cowork/skills/` — same SKILL.md format as desktop. 12 Kotlin handlers, 8 doc-only, 8 REMOTE skills (delegated to desktop via P2PSkillBridge). Details in `MEMORY.md`.

### Backend Services

- **project-service** (Spring Boot 3.1.11 + Java 17): PostgreSQL, Redis, MyBatis Plus 3.5.9
- **ai-service** (FastAPI + Python): Ollama, Qdrant, 14+ cloud LLM providers

### Database Schema

SQLite with SQLCipher (AES-256). Key tables:

- **Core**: `notes`, `chat_conversations`, `did_identities`, `p2p_messages`, `contacts`, `social_posts`
- **Memory**: `embedding_cache`, `memory_file_hashes`, `daily_notes_metadata`, `memory_sections`, `memory_stats`
- **Instinct**: `instincts`, `instinct_observations`

## Technology Stack

### Desktop App

- **Electron**: 39.2.6, **Vue**: 3.4, **TypeScript**: 5.9.3, **UI**: Ant Design Vue 4.1
- **State**: Pinia 2.1.7 (28 TypeScript stores)
- **P2P**: libp2p 3.1.2, WebRTC (wrtc), **Crypto**: Signal Protocol
- **Image**: Sharp, Tesseract.js, **Git**: isomorphic-git
- **Search**: natural (BM25/TF-IDF), Qdrant (Vector)

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

## Code Style & Commit Conventions

Semantic commits: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`

Example: `feat(rag): add reranker support`

## Known Limitations

1. **U-Key**: Windows only (macOS/Linux simulation mode)
2. **GPU**: Docker Ollama requires NVIDIA GPU for acceleration

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

See `CLAUDE-troubleshooting.md` for detailed issue solutions (database, LLM, P2P, Electron, U-Key, performance).

## Documentation References

- **System Design**: `docs/design/系统设计_主文档.md`, `docs/design/系统设计_个人移动AI管理系统.md`
- **Browser Automation**: `docs/design/modules/09_浏览器自动化系统.md`
- **Quick Start**: `QUICK_START.md`, `HOW_TO_RUN.md`
- **README**: `README.md` (Chinese), `README_EN.md` (English)
- **Memory System**: `docs/features/PERMANENT_MEMORY_INTEGRATION.md`
- **Error Handler**: `docs/guides/IPC_ERROR_HANDLER_GUIDE.md`
- **Phase 2 Summary**: `docs/reports/phase2/PHASE2_FINAL_SUMMARY.md`
- **Active Context**: `CLAUDE-activeContext.md`
