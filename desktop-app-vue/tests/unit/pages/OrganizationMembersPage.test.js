import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import OrganizationMembersPage from "@renderer/pages/OrganizationMembersPage.vue";

// Mock ant-design-vue
vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
  Modal: {
    confirm: vi.fn(),
  },
}));

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
};

const mockRoute = {
  params: { orgId: "org-123" },
  query: {},
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRoute,
}));

// Mock identity store
const mockIdentityStore = {
  primaryDID: "did:chainlesschain:currentuser",
  currentOrgId: "org-123",
  isOrganizationContext: true,
  organizations: [
    {
      org_id: "org-123",
      role: "owner",
    },
  ],
};

vi.mock("@/stores/identity", () => ({
  useIdentityStore: () => mockIdentityStore,
}));

// Mock window.ipc
const mockMembers = [
  {
    member_did: "did:chainlesschain:user1",
    display_name: "Alice",
    avatar: "https://example.com/avatar1.jpg",
    role: "owner",
    is_active: true,
    joined_at: 1704067200000,
    last_active_at: 1704153600000,
    permissions_json: '["member.manage", "role.create"]',
  },
  {
    member_did: "did:chainlesschain:user2",
    display_name: "Bob",
    avatar: null,
    role: "admin",
    is_active: true,
    joined_at: 1704067200000,
    last_active_at: null,
    permissions_json: null,
  },
  {
    member_did: "did:chainlesschain:currentuser",
    display_name: "Current User",
    avatar: null,
    role: "member",
    is_active: true,
    joined_at: 1704067200000,
    last_active_at: 1704153600000,
    permissions_json: null,
  },
];

global.window = global.window || {};
global.window.ipc = {
  invoke: vi.fn(),
};

global.navigator = {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
};

describe("OrganizationMembersPage.vue", () => {
  let wrapper;

  const createWrapper = (props = {}) => {
    return mount(OrganizationMembersPage, {
      props,
      global: {
        stubs: {
          "router-link": true,
          "a-space": true,
          "a-button": true,
          "a-input-search": true,
          "a-select": true,
          "a-select-option": true,
          "a-table": true,
          "a-card": true,
          "a-statistic": true,
          "a-avatar": true,
          "a-tag": true,
          "a-tooltip": true,
          "a-badge": true,
          "a-popconfirm": true,
          "a-modal": true,
          "a-form": true,
          "a-form-item": true,
          "a-radio-group": true,
          "a-radio": true,
          "a-input-number": true,
          "a-alert": true,
          "a-descriptions": true,
          "a-descriptions-item": true,
          "a-list": true,
          "a-list-item": true,
          "a-list-item-meta": true,
          TeamOutlined: true,
          UserOutlined: true,
          UserAddOutlined: true,
          SearchOutlined: true,
          EditOutlined: true,
          DeleteOutlined: true,
          EyeOutlined: true,
          CopyOutlined: true,
          CheckCircleOutlined: true,
          CrownOutlined: true,
          SafetyOutlined: true,
          SafetyCertificateOutlined: true,
          HistoryOutlined: true,
          SettingOutlined: true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.ipc.invoke.mockResolvedValue(mockMembers);
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

    it("应该在挂载时加载成员列表", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.ipc.invoke).toHaveBeenCalledWith(
        "org:get-members",
        "org-123",
      );
      expect(wrapper.vm.members).toEqual(mockMembers);
    });

    it("应该设置正确的分页总数", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.pagination.total).toBe(mockMembers.length);
    });

    it("应该在非组织上下文时警告用户", async () => {
      mockIdentityStore.isOrganizationContext = false;
      const { message } = require("ant-design-vue");
      wrapper = createWrapper();

      await wrapper.vm.loadMembers();

      expect(message.warning).toHaveBeenCalledWith("请先切换到组织身份");
      mockIdentityStore.isOrganizationContext = true;
    });

    it("应该处理加载成员失败的情况", async () => {
      window.ipc.invoke.mockRejectedValue(new Error("Network error"));
      const { message } = require("ant-design-vue");
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(message.error).toHaveBeenCalledWith("加载成员列表失败");
    });
  });

  // 统计数据
  describe("Statistics", () => {
    it("应该计算总成员数", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.members.length).toBe(3);
    });

    it("应该计算在线成员数", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.onlineCount).toBe(3);
    });

    it("应该计算管理员数量", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.adminCount).toBe(2); // owner + admin
    });

    it("应该处理空成员列表", async () => {
      window.ipc.invoke.mockResolvedValue([]);
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.onlineCount).toBe(0);
      expect(wrapper.vm.adminCount).toBe(0);
    });
  });

  // 搜索和筛选
  describe("Search and Filter", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能按名称搜索成员", async () => {
      wrapper.vm.searchKeyword = "Alice";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredMembers.length).toBe(1);
      expect(wrapper.vm.filteredMembers[0].display_name).toBe("Alice");
    });

    it("应该能按DID搜索成员", async () => {
      wrapper.vm.searchKeyword = "user1";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredMembers.length).toBe(1);
      expect(wrapper.vm.filteredMembers[0].member_did).toContain("user1");
    });

    it("应该不区分大小写搜索", async () => {
      wrapper.vm.searchKeyword = "alice";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredMembers.length).toBe(1);
      expect(wrapper.vm.filteredMembers[0].display_name).toBe("Alice");
    });

    it("应该能按角色筛选成员", async () => {
      wrapper.vm.roleFilter = "owner";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredMembers.length).toBe(1);
      expect(wrapper.vm.filteredMembers[0].role).toBe("owner");
    });

    it("应该能组合搜索和角色筛选", async () => {
      wrapper.vm.searchKeyword = "user";
      wrapper.vm.roleFilter = "member";
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredMembers;
      expect(filtered.every((m) => m.role === "member")).toBe(true);
    });

    it("应该在清空筛选条件时显示所有成员", async () => {
      wrapper.vm.searchKeyword = "Alice";
      wrapper.vm.roleFilter = "owner";
      await wrapper.vm.$nextTick();

      wrapper.vm.searchKeyword = "";
      wrapper.vm.roleFilter = "";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredMembers.length).toBe(mockMembers.length);
    });
  });

  // 邀请成员
  describe("Invite Member", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能打开邀请对话框", () => {
      wrapper.vm.showInviteModal = true;
      expect(wrapper.vm.showInviteModal).toBe(true);
    });

    it("应该创建邀请码", async () => {
      const { message } = require("ant-design-vue");
      const mockInvitation = {
        invite_code: "ABC123",
      };
      window.ipc.invoke.mockResolvedValue(mockInvitation);

      wrapper.vm.inviteForm = {
        method: "code",
        role: "member",
        maxUses: 10,
        expireOption: "30days",
      };

      await wrapper.vm.handleCreateInvitation();

      expect(window.ipc.invoke).toHaveBeenCalledWith(
        "org:create-invitation",
        "org-123",
        expect.objectContaining({
          invitedBy: "did:chainlesschain:currentuser",
          role: "member",
          maxUses: 10,
        }),
      );
      expect(message.success).toHaveBeenCalledWith("邀请码创建成功");
      expect(wrapper.vm.generatedInviteCode).toBe("ABC123");
    });

    it("应该计算正确的过期时间（1天）", async () => {
      window.ipc.invoke.mockResolvedValue({ invite_code: "CODE123" });

      wrapper.vm.inviteForm.expireOption = "1day";
      await wrapper.vm.handleCreateInvitation();

      const callArgs = window.ipc.invoke.mock.calls[1][2];
      expect(callArgs.expireAt).toBeGreaterThan(Date.now());
    });

    it("应该计算正确的过期时间（7天）", async () => {
      window.ipc.invoke.mockResolvedValue({ invite_code: "CODE123" });

      wrapper.vm.inviteForm.expireOption = "7days";
      await wrapper.vm.handleCreateInvitation();

      const callArgs = window.ipc.invoke.mock.calls[1][2];
      expect(callArgs.expireAt).toBeGreaterThan(Date.now());
    });

    it("应该支持永不过期选项", async () => {
      window.ipc.invoke.mockResolvedValue({ invite_code: "CODE123" });

      wrapper.vm.inviteForm.expireOption = "never";
      await wrapper.vm.handleCreateInvitation();

      const callArgs = window.ipc.invoke.mock.calls[1][2];
      expect(callArgs.expireAt).toBeNull();
    });

    it("应该能复制邀请码", async () => {
      wrapper.vm.generatedInviteCode = "ABC123";
      const { message } = require("ant-design-vue");

      wrapper.vm.copyInviteCode();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABC123");
      expect(message.success).toHaveBeenCalledWith("邀请码已复制到剪贴板");
    });

    it("应该处理创建邀请失败", async () => {
      window.ipc.invoke.mockRejectedValue(new Error("Failed"));
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleCreateInvitation();

      expect(message.error).toHaveBeenCalledWith("创建邀请失败");
    });
  });

  // 修改角色
  describe("Change Role", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能打开修改角色对话框", () => {
      const member = mockMembers[1];
      wrapper.vm.showChangeRoleModal(member);

      expect(wrapper.vm.selectedMember).toEqual(member);
      expect(wrapper.vm.newRole).toBe("admin");
      expect(wrapper.vm.showRoleModal).toBe(true);
    });

    it("应该能更新成员角色", async () => {
      window.ipc.invoke
        .mockResolvedValueOnce(mockMembers)
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(mockMembers);
      const { message } = require("ant-design-vue");

      wrapper.vm.selectedMember = mockMembers[1];
      wrapper.vm.newRole = "member";

      await wrapper.vm.handleUpdateRole();

      expect(window.ipc.invoke).toHaveBeenCalledWith(
        "org:update-member-role",
        "org-123",
        "did:chainlesschain:user2",
        "member",
      );
      expect(message.success).toHaveBeenCalledWith("角色更新成功");
      expect(wrapper.vm.showRoleModal).toBe(false);
    });

    it("应该在角色更新后重新加载成员列表", async () => {
      window.ipc.invoke
        .mockResolvedValueOnce(mockMembers)
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(mockMembers);

      wrapper.vm.selectedMember = mockMembers[1];
      wrapper.vm.newRole = "viewer";

      await wrapper.vm.handleUpdateRole();

      expect(window.ipc.invoke).toHaveBeenCalledWith(
        "org:get-members",
        "org-123",
      );
    });

    it("应该处理更新角色失败", async () => {
      window.ipc.invoke.mockRejectedValue(new Error("Update failed"));
      const { message } = require("ant-design-vue");

      wrapper.vm.selectedMember = mockMembers[1];
      await wrapper.vm.handleUpdateRole();

      expect(message.error).toHaveBeenCalledWith("更新角色失败");
    });
  });

  // 移除成员
  describe("Remove Member", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能移除成员", async () => {
      window.ipc.invoke
        .mockResolvedValueOnce(mockMembers)
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(mockMembers);
      const { message } = require("ant-design-vue");

      const member = mockMembers[1];
      await wrapper.vm.handleRemoveMember(member);

      expect(window.ipc.invoke).toHaveBeenCalledWith(
        "org:remove-member",
        "org-123",
        "did:chainlesschain:user2",
      );
      expect(message.success).toHaveBeenCalledWith("成员已移除");
    });

    it("应该在移除成员后重新加载列表", async () => {
      window.ipc.invoke
        .mockResolvedValueOnce(mockMembers)
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(mockMembers);

      await wrapper.vm.handleRemoveMember(mockMembers[1]);

      expect(window.ipc.invoke).toHaveBeenCalledWith(
        "org:get-members",
        "org-123",
      );
    });

    it("应该处理移除成员失败", async () => {
      window.ipc.invoke.mockRejectedValue(new Error("Remove failed"));
      const { message } = require("ant-design-vue");

      await wrapper.vm.handleRemoveMember(mockMembers[1]);

      expect(message.error).toHaveBeenCalledWith("移除成员失败");
    });
  });

  // 查看成员详情
  describe("View Member Detail", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能打开成员详情对话框", () => {
      const member = mockMembers[0];
      wrapper.vm.showMemberDetail(member);

      expect(wrapper.vm.selectedMember).toEqual(member);
      expect(wrapper.vm.showDetailModal).toBe(true);
    });

    it("应该显示成员的所有信息", () => {
      const member = mockMembers[0];
      wrapper.vm.showMemberDetail(member);

      expect(wrapper.vm.selectedMember.display_name).toBe("Alice");
      expect(wrapper.vm.selectedMember.role).toBe("owner");
      expect(wrapper.vm.selectedMember.is_active).toBe(true);
    });
  });

  // 工具函数
  describe("Utility Functions", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该格式化DID", () => {
      const shortDID = "did:chainlesschain:abc";
      expect(wrapper.vm.formatDID(shortDID)).toBe(shortDID);

      const longDID =
        "did:chainlesschain:verylongidentifierstring12345678901234567890";
      const formatted = wrapper.vm.formatDID(longDID);
      expect(formatted).toContain("...");
      expect(formatted.length).toBeLessThan(longDID.length);
    });

    it("应该处理空DID", () => {
      expect(wrapper.vm.formatDID(null)).toBe("");
      expect(wrapper.vm.formatDID(undefined)).toBe("");
    });

    it("应该格式化时间戳", () => {
      const timestamp = 1704067200000;
      const formatted = wrapper.vm.formatDate(timestamp);
      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe("string");
    });

    it("应该处理空时间戳", () => {
      expect(wrapper.vm.formatDate(null)).toBe("");
      expect(wrapper.vm.formatDate(undefined)).toBe("");
    });

    it("应该返回正确的角色标签", () => {
      expect(wrapper.vm.getRoleLabel("owner")).toBe("所有者");
      expect(wrapper.vm.getRoleLabel("admin")).toBe("管理员");
      expect(wrapper.vm.getRoleLabel("member")).toBe("成员");
      expect(wrapper.vm.getRoleLabel("viewer")).toBe("访客");
    });

    it("应该返回未知角色的原值", () => {
      expect(wrapper.vm.getRoleLabel("unknown")).toBe("unknown");
    });

    it("应该返回正确的角色颜色", () => {
      expect(wrapper.vm.getRoleColor("owner")).toBe("red");
      expect(wrapper.vm.getRoleColor("admin")).toBe("orange");
      expect(wrapper.vm.getRoleColor("member")).toBe("blue");
      expect(wrapper.vm.getRoleColor("viewer")).toBe("default");
    });

    it("应该解析权限JSON", () => {
      const perms = wrapper.vm.parsePermissions('["perm1", "perm2"]');
      expect(perms).toEqual(["perm1", "perm2"]);
    });

    it("应该处理无效的权限JSON", () => {
      const perms = wrapper.vm.parsePermissions("invalid json");
      expect(perms).toEqual([]);
    });

    it("应该处理非数组的权限JSON", () => {
      const perms = wrapper.vm.parsePermissions('{"key": "value"}');
      expect(perms).toEqual([]);
    });

    it("应该获取权限数量", () => {
      const memberWithPerms = {
        role: "admin",
        permissions_json: '["perm1", "perm2"]',
      };
      expect(wrapper.vm.getPermissionCount(memberWithPerms)).toBe(2);
    });

    it("应该返回默认权限数量", () => {
      const ownerMember = { role: "owner", permissions_json: null };
      expect(wrapper.vm.getPermissionCount(ownerMember)).toBe("全部");

      const adminMember = { role: "admin", permissions_json: null };
      expect(wrapper.vm.getPermissionCount(adminMember)).toBe(15);

      const normalMember = { role: "member", permissions_json: null };
      expect(wrapper.vm.getPermissionCount(normalMember)).toBe(8);

      const viewerMember = { role: "viewer", permissions_json: null };
      expect(wrapper.vm.getPermissionCount(viewerMember)).toBe(3);
    });
  });

  // 权限和角色检查
  describe("Permissions and Roles", () => {
    it("应该识别当前用户", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.currentUserDID).toBe("did:chainlesschain:currentuser");
    });

    it("应该识别当前用户角色", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.currentUserRole).toBe("owner");
    });

    it("应该允许管理员管理成员", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canManageMembers).toBe(true);
    });

    it("应该允许管理员邀请成员", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canInviteMembers).toBe(true);
    });

    it("应该在非组织上下文时返回空角色", () => {
      mockIdentityStore.isOrganizationContext = false;
      wrapper = createWrapper();

      expect(wrapper.vm.currentUserRole).toBeNull();
      mockIdentityStore.isOrganizationContext = true;
    });
  });

  // 表格配置
  describe("Table Configuration", () => {
    it("应该有正确的列配置", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.columns).toHaveLength(6);
      expect(wrapper.vm.columns[0].key).toBe("member");
      expect(wrapper.vm.columns[1].key).toBe("role");
      expect(wrapper.vm.columns[2].key).toBe("permissions");
      expect(wrapper.vm.columns[3].key).toBe("status");
      expect(wrapper.vm.columns[4].key).toBe("joined_at");
      expect(wrapper.vm.columns[5].key).toBe("actions");
    });

    it("应该有正确的分页配置", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.pagination.current).toBe(1);
      expect(wrapper.vm.pagination.pageSize).toBe(10);
      expect(wrapper.vm.pagination.showSizeChanger).toBe(true);
      expect(wrapper.vm.pagination.showQuickJumper).toBe(true);
    });
  });

  // 边界情况
  describe("Edge Cases", () => {
    it("应该处理空成员列表", async () => {
      window.ipc.invoke.mockResolvedValue([]);
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.members).toEqual([]);
      expect(wrapper.vm.filteredMembers).toEqual([]);
    });

    it("应该处理成员列表为null", async () => {
      window.ipc.invoke.mockResolvedValue(null);
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.members).toEqual([]);
    });

    it("应该处理缺失avatar的成员", async () => {
      const memberWithoutAvatar = { ...mockMembers[0], avatar: null };
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(memberWithoutAvatar.avatar).toBeNull();
    });

    it("应该处理缺失last_active_at的成员", () => {
      wrapper = createWrapper();
      const member = { ...mockMembers[1], last_active_at: null };

      const formatted = wrapper.vm.formatDate(member.last_active_at);
      expect(formatted).toBe("");
    });

    it("应该处理空搜索关键词", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.searchKeyword = "";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredMembers.length).toBe(mockMembers.length);
    });

    it("应该处理不存在的成员搜索", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.searchKeyword = "NonExistentUser";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredMembers.length).toBe(0);
    });
  });

  // 加载状态
  describe("Loading States", () => {
    it("应该在加载时设置loading状态", async () => {
      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      window.ipc.invoke.mockReturnValue(promise);

      wrapper = createWrapper();
      expect(wrapper.vm.loading).toBe(true);

      resolvePromise(mockMembers);
      await wrapper.vm.$nextTick();
      await promise;

      expect(wrapper.vm.loading).toBe(false);
    });

    it("应该在创建邀请时设置inviteLoading", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      window.ipc.invoke.mockReturnValue(promise);

      const invitePromise = wrapper.vm.handleCreateInvitation();
      expect(wrapper.vm.inviteLoading).toBe(true);

      resolvePromise({ invite_code: "ABC" });
      await invitePromise;

      expect(wrapper.vm.inviteLoading).toBe(false);
    });

    it("应该在更新角色时设置roleLoading", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.selectedMember = mockMembers[1];

      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      window.ipc.invoke.mockReturnValue(promise);

      const updatePromise = wrapper.vm.handleUpdateRole();
      expect(wrapper.vm.roleLoading).toBe(true);

      resolvePromise();
      await updatePromise;

      expect(wrapper.vm.roleLoading).toBe(false);
    });
  });
});
