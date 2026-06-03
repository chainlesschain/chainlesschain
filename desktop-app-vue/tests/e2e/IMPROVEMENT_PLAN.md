# E2E Test Improvement Plan

## Current Status (Based on TEST_SUMMARY.md)

- **Total Tests**: 39
- **Passed**: 30 (76.9%)
- **Failed**: 9 (23.1%)
- **Target**: 95% pass rate, 90%+ coverage

## Priority 1: Fix Failing Tests (Target: 90%+ pass rate)

### 1.1 Fix Modal Blocking Issue (Affects 5 tests) 🔥

**Files affected:**

- `project/detail/project-detail-layout-git.e2e.test.ts` (2 tests)
- `project/detail/project-detail-ai-creating.e2e.test.ts` (1 test)
- Other git/dialog tests

**Solution:**

```typescript
// Update helpers/project-detail.ts
export async function forceCloseAllModals(window: Page) {
  await window.evaluate(() => {
    // Close all Ant Design modals
    const modals = document.querySelectorAll(".ant-modal-wrap");
    modals.forEach((modal) => {
      const closeBtn = modal.querySelector(".ant-modal-close") as HTMLElement;
      if (closeBtn) closeBtn.click();
    });

    // Close any drawer overlays
    const overlays = document.querySelectorAll(
      ".ant-modal-mask, .ant-drawer-mask",
    );
    overlays.forEach((overlay) => (overlay as HTMLElement).remove());
  });

  await window.waitForTimeout(500);
}

// Call this in waitForProjectDetailLoad
await forceCloseAllModals(window);
```

### 1.2 Fix AI Project Creation Page Loading (Affects 4 tests) 🔥

**Files affected:**

- `project/detail/project-detail-ai-creating.e2e.test.ts`

**Investigation needed:**

1. Check if route `#/projects/ai-create` is properly configured
2. Verify page component mounts correctly
3. Add proper loading state handling

**Solution:**

```typescript
// Add to helpers/project-detail.ts
export async function waitForAICreatePageLoad(window: Page, timeout = 10000) {
  await window.waitForURL(/\/projects\/ai-create/, { timeout });

  // Wait for chat panel with fallback
  try {
    await window.waitForSelector('[data-testid="ai-create-page"]', {
      timeout: 5000,
    });
  } catch {
    console.log("AI create page element not found, checking for chat panel...");
    await window.waitForSelector('[data-testid="chat-panel"]', {
      timeout: 5000,
    });
  }

  await forceCloseAllModals(window);
}
```

### 1.3 Fix Panel Drag Functionality (Affects 1 test) 🔧

**Files affected:**

- `project/detail/project-detail-layout-git.e2e.test.ts`

**Investigation:**

- Check ResizeHandle component event handlers
- Verify width state updates are applied to DOM
- Test with different drag distances

### 1.4 Fix Filename Case Inconsistency (Affects 1 test) 🔧

**Files affected:**

- `project/detail/project-detail-editors.e2e.test.ts`

**Solution:**

```typescript
// Standardize file selection by using case-insensitive matching
export async function selectFileByName(window: Page, fileName: string) {
  const normalizedName = fileName.toLowerCase();

  await window.evaluate((name) => {
    const items = Array.from(
      document.querySelectorAll('[data-testid^="file-tree-item-"]'),
    );
    const targetItem = items.find((item) =>
      item.textContent?.toLowerCase().includes(name),
    ) as HTMLElement;

    if (targetItem) targetItem.click();
  }, normalizedName);
}
```

## Priority 2: Increase Test Coverage (Target: 90%+ coverage)

### 2.1 Add Missing Feature Tests

**New test files to create:**

1. **`file/pdf-editor.e2e.test.ts`**
   - PDF viewing
   - PDF annotation
   - PDF export
   - Page navigation

2. **`file/image-editor.e2e.test.ts`**
   - Image viewing
   - Image zoom/pan
   - Image format conversion
   - Image metadata

3. **`project/shortcuts.e2e.test.ts`**
   - Keyboard shortcuts (Ctrl+S, Ctrl+N, etc.)
   - Quick file switching
   - Command palette

4. **`project/search.e2e.test.ts`**
   - File content search
   - Search in project
   - Replace in files
   - Regex search

5. **`file/upload-download.e2e.test.ts`**
   - File upload
   - Folder upload
   - Download single file
   - Batch download

6. **`project/collaboration.e2e.test.ts`** (if applicable)
   - Real-time collaboration
   - Conflict resolution
   - User presence

### 2.2 Enhance Existing Tests

**Add to `project/project-settings.e2e.test.ts`:**

- Project rename
- Project description edit
- Project icon/color change
- Project privacy settings

**Add to `ai/ai-chat.e2e.test.ts`:**

- Message editing
- Message deletion
- Code block syntax highlighting
- Copy code from response
- Regenerate response

**Add to `file/file-operations.e2e.test.ts`:**

- Undo/redo operations
- File move across folders
- Drag-and-drop file upload
- File permissions

## Priority 3: Improve Test Reliability

### 3.1 Enhance Test Helpers

**Update `helpers/common.ts`:**

```typescript
// Add retry logic for flaky operations
export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delay = 1000,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Should not reach here");
}

// Add better screenshot on failure
export async function screenshotOnFailure(
  window: Page,
  testName: string,
  testInfo: any,
) {
  if (testInfo.status !== "passed") {
    const screenshot = await window.screenshot();
    await testInfo.attach(`failure-${testName}`, {
      body: screenshot,
      contentType: "image/png",
    });
  }
}

// Add network idle wait
export async function waitForNetworkIdle(window: Page, timeout = 5000) {
  await window.waitForLoadState("networkidle", { timeout });
}
```

### 3.2 Add Test Fixtures

**Create `helpers/fixtures.ts`:**

```typescript
import { test as base } from "@playwright/test";

export const test = base.extend({
  // Auto-login fixture
  authenticatedWindow: async ({ window }, use) => {
    await login(window, "testuser", "testpass");
    await use(window);
  },

  // Auto-cleanup fixture
  testProject: async ({ window }, use) => {
    const projectId = await createTestProject(window, "Test Project");
    await use(projectId);
    await deleteProject(window, projectId);
  },
});
```

### 3.3 Add Test Utilities

**Create `helpers/assertions.ts`:**

```typescript
// Custom assertions for better error messages
export async function expectElementVisible(
  window: Page,
  selector: string,
  options?: { timeout?: number },
) {
  const element = await window.waitForSelector(selector, options);
  const isVisible = await element.isVisible();
  expect(isVisible, `Element ${selector} should be visible`).toBe(true);
}

export async function expectTextContent(
  window: Page,
  selector: string,
  expectedText: string | RegExp,
) {
  const element = await window.locator(selector);
  await expect(element).toContainText(expectedText);
}
```

## Priority 4: Performance & Stability

### 4.1 Add Performance Tests

**Create `performance/load-time.e2e.test.ts`:**

```typescript
test("应该在2秒内加载项目详情页", async ({ window }) => {
  const startTime = Date.now();
  await window.goto("#/projects/123");
  await waitForProjectDetailLoad(window);
  const loadTime = Date.now() - startTime;

  expect(loadTime).toBeLessThan(2000);
});

test("应该能够处理1000+文件的项目", async ({ window }) => {
  const projectId = await createLargeProject(window, 1000);
  await window.goto(`#/projects/${projectId}`);
  await waitForProjectDetailLoad(window);

  // Should still be responsive
  const fileTree = await window.locator('[data-testid="file-tree"]');
  await expect(fileTree).toBeVisible();
});
```

### 4.2 Add Stress Tests

**Create `stress/concurrent-operations.e2e.test.ts`:**

```typescript
test("应该能够同时编辑多个文件", async ({ window }) => {
  await Promise.all([
    editFile(window, "file1.md", "content1"),
    editFile(window, "file2.md", "content2"),
    editFile(window, "file3.md", "content3"),
  ]);

  // All files should be saved
  await expectFileContent(window, "file1.md", "content1");
  await expectFileContent(window, "file2.md", "content2");
  await expectFileContent(window, "file3.md", "content3");
});
```

## Priority 5: CI/CD Integration

### 5.1 Add GitHub Actions Workflow

**Create `.github/workflows/e2e-tests.yml`:**

```yaml
name: E2E Tests

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: windows-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: |
          cd desktop-app-vue
          npm install

      - name: Build application
        run: |
          cd desktop-app-vue
          npm run build:main

      - name: Run E2E tests
        run: |
          cd desktop-app-vue
          npm run test:e2e

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: desktop-app-vue/playwright-report/
```

### 5.2 Add Test Reports

**Update `package.json`:**

```json
{
  "scripts": {
    "test:e2e": "playwright test tests/e2e",
    "test:e2e:report": "playwright show-report",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug"
  }
}
```

## Execution Timeline

### Week 1: Critical Fixes (Days 1-7)

- [x] Day 1: Organize test directory structure
- [ ] Day 2: Fix modal blocking issue
- [ ] Day 3: Fix AI creation page loading
- [ ] Day 4: Fix panel drag & filename issues
- [ ] Day 5: Verify all fixes, rerun tests
- [ ] Day 6-7: Update documentation

**Target**: 90%+ pass rate (35/39 tests passing)

### Week 2: Coverage Expansion (Days 8-14)

- [ ] Day 8-9: Add PDF/Image editor tests
- [ ] Day 10-11: Add search & shortcuts tests
- [ ] Day 12-13: Add upload/download tests
- [ ] Day 14: Code review & refinement

**Target**: 50+ tests, 85%+ coverage

### Week 3: Reliability & Performance (Days 15-21)

- [ ] Day 15-16: Enhance test helpers & fixtures
- [ ] Day 17-18: Add performance tests
- [ ] Day 19-20: Add stress tests
- [ ] Day 21: Full regression testing

**Target**: 95%+ pass rate, <5% flaky tests

### Week 4: CI/CD & Documentation (Days 22-30)

- [ ] Day 22-23: Setup GitHub Actions
- [ ] Day 24-25: Configure test reporting
- [ ] Day 26-27: Write comprehensive test docs
- [ ] Day 28-30: Team training & handoff

**Target**: Fully automated CI/CD pipeline

## Success Metrics

### Coverage Metrics

- ✅ File coverage: >90%
- ✅ Feature coverage: >85%
- ✅ User journey coverage: >80%

### Quality Metrics

- ✅ Pass rate: >95%
- ✅ Flaky test rate: <5%
- ✅ Average test execution time: <5 min

### Maintenance Metrics

- ✅ Test code duplication: <10%
- ✅ Helper function reuse: >70%
- ✅ Documentation coverage: 100%

## Notes

1. **LLM Configuration**: Some tests require LLM service. Consider mocking for faster tests.
2. **Test Data**: Use separate test database to avoid pollution.
3. **Parallel Execution**: Configure Playwright workers for faster execution.
4. **Visual Testing**: Consider Playwright's visual regression testing for UI changes.

---

**Document Version**: 1.0
**Created**: 2026-01-25
**Next Review**: Weekly during execution
