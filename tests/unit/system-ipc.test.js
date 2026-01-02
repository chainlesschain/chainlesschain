/**
 * System IPC 单元测试
 * 测试16个系统管理API方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain, BrowserWindow, app, shell, dialog } from 'electron';
import os from 'os';

// Mock electron modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  app: {
    getVersion: vi.fn(() => '0.1.0'),
    getName: vi.fn(() => 'chainlesschain-desktop-vue'),
    getPath: vi.fn((name) => `/path/to/${name}`),
    getAppPath: vi.fn(() => '/app/path'),
    isPackaged: false,
    relaunch: vi.fn(),
    exit: vi.fn(),
    quit: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('os', () => ({
  default: {
    type: vi.fn(() => 'Darwin'),
    release: vi.fn(() => '21.6.0'),
    platform: vi.fn(() => 'darwin'),
    totalmem: vi.fn(() => 16000000000),
    freemem: vi.fn(() => 8000000000),
    cpus: vi.fn(() => [1, 2, 3, 4]),
  },
}));

describe('System IPC', () => {
  let mockMainWindow;
  let handlers = {};

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};

    // Mock主窗口
    mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      isFullScreen: vi.fn(() => false),
      isFocused: vi.fn(() => true),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      minimize: vi.fn(),
      close: vi.fn(),
      setAlwaysOnTop: vi.fn(),
    };

    // 捕获handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册System IPC
    const { registerSystemIPC } = require('../../desktop-app-vue/src/main/system/system-ipc');
    registerSystemIPC({ mainWindow: mockMainWindow });
  });

  describe('Window Control', () => {
    it('should maximize window when not maximized', async () => {
      mockMainWindow.isMaximized.mockReturnValue(false);

      const result = await handlers['system:maximize']();

      expect(result.success).toBe(true);
      expect(mockMainWindow.maximize).toHaveBeenCalled();
    });

    it('should unmaximize window when maximized', async () => {
      mockMainWindow.isMaximized.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const result = await handlers['system:maximize']();

      expect(result.success).toBe(true);
      expect(mockMainWindow.unmaximize).toHaveBeenCalled();
    });

    it('should minimize window', async () => {
      const result = await handlers['system:minimize']();

      expect(result.success).toBe(true);
      expect(mockMainWindow.minimize).toHaveBeenCalled();
    });

    it('should close window', async () => {
      const result = await handlers['system:close']();

      expect(result.success).toBe(true);
      expect(mockMainWindow.close).toHaveBeenCalled();
    });

    it('should get window state', async () => {
      const result = await handlers['system:get-window-state']();

      expect(result.success).toBe(true);
      expect(result.state).toEqual({
        isMaximized: false,
        isMinimized: false,
        isFullScreen: false,
        isFocused: true,
      });
    });

    it('should set always on top', async () => {
      const result = await handlers['system:set-always-on-top'](null, true);

      expect(result.success).toBe(true);
      expect(mockMainWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
    });

    it('should handle destroyed window', async () => {
      mockMainWindow.isDestroyed.mockReturnValue(true);

      const result = await handlers['system:maximize']();

      expect(result.success).toBe(false);
      expect(result.error).toContain('主窗口未初始化');
    });
  });

  describe('System Information', () => {
    it('should get system info', async () => {
      const result = await handlers['system:get-system-info']();

      expect(result.success).toBe(true);
      expect(result.platform).toBe('darwin');
      expect(result.arch).toBe('x64');
      expect(result.appVersion).toBe('0.1.0');
      expect(result.appName).toBe('chainlesschain-desktop-vue');
      expect(result.osType).toBe('Darwin');
      expect(result.totalMemory).toBe(16000000000);
      expect(result.cpus).toBe(4);
    });

    it('should get app info', async () => {
      const result = await handlers['system:get-app-info']();

      expect(result.success).toBe(true);
      expect(result.name).toBe('chainlesschain-desktop-vue');
      expect(result.version).toBe('0.1.0');
      expect(result.path).toBe('/app/path');
      expect(result.isPackaged).toBe(false);
    });

    it('should get platform', async () => {
      const result = await handlers['system:get-platform']();

      expect(result.success).toBe(true);
      expect(result.platform).toBe('darwin');
    });

    it('should get version', async () => {
      const result = await handlers['system:get-version']();

      expect(result.success).toBe(true);
      expect(result.version).toBe('0.1.0');
    });

    it('should get path', async () => {
      const result = await handlers['system:get-path'](null, 'userData');

      expect(result.success).toBe(true);
      expect(result.path).toBe('/path/to/userData');
    });
  });

  describe('External Operations', () => {
    it('should open external URL', async () => {
      shell.openExternal.mockResolvedValue();

      const result = await handlers['system:open-external'](null, 'https://example.com');

      expect(result.success).toBe(true);
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    });

    it('should show item in folder', async () => {
      const result = await handlers['system:show-item-in-folder'](null, '/path/to/file');

      expect(result.success).toBe(true);
      expect(shell.showItemInFolder).toHaveBeenCalledWith('/path/to/file');
    });

    it('should select directory', async () => {
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/selected/path'],
      });

      const result = await handlers['system:select-directory']();

      expect(result.success).toBe(true);
      expect(result.canceled).toBe(false);
      expect(result.filePaths).toEqual(['/selected/path']);
    });

    it('should select file', async () => {
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/selected/file.txt'],
      });

      const result = await handlers['system:select-file'](null, {
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });

      expect(result.success).toBe(true);
      expect(result.filePaths).toEqual(['/selected/file.txt']);
    });

    it('should handle dialog cancellation', async () => {
      dialog.showOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      const result = await handlers['system:select-directory']();

      expect(result.success).toBe(true);
      expect(result.canceled).toBe(true);
    });
  });

  describe('Application Control', () => {
    it('should restart application', async () => {
      const result = await handlers['system:restart']();

      expect(result.success).toBe(true);
      expect(app.relaunch).toHaveBeenCalled();
      expect(app.exit).toHaveBeenCalledWith(0);
    });

    it('should quit application', async () => {
      const result = await handlers['system:quit']();

      expect(result.success).toBe(true);
      expect(app.quit).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle window control errors', async () => {
      mockMainWindow.maximize.mockImplementation(() => {
        throw new Error('Maximize failed');
      });

      const result = await handlers['system:maximize']();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Maximize failed');
    });

    it('should handle system info errors', async () => {
      app.getVersion.mockImplementation(() => {
        throw new Error('Version error');
      });

      const result = await handlers['system:get-system-info']();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Version error');
    });
  });
});
