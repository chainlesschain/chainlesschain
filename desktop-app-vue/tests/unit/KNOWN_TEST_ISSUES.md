# Known Test Issues

**Date:** 2026-02-09
**Status:** 📋 Partially Resolved
**Priority:** P2 (Non-blocking)

---

## Overview

This document tracks pre-existing test issues that were identified during the unit test reorganization project but are **not caused by the reorganization**. These tests had issues before the file moves and continue to have the same issues after.

**Important:** The test reorganization project (file moves, path fixes, validation tool) is **100% complete and successful**. The issues listed here are separate, pre-existing problems that should be addressed independently.

---

## Test Files with Issues

### 1. database-adapter.test.js

**Location:** `tests/unit/database/database-adapter.test.js`

**Status:** Many tests passing, some skipped

**Known Issues:**

- Some tests timeout during execution
- Multiple tests marked with `.skip` due to mocking issues
- Mock strategy issues with CommonJS `require()` vs ES6 imports

**Skipped Tests:**

```javascript
it.skip("应该在原数据库不存在时返回false", () => {
  // TODO: fs.existsSync mock doesn't work with CommonJS require()
});

it.skip("应该在加密数据库已存在时返回false", () => {
  // TODO: fs.existsSync mock doesn't work with CommonJS require()
});

it.skip("应该创建SQLCipher数据库实例", async () => {
  // TODO: SQLCipher wrapper mock not intercepting CommonJS require()
});

it.skip("应该加载现有的sql.js数据库", async () => {
  // TODO: fs.readFileSync mock doesn't work with CommonJS require()
});

it.skip("应该保存sql.js数据库到文件", () => {
  // TODO: fs mock doesn't work with CommonJS require()
});

it.skip("应该在目录不存在时创建目录", () => {
  // TODO: fs mock doesn't work with CommonJS require()
});

it.skip("应该成功修改数据库密码", async () => {
  // TODO: createEncryptedDatabase mock not working
});
```

**Root Cause:**

- ES6 module mocking (`vi.mock`) doesn't intercept CommonJS `require()` calls in source code
- Source code at `src/main/database/database-adapter.js` uses CommonJS `require()`
- Test file uses ES6 `import` and `vi.mock()`

**Possible Solutions:**

1. Refactor source code to use ES6 modules
2. Use alternative mocking strategy (proxyquire, mock-require)
3. Test with actual dependencies in integration tests
4. Improve Vitest configuration for mixed module systems

**Impact:** Low - Core functionality works, tests are defensive

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

**Current Status (2026-02-09):**

- Total test files: 244
- Passing: 8,788+ tests
- Known issues: 1 file (database-adapter only)
- **tool-masking.test.js:** ✅ RESOLVED (54 tests passing)

**Conclusion:** Reorganization did not introduce any new test failures. tool-masking tests are now fixed.

---

## Recommendations

### Short-term (P2)

1. **database-adapter.test.js**
   - Priority: P2
   - Effort: Medium (2-4 hours)
   - Action: Refactor source code to ES6 modules or improve mock strategy

2. **tool-masking.test.js**
   - Priority: P2
   - Effort: Low (1-2 hours)
   - Action: Debug and fix timeout issue

### Long-term (P3)

1. **Module System Consistency**
   - Standardize on ES6 modules across codebase
   - Update Vitest configuration for better mixed-module support
   - Document mocking best practices

2. **Test Infrastructure**
   - Add explicit timeouts to all tests
   - Add test execution monitoring
   - Create test categorization (unit, integration, e2e)

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

| File                     | Status        | Priority | Assigned | Due Date   |
| ------------------------ | ------------- | -------- | -------- | ---------- |
| database-adapter.test.js | 📋 Documented | P2       | TBD      | TBD        |
| tool-masking.test.js     | ✅ Resolved   | -        | -        | 2026-02-09 |

---

## Success Criteria for Resolution

### database-adapter.test.js

- [ ] All 7 skipped tests are enabled
- [ ] All tests pass consistently
- [ ] No more mock-related TODOs
- [ ] Test execution time < 30 seconds

### tool-masking.test.js ✅ COMPLETED

- [x] No timeout issues
- [x] All tests pass consistently (54 tests)
- [x] Logger mock works reliably
- [x] Test execution time < 10 seconds (682ms achieved)

---

## Contact

For questions or to work on these issues:

1. Review this document
2. Check related files:
   - `tests/unit/database/database-adapter.test.js`
   - `tests/unit/ai-engine/tool-masking.test.js`
   - `src/main/database/database-adapter.js`
   - `src/main/ai-engine/tool-masking.js`
3. Create a new branch for fixes
4. Reference this document in PR

---

## Appendix: Test Execution Logs

### Last Run: 2026-02-09

**Command:**

```bash
npm run test:unit -- database/database-adapter.test.js
```

**Result:** Some tests pass, 7 tests skipped (CommonJS mocking issues)

**Command:**

```bash
npx vitest run tests/unit/ai-engine/tool-masking.test.js
```

**Result:** ✅ 54 passed (682ms)

---

**Document Created:** 2026-01-25
**Last Updated:** 2026-02-09
**Status:** Partially Resolved
**Owner:** Development Team

**Note:** tool-masking.test.js is now fully resolved. Only database-adapter.test.js has remaining issues (CommonJS mocking limitations).
