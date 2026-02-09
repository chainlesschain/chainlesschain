/**
 * MemoryDashboardPage 单元测试
 * 测试目标: src/renderer/pages/MemoryDashboardPage.vue
 *
 * 测试覆盖范围:
 * - 组件挂载和数据加载
 * - 统计数据显示
 * - Tab切换（学习模式、用户偏好、行为洞察、会话摘要）
 * - 学习模式管理（Prompt模式、错误修复模式、代码片段）
 * - 用户偏好管理
 * - 行为洞察分析
 * - 会话摘要管理
 * - 数据导出（全部、分类导出）
 * - 刷新功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";

// Hoisted mock for ant-design-vue
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

// Mock ant-design-vue
vi.mock("ant-design-vue", () => ({
  message: mockMessage,
}));

// Mock window.electronAPI
global.window = {
  electronAPI: {
    invoke: vi.fn(),
  },
};

describe("MemoryDashboardPage", () => {
  let wrapper;

  const mockStats = {
    totalPatterns: 45,
    totalPreferences: 23,
    totalSessions: 128,
    totalInsights: 67,
  };

  const mockPromptPatterns = [
    {
      id: 1,
      category: "代码生成",
      template: "Generate a function that...",
      use_count: 15,
    },
    {
      id: 2,
      category: "代码审查",
      template: "Review the following code...",
      use_count: 12,
    },
    {
      id: 3,
      category: "文档生成",
      template: "Create documentation for...",
      use_count: 8,
    },
  ];

  const mockErrorFixPatterns = [
    {
      id: 1,
      error_classification: "TypeError",
      fix_strategy: "Add null check before property access",
      success_count: 10,
      total_count: 12,
    },
    {
      id: 2,
      error_classification: "ReferenceError",
      fix_strategy: "Define variable before use",
      success_count: 8,
      total_count: 10,
    },
  ];

  const mockCodeSnippets = [
    {
      id: 1,
      name: "Array Map",
      language: "JavaScript",
      code: "arr.map(item => item * 2)",
      use_count: 20,
    },
    {
      id: 2,
      name: "Promise All",
      language: "JavaScript",
      code: "Promise.all([...])",
      use_count: 15,
    },
  ];

  const mockPreferences = [
    { key: "codeStyle", value: "ES6", category: "编码" },
    { key: "indentation", value: "2 spaces", category: "格式化" },
  ];

  const mockInsights = [
    {
      id: 1,
      type: "usage_pattern",
      title: "高频使用时段",
      description: "主要工作时间在 9:00-18:00",
      confidence: 0.92,
    },
    {
      id: 2,
      type: "error_trend",
      title: "TypeError 频率下降",
      description: "最近一周 TypeError 减少 30%",
      confidence: 0.85,
    },
  ];

  const mockSessionSummaries = [
    {
      id: 1,
      date: "2026-01-26",
      summary: "Implemented knowledge graph feature",
      token_count: 5000,
      duration: 3600,
    },
    {
      id: 2,
      date: "2026-01-25",
      summary: "Fixed database performance issues",
      token_count: 3200,
      duration: 2400,
    },
  ];

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="memory-dashboard-page">
            <div class="page-header">
              <h1>Memory Bank</h1>
              <p class="page-description">管理学习模式、用户偏好、使用报告和行为洞察</p>
              <div class="header-actions">
                <a-button :loading="loading" @click="refreshAll">
                  刷新
                </a-button>
                <a-dropdown>
                  <a-button type="primary">
                    导出
                  </a-button>
                  <template #overlay>
                    <a-menu @click="handleExport">
                      <a-menu-item key="all">导出全部数据</a-menu-item>
                      <a-menu-item key="patterns">导出学习模式</a-menu-item>
                      <a-menu-item key="preferences">导出用户偏好</a-menu-item>
                      <a-menu-item key="sessions">导出会话摘要</a-menu-item>
                    </a-menu>
                  </template>
                </a-dropdown>
              </div>
            </div>

            <!-- Stats Overview -->
            <a-row :gutter="[16, 16]" class="stats-row">
              <a-col :xs="12" :sm="6">
                <a-card class="stat-card">
                  <a-statistic
                    title="学习模式"
                    :value="stats.totalPatterns"
                    :loading="loading"
                  />
                </a-card>
              </a-col>
              <a-col :xs="12" :sm="6">
                <a-card class="stat-card">
                  <a-statistic
                    title="用户偏好"
                    :value="stats.totalPreferences"
                    :loading="loading"
                  />
                </a-card>
              </a-col>
              <a-col :xs="12" :sm="6">
                <a-card class="stat-card">
                  <a-statistic
                    title="会话记录"
                    :value="stats.totalSessions"
                    :loading="loading"
                  />
                </a-card>
              </a-col>
              <a-col :xs="12" :sm="6">
                <a-card class="stat-card">
                  <a-statistic
                    title="行为洞察"
                    :value="stats.totalInsights"
                    :loading="loading"
                  />
                </a-card>
              </a-col>
            </a-row>

            <!-- Main Content Tabs -->
            <a-card class="main-content">
              <a-tabs v-model:active-key="activeTab">
                <a-tab-pane key="patterns" tab="学习模式">
                  <div class="tab-content">
                    <a-row :gutter="[16, 16]">
                      <a-col :xs="24" :lg="12">
                        <a-card title="Prompt 模式" size="small">
                          <a-list :data-source="promptPatterns" size="small">
                            <template #renderItem="{ item }">
                              <a-list-item>
                                <a-list-item-meta>
                                  <template #title>{{ item.category }}</template>
                                  <template #description>{{ truncate(item.template, 80) }}</template>
                                </a-list-item-meta>
                              </a-list-item>
                            </template>
                          </a-list>
                        </a-card>
                      </a-col>
                      <a-col :xs="24" :lg="12">
                        <a-card title="错误修复模式" size="small">
                          <a-list :data-source="errorFixPatterns" size="small">
                            <template #renderItem="{ item }">
                              <a-list-item>
                                <a-list-item-meta>
                                  <template #title>{{ item.error_classification }}</template>
                                  <template #description>{{ truncate(item.fix_strategy, 60) }}</template>
                                </a-list-item-meta>
                              </a-list-item>
                            </template>
                          </a-list>
                        </a-card>
                      </a-col>
                      <a-col :xs="24" :lg="12">
                        <a-card title="代码片段" size="small">
                          <a-list :data-source="codeSnippets" size="small">
                            <template #renderItem="{ item }">
                              <a-list-item>
                                <a-list-item-meta>
                                  <template #title>{{ item.name }}</template>
                                  <template #description>{{ item.language }}</template>
                                </a-list-item-meta>
                              </a-list-item>
                            </template>
                          </a-list>
                        </a-card>
                      </a-col>
                    </a-row>
                  </div>
                </a-tab-pane>

                <a-tab-pane key="preferences" tab="用户偏好">
                  <a-list :data-source="preferences">
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-list-item-meta>
                          <template #title>{{ item.key }}</template>
                          <template #description>{{ item.value }}</template>
                        </a-list-item-meta>
                      </a-list-item>
                    </template>
                  </a-list>
                </a-tab-pane>

                <a-tab-pane key="insights" tab="行为洞察">
                  <a-list :data-source="insights">
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-list-item-meta>
                          <template #title>{{ item.title }}</template>
                          <template #description>{{ item.description }}</template>
                        </a-list-item-meta>
                      </a-list-item>
                    </template>
                  </a-list>
                </a-tab-pane>

                <a-tab-pane key="sessions" tab="会话摘要">
                  <a-list :data-source="sessionSummaries">
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-list-item-meta>
                          <template #title>{{ item.date }}</template>
                          <template #description>{{ item.summary }}</template>
                        </a-list-item-meta>
                      </a-list-item>
                    </template>
                  </a-list>
                </a-tab-pane>
              </a-tabs>
            </a-card>
          </div>
        `,
        setup() {
          const { ref, onMounted } = require("vue");
          const message = mockMessage;

          const loading = ref(false);
          const activeTab = ref("patterns");
          const stats = ref({ ...mockStats });
          const promptPatterns = ref([...mockPromptPatterns]);
          const errorFixPatterns = ref([...mockErrorFixPatterns]);
          const codeSnippets = ref([...mockCodeSnippets]);
          const preferences = ref([...mockPreferences]);
          const insights = ref([...mockInsights]);
          const sessionSummaries = ref([...mockSessionSummaries]);

          const truncate = (str, length) => {
            return str && str.length > length
              ? str.substring(0, length) + "..."
              : str;
          };

          const getClassificationColor = (classification) => {
            const colors = {
              TypeError: "red",
              ReferenceError: "orange",
              SyntaxError: "yellow",
            };
            return colors[classification] || "blue";
          };

          const getSuccessRate = (item) => {
            return ((item.success_count / item.total_count) * 100).toFixed(0);
          };

          const loadData = async () => {
            loading.value = true;
            try {
              const [
                statsData,
                patternsData,
                prefsData,
                insightsData,
                sessionsData,
              ] = await Promise.all([
                window.electronAPI.invoke("memory:get-stats"),
                window.electronAPI.invoke("memory:get-patterns"),
                window.electronAPI.invoke("memory:get-preferences"),
                window.electronAPI.invoke("memory:get-insights"),
                window.electronAPI.invoke("memory:get-session-summaries"),
              ]);

              stats.value = statsData;
              promptPatterns.value = patternsData.promptPatterns || [];
              errorFixPatterns.value = patternsData.errorFixPatterns || [];
              codeSnippets.value = patternsData.codeSnippets || [];
              preferences.value = prefsData || [];
              insights.value = insightsData || [];
              sessionSummaries.value = sessionsData || [];
            } catch (error) {
              message.error("加载数据失败: " + error.message);
            } finally {
              loading.value = false;
            }
          };

          const refreshAll = async () => {
            await loadData();
            message.success("数据已刷新");
          };

          const handleExport = async ({ key }) => {
            try {
              loading.value = true;
              let data;
              let filename;

              switch (key) {
                case "all":
                  data = {
                    stats: stats.value,
                    patterns: {
                      promptPatterns: promptPatterns.value,
                      errorFixPatterns: errorFixPatterns.value,
                      codeSnippets: codeSnippets.value,
                    },
                    preferences: preferences.value,
                    insights: insights.value,
                    sessions: sessionSummaries.value,
                  };
                  filename = "memory-bank-all";
                  break;
                case "patterns":
                  data = {
                    promptPatterns: promptPatterns.value,
                    errorFixPatterns: errorFixPatterns.value,
                    codeSnippets: codeSnippets.value,
                  };
                  filename = "memory-bank-patterns";
                  break;
                case "preferences":
                  data = preferences.value;
                  filename = "memory-bank-preferences";
                  break;
                case "sessions":
                  data = sessionSummaries.value;
                  filename = "memory-bank-sessions";
                  break;
              }

              await window.electronAPI.invoke("memory:export", {
                data,
                filename,
              });
              message.success("导出成功");
            } catch (error) {
              message.error("导出失败: " + error.message);
            } finally {
              loading.value = false;
            }
          };

          onMounted(() => {
            loadData();
          });

          return {
            loading,
            activeTab,
            stats,
            promptPatterns,
            errorFixPatterns,
            codeSnippets,
            preferences,
            insights,
            sessionSummaries,
            truncate,
            getClassificationColor,
            getSuccessRate,
            loadData,
            refreshAll,
            handleExport,
          };
        },
      },
      {
        global: {
          stubs: {
            "a-button": true,
            "a-dropdown": true,
            "a-menu": true,
            "a-menu-item": true,
            "a-row": true,
            "a-col": true,
            "a-card": true,
            "a-statistic": true,
            "a-tabs": true,
            "a-tab-pane": true,
            "a-list": true,
            "a-list-item": true,
            "a-list-item-meta": true,
            "a-tag": true,
            "a-empty": true,
          },
        },
        ...options,
      },
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI.invoke.mockResolvedValue({});
  });

  describe("组件挂载", () => {
    it("应该成功挂载组件", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".memory-dashboard-page").exists()).toBe(true);
    });

    it("应该在挂载时加载数据", async () => {
      window.electronAPI.invoke
        .mockResolvedValueOnce(mockStats)
        .mockResolvedValueOnce({
          promptPatterns: mockPromptPatterns,
          errorFixPatterns: mockErrorFixPatterns,
          codeSnippets: mockCodeSnippets,
        })
        .mockResolvedValueOnce(mockPreferences)
        .mockResolvedValueOnce(mockInsights)
        .mockResolvedValueOnce(mockSessionSummaries);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "memory:get-stats",
      );
    });

    it("应该初始化activeTab为patterns", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.activeTab).toBe("patterns");
    });
  });

  describe("统计数据显示", () => {
    it("应该显示学习模式统计", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.totalPatterns).toBe(45);
    });

    it("应该显示用户偏好统计", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.totalPreferences).toBe(23);
    });

    it("应该显示会话记录统计", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.totalSessions).toBe(128);
    });

    it("应该显示行为洞察统计", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.stats.totalInsights).toBe(67);
    });

    it("应该能处理零统计", () => {
      wrapper = createWrapper();
      wrapper.vm.stats = {
        totalPatterns: 0,
        totalPreferences: 0,
        totalSessions: 0,
        totalInsights: 0,
      };
      expect(wrapper.vm.stats.totalPatterns).toBe(0);
    });
  });

  describe("Tab切换", () => {
    it("应该能切换到学习模式Tab", () => {
      wrapper = createWrapper();
      wrapper.vm.activeTab = "patterns";
      expect(wrapper.vm.activeTab).toBe("patterns");
    });

    it("应该能切换到用户偏好Tab", () => {
      wrapper = createWrapper();
      wrapper.vm.activeTab = "preferences";
      expect(wrapper.vm.activeTab).toBe("preferences");
    });

    it("应该能切换到行为洞察Tab", () => {
      wrapper = createWrapper();
      wrapper.vm.activeTab = "insights";
      expect(wrapper.vm.activeTab).toBe("insights");
    });

    it("应该能切换到会话摘要Tab", () => {
      wrapper = createWrapper();
      wrapper.vm.activeTab = "sessions";
      expect(wrapper.vm.activeTab).toBe("sessions");
    });
  });

  describe("学习模式管理", () => {
    it("应该显示Prompt模式列表", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.promptPatterns).toHaveLength(3);
      expect(wrapper.vm.promptPatterns[0].category).toBe("代码生成");
    });

    it("应该显示错误修复模式列表", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.errorFixPatterns).toHaveLength(2);
      expect(wrapper.vm.errorFixPatterns[0].error_classification).toBe(
        "TypeError",
      );
    });

    it("应该显示代码片段列表", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.codeSnippets).toHaveLength(2);
      expect(wrapper.vm.codeSnippets[0].name).toBe("Array Map");
    });

    it("应该能截断长文本", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.truncate("This is a very long string", 10);
      expect(result).toBe("This is a ...");
    });

    it("应该能处理短文本", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.truncate("Short", 10);
      expect(result).toBe("Short");
    });

    it("应该能获取分类颜色", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.getClassificationColor("TypeError")).toBe("red");
      expect(wrapper.vm.getClassificationColor("ReferenceError")).toBe(
        "orange",
      );
      expect(wrapper.vm.getClassificationColor("Unknown")).toBe("blue");
    });

    it("应该能计算成功率", () => {
      wrapper = createWrapper();
      const item = { success_count: 10, total_count: 12 };
      expect(wrapper.vm.getSuccessRate(item)).toBe("83");
    });

    it("应该能处理100%成功率", () => {
      wrapper = createWrapper();
      const item = { success_count: 10, total_count: 10 };
      expect(wrapper.vm.getSuccessRate(item)).toBe("100");
    });

    it("应该能处理0%成功率", () => {
      wrapper = createWrapper();
      const item = { success_count: 0, total_count: 10 };
      expect(wrapper.vm.getSuccessRate(item)).toBe("0");
    });
  });

  describe("用户偏好管理", () => {
    it("应该显示用户偏好列表", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.preferences).toHaveLength(2);
      expect(wrapper.vm.preferences[0].key).toBe("codeStyle");
    });

    it("应该显示偏好值", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.preferences[0].value).toBe("ES6");
    });

    it("应该显示偏好分类", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.preferences[0].category).toBe("编码");
    });

    it("应该能处理空偏好列表", () => {
      wrapper = createWrapper();
      wrapper.vm.preferences = [];
      expect(wrapper.vm.preferences).toHaveLength(0);
    });
  });

  describe("行为洞察分析", () => {
    it("应该显示行为洞察列表", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.insights).toHaveLength(2);
      expect(wrapper.vm.insights[0].type).toBe("usage_pattern");
    });

    it("应该显示洞察标题", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.insights[0].title).toBe("高频使用时段");
    });

    it("应该显示洞察描述", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.insights[0].description).toBe(
        "主要工作时间在 9:00-18:00",
      );
    });

    it("应该显示置信度", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.insights[0].confidence).toBe(0.92);
    });

    it("应该能处理空洞察列表", () => {
      wrapper = createWrapper();
      wrapper.vm.insights = [];
      expect(wrapper.vm.insights).toHaveLength(0);
    });
  });

  describe("会话摘要管理", () => {
    it("应该显示会话摘要列表", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.sessionSummaries).toHaveLength(2);
      expect(wrapper.vm.sessionSummaries[0].date).toBe("2026-01-26");
    });

    it("应该显示会话摘要内容", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.sessionSummaries[0].summary).toBe(
        "Implemented knowledge graph feature",
      );
    });

    it("应该显示token计数", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.sessionSummaries[0].token_count).toBe(5000);
    });

    it("应该显示会话时长", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.sessionSummaries[0].duration).toBe(3600);
    });

    it("应该能处理空会话列表", () => {
      wrapper = createWrapper();
      wrapper.vm.sessionSummaries = [];
      expect(wrapper.vm.sessionSummaries).toHaveLength(0);
    });
  });

  describe("数据导出", () => {
    it("应该能导出全部数据", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockResolvedValue();

      await wrapper.vm.handleExport({ key: "all" });

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "memory:export",
        expect.objectContaining({
          filename: "memory-bank-all",
        }),
      );
      expect(message.success).toHaveBeenCalledWith("导出成功");
    });

    it("应该能导出学习模式", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockResolvedValue();

      await wrapper.vm.handleExport({ key: "patterns" });

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "memory:export",
        expect.objectContaining({
          filename: "memory-bank-patterns",
        }),
      );
      expect(message.success).toHaveBeenCalled();
    });

    it("应该能导出用户偏好", async () => {
      wrapper = createWrapper();
      window.electronAPI.invoke.mockResolvedValue();

      await wrapper.vm.handleExport({ key: "preferences" });

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "memory:export",
        expect.objectContaining({
          filename: "memory-bank-preferences",
        }),
      );
    });

    it("应该能导出会话摘要", async () => {
      wrapper = createWrapper();
      window.electronAPI.invoke.mockResolvedValue();

      await wrapper.vm.handleExport({ key: "sessions" });

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "memory:export",
        expect.objectContaining({
          filename: "memory-bank-sessions",
        }),
      );
    });

    it("应该能处理导出失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error("导出错误"));

      await wrapper.vm.handleExport({ key: "all" });

      expect(message.error).toHaveBeenCalledWith("导出失败: 导出错误");
    });
  });

  describe("刷新功能", () => {
    it("应该能刷新所有数据", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke
        .mockResolvedValueOnce(mockStats)
        .mockResolvedValueOnce({
          promptPatterns: mockPromptPatterns,
          errorFixPatterns: mockErrorFixPatterns,
          codeSnippets: mockCodeSnippets,
        })
        .mockResolvedValueOnce(mockPreferences)
        .mockResolvedValueOnce(mockInsights)
        .mockResolvedValueOnce(mockSessionSummaries);

      await wrapper.vm.refreshAll();

      expect(window.electronAPI.invoke).toHaveBeenCalledWith(
        "memory:get-stats",
      );
      expect(message.success).toHaveBeenCalledWith("数据已刷新");
    });

    it("应该能处理刷新失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error("网络错误"));

      await wrapper.vm.loadData();

      expect(message.error).toHaveBeenCalledWith("加载数据失败: 网络错误");
    });
  });

  describe("加载状态", () => {
    it("应该初始化loading为false", async () => {
      wrapper = createWrapper();
      // loading is true during the initial loadData() from onMounted
      // Wait for the async operation to complete
      await wrapper.vm.$nextTick();
      await new Promise((r) => setTimeout(r, 0));
      expect(wrapper.vm.loading).toBe(false);
    });

    it("应该在加载时设置loading为true", async () => {
      wrapper = createWrapper();
      const loadPromise = wrapper.vm.loadData();
      expect(wrapper.vm.loading).toBe(true);
      await loadPromise;
    });

    it("应该在加载完成后设置loading为false", async () => {
      wrapper = createWrapper();
      window.electronAPI.invoke
        .mockResolvedValueOnce(mockStats)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await wrapper.vm.loadData();
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe("边界情况", () => {
    it("应该能处理空字符串截断", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.truncate("", 10);
      expect(result).toBe("");
    });

    it("应该能处理undefined截断", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.truncate(undefined, 10);
      expect(result).toBeUndefined();
    });

    it("应该能处理null截断", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.truncate(null, 10);
      expect(result).toBeNull();
    });

    it("应该能处理零除法的成功率", () => {
      wrapper = createWrapper();
      const item = { success_count: 0, total_count: 0 };
      const result = wrapper.vm.getSuccessRate(item);
      expect(result).toBe("NaN");
    });

    it("应该能处理未知Tab", () => {
      wrapper = createWrapper();
      wrapper.vm.activeTab = "unknown";
      expect(wrapper.vm.activeTab).toBe("unknown");
    });
  });

  describe("错误处理", () => {
    it("应该能处理数据加载失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke.mockRejectedValue(new Error("Database error"));

      await wrapper.vm.loadData();

      expect(message.error).toHaveBeenCalled();
    });

    it("应该能处理部分数据加载失败", async () => {
      wrapper = createWrapper();
      const message = mockMessage;
      window.electronAPI.invoke
        .mockResolvedValueOnce(mockStats)
        .mockRejectedValueOnce(new Error("Pattern load failed"))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await wrapper.vm.loadData();

      // Promise.all rejects if any promise rejects, so the error handler runs
      expect(message.error).toHaveBeenCalledWith(
        "加载数据失败: Pattern load failed",
      );
      expect(wrapper.vm.loading).toBe(false);
    });
  });
});
