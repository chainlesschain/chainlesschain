/**
 * ExtendedTools 单元测试
 * 测试基础扩展工具的功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
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

describe('ExtendedTools', () => {
  let ExtendedTools;
  let mockFunctionCaller;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import('../../../src/main/ai-engine/extended-tools.js');
    ExtendedTools = module.default || module.ExtendedTools;

    // Mock FunctionCaller
    mockFunctionCaller = {
      registerTool: vi.fn(),
      tools: new Map(),
    };
  });

  // ==================== 工具注册测试 ====================

  describe('registerAll', () => {
    it('应该注册所有扩展工具', () => {
      ExtendedTools.registerAll(mockFunctionCaller);

      // 验证注册了多个工具
      expect(mockFunctionCaller.registerTool).toHaveBeenCalled();
      expect(mockFunctionCaller.registerTool.mock.calls.length).toBeGreaterThan(0);
    });

    it('应该注册 json_parser 工具', () => {
      ExtendedTools.registerAll(mockFunctionCaller);

      const jsonParserCall = mockFunctionCaller.registerTool.mock.calls.find(
        call => call[0] === 'json_parser'
      );
      expect(jsonParserCall).toBeDefined();
      expect(jsonParserCall[1]).toBeTypeOf('function');
      expect(jsonParserCall[2]).toHaveProperty('name', 'json_parser');
    });

    it('应该注册 yaml_parser 工具', () => {
      ExtendedTools.registerAll(mockFunctionCaller);

      const yamlParserCall = mockFunctionCaller.registerTool.mock.calls.find(
        call => call[0] === 'yaml_parser'
      );
      expect(yamlParserCall).toBeDefined();
    });
  });

  // ==================== JSON Parser 测试 ====================

  describe('json_parser', () => {
    let jsonParser;

    beforeEach(() => {
      ExtendedTools.registerAll(mockFunctionCaller);
      const jsonParserCall = mockFunctionCaller.registerTool.mock.calls.find(
        call => call[0] === 'json_parser'
      );
      jsonParser = jsonParserCall[1];
    });

    describe('parse 操作', () => {
      it('应该正确解析 JSON 字符串', async () => {
        const result = await jsonParser({
          json: '{"key": "value"}',
          action: 'parse',
        });

        expect(result.success).toBe(true);
        expect(result.result).toEqual({ key: 'value' });
      });

      it('应该解析数组 JSON', async () => {
        const result = await jsonParser({
          json: '[1, 2, 3]',
          action: 'parse',
        });

        expect(result.success).toBe(true);
        expect(result.result).toEqual([1, 2, 3]);
      });

      it('应该处理嵌套对象', async () => {
        const json = '{"user": {"name": "Alice", "age": 30}}';
        const result = await jsonParser({ json, action: 'parse' });

        expect(result.success).toBe(true);
        expect(result.result.user.name).toBe('Alice');
      });

      it('应该处理无效的 JSON', async () => {
        const result = await jsonParser({
          json: '{invalid json}',
          action: 'parse',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('validate 操作', () => {
      it('应该验证有效的 JSON', async () => {
        const result = await jsonParser({
          json: '{"valid": true}',
          action: 'validate',
        });

        expect(result.success).toBe(true);
        expect(result.result).toBe(true);
        expect(result.error).toBeNull();
      });

      it('应该检测无效的 JSON', async () => {
        const result = await jsonParser({
          json: '{invalid',
          action: 'validate',
        });

        expect(result.success).toBe(false);
        expect(result.result).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('应该验证空对象', async () => {
        const result = await jsonParser({
          json: '{}',
          action: 'validate',
        });

        expect(result.success).toBe(true);
        expect(result.result).toBe(true);
      });
    });

    describe('format 操作', () => {
      it('应该格式化 JSON 字符串', async () => {
        const result = await jsonParser({
          json: '{"key":"value"}',
          action: 'format',
          indent: 2,
        });

        expect(result.success).toBe(true);
        expect(result.result).toContain('\n');
        expect(result.result).toContain('  "key"');
      });

      it('应该支持自定义缩进', async () => {
        const result = await jsonParser({
          json: '{"key":"value"}',
          action: 'format',
          indent: 4,
        });

        expect(result.success).toBe(true);
        expect(result.result).toContain('    "key"');
      });

      it('应该使用默认缩进', async () => {
        const result = await jsonParser({
          json: '{"key":"value"}',
          action: 'format',
        });

        expect(result.success).toBe(true);
        expect(result.result).toMatch(/"key":\s+"value"/);
      });
    });

    describe('minify 操作', () => {
      it('应该压缩 JSON 字符串', async () => {
        const result = await jsonParser({
          json: '{\n  "key": "value"\n}',
          action: 'minify',
        });

        expect(result.success).toBe(true);
        expect(result.result).toBe('{"key":"value"}');
        expect(result.result).not.toContain('\n');
      });

      it('应该压缩数组', async () => {
        const result = await jsonParser({
          json: '[\n  1,\n  2,\n  3\n]',
          action: 'minify',
        });

        expect(result.success).toBe(true);
        expect(result.result).toBe('[1,2,3]');
      });
    });

    describe('错误处理', () => {
      it('应该处理未知操作', async () => {
        const result = await jsonParser({
          json: '{}',
          action: 'unknown_action',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('未知的操作');
      });

      it('应该处理空输入', async () => {
        const result = await jsonParser({
          json: '',
          action: 'parse',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });
  });

  // ==================== YAML Parser 测试 ====================

  describe('yaml_parser', () => {
    let yamlParser;

    beforeEach(() => {
      ExtendedTools.registerAll(mockFunctionCaller);
      const yamlParserCall = mockFunctionCaller.registerTool.mock.calls.find(
        call => call[0] === 'yaml_parser'
      );
      yamlParser = yamlParserCall[1];
    });

    describe('parse 操作', () => {
      it('应该解析简单的 YAML', async () => {
        const yaml = 'name: Alice\nage: 30';
        const result = await yamlParser({
          content: yaml,
          action: 'parse',
        });

        expect(result.success).toBe(true);
        expect(result.result.name).toBe('Alice');
        expect(result.result.age).toBe(30);
      });

      it('应该跳过注释行', async () => {
        const yaml = '# Comment\nname: Bob\n# Another comment\nage: 25';
        const result = await yamlParser({
          content: yaml,
          action: 'parse',
        });

        expect(result.success).toBe(true);
        expect(result.result.name).toBe('Bob');
        expect(result.result.age).toBe(25);
      });

      it('应该跳过空行', async () => {
        const yaml = 'name: Alice\n\nage: 30\n\n';
        const result = await yamlParser({
          content: yaml,
          action: 'parse',
        });

        expect(result.success).toBe(true);
        expect(result.result).toHaveProperty('name');
        expect(result.result).toHaveProperty('age');
      });

      it('应该处理数字值', async () => {
        const yaml = 'port: 8080\nversion: 1.5';
        const result = await yamlParser({
          content: yaml,
          action: 'parse',
        });

        expect(result.success).toBe(true);
        expect(result.result.port).toBe(8080);
        expect(result.result.version).toBe(1.5);
      });

      it('应该处理字符串值', async () => {
        const yaml = 'name: Alice\ndescription: A developer';
        const result = await yamlParser({
          content: yaml,
          action: 'parse',
        });

        expect(result.success).toBe(true);
        expect(result.result.name).toBe('Alice');
        expect(result.result.description).toBe('A developer');
      });

      it('应该处理值中的冒号', async () => {
        const yaml = 'url: http://example.com:8080';
        const result = await yamlParser({
          content: yaml,
          action: 'parse',
        });

        expect(result.success).toBe(true);
        expect(result.result.url).toBe('http://example.com:8080');
      });
    });

    describe('stringify 操作', () => {
      it('应该将对象转换为 YAML', async () => {
        const json = '{"name":"Alice","age":30}';
        const result = await yamlParser({
          content: json,
          action: 'stringify',
        });

        expect(result.success).toBe(true);
        expect(result.result).toContain('name: Alice');
        expect(result.result).toContain('age: 30');
      });

      it('应该处理数字值', async () => {
        const json = '{"port":8080}';
        const result = await yamlParser({
          content: json,
          action: 'stringify',
        });

        expect(result.success).toBe(true);
        expect(result.result).toContain('port: 8080');
      });
    });

    describe('错误处理', () => {
      it('应该处理未知操作', async () => {
        const result = await yamlParser({
          content: 'name: Alice',
          action: 'unknown_action',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('未知的操作');
      });

      it('应该处理无效的 JSON（stringify）', async () => {
        const result = await yamlParser({
          content: '{invalid json}',
          action: 'stringify',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });
  });

  // ==================== 边界情况测试 ====================

  describe('边界情况', () => {
    it('应该处理空的 FunctionCaller', () => {
      const emptyFunctionCaller = {
        registerTool: vi.fn(),
      };

      expect(() => {
        ExtendedTools.registerAll(emptyFunctionCaller);
      }).not.toThrow();
    });

    it('应该处理重复注册', () => {
      ExtendedTools.registerAll(mockFunctionCaller);
      const firstCallCount = mockFunctionCaller.registerTool.mock.calls.length;

      ExtendedTools.registerAll(mockFunctionCaller);
      const secondCallCount = mockFunctionCaller.registerTool.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount * 2);
    });
  });
});
