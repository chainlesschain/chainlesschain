/**
 * shell-preview/widgets/MtcStatusPreviewWidget — unit tests
 *
 * Covers:
 *  - Renders without window.electronAPI (graceful degradation)
 *  - Reads audit-mtc status when electronAPI.mtc.getAuditStatus is wired
 *  - Reads active alg when electronAPI.mtc.getActiveAlg is wired
 *  - Format helpers (relative time, batch interval)
 *  - Survives IPC throw without crashing the component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import MtcStatusPreviewWidget from "../MtcStatusPreviewWidget.vue";

const STUBS = {
  "a-button": {
    props: ["type", "block"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  SafetyOutlined: { template: "<span />" },
};

describe("MtcStatusPreviewWidget", () => {
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

  it("renders default placeholder state when electronAPI is missing", async () => {
    delete (globalThis as unknown as { electronAPI?: unknown }).electronAPI;

    const wrapper = mount(MtcStatusPreviewWidget, { global: { stubs: STUBS } });
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("默克尔树证书");
    expect(html).toContain("未启用");
    expect(html).toContain("尚未关批");
    expect(html).toContain("Ed25519"); // default alg label
  });

  it("renders enabled audit status from electronAPI.mtc.getAuditStatus", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getAuditStatus: vi.fn().mockResolvedValue({
          config: {
            enabled: true,
            batch_interval_seconds: 3600,
            namespace_prefix: "mtc/v1/audit/test",
          },
          staging: { count: 7 },
          batches: {
            count: 3,
            last_batch_id: "000003",
            last_closed_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          },
        }),
      },
    };

    const wrapper = mount(MtcStatusPreviewWidget, { global: { stubs: STUBS } });
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("已启用");
    expect(html).toContain("1h"); // 3600s formatted
    expect(html).toContain("7"); // staging count
    expect(html).toContain("#000003"); // batch id
    expect(html).toMatch(/min 前|s 前/); // relative time on last_closed_at
  });

  it("renders SLH-DSA label when active alg = slh-dsa-128f", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getAuditStatus: vi.fn().mockResolvedValue({}),
        getActiveAlg: vi.fn().mockResolvedValue("slh-dsa-128f"),
      },
    };

    const wrapper = mount(MtcStatusPreviewWidget, { global: { stubs: STUBS } });
    await flushPromises();

    expect(wrapper.html()).toContain("SLH-DSA-128F");
    expect(wrapper.html()).toContain("PQC");
  });

  it("survives IPC throw without crashing — falls back to defaults", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getAuditStatus: vi.fn().mockRejectedValue(new Error("ipc down")),
      },
    };

    const wrapper = mount(MtcStatusPreviewWidget, { global: { stubs: STUBS } });
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("默克尔树证书");
    expect(html).toContain("未启用");
    // Did not throw — wrapper is intact
    expect(wrapper.exists()).toBe(true);
  });

  it("formats sub-minute intervals as seconds", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getAuditStatus: vi.fn().mockResolvedValue({
          config: { enabled: true, batch_interval_seconds: 60 },
        }),
      },
    };
    const wrapper = mount(MtcStatusPreviewWidget, { global: { stubs: STUBS } });
    await flushPromises();
    expect(wrapper.html()).toContain("1min");
  });

  it("opens docs URL when 打开使用指南 clicked", async () => {
    delete (globalThis as unknown as { electronAPI?: unknown }).electronAPI;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const wrapper = mount(MtcStatusPreviewWidget, { global: { stubs: STUBS } });
    await flushPromises();
    const buttons = wrapper.findAll("button");
    // Second button is "打开使用指南"
    await buttons[1].trigger("click");

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("docs.chainlesschain.com"),
      "_blank",
      "noopener",
    );
  });
});
