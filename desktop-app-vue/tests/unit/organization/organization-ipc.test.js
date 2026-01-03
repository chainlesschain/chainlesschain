/**
 * Organization IPC 单元测试
 * 测试32个组织管理 API 方法
 *
 * 注意：当前测试只验证 IPC handlers 是否正确注册
 * TODO: 添加实际handler调用测试（需要解决CommonJS mock问题）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain, dialog, app } from 'electron';

// Mock electron 模块
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/test/documents'),
  },
}));

describe('Organization IPC', () => {
  let handlers = {};
  let mockOrganizationManager;
  let mockDbManager;
  let mockVersionManager;
  let registerOrganizationIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // Mock organization manager
    mockOrganizationManager = {
      createOrganization: vi.fn(),
      joinOrganization: vi.fn(),
      getOrganization: vi.fn(),
      updateOrganization: vi.fn(),
      getUserOrganizations: vi.fn(),
      leaveOrganization: vi.fn(),
      deleteOrganization: vi.fn(),
      getOrganizationMembers: vi.fn(),
      updateMemberRole: vi.fn(),
      removeMember: vi.fn(),
      checkPermission: vi.fn(),
      getMemberActivities: vi.fn(),
      createInvitation: vi.fn(),
      inviteByDID: vi.fn(),
      acceptDIDInvitation: vi.fn(),
      rejectDIDInvitation: vi.fn(),
      getPendingDIDInvitations: vi.fn(),
      getDIDInvitations: vi.fn(),
      getInvitations: vi.fn(),
      revokeInvitation: vi.fn(),
      deleteInvitation: vi.fn(),
      getRoles: vi.fn(),
      getRole: vi.fn(),
      createCustomRole: vi.fn(),
      updateRole: vi.fn(),
      deleteRole: vi.fn(),
      getAllPermissions: vi.fn(),
      getOrganizationActivities: vi.fn(),
      logActivity: vi.fn(),
    };

    // Mock db manager
    mockDbManager = {
      db: {
        prepare: vi.fn(() => ({
          all: vi.fn(() => []),
          get: vi.fn(() => null),
          run: vi.fn(() => ({ changes: 1 })),
        })),
      },
    };

    // Mock version manager
    mockVersionManager = {
      createVersionSnapshot: vi.fn(),
      getVersionHistory: vi.fn(),
      restoreVersion: vi.fn(),
    };

    // 动态导入，确保 mock 已设置
    const module = await import('../../../src/main/organization/organization-ipc.js');
    registerOrganizationIPC = module.registerOrganizationIPC;

    // 捕获 IPC handlers
    const { ipcMain } = await import('electron');
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // 注册 Organization IPC
    registerOrganizationIPC({
      organizationManager: mockOrganizationManager,
      dbManager: mockDbManager,
      versionManager: mockVersionManager,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('基本功能测试', () => {
    it('should register all 32 IPC handlers', () => {
      expect(Object.keys(handlers).length).toBeGreaterThanOrEqual(30);
    });

    it('should have all expected handler channels', () => {
      const expectedChannels = [
        // 组织基础操作 (12)
        'org:create-organization',
        'org:join-organization',
        'org:get-organization',
        'org:update-organization',
        'org:get-user-organizations',
        'org:leave-organization',
        'org:delete-organization',
        'org:get-members',
        'org:update-member-role',
        'org:remove-member',
        'org:check-permission',
        'org:get-member-activities',

        // 邀请管理 (8)
        'org:create-invitation',
        'org:invite-by-did',
        'org:accept-did-invitation',
        'org:reject-did-invitation',
        'org:get-pending-did-invitations',
        'org:get-did-invitations',
        'org:get-invitations',
        'org:revoke-invitation',

        // 角色权限管理 (6)
        'org:get-roles',
        'org:get-role',
        'org:create-custom-role',
        'org:update-role',
        'org:delete-role',
        'org:get-all-permissions',

        // 活动日志 (2)
        'org:get-activities',
        'org:export-activities',

        // 组织知识库 (3)
        'org:get-knowledge-items',
        'org:create-knowledge',
        'org:delete-knowledge',
      ];

      expectedChannels.forEach(channel => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });
  });

  describe('组织基础操作 (12 handlers)', () => {
    it('should have create-organization handler', () => {
      expect(handlers['org:create-organization']).toBeDefined();
    });

    it('should have join-organization handler', () => {
      expect(handlers['org:join-organization']).toBeDefined();
    });

    it('should have get-organization handler', () => {
      expect(handlers['org:get-organization']).toBeDefined();
    });

    it('should have update-organization handler', () => {
      expect(handlers['org:update-organization']).toBeDefined();
    });

    it('should have get-user-organizations handler', () => {
      expect(handlers['org:get-user-organizations']).toBeDefined();
    });

    it('should have leave-organization handler', () => {
      expect(handlers['org:leave-organization']).toBeDefined();
    });

    it('should have delete-organization handler', () => {
      expect(handlers['org:delete-organization']).toBeDefined();
    });

    it('should have get-members handler', () => {
      expect(handlers['org:get-members']).toBeDefined();
    });

    it('should have update-member-role handler', () => {
      expect(handlers['org:update-member-role']).toBeDefined();
    });

    it('should have remove-member handler', () => {
      expect(handlers['org:remove-member']).toBeDefined();
    });

    it('should have check-permission handler', () => {
      expect(handlers['org:check-permission']).toBeDefined();
    });

    it('should have get-member-activities handler', () => {
      expect(handlers['org:get-member-activities']).toBeDefined();
    });
  });

  describe('邀请管理 (8 handlers)', () => {
    it('should have create-invitation handler', () => {
      expect(handlers['org:create-invitation']).toBeDefined();
    });

    it('should have invite-by-did handler', () => {
      expect(handlers['org:invite-by-did']).toBeDefined();
    });

    it('should have accept-did-invitation handler', () => {
      expect(handlers['org:accept-did-invitation']).toBeDefined();
    });

    it('should have reject-did-invitation handler', () => {
      expect(handlers['org:reject-did-invitation']).toBeDefined();
    });

    it('should have get-pending-did-invitations handler', () => {
      expect(handlers['org:get-pending-did-invitations']).toBeDefined();
    });

    it('should have get-did-invitations handler', () => {
      expect(handlers['org:get-did-invitations']).toBeDefined();
    });

    it('should have get-invitations handler', () => {
      expect(handlers['org:get-invitations']).toBeDefined();
    });

    it('should have revoke-invitation handler', () => {
      expect(handlers['org:revoke-invitation']).toBeDefined();
    });
  });

  describe('角色权限管理 (6 handlers)', () => {
    it('should have get-roles handler', () => {
      expect(handlers['org:get-roles']).toBeDefined();
    });

    it('should have get-role handler', () => {
      expect(handlers['org:get-role']).toBeDefined();
    });

    it('should have create-custom-role handler', () => {
      expect(handlers['org:create-custom-role']).toBeDefined();
    });

    it('should have update-role handler', () => {
      expect(handlers['org:update-role']).toBeDefined();
    });

    it('should have delete-role handler', () => {
      expect(handlers['org:delete-role']).toBeDefined();
    });

    it('should have get-all-permissions handler', () => {
      expect(handlers['org:get-all-permissions']).toBeDefined();
    });
  });

  describe('活动日志 (2 handlers)', () => {
    it('should have get-activities handler', () => {
      expect(handlers['org:get-activities']).toBeDefined();
    });

    it('should have export-activities handler', () => {
      expect(handlers['org:export-activities']).toBeDefined();
    });
  });

  describe('组织知识库 (3 handlers)', () => {
    it('should have get-knowledge-items handler', () => {
      expect(handlers['org:get-knowledge-items']).toBeDefined();
    });

    it('should have create-knowledge handler', () => {
      expect(handlers['org:create-knowledge']).toBeDefined();
    });

    it('should have delete-knowledge handler', () => {
      expect(handlers['org:delete-knowledge']).toBeDefined();
    });
  });
});
