/**
 * Word引擎测试
 * 测试 Word 文档读取、写入、转换和模板创建功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all dependencies before importing
vi.mock('fs', () => ({
  default: {
    promises: {
      stat: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
    },
  },
  promises: {
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock('docx', () => ({
  Document: vi.fn((config) => ({ config })),
  Packer: {
    toBuffer: vi.fn(),
  },
  Paragraph: vi.fn((config) => ({ type: 'paragraph', config })),
  TextRun: vi.fn((config) => ({ type: 'textrun', config })),
  HeadingLevel: {
    TITLE: 'TITLE',
    HEADING_1: 'H1',
    HEADING_2: 'H2',
    HEADING_3: 'H3',
    HEADING_4: 'H4',
    HEADING_5: 'H5',
    HEADING_6: 'H6',
  },
  AlignmentType: {
    LEFT: 'LEFT',
    CENTER: 'CENTER',
    RIGHT: 'RIGHT',
    JUSTIFIED: 'JUSTIFIED',
  },
  UnderlineType: {
    SINGLE: 'SINGLE',
  },
}));

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi.fn(),
    extractRawText: vi.fn(),
  },
  convertToHtml: vi.fn(),
  extractRawText: vi.fn(),
}));

vi.mock('marked', () => ({
  marked: vi.fn(),
}));

vi.mock('../../src/main/utils/file-handler', () => ({
  getFileHandler: vi.fn(() => ({
    getFileSize: vi.fn().mockResolvedValue(1024 * 1024), // 1MB
    checkAvailableMemory: vi.fn().mockReturnValue({ isAvailable: true }),
    waitForMemory: vi.fn().mockResolvedValue(undefined),
    writeFileStream: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('Word引擎测试', () => {
  let WordEngine;
  let wordEngine;
  let mockFs;
  let mockDocx;
  let mockMammoth;
  let mockMarked;

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();

    // Import mocked modules
    mockFs = await import('fs');
    mockDocx = await import('docx');
    mockMammoth = await import('mammoth');
    mockMarked = await import('marked');

    // Import WordEngine after mocks are set up
    const module = await import('../../src/main/engines/word-engine.js');
    WordEngine = module.default;
    wordEngine = WordEngine;

    // Setup default mock behaviors
    mockDocx.Packer.toBuffer.mockResolvedValue(Buffer.from('Word document'));
    mockMammoth.convertToHtml.mockResolvedValue({
      value: '<p>Test content</p>',
      messages: [],
    });
    mockMammoth.extractRawText.mockResolvedValue({
      value: 'Test content',
    });
    mockFs.promises.stat.mockResolvedValue({
      size: 1024,
      birthtime: new Date(),
      mtime: new Date(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('基础功能', () => {
    it('should have all required methods', () => {
      expect(typeof wordEngine.readWord).toBe('function');
      expect(typeof wordEngine.writeWord).toBe('function');
      expect(typeof wordEngine.createParagraph).toBe('function');
      expect(typeof wordEngine.getHeadingLevel).toBe('function');
      expect(typeof wordEngine.getAlignment).toBe('function');
      expect(typeof wordEngine.parseHtmlToContent).toBe('function');
      expect(typeof wordEngine.extractMetadata).toBe('function');
      expect(typeof wordEngine.markdownToWord).toBe('function');
      expect(typeof wordEngine.wordToMarkdown).toBe('function');
      expect(typeof wordEngine.htmlToWord).toBe('function');
      expect(typeof wordEngine.createTemplate).toBe('function');
    });

    it('should have supportedFormats array', () => {
      expect(wordEngine.supportedFormats).toEqual(['.docx', '.doc']);
    });
  });

  describe('readWord', () => {
    it('should read Word document successfully', async () => {
      const result = await wordEngine.readWord('/test.docx');

      expect(mockMammoth.convertToHtml).toHaveBeenCalled();
      expect(mockMammoth.extractRawText).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.html).toBe('<p>Test content</p>');
      expect(result.text).toBe('Test content');
      expect(result.content).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.fileSize).toBeDefined();
    });

    it('should handle large files', async () => {
      const fileHandlerMock = (await import('../../src/main/utils/file-handler')).getFileHandler();
      fileHandlerMock.getFileSize.mockResolvedValue(20 * 1024 * 1024); // 20MB

      const result = await wordEngine.readWord('/large.docx');

      expect(result.success).toBe(true);
      expect(fileHandlerMock.checkAvailableMemory).toHaveBeenCalled();
    });

    it('should handle memory availability issues', async () => {
      const fileHandlerMock = (await import('../../src/main/utils/file-handler')).getFileHandler();
      fileHandlerMock.checkAvailableMemory.mockReturnValue({ isAvailable: false });

      const result = await wordEngine.readWord('/test.docx');

      expect(fileHandlerMock.waitForMemory).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should handle read errors', async () => {
      mockMammoth.convertToHtml.mockRejectedValue(new Error('Read failed'));

      await expect(wordEngine.readWord('/test.docx')).rejects.toThrow('Read failed');
    });

    it('should parse mammoth messages', async () => {
      mockMammoth.convertToHtml.mockResolvedValue({
        value: '<p>Content</p>',
        messages: [
          { type: 'warning', message: 'Unknown style' }
        ],
      });

      const result = await wordEngine.readWord('/test.docx');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('warning');
    });
  });

  describe('writeWord', () => {
    beforeEach(() => {
      mockFs.promises.writeFile.mockResolvedValue(undefined);
    });

    it('should write Word document successfully', async () => {
      const content = {
        title: 'Test Document',
        paragraphs: [
          { text: 'Paragraph 1' },
          { text: 'Paragraph 2' },
        ],
      };

      const result = await wordEngine.writeWord('/output.docx', content);

      expect(mockDocx.Document).toHaveBeenCalled();
      expect(mockDocx.Packer.toBuffer).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.filePath).toBe('/output.docx');
    });

    it('should create document with title', async () => {
      const content = {
        title: 'My Document',
        paragraphs: [],
      };

      await wordEngine.writeWord('/output.docx', content);

      expect(mockDocx.Paragraph).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'My Document',
        })
      );
    });

    it('should handle large documents with streaming', async () => {
      const largeBuffer = Buffer.alloc(15 * 1024 * 1024); // 15MB
      mockDocx.Packer.toBuffer.mockResolvedValue(largeBuffer);

      const fileHandlerMock = (await import('../../src/main/utils/file-handler')).getFileHandler();

      const content = { title: 'Large Doc', paragraphs: [] };
      await wordEngine.writeWord('/large.docx', content);

      expect(fileHandlerMock.writeFileStream).toHaveBeenCalled();
    });

    it('should handle small documents without streaming', async () => {
      const smallBuffer = Buffer.alloc(1024); // 1KB
      mockDocx.Packer.toBuffer.mockResolvedValue(smallBuffer);

      const content = { title: 'Small Doc', paragraphs: [] };
      await wordEngine.writeWord('/small.docx', content);

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        '/small.docx',
        smallBuffer
      );
    });

    it('should handle write errors', async () => {
      mockDocx.Packer.toBuffer.mockRejectedValue(new Error('Pack failed'));

      const content = { title: 'Test', paragraphs: [] };

      await expect(
        wordEngine.writeWord('/output.docx', content)
      ).rejects.toThrow('Pack failed');
    });

    it('should create document with metadata', async () => {
      const content = { paragraphs: [] };

      await wordEngine.writeWord('/output.docx', content);

      expect(mockDocx.Document).toHaveBeenCalledWith(
        expect.objectContaining({
          creator: 'ChainlessChain',
          description: 'Generated by ChainlessChain',
        })
      );
    });
  });

  describe('createParagraph', () => {
    it('should create simple paragraph', () => {
      const paraData = { text: 'Simple text' };

      const result = wordEngine.createParagraph(paraData);

      expect(result.type).toBe('paragraph');
      expect(mockDocx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Simple text' })
      );
    });

    it('should create paragraph with bold text', () => {
      const paraData = {
        text: 'Bold text',
        style: { bold: true },
      };

      wordEngine.createParagraph(paraData);

      expect(mockDocx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({ bold: true })
      );
    });

    it('should create paragraph with italic text', () => {
      const paraData = {
        text: 'Italic text',
        style: { italic: true },
      };

      wordEngine.createParagraph(paraData);

      expect(mockDocx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({ italics: true })
      );
    });

    it('should create paragraph with underline', () => {
      const paraData = {
        text: 'Underlined',
        style: { underline: true },
      };

      wordEngine.createParagraph(paraData);

      expect(mockDocx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          underline: { type: 'SINGLE' },
        })
      );
    });

    it('should create paragraph with multiple text runs', () => {
      const paraData = {
        text: [
          { text: 'Part 1', bold: true },
          { text: 'Part 2', italic: true },
        ],
      };

      wordEngine.createParagraph(paraData);

      expect(mockDocx.TextRun).toHaveBeenCalledTimes(2);
    });

    it('should handle heading level', () => {
      const paraData = {
        text: 'Heading',
        heading: 1,
      };

      const result = wordEngine.createParagraph(paraData);

      expect(result.config.heading).toBe('H1');
    });

    it('should handle alignment', () => {
      const paraData = {
        text: 'Centered',
        alignment: 'center',
      };

      const result = wordEngine.createParagraph(paraData);

      expect(result.config.alignment).toBe('CENTER');
    });

    it('should handle custom font size', () => {
      const paraData = {
        text: 'Large text',
        style: { fontSize: 24 },
      };

      wordEngine.createParagraph(paraData);

      expect(mockDocx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 48, // 24 * 2 (Word uses half-points)
        })
      );
    });

    it('should handle font family', () => {
      const paraData = {
        text: 'Custom font',
        style: { fontFamily: 'Times New Roman' },
      };

      wordEngine.createParagraph(paraData);

      expect(mockDocx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          font: 'Times New Roman',
        })
      );
    });

    it('should handle custom color', () => {
      const paraData = {
        text: 'Colored text',
        style: { color: 'FF0000' },
      };

      wordEngine.createParagraph(paraData);

      expect(mockDocx.TextRun).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 'FF0000',
        })
      );
    });
  });

  describe('getHeadingLevel', () => {
    it('should return correct heading levels', () => {
      expect(wordEngine.getHeadingLevel(1)).toBe('H1');
      expect(wordEngine.getHeadingLevel(2)).toBe('H2');
      expect(wordEngine.getHeadingLevel(3)).toBe('H3');
      expect(wordEngine.getHeadingLevel(4)).toBe('H4');
      expect(wordEngine.getHeadingLevel(5)).toBe('H5');
      expect(wordEngine.getHeadingLevel(6)).toBe('H6');
    });

    it('should return undefined for invalid levels', () => {
      expect(wordEngine.getHeadingLevel(0)).toBeUndefined();
      expect(wordEngine.getHeadingLevel(7)).toBeUndefined();
      expect(wordEngine.getHeadingLevel(null)).toBeUndefined();
    });
  });

  describe('getAlignment', () => {
    it('should return correct alignment types', () => {
      expect(wordEngine.getAlignment('left')).toBe('LEFT');
      expect(wordEngine.getAlignment('center')).toBe('CENTER');
      expect(wordEngine.getAlignment('right')).toBe('RIGHT');
      expect(wordEngine.getAlignment('justify')).toBe('JUSTIFIED');
    });

    it('should return LEFT for unknown alignment', () => {
      expect(wordEngine.getAlignment('unknown')).toBe('LEFT');
      expect(wordEngine.getAlignment(null)).toBe('LEFT');
      expect(wordEngine.getAlignment()).toBe('LEFT');
    });
  });

  describe('parseHtmlToContent', () => {
    it('should parse simple HTML', () => {
      const html = '<p>Paragraph 1</p><p>Paragraph 2</p>';

      const result = wordEngine.parseHtmlToContent(html);

      expect(result.paragraphs).toHaveLength(2);
      expect(result.paragraphs[0].text).toBe('Paragraph 1');
      expect(result.paragraphs[1].text).toBe('Paragraph 2');
    });

    it('should detect bold text', () => {
      const html = '<p><strong>Bold text</strong></p>';

      const result = wordEngine.parseHtmlToContent(html);

      expect(result.paragraphs[0].style.bold).toBe(true);
    });

    it('should detect italic text', () => {
      const html = '<p><em>Italic text</em></p>';

      const result = wordEngine.parseHtmlToContent(html);

      expect(result.paragraphs[0].style.italic).toBe(true);
    });

    it('should detect headings', () => {
      const html = '<h1>Heading 1</h1><h2>Heading 2</h2>';

      const result = wordEngine.parseHtmlToContent(html);

      expect(result.paragraphs[0].heading).toBe(1);
      expect(result.paragraphs[1].heading).toBe(2);
    });

    it('should handle empty HTML', () => {
      const result = wordEngine.parseHtmlToContent('');

      expect(result.paragraphs).toHaveLength(0);
    });

    it('should strip HTML tags', () => {
      const html = '<p><span class="highlight">Text</span></p>';

      const result = wordEngine.parseHtmlToContent(html);

      expect(result.paragraphs[0].text).toBe('Text');
    });

    it('should handle mixed formatting', () => {
      const html = '<p><strong><em>Bold and italic</em></strong></p>';

      const result = wordEngine.parseHtmlToContent(html);

      expect(result.paragraphs[0].style.bold).toBe(true);
      expect(result.paragraphs[0].style.italic).toBe(true);
    });
  });

  describe('markdownToWord', () => {
    beforeEach(() => {
      mockMarked.marked.mockReturnValue('<p>Converted content</p>');
      mockDocx.Packer.toBuffer.mockResolvedValue(Buffer.from('Word'));
      mockFs.promises.writeFile.mockResolvedValue(undefined);
    });

    it('should convert markdown to Word', async () => {
      const result = await wordEngine.markdownToWord('# Test', '/output.docx');

      expect(mockMarked.marked).toHaveBeenCalledWith('# Test');
      expect(mockDocx.Document).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should use custom title', async () => {
      await wordEngine.markdownToWord('# Test', '/output.docx', { title: 'Custom' });

      expect(mockDocx.Document).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Custom',
        })
      );
    });

    it('should handle markdown conversion errors', async () => {
      mockMarked.marked.mockImplementation(() => {
        throw new Error('Markdown parse failed');
      });

      await expect(
        wordEngine.markdownToWord('# Test', '/output.docx')
      ).rejects.toThrow('Markdown parse failed');
    });
  });

  describe('wordToMarkdown', () => {
    beforeEach(() => {
      mockMammoth.convertToHtml.mockResolvedValue({
        value: '<h1>Title</h1><p><strong>Bold</strong> text</p>',
        messages: [],
      });
      mockMammoth.extractRawText.mockResolvedValue({
        value: 'Title\nBold text',
      });
    });

    it('should convert Word to Markdown', async () => {
      const result = await wordEngine.wordToMarkdown('/input.docx');

      expect(result.success).toBe(true);
      expect(result.markdown).toContain('# Title');
    });

    it('should handle headings', async () => {
      mockMammoth.convertToHtml.mockResolvedValue({
        value: '<h1>H1</h1><h2>H2</h2><h3>H3</h3>',
        messages: [],
      });

      const result = await wordEngine.wordToMarkdown('/input.docx');

      expect(result.markdown).toContain('# H1');
      expect(result.markdown).toContain('## H2');
      expect(result.markdown).toContain('### H3');
    });

    it('should handle bold text', async () => {
      mockMammoth.convertToHtml.mockResolvedValue({
        value: '<p><strong>Bold</strong></p>',
        messages: [],
      });

      const result = await wordEngine.wordToMarkdown('/input.docx');

      expect(result.markdown).toContain('**Bold**');
    });

    it('should handle italic text', async () => {
      mockMammoth.convertToHtml.mockResolvedValue({
        value: '<p><em>Italic</em></p>',
        messages: [],
      });

      const result = await wordEngine.wordToMarkdown('/input.docx');

      expect(result.markdown).toContain('*Italic*');
    });

    it('should handle conversion errors', async () => {
      mockMammoth.convertToHtml.mockRejectedValue(new Error('Conversion failed'));

      await expect(
        wordEngine.wordToMarkdown('/input.docx')
      ).rejects.toThrow('Conversion failed');
    });
  });

  describe('createTemplate', () => {
    beforeEach(() => {
      mockDocx.Packer.toBuffer.mockResolvedValue(Buffer.from('Template'));
      mockFs.promises.writeFile.mockResolvedValue(undefined);
    });

    it('should create report template', async () => {
      const result = await wordEngine.createTemplate('report', '/report.docx', {
        title: 'Q1 Report',
        author: 'John Doe',
      });

      expect(result.success).toBe(true);
      expect(mockDocx.Document).toHaveBeenCalled();
    });

    it('should create letter template', async () => {
      const result = await wordEngine.createTemplate('letter', '/letter.docx', {
        recipient: 'Jane Smith',
        sender: 'John Doe',
      });

      expect(result.success).toBe(true);
    });

    it('should create resume template', async () => {
      const result = await wordEngine.createTemplate('resume', '/resume.docx', {
        name: 'John Doe',
        phone: '123-456-7890',
        email: 'john@example.com',
      });

      expect(result.success).toBe(true);
    });

    it('should throw error for unknown template type', async () => {
      await expect(
        wordEngine.createTemplate('unknown', '/test.docx')
      ).rejects.toThrow('未知的模板类型');
    });
  });

  describe('模板创建辅助方法', () => {
    it('should create report template with custom data', () => {
      const data = {
        title: 'Annual Report',
        author: 'Jane Doe',
        date: '2025-01-01',
      };

      const content = wordEngine.createReportTemplate(data);

      expect(content.title).toBe('Annual Report');
      expect(content.paragraphs).toBeDefined();
      expect(content.paragraphs.some(p => p.text?.includes('Jane Doe'))).toBe(true);
    });

    it('should create letter template with custom data', () => {
      const data = {
        recipient: 'CEO',
        sender: 'Manager',
        date: '2025-01-01',
      };

      const content = wordEngine.createLetterTemplate(data);

      expect(content.paragraphs).toBeDefined();
      expect(content.paragraphs.some(p => p.text?.includes('CEO'))).toBe(true);
      expect(content.paragraphs.some(p => p.text?.includes('Manager'))).toBe(true);
    });

    it('should create resume template with custom data', () => {
      const data = {
        name: 'John Smith',
        phone: '555-1234',
        email: 'john@email.com',
      };

      const content = wordEngine.createResumeTemplate(data);

      expect(content.title).toBe('John Smith');
      expect(content.paragraphs.some(p => p.text?.includes('555-1234'))).toBe(true);
    });

    it('should use default values when data is missing', () => {
      const content = wordEngine.createReportTemplate({});

      expect(content.title).toBe('工作报告');
      expect(content.paragraphs).toBeDefined();
    });
  });

  describe('边界条件和错误处理', () => {
    it('should handle null content for writeWord', async () => {
      mockDocx.Packer.toBuffer.mockResolvedValue(Buffer.from('Doc'));
      mockFs.promises.writeFile.mockResolvedValue(undefined);

      const result = await wordEngine.writeWord('/test.docx', {});

      expect(result.success).toBe(true);
    });

    it('should handle empty paragraphs array', async () => {
      mockDocx.Packer.toBuffer.mockResolvedValue(Buffer.from('Doc'));
      mockFs.promises.writeFile.mockResolvedValue(undefined);

      const result = await wordEngine.writeWord('/test.docx', { paragraphs: [] });

      expect(result.success).toBe(true);
    });

    it('should handle Unicode characters', async () => {
      const content = {
        title: '你好世界 🌍',
        paragraphs: [{ text: 'مرحبا العالم' }],
      };

      mockDocx.Packer.toBuffer.mockResolvedValue(Buffer.from('Doc'));
      mockFs.promises.writeFile.mockResolvedValue(undefined);

      const result = await wordEngine.writeWord('/test.docx', content);

      expect(result.success).toBe(true);
    });

    it('should handle very long paragraphs', async () => {
      const longText = 'a'.repeat(10000);
      const content = {
        paragraphs: [{ text: longText }],
      };

      mockDocx.Packer.toBuffer.mockResolvedValue(Buffer.from('Doc'));
      mockFs.promises.writeFile.mockResolvedValue(undefined);

      const result = await wordEngine.writeWord('/test.docx', content);

      expect(result.success).toBe(true);
    });
  });
});
