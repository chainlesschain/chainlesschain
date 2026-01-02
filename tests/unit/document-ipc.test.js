/**
 * Document IPC 单元测试
 * 测试1个文档导出API方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain } from 'electron';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('Document IPC', () => {
  let mockPPTExporter;
  let handlers = {};

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};

    mockPPTExporter = {
      export: vi.fn(),
    };

    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    const { registerDocumentIPC } = require('../../desktop-app-vue/src/main/document/document-ipc');
    registerDocumentIPC({ pptExporter: mockPPTExporter });
  });

  describe('PPT Export', () => {
    it('should export to PPT successfully', async () => {
      const params = {
        title: 'Test Presentation',
        slides: [
          { title: 'Slide 1', content: 'Content 1' },
          { title: 'Slide 2', content: 'Content 2' },
        ],
        outputPath: '/output/test.pptx',
      };

      mockPPTExporter.export.mockResolvedValue({
        success: true,
        filePath: params.outputPath,
      });

      const result = await handlers['ppt:export'](null, params);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(params.outputPath);
      expect(mockPPTExporter.export).toHaveBeenCalledWith(params);
    });

    it('should handle PPT export with custom template', async () => {
      const params = {
        title: 'Test',
        slides: [{ title: 'Slide 1' }],
        outputPath: '/output/test.pptx',
        template: 'modern',
        theme: 'dark',
      };

      mockPPTExporter.export.mockResolvedValue({
        success: true,
        filePath: params.outputPath,
      });

      const result = await handlers['ppt:export'](null, params);

      expect(result.success).toBe(true);
      expect(mockPPTExporter.export).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'modern',
          theme: 'dark',
        })
      );
    });

    it('should handle empty slides', async () => {
      const params = {
        title: 'Empty',
        slides: [],
        outputPath: '/output/empty.pptx',
      };

      mockPPTExporter.export.mockResolvedValue({
        success: true,
        filePath: params.outputPath,
      });

      const result = await handlers['ppt:export'](null, params);

      expect(result.success).toBe(true);
    });

    it('should handle export errors', async () => {
      mockPPTExporter.export.mockRejectedValue(new Error('Export failed'));

      const result = await handlers['ppt:export'](null, {
        title: 'Test',
        slides: [],
        outputPath: '/output/test.pptx',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Export failed');
    });

    it('should validate required parameters', async () => {
      const result = await handlers['ppt:export'](null, {
        // Missing title
        slides: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
