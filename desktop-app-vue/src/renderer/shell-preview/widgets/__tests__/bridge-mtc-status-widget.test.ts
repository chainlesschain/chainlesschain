/**
 * shell-preview/widgets/BridgeMtcStatusWidget — unit tests
 *
 * Mirrors mtc-status-widget.test.ts patterns:
 *  - Renders default state when electronAPI is missing
 *  - Reads bridge MTC status when electronAPI.mtc.getBridgeStatus is wired
 *  - Renders alg/mode labels correctly
 *  - Survives IPC throw
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import BridgeMtcStatusWidget from "../BridgeMtcStatusWidget.vue";

const STUBS = {
  "a-button": {
    props: ["type", "block"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  ApartmentOutlined: { template: "<span />" },
};

describe("BridgeMtcStatusWidget", () => {
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

    const wrapper = mount(BridgeMtcStatusWidget, { global: { stubs: STUBS } });
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("跨链桥 MTC");
    expect(html).toContain("未启用");
    expect(html).toContain("Independent");
    expect(html).toContain("Ed25519"); // default alg label
    expect(html).toContain("尚未关批");
    expect(html).toContain("未配置"); // trust anchor default
  });

  it("renders enabled bridge status from electronAPI.mtc.getBridgeStatus", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getBridgeStatus: vi.fn().mockResolvedValue({
          config: {
            enabled: true,
            mode: "federated",
            alg: "slh-dsa-128f",
            batch_interval_seconds: 60,
            issuer: "mtca:cc:bridge-test",
          },
          trust_anchors: {
            chain_count: 2,
            total: 5,
            by_chain: { ethereum: 3, polygon: 2 },
          },
          staging: { pending: 7 },
          batches: { total: 3, latest: "ethereum-polygon-000003" },
        }),
      },
    };

    const wrapper = mount(BridgeMtcStatusWidget, { global: { stubs: STUBS } });
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("已启用");
    expect(html).toContain("Federated"); // mode
    expect(html).toContain("SLH-DSA-128F"); // alg
    expect(html).toContain("PQC");
    expect(html).toContain("1min"); // 60s
    expect(html).toContain("5 锚 / 2 链"); // trust anchor format
    expect(html).toContain("7"); // staging pending
    expect(html).toContain("ethereum-polygon-000003"); // latest batch
  });

  it("survives IPC throw without crashing", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getBridgeStatus: vi.fn().mockRejectedValue(new Error("ipc down")),
      },
    };

    const wrapper = mount(BridgeMtcStatusWidget, { global: { stubs: STUBS } });
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("跨链桥 MTC");
    expect(html).toContain("未启用");
    expect(wrapper.exists()).toBe(true);
  });

  it("renders Light Client mode label", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getBridgeStatus: vi
          .fn()
          .mockResolvedValue({ config: { mode: "light-client" } }),
      },
    };
    const wrapper = mount(BridgeMtcStatusWidget, { global: { stubs: STUBS } });
    await flushPromises();
    expect(wrapper.html()).toContain("Light Client");
  });

  it("opens cross-chain bridge design doc URL when '打开设计文档' clicked", async () => {
    delete (globalThis as unknown as { electronAPI?: unknown }).electronAPI;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const wrapper = mount(BridgeMtcStatusWidget, { global: { stubs: STUBS } });
    await flushPromises();
    const buttons = wrapper.findAll("button");
    // Second button is "打开设计文档"
    await buttons[1].trigger("click");

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("design.chainlesschain.com"),
      "_blank",
      "noopener",
    );
  });
});
