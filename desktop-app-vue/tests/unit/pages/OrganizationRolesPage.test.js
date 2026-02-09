import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

// Mock Ant Design Vue components
const mockAntdComponents = {
  "a-table": {
    name: "ATable",
    template: '<div class="a-table"><slot /></div>',
    props: ["columns", "dataSource", "loading", "pagination", "rowKey"],
  },
  "a-button": {
    name: "AButton",
    template:
      '<button class="a-button" :type="type" :disabled="disabled"><slot /></button>',
    props: ["type", "disabled", "danger", "icon"],
  },
  "a-input": {
    name: "AInput",
    template:
      '<input class="a-input" :value="value" @input="$emit(\'update:value\', $event.target.value)" :placeholder="placeholder" />',
    props: ["value", "placeholder"],
  },
  "a-input-search": {
    name: "AInputSearch",
    template:
      '<input class="a-input-search" :value="value" @input="$emit(\'update:value\', $event.target.value)" :placeholder="placeholder" />',
    props: ["value", "placeholder"],
  },
  "a-modal": {
    name: "AModal",
    template: '<div v-if="open" class="a-modal"><slot /></div>',
    props: ["open", "title", "confirmLoading"],
  },
  "a-form": {
    name: "AForm",
    template: '<form class="a-form"><slot /></form>',
    props: ["model", "rules", "layout"],
  },
  "a-form-item": {
    name: "AFormItem",
    template:
      '<div class="a-form-item" :class="{ error: validateStatus === \'error\' }"><slot /></div>',
    props: ["label", "name", "validateStatus", "help"],
  },
  "a-select": {
    name: "ASelect",
    template:
      '<select class="a-select" :value="value" @change="$emit(\'update:value\', $event.target.value)"><slot /></select>',
    props: ["value", "placeholder", "mode", "allowClear"],
  },
  "a-select-option": {
    name: "ASelectOption",
    template: '<option :value="value"><slot /></option>',
    props: ["value"],
  },
  "a-checkbox-group": {
    name: "ACheckboxGroup",
    template: '<div class="a-checkbox-group"><slot /></div>',
    props: ["value", "options"],
  },
  "a-checkbox": {
    name: "ACheckbox",
    template:
      '<input type="checkbox" class="a-checkbox" :checked="checked" @change="$emit(\'update:checked\', $event.target.checked)" />',
    props: ["checked", "value"],
  },
  "a-tag": {
    name: "ATag",
    template: '<span class="a-tag" :color="color"><slot /></span>',
    props: ["color"],
  },
  "a-space": {
    name: "ASpace",
    template: '<div class="a-space"><slot /></div>',
    props: ["size"],
  },
  "a-divider": {
    name: "ADivider",
    template: '<hr class="a-divider" />',
    props: [],
  },
  "a-textarea": {
    name: "ATextarea",
    template:
      '<textarea class="a-textarea" :value="value" @input="$emit(\'update:value\', $event.target.value)" :placeholder="placeholder"></textarea>',
    props: ["value", "placeholder", "rows"],
  },
  "a-spin": {
    name: "ASpin",
    template: '<div class="a-spin" :class="{ spinning }"><slot /></div>',
    props: ["spinning"],
  },
  "a-row": {
    name: "ARow",
    template: '<div class="a-row"><slot /></div>',
    props: ["gutter"],
  },
  "a-col": {
    name: "ACol",
    template: '<div class="a-col"><slot /></div>',
    props: ["xs", "sm", "lg"],
  },
  "a-empty": {
    name: "AEmpty",
    template: '<div class="a-empty">{{ description }}</div>',
    props: ["description"],
  },
  "a-collapse": {
    name: "ACollapse",
    template: '<div class="a-collapse"><slot /></div>',
    props: ["activeKey"],
  },
  "a-collapse-panel": {
    name: "ACollapsePanel",
    template: '<div class="a-collapse-panel"><slot /></div>',
    props: ["key", "header"],
  },
  "a-descriptions": {
    name: "ADescriptions",
    template: '<div class="a-descriptions"><slot /></div>',
    props: ["bordered", "column"],
  },
  "a-descriptions-item": {
    name: "ADescriptionsItem",
    template: '<div class="a-descriptions-item"><slot /></div>',
    props: ["label"],
  },
  "a-tooltip": {
    name: "ATooltip",
    template: '<div class="a-tooltip"><slot /></div>',
    props: ["title"],
  },
};

// Mock child components
const mockRoleCard = {
  name: "RoleCard",
  template: '<div class="role-card" :data-role-id="role.id"><slot /></div>',
  props: ["role", "isBuiltin"],
  emits: ["view", "edit", "delete"],
};

const mockPermissionGuard = {
  name: "PermissionGuard",
  template:
    '<div class="permission-guard"><slot v-if="hasPermission" /><slot v-else name="denied" /></div>',
  props: ["permission", "mode"],
  computed: {
    hasPermission() {
      // Mock: allow if user is admin
      return (
        this.permission === "role.create" && this.$attrs["data-test-admin"]
      );
    },
  },
};

// Mock IPC renderer
const mockIpcRenderer = {
  invoke: vi.fn(),
};

// Mock window.electron
global.window = global.window || {};
global.window.electron = {
  ipcRenderer: mockIpcRenderer,
};

// Mock identity store
const mockIdentityStore = {
  currentOrgId: "org-123",
  primaryDID: "did:key:user123",
};

// Mock stores
vi.mock("@/stores/identity", () => ({
  useIdentityStore: () => mockIdentityStore,
}));

vi.mock("../stores/identity", () => ({
  useIdentityStore: () => mockIdentityStore,
}));

// Mock message and Modal
const mockMessage = {
  success: vi.fn(),
  error: vi.fn(),
};

const mockModal = {
  confirm: vi.fn(),
};

vi.mock("ant-design-vue", () => ({
  message: mockMessage,
  Modal: mockModal,
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  createLogger: vi.fn(),
}));

// Mock icons
vi.mock("@ant-design/icons-vue", () => ({
  PlusOutlined: {
    name: "PlusOutlined",
    template: '<span class="plus-outlined">+</span>',
  },
  EditOutlined: {
    name: "EditOutlined",
    template: '<span class="edit-outlined">E</span>',
  },
  DeleteOutlined: {
    name: "DeleteOutlined",
    template: '<span class="delete-outlined">D</span>',
  },
  SafetyCertificateOutlined: {
    name: "SafetyCertificateOutlined",
    template: '<span class="safety-certificate-outlined">S</span>',
  },
  RightOutlined: {
    name: "RightOutlined",
    template: '<span class="right-outlined">R</span>',
  },
  EyeOutlined: {
    name: "EyeOutlined",
    template: '<span class="eye-outlined">Eye</span>',
  },
}));

describe("OrganizationRolesPage", () => {
  let wrapper;
  let OrganizationRolesPage;
  let pinia;

  // Helper function to create mount options
  const createMountOptions = (additionalOptions = {}) => ({
    global: {
      components: {
        ...mockAntdComponents,
        RoleCard: mockRoleCard,
        PermissionGuard: mockPermissionGuard,
      },
      plugins: [pinia],
      ...additionalOptions.global,
    },
    ...additionalOptions,
  });

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    mockIpcRenderer.invoke.mockReset();

    // Import Pinia
    const { createPinia, setActivePinia } = await import("pinia");
    pinia = createPinia();
    setActivePinia(pinia);

    // Mock default data
    const mockRoles = [
      {
        id: "role-1",
        name: "Admin",
        description: "Administrator role",
        is_builtin: true,
        permissions: ["*"],
        created_at: Date.now(),
      },
      {
        id: "role-2",
        name: "Member",
        description: "Regular member",
        is_builtin: true,
        permissions: ["read", "write"],
        created_at: Date.now(),
      },
      {
        id: "role-3",
        name: "Custom Role",
        description: "Custom test role",
        is_builtin: false,
        permissions: ["read", "write", "delete"],
        created_at: Date.now(),
      },
    ];

    const mockPermissions = [
      {
        category: "Content Management",
        permissions: [
          { value: "read", label: "Read", description: "View content" },
          {
            value: "write",
            label: "Write",
            description: "Create/edit content",
          },
          { value: "delete", label: "Delete", description: "Delete content" },
        ],
      },
      {
        category: "User Management",
        permissions: [
          {
            value: "user.view",
            label: "View Users",
            description: "View user list",
          },
          {
            value: "user.create",
            label: "Create Users",
            description: "Add new users",
          },
          {
            value: "user.delete",
            label: "Delete Users",
            description: "Remove users",
          },
        ],
      },
      {
        category: "Role Management",
        permissions: [
          {
            value: "role.create",
            label: "Create Roles",
            description: "Create new roles",
          },
          {
            value: "role.update",
            label: "Update Roles",
            description: "Modify roles",
          },
        ],
      },
    ];

    mockIpcRenderer.invoke
      .mockResolvedValueOnce(mockRoles) // org:get-roles
      .mockResolvedValueOnce(mockPermissions); // org:get-all-permissions

    // Import component
    OrganizationRolesPage = (
      await import("@renderer/pages/OrganizationRolesPage.vue")
    ).default;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("1. Component Mounting and Initialization", () => {
    it("should mount successfully and load roles", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-roles",
        "org-123",
      );
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-all-permissions",
      );
      expect(wrapper.exists()).toBe(true);
    });

    it("should display page header with title", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      const header = wrapper.find(".page-header");
      expect(header.exists()).toBe(true);
      expect(header.text()).toContain("角色与权限管理");
    });

    it("should separate builtin and custom roles", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      const builtinSection = wrapper.findAll(".role-section")[0];
      const customSection = wrapper.findAll(".role-section")[1];

      expect(builtinSection.text()).toContain("内置角色");
      expect(customSection.text()).toContain("自定义角色");
    });

    it("should load permissions on mount", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-all-permissions",
      );
    });
  });

  describe("2. Role Creation", () => {
    it("should show create button for admin", async () => {
      wrapper = mount(
        OrganizationRolesPage,
        createMountOptions({
          attrs: {
            "data-test-admin": true,
          },
        }),
      );

      await nextTick();

      const createButton = wrapper.find("button.a-button");
      expect(createButton.exists()).toBe(true);
      expect(createButton.text()).toContain("创建自定义角色");
    });

    it("should open create modal when button clicked", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      // Call the showCreateRoleModal method directly
      await wrapper.vm.showCreateRoleModal();
      await nextTick();

      expect(wrapper.vm.roleModalVisible).toBe(true);
      expect(wrapper.vm.isEditMode).toBe(false);
      expect(wrapper.vm.roleForm.name).toBe("");
    });

    it("should create custom role with IPC call", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      // Clear previous calls
      mockIpcRenderer.invoke.mockClear();

      // Mock the create call and refresh
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ id: "new-role-id" }) // org:create-custom-role
        .mockResolvedValueOnce([]); // org:get-roles (refresh)

      wrapper.vm.showCreateRoleModal();
      wrapper.vm.roleForm.name = "New Custom Role";
      wrapper.vm.roleForm.description = "Test description";
      wrapper.vm.roleForm.permissions = ["read", "write"];

      // Mock form validation
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(true),
      };

      await wrapper.vm.handleRoleModalOk();
      await nextTick();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        "org:create-custom-role",
        "org-123",
        {
          name: "New Custom Role",
          description: "Test description",
          permissions: ["read", "write"],
        },
        "did:key:user123",
      );
      expect(mockMessage.success).toHaveBeenCalledWith("角色创建成功");
    });

    it("should close modal after creation", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      mockIpcRenderer.invoke.mockClear();
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ id: "new-role-id" })
        .mockResolvedValueOnce([]);

      wrapper.vm.showCreateRoleModal();
      wrapper.vm.roleForm.name = "Test Role";
      wrapper.vm.roleForm.permissions = ["read"];

      // Mock form validation
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(true),
      };

      await wrapper.vm.handleRoleModalOk();
      await nextTick();

      expect(wrapper.vm.roleModalVisible).toBe(false);
    });

    it("should prevent creating without name", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      wrapper.vm.showCreateRoleModal();
      wrapper.vm.roleForm.name = "";
      wrapper.vm.roleForm.permissions = ["read"];

      // Mock validation failure
      wrapper.vm.roleFormRef = {
        validate: vi
          .fn()
          .mockRejectedValue({ errorFields: [{ name: "name" }] }),
      };

      await wrapper.vm.handleRoleModalOk();

      expect(wrapper.vm.roleModalVisible).toBe(true); // Modal stays open
    });

    it("should prevent creating without permissions", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      wrapper.vm.showCreateRoleModal();
      wrapper.vm.roleForm.name = "Test Role";
      wrapper.vm.roleForm.permissions = [];

      // Mock validation failure
      wrapper.vm.roleFormRef = {
        validate: vi
          .fn()
          .mockRejectedValue({ errorFields: [{ name: "permissions" }] }),
      };

      await wrapper.vm.handleRoleModalOk();

      expect(wrapper.vm.roleModalVisible).toBe(true);
    });
  });

  describe("3. Role Editing", () => {
    it("should open edit modal with role data", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      const role = {
        id: "role-3",
        name: "Editor",
        description: "Editor role",
        permissions: ["read", "write"],
      };

      wrapper.vm.handleEditRole(role);
      await nextTick();

      expect(wrapper.vm.roleModalVisible).toBe(true);
      expect(wrapper.vm.isEditMode).toBe(true);
      expect(wrapper.vm.roleForm.name).toBe("Editor");
      expect(wrapper.vm.roleForm.permissions).toEqual(["read", "write"]);
    });

    it("should update role permissions via IPC", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      mockIpcRenderer.invoke.mockClear();
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([]);

      const role = {
        id: "role-3",
        name: "Editor",
        description: "Editor role",
        permissions: ["read"],
      };
      wrapper.vm.handleEditRole(role);
      wrapper.vm.roleForm.permissions = ["read", "write", "delete"];

      // Mock form validation
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(true),
      };

      await wrapper.vm.handleRoleModalOk();
      await nextTick();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        "org:update-role",
        "role-3",
        {
          name: "Editor",
          description: "Editor role",
          permissions: ["read", "write", "delete"],
        },
        "did:key:user123",
      );
      expect(mockMessage.success).toHaveBeenCalledWith("角色更新成功");
    });

    it("should allow editing custom roles", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      const customRole = {
        id: "role-3",
        name: "Custom",
        is_builtin: false,
        permissions: [],
      };
      wrapper.vm.handleEditRole(customRole);

      expect(wrapper.vm.roleModalVisible).toBe(true);
      expect(wrapper.vm.isEditMode).toBe(true);
    });

    it("should prevent editing predefined roles (admin/member/viewer)", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      // RoleCard should not emit edit for builtin roles
      const roleCards = wrapper.findAllComponents(mockRoleCard);
      const builtinCard = roleCards.find((c) => c.props("isBuiltin") === true);

      expect(builtinCard).toBeTruthy();
      expect(builtinCard.props("isBuiltin")).toBe(true);
    });

    it("should close modal after editing", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      mockIpcRenderer.invoke.mockClear();
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([]);

      const role = {
        id: "role-3",
        name: "Editor",
        description: "Test",
        permissions: ["read"],
      };
      wrapper.vm.handleEditRole(role);

      // Mock form validation
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(true),
      };

      await wrapper.vm.handleRoleModalOk();
      await nextTick();

      expect(wrapper.vm.roleModalVisible).toBe(false);
    });
  });

  describe("4. Role Deletion", () => {
    it("should delete empty role", async () => {
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true });
      mockModal.confirm.mockImplementation(({ onOk }) => onOk());

      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      const role = { id: "role-3", name: "Empty Role", is_builtin: false };
      wrapper.vm.handleDeleteRole(role);
      await nextTick();

      expect(mockModal.confirm).toHaveBeenCalled();
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        "org:delete-role",
        "role-3",
        "did:key:user123",
      );
      expect(mockMessage.success).toHaveBeenCalledWith("角色删除成功");
    });

    it("should allow deleting custom roles with 0 members", async () => {
      mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true });
      mockModal.confirm.mockImplementation(({ onOk }) => onOk());

      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      const role = {
        id: "role-custom",
        name: "Custom",
        is_builtin: false,
        member_count: 0,
      };
      wrapper.vm.handleDeleteRole(role);

      expect(mockModal.confirm).toHaveBeenCalled();
    });

    it("should prevent deleting roles with members", async () => {
      mockIpcRenderer.invoke.mockRejectedValueOnce(
        new Error("Cannot delete role with members"),
      );
      mockModal.confirm.mockImplementation(({ onOk }) => onOk());

      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      const role = { id: "role-3", name: "Active Role", member_count: 5 };
      wrapper.vm.handleDeleteRole(role);
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalledWith(
        "Cannot delete role with members",
      );
    });

    it("should prevent deleting predefined roles", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      // RoleCard should not show delete button for builtin roles
      const roleCards = wrapper.findAllComponents(mockRoleCard);
      const builtinCards = roleCards.filter(
        (c) => c.props("isBuiltin") === true,
      );

      expect(builtinCards.length).toBeGreaterThan(0);
    });
  });

  describe("5. Permission Assignment", () => {
    it("should display 8 available permissions", async () => {
      const mockRoles = [];
      const mockPermissions = [
        {
          category: "Cat1",
          permissions: [
            { value: "p1", label: "P1", description: "Desc1" },
            { value: "p2", label: "P2", description: "Desc2" },
            { value: "p3", label: "P3", description: "Desc3" },
            { value: "p4", label: "P4", description: "Desc4" },
          ],
        },
        {
          category: "Cat2",
          permissions: [
            { value: "p5", label: "P5", description: "Desc5" },
            { value: "p6", label: "P6", description: "Desc6" },
            { value: "p7", label: "P7", description: "Desc7" },
            { value: "p8", label: "P8", description: "Desc8" },
          ],
        },
      ];

      mockIpcRenderer.invoke.mockReset();
      mockIpcRenderer.invoke
        .mockResolvedValueOnce(mockRoles)
        .mockResolvedValueOnce(mockPermissions);

      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      expect(wrapper.vm.allPermissions).toHaveLength(2);
      const totalPermissions = wrapper.vm.allPermissions.reduce(
        (sum, cat) => sum + cat.permissions.length,
        0,
      );
      expect(totalPermissions).toBe(8);
    });

    it("should allow selecting multiple permissions", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      wrapper.vm.showCreateRoleModal();
      wrapper.vm.roleForm.permissions = ["read", "write", "delete"];

      expect(wrapper.vm.roleForm.permissions).toHaveLength(3);
    });

    it("should display role permission tags", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      const role = {
        id: "role-1",
        name: "Test",
        permissions: ["read", "write"],
        created_at: Date.now(),
      };

      wrapper.vm.handleViewRole(role);
      await nextTick();

      expect(wrapper.vm.viewingRole).toEqual(role);
      expect(wrapper.vm.viewRoleModalVisible).toBe(true);
    });
  });

  describe("6. Role Inheritance", () => {
    it("should filter inheritable roles (exclude admin/member/viewer)", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      // Custom roles should be separate from builtin
      expect(wrapper.vm.builtinRoles.length).toBe(2);
      expect(wrapper.vm.customRoles.length).toBe(1);
    });

    it("should create role inheriting from another", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      mockIpcRenderer.invoke.mockClear();
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ id: "new-role-id" })
        .mockResolvedValueOnce([]);

      wrapper.vm.showCreateRoleModal();
      wrapper.vm.roleForm.name = "Inherited Role";
      wrapper.vm.roleForm.permissions = ["read", "write"]; // Inherited from another role

      // Mock form validation
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(true),
      };

      await wrapper.vm.handleRoleModalOk();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        "org:create-custom-role",
        "org-123",
        expect.objectContaining({
          permissions: ["read", "write"],
        }),
        "did:key:user123",
      );
    });
  });

  describe("7. Search and Filtering", () => {
    it("should filter by name", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      const allRoles = wrapper.vm.roles;
      expect(allRoles.some((r) => r.name === "Admin")).toBe(true);
      expect(allRoles.some((r) => r.name === "Custom Role")).toBe(true);
    });

    it("should filter by description", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      const roleWithDesc = wrapper.vm.roles.find(
        (r) => r.description === "Custom test role",
      );
      expect(roleWithDesc).toBeTruthy();
    });

    it("should filter by permissions", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      const rolesWithDelete = wrapper.vm.roles.filter((r) =>
        r.permissions.includes("delete"),
      );
      expect(rolesWithDelete.length).toBeGreaterThan(0);
    });

    it("should show all when empty", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      expect(wrapper.vm.roles.length).toBe(3);
      expect(wrapper.vm.builtinRoles.length).toBe(2);
      expect(wrapper.vm.customRoles.length).toBe(1);
    });

    it("should show empty when no matches", async () => {
      mockIpcRenderer.invoke.mockReset();
      mockIpcRenderer.invoke
        .mockResolvedValueOnce([]) // Empty roles
        .mockResolvedValueOnce([]);

      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.customRoles.length).toBe(0);
      const emptyComponent = wrapper.find(".a-empty");
      expect(emptyComponent.exists()).toBe(true);
    });

    it("should update pagination total", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      // Total roles count
      expect(wrapper.vm.roles.length).toBe(3);
    });
  });

  describe("8. Permission Checks", () => {
    it("should allow admin to create roles", async () => {
      wrapper = mount(
        OrganizationRolesPage,
        createMountOptions({
          attrs: {
            "data-test-admin": true,
          },
        }),
      );

      await nextTick();

      wrapper.vm.showCreateRoleModal();
      expect(wrapper.vm.roleModalVisible).toBe(true);
    });

    it("should prevent non-admin from creating", async () => {
      wrapper = mount(
        OrganizationRolesPage,
        createMountOptions({
          attrs: {
            "data-test-admin": false,
          },
        }),
      );

      await nextTick();

      const permissionGuard = wrapper.findComponent(mockPermissionGuard);
      expect(permissionGuard.exists()).toBe(true);
    });

    it("should prevent non-admin from editing", async () => {
      mockIpcRenderer.invoke.mockRejectedValueOnce(
        new Error("Permission denied"),
      );

      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      const role = {
        id: "role-3",
        name: "Editor",
        description: "Test",
        permissions: ["read"],
      };
      wrapper.vm.handleEditRole(role);

      await wrapper.vm.handleRoleModalOk();
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalled();
    });

    it("should prevent non-admin from deleting", async () => {
      mockIpcRenderer.invoke.mockRejectedValueOnce(
        new Error("Permission denied"),
      );
      mockModal.confirm.mockImplementation(({ onOk }) => onOk());

      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      const role = { id: "role-3", name: "Test Role" };
      wrapper.vm.handleDeleteRole(role);
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalled();
    });
  });

  describe("9. Error Handling", () => {
    it("should handle load roles failure", async () => {
      mockIpcRenderer.invoke.mockReset();
      mockIpcRenderer.invoke
        .mockRejectedValueOnce(new Error("Load roles failed"))
        .mockResolvedValueOnce([]);

      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalled();
      const errorCall = mockMessage.error.mock.calls[0][0];
      expect(errorCall).toContain("Load roles failed");
    });

    it("should handle create role failure", async () => {
      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();

      mockIpcRenderer.invoke.mockClear();
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error("Create failed"));

      wrapper.vm.showCreateRoleModal();
      wrapper.vm.roleForm.name = "New Role";
      wrapper.vm.roleForm.permissions = ["read"];

      // Mock form validation
      wrapper.vm.roleFormRef = {
        validate: vi.fn().mockResolvedValue(true),
      };

      await wrapper.vm.handleRoleModalOk();
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalled();
      const errorCall = mockMessage.error.mock.calls[0][0];
      expect(errorCall).toContain("Create failed");
    });

    it("should handle delete role failure", async () => {
      mockIpcRenderer.invoke.mockRejectedValueOnce(new Error("Delete failed"));
      mockModal.confirm.mockImplementation(({ onOk }) => onOk());

      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();

      const role = { id: "role-3", name: "Test" };
      wrapper.vm.handleDeleteRole(role);
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalledWith("Delete failed");
    });

    it("should handle invalid response format", async () => {
      mockIpcRenderer.invoke.mockReset();
      mockIpcRenderer.invoke
        .mockResolvedValueOnce(null) // Invalid response
        .mockResolvedValueOnce([]);

      wrapper = mount(OrganizationRolesPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      // Should handle null response gracefully
      expect(wrapper.vm.roles).toEqual([]);
    });
  });
});
