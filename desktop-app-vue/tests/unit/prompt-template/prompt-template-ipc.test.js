/**
 * Prompt Template IPC 单元测试
 * 测试11个提示词模板 API 方法
 *
 * 注意：当前测试只验证 IPC handlers 是否正确注册
 * TODO: 添加实际handler调用测试（需要解决CommonJS mock问题）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';

// Mock electron 模块
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('Prompt Template IPC', () => {
  let handlers = {};
  let mockPromptTemplateManager;
  let registerPromptTemplateIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // Mock prompt template manager
    mockPromptTemplateManager = {
      getTemplates: vi.fn(),
      getTemplateById: vi.fn(),
      searchTemplates: vi.fn(),
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
      fillTemplate: vi.fn(),
      getCategories: vi.fn(),
      getStatistics: vi.fn(),
      exportTemplate: vi.fn(),
      importTemplate: vi.fn(),
    };

    // 动态导入，确保 mock 已设置
    const module = await import('../../../src/main/prompt-template/prompt-template-ipc.js');
    registerPromptTemplateIPC = module.registerPromptTemplateIPC;

    // 捕获 IPC handlers
    const { ipcMain } = await import('electron');
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 Prompt Template IPC
    registerPromptTemplateIPC({
      promptTemplateManager: mockPromptTemplateManager,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('基本功能测试', () => {
    it('should register all 11 IPC handlers', () => {
      expect(Object.keys(handlers).length).toBe(11);
    });

    it('should have all expected handler channels', () => {
      const expectedChannels = [
        // 模板查询操作 (3)
        'prompt-template:get-all',
        'prompt-template:get',
        'prompt-template:search',

        // 模板管理操作 (3)
        'prompt-template:create',
        'prompt-template:update',
        'prompt-template:delete',

        // 模板使用操作 (1)
        'prompt-template:fill',

        // 分类与统计操作 (2)
        'prompt-template:get-categories',
        'prompt-template:get-statistics',

        // 导入导出操作 (2)
        'prompt-template:export',
        'prompt-template:import',
      ];

      expectedChannels.forEach(channel => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });
  });

  describe('模板查询操作 (3 handlers)', () => {
    it('should have get-all handler', () => {
      expect(handlers['prompt-template:get-all']).toBeDefined();
    });

    it('should have get handler', () => {
      expect(handlers['prompt-template:get']).toBeDefined();
    });

    it('should have search handler', () => {
      expect(handlers['prompt-template:search']).toBeDefined();
    });
  });

  describe('模板管理操作 (3 handlers)', () => {
    it('should have create handler', () => {
      expect(handlers['prompt-template:create']).toBeDefined();
    });

    it('should have update handler', () => {
      expect(handlers['prompt-template:update']).toBeDefined();
    });

    it('should have delete handler', () => {
      expect(handlers['prompt-template:delete']).toBeDefined();
    });
  });

  describe('模板使用操作 (1 handler)', () => {
    it('should have fill handler', () => {
      expect(handlers['prompt-template:fill']).toBeDefined();
    });
  });

  describe('分类与统计操作 (2 handlers)', () => {
    it('should have get-categories handler', () => {
      expect(handlers['prompt-template:get-categories']).toBeDefined();
    });

    it('should have get-statistics handler', () => {
      expect(handlers['prompt-template:get-statistics']).toBeDefined();
    });
  });

  describe('导入导出操作 (2 handlers)', () => {
    it('should have export handler', () => {
      expect(handlers['prompt-template:export']).toBeDefined();
    });

    it('should have import handler', () => {
      expect(handlers['prompt-template:import']).toBeDefined();
    });
  });
});
