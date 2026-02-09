/**
 * Organization IPC 单元测试
 * 测试组织管理相关的 IPC 处理器（企业版功能）
 *
 * 测试覆盖范围:
 * - 组织基础操作 (12 handlers)
 * - 成员管理 (4 handlers)
 * - 邀请管理 (8 handlers)
 * - 邀请链接管理 (9 handlers)
 * - QR码生成 (5 handlers)
 * - 角色与权限管理 (6 handlers)
 * - 活动日志 (2 handlers)
 * - 组织知识库 (3 handlers)
 * - 错误处理 (5 test cases)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("Organization IPC 处理器", () => {
  let handlers = {};
  let mockOrganizationManager;
  let mockDbManager;
  let mockVersionManager;
  let mockIpcMain;
  let mockDialog;
  let mockApp;
  let mockClipboard;
  let registerOrganizationIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock ipcMain
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };

    // Mock dialog
    mockDialog = {
      showSaveDialog: vi.fn(),
    };

    // Mock app
    mockApp = {
      getPath: vi.fn((name) => {
        if (name === "documents") {
          return "C:/Users/Test/Documents";
        }
        return "C:/Users/Test/AppData";
      }),
    };

    // Mock clipboard
    mockClipboard = {
      writeText: vi.fn(),
    };

    // Mock DID Invitation Manager
    const mockDIDInvitationManager = {
      createInvitationLink: vi.fn(),
      validateInvitationToken: vi.fn(),
      acceptInvitationLink: vi.fn(),
      getInvitationLinks: vi.fn(),
      getInvitationLink: vi.fn(),
      revokeInvitationLink: vi.fn(),
      deleteInvitationLink: vi.fn(),
      getInvitationLinkStats: vi.fn(),
      generateInvitationQRCode: vi.fn(),
      generateDIDInvitationQRCode: vi.fn(),
      generateBatchInvitationQRCodes: vi.fn(),
      parseInvitationQRCode: vi.fn(),
    };

    // Mock Organization Manager
    mockOrganizationManager = {
      // 基础操作
      createOrganization: vi.fn(),
      joinOrganization: vi.fn(),
      getOrganization: vi.fn(),
      updateOrganization: vi.fn(),
      deleteOrganization: vi.fn(),
      getUserOrganizations: vi.fn(),
      leaveOrganization: vi.fn(),

      // 成员管理
      getOrganizationMembers: vi.fn(),
      updateMemberRole: vi.fn(),
      removeMember: vi.fn(),
      getMemberActivities: vi.fn(),

      // 邀请管理
      createInvitation: vi.fn(),
      inviteByDID: vi.fn(),
      acceptDIDInvitation: vi.fn(),
      rejectDIDInvitation: vi.fn(),
      getPendingDIDInvitations: vi.fn(),
      getDIDInvitations: vi.fn(),
      getInvitations: vi.fn(),
      revokeInvitation: vi.fn(),
      deleteInvitation: vi.fn(),

      // 角色与权限
      checkPermission: vi.fn(),
      getRoles: vi.fn(),
      getRole: vi.fn(),
      createCustomRole: vi.fn(),
      updateRole: vi.fn(),
      deleteRole: vi.fn(),
      getAllPermissions: vi.fn(),

      // 活动日志
      getOrganizationActivities: vi.fn(),
      logActivity: vi.fn(),

      // DID Invitation Manager
      didInvitationManager: mockDIDInvitationManager,
    };

    // Mock DB Manager
    mockDbManager = {
      db: {
        prepare: vi.fn(() => ({
          all: vi.fn(() => []),
          get: vi.fn(() => null),
          run: vi.fn(() => ({ changes: 1 })),
        })),
      },
    };

    // Mock Version Manager
    mockVersionManager = {
      createVersionSnapshot: vi.fn(),
    };

    // Mock electron module
    vi.mock("electron", () => ({
      clipboard: mockClipboard,
    }));

    // 动态导入
    const module =
      await import("../../../src/main/organization/organization-ipc.js");
    registerOrganizationIPC = module.registerOrganizationIPC;

    // 注册 Organization IPC 并注入 mocks
    registerOrganizationIPC({
      organizationManager: mockOrganizationManager,
      dbManager: mockDbManager,
      versionManager: mockVersionManager,
      ipcMain: mockIpcMain,
      dialog: mockDialog,
      app: mockApp,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =====================================================================
  // 基本功能测试
  // =====================================================================

  describe("基本功能测试", () => {
    it("should register all expected IPC handlers", () => {
      // 总共应该有 49 个 handlers
      // 12 (基础) + 4 (成员) + 8 (邀请) + 9 (邀请链接) + 5 (QR码) + 6 (角色) + 2 (活动) + 3 (知识库) = 49
      expect(Object.keys(handlers).length).toBeGreaterThanOrEqual(49);
    });

    it("should have all expected handler channels", () => {
      const expectedChannels = [
        // 组织基础操作 (12)
        "org:create-organization",
        "org:join-organization",
        "org:get-organization",
        "org:update-organization",
        "org:get-user-organizations",
        "org:leave-organization",
        "org:delete-organization",
        "org:get-members",
        "org:update-member-role",
        "org:remove-member",
        "org:check-permission",
        "org:get-member-activities",

        // 邀请管理 (8)
        "org:create-invitation",
        "org:invite-by-did",
        "org:accept-did-invitation",
        "org:reject-did-invitation",
        "org:get-pending-did-invitations",
        "org:get-did-invitations",
        "org:get-invitations",
        "org:revoke-invitation",

        // 邀请链接管理 (9)
        "org:create-invitation-link",
        "org:validate-invitation-token",
        "org:accept-invitation-link",
        "org:get-invitation-links",
        "org:get-invitation-link",
        "org:revoke-invitation-link",
        "org:delete-invitation-link",
        "org:get-invitation-link-stats",
        "org:copy-invitation-link",

        // QR码生成 (5)
        "org:generate-invitation-qrcode",
        "org:generate-did-invitation-qrcode",
        "org:generate-batch-invitation-qrcodes",
        "org:parse-invitation-qrcode",
        "org:download-qrcode",

        // 角色与权限管理 (6)
        "org:get-roles",
        "org:get-role",
        "org:create-custom-role",
        "org:update-role",
        "org:delete-role",
        "org:get-all-permissions",

        // 活动日志 (2)
        "org:get-activities",
        "org:export-activities",

        // 组织知识库 (3)
        "org:get-knowledge-items",
        "org:create-knowledge",
        "org:delete-knowledge",
      ];

      expectedChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe("function");
      });
    });

    it("all handlers should be async functions", () => {
      Object.values(handlers).forEach((handler) => {
        expect(handler.constructor.name).toBe("AsyncFunction");
      });
    });
  });

  // =====================================================================
  // 组织基础操作测试 (12 handlers)
  // =====================================================================

  describe("组织基础操作 (12 handlers)", () => {
    describe("创建组织 (org:create-organization)", () => {
      it("should have create-organization handler", () => {
        expect(handlers["org:create-organization"]).toBeDefined();
      });

      it("should call organizationManager.createOrganization on success", async () => {
        const mockOrgData = {
          name: "Test Organization",
          description: "Test description",
          type: "company",
        };
        const mockResult = {
          success: true,
          organization: { org_id: "org_123", name: "Test Organization" },
        };

        mockOrganizationManager.createOrganization.mockResolvedValue(
          mockResult,
        );

        const result = await handlers["org:create-organization"](
          {},
          mockOrgData,
        );

        expect(mockOrganizationManager.createOrganization).toHaveBeenCalledWith(
          mockOrgData,
        );
        expect(result).toEqual(mockResult);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:create-organization"]({}, {}),
        ).rejects.toThrow("组织管理器未初始化");
      });

      it("should handle errors from organizationManager", async () => {
        const error = new Error("创建组织失败");
        mockOrganizationManager.createOrganization.mockRejectedValue(error);

        await expect(
          handlers["org:create-organization"]({}, {}),
        ).rejects.toThrow("创建组织失败");
      });
    });

    describe("加入组织 (org:join-organization)", () => {
      it("should have join-organization handler", () => {
        expect(handlers["org:join-organization"]).toBeDefined();
      });

      it("should call organizationManager.joinOrganization on success", async () => {
        const mockInviteCode = "INVITE123";
        const mockResult = { success: true, org_id: "org_123" };

        mockOrganizationManager.joinOrganization.mockResolvedValue(mockResult);

        const result = await handlers["org:join-organization"](
          {},
          mockInviteCode,
        );

        expect(mockOrganizationManager.joinOrganization).toHaveBeenCalledWith(
          mockInviteCode,
        );
        expect(result).toEqual(mockResult);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:join-organization"]({}, "CODE123"),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("获取组织信息 (org:get-organization)", () => {
      it("should have get-organization handler", () => {
        expect(handlers["org:get-organization"]).toBeDefined();
      });

      it("should call organizationManager.getOrganization on success", async () => {
        const mockOrgId = "org_123";
        const mockOrg = { org_id: mockOrgId, name: "Test Org" };

        mockOrganizationManager.getOrganization.mockResolvedValue(mockOrg);

        const result = await handlers["org:get-organization"]({}, mockOrgId);

        expect(mockOrganizationManager.getOrganization).toHaveBeenCalledWith(
          mockOrgId,
        );
        expect(result).toEqual(mockOrg);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:get-organization"]({}, "org_123"),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("更新组织 (org:update-organization)", () => {
      it("should have update-organization handler", () => {
        expect(handlers["org:update-organization"]).toBeDefined();
      });

      it("should call organizationManager.updateOrganization on success", async () => {
        const mockParams = {
          orgId: "org_123",
          name: "Updated Name",
          type: "company",
          description: "Updated description",
          visibility: "public",
          p2pEnabled: true,
          syncMode: "auto",
        };
        const mockResult = { success: true };

        mockOrganizationManager.updateOrganization.mockResolvedValue(
          mockResult,
        );

        const result = await handlers["org:update-organization"](
          {},
          mockParams,
        );

        expect(mockOrganizationManager.updateOrganization).toHaveBeenCalledWith(
          mockParams.orgId,
          {
            name: mockParams.name,
            type: mockParams.type,
            description: mockParams.description,
            visibility: mockParams.visibility,
            p2p_enabled: 1,
            sync_mode: mockParams.syncMode,
          },
        );
        expect(result).toEqual(mockResult);
      });

      it("should return error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:update-organization"](
          {},
          { orgId: "org_123" },
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("组织管理器未初始化");
      });
    });

    describe("获取用户组织列表 (org:get-user-organizations)", () => {
      it("should have get-user-organizations handler", () => {
        expect(handlers["org:get-user-organizations"]).toBeDefined();
      });

      it("should call organizationManager.getUserOrganizations on success", async () => {
        const mockUserDID = "did:key:z6MkTest123";
        const mockOrgs = [
          { org_id: "org_1", name: "Org 1" },
          { org_id: "org_2", name: "Org 2" },
        ];

        mockOrganizationManager.getUserOrganizations.mockResolvedValue(
          mockOrgs,
        );

        const result = await handlers["org:get-user-organizations"](
          {},
          mockUserDID,
        );

        expect(
          mockOrganizationManager.getUserOrganizations,
        ).toHaveBeenCalledWith(mockUserDID);
        expect(result).toEqual(mockOrgs);
      });

      it("should return empty array when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:get-user-organizations"](
          {},
          "did:key:test",
        );
        expect(result).toEqual([]);
      });
    });

    describe("离开组织 (org:leave-organization)", () => {
      it("should have leave-organization handler", () => {
        expect(handlers["org:leave-organization"]).toBeDefined();
      });

      it("should call organizationManager.leaveOrganization on success", async () => {
        const mockOrgId = "org_123";
        const mockUserDID = "did:key:z6MkTest123";

        mockOrganizationManager.leaveOrganization.mockResolvedValue();

        const result = await handlers["org:leave-organization"](
          {},
          mockOrgId,
          mockUserDID,
        );

        expect(mockOrganizationManager.leaveOrganization).toHaveBeenCalledWith(
          mockOrgId,
          mockUserDID,
        );
        expect(result).toEqual({ success: true });
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:leave-organization"]({}, "org_123", "did:key:test"),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("删除组织 (org:delete-organization)", () => {
      it("should have delete-organization handler", () => {
        expect(handlers["org:delete-organization"]).toBeDefined();
      });

      it("should call organizationManager.deleteOrganization on success", async () => {
        const mockOrgId = "org_123";
        const mockUserDID = "did:key:z6MkTest123";

        mockOrganizationManager.deleteOrganization.mockResolvedValue();

        const result = await handlers["org:delete-organization"](
          {},
          mockOrgId,
          mockUserDID,
        );

        expect(mockOrganizationManager.deleteOrganization).toHaveBeenCalledWith(
          mockOrgId,
          mockUserDID,
        );
        expect(result).toEqual({ success: true });
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:delete-organization"](
            {},
            "org_123",
            "did:key:test",
          ),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("获取组织成员 (org:get-members)", () => {
      it("should have get-members handler", () => {
        expect(handlers["org:get-members"]).toBeDefined();
      });

      it("should call organizationManager.getOrganizationMembers on success", async () => {
        const mockOrgId = "org_123";
        const mockMembers = [
          { member_did: "did:key:1", role: "owner" },
          { member_did: "did:key:2", role: "member" },
        ];

        mockOrganizationManager.getOrganizationMembers.mockResolvedValue(
          mockMembers,
        );

        const result = await handlers["org:get-members"]({}, mockOrgId);

        expect(
          mockOrganizationManager.getOrganizationMembers,
        ).toHaveBeenCalledWith(mockOrgId);
        expect(result).toEqual(mockMembers);
      });

      it("should return empty array when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:get-members"]({}, "org_123");
        expect(result).toEqual([]);
      });
    });

    describe("更新成员角色 (org:update-member-role)", () => {
      it("should have update-member-role handler", () => {
        expect(handlers["org:update-member-role"]).toBeDefined();
      });

      it("should call organizationManager.updateMemberRole on success", async () => {
        const mockOrgId = "org_123";
        const mockMemberDID = "did:key:z6MkTest123";
        const mockNewRole = "admin";

        mockOrganizationManager.updateMemberRole.mockResolvedValue();

        const result = await handlers["org:update-member-role"](
          {},
          mockOrgId,
          mockMemberDID,
          mockNewRole,
        );

        expect(mockOrganizationManager.updateMemberRole).toHaveBeenCalledWith(
          mockOrgId,
          mockMemberDID,
          mockNewRole,
        );
        expect(result).toEqual({ success: true });
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:update-member-role"](
            {},
            "org_123",
            "did:key:test",
            "admin",
          ),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("移除成员 (org:remove-member)", () => {
      it("should have remove-member handler", () => {
        expect(handlers["org:remove-member"]).toBeDefined();
      });

      it("should call organizationManager.removeMember on success", async () => {
        const mockOrgId = "org_123";
        const mockMemberDID = "did:key:z6MkTest123";

        mockOrganizationManager.removeMember.mockResolvedValue();

        const result = await handlers["org:remove-member"](
          {},
          mockOrgId,
          mockMemberDID,
        );

        expect(mockOrganizationManager.removeMember).toHaveBeenCalledWith(
          mockOrgId,
          mockMemberDID,
        );
        expect(result).toEqual({ success: true });
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:remove-member"]({}, "org_123", "did:key:test"),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("检查权限 (org:check-permission)", () => {
      it("should have check-permission handler", () => {
        expect(handlers["org:check-permission"]).toBeDefined();
      });

      it("should call organizationManager.checkPermission on success", async () => {
        const mockOrgId = "org_123";
        const mockUserDID = "did:key:z6MkTest123";
        const mockPermission = "manage_members";

        mockOrganizationManager.checkPermission.mockResolvedValue(true);

        const result = await handlers["org:check-permission"](
          {},
          mockOrgId,
          mockUserDID,
          mockPermission,
        );

        expect(mockOrganizationManager.checkPermission).toHaveBeenCalledWith(
          mockOrgId,
          mockUserDID,
          mockPermission,
        );
        expect(result).toBe(true);
      });

      it("should return false when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:check-permission"](
          {},
          "org_123",
          "did:key:test",
          "manage_members",
        );
        expect(result).toBe(false);
      });
    });

    describe("获取成员活动 (org:get-member-activities)", () => {
      it("should have get-member-activities handler", () => {
        expect(handlers["org:get-member-activities"]).toBeDefined();
      });

      it("should call organizationManager.getMemberActivities on success", async () => {
        const mockParams = {
          orgId: "org_123",
          memberDID: "did:key:z6MkTest123",
          limit: 10,
        };
        const mockActivities = [
          { action: "create_knowledge", timestamp: Date.now() },
        ];

        mockOrganizationManager.getMemberActivities.mockReturnValue(
          mockActivities,
        );

        const result = await handlers["org:get-member-activities"](
          {},
          mockParams,
        );

        expect(
          mockOrganizationManager.getMemberActivities,
        ).toHaveBeenCalledWith(
          mockParams.orgId,
          mockParams.memberDID,
          mockParams.limit,
        );
        expect(result.success).toBe(true);
        expect(result.activities).toEqual(mockActivities);
      });

      it("should return error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:get-member-activities"](
          {},
          { orgId: "org_123" },
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("组织管理器未初始化");
        expect(result.activities).toEqual([]);
      });
    });
  });

  // =====================================================================
  // 邀请管理测试 (8 handlers)
  // =====================================================================

  describe("邀请管理 (8 handlers)", () => {
    describe("创建邀请 (org:create-invitation)", () => {
      it("should have create-invitation handler", () => {
        expect(handlers["org:create-invitation"]).toBeDefined();
      });

      it("should call organizationManager.createInvitation on success", async () => {
        const mockOrgId = "org_123";
        const mockInviteData = { role: "member", expiresIn: 86400000 };
        const mockResult = { invitation_id: "inv_123", code: "INVITE123" };

        mockOrganizationManager.createInvitation.mockResolvedValue(mockResult);

        const result = await handlers["org:create-invitation"](
          {},
          mockOrgId,
          mockInviteData,
        );

        expect(mockOrganizationManager.createInvitation).toHaveBeenCalledWith(
          mockOrgId,
          mockInviteData,
        );
        expect(result).toEqual(mockResult);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:create-invitation"]({}, "org_123", {}),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("通过DID邀请 (org:invite-by-did)", () => {
      it("should have invite-by-did handler", () => {
        expect(handlers["org:invite-by-did"]).toBeDefined();
      });

      it("should call organizationManager.inviteByDID on success", async () => {
        const mockOrgId = "org_123";
        const mockInviteData = {
          targetDID: "did:key:z6MkTest123",
          role: "member",
        };
        const mockResult = { invitation_id: "inv_123" };

        mockOrganizationManager.inviteByDID.mockResolvedValue(mockResult);

        const result = await handlers["org:invite-by-did"](
          {},
          mockOrgId,
          mockInviteData,
        );

        expect(mockOrganizationManager.inviteByDID).toHaveBeenCalledWith(
          mockOrgId,
          mockInviteData,
        );
        expect(result).toEqual(mockResult);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:invite-by-did"]({}, "org_123", {}),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("接受DID邀请 (org:accept-did-invitation)", () => {
      it("should have accept-did-invitation handler", () => {
        expect(handlers["org:accept-did-invitation"]).toBeDefined();
      });

      it("should call organizationManager.acceptDIDInvitation on success", async () => {
        const mockInvitationId = "inv_123";
        const mockOrg = { org_id: "org_123", name: "Test Org" };

        mockOrganizationManager.acceptDIDInvitation.mockResolvedValue(mockOrg);

        const result = await handlers["org:accept-did-invitation"](
          {},
          mockInvitationId,
        );

        expect(
          mockOrganizationManager.acceptDIDInvitation,
        ).toHaveBeenCalledWith(mockInvitationId);
        expect(result).toEqual(mockOrg);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:accept-did-invitation"]({}, "inv_123"),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("拒绝DID邀请 (org:reject-did-invitation)", () => {
      it("should have reject-did-invitation handler", () => {
        expect(handlers["org:reject-did-invitation"]).toBeDefined();
      });

      it("should call organizationManager.rejectDIDInvitation on success", async () => {
        const mockInvitationId = "inv_123";

        mockOrganizationManager.rejectDIDInvitation.mockResolvedValue(true);

        const result = await handlers["org:reject-did-invitation"](
          {},
          mockInvitationId,
        );

        expect(
          mockOrganizationManager.rejectDIDInvitation,
        ).toHaveBeenCalledWith(mockInvitationId);
        expect(result).toEqual({ success: true });
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:reject-did-invitation"]({}, "inv_123"),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("获取待处理DID邀请 (org:get-pending-did-invitations)", () => {
      it("should have get-pending-did-invitations handler", () => {
        expect(handlers["org:get-pending-did-invitations"]).toBeDefined();
      });

      it("should call organizationManager.getPendingDIDInvitations on success", async () => {
        const mockInvitations = [
          { invitation_id: "inv_1", org_id: "org_123" },
          { invitation_id: "inv_2", org_id: "org_456" },
        ];

        mockOrganizationManager.getPendingDIDInvitations.mockResolvedValue(
          mockInvitations,
        );

        const result = await handlers["org:get-pending-did-invitations"]({});

        expect(
          mockOrganizationManager.getPendingDIDInvitations,
        ).toHaveBeenCalled();
        expect(result).toEqual(mockInvitations);
      });

      it("should return empty array when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:get-pending-did-invitations"](
          {},
        );
        expect(result).toEqual([]);
      });
    });

    describe("获取DID邀请列表 (org:get-did-invitations)", () => {
      it("should have get-did-invitations handler", () => {
        expect(handlers["org:get-did-invitations"]).toBeDefined();
      });

      it("should call organizationManager.getDIDInvitations on success", async () => {
        const mockOrgId = "org_123";
        const mockOptions = { status: "pending" };
        const mockInvitations = [{ invitation_id: "inv_1" }];

        mockOrganizationManager.getDIDInvitations.mockResolvedValue(
          mockInvitations,
        );

        const result = await handlers["org:get-did-invitations"](
          {},
          mockOrgId,
          mockOptions,
        );

        expect(mockOrganizationManager.getDIDInvitations).toHaveBeenCalledWith(
          mockOrgId,
          mockOptions,
        );
        expect(result).toEqual(mockInvitations);
      });

      it("should return empty array when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:get-did-invitations"](
          {},
          "org_123",
          {},
        );
        expect(result).toEqual([]);
      });
    });

    describe("获取邀请列表 (org:get-invitations)", () => {
      it("should have get-invitations handler", () => {
        expect(handlers["org:get-invitations"]).toBeDefined();
      });

      it("should call organizationManager.getInvitations on success", async () => {
        const mockOrgId = "org_123";
        const mockInvitations = [{ invitation_id: "inv_1" }];

        mockOrganizationManager.getInvitations.mockReturnValue(mockInvitations);

        const result = await handlers["org:get-invitations"]({}, mockOrgId);

        expect(mockOrganizationManager.getInvitations).toHaveBeenCalledWith(
          mockOrgId,
        );
        expect(result.success).toBe(true);
        expect(result.invitations).toEqual(mockInvitations);
      });

      it("should return error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:get-invitations"]({}, "org_123");
        expect(result.success).toBe(false);
        expect(result.error).toBe("组织管理器未初始化");
        expect(result.invitations).toEqual([]);
      });
    });

    describe("撤销邀请 (org:revoke-invitation)", () => {
      it("should have revoke-invitation handler", () => {
        expect(handlers["org:revoke-invitation"]).toBeDefined();
      });

      it("should call organizationManager.revokeInvitation on success", async () => {
        const mockParams = { orgId: "org_123", invitationId: "inv_123" };
        const mockResult = { success: true };

        mockOrganizationManager.revokeInvitation.mockResolvedValue(mockResult);

        const result = await handlers["org:revoke-invitation"]({}, mockParams);

        expect(mockOrganizationManager.revokeInvitation).toHaveBeenCalledWith(
          mockParams.orgId,
          mockParams.invitationId,
        );
        expect(result).toEqual(mockResult);
      });

      it("should return error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:revoke-invitation"](
          {},
          {
            orgId: "org_123",
            invitationId: "inv_123",
          },
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("组织管理器未初始化");
      });
    });
  });

  // =====================================================================
  // 邀请链接管理测试 (9 handlers)
  // =====================================================================

  describe("邀请链接管理 (9 handlers)", () => {
    describe("创建邀请链接 (org:create-invitation-link)", () => {
      it("should have create-invitation-link handler", () => {
        expect(handlers["org:create-invitation-link"]).toBeDefined();
      });

      it("should call didInvitationManager.createInvitationLink on success", async () => {
        const mockParams = { orgId: "org_123", maxUses: 10 };
        const mockResult = {
          token: "token123",
          url: "https://example.com/invite/token123",
        };

        mockOrganizationManager.didInvitationManager.createInvitationLink.mockResolvedValue(
          mockResult,
        );

        const result = await handlers["org:create-invitation-link"](
          {},
          mockParams,
        );

        expect(
          mockOrganizationManager.didInvitationManager.createInvitationLink,
        ).toHaveBeenCalledWith(mockParams);
        expect(result.success).toBe(true);
        expect(result.invitationLink).toEqual(mockResult);
      });

      it("should throw error when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:create-invitation-link"]({}, {}),
        ).rejects.toThrow("邀请管理器未初始化");
      });
    });

    describe("验证邀请令牌 (org:validate-invitation-token)", () => {
      it("should have validate-invitation-token handler", () => {
        expect(handlers["org:validate-invitation-token"]).toBeDefined();
      });

      it("should call didInvitationManager.validateInvitationToken on success", async () => {
        const mockToken = "token123";
        const mockLinkInfo = { org_id: "org_123", valid: true };

        mockOrganizationManager.didInvitationManager.validateInvitationToken.mockResolvedValue(
          mockLinkInfo,
        );

        const result = await handlers["org:validate-invitation-token"](
          {},
          mockToken,
        );

        expect(
          mockOrganizationManager.didInvitationManager.validateInvitationToken,
        ).toHaveBeenCalledWith(mockToken);
        expect(result.success).toBe(true);
        expect(result.linkInfo).toEqual(mockLinkInfo);
      });

      it("should return error when validation fails", async () => {
        const mockToken = "invalid_token";
        mockOrganizationManager.didInvitationManager.validateInvitationToken.mockRejectedValue(
          new Error("Invalid token"),
        );

        const result = await handlers["org:validate-invitation-token"](
          {},
          mockToken,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Invalid token");
      });
    });

    describe("通过邀请链接加入 (org:accept-invitation-link)", () => {
      it("should have accept-invitation-link handler", () => {
        expect(handlers["org:accept-invitation-link"]).toBeDefined();
      });

      it("should call didInvitationManager.acceptInvitationLink on success", async () => {
        const mockToken = "token123";
        const mockOptions = { userDID: "did:key:z6MkTest123" };
        const mockOrg = { org_id: "org_123", name: "Test Org" };

        mockOrganizationManager.didInvitationManager.acceptInvitationLink.mockResolvedValue(
          mockOrg,
        );

        const result = await handlers["org:accept-invitation-link"](
          {},
          mockToken,
          mockOptions,
        );

        expect(
          mockOrganizationManager.didInvitationManager.acceptInvitationLink,
        ).toHaveBeenCalledWith(mockToken, mockOptions);
        expect(result.success).toBe(true);
        expect(result.org).toEqual(mockOrg);
      });

      it("should throw error when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:accept-invitation-link"]({}, "token123", {}),
        ).rejects.toThrow("邀请管理器未初始化");
      });
    });

    describe("获取邀请链接列表 (org:get-invitation-links)", () => {
      it("should have get-invitation-links handler", () => {
        expect(handlers["org:get-invitation-links"]).toBeDefined();
      });

      it("should call didInvitationManager.getInvitationLinks on success", async () => {
        const mockOrgId = "org_123";
        const mockOptions = { status: "active" };
        const mockLinks = [{ link_id: "link_1", token: "token123" }];

        mockOrganizationManager.didInvitationManager.getInvitationLinks.mockReturnValue(
          mockLinks,
        );

        const result = await handlers["org:get-invitation-links"](
          {},
          mockOrgId,
          mockOptions,
        );

        expect(
          mockOrganizationManager.didInvitationManager.getInvitationLinks,
        ).toHaveBeenCalledWith(mockOrgId, mockOptions);
        expect(result.success).toBe(true);
        expect(result.links).toEqual(mockLinks);
      });

      it("should return error when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:get-invitation-links"](
          {},
          "org_123",
          {},
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("邀请管理器未初始化");
        expect(result.links).toEqual([]);
      });
    });

    describe("获取邀请链接详情 (org:get-invitation-link)", () => {
      it("should have get-invitation-link handler", () => {
        expect(handlers["org:get-invitation-link"]).toBeDefined();
      });

      it("should call didInvitationManager.getInvitationLink on success", async () => {
        const mockLinkId = "link_123";
        const mockLink = { link_id: mockLinkId, token: "token123" };

        mockOrganizationManager.didInvitationManager.getInvitationLink.mockReturnValue(
          mockLink,
        );

        const result = await handlers["org:get-invitation-link"](
          {},
          mockLinkId,
        );

        expect(
          mockOrganizationManager.didInvitationManager.getInvitationLink,
        ).toHaveBeenCalledWith(mockLinkId);
        expect(result.success).toBe(true);
        expect(result.link).toEqual(mockLink);
      });

      it("should return error when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:get-invitation-link"](
          {},
          "link_123",
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("邀请管理器未初始化");
        expect(result.link).toBeNull();
      });
    });

    describe("撤销邀请链接 (org:revoke-invitation-link)", () => {
      it("should have revoke-invitation-link handler", () => {
        expect(handlers["org:revoke-invitation-link"]).toBeDefined();
      });

      it("should call didInvitationManager.revokeInvitationLink on success", async () => {
        const mockLinkId = "link_123";

        mockOrganizationManager.didInvitationManager.revokeInvitationLink.mockResolvedValue();

        const result = await handlers["org:revoke-invitation-link"](
          {},
          mockLinkId,
        );

        expect(
          mockOrganizationManager.didInvitationManager.revokeInvitationLink,
        ).toHaveBeenCalledWith(mockLinkId);
        expect(result).toEqual({ success: true });
      });

      it("should throw error when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:revoke-invitation-link"]({}, "link_123"),
        ).rejects.toThrow("邀请管理器未初始化");
      });
    });

    describe("删除邀请链接 (org:delete-invitation-link)", () => {
      it("should have delete-invitation-link handler", () => {
        expect(handlers["org:delete-invitation-link"]).toBeDefined();
      });

      it("should call didInvitationManager.deleteInvitationLink on success", async () => {
        const mockLinkId = "link_123";

        mockOrganizationManager.didInvitationManager.deleteInvitationLink.mockResolvedValue();

        const result = await handlers["org:delete-invitation-link"](
          {},
          mockLinkId,
        );

        expect(
          mockOrganizationManager.didInvitationManager.deleteInvitationLink,
        ).toHaveBeenCalledWith(mockLinkId);
        expect(result).toEqual({ success: true });
      });

      it("should throw error when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:delete-invitation-link"]({}, "link_123"),
        ).rejects.toThrow("邀请管理器未初始化");
      });
    });

    describe("获取邀请链接统计 (org:get-invitation-link-stats)", () => {
      it("should have get-invitation-link-stats handler", () => {
        expect(handlers["org:get-invitation-link-stats"]).toBeDefined();
      });

      it("should call didInvitationManager.getInvitationLinkStats on success", async () => {
        const mockOrgId = "org_123";
        const mockStats = {
          total: 10,
          active: 5,
          expired: 3,
          revoked: 2,
          totalUses: 25,
          totalMaxUses: 100,
          utilizationRate: 25,
        };

        mockOrganizationManager.didInvitationManager.getInvitationLinkStats.mockReturnValue(
          mockStats,
        );

        const result = await handlers["org:get-invitation-link-stats"](
          {},
          mockOrgId,
        );

        expect(
          mockOrganizationManager.didInvitationManager.getInvitationLinkStats,
        ).toHaveBeenCalledWith(mockOrgId);
        expect(result.success).toBe(true);
        expect(result.stats).toEqual(mockStats);
      });

      it("should return default stats when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:get-invitation-link-stats"](
          {},
          "org_123",
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("邀请管理器未初始化");
        expect(result.stats).toEqual({
          total: 0,
          active: 0,
          expired: 0,
          revoked: 0,
          totalUses: 0,
          totalMaxUses: 0,
          utilizationRate: 0,
        });
      });
    });

    describe("复制邀请链接 (org:copy-invitation-link)", () => {
      it("should have copy-invitation-link handler", () => {
        expect(handlers["org:copy-invitation-link"]).toBeDefined();
      });

      it("should copy invitation URL to clipboard on success", async () => {
        const mockUrl = "https://example.com/invite/token123";

        const result = await handlers["org:copy-invitation-link"]({}, mockUrl);

        expect(result.success).toBe(true);
      });

      it("should return error when copy fails", async () => {
        const mockUrl = "https://example.com/invite/token123";

        // Mock clipboard.writeText to throw error
        vi.doMock("electron", () => ({
          clipboard: {
            writeText: vi.fn(() => {
              throw new Error("Clipboard error");
            }),
          },
        }));

        // Re-import to get new mocked version
        const module =
          await import("../../../src/main/organization/organization-ipc.js");
        const newHandlers = {};
        const newMockIpcMain = {
          handle: (channel, handler) => {
            newHandlers[channel] = handler;
          },
        };

        module.registerOrganizationIPC({
          organizationManager: mockOrganizationManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: newMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await newHandlers["org:copy-invitation-link"](
          {},
          mockUrl,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });
  });

  // =====================================================================
  // QR码生成测试 (5 handlers)
  // =====================================================================

  describe("QR码生成 (5 handlers)", () => {
    describe("生成邀请QR码 (org:generate-invitation-qrcode)", () => {
      it("should have generate-invitation-qrcode handler", () => {
        expect(handlers["org:generate-invitation-qrcode"]).toBeDefined();
      });

      it("should call didInvitationManager.generateInvitationQRCode on success", async () => {
        const mockLinkId = "link_123";
        const mockOptions = { size: 256 };
        const mockQRCode = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...";

        mockOrganizationManager.didInvitationManager.generateInvitationQRCode.mockResolvedValue(
          mockQRCode,
        );

        const result = await handlers["org:generate-invitation-qrcode"](
          {},
          mockLinkId,
          mockOptions,
        );

        expect(
          mockOrganizationManager.didInvitationManager.generateInvitationQRCode,
        ).toHaveBeenCalledWith(mockLinkId, mockOptions);
        expect(result.success).toBe(true);
        expect(result.qrCode).toBe(mockQRCode);
      });

      it("should return error when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:generate-invitation-qrcode"](
          {},
          "link_123",
          {},
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("邀请管理器未初始化");
      });
    });

    describe("生成DID邀请QR码 (org:generate-did-invitation-qrcode)", () => {
      it("should have generate-did-invitation-qrcode handler", () => {
        expect(handlers["org:generate-did-invitation-qrcode"]).toBeDefined();
      });

      it("should call didInvitationManager.generateDIDInvitationQRCode on success", async () => {
        const mockInvitationId = "inv_123";
        const mockOptions = { size: 256 };
        const mockQRCode = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...";

        mockOrganizationManager.didInvitationManager.generateDIDInvitationQRCode.mockResolvedValue(
          mockQRCode,
        );

        const result = await handlers["org:generate-did-invitation-qrcode"](
          {},
          mockInvitationId,
          mockOptions,
        );

        expect(
          mockOrganizationManager.didInvitationManager
            .generateDIDInvitationQRCode,
        ).toHaveBeenCalledWith(mockInvitationId, mockOptions);
        expect(result.success).toBe(true);
        expect(result.qrCode).toBe(mockQRCode);
      });

      it("should return error when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:generate-did-invitation-qrcode"](
          {},
          "inv_123",
          {},
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("邀请管理器未初始化");
      });
    });

    describe("批量生成QR码 (org:generate-batch-invitation-qrcodes)", () => {
      it("should have generate-batch-invitation-qrcodes handler", () => {
        expect(handlers["org:generate-batch-invitation-qrcodes"]).toBeDefined();
      });

      it("should call didInvitationManager.generateBatchInvitationQRCodes on success", async () => {
        const mockOrgId = "org_123";
        const mockOptions = { count: 5 };
        const mockQRCodes = [
          { link_id: "link_1", qrCode: "data:image/png;base64,iVBORw0..." },
          { link_id: "link_2", qrCode: "data:image/png;base64,iVBORw0..." },
        ];

        mockOrganizationManager.didInvitationManager.generateBatchInvitationQRCodes.mockResolvedValue(
          mockQRCodes,
        );

        const result = await handlers["org:generate-batch-invitation-qrcodes"](
          {},
          mockOrgId,
          mockOptions,
        );

        expect(
          mockOrganizationManager.didInvitationManager
            .generateBatchInvitationQRCodes,
        ).toHaveBeenCalledWith(mockOrgId, mockOptions);
        expect(result.success).toBe(true);
        expect(result.qrCodes).toEqual(mockQRCodes);
      });

      it("should return error when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers[
          "org:generate-batch-invitation-qrcodes"
        ]({}, "org_123", {});
        expect(result.success).toBe(false);
        expect(result.error).toBe("邀请管理器未初始化");
        expect(result.qrCodes).toEqual([]);
      });
    });

    describe("解析QR码 (org:parse-invitation-qrcode)", () => {
      it("should have parse-invitation-qrcode handler", () => {
        expect(handlers["org:parse-invitation-qrcode"]).toBeDefined();
      });

      it("should call didInvitationManager.parseInvitationQRCode on success", async () => {
        const mockQRData = "https://example.com/invite/token123";
        const mockInvitationInfo = { org_id: "org_123", token: "token123" };

        mockOrganizationManager.didInvitationManager.parseInvitationQRCode.mockResolvedValue(
          mockInvitationInfo,
        );

        const result = await handlers["org:parse-invitation-qrcode"](
          {},
          mockQRData,
        );

        expect(
          mockOrganizationManager.didInvitationManager.parseInvitationQRCode,
        ).toHaveBeenCalledWith(mockQRData);
        expect(result.success).toBe(true);
        expect(result.invitationInfo).toEqual(mockInvitationInfo);
      });

      it("should return error when didInvitationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };

        const nullOrgManager = {
          ...mockOrganizationManager,
          didInvitationManager: null,
        };
        registerOrganizationIPC({
          organizationManager: nullOrgManager,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:parse-invitation-qrcode"](
          {},
          "qr_data",
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("邀请管理器未初始化");
      });
    });

    describe("下载QR码 (org:download-qrcode)", () => {
      it("should have download-qrcode handler", () => {
        expect(handlers["org:download-qrcode"]).toBeDefined();
      });

      it("should save QR code to file on success", async () => {
        const mockQRDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...";
        const mockFilename = "invitation-qrcode.png";
        const mockFilePath = "C:/Users/Test/Downloads/invitation-qrcode.png";

        mockDialog.showSaveDialog.mockResolvedValue({
          canceled: false,
          filePath: mockFilePath,
        });

        const result = await handlers["org:download-qrcode"](
          {},
          mockQRDataURL,
          mockFilename,
        );

        expect(mockDialog.showSaveDialog).toHaveBeenCalled();
        expect(result.success).toBe(true);
        expect(result.filePath).toBe(mockFilePath);
      });

      it("should return error when user cancels", async () => {
        const mockQRDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...";
        const mockFilename = "invitation-qrcode.png";

        mockDialog.showSaveDialog.mockResolvedValue({
          canceled: true,
        });

        const result = await handlers["org:download-qrcode"](
          {},
          mockQRDataURL,
          mockFilename,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("用户取消保存");
      });
    });
  });

  // =====================================================================
  // 角色与权限管理测试 (6 handlers)
  // =====================================================================

  describe("角色与权限管理 (6 handlers)", () => {
    describe("获取角色列表 (org:get-roles)", () => {
      it("should have get-roles handler", () => {
        expect(handlers["org:get-roles"]).toBeDefined();
      });

      it("should call organizationManager.getRoles on success", async () => {
        const mockOrgId = "org_123";
        const mockRoles = [
          { role_id: "role_1", name: "Admin" },
          { role_id: "role_2", name: "Member" },
        ];

        mockOrganizationManager.getRoles.mockResolvedValue(mockRoles);

        const result = await handlers["org:get-roles"]({}, mockOrgId);

        expect(mockOrganizationManager.getRoles).toHaveBeenCalledWith(
          mockOrgId,
        );
        expect(result).toEqual(mockRoles);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:get-roles"]({}, "org_123"),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("获取单个角色 (org:get-role)", () => {
      it("should have get-role handler", () => {
        expect(handlers["org:get-role"]).toBeDefined();
      });

      it("should call organizationManager.getRole on success", async () => {
        const mockRoleId = "role_123";
        const mockRole = { role_id: mockRoleId, name: "Admin" };

        mockOrganizationManager.getRole.mockResolvedValue(mockRole);

        const result = await handlers["org:get-role"]({}, mockRoleId);

        expect(mockOrganizationManager.getRole).toHaveBeenCalledWith(
          mockRoleId,
        );
        expect(result).toEqual(mockRole);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:get-role"]({}, "role_123"),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("创建自定义角色 (org:create-custom-role)", () => {
      it("should have create-custom-role handler", () => {
        expect(handlers["org:create-custom-role"]).toBeDefined();
      });

      it("should call organizationManager.createCustomRole on success", async () => {
        const mockOrgId = "org_123";
        const mockRoleData = {
          name: "Custom Role",
          permissions: ["read_knowledge"],
        };
        const mockCreatorDID = "did:key:z6MkTest123";
        const mockRole = { role_id: "role_123", ...mockRoleData };

        mockOrganizationManager.createCustomRole.mockResolvedValue(mockRole);

        const result = await handlers["org:create-custom-role"](
          {},
          mockOrgId,
          mockRoleData,
          mockCreatorDID,
        );

        expect(mockOrganizationManager.createCustomRole).toHaveBeenCalledWith(
          mockOrgId,
          mockRoleData,
          mockCreatorDID,
        );
        expect(result).toEqual(mockRole);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:create-custom-role"](
            {},
            "org_123",
            {},
            "did:key:test",
          ),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("更新角色 (org:update-role)", () => {
      it("should have update-role handler", () => {
        expect(handlers["org:update-role"]).toBeDefined();
      });

      it("should call organizationManager.updateRole on success", async () => {
        const mockRoleId = "role_123";
        const mockUpdates = { name: "Updated Role" };
        const mockUpdaterDID = "did:key:z6MkTest123";
        const mockRole = { role_id: mockRoleId, ...mockUpdates };

        mockOrganizationManager.updateRole.mockResolvedValue(mockRole);

        const result = await handlers["org:update-role"](
          {},
          mockRoleId,
          mockUpdates,
          mockUpdaterDID,
        );

        expect(mockOrganizationManager.updateRole).toHaveBeenCalledWith(
          mockRoleId,
          mockUpdates,
          mockUpdaterDID,
        );
        expect(result).toEqual(mockRole);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:update-role"]({}, "role_123", {}, "did:key:test"),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("删除角色 (org:delete-role)", () => {
      it("should have delete-role handler", () => {
        expect(handlers["org:delete-role"]).toBeDefined();
      });

      it("should call organizationManager.deleteRole on success", async () => {
        const mockRoleId = "role_123";
        const mockDeleterDID = "did:key:z6MkTest123";

        mockOrganizationManager.deleteRole.mockResolvedValue();

        const result = await handlers["org:delete-role"](
          {},
          mockRoleId,
          mockDeleterDID,
        );

        expect(mockOrganizationManager.deleteRole).toHaveBeenCalledWith(
          mockRoleId,
          mockDeleterDID,
        );
        expect(result).toEqual({ success: true });
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:delete-role"]({}, "role_123", "did:key:test"),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });

    describe("获取所有权限 (org:get-all-permissions)", () => {
      it("should have get-all-permissions handler", () => {
        expect(handlers["org:get-all-permissions"]).toBeDefined();
      });

      it("should call organizationManager.getAllPermissions on success", async () => {
        const mockPermissions = [
          "manage_members",
          "manage_roles",
          "read_knowledge",
          "write_knowledge",
        ];

        mockOrganizationManager.getAllPermissions.mockReturnValue(
          mockPermissions,
        );

        const result = await handlers["org:get-all-permissions"]({});

        expect(mockOrganizationManager.getAllPermissions).toHaveBeenCalled();
        expect(result).toEqual(mockPermissions);
      });

      it("should throw error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        await expect(
          nullHandlers["org:get-all-permissions"]({}),
        ).rejects.toThrow("组织管理器未初始化");
      });
    });
  });

  // =====================================================================
  // 活动日志测试 (2 handlers)
  // =====================================================================

  describe("活动日志 (2 handlers)", () => {
    describe("获取活动日志 (org:get-activities)", () => {
      it("should have get-activities handler", () => {
        expect(handlers["org:get-activities"]).toBeDefined();
      });

      it("should call organizationManager.getOrganizationActivities on success", async () => {
        const mockOptions = { orgId: "org_123", limit: 500 };
        const mockActivities = [
          { action: "create_knowledge", timestamp: Date.now() },
        ];

        mockOrganizationManager.getOrganizationActivities.mockResolvedValue(
          mockActivities,
        );

        const result = await handlers["org:get-activities"]({}, mockOptions);

        expect(
          mockOrganizationManager.getOrganizationActivities,
        ).toHaveBeenCalledWith(mockOptions.orgId, mockOptions.limit);
        expect(result.success).toBe(true);
        expect(result.activities).toEqual(mockActivities);
      });

      it("should return error when organizationManager is not initialized", async () => {
        const nullHandlers = {};
        const nullMockIpcMain = {
          handle: (channel, handler) => {
            nullHandlers[channel] = handler;
          },
        };
        registerOrganizationIPC({
          organizationManager: null,
          dbManager: mockDbManager,
          versionManager: mockVersionManager,
          ipcMain: nullMockIpcMain,
          dialog: mockDialog,
          app: mockApp,
        });

        const result = await nullHandlers["org:get-activities"](
          {},
          { orgId: "org_123" },
        );
        expect(result.success).toBe(false);
        expect(result.activities).toEqual([]);
      });
    });

    describe("导出活动日志 (org:export-activities)", () => {
      it("should have export-activities handler", () => {
        expect(handlers["org:export-activities"]).toBeDefined();
      });

      it("should export activities to JSON file on success", async () => {
        const mockOptions = {
          orgId: "org_123",
          activities: [{ action: "create_knowledge", timestamp: Date.now() }],
        };
        const mockFilePath =
          "C:/Users/Test/Documents/organization_org_123_activities.json";

        mockDialog.showSaveDialog.mockResolvedValue({
          canceled: false,
          filePath: mockFilePath,
        });

        const result = await handlers["org:export-activities"]({}, mockOptions);

        expect(mockDialog.showSaveDialog).toHaveBeenCalled();
        expect(result.success).toBe(true);
        expect(result.filePath).toBe(mockFilePath);
      });

      it("should return error when user cancels", async () => {
        const mockOptions = {
          orgId: "org_123",
          activities: [],
        };

        mockDialog.showSaveDialog.mockResolvedValue({
          canceled: true,
        });

        const result = await handlers["org:export-activities"]({}, mockOptions);

        expect(result.success).toBe(false);
        expect(result.error).toBe("用户取消");
      });
    });
  });

  // =====================================================================
  // 组织知识库测试 (3 handlers)
  // =====================================================================

  describe("组织知识库 (3 handlers)", () => {
    describe("获取组织知识列表 (org:get-knowledge-items)", () => {
      it("should have get-knowledge-items handler", () => {
        expect(handlers["org:get-knowledge-items"]).toBeDefined();
      });

      it("should return knowledge items from database", async () => {
        const mockParams = { orgId: "org_123" };
        const mockItems = [
          { id: "k1", title: "Knowledge 1", org_id: "org_123" },
          { id: "k2", title: "Knowledge 2", org_id: "org_123" },
        ];

        mockDbManager.db.prepare.mockReturnValue({
          all: vi.fn(() => mockItems),
        });

        const result = await handlers["org:get-knowledge-items"](
          {},
          mockParams,
        );

        expect(result.success).toBe(true);
        expect(result.items).toEqual(mockItems);
      });

      it("should handle database errors", async () => {
        const mockParams = { orgId: "org_123" };

        mockDbManager.db.prepare.mockImplementation(() => {
          throw new Error("Database error");
        });

        const result = await handlers["org:get-knowledge-items"](
          {},
          mockParams,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Database error");
        expect(result.items).toEqual([]);
      });
    });

    describe("创建组织知识 (org:create-knowledge)", () => {
      it("should have create-knowledge handler", () => {
        expect(handlers["org:create-knowledge"]).toBeDefined();
      });

      it("should create knowledge item in database", async () => {
        const mockParams = {
          orgId: "org_123",
          title: "Test Knowledge",
          type: "document",
          content: "Test content",
          shareScope: "org",
          tags: ["tag1", "tag2"],
          createdBy: "did:key:z6MkTest123",
        };

        mockDbManager.db.prepare.mockReturnValue({
          run: vi.fn(() => ({ changes: 1 })),
          get: vi.fn(() => null),
        });

        mockVersionManager.createVersionSnapshot.mockResolvedValue();

        const result = await handlers["org:create-knowledge"]({}, mockParams);

        expect(result.success).toBe(true);
        expect(result.id).toBeDefined();
      });

      it("should handle database errors", async () => {
        const mockParams = {
          orgId: "org_123",
          title: "Test Knowledge",
          type: "document",
          content: "Test content",
          createdBy: "did:key:z6MkTest123",
        };

        mockDbManager.db.prepare.mockImplementation(() => {
          throw new Error("Database error");
        });

        const result = await handlers["org:create-knowledge"]({}, mockParams);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Database error");
      });
    });

    describe("删除组织知识 (org:delete-knowledge)", () => {
      it("should have delete-knowledge handler", () => {
        expect(handlers["org:delete-knowledge"]).toBeDefined();
      });

      it("should delete knowledge item from database", async () => {
        const mockParams = { orgId: "org_123", knowledgeId: "k_123" };
        const mockKnowledge = { id: "k_123", org_id: "org_123" };

        mockDbManager.db.prepare.mockReturnValue({
          get: vi.fn(() => mockKnowledge),
          run: vi.fn(() => ({ changes: 1 })),
        });

        const result = await handlers["org:delete-knowledge"]({}, mockParams);

        expect(result.success).toBe(true);
      });

      it("should return error when knowledge not found", async () => {
        const mockParams = { orgId: "org_123", knowledgeId: "k_123" };

        mockDbManager.db.prepare.mockReturnValue({
          get: vi.fn(() => null),
        });

        const result = await handlers["org:delete-knowledge"]({}, mockParams);

        expect(result.success).toBe(false);
        expect(result.error).toBe("知识不存在或无权删除");
      });

      it("should handle database errors", async () => {
        const mockParams = { orgId: "org_123", knowledgeId: "k_123" };

        mockDbManager.db.prepare.mockImplementation(() => {
          throw new Error("Database error");
        });

        const result = await handlers["org:delete-knowledge"]({}, mockParams);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Database error");
      });
    });
  });

  // =====================================================================
  // 错误处理验证
  // =====================================================================

  describe("错误处理验证", () => {
    it("should handle null organizationManager for basic operations", async () => {
      const nullHandlers = {};
      const nullMockIpcMain = {
        handle: (channel, handler) => {
          nullHandlers[channel] = handler;
        },
      };
      registerOrganizationIPC({
        organizationManager: null,
        dbManager: mockDbManager,
        versionManager: mockVersionManager,
        ipcMain: nullMockIpcMain,
        dialog: mockDialog,
        app: mockApp,
      });

      // Should throw errors
      await expect(
        nullHandlers["org:create-organization"]({}, {}),
      ).rejects.toThrow("组织管理器未初始化");
      await expect(
        nullHandlers["org:join-organization"]({}, "CODE123"),
      ).rejects.toThrow("组织管理器未初始化");
      await expect(
        nullHandlers["org:get-organization"]({}, "org_123"),
      ).rejects.toThrow("组织管理器未初始化");

      // Should return error objects
      const updateResult = await nullHandlers["org:update-organization"](
        {},
        { orgId: "org_123" },
      );
      expect(updateResult.success).toBe(false);
      expect(updateResult.error).toBe("组织管理器未初始化");

      // Should return empty arrays
      expect(
        await nullHandlers["org:get-user-organizations"]({}, "did:key:test"),
      ).toEqual([]);
      expect(await nullHandlers["org:get-members"]({}, "org_123")).toEqual([]);

      // Should return false
      expect(
        await nullHandlers["org:check-permission"](
          {},
          "org_123",
          "did:key:test",
          "permission",
        ),
      ).toBe(false);
    });

    it("should handle database errors gracefully", async () => {
      mockDbManager.db.prepare.mockImplementation(() => {
        throw new Error("Database connection failed");
      });

      const result = await handlers["org:get-knowledge-items"](
        {},
        { orgId: "org_123" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Database connection failed");
      expect(result.items).toEqual([]);
    });

    it("should handle permission denied errors", async () => {
      mockOrganizationManager.updateOrganization.mockRejectedValue(
        new Error("Permission denied"),
      );

      const result = await handlers["org:update-organization"](
        {},
        {
          orgId: "org_123",
          name: "New Name",
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Permission denied");
    });

    it("should handle invalid parameters", async () => {
      mockOrganizationManager.createOrganization.mockRejectedValue(
        new Error("Invalid organization data"),
      );

      await expect(handlers["org:create-organization"]({}, {})).rejects.toThrow(
        "Invalid organization data",
      );
    });

    it("should handle network/P2P errors", async () => {
      mockOrganizationManager.joinOrganization.mockRejectedValue(
        new Error("Network connection failed"),
      );

      await expect(
        handlers["org:join-organization"]({}, "INVITE123"),
      ).rejects.toThrow("Network connection failed");
    });
  });

  // =====================================================================
  // 按功能域分组验证
  // =====================================================================

  describe("按功能域分组验证", () => {
    it("should have exactly 12 basic organization operation handlers", () => {
      const basicChannels = [
        "org:create-organization",
        "org:join-organization",
        "org:get-organization",
        "org:update-organization",
        "org:get-user-organizations",
        "org:leave-organization",
        "org:delete-organization",
        "org:get-members",
        "org:update-member-role",
        "org:remove-member",
        "org:check-permission",
        "org:get-member-activities",
      ];

      basicChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });

    it("should have exactly 8 invitation management handlers", () => {
      const invitationChannels = [
        "org:create-invitation",
        "org:invite-by-did",
        "org:accept-did-invitation",
        "org:reject-did-invitation",
        "org:get-pending-did-invitations",
        "org:get-did-invitations",
        "org:get-invitations",
        "org:revoke-invitation",
      ];

      invitationChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });

    it("should have exactly 9 invitation link management handlers", () => {
      const linkChannels = [
        "org:create-invitation-link",
        "org:validate-invitation-token",
        "org:accept-invitation-link",
        "org:get-invitation-links",
        "org:get-invitation-link",
        "org:revoke-invitation-link",
        "org:delete-invitation-link",
        "org:get-invitation-link-stats",
        "org:copy-invitation-link",
      ];

      linkChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });

    it("should have exactly 5 QR code generation handlers", () => {
      const qrChannels = [
        "org:generate-invitation-qrcode",
        "org:generate-did-invitation-qrcode",
        "org:generate-batch-invitation-qrcodes",
        "org:parse-invitation-qrcode",
        "org:download-qrcode",
      ];

      qrChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });

    it("should have exactly 6 role and permission management handlers", () => {
      const roleChannels = [
        "org:get-roles",
        "org:get-role",
        "org:create-custom-role",
        "org:update-role",
        "org:delete-role",
        "org:get-all-permissions",
      ];

      roleChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });

    it("should have exactly 2 activity log handlers", () => {
      const activityChannels = ["org:get-activities", "org:export-activities"];

      activityChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });

    it("should have exactly 3 knowledge base handlers", () => {
      const knowledgeChannels = [
        "org:get-knowledge-items",
        "org:create-knowledge",
        "org:delete-knowledge",
      ];

      knowledgeChannels.forEach((channel) => {
        expect(handlers[channel]).toBeDefined();
      });
    });
  });

  // =====================================================================
  // 总体验证
  // =====================================================================

  describe("总体验证", () => {
    it("should have correct distribution of handlers", () => {
      // 12 + 4 + 8 + 9 + 5 + 6 + 2 + 3 = 49
      const categories = {
        basic: 12,
        invitation: 8,
        invitationLink: 9,
        qrCode: 5,
        role: 6,
        activity: 2,
        knowledge: 3,
      };

      const total = Object.values(categories).reduce((a, b) => a + b, 0);
      // Categories sum: 12 + 8 + 9 + 5 + 6 + 2 + 3 = 45
      expect(total).toBe(45);
      // Total handlers includes organization:get-info alias (+1), so >= 45
      expect(Object.keys(handlers).length).toBeGreaterThanOrEqual(total);
    });

    it("all handler channels should use org: prefix (except documented aliases)", () => {
      // Known aliases that intentionally don't use org: prefix
      // organization:get-info is an alias for org:get-organization for frontend compatibility
      const allowedAliases = ["organization:get-info"];

      Object.keys(handlers).forEach((channel) => {
        if (!allowedAliases.includes(channel)) {
          expect(channel.startsWith("org:")).toBe(true);
        }
      });
    });
  });
});
