# Unit Tests Organization

This directory contains all unit tests for the ChainlessChain Desktop Application, organized by functional modules.

## Directory Structure

### Core Modules

#### `ai/` - AI & LLM Features (10 files)
AI engine, skills, tools, and conversation management.

**Files:**
- `ai-engine-workflow.test.js` - AI engine workflow orchestration
- `ai-skill-scheduler.test.js` - AI skill scheduling and execution
- `builtin-skills.test.js` - Built-in skills (file operations, search, etc.)
- `builtin-tools.test.js` - Built-in tools (calculator, converter, etc.)
- `conversation-executor.test.js` - Conversation flow execution
- `intent-classifier.test.js` - User intent classification
- `skill-executor.test.js` - Skill execution engine
- `skill-manager.test.js` - Skill registration and management
- `skill-recommender.test.js` - AI-powered skill recommendations
- `skill-tool-ipc.test.js` - IPC handlers for skills/tools

#### `llm/` - LLM Services (5 files)
LLM integration, session management, and optimization.

**Files:**
- `llm-service.test.js` - LLM service integration
- `prompt-compressor.test.js` - Prompt compression for token optimization
- `response-cache.test.js` - LLM response caching
- `session-manager.test.js` - Session context management
- `stream-controller.test.js` - Streaming response control
- `token-tracker.test.js` - Token usage tracking

#### `rag/` - RAG System
Retrieval-Augmented Generation for knowledge base.

#### `mcp/` - MCP Integration
Model Context Protocol server integration.

---

### Document & Media Processing

#### `document/` - Document Engines (6 files)
Office document processing and generation.

**Files:**
- `api-doc-generator.test.js` - API documentation generation
- `doc-generator.test.js` - Generic document generation
- `excel-engine.test.js` - Excel file processing (SheetJS)
- `pdf-engine.test.js` - PDF processing (pdf-lib)
- `ppt-engine.test.js` - PowerPoint processing
- `word-engine.test.js` - Word document processing (docxtemplater)

#### `media/` - Multimedia Processing (5 files)
Image, video, OCR, and speech processing.

**Files:**
- `image-engine.test.js` - Image processing (Sharp)
- `ocr-service.test.js` - OCR text extraction (Tesseract.js)
- `speech-manager.test.js` - Speech synthesis/recognition
- `speech-recognizer.test.js` - Speech-to-text recognition
- `video-engine.test.js` - Video processing (ffmpeg)

---

### Data & Storage

#### `database/` - Database Operations
SQLite/SQLCipher database, migrations, encryption.

**Files:**
- `database.test.js` - Core database functionality
- `database-adapter.test.js` - Database adapter layer
- `database-encryption-ipc.test.js` - Encryption IPC handlers
- `database-ipc.test.js` - Database IPC handlers
- `database-migration.test.js` - Schema migrations
- `key-manager.test.js` - Encryption key management
- `soft-delete.test.js` - Soft delete functionality
- `sqlcipher-wrapper.test.js` - SQLCipher wrapper

#### `knowledge/` - Knowledge Base
Note management, tags, search, and organization.

#### `knowledge-graph/` - Knowledge Graph
Graph-based knowledge representation and querying.

---

### Networking & Security

#### `p2p/` - P2P Network
libp2p networking, DHT, and peer discovery.

#### `sync/` - Synchronization
P2P sync engine, conflict resolution, offline queue.

**Files:**
- `sync-p0-fixes.test.js` - Critical sync bug fixes
- `sync-p1-fixes.test.js` - High-priority sync improvements
- `sync-queue.test.js` - Sync queue management

#### `did/` - Decentralized Identity
DID creation, verification, and invitation system.

**Files:**
- `did-invitation.test.js` - DID invitation flow
- `did-ipc.test.js` - DID IPC handlers

#### `security/` - Security & Encryption (2 files)
Cryptography and access control.

**Files:**
- `permission-system.test.js` - Permission and access control
- `pkcs11-encryption.test.js` - PKCS#11 hardware encryption (U-Key)

#### `ukey/` - U-Key Hardware Integration
U-Key/SIMKey hardware security module.

---

### Blockchain & Trading

#### `blockchain/` - Blockchain Integration
Wallet management, smart contracts, and asset operations.

**Files:**
- `asset-ipc.test.js` - Digital asset IPC handlers
- `blockchain-ipc.test.js` - Blockchain IPC handlers
- `bridge-manager.test.js` - Cross-chain bridge management
- `contract-ipc.test.js` - Smart contract IPC handlers
- `wallet-manager.test.js` - Multi-chain wallet management

#### `trade/` - Trading System
Digital asset trading and marketplace.

#### `credit/` - Credit System
Credit scoring and reputation management.

**Files:**
- `credit-ipc.test.js` - Credit system IPC handlers

---

### Development Tools

#### `code-tools/` - Code Tools
Code execution, review, and analysis.

**Files:**
- `code-ipc.test.js` - Code execution IPC handlers
- `review-ipc.test.js` - Code review IPC handlers

#### `git/` - Git Integration
Git operations via isomorphic-git.

**Files:**
- `git-manager.test.js` - Git operations manager
- `git-path-converter.test.js` - Path conversion utilities

---

### Core Infrastructure

#### `core/` - Core Components (4 files)
Fundamental system components.

**Files:**
- `core-components.test.ts` - Core Vue components
- `function-caller.test.js` - Function calling utilities
- `ipc-guard.test.js` - IPC security guard
- `response-parser.test.js` - Response parsing utilities

#### `config/` - Configuration Management (2 files)
Application configuration and initialization.

**Files:**
- `config-manager.test.js` - Unified configuration manager
- `initial-setup-config.test.js` - First-run setup wizard

#### `bootstrap/` - Bootstrap & Initialization
Application startup and dependency injection.

**Files:**
- `initializer-factory.test.js` - Initializer factory pattern

#### `ipc/` - IPC Communication
Inter-Process Communication between main and renderer.

---

### UI Components & Pages

#### `components/` - Vue Components
Reusable Vue components (Ant Design Vue).

**Files:**
- `OfflineQueueManager.test.ts` - Offline operation queue
- `OnlineStatusIndicator.test.ts` - Online status indicator
- `SkillCard.test.ts` - AI skill card component
- `planning-components.test.js` - Planning UI components

#### `pages/` - Page Components
Full-page Vue components.

**Files:**
- `PlanningView.test.js` - Planning view page
- `PythonExecutionPanel.test.ts` - Python code execution panel

#### `stores/` - Pinia State Management
Centralized state stores (Pinia).

**Files:**
- `planning-store.test.js` - Planning state store

---

### Utilities & Helpers

#### `utils/` - Utilities (3 files)
General-purpose utilities and helpers.

**Files:**
- `field-mapper.test.js` - Field mapping utilities
- `graph-extractor.test.js` - Graph data extraction
- `markdown-exporter.test.js` - Markdown export utilities

#### `tools/` - Tool Management (3 files)
AI tool registration and execution.

**Files:**
- `template-manager.test.js` - Template management
- `tool-manager.test.js` - Tool registration and lifecycle
- `tool-runner.test.js` - Tool execution engine

#### `planning/` - Planning & Task Management (3 files)
AI-powered task planning and decomposition.

**Files:**
- `task-planner.test.js` - Task planning engine
- `task-planner-enhanced.test.js` - Enhanced planning features
- `taskPlanner.test.js` - (Note: potential duplicate, needs review)

---

### Integration & Cross-Cutting

#### `integration/` - Integration Tests (3 files)
Cross-module integration tests.

**Files:**
- `code-executor.test.js` - Code execution integration
- `p2p-sync-engine.test.js` - P2P sync integration
- `rag-llm-git.test.js` - RAG + LLM + Git integration

#### `api/` - External API Integration
RSS, email, and other external services.

**Files:**
- `email-client.test.js` - Email client integration
- `rss-fetcher.test.js` - RSS feed fetcher

#### `import/` - Data Import
File import and data migration.

**Files:**
- `import-ipc.test.js` - Import IPC handlers

#### `file/` - File Operations
File browser, permissions, and management.

**Files:**
- `file-import.test.js` - File import functionality
- `file-ipc.test.js` - File operation IPC handlers
- `file-permission-manager.test.js` - File permission management

#### `multimedia/` - Multimedia Integration
Cross-media processing and conversion.

#### `organization/` - Organization & Metadata
File organization and metadata management.

#### `prompt-template/` - Prompt Templates
LLM prompt template management.

#### `edge-cases/` - Edge Cases
Edge case and error scenario testing.

**Files:**
- `edge-cases.test.js` - Edge case test suite

---

## Testing Conventions

### Naming
- Test files: `<module-name>.test.js` or `<module-name>.test.ts`
- Test suites: `describe('<ModuleName>')`
- Test cases: `it('should <expected behavior>')`

### Structure
```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('ModuleName', () => {
  beforeEach(() => {
    // Setup
  })

  afterEach(() => {
    // Cleanup
  })

  it('should perform expected behavior', () => {
    // Arrange
    const input = ...

    // Act
    const result = ...

    // Assert
    expect(result).toBe(...)
  })
})
```

### Mocking
- Electron APIs: Use `__mocks__/electron.js`
- IPC: Mock `ipcMain` and `ipcRenderer`
- Database: Use in-memory SQLite
- File system: Mock `fs` operations

### Coverage Goals
- Core modules: 80%+
- Critical paths (security, sync, database): 90%+
- UI components: 60%+

---

## Running Tests

```bash
# Run all unit tests
npm run test:unit

# Run specific module
npm run test:unit -- ai/
npm run test:unit -- database/

# Run with coverage
npm run test:unit:coverage

# Watch mode
npm run test:unit:watch
```

---

## Migration Notes (2026-01-25)

**Reorganized 54 root-level test files into 10 new directories:**

1. **ai/** (10 files) - AI engine, skills, tools
2. **config/** (2 files) - Configuration management
3. **document/** (6 files) - Document engines (Excel/Word/PDF/PPT)
4. **media/** (5 files) - Multimedia processing
5. **security/** (2 files) - Security and encryption
6. **core/** (4 files) - Core components
7. **planning/** (3 files) - Task planning
8. **tools/** (3 files) - Tool management
9. **utils/** (3 files) - Utilities
10. **integration/** (3 files) - Integration tests

**Total tests organized: 125 files across 38 directories**

**TODO:**
- [ ] Review duplicate task planner tests (merge if needed)
- [ ] Update import paths if any tests fail
- [ ] Add README files to subdirectories with specific testing notes
- [ ] Update CI/CD test runners if they reference specific paths
