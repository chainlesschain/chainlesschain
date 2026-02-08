/**
 * Vitest 测试环境设置文件
 * 用于配置全局 mocks 和测试环境
 */

import { vi } from "vitest";

// Mock window.electronAPI
global.window = global.window || {};
global.window.electronAPI = {
  invoke: vi.fn().mockResolvedValue({}),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
};

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
