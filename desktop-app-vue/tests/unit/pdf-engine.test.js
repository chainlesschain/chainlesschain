/**
 * PDF引擎测试
 * 测试 PDF 生成、转换和批量处理功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PDFEngine, getPDFEngine } from '../../src/main/engines/pdf-engine.js';

// Mock 依赖
vi.mock('fs-extra', () => ({
  default: {
    stat: vi.fn(),
    ensureDir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
  },
  stat: vi.fn(),
  ensureDir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('marked', () => ({
  marked: {
    parse: vi.fn(),
    setOptions: vi.fn(),
  },
}));

vi.mock('electron', () => {
  // Create a constructor function for BrowserWindow
  const mockBrowserWindowInstance = {
    loadURL: vi.fn().mockResolvedValue(undefined),
    webContents: {
      printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF content')),
    },
    close: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    destroy: vi.fn(),
  };

  // Mock constructor function
  const MockBrowserWindow = vi.fn(function() {
    return mockBrowserWindowInstance;
  });

  return {
    BrowserWindow: MockBrowserWindow,
  };
});

describe('PDF引擎测试', () => {
  let pdfEngine;
  let mockFs;
  let mockMarked;
  let mockBrowserWindow;

  beforeEach(async () => {
    // 获取mock模块
    mockFs = await import('fs-extra');
    mockMarked = await import('marked');
    const electron = await import('electron');
    mockBrowserWindow = electron.BrowserWindow;

    // 创建新实例
    pdfEngine = new PDFEngine();

    // 重置所有mock
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('构造函数', () => {
    it('should create PDFEngine instance', () => {
      expect(pdfEngine).toBeDefined();
      expect(pdfEngine.name).toBe('PDFEngine');
    });

    it('should have all required methods', () => {
      expect(typeof pdfEngine.markdownToPDF).toBe('function');
      expect(typeof pdfEngine.markdownToHTML).toBe('function');
      expect(typeof pdfEngine.htmlToPDF).toBe('function');
      expect(typeof pdfEngine.htmlFileToPDF).toBe('function');
      expect(typeof pdfEngine.textFileToPDF).toBe('function');
      expect(typeof pdfEngine.batchConvert).toBe('function');
    });
  });

  describe('markdownToHTML', () => {
    it('should convert markdown to HTML', async () => {
      mockMarked.marked.parse.mockReturnValue('<p>Test content</p>');

      const html = await pdfEngine.markdownToHTML('# Test', { title: 'Test Doc' });

      expect(mockMarked.marked.setOptions).toHaveBeenCalled();
      expect(mockMarked.marked.parse).toHaveBeenCalledWith('# Test');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Test Doc</title>');
      expect(html).toContain('<p>Test content</p>');
    });

    it('should use default title if not provided', async () => {
      mockMarked.marked.parse.mockReturnValue('<p>Content</p>');

      const html = await pdfEngine.markdownToHTML('Test');

      expect(html).toContain('<title>Document</title>');
    });

    it('should include custom CSS if provided', async () => {
      mockMarked.marked.parse.mockReturnValue('<p>Content</p>');

      const customCSS = 'body { background: red; }';
      const html = await pdfEngine.markdownToHTML('Test', { customCSS });

      expect(html).toContain(customCSS);
    });

    it('should handle page size option', async () => {
      mockMarked.marked.parse.mockReturnValue('<p>Content</p>');

      const html = await pdfEngine.markdownToHTML('Test', { pageSize: 'Letter' });

      expect(html).toContain('size: Letter');
    });

    it('should handle empty markdown', async () => {
      mockMarked.marked.parse.mockReturnValue('');

      const html = await pdfEngine.markdownToHTML('');

      expect(html).toContain('<!DOCTYPE html>');
    });

    it('should handle markdown with special characters', async () => {
      const specialContent = '<script>alert("XSS")</script>';
      mockMarked.marked.parse.mockReturnValue(specialContent);

      const html = await pdfEngine.markdownToHTML('# Test\n' + specialContent);

      expect(mockMarked.marked.parse).toHaveBeenCalled();
    });

    it('should handle markdown with code blocks', async () => {
      mockMarked.marked.parse.mockReturnValue('<pre><code>const x = 1;</code></pre>');

      const html = await pdfEngine.markdownToHTML('```js\nconst x = 1;\n```');

      expect(html).toContain('<pre><code>const x = 1;</code></pre>');
    });

    it('should handle markdown with tables', async () => {
      mockMarked.marked.parse.mockReturnValue('<table><tr><td>Cell</td></tr></table>');

      const html = await pdfEngine.markdownToHTML('| Header |\n|--------|');

      expect(html).toContain('<table>');
    });
  });

  describe('htmlToPDF', () => {
    it('should convert HTML to PDF', async () => {
      const mockPDFData = Buffer.from('PDF content');

      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(mockPDFData),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));

      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await pdfEngine.htmlToPDF('<html></html>', '/output/test.pdf');

      expect(mockBrowserWindow).toHaveBeenCalled();
      expect(mockFs.ensureDir).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalledWith('/output/test.pdf', mockPDFData);
    });

    it('should create BrowserWindow with correct options', async () => {
      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));

      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await pdfEngine.htmlToPDF('<html></html>', '/test.pdf');

      expect(mockBrowserWindow).toHaveBeenCalledWith({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
    });

    it('should handle landscape option', async () => {
      const mockPrintToPDF = vi.fn().mockResolvedValue(Buffer.from('PDF'));

      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: mockPrintToPDF,
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));

      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await pdfEngine.htmlToPDF('<html></html>', '/test.pdf', { landscape: true });

      expect(mockPrintToPDF).toHaveBeenCalledWith(
        expect.objectContaining({ landscape: true })
      );
    });

    it('should handle custom page size', async () => {
      const mockPrintToPDF = vi.fn().mockResolvedValue(Buffer.from('PDF'));

      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: mockPrintToPDF,
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));

      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await pdfEngine.htmlToPDF('<html></html>', '/test.pdf', { pageSize: 'Letter' });

      expect(mockPrintToPDF).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 'Letter' })
      );
    });

    it('should close window even if conversion fails', async () => {
      const mockClose = vi.fn();

      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockRejectedValue(new Error('Load failed')),
        webContents: {
          printToPDF: vi.fn(),
        },
        close: mockClose,
        isDestroyed: vi.fn(() => false),
      }));

      await expect(
        pdfEngine.htmlToPDF('<html></html>', '/test.pdf')
      ).rejects.toThrow();

      expect(mockClose).toHaveBeenCalled();
    });

    it('should not close already destroyed window', async () => {
      const mockClose = vi.fn();

      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockRejectedValue(new Error('Failed')),
        webContents: {
          printToPDF: vi.fn(),
        },
        close: mockClose,
        isDestroyed: vi.fn(() => true), // Already destroyed
      }));

      await expect(
        pdfEngine.htmlToPDF('<html></html>', '/test.pdf')
      ).rejects.toThrow();

      expect(mockClose).not.toHaveBeenCalled();
    });

    it('should encode HTML properly for data URL', async () => {
      const mockLoadURL = vi.fn().mockResolvedValue(undefined);

      mockBrowserWindow.mockImplementation(() => ({
        loadURL: mockLoadURL,
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));

      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const htmlWithSpecialChars = '<html><body>Test & <>&"</body></html>';
      await pdfEngine.htmlToPDF(htmlWithSpecialChars, '/test.pdf');

      expect(mockLoadURL).toHaveBeenCalled();
      const url = mockLoadURL.mock.calls[0][0];
      expect(url).toContain('data:text/html;charset=utf-8,');
    });
  });

  describe('markdownToPDF', () => {
    beforeEach(() => {
      mockMarked.marked.parse.mockReturnValue('<p>Content</p>');
      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 1024 });
    });

    it('should convert markdown to PDF', async () => {
      const result = await pdfEngine.markdownToPDF('# Test', '/test.pdf');

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe('/test.pdf');
      expect(result.size).toBe(1024);
    });

    it('should pass options to markdown conversion', async () => {
      await pdfEngine.markdownToPDF('# Test', '/test.pdf', { title: 'My Doc' });

      expect(mockMarked.marked.parse).toHaveBeenCalled();
    });

    it('should handle conversion errors', async () => {
      mockMarked.marked.parse.mockImplementation(() => {
        throw new Error('Parse error');
      });

      await expect(
        pdfEngine.markdownToPDF('# Test', '/test.pdf')
      ).rejects.toThrow('Parse error');
    });

    it('should handle large markdown files', async () => {
      const largeMarkdown = '# Test\n'.repeat(10000);
      mockMarked.marked.parse.mockReturnValue('<p>Large content</p>'.repeat(10000));
      mockFs.stat.mockResolvedValue({ size: 1024 * 1024 }); // 1MB

      const result = await pdfEngine.markdownToPDF(largeMarkdown, '/test.pdf');

      expect(result.success).toBe(true);
      expect(result.size).toBe(1024 * 1024);
    });
  });

  describe('htmlFileToPDF', () => {
    beforeEach(() => {
      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 2048 });
    });

    it('should convert HTML file to PDF', async () => {
      mockFs.readFile.mockResolvedValue('<html><body>Test</body></html>');

      const result = await pdfEngine.htmlFileToPDF('/input.html', '/output.pdf');

      expect(mockFs.readFile).toHaveBeenCalledWith('/input.html', 'utf-8');
      expect(result.success).toBe(true);
      expect(result.outputPath).toBe('/output.pdf');
      expect(result.size).toBe(2048);
    });

    it('should handle file read errors', async () => {
      mockFs.readFile.mockRejectedValue(new Error('File not found'));

      await expect(
        pdfEngine.htmlFileToPDF('/missing.html', '/output.pdf')
      ).rejects.toThrow('File not found');
    });

    it('should pass options to htmlToPDF', async () => {
      mockFs.readFile.mockResolvedValue('<html></html>');

      await pdfEngine.htmlFileToPDF('/input.html', '/output.pdf', { landscape: true });

      // Verify printToPDF was called with landscape option
      const win = mockBrowserWindow.mock.results[0].value;
      expect(win.webContents.printToPDF).toHaveBeenCalledWith(
        expect.objectContaining({ landscape: true })
      );
    });
  });

  describe('textFileToPDF', () => {
    beforeEach(() => {
      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 512 });
    });

    it('should convert text file to PDF', async () => {
      mockFs.readFile.mockResolvedValue('Plain text content');

      const result = await pdfEngine.textFileToPDF('/input.txt', '/output.pdf');

      expect(mockFs.readFile).toHaveBeenCalledWith('/input.txt', 'utf-8');
      expect(result.success).toBe(true);
      expect(result.size).toBe(512);
    });

    it('should use filename as default title', async () => {
      mockFs.readFile.mockResolvedValue('Text');
      const mockLoadURL = vi.fn().mockResolvedValue(undefined);

      mockBrowserWindow.mockImplementationOnce(() => ({
        loadURL: mockLoadURL,
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));

      await pdfEngine.textFileToPDF('/path/to/myfile.txt', '/output.pdf');

      // The HTML should contain the filename as title
      const url = mockLoadURL.mock.calls[0][0];
      expect(url).toContain('myfile.txt');
    });

    it('should handle empty text file', async () => {
      mockFs.readFile.mockResolvedValue('');

      const result = await pdfEngine.textFileToPDF('/empty.txt', '/output.pdf');

      expect(result.success).toBe(true);
    });

    it('should handle text with special characters', async () => {
      mockFs.readFile.mockResolvedValue('Text with & < > " \' characters');

      const result = await pdfEngine.textFileToPDF('/special.txt', '/output.pdf');

      expect(result.success).toBe(true);
    });

    it('should preserve whitespace and line breaks', async () => {
      const textWithFormatting = 'Line 1\n  Line 2 with spaces\n\n\nLine 3';
      mockFs.readFile.mockResolvedValue(textWithFormatting);
      const mockLoadURL = vi.fn().mockResolvedValue(undefined);

      mockBrowserWindow.mockImplementationOnce(() => ({
        loadURL: mockLoadURL,
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));

      await pdfEngine.textFileToPDF('/formatted.txt', '/output.pdf');

      // Check that the HTML uses pre-wrap style
      const url = mockLoadURL.mock.calls[0][0];
      expect(url).toContain('white-space: pre-wrap');
    });
  });

  describe('batchConvert', () => {
    beforeEach(() => {
      mockMarked.marked.parse.mockReturnValue('<p>Content</p>');
      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 1024 });
      mockFs.readFile.mockResolvedValue('Content');
    });

    it('should batch convert markdown files', async () => {
      const files = ['/test1.md', '/test2.md', '/test3.md'];

      const results = await pdfEngine.batchConvert(files, '/output');

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(results[0].output).toContain('/output/test1.pdf');
      expect(results[1].output).toContain('/output/test2.pdf');
      expect(results[2].output).toContain('/output/test3.pdf');
    });

    it('should batch convert HTML files', async () => {
      const files = ['/test1.html', '/test2.htm'];

      const results = await pdfEngine.batchConvert(files, '/output');

      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should batch convert text files', async () => {
      const files = ['/test1.txt', '/test2.txt'];

      const results = await pdfEngine.batchConvert(files, '/output');

      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should handle mixed file types', async () => {
      const files = ['/test.md', '/test.html', '/test.txt'];

      const results = await pdfEngine.batchConvert(files, '/output');

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should handle conversion errors gracefully', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('Read failed'));

      const files = ['/fail.md', '/success.md'];

      const results = await pdfEngine.batchConvert(files, '/output');

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Read failed');
      expect(results[1].success).toBe(true);
    });

    it('should handle unsupported file types', async () => {
      const files = ['/test.docx', '/test.pdf'];

      const results = await pdfEngine.batchConvert(files, '/output');

      expect(results).toHaveLength(2);
      expect(results.every(r => r.success === false)).toBe(true);
      expect(results[0].error).toContain('不支持的文件类型');
    });

    it('should pass options to individual conversions', async () => {
      const files = ['/test.md'];
      const options = { title: 'Custom Title', pageSize: 'Letter' };

      await pdfEngine.batchConvert(files, '/output', options);

      // Verify options were used
      expect(mockMarked.marked.parse).toHaveBeenCalled();
    });

    it('should handle empty file list', async () => {
      const results = await pdfEngine.batchConvert([], '/output');

      expect(results).toHaveLength(0);
    });

    it('should generate correct output paths', async () => {
      const files = [
        '/path/to/file.md',
        'C:\\Windows\\path\\file.html',
        '/file.with.dots.txt'
      ];

      const results = await pdfEngine.batchConvert(files, '/output');

      expect(results[0].output).toContain('file.pdf');
      expect(results[1].output).toContain('file.pdf');
      expect(results[2].output).toContain('file.with.dots.pdf');
    });
  });

  describe('getPDFEngine - 单例模式', () => {
    it('should return the same instance', () => {
      const instance1 = getPDFEngine();
      const instance2 = getPDFEngine();

      expect(instance1).toBe(instance2);
    });

    it('should return PDFEngine instance', () => {
      const instance = getPDFEngine();

      expect(instance).toBeInstanceOf(PDFEngine);
      expect(instance.name).toBe('PDFEngine');
    });

    it('should have all required methods', () => {
      const instance = getPDFEngine();

      expect(typeof instance.markdownToPDF).toBe('function');
      expect(typeof instance.htmlToPDF).toBe('function');
      expect(typeof instance.batchConvert).toBe('function');
    });
  });

  describe('边界条件和错误处理', () => {
    beforeEach(() => {
      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 100 });
    });

    it('should handle null markdown content', async () => {
      mockMarked.marked.parse.mockReturnValue('');

      const html = await pdfEngine.markdownToHTML(null);

      expect(html).toContain('<!DOCTYPE html>');
    });

    it('should handle undefined options', async () => {
      mockMarked.marked.parse.mockReturnValue('<p>Test</p>');

      const html = await pdfEngine.markdownToHTML('# Test', undefined);

      expect(html).toContain('<!DOCTYPE html>');
    });

    it('should handle very long output paths', async () => {
      mockMarked.marked.parse.mockReturnValue('<p>Test</p>');

      const longPath = '/output/' + 'a'.repeat(200) + '.pdf';

      const result = await pdfEngine.markdownToPDF('# Test', longPath);

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(longPath);
    });

    it('should handle file system errors', async () => {
      mockFs.ensureDir.mockRejectedValue(new Error('No permission'));
      mockMarked.marked.parse.mockReturnValue('<p>Test</p>');

      await expect(
        pdfEngine.htmlToPDF('<html></html>', '/protected/test.pdf')
      ).rejects.toThrow();
    });

    it('should handle printToPDF errors', async () => {
      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: vi.fn().mockRejectedValue(new Error('Print failed')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));

      await expect(
        pdfEngine.htmlToPDF('<html></html>', '/test.pdf')
      ).rejects.toThrow('Print failed');
    });

    it('should handle Unicode content', async () => {
      mockMarked.marked.parse.mockReturnValue('<p>你好世界 🌍 مرحبا</p>');
      mockFs.readFile.mockResolvedValue('你好世界 🌍 مرحبا');

      const result = await pdfEngine.markdownToPDF('你好世界 🌍 مرحبا', '/test.pdf');

      expect(result.success).toBe(true);
    });

    it('should handle concurrent PDF generation', async () => {
      mockMarked.marked.parse.mockReturnValue('<p>Test</p>');

      const promises = [
        pdfEngine.markdownToPDF('# Test 1', '/test1.pdf'),
        pdfEngine.markdownToPDF('# Test 2', '/test2.pdf'),
        pdfEngine.markdownToPDF('# Test 3', '/test3.pdf'),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
    });
  });

  describe('性能测试', () => {
    beforeEach(() => {
      mockMarked.marked.parse.mockReturnValue('<p>Content</p>');
      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
      }));
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 1024 });
      mockFs.readFile.mockResolvedValue('Content');
    });

    it('should handle batch conversion efficiently', async () => {
      const files = Array.from({ length: 10 }, (_, i) => `/test${i}.md`);

      const startTime = Date.now();
      const results = await pdfEngine.batchConvert(files, '/output');
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(10);
      expect(results.every(r => r.success)).toBe(true);
      // Should complete reasonably fast (mocked, so very fast)
      expect(duration).toBeLessThan(5000);
    });

    it('should not leak memory with multiple conversions', async () => {
      const mockClose = vi.fn();

      mockBrowserWindow.mockImplementation(() => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: {
          printToPDF: vi.fn().mockResolvedValue(Buffer.from('PDF')),
        },
        close: mockClose,
        isDestroyed: vi.fn(() => false),
      }));

      for (let i = 0; i < 5; i++) {
        await pdfEngine.markdownToPDF(`# Test ${i}`, `/test${i}.pdf`);
      }

      // All windows should be closed
      expect(mockClose).toHaveBeenCalledTimes(5);
    });
  });
});
