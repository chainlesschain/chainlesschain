/**
 * Import IPC 单元测试
 *
 * 测试文件导入系统的 IPC 通信处理
 * 覆盖所有导入相关的 IPC handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import after mocks
const { registerImportIPC } = require('../../../src/main/import/import-ipc');

// ===================== MOCK FACTORIES =====================

/**
 * 创建 ipcMain mock
 */
const createMockIpcMain = () => {
  const handlers = new Map();

  return {
    handle: vi.fn((channel, handler) => {
      handlers.set(channel, handler);
    }),
    // Helper method to get registered handler
    getHandler: (channel) => handlers.get(channel),
    // Helper to simulate IPC call
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return handler({}, ...args);
    },
  };
};

/**
 * 创建 dialog mock
 */
const createMockDialog = () => ({
  showOpenDialog: vi.fn().mockResolvedValue({
    canceled: false,
    filePaths: ['/path/to/test.md'],
  }),
});

/**
 * 创建 mainWindow mock
 */
const createMockMainWindow = () => ({
  webContents: {
    send: vi.fn(),
  },
});

/**
 * 创建 FileImporter mock
 */
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
    importFile: vi.fn().mockResolvedValue({
      id: 'note-123',
      title: 'Test Note',
      content: 'Test content',
      filePath: '/path/to/test.md',
    }),
    importFiles: vi.fn().mockResolvedValue({
      success: [
        { filePath: '/path/to/file1.md', result: { id: 'note-1' } },
        { filePath: '/path/to/file2.md', result: { id: 'note-2' } },
      ],
      failed: [],
      total: 2,
    }),
    getSupportedFormats: vi.fn().mockReturnValue(['.md', '.markdown', '.pdf', '.doc', '.docx', '.txt']),
    isSupportedFile: vi.fn().mockReturnValue(true),
    getFileType: vi.fn().mockReturnValue('markdown'),
    _eventHandlers: eventHandlers, // Expose for testing
  };
};

/**
 * 创建 database mock
 */
const createMockDatabase = () => ({
  getKnowledgeItemById: vi.fn().mockReturnValue({
    id: 'note-123',
    title: 'Test Note',
    content: 'Test content',
  }),
});

/**
 * 创建 ragManager mock
 */
const createMockRagManager = () => ({
  addToIndex: vi.fn().mockResolvedValue(true),
  rebuildIndex: vi.fn().mockResolvedValue(true),
});

// Mock electron module
vi.mock('electron', () => ({
  ipcMain: createMockIpcMain(),
  dialog: createMockDialog(),
}));

// ===================== TESTS =====================

describe('ImportIPC', () => {
  let mockIpcMain;
  let mockDialog;
  let mockMainWindow;
  let mockFileImporter;
  let mockDatabase;
  let mockRagManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Get mocked modules
    const { ipcMain, dialog } = require('electron');
    mockIpcMain = ipcMain;
    mockDialog = dialog;

    // Reset ipcMain
    mockIpcMain.handle.mockClear();
    const handlers = new Map();
    mockIpcMain.handle.mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    mockIpcMain.getHandler = (channel) => handlers.get(channel);
    mockIpcMain.invoke = async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return handler({}, ...args);
    };

    mockMainWindow = createMockMainWindow();
    mockFileImporter = createMockFileImporter();
    mockDatabase = createMockDatabase();
    mockRagManager = createMockRagManager();
  });

  describe('registerImportIPC()', () => {
    it('should register all IPC handlers', () => {
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });

      expect(mockIpcMain.handle).toHaveBeenCalled();
      // Should register 5 handlers
      expect(mockIpcMain.handle.mock.calls.length).toBe(5);
    });

    it('should register file selection handlers', () => {
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });

      expect(mockIpcMain.getHandler('import:select-files')).toBeDefined();
      expect(mockIpcMain.getHandler('import:import-file')).toBeDefined();
      expect(mockIpcMain.getHandler('import:import-files')).toBeDefined();
    });

    it('should register format check handlers', () => {
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });

      expect(mockIpcMain.getHandler('import:get-supported-formats')).toBeDefined();
      expect(mockIpcMain.getHandler('import:check-file')).toBeDefined();
    });
  });

  describe('import:select-files', () => {
    beforeEach(() => {
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });
    });

    it('should open file selection dialog', async () => {
      const result = await mockIpcMain.invoke('import:select-files');

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

    it('should handle dialog cancellation', async () => {
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: true });

      const result = await mockIpcMain.invoke('import:select-files');

      expect(result.canceled).toBe(true);
    });

    it('should support multiple file types', async () => {
      await mockIpcMain.invoke('import:select-files');

      const callArgs = mockDialog.showOpenDialog.mock.calls[0][1];
      expect(callArgs.filters).toEqual([
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word', extensions: ['doc', 'docx'] },
        { name: 'Text', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ]);
    });

    it('should throw error when fileImporter is not initialized', async () => {
      // Re-register without fileImporter
      const mockIpcMainNoImporter = createMockIpcMain();
      vi.doMock('electron', () => ({
        ipcMain: mockIpcMainNoImporter,
        dialog: mockDialog,
      }));

      registerImportIPC({
        fileImporter: null,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });

      await expect(mockIpcMainNoImporter.invoke('import:select-files')).rejects.toThrow('文件导入器未初始化');
    });
  });

  describe('import:import-file', () => {
    beforeEach(() => {
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });
    });

    it('should import a single file successfully', async () => {
      const filePath = '/path/to/test.md';
      const options = { extractMetadata: true };

      const result = await mockIpcMain.invoke('import:import-file', filePath, options);

      expect(mockFileImporter.importFile).toHaveBeenCalledWith(filePath, options);
      expect(result.id).toBe('note-123');
      expect(result.title).toBe('Test Note');
    });

    it('should register event listeners for import progress', async () => {
      await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

      expect(mockFileImporter.on).toHaveBeenCalledWith('import-start', expect.any(Function));
      expect(mockFileImporter.on).toHaveBeenCalledWith('import-success', expect.any(Function));
      expect(mockFileImporter.on).toHaveBeenCalledWith('import-error', expect.any(Function));
    });

    it('should send import-start event to renderer', async () => {
      await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

      // Simulate import-start event
      mockFileImporter.emit('import-start', { filePath: '/path/to/test.md', fileType: 'markdown' });

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('import:start', {
        filePath: '/path/to/test.md',
        fileType: 'markdown',
      });
    });

    it('should send import-success event to renderer', async () => {
      await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

      // Simulate import-success event
      mockFileImporter.emit('import-success', {
        filePath: '/path/to/test.md',
        result: { id: 'note-123' },
      });

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('import:success', {
        filePath: '/path/to/test.md',
        result: { id: 'note-123' },
      });
    });

    it('should send import-error event to renderer', async () => {
      await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

      // Simulate import-error event
      const error = new Error('Import failed');
      mockFileImporter.emit('import-error', {
        filePath: '/path/to/test.md',
        error,
      });

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('import:error', {
        filePath: '/path/to/test.md',
        error,
      });
    });

    it('should add imported item to RAG index', async () => {
      const result = await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

      expect(mockDatabase.getKnowledgeItemById).toHaveBeenCalledWith('note-123');
      expect(mockRagManager.addToIndex).toHaveBeenCalledWith({
        id: 'note-123',
        title: 'Test Note',
        content: 'Test content',
      });
    });

    it('should not add to RAG index if ragManager is not provided', async () => {
      // Re-register without ragManager
      const mockIpcMainNoRag = createMockIpcMain();
      vi.doMock('electron', () => ({
        ipcMain: mockIpcMainNoRag,
        dialog: mockDialog,
      }));

      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: null,
      });

      await mockIpcMainNoRag.invoke('import:import-file', '/path/to/test.md', {});

      expect(mockRagManager.addToIndex).not.toHaveBeenCalled();
    });

    it('should not add to RAG index if database is not provided', async () => {
      // Re-register without database
      const mockIpcMainNoDb = createMockIpcMain();
      vi.doMock('electron', () => ({
        ipcMain: mockIpcMainNoDb,
        dialog: mockDialog,
      }));

      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: null,
        ragManager: mockRagManager,
      });

      await mockIpcMainNoDb.invoke('import:import-file', '/path/to/test.md', {});

      expect(mockRagManager.addToIndex).not.toHaveBeenCalled();
    });

    it('should not add to RAG index if item not found in database', async () => {
      mockDatabase.getKnowledgeItemById.mockReturnValueOnce(null);

      await mockIpcMain.invoke('import:import-file', '/path/to/test.md', {});

      expect(mockRagManager.addToIndex).not.toHaveBeenCalled();
    });

    it('should throw error when fileImporter is not initialized', async () => {
      const mockIpcMainNoImporter = createMockIpcMain();
      registerImportIPC({
        fileImporter: null,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });

      await expect(
        mockIpcMainNoImporter.invoke('import:import-file', '/path/to/test.md', {})
      ).rejects.toThrow('文件导入器未初始化');
    });

    it('should propagate import errors', async () => {
      const error = new Error('Import failed');
      mockFileImporter.importFile.mockRejectedValueOnce(error);

      await expect(mockIpcMain.invoke('import:import-file', '/path/to/test.md', {})).rejects.toThrow(
        'Import failed'
      );
    });
  });

  describe('import:import-files', () => {
    beforeEach(() => {
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });
    });

    it('should import multiple files successfully', async () => {
      const filePaths = ['/path/to/file1.md', '/path/to/file2.md'];
      const options = { extractMetadata: true };

      const result = await mockIpcMain.invoke('import:import-files', filePaths, options);

      expect(mockFileImporter.importFiles).toHaveBeenCalledWith(filePaths, options);
      expect(result.success).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(result.total).toBe(2);
    });

    it('should register event listeners for batch import progress', async () => {
      await mockIpcMain.invoke('import:import-files', ['/path/to/file1.md'], {});

      expect(mockFileImporter.on).toHaveBeenCalledWith('import-progress', expect.any(Function));
      expect(mockFileImporter.on).toHaveBeenCalledWith('import-complete', expect.any(Function));
    });

    it('should send import-progress event to renderer', async () => {
      await mockIpcMain.invoke('import:import-files', ['/path/to/file1.md', '/path/to/file2.md'], {});

      // Simulate import-progress event
      mockFileImporter.emit('import-progress', {
        current: 1,
        total: 2,
        percentage: 50,
      });

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('import:progress', {
        current: 1,
        total: 2,
        percentage: 50,
      });
    });

    it('should send import-complete event to renderer', async () => {
      await mockIpcMain.invoke('import:import-files', ['/path/to/file1.md'], {});

      // Simulate import-complete event
      mockFileImporter.emit('import-complete', {
        success: 1,
        failed: 0,
        total: 1,
      });

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('import:complete', {
        success: 1,
        failed: 0,
        total: 1,
      });
    });

    it('should rebuild RAG index after successful batch import', async () => {
      const result = await mockIpcMain.invoke('import:import-files', ['/path/to/file1.md'], {});

      expect(mockRagManager.rebuildIndex).toHaveBeenCalled();
    });

    it('should not rebuild RAG index if no files were successfully imported', async () => {
      mockFileImporter.importFiles.mockResolvedValueOnce({
        success: [],
        failed: [{ filePath: '/path/to/file1.md', error: 'Failed' }],
        total: 1,
      });

      await mockIpcMain.invoke('import:import-files', ['/path/to/file1.md'], {});

      expect(mockRagManager.rebuildIndex).not.toHaveBeenCalled();
    });

    it('should not rebuild RAG index if ragManager is not provided', async () => {
      const mockIpcMainNoRag = createMockIpcMain();
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: null,
      });

      await mockIpcMainNoRag.invoke('import:import-files', ['/path/to/file1.md'], {});

      expect(mockRagManager.rebuildIndex).not.toHaveBeenCalled();
    });

    it('should throw error when fileImporter is not initialized', async () => {
      const mockIpcMainNoImporter = createMockIpcMain();
      registerImportIPC({
        fileImporter: null,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });

      await expect(
        mockIpcMainNoImporter.invoke('import:import-files', ['/path/to/file1.md'], {})
      ).rejects.toThrow('文件导入器未初始化');
    });

    it('should handle partial import failures', async () => {
      mockFileImporter.importFiles.mockResolvedValueOnce({
        success: [{ filePath: '/path/to/file1.md', result: { id: 'note-1' } }],
        failed: [{ filePath: '/path/to/file2.md', error: 'Import failed' }],
        total: 2,
      });

      const result = await mockIpcMain.invoke('import:import-files', [
        '/path/to/file1.md',
        '/path/to/file2.md',
      ]);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(mockRagManager.rebuildIndex).toHaveBeenCalled(); // Still rebuild for successful imports
    });

    it('should propagate import errors', async () => {
      const error = new Error('Batch import failed');
      mockFileImporter.importFiles.mockRejectedValueOnce(error);

      await expect(
        mockIpcMain.invoke('import:import-files', ['/path/to/file1.md'], {})
      ).rejects.toThrow('Batch import failed');
    });
  });

  describe('import:get-supported-formats', () => {
    beforeEach(() => {
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });
    });

    it('should return supported file formats', async () => {
      const result = await mockIpcMain.invoke('import:get-supported-formats');

      expect(mockFileImporter.getSupportedFormats).toHaveBeenCalled();
      expect(result).toEqual(['.md', '.markdown', '.pdf', '.doc', '.docx', '.txt']);
    });

    it('should throw error when fileImporter is not initialized', async () => {
      const mockIpcMainNoImporter = createMockIpcMain();
      registerImportIPC({
        fileImporter: null,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });

      await expect(mockIpcMainNoImporter.invoke('import:get-supported-formats')).rejects.toThrow(
        '文件导入器未初始化'
      );
    });

    it('should propagate getSupportedFormats errors', async () => {
      const error = new Error('Failed to get formats');
      mockFileImporter.getSupportedFormats.mockImplementationOnce(() => {
        throw error;
      });

      await expect(mockIpcMain.invoke('import:get-supported-formats')).rejects.toThrow(
        'Failed to get formats'
      );
    });
  });

  describe('import:check-file', () => {
    beforeEach(() => {
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });
    });

    it('should check if file is supported', async () => {
      const filePath = '/path/to/test.md';

      const result = await mockIpcMain.invoke('import:check-file', filePath);

      expect(mockFileImporter.isSupportedFile).toHaveBeenCalledWith(filePath);
      expect(mockFileImporter.getFileType).toHaveBeenCalledWith(filePath);
      expect(result.isSupported).toBe(true);
      expect(result.fileType).toBe('markdown');
    });

    it('should return false for unsupported files', async () => {
      mockFileImporter.isSupportedFile.mockReturnValueOnce(false);
      mockFileImporter.getFileType.mockReturnValueOnce(null);

      const result = await mockIpcMain.invoke('import:check-file', '/path/to/unsupported.xyz');

      expect(result.isSupported).toBe(false);
      expect(result.fileType).toBeNull();
    });

    it('should identify different file types', async () => {
      const testCases = [
        { filePath: '/path/to/test.md', fileType: 'markdown' },
        { filePath: '/path/to/test.pdf', fileType: 'pdf' },
        { filePath: '/path/to/test.docx', fileType: 'word' },
        { filePath: '/path/to/test.txt', fileType: 'text' },
      ];

      for (const testCase of testCases) {
        mockFileImporter.getFileType.mockReturnValueOnce(testCase.fileType);

        const result = await mockIpcMain.invoke('import:check-file', testCase.filePath);

        expect(result.fileType).toBe(testCase.fileType);
      }
    });

    it('should throw error when fileImporter is not initialized', async () => {
      const mockIpcMainNoImporter = createMockIpcMain();
      registerImportIPC({
        fileImporter: null,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });

      await expect(
        mockIpcMainNoImporter.invoke('import:check-file', '/path/to/test.md')
      ).rejects.toThrow('文件导入器未初始化');
    });

    it('should propagate check errors', async () => {
      const error = new Error('File check failed');
      mockFileImporter.isSupportedFile.mockImplementationOnce(() => {
        throw error;
      });

      await expect(mockIpcMain.invoke('import:check-file', '/path/to/test.md')).rejects.toThrow(
        'File check failed'
      );
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });
    });

    it('should handle async errors in import:import-file', async () => {
      mockFileImporter.importFile.mockRejectedValueOnce(new Error('File not found'));

      await expect(mockIpcMain.invoke('import:import-file', '/nonexistent.md', {})).rejects.toThrow(
        'File not found'
      );
    });

    it('should handle async errors in import:import-files', async () => {
      mockFileImporter.importFiles.mockRejectedValueOnce(new Error('Permission denied'));

      await expect(mockIpcMain.invoke('import:import-files', ['/protected.md'], {})).rejects.toThrow(
        'Permission denied'
      );
    });

    it('should handle RAG index errors gracefully', async () => {
      mockRagManager.addToIndex.mockRejectedValueOnce(new Error('Index failed'));

      // Should not throw - RAG errors should be caught
      await expect(mockIpcMain.invoke('import:import-file', '/path/to/test.md', {})).rejects.toThrow();
    });

    it('should handle mainWindow being null', async () => {
      const mockIpcMainNoWindow = createMockIpcMain();
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: null,
        database: mockDatabase,
        ragManager: mockRagManager,
      });

      // Should not throw even if mainWindow is null
      await mockIpcMainNoWindow.invoke('import:import-file', '/path/to/test.md', {});

      // Events should not be sent
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('Event Handling', () => {
    beforeEach(() => {
      registerImportIPC({
        fileImporter: mockFileImporter,
        mainWindow: mockMainWindow,
        database: mockDatabase,
        ragManager: mockRagManager,
      });
    });

    it('should handle multiple simultaneous imports', async () => {
      const promise1 = mockIpcMain.invoke('import:import-file', '/path/to/file1.md', {});
      const promise2 = mockIpcMain.invoke('import:import-file', '/path/to/file2.md', {});

      await Promise.all([promise1, promise2]);

      expect(mockFileImporter.importFile).toHaveBeenCalledTimes(2);
    });

    it('should handle event listeners being registered multiple times', async () => {
      // Import twice
      await mockIpcMain.invoke('import:import-file', '/path/to/file1.md', {});
      await mockIpcMain.invoke('import:import-file', '/path/to/file2.md', {});

      // Event listeners should be registered each time
      expect(mockFileImporter.on).toHaveBeenCalledTimes(6); // 3 events × 2 calls
    });
  });
});
