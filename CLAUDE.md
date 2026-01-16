# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainlessChain is a decentralized personal AI management system with hardware-level security (U-Key/SIMKey). It integrates three core features:

1. **Knowledge Base Management** - Personal second brain with RAG-enhanced search
2. **Decentralized Social** - DID-based identity, P2P encrypted messaging, social forums
3. **Decentralized Trading** - Digital asset management, marketplace, smart contracts, credit scoring

**Current Version**: v0.16.0 (95% complete, production-ready for knowledge base features)

**Primary Application**: `desktop-app-vue/` (Electron + Vue3) - This is the main development focus.

## Configuration Management

### Unified Configuration Directory (`.chainlesschain/`)

**Inspired by OpenClaude best practices**, this project uses a unified `.chainlesschain/` directory to centralize all configuration, logs, cache, and session data.

**Directory Structure:**

```
.chainlesschain/
├── config.json              # Core configuration (model, cost, performance, logging)
├── config.json.example      # Configuration template (version controlled)
├── rules.md                 # Project-specific coding rules and constraints
├── memory/                  # Session and learning data
│   ├── sessions/            # Conversation history
│   ├── preferences/         # User preferences
│   └── learned-patterns/    # Learned patterns from usage
├── logs/                    # Operation logs
│   ├── error.log
│   ├── performance.log
│   └── llm-usage.log        # LLM token usage tracking (planned)
├── cache/                   # Cached data
│   ├── embeddings/          # Vector embeddings cache
│   ├── query-results/       # Query results cache
│   └── model-outputs/       # Model output cache
└── checkpoints/             # Checkpoints and backups
    └── auto-backup/
```

**Configuration Priority (high to low):**

1. **Environment variables** (`.env`, system env) - Highest priority
2. **`.chainlesschain/config.json`** - User-specific settings
3. **Default configuration** - Defined in code

**Key Features:**

- **Automatic initialization**: Directory structure created on first run
- **Git-friendly**: Runtime data excluded via `.gitignore`, but templates/rules are version controlled
- **Centralized management**: All paths accessible via `UnifiedConfigManager`
- **Easy migration**: Export/import configuration for deployment

**Usage Example:**

```javascript
// In main process
const { getUnifiedConfigManager } = require("./config/unified-config-manager");

const configManager = getUnifiedConfigManager();

// Get configuration
const modelConfig = configManager.getConfig("model");
console.log("Default LLM provider:", modelConfig.defaultProvider);

// Get paths
const logsDir = configManager.getLogsDir();
const cacheDir = configManager.getCacheDir();

// Update configuration
configManager.updateConfig({
  cost: {
    monthlyBudget: 100,
  },
});

// Clear cache
configManager.clearCache("embeddings");
```

**Important Files:**

- **`.chainlesschain/config.json`**: Main configuration file (git-ignored)
- **`.chainlesschain/rules.md`**: Project coding rules - **READ THIS FIRST!** (priority > CLAUDE.md)
- **`desktop-app-vue/src/main/config/unified-config-manager.js`**: Configuration manager implementation

**Migration Notes:**

- Existing `app-config.js` still works for backward compatibility
- New code should use `UnifiedConfigManager` for centralized configuration
- Logs will gradually migrate from `userData/logs` to `.chainlesschain/logs/`

## Critical Build & Development Commands

### Desktop Application (Primary Focus)

```bash
# Navigate to main app
cd desktop-app-vue

# Install dependencies
npm install

# Development mode (starts Vite dev server + Electron)
npm run dev

# Build main process only (required before dev if modified)
npm run build:main

# Build renderer (Vue frontend)
npm run build:renderer

# Full build
npm run build

# Package for Windows
npm run make:win

# Run database tests
npm run test:db

# Run U-Key tests
npm run test:ukey
```

### Backend Services (Docker-based)

```bash
# Start all services (Ollama, Qdrant, PostgreSQL, Redis, AI service, Project service, Signaling server)
docker-compose up -d

# Start only signaling server
docker-compose up -d signaling-server

# Cloud deployment version
docker-compose -f config/docker/docker-compose.cloud.yml up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f

# View signaling server logs
docker-compose logs -f signaling-server

# Pull LLM model (first time)
docker exec chainlesschain-ollama ollama pull qwen2:7b
```

### Signaling Server (WebSocket for P2P)

```bash
# Navigate to signaling server
cd signaling-server

# Install dependencies
npm install

# Development mode (with auto-restart)
npm run dev

# Production mode
npm start

# Or run from root directory
npm run signaling:start    # Production
npm run signaling:dev      # Development
npm run signaling:docker   # Docker mode
```

### Java Backend Services

```bash
# Project Service (Spring Boot)
cd backend/project-service
mvn clean compile
mvn spring-boot:run

# Run tests
mvn test

# Skip tests during build
mvn clean compile -DskipTests
```

### Python AI Service

```bash
cd backend/ai-service

# Install dependencies
pip install -r requirements.txt

# Run service
uvicorn main:app --reload --port 8000
```

### Community Forum

```bash
# Backend (Spring Boot)
cd community-forum/backend
mvn spring-boot:run

# Frontend (Vue3)
cd community-forum/frontend
npm install
npm run dev
```

### Root-level Commands

```bash
# Run desktop app from root
npm run dev:desktop-vue

# Start Docker services from root
npm run docker:up
npm run docker:down
npm run docker:logs

# Linting and formatting
npm run lint
npm run format

# Clean build artifacts
npm run clean
```

## MCP (Model Context Protocol) Integration

**Status**: POC (Proof of Concept) - v0.1.0
**Added**: 2026-01-16

ChainlessChain integrates the **Model Context Protocol (MCP)** to extend AI capabilities through standardized external tools and data sources.

### What is MCP?

MCP is an open protocol that enables AI assistants to connect with various tools and services in a secure, standardized way. Think of it as "plugins for AI" - but better, because:

- **Standardized**: One protocol works across all MCP-compatible tools
- **Secure**: Tools run in isolated processes with fine-grained permissions
- **Extensible**: Easy to add new capabilities without modifying core code

### Supported MCP Servers

| Server         | Purpose                    | Security Level | Status         |
| -------------- | -------------------------- | -------------- | -------------- |
| **Filesystem** | File read/write operations | Medium         | ✅ Implemented |
| **PostgreSQL** | Database queries           | High           | ✅ Implemented |
| **SQLite**     | Local database access      | Medium         | ✅ Implemented |
| **Git**        | Repository operations      | Medium         | ✅ Implemented |
| **Fetch**      | HTTP requests              | Medium         | ✅ Implemented |

### Directory Structure

```
desktop-app-vue/src/main/mcp/
├── README.md                          # POC documentation
├── TESTING_GUIDE.md                   # Testing instructions
├── mcp-client-manager.js              # Core client orchestrator
├── mcp-tool-adapter.js                # Bridge to ToolManager
├── mcp-security-policy.js             # Security enforcement
├── mcp-config-loader.js               # Configuration management
├── mcp-performance-monitor.js         # Performance tracking
├── mcp-ipc.js                         # IPC handlers
├── transports/
│   └── stdio-transport.js             # Stdio communication layer
└── servers/
    ├── server-registry.json           # Trusted server whitelist
    └── server-configs/
        ├── filesystem.json            # Filesystem config schema
        ├── postgres.json              # PostgreSQL config schema
        ├── sqlite.json                # SQLite config schema
        └── git.json                   # Git config schema
```

### Configuration

MCP is configured in `.chainlesschain/config.json`:

```json
{
  "mcp": {
    "enabled": false,
    "servers": {
      "filesystem": {
        "enabled": false,
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          "D:\\code\\chainlesschain\\data"
        ],
        "autoConnect": false,
        "permissions": {
          "allowedPaths": ["notes/", "imports/", "exports/"],
          "forbiddenPaths": ["chainlesschain.db", "ukey/", "did/private-keys/"],
          "readOnly": false
        }
      }
    },
    "security": {
      "auditLog": true,
      "requireConsent": true,
      "trustRegistry": true
    }
  }
}
```

### Using MCP

#### 1. Enable MCP System

Navigate to **Settings → MCP Servers** and toggle "启用MCP系统".

#### 2. Connect to a Server

```javascript
// In renderer process (developer tools)
await window.electronAPI.invoke("mcp:connect-server", {
  serverName: "filesystem",
  config: {
    /* server-specific config */
  },
});
```

#### 3. Call MCP Tools

```javascript
// Read a file
const result = await window.electronAPI.invoke("mcp:call-tool", {
  serverName: "filesystem",
  toolName: "read_file",
  arguments: { path: "notes/example.md" },
});

console.log(result.result.content);
```

#### 4. AI Assistant Integration

Once connected, AI assistants can automatically use MCP tools in conversations:

```
User: Read the content of notes/meeting.md

AI: [Calls mcp_read_file tool]
    Here's the content:
    ...
```

### Security Model

MCP integration follows **defense-in-depth** principles:

1. **Server Whitelist**: Only trusted servers in `server-registry.json` can be loaded
2. **Path Restrictions**: File access limited to `allowedPaths`, `forbiddenPaths` always blocked
3. **User Consent**: High-risk operations require explicit user approval
4. **Process Isolation**: MCP servers run in separate processes
5. **Audit Logging**: All operations logged to `.chainlesschain/logs/mcp-*.log`

**Always Forbidden**:

- `/data/chainlesschain.db` (encrypted database)
- `/data/ukey/` (hardware key data)
- `/data/did/private-keys/` (DID private keys)
- `/data/p2p/keys/` (P2P encryption keys)

### Performance Metrics

MCP integration tracks:

- **Connection Time**: Target < 500ms, acceptable < 1s
- **Tool Call Latency**: Target < 100ms, acceptable < 200ms
- **Error Rate**: Target < 1%, acceptable < 5%
- **Memory Usage**: Target < 50MB per server

View metrics in **Settings → MCP Servers → Performance**.

### Documentation

- **User Guide**: [`docs/features/MCP_USER_GUIDE.md`](docs/features/MCP_USER_GUIDE.md)
- **Testing Guide**: [`desktop-app-vue/src/main/mcp/TESTING_GUIDE.md`](desktop-app-vue/src/main/mcp/TESTING_GUIDE.md)
- **MCP Specification**: [https://modelcontextprotocol.io/](https://modelcontextprotocol.io/)

### Known Limitations (POC)

- Only stdio transport (HTTP+SSE not implemented)
- Limited error recovery (basic retry only)
- Configuration is file-based only (no UI editing yet)
- Windows-focused paths (cross-platform support needed)

### Roadmap

**Phase 1 (Current - POC)**:

- ✅ Core MCP integration
- ✅ Filesystem, PostgreSQL, SQLite, Git servers
- ✅ UI for server management
- ✅ Security policies

**Phase 2 (Q1 2026)**:

- [ ] HTTP+SSE transport
- [ ] Enhanced UI configuration
- [ ] More MCP servers (Slack, GitHub, etc.)
- [ ] Plugin marketplace integration

**Phase 3 (Q2 2026)**:

- [ ] Custom MCP server development SDK
- [ ] Community server repository
- [ ] Advanced permission management
- [ ] Multi-user support

## SessionManager (会话管理系统)

**Status**: ✅ Implemented (v0.20.0)
**Added**: 2026-01-16

SessionManager 实现智能会话上下文管理，支持跨会话连续对话和 Token 优化。基于 OpenClaude 最佳实践设计。

### 核心功能

1. **会话持久化**: 自动保存对话历史到 `.chainlesschain/memory/sessions/`
2. **智能压缩**: 集成 PromptCompressor，自动压缩长对话历史
3. **Token 优化**: 减少 30-40% Token 使用，降低 LLM 成本
4. **跨会话恢复**: 支持加载历史会话继续对话
5. **统计分析**: 追踪压缩效果和 Token 节省

### 使用方式

#### 创建会话

```javascript
const session = await sessionManager.createSession({
  conversationId: "conv-001",
  title: "讨论项目架构",
  metadata: { topic: "architecture" },
});
```

#### 添加消息

```javascript
await sessionManager.addMessage(session.id, {
  role: "user",
  content: "如何优化数据库查询？",
});
```

#### 获取有效消息（自动压缩）

```javascript
// 自动返回压缩后的消息，适用于 LLM 调用
const messages = await sessionManager.getEffectiveMessages(session.id);
```

#### 查看统计

```javascript
const stats = await sessionManager.getSessionStats(session.id);
console.log("压缩次数:", stats.compressionCount);
console.log("节省 Tokens:", stats.totalTokensSaved);
```

### 配置参数

| 参数                   | 默认值 | 说明                   |
| ---------------------- | ------ | ---------------------- |
| `maxHistoryMessages`   | 10     | 压缩后保留的最大消息数 |
| `compressionThreshold` | 10     | 触发压缩的消息数阈值   |
| `enableAutoSave`       | true   | 自动保存会话           |
| `enableCompression`    | true   | 启用智能压缩           |

### 压缩策略

SessionManager 使用 PromptCompressor 实现三种压缩策略：

1. **消息去重**: 移除重复或相似的消息
2. **历史截断**: 保留最近 N 条消息，截断旧消息
3. **智能总结**: 使用 LLM 生成长历史的摘要（需要 llmManager）

### 性能指标

- **压缩率**: 通常为 0.6-0.7（节省 30-40% tokens）
- **压缩延迟**: < 500ms（不使用 LLM 总结）
- **存储开销**: < 1MB per session（100条消息）

### 测试

```bash
# 运行 SessionManager 测试
cd desktop-app-vue
node scripts/test-session-manager.js
```

### 实现文件

- **核心模块**: `desktop-app-vue/src/main/llm/session-manager.js`
- **IPC 处理器**: `desktop-app-vue/src/main/llm/session-manager-ipc.js`
- **数据库迁移**: `desktop-app-vue/src/main/database/migrations/005_llm_sessions.sql`
- **测试脚本**: `desktop-app-vue/scripts/test-session-manager.js`

### 数据库表

- `llm_sessions`: 存储会话元数据和消息历史
- `llm_usage_log`: 记录 LLM Token 使用
- `llm_budget_config`: 预算配置和限额
- `llm_cache`: 响应缓存

## Architecture Overview

### Desktop Application Structure

```
desktop-app-vue/
├── src/main/              # Electron main process (Node.js backend)
│   ├── index.js           # Main entry point
│   ├── database.js        # SQLite/SQLCipher database
│   ├── ukey/              # U-Key hardware integration
│   ├── llm/               # LLM service integration (Ollama/Cloud)
│   ├── rag/               # RAG retrieval system
│   ├── git/               # Git sync and conflict resolution
│   ├── image/             # Image processing + OCR (Tesseract.js)
│   ├── did/               # DID identity system (W3C standard)
│   ├── p2p/               # P2P network (libp2p + Signal protocol)
│   ├── social/            # Social features (friends, posts, messaging)
│   ├── trade/             # Trading system (6 modules)
│   ├── vc/                # Verifiable credentials
│   ├── prompt/            # Prompt template management
│   ├── import/            # File import (MD/PDF/Word/TXT)
│   └── vector/            # Vector database client
└── src/renderer/          # Vue3 frontend
    ├── pages/             # Page components
    ├── components/        # Reusable components
    └── stores/            # Pinia state management
```

### Backend Services Architecture

- **project-service** (Spring Boot 3.1.11 + Java 17): Project metadata, Git operations
  - PostgreSQL for data
  - Redis for caching
  - MyBatis Plus for ORM
  - **IMPORTANT**: Requires MyBatis Plus 3.5.9+ for Spring Boot 3.x compatibility (current version 3.5.3.1 is outdated)

- **ai-service** (FastAPI + Python): AI/LLM inference, RAG, embeddings
  - Ollama for local LLM
  - Qdrant for vector storage
  - Supports 14+ cloud LLM providers (Alibaba Qwen, Zhipu GLM, Baidu Qianfan, etc.)

### Database Schema

Desktop app uses SQLite with SQLCipher (AES-256 encryption). Key tables:

- `notes` - Knowledge base entries
- `chat_conversations` - AI chat history
- `did_identities` - Decentralized identities
- `p2p_messages` - Encrypted P2P messages
- `contacts` - Friend relationships
- `social_posts` - Social network posts

## Technology Stack

### Desktop App Dependencies

- **Electron**: 39.2.6
- **Vue**: 3.4 with TypeScript
- **UI**: Ant Design Vue 4.1
- **State**: Pinia 2.1.7
- **Markdown**: Milkdown 7.17.3
- **P2P**: libp2p 3.1.2
- **Crypto**: node-forge, Signal Protocol (@privacyresearch/libsignal-protocol-typescript)
- **Image**: Sharp (processing), Tesseract.js (OCR)
- **Git**: isomorphic-git
- **Vector DB**: ChromaDB 3.1.8

### Backend Dependencies

- **Java**: 17 with Spring Boot 3.1.11
- **MyBatis Plus**: 3.5.3.1 (needs upgrade to 3.5.9)
- **Python**: FastAPI, Ollama, Qdrant
- **Databases**: PostgreSQL 16, Redis 7, SQLite

## Spring Boot 3.x Migration Notes

The codebase is migrating from Spring Boot 3.2.1 to 3.1.11. Key changes:

1. **Validation annotations**: Changed from `javax.validation.*` to `jakarta.validation.*`
2. **MyBatis Plus version**: Must use 3.5.9+ (current 3.5.3.1 is incompatible)
3. **Connection pool**: Switched from Druid to HikariCP (Spring Boot default)
4. **Application port**: Changed from 8080 to 9090 (PROJECT_SERVICE_PORT)

**Common issues:**

- If you see bean creation errors on startup, check MyBatis Plus version compatibility
- Ensure all `javax.*` imports are changed to `jakarta.*`

## Common Development Workflows

### Adding a New Feature to Desktop App

1. Define IPC channel in `src/main/index.js` (ipcMain.handle)
2. Implement logic in appropriate main process module
3. Create Vue component in `src/renderer/components/` or `src/renderer/pages/`
4. Add Pinia store if state management needed
5. Update routes if adding new page

### Working with Database

- Database file: `data/chainlesschain.db` (encrypted)
- Schema initialization: `src/main/database.js`
- Always use prepared statements to prevent SQL injection
- Database is automatically encrypted with SQLCipher if U-Key is available

### Git Sync System

- Auto-commits enabled by default
- Conflict resolution UI available in settings
- Uses isomorphic-git (pure JS implementation)
- Repository path: configured per user in settings

### P2P Messaging

- Uses libp2p for network layer
- Signal Protocol for E2E encryption
- Offline message queue supported
- Multi-device synchronization available

## U-Key Integration

**Windows Only**: Currently only supports Windows platform via Koffi FFI

- U-Key SDK: Located in `SIMKeySDK-20220416/`
- Simulation mode: Available for testing without hardware
- Default PIN: `123456`

**macOS/Linux**: Simulation mode only (hardware support planned)

## Environment Variables

Key environment variables (see `.env.example`):

```bash
# LLM Configuration
OLLAMA_HOST=http://localhost:11434
QDRANT_HOST=http://localhost:6333

# Database (for backend services)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chainlesschain
DB_USER=chainlesschain
DB_PASSWORD=chainlesschain_pwd_2024

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=chainlesschain_redis_2024

# Cloud LLM API Keys (optional)
DASHSCOPE_API_KEY=       # Alibaba Qwen
ZHIPUAI_API_KEY=         # Zhipu GLM
QIANFAN_API_KEY=         # Baidu
# ... (14 providers supported)
```

## Testing

```bash
# Desktop app tests
cd desktop-app-vue
npm run test:db      # Test database operations
npm run test:ukey    # Test U-Key integration

# Backend tests
cd backend/project-service
mvn test

# AI service tests
cd backend/ai-service
pytest
```

## Packaging & Distribution

```bash
# Windows installer
cd desktop-app-vue
npm run make:win

# Output: out/make/squirrel.windows/x64/ChainlessChain-*.exe
```

## Code Style & Commit Conventions

Follow semantic commit messages (Conventional Commits):

```
feat(rag): add reranker support
fix(ukey): resolve Windows driver compatibility
docs: update API documentation
refactor(p2p): improve message routing
test: add unit tests for credit scoring
chore: upgrade MyBatis Plus to 3.5.9
```

Prefixes: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`

## Known Limitations & Issues

1. **U-Key**: Windows only (macOS/Linux use simulation mode)
2. **MyBatis Plus**: Version 3.5.3.1 is incompatible with Spring Boot 3.1+ - needs upgrade to 3.5.9
3. **Mobile App**: uni-app version only 10% complete
4. **P2P**: E2E encryption implemented but needs more testing
5. **GPU**: Docker Ollama service requires NVIDIA GPU for optimal performance

## Important File Locations

- **Main config**: `desktop-app-vue/package.json`
- **Database schema**: `desktop-app-vue/src/main/database.js`
- **IPC handlers**: `desktop-app-vue/src/main/index.js`
- **Docker services**: `docker-compose.yml` (local), `docker-compose.cloud.yml` (cloud)
- **Project service config**: `backend/project-service/src/main/resources/application.yml`
- **AI service config**: `backend/ai-service/config.py`
- **Environment**: `.env` (git-ignored), `.env.example` (template)

## Troubleshooting

### Port Conflicts

- Desktop app dev server: 5173 (Vite)
- Signaling server: 9001 (WebSocket)
- Ollama: 11434
- Qdrant: 6333
- PostgreSQL: 5432
- Redis: 6379
- Project service: 9090
- AI service: 8001

### Build Failures

**Electron build fails**: Run `npm run build:main` before `npm run dev`

**Spring Boot startup fails**: Check MyBatis Plus version and jakarta vs javax imports

**Python service fails**: Ensure `httpx<0.26.0` for Ollama compatibility

### Database Issues

- Delete `data/chainlesschain.db` to reset (loses all data)
- Check PIN code is correct (default: `123456`)
- Verify SQLCipher encryption key is properly initialized

## Documentation References

- **System Design**: `docs/design/系统设计_个人移动AI管理系统.md` (123KB, comprehensive)
- **Implementation Status**: `IMPLEMENTATION_COMPLETE.md`
- **Project Progress**: `PROJECT_PROGRESS_REPORT_2025-12-18.md`
- **Quick Start**: `QUICK_START.md`, `HOW_TO_RUN.md`
- **Contributing**: `docs/development/CONTRIBUTING.md`
- **README**: `README.md` (Chinese), `README_EN.md` (English)
- **Cloud Deployment**: `README-云端部署指南.md`

## Priority Development Areas

**High Priority**:

- Upgrade MyBatis Plus to 3.5.9 for Spring Boot 3.x compatibility
- Complete E2E encryption testing for P2P messaging
- Voice input functionality
- Mobile UI completion

**Medium Priority**:

- Browser extension for web clipping
- Knowledge graph visualization
- Cross-platform U-Key support (macOS/Linux)

**Low Priority**:

- Plugin system
- Multi-language UI
- Enterprise features
