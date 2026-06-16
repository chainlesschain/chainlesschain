/**
 * usePluginExtensions 测试 — src/renderer/composables/usePluginExtensions.ts
 *
 * loadExtensions (IPC fetch) + the pure mapping computeds (pageRoutes /
 * menuItems / componentsBySlot) with their default-filling + priority sort.
 * window.electronAPI.plugin is mocked.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { usePluginExtensions } from "@/composables/usePluginExtensions";

let getUIExtensions: any;
let ext: ReturnType<typeof usePluginExtensions>;

beforeEach(async () => {
  getUIExtensions = vi.fn().mockResolvedValue({
    success: true,
    extensions: { pages: [], menus: [], components: [] },
  });
  (window as any).electronAPI = {
    plugin: { getUIExtensions, on: vi.fn(), off: vi.fn() },
  };
  ext = usePluginExtensions();
  await ext.loadExtensions(); // reset shared cachedExtensions
});

describe("usePluginExtensions — loadExtensions", () => {
  it("stores extensions on success and clears loading", async () => {
    getUIExtensions.mockResolvedValue({
      success: true,
      extensions: { pages: [{ plugin_id: "p" }], menus: [], components: [] },
    });
    await ext.loadExtensions();
    expect(ext.extensions.value.pages).toHaveLength(1);
    expect(ext.isLoading.value).toBe(false);
  });

  it("records an error when the handler fails", async () => {
    getUIExtensions.mockResolvedValue({ success: false, error: "denied" });
    await ext.loadExtensions();
    expect(ext.error.value).toBe("denied");
  });
});

describe("usePluginExtensions — pageRoutes mapping", () => {
  it("maps a page with config + meta merge", async () => {
    getUIExtensions.mockResolvedValue({
      success: true,
      extensions: {
        pages: [
          {
            plugin_id: "p1",
            plugin_name: "P1",
            config: {
              path: "/x",
              id: "main",
              title: "T",
              icon: "I",
              meta: { a: 1 },
            },
          },
        ],
        menus: [],
        components: [],
      },
    });
    await ext.loadExtensions();
    const [r] = ext.pageRoutes.value;
    expect(r.path).toBe("/plugin/x");
    expect(r.name).toBe("plugin-p1-main");
    expect(r.meta).toMatchObject({
      title: "T",
      icon: "I",
      pluginId: "p1",
      isPluginPage: true,
      a: 1,
    });
  });

  it("fills defaults when config is sparse", async () => {
    getUIExtensions.mockResolvedValue({
      success: true,
      extensions: {
        pages: [{ plugin_id: "p2", plugin_name: "PluginTwo" }],
        menus: [],
        components: [],
      },
    });
    await ext.loadExtensions();
    const [r] = ext.pageRoutes.value;
    expect(r.path).toBe("/plugin/p2");
    expect(r.name).toBe("plugin-p2-main");
    expect(r.meta.title).toBe("PluginTwo");
    expect(r.meta.icon).toBe("AppstoreOutlined");
  });
});

describe("usePluginExtensions — menuItems mapping", () => {
  it("maps menus with priority→order + defaults", async () => {
    getUIExtensions.mockResolvedValue({
      success: true,
      extensions: {
        pages: [],
        menus: [
          {
            plugin_id: "m1",
            plugin_name: "M1",
            priority: 50,
            config: { path: "/mp", label: "L", icon: "MI", badge: "9" },
          },
        ],
        components: [],
      },
    });
    await ext.loadExtensions();
    expect(ext.menuItems.value[0]).toMatchObject({
      key: "/mp",
      label: "L",
      icon: "MI",
      path: "/plugin/mp",
      pluginId: "m1",
      order: 50,
      badge: "9",
      children: [],
    });
  });
});

describe("usePluginExtensions — componentsBySlot", () => {
  it("groups by slot, defaults to 'default', sorts by priority", async () => {
    getUIExtensions.mockResolvedValue({
      success: true,
      extensions: {
        pages: [],
        menus: [],
        components: [
          {
            id: "c1",
            plugin_id: "p",
            plugin_name: "P",
            priority: 20,
            config: { slot: "header" },
          },
          {
            id: "c2",
            plugin_id: "p",
            plugin_name: "P",
            priority: 10,
            config: { slot: "header" },
          },
          { id: "c3", plugin_id: "p", plugin_name: "P", config: {} },
        ],
      },
    });
    await ext.loadExtensions();
    const grouped = ext.componentsBySlot.value;
    expect(grouped.header.map((c) => c.id)).toEqual(["c2", "c1"]); // priority asc
    expect(grouped.default.map((c) => c.id)).toEqual(["c3"]);
    expect(ext.getSlotComponents("header")).toHaveLength(2);
    expect(ext.getSlotComponents("nope")).toEqual([]);
  });
});
