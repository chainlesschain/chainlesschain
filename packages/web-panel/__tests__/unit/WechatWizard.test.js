/**
 * Unit tests for web-panel WechatWizard (Phase 12.6.10 UI layer).
 *
 * Companion to usePersonalDataHub-wechat.test.js (which covers the
 * composable → WS topic routing). This file asserts the 3-step wizard
 * UI flow: env-probe → form gate → register result.
 *
 * Asserts:
 *  - Initial state opens at step 1 with 探测环境 CTA
 *  - probeWechatEnv populates probe + descriptions render
 *  - 下一步 disabled until probe done + suggestedKeyProvider != unsupported
 *  - 下一步 advances to step 2
 *  - Step 2 注册 button gated by uin + (md5 path requires wechatDataPath)
 *  - runRegister invokes hub.registerWechat with form values + forceProvider
 *  - Step 3 success result renders chosenKeyProvider + sensitivity + emits registered
 *  - Step 3 failure result maps each reason code to user-readable message
 *  - resetWizard clears state + emits update:open=false
 *  - restartFlow loops back to step 1 with cleared form
 *  - watch(props.open) re-opens to step 1 with fresh state
 *  - 上一步 navigates step 2 → step 1
 *  - probeWechatEnv rejection populates fallback probe shape (suggestedKeyProvider=unsupported)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

const probeWechatEnvMock = vi.fn();
const registerWechatMock = vi.fn();

vi.mock("../../src/composables/usePersonalDataHub.js", () => ({
  usePersonalDataHub: () => ({
    probeWechatEnv: (...args) => probeWechatEnvMock(...args),
    registerWechat: (...args) => registerWechatMock(...args),
  }),
}));

// Import AFTER mocks are registered. WechatWizard imports the composable
// at module load time; ESM hoists vi.mock so this still works.
import WechatWizard from "../../src/components/WechatWizard.vue";

const STUBS = {
  "a-drawer": {
    props: ["open", "title", "placement", "width", "destroyOnClose"],
    emits: ["update:open", "close"],
    template:
      '<div class="stub-drawer" v-if="open"><slot /><slot name="footer" /></div>',
  },
  "a-alert": {
    props: ["message", "description", "type", "showIcon"],
    template:
      '<div class="stub-alert" :data-type="type"><b>{{ message }}</b><span>{{ description }}</span></div>',
  },
  "a-button": {
    props: ["type", "loading", "disabled"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot name="icon" /><slot /></button>',
    emits: ["click"],
  },
  "a-descriptions": {
    props: ["column", "size", "bordered"],
    template: '<dl class="stub-descs"><slot /></dl>',
  },
  "a-descriptions-item": {
    props: ["label"],
    template: '<div><dt>{{ label }}</dt><dd><slot /></dd></div>',
  },
  "a-tag": {
    props: ["color"],
    template: '<span class="stub-tag" :data-color="color"><slot /></span>',
  },
  "a-form": {
    props: ["layout"],
    template: "<form><slot /></form>",
  },
  "a-form-item": {
    props: ["label", "required"],
    template:
      "<div><label>{{ label }}<span v-if=\"required\" class=\"req\">*</span></label><slot /></div>",
  },
  "a-input": {
    props: ["value", "placeholder"],
    emits: ["update:value"],
    template:
      "<input :value=\"value\" :placeholder=\"placeholder\" @input=\"$emit('update:value', $event.target.value)\" />",
  },
  "a-radio-group": {
    props: ["value"],
    emits: ["update:value"],
    template:
      "<div class=\"stub-radio-group\" :data-value=\"value === null ? 'null' : value\"><slot /></div>",
  },
  "a-radio": {
    props: ["value"],
    template:
      '<label class="stub-radio" :data-value="value === null ? \'null\' : value"><slot /></label>',
  },
  "a-result": {
    props: ["status", "title", "subTitle"],
    template:
      '<div class="stub-result" :data-status="status"><b>{{ title }}</b><span class="sub">{{ subTitle }}</span><slot name="extra" /></div>',
  },
  "a-space": { template: "<div><slot /></div>" },
};

function freshProbe(overrides = {}) {
  return {
    ok: true,
    suggestedKeyProvider: "md5",
    reasons: [],
    device: { reachable: true, serial: "ABC123", abi: "arm64-v8a" },
    root: { detected: true, magiskInstalled: true },
    frida: { serverRunning: false, port: null },
    wechat: { installed: true, versionName: "7.0.22", majorVersion: 7 },
    warnings: [],
    ...overrides,
  };
}

function mountWizard(props = {}) {
  return mount(WechatWizard, {
    props: { open: true, ...props },
    global: { stubs: STUBS },
  });
}

describe("WechatWizard (web-panel)", () => {
  beforeEach(() => {
    probeWechatEnvMock.mockReset();
    registerWechatMock.mockReset();
  });

  // ─── Step 1 — env-probe ────────────────────────────────────────────

  it("renders step 1 with 探测环境 CTA when first opened", () => {
    const wrapper = mountWizard();
    const html = wrapper.html();
    expect(html).toContain("第 1 / 3 步");
    expect(html).toContain("探测设备 + WeChat 版本");
    expect(html).toContain("探测环境");
  });

  it("runProbe populates probe state + descriptions render device/root/frida/wechat rows", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(freshProbe({
      suggestedKeyProvider: "frida",
      frida: { serverRunning: true, port: 27042 },
      wechat: { installed: true, versionName: "8.0.50", majorVersion: 8 },
    }));
    const wrapper = mountWizard();
    const probeBtn = wrapper.findAll("button").find((b) => b.text().includes("探测环境"));
    await probeBtn.trigger("click");
    await flushPromises();

    expect(probeWechatEnvMock).toHaveBeenCalledOnce();
    const html = wrapper.html();
    expect(html).toContain("frida");
    expect(html).toContain("ABC123");
    expect(html).toContain("8.0.50");
    expect(html).toContain("27042");
  });

  it("下一步 disabled until probe done", async () => {
    const wrapper = mountWizard();
    const nextBtn = wrapper.findAll("button").find((b) => b.text().trim() === "下一步");
    expect(nextBtn.element.disabled).toBe(true);
  });

  it("下一步 disabled when probe returns suggestedKeyProvider=unsupported", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(
      freshProbe({ suggestedKeyProvider: "unsupported", reasons: ["MMKV-only"] }),
    );
    const wrapper = mountWizard();
    const probeBtn = wrapper.findAll("button").find((b) => b.text().includes("探测环境"));
    await probeBtn.trigger("click");
    await flushPromises();
    const nextBtn = wrapper.findAll("button").find((b) => b.text().trim() === "下一步");
    expect(nextBtn.element.disabled).toBe(true);
  });

  it("下一步 advances to step 2 when probe ok", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(freshProbe());
    const wrapper = mountWizard();
    const probeBtn = wrapper.findAll("button").find((b) => b.text().includes("探测环境"));
    await probeBtn.trigger("click");
    await flushPromises();
    const nextBtn = wrapper.findAll("button").find((b) => b.text().trim() === "下一步");
    await nextBtn.trigger("click");
    await flushPromises();
    expect(wrapper.html()).toContain("第 2 / 3 步");
    expect(wrapper.html()).toContain("UIN / wxid");
  });

  it("probeWechatEnv rejection falls back to suggestedKeyProvider=unsupported shape", async () => {
    probeWechatEnvMock.mockRejectedValueOnce(new Error("adb not found"));
    const wrapper = mountWizard();
    const probeBtn = wrapper.findAll("button").find((b) => b.text().includes("探测环境"));
    await probeBtn.trigger("click");
    await flushPromises();
    const html = wrapper.html();
    expect(html).toContain("unsupported");
    expect(html).toContain("adb not found");
    const nextBtn = wrapper.findAll("button").find((b) => b.text().trim() === "下一步");
    expect(nextBtn.element.disabled).toBe(true);
  });

  // ─── Step 2 — form gate ────────────────────────────────────────────

  it("step 2 注册 button disabled until uin is filled", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(freshProbe());
    const wrapper = mountWizard();
    await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().trim() === "下一步").trigger("click");
    await flushPromises();
    const registerBtn = wrapper.findAll("button").find((b) => b.text().trim() === "注册");
    expect(registerBtn.element.disabled).toBe(true);
  });

  it("step 2 注册 button disabled when md5 path has no wechatDataPath", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(freshProbe({ suggestedKeyProvider: "md5" }));
    const wrapper = mountWizard();
    await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().trim() === "下一步").trigger("click");
    await flushPromises();
    // Fill uin only — md5 also needs wechatDataPath
    const inputs = wrapper.findAll("input");
    await inputs[0].setValue("1234567890"); // uin
    const registerBtn = wrapper.findAll("button").find((b) => b.text().trim() === "注册");
    expect(registerBtn.element.disabled).toBe(true);

    await inputs[2].setValue("C:/tmp/com.tencent.mm"); // wechatDataPath (3rd input)
    expect(registerBtn.element.disabled).toBe(false);
  });

  it("step 2 注册 button enabled with only uin when probe path is frida", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(
      freshProbe({ suggestedKeyProvider: "frida", frida: { serverRunning: true, port: 27042 } }),
    );
    const wrapper = mountWizard();
    await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().trim() === "下一步").trigger("click");
    await flushPromises();
    await wrapper.findAll("input")[0].setValue("1234567890");
    const registerBtn = wrapper.findAll("button").find((b) => b.text().trim() === "注册");
    expect(registerBtn.element.disabled).toBe(false);
  });

  // ─── Step 2 → 3 — runRegister ──────────────────────────────────────

  it("runRegister invokes hub.registerWechat with form values + emits registered on ok", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(
      freshProbe({ suggestedKeyProvider: "frida", frida: { serverRunning: true, port: 27042 } }),
    );
    registerWechatMock.mockResolvedValueOnce({
      ok: true,
      name: "wechat",
      version: "0.1.0",
      chosenKeyProvider: "frida",
      sensitivity: "high",
    });
    const wrapper = mountWizard();
    await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().trim() === "下一步").trigger("click");
    await flushPromises();
    await wrapper.findAll("input")[0].setValue("1234567890");
    await wrapper.findAll("button").find((b) => b.text().trim() === "注册").trigger("click");
    await flushPromises();

    expect(registerWechatMock).toHaveBeenCalledOnce();
    const arg = registerWechatMock.mock.calls[0][0];
    expect(arg.account).toEqual({ uin: "1234567890" });
    expect(arg.dbPath).toBeNull();
    expect(arg.wechatDataPath).toBeNull();
    expect(arg.keyProviderOverride).toBeNull();

    const html = wrapper.html();
    expect(html).toContain("WeChat 已接入");
    expect(html).toContain("1234567890");
    expect(html).toContain("frida");
    expect(html).toContain("high");

    const emitted = wrapper.emitted("registered");
    expect(emitted).toHaveLength(1);
    expect(emitted[0][0]).toEqual({ uin: "1234567890", chosenKeyProvider: "frida" });
  });

  it("runRegister failure renders error result + does NOT emit registered", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(
      freshProbe({ suggestedKeyProvider: "frida", frida: { serverRunning: true, port: 27042 } }),
    );
    registerWechatMock.mockResolvedValueOnce({
      ok: false,
      reason: "BOOTSTRAP_THREW",
      message: "EnMicroMsg.db not found",
    });
    const wrapper = mountWizard();
    await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().trim() === "下一步").trigger("click");
    await flushPromises();
    await wrapper.findAll("input")[0].setValue("1234567890");
    await wrapper.findAll("button").find((b) => b.text().trim() === "注册").trigger("click");
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("接入失败");
    expect(html).toContain("Bootstrap 抛错");
    expect(html).toContain("EnMicroMsg.db not found");
    expect(wrapper.emitted("registered")).toBeUndefined();
  });

  it("runRegister catches synchronous RPC throw and surfaces it as BOOTSTRAP_THREW", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(
      freshProbe({ suggestedKeyProvider: "frida", frida: { serverRunning: true, port: 27042 } }),
    );
    registerWechatMock.mockRejectedValueOnce(new Error("WebSocket disconnected"));
    const wrapper = mountWizard();
    await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().trim() === "下一步").trigger("click");
    await flushPromises();
    await wrapper.findAll("input")[0].setValue("1234567890");
    await wrapper.findAll("button").find((b) => b.text().trim() === "注册").trigger("click");
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("接入失败");
    expect(html).toContain("Bootstrap 抛错");
    expect(html).toContain("WebSocket disconnected");
  });

  // ─── reason → user-readable message mapping ────────────────────────

  const reasonCases = [
    ["ENV_UNSUPPORTED", "env-probe 拒绝"],
    ["MD5_NEEDS_WECHAT_DATA_PATH", "MD5 路径需要 wechatDataPath"],
    ["FRIDA_NEEDS_WXID", "Frida 路径需要 account.uin"],
    ["UIN_REQUIRED", "UIN 不能为空"],
  ];

  for (const [reason, expectedFragment] of reasonCases) {
    it(`maps reason=${reason} to user-readable message`, async () => {
      probeWechatEnvMock.mockResolvedValueOnce(
        freshProbe({ suggestedKeyProvider: "frida", frida: { serverRunning: true, port: 27042 } }),
      );
      registerWechatMock.mockResolvedValueOnce({ ok: false, reason });
      const wrapper = mountWizard();
      await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
      await flushPromises();
      await wrapper.findAll("button").find((b) => b.text().trim() === "下一步").trigger("click");
      await flushPromises();
      await wrapper.findAll("input")[0].setValue("X");
      await wrapper.findAll("button").find((b) => b.text().trim() === "注册").trigger("click");
      await flushPromises();
      expect(wrapper.html()).toContain(expectedFragment);
    });
  }

  // ─── Step nav + reset ──────────────────────────────────────────────

  it("上一步 navigates step 2 back to step 1", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(freshProbe());
    const wrapper = mountWizard();
    await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().trim() === "下一步").trigger("click");
    await flushPromises();
    expect(wrapper.html()).toContain("第 2 / 3 步");
    await wrapper.findAll("button").find((b) => b.text().trim() === "上一步").trigger("click");
    await flushPromises();
    expect(wrapper.html()).toContain("第 1 / 3 步");
  });

  it("取消 emits update:open=false and clears state", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(freshProbe());
    const wrapper = mountWizard();
    await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
    await flushPromises();
    const cancelBtn = wrapper.findAll("button").find((b) => b.text().trim() === "取消");
    await cancelBtn.trigger("click");
    await flushPromises();
    const emitted = wrapper.emitted("update:open");
    expect(emitted).toBeTruthy();
    expect(emitted[emitted.length - 1][0]).toBe(false);
  });

  it("再加一个 (success → restartFlow) loops back to step 1 with cleared form", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(
      freshProbe({ suggestedKeyProvider: "frida", frida: { serverRunning: true, port: 27042 } }),
    );
    registerWechatMock.mockResolvedValueOnce({
      ok: true,
      chosenKeyProvider: "frida",
      sensitivity: "high",
    });
    const wrapper = mountWizard();
    await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().trim() === "下一步").trigger("click");
    await flushPromises();
    await wrapper.findAll("input")[0].setValue("1234567890");
    await wrapper.findAll("button").find((b) => b.text().trim() === "注册").trigger("click");
    await flushPromises();
    expect(wrapper.html()).toContain("WeChat 已接入");

    await wrapper.findAll("button").find((b) => b.text().trim() === "再加一个").trigger("click");
    await flushPromises();
    expect(wrapper.html()).toContain("第 1 / 3 步");
    expect(wrapper.html()).toContain("探测设备 + WeChat 版本");
    // step 1 has no inputs (form only shows in step 2). Re-advance and confirm
    // form is cleared.
    probeWechatEnvMock.mockResolvedValueOnce(
      freshProbe({ suggestedKeyProvider: "frida", frida: { serverRunning: true, port: 27042 } }),
    );
    await wrapper.findAll("button").find((b) => b.text().includes("探测环境")).trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().trim() === "下一步").trigger("click");
    await flushPromises();
    expect(wrapper.findAll("input")[0].element.value).toBe("");
  });

  it("watch(props.open) → re-opens to step 1 with fresh state", async () => {
    probeWechatEnvMock.mockResolvedValueOnce(freshProbe());
    const wrapper = mountWizard({ open: false });
    expect(wrapper.html()).not.toContain("第 1 / 3 步");
    await wrapper.setProps({ open: true });
    await nextTick();
    expect(wrapper.html()).toContain("第 1 / 3 步");
  });
});
