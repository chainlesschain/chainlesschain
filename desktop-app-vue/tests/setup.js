/**
 * Vitest 测试环境设置文件
 * 用于配置全局 mocks 和测试环境
 */

import { vi } from "vitest";

// Mock Electron API with full service mocks
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

// Mock window.electronAPI
global.window = global.window || {};
global.window.electronAPI = {
  invoke: vi.fn().mockResolvedValue({}),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
};
global.window.api = mockElectronAPI;

// Mock performance API if not available
if (typeof global.performance === "undefined") {
  global.performance = {
    now: () => Date.now(),
    mark: vi.fn(),
    measure: vi.fn(),
    clearMarks: vi.fn(),
    clearMeasures: vi.fn(),
    getEntriesByName: vi.fn(() => []),
    getEntriesByType: vi.fn(() => []),
  };
}

// Reduce console noise in tests
if (process.env.NODE_ENV === "test") {
  global.console = {
    ...console,
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: console.error, // Keep error for debugging
    debug: vi.fn(),
  };
}

// 导出 mock API 供测试使用
export { mockElectronAPI };
