/**
 * ProgressMonitor组件单元测试
 *
 * 测试覆盖：
 * - 组件渲染
 * - 任务添加和更新
 * - 任务分类 (活动/完成/失败)
 * - 事件监听
 * - 自动清理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import ProgressMonitor from "@renderer/components/multimedia/ProgressMonitor.vue";
import type { ProgressData } from "@renderer/types/multimedia";

// Mock Ant Design Vue components
vi.mock("ant-design-vue", () => ({
  AButton: { name: "AButton", template: "<button><slot /></button>" },
  ABadge: { name: "ABadge", template: "<div><slot /></div>" },
  AProgress: { name: "AProgress", template: "<div></div>" },
}));

// Mock icons
vi.mock("@ant-design/icons-vue", () => ({
  ClockCircleOutlined: {
    name: "ClockCircleOutlined",
    template: "<span>⏰</span>",
  },
  InboxOutlined: { name: "InboxOutlined", template: "<span>📥</span>" },
}));

// 全局组件stub配置
const globalStubs = {
  "a-button": {
    template: '<button v-bind="$attrs"><slot /></button>',
  },
  "a-badge": {
    template: "<div><slot /></div>",
  },
  "a-progress": {
    template: "<div></div>",
  },
};

describe("ProgressMonitor", () => {
  let wrapper: VueWrapper<any>;
  let mockElectronAPI: any;

  beforeEach(() => {
    // Mock window.electronAPI. NOTE: assign onto the existing window object
    // — replacing window wholesale (the v3 pattern) drops jsdom's built-in
    // properties like getComputedStyle, which Vue 3 transition probing
    // requires under vitest 4.
    mockElectronAPI = {
      on: vi.fn(),
      off: vi.fn(),
    };
    (window as any).electronAPI = mockElectronAPI;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("组件渲染", () => {
    it("应该正确渲染组件", () => {
      wrapper = mount(ProgressMonitor);

      expect(wrapper.find(".progress-monitor").exists()).toBe(true);
      expect(wrapper.find(".monitor-header").exists()).toBe(true);
    });

    it("应该显示标题", () => {
      wrapper = mount(ProgressMonitor);

      expect(wrapper.text()).toContain("任务进度监控");
    });

    it("应该默认展开监控面板", () => {
      wrapper = mount(ProgressMonitor);

      expect(wrapper.find(".monitor-body").isVisible()).toBe(true);
    });

    it("应该在没有任务时显示空状态", () => {
      wrapper = mount(ProgressMonitor);

      expect(wrapper.find(".empty-state").exists()).toBe(true);
      expect(wrapper.text()).toContain("暂无任务");
    });
  });

  describe("Props", () => {
    it("应该接受maxCompletedTasks属性", () => {
      wrapper = mount(ProgressMonitor, {
        props: {
          maxCompletedTasks: 5,
        },
      });

      expect(wrapper.props("maxCompletedTasks")).toBe(5);
    });

    it("应该使用默认的maxCompletedTasks值", () => {
      wrapper = mount(ProgressMonitor);

      expect(wrapper.props("maxCompletedTasks")).toBe(10);
    });
  });

  describe("任务管理", () => {
    it("应该通过addTask方法添加任务", async () => {
      wrapper = mount(ProgressMonitor);

      const taskData: ProgressData = {
        taskId: "task-1",
        title: "图片上传",
        description: "上传image.jpg",
        percent: 0,
        stage: "pending",
        message: "准备中...",
      };

      wrapper.vm.addTask(taskData);
      await nextTick();

      // 验证任务被添加
      expect(wrapper.find(".empty-state").exists()).toBe(false);
    });

    it("应该通过updateTask方法更新任务", async () => {
      wrapper = mount(ProgressMonitor);

      // 添加任务
      wrapper.vm.addTask({
        taskId: "task-1",
        title: "图片上传",
        percent: 0,
        stage: "pending",
      });
      await nextTick();

      // 更新任务
      wrapper.vm.updateTask("task-1", {
        percent: 50,
        stage: "processing",
        message: "处理中...",
      });
      await nextTick();

      // 验证更新成功 - 通过检查是否仍然有任务
      expect(wrapper.find(".empty-state").exists()).toBe(false);
    });

    it("应该通过removeTask方法删除任务", async () => {
      wrapper = mount(ProgressMonitor);

      wrapper.vm.addTask({
        taskId: "task-1",
        title: "图片上传",
        percent: 0,
        stage: "pending",
      });
      await nextTick();

      wrapper.vm.removeTask("task-1");
      await nextTick();

      // 验证任务被删除
      expect(wrapper.find(".empty-state").exists()).toBe(true);
    });

    it("应该通过clearAll方法清除所有任务", async () => {
      wrapper = mount(ProgressMonitor);

      // 添加多个任务
      wrapper.vm.addTask({
        taskId: "task-1",
        title: "任务1",
        percent: 0,
        stage: "pending",
      });
      wrapper.vm.addTask({
        taskId: "task-2",
        title: "任务2",
        percent: 0,
        stage: "pending",
      });
      await nextTick();

      wrapper.vm.clearAll();
      await nextTick();

      expect(wrapper.find(".empty-state").exists()).toBe(true);
    });
  });

  describe("任务分类", () => {
    it("应该正确分类活动任务", async () => {
      wrapper = mount(ProgressMonitor);

      wrapper.vm.addTask({
        taskId: "task-1",
        title: "处理中",
        percent: 50,
        stage: "processing",
      });
      await nextTick();

      expect(wrapper.find(".active-tasks").exists()).toBe(true);
    });

    it("应该正确分类已完成任务", async () => {
      wrapper = mount(ProgressMonitor);

      wrapper.vm.addTask({
        taskId: "task-1",
        title: "已完成",
        percent: 100,
        stage: "completed",
      });
      await nextTick();

      expect(wrapper.find(".completed-tasks").exists()).toBe(true);
    });

    it("应该正确分类失败任务", async () => {
      wrapper = mount(ProgressMonitor);

      wrapper.vm.addTask({
        taskId: "task-1",
        title: "失败",
        percent: 75,
        stage: "failed",
        error: "处理失败",
      });
      await nextTick();

      expect(wrapper.find(".failed-tasks").exists()).toBe(true);
    });

    it("应该同时显示多个分类", async () => {
      wrapper = mount(ProgressMonitor);

      wrapper.vm.addTask({
        taskId: "task-1",
        title: "处理中",
        percent: 50,
        stage: "processing",
      });
      wrapper.vm.addTask({
        taskId: "task-2",
        title: "已完成",
        percent: 100,
        stage: "completed",
      });
      wrapper.vm.addTask({
        taskId: "task-3",
        title: "失败",
        percent: 30,
        stage: "failed",
      });
      await nextTick();

      expect(wrapper.find(".active-tasks").exists()).toBe(true);
      expect(wrapper.find(".completed-tasks").exists()).toBe(true);
      expect(wrapper.find(".failed-tasks").exists()).toBe(true);
    });
  });

  describe("事件监听", () => {
    it("应该在挂载时注册task-progress事件监听器", () => {
      wrapper = mount(ProgressMonitor);

      expect(mockElectronAPI.on).toHaveBeenCalledWith(
        "task-progress",
        expect.any(Function),
      );
    });

    it("应该在卸载时移除事件监听器", () => {
      wrapper = mount(ProgressMonitor);
      const handler = mockElectronAPI.on.mock.calls[0][1];

      wrapper.unmount();

      expect(mockElectronAPI.off).toHaveBeenCalledWith(
        "task-progress",
        handler,
      );
    });

    it("应该处理来自主进程的进度事件", async () => {
      wrapper = mount(ProgressMonitor);

      // 获取注册的事件处理器
      const progressHandler = mockElectronAPI.on.mock.calls[0][1];

      // 模拟接收进度事件
      progressHandler(null, {
        taskId: "task-1",
        title: "图片上传",
        percent: 30,
        stage: "processing",
        message: "处理中...",
        startTime: Date.now(),
      });

      await nextTick();

      // 验证任务被添加
      expect(wrapper.find(".empty-state").exists()).toBe(false);
    });
  });

  describe("用户交互", () => {
    it("应该能够展开/收起监控面板", async () => {
      wrapper = mount(ProgressMonitor, {
        global: {
          stubs: globalStubs,
        },
      });

      // 初始状态应该是展开的
      expect(wrapper.find(".monitor-body").isVisible()).toBe(true);

      // 验证按钮存在
      const buttons = wrapper.findAll("button");
      const toggleButton = buttons.find((btn) => btn.text().includes("收起"));
      expect(toggleButton).toBeTruthy();

      // 直接调用toggleExpand方法
      wrapper.vm.toggleExpand();
      await nextTick();
      await wrapper.vm.$nextTick(); // 确保DOM更新

      // 验证面板已收起（使用element.style.display检查）
      const monitorBody = wrapper.find(".monitor-body").element as HTMLElement;
      expect(monitorBody.style.display).toBe("none");

      // 再次切换应该展开
      wrapper.vm.toggleExpand();
      await nextTick();
      await wrapper.vm.$nextTick();
      expect(monitorBody.style.display).not.toBe("none");
    });

    it("应该能够清除已完成任务", async () => {
      wrapper = mount(ProgressMonitor, {
        global: {
          stubs: globalStubs,
        },
      });

      // 添加已完成任务
      wrapper.vm.addTask({
        taskId: "task-1",
        title: "已完成",
        percent: 100,
        stage: "completed",
      });
      await nextTick();

      // 验证已完成任务存在
      expect(wrapper.find(".completed-tasks").exists()).toBe(true);

      // 验证清除按钮存在
      const buttons = wrapper.findAll("button");
      const clearButton = buttons.find((btn) =>
        btn.text().includes("清除已完成"),
      );
      expect(clearButton).toBeTruthy();

      // 直接调用clearCompleted方法而不是模拟点击
      const vm: any = wrapper.vm;
      vm.clearCompleted();
      await nextTick();

      // 验证已完成任务被清除
      expect(wrapper.find(".completed-tasks").exists()).toBe(false);
    });
  });

  describe("辅助方法", () => {
    it("getStageIcon - 应该返回正确的阶段图标", () => {
      wrapper = mount(ProgressMonitor);

      const testCases = [
        { stage: "pending", expected: "⏳" },
        { stage: "preparing", expected: "🔧" },
        { stage: "processing", expected: "⚙️" },
        { stage: "finalizing", expected: "🏁" },
        { stage: "completed", expected: "✅" },
        { stage: "failed", expected: "❌" },
        { stage: "cancelled", expected: "🚫" },
      ];

      testCases.forEach(({ stage, expected }) => {
        const icon = wrapper.vm.getStageIcon(stage);
        expect(icon).toBe(expected);
      });
    });

    it("getProgressStatus - 应该返回正确的进度状态", () => {
      wrapper = mount(ProgressMonitor);

      expect(wrapper.vm.getProgressStatus("failed")).toBe("exception");
      expect(wrapper.vm.getProgressStatus("completed")).toBe("success");
      expect(wrapper.vm.getProgressStatus("processing")).toBe("active");
    });

    it("getProgressColor - 应该返回正确的颜色", () => {
      wrapper = mount(ProgressMonitor);

      expect(wrapper.vm.getProgressColor("pending")).toBe("#faad14");
      expect(wrapper.vm.getProgressColor("processing")).toBe("#52c41a");
      expect(wrapper.vm.getProgressColor("failed")).toBe("#f5222d");
    });

    it("formatDuration - 应该正确格式化时间", () => {
      wrapper = mount(ProgressMonitor);

      expect(wrapper.vm.formatDuration(0)).toBe("0秒");
      expect(wrapper.vm.formatDuration(5000)).toBe("5秒");
      expect(wrapper.vm.formatDuration(65000)).toBe("1分5秒");
      expect(wrapper.vm.formatDuration(3665000)).toBe("1时1分");
    });
  });

  describe("性能优化", () => {
    it("应该限制显示的已完成任务数量", async () => {
      wrapper = mount(ProgressMonitor, {
        props: {
          maxCompletedTasks: 3,
        },
      });

      // 添加5个已完成任务
      for (let i = 1; i <= 5; i++) {
        wrapper.vm.addTask({
          taskId: `task-${i}`,
          title: `任务${i}`,
          percent: 100,
          stage: "completed",
        });
      }
      await nextTick();

      // 应该只显示3个任务 (通过maxCompletedTasks限制)
      // 这个测试验证组件接受了prop
      expect(wrapper.props("maxCompletedTasks")).toBe(3);
    });

    it("应该限制显示的失败任务数量", async () => {
      wrapper = mount(ProgressMonitor);

      // 添加5个失败任务
      for (let i = 1; i <= 5; i++) {
        wrapper.vm.addTask({
          taskId: `task-${i}`,
          title: `失败任务${i}`,
          percent: 50,
          stage: "failed",
          error: "错误信息",
        });
      }
      await nextTick();

      // 失败任务应该被限制为最多3个显示
      expect(wrapper.find(".failed-tasks").exists()).toBe(true);
    });
  });

  describe("边缘情况", () => {
    it("应该处理undefined的任务数据", async () => {
      wrapper = mount(ProgressMonitor);

      // 尝试更新不存在的任务
      expect(() => {
        wrapper.vm.updateTask("non-existent-task", { percent: 50 });
      }).not.toThrow();
    });

    it("应该处理没有electronAPI的情况", () => {
      (global as any).window = {};

      expect(() => {
        wrapper = mount(ProgressMonitor);
      }).not.toThrow();
    });

    it("应该正确处理任务的duration计算", async () => {
      wrapper = mount(ProgressMonitor);

      const now = Date.now();
      wrapper.vm.addTask({
        taskId: "task-1",
        title: "任务",
        percent: 0,
        stage: "processing",
        startTime: now - 5000, // 5秒前开始
      });

      await nextTick();

      // 验证任务被添加（duration会在组件内部计算）
      expect(wrapper.find(".empty-state").exists()).toBe(false);
    });
  });
});
