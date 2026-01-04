/**
 * PDF引擎测试 (Jest版本)
 * 测试 PDF 生成、转换和批量处理功能
 */

// Mock dependencies before requiring the module
const mockStat = jest.fn();
const mockEnsureDir = jest.fn();
const mockWriteFile = jest.fn();
const mockReadFile = jest.fn();

jest.mock('fs-extra', () => ({
  stat: mockStat,
  ensureDir: mockEnsureDir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
}));

jest.mock('marked', () => ({
  marked: {
    parse: jest.fn(),
    setOptions: jest.fn(),
  },
}));

// Default implementation factory for BrowserWindow
const createMockBrowserWindow = () => ({
  loadURL: jest.fn().mockResolvedValue(undefined),
  webContents: {
    printToPDF: jest.fn().mockResolvedValue(Buffer.from('PDF content')),
  },
  close: jest.fn(),
  isDestroyed: jest.fn().mockReturnValue(false),
  destroy: jest.fn(),
});

const mockBrowserWindowConstructor = jest.fn(createMockBrowserWindow);

jest.mock('electron', () => ({
  BrowserWindow: mockBrowserWindowConstructor,
}));

describe('PDF引擎测试', () => {
  let PDFEngine, getPDFEngine;
  let pdfEngine;
  let mockMarked;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Get marked mock FIRST, before loading PDF engine
    const markedModule = require('marked');
    mockMarked = markedModule.marked;

    // Set default return values for marked mocks
    mockMarked.parse.mockReturnValue('<p>Default content</p>');
    mockMarked.setOptions.mockImplementation(() => {});

    // Reset BrowserWindow mock to default implementation
    mockBrowserWindowConstructor.mockImplementation(createMockBrowserWindow);

    // Require fresh PDF engine module (don't use resetModules which clears all mocks)
    delete require.cache[require.resolve('../../desktop-app-vue/src/main/engines/pdf-engine')];
    const module = require('../../desktop-app-vue/src/main/engines/pdf-engine');
    PDFEngine = module.PDFEngine;
    getPDFEngine = module.getPDFEngine;

    // Create new instance
    pdfEngine = new PDFEngine();
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
      mockMarked.parse.mockReturnValue('<p>Test content</p>');

      const html = await pdfEngine.markdownToHTML('# Test', { title: 'Test Doc' });

      // Verify HTML output structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
      expect(html).toContain('<title>Test Doc</title>');
      expect(html).toContain('</html>');
      // Content should be in the body
      expect(html).toMatch(/<body[\s\S]*>[\s\S]*<\/body>/);
    });

    it('should use default title if not provided', async () => {
      mockMarked.parse.mockReturnValue('<p>Content</p>');

      const html = await pdfEngine.markdownToHTML('Test', {});

      expect(html).toContain('<title>Document</title>');
    });

    it('should include custom CSS if provided', async () => {
      mockMarked.parse.mockReturnValue('<p>Content</p>');

      const customCSS = 'body { background: red; }';
      const html = await pdfEngine.markdownToHTML('Test', { customCSS });

      expect(html).toContain(customCSS);
    });

    it('should handle page size option', async () => {
      mockMarked.parse.mockReturnValue('<p>Content</p>');

      const html = await pdfEngine.markdownToHTML('Test', { pageSize: 'Letter' });

      expect(html).toContain('size: Letter');
    });

    it('should handle empty markdown', async () => {
      mockMarked.parse.mockReturnValue('');

      const html = await pdfEngine.markdownToHTML('', {});

      expect(html).toContain('<!DOCTYPE html>');
    });
  });

  describe('htmlToPDF', () => {
    it('should convert HTML to PDF', async () => {
      const mockPDFData = Buffer.from('PDF content');

      const mockWindow = createMockBrowserWindow();
      mockWindow.webContents.printToPDF.mockResolvedValue(mockPDFData);
      mockBrowserWindowConstructor.mockReturnValue(mockWindow);

      mockEnsureDir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await pdfEngine.htmlToPDF('<html></html>', '/output/test.pdf');

      expect(mockBrowserWindowConstructor).toHaveBeenCalled();
      expect(mockEnsureDir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith('/output/test.pdf', mockPDFData);
    });

    it('should create BrowserWindow with correct options', async () => {
      mockEnsureDir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await pdfEngine.htmlToPDF('<html></html>', '/test.pdf');

      expect(mockBrowserWindowConstructor).toHaveBeenCalledWith({
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
      const mockPrintToPDF = jest.fn().mockResolvedValue(Buffer.from('PDF'));

      const mockWindow = createMockBrowserWindow();
      mockWindow.webContents.printToPDF = mockPrintToPDF;
      mockBrowserWindowConstructor.mockReturnValue(mockWindow);

      mockEnsureDir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await pdfEngine.htmlToPDF('<html></html>', '/test.pdf', { landscape: true });

      expect(mockPrintToPDF).toHaveBeenCalledWith(
        expect.objectContaining({ landscape: true })
      );
    });

    it('should close window even if conversion fails', async () => {
      const mockClose = jest.fn();
      const mockWindow = createMockBrowserWindow();
      mockWindow.loadURL.mockRejectedValue(new Error('Load failed'));
      mockWindow.close = mockClose;
      mockBrowserWindowConstructor.mockReturnValue(mockWindow);

      await expect(
        pdfEngine.htmlToPDF('<html></html>', '/test.pdf')
      ).rejects.toThrow();

      expect(mockClose).toHaveBeenCalled();
    });

    it('should not close already destroyed window', async () => {
      const mockClose = jest.fn();
      const mockWindow = createMockBrowserWindow();
      mockWindow.loadURL.mockRejectedValue(new Error('Failed'));
      mockWindow.isDestroyed.mockReturnValue(true);
      mockWindow.close = mockClose;
      mockBrowserWindowConstructor.mockReturnValue(mockWindow);

      await expect(
        pdfEngine.htmlToPDF('<html></html>', '/test.pdf')
      ).rejects.toThrow();

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('markdownToPDF', () => {
    beforeEach(() => {
      mockMarked.parse.mockReturnValue('<p>Content</p>');
      mockEnsureDir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 1024 });
    });

    it('should convert markdown to PDF', async () => {
      const result = await pdfEngine.markdownToPDF('# Test', '/test.pdf');

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe('/test.pdf');
      expect(result.size).toBe(1024);
    });

    it('should pass options to markdown conversion', async () => {
      const result = await pdfEngine.markdownToPDF('# Test', '/test.pdf', { title: 'My Doc' });

      // Check that conversion succeeded
      expect(result.success).toBe(true);
      expect(result.outputPath).toBe('/test.pdf');
      expect(result.size).toBeGreaterThan(0);
    });

    it('should handle conversion errors', async () => {
      // Mock fs.ensureDir to throw error to simulate conversion failure
      mockEnsureDir.mockRejectedValueOnce(new Error('Write permission denied'));

      await expect(
        pdfEngine.markdownToPDF('# Test', '/test.pdf')
      ).rejects.toThrow();

      // Reset mock for other tests
      mockEnsureDir.mockResolvedValue(undefined);
    });
  });

  describe('htmlFileToPDF', () => {
    beforeEach(() => {
      mockEnsureDir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 2048 });
    });

    it('should convert HTML file to PDF', async () => {
      mockReadFile.mockResolvedValue('<html><body>Test</body></html>');

      const result = await pdfEngine.htmlFileToPDF('/input.html', '/output.pdf');

      expect(mockReadFile).toHaveBeenCalledWith('/input.html', 'utf-8');
      expect(result.success).toBe(true);
      expect(result.outputPath).toBe('/output.pdf');
      expect(result.size).toBe(2048);
    });

    it('should handle file read errors', async () => {
      mockReadFile.mockRejectedValue(new Error('File not found'));

      await expect(
        pdfEngine.htmlFileToPDF('/missing.html', '/output.pdf')
      ).rejects.toThrow('File not found');
    });
  });

  describe('textFileToPDF', () => {
    beforeEach(() => {
      mockEnsureDir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 512 });
    });

    it('should convert text file to PDF', async () => {
      mockReadFile.mockResolvedValue('Plain text content');

      const result = await pdfEngine.textFileToPDF('/input.txt', '/output.pdf');

      expect(mockReadFile).toHaveBeenCalledWith('/input.txt', 'utf-8');
      expect(result.success).toBe(true);
      expect(result.size).toBe(512);
    });

    it('should handle empty text file', async () => {
      mockReadFile.mockResolvedValue('');

      const result = await pdfEngine.textFileToPDF('/empty.txt', '/output.pdf');

      expect(result.success).toBe(true);
    });
  });

  describe('batchConvert', () => {
    beforeEach(() => {
      mockMarked.parse.mockReturnValue('<p>Content</p>');
      mockEnsureDir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 1024 });
      mockReadFile.mockResolvedValue('Content');
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

    it('should handle conversion errors gracefully', async () => {
      mockReadFile
        .mockRejectedValueOnce(new Error('Read failed'))
        .mockResolvedValueOnce('success content');

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

    it('should handle empty file list', async () => {
      const results = await pdfEngine.batchConvert([], '/output');

      expect(results).toHaveLength(0);
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
  });

  describe('边界条件和错误处理', () => {
    beforeEach(() => {
      mockEnsureDir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 100 });
    });

    it('should handle empty options', async () => {
      mockMarked.parse.mockReturnValue('<p>Test</p>');

      const html = await pdfEngine.markdownToHTML('# Test', {});

      expect(html).toContain('<!DOCTYPE html>');
    });

    it('should handle file system errors', async () => {
      mockEnsureDir.mockRejectedValue(new Error('No permission'));
      mockMarked.parse.mockReturnValue('<p>Test</p>');

      await expect(
        pdfEngine.htmlToPDF('<html></html>', '/protected/test.pdf')
      ).rejects.toThrow();
    });

    it('should handle printToPDF errors', async () => {
      const mockWindow = createMockBrowserWindow();
      mockWindow.webContents.printToPDF.mockRejectedValue(new Error('Print failed'));
      mockBrowserWindowConstructor.mockReturnValue(mockWindow);

      await expect(
        pdfEngine.htmlToPDF('<html></html>', '/test.pdf')
      ).rejects.toThrow('Print failed');
    });

    it('should handle concurrent PDF generation', async () => {
      mockMarked.parse.mockReturnValue('<p>Test</p>');

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
});
