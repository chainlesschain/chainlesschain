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

// Mock FunctionCaller
class MockFunctionCaller {
  constructor() {
    this.tools = new Map(); // toolName -> { handler, schema }
  }

  registerTool(name, handler, schema) {
    this.tools.set(name, { handler, schema });
  }

  unregisterTool(name) {
    this.tools.delete(name);
  }

  hasTool(name) {
    return this.tools.has(name);
  }

  getAvailableTools() {
    const tools = [];
    for (const [name, { schema }] of this.tools.entries()) {
      tools.push({
        name,
        ...schema,
      });
    }
    return tools;
  }

  async callTool(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return await tool.handler(args);
  }
}

// Mock数据库
class MockDatabase {
  constructor() {
    this.data = {
      tools: [],
      tool_stats: [],
    };
  }

  // 直接调用的 get 方法
  async get(query, params = []) {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('from tools where id')) {
      return this.data.tools.find(t => t.id === params[0]) || null;
    } else if (lowerQuery.includes('from tools where name')) {
      return this.data.tools.find(t => t.name === params[0]) || null;
    }
    return null;
  }

  // 直接调用的 all 方法
  async all(query, params = []) {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('from tools')) {
      let results = [...this.data.tools];

      // 处理多个筛选条件 - 按SQL查询中的条件顺序匹配参数
      let paramIndex = 0;

      if (lowerQuery.includes('and enabled = ?') && paramIndex < params.length) {
        const enabled = params[paramIndex++];
        if (enabled !== null && enabled !== undefined) {
          results = results.filter(t => t.enabled === enabled);
        }
      }

      if (lowerQuery.includes('and category = ?') && paramIndex < params.length) {
        const category = params[paramIndex++];
        if (category !== null && category !== undefined) {
          results = results.filter(t => t.category === category);
        }
      }

      if (lowerQuery.includes('and plugin_id = ?') && paramIndex < params.length) {
        const plugin_id = params[paramIndex++];
        if (plugin_id !== null && plugin_id !== undefined) {
          results = results.filter(t => t.plugin_id === plugin_id);
        }
      }

      if (lowerQuery.includes('and is_builtin = ?') && paramIndex < params.length) {
        const is_builtin = params[paramIndex++];
        if (is_builtin !== null && is_builtin !== undefined) {
          results = results.filter(t => t.is_builtin === is_builtin);
        }
      }

      if (lowerQuery.includes('and deprecated = ?') && paramIndex < params.length) {
        const deprecated = params[paramIndex++];
        if (deprecated !== null && deprecated !== undefined) {
          results = results.filter(t => t.deprecated === deprecated);
        }
      }

      return results;
    }
    return [];
  }

  // 直接调用的 run 方法
  async run(query, params = []) {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('insert into tools') || lowerQuery.includes('insert or ignore into tools')) {
      const tool = this._parseInsertTool(query, params);
      this.data.tools.push(tool);
      return { changes: 1 };
    } else if (lowerQuery.includes('delete from tools')) {
      const prevLength = this.data.tools.length;
      this.data.tools = this.data.tools.filter(t => t.id !== params[0]);
      return { changes: prevLength - this.data.tools.length };
    } else if (lowerQuery.includes('update tools')) {
      // The last param is always the tool ID (WHERE id = ?)
      const toolId = params[params.length - 1];
      const index = this.data.tools.findIndex(t => t.id === toolId);

      if (index >= 0) {
        // Parse the SET clause to extract field names
        const setMatch = query.match(/SET\s+(.+?)\s+WHERE/i);
        if (setMatch) {
          const setPairs = setMatch[1].split(',').map(s => s.trim());
          let paramIndex = 0;

          // Apply each update
          for (const pair of setPairs) {
            const fieldName = pair.split('=')[0].trim();
            if (paramIndex < params.length - 1) { // -1 because last param is toolId
              this.data.tools[index][fieldName] = params[paramIndex];
              paramIndex++;
            }
          }
        }

        return { changes: 1 };
      }
      return { changes: 0 };
    }
    return { changes: 0 };
  }

  prepare(query) {
    const lowerQuery = query.toLowerCase();

    return {
      run: (...args) => {
        if (lowerQuery.includes('insert into tools') || lowerQuery.includes('insert or ignore into tools')) {
          const tool = this._parseInsertTool(query, args);
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

  _parseInsertTool(query, args) {
    // Detect which INSERT format is being used based on the query
    const lowerQuery = query.toLowerCase();

    // loadBuiltInTools format: 14 parameters
    // (id, name, display_name, description, category,
    //  parameters_schema, is_builtin, enabled,
    //  tool_type, usage_count, success_count, avg_execution_time,
    //  created_at, updated_at)
    if (args.length === 14 && lowerQuery.includes('insert or ignore')) {
      return {
        id: args[0],
        name: args[1],
        display_name: args[2] || '',
        description: args[3] || '',
        category: args[4] || '',
        parameters_schema: args[5] || '{}',
        is_builtin: args[6] !== undefined ? args[6] : 0,
        enabled: args[7] !== undefined ? args[7] : 1,
        tool_type: args[8] || 'function',
        usage_count: args[9] || 0,
        success_count: args[10] || 0,
        avg_execution_time: args[11] || 0,
        created_at: args[12] || Date.now(),
        updated_at: args[13] || Date.now(),
        return_schema: '{}',
        plugin_id: null,
        handler_path: '',
        deprecated: 0,
        config: '{}',
        examples: '[]',
        doc_path: '',
        required_permissions: '[]',
        risk_level: 1,
        last_used_at: null,
      };
    }

    // registerTool format: 18+ parameters
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
  let mockFunctionCaller;

  beforeEach(async () => {
    mockDb = new MockDatabase();
    mockFunctionCaller = new MockFunctionCaller();
    const ToolManager = await loadToolManager();

    // Mock DocGenerator to avoid file system dependencies
    const MockDocGenerator = class {
      async initialize() {}
      async generateToolDoc() {}
      async readToolDoc() { return null; }
      async generateAllDocs() {}
    };

    toolManager = new ToolManager(mockDb, mockFunctionCaller, {
      DocGeneratorClass: MockDocGenerator,
    });
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
      const tools = await toolManager.getAllTools();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools).toHaveLength(2);
    });

    it('应该按分类筛选工具', async () => {
      const tools = await toolManager.getToolsByCategory('file');

      expect(Array.isArray(tools)).toBe(true);
      expect(tools).toHaveLength(1);
      expect(tools[0].category).toBe('file');
    });

    it('应该通过ID获取工具', async () => {
      const allTools = await toolManager.getAllTools();
      const toolId = allTools[0].id;

      const result = await toolManager.getToolById(toolId);

      expect(result.success).toBe(true);
      expect(result.tool).toBeDefined();
      expect(result.tool.id).toBe(toolId);
    });

    it('应该通过名称获取工具', async () => {
      const tool = await toolManager.getToolByName('tool1');

      expect(tool).toBeDefined();
      expect(tool).not.toBeNull();
      expect(tool.name).toBe('tool1');
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
    beforeEach(() => {
      // 注册一些模拟的内置工具到 FunctionCaller
      mockFunctionCaller.registerTool('file_reader', async (args) => {
        return { content: 'mock file content' };
      }, {
        name: 'file_reader',
        description: 'Read file content',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          }
        }
      });

      mockFunctionCaller.registerTool('file_writer', async (args) => {
        return { success: true };
      }, {
        name: 'file_writer',
        description: 'Write file content',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          }
        }
      });
    });

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
