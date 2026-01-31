import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import PermissionManagementPage from "@renderer/pages/PermissionManagementPage.vue";

// Mock stores
const mockIdentityStore = {
  currentOrgId: "org-123",
  currentDID: "did:chainless:user123",
};

vi.mock("@/stores/identity", () => ({
  useIdentityStore: () => mockIdentityStore,
}));

// Mock ant-design-vue
vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock vue-router
const mockRouter = {
  back: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: {},
  }),
  useRouter: () => mockRouter,
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
  })),
}));

// Mock Electron IPC
global.window = {
  electron: {
    ipcRenderer: {
      invoke: vi.fn(),
    },
  },
};

describe("PermissionManagementPage.vue", () => {
  let wrapper;

  const mockOverrides = [
    {
      id: "override-1",
      targetType: "user",
      targetId: "user-1",
      permission: "knowledge.edit",
      effect: "allow",
    },
    {
      id: "override-2",
      targetType: "role",
      targetId: "role-1",
      permission: "project.delete",
      effect: "deny",
    },
  ];

  const mockTemplates = [
    {
      id: "template-1",
      templateName: "Admin Template",
      templateType: "role",
      permissions: ["org.manage", "member.manage", "knowledge.manage"],
    },
    {
      id: "template-2",
      templateName: "Editor Template",
      templateType: "role",
      permissions: ["knowledge.edit", "knowledge.create"],
    },
  ];

  const mockGroups = [
    {
      id: "group-1",
      name: "Content Editors",
      permissions: ["knowledge.edit", "knowledge.create"],
    },
    {
      id: "group-2",
      name: "Project Managers",
      permissions: ["project.manage", "project.create"],
    },
  ];

  const mockStatistics = {
    totalRoles: 5,
    totalUsers: 20,
    totalPermissions: 50,
    mostUsedPermission: "knowledge.view",
  };

  const mockAuditLogs = [
    {
      id: "log-1",
      action: "permission.grant",
      targetUser: "user-1",
      permission: "knowledge.edit",
      timestamp: "2024-01-01T12:00:00Z",
      operator: "admin-1",
    },
    {
      id: "log-2",
      action: "permission.revoke",
      targetUser: "user-2",
      permission: "project.delete",
      timestamp: "2024-01-02T14:00:00Z",
      operator: "admin-1",
    },
  ];

  const createWrapper = () => {
    return mount(PermissionManagementPage, {
      global: {
        stubs: {
          "a-page-header": {
            template: "<div><slot /></div>",
            props: ["title", "subTitle"],
          },
          "a-button": { template: "<button><slot /></button>" },
          "a-tabs": { template: "<div><slot /></div>" },
          "a-tab-pane": { template: "<div><slot /></div>" },
          "a-modal": { template: "<div><slot /></div>" },
          "a-form": { template: "<div><slot /></div>" },
          "a-form-item": { template: "<div><slot /></div>" },
          "a-input": { template: "<input />" },
          "a-textarea": { template: "<textarea />" },
          "a-select": { template: "<div><slot /></div>" },
          "a-select-option": { template: "<option />" },
          "a-select-opt-group": { template: "<optgroup><slot /></optgroup>" },
          RolePermissionsTab: { template: "<div>RolePermissionsTab</div>" },
          ResourcePermissionsTab: {
            template: "<div>ResourcePermissionsTab</div>",
          },
          PermissionOverridesTab: {
            template: "<div>PermissionOverridesTab</div>",
          },
          PermissionTemplatesTab: {
            template: "<div>PermissionTemplatesTab</div>",
          },
          PermissionGroupsTab: { template: "<div>PermissionGroupsTab</div>" },
          PermissionStatisticsTab: {
            template: "<div>PermissionStatisticsTab</div>",
          },
          PermissionAuditLog: { template: "<div>PermissionAuditLog</div>" },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // 组件挂载测试
  describe("Component Mounting", () => {
    it("应该正确挂载组件", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("应该在挂载时加载数据", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        overrides: [],
        templates: [],
        groups: [],
        statistics: {},
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-overrides",
        expect.objectContaining({
          orgId: "org-123",
        }),
      );
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-templates",
        expect.objectContaining({
          orgId: "org-123",
        }),
      );
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-groups",
        expect.objectContaining({
          orgId: "org-123",
        }),
      );
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-statistics",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
        }),
      );
    });

    it("应该初始化为角色权限标签页", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.activeTab).toBe("roles");
    });
  });

  // 计算属性测试
  describe("Computed Properties", () => {
    it("应该从identity store获取orgId", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.orgId).toBe("org-123");
    });

    it("应该从identity store获取userDID", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.userDID).toBe("did:chainless:user123");
    });
  });

  // 加载权限覆盖测试
  describe("Load Overrides", () => {
    it("应该加载权限覆盖列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        overrides: mockOverrides,
      });

      wrapper = createWrapper();

      await wrapper.vm.loadOverrides();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-overrides",
        expect.objectContaining({
          orgId: "org-123",
        }),
      );
      expect(wrapper.vm.overrides).toEqual(mockOverrides);
    });

    it("应该处理加载失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      wrapper = createWrapper();
      const { logger } = require("@/utils/logger");

      await wrapper.vm.loadOverrides();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  // 加载权限模板测试
  describe("Load Templates", () => {
    it("应该加载权限模板列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        templates: mockTemplates,
      });

      wrapper = createWrapper();

      await wrapper.vm.loadTemplates();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-templates",
        expect.objectContaining({
          orgId: "org-123",
        }),
      );
      expect(wrapper.vm.templates).toEqual(mockTemplates);
    });

    it("应该处理加载失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      wrapper = createWrapper();
      const { logger } = require("@/utils/logger");

      await wrapper.vm.loadTemplates();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  // 加载权限组测试
  describe("Load Groups", () => {
    it("应该加载权限组列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        groups: mockGroups,
      });

      wrapper = createWrapper();

      await wrapper.vm.loadGroups();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-groups",
        expect.objectContaining({
          orgId: "org-123",
        }),
      );
      expect(wrapper.vm.groups).toEqual(mockGroups);
    });

    it("应该处理加载失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      wrapper = createWrapper();
      const { logger } = require("@/utils/logger");

      await wrapper.vm.loadGroups();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  // 加载统计数据测试
  describe("Load Statistics", () => {
    it("应该加载统计数据", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        statistics: mockStatistics,
      });

      wrapper = createWrapper();

      await wrapper.vm.loadStatistics();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-statistics",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
        }),
      );
      expect(wrapper.vm.statistics).toEqual(mockStatistics);
    });

    it("应该处理加载失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      wrapper = createWrapper();
      const { logger } = require("@/utils/logger");

      await wrapper.vm.loadStatistics();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  // 加载审计日志测试
  describe("Load Audit Logs", () => {
    it("应该加载审计日志", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        logs: mockAuditLogs,
      });

      wrapper = createWrapper();

      await wrapper.vm.loadAuditLogs();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-audit-log",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
        }),
      );
      expect(wrapper.vm.auditLogs).toEqual(mockAuditLogs);
    });

    it("应该支持自定义选项", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        logs: [],
      });

      wrapper = createWrapper();

      await wrapper.vm.loadAuditLogs({ limit: 50, offset: 10 });

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-audit-log",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
          limit: 50,
          offset: 10,
        }),
      );
    });

    it("应该处理加载失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("加载失败"),
      );

      wrapper = createWrapper();
      const { logger } = require("@/utils/logger");

      await wrapper.vm.loadAuditLogs();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  // 显示模态框测试
  describe("Show Modals", () => {
    it("应该能显示创建模板对话框", () => {
      wrapper = createWrapper();

      wrapper.vm.showCreateTemplateModal();

      expect(wrapper.vm.createTemplateVisible).toBe(true);
    });

    it("应该能显示审计日志对话框", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        logs: mockAuditLogs,
      });

      wrapper = createWrapper();

      await wrapper.vm.showAuditLogModal();

      expect(wrapper.vm.auditLogVisible).toBe(true);
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-audit-log",
        expect.objectContaining({
          limit: 100,
        }),
      );
    });
  });

  // 创建权限模板测试
  describe("Create Template", () => {
    it("应该能创建权限模板", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      wrapper.vm.templateForm.templateName = "New Template";
      wrapper.vm.templateForm.templateType = "role";
      wrapper.vm.templateForm.description = "Template description";
      wrapper.vm.templateForm.permissions = ["org.view", "member.view"];

      await wrapper.vm.handleCreateTemplateSubmit();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:create-template",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
          templateName: "New Template",
          templateType: "role",
          description: "Template description",
          permissions: ["org.view", "member.view"],
        }),
      );
      expect(message.success).toHaveBeenCalledWith("权限模板创建成功");
      expect(wrapper.vm.createTemplateVisible).toBe(false);
    });

    it("应该在成功后重置表单", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();

      wrapper.vm.templateForm.templateName = "New Template";
      wrapper.vm.templateForm.templateType = "role";
      wrapper.vm.templateForm.description = "Description";
      wrapper.vm.templateForm.permissions = ["org.view"];

      await wrapper.vm.handleCreateTemplateSubmit();

      expect(wrapper.vm.templateForm.templateName).toBe("");
      expect(wrapper.vm.templateForm.templateType).toBe("role");
      expect(wrapper.vm.templateForm.description).toBe("");
      expect(wrapper.vm.templateForm.permissions).toEqual([]);
    });

    it("应该处理创建失败", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
        error: "创建失败",
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      wrapper.vm.templateForm.templateName = "New Template";

      await wrapper.vm.handleCreateTemplateSubmit();

      expect(message.error).toHaveBeenCalledWith("创建失败");
    });

    it("应该处理异常错误", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Network error"),
      );

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");
      const { logger } = require("@/utils/logger");

      wrapper.vm.templateForm.templateName = "New Template";

      await wrapper.vm.handleCreateTemplateSubmit();

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith("创建失败");
    });

    it("应该在创建后刷新模板列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        templates: mockTemplates,
      });

      wrapper = createWrapper();

      wrapper.vm.templateForm.templateName = "New Template";

      await wrapper.vm.handleCreateTemplateSubmit();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-templates",
        expect.any(Object),
      );
    });
  });

  // 创建权限覆盖测试
  describe("Create Override", () => {
    it("应该能创建权限覆盖", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      const override = {
        targetType: "user",
        targetId: "user-1",
        permission: "knowledge.edit",
        effect: "allow",
      };

      await wrapper.vm.handleCreateOverride(override);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:create-override",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
          ...override,
        }),
      );
      expect(message.success).toHaveBeenCalledWith("权限覆盖创建成功");
    });

    it("应该处理创建失败", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
        error: "创建失败",
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleCreateOverride({});

      expect(message.error).toHaveBeenCalledWith("创建失败");
    });

    it("应该在创建后刷新覆盖列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        overrides: mockOverrides,
      });

      wrapper = createWrapper();

      await wrapper.vm.handleCreateOverride({
        targetType: "user",
        targetId: "user-1",
        permission: "knowledge.edit",
        effect: "allow",
      });

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-overrides",
        expect.any(Object),
      );
    });
  });

  // 删除权限覆盖测试
  describe("Delete Override", () => {
    it("应该能删除权限覆盖", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleDeleteOverride("override-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:delete-override",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
          overrideId: "override-1",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("权限覆盖已删除");
    });

    it("应该处理删除失败", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
        error: "删除失败",
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleDeleteOverride("override-1");

      expect(message.error).toHaveBeenCalledWith("删除失败");
    });

    it("应该在删除后刷新覆盖列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        overrides: [],
      });

      wrapper = createWrapper();

      await wrapper.vm.handleDeleteOverride("override-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-overrides",
        expect.any(Object),
      );
    });
  });

  // 应用权限模板测试
  describe("Apply Template", () => {
    it("应该能应用权限模板", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleApplyTemplate("template-1", "role", "role-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:apply-template",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
          templateId: "template-1",
          targetType: "role",
          targetId: "role-1",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("权限模板应用成功");
    });

    it("应该处理应用失败", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
        error: "应用失败",
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleApplyTemplate("template-1", "role", "role-1");

      expect(message.error).toHaveBeenCalledWith("应用失败");
    });

    it("应该在应用后刷新数据", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();

      await wrapper.vm.handleApplyTemplate("template-1", "role", "role-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-overrides",
        expect.any(Object),
      );
    });
  });

  // 创建权限组测试
  describe("Create Group", () => {
    it("应该能创建权限组", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      const group = {
        name: "New Group",
        permissions: ["knowledge.view", "knowledge.edit"],
      };

      await wrapper.vm.handleCreateGroup(group);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:create-group",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
          ...group,
        }),
      );
      expect(message.success).toHaveBeenCalledWith("权限组创建成功");
    });

    it("应该处理创建失败", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
        error: "创建失败",
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleCreateGroup({});

      expect(message.error).toHaveBeenCalledWith("创建失败");
    });

    it("应该在创建后刷新权限组列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        groups: mockGroups,
      });

      wrapper = createWrapper();

      await wrapper.vm.handleCreateGroup({
        name: "New Group",
        permissions: [],
      });

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-groups",
        expect.any(Object),
      );
    });
  });

  // 分配权限组测试
  describe("Assign Group", () => {
    it("应该能分配权限组", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleAssignGroup("admin", "group-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:assign-group",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
          roleName: "admin",
          groupId: "group-1",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("权限组分配成功");
    });

    it("应该处理分配失败", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
        error: "分配失败",
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleAssignGroup("admin", "group-1");

      expect(message.error).toHaveBeenCalledWith("分配失败");
    });

    it("应该在分配后刷新数据", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();

      await wrapper.vm.handleAssignGroup("admin", "group-1");

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-overrides",
        expect.any(Object),
      );
    });
  });

  // 模板表单测试
  describe("Template Form", () => {
    it("应该初始化默认表单值", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.templateForm.templateName).toBe("");
      expect(wrapper.vm.templateForm.templateType).toBe("role");
      expect(wrapper.vm.templateForm.description).toBe("");
      expect(wrapper.vm.templateForm.permissions).toEqual([]);
    });

    it("应该能更新表单值", () => {
      wrapper = createWrapper();

      wrapper.vm.templateForm.templateName = "Test Template";
      wrapper.vm.templateForm.templateType = "resource";
      wrapper.vm.templateForm.description = "Test description";
      wrapper.vm.templateForm.permissions = ["org.view", "member.view"];

      expect(wrapper.vm.templateForm.templateName).toBe("Test Template");
      expect(wrapper.vm.templateForm.templateType).toBe("resource");
      expect(wrapper.vm.templateForm.description).toBe("Test description");
      expect(wrapper.vm.templateForm.permissions).toEqual([
        "org.view",
        "member.view",
      ]);
    });
  });

  // 加载状态测试
  describe("Loading State", () => {
    it("应该初始化为未加载状态", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.loading).toBe(false);
    });

    it("应该在创建模板时显示加载状态", async () => {
      wrapper = createWrapper();

      window.electron.ipcRenderer.invoke.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ success: true }), 100);
          }),
      );

      wrapper.vm.templateForm.templateName = "New Template";

      const promise = wrapper.vm.handleCreateTemplateSubmit();
      expect(wrapper.vm.loading).toBe(true);

      await promise;
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  // 边界情况测试
  describe("Edge Cases", () => {
    it("应该处理空的审计日志选项", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        logs: [],
      });

      wrapper = createWrapper();

      await wrapper.vm.loadAuditLogs({});

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:get-audit-log",
        expect.objectContaining({
          orgId: "org-123",
          userDID: "did:chainless:user123",
        }),
      );
    });

    it("应该处理IPC返回非success状态", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
      });

      wrapper = createWrapper();

      await wrapper.vm.loadOverrides();

      expect(wrapper.vm.overrides).toEqual([]);
    });

    it("应该处理异常错误", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Network error"),
      );

      wrapper = createWrapper();
      const { logger } = require("@/utils/logger");

      await wrapper.vm.loadTemplates();

      expect(logger.error).toHaveBeenCalled();
    });

    it("应该处理handleCreateTemplate方法", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
      });

      wrapper = createWrapper();

      wrapper.vm.templateForm.templateName = "New Template";

      await wrapper.vm.handleCreateTemplate({});

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "permission:create-template",
        expect.any(Object),
      );
    });

    it("应该处理空的错误消息", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
      });

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleCreateOverride({});

      expect(message.error).toHaveBeenCalledWith("创建失败");
    });

    it("应该处理空的group参数", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Invalid group"),
      );

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");
      const { logger } = require("@/utils/logger");

      await wrapper.vm.handleCreateGroup(null);

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith("创建失败");
    });

    it("应该处理空的override参数", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Invalid override"),
      );

      wrapper = createWrapper();
      const { message } = require("ant-design-vue");
      const { logger } = require("@/utils/logger");

      await wrapper.vm.handleCreateOverride(null);

      expect(logger.error).toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith("创建失败");
    });
  });

  // 标签页切换测试
  describe("Tab Switching", () => {
    it("应该能切换到资源权限标签页", async () => {
      wrapper = createWrapper();

      wrapper.vm.activeTab = "resources";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe("resources");
    });

    it("应该能切换到权限覆盖标签页", async () => {
      wrapper = createWrapper();

      wrapper.vm.activeTab = "overrides";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe("overrides");
    });

    it("应该能切换到权限模板标签页", async () => {
      wrapper = createWrapper();

      wrapper.vm.activeTab = "templates";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe("templates");
    });

    it("应该能切换到权限组标签页", async () => {
      wrapper = createWrapper();

      wrapper.vm.activeTab = "groups";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe("groups");
    });

    it("应该能切换到统计分析标签页", async () => {
      wrapper = createWrapper();

      wrapper.vm.activeTab = "statistics";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe("statistics");
    });
  });
});
