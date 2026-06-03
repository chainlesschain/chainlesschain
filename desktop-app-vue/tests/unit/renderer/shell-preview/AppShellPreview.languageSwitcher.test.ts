/**
 * AppShellPreview · LanguageSwitcher in topbar
 *
 * `/v6-preview` route loads `shell-preview/AppShellPreview.vue` (Claude-Desktop
 * preview shell), not `shell/AppShell.vue`. This test verifies the language
 * switcher landed in the topbar actions group.
 *
 * Brittle full-mount of AppShellPreview pulls in stores + LLM bridge + router
 * + ant-d-v + a 1700-line template; we stub aggressively and only assert the
 * presence + position of the switcher stub.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import AppShellPreview from "@/shell-preview/AppShellPreview.vue";

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/v6-preview", component: { template: "<div />" } },
    ],
  });
}

describe("AppShellPreview · language switcher in topbar", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    (globalThis as any).window.electronAPI = {
      llm: {
        chat: vi.fn().mockResolvedValue({ success: true, response: "" }),
      },
      project: {
        list: vi.fn().mockResolvedValue({ success: true, projects: [] }),
      },
    };
  });

  it("renders LanguageSwitcher inside the topbar actions group", async () => {
    const router = makeRouter();
    await router.push("/v6-preview");
    await router.isReady();

    const wrapper = mount(AppShellPreview, {
      attachTo: document.body,
      global: {
        plugins: [router],
        stubs: {
          ConversationList: true,
          DecentralEntries: true,
          ArtifactDrawer: true,
          ToolInvocationCard: true,
          TaskProgressPanel: true,
          LanguageSwitcher: {
            template: '<div class="language-switcher-stub" />',
          },
          PlusOutlined: true,
          DownOutlined: true,
          FolderOpenOutlined: true,
          GlobalOutlined: true,
          ReloadOutlined: true,
          SettingOutlined: true,
          CloseCircleOutlined: true,
          FileTextOutlined: true,
          RobotOutlined: true,
        },
      },
    });
    await flushPromises();

    const topbarActions = wrapper.find(".cb-shell__topbar-actions");
    expect(topbarActions.exists()).toBe(true);
    expect(topbarActions.find(".language-switcher-stub").exists()).toBe(true);

    wrapper.unmount();
  });
});
