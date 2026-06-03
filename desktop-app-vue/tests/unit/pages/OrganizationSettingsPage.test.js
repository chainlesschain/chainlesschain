import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

// Mock Ant Design Vue components
const mockAntdComponents = {
  "a-form": {
    name: "AForm",
    template: '<form class="a-form"><slot /></form>',
    props: ["model", "rules", "layout"],
  },
  "a-form-item": {
    name: "AFormItem",
    template:
      '<div class="a-form-item"><label v-if="label">{{ label }}</label><slot /><slot name="label" /></div>',
    props: ["label", "name", "validateStatus", "help", "required"],
  },
  "a-input": {
    name: "AInput",
    template:
      '<input class="a-input" :value="value" @input="$emit(\'update:value\', $event.target.value)" :placeholder="placeholder" :disabled="disabled" />',
    props: ["value", "placeholder", "disabled"],
  },
  "a-textarea": {
    name: "ATextarea",
    template:
      '<textarea class="a-textarea" :value="value" @input="$emit(\'update:value\', $event.target.value)" :placeholder="placeholder" :rows="rows" :disabled="disabled"></textarea>',
    props: ["value", "placeholder", "rows", "disabled"],
  },
  "a-switch": {
    name: "ASwitch",
    template:
      '<button class="a-switch" :class="{ checked: checked }" @click="$emit(\'update:checked\', !checked)">{{ checked ? "ON" : "OFF" }}</button>',
    props: ["checked", "disabled"],
  },
  "a-select": {
    name: "ASelect",
    template:
      '<select class="a-select" :value="value" @change="$emit(\'update:value\', $event.target.value)"><slot /></select>',
    props: ["value", "placeholder", "disabled"],
  },
  "a-select-option": {
    name: "ASelectOption",
    template: '<option :value="value"><slot /></option>',
    props: ["value"],
  },
  "a-button": {
    name: "AButton",
    template:
      '<button class="a-button" :type="type" :disabled="disabled" :class="{ danger: danger }" @click="$emit(\'click\')"><slot /><slot name="icon" /></button>',
    props: ["type", "disabled", "danger", "loading", "size"],
  },
  "a-modal": {
    name: "AModal",
    template:
      '<div v-if="open" class="a-modal"><div class="modal-title">{{ title }}</div><div class="modal-content"><slot /></div></div>',
    props: ["open", "title", "confirmLoading"],
    emits: ["update:open", "ok"],
  },
  "a-divider": {
    name: "ADivider",
    template: '<hr class="a-divider" />',
    props: ["orientation"],
  },
  "a-card": {
    name: "ACard",
    template:
      '<div class="a-card"><div v-if="title" class="card-title">{{ title }}</div><slot /></div>',
    props: ["title", "bordered"],
  },
  "a-space": {
    name: "ASpace",
    template: '<div class="a-space"><slot /></div>',
    props: ["size", "direction"],
  },
  "a-alert": {
    name: "AAlert",
    template:
      '<div class="a-alert" :class="type"><slot /><slot name="action" /></div>',
    props: ["type", "message", "description", "showIcon"],
  },
  "a-row": {
    name: "ARow",
    template: '<div class="a-row"><slot /></div>',
    props: ["gutter"],
  },
  "a-col": {
    name: "ACol",
    template: '<div class="a-col"><slot /></div>',
    props: ["span"],
  },
  "a-tag": {
    name: "ATag",
    template: '<span class="a-tag" :color="color"><slot /></span>',
    props: ["color"],
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
  "a-typography-paragraph": {
    name: "ATypographyParagraph",
    template: '<div class="a-typography-paragraph"><slot /></div>',
    props: ["copyable"],
  },
  "a-typography-text": {
    name: "ATypographyText",
    template: '<span class="a-typography-text"><slot /></span>',
    props: ["code"],
  },
  "a-radio-group": {
    name: "ARadioGroup",
    template: '<div class="a-radio-group"><slot /></div>',
    props: ["value", "disabled"],
  },
  "a-radio": {
    name: "ARadio",
    template: '<label class="a-radio"><slot /></label>',
    props: ["value"],
  },
  "a-input-number": {
    name: "AInputNumber",
    template:
      '<input class="a-input-number" type="number" :value="value" :min="min" :max="max" :disabled="disabled" />',
    props: ["value", "min", "max", "disabled"],
  },
  "a-checkbox": {
    name: "ACheckbox",
    template:
      '<input type="checkbox" class="a-checkbox" :checked="checked" :disabled="disabled" @change="$emit(\'update:checked\', $event.target.checked)" />',
    props: ["checked", "disabled"],
  },
  "a-tooltip": {
    name: "ATooltip",
    template: '<div class="a-tooltip"><slot /></div>',
    props: ["title"],
  },
  "a-upload": {
    name: "AUpload",
    template: '<div class="a-upload"><slot /></div>',
    props: ["showUploadList", "beforeUpload", "accept"],
  },
  "a-avatar": {
    name: "AAvatar",
    template: '<div class="a-avatar"><slot /><slot name="icon" /></div>',
    props: ["src", "size"],
  },
  "a-list": {
    name: "AList",
    template: '<div class="a-list"><slot /></div>',
    props: ["loading", "dataSource", "pagination"],
  },
  "a-list-item": {
    name: "AListItem",
    template: '<div class="a-list-item"><slot /></div>',
  },
  "a-list-item-meta": {
    name: "AListItemMeta",
    template:
      '<div class="a-list-item-meta"><slot /><slot name="avatar" /><slot name="title" /><slot name="description" /></div>',
  },
};

// Mock IPC - the component uses window.ipc.invoke (NOT window.electron.ipcRenderer)
const mockIpcInvoke = vi.fn();

global.window = global.window || {};
global.window.ipc = {
  invoke: mockIpcInvoke,
};
// Also provide window.electronAPI for backup/sync methods
global.window.electronAPI = {
  invoke: vi.fn(),
};

// Mock identity store data
const mockIdentityStore = {
  currentOrgId: "org-123",
  primaryDID: "did:key:user123",
  isOrganizationContext: true,
  organizations: [
    { org_id: "org-123", name: "Test Organization", role: "owner" },
  ],
  leaveOrganization: vi.fn().mockResolvedValue(true),
  switchContext: vi.fn().mockResolvedValue(true),
};

// Mock stores
vi.mock("@/stores/identity", () => ({
  useIdentityStore: () => mockIdentityStore,
}));

vi.mock("../stores/identity", () => ({
  useIdentityStore: () => mockIdentityStore,
}));

// Mock message and Modal
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
const mockModal = vi.hoisted(() => ({
  confirm: vi.fn((opts) => {
    if (opts?.onOk) {
      Promise.resolve().then(() => opts.onOk());
    }
    return { destroy: vi.fn() };
  }),
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

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

// Mock icons - must include all icons imported by the component
vi.mock("@ant-design/icons-vue", () => ({
  SettingOutlined: {
    name: "SettingOutlined",
    template: '<span class="setting-outlined">S</span>',
  },
  DeleteOutlined: {
    name: "DeleteOutlined",
    template: '<span class="delete-outlined">D</span>',
  },
  TeamOutlined: {
    name: "TeamOutlined",
    template: '<span class="team-outlined">T</span>',
  },
  UploadOutlined: {
    name: "UploadOutlined",
    template: '<span class="upload-outlined">U</span>',
  },
  QuestionCircleOutlined: {
    name: "QuestionCircleOutlined",
    template: '<span class="question-circle-outlined">?</span>',
  },
  CloudSyncOutlined: {
    name: "CloudSyncOutlined",
    template: '<span class="cloud-sync-outlined">C</span>',
  },
  DatabaseOutlined: {
    name: "DatabaseOutlined",
    template: '<span class="database-outlined">DB</span>',
  },
  SafetyOutlined: {
    name: "SafetyOutlined",
    template: '<span class="safety-outlined">SA</span>',
  },
  SafetyCertificateOutlined: {
    name: "SafetyCertificateOutlined",
    template: '<span class="safety-cert-outlined">SC</span>',
  },
  CheckCircleOutlined: {
    name: "CheckCircleOutlined",
    template: '<span class="check-circle-outlined">OK</span>',
  },
  ExportOutlined: {
    name: "ExportOutlined",
    template: '<span class="export-outlined">EX</span>',
  },
  SyncOutlined: {
    name: "SyncOutlined",
    template: '<span class="sync-outlined">SY</span>',
  },
  UserAddOutlined: {
    name: "UserAddOutlined",
    template: '<span class="user-add-outlined">UA</span>',
  },
  EditOutlined: {
    name: "EditOutlined",
    template: '<span class="edit-outlined">ED</span>',
  },
  LogoutOutlined: {
    name: "LogoutOutlined",
    template: '<span class="logout-outlined">LO</span>',
  },
}));

// Mock router
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

// Mock organization data
const mockOrgInfo = {
  org_id: "org-123",
  name: "Test Organization",
  type: "startup",
  description: "Test org description",
  avatar: "",
  org_did: "did:key:org123abc",
  owner_did: "did:key:user123",
  settings_json: JSON.stringify({
    visibility: "private",
    maxMembers: 100,
    allowMemberInvite: true,
    defaultMemberRole: "member",
  }),
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-06-01T00:00:00Z",
};

const mockMembers = [
  { did: "did:key:user123", name: "User 1", role: "owner" },
  { did: "did:key:user456", name: "User 2", role: "admin" },
  { did: "did:key:user789", name: "User 3", role: "member" },
];

const mockActivities = [
  { action_type: "create_organization", created_at: "2024-01-01T00:00:00Z" },
  { action_type: "add_member", created_at: "2024-02-01T00:00:00Z" },
];

// Setup default IPC mock implementation
function setupDefaultIpcMock() {
  mockIpcInvoke.mockImplementation((channel, ...args) => {
    switch (channel) {
      case "org:get-organization":
        return Promise.resolve(mockOrgInfo);
      case "org:get-members":
        return Promise.resolve(mockMembers);
      case "db:get-context-path":
        return Promise.resolve("/path/to/org_org-123.db");
      case "org:get-activities":
        return Promise.resolve(mockActivities);
      case "org:update-organization":
        return Promise.resolve({ success: true });
      case "org:delete-organization":
        return Promise.resolve({ success: true });
      default:
        return Promise.resolve(null);
    }
  });
}

describe("OrganizationSettingsPage", () => {
  let wrapper;
  let OrganizationSettingsPage;
  let pinia;

  const createMountOptions = (additionalOptions = {}) => ({
    global: {
      components: {
        ...mockAntdComponents,
      },
      plugins: [pinia],
      ...additionalOptions.global,
    },
    ...additionalOptions,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIpcInvoke.mockReset();

    // Reset identity store to owner
    mockIdentityStore.currentOrgId = "org-123";
    mockIdentityStore.primaryDID = "did:key:user123";
    mockIdentityStore.isOrganizationContext = true;
    mockIdentityStore.organizations = [
      { org_id: "org-123", name: "Test Organization", role: "owner" },
    ];
    mockIdentityStore.leaveOrganization = vi.fn().mockResolvedValue(true);
    mockIdentityStore.switchContext = vi.fn().mockResolvedValue(true);

    // Import Pinia
    const { createPinia, setActivePinia } = await import("pinia");
    pinia = createPinia();
    setActivePinia(pinia);

    // Setup default IPC mock
    setupDefaultIpcMock();

    // Import component
    OrganizationSettingsPage = (
      await import("@renderer/pages/OrganizationSettingsPage.vue")
    ).default;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("1. Component Mounting and Initialization", () => {
    it("should mount successfully and load organization info", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(mockIpcInvoke).toHaveBeenCalledWith(
        "org:get-organization",
        "org-123",
      );
      expect(mockIpcInvoke).toHaveBeenCalledWith("org:get-members", "org-123");
      expect(wrapper.exists()).toBe(true);
    });

    it("should populate orgForm with loaded data", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.orgForm.name).toBe("Test Organization");
      expect(wrapper.vm.orgForm.type).toBe("startup");
      expect(wrapper.vm.orgForm.description).toBe("Test org description");
    });

    it("should populate settingsForm from settings_json", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.settingsForm.visibility).toBe("private");
      expect(wrapper.vm.settingsForm.maxMembers).toBe(100);
      expect(wrapper.vm.settingsForm.allowMemberInvite).toBe(true);
      expect(wrapper.vm.settingsForm.defaultMemberRole).toBe("member");
    });

    it("should load member count", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.memberCount).toBe(3);
    });

    it("should warn if not in organization context", async () => {
      mockIdentityStore.isOrganizationContext = false;

      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();

      expect(mockMessage.warning).toHaveBeenCalledWith(
        expect.stringContaining("切换到组织身份"),
      );
    });
  });

  describe("2. Save Basic Info", () => {
    it("should save basic info via IPC", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      mockIpcInvoke.mockClear();
      setupDefaultIpcMock();

      wrapper.vm.orgForm.name = "Updated Org Name";
      wrapper.vm.orgForm.description = "Updated description";

      await wrapper.vm.handleSaveBasicInfo();
      await nextTick();

      const updateCall = mockIpcInvoke.mock.calls.find(
        (c) => c[0] === "org:update-organization",
      );
      expect(updateCall).toBeTruthy();
      expect(updateCall[1]).toEqual(
        expect.objectContaining({
          orgId: "org-123",
          name: "Updated Org Name",
          description: "Updated description",
        }),
      );
      expect(mockMessage.success).toHaveBeenCalledWith(
        expect.stringContaining("保存成功"),
      );
    });

    it("should show error when save fails", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      mockIpcInvoke.mockClear();
      mockIpcInvoke.mockImplementation((channel) => {
        if (channel === "org:update-organization") {
          return Promise.resolve({ success: false, error: "保存失败" });
        }
        return Promise.resolve(null);
      });

      await wrapper.vm.handleSaveBasicInfo();
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalledWith("保存失败");
    });

    it("should show error when no orgId", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      mockIdentityStore.currentOrgId = null;

      await wrapper.vm.handleSaveBasicInfo();
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalledWith(
        expect.stringContaining("未找到当前组织"),
      );
    });

    it("should handle save exception", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      mockIpcInvoke.mockClear();
      mockIpcInvoke.mockImplementation((channel) => {
        if (channel === "org:update-organization") {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.resolve(null);
      });

      await wrapper.vm.handleSaveBasicInfo();
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalledWith("保存失败");
    });
  });

  describe("3. Save Settings", () => {
    it("should save settings via IPC", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      mockIpcInvoke.mockClear();
      setupDefaultIpcMock();

      await wrapper.vm.handleSaveSettings();
      await nextTick();

      const updateCall = mockIpcInvoke.mock.calls.find(
        (c) => c[0] === "org:update-organization",
      );
      expect(updateCall).toBeTruthy();
      expect(updateCall[1]).toEqual(
        expect.objectContaining({
          orgId: "org-123",
        }),
      );
      expect(mockMessage.success).toHaveBeenCalledWith(
        expect.stringContaining("设置已保存"),
      );
    });

    it("should show error when settings save fails", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      mockIpcInvoke.mockClear();
      mockIpcInvoke.mockImplementation((channel) => {
        if (channel === "org:update-organization") {
          return Promise.resolve({ success: false, error: "保存设置失败" });
        }
        return Promise.resolve(null);
      });

      await wrapper.vm.handleSaveSettings();
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalledWith("保存设置失败");
    });
  });

  describe("4. Organization Deletion", () => {
    it("should open delete modal", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.showDeleteOrgModal).toBe(false);
      wrapper.vm.showDeleteOrgModal = true;
      await nextTick();
      expect(wrapper.vm.showDeleteOrgModal).toBe(true);
    });

    it("should reject deletion when name does not match", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      wrapper.vm.showDeleteOrgModal = true;
      wrapper.vm.deleteConfirmName = "Wrong Name";

      await wrapper.vm.handleDeleteOrg();
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalledWith(
        expect.stringContaining("组织名称不匹配"),
      );
      const deleteCall = mockIpcInvoke.mock.calls.find(
        (c) => c[0] === "org:delete-organization",
      );
      expect(deleteCall).toBeFalsy();
    });

    it("should delete org when name matches and redirect", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      mockIpcInvoke.mockClear();
      setupDefaultIpcMock();

      wrapper.vm.showDeleteOrgModal = true;
      wrapper.vm.deleteConfirmName = "Test Organization";

      await wrapper.vm.handleDeleteOrg();
      await nextTick();

      const deleteCall = mockIpcInvoke.mock.calls.find(
        (c) => c[0] === "org:delete-organization",
      );
      expect(deleteCall).toBeTruthy();
      expect(deleteCall[1]).toBe("org-123");
      expect(deleteCall[2]).toBe("did:key:user123");

      expect(mockMessage.success).toHaveBeenCalledWith(
        expect.stringContaining("组织已删除"),
      );
      expect(wrapper.vm.showDeleteOrgModal).toBe(false);
      expect(mockIdentityStore.switchContext).toHaveBeenCalledWith("personal");
      expect(mockRouter.push).toHaveBeenCalledWith("/");
    });

    it("should handle delete failure", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      mockIpcInvoke.mockClear();
      mockIpcInvoke.mockImplementation((channel) => {
        if (channel === "org:delete-organization") {
          return Promise.reject(new Error("Cannot delete"));
        }
        return Promise.resolve(null);
      });

      wrapper.vm.showDeleteOrgModal = true;
      wrapper.vm.deleteConfirmName = "Test Organization";

      await wrapper.vm.handleDeleteOrg();
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalledWith(
        expect.stringContaining("删除组织失败"),
      );
    });
  });

  describe("5. Permission Checks", () => {
    it("should owner have canManageOrg and isOwner", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.canManageOrg).toBe(true);
      expect(wrapper.vm.isOwner).toBe(true);
    });

    it("should admin have canManageOrg but not isOwner", async () => {
      mockIdentityStore.organizations = [
        { org_id: "org-123", name: "Test Organization", role: "admin" },
      ];

      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.canManageOrg).toBe(true);
      expect(wrapper.vm.isOwner).toBe(false);
    });

    it("should member not have canManageOrg", async () => {
      mockIdentityStore.organizations = [
        { org_id: "org-123", name: "Test Organization", role: "member" },
      ];

      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.canManageOrg).toBe(false);
      expect(wrapper.vm.isOwner).toBe(false);
    });

    it("should viewer not have canManageOrg", async () => {
      mockIdentityStore.organizations = [
        { org_id: "org-123", name: "Test Organization", role: "viewer" },
      ];

      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.canManageOrg).toBe(false);
      expect(wrapper.vm.isOwner).toBe(false);
    });

    it("should show danger zone when canManageOrg", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      const dangerZone = wrapper.find(".danger-zone");
      expect(dangerZone.exists()).toBe(true);
    });

    it("should hide danger zone for member role", async () => {
      mockIdentityStore.organizations = [
        { org_id: "org-123", name: "Test Organization", role: "member" },
      ];

      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      const dangerZone = wrapper.find(".danger-zone");
      expect(dangerZone.exists()).toBe(false);
    });
  });

  describe("6. Error Handling", () => {
    it("should handle load organization info failure", async () => {
      mockIpcInvoke.mockReset();
      mockIpcInvoke.mockRejectedValue(new Error("Failed to load"));

      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(mockMessage.error).toHaveBeenCalledWith(
        expect.stringContaining("加载组织信息失败"),
      );
    });

    it("should handle null response gracefully", async () => {
      mockIpcInvoke.mockReset();
      mockIpcInvoke.mockResolvedValue(null);

      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(wrapper.vm.orgForm.name).toBeDefined();
    });
  });

  describe("7. Navigation", () => {
    it("should navigate to roles page", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      wrapper.vm.handleGoToRolesPage();

      expect(mockRouter.push).toHaveBeenCalledWith("/organization/roles");
    });
  });

  describe("8. Leave Organization", () => {
    it("should show confirm modal and leave org", async () => {
      wrapper = mount(OrganizationSettingsPage, createMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      wrapper.vm.handleLeaveOrg();

      expect(mockModal.confirm).toHaveBeenCalled();
      const confirmCall = mockModal.confirm.mock.calls[0][0];
      expect(confirmCall.title).toContain("确认离开组织");

      // onOk is called automatically by the mock
      await nextTick();
      await nextTick();

      expect(mockIdentityStore.leaveOrganization).toHaveBeenCalledWith(
        "org-123",
      );
    });
  });
});
