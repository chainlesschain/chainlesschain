# Unit Tests Reorganization Plan

## Current Status

- Total files: 125 test files
- Root directory files: 54 (too many, need organization)
- Existing subdirectories: 28

## Proposed Directory Structure

```
tests/unit/
├── ai/                      # AI & LLM features
│   ├── ai-engine-workflow.test.js
│   ├── ai-skill-scheduler.test.js
│   ├── builtin-skills.test.js
│   ├── builtin-tools.test.js
│   ├── intent-classifier.test.js
│   ├── skill-executor.test.js
│   ├── skill-manager.test.js
│   ├── skill-recommender.test.js
│   ├── skill-tool-ipc.test.js
│   └── conversation-executor.test.js
│
├── config/                  # Configuration management
│   ├── config-manager.test.js
│   └── initial-setup-config.test.js
│
├── document/                # Document engines
│   ├── excel-engine.test.js
│   ├── word-engine.test.js
│   ├── pdf-engine.test.js
│   ├── ppt-engine.test.js
│   ├── doc-generator.test.js
│   └── api-doc-generator.test.js
│
├── media/                   # Multimedia processing
│   ├── image-engine.test.js
│   ├── video-engine.test.js
│   ├── ocr-service.test.js
│   ├── speech-manager.test.js
│   └── speech-recognizer.test.js
│
├── security/                # Security & encryption
│   ├── pkcs11-encryption.test.js
│   └── permission-system.test.js
│
├── core/                    # Core components
│   ├── core-components.test.ts
│   ├── ipc-guard.test.js
│   ├── function-caller.test.js
│   └── response-parser.test.js
│
├── planning/                # Planning & task management
│   ├── task-planner.test.js
│   ├── task-planner-enhanced.test.js
│   ├── taskPlanner.test.js (duplicate, need to merge)
│   ├── planning-components.test.js → components/
│   └── planning-store.test.js → stores/
│
├── tools/                   # Tool management
│   ├── tool-manager.test.js
│   ├── tool-runner.test.js
│   └── template-manager.test.js
│
├── utils/                   # Utilities
│   ├── field-mapper.test.js
│   ├── graph-extractor.test.js
│   └── markdown-exporter.test.js
│
├── integration/             # Integration tests
│   ├── rag-llm-git.test.js
│   ├── p2p-sync-engine.test.js
│   └── code-executor.test.js
│
├── components/              # Vue components (existing)
│   ├── [existing files]
│   └── planning-components.test.js (move from root)
│
├── pages/                   # Page components (existing)
│   ├── [existing files]
│   ├── PlanningView.test.js (move from root)
│   └── PythonExecutionPanel.test.ts (move from root)
│
├── stores/                  # Pinia stores (existing)
│   ├── [existing files]
│   └── planning-store.test.js (move from root)
│
├── database/                # Database (existing)
│   ├── [existing files]
│   └── database.test.js (move from root)
│
├── git/                     # Git operations (existing)
│   ├── [existing files]
│   └── git-path-converter.test.js (move from root)
│
├── did/                     # DID identity (existing)
│   ├── [existing files]
│   └── did-invitation.test.js (move from root)
│
├── file/                    # File operations (existing)
│   ├── [existing files]
│   └── file-import.test.js (move from root)
│
├── sync/                    # Sync operations (existing)
│   ├── [existing files]
│   ├── sync-p0-fixes.test.js (move from root)
│   ├── sync-p1-fixes.test.js (move from root)
│   └── sync-queue.test.js (move from root)
│
├── llm/                     # LLM services (existing)
│   ├── [existing files]
│   └── llm-service.test.js (move from root)
│
└── [other existing directories...]
```

## Migration Commands

### Step 1: Create new directories

```bash
mkdir -p desktop-app-vue/tests/unit/{ai,config,document,media,security,core,planning,tools,utils,integration}
```

### Step 2: Move files to new structure

#### AI & Skills

```bash
mv desktop-app-vue/tests/unit/ai-engine-workflow.test.js desktop-app-vue/tests/unit/ai/
mv desktop-app-vue/tests/unit/ai-skill-scheduler.test.js desktop-app-vue/tests/unit/ai/
mv desktop-app-vue/tests/unit/builtin-skills.test.js desktop-app-vue/tests/unit/ai/
mv desktop-app-vue/tests/unit/builtin-tools.test.js desktop-app-vue/tests/unit/ai/
mv desktop-app-vue/tests/unit/intent-classifier.test.js desktop-app-vue/tests/unit/ai/
mv desktop-app-vue/tests/unit/skill-executor.test.js desktop-app-vue/tests/unit/ai/
mv desktop-app-vue/tests/unit/skill-manager.test.js desktop-app-vue/tests/unit/ai/
mv desktop-app-vue/tests/unit/skill-recommender.test.js desktop-app-vue/tests/unit/ai/
mv desktop-app-vue/tests/unit/skill-tool-ipc.test.js desktop-app-vue/tests/unit/ai/
mv desktop-app-vue/tests/unit/conversation-executor.test.js desktop-app-vue/tests/unit/ai/
```

#### Configuration

```bash
mv desktop-app-vue/tests/unit/config-manager.test.js desktop-app-vue/tests/unit/config/
mv desktop-app-vue/tests/unit/initial-setup-config.test.js desktop-app-vue/tests/unit/config/
```

#### Document Engines

```bash
mv desktop-app-vue/tests/unit/excel-engine.test.js desktop-app-vue/tests/unit/document/
mv desktop-app-vue/tests/unit/word-engine.test.js desktop-app-vue/tests/unit/document/
mv desktop-app-vue/tests/unit/pdf-engine.test.js desktop-app-vue/tests/unit/document/
mv desktop-app-vue/tests/unit/ppt-engine.test.js desktop-app-vue/tests/unit/document/
mv desktop-app-vue/tests/unit/doc-generator.test.js desktop-app-vue/tests/unit/document/
mv desktop-app-vue/tests/unit/api-doc-generator.test.js desktop-app-vue/tests/unit/document/
```

#### Media Processing

```bash
mv desktop-app-vue/tests/unit/image-engine.test.js desktop-app-vue/tests/unit/media/
mv desktop-app-vue/tests/unit/video-engine.test.js desktop-app-vue/tests/unit/media/
mv desktop-app-vue/tests/unit/ocr-service.test.js desktop-app-vue/tests/unit/media/
mv desktop-app-vue/tests/unit/speech-manager.test.js desktop-app-vue/tests/unit/media/
mv desktop-app-vue/tests/unit/speech-recognizer.test.js desktop-app-vue/tests/unit/media/
```

#### Security

```bash
mv desktop-app-vue/tests/unit/pkcs11-encryption.test.js desktop-app-vue/tests/unit/security/
mv desktop-app-vue/tests/unit/permission-system.test.js desktop-app-vue/tests/unit/security/
```

#### Core Components

```bash
mv desktop-app-vue/tests/unit/core-components.test.ts desktop-app-vue/tests/unit/core/
mv desktop-app-vue/tests/unit/ipc-guard.test.js desktop-app-vue/tests/unit/core/
mv desktop-app-vue/tests/unit/function-caller.test.js desktop-app-vue/tests/unit/core/
mv desktop-app-vue/tests/unit/response-parser.test.js desktop-app-vue/tests/unit/core/
```

#### Planning

```bash
mv desktop-app-vue/tests/unit/task-planner.test.js desktop-app-vue/tests/unit/planning/
mv desktop-app-vue/tests/unit/task-planner-enhanced.test.js desktop-app-vue/tests/unit/planning/
mv desktop-app-vue/tests/unit/taskPlanner.test.js desktop-app-vue/tests/unit/planning/
```

#### Tools

```bash
mv desktop-app-vue/tests/unit/tool-manager.test.js desktop-app-vue/tests/unit/tools/
mv desktop-app-vue/tests/unit/tool-runner.test.js desktop-app-vue/tests/unit/tools/
mv desktop-app-vue/tests/unit/template-manager.test.js desktop-app-vue/tests/unit/tools/
```

#### Utilities

```bash
mv desktop-app-vue/tests/unit/field-mapper.test.js desktop-app-vue/tests/unit/utils/
mv desktop-app-vue/tests/unit/graph-extractor.test.js desktop-app-vue/tests/unit/utils/
mv desktop-app-vue/tests/unit/markdown-exporter.test.js desktop-app-vue/tests/unit/utils/
```

#### Integration

```bash
mv desktop-app-vue/tests/unit/rag-llm-git.test.js desktop-app-vue/tests/unit/integration/
mv desktop-app-vue/tests/unit/p2p-sync-engine.test.js desktop-app-vue/tests/unit/integration/
mv desktop-app-vue/tests/unit/code-executor.test.js desktop-app-vue/tests/unit/integration/
```

#### Move to existing directories

```bash
# Components
mv desktop-app-vue/tests/unit/planning-components.test.js desktop-app-vue/tests/unit/components/

# Pages
mv desktop-app-vue/tests/unit/PlanningView.test.js desktop-app-vue/tests/unit/pages/
mv desktop-app-vue/tests/unit/PythonExecutionPanel.test.ts desktop-app-vue/tests/unit/pages/

# Stores
mv desktop-app-vue/tests/unit/planning-store.test.js desktop-app-vue/tests/unit/stores/

# Database
mv desktop-app-vue/tests/unit/database.test.js desktop-app-vue/tests/unit/database/

# Git
mv desktop-app-vue/tests/unit/git-path-converter.test.js desktop-app-vue/tests/unit/git/

# DID
mv desktop-app-vue/tests/unit/did-invitation.test.js desktop-app-vue/tests/unit/did/

# File
mv desktop-app-vue/tests/unit/file-import.test.js desktop-app-vue/tests/unit/file/

# Sync
mv desktop-app-vue/tests/unit/sync-p0-fixes.test.js desktop-app-vue/tests/unit/sync/
mv desktop-app-vue/tests/unit/sync-p1-fixes.test.js desktop-app-vue/tests/unit/sync/
mv desktop-app-vue/tests/unit/sync-queue.test.js desktop-app-vue/tests/unit/sync/

# LLM
mv desktop-app-vue/tests/unit/llm-service.test.js desktop-app-vue/tests/unit/llm/

# Soft delete (database related)
mv desktop-app-vue/tests/unit/soft-delete.test.js desktop-app-vue/tests/unit/database/
```

## Cleanup Tasks

1. **Merge duplicate task planner tests**:
   - Review `task-planner.test.js`, `task-planner-enhanced.test.js`, and `taskPlanner.test.js`
   - Merge into a single comprehensive test file
   - Delete duplicates

2. **Create README files**:
   - Add `README.md` to each new directory explaining its purpose
   - Document test conventions and patterns

3. **Update test imports**:
   - Some test files may have relative imports that need updating
   - Run tests after migration to catch any broken imports

## Benefits

1. **Better organization**: Related tests grouped together
2. **Easier navigation**: Clear directory structure
3. **Consistent with e2e**: Follows the same organizational pattern
4. **Scalability**: Easy to add new tests to appropriate directories
5. **Maintainability**: Easier to find and update related tests

## Estimated Impact

- Files to move: 54
- New directories: 9
- Existing directories to update: 10
- Total time: ~15-20 minutes (automated with script)
