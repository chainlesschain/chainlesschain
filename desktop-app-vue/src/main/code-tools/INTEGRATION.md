# Integration Guide for Code Tools IPC Modules

## Overview
This guide shows how to integrate the extracted IPC handlers back into the main index.js file.

## Files Created
1. **code-ipc.js** - 10 code-related handlers
2. **review-ipc.js** - 10 review-related handlers
3. **README.md** - Module documentation
4. **HANDLERS.md** - Complete handler reference
5. **INTEGRATION.md** - This file

## Step-by-Step Integration

### Step 1: Add Imports at the Top of index.js

Add these lines near the other require statements (around line 59-76 where other IPC modules are imported):

```javascript
// Code Tools IPC Handlers
const { registerCodeIPC } = require('./code-tools/code-ipc');
const { registerReviewIPC } = require('./code-tools/review-ipc');
```

### Step 2: Register Handlers in registerCoreIPCHandlers Method

Find the `registerCoreIPCHandlers()` method in the ChainlessChainApp class and add the registration calls. This is typically where other IPC handlers are registered (around line 1091).

```javascript
registerCoreIPCHandlers() {
  // ... existing code ...

  // Register Code Tools IPC handlers (10 handlers)
  registerCodeIPC({
    llmManager: this.llmManager
  });

  // Register Review System IPC handlers (10 handlers)
  registerReviewIPC({
    reviewManager: this.reviewManager
  });

  // ... existing code ...
}
```

### Step 3: Remove Original Handler Code (Optional)

Once the new modules are integrated and tested, you can remove the original inline handler definitions from index.js:

**Code handlers to remove** (lines ~4721-4956):
- Lines containing `ipcMain.handle('code:generate', ...)`
- Lines containing `ipcMain.handle('code:generateTests', ...)`
- Lines containing `ipcMain.handle('code:review', ...)`
- Lines containing `ipcMain.handle('code:refactor', ...)`
- Lines containing `ipcMain.handle('code:explain', ...)`
- Lines containing `ipcMain.handle('code:fixBug', ...)`
- Lines containing `ipcMain.handle('code:generateScaffold', ...)`
- Lines containing `ipcMain.handle('code:executePython', ...)`
- Lines containing `ipcMain.handle('code:executeFile', ...)`
- Lines containing `ipcMain.handle('code:checkSafety', ...)`

**Review handlers to remove** (lines ~3849-3967):
- Lines containing `ipcMain.handle('review:create', ...)`
- Lines containing `ipcMain.handle('review:update', ...)`
- Lines containing `ipcMain.handle('review:delete', ...)`
- Lines containing `ipcMain.handle('review:get', ...)`
- Lines containing `ipcMain.handle('review:get-by-target', ...)`
- Lines containing `ipcMain.handle('review:reply', ...)`
- Lines containing `ipcMain.handle('review:mark-helpful', ...)`
- Lines containing `ipcMain.handle('review:report', ...)`
- Lines containing `ipcMain.handle('review:get-statistics', ...)`
- Lines containing `ipcMain.handle('review:get-my-reviews', ...)`

## Complete Integration Example

```javascript
// ===== In index.js =====

// At the top (with other imports)
const { registerCategoryIPCHandlers } = require('./category-ipc');
const { registerSkillToolIPC } = require('./skill-tool-system/skill-tool-ipc');
const { registerCodeIPC } = require('./code-tools/code-ipc');        // NEW
const { registerReviewIPC } = require('./code-tools/review-ipc');    // NEW

// ... rest of imports ...

class ChainlessChainApp {
  // ... existing methods ...

  registerCoreIPCHandlers() {
    console.log('[ChainlessChainApp] Registering core IPC handlers...');

    // ... existing handler registrations ...

    // Register category handlers
    registerCategoryIPCHandlers(this.database, this.mainWindow);

    // Register skill tool handlers
    registerSkillToolIPC(ipcMain, this.skillManager, this.toolManager);

    // Register code tools handlers (NEW)
    registerCodeIPC({
      llmManager: this.llmManager
    });

    // Register review system handlers (NEW)
    registerReviewIPC({
      reviewManager: this.reviewManager
    });

    console.log('[ChainlessChainApp] Core IPC handlers registered');
  }

  // ... rest of the class ...
}
```

## Verification

After integration, verify the handlers are working:

```javascript
// In the renderer process (Vue component)
async testCodeHandlers() {
  // Test code generation
  const codeResult = await window.ipcRenderer.invoke('code:generate',
    '创建一个计算器函数',
    { language: 'javascript' }
  );
  console.log('Generated code:', codeResult);

  // Test code safety check
  const safetyResult = await window.ipcRenderer.invoke('code:checkSafety',
    'import os; os.system("rm -rf /")'
  );
  console.log('Safety check:', safetyResult);
}

async testReviewHandlers() {
  // Test review creation
  const review = await window.ipcRenderer.invoke('review:create', {
    targetId: 'test123',
    targetType: 'note',
    rating: 5,
    content: 'Test review'
  });
  console.log('Created review:', review);

  // Test get statistics
  const stats = await window.ipcRenderer.invoke('review:get-statistics',
    'test123',
    'note'
  );
  console.log('Statistics:', stats);
}
```

## Benefits of This Modularization

1. **Reduced File Size**: index.js is now ~400 lines shorter
2. **Better Organization**: Related handlers are grouped together
3. **Easier Maintenance**: Changes to code tools or reviews are isolated
4. **Improved Readability**: Each module has clear documentation
5. **Reusability**: Modules can be used in different contexts
6. **Testing**: Easier to unit test individual modules

## Dependencies Required

Make sure these modules exist and are accessible:

### For code-ipc.js:
- `/src/main/engines/code-engine.js` (must export `getCodeEngine`)
- `/src/main/engines/code-executor.js` (must export `getCodeExecutor`)

### For review-ipc.js:
- `this.reviewManager` must be initialized in ChainlessChainApp class
- ReviewManager must implement all required methods (see HANDLERS.md)

## Troubleshooting

### Issue: "Cannot find module './code-tools/code-ipc'"
**Solution**: Verify the file path is correct relative to index.js

### Issue: "llmManager is undefined"
**Solution**: Ensure `this.llmManager` is initialized before calling `registerCodeIPC()`

### Issue: "reviewManager is undefined"
**Solution**: Ensure `this.reviewManager` is initialized before calling `registerReviewIPC()`

### Issue: Handlers not responding
**Solution**: Check that the registration functions are being called in the correct initialization sequence

## Migration Checklist

- [ ] Create code-tools directory
- [ ] Copy code-ipc.js to code-tools/
- [ ] Copy review-ipc.js to code-tools/
- [ ] Add imports to index.js
- [ ] Add registration calls to registerCoreIPCHandlers()
- [ ] Test all code: handlers (10 total)
- [ ] Test all review: handlers (10 total)
- [ ] Remove original inline handlers from index.js (optional)
- [ ] Commit changes with descriptive message

## Recommended Commit Message

```
refactor(ipc): extract code and review handlers to separate modules

- Create code-ipc.js with 10 code-related handlers
- Create review-ipc.js with 10 review-related handlers
- Add registerCodeIPC and registerReviewIPC functions
- Reduce index.js size by ~400 lines
- Improve code organization and maintainability

Handlers extracted:
- code: generate, generateTests, review, refactor, explain, fixBug,
  generateScaffold, executePython, executeFile, checkSafety
- review: create, update, delete, get, get-by-target, reply,
  mark-helpful, report, get-statistics, get-my-reviews
```
