import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// Import-compile smoke: importing the SFC resolves its module graph including
// the extracted `./projectManagementPageUtils` import. Helpers are covered by
// projectManagementPageUtils.test.js.
import ProjectManagementPage from "@renderer/pages/projects/ProjectManagementPage.vue";

describe("ProjectManagementPage.vue (compile smoke, post-util-extraction)", () => {
  it("compiles and resolves its extracted util module", () => {
    expect(ProjectManagementPage).toBeTruthy();
    expect(typeof ProjectManagementPage).toBe("object");
  });
});
