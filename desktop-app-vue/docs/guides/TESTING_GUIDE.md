# Testing Guide for ChainlessChain Desktop App

## Database Testing Issues & Solutions

### Issue: Native Module Compilation

The desktop app uses native modules (`better-sqlite3`, `better-sqlite3-multiple-ciphers`) that require compilation on Windows. This requires **Visual Studio Build Tools**.

#### Error Symptoms:
```
gyp ERR! find VS Could not find any Visual Studio installation to use
Cannot find module 'better-sqlite3'
Cannot find module 'better-sqlite3-multiple-ciphers'
```

### Solutions

#### Option 1: Install Visual Studio Build Tools (Recommended for Development)

1. Download and install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
2. During installation, select "Desktop development with C++"
3. Run `npm install` in the `desktop-app-vue` directory
4. Run tests: `npm run test:db`

#### Option 2: Use Prebuilt Binaries

```bash
cd desktop-app-vue
npm install --force
```

The `--force` flag may help npm download prebuilt binaries instead of compiling.

#### Option 3: Test in Electron Environment (Easiest)

Since the app is designed to run in Electron, test directly in the app:

```bash
cd desktop-app-vue
npm run dev
```

Then open DevTools (Ctrl+Shift+I) and run database tests in the console:

```javascript
// Test database operations
const db = window.electronAPI.database;

// Add a test note
await db.addKnowledgeItem({
  title: 'Test Note',
  type: 'note',
  content: 'This is a test'
});

// Query all items
const items = await db.getKnowledgeItems();
console.log('Items:', items);
```

#### Option 4: Use Docker (For CI/CD)

Create a Docker container with all build tools:

```dockerfile
FROM node:20-bullseye
RUN apt-get update && apt-get install -y python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "test"]
```

### Running Tests

#### Unit Tests (Vitest)
```bash
npm run test              # Run all tests
npm run test:watch        # Watch mode
npm run test:ui           # UI mode
npm run test:coverage     # With coverage
```

#### Integration Tests
```bash
npm run test:integration
```

#### E2E Tests (Playwright)
```bash
npm run test:e2e
npm run test:e2e:ui       # UI mode
```

#### Database Tests
```bash
npm run test:db           # Requires native modules
```

#### U-Key Tests
```bash
npm run test:ukey         # Windows only
```

### Test Status

Current test pass rate: **66.3%** (31 failing out of 94 test files)

#### Known Issues:
1. **Native module compilation** - Requires Visual Studio Build Tools
2. **Jest/Vitest compatibility** - Some tests use Jest syntax
3. **LLM Manager initialization** - Mock issues in test environment
4. **IPC registration** - Recently fixed

### Fixing Failing Tests

Run the auto-fix script to attempt automatic fixes:

```bash
npm run test:auto-fix
```

Or run the test runner to see detailed results:

```bash
npm run test:runner
```

### Best Practices

1. **Always test in Electron environment** for database and IPC features
2. **Use mocks** for external services (LLM, vector DB, etc.)
3. **Isolate tests** - Each test should be independent
4. **Clean up** - Close database connections, clear temp files
5. **Use test fixtures** - Prepare test data in advance

### Continuous Integration

For CI/CD pipelines, use the Docker approach or install build tools in the CI environment:

**GitHub Actions Example:**
```yaml
- name: Setup Node.js
  uses: actions/setup-node@v3
  with:
    node-version: '20'

- name: Install dependencies (Windows)
  if: runner.os == 'Windows'
  run: |
    npm install --global windows-build-tools
    npm install

- name: Run tests
  run: npm test
```

### Troubleshooting

#### "Cannot find module 'electron'"
- Run tests in Electron environment: `npm run dev`
- Or mock Electron modules in test setup

#### "Database locked"
- Close all database connections before tests
- Use separate test database: `chainlesschain-test.db`

#### "WASM file not found" (sql.js)
- Ensure sql.js is installed: `npm install sql.js`
- Check WASM file location in `node_modules/sql.js/dist/`

#### "U-Key not available"
- U-Key only works on Windows
- Use simulation mode for testing: Set `UKEY_SIMULATION=true`

### Performance Testing

```bash
npm run perf:benchmark    # Run performance benchmarks
npm run perf:report       # View performance report
```

### Health Checks

```bash
npm run test:health       # Run system health checks
```

This will check:
- Database connectivity
- LLM service availability
- Vector database status
- File system permissions
- Network connectivity

---

**Last Updated:** 2026-01-09
**Version:** 0.20.0
