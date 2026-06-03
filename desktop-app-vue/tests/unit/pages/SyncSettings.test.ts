/**
 * SyncSettings.vue 组件单测 — Phase 3b。
 *
 * 验证：
 *   1. 启动时拉取所有 PROVIDERS 渲染（6 张卡）
 *   2. provider toggle → scheduler.setProviderEnabled 生效
 *   3. autoSync toggle 在无启用 provider 时禁用
 *   4. "立即同步" 走 scheduler.runOnce + 给 message
 *   5. 单 provider "立即同步" 走 scheduler.runProviderOnce
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { mockMessage, mockRouter } = vi.hoisted(() => ({
  mockMessage: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  mockRouter: { push: vi.fn() },
}));
vi.mock("ant-design-vue", () => ({ message: mockMessage }));
vi.mock("@ant-design/icons-vue", () => ({
  ArrowLeftOutlined: { template: "<span />" },
  SyncOutlined: { template: "<span />" },
}));
vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({ query: {} }),
}));

import SyncSettings from "@renderer/pages/settings/SyncSettings.vue";
import * as scheduler from "@renderer/utils/syncScheduler";
import { PROVIDERS } from "@renderer/utils/syncProviders";

const globalStubs = {
  "a-page-header": {
    template: '<div><slot /><slot name="extra" /></div>',
    props: ["title", "subTitle"],
  },
  "a-card": {
    template: '<div class="a-card"><div>{{ title }}</div><slot /></div>',
    props: ["title", "size"],
  },
  "a-row": { template: "<div><slot /></div>", props: ["align", "gutter"] },
  "a-col": { template: "<div><slot /></div>", props: ["span"] },
  "a-space": { template: "<span><slot /></span>" },
  "a-switch": {
    template:
      '<button class="a-switch" :data-checked="checked" :data-disabled="disabled" @click="$emit(\'change\', !checked)"><slot /></button>',
    props: ["checked", "disabled"],
    emits: ["change"],
  },
  "a-input-number": {
    template:
      '<input :value="value" @input="$emit(\'change\', Number($event.target.value))" />',
    props: ["value", "min", "max", "step"],
    emits: ["change"],
  },
  "a-button": {
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    props: ["loading", "disabled", "type", "size"],
    emits: ["click"],
  },
  "a-list": {
    template:
      '<ul><li v-for="(item, i) in dataSource" :key="i"><slot name="renderItem" :item="item" /></li></ul>',
    props: ["dataSource", "itemLayout"],
  },
  "a-list-item": {
    template:
      '<div class="a-list-item"><slot /><div class="actions"><slot name="actions" /></div></div>',
  },
  "a-list-item-meta": {
    template:
      '<div class="a-list-item-meta"><slot name="title" /><slot name="description" /></div>',
  },
  "a-tag": {
    template: '<span class="a-tag"><slot /></span>',
    props: ["color"],
  },
};

describe("SyncSettings.vue", () => {
  beforeEach(() => {
    Object.values(mockMessage).forEach((fn) => fn.mockReset());
    mockRouter.push.mockReset();
    window.localStorage.clear();
    scheduler._resetForTest();
    (window as any).electronAPI = {
      sync: { incremental: vi.fn(async () => ({ success: true })) },
      git: { sync: vi.fn(async () => true) },
    };
  });

  it("renders one card per registered provider", async () => {
    const wrapper = mount(SyncSettings, {
      global: { stubs: globalStubs },
    });
    await flushPromises();
    const items = wrapper.findAll(".a-list-item");
    expect(items.length).toBe(PROVIDERS.length);
  });

  it("toggling a provider switch persists via scheduler", async () => {
    const wrapper = mount(SyncSettings, {
      global: { stubs: globalStubs },
    });
    await flushPromises();

    expect(scheduler.isProviderEnabled("backend")).toBe(false);
    // The first .a-list-item is the backend provider; its switch is the
    // last .a-switch in the actions slot.
    const allSwitches = wrapper.findAll(".a-switch");
    // index 0 is the auto-sync switch in the top card; subsequent are per-provider
    const backendSwitch = allSwitches[1];
    await backendSwitch.trigger("click");
    await flushPromises();
    expect(scheduler.isProviderEnabled("backend")).toBe(true);
  });

  it('"立即同步全部" runs scheduler.runOnce and surfaces toast', async () => {
    scheduler.setProviderEnabled("backend", true);

    const wrapper = mount(SyncSettings, {
      global: { stubs: globalStubs },
    });
    await flushPromises();

    // Find the "立即同步全部" button in the top card by text
    const buttons = wrapper.findAll("button");
    const runAllBtn = buttons.find((b) => b.text().includes("立即同步全部"));
    expect(runAllBtn).toBeTruthy();
    await runAllBtn!.trigger("click");
    await flushPromises();

    expect((window as any).electronAPI.sync.incremental).toHaveBeenCalledTimes(
      1,
    );
    expect(mockMessage.success).toHaveBeenCalledWith(
      expect.stringMatching(/同步完成/),
    );
  });

  it('单 provider "立即同步" calls runProviderOnce', async () => {
    const wrapper = mount(SyncSettings, {
      global: { stubs: globalStubs },
    });
    await flushPromises();

    // Per-row "立即同步" buttons live inside .actions
    const rowButtons = wrapper
      .findAll(".a-list-item button")
      .filter((b) => b.text().includes("立即同步"));
    expect(rowButtons.length).toBeGreaterThanOrEqual(1);
    // First row = backend provider — wired electronAPI.sync.incremental
    await rowButtons[0].trigger("click");
    await flushPromises();
    expect((window as any).electronAPI.sync.incremental).toHaveBeenCalled();
  });
});
