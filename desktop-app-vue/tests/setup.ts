/**
 * Vitest 测试环境设置
 */

import { vi } from 'vitest';
import { config } from '@vue/test-utils';

// Global mock for ipc-guard to prevent IPC registration blocking in tests
vi.mock('@main/ipc-guard', () => ({
  isModuleRegistered: vi.fn().mockReturnValue(false),
  markModuleRegistered: vi.fn(),
  isChannelRegistered: vi.fn().mockReturnValue(false),
  markChannelRegistered: vi.fn(),
  resetAll: vi.fn(),
  safeRegisterHandler: vi.fn().mockReturnValue(true),
  safeRegisterHandlers: vi.fn().mockReturnValue({ registered: 0, skipped: 0 }),
  safeRegisterModule: vi.fn().mockReturnValue(true),
  unregisterChannel: vi.fn(),
  unregisterModule: vi.fn(),
  getStats: vi.fn().mockReturnValue({ totalChannels: 0, totalModules: 0, channels: [], modules: [] }),
  printStats: vi.fn(),
}));

// Also mock the relative path version
vi.mock('../../../src/main/ipc-guard', () => ({
  isModuleRegistered: vi.fn().mockReturnValue(false),
  markModuleRegistered: vi.fn(),
  isChannelRegistered: vi.fn().mockReturnValue(false),
  markChannelRegistered: vi.fn(),
  resetAll: vi.fn(),
  safeRegisterHandler: vi.fn().mockReturnValue(true),
  safeRegisterHandlers: vi.fn().mockReturnValue({ registered: 0, skipped: 0 }),
  safeRegisterModule: vi.fn().mockReturnValue(true),
  unregisterChannel: vi.fn(),
  unregisterModule: vi.fn(),
  getStats: vi.fn().mockReturnValue({ totalChannels: 0, totalModules: 0, channels: [], modules: [] }),
  printStats: vi.fn(),
}));

// Global mock for electron to avoid import errors in tests
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/mock/path'),
    getName: vi.fn().mockReturnValue('test-app'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
    },
    on: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
  })),
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));

// 全局测试配置
config.global.mocks = {
  $t: (key: string) => key, // i18n mock
};

// Mock Electron API
const mockElectronAPI = {
  // 代码执行相关
  code: {
    executePython: vi.fn(),
    executeFile: vi.fn(),
    checkSafety: vi.fn(),
    generate: vi.fn(),
    generateTests: vi.fn(),
    review: vi.fn(),
    refactor: vi.fn(),
    explain: vi.fn(),
    fixBug: vi.fn(),
    generateScaffold: vi.fn(),
  },

  // 项目管理相关
  project: {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    addFile: vi.fn(),
    updateFile: vi.fn(),
    deleteFile: vi.fn(),
    getFile: vi.fn(),
    getFileContent: vi.fn(),
    saveFileContent: vi.fn(),
  },

  // 数据库相关
  db: {
    execute: vi.fn(),
    query: vi.fn(),
    run: vi.fn(),
  },

  // 文件系统相关
  fs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
  },

  // U-Key相关
  ukey: {
    detect: vi.fn(),
    verifyPIN: vi.fn(),
    sign: vi.fn(),
    verify: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  },

  // LLM服务相关
  llm: {
    query: vi.fn(),
    stream: vi.fn(),
    checkStatus: vi.fn(),
  },

  // Git同步相关
  git: {
    init: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    pull: vi.fn(),
    status: vi.fn(),
  },
};

// 挂载到全局
global.window = global.window || {};
(global.window as any).api = mockElectronAPI;

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

global.localStorage = localStorageMock as any;

// Mock sessionStorage
global.sessionStorage = localStorageMock as any;

// Mock console 方法避免测试输出污染
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// 导出 mock API 供测试使用
export { mockElectronAPI };
