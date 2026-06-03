# Import Path Validation Guide

**Created:** 2026-01-25
**Tool:** `scripts/validate-import-paths.js`
**Purpose:** Prevent MODULE_NOT_FOUND errors from incorrect relative paths

---

## Overview

After reorganizing tests into subdirectories, we need to ensure import paths use the correct number of `../` levels. This tool automatically validates and fixes incorrect paths.

---

## The Tool

### Location

```
desktop-app-vue/scripts/validate-import-paths.js
```

### Features

1. ✅ **Validates all test files** - Checks every `.js` and `.ts` file in `tests/unit/`
2. ✅ **Smart detection** - Calculates required `../` levels based on file location
3. ✅ **Multi-pattern support** - Handles `require()`, `import`, and `vi.mock()`
4. ✅ **Auto-fix capability** - Can automatically correct paths
5. ✅ **Clear reporting** - Shows exactly what's wrong and how to fix it

---

## Usage

### Check for Issues

```bash
cd desktop-app-vue
node scripts/validate-import-paths.js
```

**Output (when issues found):**
```
🔍 Validating test import paths...

📁 Found 125 test files

❌ Found 3 incorrect import paths in 2 files:

📄 tests/unit/tools/tool-runner.test.js
   Required levels: 3 (../../ ../../ ../../)
   1. require: ../../src/main/skill-tool-system/tool-runner
      Actual: 2 levels
      Expected: 3 levels
      Fix: ../../../src/main/skill-tool-system/tool-runner

💡 Run with --fix flag to auto-fix these issues:
   node scripts/validate-import-paths.js --fix
```

### Auto-Fix Issues

```bash
node scripts/validate-import-paths.js --fix
```

**Output:**
```
✅ Fixed 2 files automatically
```

### Generate Report

```bash
node scripts/validate-import-paths.js --report
```

**Output:**
```
📊 Statistics:
   Total test files: 125
   Files with relative imports: 80
   Files with incorrect paths: 0

📁 Files by directory depth:
   Depth 0 (../../): 45 files
   Depth 1 (../../../): 35 files
   Depth 2 (../../../../): 0 files
```

---

## How It Works

### Path Level Calculation

The tool calculates the required `../` levels based on file location:

```
tests/unit/file.test.js           → Need ../../    (2 levels)
tests/unit/tools/file.test.js     → Need ../../../ (3 levels)
tests/unit/ai/sub/file.test.js    → Need ../../../../ (4 levels)
```

**Formula:** `depth + 2` where `depth` = number of subdirectories under `tests/unit/`

### Pattern Detection

Detects three types of imports:

1. **CommonJS require**
   ```javascript
   const Module = require('../../src/main/module');
   ```

2. **ES6 import**
   ```javascript
   import Module from '../../../src/main/module.js';
   ```

3. **Vitest mock**
   ```javascript
   vi.mock('../../src/main/module', () => ({ ... }));
   ```

### Validation Rules

Only validates paths that:
- ✅ Start with `../` (relative paths)
- ✅ Include `/src/` (pointing to source code)

Skips:
- ❌ Absolute paths (`@main/...`)
- ❌ Node modules (`'vitest'`, `'fs'`)
- ❌ Test utilities (`'./helpers'`)

---

## Integration with Pre-commit Hook

### Option 1: Manual Check (Recommended)

Add to `.husky/pre-commit`:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Validate import paths
echo "🔍 Checking import paths..."
cd desktop-app-vue
node scripts/validate-import-paths.js

# Only commit if validation passes
if [ $? -ne 0 ]; then
  echo "❌ Import path validation failed!"
  echo "💡 Run: node scripts/validate-import-paths.js --fix"
  exit 1
fi
```

### Option 2: Auto-Fix on Commit

Add to `.husky/pre-commit`:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Auto-fix import paths before commit
echo "🔧 Auto-fixing import paths..."
cd desktop-app-vue
node scripts/validate-import-paths.js --fix

# Stage fixed files
git add tests/unit/
```

### Option 3: Warn Only

Add to `.husky/pre-commit`:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Warn about import path issues (non-blocking)
echo "🔍 Checking import paths..."
cd desktop-app-vue
node scripts/validate-import-paths.js || echo "⚠️ Warning: Import path issues detected"

# Continue with commit anyway
exit 0
```

---

## CI/CD Integration

### Add to GitHub Actions

Update `.github/workflows/test.yml`:

```yaml
jobs:
  unit-tests:
    steps:
      # ... existing steps ...

      - name: Validate import paths
        working-directory: ./desktop-app-vue
        run: node scripts/validate-import-paths.js

      - name: Run unit tests
        working-directory: ./desktop-app-vue
        run: npm run test:unit
```

---

## Examples

### Example 1: File in Subdirectory

**File:** `tests/unit/tools/tool-runner.test.js`

**Correct:**
```javascript
const ToolRunner = require('../../../src/main/skill-tool-system/tool-runner');
//                           ^^^^^^^^^ 3 levels (correct)
```

**Incorrect:**
```javascript
const ToolRunner = require('../../src/main/skill-tool-system/tool-runner');
//                           ^^^^^^^ 2 levels (wrong!)
```

### Example 2: File in Nested Subdirectory

**File:** `tests/unit/ai/engine/workflow.test.js`

**Correct:**
```javascript
import Workflow from '../../../../src/main/ai-engine/workflow.js';
//                   ^^^^^^^^^^^^ 4 levels (correct)
```

### Example 3: Mock Path

**File:** `tests/unit/tools/tool-manager.test.js`

**Correct:**
```javascript
vi.mock('../../../src/main/skill-tool-system/doc-generator', () => ({
//      ^^^^^^^^^ 3 levels (correct)
  default: vi.fn()
}));
```

---

## Troubleshooting

### Issue: "Command not found: node"

**Solution:**
```bash
# Use npm to run the script
npm run validate:paths

# Or add to package.json scripts:
{
  "scripts": {
    "validate:paths": "node scripts/validate-import-paths.js",
    "validate:paths:fix": "node scripts/validate-import-paths.js --fix"
  }
}
```

### Issue: "Cannot find module 'glob'"

**Solution:**
```bash
cd desktop-app-vue
npm install --save-dev glob
```

### Issue: False positives

**Solution:**

Edit the script to skip specific patterns:

```javascript
// Add to extractImports() function
if (importPath.includes('/helpers/') || importPath.includes('/__mocks__/')) {
  return { valid: true, reason: 'skip_pattern' };
}
```

---

## Best Practices

### When Writing New Tests

1. **Use the tool first**
   ```bash
   # After creating new test
   node scripts/validate-import-paths.js --fix
   ```

2. **Follow the pattern**
   - Count directory levels from `tests/unit/`
   - Add 2 to get required `../` count
   - Use that many `../` to reach `src/`

3. **Consider absolute imports**
   - For new code, use `@main/` instead of `../../../`
   - See [ABSOLUTE_IMPORT_MIGRATION_PLAN.md](./ABSOLUTE_IMPORT_MIGRATION_PLAN.md)

### When Moving Test Files

1. **Validate after moving**
   ```bash
   # Move file
   git mv tests/unit/file.test.js tests/unit/subdir/file.test.js

   # Validate and fix
   node scripts/validate-import-paths.js --fix

   # Verify
   npm run test:unit -- subdir/file.test.js
   ```

2. **Batch operations**
   ```bash
   # Move multiple files
   git mv tests/unit/*.test.js tests/unit/newdir/

   # Fix all at once
   node scripts/validate-import-paths.js --fix
   ```

---

## Package.json Scripts

Add to `desktop-app-vue/package.json`:

```json
{
  "scripts": {
    "validate:paths": "node scripts/validate-import-paths.js",
    "validate:paths:fix": "node scripts/validate-import-paths.js --fix",
    "validate:paths:report": "node scripts/validate-import-paths.js --report",
    "pretest:unit": "npm run validate:paths"
  }
}
```

**Usage:**
```bash
npm run validate:paths         # Check
npm run validate:paths:fix     # Auto-fix
npm run validate:paths:report  # Stats
npm run test:unit              # Auto-validates first
```

---

## Future Enhancements

### Planned Features

1. **Watch mode**
   ```bash
   node scripts/validate-import-paths.js --watch
   # Auto-validates on file changes
   ```

2. **IDE integration**
   - ESLint rule for import path validation
   - VSCode extension

3. **Smart suggestions**
   - Suggest using absolute imports
   - Detect common patterns

4. **Performance**
   - Cache validation results
   - Parallel file processing

---

## Related Tools

### ESLint Rule (Future)

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    'import/no-relative-parent-imports': ['error', {
      maxDepth: 3,
      suggestAbsolute: true
    }]
  }
};
```

### VSCode Extension (Future)

```json
// .vscode/settings.json
{
  "import-path-validator.enabled": true,
  "import-path-validator.autoFix": true
}
```

---

## Maintenance

### Regular Checks

Run monthly or before major releases:

```bash
# Full validation
npm run validate:paths

# Generate report
npm run validate:paths:report

# Fix any issues
npm run validate:paths:fix
```

### After Reorganization

Always run after moving files:

```bash
# Move files
git mv ...

# Validate
npm run validate:paths:fix

# Test
npm run test:unit

# Commit
git add -A
git commit -m "refactor: reorganize tests"
```

---

## Summary

The import path validator is a **proactive tool** to prevent MODULE_NOT_FOUND errors:

✅ **Automated** - No manual path counting
✅ **Fast** - Validates 125+ files in seconds
✅ **Reliable** - Catches errors before CI/CD
✅ **Easy** - One command to fix all issues

**Recommended Usage:**
1. Run before commits (pre-commit hook)
2. Run in CI/CD (fail fast)
3. Run monthly (maintenance)
4. Run after file moves (immediate validation)

---

## Related Documents

- [PATH_FIX_SUMMARY.md](./PATH_FIX_SUMMARY.md) - Why we need this tool
- [REORGANIZATION_SUMMARY.md](./REORGANIZATION_SUMMARY.md) - Context
- [ABSOLUTE_IMPORT_MIGRATION_PLAN.md](./ABSOLUTE_IMPORT_MIGRATION_PLAN.md) - Alternative approach

---

**Tool Version:** 1.0.0
**Last Updated:** 2026-01-25
**Maintainer:** Development Team
