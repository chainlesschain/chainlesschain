import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shallowMount } from "@vue/test-utils";

// echarts is not available/meaningful in jsdom — stub the shared wrapper.
vi.mock("@renderer/utils/echartsConfig", () => ({
  init: () => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getDataURL: vi.fn(() => "data:image/png;base64,"),
  }),
  graphic: { LinearGradient: class {} },
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import AdditionalToolsStats from "@renderer/components/tool/AdditionalToolsStats.vue";

describe("AdditionalToolsStats.vue (smoke, post-util-extraction)", () => {
  beforeEach(() => {
    global.window = global.window || {};
    global.window.electronAPI = {
      tool: {
        getAdditionalV3Dashboard: vi.fn().mockResolvedValue({
          success: true,
          data: {
            summary: {},
            categoryStats: [{ category: "blockchain", count: 3 }],
            tools: [
              {
                name: "t1",
                category: "finance",
                usage_count: 4,
                success_count: 3,
              },
            ],
            trend: [],
          },
        }),
      },
    };
    global.window.addEventListener = global.window.addEventListener || vi.fn();
    global.window.removeEventListener =
      global.window.removeEventListener || vi.fn();
  });

  afterEach(() => vi.clearAllMocks());

  it("mounts and exposes the extracted helpers from the util module", async () => {
    const wrapper = shallowMount(AdditionalToolsStats);
    await wrapper.vm.$nextTick();

    // The imported helpers must still resolve on the instance (they are used
    // in the template, so a broken import would surface here).
    expect(wrapper.vm.getCategoryColor("blockchain")).toBe("blue");
    expect(wrapper.vm.getCategoryName("finance")).toBe("财务");
    expect(wrapper.vm.getSuccessRateColor("95")).toBe("#52c41a");
    expect(
      wrapper.vm.getToolSuccessRate({ usage_count: 4, success_count: 3 }),
    ).toBe("75.0");

    wrapper.unmount();
  });
});
