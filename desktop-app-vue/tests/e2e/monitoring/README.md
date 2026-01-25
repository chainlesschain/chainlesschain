# Monitoring Module E2E Tests

This directory contains E2E tests for all Monitoring and Performance-related pages in the ChainlessChain desktop application.

## Test Files

| File | Route | Description | Tests |
|------|-------|-------------|-------|
| `database-performance.e2e.test.ts` | `/database/performance` | Database performance monitoring | 4 |
| `llm-performance.e2e.test.ts` | `/llm/performance` | LLM performance dashboard | 4 |
| `session-manager.e2e.test.ts` | `/sessions` | Session management | 4 |
| `tag-manager.e2e.test.ts` | `/tags` | Tag management | 4 |
| `memory-dashboard.e2e.test.ts` | `/memory` | Memory usage dashboard | 4 |
| `error-monitor.e2e.test.ts` | `/error/monitor` | Error monitoring and diagnostics | 4 |
| `performance-dashboard.e2e.test.ts` | `/performance/dashboard` | System performance dashboard | 4 |
| `sync-conflicts.e2e.test.ts` | `/sync/conflicts` | Sync conflict resolution | 4 |

**Total:** 8 files, 32 tests

## Running Tests

### Run all Monitoring tests
```bash
npx playwright test tests/e2e/monitoring/
```

### Run specific test
```bash
npx playwright test tests/e2e/monitoring/llm-performance.e2e.test.ts
```

## Test Structure

Each test file follows this pattern:
- Test 1: Page navigation verification
- Test 2: Main UI elements display
- Test 3: Feature-specific interactions (charts, metrics, operations)
- Test 4: Page load validation

## Related Features

- LLM Performance: `docs/features/LLM_PERFORMANCE_DASHBOARD.md`
- Session Manager: `docs/features/SESSION_MANAGER.md`
- Error Monitor: `docs/features/ERROR_MONITOR.md`

## Related Documentation

- Parent: `tests/e2e/SETTINGS_MONITORING_TESTS_SUMMARY.md`
- Helpers: `tests/e2e/helpers/common.ts`
