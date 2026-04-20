/**
 * Deep integration — shell/AppShell.vue interaction flow
 *
 * 真实挂载 AppShell（stubbing 子组件 + electronAPI），验证：
 *   1. Ctrl+Shift+A 翻开/关闭 AdminConsole
 *   2. Composer /admin + Enter 触发 dispatcher 打开 AdminConsole
 *   3. 状态栏注册的 builtin:AdminShortcut 点击打开 AdminConsole
 *
 * 不启动 Electron，走 jsdom；覆盖 slash-dispatch + widget-registry 在
 * 真实壳中的集成行为。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import AppShell from "@/shell/AppShell.vue";

function stubPluginAPI() {
  const api = {
    getRegisteredSpaces: vi
      .fn()
      .mockResolvedValue({ success: true, spaces: [] }),
    getRegisteredArtifacts: vi
      .fn()
      .mockResolvedValue({ success: true, artifacts: [] }),
    getSlashCommands: vi.fn().mockResolvedValue({
      success: true,
      commands: [
        {
          id: "admin-console:admin",
          pluginId: "admin-console",
          trigger: "/admin",
          handler: "builtin:openAdminConsole",
          description: "打开管理控制台",
          icon: "SettingOutlined",
          requirePermissions: ["admin"],
        },
      ],
    }),
    getMentionSources: vi
      .fn()
      .mockResolvedValue({ success: true, sources: [] }),
    getStatusBarWidgets: vi.fn().mockResolvedValue({
      success: true,
      widgets: [
        {
          id: "admin-console:admin-shortcut",
          pluginId: "admin-console",
          component: "builtin:AdminShortcut",
          componentPath: null,
          position: "right",
          order: 100,
          tooltip: "管理控制台 (Ctrl+Shift+A)",
        },
      ],
    }),
    getHomeWidgets: vi.fn().mockResolvedValue({ success: true, widgets: [] }),
    getComposerSlots: vi.fn().mockResolvedValue({ success: true, slots: [] }),
    getActiveBrandTheme: vi
      .fn()
      .mockResolvedValue({ success: true, theme: null }),
    getActiveBrandIdentity: vi
      .fn()
      .mockResolvedValue({ success: true, identity: null }),
    getActiveLLMProvider: vi
      .fn()
      .mockResolvedValue({ success: true, provider: null }),
    getActiveAuthProvider: vi
      .fn()
      .mockResolvedValue({ success: true, provider: null }),
    getActiveDataStorage: vi
      .fn()
      .mockResolvedValue({ success: true, storage: null }),
    getActiveDataCrypto: vi
      .fn()
      .mockResolvedValue({ success: true, crypto: null }),
    getActiveComplianceAudit: vi
      .fn()
      .mockResolvedValue({ success: true, audit: null }),
  };
  (globalThis as any).window.electronAPI = { plugin: api };
  return api;
}

describe("AppShell · interaction integration", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    stubPluginAPI();
  });

  async function mountShell() {
    const wrapper = mount(AppShell, {
      attachTo: document.body,
      global: {
        stubs: {
          ShellSidebar: true,
          ConversationStream: true,
          ArtifactPanel: true,
          CommandPalette: true,
          "a-layout": { template: "<div><slot /></div>" },
          "a-layout-sider": { template: "<div><slot /></div>" },
          "a-layout-content": { template: "<div><slot /></div>" },
          "a-layout-footer": { template: "<div><slot /></div>" },
          "a-modal": {
            props: ["open"],
            emits: ["update:open"],
            template:
              '<div v-if="open" class="admin-console-modal"><slot /></div>',
          },
          "a-tabs": { template: "<div><slot /></div>" },
          "a-tab-pane": { template: "<div><slot /></div>" },
          "a-descriptions": { template: "<div><slot /></div>" },
          "a-descriptions-item": { template: "<div><slot /></div>" },
          "a-divider": { template: "<div><slot /></div>" },
          "a-collapse": { template: "<div><slot /></div>" },
          "a-collapse-panel": { template: "<div><slot /></div>" },
          "a-tag": { template: "<span><slot /></span>" },
          "a-space": { template: "<div><slot /></div>" },
          "a-button": { template: "<button><slot /></button>" },
          "a-table": { template: "<div />" },
          "a-textarea": {
            props: ["value"],
            emits: ["update:value", "keydown", "input"],
            template:
              '<textarea class="composer-input" :value="value" @keydown="$emit(\'keydown\', $event)" @input="$emit(\'update:value\', $event.target.value); $emit(\'input\')" />',
          },
          "a-popover": { template: "<div><slot /></div>" },
          "a-tooltip": { template: "<div><slot /></div>" },
        },
      },
    });
    await flushPromises();
    await flushPromises();
    return wrapper;
  }

  it("Ctrl+Shift+A 打开 AdminConsole", async () => {
    const wrapper = await mountShell();

    expect(wrapper.find(".admin-console-modal").exists()).toBe(false);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "A",
        ctrlKey: true,
        shiftKey: true,
      }),
    );
    await flushPromises();

    expect(wrapper.find(".admin-console-modal").exists()).toBe(true);

    // 再按一次关闭
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "A",
        ctrlKey: true,
        shiftKey: true,
      }),
    );
    await flushPromises();
    expect(wrapper.find(".admin-console-modal").exists()).toBe(false);

    wrapper.unmount();
  });

  it("Composer /admin + Enter 打开 AdminConsole", async () => {
    const wrapper = await mountShell();
    const input = wrapper.find(".composer-input");
    await input.setValue("/admin");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(wrapper.find(".admin-console-modal").exists()).toBe(true);
    wrapper.unmount();
  });

  it("状态栏 builtin:AdminShortcut 点击打开 AdminConsole", async () => {
    const wrapper = await mountShell();
    const shortcut = wrapper.find(".admin-shortcut");
    expect(shortcut.exists()).toBe(true);
    await shortcut.trigger("click");
    await flushPromises();

    expect(wrapper.find(".admin-console-modal").exists()).toBe(true);
    wrapper.unmount();
  });
});
