# E2E Test Directory Structure

This directory contains end-to-end tests for the ChainlessChain desktop application.

## Directory Organization

```
e2e/
├── docs/              # Test documentation and guides
│   ├── STREAM_CONTROL_TEST_REPORT.md
│   ├── TEST_SUMMARY.md
│   └── TIMEOUT_OPTIMIZATION_GUIDE.md
│
├── helpers/           # Shared test utilities
│   ├── common.ts                  # General test helpers
│   └── project-detail.ts          # Project detail test helpers
│
├── project/           # Project management tests
│   ├── project-creation.e2e.test.ts
│   ├── project-settings.e2e.test.ts
│   ├── project-task-planning.e2e.test.ts
│   ├── project-workflow.test.ts
│   └── detail/        # Project detail page tests
│       ├── project-detail-basic.e2e.test.ts
│       ├── project-detail-core.e2e.test.ts
│       ├── project-detail-comprehensive.e2e.test.ts
│       ├── project-detail-ai-creating.e2e.test.ts
│       ├── project-detail-conversation-sidebar.e2e.test.ts
│       ├── project-detail-editors.e2e.test.ts
│       ├── project-detail-export.e2e.test.ts
│       ├── project-detail-file-manage.e2e.test.ts
│       └── project-detail-layout-git.e2e.test.ts
│
├── ai/                # AI/LLM functionality tests
│   ├── ai-assistant.e2e.test.ts
│   ├── ai-chat.e2e.test.ts
│   ├── code-execution.e2e.test.ts
│   ├── intent-to-completion.e2e.test.ts
│   ├── intent-to-completion-extended.e2e.test.ts
│   ├── interactive-planning.e2e.test.ts
│   └── stream-control.e2e.test.ts
│
├── file/              # File operations and editors
│   ├── file-operations.e2e.test.ts
│   ├── excel-editor.e2e.test.ts
│   ├── word-editor.e2e.test.ts
│   ├── word-preview.e2e.test.ts
│   └── debug/         # Debug-specific file tests
│       ├── file-creation-debug.e2e.test.ts
│       ├── file-tree-console-log.e2e.test.ts
│       ├── file-tree-function-trace.e2e.test.ts
│       ├── file-tree-refresh-debug.e2e.test.ts
│       └── message-display-fix.e2e.test.ts
│
├── integration/       # Integration tests
│   ├── did-invitation.spec.js
│   ├── signal-protocol-e2e.test.js
│   ├── rss-email-integration.spec.js
│   └── global-settings-wizard.spec.js
│
└── features/          # Specific feature tests
    ├── skill-management.e2e.test.ts
    └── volcengine-text.e2e.test.ts
```

## Running Tests

```bash
# Run all e2e tests
npm run test:e2e

# Run specific category
npm run test:e2e -- project/
npm run test:e2e -- ai/
npm run test:e2e -- file/

# Run specific test file
npm run test:e2e -- project/project-creation.e2e.test.ts
```

## Import Path Updates

After reorganization, update imports as follows:

```typescript
// Before
import { setupTest } from "./helpers";
import { navigateToProject } from "./project-detail-helpers";

// After
import { setupTest } from "./helpers/common";
import { navigateToProject } from "./helpers/project-detail";
```

## Test Categories

- **docs/**: Test reports, summaries, and optimization guides
- **helpers/**: Reusable test utilities and setup functions
- **project/**: Project creation, settings, workflow, and detail page tests
- **ai/**: AI assistant, chat, code execution, and streaming tests
- **file/**: File operations, editors (Word, Excel), and debug tests
- **integration/**: DID, Signal protocol, RSS, and settings wizard tests
- **features/**: Skill management and provider-specific tests

## Notes

- Debug tests are isolated in `file/debug/` for easier maintenance
- Project detail tests are grouped under `project/detail/`
- Helper files are centralized in `helpers/` directory
