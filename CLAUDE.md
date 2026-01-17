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

## Memory Bank System (OpenClaude Best Practice)

**Status**: ✅ Implemented (v0.20.0)
**Added**: 2026-01-16

基于 OpenClaude 最佳实践，项目使用 Memory Bank 系统来保持 AI 助手的跨会话上下文。

### Memory Bank 文件

| 文件                        | 用途                       | 更新时机       |
| --------------------------- | -------------------------- | -------------- |
| `CLAUDE.md`                 | 主要项目文档和 AI 指南     | 重大功能变更时 |
| `CLAUDE-patterns.md`        | 已验证的架构模式和解决方案 | 发现新模式时   |
| `CLAUDE-decisions.md`       | 架构决策记录 (ADR)         | 重大架构决策时 |
| `CLAUDE-troubleshooting.md` | 已知问题和解决方案         | 解决新问题时   |
| `CLAUDE-activeContext.md`   | 当前会话状态和工作焦点     | 每次会话结束时 |

### 使用方式

**AI 助手应该**:

1. 会话开始时阅读 `CLAUDE-activeContext.md` 了解当前状态
2. 遇到问题时查阅 `CLAUDE-troubleshooting.md`
3. 做架构决策时参考 `CLAUDE-decisions.md` 和 `CLAUDE-patterns.md`
4. 会话结束时更新 `CLAUDE-activeContext.md`

**开发者应该**:

1. 解决新问题后更新 `CLAUDE-troubleshooting.md`
2. 做出重要架构决策后添加 ADR 到 `CLAUDE-decisions.md`
3. 发现有效模式后记录到 `CLAUDE-patterns.md`

### 目录结构

```
项目根目录/
├── CLAUDE.md                    # 主文档
├── CLAUDE-patterns.md           # 架构模式
├── CLAUDE-decisions.md          # 架构决策记录
├── CLAUDE-troubleshooting.md    # 故障排除指南
├── CLAUDE-activeContext.md      # 当前会话上下文
└── .chainlesschain/
    └── memory/                  # 运行时记忆数据
        ├── sessions/            # 会话历史
        ├── preferences/         # 用户偏好
        └── learned-patterns/    # 学习到的模式
```

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

## LLM Performance Dashboard (性能仪表板可视化)

**Status**: ✅ Implemented (v0.20.0)
**Added**: 2026-01-16
**Priority**: 2

LLM 性能仪表板提供全面的 Token 使用、成本分析和性能优化监控。

### 核心功能

1. **统计概览**: 总调用次数、Token 消耗、成本（USD/CNY）、缓存命中率
2. **Token 使用趋势图**: 基于 ECharts 的折线图，支持按小时/天/周显示
3. **成本分解可视化**:
   - 按提供商成本分布（饼图）
   - 按模型成本分布（柱状图，Top 10）
4. **详细统计表格**: 按提供商和模型分组的可排序表格
5. **数据导出**: 生成包含完整统计数据的 Excel/CSV 报告

### 访问方式

- **URL**: `#/llm/performance`
- **路由名称**: `LLMPerformance`
- **位置**: 系统监控与维护 → LLM 性能仪表板

### 技术实现

- **前端组件**: `desktop-app-vue/src/renderer/pages/LLMPerformancePage.vue`
- **图表库**: ECharts 6.0
- **数据源**: TokenTracker (`desktop-app-vue/src/main/llm/token-tracker.js`)
- **IPC 接口**: `llm:get-usage-stats`, `llm:get-time-series`, `llm:get-cost-breakdown`

### 性能指标

- **统计延迟**: < 1 秒
- **自动刷新**: 每 60 秒
- **数据准确性**: 100%（所有 LLM 调用都被追踪）
- **支持时间范围**: 24 小时、7 天、30 天、自定义

### 文档

详细使用指南：[`docs/features/LLM_PERFORMANCE_DASHBOARD.md`](docs/features/LLM_PERFORMANCE_DASHBOARD.md)

## SessionManager (会话管理系统)

**Status**: ✅ Implemented (v0.21.0 - Enhanced)
**Added**: 2026-01-16
**Updated**: 2026-01-16

SessionManager 实现智能会话上下文管理，支持跨会话连续对话和 Token 优化。基于 OpenClaude 最佳实践设计。

### 核心功能

1. **会话持久化**: 自动保存对话历史到 `.chainlesschain/memory/sessions/`
2. **智能压缩**: 集成 PromptCompressor，自动压缩长对话历史
3. **Token 优化**: 减少 30-40% Token 使用，降低 LLM 成本
4. **跨会话恢复**: 支持加载历史会话继续对话
5. **统计分析**: 追踪压缩效果和 Token 节省

### 增强功能 (v0.21.0 新增)

6. **会话搜索**: 按标题和消息内容全文搜索历史会话
7. **标签系统**: 为会话添加标签，支持按标签过滤和查找
8. **导出/导入**: 支持导出为 JSON/Markdown 格式，支持从 JSON 导入
9. **智能摘要**: 自动或手动生成会话摘要（支持 LLM 和简单模式）
10. **会话续接**: 智能上下文恢复，生成续接提示
11. **会话模板**: 将会话保存为模板，快速创建新会话
12. **批量操作**: 批量删除、批量添加标签、批量导出
13. **全局统计**: 跨会话的使用统计和分析

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

#### 搜索会话

```javascript
// 按标题和内容搜索
const results = await sessionManager.searchSessions("数据库优化", {
  searchTitle: true,
  searchContent: true,
  limit: 20,
});
```

#### 标签管理

```javascript
// 添加标签
await sessionManager.addTags(session.id, ["技术讨论", "数据库"]);

// 按标签查找
const sessions = await sessionManager.findSessionsByTags(["技术讨论"]);

// 获取所有标签
const allTags = await sessionManager.getAllTags();
```

#### 导出/导入

```javascript
// 导出为 JSON
const json = await sessionManager.exportToJSON(session.id);

// 导出为 Markdown
const markdown = await sessionManager.exportToMarkdown(session.id, {
  includeMetadata: true,
});

// 从 JSON 导入
const imported = await sessionManager.importFromJSON(jsonData);

// 批量导出
const batch = await sessionManager.exportMultiple([id1, id2, id3]);
```

#### 摘要生成

```javascript
// 生成摘要（优先使用 LLM）
const summary = await sessionManager.generateSummary(session.id);

// 批量生成
await sessionManager.generateSummariesBatch({ overwrite: false });
```

#### 会话续接

```javascript
// 恢复会话，获取上下文提示
const result = await sessionManager.resumeSession(session.id);
console.log(result.contextPrompt); // 续接上下文提示
console.log(result.messages); // 有效消息

// 获取最近会话
const recent = await sessionManager.getRecentSessions(5);
```

#### 会话模板

```javascript
// 保存为模板
const template = await sessionManager.saveAsTemplate(session.id, {
  name: "技术讨论模板",
  description: "用于技术问题讨论",
  category: "tech",
});

// 从模板创建
const newSession = await sessionManager.createFromTemplate(template.id);

// 列出模板
const templates = await sessionManager.listTemplates({ category: "tech" });
```

#### 全局统计

```javascript
const stats = await sessionManager.getGlobalStats();
console.log("总会话数:", stats.totalSessions);
console.log("总消息数:", stats.totalMessages);
console.log("节省 Tokens:", stats.totalTokensSaved);
console.log("唯一标签数:", stats.uniqueTags);
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

### IPC 通道

| 通道                           | 功能          |
| ------------------------------ | ------------- |
| `session:create`               | 创建会话      |
| `session:load`                 | 加载会话      |
| `session:add-message`          | 添加消息      |
| `session:search`               | 搜索会话      |
| `session:add-tags`             | 添加标签      |
| `session:remove-tags`          | 移除标签      |
| `session:get-all-tags`         | 获取所有标签  |
| `session:find-by-tags`         | 按标签查找    |
| `session:export-json`          | 导出 JSON     |
| `session:export-markdown`      | 导出 Markdown |
| `session:import-json`          | 导入 JSON     |
| `session:generate-summary`     | 生成摘要      |
| `session:resume`               | 恢复会话      |
| `session:get-recent`           | 获取最近会话  |
| `session:save-as-template`     | 保存为模板    |
| `session:create-from-template` | 从模板创建    |
| `session:list-templates`       | 列出模板      |
| `session:delete-multiple`      | 批量删除      |
| `session:add-tags-multiple`    | 批量添加标签  |
| `session:get-global-stats`     | 获取全局统计  |
| `session:update-title`         | 更新会话标题  |

### 性能指标

- **压缩率**: 通常为 0.6-0.7（节省 30-40% tokens）
- **压缩延迟**: < 500ms（不使用 LLM 总结）
- **搜索延迟**: < 100ms（1000 条会话内）
- **存储开销**: < 1MB per session（100条消息）

### 测试

```bash
# 运行 SessionManager 测试（包含所有增强功能）
cd desktop-app-vue
node scripts/test-session-manager.js
```

### 实现文件

- **核心模块**: `desktop-app-vue/src/main/llm/session-manager.js`
- **IPC 处理器**: `desktop-app-vue/src/main/llm/session-manager-ipc.js`
- **数据库迁移**: `desktop-app-vue/src/main/database/migrations/005_llm_sessions.sql`
- **模板表迁移**: `desktop-app-vue/src/main/database/migrations/008_session_templates.sql`
- **测试脚本**: `desktop-app-vue/scripts/test-session-manager.js`

### 数据库表

- `llm_sessions`: 存储会话元数据和消息历史
- `llm_session_templates`: 存储会话模板
- `llm_usage_log`: 记录 LLM Token 使用
- `llm_budget_config`: 预算配置和限额
- `llm_cache`: 响应缓存

## ErrorMonitor AI 诊断系统

**Status**: ✅ Implemented (v0.22.0)
**Added**: 2026-01-16

ErrorMonitor 提供智能错误诊断和自动修复能力，使用本地 LLM 进行免费的 AI 分析。基于 OpenClaude 最佳实践中的错误智能诊断方案。

### 核心功能

1. **AI 智能诊断**: 使用本地 Ollama 模型分析错误原因和修复方案（完全免费）
2. **自动分类**: 将错误自动分类为 DATABASE、NETWORK、FILESYSTEM、VALIDATION 等类型
3. **严重程度评估**: 四级评估系统（low/medium/high/critical）
4. **自动修复**: 支持重试、超时调整、降级、验证等修复策略
5. **相关问题查找**: 从历史记录中查找相似错误
6. **详细统计**: 按分类、严重程度、时间维度统计错误
7. **诊断报告**: 生成结构化的 Markdown 诊断报告

### 使用方式

#### 分析错误

```javascript
const analysis = await errorMonitor.analyzeError(error);

console.log("错误分类:", analysis.classification);
console.log("严重程度:", analysis.severity);
console.log("自动修复结果:", analysis.autoFixResult);
console.log("AI 诊断:", analysis.aiDiagnosis);
console.log("推荐操作:", analysis.recommendations);
```

#### 获取错误统计

```javascript
const stats = await errorMonitor.getErrorStats({ days: 7 });

console.log("总错误数:", stats.total);
console.log("严重程度分布:", stats.bySeverity);
console.log("分类统计:", stats.byClassification);
console.log("自动修复率:", stats.autoFixRate);
```

#### 生成诊断报告

```javascript
const report = await errorMonitor.generateDiagnosisReport(error);
// 返回 Markdown 格式的详细诊断报告
```

#### 查找相关问题

```javascript
const relatedIssues = await errorMonitor.findRelatedIssues(error, 5);
// 返回最多 5 个相似的历史错误
```

### IPC 通道

前端可通过以下 IPC 通道使用 ErrorMonitor：

- `error:analyze` - 分析错误并返回完整诊断
- `error:get-diagnosis-report` - 生成 Markdown 诊断报告
- `error:get-stats` - 获取错误统计信息
- `error:get-related-issues` - 查找相关错误
- `error:get-analysis-history` - 获取分析历史
- `error:delete-analysis` - 删除分析记录
- `error:cleanup-old-analyses` - 清理旧记录
- `error:get-classification-stats` - 获取分类统计
- `error:get-severity-stats` - 获取严重程度统计
- `error:toggle-ai-diagnosis` - 启用/禁用 AI 诊断
- `error:reanalyze` - 重新分析错误

### 配置参数

| 参数                | 默认值                                                  | 说明                                    |
| ------------------- | ------------------------------------------------------- | --------------------------------------- |
| `enableAIDiagnosis` | true                                                    | 启用 AI 智能诊断                        |
| `autoFixStrategies` | ['retry', 'timeout_increase', 'fallback', 'validation'] | 启用的自动修复策略                      |
| `llmProvider`       | 'ollama'                                                | LLM 提供商（默认使用免费的本地 Ollama） |
| `llmModel`          | 'qwen2:7b'                                              | LLM 模型                                |
| `llmTemperature`    | 0.1                                                     | LLM 温度参数（低温度保证诊断准确性）    |

### 错误分类

ErrorMonitor 自动将错误分类为以下类型：

- **DATABASE**: 数据库相关错误（SQLite、连接、锁等）
- **NETWORK**: 网络请求错误（超时、连接失败、DNS等）
- **FILESYSTEM**: 文件系统错误（权限、不存在、磁盘满等）
- **VALIDATION**: 数据验证错误（格式、范围、必填等）
- **AUTHENTICATION**: 认证和授权错误
- **RATE_LIMIT**: API 速率限制
- **PERMISSION**: 权限错误
- **CONFIGURATION**: 配置错误
- **DEPENDENCY**: 依赖错误
- **UNKNOWN**: 未知类型

### 严重程度评估

四级评估系统：

- **critical**: 导致应用崩溃或核心功能不可用
- **high**: 严重影响用户体验或数据完整性
- **medium**: 影响部分功能但有降级方案
- **low**: 轻微问题，不影响主要功能

### AI 诊断提示词

ErrorMonitor 使用结构化提示词获取高质量诊断：

```
请分析以下 JavaScript 错误并提供修复建议：

**错误信息**: [错误消息]
**堆栈跟踪**: [堆栈信息]
**运行环境**: [平台、Node版本等]
**错误分类**: [自动分类结果]

请提供：
1. **错误根本原因**
2. **修复方案** (2-3种，按优先级排序)
3. **最佳实践**
4. **相关文档**
```

### 性能指标

- **分析延迟**:
  - 不含 AI: < 50ms
  - 含 AI 诊断: 2-5s（取决于本地 Ollama 性能）
- **自动修复成功率**: 约 40-60%（取决于错误类型）
- **AI 诊断准确率**: 约 80-90%（使用 Qwen2:7B）
- **存储开销**: 约 5KB per analysis

### 测试

```bash
# 运行 ErrorMonitor 测试
cd desktop-app-vue
node scripts/test-error-monitor.js
```

测试覆盖：

- ✅ 错误分析和分类
- ✅ 严重程度评估
- ✅ 自动修复尝试
- ✅ AI 智能诊断
- ✅ 错误统计
- ✅ 诊断报告生成
- ✅ 历史记录查询

### 实现文件

- **核心模块**: `desktop-app-vue/src/main/error-monitor.js`
- **IPC 处理器**: `desktop-app-vue/src/main/error-monitor-ipc.js`
- **数据库迁移**: `desktop-app-vue/src/main/database/migrations/006_error_analysis.sql`
- **测试脚本**: `desktop-app-vue/scripts/test-error-monitor.js`

### 数据库表

- `error_analysis`: 存储错误分析结果和 AI 诊断
  - 包含：错误信息、分类、严重程度、自动修复结果、AI 诊断、相关问题等
- `error_diagnosis_config`: 诊断配置（AI 启用状态、LLM 模型等）

### 数据库视图

为便于统计分析，提供以下视图：

- `error_stats_by_classification`: 按分类统计错误
- `error_stats_by_severity`: 按严重程度统计
- `error_daily_trend`: 每日错误趋势（最近 30 天）

### 成本优势

使用本地 Ollama 进行 AI 诊断的优势：

- ✅ **完全免费**: 无 API 调用成本
- ✅ **数据隐私**: 错误信息不会发送到云端
- ✅ **快速响应**: 本地推理，无网络延迟
- ✅ **无限使用**: 不受 API 配额限制

与云端 AI 诊断的成本对比（假设每天 100 次诊断）：

| 方案            | 每次 Tokens | 每天成本（USD） | 每月成本（USD） |
| --------------- | ----------- | --------------- | --------------- |
| **本地 Ollama** | 350         | $0.00           | $0.00           |
| 阿里云通义千问  | 350         | $0.05           | $1.50           |
| OpenAI GPT-4    | 350         | $0.70           | $21.00          |

## Manus Optimizations (Context Engineering + Tool Masking + Multi-Agent)

**Status**: ✅ Implemented (v0.24.0)
**Added**: 2026-01-17
**Updated**: 2026-01-17

基于 [Manus AI](https://manus.im/) 和 [OpenManus](https://github.com/FoundationAgents/OpenManus) 的最佳实践，实现生产级 AI Agent 优化。

### 核心功能

1. **Context Engineering (KV-Cache 优化)**
   - 保持 prompt 前缀稳定，最大化 KV-Cache 命中率
   - 移除动态内容（时间戳、UUID）避免缓存失效
   - 确定性工具定义序列化
   - 理论成本降低 **10x**（0.30 vs 3 USD/MTok）

2. **Tool Masking (工具掩码)**
   - 通过掩码控制工具可用性，而非动态修改定义
   - 支持前缀批量控制（如 `browser_*`、`file_*`）
   - 任务阶段状态机（planning → executing → validating → committing）

3. **Task Tracking (todo.md 机制) - 🆕 文件系统持久化**
   - 将任务目标"重述"到上下文末尾
   - 解决长对话中的"丢失中间"问题
   - **🆕 文件系统持久化**：任务自动保存到 `todo.md`
   - **🆕 任务恢复**：支持恢复未完成的任务
   - **🆕 中间结果保存**：每个步骤结果可单独保存和恢复
   - 支持 ~50 次工具调用的长任务

4. **Recoverable Compression (可恢复压缩)**
   - 保留 URL/路径，丢弃内容本体
   - 按需恢复原始内容
   - 扩展上下文容量 3x

5. **🆕 Multi-Agent 系统**
   - **Agent 协调器**：智能任务分发和路由
   - **专用 Agent**：
     - `CodeGenerationAgent` - 代码生成、重构、审查、Bug 修复
     - `DataAnalysisAgent` - 数据分析、可视化、统计、预测
     - `DocumentAgent` - 文档编写、翻译、摘要、格式转换
   - **并行执行**：多个 Agent 同时处理不同任务
   - **链式执行**：前一个 Agent 输出作为下一个输入
   - **Agent 间通信**：消息传递和协作

### 使用方式

#### LLMManager API

```javascript
const { getLLMManager } = require('./llm/llm-manager');
const llm = getLLMManager();

// 构建优化 Prompt
const optimized = llm.buildOptimizedPrompt({
  systemPrompt: 'You are a helpful assistant.',
  messages: [...],
  tools: [...]
});

// 任务追踪
llm.startTask({
  objective: '创建一个 React 组件',
  steps: ['分析需求', '编写代码', '添加测试']
});

llm.updateTaskProgress(1, 'executing');
llm.completeCurrentStep();
llm.completeTask();

// 工具掩码控制
llm.setToolAvailable('file_writer', false);
llm.setToolsByPrefix('git', true);
llm.transitionToPhase('executing');
```

#### FunctionCaller API

```javascript
const FunctionCaller = require('./ai-engine/function-caller');
const fc = new FunctionCaller();

// 工具掩码控制
fc.setToolAvailable('git_commit', true);
fc.setToolsByPrefix('file', false);
fc.enableAllTools();
fc.disableAllTools();
fc.setOnlyAvailable(['file_reader', 'file_writer']);

// 任务阶段状态机
fc.configureTaskPhases(); // 使用默认配置
fc.transitionToPhase('planning');
fc.transitionToPhase('executing');

// 获取统计
const stats = fc.getMaskingStats();
```

### IPC 通道

**Manus 优化通道**:

| 通道 | 功能 |
|------|------|
| `manus:start-task` | 开始任务追踪 |
| `manus:update-progress` | 更新任务进度 |
| `manus:complete-step` | 完成当前步骤 |
| `manus:complete-task` | 完成任务 |
| `manus:cancel-task` | 取消任务 |
| `manus:get-current-task` | 获取当前任务 |
| `manus:set-tool-available` | 设置工具可用性 |
| `manus:set-tools-by-prefix` | 按前缀设置可用性 |
| `manus:validate-tool-call` | 验证工具调用 |
| `manus:configure-phases` | 配置阶段状态机 |
| `manus:transition-to-phase` | 切换阶段 |
| `manus:get-stats` | 获取统计信息 |
| `manus:build-optimized-prompt` | 构建优化 Prompt |
| `manus:compress-content` | 压缩内容 |

**🆕 TaskTracker 通道**:

| 通道 | 功能 |
|------|------|
| `task-tracker:create` | 创建任务 |
| `task-tracker:start` | 开始任务 |
| `task-tracker:update-progress` | 更新进度 |
| `task-tracker:complete-step` | 完成当前步骤 |
| `task-tracker:complete` | 完成任务 |
| `task-tracker:cancel` | 取消任务 |
| `task-tracker:get-todo-context` | 获取 todo.md 内容 |
| `task-tracker:load-unfinished` | 恢复未完成任务 |
| `task-tracker:get-history` | 获取任务历史 |

**🆕 Multi-Agent 通道**:

| 通道 | 功能 |
|------|------|
| `agent:list` | 获取所有 Agent |
| `agent:dispatch` | 分发任务到 Agent |
| `agent:execute-parallel` | 并行执行多个任务 |
| `agent:execute-chain` | 链式执行任务 |
| `agent:get-capable` | 获取能处理任务的 Agent |
| `agent:send-message` | Agent 间发送消息 |
| `agent:get-stats` | 获取统计信息 |

### 任务阶段状态机

预定义的任务阶段：

| 阶段 | 可用工具 | 说明 |
|------|----------|------|
| `planning` | file_reader, info_searcher, search_* | 只读操作 |
| `executing` | file_*, html_*, css_*, js_*, git_*, code_* | 写入和修改 |
| `validating` | file_reader, test_*, validate_*, check_* | 只读和测试 |
| `committing` | git_init, git_commit | Git 操作 |

### 实现文件

**Context Engineering & Tool Masking**:
- `desktop-app-vue/src/main/llm/context-engineering.js`
- `desktop-app-vue/src/main/ai-engine/tool-masking.js`
- `desktop-app-vue/src/main/llm/manus-optimizations.js`
- `desktop-app-vue/src/main/llm/manus-ipc.js`

**🆕 TaskTrackerFile (todo.md 机制)**:
- `desktop-app-vue/src/main/ai-engine/task-tracker-file.js`
- `desktop-app-vue/src/main/ai-engine/task-tracker-ipc.js`

**🆕 Multi-Agent 系统**:
- `desktop-app-vue/src/main/ai-engine/multi-agent/agent-orchestrator.js`
- `desktop-app-vue/src/main/ai-engine/multi-agent/specialized-agent.js`
- `desktop-app-vue/src/main/ai-engine/multi-agent/agents/code-generation-agent.js`
- `desktop-app-vue/src/main/ai-engine/multi-agent/agents/data-analysis-agent.js`
- `desktop-app-vue/src/main/ai-engine/multi-agent/agents/document-agent.js`
- `desktop-app-vue/src/main/ai-engine/multi-agent/multi-agent-ipc.js`

### 性能指标

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| KV-Cache 命中率 | ~30% | >80% |
| Token 成本 | 基准 | -50~90% |
| 长任务成功率 | ~70% | >90% |
| 工具调用验证 | 无 | 100% |

### 参考资料

- [Context Engineering for AI Agents - Manus Blog](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [OpenManus GitHub](https://github.com/FoundationAgents/OpenManus)
- 详细优化指南：`docs/MANUS_OPTIMIZATION_GUIDE.md`

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
