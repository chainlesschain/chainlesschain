/**
 * ToolManager单元测试
 * 
 * 测试工具管理器的核心功能
 */

const { describe, it, expect, beforeEach, afterEach } = require('vitest');
const ToolManager = require('../../src/main/skill-tool-system/tool-manager');

describe('ToolManager', () => {
  let toolManager;
  let mockDatabase;
  let mockFunctionCaller;

  beforeEach(async () => {
    // 创建模拟对象
    mockDatabase = {
      prepare: jest.fn(),
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(),
    };

    mockFunctionCaller = {
      registerTool: jest.fn(),
      unregisterTool: jest.fn(),
      tools: new Map(),
    };

    toolManager = new ToolManager(mockDatabase, mockFunctionCaller);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerTool', () => {
    it('应该成功注册新工具', async () => {
      const toolData = {
        id: 'test_tool',
        name: 'test_tool',
        description: '测试工具',
        category: 'test',
        parameters_schema: {
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
        },
      };

      const handler = async (params) => ({ success: true, result: params });

      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await expect(toolManager.registerTool(toolData, handler)).resolves.not.toThrow();
      expect(mockFunctionCaller.registerTool).toHaveBeenCalledWith(
        'test_tool',
        handler,
        expect.any(Object)
      );
    });

    it('应该验证参数Schema', async () => {
      const toolData = {
        id: 'test_tool',
        name: 'test_tool',
        parameters_schema: 'invalid schema', // 无效的schema
      };

      await expect(toolManager.registerTool(toolData, () => {})).rejects.toThrow();
    });

    it('应该验证必填字段', async () => {
      const invalidTool = {
        id: 'test_tool',
        // 缺少name
      };

      await expect(toolManager.registerTool(invalidTool, () => {})).rejects.toThrow();
    });
  });

  describe('getTool', () => {
    it('应该返回存在的工具', async () => {
      const mockTool = {
        id: 'test_tool',
        name: 'test_tool',
        category: 'test',
      };

      mockDatabase.get.mockResolvedValue(mockTool);

      const tool = await toolManager.getTool('test_tool');
      expect(tool).toEqual(mockTool);
    });

    it('应该在工具不存在时返回null', async () => {
      mockDatabase.get.mockResolvedValue(null);

      const tool = await toolManager.getTool('nonexistent');
      expect(tool).toBeNull();
    });
  });

  describe('enableTool / disableTool', () => {
    it('应该启用工具', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await toolManager.enableTool('test_tool');

      expect(mockDatabase.run).toHaveBeenCalled();
    });

    it('应该禁用工具', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await toolManager.disableTool('test_tool');

      expect(mockDatabase.run).toHaveBeenCalled();
    });
  });

  describe('getToolsByCategory', () => {
    it('应该返回指定分类的所有工具', async () => {
      const mockTools = [
        { id: 'tool1', category: 'file' },
        { id: 'tool2', category: 'file' },
      ];

      mockDatabase.all.mockResolvedValue(mockTools);

      const tools = await toolManager.getToolsByCategory('file');
      expect(tools).toHaveLength(2);
      expect(tools).toEqual(mockTools);
    });
  });

  describe('recordToolUsage', () => {
    it('应该记录工具使用统计', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await toolManager.recordToolUsage('test_tool', true, 500);

      expect(mockDatabase.run).toHaveBeenCalled();
    });

    it('应该记录失败的工具调用', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await toolManager.recordToolUsage('test_tool', false, 100, 'TypeError');

      expect(mockDatabase.run).toHaveBeenCalled();
    });
  });

  describe('validateParametersSchema', () => {
    it('应该验证有效的JSON Schema', () => {
      const validSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      expect(() => toolManager.validateParametersSchema(validSchema)).not.toThrow();
    });

    it('应该拒绝无效的Schema', () => {
      const invalidSchema = {
        type: 'invalid_type',
      };

      expect(() => toolManager.validateParametersSchema(invalidSchema)).toThrow();
    });
  });
});
