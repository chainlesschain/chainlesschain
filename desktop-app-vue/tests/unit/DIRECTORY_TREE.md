# Unit Tests Directory Tree

Generated: 2026-01-25

```
tests/unit/
│
├── 📁 NEW DIRECTORIES (54 files moved from root)
│   ├── ai/                    (10 files) - AI engine, skills, tools
│   ├── config/                (2 files)  - Configuration management
│   ├── document/              (6 files)  - Document engines (Excel/Word/PDF/PPT)
│   ├── media/                 (5 files)  - Multimedia processing
│   ├── security/              (2 files)  - Security & encryption
│   ├── core/                  (4 files)  - Core components
│   ├── planning/              (3 files)  - Task planning
│   ├── tools/                 (3 files)  - Tool management
│   ├── utils/                 (3 files)  - Utilities
│   └── integration/           (3 files)  - Integration tests
│
├── 📁 EXISTING DIRECTORIES (updated with root files)
│   ├── api/                   (2 files)  - External API integration
│   ├── blockchain/            (5 files)  - Blockchain & wallet
│   ├── bootstrap/             (1 file)   - Application bootstrap
│   ├── code-tools/            (2 files)  - Code execution & review
│   ├── components/            (4 files)  - Vue components [+1]
│   ├── credit/                (1 file)   - Credit system
│   ├── database/              (8 files)  - Database operations [+2]
│   ├── did/                   (2 files)  - Decentralized identity [+1]
│   ├── edge-cases/            (1 file)   - Edge case testing
│   ├── file/                  (3 files)  - File operations [+1]
│   ├── git/                   (2 files)  - Git integration [+1]
│   ├── import/                (1 file)   - Data import
│   ├── ipc/                   (varies)   - IPC communication
│   ├── knowledge/             (1 file)   - Knowledge base
│   ├── knowledge-graph/       (1 file)   - Knowledge graph
│   ├── llm/                   (5 files)  - LLM services [+1]
│   ├── mcp/                   (varies)   - MCP integration
│   ├── multimedia/            (varies)   - Multimedia integration
│   ├── organization/          (varies)   - File organization
│   ├── p2p/                   (varies)   - P2P networking
│   ├── pages/                 (2 files)  - Page components [+2]
│   ├── prompt-template/       (varies)   - Prompt templates
│   ├── rag/                   (varies)   - RAG system
│   ├── stores/                (1 file)   - Pinia stores [+1]
│   ├── sync/                  (6 files)  - Synchronization [+3]
│   ├── trade/                 (varies)   - Trading system
│   └── ukey/                  (varies)   - U-Key integration
│
├── 📁 SPECIAL DIRECTORIES
│   ├── __mocks__/             - Shared mocks (electron, etc.)
│   └── temp/                  - Temporary test files
│
└── 📄 DOCUMENTATION
    ├── README.md                      - Complete directory guide
    ├── REORGANIZATION_PLAN.md         - Original reorganization plan
    ├── REORGANIZATION_SUMMARY.md      - Reorganization summary
    └── DIRECTORY_TREE.md              - This file
```

---

## Key Statistics

| Category | Count | Notes |
|----------|-------|-------|
| **Total Directories** | 38 | 10 new + 28 existing |
| **Total Test Files** | 125+ | Across all directories |
| **Root Level Files** | 0 | ✅ Successfully cleaned |
| **New Directories Created** | 10 | ai, config, document, media, security, core, planning, tools, utils, integration |
| **Files Reorganized** | 54 | Moved from root to subdirectories |

---

## New Directory Breakdown

### 1. ai/ (10 files)
```
ai/
├── ai-engine-workflow.test.js
├── ai-skill-scheduler.test.js
├── builtin-skills.test.js
├── builtin-tools.test.js
├── conversation-executor.test.js
├── intent-classifier.test.js
├── skill-executor.test.js
├── skill-manager.test.js
├── skill-recommender.test.js
└── skill-tool-ipc.test.js
```

### 2. config/ (2 files)
```
config/
├── config-manager.test.js
└── initial-setup-config.test.js
```

### 3. document/ (6 files)
```
document/
├── api-doc-generator.test.js
├── doc-generator.test.js
├── excel-engine.test.js
├── pdf-engine.test.js
├── ppt-engine.test.js
└── word-engine.test.js
```

### 4. media/ (5 files)
```
media/
├── image-engine.test.js
├── ocr-service.test.js
├── speech-manager.test.js
├── speech-recognizer.test.js
└── video-engine.test.js
```

### 5. security/ (2 files)
```
security/
├── permission-system.test.js
└── pkcs11-encryption.test.js
```

### 6. core/ (4 files)
```
core/
├── core-components.test.ts
├── function-caller.test.js
├── ipc-guard.test.js
└── response-parser.test.js
```

### 7. planning/ (3 files)
```
planning/
├── task-planner.test.js
├── task-planner-enhanced.test.js
└── taskPlanner.test.js            ⚠️ Potential duplicate
```

### 8. tools/ (3 files)
```
tools/
├── template-manager.test.js
├── tool-manager.test.js
└── tool-runner.test.js
```

### 9. utils/ (3 files)
```
utils/
├── field-mapper.test.js
├── graph-extractor.test.js
└── markdown-exporter.test.js
```

### 10. integration/ (3 files)
```
integration/
├── code-executor.test.js
├── p2p-sync-engine.test.js
└── rag-llm-git.test.js
```

---

## Module Groupings

### 🤖 AI & Intelligence
- `ai/` - AI engine, skills, tools
- `llm/` - LLM services
- `rag/` - RAG system
- `mcp/` - MCP integration
- `prompt-template/` - Prompt management

### 📄 Document Processing
- `document/` - Office document engines
- `media/` - Multimedia processing
- `multimedia/` - Cross-media integration

### 💾 Data & Storage
- `database/` - Database operations
- `knowledge/` - Knowledge base
- `knowledge-graph/` - Graph representation
- `file/` - File operations
- `import/` - Data import
- `organization/` - File organization

### 🔒 Security & Identity
- `security/` - Encryption & permissions
- `ukey/` - Hardware security
- `did/` - Decentralized identity

### 🌐 Networking
- `p2p/` - P2P networking
- `sync/` - Synchronization
- `api/` - External APIs

### 🪙 Blockchain & Trading
- `blockchain/` - Blockchain integration
- `trade/` - Trading system
- `credit/` - Credit scoring

### 🛠️ Development Tools
- `code-tools/` - Code execution & review
- `git/` - Git operations
- `tools/` - Tool management

### 🏗️ Infrastructure
- `core/` - Core components
- `config/` - Configuration
- `bootstrap/` - Initialization
- `ipc/` - IPC communication

### 🎨 UI & UX
- `components/` - Vue components
- `pages/` - Page components
- `stores/` - Pinia stores

### 🧪 Testing & Quality
- `integration/` - Integration tests
- `edge-cases/` - Edge case testing
- `planning/` - Task planning

### 🔧 Utilities
- `utils/` - General utilities
- `__mocks__/` - Shared mocks

---

## Navigation Tips

### Finding Tests by Feature
```bash
# AI-related tests
ls tests/unit/ai/*.test.js
ls tests/unit/llm/*.test.js
ls tests/unit/rag/*.test.js

# Document processing tests
ls tests/unit/document/*.test.js
ls tests/unit/media/*.test.js

# Database tests
ls tests/unit/database/*.test.js
ls tests/unit/knowledge/*.test.js

# Security tests
ls tests/unit/security/*.test.js
ls tests/unit/ukey/*.test.js

# Integration tests
ls tests/unit/integration/*.test.js
```

### Running Tests by Module
```bash
# Run specific module tests
npm run test:unit -- ai/
npm run test:unit -- document/
npm run test:unit -- database/

# Run multiple related modules
npm run test:unit -- ai/ llm/ rag/
```

---

## Maintenance Guidelines

### Adding New Tests
1. Identify the appropriate module directory
2. Create test file following naming convention: `<feature-name>.test.js`
3. If no suitable directory exists, propose a new one
4. Update this documentation if creating new directories

### Renaming/Moving Tests
1. Update all relative import paths
2. Update CI/CD configurations
3. Update documentation (README.md, this file)
4. Run full test suite to verify

### Deleting Tests
1. Check for dependencies in other tests
2. Update coverage reports
3. Document reason in commit message

---

## Consistency with E2E Tests

This reorganization follows the same principles as the e2e test structure:

**E2E Structure:**
```
tests/e2e/
├── ai/
├── features/
├── file/
├── integration/
├── project/
└── ...
```

**Unit Structure:**
```
tests/unit/
├── ai/
├── document/
├── file/
├── integration/
├── ...
```

Both structures prioritize:
- Module-based organization
- Clear naming conventions
- Logical groupings
- Scalability

---

## Related Documentation

- [README.md](./README.md) - Full directory guide with testing conventions
- [REORGANIZATION_SUMMARY.md](./REORGANIZATION_SUMMARY.md) - Detailed reorganization summary
- [REORGANIZATION_PLAN.md](./REORGANIZATION_PLAN.md) - Original plan
- [../e2e/README.md](../e2e/README.md) - E2E test structure
- [../../package.json](../../package.json) - Test scripts configuration
