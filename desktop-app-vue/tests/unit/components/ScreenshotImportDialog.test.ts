/**
 * ScreenshotImportDialog 组件单元测试
 *
 * Verifies tray "截图识别" 菜单项点开后的全链路：
 *   1. 打开 → screenshot.capture → screenshot.ocr 自动串起来
 *   2. capture 失败时显示错误，OCR 不被调
 *   3. 保存调 database.addKnowledgeItem 并清理临时文件
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ScreenshotImportDialog from "@renderer/components/common/ScreenshotImportDialog.vue";

const globalStubs = {
  "a-modal": {
    template:
      '<div class="a-modal-stub" v-if="open"><slot /><button class="ok-btn" @click="$emit(\'ok\')">OK</button><button class="cancel-btn" @click="$emit(\'cancel\')">Cancel</button></div>',
    props: ["open", "title", "width", "okText", "cancelText", "okButtonProps"],
    emits: ["ok", "cancel", "update:open"],
  },
  "a-form": { template: "<form><slot /></form>", props: ["layout", "model"] },
  "a-form-item": {
    template: '<div><slot name="label" /><slot /></div>',
    props: ["label"],
  },
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
    props: ["type", "showIcon", "message"],
  },
  "a-button": {
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    props: ["loading", "disabled", "size"],
    emits: ["click"],
  },
  "a-tag": { template: '<span class="tag"><slot /></span>' },
  "a-spin": { template: "<span />", props: ["size"] },
  CameraOutlined: { template: "<span />" },
  ScanOutlined: { template: "<span />" },
};

const { mockMessage } = vi.hoisted(() => ({
  mockMessage: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("ant-design-vue", () => ({ message: mockMessage }));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@ant-design/icons-vue", () => ({
  CameraOutlined: { template: "<span />" },
  ScanOutlined: { template: "<span />" },
}));

describe("ScreenshotImportDialog.vue", () => {
  beforeEach(() => {
    Object.values(mockMessage).forEach((fn) => fn.mockReset());
    (globalThis as any).window = (globalThis as any).window || globalThis;
    (window as any).electronAPI = {
      screenshot: {
        capture: vi.fn(async () => ({
          success: true,
          path: "/tmp/cc-screenshot-x.png",
          dataUrl: "data:image/png;base64,AAAA",
          bytes: 4,
          displays: 1,
          screenIndex: 0,
        })),
        ocr: vi.fn(async () => ({
          success: true,
          text: "extracted text",
          confidence: 88.0,
          language: "eng+chi_sim",
        })),
        cleanup: vi.fn(async () => ({ success: true })),
      },
      database: {
        addKnowledgeItem: vi.fn(async (item) => ({ id: "kb-1", ...item })),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it("opens → captures → runs OCR → fills textarea", async () => {
    const wrapper = mount(ScreenshotImportDialog, {
      props: { modelValue: true },
      global: { stubs: globalStubs },
    });
    await flushPromises();

    const api = (window as any).electronAPI.screenshot;
    expect(api.capture).toHaveBeenCalledTimes(1);
    expect(api.ocr).toHaveBeenCalledWith({
      path: "/tmp/cc-screenshot-x.png",
    });
    const textarea = wrapper.find("textarea");
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      "extracted text",
    );
  });

  it("shows error and skips OCR when capture fails", async () => {
    (window as any).electronAPI.screenshot.capture = vi.fn(async () => ({
      success: false,
      error: "no display",
    }));
    const wrapper = mount(ScreenshotImportDialog, {
      props: { modelValue: true },
      global: { stubs: globalStubs },
    });
    await flushPromises();

    expect(wrapper.find(".alert").text()).toMatch(/no display/);
    expect((window as any).electronAPI.screenshot.ocr).not.toHaveBeenCalled();
  });

  it("save → addKnowledgeItem + cleanup + close", async () => {
    const wrapper = mount(ScreenshotImportDialog, {
      props: { modelValue: true },
      global: { stubs: globalStubs },
    });
    await flushPromises();

    await wrapper.find(".ok-btn").trigger("click");
    await flushPromises();

    const db = (window as any).electronAPI.database;
    expect(db.addKnowledgeItem).toHaveBeenCalledTimes(1);
    const arg = db.addKnowledgeItem.mock.calls[0][0];
    expect(arg.type).toBe("note");
    expect(arg.content).toBe("extracted text");
    expect(arg.title).toMatch(/截图识别/);
    expect((window as any).electronAPI.screenshot.cleanup).toHaveBeenCalledWith(
      { path: "/tmp/cc-screenshot-x.png" },
    );
    expect(mockMessage.success).toHaveBeenCalledWith("已保存到知识库");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("cancel cleans up the temp file", async () => {
    const wrapper = mount(ScreenshotImportDialog, {
      props: { modelValue: true },
      global: { stubs: globalStubs },
    });
    await flushPromises();

    await wrapper.find(".cancel-btn").trigger("click");
    await flushPromises();

    expect((window as any).electronAPI.screenshot.cleanup).toHaveBeenCalledWith(
      { path: "/tmp/cc-screenshot-x.png" },
    );
  });
});
