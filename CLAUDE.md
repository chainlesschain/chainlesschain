# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainlessChain is a decentralized personal AI management system with hardware-level security (U-Key/SIMKey). It integrates three core features:

1. **Knowledge Base Management** - Personal second brain with RAG-enhanced search
2. **Decentralized Social** - DID-based identity, P2P encrypted messaging, social forums
3. **Decentralized Trading** - Digital asset management, marketplace, smart contracts

**Current Version**: v1.1.0-alpha (Enterprise Edition - 95 Desktop Skills + Android 28 Skills + Phase 6 Enterprise + v3.0-v4.0 Full-Stack + Q2 Phase 42-45) - Updated 2026-02-27

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

**See [`FEATURES.md`](FEATURES.md) for the complete feature list** (95+ desktop features, 28 Android skills).

Key highlights:

- **AI Engine**: Cowork Multi-Agent, Plan Mode, Instinct Learning, Skills System (95 built-in)
- **Enterprise**: RBAC, SSO, Audit & Compliance, Org Management, Real-time Collaboration
- **Integration**: MCP, Browser Automation, Computer Use, IPFS, Analytics Dashboard
- **v3.0-v4.0**: Pipeline Orchestrator, NL Programming, Multimodal Collaboration, Autonomous Ops, Agent Federation

## Architecture Overview

### Desktop Application (Primary Focus)

**Structure**: `desktop-app-vue/src/`

**Main Process** (`main/`):

- **Core**: `index.js` (entry), `database.js` (SQLite/SQLCipher), `config/`, `utils/`
- **Security**: `ukey/` (hardware), `did/` (identity), `p2p/` (encrypted messaging)
- **AI Engine**: `ai-engine/` (plan-mode, agents, cowork, autonomous), `llm/` (session, memory, instinct)
- **Enterprise**: `permission/` (RBAC), `auth/` (SSO), `audit/`, `enterprise/` (org management)
- **Integration**: `mcp/`, `browser/` (automation + computer-use), `marketplace/`, `hooks/`
- **Advanced**: `collaboration/` (CRDT/Yjs), `ipfs/`, `rag/` (hybrid search), `analytics/`, `performance/`

**Renderer Process** (`renderer/`):

- **Vue3 + TypeScript**: `pages/`, `components/`, `stores/` (51 Pinia stores), `router/`

### Backend Services

- **project-service**: Spring Boot 3.1.11 + Java 17 + PostgreSQL + Redis + MyBatis Plus 3.5.9
- **ai-service**: FastAPI + Python + Ollama + Qdrant + 14+ cloud LLM providers

### Android Application

28 skills (12 Kotlin handlers, 8 doc-only, 8 REMOTE delegated to desktop). See `MEMORY.md` for details.

### Database Schema

**SQLite + SQLCipher (AES-256)** - File: `data/chainlesschain.db`

**Table categories**: Core (notes, conversations, DID, P2P), Memory (embeddings, metadata), AI (instincts, knowledge graph, decisions), Enterprise (RBAC, org, approval), Collaboration (CRDT, sessions), Storage (IPFS), Analytics

**Schema definition**: See `desktop-app-vue/src/main/database.js` for full schema and migrations.

## Technology Stack

### Desktop App

- **Electron**: 39.2.6, **Vue**: 3.4, **TypeScript**: 5.9.3, **UI**: Ant Design Vue 4.1
- **State**: Pinia 2.1.7 (46 TypeScript stores)
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

## Code Quality & ESLint Best Practices

### Common ESLint Errors to Avoid

When writing new code, follow these guidelines to prevent common ESLint violations:

#### 1. Use ES6 Imports Instead of CommonJS Require

**❌ Wrong (causes @typescript-eslint/no-require-imports):**

```javascript
const axios = require("axios");
const { ipcMain } = require("electron");
```

**✅ Correct:**

```javascript
import axios from "axios";
import { ipcMain } from "electron";
```

**Note**: Only use `require()` in CommonJS `.js` files in the main process where necessary. All TypeScript files (`.ts`, `.tsx`) and renderer code must use ES6 imports.

#### 2. Handle Unused Variables in Catch Blocks

**❌ Wrong (causes @typescript-eslint/no-unused-vars + no-empty):**

```javascript
try {
  await riskyOperation();
} catch (err) {
  // 'err' is unused
  // Empty catch block
}
```

**✅ Correct - Option A (log the error):**

```javascript
try {
  await riskyOperation();
} catch (err) {
  console.error("Operation failed:", err);
}
```

**✅ Correct - Option B (ignore with underscore + comment):**

```javascript
try {
  await riskyOperation();
} catch (_err) {
  // Explicitly ignore error - operation is optional
  // Intentionally empty - non-critical operation
}
```

**✅ Correct - Option C (no-catch-all with specific handling):**

```javascript
try {
  await riskyOperation();
} catch (err) {
  // Handle specific error scenarios
  if (err.code === "ENOENT") {
    return null; // File not found is expected
  }
  throw err; // Re-throw unexpected errors
}
```

#### 3. Remove Unused Imports and Variables

**❌ Wrong (causes @typescript-eslint/no-unused-vars):**

```javascript
import { ref, computed, onMounted } from "vue"; // onMounted not used

export default {
  setup() {
    const count = ref(0);
    const unusedVar = ref("test"); // Never used

    return { count };
  },
};
```

**✅ Correct:**

```javascript
import { ref } from "vue"; // Only import what you use

export default {
  setup() {
    const count = ref(0);

    return { count };
  },
};
```

#### 4. File Type Specific Rules

**Main Process Files (.js in `src/main/`):**

- Use CommonJS (`module.exports`, `require()`) for consistency with existing code
- Use ES6 imports only if the entire module is ES6

**Renderer Files (.ts, .tsx, .vue in `src/renderer/`):**

- Always use ES6 imports/exports
- TypeScript strict mode enabled
- Use type annotations for function parameters and return types

**Test Files (.test.js, .spec.js):**

- Follow the same import style as the file being tested
- Use Vitest mocking patterns (see MEMORY.md)

### Pre-commit Checklist

Before committing, ensure:

1. ✅ Run `npm run lint` - all ESLint errors fixed
2. ✅ Run `npm run format` - code is properly formatted
3. ✅ No unused imports or variables
4. ✅ All catch blocks either handle errors or have explanatory comments
5. ✅ ES6 imports used in all TypeScript/renderer code

### ESLint Configuration

Project uses:

- **Main**: `@typescript-eslint/parser` + `eslint-plugin-vue`
- **Rules**: See `desktop-app-vue/.eslintrc.js`
- **Auto-fix**: Many issues can be auto-fixed with `npm run lint -- --fix`

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
