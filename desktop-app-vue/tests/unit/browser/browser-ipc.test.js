/**
 * Browser IPC 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock Electron
const mockIpcMain = new EventEmitter();
mockIpcMain.handle = vi.fn((channel, handler) => {
  mockIpcMain.on(channel, async (event, ...args) => {
    try {
      const result = await handler(event, ...args);
      event.returnValue = result;
    } catch (error) {
      event.returnValue = { error: error.message };
    }
  });
});

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: {
    getPath: vi.fn().mockReturnValue('/mock/path')
  }
}));

// Mock BrowserEngine
const mockBrowserEngine = {
  start: vi.fn().mockResolvedValue({ success: true, cdpPort: 18800, pid: 12345 }),
  stop: vi.fn().mockResolvedValue({ success: true, uptime: 10000 }),
  createContext: vi.fn().mockResolvedValue({ success: true, profileName: 'default', exists: false }),
  openTab: vi.fn().mockResolvedValue({ success: true, targetId: 'tab-1', url: 'https://example.com', title: 'Example' }),
  closeTab: vi.fn().mockResolvedValue({ success: true, targetId: 'tab-1' }),
  focusTab: vi.fn().mockResolvedValue({ success: true, targetId: 'tab-1' }),
  listTabs: vi.fn().mockResolvedValue([
    { targetId: 'tab-1', url: 'https://example.com', title: 'Example', profileName: 'default' }
  ]),
  navigate: vi.fn().mockResolvedValue({ success: true, url: 'https://example.com', title: 'Example' }),
  screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
  getStatus: vi.fn().mockReturnValue({
    isRunning: true,
    uptime: 5000,
    cdpPort: 18800,
    contextsCount: 1,
    tabsCount: 1,
    pid: 12345
  }),
  saveSession: vi.fn().mockResolvedValue({ success: true, stateFile: '/path/to/state.json', cookiesCount: 5 }),
  restoreSession: vi.fn().mockResolvedValue({ success: true, profileName: 'default', cookiesCount: 5 }),
  cleanup: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  contexts: new Map(),
  pages: new Map()
};

vi.mock('../../../src/main/browser/browser-engine.js', () => ({
  BrowserEngine: vi.fn(() => mockBrowserEngine)
}));

// Mock Logger
vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock IPC Error Handler - injected via DI parameter instead of vi.mock
const mockCreateIPCErrorHandler = vi.fn(() => (handler) => handler);

describe('Browser IPC', () => {
  let browserIPC;

  beforeEach(() => {
    vi.clearAllMocks();

    // 重新导入模块
    browserIPC = require('../../../src/main/browser/browser-ipc.js');
  });

  afterEach(async () => {
    if (browserIPC.cleanupBrowser) {
      await browserIPC.cleanupBrowser();
    }
  });

  describe('registerBrowserIPC()', () => {
    it('应该注册所有 IPC 处理器', () => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });

      const expectedHandlers = [
        'browser:start',
        'browser:stop',
        'browser:getStatus',
        'browser:createContext',
        'browser:openTab',
        'browser:closeTab',
        'browser:focusTab',
        'browser:listTabs',
        'browser:navigate',
        'browser:screenshot',
        'browser:saveSession',
        'browser:restoreSession'
      ];

      expectedHandlers.forEach(handler => {
        expect(mockIpcMain.handle).toHaveBeenCalledWith(
          handler,
          expect.any(Function)
        );
      });
    });
  });

  describe('browser:start', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该成功启动浏览器', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:start'
      )[1];

      const result = await handler({}, { headless: false });

      expect(mockBrowserEngine.start).toHaveBeenCalledWith({ headless: false });
      expect(result.success).toBe(true);
      expect(result.cdpPort).toBe(18800);
    });
  });

  describe('browser:stop', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该成功停止浏览器', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:stop'
      )[1];

      const result = await handler({});

      expect(mockBrowserEngine.stop).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.uptime).toBe(10000);
    });
  });

  describe('browser:getStatus', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该返回浏览器状态', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:getStatus'
      )[1];

      const result = await handler({});

      expect(mockBrowserEngine.getStatus).toHaveBeenCalled();
      expect(result.isRunning).toBe(true);
      expect(result.cdpPort).toBe(18800);
    });
  });

  describe('browser:createContext', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该成功创建上下文', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:createContext'
      )[1];

      const result = await handler({}, 'test-profile', { viewport: { width: 1920, height: 1080 } });

      expect(mockBrowserEngine.createContext).toHaveBeenCalledWith(
        'test-profile',
        expect.objectContaining({ viewport: { width: 1920, height: 1080 } })
      );
      expect(result.success).toBe(true);
      expect(result.profileName).toBe('default');
    });
  });

  describe('browser:openTab', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该成功打开标签页', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:openTab'
      )[1];

      const result = await handler({}, 'default', 'https://example.com', {});

      expect(mockBrowserEngine.openTab).toHaveBeenCalledWith(
        'default',
        'https://example.com',
        {}
      );
      expect(result.success).toBe(true);
      expect(result.targetId).toBe('tab-1');
    });
  });

  describe('browser:closeTab', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该成功关闭标签页', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:closeTab'
      )[1];

      const result = await handler({}, 'tab-1');

      expect(mockBrowserEngine.closeTab).toHaveBeenCalledWith('tab-1');
      expect(result.success).toBe(true);
    });
  });

  describe('browser:focusTab', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该成功聚焦标签页', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:focusTab'
      )[1];

      const result = await handler({}, 'tab-1');

      expect(mockBrowserEngine.focusTab).toHaveBeenCalledWith('tab-1');
      expect(result.success).toBe(true);
    });
  });

  describe('browser:listTabs', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该列出所有标签页', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:listTabs'
      )[1];

      const result = await handler({}, 'default');

      expect(mockBrowserEngine.listTabs).toHaveBeenCalledWith('default');
      expect(result.length).toBe(1);
      expect(result[0].targetId).toBe('tab-1');
    });
  });

  describe('browser:navigate', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该成功导航', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:navigate'
      )[1];

      const result = await handler({}, 'tab-1', 'https://example.org', {});

      expect(mockBrowserEngine.navigate).toHaveBeenCalledWith(
        'tab-1',
        'https://example.org',
        {}
      );
      expect(result.success).toBe(true);
    });
  });

  describe('browser:screenshot', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该成功截图', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:screenshot'
      )[1];

      const result = await handler({}, 'tab-1', { type: 'png' });

      expect(mockBrowserEngine.screenshot).toHaveBeenCalledWith('tab-1', { type: 'png' });
      expect(result.screenshot).toBeDefined();
      expect(result.type).toBe('png');
    });
  });

  describe('browser:saveSession', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该成功保存会话', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:saveSession'
      )[1];

      const result = await handler({}, 'default', null);

      expect(mockBrowserEngine.saveSession).toHaveBeenCalledWith('default', null);
      expect(result.success).toBe(true);
      expect(result.stateFile).toBeDefined();
    });
  });

  describe('browser:restoreSession', () => {
    beforeEach(() => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
    });

    it('应该成功恢复会话', async () => {
      const handler = mockIpcMain.handle.mock.calls.find(
        call => call[0] === 'browser:restoreSession'
      )[1];

      const result = await handler({}, 'default', null);

      expect(mockBrowserEngine.restoreSession).toHaveBeenCalledWith('default', null);
      expect(result.success).toBe(true);
      expect(result.profileName).toBe('default');
    });
  });

  describe('cleanupBrowser()', () => {
    it('应该清理浏览器资源', async () => {
      browserIPC.registerBrowserIPC({ ipcMain: mockIpcMain, createIPCErrorHandler: mockCreateIPCErrorHandler });
      await browserIPC.cleanupBrowser();

      expect(mockBrowserEngine.cleanup).toHaveBeenCalled();
    });
  });
});
