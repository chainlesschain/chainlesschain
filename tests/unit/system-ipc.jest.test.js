/**
 * System IPC 单元测试 (Jest 版本)
 * 测试16个系统管理API方法
 */

const { ipcMain, BrowserWindow, app, shell, dialog } = require('electron');

describe('System IPC', () => {
  let mockMainWindow;
  let handlers = {};

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = {};

    // Mock主窗口
    mockMainWindow = {
      isDestroyed: jest.fn(() => false),
      isMaximized: jest.fn(() => false),
      isMinimized: jest.fn(() => false),
      isFullScreen: jest.fn(() => false),
      isFocused: jest.fn(() => true),
      maximize: jest.fn(),
      unmaximize: jest.fn(),
      minimize: jest.fn(),
      close: jest.fn(),
      setAlwaysOnTop: jest.fn(),
    };

    // 重置 electron mock 以捕获新的 handlers
    ipcMain.handle.mockClear();
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
      return handler;
    });

    // 删除缓存并重新导入模块
    delete require.cache[require.resolve('../../desktop-app-vue/src/main/system/system-ipc')];
    const { registerSystemIPC } = require('../../desktop-app-vue/src/main/system/system-ipc');
    registerSystemIPC({ mainWindow: mockMainWindow });
  });

  describe('Window Control', () => {
    test('should maximize window when not maximized', async () => {
      mockMainWindow.isMaximized.mockReturnValue(false);

      const result = await handlers['system:maximize']();

      expect(result.success).toBe(true);
      expect(mockMainWindow.maximize).toHaveBeenCalled();
    });

    test('should unmaximize window when maximized', async () => {
      mockMainWindow.isMaximized.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const result = await handlers['system:maximize']();

      expect(result.success).toBe(true);
      expect(mockMainWindow.unmaximize).toHaveBeenCalled();
    });

    test('should minimize window', async () => {
      const result = await handlers['system:minimize']();

      expect(result.success).toBe(true);
      expect(mockMainWindow.minimize).toHaveBeenCalled();
    });

    test('should close window', async () => {
      const result = await handlers['system:close']();

      expect(result.success).toBe(true);
      expect(mockMainWindow.close).toHaveBeenCalled();
    });

    test('should toggle always on top', async () => {
      const result = await handlers['system:toggleAlwaysOnTop'](null, true);

      expect(result.success).toBe(true);
      expect(mockMainWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
    });
  });

  describe('System Information', () => {
    test('should get platform', async () => {
      const result = await handlers['system:getPlatform']();

      expect(result.success).toBe(true);
      expect(result.platform).toBe('darwin');
    });

    test('should get version', async () => {
      const result = await handlers['system:getVersion']();

      expect(result.success).toBe(true);
      expect(result.version).toBe('0.1.0');
    });

    test('should get path', async () => {
      const result = await handlers['system:getPath'](null, 'userData');

      expect(result.success).toBe(true);
      expect(result.path).toBe('/path/to/userData');
    });
  });

  describe('External Operations', () => {
    test('should open external URL', async () => {
      shell.openExternal.mockResolvedValue();

      const result = await handlers['system:openExternal'](null, 'https://example.com');

      expect(result.success).toBe(true);
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    });

    test('should show item in folder', async () => {
      shell.showItemInFolder.mockReturnValue();

      const result = await handlers['system:showItemInFolder'](null, '/path/to/file');

      expect(result.success).toBe(true);
      expect(shell.showItemInFolder).toHaveBeenCalledWith('/path/to/file');
    });

    test('should select directory', async () => {
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/selected/directory'],
      });

      const result = await handlers['system:selectDirectory']();

      expect(result.success).toBe(true);
      expect(result.path).toBe('/selected/directory');
    });

    test('should select file', async () => {
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/selected/file.txt'],
      });

      const result = await handlers['system:selectFile']();

      expect(result.success).toBe(true);
      expect(result.path).toBe('/selected/file.txt');
    });

    test('should handle dialog cancellation', async () => {
      dialog.showOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      const result = await handlers['system:selectFile']();

      expect(result.success).toBe(false);
      expect(result.canceled).toBe(true);
    });
  });

  describe('Application Control', () => {
    test('should restart application', async () => {
      const result = await handlers['system:restart']();

      expect(result.success).toBe(true);
      expect(app.relaunch).toHaveBeenCalled();
      expect(app.exit).toHaveBeenCalledWith(0);
    });

    test('should quit application', async () => {
      const result = await handlers['system:quit']();

      expect(result.success).toBe(true);
      expect(app.quit).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle window control errors', async () => {
      mockMainWindow.isDestroyed.mockReturnValue(true);

      const result = await handlers['system:maximize']();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle system info errors', async () => {
      app.getVersion.mockImplementation(() => {
        throw new Error('Version error');
      });

      const result = await handlers['system:getVersion']();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Version error');
    });
  });
});
