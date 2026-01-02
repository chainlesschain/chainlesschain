/**
 * PDF IPC 单元测试
 * 测试4个PDF转换API方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
  },
}));

describe('PDF IPC', () => {
  let mockPDFConverter;
  let handlers = {};

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};

    mockPDFConverter = {
      markdownToPDF: vi.fn(),
      htmlToPDF: vi.fn(),
      textToPDF: vi.fn(),
    };

    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    const { registerPDFIPC } = require('../../src/main/pdf/pdf-ipc');
    registerPDFIPC({ pdfConverter: mockPDFConverter });
  });

  describe('PDF Conversion', () => {
    it('should convert markdown to PDF', async () => {
      const outputPath = '/output/test.pdf';
      mockPDFConverter.markdownToPDF.mockResolvedValue(outputPath);
      fs.readFile.mockResolvedValue('# Markdown Content');

      const result = await handlers['pdf:markdownToPDF'](null, {
        inputPath: '/input/test.md',
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(outputPath);
      expect(mockPDFConverter.markdownToPDF).toHaveBeenCalled();
    });

    it('should convert HTML file to PDF', async () => {
      const outputPath = '/output/test.pdf';
      mockPDFConverter.htmlToPDF.mockResolvedValue(outputPath);
      fs.readFile.mockResolvedValue('<html><body>Content</body></html>');

      const result = await handlers['pdf:htmlFileToPDF'](null, {
        inputPath: '/input/test.html',
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(outputPath);
    });

    it('should convert text file to PDF', async () => {
      const outputPath = '/output/test.pdf';
      mockPDFConverter.textToPDF.mockResolvedValue(outputPath);
      fs.readFile.mockResolvedValue('Plain text content');

      const result = await handlers['pdf:textFileToPDF'](null, {
        inputPath: '/input/test.txt',
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe(outputPath);
    });

    it('should batch convert files', async () => {
      const files = [
        { inputPath: '/input/1.md', type: 'markdown' },
        { inputPath: '/input/2.html', type: 'html' },
      ];

      mockPDFConverter.markdownToPDF.mockResolvedValue('/output/1.pdf');
      mockPDFConverter.htmlToPDF.mockResolvedValue('/output/2.pdf');
      fs.readFile.mockResolvedValue('content');

      const result = await handlers['pdf:batchConvert'](null, {
        files,
        outputDir: '/output',
      });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
    });
  });

  describe('PDF Options', () => {
    it('should accept custom PDF options', async () => {
      const options = {
        inputPath: '/input/test.md',
        outputPath: '/output/test.pdf',
        format: 'A4',
        margin: { top: '1cm', bottom: '1cm' },
      };

      mockPDFConverter.markdownToPDF.mockResolvedValue(options.outputPath);
      fs.readFile.mockResolvedValue('content');

      const result = await handlers['pdf:markdownToPDF'](null, options);

      expect(result.success).toBe(true);
      expect(mockPDFConverter.markdownToPDF).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          format: 'A4',
          margin: options.margin,
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle file read errors', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      const result = await handlers['pdf:markdownToPDF'](null, {
        inputPath: '/input/nonexistent.md',
        outputPath: '/output/test.pdf',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should handle conversion errors', async () => {
      fs.readFile.mockResolvedValue('content');
      mockPDFConverter.markdownToPDF.mockRejectedValue(new Error('Conversion failed'));

      const result = await handlers['pdf:markdownToPDF'](null, {
        inputPath: '/input/test.md',
        outputPath: '/output/test.pdf',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Conversion failed');
    });

    it('should handle batch conversion errors gracefully', async () => {
      const files = [
        { inputPath: '/input/1.md', type: 'markdown' },
        { inputPath: '/input/2.md', type: 'markdown' },
      ];

      fs.readFile.mockResolvedValue('content');
      mockPDFConverter.markdownToPDF
        .mockResolvedValueOnce('/output/1.pdf')
        .mockRejectedValueOnce(new Error('Failed'));

      const result = await handlers['pdf:batchConvert'](null, {
        files,
        outputDir: '/output',
      });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
    });
  });
});
