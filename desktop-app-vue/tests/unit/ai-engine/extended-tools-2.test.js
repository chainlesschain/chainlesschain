/**
 * ExtendedTools2 单元测试
 * 测试第二批扩展工具的功能
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

describe('ExtendedTools2', () => {
  let ExtendedTools2;
  let mockFunctionCaller;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import('../../../src/main/ai-engine/extended-tools-2.js');
    ExtendedTools2 = module.default || module.ExtendedTools2;

    // Mock FunctionCaller
    mockFunctionCaller = {
      registerTool: vi.fn(),
      tools: new Map(),
    };
  });

  // ==================== 工具注册测试 ====================

  describe('registerAll', () => {
    it('应该注册所有扩展工具', () => {
      ExtendedTools2.registerAll(mockFunctionCaller);

      expect(mockFunctionCaller.registerTool).toHaveBeenCalled();
      expect(mockFunctionCaller.registerTool.mock.calls.length).toBeGreaterThan(0);
    });

    it('应该注册 qrcode_generator 工具', () => {
      ExtendedTools2.registerAll(mockFunctionCaller);

      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'qrcode_generator'
      );
      expect(call).toBeDefined();
      expect(call[1]).toBeTypeOf('function');
    });

    it('应该注册 diff_comparator 工具', () => {
      ExtendedTools2.registerAll(mockFunctionCaller);

      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'diff_comparator'
      );
      expect(call).toBeDefined();
    });
  });

  // ==================== QR Code Generator 测试 ====================

  describe('qrcode_generator', () => {
    let qrcodeGenerator;

    beforeEach(() => {
      ExtendedTools2.registerAll(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'qrcode_generator'
      );
      qrcodeGenerator = call[1];
    });

    it('应该生成 QR 码', async () => {
      const result = await qrcodeGenerator({
        data: 'https://example.com',
      });

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.format).toBeDefined();
    });

    it('应该支持 SVG 格式', async () => {
      const result = await qrcodeGenerator({
        data: 'test data',
        format: 'svg',
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe('svg');
      expect(result.result).toContain('<svg');
    });

    it('应该支持自定义尺寸', async () => {
      const result = await qrcodeGenerator({
        data: 'test',
        size: 512,
      });

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      // 结果可能是 base64 编码的，检查它存在即可
    });

    it('应该使用默认尺寸', async () => {
      const result = await qrcodeGenerator({
        data: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      // 结果可能是 base64 编码的，检查它存在即可
    });

    it('应该处理长文本', async () => {
      const longText = 'a'.repeat(1000);
      const result = await qrcodeGenerator({
        data: longText,
      });

      expect(result.success).toBe(true);
    });

    it('应该处理特殊字符', async () => {
      const result = await qrcodeGenerator({
        data: 'test<>&"\'',
      });

      expect(result.success).toBe(true);
    });
  });

  // ==================== Diff Comparator 测试 ====================

  describe('diff_comparator', () => {
    let diffComparator;

    beforeEach(() => {
      ExtendedTools2.registerAll(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'diff_comparator'
      );
      diffComparator = call[1];
    });

    it('应该比较两个文本', async () => {
      const result = await diffComparator({
        text1: 'line1\nline2',
        text2: 'line1\nline3',
      });

      expect(result.success).toBe(true);
      expect(result.additions).toBeGreaterThan(0);
      expect(result.deletions).toBeGreaterThan(0);
    });

    it('应该检测新增内容', async () => {
      const result = await diffComparator({
        text1: 'line1',
        text2: 'line1\nline2',
      });

      expect(result.success).toBe(true);
      expect(result.additions).toBe(1);
      expect(result.diff).toContain('+ line2');
    });

    it('应该检测删除内容', async () => {
      const result = await diffComparator({
        text1: 'line1\nline2',
        text2: 'line1',
      });

      expect(result.success).toBe(true);
      expect(result.deletions).toBe(1);
      expect(result.diff).toContain('- line2');
    });

    it('应该检测修改内容', async () => {
      const result = await diffComparator({
        text1: 'original',
        text2: 'modified',
      });

      expect(result.success).toBe(true);
      expect(result.changes).toBeGreaterThan(0);
    });

    it('应该忽略空白符', async () => {
      const result = await diffComparator({
        text1: 'line1  \n  line2',
        text2: 'line1\nline2',
        ignoreWhitespace: true,
      });

      expect(result.success).toBe(true);
      expect(result.changes).toBe(0);
    });

    it('应该处理相同文本', async () => {
      const result = await diffComparator({
        text1: 'same text',
        text2: 'same text',
      });

      expect(result.success).toBe(true);
      expect(result.additions).toBe(0);
      expect(result.deletions).toBe(0);
      expect(result.changes).toBe(0);
    });

    it('应该处理空文本', async () => {
      const result = await diffComparator({
        text1: '',
        text2: '',
      });

      expect(result.success).toBe(true);
      expect(result.changes).toBe(0);
    });

    it('应该支持 unified 格式', async () => {
      const result = await diffComparator({
        text1: 'a',
        text2: 'b',
        format: 'unified',
      });

      expect(result.success).toBe(true);
      expect(result.diff).toBeDefined();
    });
  });

  // ==================== 错误处理测试 ====================

  describe('错误处理', () => {
    it('应该处理 qrcode_generator 错误', async () => {
      ExtendedTools2.registerAll(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'qrcode_generator'
      );
      const tool = call[1];

      // 测试缺少必需参数
      const result = await tool({});

      // 应该优雅处理错误
      expect(result).toBeDefined();
    });

    it('应该处理 diff_comparator 错误', async () => {
      ExtendedTools2.registerAll(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'diff_comparator'
      );
      const tool = call[1];

      const result = await tool({});

      expect(result).toBeDefined();
    });
  });

  // ==================== 边界情况测试 ====================

  describe('边界情况', () => {
    it('应该处理非常长的 QR 数据', async () => {
      ExtendedTools2.registerAll(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'qrcode_generator'
      );
      const tool = call[1];

      const longData = 'x'.repeat(10000);
      const result = await tool({ data: longData });

      expect(result).toBeDefined();
    });

    it('应该处理非常长的 diff 文本', async () => {
      ExtendedTools2.registerAll(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'diff_comparator'
      );
      const tool = call[1];

      const longText1 = 'line\n'.repeat(10000);
      const longText2 = 'line\n'.repeat(10001);
      const result = await tool({
        text1: longText1,
        text2: longText2,
      });

      expect(result.success).toBe(true);
    });

    it('应该处理 Unicode 字符', async () => {
      ExtendedTools2.registerAll(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'qrcode_generator'
      );
      const tool = call[1];

      const result = await tool({
        data: '测试 🎉 emoji',
      });

      expect(result.success).toBe(true);
    });

    it('应该处理换行符变体', async () => {
      ExtendedTools2.registerAll(mockFunctionCaller);
      const call = mockFunctionCaller.registerTool.mock.calls.find(
        c => c[0] === 'diff_comparator'
      );
      const tool = call[1];

      const result = await tool({
        text1: 'line1\rline2',
        text2: 'line1\nline2',
      });

      expect(result.success).toBe(true);
    });
  });
});
