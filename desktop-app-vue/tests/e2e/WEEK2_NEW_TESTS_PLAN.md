# Week 2 New Tests Plan

**Date:** 2026-01-25
**Target:** 20+ new frontend-only E2E tests
**Strategy:** Focus on UI interactions that don't require backend services

---

## 🎯 Test Categories

### Category 1: Modal Management (5 tests)
**File:** `tests/e2e/project/detail/project-detail-modals.e2e.test.ts`

1. ✅ **Modal opening/closing**
   - Test opening file management modal
   - Test closing with X button
   - Test closing with Escape key

2. ✅ **Confirmation dialogs**
   - Test unsaved changes confirmation
   - Test delete confirmation
   - Test cancel confirmation

3. ✅ **Multiple modals**
   - Test modal stacking
   - Test closing all modals with forceCloseAllModals()

4. ✅ **Modal focus**
   - Test modal gets focus when opened
   - Test keyboard navigation in modal

5. ✅ **Modal backdrop**
   - Test backdrop click closes modal
   - Test backdrop prevents interaction with background

---

### Category 2: Navigation Flows (5 tests)
**File:** `tests/e2e/project/detail/project-detail-navigation.e2e.test.ts`

1. ✅ **Breadcrumb navigation**
   - Test breadcrumb displays correct path
   - Test clicking breadcrumb items

2. ✅ **Back to list**
   - Test back button navigation
   - Test with unsaved changes
   - Test URL changes correctly

3. ✅ **Mode switching**
   - Test switching between normal and AI modes
   - Test UI state changes

4. ✅ **Deep linking**
   - Test loading project by URL hash
   - Test invalid project ID handling

5. ✅ **Browser back/forward**
   - Test browser back button
   - Test browser forward button

---

### Category 3: Panel Operations (5 tests)
**File:** `tests/e2e/project/detail/project-detail-panels.e2e.test.ts`

1. ✅ **Panel visibility toggle**
   - Test show/hide file explorer
   - Test show/hide editor
   - Test show/hide chat panel

2. ✅ **Panel resize**
   - Test drag resize with mouse
   - Test minimum width enforcement
   - Test maximum width enforcement

3. ✅ **Panel state persistence**
   - Test panel width persists across reload
   - Test panel visibility persists

4. ✅ **Responsive behavior**
   - Test panel auto-hide on small screens
   - Test panel reflow

5. ✅ **Panel focus management**
   - Test clicking panel brings focus
   - Test keyboard navigation between panels

---

### Category 4: UI State Management (3 tests)
**File:** `tests/e2e/project/detail/project-detail-ui-state.e2e.test.ts`

1. ✅ **Loading states**
   - Test loading spinner displays during operations
   - Test loading overlay blocks interaction

2. ✅ **Error states**
   - Test error messages display correctly
   - Test error dismissal

3. ✅ **Empty states**
   - Test empty file list message
   - Test no conversation message

---

### Category 5: Button Interactions (3 tests)
**File:** `tests/e2e/project/detail/project-detail-buttons.e2e.test.ts`

1. ✅ **Button states**
   - Test button disabled/enabled states
   - Test button loading states

2. ✅ **Dropdown menus**
   - Test dropdown opens on click
   - Test dropdown closes on outside click
   - Test dropdown item selection

3. ✅ **Icon buttons**
   - Test icon-only buttons have tooltips
   - Test icon button click handling

---

## 📋 Implementation Plan

### Phase 1: Setup (30 minutes)
- [x] Create test plan document
- [ ] Create 5 new test files
- [ ] Set up test templates with common imports

### Phase 2: Write Tests (3 hours)
- [ ] Category 1: Modal Management (5 tests)
- [ ] Category 2: Navigation Flows (5 tests)
- [ ] Category 3: Panel Operations (5 tests)
- [ ] Category 4: UI State Management (3 tests)
- [ ] Category 5: Button Interactions (3 tests)

### Phase 3: Execution & Verification (1 hour)
- [ ] Run all new tests
- [ ] Fix any failing tests
- [ ] Verify pass rate
- [ ] Create test results report

### Phase 4: Documentation (30 minutes)
- [ ] Update WEEK2_PROGRESS.md
- [ ] Create WEEK2_NEW_TESTS_SUMMARY.md
- [ ] Update README.md with new test info

**Total Estimated Time:** 5 hours

---

## 🔧 Test Patterns to Use

### Pattern 1: Modal Testing
```typescript
test('should handle modal lifecycle', async () => {
  const { app, window } = await launchElectronApp();

  try {
    await login(window);
    await createAndOpenProject(window, { name: 'Test Project' });

    // Open modal
    const button = await window.$('[data-testid="open-modal-button"]');
    await button.click();
    await window.waitForTimeout(300);

    // Verify modal is visible
    const modal = await window.$('.ant-modal');
    expect(modal).toBeTruthy();
    const isVisible = await modal.isVisible();
    expect(isVisible).toBe(true);

    // Close modal
    await forceCloseAllModals(window);
    const stillVisible = await modal.isVisible();
    expect(stillVisible).toBe(false);

  } finally {
    await closeElectronApp(app);
  }
});
```

### Pattern 2: Navigation Testing
```typescript
test('should navigate correctly', async () => {
  const { app, window } = await launchElectronApp();

  try {
    await login(window);

    // Navigate to target page
    await window.evaluate(() => {
      window.location.hash = '#/target-page';
    });
    await window.waitForTimeout(1000);

    // Verify URL and page state
    const hash = await window.evaluate(() => window.location.hash);
    expect(hash).toContain('target-page');

    // Verify page elements loaded
    const pageElement = await window.$('.target-page-class');
    expect(pageElement).toBeTruthy();

  } finally {
    await closeElectronApp(app);
  }
});
```

### Pattern 3: Panel Testing
```typescript
test('should resize panel', async () => {
  const { app, window } = await launchElectronApp();

  try {
    await login(window);
    await createAndOpenProject(window, { name: 'Test Project' });

    // Get initial width
    const panel = await window.$('[data-testid="panel"]');
    const initialWidth = await panel.evaluate(el => el.clientWidth);

    // Find resize handle
    const handle = await window.$('.resize-handle');
    const handleBox = await handle.boundingBox();

    // Drag to resize
    await window.mouse.move(handleBox.x, handleBox.y);
    await window.mouse.down();
    await window.mouse.move(handleBox.x + 100, handleBox.y);
    await window.mouse.up();
    await window.waitForTimeout(300);

    // Verify width changed
    const newWidth = await panel.evaluate(el => el.clientWidth);
    expect(newWidth).toBeGreaterThan(initialWidth);

  } finally {
    await closeElectronApp(app);
  }
});
```

---

## ✅ Success Criteria

- [ ] 20+ new tests created
- [ ] All tests are frontend-only (no backend required)
- [ ] Pass rate ≥ 95%
- [ ] Average test duration < 1 minute
- [ ] All tests use Week 1 helper functions
- [ ] Comprehensive documentation

---

## 📊 Progress Tracking

### Tests Created: 0/21
```
Category 1 (Modals):      ⬜⬜⬜⬜⬜  0/5
Category 2 (Navigation):  ⬜⬜⬜⬜⬜  0/5
Category 3 (Panels):      ⬜⬜⬜⬜⬜  0/5
Category 4 (UI State):    ⬜⬜⬜     0/3
Category 5 (Buttons):     ⬜⬜⬜     0/3
```

**Overall Progress:** 0% (0/21 tests)

---

**Plan Status:** ✅ **READY TO IMPLEMENT**
**Next Action:** Create test files and start writing tests
**Estimated Completion:** 5 hours
