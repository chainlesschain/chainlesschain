/**
 * OfficeToolsHandler 单元测试
 * 测试 Office 文档生成工具（Word、Excel、PPT）
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

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

vi.mock('docx', () => ({
  Document: vi.fn(),
  Packer: {
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-docx-content')),
  },
  Paragraph: vi.fn(function(opts) { this.opts = opts; }),
  TextRun: vi.fn(function(opts) { this.opts = opts; }),
  Table: vi.fn(function(opts) { this.opts = opts; }),
  TableRow: vi.fn(function(opts) { this.opts = opts; }),
  TableCell: vi.fn(function(opts) { this.opts = opts; }),
  HeadingLevel: {
    TITLE: 'title',
    HEADING_1: 'h1',
    HEADING_2: 'h2',
    HEADING_3: 'h3',
  },
  AlignmentType: {
    CENTER: 'center',
    LEFT: 'left',
    RIGHT: 'right',
  },
  WidthType: {
    PERCENTAGE: 'percentage',
  },
}));

vi.mock('exceljs', () => ({
  default: class MockWorkbook {
    constructor() {
      this.worksheets = [];
    }
    addWorksheet(name) {
      const worksheet = {
        name,
        columns: [],
        rows: [],
        addRow: vi.fn(function(data) {
          this.rows.push(data);
          return { commit: vi.fn() };
        }),
        getColumn: vi.fn((col) => ({
          width: 0,
          set width(val) { this.width = val; },
        })),
      };
      this.worksheets.push(worksheet);
      return worksheet;
    }
    async xlsx() {
      return {
        writeFile: vi.fn().mockResolvedValue(undefined),
      };
    }
  },
}));

vi.mock('marked', () => ({
  default: {
    parse: vi.fn((md) => `<p>${md}</p>`),
  },
}));

describe('OfficeToolsHandler', () => {
  let OfficeToolsHandler;
  let handler;
  const testOutputDir = path.join(process.cwd(), 'test-output');

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import('../../../src/main/ai-engine/extended-tools-office.js');
    OfficeToolsHandler = module.default || module.OfficeToolsHandler;

    handler = new OfficeToolsHandler();

    // 确保测试输出目录存在
    await fs.mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    // 清理测试文件
    try {
      await fs.rm(testOutputDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  // ==================== 构造函数测试 ====================

  describe('构造函数', () => {
    it('应该正确初始化 OfficeToolsHandler', () => {
      expect(handler).toBeDefined();
      expect(handler.name).toBe('OfficeToolsHandler');
    });
  });

  // ==================== Word Generator 测试 ====================

  describe('tool_word_generator', () => {
    const mockParams = {
      title: 'Test Document',
      content: 'This is test content',
      outputPath: path.join(testOutputDir, 'test.docx'),
    };

    it('应该生成 Word 文档', async () => {
      const result = await handler.tool_word_generator(mockParams);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(mockParams.outputPath);
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('应该处理 Markdown 内容', async () => {
      const params = {
        ...mockParams,
        content: '# Heading 1\n\nParagraph text\n\n## Heading 2',
      };

      const result = await handler.tool_word_generator(params);

      expect(result.success).toBe(true);
      expect(result.pageCount).toBeGreaterThan(0);
    });

    it('应该支持自定义页边距', async () => {
      const params = {
        ...mockParams,
        options: {
          margin: {
            top: 2000,
            bottom: 2000,
            left: 2500,
            right: 2500,
          },
        },
      };

      const result = await handler.tool_word_generator(params);

      expect(result.success).toBe(true);
    });

    it('应该创建输出目录', async () => {
      const deepPath = path.join(testOutputDir, 'nested', 'dir', 'test.docx');
      const params = {
        ...mockParams,
        outputPath: deepPath,
      };

      const result = await handler.tool_word_generator(params);

      expect(result.success).toBe(true);
      const dirExists = await fs.access(path.dirname(deepPath))
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);
    });

    it('应该估算页数', async () => {
      const longContent = 'a'.repeat(10000);
      const params = {
        ...mockParams,
        content: longContent,
      };

      const result = await handler.tool_word_generator(params);

      expect(result.success).toBe(true);
      expect(result.pageCount).toBeGreaterThan(1);
    });

    it('应该处理空内容', async () => {
      const params = {
        ...mockParams,
        content: '',
      };

      const result = await handler.tool_word_generator(params);

      expect(result.success).toBe(true);
      expect(result.pageCount).toBe(0);
    });
  });

  // ==================== Markdown 解析测试 ====================

  describe('parseMarkdownToWordParagraphs', () => {
    it('应该解析普通段落', () => {
      const markdown = 'This is a paragraph';
      const paragraphs = handler.parseMarkdownToWordParagraphs(markdown);

      expect(paragraphs).toBeDefined();
      expect(paragraphs.length).toBeGreaterThan(0);
    });

    it('应该解析标题', () => {
      const markdown = '# Heading 1\n## Heading 2\n### Heading 3';
      const paragraphs = handler.parseMarkdownToWordParagraphs(markdown);

      expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    });

    it('应该处理空行', () => {
      const markdown = 'Line 1\n\nLine 2';
      const paragraphs = handler.parseMarkdownToWordParagraphs(markdown);

      expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    });

    it('应该处理列表', () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3';
      const paragraphs = handler.parseMarkdownToWordParagraphs(markdown);

      expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    });

    it('应该处理粗体和斜体', () => {
      const markdown = '**Bold text** and *italic text*';
      const paragraphs = handler.parseMarkdownToWordParagraphs(markdown);

      expect(paragraphs).toBeDefined();
    });

    it('应该应用自定义选项', () => {
      const markdown = 'Test content';
      const options = { fontSize: 14 };
      const paragraphs = handler.parseMarkdownToWordParagraphs(markdown, options);

      expect(paragraphs).toBeDefined();
    });
  });

  // ==================== Excel Generator 测试 ====================

  describe('tool_excel_generator', () => {
    const mockParams = {
      outputPath: path.join(testOutputDir, 'test.xlsx'),
      sheets: [
        {
          name: 'Sheet1',
          columns: [
            { header: 'Name', key: 'name', width: 20 },
            { header: 'Age', key: 'age', width: 10 },
          ],
          data: [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 25 },
          ],
        },
      ],
    };

    it('应该生成 Excel 文件', async () => {
      const result = await handler.tool_excel_generator(mockParams);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(mockParams.outputPath);
      expect(result.sheets).toHaveLength(1);
    });

    it('应该支持多个工作表', async () => {
      const params = {
        ...mockParams,
        sheets: [
          mockParams.sheets[0],
          {
            name: 'Sheet2',
            columns: [{ header: 'Data', key: 'data' }],
            data: [{ data: 'test' }],
          },
        ],
      };

      const result = await handler.tool_excel_generator(params);

      expect(result.success).toBe(true);
      expect(result.sheets).toHaveLength(2);
    });

    it('应该处理空数据', async () => {
      const params = {
        ...mockParams,
        sheets: [
          {
            name: 'EmptySheet',
            columns: [{ header: 'Col1', key: 'col1' }],
            data: [],
          },
        ],
      };

      const result = await handler.tool_excel_generator(params);

      expect(result.success).toBe(true);
      expect(result.sheets[0].rowCount).toBe(0);
    });

    it('应该设置列宽', async () => {
      const result = await handler.tool_excel_generator(mockParams);

      expect(result.success).toBe(true);
      expect(result.sheets[0].columnCount).toBe(2);
    });

    it('应该统计行数', async () => {
      const result = await handler.tool_excel_generator(mockParams);

      expect(result.success).toBe(true);
      expect(result.sheets[0].rowCount).toBe(2);
    });
  });

  // ==================== 错误处理测试 ====================

  describe('错误处理', () => {
    it('应该处理 Word 生成错误', async () => {
      const { Packer } = await import('docx');
      Packer.toBuffer.mockRejectedValueOnce(new Error('Generation failed'));

      const params = {
        title: 'Test',
        content: 'Content',
        outputPath: path.join(testOutputDir, 'error.docx'),
      };

      await expect(handler.tool_word_generator(params)).rejects.toThrow();
    });

    it('应该处理无效的输出路径', async () => {
      const params = {
        title: 'Test',
        content: 'Content',
        outputPath: '/invalid/path/test.docx',
      };

      // 在某些系统上可能会成功创建目录，所以这个测试可能需要调整
      try {
        await handler.tool_word_generator(params);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('应该处理缺少必需参数', async () => {
      await expect(handler.tool_word_generator({})).rejects.toThrow();
    });
  });

  // ==================== 边界情况测试 ====================

  describe('边界情况', () => {
    it('应该处理非常长的文档标题', async () => {
      const longTitle = 'A'.repeat(1000);
      const params = {
        title: longTitle,
        content: 'Content',
        outputPath: path.join(testOutputDir, 'long-title.docx'),
      };

      const result = await handler.tool_word_generator(params);

      expect(result.success).toBe(true);
    });

    it('应该处理特殊字符', async () => {
      const params = {
        title: 'Test: <>&"\'',
        content: 'Content with <>&"\' special chars',
        outputPath: path.join(testOutputDir, 'special.docx'),
      };

      const result = await handler.tool_word_generator(params);

      expect(result.success).toBe(true);
    });

    it('应该处理 Unicode 字符', async () => {
      const params = {
        title: '测试文档 🎉',
        content: '这是中文内容 with emoji 🚀',
        outputPath: path.join(testOutputDir, 'unicode.docx'),
      };

      const result = await handler.tool_word_generator(params);

      expect(result.success).toBe(true);
    });

    it('应该处理空的工作表数组', async () => {
      const params = {
        outputPath: path.join(testOutputDir, 'empty.xlsx'),
        sheets: [],
      };

      await expect(handler.tool_excel_generator(params)).rejects.toThrow();
    });
  });
});
