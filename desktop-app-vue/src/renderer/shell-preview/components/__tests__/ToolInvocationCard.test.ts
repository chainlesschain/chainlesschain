import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  LoadingOutlined,
} from "@ant-design/icons-vue";
import ToolInvocationCard from "../ToolInvocationCard.vue";
import type { PreviewActionItem } from "../../../stores/conversation-preview";

function makeItem(
  overrides: Partial<PreviewActionItem> = {},
): PreviewActionItem {
  return {
    id: "action-1",
    label: "List current directory",
    detail: undefined,
    status: "done",
    ...overrides,
  };
}

describe("ToolInvocationCard", () => {
  it("renders label and applies done status modifier", () => {
    const wrapper = mount(ToolInvocationCard, {
      props: { item: makeItem() },
    });
    expect(wrapper.text()).toContain("List current directory");
    expect(wrapper.find(".cb-action--done").exists()).toBe(true);
  });

  it("renders CheckCircleFilled when status is done", () => {
    const wrapper = mount(ToolInvocationCard, {
      props: { item: makeItem({ status: "done" }) },
    });
    expect(wrapper.findComponent(CheckCircleFilled).exists()).toBe(true);
    expect(wrapper.findComponent(LoadingOutlined).exists()).toBe(false);
    expect(wrapper.findComponent(ClockCircleOutlined).exists()).toBe(false);
  });

  it("renders LoadingOutlined + running modifier when status is running", () => {
    const wrapper = mount(ToolInvocationCard, {
      props: { item: makeItem({ status: "running" }) },
    });
    expect(wrapper.find(".cb-action--running").exists()).toBe(true);
    expect(wrapper.findComponent(LoadingOutlined).exists()).toBe(true);
    expect(wrapper.findComponent(CheckCircleFilled).exists()).toBe(false);
  });

  it("renders ClockCircleOutlined + pending modifier when status is pending", () => {
    const wrapper = mount(ToolInvocationCard, {
      props: { item: makeItem({ status: "pending" }) },
    });
    expect(wrapper.find(".cb-action--pending").exists()).toBe(true);
    expect(wrapper.findComponent(ClockCircleOutlined).exists()).toBe(true);
    expect(wrapper.findComponent(LoadingOutlined).exists()).toBe(false);
  });

  it("renders raw detail text as a trailing chip when provided", () => {
    const wrapper = mount(ToolInvocationCard, {
      props: { item: makeItem({ detail: "任务拆解完成" }) },
    });
    const detail = wrapper.find(".cb-action__detail");
    expect(detail.exists()).toBe(true);
    expect(detail.text()).toBe("任务拆解完成");
  });

  it("omits detail chip when detail is absent", () => {
    const wrapper = mount(ToolInvocationCard, {
      props: { item: makeItem({ detail: undefined }) },
    });
    expect(wrapper.find(".cb-action__detail").exists()).toBe(false);
  });

  it("exposes a stable data-testid derived from item id", () => {
    const wrapper = mount(ToolInvocationCard, {
      props: { item: makeItem({ id: "action-xyz" }) },
    });
    expect(wrapper.find("[data-testid='tool-card-action-xyz']").exists()).toBe(
      true,
    );
  });
});
