/**
 * ClipboardImportDialog 组件单元测试
 *
 * Verifies the tray "剪贴板导入" 菜单项点开后的全链路：
 *   1. open=true 时读 navigator.clipboard.readText() 填充内容
 *   2. 保存调用 electronAPI.database.addKnowledgeItem 并关弹窗
 *   3. 剪贴板为空 / 读失败给出明确提示，不阻塞用户手输
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ClipboardImportDialog from "@renderer/components/common/ClipboardImportDialog.vue";

const globalStubs = {
  "a-modal": {
    template:
      '<div class="a-modal-stub" v-if="open"><div class="title">{{ title }}</div><slot /><button class="ok-btn" @click="$emit(\'ok\')">OK</button><button class="cancel-btn" @click="$emit(\'cancel\')">Cancel</button></div>',
    props: ["open", "title", "width", "okText", "cancelText", "okButtonProps"],
    emits: ["ok", "cancel", "update:open"],
  },
  "a-form": { template: "<form><slot /></form>", props: ["layout", "model"] },
  "a-form-item": { template: "<div><slot /></div>", props: ["label"] },
  "a-input": {
    template:
      '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
    props: ["value", "placeholder", "allowClear"],
    emits: ["update:value"],
  },
  "a-textarea": {
    template:
      '<textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
    props: ["value", "placeholder", "autoSize", "showCount"],
    emits: ["update:value"],
  },
  "a-alert": {
    template: '<div class="alert">{{ message }}</div>',
    props: ["type", "showIcon", "message", "description"],
  },
};

const { mockMessage } = vi.hoisted(() => ({
  mockMessage: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("ant-design-vue", () => ({
  message: mockMessage,
}));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("ClipboardImportDialog.vue", () => {
  beforeEach(() => {
    mockMessage.success.mockReset();
    mockMessage.warning.mockReset();
    mockMessage.error.mockReset();

    // navigator.clipboard 默认 stub —— 单测里按需覆盖
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn(async () => "hello from clipboard") },
    });

    // electronAPI.database stub
    (globalThis as any).window = (globalThis as any).window || globalThis;
    (window as any).electronAPI = {
      database: {
        addKnowledgeItem: vi.fn(async (item) => ({ id: "kb-1", ...item })),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it("opens, reads clipboard, fills content", async () => {
    const wrapper = mount(ClipboardImportDialog, {
      props: { modelValue: true },
      global: { stubs: globalStubs },
    });
    await flushPromises();

    const textarea = wrapper.find("textarea");
    expect(textarea.exists()).toBe(true);
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      "hello from clipboard",
    );
    expect(navigator.clipboard.readText).toHaveBeenCalledTimes(1);
  });

  it("save calls electronAPI.database.addKnowledgeItem and closes", async () => {
    const wrapper = mount(ClipboardImportDialog, {
      props: { modelValue: true },
      global: { stubs: globalStubs },
    });
    await flushPromises();

    await wrapper.find(".ok-btn").trigger("click");
    await flushPromises();

    const fn = (window as any).electronAPI.database.addKnowledgeItem;
    expect(fn).toHaveBeenCalledTimes(1);
    const arg = fn.mock.calls[0][0];
    expect(arg.type).toBe("note");
    expect(arg.content).toBe("hello from clipboard");
    expect(arg.title).toMatch(/剪贴板导入/);
    expect(mockMessage.success).toHaveBeenCalledWith("已保存到知识库");
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual([false]);
    expect(wrapper.emitted("saved")).toBeTruthy();
  });

  it("warns when clipboard read fails but allows manual paste", async () => {
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn(async () => {
          throw new Error("permission denied");
        }),
      },
    });

    const wrapper = mount(ClipboardImportDialog, {
      props: { modelValue: true },
      global: { stubs: globalStubs },
    });
    await flushPromises();

    expect(wrapper.find(".alert").text()).toMatch(/permission denied/);
    // 用户手动输入仍可保存
    await wrapper.find("textarea").setValue("manual content");
    await wrapper.find(".ok-btn").trigger("click");
    await flushPromises();
    expect(
      (window as any).electronAPI.database.addKnowledgeItem,
    ).toHaveBeenCalled();
  });

  it("does not save when content is empty", async () => {
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn(async () => "") },
    });
    const wrapper = mount(ClipboardImportDialog, {
      props: { modelValue: true },
      global: { stubs: globalStubs },
    });
    await flushPromises();

    await wrapper.find(".ok-btn").trigger("click");
    await flushPromises();
    expect(
      (window as any).electronAPI.database.addKnowledgeItem,
    ).not.toHaveBeenCalled();
    expect(mockMessage.warning).toHaveBeenCalledWith("内容为空，无法保存");
  });
});
