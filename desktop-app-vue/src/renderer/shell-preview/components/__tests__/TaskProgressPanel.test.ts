import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TaskProgressPanel from "../TaskProgressPanel.vue";
import type { PreviewTaskStep } from "../../../stores/conversation-preview";

function makeSteps(): PreviewTaskStep[] {
  return [
    { id: "t1", label: "Create project config files", status: "done" },
    { id: "t2", label: "Create entry files", status: "done" },
    { id: "t3", label: "Create lib, types, api base layer", status: "running" },
    { id: "t4", label: "Create shadcn/ui primitives", status: "pending" },
    { id: "t5", label: "Create hooks", status: "pending" },
    { id: "t6", label: "Wire routes", status: "pending" },
    { id: "t7", label: "Smoke test", status: "pending" },
  ];
}

describe("TaskProgressPanel", () => {
  it("does not render when steps array is empty", () => {
    const wrapper = mount(TaskProgressPanel, { props: { steps: [] } });
    expect(wrapper.find("[data-testid='task-panel']").exists()).toBe(false);
  });

  it("renders header text as 'Tasks <done>/<total>'", () => {
    const wrapper = mount(TaskProgressPanel, {
      props: { steps: makeSteps() },
    });
    expect(wrapper.find(".cb-tasks__title").text()).toBe("Tasks 2/7");
  });

  it("sets progress bar width to rounded done-over-total percent", () => {
    const wrapper = mount(TaskProgressPanel, {
      props: { steps: makeSteps() },
    });
    const fill = wrapper.find(".cb-tasks__progress-bar") as unknown as {
      element: HTMLElement;
    };
    expect(fill.element.style.width).toBe("29%"); // Math.round(2/7 * 100)
  });

  it("renders one list item per step", () => {
    const wrapper = mount(TaskProgressPanel, {
      props: { steps: makeSteps() },
    });
    expect(wrapper.findAll(".cb-task")).toHaveLength(7);
  });

  it("applies status modifier classes to each item", () => {
    const wrapper = mount(TaskProgressPanel, {
      props: { steps: makeSteps() },
    });
    expect(wrapper.findAll(".cb-task--done")).toHaveLength(2);
    expect(wrapper.findAll(".cb-task--running")).toHaveLength(1);
    expect(wrapper.findAll(".cb-task--pending")).toHaveLength(4);
  });

  it("renders step detail text when provided", () => {
    const steps: PreviewTaskStep[] = [
      {
        id: "s1",
        label: "Create project config files",
        detail: "package.json, tsconfig, vite, tailwind",
        status: "done",
      },
    ];
    const wrapper = mount(TaskProgressPanel, { props: { steps } });
    expect(wrapper.find(".cb-task__detail").text()).toBe(
      "package.json, tsconfig, vite, tailwind",
    );
  });

  it("handles a single pending step without division errors", () => {
    const wrapper = mount(TaskProgressPanel, {
      props: {
        steps: [{ id: "only", label: "one thing", status: "pending" }],
      },
    });
    expect(wrapper.find(".cb-tasks__title").text()).toBe("Tasks 0/1");
    const fill = wrapper.find(".cb-tasks__progress-bar") as unknown as {
      element: HTMLElement;
    };
    expect(fill.element.style.width).toBe("0%");
  });

  it("fully complete list yields 100% width", () => {
    const wrapper = mount(TaskProgressPanel, {
      props: {
        steps: [
          { id: "a", label: "A", status: "done" },
          { id: "b", label: "B", status: "done" },
        ],
      },
    });
    expect(wrapper.find(".cb-tasks__title").text()).toBe("Tasks 2/2");
    const fill = wrapper.find(".cb-tasks__progress-bar") as unknown as {
      element: HTMLElement;
    };
    expect(fill.element.style.width).toBe("100%");
  });
});
