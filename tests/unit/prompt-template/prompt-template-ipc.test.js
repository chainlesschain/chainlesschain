/**
 * Prompt Template IPC 单元测试
 * 测试提示词模板 IPC 处理器的所有功能
 */

const { ipcMain } = require('electron');
const { registerPromptTemplateIPC } = require('../../../desktop-app-vue/src/main/prompt-template/prompt-template-ipc');

// Mock ipcMain
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

describe('Prompt Template IPC Handlers', () => {
  let mockPromptTemplateManager;
  let handlers = {};

  beforeEach(() => {
    // 清除所有 mocks
    jest.clearAllMocks();
    handlers = {};

    // 创建 mock 提示词模板管理器
    mockPromptTemplateManager = {
      getTemplates: jest.fn(),
      getTemplateById: jest.fn(),
      searchTemplates: jest.fn(),
      createTemplate: jest.fn(),
      updateTemplate: jest.fn(),
      deleteTemplate: jest.fn(),
      fillTemplate: jest.fn(),
      getCategories: jest.fn(),
      getStatistics: jest.fn(),
      exportTemplate: jest.fn(),
      importTemplate: jest.fn(),
    };

    // 捕获所有注册的 handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 IPC handlers
    registerPromptTemplateIPC({ promptTemplateManager: mockPromptTemplateManager });
  });

  afterEach(() => {
    handlers = {};
  });

  // ============================================================
  // 模板查询操作测试 (3 handlers)
  // ============================================================

  describe('prompt-template:get-all', () => {
    it('should get all templates successfully', async () => {
      const mockTemplates = [
        { id: 1, name: '代码审查模板', category: 'development' },
        { id: 2, name: '文档生成模板', category: 'documentation' },
      ];

      mockPromptTemplateManager.getTemplates.mockResolvedValue(mockTemplates);

      const handler = handlers['prompt-template:get-all'];
      const result = await handler(null, {});

      expect(mockPromptTemplateManager.getTemplates).toHaveBeenCalledWith({});
      expect(result).toEqual(mockTemplates);
    });

    it('should get templates with filters', async () => {
      const filters = { category: 'development', isSystem: true };
      const mockTemplates = [
        { id: 1, name: '代码审查模板', category: 'development', isSystem: true },
      ];

      mockPromptTemplateManager.getTemplates.mockResolvedValue(mockTemplates);

      const handler = handlers['prompt-template:get-all'];
      const result = await handler(null, filters);

      expect(mockPromptTemplateManager.getTemplates).toHaveBeenCalledWith(filters);
      expect(result).toEqual(mockTemplates);
    });

    it('should return empty array when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:get-all'];
      const result = await handler(null, {});

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockPromptTemplateManager.getTemplates.mockRejectedValue(new Error('数据库错误'));

      const handler = handlers['prompt-template:get-all'];
      const result = await handler(null, {});

      expect(result).toEqual([]);
    });
  });

  describe('prompt-template:get', () => {
    it('should get template by ID successfully', async () => {
      const mockTemplate = {
        id: 1,
        name: '代码审查模板',
        content: '请审查以下代码: {{code}}',
        category: 'development',
      };

      mockPromptTemplateManager.getTemplateById.mockResolvedValue(mockTemplate);

      const handler = handlers['prompt-template:get'];
      const result = await handler(null, 1);

      expect(mockPromptTemplateManager.getTemplateById).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockTemplate);
    });

    it('should return null when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:get'];
      const result = await handler(null, 1);

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockPromptTemplateManager.getTemplateById.mockRejectedValue(new Error('未找到模板'));

      const handler = handlers['prompt-template:get'];
      const result = await handler(null, 999);

      expect(result).toBeNull();
    });
  });

  describe('prompt-template:search', () => {
    it('should search templates successfully', async () => {
      const mockSearchResults = [
        { id: 1, name: '代码审查模板', category: 'development' },
        { id: 3, name: '代码重构建议', category: 'development' },
      ];

      mockPromptTemplateManager.searchTemplates.mockResolvedValue(mockSearchResults);

      const handler = handlers['prompt-template:search'];
      const result = await handler(null, '代码');

      expect(mockPromptTemplateManager.searchTemplates).toHaveBeenCalledWith('代码');
      expect(result).toEqual(mockSearchResults);
    });

    it('should return empty array when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:search'];
      const result = await handler(null, 'test');

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockPromptTemplateManager.searchTemplates.mockRejectedValue(new Error('搜索失败'));

      const handler = handlers['prompt-template:search'];
      const result = await handler(null, 'test');

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // 模板管理操作测试 (3 handlers)
  // ============================================================

  describe('prompt-template:create', () => {
    it('should create template successfully', async () => {
      const templateData = {
        name: '新模板',
        content: '模板内容: {{variable}}',
        category: 'custom',
      };

      const mockCreatedTemplate = { id: 10, ...templateData };
      mockPromptTemplateManager.createTemplate.mockResolvedValue(mockCreatedTemplate);

      const handler = handlers['prompt-template:create'];
      const result = await handler(null, templateData);

      expect(mockPromptTemplateManager.createTemplate).toHaveBeenCalledWith(templateData);
      expect(result).toEqual(mockCreatedTemplate);
    });

    it('should throw error when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:create'];

      await expect(handler(null, {})).rejects.toThrow('提示词模板管理器未初始化');
    });

    it('should throw error when creation fails', async () => {
      mockPromptTemplateManager.createTemplate.mockRejectedValue(new Error('创建失败'));

      const handler = handlers['prompt-template:create'];

      await expect(handler(null, {})).rejects.toThrow('创建失败');
    });
  });

  describe('prompt-template:update', () => {
    it('should update template successfully', async () => {
      const updates = {
        name: '更新后的模板名称',
        content: '更新后的内容',
      };

      const mockUpdatedTemplate = { id: 1, ...updates };
      mockPromptTemplateManager.updateTemplate.mockResolvedValue(mockUpdatedTemplate);

      const handler = handlers['prompt-template:update'];
      const result = await handler(null, 1, updates);

      expect(mockPromptTemplateManager.updateTemplate).toHaveBeenCalledWith(1, updates);
      expect(result).toEqual(mockUpdatedTemplate);
    });

    it('should throw error when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:update'];

      await expect(handler(null, 1, {})).rejects.toThrow('提示词模板管理器未初始化');
    });

    it('should throw error when update fails', async () => {
      mockPromptTemplateManager.updateTemplate.mockRejectedValue(new Error('更新失败'));

      const handler = handlers['prompt-template:update'];

      await expect(handler(null, 1, {})).rejects.toThrow('更新失败');
    });
  });

  describe('prompt-template:delete', () => {
    it('should delete template successfully', async () => {
      mockPromptTemplateManager.deleteTemplate.mockResolvedValue({ success: true });

      const handler = handlers['prompt-template:delete'];
      const result = await handler(null, 1);

      expect(mockPromptTemplateManager.deleteTemplate).toHaveBeenCalledWith(1);
      expect(result).toEqual({ success: true });
    });

    it('should throw error when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:delete'];

      await expect(handler(null, 1)).rejects.toThrow('提示词模板管理器未初始化');
    });

    it('should throw error when deletion fails', async () => {
      mockPromptTemplateManager.deleteTemplate.mockRejectedValue(new Error('删除失败'));

      const handler = handlers['prompt-template:delete'];

      await expect(handler(null, 1)).rejects.toThrow('删除失败');
    });
  });

  // ============================================================
  // 模板使用操作测试 (1 handler)
  // ============================================================

  describe('prompt-template:fill', () => {
    it('should fill template successfully', async () => {
      const values = {
        code: 'function test() { return true; }',
        language: 'JavaScript',
      };

      const mockFilledContent = '请审查以下 JavaScript 代码: function test() { return true; }';
      mockPromptTemplateManager.fillTemplate.mockResolvedValue(mockFilledContent);

      const handler = handlers['prompt-template:fill'];
      const result = await handler(null, 1, values);

      expect(mockPromptTemplateManager.fillTemplate).toHaveBeenCalledWith(1, values);
      expect(result).toBe(mockFilledContent);
    });

    it('should throw error when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:fill'];

      await expect(handler(null, 1, {})).rejects.toThrow('提示词模板管理器未初始化');
    });

    it('should throw error when fill fails', async () => {
      mockPromptTemplateManager.fillTemplate.mockRejectedValue(new Error('缺少必需变量'));

      const handler = handlers['prompt-template:fill'];

      await expect(handler(null, 1, {})).rejects.toThrow('缺少必需变量');
    });
  });

  // ============================================================
  // 分类与统计操作测试 (2 handlers)
  // ============================================================

  describe('prompt-template:get-categories', () => {
    it('should get categories successfully', async () => {
      const mockCategories = [
        { id: 'development', name: '开发', count: 5 },
        { id: 'documentation', name: '文档', count: 3 },
        { id: 'custom', name: '自定义', count: 10 },
      ];

      mockPromptTemplateManager.getCategories.mockResolvedValue(mockCategories);

      const handler = handlers['prompt-template:get-categories'];
      const result = await handler();

      expect(mockPromptTemplateManager.getCategories).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockCategories);
    });

    it('should return empty array when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:get-categories'];
      const result = await handler();

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockPromptTemplateManager.getCategories.mockRejectedValue(new Error('获取失败'));

      const handler = handlers['prompt-template:get-categories'];
      const result = await handler();

      expect(result).toEqual([]);
    });
  });

  describe('prompt-template:get-statistics', () => {
    it('should get statistics successfully', async () => {
      const mockStatistics = {
        total: 18,
        system: 8,
        custom: 10,
        byCategory: {
          development: 5,
          documentation: 3,
          custom: 10,
        },
        mostUsed: [
          { id: 1, name: '代码审查模板', usageCount: 50 },
          { id: 2, name: '文档生成模板', usageCount: 30 },
        ],
      };

      mockPromptTemplateManager.getStatistics.mockResolvedValue(mockStatistics);

      const handler = handlers['prompt-template:get-statistics'];
      const result = await handler();

      expect(mockPromptTemplateManager.getStatistics).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStatistics);
    });

    it('should return default statistics when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:get-statistics'];
      const result = await handler();

      expect(result).toEqual({
        total: 0,
        system: 0,
        custom: 0,
        byCategory: {},
        mostUsed: [],
      });
    });

    it('should return default statistics on error', async () => {
      mockPromptTemplateManager.getStatistics.mockRejectedValue(new Error('统计失败'));

      const handler = handlers['prompt-template:get-statistics'];
      const result = await handler();

      expect(result).toEqual({
        total: 0,
        system: 0,
        custom: 0,
        byCategory: {},
        mostUsed: [],
      });
    });
  });

  // ============================================================
  // 导入导出操作测试 (2 handlers)
  // ============================================================

  describe('prompt-template:export', () => {
    it('should export template successfully', async () => {
      const mockExportData = {
        version: '1.0',
        template: {
          id: 1,
          name: '代码审查模板',
          content: '请审查以下代码: {{code}}',
          category: 'development',
        },
      };

      mockPromptTemplateManager.exportTemplate.mockResolvedValue(mockExportData);

      const handler = handlers['prompt-template:export'];
      const result = await handler(null, 1);

      expect(mockPromptTemplateManager.exportTemplate).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockExportData);
    });

    it('should throw error when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:export'];

      await expect(handler(null, 1)).rejects.toThrow('提示词模板管理器未初始化');
    });

    it('should throw error when export fails', async () => {
      mockPromptTemplateManager.exportTemplate.mockRejectedValue(new Error('导出失败'));

      const handler = handlers['prompt-template:export'];

      await expect(handler(null, 1)).rejects.toThrow('导出失败');
    });
  });

  describe('prompt-template:import', () => {
    it('should import template successfully', async () => {
      const importData = {
        version: '1.0',
        template: {
          name: '导入的模板',
          content: '导入的内容: {{variable}}',
          category: 'custom',
        },
      };

      const mockImportedTemplate = { id: 11, ...importData.template };
      mockPromptTemplateManager.importTemplate.mockResolvedValue(mockImportedTemplate);

      const handler = handlers['prompt-template:import'];
      const result = await handler(null, importData);

      expect(mockPromptTemplateManager.importTemplate).toHaveBeenCalledWith(importData);
      expect(result).toEqual(mockImportedTemplate);
    });

    it('should throw error when manager is not initialized', async () => {
      registerPromptTemplateIPC({ promptTemplateManager: null });
      const handler = handlers['prompt-template:import'];

      await expect(handler(null, {})).rejects.toThrow('提示词模板管理器未初始化');
    });

    it('should throw error when import fails', async () => {
      mockPromptTemplateManager.importTemplate.mockRejectedValue(new Error('导入失败'));

      const handler = handlers['prompt-template:import'];

      await expect(handler(null, {})).rejects.toThrow('导入失败');
    });

    it('should handle invalid import data', async () => {
      mockPromptTemplateManager.importTemplate.mockRejectedValue(new Error('无效的导入格式'));

      const handler = handlers['prompt-template:import'];

      await expect(handler(null, { invalid: 'data' })).rejects.toThrow('无效的导入格式');
    });
  });

  // ============================================================
  // 注册测试
  // ============================================================

  describe('registerPromptTemplateIPC', () => {
    it('should register all 11 IPC handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledTimes(11);

      const registeredChannels = ipcMain.handle.mock.calls.map(call => call[0]);

      // Template query operations (3)
      expect(registeredChannels).toContain('prompt-template:get-all');
      expect(registeredChannels).toContain('prompt-template:get');
      expect(registeredChannels).toContain('prompt-template:search');

      // Template management operations (3)
      expect(registeredChannels).toContain('prompt-template:create');
      expect(registeredChannels).toContain('prompt-template:update');
      expect(registeredChannels).toContain('prompt-template:delete');

      // Template usage operations (1)
      expect(registeredChannels).toContain('prompt-template:fill');

      // Category & statistics operations (2)
      expect(registeredChannels).toContain('prompt-template:get-categories');
      expect(registeredChannels).toContain('prompt-template:get-statistics');

      // Import/export operations (2)
      expect(registeredChannels).toContain('prompt-template:export');
      expect(registeredChannels).toContain('prompt-template:import');
    });

    it('should handle registration with null manager', () => {
      jest.clearAllMocks();

      expect(() => {
        registerPromptTemplateIPC({ promptTemplateManager: null });
      }).not.toThrow();

      expect(ipcMain.handle).toHaveBeenCalled();
    });
  });
});
