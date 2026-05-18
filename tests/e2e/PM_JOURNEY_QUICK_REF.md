# Project Management Journey E2E - Quick Reference

## 🚀 Quick Start

### Run Test (Windows)
```cmd
tests\e2e\run-pm-journey-test.bat
```

### Run Test (Linux/macOS)
```bash
./tests/e2e/run-pm-journey-test.sh
```

### Test Modes
```bash
# Normal (headless)
run-pm-journey-test.bat

# Interactive UI
run-pm-journey-test.bat ui

# Debug mode
run-pm-journey-test.bat debug

# With HTML report
run-pm-journey-test.bat report
```

---

## 📊 Test Coverage (33 Tests)

| Phase | Tests | Coverage |
|-------|-------|----------|
| 1. Organization & Team Setup | 4 | Team creation, members, permissions |
| 2. Project Creation | 3 | Project init, metadata, files |
| 3. Task Board Creation | 3 | Board, columns, labels |
| 4. Task Management | 6 | Tasks, assignments, checklists |
| 5. Sprint Management | 6 | Sprint creation, execution, completion |
| 6. Reports & Analytics | 3 | Reports, analytics, exports |
| 7. Project Delivery | 5 | Stats, exports, sharing, delivery |
| 8. Cleanup & Verification | 3 | Final state validation |

**Total**: 33 tests | **Runtime**: ~60-90s | **IPC Handlers**: 37

---

## 🔑 Key IPC Channels

### Team & Permissions
```javascript
team:create-team
team:add-member
team:get-team-members
perm:grant-permission
```

### Task Management
```javascript
task:create-board
task:create-column
task:create-task
task:assign-task
task:move-task
task:create-checklist
task:add-comment
```

### Sprint Management
```javascript
task:create-sprint
task:start-sprint
task:complete-sprint
task:get-sprint-stats
```

### Project Operations
```javascript
project:create-quick
project:update
project:save-files
project:export-file
project:shareProject
```

---

## 🎯 Success Criteria

✅ Project status: `delivered`
✅ Task status: `completed`
✅ Sprint status: `completed`
✅ Board status: `archived`
✅ Team members: 2+ (lead + member)
✅ Share token generated
✅ Export files created

---

## 🔧 Prerequisites

1. **Build Main Process**
   ```bash
   cd desktop-app-vue && npm run build:main
   ```

2. **Install Playwright**
   ```bash
   npx playwright install chromium --with-deps
   ```

3. **Database Initialized**
   - Tables: teams, team_members, permissions, boards, columns, tasks, sprints, projects
   - Schema: SQLite with required fields

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "API path not found" | `npm run build:main` in desktop-app-vue |
| Database errors | Verify tables exist, check permissions |
| Timeout errors | Increase Playwright timeout config |
| Permission errors | Check user DID format, verify RBAC tables |

---

## 📈 Performance Targets

- **Total Runtime**: 60-90 seconds
- **App Startup**: <120 seconds
- **Window Load**: <90 seconds
- **IPC Response**: <5 seconds per call

---

## 📁 Files

- **Test**: `tests/e2e/project-management-journey.e2e.test.ts`
- **Docs**: `tests/e2e/PROJECT_MANAGEMENT_JOURNEY_TEST.md`
- **Summary**: `tests/e2e/PM_JOURNEY_TEST_SUMMARY.md`
- **Runner (Win)**: `tests/e2e/run-pm-journey-test.bat`
- **Runner (Unix)**: `tests/e2e/run-pm-journey-test.sh`

---

## 🔍 View Report

```bash
# Generate and view HTML report
npx playwright test tests/e2e/project-management-journey.e2e.test.ts --reporter=html
npx playwright show-report
```

---

**Version**: 1.0.0 | **Status**: ✅ Production Ready | **Date**: 2026-02-04
