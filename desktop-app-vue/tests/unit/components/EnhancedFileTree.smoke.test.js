import { describe, it, expect, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import EnhancedFileTree from "@renderer/components/projects/EnhancedFileTree.vue";

describe("EnhancedFileTree.vue (smoke, post-util-extraction)", () => {
  it("mounts and the extracted helpers still resolve on the instance", () => {
    const wrapper = shallowMount(EnhancedFileTree, {
      props: {
        files: [{ id: "1", name: "index.js", path: "src/index.js" }],
        gitStatus: { "src/index.js": "modified" },
      },
    });

    // Imported helpers are used in the template — a broken import would break
    // rendering / instance resolution here.
    expect(wrapper.vm.getStatusColor("modified")).toBe("orange");
    expect(wrapper.vm.getStatusLabel("added")).toBe("A");
    expect(wrapper.vm.getDirectoryName("src\\a\\b.js")).toBe("src/a");

    wrapper.unmount();
  });
});
