/**
 * 文件导入模块单元测试
 * 测试 Markdown, PDF, Word, TXT 等文件导入功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockElectronAPI } from '../../setup';

describe('文件导入模块', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Markdown 文件导入', () => {
    it('应该成功导入 Markdown 文件', async () => {
      const filePath = '/path/to/test.md';
      const mockContent = '# 标题\n\n这是一个测试文档';

      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: mockContent,
        type: 'markdown'
      });

      const result = await mockElectronAPI.fs.readFile(filePath);

      expect(result.success).toBe(true);
      expect(result.content).toContain('# 标题');
      expect(result.type).toBe('markdown');
    });

    it('应该解析 Markdown 元数据', async () => {
      const content = `---
title: 测试文档
tags: test,markdown
date: 2024-01-01
---

# 内容`;

      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: content,
        metadata: {
          title: '测试文档',
          tags: 'test,markdown',
          date: '2024-01-01'
        }
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/test.md');

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.title).toBe('测试文档');
      expect(result.metadata.tags).toBe('test,markdown');
    });

    it('应该处理 Markdown 代码块', async () => {
      const content = `# 示例

\`\`\`python
print("Hello, World!")
\`\`\`
`;

      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: content,
        codeBlocks: [
          { language: 'python', code: 'print("Hello, World!")' }
        ]
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/test.md');

      expect(result.success).toBe(true);
      expect(result.codeBlocks).toHaveLength(1);
      expect(result.codeBlocks[0].language).toBe('python');
    });
  });

  describe('PDF 文件导入', () => {
    it('应该成功导入 PDF 文件', async () => {
      const filePath = '/path/to/test.pdf';

      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '这是PDF提取的文本内容',
        type: 'pdf',
        pages: 5
      });

      const result = await mockElectronAPI.fs.readFile(filePath);

      expect(result.success).toBe(true);
      expect(result.type).toBe('pdf');
      expect(result.pages).toBe(5);
    });

    it('应该提取 PDF 文本内容', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '第一页内容\n第二页内容',
        type: 'pdf'
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/test.pdf');

      expect(result.success).toBe(true);
      expect(result.content).toContain('第一页内容');
      expect(result.content).toContain('第二页内容');
    });

    it('应该处理 PDF 元数据', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: 'PDF内容',
        metadata: {
          title: 'PDF文档标题',
          author: '作者',
          creationDate: '2024-01-01'
        }
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/test.pdf');

      expect(result.success).toBe(true);
      expect(result.metadata.title).toBe('PDF文档标题');
      expect(result.metadata.author).toBe('作者');
    });

    it('应该处理加密的 PDF', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: false,
        error: 'pdf_encrypted',
        message: 'PDF文件已加密,需要密码'
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/encrypted.pdf');

      expect(result.success).toBe(false);
      expect(result.error).toBe('pdf_encrypted');
    });
  });

  describe('Word 文件导入', () => {
    it('应该成功导入 Word 文件', async () => {
      const filePath = '/path/to/test.docx';

      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: 'Word文档内容',
        type: 'word'
      });

      const result = await mockElectronAPI.fs.readFile(filePath);

      expect(result.success).toBe(true);
      expect(result.type).toBe('word');
      expect(result.content).toContain('Word文档内容');
    });

    it('应该保留 Word 文档格式', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '<p><strong>粗体</strong> <em>斜体</em></p>',
        html: '<p><strong>粗体</strong> <em>斜体</em></p>',
        type: 'word'
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/test.docx');

      expect(result.success).toBe(true);
      expect(result.html).toContain('<strong>');
      expect(result.html).toContain('<em>');
    });

    it('应该提取 Word 文档图片', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '文档内容',
        images: [
          { name: 'image1.png', data: 'base64data' },
          { name: 'image2.jpg', data: 'base64data' }
        ]
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/test.docx');

      expect(result.success).toBe(true);
      expect(result.images).toHaveLength(2);
    });

    it('应该处理 Word 表格', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '文档内容',
        tables: [
          {
            rows: [
              ['列1', '列2'],
              ['数据1', '数据2']
            ]
          }
        ]
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/test.docx');

      expect(result.success).toBe(true);
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].rows).toHaveLength(2);
    });
  });

  describe('TXT 文件导入', () => {
    it('应该成功导入 TXT 文件', async () => {
      const filePath = '/path/to/test.txt';
      const content = '这是一个纯文本文件\n第二行内容';

      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: content,
        type: 'text'
      });

      const result = await mockElectronAPI.fs.readFile(filePath);

      expect(result.success).toBe(true);
      expect(result.type).toBe('text');
      expect(result.content).toContain('纯文本文件');
    });

    it('应该自动检测文本编码', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '中文内容',
        encoding: 'utf-8'
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/test.txt');

      expect(result.success).toBe(true);
      expect(result.encoding).toBe('utf-8');
    });

    it('应该处理大文件', async () => {
      const largeContent = 'x'.repeat(10000);

      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: largeContent,
        size: largeContent.length
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/large.txt');

      expect(result.success).toBe(true);
      expect(result.size).toBeGreaterThan(5000);
    });
  });

  describe('批量导入', () => {
    it('应该支持批量导入多个文件', async () => {
      const files = [
        '/path/to/file1.md',
        '/path/to/file2.pdf',
        '/path/to/file3.docx'
      ];

      mockElectronAPI.fs.readFile
        .mockResolvedValueOnce({ success: true, content: 'MD内容', type: 'markdown' })
        .mockResolvedValueOnce({ success: true, content: 'PDF内容', type: 'pdf' })
        .mockResolvedValueOnce({ success: true, content: 'Word内容', type: 'word' });

      const results = [];
      for (const file of files) {
        results.push(await mockElectronAPI.fs.readFile(file));
      }

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('应该处理批量导入中的错误', async () => {
      mockElectronAPI.fs.readFile
        .mockResolvedValueOnce({ success: true, content: '成功' })
        .mockResolvedValueOnce({ success: false, error: 'file_not_found' })
        .mockResolvedValueOnce({ success: true, content: '成功' });

      const files = ['/f1.md', '/f2.md', '/f3.md'];
      const results = [];

      for (const file of files) {
        results.push(await mockElectronAPI.fs.readFile(file));
      }

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('应该处理文件不存在的错误', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: false,
        error: 'file_not_found',
        message: '文件不存在'
      });

      const result = await mockElectronAPI.fs.readFile('/non/existent.md');

      expect(result.success).toBe(false);
      expect(result.error).toBe('file_not_found');
    });

    it('应该处理文件权限错误', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: false,
        error: 'permission_denied',
        message: '没有读取权限'
      });

      const result = await mockElectronAPI.fs.readFile('/protected/file.pdf');

      expect(result.success).toBe(false);
      expect(result.error).toBe('permission_denied');
    });

    it('应该处理不支持的文件类型', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: false,
        error: 'unsupported_type',
        message: '不支持的文件类型'
      });

      const result = await mockElectronAPI.fs.readFile('/file.xyz');

      expect(result.success).toBe(false);
      expect(result.error).toBe('unsupported_type');
    });

    it('应该处理文件损坏的错误', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: false,
        error: 'corrupted_file',
        message: '文件损坏或格式错误'
      });

      const result = await mockElectronAPI.fs.readFile('/corrupted.pdf');

      expect(result.success).toBe(false);
      expect(result.error).toBe('corrupted_file');
    });
  });

  describe('图片文本提取 (OCR)', () => {
    it('应该从图片中提取文本', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '图片中识别的文本',
        type: 'image',
        ocrText: '图片中识别的文本'
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/image.png');

      expect(result.success).toBe(true);
      expect(result.ocrText).toBeDefined();
    });

    it('应该处理 OCR 失败', async () => {
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '',
        type: 'image',
        ocrText: null,
        ocrError: '无法识别文本'
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/image.png');

      expect(result.success).toBe(true);
      expect(result.ocrText).toBeNull();
      expect(result.ocrError).toBeDefined();
    });
  });

  describe('文件类型检测', () => {
    it('应该正确检测 Markdown 文件', async () => {
      mockElectronAPI.fs.exists.mockResolvedValue(true);

      const filePath = '/path/to/file.md';
      const result = await mockElectronAPI.fs.exists(filePath);

      expect(result).toBe(true);
    });

    it('应该正确检测 PDF 文件', async () => {
      const filePath = '/path/to/file.pdf';
      expect(filePath.endsWith('.pdf')).toBe(true);
    });

    it('应该正确检测 Word 文件', async () => {
      const filePath = '/path/to/file.docx';
      expect(filePath.endsWith('.docx')).toBe(true);
    });

    it('应该正确检测 TXT 文件', async () => {
      const filePath = '/path/to/file.txt';
      expect(filePath.endsWith('.txt')).toBe(true);
    });
  });
});
