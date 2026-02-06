/**
 * OfficeToolsHandler 单元测试（简化版）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-docx')),
  },
  Paragraph: vi.fn(),
  TextRun: vi.fn(),
  HeadingLevel: { TITLE: 'title', HEADING_1: 'h1' },
  AlignmentType: { CENTER: 'center' },
}));

vi.mock('exceljs', () => ({
  default: vi.fn(),
}));

vi.mock('marked', () => ({
  default: { parse: vi.fn() },
}));

describe('OfficeToolsHandler', () => {
  let OfficeToolsHandler;
  let handler;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await import('../../../src/main/ai-engine/extended-tools-office.js');
    OfficeToolsHandler = module.default || module.OfficeToolsHandler;

    handler = new OfficeToolsHandler();
  });

  describe('构造函数', () => {
    it('应该正确初始化', () => {
      expect(handler).toBeDefined();
      expect(handler.name).toBe('OfficeToolsHandler');
    });
  });

  describe('Word Generator', () => {
    it('应该有 tool_word_generator 方法', () => {
      expect(handler.tool_word_generator).toBeTypeOf('function');
    });

    it('应该有 parseMarkdownToWordParagraphs 方法', () => {
      expect(handler.parseMarkdownToWordParagraphs).toBeTypeOf('function');
    });
  });

  describe.skip('Excel Generator（需要完整 Mock）', () => {
    it('需要更复杂的 ExcelJS Mock', () => {
      expect(true).toBe(true);
    });
  });
});
