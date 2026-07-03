import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import P2PMessaging from "@renderer/components/P2PMessaging.vue";

const p2pStub = () =>
  new Proxy({}, { get: () => vi.fn().mockResolvedValue({}) });

describe("P2PMessaging.vue (smoke, post-util-extraction)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.window = global.window || {};
    global.window.electronAPI = { p2p: p2pStub() };
  });

  it("mounts and the extracted helpers resolve on the instance", () => {
    const wrapper = shallowMount(P2PMessaging);

    expect(wrapper.vm.getSessionKey("a", "b")).toBe("a-b");
    expect(wrapper.vm.getDeviceColor("win32")).toBe("#1890ff");
    expect(wrapper.vm.getDeviceColor("nope")).toBe("#999");
    expect(typeof wrapper.vm.formatTime(Date.now())).toBe("string");

    wrapper.unmount();
  });
});
