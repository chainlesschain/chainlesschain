import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: "proj-1" } }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import ProjectDetailPage from "@renderer/pages/projects/ProjectDetailPage.vue";

// Recursive callable proxy: electronAPI.anything and electronAPI.a.b(...) are
// all callable and resolve to {} (covers on*/off* listeners + domain methods).
const deepStub = () => {
  const fn = () => Promise.resolve({});
  return new Proxy(fn, {
    get: () => deepStub(),
    apply: () => Promise.resolve({}),
  });
};

describe("ProjectDetailPage.vue (smoke, post-util-extraction)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.window = global.window || {};
    global.window.electronAPI = deepStub();
  });

  it("mounts and the extracted helpers resolve on the instance", () => {
    const wrapper = shallowMount(ProjectDetailPage);

    expect(wrapper.vm.getProjectTypeColor("web")).toBe("blue");
    expect(wrapper.vm.getProjectTypeText("app")).toBe("应用程序");
    expect(wrapper.vm.getStatusColor("active")).toBe("success");
    expect(wrapper.vm.getStatusText("completed")).toBe("已完成");
    expect(wrapper.vm.formatDate(null)).toBe("-");

    wrapper.unmount();
  });
});
