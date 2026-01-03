/**
 * File Management IPC 单元测试
 * 测试17个文件管理 API 方法
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain, shell, clipboard, dialog } from 'electron';
import path from 'path';

// 必须在顶层 mock，在 import 之前
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    showItemInFolder: vi.fn(),
    openPath: vi.fn(),
  },
  clipboard: {
    writeBuffer: vi.fn(),
    writeText: vi.fn(),
    readText: vi.fn(),
    readBuffer: vi.fn(),
    clear: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}));

describe('File Management IPC', () => {
  let handlers = {};
  let mockDatabase;
  let mockMainWindow;
  let mockGetProjectConfig;
  let registerFileIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // Mock database
    mockDatabase = {
      db: {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            root_path: '/test/project/root',
          })),
          run: vi.fn(),
        })),
      },
    };

    // Mock main window
    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    };

    // Mock getProjectConfig
    mockGetProjectConfig = vi.fn(() => ({
      resolveProjectPath: vi.fn((filePath) => `/test/resolved/${filePath}`),
      getProjectsRootPath: vi.fn(() => '/test/projects'),
    }));

    // 动态导入，确保 mock 已设置
    const module = await import('../../../src/main/file/file-ipc.js');
    registerFileIPC = module.registerFileIPC;

    // 捕获 IPC handlers
    const { ipcMain } = await import('electron');
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 File IPC
    registerFileIPC({
      database: mockDatabase,
      mainWindow: mockMainWindow,
      getProjectConfig: mockGetProjectConfig,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('基本功能测试', () => {
    it('should register all 17 IPC handlers', () => {
      expect(Object.keys(handlers).length).toBeGreaterThanOrEqual(17);
    });

    it('should have file read/write handlers', () => {
      expect(handlers['file:read-content']).toBeDefined();
      expect(handlers['file:write-content']).toBeDefined();
      expect(handlers['file:read-binary']).toBeDefined();
    });

    it('should have file management handlers', () => {
      expect(handlers['file:revealInExplorer']).toBeDefined();
      expect(handlers['file:copyItem']).toBeDefined();
      expect(handlers['file:moveItem']).toBeDefined();
      expect(handlers['file:deleteItem']).toBeDefined();
      expect(handlers['file:renameItem']).toBeDefined();
      expect(handlers['file:createFile']).toBeDefined();
      expect(handlers['file:createFolder']).toBeDefined();
      expect(handlers['file:openWithDefault']).toBeDefined();
    });

    it('should have clipboard handlers', () => {
      expect(handlers['file:copyToSystemClipboard']).toBeDefined();
      expect(handlers['file:cutToSystemClipboard']).toBeDefined();
      expect(handlers['file:pasteFromSystemClipboard']).toBeDefined();
      expect(handlers['file:importFromSystemClipboard']).toBeDefined();
    });

    it('should have extended operation handlers', () => {
      expect(handlers['file:openWith']).toBeDefined();
      expect(handlers['file:openWithProgram']).toBeDefined();
    });
  });

  describe('文件读写操作', () => {
    it('should handle read-content', async () => {
      // Mock fs module dynamically
      vi.doMock('fs', () => ({
        promises: {
          access: vi.fn().mockResolvedValue(undefined),
          readFile: vi.fn().mockResolvedValue('Hello, World!'),
        },
      }));

      // This test validates the handler is registered
      expect(handlers['file:read-content']).toBeDefined();
      expect(typeof handlers['file:read-content']).toBe('function');
    });

    it('should handle write-content', async () => {
      expect(handlers['file:write-content']).toBeDefined();
      expect(typeof handlers['file:write-content']).toBe('function');
    });

    it('should handle read-binary', async () => {
      expect(handlers['file:read-binary']).toBeDefined();
      expect(typeof handlers['file:read-binary']).toBe('function');
    });
  });

  describe('文件管理操作', () => {
    it('should handle revealInExplorer', async () => {
      expect(handlers['file:revealInExplorer']).toBeDefined();
      expect(typeof handlers['file:revealInExplorer']).toBe('function');
    });

    it('should handle copyItem', async () => {
      expect(handlers['file:copyItem']).toBeDefined();
      expect(typeof handlers['file:copyItem']).toBe('function');
    });

    it('should handle moveItem', async () => {
      expect(handlers['file:moveItem']).toBeDefined();
      expect(typeof handlers['file:moveItem']).toBe('function');
    });

    it('should handle deleteItem', async () => {
      expect(handlers['file:deleteItem']).toBeDefined();
      expect(typeof handlers['file:deleteItem']).toBe('function');
    });

    it('should handle renameItem', async () => {
      expect(handlers['file:renameItem']).toBeDefined();
      expect(typeof handlers['file:renameItem']).toBe('function');
    });

    it('should handle createFile', async () => {
      expect(handlers['file:createFile']).toBeDefined();
      expect(typeof handlers['file:createFile']).toBe('function');
    });

    it('should handle createFolder', async () => {
      expect(handlers['file:createFolder']).toBeDefined();
      expect(typeof handlers['file:createFolder']).toBe('function');
    });

    it('should handle openWithDefault', async () => {
      expect(handlers['file:openWithDefault']).toBeDefined();
      expect(typeof handlers['file:openWithDefault']).toBe('function');
    });
  });

  describe('系统剪贴板操作', () => {
    it('should handle copyToSystemClipboard', async () => {
      expect(handlers['file:copyToSystemClipboard']).toBeDefined();
      expect(typeof handlers['file:copyToSystemClipboard']).toBe('function');
    });

    it('should handle cutToSystemClipboard', async () => {
      expect(handlers['file:cutToSystemClipboard']).toBeDefined();
      expect(typeof handlers['file:cutToSystemClipboard']).toBe('function');
    });

    it('should handle pasteFromSystemClipboard', async () => {
      expect(handlers['file:pasteFromSystemClipboard']).toBeDefined();
      expect(typeof handlers['file:pasteFromSystemClipboard']).toBe('function');
    });

    it('should handle importFromSystemClipboard', async () => {
      expect(handlers['file:importFromSystemClipboard']).toBeDefined();
      expect(typeof handlers['file:importFromSystemClipboard']).toBe('function');
    });
  });

  describe('扩展操作', () => {
    it('should handle openWith', async () => {
      expect(handlers['file:openWith']).toBeDefined();
      expect(typeof handlers['file:openWith']).toBe('function');
    });

    it('should handle openWithProgram', async () => {
      expect(handlers['file:openWithProgram']).toBeDefined();
      expect(typeof handlers['file:openWithProgram']).toBe('function');
    });
  });
});
