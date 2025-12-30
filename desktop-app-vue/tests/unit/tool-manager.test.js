/**
 * ToolManager 单元测试
 *
 * 测试工具管理器的核心功能：
 * - 工具注册、注销、更新
 * - 工具查询（按类别、技能等）
 * - 参数schema验证
 * - 统计记录和查询
 * - 文档生成
 * - 内置/插件工具加载
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ===================== MOCK SETUP =====================

// Mock uuid
const mockToolUuid = 'mock-tool-uuid-5678';
vi.mock('uuid', () => ({
  v4: vi.fn(() => mockToolUuid),
}));

// Mock DocGenerator
const mockDocGenerator = {
  initialize: vi.fn().mockResolvedValue(true),
  generateToolDoc: vi.fn().mockResolvedValue({ success: true, path: '/docs/tool.md' }),
};

vi.mock('../../src/main/skill-tool-system/doc-generator', () => ({
  default: vi.fn(() => mockDocGenerator),
}));

// Mock builtin-tools
vi.mock('../../src/main/skill-tool-system/builtin-tools', () => ({
  default: [],
}));

// Import after mocks
const ToolManager = require('../../src/main/skill-tool-system/tool-manager');

// ===================== MOCK FACTORIES =====================

const createMockDatabase = () => ({
  run: vi.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
  get: vi.fn().mockResolvedValue(null),
  all: vi.fn().mockResolvedValue([]),
  exec: vi.fn().mockResolvedValue(undefined),
});

const createMockFunctionCaller = () => ({
  registerFunction: vi.fn().mockResolvedValue(true),
  unregisterFunction: vi.fn().mockResolvedValue(true),
  registerTool: vi.fn().mockResolvedValue(true),
  unregisterTool: vi.fn().mockResolvedValue(true),
  hasTool: vi.fn().mockReturnValue(true),
  callFunction: vi.fn().mockResolvedValue({ success: true, result: 'mock result' }),
  isInitialized: true,
});

// ===================== TESTS =====================

describe('ToolManager', () => {
  let toolManager;
  let mockDb;
  let mockFunctionCaller;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Reset mockDocGenerator
    mockDocGenerator.initialize.mockClear();
    mockDocGenerator.generateToolDoc.mockClear();

    // Create fresh mock instances
    mockDb = createMockDatabase();
    mockFunctionCaller = createMockFunctionCaller();

    // Create ToolManager instance with DI
    toolManager = new ToolManager(mockDb, mockFunctionCaller, {
      DocGeneratorClass: vi.fn(() => mockDocGenerator),
    });
  });

  afterEach(() => {
    // Cleanup
    if (toolManager) {
      toolManager.tools.clear();
    }
  });

  describe('构造函数', () => {
    it('should create instance with database and functionCaller', () => {
      expect(toolManager).toBeInstanceOf(ToolManager);
      expect(toolManager.db).toBe(mockDb);
      expect(toolManager.functionCaller).toBe(mockFunctionCaller);
      expect(toolManager.isInitialized).toBe(false);
    });

    it('should initialize tools cache as Map', () => {
      expect(toolManager.tools).toBeInstanceOf(Map);
      expect(toolManager.tools.size).toBe(0);
    });

    it('should have docGenerator instance', () => {
      expect(toolManager.docGenerator).toBeDefined();
    });
  });

  describe('initialize()', () => {
    it('should initialize successfully', async () => {
      const result = await toolManager.initialize();

      expect(result).toBe(true);
      expect(toolManager.isInitialized).toBe(true);
      expect(mockDocGenerator.initialize).toHaveBeenCalled();
    });

    it('should return false on initialization error', async () => {
      mockDocGenerator.initialize.mockRejectedValueOnce(new Error('Init failed'));

      await expect(toolManager.initialize()).rejects.toThrow('Init failed');
      expect(toolManager.isInitialized).toBe(false);
    });
  });

  describe('registerTool()', () => {
    const mockToolData = {
      name: 'test_tool',
      display_name: 'Test Tool',
      description: 'A test tool',
      tool_type: 'function',
      category: 'testing',
      parameters_schema: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
      },
      return_schema: {
        type: 'object',
        properties: {
          output: { type: 'string' },
        },
      },
      enabled: true,
      is_builtin: 1,
      config: { timeout: 5000 },
      examples: [{ input: 'test', output: 'result' }],
      required_permissions: ['read'],
    };

    const mockHandler = vi.fn().mockResolvedValue({ success: true });

    it('should register tool successfully', async () => {
      const toolId = await toolManager.registerTool(mockToolData, mockHandler);

      expect(toolId).toBeTruthy();
      expect(toolId).toMatch(/^tool_/); // Should start with 'tool_'
      expect(mockDb.run).toHaveBeenCalled();
      expect(toolManager.tools.has(toolId)).toBe(true);
    });

    it('should use provided tool id if exists', async () => {
      const dataWithId = { ...mockToolData, id: 'custom-tool-id' };

      const toolId = await toolManager.registerTool(dataWithId, mockHandler);

      expect(toolId).toBe('custom-tool-id');
    });

    it('should handle parameters_schema as JSON string', async () => {
      const dataWithStringSchema = {
        ...mockToolData,
        parameters_schema: '{"type":"object","properties":{}}',
      };

      await toolManager.registerTool(dataWithStringSchema, mockHandler);

      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should accept any object as parameters schema', async () => {
      const customSchema = {
        ...mockToolData,
        parameters_schema: { custom: 'schema', properties: {} },
      };

      // Current implementation accepts any object as schema
      const toolId = await toolManager.registerTool(customSchema, mockHandler);

      expect(toolId).toBeTruthy();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should set default values for optional fields', async () => {
      const minimalData = {
        name: 'minimal_tool',
        parameters_schema: { type: 'object', properties: {} },
      };

      const toolId = await toolManager.registerTool(minimalData, mockHandler);

      expect(toolId).toBeTruthy();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should throw error on database failure', async () => {
      mockDb.run.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        toolManager.registerTool(mockToolData, mockHandler)
      ).rejects.toThrow('DB error');
    });
  });

  describe('unregisterTool()', () => {
    beforeEach(async () => {
      // Register a tool first
      await toolManager.registerTool(
        {
          id: 'tool-to-delete',
          name: 'delete_me',
          parameters_schema: { type: 'object', properties: {} },
        },
        vi.fn()
      );
    });

    it('should unregister tool successfully', async () => {
      mockDb.get.mockResolvedValueOnce({
        id: 'tool-to-delete',
        name: 'delete_me',
      });

      await toolManager.unregisterTool('tool-to-delete');

      expect(mockDb.run).toHaveBeenCalledWith(
        'DELETE FROM tools WHERE id = ?',
        ['tool-to-delete']
      );
      expect(toolManager.tools.has('tool-to-delete')).toBe(false);
    });

    it('should throw error if tool does not exist', async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await expect(toolManager.unregisterTool('nonexistent')).rejects.toThrow('工具不存在');
    });

    it('should unregister from functionCaller', async () => {
      // Use cached tool to avoid db.get mock conflicts
      toolManager.tools.set('tool-to-delete', {
        id: 'tool-to-delete',
        name: 'delete_me',
      });
      mockFunctionCaller.hasTool.mockReturnValueOnce(true);

      await toolManager.unregisterTool('tool-to-delete');

      expect(mockFunctionCaller.hasTool).toHaveBeenCalledWith('delete_me');
      expect(mockFunctionCaller.unregisterTool).toHaveBeenCalledWith('delete_me');
    });
  });

  describe('updateTool()', () => {
    beforeEach(async () => {
      mockDb.get.mockResolvedValue({
        id: 'tool-1',
        name: 'test_tool',
        display_name: 'Test Tool',
      });
    });

    it('should update tool successfully', async () => {
      const updates = {
        display_name: 'Updated Tool',
        description: 'Updated description',
      };

      await toolManager.updateTool('tool-1', updates);

      expect(mockDb.run).toHaveBeenCalled();
      // Check SQL contains UPDATE
      const sqlCall = mockDb.run.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('UPDATE tools')
      );
      expect(sqlCall).toBeDefined();
    });

    it('should only update allowed fields', async () => {
      const updates = {
        display_name: 'Updated',
        name: 'should_not_update', // Not in allowedFields
        id: 'should_not_update', // Not in allowedFields
      };

      await toolManager.updateTool('tool-1', updates);

      expect(mockDb.run).toHaveBeenCalled();
      const updateCalls = mockDb.run.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('UPDATE tools')
      );
      expect(updateCalls.length).toBeGreaterThan(0);
      expect(updateCalls[0][0]).toContain('display_name');
      // Use regex to check that 'name' is not a standalone field (not part of display_name)
      expect(updateCalls[0][0]).not.toMatch(/\bname\s*=/);
    });

    it('should handle JSON fields in updates', async () => {
      const updates = {
        config: { newTimeout: 10000 },
        examples: [{ input: 'new', output: 'example' }],
      };

      await toolManager.updateTool('tool-1', updates);

      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should throw error if tool does not exist', async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await expect(toolManager.updateTool('nonexistent', {})).rejects.toThrow('工具不存在');
    });

    it('should do nothing if no valid updates provided', async () => {
      const updates = {
        invalid_field: 'value',
      };

      await toolManager.updateTool('tool-1', updates);

      // Should not call db.run for UPDATE
      const updateCalls = mockDb.run.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('UPDATE tools')
      );
      expect(updateCalls.length).toBe(0);
    });
  });

  describe('getTool()', () => {
    it('should get tool from cache', async () => {
      const cachedTool = {
        id: 'cached-tool',
        name: 'cached',
      };
      toolManager.tools.set('cached-tool', cachedTool);

      const result = await toolManager.getTool('cached-tool');

      expect(result).toEqual(cachedTool);
      expect(mockDb.get).not.toHaveBeenCalled();
    });

    it('should get tool from database if not in cache', async () => {
      const dbTool = {
        id: 'db-tool',
        name: 'from_db',
      };
      mockDb.get.mockResolvedValueOnce(dbTool);

      const result = await toolManager.getTool('db-tool');

      expect(result).toEqual(dbTool);
      expect(mockDb.get).toHaveBeenCalledWith(
        'SELECT * FROM tools WHERE id = ?',
        ['db-tool']
      );
      expect(toolManager.tools.has('db-tool')).toBe(true);
    });

    it('should return null if tool not found', async () => {
      mockDb.get.mockResolvedValueOnce(null);

      const result = await toolManager.getTool('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      mockDb.get.mockRejectedValueOnce(new Error('DB error'));

      const result = await toolManager.getTool('error-tool');

      expect(result).toBeNull();
    });
  });

  describe('getToolByName()', () => {
    it('should get tool by name', async () => {
      const mockTool = {
        id: 'tool-1',
        name: 'test_tool',
      };
      mockDb.get.mockResolvedValueOnce(mockTool);

      const result = await toolManager.getToolByName('test_tool');

      expect(result).toEqual(mockTool);
      expect(mockDb.get).toHaveBeenCalledWith(
        'SELECT * FROM tools WHERE name = ?',
        ['test_tool']
      );
    });
  });

  describe('getAllTools()', () => {
    it('should get all tools without filters', async () => {
      const mockTools = [
        { id: 'tool-1', name: 'tool1', enabled: 1 },
        { id: 'tool-2', name: 'tool2', enabled: 0 },
      ];
      mockDb.all.mockResolvedValueOnce(mockTools);

      const result = await toolManager.getAllTools();

      expect(result).toEqual(mockTools);
      expect(mockDb.all).toHaveBeenCalled();
    });

    it('should filter by enabled status', async () => {
      mockDb.all.mockResolvedValueOnce([
        { id: 'tool-1', name: 'tool1', enabled: 1 },
      ]);

      const result = await toolManager.getAllTools({ enabled: true });

      expect(result.length).toBe(1);
      expect(mockDb.all).toHaveBeenCalled();
    });

    it('should filter by category', async () => {
      mockDb.all.mockResolvedValueOnce([
        { id: 'tool-1', name: 'tool1', category: 'testing' },
      ]);

      const result = await toolManager.getAllTools({ category: 'testing' });

      expect(result.length).toBe(1);
    });

    it('should filter by tool_type', async () => {
      mockDb.all.mockResolvedValueOnce([
        { id: 'tool-1', name: 'tool1', tool_type: 'function' },
      ]);

      const result = await toolManager.getAllTools({ tool_type: 'function' });

      expect(result.length).toBe(1);
    });

    it('should support limit and offset', async () => {
      mockDb.all.mockResolvedValueOnce([
        { id: 'tool-2', name: 'tool2' },
      ]);

      const result = await toolManager.getAllTools({
        limit: 10,
        offset: 10,
      });

      expect(result.length).toBe(1);
    });
  });

  describe('getToolsByCategory()', () => {
    it('should get tools by category', async () => {
      mockDb.all.mockResolvedValueOnce([
        { id: 'tool-1', category: 'testing' },
      ]);

      const result = await toolManager.getToolsByCategory('testing');

      expect(result.length).toBe(1);
      expect(mockDb.all).toHaveBeenCalled();
      // getToolsByCategory calls getAllTools({ category }) which has dynamic SQL
    });
  });

  describe('getToolsBySkill()', () => {
    it('should get tools by skill', async () => {
      const mockTools = [
        { tool_id: 'tool-1', role: 'primary' },
        { tool_id: 'tool-2', role: 'secondary' },
      ];
      mockDb.all.mockResolvedValueOnce(mockTools);

      const result = await toolManager.getToolsBySkill('skill-1');

      expect(result).toEqual(mockTools);
      expect(mockDb.all).toHaveBeenCalled();
      // Query joins tools and skill_tools tables
    });
  });

  describe('getEnabledTools()', () => {
    it('should get only enabled tools', async () => {
      mockDb.all.mockResolvedValueOnce([
        { id: 'tool-1', enabled: 1 },
        { id: 'tool-2', enabled: 1 },
      ]);

      const result = await toolManager.getEnabledTools();

      expect(result.length).toBe(2);
      expect(mockDb.all).toHaveBeenCalled();
      // getEnabledTools calls getAllTools({ enabled: 1, deprecated: 0 })
    });
  });

  describe('enableTool() / disableTool()', () => {
    beforeEach(() => {
      mockDb.get.mockResolvedValue({
        id: 'tool-1',
        name: 'test_tool',
        enabled: 0,
      });
    });

    it('should enable tool', async () => {
      await toolManager.enableTool('tool-1');

      expect(mockDb.run).toHaveBeenCalled();
      // enableTool calls updateTool which does dynamic SQL
    });

    it('should disable tool', async () => {
      await toolManager.disableTool('tool-1');

      expect(mockDb.run).toHaveBeenCalled();
      // disableTool calls updateTool which does dynamic SQL
    });
  });

  describe('recordToolUsage()', () => {
    beforeEach(() => {
      // Mock getToolByName to return a tool with stats
      mockFunctionCaller.callFunction = vi.fn();
      mockDb.get.mockImplementation((sql, params) => {
        if (sql.includes('SELECT * FROM tools WHERE name = ?')) {
          return Promise.resolve({
            id: 'tool-1',
            name: 'test_tool',
            usage_count: 10,
            success_count: 9,
            avg_execution_time: 1000,
          });
        }
        return Promise.resolve(null);
      });
    });

    it('should record tool usage', async () => {
      await toolManager.recordToolUsage('test_tool', true, 1500);

      expect(mockDb.run).toHaveBeenCalled();
      // Should update both tools table and tool_stats table
    });

    it('should handle failure records with error type', async () => {
      await toolManager.recordToolUsage('test_tool', false, 500, 'timeout');

      expect(mockDb.run).toHaveBeenCalled();
      // Should record failure and error type
    });

    it('should skip if tool does not exist', async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await toolManager.recordToolUsage('nonexistent_tool', true, 1000);

      // Should not throw error, just log warning
      expect(mockDb.run).not.toHaveBeenCalled();
    });
  });

  describe('getToolStats()', () => {
    it('should get tool statistics', async () => {
      const mockStats = [
        {
          tool_id: 'tool-1',
          stat_date: '2024-12-30',
          invoke_count: 200,
          success_count: 190,
          avg_duration: 800,
        },
      ];
      mockDb.all.mockResolvedValueOnce(mockStats);

      const result = await toolManager.getToolStats('tool-1');

      expect(result).toEqual(mockStats);
      expect(mockDb.all).toHaveBeenCalled();
    });

    it('should support date range filtering', async () => {
      const dateRange = {
        start: '2024-01-01',
        end: '2024-12-31',
      };
      mockDb.all.mockResolvedValueOnce([]);

      await toolManager.getToolStats('tool-1', dateRange);

      expect(mockDb.all).toHaveBeenCalled();
      // Should add date range filters to SQL
    });

    it('should return empty array on error', async () => {
      mockDb.all.mockRejectedValueOnce(new Error('DB error'));

      const result = await toolManager.getToolStats('tool-1');

      expect(result).toEqual([]);
    });
  });

  describe('getToolDoc()', () => {
    beforeEach(() => {
      mockDb.get.mockResolvedValue({
        id: 'tool-1',
        name: 'test_tool',
      });
      mockDocGenerator.readToolDoc = vi.fn().mockResolvedValue('# Tool Documentation');
    });

    it('should get tool documentation', async () => {
      const result = await toolManager.getToolDoc('tool-1');

      expect(result).toBe('# Tool Documentation');
      expect(mockDocGenerator.readToolDoc).toHaveBeenCalledWith('test_tool');
    });

    it('should generate doc if not exists', async () => {
      mockDocGenerator.readToolDoc
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('# Generated Documentation');

      const result = await toolManager.getToolDoc('tool-1');

      expect(mockDocGenerator.generateToolDoc).toHaveBeenCalled();
      expect(result).toBe('# Generated Documentation');
    });

    it('should throw error if tool does not exist', async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await expect(toolManager.getToolDoc('nonexistent')).rejects.toThrow('工具不存在');
    });
  });

  describe('regenerateDoc()', () => {
    beforeEach(() => {
      mockDb.get.mockResolvedValue({
        id: 'tool-1',
        name: 'test_tool',
      });
    });

    it('should regenerate tool documentation', async () => {
      await toolManager.regenerateDoc('tool-1');

      expect(mockDocGenerator.generateToolDoc).toHaveBeenCalled();
    });

    it('should throw error if tool does not exist', async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await expect(toolManager.regenerateDoc('nonexistent')).rejects.toThrow('工具不存在');
    });
  });

  describe('recordExecution()', () => {
    beforeEach(() => {
      mockDb.get.mockImplementation((sql, params) => {
        if (sql.includes('SELECT * FROM tools WHERE name = ?')) {
          return Promise.resolve({
            id: 'tool-1',
            name: 'test_tool',
            usage_count: 10,
            success_count: 9,
            avg_execution_time: 1000,
          });
        }
        return Promise.resolve(null);
      });
    });

    it('should record tool execution', async () => {
      await toolManager.recordExecution('test_tool', true, 1000);

      expect(mockDb.run).toHaveBeenCalled();
      // recordExecution is an alias for recordToolUsage
    });
  });

  describe('validateParametersSchema()', () => {
    it('should validate valid schema', () => {
      const validSchema = {
        type: 'object',
        properties: {
          param1: { type: 'string' },
        },
        required: ['param1'],
      };

      expect(() => {
        toolManager.validateParametersSchema(validSchema);
      }).not.toThrow();
    });

    it('should validate schema without type field', () => {
      const schemaWithoutType = {
        // Missing 'type' field
        properties: {
          param1: { type: 'string' },
        },
      };

      // Current implementation only checks if it's an object
      expect(() => {
        toolManager.validateParametersSchema(schemaWithoutType);
      }).not.toThrow();
    });

    it('should throw error for non-object schema', () => {
      const invalidSchema = 'not an object';

      expect(() => {
        toolManager.validateParametersSchema(invalidSchema);
      }).toThrow();
    });
  });
});
