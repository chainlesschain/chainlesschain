import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./virtualFileTreeUtils` import. Helpers are covered by
// virtualFileTreeUtils.test.js. `getFileIcon` intentionally stays in the SFC.
import VirtualFileTree from "@renderer/components/projects/VirtualFileTree.vue";

describe("VirtualFileTree.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(VirtualFileTree).toBeTruthy();
    expect(typeof VirtualFileTree).toBe("object");
  });
});
