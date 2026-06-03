/**
 * Project Export IPC 单元测试
 * 测试 17 个项目导出分享 IPC 方法
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain, dialog } from 'electron';
import { createMockDatabase, createMockLLMManager, createMockMainWindow } from '../../utils/test-helpers.js';

// 必须在顶层 mock，在 import 之前
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}));

// Mock crypto module
vi.mock('crypto', () => ({
  default: {
    randomUUID: vi.fn(() => 'test-file-uuid-1234'),
  },
  randomUUID: vi.fn(() => 'test-file-uuid-1234'),
}));

describe('Project Export IPC', () => {
  let handlers = {};
  let mockDatabase;
  let mockLLMManager;
  let mockMainWindow;
  let mockGetDatabaseConnection;
  let mockSaveDatabase;
  let mockGetProjectConfig;
  let mockCopyDirectory;
  let mockConvertSlidesToOutline;
  let registerProjectExportIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock 依赖
    mockDatabase = createMockDatabase();
    mockLLMManager = createMockLLMManager();
    mockMainWindow = createMockMainWindow();

    mockGetDatabaseConnection = vi.fn(() => ({
      run: vi.fn(async () => {}),
      get: vi.fn(async () => ({})),
    }));

    mockSaveDatabase = vi.fn(async () => {});

    mockGetProjectConfig = vi.fn(() => ({
      resolveProjectPath: vi.fn((relativePath) => `/mock/projects/${relativePath}`),
      getProjectsRootPath: vi.fn(() => '/mock/projects'),
    }));

    mockCopyDirectory = vi.fn(async (source, target) => {});
    mockConvertSlidesToOutline = vi.fn(async (slides) => ({ outline: 'Mock outline' }));

    // Mock fs module
    vi.doMock('fs', () => ({
      default: {
        promises: {
          readFile: vi.fn(async (path) => 'Mock file content'),
          writeFile: vi.fn(async () => {}),
          mkdir: vi.fn(async () => {}),
          copyFile: vi.fn(async () => {}),
          rename: vi.fn(async () => {}),
          stat: vi.fn(async () => ({
            size: 1024,
            isDirectory: () => false,
            isFile: () => true,
          })),
          access: vi.fn(async () => {}),
        },
      },
      promises: {
        readFile: vi.fn(async (path) => {
          if (path.includes('.md')) {
            return '# Test Document\n\nThis is test content.';
          }
          return 'Mock file content';
        }),
        writeFile: vi.fn(async () => {}),
        mkdir: vi.fn(async () => {}),
        copyFile: vi.fn(async () => {}),
        rename: vi.fn(async () => {}),
        stat: vi.fn(async () => ({
          size: 1024,
          isDirectory: () => false,
          isFile: () => true,
        })),
        access: vi.fn(async () => {}),
      },
    }));

    // Mock path module
    vi.doMock('path', () => ({
      default: {
        basename: vi.fn((path) => path.split('/').pop()),
        dirname: vi.fn((path) => path.split('/').slice(0, -1).join('/')),
        extname: vi.fn((path) => {
          const parts = path.split('.');
          return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
        }),
        join: vi.fn((...args) => args.join('/')),
      },
      basename: vi.fn((path) => path.split('/').pop()),
      dirname: vi.fn((path) => path.split('/').slice(0, -1).join('/')),
      extname: vi.fn((path) => {
        const parts = path.split('.');
        return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
      }),
      join: vi.fn((...args) => args.join('/')),
    }));

    // Mock DocumentEngine
    vi.doMock('../../../desktop-app-vue/src/main/engines/document-engine', () => ({
      default: vi.fn().mockImplementation(() => ({
        exportTo: vi.fn(async (source, format, output) => ({
          success: true,
          path: output || `/mock/export/${format}-output.${format}`,
          format,
        })),
      })),
    }));

    // Mock PPTEngine
    vi.doMock('../../../desktop-app-vue/src/main/engines/ppt-engine', () => ({
      default: vi.fn().mockImplementation(() => ({
        generateFromMarkdown: vi.fn(async (content, options) => ({
          success: true,
          path: '/mock/output.pptx',
          fileName: 'output.pptx',
          slideCount: 5,
        })),
      })),
    }));

    // Mock ShareManager
    vi.doMock('../../../desktop-app-vue/src/main/project/share-manager', () => ({
      getShareManager: vi.fn(() => ({
        createOrUpdateShare: vi.fn(async (projectId, mode, options) => ({
          success: true,
          share: {
            id: 'share-1',
            project_id: projectId,
            share_mode: mode,
            share_link: `https://chainless.app/share/test-token-${projectId}`,
            share_token: `test-token-${projectId}`,
            expires_at: Date.now() + 86400000 * (options.expiresInDays || 7),
          },
        })),
        getShareByProjectId: vi.fn((projectId) => ({
          id: 'share-1',
          project_id: projectId,
          share_mode: 'public',
          share_link: `https://chainless.app/share/test-token-${projectId}`,
          share_token: `test-token-${projectId}`,
        })),
        getShareByToken: vi.fn((token) => {
          if (token === 'invalid-token') return null;
          if (token === 'expired-token') {
            return {
              id: 'share-1',
              share_token: token,
              is_expired: true,
              accessible: true,
            };
          }
          if (token === 'private-token') {
            return {
              id: 'share-1',
              share_token: token,
              is_expired: false,
              accessible: false,
            };
          }
          return {
            id: 'share-1',
            share_token: token,
            is_expired: false,
            accessible: true,
            project_id: 'project-1',
          };
        }),
        deleteShare: vi.fn(() => true),
        incrementAccessCount: vi.fn(),
      })),
    }));

    // 动态导入，确保 mock 已设置
    const module = await import('../../../desktop-app-vue/src/main/project/project-export-ipc.js');
    registerProjectExportIPC = module.registerProjectExportIPC;

    // 捕获 IPC handlers
    const { ipcMain } = await import('electron');
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 Project Export IPC
    registerProjectExportIPC({
      database: mockDatabase,
      llmManager: mockLLMManager,
      mainWindow: mockMainWindow,
      getDatabaseConnection: mockGetDatabaseConnection,
      saveDatabase: mockSaveDatabase,
      getProjectConfig: mockGetProjectConfig,
      copyDirectory: mockCopyDirectory,
      convertSlidesToOutline: mockConvertSlidesToOutline,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('文档导出相关', () => {
    it('should export document to PDF', async () => {
      const params = {
        projectId: 'project-1',
        sourcePath: '/data/projects/project-1/doc.md',
        format: 'pdf',
        outputPath: '/data/projects/project-1/output.pdf',
      };

      const result = await handlers['project:exportDocument'](null, params);

      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.fileName).toBeDefined();
      expect(mockGetProjectConfig).toHaveBeenCalled();
    });

    it('should export document to Word', async () => {
      const params = {
        projectId: 'project-1',
        sourcePath: '/data/projects/project-1/doc.md',
        format: 'docx',
      };

      const result = await handlers['project:exportDocument'](null, params);

      expect(result.success).toBe(true);
      expect(result.path).toContain('docx');
    });

    it('should generate PPT from markdown', async () => {
      const params = {
        projectId: 'project-1',
        sourcePath: '/data/projects/project-1/presentation.md',
      };

      const result = await handlers['project:generatePPT'](null, params);

      expect(result.success).toBe(true);
      expect(result.slideCount).toBe(5);
      expect(result.fileName).toBe('output.pptx');
      expect(result.path).toContain('.pptx');
    });

    it('should generate podcast script', async () => {
      mockLLMManager.query.mockResolvedValue({
        text: 'This is a podcast script...',
      });

      const params = {
        projectId: 'project-1',
        sourcePath: '/data/projects/project-1/article.md',
      };

      const result = await handlers['project:generatePodcastScript'](null, params);

      expect(result.success).toBe(true);
      expect(result.content).toContain('podcast script');
      expect(result.fileName).toContain('_podcast.txt');
      expect(mockLLMManager.query).toHaveBeenCalled();
    });

    it('should generate article images', async () => {
      mockLLMManager.query.mockResolvedValue({
        text: JSON.stringify([
          { title: 'Theme 1', description: 'Description 1' },
          { title: 'Theme 2', description: 'Description 2' },
        ]),
      });

      const params = {
        projectId: 'project-1',
        sourcePath: '/data/projects/project-1/article.md',
      };

      const result = await handlers['project:generateArticleImages'](null, params);

      expect(result.success).toBe(true);
      expect(result.themes).toHaveLength(2);
      expect(result.themes[0].title).toBe('Theme 1');
      expect(mockLLMManager.query).toHaveBeenCalled();
    });

    it('should handle invalid JSON in article images', async () => {
      mockLLMManager.query.mockResolvedValue({
        text: 'Invalid JSON response',
      });

      const params = {
        projectId: 'project-1',
        sourcePath: '/data/projects/project-1/article.md',
      };

      const result = await handlers['project:generateArticleImages'](null, params);

      expect(result.success).toBe(true);
      expect(result.themes).toHaveLength(1);
      expect(result.themes[0].title).toContain('文章插图');
    });
  });

  describe('分享功能相关', () => {
    it('should share project with public mode', async () => {
      const params = {
        projectId: 'project-1',
        shareMode: 'public',
        expiresInDays: 7,
        regenerateToken: false,
      };

      const result = await handlers['project:shareProject'](null, params);

      expect(result.success).toBe(true);
      expect(result.shareLink).toContain('test-token-project-1');
      expect(result.shareToken).toBe('test-token-project-1');
      expect(result.shareMode).toBe('public');
    });

    it('should share project with private mode', async () => {
      const params = {
        projectId: 'project-1',
        shareMode: 'private',
        expiresInDays: 1,
      };

      const result = await handlers['project:shareProject'](null, params);

      expect(result.success).toBe(true);
      expect(result.share).toBeDefined();
    });

    it('should get share information', async () => {
      const result = await handlers['project:getShare'](null, 'project-1');

      expect(result.success).toBe(true);
      expect(result.share).toBeDefined();
      expect(result.share.project_id).toBe('project-1');
    });

    it('should delete share', async () => {
      const result = await handlers['project:deleteShare'](null, 'project-1');

      expect(result.success).toBe(true);
    });

    it('should access share by token', async () => {
      const result = await handlers['project:accessShare'](null, 'valid-token');

      expect(result.success).toBe(true);
      expect(result.share).toBeDefined();
      expect(result.share.project_id).toBe('project-1');
    });

    it('should reject invalid token', async () => {
      await expect(
        handlers['project:accessShare'](null, 'invalid-token')
      ).rejects.toThrow('分享不存在');
    });

    it('should reject expired share', async () => {
      await expect(
        handlers['project:accessShare'](null, 'expired-token')
      ).rejects.toThrow('分享已过期');
    });

    it('should reject private share', async () => {
      await expect(
        handlers['project:accessShare'](null, 'private-token')
      ).rejects.toThrow('分享已设置为私密');
    });

    it('should handle WeChat share placeholder', async () => {
      const params = {
        projectId: 'project-1',
        shareLink: 'https://chainless.app/share/test',
      };

      const result = await handlers['project:shareToWechat'](null, params);

      expect(result.success).toBe(true);
      expect(result.message).toContain('开发中');
    });

    it('should handle share error when database not initialized', async () => {
      registerProjectExportIPC({
        database: null,
        llmManager: mockLLMManager,
        mainWindow: mockMainWindow,
        getDatabaseConnection: mockGetDatabaseConnection,
        saveDatabase: mockSaveDatabase,
        getProjectConfig: mockGetProjectConfig,
        copyDirectory: mockCopyDirectory,
        convertSlidesToOutline: mockConvertSlidesToOutline,
      });

      await expect(
        handlers['project:shareProject'](null, { projectId: 'p1', shareMode: 'public' })
      ).rejects.toThrow('数据库未初始化');
    });
  });

  describe('文件操作相关', () => {
    it('should copy file within project', async () => {
      const params = {
        sourcePath: '/data/projects/project-1/source.txt',
        targetPath: '/data/projects/project-1/target.txt',
      };

      const result = await handlers['project:copyFile'](null, params);

      expect(result.success).toBe(true);
      expect(result.fileName).toBe('target.txt');
      expect(result.path).toContain('target.txt');
    });

    it('should move file within project', async () => {
      const params = {
        projectId: 'project-1',
        fileId: 'file-1',
        sourcePath: '/data/projects/project-1/old-path.txt',
        targetPath: '/data/projects/project-1/new-path.txt',
      };

      const result = await handlers['project:move-file'](null, params);

      expect(result.success).toBe(true);
      expect(result.fileName).toBe('new-path.txt');
      expect(mockGetDatabaseConnection).toHaveBeenCalled();
      expect(mockSaveDatabase).toHaveBeenCalled();
    });

    it('should import file from external', async () => {
      const params = {
        projectId: 'project-1',
        externalPath: '/external/path/file.txt',
        targetPath: '/data/projects/project-1/imported.txt',
      };

      const result = await handlers['project:import-file'](null, params);

      expect(result.success).toBe(true);
      expect(result.fileId).toBe('test-file-uuid-1234');
      expect(result.fileName).toBe('imported.txt');
      expect(result.size).toBe(1024);
      expect(mockSaveDatabase).toHaveBeenCalled();
    });

    it('should export file to external', async () => {
      const params = {
        projectPath: '/data/projects/project-1/file.txt',
        targetPath: '/external/export/file.txt',
        isDirectory: false,
      };

      const result = await handlers['project:export-file'](null, params);

      expect(result.success).toBe(true);
      expect(result.path).toBe('/external/export/file.txt');
    });

    it('should export directory to external', async () => {
      const fs = await import('fs');
      fs.promises.stat.mockResolvedValue({
        size: 0,
        isDirectory: () => true,
        isFile: () => false,
      });

      const params = {
        projectPath: '/data/projects/project-1/folder',
        targetPath: '/external/export/folder',
        isDirectory: true,
      };

      const result = await handlers['project:export-file'](null, params);

      expect(result.success).toBe(true);
      expect(result.isDirectory).toBe(true);
      expect(mockCopyDirectory).toHaveBeenCalled();
    });

    it('should handle export file error', async () => {
      const fs = await import('fs');
      fs.promises.access.mockRejectedValue(new Error('File not found'));

      const params = {
        projectPath: '/data/projects/project-1/non-existent.txt',
        targetPath: '/external/export/file.txt',
      };

      const result = await handlers['project:export-file'](null, params);

      expect(result.success).toBe(false);
      expect(result.error).toContain('源文件不存在');
    });

    it('should batch export files', async () => {
      const params = {
        files: [
          { path: '/data/projects/project-1/file1.txt', name: 'file1.txt' },
          { path: '/data/projects/project-1/file2.txt', name: 'file2.txt' },
        ],
        targetDirectory: '/external/export',
      };

      const result = await handlers['project:export-files'](null, params);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.successCount).toBe(2);
      expect(result.totalCount).toBe(2);
    });

    it('should handle partial failure in batch export', async () => {
      const fs = await import('fs');
      let callCount = 0;
      fs.promises.stat.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('File not found');
        }
        return {
          size: 1024,
          isDirectory: () => false,
          isFile: () => true,
        };
      });

      const params = {
        files: [
          { path: '/data/projects/project-1/file1.txt', name: 'file1.txt' },
          { path: '/data/projects/project-1/file2.txt', name: 'file2.txt' },
        ],
        targetDirectory: '/external/export',
      };

      const result = await handlers['project:export-files'](null, params);

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(1);
      expect(result.totalCount).toBe(2);
    });

    it('should select export directory', async () => {
      const { dialog } = await import('electron');
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/selected/export/directory'],
      });

      const result = await handlers['project:select-export-directory'](null);

      expect(result.success).toBe(true);
      expect(result.path).toBe('/selected/export/directory');
      expect(dialog.showOpenDialog).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({
          properties: ['openDirectory', 'createDirectory'],
        })
      );
    });

    it('should handle canceled export directory selection', async () => {
      const { dialog } = await import('electron');
      dialog.showOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      const result = await handlers['project:select-export-directory'](null);

      expect(result.success).toBe(false);
      expect(result.canceled).toBe(true);
    });

    it('should select import files', async () => {
      const { dialog } = await import('electron');
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/file1.txt', '/file2.txt'],
      });

      const result = await handlers['project:select-import-files'](null, {});

      expect(result.success).toBe(true);
      expect(result.filePaths).toHaveLength(2);
      expect(result.filePaths[0]).toBe('/file1.txt');
    });

    it('should select import files with directory option', async () => {
      const { dialog } = await import('electron');
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/folder'],
      });

      const result = await handlers['project:select-import-files'](null, {
        allowDirectory: true,
      });

      expect(result.success).toBe(true);
      expect(dialog.showOpenDialog).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({
          properties: ['openFile', 'multiSelections', 'openDirectory'],
        })
      );
    });

    it('should select import files with filters', async () => {
      const { dialog } = await import('electron');
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/file.md'],
      });

      const filters = [
        { name: 'Markdown', extensions: ['md'] },
      ];

      const result = await handlers['project:select-import-files'](null, {
        filters,
      });

      expect(result.success).toBe(true);
      expect(dialog.showOpenDialog).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({ filters })
      );
    });

    it('should batch import files', async () => {
      const params = {
        projectId: 'project-1',
        externalPaths: ['/external/file1.txt', '/external/file2.txt'],
        targetDirectory: '/data/projects/project-1/imported',
      };

      const result = await handlers['project:import-files'](null, params);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.successCount).toBe(2);
      expect(result.totalCount).toBe(2);
      expect(mockSaveDatabase).toHaveBeenCalled();
    });

    it('should handle binary files in batch import', async () => {
      const fs = await import('fs');
      let callCount = 0;
      fs.promises.readFile.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Cannot read binary file');
        }
        return 'File content';
      });

      const params = {
        projectId: 'project-1',
        externalPaths: ['/external/file1.txt', '/external/binary.bin'],
        targetDirectory: '/data/projects/project-1/imported',
      };

      const result = await handlers['project:import-files'](null, params);

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(2); // 仍然应该导入成功，只是没有内容
    });
  });

  describe('错误处理', () => {
    it('should handle document export error', async () => {
      const DocumentEngine = await import('../../../desktop-app-vue/src/main/engines/document-engine');
      DocumentEngine.default.mockImplementationOnce(() => ({
        exportTo: vi.fn(async () => {
          throw new Error('Export failed');
        }),
      }));

      const module = await import('../../../desktop-app-vue/src/main/project/project-export-ipc.js');
      const newRegister = module.registerProjectExportIPC;

      const newHandlers = {};
      const { ipcMain } = await import('electron');
      ipcMain.handle.mockImplementation((channel, handler) => {
        newHandlers[channel] = handler;
      });

      newRegister({
        database: mockDatabase,
        llmManager: mockLLMManager,
        mainWindow: mockMainWindow,
        getDatabaseConnection: mockGetDatabaseConnection,
        saveDatabase: mockSaveDatabase,
        getProjectConfig: mockGetProjectConfig,
        copyDirectory: mockCopyDirectory,
        convertSlidesToOutline: mockConvertSlidesToOutline,
      });

      await expect(
        newHandlers['project:exportDocument'](null, {
          projectId: 'p1',
          sourcePath: '/test.md',
          format: 'pdf',
        })
      ).rejects.toThrow('Export failed');
    });

    it('should handle PPT generation error', async () => {
      mockLLMManager.query.mockRejectedValue(new Error('LLM error'));

      await expect(
        handlers['project:generatePodcastScript'](null, {
          projectId: 'p1',
          sourcePath: '/test.md',
        })
      ).rejects.toThrow('LLM error');
    });

    it('should handle file copy error', async () => {
      const fs = await import('fs');
      fs.promises.copyFile.mockRejectedValue(new Error('Permission denied'));

      await expect(
        handlers['project:copyFile'](null, {
          sourcePath: '/source.txt',
          targetPath: '/target.txt',
        })
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('边界情况', () => {
    it('should handle empty file list in batch export', async () => {
      const params = {
        files: [],
        targetDirectory: '/external/export',
      };

      const result = await handlers['project:export-files'](null, params);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
      expect(result.successCount).toBe(0);
    });

    it('should handle empty path list in batch import', async () => {
      const params = {
        projectId: 'project-1',
        externalPaths: [],
        targetDirectory: '/data/projects/project-1/imported',
      };

      const result = await handlers['project:import-files'](null, params);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
      expect(result.successCount).toBe(0);
    });

    it('should handle large markdown file', async () => {
      const fs = await import('fs');
      const largeContent = 'a'.repeat(100000);
      fs.promises.readFile.mockResolvedValue(largeContent);

      const params = {
        projectId: 'project-1',
        sourcePath: '/large.md',
      };

      const result = await handlers['project:generatePPT'](null, params);

      expect(result.success).toBe(true);
    });
  });

  describe('性能测试', () => {
    it('should handle concurrent export operations', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        handlers['project:exportDocument'](null, {
          projectId: 'project-1',
          sourcePath: `/doc${i}.md`,
          format: 'pdf',
        })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should handle large batch export', async () => {
      const files = Array.from({ length: 100 }, (_, i) => ({
        path: `/data/projects/project-1/file${i}.txt`,
        name: `file${i}.txt`,
      }));

      const params = {
        files,
        targetDirectory: '/external/export',
      };

      const result = await handlers['project:export-files'](null, params);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(100);
      expect(result.successCount).toBe(100);
    });
  });
});
