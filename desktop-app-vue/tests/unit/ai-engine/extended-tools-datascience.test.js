/**
 * DataScienceToolsHandler 单元测试（简化版）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('DataScienceToolsHandler', () => {
  let DataScienceToolsHandler;
  let handler;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await import('../../../src/main/ai-engine/extended-tools-datascience.js');
    DataScienceToolsHandler = module.default || module.DataScienceToolsHandler;

    handler = new DataScienceToolsHandler();
  });

  describe('构造函数', () => {
    it('应该正确初始化', () => {
      expect(handler).toBeDefined();
      expect(handler.name).toBe('DataScienceToolsHandler');
    });
  });

  describe('executePythonScript', () => {
    it('应该有 executePythonScript 方法', () => {
      expect(handler.executePythonScript).toBeTypeOf('function');
    });
  });

  describe.skip('其他测试（需要 Python 环境）', () => {
    it('需要 pandas/sklearn 等 Python 库', () => {
      expect(true).toBe(true);
    });
  });
});
