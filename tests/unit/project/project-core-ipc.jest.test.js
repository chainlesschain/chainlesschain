/**
 * Project Core IPC 单元测试 (Jest 版本)
 * 测试项目核心管理 IPC 方法
 */

const { ipcMain } = require('electron');

// 创建简单的 mock 辅助函数
const createMockDatabase = () => ({
  getProjects: jest.fn(() => [
    { id: 'project-1', name: 'Project 1', user_id: 'user-1' },
    { id: 'project-2', name: 'Project 2', user_id: 'user-1' },
  ]),
  getProjectById: jest.fn((id) => ({ id, name: 'Test Project' })),
  saveProject: jest.fn((project) => ({ ...project, saved: true })),
  updateProject: jest.fn((id, updates) => ({ id, ...updates })),
  deleteProject: jest.fn((id) => ({ success: true, deleted: id })),
  getProjectFiles: jest.fn(() => []),
  saveProjectFiles: jest.fn(() => ({ success: true })),
  saveToFile: jest.fn(),
  db: {
    prepare: jest.fn(() => ({
      get: jest.fn(() => ({ id: 'project-1', root_path: '/mock/path' })),
      all: jest.fn(() => []),
    })),
  },
});

const createMockFileSyncManager = () => ({
  syncProject: jest.fn(async () => ({ success: true })),
});

describe('Project Core IPC (Jest)', () => {
  let handlers = {};
  let mockDatabase;
  let mockFileSyncManager;
  let mockRemoveUndefinedValues;
  let mockReplaceUndefinedWithNull;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = {};

    // 创建 mock 依赖
    mockDatabase = createMockDatabase();
    mockFileSyncManager = createMockFileSyncManager();
    mockRemoveUndefinedValues = jest.fn((obj) => obj);
    mockReplaceUndefinedWithNull = jest.fn((obj) => obj);

    // 捕获 IPC handlers
    ipcMain.handle.mockClear();
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
      return handler;
    });

    // 删除缓存并重新导入模块
    delete require.cache[require.resolve('../../../desktop-app-vue/src/main/project/project-core-ipc')];
    const { registerProjectCoreIPC } = require('../../../desktop-app-vue/src/main/project/project-core-ipc');

    // 注册 Project Core IPC
    registerProjectCoreIPC({
      database: mockDatabase,
      fileSyncManager: mockFileSyncManager,
      removeUndefinedValues: mockRemoveUndefinedValues,
      _replaceUndefinedWithNull: mockReplaceUndefinedWithNull,
    });
  });

  describe('项目 CRUD 操作', () => {
    test('should get all projects', async () => {
      const result = await handlers['project:get-all'](null, 'user-1');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('project-1');
      expect(mockDatabase.getProjects).toHaveBeenCalledWith('user-1');
      expect(mockRemoveUndefinedValues).toHaveBeenCalled();
    });

    test('should return empty array when no projects', async () => {
      mockDatabase.getProjects.mockReturnValue([]);

      const result = await handlers['project:get-all'](null, 'user-1');

      expect(result).toEqual([]);
    });

    test('should get single project', async () => {
      const result = await handlers['project:get'](null, 'project-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('project-1');
      expect(mockDatabase.getProjectById).toHaveBeenCalledWith('project-1');
    });

    test('should save project to local database', async () => {
      const project = { id: 'new-1', name: 'New Project', userId: 'user-1' };

      const result = await handlers['project:save'](null, project);

      expect(result.saved).toBe(true);
      expect(mockDatabase.saveProject).toHaveBeenCalled();
      expect(mockReplaceUndefinedWithNull).toHaveBeenCalledWith(project);
    });

    test('should update project', async () => {
      const updates = {
        name: 'Updated Project',
        description: 'Updated description',
      };

      const result = await handlers['project:update'](null, 'project-1', updates);

      expect(result).toBeDefined();
      expect(mockDatabase.updateProject).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({
          name: 'Updated Project',
        })
      );
    });

    test('should delete local project', async () => {
      const result = await handlers['project:delete-local'](null, 'project-1');

      expect(result.deleted).toBe('project-1');
      expect(mockDatabase.deleteProject).toHaveBeenCalledWith('project-1');
    });
  });

  describe('同步操作', () => {
    test('should sync single project', async () => {
      const result = await handlers['project:sync-one'](null, 'project-1');

      expect(result.success).toBe(true);
      expect(mockDatabase.updateProject).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({
          sync_status: 'synced',
        })
      );
    });

    test('should handle sync error when database not initialized', async () => {
      // 重新注册with null database
      delete require.cache[require.resolve('../../../desktop-app-vue/src/main/project/project-core-ipc')];
      const { registerProjectCoreIPC } = require('../../../desktop-app-vue/src/main/project/project-core-ipc');

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

  describe('文件管理操作', () => {
    test('should save project files', async () => {
      const files = [
        { id: 'file-1', name: 'file1.js' },
        { id: 'file-2', name: 'file2.js' },
      ];

      const result = await handlers['project:save-files'](null, 'project-1', files);

      expect(result.success).toBe(true);
      expect(mockDatabase.saveProjectFiles).toHaveBeenCalledWith('project-1', files);
    });

    test('should handle empty files array', async () => {
      const result = await handlers['project:save-files'](null, 'project-1', []);

      expect(result.success).toBe(true);
    });
  });

  describe('错误处理', () => {
    test('should handle database errors gracefully in get-all', async () => {
      mockDatabase.getProjects.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await handlers['project:get-all'](null, 'user-1');

      // 应该返回空数组而不是抛出错误
      expect(result).toEqual([]);
    });

    test('should throw error when creating project with null database', async () => {
      // 重新注册 with null database
      delete require.cache[require.resolve('../../../desktop-app-vue/src/main/project/project-core-ipc')];
      const { registerProjectCoreIPC } = require('../../../desktop-app-vue/src/main/project/project-core-ipc');

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
  });

  describe('边界情况', () => {
    test('should handle empty project list', async () => {
      mockDatabase.getProjects.mockReturnValue([]);

      const result = await handlers['project:get-all'](null, 'user-1');

      expect(result).toEqual([]);
    });

    test('should handle null project data', async () => {
      mockDatabase.getProjects.mockReturnValue(null);

      const result = await handlers['project:get-all'](null, 'user-1');

      expect(result).toEqual([]);
    });
  });
});
