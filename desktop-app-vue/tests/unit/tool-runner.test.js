/**
 * ToolRunner 单元测试
 *
 * 测试工具运行器的核心功能：
 * - 工具执行
 * - 参数验证
 * - 工具实现（文件操作、代码生成等）
 * - 错误处理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ===================== MOCK SETUP =====================

// Mock fs.promises
const mockFs = {
  readFile: vi.fn().mockResolvedValue('file content'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
};

vi.mock('fs', () => ({
  promises: mockFs,
}));

// Mock path
vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual,
    normalize: vi.fn((p) => p),
    join: vi.fn((...args) => args.join('/')),
  };
});

// Import after mocks
const ToolRunner = require('../../src/main/skill-tool-system/tool-runner');

// ===================== MOCK FACTORIES =====================

const createMockToolManager = () => ({
  getToolByName: vi.fn().mockResolvedValue({
    id: 'tool-1',
    name: 'test_tool',
    enabled: true,
    parameters_schema: {
      type: 'object',
      properties: {
        input: { type: 'string' },
      },
      required: ['input'],
    },
  }),
  recordExecution: vi.fn().mockResolvedValue(true),
});

// ===================== TESTS =====================

describe('ToolRunner', () => {
  let runner;
  let mockToolMgr;

  beforeEach(() => {
    vi.clearAllMocks();

    mockToolMgr = createMockToolManager();
    runner = new ToolRunner(mockToolMgr);
  });

  describe('构造函数', () => {
    it('should create instance with toolManager', () => {
      expect(runner).toBeInstanceOf(ToolRunner);
      expect(runner.toolManager).toBe(mockToolMgr);
    });

    it('should initialize tool implementations', () => {
      expect(runner.toolImplementations).toBeDefined();
      expect(runner.toolImplementations).toBeInstanceOf(Object);
    });

    it('should have file operation tools', () => {
      expect(runner.toolImplementations.file_reader).toBeDefined();
      expect(runner.toolImplementations.file_writer).toBeDefined();
      expect(runner.toolImplementations.file_editor).toBeDefined();
    });

    it('should have code generation tools', () => {
      expect(runner.toolImplementations.html_generator).toBeDefined();
      expect(runner.toolImplementations.css_generator).toBeDefined();
      expect(runner.toolImplementations.js_generator).toBeDefined();
    });

    it('should have project management tools', () => {
      expect(runner.toolImplementations.create_project_structure).toBeDefined();
      expect(runner.toolImplementations.git_init).toBeDefined();
      expect(runner.toolImplementations.git_commit).toBeDefined();
    });

    it('should have utility tools', () => {
      expect(runner.toolImplementations.info_searcher).toBeDefined();
      expect(runner.toolImplementations.format_output).toBeDefined();
      expect(runner.toolImplementations.generic_handler).toBeDefined();
    });
  });

  describe('executeTool()', () => {
    it('should execute tool successfully', async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce({
        id: 'tool-1',
        name: 'generic_handler',
        enabled: true,
        parameters_schema: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
      });

      const params = { input: 'test' };
      const result = await runner.executeTool('generic_handler', params);

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('generic_handler');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(mockToolMgr.recordExecution).toHaveBeenCalledWith('generic_handler', true, expect.any(Number));
    });

    it('should throw error if tool does not exist', async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce(null);

      const result = await runner.executeTool('nonexistent', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('工具不存在');
    });

    it('should throw error if tool is disabled', async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce({
        id: 'tool-1',
        name: 'test_tool',
        enabled: false,
        parameters_schema: {},
      });

      const result = await runner.executeTool('test_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('工具已禁用');
    });

    it('should validate params before execution', async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce({
        id: 'tool-1',
        name: 'test_tool',
        enabled: true,
        parameters_schema: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
      });

      const result = await runner.executeTool('test_tool', {}); // Missing required param

      expect(result.success).toBe(false);
      expect(result.error).toContain('参数验证失败');
    });

    it('should throw error if implementation not found', async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce({
        id: 'tool-1',
        name: 'unknown_tool',
        enabled: true,
        parameters_schema: { type: 'object', properties: {} },
      });

      const result = await runner.executeTool('unknown_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('工具实现未找到');
    });

    it('should record execution on success', async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce({
        id: 'tool-1',
        name: 'generic_handler',
        enabled: true,
        parameters_schema: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
      });

      await runner.executeTool('generic_handler', { input: 'test' });

      expect(mockToolMgr.recordExecution).toHaveBeenCalledWith(
        'generic_handler',
        true,
        expect.any(Number)
      );
    });

    it('should record execution on failure', async () => {
      mockToolMgr.getToolByName.mockResolvedValueOnce(null);

      await runner.executeTool('nonexistent', {});

      expect(mockToolMgr.recordExecution).toHaveBeenCalledWith(
        'nonexistent',
        false,
        expect.any(Number)
      );
    });
  });

  describe('validateParams()', () => {
    it('should validate required params', () => {
      const tool = {
        parameters_schema: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
          },
          required: ['filePath'],
        },
      };

      const validResult = runner.validateParams(tool, { filePath: '/test.txt' });
      expect(validResult.valid).toBe(true);

      const invalidResult = runner.validateParams(tool, {});
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toContain('缺少必需参数: filePath');
    });

    it('should validate param types', () => {
      const tool = {
        parameters_schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            name: { type: 'string' },
          },
        },
      };

      const validResult = runner.validateParams(tool, {
        count: 10,
        name: 'test',
      });
      expect(validResult.valid).toBe(true);

      const invalidResult = runner.validateParams(tool, {
        count: 'not a number',
        name: 'test',
      });
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors[0]).toContain('类型错误');
    });

    it('should handle array types', () => {
      const tool = {
        parameters_schema: {
          type: 'object',
          properties: {
            items: { type: 'array' },
          },
        },
      };

      const validResult = runner.validateParams(tool, {
        items: [1, 2, 3],
      });
      expect(validResult.valid).toBe(true);

      const invalidResult = runner.validateParams(tool, {
        items: 'not an array',
      });
      expect(invalidResult.valid).toBe(false);
    });

    it('should handle string schema', () => {
      const tool = {
        parameters_schema: JSON.stringify({
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        }),
      };

      const result = runner.validateParams(tool, { input: 'test' });
      expect(result.valid).toBe(true);
    });
  });

  describe('file_reader implementation', () => {
    it('should read file successfully', async () => {
      mockFs.readFile.mockResolvedValueOnce('test content');

      const fileReader = runner.toolImplementations.file_reader;
      const result = await fileReader({ filePath: '/test.txt' });

      expect(result.success).toBe(true);
      expect(result.content).toBe('test content');
      expect(result.filePath).toBe('/test.txt');
      expect(mockFs.readFile).toHaveBeenCalledWith('/test.txt', 'utf8');
    });

    it('should reject paths with ..', async () => {
      const path = require('path');
      path.normalize.mockReturnValueOnce('../../../etc/passwd');

      const fileReader = runner.toolImplementations.file_reader;

      await expect(fileReader({ filePath: '../../../etc/passwd' })).rejects.toThrow('非法路径');
    });
  });

  describe('file_writer implementation', () => {
    it('should write file in overwrite mode', async () => {
      const fileWriter = runner.toolImplementations.file_writer;
      const result = await fileWriter({
        filePath: '/test.txt',
        content: 'new content',
        mode: 'overwrite',
      });

      expect(result.success).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalledWith('/test.txt', 'new content', 'utf8');
    });

    it('should append file in append mode', async () => {
      const fileWriter = runner.toolImplementations.file_writer;
      const result = await fileWriter({
        filePath: '/test.txt',
        content: 'appended content',
        mode: 'append',
      });

      expect(result.success).toBe(true);
      expect(mockFs.appendFile).toHaveBeenCalledWith('/test.txt', 'appended content', 'utf8');
    });

    it('should reject paths with ..', async () => {
      const path = require('path');
      path.normalize.mockReturnValueOnce('../../../etc/passwd');

      const fileWriter = runner.toolImplementations.file_writer;

      await expect(fileWriter({
        filePath: '../../../etc/passwd',
        content: 'malicious',
      })).rejects.toThrow('非法路径');
    });
  });

  describe('file_editor implementation', () => {
    it('should replace all occurrences', async () => {
      mockFs.readFile.mockResolvedValueOnce('hello world, hello universe');

      const fileEditor = runner.toolImplementations.file_editor;
      const result = await fileEditor({
        filePath: '/test.txt',
        search: 'hello',
        replace: 'hi',
        mode: 'all',
      });

      expect(result.success).toBe(true);
      expect(result.replacements).toBe(2);
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should replace first occurrence', async () => {
      mockFs.readFile.mockResolvedValueOnce('hello world, hello universe');

      const fileEditor = runner.toolImplementations.file_editor;
      const result = await fileEditor({
        filePath: '/test.txt',
        search: 'hello',
        replace: 'hi',
        mode: 'first',
      });

      expect(result.success).toBe(true);
      expect(result.replacements).toBe(1);
    });
  });

  describe('html_generator implementation', () => {
    it('should generate HTML with provided structure', async () => {
      const htmlGenerator = runner.toolImplementations.html_generator;
      const result = await htmlGenerator({
        title: 'Test Page',
        content: '<h1>Hello</h1>',
      });

      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.html).toContain('<title>Test Page</title>');
      expect(result.html).toContain('<h1>Hello</h1>');
    });

    it('should include CSS if provided', async () => {
      const htmlGenerator = runner.toolImplementations.html_generator;
      const result = await htmlGenerator({
        title: 'Test',
        content: '<p>Test</p>',
        css: 'body { color: red; }',
      });

      expect(result.html).toContain('body { color: red; }');
    });

    it('should include JavaScript if provided', async () => {
      const htmlGenerator = runner.toolImplementations.html_generator;
      const result = await htmlGenerator({
        title: 'Test',
        content: '<p>Test</p>',
        js: 'console.log("test");',
      });

      expect(result.html).toContain('console.log("test");');
    });
  });

  describe('css_generator implementation', () => {
    it('should generate CSS from selectors', async () => {
      const cssGenerator = runner.toolImplementations.css_generator;
      const result = await cssGenerator({
        selectors: {
          body: { color: 'black', 'background-color': 'white' },
          '.container': { width: '100%', margin: '0 auto' },
        },
      });

      expect(result.css).toContain('body {');
      expect(result.css).toContain('color: black;');
      expect(result.css).toContain('.container {');
    });
  });

  describe('generic_handler implementation', () => {
    it('should handle generic params', async () => {
      const genericHandler = runner.toolImplementations.generic_handler;
      const result = await genericHandler({
        input: 'test data',
        operation: 'process',
      });

      expect(result).toBeDefined();
      expect(result.processed).toBe(true);
    });
  });

  describe('format_output implementation', () => {
    it('should format as JSON', async () => {
      const formatOutput = runner.toolImplementations.format_output;
      const result = await formatOutput({
        data: { key: 'value' },
        format: 'json',
      });

      expect(result.formatted).toBe(JSON.stringify({ key: 'value' }, null, 2));
    });

    it('should format as text', async () => {
      const formatOutput = runner.toolImplementations.format_output;
      const result = await formatOutput({
        data: { key: 'value' },
        format: 'text',
      });

      expect(result.formatted).toContain('key');
      expect(result.formatted).toContain('value');
    });

    it('should format as table', async () => {
      const formatOutput = runner.toolImplementations.format_output;
      const result = await formatOutput({
        data: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }],
        format: 'table',
      });

      expect(result.formatted).toBeDefined();
    });
  });

  describe('formatAsTable()', () => {
    it('should format array as table', () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ];

      const table = runner.formatAsTable(data);

      expect(table).toContain('name');
      expect(table).toContain('age');
      expect(table).toContain('Alice');
      expect(table).toContain('Bob');
    });

    it('should return message for empty array', () => {
      const table = runner.formatAsTable([]);

      expect(table).toBe('空数据');
    });

    it('should return message for non-array', () => {
      const table = runner.formatAsTable('not an array');

      expect(table).toBe('空数据');
    });
  });

  describe('create_project_structure implementation', () => {
    it('should create project directories', async () => {
      const creator = runner.toolImplementations.create_project_structure;
      const result = await creator({
        projectName: 'test-project',
        structure: {
          src: ['index.js', 'utils.js'],
          tests: ['test.js'],
        },
      });

      expect(result.success).toBe(true);
      expect(mockFs.mkdir).toHaveBeenCalled();
    });
  });

  describe('info_searcher implementation', () => {
    it('should search for information', async () => {
      const infoSearcher = runner.toolImplementations.info_searcher;
      const result = await infoSearcher({
        query: 'test query',
        sources: ['docs', 'web'],
      });

      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
    });
  });
});
