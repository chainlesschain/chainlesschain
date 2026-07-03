import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./toolManagementUtils` import. Helpers are covered by
// toolManagementUtils.test.js.
import ToolManagement from "@renderer/pages/ToolManagement.vue";

describe("ToolManagement.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(ToolManagement).toBeTruthy();
    expect(typeof ToolManagement).toBe("object");
  });
});
