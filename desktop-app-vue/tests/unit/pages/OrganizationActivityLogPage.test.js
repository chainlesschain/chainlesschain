import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import OrganizationActivityLogPage from "@renderer/pages/OrganizationActivityLogPage.vue";
import dayjs from "dayjs";

// Mock ant-design-vue
const mockMessage = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));

vi.mock("ant-design-vue", () => ({
  message: mockMessage,
}));

// Mock vue-router
const mockRouter = {
  back: vi.fn(),
};

const mockRoute = {
  params: { orgId: "org-123" },
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRoute,
}));

// Mock dayjs
vi.mock("dayjs", () => {
  const mockDayjs = vi.fn((timestamp) => ({
    fromNow: vi.fn(() => "2小时前"),
    format: vi.fn(() => "2024-01-01 12:00:00"),
    valueOf: vi.fn(() => timestamp || Date.now()),
  }));
  mockDayjs.extend = vi.fn();
  mockDayjs.locale = vi.fn();
  return { default: mockDayjs };
});

// Mock activities data
const mockActivities = [
  {
    id: 1,
    action: "add_member",
    actor_did: "did:chainlesschain:user1",
    resource_type: "member",
    resource_id: "member-1",
    timestamp: 1704067200000,
    metadata: JSON.stringify({
      display_name: "Alice",
      role: "admin",
    }),
  },
  {
    id: 2,
    action: "create_knowledge",
    actor_did: "did:chainlesschain:user2",
    resource_type: "knowledge",
    resource_id: "kb-1",
    timestamp: 1704153600000,
    metadata: JSON.stringify({
      title: "New Knowledge Base",
    }),
  },
  {
    id: 3,
    action: "update_member_role",
    actor_did: "did:chainlesschain:user1",
    resource_type: "member",
    resource_id: "member-2",
    timestamp: 1704240000000,
    metadata: JSON.stringify({
      member_name: "Bob",
      old_role: "member",
      new_role: "admin",
    }),
  },
];

const mockMembers = [
  {
    member_did: "did:chainlesschain:user1",
    display_name: "Alice",
    avatar: "https://example.com/avatar1.jpg",
    role: "admin",
  },
  {
    member_did: "did:chainlesschain:user2",
    display_name: "Bob",
    avatar: null,
    role: "member",
  },
];

global.window = global.window || {};
global.window.electron = {
  ipcRenderer: {
    invoke: vi.fn(),
  },
};

describe("OrganizationActivityLogPage.vue", () => {
  let wrapper;

  const createWrapper = (props = {}) => {
    return mount(OrganizationActivityLogPage, {
      props,
      global: {
        stubs: {
          "a-page-header": true,
          "a-button": true,
          "a-card": true,
          "a-row": true,
          "a-col": true,
          "a-select": true,
          "a-select-option": true,
          "a-range-picker": true,
          "a-input-search": true,
          "a-table": true,
          "a-space": true,
          "a-avatar": true,
          "a-tag": true,
          "a-typography-text": true,
          "a-tooltip": true,
          "a-modal": true,
          "a-descriptions": true,
          "a-descriptions-item": true,
          ReloadOutlined: true,
          ExportOutlined: true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electron.ipcRenderer.invoke.mockImplementation(
      (channel, ...args) => {
        if (channel === "org:get-activities") {
          return Promise.resolve({
            success: true,
            activities: mockActivities,
          });
        }
        if (channel === "org:get-members") {
          return Promise.resolve({
            success: true,
            members: mockMembers,
          });
        }
        return Promise.resolve({ success: true });
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

    it("应该在挂载时加载活动日志", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-activities",
        expect.objectContaining({
          orgId: "org-123",
          limit: 500,
        }),
      );
      expect(wrapper.vm.activities).toEqual(mockActivities);
    });

    it("应该在挂载时加载成员列表", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-members",
        expect.objectContaining({
          orgId: "org-123",
        }),
      );
      expect(wrapper.vm.members).toEqual(mockMembers);
    });

    it("应该设置正确的分页总数", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.pagination.total).toBe(mockActivities.length);
    });

    it("应该处理加载活动日志失败", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
        error: "Load failed",
      });
      const message = mockMessage;
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(message.error).toHaveBeenCalledWith("Load failed");
    });

    it("应该处理加载活动日志异常", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Network error"),
      );
      const message = mockMessage;
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(message.error).toHaveBeenCalledWith("加载活动日志失败");
    });
  });

  // 筛选功能
  describe("Filtering", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能按操作类型筛选", async () => {
      wrapper.vm.filters.actionType = "add_member";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredActivities.length).toBe(1);
      expect(wrapper.vm.filteredActivities[0].action).toBe("add_member");
    });

    it("应该能按操作者筛选", async () => {
      wrapper.vm.filters.actorDID = "did:chainlesschain:user1";
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredActivities;
      expect(
        filtered.every((a) => a.actor_did === "did:chainlesschain:user1"),
      ).toBe(true);
    });

    it("应该能按日期范围筛选", async () => {
      wrapper.vm.filters.dateRange = [
        { valueOf: () => 1704067200000 },
        { valueOf: () => 1704153600000 },
      ];
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredActivities;
      expect(filtered.length).toBeLessThanOrEqual(2);
    });

    it("应该能按关键词搜索", async () => {
      wrapper.vm.filters.keyword = "alice";
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredActivities;
      expect(filtered.length).toBeGreaterThan(0);
    });

    it("应该能组合多个筛选条件", async () => {
      wrapper.vm.filters.actionType = "add_member";
      wrapper.vm.filters.actorDID = "did:chainlesschain:user1";
      await wrapper.vm.$nextTick();

      const filtered = wrapper.vm.filteredActivities;
      expect(
        filtered.every(
          (a) =>
            a.action === "add_member" &&
            a.actor_did === "did:chainlesschain:user1",
        ),
      ).toBe(true);
    });

    it("应该在筛选条件变化时重置分页", () => {
      wrapper.vm.pagination.current = 5;
      wrapper.vm.handleFilterChange();

      expect(wrapper.vm.pagination.current).toBe(1);
    });

    it("应该处理空筛选条件", async () => {
      wrapper.vm.filters.actionType = "";
      wrapper.vm.filters.actorDID = "";
      wrapper.vm.filters.dateRange = null;
      wrapper.vm.filters.keyword = "";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredActivities.length).toBe(mockActivities.length);
    });
  });

  // 刷新功能
  describe("Refresh", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      vi.clearAllMocks();
    });

    it("应该能刷新活动日志", async () => {
      wrapper.vm.refreshLogs();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:get-activities",
        expect.any(Object),
      );
    });

    it("应该在刷新时显示加载状态", async () => {
      const promise = new Promise((resolve) => setTimeout(resolve, 100));
      window.electron.ipcRenderer.invoke.mockReturnValue(promise);

      wrapper.vm.refreshLogs();
      expect(wrapper.vm.loading).toBe(true);

      await promise;
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  // 导出功能
  describe("Export", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能导出活动日志", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        filePath: "/path/to/export.csv",
      });
      const message = mockMessage;

      await wrapper.vm.exportLogs();

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "org:export-activities",
        expect.objectContaining({
          orgId: "org-123",
          activities: wrapper.vm.filteredActivities,
        }),
      );
      expect(message.success).toHaveBeenCalledWith(
        "活动日志已导出到: /path/to/export.csv",
      );
    });

    it("应该处理导出失败", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: false,
      });
      const message = mockMessage;

      await wrapper.vm.exportLogs();

      expect(message.error).toHaveBeenCalledWith("导出失败");
    });

    it("应该处理导出异常", async () => {
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Export error"),
      );
      const message = mockMessage;

      await wrapper.vm.exportLogs();

      expect(message.error).toHaveBeenCalledWith("导出失败");
    });
  });

  // 详情显示
  describe("Details Modal", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能显示活动详情", () => {
      const activity = mockActivities[0];
      wrapper.vm.showDetails(activity);

      expect(wrapper.vm.selectedActivity).toEqual(activity);
      expect(wrapper.vm.detailsVisible).toBe(true);
    });

    it("应该显示完整的活动信息", () => {
      wrapper.vm.showDetails(mockActivities[0]);

      expect(wrapper.vm.selectedActivity.action).toBe("add_member");
      expect(wrapper.vm.selectedActivity.resource_type).toBe("member");
    });
  });

  // 工具函数测试
  describe("Helper Functions", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能获取操作者名称", () => {
      const name = wrapper.vm.getActorName("did:chainlesschain:user1");
      expect(name).toBe("Alice");
    });

    it("应该能处理未知操作者", () => {
      const name = wrapper.vm.getActorName("did:chainlesschain:unknown");
      expect(name).toContain("...");
    });

    it("应该能获取操作者头像", () => {
      const avatar = wrapper.vm.getActorAvatar("did:chainlesschain:user1");
      expect(avatar).toBe("https://example.com/avatar1.jpg");
    });

    it("应该能处理无头像的操作者", () => {
      const avatar = wrapper.vm.getActorAvatar("did:chainlesschain:user2");
      expect(avatar).toBe("");
    });

    it("应该能获取操作类型标签", () => {
      expect(wrapper.vm.getActionLabel("add_member")).toBe("添加成员");
      expect(wrapper.vm.getActionLabel("create_knowledge")).toBe("创建知识库");
      expect(wrapper.vm.getActionLabel("update_member_role")).toBe("更新角色");
    });

    it("应该返回未知操作的原值", () => {
      expect(wrapper.vm.getActionLabel("unknown_action")).toBe(
        "unknown_action",
      );
    });

    it("应该能获取操作类型颜色", () => {
      expect(wrapper.vm.getActionColor("add_member")).toBe("green");
      expect(wrapper.vm.getActionColor("remove_member")).toBe("red");
      expect(wrapper.vm.getActionColor("update_member_role")).toBe("blue");
    });

    it("应该返回默认颜色对于未知操作", () => {
      expect(wrapper.vm.getActionColor("unknown_action")).toBe("default");
    });

    it("应该能获取资源类型标签", () => {
      expect(wrapper.vm.getResourceTypeLabel("member")).toBe("成员");
      expect(wrapper.vm.getResourceTypeLabel("knowledge")).toBe("知识库");
      expect(wrapper.vm.getResourceTypeLabel("project")).toBe("项目");
    });

    it("应该返回未知资源类型的原值", () => {
      expect(wrapper.vm.getResourceTypeLabel("unknown")).toBe("unknown");
    });

    it("应该能获取角色标签", () => {
      expect(wrapper.vm.getRoleLabel("owner")).toBe("所有者");
      expect(wrapper.vm.getRoleLabel("admin")).toBe("管理员");
      expect(wrapper.vm.getRoleLabel("member")).toBe("成员");
      expect(wrapper.vm.getRoleLabel("viewer")).toBe("访客");
    });
  });

  // 活动详细信息测试
  describe("Activity Details", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该正确解析添加成员活动", () => {
      const activity = mockActivities[0];
      const details = wrapper.vm.getActivityDetails(activity);
      expect(details).toContain("Alice");
      expect(details).toContain("admin");
    });

    it("应该正确解析创建知识库活动", () => {
      const activity = mockActivities[1];
      const details = wrapper.vm.getActivityDetails(activity);
      expect(details).toContain("New Knowledge Base");
    });

    it("应该正确解析更新角色活动", () => {
      const activity = mockActivities[2];
      const details = wrapper.vm.getActivityDetails(activity);
      expect(details).toContain("Bob");
      expect(details).toContain("member");
      expect(details).toContain("admin");
    });

    it("应该处理无效的metadata", () => {
      const activity = {
        ...mockActivities[0],
        metadata: "invalid json",
      };
      const details = wrapper.vm.getActivityDetails(activity);
      expect(details).toBe("invalid json");
    });

    it("应该处理空metadata", () => {
      const activity = {
        ...mockActivities[0],
        metadata: null,
      };
      const details = wrapper.vm.getActivityDetails(activity);
      expect(details).toBe("");
    });

    it("应该处理未知活动类型", () => {
      const activity = {
        ...mockActivities[0],
        action: "unknown_action",
        metadata: JSON.stringify({ key: "value" }),
      };
      const details = wrapper.vm.getActivityDetails(activity);
      expect(details).toContain("key");
    });
  });

  // 时间格式化测试
  describe("Time Formatting", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能格式化相对时间", () => {
      const formatted = wrapper.vm.formatRelativeTime(1704067200000);
      expect(formatted).toBe("2小时前");
    });

    it("应该能格式化完整时间", () => {
      const formatted = wrapper.vm.formatFullTime(1704067200000);
      expect(formatted).toBe("2024-01-01 12:00:00");
    });
  });

  // 成员筛选测试
  describe("Member Filter", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能筛选成员", () => {
      const option = { children: [{ children: "Alice (管理员)" }] };
      const result = wrapper.vm.filterMember("alice", option);
      expect(result).toBe(true);
    });

    it("应该支持不区分大小写筛选", () => {
      const option = { children: [{ children: "Alice (管理员)" }] };
      const result = wrapper.vm.filterMember("ALICE", option);
      expect(result).toBe(true);
    });

    it("应该正确判断不匹配的项", () => {
      const option = { children: [{ children: "Alice (管理员)" }] };
      const result = wrapper.vm.filterMember("bob", option);
      expect(result).toBe(false);
    });
  });

  // 表格变化测试
  describe("Table Change", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该能处理表格分页变化", () => {
      wrapper.vm.handleTableChange({
        current: 3,
        pageSize: 50,
      });

      expect(wrapper.vm.pagination.current).toBe(3);
      expect(wrapper.vm.pagination.pageSize).toBe(50);
    });
  });

  // 加载状态测试
  describe("Loading States", () => {
    it("应该在加载时设置loading状态", async () => {
      let resolvePromise;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      window.electron.ipcRenderer.invoke.mockReturnValue(promise);

      wrapper = createWrapper();
      expect(wrapper.vm.loading).toBe(true);

      resolvePromise({ success: true, activities: [] });
      await wrapper.vm.$nextTick();
      await promise;

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  // 边界情况
  describe("Edge Cases", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该处理空活动列表", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        activities: [],
      });

      await wrapper.vm.loadActivities();

      expect(wrapper.vm.activities).toEqual([]);
      expect(wrapper.vm.filteredActivities).toEqual([]);
    });

    it("应该处理空成员列表", async () => {
      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "org:get-members") {
          return Promise.resolve({ success: true, members: [] });
        }
        return Promise.resolve({ success: true, activities: mockActivities });
      });

      await wrapper.vm.loadMembers();

      expect(wrapper.vm.members).toEqual([]);
    });

    it("应该处理缺失orgId", () => {
      mockRoute.params.orgId = null;
      wrapper = createWrapper();

      expect(wrapper.vm.orgId).toBeNull();
    });

    it("应该处理日期范围为null", async () => {
      wrapper.vm.filters.dateRange = null;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredActivities.length).toBe(mockActivities.length);
    });

    it("应该处理空关键词搜索", async () => {
      wrapper.vm.filters.keyword = "";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredActivities.length).toBe(mockActivities.length);
    });
  });

  // 表格列配置
  describe("Table Columns", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该有正确的列配置", () => {
      expect(wrapper.vm.columns).toHaveLength(6);
      expect(wrapper.vm.columns[0].key).toBe("actor");
      expect(wrapper.vm.columns[1].key).toBe("action");
      expect(wrapper.vm.columns[2].key).toBe("resource_type");
      expect(wrapper.vm.columns[3].key).toBe("details");
      expect(wrapper.vm.columns[4].key).toBe("timestamp");
      expect(wrapper.vm.columns[5].key).toBe("operations");
    });

    it("应该有时间排序功能", () => {
      const timestampColumn = wrapper.vm.columns.find(
        (c) => c.key === "timestamp",
      );
      expect(timestampColumn.sorter).toBeDefined();
    });
  });

  // 分页配置
  describe("Pagination", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
    });

    it("应该有正确的分页配置", () => {
      expect(wrapper.vm.pagination.current).toBe(1);
      expect(wrapper.vm.pagination.pageSize).toBe(20);
      expect(wrapper.vm.pagination.showSizeChanger).toBe(true);
      expect(wrapper.vm.pagination.showQuickJumper).toBe(true);
    });

    it("应该在筛选后更新total", async () => {
      wrapper.vm.filters.actionType = "add_member";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.pagination.total).toBe(
        wrapper.vm.filteredActivities.length,
      );
    });
  });
});
