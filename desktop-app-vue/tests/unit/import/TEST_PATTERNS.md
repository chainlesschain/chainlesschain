# Import IPC Test Patterns Quick Reference

This guide provides quick reference patterns for testing IPC handlers in the import system.

## Pattern 1: Testing IPC Handler Registration

```javascript
describe('registerImportIPC()', () => {
  it('should register all IPC handlers', () => {
    registerImportIPC({
      fileImporter: mockFileImporter,
      mainWindow: mockMainWindow,
      database: mockDatabase,
      ragManager: mockRagManager,
    });

    expect(mockIpcMain.handle).toHaveBeenCalled();
    expect(mockIpcMain.handle.mock.calls.length).toBe(5);
  });
});
```

## Pattern 2: Testing IPC Handler Success

```javascript
it('should handle import:import-file successfully', async () => {
  // Arrange
  registerImportIPC({ fileImporter, mainWindow, database, ragManager });
  const filePath = '/path/to/test.md';
  const options = { extractMetadata: true };

  // Act
  const result = await mockIpcMain.invoke('import:import-file', filePath, options);

  // Assert
  expect(mockFileImporter.importFile).toHaveBeenCalledWith(filePath, options);
  expect(result.id).toBe('note-123');
});
```

## Pattern 3: Testing IPC Handler Errors

```javascript
it('should throw error when fileImporter is not initialized', async () => {
  // Arrange
  registerImportIPC({
    fileImporter: null,
    mainWindow: mockMainWindow,
    database: mockDatabase,
    ragManager: mockRagManager,
  });

  // Act & Assert
  await expect(
    mockIpcMain.invoke('import:import-file', '/path/to/test.md', {})
  ).rejects.toThrow('文件导入器未初始化');
});
```

## Pattern 4: Testing Event Emission

```javascript
it('should send import-start event to renderer', async () => {
  // Arrange
  registerImportIPC({ fileImporter, mainWindow, database, ragManager });
  await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

  // Act - Simulate event emission
  mockFileImporter.emit('import-start', {
    filePath: '/path/to/test.md',
    fileType: 'markdown',
  });

  // Assert
  expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('import:start', {
    filePath: '/path/to/test.md',
    fileType: 'markdown',
  });
});
```

## Pattern 5: Testing Event Listeners Registration

```javascript
it('should register event listeners for import progress', async () => {
  // Arrange
  registerImportIPC({ fileImporter, mainWindow, database, ragManager });

  // Act
  await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

  // Assert
  expect(mockFileImporter.on).toHaveBeenCalledWith('import-start', expect.any(Function));
  expect(mockFileImporter.on).toHaveBeenCalledWith('import-success', expect.any(Function));
  expect(mockFileImporter.on).toHaveBeenCalledWith('import-error', expect.any(Function));
});
```

## Pattern 6: Testing RAG Index Operations

```javascript
it('should add imported item to RAG index', async () => {
  // Arrange
  registerImportIPC({ fileImporter, mainWindow, database, ragManager });

  // Act
  await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

  // Assert
  expect(mockDatabase.getKnowledgeItemById).toHaveBeenCalledWith('note-123');
  expect(mockRagManager.addToIndex).toHaveBeenCalledWith({
    id: 'note-123',
    title: 'Test Note',
    content: 'Test content',
  });
});
```

## Pattern 7: Testing Graceful Degradation

```javascript
it('should not add to RAG index if ragManager is not provided', async () => {
  // Arrange
  registerImportIPC({
    fileImporter: mockFileImporter,
    mainWindow: mockMainWindow,
    database: mockDatabase,
    ragManager: null, // Missing dependency
  });

  // Act
  await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

  // Assert
  expect(mockRagManager.addToIndex).not.toHaveBeenCalled();
});
```

## Pattern 8: Testing Batch Operations

```javascript
it('should import multiple files successfully', async () => {
  // Arrange
  registerImportIPC({ fileImporter, mainWindow, database, ragManager });
  const filePaths = ['/path/to/file1.md', '/path/to/file2.md'];
  const options = { extractMetadata: true };

  // Act
  const result = await mockIpcMain.invoke('import:import-files', filePaths, options);

  // Assert
  expect(mockFileImporter.importFiles).toHaveBeenCalledWith(filePaths, options);
  expect(result.success).toHaveLength(2);
  expect(result.failed).toHaveLength(0);
  expect(result.total).toBe(2);
});
```

## Pattern 9: Testing Partial Failures

```javascript
it('should handle partial import failures', async () => {
  // Arrange
  registerImportIPC({ fileImporter, mainWindow, database, ragManager });
  mockFileImporter.importFiles.mockResolvedValueOnce({
    success: [{ filePath: '/file1.md', result: { id: 'note-1' } }],
    failed: [{ filePath: '/file2.md', error: 'Import failed' }],
    total: 2,
  });

  // Act
  const result = await mockIpcMain.invoke('import:import-files', ['/file1.md', '/file2.md']);

  // Assert
  expect(result.success).toHaveLength(1);
  expect(result.failed).toHaveLength(1);
  expect(mockRagManager.rebuildIndex).toHaveBeenCalled(); // Still rebuild for successes
});
```

## Pattern 10: Testing Dialog Interactions

```javascript
it('should open file selection dialog', async () => {
  // Arrange
  registerImportIPC({ fileImporter, mainWindow, database, ragManager });

  // Act
  const result = await mockIpcMain.invoke('import:select-files');

  // Assert
  expect(mockDialog.showOpenDialog).toHaveBeenCalledWith(
    mockMainWindow,
    expect.objectContaining({
      title: '选择要导入的文件',
      properties: expect.arrayContaining(['openFile', 'multiSelections']),
    })
  );
  expect(result.canceled).toBe(false);
  expect(result.filePaths).toEqual(['/path/to/test.md']);
});
```

## Pattern 11: Testing Error Propagation

```javascript
it('should propagate import errors', async () => {
  // Arrange
  registerImportIPC({ fileImporter, mainWindow, database, ragManager });
  const error = new Error('Import failed');
  mockFileImporter.importFile.mockRejectedValueOnce(error);

  // Act & Assert
  await expect(
    mockIpcMain.invoke('import:import-file', '/path/to/test.md', {})
  ).rejects.toThrow('Import failed');
});
```

## Pattern 12: Testing Concurrent Operations

```javascript
it('should handle multiple simultaneous imports', async () => {
  // Arrange
  registerImportIPC({ fileImporter, mainWindow, database, ragManager });

  // Act
  const promise1 = mockIpcMain.invoke('import:import-file', '/file1.md', {});
  const promise2 = mockIpcMain.invoke('import:import-file', '/file2.md', {});
  await Promise.all([promise1, promise2]);

  // Assert
  expect(mockFileImporter.importFile).toHaveBeenCalledTimes(2);
});
```

## Mock Factory Template

```javascript
const createMockFileImporter = () => {
  const eventHandlers = new Map();

  return {
    // Event system
    on: vi.fn((event, handler) => {
      eventHandlers.set(event, handler);
    }),
    emit: (event, data) => {
      const handler = eventHandlers.get(event);
      if (handler) handler(data);
    },

    // Core methods
    importFile: vi.fn().mockResolvedValue({
      id: 'note-123',
      title: 'Test Note',
      content: 'Test content',
    }),
    importFiles: vi.fn().mockResolvedValue({
      success: [{ filePath: '/file1.md', result: { id: 'note-1' } }],
      failed: [],
      total: 1,
    }),

    // Utility methods
    getSupportedFormats: vi.fn().mockReturnValue(['.md', '.pdf', '.docx', '.txt']),
    isSupportedFile: vi.fn().mockReturnValue(true),
    getFileType: vi.fn().mockReturnValue('markdown'),

    // Expose for testing
    _eventHandlers: eventHandlers,
  };
};
```

## Test Structure Template

```javascript
describe('FeatureName', () => {
  let mockDependency1;
  let mockDependency2;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDependency1 = createMockDependency1();
    mockDependency2 = createMockDependency2();
  });

  describe('SpecificFeature', () => {
    it('should handle success scenario', async () => {
      // Arrange
      // Act
      // Assert
    });

    it('should handle error scenario', async () => {
      // Arrange
      // Act
      // Assert
    });

    it('should handle edge case', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

## Common Assertions

### Check Method Called
```javascript
expect(mockObject.method).toHaveBeenCalled();
expect(mockObject.method).toHaveBeenCalledTimes(2);
expect(mockObject.method).toHaveBeenCalledWith('arg1', 'arg2');
```

### Check Return Value
```javascript
expect(result).toBeDefined();
expect(result.success).toBe(true);
expect(result.data).toEqual({ id: '123' });
```

### Check Array Contents
```javascript
expect(array).toHaveLength(3);
expect(array).toContain('item');
expect(array).toEqual(['item1', 'item2']);
```

### Check Object Structure
```javascript
expect(object).toMatchObject({ id: '123' });
expect(object).toHaveProperty('id');
expect(object).toEqual(expect.objectContaining({ id: '123' }));
```

### Check Errors
```javascript
await expect(promise).rejects.toThrow();
await expect(promise).rejects.toThrow('Error message');
await expect(promise).rejects.toThrow(ErrorClass);
```

## Tips and Best Practices

1. **Always reset mocks in beforeEach**
   ```javascript
   beforeEach(() => {
     vi.clearAllMocks();
   });
   ```

2. **Use descriptive test names**
   - Good: `should import file successfully when valid path provided`
   - Bad: `test import`

3. **Test one thing per test**
   - Each test should verify a single behavior

4. **Follow AAA pattern**
   - Arrange (setup)
   - Act (execute)
   - Assert (verify)

5. **Test both success and failure**
   - Always test the happy path and error paths

6. **Mock external dependencies**
   - Don't test real file system, database, etc.

7. **Use factory functions for mocks**
   - Keeps tests DRY and maintainable

8. **Document complex tests**
   - Add comments explaining non-obvious test logic

9. **Keep tests independent**
   - Tests should not depend on each other

10. **Verify side effects**
    - Check events emitted, database updated, etc.
