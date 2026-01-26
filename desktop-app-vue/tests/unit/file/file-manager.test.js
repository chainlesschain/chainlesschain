/**
 * File Manager 单元测试
 *
 * 测试覆盖：
 * - 文件上传（权限检查、checksum去重、磁盘保存）
 * - 文件获取（单个/列表、筛选、JSON解析）
 * - 文件更新（权限、锁定检查、元数据更新）
 * - 文件删除（权限、访问日志）
 * - 文件锁定/解锁（过期时间、冲突检查）
 * - 标签管理（添加/删除/获取）
 * - 访问日志（记录和查询）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn()
  }
}));

vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => 'checksum123')
    }))
  }
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => '12345678-1234-1234-1234-123456789012')
}));

describe('FileManager', () => {
  let FileManager;
  let fileManager;
  let mockDb;
  let mockOrgManager;
  let mockPrepare;
  let fs;
  let crypto;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Import mocked modules
    fs = (await import('fs')).default;
    crypto = (await import('crypto')).default;

    // Mock database
    mockPrepare = {
      run: vi.fn().mockReturnValue({ changes: 1 }),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([])
    };

    mockDb = {
      prepare: vi.fn(() => mockPrepare)
    };

    // Mock organization manager
    mockOrgManager = {
      checkPermission: vi.fn().mockResolvedValue(true),
      logActivity: vi.fn().mockResolvedValue(true)
    };

    // Import FileManager after mocks
    const module = await import('../../../src/main/file/file-manager.js');
    FileManager = module.default;

    fileManager = new FileManager(mockDb, mockOrgManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with db and organizationManager', () => {
      expect(fileManager.db).toBe(mockDb);
      expect(fileManager.organizationManager).toBe(mockOrgManager);
    });
  });

  describe('uploadFile', () => {
    const fileData = {
      project_id: 'proj1',
      org_id: 'org1',
      workspace_id: 'ws1',
      file_name: 'test.txt',
      file_path: '/tmp/test.txt',
      file_type: 'text',
      file_size: 1024,
      content: 'Test content'
    };

    it('should upload file successfully', async () => {
      mockPrepare.get.mockReturnValue(null); // No existing file
      fs.existsSync.mockReturnValue(true);

      const result = await fileManager.uploadFile(fileData, 'user123');

      expect(mockDb.prepare).toHaveBeenCalled();
      expect(mockPrepare.run).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should check organization permission before upload', async () => {
      mockPrepare.get.mockReturnValue(null);
      fs.existsSync.mockReturnValue(true);

      await fileManager.uploadFile(fileData, 'user123');

      expect(mockOrgManager.checkPermission).toHaveBeenCalledWith(
        'org1',
        'user123',
        'file.upload'
      );
    });

    it('should throw error if no permission', async () => {
      mockOrgManager.checkPermission.mockResolvedValue(false);

      await expect(fileManager.uploadFile(fileData, 'user123'))
        .rejects.toThrow('无权限上传文件到此组织');
    });

    it('should return existing file if checksum matches', async () => {
      const existingFile = { id: 'existing123', file_name: 'test.txt' };
      mockPrepare.get
        .mockReturnValueOnce(existingFile) // First call: checksum check
        .mockReturnValueOnce(existingFile); // Second call: getFile

      const result = await fileManager.uploadFile(fileData, 'user123');

      expect(result.id).toBe('existing123');
      expect(mockPrepare.run).not.toHaveBeenCalled(); // Should not insert
    });

    it('should calculate checksum for deduplication', async () => {
      mockPrepare.get.mockReturnValue(null);
      fs.existsSync.mockReturnValue(true);

      await fileManager.uploadFile(fileData, 'user123');

      expect(crypto.createHash).toHaveBeenCalledWith('md5');
    });

    it('should save file to disk', async () => {
      mockPrepare.get.mockReturnValue(null);
      fs.existsSync.mockReturnValue(true);

      await fileManager.uploadFile(fileData, 'user123');

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should create directory if not exists', async () => {
      mockPrepare.get.mockReturnValue(null);
      fs.existsSync.mockReturnValue(false);

      await fileManager.uploadFile(fileData, 'user123');

      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('should insert file record with correct data', async () => {
      mockPrepare.get.mockReturnValue(null);
      fs.existsSync.mockReturnValue(true);

      await fileManager.uploadFile(fileData, 'user123');

      const insertCall = mockPrepare.run.mock.calls.find(call =>
        call.length > 5 && call[1] === 'proj1'
      );
      expect(insertCall).toBeDefined();
      expect(insertCall).toContain('test.txt');
      expect(insertCall).toContain('checksum123');
    });

    it('should log file access', async () => {
      mockPrepare.get.mockReturnValue(null);
      fs.existsSync.mockReturnValue(true);

      await fileManager.uploadFile(fileData, 'user123');

      // Verify logFileAccess was called via prepare
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('file_access_logs')
      );
    });

    it('should log organization activity', async () => {
      mockPrepare.get.mockReturnValue(null);
      fs.existsSync.mockReturnValue(true);

      await fileManager.uploadFile(fileData, 'user123');

      expect(mockOrgManager.logActivity).toHaveBeenCalledWith(
        'org1',
        'user123',
        'file.uploaded',
        expect.objectContaining({ fileName: 'test.txt' })
      );
    });
  });

  describe('getFile', () => {
    it('should get file by ID', () => {
      const mockFile = {
        id: 'file123',
        file_name: 'test.txt',
        shared_with: null
      };
      mockPrepare.get.mockReturnValue(mockFile);

      const result = fileManager.getFile('file123');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM project_files WHERE id = ?')
      );
      expect(result).toEqual(mockFile);
    });

    it('should parse shared_with JSON field', () => {
      const mockFile = {
        id: 'file123',
        shared_with: '["user1","user2"]'
      };
      mockPrepare.get.mockReturnValue(mockFile);

      const result = fileManager.getFile('file123');

      expect(result.shared_with).toEqual(['user1', 'user2']);
    });

    it('should throw error if file not found', () => {
      mockPrepare.get.mockReturnValue(null);

      expect(() => fileManager.getFile('nonexistent'))
        .toThrow('文件不存在');
    });
  });

  describe('getFiles', () => {
    const mockFiles = [
      { id: 'file1', file_name: 'test1.txt', shared_with: null },
      { id: 'file2', file_name: 'test2.txt', shared_with: '["user1"]' }
    ];

    beforeEach(() => {
      mockPrepare.all.mockReturnValue(mockFiles);
    });

    it('should get files with default filters', () => {
      const result = fileManager.getFiles();

      expect(mockDb.prepare).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    it('should filter by project_id', () => {
      fileManager.getFiles({ project_id: 'proj1' });

      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain('project_id = ?');
    });

    it('should filter by org_id', () => {
      fileManager.getFiles({ org_id: 'org1' });

      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain('org_id = ?');
    });

    it('should filter by file_type', () => {
      fileManager.getFiles({ file_type: 'image' });

      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain('file_type = ?');
    });

    it('should filter locked files', () => {
      fileManager.getFiles({ locked: true });

      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain("lock_status != 'unlocked'");
    });

    it('should apply pagination', () => {
      fileManager.getFiles({ limit: 50, offset: 100 });

      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain('LIMIT ? OFFSET ?');
    });

    it('should parse JSON fields in results', () => {
      const result = fileManager.getFiles();

      expect(result[0].shared_with).toBeNull();
      expect(result[1].shared_with).toEqual(['user1']);
    });
  });

  describe('updateFile', () => {
    const mockFile = {
      id: 'file123',
      org_id: 'org1',
      lock_status: 'unlocked',
      locked_by: null
    };

    beforeEach(() => {
      mockPrepare.get.mockReturnValue(mockFile);
    });

    it('should update file metadata', async () => {
      const updates = { file_name: 'new-name.txt' };

      const result = await fileManager.updateFile('file123', updates, 'user123');

      expect(result.success).not.toBe(false);
      expect(mockPrepare.run).toHaveBeenCalled();
    });

    it('should check permission before update', async () => {
      const updates = { file_name: 'new-name.txt' };

      await fileManager.updateFile('file123', updates, 'user123');

      expect(mockOrgManager.checkPermission).toHaveBeenCalledWith(
        'org1',
        'user123',
        'file.edit'
      );
    });

    it('should return error if no permission', async () => {
      mockOrgManager.checkPermission.mockResolvedValue(false);

      const result = await fileManager.updateFile('file123', {}, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('无权限');
    });

    it('should check file lock status', async () => {
      mockPrepare.get.mockReturnValue({
        ...mockFile,
        lock_status: 'locked',
        locked_by: 'other_user'
      });

      const result = await fileManager.updateFile('file123', {}, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('已被其他用户锁定');
    });

    it('should allow update if locked by same user', async () => {
      mockPrepare.get.mockReturnValue({
        ...mockFile,
        lock_status: 'locked',
        locked_by: 'user123'
      });

      const result = await fileManager.updateFile(
        'file123',
        { file_name: 'new.txt' },
        'user123'
      );

      expect(result.success).not.toBe(false);
    });

    it('should only update allowed fields', async () => {
      const updates = {
        file_name: 'new.txt',
        file_type: 'text',
        disallowed_field: 'value'
      };

      await fileManager.updateFile('file123', updates, 'user123');

      const updateQuery = mockDb.prepare.mock.calls.find(call =>
        call[0].includes('UPDATE project_files')
      )[0];

      expect(updateQuery).toContain('file_name = ?');
      expect(updateQuery).not.toContain('disallowed_field');
    });

    it('should update updated_at timestamp', async () => {
      await fileManager.updateFile('file123', { file_name: 'new.txt' }, 'user123');

      const updateQuery = mockDb.prepare.mock.calls.find(call =>
        call[0].includes('UPDATE project_files')
      )[0];

      expect(updateQuery).toContain('updated_at = ?');
    });

    it('should return error if no fields to update', async () => {
      const result = await fileManager.updateFile('file123', {}, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('没有可更新的字段');
    });
  });

  describe('deleteFile', () => {
    const mockFile = {
      id: 'file123',
      org_id: 'org1',
      file_path: '/path/to/file.txt'
    };

    beforeEach(() => {
      mockPrepare.get.mockReturnValue(mockFile);
      fs.existsSync.mockReturnValue(true);
    });

    it('should delete file', async () => {
      const result = await fileManager.deleteFile('file123', 'user123');

      expect(result.success).toBe(true);
      expect(mockPrepare.run).toHaveBeenCalled();
    });

    it('should check permission before delete', async () => {
      await fileManager.deleteFile('file123', 'user123');

      expect(mockOrgManager.checkPermission).toHaveBeenCalledWith(
        'org1',
        'user123',
        'file.delete'
      );
    });

    it('should return error if no permission', async () => {
      mockOrgManager.checkPermission.mockResolvedValue(false);

      const result = await fileManager.deleteFile('file123', 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('无权限');
    });

    it('should delete file from disk', async () => {
      await fileManager.deleteFile('file123', 'user123');

      expect(fs.unlinkSync).toHaveBeenCalledWith('/path/to/file.txt');
    });

    it('should handle missing file on disk', async () => {
      fs.existsSync.mockReturnValue(false);

      const result = await fileManager.deleteFile('file123', 'user123');

      expect(result.success).toBe(true);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should delete from database', async () => {
      await fileManager.deleteFile('file123', 'user123');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM project_files')
      );
    });

    it('should log file access', async () => {
      await fileManager.deleteFile('file123', 'user123');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('file_access_logs')
      );
    });
  });

  describe('lockFile', () => {
    const mockFile = {
      id: 'file123',
      lock_status: 'unlocked'
    };

    beforeEach(() => {
      mockPrepare.get.mockReturnValue(mockFile);
    });

    it('should lock file', async () => {
      const result = await fileManager.lockFile('file123', 'user123');

      expect(result.success).toBe(true);
      expect(mockPrepare.run).toHaveBeenCalled();
    });

    it('should set lock expiry time', async () => {
      const expiresIn = 7200000; // 2 hours
      await fileManager.lockFile('file123', 'user123', expiresIn);

      const updateCall = mockPrepare.run.mock.calls.find(call =>
        call.length > 2
      );
      expect(updateCall).toBeDefined();
    });

    it('should use default expiry if not specified', async () => {
      await fileManager.lockFile('file123', 'user123');

      // Should use default 3600000 (1 hour)
      expect(mockPrepare.run).toHaveBeenCalled();
    });

    it('should return error if already locked', async () => {
      mockPrepare.get.mockReturnValue({
        id: 'file123',
        lock_status: 'locked',
        locked_by: 'other_user'
      });

      const result = await fileManager.lockFile('file123', 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('已被锁定');
    });

    it('should allow relocking by same user', async () => {
      mockPrepare.get.mockReturnValue({
        id: 'file123',
        lock_status: 'locked',
        locked_by: 'user123'
      });

      const result = await fileManager.lockFile('file123', 'user123');

      expect(result.success).toBe(true);
    });
  });

  describe('unlockFile', () => {
    const mockFile = {
      id: 'file123',
      lock_status: 'locked',
      locked_by: 'user123'
    };

    beforeEach(() => {
      mockPrepare.get.mockReturnValue(mockFile);
    });

    it('should unlock file', async () => {
      const result = await fileManager.unlockFile('file123', 'user123');

      expect(result.success).toBe(true);
      expect(mockPrepare.run).toHaveBeenCalled();
    });

    it('should allow unlock by file owner', async () => {
      const result = await fileManager.unlockFile('file123', 'user123');

      expect(result.success).toBe(true);
    });

    it('should return error if locked by other user', async () => {
      const result = await fileManager.unlockFile('file123', 'other_user');

      expect(result.success).toBe(false);
      expect(result.error).toContain('无权解锁');
    });

    it('should return error if file not locked', async () => {
      mockPrepare.get.mockReturnValue({
        id: 'file123',
        lock_status: 'unlocked'
      });

      const result = await fileManager.unlockFile('file123', 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('未被锁定');
    });
  });

  describe('Tag Management', () => {
    describe('addTag', () => {
      beforeEach(() => {
        mockPrepare.get.mockReturnValue({ id: 'file123', tags: null });
      });

      it('should add tag to file', () => {
        fileManager.addTag('file123', 'important', 'user123');

        expect(mockPrepare.run).toHaveBeenCalled();
      });

      it('should create tags array if null', () => {
        fileManager.addTag('file123', 'important', 'user123');

        const updateCall = mockPrepare.run.mock.calls[0];
        const tagsParam = updateCall[0];
        expect(JSON.parse(tagsParam)).toEqual(['important']);
      });

      it('should append to existing tags', () => {
        mockPrepare.get.mockReturnValue({
          id: 'file123',
          tags: '["existing"]'
        });

        fileManager.addTag('file123', 'new', 'user123');

        const updateCall = mockPrepare.run.mock.calls[0];
        const tagsParam = updateCall[0];
        expect(JSON.parse(tagsParam)).toEqual(['existing', 'new']);
      });

      it('should not add duplicate tags', () => {
        mockPrepare.get.mockReturnValue({
          id: 'file123',
          tags: '["important"]'
        });

        fileManager.addTag('file123', 'important', 'user123');

        const updateCall = mockPrepare.run.mock.calls[0];
        const tagsParam = updateCall[0];
        expect(JSON.parse(tagsParam)).toEqual(['important']);
      });
    });

    describe('removeTag', () => {
      it('should remove tag from file', () => {
        mockPrepare.get.mockReturnValue({
          id: 'file123',
          tags: '["tag1","tag2"]'
        });

        fileManager.removeTag('file123', 'tag1');

        const updateCall = mockPrepare.run.mock.calls[0];
        const tagsParam = updateCall[0];
        expect(JSON.parse(tagsParam)).toEqual(['tag2']);
      });

      it('should handle removing non-existent tag', () => {
        mockPrepare.get.mockReturnValue({
          id: 'file123',
          tags: '["tag1"]'
        });

        fileManager.removeTag('file123', 'nonexistent');

        const updateCall = mockPrepare.run.mock.calls[0];
        const tagsParam = updateCall[0];
        expect(JSON.parse(tagsParam)).toEqual(['tag1']);
      });
    });

    describe('getTags', () => {
      it('should get tags for file', () => {
        mockPrepare.get.mockReturnValue({
          id: 'file123',
          tags: '["tag1","tag2"]'
        });

        const tags = fileManager.getTags('file123');

        expect(tags).toEqual(['tag1', 'tag2']);
      });

      it('should return empty array if no tags', () => {
        mockPrepare.get.mockReturnValue({
          id: 'file123',
          tags: null
        });

        const tags = fileManager.getTags('file123');

        expect(tags).toEqual([]);
      });
    });
  });

  describe('getAccessLogs', () => {
    it('should get access logs for file', () => {
      const mockLogs = [
        { id: 1, action: 'upload', user_did: 'user1' },
        { id: 2, action: 'edit', user_did: 'user2' }
      ];
      mockPrepare.all.mockReturnValue(mockLogs);

      const logs = fileManager.getAccessLogs('file123');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('file_access_logs')
      );
      expect(logs).toEqual(mockLogs);
    });

    it('should apply limit parameter', () => {
      mockPrepare.all.mockReturnValue([]);

      fileManager.getAccessLogs('file123', 100);

      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain('LIMIT ?');
    });

    it('should order by timestamp descending', () => {
      mockPrepare.all.mockReturnValue([]);

      fileManager.getAccessLogs('file123');

      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain('ORDER BY timestamp DESC');
    });
  });

  describe('Private Methods', () => {
    describe('_calculateChecksum', () => {
      it('should calculate MD5 checksum', () => {
        const checksum = fileManager._calculateChecksum('test content');

        expect(crypto.createHash).toHaveBeenCalledWith('md5');
        expect(checksum).toBe('checksum123');
      });

      it('should handle buffer content', () => {
        const buffer = Buffer.from('test');
        const checksum = fileManager._calculateChecksum(buffer);

        expect(checksum).toBeDefined();
      });
    });

    describe('_saveFileToDisk', () => {
      it('should save file to disk', async () => {
        fs.existsSync.mockReturnValue(true);

        const savedPath = await fileManager._saveFileToDisk('/original/path.txt', 'content');

        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(savedPath).toBeDefined();
      });

      it('should create directory if needed', async () => {
        fs.existsSync.mockReturnValue(false);

        await fileManager._saveFileToDisk('/new/dir/file.txt', 'content');

        expect(fs.mkdirSync).toHaveBeenCalled();
      });
    });

    describe('_logFileAccess', () => {
      it('should log file access', async () => {
        await fileManager._logFileAccess('file123', 'user123', 'upload');

        expect(mockDb.prepare).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO file_access_logs')
        );
        expect(mockPrepare.run).toHaveBeenCalled();
      });

      it('should include metadata', async () => {
        await fileManager._logFileAccess('file123', 'user123', 'upload', {
          ip: '127.0.0.1'
        });

        const runCall = mockPrepare.run.mock.calls[0];
        expect(runCall).toContain('{"ip":"127.0.0.1"}');
      });
    });
  });
});
