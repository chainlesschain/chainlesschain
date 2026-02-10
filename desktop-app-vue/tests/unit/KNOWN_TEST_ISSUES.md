# Known Test Issues

**Date:** 2026-02-10
**Status:** ✅ All Resolved
**Priority:** None (All issues fixed)

---

## Overview

This document tracks pre-existing test issues that were identified during the unit test reorganization project. All previously documented issues have been **resolved**.

**Important:** The test reorganization project (file moves, path fixes, validation tool) is **100% complete and successful**. All test files are now passing.

---

## Test Files - All Resolved

### 1. database-adapter.test.js ✅ RESOLVED

**Location:** `tests/unit/database/database-adapter.test.js`

**Status:** ✅ All 68 tests passing (601ms)

**Resolution Date:** 2026-02-10

**Previous Issues (Now Fixed):**

- Tests were skipped due to CommonJS `require()` vs ES6 `vi.mock()` incompatibility
- 7 tests were marked with `.skip`

**How It Was Fixed:**

- Runtime mock strategy: Mock `require('fs')` return object directly in tests
- Dependency injection in source code: `this._createEncryptedDatabase = options.createEncryptedDatabase || createEncryptedDatabase`
- Direct fs module patching within test cases for specific scenarios

**Current State:**

```bash
# Run verification:
npx vitest run tests/unit/database/database-adapter.test.js
# Result: 68 passed (601ms)
```

**Impact:** None - DatabaseAdapter tests are now fully functional

---

### 2. tool-masking.test.js ✅ RESOLVED

**Location:** `tests/unit/ai-engine/tool-masking.test.js`

**Status:** ✅ All 54 tests passing (682ms)

**Resolution Date:** 2026-02-09

**Previous Issues (Now Fixed):**

- Test execution used to timeout (exceeds 60 seconds)
- Logger mock callback issues

**How It Was Fixed:**

- Logger mock improvements in earlier sessions
- Test isolation improvements
- The tests now run consistently and quickly

**Current State:**

```bash
# Run verification:
npx vitest run tests/unit/ai-engine/tool-masking.test.js
# Result: 54 passed (682ms)
```

**Impact:** None - ToolMaskingSystem tests are now fully functional

---

## Test Statistics

### Overall Test Suite Status

**Before Reorganization:**

- Total test files: ~125
- Passing: ~3,435+ tests
- Known issues: 2 files (database-adapter, tool-masking)

**After Reorganization:**

- Total test files: 130
- Passing: ~3,435+ tests (same as before)
- Known issues: 2 files (same as before)
- **New failures:** 0 ✅

**Current Status (2026-02-10):**

- Total test files: 244+
- Passing: 8,850+ tests
- Known issues: 0 files ✅
- **database-adapter.test.js:** ✅ RESOLVED (68 tests passing)
- **tool-masking.test.js:** ✅ RESOLVED (54 tests passing)

**Conclusion:** All previously documented test issues have been resolved. Both database-adapter and tool-masking tests are now fully passing.

---

## Recommendations

### All Issues Resolved ✅

No action items remaining. Both previously problematic test files are now passing:

1. **database-adapter.test.js** ✅ - 68 tests passing
2. **tool-masking.test.js** ✅ - 54 tests passing

### Best Practices Learned

1. **Runtime Mock Strategy for CommonJS**
   - When source code uses `require()`, mock the module at runtime within tests
   - Use dependency injection patterns in source code for testability

2. **Test Isolation**
   - Clear mocks between tests with `vi.clearAllMocks()`
   - Reset mock implementations in `beforeEach` hooks

3. **Mixed Module Systems**
   - ES6 `vi.mock()` works for ES modules
   - For CommonJS, patch modules at runtime or use dependency injection

---

## Investigation Steps

### For database-adapter.test.js

1. Check if source code can be refactored to ES6:

   ```bash
   cat src/main/database/database-adapter.js | head -20
   ```

2. Try alternative mocking library:

   ```bash
   npm install --save-dev proxyquire
   ```

3. Run only non-skipped tests:
   ```bash
   npm run test:unit -- database-adapter.test.js --reporter=verbose
   ```

### For tool-masking.test.js

1. Run with verbose logging:

   ```bash
   npm run test:unit -- ai-engine/tool-masking.test.js --reporter=verbose
   ```

2. Add test timeout:

   ```javascript
   describe("ToolMaskingSystem", () => {
     // Add this
     vi.setConfig({ testTimeout: 10000 });
   });
   ```

3. Isolate problematic tests:
   ```bash
   # Test only one describe block at a time
   npm run test:unit -- ai-engine/tool-masking.test.js -t "构造函数"
   ```

---

## Historical Context

### When These Issues Started

**database-adapter.test.js:**

- Existed since the test was created
- Multiple `.skip` markers indicate long-standing issues
- TODOs reference fundamental mocking problems

**tool-masking.test.js:**

- Logger tests removed previously (see commit history)
- Timeout issue may be recent or intermittent
- Requires investigation

### Previous Attempts

**database-adapter.test.js:**

- Multiple mock strategies attempted (see file lines 58-132)
- Both relative and absolute imports tried
- Multiple paths mocked for same modules

**tool-masking.test.js:**

- Logger mock simplified (removed some tests)
- Event emission tests may be problematic

---

## Non-Issues (False Positives)

These are **NOT** issues:

1. ✅ **Import paths** - All 130 test files have correct import paths (verified with validation tool)
2. ✅ **CI/CD configuration** - All workflow files updated correctly
3. ✅ **File organization** - All files in correct directories
4. ✅ **Test discovery** - Vitest finds all test files correctly

---

## Testing the Known Issues

### Reproduce database-adapter Issues

```bash
cd desktop-app-vue
npm run test:unit -- database/database-adapter.test.js --reporter=verbose
```

Expected: Some tests pass, 7 tests skipped

### Reproduce tool-masking Issues

```bash
cd desktop-app-vue
timeout 60 npm run test:unit -- ai-engine/tool-masking.test.js
```

Expected: Timeout after 60 seconds

---

## Related Work

This investigation is part of the unit test reorganization project:

1. ✅ Task 1: File reorganization (54 files)
2. ✅ Task 2: CI/CD updates (2 workflows)
3. ✅ Task 3: Path fixes (16 files, 27 imports)
4. ✅ Task 4: Validation tool (100% pass rate)
5. ⏸️ **Task 5 (Optional): Fix pre-existing test failures** - Documented here

---

## Resolution Status

| File                     | Status      | Tests | Resolution Date |
| ------------------------ | ----------- | ----- | --------------- |
| database-adapter.test.js | ✅ Resolved | 68    | 2026-02-10      |
| tool-masking.test.js     | ✅ Resolved | 54    | 2026-02-09      |

---

## Success Criteria for Resolution

### database-adapter.test.js ✅ COMPLETED

- [x] All 68 tests passing (no skipped tests)
- [x] All tests pass consistently
- [x] No more mock-related TODOs
- [x] Test execution time < 30 seconds (601ms achieved)

### tool-masking.test.js ✅ COMPLETED

- [x] No timeout issues
- [x] All tests pass consistently (54 tests)
- [x] Logger mock works reliably
- [x] Test execution time < 10 seconds (682ms achieved)

---

## Reference Files

For future reference, the resolved test files are:

- `tests/unit/database/database-adapter.test.js` (68 tests)
- `tests/unit/ai-engine/tool-masking.test.js` (54 tests)
- `src/main/database/database-adapter.js`
- `src/main/ai-engine/tool-masking.js`

---

## Appendix: Test Execution Logs

### Last Run: 2026-02-10

**Command:**

```bash
npx vitest run tests/unit/database/database-adapter.test.js
```

**Result:** ✅ 68 passed (601ms)

**Command:**

```bash
npx vitest run tests/unit/ai-engine/tool-masking.test.js
```

**Result:** ✅ 54 passed (682ms)

---

**Document Created:** 2026-01-25
**Last Updated:** 2026-02-10
**Status:** ✅ All Resolved
**Owner:** Development Team

**Note:** All previously documented test issues have been resolved. Both database-adapter.test.js (68 tests) and tool-masking.test.js (54 tests) are now fully passing.
