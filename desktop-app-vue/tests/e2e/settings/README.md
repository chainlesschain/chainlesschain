# Settings Module E2E Tests

This directory contains E2E tests for all Settings-related pages in the ChainlessChain desktop application.

## Test Files

| File | Route | Description | Tests |
|------|-------|-------------|-------|
| `general-settings.e2e.test.ts` | `/settings` | General application settings | 4 |
| `system-settings.e2e.test.ts` | `/settings/system` | System configuration | 4 |
| `plugin-settings.e2e.test.ts` | `/settings/plugins` | Plugin management | 4 |
| `database-security.e2e.test.ts` | `/settings/database-security` | Database security settings | 4 |
| `tool-settings.e2e.test.ts` | `/settings/tools` | MCP tool management | 4 |
| `voice-input.e2e.test.ts` | `/settings/voice-input` | Voice input testing | 4 |
| `external-devices.e2e.test.ts` | `/external-devices` | External device management | 4 |

**Total:** 7 files, 28 tests

## Running Tests

### Run all Settings tests
```bash
npx playwright test tests/e2e/settings/
```

### Run specific test
```bash
npx playwright test tests/e2e/settings/general-settings.e2e.test.ts
```

## Test Structure

Each test file follows this pattern:
- Test 1: Page navigation verification
- Test 2: Main UI elements display
- Test 3: Feature-specific interactions
- Test 4: Page load validation

## Related Documentation

- Parent: `tests/e2e/SETTINGS_MONITORING_TESTS_SUMMARY.md`
- Helpers: `tests/e2e/helpers/common.ts`
