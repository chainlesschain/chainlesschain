# Absolute Import Migration Plan

**Date:** 2026-01-25
**Status:** 📋 Planning
**Priority:** P3 (Optional Enhancement)

---

## Overview

Migrate test files from relative imports to absolute imports using existing path aliases configured in `vitest.config.ts`.

### Current State (Relative Imports)

```javascript
// tools/tool-runner.test.js
const ToolRunner = require("../../../src/main/skill-tool-system/tool-runner");

// utils/graph-extractor.test.js
import GraphExtractor from "../../../src/main/knowledge-graph/graph-extractor.js";
```

### Target State (Absolute Imports)

```javascript
// tools/tool-runner.test.js
const ToolRunner = require("@main/skill-tool-system/tool-runner");

// utils/graph-extractor.test.js
import GraphExtractor from "@main/knowledge-graph/graph-extractor.js";
```

---

## Benefits

### ✅ Advantages

1. **Simpler Paths**
   - No need to count `../` levels
   - Consistent regardless of file location

2. **Easier Refactoring**
   - Moving test files doesn't break imports
   - IDE refactoring tools work better

3. **Better Readability**
   - Clear where modules come from (`@main`, `@renderer`, etc.)
   - Self-documenting code

4. **No Future Path Issues**
   - Deep nesting doesn't require more `../`
   - Prevents MODULE_NOT_FOUND errors

### ⚠️ Disadvantages

1. **Breaking Convention**
   - Some teams prefer relative imports for tests
   - Lose visibility of module proximity

2. **Migration Effort**
   - ~125 test files need updating
   - Need to verify all imports work

3. **Mixed Style (Temporary)**
   - During migration, will have both styles
   - Consistency issue until complete

---

## Existing Path Aliases

From `vitest.config.ts`:

```typescript
resolve: {
  alias: {
    '@': resolve(__dirname, 'src'),
    '@renderer': resolve(__dirname, 'src/renderer'),
    '@main': resolve(__dirname, 'src/main'),
    '@shared': resolve(__dirname, 'src/shared'),
    '@preload': resolve(__dirname, 'src/preload'),
    'electron': resolve(__dirname, 'tests/__mocks__/electron.ts')
  }
}
```

### Usage Patterns

| Alias | Maps To | Use Case |
|-------|---------|----------|
| `@` | `src/` | Generic source root |
| `@main` | `src/main/` | Main process modules |
| `@renderer` | `src/renderer/` | Renderer process modules |
| `@shared` | `src/shared/` | Shared utilities |
| `@preload` | `src/preload/` | Preload scripts |

---

## Migration Strategy

### Phase 1: Assessment (1-2 hours)

1. **Scan All Imports**
   ```bash
   # Find all relative imports in test files
   grep -r "require.*\.\./\.\./src" tests/unit --include="*.js"
   grep -r "from.*\.\./\.\./src" tests/unit --include="*.js" --include="*.ts"
   grep -r "from.*\.\./\.\./\.\./src" tests/unit --include="*.js" --include="*.ts"
   ```

2. **Count Affected Files**
   - Estimate: ~60-80 files
   - Priority: New subdirectories first (10 directories, ~40 files)

3. **Create Migration Script**
   ```javascript
   // scripts/migrate-to-absolute-imports.js
   // Automated find-and-replace with validation
   ```

### Phase 2: Pilot Migration (30 minutes)

**Target:** One directory for testing

```bash
# Pilot: tools/ directory (3 files)
tests/unit/tools/
├── tool-runner.test.js
├── tool-manager.test.js
└── template-manager.test.js
```

**Steps:**
1. Update imports in pilot files
2. Run tests: `npm run test:unit -- tools/`
3. Verify all pass
4. Document any issues

### Phase 3: Bulk Migration (2-3 hours)

**Order of migration:**

1. **New directories** (10 dirs, ~40 files)
   - ai/, config/, document/, media/, security/
   - core/, planning/, tools/, utils/, integration/

2. **High-usage directories** (~30 files)
   - database/, llm/, rag/, mcp/

3. **Lower-priority directories** (~30 files)
   - blockchain/, p2p/, sync/, did/, git/

4. **Remaining files** (~25 files)
   - components/, pages/, stores/, etc.

### Phase 4: Verification (1 hour)

1. **Run Full Test Suite**
   ```bash
   npm run test:unit
   ```

2. **Check CI/CD**
   - Verify all workflows pass
   - No import resolution errors

3. **Update Documentation**
   - Update README.md with import style guide
   - Add examples to contribution guidelines

---

## Migration Examples

### Example 1: CommonJS require()

**Before:**
```javascript
// tests/unit/tools/tool-runner.test.js
const ToolRunner = require("../../../src/main/skill-tool-system/tool-runner");
const ToolManager = require("../../../src/main/skill-tool-system/tool-manager");
```

**After:**
```javascript
// tests/unit/tools/tool-runner.test.js
const ToolRunner = require("@main/skill-tool-system/tool-runner");
const ToolManager = require("@main/skill-tool-system/tool-manager");
```

### Example 2: ES6 import

**Before:**
```javascript
// tests/unit/utils/graph-extractor.test.js
import GraphExtractor from "../../../src/main/knowledge-graph/graph-extractor.js";
```

**After:**
```javascript
// tests/unit/utils/graph-extractor.test.js
import GraphExtractor from "@main/knowledge-graph/graph-extractor.js";
```

### Example 3: vi.mock()

**Before:**
```javascript
// tests/unit/tools/tool-manager.test.js
vi.mock('../../../src/main/skill-tool-system/doc-generator', () => ({
  default: vi.fn(() => mockDocGenerator),
}));
```

**After:**
```javascript
// tests/unit/tools/tool-manager.test.js
vi.mock('@main/skill-tool-system/doc-generator', () => ({
  default: vi.fn(() => mockDocGenerator),
}));
```

### Example 4: Renderer Process

**Before:**
```javascript
// tests/unit/planning/taskPlanner.test.js
import { TaskPlanner, PlanningSession, PlanningState } from '../../../src/renderer/utils/taskPlanner';
```

**After:**
```javascript
// tests/unit/planning/taskPlanner.test.js
import { TaskPlanner, PlanningSession, PlanningState } from '@renderer/utils/taskPlanner';
```

---

## Automated Migration Script

```javascript
// scripts/migrate-to-absolute-imports.js
const fs = require('fs');
const path = require('path');
const glob = require('glob');

const replacements = [
  // Main process (4 levels deep)
  { from: /..\/..\/..\/..\/src\/main\//g, to: '@main/' },
  // Main process (3 levels deep)
  { from: /..\/..\/..\/src\/main\//g, to: '@main/' },
  // Main process (2 levels deep)
  { from: /..\/..\/src\/main\//g, to: '@main/' },

  // Renderer process
  { from: /..\/..\/..\/..\/src\/renderer\//g, to: '@renderer/' },
  { from: /..\/..\/..\/src\/renderer\//g, to: '@renderer/' },
  { from: /..\/..\/src\/renderer\//g, to: '@renderer/' },

  // Shared
  { from: /..\/..\/..\/..\/src\/shared\//g, to: '@shared/' },
  { from: /..\/..\/..\/src\/shared\//g, to: '@shared/' },
  { from: /..\/..\/src\/shared\//g, to: '@shared/' },
];

function migrateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  replacements.forEach(({ from, to }) => {
    if (content.match(from)) {
      content = content.replace(from, to);
      modified = true;
    }
  });

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Migrated: ${filePath}`);
    return true;
  }

  return false;
}

function migrateDirectory(directory) {
  const files = glob.sync(`${directory}/**/*.{js,ts}`, {
    ignore: ['**/node_modules/**', '**/dist/**']
  });

  let migratedCount = 0;

  files.forEach(file => {
    if (migrateFile(file)) {
      migratedCount++;
    }
  });

  console.log(`\n📊 Migrated ${migratedCount}/${files.length} files in ${directory}`);
}

// Main execution
if (require.main === module) {
  const targetDir = process.argv[2] || 'tests/unit';
  console.log(`🚀 Starting migration for: ${targetDir}\n`);
  migrateDirectory(targetDir);
}

module.exports = { migrateFile, migrateDirectory };
```

**Usage:**
```bash
# Dry run (no changes)
node scripts/migrate-to-absolute-imports.js tests/unit/tools

# Migrate specific directory
node scripts/migrate-to-absolute-imports.js tests/unit/ai

# Migrate all tests
node scripts/migrate-to-absolute-imports.js tests/unit
```

---

## Rollback Plan

If migration causes issues:

```bash
# 1. Revert changes
git checkout HEAD -- tests/unit

# 2. Or revert specific directory
git checkout HEAD -- tests/unit/tools

# 3. Fix issues and try again
```

---

## Testing Strategy

### Pre-migration

```bash
# Baseline test run
npm run test:unit > pre-migration-results.txt
```

### Post-migration (Per Directory)

```bash
# Test migrated directory
npm run test:unit -- tools/

# Compare results
npm run test:unit > post-migration-results.txt
diff pre-migration-results.txt post-migration-results.txt
```

### Final Verification

```bash
# Full test suite
npm run test:unit

# CI/CD validation
git commit -m "refactor(tests): migrate to absolute imports"
git push
# Watch CI results
```

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Import resolution fails | High | Pilot test first, verify vitest.config.ts |
| Mixed import styles | Low | Complete migration in phases |
| Breaking CI/CD | High | Test locally first, monitor CI |
| Team confusion | Low | Document in README, add examples |

---

## Timeline & Effort

| Phase | Duration | Effort Level |
|-------|----------|--------------|
| Assessment | 1-2 hours | Low |
| Pilot Migration | 30 mins | Low |
| Bulk Migration | 2-3 hours | Medium |
| Verification | 1 hour | Low |
| **Total** | **4-6 hours** | **Low-Medium** |

---

## Decision

### Recommendation: ⏸️ DEFER

**Reasoning:**
1. **Current solution works** - Relative paths are functional
2. **Low priority** - P3 enhancement, not critical
3. **Time investment** - 4-6 hours for aesthetic improvement
4. **Risk** - Potential breaking changes during migration

### When to Reconsider:

- ✅ If moving files frequently causes path issues
- ✅ If team standardizes on absolute imports
- ✅ If IDE refactoring becomes problematic
- ✅ During major refactoring (v2.0, etc.)

### Alternative: Gradual Migration

Instead of bulk migration:
- Use absolute imports for **new** test files only
- Keep existing files as-is (relative imports)
- Migrate opportunistically when editing files
- No dedicated migration effort required

---

## Documentation Updates (If Implemented)

### README.md

Add import style guide:

```markdown
## Test Import Style

Use absolute imports with path aliases:

```javascript
// ✅ Good - Absolute imports
import Module from '@main/module';
import Component from '@renderer/components/Component';

// ❌ Avoid - Relative imports
import Module from '../../../src/main/module';
```

### Contribution Guidelines

```markdown
When writing tests:
- Use `@main/` for main process modules
- Use `@renderer/` for renderer modules
- Use `@shared/` for shared utilities
```

---

## Conclusion

Absolute import migration is **feasible but optional**. The current relative import structure works well after the reorganization. Migration should be considered a **P3 enhancement** to be done:

1. When time permits
2. As part of larger refactoring
3. If relative imports cause frequent issues

**Status:** 📋 **Planning Complete** - Implementation deferred to future sprint

---

## Related Documents

- [vitest.config.ts](../../vitest.config.ts) - Path alias configuration
- [README.md](./README.md) - Test directory guide
- [REORGANIZATION_SUMMARY.md](./REORGANIZATION_SUMMARY.md) - Recent reorganization

---

**Report Generated:** 2026-01-25
**Next Review:** When path issues arise or during v2.0 planning
