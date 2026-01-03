/**
 * 测试辅助函数
 * 提供常用的 Mock 对象和工具函数
 */

import { vi } from 'vitest';

/**
 * 创建 mock electron 对象
 */
export function createMockElectron() {
  return {
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    BrowserWindow: vi.fn(() => ({
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      isFullScreen: vi.fn(() => false),
      isFocused: vi.fn(() => true),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      minimize: vi.fn(),
      restore: vi.fn(),
      close: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setBounds: vi.fn(),
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      webContents: {
        send: vi.fn(),
      },
    })),
    app: {
      getVersion: vi.fn(() => '0.1.0'),
      getName: vi.fn(() => 'chainlesschain-desktop-vue'),
      getPath: vi.fn((name) => `/mock/path/${name}`),
      getAppPath: vi.fn(() => '/mock/app/path'),
      isPackaged: false,
      relaunch: vi.fn(),
      exit: vi.fn(),
      quit: vi.fn(),
      getLocale: vi.fn(() => 'zh-CN'),
    },
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      showMessageBox: vi.fn(),
      showErrorBox: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
    },
  };
}

/**
 * 创建 mock 数据库
 */
export function createMockDatabase() {
  const mockResults = {
    get: null,
    all: [],
    run: { lastInsertRowid: 1, changes: 1 },
  };

  const statement = {
    get: vi.fn((...args) => mockResults.get),
    all: vi.fn((...args) => mockResults.all),
    run: vi.fn((...args) => mockResults.run),
    finalize: vi.fn(),
  };

  const db = {
    prepare: vi.fn(() => statement),
    exec: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn((fn) => fn),
    pragma: vi.fn(),

    // 测试辅助方法
    _setMockResult: (method, value) => {
      mockResults[method] = value;
    },
    _getMockStatement: () => statement,
  };

  return db;
}

/**
 * 创建 mock LLM Manager
 */
export function createMockLLMManager() {
  return {
    chat: vi.fn(async (message, options = {}) => ({
      success: true,
      response: `Mock response to: ${message.substring(0, 50)}...`,
      model: options.model || 'qwen2:7b',
      tokens: 100,
    })),

    getModels: vi.fn(async () => ({
      success: true,
      models: [
        { name: 'qwen2:7b', size: '4.4GB' },
        { name: 'llama3:8b', size: '4.7GB' },
      ],
    })),

    getCurrentModel: vi.fn(() => 'qwen2:7b'),
    setModel: vi.fn(async (model) => ({ success: true, model })),

    generateEmbedding: vi.fn(async (text) => ({
      success: true,
      embedding: new Array(768).fill(0).map(() => Math.random()),
    })),

    isAvailable: vi.fn(() => true),
    getConfig: vi.fn(() => ({
      baseURL: 'http://localhost:11434',
      timeout: 30000,
    })),
  };
}

/**
 * 创建 mock RAG Manager
 */
export function createMockRAGManager() {
  return {
    search: vi.fn(async (query, options = {}) => ({
      success: true,
      results: [
        {
          content: `Mock search result for: ${query}`,
          score: 0.95,
          metadata: { source: 'test-doc-1' },
        },
      ],
    })),

    addDocument: vi.fn(async (doc) => ({
      success: true,
      id: `doc-${Date.now()}`,
    })),

    deleteDocument: vi.fn(async (id) => ({
      success: true,
      deleted: 1,
    })),

    getCollections: vi.fn(async () => ({
      success: true,
      collections: ['default', 'projects'],
    })),
  };
}

/**
 * 创建 mock 主窗口
 */
export function createMockMainWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    minimize: vi.fn(),
    restore: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setBounds: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
    },
  };
}

/**
 * 捕获 IPC handlers
 */
export function captureIPCHandlers(ipcMain) {
  const handlers = {};
  ipcMain.handle.mockImplementation((channel, handler) => {
    handlers[channel] = handler;
  });
  return handlers;
}

/**
 * 等待异步操作
 */
export async function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 创建测试数据
 */
export function createTestData(type, overrides = {}) {
  const now = new Date().toISOString();

  const defaults = {
    project: {
      id: 'test-project-1',
      name: 'Test Project',
      description: 'Test Project Description',
      path: '/test/projects/test-project-1',
      created_at: now,
      updated_at: now,
      status: 'active',
      tags: JSON.stringify(['test']),
    },

    note: {
      id: 'test-note-1',
      title: 'Test Note',
      content: 'Test note content',
      project_id: 'test-project-1',
      tags: JSON.stringify(['test']),
      created_at: now,
      updated_at: now,
    },

    file: {
      id: 'test-file-1',
      project_id: 'test-project-1',
      path: 'test/file.js',
      name: 'file.js',
      type: 'file',
      size: 1024,
      hash: 'abcd1234',
      created_at: now,
      modified_at: now,
    },

    contact: {
      did: 'did:test:123456',
      nickname: 'Test User',
      avatar: '',
      relationship: 'friend',
      public_key: 'test-public-key',
      added_at: now,
    },

    notification: {
      id: 'test-notif-1',
      title: 'Test Notification',
      message: 'Test notification message',
      type: 'info',
      is_read: 0,
      created_at: now,
    },
  };

  return { ...defaults[type], ...overrides };
}

/**
 * 创建测试用的 Promise 控制器
 */
export function createDeferredPromise() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * 验证函数调用
 */
export function assertCalled(mockFn, times = 1) {
  expect(mockFn).toHaveBeenCalledTimes(times);
}

/**
 * 验证函数调用参数
 */
export function assertCalledWith(mockFn, ...expectedArgs) {
  expect(mockFn).toHaveBeenCalledWith(...expectedArgs);
}

/**
 * 重置所有 mocks
 */
export function resetAllMocks(...mocks) {
  mocks.forEach(mock => {
    if (mock && typeof mock.mockReset === 'function') {
      mock.mockReset();
    }
  });
}

/**
 * 创建 mock 文件系统
 */
export function createMockFS() {
  const files = new Map();

  return {
    existsSync: vi.fn((path) => files.has(path)),
    readFileSync: vi.fn((path) => files.get(path) || ''),
    writeFileSync: vi.fn((path, content) => files.set(path, content)),
    unlinkSync: vi.fn((path) => files.delete(path)),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({
      isFile: () => true,
      isDirectory: () => false,
      size: 1024,
      mtime: new Date(),
    })),

    // 测试辅助方法
    _setFile: (path, content) => files.set(path, content),
    _getFile: (path) => files.get(path),
    _clear: () => files.clear(),
  };
}

/**
 * 创建测试错误
 */
export function createTestError(message = 'Test Error', code = 'TEST_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}
