/**
 * File Permission Manager 单元测试
 * 测试文件所有者权限自动判断逻辑
 */

const FilePermissionManager = require('../../../src/main/file/file-permission-manager');

// Mock 数据库
const createMockDb = () => ({
  prepare: jest.fn((sql) => ({
    get: jest.fn(),
    all: jest.fn(),
    run: jest.fn(),
  })),
});

// Mock 组织管理器
const createMockOrgManager = () => ({
  checkPermission: jest.fn(),
});

describe('FilePermissionManager - checkPermission', () => {
  let filePermissionManager;
  let mockDb;
  let mockOrgManager;

  beforeEach(() => {
    mockDb = createMockDb();
    mockOrgManager = createMockOrgManager();
    filePermissionManager = new FilePermissionManager(mockDb, mockOrgManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('文件所有者权限判断', () => {
    it('应该识别项目所有者并授予所有权限', async () => {
      const fileId = 'file123';
      const userDID = 'did:example:user123';
      const projectId = 'project456';

      // Mock: 文件信息
      const mockFile = {
        id: fileId,
        project_id: projectId,
        org_id: null,
      };

      // Mock: 项目信息 - user123 是项目所有者
      const mockProject = {
        id: projectId,
        user_id: userDID,
      };

      // 设置 mock 返回值
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM projects WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockProject) };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      const hasPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'manage'
      );

      expect(hasPermission).toBe(true);
    });

    it('非项目所有者不应该自动获得manage权限', async () => {
      const fileId = 'file123';
      const userDID = 'did:example:user999'; // 不同的用户
      const projectId = 'project456';
      const ownerDID = 'did:example:owner123';

      const mockFile = {
        id: fileId,
        project_id: projectId,
        org_id: null,
      };

      const mockProject = {
        id: projectId,
        user_id: ownerDID, // 所有者是另一个用户
      };

      // 设置 mock
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM projects WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockProject) };
        }
        if (sql.includes('FROM file_permissions')) {
          return { get: jest.fn().mockReturnValue(null), all: jest.fn().mockReturnValue([]) };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      const hasPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'manage'
      );

      expect(hasPermission).toBe(false);
    });

    it('没有project_id的文件应该跳过项目所有者检查', async () => {
      const fileId = 'file123';
      const userDID = 'did:example:user123';

      const mockFile = {
        id: fileId,
        project_id: null, // 没有关联项目
        org_id: null,
      };

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM file_permissions')) {
          return { get: jest.fn().mockReturnValue(null), all: jest.fn().mockReturnValue([]) };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      const hasPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'manage'
      );

      expect(hasPermission).toBe(false);
    });
  });

  describe('直接权限检查', () => {
    it('应该识别直接授予的权限', async () => {
      const fileId = 'file123';
      const userDID = 'did:example:user123';

      const mockFile = {
        id: fileId,
        project_id: 'project456',
        org_id: null,
      };

      const mockProject = {
        id: 'project456',
        user_id: 'did:example:owner999', // 不是所有者
      };

      const mockPermission = {
        file_id: fileId,
        member_did: userDID,
        permission: 'edit', // 直接授予 edit 权限
      };

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM projects WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockProject) };
        }
        if (sql.includes('FROM file_permissions')) {
          return { get: jest.fn().mockReturnValue(mockPermission), all: jest.fn() };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      const hasPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'edit'
      );

      expect(hasPermission).toBe(true);
    });

    it('权限等级应该正确判断（edit包含view）', async () => {
      const fileId = 'file123';
      const userDID = 'did:example:user123';

      const mockFile = {
        id: fileId,
        project_id: 'project456',
        org_id: null,
      };

      const mockProject = {
        id: 'project456',
        user_id: 'did:example:owner999',
      };

      const mockPermission = {
        file_id: fileId,
        member_did: userDID,
        permission: 'edit', // edit权限
      };

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM projects WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockProject) };
        }
        if (sql.includes('FROM file_permissions')) {
          return { get: jest.fn().mockReturnValue(mockPermission) };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      // edit 权限应该包含 view
      const hasViewPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'view'
      );

      expect(hasViewPermission).toBe(true);
    });

    it('权限等级应该正确判断（view不包含edit）', async () => {
      const fileId = 'file123';
      const userDID = 'did:example:user123';

      const mockFile = {
        id: fileId,
        project_id: 'project456',
        org_id: null,
      };

      const mockProject = {
        id: 'project456',
        user_id: 'did:example:owner999',
      };

      const mockPermission = {
        file_id: fileId,
        member_did: userDID,
        permission: 'view', // 只有 view 权限
      };

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM projects WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockProject) };
        }
        if (sql.includes('FROM file_permissions')) {
          return { get: jest.fn().mockReturnValue(mockPermission) };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      // view 权限不应该包含 edit
      const hasEditPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'edit'
      );

      expect(hasEditPermission).toBe(false);
    });
  });

  describe('角色权限检查', () => {
    it('应该识别基于角色的权限', async () => {
      const fileId = 'file123';
      const userDID = 'did:example:user123';
      const orgId = 'org456';

      const mockFile = {
        id: fileId,
        project_id: null,
        org_id: orgId,
      };

      const mockRolePermissions = [
        {
          permission: 'edit', // 角色赋予的权限
        },
      ];

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM file_permissions') && sql.includes('JOIN organization_members')) {
          return { all: jest.fn().mockReturnValue(mockRolePermissions) };
        }
        if (sql.includes('FROM file_permissions')) {
          return { get: jest.fn().mockReturnValue(null) };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      mockOrgManager.checkPermission.mockResolvedValue(false);

      const hasPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'edit'
      );

      expect(hasPermission).toBe(true);
    });
  });

  describe('组织级别权限检查', () => {
    it('应该通过组织管理器检查权限', async () => {
      const fileId = 'file123';
      const userDID = 'did:example:user123';
      const orgId = 'org456';

      const mockFile = {
        id: fileId,
        project_id: null,
        org_id: orgId,
      };

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM file_permissions')) {
          return { get: jest.fn().mockReturnValue(null), all: jest.fn().mockReturnValue([]) };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      // Mock 组织权限检查返回 true
      mockOrgManager.checkPermission.mockResolvedValue(true);

      const hasPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'manage'
      );

      expect(hasPermission).toBe(true);
      expect(mockOrgManager.checkPermission).toHaveBeenCalledWith(
        orgId,
        userDID,
        'file.manage'
      );
    });

    it('没有org_id的文件应该跳过组织权限检查', async () => {
      const fileId = 'file123';
      const userDID = 'did:example:user123';

      const mockFile = {
        id: fileId,
        project_id: null,
        org_id: null, // 没有组织
      };

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM file_permissions')) {
          return { get: jest.fn().mockReturnValue(null) };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      const hasPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'manage'
      );

      expect(hasPermission).toBe(false);
      expect(mockOrgManager.checkPermission).not.toHaveBeenCalled();
    });
  });

  describe('边界情况', () => {
    it('文件不存在时应该返回 false', async () => {
      const fileId = 'nonexistent';
      const userDID = 'did:example:user123';

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(null) }; // 文件不存在
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      const hasPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'view'
      );

      expect(hasPermission).toBe(false);
    });

    it('项目不存在时应该继续检查其他权限', async () => {
      const fileId = 'file123';
      const userDID = 'did:example:user123';

      const mockFile = {
        id: fileId,
        project_id: 'nonexistent_project',
        org_id: null,
      };

      const mockPermission = {
        file_id: fileId,
        member_did: userDID,
        permission: 'view',
      };

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM projects WHERE id')) {
          return { get: jest.fn().mockReturnValue(null) }; // 项目不存在
        }
        if (sql.includes('FROM file_permissions')) {
          return { get: jest.fn().mockReturnValue(mockPermission) };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      const hasPermission = await filePermissionManager.checkPermission(
        fileId,
        userDID,
        'view'
      );

      // 即使项目不存在，直接权限仍然有效
      expect(hasPermission).toBe(true);
    });
  });

  describe('权限层级顺序', () => {
    it('项目所有者应该优先于其他权限', async () => {
      const fileId = 'file123';
      const ownerDID = 'did:example:owner123';
      const projectId = 'project456';

      const mockFile = {
        id: fileId,
        project_id: projectId,
        org_id: 'org789',
      };

      const mockProject = {
        id: projectId,
        user_id: ownerDID,
      };

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes('FROM project_files WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockFile) };
        }
        if (sql.includes('FROM projects WHERE id')) {
          return { get: jest.fn().mockReturnValue(mockProject) };
        }
        return { get: jest.fn(), all: jest.fn() };
      });

      const hasPermission = await filePermissionManager.checkPermission(
        fileId,
        ownerDID,
        'manage'
      );

      // 项目所有者自动拥有所有权限
      expect(hasPermission).toBe(true);
      // 不需要查询直接权限或组织权限
      expect(mockOrgManager.checkPermission).not.toHaveBeenCalled();
    });
  });
});
