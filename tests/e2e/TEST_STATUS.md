# Project Management E2E Test - Current Status

**Date**: 2026-02-04
**Status**: ✅ IPC Registration Fixed, 🔧 Test Structure Needs Adjustment

## Summary

Successfully fixed the missing IPC handler registration issue. Tests can now communicate with the Electron main process. However, the test structure needs adjustment to handle database state management across tests.

## Fixed Issues

### 1. ✅ Missing IPC Handler Registration

**Problem**: Permission and team management IPC handlers weren't being registered in the IPC registry.

**Solution**: Added registration in `desktop-app-vue/src/main/ipc/ipc-registry.js` (after line 381):

```javascript
// 🔥 Permission System (RBAC, 28 handlers)
logger.info("[IPC Registry] Registering Permission System IPC...");
try {
  const { registerPermissionIPC } = require("../permission/permission-ipc");
  registerPermissionIPC(database);
  logger.info("[IPC Registry] ✓ Permission System IPC registered (28 handlers)");
  logger.info("[IPC Registry]   - Permission Management: 8 handlers");
  logger.info("[IPC Registry]   - Approval Workflows: 8 handlers");
  logger.info("[IPC Registry]   - Delegation: 4 handlers");
  logger.info("[IPC Registry]   - Team Management: 8 handlers");
} catch (permError) {
  logger.warn(
    "[IPC Registry] ⚠️  Permission System IPC registration failed (non-fatal):",
    permError.message,
  );
}
```

### 2. ✅ Missing Preload API Exposure

**Problem**: Team, permission, and task management APIs weren't exposed through `window.electronAPI` in the preload script.

**Solution**: Added API exposure in `desktop-app-vue/src/preload/index.js` (before the `mainLog` section):

```javascript
// Team Management (8 methods)
team: {
  createTeam, updateTeam, deleteTeam,
  addMember, removeMember, setLead,
  getTeams, getTeamMembers
}

// Permission Management (20+ methods)
perm: {
  grantPermission, revokePermission, checkPermission,
  getUserPermissions, getResourcePermissions,
  bulkGrant, inheritPermissions, getEffectivePermissions,
  // Approval Workflows
  createWorkflow, updateWorkflow, deleteWorkflow,
  submitApproval, approveRequest, rejectRequest,
  getPendingApprovals, getApprovalHistory,
  // Delegation
  delegatePermissions, revokeDelegation,
  getDelegations, acceptDelegation
}

// Task Management (40+ methods)
task: {
  // Board Management
  createBoard, updateBoard, deleteBoard, getBoards, getBoard,
  createColumn, updateColumn, deleteColumn, createLabel,
  // Task CRUD
  createTask, updateTask, deleteTask, getTask, getTasks,
  assignTask, unassignTask, moveTask,
  setDueDate, setPriority, setEstimate, addLabel,
  // Checklists
  addChecklist, updateChecklist, deleteChecklist, toggleChecklistItem,
  // Comments
  addComment, updateComment, deleteComment, getComments,
  // Sprint Management
  createSprint, updateSprint, deleteSprint, startSprint, completeSprint,
  // Reports and Analytics
  getBoardAnalytics, exportBoard, getSprintStats,
  createTeamReport, getTeamReports
}
```

### 3. ✅ Invalid Role Value

**Problem**: Test used `role: 'developer'` which isn't allowed by database constraint.

**Solution**: Changed to `role: 'member'` (allowed values: 'lead', 'member', 'guest').

## Current Issue

### 🔧 Test Structure Problem: Database State Management

**Test Results**:
- ✅ **1 passed**: Phase 1.1: Create team (5.5s)
- ❌ **1 failed**: Phase 1.2: Add team member
- ⏭️ **31 did not run**: (skipped due to failure)

**Error**:
```
Error: FOREIGN KEY constraint failed
```

**Root Cause**:
Each test launches a new Electron app instance with a fresh database:

```typescript
test('Phase 1.1: Create team', async () => {
  const { app, window } = await launchElectronApp();
  // Creates team, saves teamId to module variable
  await closeElectronApp(app); // Closes app, database state lost
});

test('Phase 1.2: Add team member', async () => {
  const { app, window } = await launchElectronApp(); // NEW app, FRESH database
  // Tries to use teamId from previous test - DOESN'T EXIST!
  await closeElectronApp(app);
});
```

## Recommended Solutions

### Option 1: Share Single App Instance (Recommended)

Use `beforeAll` and `afterAll` hooks to maintain a single Electron app instance across all tests:

```typescript
test.describe.serial('Project Management Journey', () => {
  let app: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    const ctx = await launchElectronApp();
    app = ctx.app;
    window = ctx.window;
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
  });

  test('Phase 1.1: Create team', async () => {
    // Use shared window
    const createResult = await callIPC(window, 'team:create-team', {...});
    teamId = createResult.teamId;
  });

  test('Phase 1.2: Add team member', async () => {
    // Use shared window - teamId exists in same database
    const addResult = await callIPC(window, 'team:add-member', {...});
  });
});
```

### Option 2: Self-Contained Tests

Make each test fully independent by creating its own test data:

```typescript
test('Phase 1.2: Add team member', async () => {
  const { app, window } = await launchElectronApp();

  try {
    // 1. Create team first
    const teamResult = await callIPC(window, 'team:create-team', {...});
    const localTeamId = teamResult.teamId;

    // 2. Add member to the team we just created
    const addResult = await callIPC(window, 'team:add-member', {
      teamId: localTeamId,
      ...
    });

    expect(addResult.success).toBe(true);
  } finally {
    await closeElectronApp(app);
  }
});
```

## Files Modified

1. ✅ `desktop-app-vue/src/main/ipc/ipc-registry.js` - Added permission IPC registration
2. ✅ `desktop-app-vue/src/preload/index.js` - Added team/perm/task API exposure
3. ✅ `tests/e2e/project-management-journey.e2e.test.ts` - Fixed role value ('developer' → 'member')
4. 🔧 `tests/e2e/project-management-journey.e2e.test.ts` - **NEEDS**: Restructure to share app instance

## Next Steps

1. **Restructure test file** to use shared Electron app instance (Option 1 recommended)
2. **Run full test suite** to identify any remaining issues
3. **Fix additional data constraints** if any other field values violate DB constraints
4. **Document test patterns** for future E2E test development

## Statistics

- **Total Tests**: 33
- **Passed**: 1 (3%)
- **Failed**: 1 (database state issue)
- **Not Run**: 31
- **Test Duration**: ~12 seconds
- **IPC Handlers Registered**: 28 (permission) + 49 (task) + 8 (team) = **85 handlers**

## Build Commands Used

```bash
# Rebuild main process (after IPC registry change)
cd desktop-app-vue && npm run build:main

# Run tests
cd tests/e2e && npx playwright test tests/e2e/project-management-journey.e2e.test.ts --workers=1
```

## References

- Test file: `tests/e2e/project-management-journey.e2e.test.ts`
- Test helpers: `tests/e2e/helpers.ts`
- IPC registry: `desktop-app-vue/src/main/ipc/ipc-registry.js`
- Preload script: `desktop-app-vue/src/preload/index.js`
- Permission IPC: `desktop-app-vue/src/main/permission/permission-ipc.js`
- Task IPC: `desktop-app-vue/src/main/task/task-ipc.js`
