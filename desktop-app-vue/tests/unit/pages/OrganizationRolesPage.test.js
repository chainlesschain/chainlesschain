import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import OrganizationRolesPage from "@renderer/pages/OrganizationRolesPage.vue";

// Mock ant-design-vue
vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
  Modal: {
    confirm: vi.fn((config) => {
      if (config.onOk) {
        config.onOk();
      }
    }),
  },
}));

// Mock identity store
const mockIdentityStore = {
  primaryDID: "did:chainlesschain:currentuser",
  currentOrgId: "org-123",
  isOrganizationContext: true,
};

vi.mock("../stores/identity", () => ({
  useIdentityStore: () => mockIdentityStore,
}));

// Mock components
vi.mock("../components/PermissionGuard.vue", () => ({
  default: { template: "<div><slot /></div>" },
}));

vi.mock("../components/RoleCard.vue", () => ({
  default: { template: '<div class="role-card"></div>' },
}));

// Mock window.electron.ipcRenderer
const mockBuiltinRoles = [
  {
    id: "role-1",
    name: "所有者",
    description: "拥有所有权限",
    permissions: ["all"],
    is_builtin: true,
    created_at: 1704067200000,
  },
  {
    id: "role-2",
    name: "管理员",
    description: "管理组织",
    permissions: ["member.manage", "role.create"],
    is_builtin: true,
    created_at: 1704067200000,
  },
  {
    id: "role-3",
    name: "成员",
    description: "普通成员",
    permissions: ["knowledge.read", "knowledge.write"],
    is_builtin: true,
    created_at: 1704067200000,
  },
];

const mockCustomRoles = [
  {
    id: "custom-1",
    name: "项目经理",
    description: "管理项目",
    permissions: ["project.manage", "member.view"],
    is_builtin: false,
    created_at: 1704153600000,
  },
];

const mockAllPermissions = [
  {
    category: "成员管理",
    permissions: [
      {
        value: "member.view",
        label: "查看成员",
        description: "可以查看组织成员列表",
      },
      {
        value: "member.manage",
        label: "管理成员",
        description: "可以添加、移除和修改成员",
      },
    ],
  },
  {
    category: "角色管理",
    permissions: [
      {
        value: "role.create",
        label: "创建角色",
        description: "可以创建自定义角色",
      },
      {
        value: "role.edit",
        label: "编辑角色",
        description: "可以编辑角色权限",
      },
    ],
  },
  {
    category: "知识库",
    permissions: [
      {
        value: "knowledge.read",
        label: "读取知识库",
        description: "可以查看知识库内容",
      },
      {
        value: "knowledge.write",
        label: "编辑知识库",
        description: "可以创建和编辑知识库",
      },
    ],
  },
];

global.window = global.window || {};
global.window.electron = {
  ipcRenderer: {
    invoke: vi.fn(),
  },
};

describe("OrganizationRolesPage.vue", () => {
  let wrapper;

  const createWrapper = (props = {}) => {
    return mount(OrganizationRolesPage, {
      props,
      global: {
        stubs: {
          PermissionGuard: true,
          RoleCard: true,
          "a-button": true,
          "a-spin": true,
          "a-row": true,
          "a-col": true,
          "a-empty": true,
          "a-modal": true,
          "a-form": true,
          "a-form-item": true,
          "a-input": true,
          "a-textarea": true,
          "a-collapse": true,
          "a-collapse-panel": true,
          "a-checkbox-group": true,
          "a-checkbox": true,
          "a-descriptions": true,
          "a-descriptions-item": true,
          "a-tag": true,
          PlusOutlined: true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electron.ipcRenderer.invoke.mockImplementation(
      (channel, ...args) => {
        if (channel === "org:get-roles") {
          return Promise.resolve([...mockBuiltinRoles, ...mockCustomRoles]);
        }
        if (channel === "org:get-all-permissions") {
          return Promise.resolve(mockAllPermissions);
        }
        return Promise.resolve();
      },
    );
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // 组件挂载和初始化
  describe("Component Mounting and Initialization", () => {
    it("应该成功挂载组件", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("应该在挂载时加载角色列表", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-roles",
        "org-123",
      );
      expect(wrapper.vm.roles.length).toBe(4);
    });

    it("应该在挂载时加载权限列表", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-all-permissions",
      );
      expect(wrapper.vm.allPermissions).toEqual(mockAllPermissions);
    });

    it("应该默认展开第一个权限分类", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activePermissionCategories).toContain("成员管理");
    });

    it("应该处理未选择组织的情况", async () => {
      mockIdentityStore.currentOrgId = null;
      const { message } = require("ant-design-vue");
      wrapper = createWrapper();

      await wrapper.vm.loadRoles();

      expect(message.error).toHaveBeenCalledWith("未选择组织");
      mockIdentityStore.currentOrgId = "org-123";
    });

    it("应该处理加载角色失败", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Load failed"),
      );
      const { message } = require("ant-design-vue");
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(message.error).toHaveBeenCalledWith("Load failed");
    });

    it("应该处理加载权限失败", async () => {
      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "org:get-roles") {
          return Promise.resolve([]);
        }
        if (channel === "org:get-all-permissions") {
          return Promise.reject(new Error("Failed"));
        }
      });
      const { message } = require("ant-design-vue");
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(message.error).toHaveBeenCalledWith("加载权限列表失败");
    });
  });

  // 角色分类
  describe("Role Categories", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该正确分类内置角色", () => {
      expect(wrapper.vm.builtinRoles.length).toBe(3);
      expect(wrapper.vm.builtinRoles.every((r) => r.is_builtin)).toBe(true);
    });

    it("应该正确分类自定义角色", () => {
      expect(wrapper.vm.customRoles.length).toBe(1);
      expect(wrapper.vm.customRoles.every((r) => !r.is_builtin)).toBe(true);
    });

    it("应该处理只有内置角色的情况", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue(mockBuiltinRoles);
      wrapper = createWrapper();
      await wrapper.vm.loadRoles();

      expect(wrapper.vm.builtinRoles.length).toBe(3);
      expect(wrapper.vm.customRoles.length).toBe(0);
    });

    it("应该处理空角色列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue([]);
      wrapper = createWrapper();
      await wrapper.vm.loadRoles();

      expect(wrapper.vm.builtinRoles.length).toBe(0);
      expect(wrapper.vm.customRoles.length).toBe(0);
    });

    it("应该处理角色列表为null", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue(null);
      wrapper = createWrapper();
      await wrapper.vm.loadRoles();

      expect(wrapper.vm.roles).toEqual([]);
    });
  });

  // 创建角色
  describe("Create Role", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能打开创建角色对话框", () => {
      wrapper.vm.showCreateRoleModal();

      expect(wrapper.vm.isEditMode).toBe(false);
      expect(wrapper.vm.roleModalVisible).toBe(true);
      expect(wrapper.vm.roleForm.name).toBe("");
      expect(wrapper.vm.roleForm.permissions).toEqual([]);
    });

    it("应该能创建自定义角色", async () => {
      const { message } = require("ant-design-vue");
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      wrapper.vm.roleModalVisible = true;
      wrapper.vm.roleForm = {
        name: "技术专家",
        description: "负责技术决策",
        permissions: ["knowledge.write", "member.view"],
      };

      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(),
        resetFields: vi.fn(),
      };

      await wrapper.vm.handleRoleModalOk();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:create-custom-role",
        "org-123",
        {
          name: "技术专家",
          description: "负责技术决策",
          permissions: ["knowledge.write", "member.view"],
        },
        "did:chainlesschain:currentuser",
      );
      expect(message.success).toHaveBeenCalledWith("角色创建成功");
      expect(wrapper.vm.roleModalVisible).toBe(false);
    });

    it("应该在创建成功后重新加载角色列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue();
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(),
        resetFields: vi.fn(),
      };

      wrapper.vm.roleForm = {
        name: "New Role",
        description: "Description",
        permissions: ["perm1"],
      };

      await wrapper.vm.handleRoleModalOk();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-roles",
        "org-123",
      );
    });

    it("应该处理表单验证失败", async () => {
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockRejectedValue({ errorFields: ["name"] }),
        resetFields: vi.fn(),
      };

      await wrapper.vm.handleRoleModalOk();

      expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(
        "org:create-custom-role",
      );
    });

    it("应该处理创建角色失败", async () => {
      const { message } = require("ant-design-vue");
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Name already exists"),
      );
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(),
        resetFields: vi.fn(),
      };

      wrapper.vm.roleForm = {
        name: "Duplicate",
        description: "Test",
        permissions: ["perm1"],
      };

      await wrapper.vm.handleRoleModalOk();

      expect(message.error).toHaveBeenCalledWith("Name already exists");
    });
  });

  // 编辑角色
  describe("Edit Role", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能打开编辑角色对话框", () => {
      const role = mockCustomRoles[0];
      wrapper.vm.handleEditRole(role);

      expect(wrapper.vm.isEditMode).toBe(true);
      expect(wrapper.vm.roleModalVisible).toBe(true);
      expect(wrapper.vm.roleForm.id).toBe("custom-1");
      expect(wrapper.vm.roleForm.name).toBe("项目经理");
      expect(wrapper.vm.roleForm.permissions).toEqual([
        "project.manage",
        "member.view",
      ]);
    });

    it("应该能更新角色", async () => {
      const { message } = require("ant-design-vue");
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      wrapper.vm.isEditMode = true;
      wrapper.vm.roleForm = {
        id: "custom-1",
        name: "项目经理（更新）",
        description: "更新后的描述",
        permissions: ["project.manage", "role.edit"],
      };

      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(),
        resetFields: vi.fn(),
      };

      await wrapper.vm.handleRoleModalOk();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:update-role",
        "custom-1",
        {
          name: "项目经理（更新）",
          description: "更新后的描述",
          permissions: ["project.manage", "role.edit"],
        },
        "did:chainlesschain:currentuser",
      );
      expect(message.success).toHaveBeenCalledWith("角色更新成功");
    });

    it("应该在更新成功后重新加载角色列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue();
      wrapper.vm.isEditMode = true;
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(),
        resetFields: vi.fn(),
      };

      wrapper.vm.roleForm = {
        id: "custom-1",
        name: "Updated",
        description: "Desc",
        permissions: ["perm1"],
      };

      await wrapper.vm.handleRoleModalOk();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-roles",
        "org-123",
      );
    });

    it("应该处理更新角色失败", async () => {
      const { message } = require("ant-design-vue");
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Update failed"),
      );
      wrapper.vm.isEditMode = true;
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(),
        resetFields: vi.fn(),
      };

      wrapper.vm.roleForm = {
        id: "custom-1",
        name: "Updated",
        description: "Desc",
        permissions: ["perm1"],
      };

      await wrapper.vm.handleRoleModalOk();

      expect(message.error).toHaveBeenCalledWith("Update failed");
    });
  });

  // 删除角色
  describe("Delete Role", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能删除角色", async () => {
      const { Modal, message } = require("ant-design-vue");
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      const role = mockCustomRoles[0];
      wrapper.vm.handleDeleteRole(role);

      expect(Modal.confirm).toHaveBeenCalled();
      await wrapper.vm.$nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:delete-role",
        "custom-1",
        "did:chainlesschain:currentuser",
      );
      expect(message.success).toHaveBeenCalledWith("角色删除成功");
    });

    it("应该在删除成功后重新加载角色列表", async () => {
      const { Modal } = require("ant-design-vue");
      window.electron.ipcRenderer.invoke.mockResolvedValue();

      wrapper.vm.handleDeleteRole(mockCustomRoles[0]);

      await wrapper.vm.$nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-roles",
        "org-123",
      );
    });

    it("应该处理删除角色失败", async () => {
      const { Modal, message } = require("ant-design-vue");
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Cannot delete role in use"),
      );

      wrapper.vm.handleDeleteRole(mockCustomRoles[0]);

      await wrapper.vm.$nextTick();

      expect(message.error).toHaveBeenCalledWith("Cannot delete role in use");
    });
  });

  // 查看角色详情
  describe("View Role Detail", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能打开角色详情对话框", () => {
      const role = mockBuiltinRoles[0];
      wrapper.vm.handleViewRole(role);

      expect(wrapper.vm.viewingRole).toEqual(role);
      expect(wrapper.vm.viewRoleModalVisible).toBe(true);
    });

    it("应该显示角色的完整信息", () => {
      const role = mockCustomRoles[0];
      wrapper.vm.handleViewRole(role);

      expect(wrapper.vm.viewingRole.name).toBe("项目经理");
      expect(wrapper.vm.viewingRole.description).toBe("管理项目");
      expect(wrapper.vm.viewingRole.permissions).toEqual([
        "project.manage",
        "member.view",
      ]);
    });
  });

  // 对话框取消
  describe("Modal Cancel", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能取消角色对话框", () => {
      wrapper.vm.roleModalVisible = true;
      wrapper.vm.roleFormRef = {
        resetFields: vi.fn(),
      };

      wrapper.vm.handleRoleModalCancel();

      expect(wrapper.vm.roleModalVisible).toBe(false);
      expect(wrapper.vm.roleFormRef.resetFields).toHaveBeenCalled();
    });

    it("应该处理roleFormRef为null的情况", () => {
      wrapper.vm.roleModalVisible = true;
      wrapper.vm.roleFormRef = null;

      expect(() => wrapper.vm.handleRoleModalCancel()).not.toThrow();
      expect(wrapper.vm.roleModalVisible).toBe(false);
    });
  });

  // 权限管理
  describe("Permissions Management", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能获取权限标签", () => {
      const label = wrapper.vm.getPermissionLabel("member.view");
      expect(label).toBe("查看成员");
    });

    it("应该返回未知权限的原值", () => {
      const label = wrapper.vm.getPermissionLabel("unknown.permission");
      expect(label).toBe("unknown.permission");
    });

    it("应该能清空选中的权限", () => {
      wrapper.vm.roleForm.permissions = ["perm1", "perm2", "perm3"];

      wrapper.vm.roleForm.permissions = [];

      expect(wrapper.vm.roleForm.permissions).toEqual([]);
    });

    it("应该正确统计选中的权限数量", () => {
      wrapper.vm.roleForm.permissions = ["perm1", "perm2"];
      expect(wrapper.vm.roleForm.permissions.length).toBe(2);
    });
  });

  // 工具函数
  describe("Utility Functions", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该格式化时间戳", () => {
      const timestamp = 1704067200000;
      const formatted = wrapper.vm.formatTimestamp(timestamp);
      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe("string");
    });

    it("应该处理空时间戳", () => {
      expect(wrapper.vm.formatTimestamp(null)).toBe("-");
      expect(wrapper.vm.formatTimestamp(undefined)).toBe("-");
    });
  });

  // 表单验证规则
  describe("Form Validation Rules", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该有名称必填规则", () => {
      const nameRules = wrapper.vm.roleFormRules.name;
      expect(nameRules).toBeDefined();
      expect(nameRules.some((r) => r.required)).toBe(true);
    });

    it("应该有名称长度规则", () => {
      const nameRules = wrapper.vm.roleFormRules.name;
      expect(nameRules.some((r) => r.min === 2 && r.max === 20)).toBe(true);
    });

    it("应该有权限必选规则", () => {
      const permRules = wrapper.vm.roleFormRules.permissions;
      expect(permRules).toBeDefined();
      expect(permRules.some((r) => r.required && r.type === "array")).toBe(
        true,
      );
    });
  });

  // 加载状态
  describe("Loading States", () => {
    it("应该在加载时设置loading状态", async () => {
      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      window.electron.ipcRenderer.invoke.mockReturnValue(promise);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.loading).toBe(true);

      resolvePromise([]);
      await promise;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.loading).toBe(false);
    });

    it("应该在加载失败时清除loading状态", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error("Failed"));

      wrapper = createWrapper();
      await wrapper.vm.loadRoles();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  // 边界情况
  describe("Edge Cases", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该处理空权限列表", async () => {
      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "org:get-all-permissions") {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      await wrapper.vm.loadAllPermissions();

      expect(wrapper.vm.allPermissions).toEqual([]);
      expect(wrapper.vm.activePermissionCategories).toEqual([]);
    });

    it("应该处理权限列表为null", async () => {
      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "org:get-all-permissions") {
          return Promise.resolve(null);
        }
        return Promise.resolve([]);
      });

      await wrapper.vm.loadAllPermissions();

      expect(wrapper.vm.allPermissions).toEqual([]);
    });

    it("应该处理缺失角色描述", () => {
      const roleWithoutDesc = { ...mockCustomRoles[0], description: null };
      wrapper.vm.handleViewRole(roleWithoutDesc);

      expect(wrapper.vm.viewingRole.description).toBeNull();
    });

    it("应该处理空权限数组", () => {
      const roleWithoutPerms = { ...mockCustomRoles[0], permissions: [] };
      wrapper.vm.handleViewRole(roleWithoutPerms);

      expect(wrapper.vm.viewingRole.permissions).toEqual([]);
    });

    it("应该处理编辑时复制权限数组", () => {
      const role = {
        ...mockCustomRoles[0],
        permissions: ["perm1", "perm2"],
      };

      wrapper.vm.handleEditRole(role);

      expect(wrapper.vm.roleForm.permissions).toEqual(["perm1", "perm2"]);
      expect(wrapper.vm.roleForm.permissions).not.toBe(role.permissions);
    });
  });

  // 权限分类显示
  describe("Permission Categories", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该正确显示所有权限分类", () => {
      expect(wrapper.vm.allPermissions.length).toBe(3);
      expect(wrapper.vm.allPermissions[0].category).toBe("成员管理");
      expect(wrapper.vm.allPermissions[1].category).toBe("角色管理");
      expect(wrapper.vm.allPermissions[2].category).toBe("知识库");
    });

    it("应该正确显示每个分类的权限", () => {
      const memberCategory = wrapper.vm.allPermissions[0];
      expect(memberCategory.permissions.length).toBe(2);
      expect(memberCategory.permissions[0].value).toBe("member.view");
      expect(memberCategory.permissions[1].value).toBe("member.manage");
    });

    it("应该支持权限描述", () => {
      const permission = wrapper.vm.allPermissions[0].permissions[0];
      expect(permission.description).toBe("可以查看组织成员列表");
    });
  });
});
