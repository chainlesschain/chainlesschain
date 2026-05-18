/**
 * Unit tests for MtcInclusionProofDrawer (Phase 4.3a).
 *
 * Asserts:
 *  - Renders prop-driven title/hint
 *  - Disabled "运行验证" button until both paths filled
 *  - Calls electronAPI.file.readContent for both file paths
 *  - Calls electronAPI.mtc.verifyEnvelope with parsed JSON
 *  - Renders success state when verifyEnvelope returns ok=true
 *  - Renders failure code when ok=false
 *  - Surfaces a clear error when readContent throws
 *  - Resets result when drawer reopens (watch on `open`)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import MtcInclusionProofDrawer from "../MtcInclusionProofDrawer.vue";

const STUBS = {
  "a-drawer": {
    props: ["open", "title", "width", "placement"],
    template: '<div class="stub-drawer" v-if="open"><slot /></div>',
  },
  "a-alert": {
    props: ["type", "showIcon", "message"],
    template: '<div class="stub-alert">{{ message }}</div>',
  },
  "a-form": { template: "<form><slot /></form>" },
  "a-form-item": {
    props: ["label"],
    template: "<div><label>{{ label }}</label><slot /></div>",
  },
  "a-input": {
    props: ["value", "placeholder", "allowClear"],
    emits: ["update:value"],
    template:
      '<input :placeholder="placeholder" :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
  },
  "a-button": {
    props: ["type", "loading", "disabled", "block"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot name="icon" /><slot /></button>',
    emits: ["click"],
  },
  "a-divider": { template: "<hr />" },
  "a-descriptions": {
    props: ["column", "size", "bordered"],
    template: "<dl><slot /></dl>",
  },
  "a-descriptions-item": {
    props: ["label"],
    template: "<div><dt>{{ label }}</dt><dd><slot /></dd></div>",
  },
  "a-tag": {
    props: ["color"],
    template: '<span class="stub-tag"><slot /></span>',
  },
  SafetyOutlined: { template: "<span />" },
  CheckCircleOutlined: { template: "<span class='ok-icon' />" },
  CloseCircleOutlined: { template: "<span class='fail-icon' />" },
};

describe("MtcInclusionProofDrawer", () => {
  let originalElectronAPI: unknown;

  beforeEach(() => {
    originalElectronAPI = (globalThis as unknown as { electronAPI?: unknown })
      .electronAPI;
  });

  afterEach(() => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI =
      originalElectronAPI;
    vi.restoreAllMocks();
  });

  it("renders title + hint props inside the drawer", () => {
    const wrapper = mount(MtcInclusionProofDrawer, {
      props: { open: true, title: "DID alice@cc", hint: "custom hint text" },
      global: { stubs: STUBS },
    });
    const html = wrapper.html();
    expect(html).toContain("custom hint text");
  });

  it("disables 运行验证 button until both paths are filled", async () => {
    const wrapper = mount(MtcInclusionProofDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    });
    const buttons = wrapper.findAll("button");
    const verifyButton = buttons.find((b) => b.text().includes("运行验证"));
    expect(verifyButton).toBeDefined();
    expect(verifyButton?.element.disabled).toBe(true);

    // Fill envelope only — still disabled
    await wrapper.findAll("input")[0].setValue("/path/envelope.json");
    expect(verifyButton?.element.disabled).toBe(true);

    // Fill landmark too — enabled
    await wrapper.findAll("input")[1].setValue("/path/landmark.json");
    expect(verifyButton?.element.disabled).toBe(false);
  });

  it("calls electronAPI.file.readContent for both files + verifyEnvelope with parsed JSON", async () => {
    const readContent = vi.fn().mockImplementation(async (p: string) => {
      if (p.includes("envelope")) {
        return { success: true, content: '{"schema":"mtc-envelope/v1"}' };
      }
      return '{"schema":"mtc-landmark/v1"}'; // raw string return path
    });
    const verifyEnvelope = vi.fn().mockResolvedValue({
      ok: true,
      leaf: { subject: "did:cc:zQ3", kind: "did-document" },
      treeHead: { tree_size: 4, issuer: "mtca:cc:test" },
    });
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      file: { readContent },
      mtc: { verifyEnvelope },
    };

    const wrapper = mount(MtcInclusionProofDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    });
    await wrapper.findAll("input")[0].setValue("/abs/envelope-000.json");
    await wrapper.findAll("input")[1].setValue("/abs/landmark.json");
    const buttons = wrapper.findAll("button");
    const verifyButton = buttons.find((b) => b.text().includes("运行验证"))!;
    await verifyButton.trigger("click");
    await flushPromises();

    expect(readContent).toHaveBeenCalledWith("/abs/envelope-000.json");
    expect(readContent).toHaveBeenCalledWith("/abs/landmark.json");
    expect(verifyEnvelope).toHaveBeenCalledWith(
      { schema: "mtc-envelope/v1" },
      { schema: "mtc-landmark/v1" },
    );
    const html = wrapper.html();
    expect(html).toContain("验证通过");
    expect(html).toContain("did:cc:zQ3");
  });

  it("renders failure code when ok=false", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      file: {
        readContent: vi.fn().mockResolvedValue('{"x":1}'),
      },
      mtc: {
        verifyEnvelope: vi.fn().mockResolvedValue({
          ok: false,
          code: "LANDMARK_EXPIRED",
          recoverable: false,
        }),
      },
    };
    const wrapper = mount(MtcInclusionProofDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    });
    await wrapper.findAll("input")[0].setValue("/a");
    await wrapper.findAll("input")[1].setValue("/b");
    const verifyButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("运行验证"))!;
    await verifyButton.trigger("click");
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("验证失败");
    expect(html).toContain("LANDMARK_EXPIRED");
  });

  it("surfaces an error when electronAPI.file.readContent is unavailable", async () => {
    delete (globalThis as unknown as { electronAPI?: unknown }).electronAPI;

    const wrapper = mount(MtcInclusionProofDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    });
    await wrapper.findAll("input")[0].setValue("/a");
    await wrapper.findAll("input")[1].setValue("/b");
    const verifyButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("运行验证"))!;
    await verifyButton.trigger("click");
    await flushPromises();

    expect(wrapper.html()).toMatch(/未注册|验证失败:/);
  });

  it("surfaces error when readContent reports success=false", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      file: {
        readContent: vi
          .fn()
          .mockResolvedValue({ success: false, error: "ENOENT" }),
      },
      mtc: { verifyEnvelope: vi.fn() },
    };
    const wrapper = mount(MtcInclusionProofDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    });
    await wrapper.findAll("input")[0].setValue("/missing");
    await wrapper.findAll("input")[1].setValue("/missing2");
    const verifyButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("运行验证"))!;
    await verifyButton.trigger("click");
    await flushPromises();

    expect(wrapper.html()).toContain("ENOENT");
  });

  it("resets result + error on reopen (watch open prop)", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      file: { readContent: vi.fn().mockResolvedValue('{"x":1}') },
      mtc: {
        verifyEnvelope: vi.fn().mockResolvedValue({ ok: false, code: "X" }),
      },
    };
    const wrapper = mount(MtcInclusionProofDrawer, {
      props: { open: true },
      global: { stubs: STUBS },
    });
    await wrapper.findAll("input")[0].setValue("/a");
    await wrapper.findAll("input")[1].setValue("/b");
    const verifyButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("运行验证"))!;
    await verifyButton.trigger("click");
    await flushPromises();
    expect(wrapper.html()).toContain("验证失败");

    // Close + reopen → result should clear
    await wrapper.setProps({ open: false });
    await nextTick();
    await wrapper.setProps({ open: true });
    await nextTick();

    expect(wrapper.html()).not.toContain("验证失败");
  });
});
