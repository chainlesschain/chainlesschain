/**
 * AppShell · LanguageSwitcher in header
 *
 * V6 shell 顶部 slim header 接入 components/common/LanguageSwitcher.vue
 * （和 V5 AppHeader 用同一个组件、同一个 i18n store）。验证它出现在
 * <a-layout-header> 槽位里。
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
    getSlashCommands: vi
      .fn()
      .mockResolvedValue({ success: true, commands: [] }),
    getMentionSources: vi
      .fn()
      .mockResolvedValue({ success: true, sources: [] }),
    getStatusBarWidgets: vi
      .fn()
      .mockResolvedValue({ success: true, widgets: [] }),
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

describe("AppShell · language switcher in header", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    stubPluginAPI();
  });

  it("renders LanguageSwitcher inside the shell header", async () => {
    const wrapper = mount(AppShell, {
      attachTo: document.body,
      global: {
        stubs: {
          ShellSidebar: true,
          ConversationStream: true,
          ShellComposer: true,
          ArtifactPanel: true,
          ShellStatusBar: true,
          CommandPalette: true,
          AdminConsole: true,
          PromptsPanel: true,
          GitHooksPanel: true,
          KnowledgeGraphPanel: true,
          WorkflowDesignerPanel: true,
          EnterpriseDashboardPanel: true,
          CrossChainBridgePanel: true,
          WalletPanel: true,
          AnalyticsDashboardPanel: true,
          DIDManagementPanel: true,
          ProjectsPanel: true,
          P2PMessagingPanel: true,
          CommunityPanel: true,
          AIChatPanel: true,
          SettingsPanel: true,
          FriendsPanel: true,
          MemoryBankPanel: true,
          LanguageSwitcher: {
            template: '<div class="language-switcher-stub" />',
          },
          "a-layout": { template: "<div><slot /></div>" },
          "a-layout-sider": { template: "<div><slot /></div>" },
          "a-layout-header": {
            template: '<header class="shell-header"><slot /></header>',
          },
          "a-layout-content": { template: "<div><slot /></div>" },
          "a-layout-footer": { template: "<div><slot /></div>" },
        },
      },
    });
    await flushPromises();
    await flushPromises();

    const header = wrapper.find("header.shell-header");
    expect(header.exists()).toBe(true);
    expect(header.find(".language-switcher-stub").exists()).toBe(true);

    wrapper.unmount();
  });
});
