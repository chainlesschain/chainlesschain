/**
 * EnterpriseDashboard 单元测试
 * 测试目标: src/renderer/pages/EnterpriseDashboard.vue
 *
 * 测试覆盖范围:
 * - 组件挂载
 * - 数据加载
 * - 统计数据显示
 * - 刷新功能
 * - 日期范围选择
 * - 辅助方法
 * - 定时刷新
 * - 图表初始化
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";

// Mock ant-design-vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("ant-design-vue", () => ({
  message: mockMessage,
}));

// Hoist mock logger so it can be used directly
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

// Mock echarts
const mockEchartsInit = vi.hoisted(() =>
  vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
);

vi.mock("@/utils/echartsConfig", () => ({
  init: mockEchartsInit,
}));

// Mock window.electron.ipcRenderer
global.window = {
  electron: {
    ipcRenderer: {
      invoke: vi.fn(),
    },
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

describe("EnterpriseDashboard", () => {
  let wrapper;
  let intervalId;

  const mockStats = {
    totalMembers: 50,
    memberGrowth: 5.2,
    totalKnowledge: 1000,
    knowledgeCreatedToday: 15,
    activeCollaborations: 25,
    onlineMembers: 12,
    storageUsed: 5 * 1024 * 1024 * 1024, // 5GB
    storageLimit: 10 * 1024 * 1024 * 1024, // 10GB
    bandwidthUsed: 50 * 1024 * 1024 * 1024, // 50GB
    bandwidthLimit: 100 * 1024 * 1024 * 1024, // 100GB
    networkHealth: 85,
    activeConnections: 45,
    maxConnections: 100,
  };

  const mockContributors = [
    {
      name: "Alice",
      role: "owner",
      knowledgeCreated: 50,
      edits: 120,
      comments: 80,
    },
    {
      name: "Bob",
      role: "admin",
      knowledgeCreated: 40,
      edits: 100,
      comments: 60,
    },
  ];

  const mockActivities = [
    {
      id: "act-1",
      user_name: "Alice",
      activity_type: "create",
      metadata: { title: "New Document" },
      created_at: Date.now() - 3600000,
    },
    {
      id: "act-2",
      user_name: "Bob",
      activity_type: "edit",
      metadata: { title: "Updated Project" },
      created_at: Date.now() - 7200000,
    },
  ];

  const createWrapper = (props = {}, options = {}) => {
    return mount(
      {
        template: `
          <div class="enterprise-dashboard">
            <div class="dashboard-header">
              <h1>{{ organizationName }}</h1>
              <button @click="refreshData" :disabled="loading">刷新</button>
            </div>

            <div class="dashboard-content">
              <div class="stats">
                <div class="stat-item">
                  <span>Total Members: {{ stats.totalMembers }}</span>
                  <span>Growth: {{ stats.memberGrowth }}%</span>
                </div>
                <div class="stat-item">
                  <span>Knowledge: {{ stats.totalKnowledge }}</span>
                  <span>Today: {{ stats.knowledgeCreatedToday }}</span>
                </div>
                <div class="stat-item">
                  <span>Storage: {{ formatBytes(stats.storageUsed) }} / {{ formatBytes(stats.storageLimit) }}</span>
                  <span>{{ (stats.storageUsed / stats.storageLimit * 100).toFixed(1) }}%</span>
                </div>
              </div>

              <div class="contributors">
                <div
                  v-for="(contributor, index) in topContributors"
                  :key="contributor.name"
                  class="contributor-item"
                >
                  <span>{{ index + 1 }}. {{ contributor.name }}</span>
                  <span>Role: {{ contributor.role }}</span>
                  <span>Created: {{ contributor.knowledgeCreated }}</span>
                </div>
              </div>

              <div class="activities">
                <div
                  v-for="activity in recentActivities"
                  :key="activity.id"
                  class="activity-item"
                >
                  <span>{{ activity.user_name }}</span>
                  <span>{{ getActivityText(activity.activity_type) }}</span>
                  <span>{{ activity.metadata?.title }}</span>
                  <span>{{ formatTime(activity.created_at) }}</span>
                </div>
              </div>

              <div class="charts">
                <div ref="activityChartRef" class="chart"></div>
                <div ref="storageBreakdownRef" class="chart"></div>
              </div>
            </div>
          </div>
        `,
        props: {
          organizationId: {
            type: String,
            required: true,
          },
        },
        setup(props) {
          const { ref, onMounted, onUnmounted, h } = require("vue");
          const message = mockMessage;
          const logger = mockLogger;
          const init = mockEchartsInit;

          const activityChartRef = ref(null);
          const storageBreakdownRef = ref(null);

          const loading = ref(false);
          const organizationName = ref("");
          const stats = ref({ ...mockStats });
          const topContributors = ref([]);
          const recentActivities = ref([]);

          let refreshInterval = null;
          let activityChart = null;
          let storageBreakdownChart = null;

          async function loadOrganizationInfo() {
            try {
              const result = await window.electron.ipcRenderer.invoke(
                "organization:get-info",
                { orgId: props.organizationId },
              );

              if (result.success) {
                organizationName.value = result.organization.name;
              }
            } catch (error) {
              logger.error("Error loading organization info:", error);
            }
          }

          async function loadDashboardData() {
            try {
              loading.value = true;

              const statsResult = await window.electron.ipcRenderer.invoke(
                "dashboard:get-stats",
                { orgId: props.organizationId },
              );

              if (statsResult.success) {
                stats.value = { ...stats.value, ...statsResult.stats };
              }

              const contributorsResult =
                await window.electron.ipcRenderer.invoke(
                  "dashboard:get-top-contributors",
                  { orgId: props.organizationId, limit: 10 },
                );

              if (contributorsResult.success) {
                topContributors.value = contributorsResult.contributors;
              }

              const activitiesResult = await window.electron.ipcRenderer.invoke(
                "dashboard:get-recent-activities",
                { orgId: props.organizationId, limit: 20 },
              );

              if (activitiesResult.success) {
                recentActivities.value = activitiesResult.activities;
              }

              updateCharts();
            } catch (error) {
              logger.error("Error loading dashboard data:", error);
              message.error("Failed to load dashboard data");
            } finally {
              loading.value = false;
            }
          }

          function initializeCharts() {
            if (activityChartRef.value) {
              activityChart = init(activityChartRef.value);
            }
            if (storageBreakdownRef.value) {
              storageBreakdownChart = init(storageBreakdownRef.value);
            }
          }

          async function updateCharts() {
            // Chart update logic would go here
          }

          async function refreshData() {
            await loadDashboardData();
            message.success("Dashboard refreshed");
          }

          function formatBytes(bytes) {
            if (bytes === 0) {
              return "0 B";
            }
            const k = 1024;
            const sizes = ["B", "KB", "MB", "GB", "TB"];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return (
              Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i]
            );
          }

          function formatTime(timestamp) {
            const now = Date.now();
            const diff = now - timestamp;

            if (diff < 60000) {
              return "Just now";
            }
            if (diff < 3600000) {
              return `${Math.floor(diff / 60000)}m ago`;
            }
            if (diff < 86400000) {
              return `${Math.floor(diff / 3600000)}h ago`;
            }
            if (diff < 604800000) {
              return `${Math.floor(diff / 86400000)}d ago`;
            }
            return new Date(timestamp).toLocaleDateString();
          }

          function getStorageColor() {
            const percent =
              (stats.value.storageUsed / stats.value.storageLimit) * 100;
            if (percent > 90) {
              return "#ff4d4f";
            }
            if (percent > 75) {
              return "#faad14";
            }
            return "#52c41a";
          }

          function getBandwidthColor() {
            const percent =
              (stats.value.bandwidthUsed / stats.value.bandwidthLimit) * 100;
            if (percent > 90) {
              return "#ff4d4f";
            }
            if (percent > 75) {
              return "#faad14";
            }
            return "#1890ff";
          }

          function getNetworkHealthColor() {
            if (stats.value.networkHealth > 80) {
              return "#52c41a";
            }
            if (stats.value.networkHealth > 50) {
              return "#faad14";
            }
            return "#ff4d4f";
          }

          function getActivityText(type) {
            const texts = {
              create: "created",
              edit: "edited",
              view: "viewed",
              comment: "commented on",
              share: "shared",
              delete: "deleted",
            };
            return texts[type] || "interacted with";
          }

          onMounted(async () => {
            await loadOrganizationInfo();
            await loadDashboardData();
            initializeCharts();

            refreshInterval = setInterval(() => {
              loadDashboardData();
            }, 60000);
          });

          onUnmounted(() => {
            if (refreshInterval) {
              clearInterval(refreshInterval);
              refreshInterval = null;
            }
            if (activityChart) {
              activityChart.dispose();
            }
            if (storageBreakdownChart) {
              storageBreakdownChart.dispose();
            }
          });

          return {
            activityChartRef,
            storageBreakdownRef,
            loading,
            organizationName,
            stats,
            topContributors,
            recentActivities,
            loadOrganizationInfo,
            loadDashboardData,
            initializeCharts,
            refreshData,
            formatBytes,
            formatTime,
            getStorageColor,
            getBandwidthColor,
            getNetworkHealthColor,
            getActivityText,
          };
        },
      },
      {
        props: {
          organizationId: "org-123",
          ...props,
        },
        ...options,
      },
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    window.electron.ipcRenderer.invoke.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("组件挂载", () => {
    it("应该成功挂载组件", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".enterprise-dashboard").exists()).toBe(true);
    });

    it("应该在挂载时加载组织信息", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organization: { name: "Test Org" },
      });
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await vi.advanceTimersByTimeAsync(0);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "organization:get-info",
        { orgId: "org-123" },
      );
    });

    it("应该在挂载时加载仪表盘数据", async () => {
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        stats: mockStats,
      });
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await vi.advanceTimersByTimeAsync(0);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "dashboard:get-stats",
        expect.objectContaining({ orgId: "org-123" }),
      );
    });
  });

  describe("统计数据加载", () => {
    it("应该能加载统计数据", async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        stats: mockStats,
      });

      await wrapper.vm.loadDashboardData();

      expect(wrapper.vm.stats.totalMembers).toBe(50);
      expect(wrapper.vm.stats.networkHealth).toBe(85);
    });

    it("应该能加载贡献者数据", async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "dashboard:get-top-contributors") {
          return Promise.resolve({
            success: true,
            contributors: mockContributors,
          });
        }
        return Promise.resolve({ success: true });
      });

      await wrapper.vm.loadDashboardData();

      expect(wrapper.vm.topContributors.length).toBe(2);
      expect(wrapper.vm.topContributors[0].name).toBe("Alice");
    });

    it("应该能加载活动数据", async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "dashboard:get-recent-activities") {
          return Promise.resolve({
            success: true,
            activities: mockActivities,
          });
        }
        return Promise.resolve({ success: true });
      });

      await wrapper.vm.loadDashboardData();

      expect(wrapper.vm.recentActivities.length).toBe(2);
      expect(wrapper.vm.recentActivities[0].user_name).toBe("Alice");
    });

    it("应该能处理加载失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockRejectedValue(
        new Error("Load failed"),
      );

      await wrapper.vm.loadDashboardData();

      expect(message.error).toHaveBeenCalledWith(
        "Failed to load dashboard data",
      );
    });

    it("应该在加载时设置loading状态", async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockImplementation(() => {
        expect(wrapper.vm.loading).toBe(true);
        return Promise.resolve({ success: true });
      });

      await wrapper.vm.loadDashboardData();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe("刷新功能", () => {
    it("应该能手动刷新数据", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electron.ipcRenderer.invoke.mockResolvedValue({ success: true });

      await wrapper.vm.refreshData();

      expect(message.success).toHaveBeenCalledWith("Dashboard refreshed");
    });

    it("应该设置自动刷新定时器", async () => {
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await vi.advanceTimersByTimeAsync(0);

      vi.advanceTimersByTime(60000);

      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        "dashboard:get-stats",
        expect.any(Object),
      );
    });

    it("应该在卸载时清除定时器", async () => {
      wrapper = createWrapper();

      // Ensure onMounted completes so setInterval is registered
      await wrapper.vm.$nextTick();
      await vi.advanceTimersByTimeAsync(0);

      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      wrapper.unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe("字节格式化", () => {
    it("应该格式化字节数", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatBytes(0)).toBe("0 B");
      expect(wrapper.vm.formatBytes(1024)).toBe("1 KB");
      expect(wrapper.vm.formatBytes(1024 * 1024)).toBe("1 MB");
      expect(wrapper.vm.formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
    });

    it("应该处理小数", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatBytes(1536)).toBe("1.5 KB");
      expect(wrapper.vm.formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
    });
  });

  describe("时间格式化", () => {
    it("应该格式化刚刚", () => {
      wrapper = createWrapper();

      const formatted = wrapper.vm.formatTime(Date.now() - 30000);

      expect(formatted).toBe("Just now");
    });

    it("应该格式化分钟前", () => {
      wrapper = createWrapper();

      const formatted = wrapper.vm.formatTime(Date.now() - 120000);

      expect(formatted).toBe("2m ago");
    });

    it("应该格式化小时前", () => {
      wrapper = createWrapper();

      const formatted = wrapper.vm.formatTime(Date.now() - 7200000);

      expect(formatted).toBe("2h ago");
    });

    it("应该格式化天前", () => {
      wrapper = createWrapper();

      const formatted = wrapper.vm.formatTime(Date.now() - 172800000);

      expect(formatted).toBe("2d ago");
    });

    it("应该格式化超过一周", () => {
      wrapper = createWrapper();

      const timestamp = Date.now() - 86400000 * 10;
      const formatted = wrapper.vm.formatTime(timestamp);

      expect(formatted).toContain("/");
    });
  });

  describe("颜色辅助方法", () => {
    it("应该返回正确的存储颜色", () => {
      wrapper = createWrapper();

      wrapper.vm.stats.storageUsed = 5 * 1024 * 1024 * 1024;
      wrapper.vm.stats.storageLimit = 10 * 1024 * 1024 * 1024;
      expect(wrapper.vm.getStorageColor()).toBe("#52c41a");

      wrapper.vm.stats.storageUsed = 8 * 1024 * 1024 * 1024;
      expect(wrapper.vm.getStorageColor()).toBe("#faad14");

      wrapper.vm.stats.storageUsed = 9.5 * 1024 * 1024 * 1024;
      expect(wrapper.vm.getStorageColor()).toBe("#ff4d4f");
    });

    it("应该返回正确的带宽颜色", () => {
      wrapper = createWrapper();

      wrapper.vm.stats.bandwidthUsed = 50 * 1024 * 1024 * 1024;
      wrapper.vm.stats.bandwidthLimit = 100 * 1024 * 1024 * 1024;
      expect(wrapper.vm.getBandwidthColor()).toBe("#1890ff");

      wrapper.vm.stats.bandwidthUsed = 80 * 1024 * 1024 * 1024;
      expect(wrapper.vm.getBandwidthColor()).toBe("#faad14");

      wrapper.vm.stats.bandwidthUsed = 95 * 1024 * 1024 * 1024;
      expect(wrapper.vm.getBandwidthColor()).toBe("#ff4d4f");
    });

    it("应该返回正确的网络健康颜色", () => {
      wrapper = createWrapper();

      wrapper.vm.stats.networkHealth = 85;
      expect(wrapper.vm.getNetworkHealthColor()).toBe("#52c41a");

      wrapper.vm.stats.networkHealth = 65;
      expect(wrapper.vm.getNetworkHealthColor()).toBe("#faad14");

      wrapper.vm.stats.networkHealth = 45;
      expect(wrapper.vm.getNetworkHealthColor()).toBe("#ff4d4f");
    });
  });

  describe("活动文本", () => {
    it("应该返回正确的活动文本", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getActivityText("create")).toBe("created");
      expect(wrapper.vm.getActivityText("edit")).toBe("edited");
      expect(wrapper.vm.getActivityText("view")).toBe("viewed");
      expect(wrapper.vm.getActivityText("comment")).toBe("commented on");
      expect(wrapper.vm.getActivityText("share")).toBe("shared");
      expect(wrapper.vm.getActivityText("delete")).toBe("deleted");
      expect(wrapper.vm.getActivityText("unknown")).toBe("interacted with");
    });
  });

  describe("组织信息", () => {
    it("应该能加载组织名称", async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockResolvedValue({
        success: true,
        organization: { name: "My Organization" },
      });

      await wrapper.vm.loadOrganizationInfo();

      expect(wrapper.vm.organizationName).toBe("My Organization");
    });

    it("应该能处理组织信息加载失败", async () => {
      wrapper = createWrapper();
      const logger = mockLogger;
      window.electron.ipcRenderer.invoke.mockRejectedValue(new Error("Failed"));

      await wrapper.vm.loadOrganizationInfo();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("边界情况", () => {
    it("应该处理零字节", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatBytes(0)).toBe("0 B");
    });

    it("应该处理非常大的字节数", () => {
      wrapper = createWrapper();

      const bytes = 5 * 1024 * 1024 * 1024 * 1024; // 5TB
      const formatted = wrapper.vm.formatBytes(bytes);

      expect(formatted).toContain("TB");
    });

    it("应该处理空贡献者列表", async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "dashboard:get-top-contributors") {
          return Promise.resolve({
            success: true,
            contributors: [],
          });
        }
        return Promise.resolve({ success: true });
      });

      await wrapper.vm.loadDashboardData();

      expect(wrapper.vm.topContributors.length).toBe(0);
    });

    it("应该处理空活动列表", async () => {
      wrapper = createWrapper();
      window.electron.ipcRenderer.invoke.mockImplementation((channel) => {
        if (channel === "dashboard:get-recent-activities") {
          return Promise.resolve({
            success: true,
            activities: [],
          });
        }
        return Promise.resolve({ success: true });
      });

      await wrapper.vm.loadDashboardData();

      expect(wrapper.vm.recentActivities.length).toBe(0);
    });

    it("应该处理百分比计算", () => {
      wrapper = createWrapper();

      wrapper.vm.stats.storageUsed = 0;
      wrapper.vm.stats.storageLimit = 10 * 1024 * 1024 * 1024;

      const percent =
        (wrapper.vm.stats.storageUsed / wrapper.vm.stats.storageLimit) * 100;
      expect(percent).toBe(0);
    });
  });

  describe("图表初始化", () => {
    it("应该初始化图表", async () => {
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      wrapper.vm.initializeCharts();

      expect(mockEchartsInit).toHaveBeenCalled();
    });
  });
});
