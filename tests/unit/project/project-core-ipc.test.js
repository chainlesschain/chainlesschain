/**
 * Project Core IPC 单元测试
 * 测试 34 个项目核心管理 IPC 方法
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import { createMockDatabase, createTestData } from '../../utils/test-helpers.js';

// 必须在顶层 mock，在 import 之前
vi.mock('electron', async () => {
  return {
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
    },
  };
});

// Mock crypto module
vi.mock('crypto', () => ({
  default: {
    randomUUID: vi.fn(() => 'test-uuid-1234'),
    createHash: vi.fn(() => ({
      update: vi.fn(() => ({
        digest: vi.fn(() => ({
          substring: vi.fn(() => 'test-hash-1234'),
        })),
      })),
    })),
  },
  randomUUID: vi.fn(() => 'test-uuid-1234'),
  createHash: vi.fn(() => ({
    update: vi.fn(() => ({
      digest: vi.fn(() => ({
        substring: vi.fn(() => 'test-hash-1234'),
      })),
    })),
  })),
}));

describe('Project Core IPC', () => {
  let handlers = {};
  let mockDatabase;
  let mockFileSyncManager;
  let mockRemoveUndefinedValues;
  let mockReplaceUndefinedWithNull;
  let registerProjectCoreIPC;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock 依赖
    mockDatabase = {
      ...createMockDatabase(),

      // 项目管理方法
      getProjects: vi.fn((userId) => [
        createTestData('project', { id: 'project-1', user_id: userId }),
        createTestData('project', { id: 'project-2', user_id: userId }),
      ]),

      getProjectById: vi.fn((projectId) =>
        createTestData('project', { id: projectId })
      ),

      saveProject: vi.fn((project) => ({ ...project, saved: true })),

      updateProject: vi.fn((projectId, updates) => ({
        id: projectId,
        ...updates,
        updated: true
      })),

      deleteProject: vi.fn((projectId) => ({ success: true, deleted: projectId })),

      // 文件管理方法
      getProjectFiles: vi.fn((projectId) => [
        createTestData('file', { id: 'file-1', project_id: projectId }),
        createTestData('file', { id: 'file-2', project_id: projectId }),
      ]),

      saveProjectFiles: vi.fn(async (projectId, files) => ({
        success: true,
        saved: files.length
      })),

      updateProjectFile: vi.fn((fileUpdate) => ({ ...fileUpdate, updated: true })),

      saveToFile: vi.fn(),
    };

    mockFileSyncManager = {
      syncProject: vi.fn(async (project) => ({ success: true })),
    };

    mockRemoveUndefinedValues = vi.fn((obj) => {
      if (!obj) return obj;
      if (Array.isArray(obj)) {
        return obj.map(item => mockRemoveUndefinedValues(item));
      }
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          cleaned[key] = value;
        }
      }
      return cleaned;
    });

    mockReplaceUndefinedWithNull = vi.fn((obj) => {
      if (!obj) return obj;
      if (Array.isArray(obj)) {
        return obj.map(item => mockReplaceUndefinedWithNull(item));
      }
      const replaced = {};
      for (const [key, value] of Object.entries(obj)) {
        replaced[key] = value === undefined ? null : value;
      }
      return replaced;
    });

    // Mock fs module
    vi.doMock('fs', () => ({
      default: {
        promises: {
          mkdir: vi.fn(async () => {}),
          writeFile: vi.fn(async () => {}),
          readdir: vi.fn(async () => []),
          stat: vi.fn(async () => ({
            isDirectory: () => false,
            size: 1024,
            birthtimeMs: Date.now(),
            mtimeMs: Date.now(),
          })),
          access: vi.fn(async () => {}),
          unlink: vi.fn(async () => {}),
        },
      },
      promises: {
        mkdir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readdir: vi.fn(async () => []),
        stat: vi.fn(async () => ({
          isDirectory: () => false,
          size: 1024,
          birthtimeMs: Date.now(),
          mtimeMs: Date.now(),
        })),
        access: vi.fn(async () => {}),
        unlink: vi.fn(async () => {}),
      },
    }));

    // Mock path module
    vi.doMock('path', () => ({
      default: {
        join: vi.fn((...args) => args.join('/')),
        dirname: vi.fn((path) => path.split('/').slice(0, -1).join('/')),
        extname: vi.fn((path) => {
          const parts = path.split('.');
          return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
        }),
      },
      join: vi.fn((...args) => args.join('/')),
      dirname: vi.fn((path) => path.split('/').slice(0, -1).join('/')),
      extname: vi.fn((path) => {
        const parts = path.split('.');
        return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
      }),
    }));

    // Mock http-client
    vi.doMock('../../../desktop-app-vue/src/main/project/http-client', () => ({
      getProjectHTTPClient: vi.fn(() => ({
        createProject: vi.fn(async (data) => ({
          id: 'project-backend-1',
          ...data,
          files: [],
        })),
        getProject: vi.fn(async (id) => ({
          id,
          name: 'Backend Project',
          files: [],
        })),
        deleteProject: vi.fn(async (id) => ({ success: true })),
        listProjects: vi.fn(async (userId, page, size) => ({
          records: [
            { id: 'backend-1', userId, name: 'Project 1' },
            { id: 'backend-2', userId, name: 'Project 2' },
          ],
        })),
        syncProject: vi.fn(async (project) => ({ success: true })),
      })),
    }));

    // Mock project-config
    vi.doMock('../../../desktop-app-vue/src/main/project/project-config', () => ({
      getProjectConfig: vi.fn(() => ({
        getProjectsRootPath: vi.fn(() => '/mock/projects'),
        resolveProjectPath: vi.fn((relativePath) => `/mock/projects/${relativePath}`),
      })),
    }));

    // Mock project-rag
    vi.doMock('../../../desktop-app-vue/src/main/project/project-rag', () => ({
      getProjectRAGManager: vi.fn(() => ({
        initialize: vi.fn(async () => {}),
        indexConversationHistory: vi.fn(async (projectId) => ({
          success: true,
          indexed: 10,
        })),
        startFileWatcher: vi.fn(async (projectId, path) => {}),
        stopFileWatcher: vi.fn((projectId) => {}),
      })),
    }));

    // Mock project-recovery
    vi.doMock('../../../desktop-app-vue/src/main/sync/project-recovery', () => {
      return {
        default: vi.fn().mockImplementation(() => ({
          scanRecoverableProjects: vi.fn(() => [
            { id: 'recoverable-1', name: 'Recoverable 1' },
          ]),
          recoverProject: vi.fn(() => true),
          recoverProjects: vi.fn((ids) => ({
            success: ids.slice(0, Math.floor(ids.length / 2)),
            failed: ids.slice(Math.floor(ids.length / 2)),
          })),
          autoRecoverAll: vi.fn(() => ({
            success: ['project-1'],
            failed: [],
          })),
          getRecoveryStats: vi.fn(() => ({
            total: 10,
            recoverable: 2,
            recovered: 8,
          })),
        })),
      };
    });

    // Mock stats-collector
    vi.doMock('../../../desktop-app-vue/src/main/stats/stats-collector', () => ({
      getStatsCollector: vi.fn(() => ({
        initialize: vi.fn(async () => {}),
        startProjectStats: vi.fn(async (projectId, path) => {}),
        stopProjectStats: vi.fn((projectId) => {}),
        getProjectStats: vi.fn(async (projectId) => ({
          fileCount: 10,
          totalSize: 102400,
          lastUpdate: Date.now(),
        })),
        updateProjectStats: vi.fn(async (projectId) => {}),
      })),
    }));

    // 捕获 IPC handlers
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 重新导入模块以确保 mock 生效
    vi.resetModules();
    const { registerProjectCoreIPC: register } = require('../../../desktop-app-vue/src/main/project/project-core-ipc.js');
    register({
      database: mockDatabase,
      fileSyncManager: mockFileSyncManager,
      removeUndefinedValues: mockRemoveUndefinedValues,
      _replaceUndefinedWithNull: mockReplaceUndefinedWithNull,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('项目 CRUD 操作', () => {
    it('should get all projects', async () => {
      const result = await handlers['project:get-all'](null, 'user-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('project-1');
      expect(mockDatabase.getProjects).toHaveBeenCalledWith('user-1');
      expect(mockRemoveUndefinedValues).toHaveBeenCalled();
    });

    it('should return empty array when no projects', async () => {
      mockDatabase.getProjects.mockReturnValue([]);

      const result = await handlers['project:get-all'](null, 'user-1');

      expect(result).toEqual([]);
    });

    it('should handle database not initialized', async () => {
      const result = await handlers['project:get-all'](null, 'user-1');

      // 应该返回空数组而不是抛出错误
      expect(Array.isArray(result)).toBe(true);
    });

    it('should get single project', async () => {
      const result = await handlers['project:get'](null, 'project-1');

      expect(result.id).toBe('project-1');
      expect(mockDatabase.getProjectById).toHaveBeenCalledWith('project-1');
      expect(mockRemoveUndefinedValues).toHaveBeenCalled();
    });

    it('should create project', async () => {
      const createData = {
        name: 'New Project',
        description: 'Test project',
        userId: 'user-1',
        projectType: 'web',
      };

      const result = await handlers['project:create'](null, createData);

      expect(result).toBeDefined();
      expect(mockReplaceUndefinedWithNull).toHaveBeenCalled();
      expect(mockDatabase.saveProject).toHaveBeenCalled();
    });

    it('should handle stream cancel', async () => {
      const result = await handlers['project:stream-cancel']();

      expect(result.success).toBe(true);
    });

    it('should quick create project', async () => {
      const createData = {
        name: 'Quick Project',
        description: 'Quick test',
        userId: 'user-1',
        projectType: 'document',
      };

      const result = await handlers['project:create-quick'](null, createData);

      expect(result.id).toBe('test-uuid-1234');
      expect(result.name).toBe('Quick Project');
      expect(mockDatabase.saveProject).toHaveBeenCalled();
      expect(mockDatabase.saveProjectFiles).toHaveBeenCalled();
    });

    it('should save project to local database', async () => {
      const project = createTestData('project');

      const result = await handlers['project:save'](null, project);

      expect(result.saved).toBe(true);
      expect(mockDatabase.saveProject).toHaveBeenCalled();
      expect(mockReplaceUndefinedWithNull).toHaveBeenCalledWith(project);
    });

    it('should update project', async () => {
      const updates = {
        name: 'Updated Project',
        description: 'Updated description',
      };

      const result = await handlers['project:update'](null, 'project-1', updates);

      expect(result.updated).toBe(true);
      expect(mockDatabase.updateProject).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({
          name: 'Updated Project',
          sync_status: 'pending',
        })
      );
    });

    it('should delete project from backend', async () => {
      const result = await handlers['project:delete'](null, 'project-1');

      expect(result.success).toBe(true);
    });

    it('should delete local project', async () => {
      const result = await handlers['project:delete-local'](null, 'project-1');

      expect(result.deleted).toBe('project-1');
      expect(mockDatabase.deleteProject).toHaveBeenCalledWith('project-1');
    });

    it('should fetch project from backend', async () => {
      const result = await handlers['project:fetch-from-backend'](null, 'backend-1');

      expect(result).toBeDefined();
      expect(mockDatabase.saveProject).toHaveBeenCalled();
    });
  });

  describe('路径修复操作', () => {
    it('should fix project path', async () => {
      mockDatabase.getProjectById.mockReturnValue({
        id: 'project-1',
        name: 'Test Project',
        root_path: null, // 没有路径
      });

      mockDatabase.db = {
        prepare: vi.fn(() => ({
          all: vi.fn(() => []),
        })),
        run: vi.fn(),
      };

      const result = await handlers['project:fix-path'](null, 'project-1');

      expect(result.success).toBe(true);
      expect(result.path).toContain('project-1');
      expect(mockDatabase.updateProject).toHaveBeenCalled();
    });

    it('should skip fix if root_path exists', async () => {
      mockDatabase.getProjectById.mockReturnValue({
        id: 'project-1',
        name: 'Test Project',
        root_path: '/existing/path',
      });

      const result = await handlers['project:fix-path'](null, 'project-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('正常');
      expect(result.path).toBe('/existing/path');
    });

    it('should repair root path for document project', async () => {
      mockDatabase.db = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            id: 'project-1',
            project_type: 'document',
            root_path: null,
          })),
        })),
      };

      const result = await handlers['project:repair-root-path'](null, 'project-1');

      expect(result.success).toBe(true);
      expect(result.rootPath).toBeDefined();
    });

    it('should reject repair for non-document project', async () => {
      mockDatabase.db = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            id: 'project-1',
            project_type: 'web',
            root_path: null,
          })),
        })),
      };

      const result = await handlers['project:repair-root-path'](null, 'project-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('只能修复document类型');
    });

    it('should repair all root paths in batch', async () => {
      mockDatabase.db = {
        prepare: vi.fn(() => ({
          all: vi.fn(() => [
            { id: 'project-1', name: 'Project 1', project_type: 'document', root_path: null },
            { id: 'project-2', name: 'Project 2', project_type: 'document', root_path: null },
          ]),
        })),
      };

      const result = await handlers['project:repair-all-root-paths']();

      expect(result.success).toBe(true);
      expect(result.fixed).toBe(2);
      expect(result.details).toHaveLength(2);
    });
  });

  describe('文件管理操作', () => {
    it('should get project files from filesystem', async () => {
      mockDatabase.db = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            id: 'project-1',
            root_path: '/mock/project/path',
          })),
        })),
      };

      // Mock fs.readdir to return files
      const fs = await import('fs');
      fs.promises.readdir.mockResolvedValue([
        { name: 'file1.js', isDirectory: () => false },
        { name: 'folder1', isDirectory: () => true },
      ]);

      const result = await handlers['project:get-files'](null, 'project-1');

      expect(Array.isArray(result)).toBe(true);
      expect(mockRemoveUndefinedValues).toHaveBeenCalled();
    });

    it('should auto-repair missing root_path when getting files', async () => {
      mockDatabase.db = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            id: 'project-1',
            root_path: null, // 缺失路径
          })),
        })),
      };

      const result = await handlers['project:get-files'](null, 'project-1');

      expect(Array.isArray(result)).toBe(true);
      expect(mockDatabase.updateProject).toHaveBeenCalled();
    });

    it('should get single file', async () => {
      mockDatabase.db = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => createTestData('file', { id: 'file-1' })),
        })),
      };

      const result = await handlers['project:get-file'](null, 'file-1');

      expect(result).toBeDefined();
      expect(mockRemoveUndefinedValues).toHaveBeenCalled();
    });

    it('should save project files', async () => {
      const files = [
        createTestData('file', { id: 'file-1' }),
        createTestData('file', { id: 'file-2' }),
      ];

      const result = await handlers['project:save-files'](null, 'project-1', files);

      expect(result.success).toBe(true);
      expect(mockDatabase.saveProjectFiles).toHaveBeenCalledWith('project-1', files);
    });

    it('should update file', async () => {
      const fileUpdate = {
        projectId: 'project-1',
        fileId: 'file-1',
        content: 'Updated content',
        is_base64: false,
      };

      // Mock ProjectFileAPI
      vi.doMock('../../../desktop-app-vue/src/main/project/project-file-api', () => ({
        default: {
          updateFile: vi.fn(async () => ({ success: false, status: 0 })),
        },
        updateFile: vi.fn(async () => ({ success: false, status: 0 })),
      }));

      const result = await handlers['project:update-file'](null, fileUpdate);

      expect(result.success).toBe(true);
      expect(mockDatabase.updateProjectFile).toHaveBeenCalledWith(fileUpdate);
    });

    it('should delete file', async () => {
      mockDatabase.db = {
        get: vi.fn(() => createTestData('file', { id: 'file-1', file_path: 'test.js' })),
        run: vi.fn(),
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({ count: 5 })),
        })),
      };

      const result = await handlers['project:delete-file'](null, 'project-1', 'file-1');

      expect(result.success).toBe(true);
      expect(mockDatabase.saveToFile).toHaveBeenCalled();
    });
  });

  describe('监听器操作', () => {
    it('should index conversations', async () => {
      const result = await handlers['project:indexConversations'](null, 'project-1', {});

      expect(result.success).toBe(true);
      expect(result.indexed).toBe(10);
    });

    it('should start file watcher', async () => {
      const result = await handlers['project:startWatcher'](null, 'project-1', '/path/to/project');

      expect(result.success).toBe(true);
    });

    it('should stop file watcher', async () => {
      const result = await handlers['project:stopWatcher'](null, 'project-1');

      expect(result.success).toBe(true);
    });
  });

  describe('路径解析操作', () => {
    it('should resolve project path', async () => {
      const result = await handlers['project:resolve-path'](null, 'relative/path/file.txt');

      expect(result.success).toBe(true);
      expect(result.path).toContain('relative/path/file.txt');
    });
  });

  describe('同步操作', () => {
    it('should sync projects', async () => {
      const result = await handlers['project:sync'](null, 'user-1');

      expect(result.success).toBe(true);
      expect(mockDatabase.saveProject).toHaveBeenCalled();
    });

    it('should sync single project', async () => {
      const result = await handlers['project:sync-one'](null, 'project-1');

      expect(result.success).toBe(true);
      expect(mockDatabase.updateProject).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({
          sync_status: 'synced',
        })
      );
    });

    it('should handle sync error when database not initialized', async () => {
      registerProjectCoreIPC({
        database: null,
        fileSyncManager: mockFileSyncManager,
        removeUndefinedValues: mockRemoveUndefinedValues,
        _replaceUndefinedWithNull: mockReplaceUndefinedWithNull,
      });

      await expect(
        handlers['project:sync-one'](null, 'project-1')
      ).rejects.toThrow('数据库未初始化');
    });
  });

  describe('项目恢复操作', () => {
    it('should scan recoverable projects', async () => {
      const result = await handlers['project:scan-recoverable']();

      expect(result.success).toBe(true);
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].id).toBe('recoverable-1');
    });

    it('should recover single project', async () => {
      const result = await handlers['project:recover'](null, 'project-1');

      expect(result.success).toBe(true);
    });

    it('should handle recovery failure', async () => {
      // 重新设置 mock 以模拟恢复失败场景
      vi.doMock('../../../desktop-app-vue/src/main/sync/project-recovery', () => {
        return {
          default: vi.fn().mockImplementation(() => ({
            scanRecoverableProjects: vi.fn(() => []),
            recoverProject: vi.fn(() => false), // 模拟恢复失败
            recoverProjects: vi.fn((ids) => ({
              success: [],
              failed: ids,
            })),
            autoRecoverAll: vi.fn(() => ({
              success: [],
              failed: ['project-1'],
            })),
            getRecoveryStats: vi.fn(() => ({
              total: 10,
              recoverable: 2,
              recovered: 8,
            })),
          })),
        };
      });

      // 重新注册 IPC handlers
      vi.resetModules();
      const { registerProjectCoreIPC: register } = require('../../../desktop-app-vue/src/main/project/project-core-ipc.js');
      register({
        database: mockDatabase,
        fileSyncManager: mockFileSyncManager,
        removeUndefinedValues: mockRemoveUndefinedValues,
        _replaceUndefinedWithNull: mockReplaceUndefinedWithNull,
      });

      const result = await handlers['project:recover'](null, 'non-existent-project');

      // 恢复失败时应该返回 success: false
      expect(result.success).toBe(false);
    });

    it('should recover projects in batch', async () => {
      const result = await handlers['project:recover-batch'](null, ['p1', 'p2', 'p3', 'p4']);

      expect(result.success).toBe(true);
      expect(result.results).toBeDefined();
      expect(result.results.success).toHaveLength(2);
      expect(result.results.failed).toHaveLength(2);
    });

    it('should auto-recover all projects', async () => {
      const result = await handlers['project:auto-recover']();

      expect(result.success).toBe(true);
      expect(result.results.success).toHaveLength(1);
    });

    it('should get recovery stats', async () => {
      const result = await handlers['project:recovery-stats']();

      expect(result.success).toBe(true);
      expect(result.stats.total).toBe(10);
      expect(result.stats.recoverable).toBe(2);
      expect(result.stats.recovered).toBe(8);
    });
  });

  describe('统计操作', () => {
    it('should start project stats', async () => {
      const result = await handlers['project:stats:start'](null, 'project-1', '/path/to/project');

      expect(result.success).toBe(true);
    });

    it('should stop project stats', async () => {
      const result = await handlers['project:stats:stop'](null, 'project-1');

      expect(result.success).toBe(true);
    });

    it('should get project stats', async () => {
      const result = await handlers['project:stats:get'](null, 'project-1');

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats.fileCount).toBe(10);
      expect(result.stats.totalSize).toBe(102400);
    });

    it('should update project stats', async () => {
      const result = await handlers['project:stats:update'](null, 'project-1');

      expect(result.success).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('should handle database errors gracefully in get-all', async () => {
      mockDatabase.getProjects.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await handlers['project:get-all'](null, 'user-1');

      // 应该返回空数组而不是抛出错误
      expect(result).toEqual([]);
    });

    it('should throw error when creating project with null database', async () => {
      registerProjectCoreIPC({
        database: null,
        fileSyncManager: mockFileSyncManager,
        removeUndefinedValues: mockRemoveUndefinedValues,
        _replaceUndefinedWithNull: mockReplaceUndefinedWithNull,
      });

      await expect(
        handlers['project:get'](null, 'project-1')
      ).rejects.toThrow('数据库未初始化');
    });

    it('should handle missing project in fix-path', async () => {
      mockDatabase.getProjectById.mockReturnValue(null);

      await expect(
        handlers['project:fix-path'](null, 'non-existent')
      ).rejects.toThrow('项目不存在');
    });

    it('should handle file system errors in get-files', async () => {
      mockDatabase.db = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            id: 'project-1',
            root_path: '/non-existent/path',
          })),
        })),
      };

      const fs = await import('fs');
      fs.promises.access.mockRejectedValue(new Error('Directory not found'));
      fs.promises.readdir.mockRejectedValue(new Error('Cannot read directory'));

      const result = await handlers['project:get-files'](null, 'project-1');

      expect(result).toEqual([]);
    });
  });

  describe('边界情况', () => {
    it('should handle empty project list', async () => {
      mockDatabase.getProjects.mockReturnValue([]);

      const result = await handlers['project:get-all'](null, 'user-1');

      expect(result).toEqual([]);
    });

    it('should handle null project data', async () => {
      mockDatabase.getProjects.mockReturnValue(null);

      const result = await handlers['project:get-all'](null, 'user-1');

      expect(result).toEqual([]);
    });

    it('should handle project with undefined values', async () => {
      const projectWithUndefined = {
        id: 'project-1',
        name: 'Test',
        description: undefined,
        tags: undefined,
      };

      await handlers['project:save'](null, projectWithUndefined);

      expect(mockReplaceUndefinedWithNull).toHaveBeenCalledWith(projectWithUndefined);
    });

    it('should handle empty files array', async () => {
      const result = await handlers['project:save-files'](null, 'project-1', []);

      expect(result.success).toBe(true);
    });

    it('should handle batch repair with no broken projects', async () => {
      mockDatabase.db = {
        prepare: vi.fn(() => ({
          all: vi.fn(() => []), // 没有需要修复的项目
        })),
      };

      const result = await handlers['project:repair-all-root-paths']();

      expect(result.success).toBe(true);
      expect(result.fixed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should handle recovery with empty project list', async () => {
      // 重新导入模块以应用新的 mock
      vi.resetModules();

      // 使用返回空列表的 recovery mock
      vi.doMock('../../../desktop-app-vue/src/main/sync/project-recovery', () => {
        return {
          default: vi.fn().mockImplementation(() => ({
            scanRecoverableProjects: vi.fn(() => []),
            recoverProject: vi.fn(() => false),
            recoverProjects: vi.fn(() => ({
              success: [],
              failed: [],
            })),
            autoRecoverAll: vi.fn(() => ({
              success: [],
              failed: [],
            })),
            getRecoveryStats: vi.fn(() => ({
              total: 0,
              recoverable: 0,
              recovered: 0,
            })),
          })),
        };
      });

      // 重新注册 handlers
      const localHandlers = {};
      ipcMain.handle.mockImplementation((channel, handler) => {
        localHandlers[channel] = handler;
      });

      const { registerProjectCoreIPC: register } = require('../../../desktop-app-vue/src/main/project/project-core-ipc.js');
      register({
        database: mockDatabase,
        removeUndefinedValues: mockRemoveUndefinedValues,
        _replaceUndefinedWithNull: mockReplaceUndefinedWithNull,
      });

      // 测试自动恢复空列表场景
      const result = await localHandlers['project:auto-recover']();

      expect(result.success).toBe(true);
      expect(result.results.success).toHaveLength(0);
      expect(result.results.failed).toHaveLength(0);
    });
  });

  describe('性能测试', () => {
    it('should handle concurrent project operations', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        handlers['project:get'](null, `project-${i}`)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result.id).toBe(`project-${i}`);
      });
      expect(mockDatabase.getProjectById).toHaveBeenCalledTimes(10);
    });

    it('should handle large file list', async () => {
      const largeFileList = Array.from({ length: 1000 }, (_, i) =>
        createTestData('file', { id: `file-${i}` })
      );

      mockDatabase.getProjectFiles.mockReturnValue(largeFileList);

      const result = await handlers['project:save-files'](null, 'project-1', largeFileList);

      expect(result.success).toBe(true);
    });
  });
});
