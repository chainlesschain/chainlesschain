/**
 * ToolManager 单元测试
 */

import './setup.js'; // 导入测试环境设置
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

// Mock dependencies
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'tool_test_id_456'),
}));

// Mock数据库
class MockDatabase {
  constructor() {
    this.data = {
      tools: [],
      tool_stats: [],
    };
  }

  prepare(query) {
    const lowerQuery = query.toLowerCase();

    return {
      run: (...args) => {
        if (lowerQuery.includes('insert into tools')) {
          const tool = this._parseInsertTool(args);
          this.data.tools.push(tool);
          return { changes: 1 };
        } else if (lowerQuery.includes('delete from tools')) {
          const prevLength = this.data.tools.length;
          this.data.tools = this.data.tools.filter(t => t.id !== args[0]);
          return { changes: prevLength - this.data.tools.length };
        } else if (lowerQuery.includes('update tools')) {
          const index = this.data.tools.findIndex(t => t.id === args[args.length - 1]);
          if (index >= 0) {
            this.data.tools[index].updated_at = Date.now();
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        return { changes: 0 };
      },
      get: (...args) => {
        if (lowerQuery.includes('from tools where id')) {
          return this.data.tools.find(t => t.id === args[0]) || null;
        } else if (lowerQuery.includes('from tools where name')) {
          return this.data.tools.find(t => t.name === args[0]) || null;
        }
        return null;
      },
      all: (...args) => {
        if (lowerQuery.includes('from tools')) {
          return this.data.tools;
        }
        return [];
      },
    };
  }

  _parseInsertTool(args) {
    return {
      id: args[0],
      name: args[1],
      display_name: args[2] || '',
      description: args[3] || '',
      tool_type: args[4] || 'function',
      category: args[5] || '',
      parameters_schema: args[6] || '{}',
      return_schema: args[7] || '{}',
      is_builtin: args[8] !== undefined ? args[8] : 0,
      plugin_id: args[9] || null,
      handler_path: args[10] || '',
      enabled: args[11] !== undefined ? args[11] : 1,
      deprecated: args[12] !== undefined ? args[12] : 0,
      config: args[13] || '{}',
      examples: args[14] || '[]',
      doc_path: args[15] || '',
      required_permissions: args[16] || '[]',
      risk_level: args[17] !== undefined ? args[17] : 1,
      usage_count: 0,
      success_count: 0,
      avg_execution_time: 0,
      last_used_at: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
  }
}

// 动态导入 ToolManager
async function loadToolManager() {
  const modulePath = path.resolve(__dirname, '../tool-manager.js');
  const ToolManager = (await import(modulePath)).default;
  return ToolManager;
}

describe('ToolManager', () => {
  let toolManager;
  let mockDb;

  beforeEach(async () => {
    mockDb = new MockDatabase();
    const ToolManager = await loadToolManager();
    toolManager = new ToolManager(mockDb);
  });

  describe('创建工具', () => {
    it('应该成功创建工具', async () => {
      const toolData = {
        name: 'test_tool',
        display_name: 'Test Tool',
        description: '测试工具',
        tool_type: 'function',
        category: 'file',
        parameters_schema: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
          },
        },
      };

      const result = await toolManager.createTool(toolData);

      expect(result.success).toBe(true);
      expect(result.tool).toBeDefined();
      expect(result.tool.name).toBe('test_tool');
      expect(result.tool.tool_type).toBe('function');
    });

    it('缺少必填字段应该失败', async () => {
      const toolData = {
        display_name: 'Test Tool',
        // 缺少 name
      };

      const result = await toolManager.createTool(toolData);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('应该正确序列化JSON字段', async () => {
      const toolData = {
        name: 'test_tool_with_json',
        category: 'file',
        parameters_schema: {
          type: 'object',
          properties: { test: { type: 'string' } },
        },
        config: { timeout: 5000 },
        required_permissions: ['file:read', 'file:write'],
      };

      const result = await toolManager.createTool(toolData);

      expect(result.success).toBe(true);
      expect(typeof result.tool.parameters_schema).toBe('string');
      expect(typeof result.tool.config).toBe('string');
      expect(typeof result.tool.required_permissions).toBe('string');
    });
  });

  describe('获取工具', () => {
    beforeEach(async () => {
      await toolManager.createTool({
        name: 'tool1',
        category: 'file',
        tool_type: 'function',
      });
      await toolManager.createTool({
        name: 'tool2',
        category: 'network',
        tool_type: 'api',
      });
    });

    it('应该获取所有工具', async () => {
      const result = await toolManager.getAllTools();

      expect(result.success).toBe(true);
      expect(result.tools).toHaveLength(2);
    });

    it('应该按分类筛选工具', async () => {
      const result = await toolManager.getToolsByCategory('file');

      expect(result.success).toBe(true);
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].category).toBe('file');
    });

    it('应该通过ID获取工具', async () => {
      const all = await toolManager.getAllTools();
      const toolId = all.tools[0].id;

      const result = await toolManager.getToolById(toolId);

      expect(result.success).toBe(true);
      expect(result.tool).toBeDefined();
      expect(result.tool.id).toBe(toolId);
    });

    it('应该通过名称获取工具', async () => {
      const result = await toolManager.getToolByName('tool1');

      expect(result.success).toBe(true);
      expect(result.tool).toBeDefined();
      expect(result.tool.name).toBe('tool1');
    });

    it('获取不存在的工具应返回null', async () => {
      const result = await toolManager.getToolById('non_existent_id');

      expect(result.success).toBe(true);
      expect(result.tool).toBeNull();
    });
  });

  describe('更新工具', () => {
    let toolId;

    beforeEach(async () => {
      const created = await toolManager.createTool({
        name: 'update_test_tool',
        category: 'file',
      });
      toolId = created.tool.id;
    });

    it('应该成功更新工具', async () => {
      const result = await toolManager.updateTool(toolId, {
        display_name: '更新后的工具',
        description: '新描述',
      });

      expect(result.success).toBe(true);
      expect(result.changes).toBeGreaterThan(0);
    });

    it('更新不存在的工具应返回0变更', async () => {
      const result = await toolManager.updateTool('non_existent', {
        name: 'test',
      });

      expect(result.changes).toBe(0);
    });
  });

  describe('删除工具', () => {
    let toolId;

    beforeEach(async () => {
      const created = await toolManager.createTool({
        name: 'delete_test_tool',
        category: 'file',
      });
      toolId = created.tool.id;
    });

    it('应该成功删除工具', async () => {
      const result = await toolManager.deleteTool(toolId);

      expect(result.success).toBe(true);
      expect(result.changes).toBe(1);

      // 验证已删除
      const getResult = await toolManager.getToolById(toolId);
      expect(getResult.tool).toBeNull();
    });
  });

  describe('启用/禁用工具', () => {
    let toolId;

    beforeEach(async () => {
      const created = await toolManager.createTool({
        name: 'toggle_test_tool',
        category: 'file',
        enabled: 1,
      });
      toolId = created.tool.id;
    });

    it('应该成功禁用工具', async () => {
      const result = await toolManager.toggleToolEnabled(toolId, false);

      expect(result.success).toBe(true);
      expect(result.changes).toBeGreaterThan(0);
    });

    it('应该成功启用工具', async () => {
      await toolManager.toggleToolEnabled(toolId, false);
      const result = await toolManager.toggleToolEnabled(toolId, true);

      expect(result.success).toBe(true);
      expect(result.changes).toBeGreaterThan(0);
    });
  });

  describe('工具统计', () => {
    beforeEach(async () => {
      await toolManager.createTool({
        name: 'tool_a',
        category: 'file',
        tool_type: 'function',
      });
      await toolManager.createTool({
        name: 'tool_b',
        category: 'network',
        tool_type: 'api',
      });
      await toolManager.createTool({
        name: 'tool_c',
        category: 'file',
        tool_type: 'function',
      });
    });

    it('应该返回正确的工具数量', async () => {
      const result = await toolManager.getToolCount();

      expect(result.count).toBe(3);
    });

    it('应该返回工具统计信息', async () => {
      const result = await toolManager.getToolStats();

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats.totalTools).toBe(3);
      expect(result.stats.categories).toBeDefined();
      expect(result.stats.types).toBeDefined();
      expect(result.stats.categories.file).toBe(2);
      expect(result.stats.types.function).toBe(2);
      expect(result.stats.types.api).toBe(1);
    });
  });

  describe('内置工具加载', () => {
    it('应该成功加载内置工具', async () => {
      const result = await toolManager.loadBuiltinTools();

      expect(result.success).toBe(true);
      expect(result.loaded).toBeGreaterThan(0);
    });
  });

  describe('工具验证', () => {
    it('应该验证工具参数schema', () => {
      const validSchema = {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
        },
        required: ['filePath'],
      };

      const isValid = toolManager.validateParametersSchema(validSchema);
      expect(isValid).toBe(true);
    });

    it('无效的schema应该返回false', () => {
      const invalidSchema = {
        // 缺少 type 字段
        properties: {
          test: {},
        },
      };

      const isValid = toolManager.validateParametersSchema(invalidSchema);
      expect(isValid).toBe(false);
    });
  });
});
