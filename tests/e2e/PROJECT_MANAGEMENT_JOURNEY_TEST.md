# Project Management Journey E2E Test

## Overview

This E2E test suite covers the complete project management lifecycle from team setup to project delivery, testing the integration of multiple modules:

- **Permission System** (28 IPC handlers)
- **Task Management** (49 IPC handlers)
- **Team Management** (8 IPC handlers)
- **Project Management** (Core project operations)

## Test Coverage

### Phase 1: Organization & Team Setup (4 tests)
- **1.1 Create Team**: Creates an engineering team with a team lead
- **1.2 Add Team Member**: Adds a developer to the team
- **1.3 Verify Team Members**: Verifies team composition (lead + member)
- **1.4 Grant Permissions**: Grants project write permissions to team member

### Phase 2: Project Creation (3 tests)
- **2.1 Create Project**: Creates a new project with basic metadata
- **2.2 Update Metadata**: Updates project status to 'planning' and adds tags
- **2.3 Add Deliverable Files**: Adds requirements and architecture documents

### Phase 3: Task Board Creation (3 tests)
- **3.1 Create Task Board**: Creates a Scrum board for project execution
- **3.2 Create Board Columns**: Sets up Todo, In Progress, Done columns with WIP limits
- **3.3 Create Labels**: Creates bug, feature, urgent labels

### Phase 4: Task Management (6 tests)
- **4.1 Create Task**: Creates "Implement user authentication" task
- **4.2 Assign Task**: Assigns task to team member
- **4.3 Set Due Date & Priority**: Sets 7-day due date and high priority
- **4.4 Add Checklist**: Creates 5-item implementation checklist
- **4.5 Add Comment**: Adds security best practices comment
- **4.6 Move to In Progress**: Transitions task and project to active state

### Phase 5: Sprint Management (6 tests)
- **5.1 Create Sprint**: Creates 2-week Sprint 1 with goal
- **5.2 Move to Sprint**: Assigns task to sprint
- **5.3 Start Sprint**: Activates sprint
- **5.4 Complete Task**: Marks task complete and moves to Done
- **5.5 Get Sprint Stats**: Retrieves sprint statistics
- **5.6 Complete Sprint**: Closes sprint

### Phase 6: Reports & Analytics (3 tests)
- **6.1 Create Team Report**: Generates weekly sprint report
- **6.2 Get Board Analytics**: Retrieves 30-day board metrics
- **6.3 Export Board**: Exports board data to JSON

### Phase 7: Project Delivery (5 tests)
- **7.1 Track Project Stats**: Monitors project file statistics
- **7.2 Export Files**: Exports README.md to temp directory
- **7.3 Share Project**: Creates public share link (7-day expiry)
- **7.4 Mark as Delivered**: Sets project status to 'delivered'
- **7.5 Archive Board**: Archives completed board

### Phase 8: Cleanup & Verification (3 tests)
- **8.1 Verify Project State**: Confirms final delivered status
- **8.2 Verify Team**: Validates team still exists with members
- **8.3 Verify Task Completion**: Confirms task marked complete

## Total Test Count

**33 Tests** covering 8 phases of the project management lifecycle

## IPC Channels Tested

### Team Management (team:*)
- `team:create-team`
- `team:add-member`
- `team:get-team-members`
- `team:get-teams`

### Permission Management (perm:*)
- `perm:grant-permission`

### Task Board Management (task:*)
- `task:create-board`
- `task:create-column`
- `task:create-label`
- `task:archive-board`

### Task Management (task:*)
- `task:create-task`
- `task:assign-task`
- `task:set-due-date`
- `task:set-priority`
- `task:create-checklist`
- `task:add-checklist-item`
- `task:add-comment`
- `task:move-task`
- `task:update-task`
- `task:get-task`

### Sprint Management (task:*)
- `task:create-sprint`
- `task:move-to-sprint`
- `task:start-sprint`
- `task:complete-sprint`
- `task:get-sprint-stats`

### Reports & Analytics (task:*)
- `task:create-report`
- `task:get-board-analytics`
- `task:export-board`

### Project Management (project:*)
- `project:create-quick`
- `project:update`
- `project:get`
- `project:save-files`
- `project:stats:start`
- `project:stats:update`
- `project:stats:get`
- `project:stats:stop`
- `project:export-file`
- `project:shareProject`

## Running the Test

```bash
# Install dependencies
npm install

# Run the E2E test
npx playwright test tests/e2e/project-management-journey.e2e.test.ts

# Run with UI mode (visual debugging)
npx playwright test tests/e2e/project-management-journey.e2e.test.ts --ui

# Run with headed mode (see browser)
npx playwright test tests/e2e/project-management-journey.e2e.test.ts --headed

# Generate HTML report
npx playwright test tests/e2e/project-management-journey.e2e.test.ts --reporter=html
```

## Prerequisites

1. **Build Main Process**: Ensure Electron main process is built
   ```bash
   cd desktop-app-vue
   npm run build:main
   ```

2. **Database Setup**: SQLite database should be initialized with required tables:
   - `org_teams`
   - `org_team_members`
   - `permission_grants`
   - `task_boards`
   - `task_columns`
   - `tasks`
   - `task_sprints`
   - `projects`

3. **IPC Handlers**: All required IPC handlers must be registered:
   - `src/main/permission/permission-ipc.js` (28 handlers)
   - `src/main/task/task-ipc.js` (49 handlers)
   - `src/main/project/project-core-ipc.js`

## Test Data

All test data uses unique identifiers with timestamps to avoid conflicts:

```typescript
const TEST_ORG_ID = `org-pm-journey-${Date.now()}`;
const TEST_USER_DID = `did:key:pm-journey-user-${Date.now()}`;
const TEST_MEMBER_DID = `did:key:pm-journey-member-${Date.now()}`;
```

## Expected Results

### Success Criteria
- All 33 tests pass
- Project status: `delivered`
- Task status: `completed`
- Sprint status: `completed`
- Board status: `archived`
- Team has 2+ members (lead + member)
- Share token generated
- Export files created

### Performance Metrics
- Test suite execution time: ~60-90 seconds
- Average test time: ~2-3 seconds per test
- No memory leaks
- No IPC errors

## Troubleshooting

### Common Issues

1. **"API path not found" Error**
   - Ensure main process is built: `npm run build:main`
   - Check IPC handlers are registered in `src/main/index.js`

2. **Database Errors**
   - Verify database tables exist
   - Check database file permissions
   - Ensure SQLite is properly initialized

3. **Timeout Errors**
   - Increase Playwright timeout in test config
   - Check if Electron app is starting correctly
   - Verify no blocking operations in main process

4. **Permission Errors**
   - Ensure permission tables are initialized
   - Check user DID has proper format
   - Verify permission engine is loaded

## Integration with CI/CD

This test can be integrated into CI/CD pipelines:

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: cd desktop-app-vue && npm run build:main
      - run: npx playwright install --with-deps
      - run: npx playwright test tests/e2e/project-management-journey.e2e.test.ts
```

## Future Enhancements

1. **Additional Test Scenarios**
   - Multi-sprint projects
   - Concurrent task assignments
   - Permission delegation workflows
   - Approval workflows for critical tasks

2. **Performance Testing**
   - Bulk task creation (100+ tasks)
   - Large team sizes (50+ members)
   - Long-running sprints (multiple months)

3. **Error Scenarios**
   - Invalid permissions
   - Circular task dependencies
   - Concurrent sprint modifications
   - Network failures during exports

4. **Visual Regression Testing**
   - Screenshot comparisons of UI states
   - Board visualization consistency
   - Gantt chart rendering

## Related Documentation

- [Permission System Design](../../desktop-app-vue/src/main/permission/README.md)
- [Task Management Architecture](../../desktop-app-vue/src/main/task/README.md)
- [Team Manager Implementation](../../desktop-app-vue/src/main/permission/team-manager.js)
- [IPC Error Handler Guide](../../IPC_ERROR_HANDLER_GUIDE.md)
- [CLAUDE.md](../../CLAUDE.md) - Project overview and architecture

## Conclusion

This comprehensive E2E test validates the entire project management workflow, from team setup through project delivery. It serves as both a regression test suite and living documentation of the system's capabilities.

**Test Author**: Claude Code AI Assistant
**Test Version**: 1.0.0
**Last Updated**: 2026-02-04
**Status**: ✅ Production Ready
