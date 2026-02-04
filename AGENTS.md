# Repository Guidelines

## Project Structure & Module Organization

- `desktop-app-vue/`: Electron + Vue desktop client (main/renderer code).
- `backend/`: Spring Boot project service and FastAPI AI service.
- `community-forum/`: Forum backend/frontend.
- `mobile-app-uniapp/`, `android-app/`, `ios-app/`: Mobile clients.
- `signaling-server/`: P2P signaling service.
- `tests/`: Unit, integration, performance, and security tests.
- `docs/`: Architecture, feature, and workflow documentation.

## Build, Test, and Development Commands

- `npm run dev:desktop-vue`: Run the primary desktop app (Electron + Vue).
- `npm run dev:desktop`: Run the legacy desktop app workspace.
- `npm run build:desktop-vue` / `npm run build:desktop`: Production builds.
- `npm run docker:up` / `npm run docker:down`: Start/stop backend services via Docker.
- `npm run setup`: Project setup helper (see `scripts/`).
- `npm run init:db`: Initialize local database.
- `npm run signaling:dev`: Run signaling server in dev mode.

## Coding Style & Naming Conventions

- Formatting: Prettier (`npm run format`) is the source of truth.
- Linting: ESLint (`npm run lint`) with TypeScript + React rules.
- Naming: files `kebab-case`, classes `PascalCase`, variables/functions `camelCase`, constants `UPPER_SNAKE_CASE`.
- JavaScript uses async/await; CommonJS is allowed in some areas.

## Testing Guidelines

- Unit/integration: Jest (`npm run test:jest`) and Vitest coverage (`npm run test:vitest:coverage`).
- E2E: Playwright (`npm run test:e2e`).
- Full suite: `npm run test:all`.
- Coverage targets (from docs): unit 80%+, integration 60%+, E2E on critical flows.
- Naming: `*.test.ts` / `*.spec.ts` and tests under `tests/`.

## Commit & Pull Request Guidelines

- Commit style: Conventional Commits with optional scope, e.g.:
  - `feat(rag): add reranker support`
  - `fix(p2p): resolve connection timeout`
  - `docs(readme): update installation guide`
- Typical types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.
- PRs: create a feature branch (`feature/*`), open a PR on GitHub, fill the PR template, and include test results relevant to changes.

## Security & Configuration Tips

- Use Docker for backend services when possible (`docker-compose up -d`).
- Keep Node.js `>=22.12.0` and npm `>=10.0.0` as specified in `package.json`.

## Recent Test Improvements (2026-02-04)

### Project Management Journey E2E Test
**File**: `tests/e2e/project-management-journey.e2e.test.ts`
**Documentation**: `tests/e2e/PROJECT_MANAGEMENT_JOURNEY_TEST.md`

Comprehensive E2E test covering complete project management lifecycle:

**Test Coverage** (33 tests across 8 phases):
1. **Organization & Team Setup**: Team creation, member management, permission grants
2. **Project Creation**: Project initialization, metadata updates, deliverable files
3. **Task Board Creation**: Scrum board setup, columns (Todo/In Progress/Done), labels
4. **Task Management**: Task CRUD, assignments, priorities, checklists, comments
5. **Sprint Management**: Sprint creation, task assignments, sprint execution, completion
6. **Reports & Analytics**: Team reports, board analytics, data exports
7. **Project Delivery**: Stats tracking, file exports, sharing, status updates
8. **Cleanup & Verification**: Final state validation

**IPC Channels Tested** (30+ handlers):
- Team Management: `team:create-team`, `team:add-member`, `team:get-team-members`
- Permissions: `perm:grant-permission`
- Task Boards: `task:create-board`, `task:create-column`, `task:create-label`
- Tasks: `task:create-task`, `task:assign-task`, `task:move-task`, `task:update-task`
- Sprints: `task:create-sprint`, `task:start-sprint`, `task:complete-sprint`
- Reports: `task:create-report`, `task:get-board-analytics`, `task:export-board`
- Projects: `project:create-quick`, `project:update`, `project:export-file`, `project:shareProject`

**Run Command**:
```bash
npx playwright test tests/e2e/project-management-journey.e2e.test.ts
```

**Key Features Validated**:
- ✅ Permission Engine (RBAC) integration
- ✅ Team hierarchy and membership
- ✅ Task board workflows (Kanban/Scrum)
- ✅ Sprint planning and execution
- ✅ Project lifecycle (planning → active → delivered)
- ✅ Export and sharing capabilities

**Test Data**: Uses unique identifiers with timestamps to prevent conflicts
**Expected Duration**: ~60-90 seconds for full suite
**Status**: ✅ Production Ready

### Comprehensive Test Suite Expansion

**Overview**: Extended test coverage with 4 major E2E test suites totaling **98+ test cases**

#### Test Suites Added

**1. Approval Workflow Journey** (20+ tests)
- File: `tests/e2e/approval-workflow-journey.e2e.test.ts`
- Duration: ~30-45 seconds
- Coverage: Sequential, Parallel, Any-One approval workflows
- Features: Multi-step approvals, permission delegation, timeout handling
- IPC Handlers: 8+ approval workflow handlers

**2. Error Scenarios** (30+ tests)
- File: `tests/e2e/error-scenarios.e2e.test.ts`
- Duration: ~20-30 seconds
- Coverage: Invalid inputs, resource not found, permission denied, constraint violations
- Features: Boundary conditions, concurrent modifications, data type errors
- Validates: Error handling, validation, graceful degradation

**3. Performance & Stress Tests** (15+ tests)
- File: `tests/e2e/performance-stress.e2e.test.ts`
- Duration: ~90-120 seconds
- Coverage: Bulk operations (100+ tasks, 50+ members), concurrent operations
- Benchmarks: Task creation <600ms, query <5s, bulk updates <30s
- Features: Load testing, scalability validation, memory leak detection

#### Test Infrastructure

**Test Runners**:
- `run-pm-journey-test.sh/.bat` - Single journey test runner
- `run-all-pm-tests.sh/.bat` - Complete suite runner (all 4 suites)

**Documentation**:
- `PROJECT_MANAGEMENT_JOURNEY_TEST.md` - Journey test guide (276 lines)
- `PM_JOURNEY_TEST_SUMMARY.md` - Implementation summary (431 lines)
- `PM_JOURNEY_QUICK_REF.md` - Quick reference (159 lines)
- `COMPREHENSIVE_TEST_SUITE.md` - Complete suite documentation (500+ lines)

**Total Test Metrics**:
- Test Suites: 4
- Individual Tests: ~98+
- IPC Handlers Tested: 100+
- Modules Covered: 5 (Permission, Task, Team, Approval, Project)
- Database Tables: 15+
- Total LOC (Tests): ~3,500 lines
- Documentation: ~2,500 lines

**Run All Tests**:
```bash
# Linux/macOS
./tests/e2e/run-all-pm-tests.sh

# Windows
tests\e2e\run-all-pm-tests.bat
```

**Coverage Summary**:
- Permission System: ✅ 100% (28 handlers)
- Task Management: ✅ 95%+ (49 handlers)
- Team Management: ✅ 100% (8 handlers)
- Approval Workflows: ✅ 100% (8 handlers)
- Project Management: ✅ 90%+ (10+ handlers)

**Performance Benchmarks**:
- Bulk task creation (100 tasks): < 60s
- Task query (100+ tasks): < 5s
- Large team management (50 members): < 40s
- Concurrent operations (10-20 parallel): < 5s
- Board export (100+ tasks): < 10s
- Analytics generation: < 15s

**Status**: ✅ Production Ready | **Last Updated**: 2026-02-04
