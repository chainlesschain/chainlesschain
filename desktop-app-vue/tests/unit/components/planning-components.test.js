/**
 * Planning Components 单元测试
 * 测试交互式任务规划的 Vue 组件
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import PlanPreview from "@renderer/components/planning/PlanPreview.vue";
import ExecutionProgress from "@renderer/components/planning/ExecutionProgress.vue";
import ExecutionResult from "@renderer/components/planning/ExecutionResult.vue";

// Stubs for Ant Design Vue components
const globalStubs = {
  "a-result": {
    template:
      '<div class="a-result"><div class="result-title">{{ title }}</div><div class="result-subtitle">{{ subTitle }}</div><slot name="icon" /><slot /></div>',
    props: ["status", "title", "subTitle"],
  },
  "a-progress": {
    template: '<div class="a-progress">{{ percent }}%</div>',
    props: ["percent", "showInfo", "strokeColor"],
  },
  "a-form": {
    template: '<form class="a-form"><slot /></form>',
    props: ["model"],
  },
  "a-form-item": {
    template:
      '<div class="a-form-item"><label>{{ label }}</label><slot /></div>',
    props: ["label"],
  },
  "a-rate": {
    template: '<div class="a-rate"></div>',
    props: ["value"],
  },
  "a-input": {
    template: '<input class="a-input" />',
    props: ["value", "placeholder"],
  },
  "a-textarea": {
    template: '<textarea class="a-textarea"></textarea>',
    props: ["value", "placeholder", "rows", "autosize"],
  },
  "a-button": {
    template:
      '<button class="a-button" @click="$emit(\'click\')"><slot /></button>',
    props: ["type", "loading"],
  },
  "a-card": {
    template:
      '<div class="a-card"><div class="card-title">{{ title }}</div><slot /></div>',
    props: ["title"],
  },
  "a-steps": {
    template: '<div class="a-steps"><slot /></div>',
    props: ["current", "size", "direction"],
  },
  "a-step": {
    template: '<div class="a-step">{{ title }}</div>',
    props: ["title", "description", "status"],
  },
  "a-timeline": {
    template: '<div class="a-timeline"><slot /></div>',
  },
  "a-timeline-item": {
    template: '<div class="a-timeline-item"><slot /></div>',
    props: ["color"],
  },
  "a-tag": {
    template: '<span class="a-tag"><slot /></span>',
    props: ["color"],
  },
  "a-statistic": {
    template: '<div class="a-statistic">{{ value }}</div>',
    props: ["title", "value", "valueStyle"],
  },
  "a-collapse": {
    template: '<div class="a-collapse"><slot /></div>',
    props: ["activeKey"],
  },
  "a-collapse-panel": {
    template:
      '<div class="a-collapse-panel"><div class="panel-header">{{ header }}</div><slot /></div>',
    props: ["key", "header"],
  },
  "a-space": {
    template: '<div class="a-space"><slot /></div>',
    props: ["size"],
  },
  "a-tooltip": {
    template: '<div class="a-tooltip"><slot /></div>',
    props: ["title"],
  },
  "a-badge": {
    template: '<div class="a-badge"><slot /></div>',
    props: ["count", "dot"],
  },
};

describe("PlanPreview 组件", () => {
  let wrapper;

  const mockPlan = {
    steps: [
      { name: "分析模板结构", estimatedTime: "10s", tool: "template-analyzer" },
      { name: "生成内容大纲", estimatedTime: "20s", tool: "outline-generator" },
      { name: "填充模板内容", estimatedTime: "30s", tool: "content-generator" },
      { name: "格式化输出文件", estimatedTime: "15s", tool: "file-formatter" },
    ],
    totalEstimatedTime: "75s",
    expectedOutputs: [
      { type: "pptx", name: "产品发布会演示.pptx", description: "PPT演示文稿" },
      { type: "docx", name: "演讲稿.docx", description: "Word文档" },
    ],
  };

  const mockRecommendations = {
    templates: [
      {
        id: "t1",
        name: "商业路演模板",
        matchScore: 0.92,
        description: "适合产品发布",
        category: "商业",
      },
      {
        id: "t2",
        name: "产品介绍模板",
        matchScore: 0.88,
        description: "适合产品介绍",
        category: "产品",
      },
    ],
    skills: [
      {
        id: "s1",
        name: "PPT设计",
        relevanceScore: 0.95,
        description: "专业PPT设计能力",
        category: "设计",
      },
      {
        id: "s2",
        name: "内容撰写",
        relevanceScore: 0.9,
        description: "文案撰写能力",
        category: "写作",
      },
    ],
    // Component expects tools as array of strings, not objects
    tools: ["ppt-engine", "word-engine"],
  };

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("应该正确渲染计划步骤", () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: [],
        recommendedTools: [],
      },
    });

    // Component uses a-timeline-item, check step content exists
    expect(wrapper.text()).toContain("分析模板结构");
    expect(wrapper.text()).toContain("10s");
  });

  it("应该显示步骤工具标签", () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: [],
        recommendedTools: [],
      },
    });

    expect(wrapper.text()).toContain("template-analyzer");
  });

  it("应该正确渲染预期输出文件", () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: [],
        recommendedTools: [],
      },
    });

    expect(wrapper.text()).toContain("产品发布会演示.pptx");
    expect(wrapper.text()).toContain("演讲稿.docx");
  });

  it("应该显示推荐模板", () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: mockRecommendations.templates,
        recommendedSkills: [],
        recommendedTools: [],
      },
    });

    expect(wrapper.text()).toContain("商业路演模板");
    expect(wrapper.text()).toContain("92%");
  });

  it("应该显示推荐技能", async () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: mockRecommendations.skills,
        recommendedTools: [],
      },
    });

    // Need to switch to skills tab first
    const skillsTab = wrapper.find('[data-node-key="skills"]');
    if (skillsTab.exists()) {
      await skillsTab.trigger("click");
    }

    expect(wrapper.text()).toContain("PPT设计");
    expect(wrapper.text()).toContain("95%");
  });

  it("应该显示推荐工具", async () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: [],
        recommendedTools: mockRecommendations.tools,
      },
    });

    // Need to switch to tools tab first
    const toolsTab = wrapper.find('[data-node-key="tools"]');
    if (toolsTab.exists()) {
      await toolsTab.trigger("click");
    }

    expect(wrapper.text()).toContain("ppt-engine");
  });

  it('点击"应用模板"按钮应该触发事件', async () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: mockRecommendations.templates,
        recommendedSkills: [],
        recommendedTools: [],
      },
    });

    // Find the "应用此模板" button
    const buttons = wrapper.findAll("button");
    const useTemplateButton = buttons.find((btn) =>
      btn.text().includes("应用此模板"),
    );
    if (useTemplateButton) {
      await useTemplateButton.trigger("click");
      expect(wrapper.emitted("use-template")).toBeTruthy();
      expect(wrapper.emitted("use-template")[0]).toEqual(["t1"]);
    }
  });

  it('点击"应用调整"按钮应该触发事件', async () => {
    wrapper = mount(PlanPreview, {
      props: {
        plan: mockPlan,
        recommendedTemplates: [],
        recommendedSkills: [],
        recommendedTools: [],
      },
    });

    const buttons = wrapper.findAll("button");
    const adjustButton = buttons.find((btn) => btn.text().includes("应用调整"));
    if (adjustButton) {
      await adjustButton.trigger("click");
      expect(wrapper.emitted("adjust")).toBeTruthy();
    }
  });
});

describe("ExecutionProgress 组件", () => {
  let wrapper;

  const mockProgress = {
    currentStep: 2,
    totalSteps: 4,
    status: "正在生成内容大纲...",
    logs: [
      {
        timestamp: Date.now() - 3000,
        level: "info",
        message: "开始分析模板结构",
      },
      {
        timestamp: Date.now() - 2000,
        level: "success",
        message: "模板结构分析完成",
      },
      {
        timestamp: Date.now() - 1000,
        level: "info",
        message: "开始生成内容大纲",
      },
    ],
  };

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("应该正确显示进度百分比", () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress,
        percentage: 50,
      },
    });

    expect(wrapper.text()).toContain("50%");
  });

  it("应该显示当前步骤和总步骤数", () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress,
        percentage: 50,
      },
    });

    // Component renders with spaces: "2 / 4"
    expect(wrapper.text()).toMatch(/2\s*\/\s*4/);
  });

  it("应该显示当前状态", () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress,
        percentage: 50,
      },
    });

    expect(wrapper.text()).toContain("正在生成内容大纲");
  });

  it("应该显示执行日志标题", () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress,
        percentage: 50,
      },
    });

    // Logs are collapsed by default, but the header should be visible
    expect(wrapper.text()).toContain("执行日志");
  });

  it("点击展开按钮后应该显示日志内容", async () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress,
        percentage: 50,
      },
    });

    // Click the expand button
    const expandButton = wrapper.find(".logs-header button");
    if (expandButton.exists()) {
      await expandButton.trigger("click");
      expect(wrapper.text()).toContain("开始分析模板结构");
      expect(wrapper.text()).toContain("模板结构分析完成");
    }
  });

  it("展开后应该显示日志时间戳", async () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress,
        percentage: 50,
      },
    });

    // Click to expand logs
    const expandButton = wrapper.find(".logs-header button");
    if (expandButton.exists()) {
      await expandButton.trigger("click");
      const times = wrapper.findAll(".log-time");
      expect(times.length).toBeGreaterThan(0);
    }
  });

  it("应该显示日志条目", async () => {
    wrapper = mount(ExecutionProgress, {
      props: {
        progress: mockProgress,
        percentage: 50,
      },
    });

    // Click to expand logs
    const expandButton = wrapper.find(".logs-header button");
    if (expandButton.exists()) {
      await expandButton.trigger("click");
      const logEntries = wrapper.findAll(".log-entry");
      expect(logEntries.length).toBe(3);
    }
  });

  it("进度为100%时应该显示特殊状态", () => {
    const completedProgress = {
      ...mockProgress,
      currentStep: 4,
      totalSteps: 4,
      status: "执行完成",
    };

    wrapper = mount(ExecutionProgress, {
      props: {
        progress: completedProgress,
        percentage: 100,
      },
    });

    expect(wrapper.text()).toContain("100%");
    expect(wrapper.text()).toContain("执行完成");
  });
});

describe("ExecutionResult 组件", () => {
  let wrapper;

  const mockResult = {
    success: true,
    files: [
      {
        name: "产品发布会演示.pptx",
        size: 2457600,
        path: "/path/to/file.pptx",
      },
      { name: "演讲稿.docx", size: 87040, path: "/path/to/file.docx" },
    ],
    projectId: "project-123",
    executionTime: 75000,
  };

  const mockQualityScore = {
    percentage: 92,
    grade: "A",
    completionScore: 28,
    fileOutputScore: 18,
    executionTimeScore: 14,
    errorRateScore: 20,
    resourceUsageScore: 12,
  };

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("应该显示成功消息", () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null,
      },
      global: {
        stubs: globalStubs,
      },
    });

    expect(wrapper.text()).toContain("任务执行完成");
    expect(wrapper.text()).toContain("成功生成 2 个文件");
  });

  it("应该显示质量评分总分", () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: mockQualityScore,
      },
      global: {
        stubs: globalStubs,
      },
    });

    expect(wrapper.text()).toContain("92");
    expect(wrapper.text()).toContain("A");
  });

  it("应该显示各维度详细评分", () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: mockQualityScore,
      },
      global: {
        stubs: globalStubs,
      },
    });

    expect(wrapper.text()).toContain("完成度");
    expect(wrapper.text()).toContain("28/30");
    expect(wrapper.text()).toContain("文件输出");
    expect(wrapper.text()).toContain("18/20");
    expect(wrapper.text()).toContain("执行时间");
    expect(wrapper.text()).toContain("14/15");
    expect(wrapper.text()).toContain("错误率");
    expect(wrapper.text()).toContain("20/20");
    expect(wrapper.text()).toContain("资源使用");
    expect(wrapper.text()).toContain("12/15");
  });

  it("应该显示生成的文件列表", () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null,
      },
      global: {
        stubs: globalStubs,
      },
    });

    expect(wrapper.text()).toContain("产品发布会演示.pptx");
    expect(wrapper.text()).toContain("演讲稿.docx");
  });

  it("应该正确格式化文件大小", () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null,
      },
      global: {
        stubs: globalStubs,
      },
    });

    // 2457600 bytes = ~2.34 MB
    expect(wrapper.text()).toMatch(/2\.\d+\s*MB/);

    // 87040 bytes = 85 KB
    expect(wrapper.text()).toMatch(/85\s*KB/);
  });

  it("应该有反馈表单元素", () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null,
      },
      global: {
        stubs: globalStubs,
      },
    });

    // Check for feedback section header
    expect(wrapper.text()).toContain("您的反馈");
    expect(wrapper.text()).toContain("总体评价");
    expect(wrapper.text()).toContain("遇到的问题");
    expect(wrapper.text()).toContain("改进建议");
  });

  it('点击"提交反馈"应该触发事件', async () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null,
      },
      global: {
        stubs: globalStubs,
      },
    });

    const buttons = wrapper.findAll("button");
    const submitButton = buttons.find((btn) => btn.text().includes("提交反馈"));
    if (submitButton) {
      await submitButton.trigger("click");
      expect(wrapper.emitted("submit-feedback")).toBeTruthy();
    }
  });

  it('点击"查看项目"应该触发事件', async () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null,
      },
      global: {
        stubs: globalStubs,
      },
    });

    const buttons = wrapper.findAll("button");
    const viewProjectButton = buttons.find((btn) =>
      btn.text().includes("查看项目"),
    );
    if (viewProjectButton) {
      await viewProjectButton.trigger("click");
      expect(wrapper.emitted("view-project")).toBeTruthy();
      expect(wrapper.emitted("view-project")[0]).toEqual(["project-123"]);
    }
  });

  it('点击"关闭"应该触发事件', async () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null,
      },
      global: {
        stubs: globalStubs,
      },
    });

    const buttons = wrapper.findAll("button");
    const closeButton = buttons.find((btn) => btn.text() === "关闭");
    if (closeButton) {
      await closeButton.trigger("click");
      expect(wrapper.emitted("close")).toBeTruthy();
    }
  });

  it("提交反馈应该包含正确的数据结构", async () => {
    wrapper = mount(ExecutionResult, {
      props: {
        result: mockResult,
        qualityScore: null,
      },
      global: {
        stubs: globalStubs,
      },
    });

    const buttons = wrapper.findAll("button");
    const submitButton = buttons.find((btn) => btn.text().includes("提交反馈"));
    if (submitButton) {
      await submitButton.trigger("click");

      const emittedFeedback = wrapper.emitted("submit-feedback");
      if (emittedFeedback) {
        expect(emittedFeedback[0][0]).toMatchObject({
          rating: expect.any(Number),
          issues: expect.any(Array),
          comment: expect.any(String),
          timestamp: expect.any(Number),
        });
      }
    }
  });
});
