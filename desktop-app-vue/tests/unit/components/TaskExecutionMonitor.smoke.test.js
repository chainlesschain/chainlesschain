import { describe, it, expect, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import TaskExecutionMonitor from "@renderer/components/projects/TaskExecutionMonitor.vue";

describe("TaskExecutionMonitor.vue (smoke, post-util-extraction)", () => {
  it("mounts and the extracted helpers resolve on the instance", () => {
    const wrapper = shallowMount(TaskExecutionMonitor, {
      props: { taskPlan: { subtasks: [], status: "in_progress" } },
    });

    expect(wrapper.vm.getStatusColor("completed")).toBe("success");
    expect(wrapper.vm.getStatusText("failed")).toBe("失败");
    expect(wrapper.vm.getProgressStatus("in_progress")).toBe("active");
    expect(wrapper.vm.getToolLabel("ppt-engine")).toBe("PPT");
    expect(wrapper.vm.formatDuration(45000)).toBe("45秒");
    expect(wrapper.vm.getFileHint("a.docx")).toBe("可编辑文档");

    wrapper.unmount();
  });
});
