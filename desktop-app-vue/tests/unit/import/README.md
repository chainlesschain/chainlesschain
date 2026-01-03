# Import IPC Unit Tests

## Overview

This directory contains unit tests for the file import IPC system in ChainlessChain desktop application.

## Test Files

### import-ipc.test.js

Comprehensive unit tests for `src/main/import/import-ipc.js` covering all IPC handlers for the file import functionality.

**Test Coverage:**
- ✅ IPC handler registration (5 handlers)
- ✅ File selection dialog (`import:select-files`)
- ✅ Single file import (`import:import-file`)
- ✅ Batch file import (`import:import-files`)
- ✅ Supported formats query (`import:get-supported-formats`)
- ✅ File format validation (`import:check-file`)
- ✅ Event emission and handling
- ✅ RAG index synchronization
- ✅ Error handling for all scenarios
- ✅ Edge cases (null dependencies, missing items, etc.)

## Test Structure

### Mock Factories

The test file includes comprehensive mock factories for:

1. **createMockIpcMain()** - Mocks Electron's IPC main process with helper methods to simulate IPC calls
2. **createMockDialog()** - Mocks Electron's file dialog for file selection
3. **createMockMainWindow()** - Mocks main window with webContents for event emission
4. **createMockFileImporter()** - Mocks FileImporter class with all methods and event handling
5. **createMockDatabase()** - Mocks database operations
6. **createMockRagManager()** - Mocks RAG (Retrieval-Augmented Generation) index manager

### Test Suites

#### 1. registerImportIPC()
Tests that all IPC handlers are properly registered:
- Verifies 5 handlers are registered
- Checks specific handler existence
- Validates handler types (file selection, format check)

#### 2. import:select-files
Tests file selection dialog functionality:
- ✅ Opens dialog with correct configuration
- ✅ Returns selected file paths
- ✅ Handles dialog cancellation
- ✅ Supports multiple file formats (MD, PDF, Word, TXT)
- ✅ Error handling for uninitialized importer

#### 3. import:import-file
Tests single file import:
- ✅ Imports file with options
- ✅ Registers event listeners (import-start, import-success, import-error)
- ✅ Sends progress events to renderer process
- ✅ Adds imported item to RAG index
- ✅ Handles missing dependencies gracefully
- ✅ Propagates import errors
- ✅ Event listener registration and emission

**Event Flow:**
```
import:import-file → FileImporter.importFile()
                  ↓
          emit('import-start') → mainWindow.send('import:start')
                  ↓
          emit('import-success') → mainWindow.send('import:success')
                  ↓
          database.getKnowledgeItemById()
                  ↓
          ragManager.addToIndex()
```

#### 4. import:import-files
Tests batch file import:
- ✅ Imports multiple files
- ✅ Returns success/failed statistics
- ✅ Sends batch progress events
- ✅ Rebuilds RAG index after successful imports
- ✅ Handles partial failures (some succeed, some fail)
- ✅ Skips RAG rebuild if no successful imports
- ✅ Error handling and propagation

**Event Flow:**
```
import:import-files → FileImporter.importFiles()
                   ↓
          emit('import-progress') → mainWindow.send('import:progress')
                   ↓
          emit('import-complete') → mainWindow.send('import:complete')
                   ↓
          ragManager.rebuildIndex() (if success.length > 0)
```

#### 5. import:get-supported-formats
Tests supported formats query:
- ✅ Returns list of supported file extensions
- ✅ Error handling for uninitialized importer
- ✅ Propagates errors from FileImporter

**Expected Return:**
```javascript
['.md', '.markdown', '.pdf', '.doc', '.docx', '.txt']
```

#### 6. import:check-file
Tests file format validation:
- ✅ Checks if file is supported
- ✅ Identifies file type
- ✅ Returns false for unsupported files
- ✅ Tests different file types (markdown, pdf, word, text)
- ✅ Error handling and propagation

**Expected Return:**
```javascript
{
  isSupported: true,
  fileType: 'markdown' // or 'pdf', 'word', 'text'
}
```

#### 7. Error Handling
Comprehensive error scenarios:
- ✅ Async errors in import:import-file
- ✅ Async errors in import:import-files
- ✅ RAG index errors (caught gracefully)
- ✅ Null mainWindow handling
- ✅ Uninitialized fileImporter errors

#### 8. Event Handling
Tests event system robustness:
- ✅ Multiple simultaneous imports
- ✅ Event listeners registered multiple times
- ✅ Event emission to renderer process

## Running Tests

### Run all import tests
```bash
npm test -- tests/unit/import/
```

### Run specific test file
```bash
npm test -- tests/unit/import/import-ipc.test.js
```

### Run with watch mode
```bash
npm run test:watch tests/unit/import/import-ipc.test.js
```

### Run with UI
```bash
npm run test:ui
```

## Test Coverage Goals

- **Line Coverage:** 100%
- **Branch Coverage:** 100%
- **Function Coverage:** 100%
- **Statement Coverage:** 100%

## Key Testing Patterns

### 1. Mock Factory Pattern
```javascript
const createMockFileImporter = () => {
  const eventHandlers = new Map();
  return {
    on: vi.fn((event, handler) => {
      eventHandlers.set(event, handler);
    }),
    emit: (event, data) => {
      const handler = eventHandlers.get(event);
      if (handler) handler(data);
    },
    // ... other methods
  };
};
```

### 2. IPC Handler Testing Pattern
```javascript
it('should handle import:select-files', async () => {
  registerImportIPC({ fileImporter, mainWindow, database, ragManager });

  const result = await mockIpcMain.invoke('import:select-files');

  expect(result.canceled).toBe(false);
  expect(result.filePaths).toBeDefined();
});
```

### 3. Event Emission Testing Pattern
```javascript
it('should send import-start event to renderer', async () => {
  await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

  mockFileImporter.emit('import-start', { filePath: '/path/to/test.md' });

  expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('import:start',
    expect.objectContaining({ filePath: '/path/to/test.md' })
  );
});
```

## Dependencies

### Testing Framework
- **Vitest** - Fast unit test framework with Vite integration
- **@vitest/ui** - Optional UI for test visualization

### Mocking
- **vi.fn()** - Vitest mock function factory
- **vi.mock()** - Module mocking
- **vi.clearAllMocks()** - Reset all mocks between tests

## Related Files

- **Source:** `src/main/import/import-ipc.js`
- **FileImporter:** `src/main/import/file-importer.js`
- **Database:** `src/main/database.js`
- **RAG Manager:** `src/main/rag/rag-manager.js`

## Contributing

When adding new IPC handlers to `import-ipc.js`:

1. Add corresponding test cases in `import-ipc.test.js`
2. Follow the existing test structure
3. Test both success and failure scenarios
4. Test with and without optional dependencies
5. Ensure 100% code coverage
6. Update this README with new test coverage

## Test Checklist

For each IPC handler, ensure tests cover:

- [ ] Handler is registered correctly
- [ ] Success scenario with valid inputs
- [ ] Error scenario with invalid inputs
- [ ] Uninitialized dependencies (null/undefined)
- [ ] Event emission (if applicable)
- [ ] Database operations (if applicable)
- [ ] RAG index synchronization (if applicable)
- [ ] Error propagation
- [ ] Edge cases (empty arrays, null values, etc.)

## Maintenance Notes

- Tests use Vitest (not Jest) as per project configuration
- All mocks are created using factory functions for consistency
- Event handling is tested using the internal event emitter pattern
- RAG index operations are mocked to avoid external dependencies
- Database operations are mocked to avoid file system dependencies
