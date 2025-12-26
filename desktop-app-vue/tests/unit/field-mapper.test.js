/**
 * 字段映射功能测试
 * 测试本地SQLite与后端PostgreSQL之间的数据格式转换
 */

const { describe, it, expect, beforeEach } = require('vitest');
const FieldMapper = require('../../src/main/sync/field-mapper');

describe('FieldMapper - 字段映射测试', () => {
  let mapper;

  beforeEach(() => {
    mapper = new FieldMapper();
  });

  describe('时间戳转换', () => {
    it('应该将毫秒时间戳转换为ISO 8601格式', () => {
      const timestamp = 1703596800000;
      const iso = mapper.toISO8601(timestamp);

      expect(iso).toBe('2023-12-26T08:00:00.000Z');
    });

    it('应该将ISO 8601格式转换为毫秒时间戳', () => {
      const iso = '2023-12-26T08:00:00.000Z';
      const timestamp = mapper.toMillis(iso);

      expect(timestamp).toBe(1703596800000);
    });

    it('应该处理null值', () => {
      expect(mapper.toISO8601(null)).toBeNull();
      expect(mapper.toMillis(null)).toBeNull();
    });

    it('应该处理undefined值', () => {
      expect(mapper.toISO8601(undefined)).toBeNull();
      expect(mapper.toMillis(undefined)).toBeNull();
    });
  });

  describe('toBackend - 本地格式转后端格式', () => {
    it('应该正确转换projects表记录', () => {
      const localRecord = {
        id: 'proj-123',
        user_id: 'user-456',
        name: 'Test Project',
        description: 'Test Description',
        project_type: 'code',
        status: 'active',
        root_path: '/path/to/project',
        file_count: 10,
        total_size: 1024000,
        created_at: 1703596800000,
        updated_at: 1703596900000,
        sync_status: 'pending',
        synced_at: 1703596850000,
        device_id: 'device-001',
        deleted: 0
      };

      const backendRecord = mapper.toBackend(localRecord, 'projects');

      expect(backendRecord.id).toBe('proj-123');
      expect(backendRecord.userId).toBe('user-456');
      expect(backendRecord.name).toBe('Test Project');
      expect(backendRecord.projectType).toBe('code');
      expect(backendRecord.rootPath).toBe('/path/to/project');
      expect(backendRecord.fileCount).toBe(10);
      expect(backendRecord.totalSize).toBe(1024000);
      expect(backendRecord.syncStatus).toBe('pending');
      expect(backendRecord.deleted).toBe(0);
    });

    it('应该正确转换project_files表记录', () => {
      const localRecord = {
        id: 'file-123',
        project_id: 'proj-456',
        file_path: '/src/index.js',
        file_name: 'index.js',
        file_type: 'javascript',
        content: 'console.log("hello");',
        content_hash: 'abc123',
        version: 3,
        created_at: 1703596800000,
        updated_at: 1703596900000,
        sync_status: 'synced',
        deleted: 0
      };

      const backendRecord = mapper.toBackend(localRecord, 'project_files');

      expect(backendRecord.id).toBe('file-123');
      expect(backendRecord.projectId).toBe('proj-456');
      expect(backendRecord.filePath).toBe('/src/index.js');
      expect(backendRecord.fileName).toBe('index.js');
      expect(backendRecord.fileType).toBe('javascript');
      expect(backendRecord.content).toBe('console.log("hello");');
      expect(backendRecord.contentHash).toBe('abc123');
      expect(backendRecord.version).toBe(3);
    });
  });

  describe('toLocal - 后端格式转本地格式（默认行为）', () => {
    it('应该默认设置sync_status为synced', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        name: 'Test Project',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:05:00.000Z'
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects');

      expect(localRecord.sync_status).toBe('synced');
      expect(localRecord.synced_at).toBeGreaterThan(0);
    });

    it('应该正确转换时间戳', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:05:00.000Z'
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects');

      expect(localRecord.created_at).toBe(1703596800000);
      expect(localRecord.updated_at).toBe(1703597100000);
    });

    it('应该正确转换字段名（camelCase -> snake_case）', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        projectType: 'code',
        rootPath: '/path',
        fileCount: 10,
        totalSize: 1024,
        deviceId: 'device-001',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects');

      expect(localRecord.user_id).toBe('user-456');
      expect(localRecord.project_type).toBe('code');
      expect(localRecord.root_path).toBe('/path');
      expect(localRecord.file_count).toBe(10);
      expect(localRecord.total_size).toBe(1024);
      expect(localRecord.device_id).toBe('device-001');
    });
  });

  describe('toLocal - 保留本地同步状态', () => {
    it('应该在preserveLocalStatus=true时保留本地sync_status', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        name: 'Test Project',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:05:00.000Z'
      };

      const existingRecord = {
        id: 'proj-123',
        sync_status: 'pending',
        synced_at: 1703596700000
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects', {
        existingRecord,
        preserveLocalStatus: true
      });

      expect(localRecord.sync_status).toBe('pending');
      expect(localRecord.synced_at).toBe(1703596700000);
    });

    it('应该在preserveLocalStatus=true但无existingRecord时使用默认值', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects', {
        preserveLocalStatus: true
        // 没有提供existingRecord
      });

      expect(localRecord.sync_status).toBe('synced');
    });

    it('应该保留error状态', () => {
      const backendRecord = {
        id: 'file-123',
        projectId: 'proj-456',
        filePath: '/test.js',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const existingRecord = {
        id: 'file-123',
        sync_status: 'error',
        synced_at: 1703596700000
      };

      const localRecord = mapper.toLocal(backendRecord, 'project_files', {
        existingRecord,
        preserveLocalStatus: true
      });

      expect(localRecord.sync_status).toBe('error');
    });

    it('应该保留conflict状态', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const existingRecord = {
        id: 'proj-123',
        sync_status: 'conflict',
        synced_at: null
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects', {
        existingRecord,
        preserveLocalStatus: true
      });

      expect(localRecord.sync_status).toBe('conflict');
      expect(localRecord.synced_at).toBeNull();
    });
  });

  describe('toLocal - 强制设置同步状态', () => {
    it('应该在forceSyncStatus时覆盖本地状态', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const existingRecord = {
        id: 'proj-123',
        sync_status: 'pending',
        synced_at: 1703596700000
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects', {
        existingRecord,
        preserveLocalStatus: true,
        forceSyncStatus: 'conflict'  // 强制设置，优先级最高
      });

      expect(localRecord.sync_status).toBe('conflict');
      expect(localRecord.synced_at).toBeGreaterThan(existingRecord.synced_at);
    });

    it('forceSyncStatus应该优先于preserveLocalStatus', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const existingRecord = {
        sync_status: 'error'
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects', {
        existingRecord,
        preserveLocalStatus: true,
        forceSyncStatus: 'synced'
      });

      expect(localRecord.sync_status).toBe('synced');
    });
  });

  describe('辅助方法', () => {
    it('toLocalAsNew应该明确标记为synced', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const localRecord = mapper.toLocalAsNew(backendRecord, 'projects');

      expect(localRecord.sync_status).toBe('synced');
    });

    it('toLocalForUpdate应该保留本地状态', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        name: 'Updated Name',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:10:00.000Z'
      };

      const existingRecord = {
        id: 'proj-123',
        name: 'Old Name',
        sync_status: 'pending',
        synced_at: 1703596700000
      };

      const localRecord = mapper.toLocalForUpdate(
        backendRecord,
        'projects',
        existingRecord
      );

      expect(localRecord.name).toBe('Updated Name');  // 更新了内容
      expect(localRecord.sync_status).toBe('pending');  // 保留了状态
    });

    it('toLocalAsConflict应该标记为conflict', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const localRecord = mapper.toLocalAsConflict(backendRecord, 'projects');

      expect(localRecord.sync_status).toBe('conflict');
    });
  });

  describe('边界情况', () => {
    it('应该处理缺少sync_status的existingRecord', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const existingRecord = {
        id: 'proj-123'
        // 没有sync_status字段
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects', {
        existingRecord,
        preserveLocalStatus: true
      });

      expect(localRecord.sync_status).toBe('synced');  // 降级为默认值
    });

    it('应该处理null的existingRecord', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects', {
        existingRecord: null,
        preserveLocalStatus: true
      });

      expect(localRecord.sync_status).toBe('synced');
    });

    it('应该处理空的options对象', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects', {});

      expect(localRecord.sync_status).toBe('synced');
    });

    it('应该处理完全缺少options参数', () => {
      const backendRecord = {
        id: 'proj-123',
        userId: 'user-456',
        createdAt: '2023-12-26T08:00:00.000Z',
        updatedAt: '2023-12-26T08:00:00.000Z'
      };

      const localRecord = mapper.toLocal(backendRecord, 'projects');

      expect(localRecord.sync_status).toBe('synced');
    });
  });
});
