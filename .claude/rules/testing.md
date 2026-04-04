---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/tests/**"
  - "**/__tests__/**"
---

# Testing Rules

## Test Commands

```bash
# Desktop
cd desktop-app-vue
npm run test:db            # Database tests
npm run test:ukey          # U-Key hardware tests
npm run test:unit          # All unit tests (Vitest)
npm run test:security      # Security tests (OWASP)
npm run test:integration   # Frontend-backend integration
npm run test:e2e           # End-to-end tests

# CLI
cd packages/cli
npm test                   # All tests (5200+)

# Backend
cd backend/project-service && mvn test
cd backend/ai-service && pytest
```

## OOM Prevention

Run max 3 test files at once to avoid OOM:
```bash
npx vitest run file1 file2 file3
```

## Vitest Mocking Rules (CJS modules)

- `vi.mock("fs")` / `vi.spyOn(fs, ...)` FAILS in Vitest forks pool for Node built-ins
- Use `_deps` injection pattern for CJS source files (see cli-dev.md)
- `vi.mock("../../../utils/logger.js")` works for project modules
- Replace `jest.fn(` with `vi.fn(` when migrating from Jest

## MockK + Robolectric (Android)

- `mockkStatic(File::class)` does NOT mock constructors — use `mockkConstructor(File::class)`
- Always `unmockkConstructor` in `@After`
- `StandardTestDispatcher` requires `advanceUntilIdle()`
- Robolectric 4.11 supports max SDK 34

## Test File Import Style

Follow the same import style as the file being tested:
- Main process `.js` → CommonJS
- Renderer `.ts`/`.vue` → ES6 imports
